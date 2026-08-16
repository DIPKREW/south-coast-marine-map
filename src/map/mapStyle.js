/**
 * The base map style — a custom, minimal MapLibre GL style built on the
 * OpenMapTiles vector schema served (keyless) by OpenFreeMap, recoloured to the
 * editorial palette. This bespoke style IS the look: a cream base, thin
 * charcoal linework, a whisper-grey harbour. No provider default styling.
 *
 * Data layers (e.g. SSSI) are NOT defined here — they are added on top from the
 * data-driven layer config (src/map/layers.js) so the base stays clean.
 */
import { palette } from '../design/tokens.js';

// Keyless OpenMapTiles vector tiles + matching glyph (font) endpoint.
const TILES = 'https://tiles.openfreemap.org/planet';
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

const FONT = ['Noto Sans Regular'];
const FONT_MEDIUM = ['Noto Sans Bold'];
const FONT_ITALIC = ['Noto Sans Italic'];

// Exponential zoom interpolation helper — keeps linework crisp across all zooms.
const lerp = (stops, base = 1.4) => [
  'interpolate',
  ['exponential', base],
  ['zoom'],
  ...stops.flat(),
];

export function buildBaseStyle() {
  return {
    version: 8,
    name: 'Dorset Nature — Editorial',
    glyphs: GLYPHS,
    sources: {
      openmaptiles: { type: 'vector', url: TILES },
    },
    layers: [
      // ---- Ground -------------------------------------------------------
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': palette.paper },
      },

      // Barely-there landcover (wood / heath / grass) for gentle texture.
      {
        id: 'landcover',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass', 'heath', 'scrub', 'wetland']]],
        paint: {
          'fill-color': palette.landcover,
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.4, 12, 0.6, 15, 0.45],
          'fill-antialias': true,
        },
      },
      {
        id: 'park',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'park',
        paint: { 'fill-color': palette.landcover, 'fill-opacity': 0.5 },
      },

      // ---- Water --------------------------------------------------------
      {
        id: 'water',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'water',
        filter: ['!=', ['get', 'intermittent'], 1],
        paint: { 'fill-color': palette['basemap-water'] },
      },
      {
        id: 'water-coastline',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'water',
        paint: {
          'line-color': palette['basemap-water-line'],
          'line-width': lerp([[6, 0.5], [12, 0.8], [16, 1.1]]),
        },
      },
      {
        id: 'waterway',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'waterway',
        paint: {
          'line-color': palette['basemap-water-line'],
          'line-width': lerp([[10, 0.4], [14, 0.9], [18, 1.6]]),
          'line-opacity': 0.9,
        },
      },

      // ---- Roads (thin charcoal linework) -------------------------------
      // Paths & tracks — the lightest hairlines, only as you zoom in.
      {
        id: 'road-path',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['path', 'footway', 'pedestrian', 'cycleway', 'track', 'steps']]],
        minzoom: 14,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': palette['ink-muted'],
          'line-dasharray': [2, 2.5],
          'line-width': lerp([[14, 0.4], [18, 1.0]]),
          'line-opacity': 0.5,
        },
      },
      // Minor / residential / service roads.
      {
        id: 'road-minor',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'road']]],
        minzoom: 12,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': palette['ink-muted'],
          'line-width': lerp([[12, 0.3], [15, 0.8], [18, 2.4], [20, 4]]),
          'line-opacity': 0.7,
        },
      },
      // Secondary / tertiary.
      {
        id: 'road-secondary',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['secondary', 'tertiary']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': palette.ink,
          'line-width': lerp([[8, 0.4], [12, 0.9], [16, 2.4], [20, 6]]),
          'line-opacity': 0.55,
        },
      },
      // Major — motorway / trunk / primary.
      {
        id: 'road-major',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': palette.ink,
          'line-width': lerp([[6, 0.5], [10, 1.2], [14, 2.6], [18, 6], [20, 10]]),
          'line-opacity': 0.7,
        },
      },
      // Rail — a fine dashed hairline.
      {
        id: 'rail',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['==', ['get', 'class'], 'rail'],
        minzoom: 11,
        paint: {
          'line-color': palette['ink-muted'],
          'line-width': lerp([[11, 0.5], [18, 1.4]]),
          'line-dasharray': [3, 2],
          'line-opacity': 0.5,
        },
      },

      // ---- Buildings (faint, close in) ----------------------------------
      {
        id: 'building',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 15,
        paint: {
          'fill-color': '#EAE3D5',
          'fill-outline-color': palette.hairline,
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 16, 0.7],
        },
      },

      // ---- Administrative boundaries (dashed, restrained) ---------------
      {
        id: 'boundary',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'boundary',
        filter: ['all', ['<=', ['get', 'admin_level'], 6], ['!=', ['get', 'maritime'], 1]],
        layout: { 'line-join': 'round' },
        paint: {
          'line-color': palette['ink-muted'],
          'line-dasharray': [3, 2.5],
          'line-width': lerp([[6, 0.4], [10, 0.7], [14, 1.1]]),
          'line-opacity': 0.45,
        },
      },

      // ---- Labels -------------------------------------------------------
      // Water bodies — quiet italic.
      {
        id: 'label-water',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'water_name',
        layout: {
          'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
          'text-font': FONT_ITALIC,
          'text-size': lerp([[10, 11], [16, 14]]),
          'text-max-width': 6,
          'text-letter-spacing': 0.04,
        },
        paint: {
          'text-color': palette['ink-muted'],
          'text-halo-color': palette['basemap-water'],
          'text-halo-width': 1.2,
        },
      },
      // Places — villages, towns, the city of Poole/Bournemouth.
      {
        id: 'label-place-small',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        filter: ['in', ['get', 'class'], ['literal', ['village', 'hamlet', 'suburb', 'neighbourhood']]],
        minzoom: 11,
        layout: {
          'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
          'text-font': FONT,
          'text-size': lerp([[11, 10.5], [16, 13]]),
          'text-max-width': 7,
          'text-letter-spacing': 0.02,
          'text-padding': 6,
        },
        paint: {
          'text-color': palette['ink-muted'],
          'text-halo-color': palette.paper,
          'text-halo-width': 1.4,
        },
      },
      {
        id: 'label-place-large',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        filter: ['in', ['get', 'class'], ['literal', ['city', 'town']]],
        layout: {
          'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
          'text-font': FONT_MEDIUM,
          'text-size': lerp([[7, 11], [12, 15], [16, 19]]),
          'text-max-width': 7,
          'text-letter-spacing': 0.02,
          'text-padding': 8,
        },
        paint: {
          'text-color': palette.ink,
          'text-halo-color': palette.paper,
          'text-halo-width': 1.6,
        },
      },
    ],
  };
}
