# Licence and provenance audit

Every data source in this repo, what it is licensed under, and whether the repo
currently satisfies that licence. Investigation only — nothing in this document
has been acted on.

**Audit date: 26 August 2026.** Every licence URL below was read on that date.

## How to read this

Three labels are used throughout, and they mean different things:

- **confirmed** — read from the actual licence text, or from the repo's own code
  and data, on the date given.
- **inferred** — a reasonable conclusion from evidence that is not the licence
  text itself: a build script header, a dataset title, the repo's own
  attribution line.
- **UNVERIFIED** — the licence text could not be reached. The gap is stated
  rather than filled.

### The limitation that runs through the whole audit

The **OGL v3.0 text is confirmed** — read in full at
<https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/> on
26 August 2026. What is **inferred** for most Crown sources is the *assignment*:
that this particular dataset is published under OGL. That comes from the build
script headers and the repo's own attribution bar, not from each dataset's own
metadata licence field, which was not opened one by one.

This matters. The repo asserts OGL for eleven Crown datasets and is very
probably right about all of them, but "the script header says OGL" is not the
same evidence as "the dataset's licence field says OGL". Anywhere the assignment
matters — a Trust wanting written comfort, a commercial reuse — the dataset's
own metadata page should be read before relying on this table.

---

## Table 1 — inventory

