# Compound Pressure Indicator — build decisions

Written immediately after the build, for a future write-up. It explains why the
layer is the way it is, including the places where the honest choice produced a
less impressive map than the alternative would have.

## What this layer refuses to be

A professional cumulative effects assessment — the Cefas Bow-Tie method, or the
Halpern-derived approaches used internationally — depends on pressure-receptor
sensitivity weightings. Those come from expert ecological judgement and
biological traits analysis: how much does *this* pressure harm *that* receptor.
We do not have them, and inventing plausible-looking numbers would have been the
single worst thing this project could do, because the output would look exactly
like the real thing.

So the layer was scoped down to the only question the available data can answer:
where are several separately-monitored pressures simultaneously high? That is a
statement about *co-occurrence*, not about consequence. Everything below follows
from taking that limit seriously rather than blurring it.

The same reasoning is why marine species and seabed habitats were excluded as
inputs even though both are already on the map. They are receptors, not
pressures. Folding them in would have required precisely the sensitivity
weighting we are refusing to fabricate, and would have quietly converted a
co-occurrence map into an impact claim.

## The grid, and what it quietly excludes

The 2 km grid is taken wholesale from the recreational pressure layer — MMO's
vessel density grid, 10,380 cells covering 43,596 km². Reusing it rather than
generating a fresh grid means one fewer arbitrary choice, and it guarantees that
at least one input needs no resampling at all.

It is worth knowing that this is a *sea* grid: land is a hole in it. That turns
out to matter a great deal for storm overflows, which is the next decision.

## Storm overflows: why a decay kernel rather than a count

Three options were on the table. Counting the spills of overflows whose point
falls inside a cell is the obvious one, and it is wrong twice over. Most
overflows discharge at the shoreline, so their points land on *land*, which is a
hole in this grid — a strict point-in-cell count assigns almost nothing to
almost everything. And even where an overflow does fall in a sea cell, treating
its effect as confined to one 2 km square is not a defensible reading of an
outfall.

A nearest-N weighting was the second option, and it is scale-dependent in an
awkward way: N=3 behaves very differently in a dense estuary than on an empty
stretch of coast.

The chosen rule is a distance-decayed sum: each cell receives every overflow's
annual spill count multiplied by `exp(-d / 3 km)`, cut off at 8 km. This handles
the land/sea mismatch naturally, and it expresses the thing that is actually
true — an outfall affects the water near it, decreasingly with distance.

**The assumption a reader must know about:** 3 km and 8 km are a modelling
choice, not a measured dispersal distance. Nothing in the EA return says how far
an outfall's plume travels; it depends on tide, wind, volume and the shape of the
coast. The numbers are defensible orders of magnitude, not evidence. The About
text says so.

## WFD: the ordinal, and the inversion

Ecological status is a five-band judgement, so it maps to an ordinal: High=0,
Good=1, Moderate=2, Poor=3, Bad=4. The inversion is deliberate and matters —
every other input here is "more is worse", and High status is the *absence* of
pressure, so it has to score zero rather than four.

Cell values are the mean of the ordinal over a 5×5 lattice of sample points
inside the cell, which gives an area-weighted average to about 4% precision. True
polygon clipping would have been more exact; with 10,380 cells against 59
polygons the sampling approach is fast, and at this precision the difference
cannot survive the subsequent percentile ranking anyway.

In the corridor the raw values run 1 to 3 — there are no High-status bodies here
at all, which is consistent with the water body layer's own finding. So the
"best" any cell scores on this pressure is Good.

## Fishing: the resolution compromise, stated rather than hidden

VMS effort is published on a 5.7 km grid. Each 2 km cell simply inherits the
value of the 5.7 km cell containing it. There was no better option — interpolating
between coarse cells would invent structure that the source does not contain, and
would look smoother and more authoritative while being less true.

The consequence is visible: with weight pushed onto fishing, the map goes
noticeably blocky, because it *is* blocky. That is in the About text as a stated
resolution limitation rather than left for someone to notice and mistrust.

## Missing is not zero — and the three ways a cell can be empty

This is the distinction that took the most care. A cell can have no value for a
pressure for two entirely different reasons, and conflating them would be a
straightforward falsehood:

- **Real zero.** No overflow within 8 km (87.0% of cells); no licensed dredging
  (90.7%). The EA register and the MMO licence register both cover the whole
  corridor, so absence here is a measured absence.
