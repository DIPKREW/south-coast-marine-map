/**
 * Renders the config-driven data layers onto the map. Polygon layers get a soft
 * fill + crisp outline; point layers get a refined dot marker (+ optional label).
 * Both get hover emphasis, a per-layer info card, and a smooth fade on toggle.
 * Returns a controller per layer so the UI can drive visibility without touching
 * MapLibre.
 *
 * Draw order follows config order, top-first: each layer is inserted BENEATH the
 * previously added one, so the specific DWT layers and markers sit above the
 * broad washes. Hover is resolved once, map-wide, picking the topmost feature —
 * so overlapping layers never stack cards; the most specific one wins.
 */
import { PMTiles } from 'pmtiles';
import { InfoCard } from '../ui/infoCard.js';
import { palette } from '../design/tokens.js';
import { pmtilesProtocol } from './createMap.js';

const FADE_MS = 350;

// A feature-state reference, omitting sourceLayer for GeoJSON sources.
const featureRef = (r) => (r.sourceLayer ? { source: r.source, sourceLayer: r.sourceLayer, id: r.id } : { source: r.source, id: r.id });

// An empty, never-drawn source that exists only so deferred layers can hang a
// draw-order ANCHOR off it. See deferLayer.
const ANCHOR_SOURCE = 'layer-anchor-source';

