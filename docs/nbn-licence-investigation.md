# NBN Atlas: what is actually in the committed species files

The licence audit (`docs/licence-audit.md`) found that the species builds capture
no licence field, so the repo could not show whether the 19 committed NBN files
contain CC-BY-NC records. This answers that by querying the API rather than
reasoning about it.

**Investigation date: 26 August 2026.** Every figure below comes from
`records-ws.nbnatlas.org` and `registry.nbnatlas.org` on that date, queried with
the same parameters the builds use. 199 API calls. Nothing was rebuilt and no
committed file was touched.

## The answer, first

**Yes. Every one of the 18 marine files contains CC-BY-NC records, and so does
the land grid. 43,804 of 45,591 records in scope for the marine files — 96% —
are CC-BY-NC.** Fourteen of the 37 contributing data resources are CC-BY-NC 4.0.

This is **confirmed**, from the licence facet on the occurrence index and
independently from each data resource's `licenseType` in the registry. The two
agree on every resource checked.

---

## 1. Which fields expose licence and Data Partner, and where

**Confirmed** — `GET https://records-ws.nbnatlas.org/index/fields` returns 647
indexed fields. The relevant ones, all `indexed=true` and therefore facetable
and filterable:

| Field | What it holds |
|---|---|
| **`license`** | the processed licence, as one of `CC0`, `CC-BY`, `CC-BY-NC`, `OGL` |
| `raw_license`, `raw_licenseType`, `raw_licenseVersion` | as supplied, before processing |
| **`dataResourceUid`** | the dataset's registry id, e.g. `dr1488` |
| `dataResourceName` | the dataset's display name |
| **`dataProviderName`**, `dataProviderUid` | the Data Partner |
| `rightsHolder`, `rights`, `accessRights` | free-text, not the licence |

`license` is the field. It sits on the **occurrence search endpoint the builds
already call** — `https://records-ws.nbnatlas.org/occurrences/search` — so no
new endpoint is needed to answer the licence question.

The licence **version** is not on the occurrence index; only the family
(`CC-BY-NC`, not `CC-BY-NC 4.0`). The version lives on the registry:
`GET https://registry.nbnatlas.org/ws/dataResource/{uid}` returns `licenseType`
and `licenseVersion`, plus `citation` — the "specific attribution wording"
NBN's terms refer to. Two worked examples, **confirmed** by fetching them:

```
dr1488  licenseType CC-BY-NC  licenseVersion 4.0  citation: null
        UK Basking Shark sightings from 1987 to 2016 — Marine Conservation Society

dr838   licenseType CC-BY-NC  licenseVersion 4.0
        citation: "Isle of Wight Local Records Centre ([Insert download year]).
                   IOW Natural History & Archaeological Society Marine Records.
                   Occurrence dataset on the NBN Atlas"
```

## 2. Can the existing queries be extended, or is a second call needed?

Three separate questions, with three different answers.

**Licence split — no extra call.** `gridCells()` in `scripts/lib/osgrid.mjs`
already sends `facet=on` and `facets=<grid field>`. `facets` accepts repeats, so
adding `facets=license` to the existing request returns the licence breakdown
alongside the grid cells at no additional cost. **Confirmed** by running it
against the live API with the builds' own `wkt`, `fq=taxon_name:"…"` and
`fq=gridSizeInMeters:[1 TO res]`.

**Excluding NC — no extra call either.** `fq=-license:"CC-BY-NC"` appended to
the existing request filters them out server-side. **Confirmed** — this is how
the "cells if NC dropped" column below was produced.

**Naming the Data Partners — one extra call per species, plus one per resource.**
The grid facet cannot also carry the resource breakdown in a usable pairing, so
identifying which resources contributed needs its own
`facets=dataResourceUid` request per species (18 for the marine set). Note the
facet's `label` is the resource's *display name*; the uid is in the `fq` field
of each result:

```json
{ "label": "UK Basking Shark sightings from 1987 to 2016",
  "i18nCode": "dataResourceUid.dr1488",
  "count": 6406,
  "fq": "dataResourceUid:\"dr1488\"" }
```

Reading `label` as the uid gives a 404 against the registry — worth knowing
before writing that loop.

