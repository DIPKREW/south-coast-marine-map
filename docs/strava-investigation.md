# Strava for water-based recreation — investigation record

Written before any build, and it ends where the four before it ended. Caitlin
Woombs at Cornwall Wildlife Trust suggested Strava as a source for the
water-based recreation this map cannot currently show — swimming,
paddleboarding, kayaking. This is the answer, and the reason it needs writing
down rather than just saying no is that the suggestion is a good instinct aimed
at the wrong product, and the Trusts will reasonably ask why.

Everything below was read from Strava's own material on **24 August 2026**: the
published OpenAPI spec at `developers.strava.com/swagger/`, the API Agreement
(2026), the API Policy (2026) — both effective 1 June 2026 — and the Metro Terms
of Use. No account was created, no application registered, nothing scraped. This
was a documentation and terms review, which is all it needed to be.

## The gap it would fill

Worth stating first, because the gap is real. The recreational pressure layer is
MMO's 2015 AIS vessel density grid, and its own About text concedes the problem:
AIS is carried by larger, better-equipped boats, so dinghies, kayaks,
paddleboards and swimmers are simply absent, and on this coast the untracked
fleet is probably larger than the tracked one. A source that saw people in the
water rather than boats with transponders would be the single most valuable
addition to that part of the map.

Strava does see those people. That is not the problem.

## 1. The activity enumerations, and why they do not help

**Confirmed**, from `developers.strava.com/swagger/sport_type.json` and
`activity_type.json`.

`SportType` carries **56 values**, of which **nine are water-based**:
`Canoeing, Kayaking, Kitesurf, Rowing, Sail, Surfing, Swim, VirtualRow,
Windsurf`. `StandUpPaddling` is there too. The older `ActivityType` enum has 37
values and eight of the same.

So the premise survives first contact: these activities are recorded, they have
first-class types, and they are in the API's data model. Every subsequent step
is where it fails.

## 2. One bounding-box endpoint, and a two-value enum

**Confirmed**, from the OpenAPI spec.

The API exposes **32 paths**. Every activity endpoint is one of three shapes:
`/athlete/activities` (the authenticated athlete's own), `/activities/{id}` (one
activity the application can already see), or `/clubs/{id}/activities`. **There
is no endpoint anywhere in the API that returns other people's activities by
geography.** Nothing answers "what happened in this bounding box".

The single bounding-box query in the whole API is `GET /segments/explore`. And
segments are where it stops dead. `SummarySegment.activity_type` in
`segment.json` is an enum with exactly two values:

```json
"activity_type": { "type": "string", "enum": ["Ride", "Run"] }
```

`/segments/explore` says the same thing from the other side — its
`activity_type` parameter enum is `["running", "riding"]` — and the endpoint
"Returns the **top 10** segments matching a specified query", a hard cap of ten
per call regardless of what is there.

A `DetailedSegment` does carry the things a map would want: a polyline `map`,
`effort_count` ("The total number of efforts for this segment"), `athlete_count`
("The number of unique athletes who have an effort for this segment"),
`created_at` and `updated_at`. None of that matters. **No segment can ever be a
swim, a paddle or a kayak.** The one spatial, queryable, count-carrying object in
the Strava API is defined to exclude every activity we came for.

Nor is any of it open. "All calls to the Strava API require an `access_token`" —
there is no unauthenticated read path, not even for segments. And a newly
registered application begins at an **athlete capacity of 1**, which Strava calls
"Single Player Mode": without review, the application can serve exactly one
athlete, yourself. Getting corridor-wide paddling data would mean every paddler
on this coast individually authorising a private application. Rate limits, for
completeness: 200 requests / 15 min and 2,000 / day overall by default, 100 and
1,000 for non-upload calls, application-wide rather than per athlete.

## 3. What Metro actually aggregates

**Confirmed**, from Metro's own FAQ: Metro shows "run, walk and bike trips" —
Pedestrian mode is run, walk and hike; Bike mode is bike plus e-bike. There is no
water mode. There is no swimming, no paddleboarding, no kayaking.

The deeper reason matters more than the list, because it is structural rather
than a product decision someone could revisit. **Metro is matched to
OpenStreetMap street and trail geometry.** Its output is counts on network edges.
Open water has no edges. There is no OSM way running across Falmouth Bay to snap a
kayak track onto, no path down the Fal for a swim to be counted along. Even if
Strava added a water mode to Metro tomorrow, the data model it produces cannot
represent a line across open water — it can only represent traffic on a network
that does not exist out there.

