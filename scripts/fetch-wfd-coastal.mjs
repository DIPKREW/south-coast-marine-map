/**
 * Fetch the WATER FRAMEWORK DIRECTIVE COASTAL & TRANSITIONAL WATER BODIES —
 * the Environment Agency's own assessment of the ecological and chemical health
 * of each stretch of sea and estuary — clip to the project bbox, and bundle at
 * public/data/wfd-coastal.geojson.
 *
 * Run with: npm run data:wfd
 *
 * Source: "WFD Transitional and Coastal Water Bodies Cycle 4 Classification 2025"
 * — the current (Cycle 4) classification, published as an open ArcGIS
 * FeatureServer. No key, no registration.
 *
 * Two classifications are carried per water body, and they are NOT the same thing:
 *   • ECOLOGICAL — High / Good / Moderate / Poor / Bad. A five-band judgement
 *     built from biology (phytoplankton, seaweeds, invertebrates), supporting
 *     chemistry (dissolved oxygen, nitrogen) and specific pollutants.
 *   • CHEMICAL — Good / Fail only. Assessed against limits for priority
 *     hazardous substances. Since 2019 this includes "ubiquitous, persistent,
 *     bioaccumulative and toxic" substances (uPBTs such as mercury and PBDEs)
 *     which are present nationwide above threshold, so nearly every water body
 *     in England now fails on chemistry. That is a real result, but it says
 *     little about the local difference between one estuary and the next — so
 *     the MAP colours by ecological status and reports chemical status as text.
 *
 * `water_body_id` doubles as the Catchment Data Explorer key, so the hover card
 * can link straight to the EA's own page for that water body.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import mapshaper from 'mapshaper';
import { SOUTH_COAST_BBOX, bboxParams, fetchAllFeatures, fetchCount } from './lib/southcoast.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, '../public/data/wfd-coastal.geojson');

const SERVICE =
  'https://services3.arcgis.com/Bb8lfThdhugyc4G3/arcgis/rest/services/' +
  'WFD_Transitional_and_Coastal_Water_Bodies_Cycle_4_Classification_2025/FeatureServer/0';

const FIELDS = [
  'water_body_id',
  'water_body_name',
  'water_body_type',
  'ecological_class',
  'chemical_class',
  'classification_year',
  'river_basin_district',
  'country',
  'opcat_id',
  'operational_catchment',
].join(',');

/**
 * Water bodies inside the project's query box that drain to the BRISTOL CHANNEL
 * or the CELTIC SEA rather than the English Channel — the north and west coasts
 * of the South West peninsula. A rectangle cannot separate these: at Hayle the
 * north and south Cornish coasts are barely 10 km apart, so no rule based on
 * latitude or distance from the corridor can tell them apart — only which way
 * the water actually goes.
 *
 * Kept in step with scripts/build-catchment-boundary.mjs, which uses the same
 * list to decide which land catchments belong to the project. Listed by the EA's
 * own operational catchment id so the call is reviewable.
 */
const NORTH_DRAINING_OPCATS = new Map([
  [3220, 'Hayle Estuary — St Ives Bay, north Cornwall (Celtic Sea)'],
  [3247, 'Lands End to Trevose Head Coastal — north-west Cornwall (Celtic Sea)'],
  [3195, 'Gannel Estuary — Newquay, north Cornwall (Celtic Sea)'],
  [3066, 'Camel Estuary — Padstow, north Cornwall (Celtic Sea)'],
  [3108, 'Cornwall North Coastal — north Cornwall (Celtic Sea)'],
  [3289, 'Lundy Coastal — Bristol Channel'],
  [3026, 'Barnstaple Bay — Bristol Channel'],
  [3442, 'Taw and Torridge Estuary — Bristol Channel'],
  [3354, 'Parrett TraC — Severn Estuary / Bristol Channel'],
]);

// The five ecological bands, best → worst. Anything else (e.g. "Does not
// require assessment") is carried through as-is and drawn in the unknown grey.
const ECO_ORDER = ['High', 'Good', 'Moderate', 'Poor', 'Bad'];

