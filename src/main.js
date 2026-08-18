import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';

import { applyTokens } from './design/tokens.js';
import { createMap } from './map/createMap.js';
import { applyDataLayers } from './map/dataLayers.js';
import { dataLayers, panelGroups } from './map/layers.js';
import { buildControlPanel } from './ui/controlPanel.js';
import { buildDetailPanel } from './ui/detailPanel.js';

// Palette → CSS custom properties, so CSS and the map style share one source.
applyTokens();

const map = createMap(document.getElementById('map'));

// Dev-only handle for debugging / automated checks (absent in production builds).
if (import.meta.env.DEV) window.__map = map;

map.on('load', () => {
  const controllers = applyDataLayers(map, dataLayers);

  const detail = buildDetailPanel({ layers: dataLayers, groups: panelGroups, controllers });

  // Held in a variable rather than closed over directly: a layer whose data is
  // already cached can call back synchronously while buildControlPanel is still
  // running, which would otherwise reach `panel` before it is assigned.
  let panelHandle = null;
  const syncDetail = () => detail.sync({ collapsed: panelHandle?.isCollapsed() ?? false });

  const panel = buildControlPanel({
    layers: dataLayers,
    groups: panelGroups,
    controllers,
    wordmark: 'South Coast Marine Recovery Map',
    tagline: "Marine protected areas from Land's End to Beachy Head",
    // Fires on every toggle, on collapse/expand, and when a late-loading layer
    // becomes ready or unavailable — everything the detail panel reacts to.
    onChange: syncDetail,
  });
  panelHandle = panel;

  // The detail panel is mounted BEFORE the control panel so it stacks beneath
  // it: while hidden it sits tucked behind the main panel, and slides out to the
  // right from there.
  const app = document.getElementById('app');
  app.append(detail.el, panel.el);

  syncDetail();

  wireAutoCollapse(map, panel);

  // Reveal the map once the first frame is painted — a calm fade-in.
  map.once('idle', () => document.body.classList.add('is-ready'));
});

map.on('error', (e) => {
  // Surface load issues (e.g. tiles or data) without breaking the page.
  console.error('[map]', e?.error?.message || e);
});

/**
 * Get the panel out of the way whenever the person actually uses the map.
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
 * There is no arming flag: the panel's own state is the arming. Expanded means
 * the next map interaction collapses it; collapsed means these handlers are a
 * no-op. Reopening it — by chevron, after an auto-collapse or a manual one —
 * therefore re-arms the behaviour every time, indefinitely.
 *
 * The PIN suspends only this. It is checked here, at the top of the handler,
 * rather than by detaching the listeners: unpinning then needs no re-wiring, and
 * the chevron keeps working while pinned because it never went through here.
 */
function wireAutoCollapse(map, panel) {
  const container = map.getContainer();

  const autoCollapse = (event) => {
    if (panel.isPinned()) return;
    if (panel.isCollapsed()) return;
    // The attribution control is map furniture, not the map itself.
    if (event.target instanceof Element && event.target.closest('.maplibregl-ctrl-attrib')) return;
    panel.collapse();
  };

  container.addEventListener('pointerdown', autoCollapse, { capture: true });
  container.addEventListener('click', autoCollapse, { capture: true });
  container.addEventListener('wheel', autoCollapse, { capture: true, passive: true });
}
