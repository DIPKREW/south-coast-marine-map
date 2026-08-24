/**
 * Fetch the OSM COASTLINE for the project corridor and bundle at
 * public/data/coastline.geojson.
 *
 * Run with: npm run data:coastline
 *
 * WHY THIS EXISTS. It is not drawn on the map — the basemap already draws a
 * coast. It is committed because the PINNABLE AREA build needs to know which
 * coast a piece of open water belongs to, and nothing else in this repo can say.
 * The catchment boundary stops about a nautical mile offshore; the 2 km sea grid
 * is clipped to a rectangle, so its outer ring is part coastline and part bbox
 * edge. Four derivations of the corridor test were attempted without a real
 * coastline and all four failed, the last one excluding Lyme Bay and Offshore
 * Brighton — see the git history of build-pinnable-area.mjs.
 *
 * SOURCE: OpenStreetMap `natural=coastline` ways, via the Overpass API, under
 * ODbL. Same service and the same corridor bbox the rivers & waterways layer
 * uses (scripts/fetch-water.mjs).
 *
 * SIMPLIFIED HARD, ON PURPOSE. The only consumer measures distance from a sea
 * cell to the nearest coast and compares two such distances. That question is
 * insensitive to whether a cove is drawn to the metre, so the geometry is
 * simplified to roughly a hundred metres — small enough to be committed, far
 * finer than the 2 km cells it classifies.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import mapshaper from 'mapshaper';
import { SOUTH_COAST_BBOX } from './lib/southcoast.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, '../public/data/coastline.geojson');

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const UA = 'south-coast-marine-map/1.0 (data build script)';

/** Simplification, as a mapshaper percentage. `keep-shapes` stops short ways —
 *  islets, harbour walls — being deleted outright. */
const SIMPLIFY = '4%';

async function overpass(query, { tries = 4 } = {}) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try {
      // Form-encoded `data=`, with a User-Agent: the same contract
      // scripts/fetch-water.mjs uses. A plain text body gets a flat 406.
      const res = await fetch(OVERPASS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const text = await res.text();
      if (!text.trim().startsWith('{')) {
        // Overpass answers busy/rate-limited with an HTML error page, not JSON.
        const why = /<strong[^>]*>Error<\/strong>:?\s*([^<]+)/.exec(text)?.[1]?.trim();
        throw new Error(why ? `refused: ${why}` : 'non-JSON response (server busy?)');
      }
      return JSON.parse(text);
    } catch (err) {
      last = err;
      console.log(`     ${err.message} — retry ${i}/${tries}`);
    }
    if (i < tries) await new Promise((r) => setTimeout(r, 5000 * i));
  }
  throw new Error(`Overpass failed after ${tries} attempts: ${last?.message}`);
}

async function main() {
  const [w, s, e, n] = SOUTH_COAST_BBOX;
  console.log('Coastline — OpenStreetMap via Overpass, ODbL\n');
  console.log(`  bbox [W,S,E,N] = ${SOUTH_COAST_BBOX.join(', ')}`);

  // Overpass takes bbox as (south, west, north, east).
  const query = `[out:json][timeout:180];\nway["natural"="coastline"](${s},${w},${n},${e});\nout geom;`;
  console.log(`  query: way["natural"="coastline"](${s},${w},${n},${e}); out geom;`);

  const json = await overpass(query);
  const ways = (json.elements ?? []).filter((el) => el.type === 'way' && el.geometry?.length > 1);
  if (!ways.length) throw new Error('Overpass returned no coastline ways — aborting (not faking data).');
  const rawPoints = ways.reduce((t, wy) => t + wy.geometry.length, 0);
  console.log(`\n  ${ways.length} coastline ways, ${rawPoints.toLocaleString('en-GB')} points`);

  const collection = {
    type: 'FeatureCollection',
    features: ways.map((wy) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: wy.geometry.map((p) => [p.lon, p.lat]) },
    })),
  };
  const rawKb = Buffer.byteLength(JSON.stringify(collection)) / 1024;

  const commands =
    `-i in.geojson -simplify ${SIMPLIFY} keep-shapes ` +
    `-o precision=0.00001 format=geojson out.geojson`;
  const result = await mapshaper.applyCommands(commands, { 'in.geojson': JSON.stringify(collection) });
  // With no attributes to carry, mapshaper emits a GeometryCollection rather
  // than a FeatureCollection. Normalise so the committed file is always a
  // FeatureCollection, which is what every other layer here ships.
  const raw = JSON.parse(result['out.geojson']);
  const parsed = raw.type === 'FeatureCollection'
    ? raw
    : { type: 'FeatureCollection', features: (raw.geometries ?? []).map((g) => ({ type: 'Feature', properties: {}, geometry: g })) };
  if (!parsed.features?.length) throw new Error(`simplify produced no features (got ${raw.type})`);
  const out = JSON.stringify(parsed);
  const keptPoints = parsed.features.reduce((t, f) => t + (f.geometry?.coordinates?.length ?? 0), 0);

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, out);

  const kb = Buffer.byteLength(out) / 1024;
  console.log(`  simplified ${SIMPLIFY} keep-shapes: ${rawPoints.toLocaleString('en-GB')} → ${keptPoints.toLocaleString('en-GB')} points`);
  console.log(`  size: ${(rawKb / 1024).toFixed(1)} MB raw → ${kb.toFixed(0)} KB written`);
  console.log(`\nWrote ${OUT} — ${parsed.features.length} ways, ${kb.toFixed(0)} KB.`);
}

main().catch((err) => {
  console.error('\nFailed to build coastline data:', err.message);
  process.exit(1);
});
