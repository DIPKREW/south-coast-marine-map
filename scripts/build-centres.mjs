/**
 * Write the Dorset Wildlife Trust visitor-centre markers to
 * public/data/dwt-centres.geojson.
 *
 * Run with: npm run data:centres
 *
 * This is a small CURATED set. Each coordinate was geocoded (Nominatim) and/or
 * taken from an authoritative OpenStreetMap feature, then verified to land on the
 * right place before being committed here — provenance noted per entry. The
 * descriptions are fixed editorial copy (no opening hours or invented facts).
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, '../public/data/dwt-centres.geojson');

// [lon, lat] — verified. See `source` for how each was fixed.
const CENTRES = [
  {
    name: 'Kingcombe Visitor Centre',
    lon: -2.63299, lat: 50.78984,
    description: 'Gateway to Kingcombe National Nature Reserve — wildlife gardens, bird hide, café and trails.',
    source: 'Postcode DT2 0EQ (Nominatim); matches OSM Lower Kingcombe car park/toilets',
  },
  {
    name: 'Fine Foundation Wild Seas Centre',
    lon: -2.12982, lat: 50.60877,
    description: 'On Kimmeridge Bay — marine wildlife and rockpools.',
    source: 'OSM node "Fine Foundation Marine Centre" (operator:wikidata Q5298872)',
  },
  {
    name: 'Fine Foundation Wild Chesil Centre',
    lon: -2.46981, lat: 50.57913,
    description: 'Chesil Beach and the Fleet Lagoon, on the Jurassic Coast.',
    source: 'OSM/Nominatim "Chesil Beach Visitor Centre", Portland Beach Road',
  },
  {
    name: 'Lorton Meadows',
    lon: -2.46228, lat: 50.64255,
    description: 'Tranquil, wildlife-rich meadows on the edge of Weymouth.',
    source: 'OSM "Lorton Meadows Conservation Centre" (Nominatim agreement ~1 m)',
  },
  {
    name: 'The Villa Wildlife Centre',
    lon: -1.96472, lat: 50.69307,
    description: 'Brownsea Island and its lagoon, in Poole Harbour.',
    source: 'OSM way "The Villa", Brownsea Island',
  },
  {
    name: 'Brooklands Farm',
    lon: -2.47548, lat: 50.75534,
    description: 'Dorset Wildlife Trust headquarters.',
    source: 'Postcode DT2 7AA (Nominatim), Forston/Charminster',
  },
];

async function main() {
  const features = CENTRES.map((c) => ({
    type: 'Feature',
    properties: { name: c.name, description: c.description, source: c.source },
    geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
  }));
  const fc = { type: 'FeatureCollection', features };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(fc));
  console.log(`Wrote ${OUT} — ${features.length} visitor centres:`);
  for (const c of CENTRES) console.log(`  • ${c.name} (${c.lat}, ${c.lon})`);
}

main().catch((err) => {
  console.error('Failed to write visitor centres:', err.message);
  process.exit(1);
});
