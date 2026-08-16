/**
 * Build the "Marine species" data from the NBN Atlas occurrence service —
 * ONE FILE PER SPECIES, each a set of POINT markers placed in the SEA.
 *
 * Run with: npm run data:marine-species
 *
 * Shares its machinery with the Dorset land species grid: both import
 * scripts/lib/osgrid.mjs, so the grid-reference parsing, the resolution-honesty
 * rule and the NBN facet queries are one implementation. No individual record
 * coordinates are ever stored — we facet on NBN's own pre-computed grid-reference
 * fields, so the output is "recorded in this square, this many times".
 *
 * TWO THINGS THIS DOES THAT THE LAND LAYER DOESN'T
 * ------------------------------------------------
 * 1. ONE FILE PER SPECIES (public/data/marine-species/<key>.geojson), so the map
 *    can fetch a species the first time it is ticked and never again — 18 species
 *    in one file would mean downloading all of them to see one.
 *
 * 2. SEA-CORRECTED MARKER POSITIONS. A grid square's geometric centre is a
 *    property of the grid, not of the sea: for a coastal square it frequently
 *    falls inland, which would put a seal marker in a field. So every occupied
 *    square has the LAND subtracted from it and the marker placed in what's left.
 *    Specifics that matter:
 *      • If the sea remainder breaks into several disconnected pieces — a square
 *        spanning a headland, say — the LARGEST piece wins. Counted and reported.
 *      • A polygon's area centroid can fall OUTSIDE a concave piece (a C-shaped
 *        bay). Every centroid is therefore tested, and a guaranteed-interior
 *        point substituted where it fails. Counted and reported.
 *      • A square with no sea at all is reported as an anomaly, not silently
 *        given its raw centre.
 *
 * COASTLINE SOURCE
 * ----------------
 * ONS "Countries (December 2025) Boundaries UK BFC" — BFC meaning Full
 * resolution, Clipped to the coastline (mean high water). Open Government
 * Licence, no key, and it fits the ArcGIS fetch pattern the rest of this pipeline
 * already uses. Nothing in the repo could do this job: the only committed
 * boundary is scripts/dorset-lnrs-area.geojson, which is Dorset-only, and the
 * basemap's coastline is vector tiles resolved in the browser, not a build-time
 * polygon. Natural Earth 10m was rejected as the fallback: at 1:10,000,000 it
 * does not resolve Poole Harbour or the Fal, which is exactly where this
 * correction has to work. At the ~11 m generalisation used here the ONS boundary
 * gets Brownsea Island, Carrick Roads, Portland and the Fleet right; the one
 * known miss is Weymouth's inner harbour channel, ~80 m wide, which closes up.
 */
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import mapshaper from 'mapshaper';
import { SOUTH_COAST_BBOX, BEACHY_HEAD_LON } from './lib/southcoast.mjs';
import { pointInGeometry, areaM2 } from './lib/geo.mjs';
import { parseGridRef, cellPolygon, cellCentre, bboxWkt, resolutionProfile, gridCells } from './lib/osgrid.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dir, '../public/data/marine-species');

const [W, S, , N] = SOUTH_COAST_BBOX;
const E = BEACHY_HEAD_LON;
const CORRIDOR = [W, S, E, N];
const WKT = bboxWkt(CORRIDOR);

const LAND =
  'https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services/' +
  'Countries_December_2025_Boundaries_UK_BFC/FeatureServer/0/query';

/**
 * The 18 flagship species, grouped as the panel groups them. Every one was
 * checked against NBN for this corridor before inclusion; the script reports
 * live record and cell counts on every run, so a species that drops to nothing
 * shows up rather than silently vanishing.
 */
