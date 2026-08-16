/**
 * Build the "Field crops (CROME)" layer for Dorset from the Crop Map of England
 * 2024 (Rural Payments Agency, OGL v3.0), as vector tiles (public/data/crome.pmtiles).
 *
 * Run with: npm run data:crome   (needs `tippecanoe` on PATH)
 *
 * CROME is ~0.41 ha hexagons — 641k for Dorset (the "DOR" ceremonial county).
 * That's far too many to render raw, so the pipeline is:
 *   1. Fetch the Dorset collection from Defra's OGC API - Features (paged), mapping
 *      each hexagon's `lucode` to ONE of a small set of muted categories.
 *   2. DISSOLVE adjacent hexagons of the same category into field-block polygons
 *      (mapshaper -dissolve2) — essential; we never render raw hexes.
 *   3. Simplify topology-preservingly, then tile with tippecanoe.
 * STRUCTURAL: the only fills are the dissolved crop polygons — no ocean/background
 * fill is introduced.
 */
import { createWriteStream } from 'node:fs';
import { writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, '../public/data/crome.pmtiles');
const RAW = '/tmp/dnm-crome-raw.geojson';
const DISS = '/tmp/dnm-crome-dissolved.geojson';
const MAPSHAPER = resolve(__dir, '../node_modules/mapshaper/bin/mapshaper');

const OGC =
  'https://environment.data.gov.uk/spatialdata/crop-map-of-england-2024/ogc/features/v1' +
  '/collections/Crop_Map_of_England_2024_Dorset/items?limit=20000&f=json';
const UA = 'dorset-nature-map/1.0 (data build; contact benthorne77@gmail.com)';

// CROME LUCODE → one of six muted display categories (per the CROME spec lookup).
const CAT = {};
const add = (cat, codes) => codes.forEach((c) => (CAT[c] = cat));
add('cereals', ['AC01', 'AC06', 'AC18', 'AC19', 'AC24', 'AC30', 'AC32', 'AC63', 'AC65', 'AC66', 'AC68', 'AC69', 'AC92']);
add('oilseed', ['AC04', 'AC05', 'AC16', 'AC36', 'AC37', 'AC38', 'AC64', 'AC67', 'AC71', 'AC72', 'AC74', 'AC76', 'AC77', 'AC81', 'AC85', 'AC88', 'AC90', 'AC94', 'CA02',
  'LG01', 'LG02', 'LG03', 'LG04', 'LG06', 'LG07', 'LG08', 'LG09', 'LG11', 'LG13', 'LG14', 'LG15', 'LG16', 'LG18', 'LG20', 'LG21']);
add('rootmaize', ['AC03', 'AC07', 'AC08', 'AC09', 'AC10', 'AC11', 'AC14', 'AC15', 'AC17', 'AC20', 'AC22', 'AC23', 'AC26', 'AC27', 'AC34', 'AC35', 'AC41', 'AC44', 'AC45', 'AC50', 'AC52', 'AC54', 'AC70']);
add('grass', ['PG01', 'TG01', 'FA01', 'AC100']);
add('trees', ['WO12', 'TC01', 'SR01', 'NU01']);
add('other', ['NA01', 'WA00', 'AC00', 'HE02', 'AC58', 'AC59', 'AC60', 'AC61', 'AC62']);
const categoryOf = (lucode) => CAT[lucode] || 'other';

async function fetchAll() {
  const out = createWriteStream(RAW);
  out.write('{"type":"FeatureCollection","features":[\n');
  let url = OGC;
  let total = 0;
  let first = true;
  const lucodeTally = {};
  const catTally = {};
  let pages = 0;

  while (url) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/geo+json' } });
    if (!res.ok) throw new Error(`OGC API → ${res.status} ${res.statusText}`);
    const json = await res.json();
    const feats = json.features ?? [];
    for (const f of feats) {
      if (!f.geometry) continue;
      const lucode = f.properties?.lucode;
      const cat = categoryOf(lucode);
      lucodeTally[lucode] = (lucodeTally[lucode] || 0) + 1;
      catTally[cat] = (catTally[cat] || 0) + 1;
      const line = JSON.stringify({ type: 'Feature', properties: { cat }, geometry: f.geometry });
      out.write((first ? '' : ',\n') + line);
      first = false;
      total += 1;
    }
    pages += 1;
    process.stdout.write(`  fetched ${total} hexes (${pages} pages)\r`);
    const next = (json.links || []).find((l) => l.rel === 'next');
    url = next ? next.href + (next.href.includes('limit=') ? '' : '&limit=20000') : null;
  }
  await new Promise((r) => out.end('\n]}\n', r));
  return { total, lucodeTally, catTally };
}

async function main() {
  console.log('Fetching Dorset CROME 2024 hexagons (DOR) from Defra OGC API…');
  const { total, lucodeTally, catTally } = await fetchAll();
  console.log(`\n  ${total} hexagons fetched.`);
  console.log('  by category:', JSON.stringify(catTally));
  const unmapped = Object.keys(lucodeTally).filter((c) => !CAT[c] && c !== 'undefined');
  if (unmapped.length) console.log(`  lucodes mapped to "other" by default: ${unmapped.join(', ')}`);
  const rawMB = ((await stat(RAW)).size / 1e6).toFixed(0);
  console.log(`  raw GeoJSON: ${rawMB} MB`);

  // Dissolve same-category hexes, then EXPLODE into separate contiguous field
  // blocks (so the tiler can drop/coalesce per block — one giant per-category
  // multipolygon tiles terribly), simplify away the hex jaggedness, drop slivers.
  console.log('Dissolving adjacent hexes into field blocks (mapshaper)…');
  await run(
    'node',
    ['--max-old-space-size=8192', MAPSHAPER, RAW,
      '-dissolve2', 'fields=cat',
      '-explode',
      '-simplify', '4%', 'keep-shapes',
      '-filter-slivers', 'min-area=3000',
      '-clean',
      '-o', DISS, 'precision=0.00001', 'format=geojson'],
    { maxBuffer: 1 << 30 },
  );
  const dissMB = ((await stat(DISS)).size / 1e6).toFixed(1);
  console.log(`  dissolved field blocks: ${dissMB} MB`);

  console.log('Tiling with tippecanoe (z11–14, gated to close zoom)…');
  await mkdir(dirname(OUT), { recursive: true });
  await rm(OUT, { force: true });
  await run('tippecanoe', [
    '-o', OUT, '-l', 'crome',
    '--minimum-zoom=11', '--maximum-zoom=14',
    '--simplification=4',
    '--drop-densest-as-needed', '--coalesce', '--extend-zooms-if-still-dropping',
    '--generate-ids', '--force',
  ], { maxBuffer: 1 << 30 });
  const outMB = ((await stat(OUT)).size / 1e6).toFixed(1);
  console.log(`Wrote ${OUT} (${outMB} MB).`);
}

main().catch((err) => {
  console.error('Failed to build CROME:', err.message);
  process.exit(1);
});
