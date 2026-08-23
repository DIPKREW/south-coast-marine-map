# Bathing waters — investigation record

Written before any build, in the same spirit as the four investigations that
came before it. Those four ended in a refusal. This one does not, and that makes
it more important rather than less to write down exactly what cleared the bar,
what was rejected on the way, and which traps were hit — because a layer that
gets built stops being scrutinised, and the reasons it was allowed need to
outlive the enthusiasm that built it.

Everything here was observed in a live response on **23 August 2026**. Where a
finding is my own construction rather than something a source states, it is
labelled **inferred** and the method is given.

## What cleared the bar

The four refusals turned on the same thing each time: the data would have made
the map say something the source could not support. Beach litter had no feed at
all and would have been rebuilt from PDFs. UK SeaMap's ArcGIS re-host was a
Cornwall-only extract that would have shipped habitat off Cornwall and blank sea
from Dorset eastward. The MMO 2019 vessel re-host had no ship-type breakdown and
an extent covering a patch of the Solent. The pre-2015 bathing water compliance
endpoint — see below — returns a valid, empty answer.

Bathing waters clear that bar on five counts, and it is worth being specific
because "the EA publishes it" is not by itself a reason:

- The endpoints are **live and official**, not re-hosts, verified by response.
- **OGL v3**, no key, no registration.
- The extent was **checked rather than assumed** — 464 records, longitude
  -5.698 to 1.749, every one flagged `country = England`.
- **Two independent EA services agree exactly** on the corridor count and on the
  classification distribution. Nothing else on this map has that.
- **38 years of individual sample records** sit underneath the headline
  classification, so the summary can be checked against the measurements.

That is a stronger provenance position than most layers already on the map. It
does not make every question answerable, and §4 through §7 are mostly about
which questions are not.

## 1. Four live services, three dead ends

Four things are live and usable:

| What | Endpoint | Shape |
|---|---|---|
| Bathing Water (registry) | `environment.data.gov.uk/doc/bathing-water.json` | linked-data JSON |
| Bathing Water Quality | `environment.data.gov.uk/doc/bathing-water-quality/…` | linked-data JSON |
| Bathing Waters Monitoring Locations | OGC API Features, dataset `fb8da72f-4938-4100-ac91-d9b8438ffd4c` | GeoJSON points |
| Areas Affecting Bathing Waters | OGC API Features, dataset `5cbec8b0-d465-11e4-9797-f0def148f590` | GeoJSON polygons |

All four are OGL v3. The registry metadata claims coverage of "England and
Wales"; that wording is **stale**, and the observed data contradicts it — no
Welsh site is returned, and Wales is NRW's to publish. It does not matter here,
since the corridor is entirely English, but it is a reminder that the metadata
record and the service can disagree and the service wins.

Three dead ends, each worth recording because each looks alive at a glance.

**The geometry URIs are 403.** Every record in the registry emits
`zoneOfInfluence` and `envelope` URIs on `location.data.gov.uk` — with human
labels like "Map bounds for Spittal" and "Zone of influence at Spittal", which is
about as close as a dataset comes to promising you a polygon. Every one of them,
including the `SamplingPoint` URI, returns **403 Forbidden** from an Azure
gateway. The API still emits them. They resolve to nothing. This is the second
time on this project that a plausible name has had to be tested rather than
trusted.

**There is no bathing-water WFS.** `…/spatialdata/bathing-waters/wfs` and two
obvious variants all return **404**. Search results and habit both point at a WFS
because every other EA spatial layer on this map has one; the working route here
is OGC API Features, which is a different service under a different path.

**The recurring trap, in its purest form yet.**
`/data/bathing-water-quality/compliance/point/{id}` returns **HTTP 200 with an
empty item list.** Not an error, not a 404 — a well-formed, valid, successful
response containing nothing. The current regime is `compliance-rBWD`; the bare
`compliance` slice is the pre-2015 directive and is genuinely empty for present
sites. A fetch script that checks `res.ok` and iterates `items` would report
success, write a file, and produce a layer with no classifications at all — and
the failure would look like a data problem, not a URL problem.

This is the same family as the MMO `CaseStatus` reading and the dead S3 links
behind the 2013–2015 vessel grids: **a legacy service that has not been taken
down, sitting one path segment away from the live one.** The lesson the project
keeps relearning is that HTTP 200 is not evidence, and the only check that works
is asserting a non-zero, plausible count against a known figure before writing
anything.

