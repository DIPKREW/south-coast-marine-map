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
import { loadLiveOverflows } from './liveOverflows.js';

const base = import.meta.env.BASE_URL;

/**
 * FEATURE FLAG — the Dorset LAND layers.
 *
 * This site covers the South Coast Marine Recovery Project coastline (Land's End
 * to Beachy Head), but its land layers still hold DORSET-ONLY data inherited from
 * the Dorset Nature Map. Rather than delete them, they are switched off here:
 * with the flag false they never fetch, never render, and their toggles never
 * appear in the layer panel — but every layer definition, data-fetch script,
 * paint rule and stylesheet below stays intact and dormant, ready to be switched
 * back on or extended to the other counties.
 *
 * Flip to `true` to restore the Dorset land layers exactly as they were.
 *
 * The "At sea" group and the "Water" group (rivers & waterways, now corridor-wide)
 * are NOT governed by this flag and are always shown.
 */
export const SHOW_DORSET_LAND_LAYERS = false;

// Every layer the flag governs: designations, DWT sites, water, land and species.
const DORSET_LAND_LAYER_IDS = [
  'sssi', // Sites of Special Scientific Interest
  'hona', // LNRS High Opportunity Nature Areas
  'reserves', // Dorset Wildlife Trust reserves
  'centres', // Dorset Wildlife Trust visitor centres
  'alc', // Agricultural Land Classification
  'crome', // CROME field crops
  'species', // NBN Atlas notable species
];
// NOT governed by the flag any more: `water`. Rivers & waterways were rebuilt for
// the whole corridor (scripts/fetch-water.mjs), so they are no longer Dorset-only
// data and no longer belong behind a flag that exists to hide Dorset-only data.

const isHidden = (id) => !SHOW_DORSET_LAND_LAYERS && DORSET_LAND_LAYER_IDS.includes(id);

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

// ---- Storm overflow + water body helpers ----

// Spill-count bands for the annual return ramp. Chosen from the actual 2025
// distribution for this coastline (median 15, p75 40, p90 72, max 243), so each
// band holds a meaningful share rather than piling everything into one colour:
// 359 / 653 / 803 / 500 / 107 overflows respectively.
const SPILL_BREAKS = [1, 10, 40, 100];
const SPILL_BAND_LABELS = ['No spills recorded', '1–9 spills', '10–39 spills', '40–99 spills', '100+ spills'];

const plural = (n, word) => `${n.toLocaleString('en-GB')} ${word}${n === 1 ? '' : 's'}`;

// Hours of discharge — precise while small, rounded once it runs to hundreds.
const hours = (h) =>
  h == null || Number.isNaN(Number(h))
    ? null
    : `${Number(h).toLocaleString('en-GB', { maximumFractionDigits: Number(h) < 10 ? 1 : 0 })} hours`;

