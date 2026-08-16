/**
 * Geodesic polygon area (spherical excess) for GeoJSON [lon, lat] geometry —
 * the same approach as turf's area, kept dependency-free. Used at build time to
 * stamp an `area_ha` property on polygon features so the hover card can show a
 * size without re-deriving geometry in the browser.
 */
const R = 6378137; // WGS84 mean radius, metres
const rad = (d) => (d * Math.PI) / 180;

function ringArea(coords) {
  const n = coords.length;
  if (n < 3) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const [lon1, lat1] = coords[i];
    const [lon2, lat2] = coords[(i + 1) % n];
    total += rad(lon2 - lon1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)));
  }
  return (total * R * R) / 2;
}

function polygonArea(rings) {
  if (!rings.length) return 0;
  // Outer ring minus holes (use magnitudes so winding order doesn't matter).
  return rings.reduce(
    (sum, ring, i) => sum + (i === 0 ? Math.abs(ringArea(ring)) : -Math.abs(ringArea(ring))),
    0,
  );
}

/** Area of a GeoJSON geometry in square metres. */
export function areaM2(geometry) {
  if (!geometry) return 0;
  if (geometry.type === 'Polygon') return polygonArea(geometry.coordinates);
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.reduce((sum, poly) => sum + polygonArea(poly), 0);
  }
  return 0;
}

/** Area in hectares, rounded to one decimal place. */
export function areaHa(geometry) {
  return Math.round((areaM2(geometry) / 10000) * 10) / 10;
}

// ---- Point-in-polygon (ray casting) -------------------------------------

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(point, rings) {
  if (!inRing(point, rings[0])) return false; // outside outer ring
  for (let i = 1; i < rings.length; i++) if (inRing(point, rings[i])) return false; // in a hole
  return true;
}

/** Is [lon, lat] inside a GeoJSON Polygon / MultiPolygon geometry? */
export function pointInGeometry(point, geometry) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') return inPolygon(point, geometry.coordinates);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some((poly) => inPolygon(point, poly));
  return false;
}

/** Centroid (mean of all vertices) of a Polygon / MultiPolygon — for proximity. */
export function centroid(geometry) {
  let sx = 0, sy = 0, n = 0;
  const walk = (a) => {
    if (typeof a[0] === 'number') { sx += a[0]; sy += a[1]; n += 1; }
    else a.forEach(walk);
  };
  if (geometry) walk(geometry.coordinates);
  return n ? [sx / n, sy / n] : null;
}

/** Great-circle distance between two [lon, lat] points, in metres. */
export function haversine([lon1, lat1], [lon2, lat2]) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