Then the licence **version** and the per-dataset **citation wording** need one
registry call per distinct resource: 37 for the marine set. Those are static
metadata and cache trivially.

So: the load-bearing licence question costs nothing. Full attribution costs
18 + 37 = 55 additional calls on a full rebuild.

## 3. What the 19 committed files actually contain

Queried with each build's own parameters, including the per-species grid
resolution that `resolutionProfile()` selects, so these are the records the
committed files were actually derived from. **All confirmed.**

### The 18 marine files

| file | records in scope | CC-BY-NC | CC-BY | CC0 | OGL | resources | partners | cells now | cells if NC dropped |
|---|---|---|---|---|---|---|---|---|---|
| `greyseal` | 11,919 | **11,609** (97%) | 145 | 145 | 20 | 14 | 10 | 133 | **75** (56%) |
| `harbourseal` | 989 | **955** (97%) | 29 | 2 | 3 | 7 | 5 | 81 | **22** (27%) |
| `commondolphin` | 10,675 | **10,672** (100%) | 1 | 2 | 0 | 7 | 7 | 136 | **2** (1%) |
| `bottlenose` | 1,654 | **1,630** (99%) | 19 | 5 | 0 | 9 | 9 | 107 | **17** (16%) |
| `porpoise` | 9,650 | **9,619** (100%) | 5 | 26 | 0 | 9 | 9 | 124 | **9** (7%) |
| `minkewhale` | 956 | **955** (100%) | 0 | 1 | 0 | 5 | 5 | 64 | **1** (2%) |
| `baskingshark` | 6,449 | **6,423** (100%) | 19 | 6 | 1 | 8 | 6 | 891 | **20** (2%) |
| `tope` | 29 | **23** (79%) | 6 | 0 | 0 | 7 | 6 | 13 | **5** (38%) |
| `thornbackray` | 232 | **11** (5%) | 173 | 5 | 43 | 11 | 8 | 118 | **112** (95%) |
| `undulateray` | 58 | **9** (16%) | 48 | 0 | 1 | 3 | 3 | 36 | **29** (81%) |
| `bluefin` | 1,574 | **1,571** (100%) | 3 | 0 | 0 | 5 | 4 | 59 | **3** (5%) |
| `seahorse` | 28 | **7** (25%) | 15 | 2 | 4 | 5 | 5 | 9 | **9** (100%) |
| `shortseahorse` | 44 | **4** (9%) | 36 | 1 | 3 | 6 | 5 | 21 | **17** (81%) |
| `cuttlefish` | 1,177 | **291** (25%) | 839 | 6 | 41 | 14 | 10 | 440 | **312** (71%) |
| `curledoctopus` | 98 | **1** (1%) | 88 | 0 | 9 | 7 | 5 | 42 | **41** (98%) |
| `commonoctopus` | 16 | **11** (69%) | 4 | 0 | 1 | 3 | 3 | 15 | **5** (33%) |
| `europeansquid` | 27 | **6** (22%) | 20 | 0 | 1 | 4 | 4 | 25 | **20** (80%) |
| `veinedsquid` | 16 | **7** (44%) | 9 | 0 | 0 | 4 | 3 | 16 | **9** (56%) |
| **all 18** | **45,591** | **43,804** (96%) | 1,459 | 201 | 127 | **37** | **22** | 2,330 | **708** (30%) |

Every file has at least one CC-BY-NC record. The lowest exposure is
`curledoctopus`, at one record; the highest is `commondolphin` at 10,672 of
10,675.

"cells now" is the count of occupied grid squares the API returns today; the
committed files hold 2,301 features against 2,330 cells, the difference being
the sea-correction step in `build-marine-species.mjs` dropping squares with no
sea, plus records added since the files were built on 16 August 2026.

### The 19th file — `species-grid.geojson`

The Dorset land grid, 8 species, queried on its own bbox. **Confirmed.**