*A genuine gap in Strava's own documentation, worth recording:* the Metro Terms
of Use never name a single activity type. The words swim, kayak, paddle, surf,
canoe, row, walk, run, cycle and pedestrian appear **zero times** in that
document. The activity coverage is documented in the product FAQ and nowhere in
the contract.

## 4. The licence

**Confirmed**, quoted from the API Policy (2026). Four clauses, each of which
independently forbids what every layer on this map does.

**§6.2 Cache and Retention** — "You may not retain Strava Data in your cache for
longer than **seven (7) days**… Except for such limited caching, you may not
store Strava Data, or provide or display Strava Data or any associated service,
**to any third party other than the Strava user using your Developer
Application**."

**§5.7 No Aggregating, Caching, or Storing User or Geographic Information** —
"You may not use or access the Strava API Materials to **aggregate, cache, or
store geographic location information** or other user information accessible via
the Strava API, except as expressly permitted by Section 6.2."

**§5.4 No Aggregation, Analytics, or De-Identified Processing** — "You may not
process or disclose Strava Data—**even publicly viewable Strava Data**—including
in an **aggregated, de-identified, or anonymized manner**, for the purposes of
analytics, analyses… The restrictions in this Section 5.4 apply to data derived
from Strava Data and to output that incorporates or was generated using Strava
Data."

**§5.10 No Sale, License, or Transfer to Third Parties** — "You may not transfer
or disclose Strava Data — **including publicly viewable Strava Data** — to any
third party."

And, from the API Agreement itself, the sentence that governs all of it: "Strava
Data provided by a specific user can only be displayed or disclosed in your
Developer Application **to that user**. Strava Data related to other users, **even
if such data is publicly viewable on the Strava Platform, may not be displayed or
disclosed**."

Set that against how this project works. Every layer here is fetched once,
aggregated, committed to `public/data/` as static GeoJSON, and served to anyone
who opens the page. That is: storing geographic location information (§5.7),
aggregating it (§5.4), retaining it well past seven days (§6.2), and disclosing
it to third parties (§5.10). There is no configuration of a Strava layer that
survives even one of those, and this map would breach all four before the first
paddleboard appeared on screen.

*Attribution*, for the record, is **optional** rather than required — "If you
choose to give attribution to Strava within your Developer Application, you must
comply with the [Brand Guidelines]" — with a prohibition on implying
"affiliation, endorsement, sponsorship, or approval by Strava." That is the only
part of the licence position that would have been easy.

**Metro's terms are different but no more usable.** A non-sublicensable,
revocable, one-year licence to prepare "Licensee Reports" for one declared
Project Type. "Licensee **shall not publicly distribute any Strava Data**
downloaded from the Strava Metro Service, **including the underlying raw
counts**." Screenshots may be shared "for the limited purpose of supporting
**active transportation** use cases only, such as grant applications, initiatives
for community bike lanes". Anything published outside the organisation must go to
Strava **thirty days in advance** for approval. On termination, "erase or destroy
all copies of the Strava Data". An "Authorized User" is defined as "an individual
**employee of the Licensee**", and eligibility is "organizations that plan, own or
maintain infrastructure or seek to positively influence planning processes."

## 5. The Global Heatmap

This is the one place water activity appears spatially at scale, so it deserves
its own answer rather than being folded into the licence section.

**Confirmed:** the Global Heatmap does carry a **water sport** category alongside
ride, run and winter. A paddling pattern in this corridor would genuinely be
visible on it. That makes it the most tempting thing in this whole
investigation — and it is the one that would look most like the layers already
here.

It cannot be used. The heatmap **is not available through the API at all**.
Strava's Terms of Service prohibit "Automated access to or collection of data
from the Services—by any means, including data mining, robots, screen scraping,
scripts", and creating "derivative works based on the Services… or Content". API
Policy §5.6 separately prohibits "Frame, wrap, or otherwise reproduce significant
portions of the Strava Platform". Strava previously allowed external tools —
CalTopo, Gaia — high-resolution tile access and **withdrew it**. The only grant
the Terms of Service make is "a limited, non-exclusive right to create a **text
hyperlink** to the Services… for personal use only."

So: a link out to the heatmap is permitted. Tiles as a basemap or an overlay in
this map are not, by three separate routes.