## 2. The corridor count, and the same over-coverage trap again

The registry holds **464 active** designated bathing waters in England. The
monitoring-locations layer holds **489**, the difference being 25 de-designated
sites it retains and the registry drops.

Filtering down with the project's three existing rules, in order:

| Filter | Count |
|---|---|
| England, active | 464 |
| inside fetch bbox `[-6.2, 49.85, 0.6, 51.1]` | 247 |
| and west of `BEACHY_HEAD_LON` 0.245 | 241 |
| and inside the catchment boundary | **193** |

**The bbox over-covers by 54 sites**, and it fails in exactly the way the vessel
density and marine licensing layers failed: the rectangle reaches round the
corner. Forty-eight of the excess are north Cornwall and north Devon — Sennen,
Gwynver, the whole St Ives and Newquay run, Bude, Hartland Quay, Westward Ho! —
plus one inland river site on the Tone at Taunton. All are on the Atlantic and
Bristol Channel coasts, inside the box and outside the corridor. The other six
are the Eastbourne–Pevensey–Bexhill–Hastings stretch that the storm overflow and
water body layers already cut at the headland.

The catchment boundary does the work cleanly here, which was not a given —
bathing water sampling points sit at the shoreline, and a land-drainage boundary
could easily have clipped them off. It does not: all 48 exclusions are genuinely
north-coast or inland, and no south-coast site is lost at the edge.

Four **de-designated** sites fall in the corridor — Newhaven (2016), Poole
Harbour Sandbanks (2004), Redgate (2004), Gunwalloe Cove (2002). They exist only
in the monitoring-locations layer. Whether to show them is a design question, not
a data one; the point for now is that the two services disagree on the roster by
exactly this set, and a build must choose deliberately rather than inherit
whichever service it happened to read.

Two coverage facts at the western end: the westernmost designated bathing water
in England is **Sennen at -5.698**, and the **Isles of Scilly have none at all**.
Scilly sits west of the project's -6.2 box edge in any case, so nothing is
clipped — but if the layer ever appears to stop at Land's End, that is a real
designation boundary and not a fetch artefact.

### The gaps — my analysis, not the source's

**Inferred.** None of this comes from EA. It is built from OSM `natural=coastline`
(3,306 ways in the box), sampled every 250 m, clipped to a 1.1 km buffer of the
project catchment boundary, with straight-line distance to the nearest sampling
point. Straight-line distance understates true coastal distance around headlands,
and the open-coast/estuary split is my own, using the WFD *Coastal* water bodies
as the open-sea proxy. Treat the shape of the result, not the decimals.

That gives 2,674 km of shoreline in scope west of the cutoff — 1,588 km open
coast, 1,086 km estuary and harbour.

| | 1 km | 2 km | 3 km | 5 km |
|---|---|---|---|---|
| Open coast | 34% | 58% | 74% | 89% |
| Estuary / harbour | 8% | 21% | 35% | 60% |

**180 km of open coast lies more than 5 km from any designated bathing water.**
The largest stretches, centroids reverse-geocoded: **the Lizard, 41 km** (Kynance
to Cadgwith); **Start Point to Hallsands, 40 km**; **Chesil Beach and Abbotsbury,
23 km**; **the Polperro–Lansallos cliffs, 21 km**; and two on the Isle of Wight,
the west coast at Cranmore and the south coast at Chale, 13 km each.

This is not the refusal precedent — it is not 100 km of silence dressed up as
coverage. The gaps are nameable and they have a defensible cause: bathing waters
are designated where people bathe in numbers, so cliff coast is legitimately
absent. **The estuary figure is the honest problem.** Only 35% of estuary and
harbour shoreline is within 3 km of a site. Someone looking at Southampton Water,
Portsmouth Harbour, Chichester Harbour or the Fal will see very little, and the
layer must not be allowed to imply that means clean.

One test I ran and am reporting as **inconclusive rather than as a finding**:
only 69 of the 193 sampling points fall inside any WFD coastal or transitional
polygon, because the points sit landward of the water-body edge. That cannot
support a claim about which water bodies have no bathing water, and no such claim
is made.

## 3. Points only — and the three closed routes to an area