| species | records | CC-BY-NC | |
|---|---|---|---|
| `sandlizard` | 34,686 | 34,494 | 99.4% |
| `smoothsnake` | 11,750 | 11,692 | 99.5% |
| `dartford` | 10,278 | 7,465 | 72.6% |
| `nightjar` | 4,519 | 3,133 | 69.3% |
| `gcnewt` | 1,732 | 1,079 | 62.3% |
| `ssblue` | 13,023 | 5,320 | 40.9% |
| `lulworth` | 7,588 | 3,107 | 40.9% |
| `ladybirdspider` | 28 | **0** | the only clean species in the repo |
| **total** | **83,604** | **66,290** | **79.3%** |

This file backs a dormant layer (`SHOW_DORSET_LAND_LAYERS` is false), but it is
committed and served.

### Records with no licence field

**None.** For all 26 species the licence facet counts sum exactly to the
in-scope record total, so no record in scope carries an absent licence value.
All 37 marine data resources return a `licenseType` from the registry; none is
null. The "absent is not permissive" case does not arise here — **confirmed** by
comparing facet sums against `totalRecords` per species, and by checking
`licenseType` on every resource individually.

### The CC-BY-NC resources, by weight

Fourteen of the 37 marine resources are CC-BY-NC 4.0, contributing 43,831
records:

| records | resource | Data Partner |
|---|---|---|
| 31,675 | ORKS Wildlife Recording Platform, Cornwall & Isles of Scilly | Environmental Records Centre for Cornwall & Isles of Scilly |
| 6,406 | UK Basking Shark sightings from 1987 to 2016 | Marine Conservation Society |
| 3,953 | Non-avian taxa (BTO+partners) | British Trust for Ornithology |
| 959 | National Mammal Atlas Project, online recording | Mammal Society |
| 316 | Conchological Society…: marine mollusc records | Conchological Society of GB & Ireland |
| 264 | Isle of Wight Notable Species | Isle of Wight Local Records Centre |
| 147 | Incidental Sightings of Bottlenose Dolphins in Sussex 2015-2021 | Sussex Dolphin Project |
| 40 | IOW Natural History & Archaeological Society Marine Records | Isle of Wight Local Records Centre |
| 22 | iSpot British Isles observations | iSpot |
| 21 | Incidental Sightings of Harbour Porpoise in Sussex 2017-2023 | Sussex Dolphin Project |
| 15 | Capture Mark Recapture Data for Scottish Elasmobranchs: 2009-2018 | Scottish Shark Tagging Programme |
| 7 | Malcolm Storey personal records and images | Malcolm Storey |
| 5 | 1743-2010 National Marine Aquarium UK Marine Fish Recording Scheme v3.0 | Marine Biological Association |
| 1 | 2009 MBA Wembury Bioblitz Survey v3.0 | Marine Biological Association |

**Two resources dominate.** ORKS alone is 31,675 records — 72% of all NC records
across the marine set — and the MCS basking shark dataset is another 6,406.
Between them they are 87% of the exposure.

**Three resources appear under more than one licence value** — National Mammal
Atlas Project, and (in the land set) records via iRecord for amphibians/reptiles
and for birds — each returning a mix of `CC-BY`, `CC-BY-NC` and `CC0`. So
licence cannot be treated as a property of the resource alone; it has to be read
per record. **Confirmed** from the cross-tab.

### What excluding CC-BY-NC would cost the map

**708 of 2,330 occupied cells survive — 30%. 1,622 cells would disappear.**

No species empties completely, but several stop being a layer worth drawing:

- **basking shark 891 → 20 cells (2%)** — the largest species in the set, and
  the one the MCS dataset is entirely responsible for
- **common dolphin 136 → 2**, **minke whale 64 → 1**, **bluefin 59 → 3**,
  **harbour porpoise 124 → 9**
- barely touched: **spiny seahorse 9 → 9**, **curled octopus 42 → 41**,
  **thornback ray 118 → 112**

The cephalopods and rays survive because they come mostly from Seasearch
(CC-BY), the MBA/DASSH resources (CC-BY) and JNCC/Natural England (OGL). The
marine mammals and basking shark are almost entirely ORKS and MCS, both NC.

## 4. What NBN requires as attribution, and how many partners

**Read from NBN's own documentation on 26 August 2026, not from a portal
summary.** From <https://docs.nbnatlas.org/nbn-atlas-terms-of-use/>:

