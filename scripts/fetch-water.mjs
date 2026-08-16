/**
 * Build the "Rivers & waterways" LINES for the whole of Dorset from OpenStreetMap
 * (Overpass): rivers, canals, streams, and minor channels (ditch + drain).
 *
 * Run with: npm run data:water
 *
 * This file is LINES ONLY — no water-body polygons. (The only two filled water
 * bodies in the app, The Fleet + Poole Harbour, are a separate, individually
 * verified file: see scripts/fetch-named-water.mjs.) Generic natural=water fills
 * were the recurring source of pale-blue rectangle artefacts, so they stay out.
 *
 * Output is plain GeoJSON (`public/data/water.geojson`): rivers + canals at full
 * resolution; streams + ditches + drains lightly simplified. Each feature carries
 * `wtype` (river|canal|stream|ditch|drain) and, where present, `name`. Ditches and
 * drains are gated to close zoom by the renderer so mid/county views stay clean.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import mapshaper from 'mapshaper';
import osmtogeojson from 'osmtogeojson';
import { DORSET_BBOX, loadMaskString } from './lib/dorset.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, '../public/data/water.geojson');

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const UA = 'dorset-nature-map/1.0 (data build; contact benthorne77@gmail.com)';

async function overpass(query) {
  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: 'data=' + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(`Overpass → ${res.status} ${res.statusText}`);
  return res.json();
}

// Keep only line geometry + a tidy property set.
function lines(osm, wtypeOf) {
  return osmtogeojson(osm).features
    .filter((f) => f.geometry && /LineString$/.test(f.geometry.type))
    .map((f) => ({
      type: 'Feature',
      properties: {
        wtype: wtypeOf(f),
        ...(f.properties?.name ? { name: f.properties.name } : {}),
      },
      geometry: f.geometry,
    }));
}

// Clip a set of line features to the Dorset LNRS mask; optionally simplify.
async function clip(features, simplifyPct) {
  if (!features.length) return [];
  const simplify = simplifyPct ? `-simplify ${simplifyPct}% keep-shapes ` : '';
  const out = await mapshaper.applyCommands(
    `-i in.geojson ${simplify}-clip mask.geojson -o format=geojson out.geojson`,
    { 'in.geojson': JSON.stringify({ type: 'FeatureCollection', features }), 'mask.geojson': MASK },
  );
  return JSON.parse(out['out.geojson']).features;
}

let MASK;

async function main() {
  const [w, s, e, n] = DORSET_BBOX;
  const bbox = `${s},${w},${n},${e}`;
  MASK = await loadMaskString();

  console.log('Fetching rivers + canals (full resolution)…');
  const riverCanal = lines(
    await overpass(`[out:json][timeout:240];
( way["waterway"~"^(river|canal)$"](${bbox}); );
out tags geom;`),
    (f) => f.properties.waterway,
  );

  console.log('Fetching streams…');
  const streams = lines(
    await overpass(`[out:json][timeout:240];
( way["waterway"="stream"](${bbox}); );
out tags geom;`),
    () => 'stream',
  );

  // Minor channels — ditches & drains. Many small features, shown only at close
  // zoom (the renderer gates them with minzoom), so mid/county views stay clean.
  console.log('Fetching minor channels (ditch, drain)…');
  const minor = lines(
    await overpass(`[out:json][timeout:240];
( way["waterway"~"^(ditch|drain)$"](${bbox}); );
out tags geom;`),
    (f) => f.properties.waterway,
  );

  const counts = (arr) => arr.reduce((a, f) => ((a[f.properties.wtype] = (a[f.properties.wtype] || 0) + 1), a), {});
  console.log(`   rivers/canals: ${JSON.stringify(counts(riverCanal))}, streams: ${streams.length}, minor: ${JSON.stringify(counts(minor))}`);

  console.log('Clipping to the Dorset LNRS area (rivers full; streams/minor lightly simplified)…');
  const clippedRC = await clip(riverCanal, null); // full fidelity
  const clippedStreams = await clip(streams, 30); // light simplification
  const clippedMinor = await clip(minor, 30); // light simplification

  const features = [...clippedRC, ...clippedStreams, ...clippedMinor];
  const fc = { type: 'FeatureCollection', features };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(fc));

  const kb = (Buffer.byteLength(JSON.stringify(fc)) / 1024).toFixed(0);
  const named = features.filter((f) => f.properties.name).length;
  console.log(`Wrote ${OUT} — ${features.length} line features (${clippedRC.length} river/canal, ${clippedStreams.length} stream, ${clippedMinor.length} ditch/drain), ${named} named, ${kb} KB.`);
  console.log('   LINES ONLY — zero water-body polygons (named bodies are a separate file).');
}

main().catch((err) => {
  console.error('Failed to build water layer:', err.message);
  process.exit(1);
});
