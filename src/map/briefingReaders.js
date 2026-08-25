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

const n = (v) => Number(v ?? 0).toLocaleString('en-GB');
const plural = (c, word) => `${n(c)} ${word}${c === 1 ? '' : 's'}`;
/** Under 100 m from a polygon edge, a decimal reads as false precision and
 *  "0.0 km away" reads as a contradiction of "does not contain this point". */
const away = (d) => (d < 0.1 ? 'just outside' : `${d.toFixed(1)} km away`);

/* ---- the four readers ----------------------------------------------------- */

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

/** Readers by layer id. A layer with no reader stays `pending`. */
export const READERS = Object.fromEntries(
  [stormOverflows, marine, fisheries, water].map((r) => [r.id, r]),
);

/** Layers that are inert placeholders with no data anywhere in the corridor.
 *  Their silence is a third thing again, and it is known without looking. */
export const NO_DATA_LAYERS = new Set(['beachlitter', 'shellfish']);