The only usable geometry is a **sampling point**. Worthing Beach House,
`ukj2407-15350`, carries `lat 50.81068, long -0.36086, easting 515580, northing
102517` and nothing else spatial. No zone, no extent, no line along the beach.

Three routes to an area were available, and all three are closed:

**`zoneOfInfluence`** — a URI on every one of the 464 records, and by name
precisely the thing a map would want. **403.**

**`envelope`** — labelled "Map bounds for *site*". Same host, **403**.

**Areas Affecting Bathing Waters** — and this is the one that matters, because
unlike the other two it *works*. 464 polygons, one per site, 251 inside the bbox,
every corridor site matched, median 0.13 km², OGL, downloads cleanly. It would
render beautifully. EA's own metadata forbids it in terms:

> "The polygons are not a definition of the extent of the bathing water under the
> Bathing Water Directives 76/160/EEC or 2006/7/EC and should not be used for any
> definition of the bathing water area or extent."

They are a permitting aid, drawn to help EA decide about discharge consents, and
for the river sites they are near-degenerate. **Drawing them as beach extents
would be the single most tempting and most clearly prohibited move available in
this dataset.** It occupies exactly the position the UK SeaMap Cornwall-only
re-host occupied: available, plausible, well-formed, and wrong in a way that only
shows up if you read the metadata rather than the geometry.

Even the point carries a caveat, from EA's own record: *"For coastal waters the
specific locations of monitoring vary along a transect with the changing of the
tides."* The marker is approximate by design.

So: **a marker layer, not an area layer.** That is a real constraint on how much
the layer can carry visually, and it should be accepted rather than worked
around.

## 4. Classification — a four-year aggregate wearing a single year's label

The scheme in force since 2015 is the revised Bathing Water Directive:
**Excellent / Good / Sufficient / Poor**, plus the statuses `un-assessed`, `New`
and `Closed`. The current year is **2025**.

Across the 193 corridor sites: **149 Excellent, 30 Good, 2 Sufficient, 8 Poor, 4
unclassified.** The registry and the monitoring-locations layer return this
distribution independently and identically.

The eight Poor are Worthing Beach House, Bognor Regis (Aldwick), Southsea East,
River Avon at Fordingbridge, Lyme Regis Church Cliff Beach, Stoke Gabriel and
Steamer Quay on the Dart, and Coastguards Beach on the Erme. The two Sufficient
are Porthluney and Bognor Regis East.

**A 2025 classification is calculated from 2022–2025 samples.** This is the
single most important thing for the layer to say out loud. "Excellent" is a
four-year aggregate; it is not a statement about the water this year, this month
or this morning. A site can be Excellent and have had increased-risk forecasts on
forty days — Lyme Regis Church Cliff Beach is Poor with 40 such days, and Bantham
is Excellent with several.

**Unclassified is represented by absence, not by a value.** The four sites
concerned — Lostwithiel on the Fowey, Newton and Noss, East Beach at West Bay,
and the Avon at Queen Elizabeth Gardens in Salisbury — were designated in **2026**
and simply have no `latestComplianceAssessment` node. A build that reads the
field and renders null will produce four unexplained grey markers.

### Eleven comparable years, not thirty-eight

The monitoring-locations layer carries the whole history as attributes, and this
is the most valuable thing in it — but it carries it as **two incompatible
series**. `class_2015` through `class_2025` are the current scheme.
`comp_1988` through `comp_2014` are the old cBWD, whose values are *Fail*,
*Imperative*, *Guideline* and *UK Guideline*.

These are different regulatory instruments with different pass marks and
different sampling regimes. **Charting them as one continuous series would be a
fabrication**, and an especially seductive one, because thirty-eight years of
"improvement" is a far better story than eleven. Only 2015–2025 is comparable.

Within that window, the corridor:

```
2015  E 119   G 42   S 12   P 2    (+1 Closed)
2019  E 148   G 27   S 2    P 0
2020  un-assessed × 177          ← no bathing season monitoring
2022  E 144   G 29   S 3    P 1
2024  E 143   G 31   S 7    P 8
2025  E 149   G 30   S 2    P 8
```

**2020 is a hole, not a result.** There was no bathing season monitoring
programme; the sample record confirms it independently, with three samples that
year at sites that normally take twenty. Any trend line must break there rather
than interpolate across it, and any "years at Excellent" count must exclude it.

