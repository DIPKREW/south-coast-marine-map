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

/**
 * @param {object} [opts]
 * @param {() => boolean} [opts.isSuppressed]  while true, layer hover cards are
 *   held off entirely. The site briefing's pin mode sets this: a card following
 *   the cursor fights the pin both visually (it owns the cursor) and
 *   functionally (a card sits under the pointer at the moment of the click).
 *   Checked INSIDE the existing mousemove handler so suppression runs the same
 *   teardown the handler already uses, rather than adding a second route out.
 */
export function applyDataLayers(map, layers, { isSuppressed } = {}) {
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

  const adders = { point: addPointLayer, mixed: addMixedLayer, waterways: addWaterwaysLayer, choropleth: addChoroplethLayer, croptiles: addCropTilesLayer, speciesgrid: addSpeciesGridLayer, marine: addMarineLayer, erosion: addErosionLayer, spills: addSpillLayer, liveoverflow: addLiveOverflowLayer, bathing: addBathingLayer, wfd: addWfdLayer, seabed: addSeabedLayer, marinemarkers: addMarineMarkersLayer, density: addDensityLayer, licensing: addLicensingLayer, wrecks: addWrecksLayer, compound: addCompoundLayer, todo: addTodoLayer };
  for (const layer of layers) {
    const add = adders[layer.kind] || addPolygonLayer;
    // A layer that starts hidden is DEFERRED: neither its source nor its layers
    // exist until the toggle is first switched on, so its data is never fetched
    // for someone who never asks to see it. Two kinds opt out because they do
    // their own, finer-grained deferral: croptiles must have its PMTiles archive
    // in hand before it can add a source at all, and marinemarkers defers per
    // SPECIES rather than per layer.
    // ('todo' has no data at all — deferring it would hide the onUnavailable
    // signal the panel uses to grey the row out.)
    const SELF_DEFERRING = new Set(['croptiles', 'marinemarkers', 'todo']);
    const defer = layer.defaultVisible === false && !SELF_DEFERRING.has(layer.kind);
    // A renderer that adds map layers over time (the marine species markers add
    // one source per species, the first time that species is ticked) registers
    // each new hit-test layer through this rather than up front.
    const addQueryLayer = (q) =>
      registry.push({ layer, queryId: q.id, sourceId: q.source, sourceLayer: q.sourceLayer, priority: q.priority ?? 0 });
    const ctx = { card, clearHover, addQueryLayer };
    const entry = defer ? deferLayer(map, layer, beforeId, ctx, add) : add(map, layer, beforeId, ctx);
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

  wirePairs(layers, controllers);
  setupHover(map, card, registry, controllers, hover, clearHover, isSuppressed);
  return controllers;
}

/**
 * COEXISTENCE PAIRS — let a layer's paint respond to its partner's toggle.
 *
 * Two pairs on this map collide badly when both are switched on: the live
 * discharge markers sit on the very same outfalls as the annual spill dots, and
 * commercial fishing and recreational pressure are both full-coverage washes
 * over the same water. Each is declared in the registry with `pairedWith` plus a
 * `pairedPaint` block, and the renderer for that kind exposes `setPaired`.
 *
 * This is deliberately general rather than two hardcoded checks: adding another
 * pair means adding `pairedWith`/`pairedPaint` to a layer and teaching its
 * renderer `setPaired`, with nothing to change here.
 *
 * Visibility has no change event, so each participating controller's show/hide
 * is wrapped once to re-run the sync. Only layers that actually take part are
 * wrapped, so every other layer keeps its untouched controller — which is what
 * guarantees seabed, marine species, water body status and the rest cannot be
 * affected by any of this.
 */
function wirePairs(layers, controllers) {
  const pairs = layers.filter((l) => l.pairedWith && controllers.get(l.pairedWith));
  if (!pairs.length) return;

  const sync = () => {
    for (const l of pairs) {
      const self = controllers.get(l.id);
      const other = controllers.get(l.pairedWith);
      self.setPaired?.(self.isVisible() && other.isVisible());
    }
  };

  const participants = new Set();
  for (const l of pairs) {
    participants.add(l.id);
    participants.add(l.pairedWith);
  }

  for (const id of participants) {
    const c = controllers.get(id);
    const show = c.show.bind(c);
    const hide = c.hide.bind(c);
    c.show = () => { show(); sync(); };
    c.hide = () => { hide(); sync(); };
    // Rebound so it goes through the wrappers above rather than the originals.
    c.toggle = () => (c.isVisible() ? c.hide() : c.show());
  }

  sync(); // initial state, in case a pair ever ships both-on by default
}

const hoverExpr = (a, b) => ['case', ['boolean', ['feature-state', 'hover'], false], a, b];

/**
 * A tiling diagonal HATCH swatch, drawn at runtime and registered as a map image
 * so a fill layer can use it as `fill-pattern`.
 *
 * This is how two full-coverage sea washes are told apart when both are on.
 * Colour alone cannot do it: alpha-blending two translucent fills produces a
 * third colour that belongs to neither, and the eye cannot decompose it — the
 * indigo fishing wash over the magenta recreational wash just reads as flat
 * purple, however the opacities are tuned. Texture separates them on a different
 * channel entirely, so each layer keeps its own colour at full strength and the
 * layer underneath stays visible through the gaps.
 *
 * The tile is square and the stroke wraps at both diagonals, so it repeats
 * seamlessly. Drawn at 2x for a crisp edge on retina displays.
 */
function makeHatchImage(color, { size = 8, width = 2.2, ratio = 2 } = {}) {
  const px = size * ratio;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = color;
  ctx.lineWidth = width * ratio;
  ctx.lineCap = 'square';
  // Three parallel passes, offset by ±one tile, so the diagonal is continuous
  // across tile boundaries instead of stopping at the edge.
  for (const off of [-px, 0, px]) {
    ctx.beginPath();
    ctx.moveTo(off - 1, px + 1);
    ctx.lineTo(off + px + 1, -1);
    ctx.stroke();
  }
  const { data } = ctx.getImageData(0, 0, px, px);
  return { width: px, height: px, data: new Uint8Array(data) };
}

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

  // Coexistence state, held here for exactly the same reason as `species`: it
  // can be set before the real layer exists, and must survive until it does.
  let paired = false;

  // Slider weights chosen before the layer built. Same buffering rationale.
  const pendingWeights = Object.fromEntries((layer.pressures ?? []).map((p) => [p.key, 1]));

  // Whatever `prepare` returned, kept for readers that have no file to go to.
  let prepared = null;

  const build = async () => {
    if (real || failed || building) return;
    building = true;
    try {
      // `prepare` lets a layer assemble its data at runtime (the live storm
      // overflow feed queries several APIs) before anything is added to the map.
      const extra = layer.prepare ? await layer.prepare() : null;
      prepared = extra;
      // defaultVisible true: we are building precisely because it was asked for.
      real = add(map, { ...layer, ...extra, defaultVisible: true, defaultSpecies: species }, anchorId, ctx);
      resolveQuery(real.queryLayers ?? []);
      // A pair partner may already have been on while this layer was still
      // deferred, so the coexistence state has to be replayed onto the real
      // controller the moment it exists — it was set on a controller that did
      // not yet have anything to paint.
      real.controller.setPaired?.(paired);
      if (layer.pressures) real.controller.setWeights?.(pendingWeights);
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
    setPaired: (on) => {
      paired = on;
      real?.controller.setPaired?.(on);
    },
  };
  controller.toggle = () => (want ? controller.hide() : controller.show());

  /*
   * Compound pressure exposes weight controls. Like `species` and `paired`, the
   * panel can touch these before the real layer exists — the detail panel builds
   * its sections up front, while this layer is still deferred — so the chosen
   * weights are buffered here and replayed on build.
   */
  if (layer.pressures) {
    controller.getWeights = () => (real ? real.controller.getWeights() : { ...pendingWeights });
    controller.getBreaks = () => (real ? real.controller.getBreaks() : [0.2, 0.4, 0.6, 0.8]);
    controller.setWeights = (next) => {
      Object.assign(pendingWeights, next);
      real?.controller.setWeights(next);
    };
  }

  /*
   * The live storm overflow feed has no committed file behind it: `prepare`
   * fetches it once and the result lives only here. The site briefing needs
   * both the features and the fetch time — a briefing that re-queried the feed
   * would quote a snapshot the map is not showing — so what prepare produced is
   * handed back rather than being reachable only through the map source.
   */
  if (layer.prepare) controller.getPrepared = () => prepared;

  /*
   * MANUAL REFRESH — re-run `prepare` and swap the result in.
   *
   * Only offered for a layer that has a `prepare` step and a renderer that
   * accepts new data; everything else on this map is a committed file that
   * cannot have changed since the page loaded.
   *
   * A PARTIAL RESULT IS REJECTED OUTRIGHT. If a refresh comes back missing a
   * company, neither the data nor `prepared` is touched: the map keeps the
   * snapshot it had, and the caller is told which feeds were reached so it can
   * say so. The alternative — draw the partial data but keep the old timestamp,
   * or draw it under a fresh one — produces a stated time that describes
   * something other than what is on the screen, and this map does not do that.
   * A refresh that fails outright is the same case with nothing reached.
   *
   * `prepared` is replaced in the SAME step as the map data, so the site
   * briefing (which reads it) and the control (which reads its timestamp) cannot
   * observe one without the other.
   */
  if (layer.prepare) {
    let refreshing = false;
    controller.refresh = async () => {
      if (refreshing || building) return { ok: false, reason: 'busy' };
      if (!real?.controller.setData) return { ok: false, reason: 'not-built' };
      refreshing = true;
      try {
        const next = await layer.prepare();
        const failed = next?.stats?.failed ?? [];
        if (failed.length) return { ok: false, reason: 'partial', failed, stats: next.stats };
        prepared = next;
        real.controller.setData(next.data);
        return { ok: true, stats: next.stats };
      } catch (err) {
        console.warn(`[${layer.id}] refresh failed:`, err?.message || err);
        return { ok: false, reason: 'failed', error: err };
      } finally {
        refreshing = false;
      }
    };
  }

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

/**
 * DESIGNATED BATHING WATERS (Environment Agency). One marker per site, coloured
 * by the current classification.
 *
 * THE MARKER IS THREE RINGS, and that is the point. Every bathing water is drawn
 * as a dark hairline around a thick cream halo around a coloured core. The
 * palette on this map has no unused hue left, and these markers sit at the
 * shoreline directly beside the storm overflow dots and on top of the WFD water
 * body fills — so layer identity is carried by the SILHOUETTE rather than by
 * colour alone. The cream halo is also what keeps the core legible over any wash
 * underneath it. Same reasoning as the protected wreck rings.
 *
 * NOT ASSESSED IS OFF THE RAMP. A site with no classification is filled with
 * paper, so it reads as an EMPTY marker — "no answer" — rather than as a fifth
 * quality band sitting below Poor. Four corridor sites are in this state, all
 * designated in 2026 and never yet classified.
 *
 * `circle-sort-key` puts the worse classifications on top: with 149 of 193 sites
 * Excellent, the ten that are Sufficient or Poor must not end up underneath
 * their neighbours at low zoom.
 */
function addBathingLayer(map, layer, beforeId, { card, clearHover }) {
  const sourceId = `${layer.id}-source`;
  const dotId = `${layer.id}-dot`;
  const ringId = `${layer.id}-ring`;
  const labelId = `${layer.id}-label`;
  const startVisible = layer.defaultVisible !== false;
  const hb = ['boolean', ['feature-state', 'hover'], false];
  const c = layer.paint.colors;

  map.addSource(sourceId, { type: 'geojson', data: layer.data, generateId: true });

  // Classification → core colour. The fallback (no `cls` at all) is paper.
  const fill = [
    'match', ['get', 'cls'],
    'Excellent', c.Excellent,
    'Good', c.Good,
    'Sufficient', c.Sufficient,
    'Poor', c.Poor,
    c.none,
  ];
  /*
   * DRAW ORDER — by how much the marker deserves to be seen, not by quality.
   *
   * Poor and Sufficient go on top, because they are the only actionable states
   * and there are ten of them against 179 others. NOT ASSESSED sits third,
   * ABOVE Excellent and Good: it is the rarest state on the map (four sites) and
   * it was originally sorted to the very bottom, which buried East Beach at West
   * Bay under its Excellent neighbour 396 m away at every zoom below ~12.5.
   * The rare, informative marker should not be the one that loses.
   */
  const sortKey = [
    'match', ['get', 'cls'],
    'Poor', 4, 'Sufficient', 3, 'Good', 1, 'Excellent', 0,
    2, // not assessed
  ];

  // Zoom-interpolated radii. A zoom expression may only sit at the top level of
  // a paint property, so the outer ring gets its own interpolate with every stop
  // pre-offset rather than being derived from the inner one.
  const RING_GAP = 2.6;
  const lift = ['case', hb, 1.32, 1];
  /*
   * MARKER SIZE. Raised from [7:3, 10:4.2, 13:6, 16:7.6] because the earlier
   * size was too small to read a classification colour off — the core was 8.4px
   * across at z10, and four steps of anything are not separable at that size.
   *
   * The low-zoom stop is left almost alone. At z7–z8 the 193 markers already
   * overlap (92% of them have a neighbour closer than a marker width at z7,
   * with the OLD radius), so growth there buys nothing and costs clutter; the
   * layer honestly reads as distribution rather than classification until about
   * z10. The growth is concentrated where colour is actually read: z10 8.4→11.6px
   * across, z13 12→17.6px.
   */
  const stops = [7, 3.2, 10, 5.8, 13, 8.8, 16, 11.5];
  const radius = (offset) => [
    'interpolate', ['linear'], ['zoom'],
    ...stops.flatMap((v, i) => (i % 2 === 0 ? [v] : [['*', v + offset, lift]])),
  ];

  map.addLayer(
    {
      id: dotId, type: 'circle', source: sourceId,
      layout: { visibility: startVisible ? 'visible' : 'none', 'circle-sort-key': sortKey },
      paint: {
        'circle-color': fill,
        'circle-radius': radius(0),
        // The cream halo — thick, so the core never touches whatever is beneath.
        'circle-stroke-color': palette.surface,
        'circle-stroke-width': hoverExpr(3, 2.4),
        'circle-opacity': startVisible ? 1 : 0,
        'circle-stroke-opacity': startVisible ? 0.95 : 0,
        'circle-radius-transition': { duration: 150 },
        'circle-opacity-transition': { duration: FADE_MS },
        'circle-stroke-opacity-transition': { duration: FADE_MS },
      },
    },
    beforeId,
  );

  // The outer hairline. Fill is fully transparent, so this is a ring and nothing
  // else — it never covers the core or the halo it encircles.
  map.addLayer(
    {
      id: ringId, type: 'circle', source: sourceId,
      layout: { visibility: startVisible ? 'visible' : 'none', 'circle-sort-key': sortKey },
      paint: {
        'circle-color': 'rgba(0,0,0,0)',
        'circle-opacity': 0,
        'circle-radius': radius(RING_GAP),
        'circle-stroke-color': palette['bw-ring'],
        'circle-stroke-width': hoverExpr(1.5, 1),
        'circle-stroke-opacity': startVisible ? 0.85 : 0,
        'circle-radius-transition': { duration: 150 },
        'circle-stroke-opacity-transition': { duration: FADE_MS },
      },
    },
    beforeId,
  );

  map.addLayer(
    {
      id: labelId, type: 'symbol', source: sourceId,
      minzoom: 11,
      layout: {
        visibility: startVisible ? 'visible' : 'none',
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-anchor': 'top',
        'text-offset': [0, 0.95],
        'text-max-width': 9,
        // Optional: at 193 sites the beaches crowd together in Torbay and the
        // Solent, and a dropped label is better than a collided one.
        'text-optional': true,
      },
      paint: {
        'text-color': palette.ink,
        'text-halo-color': palette.paper,
        'text-halo-width': 1.6,
        'text-opacity': startVisible ? 1 : 0,
        'text-opacity-transition': { duration: FADE_MS },
      },
    },
    beforeId,
  );

  const controller = makeController(map, {
    layerIds: [dotId, ringId, labelId], sourceId, startVisible, card, clearHover,
    onShow: () => {
      map.setPaintProperty(dotId, 'circle-opacity', 1);
      map.setPaintProperty(dotId, 'circle-stroke-opacity', 0.95);
      map.setPaintProperty(ringId, 'circle-stroke-opacity', 0.85);
      map.setPaintProperty(labelId, 'text-opacity', 1);
    },
    onHide: () => {
      map.setPaintProperty(dotId, 'circle-opacity', 0);
      map.setPaintProperty(dotId, 'circle-stroke-opacity', 0);
      map.setPaintProperty(ringId, 'circle-stroke-opacity', 0);
      map.setPaintProperty(labelId, 'text-opacity', 0);
    },
  });

  // Above the annual spill dots (56), below the generic point markers (60).
  return { controller, queryLayers: [{ id: dotId, priority: 58 }], sourceId, bottomId: dotId };
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

  /*
   * COEXISTENCE with the annual spill dots, which mark the SAME outfalls.
   *
   * Solo, this layer is a filled marker: a solid alert disc for discharging, and
   * paper-filled discs for the quiet and offline states. Every one of those
   * fills sits directly on an annual dot and hides its spill-count colour.
   *
   * Paired, the fill is dropped entirely and the marker grows, so it reads as a
   * RING AROUND the annual dot rather than a disc on top of it. Colour still
   * carries the annual reading in the centre; the ring's own colour and weight
   * still carry the live status. The stroke thickens to stay legible now that it
   * is the only thing being drawn.
   */
  const pp = layer.pairedPaint;
  let paired = false;
  const on = () => paired && pp;

  const radiusExpr = () => {
    const k = on() ? pp.radiusScale : 1;
    const stop = (a, b, cOff) => ['*', byStatus(a * k, b * k, cOff * k), ['case', hb, 1.5, 1]];
    return ['interpolate', ['linear'], ['zoom'],
      7, stop(3.4, 2.2, 1.9),
      11, stop(5, 3.2, 2.7),
      15, stop(7.5, 4.8, 4),
    ];
  };
  // Ring-only: no fill at all, so the annual colour underneath shows through.
  const opacityExpr = () => (on() && pp.ringOnly ? 0 : byStatus(0.95, 0.85, 0.5));
  const strokeOpacityExpr = () => byStatus(1, 0.9, 0.55);
  const strokeWidthExpr = () => (on() ? hoverExpr(pp.strokeWidth[0], pp.strokeWidth[1]) : hoverExpr(2.2, 1.4));

  map.addLayer(
    {
      id: dotId, type: 'circle', source: sourceId,
      layout: { visibility: startVisible ? 'visible' : 'none', 'circle-sort-key': ['get', 'status'] },
      paint: {
        // Discharging is a solid disc; the other two are hollow (paper-filled).
        'circle-color': byStatus(palette['discharge-on'], palette.surface, palette.surface),
        'circle-stroke-color': byStatus(palette['discharge-on'], palette['discharge-off'], palette['discharge-offline']),
        'circle-radius': radiusExpr(),
        'circle-stroke-width': strokeWidthExpr(),
        'circle-opacity': startVisible ? opacityExpr() : 0,
        'circle-stroke-opacity': startVisible ? strokeOpacityExpr() : 0,
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
      map.setPaintProperty(dotId, 'circle-opacity', opacityExpr());
      map.setPaintProperty(dotId, 'circle-stroke-opacity', strokeOpacityExpr());
    },
    onHide: () => {
      map.setPaintProperty(dotId, 'circle-opacity', 0);
      map.setPaintProperty(dotId, 'circle-stroke-opacity', 0);
    },
  });

  controller.setPaired = (next) => {
    if (next === paired) return;
    paired = next;
    // Radius and stroke width are safe to set whether or not the layer is
    // showing — they carry no opacity. The two opacities are gated, so a hidden
    // layer is not revived by its partner being switched on.
    map.setPaintProperty(dotId, 'circle-radius', radiusExpr());
    map.setPaintProperty(dotId, 'circle-stroke-width', strokeWidthExpr());
    if (controller.isVisible()) {
      map.setPaintProperty(dotId, 'circle-opacity', opacityExpr());
      map.setPaintProperty(dotId, 'circle-stroke-opacity', strokeOpacityExpr());
    }
  };

  /*
   * REPLACE THE SNAPSHOT IN PLACE, for the manual refresh.
   *
   * The source is `generateId: true`, so every feature id is regenerated by
   * setData — which makes any surviving hover feature-state a reference to a
   * feature that no longer means what it did. Both the emphasis and the card
   * are therefore dropped BEFORE the swap rather than after it.
   *
   * Nothing else needs invalidating: every paint property here is an expression
   * over `status`, and the ring-only coexistence with the annual spill layer is
   * held in `paired` rather than in feature state, so both survive the swap
   * untouched.
   */
  controller.setData = (data) => {
    const src = map.getSource(sourceId);
    if (!src) return false;
    clearHover(sourceId);
    card.hide();
    src.setData(data);
    return true;
  };

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

/**
 * MARINE SPECIES MARKERS — one small dot per occupied grid square per species,
 * many species drawable at once.
 *
 * Unlike every other layer here this one owns N sources, not one: each species
 * has its own file and its own map layer, added the FIRST TIME that species is
 * ticked and never removed. Unticking only hides it, so re-ticking is instant
 * and nothing is fetched twice. That is the same bargain deferLayer strikes for
 * whole layers, applied one level down.
 *
 * The markers are POINTS, already placed in the sea portion of their grid square
 * at build time (see scripts/build-marine-species.mjs) — the map does no
 * geometry, it just draws what it is given.
 *
 * Two species recorded in the same square would otherwise draw one dot exactly
 * on top of another. Each species layer therefore carries a fixed
 * `circle-translate` — a few pixels, at an angle derived from its index in the
 * list. It is deterministic (the same species always shifts the same way), it is
 * in SCREEN space so it neither grows nor distorts position as you zoom, and at
 * this size it reads as a small cluster rather than a moved point.
 */
function addMarineMarkersLayer(map, layer, beforeId, { card, clearHover, addQueryLayer }) {
  const species = layer.species ?? [];
  const built = new Map(); // key → { sourceId, layerId }
  const checked = new Set();
  const pending = new Map(); // key → in-flight fetch, so a double-click can't double-fetch

  /*
   * WHERE EACH SPECIES SITS relative to its square's true point.
   *
   * Bearing steps 140° per species and the radius alternates between two rings.
   * 140° is 7/18 of a turn and 7 is coprime with 18, so the eighteen bearings are
   * a permutation of eighteen evenly-spaced slots: no two species ever share one,
   * and consecutive species — which is what a taxonomic group is — land 140°
   * apart, nearly opposite. The alternating radius then separates the pairs that
   * the bearing alone leaves close.
   *
   * Measured against the alternatives, as multiples of the ring radius R:
   *
   *                            worst of all 153 pairs   worst within one group
   *   golden angle 137.5°            0.216 R                  0.559 R
   *   two rings, 40° steps           0.410 R                  0.410 R
   *   this (140° + alt radius)       0.479 R                  0.639 R
   *
   * The golden angle was the obvious first choice and it is the worst of the
   * three. It spreads CONSECUTIVE indices beautifully and says nothing about
   * distant ones: grey seal (0) and common cuttlefish (13) came out 12.4° apart,
   * which drew them 0.8 px apart at the corridor view and 2.2 px inside Plymouth
   * Sound. Both are commonly ticked. The second column matters as much as the
   * first, because someone comparing two dolphins is likelier than someone
   * comparing a dolphin with a squid.
   */
  const OFFSET_PX = 3.6;
  const bearing = (i) => {
    const a = (i * 140 * Math.PI) / 180;
    const r = i % 2 ? 1.25 : 0.7;
    return [Math.cos(a) * r, Math.sin(a) * r];
  };
  const offsetAt = (i, scale) => {
    const [cx, cy] = bearing(i);
    return [Math.round(cx * OFFSET_PX * scale * 100) / 100, Math.round(cy * OFFSET_PX * scale * 100) / 100];
  };

  /*
   * SIZE BY RECORD COUNT × ZOOM.
   *
   * Count alone (what this used to be) is fixed in pixels, so a dot that reads
   * fine across the whole corridor is a speck once you are inside Plymouth Sound
   * or the Fal — too small to see, let alone hover. Zoom alone would throw away
   * the "this square is busier than that one" signal. So the two multiply: the
   * count curve sets the relative size, the zoom curve sets the overall scale.
   */
  const countRadius = ['interpolate', ['linear'], ['log10', ['max', ['get', 'n'], 1]], 0, 2.6, 1, 3.6, 2, 4.8, 3.5, 6.4];
  const hb = ['boolean', ['feature-state', 'hover'], false];

  // ~1× at the opening corridor view (z7.1), ~2× by the time you are in a bay.
  //
  // A zoom expression has to be the OUTERMOST thing in a paint property — it
  // cannot be a term inside an arithmetic expression — so the multiplication is
  // pushed down into each stop's output rather than wrapped round the whole
  // curve. Same shape as the `lineW` helper the waterways layer uses.
  const ZOOM_STOPS = [[6.5, 0.95], [7, 1], [10, 1.4], [13, 2], [16, 2.4]];
  const byZoom = (perStop) => [
    'interpolate', ['linear'], ['zoom'],
    ...ZOOM_STOPS.flatMap(([z, k]) => [z, perStop(k)]),
  ];

  /*
   * The per-species offset has to grow too, and by MORE than the radius.
   *
   * circle-translate is in screen pixels, so a fixed offset would stay 3.6 px
   * while the dots doubled — the separation that reads clearly at the corridor
   * view would close up exactly when you zoom in to inspect a cluster. Growing it
   * faster than the radius (×3.6 against the radius's ×2 over z7→z13) means
   * zooming in actively pulls a crowded square apart, which is what zooming in is
   * for, while the corridor view stays compact enough that a cluster still reads
   * as one place.
   */
  const OFFSET_STOPS = [[6.5, 0.95], [7, 1], [10, 2], [13, 3.6], [16, 4.4]];
  const translateFor = (i) => [
    'interpolate', ['linear'], ['zoom'],
    ...OFFSET_STOPS.flatMap(([z, k]) => [z, ['literal', offsetAt(i, k)]]),
  ];

  const ensure = async (sp, index) => {
    if (built.has(sp.key)) return built.get(sp.key);
    if (pending.has(sp.key)) return pending.get(sp.key);
    const job = (async () => {
      const sourceId = `${layer.id}-${sp.key}-source`;
      const dotId = `${layer.id}-${sp.key}-dot`;
      const res = await fetch(`${layer.speciesBase}${sp.key}.geojson`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      map.addSource(sourceId, { type: 'geojson', data, generateId: true });
      map.addLayer(
        {
          id: dotId, type: 'circle', source: sourceId,
          layout: { visibility: 'visible' },
          paint: {
            'circle-color': palette[sp.colorVar] ?? palette['marine-species'],
            'circle-radius': byZoom((k) => ['*', countRadius, k, ['case', hb, 1.45, 1]]),
            'circle-stroke-color': palette.surface,
            'circle-stroke-width': byZoom((k) => ['case', hb, 1.4 * k, 0.7 * k]),
            'circle-translate': translateFor(index),
            'circle-opacity': 0.95,
            'circle-stroke-opacity': 0.9,
            'circle-radius-transition': { duration: 150 },
            'circle-opacity-transition': { duration: FADE_MS },
            'circle-stroke-opacity-transition': { duration: FADE_MS },
          },
        },
        beforeId,
      );
      const rec = { sourceId, dotId, count: data.features?.length ?? 0 };
      built.set(sp.key, rec);
      // Only now can the hover resolver safely query it.
      addQueryLayer({ id: dotId, source: sourceId, priority: 62 });
      pending.delete(sp.key);
      return rec;
    })().catch((err) => {
      pending.delete(sp.key);
      console.warn(`[${layer.id}] "${sp.common}" unavailable:`, err);
      throw err;
    });
    pending.set(sp.key, job);
    return job;
  };

  // `master` is the panel's own toggle; `checked` is the checklist. A species
  // draws only when both are on. They are deliberately separate: unticking every
  // species must NOT switch the layer off, or the checklist would vanish and
  // leave no way to tick anything again. Turning the layer off keeps the ticks,
  // so turning it back on restores exactly what was showing.
  let master = false;

  const applyVisibility = () => {
    for (const [key, rec] of built) {
      map.setLayoutProperty(rec.dotId, 'visibility', master && checked.has(key) ? 'visible' : 'none');
    }
  };

  const setChecked = async (key, on) => {
    const i = species.findIndex((s) => s.key === key);
    if (i < 0) return;
    if (on) checked.add(key);
    else checked.delete(key);
    if (on && !built.has(key)) {
      // First tick for this species — this is the only time it is fetched.
      try { await ensure(species[i], i); } catch { checked.delete(key); }
    }
    if (!on) { clearHover(built.get(key)?.sourceId); card.hide(); }
    applyVisibility();
  };

  const controller = {
    isVisible: () => master,
    show: () => { master = true; applyVisibility(); },
    hide: () => { master = false; applyVisibility(); clearHover(); card.hide(); },
    toggle: () => (master ? controller.hide() : controller.show()),
    // The panel's checklist drives these.
    isChecked: (key) => checked.has(key),
    setChecked,
    checkedKeys: () => [...checked],
    loadedCount: (key) => built.get(key)?.count ?? null,
  };

  // No hit-test layers up front — each species registers its own on arrival.
  return { controller, queryLayers: [], sourceId: `${layer.id}-source`, bottomId: beforeId };
}

// LICENSED SEABED ACTIVITY (MMO marine licensing). Discrete parcels rather than
// a continuous surface, so unlike the seabed and density washes these get an
// OUTLINE: a dredging licence has a real, drawn boundary and should read as a
// bounded permission, not a gradient. Status drives opacity — a licence that has
// expired, or a disposal ground that has closed, is drawn fainter than one still
// in force, so the map distinguishes "permitted" from "was once permitted"
// without needing a second colour dimension.
function addLicensingLayer(map, layer, beforeId, { card, clearHover }) {
  const sourceId = `${layer.id}-source`;
  const fillId = `${layer.id}-fill`;
  const lineId = `${layer.id}-line`;
  const c = layer.paint.colors;
  const startVisible = layer.defaultVisible !== false;

  map.addSource(sourceId, { type: 'geojson', data: layer.data, generateId: true });

  const entries = Object.entries(c).filter(([k]) => k !== 'unknown');
  const colorExpr = ['match', ['get', layer.field], ...entries.flatMap(([k, v]) => [k, v]), c.unknown];
  // Still in force vs finished. `current` and `open` are live; everything else
  // (expired, closed, disused, unknown) recedes.
  const live = ['match', ['get', 'status'], 'current', true, 'open', true, false];
  const opacity = (a, b) => ['case', live, a, b];
  const hb = ['boolean', ['feature-state', 'hover'], false];
  const fillOpacityExpr = ['case', hb, opacity(layer.paint.fillOpacityHover, layer.paint.fillOpacityHover * 0.7), opacity(layer.paint.fillOpacity, layer.paint.fillOpacity * 0.45)];

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
        'line-width': hoverExpr(2.2, 0.9),
        // Finished permissions get a dashed edge as well as a fainter fill.
        'line-opacity': startVisible ? opacity(0.9, 0.5) : 0,
        'line-opacity-transition': { duration: FADE_MS }, 'line-width-transition': { duration: 150 },
      },
    },
    beforeId,
  );

  const controller = makeController(map, {
    layerIds: [fillId, lineId], sourceId, startVisible, card, clearHover,
    onShow: () => {
      map.setPaintProperty(fillId, 'fill-opacity', fillOpacityExpr);
      map.setPaintProperty(lineId, 'line-opacity', opacity(0.9, 0.5));
    },
    onHide: () => {
      map.setPaintProperty(fillId, 'fill-opacity', 0);
      map.setPaintProperty(lineId, 'line-opacity', 0);
    },
  });

  // Above the broad washes AND above the watercourse lines (40). Dredging
  // licences sit in estuaries and harbours, and the rivers layer is the one that
  // defaults on — at 34 a licence parcel in the Itchen lost its own hover card to
  // the river running through it.
  return { controller, queryLayers: [{ id: fillId, priority: 42 }], sourceId, bottomId: fillId };
}

/**
 * A SCAFFOLDED layer: a toggle that exists so the gap is visible, with no data
 * behind it. Used where a dataset was investigated and genuinely could not be
 * obtained to the standard the rest of the map meets — better an honest, inert
 * switch than a layer quietly built from something weaker.
 */
function addTodoLayer(map, layer, beforeId) {
  const controller = {
    isVisible: () => false,
    show: () => {},
    hide: () => {},
    toggle: () => {},
    // The panel greys the row out through this, exactly as it does for a layer
    // whose fetch failed.
    onUnavailable: (cb) => cb(),
  };
  return { controller, queryLayers: [], sourceId: `${layer.id}-source`, bottomId: beforeId };
}

// RECREATIONAL PRESSURE (MMO vessel density grid). A 2 km grid of squares
// shaded by how many recreational vessel transits a week the AIS sampling saw
// there. Banded, not continuous: transits per week is long-tailed (median 0.58,
// max 807), so a linear ramp would leave almost every cell the palest colour.
// No outline — at 2 km the grid is dense enough that cell edges would read as a
// mesh laid over the sea rather than as data.
function addDensityLayer(map, layer, beforeId, { card, clearHover }) {
  const sourceId = `${layer.id}-source`;
  const fillId = `${layer.id}-fill`;
  const c = layer.paint.colors;
  const breaks = layer.paint.breaks;
  const startVisible = layer.defaultVisible !== false;
  const pp = layer.pairedPaint;
  /*
   * PER-BAND OPACITY — opt-in, via `paint.bandOpacity`.
   *
   * A density wash covering every sea cell reads as blanket coverage rather than
   * as a hotspot map. Where a layer sets `paint.bandOpacity` — one multiplier per
   * band — each band is drawn at that share of the layer's normal fill opacity,
   * so the sparse end recedes toward the basemap and the busy end holds. Hover
   * still lifts the cell to full opacity, and the VALUE is untouched: the hover
   * card reads the same number it always did, and nothing downstream changes.
   *
   * Absent from a layer's paint config this is a no-op and the expression is
   * exactly what it was, which is what leaves commercial fishing untouched.
   */
  const bandOpacity = layer.paint.bandOpacity;
  const fade = (base, hover) =>
    !bandOpacity
      ? hoverExpr(hover, base)
      : [
          'case',
          ['boolean', ['feature-state', 'hover'], false], hover,
          // Scale each band's share of the layer's normal fill opacity.
          ['step', ['get', layer.field],
            base * bandOpacity[0],
            ...breaks.flatMap((b, i) => [b, base * bandOpacity[i + 1]])],
        ];
  const soloOpacity = fade(layer.paint.fillOpacity, layer.paint.fillOpacityHover);
  // Opacity used only while this layer's coexistence partner is also on. Absent
  // for every density layer with no partner, which behaves exactly as before.
  const pairedOpacity = pp ? fade(pp.fillOpacity, pp.fillOpacityHover) : soloOpacity;

  let paired = false;
  const fillOpacityExpr = () => (paired ? pairedOpacity : soloOpacity);

  map.addSource(sourceId, { type: 'geojson', data: layer.data, generateId: true });

  const colorExpr = ['step', ['get', layer.field], c[0], ...breaks.flatMap((b, i) => [b, c[i + 1]])];

  /*
   * HATCH — the coexistence treatment for a wash that has to sit over another
   * wash. One hatch swatch is registered per band, in that band's own colour, so
   * the ramp still reads; the pattern is then selected by the same `step` on the
   * data field that drives the solid fill. Where the pattern is transparent the
   * layer underneath shows through at full strength, so both colours survive.
   */
  const hatchPattern = pp?.hatch
    ? (() => {
        // `paint.colors` is keyed by band index (an object, not an array), so the
        // ids are built from the band count rather than by mapping over it.
        const opts = pp.hatch === true ? {} : pp.hatch;
        const ids = Array.from({ length: breaks.length + 1 }, (_, i) => {
          const id = `${layer.id}-hatch-${i}`;
          if (!map.hasImage(id)) map.addImage(id, makeHatchImage(c[i], opts), { pixelRatio: 2 });
          return id;
        });
        return ['step', ['get', layer.field], ids[0], ...breaks.flatMap((b, i) => [b, ids[i + 1]])];
      })()
    : null;

  map.addLayer(
    {
      id: fillId, type: 'fill', source: sourceId,
      layout: { visibility: startVisible ? 'visible' : 'none' },
      paint: {
        'fill-color': colorExpr,
        'fill-opacity': startVisible ? fillOpacityExpr() : 0,
        'fill-opacity-transition': { duration: FADE_MS }, 'fill-antialias': false,
      },
    },
    beforeId,
  );

  const controller = makeController(map, {
    layerIds: [fillId], sourceId, startVisible, card, clearHover,
    onShow: () => map.setPaintProperty(fillId, 'fill-opacity', fillOpacityExpr()),
    onHide: () => map.setPaintProperty(fillId, 'fill-opacity', 0),
  });

  // Repaint only while actually visible — a hidden layer is held at opacity 0
  // and must not be brought back by a partner's toggle. `fill-pattern` carries
  // no opacity of its own, so it is safe to set either way.
  controller.setPaired = (on) => {
    if (on === paired) return;
    paired = on;
    if (hatchPattern) {
      // NULL, not undefined: undefined leaves the property at its previous value,
      // so the layer would stay hatched after its partner was switched off.
      // Unsetting it falls back to the solid `fill-color`.
      map.setPaintProperty(fillId, 'fill-pattern', on ? hatchPattern : null);
    }
    if (controller.isVisible()) map.setPaintProperty(fillId, 'fill-opacity', fillOpacityExpr());
  };

  // A broad context wash — above the seabed it sits on, below everything specific.
  return { controller, queryLayers: [{ id: fillId, priority: 10 }], sourceId, bottomId: fillId };
}

/**
 * SHIPWRECKS (UKHO Wrecks & Obstructions + Historic England protected sites).
 *
 * 3,664 points in the corridor, and the density is the whole design problem:
 * measured on the real data, at the opening corridor zoom 99% of wrecks sit
 * closer to a neighbour than a marker is wide, so drawn plainly they merge into
 * one grey smear along the coast. That resolves as you zoom — 34% overlapping at
 * z10, 9% at z13, 4% at z14.
 *
 * So the general wrecks are CLUSTERED, using MapLibre's own clustering rather
 * than a library: below the cluster zoom they aggregate into a bubble carrying a
 * count, above it they separate into individual markers. A count is an honest
 * thing to show at a zoom where individual points cannot be told apart anyway.
 *
 * The 31 PROTECTED sites are a second, deliberately UNclustered source drawn
 * over the top. They are the legally designated wrecks — Mary Rose, Invincible,
 * Studland Bay — and burying them inside a cluster bubble would hide the most
 * significant thing the layer has to say. One toggle, two sources: the same
 * shape as the waterways layer (lines plus named bodies).
 */
function addWrecksLayer(map, layer, beforeId, { card, clearHover }) {
  const sourceId = `${layer.id}-source`;
  const protSourceId = `${layer.id}-prot-source`;
  const clusterId = `${layer.id}-cluster`;
  const countId = `${layer.id}-count`;
  const dotId = `${layer.id}-dot`;
  const protId = `${layer.id}-prot`;
  const startVisible = layer.defaultVisible !== false;
  const hb = ['boolean', ['feature-state', 'hover'], false];

  map.addSource(sourceId, {
    type: 'geojson',
    data: layer.data,
    generateId: true,
    cluster: true,
    // Above this zoom every wreck is drawn individually. 11 is where the
    // measured overlap has fallen to about a fifth.
    clusterMaxZoom: 11,
    clusterRadius: 44,
  });
  map.addSource(protSourceId, { type: 'geojson', data: layer.protectedData, generateId: true });

  // MapLibre's `beforeId` inserts a layer BENEATH the named one, and successive
  // inserts against the SAME anchor stack in call order. So adding cluster →
  // count → dot → protected all against `beforeId` yields exactly that order
  // bottom-to-top, with the protected rings on top. (Anchoring each layer on the
  // previous one instead buries them in reverse — which is how the cluster
  // counts first ended up hidden behind their own circles.)
  map.addLayer(
    {
      id: clusterId, type: 'circle', source: sourceId, filter: ['has', 'point_count'],
      layout: { visibility: startVisible ? 'visible' : 'none' },
      paint: {
        'circle-color': palette['wreck-cluster'],
        // Area-proportional-ish steps, so a 500-wreck bubble is not 50x a 10.
        'circle-radius': ['step', ['get', 'point_count'], 9, 10, 12, 30, 15, 80, 19, 200, 24],
        'circle-opacity': startVisible ? 0.82 : 0,
        'circle-stroke-color': palette.surface,
        'circle-stroke-width': 1.4,
        'circle-stroke-opacity': startVisible ? 0.9 : 0,
        'circle-opacity-transition': { duration: FADE_MS },
        'circle-stroke-opacity-transition': { duration: FADE_MS },
      },
    },
    beforeId,
  );

  map.addLayer(
    {
      id: countId, type: 'symbol', source: sourceId, filter: ['has', 'point_count'],
      layout: {
        visibility: startVisible ? 'visible' : 'none',
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['step', ['get', 'point_count'], 10, 30, 11, 200, 12],
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': palette.surface,
        'text-opacity': startVisible ? 1 : 0,
        'text-opacity-transition': { duration: FADE_MS },
      },
    },
    beforeId,
  );

  map.addLayer(
    {
      id: dotId, type: 'circle', source: sourceId, filter: ['!', ['has', 'point_count']],
      layout: { visibility: startVisible ? 'visible' : 'none' },
      paint: {
        // Dangerous wrecks carry a rust bias — the one distinction the source
        // makes that a reader can act on.
        'circle-color': ['case', ['==', ['get', 'cat'], 'dangerous wreck'], palette['wreck-danger'], palette.wreck],
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          10, ['*', 2.6, ['case', hb, 1.6, 1]],
          13, ['*', 3.8, ['case', hb, 1.6, 1]],
          16, ['*', 5.4, ['case', hb, 1.6, 1]],
        ],
        'circle-stroke-color': palette.surface,
        'circle-stroke-width': hoverExpr(1.6, 0.9),
        'circle-opacity': startVisible ? 0.92 : 0,
        'circle-stroke-opacity': startVisible ? 0.85 : 0,
        'circle-radius-transition': { duration: 150 },
        'circle-opacity-transition': { duration: FADE_MS },
        'circle-stroke-opacity-transition': { duration: FADE_MS },
      },
    },
    beforeId,
  );

  // Protected sites: a brass RING (hollow centre) so the shape marks them out
  // even where the colour sits over a warm wash.
  map.addLayer(
    {
      id: protId, type: 'circle', source: protSourceId,
      layout: { visibility: startVisible ? 'visible' : 'none' },
      paint: {
        'circle-color': palette.wreck,
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          7, ['*', 3.4, ['case', hb, 1.5, 1]],
          11, ['*', 5, ['case', hb, 1.5, 1]],
          15, ['*', 7.5, ['case', hb, 1.5, 1]],
        ],
        'circle-stroke-color': palette['wreck-protected'],
        'circle-stroke-width': hoverExpr(3.4, 2.4),
        'circle-opacity': startVisible ? 0.95 : 0,
        'circle-stroke-opacity': startVisible ? 1 : 0,
        'circle-radius-transition': { duration: 150 },
        'circle-opacity-transition': { duration: FADE_MS },
        'circle-stroke-opacity-transition': { duration: FADE_MS },
      },
    },
    beforeId,
  );

  const controller = makeController(map, {
    layerIds: [clusterId, countId, dotId, protId], sourceId, startVisible, card, clearHover,
    onShow: () => {
      map.setPaintProperty(clusterId, 'circle-opacity', 0.82);
      map.setPaintProperty(clusterId, 'circle-stroke-opacity', 0.9);
      map.setPaintProperty(countId, 'text-opacity', 1);
      map.setPaintProperty(dotId, 'circle-opacity', 0.92);
      map.setPaintProperty(dotId, 'circle-stroke-opacity', 0.85);
      map.setPaintProperty(protId, 'circle-opacity', 0.95);
      map.setPaintProperty(protId, 'circle-stroke-opacity', 1);
    },
    onHide: () => {
      for (const [id, props] of [[clusterId, ['circle-opacity', 'circle-stroke-opacity']],
        [countId, ['text-opacity']], [dotId, ['circle-opacity', 'circle-stroke-opacity']],
        [protId, ['circle-opacity', 'circle-stroke-opacity']]]) {
        for (const pr of props) map.setPaintProperty(id, pr, 0);
      }
    },
  });

  // Protected outranks an individual wreck, which outranks a cluster bubble.
  return {
    controller,
    queryLayers: [
      { id: protId, source: protSourceId, priority: 68 },
      { id: dotId, priority: 66 },
      { id: clusterId, priority: 64 },
    ],
    sourceId,
    bottomId: clusterId,
  };
}

