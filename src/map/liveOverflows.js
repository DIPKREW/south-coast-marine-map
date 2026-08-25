/**
 * LIVE STORM OVERFLOW DISCHARGE STATUS — the only layer on this map fetched at
 * RUNTIME rather than baked into /public/data at build time, because a status
 * that is hours old is worse than useless.
 *
 * Source: the National Storm Overflow Hub (Stream, streamwaterdata.co.uk). The
 * hub is a map over one ArcGIS FeatureServer PER WATER COMPANY rather than a
 * single national endpoint, so this module queries each company that operates in
 * the project area and merges the results. All are public, anonymous ArcGIS
 * feature services: no API key, no registration, and they send
 * `access-control-allow-origin: *`, so the browser can read them directly.
 *
 * Fetched ON TOGGLE — and, because the layer is lazy, only if someone actually
 * switches it on. There is still deliberately no polling loop: the companies
 * publish within ~60 minutes of an overflow starting or stopping, so a refresh
 * is a designed feature rather than something bolted on invisibly. That feature
 * now EXISTS — src/ui/liveStatusControl.js floats a small control beside the
 * control panel whenever this layer is on, showing the snapshot time this
 * function stamps and offering a manual re-fetch. `fetchedAt` is therefore read
 * by two surfaces (that control and the site briefing), and both format it
 * through `snapshotTime` below so they cannot word the same moment differently.
 *
 * A failure of ONE company degrades rather than breaks: the layer draws whatever
 * did come back and reports what didn't. Only an all-companies failure marks the
 * layer unavailable.
 *
 * THE GRANULARITY OF "PARTIAL" IS A WHOLE COMPANY. fetchCompany pages until a
 * short page, and any HTTP or ArcGIS error mid-paging throws, discarding that
 * company entirely — there is no half-company state. So `stats.failed` is the
 * complete account of what went wrong.
 *
 * What it CANNOT account for is a company answering HTTP 200 with an empty list:
 * that counts as a success and is indistinguishable from a company with nothing
 * in the query window. `stats.received` records how many records each company
 * actually returned so the gap is VISIBLE rather than inferred — but nothing
 * anywhere turns a zero into a failure claim. On 2026-08-25 Thames Water
 * returned 3 records against South West Water's 1050, and 3 is as plausible a
 * true answer as 0 would be.
 *
 * Membership is HYDROLOGICAL. The companies' services can only be queried with a
 * rectangle, so the catchment boundary's envelope is used as the query window
 * and every point that comes back is then tested against the boundary itself —
 * the same file, and the same ray-casting test, that the build-time layers use.
 * That is what keeps an overflow near Salisbury (inland, drains south) in and one
 * at Bideford (coastal, drains to the Bristol Channel) out.
 *
 * A second, independent GEOGRAPHIC test then applies the Beachy Head cutoff, and
 * a short force-include list beats both — see catchmentBoundary.js.
 */
import { loadCatchmentBoundary } from './catchmentBoundary.js';

// A page from an ArcGIS feature service. The services cap responses at 1000–2000
// records and South West Water alone returns well over that for the query
// envelope, so this must page.
const PAGE_SIZE = 1000;

// The companies whose networks reach this coastline. All four are queried; the
// catchment test then decides what actually belongs, which is why Thames Water
// is still listed even though almost all of its network drains to the Thames —
// the filter, not the company list, is what draws the line.
const COMPANIES = [
  {
    name: 'South West Water',
    url: 'https://services-eu1.arcgis.com/OMdMOtfhATJPcHe3/arcgis/rest/services/NEH_outlets_PROD/FeatureServer/0',
  },
  {
    name: 'Southern Water',
    url: 'https://services-eu1.arcgis.com/6qJmARkS2dt2IjVA/arcgis/rest/services/SouthernWater_StormOverflowActivity_PROD_view/FeatureServer/0',
  },
  {
    name: 'Wessex Water',
    url: 'https://services.arcgis.com/3SZ6e0uCvPROr4mS/arcgis/rest/services/Wessex_Water_Storm_Overflow_Activity/FeatureServer/0',
  },
  {
    name: 'Thames Water',
    url: 'https://services2.arcgis.com/g6o32ZDQ33GpCIu3/arcgis/rest/services/Thames_Water_Storm_Overflow_Activity_(Production)_view/FeatureServer/0',
  },
];

// The companies publish the same schema in different cases (`status` vs
// `Status`), so every read goes through a case-insensitive lookup.
function prop(props, key) {
  const want = key.toLowerCase();
  for (const k of Object.keys(props)) if (k.toLowerCase() === want) return props[k];
  return undefined;
}

