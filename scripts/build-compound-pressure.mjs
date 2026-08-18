/**
 * Build the COMPOUND PRESSURE INDICATOR grid at public/data/compound-pressure.geojson.
 *
 * Run with: npm run data:compound
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 * --------------------------------
 * This is NOT a cumulative effects assessment. A real CEA (Cefas Bow-Tie,
 * Halpern-derived methods) rests on pressure-receptor sensitivity weightings
 * drawn from expert ecological judgement and biological traits analysis. We do
 * not have those weightings and this script does not invent them.
 *
 * What it produces is narrower and honest: for each 2 km cell, the percentile
 * rank of five separately-monitored pressures, shipped side by side. It makes no
 * claim that any pressure matters more than another, and none about ecological
 * consequence. The weighting is left to whoever is looking, at runtime.
 *
 * THE GRID
 * --------
 * The 2 km grid is borrowed wholesale from the recreational pressure layer (MMO's
 * vessel density grid): 10,380 cells, 2.04 x 2.06 km, covering 43,596 km2. It is a
 * SEA grid — land is a hole in it — which matters for storm overflows, which
 * discharge at the shoreline rather than offshore.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(__dir, '../public/data');
const load = async (f) => JSON.parse(await readFile(resolve(DATA, f), 'utf8'));

/* ---------- geometry helpers ---------- */

const bboxOf = (g) => {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < x0) x0 = c[0]; if (c[0] > x1) x1 = c[0];
      if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1];
    } else c.forEach(walk);
  };
  walk(g.coordinates);
  return [x0, y0, x1, y1];
};

/** Ray casting against one linear ring. */
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Polygon = outer ring minus holes. */
const inPoly = (x, y, poly) => inRing(x, y, poly[0]) && !poly.slice(1).some((h) => inRing(x, y, h));
const polysOf = (g) => (g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : []);
const inGeom = (x, y, g) => polysOf(g).some((p) => inPoly(x, y, p));

/** Great-circle km. */
const KM = (a, b) => {
  const R = 6371.0088, r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
  const la1 = a[1] * r, la2 = b[1] * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** 4 dp is ~11 m — ample for a 2 km grid, and much smaller on the wire. */
function round4(g) {
  const r = (c) => (typeof c[0] === 'number' ? [Math.round(c[0] * 1e4) / 1e4, Math.round(c[1] * 1e4) / 1e4] : c.map(r));
  return { type: g.type, coordinates: r(g.coordinates) };
}

const centroid = (g) => {
  let x = 0, y = 0, n = 0;
  const walk = (c) => { if (typeof c[0] === 'number') { x += c[0]; y += c[1]; n++; } else c.forEach(walk); };
  walk(g.coordinates);
  return [x / n, y / n];
};

/**
 * A coarse spatial hash, so each cell only tests the few features near it rather
 * than all of them. 0.05 deg buckets (~3.5 km) keeps the bucket lists short.
 */
function index(features, cellDeg = 0.05) {
  const map = new Map();
  const key = (i, j) => `${i}|${j}`;
  for (const f of features) {
    const [x0, y0, x1, y1] = bboxOf(f.geometry);
    for (let i = Math.floor(x0 / cellDeg); i <= Math.floor(x1 / cellDeg); i++) {
      for (let j = Math.floor(y0 / cellDeg); j <= Math.floor(y1 / cellDeg); j++) {
        const k = key(i, j);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(f);
      }
    }
  }
  return {
    near(x, y, padDeg = 0) {
      const out = new Set();
      for (let i = Math.floor((x - padDeg) / cellDeg); i <= Math.floor((x + padDeg) / cellDeg); i++) {
        for (let j = Math.floor((y - padDeg) / cellDeg); j <= Math.floor((y + padDeg) / cellDeg); j++) {
          for (const f of map.get(key(i, j)) ?? []) out.add(f);
        }
      }
      return out;
    },
  };
}

/** 5 x 5 lattice of sample points inside a cell, for area-fraction estimates. */
function lattice(cellGeom, n = 5) {
  const [x0, y0, x1, y1] = bboxOf(cellGeom);
  const pts = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      pts.push([x0 + ((i + 0.5) / n) * (x1 - x0), y0 + ((j + 0.5) / n) * (y1 - y0)]);
    }
  }
  return pts;
}

/* ---------- pressure definitions ---------- */

/*
 * WFD ecological status -> ordinal, INVERTED so that higher always means more
 * pressure, matching every other input. High water quality is the ABSENCE of
 * pressure, so it scores 0.
 */
