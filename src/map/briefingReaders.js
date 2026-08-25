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
import { snapshotTime, partialNote } from './liveOverflows.js';

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
const SEABED_LABEL = {
  rock: 'Rock & reef', coarse: 'Coarse sediment', mixed: 'Mixed sediment',
  sand: 'Sand', mud: 'Mud', biogenic: 'Biogenic reef', intertidal: 'Intertidal',
  sediment: 'Sediment', unknown: 'Unclassified',
};

/** The 18 marine species, as [file key, common name]. Kept in step with
 *  MARINE_SPECIES in layers.js — same reason the other tables are duplicated. */
const MARINE_SPECIES_KEYS = [
  ['greyseal', 'Grey seal'], ['harbourseal', 'Harbour seal'],
  ['commondolphin', 'Common dolphin'], ['bottlenose', 'Bottlenose dolphin'],
  ['porpoise', 'Harbour porpoise'], ['minkewhale', 'Minke whale'],
  ['baskingshark', 'Basking shark'], ['tope', 'Tope'],
  ['thornbackray', 'Thornback ray'], ['undulateray', 'Undulate ray'],
  ['bluefin', 'Atlantic bluefin tuna'], ['seahorse', 'Spiny seahorse'],
  ['shortseahorse', 'Short-snouted seahorse'], ['cuttlefish', 'Common cuttlefish'],
  ['curledoctopus', 'Curled octopus'], ['commonoctopus', 'Common octopus'],
  ['europeansquid', 'European squid'], ['veinedsquid', 'Veined squid'],
];

const MARINE_SPECIES_CAVEAT =
  'Records cluster where people go, and most are resolved only to a 10 km square — a dot marks an area someone reported from, not an animal\'s position.';

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

/* ---- land or sea ----------------------------------------------------------
 *
 * Several layers describe only the sea (wrecks, marine licences) or only the
 * shoreline (coastal erosion), and their silences are unreadable without
 * knowing which side of the coast the pin is on: "no mapped frontage within
 * 3 km" means something different 40 km out to sea than it does 15 km inland.
 *
 * The catchment boundary CANNOT answer this and was tried first. It is a
 * drainage boundary, so it contains both inland ground and a wide apron of
 * near-shore sea — the stage two-A test pin south of Selsey is 9.3 km offshore
 * and inside it.
 *
 * OSM's own convention answers it instead: `natural=coastline` ways are
 * directed with LAND ON THE LEFT. Take the nearest segment of the committed
 * coastline and the sign of the cross product gives the side. Checked against
 * eleven hand-picked points — five at sea from mid-Channel to Plymouth Sound,
 * six inland from Exeter to Salisbury — and correct on all eleven, so the
 * direction survived the 4% simplification in scripts/fetch-coastline.mjs.
 *
 * Only ever consulted to EXPLAIN A SILENCE, never to produce a figure. By the
 * time it is asked, nothing is within 3 km of the pin, so the near-shore case
 * where the side is genuinely ambiguous does not arise. */
async function sideOfCoast(pin, base) {
  const fc = await loadJson(`${base}data/coastline.geojson`);
  const k = kx(pin[1]);
  const px = pin[0] * k;
  const py = pin[1] * KY;
  let best = Infinity;
  let cross = 0;
  for (const f of fc.features) {
    const line = f.geometry?.coordinates;
    if (!line) continue;
    for (let i = 0; i < line.length - 1; i++) {
      const ax = line[i][0] * k, ay = line[i][1] * KY;
      const bx = line[i + 1][0] * k, by = line[i + 1][1] * KY;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d < best) { best = d; cross = dx * (py - ay) - dy * (px - ax); }
    }
  }
  return { side: cross > 0 ? 'land' : 'sea', km: best };
}

/** The half-sentence that says where the pin is, for a layer that only covers
 *  one side of the coast. */
