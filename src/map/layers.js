/**
 * Data layer config — the registry that drives BOTH the map and the control
 * panel. Adding a future layer means appending an object here and dropping its
 * GeoJSON in /public/data; nothing else needs rewriting.
 *
 * Array order is priority order, top-first: the first entry draws ON TOP and
 * wins the hover where features overlap; later entries are drawn beneath it as
 * softer context. So the specific DWT layers sit above the broad SSSI / HONA
 * washes, and the visitor-centre markers sit above everything.
 *
 * Each entry:
 *   id            unique string (also used to derive source/layer ids)
 *   label         human label shown in the panel toggle
 *   description   one-liner under the label
 *   group         panel grouping heading
 *   kind          render strategy: 'polygon' | 'point'
 *   data          URL to a GeoJSON FeatureCollection (served from /public)
 *   accentVar     palette token (without `--`) for the toggle + card accent
 *   defaultVisible whether the layer starts on
 *   paint         palette-driven paint values (see dataLayers.js)
 *   card          (props) => { title, subtitle?, meta?, note? } for the hover card
 */
import { palette } from '../design/tokens.js';

const base = import.meta.env.BASE_URL;

// Curated flagship species for the NBN Atlas grid (key matches build-species.mjs).
const SPECIES = [
  { key: 'sandlizard', common: 'Sand lizard', sci: 'Lacerta agilis' },
  { key: 'smoothsnake', common: 'Smooth snake', sci: 'Coronella austriaca' },
  { key: 'ssblue', common: 'Silver-studded blue', sci: 'Plebejus argus' },
  { key: 'ladybirdspider', common: 'Ladybird spider', sci: 'Eresus sandaliatus' },
  { key: 'dartford', common: 'Dartford warbler', sci: 'Curruca undata' },
  { key: 'nightjar', common: 'Nightjar', sci: 'Caprimulgus europaeus' },
  { key: 'gcnewt', common: 'Great crested newt', sci: 'Triturus cristatus' },
  { key: 'lulworth', common: 'Lulworth skipper', sci: 'Thymelicus acteon' },
];
const SPECIES_BY_KEY = new Map(SPECIES.map((s) => [s.key, s]));

// Marine designation type → full label; Natural England Designated Sites View
// gives a canonical per-site page keyed on the site code (works for MCZ/SAC/SPA).
const MARINE_TYPE = {
  MCZ: 'Marine Conservation Zone',
  SAC: 'Special Area of Conservation',
  SPA: 'Special Protection Area',
};
const DSV = 'https://designatedsites.naturalengland.org.uk/SiteDetail.aspx?SiteCode=';

// Coastal erosion risk bands (NCERM recession-distance classes).
const EROSION_LABEL = ['Negligible', 'Low', 'Moderate', 'High', 'Very high'];

// Format a hectare value tidily (no trailing ".0", thousands separators).
const ha = (v) =>
  v == null || Number.isNaN(Number(v))
    ? null
    : `${Number(v).toLocaleString('en-GB', { maximumFractionDigits: 1 })} ha`;

