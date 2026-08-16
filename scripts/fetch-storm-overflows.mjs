/**
 * Fetch the ENVIRONMENT AGENCY's EVENT DURATION MONITORING (EDM) ANNUAL RETURN
 * — how many times each storm overflow spilled in a calendar year, and for how
 * long — clip to the project bbox, and bundle at public/data/storm-overflows.geojson.
 *
 * Run with: npm run data:storm-overflows
 *
 * Source: "Event Duration Monitoring - Storm Overflow Annual Returns - All Years
 * - Public", the Environment Agency's own published ArcGIS FeatureServer. Open,
 * no key, no registration. The service holds every annual return from 2021 on;
 * this script takes the MOST RECENT year present (reported on every run) rather
 * than hard-coding one, so re-running it after the next return picks that up.
 *
 * What the numbers mean — worth knowing before styling them:
 *   • A "spill" is counted by the 12-24h method: discharges are grouped into
 *     12-hour blocks, so one long discharge counts once, not continuously.
 *   • Duration is the raw total hours of discharge BEFORE that grouping.
 *   • A monitor that ran for only part of the year still reports; the
 *     `edm_operation_percent_calculated` field carries that coverage, and it is
 *     kept so the map can be honest about a low count from a patchy monitor.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { bboxParams, fetchAllFeatures, fetchCount, roundCoords, loadBoundary } from './lib/southcoast.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, '../public/data/storm-overflows.geojson');

// A compact { unique_id: site name } lookup written alongside the GeoJSON.
// The LIVE status feed (National Storm Overflow Hub) identifies each overflow
// only by that same unique id and its receiving watercourse — it carries no site
// name — but the ids match this annual return, so the live layer fetches this
// small file to put a real name on its hover card.
const NAMES_OUT = resolve(__dir, '../public/data/storm-overflow-names.json');

const SERVICE =
  'https://services1.arcgis.com/JZM7qJpmv7vJ0Hzx/arcgis/rest/services/edm_annual_returns_all_years_public/FeatureServer/0';

// The service caps a page at 1000 records.
const PAGE_SIZE = 1000;

const FIELDS = [
  'unique_id',
  'site_name_ea_condat',
  'water_company_name',
  'counted_spills_12_24hr_calculated',
  'total_spill_duration_hrs_calculated',
  'edm_operation_percent_calculated',
  'receiving_water_environment_common_name_ea_condat',
  'bathing_water',
  'storm_discharge_asset_type',
  'annual_return_year',
].join(',');

/** Ask the service which annual return years it holds, and take the newest. */
async function latestYear() {
  const qs = new URLSearchParams({
    where: '1=1',
    outFields: 'annual_return_year',
    returnDistinctValues: 'true',
    returnGeometry: 'false',
    f: 'json',
  });
  const res = await fetch(`${SERVICE}/query?${qs}`);
  if (!res.ok) throw new Error(`Year query failed: ${res.status}`);
  const json = await res.json();
  const years = (json.features ?? [])
    .map((f) => f.attributes?.annual_return_year)
    .filter(Boolean)
    .map(String)
    .filter((y) => /^\d{4}$/.test(y))
    .sort();
  if (!years.length) throw new Error('No annual_return_year values returned');
  return { latest: years[years.length - 1], all: years };
}

