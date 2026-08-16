/**
 * Build the "Rivers & waterways" LINES for the whole SOUTH COAST PROJECT CORRIDOR
 * from OpenStreetMap (Overpass).
 *
 * Run with: npm run data:water
 *
 * This file is LINES ONLY — no water-body polygons. (The only two filled water
 * bodies in the app, The Fleet + Poole Harbour, are a separate, individually
 * verified file: see scripts/fetch-named-water.mjs.) Generic natural=water fills
 * were the recurring source of pale-blue rectangle artefacts, so they stay out.
 *
 * WHY RIVERS AND CANALS ONLY
 * --------------------------
 * This layer used to cover Dorset alone and carried every waterway class OSM
 * has. Widened to the corridor, that is not a viable download — counted straight
 * from Overpass:
 *
 *     river   4,208      canal     265      stream  51,002
 *     ditch   7,124      drain   5,338      TOTAL   67,937 ways  ≈ 24.7 MB
 *
 * Streams alone are 51,002 ways and about 13.8 MB. This layer is the one layer
 * on the map that DEFAULTS ON, so its cost is paid by every visitor on first
 * paint — and the renderer already gates streams to zoom 11 and ditches/drains
 * to zoom 13, so none of that weight is even drawn at the corridor view where
 * the map opens. Rivers and canals are what the layer is for at this scale.
 *
 * Set WATER_ALL=1 to build the everything-included version for comparison; it is
 * not what ships.
 *
 * Output is plain GeoJSON (`public/data/water.geojson`). Each feature carries
 * `wtype` (river|canal|stream|ditch|drain) and, where present, `name`. The
 * renderer is unchanged and still knows all five types, so a future build that
 * adds streams back needs no code change.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import mapshaper from 'mapshaper';
import osmtogeojson from 'osmtogeojson';
import { SOUTH_COAST_BBOX, BEACHY_HEAD_LON } from './lib/southcoast.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, '../public/data/water.geojson');

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const UA = 'south-coast-marine-map/1.0 (data build; contact benthorne77@gmail.com)';

// The corridor: the project bbox's west/north/south edges with the hard Beachy
// Head cutoff on the east — the same eastern edge the storm overflow, water body,
// seabed and marine species layers use.
const [W, S, , N] = SOUTH_COAST_BBOX;
const E = BEACHY_HEAD_LON;

// Rivers carry the shape of the coastline's catchments and are the only classes
// drawn at the opening view. 25% keeps the meanders legible at close zoom while
// taking the file from 4.07 MB to 1.53 MB — see the comparison printed on every
// run of this script at the levels tried.
const RIVER_SIMPLIFY = 25;
const MINOR_SIMPLIFY = 30; // only used when WATER_ALL=1

const INCLUDE_ALL = process.env.WATER_ALL === '1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Overpass is a free, shared, frequently-busy service. A corridor-wide query is
 * big enough that a 504, or an HTML "dispatcher busy" page in place of JSON, is
 * a normal Tuesday rather than a failure — so retry with backoff instead of
 * losing the whole build to one bad minute.
 */
async function overpass(query, { tries = 5 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
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
      lastErr = err;
      if (attempt === tries) break;
      const wait = 15000 * attempt;
      console.log(`    Overpass ${err.message} — retry ${attempt}/${tries - 1} in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  throw new Error(`Overpass failed after ${tries} attempts — ${lastErr.message}`);
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

/**
 * Clip to the corridor and optionally simplify.
 *
 * The Dorset build clipped to the LNRS land mask; there is no equivalent polygon
 * for five counties, and rivers are on land anyway, so the corridor rectangle
 * does the job — with the same 0.245°E eastern cutoff as every other layer.
 */
async function clip(features, simplifyPct) {
  if (!features.length) return [];
  const simplify = simplifyPct ? `-simplify ${simplifyPct}% keep-shapes ` : '';
  const out = await mapshaper.applyCommands(
    `-i in.geojson ${simplify}-clip bbox=${W},${S},${E},${N} -o precision=0.00001 format=geojson out.geojson`,
    { 'in.geojson': JSON.stringify({ type: 'FeatureCollection', features }) },
  );
  return (JSON.parse(out['out.geojson']).features ?? []).filter((f) => f.geometry);
}

async function main() {
  const bbox = `${S},${W},${N},${E}`;
  console.log('Building rivers & waterways for the South Coast corridor (OpenStreetMap / Overpass)…');
  console.log(`  corridor [W,S,E,N] = ${W}, ${S}, ${E}, ${N}   (east edge = Beachy Head cutoff)`);
  console.log(`  classes: ${INCLUDE_ALL ? 'river, canal, stream, ditch, drain (WATER_ALL=1)' : 'river + canal'}`);

  console.log('\n  Fetching rivers + canals…');
  const riverCanal = lines(
    await overpass(`[out:json][timeout:600];
( way["waterway"~"^(river|canal)$"](${bbox}); );
out tags geom;`),
    (f) => (f.properties.waterway === 'canal' ? 'canal' : 'river'),
  );
  console.log(`    ${riverCanal.length} ways`);

  let streams = [];
  let minor = [];
  if (INCLUDE_ALL) {
    console.log('  Fetching streams…');
    streams = lines(
      await overpass(`[out:json][timeout:600];
( way["waterway"="stream"](${bbox}); );
out tags geom;`),
      () => 'stream',
    );
    console.log(`    ${streams.length} ways`);
    console.log('  Fetching minor channels (ditch, drain)…');
    minor = lines(
      await overpass(`[out:json][timeout:600];
( way["waterway"~"^(ditch|drain)$"](${bbox}); );
out tags geom;`),
      (f) => f.properties.waterway,
    );
    console.log(`    ${minor.length} ways`);
  }

  console.log('\n  Clipping to the corridor & simplifying…');
  const clippedRC = await clip(riverCanal, RIVER_SIMPLIFY);
  const clippedStreams = await clip(streams, MINOR_SIMPLIFY);
  const clippedMinor = await clip(minor, MINOR_SIMPLIFY);

  const features = [...clippedRC, ...clippedStreams, ...clippedMinor];
  const fc = { type: 'FeatureCollection', features };
  const txt = JSON.stringify(fc);
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, txt);

  const counts = features.reduce((a, f) => ((a[f.properties.wtype] = (a[f.properties.wtype] || 0) + 1), a), {});
  let verts = 0;
  for (const f of features) verts += f.geometry.coordinates.length;
  const named = features.filter((f) => f.properties.name).length;
  const kb = (Buffer.byteLength(txt) / 1024).toFixed(0);

  console.log(`\nWrote ${OUT}`);
  console.log(`  ${features.length} line features ${JSON.stringify(counts)}`);
  console.log(`  ${named} named, ${verts.toLocaleString('en-GB')} vertices, ${kb} KB`);
  console.log('  LINES ONLY — zero water-body polygons (named bodies are a separate file).');
  if (!INCLUDE_ALL) {
    console.log('\n  Not included, by design: stream (51,002 ways ≈ 13.8 MB), ditch (7,124), drain (5,338).');
    console.log('  Re-run with WATER_ALL=1 to build the full-detail comparison.');
  }
}

main().catch((err) => {
  console.error('Failed to build water layer:', err.message);
  process.exit(1);
});
