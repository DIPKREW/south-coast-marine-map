/**
 * Fetch LICENSED SEABED ACTIVITY — dredging, disposal and aggregate extraction —
 * for the project corridor, and bundle it at public/data/marine-licensing.geojson.
 *
 * Run with: npm run data:licensing
 *
 * SOURCE
 * ------
 * MMO's own ArcGIS org, service `S4_Marine_Licensable_Activities_Sep25` —
 * September 2025, so genuinely current rather than the "Legacy" licence layers
 * that data.gov.uk surfaces first. Open, no key. Two parts are used:
 *
 *   layers 1/2/3  Marine Licences and Applications, as POINT, LINE and POLYGON.
 *                 MMO splits one licence register across three geometry types,
 *                 so all three are queried rather than assuming polygons.
 *   layer 4       Disposal Sites (Cefas) — the designated grounds themselves,
 *                 which carry a real Open / Closed / Disused status.
 *
 * WHAT "STATUS" ACTUALLY MEANS — the thing not to assume
 * -----------------------------------------------------
 * `CaseStatus` is NOT an active/historic flag. In this corridor it only ever
 * reads COMPLETED or VARIATION_REQUESTED, which describe how far the licence
 * APPLICATION got through MMO's case system — a completed case is a granted
 * licence, not a finished activity. The real currency signal is `LEndDate`, the
 * licence end date, so that is what this script uses:
 *
 *   LEndDate in the future  → current
 *   LEndDate in the past    → expired
 *   LEndDate missing        → unknown, and reported as such
 *
 * Many licences carry a placeholder end date decades out (2081, 2136), which is
 * how MMO encodes open-ended consent. Those count as current, correctly, but it
 * means "current" should be read as "not yet expired" rather than "being dredged
 * this week".
 *
 * The Cefas disposal SITES are different and better: `status_` is a genuine
 * Open / Closed / Disused state for the ground itself.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SOUTH_COAST_BBOX, BEACHY_HEAD_LON, fetchAllFeatures, fetchCount } from './lib/southcoast.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, '../public/data/marine-licensing.geojson');

const BASE =
  'https://services.arcgis.com/JJzESW51TqeY9uat/arcgis/rest/services/' +
  'S4_Marine_Licensable_Activities_Sep25/FeatureServer';

// Same rectangle as seabed habitats, marine species and recreational pressure.
const [W, S, , N] = SOUTH_COAST_BBOX;
const E = BEACHY_HEAD_LON;

const envelope = {
  geometry: [W, S, E, N].join(','),
  geometryType: 'esriGeometryEnvelope',
  inSR: '4326',
  spatialRel: 'esriSpatialRelIntersects',
};

/** MMO project types that count as dredging / disposal / extraction. */
const CATEGORY = new Map([
  ['Aggregate dredging', 'aggregate'],
  ['Navigational dredging (capital)', 'navdredge'],
  ['Navigational dredging (maintenance)', 'navdredge'],
  ['Clean-up dredging', 'otherdredge'],
  ['Other dredging', 'otherdredge'],
  ['Disposal of dredged material', 'disposal'],
  ['Alternative use of dredged material', 'disposal'],
]);
const TYPES = [...CATEGORY.keys()];
const WHERE = `ProjectTy IN (${TYPES.map((t) => `'${t.replace(/'/g, "''")}'`).join(',')})`;

const LICENCE_FIELDS = 'CaseRef,ProjectTy,LicenceTy,LicenceNo,ProjTitle,CaseStatus,OrgName,LStartDate,LEndDate,ProjSector';
const SITE_FIELDS = 'Site_Name,name_,status_,licence_co,opened_dat,disused_cl,sea_area_';

const NOW = Date.now();

/**
 * Bounding box of a geometry, and whether it meets the corridor.
 *
 * This is not belt-and-braces: the service stores its geometry in a projected
 * CRS, so ArcGIS turns a lon/lat query envelope into an axis-aligned box in that
 * CRS and over-covers — the raw result for this corridor includes The Garden
 * Bridge in London and Hinkley Point C in the Bristol Channel. The rectangle is
 * therefore enforced here, on real geometry.
 */
function bbox(geometry) {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < x0) x0 = c[0];
      if (c[0] > x1) x1 = c[0];
      if (c[1] < y0) y0 = c[1];
      if (c[1] > y1) y1 = c[1];
    } else c.forEach(walk);
  };
  if (!geometry?.coordinates) return null;
  walk(geometry.coordinates);
  return [x0, y0, x1, y1];
}
const meetsCorridor = (g) => {
  const b = bbox(g);
  return b ? b[2] >= W && b[0] <= E && b[3] >= S && b[1] <= N : false;
};

