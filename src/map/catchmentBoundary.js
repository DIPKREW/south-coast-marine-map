/**
 * The SOUTH COAST HYDROLOGICAL BOUNDARY, for use in the browser.
 *
 * Built at data time by scripts/build-catchment-boundary.mjs from the Environment
 * Agency's WFD catchment polygons: the land whose water ends up on this coast,
 * following watersheds rather than a straight line. The build-time layers filter
 * against the same file through scripts/lib/southcoast.mjs; the LIVE storm
 * overflow layer is fetched at runtime, so it has to do the test here.
 *
 * Loaded once and memoised — the live layer is the only caller, and it only runs
 * when its toggle is switched on.
 */

/**
 * THE BEACHY HEAD CUTOFF — the corridor's hard eastern edge. Kept in step with
 * `BEACHY_HEAD_LON` in scripts/lib/southcoast.mjs, which applies the same value
 * to the build-time layers.
 *
 * A GEOGRAPHIC rule that deliberately overrides the hydrological one: the
 * Hastings and Bexhill catchments really do drain into Sussex East, but the
 * corridor stops at the headland, so they are cut. A site must pass BOTH tests.
 */
export const BEACHY_HEAD_LON = 0.245;

/**
 * Sites that beat every filter, mirroring the marine layer's curated allow-lists
 * and the same list in scripts/lib/southcoast.mjs. Both are LONG-SEA OUTFALLS,
 * discharging beyond the one-nautical-mile limit of the WFD coastal water
 * bodies — so they sit outside every water body and outside the catchment
 * boundary derived from them, and no catchment test can reach them.
 */
export const FORCE_INCLUDE = new Set(['SWS00513', 'SWS00061']);

let cached = null;

/** Every ring of a Polygon / MultiPolygon, as { rings, bbox } per polygon. */
function indexGeometry(geometry) {
  const polys = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  return polys.map((rings) => {
    let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
    for (const [x, y] of rings[0]) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    return { rings, bbox: [x0, y0, x1, y1] };
  });
}

// Ray casting, matching scripts/lib/geo.mjs so the runtime layer and the
// build-time layers can never disagree about a borderline point.
function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Fetch and index the boundary. Returns { envelope, contains } — `envelope` is
 * [W, S, E, N] for use as a cheap server-side query window, `contains` is the
 * real test.
 */
export async function loadCatchmentBoundary(base = '/', signal) {
  if (cached) return cached;

  const res = await fetch(`${base}data/catchment-boundary.geojson`, { signal });
  if (!res.ok) throw new Error(`catchment boundary unavailable (HTTP ${res.status})`);
  const fc = await res.json();
  const feats = fc.features ?? (fc.geometries ?? []).map((g) => ({ geometry: g }));
  const polys = feats.flatMap((f) => (f.geometry ? indexGeometry(f.geometry) : []));
  if (!polys.length) throw new Error('catchment boundary contained no polygons');

  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  for (const p of polys) {
    x0 = Math.min(x0, p.bbox[0]);
    y0 = Math.min(y0, p.bbox[1]);
    x1 = Math.max(x1, p.bbox[2]);
    y1 = Math.max(y1, p.bbox[3]);
  }

  cached = {
    envelope: [x0, y0, x1, y1],
    contains(point) {
      const [px, py] = point;
      // The per-polygon bbox check first — it rejects almost every point for
      // almost every polygon without touching the ring maths.
      for (const { rings, bbox } of polys) {
        if (px < bbox[0] || px > bbox[2] || py < bbox[1] || py > bbox[3]) continue;
        if (!inRing(point, rings[0])) continue;
        let hole = false;
        for (let i = 1; i < rings.length; i++) {
          if (inRing(point, rings[i])) { hole = true; break; }
        }
        if (!hole) return true;
      }
      return false;
    },
    /**
     * The whole membership rule in one place: an overflow belongs if it is on
     * the force-include list, or if it passes BOTH the hydrological test and the
     * Beachy Head cutoff.
     */
    includes(point, id) {
      if (FORCE_INCLUDE.has(id)) return true;
      if (point[0] > BEACHY_HEAD_LON) return false;
      return this.contains(point);
    },
  };
  return cached;
}