The move from 0 Poor in 2019 to 8 in 2024 is a real signal and should not be
softened — but it is partly compositional, since nine corridor sites were newly
designated in 2024 and entered at the bottom. Saying "eight sites are Poor" is
true; saying "eight sites deteriorated" is not established here.

There is also a `status` field carrying *At Risk* (13 corridor sites),
*Deterioration* (4), *No Change* (2) and null (174). **I could not find published
semantics for it** and it is therefore not usable. That is a genuine gap, not a
judgement about the field — someone may find the definition, and if so it is
potentially the most forward-looking attribute in the dataset.

## 5. The forecast — a prediction, and the traps around it

`…/doc/bathing-water-quality/stp-risk-prediction/latestOn/{yyyymmdd}.json`
returns the whole national day in one request. Values are `normal`, `increased`,
`unknown`.

**What it predicts.** Raised risk of pollution from **rainfall, tide and wind**,
modelled before the day begins. It is not a measurement, not a sample result, and
not a report that anything discharged. Critically, **`normal` does not mean
"tested clean"** — it means no increased-risk prediction was issued for today.

**Timing, from a real record** (Weymouth Central, point 20700):

```
predictedAt  2026-08-23T08:30:00
publishedAt  2026-08-23T08:41:17
expiresAt    2026-08-24T08:29:00
```

Issued once daily at 08:30, published about eleven minutes later, expiring at
08:29 the next morning — **a rolling 24-hour window.** This **contradicts EA's
own public guidance**, which says forecasts are "only valid up to midnight of the
day they are issued". The machine-readable `expiresAt` is what a map should use,
and the discrepancy should be stated rather than quietly resolved in one
direction: an overnight reader is inside the API's validity window and outside
the guidance's.

**Season: 15 May – 30 September.** Confirmed independently from the sample
record — Bournemouth Pier's first 2026 sample is 17 May, and 2019–2025 first
samples fall 2–7 May with last samples 18–25 September.

**Out of season the feed is empty.** `latestOn` for 1 January, 15 March, 10
April, 25 April and 30 April, and for 5 October, all return **zero items** — a
valid HTTP 200 with an empty list. Same shape as the legacy compliance trap in
§1, and here it is the *correct* behaviour rather than a legacy artefact, which
makes it more dangerous: a layer that does not special-case the closed season
will render blank for seven months and look broken rather than closed.

### The 2025 season, scanned day by day

139 days, one request each, filtered server-side to `increased`:

- **83 of 139 days (60%)** had at least one corridor site on increased risk
- **787 corridor site-days** on increased risk — **2.93%** of all site-days
- **87 of 193 sites** went increased at least once; **106 never did**
- Most-forecast: Lyme Regis Church Cliff Beach 40 days, Southsea East 35,
  Porthluney 32, Worthing and Worthing Beach House 27 each
- Busiest day: **3 September 2025, 55 corridor sites at once**

So the layer moves, and it moves in weather-shaped bursts rather than drifting.
That was the open question — a forecast layer that never changed would be a
permanently green decoration implying a daily all-clear. It is not that. But
**106 of 193 sites would show `normal` every day of the season**, and the map has
to make clear that this is an absence of prediction, not a presence of evidence.
Corroboration that the signal is real: 78 corridor sites carry the registry's
`waterQualityImpactedByHeavyRain` flag, and 75 of those went increased at least
once.

### Two traps, one of which I fell into

**The bare-URI trap.** Requesting the day feed *without* the `riskLevel` filter
returns `riskLevel` as a plain URI string rather than the labelled object the
filtered view returns. A `name === "increased"` test against it silently matches
nothing. **My first pass through the season did exactly this and reported zero
increased-risk days across 3,770 corridor site-days** — a clean, uniform,
entirely false result that looked perfectly plausible and would have been reported
as a finding had it not been checked against a day the national feed showed 56
increased sites. The correct figure for that day is 18 in the corridor. Any build
must filter server-side or handle both shapes, and must assert against a known
non-zero day.

