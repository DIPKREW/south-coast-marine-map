/**
 * Build the "Notable species" grid from the NBN Atlas occurrence service.
 *
 * Run with: npm run data:species
 *
 * We do NOT render individual records (millions, recording-biased, and sensitive
 * species are protected). Instead, for each curated flagship species we ask the
 * NBN occurrence API to FACET on its own pre-computed OS grid-reference field —
 * giving "recorded in this grid square" + a count per cell, with no point data.
 *
 * HONESTY: NBN blurs sensitive species to a coarse grid. We pick, per species,
 * the grid resolution the data actually supports (10 km for the heavily-blurred
 * heathland species, 2 km where most records are finer) and only ever bin records
 * at-or-finer than that resolution — so a cell never implies more precision than
 * NBN published. Per-species record + cell counts are reported.
 *
 * Output: ONE small GeoJSON of grid-square polygons (public/data/species-grid.geojson),
 * each feature { sp, n, res } — species key, record count, cell size (m). No
 * individual coordinates are stored.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import proj4 from 'proj4';
import { DORSET_BBOX, MASK_PATH } from './lib/dorset.mjs';
import { pointInGeometry } from './lib/geo.mjs';
import { readFile } from 'node:fs/promises';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, '../public/data/species-grid.geojson');

const API = 'https://records-ws.nbnatlas.org/occurrences/search';
const UA = 'dorset-nature-map/1.0 (data build; contact benthorne77@gmail.com)';

// British National Grid → WGS84 (display-grade).
proj4.defs('EPSG:27700', '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 ' +
  '+ellps=airy +towgs84=446.448,-125.157,542.060,0.1502,0.2470,0.8421,-20.4894 +units=m +no_defs');
const toWgs = proj4('EPSG:27700', 'EPSG:4326');

const SPECIES = [
  { key: 'sandlizard', sci: 'Lacerta agilis', common: 'Sand lizard' },
  { key: 'smoothsnake', sci: 'Coronella austriaca', common: 'Smooth snake' },
  { key: 'ssblue', sci: 'Plebejus argus', common: 'Silver-studded blue' },
  { key: 'ladybirdspider', sci: 'Eresus sandaliatus', common: 'Ladybird spider' },
  { key: 'dartford', sci: 'Curruca undata', common: 'Dartford warbler' },
  { key: 'nightjar', sci: 'Caprimulgus europaeus', common: 'Nightjar' },
  { key: 'gcnewt', sci: 'Triturus cristatus', common: 'Great crested newt' },
  { key: 'lulworth', sci: 'Thymelicus acteon', common: 'Lulworth skipper' },
];

const WKT = `POLYGON((${DORSET_BBOX[0]} ${DORSET_BBOX[1]},${DORSET_BBOX[2]} ${DORSET_BBOX[1]},${DORSET_BBOX[2]} ${DORSET_BBOX[3]},${DORSET_BBOX[0]} ${DORSET_BBOX[3]},${DORSET_BBOX[0]} ${DORSET_BBOX[1]}))`;

async function search(params) {
  const usp = new URLSearchParams({ wkt: WKT, pageSize: '0', facet: 'on', ...params });
  const res = await fetch(`${API}?${usp}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`NBN API → ${res.status} ${res.statusText}`);
  return res.json();
}

// ---- OS grid reference → BNG easting/northing + cell size --------------
const TETRAD = 'ABCDEFGHIJKLMNPQRSTUVWXYZ'; // 5×5, no 'O'

function letterPairEN(s) {
  let c1 = s.charCodeAt(0) - 65, c2 = s.charCodeAt(1) - 65;
  if (c1 > 7) c1--; // skip 'I'
  if (c2 > 7) c2--;
  const e = ((c1 - 2) % 5) * 5 + (c2 % 5);
  const n = (19 - Math.floor(c1 / 5) * 5) - Math.floor(c2 / 5);
  return [e * 100000, n * 100000];
}

function parseGridRef(ref) {
  ref = ref.trim().toUpperCase();
  let [e, n] = letterPairEN(ref.slice(0, 2));
  const rest = ref.slice(2);
  const tetrad = /^(\d)(\d)([A-Z])$/.exec(rest); // 2 km, e.g. SY99R
  if (tetrad) {
    e += +tetrad[1] * 10000; n += +tetrad[2] * 10000;
    const idx = TETRAD.indexOf(tetrad[3]);
    e += Math.floor(idx / 5) * 2000; n += (idx % 5) * 2000;
    return { e, n, size: 2000 };
  }
  const tenk = /^(\d)(\d)$/.exec(rest); // 10 km, e.g. SY99
  if (tenk) {
    e += +tenk[1] * 10000; n += +tenk[2] * 10000;
    return { e, n, size: 10000 };
  }
  return null;
}

function cellPolygon(e, n, size) {
  const corners = [[e, n], [e + size, n], [e + size, n + size], [e, n + size], [e, n]];
  return { type: 'Polygon', coordinates: [corners.map(([x, y]) => { const [lon, lat] = toWgs.forward([x, y]); return [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6]; })] };
}

async function main() {
  const maskGeom = JSON.parse(await readFile(MASK_PATH, 'utf8')).features[0].geometry;
  const features = [];
  const report = [];

  for (const sp of SPECIES) {
    const taxonFq = `taxon_name:"${sp.sci}"`;
    // 1) resolution distribution → choose the honest cell size.
    const resFacet = await search({ fq: taxonFq, facets: 'gridSizeInMeters', flimit: '-1' });
    const total = resFacet.totalRecords || 0;
    const dist = {};
    for (const f of resFacet.facetResults || []) for (const v of f.fieldResult || []) dist[v.label] = v.count;
    const fine = Object.entries(dist).reduce((a, [k, c]) => a + (Number(k) <= 2000 ? c : 0), 0);
    const coarse = Object.entries(dist).reduce((a, [k, c]) => a + (Number(k) > 2000 ? c : 0), 0);
    const res = fine > coarse ? 2000 : 10000;
    const field = res === 2000 ? 'grid_ref_2000' : 'grid_ref_10000';

    if (total === 0) {
      report.push(`  ${sp.common} (${sp.sci}): 0 records in Dorset — REPORTED, no cells drawn.`);
      continue;
    }

    // 2) facet on the grid field, only records at-or-finer than the chosen res.
    // Two fq params (taxon + resolution) need separate appends.
    const usp = new URLSearchParams();
    usp.append('wkt', WKT); usp.append('pageSize', '0'); usp.append('facet', 'on');
    usp.append('fq', taxonFq); usp.append('fq', `gridSizeInMeters:[1 TO ${res}]`);
    usp.append('facets', field); usp.append('flimit', '-1');
    const res2 = await fetch(`${API}?${usp}`, { headers: { 'User-Agent': UA } });
    const gf = await res2.json();

    let cells = 0, dropped = 0;
    for (const f of gf.facetResults || []) {
      for (const v of f.fieldResult || []) {
        const parsed = parseGridRef(v.label || '');
        if (!parsed) { dropped++; continue; }
        const geom = cellPolygon(parsed.e, parsed.n, parsed.size);
        // keep cells whose centre falls within the Dorset LNRS area
        const [lon, lat] = toWgs.forward([parsed.e + parsed.size / 2, parsed.n + parsed.size / 2]);
        if (!pointInGeometry([lon, lat], maskGeom)) continue;
        features.push({ type: 'Feature', properties: { sp: sp.key, n: v.count, res: parsed.size }, geometry: geom });
        cells++;
      }
    }
    const usedFine = Object.entries(dist).reduce((a, [k, c]) => a + (Number(k) <= res ? c : 0), 0);
    report.push(`  ${sp.common} (${sp.sci}): ${total} records → ${res / 1000} km grid, ${cells} Dorset cells (binned ${usedFine}/${total} records at ≤${res} m res${dropped ? `, ${dropped} unparsed refs` : ''}).`);
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({ type: 'FeatureCollection', features }));
  const kb = (Buffer.byteLength(JSON.stringify({ type: 'FeatureCollection', features })) / 1024).toFixed(0);
  console.log('Per-species coverage (NBN Atlas):');
  report.forEach((r) => console.log(r));
  console.log(`Wrote ${OUT} — ${features.length} grid cells across ${SPECIES.length} species, ${kb} KB.`);
  console.log('   GRID ONLY — no individual record coordinates stored.');
}

main().catch((err) => {
  console.error('Failed to build species grid:', err.message);
  process.exit(1);
});
