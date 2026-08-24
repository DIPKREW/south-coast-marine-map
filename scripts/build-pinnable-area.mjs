/**
 * Build the PINNABLE AREA — where a visitor is allowed to drop a site-briefing
 * pin — and write it to public/data/pinnable-area.geojson.
 *
 * Run with: npm run data:pinnable
 *
 * Derived at BUILD TIME from data already committed in this repo. Nothing is
 * fetched: the two inputs are public/data/catchment-boundary.geojson and
 * public/data/wfd-coastal.geojson.
 *
 * THE DEFINITION, in three parts:
 *
 *   0. THE CORRIDOR TEST, applied to the sea grid before anything else. The
 *      grid is clipped to the fetch bbox, not to the corridor, so part of it is
 *      Bristol Channel water outside the Land's End→Beachy Head corridor.
 *
 *      WHY IT MATTERS MORE HERE THAN ELSEWHERE. A pin off Padstow would produce
 *      a briefing in which roughly half the layers say nothing — because the
 *      bathing water, storm overflow, coastal erosion and water body builds all
 *      cut that coast, not because nothing is happening there. The briefing
 *      feature rests on silence being informative. A scope boundary reported as
 *      a finding breaks exactly that, and it is the one failure this feature
 *      cannot afford.
 *
 *      THE RULE: a sea cell belongs if its NEAREST COAST is corridor coast.
 *      Coastline comes from public/data/coastline.geojson; corridor coast is the
 *      part of it inside the catchment boundary, which is the same authority
 *      every other build uses to decide which coast is which. The catchment test
 *      cannot be applied to the cells directly — it reaches barely a nautical
 *      mile offshore — so it is applied to the COASTLINE instead and the cells
 *      are classified by proximity to the result.
 *
 *      FOUR EARLIER DERIVATIONS FAILED, all for one reason: no coastline. Using
 *      (bbox − grid − catchment) as land cut 6,616 cells, counting bbox corners
 *      and uncovered sea as shore. Using the grid's interior rings found only
 *      2,114 km² of estuary slack. Using the grid's OUTER ring cut 3,751 and
 *      excluded Lyme Bay centre and Offshore Brighton MCZ, because that ring is
 *      part coastline and part rectangle edge. Those two sites are now assertions.
 *
 *   1. THE WET PART OF THE MAP. Two sources unioned, because neither alone is
 *      the sea:
 *
 *        a. The committed 2 km SEA GRID (compound-pressure.geojson, 10,380
 *           cells, 41,349 km²) — the same grid the recreational pressure and
 *           compound pressure layers draw on. This is what reaches offshore.
 *        b. The SEA PORTION of the corridor boundary — the catchment boundary
 *           intersected with the WFD water bodies. The catchment boundary is
 *           not land-only: it is built from WFD catchments and its seaward
 *           extent comes from the water bodies inside it (a point in the middle
 *           of the Solent tests inside it; mid-Channel does not). This is what
 *           reaches up the estuaries, where the sea grid stops at the coast.
 *
 *      An earlier draft used (b) alone. It capped the pinnable area at ONE
 *      NAUTICAL MILE offshore, because that is where WFD coastal water bodies
 *      end — which put 10 MPAs wholly outside, including Offshore Brighton at
 *      36.6 km and Skerries Bank, the most heavily fished MPA in the corridor.
 *      The sea grid reaches 17x further out and fixes that.
 *
 *   2. Every TRANSITIONAL (estuarine) water body in the corridor, IN FULL — all
 *      39 of them, including any part that reaches beyond the catchment
 *      boundary.
 *
 *   3. A 3 km LANDWARD buffer on the above. Implemented as buffer-then-clip:
 *      the core is grown 2 km in every direction and the growth is intersected
 *      back with the catchment boundary. Seaward growth falls outside the
 *      catchment and is discarded; landward growth is inside it and is kept. The
 *      catchment boundary covers all the corridor's land, so what survives is a
 *      2 km coastal strip and nothing further inland.
 *
 * WHY A PINNABLE AREA AT ALL. A site briefing reads marine layers. Pinning in
 * the middle of Salisbury Plain would produce a briefing in which every layer is
 * silent, which says nothing about Salisbury Plain and everything about the
 * question being wrong. The boundary is the honest edge of what this map can
 * answer.
 */
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as clip from 'polygon-clipping';
import bufferFn from '@turf/buffer';
import { BEACHY_HEAD_LON, SOUTH_COAST_BBOX } from './lib/southcoast.mjs';

