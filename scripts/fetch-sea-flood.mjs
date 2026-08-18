/**
 * Fetch SEA FLOOD RISK EXTENTS for the project corridor and bundle them at
 * public/data/sea-flood-<key>.geojson.
 *
 * Run with: npm run data:sea-flood            (all four scenarios)
 *           npm run data:sea-flood -- 200u    (one scenario)
 *
 * SOURCE
 * ------
 * Environment Agency, "Rivers and Sea defended and undefended flood risk extents
 * — climate change" (Defra Data Services Platform dataset
 * 610d6830-0637-4f5b-b6ce-61f5fa5635d3), part of NaFRA2 — the December 2024
 * national flood risk reassessment. Open Government Licence v3.0, no key.
 *
 * Delivered as VECTOR POLYGONS over OGC API Features, so there is no raster
 * processing here at all: no LIDAR tiles, no elevation thresholding, and no
 * hand-rolled connectivity analysis. The EA's own hydraulic modelling already
 * did that work, at 2 m grid resolution, with local and national flood models,
 * recorded flood outlines, and defence presence and condition folded in.
 *
 * WHAT THE SCENARIO ACTUALLY IS — the thing not to misread
 * -------------------------------------------------------
 * These are FLOOD EXTENTS under a probability and a climate allowance. They are
 * NOT a sea-level contour and NOT a claim that the land shown will be underwater.
 * Each layer answers: how far could a flood of this rarity reach, given the sea
 * level rise projected to 2125?
 *
 *   climate allowance   UKCP18 RCP 8.5, 'Upper End' for the sea
 *   epoch               2080s (2070–2125), cumulative sea level rise to 2125
 *   1 in 200            0.5% annual exceedance probability — the standard sea
 *                       planning probability
 *   1 in 1000           0.1% AEP — a rarer, more extreme event
 *   undefended          existing flood defences ignored
 *   defended            extent accounting for present defences and their condition
 *
 * THE FILTER: the source covers rivers AND sea in one layer, so every fetch is
 * constrained with CQL2 to `flood_source IN ('sea','river and sea')`. Without
 * that this would be a general flood map with the fluvial extents of five
 * counties in it, which is not what any of these toggles claim to show.
 */