async function whichSide(pin, base) {
  const { side, km } = await sideOfCoast(pin, base);
  return side === 'land'
    ? `this point is ${km.toFixed(1)} km inland`
    : `this point is ${km.toFixed(1)} km out to sea`;
}

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
 * WATER BODY STATUS — polygons. Contains-or-near, like the designations.
 *
 * THE SHORELINE PROBLEM. WFD polygons stop at the water's edge, so a pin on a
 * beach is routinely outside every one of them while plainly standing in
 * coastal water. Measured against the 193 bathing water points, which sit on
 * that same edge: only 69 fall inside a polygon, but 87 of the remaining 124
 * are within 50 m and 110 within 100 m. Treating those as silence would be
 * wrong twice over — it is neither "nothing here" nor "not covered".
 *
 * So the same contains/near split the designations use, with `away()` giving
 * metres below a kilometre. A pin 60 m off Portsmouth Harbour reports
 * Portsmouth Harbour and says it is 60 m outside it.
 *
 * NEVER "nothing here". WFD classifies estuaries and the coastal strip and
 * nothing else, so its scope and its polygons are the same object: there is no
 * place that WFD covers but has no water body. Beyond the radius the answer is
 * always "not covered", and the reason is the scope, not the pin.
 */
const wfd = {
  id: 'wfd',
  label: 'Water body status',
  async read(pin, { base }) {
    const fc = await loadJson(`${base}data/wfd-coastal.geojson`);
    const all = fc.features
      .filter((f) => f.geometry)
      .map((f) => ({ p: f.properties, in: containsPoint(f.geometry, pin), d: distanceToGeometry(f.geometry, pin) }));
    const inside = all.filter((o) => o.in);
    const near = all.filter((o) => !o.in && o.d <= RADIUS_KM).sort((a, b) => a.d - b.d);

    if (!inside.length && !near.length) {
      return notCovered(
        `not covered here — WFD classifies estuaries and the coastal strip, and ${await whichSide(pin, base)}`,
      );
    }
    const line = (o, where) => {
      const kind = o.p.wbtype === 'Transitional' ? 'estuary' : 'coastal water';
      const bits = [o.p.eco ? `${o.p.eco} ecological` : null, o.p.chem ? `${o.p.chem} chemical` : null]
        .filter(Boolean).join(', ');
      return `${where}: ${o.p.name} (${kind}) — ${bits || 'not classified'}, ${o.p.year}`;
    };
    const bits = [];
    if (inside.length) bits.push(`${plural(inside.length, 'water body', 'water bodies')} contain${inside.length === 1 ? 's' : ''} this point`);
    if (near.length) {
      bits.push(inside.length
        ? `${n(near.length)} more within ${RADIUS_KM} km`
        : `${plural(near.length, 'water body', 'water bodies')} within ${RADIUS_KM} km, none containing this point`);
    }
    return reports(
      bits.join(' · '),
      [
        ...inside.slice(0, 2).map((o) => line(o, 'contains this point')),
        ...near.slice(0, 2).map((o) => line(o, away(o.d))),
      ],
      {
        more: Math.max(0, inside.length + near.length - Math.min(inside.length, 2) - Math.min(near.length, 2)),
        caveat: 'A classification is of the whole water body, not of the pin — these are stretches of coast and estuary, not points.',
      },
    );
  },
};

/**
 * LIVE DISCHARGE STATUS — points, fetched on toggle.
 *
 * The only reader with no committed file behind it. The feed is queried when the
 * layer is switched on, so the reader takes the prepared data and its fetch time
 * from the controller rather than re-fetching — a second query would produce a
 * briefing that disagrees with the map.
 *
 * That snapshot can now be REPLACED, by the manual refresh on the floating
 * live-status control. Nothing here has to react: the refresh swaps the
 * controller's prepared object and the map's data in one step, and it clears the
 * pin as it goes, so no briefing outlives the snapshot it was read from. The
 * time quoted below is formatted by the same `snapshotTime` the control uses,
 * which is what stops the two surfaces wording one moment two ways.
 *
 * If the layer is off there is no snapshot, and the framework's "not loaded"
 * line stands. That is the correct answer and not a limitation: reporting a
 * figure from a feed nobody has fetched would be inventing one.
 *
 * THE THREE STATES ARE KEPT APART. A monitor with no signal is not a monitor
 * reporting no discharge, and collapsing offline into "not discharging" would
 * turn missing information into reassurance.
 */