const WFD_PRESSURE = { High: 0, Good: 1, Moderate: 2, Poor: 3, Bad: 4 };

/*
 * Storm overflows discharge at the shoreline, and the grid is a SEA grid, so a
 * strict point-in-cell count would assign almost nothing: most overflows fall on
 * land, in the holes. It would also be wrong on its own terms — an outfall
 * affects the water around it, not one 2 km square.
 *
 * So spills are spread with an exponential distance decay. DECAY_KM is the
 * e-folding distance and CUTOFF_KM is where the tail is dropped (weight ~0.07).
 * These are a MODELLING CHOICE, not a measured dispersal distance, and the About
 * text says so.
 */
const DECAY_KM = 3;
const CUTOFF_KM = 8;

const pct = (n, d) => `${((n / d) * 100).toFixed(1)}%`;
const quant = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null);

function describe(label, vals) {
  const s = vals.filter((v) => v != null).sort((a, b) => a - b);
  if (!s.length) return `${label}: no data`;
  const f = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(3));
  return `${label.padEnd(22)} n=${String(s.length).padStart(6)}  min ${f(s[0]).padStart(8)}  p25 ${f(quant(s, 0.25)).padStart(8)}  med ${f(quant(s, 0.5)).padStart(8)}  p75 ${f(quant(s, 0.75)).padStart(8)}  p95 ${f(quant(s, 0.95)).padStart(8)}  max ${f(s[s.length - 1]).padStart(8)}`;
}

/**
 * Percentile rank within the corridor, over cells that HAVE data.
 *
 * A REAL ZERO IS PINNED TO 0, and only the cells that actually carry the pressure
 * are ranked among themselves. This is a deliberate departure from a plain
 * percentile rank, and it matters: 87% of cells have no storm overflow within
 * reach and 91% have no licensed dredging. Ranking those ties at the midpoint of
 * their block — the textbook rule — scored "no pressure at all" as 0.435 and
 * 0.453, so a cell with nothing happening in it contributed nearly half a point
 * to the weighted sum. That is not a defensible reading of a pressure indicator.
 *
 * Within the positive values, ties still share the midpoint of their rank block,
 * so a large mass of identical values is not spread artificially.
 */
function percentileRank(values) {
  const out = values.map((v) => (v == null ? null : v === 0 ? 0 : undefined));
  const pos = values.map((v, i) => [v, i]).filter(([v]) => v != null && v > 0);
  pos.sort((a, b) => a[0] - b[0]);
  const m = pos.length;
  let i = 0;
  while (i < m) {
    let j = i;
    while (j + 1 < m && pos[j + 1][0] === pos[i][0]) j++;
    // (mid-rank + 1) / m keeps the smallest positive strictly above 0 and the
    // largest exactly at 1.
    const r = ((i + j) / 2 + 1) / m;
    for (let k = i; k <= j; k++) out[pos[k][1]] = Math.round(Math.min(1, r) * 1000) / 1000;
    i = j + 1;
  }
  return out;
}

