/**
 * Build the "Marine species" grid from the NBN Atlas occurrence service.
 *
 * Run with: npm run data:marine-species
 *
 * The marine sibling of build-species.mjs, and deliberately the SAME machinery:
 * both import scripts/lib/osgrid.mjs, so the grid-reference parsing, the
 * resolution-honesty rule and the NBN facet queries are one implementation, not
 * two. What changes here is the species list (marine mammals, marine fish and
 * cephalopods instead of heathland reptiles and butterflies) and the area (the
 * project corridor instead of the Dorset LNRS boundary).
 *
 * As with the land layer: NO individual record coordinates are ever stored. We
 * facet on NBN's own pre-computed grid-reference fields, so the output is
 * "recorded in this square, this many times" and nothing finer.
 *
 * A marine-specific honesty problem, which the About text has to carry: at sea,
 * recording effort is wildly uneven. Records cluster on ferry routes, survey
 * transects, dive sites and headlands people watch from. Empty squares mean
 * nobody looked, far more often than they mean nothing is there. And the
 * cetaceans and seals here are recorded almost entirely at 10 km resolution,
 * so their cells are coarse by nature, not by our choice.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SOUTH_COAST_BBOX, BEACHY_HEAD_LON } from './lib/southcoast.mjs';
import { parseGridRef, cellPolygon, cellCentre, bboxWkt, resolutionProfile, gridCells } from './lib/osgrid.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, '../public/data/marine-species-grid.geojson');

// The corridor: the project bbox's west/north/south edges, with the hard Beachy
// Head cutoff on the east — the same eastern edge the storm overflow, water body
// and seabed habitat layers use.
const [W, S, , N] = SOUTH_COAST_BBOX;
const E = BEACHY_HEAD_LON;
const CORRIDOR = [W, S, E, N];
const WKT = bboxWkt(CORRIDOR);

/**
 * The curated flagship list. Every one of these was CHECKED against NBN for this
 * corridor before being included — none is aspirational. Record counts at the
 * time of writing are in the comments, and the script reports the live figures
 * on every run, so a species that quietly drops to nothing will show up.
 *
 * Chosen for spread across the three groups the brief asked for, and for being
 * recognisable enough that a reader knows what they are looking at.
 */
const SPECIES = [
  // ---- Marine mammals. All recorded at 10 km resolution only. ----
  { key: 'greyseal', sci: 'Halichoerus grypus', common: 'Grey seal', group: 'Marine mammal' }, // ~11,900
  { key: 'commondolphin', sci: 'Delphinus delphis', common: 'Common dolphin', group: 'Marine mammal' }, // ~10,700
  { key: 'porpoise', sci: 'Phocoena phocoena', common: 'Harbour porpoise', group: 'Marine mammal' }, // ~9,650
  { key: 'bottlenose', sci: 'Tursiops truncatus', common: 'Bottlenose dolphin', group: 'Marine mammal' }, // ~1,650
  // ---- Marine fish ----
  { key: 'baskingshark', sci: 'Cetorhinus maximus', common: 'Basking shark', group: 'Marine fish' }, // ~7,450
  { key: 'bluefin', sci: 'Thunnus thynnus', common: 'Atlantic bluefin tuna', group: 'Marine fish' }, // ~1,575
  { key: 'seahorse', sci: 'Hippocampus guttulatus', common: 'Spiny seahorse', group: 'Marine fish' }, // ~32, blurred
  // ---- Cephalopods ----
  { key: 'cuttlefish', sci: 'Sepia officinalis', common: 'Common cuttlefish', group: 'Cephalopod' }, // ~1,200
];

const inCorridor = ([lon, lat]) => lon >= W && lon <= E && lat >= S && lat <= N;

async function main() {
  console.log('Building the marine species grid from the NBN Atlas…');
  console.log(`  corridor [W,S,E,N] = ${CORRIDOR.join(', ')}   (east edge = Beachy Head cutoff)`);

  const features = [];
  const report = [];

  for (const sp of SPECIES) {
    const prof = await resolutionProfile(WKT, sp.sci);
    if (prof.total === 0) {
      report.push({ sp, total: 0, cells: 0, res: null, note: 'NO RECORDS in the corridor — nothing drawn' });
      continue;
    }

    const cells = await gridCells(WKT, sp.sci, prof.res);
    let kept = 0;
    let outside = 0;
    let unparsed = 0;
    let records = 0;
    for (const { ref, count } of cells) {
      const parsed = parseGridRef(ref);
      if (!parsed) {
        unparsed++;
        continue;
      }
      // A grid square is kept when its CENTRE falls in the corridor, so the
      // eastern cutoff is applied the same way as for every other layer.
      if (!inCorridor(cellCentre(parsed.e, parsed.n, parsed.size))) {
        outside++;
        continue;
      }
      features.push({
        type: 'Feature',
        properties: { sp: sp.key, n: count, res: parsed.size },
        geometry: cellPolygon(parsed.e, parsed.n, parsed.size),
      });
      kept++;
      records += count;
    }
    const binned = Object.entries(prof.dist).reduce((a, [k, c]) => a + (Number(k) <= prof.res ? c : 0), 0);
    report.push({ sp, total: prof.total, cells: kept, res: prof.res, records, binned, outside, unparsed });
  }

  await mkdir(dirname(OUT), { recursive: true });
  const out = JSON.stringify({ type: 'FeatureCollection', features });
  await writeFile(OUT, out);

  console.log('\nPer-species coverage in the corridor (NBN Atlas):');
  for (const r of report) {
    if (!r.total) {
      console.log(`  ${r.sp.common.padEnd(24)} ${r.note}`);
      continue;
    }
    console.log(
      `  ${r.sp.common.padEnd(24)} ${String(r.total).padStart(6)} records → ${r.res / 1000} km grid, ` +
        `${String(r.cells).padStart(4)} cells, ${r.records} records binned` +
        `${r.binned < r.total ? ` (${r.total - r.binned} coarser than ${r.res} m, excluded)` : ''}` +
        `${r.outside ? `, ${r.outside} cells outside corridor` : ''}` +
        `${r.unparsed ? `, ${r.unparsed} unparsed refs` : ''}`,
    );
  }
  const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
  console.log(`\nWrote ${OUT} — ${features.length} grid cells across ${SPECIES.length} species, ${kb} KB.`);
  console.log('   GRID ONLY — no individual record coordinates stored.');
}

main().catch((err) => {
  console.error('Failed to build marine species grid:', err.message);
  process.exit(1);
});