> "agree to acknowledge, reference or attribute the relevant Data Partner (using
> any specific attribution wording they may have provided)"

> "Data with a CC-BY-NC licence cannot be used for commercial purposes without
> prior agreement."

> "Using information gained by viewing data on the NBN Atlas for commercial
> purposes is a breach of the CC-BY-NC licence."

From <https://docs.nbnatlas.org/cite-nbn-atlas-data/>:

> Data Partner records: **"Records provided by [Data Partner name], accessed
> through the NBN Atlas website"**

> The NBN Atlas itself: **"NBN Trust ([Year]). The National Biodiversity Network
> (NBN) Atlas. https://nbnatlas.org/"**

> users "must cite or acknowledge both the NBN Atlas and the individual Data
> Partners" and their datasets — applying to records licensed under **"OGL,
> CC-BY and CC-BY-NC"**, which is every licence in these files except CC0.

### How many would need naming

- **22 distinct Data Partners** for the 18 marine files.
- **35 distinct Data Partners** across all 26 species, if the dormant land grid
  is counted.
- **37 distinct data resources** (marine), **75** across all 26.
- **34 of the 37 marine resources carry their own `citation` string** in the
  registry — the "specific attribution wording they may have provided", which
  the terms say to use where given. Three do not, so the generic template
  applies to those.

The 22 marine Data Partners: Biological Records Centre · British Trust for
Ornithology · Conchological Society of Great Britain & Ireland · Environment
Agency · Environmental Records Centre for Cornwall & Isles of Scilly · Isle of
Wight Local Records Centre · Joint Nature Conservation Committee · Malcolm
Storey · Mammal Society · MammalWeb · Marine Biological Association · Marine
Conservation Society · National Trust · Natural England · Natural History
Museum, London · Natural Resources Wales · Porcupine Marine Natural History
Society · Scottish Shark Tagging Programme · Seasearch · Sussex Dolphin
Project · The Wildlife Trusts · iSpot.

The current attribution bar says "Species records: NBN Atlas contributors",
which credits the aggregator and names none of the 22. On NBN's wording that is
short of what the CC-BY, CC-BY-NC and OGL records all require.

---

## What this does and does not settle

**Settled, confirmed:** there are CC-BY-NC records in what is already published,
in every file, and they are the majority of the marine set by a wide margin. The
builds can capture licence at no extra cost. Naming the partners is 55 extra
calls and a list of 22 names.

**Not settled, and not for this document:** whether an *aggregate count per grid
square*, which is what these files hold, is itself "use for commercial purposes"
under CC-BY-NC. No individual record is reproduced — no coordinate, date,
recorder or determination — only "n records in this square". NBN's own wording
is broad: "Using information gained by viewing data on the NBN Atlas for
commercial purposes is a breach". Whether a derived count escapes that is a
judgement about the licence, not a fact the API can answer, and I am not going
to assert one. NBN has published separate guidance on the definition of
non-commercial use that would be the next thing to read if that question needs
settling.

What is not in doubt is that the map is a public, non-commercial project today,
and that the attribution requirement — naming the Data Partners — applies
regardless of which way the commercial question falls.

## Reproducing this

```
GET https://records-ws.nbnatlas.org/occurrences/search
    ?wkt=POLYGON((-6.2 49.85,0.245 49.85,0.245 51.1,-6.2 51.1,-6.2 49.85))
    &pageSize=0&facet=on&flimit=-1
    &fq=taxon_name:"Cetorhinus maximus"
    &fq=gridSizeInMeters:[1 TO 2000]
    &facets=license
```

Add `&fq=-license:"CC-BY-NC"` to see what survives exclusion; swap
`facets=dataResourceUid` for the contributing datasets; then
`GET https://registry.nbnatlas.org/ws/dataResource/{uid}` for `licenseType`,
`licenseVersion` and `citation`.

The land grid uses the same shape with
`POLYGON((-3.0 50.5,-1.65 50.5,-1.65 51.1,-3.0 51.1,-3.0 50.5))`.

Record counts move as partners add data — `greyseal` returned 11,921 records on
one call and 11,919 on another minutes later — so exact figures will drift.
The licence proportions will not drift meaningfully.
