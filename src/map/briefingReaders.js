/**
 * BRIEFING READERS — what each layer says at a pin, and which kind of silence
 * it is when it says nothing.
 *
 * Stage two-A: the framework plus four readers, one per geometry type. The
 * other sixteen layers stay `pending` until this pattern is reviewed.
 *
 * THE THREE KINDS OF SILENCE are the whole point of the feature, and a generic
 * "no features found" collapses the distinction:
 *
 *   NOTHING HERE   the layer covers this place and has data elsewhere, but none
 *                  within the radius. A real finding about this spot.
 *   NOT COVERED    the layer's data does not reach here. A fact about the
 *                  dataset, not about the place.
 *   NO DATA        the layer is an inert placeholder with nothing anywhere.
 *
 * Every reader has to answer that itself, from its own coverage rule. There is
 * no shared fallback, because there is no honest shared answer.
 *
 * NO DERIVED CLAIMS. Readers report their own layer and nothing else. The
 * briefing may put two layers side by side; it must never say one causes,
 * affects or explains the other. The single association it may state is the
 * EDM permit condition, which is EA's own and is worded as such.
 */
import { loadCatchmentBoundary } from './catchmentBoundary.js';

/** Reporting radius, in kilometres. Also stated on the panel. */
export const RADIUS_KM = 3;

const KY = 111.132;
const kx = (lat) => 111.320 * Math.cos((lat * Math.PI) / 180);

function distKm([ax, ay], [bx, by]) {
  const k = kx((ay + by) / 2);
  return Math.hypot((ax - bx) * k, (ay - by) * KY);
}

/* ---- geometry helpers, kept deliberately small ---------------------------- */

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(pt, coords) {
  if (!inRing(pt, coords[0])) return false;
  for (let i = 1; i < coords.length; i++) if (inRing(pt, coords[i])) return false;
  return true;
}

function containsPoint(geometry, pt) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') return inPolygon(pt, geometry.coordinates);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some((c) => inPolygon(pt, c));
  return false;
}

/** Shortest distance from a point to any vertex or segment of a geometry, km.
 *  Vertex-and-segment rather than vertex-only, so a long straight coastline or
 *  reach cannot read as further away than it is. */
function distanceToGeometry(geometry, pt) {
  if (!geometry) return Infinity;
  const k = kx(pt[1]);
  const px = pt[0] * k;
  const py = pt[1] * KY;
  let best = Infinity;
  const seg = (a, b) => {
    const ax = a[0] * k, ay = a[1] * KY, bx = b[0] * k, by = b[1] * KY;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d < best) best = d;
  };
  const walk = (c, depth) => {
    if (depth === 1) { for (let i = 0; i < c.length - 1; i++) seg(c[i], c[i + 1]); return; }
    c.forEach((x) => walk(x, depth - 1));
  };
  const depth = { LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3, Point: 0 }[geometry.type];
  if (depth === 0) return distKm(geometry.coordinates, pt);
  if (depth == null) return Infinity;
  walk(geometry.coordinates, depth);
  return best;
}

/* ---- data loading --------------------------------------------------------- */

const cache = new Map();
/** Fetch a layer's committed GeoJSON once. The browser already has it cached
 *  from the layer's own load — a reader only ever runs for a layer that is on. */
function loadJson(url) {
  if (!cache.has(url)) {
    cache.set(url, fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))));
  }
  return cache.get(url);
}

/* ---- result shapes -------------------------------------------------------- */

const reports = (summary, items = [], extra = {}) => ({ status: 'reports', summary, items, ...extra });
const nothingHere = (summary) => ({ status: 'nothing-here', summary, items: [] });
const notCovered = (summary) => ({ status: 'not-covered', summary, items: [] });

/* Small lookup tables, kept in step with their layer definitions in layers.js.
   Duplicated rather than imported: layers.js pulls in the whole MapLibre paint
   stack, and a reader needs three labels, not a style. */
const LIVE_LABEL = { 1: 'discharging now', 0: 'not currently discharging', '-1': 'monitor offline, no signal' };
const EROSION = ['Negligible', 'Low', 'Moderate', 'High', 'Very high'];
const CP_PRESSURES = [
  ['s', 'Storm overflow'], ['w', 'Water body status'], ['r', 'Recreational'],
  ['f', 'Fishing'], ['d', 'Dredging'],
];

/** `ovf` is an array in the committed file, but MapLibre serialises non-scalar
 *  properties across the worker boundary, so it can arrive as a JSON string.
 *  This reader loads the file directly and gets the array — the string case is
 *  handled anyway, because the bug it causes is silent. */
