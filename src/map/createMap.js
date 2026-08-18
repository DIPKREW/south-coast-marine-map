/**
 * Map construction: a MapLibre map with the bespoke editorial base style,
 * restrained interactions, and minimal palette-matched controls (zoom + scale).
 */
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { buildBaseStyle } from './mapStyle.js';
import { SHOW_DORSET_LAND_LAYERS } from './layers.js';

// Register the PMTiles protocol once, so vector sources can use pmtiles:// URLs
// (the CROME field-crops layer is served as a single .pmtiles archive).
// Exported so dataLayers.js can pre-register an in-memory PMTiles instance
// (Protocol.add) instead of letting the protocol fall back to range requests.
export const pmtilesProtocol = new Protocol();
maplibregl.addProtocol('pmtiles', pmtilesProtocol.tile);

// At min zoom the whole project coastline (plus a margin) fills the viewport;
// the user cannot zoom out to a world view. maxZoom keeps the ~50 m square.
//
// minZoom was 8 for the single-county Dorset map. The project area is now ~6.7°
// of longitude wide (Land's End to Beachy Head), which does not fit on a typical
// viewport at z8, so it drops to 6.5. maxBounds still stops any wider zoom-out.
// Per-LAYER minzoom values (e.g. CROME at z11) are untouched.
export const INITIAL_VIEW = {
  minZoom: 6.5,
  maxZoom: 20,
};

// Open framed on the whole South Coast project coastline — [SW, NE].
export const SOUTH_COAST_FRAME = [
  [-6.2, 49.85],
  [0.7, 51.0],
];

// Pan/zoom is bounded to the South Coast Marine Recovery Project coastline plus
// a margin — [SW, NE]. It must contain the full extent of the fetched marine
// data, which after clipping is:
//   W -6.099 (Cape Bank MCZ)          E  0.572 (Beachy Head East MCZ)
//   S  49.896 (Lizard Point SAC)      N 50.938 (Solent & Southampton Water SPA)
//
// The LATITUDE span is deliberately much taller than the data (3.3° for 1.0° of
// data). maxBounds constrains the camera on BOTH axes, so a box only as tall as
// the data would cap the zoom-out before the full 6.7°-wide coastline could fit
// on screen — Land's End would sit off the west edge with no way to zoom out.
// A 16:10 viewport needs roughly `lonSpan × 0.625 × cos(50°) ≈ 3.2°` of latitude
// headroom to show the whole width at once, so the box is sized to that.
export const MAX_BOUNDS = [
  [-6.7, 48.8],
  [1.2, 52.1],
];

// Credits for the Dorset land layers. Kept alongside those layers behind
// SHOW_DORSET_LAND_LAYERS, so the attribution bar only ever credits sources the
// map is actually drawing.
const DORSET_LAND_ATTRIBUTION = [
  'SSSI © <a href="https://naturalengland-defra.opendata.arcgis.com" target="_blank" rel="noopener">Natural England</a>',
  'Contains Dorset Council nature recovery data, <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" target="_blank" rel="noopener">Open Government Licence</a>',
  'DWT reserves: list © <a href="https://www.dorsetwildlifetrust.org.uk/nature-reserves" target="_blank" rel="noopener">Dorset Wildlife Trust</a>, boundaries © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  'ALC © Natural England (ADAS &amp; Defra)',
  'Crop Map of England © <a href="https://www.gov.uk/government/organisations/rural-payments-agency" target="_blank" rel="noopener">Rural Payments Agency</a> / <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" target="_blank" rel="noopener">OGL</a>',
];

const ATTRIBUTION = [
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>',
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  ...(SHOW_DORSET_LAND_LAYERS ? DORSET_LAND_ATTRIBUTION : []),
  'Marine data © <a href="https://naturalengland-defra.opendata.arcgis.com" target="_blank" rel="noopener">Natural England</a> / JNCC, OGL',
  'Coastal erosion © <a href="https://www.gov.uk/government/organisations/environment-agency" target="_blank" rel="noopener">Environment Agency</a>, OGL',
  'Storm overflow annual returns (EDM) &amp; WFD water body status © <a href="https://environment.data.gov.uk" target="_blank" rel="noopener">Environment Agency</a>, OGL',
  'Live discharge status © the water companies via <a href="https://www.streamwaterdata.co.uk" target="_blank" rel="noopener">Stream</a> / <a href="https://www.water.org.uk" target="_blank" rel="noopener">Water UK</a>',
  'Seabed habitats: UKSeaMap © <a href="https://jncc.gov.uk" target="_blank" rel="noopener">JNCC</a> via <a href="https://emodnet.ec.europa.eu/en/seabed-habitats" target="_blank" rel="noopener">EMODnet Seabed Habitats</a>',
  // NBN is credited unconditionally: the MARINE species layer uses it and is not
  // governed by SHOW_DORSET_LAND_LAYERS, unlike the land species grid.
  'Species records: <a href="https://nbnatlas.org" target="_blank" rel="noopener">NBN Atlas</a> contributors',
  'Vessel density (2015 AIS) © <a href="https://www.gov.uk/government/organisations/marine-management-organisation" target="_blank" rel="noopener">MMO</a> &amp; MCA, OGL — © British Crown copyright',
  'Marine licensing &amp; disposal grounds © <a href="https://www.gov.uk/government/organisations/marine-management-organisation" target="_blank" rel="noopener">MMO</a> / <a href="https://www.cefas.co.uk" target="_blank" rel="noopener">Cefas</a>, OGL',
  // The source's own required credit line for the VMS heatmap, which carries
  // more contributors than the MMO alone.
  'Fishing activity (VMS 2019–2022) © <a href="https://www.gov.uk/government/organisations/marine-management-organisation" target="_blank" rel="noopener">MMO</a>, DTU Aqua, JNCC, Natural England &amp; UKHO, OGL — © British Crown copyright',
  'Wrecks © <a href="https://datahub.admiralty.co.uk" target="_blank" rel="noopener">UK Hydrographic Office</a>, OGL — not for navigation',
  'Protected wreck sites © <a href="https://historicengland.org.uk" target="_blank" rel="noopener">Historic England</a>, OGL',
].join(' · ');

export function createMap(container) {
  const map = new maplibregl.Map({
    container,
    style: buildBaseStyle(),
    ...INITIAL_VIEW,
    bounds: SOUTH_COAST_FRAME,
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
