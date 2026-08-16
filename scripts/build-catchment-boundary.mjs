/**
 * Build the SOUTH COAST HYDROLOGICAL BOUNDARY — the real drainage area of the
 * South Coast Marine Recovery Project, following watersheds instead of a
 * straight-line box, and write it to public/data/catchment-boundary.geojson.
 *
 * Run with: npm run data:catchment
 *
 * WHY THIS EXISTS
 * ---------------
 * The storm overflow and water body layers were clipped to a rectangular bbox.
 * A rectangle is not a hydrological unit: it dragged in ~360 overflows and
 * several water bodies on the north Devon / Cornwall coast, which drain to the
 * BRISTOL CHANNEL and have nothing to do with this project, while the rule for
 * including an inland site was "is it close to the coast" rather than "does its
 * water end up on this coast". A site near Salisbury on the Hampshire Avon is
 * 40 km inland and unambiguously part of the story; a site at Bideford is on the
 * coast and unambiguously isn't.
 *
 * WHAT IS AND ISN'T IN THE OPEN DATA
 * ----------------------------------
 * There is NO published field anywhere in the WFD open data that links a river
 * water body (or its catchment) to the transitional/coastal water body it
 * drains into. Checked and ruled out:
 *   • WFD River Water Body Catchments Cycle 4 — carries the catchment hierarchy
 *     (rbd_id / mancat_id / opcat_id / caba_catchment_id) but no downstream or
 *     receiving-water-body reference.
 *   • WFD Transitional and Coastal Water Bodies Cycle 4 — its
 *     `management_catchment_alt` / `operational_catchment_alt` fields are just
 *     duplicates of the primary ones, not the river-side catchment.
 *   • Every TraC body sits in a *pseudo* management catchment ("South West TraC",
 *     "South East TraC") that pools the whole river basin district, so the
 *     management catchment cannot connect an estuary to its rivers.
 *   • There are no catchment polygons keyed to TraC water body ids, and no
 *     separate TraC-catchment dataset.
 *   • The Catchment Data Explorer serves HTML only — no JSON/RDF hierarchy.
 *
 * So the link is DERIVED GEOMETRICALLY, which is what the catchment polygons are
 * for. Operational catchments are the right unit: unlike management catchments
 * they never straddle two coasts. ("North Cornwall Seaton Looe and Fowey" is one
 * management catchment holding both the Camel, which drains north to the Celtic
 * Sea, and the Fowey, which drains south — so working at management-catchment
 * level would be forced to get one of them wrong.)
 *
 * THE METHOD
 * ----------
 *  1. Take every transitional/coastal water body on this coast and split it into
 *     the project's own sea (the English Channel) and the Bristol Channel /
 *     Celtic Sea, using the explicit list of north-and-west-draining operational
 *     catchments below — the EA's own units, named and reasoned one by one.
 *  2. Dissolve the WFD river water body catchments into operational catchments.
 *  3. An operational catchment is COASTAL if its boundary comes within
 *     CONTACT_KM of a TraC water body — that contact is the river mouth. It is
 *     IN if the body it meets is one of the project's, OUT if it is a Bristol
 *     Channel one.
 *  4. An operational catchment that reaches no coast at all is INLAND; it drains
 *     through its neighbours, so it inherits the verdict of its management
 *     catchment (which is unambiguous once every coastal catchment in that
 *     management catchment agrees). Any that don't agree are reported, never
 *     guessed.
 *  5. Union every IN catchment, plus the project's own TraC water bodies so that
 *     outfalls sitting on the shoreline or just offshore fall inside.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import mapshaper from 'mapshaper';
import { SOUTH_COAST_BBOX } from './lib/southcoast.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, '../public/data/catchment-boundary.geojson');

const TRAC =
  'https://services3.arcgis.com/Bb8lfThdhugyc4G3/arcgis/rest/services/' +
  'WFD_Transitional_and_Coastal_Water_Bodies_Cycle_4_Classification_2025/FeatureServer/0';
const RIVER_CATCHMENTS =
  'https://services3.arcgis.com/Bb8lfThdhugyc4G3/arcgis/rest/services/' +
  'Simplified_WFD_River_Water_Body_Catchments_Cycle_4_Classification_2025/FeatureServer/0';
// The EA's own management catchment polygons. Cycle 3 vintage — the only open
// version — but management catchment boundaries are watersheds and do not move
// between cycles; they are used here purely as a complete tiling of the land.
const MANAGEMENT_CATCHMENTS =
  'https://services1.arcgis.com/JZM7qJpmv7vJ0Hzx/arcgis/rest/services/Man_Cats_SW_C3/FeatureServer/0';

// A generous working region — wider and taller than the project bbox, because a
// catchment that drains to this coast may rise well outside it (the Hampshire
// Avon rises near Devizes) and because the north-coast catchments must be
// fetched too in order to be excluded on the evidence rather than by omission.
const REGION = [-6.6, 49.5, 1.2, 52.0];

// How close a catchment boundary must come to a TraC water body to count as
// draining into it. Catchment polygons stop at the tidal limit and the TraC
// polygons start there, so true neighbours nearly touch; 1 km absorbs the
// simplification slack in both datasets without reaching across a headland.
const CONTACT_KM = 1.0;

// How far inland a north/west-draining water body carries its own coastal fringe
// when that fringe is trimmed off. Comfortably less than the width of the
// peninsula, so trimming the north coast never reaches the south.
const FRINGE_KM = 2.5;

// Vertex retention for the final boundary. See the note where it is used.
const SIMPLIFY = process.env.SIMPLIFY || '60%';

// A final outward nudge, so an outfall sitting on the shoreline — or below mean
// high water, as many do — is not lost in the sliver between the land polygon
// and the sea polygon. Far too small to reach a neighbouring catchment.
const SEAWARD_KM = process.env.SEAWARD_KM || '0.4';

/**
 * The transitional/coastal water bodies that drain to the BRISTOL CHANNEL or the
 * CELTIC SEA rather than the English Channel — listed by the EA's own
 * operational catchment id, with the reason, so the call is reviewable.
 *
 * These are the north and west coasts of the South West peninsula. Note the
 * Cornish ones: at Hayle or the Gannel the north and south coasts are barely
 * 10 km apart, so nothing based on latitude or distance-from-corridor can
 * separate them — only which way the water actually goes.
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

const PAGE = 1000;

async function fetchAll(url, params) {
  const features = [];
  for (let offset = 0; ; offset += PAGE) {
    const qs = new URLSearchParams({
      ...params,
      outSR: '4326',
      returnGeometry: 'true',
      resultOffset: String(offset),
      resultRecordCount: String(PAGE),
      f: 'geojson',
    });
    const res = await fetch(`${url}/query?${qs}`);
    if (!res.ok) throw new Error(`query failed: ${res.status} ${res.statusText}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error.message);
    const batch = json.features ?? [];
    features.push(...batch);
    process.stdout.write(`\r    fetched ${features.length}…`);
    if (batch.length < PAGE) break;
  }
  process.stdout.write('\n');
  return features;
}

// ---- geometry helpers (dependency-free) ----

const KM_PER_DEG_LAT = 110.574;
const kmPerDegLon = (lat) => 111.32 * Math.cos((lat * Math.PI) / 180);

/** Every coordinate pair in a geometry, flattened. */
function* coords(geometry) {
  const walk = function* (c) {
    if (typeof c[0] === 'number') yield c;
    else for (const x of c) yield* walk(x);
  };
  if (geometry?.coordinates) yield* walk(geometry.coordinates);
}

