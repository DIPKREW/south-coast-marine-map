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
