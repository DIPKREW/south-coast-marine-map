/**
 * Build the COASTAL EROSION RISK layer for Dorset from the Environment Agency's
 * National Coastal Erosion Risk Map (NCERM, 2024 publication), served as open
 * WFS from environment.data.gov.uk.
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
 * coastal defences were not maintained — the truest read of how exposed a
 * shoreline is. The field is the projected RECESSION DISTANCE in metres, which
 * we band into a low→high risk ramp. The scenario is documented in the layer's
 * about text and the README so nothing is implied beyond what the data says.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import mapshaper from 'mapshaper';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, '../public/data/ncerm.geojson');

const DATASET = 'dataset-9fede91f-5acd-4fd2-9bd8-98153fa3c2ff';
const WFS = `https://environment.data.gov.uk/geoservices/datasets/9fede91f-5acd-4fd2-9bd8-98153fa3c2ff/wfs`;
const TYPE = `${DATASET}:NCERM_NFI_2055_70CC`;
const FIELD = 'nfi2055_70'; // projected recession distance (metres) by 2055, NFI

// Dorset coast bbox (lon/lat): Lyme Regis (west) → Christchurch (east), Portland
// to the Purbeck coast. NCERM only exists along the shoreline, so a tight coast
// band suffices.
const COAST_BBOX = [-2.98, 50.5, -1.65, 50.8];
// The shared coastal box (matches the marine layer) — used for the final clip.
const COASTAL_BBOX = [-3.3, 50.1, -1.4, 50.85];

// Band the projected recession distance (m) into a 5-step low→high risk ramp.
function band(dist) {
  if (!(dist > 0)) return 0; // negligible / none projected
  if (dist <= 10) return 1; // low
  if (dist <= 30) return 2; // moderate
  if (dist <= 75) return 3; // high
  return 4; // very high
}
const BAND_LABEL = ['Negligible', 'Low', 'Moderate', 'High', 'Very high'];

async function fetchCoast() {
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: TYPE,
    outputFormat: 'GEOJSON',
    srsName: 'EPSG:4326',
    bbox: `${COAST_BBOX.join(',')},EPSG:4326`,
    count: '10000',
  });
  const res = await fetch(`${WFS}?${params}`);
  if (!res.ok) throw new Error(`NCERM WFS failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  return json.features ?? [];
}

async function main() {
  console.log('Fetching NCERM coastal erosion frontages for the Dorset coast…');
  console.log('  scenario: No Future Intervention · to 2055 · Higher Central climate allowance');
  const features = await fetchCoast();
  console.log(`  ${features.length} frontage segments fetched.`);
  if (!features.length) throw new Error('No NCERM features returned — aborting (not faking data).');

  const dist = [];
  const collection = {
    type: 'FeatureCollection',
    features: features.map((f) => {
      const d = Number(f.properties?.[FIELD]) || 0;
      dist.push(d);
      return { type: 'Feature', properties: { risk: band(d), dist: Math.round(d) }, geometry: f.geometry };
    }),
  };

  // Report the risk-band distribution honestly.
  const byBand = {};
  collection.features.forEach((f) => { byBand[f.properties.risk] = (byBand[f.properties.risk] || 0) + 1; });
  const maxD = Math.max(...dist), medD = dist.slice().sort((a, b) => a - b)[Math.floor(dist.length / 2)];
  console.log('  recession distance: median ' + medD.toFixed(0) + ' m, max ' + maxD.toFixed(0) + ' m');
  console.log('  by risk band:');
  for (let b = 0; b <= 4; b++) console.log(`     ${b} ${BAND_LABEL[b]}: ${byBand[b] || 0}`);

  // Clip to the shared coastal box + light simplify (these are thin coast strips).
  const [w, s, e, n] = COASTAL_BBOX;
  const commands =
    `-i in.geojson -simplify 10% keep-shapes -clean ` +
    `-clip bbox=${w},${s},${e},${n} -clean ` +
    `-o precision=0.00001 format=geojson out.geojson`;
  const result = await mapshaper.applyCommands(commands, { 'in.geojson': JSON.stringify(collection) });

  const out = result['out.geojson'];
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, out);
  const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
  const nOut = JSON.parse(out).features.length;
  console.log(`\nWrote ${OUT} — ${nOut} features, ${kb} KB.`);
}

main().catch((err) => {
  console.error('Failed to build NCERM data:', err.message);
  process.exit(1);
});