function safeCount(raw) {
  if (Array.isArray(raw)) return raw.length;
  if (typeof raw === 'string') { try { const v = JSON.parse(raw); return Array.isArray(v) ? v.length : 0; } catch { return 0; } }
  return 0;
}

const n = (v) => Number(v ?? 0).toLocaleString('en-GB');
/** `many` is given explicitly where adding an "s" would not work — "water
 *  bodys" is the sort of thing that makes a reader distrust the figures. */
const plural = (c, word, many) => `${n(c)} ${c === 1 ? word : many ?? `${word}s`}`;
/** "0.0 km away" reads as a contradiction of "does not contain this point", so
 *  anything under a kilometre is given in metres instead. This matters most for
 *  water body status, where a shoreline pin is routinely 40–90 m outside the
 *  polygon it is plainly standing in. */
const away = (d) => (d < 1 ? `${Math.max(10, Math.round(d * 1000 / 10) * 10)} m away` : `${d.toFixed(1)} km away`);

/* ---- the readers ----------------------------------------------------------- */

/**
 * STORM OVERFLOWS — points. Count and list within the radius.
 *
 * Coverage is the CATCHMENT BOUNDARY, which is the layer's own membership rule:
 * scripts/fetch-storm-overflows.mjs keeps an overflow only if it passes that
 * test. An overflow is a land or shoreline asset, so a pin in open water is
 * outside what this layer can describe, and the boundary is where that stops.
 *
 * Two force-included long-sea outfalls sit beyond every water body and so
 * outside the boundary; a pin within 3 km of one would report it while calling
 * the layer not covered. Both are off Littlehampton and Bexhill and the second
 * is east of the corridor cutoff, so the case is narrow — noted, not handled.
 */
const stormOverflows = {
  id: 'storm-annual',
  label: 'Storm overflows',
  async read(pin, { base }) {
    const [boundary, fc] = await Promise.all([
      loadCatchmentBoundary(base),
      loadJson(`${base}data/storm-overflows.geojson`),
    ]);
    const near = fc.features
      .map((f) => ({ p: f.properties, d: distKm(f.geometry.coordinates, pin) }))
      .filter((o) => o.d <= RADIUS_KM)
      .sort((a, b) => (b.p.spills ?? 0) - (a.p.spills ?? 0));

    if (!near.length) {
      if (!boundary.contains(pin)) {
        return notCovered('not covered here — this layer maps outfalls on land and the shoreline');
      }
      // NOTHING HERE. The nearest anywhere is quoted, because "none within 3 km"
      // means something quite different at 4 km than at 40.
      let nearest = Infinity;
      for (const f of fc.features) nearest = Math.min(nearest, distKm(f.geometry.coordinates, pin));
      return nothingHere(
        Number.isFinite(nearest)
          ? `none within ${RADIUS_KM} km — the nearest is ${nearest.toFixed(1)} km away`
          : `none within ${RADIUS_KM} km`,
      );
    }

    const spills = near.reduce((t, o) => t + (o.p.spills ?? 0), 0);
    const hours = near.reduce((t, o) => t + (o.p.hours ?? 0), 0);
    const year = near[0].p.year;
    return reports(
      `${plural(near.length, 'overflow')} within ${RADIUS_KM} km · ${n(spills)} spills over ${n(Math.round(hours))} hours in ${year}`,
      near.slice(0, 3).map((o) =>
        `${o.p.name || o.p.id} — ${o.p.spills ? plural(o.p.spills, 'spill') : 'no spills recorded'}`),
      { more: Math.max(0, near.length - 3),
        caveat: 'A spill is counted by the 12–24 hour method, so one long discharge counts once.' },
    );
  },
};

/**
 * MARINE PROTECTED AREAS — polygons. Which CONTAIN the pin, and separately
 * which are within the radius but do not: being inside a designation and being
 * near one are different facts and the briefing keeps them apart.
 *
 * Always covered. This is a designation register for the whole corridor, so
 * "no protected area here" is a real finding anywhere in the pinnable area
 * rather than a gap in the data.
 */