const iso = (ms) => (ms == null || !Number.isFinite(Number(ms)) ? null : new Date(Number(ms)).toISOString().slice(0, 10));

async function main() {
  console.log('Fetching licensed seabed activity (MMO marine licensing, Sep 2025 extract)…');
  console.log(`  corridor [W,S,E,N] = ${W}, ${S}, ${E}, ${N}   (east edge = Beachy Head cutoff)`);

  const features = [];
  const geomCounts = {};
  let dropped = 0;

  // ---- 1-3. The licence register, across all three geometry types. ----
  for (const [layerId, label] of [[1, 'point'], [2, 'line'], [3, 'polygon']]) {
    const url = `${BASE}/${layerId}`;
    const n = await fetchCount(url, { ...envelope, where: WHERE });
    console.log(`  layer ${layerId} (${label}): ${n} dredging/disposal licence(s) in the query envelope`);
    if (!n) { geomCounts[label] = 0; continue; }
    const raw = await fetchAllFeatures(url, { ...envelope, where: WHERE, outFields: LICENCE_FIELDS, geometryPrecision: '6' }, { pageSize: 1000 });
    let kept = 0;
    for (const f of raw) {
      if (!f.geometry || !meetsCorridor(f.geometry)) { dropped++; continue; }
      const p = f.properties ?? {};
      const end = Number(p.LEndDate);
      features.push({
        type: 'Feature',
        properties: {
          cat: CATEGORY.get(p.ProjectTy) ?? 'otherdredge',
          type: p.ProjectTy || null,
          status: !Number.isFinite(end) ? 'unknown' : end >= NOW ? 'current' : 'expired',
          org: p.OrgName || null,
          title: p.ProjTitle || null,
          ref: p.CaseRef || p.LicenceNo || null,
          start: iso(p.LStartDate),
          end: iso(p.LEndDate),
          kind: 'licence',
        },
        geometry: f.geometry,
      });
      kept++;
    }
    geomCounts[label] = kept;
  }

  // ---- 4. Cefas disposal sites — the grounds, with a real open/closed state.
  const siteUrl = `${BASE}/4`;
  const nSites = await fetchCount(siteUrl, { ...envelope, where: '1=1' });
  console.log(`  layer 4 (disposal sites): ${nSites} in the query envelope`);
  const rawSites = await fetchAllFeatures(siteUrl, { ...envelope, where: '1=1', outFields: SITE_FIELDS, geometryPrecision: '6' }, { pageSize: 1000 });
  let siteKept = 0;
  for (const f of rawSites) {
    if (!f.geometry || !meetsCorridor(f.geometry)) { dropped++; continue; }
    const p = f.properties ?? {};
    features.push({
      type: 'Feature',
      properties: {
        cat: 'site',
        type: 'Disposal site',
        status: (p.status_ || 'unknown').toLowerCase(),
        org: p.licence_co || null,
        title: p.Site_Name || p.name_ || null,
        ref: null,
        start: iso(p.opened_dat),
        end: iso(p.disused_cl),
        kind: 'site',
      },
      geometry: f.geometry,
    });
    siteKept++;
  }

  const fc = { type: 'FeatureCollection', features };
  const txt = JSON.stringify(fc);
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, txt);

  // ---- Report ----
  const tally = (key) => {
    const m = new Map();
    for (const f of features) m.set(f.properties[key], (m.get(f.properties[key]) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  console.log(`\n  ${dropped} feature(s) were outside the corridor and dropped (envelope over-coverage — see the note in the code)`);
  console.log(`\n  geometry types kept: ${JSON.stringify({ ...geomCounts, 'disposal-site polygon': siteKept })}`);
  console.log('  by category:');
  for (const [k, v] of tally('cat')) console.log(`     ${String(k).padEnd(12)} ${String(v).padStart(4)}`);
  console.log('  by project type:');
  for (const [k, v] of tally('type')) console.log(`     ${String(k).padEnd(38)} ${String(v).padStart(4)}`);
  console.log('  by status:');
  for (const [k, v] of tally('status')) console.log(`     ${String(k).padEnd(12)} ${String(v).padStart(4)}`);
  const named = features.filter((f) => f.properties.org).length;
  console.log(`  ${named}/${features.length} carry an operator name`);

  const kb = (Buffer.byteLength(txt) / 1024).toFixed(0);
  console.log(`\nWrote ${OUT} — ${features.length} features, ${kb} KB.`);
}

main().catch((err) => {
  console.error('Failed to build marine licensing data:', err.message);
  process.exit(1);
});