**The advice-against-bathing feed.** There is a live endpoint listing bathing
waters under advice against bathing, and it is time-qualified — 16 sites today,
10 on 1 January 2026 — so it behaves like a current-status feed and is by some
distance the most compelling thing in the dataset to put on a map. It is not
trustworthy. Seven corridor sites appear on it, and the underlying situations are
**stale and never closed**: Eastney and Southsea East both trace to a situation
dated **9 October 2021**, and Hastings, St Leonards and Bexhill to **28 October
2023**. Four of the seven corridor entries are classified **Excellent**.

Mapping this as "advice against bathing right now" would put a live warning on
clean beaches on the strength of a five-year-old unclosed record. **It should be
left out entirely**, and that decision recorded here so it is not rediscovered as
an opportunity later.

## 6. Samples

Individual samples are fully retrievable at
`…/doc/bathing-water-quality/in-season/point/{bwspid}.json`, one row per sample.
Worthing Beach House, 13 May 2024 13:03:

```
escherichiaColiCount        27    qualifier: actual
intestinalEnterococciCount  45    qualifier: actual
sampleDateTime  2024-05-13T13:03:00      sampleWeek 2024-W20
discountable    false                     recordStatus new
```

Depth is **1988 to 2026**, roughly twenty samples a season — 793 for Spittal, 769
for Bournemouth Pier. 2020 has three.

Three fields decide whether a numbers-based presentation would be honest.
`qualifier` is `actual` or `lessThan`, the latter meaning censored below the
detection limit — a third of the values at one site were `lessThan`, so a naive
mean or chart would be plotting detection limits as measurements. `discountable`
marks samples eligible for exclusion from the classification under the
short-term-pollution rule (up to 15% over four years). `recordStatus`
distinguishes `new` from `replacement`. None of these can be dropped without
changing what the numbers mean.

## 7. The join — what "affects" can and cannot mean

The question this investigation most wanted to answer was whether "this overflow
affects this beach" is ever supported by published data, or only ever a proximity
inference. The answer is **neither, quite** — there is a real published link, and
it asserts something narrower than impact.

The EA's **Event Duration Monitoring annual return**, which this project already
reads, carries a `bathing_water` field. Its field alias states the semantics:

> "Bathing Water (only populate for storm overflow with a Bathing Water EDM
> requirement)"

That is an **authoritative, EA-published association** — not proximity, not
constructed here. But what it asserts is a **permit condition**: this overflow
must run event duration monitoring *because of* that bathing water. It says
nothing about impact, contribution, volume, direction, or whether anything from
that overflow has ever reached that beach.

Measured against the project's committed 1,903 corridor overflows:

- **436 (23%)** name at least one bathing water
- **645 overflow → bathing water pairs**; 283 overflows name one site, 108 name
  two, 34 name three, 11 name four
- **134 of the 193 corridor bathing waters** have at least one linked overflow

**Fifty-nine corridor sites have no linked overflow, and that means no nearby
overflow carries a bathing-water EDM permit condition — not that nothing
discharges near them.** Reading those 59 as clean would invert the meaning of the
field. This is the same "missing is not zero" distinction the compound pressure
layer had to make explicit, in a new place.

**The join is a semicolon-delimited free-text name string, not a key.** There is
no `eubwid` or `bw_ref` anywhere in the EDM schema. 137 of 141 distinct names
resolve exactly; four do not, and all four are EA-versus-EA naming drift rather
than bad data:

| EDM says | Monitoring locations says |
|---|---|
| `Beachlands West` | `Hayling Beachlands West` |
| `Beachlands Central` | `Hayling Beachlands Central` |
| `Eastoke` | `Hayling Eastoke` |
| `Dartmouth Castle and Sugary Cove` | `Dartmouth Castle Cove` |

The polygon dataset carries a third spelling set again — `Newtown and Noss` for
`Newton and Noss`, curly apostrophes where the registry uses straight. A
four-entry alias table fixes this corridor today. It is hand-maintained string
matching and it will drift again, so it belongs in the build with the mismatch
count asserted on every run, in the same spirit as the marine layer's `excluded`
map: if the number of unresolved names changes, the run should say so.

EDM also carries `wfd_waterbody_id` — a genuine key into the water body layer
already on this map — and a `shellfish_water` field on exactly the same pattern.
Neither was pursued here.

### The live feeds, and a correction to the project record

