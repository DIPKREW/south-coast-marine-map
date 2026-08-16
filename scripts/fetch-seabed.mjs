/**
 * Fetch the SEABED HABITAT map for the project corridor — what the sea floor is
 * actually made of — and bundle it at public/data/seabed.geojson.
 *
 * Run with: npm run data:seabed
 *
 * SOURCE, and what was ruled out on the way
 * -----------------------------------------
 * `emodnet_open:ukseamap_latest_habitats` from the EMODnet Seabed Habitats WFS.
 * That is JNCC's own UKSeaMap — the UK component of the UK Atlas of Seabed
 * Habitats — served through EMODnet's public GeoServer. No key, no registration.
 *
 * It is the PREDICTIVE, full-coverage map: a broad-scale model of habitat from
 * bathymetry, substrate, light and energy layers, NOT a record of what anyone
 * has been down and looked at. EMODnet does publish survey data, but only as
 * ~1,200 separate per-survey layers in its map library, with no single combined
 * national "predictive + surveyed" polygon layer that can be queried in one go.
 * So there is no field distinguishing modelled from surveyed here, because every
 * polygon is modelled — which the About text has to say plainly.
 *
 * REJECTED: the "UK SeaMap 2018" ArcGIS feature service that turns up first in a
 * search (services5.arcgis.com/ZWXz0JpKJ0L63uwv). It is a third-party re-host
 * and it is a CORNWALL-ONLY EXTRACT — its declared extent is EPSG:27700
 * 58k–264k E, and it returns zero features east of -3.5°E, i.e. nothing from
 * Dorset eastward. It also disagreed with EMODnet on EUNIS code at the sample
 * points where both had coverage. Using it would have silently produced a map
 * with habitat in Cornwall and blank sea everywhere else.
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import mapshaper from 'mapshaper';
import { SOUTH_COAST_BBOX, BEACHY_HEAD_LON } from './lib/southcoast.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, '../public/data/seabed.geojson');

const WFS = 'https://ows.emodnet-seabedhabitats.eu/geoserver/emodnet_open/wfs';
const TYPE = 'emodnet_open:ukseamap_latest_habitats';
const PAGE = 5000;

// The corridor: the west/north/south edges of the project bbox, with the hard
// Beachy Head cutoff on the east — the same eastern edge the storm overflow and
// water body layers use.
const [W, S, , N] = SOUTH_COAST_BBOX;
const E = BEACHY_HEAD_LON;

/**
 * EUNIS → the six top-level groups the map actually colours.
 *
 * PROPOSED GROUPING, FLAGGED FOR REVIEW — not treated as final. EUNIS is
 * hierarchical, and the level-2/3 prefix carries the substrate, which is the
 * thing a reader can actually see a difference between:
 *
 *   A1/A2      littoral (intertidal) rock and sediment → 'intertidal'
 *   A3         infralittoral rock (shallow, lit)        ┐
 *   A4         circalittoral rock (deeper)              ┘ → 'rock'
 *   A5.1       sublittoral coarse sediment              → 'coarse'
 *   A5.2       sublittoral sand                         → 'sand'
 *   A5.3       sublittoral mud                          → 'mud'
 *   A5.4       sublittoral mixed sediment               → 'mixed'
 *   A5.5       sublittoral macrophyte (seagrass, kelp)  → 'biogenic'
 *   A5.6       biogenic reef                            → 'biogenic'
 *   A5 (bare)  sublittoral sediment, undifferentiated   → 'sediment'
 *
 * Rock is deliberately NOT split into infralittoral/circalittoral: that is a
 * depth-zone distinction, not a substrate one, and three shades of rock would
 * read as three materials. Seagrass/kelp beds and biogenic reef are merged into
 * one "biogenic" class because both are living structure on the seabed rather
 * than a sediment type — and, on this coastline, because there is very little of
 * either in the predictive map (reported on every run, so the merge can be
 * revisited if it turns out to matter).
 */
function groupFor(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c || c === 'NA') return 'unknown';
  if (/^A[12]/.test(c)) return 'intertidal';
  if (/^A[34]/.test(c)) return 'rock';
  if (/^A5\.1/.test(c)) return 'coarse';
  if (/^A5\.2/.test(c)) return 'sand';
  if (/^A5\.3/.test(c)) return 'mud';
  if (/^A5\.4/.test(c)) return 'mixed';
  if (/^A5\.[56]/.test(c)) return 'biogenic';
  if (/^A5/.test(c)) return 'sediment';
  if (/^A6/.test(c)) return 'deep';
  return 'unknown';
}

