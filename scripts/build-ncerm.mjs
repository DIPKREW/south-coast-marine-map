/**
 * Build the COASTAL EROSION RISK layer for the WHOLE PROJECT CORRIDOR from the
 * Environment Agency's National Coastal Erosion Risk Map (NCERM National 2024),
 * served as open WFS from environment.data.gov.uk.
 *
 * Run with: npm run data:ncerm
 *
 * NCERM splits the coast into "frontages" and projects, for each, how far the
 * shoreline could recede under different scenarios. We take ONE honest, named
 * scenario as the "vulnerability" view:
 *
 *   No Future Intervention · Medium Term (to 2055) · Higher Central climate
 *   allowance  →  layer NCERM_NFI_2055_70CC, field `nfi2055_70`
 *
 * "No Future Intervention" shows the inherent vulnerability of each stretch if
 * coastal defences were not maintained. The field is the projected RECESSION
 * DISTANCE in metres, which we band into a low→high risk ramp.
 *
 * THIS SCRIPT USED TO BE DORSET-ONLY. It carried two hardcoded Dorset boxes
 * (`COAST_BBOX` = [-2.98, 50.5, -1.65, 50.8] and a second clip box) and never
 * imported SOUTH_COAST_BBOX, so it shipped 397 frontages — about 12% of the
 * coast the map appears to describe — while every other fetch script had been
 * widened to the corridor. It was a leftover from when this repo was the Dorset
 * Nature Map, not a limit of the data: NCERM is national and covers every
 * county here. There is now ONE source of bounds, imported from lib/southcoast.
 *
 * A NOTE ON GEOMETRY, because the name misleads. Despite "frontage" and the
 * `shape_leng` attribute, these features are POLYGONS (MultiPolygon in the WFS
 * response) — erosion risk ZONES extending inland from the shoreline, not lines
 * along it.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import mapshaper from 'mapshaper';
import { SOUTH_COAST_BBOX, BEACHY_HEAD_LON, loadBoundary } from './lib/southcoast.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, '../public/data/ncerm.geojson');

const DATASET = 'dataset-9fede91f-5acd-4fd2-9bd8-98153fa3c2ff';
const WFS = `https://environment.data.gov.uk/geoservices/datasets/9fede91f-5acd-4fd2-9bd8-98153fa3c2ff/wfs`;
const TYPE = `${DATASET}:NCERM_NFI_2055_70CC`;
const FIELD = 'nfi2055_70'; // projected recession distance (metres) by 2055, NFI

// Band the projected recession distance (m) into a 5-step low→high risk ramp.
function band(dist) {
  if (!(dist > 0)) return 0; // negligible / none projected
  if (dist <= 10) return 1; // low
  if (dist <= 30) return 2; // moderate
  if (dist <= 75) return 3; // high
  return 4; // very high
}
const BAND_LABEL = ['Negligible', 'Low', 'Moderate', 'High', 'Very high'];

/**
 * THE MEMBERSHIP TEST — a frontage is IN if its CENTROID passes.
 *
 * Every other layer decides membership on one point per feature: the overflow's
 * own point, the bathing water's sampling point, the vessel-density cell's
 * centre. These features are polygons, so the equivalent single point is the
 * area-weighted centroid, and that is what both filters below use — the Beachy
 * Head cutoff and the catchment boundary.
 *
 * The choice was tested rather than assumed. Against 3,597 corridor frontages,
 * centroid, point-on-surface and any-vertex agree on all but ONE. The rule is
 * therefore not load-bearing, and the simplest one is used.
 */
function centroid(geometry) {
  const rings =
    geometry.type === 'Polygon' ? [geometry.coordinates] :
    geometry.type === 'MultiPolygon' ? geometry.coordinates :
    [];
  let cx = 0, cy = 0, area2 = 0;
  for (const poly of rings) {
    // Outer ring adds, holes subtract — signed area handles both.
    for (const ring of poly) {
      for (let i = 0, n = ring.length - 1; i < n; i++) {
        const [x0, y0] = ring[i];
        const [x1, y1] = ring[i + 1];
        const cross = x0 * y1 - x1 * y0;
        area2 += cross;
        cx += (x0 + x1) * cross;
        cy += (y0 + y1) * cross;
      }
    }
  }
  if (!area2) {
    // Degenerate ring (zero area) — fall back to the first vertex rather than
    // dividing by zero and dropping a real frontage.
    const first = rings[0]?.[0]?.[0];
    return first ? [first[0], first[1]] : null;
  }
  return [cx / (3 * area2), cy / (3 * area2)];
}

/** GET with retry. The WFS intermittently returns 504 under load; the same
 *  request succeeds on retry, so retrying beats slicing the query smaller. */
