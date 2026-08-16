/**
 * Fetch Dorset's MARINE PROTECTED AREAS — Marine Conservation Zones, marine
 * Special Areas of Conservation and coastal Special Protection Areas — from
 * Natural England / JNCC open ArcGIS services, clip to the DORSET COASTAL bbox
 * (a seaward box, NOT the land mask — that would erase the sea), tag each feature
 * with its designation TYPE + name + code, and bundle at public/data/marine.geojson.
 *
 * Run with: npm run data:marine
 *
 * Selection is honest and explicit — a curated allow-list per type (by site
 * code), reported on every run:
 *   • MCZ — the Dorset Marine Conservation Zones (from the full 103-site national
 *     layer), excluding the Isle of Wight / Devon offshore MCZs that merely clip
 *     the box's eastern/western edge.
 *   • SAC / SPA — the genuinely MARINE / COASTAL sites, so the dozens of inland
 *     heath SACs/SPAs that merely clip the box are not dragged in.
 *
 * Geometry is clipped to the coastal box, so any inland/eastward tails are
 * trimmed to the mapped sea area.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import mapshaper from 'mapshaper';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, '../public/data/marine.geojson');

const ORG = 'https://services.arcgis.com/JJzESW51TqeY9uat/arcgis/rest/services';

// Dorset COASTAL bounding box, extended seaward (south): [W, S, E, N]. Captures
// Lyme Bay (west), Poole Bay (east) and the offshore sites to the south.
const COASTAL_BBOX = [-3.3, 50.1, -1.4, 50.85];

const PAGE_SIZE = 1000;

// The three sources. MCZ: take all in-bbox. SAC/SPA: curated marine/coastal codes.
const SOURCES = [
  {
    type: 'MCZ',
    typeLabel: 'Marine Conservation Zone',
    service: 'Marine_Conservation_Zones_(Natural_England)',
    nameField: 'mcz_name',
    codeField: 'mcz_code',
    // The Dorset MCZs (the IoW/Devon offshore MCZs clipping the box are excluded).
    codes: [
      'UKMCZ0072', // Studland Bay
      'UKMCZ0014', // Poole Rocks
      'UKMCZ0022', // South Dorset
      'UKMCZ0004', // Chesil Beach and Stennis Ledges
      'UKMCZ0066', // Purbeck Coast
      'UKMCZ0070', // South of Portland
      'UKMCZ0071', // Southbourne Rough
    ],
  },
  {
    type: 'SAC',
    typeLabel: 'Special Area of Conservation',
    service: 'Special_Areas_of_Conservation_England',
    nameField: 'SAC_NAME',
    codeField: 'SAC_CODE',
    // Marine / coastal SACs off Dorset (the inland heath/down SACs are excluded).
    codes: [
      'UK0030372', // Lyme Bay and Torbay
      'UK0030382', // Studland to Portland
      'UK0017076', // Chesil & The Fleet
      'UK0019861', // Isle of Portland to Studland Cliffs
      'UK0019863', // St Albans Head to Durlston Head
      'UK0019864', // Sidmouth to West Bay
      'UK0030059', // Solent Maritime
    ],
  },
  {
    type: 'SPA',
    typeLabel: 'Special Protection Area',
    service: 'Special_Protection_Areas_England',
    nameField: 'SPA_NAME',
    codeField: 'SPA_CODE',
    // Coastal / marine SPAs off Dorset.
    codes: [
      'UK9020330', // Solent and Dorset Coast
      'UK9010111', // Poole Harbour
      'UK9010091', // Chesil Beach & the Fleet
    ],
  },
];

function baseParams(extra) {
  return new URLSearchParams({
    geometry: COASTAL_BBOX.join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    ...extra,
  });
}

async function getJson(service, params) {
  const res = await fetch(`${ORG}/${service}/FeatureServer/0/query?${params}`);
  if (!res.ok) throw new Error(`ArcGIS query failed: ${res.status} ${res.statusText}`);
  return res.json();
}

// SQL IN(...) list for the code allow-lists.
const inList = (field, codes) => `${field} IN (${codes.map((c) => `'${c}'`).join(',')})`;

async function fetchSource(src) {
  const where = src.codes ? inList(src.codeField, src.codes) : src.where;
  const { count: total } = await getJson(
    src.service,
    baseParams({ where, returnCountOnly: 'true', f: 'json' }),
  );

  const features = [];
  for (let offset = 0; offset < total; offset += PAGE_SIZE) {
    const json = await getJson(
      src.service,
      baseParams({
        where,
        outSR: '4326',
        outFields: `${src.nameField},${src.codeField}`,
        returnGeometry: 'true',
        geometryPrecision: '6',
        resultOffset: String(offset),
        resultRecordCount: String(PAGE_SIZE),
        f: 'geojson',
      }),
    );
    const batch = json.features ?? [];
    features.push(...batch);
    if (batch.length === 0) break;
  }
  if (features.length < total) throw new Error(`Incomplete ${src.type} fetch: ${features.length}/${total}`);

  // Normalise: keep only type + name + code.
  const names = new Set();
  const out = features.map((f) => {
    const name = f.properties?.[src.nameField] || src.typeLabel;
    const code = f.properties?.[src.codeField] || '';
    names.add(name);
    return { type: 'Feature', properties: { mtype: src.type, name, code }, geometry: f.geometry };
  });
  return { type: src.type, features: out, names: [...names].sort() };
}

async function main() {
  console.log('Fetching Dorset marine protected areas (MCZ / marine SAC / coastal SPA)…');
  console.log(`  coastal bbox [W,S,E,N] = ${COASTAL_BBOX.join(', ')}`);

  const results = [];
  for (const src of SOURCES) {
    const r = await fetchSource(src);
    results.push(r);
    console.log(`\n  ${r.type}: ${r.features.length} feature(s), ${r.names.length} site(s):`);
    for (const n of r.names) console.log(`     • ${n}`);
  }

  const collection = {
    type: 'FeatureCollection',
    features: results.flatMap((r) => r.features),
  };

  // Clip to the coastal box (NOT the land mask) + light simplify. A bbox clip
  // trims any inland/eastward tails to the mapped sea area.
  // NB: no -clean. These designations overlap heavily BY DESIGN (e.g. Poole
  // Rocks MCZ sits inside the Studland-to-Portland SAC), and -clean treats the
  // small contained polygon as a sliver and deletes it. We keep every overlap.
  console.log('\nClipping to coastal bbox & simplifying (overlaps preserved)…');
  const [w, s, e, n] = COASTAL_BBOX;
  const commands =
    `-i in.geojson -simplify 6% keep-shapes ` +
    `-clip bbox=${w},${s},${e},${n} ` +
    `-o precision=0.0001 format=geojson out.geojson`;
  const result = await mapshaper.applyCommands(commands, { 'in.geojson': JSON.stringify(collection) });

  const out = result['out.geojson'];
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, out);

  // Report the true clipped extent — the southern edge drives the map's maxBounds.
  const fc = JSON.parse(out);
  let ymin = 90, ymax = -90, xmin = 180, xmax = -180;
  const walk = (g) => {
    if (!g) return;
    if (typeof g[0] === 'number') {
      xmin = Math.min(xmin, g[0]); xmax = Math.max(xmax, g[0]);
      ymin = Math.min(ymin, g[1]); ymax = Math.max(ymax, g[1]);
    } else g.forEach(walk);
  };
  fc.features.forEach((f) => walk(f.geometry?.coordinates));
  const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
  console.log(`\nWrote ${OUT} — ${fc.features.length} features, ${kb} KB.`);
  console.log(`Clipped extent: S ${ymin.toFixed(3)}  N ${ymax.toFixed(3)}  W ${xmin.toFixed(3)}  E ${xmax.toFixed(3)}`);
  console.log(`→ maxBounds south edge must sit at/below ${ymin.toFixed(3)} to view all sites.`);
}

main().catch((err) => {
  console.error('Failed to build marine data:', err.message);
  process.exit(1);
});