const buffer = bufferFn.default ?? bufferFn;
const union = clip.union ?? clip.default.union;
const intersection = clip.intersection ?? clip.default.intersection;

/* ---- nearest-coast helpers, used by the corridor test ---------------------- */

const KX = 111.320 * Math.cos((50.4 * Math.PI) / 180);
const KY = 111.132;

/** A coarse uniform bucket grid — enough to make 10,380 nearest queries cheap
 *  without pulling in a spatial-index dependency. */
function indexPoints(pts, cell = 0.1) {
  const buckets = new Map();
  for (const p of pts) {
    const k = `${Math.floor(p[0] / cell)}|${Math.floor(p[1] / cell)}`;
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = []));
    b.push(p);
  }
  return { buckets, cell };
}

function nearest({ buckets, cell }, [x, y]) {
  const cx = Math.floor(x / cell);
  const cy = Math.floor(y / cell);
  /*
   * Expanding ring search. `best` is carried ACROSS rings, not reset inside the
   * loop — resetting it returns the nearest point in whichever ring happened to
   * satisfy the stopping rule rather than the nearest overall, which over-cut by
   * thousands of cells. The assertion above is what surfaced that.
   */
  let best = Infinity;
  for (let r = 0; r < 400; r++) {
    for (let i = cx - r; i <= cx + r; i++) {
      for (let j = cy - r; j <= cy + r; j++) {
        if (r > 0 && i > cx - r && i < cx + r && j > cy - r && j < cy + r) continue;
        const b = buckets.get(`${i}|${j}`);
        if (!b) continue;
        for (const p of b) {
          const d = Math.hypot((p[0] - x) * KX, (p[1] - y) * KY);
          if (d < best) best = d;
        }
      }
    }
    // Stop only once the searched radius provably covers `best`.
    if (best < Infinity && best <= r * cell * Math.min(KX, KY)) return best;
  }
  return best;
}

/** Ray casting, matching scripts/lib/geo.mjs. */
function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInMulti(pt, multi) {
  for (const poly of multi) {
    if (!inRing(pt, poly[0])) continue;
    let hole = false;
    for (let i = 1; i < poly.length; i++) if (inRing(pt, poly[i])) { hole = true; break; }
    if (!hole) return true;
  }
  return false;
}

/** Area-weighted centroid of a Polygon / MultiPolygon. */
function centroidOf(geometry) {
  const polys = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  let cx = 0, cy = 0, a2 = 0;
  for (const poly of polys) {
    for (const ring of poly) {
      for (let i = 0, n = ring.length - 1; i < n; i++) {
        const cross = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
        a2 += cross;
        cx += (ring[i][0] + ring[i + 1][0]) * cross;
        cy += (ring[i][1] + ring[i + 1][1]) * cross;
      }
    }
  }
  if (!a2) return polys[0][0][0];
  return [cx / (3 * a2), cy / (3 * a2)];
}

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(__dir, '../public/data');
const OUT = resolve(DATA, 'pinnable-area.geojson');

/**
 * Landward buffer distance, in kilometres. Stated on the panel too.
 *
 * 3 km rather than 2: at 2 km, Steamer Quay on the Dart fell 40 METRES outside,
 * because the Dart transitional water body ends 2.66 km down-river of it. Going
 * to 4 km would additionally capture Lostwithiel on the Fowey (3.13 km beyond
 * its water body) but distorts the whole coastline to rescue one not-assessed
 * river site, so it stays out. Three of 193 bathing waters are outside; that is
 * the accepted cost.
 */
const BUFFER_KM = 3;

const readJson = async (name) => JSON.parse(await readFile(resolve(DATA, name), 'utf8'));

/** Every polygon in a GeoJSON object, as polygon-clipping multipolygon rings. */
function toMulti(geometry) {
  const out = [];
  const walk = (g) => {
    if (!g) return;
    if (g.type === 'GeometryCollection') return g.geometries.forEach(walk);
    if (g.type === 'Polygon') out.push(g.coordinates);
    else if (g.type === 'MultiPolygon') out.push(...g.coordinates);
  };
  walk(geometry);
  return out;
}

const featuresOf = (fc) =>
  fc.type === 'FeatureCollection' ? fc.features.map((f) => f.geometry) : [fc.geometry ?? fc];