const stormLive = {
  id: 'storm-live',
  label: 'Live discharge status',
  async read(pin, { base, controllers }) {
    /* The feed is queried the moment the layer is switched on, and a pin
     * dropped while that is still in flight would otherwise read as a failure.
     * Wait for the controller to settle either way before deciding. */
    const c = controllers?.get('storm-live');
    if (!c?.getPrepared?.()) {
      await new Promise((resolve) => {
        let settled = false;
        const done = () => { if (!settled) { settled = true; resolve(); } };
        c?.onReady?.(done);
        c?.onUnavailable?.(done);
        setTimeout(done, 20000);
      });
    }
    const prepared = c?.getPrepared?.();
    if (!prepared?.data) {
      return {
        status: 'unavailable',
        summary: 'no live snapshot — the company feeds did not respond',
        items: [],
      };
    }
    const boundary = await loadCatchmentBoundary(base);
    const near = prepared.data.features
      .map((f) => ({ p: f.properties, d: distKm(f.geometry.coordinates, pin) }))
      .filter((o) => o.d <= RADIUS_KM)
      .sort((a, b) => a.d - b.d);

    const time = snapshotTime(prepared.stats);
    const taken = time
      ? `Snapshot taken at ${time}; refresh it from the live status control beside the panel.`
      : 'Snapshot taken when the layer was switched on; refresh it from the live status control beside the panel.';
    const note = partialNote(prepared.stats);
    const partial = note ? ` ${note}` : '';

    if (!near.length) {
      if (!boundary.contains(pin)) {
        return notCovered('not covered here — this layer maps outfalls on land and the shoreline');
      }
      let nearest = Infinity;
      for (const f of prepared.data.features) nearest = Math.min(nearest, distKm(f.geometry.coordinates, pin));
      return nothingHere(
        Number.isFinite(nearest)
          ? `no monitored outfall within ${RADIUS_KM} km — the nearest is ${nearest.toFixed(1)} km away`
          : `no monitored outfall within ${RADIUS_KM} km`,
      );
    }
    const on = near.filter((o) => o.p.status === 1);
    const off = near.filter((o) => o.p.status === 0);
    const dark = near.filter((o) => o.p.status === -1);
    const state = [
      `${n(on.length)} discharging`,
      `${n(off.length)} not discharging`,
      `${n(dark.length)} offline`,
    ].join(', ');
    // Discharging first, then offline, then quiet: the ones that say something
    // come before the ones that say nothing.
    const rank = (o) => (o.p.status === 1 ? 0 : o.p.status === -1 ? 1 : 2);
    const listed = near.slice().sort((a, b) => rank(a) - rank(b) || a.d - b.d);
    return reports(
      `${plural(near.length, 'monitored outfall')} within ${RADIUS_KM} km · ${state}`,
      listed.slice(0, 3).map((o) =>
        `${away(o.d)}: ${o.p.name || o.p.id} — ${LIVE_LABEL[String(o.p.status)]}`),
      {
        more: Math.max(0, near.length - 3),
        note: taken + partial,
        caveat: 'A monitor with no signal is not a monitor reporting no discharge — offline is its own state, not a quiet one.',
      },
    );
  },
};

/**
 * COASTAL EROSION RISK — polygons along the shoreline.
 *
 * NEVER "nothing here". NCERM maps shoreline frontages and nothing else: there
 * is no offshore NCERM and no inland NCERM, so a pin with no frontage within
 * 3 km is outside what the layer describes rather than at a stretch of coast it
 * found nothing at. Every silence is "not covered".
 *
 * The two silences that look identical are told apart. A pin mid-Channel and a
 * pin fifteen kilometres inland both get no frontage, for opposite reasons, and
 * the line says which — see sideOfCoast above for how, and why the catchment
 * boundary could not do it.
 *
 * An empty def_type is a GAP, never "undefended": 43% of frontages have nothing
 * in that field, and the build carries it through as null for exactly this
 * reason.
 */