- **Not assessed.** WFD classifies coastal and transitional waters only, so 91.8%
  of cells are simply outside its scope. Fishing is absent for 18.1% of cells.
  Nobody looked; that is not the same as nothing being there.

The composite is therefore a weighted **mean over the pressures a cell actually
has**, not a weighted sum over five slots. A cell is never penalised for data
nobody collected, and a cell with no WFD classification is not scored as if its
water were pristine.

There is a third case that only appears once a slider is moved. Zero out
everything except fishing, and the 1,883 cells outside the fishing grid have
nothing left to average — the denominator is zero. Initially those rendered in
the palest band, which reads as "lowest pressure" and is a claim the data cannot
support. They are now drawn fully transparent: no answer under this weighting,
so nothing shown.

## The normalisation bug that mattered

Percentile-ranking each pressure independently was specified, and the textbook
implementation — ties share the midpoint of their rank block — produced a result
that was quietly indefensible.

Because 87% of cells have no storm overflow within reach, that entire tied block
sat at the midpoint of the ranking: **0.435**. Dredging behaved the same way at
0.453. A cell with nothing happening in it was contributing nearly half a point
to the weighted sum, and because every such cell got the same inflated value, the
composite looked far more uniformly "pressured" than the inputs justified.

The fix is to pin real zeros to 0 and rank only the cells that actually carry the
pressure, among themselves. This departs from a plain percentile rank and is the
right call for a *pressure* indicator: the ranking question is "how does this
compare with other places that have this pressure", and the answer for a place
that does not have it at all is zero, not median.

## Legend bands: why they move

Fixed 0.2/0.4/0.6/0.8 breaks were tried first. They fail as soon as the weights
change, because the whole score distribution shifts — heavy weight on a sparse
pressure like dredging drags almost every cell toward zero and the map goes
uniformly pale, hiding the very cells the user just asked to emphasise.

Bands are therefore quintiles of the *current* weighted result, recomputed on
every slider move from the 10,380 scores held in memory. The darkest band always
means "the top fifth under the weighting on screen right now", which is the only
reading this layer can honestly support: there is no absolute scale here, so
there can be no fixed thresholds.

One wrinkle: with a degenerate weighting (all weight on a pressure where most
cells are zero) several quintile breaks collapse onto the same value, and
MapLibre rejects a `step` expression whose stops are not strictly increasing.
Breaks are nudged apart by 1e-6 where that happens. The map correctly goes
near-binary in that case, which is the honest depiction.

## Two things that had to be reworked

**The double download.** The renderer originally fetched the 2.3 MB grid a second
time to compute percentile breaks, on top of MapLibre's own fetch for the source.
It now goes through the registry's existing `prepare` hook, which fetches once and
hands back both the parsed FeatureCollection (used as the source data directly)
and the bare property rows.

**Sliders that never appeared.** The detail panel builds its sections up front,
while a default-off layer is still deferred, so it asked a lazy-loading wrapper
for `setWeights` and got nothing. The wrapper now buffers weights the same way it
already buffered species selection and coexistence state, and replays them when
the real layer builds. This is the third capability to need that treatment; a
fourth should probably prompt a general mechanism rather than another special
case.

## Performance, and why the score is an expression

The weighted mean is expressed as a MapLibre expression tree over the five
per-cell properties, so a slider move only calls `setPaintProperty` with new
coefficients — nothing is re-parsed and nothing is re-uploaded. Computing scores
in JS and calling `setData` on 10,380 features was tried and felt laggy. Measured
on the final build, the whole input handler (recompute 10,380 scores, sort,
re-cut quintiles, set two paint properties) runs in a median of 8.8 ms, inside a
single 60 fps frame.

## Where honesty cost impressiveness

Three places, worth naming.

The **transparent no-data cells** make the map look patchy under skewed
weightings, where a filled pale band would have looked complete and considered.
Complete would have been a lie.

The **zero-pinning** removed a great deal of mid-tone colour from the map. Under
the original tie-midpoint ranking the whole corridor glowed at a plausible-looking
middling pressure; the corrected version has large genuinely empty areas, which
is a less striking image and a truer one.

And the **framing itself** is the big one. A layer called "Cumulative Impact
Index" with an authoritative-looking legend would be a far more compelling thing
to show someone than "Compound pressure — where monitored pressures overlap, not
an impact assessment". The second is what the data supports.
