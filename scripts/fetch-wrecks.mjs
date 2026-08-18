/**
 * Fetch SHIPWRECKS for the project corridor and bundle them at
 * public/data/wrecks.geojson + public/data/wrecks-protected.geojson.
 *
 * Run with: npm run data:wrecks
 *
 * TWO SOURCES, ONE TOGGLE
 * -----------------------
 * 1. UKHO "Wrecks and Obstructions", the whole-world point shapefile published on
 *    the ADMIRALTY Marine Data Portal. Open Government Licence, no key, refreshed
 *    quarterly. ~94,000 records worldwide; 3,664 wrecks fall in this corridor.
 *
 * 2. Historic England PROTECTED WRECK SITES — the National Heritage List entries
 *    designated under the Protection of Wrecks Act 1973. 57 sites nationally, of
 *    which 31 are in this corridor. Also OGL.
 *
 * WHY UKHO DIRECT RATHER THAN THE EMODnet MIRROR
 * ----------------------------------------------
 * EMODnet Human Activities re-publishes this as `emodnet:wwshipwrecks`, and that
 * is the easier fetch — a WFS that takes a bbox and hands back GeoJSON. It was
 * measured against the primary before being rejected:
 *
 *     EMODnet mirror   3,652 corridor wrecks   44 fields   cited 2024-12-26
 *     UKHO direct      3,664 corridor wrecks   50 fields   updated 2026-07-15
 *
 * Nearly the same wrecks, but the mirror is nineteen months behind and drops six
 * attribute columns. The usual trap on this project has been a stale third-party
 * re-host; this is the same trap wearing a friendlier API.
 *
 * WRECKS ONLY, NOT OBSTRUCTIONS
 * -----------------------------
 * The UKHO file is "Wrecks AND Obstructions" and the corridor extract holds 5,961
 * records: 3,664 with a `wreck_cate` (real wrecks), 1,472 obstructions — foul
 * ground, a diffuser, a fish haven — and 825 with neither. Only the first group
 * ships. A toggle labelled "Shipwrecks" should not quietly include seabed snags.
 *
 * HOW COMPLETE THE DETAIL ACTUALLY IS
 * -----------------------------------
 * The schema is rich but the records are not, and the layer must not imply
 * otherwise. Measured on the corridor extract, with the source's own 'n/a'
 * placeholder counted as empty:
 *
 *     name 53.9%   vessel type 65.4%   date sunk 51.4%   depth 56.6%
 *     flag 50.5%   circumstances 50.7%   cargo 27.3%
 *
 * 44% of these wrecks have NEITHER a name NOR a date — they are a position and a
 * hazard category, nothing more. The About text says so.
 */
import { writeFile, mkdir, stat, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import mapshaper from 'mapshaper';
import { SOUTH_COAST_BBOX, BEACHY_HEAD_LON, fetchAllFeatures } from './lib/southcoast.mjs';

const run = promisify(execFile);
const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, '../public/data');
const CACHE = resolve(__dir, '../.cache/wrecks');

// ADMIRALTY Marine Data Portal item "Wrecks and Obstructions Shapefiles".
const UKHO_ZIP =
  'https://datahub.admiralty.co.uk/portal/sharing/rest/content/items/' +
  '4dbf2ace22bf4f9785fb445d0593bc2c/data';

// Historic England, National Heritage List for England — Protected Wreck Sites.
const HE_PROTECTED =
  'https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/' +
  'Centre_point___National_Heritage_List_for_England_(NHLE)___Protected_Wreck_sites/FeatureServer/0';

const [W, S, , N] = SOUTH_COAST_BBOX;
const E = BEACHY_HEAD_LON;

