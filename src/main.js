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
  document.getElementById('app').appendChild(panel);

  // Reveal the map once the first frame is painted — a calm fade-in.
  map.once('idle', () => document.body.classList.add('is-ready'));
});

map.on('error', (e) => {
  // Surface load issues (e.g. tiles or data) without breaking the page.
  console.error('[map]', e?.error?.message || e);
});
