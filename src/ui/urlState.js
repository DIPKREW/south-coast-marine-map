/**
 * SHAREABLE MAP STATE IN THE URL.
 *
 * Any view can be copied as a link and reopened exactly. What is encoded is the
 * CONTENT of the view — where you are looking, which layers are on, which
 * species are ticked, how the compound pressure sliders are set. What is
 * deliberately NOT encoded is the panel's own state: pinned, collapsed, which
 * About sections are open. That is a UI preference rather than something the map
 * is showing, and it is device-contextual — restoring a laptop sender's panel
 * layout onto a phone recipient's screen helps nobody.
 *
 * ONLY DEVIATIONS FROM DEFAULT ARE WRITTEN. A link to the default view carries
 * no query string at all. Rivers & waterways is the one layer that starts on, so
 * it only ever appears in the URL when it has been switched OFF.
 *
 *   v    viewport, "zoom/lat/lon"          v=9.42/50.6210/-2.6104
 *   l    default-OFF layers now ON         l=wrecks,compound
 *   off  default-ON layers now OFF         off=water
 *   sp   marine species ticked             sp=greyseal,porpoise
 *   w    slider weights that are not 1     w=s:3,f:0
 *
 * Keys are layer IDs, species keys and pressure keys — never display labels — so
 * renaming a layer in the panel cannot break links that are already out there.
 */

const ZOOM_DP = 2;
const LATLON_DP = 4; // ~11 m, ample for sharing a view
const WEIGHT_MIN = 0;
const WEIGHT_MAX = 3;

const round = (v, dp) => Number(v.toFixed(dp));
const warn = (msg) => console.warn(`[url] ${msg}`);

/** Layers whose ticked species / weights we know how to serialise. */
const speciesLayer = (layers, controllers) =>
  layers.find((l) => l.species && controllers.get(l.id)?.checkedKeys);
const weightLayer = (layers, controllers) =>
  layers.find((l) => l.pressures && controllers.get(l.id)?.getWeights);

/* ------------------------------------------------------------------ read --- */

export function readUrlState() {
  const q = new URLSearchParams(window.location.search);
  const list = (k) => (q.get(k) ? q.get(k).split(',').map((s) => s.trim()).filter(Boolean) : null);

  let view = null;
  if (q.get('v')) {
    const [z, lat, lon] = q.get('v').split('/').map(Number);
    if ([z, lat, lon].every(Number.isFinite) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      view = { zoom: z, center: [lon, lat] };
    } else {
      warn(`ignoring malformed viewport "${q.get('v')}"`);
    }
  }

  let weights = null;
  if (q.get('w')) {
    weights = {};
    for (const pair of q.get('w').split(',')) {
      const [k, raw] = pair.split(':');
      const v = Number(raw);
      if (!k || !Number.isFinite(v)) { warn(`ignoring malformed weight "${pair}"`); continue; }
      // Out-of-range values are CLAMPED rather than dropped: an old link with a
      // weight of 9 still expresses "as heavy as possible", which is closer to
      // the sender's intent than discarding it.
      if (v < WEIGHT_MIN || v > WEIGHT_MAX) warn(`weight ${k}=${v} out of range, clamping`);
      weights[k] = Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, v));
    }
  }

  return { view, on: list('l'), off: list('off'), species: list('sp'), weights };
}

/* --------------------------------------------------------------- restore --- */

/**
 * Apply parsed state. Every step is independently guarded: one bad id must not
 * stop the rest of the link from restoring, and must never leave the map half
 * built. Anything unrecognised is warned about and skipped.
 */