const ncerm = {
  id: 'ncerm',
  label: 'Coastal erosion risk',
  async read(pin, { base }) {
    const fc = await loadJson(`${base}data/ncerm.geojson`);
    const scored = fc.features
      .filter((f) => f.geometry)
      .map((f) => ({ p: f.properties, in: containsPoint(f.geometry, pin), d: distanceToGeometry(f.geometry, pin) }))
      .filter((o) => o.d <= RADIUS_KM);

    if (!scored.length) {
      let nearest = Infinity;
      for (const f of fc.features) nearest = Math.min(nearest, distanceToGeometry(f.geometry, pin));
      const side = await whichSide(pin, base);
      return notCovered(
        `not covered here — this layer maps the shoreline, and ${side}` +
          (Number.isFinite(nearest) ? ` · nearest mapped frontage ${nearest.toFixed(1)} km away` : ''),
      );
    }
    scored.sort((a, b) => b.p.risk - a.p.risk || a.d - b.d);
    const top = scored[0];
    const recess = scored.map((o) => o.p.dist).filter((v) => v != null);
    const span = recess.length
      ? (Math.min(...recess) === Math.max(...recess)
        ? `${Math.max(...recess)} m projected recession by 2055`
        : `${Math.min(...recess)}–${Math.max(...recess)} m projected recession by 2055`)
      : null;
    const smps = [...new Set(scored.map((o) => o.p.smp).filter(Boolean))];
    return reports(
      `${plural(scored.length, 'frontage')} within ${RADIUS_KM} km · highest risk here is ${(EROSION[top.p.risk] ?? 'unknown').toLowerCase()}`,
      [
        span,
        `${top.in ? 'contains this point' : away(top.d)}: ${EROSION[top.p.risk] ?? 'Unknown'} risk` +
          (top.p.def ? `, ${top.p.def}` : ', defence type not recorded'),
        smps.length ? `Shoreline Management Plan: ${smps.slice(0, 2).join('; ')}` : null,
      ].filter(Boolean),
      {
        // No "and N more" here: the items are a span, a frontage and an SMP
        // area rather than a list of frontages, so a remainder count would be
        // counting something the reader cannot see the start of. The total is
        // already the first thing the summary says.
        caveat: 'Risk is the no-active-intervention scenario, and an unrecorded defence type is a gap in the register, not an undefended shore.',
      },
    );
  },
};

/**
 * DREDGING & EXTRACTION — polygons. MMO's marine licence register.
 *
 * Coverage is the SEA. A licence to dredge or dispose is a marine consent, so a
 * pin inland is outside the register's scope; a pin at sea with no licence
 * within 3 km is a real finding about that water.
 */
const licensing = {
  id: 'licensing',
  label: 'Dredging & extraction',
  async read(pin, { base }) {
    const fc = await loadJson(`${base}data/marine-licensing.geojson`);
    /* A single licence is often several parcels, so collapse by its reference
     * before counting — otherwise "10 licensed areas" counts the same consent
     * twice and lists it twice underneath. */
    const byRef = new Map();
    for (const f of fc.features) {
      if (!f.geometry) continue;
      const key = f.properties.ref || f.properties.title || JSON.stringify(f.properties);
      const cur = byRef.get(key) ?? { p: f.properties, in: false, d: Infinity };
      if (containsPoint(f.geometry, pin)) cur.in = true;
      cur.d = Math.min(cur.d, distanceToGeometry(f.geometry, pin));
      byRef.set(key, cur);
    }
    const all = [...byRef.values()];
    const near = all.filter((o) => o.d <= RADIUS_KM).sort((a, b) => (b.in - a.in) || a.d - b.d);

    if (!near.length) {
      const { side, km } = await sideOfCoast(pin, base);
      if (side === 'land') {
        return notCovered(`not covered here — this is a marine licence register and this point is ${km.toFixed(1)} km inland`);
      }
      const nearest = Math.min(...all.map((o) => o.d));
      return nothingHere(
        Number.isFinite(nearest)
          ? `none within ${RADIUS_KM} km — the nearest licensed area is ${nearest.toFixed(1)} km away`
          : `none within ${RADIUS_KM} km`,
      );
    }
    const inside = near.filter((o) => o.in);
    const bits = [`${plural(near.length, 'licensed area')} within ${RADIUS_KM} km`];
    if (inside.length) bits.push(`${n(inside.length)} containing this point`);
    return reports(
      bits.join(' · '),
      near.slice(0, 3).map((o) => {
        const when = [o.p.start, o.p.end].filter(Boolean).map((d) => String(d).slice(0, 4));
        return `${o.in ? 'contains this point' : away(o.d)}: ${o.p.title || o.p.type} — ${o.p.type}` +
          (o.p.status ? `, ${o.p.status}` : '') + (when.length === 2 ? ` (${when[0]}–${when[1]})` : '');
      }),
      {
        more: Math.max(0, near.length - 3),
        caveat: 'A licence is a permission to act, not a record of work carried out.',
      },
    );
  },
};