const marine = {
  id: 'marine',
  label: 'Marine protected areas',
  async read(pin, { base }) {
    const fc = await loadJson(`${base}data/marine.geojson`);
    const byName = new Map();
    for (const f of fc.features) {
      if (!f.geometry) continue; // simplification nulled a few multipart slivers
      const key = `${f.properties.name}|${f.properties.mtype}`;
      const cur = byName.get(key) ?? { ...f.properties, contains: false, d: Infinity };
      if (containsPoint(f.geometry, pin)) cur.contains = true;
      cur.d = Math.min(cur.d, distanceToGeometry(f.geometry, pin));
      byName.set(key, cur);
    }
    const all = [...byName.values()];
    const inside = all.filter((s) => s.contains);
    const near = all.filter((s) => !s.contains && s.d <= RADIUS_KM).sort((a, b) => a.d - b.d);

    if (!inside.length && !near.length) {
      const nearest = Math.min(...all.map((s) => s.d));
      return nothingHere(
        Number.isFinite(nearest)
          ? `none within ${RADIUS_KM} km — the nearest is ${nearest.toFixed(1)} km away`
          : `none within ${RADIUS_KM} km`,
      );
    }
    const bits = [];
    if (inside.length) bits.push(`${plural(inside.length, 'designation')} contain${inside.length === 1 ? 's' : ''} this point`);
    // "more" only when something already contains the pin — otherwise the count
    // is the whole story and "3 more" implies three others that do not exist.
    if (near.length) {
      bits.push(inside.length
        ? `${n(near.length)} more within ${RADIUS_KM} km`
        : `${plural(near.length, 'designation')} within ${RADIUS_KM} km, none containing this point`);
    }
    return reports(
      bits.join(' · '),
      [
        ...inside.slice(0, 2).map((s) => `contains this point: ${s.name} (${s.mtype})`),
        ...near.slice(0, 2).map((s) => `${away(s.d)}: ${s.name} (${s.mtype})`),
      ],
      { more: Math.max(0, inside.length + near.length - Math.min(inside.length, 2) - Math.min(near.length, 2)),
        caveat: 'A designation boundary shows where a site is, not what is restricted inside it.' },
    );
  },
};

/**
 * COMMERCIAL FISHING — a grid. The value of the pin's OWN cell, with the cell
 * size stated so the reader knows the resolution they are being given.
 *
 * Coverage is the grid itself. MMO published no zero-valued cells — the lowest
 * value anywhere in the corridor is 1 position report — so a pin with no cell
 * beneath it is a place the dataset does not describe, not a place with no
 * fishing. 22% of the pinnable area has no cell, chiefly the landward strip.
 */
const fisheries = {
  id: 'fisheries',
  label: 'Commercial fishing',
  async read(pin, { base }) {
    const fc = await loadJson(`${base}data/fisheries.geojson`);
    let cell = null;
    let nearest = Infinity;
    for (const f of fc.features) {
      if (containsPoint(f.geometry, pin)) { cell = f.properties; break; }
      nearest = Math.min(nearest, distanceToGeometry(f.geometry, pin));
    }
    if (!cell) {
      return notCovered(
        Number.isFinite(nearest) && nearest < 50
          ? `no grid cell here — the nearest surveyed cell is ${nearest.toFixed(1)} km away`
          : 'no grid cell here',
      );
    }
    return reports(
      `${plural(cell.pos, 'VMS position report')} in this 5 km cell, 2019–2022`,
      [
        `mostly ${String(cell.gear).toLowerCase()} (${cell.gearPct}% of activity)`,
        `most reports from ${cell.nat}-flagged vessels · present in ${plural(cell.months, 'month')} of the year`,
      ],
      { caveat: 'VMS is carried by vessels 12 m and over, so the inshore fleet is largely absent.' },
    );
  },
};

/**
 * RIVERS & WATERWAYS — lines. Named features within the radius.
 *
 * Coverage is the catchment boundary: watercourses are a land dataset, and at
 * sea this layer has nothing to say rather than nothing to report. Unnamed
 * reaches are counted but not listed — OSM names a minority of them, and a list
 * of blanks would be worse than a count.
 */