export function applyDataLayers(map, layers) {
  const card = new InfoCard(map.getContainer());
  map.addSource(ANCHOR_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

  // Shared hover state so toggling a layer off can clear its emphasis.
  const hover = { current: null };
  const clearHover = (sourceId) => {
    if (!hover.current) return;
    if (sourceId && hover.current.source !== sourceId) return;
    if (hover.current.id != null) map.setFeatureState(featureRef(hover.current), { hover: false });
    hover.current = null;
  };

  const controllers = new Map();
  const registry = []; // { layer, queryId, sourceId, sourceLayer, priority } per hit-test layer
  let beforeId; // insertion anchor — keeps earlier layers on top

  const adders = { point: addPointLayer, mixed: addMixedLayer, waterways: addWaterwaysLayer, choropleth: addChoroplethLayer, croptiles: addCropTilesLayer, speciesgrid: addSpeciesGridLayer, marine: addMarineLayer, erosion: addErosionLayer, spills: addSpillLayer, liveoverflow: addLiveOverflowLayer, wfd: addWfdLayer, seabed: addSeabedLayer };
  for (const layer of layers) {
    const add = adders[layer.kind] || addPolygonLayer;
    // A layer that starts hidden is DEFERRED: neither its source nor its layers
    // exist until the toggle is first switched on, so its data is never fetched
    // for someone who never asks to see it. (croptiles does its own deferred
    // fetch already — it needs the archive in hand before it can add a source.)
    const defer = layer.defaultVisible === false && layer.kind !== 'croptiles';
    const entry = defer
      ? deferLayer(map, layer, beforeId, { card, clearHover }, add)
      : add(map, layer, beforeId, { card, clearHover });
    controllers.set(layer.id, entry.controller);
    // A layer may expose several hit-test layers (polygons, markers, water lines…),
    // each with a hover priority so the most specific feature wins regardless of
    // draw order (e.g. a thin river line beats the broad wash drawn above it).
    for (const q of entry.queryLayers) {
      registry.push({ layer, queryId: q.id, sourceId: q.source || entry.sourceId, sourceLayer: q.sourceLayer, priority: q.priority ?? 0 });
    }
    // A layer whose map objects arrive asynchronously (e.g. the PMTiles fetch)
    // registers its hit-test layers once they actually exist; the promise never
    // rejects (failure resolves to an empty list).
    if (entry.queryLayersAsync) {
      entry.queryLayersAsync.then((qs) => {
        for (const q of qs) {
          registry.push({ layer, queryId: q.id, sourceId: q.source || entry.sourceId, sourceLayer: q.sourceLayer, priority: q.priority ?? 0 });
        }
      });
    }
    beforeId = entry.bottomId; // next layer is inserted beneath this one
  }

  setupHover(map, card, registry, controllers, hover, clearHover);
  return controllers;
}

const hoverExpr = (a, b) => ['case', ['boolean', ['feature-state', 'hover'], false], a, b];

/**
 * LAZY LOADING — wrap a layer so nothing is fetched until it is first shown.
 *
 * A layer that starts hidden still costs a full download under the eager
 * pattern, because `map.addSource` fetches immediately whether or not anything
 * is drawn. Here the real adder is not called at all until `show()`, so a
 * default-off layer is free for anyone who never switches it on. Once built it
 * STAYS built: hiding only fades it out, so a second toggle-on is instant and
 * the data is fetched at most once per page load.
 *
 * Two problems this has to solve:
 *
 *  • DRAW ORDER. Config order is priority order, and layers are stacked by
 *    inserting each one beneath the last. A layer that arrives late has lost its
 *    place in that sequence. So an ANCHOR — an empty line layer over an empty
 *    source, which can never render — is added in the layer's slot up front, and
 *    the real layers are later inserted directly beneath it. Order then follows
 *    config regardless of which toggle the person happens to press first.
 *
 *  • HIT TESTING. queryRenderedFeatures throws on a layer id that isn't in the
 *    style, so the hover registry must not learn this layer's ids until they
 *    exist. `queryLayersAsync` (already handled by applyDataLayers for the
 *    PMTiles layer) resolves at build time, and `isVisible()` reports INTENT, so
 *    the registry is both complete and safe at every moment.
 */
function deferLayer(map, layer, beforeId, ctx, add) {
  const anchorId = `${layer.id}-anchor`;
  map.addLayer({ id: anchorId, type: 'line', source: ANCHOR_SOURCE, layout: { visibility: 'none' } }, beforeId);

  let real = null; // the entry from the real adder, once built
  let want = false; // what the toggle is asking for, whether or not it's built
  let failed = false;
  let building = false;
  const readyCbs = [];
  const failCbs = [];
  let resolveQuery;
  const queryLayersAsync = new Promise((res) => { resolveQuery = res; });

  // Species layers pick one species at a time; remember the choice made before
  // the layer exists so the build starts on the right one.
  let species = layer.defaultSpecies ?? layer.species?.[0]?.key;

  const build = async () => {
    if (real || failed || building) return;
    building = true;
    try {
      // `prepare` lets a layer assemble its data at runtime (the live storm
      // overflow feed queries several APIs) before anything is added to the map.
      const extra = layer.prepare ? await layer.prepare() : null;
      // defaultVisible true: we are building precisely because it was asked for.
      real = add(map, { ...layer, ...extra, defaultVisible: true, defaultSpecies: species }, anchorId, ctx);
      resolveQuery(real.queryLayers ?? []);
      // Switched off again while the data was in flight — respect that.
      if (!want) real.controller.hide();
      readyCbs.forEach((cb) => cb());
    } catch (err) {
      console.warn(`[${layer.id}] "${layer.label}" unavailable:`, err);
      failed = true;
      want = false;
      resolveQuery([]); // no hit-test layers; the map carries on without it
      failCbs.forEach((cb) => cb());
    } finally {
      building = false;
    }
  };

  const controller = {
    // INTENT, not "is it in the style yet" — so the panel's legend and About
    // sections respond on the click, not when the download lands.
    isVisible: () => want,
    show: () => {
      if (want || failed) return;
      want = true;
      real ? real.controller.show() : build();
    },
    hide: () => {
      if (!want) return;
      want = false;
      real?.controller.hide();
    },
    onReady: (cb) => (real ? cb() : readyCbs.push(cb)),
    onUnavailable: (cb) => (failed ? cb() : failCbs.push(cb)),
  };
  controller.toggle = () => (want ? controller.hide() : controller.show());

  if (layer.species) {
    controller.getSpecies = () => species;
    controller.setSpecies = (key) => {
      species = key;
      real?.controller.setSpecies(key);
    };
  }

  // bottomId is the anchor: the next (lower) layer stacks beneath this layer's
  // reserved slot, so config order holds whether or not this one ever builds.
  return { controller, queryLayers: [], queryLayersAsync, sourceId: `${layer.id}-source`, bottomId: anchorId };
}

function addPolygonLayer(map, layer, beforeId, { card, clearHover }) {
  const sourceId = `${layer.id}-source`;
  const fillId = `${layer.id}-fill`;
  const lineId = `${layer.id}-line`;
  const p = layer.paint;
  const startVisible = layer.defaultVisible !== false;

  map.addSource(sourceId, { type: 'geojson', data: layer.data, generateId: true });

  map.addLayer(
    {
      id: fillId,
      type: 'fill',
      source: sourceId,
      layout: { visibility: startVisible ? 'visible' : 'none' },
      paint: {
        'fill-color': p.fillColor,
        'fill-opacity': startVisible ? hoverExpr(p.fillOpacityHover, p.fillOpacity) : 0,
        'fill-opacity-transition': { duration: FADE_MS },
      },
    },
    beforeId,
  );

  map.addLayer(
    {
      id: lineId,
      type: 'line',
      source: sourceId,
      layout: {
        visibility: startVisible ? 'visible' : 'none',
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': p.lineColor,
        'line-width': hoverExpr(p.lineWidthHover, p.lineWidth),
        'line-opacity': startVisible ? 1 : 0,
        'line-opacity-transition': { duration: FADE_MS },
        'line-width-transition': { duration: 150 },
      },
    },
    beforeId,
  );

  const fillOpacityExpr = hoverExpr(p.fillOpacityHover, p.fillOpacity);
  const controller = makeController(map, {
    layerIds: [fillId, lineId],
    sourceId,
    startVisible,
    card,
    clearHover,
    onShow: () => {
      map.setPaintProperty(fillId, 'fill-opacity', fillOpacityExpr);
      map.setPaintProperty(lineId, 'line-opacity', 1);
    },
    onHide: () => {
      map.setPaintProperty(fillId, 'fill-opacity', 0);
      map.setPaintProperty(lineId, 'line-opacity', 0);
    },
  });

  return { controller, queryLayers: [{ id: fillId, priority: 30 }], sourceId, bottomId: fillId };
}

// A graded base wash (ALC). A colour-by-field fill, no outline (continuous wash),
// lowest hover priority so any specific site sits on top. Optionally a SECOND
// source (`detailData`) drawn over the first — the Post-1988 resurvey over the
// coarse provisional wash, sharing one toggle.
function addChoroplethLayer(map, layer, beforeId, { card, clearHover }) {
  const sourceId = `${layer.id}-source`;
  const fillId = `${layer.id}-fill`;
  const detailSourceId = `${layer.id}-detail-source`;
  const detailFillId = `${layer.id}-detail-fill`;
  const c = layer.paint.colors;
  const startVisible = layer.defaultVisible !== false;
  const fillOpacityExpr = hoverExpr(layer.paint.fillOpacityHover, layer.paint.fillOpacity);

  // Provisional: numeric field (1–5, 0 = non-ag default).
  map.addSource(sourceId, { type: 'geojson', data: layer.data, generateId: true });
  const provColor = ['match', ['get', layer.field], 1, c[1], 2, c[2], 3, c[3], 4, c[4], 5, c[5], c[0]];
  map.addLayer(
    {
      id: fillId, type: 'fill', source: sourceId,
      layout: { visibility: startVisible ? 'visible' : 'none' },
      paint: {
        'fill-color': provColor,
        'fill-opacity': startVisible ? fillOpacityExpr : 0,
        'fill-opacity-transition': { duration: FADE_MS }, 'fill-antialias': true,
      },
    },
    beforeId,
  );

  const layerIds = [fillId];
  const queryLayers = [{ id: fillId, priority: 10 }];

  // Post-1988 detailed survey (string grades incl. 3a/3b), drawn ON TOP.
  if (layer.detailData) {
    map.addSource(detailSourceId, { type: 'geojson', data: layer.detailData, generateId: true });
    const detailColor = ['match', ['get', layer.detailField], '1', c[1], '2', c[2], '3a', c['3a'], '3b', c['3b'], '4', c[4], '5', c[5], c[0]];
    map.addLayer(
      {
        id: detailFillId, type: 'fill', source: detailSourceId,
        layout: { visibility: startVisible ? 'visible' : 'none' },
        paint: {
          'fill-color': detailColor,
          'fill-opacity': startVisible ? fillOpacityExpr : 0,
          'fill-opacity-transition': { duration: FADE_MS }, 'fill-antialias': true,
        },
      },
      beforeId,
    );
    layerIds.push(detailFillId);
    queryLayers.unshift({ id: detailFillId, priority: 12, source: detailSourceId }); // detail wins where present
  }

  const controller = makeController(map, {
    layerIds, sourceId, startVisible, card, clearHover,
    onShow: () => layerIds.forEach((id) => map.setPaintProperty(id, 'fill-opacity', fillOpacityExpr)),
    onHide: () => layerIds.forEach((id) => map.setPaintProperty(id, 'fill-opacity', 0)),
  });

  return { controller, queryLayers, sourceId, bottomId: fillId };
}

// A pmtiles Source serving byte-range reads from an ArrayBuffer held in memory
// (the same shape as the library's FileSource, over a fetched buffer instead of
// a File). Used because the host may ignore HTTP Range requests (200 + full
// body), which breaks the library's FetchSource; the archive is small enough
// (~6 MB) to fetch whole with one plain GET instead.
class ArrayBufferSource {
  constructor(key, buffer) {
    this.key = key;
    this.buffer = buffer;
  }
  getKey() {
    return this.key;
  }
  async getBytes(offset, length) {
    return { data: this.buffer.slice(offset, offset + length) };
  }
}

// Field-level land USE (CROME), as vector tiles (PMTiles). One fill, colour by a
// string `field` (category), gated to close zoom; no outline, no ocean/background
// fill. Lowest-but-above-ALC hover priority.
//
// The archive is fetched up front (whole-file, no Range header) and only then is
// the source/layer added — so a failed fetch leaves the rest of the map intact:
// the returned controller stays inert, the panel toggle is flagged unavailable,
// and no MapLibre source ever points at the broken archive. Insertion order is
// preserved by re-using the original `beforeId` anchor when the layer arrives
// late: it lands directly beneath that anchor, above later-added (lower) layers.
function addCropTilesLayer(map, layer, beforeId, { card, clearHover }) {
  const sourceId = `${layer.id}-source`;
  const fillId = `${layer.id}-fill`;
  const SRC = layer.sourceLayer;
  const c = layer.paint.colors;
  const startVisible = layer.defaultVisible !== false;
  const fillOpacityExpr = hoverExpr(layer.paint.fillOpacityHover, layer.paint.fillOpacity);

  const href = new URL(layer.data, window.location.href).href;

  const colorExpr = [
    'match', ['get', layer.field],
    'cereals', c.cereals, 'oilseed', c.oilseed, 'rootmaize', c.rootmaize,
    'grass', c.grass, 'trees', c.trees,
    c.other,
  ];

  let real = null; // the live controller once the layer exists
  let want = startVisible; // visibility requested while the fetch is in flight
  const readyCbs = [];
  const failCbs = [];
  let failed = false;

  const queryLayersAsync = fetch(href)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.arrayBuffer();
    })
    .then((buffer) => {
      // Serve the protocol from memory: pmtiles://<href> resolves to this
      // instance (matched by getKey), so no FetchSource is ever created.
      pmtilesProtocol.add(new PMTiles(new ArrayBufferSource(href, buffer)));
      map.addSource(sourceId, { type: 'vector', url: `pmtiles://${href}`, maxzoom: 14 });
      map.addLayer(
        {
          id: fillId, type: 'fill', source: sourceId, 'source-layer': SRC,
          minzoom: layer.minzoom ?? 11,
          layout: { visibility: startVisible ? 'visible' : 'none' },
          paint: {
            'fill-color': colorExpr,
            'fill-opacity': startVisible ? fillOpacityExpr : 0,
            'fill-opacity-transition': { duration: FADE_MS }, 'fill-antialias': true,
          },
        },
        beforeId,
      );
      real = makeController(map, {
        layerIds: [fillId], sourceId, startVisible, card, clearHover,
        onShow: () => map.setPaintProperty(fillId, 'fill-opacity', fillOpacityExpr),
        onHide: () => map.setPaintProperty(fillId, 'fill-opacity', 0),
      });
      if (want !== startVisible) (want ? real.show() : real.hide());
      readyCbs.forEach((cb) => cb());
      return [{ id: fillId, priority: 15, sourceLayer: SRC }];
    })
    .catch((err) => {
      console.warn(`[${layer.id}] "${layer.label}" unavailable — could not load ${href}:`, err);
      failed = true;
      failCbs.forEach((cb) => cb());
      return []; // no hit-test layers; the map carries on without this layer
    });

  const controller = {
    isVisible: () => (real ? real.isVisible() : false),
    show: () => { want = true; real?.show(); },
    hide: () => { want = false; real?.hide(); },
    toggle: () => { want = !want; real?.toggle(); },
    onReady: (cb) => { real ? cb() : readyCbs.push(cb); },
    onUnavailable: (cb) => { failed ? cb() : failCbs.push(cb); },
  };

  // bottomId passes the anchor through: the next (lower) layer anchors where
  // this one will, so draw order is correct whether or not the fetch has landed.
  return { controller, queryLayers: [], queryLayersAsync, sourceId, bottomId: beforeId };
}