async function fetchPage(startIndex) {
  const qs = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: TYPE,
    count: String(PAGE),
    startIndex: String(startIndex),
    outputFormat: 'application/json',
    // srsName is NOT optional. Without it GeoServer answers in the layer's
    // native EPSG:3857 metres, which silently produces a file that looks fine
    // until every later degree-based clip matches nothing.
    srsName: 'urn:ogc:def:crs:EPSG::4326',
    // With the urn form the bbox axis order is lat,lon — minY,minX,maxY,maxX.
    bbox: `${S},${W},${N},${E},urn:ogc:def:crs:EPSG::4326`,
  });
  const res = await fetch(`${WFS}?${qs}`);
  if (!res.ok) throw new Error(`WFS ${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json.exceptions) throw new Error(JSON.stringify(json.exceptions).slice(0, 200));
  return json;
}

// Optional on-disk cache of the raw WFS pull. 51k polygons is a ~50 MB download;
// set SEABED_CACHE to a path to keep it between runs while tuning the geometry
// pipeline. Not used by a normal build.
const CACHE = process.env.SEABED_CACHE;

async function fetchAllRaw() {
  if (CACHE) {
    try {
      const cached = JSON.parse(await readFile(CACHE, 'utf8'));
      console.log(`  using cached raw pull (${cached.length} polygons) from ${CACHE}`);
      return cached;
    } catch { /* no cache yet — fall through and fetch */ }
  }
  const first = await fetchPage(0);
  const total = first.numberMatched ?? first.features.length;
  console.log(`  ${total} habitat polygons in the corridor; paging…`);

  const raw = [...first.features];
  for (let i = PAGE; i < total; i += PAGE) {
    const page = await fetchPage(i);
    raw.push(...(page.features ?? []));
    process.stdout.write(`\r    fetched ${raw.length}/${total}…`);
  }
  process.stdout.write('\n');
  if (raw.length < total) throw new Error(`Incomplete fetch: ${raw.length}/${total}`);
  if (CACHE) await writeFile(CACHE, JSON.stringify(raw));
  return raw;
}

async function main() {
  console.log('Fetching seabed habitats (JNCC UKSeaMap via EMODnet Seabed Habitats WFS)…');
  console.log(`  corridor [W,S,E,N] = ${W}, ${S}, ${E}, ${N}   (east edge = Beachy Head cutoff)`);

  const raw = await fetchAllRaw();

  // ---- Inventory, before any grouping, so the grouping can be reviewed. ----
  const byCode = new Map();
  const byGroup = new Map();
  for (const f of raw) {
    const p = f.properties ?? {};
    const code = p.eunis_code || 'NA';
    if (!byCode.has(code)) byCode.set(code, { n: 0, name: p.eunis_name || p.mhc_name || '', grp: groupFor(code) });
    byCode.get(code).n++;
    const g = groupFor(code);
    byGroup.set(g, (byGroup.get(g) ?? 0) + 1);
  }

  console.log(`\n  ${byCode.size} distinct EUNIS classes in the corridor:`);
  for (const [code, v] of [...byCode].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`     ${String(code).padEnd(16)} ${String(v.n).padStart(6)}  →  ${v.grp.padEnd(11)} ${v.name}`);
  }
  console.log(`\n  grouped into ${byGroup.size}:`);
  for (const [g, n] of [...byGroup].sort((a, b) => b[1] - a[1])) console.log(`     ${g.padEnd(12)} ${String(n).padStart(6)}`);

  // ---- Normalise. Keep the EUNIS detail for the hover card; the group drives
  // the colour, so the map reads as materials rather than a code list.
  const features = raw
    .filter((f) => f.geometry?.coordinates?.length)
    .map((f) => {
      const p = f.properties ?? {};
      return {
        type: 'Feature',
        properties: {
          grp: groupFor(p.eunis_code),
          code: p.eunis_code || null,
          // The EUNIS name and JNCC's Marine Habitat Classification name are
          // often identical; keep the JNCC one only when it adds something.
          name: p.eunis_name || p.mhc_name || null,
          jncc: p.mhc_name && p.mhc_name !== p.eunis_name ? p.mhc_name : null,
          zone: p.location || null, // Inshore | Offshore
        },
        geometry: f.geometry,
      };
    });

  // ---- Dissolve adjacent polygons sharing an EUNIS class, clip to the
  // corridor, then simplify. Dissolving first is what makes this publishable:
  // it removes the internal edges between the tens of thousands of same-class
  // neighbours the model emits, without losing any class detail.
  console.log('\n  Dissolving by EUNIS class, clipping to the corridor, simplifying…');
  const cmd =
    `-i in.geojson -dissolve2 grp,code,name,jncc,zone copy-fields=grp,code,name,jncc,zone ` +
    `-clip bbox=${W},${S},${E},${N} ` +
    `-simplify 6% keep-shapes ` +
    `-o precision=0.0001 format=geojson out.geojson`;
  const result = await mapshaper.applyCommands(cmd, {
    'in.geojson': JSON.stringify({ type: 'FeatureCollection', features }),
  });
  const out = result['out.geojson'];
  if (!out) throw new Error('dissolve produced no output');

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, out);

  const fc = JSON.parse(out);
  const kept = (fc.features ?? []).filter((f) => f.geometry);
  const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
  console.log(`\nWrote ${OUT} — ${raw.length} source polygons → ${kept.length} dissolved, ${kb} KB.`);
  const groups = new Map();
  for (const f of kept) groups.set(f.properties.grp, (groups.get(f.properties.grp) ?? 0) + 1);
  console.log('  dissolved features per group:');
  for (const [g, n] of [...groups].sort((a, b) => b[1] - a[1])) console.log(`     ${g.padEnd(12)} ${n}`);
}

main().catch((err) => {
  console.error('Failed to build seabed habitat data:', err.message);
  process.exit(1);
});