## 6. Who Strava's users are — not published

**Confirmed, and thin.** Strava's annual *Year in Sport* report gives headline
scale — over 180 million users across 185+ countries, drawing on a survey of
30,000+ people — and scattered comparisons: women 21% more likely than men to
record weight training, 54% of users tracking multiple activities, walking now
the second most-recorded activity type, Gen Z the fastest-growing demographic.

Strava publishes **no systematic demographic composition**. No age, income,
geographic or urban/rural breakdown that would let anyone characterise who is and
is not represented, and **nothing at all on water-activity user counts or on
coastal UK representation**.

That is a genuine gap and it is not filled here by estimate. It matters more than
it first looks: the whole case for Strava is that AIS misses the small untracked
fleet. Strava would substitute a *differently* biased sample —
smartphone-carrying, app-using, activity-logging, and skewed in ways Strava does
not disclose — with no published basis for saying how. Swapping one unquantified
bias for another unquantified bias is not an improvement, and this project has
refused layers for less.

## 7. An ambiguity, recorded and not relied upon

API Policy §6.1 reads: "**Unless** your Developer Application has an athlete
capacity of 9,999 **or less**, you may display or disclose to an end user only
the specific Strava Data related to that end user."

Read literally, that inverts the restriction for small applications — which would
mean a hobby-scale app is *less* restricted than a large one. It contradicts
§6.2, it contradicts the API Agreement's own summary, and it contradicts the
identical sentence printed earlier in the same Policy. It is almost certainly a
drafting error.

It is recorded here because someone will find it and think it is a way in. It is
not relied upon, and nothing in this investigation's conclusion depends on which
way it is read.

## Verdict: not usable, and the order of the failures matters

**The activity test fails before the licence test is reached.** That is the part
to be precise about, because "Strava won't let you" invites the answer "then get
permission", and permission is not the obstacle.

Water activities exist in the API's type enumerations and nowhere useful
downstream. The only geographic query in the API is `/segments/explore`, and
segments are `["Ride", "Run"]` — that two-value enum is the whole answer. Metro
is run, walk and bike, snapped to a street and trail network that has no geometry
for open water. The Global Heatmap has a water category, no API, and three
separate prohibitions on reuse. **Nothing in Strava returns "swims and paddles in
this bounding box" to anyone, at any access tier, at any price.**

Only then does the licence question arise, and it fails on four independent
clauses.

Measured against the four refusals already recorded, this one fails harder than
any of them. Beach litter was refused because MCS's own metadata says the data is
"for internal use only" and rebuilding it from annual PDFs would produce
something that looks like the other layers and is not one. Shellfish water
quality was refused because the current classification and the only vector
geometry live in two different places and the join was *tested* at 62%. Both had
data that existed in the right shape and could not be obtained. Strava has the
opposite problem and the same problem at once: **the shape does not exist, and it
could not be published if it did.**

### A Wildlife Trust Metro partnership would not change this

Worth saying plainly, because it is the natural next suggestion and it leads
nowhere. Metro access would make Cornwall Wildlife Trust the Licensee rather than
an individual — and Metro is still run, walk and bike. A partnership converts an
access problem into a differently-shaped access problem while leaving the
activity problem exactly where it was. There is no swimming in Metro, no
paddleboarding, no kayaking, and even a Licensee Report could not be published on
this map without thirty days' prior approval and without breaching the
prohibition on distributing the underlying counts.

## What would actually fill the gap

The gap is worth filling and Strava is not the way to fill it. What this map
needs is what every other layer here has: **a dataset somebody is willing to
license openly.** Realistic candidates, in rough order of how likely they are to
say yes:

- **A paddlesport or open-water swimming club** with launch and route records,
  willing to publish them under an open licence.
- **A harbour authority** — several on this coast already record launches,
  moorings and small-craft movements for their own purposes.
- **A Trust-run survey**, which is the strongest option: designed for this
  question, with known coverage, a stated method, and a licence the Trust
  controls. It would be smaller than Strava and vastly more honest about its own
  limits, which is the trade this project makes every time.

Until one of those exists, the recreational pressure layer stays as it is: 2015
AIS, a decade old, counting only boats with transponders, and saying so in its
own About text. An acknowledged gap is a better thing to ship than a layer that
breaches its source's licence to show an activity that source does not expose.