function bbox(geometry) {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  for (const [x, y] of coords(geometry)) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

/**
 * A coarse grid index over a set of vertices, so "is anything within CONTACT_KM
 * of this point" is a handful of cell lookups instead of a scan over ~10^5
 * vertices. Cell size is the contact distance, so only the 3×3 neighbourhood
 * ever needs checking.
 */
function buildVertexIndex(items, cellDeg) {
  const cells = new Map();
  for (const { key, geometry } of items) {
    for (const [x, y] of coords(geometry)) {
      const cx = Math.floor(x / cellDeg);
      const cy = Math.floor(y / cellDeg);
      const id = `${cx}:${cy}`;
      let bucket = cells.get(id);
      if (!bucket) cells.set(id, (bucket = []));
      bucket.push([x, y, key]);
    }
  }
  return { cells, cellDeg };
}

/** Keys whose vertices lie within `km` of any vertex of `geometry`, with counts. */
function neighboursWithin({ cells, cellDeg }, geometry, km) {
  const hits = new Map();
  for (const [x, y] of coords(geometry)) {
    const cx = Math.floor(x / cellDeg);
    const cy = Math.floor(y / cellDeg);
    const kmLon = kmPerDegLon(y);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const bucket = cells.get(`${cx + i}:${cy + j}`);
        if (!bucket) continue;
        for (const [bx, by, key] of bucket) {
          const dx = (bx - x) * kmLon;
          const dy = (by - y) * KM_PER_DEG_LAT;
          if (dx * dx + dy * dy <= km * km) hits.set(key, (hits.get(key) ?? 0) + 1);
        }
      }
    }
  }
  return hits;
}

