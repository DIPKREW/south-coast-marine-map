/**
 * Fetch the Post-1988 (detailed / resurveyed) Agricultural Land Classification
 * for Dorset from Natural England's open ArcGIS service, clip to the Dorset LNRS
 * area, simplify, and bundle at public/data/alc-post1988.geojson.
 *
 * Run with: npm run data:alc-post1988
 *
 * Unlike the coarse Provisional ALC, this carries the finer grades 3a/3b and is
 * PATCHY (only resurveyed areas, often near development). We keep ONLY the graded
 * polygons (1, 2, 3a, 3b, 4, 5) — where it has 'Other'/'Not Surveyed' we drop the
 * polygon so the provisional wash beneath shows through.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import mapshaper from 'mapshaper';
import { DORSET_BBOX, loadMaskString } from './lib/dorset.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, '../public/data/alc-post1988.geojson');

const SERVICE =
  'https://services.arcgis.com/JJzESW51TqeY9uat/arcgis/rest/services/' +
  'Agricultural_Land_Classification_Post_1988/FeatureServer/0/query';

const PAGE_SIZE = 1000;

// ALC_GRADE string → short grade code; non-graded values are dropped.
const GRADE = {
  'Grade 1': '1', 'Grade 2': '2', 'Grade 3a': '3a', 'Grade 3b': '3b', 'Grade 4': '4', 'Grade 5': '5',
};

function baseParams(extra) {
  return new URLSearchParams({
    where: '1=1',
    geometry: DORSET_BBOX.join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    ...extra,
  });
}

async function getJson(params) {
  const res = await fetch(`${SERVICE}?${params}`);
  if (!res.ok) throw new Error(`ArcGIS query failed: ${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchAll() {
  const { count: total } = await getJson(baseParams({ returnCountOnly: 'true', f: 'json' }));
  console.log(`  ${total} Post-1988 ALC features intersect the Dorset bbox; paging…`);
  const features = [];
  for (let offset = 0; offset < total; offset += PAGE_SIZE) {
    const json = await getJson(
      baseParams({
        outSR: '4326', outFields: 'ALC_GRADE', returnGeometry: 'true', geometryPrecision: '6',
        resultOffset: String(offset), resultRecordCount: String(PAGE_SIZE), f: 'geojson',
      }),
    );
    const batch = json.features ?? [];
    features.push(...batch);
    process.stdout.write(`  fetched ${features.length}/${total} features\r`);
    if (batch.length === 0) break;
  }
  if (features.length < total) throw new Error(`Incomplete fetch: got ${features.length} of ${total}`);
  return { features, total };
}

async function main() {
  console.log('Fetching Post-1988 ALC across Dorset…');
  const { features, total } = await fetchAll();

  const byGrade = {};
  const graded = [];
  for (const f of features) {
    const g = GRADE[f.properties?.ALC_GRADE];
    byGrade[f.properties?.ALC_GRADE] = (byGrade[f.properties?.ALC_GRADE] || 0) + 1;
    if (g) graded.push({ type: 'Feature', properties: { grade: g }, geometry: f.geometry });
  }
  console.log(`\nGot ${features.length}/${total}. By grade:`);
  for (const k of Object.keys(byGrade).sort()) console.log(`   ${k}: ${byGrade[k]}`);
  console.log(`  keeping ${graded.length} graded polygons (dropping Other / Not Surveyed).`);

  console.log('Clipping to Dorset & simplifying…');
  const commands =
    '-i in.geojson -simplify 16% keep-shapes -clean -clip mask.geojson -clean ' +
    '-o precision=0.00001 format=geojson out.geojson';
  const result = await mapshaper.applyCommands(commands, {
    'in.geojson': JSON.stringify({ type: 'FeatureCollection', features: graded }),
    'mask.geojson': await loadMaskString(),
  });
  const out = result['out.geojson'];
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, out);
  const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
  const n = JSON.parse(out).features.length;
  console.log(`Wrote ${OUT} — ${n} graded features, ${kb} KB.`);
}

main().catch((err) => {
  console.error('Failed to build Post-1988 ALC:', err.message);
  process.exit(1);
});