async function main() {
  console.log('Building compound pressure indicator…');
  console.log('  NOTE: this is pressure CO-OCCURRENCE, not a cumulative effects assessment.\n');

  const grid = (await load('recreational-pressure.geojson')).features;
  const cells = grid.map((f) => ({ geom: f.geometry, c: centroid(f.geometry), rec: f.properties.rec }));
  console.log(`  grid: ${cells.length} cells (2 km, from the recreational pressure layer)`);

  const overflows = (await load('storm-overflows.geojson')).features;
  const wfd = (await load('wfd-coastal.geojson')).features;
  const fish = (await load('fisheries.geojson')).features;
  const lic = (await load('marine-licensing.geojson')).features.filter((f) => polysOf(f.geometry).length);
  console.log(`  inputs: ${overflows.length} overflows · ${wfd.length} water bodies · ${fish.length} fishing cells · ${lic.length} licensed polygons\n`);

  const ovIdx = index(overflows, 0.1);
  const wfdIdx = index(wfd, 0.1);
  const fishIdx = index(fish, 0.1);
  const licIdx = index(lic, 0.05);

  const raw = { spill: [], wfd: [], rec: [], fish: [], dredge: [] };

  for (const cell of cells) {
    const [cx, cy] = cell.c;

    // --- 1. Storm overflow: distance-decayed sum of annual spills ---
    let spill = 0;
    const padDeg = CUTOFF_KM / 78; // ~1 deg lon at 50.5N is 71 km; pad generously
    for (const o of ovIdx.near(cx, cy, padDeg)) {
      const d = KM(cell.c, o.geometry.coordinates);
      if (d > CUTOFF_KM) continue;
      spill += (Number(o.properties.spills) || 0) * Math.exp(-d / DECAY_KM);
    }
    // Every corridor cell is within reach of the EA's complete overflow register,
    // so "no overflow nearby" is a REAL zero, not missing data.
    raw.spill.push(spill);

    // --- 2. WFD: area-weighted mean of the inverted status ordinal ---
    const samples = lattice(cell.geom);
    let hit = 0, sum = 0;
    for (const p of samples) {
      for (const w of wfdIdx.near(p[0], p[1])) {
        if (inGeom(p[0], p[1], w.geometry)) {
          const v = WFD_PRESSURE[w.properties.eco];
          if (v != null) { sum += v; hit++; }
          break;
        }
      }
    }
    // WFD classifies COASTAL and TRANSITIONAL waters only. An offshore cell is
    // NOT ASSESSED — which is different from being assessed as unpolluted.
    raw.wfd.push(hit ? sum / hit : null);

    // --- 3. Recreational: 1:1, this is the grid's own layer ---
    raw.rec.push(cell.rec);

    // --- 4. Fishing: inherit the containing 5.7 km cell ---
    let fv = null;
    for (const f of fishIdx.near(cx, cy)) {
      if (inGeom(cx, cy, f.geometry)) { fv = Number(f.properties.pos) || 0; break; }
    }
    raw.fish.push(fv);

    // --- 5. Dredging: fraction of the cell covered by licensed areas ---
    let cov = 0;
    for (const p of samples) {
      for (const l of licIdx.near(p[0], p[1])) {
        if (inGeom(p[0], p[1], l.geometry)) { cov++; break; }
      }
    }
    // Licensing covers the whole corridor's jurisdiction, so no licence is a
    // REAL zero: nothing is licensed there.
    raw.dredge.push(cov / samples.length);
  }

  /* ---------- report raw distributions ---------- */
  console.log('  RAW distributions (before normalisation):');
  console.log('   ', describe('storm overflow (decayed spills)', raw.spill));
  console.log('   ', describe('wfd (0=High..4=Bad)', raw.wfd));
  console.log('   ', describe('recreational (transits/wk)', raw.rec));
  console.log('   ', describe('fishing (VMS positions)', raw.fish));
  console.log('   ', describe('dredging (cell fraction)', raw.dredge));

  console.log('\n  DATA COVERAGE — real zero vs genuinely missing:');
  const n = cells.length;
  for (const [k, lab] of [['spill', 'storm overflow'], ['wfd', 'water body status'], ['rec', 'recreational'], ['fish', 'commercial fishing'], ['dredge', 'dredging']]) {
    const miss = raw[k].filter((v) => v == null).length;
    const zero = raw[k].filter((v) => v === 0).length;
    const pos = n - miss - zero;
    console.log(`     ${lab.padEnd(20)} with value>0 ${String(pos).padStart(6)} (${pct(pos, n)})  real zero ${String(zero).padStart(6)} (${pct(zero, n)})  NO DATA ${String(miss).padStart(6)} (${pct(miss, n)})`);
  }

  /* ---------- normalise ---------- */
  const nrm = {};
  for (const k of Object.keys(raw)) nrm[k] = percentileRank(raw[k]);
  console.log('\n  NORMALISED distributions (percentile rank within corridor, 0–1):');
  for (const [k, lab] of [['spill', 'storm overflow'], ['wfd', 'water body status'], ['rec', 'recreational'], ['fish', 'commercial fishing'], ['dredge', 'dredging']]) {
    console.log('   ', describe(lab, nrm[k]));
  }

  const features = cells.map((cell, i) => ({
    type: 'Feature',
    properties: {
      // Normalised 0–1 per pressure; null means NOT ASSESSED for that pressure.
      s: nrm.spill[i], w: nrm.wfd[i], r: nrm.rec[i], f: nrm.fish[i], d: nrm.dredge[i],
    },
    geometry: cell.geom,
  }));

  const txt = JSON.stringify({ type: 'FeatureCollection', features });
  const out = resolve(DATA, 'compound-pressure.geojson');
  await writeFile(out, txt);
  console.log(`\nWrote ${out} — ${features.length} cells, ${(Buffer.byteLength(txt) / 1e6).toFixed(2)} MB`);
}

main().catch((e) => { console.error('Failed:', e.message); process.exit(1); });