/**
 * COMPOUND PRESSURE INDICATOR.
 *
 * NOT a cumulative effects assessment — see the layer's About text and the
 * decision log. It draws a weighted mean of five independently-normalised
 * pressures, with the weights chosen by whoever is looking.
 *
 * THE WEIGHTED MEAN IS A MAPLIBRE EXPRESSION, NOT A DATA REWRITE.
 * Recomputing the score in JS and calling setData on 10,380 features made the
 * sliders feel laggy — every drag re-parsed and re-uploaded the whole source.
 * Instead the score is expressed once as an expression tree over the five
 * per-cell properties, and a slider move only calls setPaintProperty with new
 * coefficients. Nothing is re-parsed and nothing is re-uploaded.
 *
 * MISSING IS NOT ZERO. A cell that was never assessed for a pressure (91.8% of
 * cells have no WFD classification; 18.1% sit outside the fishing grid) must not
 * be scored as if that pressure were absent. So the denominator is the sum of
 * the weights for the pressures that cell ACTUALLY HAS — a weighted mean over
 * available inputs, not a weighted sum over five slots.
 */
function addCompoundLayer(map, layer, beforeId, { card, clearHover }) {
  const sourceId = `${layer.id}-source`;
  const fillId = `${layer.id}-fill`;
  const startVisible = layer.defaultVisible !== false;
  const keys = layer.pressures.map((p) => p.key);

  // Live weights, shared with the panel sliders and with the hover card.
  const weights = Object.fromEntries(keys.map((k) => [k, 1]));
  layer.weights = weights; // the card reads these to show the breakdown

  map.addSource(sourceId, { type: 'geojson', data: layer.data, generateId: true });

  const has = (k) => ['all', ['has', k], ['!=', ['get', k], null]];
  const scoreExpr = () => {
    const num = ['+', ...keys.map((k) => ['case', has(k), ['*', weights[k], ['to-number', ['get', k]]], 0])];
    const den = ['+', ...keys.map((k) => ['case', has(k), weights[k], 0])];
    // A cell with no data at all, or all weights at zero, scores 0 rather than
    // dividing by zero.
    return ['case', ['<=', den, 0], 0, ['/', num, den]];
  };

  // Band breaks are PERCENTILES OF THE CURRENT SCORE, recomputed whenever the
  // weights change — see setWeights. Seeded here with equal weights.
  let breaks = [0.2, 0.4, 0.6, 0.8];
  const c = layer.paint.colors;
  const colorExpr = () => ['step', scoreExpr(), c[0], ...breaks.flatMap((b, i) => [b, c[i + 1]])];

  /*
   * A cell with NO data under the current weighting is drawn TRANSPARENT, not as
   * the lowest band.
   *
   * This matters as soon as a slider is zeroed. Put all the weight on fishing and
   * the 1,883 cells outside the fishing grid have nothing left to score; rendered
   * in the palest band they read as "lowest pressure", which is a claim the data
   * does not support — nobody measured fishing there. Dropping them out entirely
   * says the honest thing: this cell has no answer under the weighting you chose.
   */
  const denExpr = () => ['+', ...keys.map((k) => ['case', has(k), weights[k], 0])];
  const opacityExpr = () => ['case', ['<=', denExpr(), 0], 0,
    hoverExpr(layer.paint.fillOpacityHover, layer.paint.fillOpacity)];

  map.addLayer(
    {
      id: fillId, type: 'fill', source: sourceId,
      layout: { visibility: startVisible ? 'visible' : 'none' },
      paint: {
        'fill-color': colorExpr(),
        'fill-opacity': startVisible ? opacityExpr() : 0,
        'fill-opacity-transition': { duration: FADE_MS }, 'fill-antialias': false,
      },
    },
    beforeId,
  );

  const controller = makeController(map, {
    layerIds: [fillId], sourceId, startVisible, card, clearHover,
    onShow: () => map.setPaintProperty(fillId, 'fill-opacity', opacityExpr()),
    onHide: () => map.setPaintProperty(fillId, 'fill-opacity', 0),
  });

  /*
   * Percentile bands over the CURRENT weighting.
   *
   * Fixed 0.2/0.4/… breaks were tried first and are wrong for this layer: as
   * weights move, the whole score distribution shifts, and a fixed ramp made the
   * map go uniformly pale or uniformly dark rather than showing where the high
   * cells were. Recomputing quintile breaks from the actual scores keeps the
   * ramp meaningful — the darkest band is always "the top fifth under THIS
   * weighting", which is the only reading the layer can honestly support.
   */
  /*
   * The rows come from the layer's `prepare` step, NOT from a second fetch.
   * Fetching the 2.3 MB file again here to compute the percentile bands
   * downloaded it twice — once by MapLibre for the source and once by this
   * renderer. `prepare` now fetches once and hands back both the parsed
   * FeatureCollection (used as the source data directly) and the property rows.
   */
  const rows = layer.rows ?? [];
  const recomputeBreaks = () => {
    if (!rows.length) return;
    const scores = [];
    for (const p of rows) {
      let num = 0, den = 0;
      for (const k of keys) {
        const v = p[k];
        if (v == null) continue;
        num += weights[k] * v; den += weights[k];
      }
      if (den > 0) scores.push(num / den);
    }
    if (!scores.length) return;
    scores.sort((a, b) => a - b);
    const q = (t) => scores[Math.min(scores.length - 1, Math.floor(scores.length * t))];
    const next = [q(0.2), q(0.4), q(0.6), q(0.8)];
    // Strictly increasing, or MapLibre rejects the step expression.
    for (let i = 1; i < next.length; i++) if (next[i] <= next[i - 1]) next[i] = next[i - 1] + 1e-6;
    breaks = next;
  };

  controller.getWeights = () => ({ ...weights });
  controller.getBreaks = () => [...breaks];
  controller.setWeights = (next) => {
    for (const k of keys) if (next[k] != null) weights[k] = Math.max(0, Number(next[k]) || 0);
    recomputeBreaks();
    map.setPaintProperty(fillId, 'fill-color', colorExpr());
    if (controller.isVisible()) map.setPaintProperty(fillId, 'fill-opacity', opacityExpr());
    layer.onWeights?.(controller.getWeights(), controller.getBreaks());
  };
  // Seed the bands from the real distribution, which is already in hand.
  controller.setWeights(weights);

  // Below every point marker but above the other broad washes.
  return { controller, queryLayers: [{ id: fillId, priority: 11 }], sourceId, bottomId: fillId };
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
function setupHover(map, card, registry, controllers, hover, clearHover, isSuppressed) {
  const accentFor = (layer) => palette[layer.accentVar] || palette.accent;

  const reset = () => {
    if (hover.current) clearHover();
    // Soft hide: link-bearing cards (marine) get a short grace period so the
    // pointer can travel onto the card to click "More info"; all others hide now.
    card.requestHide();
    map.getCanvas().style.cursor = '';
  };

  map.on('mousemove', (e) => {
    // A mode that owns the pointer (the site briefing's pin) suppresses cards
    // wholesale. reset() is the handler's own teardown, so nothing is left
    // hovered or half-shown behind it.
    if (isSuppressed?.()) return reset();
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

    // A layer whose dots deliberately sit close together (the marine species
    // markers, one per species per square) answers with ONE card listing
    // everything under the pointer, rather than whichever dot happened to win.
    // Re-queried over a small box, because "near" is the point — a dot nudged a
    // few pixels off is still the same square.
    if (entry.layer.collectCard) {
      const ids = new Set(active.filter((r) => r.layer === entry.layer).map((r) => r.queryId));
      const R = 9;
      const box = [
        [e.point.x - R, e.point.y - R],
        [e.point.x + R, e.point.y + R],
      ];
      const near = map.queryRenderedFeatures(box, { layers: [...ids] });
      const seen = new Set();
      const hits = [];
      for (const nf of near) {
        // One row per SPECIES, keyed on its map layer, not per dot.
        if (seen.has(nf.layer.id)) continue;
        seen.add(nf.layer.id);
        hits.push({ layerId: nf.layer.id, props: nf.properties || {} });
      }
      if (hits.length) {
        card.show(entry.layer.collectCard(hits), e.point, accentFor(entry.layer));
        return;
      }
    }

    card.show(entry.layer.card(f.properties || {}), e.point, accentFor(entry.layer));
  });

  map.on('mouseout', reset);
}
