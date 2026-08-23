/**
 * Fetch the ENVIRONMENT AGENCY's DESIGNATED BATHING WATERS for the project
 * corridor and bundle at public/data/bathing-waters.geojson.
 *
 * Run with: npm run data:bathing
 *
 * The full reasoning — what this layer may and may not claim — is in
 * docs/bathing-water-investigation.md. The short version, because it governs
 * everything below:
 *
 *   • GEOMETRY IS A SAMPLING POINT AND NOTHING ELSE. The registry emits
 *     `zoneOfInfluence` and `envelope` URIs on location.data.gov.uk; every one
 *     of them 403s. The "Areas Affecting Bathing Waters" polygon set does
 *     download cleanly and would render beautifully, and EA's own metadata says
 *     it "should not be used for any definition of the bathing water area or
 *     extent". So: points, deliberately.
 *
 *   • A 2025 CLASSIFICATION IS A 2022–2025 AGGREGATE. It is calculated annually
 *     from the previous four years of samples, so it is not a statement about
 *     the water this year, and the card says so in words.
 *
 *   • ONLY 2015–2025 IS COMPARABLE. The monitoring-locations layer also carries
 *     comp_1988…comp_2014 under the old directive (Fail / Imperative /
 *     Guideline). Different instrument, different pass mark. Those columns are
 *     read for nothing and never written out.
 *
 *   • 2020 IS A HOLE. There was no bathing season monitoring programme; EA
 *     records it as `un-assessed` and it is carried through as exactly that,
 *     never as null and never interpolated across.
 *
 * TWO SOURCES, CROSS-CHECKED. The registry and the monitoring-locations layer
 * are independent EA services and they agree on the corridor roster and on every
 * 2025 classification. That agreement is a large part of why this layer cleared
 * the bar, so it is asserted on every run rather than assumed: a disagreement
 * fails the build.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadBoundary, SOUTH_COAST_BBOX, BEACHY_HEAD_LON } from './lib/southcoast.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, '../public/data/bathing-waters.geojson');
// The EDM annual return, already fetched and clipped to this corridor by
// scripts/fetch-storm-overflows.mjs. The join below reads the committed file
// rather than re-querying EA, so the two layers can never disagree about which
// overflows exist.
const OVERFLOWS = resolve(__dir, '../public/data/storm-overflows.geojson');

/** The registry: one record per ACTIVE designated bathing water in England. */
const REGISTRY = 'https://environment.data.gov.uk/doc/bathing-water.json?_pageSize=1000';

/**
 * The monitoring-locations layer: the same sites PLUS de-designated ones, and
 * the only place the per-year classification series is published.
 *
 * Note the path. There is no bathing-water WFS — `…/spatialdata/bathing-waters/wfs`
 * and the obvious variants all 404 — and the pre-2015 `compliance/point/{id}`
 * linked-data endpoint returns HTTP 200 with an EMPTY item list rather than an
 * error. Both are recorded in the investigation; neither is used here.
 */
const MONITORING =
  'https://environment.data.gov.uk/spatialdata/bathing-waters-monitoring-locations/ogc/features/v1' +
  '/collections/Bathing_Waters_Monitoring_Locations/items?f=application/json&limit=1000';

/** Classification years the current (2015 rBWD) scheme covers. */
const FIRST_YEAR = 2015;
const LAST_YEAR = 2025;
/** A classification aggregates this many bathing seasons, ending in its own year. */
const AGGREGATE_YEARS = 4;

/** Series codes, written as one character per year into `hist`. */
const CODE = {
  Excellent: 'E',
  Good: 'G',
  Sufficient: 'S',
  Poor: 'P',
  'un-assessed': 'U',
  Closed: 'C',
};
const NOT_DESIGNATED = '-';

