/**
 * Fetch Provisional Agricultural Land Classification (ALC) polygons covering all
 * of Dorset from Natural England's open ArcGIS service, clip to the Dorset LNRS
 * area, simplify (topology-preserving), and bundle at public/data/alc.geojson.
 *
 * Run with: npm run data:alc
 *
 * The ALC grades farmland 1 (excellent) → 5 (very poor), plus non-agricultural
 * classes (Non Agricultural / Urban / Exclusion). We keep a single short `g`
 * property: 1–5 for the grades, 0 for everything non-agricultural.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import mapshaper from 'mapshaper';
import { DORSET_BBOX, loadMaskString } from './lib/dorset.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, '../public/data/alc.geojson');

const SERVICE =
  'https://services.arcgis.com/JJzESW51TqeY9uat/arcgis/rest/services/' +
  'Provisional Agricultural Land Classification (ALC) (England)/FeatureServer/0/query';

const PAGE_SIZE = 1000; // = the service maxRecordCount

// ALC_GRADE string → short grade code (1–5 farmland grades, 0 = non-agricultural).
const GRADE_CODE = {
  'Grade 1': 1, 'Grade 2': 2, 'Grade 3': 3, 'Grade 4': 4, 'Grade 5': 5,
  'Non Agricultural': 0, Urban: 0, Exclusion: 0,
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
  console.log(`  ${total} ALC features intersect the Dorset bbox; paging…`);

  const features = [];
  for (let offset = 0; offset < total; offset += PAGE_SIZE) {
    const json = await getJson(
      baseParams({
        outSR: '4326',
        outFields: 'ALC_GRADE',
        returnGeometry: 'true',
        geometryPrecision: '6',
        resultOffset: String(offset),
        resultRecordCount: String(PAGE_SIZE),
        f: 'geojson',
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
  console.log('Fetching Provisional ALC polygons across Dorset…');
  const { features, total } = await fetchAll();

  // Normalise to a single `g` code; report the breakdown.
  const byGrade = {};
  const collection = {
    type: 'FeatureCollection',
    features: features.map((f) => {
      const grade = f.properties?.ALC_GRADE;
      const g = GRADE_CODE[grade] ?? 0;
      byGrade[grade] = (byGrade[grade] || 0) + 1;
      return { type: 'Feature', properties: { g }, geometry: f.geometry };
    }),
  };
  console.log(`\nGot ${collection.features.length}/${total}. By grade:`);
  for (const k of Object.keys(byGrade).sort()) console.log(`   ${k}: ${byGrade[k]}`);

  console.log('Clipping to Dorset & simplifying (topology-preserving)…');
  const commands =
    '-i in.geojson -simplify 12% keep-shapes -clean ' +
    '-clip mask.geojson -clean ' +
    '-o precision=0.00001 format=geojson out.geojson';
  const result = await mapshaper.applyCommands(commands, {
    'in.geojson': JSON.stringify(collection),
    'mask.geojson': await loadMaskString(),
  });

  const out = result['out.geojson'];
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, out);
  const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
  const n = JSON.parse(out).features.length;
  console.log(`Wrote ${OUT} — ${n} features, ${kb} KB.`);
}

main().catch((err) => {
  console.error('Failed to build ALC data:', err.message);
  process.exit(1);
});