// Titlecase the SHOUTED site names from the EA consents database, keeping the
// sector's acronyms (WWTW = wastewater treatment works, CSO = combined sewer
// overflow, STW, SPS, PS…) upper case.
const KEEP_UPPER = new Set(['WWTW', 'WTW', 'STW', 'CSO', 'SPS', 'PS', 'SO', 'EO', 'WPS', 'WRC', 'UV', 'A', 'B', 'C', 'I', 'II', 'III']);
const titleCase = (s) =>
  String(s)
    .toLowerCase()
    .replace(/\b[\w']+\b/g, (w) => w[0].toUpperCase() + w.slice(1))
    .replace(/\b[\w']+\b/g, (w) => (KEEP_UPPER.has(w.toUpperCase()) ? w.toUpperCase() : w));

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

async function main() {
  console.log('Fetching Environment Agency EDM storm overflow annual returns…');

  // Membership is HYDROLOGICAL, not geometric: an overflow is in if its water
  // ends up on this coast. The boundary's envelope is only the server-side query
  // window — every point that comes back is then tested against the boundary
  // itself, so Salisbury (40 km inland, drains south down the Hampshire Avon) is
  // kept while Bideford (on the coast, drains to the Bristol Channel) is not.
  const boundary = await loadBoundary();
  const [w, s, e, n] = boundary.envelope;
  console.log(`  catchment boundary envelope [W,S,E,N] = ${w.toFixed(3)}, ${s.toFixed(3)}, ${e.toFixed(3)}, ${n.toFixed(3)}`);

  const { latest, all } = await latestYear();
  console.log(`  years available: ${all.join(', ')}`);
  console.log(`  using most recent: ${latest}`);

  const where = `annual_return_year='${latest}'`;
  const envelope = {
    geometry: boundary.envelope.join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
  };
  const params = { ...envelope, where, outFields: FIELDS, geometryPrecision: '6' };

  const total = await fetchCount(SERVICE, { ...envelope, where });
  console.log(`  ${total} storm overflow(s) in the query envelope for ${latest}; paging…`);

  const raw = await fetchAllFeatures(SERVICE, params, { pageSize: PAGE_SIZE });
  if (raw.length < total) throw new Error(`Incomplete fetch: ${raw.length}/${total}`);

  // Normalise to the small, stable property set the map consumes.
  const byCompany = new Map();
  let noGeom = 0;
  let noCount = 0;
  let outside = 0;
  const features = [];
  for (const f of raw) {
    if (!f.geometry?.coordinates?.length) {
      noGeom++;
      continue;
    }
    // The hydrological test — this is what replaced the rectangle.
    if (!boundary.contains(f.geometry.coordinates)) {
      outside++;
      continue;
    }
    const p = f.properties ?? {};
    const spills = num(p.counted_spills_12_24hr_calculated);
    const hours = num(p.total_spill_duration_hrs_calculated);
    // A return with no spill count is a hole, not a zero — drop it rather than
    // draw it as "never spilled".
    if (spills == null) {
      noCount++;
      continue;
    }
    const company = p.water_company_name || 'Unknown';
    byCompany.set(company, (byCompany.get(company) ?? 0) + 1);

    features.push({
      type: 'Feature',
      properties: {
        id: p.unique_id || null,
        name: p.site_name_ea_condat ? titleCase(p.site_name_ea_condat) : null,
        co: company,
        spills,
        hours: hours == null ? null : Math.round(hours * 10) / 10,
        // % of the reporting period the monitor was actually operational.
        cover: num(p.edm_operation_percent_calculated),
        water: p.receiving_water_environment_common_name_ea_condat
          ? titleCase(p.receiving_water_environment_common_name_ea_condat)
          : null,
        bathing: p.bathing_water && p.bathing_water !== 'Not Applicable' ? p.bathing_water : null,
        year: latest,
      },
      geometry: roundCoords(f.geometry),
    });
  }

  const collection = { type: 'FeatureCollection', features };
  const out = JSON.stringify(collection);
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, out);

  const names = Object.fromEntries(
    features.filter((f) => f.properties.id && f.properties.name).map((f) => [f.properties.id, f.properties.name]),
  );
  const namesOut = JSON.stringify(names);
  await writeFile(NAMES_OUT, namesOut);

  // Report what the data actually says, so the About copy can stay factual.
  const spills = features.map((f) => f.properties.spills).sort((a, b) => a - b);
  const sum = spills.reduce((a, b) => a + b, 0);
  const q = (p) => spills[Math.min(spills.length - 1, Math.floor(spills.length * p))];
  const zero = spills.filter((s) => s === 0).length;
  const top = [...features].sort((a, b) => b.properties.spills - a.properties.spills).slice(0, 5);

  console.log(`\n  by water company:`);
  for (const [co, n] of [...byCompany].sort((a, b) => b[1] - a[1])) console.log(`     ${co}: ${n}`);
  console.log(`\n  ${outside} of ${raw.length} overflow(s) in the envelope fell OUTSIDE the catchment boundary — dropped`);
  if (noGeom) console.log(`  ! ${noGeom} record(s) had no geometry — dropped`);
  if (noCount) console.log(`  ! ${noCount} record(s) had no spill count — dropped`);

  console.log(`\n  spill counts (${latest}): total ${sum.toLocaleString('en-GB')} spills across ${features.length} overflows`);
  console.log(`     ${zero} overflow(s) recorded zero spills`);
  console.log(`     median ${q(0.5)}, p75 ${q(0.75)}, p90 ${q(0.9)}, max ${spills[spills.length - 1]}`);
  console.log(`  highest five:`);
  for (const f of top) {
    const p = f.properties;
    console.log(`     ${p.spills} spills / ${p.hours ?? '?'} h — ${p.name ?? p.id} (${p.co})`);
  }

  const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
  console.log(`\nWrote ${OUT} — ${features.length} features, ${kb} KB.`);
  const nkb = (Buffer.byteLength(namesOut) / 1024).toFixed(0);
  console.log(`Wrote ${NAMES_OUT} — ${Object.keys(names).length} names, ${nkb} KB (for the live status layer).`);
}

main().catch((err) => {
  console.error('Failed to build storm overflow data:', err.message);
  process.exit(1);
});