**The project record is correct and my own investigation summary was wrong.** The
live discharge layer merges **four** water companies, not three. `liveOverflows.js`
lists South West Water, Southern Water, Wessex Water and **Thames Water** — the
last included deliberately even though almost all of its network drains to the
Thames, because the catchment test rather than the company list is what draws the
line. My investigation checked only the first three, having read a truncated grep
of the file, and reported three. Thames Water is the fourth.

Checked directly, **none of the four carries a bathing-water field.** All expose
the same minimal schema: `Id`, `Company`, `Status`, `StatusStart`,
`LatestEventStart`, `LatestEventEnd`, `Latitude`, `Longitude`,
`ReceivingWaterCourse`, `LastUpdated`. But the `Id` values use the same scheme as
EDM's `unique_id` — `SBB00407`, `SWS00199` — so a currently-discharging overflow
**can** be resolved to a bathing water through the EDM permit table. It inherits
the permit semantics in doing so. It does not acquire measurement semantics: "an
overflow with a bathing-water monitoring requirement is discharging now" is true
and useful; "this discharge is reaching that beach" remains unsupported.

The bathing water **profile** documents add narrative but no structure. Worthing
Beach House's `esoOutfallsStatement` reads "There are 2 surface water outfalls
near the bathing water. One 400m to the west, one 200m to the east." That is
prose, unkeyed, and not joinable to an asset.

**Plainly: "this overflow is monitored because of this beach" is supported.
"This overflow affects this beach" is not.**

## What the layer will and will not be able to say

Recording this now, before the build, so the build can be checked against it.

**It can say:**

- Where the **193 designated bathing waters** in the corridor are, as markers.
- Each site's **2025 classification**, stated as a 2022–2025 aggregate.
- **Eleven years** of comparable classification history, with 2020 shown as
  un-assessed rather than interpolated.
- **Today's pollution risk forecast**, labelled as a prediction from rainfall,
  tide and wind, carrying the site's own `expiresAt`.
- **Individual sample counts** for E. coli and intestinal enterococci, dated,
  with `lessThan` values shown as limits rather than numbers.
- **Which storm overflows carry a bathing-water EDM requirement naming this
  site**, phrased as the permit condition it is. On a map that already shows
  1,903 overflows, this is the genuinely new thing.
- Which sites are **flagged as affected by heavy rain** — 78 of 193.

**It cannot say:**

- **Anything about area.** Points only, and approximate points.
- **Anything outside 15 May – 30 September** for the forecast. The feed is empty
  and the layer must say "closed season", not render blank.
- **That `normal` means clean.** It means no increased-risk prediction was
  issued; 106 of 193 sites never left it in 2025.
- **That `Excellent` means safe today.** It is a four-year aggregate.
- **Anything about advice against bathing.** The feed is stale and would warn on
  clean beaches.
- **Anything about impact.** 59 sites with no linked overflow means no permit
  condition, not no discharges.
- **Anything about the Lizard, Start Point, Chesil, or the Polperro cliffs** —
  180 km of open coast is more than 5 km from any site, and estuary coverage is
  thinner still. The layer describes *where bathing is designated*, not water
  quality along this coast.

## Where honesty will cost impressiveness

Three places, named in advance so they are not quietly reversed later.

**No areas.** A map of 193 shaded beach zones would read as authoritative
coverage. A map of 193 dots reads as what it is — sampling points. The polygons
exist, they fit, and EA says not to.

**No live closure status.** The advice-against-bathing feed is the most
map-shaped thing in the dataset and the least trustworthy. Leaving it out means
the layer cannot answer the question users will most want to ask.

**A mostly-green forecast.** Two-thirds of corridor sites never leave `normal`.
The honest rendering of that is a lot of one colour, and the temptation will be to
find something more expressive to encode. There isn't anything; the alternative
is inventing variation the forecast does not contain.

## Verdict

**Build it** — as a marker layer, with the classification framed as a four-year
aggregate, the forecast framed as a prediction with its own expiry, the closed
season handled explicitly, the overflow link framed as a permit condition, and
the advice-against-bathing feed left out.

This is the first of the five investigations to end in yes. It ends in yes
because the extent was verified rather than assumed, two independent services
agree, the measurements underneath the summary are retrievable, and every claim
the layer wants to make can be traced to something a source actually states. The
four refusals failed at least one of those. That is the bar, and it is worth
having written down in a case where it was cleared.