// A coarse SPECIES GRID overlay. One GeoJSON of grid-square cells for several
// species; a filter picks one species at a time (the panel's selector calls
// `setSpecies`). Fill opacity rises slightly with record count. A faint outline
// delineates cells. Drawn above the land washes, below the site overlays.
function addSpeciesGridLayer(map, layer, beforeId, { card, clearHover }) {
  const sourceId = `${layer.id}-source`;
  const fillId = `${layer.id}-fill`;
  const lineId = `${layer.id}-line`;
  const startVisible = layer.defaultVisible !== false;
  let species = layer.defaultSpecies || layer.species?.[0]?.key;
  const filterFor = (key) => ['==', ['get', layer.field], key];

  map.addSource(sourceId, { type: 'geojson', data: layer.data, generateId: true });

  const hb = ['boolean', ['feature-state', 'hover'], false];
  // Base opacity rises with the (log of) record count; hover lifts it.
  const byCount = ['interpolate', ['linear'], ['log10', ['max', ['get', 'n'], 1]], 0, 0.3, 1, 0.4, 2, 0.5, 3.5, 0.6];
  const fillOpacity = ['case', hb, layer.paint.fillOpacityHover, byCount];
  // Colour is per-layer so the LAND and MARINE species grids can share this
  // renderer without sharing a palette; both default to the land heather.
  const fillColor = layer.paint.color ?? palette.species;
  const lineColor = layer.paint.colorStrong ?? palette['species-strong'];

  map.addLayer(
    {
      id: fillId, type: 'fill', source: sourceId, filter: filterFor(species),
      layout: { visibility: startVisible ? 'visible' : 'none' },
      paint: {
        'fill-color': fillColor,
        'fill-opacity': startVisible ? fillOpacity : 0,
        'fill-opacity-transition': { duration: FADE_MS }, 'fill-antialias': true,
      },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: lineId, type: 'line', source: sourceId, filter: filterFor(species),
      layout: { visibility: startVisible ? 'visible' : 'none' },
      paint: {
        'line-color': lineColor, 'line-width': 0.6,
        'line-opacity': startVisible ? 0.4 : 0, 'line-opacity-transition': { duration: FADE_MS },
      },
    },
    beforeId,
  );

  const base = makeController(map, {
    layerIds: [fillId, lineId], sourceId, startVisible, card, clearHover,
    onShow: () => { map.setPaintProperty(fillId, 'fill-opacity', fillOpacity); map.setPaintProperty(lineId, 'line-opacity', 0.4); },
    onHide: () => { map.setPaintProperty(fillId, 'fill-opacity', 0); map.setPaintProperty(lineId, 'line-opacity', 0); },
  });
  // Extend the controller with species selection.
  const controller = {
    ...base,
    getSpecies: () => species,
    setSpecies: (key) => {
      species = key;
      clearHover(sourceId);
      map.setFilter(fillId, filterFor(key));
      map.setFilter(lineId, filterFor(key));
    },
  };

  // Above the land washes, below the site overlays — but a specific site still wins.
  return { controller, queryLayers: [{ id: fillId, priority: 16 }], sourceId, bottomId: fillId };
}