const water = {
  id: 'water',
  label: 'Rivers & waterways',
  async read(pin, { base }) {
    const [boundary, fc] = await Promise.all([
      loadCatchmentBoundary(base),
      loadJson(`${base}data/water.geojson`),
    ]);
    const near = fc.features
      .map((f) => ({ p: f.properties, d: distanceToGeometry(f.geometry, pin) }))
      .filter((o) => o.d <= RADIUS_KM);

    if (!near.length) {
      if (!boundary.contains(pin)) {
        return notCovered('not covered here — this layer maps watercourses on land');
      }
      let nearest = Infinity;
      for (const f of fc.features) nearest = Math.min(nearest, distanceToGeometry(f.geometry, pin));
      return nothingHere(
        Number.isFinite(nearest)
          ? `none within ${RADIUS_KM} km — the nearest is ${nearest.toFixed(1)} km away`
          : `none within ${RADIUS_KM} km`,
      );
    }
    /* OSM splits one river into many ways, so the raw feature count is a count
     * of reaches, not of watercourses. Collapse the named ones by name and
     * report that total instead — otherwise the headline says "5" while the
     * lines below account for 4, and the reader is left to wonder which is
     * wrong. Unnamed reaches cannot be collapsed, so each counts as one. */
    const withName = near.filter((o) => o.p.name);
    const named = [...new Map(withName.map((o) => [o.p.name, o])).values()]
      .sort((a, b) => a.d - b.d);
    const unnamed = near.length - withName.length;
    const total = named.length + unnamed;
    return reports(
      `${plural(total, 'watercourse')} within ${RADIUS_KM} km` +
        (named.length ? ` · ${n(named.length)} named` : ' · none of them named'),
      named.slice(0, 3).map((o) => `${o.p.name} (${o.p.wtype})`),
      { more: Math.max(0, named.length - 3),
        note: unnamed ? `${plural(unnamed, 'unnamed reach').replace('reachs', 'reaches')} not listed` : null,
        caveat: 'Watercourses come from OpenStreetMap, so coverage of small reaches varies.' },
    );
  },
};


/**
 * BATHING WATERS — points. Designated sites within the radius.
 *
 * NEVER "not covered". This is a designation register for the whole corridor,
 * like the marine designations: 191 of the 193 sites fall inside the pinnable
 * area and the two that do not are inland river sites on the Hampshire Avon.
 * So "no designated bathing water within 3 km" is a real finding anywhere a pin
 * can be dropped — and an important one, since 180 km of open coast here is
 * more than 5 km from any site.
 *
 * The permit condition is stated WITHOUT the spill totals. The card carries
 * them; here, next to a distance and a classification, "together they recorded
 * 43 spills" would read as a quantity delivered to that beach. Nothing in this
 * data says an overflow's discharge reaches a particular bathing water.
 */
const bathing = {
  id: 'bathing',
  label: 'Bathing waters',
  async read(pin, { base }) {
    const fc = await loadJson(`${base}data/bathing-waters.geojson`);
    const near = fc.features
      .map((f) => ({ p: f.properties, d: distKm(f.geometry.coordinates, pin) }))
      .filter((o) => o.d <= RADIUS_KM)
      .sort((a, b) => a.d - b.d);

    if (!near.length) {
      let nearest = Infinity;
      for (const f of fc.features) nearest = Math.min(nearest, distKm(f.geometry.coordinates, pin));
      return nothingHere(
        Number.isFinite(nearest)
          ? `none within ${RADIUS_KM} km — the nearest is ${nearest.toFixed(1)} km away`
          : `none within ${RADIUS_KM} km`,
      );
    }
    return reports(
      `${plural(near.length, 'designated site')} within ${RADIUS_KM} km`,
      near.slice(0, 3).map((o) => {
        const cls = o.p.cls
          ? `${o.p.cls} (EA classification for ${o.p.clsYear}, from ${o.p.clsFrom}–${o.p.clsYear} samples)`
          : `not assessed (designated ${o.p.desYr}, never classified)`;
        const ovf = safeCount(o.p.ovf);
        const permit = ovf
          ? `${plural(ovf, 'overflow')} required to monitor because of this site`
          : 'no overflow carries a monitoring requirement for this site';
        return `${away(o.d)}: ${o.p.name} — ${cls} · ${permit}`;
      }),
      {
        more: Math.max(0, near.length - 3),
        caveat: 'A classification aggregates four bathing seasons and says nothing about today; a named overflow is a permit condition, not a measured effect.',
      },
    );
  },
};

/**
 * RECREATIONAL PRESSURE — a grid, like commercial fishing.
 *
 * EVERY CELL CARRIES A REAL VALUE. None is null, none is zero, and the lowest
 * anywhere in the corridor is 0.08 transits a week — verified against the
 * committed file, 10,380 of 10,380. So the absence of a cell is the only
 * silence this layer has, and the faintest shading is a measurement rather than
 * an empty square. That matters more since the graduated opacity went in: pale
 * is a design choice about legibility, not a report of nothing.
 */