async function fetchCompany(company, envelope, signal) {
  const features = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const qs = new URLSearchParams({
      where: '1=1',
      outFields: '*',
      geometry: envelope.join(','),
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outSR: '4326',
      returnGeometry: 'true',
      resultOffset: String(offset),
      resultRecordCount: String(PAGE_SIZE),
      f: 'geojson',
    });
    /*
     * `cache: 'reload'` IS LOAD-BEARING, not a precaution.
     *
     * The companies serve these queries with `cache-control: public,
     * max-age=300` (confirmed against Wessex Water). The query URL is identical
     * every time, so without this the browser answers a repeat query from its
     * own HTTP cache — measured at 1-5 ms against 687-1053 ms for a real round
     * trip — and hands back a five-minute-old copy that `fetchedAt` would then
     * stamp with the current time. A snapshot time that describes something
     * other than what was fetched is exactly the failure this layer exists to
     * avoid.
     *
     * This is a client-side cache mode, not a header, so it cannot turn these
     * into preflighted cross-origin requests.
     */
    const res = await fetch(`${company.url}/query?${qs}`, { signal, cache: 'reload' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error.message || 'ArcGIS error');
    const batch = json.features ?? [];
    features.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return features;
}

/** The site-name lookup built by scripts/fetch-storm-overflows.mjs. Optional. */
async function fetchNames(base, signal) {
  try {
    const res = await fetch(`${base}data/storm-overflow-names.json`, { signal });
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {}; // names are a nicety; the layer still works without them
  }
}

const titleCase = (s) =>
  String(s)
    .toLowerCase()
    .replace(/\b[\w'()/-]+\b/g, (w) => w[0].toUpperCase() + w.slice(1));

/**
 * Query every company, merge into one FeatureCollection, and return it along
 * with a note of any company that failed.
 *
 * Status is normalised to the hub's own encoding:
 *    1  discharging now
 *    0  not discharging
 *   -1  monitor offline / no signal
 */
export async function loadLiveOverflows({ base = '/', signal } = {}) {
  // The boundary must be in hand before the companies are queried — its envelope
  // is the query window.
  const boundary = await loadCatchmentBoundary(base, signal);

  const [names, ...settled] = await Promise.all([
    fetchNames(base, signal),
    ...COMPANIES.map((c) => fetchCompany(c, boundary.envelope, signal).then(
      (features) => ({ company: c.name, features }),
      (error) => ({ company: c.name, error }),
    )),
  ]);

  const failures = settled.filter((r) => r.error);
  const ok = settled.filter((r) => !r.error);
  if (!ok.length) {
    throw new Error(`no live storm overflow feed responded (${failures.map((f) => f.company).join(', ')})`);
  }

  const features = [];
  const counts = { 1: 0, 0: 0, '-1': 0 };
  // Raw records returned per company, BEFORE the catchment test — see the note
  // on the empty-200 gap in the header. Recorded, never interpreted.
  const received = {};
  let outside = 0;
  for (const { company, features: raw } of ok) {
    received[company] = raw.length;
    for (const f of raw) {
      if (!f.geometry?.coordinates?.length) continue;
      const p = f.properties ?? {};
      const id = prop(p, 'id') ?? null;
      // Hydrological test AND the Beachy Head cutoff, unless force-included.
      if (!boundary.includes(f.geometry.coordinates, id)) { outside++; continue; }
      const rawStatus = Number(prop(p, 'status'));
      // Anything unrecognised is treated as "no signal", never as "clean".
      const status = rawStatus === 1 ? 1 : rawStatus === 0 ? 0 : -1;
      counts[status]++;
      const water = prop(p, 'receivingWaterCourse');
      features.push({
        type: 'Feature',
        properties: {
          id,
          name: (id && names[id]) || null,
          co: prop(p, 'company') || company,
          status,
          water: water ? titleCase(water) : null,
          // Epoch milliseconds, or null. `since` is when the CURRENT status
          // began; `updated` is when the company last published anything.
          since: Number(prop(p, 'statusStart')) || null,
          updated: Number(prop(p, 'lastUpdated')) || null,
          endedAt: Number(prop(p, 'latestEventEnd')) || null,
        },
        geometry: f.geometry,
      });
    }
  }

  if (failures.length) {
    console.warn(
      '[storm-live] some companies did not respond, layer is partial:',
      failures.map((f) => `${f.company} (${f.error?.message ?? f.error})`).join('; '),
    );
  }

  return {
    data: { type: 'FeatureCollection', features },
    stats: {
      total: features.length,
      discharging: counts[1],
      notDischarging: counts[0],
      offline: counts['-1'],
      companies: ok.map((r) => r.company),
      failed: failures.map((f) => f.company),
      received,
      outsideCatchment: outside,
      fetchedAt: Date.now(),
    },
  };
}

/**
 * The ONE rendering of `fetchedAt` as a time of day.
 *
 * Two surfaces quote this moment — the floating live-status control and the site
 * briefing's snapshot note — and the requirement is that they can never disagree
 * about it. They read the same `stats` object out of the same controller, so the
 * only remaining way to disagree was to format it differently. This is why both
 * call this instead.
 *
 * Returns null when there is no timestamp, so a caller has to decide what to say
 * about that rather than being handed a plausible-looking blank.
 */
export function snapshotTime(stats) {
  const at = stats?.fetchedAt;
  if (!at) return null;
  return new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Which company feeds this snapshot actually rests on, as a sentence — or null
 * when all four answered and there is nothing to disclose.
 *
 * Names the companies rather than counting them: "Wessex Water did not respond"
 * is checkable against the hub, "3 of 4 feeds" is not.
 */
export function partialNote(stats) {
  const failed = stats?.failed ?? [];
  if (!failed.length) return null;
  const list = failed.length === 1
    ? failed[0]
    : `${failed.slice(0, -1).join(', ')} and ${failed[failed.length - 1]}`;
  return `${list} did not respond, so this snapshot is partial.`;
}

/** The four company names, in query order — so a caller can say "all four" and
 *  mean the same four this module queries. */
export const COMPANY_NAMES = COMPANIES.map((c) => c.name);
