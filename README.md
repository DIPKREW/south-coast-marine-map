# Dorset Nature Map

A calm, editorial interactive map of the **whole of Dorset** — a cream/parchment
canvas, thin charcoal linework, and muted accent colours for the data. Ten
toggleable layers tell the nature-recovery story:

- **Sites of Special Scientific Interest (SSSI)** — terracotta — what's protected now.
- **High Opportunity Nature Areas** — sage — where recovery is targeted next.
- **Dorset Wildlife Trust reserves** — slate — every reserve in DWT's directory,
  as a shaded boundary where one is available and a marker elsewhere.
- **DWT visitor centres** — gold markers — places to visit.
- **Rivers & waterways** — water-blue — rivers, streams, canals and minor
  channels as lines, plus two named water bodies (the Fleet + Poole Harbour).
- **Agricultural land classification** — a muted earth ramp (Grade 1→5) under the
  others, showing farmland quality; a detailed post-1988 resurvey (finer 3a/3b)
  layers over the coarse provisional wash. **Off by default.**
- **Field crops (CROME)** — what was growing in each field in 2024, by category,
  from the Crop Map of England (vector tiles, zoom in from ~z11). **Off by default.**
- **Notable species (NBN Atlas)** — a coarse grid of where flagship species have
  been recorded, one species at a time via a selector. **Off by default.**
- **Marine protected areas** — deep teal — Dorset's Marine Conservation Zones,
  marine SACs and coastal SPAs, drawn as outlined areas (solid / dashed / dotted
  by type) so the heavy overlaps stay legible. **Off by default.**
- **Coastal erosion risk** — a warm pale→clay ramp — how far each stretch of coast
  could erode by 2055 with no future intervention (Environment Agency NCERM).
  **Off by default.**

Hovering any feature shows a small on-brand **info card** (name, type, area, a
short note — and, for marine sites, a "More info ↗" link to its national record).
Pan/zoom is bounded to Dorset, its neighbouring counties, and far enough out to
sea to take in the offshore marine sites.

The aesthetic is the point: a sibling to the Anthropic site / CRADLE. Warm,
restrained, lots of breathing room — the accents stay muted so the map stays
calm despite ten layers.

![Dorset Nature Map](docs/preview.png)

## Quick start

```bash
npm install      # install dependencies
npm run dev      # start the dev server (opens http://localhost:5173)
```

That's it — the base map (OpenFreeMap) and all ten bundled data layers work with
**no API keys**.

### Other commands

```bash
npm run build        # production build → dist/
npm run preview      # serve the production build locally
npm run data         # rebuild every data layer (see notes per layer below)
npm run data:sssi    # refresh the bundled SSSI GeoJSON from Natural England
npm run data:hona    # rebuild High Opportunity Nature Areas (needs the gpkg, see below)
npm run data:dwt     # refresh DWT reserves from OpenStreetMap (Overpass)
npm run data:centres # rewrite the curated DWT visitor-centre markers
npm run data:water       # rebuild watercourse lines GeoJSON from OSM
npm run data:water-named # rebuild the two named water bodies (Fleet + Poole Harbour)
npm run data:alc         # rebuild Provisional Agricultural Land Classification
npm run data:alc-post1988 # rebuild the detailed Post-1988 ALC resurvey (3a/3b)
npm run data:crome       # rebuild Field crops (CROME) vector tiles (needs tippecanoe)
npm run data:species     # rebuild the Notable species grid from the NBN Atlas
npm run data:marine      # rebuild marine protected areas (MCZ / marine SAC / coastal SPA)
npm run data:ncerm       # rebuild coastal erosion risk from the EA NCERM (WFS)
```

## How it looks the way it does