// MARINE PROTECTED AREAS. Designations overlap heavily, so they're drawn as
// OUTLINED areas: a very faint shared teal fill (which doubles as the hover hit
// area) plus one line layer per designation TYPE, differentiated by line style —
// MCZ solid, SAC dashed, SPA dotted. All share one source, so hovering a site
// lifts both its fill and its outline.
function addMarineLayer(map, layer, beforeId, { card, clearHover }) {
  const sourceId = `${layer.id}-source`;
  const fillId = `${layer.id}-fill`;
  const p = layer.paint;
  const startVisible = layer.defaultVisible !== false;

  map.addSource(sourceId, { type: 'geojson', data: layer.data, generateId: true });

  const fillOpacityExpr = hoverExpr(p.fillOpacityHover, p.fillOpacity);
  map.addLayer(
    {
      id: fillId, type: 'fill', source: sourceId,
      layout: { visibility: startVisible ? 'visible' : 'none' },
      paint: {
        'fill-color': palette['marine-soft'],
        'fill-opacity': startVisible ? fillOpacityExpr : 0,
        'fill-opacity-transition': { duration: FADE_MS }, 'fill-antialias': true,
      },
    },
    beforeId,
  );

  // One styled outline per type (solid / dashed / dotted), all the same teal.
  const lineColor = ['case', ['boolean', ['feature-state', 'hover'], false], palette['marine-strong'], palette.marine];
  const lineWidth = hoverExpr(p.lineWidthHover, p.lineWidth);
  const styles = [
    { key: 'MCZ', cap: 'round', dash: null }, // solid
    { key: 'SAC', cap: 'butt', dash: [3, 2] }, // dashed
    { key: 'SPA', cap: 'round', dash: [0.4, 2.2] }, // dotted (round cap → dots)
  ];
  const lineIds = [];
  for (const st of styles) {
    const id = `${layer.id}-line-${st.key}`;
    lineIds.push(id);
    map.addLayer(
      {
        id, type: 'line', source: sourceId, filter: ['==', ['get', 'mtype'], st.key],
        layout: { visibility: startVisible ? 'visible' : 'none', 'line-join': 'round', 'line-cap': st.cap },
        paint: {
          'line-color': lineColor,
          'line-width': lineWidth,
          ...(st.dash ? { 'line-dasharray': st.dash } : {}),
          'line-opacity': startVisible ? 0.95 : 0,
          'line-opacity-transition': { duration: FADE_MS }, 'line-width-transition': { duration: 150 },
        },
      },
      beforeId,
    );
  }

  const layerIds = [fillId, ...lineIds];
  const controller = makeController(map, {
    layerIds, sourceId, startVisible, card, clearHover,
    onShow: () => {
      map.setPaintProperty(fillId, 'fill-opacity', fillOpacityExpr);
      lineIds.forEach((id) => map.setPaintProperty(id, 'line-opacity', 0.95));
    },
    onHide: () => {
      map.setPaintProperty(fillId, 'fill-opacity', 0);
      lineIds.forEach((id) => map.setPaintProperty(id, 'line-opacity', 0));
    },
  });

  // Marine sites win the hover over the broad terrestrial washes where they meet
  // at the coast (offshore they're alone); markers and water lines still win.
  return { controller, queryLayers: [{ id: fillId, priority: 33 }], sourceId, bottomId: fillId };
}

// COASTAL EROSION RISK (NCERM). Thin coastal frontage strips coloured by a
// banded recession-distance risk (low→high). A continuous context wash, lowest
// hover priority so any specific site sits on top.
function addErosionLayer(map, layer, beforeId, { card, clearHover }) {
  const sourceId = `${layer.id}-source`;
  const fillId = `${layer.id}-fill`;
  const c = layer.paint.colors;
  const startVisible = layer.defaultVisible !== false;
  const fillOpacityExpr = hoverExpr(layer.paint.fillOpacityHover, layer.paint.fillOpacity);

  map.addSource(sourceId, { type: 'geojson', data: layer.data, generateId: true });
  const colorExpr = ['match', ['get', layer.field], 0, c[0], 1, c[1], 2, c[2], 3, c[3], 4, c[4], c[0]];
  map.addLayer(
    {
      id: fillId, type: 'fill', source: sourceId,
      layout: { visibility: startVisible ? 'visible' : 'none' },
      paint: {
        'fill-color': colorExpr,
        'fill-opacity': startVisible ? fillOpacityExpr : 0,
        'fill-opacity-transition': { duration: FADE_MS }, 'fill-antialias': true,
      },
    },
    beforeId,
  );

  const controller = makeController(map, {
    layerIds: [fillId], sourceId, startVisible, card, clearHover,
    onShow: () => map.setPaintProperty(fillId, 'fill-opacity', fillOpacityExpr),
    onHide: () => map.setPaintProperty(fillId, 'fill-opacity', 0),
  });

  return { controller, queryLayers: [{ id: fillId, priority: 14 }], sourceId, bottomId: fillId };
}