/**
 * THE EDM ALIAS TABLE — four entries, and the build fails if a fifth is needed.
 *
 * The EDM annual return names its bathing waters in FREE TEXT, semicolon-
 * delimited, with no `eubwid` or `bw_ref` anywhere in its schema. EA's own
 * services do not agree on the strings: the EDM return uses an older naming
 * convention for the three Hayling Island beaches and for Dartmouth, and the
 * polygon dataset (unused here) carries a third set again.
 *
 * This is string matching, and string matching drifts. It is therefore asserted
 * rather than trusted — see resolveOverflowNames(): any EDM name that fails to
 * resolve after these four are applied stops the build with the names printed,
 * because a silently dropped link would show as "no overflow requires monitoring
 * because of this beach", which is a claim about the sewer network.
 */
const EDM_NAME_ALIASES = new Map([
  ['Beachlands West', 'Hayling Beachlands West'],
  ['Beachlands Central', 'Hayling Beachlands Central'],
  ['Eastoke', 'Hayling Eastoke'],
  ['Dartmouth Castle and Sugary Cove', 'Dartmouth Castle Cove'],
]);

/** Water companies publish their legal name; the card wants the trading one. */
const shortenUndertaker = (s) =>
  !s ? null : s.replace(/\s+Services\s+Limited$/i, '').replace(/\s+Limited$/i, '').trim();

/** Registry values arrive as {_value}, {name:{_value}} or a bare string. */
function val(x) {
  if (x == null) return null;
  if (typeof x === 'string') return x;
  if (Array.isArray(x)) return val(x.find((v) => v && typeof v === 'object')) ?? null;
  if (typeof x === 'object') {
    if ('_value' in x) return x._value;
    if ('name' in x) return val(x.name);
    if ('label' in x) return val(x.label);
  }
  return null;
}

/** Trim and collapse internal whitespace. Deliberately NOT case- or
 *  punctuation-folding: a fold would quietly paper over exactly the naming
 *  drift the alias assertion exists to surface. */
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.json();
}

/** The 5-digit sampling point id is the only key shared by the two services:
 *  registry `ukj2407-15350` and monitoring `UK15350` both carry `15350`. */
const spidFromEubwid = (s) => String(s || '').split('-').pop();
const spidFromBwRef = (s) => String(s || '').replace(/^UK/i, '');