// Water body names arrive inconsistently cased — some SHOUTED, some Title Case.
const titleCase = (s) =>
  String(s)
    .toLowerCase()
    .replace(/\b[\w'/-]+\b/g, (w) => w[0].toUpperCase() + w.slice(1));

async function main() {
  console.log('Fetching WFD coastal & transitional water body classifications…');
  console.log(`  project bbox [W,S,E,N] = ${SOUTH_COAST_BBOX.join(', ')}`);

  const params = bboxParams({ where: "country='England'", outFields: FIELDS, geometryPrecision: '6' });
  const total = await fetchCount(SERVICE, bboxParams({ where: "country='England'" }));
  console.log(`  ${total} water bod(ies) intersect the box; paging…`);

  const raw = await fetchAllFeatures(SERVICE, params, { pageSize: 1000 });
  if (raw.length < total) throw new Error(`Incomplete fetch: ${raw.length}/${total}`);

  // Drop the water bodies that drain the other way. These sat inside the old
  // rectangle purely because a rectangle drawn round the south coast also
  // catches the north coast of the same peninsula.
  const excluded = [];
  const features = raw
    .filter((f) => f.geometry?.coordinates?.length)
    .filter((f) => {
      const why = NORTH_DRAINING_OPCATS.get(f.properties?.opcat_id);
      if (!why) return true;
      excluded.push({ name: f.properties.water_body_name, why });
      return false;
    })
    .map((f) => {
      const p = f.properties ?? {};
      return {
        type: 'Feature',
        properties: {
          id: p.water_body_id || null,
          name: p.water_body_name ? titleCase(p.water_body_name) : null,
          wbtype: p.water_body_type || null, // 'Coastal' | 'Transitional'
          eco: p.ecological_class || null,
          chem: p.chemical_class || null,
          year: p.classification_year ?? null,
        },
        geometry: f.geometry,
      };
    });

  const dropped = raw.length - features.length - excluded.length;
  console.log(`\n  excluded as north/west-draining (${excluded.length}) — Bristol Channel / Celtic Sea, not this project's water:`);
  for (const e of excluded) console.log(`     – ${e.name}  [${e.why}]`);

  // Clip to the project box + light simplify, matching the marine layer. The
  // clip matters here: coastal water bodies are large and several run well past
  // the corridor at either end.
  console.log('\nClipping to project bbox & simplifying…');
  const [w, s, e, n] = SOUTH_COAST_BBOX;
  const commands =
    `-i in.geojson -simplify 8% keep-shapes ` +
    `-clip bbox=${w},${s},${e},${n} ` +
    `-o precision=0.0001 format=geojson out.geojson`;
  const result = await mapshaper.applyCommands(commands, {
    'in.geojson': JSON.stringify({ type: 'FeatureCollection', features }),
  });

  const out = result['out.geojson'];
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, out);

  const fc = JSON.parse(out);
  const kept = fc.features.filter((f) => f.geometry);
  const empty = fc.features.length - kept.length;

  // Report the real distribution, so the About copy stays factual.
  const tally = (key) => {
    const m = new Map();
    for (const f of kept) m.set(f.properties[key] ?? '—', (m.get(f.properties[key] ?? '—') ?? 0) + 1);
    return m;
  };
  const eco = tally('eco');
  const chem = tally('chem');
  const type = tally('wbtype');

  console.log(`\n  by type:`);
  for (const [k, v] of type) console.log(`     ${k}: ${v}`);
  console.log(`  ecological status:`);
  for (const k of [...ECO_ORDER, ...[...eco.keys()].filter((k) => !ECO_ORDER.includes(k))]) {
    if (eco.has(k)) console.log(`     ${k}: ${eco.get(k)}`);
  }
  console.log(`  chemical status:`);
  for (const [k, v] of chem) console.log(`     ${k}: ${v}`);
  if (dropped) console.log(`  ! ${dropped} record(s) had no geometry — dropped`);
  if (empty) console.log(`  ! ${empty} feature(s) simplified/clipped away to null geometry`);

  const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
  console.log(`\nWrote ${OUT} — ${kept.length} features, ${kb} KB.`);
}

main().catch((err) => {
  console.error('Failed to build WFD water body data:', err.message);
  process.exit(1);
});