import { mkdir, stat, readFile, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import mapshaper from 'mapshaper';
import { SOUTH_COAST_BBOX, BEACHY_HEAD_LON } from './lib/southcoast.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dir, '../public/data');
// Raw downloads are hundreds of MB and are NOT shipped — they stay out of
// public/ and are only inputs to the dissolve step.
const RAW_DIR = resolve(__dir, '../.cache/sea-flood');
// The South Coast catchment mask — see the note in stage 2 for why this matters
// far more for a land flood layer than for any of the sea layers.
const CATCHMENT = resolve(__dir, '../public/data/catchment-boundary.geojson');

const BASE =
  'https://environment.data.gov.uk/spatialdata/' +
  'rivers-and-sea-defended-and-undefended-flood-risk-extents-climate-change/ogc/features/v1';

const [W, S, , N] = SOUTH_COAST_BBOX;
const E = BEACHY_HEAD_LON;
const BBOX = [W, S, E, N].join(',');

// Only sea-driven flooding. 'river and sea' is kept: those are reaches where the
// two interact, which on this coastline is most of the estuaries.
const CQL = "flood_source IN ('sea','river and sea')";

const PAGE = 5000;

/*
 * SIMPLIFICATION IS TWO STAGES, and the split is deliberate.
 *
 * Dissolving 750 MB of raw polygons takes ~6 minutes, so it is done ONCE at high
 * fidelity and cached; the final thinning is then a one-second step that can be
 * retuned without paying for the dissolve again.
 *
 * The numbers, measured on the 1-in-200 undefended corridor set rather than
 * guessed — area is spherical, computed from the output itself:
 *
 *   stage 1 only (12%)      25,094 parts   1,714,701 verts   33.98 MB   712.6 km²
 *   + stage 2 at 5%          1,693 parts      93,510 verts    1.67 MB   712.4 km²  ← shipped
 *   + stage 2 at 2%          1,122 parts      42,813 verts    0.76 MB   709.7 km²
 *   + stage 2 at 1%            916 parts      25,967 verts    0.46 MB   707.1 km²
 *
 * 5% keeps 100.0% of the flooded AREA while dropping 93% of the parts. Those
 * parts are degenerate slivers left along dissolve boundaries — 23,401 of them
 * account for 0.2 km² between them. Going further starts eating real extent, so
 * this stops at the point where the saving is free.
 */
const DISSOLVE_SIMPLIFY = 12; // stage 1 — cached intermediate
const FINAL_SIMPLIFY = 5; // stage 2 — what ships

const SCENARIOS = [
  { key: '200u', collection: 'Rivers_1in100_Sea_1in200_undefended_extents_CCP1', label: '1 in 200, undefended' },
  { key: '200d', collection: 'Rivers_1in100_Sea_1in200_defended_extents_CCP1', label: '1 in 200, defended' },
  { key: '1000u', collection: 'Rivers_1in1000_Sea_1in1000_undefended_extents_CCP1', label: '1 in 1000, undefended' },
  { key: '1000d', collection: 'Rivers_1in1000_Sea_1in1000_defended_extents_CCP1', label: '1 in 1000, defended' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mb = (b) => `${(b / 1e6).toFixed(2)} MB`;

/** One page, with retry — this is a big public service and 502s happen. */
async function getPage(url, tries = 4) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/geo+json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      last = err;
      if (i === tries) break;
      const wait = 5000 * i;
      console.log(`      ${err.message} — retry ${i}/${tries - 1} in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  throw new Error(`page failed after ${tries} attempts — ${last.message}`);
}

/**
 * Download one collection to a raw file on disk.
 *
 * STREAMED, not accumulated. The first attempt built the whole FeatureCollection
 * in memory and called JSON.stringify on it, which threw "Invalid string length"
 * — 154,860 of these polygons exceed V8's maximum string size. Each feature is
 * therefore serialised on its own and appended, so nothing large is ever held as
 * one string, and mapshaper reads the FILE rather than a string.
 */
async function download({ key, collection, label }) {
  const rawPath = resolve(RAW_DIR, `${key}.geojson`);
  await mkdir(RAW_DIR, { recursive: true });

  if (!process.env.REFETCH) {
    const existing = await stat(rawPath).catch(() => null);
    if (existing?.size > 1000) {
      console.log(`  cached raw download found (${mb(existing.size)}) — set REFETCH=1 to re-download`);
      return { rawPath, raw: existing.size, matched: null, sources: null };
    }
  }

  const qs = new URLSearchParams({
    bbox: BBOX,
    limit: String(PAGE),
    'filter-lang': 'cql2-text',
    filter: CQL,
  });
  let url = `${BASE}/collections/${collection}/items?${qs}`;

  const ws = createWriteStream(rawPath);
  const write = async (s) => {
    if (!ws.write(s)) await once(ws, 'drain');
  };
  await write('{"type":"FeatureCollection","features":[');

  let matched = null;
  let n = 0;
  let page = 0;
  const sources = new Map();

  while (url) {
    const j = await getPage(url);
    if (matched == null) {
      matched = j.numberMatched;
      console.log(`  ${matched.toLocaleString('en-GB')} features match bbox + flood_source filter`);
    }
    for (const f of j.features ?? []) {
      const src = f.properties?.flood_source ?? '(none)';
      sources.set(src, (sources.get(src) ?? 0) + 1);
      // Attributes are dropped: every feature here means the same thing, and
      // -dissolve2 discards them anyway.
      await write(`${n ? ',' : ''}{"type":"Feature","properties":{},"geometry":${JSON.stringify(f.geometry)}}`);
      n++;
    }
    page++;
    if (page % 5 === 0) console.log(`    …${n.toLocaleString('en-GB')} / ${matched.toLocaleString('en-GB')}`);
    url = (j.links ?? []).find((l) => l.rel === 'next')?.href ?? null;
  }

  await write(']}');
  ws.end();
  await once(ws, 'finish');

  console.log(`  fetched ${n.toLocaleString('en-GB')} features`);
  // PROOF the filter worked, printed rather than assumed.
  console.log(`  flood_source values present: ${JSON.stringify(Object.fromEntries(sources))}`);
  if (n !== matched) throw new Error(`Incomplete fetch: ${n}/${matched}`);
  const bad = [...sources.keys()].filter((s) => s !== 'sea' && s !== 'river and sea');
  if (bad.length) throw new Error(`Filter leaked non-sea sources: ${bad.join(', ')}`);

  const { size } = await stat(rawPath);
  return { rawPath, raw: size, matched, sources: Object.fromEntries(sources) };
}

async function fetchCollection(scenario) {
  const { key, collection, label } = scenario;
  console.log(`\n━━━ ${label}  (${collection})`);

  const { rawPath, raw, matched, sources } = await download(scenario);
  console.log(`  raw download: ${mb(raw)}`);

  // ---- Stage 1: dissolve (expensive, cached) ----
  // dissolve2 merges the tens of thousands of disjoint fragments and removes the
  // internal boundaries between touching parts. File paths, not strings — see
  // the note on download().
  const midPath = resolve(RAW_DIR, `${key}-dissolved.geojson`);
  const haveMid = !process.env.REDISSOLVE && (await stat(midPath).catch(() => null))?.size > 1000;
  if (haveMid) {
    console.log(`  cached dissolve found (${mb((await stat(midPath)).size)}) — set REDISSOLVE=1 to redo`);
  } else {
    console.log('  stage 1: dissolving…');
    const t0 = Date.now();
    await mapshaper.runCommands(
      `-i "${rawPath}" -dissolve2 -simplify ${DISSOLVE_SIMPLIFY}% keep-shapes -clean -o "${midPath}" precision=0.00001 format=geojson force`,
    );
    console.log(`    ${mb((await stat(midPath)).size)} intermediate  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }

  /*
   * ---- Stage 2: CLIP to the project catchment, then thin ----
   *
   * The clip is not cosmetic. The corridor rectangle's northern edge runs along
   * 51.1°N, which on a SEA layer is harmless — the sea is to the south — but on
   * a LAND flood layer it slices straight through the Severn Estuary and the
   * Somerset Levels. Measured on the unclipped 1-in-200 output, 208 km² of 712
   * (29%) sat on the Bristol Channel side: a bigger single block than anything
   * on the actual South Coast, and nothing to do with this project's coastline.
   *
   * catchment-boundary.geojson already answers "which land belongs to the South
   * Coast" — it was built by dissolving the operational catchments and erasing a
   * buffer of the north-draining waters — so it is the right mask, and it is the
   * same boundary the storm overflow and water body layers are filtered against.
   */
  const file = resolve(OUT_DIR, `sea-flood-${key}.geojson`);
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`  stage 2: clipping to catchment + simplifying to ${FINAL_SIMPLIFY}%…`);
  await mapshaper.runCommands(
    `-i "${midPath}" -clip "${CATCHMENT}" -simplify ${FINAL_SIMPLIFY}% keep-shapes -o "${file}" precision=0.0001 format=geojson force`,
  );

  /*
   * -dissolve2 with no attributes emits a bare GeometryCollection. MapLibre will
   * draw one, but feature-state hover needs Features with ids, so the geometries
   * are wrapped into a FeatureCollection here. Each dissolved part becomes its
   * own Feature rather than one giant multipolygon: that keeps the hover
   * highlight local to the piece under the pointer instead of lighting up the
   * whole coastline.
   */
  const parsed = JSON.parse(await readFile(file, 'utf8'));
  if (!parsed.features) {
    const geoms = parsed.geometries ?? [parsed];
    const feats = [];
    for (const g of geoms) {
      if (!g) continue;
      if (g.type === 'MultiPolygon') {
        for (const coords of g.coordinates) feats.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: coords } });
      } else {
        feats.push({ type: 'Feature', properties: {}, geometry: g });
      }
    }
    await writeFile(file, JSON.stringify({ type: 'FeatureCollection', features: feats }));
    console.log(`    wrapped ${feats.length} geometries as Features`);
  }

  const { size: bytes } = await stat(file);
  console.log(`  → ${mb(bytes)} written to sea-flood-${key}.geojson`);
  return { key, label, matched, raw, bytes, sources };
}

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const list = only.length ? SCENARIOS.filter((s) => only.includes(s.key)) : SCENARIOS;

  console.log('Fetching sea flood risk extents (EA NaFRA2, climate change to 2125)…');
  console.log(`  corridor [W,S,E,N] = ${W}, ${S}, ${E}, ${N}   (east edge = Beachy Head cutoff)`);
  console.log(`  CQL2 filter: ${CQL}`);
  console.log(`  simplify: ${DISSOLVE_SIMPLIFY}% (dissolve) → ${FINAL_SIMPLIFY}% (shipped)`);

  const results = [];
  for (const s of list) results.push(await fetchCollection(s));

  console.log('\n════════ SUMMARY ════════');
  let total = 0;
  for (const r of results) {
    console.log(
      `  ${r.label.padEnd(24)} ${String(r.matched ?? 'cached').padStart(8)} feats  raw ${mb(r.raw).padStart(10)}  →  shipped ${mb(r.bytes).padStart(9)}`,
    );
    total += r.bytes;
  }
  if (results.length > 1) {
    console.log(`  ${'ALL FOUR TOGETHER'.padEnd(24)} ${''.padStart(8)}        ${''.padStart(10)}     shipped ${mb(total).padStart(9)}`);
  }
  console.log('\n  (raw downloads are cached under .cache/sea-flood and are NOT shipped)');
}

main().catch((err) => {
  console.error('Failed to build sea flood data:', err.message);
  process.exit(1);
});
