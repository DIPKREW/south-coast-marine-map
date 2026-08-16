/**
 * Shared geographic config for the South Coast data pipeline.
 *
 * Every fetch script queries and clips to this one box, so the layers share a
 * single, consistent footprint. It was sized by fetch-marine.mjs so that each
 * allow-listed marine protected area sits WHOLLY inside it (see that file for
 * the per-edge reasoning); the other layers simply inherit it.
 */

// South Coast Marine Recovery Project bounding box, Land's End to Beachy Head,
// extended seaward (south): [W, S, E, N].
export const SOUTH_COAST_BBOX = [-6.2, 49.85, 0.6, 51.1];

/** ArcGIS FeatureServer query params for an envelope intersect over the box. */
export function bboxParams(extra = {}) {
  return {
    geometry: SOUTH_COAST_BBOX.join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    ...extra,
  };
}

/**
 * Page through an ArcGIS FeatureServer layer, returning every GeoJSON feature
 * that matches. Services cap a single response (`maxRecordCount`, typically
 * 1000–2000), so a plain query silently truncates — this walks `resultOffset`
 * until the service stops handing back new records.
 */
export async function fetchAllFeatures(url, params, { pageSize = 1000 } = {}) {
  const features = [];
  for (let offset = 0; ; offset += pageSize) {
    const qs = new URLSearchParams({
      ...params,
      outSR: '4326',
      returnGeometry: 'true',
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
      f: 'geojson',
    });
    const res = await fetch(`${url}/query?${qs}`);
    if (!res.ok) throw new Error(`ArcGIS query failed: ${res.status} ${res.statusText}`);
    const json = await res.json();
    if (json.error) throw new Error(`ArcGIS error: ${json.error.message}`);
    const batch = json.features ?? [];
    features.push(...batch);
    // Stop on a short page — that is the last one. `exceededTransferLimit`
    // marks a full page with more to come.
    if (batch.length < pageSize) break;
  }
  return features;
}

/** Count matching records without pulling geometry — used to verify the paging. */
export async function fetchCount(url, params) {
  const qs = new URLSearchParams({ ...params, returnCountOnly: 'true', f: 'json' });
  const res = await fetch(`${url}/query?${qs}`);
  if (!res.ok) throw new Error(`ArcGIS count failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.error) throw new Error(`ArcGIS error: ${json.error.message}`);
  return json.count;
}

/** Round coordinates in place to keep the committed GeoJSON small. */
export function roundCoords(geometry, dp = 5) {
  const f = 10 ** dp;
  const walk = (g) => {
    if (typeof g[0] === 'number') {
      g[0] = Math.round(g[0] * f) / f;
      g[1] = Math.round(g[1] * f) / f;
    } else g.forEach(walk);
  };
  if (geometry?.coordinates) walk(geometry.coordinates);
  return geometry;
}
