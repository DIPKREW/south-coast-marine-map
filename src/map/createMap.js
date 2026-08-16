/**
 * Map construction: a MapLibre map with the bespoke editorial base style,
 * restrained interactions, and minimal palette-matched controls (zoom + scale).
 */
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { buildBaseStyle } from './mapStyle.js';

// Register the PMTiles protocol once, so vector sources can use pmtiles:// URLs
// (the CROME field-crops layer is served as a single .pmtiles archive).
// Exported so dataLayers.js can pre-register an in-memory PMTiles instance
// (Protocol.add) instead of letting the protocol fall back to range requests.
export const pmtilesProtocol = new Protocol();
maplibregl.addProtocol('pmtiles', pmtilesProtocol.tile);

// At min zoom the whole of Dorset (plus a margin) fills the viewport; the user
// cannot zoom out to a world view. maxZoom keeps the ~50 m square.
export const INITIAL_VIEW = {
  minZoom: 8,
  maxZoom: 20,
};

// Open framed on the whole county (the data now spans all of Dorset) — [SW, NE].
export const DORSET_FRAME = [
  [-2.99, 50.5],
  [-1.66, 51.1],
];

// Pan/zoom is bounded to Dorset plus a margin into the neighbouring counties
// (Devon, Somerset, Wiltshire, Hampshire) — [SW, NE]. The south edge reaches
// out to sea (50.30) so the offshore marine protected areas are fully viewable:
// the southernmost Dorset marine site (Lyme Bay and Torbay SAC / South of
// Portland MCZ) sits at ~50.354 after clipping to the coastal box.
export const MAX_BOUNDS = [
  [-3.5, 50.3],
  [-1.3, 51.3],
];

const ATTRIBUTION = [
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>',
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  'SSSI © <a href="https://naturalengland-defra.opendata.arcgis.com" target="_blank" rel="noopener">Natural England</a>',
  'Contains Dorset Council nature recovery data, <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" target="_blank" rel="noopener">Open Government Licence</a>',
  'DWT reserves: list © <a href="https://www.dorsetwildlifetrust.org.uk/nature-reserves" target="_blank" rel="noopener">Dorset Wildlife Trust</a>, boundaries © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  'ALC © Natural England (ADAS &amp; Defra)',
  'Crop Map of England © <a href="https://www.gov.uk/government/organisations/rural-payments-agency" target="_blank" rel="noopener">Rural Payments Agency</a> / <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" target="_blank" rel="noopener">OGL</a>',
  'Species data: <a href="https://nbnatlas.org" target="_blank" rel="noopener">NBN Atlas</a> contributors',
  'Marine data © <a href="https://naturalengland-defra.opendata.arcgis.com" target="_blank" rel="noopener">Natural England</a> / JNCC, OGL',
  'Coastal erosion © <a href="https://www.gov.uk/government/organisations/environment-agency" target="_blank" rel="noopener">Environment Agency</a>, OGL',
].join(' · ');

export function createMap(container) {
  const map = new maplibregl.Map({
    container,
    style: buildBaseStyle(),
    ...INITIAL_VIEW,
    bounds: DORSET_FRAME,
    fitBoundsOptions: { padding: 38 },
    maxBounds: MAX_BOUNDS,
    attributionControl: false,
    dragRotate: false, // keep north-up; calmer interactions
    pitchWithRotate: false,
    maxPitch: 0,
    fadeDuration: 200,
    // Crisp linework when zoomed past native tile depth.
    maxTileCacheSize: 512,
  });

  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation?.();

  // Zoom +/- only (no compass), top-right.
  map.addControl(new maplibregl.NavigationControl({ showCompass: false, showZoom: true }), 'top-right');

  // A quiet scale bar, bottom-left.
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 96, unit: 'metric' }), 'bottom-left');

  // Compact attribution, bottom-right.
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: ATTRIBUTION }), 'bottom-right');

  return map;
}