| # | Source | Publisher | Endpoint used | Vintage of the data **in this repo** | Committed files |
|---|---|---|---|---|---|
| 1 | OpenStreetMap — coastline | OSM contributors | Overpass API `https://overpass-api.de/api/interpreter` | Live extract at build; committed 2026-08-24 | `coastline.geojson` |
| 2 | OpenStreetMap — waterways | OSM contributors | Overpass API, same endpoint | Live extract at build; committed 2026-08-16 | `water.geojson`, `water-bodies-named.geojson` |
| 3 | OpenStreetMap — basemap tiles | OpenFreeMap / OpenMapTiles | `https://openfreemap.org` (runtime) | Rolling | *none — runtime only* |
| 4 | Marine protected areas (MCZ, SAC, SPA) | Natural England / JNCC | `services.arcgis.com/JJzESW51TqeY9uat/.../Marine_Conservation_Zones_(Natural_England)`, `Special_Areas_of_Conservation_England`, `Special_Protection_Areas_England` | Service current at 2026-08-16 (no version field captured) | `marine.geojson` |
| 5 | Storm overflow annual returns (EDM) | Environment Agency | `services1.arcgis.com/JZM7qJpmv7vJ0Hzx/.../edm_annual_returns_all_years_public/FeatureServer/0` | **2025 returns** (`year: 2025` in every feature — confirmed) | `storm-overflows.geojson`, `storm-overflow-names.json` |
| 6 | WFD transitional & coastal water bodies | Environment Agency | `services3.arcgis.com/Bb8lfThdhugyc4G3/.../WFD_Transitional_and_Coastal_Water_Bodies_Cycle_4_Classification_2025/FeatureServer/0` | **Cycle 4, 2025 classification** (confirmed: `year: 2025`) | `wfd-coastal.geojson` |
| 7 | WFD river catchments + management catchments | Environment Agency | same org, `Simplified_WFD_River_Water_Body_Catchments_Cycle_4_Classification_2025`; plus `services1.arcgis.com/JZM7qJpmv7vJ0Hzx/.../Man_Cats_SW_C3` | Cycle 4 (2025) and **Cycle 3** for management catchments — the script notes C3 is the only open version | `catchment-boundary.geojson` |
| 8 | Bathing water register + classifications | Environment Agency | `https://environment.data.gov.uk/doc/bathing-water.json`, `.../bathing-waters-monitoring-locations/ogc/features/v1` | **2025 classification**, history from 2015 (confirmed: `clsYear: 2025`, `histFrom: 2015`) | `bathing-waters.geojson` |
| 9 | Sea flood risk extents (NaFRA2) | Environment Agency | `.../rivers-and-sea-defended-and-undefended-flood-risk-extents-climate-change/ogc/features/v1`, collections `Rivers_1in100_Sea_1in200_{un,}defended_extents_CCP1` and the 1-in-1000 pair | **NaFRA2, December 2024**; UKCP18 RCP 8.5 upper end, to 2125 (confirmed from script header) | `sea-flood-200u/200d/1000u/1000d.geojson` |
| 10 | National Coastal Erosion Risk Map | Environment Agency | `.../geoservices/datasets/9fede91f-…/wfs`, type `NCERM_NFI_2055_70CC` | **NCERM National 2024**, No Future Intervention to 2055 (confirmed from script header) | `ncerm.geojson` |
| 11 | Marine licensing + Cefas disposal grounds | MMO / Cefas | `services.arcgis.com/JJzESW51TqeY9uat/.../S4_Marine_Licensable_Activities_Sep25/FeatureServer` | **September 2025 extract** (in the service name — confirmed) | `marine-licensing.geojson` |
| 12 | Fishing activity, VMS heatmap | MMO, DTU Aqua, JNCC, Natural England, UKHO | `.../Fisheries_Heatmap_webmap__2019_to_2022__WFL1/FeatureServer/7` | **2019–2022**, published Dec 2024 (confirmed from script header) | `fisheries.geojson` |
| 13 | Recreational vessel density (AIS) | MMO & MCA | `.../Short_Sea_Shipping_Recreational_Vessels_Update/FeatureServer/1` | **2015 AIS** — a decade old, and the script says so plainly | `recreational-pressure.geojson` |
| 14 | UKSeaMap seabed habitats | JNCC, via EMODnet Seabed Habitats | WFS `https://ows.emodnet-seabedhabitats.eu/geoserver/emodnet_open/wfs`, type `emodnet_open:ukseamap_latest_habitats` | `…_latest_` — **the service does not expose a version in the type name**; vintage not captured at build | `seabed.geojson` |
| 15 | Wrecks and obstructions | UK Hydrographic Office | `https://datahub.admiralty.co.uk/portal/sharing/rest/content/items/4dbf2ace22bf4f9785fb445d0593bc2c/data` | Not captured; committed 2026-08-18 | `wrecks.geojson` |
| 16 | Protected wreck sites (NHLE) | Historic England | `services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/.../Centre_point___National_Heritage_List_for_England_(NHLE)___Protected_Wreck_sites/FeatureServer/0` | Not captured; committed 2026-08-18 | `wrecks-protected.geojson` |
| 17 | Species occurrence records — marine | NBN Atlas **contributing datasets** | `https://records-ws.nbnatlas.org/occurrences/search` (facet queries) | Live query at build; committed 2026-08-16 | `marine-species/*.geojson` (18 files) |
| 18 | Species occurrence records — land | NBN Atlas **contributing datasets** | same endpoint | Live query at build; committed 2026-08-16 | `species-grid.geojson` (dormant layer) |
| 19 | Countries boundary (coastline mask) | Office for National Statistics | `services1.arcgis.com/ESMARspQHYMw9BZ9/.../Countries_December_2025_Boundaries_UK_BFC/FeatureServer/0` | **December 2025** (in the service name) | *no file — shapes `marine-species/*.geojson`* |
| 20 | Live storm overflow status | The water companies, via Stream / Water UK | Four ArcGIS FeatureServers (South West, Southern, Wessex, Thames) — see `src/map/liveOverflows.js` | Fetched at **runtime**, never committed | *none* |
| 21 | Crop Map of England | Rural Payments Agency | `.../crop-map-of-england-2024/ogc/features/v1` | **2024** | `crome.pmtiles` (dormant layer) |
| 22 | SSSI | Natural England | `.../SSSI_England/FeatureServer/0/query` | Not captured | `sssi.geojson` (dormant) |
| 23 | Agricultural Land Classification | Natural England (ADAS & Defra) | `services.arcgis.com/JJzESW51TqeY9uat/…` | Not captured | `alc.geojson`, `alc-post1988.geojson` (dormant) |
| 24 | Dorset nature recovery / HONA | Dorset Council | Local Habitat Map spatial download | Not captured | `hona.geojson` (dormant) |
| 25 | DWT reserves | Dorset Wildlife Trust (list) + OSM (boundaries) + Nominatim (geocoding) | `dorsetwildlifetrust.org.uk`, Overpass, `nominatim.openstreetmap.org` | Not captured | `dwt-reserves.geojson`, `dwt-centres.geojson` (dormant) |
| — | **Derived, no external source of its own** | this repo | — | Built from #5, #6, #11, #12 | `compound-pressure.geojson` |
| — | **Derived** | this repo | — | Built from `compound-pressure`, `catchment-boundary`, `wfd-coastal`, **and `coastline`** | `pinnable-area.geojson` |
| — | **Derived** | this repo | — | Built from the committed layers | `search-index.json` |