async function main() {
  console.log('Bathing waters — Environment Agency, England\n');

  const boundary = await loadBoundary();

  // ---------------------------------------------------------------- registry
  const reg = await getJson(REGISTRY);
  const regItems = reg?.result?.items ?? [];
  if (!regItems.length) throw new Error('registry returned no items');
  console.log(`  registry: ${regItems.length} active designated bathing waters (England)`);

  const sites = [];
  let noPoint = 0;
  for (const it of regItems) {
    const sp = it.samplingPoint;
    if (!sp || typeof sp.lat !== 'number' || typeof sp.long !== 'number') {
      noPoint++;
      continue;
    }
    const types = (it.type ?? []).map((t) => String(t).split('/').pop());
    const kind = types.includes('CoastalBathingWater')
      ? 'coastal'
      : types.includes('TransitionalBathingWater')
        ? 'transitional'
        : types.includes('RiverBathingWater')
          ? 'river'
          : types.includes('LakeBathingWater')
            ? 'lake'
            : 'other';
    const lca = it.latestComplianceAssessment;
    sites.push({
      id: val(it._about) || null,
      eubwid: it.eubwidNotation,
      spid: spidFromEubwid(it.eubwidNotation),
      name: norm(val(it.name)),
      lon: sp.long,
      lat: sp.lat,
      kind,
      district: val(it.district),
      undertaker: shortenUndertaker(val(it.appointedSewerageUndertaker)),
      rain: it.waterQualityImpactedByHeavyRain === true,
      cls: lca && typeof lca === 'object' ? val(lca.complianceClassification) : null,
      clsYear: lca && typeof lca === 'object' ? Number(String(lca._about).split('/year/').pop()) : null,
    });
  }
  if (noPoint) console.log(`  ! ${noPoint} registry record(s) had no sampling point — dropped`);

  // ------------------------------------------------- the three filters, in order
  const inBox = sites.filter(
    (s) =>
      s.lon >= SOUTH_COAST_BBOX[0] &&
      s.lon <= SOUTH_COAST_BBOX[2] &&
      s.lat >= SOUTH_COAST_BBOX[1] &&
      s.lat <= SOUTH_COAST_BBOX[3],
  );
  const westOfCutoff = inBox.filter((s) => s.lon < BEACHY_HEAD_LON);
  const cutByHeadland = inBox.filter((s) => s.lon >= BEACHY_HEAD_LON);
  const inCatchment = westOfCutoff.filter((s) => boundary.contains([s.lon, s.lat]));
  const cutByCatchment = westOfCutoff.filter((s) => !boundary.contains([s.lon, s.lat]));

  console.log('\n  filters, in the documented order:');
  console.log(`     ${sites.length.toString().padStart(4)}  England, active, with a sampling point`);
  console.log(`     ${inBox.length.toString().padStart(4)}  inside the fetch bbox [${SOUTH_COAST_BBOX.join(', ')}]`);
  console.log(`     ${westOfCutoff.length.toString().padStart(4)}  and west of the Beachy Head cutoff (${BEACHY_HEAD_LON}°E)`);
  console.log(`     ${inCatchment.length.toString().padStart(4)}  and inside the catchment boundary  ← kept`);

  console.log(`\n  ${cutByHeadland.length} cut by the headland (in the box, east of ${BEACHY_HEAD_LON}°E):`);
  for (const s of [...cutByHeadland].sort((a, b) => a.lon - b.lon)) {
    console.log(`     − ${s.name} (${s.lon.toFixed(3)}°E)`);
  }
  console.log(`\n  ${cutByCatchment.length} cut by the catchment boundary — the bbox reaches round the corner into`);
  console.log('    north Cornwall, north Devon and the Bristol Channel, the same over-coverage');
  console.log('    the vessel density and marine licensing layers hit. Westmost/eastmost cut:');
  const cutSorted = [...cutByCatchment].sort((a, b) => a.lon - b.lon);
  for (const s of [cutSorted[0], cutSorted[cutSorted.length - 1]].filter(Boolean)) {
    console.log(`     − ${s.name} (${s.district}, ${s.lon.toFixed(3)}°E)`);
  }

  // ------------------------------------------------------- monitoring locations
  const mon = await getJson(MONITORING);
  const monFeats = mon.features ?? [];
  if (mon.numberMatched != null && mon.numberReturned !== mon.numberMatched) {
    throw new Error(`monitoring layer truncated: returned ${mon.numberReturned} of ${mon.numberMatched} — raise the limit`);
  }
  const byId = new Map();
  for (const f of monFeats) {
    const p = f.properties ?? {};
    byId.set(spidFromBwRef(p.bw_ref), { props: p, coords: f.geometry?.coordinates ?? null });
  }
  const active = monFeats.filter((f) => f.properties?.notes === 'Active').length;
  const dedes = monFeats.filter((f) => f.properties?.notes === 'De-designated').length;
  console.log(`\n  monitoring locations: ${monFeats.length} records — ${active} active, ${dedes} de-designated`);

  // DE-DESIGNATED SITES ARE EXCLUDED. They are not in the registry at all, so
  // they never enter the build; they are computed here only so the report can
  // name them. A de-designated site is one EA has stopped monitoring — its last
  // classification describes water nobody has sampled since, and drawing it
  // beside 193 current ones would read as current.
  const deInCorridor = monFeats
    .filter((f) => f.properties?.notes === 'De-designated')
    .map((f) => ({ p: f.properties, c: f.geometry?.coordinates ?? [] }))
    .filter(
      ({ c }) =>
        c.length === 2 &&
        c[0] >= SOUTH_COAST_BBOX[0] && c[0] <= SOUTH_COAST_BBOX[2] &&
        c[1] >= SOUTH_COAST_BBOX[1] && c[1] <= SOUTH_COAST_BBOX[3] &&
        c[0] < BEACHY_HEAD_LON &&
        boundary.contains(c),
    );
  console.log(`\n  ${deInCorridor.length} de-designated site(s) fall inside the corridor and are EXCLUDED —`);
  console.log('    EA stopped monitoring them, so their last classification describes water');
  console.log('    nobody has sampled since; beside 193 current sites it would read as current:');
  for (const { p } of deInCorridor) {
    console.log(`     − ${p.bw_name} (designated ${p.des_yr}, de-designated ${p.de_des_yr})`);
  }

  // ------------------------------------------------ merge, and cross-check the two
  const years = [];
  for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) years.push(y);

  const disagreements = [];
  const missingMon = [];
  for (const s of inCatchment) {
    const m = byId.get(s.spid);
    if (!m) {
      missingMon.push(s);
      continue;
    }
    const p = m.props;
    // THE CROSS-CHECK. Two independent EA services, same site, same year.
    const monCls = p[`class_${LAST_YEAR}`] ?? null;
    const regCls = s.cls ?? null;
    if (norm(monCls) !== norm(regCls)) disagreements.push({ s, regCls, monCls });

    s.hist = years
      .map((y) => {
        const v = p[`class_${y}`];
        if (v == null || v === '') return NOT_DESIGNATED;
        const code = CODE[v];
        if (!code) throw new Error(`unknown classification value "${v}" at ${s.name} ${y}`);
        return code;
      })
      .join('');
    s.desYr = p.des_yr ?? null;
    s.monType = p.bw_type ?? null;
  }
  if (missingMon.length) {
    throw new Error(
      `${missingMon.length} corridor site(s) have no monitoring-locations record: ` +
        missingMon.map((s) => `${s.name} (${s.spid})`).join(', '),
    );
  }
  if (disagreements.length) {
    console.error(`\n  the two EA services DISAGREE on ${LAST_YEAR} classification for ${disagreements.length} site(s):`);
    for (const d of disagreements) {
      console.error(`     ${d.s.name}: registry says "${d.regCls}", monitoring locations say "${d.monCls}"`);
    }
    throw new Error('registry and monitoring-locations classifications disagree — resolve before building');
  }
  console.log(`\n  cross-check: registry and monitoring locations agree on all ${inCatchment.length} ${LAST_YEAR} classifications.`);

  // --------------------------------------------------------------- the EDM join
  const ovf = JSON.parse(await readFile(OVERFLOWS, 'utf8'));
  const edmYears = new Set((ovf.features ?? []).map((f) => f.properties?.year).filter(Boolean));
  if (edmYears.size !== 1) throw new Error(`expected one EDM annual return year, found: ${[...edmYears].join(', ')}`);
  const edmYear = Number([...edmYears][0]);
  const linked = resolveOverflowNames(ovf.features ?? [], sites, byId);
  for (const s of inCatchment) {
    s.ovf = linked.get(s.name) ?? [];
  }

  // ------------------------------------------------------------------- write out
  const features = inCatchment
    .sort((a, b) => a.lon - b.lon)
    .map((s) => ({
      type: 'Feature',
      properties: {
        id: s.eubwid,
        name: s.name,
        kind: s.kind,
        district: s.district,
        undertaker: s.undertaker,
        rain: s.rain,
        desYr: s.desYr,
        // The current classification, and the window it actually aggregates.
        cls: s.cls, // null = never classified (newly designated)
        clsYear: s.clsYear,
        clsFrom: s.clsYear ? s.clsYear - (AGGREGATE_YEARS - 1) : null,
        // One character per year, FIRST_YEAR…LAST_YEAR. E G S P U(n-assessed)
        // C(losed) or '-' (not designated that year). 2020 is 'U' for every site
        // that existed: a hole, carried as a hole.
        hist: s.hist,
        histFrom: FIRST_YEAR,
        // Storm overflows whose EDM permit condition names this bathing water.
        // NOT overflows that affect it — see the card copy and the About text.
        ovf: s.ovf.map((o) => ({ n: o.name, s: o.spills, h: o.hours })),
        // The EDM annual return year those spill figures come from, carried so
        // the card never hard-codes a year that will drift at the next return.
        ovfYear: edmYear,
      },
      geometry: {
        type: 'Point',
        coordinates: [Math.round(s.lon * 1e5) / 1e5, Math.round(s.lat * 1e5) / 1e5],
      },
    }));

  const out = JSON.stringify({ type: 'FeatureCollection', features });
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, out);

  report(features, ovf.features ?? []);

  const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
  console.log(`\nWrote ${OUT} — ${features.length} features, ${kb} KB.`);
}