// STORM OVERFLOW ANNUAL SPILL DATA (EA Event Duration Monitoring return). One
// dot per overflow, coloured AND sized by how many times it spilled that year —
// colour carries the reading, size gives the busiest outfalls presence at low
// zoom without turning the coast into a solid band. Banded, not continuous: the
// counts are long-tailed (median 15, max 243), so a linear ramp would flatten
// almost everything into the pale end.
function addSpillLayer(map, layer, beforeId, { card, clearHover }) {
  const sourceId = `${layer.id}-source`;
  const dotId = `${layer.id}-dot`;
  const c = layer.paint.colors;
  const breaks = layer.paint.breaks; // e.g. [1, 10, 40, 100]
  const startVisible = layer.defaultVisible !== false;
  const hb = ['boolean', ['feature-state', 'hover'], false];

  map.addSource(sourceId, { type: 'geojson', data: layer.data, generateId: true });

  const step = (outputs) => ['step', ['get', layer.field], outputs[0], ...breaks.flatMap((b, i) => [b, outputs[i + 1]])];
  const colorExpr = step([c[0], c[1], c[2], c[3], c[4]]);
  // Radius: a zoom interpolate (which must stay top-level) whose every stop is
  // scaled by the band and lifted on hover.
  const scale = step([0.72, 0.86, 1, 1.18, 1.4]);
  const r = (base) => ['*', base, scale, ['case', hb, 1.5, 1]];

  map.addLayer(
    {
      id: dotId, type: 'circle', source: sourceId,
      layout: { visibility: startVisible ? 'visible' : 'none', 'circle-sort-key': ['get', layer.field] },
      paint: {
        'circle-color': colorExpr,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, r(2.1), 10, r(3.3), 13, r(5), 16, r(6.8)],
        'circle-stroke-color': palette.surface,
        'circle-stroke-width': hoverExpr(1.4, 0.7),
        'circle-opacity': startVisible ? 0.92 : 0,
        'circle-stroke-opacity': startVisible ? 0.9 : 0,
        'circle-radius-transition': { duration: 150 },
        'circle-opacity-transition': { duration: FADE_MS },
        'circle-stroke-opacity-transition': { duration: FADE_MS },
      },
    },
    beforeId,
  );

  const controller = makeController(map, {
    layerIds: [dotId], sourceId, startVisible, card, clearHover,
    onShow: () => {
      map.setPaintProperty(dotId, 'circle-opacity', 0.92);
      map.setPaintProperty(dotId, 'circle-stroke-opacity', 0.9);
    },
    onHide: () => {
      map.setPaintProperty(dotId, 'circle-opacity', 0);
      map.setPaintProperty(dotId, 'circle-stroke-opacity', 0);
    },
  });

  // Point markers beat every area layer at the same spot.
  return { controller, queryLayers: [{ id: dotId, priority: 56 }], sourceId, bottomId: dotId };
}

// LIVE DISCHARGE STATUS (National Storm Overflow Hub). A two-state signal —
// a filled alert dot for an overflow that is discharging right now, a quiet
// hollow ring for one that isn't — plus a third, deliberately faint state for a
// monitor that is offline, which is neither "clean" nor "spilling" and should
// not be drawn as either. `circle-sort-key` on status puts the discharging dots
// on top of the (far more numerous) quiet ones.
function addLiveOverflowLayer(map, layer, beforeId, { card, clearHover }) {
  const sourceId = `${layer.id}-source`;
  const dotId = `${layer.id}-dot`;
  const startVisible = layer.defaultVisible !== false;
  const hb = ['boolean', ['feature-state', 'hover'], false];
  const byStatus = (on, off, offline) => ['match', ['get', 'status'], 1, on, 0, off, offline];

  map.addSource(sourceId, { type: 'geojson', data: layer.data, generateId: true });

  map.addLayer(
    {
      id: dotId, type: 'circle', source: sourceId,
      layout: { visibility: startVisible ? 'visible' : 'none', 'circle-sort-key': ['get', 'status'] },
      paint: {
        // Discharging is a solid disc; the other two are hollow (paper-filled).
        'circle-color': byStatus(palette['discharge-on'], palette.surface, palette.surface),
        'circle-stroke-color': byStatus(palette['discharge-on'], palette['discharge-off'], palette['discharge-offline']),
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          7, ['*', byStatus(3.4, 2.2, 1.9), ['case', hb, 1.5, 1]],
          11, ['*', byStatus(5, 3.2, 2.7), ['case', hb, 1.5, 1]],
          15, ['*', byStatus(7.5, 4.8, 4), ['case', hb, 1.5, 1]],
        ],
        'circle-stroke-width': hoverExpr(2.2, 1.4),
        'circle-opacity': startVisible ? byStatus(0.95, 0.85, 0.5) : 0,
        'circle-stroke-opacity': startVisible ? byStatus(1, 0.85, 0.5) : 0,
        'circle-radius-transition': { duration: 150 },
        'circle-opacity-transition': { duration: FADE_MS },
        'circle-stroke-opacity-transition': { duration: FADE_MS },
      },
    },
    beforeId,
  );

  const opacityExpr = byStatus(0.95, 0.85, 0.5);
  const strokeOpacityExpr = byStatus(1, 0.85, 0.5);
  const controller = makeController(map, {
    layerIds: [dotId], sourceId, startVisible, card, clearHover,
    onShow: () => {
      map.setPaintProperty(dotId, 'circle-opacity', opacityExpr);
      map.setPaintProperty(dotId, 'circle-stroke-opacity', strokeOpacityExpr);
    },
    onHide: () => {
      map.setPaintProperty(dotId, 'circle-opacity', 0);
      map.setPaintProperty(dotId, 'circle-stroke-opacity', 0);
    },
  });

  // Slightly above the annual dots: "what is happening now" is the more
  // specific answer where the two sit on the same outfall.
  return { controller, queryLayers: [{ id: dotId, priority: 58 }], sourceId, bottomId: dotId };
}