export const dataLayers = [
  {
    id: 'centres',
    label: 'DWT visitor centres',
    description: 'Places to visit',
    group: 'Dorset Wildlife Trust',
    kind: 'point',
    data: `${base}data/dwt-centres.geojson`,
    accentVar: 'accent-4',
    defaultVisible: true,
    paint: {
      color: palette['accent-4'],
      strokeColor: palette.surface,
      radius: 5,
      radiusHover: 7,
      labelMinZoom: 11,
    },
    card: (p) => ({
      title: p.name,
      subtitle: 'Dorset Wildlife Trust visitor centre',
      note: p.description || null,
    }),
  },
  {
    id: 'reserves',
    label: 'Dorset Wildlife Trust reserves',
    description: 'Nature reserves',
    group: 'Dorset Wildlife Trust',
    // Mixed geometry: shaded polygons where a boundary is matched, small markers
    // elsewhere — both from one source, under one toggle.
    kind: 'mixed',
    data: `${base}data/dwt-reserves.geojson`,
    accentVar: 'accent-3',
    defaultVisible: true,
    paint: {
      fillColor: palette['accent-3'],
      fillOpacity: 0.13,
      fillOpacityHover: 0.26,
      lineColor: palette['accent-3-strong'],
      lineWidth: 1.3,
      lineWidthHover: 2.4,
    },
    // Subordinate slate markers — smaller than the gold visitor-centre dots.
    markerPaint: {
      color: palette['accent-3'],
      strokeColor: palette.surface,
      radius: 3.6,
      radiusHover: 5.2,
    },
    card: (p) =>
      p.area_ha != null
        ? { title: p.name, subtitle: 'Dorset Wildlife Trust nature reserve', meta: ha(p.area_ha) }
        : { title: p.name, subtitle: 'Dorset Wildlife Trust nature reserve' },
  },
  {
    id: 'sssi',
    label: 'Sites of Special Scientific Interest',
    description: 'Natural England designated areas',
    group: 'Designations',
    kind: 'polygon',
    data: `${base}data/sssi.geojson`,
    accentVar: 'accent',
    defaultVisible: true,
    paint: {
      fillColor: palette.accent,
      fillOpacity: 0.15,
      fillOpacityHover: 0.28,
      lineColor: palette.accent,
      lineWidth: 1.2,
      lineWidthHover: 2.2,
    },
    card: (p) => ({
      title: p.NAME || 'Site of Special Scientific Interest',
      subtitle: 'Site of Special Scientific Interest',
      meta: ha(p.MEASURE),
    }),
  },
  {
    id: 'hona',
    label: 'High Opportunity Nature Areas',
    description: 'Dorset Local Nature Recovery Strategy',
    group: 'Designations',
    kind: 'polygon',
    data: `${base}data/hona.geojson`,
    accentVar: 'accent-2',
    defaultVisible: true,
    paint: {
      fillColor: palette['accent-2'],
      fillOpacity: 0.12,
      fillOpacityHover: 0.22,
      lineColor: palette['accent-2-strong'],
      lineWidth: 0.9,
      lineWidthHover: 1.8,
    },
    card: (p) => ({
      title: 'High Opportunity Nature Area',
      meta: ha(p.area_ha),
      note: 'Dorset LNRS — targeted for nature recovery.',
    }),
  },
  {
    id: 'water',
    label: 'Rivers & waterways',
    description: 'Rivers, streams and water bodies',
    group: 'Water',
    // Watercourse LINES (water.geojson) + EXACTLY TWO named water-body FILLS
    // (water-bodies-named.geojson: The Fleet + Poole Harbour). No broad water-body
    // category — see addWaterwaysLayer. Last in the array so it draws at the
    // bottom of the thematic stack.
    kind: 'waterways',
    data: `${base}data/water.geojson`,
    bodiesData: `${base}data/water-bodies-named.geojson`,
    accentVar: 'water',
    defaultVisible: true,
    card: (p) => {
      const types = { river: 'River', stream: 'Stream', canal: 'Canal', ditch: 'Ditch', drain: 'Drain' };
      const type = types[p.wtype]; // line types carry wtype; water bodies are wtype 'water'
      if (type) return p.name ? { title: p.name, subtitle: type } : { title: type };
      return p.name ? { title: p.name, subtitle: 'Water' } : { title: 'Water' };
    },
  },
  {
    id: 'marine',
    label: 'Marine protected areas',
    description: 'MCZs, marine SACs & SPAs',
    group: 'At sea',
    // OUTLINED areas (faint fill + type-styled outlines) so heavy overlaps stay
    // legible. Offshore + coastal; clipped to the seaward coastal box, not the
    // land mask. Default OFF.
    kind: 'marine',
    data: `${base}data/marine.geojson`,
    field: 'mtype',
    accentVar: 'marine',
    defaultVisible: false,
    paint: { fillOpacity: 0.1, fillOpacityHover: 0.22, lineWidth: 1.2, lineWidthHover: 2.6 },
    legend: [
      { label: 'Marine Conservation Zone — solid', colorVar: 'marine' },
      { label: 'Special Area of Conservation — dashed', colorVar: 'marine' },
      { label: 'Special Protection Area — dotted', colorVar: 'marine' },
    ],
    about: {
      title: 'About marine protected areas',
      body: [
        "Dorset's seas hold a network of protected areas — Marine Conservation Zones, marine Special Areas of Conservation and Special Protection Areas. They protect habitats from the seagrass meadows of Studland Bay, home to native seahorses, to the recovering reefs of Lyme Bay — one of the country's flagship marine protected areas, where damaging bottom-trawling has been excluded since 2008.",
      ],
    },
    card: (p) => ({
      title: p.name || 'Marine protected area',
      subtitle: MARINE_TYPE[p.mtype] || 'Marine protected area',
      link: { href: p.code ? DSV + p.code : 'https://designatedsites.naturalengland.org.uk/', label: 'More info ↗' },
    }),
  },
  {
    id: 'ncerm',
    label: 'Coastal erosion risk',
    description: 'Shoreline vulnerability',
    group: 'At sea',
    // Coastal frontage strips coloured by banded recession-distance risk (NCERM,
    // No Future Intervention to 2055). Default OFF.
    kind: 'erosion',
    data: `${base}data/ncerm.geojson`,
    field: 'risk',
    accentVar: 'erosion-3',
    defaultVisible: false,
    paint: {
      colors: {
        0: palette['erosion-0'], 1: palette['erosion-1'], 2: palette['erosion-2'],
        3: palette['erosion-3'], 4: palette['erosion-4'],
      },
      fillOpacity: 0.72,
      fillOpacityHover: 0.9,
    },
    legend: [
      { label: 'Negligible', colorVar: 'erosion-0' },
      { label: 'Low', colorVar: 'erosion-1' },
      { label: 'Moderate', colorVar: 'erosion-2' },
      { label: 'High', colorVar: 'erosion-3' },
      { label: 'Very high', colorVar: 'erosion-4' },
    ],
    about: {
      title: 'About coastal erosion risk',
      body: [
        "The Environment Agency's mapping of how vulnerable each stretch of Dorset's coast is to erosion — fitting for a coastline, like the Jurassic Coast, shaped by constant change.",
        'Shown for the "no future intervention" scenario — how far the shore could recede by 2055 if defences were not maintained — so it reads as inherent vulnerability, not a forecast of what will happen.',
      ],
    },
    card: (p) => ({
      title: `${EROSION_LABEL[p.risk] ?? 'Unknown'} erosion risk`,
      subtitle: 'Projected shoreline recession by 2055',
      meta: p.dist != null ? `≈ ${p.dist} m, no future intervention` : null,
    }),
  },
  {
    id: 'species',
    label: 'Notable species (NBN Atlas)',
    description: 'Flagship species, recorded by grid square',
    group: 'Species',
    // A coarse GRID overlay (never pinpoints) of curated flagship species, one
    // species shown at a time via a selector. Drawn above the land washes, below
    // the site overlays. Default OFF (exploratory).
    kind: 'speciesgrid',
    data: `${base}data/species-grid.geojson`,
    field: 'sp',
    species: SPECIES,
    defaultSpecies: 'sandlizard',
    accentVar: 'species',
    defaultVisible: false,
    paint: { fillOpacity: 0.45, fillOpacityHover: 0.78 },
    legend: [
      { label: 'Recorded here (grid square)', colorVar: 'species' },
      { label: 'More records — slightly stronger', colorVar: 'species-strong' },
    ],
    about: {
      title: 'About notable species',
      body: [
        "These are records of some of Dorset's flagship species, drawn from the NBN Atlas. They're shown by grid square, not exact location — both because the data is recorded at coarse resolution and because sensitive species are deliberately blurred to protect them. A shaded square means the species has been recorded in that area, not that it's only there. Records also reflect where people have surveyed, so blank areas may be under-recorded rather than empty.",
      ],
    },
    card: (p) => {
      const s = SPECIES_BY_KEY.get(p.sp);
      const name = s ? `${s.common} (${s.sci})` : 'Notable species';
      return { title: name, subtitle: 'recorded in this area · NBN Atlas' };
    },
  },
  {
    id: 'crome',
    label: 'Field crops (CROME)',
    description: "What's growing, by field — 2024",
    group: 'Land',
    // Field-level land USE (Crop Map of England 2024). Dissolved field blocks as
    // vector tiles, gated to close zoom (z11+). Default OFF.
    kind: 'croptiles',
    data: `${base}data/crome.pmtiles`,
    sourceLayer: 'crome',
    field: 'cat',
    minzoom: 11,
    accentVar: 'crome-grass',
    defaultVisible: false,
    paint: {
      colors: {
        cereals: palette['crome-cereals'], oilseed: palette['crome-oilseed'], rootmaize: palette['crome-rootmaize'],
        grass: palette['crome-grass'], trees: palette['crome-trees'], other: palette['crome-other'],
      },
      fillOpacity: 0.6,
      fillOpacityHover: 0.78,
    },
    legend: [
      { label: 'Cereals', colorVar: 'crome-cereals' },
      { label: 'Oilseed & break crops', colorVar: 'crome-oilseed' },
      { label: 'Maize & root crops', colorVar: 'crome-rootmaize' },
      { label: 'Grassland', colorVar: 'crome-grass' },
      { label: 'Woodland & trees', colorVar: 'crome-trees' },
      { label: 'Other / non-agricultural', colorVar: 'crome-other' },
    ],
    about: {
      title: 'About field crops (CROME)',
      body: [
        'The Crop Map of England shows what was growing in each field, classified from satellite imagery by the Rural Payments Agency for 2024. Zoom in to explore it field by field. Unlike the land-quality grading, this shows actual land use — and the contrast between intensive arable and grassland is part of the nature-recovery picture.',
      ],
    },
    card: (p) => {
      const labels = {
        cereals: 'Cereals', oilseed: 'Oilseed & break crops', rootmaize: 'Maize & root crops',
        grass: 'Grassland', trees: 'Woodland & trees', other: 'Other / non-agricultural',
      };
      return { title: labels[p.cat] || 'Field crop', subtitle: 'Field crops (CROME) 2024' };
    },
  },
  {
    id: 'alc',
    label: 'Agricultural land classification',
    description: 'Farmland quality, Grade 1–5',
    group: 'Land',
    // A graded EARTH wash at the BOTTOM of the stack (LAST in the array). Two
    // sources under one toggle: the coarse PROVISIONAL wash (data) + the detailed
    // POST-1988 resurvey (detailData, finer 3a/3b) drawn on top where it exists.
    // Default OFF.
    kind: 'choropleth',
    data: `${base}data/alc.geojson`,
    field: 'g', // provisional: 1–5 = grades, 0 = non-agricultural
    detailData: `${base}data/alc-post1988.geojson`,
    detailField: 'grade', // post-1988: '1','2','3a','3b','4','5'
    accentVar: 'alc-4',
    defaultVisible: false,
    paint: {
      colors: {
        1: palette['alc-1'], 2: palette['alc-2'], '3a': palette['alc-3a'], 3: palette['alc-3'],
        '3b': palette['alc-3b'], 4: palette['alc-4'], 5: palette['alc-5'], 0: palette['alc-nonag'],
      },
      fillOpacity: 0.62,
      fillOpacityHover: 0.8,
    },
    legend: [
      { label: 'Grade 1 — excellent', colorVar: 'alc-1' },
      { label: 'Grade 2 — very good', colorVar: 'alc-2' },
      { label: 'Grade 3a — good (detailed)', colorVar: 'alc-3a' },
      { label: 'Grade 3 — good to moderate', colorVar: 'alc-3' },
      { label: 'Grade 3b — moderate (detailed)', colorVar: 'alc-3b' },
      { label: 'Grade 4 — poor', colorVar: 'alc-4' },
      { label: 'Grade 5 — very poor', colorVar: 'alc-5' },
    ],
    about: {
      title: 'About agricultural land classification',
      body: [
        "Agricultural Land Classification grades farmland by its quality for growing crops, from Grade 1 (excellent) to Grade 5 (very poor). It's a strategic, broad-scale grading — useful for seeing patterns, not exact field boundaries. Poorer land (grades 4 and 5) is often where returning farmland to nature makes most sense — so comparing this layer with the high opportunity nature areas shows where nature recovery and low farming value line up.",
        'Nationally this is a coarse 1960s grading; where land has been resurveyed since 1988 a far more detailed, field-level grading is shown on top — including the finer grades 3a (good) and 3b (moderate).',
      ],
    },
    card: (p) => {
      if (p.grade) {
        // Post-1988 detailed survey.
        const q = { 1: 'excellent', 2: 'very good', '3a': 'good', '3b': 'moderate', 4: 'poor', 5: 'very poor' };
        return { title: `Grade ${p.grade} — ${q[p.grade]}`, subtitle: 'ALC (detailed survey)' };
      }
      // Provisional wash.
      return { title: p.g ? `Grade ${p.g}` : 'Non-agricultural land', subtitle: 'ALC (provisional)' };
    },
  },
];