const mb = (b) => `${(b / 1e6).toFixed(2)} MB`;
const NA = new Set(['', 'n/a', 'none', 'unknown', 'null']);
/** The source uses the literal string 'n/a' for "not known"; treat it as empty. */
const val = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  return NA.has(s.toLowerCase()) ? null : s;
};
const num = (v) => {
  const s = val(v);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
/** date_sunk is YYYYMMDD; only the year is worth showing and only if plausible. */
const year = (v) => {
  const s = val(v);
  const m = s && /^(\d{4})/.exec(s);
  const y = m ? Number(m[1]) : null;
  return y && y > 1000 && y <= new Date().getFullYear() + 1 ? y : null;
};

async function ukhoWrecks() {
  await mkdir(CACHE, { recursive: true });
  const zip = resolve(CACHE, 'ukho.zip');
  const existing = await stat(zip).catch(() => null);
  if (!existing || existing.size < 1e6 || process.env.REFETCH) {
    console.log('  downloading UKHO Wrecks & Obstructions (whole world)…');
    const res = await fetch(UKHO_ZIP);
    if (!res.ok) throw new Error(`UKHO download HTTP ${res.status}`);
    await writeFile(zip, Buffer.from(await res.arrayBuffer()));
  }
  console.log(`  archive: ${mb((await stat(zip)).size)}`);

  const shp = resolve(CACHE, 'Shapefiles/Points.shp');
  if (!(await stat(shp).catch(() => null))) {
    console.log('  extracting… (the attribute table expands to ~1 GB)');
    await run('unzip', ['-o', '-q', zip, '-d', CACHE]);
  }

  // Clip to the corridor in mapshaper, which streams the shapefile rather than
  // holding the whole 1 GB .dbf as JSON.
  const clipped = resolve(CACHE, 'corridor.json');
  console.log('  clipping to corridor…');
  await mapshaper.runCommands(
    `-i "${shp}" encoding=utf8 ` +
      `-filter "this.x > ${W} && this.x < ${E} && this.y > ${S} && this.y < ${N}" ` +
      `-o "${clipped}" format=geojson force`,
  );

  const all = JSON.parse(await readFile(clipped, 'utf8')).features ?? [];
  const wrecks = all.filter((f) => val(f.properties?.wreck_cate));
  const obstructions = all.filter((f) => !val(f.properties?.wreck_cate) && val(f.properties?.obstructio));
  console.log(`  ${all.length} records in corridor → ${wrecks.length} wrecks, ${obstructions.length} obstructions, ${all.length - wrecks.length - obstructions.length} other (dropped)`);

  return wrecks.map((f) => {
    const p = f.properties;
    const circ = val(p.circumstan);
    return {
      type: 'Feature',
      properties: {
        // A stable id so the hover highlight has something to key on.
        id: val(p.wreck_id),
        name: val(p.name),
        type: val(p.type),
        sunk: year(p.date_sunk),
        depth: num(p.depth),
        flag: val(p.flag),
        cargo: val(p.cargo),
        cat: (val(p.wreck_cate) || '').toLowerCase(),
        status: val(p.status),
        cond: val(p.general_co),
        // Free text, occasionally hundreds of words. Trimmed for payload; the
        // card shows it as the closing note.
        circ: circ ? (circ.length > 220 ? `${circ.slice(0, 217)}…` : circ) : null,
      },
      geometry: f.geometry,
    };
  });
}

async function protectedSites() {
  console.log('\n  fetching Historic England Protected Wreck Sites…');
  const feats = await fetchAllFeatures(
    HE_PROTECTED,
    {
      where: '1=1',
      geometry: [W, S, E, N].join(','),
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'ListEntry,Name,DesigDate,AmendDate,hyperlink,area_ha',
      geometryPrecision: '6',
    },
    { pageSize: 200 },
  );
  console.log(`  ${feats.length} protected sites in corridor (57 nationally)`);
  return feats.map((f) => {
    const p = f.properties ?? {};
    return {
      type: 'Feature',
      properties: {
        id: p.ListEntry ?? null,
        name: p.Name || 'Protected wreck site',
        designated: p.DesigDate ? new Date(Number(p.DesigDate)).getUTCFullYear() : null,
        area: p.area_ha != null ? Math.round(Number(p.area_ha) * 10) / 10 : null,
        link: p.hyperlink || null,
      },
      geometry: f.geometry,
    };
  });
}

async function main() {
  console.log('Fetching shipwrecks (UKHO Wrecks & Obstructions + Historic England protected sites)…');
  console.log(`  corridor [W,S,E,N] = ${W}, ${S}, ${E}, ${N}   (east edge = Beachy Head cutoff)`);

  const wrecks = await ukhoWrecks();
  const prot = await protectedSites();

  await mkdir(OUT, { recursive: true });
  const wFile = resolve(OUT, 'wrecks.geojson');
  const pFile = resolve(OUT, 'wrecks-protected.geojson');
  const wTxt = JSON.stringify({ type: 'FeatureCollection', features: wrecks });
  const pTxt = JSON.stringify({ type: 'FeatureCollection', features: prot });
  await writeFile(wFile, wTxt);
  await writeFile(pFile, pTxt);

  // ---- Honest completeness report ----
  const pct = (k) => {
    const n = wrecks.filter((f) => f.properties[k] != null).length;
    return `${n} (${((n / wrecks.length) * 100).toFixed(1)}%)`;
  };
  console.log('\n  attribute completeness — "n/a" counted as EMPTY:');
  for (const [k, lab] of [['name', 'name'], ['type', 'vessel type'], ['sunk', 'year sunk'],
    ['depth', 'depth'], ['flag', 'flag state'], ['circ', 'circumstances'], ['cargo', 'cargo']]) {
    console.log(`     ${lab.padEnd(16)} ${pct(k)}`);
  }
  const bare = wrecks.filter((f) => !f.properties.name && !f.properties.sunk).length;
  console.log(`     ${'NEITHER name NOR date'.padEnd(16)} ${bare} (${((bare / wrecks.length) * 100).toFixed(1)}%)`);

  const years = wrecks.map((f) => f.properties.sunk).filter(Boolean).sort((a, b) => a - b);
  console.log(`\n  year sunk: ${years[0]} – ${years[years.length - 1]}, median ${years[Math.floor(years.length / 2)]}`);
  const cats = new Map();
  for (const f of wrecks) cats.set(f.properties.cat, (cats.get(f.properties.cat) ?? 0) + 1);
  console.log('  by category:');
  for (const [k, v] of [...cats].sort((a, b) => b[1] - a[1])) console.log(`     ${String(k).padEnd(52)} ${v}`);

  console.log(`\nWrote wrecks.geojson — ${wrecks.length} wrecks, ${mb(Buffer.byteLength(wTxt))}`);
  console.log(`Wrote wrecks-protected.geojson — ${prot.length} sites, ${mb(Buffer.byteLength(pTxt))}`);
}

main().catch((err) => {
  console.error('Failed to build wrecks data:', err.message);
  process.exit(1);
});