// WFD COASTAL & TRANSITIONAL WATER BODY STATUS. Filled polygons over the sea and
// estuaries, coloured by ECOLOGICAL status only — chemical status is reported in
// the card but not mapped, because virtually every water body in England now
// fails it on nationwide persistent substances, so it would paint one flat
// colour and say nothing. A soft outline keeps neighbouring bodies apart.
function addWfdLayer(map, layer, beforeId, { card, clearHover }) {
  const sourceId = `${layer.id}-source`;
  const fillId = `${layer.id}-fill`;
  const lineId = `${layer.id}-line`;
  const c = layer.paint.colors;
  const startVisible = layer.defaultVisible !== false;
  const fillOpacityExpr = hoverExpr(layer.paint.fillOpacityHover, layer.paint.fillOpacity);

  map.addSource(sourceId, { type: 'geojson', data: layer.data, generateId: true });

  const colorExpr = ['match', ['get', layer.field],
    'High', c.High, 'Good', c.Good, 'Moderate', c.Moderate, 'Poor', c.Poor, 'Bad', c.Bad,
    c.unknown,
  ];

  map.addLayer(
    {
      id: fillId, type: 'fill', source: sourceId,
      layout: { visibility: startVisible ? 'visible' : 'none' },
      paint: {
        'fill-color': colorExpr,
        'fill-opacity': startVisible ? fillOpacityExpr : 0,
        'fill-opacity-transition': { duration: FADE_MS }, 'fill-antialias': true,
      },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: lineId, type: 'line', source: sourceId,
      layout: { visibility: startVisible ? 'visible' : 'none', 'line-join': 'round' },
      paint: {
        'line-color': colorExpr,
        'line-width': hoverExpr(2.2, 0.8),
        'line-opacity': startVisible ? 0.75 : 0,
        'line-opacity-transition': { duration: FADE_MS }, 'line-width-transition': { duration: 150 },
      },
    },
    beforeId,
  );

  const controller = makeController(map, {
    layerIds: [fillId, lineId], sourceId, startVisible, card, clearHover,
    onShow: () => {
      map.setPaintProperty(fillId, 'fill-opacity', fillOpacityExpr);
      map.setPaintProperty(lineId, 'line-opacity', 0.75);
    },
    onHide: () => {
      map.setPaintProperty(fillId, 'fill-opacity', 0);
      map.setPaintProperty(lineId, 'line-opacity', 0);
    },
  });

  // A broad context wash — below the erosion strips and the marine outlines, so
  // any more specific feature at the same spot still wins the card.
  return { controller, queryLayers: [{ id: fillId, priority: 12 }], sourceId, bottomId: fillId };
}

// SEABED HABITATS (JNCC UKSeaMap). A continuous wash over the whole sea floor,
// coloured by substrate group. Deliberately NO outline: the source is a modelled
// surface with tens of thousands of boundaries between neighbouring classes, and
// drawing them would imply an edge precision the model does not have — and turn
// the sea into a net. The colour match is built from the paint's own `colors`
// map, so adding a group is a config change rather than a code change.
function addSeabedLayer(map, layer, beforeId, { card, clearHover }) {
  const sourceId = `${layer.id}-source`;
  const fillId = `${layer.id}-fill`;
  const c = layer.paint.colors;
  const startVisible = layer.defaultVisible !== false;
  const fillOpacityExpr = hoverExpr(layer.paint.fillOpacityHover, layer.paint.fillOpacity);

  map.addSource(sourceId, { type: 'geojson', data: layer.data, generateId: true });

  const entries = Object.entries(c).filter(([k]) => k !== 'unknown');
  const colorExpr = ['match', ['get', layer.field], ...entries.flatMap(([k, v]) => [k, v]), c.unknown];

  map.addLayer(
    {
      id: fillId, type: 'fill', source: sourceId,
      layout: { visibility: startVisible ? 'visible' : 'none' },
      paint: {
        'fill-color': colorExpr,
        'fill-opacity': startVisible ? fillOpacityExpr : 0,
        'fill-opacity-transition': { duration: FADE_MS }, 'fill-antialias': true,
      },
    },
    beforeId,
  );

  const controller = makeController(map, {
    layerIds: [fillId], sourceId, startVisible, card, clearHover,
    onShow: () => map.setPaintProperty(fillId, 'fill-opacity', fillOpacityExpr),
    onHide: () => map.setPaintProperty(fillId, 'fill-opacity', 0),
  });

  // The lowest hover priority of any marine layer — this is the ground the
  // others sit on, so anything more specific at the same point wins the card.
  return { controller, queryLayers: [{ id: fillId, priority: 8 }], sourceId, bottomId: fillId };
}

function addPointLayer(map, layer, beforeId, { card, clearHover }) {
  const sourceId = `${layer.id}-source`;
  const dotId = `${layer.id}-dot`;
  const labelId = `${layer.id}-label`;
  const p = layer.paint;
  const startVisible = layer.defaultVisible !== false;

  map.addSource(sourceId, { type: 'geojson', data: layer.data, generateId: true });

  map.addLayer(
    {
      id: dotId,
      type: 'circle',
      source: sourceId,
      layout: { visibility: startVisible ? 'visible' : 'none' },
      paint: {
        'circle-color': p.color,
        'circle-radius': hoverExpr(p.radiusHover, p.radius),
        'circle-stroke-color': p.strokeColor,
        'circle-stroke-width': hoverExpr(2.5, 2),
        'circle-opacity': startVisible ? 1 : 0,
        'circle-stroke-opacity': startVisible ? 1 : 0,
        'circle-radius-transition': { duration: 150 },
        'circle-opacity-transition': { duration: FADE_MS },
        'circle-stroke-opacity-transition': { duration: FADE_MS },
      },
    },
    beforeId,
  );

  map.addLayer(
    {
      id: labelId,
      type: 'symbol',
      source: sourceId,
      minzoom: p.labelMinZoom ?? 11,
      layout: {
        visibility: startVisible ? 'visible' : 'none',
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11.5,
        'text-anchor': 'top',
        'text-offset': [0, 0.8],
        'text-max-width': 9,
        'text-optional': true,
      },
      paint: {
        'text-color': palette.ink,
        'text-halo-color': palette.paper,
        'text-halo-width': 1.5,
        'text-opacity': startVisible ? 1 : 0,
        'text-opacity-transition': { duration: FADE_MS },
      },
    },
    beforeId,
  );

  const controller = makeController(map, {
    layerIds: [dotId, labelId],
    sourceId,
    startVisible,
    card,
    clearHover,
    onShow: () => {
      map.setPaintProperty(dotId, 'circle-opacity', 1);
      map.setPaintProperty(dotId, 'circle-stroke-opacity', 1);
      map.setPaintProperty(labelId, 'text-opacity', 1);
    },
    onHide: () => {
      map.setPaintProperty(dotId, 'circle-opacity', 0);
      map.setPaintProperty(dotId, 'circle-stroke-opacity', 0);
      map.setPaintProperty(labelId, 'text-opacity', 0);
    },
  });

  return { controller, queryLayers: [{ id: dotId, priority: 60 }], sourceId, bottomId: dotId };
}