const SPECIES = [
  // ---- Marine mammals ----
  { key: 'greyseal', sci: 'Halichoerus grypus', common: 'Grey seal', group: 'mammal' },
  { key: 'harbourseal', sci: 'Phoca vitulina', common: 'Harbour seal', group: 'mammal' },
  { key: 'commondolphin', sci: 'Delphinus delphis', common: 'Common dolphin', group: 'mammal' },
  { key: 'bottlenose', sci: 'Tursiops truncatus', common: 'Bottlenose dolphin', group: 'mammal' },
  { key: 'porpoise', sci: 'Phocoena phocoena', common: 'Harbour porpoise', group: 'mammal' },
  { key: 'minkewhale', sci: 'Balaenoptera acutorostrata', common: 'Minke whale', group: 'mammal' },
  // ---- Sharks & rays ----
  { key: 'baskingshark', sci: 'Cetorhinus maximus', common: 'Basking shark', group: 'elasmo' },
  { key: 'tope', sci: 'Galeorhinus galeus', common: 'Tope', group: 'elasmo' },
  { key: 'thornbackray', sci: 'Raja clavata', common: 'Thornback ray', group: 'elasmo' },
  { key: 'undulateray', sci: 'Raja undulata', common: 'Undulate ray', group: 'elasmo' },
  // ---- Fish ----
  { key: 'bluefin', sci: 'Thunnus thynnus', common: 'Atlantic bluefin tuna', group: 'fish' },
  { key: 'seahorse', sci: 'Hippocampus guttulatus', common: 'Spiny seahorse', group: 'fish' },
  { key: 'shortseahorse', sci: 'Hippocampus hippocampus', common: 'Short-snouted seahorse', group: 'fish' },
  // ---- Cephalopods ----
  { key: 'cuttlefish', sci: 'Sepia officinalis', common: 'Common cuttlefish', group: 'ceph' },
  { key: 'curledoctopus', sci: 'Eledone cirrhosa', common: 'Curled octopus', group: 'ceph' },
  { key: 'commonoctopus', sci: 'Octopus vulgaris', common: 'Common octopus', group: 'ceph' },
  { key: 'europeansquid', sci: 'Loligo vulgaris', common: 'European squid', group: 'ceph' },
  { key: 'veinedsquid', sci: 'Loligo forbesii', common: 'Veined squid', group: 'ceph' },
];

const inCorridor = ([lon, lat]) => lon >= W && lon <= E && lat >= S && lat <= N;

// ---- geometry helpers -----------------------------------------------------

/** Split a Polygon / MultiPolygon into its separate polygon parts. */
const parts = (g) =>
  !g ? [] : g.type === 'MultiPolygon' ? g.coordinates.map((c) => ({ type: 'Polygon', coordinates: c })) : [g];

/** Area-weighted centroid of a polygon's outer ring. */
function ringCentroid(ring) {
  let a = 0, x = 0, y = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f;
    x += (ring[j][0] + ring[i][0]) * f;
    y += (ring[j][1] + ring[i][1]) * f;
  }
  if (!a) return ring[0];
  return [x / (3 * a), y / (3 * a)];
}

/**
 * A point guaranteed to lie INSIDE the polygon. Used when the area centroid
 * falls outside, which happens for concave shapes — a C-shaped bay wrapped round
 * a headland has its centroid on the headland.
 *
 * Sweeps horizontal scan-lines, takes the widest interior span on each, and
 * returns the midpoint of the widest span found. Robust and needs no library.
 */
function interiorPoint(poly, land) {
  const ring = poly.coordinates[0];
  let y0 = Infinity, y1 = -Infinity;
  for (const [, y] of ring) {
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  let best = null, bestSpan = -1;
  const STEPS = 24;
  for (let s = 1; s < STEPS; s++) {
    const y = y0 + ((y1 - y0) * s) / STEPS;
    // x-intersections of every ring (outer + holes) with this scan-line
    const xs = [];
    for (const r of poly.coordinates) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i], [xj, yj] = r[j];
        if (yi > y !== yj > y) xs.push(xi + ((xj - xi) * (y - yi)) / (yj - yi));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const span = xs[i + 1] - xs[i];
      const mid = [(xs[i] + xs[i + 1]) / 2, y];
      // Must be inside the sea fragment AND outside land. The second test is not
      // redundant: the fragment came from an erase, so its edge and the coastline
      // are the same line, and a midpoint can land a few metres the wrong side of
      // it through ordinary floating-point slack.
      if (span > bestSpan && pointInGeometry(mid, poly) && !(land && pointInGeometry(mid, land))) {
        bestSpan = span;
        best = mid;
      }
    }
  }
  return best;
}

