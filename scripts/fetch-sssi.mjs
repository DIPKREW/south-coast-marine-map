/**
 * Fetch SSSI boundary polygons covering the whole of Dorset from Natural
 * England's open ArcGIS service, clip to the Dorset LNRS area, simplify, and
 * bundle the result at public/data/sssi.geojson.
 *
 * Run with: npm run data:sssi
 *
 * Re-run any time to refresh from source. The output is committed to the repo
 * so the app runs out of the box without a network round-trip.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import mapshaper from 'mapshaper';
import { DORSET_BBOX, loadMaskString } from './lib/dorset.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, '../public/data/sssi.geojson');

// Natural England — "Sites of Special Scientific Interest (England)".
const SERVICE =
  'https://services.arcgis.com/JJzESW51TqeY9uat/arcgis/rest/services/SSSI_England/FeatureServer/0/query';

// Properties worth keeping; everything else is dropped to slim the file.
const FIELDS = ['NAME', 'REF_CODE', 'MEASURE'];

const PAGE_SIZE = 1000; // = the service maxRecordCount

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
  // Ask the server how many features match, then page until we have them all —
  // robust against maxRecordCount capping (don't infer "done" from page size).
  const { count: total } = await getJson(baseParams({ returnCountOnly: 'true', f: 'json' }));
  console.log(`  ${total} SSSI features intersect the Dorset bbox; paging…`);

  const features = [];
  for (let offset = 0; offset < total; offset += PAGE_SIZE) {
    const json = await getJson(
      baseParams({
        outSR: '4326',
        outFields: FIELDS.join(','),
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
    if (batch.length === 0) break; // safety: server returned nothing further
  }

  if (features.length < total) {
    throw new Error(`Incomplete fetch: got ${features.length} of ${total} features`);
  }
  return { collection: { type: 'FeatureCollection', features }, total };
}

async function main() {
  console.log('Fetching SSSI polygons across Dorset…');
  const { collection, total } = await fetchAll();
  console.log(`\nGot ${collection.features.length}/${total} sites. Clipping to Dorset & simplifying…`);

  // Simplify first (so linework is light), then clip to the LNRS boundary LAST
  // so the county/coast edge is exactly the shared mask edge.
  const commands =
    '-i in.geojson -simplify 14% keep-shapes ' +
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
  console.error('Failed to build SSSI data:', err.message);
  process.exit(1);
});