// A mixed layer: one source, shaded polygons (fill + outline) AND small markers
// (a circle, which only renders the Point features) — under a single toggle.
function addMixedLayer(map, layer, beforeId, { card, clearHover }) {
  const sourceId = `${layer.id}-source`;
  const fillId = `${layer.id}-fill`;
  const lineId = `${layer.id}-line`;
  const dotId = `${layer.id}-dot`;
  const p = layer.paint;
  const mp = layer.markerPaint;
  const startVisible = layer.defaultVisible !== false;

  map.addSource(sourceId, { type: 'geojson', data: layer.data, generateId: true });

  // Polygon fill + outline (fill/line layers ignore the Point features).
  map.addLayer(
    {
      id: fillId,
      type: 'fill',
      source: sourceId,
      layout: { visibility: startVisible ? 'visible' : 'none' },
      paint: {
        'fill-color': p.fillColor,
        'fill-opacity': startVisible ? hoverExpr(p.fillOpacityHover, p.fillOpacity) : 0,
        'fill-opacity-transition': { duration: FADE_MS },
      },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: lineId,
      type: 'line',
      source: sourceId,
      layout: { visibility: startVisible ? 'visible' : 'none', 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': p.lineColor,
        'line-width': hoverExpr(p.lineWidthHover, p.lineWidth),
        'line-opacity': startVisible ? 1 : 0,
        'line-opacity-transition': { duration: FADE_MS },
        'line-width-transition': { duration: 150 },
      },
    },
    beforeId,
  );

  // Markers (a circle layer only renders the Point features in the source).
  map.addLayer(
    {
      id: dotId,
      type: 'circle',
      source: sourceId,
      layout: { visibility: startVisible ? 'visible' : 'none' },
      paint: {
        'circle-color': mp.color,
        'circle-radius': hoverExpr(mp.radiusHover, mp.radius),
        'circle-stroke-color': mp.strokeColor,
        'circle-stroke-width': hoverExpr(1.6, 1.2),
        'circle-opacity': startVisible ? 1 : 0,
        'circle-stroke-opacity': startVisible ? 1 : 0,
        'circle-radius-transition': { duration: 150 },
        'circle-opacity-transition': { duration: FADE_MS },
        'circle-stroke-opacity-transition': { duration: FADE_MS },
      },
    },
    beforeId,
  );

  const fillOpacityExpr = hoverExpr(p.fillOpacityHover, p.fillOpacity);
  const controller = makeController(map, {
    layerIds: [fillId, lineId, dotId],
    sourceId,
    startVisible,
    card,
    clearHover,
    onShow: () => {
      map.setPaintProperty(fillId, 'fill-opacity', fillOpacityExpr);
      map.setPaintProperty(lineId, 'line-opacity', 1);
      map.setPaintProperty(dotId, 'circle-opacity', 1);
      map.setPaintProperty(dotId, 'circle-stroke-opacity', 1);
    },
    onHide: () => {
      map.setPaintProperty(fillId, 'fill-opacity', 0);
      map.setPaintProperty(lineId, 'line-opacity', 0);
      map.setPaintProperty(dotId, 'circle-opacity', 0);
      map.setPaintProperty(dotId, 'circle-stroke-opacity', 0);
    },
  });

  // Markers sit above the polygons in hit-testing, so a marker wins over a
  // polygon at the same spot.
  return {
    controller,
    queryLayers: [{ id: dotId, priority: 55 }, { id: fillId, priority: 30 }],
    sourceId,
    bottomId: fillId,
  };
}