const recreational = {
  id: 'recreational',
  label: 'Recreational pressure',
  async read(pin, { base }) {
    const fc = await loadJson(`${base}data/recreational-pressure.geojson`);
    let cell = null;
    let nearest = Infinity;
    for (const f of fc.features) {
      if (containsPoint(f.geometry, pin)) { cell = f.properties; break; }
      nearest = Math.min(nearest, distanceToGeometry(f.geometry, pin));
    }
    if (!cell) {
      return notCovered(
        Number.isFinite(nearest) && nearest < 50
          ? `no grid cell here — the nearest surveyed cell is ${nearest.toFixed(1)} km away`
          : 'no grid cell here',
      );
    }
    const pct = cell.all > 0 ? (cell.rec / cell.all) * 100 : null;
    // Rounding 0.4% to "0%" would say none, which is the one thing this layer
    // never says.
    const share = pct == null ? null : pct < 1 ? 'under 1%' : `${Math.round(pct)}%`;
    return reports(
      `${cell.rec} recreational transit${cell.rec === 1 ? '' : 's'} a week in this 2 km cell, average week of 2015`,
      [
        share != null ? `${share} of all tracked vessel traffic in this cell` : null,
        'Every cell in this grid carries a measured value — none is zero, and the lowest anywhere here is 0.08 a week.',
      ].filter(Boolean),
      {
        caveat: 'AIS misses dinghies, kayaks, paddleboards and most small craft, and on this coast the untracked fleet is probably larger than the tracked one.',
      },
    );
  },
};

/**
 * COMPOUND PRESSURE — a grid, computed at runtime from the sliders.
 *
 * THE WEIGHTS ARE PART OF THE FIGURE. The composite is a weighted mean of
 * whichever of the five pressures a cell has, and the weights are the user's,
 * so a score quoted without them cannot be reproduced or checked. The briefing
 * states them on their own line, every time, and says plainly when they are all
 * equal — because equal is the absence of a recommendation rather than one.
 *
 * The breakdown is carried for the same reason it is on the card: anyone should
 * be able to see which pressure is driving a score. A pressure a cell has no
 * data for reads "not assessed" and is excluded from the mean rather than
 * counted as zero — 92% of cells are unassessed for water body status and 18%
 * for fishing.
 */
const compound = {
  id: 'compound',
  label: 'Compound pressure',
  async read(pin, { base, controllers }) {
    const fc = await loadJson(`${base}data/compound-pressure.geojson`);
    let cell = null;
    let nearest = Infinity;
    for (const f of fc.features) {
      if (containsPoint(f.geometry, pin)) { cell = f.properties; break; }
      nearest = Math.min(nearest, distanceToGeometry(f.geometry, pin));
    }
    if (!cell) {
      return notCovered(
        Number.isFinite(nearest) && nearest < 50
          ? `no grid cell here — the nearest cell is ${nearest.toFixed(1)} km away`
          : 'no grid cell here',
      );
    }
    const w = controllers?.get('compound')?.getWeights?.() ?? { s: 1, w: 1, r: 1, f: 1, d: 1 };
    let num = 0, den = 0;
    const parts = [];
    for (const [k, label] of CP_PRESSURES) {
      const v = cell[k];
      if (v == null) { parts.push(`${label} not assessed`); continue; }
      num += w[k] * v; den += w[k];
      parts.push(`${label} ${Number(v).toFixed(2)}`);
    }
    const score = den > 0 ? num / den : 0;
    const equal = CP_PRESSURES.every(([k]) => w[k] === w.s);
    const weights = equal
      ? `Weighting in force: all five equal at ${Number(w.s).toFixed(1)} — equal is the absence of a recommendation, not one.`
      : `Weighting in force: ${CP_PRESSURES.map(([k, l]) => `${l} ×${Number(w[k]).toFixed(1)}`).join(' · ')}`;
    return reports(
      `${score.toFixed(2)} of 1 in this 2 km cell, under the weighting on screen now`,
      [parts.join(' · '), weights],
      {
        caveat: 'A Compound Pressure Indicator, not a cumulative effects assessment: it shows where separately-monitored pressures are simultaneously high, and establishes nothing about ecological harm.',
      },
    );
  },
};

/** Readers by layer id. A layer with no reader stays `pending`. */
export const READERS = Object.fromEntries(
  [
    // Stage two-A — one of each geometry type, establishing the pattern.
    stormOverflows, marine, fisheries, water,
    // Stage two-B batch one — the registers and grids.
    bathing, recreational, compound,
  ].map((r) => [r.id, r]),
);

/** Layers that are inert placeholders with no data anywhere in the corridor.
 *  Their silence is a third thing again, and it is known without looking. */
export const NO_DATA_LAYERS = new Set(['beachlitter', 'shellfish']);