async function fetchLand() {
  const qs = new URLSearchParams({
    where: "CTRY25NM='England'",
    geometry: [W - 0.15, S - 0.1, E + 0.15, N + 0.1].join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'CTRY25NM',
    returnGeometry: 'true',
    outSR: '4326',
    maxAllowableOffset: '0.0001', // ≈11 m — keeps estuaries, drops noise
    geometryPrecision: '6',
    f: 'geojson',
  });
  const res = await fetch(`${LAND}?${qs}`);
  if (!res.ok) throw new Error(`coastline fetch failed: ${res.status} ${res.statusText}`);
  const json = await res.json();
  const f = (json.features ?? []).find((x) => x.geometry);
  if (!f) throw new Error('coastline fetch returned no geometry');
  return f;
}

async function main() {
  console.log('Building the marine species markers from the NBN Atlas…');
  console.log(`  corridor [W,S,E,N] = ${CORRIDOR.join(', ')}   (east edge = Beachy Head cutoff)`);

  console.log('\n  Fetching the ONS coastline (Countries 2025 BFC, England)…');
  const landFeature = await fetchLand();
  let landVerts = 0;
  const countV = (c) => { if (typeof c[0] === 'number') landVerts++; else c.forEach(countV); };
  countV(landFeature.geometry.coordinates);
  console.log(`    ${landVerts.toLocaleString('en-GB')} coastline vertices`);

  // ---- 1. Pull every species' occupied grid squares. ----
  const perSpecies = new Map();
  const report = [];
  for (const sp of SPECIES) {
    const prof = await resolutionProfile(WKT, sp.sci);
    if (prof.total === 0) {
      report.push({ sp, total: 0, cells: 0, res: null, note: 'NO RECORDS — nothing written' });
      perSpecies.set(sp.key, []);
      continue;
    }
    const cells = await gridCells(WKT, sp.sci, prof.res);
    const kept = [];
    let outside = 0, unparsed = 0, records = 0;
    for (const { ref, count } of cells) {
      const parsed = parseGridRef(ref);
      if (!parsed) { unparsed++; continue; }
      if (!inCorridor(cellCentre(parsed.e, parsed.n, parsed.size))) { outside++; continue; }
      kept.push({ ...parsed, count });
      records += count;
    }
    perSpecies.set(sp.key, kept);
    const binned = Object.entries(prof.dist).reduce((a, [k, c]) => a + (Number(k) <= prof.res ? c : 0), 0);
    report.push({ sp, total: prof.total, cells: kept.length, res: prof.res, records, binned, outside, unparsed });
    process.stdout.write(`\r    ${sp.common}: ${kept.length} cells            `);
  }
  process.stdout.write('\n');

  // ---- 2. Subtract land from every occupied square, in ONE pass. ----
  const all = [];
  for (const sp of SPECIES) {
    for (const [i, c] of (perSpecies.get(sp.key) ?? []).entries()) {
      all.push({
        type: 'Feature',
        properties: { k: `${sp.key}:${i}` },
        geometry: cellPolygon(c.e, c.n, c.size),
      });
    }
  }
  console.log(`\n  Subtracting land from ${all.length} occupied grid squares…`);
  const res = await mapshaper.applyCommands(
    '-i cells.geojson -erase land.geojson -o precision=0.000001 format=geojson out.geojson',
    {
      'cells.geojson': JSON.stringify({ type: 'FeatureCollection', features: all }),
      'land.geojson': JSON.stringify({ type: 'FeatureCollection', features: [landFeature] }),
    },
  );
  const clipped = JSON.parse(res['out.geojson']).features ?? [];
  const seaByKey = new Map(clipped.map((f) => [f.properties.k, f.geometry]));

  // ---- 3. Place a marker in the sea remainder of each square. ----
  const stats = { touchedLand: 0, multiPiece: 0, centroidOutside: 0, noSea: [], unplaceable: [], total: 0 };
  const landGeom = landFeature.geometry;
  const points = new Map(SPECIES.map((s) => [s.key, []]));
  for (const sp of SPECIES) {
    for (const [i, c] of (perSpecies.get(sp.key) ?? []).entries()) {
      stats.total++;
      const key = `${sp.key}:${i}`;
      const sea = seaByKey.get(key);
      const cellCentreLL = cellCentre(c.e, c.n, c.size);
      const cellPoly = cellPolygon(c.e, c.n, c.size);
      const cellArea = areaM2(cellPoly);

      if (!sea) {
        // Erase removed the square entirely → no sea at all. An anomaly for a
        // marine record; reported, never silently given its raw centre.
        stats.noSea.push({ sp: sp.common, ref: `${c.e},${c.n}`, at: cellCentreLL, res: c.size });
        continue;
      }

      const ps = parts(sea);
      const seaArea = ps.reduce((a, p) => a + areaM2(p), 0);
      // "Touched land" = the erase actually removed something worth counting.
      if (seaArea < cellArea * 0.999) stats.touchedLand++;
      if (ps.length > 1) stats.multiPiece++;

      // Largest piece wins.
      let best = ps[0], bestA = -1;
      for (const p of ps) {
        const a = areaM2(p);
        if (a > bestA) { bestA = a; best = p; }
      }
      let pt = ringCentroid(best.coordinates[0]);
      // Reject the area centroid if it is outside its own (concave) piece, or if
      // it has slipped across the coastline into land.
      if (!pointInGeometry(pt, best) || pointInGeometry(pt, landGeom)) {
        const inner = interiorPoint(best, landGeom);
        if (inner) { pt = inner; stats.centroidOutside++; }
        else { stats.unplaceable.push({ sp: sp.common, at: cellCentreLL, res: c.size }); continue; }
      }
      points.get(sp.key).push({
        type: 'Feature',
        properties: { n: c.count, res: c.size },
        geometry: { type: 'Point', coordinates: [Math.round(pt[0] * 1e6) / 1e6, Math.round(pt[1] * 1e6) / 1e6] },
      });
    }
  }

  // ---- 4. One file per species. ----
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  let bytes = 0;
  for (const sp of SPECIES) {
    const fc = { type: 'FeatureCollection', features: points.get(sp.key) };
    const txt = JSON.stringify(fc);
    bytes += Buffer.byteLength(txt);
    await writeFile(resolve(OUT_DIR, `${sp.key}.geojson`), txt);
  }

  // ---- Report ----
  console.log('\nPer-species coverage in the corridor (NBN Atlas):');
  for (const r of report) {
    if (!r.total) { console.log(`  ${r.sp.common.padEnd(24)} ${r.note}`); continue; }
    console.log(
      `  ${r.sp.common.padEnd(24)} ${String(r.total).padStart(6)} records → ${String(r.res / 1000).padStart(2)} km grid, ` +
        `${String(r.cells).padStart(4)} cells, ${String(r.records).padStart(6)} binned` +
        `${r.binned < r.total ? ` (${r.total - r.binned} coarser than ${r.res} m, excluded)` : ''}` +
        `${r.outside ? `, ${r.outside} outside corridor` : ''}${r.unparsed ? `, ${r.unparsed} unparsed` : ''}`,
    );
  }

  console.log(`\nLand-clip correction across all ${stats.total} occupied squares:`);
  console.log(`  ${stats.touchedLand} square(s) overlapped land and were corrected (${((stats.touchedLand / stats.total) * 100).toFixed(1)}%)`);
  console.log(`  ${stats.multiPiece} of those broke into MULTIPLE disconnected sea pieces — largest piece used`);
  console.log(`  ${stats.centroidOutside} needed a guaranteed-interior point (area centroid outside its own concave piece, or across the coastline)`);
  if (stats.unplaceable.length) console.log(`  ! ${stats.unplaceable.length} square(s) had a sea piece but no placeable interior point — no marker written`);
  if (stats.noSea.length) {
    console.log(`  ! ${stats.noSea.length} square(s) had NO sea at all — ANOMALY, no marker written:`);
    for (const a of stats.noSea.slice(0, 12)) {
      console.log(`      ${a.sp} — ${a.res / 1000} km square centred ${a.at.map((v) => v.toFixed(3)).join(', ')}`);
    }
    if (stats.noSea.length > 12) console.log(`      … and ${stats.noSea.length - 12} more`);
  } else {
    console.log(`  no square was entirely on land`);
  }

  const written = SPECIES.filter((s) => points.get(s.key).length).length;
  console.log(`\nWrote ${written}/${SPECIES.length} species files to ${OUT_DIR} — ${(bytes / 1024).toFixed(0)} KB total.`);
  console.log('   POINTS ONLY — no individual record coordinates, no cell outlines.');
}

main().catch((err) => {
  console.error('Failed to build marine species markers:', err.message);
  process.exit(1);
});