/** Geodesic ring area in km², shoelace on an equirectangular projection about
 *  the ring's own latitude — good to a fraction of a percent at this scale. */
function ringAreaKm2(ring) {
  const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const kx = 111.320 * Math.cos((lat * Math.PI) / 180);
  const ky = 111.132;
  let a = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    a += ring[i][0] * kx * (ring[i + 1][1] * ky) - ring[i + 1][0] * kx * (ring[i][1] * ky);
  }
  return Math.abs(a / 2);
}
/** Centroid of a single ring. */
function ringCentroid(ring) {
  let cx = 0, cy = 0, a2 = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    const cross = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    a2 += cross;
    cx += (ring[i][0] + ring[i + 1][0]) * cross;
    cy += (ring[i][1] + ring[i + 1][1]) * cross;
  }
  return a2 ? [cx / (3 * a2), cy / (3 * a2)] : ring[0];
}

/** Signed area of a multipolygon: outer rings add, holes subtract. */
const multiAreaKm2 = (multi) =>
  multi.reduce((s, poly) => s + poly.reduce((t, ring, i) => t + (i === 0 ? ringAreaKm2(ring) : -ringAreaKm2(ring)), 0), 0);

async function main() {
  console.log('Pinnable area — derived from committed data, nothing fetched\n');

  const catchment = await readJson('catchment-boundary.geojson');
  const wfd = await readJson('wfd-coastal.geojson');

  const catchMulti = union(...featuresOf(catchment).map(toMulti).flat().map((p) => [p]));
  const wfdFeatures = wfd.features;
  const transitional = wfdFeatures.filter((f) => f.properties.wbtype === 'Transitional');
  const coastal = wfdFeatures.filter((f) => f.properties.wbtype === 'Coastal');
  console.log(`  inputs: catchment boundary + ${wfdFeatures.length} WFD water bodies`);
  console.log(`          (${coastal.length} coastal, ${transitional.length} transitional)`);

  const allWater = union(...wfdFeatures.map((f) => toMulti(f.geometry)).flat().map((p) => [p]));

  // 1a. the committed 2 km sea grid — what reaches offshore, corridor cells only
  const gridFc = await readJson('compound-pressure.geojson');
  const gridAll = union(...gridFc.features.map((f) => toMulti(f.geometry)).flat().map((p) => [p]));
  /*
   * Corridor coast vs non-corridor coast: the coastline, split by the catchment.
   * Verified at the shoreline — Lyme Regis, Chesil, Weymouth, Start Point,
   * Falmouth and Selsey all test inside the catchment; Bude tests outside.
   */
  const coast = await readJson('coastline.geojson');
  const coastPts = coast.features.flatMap((f) => f.geometry?.coordinates ?? []);
  if (coastPts.length < 5000) throw new Error(`coastline has only ${coastPts.length} points — run: npm run data:coastline`);
  const corridorPts = coastPts.filter((pt) => pointInMulti(pt, catchMulti));
  const otherPts = coastPts.filter((pt) => !pointInMulti(pt, catchMulti));
  console.log(`\n  0. corridor test on the sea grid (nearest coast wins)`);
  console.log(`     coastline ${coastPts.length} pts: ${corridorPts.length} corridor coast, ${otherPts.length} non-corridor coast`);
  if (!corridorPts.length || !otherPts.length) throw new Error('coastline split produced an empty side');
  const corridorIx = indexPoints(corridorPts);
  const otherIx = indexPoints(otherPts);
  const keptCells = [];
  let cutCells = 0;
  for (const f of gridFc.features) {
    const c = centroidOf(f.geometry);
    if (nearest(corridorIx, c) <= nearest(otherIx, c)) keptCells.push(f);
    else cutCells++;
  }
  console.log(`     ${keptCells.length} cells kept, ${cutCells} cut as north Cornwall / north Devon`);
  /*
   * FAIL LOUDLY ON A BAD CUT, and do it on OUTCOMES rather than a count.
   *
   * A count guard alone is weak: an early estimate of "about 1,232 north-coast
   * cells" came from the rectangle lat>50.6 ∧ lon<-4.2, which misses most of
   * west Cornwall's north shore — Newquay, St Ives and the Camel all sit below
   * 50.6. The true figure is around 2,600, so the threshold that would have
   * caught the failed derivations would also have rejected the correct one.
   *
   * What does discriminate is a handful of named places. Every failed attempt
   * excluded Lyme Bay centre or Offshore Brighton; none of them kept Padstow
   * out while keeping those in. A loose count guard is kept as a backstop
   * against a wholesale failure.
   */
  const cellAt = (pt) => keptCells.some((f) => {
    const b = f.geometry.coordinates[0];
    const xs = b.map((q) => q[0]);
    const ys = b.map((q) => q[1]);
    return pt[0] >= Math.min(...xs) && pt[0] <= Math.max(...xs) && pt[1] >= Math.min(...ys) && pt[1] <= Math.max(...ys);
  });
  const MUST_KEEP = [['Lyme Bay centre', [-2.95, 50.55]], ['Offshore Brighton MCZ', [-0.10, 50.55]],
                     ['Skerries Bank', [-3.515, 50.265]], ['mid-Channel S of Portland', [-2.45, 50.10]]];
  const MUST_CUT = [['sea off Padstow', [-5.00, 50.56]], ['sea off Newquay', [-5.15, 50.42]],
                    ['Bristol Channel N of Bude', [-4.40, 51.05]]];
  const bad = [
    ...MUST_KEEP.filter(([, pt]) => !cellAt(pt)).map(([n]) => `${n} was cut but must be kept`),
    ...MUST_CUT.filter(([, pt]) => cellAt(pt)).map(([n]) => `${n} was kept but must be cut`),
  ];
  if (bad.length) throw new Error(`corridor test misclassified:\n     - ${bad.join('\n     - ')}`);
  if (cutCells > 3500) throw new Error(`corridor test cut ${cutCells} cells — implausibly many; check the coastline split`);
  console.log(`     named checks: ${MUST_KEEP.length} must-keep and ${MUST_CUT.length} must-cut sites all correct`);
  const grid = union(...keptCells.map((f) => toMulti(f.geometry)).flat().map((p) => [p]));

  // 1b. sea portion of the corridor boundary — what reaches up the estuaries
  const sea = intersection(catchMulti, allWater);
  // 2. every transitional body in full
  const trans = union(...transitional.map((f) => toMulti(f.geometry)).flat().map((p) => [p]));
  const core = union(grid, sea, trans);
  console.log(`\n  1a. committed 2 km sea grid, corridor only: ${multiAreaKm2(grid).toFixed(0)} km² (${keptCells.length} of ${gridFc.features.length} cells)`);
  console.log(`  1b. sea portion of the corridor boundary: ${multiAreaKm2(sea).toFixed(0)} km²`);
  console.log(`  2.  transitional water bodies, in full  : ${multiAreaKm2(trans).toFixed(0)} km²`);
  console.log(`      core (1a ∪ 1b ∪ 2)                  : ${multiAreaKm2(core).toFixed(0)} km²`);

  // 3. buffer, then clip the growth back to the catchment so only landward survives
  const grown = buffer({ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: core } },
    BUFFER_KM, { units: 'kilometers', steps: 8 });
  if (!grown?.geometry) throw new Error('buffer produced no geometry');
  const grownMulti = toMulti(grown.geometry);
  const landward = intersection(grownMulti, catchMulti);
  const result = union(core, landward);
  console.log(`  3. + ${BUFFER_KM} km landward buffer, clipped to the catchment`);
  console.log(`     landward strip added                 : ${(multiAreaKm2(landward) - multiAreaKm2(intersection(core, catchMulti))).toFixed(0)} km² (approx)`);

  /*
   * THE BEACHY HEAD CUTOFF, applied here as it is everywhere else.
   *
   * The sea grid is clipped to the fetch bbox (east edge 0.6), not to the
   * corridor, so it reaches ~53 km² past the headland. Every other layer on this
   * map cuts there — bathing waters, storm overflows, NCERM, the water bodies —
   * and lib/southcoast states a site must pass BOTH the hydrological and the
   * geographic test. A pinnable area that ran past it would let someone pin
   * where four layers have been deliberately cut.
   */
  const [w, s0, , n0] = SOUTH_COAST_BBOX;
  const westOfHeadland = [[[[w, s0], [BEACHY_HEAD_LON, s0], [BEACHY_HEAD_LON, n0], [w, n0], [w, s0]]]];
  const cut = intersection(result, westOfHeadland);
  console.log(`  4. cut at the Beachy Head cutoff (${BEACHY_HEAD_LON}°E): ${(multiAreaKm2(result) - multiAreaKm2(cut)).toFixed(0)} km² removed`);
  result.length = 0;
  result.push(...cut);

  /*
   * DROP SEAM HOLES. The sea grid is 10,380 separate cells stored in EPSG:3035,
   * so unioning them in lon/lat leaves hairline gaps where cell corners do not
   * quite meet. They surface as tiny interior rings — five of them, 1.37 km²
   * between them — and each is a spot where a click would mysteriously do
   * nothing. Interior rings under 1 km² are removed; everything larger is real
   * land more than the buffer distance from any water, and stays a hole.
   */
  /*
   * HOLE FILTER. Two kinds of interior ring end up in the result and only one
   * of them is a place.
   *
   *   Under 10 km² — GAPS IN THE SOURCE SEA GRID. The 2 km grid has occasional
   *   missing cells, and the union leaves them as 4–8 km² holes in open water,
   *   plus a few hairline seams where cells stored in EPSG:3035 fail to meet
   *   when unioned in lon/lat. Each is a square of water where a click would
   *   mysteriously do nothing, with pinnable sea all round it. They are filled.
   *
   *   Over 10 km² — LAND, more than the buffer distance from any water: the
   *   interior of the Isle of Wight, inland Devon, inland Dorset. You genuinely
   *   cannot pin there, so they stay.
   *
   *   The gap between the two groups is wide — the largest grid gap is 7.9 km²,
   *   the smallest land hole 23.3 km² — so the threshold is not finely balanced.
   *   The counts either side are reported on every run; if they ever converge,
   *   this rule needs revisiting rather than nudging.
   */
  const HOLE_KEEP_KM2 = 10;
  let filled = 0;
  const keptHoleAreas = [];
  for (const poly of result) {
    for (let i = poly.length - 1; i >= 1; i--) {
      const a = ringAreaKm2(poly[i]);
      if (a < HOLE_KEEP_KM2) { poly.splice(i, 1); filled++; }
      else keptHoleAreas.push(a);
    }
  }
  console.log(`  5. filled ${filled} hole(s) under ${HOLE_KEEP_KM2} km² (gaps in the source grid);`);
  console.log(`     kept ${keptHoleAreas.length} land hole(s): ${keptHoleAreas.sort((x, y) => y - x).map((v) => v.toFixed(1)).join(', ')} km²`);

  const areaTotal = multiAreaKm2(result);
  const areaCatch = multiAreaKm2(catchMulti);
  console.log(`\n  PINNABLE AREA : ${areaTotal.toFixed(0)} km²`);
  console.log(`  corridor boundary (for comparison): ${areaCatch.toFixed(0)} km²  — ${(100 * areaTotal / areaCatch).toFixed(0)}% of it`);

  // ---- shape report: parts, holes, slivers
  const parts = result
    .map((poly, i) => ({ i, outer: ringAreaKm2(poly[0]), holes: poly.length - 1,
                         holeArea: poly.slice(1).reduce((s, r) => s + ringAreaKm2(r), 0) }))
    .sort((a, b) => b.outer - a.outer);
  const holes = parts.reduce((s, p) => s + p.holes, 0);
  const slivers = parts.filter((p) => p.outer < 1);
  console.log(`\n  SHAPE: ${result.length} disconnected part(s), ${holes} hole(s)`);
  console.log('    largest parts (km²):', parts.slice(0, 6).map((p) => p.outer.toFixed(1)).join(', '));
  console.log(`    parts under 1 km² (slivers): ${slivers.length}`);
  if (holes) {
    const big = parts.filter((p) => p.holes).sort((a, b) => b.holeArea - a.holeArea).slice(0, 5);
    console.log('    parts carrying holes, by hole area (km²):', big.map((p) => `${p.holes}×${p.holeArea.toFixed(1)}`).join(', '));
  }

  const fc = { type: 'FeatureCollection', features: [{
    type: 'Feature',
    properties: { bufferKm: BUFFER_KM, areaKm2: Math.round(areaTotal) },
    geometry: { type: 'MultiPolygon', coordinates: result },
  }] };
  const out = JSON.stringify(fc);
  await mkdir(DATA, { recursive: true });
  await writeFile(OUT, out);
  console.log(`\nWrote ${OUT} — ${(Buffer.byteLength(out) / 1024).toFixed(0)} KB.`);
}

main().catch((err) => {
  console.error('\nFailed to build the pinnable area:', err.message);
  process.exit(1);
});
