/**
 * SITE BRIEFING — the pin mode.
 *
 * A visitor arms the mode, drops a pin in the water (or within 3 km of it), and
 * the second panel opens a synthesised readout of what every layer says at that
 * point — and what every layer is SILENT about there. This module owns the map
 * side of that: the pinnable boundary, the cursor, the click, the pin marker and
 * the radius ring. It knows nothing about the readout's content.
 *
 * WHERE A PIN MAY GO. public/data/pinnable-area.geojson, built at data time by
 * scripts/build-pinnable-area.mjs — the corridor's wet part plus a 3 km landward
 * strip. Pinning on Salisbury Plain would produce a briefing in which every
 * layer is silent, which says nothing about Salisbury Plain and everything about
 * the question being wrong.
 *
 * THE BOUNDARY TREATMENT IS A DIM ON THE OUTSIDE, not a fill on the inside.
 * Every layer this briefing reads lives INSIDE the pinnable area, so a tint over
 * it would sit on top of the very data the visitor is trying to see. Dimming
 * what is out of bounds leaves all of it untouched and still makes the edge
 * obvious by contrast. A hairline runs along the boundary itself so the edge
 * stays legible where the dim is subtle — over open sea, for instance, where
 * there is nothing behind it to dim against.
 *
 * The mode STAYS ARMED after a pin is dropped: a visitor comparing two bays
 * should not have to re-arm between them. A second pin replaces the first.
 */

/** How far around the pin the briefing reports. Shown on the panel, not just here. */
export const BRIEFING_RADIUS_KM = 3;

/** Ray casting, matching catchmentBoundary.js and scripts/lib/geo.mjs. */
function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function indexPolygons(geometry) {
  const polys = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  return polys.map((rings) => {
    let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
    for (const [x, y] of rings[0]) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    return { rings, bbox: [x0, y0, x1, y1] };
  });
}

/**
 * The DIM MASK: everything that is NOT pinnable, as one drawable feature.
 *
 * Built by inversion rather than by drawing the pinnable area — an outer ring
 * round the whole world with each pinnable part punched out of it, plus one
 * polygon per interior hole so that land more than 3 km from water is dimmed
 * too rather than showing through as a bright island.
 */
function buildMask(polys) {
  const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
  const outer = [world, ...polys.map((p) => p.rings[0])];
  const holes = polys.flatMap((p) => p.rings.slice(1).map((r) => [r]));
  return { type: 'MultiPolygon', coordinates: [outer, ...holes] };
}

/** A circle on the ground, as a polygon ring. 64 sides is smooth at any zoom
 *  this map allows and costs nothing to regenerate on each pin. */