/**
 * Resolve every EDM `bathing_water` name to a bathing water, or fail.
 *
 * Returns Map<bathingWaterName, overflow[]>. Names are resolved against EVERY
 * England bathing water (active and de-designated), not just the corridor —
 * an overflow inside the corridor can legitimately name a beach outside it
 * (Bexhill, east of the headland), and that is a real link, not a broken one.
 */
function resolveOverflowNames(overflows, allSites, monById) {
  const known = new Set();
  for (const s of allSites) known.add(norm(s.name));
  for (const [, m] of monById) known.add(norm(m.props.bw_name));

  const linked = new Map();
  const unresolved = new Map(); // name -> count
  let direct = 0;
  let viaAlias = 0;
  let pairs = 0;
  const aliasUsed = new Map();

  for (const f of overflows) {
    const p = f.properties ?? {};
    if (!p.bathing) continue;
    for (const raw of String(p.bathing).split(';')) {
      const name = norm(raw);
      if (!name) continue;
      pairs++;
      let resolved = null;
      if (known.has(name)) {
        resolved = name;
        direct++;
      } else if (EDM_NAME_ALIASES.has(name) && known.has(EDM_NAME_ALIASES.get(name))) {
        resolved = EDM_NAME_ALIASES.get(name);
        viaAlias++;
        aliasUsed.set(name, (aliasUsed.get(name) ?? 0) + 1);
      }
      if (!resolved) {
        unresolved.set(name, (unresolved.get(name) ?? 0) + 1);
        continue;
      }
      if (!linked.has(resolved)) linked.set(resolved, []);
      linked.get(resolved).push({ name: p.name || p.id, spills: p.spills, hours: p.hours });
    }
  }

  if (unresolved.size) {
    console.error('\n  EDM bathing_water names that do not resolve to any England bathing water:');
    for (const [n, c] of [...unresolved].sort((a, b) => b[1] - a[1])) {
      console.error(`     "${n}"  (${c} overflow${c === 1 ? '' : 's'})`);
    }
    console.error('\n  The EDM join is free-text name matching across EA services that do not agree');
    console.error('  on their own spellings. Add the correct mapping to EDM_NAME_ALIASES and re-run.');
    console.error('  Do NOT drop these: a silently unresolved name shows on the map as "no overflow');
    console.error('  requires monitoring because of this beach", which is a claim about the network.');
    throw new Error(`${unresolved.size} unresolved EDM bathing water name(s)`);
  }

  console.log('\n  EDM join — overflow → bathing water, resolved by name:');
  console.log(`     ${pairs} name references across the corridor's overflows`);
  console.log(`     ${direct} resolved directly, ${viaAlias} needed an alias`);
  for (const [n, c] of aliasUsed) {
    console.log(`        "${n}" → "${EDM_NAME_ALIASES.get(n)}"  (${c})`);
  }
  const unusedAliases = [...EDM_NAME_ALIASES.keys()].filter((k) => !aliasUsed.has(k));
  if (unusedAliases.length) {
    console.log(`     ! ${unusedAliases.length} alias entr(y/ies) went unused — the source may have been corrected:`);
    for (const n of unusedAliases) console.log(`        "${n}"`);
  }
  // Sort each site's overflows busiest-first, so the card can lead with the worst.
  for (const list of linked.values()) list.sort((a, b) => (b.spills ?? 0) - (a.spills ?? 0));
  return linked;
}