- **Base map** — keyless vector tiles from [OpenFreeMap](https://openfreemap.org)
  (OpenMapTiles schema), recoloured by a **bespoke** MapLibre style
  (`src/map/mapStyle.js`). This custom style — not any provider default — is what
  makes the map read as cream paper with charcoal hairlines and a whisper-grey
  harbour. Linework stays crisp from the catchment overview (zoom ~10.5) down to
  roughly a 50 m square (zoom ~20).
- **Type** — Fraunces (display / wordmark), Inter (UI), IBM Plex Mono (micro
  labels), loaded from Google Fonts. Map labels use OpenFreeMap's hosted Noto
  Sans glyphs.
- **Palette + tokens** — defined once in `src/design/tokens.js` and injected as
  CSS custom properties at startup, so the CSS and the map style never drift.
  The two data accents (terracotta `--accent`, sage `--accent-2`) live here too.

## Bounded to Dorset

The map can't drift off to open ocean or other regions. `createMap.js` sets
`maxBounds` to `[[-3.5, 50.3], [-1.3, 51.3]]` (all of Dorset plus a margin into
Devon, Somerset, Wiltshire and Hampshire — and far enough **south, out to sea**,
to take in the offshore marine sites: the southernmost Dorset marine site sits at
~50.354) and `minZoom: 8`, so at the furthest zoom-out the whole county fills the
viewport and there's no world view. `maxZoom: 20` keeps the ~50 m square. The map
opens framed on the whole county (`bounds` in `createMap.js`).

## The data layers

The two **area** layers (SSSI, HONA) cover the whole of Dorset and share one
clean footprint: each is clipped to the **same Dorset LNRS area boundary**, so
neither bleeds into the neighbouring counties and their edges line up exactly.
That mask is the Dorset feature of Natural England's open *Local Nature Recovery
Strategy Areas (England)* dataset, simplified and committed at
`scripts/dorset-lnrs-area.geojson` (shared bbox + mask live in
`scripts/lib/dorset.mjs`; a dependency-free geodesic area helper stamps each
polygon with `area_ha` in `scripts/lib/geo.mjs`).

All layers are committed to `public/data/` so the app runs offline / out of the
box. Hovering any feature emphasises it and shows a small on-brand **info card**
in that layer's accent — title, type, area, and a short note, declared per layer
in the config. A single map-wide resolver picks the **topmost / most specific**
feature, so overlapping layers never stack cards (a reserve or visitor centre
wins over the broad SSSI/HONA washes beneath). Each layer has its own labelled
switch; the panel groups them under *Designations*, *At sea*, *Water*, *Land*,
*Species* and *Dorset Wildlife Trust*.

Draw order, top to bottom: visitor centres → DWT reserves → SSSI → HONA → water →
marine protected areas → coastal erosion → species grid → CROME field crops → ALC
(the base wash at the very bottom).

> **A note on extent.** The marine and coastal layers are the one exception to the
> land-mask rule above: clipping them to the Dorset LNRS land boundary would erase
> the sea. They're clipped instead to a **seaward coastal box**
> (`[-3.3, 50.1, -1.4, 50.85]`), which captures Lyme Bay, Poole Bay and the
> offshore sites to the south.

### Sites of Special Scientific Interest — terracotta

- **Source** — Natural England, *Sites of Special Scientific Interest (England)*,
  via the open ArcGIS Feature Service. `npm run data:sssi` asks the server for
  the match count, then **pages** through the whole Dorset bbox (`resultOffset`
  loop, count-verified — no maxRecordCount surprises), clips to the LNRS mask
  (235 fetched → 145 in Dorset), and writes `public/data/sssi.geojson` (~1 MB).
- **Style** — soft `--accent` fill, crisp ~1.2 px `--accent` outline.
- Card: site name (`NAME`) · "Site of Special Scientific Interest" · area (`MEASURE`, ha).

### High Opportunity Nature Areas — sage (the recovery wash)

The areas Dorset's Local Nature Recovery Strategy targets for nature recovery —
drawn *beneath* the SSSIs as a soft sage wash, so SSSIs stay prominent and the
opportunity areas read as where recovery extends around and between them.

- **Source** — Dorset Council, *Dorset's nature recovery maps* → the Local
  Habitat Map spatial download (Open Government Licence). In that GeoPackage the
  layer named **ACB** is — per the bundled Read Me — the Dorset LNRS
  "**high opportunity nature areas**" layer (Defra: "areas that could become of
  importance"). `scripts/build-hona.mjs` reads ACB straight from the GeoPackage
  (no GDAL — uses Node's built-in SQLite), reprojects EPSG:27700 → WGS84 with
  proj4, then **aggressively** simplifies (Visvalingam, `keep-shapes`), drops
  slivers, and clips to the LNRS mask (3 113 areas county-wide → 2 929), writing
  `public/data/hona.geojson` (~4 MB — a few MB, kept smooth as a raw GeoJSON
  source; no vector-tile step needed).
- **Style** — soft `--accent-2` (sage) fill, fine `--accent-2-strong` outline.
- Card: "High Opportunity Nature Area" · area (`area_ha`) · note "Dorset LNRS —
  targeted for nature recovery." (the ACB layer carries no per-feature name).

**Rebuilding the HONA data:** the source GeoPackage is ~1 GB and is *not*
committed. Download it from
<https://www.dorsetcouncil.gov.uk/dorset-s-nature-recovery-maps> ("Download the
spatial layers of the local habitat map"), then:

```bash
HONA_GPKG="/path/to/Dorset local habitat map.gpkg" npm run data:hona
```

### Dorset Wildlife Trust reserves — slate (polygons + markers)

**Every reserve in DWT's directory is shown** — as a shaded polygon where a
boundary can be matched, and as a small marker everywhere else. `npm run data:dwt`
runs a three-stage pipeline (`scripts/fetch-dwt.mjs`):

- **A — directory.** Scrape DWT's reserve directory via its sitemap (one page per
  reserve), reading each reserve's name and **embedded schema.org coordinates**
  (geocoding the name via Nominatim only as a fallback). Every coordinate is
  verified to fall within Dorset.
- **B — boundaries by name-match.** Pull *all* `leisure=nature_reserve` /
  `boundary=protected_area` polygons in Dorset from Overpass, and match them to
  directory reserves on **normalised name similarity AND proximity** (greedy,
  best-first, each polygon used once). Conservative thresholds — it won't grab the
  wrong reserve.
- **C — represent each reserve once.** Matched → slate polygon; unmatched → slate
  marker at its verified location. Markers within ~350 m of a gold visitor centre
  are dropped (the centre wins). Polygons are clipped to the LNRS mask; markers
  are authoritative points.

> **Honest counts (last run): 41 reserves — 8 as polygons, 29 as markers, 4 shown
> by a visitor centre instead, 0 unplaceable.** DWT's authoritative boundaries are
> held by Dorset Environmental Records Centre and aren't open data, so OSM only
> yields boundaries for some reserves — the rest are markers. We never fabricate a
> boundary or a location; re-running picks up newly mapped boundaries.

- **Style** — soft `--accent-3` (slate) fill + outline for polygons; small,
  subordinate slate dots for markers (smaller than the gold centre dots).
- Card — polygon: name · "Dorset Wildlife Trust nature reserve" · area (ha).
  Marker: name · "Dorset Wildlife Trust nature reserve" (no area).

### DWT visitor centres — gold markers

A small **curated** set of point markers (`npm run data:centres`). Each was
geocoded (Nominatim) and/or taken from an authoritative OpenStreetMap feature,
then **verified** to land on the right place before committing — provenance is
noted per entry in `scripts/build-centres.mjs`. The descriptions are fixed
editorial copy (no invented facts such as opening hours).

- Kingcombe, Fine Foundation Wild Seas Centre (Kimmeridge), Fine Foundation Wild
  Chesil Centre, Lorton Meadows, The Villa (Brownsea Island), and Brooklands
  Farm (HQ).
- **Style** — a small gold (`--accent-4`) dot with a paper ring, drawn above all
  layers (the prominent "places to visit"), with an optional label from ~zoom 11.
  On by default.
- Card: name · "Dorset Wildlife Trust visitor centre" · its description.

### Rivers & waterways — water-blue (lines + two named bodies)

Watercourse **lines** from OpenStreetMap as plain GeoJSON
(`public/data/water.geojson`, ~2.3 MB; `npm run data:water`), **plus exactly two
named water-body fills** — **The Fleet** and **Poole Harbour** — in a separate,
hand-verified file (`public/data/water-bodies-named.geojson`;
`npm run data:water-named`). No tiler, no PMTiles, no runtime tile dependency.

> **No broad water-body fill category.** A generic `natural=water` fill was the
> recurring source of pale-blue **rectangle artefacts** (many small polygons
> tile-clipping into squares). So the layer has **exactly one `fill` layer**, and
> it renders **only** the two named bodies; everything else reading the water
> data is `line` or `symbol`. The two bodies pass a **verification gate**
> (`> 50` vertices — a real shoreline, not a `≤ 10`-vertex box): The Fleet = 552
> vertices, Poole Harbour = 6 057. Other lakes and the open sea are left to the
> basemap.

- **Watercourse coverage** — `waterway=river` (286 in Dorset) + `canal` at **full
  resolution**; `waterway=stream` (~6.6k) lightly simplified, from ~zoom 11; and
  minor **`ditch` + `drain`** (~590) lightly simplified, faint and only from
  **~zoom 13** in (layer `minzoom`) so county/mid views stay clean.
- **Named bodies** — The Fleet (`natural=water`) and Poole Harbour (`natural=bay`,
  assembled from its coastline members → the true detailed shoreline, islands cut
  out as holes). Drawn at the **bottom** of the water group, beneath the lines and
  washes: muted `--water-soft` fill, subtle `--water-strong` outline.
- **Smooth rivers (no dog-legs)** — full-resolution GeoJSON, tiled client-side by
  MapLibre's `geojson-vt`; the Frome, Piddle, Stour etc. meander smoothly.
- **Hover** — line: name (if any) · River / Stream / Canal / Ditch / Drain; water
  body: name · "Water". The priority-based resolver lets a watercourse or a named
  body win over the broad washes drawn above it; markers still beat waterways.

> **Honest coverage note (Weymouth minor channels).** Adding ditches/drains
> broadens minor-channel coverage, but some specific channels simply aren't in
> OSM. Checked against the targets: the **Chickerell → Chaffey's Lake** channel is
> **absent from OSM** (only the River Wey + ditches at the Radipole end exist); the
> **Lanehouse → Westham → backwater** route is **partial** — a stream + ditch near
> Lanehouse and the River Wey + ditch at the backwater are mapped, but the Westham
> middle stretch is not. Our build matches OSM exactly at every checked point — the
> gaps are in OSM, and we don't fabricate missing segments.

### Agricultural land classification — a graded earth wash (two surveys)

**Agricultural Land Classification (ALC)** from Natural England
(`naturalengland-defra`, same family as SSSI), two datasets under one toggle:

- **Provisional** (`npm run data:alc`, `scripts/fetch-alc.mjs`) — the coarse
  1960s 1:250k grading, full coverage. Count-verified ArcGIS paging → clip to the
  LNRS mask → simplify → `public/data/alc.geojson` (90 polygons, ~380 KB). Dorset:
  G1 ×2, G2 ×11, G3 ×23, G4 ×19, G5 ×11, plus 24 non-agricultural. *The
  provisional dataset does **not** subdivide Grade 3* — its grades are 1/2/3/4/5
  (confirmed, reported honestly).
- **Post-1988 detailed resurvey** (`npm run data:alc-post1988`,
  `scripts/fetch-alc-post1988.mjs`) — patchy field-level grading where land has
  been resurveyed, **including the finer 3a/3b**. 1,961 features in Dorset → keep
  only the 6 graded classes (dropping 'Other'/'Not Surveyed' so the provisional
  shows through) → 494 polygons, ~120 KB. Drawn **on top** of the provisional.

- **Ramp** — a sequential **earth ramp**, `--alc-1` (pale sand) → `--alc-5` (deep
  umber), with extra contrast (2/4/5 clearly distinct from the dominant 3) so the
  county reads as variation, not a flat slab. Monotonic best→poorest, with 3a/3b
  slotted between 2–3 and 3–4. *Not* green="good": the **poorest land (4 & 5) is
  darkest**, to draw the eye — that's where returning farmland to nature makes most
  sense. All muted/on-palette.
- **Base wash** — soft fills, no outline, drawn at the **bottom** of the thematic
  stack (beneath SSSI/HONA/DWT/water/CROME). **Off by default** (full-coverage).
- **Panel** — in the "Land" group with an inline **legend** (now 7 swatches incl.
  3a/3b) and an `about` drop-down. Hover is source-aware: "Grade 3b — moderate ·
  ALC (detailed survey)" vs "Grade 3 · ALC (provisional)". Lowest hover priority.

### Field crops (CROME) — what's growing, by field

The **Crop Map of England 2024** (Rural Payments Agency, OGL v3.0) — ~0.41 ha
hexagons classifying each field's land use from satellite imagery. Served as
**vector tiles** (`public/data/crome.pmtiles`, ~5.8 MB; `npm run data:crome`,
needs `tippecanoe`). Pipeline (`scripts/build-crome.mjs`):

1. **Fetch** the Dorset ceremonial county (3-letter code **DOR**) from Defra's
   **OGC API - Features** endpoint, paged at 20k — **641,303 hexagons** — mapping
   each `lucode` to one of six muted categories (cereals; oilseed & break crops;
   maize & root crops; grassland; woodland & trees; other/non-agricultural).
2. **Dissolve** adjacent same-category hexes, **explode** into contiguous field
   blocks, simplify away the hex jaggedness, drop slivers → **34,270 field
   blocks** (never render raw hexes).
3. **tippecanoe** → PMTiles, **z11–14** with `--coalesce --drop-densest-as-needed`.

- **Zoom-gated** — the layer renders only from **~z11** (field detail; pointless
  and heavy at county zoom — keeps the overview fast). **Off by default.**
- **STRUCTURAL** — the only fills are the dissolved crop polygons; **no
  ocean/background fill** is introduced (learned from the water-fill rectangle
  bug). Loaded via the `pmtiles://` protocol (registered in `createMap.js`).
- **Palette** — six desaturated categories (warm crops → greens), distinct from
  the ALC earth ramp; its own legend + `about` drop-down. Hover: category ·
  "Field crops (CROME) 2024". A *distinct* story from ALC (use, not quality).

### Notable species (NBN Atlas) — a coarse record grid

A curated set of flagship/indicator species shown as a **coarse grid** (never
pinpoints), one species at a time via a selector. `npm run data:species`
(`scripts/build-species.mjs`) queries the **NBN Atlas occurrence API**, but does
**not** download individual records — instead it asks the API to **facet on NBN's
own OS grid-reference field**, returning "recorded in this grid square" + a count
per cell. The committed `public/data/species-grid.geojson` (~95 KB) stores grid
polygons with only `{ sp, n, res }` — **no coordinates**.

> **Honest resolution.** NBN blurs sensitive species to a coarse grid. For each
> species we read the record resolution distribution and bin at the resolution the
> data actually supports — **10 km for the heavily-blurred heathland species, 2 km
> where most records are finer** — never finer than NBN published. Per-species
> coverage (Dorset, last run):
>
> | Species | records | grid | cells |
> |---|--:|:--:|--:|
> | Sand lizard *(Lacerta agilis)* | 34,710 | 10 km | 11 |
> | Smooth snake *(Coronella austriaca)* | 11,760 | 10 km | 13 |
> | Silver-studded blue *(Plebejus argus)* | 13,287 | 2 km | 159 |
> | Ladybird spider *(Eresus sandaliatus)* | **28** | 10 km | 2 |
> | Dartford warbler *(Curruca undata)* | 10,285 | 10 km | 21 |
> | Nightjar *(Caprimulgus europaeus)* | 4,525 | 10 km | 27 |
> | Great crested newt *(Triturus cristatus)* | 1,752 | 2 km | 132 |
> | Lulworth skipper *(Thymelicus acteon)* | 8,339 | 2 km | 69 |
>
> The ladybird spider (a DWT reintroduction) is genuinely sparse — **28 records,
> 2 cells** — reported as-is, not padded.

- **Style** — muted heather purple (`--species`); fill opacity rises slightly with
  the record count; a faint cell outline. Drawn **above the land washes, below the
  site overlays**. **Off by default** (exploratory).
- **Panel** — its own "Species" group with a **selector** (dropdown of the species,
  one at a time; shows the current common + scientific name), an inline legend, and
  an `about` drop-down. Hover: "Sand lizard (*Lacerta agilis*) · recorded in this
  area · NBN Atlas". Lowest-but-one priority — specific sites still win over the grid.

### Marine protected areas — deep teal (outlined, by designation type)

Dorset's seas hold a network of protected areas, and they overlap heavily, so they
are drawn as **outlined areas** (a very faint shared teal fill + a type-styled
outline) rather than solid fills — the overlaps stay legible. `npm run data:marine`
(`scripts/fetch-marine.mjs`) pulls three Natural England / JNCC open ArcGIS layers,
clips them to the **coastal box** (not the land mask), and tags each feature with
`{ mtype, name, code }`. Selection is an explicit, reported allow-list per type:

| Type | Style | Sites (Dorset) |
|---|---|---|
| **MCZ** — Marine Conservation Zone | solid | Studland Bay, Poole Rocks, South Dorset, Chesil Beach & Stennis Ledges, Purbeck Coast, South of Portland, Southbourne Rough |
| **SAC** — marine/coastal Special Area of Conservation | dashed | Lyme Bay and Torbay, Studland to Portland, Chesil & The Fleet, Isle of Portland to Studland Cliffs, St Albans Head to Durlston Head, Sidmouth to West Bay, Solent Maritime |
| **SPA** — coastal Special Protection Area | dotted | Solent and Dorset Coast, Poole Harbour, Chesil Beach & the Fleet |

The MCZ list is the **Dorset** zones (the Isle-of-Wight / Devon offshore MCZs that
merely clip the box's edge are excluded); the SAC/SPA lists are the genuinely
marine/coastal sites (the inland heath SACs/SPAs that overlap the box are not).
**The pipeline keeps overlaps deliberately** — it does *not* run mapshaper `-clean`,
which would treat a small contained polygon (e.g. Poole Rocks MCZ, which sits inside
the Studland-to-Portland SAC) as a sliver and delete it.

- **Style** — deep teal (`--marine`, distinct from the river water-blue); one line
  layer per type (MCZ solid / SAC dashed / SPA dotted); faint fill doubles as the
  hover hit area. **Off by default**, in the new "At sea" group.
- **Hover** — "*[Site name]* · *[full designation]*" plus a **"More info ↗" link**
  to that site's page on Natural England's Designated Sites View (built from the
  site code). The info card becomes interactive (with a short grace period) only
  when it carries a link, so every other layer's card is unchanged.

### Coastal erosion risk — a warm pale→clay ramp

`npm run data:ncerm` (`scripts/build-ncerm.mjs`) reads the Environment Agency's
**National Coastal Erosion Risk Map** (NCERM, 2024) from its open **WFS** service,
for one honest, named scenario: **No Future Intervention · Medium Term (to 2055) ·
Higher Central climate allowance**. "No future intervention" reads as the *inherent*
vulnerability of each frontage if defences were not maintained. NCERM's value is the
projected **recession distance in metres**, which we band into a five-step low→high
risk ramp; the committed `public/data/ncerm.geojson` stores `{ risk, dist }` only.

- **Style** — a muted warm ramp, pale sand (negligible) → deep rust (very high)
  (`--erosion-0..4`); thin coastal frontage strips. **Off by default**, in "At sea".
- **Hover** — the risk band + the projected recession ("≈ N m, no future
  intervention"). Lowest hover priority — any specific site sits on top.

### Panel explanation drop-down

An `about` block (title + paragraphs) drops down beneath toggles with a caret to
collapse/expand, auto-expands on (re)activation, and hides when off. It can be
declared at the **group** level (the Dorset Wildlife Trust group) or the **layer**
level (the ALC, CROME, species, marine and coastal-erosion layers each have one).
A layer may also declare a `legend` (colour swatches) and/or a `species` selector
(dropdown), shown only while that layer is on. A `card` may carry a `link`, which
renders an interactive "More info" link (used by the marine sites). All reusable
capabilities.

Attribution (shown in the map's attribution control): Base map © OpenFreeMap /
© OpenStreetMap contributors · SSSI © Natural England (contains Ordnance Survey
data © Crown copyright) · Contains Dorset Council nature recovery data, Open
Government Licence v3.0 · DWT reserves: list © Dorset Wildlife Trust, boundaries
© OpenStreetMap contributors · ALC © Natural England (ADAS &amp; Defra) · Crop Map
of England © Rural Payments Agency / OGL · Species data: NBN Atlas contributors ·
Marine data © Natural England / JNCC, OGL · Coastal erosion © Environment Agency, OGL.

## Project structure

```
index.html                  page shell + font + no-flash background
src/
  main.js                   wires tokens → map → data layers → control panel
  style.css                 editorial styling + recoloured MapLibre controls
  design/tokens.js          ★ single source of truth: palette + fonts
  map/
    createMap.js            MapLibre init, initial view, minimal controls
    mapStyle.js             ★ the bespoke base style (OpenMapTiles → palette)
    layers.js               ★ data-layer config + panel groups (about + legends)
    dataLayers.js           polygon / point / mixed / waterways / choropleth / marine / erosion layers, priority hover
  ui/
    controlPanel.js         floating panel, grouped toggles, about drop-down, legend
    infoCard.js             the on-brand hover info card
scripts/lib/dorset.mjs      shared Dorset bbox + LNRS clip-mask loader
scripts/lib/geo.mjs         geodesic area + point-in-polygon + haversine (dependency-free)
scripts/dorset-lnrs-area.geojson  the Dorset LNRS boundary, the shared clip mask
scripts/fetch-sssi.mjs      page + clip + simplify the SSSI GeoJSON
scripts/build-hona.mjs      read + reproject + clip + simplify HONA from the gpkg
scripts/fetch-dwt.mjs       scrape directory + name-match OSM → reserve polygons & markers
scripts/build-centres.mjs   curated, verified DWT visitor-centre markers
scripts/fetch-water.mjs     Overpass → clip → watercourse LINES GeoJSON
scripts/fetch-named-water.mjs  fetch + verify the two named water bodies (Fleet, Harbour)
scripts/fetch-alc.mjs       page + clip + simplify the Provisional ALC grades
scripts/fetch-alc-post1988.mjs  page + clip the detailed Post-1988 ALC (3a/3b)
scripts/build-crome.mjs     OGC API → category-map → dissolve → tile CROME field crops
scripts/build-species.mjs   NBN Atlas facet → OS-grid parse → species record grid
scripts/fetch-marine.mjs    NE/JNCC ArcGIS → curated allow-list → clip to coastal box (overlaps kept)
scripts/build-ncerm.mjs     EA NCERM WFS → band recession distance → coastal erosion risk
public/data/sssi.geojson    bundled SSSI polygons (committed)
public/data/hona.geojson    bundled opportunity areas (committed)
public/data/dwt-reserves.geojson  bundled DWT reserves from OSM (committed)
public/data/dwt-centres.geojson   curated DWT visitor-centre points (committed)
public/data/water.geojson   watercourse lines — river/canal/stream/ditch/drain (committed)
public/data/water-bodies-named.geojson  exactly 2 verified fills: Fleet + Poole Harbour
public/data/alc.geojson     Provisional ALC grades (committed)
public/data/alc-post1988.geojson  detailed Post-1988 ALC resurvey, 3a/3b (committed)
public/data/crome.pmtiles   Field crops (CROME) dissolved field blocks, vector tiles
public/data/species-grid.geojson  NBN species record grid — cells only, no coordinates
public/data/marine.geojson  marine protected areas — MCZ / marine SAC / coastal SPA (outlined)
public/data/ncerm.geojson   coastal erosion risk frontages — { risk, dist } (committed)
```

## Adding a layer (built for growth)

Layers are data-driven. To add one, append an entry to the `dataLayers` array in
`src/map/layers.js`, add it to a `panelGroups` group, and drop its GeoJSON in
`public/data/` — the map renders it and the panel grows a toggle automatically.
No other code changes. Array order is the **draw** order, top-first. Hover is
resolved by an explicit per-feature **priority** (markers > waterways > washes),
so a layer can sit low in the draw stack yet still win the card. `kind` is
`'polygon'`, `'point'`, `'mixed'` (polygons + markers from one source — give it
`markerPaint`), `'waterways'` (GeoJSON lines + labels, no fills),
`'choropleth'` (a graded fill by `field`, optionally a second `detailData` source
on top — the ALC ramp), `'croptiles'` (a PMTiles vector fill by category, zoom
-gated — CROME), `'speciesgrid'` (a grid filtered to one `species` at a time — its
controller gains `setSpecies`), `'marine'` (outlined areas with one line layer per
designation type, faint hover-fill — the marine protected areas), or `'erosion'`
(a banded fill by `field` — coastal erosion risk). `card(props)` declares the hover
card, and may return a `link: { href, label }` for an interactive "More info" link.
A `panelGroups` group may carry an `about: { title, body }` drop-down, and a
**layer** may carry its own `about`, a `legend` (swatches), and/or a `species`
selector — all shown only while relevant layers are on.

```js
{
  id: 'nature-reserves',
  label: 'Local Nature Reserves',
  description: 'Designated reserves',
  group: 'Designations',          // panel grouping heading
  kind: 'polygon',                // or 'point' for markers
  data: `${import.meta.env.BASE_URL}data/nature-reserves.geojson`,
  accentVar: 'accent-3',          // palette token for the toggle + card accent
  defaultVisible: false,
  paint: { fillColor: '…', fillOpacity: 0.15, fillOpacityHover: 0.28,
           lineColor: '…', lineWidth: 1.2, lineWidthHover: 2.2 },
  // Build the hover card from a feature's properties (omit fields you don't want):
  card: (p) => ({ title: p.NAME, subtitle: 'Local Nature Reserve',
                  meta: `${p.area_ha} ha`, note: p.description || null }),
}
```

## Deploy to Cloudflare Pages

Static build, no backend.

- **Dashboard:** Create a Pages project from this repo with
  **Build command** `npm run build` and **Build output directory** `dist`.
- **Wrangler (direct upload):**

  ```bash
  npm run build
  npx wrangler pages deploy dist --project-name dorset-nature-map
  ```

No environment variables are required; data layers are static GeoJSON plus one PMTiles archive (CROME), read with HTTP range requests — served fine by Cloudflare Pages and any standard static host.
(If you later swap to a keyed tile provider, see `.env.example` and read the key
via `import.meta.env` in `src/map/mapStyle.js`.)

## Out of scope (deliberately, for this build)

AI analysis panel, drawing / area-selection tools, any backend, and Water
Framework Directive quality colouring for the rivers (a separate follow-on).
Just the map, the eight layers, the info card, and the aesthetic — done carefully.
