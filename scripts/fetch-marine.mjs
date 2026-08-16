/**
 * Fetch the SOUTH COAST MARINE RECOVERY PROJECT's MARINE PROTECTED AREAS —
 * Marine Conservation Zones, marine Special Areas of Conservation and coastal
 * Special Protection Areas — from Natural England / JNCC open ArcGIS services,
 * clip to the PROJECT bbox (a seaward box, NOT a land mask — that would erase
 * the sea), tag each feature with its designation TYPE + name + code, and bundle
 * at public/data/marine.geojson.
 *
 * Run with: npm run data:marine
 *
 * Selection is honest and explicit — a curated allow-list per type (by site
 * code), grouped BY COUNTY and reported on every run:
 *   • MCZ — the south-coast Marine Conservation Zones between Land's End and
 *     Beachy Head (from the full 103-site national layer). MCZs are marine by
 *     definition, so every one in the project corridor is taken; the north-coast
 *     / Bristol Channel MCZs that fall in the query box are listed separately in
 *     EXCLUDED below and reported on every run.
 *   • SAC / SPA — the genuinely MARINE / COASTAL sites, so the many dozens of
 *     inland heath, down and woodland SACs/SPAs that merely clip the box (the
 *     query box reaches ~51.1°N, well inland) are not dragged in.
 *
 * Geometry is clipped to the project box. With the box sized to contain every
 * allow-listed site whole (see SOUTH_COAST_BBOX), the clip is a no-op on the
 * current selection and no site is cut off at a box edge.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import mapshaper from 'mapshaper';
import { SOUTH_COAST_BBOX } from './lib/southcoast.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, '../public/data/marine.geojson');

const ORG = 'https://services.arcgis.com/JJzESW51TqeY9uat/arcgis/rest/services';

// South Coast Marine Recovery Project bounding box, Land's End to Beachy Head,
// extended seaward (south): [W, S, E, N].
//
// The brief's rough box was [-5.8, 49.9, 0.6, 51.1]. It is widened slightly at
// the west and south so that every allow-listed site sits WHOLLY inside it and
// nothing is cut off at a box edge:
//   • W -5.8 → -6.2  — Cape Bank MCZ reaches -6.099, Lands End and Cape Bank
//                      SAC reaches -5.975 (the offshore Land's End sites).
//   • S 49.9 → 49.85 — Lizard Point SAC reaches 49.896.
// East (0.6) and north (51.1) are unchanged: the easternmost selected site,
// Beachy Head East MCZ, ends at 0.572; the northernmost, Solent & Southampton
// Water SPA, at 50.938.
//
// The value now lives in scripts/lib/southcoast.mjs so every fetch script clips
// to exactly the same box; the reasoning above is what sized it.

const PAGE_SIZE = 1000;

// The three sources. Each carries a curated allow-list grouped by county, so the
// per-county breakdown is a property of the config rather than a guess.
const SOURCES = [
  {
    type: 'MCZ',
    typeLabel: 'Marine Conservation Zone',
    service: 'Marine_Conservation_Zones_(Natural_England)',
    nameField: 'mcz_name',
    codeField: 'mcz_code',
    regions: {
      Cornwall: [
        'UKMCZ0076', // Cape Bank (offshore, south-west approaches)
        'UKMCZ0038', // Runnel Stone (Land's End)
        'UKMCZ0036', // Mounts Bay
        'UKMCZ0062', // Helford Estuary
        'UKMCZ0018', // The Manacles
        'UKMCZ0020', // Upper Fowey and Pont Pill
        'UKMCZ0021', // Whitsand and Looe Bay
        'UKMCZ0016', // Tamar Estuary Sites (Cornwall/Devon border)
      ],
      Devon: [
        'UKMCZ0059', // Erme Estuary
        'UKMCZ0058', // Devon Avon Estuary
        'UKMCZ0015', // Skerries Bank and Surrounds
        'UKMCZ0057', // Dart Estuary
        'UKMCZ0019', // Torbay
        'UKMCZ0077', // East of Start Point
        'UKMCZ0065', // Otter Estuary
        'UKMCZ0052', // Axe Estuary
      ],
      Dorset: [
        'UKMCZ0004', // Chesil Beach and Stennis Ledges
        'UKMCZ0070', // South of Portland
        'UKMCZ0022', // South Dorset
        'UKMCZ0066', // Purbeck Coast
        'UKMCZ0072', // Studland Bay
        'UKMCZ0014', // Poole Rocks
        'UKMCZ0071', // Southbourne Rough
      ],
      'Hampshire & Isle of Wight': [
        'UKMCZ0091', // West of Wight-Barfleur (offshore)
        'UKMCZ0051', // Albert Field (offshore)
        'UKMCZ0040', // The Needles
        'UKMCZ0075', // Yarmouth to Cowes
        'UKMCZ0054', // Bembridge
        'UKMCZ0042', // Utopia (offshore)
        'UKMCZ0044', // Offshore Overfalls
      ],
      Sussex: [
        'UKMCZ0049', // Offshore Brighton
        'UKMCZ0068', // Selsey Bill and the Hounds
        'UKMCZ0013', // Pagham Harbour
        'UKMCZ0009', // Kingmere
        'UKMCZ0002', // Beachy Head West
        'UKMCZ0053', // Beachy Head East
      ],
    },
    // In the query box but OUTSIDE the Land's End → Beachy Head corridor: the
    // north Cornwall / north Devon / Bristol Channel MCZs. Move a code up into
    // `regions` to bring a site in.
    excluded: {
      'UKMCZ0029': 'Bideford to Foreland Point — north Devon, Bristol Channel',
      'UKMCZ0034': 'Hartland Point to Tintagel — north Cornwall/Devon',
      'UKMCZ0056': 'Camel Estuary — north Cornwall',
      'UKMCZ0012': 'Padstow Bay and Surrounds — north Cornwall',
      'UKMCZ0037': 'Newquay and the Gannel — north Cornwall',
      'UKMCZ0083': 'South-West Approaches to Bristol Channel — north-west, offshore',
    },
  },
  {
    type: 'SAC',
    typeLabel: 'Special Area of Conservation',
    service: 'Special_Areas_of_Conservation_England',
    nameField: 'SAC_NAME',
    codeField: 'SAC_CODE',
    regions: {
      Cornwall: [
        'UK0030375', // Lands End and Cape Bank (marine)
        'UK0030374', // Lizard Point (marine)
        'UK0013112', // Fal & Helford (marine/estuarine)
        'UK0030241', // Polruan to Polperro (vegetated sea cliffs)
      ],
      Devon: [
        'UK0013111', // Plymouth Sound & Estuaries (marine)
        'UK0030373', // Start Point to Plymouth Sound & Eddystone (marine)
        'UK0030091', // Blackstone Point (coastal)
        'UK0030060', // South Devon Shore Dock (coastal cliff)
        'UK0030130', // Dawlish Warren (coastal dunes)
      ],
      Dorset: [
        'UK0030372', // Lyme Bay and Torbay (marine — spans Devon/Dorset)
        'UK0019864', // Sidmouth to West Bay (coastal cliffs)
        'UK0017076', // Chesil & The Fleet
        'UK0030382', // Studland to Portland (marine)
        'UK0019861', // Isle of Portland to Studland Cliffs
        'UK0019863', // St Albans Head to Durlston Head
      ],
      'Hampshire & Isle of Wight': [
        'UK0030380', // Wight-Barfleur Reef (offshore marine)
        'UK0030061', // South Wight Maritime (marine)
        'UK0030059', // Solent Maritime (marine/estuarine)
        'UK0017073', // Solent & Isle of Wight Lagoons (coastal lagoons)
      ],
      // No marine/coastal SAC in the Sussex stretch of the corridor: the nearest,
      // Hastings Cliffs (UK0030165, 0.599–0.659°E), lies EAST of Beachy Head and
      // so sits outside the project corridor — see `excluded`.
      Sussex: [],
    },
    // Marine/coastal but outside the corridor, plus the notable near-misses that
    // are terrestrial rather than marine. The many purely inland SACs in the
    // query box (Dartmoor, Salisbury Plain, New Forest, Ashdown Forest, the
    // Dorset Heaths, …) are simply absent from the allow-list.
    excluded: {
      'UK0030165': 'Hastings Cliffs — coastal, but east of Beachy Head (outside corridor)',
      'UK0030396': 'Bristol Channel Approaches — marine, but north-west (outside corridor)',
      'UK0012799': 'The Lizard — terrestrial heathland, not a marine site',
      'UK0030038': 'Dorset Heaths (Purbeck & Wareham) & Studland Dunes — chiefly heathland',
      'UK0030367': 'Pevensey Levels — coastal grazing marsh, freshwater not marine',
      'UK0012549': 'Godrevy Head to St Agnes — north Cornwall coast',
      'UK0012559': 'Penhale Dunes — north Cornwall coast',
      'UK0012570': 'Braunton Burrows — north Devon coast',
      'UK0013047': 'Tintagel-Marsland-Clovelly Coast — north Cornwall/Devon coast',
    },
  },
  {
    type: 'SPA',
    typeLabel: 'Special Protection Area',
    service: 'Special_Protection_Areas_England',
    nameField: 'SPA_NAME',
    codeField: 'SPA_CODE',
    regions: {
      Cornwall: [
        'UK9020289', // Marazion Marsh (coastal marsh, Mount's Bay)
        'UK9020323', // Falmouth Bay to St Austell Bay (marine)
      ],
      Devon: [
        'UK9010141', // Tamar Estuaries Complex (Cornwall/Devon border)
        'UK9010081', // Exe Estuary
      ],
      Dorset: [
        'UK9010091', // Chesil Beach & the Fleet
        'UK9010111', // Poole Harbour
        'UK9020330', // Solent and Dorset Coast (marine — spans Dorset to Sussex)
      ],
      'Hampshire & Isle of Wight': [
        'UK9011061', // Solent & Southampton Water
        'UK9011051', // Portsmouth Harbour
        'UK9011011', // Chichester and Langstone Harbours (Hants/Sussex border)
      ],
      Sussex: [
        'UK9012041', // Pagham Harbour
      ],
    },
    excluded: {
      'UK9012091': 'Dungeness, Romney Marsh and Rye Bay — coastal, but east of Beachy Head',
      'UK9010031': 'Somerset Levels & Moors — inland, Bristol Channel catchment',
    },
  },
];

// Flatten a source's per-county allow-list into the query code list.
const allCodes = (src) => Object.values(src.regions).flat();

function baseParams(extra) {
  return new URLSearchParams({
    geometry: SOUTH_COAST_BBOX.join(','),
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
  const codes = allCodes(src);
  const where = codes.length ? inList(src.codeField, codes) : src.where;
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
  const seenCodes = new Set();
  const out = features.map((f) => {
    const name = f.properties?.[src.nameField] || src.typeLabel;
    const code = f.properties?.[src.codeField] || '';
    names.add(name);
    seenCodes.add(code);
    return { type: 'Feature', properties: { mtype: src.type, name, code }, geometry: f.geometry };
  });

  // Any allow-listed code the service did not return is a silent hole — say so.
  const missing = codes.filter((c) => !seenCodes.has(c));
  return { type: src.type, features: out, names: [...names].sort(), missing, codes };
}

async function main() {
  console.log('Fetching South Coast marine protected areas (MCZ / marine SAC / coastal SPA)…');
  console.log(`  project bbox [W,S,E,N] = ${SOUTH_COAST_BBOX.join(', ')}`);

  const results = [];
  for (const src of SOURCES) {
    const r = await fetchSource(src);
    results.push(r);
    console.log(`\n  ${r.type}: ${r.features.length} feature(s), ${r.names.length} site(s):`);
    for (const [county, codes] of Object.entries(src.regions)) {
      console.log(`     ${county}: ${codes.length}`);
    }
    for (const n of r.names) console.log(`     • ${n}`);
    if (r.missing.length) console.log(`     ! allow-listed but NOT returned: ${r.missing.join(', ')}`);
    const ex = Object.entries(src.excluded ?? {});
    if (ex.length) {
      console.log(`     excluded (in box, deliberately left out):`);
      for (const [code, why] of ex) console.log(`       – ${code}  ${why}`);
    }
  }

  const collection = {
    type: 'FeatureCollection',
    features: results.flatMap((r) => r.features),
  };

  // Clip to the project box (NOT a land mask) + light simplify.
  // NB: no -clean. These designations overlap heavily BY DESIGN (e.g. Poole
  // Rocks MCZ sits inside the Studland-to-Portland SAC), and -clean treats the
  // small contained polygon as a sliver and deletes it. We keep every overlap.
  console.log('\nClipping to project bbox & simplifying (overlaps preserved)…');
  const [w, s, e, n] = SOUTH_COAST_BBOX;
  const commands =
    `-i in.geojson -simplify 6% keep-shapes ` +
    `-clip bbox=${w},${s},${e},${n} ` +
    `-o precision=0.0001 format=geojson out.geojson`;
  const result = await mapshaper.applyCommands(commands, { 'in.geojson': JSON.stringify(collection) });

  const out = result['out.geojson'];
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, out);

  // Report the true clipped extent — it drives the map's maxBounds.
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

  // Features the simplifier collapsed to nothing — worth knowing about.
  const empty = fc.features.filter((f) => !f.geometry).length;

  const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
  console.log(`\nWrote ${OUT} — ${fc.features.length} features, ${kb} KB.`);
  if (empty) console.log(`  note: ${empty} feature(s) simplified away to null geometry.`);
  console.log(`Clipped extent: S ${ymin.toFixed(3)}  N ${ymax.toFixed(3)}  W ${xmin.toFixed(3)}  E ${xmax.toFixed(3)}`);
  console.log(`→ maxBounds must contain W ${xmin.toFixed(3)} / S ${ymin.toFixed(3)} / E ${xmax.toFixed(3)} / N ${ymax.toFixed(3)} to view all sites.`);
}

main().catch((err) => {
  console.error('Failed to build marine data:', err.message);
  process.exit(1);
});