## Table 2 — licence position

"Repo satisfies?" is about the attribution actually shipped in
`src/map/createMap.js` and in the repo itself.

| # | Source | Licence | Verified? | (a) Republish derived data in a public repo | (b) A Wildlife Trust reusing it | (c) Commercial reuse | Repo satisfies attribution? |
|---|---|---|---|---|---|---|---|
| 1, 2 | OSM coastline & waterways | **ODbL 1.0** | **confirmed** — full text read 2026-08-26 | Yes, **but only under ODbL** and with the licence or its URI included | Yes, same terms; share-alike travels | Yes — ODbL has no commercial restriction | **No.** Map credit present; database notice missing. See Q1 |
| 3 | OpenFreeMap tiles | **MIT** (service), OSM data ODbL | **confirmed** — read 2026-08-26 | n/a (runtime) | Yes | **Yes**, explicitly | **Yes** — required string present |
| 4–13, 19, 21–24 | Crown / public-sector datasets | **OGL v3.0** | Text **confirmed**; assignment **inferred** (see above) | Yes | Yes | **Yes**, explicitly | **Partly.** Credits present, but the OGL statement and link are missing from the active bar |
| 14 | UKSeaMap via EMODnet | **CC BY 4.0** at the portal | **confirmed** — read 2026-08-26 | Yes | Yes | Yes | **Partly** — see the wording gap below |
| 15 | UKHO wrecks | Repo asserts OGL | **UNVERIFIED** | Unresolved | Unresolved | Unresolved | Cannot be assessed |
| 16 | Historic England NHLE | Repo asserts OGL | **UNVERIFIED** | Unresolved | Unresolved | Unresolved | Cannot be assessed |
| 17, 18 | NBN Atlas | **Per dataset.** CC BY 4.0 default; **CC BY-NC present** | **confirmed** — read 2026-08-26 | Only if no NC dataset contributed — **not currently demonstrable** | Yes for non-commercial use | **No, not without a per-dataset audit** | **Partly** — generic credit only, no Data Partner names |
| 20 | Stream / Water UK live status | Not stated in any text reached | **UNVERIFIED** | n/a (never committed) | Unresolved | Unresolved | Credit present; terms unknown |
| 25 | DWT reserves | Mixed: list © DWT, boundaries ODbL, geocoding via Nominatim | **UNVERIFIED** for the DWT list | Unresolved | Unresolved | Unresolved | Dormant layer; credit present when enabled |

---

## The licence clauses, quoted

### Open Government Licence v3.0
Read at <https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/> on **26 August 2026**. **Confirmed.**

Permission — "You are free to: copy, publish, distribute and transmit the
Information; adapt the Information; **exploit the Information commercially and
non-commercially** for example, by combining it with other Information, or by
including it in your own product or application".

Attribution — you must "acknowledge the source of the Information in your
product or application by including or linking to any attribution statement
specified by the Information Provider(s)". Where none is specified, the default
wording is:

> **Contains public sector information licensed under the Open Government Licence v3.0.**

Non-endorsement — "This licence does not grant you any right to use the
Information in a way that suggests any official status or that the Information
Provider and/or Licensor endorse you or your use of the Information."

Onward compatibility — "These terms are **compatible with the Creative Commons
Attribution License 4.0** and the Open Data Commons Attribution License". This
is what makes every OGL source in this repo safe to re-release under CC BY 4.0.

### ODbL 1.0
Read at <https://opendatacommons.org/licenses/odbl/1-0/> on **26 August 2026**. **Confirmed.**

- **Derivative Database** — "a database based upon the Database, and includes any
  translation, adaptation, arrangement, modification, or any other alteration of
  the Database or of a Substantial part of the Contents."
- **Produced Work** — "a work (such as an image, audiovisual material, text, or
  sounds) resulting from using the whole or a Substantial part of the Contents
  (via a search or other query) from this Database."
- **Extraction** — "the permanent **or temporary** transfer of all or a
  Substantial part of the Contents to another medium by any means or in any form."