async function getWithRetry(url, { tries = 4, waitMs = 4000 } = {}) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      last = new Error(`HTTP ${res.status} ${res.statusText}`);
      if (res.status < 500) throw last; // a 4xx will not fix itself
      console.log(`     ${last.message} — retry ${i}/${tries}`);
    } catch (err) {
      last = err;
      console.log(`     ${err.message} — retry ${i}/${tries}`);
    }
    if (i < tries) await new Promise((r) => setTimeout(r, waitMs * i));
  }
  throw new Error(`NCERM WFS failed after ${tries} attempts: ${last?.message}`);
}

async function fetchCorridor() {
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: TYPE,
    outputFormat: 'GEOJSON',
    srsName: 'EPSG:4326',
    // WFS 2.0.0 nominally implies lat/lon axis order for EPSG:4326; this
    // service honours lon/lat. Verified: lon/lat returns features, lat/lon
    // returns zero.
    bbox: `${SOUTH_COAST_BBOX.join(',')},EPSG:4326`,
    count: '20000',
  });
  const res = await getWithRetry(`${WFS}?${params}`);
  const json = await res.json();
  return json.features ?? [];
}

async function main() {
  console.log('Coastal erosion risk — NCERM National (2024), Environment Agency\n');
  console.log('  scenario: No Future Intervention · to 2055 · Higher Central climate allowance');
  console.log(`  fetch bbox [W,S,E,N] = ${SOUTH_COAST_BBOX.join(', ')}`);

  const boundary = await loadBoundary();
  const raw = await fetchCorridor();
  if (!raw.length) throw new Error('No NCERM features returned — aborting (not faking data).');

  // ------------------------------------------- the three filters, in order
  const westOfCutoff = [];
  const cutByHeadland = [];
  const cutByCatchment = [];
  let noCentroid = 0;

  for (const f of raw) {
    const c = centroid(f.geometry);
    if (!c) { noCentroid++; continue; }
    if (c[0] >= BEACHY_HEAD_LON) { cutByHeadland.push(f); continue; }
    if (!boundary.contains(c)) { cutByCatchment.push(f); continue; }
    westOfCutoff.push(f);
  }

  console.log('\n  filters, in the documented order (all on the frontage CENTROID):');
  console.log(`     ${String(raw.length).padStart(5)}  returned for the fetch bbox`);
  console.log(`     ${String(raw.length - cutByHeadland.length - noCentroid).padStart(5)}  and west of the Beachy Head cutoff (${BEACHY_HEAD_LON}°E)`);
  console.log(`     ${String(westOfCutoff.length).padStart(5)}  and inside the catchment boundary  ← kept`);
  if (noCentroid) console.log(`     ! ${noCentroid} frontage(s) had no usable geometry — dropped`);

  const bySmp = (list) => {
    const m = new Map();
    for (const f of list) {
      const k = f.properties?.smp_name || '(no SMP name)';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  console.log(`\n  ${cutByHeadland.length} cut by the headland — Shoreline Management Plan areas:`);
  for (const [k, v] of bySmp(cutByHeadland)) console.log(`     − ${String(v).padStart(4)}  ${k}`);
  console.log(`\n  ${cutByCatchment.length} cut by the catchment boundary. This is the north Cornwall / north Devon`);
  console.log('    and Bristol Channel coast — the bbox reaches round Land\'s End, the same');
  console.log('    over-coverage the vessel density and marine licensing layers hit:');
  for (const [k, v] of bySmp(cutByCatchment)) console.log(`     − ${String(v).padStart(4)}  ${k}`);

  // ------------------------------------------------------------- normalise
  const dist = [];
  let emptyDef = 0, emptySmp = 0;
  const collection = {
    type: 'FeatureCollection',
    features: westOfCutoff.map((f) => {
      const p = f.properties ?? {};
      const d = Number(p[FIELD]) || 0;
      dist.push(d);
      const smp = (p.smp_name ?? '').trim();
      // def_type is EMPTY for a large share of frontages. Empty means the field
      // is not populated — NOT that the frontage is undefended. It is carried
      // through as null and the card says so in words.
      //
      // AND WHERE IT IS POPULATED, IT IS PASSED ON AS PUBLISHED. def_type
      // carries "Sheet piles" on 81 frontages and "Sheet Piles" on 21 — the
      // same defence type, entered two ways. There are compound values too
      // ("Natural (Vertical Wall - Concrete)"), one frontage each.
      //
      // The obvious tidy-up is to fold the casings together. It is declined
      // here. EA published both spellings, so normalising means deciding which
      // one is canonical, and that is a judgement the register does not make —
      // there is nothing in the source saying one is the correct form and the
      // other a mistake. Picking one would present a decision of ours as if it
      // were EA's. Only `.trim()` is applied: whitespace is not a spelling.
      //
      // Same principle as the truncated site names in
      // scripts/fetch-storm-overflows.mjs, where the EA consents database cuts
      // the name field at 35 characters. In both places the source is untidy,
      // in both places the tidy version would be partly invented, and in both
      // places this repo passes the untidy original through. Where the source
      // disagrees with itself or cuts itself short, that is a fact about the
      // register and it survives the build.
      const def = (p.def_type ?? '').trim();
      if (!def) emptyDef++;
      if (!smp) emptySmp++;
      return {
        type: 'Feature',
        properties: { risk: band(d), dist: Math.round(d), smp: smp || null, def: def || null },
        geometry: f.geometry,
      };
    }),
  };

  console.log(`\n  kept frontages by Shoreline Management Plan area:`);
  for (const [k, v] of bySmp(westOfCutoff)) console.log(`     ${String(v).padStart(4)}  ${k}`);

  const byBand = {};
  collection.features.forEach((f) => { byBand[f.properties.risk] = (byBand[f.properties.risk] || 0) + 1; });
  const sorted = dist.slice().sort((a, b) => a - b);
  console.log(`\n  projected recession to 2055: median ${sorted[Math.floor(sorted.length / 2)].toFixed(0)} m, max ${Math.max(...dist).toFixed(0)} m`);
  console.log('  by risk band:');
  for (let b = 0; b <= 4; b++) console.log(`     ${b} ${BAND_LABEL[b]}: ${byBand[b] || 0}`);

  const defs = new Map();
  for (const f of collection.features) {
    const k = f.properties.def ?? '(not populated)';
    defs.set(k, (defs.get(k) ?? 0) + 1);
  }
  console.log(`\n  defence type (def_type) — ${emptyDef} of ${collection.features.length} are NOT POPULATED (${(100 * emptyDef / collection.features.length).toFixed(0)}%):`);
  for (const [k, v] of [...defs].sort((a, b) => b[1] - a[1])) console.log(`     ${String(v).padStart(4)}  ${k}`);
  if (emptySmp) console.log(`\n  ! ${emptySmp} frontage(s) have no smp_name — the card falls back to the risk band`);

  // ---------------------------------------------------------------- simplify
  // No bbox clip. Membership is already decided on real geometry by the two
  // filters above, and clipping would slice erosion zones at an arbitrary
  // rectangle edge. Overhang past the fetch box is reported instead.
  const commands =
    `-i in.geojson -simplify 10% keep-shapes -clean ` +
    `-o precision=0.00001 format=geojson out.geojson`;
  const result = await mapshaper.applyCommands(commands, { 'in.geojson': JSON.stringify(collection) });

  /*
   * DROP SLIVERS THAT SIMPLIFICATION COLLAPSED.
   *
   * A handful of very small frontages lose all geometry at 10% and cannot be
   * drawn or hovered — they are not on the map, so counting them would overstate
   * coverage. They are dropped rather than shipped as phantom features, and
   * listed below so the loss is visible. Tested: `-clean` is not the cause, and
   * 20% simplification still loses most of them for 57% more file size. Every
   * one is risk band 0 with zero projected recession.
   */
  const simplified = JSON.parse(result['out.geojson']);
  const collapsed = simplified.features.filter((f) => !f.geometry);
  simplified.features = simplified.features.filter((f) => f.geometry);
  const out = JSON.stringify(simplified);
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, out);
  if (collapsed.length) {
    console.log(`\n  ${collapsed.length} frontage(s) collapsed to nothing at 10% simplification and were DROPPED`);
    console.log('    (all risk band 0, zero projected recession — they would draw nothing):');
    const byS = new Map();
    for (const f of collapsed) byS.set(f.properties.smp ?? '(no SMP name)', (byS.get(f.properties.smp ?? '(no SMP name)') ?? 0) + 1);
    for (const [k, v] of byS) console.log(`     − ${v}  ${k}`);
  }

  const parsed = JSON.parse(out);
  const nullGeom = parsed.features.filter((f) => !f.geometry);
  const nOut = parsed.features.length;
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < x0) x0 = c[0]; if (c[0] > x1) x1 = c[0];
      if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1];
    } else c.forEach(walk);
  };
  parsed.features.forEach((f) => f.geometry && walk(f.geometry.coordinates));
  console.log(`\n  written extent [W,S,E,N] = ${x0.toFixed(3)}, ${y0.toFixed(3)}, ${x1.toFixed(3)}, ${y1.toFixed(3)}`);
  console.log(`  fetch bbox      [W,S,E,N] = ${SOUTH_COAST_BBOX.join(', ')}`);
  const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
  console.log(`\nWrote ${OUT} — ${nOut} features, ${kb} KB.`);
}

main().catch((err) => {
  console.error('\nFailed to build NCERM data:', err.message);
  process.exit(1);
});
