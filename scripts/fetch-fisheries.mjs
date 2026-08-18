/**
 * Fetch COMMERCIAL FISHING ACTIVITY for the project corridor and bundle it at
 * public/data/fisheries.geojson.
 *
 * Run with: npm run data:fisheries
 *
 * SOURCE, AND WHY THIS ONE
 * ------------------------
 * MMO's own ArcGIS org, service `Fisheries_Heatmap_webmap__2019_to_2022__WFL1`,
 * layer 7 — "Vessel Monitoring System (VMS) Reported Position Density", covering
 * 2019 to 2022 and published December 2024. Open Government Licence, no key.
 *
 * MMO publishes a great many fishing-effort services and most of them are older
 * or narrower. What was checked before settling here:
 *
 *   • `S4_FishingEffort_2016_2020_WFL1` and `Fishing_Effort_UK_*_2016_to_2020` —
 *     2016–2020, and the latter are clipped to a 15 km buffer around Stage 3/4
 *     Marine Protected Areas, so they do not cover open corridor water.
 *   • `UK_and_Non-UK_15m_and_over_vessel_fishing_activity_2007-2010` — 2007–2010.
 *   • `UKu12_2016_2023cumulative_allyears_effort` — under-12 m vessels, 2016–2023,
 *     so newer at the end but a DIFFERENT fleet segment; it is not a superset and
 *     merging the two would double-count nothing but compare nothing either.
 *   • `ICES_Area_Landings_*` / `Landings_by_ICES_Rectangle_2020` — landings, not
 *     effort, and at ICES rectangle scale (roughly 30 x 30 nautical miles), which
 *     is far too coarse for a coastal corridor map.
 *
 * This layer is the most recent one that is both corridor-wide and resolved
 * finely enough to be worth drawing.
 *
 * WHAT THE NUMBER ACTUALLY IS — the thing not to guess
 * ---------------------------------------------------
 * `SUM_SUM_Join_Count` is a count of VMS POSITION REPORTS, not hours, not days,
 * and not tonnes. A vessel with VMS transmits its position on a fixed schedule,
 * so more reports in a cell means more vessel-time in that cell — but the figure
 * is a proxy for presence, not a measured effort statistic. It is summed here
 * across all months, gear groups and nationalities to give one total per cell for
 * the whole 2019–2022 window.
 *
 * `COUNT_Vessel_ID` is the number of distinct vessels for one (cell, gear,
 * nationality, month) combination. It is deliberately NOT summed: the same vessel
 * appears in many months, so a sum would count it repeatedly. The card reports the
 * busiest single month instead, which is a figure that means something.
 *
 * THE BIG CAVEAT: VMS is carried by vessels 12 m and over. The inshore under-12 m
 * fleet — most of the small boats working this coast — is largely absent, exactly
 * as AIS misses small recreational craft on the recreational pressure layer.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SOUTH_COAST_BBOX, BEACHY_HEAD_LON, fetchAllFeatures, fetchCount } from './lib/southcoast.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, '../public/data/fisheries.geojson');

const SERVICE =
  'https://services.arcgis.com/JJzESW51TqeY9uat/arcgis/rest/services/' +
  'Fisheries_Heatmap_webmap__2019_to_2022__WFL1/FeatureServer/7';

// Same rectangle as seabed habitats, marine species, recreational pressure and
// dredging — the corridor box with the hard Beachy Head cutoff, not the
// catchment boundary. Fishing is not a hydrological question.
const [W, S, , N] = SOUTH_COAST_BBOX;
const E = BEACHY_HEAD_LON;

const envelope = {
  geometry: [W, S, E, N].join(','),
  geometryType: 'esriGeometryEnvelope',
  inSR: '4326',
  spatialRel: 'esriSpatialRelIntersects',
};

/**
 * Intensity bands, chosen from the real corridor distribution rather than round
 * numbers — VMS position counts are heavily long-tailed. The run prints the
 * actual distribution so these stay honest if the source is refreshed.
 */
const BANDS = [50, 250, 1000, 5000];

/** The twelve MMO gear groups, shortened for the card without losing meaning. */
const GEAR_SHORT = {
  'Stern Trawl (Demersal)': 'Demersal trawl',
  'Beam Trawlers': 'Beam trawl',
  'Nephrop Trawlers': 'Nephrops trawl',
  'Pelagic Trawls': 'Pelagic trawl',
  'Netters (Static)': 'Static nets',
  'Hook/Lines': 'Hooks & lines',
  Longliners: 'Longlines',
  Potters: 'Pots & creels',
  Scallopers: 'Scallop dredge',
  'Purse Seine': 'Purse seine',
  'Fly Seine': 'Fly seine',
  Others: 'Other gear',
};