// Panel layout — groups shown top-to-bottom, decoupled from map draw order so
// the panel reads naturally (designations first, then the DWT theme). A group
// may carry an `about` drop-down (reusable; only DWT is populated for now).
export const panelGroups = [
  { label: 'Designations', layerIds: ['sssi', 'hona'] },
  // Marine & coastal — each layer carries its own legend + about (per-layer).
  { label: 'At sea', layerIds: ['marine', 'ncerm'] },
  { label: 'Water', layerIds: ['water'] },
  // The Land group's two layers (ALC quality, CROME use) each carry their own
  // legend + about drop-down (per-layer), so no group-level about here.
  { label: 'Land', layerIds: ['alc', 'crome'] },
  { label: 'Species', layerIds: ['species'] },
  {
    label: 'Dorset Wildlife Trust',
    layerIds: ['reserves', 'centres'],
    about: {
      title: 'About Dorset Wildlife Trust sites',
      body: [
        "Dorset Wildlife Trust is the county's largest nature conservation charity, caring for more than 40 nature reserves and its visitor centres across Dorset.",
        'Gold markers are the visitor centres — places you can visit. Reserves are shown as shaded areas where a boundary is available, and as markers elsewhere.',
        "A note on the data: DWT's full, authoritative reserve boundaries are held by Dorset Environmental Records Centre and are not published as open data, so the shaded areas here come from OpenStreetMap and cover only some reserves. Every reserve in DWT's directory is shown at least as a marker.",
      ],
    },
  },
];
