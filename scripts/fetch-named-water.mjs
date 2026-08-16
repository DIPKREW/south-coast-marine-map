/**
 * Fetch EXACTLY TWO named water bodies — "The Fleet" and "Poole Harbour" — from
 * OpenStreetMap, and commit them to public/data/water-bodies-named.geojson.
 *
 * Run with: npm run data:water-named
 *
 * These are the ONLY filled water polygons in the whole app. We deliberately do
 * NOT fetch a broad water-body category (generic natural=water lakes/ponds) — a
 * broad fill category tile-clipped into pale-blue rectangle artefacts. Instead we
 * add two specific, individually VERIFIED coastline shapes.
 *
 * VERIFICATION GATE: each fetched polygon must be a real, high-vertex shoreline
 * (> 50 vertices), not a near-rectangular bounding box (≤ 10). If a shape fails,
 * the script aborts and reports it rather than drawing a crude box.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import osmtogeojson from 'osmtogeojson';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, '../public/data/water-bodies-named.geojson');

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const UA = 'dorset-nature-map/1.0 (data build; contact benthorne77@gmail.com)';
const MIN_VERTICES = 50; // gate: a real shoreline has many vertices, a box has ~5

// The two — identified by name + the tag that carries the true shoreline.
const WANTED = [
  { name: 'The Fleet', match: (t) => t.name === 'The Fleet' && t.natural === 'water' },
  { name: 'Poole Harbour', match: (t) => t.name === 'Poole Harbour' && t.natural === 'bay' },
];

const QUERY = `[out:json][timeout:90];
(
  rel["name"="The Fleet"]["natural"="water"](50.55,-2.62,50.66,-2.44);
  rel["name"="Poole Harbour"]["natural"="bay"](50.60,-2.10,50.75,-1.88);
);
out geom;`;

const countVertices = (g) => {
  let n = 0;
  const walk = (a) => { if (typeof a[0] === 'number') n++; else a.forEach(walk); };
  walk(g.coordinates);
  return n;
};

async function main() {
  console.log('Fetching the two named water bodies (The Fleet, Poole Harbour)…');
  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: 'data=' + encodeURIComponent(QUERY),
  });
  if (!res.ok) throw new Error(`Overpass → ${res.status} ${res.statusText}`);
  const polys = osmtogeojson(await res.json()).features.filter((f) => f.geometry && /Polygon$/.test(f.geometry.type));

  const features = [];
  for (const want of WANTED) {
    const f = polys.find((p) => want.match(p.properties || {}));
    if (!f) {
      throw new Error(`"${want.name}" not found in OSM response — aborting (no fabrication).`);
    }
    const v = countVertices(f.geometry);
    console.log(`  ${want.name}: ${f.geometry.type}, ${v} vertices`);
    if (v <= 10) {
      throw new Error(`"${want.name}" looks like a ${v}-vertex bounding box, not a shoreline — REJECTED (gate: > ${MIN_VERTICES}).`);
    }
    if (v < MIN_VERTICES) {
      throw new Error(`"${want.name}" has only ${v} vertices (< ${MIN_VERTICES}) — too crude, REJECTED.`);
    }
    features.push({
      type: 'Feature',
      properties: { name: want.name, wtype: 'water' },
      geometry: f.geometry,
    });
  }

  if (features.length !== 2) throw new Error(`Expected exactly 2 water bodies, got ${features.length}.`);

  const fc = { type: 'FeatureCollection', features };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(fc));
  const kb = (Buffer.byteLength(JSON.stringify(fc)) / 1024).toFixed(0);
  console.log(`Wrote ${OUT} — exactly ${features.length} verified water bodies, ${kb} KB.`);
}

main().catch((err) => {
  console.error('Failed to build named water bodies:', err.message);
  process.exit(1);
});
