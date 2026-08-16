/**
 * Shared geographic config for the South Coast data pipeline.
 *
 * Every fetch script queries and clips to this one box, so the layers share a
 * single, consistent footprint. It was sized by fetch-marine.mjs so that each
 * allow-listed marine protected area sits WHOLLY inside it (see that file for
 * the per-edge reasoning); the other layers simply inherit it.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { pointInGeometry } from './geo.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));

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

/**
 * The SOUTH COAST HYDROLOGICAL BOUNDARY — the real drainage area, built by
 * scripts/build-catchment-boundary.mjs. This, not the bbox, is what decides
 * whether a storm overflow belongs to the project: a site is in if its water
 * ends up on this coast, however far inland it sits.
 *
 * The bbox above is still used, but only as the ArcGIS query envelope — a cheap
 * server-side prefilter. Every point that comes back is then tested against this
 * boundary. The two are not interchangeable: the boundary reaches further north
 * than the box (up the Hampshire Avon past Salisbury) and stops well short of it
 * in the west (the whole Bristol Channel coast).
 */
export const BOUNDARY_PATH = resolve(__dir, '../../public/data/catchment-boundary.geojson');

export async function loadBoundary() {
  const fc = JSON.parse(await readFile(BOUNDARY_PATH, 'utf8'));
  const feats = fc.features ?? (fc.geometries ?? []).map((g) => ({ geometry: g }));
  const geometries = feats.map((f) => f.geometry).filter(Boolean);
  if (!geometries.length) throw new Error(`no geometry in ${BOUNDARY_PATH} — run: npm run data:catchment`);

  // Envelope of the boundary, for use as the ArcGIS query bbox.
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < x0) x0 = c[0];
      if (c[0] > x1) x1 = c[0];
      if (c[1] < y0) y0 = c[1];
      if (c[1] > y1) y1 = c[1];
    } else c.forEach(walk);
  };
  geometries.forEach((g) => walk(g.coordinates));

  return {
    geometries,
    envelope: [x0, y0, x1, y1],
    contains: (point) => geometries.some((g) => pointInGeometry(point, g)),
  };
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