// The "Rivers & waterways" layer. Watercourse LINES (rivers, canals, streams +
// minor ditches/drains gated to close zoom) from one GeoJSON, PLUS exactly two
// named water-body FILLS — The Fleet and Poole Harbour — from a separate, hand-
// verified file (the ONLY fills in the app; no broad water-body category, which
// is what caused the rectangle artefacts). Fill sits at the bottom, beneath the
// lines and the SSSI/HONA/DWT washes; name labels go on top.
function addWaterwaysLayer(map, layer, beforeId, { card, clearHover }) {
  const sourceId = `${layer.id}-source`;
  const bodiesSourceId = `${layer.id}-bodies-source`;
  const ids = {
    bodiesFill: `${layer.id}-bodies-fill`,
    bodiesOutline: `${layer.id}-bodies-line`,
    ditch: `${layer.id}-ditch`,
    drain: `${layer.id}-drain`,
    canal: `${layer.id}-canal`,
    stream: `${layer.id}-stream`,
    river: `${layer.id}-river`,
    label: `${layer.id}-label`,
  };
  const startVisible = layer.defaultVisible !== false;
  const vis = startVisible ? 'visible' : 'none';

  // Plain GeoJSON sources. generateId → stable ids for hover state.
  map.addSource(sourceId, { type: 'geojson', data: layer.data, generateId: true });
  map.addSource(bodiesSourceId, { type: 'geojson', data: layer.bodiesData, generateId: true });

  // Line width: a top-level zoom interpolate whose per-stop output carries the
  // hover emphasis (a zoom expression can't be nested inside arithmetic).
  const hb = ['boolean', ['feature-state', 'hover'], false];
  const lineW = (stops) =>
    ['interpolate', ['exponential', 1.5], ['zoom'], ...stops.flatMap(([z, w]) => [z, ['case', hb, w * 1.9, w]])];
  const lineColor = ['case', hb, palette['water-strong'], palette.water];
  const only = (wtype) => ['==', ['get', 'wtype'], wtype];

  // The two named water bodies — fill + subtle outline, at the very bottom.
  map.addLayer(
    {
      id: ids.bodiesFill, type: 'fill', source: bodiesSourceId,
      layout: { visibility: vis },
      paint: {
        'fill-color': palette['water-soft'],
        'fill-opacity': startVisible ? hoverExpr(0.68, 0.5) : 0,
        'fill-opacity-transition': { duration: FADE_MS },
      },
    },
    beforeId,
  );
  map.addLayer(
    {
      id: ids.bodiesOutline, type: 'line', source: bodiesSourceId,
      layout: { visibility: vis },
      paint: {
        'line-color': palette['water-strong'], 'line-opacity': startVisible ? 0.5 : 0,
        'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 9, 0.4, 13, 0.7, 16, 1.1],
        'line-opacity-transition': { duration: FADE_MS },
      },
    },
    beforeId,
  );

  // Minor channels — ditches & drains — faint and thin, only from ~zoom 13 in.
  for (const wt of ['ditch', 'drain']) {
    map.addLayer(
      {
        id: ids[wt], type: 'line', source: sourceId, filter: only(wt), minzoom: 13,
        layout: { visibility: vis, 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': palette.water,
          'line-width': lineW([[13, 0.3], [16, 0.7], [20, 1.6]]),
          'line-opacity': startVisible ? 0.45 : 0, 'line-opacity-transition': { duration: FADE_MS },
        },
      },
      beforeId,
    );
  }
  // Canals — distinct dashed line.
  map.addLayer(
    {
      id: ids.canal, type: 'line', source: sourceId, filter: only('canal'),
      layout: { visibility: vis, 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': lineColor, 'line-dasharray': [3, 2],
        'line-width': lineW([[9, 0.6], [13, 1.4], [17, 3.4]]),
        'line-opacity': startVisible ? 1 : 0, 'line-opacity-transition': { duration: FADE_MS },
      },
    },
    beforeId,
  );
  // Streams — thinner, only from ~zoom 11 in.
  map.addLayer(
    {
      id: ids.stream, type: 'line', source: sourceId, filter: only('stream'), minzoom: 11,
      layout: { visibility: vis, 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': lineColor,
        'line-width': lineW([[11, 0.4], [13, 0.8], [16, 2], [20, 4]]),
        'line-opacity': startVisible ? 0.85 : 0, 'line-opacity-transition': { duration: FADE_MS },
      },
    },
    beforeId,
  );
  // Rivers — prominent, visible at all zooms.
  map.addLayer(
    {
      id: ids.river, type: 'line', source: sourceId, filter: only('river'),
      layout: { visibility: vis, 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': lineColor,
        'line-width': lineW([[8, 0.6], [11, 1.2], [14, 2.6], [17, 4.8], [20, 9]]),
        'line-opacity': startVisible ? 1 : 0, 'line-opacity-transition': { duration: FADE_MS },
      },
    },
    beforeId,
  );

  // Watercourse name labels — on TOP so they stay legible.
  map.addLayer({
    id: ids.label, type: 'symbol', source: sourceId, minzoom: 11,
    filter: ['all', ['has', 'name'], ['in', ['get', 'wtype'], ['literal', ['river', 'canal', 'stream']]]],
    layout: {
      visibility: vis,
      'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Italic'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 11, 9.5, 15, 12, 18, 13],
      'text-letter-spacing': 0.04, 'symbol-spacing': 360, 'text-max-angle': 40,
    },
    paint: {
      'text-color': palette['water-strong'], 'text-halo-color': palette.paper, 'text-halo-width': 1.6,
      'text-opacity': startVisible ? 1 : 0, 'text-opacity-transition': { duration: FADE_MS },
    },
  });

  const controller = makeController(map, {
    layerIds: Object.values(ids),
    sourceId,
    startVisible,
    card,
    clearHover,
    onShow: () => {
      map.setPaintProperty(ids.bodiesFill, 'fill-opacity', hoverExpr(0.68, 0.5));
      map.setPaintProperty(ids.bodiesOutline, 'line-opacity', 0.5);
      map.setPaintProperty(ids.ditch, 'line-opacity', 0.45);
      map.setPaintProperty(ids.drain, 'line-opacity', 0.45);
      map.setPaintProperty(ids.canal, 'line-opacity', 1);
      map.setPaintProperty(ids.stream, 'line-opacity', 0.85);
      map.setPaintProperty(ids.river, 'line-opacity', 1);
      map.setPaintProperty(ids.label, 'text-opacity', 1);
    },
    onHide: () => {
      map.setPaintProperty(ids.bodiesFill, 'fill-opacity', 0);
      for (const id of [ids.bodiesOutline, ids.ditch, ids.drain, ids.canal, ids.stream, ids.river]) {
        map.setPaintProperty(id, 'line-opacity', 0);
      }
      map.setPaintProperty(ids.label, 'text-opacity', 0);
    },
  });

  // Watercourse lines win the hover over the broad washes (SSSI/HONA/DWT, 30);
  // the two named water bodies sit just below the lines.
  const queryLayers = [
    { id: ids.river, priority: 40 },
    { id: ids.stream, priority: 40 },
    { id: ids.canal, priority: 40 },
    { id: ids.ditch, priority: 40 },
    { id: ids.drain, priority: 40 },
    { id: ids.bodiesFill, priority: 35, source: bodiesSourceId },
  ];
  return { controller, queryLayers, sourceId, bottomId: ids.bodiesFill };
}

// Shared visibility controller with a smooth fade, used by all layer kinds.
function makeController(map, { layerIds, sourceId, startVisible, card, clearHover, onShow, onHide }) {
  let visible = startVisible;

  const setVisible = (next) => {
    if (next === visible) return;
    visible = next;
    if (next) {
      layerIds.forEach((id) => map.setLayoutProperty(id, 'visibility', 'visible'));
      requestAnimationFrame(onShow);
    } else {
      clearHover(sourceId);
      card.hide();
      onHide();
      window.setTimeout(() => {
        if (!visible) layerIds.forEach((id) => map.setLayoutProperty(id, 'visibility', 'none'));
      }, FADE_MS);
    }
  };

  return {
    isVisible: () => visible,
    show: () => setVisible(true),
    hide: () => setVisible(false),
    toggle: () => setVisible(!visible),
  };
}

// One map-wide hover handler resolves the single best data feature across all
// visible layers — picking the highest hover priority (most specific), breaking
// ties by draw order (topmost). So a thin river line wins over a broad wash even
// though it's drawn beneath it, while markers still win over everything.
function setupHover(map, card, registry, controllers, hover, clearHover) {
  const accentFor = (layer) => palette[layer.accentVar] || palette.accent;

  const reset = () => {
    if (hover.current) clearHover();
    // Soft hide: link-bearing cards (marine) get a short grace period so the
    // pointer can travel onto the card to click "More info"; all others hide now.
    card.requestHide();
    map.getCanvas().style.cursor = '';
  };

  map.on('mousemove', (e) => {
    const active = registry.filter((r) => controllers.get(r.layer.id).isVisible());
    if (!active.length) return reset();

    const features = map.queryRenderedFeatures(e.point, { layers: active.map((r) => r.queryId) });
    if (!features.length) return reset();

    // features are topmost-first; pick the highest priority, keeping the first
    // (topmost) on ties via strict comparison.
    let best = null;
    let bestPriority = -Infinity;
    for (const f of features) {
      const entry = registry.find((r) => r.queryId === f.layer.id);
      if (entry && entry.priority > bestPriority) {
        bestPriority = entry.priority;
        best = { f, entry };
      }
    }
    if (!best) return reset();

    const { f, entry } = best;
    map.getCanvas().style.cursor = 'pointer';

    if (!hover.current || hover.current.id !== f.id || hover.current.source !== entry.sourceId) {
      clearHover();
      hover.current = { source: entry.sourceId, sourceLayer: entry.sourceLayer, id: f.id };
      // OMT coast features have no stable id — skip feature-state (no emphasis), just card.
      if (f.id != null) map.setFeatureState(featureRef(hover.current), { hover: true });
    }

    card.show(entry.layer.card(f.properties || {}), e.point, accentFor(entry.layer));
  });

  map.on('mouseout', reset);
}