/** Report what the data actually says, so the About copy can stay factual. */
function report(features, overflows) {
  const props = features.map((f) => f.properties);
  const tally = (key) =>
    props.reduce((m, p) => m.set(p[key] ?? '—', (m.get(p[key] ?? '—') ?? 0) + 1), new Map());

  const cls = tally('cls');
  const order = ['Excellent', 'Good', 'Sufficient', 'Poor', '—'];
  console.log(`\n  classification, ${props[0]?.clsYear ?? LAST_YEAR} (aggregating ${props[0]?.clsFrom}–${props[0]?.clsYear} samples):`);
  for (const k of order) {
    if (!cls.has(k)) continue;
    const label = k === '—' ? 'not assessed (newly designated, never classified)' : k;
    console.log(`     ${String(cls.get(k)).padStart(3)}  ${label}`);
  }
  const unassessed = props.filter((p) => !p.cls);
  for (const p of unassessed) console.log(`          · ${p.name} (designated ${p.desYr})`);

  console.log('\n  by water type:');
  for (const [k, v] of [...tally('kind')].sort((a, b) => b[1] - a[1])) console.log(`     ${String(v).padStart(3)}  ${k}`);

  console.log('\n  by sewerage undertaker:');
  for (const [k, v] of [...tally('undertaker')].sort((a, b) => b[1] - a[1])) console.log(`     ${String(v).padStart(3)}  ${k}`);

  const rain = props.filter((p) => p.rain).length;
  console.log(`\n  ${rain} of ${props.length} flagged waterQualityImpactedByHeavyRain`);

  // 2020 must be a hole for every site that existed then.
  const i2020 = 2020 - FIRST_YEAR;
  const existed2020 = props.filter((p) => p.hist[i2020] !== NOT_DESIGNATED);
  const bad2020 = existed2020.filter((p) => p.hist[i2020] !== 'U');
  console.log(`  ${existed2020.length} site(s) were designated in 2020; ${existed2020.length - bad2020.length} carry it as un-assessed`);
  if (bad2020.length) console.log(`     ! ${bad2020.length} do NOT — check the series`);

  // A site whose series has a hole in the MIDDLE — designated, unclassified for
  // some years, then classified again. Worth naming rather than smoothing over.
  const gaps = props.filter((p) => p.hist.replace(/^-+/, '').includes('-'));
  if (gaps.length) {
    console.log(`\n  ${gaps.length} site(s) have an interior gap in the ${FIRST_YEAR}–${LAST_YEAR} series —`);
    console.log('    a published classification, then years with none, then more. Drawn as a gap:');
    for (const p of gaps) console.log(`     ${p.name}: ${p.hist} (designated ${p.desYr})`);
  }

  const withOvf = props.filter((p) => p.ovf.length);
  const pairs = props.reduce((n, p) => n + p.ovf.length, 0);
  const linkedOverflows = new Set();
  for (const f of overflows) if (f.properties?.bathing) linkedOverflows.add(f.properties.id);
  console.log('\n  storm overflows required to monitor because of a bathing water:');
  console.log(`     ${withOvf.length} of ${props.length} bathing waters have at least one`);
  console.log(`     ${props.length - withOvf.length} have NONE — which means no nearby overflow carries a`);
  console.log('       bathing-water EDM permit condition, NOT that nothing discharges there');
  console.log(`     ${pairs} overflow→bathing-water links, from ${linkedOverflows.size} of ${overflows.length} corridor overflows`);
  const top = [...props].sort((a, b) => b.ovf.length - a.ovf.length).slice(0, 5);
  for (const p of top) console.log(`        ${String(p.ovf.length).padStart(3)}  ${p.name}`);
}

main().catch((err) => {
  console.error('\nFailed to build bathing water data:', err.message);
  process.exit(1);
});
