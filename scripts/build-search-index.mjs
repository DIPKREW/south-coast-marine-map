/**
 * Build the LOCAL PLACE SEARCH INDEX at public/data/search-index.json.
 *
 * Run with: npm run data:search
 *
 * WHY A BUILD-TIME INDEX
 * ----------------------
 * Every layer on this map is lazily loaded, so at the moment someone types into
 * the search box almost none of the layer data is in the browser. Indexing "what
 * is currently loaded" would mean search returned nothing on a fresh page and
 * slowly got better as you toggled things on, which is not a search box. So the
 * names are harvested here, once, into one small file the box fetches on first
 * use.
 *
 * WHAT IT DOES AND DOES NOT COVER
 * -------------------------------
 * It covers everything this map actually draws: water bodies, marine protected
 * areas, named rivers, wrecks, storm overflows, licensed areas. Measured against
 * 40 common corridor place names it resolves 37 — but several only through
 * oddly-named infrastructure ("New Swanage Attenuation Tank" for Swanage), and
 * it misses Durdle Door, Brixham and Eastbourne outright.
 *
 * That gap is why the search box also queries Photon. This index is the fast,
 * offline, always-available half that can say what KIND of thing each result is;
 * the geocoder is the half that knows ordinary place names.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SOUTH_COAST_BBOX, BEACHY_HEAD_LON } from './lib/southcoast.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(__dir, '../public/data');
const load = async (f) => JSON.parse(await readFile(resolve(DATA, f), 'utf8')).features ?? [];

const [W, S, , N] = SOUTH_COAST_BBOX;
const E = BEACHY_HEAD_LON;

/*
 * Each source declares the zoom that suits its feature SIZE. Flying to a whole
 * water body at the zoom you'd use for one storm overflow would put you inside
 * it with no idea where you are; the reverse leaves a single outfall as an
 * invisible dot. `rank` orders results when several kinds match the same string
 * — a named bay should beat a pumping station that happens to share the name.
 */
const SOURCES = [
  { file: 'wfd-coastal.geojson', kind: 'water body', get: (p) => p.name, zoom: 11, rank: 1 },
  { file: 'marine.geojson', kind: 'marine protected area', get: (p) => p.name, zoom: 10, rank: 2 },
  { file: 'wrecks-protected.geojson', kind: 'protected wreck site', get: (p) => p.name, zoom: 14, rank: 3 },
  { file: 'water.geojson', kind: 'river', get: (p) => p.name, zoom: 12, rank: 4 },
  { file: 'marine-licensing.geojson', kind: 'licensed area', get: (p) => p.title, zoom: 12, rank: 5 },
  { file: 'wrecks.geojson', kind: 'wreck', get: (p) => p.name, zoom: 14, rank: 6 },
  { file: 'storm-overflows.geojson', kind: 'storm overflow', get: (p) => p.name, zoom: 14, rank: 7 },
];

const centroid = (g) => {
  let x = 0, y = 0, n = 0;
  const walk = (c) => { if (typeof c[0] === 'number') { x += c[0]; y += c[1]; n++; } else c.forEach(walk); };
  walk(g.coordinates);
  return [x / n, y / n];
};
const clean = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s.toLowerCase() === 'n/a' || s.toLowerCase() === 'unknown') return null;
  // Several sources shout their names; title-case reads better in a dropdown.
  return s === s.toUpperCase() && s.length > 3
    ? s.toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase())
    : s;
};

async function main() {
  console.log('Building local search index…');
  const byKey = new Map();
  let scanned = 0;

  for (const src of SOURCES) {
    let feats;
    try { feats = await load(src.file); } catch { console.log(`  (skipped ${src.file} — not present)`); continue; }
    let kept = 0;
    for (const f of feats) {
      const name = clean(src.get(f.properties ?? {}));
      if (!name || !f.geometry) continue;
      const [lon, lat] = centroid(f.geometry);
      if (!Number.isFinite(lon) || lon < W || lon > E || lat < S || lat > N) continue;
      // One entry per name+kind; duplicates (a river split into many ways) collapse.
      const key = `${name.toLowerCase()}|${src.kind}`;
      if (!byKey.has(key)) {
        byKey.set(key, { n: name, k: src.kind, z: src.zoom, r: src.rank,
          c: [Math.round(lon * 1e4) / 1e4, Math.round(lat * 1e4) / 1e4] });
        kept++;
      }
      scanned++;
    }
    console.log(`  ${String(kept).padStart(5)} entries from ${src.file} (${src.kind})`);
  }

  const entries = [...byKey.values()].sort((a, b) => a.r - b.r || a.n.localeCompare(b.n));
  const txt = JSON.stringify({ entries });
  await writeFile(resolve(DATA, 'search-index.json'), txt);

  const kinds = new Map();
  for (const e of entries) kinds.set(e.k, (kinds.get(e.k) ?? 0) + 1);
  console.log('\n  by kind:');
  for (const [k, v] of [...kinds].sort((a, b) => b[1] - a[1])) console.log(`     ${k.padEnd(24)} ${v}`);
  console.log(`\nWrote search-index.json — ${entries.length} entries, ${(Buffer.byteLength(txt) / 1024).toFixed(0)} KB (from ${scanned} named features)`);
}

main().catch((e) => { console.error('Failed:', e.message); process.exit(1); });