// "3 hours ago" / "2 days ago" — the live feed's timestamps are epoch ms.
const ago = (ts) => {
  if (!ts || Number.isNaN(Number(ts))) return null;
  const mins = Math.round((Date.now() - Number(ts)) / 60000);
  if (mins < 0) return 'just now';
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${plural(hrs, 'hour')} ago`;
  const days = Math.round(hrs / 24);
  if (days < 31) return `${plural(days, 'day')} ago`;
  const months = Math.round(days / 30.4);
  return `${plural(months, 'month')} ago`;
};

const LIVE_STATUS = {
  1: 'Discharging now',
  0: 'Not currently discharging',
  '-1': 'Monitor offline — no signal',
};

// WFD ecological status → the plain-English gloss shown under the name.
const WFD_ECO_NOTE = {
  High: 'close to undisturbed conditions',
  Good: 'only a slight departure from natural conditions',
  Moderate: 'moderately affected by human activity',
  Poor: 'substantially affected by human activity',
  Bad: 'severely affected by human activity',
};

// The Environment Agency's Catchment Data Explorer keys its per-water-body pages
// on the same WFD id carried in the data, so the link is exact, not a search.
const CDE = 'https://environment.data.gov.uk/catchment-planning/WaterBody/';

// ---- Recreational pressure helpers ----

// Density bands, from the real corridor distribution (median 0.83, max 807):
// 3,437 / 2,104 / 3,750 / 822 / 267 cells respectively.
const REC_BREAKS = [0.5, 1, 5, 20];
const REC_BAND_LABELS = [
  'Under 0.5 a week',
  '0.5 – 1 a week',
  '1 – 5 a week',
  '5 – 20 a week',
  '20+ a week',
];

// The source's own wording for the field, so the card cannot drift from it.
const REC_UNIT = 'recreational transits per week';
const REC_YEAR = 2015;

// ---- Seabed + marine species helpers ----

// Seabed substrate groups → the label shown on the card and in the legend. The
// grouping itself (EUNIS code → group) is done at build time; see
// scripts/fetch-seabed.mjs, where the mapping is written out and reasoned.
const SEABED_LABEL = {
  rock: 'Rock & reef',
  coarse: 'Coarse sediment',
  mixed: 'Mixed sediment',
  sand: 'Sand',
  mud: 'Mud',
  biogenic: 'Seagrass & biogenic reef',
  intertidal: 'Intertidal rock & sediment',
  sediment: 'Sediment (undifferentiated)',
  unknown: 'Unclassified',
};

// The 18 marine flagship species, each CHECKED against NBN for this corridor
// before inclusion — see scripts/build-marine-species.mjs, which reports live
// record and cell counts on every run. `group` drives both the checklist's
// subheadings and the colour family; `colorVar` is the palette token.
const MARINE_SPECIES = [
  { key: 'greyseal', common: 'Grey seal', sci: 'Halichoerus grypus', group: 'mammal', colorVar: 'sp-greyseal' },
  { key: 'harbourseal', common: 'Harbour seal', sci: 'Phoca vitulina', group: 'mammal', colorVar: 'sp-harbourseal' },
  { key: 'commondolphin', common: 'Common dolphin', sci: 'Delphinus delphis', group: 'mammal', colorVar: 'sp-commondolphin' },
  { key: 'bottlenose', common: 'Bottlenose dolphin', sci: 'Tursiops truncatus', group: 'mammal', colorVar: 'sp-bottlenose' },
  { key: 'porpoise', common: 'Harbour porpoise', sci: 'Phocoena phocoena', group: 'mammal', colorVar: 'sp-porpoise' },
  { key: 'minkewhale', common: 'Minke whale', sci: 'Balaenoptera acutorostrata', group: 'mammal', colorVar: 'sp-minkewhale' },
  { key: 'baskingshark', common: 'Basking shark', sci: 'Cetorhinus maximus', group: 'elasmo', colorVar: 'sp-baskingshark' },
  { key: 'tope', common: 'Tope', sci: 'Galeorhinus galeus', group: 'elasmo', colorVar: 'sp-tope' },
  { key: 'thornbackray', common: 'Thornback ray', sci: 'Raja clavata', group: 'elasmo', colorVar: 'sp-thornbackray' },
  { key: 'undulateray', common: 'Undulate ray', sci: 'Raja undulata', group: 'elasmo', colorVar: 'sp-undulateray' },
  { key: 'bluefin', common: 'Atlantic bluefin tuna', sci: 'Thunnus thynnus', group: 'fish', colorVar: 'sp-bluefin' },
  { key: 'seahorse', common: 'Spiny seahorse', sci: 'Hippocampus guttulatus', group: 'fish', colorVar: 'sp-seahorse' },
  { key: 'shortseahorse', common: 'Short-snouted seahorse', sci: 'Hippocampus hippocampus', group: 'fish', colorVar: 'sp-shortseahorse' },
  { key: 'cuttlefish', common: 'Common cuttlefish', sci: 'Sepia officinalis', group: 'ceph', colorVar: 'sp-cuttlefish' },
  { key: 'curledoctopus', common: 'Curled octopus', sci: 'Eledone cirrhosa', group: 'ceph', colorVar: 'sp-curledoctopus' },
  { key: 'commonoctopus', common: 'Common octopus', sci: 'Octopus vulgaris', group: 'ceph', colorVar: 'sp-commonoctopus' },
  { key: 'europeansquid', common: 'European squid', sci: 'Loligo vulgaris', group: 'ceph', colorVar: 'sp-europeansquid' },
  { key: 'veinedsquid', common: 'Veined squid', sci: 'Loligo forbesii', group: 'ceph', colorVar: 'sp-veinedsquid' },
];

// Subheadings for the checklist, in display order.
const MARINE_SPECIES_GROUPS = [
  { key: 'mammal', label: 'Marine mammals' },
  { key: 'elasmo', label: 'Sharks & rays' },
  { key: 'fish', label: 'Fish' },
  { key: 'ceph', label: 'Cephalopods' },
];

const MARINE_SPECIES_BY_KEY = new Map(MARINE_SPECIES.map((s) => [s.key, s]));
// map layer id (…-<key>-dot) → species, for the multi-species hover card.
const MARINE_SPECIES_BY_LAYER = new Map(MARINE_SPECIES.map((s) => [`marine-species-${s.key}-dot`, s]));

// The full registry — every layer, including the dormant Dorset land layers.
// Consumers import the filtered `dataLayers` below, not this.
const allDataLayers = [
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
    description: "Rivers and canals, Land's End to Beachy Head",
    group: 'Water',
    // Watercourse LINES (water.geojson) + EXACTLY TWO named water-body FILLS
    // (water-bodies-named.geojson: The Fleet + Poole Harbour). No broad water-body
    // category — see addWaterwaysLayer. Last in the array so it draws at the
    // bottom of the thematic stack.
    //
    // The lines now cover the whole corridor, rivers and canals only: the full
    // OSM waterway set across five counties is ~68,000 ways and ~25 MB, of which
    // 51,000 are streams that the renderer does not even draw until zoom 11.
    // See scripts/fetch-water.mjs. The two named FILLS are still Dorset-only —
    // they were hand-verified for the Dorset build and have no corridor-wide
    // equivalent; widening them is a separate, curated job.
    kind: 'waterways',
    data: `${base}data/water.geojson`,
    bodiesData: `${base}data/water-bodies-named.geojson`,
    accentVar: 'water',
    // THE ONE LAYER THAT STARTS ON. Every other layer here defaults off and is
    // lazily fetched on first toggle; this one is the map's base context — the
    // rivers that carry the catchments the storm overflow and water body layers
    // are about — so it loads with the page. Being defaultVisible: true is also
    // exactly what opts it out of deferLayer, so "starts on" and "fetches on page
    // load" are the same switch rather than two that could disagree.
    defaultVisible: true,
    card: (p) => {
      const types = { river: 'River', stream: 'Stream', canal: 'Canal', ditch: 'Ditch', drain: 'Drain' };
      const type = types[p.wtype]; // line types carry wtype; water bodies are wtype 'water'
      if (type) return p.name ? { title: p.name, subtitle: type } : { title: type };
      return p.name ? { title: p.name, subtitle: 'Water' } : { title: 'Water' };
    },
  },
  {
    id: 'storm-live',
    label: 'Live discharge status',
    description: 'Discharging right now, or not',
    group: 'At sea',
    // Near-real-time status per overflow, fetched at RUNTIME from the National
    // Storm Overflow Hub (see liveOverflows.js) rather than baked into
    // /public/data — a stale "live" layer would be worse than none. Default OFF,
    // so nothing is requested until it is asked for.
    kind: 'liveoverflow',
    // `prepare` runs once, on the first toggle-on, and hands back { data }.
    prepare: () => loadLiveOverflows({ base }),
    accentVar: 'discharge-on',
    defaultVisible: false,
    legend: [
      { label: 'Discharging now', colorVar: 'discharge-on' },
      { label: 'Not currently discharging', colorVar: 'discharge-off' },
      { label: 'Monitor offline — no signal', colorVar: 'discharge-offline' },
    ],
    about: {
      title: 'About live discharge status',
      body: [
        "Water companies publish the current state of every storm overflow — discharging or not — to the National Storm Overflow Hub, normally within an hour of it changing. Four companies operate along this coastline: South West Water, Southern Water, Wessex Water and Thames Water.",
        'This is fetched once, when you switch the layer on, and is not refreshed while the page is open — reload for a newer picture. Where a monitor is offline the dot is drawn faint rather than clear: an overflow with no signal is not the same as one known to be quiet.',
      ],
    },
    card: (p) => ({
      title: p.name || p.id || 'Storm overflow',
      subtitle: LIVE_STATUS[String(p.status)] || 'Status unknown',
      meta: [p.co, p.water ? `into ${p.water}` : null].filter(Boolean).join(' · ') || null,
      note:
        [
          p.status === 1 && p.since ? `Started ${ago(p.since)}` : null,
          p.status === 0 && p.endedAt ? `Last discharge ended ${ago(p.endedAt)}` : null,
          p.updated ? `Company last published ${ago(p.updated)}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || null,
    }),
  },
  {
    id: 'storm-annual',
    label: 'Annual spill data',
    description: 'Spills per overflow, 2025 (Environment Agency)',
    group: 'At sea',
    // The EA's Event Duration Monitoring annual return: one dot per overflow,
    // banded by how many times it spilled that year. Default OFF, lazy-loaded.
    kind: 'spills',
    data: `${base}data/storm-overflows.geojson`,
    field: 'spills',
    accentVar: 'spill-3',
    defaultVisible: false,
    paint: {
      colors: {
        0: palette['spill-0'], 1: palette['spill-1'], 2: palette['spill-2'],
        3: palette['spill-3'], 4: palette['spill-4'],
      },
      breaks: SPILL_BREAKS,
    },
    legend: SPILL_BAND_LABELS.map((label, i) => ({ label, colorVar: `spill-${i}` })),
    about: {
      title: 'About annual spill data',
      body: [
        "Every storm overflow in England carries an event duration monitor, and once a year the water companies report to the Environment Agency how many times each one discharged and for how long. This is that return for 2025 — the most recent published — for the 2,422 overflows in the mapped area, which together recorded 65,288 spills. 359 of them recorded none at all; the busiest spilled 243 times.",
        'A spill is counted by the 12–24 hour method, so one long discharge counts once rather than continuously. Count and duration therefore answer different questions and are best read together: an overflow with few but very long spills looks calm on count alone.',
        'A monitor that ran for only part of the year still reports, so a low count can mean a quiet outfall or a patchy monitor. The hover card shows how much of the year each monitor was actually operating.',
      ],
    },
    card: (p) => ({
      title: p.name || p.id || 'Storm overflow',
      subtitle: p.spills === 0 ? `No spills recorded in ${p.year}` : `${plural(p.spills, 'spill')} in ${p.year}`,
      meta: [hours(p.hours), p.co].filter(Boolean).join(' · ') || null,
      note:
        [
          p.water ? `Discharges to ${p.water}` : null,
          p.bathing ? `Bathing water: ${p.bathing}` : null,
          p.cover != null && p.cover < 90 ? `Monitor operational ${Math.round(p.cover)}% of the year` : null,
        ]
          .filter(Boolean)
          .join(' · ') || null,
    }),
  },
  {
    id: 'marine-species',
    label: 'Marine species',
    description: 'Recorded sightings — see About for data-gap caveat',
    group: 'At sea',
    // A CHECKLIST of 18 species, each drawing one small dot per occupied grid
    // square. Each species is a separate file fetched the first time it is
    // ticked (see addMarineMarkersLayer), so ticking one costs one species, not
    // eighteen. Markers are pre-placed in the SEA portion of their square at
    // build time. Default OFF, and with every species unticked.
    kind: 'marinemarkers',
    speciesBase: `${base}data/marine-species/`,
    species: MARINE_SPECIES,
    speciesGroups: MARINE_SPECIES_GROUPS,
    accentVar: 'marine-species',
    defaultVisible: false,
    about: {
      title: 'About marine species',
      body: [
        'Records for 18 marine species along this coast, from the NBN Atlas. Tick a species to show it. Each dot is one grid square in which that species has been recorded, sized by how many records — not a sighting, and not the animal\u2019s location. Sensitive species are deliberately blurred by NBN, and most records here are only resolved to a 10 km square, so the dot marks an area, not a spot.',
        'At sea the gaps matter more than on land. Records cluster where people go: ferry routes, survey transects, dive sites, and the headlands watchers stand on. A stretch of empty coast much more often means nobody was looking than that nothing was there \u2014 and a species with few records is not necessarily rarer than one with many, only less looked for.',
        'The dot sits in the sea part of its square rather than the square\u2019s centre, because for a coastal square the centre is often inland. Where several ticked species share a square their dots are nudged a few pixels apart so none is hidden; they refer to the same square, not to different places.',
      ],
    },
    // One card for everything under the pointer, since the dots sit close by
    // design. `hits` are one row per species.
    collectCard: (hits) => {
      const rows = hits
        .map((h) => ({ sp: MARINE_SPECIES_BY_LAYER.get(h.layerId), p: h.props }))
        .filter((r) => r.sp)
        .sort((a, b) => (b.p.n ?? 0) - (a.p.n ?? 0));
      if (!rows.length) return { title: 'Marine species' };
      const res = rows[0].p.res ? `${rows[0].p.res / 1000} km square` : null;
      const same = rows.every((r) => r.p.res === rows[0].p.res);
      return {
        title: rows.length === 1 ? `${rows[0].sp.common} (${rows[0].sp.sci})` : `${rows.length} species recorded here`,
        subtitle: rows.length === 1 ? 'recorded in this area \u00b7 NBN Atlas' : 'recorded in this area \u00b7 NBN Atlas',
        meta:
          rows.length === 1
            ? [plural(rows[0].p.n ?? 0, 'record'), res].filter(Boolean).join(' \u00b7 ')
            : rows.map((r) => `${r.sp.common} \u2014 ${plural(r.p.n ?? 0, 'record')}${same ? '' : ` (${r.p.res / 1000} km)`}`).join('\n'),
        note: rows.length === 1 ? null : same ? res : null,
      };
    },
    // Fallback for the single-feature path; collectCard normally wins.
    card: () => ({ title: 'Marine species', subtitle: 'recorded in this area \u00b7 NBN Atlas' }),
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
        "The seas between Land's End and Beachy Head hold a network of protected areas — Marine Conservation Zones, marine Special Areas of Conservation and Special Protection Areas. They protect habitats from the seagrass meadows of Studland Bay, home to native seahorses, to the recovering reefs of Lyme Bay — one of the country's flagship marine protected areas, where damaging bottom-trawling has been excluded since 2008.",
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
    id: 'wfd',
    label: 'Water body status',
    description: 'Ecological & chemical health',
    group: 'At sea',
    // The EA's own Water Framework Directive classification of each stretch of
    // coast and estuary. A broad wash BENEATH the erosion strips and the marine
    // outlines, so those keep the foreground. Default OFF, lazy-loaded.
    kind: 'wfd',
    data: `${base}data/wfd-coastal.geojson`,
    field: 'eco',
    accentVar: 'wfd-good',
    defaultVisible: false,
    paint: {
      colors: {
        High: palette['wfd-high'], Good: palette['wfd-good'], Moderate: palette['wfd-moderate'],
        Poor: palette['wfd-poor'], Bad: palette['wfd-bad'], unknown: palette['wfd-unknown'],
      },
      fillOpacity: 0.42,
      fillOpacityHover: 0.62,
    },
    legend: [
      { label: 'High', colorVar: 'wfd-high' },
      { label: 'Good', colorVar: 'wfd-good' },
      { label: 'Moderate', colorVar: 'wfd-moderate' },
      { label: 'Poor', colorVar: 'wfd-poor' },
      { label: 'Bad', colorVar: 'wfd-bad' },
    ],
    about: {
      title: 'About water body status',
      body: [
        'The Environment Agency divides the coast and its estuaries into water bodies and classifies each one under the Water Framework Directive. Colour here shows ECOLOGICAL status — a five-band judgement, High to Bad, built from biology (plankton, seaweeds, seabed life), supporting chemistry such as dissolved oxygen and nitrogen, and specific pollutants.',
        'Of the 67 water bodies in the mapped area in the 2025 classification, 17 are Good, 49 Moderate and one Poor. None reach High.',
        'CHEMICAL status is shown on the hover card but deliberately not mapped. Since 2019 it counts substances that exceed their limits right across England — mercury and certain flame retardants among them — so all 67 water bodies here fail it. That is a real result, but colouring by it would paint one flat wash and tell you nothing about the difference between one estuary and the next.',
      ],
    },
    card: (p) => ({
      title: p.name || 'Water body',
      subtitle: p.wbtype === 'Transitional' ? 'Estuary (transitional water body)' : 'Coastal water body',
      meta: [p.eco ? `Ecological: ${p.eco}` : null, p.chem ? `Chemical: ${p.chem}` : null].filter(Boolean).join(' · ') || null,
      note: [WFD_ECO_NOTE[p.eco], p.year ? `${p.year} classification` : null].filter(Boolean).join(' · ') || null,
      link: p.id ? { href: CDE + p.id, label: 'Catchment Data Explorer ↗' } : null,
    }),
  },
  {
    id: 'recreational',
    label: 'Recreational pressure',
    description: 'Recreational vessel density, 2015',
    group: 'At sea',
    // MMO's 2 km vessel density grid, recreational ship-type group only.
    // A broad wash just above the seabed and below everything specific.
    // Default OFF, lazy-loaded.
    kind: 'density',
    data: `${base}data/recreational-pressure.geojson`,
    field: 'rec',
    accentVar: 'rec-3',
    defaultVisible: false,
    paint: {
      colors: {
        0: palette['rec-0'], 1: palette['rec-1'], 2: palette['rec-2'],
        3: palette['rec-3'], 4: palette['rec-4'],
      },
      breaks: REC_BREAKS,
      fillOpacity: 0.6,
      fillOpacityHover: 0.8,
    },
    legend: REC_BAND_LABELS.map((label, i) => ({ label, colorVar: `rec-${i}` })),
    about: {
      title: 'About recreational pressure',
      body: [
        'Where recreational boats were tracked, on the Marine Management Organisation\u2019s 2 km vessel density grid. Each square shows the average number of recreational vessel transits a week.',
        'THE DATA IS FROM 2015. AIS was sampled for the first seven days of each month through that year and the twelve sample weeks averaged. It is a decade old, it is the most recent MMO grid that is still actually downloadable, and boating patterns will have moved since \u2014 read it as where the pressure was, not where it is.',
        'It also only counts boats carrying AIS transponders, and most small recreational craft do not. Dinghies, kayaks, paddleboards, angling boats and a great many small motor and sailing boats are simply absent. That is not a footnote: on a coast like this one the untracked fleet is probably larger than the tracked one, so quiet water on this map can still be busy water, and the pattern is better read as a guide to where the larger, better-equipped boats concentrate.',
      ],
    },
    card: (p) => {
      const share =
        p.all != null && p.all > 0 && p.rec != null
          ? `${Math.round((p.rec / p.all) * 100)}% of all vessel traffic here`
          : null;
      return {
        title: `${p.rec} ${REC_UNIT}`,
        subtitle: `Average week, ${REC_YEAR} \u00b7 2 km grid square`,
        meta: share,
        note: 'MMO vessel density grid \u00b7 AIS-tracked vessels only',
      };
    },
  },
  {
    id: 'seabed',
    label: 'Seabed habitats',
    description: 'What the sea floor is made of — modelled',
    group: 'At sea',
    // The bottom-most marine layer: a continuous wash over the whole sea floor.
    // LAST of the "At sea" layers in this array so everything else draws on top
    // of it. Default OFF, lazy-loaded.
    kind: 'seabed',
    data: `${base}data/seabed.geojson`,
    field: 'grp',
    accentVar: 'seabed-coarse',
    defaultVisible: false,
    paint: {
      colors: {
        rock: palette['seabed-rock'], coarse: palette['seabed-coarse'], mixed: palette['seabed-mixed'],
        sand: palette['seabed-sand'], mud: palette['seabed-mud'], biogenic: palette['seabed-biogenic'],
        intertidal: palette['seabed-intertidal'], sediment: palette['seabed-unknown'],
        unknown: palette['seabed-unknown'],
      },
      fillOpacity: 0.55,
      fillOpacityHover: 0.75,
    },
    // Only the groups that actually occur in this corridor are listed, in
    // descending share of mapped seabed area.
    legend: [
      { label: 'Coarse sediment — 73%', colorVar: 'seabed-coarse' },
      { label: 'Sand — 15%', colorVar: 'seabed-sand' },
      { label: 'Rock & reef — 6%', colorVar: 'seabed-rock' },
      { label: 'Mixed sediment — 5%', colorVar: 'seabed-mixed' },
      { label: 'Mud — 1.5%', colorVar: 'seabed-mud' },
    ],
    about: {
      title: 'About seabed habitats',
      body: [
        "What the sea floor is made of, from JNCC's UKSeaMap — the UK part of the Atlas of Seabed Habitats. It is a broad-scale PREDICTIVE map: modelled from bathymetry, seabed substrate, light and wave and tidal energy, rather than a record of places anyone has been down and looked at. Read it as the best available estimate of the ground, not as survey. The source carries no per-area distinction between modelled and surveyed, because all of it is modelled.",
        'The model separates 25 EUNIS habitat classes across this coastline. They are drawn in five groups — colouring 25 fine-grained codes separately would be unreadable — but the hover card still names the exact class. By area of the 35,900 km² mapped here, coarse sediment covers 73%, sand 15%, rock and reef 6%, mixed sediment 5% and mud 1.5%.',
        'Neither seagrass nor biogenic reef appears as its own class in the corridor. That is a limit of a broad-scale model, which cannot resolve features that small, and not evidence that there are none — the seagrass of Studland Bay is a well-known example that this map does not show.',
      ],
    },
    card: (p) => ({
      title: SEABED_LABEL[p.grp] || 'Seabed habitat',
      subtitle: p.name || null,
      meta: [p.code ? `EUNIS ${p.code}` : null, p.zone].filter(Boolean).join(' · ') || null,
      note: 'Predictive model (JNCC UKSeaMap), not survey',
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
const allPanelGroups = [
  { label: 'Designations', layerIds: ['sssi', 'hona'] },
  // Marine & coastal — each layer carries its own legend + about (per-layer).
  // The two storm overflow layers sit under their own subheading: they share a
  // subject but are different KINDS of thing — a fixed annual report against a
  // live status feed — and shouldn't read as two views of one dataset. The WFD
  // water body layer stays a peer of the others: it is the Environment Agency's
  // own assessment of the water, not a record of what was discharged into it.
  {
    label: 'At sea',
    layerIds: ['marine', 'ncerm', 'wfd', 'recreational', 'seabed', 'marine-species'],
    subgroups: [{ label: 'Storm overflows', layerIds: ['storm-annual', 'storm-live'] }],
  },
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

// ---- What the app actually consumes ----
//
// With SHOW_DORSET_LAND_LAYERS false the Dorset land layers are dropped from
// both the map registry and the panel layout. Dropping them from `dataLayers` is
// what stops the fetch and the render — applyDataLayers never adds their source,
// so their GeoJSON/PMTiles are never requested. Dropping them from the groups
// removes their toggles; a group left with no layers is skipped entirely by
// buildControlPanel, so no empty "Land" or "Species" heading is left behind.
//
// The "At sea" group is untouched: neither `marine` nor `ncerm` is flag-governed.
export const dataLayers = allDataLayers.filter((l) => !isHidden(l.id));

export const panelGroups = allPanelGroups
  .map((g) => ({
    ...g,
    layerIds: g.layerIds.filter((id) => !isHidden(id)),
    // Subgroups are filtered the same way, and an emptied one is dropped so no
    // bare subheading is left behind.
    ...(g.subgroups
      ? {
          subgroups: g.subgroups
            .map((s) => ({ ...s, layerIds: s.layerIds.filter((id) => !isHidden(id)) }))
            .filter((s) => s.layerIds.length > 0),
        }
      : {}),
  }))
  .filter((g) => g.layerIds.length > 0 || g.subgroups?.length > 0);