export function applyUrlState(state, { map, layers, controllers }) {
  if (!state) return;

  if (state.view) {
    map.jumpTo({ center: state.view.center, zoom: state.view.zoom });
  }

  const known = new Set(layers.map((l) => l.id));
  for (const [ids, want] of [[state.on, true], [state.off, false]]) {
    for (const id of ids ?? []) {
      if (!known.has(id)) { warn(`unknown layer "${id}" ignored`); continue; }
      const c = controllers.get(id);
      if (!c) { warn(`layer "${id}" has no controller, ignored`); continue; }
      // show() drives the normal lazy-load path, exactly as a click would.
      try { want ? c.show() : c.hide(); } catch (e) { warn(`could not set "${id}": ${e.message}`); }
    }
  }

  if (state.species?.length) {
    const sl = speciesLayer(layers, controllers);
    const c = sl && controllers.get(sl.id);
    if (!c) warn('species selection in URL but no species layer present');
    else {
      const valid = new Set(sl.species.map((s) => s.key));
      for (const key of state.species) {
        if (!valid.has(key)) { warn(`unknown species "${key}" ignored`); continue; }
        try { c.setChecked(key, true); } catch (e) { warn(`could not tick "${key}": ${e.message}`); }
      }
    }
  }

  if (state.weights) {
    const wl = weightLayer(layers, controllers);
    const c = wl && controllers.get(wl.id);
    if (!c) warn('weights in URL but no weighted layer present');
    else {
      const valid = new Set(wl.pressures.map((p) => p.key));
      const next = {};
      for (const [k, v] of Object.entries(state.weights)) {
        if (!valid.has(k)) { warn(`unknown pressure "${k}" ignored`); continue; }
        next[k] = v;
      }
      if (Object.keys(next).length) c.setWeights(next);
    }
  }
}

/* ------------------------------------------------------------------ write --- */

export function buildUrl({ map, layers, controllers, home }) {
  const q = new URLSearchParams();

  // Viewport only if it has actually moved off the opening frame.
  const c = map.getCenter();
  const z = map.getZoom();
  const moved =
    !home ||
    Math.abs(z - home.zoom) > 0.01 ||
    Math.abs(c.lat - home.center[1]) > 1e-4 ||
    Math.abs(c.lng - home.center[0]) > 1e-4;
  if (moved) q.set('v', `${round(z, ZOOM_DP)}/${round(c.lat, LATLON_DP)}/${round(c.lng, LATLON_DP)}`);

  const on = [], off = [];
  for (const l of layers) {
    const ctl = controllers.get(l.id);
    if (!ctl) continue;
    const visible = ctl.isVisible();
    const def = l.defaultVisible !== false;
    if (visible && !def) on.push(l.id);
    if (!visible && def) off.push(l.id);
  }
  if (on.length) q.set('l', on.join(','));
  if (off.length) q.set('off', off.join(','));

  const sl = speciesLayer(layers, controllers);
  if (sl) {
    const ticked = controllers.get(sl.id).checkedKeys();
    if (ticked.length) q.set('sp', ticked.join(','));
  }

  const wl = weightLayer(layers, controllers);
  if (wl) {
    const w = controllers.get(wl.id).getWeights();
    const skew = Object.entries(w)
      .filter(([, v]) => Math.abs(v - 1) > 1e-9)
      .map(([k, v]) => `${k}:${round(v, 2)}`);
    if (skew.length) q.set('w', skew.join(','));
  }

  const qs = q.toString();
  // Decoded for readability — commas and slashes are legal in a query value and
  // percent-encoding them only makes the link uglier to paste around.
  const pretty = qs ? `?${qs.replace(/%2C/g, ',').replace(/%2F/g, '/').replace(/%3A/g, ':')}` : '';
  return `${window.location.origin}${window.location.pathname}${pretty}`;
}

/**
 * Keep the address bar in step with the map.
 *
 * replaceState, never pushState: panning the map or dragging a slider must not
 * fill the back button with dozens of intermediate views. And the write is
 * debounced, so a continuous gesture produces one URL update when it settles
 * rather than one per frame.
 */
export function wireUrlState({ map, layers, controllers, home, delay = 350 }) {
  let timer = null;
  const update = () => {
    const url = buildUrl({ map, layers, controllers, home });
    if (url !== window.location.href) window.history.replaceState(null, '', url);
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(update, delay);
  };
  map.on('moveend', schedule);
  update();
  return { schedule, update, current: () => buildUrl({ map, layers, controllers, home }) };
}