- **§4.2 Notices** — when publicly conveying, "(a) Do so only under the terms of
  this License or another license permitted under Section 4.4; (b) **Include a
  copy of this License (or, as applicable, a license permitted under Section 4.4)
  or its Uniform Resource Identifier (URI) with the Database or Derivative
  Database.**"
- **§4.3 Notice for Using Output** — "if you Publicly Use a Produced Work, You
  must include a notice associated with the Produced Work reasonably calculated
  to make any Person that … is otherwise exposed to the Produced Work aware that
  Content was obtained from the Database."
- **§4.4 Share Alike** — "Any Derivative Database that You Publicly Use must be
  only under the terms of: (i) This License; (ii) A later version of this License
  similar in spirit to this License; or (iii) A compatible license." And:
  "**Extraction or Re-utilisation of the whole or a Substantial part of the
  Contents into a new database is a Derivative Database** and must comply with
  Section 4.4."
- **§4.5 Limits of Share Alike** — "Using this Database, a Derivative Database,
  or this Database as part of a Collective Database **to create a Produced Work
  does not create a Derivative Database** for purposes of Section 4.4."
- **§4.6 Access to Derivative Databases** — "If You Publicly Use a Derivative
  Database or a Produced Work from a Derivative Database, You must also offer to
  recipients … a copy in a machine readable form of: (a) The entire Derivative
  Database; or (b) A file containing all of the alterations made to the Database."

OSM's own statement of the same, read at
<https://www.openstreetmap.org/copyright> on **26 August 2026**: "You are free
to copy, distribute, transmit and adapt our data, as long as you **credit
OpenStreetMap and its contributors**." And: "If you alter or build upon our data,
you may distribute the result **only under the same license**."

### OSMF Community Guidelines
Read at <https://osmfoundation.org/wiki/Licence/Community_Guidelines> and the
Substantial and Produced Work guidelines on **26 August 2026**. **Confirmed.**

Status — "what a Licensor says carries weight with users of our data and,
potentially, to a judge. A court would make a final decision on the issue".
Advisory, not binding.

Substantial — "Means substantial in terms of quantity or quality or a
combination of both", with "less than 100 Features" given as insubstantial. The
guideline **does not address using OSM data as a filter, mask or classifier**,
nor deriving a database that contains no OSM coordinates. Directly relevant to
Q2 below.

Produced Work — "If the published result of your project is intended for the
extraction of the original data, then it is a database and not a Produced Work",
and "Database dumps are usually not Produced Works".

### EMODnet Seabed Habitats
Read at
<https://emodnet.ec.europa.eu/en/terms-use-emodnet-online-services-data-and-data-products>
on **26 August 2026**. **Confirmed.**

"licensed under Creative Commons CC-BY 4.0". Required wording for a source
dataset accessed through the portal:

> This data was downloaded from the EMODnet Portal
> (https://emodnet.ec.europa.eu/en/). The data originator(s) is/are [name].

Caveat, and it is a per-dataset one: "Individual source datasets aggregated
within EMODnet may carry their own separate licenses. Users must verify metadata
for each dataset's specific terms." UKSeaMap's originator is JNCC, and **JNCC's
own terms for UKSeaMap were not read** — UNVERIFIED.

### NBN Atlas — **the licence differs per dataset**
Read at <https://docs.nbnatlas.org/nbn-atlas-terms-of-use/> on **26 August 2026**. **Confirmed.**

This is the source the brief singled out, and it is the one that behaves least
uniformly:

- "Data and images on the NBN Atlas have an associated licence outlining the
  circumstances under which the data can be used."
- "At the time of adding your Content you should nominate the type of licence
  which will apply to your Content" — **the contributing Data Partner sets it,
  per dataset**.
- CC BY 4.0 is the default "when no specific terms are identified".
- **"Data with a CC-BY-NC licence cannot be used for commercial purposes without
  prior agreement."**
- **"Using information gained by viewing data on the NBN Atlas for commercial
  purposes is a breach of the CC-BY-NC licence."**
- Attribution: users "agree to acknowledge, reference or attribute the relevant
  **Data Partner** (using any specific attribution wording they may have
  provided)".

**What the repo does, confirmed by reading `scripts/lib/osgrid.mjs` and both
species builds:** the NBN queries filter on `taxon_name` and `gridSizeInMeters`
and nothing else. No licence filter. No capture of `dataResource`,
`dataProvider` or any licence field. The output is an aggregate count per grid
square, summed across **every contributing dataset regardless of its licence**.

So the repo cannot presently say which Data Partners contributed to
`marine-species/*.geojson` or `species-grid.geojson`, cannot name them as the
terms require, and cannot demonstrate that no CC BY-NC dataset is in the mix.
The aggregate-count form is a genuine mitigation — no record is reproduced — but
"information gained by viewing data … for commercial purposes" is drafted
broadly enough that the aggregate does not clearly escape it.

### OpenFreeMap
Read at <https://openfreemap.org/> on **26 August 2026**. **Confirmed.**
MIT for the service; required credit "OpenFreeMap © OpenMapTiles Data from
OpenStreetMap"; commercial use "Yes".

### Could not be reached — UNVERIFIED

| Source | What was tried, 26 August 2026 | Result |
|---|---|---|
| UKHO wrecks | `datahub.admiralty.co.uk` item page for `4dbf2ace…`; the INSPIRE knowledge-base article KBA-01021 | Item page returned no content; KB article "unavailable" |
| Historic England NHLE | `historicengland.org.uk/terms/website-terms-conditions/`; `opendata-historicengland.hub.arcgis.com` | HTTP **403**; hub page returned only a heading |
| Stream / Water UK | `streamwaterdata.co.uk/pages/openness-and-transparency`; web search | Page returned only "Stream - Portal"; no terms text located |
| JNCC UKSeaMap originator terms | not reached | UNVERIFIED |
| ONS boundaries | not reached | OGL **inferred** from the build script header only |
| Nominatim usage policy | not reached | UNVERIFIED (dormant layer only) |

For all six, the repo's asserted licence may well be right. It is not evidenced
here, and it should not be relied on as if it were.

---

## Attribution: what is missing today

Read from `src/map/createMap.js` on 26 August 2026. **Confirmed.**

1. **No repo-level licence file at all.** No `LICENSE`, no `COPYING`, no notice
   file, and no notice inside `public/data/`. The string `ODbL` does not appear
   anywhere in `src/` — only in a header comment in
   `scripts/fetch-coastline.mjs`.
2. **The OGL attribution statement is absent from the active attribution bar.**
   The bar says "OGL" as bare text eleven times. The default statement
   ("Contains public sector information licensed under the Open Government
   Licence v3.0.") appears nowhere, and the only link to the licence lives in
   `DORSET_LAND_ATTRIBUTION`, which is behind `SHOW_DORSET_LAND_LAYERS = false`
   and therefore renders nowhere. OGL asks for the statement to be *included or
   linked*; today neither happens for the active layers.
3. **Two active layer groups are not credited at all:**
   - **Bathing waters** (`bathing-waters.geojson`, 193 sites) — no line mentions
     bathing water.
   - **Sea flood risk** (four layers, ~4.5 MB) — no line mentions flood risk or
     NaFRA2.
   Both are Environment Agency. The bar credits the EA for storm overflows, WFD
   and coastal erosion, so a generous reading covers them; a strict one does not
   name them.
4. **ONS is not credited.** The December 2025 Countries boundary shapes every
   marker position in `marine-species/*.geojson` — a build input that determines
   output geometry, not a passing reference.
5. **EMODnet's required wording is not used.** The bar reads "Seabed habitats:
   UKSeaMap © JNCC via EMODnet Seabed Habitats". The terms ask for "This data was
   downloaded from the EMODnet Portal (https://emodnet.ec.europa.eu/en/). The
   data originator(s) is/are [name]." The substance is there; the required form
   is not.
6. **NBN Data Partners are not named** — see above. "Species records: NBN Atlas
   contributors" credits the aggregator, not the Data Partners the terms name.

What the repo **does** get right: OpenFreeMap's required string is present and
correct; OpenStreetMap is credited with a link to the copyright page; the VMS
heatmap carries its full five-body credit line; the wrecks layer carries the
"not for navigation" warning; and every credit is on the map itself rather than
in a footnote, which is where the licences want it.

---

## Q1 — `coastline.geojson`, ODbL: what is required, and does the repo comply?

**What ODbL requires**, for a file of OSM data committed to a public repo:

The repo does two distinct things with this data, and ODbL treats them
differently.

**As a Produced Work — the rendered map.** §4.3 requires "a notice associated
with the Produced Work reasonably calculated to make any Person that … is
otherwise exposed to the Produced Work aware that Content was obtained from the
Database". **This is satisfied.** The attribution bar carries "© OpenStreetMap"
linked to <https://www.openstreetmap.org/copyright>, permanently visible on the
map. Confirmed by reading `createMap.js` and by observing the rendered bar.

**As a Database — the committed file.** This is where it fails. `coastline.geojson`
is a bbox extract of `natural=coastline` ways: a Substantial part of the
Contents, transferred to another medium, which §4.4b makes a Derivative Database
outright — "Extraction or Re-utilisation of the whole or a Substantial part of
the Contents into a new database is a Derivative Database". Publishing it
therefore triggers §4.2: it must be conveyed "only under the terms of this
License", and a copy of the licence "**or its Uniform Resource Identifier (URI)**"
must be included "with the Database or Derivative Database".

**Does the repo comply? Partly, and the gap is real.**

| Requirement | Status |
|---|---|
| §4.3 Produced Work notice | **Satisfied** — persistent OSM credit on the map |
| OSM's "credit OpenStreetMap and its contributors" | **Satisfied** |
| §4.2(a) conveyed under ODbL | **Not satisfied** — the repo states no licence for its data at all |
| §4.2(b) licence copy or URI included with the database | **Not satisfied** — no LICENSE file, no notice in `public/data/`, and "ODbL" appears nowhere in `src/` |
| §4.6 machine-readable copy offered | **Satisfied in substance** — the whole file is in the public repo |

The same finding applies unchanged to **`water.geojson`** and
**`water-bodies-named.geojson`**, which are the same Overpass extraction of a
different tag set, and to `dwt-reserves.geojson` in the dormant set.

The shortfall is a notice, not a use: nothing here is being used in a way ODbL
forbids. But §4.2(b) is not decorative — it is what tells the next person down
the chain that share-alike attaches, and without it a reuser has no way to know
from the repo that these three files are not on the same footing as the OGL ones
beside them.

## Q2 — does share-alike reach `pinnable-area.geojson`?

**What the build actually does.** Confirmed by reading
`scripts/build-pinnable-area.mjs`:

- The **output geometry** is assembled from the committed 2 km sea grid
  (`compound-pressure.geojson`), the sea portion of `catchment-boundary.geojson`,
  every transitional water body from `wfd-coastal.geojson`, and a turf buffer.
  All of that traces to Environment Agency sources, not OSM.
- `coastline.geojson` is used **only as a classifier**. The coastline points are
  split into corridor and non-corridor by the catchment boundary, and each sea
  cell is kept or dropped according to which side its *nearest* coast point falls
  on. The script asserts it has at least 5,000 coastline points to work with.
- **No OSM coordinate ends up in the output file.**

**The clauses this turns on:**

§4.4b is the operative test — "**Extraction or Re-utilisation of the whole or a
Substantial part of the Contents into a new database is a Derivative Database**
and must comply with Section 4.4."

Against that, the definition of Derivative Database — "a database based upon the
Database, and includes any translation, adaptation, arrangement, modification,
or any other alteration of the Database **or of a Substantial part of the
Contents**."

And the definition of Extraction, which is deliberately wide — "the permanent
**or temporary** transfer of all or a Substantial part of the Contents to another
medium by any means or in any form."

**The argument that share-alike applies:** the build performs a temporary
Extraction of the whole corridor coastline — thousands of points, systematic, not
a handful of features — and the resulting database is "based upon" it in the
strong sense that which cells exist in the output is *determined* by it. Remove
the coastline and you get a materially different file; four earlier derivations
failed precisely because they lacked it, which the script records. Extraction
expressly includes temporary transfer, so "none of it survives in the output" is
not by itself an answer.

**The argument that it does not:** ODbL's Derivative Database definition is about
*altering* the Database or its Contents. `pinnable-area.geojson` alters nothing
from OSM; it is a different database, built from other sources, whose row
selection was informed by an OSM query. Nothing was re-utilised *into* it. On
that reading the coastline was a test applied during the build, in the way a
validation check is, and the output is not a Derivative Database at all.

**The Produced Work escape does not help.** §4.5b exempts Produced Works, but
`pinnable-area.geojson` is a GeoJSON dataset, and the OSMF Produced Work
guideline is explicit — "If the published result of your project is intended for
the extraction of the original data, then it is a database and not a Produced
Work". A file the browser fetches and runs point-in-polygon tests against is a
database.

**The answer is genuinely uncertain, and I am not going to pretend otherwise.**
The OSMF Substantial guideline — the one place this would be resolved — **does
not address using OSM data as a filter, mask or classifier**, and its numeric
thresholds are about how many features you take, not what you do with them.
I read it on 26 August 2026 for exactly this question and it is silent. The
guidelines are advisory in any case: "A court would make a final decision on the
issue."

**My reading, stated as a judgement rather than a fact:** share-alike more
likely than not attaches. The extraction was systematic and Substantial, the
dependency is causal rather than incidental, and ODbL's drafting of Extraction to
cover temporary transfers points that way. I would treat
`pinnable-area.geojson` as a Derivative Database.

The practical point is that it barely matters here: `coastline.geojson` is
committed in the same repo and is unambiguously ODbL. Licensing both files ODbL
costs nothing that is not already owed on the coastline, and removes the question.
If you wanted the question genuinely gone, the alternative is to reach the same
corridor/non-corridor split from a non-OSM coastline — the ONS Countries boundary
is already a build dependency and would do it.

## Q3 — what blocks a CC BY 4.0 release of the whole derived dataset?

Two sources block it outright, and three more are unresolved.

**1. OpenStreetMap — ODbL. Definite blocker.**
Affects `coastline.geojson`, `water.geojson`, `water-bodies-named.geojson`, and
— on the reading above — `pinnable-area.geojson`. §4.4 permits a Derivative
Database only under ODbL, a later ODbL, "or a compatible license", and
compatibility there means a licence carrying equivalent share-alike. CC BY 4.0
has no share-alike, so it does not qualify.
*What it requires instead:* keep these files under **ODbL**, and release the rest
under CC BY 4.0 — a split licence with a per-file statement. That is the normal
arrangement and it is honest; a blanket CC BY 4.0 over the whole `public/data`
directory would misdescribe four of its files.

**2. NBN Atlas — per-dataset licences including CC BY-NC. Definite blocker as
things stand.**
Affects `marine-species/*.geojson` (18 files, the active layer) and
`species-grid.geojson` (dormant). "Data with a CC-BY-NC licence cannot be used
for commercial purposes without prior agreement", and CC BY 4.0 grants exactly
the commercial permission an NC dataset withholds. The repo does not record
which Data Partners contributed, so it cannot show that no NC dataset is in the
aggregate.
*What it requires instead:* either (i) re-run the builds capturing
`dataResource`/licence per record, exclude every NC dataset, and record the
Data Partner list — after which CC BY 4.0 is available for those files and the
required Data Partner attribution can actually be given; or (ii) keep the
species files under **CC BY-NC 4.0** and out of the CC BY release.

**3–5. Unresolved, because the licence text could not be read.**
- **UKHO wrecks** (`wrecks.geojson`, 3,664 features) — repo asserts OGL. If OGL,
  CC BY 4.0 is fine, since OGL states compatibility with it. Until the licence
  is read this is not established, and the "not for navigation" condition the
  repo already displays would need to travel with any re-release.
- **Historic England NHLE** (`wrecks-protected.geojson`) — same position.
- **JNCC UKSeaMap via EMODnet** (`seabed.geojson`) — EMODnet's portal terms are
  CC BY 4.0 and compatible, but those same terms warn that originator datasets
  "may carry their own separate licenses". JNCC's terms for UKSeaMap were not
  read.

**Not a blocker:** every OGL source — the Environment Agency, Natural England,
MMO, Cefas, RPA and ONS datasets, which is the bulk of the repo by volume. OGL
says so itself: "These terms are compatible with the Creative Commons
Attribution License 4.0". The condition is that the OGL attribution statement
travels with them, which is currently missing and would have to be added first.

**Not in scope:** the live storm overflow status (#20) is fetched at runtime and
never committed, so it is not part of any dataset release — though its terms
remain unverified for the map itself.