/**
 * SHIPWRECKS — points, with Historic England's protected sites kept separate.
 *
 * The two sources are counted apart because they are different facts: a UKHO
 * record is a hazard to navigation, a Historic England designation is a legal
 * protection. Protected sites are listed first however far they are, since
 * there are only 31 in the corridor and one within 3 km is the more notable
 * thing on the line.
 *
 * Coverage is the SEA, as with the licence register.
 */
const wrecks = {
  id: 'wrecks',
  label: 'Shipwrecks',
  async read(pin, { base }) {
    const [fc, prot] = await Promise.all([
      loadJson(`${base}data/wrecks.geojson`),
      loadJson(`${base}data/wrecks-protected.geojson`),
    ]);
    const near = fc.features
      .map((f) => ({ p: f.properties, d: distKm(f.geometry.coordinates, pin) }))
      .filter((o) => o.d <= RADIUS_KM).sort((a, b) => a.d - b.d);
    const nearProt = prot.features
      .map((f) => ({ p: f.properties, d: distKm(f.geometry.coordinates, pin) }))
      .filter((o) => o.d <= RADIUS_KM).sort((a, b) => a.d - b.d);

    if (!near.length && !nearProt.length) {
      const { side, km } = await sideOfCoast(pin, base);
      if (side === 'land') {
        return notCovered(`not covered here — UKHO records wrecks on the seabed and this point is ${km.toFixed(1)} km inland`);
      }
      let nearest = Infinity;
      for (const f of fc.features) nearest = Math.min(nearest, distKm(f.geometry.coordinates, pin));
      return nothingHere(
        Number.isFinite(nearest)
          ? `none within ${RADIUS_KM} km — the nearest recorded wreck is ${nearest.toFixed(1)} km away`
          : `none within ${RADIUS_KM} km`,
      );
    }
    const dangerous = near.filter((o) => String(o.p.cat || '').includes('dangerous')).length;
    const bits = [`${plural(near.length, 'recorded wreck')} within ${RADIUS_KM} km`];
    if (nearProt.length) bits.push(`${plural(nearProt.length, 'Historic England protected site')}`);
    else if (dangerous) bits.push(`${n(dangerous)} classed dangerous`);
    const named = near.filter((o) => o.p.name);
    return reports(
      bits.join(' · '),
      [
        ...nearProt.slice(0, 2).map((o) => `protected site, ${away(o.d)}: ${o.p.name} — designated ${o.p.designated}`),
        ...named.slice(0, 2).map((o) =>
          `${away(o.d)}: ${o.p.name}` +
          [o.p.type, o.p.sunk ? `lost ${o.p.sunk}` : null].filter(Boolean).map((x) => ` — ${x}`).join('')),
      ],
      {
        note: named.length < near.length
          ? `${plural(near.length - named.length, 'wreck')} within ${RADIUS_KM} km carry no name`
          : null,
        caveat: 'Only 54% of these wrecks carry a name and 44% have neither name nor date — a sparse record is the register being honest.',
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


/**
 * SEABED HABITATS — polygons. The class beneath the pin.
 *
 * NEVER "nothing here". UKSeaMap is a continuous predictive surface, so the
 * absence of a polygon is always the absence of MODELLING, never the absence of
 * seabed. Every silence is "not covered".
 *
 * THE INTERTIDAL IS DETECTABLE, and it is worth detecting. UKSeaMap stops at
 * the low-water mark, leaving an unmapped strip hugging the shore: measured
 * against the committed file, a pin 10 m from the coast at Southsea has no
 * polygon and the nearest is 280 m away; at Porthcurno, 100 m from the coast,
 * the nearest is 250 m. Cover starts by about 500 m. So a pin within 500 m of
 * the coastline with no polygon is in that strip and the line says which limit
 * it has hit, rather than leaving the reader to guess.
 *
 * ON STUDLAND, where the layer's own About text is the better guide. The
 * seagrass there is missing NOT because the bay is unmapped — a polygon covers
 * it and calls it EUNIS A5.23, infralittoral fine sand — but because a
 * broad-scale model cannot resolve a feature that small. The intertidal
 * exclusion is real and is reported here; it is not the Studland explanation.
 */
const seabed = {
  id: 'seabed',
  label: 'Seabed habitats',
  async read(pin, { base }) {
    const fc = await loadJson(`${base}data/seabed.geojson`);
    let hit = null;
    let nearest = Infinity;
    for (const f of fc.features) {
      if (containsPoint(f.geometry, pin)) { hit = f.properties; break; }
      nearest = Math.min(nearest, distanceToGeometry(f.geometry, pin));
    }
    if (!hit) {
      const { side, km } = await sideOfCoast(pin, base);
      if (km <= 0.5) {
        return notCovered('not covered here — UKSeaMap stops at the low-water mark and does not map the intertidal');
      }
      if (side === 'land') {
        return notCovered(`not covered here — this layer maps the sea floor and this point is ${km.toFixed(1)} km inland`);
      }
      return notCovered(
        Number.isFinite(nearest)
          ? `not modelled here — the nearest mapped seabed is ${nearest.toFixed(1)} km away`
          : 'not modelled here',
      );
    }
    return reports(
      SEABED_LABEL[hit.grp] ?? 'Seabed habitat',
      [
        [hit.code ? `EUNIS ${hit.code}` : null, hit.name].filter(Boolean).join(' — '),
        hit.zone,
      ].filter(Boolean),
      {
        // Stated on the line, not only in the notes: a substrate named with
        // this much confidence invites being read as survey.
        note: 'Predictive model (JNCC UKSeaMap), not survey.',
        caveat: 'Modelled from bathymetry, substrate, light and wave and tidal energy — the source draws no distinction between modelled and surveyed ground, because all of it is modelled.',
      },
    );
  },
};

/**
 * MARINE SPECIES — points, 18 species, each its own file.
 *
 * THE LEAST TRUSTWORTHY SILENCE ON THE MAP, and the reader's main job is to
 * stop it reading as absence. Records cluster where people go — ferry routes,
 * dive sites, the headlands watchers stand on — so no records within 3 km means
 * nobody reported, and the line says exactly that rather than leaving it to the
 * notes.
 *
 * ALL EIGHTEEN, ALWAYS, whatever the checklist shows. Two reasons. A briefing
 * filtered by an incidental UI state cannot be reproduced from the link it
 * carries; and the checklist starts with everything unticked, so a
 * checklist-filtered briefing would report nothing at all by default — the
 * worst possible default for the one layer whose silence is least meaningful.
 *
 * Reading all eighteen while the map draws three would otherwise look like a
 * bug, so the line says how many the checklist is showing whenever the two
 * differ. All eighteen files together are 268 KB, so this costs little.
 */
const marineSpecies = {
  id: 'marine-species',
  label: 'Marine species',
  async read(pin, { base, controllers }) {
    const found = [];
    await Promise.all(MARINE_SPECIES_KEYS.map(async ([key, common]) => {
      const fc = await loadJson(`${base}data/marine-species/${key}.geojson`);
      let squares = 0;
      let records = 0;
      for (const f of fc.features) {
        if (distKm(f.geometry.coordinates, pin) <= RADIUS_KM) {
          squares++;
          records += f.properties.n ?? 0;
        }
      }
      if (squares) found.push({ common, squares, records });
    }));
    found.sort((a, b) => b.records - a.records);

    const ticked = controllers?.get('marine-species')?.checkedKeys?.().length ?? 0;
    const showing = ticked === MARINE_SPECIES_KEYS.length
      ? null
      : `Reporting all ${MARINE_SPECIES_KEYS.length} species; the checklist on the map is showing ${ticked === 0 ? 'none' : n(ticked)}.`;

    if (!found.length) {
      const { side, km } = await sideOfCoast(pin, base);
      if (side === 'land' && km > 0.5) {
        return notCovered(`not covered here — these are marine species records and this point is ${km.toFixed(1)} km inland`);
      }
      return {
        status: 'nothing-here',
        summary: `no records within ${RADIUS_KM} km from any of the ${MARINE_SPECIES_KEYS.length} species — which means nobody reported here, not that nothing is there`,
        items: [],
        note: showing,
        caveat: MARINE_SPECIES_CAVEAT,
      };
    }
    return reports(
      `${n(found.length)} of ${MARINE_SPECIES_KEYS.length} species recorded within ${RADIUS_KM} km`,
      found.slice(0, 3).map((s) =>
        `${s.common} — ${plural(s.records, 'record')} across ${plural(s.squares, 'grid square')}`),
      {
        more: Math.max(0, found.length - 3),
        note: showing,
        caveat: MARINE_SPECIES_CAVEAT,
      },
    );
  },
};

/**
 * SEA FLOOD RISK — four extents, ONE row.
 *
 * Four separate lines would say nearly the same thing four times and bury the
 * only comparison that matters, which is defended against undefended at the
 * same return period. So the four layers collapse into a single row: the
 * summary counts how many contain the pin, and one line per return period puts
 * the pair side by side.
 *
 * The source and scenario are stated ONCE, at the foot of the block.
 *
 * THEY DO NOT NEST, and the format must not assume they do. Sweeping the
 * corridor at 0.01° turns up 14 distinct combinations of the four, including 7
 * cells inside the DEFENDED 1-in-200 extent but outside the undefended one. A
 * format that printed "inside the 1-in-200 extent" without saying which would
 * be wrong in both directions.
 *
 * Only the loaded extents can be reported on, and the block says which of the
 * four are missing rather than quietly reporting three as if they were four.
 */
const FLOOD_MEMBERS = [
  { id: 'sea-flood-200u', rp: 200, defended: false },
  { id: 'sea-flood-200d', rp: 200, defended: true },
  { id: 'sea-flood-1000u', rp: 1000, defended: false },
  { id: 'sea-flood-1000d', rp: 1000, defended: true },
];

const seaFlood = {
  id: 'sea-flood',
  label: 'Sea flood risk',
  members: FLOOD_MEMBERS.map((m) => m.id),
  async read(pin, { base, controllers }) {
    const state = await Promise.all(FLOOD_MEMBERS.map(async (m) => {
      // isLoaded, not isVisible: the four extents can be loaded for a briefing
      // without being drawn, and this reader's whole job is to say which of them
      // it could actually consult.
      if (!controllers?.get(m.id)?.isLoaded?.()) return { ...m, loaded: false };
      const fc = await loadJson(`${base}data/${m.id.replace('sea-flood-', 'sea-flood-')}.geojson`);
      return { ...m, loaded: true, inside: fc.features.some((f) => containsPoint(f.geometry, pin)) };
    }));
    const loaded = state.filter((s) => s.loaded);
    const missing = state.filter((s) => !s.loaded);
    const inside = loaded.filter((s) => s.inside);

    const pair = (rp) => {
      const u = state.find((s) => s.rp === rp && !s.defended);
      const d = state.find((s) => s.rp === rp && s.defended);
      const say = (s) => (!s.loaded ? 'not loaded' : s.inside ? 'inside' : 'outside');
      return `1 in ${rp} — undefended: ${say(u)} · defended: ${say(d)}`;
    };
    const scenario = 'EA NaFRA2, December 2024 · UKCP18 RCP 8.5 upper end, to 2125';

    // "2 of the 2 modelled extents loaded here" is a mouthful for the ordinary
    // case, where all four are on. Say "of the 4" then, and only spell out the
    // loaded subset when it is actually a subset.
    const whole = missing.length === 0;
    const of = whole
      ? `the ${FLOOD_MEMBERS.length} modelled extents`
      : `the ${n(loaded.length)} extent${loaded.length === 1 ? '' : 's'} that are loaded`;
    const summary = inside.length
      ? `inside ${n(inside.length)} of ${of}`
      : (whole ? `outside all ${FLOOD_MEMBERS.length} modelled extents` : `outside all of ${of}`);
    return reports(
      summary,
      [pair(200), pair(1000)],
      {
        note: missing.length
          ? `${scenario}. ${plural(missing.length, 'extent')} not loaded, so ${missing.length === 1 ? 'it is' : 'they are'} not reported on.`
          : scenario,
        caveat: 'A modelled extent of a flood event, not a sea-level line, and not a statement about any individual property.',
      },
    );
  },
};

/**
 * THE TWO INERT PLACEHOLDERS. Both are no-data everywhere, and both were
 * refused after an investigation rather than merely not built yet. The reason is
 * the useful part — a bare "no data" invites someone to go and add the layer
 * that was already ruled out.
 */
const shellfish = {
  id: 'shellfish',
  // Nothing to load: the toggle is inert, so this reports whether or not it is on.
  needsLayer: false,
  label: 'Shellfish water quality',
  async read() {
    return {
      status: 'no-data',
      summary: 'no data anywhere in the corridor',
      items: ['The current classification list has no zone geometry to join to: the only published boundaries are a 2019 vintage against a list revised monthly, and the join tested at 1.4%.'],
    };
  },
};

const beachLitter = {
  id: 'beachlitter',
  // Nothing to load: the toggle is inert, so this reports whether or not it is on.
  needsLayer: false,
  label: 'Beach litter',
  async read() {
    return {
      status: 'no-data',
      summary: 'no data anywhere in the corridor',
      items: ['MCS Beachwatch is licence-blocked, and the EEA alternative held nine undated points in the corridor with none at all between Portsmouth and Eastbourne.'],
    };
  },
};

/** Readers by layer id. A layer with no reader stays `pending`. */
export const READERS = Object.fromEntries(
  [
    // Stage two-A — one of each geometry type, establishing the pattern.
    stormOverflows, marine, fisheries, water,
    // Stage two-B batch one — the eight tractable layers.
    bathing, wfd, stormLive, ncerm, licensing, wrecks, recreational, compound,
    // Stage two-B batch two — completing the readout.
    seabed, marineSpecies, shellfish, beachLitter,
  ].map((r) => [r.id, r]),
);

/**
 * Readers that speak for SEVERAL layers at once, rendered as one row in place
 * of the first member. Only the sea flood extents qualify: four lines saying
 * nearly the same thing would bury the defended/undefended comparison that is
 * the whole reason all four are published.
 */
export const READER_GROUPS = [seaFlood];

/**
 * CAVEAT CATEGORIES. With every layer reporting, a busy pin carries fifteen
 * notes, and fifteen in a flat list is a wall nobody reads. They group under
 * four headings, and the taxonomy lives here as one table you can read top to
 * bottom rather than scattered across the readers.
 *
 * The three the brief proposed did not quite fit. A designation is not
 * management, a licence is not work done, an offline monitor is not a quiet
 * one: those three are not about counting, coverage or modelling but about the
 * gap between what a register records and what it invites you to conclude. That
 * earned a heading of its own.
 */
export const CAVEAT_GROUPS = [
  { key: 'counted', label: 'How figures are counted', ids: ['bathing', 'wfd', 'storm-annual'] },
  { key: 'meaning', label: 'What a record means', ids: ['marine', 'licensing', 'storm-live'] },
  { key: 'unseen', label: 'What a layer does not see', ids: ['fisheries', 'recreational', 'wrecks', 'water', 'marine-species'] },
  { key: 'modelled', label: 'Modelled, not measured', ids: ['ncerm', 'seabed', 'sea-flood', 'compound'] },
];
