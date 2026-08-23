/**
 * Design tokens — the single source of truth for the palette and type.
 *
 * These values drive BOTH the CSS (injected as custom properties onto :root at
 * startup, see applyTokens()) and the MapLibre style JSON (imported directly in
 * src/map/mapStyle.js). Retune the look from this one file.
 *
 * Direction: calm, warm, editorial — a cream/parchment page, thin charcoal
 * linework, and a single terracotta accent. Sibling to the Anthropic site.
 */

export const palette = {
  paper: '#F3EEE4', // page + map base
  surface: '#FBF8F1', // floating panels / cards
  ink: '#1A1915', // text + map linework
  'ink-muted': '#6F6B60', // secondary text, minor linework
  accent: '#CC6B49', // terracotta / clay — active states, the SSSI layer
  'accent-soft': 'rgba(204,107,73,0.15)', // accent fills
  'accent-strong': '#B85636', // accent on hover / pressed
  'accent-2': '#7C8A6B', // muted sage — the nature-recovery opportunity layer
  'accent-2-soft': 'rgba(124,138,107,0.12)', // sage fills
  'accent-2-strong': '#6B7A5B', // sage on hover
  'accent-3': '#4E6E82', // muted slate-blue — Dorset Wildlife Trust reserves
  'accent-3-soft': 'rgba(78,110,130,0.13)', // slate fills
  'accent-3-strong': '#3E5A6B', // slate on hover / outline
  'accent-4': '#C68A2E', // warm gold — DWT visitor-centre markers (a gentle pop)
  'accent-4-strong': '#A06E1E', // gold outline / hover
  hairline: '#DDD6C7', // borders + dividers
  'basemap-water': '#E9E7DF', // basemap water: near-paper, a whisper of cool grey
  'basemap-water-line': '#D2CDBE', // basemap hairline coast / lake edge
  landcover: '#ECE6D9', // barely-there wood / heath tint
  // The "Rivers & waterways" layer — a muted, sophisticated water blue.
  water: '#47859B', // watercourse lines (slightly darker than fills)
  'water-soft': '#C4DAE0', // water-body fills
  'water-strong': '#33697B', // river labels + water-body outline
  // Agricultural Land Classification — a muted EARTH ramp, pale → deep, with extra
  // contrast so the dominant Grade 3 doesn't swamp it. Monotonic best→poorest
  // (incl. post-1988's finer 3a/3b between 2–3 and 3–4). NOT green="good": poorest
  // land (4 & 5) is deepest, to draw the eye. All desaturated, on-palette.
  'alc-1': '#EAE0C8', // Grade 1 excellent — palest sand
  'alc-2': '#D8C194', // Grade 2 very good
  'alc-3a': '#C8AB73', // Grade 3a good (post-1988 only)
  'alc-3': '#B6925A', // Grade 3 good–moderate (provisional, undivided)
  'alc-3b': '#A37C45', // Grade 3b moderate (post-1988 only)
  'alc-4': '#8A6537', // Grade 4 poor
  'alc-5': '#6E4E2A', // Grade 5 very poor — deep umber
  'alc-nonag': '#E6E2DA', // non-agricultural / urban — faint neutral, recedes
  // Field crops (CROME) — six muted, desaturated categories (warm crops → greens).
  'crome-cereals': '#CDB97E', // cereals (wheat/barley/oats) — muted straw
  'crome-oilseed': '#C89A4E', // oilseed & break crops (OSR/beans/peas) — ochre
  'crome-rootmaize': '#B07C56', // maize & root crops — russet clay
  'crome-grass': '#9AAA7E', // grassland — muted green
  'crome-trees': '#6F8060', // woodland & trees — deeper green
  'crome-other': '#D6D0C2', // other / non-agricultural — neutral
  // Notable species (NBN Atlas) — a muted heather purple (suits heathland
  // species, distinct from the other accents, stays on-palette).
  species: '#8A739E', // grid fill
  'species-soft': '#C8BBD2', // light tint
  'species-strong': '#6E587F', // denser cells / hover / outline
  // Marine protected areas — a DEEP TEAL, distinct from the river water-blue
  // (#47859B). Rendered as outlines + a very faint fill so heavy overlaps stay
  // legible.
  marine: '#1F6F76', // MPA outlines
  'marine-soft': '#A9CBCC', // very faint fill / legend swatch
  'marine-strong': '#134E54', // hover outline
  // Coastal erosion risk (NCERM) — a muted pale→clay ramp (warm, on-palette),
  // low risk pale and receding, high risk deep rust to draw the eye.
  'erosion-0': '#E7DDC8', // negligible — pale sand
  'erosion-1': '#E1C58D', // low — straw
  'erosion-2': '#D49E5E', // moderate — amber
  'erosion-3': '#BE7444', // high — clay
  'erosion-4': '#9C4F2E', // very high — deep rust
  // Storm overflow ANNUAL SPILL COUNT — pale ash-rose → deep crimson. Same
  // "pale recedes, deep draws the eye" logic as the erosion ramp, but shifted
  // to a COOL RED (crimson/wine) so it cannot be mistaken for erosion's warm
  // amber/rust family where the two sit on the same stretch of coast.
  'spill-0': '#E3D9D9', // no recorded spills — near-neutral ash
  'spill-1': '#D3AEB2', // 1–9
  'spill-2': '#BC7B85', // 10–39
  'spill-3': '#9C4653', // 40–99
  'spill-4': '#701F2E', // 100+ — deep wine, the warning end
  // Live discharge status — a two-state signal plus an honest "no signal".
  'discharge-on': '#B8322A', // currently discharging — a clear alert red
  'discharge-off': '#7E8A86', // not discharging — quiet slate outline
  'discharge-offline': '#BCB6A8', // monitor offline / no signal — faint, recedes
  // WFD water body ECOLOGICAL status — a blue-green → dun scale. Health reads
  // as colour: a vivid sea-green at High, draining through sage to a flat dun
  // at Bad. Distinct in hue from both the erosion (amber) and spill (crimson)
  // ramps, and lighter/greener than the marine teal it sits beneath.
  'wfd-high': '#3F8474', // High — sea green
  'wfd-good': '#6FA491', // Good
  'wfd-moderate': '#9DB3A5', // Moderate — colour starting to drain
  'wfd-poor': '#B6A98F', // Poor
  'wfd-bad': '#9A8468', // Bad — flat dun
  'wfd-unknown': '#D6D0C2', // not classified — neutral, recedes
  // Seabed habitats (JNCC UKSeaMap) — a COOL STONE family: slate, lilac-grey and
  // olive, reading as materials rather than as a ranked scale, because these are
  // different substrates and not more-or-less of anything. Kept cool and
  // desaturated so it works as the bottom-most wash under everything else, and
  // so it cannot be read as the warm erosion ramp or the crimson spill ramp.
  'seabed-rock': '#6B6478', // rock & reef — hardest, darkest
  'seabed-coarse': '#9A93A3', // coarse sediment — gravel, shell, pebble
  'seabed-mixed': '#7E8798', // mixed sediment
  'seabed-sand': '#C3BCA8', // sand — pale cool stone, not the warm erosion sand
  'seabed-mud': '#6F7668', // mud — olive-grey, the finest
  'seabed-biogenic': '#7E9A86', // seagrass / biogenic reef — living structure
  'seabed-intertidal': '#B0A6B4', // littoral rock & sediment
  'seabed-unknown': '#CBC5BC', // unclassified — recedes
  // Marine species (NBN Atlas) — a MAGENTA-ROSE. It keeps the "species = purple
  // family" idea of the land layer's heather (#8A739E), but pushed hot and
  // saturated because this grid is drawn OVER the seabed wash, and the first
  // attempt (a deep indigo) sat in the same cool violet family as the seabed
  // slates — at a glance the cells just read as darker seabed. Against grey-
  // lilac it now reads unmistakably as a separate layer, and it stays clear of
  // the spill ramp's darker wine reds.
  /*
   * LICENSED SEABED ACTIVITY (MMO marine licensing) — an INDUSTRIAL family:
   * olive-khaki for extraction, slate greys for dredging, dark slate for the
   * disposal grounds. Deliberately the least "natural" palette on the map,
   * because this is the one layer about industry rather than ecology or water
   * quality. PROPOSED, FLAGGED FOR REVIEW: the khakis sit nearer the WFD dun
   * (#9A8468) and the seabed olive (#6F7668) than anything else here, though
   * both of those are far less saturated.
   */
  'lic-aggregate': '#7C6E2A', // aggregate extraction — deep olive-khaki
  'lic-navdredge': '#59606B', // navigational dredging — slate
  'lic-otherdredge': '#828A94', // other / clean-up dredging — light slate
  'lic-disposal': '#A08A3C', // disposal of dredged material — ochre khaki
  'lic-site': '#3F4650', // Cefas disposal grounds — darkest slate
  /*
   * RECREATIONAL PRESSURE (MMO vessel density) — a pale mauve → deep magenta-
   * purple ramp. PROPOSED, FLAGGED FOR REVIEW: this is the most crowded corner
   * of the palette. It is clear of the erosion ambers, the spill crimsons, the
   * WFD greens and the marine teal, but it shares a broad family with the seabed
   * slates (far greyer, much less saturated) and with the sharks-and-rays species
   * dots (small point markers rather than a wash). Worth a look with both on.
   */
  /*
   * COMPOUND PRESSURE INDICATOR — an "ember" ramp, pale ash through to deep
   * plum-brown. Chosen because it reads as INTENSITY rather than as a category:
   * this layer is a weighted composite with no units, so a ramp that looks like
   * heat is more honest than one that looks like a classification.
   *
   * Kept clear of the two nearest neighbours on this map: the erosion ambers are
   * warmer and stop at rust, the spill crimsons are pink-to-wine. This one runs
   * gold to plum. PROPOSED, FOR REVIEW.
   */
  'cp-0': '#EDE7DA', // lowest band — barely tinted
  'cp-1': '#D9C069',
  'cp-2': '#C4823C',
  'cp-3': '#A04A42',
  'cp-4': '#5E2547', // highest band — deep plum
  /*
   * SHIPWRECKS (UKHO) — near-black markers with a paper halo.
   *
   * Every other thematic family on this map is a HUE (amber, crimson, teal,
   * mauve, indigo, cyan, khaki, heather). Wrecks deliberately take none of them:
   * a dark neutral dot reads as structure on the seabed rather than as another
   * measured quantity, and it stays legible over every wash underneath it —
   * which matters, because this layer sits on top of all of them.
   *
   * PROPOSED, FOR REVIEW — as with every palette on this map.
   */
  wreck: '#2E3138', // individual wreck marker
  'wreck-danger': '#6B3038', // "dangerous wreck" — a rust-red bias, not a new family
  'wreck-cluster': '#4A505C', // aggregated cluster bubble at low zoom
  // Protected wreck sites (Historic England). Brass, and always drawn as a RING
  // around a dark centre — the ring shape, not just the hue, is what marks them
  // out, so they stay distinguishable from the dormant DWT gold markers.
  'wreck-protected': '#C08A2A',
  /*
   * SEA FLOOD RISK (EA NaFRA2 climate-change extents) — one CYAN family for all
   * four scenarios, because they are four views of a single thing rather than
   * four different subjects. PROPOSED, FOR REVIEW.
   *
   * Cyan is the last clear hue on this map: brighter and cooler than the marine
   * teal (#1F6F76) and the river blue (#47859B), and nowhere near the fisheries
   * indigo. It also lands mostly on LAND — coastal lowland — where the only
   * other washes are the dormant Dorset land layers, so it has room to breathe.
   *
   * Within the family, the distinction is DEPTH, not hue:
   *   undefended  paler and broader — the extent with defences ignored
   *   defended    deeper, drawn on top — the extent as currently defended
   * The defended extent nests inside the undefended one, so with both on the
   * pale margin around the deep core IS what the defences are holding back.
   * The rarer 1-in-1000 pair is lighter than the 1-in-200 pair.
   */
  'flood-200-undef': '#B3E5F0', // 1 in 200, undefended — pale cyan margin
  'flood-200-def': '#0E6B85', // 1 in 200, defended — deep cyan core
  'flood-1000-undef': '#D2EFF5', // 1 in 1000, undefended — lightest, rarest
  'flood-1000-def': '#3FA0BA', // 1 in 1000, defended
  'flood-line': '#146B80', // shared outline for all four
  // Commercial fishing activity (MMO VMS position density) — a true INDIGO BLUE,
  // the one hue family nothing else on this map occupies. Deliberately not the
  // recreational magenta it will often be compared against, not the river blue
  // (#47859B, a desaturated teal), and not the marine teal: those three sit
  // either side of it in hue and none reads as this cold. Pale → deep with
  // intensity, so the busiest ground is the darkest thing in the water.
  'fish-0': '#DFE4F1', // < 50 position reports — barely present
  'fish-1': '#AEBBDF', // 50–250
  'fish-2': '#7488C6', // 250–1,000
  'fish-3': '#4557A0', // 1,000–5,000
  'fish-4': '#212C61', // 5,000+ — the heavily worked ground
  'rec-0': '#EFE4EC', // < 0.5 transits/week — barely present
  'rec-1': '#DCB6D6', // 0.5–1
  'rec-2': '#C583C4', // 1–5
  'rec-3': '#A44BA6', // 5–20
  'rec-4': '#6E1C74', // 20+ — the busy water
  /*
   * BATHING WATER CLASSIFICATION (EA, rBWD 2015 scheme) — a RAG scale, plus a
   * pale neutral for "not assessed".
   *
   * This REPLACES an earlier four-step violet ramp. That ramp was clear of every
   * neighbouring palette on paper and failed at the only test that matters: at
   * marker size on screen its four steps were not separable, so the
   * classification could not be read off the map at all. Being unclashing is
   * worth nothing if it is also unreadable.
   *
   * TWO GREENS ARE DELIBERATE. Excellent is a deep, saturated true green;
   * Good is a much lighter YELLOW-green. They are separated on both axes at
   * once — roughly 30 points of lightness and a clear hue shift — because two
   * greens that differ only in hex are exactly the failure this change exists
   * to fix. Sufficient is amber, Poor is red.
   *
   * AGAINST THE WFD WATER BODY FILLS, which is the obvious risk since that layer
   * is also green and will commonly be on underneath: WFD's greens are
   * DESATURATED BLUE-greens (#6FA491 sage, #9DB3A5 grey-green) drawn as large
   * pale washes, and its darkest band (#3F8474 High) does not occur anywhere in
   * this corridor — the only bands present are Moderate, Good and one Poor. The
   * bathing greens are saturated, warm-shifted and small, and they carry the
   * cream halo. Checked on screen, not just in a swatch.
   *
   * KNOWN NEAR-CLASH, REPORTED RATHER THAN HIDDEN: Poor (#C4342A) sits close to
   * the live discharge alert red (#B8322A). Red is already spoken for twice on
   * this map — that alert, and the deep end of the spill ramp — and a RAG scale
   * needs a red. What separates them is structure and place: a bathing water is
   * always a ringed marker on a beach, a live discharge is a plain disc at an
   * outfall. Eight sites in the corridor are Poor.
   *
   * NOT ASSESSED IS OFF THE RAMP. A pale warm neutral, so it reads as "no
   * answer" rather than as a fifth band below Poor.
   *
   * RAG IS NOT COLOUR-BLIND SAFE, and no arrangement of it is. Excellent and
   * Poor are close in lightness and opposite in hue, which is the pairing
   * red–green deficiency collapses. The card always names the classification in
   * words, which is what a reader who cannot separate the ends has to rely on.
   */
  'bw-excellent': '#2F7A3A', // Excellent — deep true green
  'bw-good': '#93C13F', // Good — light yellow-green, well clear of Excellent
  'bw-sufficient': '#F0B429', // Sufficient — amber
  'bw-poor': '#C4342A', // Poor — red
  'bw-unassessed': '#DDD8CC', // not assessed — pale warm neutral, off the ramp entirely
  'bw-ring': '#4A4536', // the shared dark hairline that makes the marker a bathing water
  'marine-species': '#B23A82', // legacy single-species tint (kept for the toggle accent)
  'marine-species-strong': '#7E2459',
  /*
   * MARINE SPECIES MARKERS — 18 species, one dot each.
   *
   * PROPOSED, FLAGGED FOR REVIEW. Four families, one per taxonomic group, so a
   * reader can tell a whale from a squid at a glance without memorising 18
   * colours; within a family the shades run dark→light, so species stay
   * separable when several are ticked at once. These are small saturated dots
   * drawn ON TOP of the muted seabed and water washes, which is why they are
   * allowed to be brighter than anything else on this map.
   */
  // Marine mammals — indigo/blue
  'sp-greyseal': '#2E3C93',
  'sp-harbourseal': '#4356B4',
  'sp-commondolphin': '#5C71CE',
  'sp-bottlenose': '#7A8CDE',
  'sp-porpoise': '#96A6EA',
  'sp-minkewhale': '#B2BFF5',
  // Sharks & rays — plum/magenta
  'sp-baskingshark': '#7A1F5C',
  'sp-tope': '#9C3378',
  'sp-thornbackray': '#BC4E94',
  'sp-undulateray': '#D477B2',
  // Fish — amber/gold
  'sp-bluefin': '#9E6413',
  'sp-seahorse': '#C68A22',
  'sp-shortseahorse': '#E0AE4E',
  // Cephalopods — coral/red-orange
  'sp-cuttlefish': '#9B3020',
  'sp-curledoctopus': '#B94933',
  'sp-commonoctopus': '#D06849',
  'sp-europeansquid': '#E08A6C',
  'sp-veinedsquid': '#EDAC94',
};

export const fonts = {
  // Warm editorial serif for the wordmark + headings.
  display: "'Fraunces', Georgia, 'Times New Roman', serif",
  // Clean sans for UI / body / labels.
  ui: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
  // Small mono for the editorial, Anthropic-ish micro-labels.
  mono: "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace",
};

/**
 * Inject the palette as CSS custom properties (`--paper`, `--accent`, …) onto
 * the document root, so CSS and JS never drift out of sync.
 */
export function applyTokens(root = document.documentElement) {
  for (const [name, value] of Object.entries(palette)) {
    root.style.setProperty(`--${name}`, value);
  }
}
