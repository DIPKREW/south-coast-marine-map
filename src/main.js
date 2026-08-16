import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

import { applyTokens } from './design/tokens.js';
import { createMap } from './map/createMap.js';
import { applyDataLayers } from './map/dataLayers.js';
import { dataLayers, panelGroups } from './map/layers.js';
import { buildControlPanel } from './ui/controlPanel.js';

// Palette → CSS custom properties, so CSS and the map style share one source.
applyTokens();

const map = createMap(document.getElementById('map'));

// Dev-only handle for debugging / automated checks (absent in production builds).
if (import.meta.env.DEV) window.__map = map;

map.on('load', () => {
  const controllers = applyDataLayers(map, dataLayers);

  const panel = buildControlPanel({
    layers: dataLayers,
    groups: panelGroups,
    controllers,
    wordmark: 'South Coast Marine Recovery Map',
    tagline: "Marine protected areas from Land's End to Beachy Head",
  });
  document.getElementById('app').appendChild(panel.el);

  wireAutoCollapse(map, panel);

  // Reveal the map once the first frame is painted — a calm fade-in.
  map.once('idle', () => document.body.classList.add('is-ready'));
});

map.on('error', (e) => {
  // Surface load issues (e.g. tiles or data) without breaking the page.
  console.error('[map]', e?.error?.message || e);
});

/**
 * Get the panel out of the way the first time the person actually uses the map.
 *
 * Listens on the MAP CONTAINER, not the window: the panel is a sibling of #map,
 * so nothing inside it (layer toggles, About carets, the collapse chevron) can
 * reach these handlers. Programmatic camera moves — the opening fitBounds — never
 * fire them either, because these are DOM input events rather than map events.
 *   • pointerdown — a click on the canvas, the start of a drag, or a press on the
 *     +/- zoom buttons (they live inside the map container).
 *   • wheel       — scroll-wheel zoom.
 *   • click       — covers the +/- buttons activated from the keyboard, which
 *     never emit pointerdown.
 *
 * It fires AT MOST ONCE, and never after the person has worked the chevron
 * themselves. Re-collapsing on every later interaction would fight them the
 * moment they reopen the panel to change a layer, so once they've expressed a
 * preference — by reopening it, or by collapsing it by hand — the panel stays
 * where they put it.
 */
function wireAutoCollapse(map, panel) {
  const container = map.getContainer();
  let armed = true;

  // Manual use of the chevron hands control to the person for good.
  panel.onUserToggle(() => {
    armed = false;
  });

  const autoCollapse = (event) => {
    if (!armed) return;
    // The attribution control is map furniture, not the map itself.
    if (event.target instanceof Element && event.target.closest('.maplibregl-ctrl-attrib')) return;
    armed = false;
    panel.collapse();
  };

  container.addEventListener('pointerdown', autoCollapse, { capture: true });
  container.addEventListener('click', autoCollapse, { capture: true });
  container.addEventListener('wheel', autoCollapse, { capture: true, passive: true });
}