/** Dissolve a FeatureCollection on a field, via mapshaper. */
async function dissolveOn(features, field) {
  const cmd = `-i in.geojson -dissolve ${field} copy-fields=${field} -o out.geojson`;
  const out = await mapshaper.applyCommands(cmd, {
    'in.geojson': JSON.stringify({ type: 'FeatureCollection', features }),
  });
  return JSON.parse(out['out.geojson']).features.filter((f) => f.geometry);
}

async function main() {
  console.log('Building the South Coast hydrological (catchment) boundary…');
  console.log(`  working region [W,S,E,N] = ${REGION.join(', ')}`);

  // ---- 1. Transitional & coastal water bodies, split by the sea they drain to.
  console.log('\n  Transitional & coastal water bodies:');
  const trac = await fetchAll(TRAC, {
    where: "country='England'",
    geometry: REGION.join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'water_body_id,water_body_name,opcat_id,operational_catchment',
    geometryPrecision: '5',
  });

  // The PROJECT's waters are exactly the ones Layer C maps: the transitional and
  // coastal bodies meeting the project corridor, less the north/west-draining
  // ones above. Everything else in the working region — the Severn Estuary, the
  // Bristol Channel, the Thames and Kent bodies beyond the corridor — is the
  // "not ours" set, and a catchment that drains into any of THEM is excluded.
  // Anchoring on the mapped set rather than on a rule over the whole region is
  // what keeps this non-circular: Layer C's own contents define the target.
  const [bw, bs, be, bn] = SOUTH_COAST_BBOX;
  const inCorridor = (f) => {
    const [x0, y0, x1, y1] = bbox(f.geometry);
    return x1 >= bw && x0 <= be && y1 >= bs && y0 <= bn;
  };

  const project = [];
  const bristol = [];
  const elsewhere = [];
  for (const f of trac) {
    if (!f.geometry) continue;
    if (NORTH_DRAINING_OPCATS.has(f.properties.opcat_id)) bristol.push(f);
    else if (inCorridor(f)) project.push(f);
    else elsewhere.push(f);
  }
  // Both non-project groups act identically as "drains somewhere else".
  const notOurs = [...bristol, ...elsewhere];
  console.log(`    ${trac.length} water bodies → ${project.length} project, ${bristol.length} Bristol Channel / Celtic Sea, ${elsewhere.length} other seas outside the corridor`);
  console.log('    excluded as north/west-draining (were in the old bbox result):');
  for (const f of bristol) {
    console.log(`      – ${f.properties.water_body_name}  [${NORTH_DRAINING_OPCATS.get(f.properties.opcat_id)}]`);
  }

  // ---- 2. River water body catchments → operational catchments.
  console.log('\n  River water body catchments:');
  const rivers = await fetchAll(RIVER_CATCHMENTS, {
    where: "country='England'",
    geometry: REGION.join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'water_body_id,opcat_id,operational_catchment,mancat_id,management_catchment',
    geometryPrecision: '5',
  });
  const withGeom = rivers.filter((f) => f.geometry);
  console.log(`    ${withGeom.length} river catchments`);

  const meta = new Map(); // opcat_id → { name, mancatId, mancat }
  for (const f of withGeom) {
    const p = f.properties;
    if (!meta.has(p.opcat_id)) {
      meta.set(p.opcat_id, { name: p.operational_catchment, mancatId: p.mancat_id, mancat: p.management_catchment });
    }
  }
  console.log(`    dissolving into ${meta.size} operational catchments…`);
  const opcats = await dissolveOn(withGeom, 'opcat_id');
  console.log(`    ${opcats.length} operational catchment polygons`);

  // ---- 3. Which coast does each operational catchment reach?
  const cell = CONTACT_KM / 111; // degrees ≈ contact distance
  const projectIdx = buildVertexIndex(project.map((f) => ({ key: f.properties.water_body_name, geometry: f.geometry })), cell);
  const bristolIdx = buildVertexIndex(notOurs.map((f) => ({ key: f.properties.water_body_name, geometry: f.geometry })), cell);

  const verdicts = new Map(); // opcat_id → 'in' | 'out' | 'inland'
  const contacts = new Map(); // opcat_id → { project: [...], bristol: [...] }
  for (const f of opcats) {
    const id = f.properties.opcat_id;
    const hitP = neighboursWithin(projectIdx, f.geometry, CONTACT_KM);
    const hitB = neighboursWithin(bristolIdx, f.geometry, CONTACT_KM);
    contacts.set(id, { project: [...hitP.entries()], bristol: [...hitB.entries()] });
    if (hitP.size && !hitB.size) verdicts.set(id, 'in');
    else if (hitB.size && !hitP.size) verdicts.set(id, 'out');
    else if (!hitP.size && !hitB.size) verdicts.set(id, 'inland');
    else {
      // Touches both seas — decide on the weight of contact, and always report.
      const wP = [...hitP.values()].reduce((a, b) => a + b, 0);
      const wB = [...hitB.values()].reduce((a, b) => a + b, 0);
      verdicts.set(id, wP >= wB ? 'in' : 'out');
      contacts.get(id).contested = { wP, wB, project: [...hitP.keys()], other: [...hitB.keys()] };
    }
  }

  // ---- 4. Inland catchments inherit their management catchment's verdict.
  const byMancat = new Map();
  for (const [id, v] of verdicts) {
    const m = meta.get(id).mancatId;
    if (!byMancat.has(m)) byMancat.set(m, { in: 0, out: 0, inland: [] });
    const rec = byMancat.get(m);
    if (v === 'in') rec.in++;
    else if (v === 'out') rec.out++;
    else rec.inland.push(id);
  }

  const unresolved = [];
  for (const [mancatId, rec] of byMancat) {
    for (const id of rec.inland) {
      if (rec.in > 0 && rec.out === 0) verdicts.set(id, 'in');
      else if (rec.out > 0 && rec.in === 0) verdicts.set(id, 'out');
      else if (rec.in === 0 && rec.out === 0) {
        // A management catchment entirely inland within our region — it drains
        // to a coast outside the working area (Thames, Severn). Not ours.
        verdicts.set(id, 'out');
      } else {
        // Mixed management catchment with an inland member: cannot be settled
        // from containment alone. Fall back to the nearest classified
        // neighbour, and report it.
        verdicts.set(id, 'out');
        unresolved.push({ id, ...meta.get(id), mancatId, mixed: rec });
      }
    }
  }

  const inIds = [...verdicts].filter(([, v]) => v === 'in').map(([id]) => id);
  console.log(`\n  verdicts: ${inIds.length} in, ${[...verdicts.values()].filter((v) => v === 'out').length} out`);

  const contested = [...contacts].filter(([, c]) => c.contested);
  if (contested.length) {
    console.log('\n  ! operational catchments touching BOTH seas (decided on contact weight):');
    for (const [id, c] of contested) {
      console.log(`      ${id} ${meta.get(id).name}: ${c.contested.wP} project vs ${c.contested.wB} other → ${verdicts.get(id)}`);
      console.log(`          project waters: ${c.contested.project.join(', ')}`);
      console.log(`          other waters:   ${c.contested.other.join(', ')}`);
    }
  }
  if (unresolved.length) {
    console.log('\n  ! inland catchments in a management catchment that drains BOTH ways — excluded, needs review:');
    for (const u of unresolved) console.log(`      ${u.id} ${u.name} (in ${u.mancat})`);
  }

  // ---- 5. Turn the per-catchment verdicts into an area.
  //
  // The river water body catchments do NOT tile the land: a coastal town with no
  // river of its own — Brighton, Penzance — drains straight to sea and has no
  // river catchment polygon, so a union of them alone leaves holes exactly where
  // the coastal storm overflows are. The EA's MANAGEMENT CATCHMENT polygons do
  // tile completely, so they provide the area while the operational catchment
  // verdicts above provide the hydrology:
  //   • every operational catchment in a management catchment agrees → take the
  //     whole management catchment polygon, coastal strips included;
  //   • they disagree (a management catchment spanning both coasts) → take the
  //     management catchment polygon MINUS the river catchments of the excluded
  //     operational catchments, which is what carves the Camel, Gannel and Hayle
  //     out of Cornwall while keeping Penzance and the Fowey.
  console.log('\n  Management catchment polygons (these tile the land; river catchments do not):');
  const mancats = await fetchAll(MANAGEMENT_CATCHMENTS, {
    where: '1=1',
    geometry: REGION.join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'MANAGEMENT_CATCHMENT_ID,MANAGEMENT_CATCHMENT',
    geometryPrecision: '5',
  });
  console.log(`    ${mancats.length} management catchments`);

  const tally = new Map(); // mancatId (string) → { in: [], out: [] }
  for (const [id, v] of verdicts) {
    const m = String(meta.get(id).mancatId);
    if (!tally.has(m)) tally.set(m, { in: [], out: [] });
    if (v === 'in') tally.get(m).in.push(id);
    else tally.get(m).out.push(id);
  }

  const pieces = [];
  const whole = [];
  const carved = [];
  for (const mc of mancats) {
    if (!mc.geometry) continue;
    const id = String(mc.properties.MANAGEMENT_CATCHMENT_ID);
    const name = mc.properties.MANAGEMENT_CATCHMENT;
    const rec = tally.get(id);
    if (!rec || !rec.in.length) continue; // nothing here drains to this coast
    if (!rec.out.length) {
      whole.push(name);
      pieces.push({ type: 'Feature', properties: { part: 'catchment' }, geometry: mc.geometry });
      continue;
    }
    // Mixed: erase the excluded operational catchments from the management one.
    const drop = opcats.filter((f) => rec.out.includes(f.properties.opcat_id) && f.geometry);
    const res = await mapshaper.applyCommands(
      '-i keep.geojson -erase drop.geojson -o precision=0.00001 format=geojson out.geojson',
      {
        'keep.geojson': JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: mc.geometry }] }),
        'drop.geojson': JSON.stringify({ type: 'FeatureCollection', features: drop.map((f) => ({ type: 'Feature', properties: {}, geometry: f.geometry })) }),
      },
    );
    const cut = JSON.parse(res['out.geojson']);
    const geoms = (cut.features ?? (cut.geometries ?? []).map((g) => ({ geometry: g }))).filter((f) => f.geometry);
    carved.push(`${name} — kept ${rec.in.length}, carved out ${rec.out.map((o) => meta.get(o).name).join(', ')}`);
    for (const g of geoms) pieces.push({ type: 'Feature', properties: { part: 'catchment' }, geometry: g.geometry });
  }
  // The coastal FRINGE problem. River catchments stop short of the shore, so the
  // strip of coastal town between the lowest catchment and the sea belongs to no
  // river catchment at all — which is why the management catchment polygons are
  // needed to cover Brighton and Penzance. But in a management catchment that
  // spans two coasts, that same fringe hands back the north-coast towns the
  // carve was meant to remove: Padstow, Newquay and Hayle all sit seaward of the
  // Camel, Gannel and Hayle river catchments.
  //
  // So the north-draining waters take their own fringe with them: erase the land
  // within FRINGE_KM of a Bristol Channel / Celtic Sea water body. That distance
  // is well under the width of the peninsula, so it never reaches the south side.
  console.log('\n  Trimming the north-coast fringe…');
  const landRes = await mapshaper.applyCommands(
    '-i land.geojson -dissolve2 -o precision=0.00001 format=geojson land-out.geojson',
    { 'land.geojson': JSON.stringify({ type: 'FeatureCollection', features: pieces }) },
  );
  const trimRes = await mapshaper.applyCommands(
    `-i land-out.geojson -erase source=north.geojson -o precision=0.00001 format=geojson trim.geojson`,
    {
      'land-out.geojson': landRes['land-out.geojson'],
      'north.geojson': (
        await mapshaper.applyCommands(`-i north-raw.geojson -buffer ${FRINGE_KM}km -o format=geojson north.geojson`, {
          'north-raw.geojson': JSON.stringify({
            type: 'FeatureCollection',
            features: bristol.map((f) => ({ type: 'Feature', properties: {}, geometry: f.geometry })),
          }),
        })
      )['north.geojson'],
    },
  );
  const asFeatures = (txt) => {
    const p = JSON.parse(txt);
    return (p.features ?? (p.geometries ?? []).map((g) => ({ type: 'Feature', properties: {}, geometry: g }))).filter((f) => f.geometry);
  };
  pieces.length = 0;
  for (const f of asFeatures(trimRes['trim.geojson'])) {
    pieces.push({ type: 'Feature', properties: { part: 'catchment' }, geometry: f.geometry });
  }
  // The project's own waters go back on top, after the trim, so a coastal outfall
  // sitting on the shoreline or just offshore still falls inside.
  for (const f of project) pieces.push({ type: 'Feature', properties: { part: 'water' }, geometry: f.geometry });

  console.log(`\n    whole management catchments included (${whole.length}):`);
  for (const n of whole.sort()) console.log(`      • ${n}`);
  console.log(`    management catchments spanning two coasts, carved (${carved.length}):`);
  for (const n of carved) console.log(`      • ${n}`);

  console.log('\n  Unioning…');
  const keep = opcats.filter((f) => verdicts.get(f.properties.opcat_id) === 'in');
  // Simplification is deliberately LIGHT. This boundary is not decoration — it
  // is the test that decides whether a storm overflow is on the map, so pulling
  // the coastline in by even a few hundred metres silently drops the coastal
  // outfalls, which are exactly the ones that discharge straight to the sea.
  // (At 12% it lost Torquay, Newton Abbot and the Otter.) The inputs are already
  // the EA's "Simplified_" datasets, so there is little left to gain anyway.
  //
  // Order matters here. Simplify the LAND first, then union the project's waters
  // at full precision, then push the whole thing out by SEAWARD_KM. A storm
  // overflow's outfall sits at the shoreline BY DESIGN — many discharge below
  // mean high water, into a harbour or straight to sea — so they fall in the
  // sliver between the land polygon and the sea polygon, and any erosion of
  // either edge loses them. Simplifying the waters alongside the land lost
  // Brighton's seafront, Portsmouth Harbour, Cowes and the Hamble. The final
  // outward nudge closes what is left; at a few hundred metres it cannot reach
  // another catchment, whose land is kilometres away across the trimmed fringe.
  const landCmd = `-i in.geojson -dissolve2 -simplify ${SIMPLIFY} keep-shapes -o precision=0.00001 format=geojson land.geojson`;
  const landOnly = await mapshaper.applyCommands(landCmd, {
    'in.geojson': JSON.stringify({ type: 'FeatureCollection', features: pieces.filter((f) => f.properties.part === 'catchment') }),
  });
  const waters = JSON.stringify({
    type: 'FeatureCollection',
    features: pieces.filter((f) => f.properties.part === 'water'),
  });
  const res = await mapshaper.applyCommands(
    `-i land.geojson waters.geojson combine-files -merge-layers force -dissolve2 -buffer ${SEAWARD_KM}km ` +
      `-o precision=0.00001 format=geojson out.geojson`,
    { 'land.geojson': landOnly['land.geojson'], 'waters.geojson': waters },
  );
  const out = res['out.geojson'];
  if (!out) throw new Error('the union step produced no output');
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, out);

  // mapshaper emits a bare GeometryCollection when a dissolve leaves no
  // attributes behind, so accept either shape.
  const parsed = JSON.parse(out);
  const solid = (parsed.features ?? (parsed.geometries ?? []).map((g) => ({ type: 'Feature', properties: {}, geometry: g })))
    .filter((f) => f.geometry);
  if (!solid.length) throw new Error('the union produced no polygons');
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90, ring = 0;
  for (const f of solid) {
    const [a, b, c, d] = bbox(f.geometry);
    x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, d);
    for (const _ of coords(f.geometry)) ring++;
  }

  console.log(`\n  included operational catchments (${keep.length}):`);
  const names = keep
    .map((f) => `${meta.get(f.properties.opcat_id).name} (${meta.get(f.properties.opcat_id).mancat})`)
    .sort();
  for (const n of names) console.log(`     • ${n}`);

  const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
  console.log(`\nWrote ${OUT} — ${solid.length} polygon(s), ${ring} vertices, ${kb} KB.`);
  console.log(`Extent: W ${x0.toFixed(3)}  S ${y0.toFixed(3)}  E ${x1.toFixed(3)}  N ${y1.toFixed(3)}`);
}

main().catch((err) => {
  console.error('Failed to build the catchment boundary:', err.message);
  process.exit(1);
});