async function main() {
  console.log('Fetching commercial fishing activity (MMO VMS position density, 2019–2022)…');
  console.log(`  corridor [W,S,E,N] = ${W}, ${S}, ${E}, ${N}   (east edge = Beachy Head cutoff)`);
  console.log('  field: SUM_SUM_Join_Count — count of VMS position reports (proxy for vessel presence)');

  const total = await fetchCount(SERVICE, { ...envelope, where: '1=1' });
  console.log(`  ${total} rows in the query envelope (cell x gear x nationality x month); paging…`);

  const raw = await fetchAllFeatures(
    SERVICE,
    {
      ...envelope,
      where: '1=1',
      outFields: 'GRID_ID,Nationality,Gear_Group,Month,COUNT_Vessel_ID,SUM_SUM_Join_Count',
      geometryPrecision: '5',
    },
    { pageSize: 2000 },
  );
  if (raw.length < total) throw new Error(`Incomplete fetch: ${raw.length}/${total}`);

  /*
   * The service stores its grid in EPSG:3035, so ArcGIS reprojects the lon/lat
   * envelope into that CRS as an axis-aligned box and over-covers the corridor —
   * the same trap that painted recreational pressure up the Bristol Channel and
   * put a London bridge in the dredging layer. The corridor is enforced HERE, on
   * the real cell CENTRE.
   */
  const centre = (g) => {
    let xs = 0, ys = 0, n = 0;
    const walk = (c) => {
      if (typeof c[0] === 'number') { xs += c[0]; ys += c[1]; n++; } else c.forEach(walk);
    };
    walk(g.coordinates);
    return [xs / n, ys / n];
  };
  const inCorridor = ([x, y]) => x >= W && x <= E && y >= S && y <= N;

  // Aggregate the four-way split down to ONE record per grid cell.
  const cells = new Map();
  // Distinct cells rejected, not rejected ROWS — each out-of-corridor cell has
  // dozens of rows (one per gear x nationality x month) and counting those would
  // overstate the over-coverage by an order of magnitude.
  const rejected = new Set();
  for (const f of raw) {
    if (!f.geometry?.coordinates?.length) continue;
    const p = f.properties ?? {};
    const id = p.GRID_ID;
    if (!id || rejected.has(id)) continue;

    let cell = cells.get(id);
    if (!cell) {
      if (!inCorridor(centre(f.geometry))) { rejected.add(id); continue; }
      cell = { geometry: f.geometry, pos: 0, vmax: 0, gear: new Map(), nat: new Map(), months: new Set() };
      cells.set(id, cell);
    }
    const n = Number(p.SUM_SUM_Join_Count) || 0;
    cell.pos += n;
    cell.vmax = Math.max(cell.vmax, Number(p.COUNT_Vessel_ID) || 0);
    if (p.Month) cell.months.add(p.Month);
    if (p.Gear_Group) cell.gear.set(p.Gear_Group, (cell.gear.get(p.Gear_Group) ?? 0) + n);
    if (p.Nationality) cell.nat.set(p.Nationality, (cell.nat.get(p.Nationality) ?? 0) + n);
  }

  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];

  const features = [...cells.values()].map((c) => {
    const [gear, gearN] = top(c.gear);
    const [nat] = top(c.nat);
    return {
      type: 'Feature',
      properties: {
        pos: c.pos,
        // Share of this cell's positions belonging to the dominant gear, so the
        // card can say whether the cell is one fishery or a mixed ground.
        gear: GEAR_SHORT[gear] ?? gear ?? null,
        gearPct: c.pos ? Math.round((gearN / c.pos) * 100) : null,
        gears: c.gear.size,
        nat: nat || null,
        vmax: c.vmax,
        months: c.months.size,
      },
      geometry: c.geometry,
    };
  });

  const fc = { type: 'FeatureCollection', features };
  const txt = JSON.stringify(fc);
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, txt);

  // ---- Report the real distribution so the ramp bands stay honest ----
  const vals = features.map((f) => f.properties.pos).sort((a, b) => a - b);
  const counts = new Array(BANDS.length + 1).fill(0);
  for (const v of vals) {
    let b = 0;
    while (b < BANDS.length && v >= BANDS[b]) b++;
    counts[b]++;
  }
  const labels = ['< 50', '50–250', '250–1k', '1k–5k', '5k+'];
  console.log('\n  VMS position reports per cell, by band:');
  counts.forEach((n, i) => console.log(`     ${labels[i].padEnd(8)} ${String(n).padStart(5)} cells`));
  console.log(`  min ${vals[0]}, median ${vals[Math.floor(vals.length / 2)]}, max ${vals[vals.length - 1]}`);

  const gearTally = new Map();
  for (const f of features) gearTally.set(f.properties.gear, (gearTally.get(f.properties.gear) ?? 0) + 1);
  console.log('\n  dominant gear, by number of cells:');
  for (const [k, v] of [...gearTally].sort((a, b) => b[1] - a[1])) {
    console.log(`     ${String(k).padEnd(18)} ${String(v).padStart(5)}`);
  }
  const natTally = new Map();
  for (const f of features) natTally.set(f.properties.nat, (natTally.get(f.properties.nat) ?? 0) + 1);
  console.log('\n  dominant nationality, by number of cells:');
  for (const [k, v] of [...natTally].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`     ${String(k).padEnd(18)} ${String(v).padStart(5)}`);
  }

  const kb = (Buffer.byteLength(txt) / 1024).toFixed(0);
  console.log(`\n  ${rejected.size} distinct cell(s) fell outside the corridor and were dropped (envelope over-coverage)`);
  console.log(`Wrote ${OUT} — ${features.length} cells, ${kb} KB.`);
}

main().catch((err) => {
  console.error('Failed to build fisheries data:', err.message);
  process.exit(1);
});