function circle([lon, lat], km, steps = 64) {
  const dLat = km / 110.574;
  const dLon = km / (111.320 * Math.cos((lat * Math.PI) / 180));
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    ring.push([lon + dLon * Math.cos(t), lat + dLat * Math.sin(t)]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}

const EMPTY = { type: 'FeatureCollection', features: [] };

/**
 * @param {object}   opts
 * @param {maplibregl.Map} opts.map
 * @param {string}   opts.base            import.meta.env.BASE_URL
 * @param {Function} opts.onChange        called whenever the pin or armed state changes
 * @param {string}   opts.beforeId        insert the mode's layers beneath this one
 */
export function createSiteBriefing({ map, base = '/', onChange, beforeId }) {
  let armed = false;
  let pin = null;        // [lon, lat] or null
  let polys = null;      // indexed pinnable polygons, once loaded
  let loading = null;    // in-flight load promise
  let failed = false;

  const AREA_SRC = 'briefing-area-source';
  const PIN_SRC = 'briefing-pin-source';
  const DIM = 'briefing-dim';
  const EDGE = 'briefing-edge';
  const RADIUS = 'briefing-radius';
  const PIN_HALO = 'briefing-pin-halo';
  const PIN_DOT = 'briefing-pin-dot';

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();

  /** Load the boundary once, on first arm. Nothing is fetched for a visitor who
   *  never opens the mode. */
  function load() {
    if (polys || failed) return Promise.resolve(polys);
    if (loading) return loading;
    loading = fetch(`${base}data/pinnable-area.geojson`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((fc) => {
        const geom = fc.features?.[0]?.geometry;
        if (!geom) throw new Error('no geometry');
        polys = indexPolygons(geom);
        addLayers(geom);
        return polys;
      })
      .catch((err) => {
        failed = true;
        console.warn('[briefing] pinnable area unavailable:', err.message);
        return null;
      })
      .finally(() => { loading = null; });
    return loading;
  }

  function addLayers(geom) {
    if (map.getSource(AREA_SRC)) return;
    map.addSource(AREA_SRC, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [
        { type: 'Feature', properties: { kind: 'mask' }, geometry: buildMask(polys) },
        { type: 'Feature', properties: { kind: 'edge' }, geometry: geom },
      ] },
    });
    map.addSource(PIN_SRC, { type: 'geojson', data: EMPTY });

    // Dim what is OUT of bounds. Ink at low alpha rather than a wash of colour,
    // so it reads as "switched off" instead of as another data layer.
    map.addLayer({
      id: DIM, type: 'fill', source: AREA_SRC,
      filter: ['==', ['get', 'kind'], 'mask'],
      layout: { visibility: 'none' },
      paint: { 'fill-color': css('ink'), 'fill-opacity': 0.22, 'fill-antialias': false,
               'fill-opacity-transition': { duration: 220 } },
    }, beforeId);

    map.addLayer({
      id: EDGE, type: 'line', source: AREA_SRC,
      filter: ['==', ['get', 'kind'], 'edge'],
      layout: { visibility: 'none', 'line-join': 'round' },
      paint: { 'line-color': css('accent'), 'line-width': 1.1, 'line-opacity': 0.55,
               'line-opacity-transition': { duration: 220 } },
    }, beforeId);

    // The 3 km circle the briefing actually covers — dashed, because it is a
    // stated reporting radius rather than anything measured on the ground.
    map.addLayer({
      id: RADIUS, type: 'line', source: PIN_SRC,
      filter: ['==', ['get', 'kind'], 'radius'],
      layout: { visibility: 'none' },
      paint: { 'line-color': css('accent'), 'line-width': 1.4, 'line-dasharray': [3, 2], 'line-opacity': 0.8 },
    });

    // The marker itself, in the ringed silhouette this map uses for its markers.
    map.addLayer({
      id: PIN_HALO, type: 'circle', source: PIN_SRC,
      filter: ['==', ['get', 'kind'], 'pin'],
      layout: { visibility: 'none' },
      paint: { 'circle-radius': 11, 'circle-color': css('surface'), 'circle-opacity': 0.95,
               'circle-stroke-color': css('ink'), 'circle-stroke-width': 1, 'circle-stroke-opacity': 0.5 },
    });
    map.addLayer({
      id: PIN_DOT, type: 'circle', source: PIN_SRC,
      filter: ['==', ['get', 'kind'], 'pin'],
      layout: { visibility: 'none' },
      paint: { 'circle-radius': 6, 'circle-color': css('accent'),
               'circle-stroke-color': css('surface'), 'circle-stroke-width': 2 },
    });
  }

  const modeLayers = () => [DIM, EDGE].filter((id) => map.getLayer(id));
  const pinLayers = () => [RADIUS, PIN_HALO, PIN_DOT].filter((id) => map.getLayer(id));
  const setVis = (ids, on) => ids.forEach((id) => map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));

  function contains([px, py]) {
    if (!polys) return false;
    for (const { rings, bbox } of polys) {
      if (px < bbox[0] || px > bbox[2] || py < bbox[1] || py > bbox[3]) continue;
      if (!inRing([px, py], rings[0])) continue;
      let hole = false;
      for (let i = 1; i < rings.length; i++) {
        if (inRing([px, py], rings[i])) { hole = true; break; }
      }
      if (!hole) return true;
    }
    return false;
  }

  function drawPin() {
    if (!map.getSource(PIN_SRC)) return;
    if (!pin) {
      map.getSource(PIN_SRC).setData(EMPTY);
      setVis(pinLayers(), false);
      return;
    }
    map.getSource(PIN_SRC).setData({ type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { kind: 'radius' }, geometry: circle(pin, BRIEFING_RADIUS_KM) },
      { type: 'Feature', properties: { kind: 'pin' }, geometry: { type: 'Point', coordinates: pin } },
    ] });
    setVis(pinLayers(), true);
  }

  /*
   * CURSOR. A pin glyph over pinnable water, `not-allowed` outside it. The
   * cursor is the whole of the out-of-bounds feedback: clicking outside does
   * nothing at all — no pin, no message, no briefing — so the pointer has to say
   * so before the click rather than after it.
   */
  const PIN_CURSOR =
    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'>" +
    "<path d='M14 3c-4 0-7 3-7 7 0 5 7 14 7 14s7-9 7-14c0-4-3-7-7-7z' fill='%23CC6B49' stroke='%23FBF8F1' stroke-width='1.6'/>" +
    "<circle cx='14' cy='10' r='2.6' fill='%23FBF8F1'/></svg>\") 14 26, crosshair";

  const onMove = (e) => {
    if (!armed) return;
    map.getCanvas().style.cursor = contains([e.lngLat.lng, e.lngLat.lat]) ? PIN_CURSOR : 'not-allowed';
  };

  const onClick = (e) => {
    if (!armed) return;
    const at = [e.lngLat.lng, e.lngLat.lat];
    // Outside: do nothing at all. Deliberately silent.
    if (!contains(at)) return;
    pin = [Math.round(at[0] * 1e4) / 1e4, Math.round(at[1] * 1e4) / 1e4];
    drawPin();
    onChange?.();
  };

  map.on('mousemove', onMove);
  map.on('click', onClick);

  async function arm() {
    if (armed) return;
    armed = true;
    await load();
    if (failed) { armed = false; onChange?.(); return; }
    setVis(modeLayers(), true);
    drawPin();
    onChange?.();
  }

  function disarm() {
    if (!armed && !pin) return;
    armed = false;
    pin = null;
    if (map.getSource(PIN_SRC)) drawPin();
    setVis(modeLayers(), false);
    map.getCanvas().style.cursor = '';
    onChange?.();
  }

  return {
    arm,
    disarm,
    toggle: () => (armed ? disarm() : arm()),
    isArmed: () => armed,
    isAvailable: () => !failed,
    getPin: () => (pin ? [...pin] : null),
    clearPin: () => { pin = null; drawPin(); onChange?.(); },
    radiusKm: BRIEFING_RADIUS_KM,
    /** Used by setupHover: while armed, layer hover cards must not fight the
     *  pin interaction. */
    isSuppressingHover: () => armed,
    /** Restore from a URL. Arms the mode and drops the pin in one step; a pin
     *  outside the boundary is ignored rather than placed. */
    async restore(lonlat) {
      await arm();
      if (!polys || !contains(lonlat)) return false;
      pin = [Math.round(lonlat[0] * 1e4) / 1e4, Math.round(lonlat[1] * 1e4) / 1e4];
      drawPin();
      onChange?.();
      return true;
    },
  };
}
