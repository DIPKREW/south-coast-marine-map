/**
 * Fetch RECREATIONAL VESSEL DENSITY for the project corridor and bundle it at
 * public/data/recreational-pressure.geojson.
 *
 * Run with: npm run data:recreational
 *
 * SOURCE, AND WHY THIS ONE
 * ------------------------
 * MMO's own ArcGIS org (services.arcgis.com/JJzESW51TqeY9uat), layer
 * `Short_Sea_Shipping_Recreational_Vessels_Update` — the MMO 2km vessel density
 * grid with the full ship-type-group breakdown. Open Government Licence, no key.
 *
 * SAMPLING YEAR: 2015. AIS sampled from the first seven days of each month
 * through 2015; the twelve sample weeks averaged to a weekly mean. That is three
 * to four years newer than the MMO1066 2011/2012 grid this usually gets sourced
 * from, and it is the newest MMO grid that is actually retrievable — which took
 * some finding:
 *
 *   • data.gov.uk lists Vessel Density Grid 2013, 2014 AND 2015, all newer than
 *     MMO1066. Every one of their download links is DEAD (the S3 objects 404).
 *   • An ArcGIS layer called "MMO Vessel Desnity 2019" exists and is tempting.
 *     It is a third-party re-host, it carries only `Yearly_Avg_STG_Total` with NO
 *     ship-type breakdown at all — so no recreational figure — and its extent is
 *     a small patch around the Solent, not the UK. Unusable twice over.
 *   • EMODnet Human Activities publishes route density from 2017 onward, which
 *     would be newer, but only as WMS raster (`routedensity_*`); there is no
 *     vector grid to query and no recreational attribute to filter on.
 *   • AIS2015/2016/2017 "Recreational Vessels" layers exist on ArcGIS but are
 *     tile caches (MapServer), i.e. pictures, not queryable data.
 *
 * So 2015 it is, and the About text says so plainly. It is a decade old.
 *
 * THE FIELD: `avg_stg_10`. Ship type group 10 is "Recreational vessels" and the
 * source's own attribute documentation defines the field as "Weekly average
 * number of transits of Recreational vessels". The UNIT IS TRANSITS PER WEEK —
 * not vessel-hours, not a count of boats. `weekly_avg` / `avg_total_` are the
 * ALL-VESSEL totals and are deliberately not what this layer draws: the brief is
 * recreational pressure, not shipping traffic.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SOUTH_COAST_BBOX, BEACHY_HEAD_LON, fetchAllFeatures, fetchCount } from './lib/southcoast.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, '../public/data/recreational-pressure.geojson');

const SERVICE =
  'https://services.arcgis.com/JJzESW51TqeY9uat/arcgis/rest/services/' +
  'Short_Sea_Shipping_Recreational_Vessels_Update/FeatureServer/1';

// Same rectangle as the seabed habitats and marine species layers. Vessel
// activity is not a hydrological question, so this uses the corridor rectangle
// rather than the catchment boundary — with the same 0.245°E Beachy Head cutoff.
const [W, S, , N] = SOUTH_COAST_BBOX;
const E = BEACHY_HEAD_LON;

const PAGE = 1000;

const envelope = {
  geometry: [W, S, E, N].join(','),
  geometryType: 'esriGeometryEnvelope',
  inSR: '4326',
  spatialRel: 'esriSpatialRelIntersects',
};

/**
 * Density bands, chosen from the actual corridor distribution rather than round
 * numbers — transits per week is long-tailed (median 0.83, max 807), so equal
 * intervals would put almost every cell in one colour:
 *
 *   < 0.5   3,437 cells      5 – 20     822
 *   0.5 – 1 2,104            >= 20      267
 *   1 – 5   3,750
 */
const BANDS = [0.5, 1, 5, 20];

async function main() {
  console.log('Fetching recreational vessel density (MMO 2km grid, 2015 AIS)…');
  console.log(`  corridor [W,S,E,N] = ${W}, ${S}, ${E}, ${N}   (east edge = Beachy Head cutoff)`);
  console.log('  field: avg_stg_10 — "Weekly average number of transits of Recreational vessels"');

  const total = await fetchCount(SERVICE, { ...envelope, where: '1=1' });
  console.log(`  ${total} grid cells returned by the envelope query; paging…`);

  const raw = await fetchAllFeatures(
    SERVICE,
    { ...envelope, where: '1=1', outFields: 'cell_id,avg_stg_10,avg_total_', geometryPrecision: '5' },
    { pageSize: PAGE },
  );
  if (raw.length < total) throw new Error(`Incomplete fetch: ${raw.length}/${total}`);

  /*
   * The service stores its grid in EPSG:3035, so ArcGIS reprojects the lon/lat
   * envelope into that CRS as an axis-aligned box — which, on a Lambert
   * azimuthal projection, over-covers the corridor by roughly half a degree on
   * every side. Left alone that paints vessel density up the Bristol Channel,
   * across to Cherbourg and past London. So the corridor is enforced HERE, on
   * the cell CENTRE — the same rule the marine species grid uses to decide
   * whether a square belongs.
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

  let outside = 0;
  const round = (v) => (v == null ? null : Math.round(Number(v) * 100) / 100);
  const features = raw
    .filter((f) => f.geometry?.coordinates?.length)
    .filter((f) => {
      if (inCorridor(centre(f.geometry))) return true;
      outside++;
      return false;
    })
    .map((f) => {
      const p = f.properties ?? {};
      return {
        type: 'Feature',
        properties: {
          // Recreational transits per week — the thing this layer is about.
          rec: round(p.avg_stg_10) ?? 0,
          // All-vessel weekly total, carried only so the card can say what share
          // of the traffic in this cell was recreational.
          all: round(p.avg_total_),
        },
        geometry: f.geometry,
      };
    });

  const fc = { type: 'FeatureCollection', features };
  const txt = JSON.stringify(fc);
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, txt);

  // Report the real distribution so the ramp bands stay honest.
  const vals = features.map((f) => f.properties.rec).sort((a, b) => a - b);
  const counts = new Array(BANDS.length + 1).fill(0);
  for (const v of vals) {
    let b = 0;
    while (b < BANDS.length && v >= BANDS[b]) b++;
    counts[b]++;
  }
  const labels = ['< 0.5', '0.5–1', '1–5', '5–20', '≥ 20'];
  console.log('\n  recreational transits per week, by band:');
  counts.forEach((n, i) => console.log(`     ${labels[i].padEnd(6)} ${String(n).padStart(6)} cells`));
  console.log(`  min ${vals[0]}, median ${vals[Math.floor(vals.length / 2)]}, max ${vals[vals.length - 1]}`);

  const kb = (Buffer.byteLength(txt) / 1024).toFixed(0);
  console.log(`\n  ${outside} cell(s) fell outside the corridor and were dropped (see the note in the code)`);
  console.log(`Wrote ${OUT} — ${features.length} cells, ${kb} KB.`);
}

main().catch((err) => {
  console.error('Failed to build recreational pressure data:', err.message);
  process.exit(1);
});
