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
 * Fetched ONCE per page load — and, because the layer is lazy, only if someone
 * actually switches it on. There is deliberately no polling loop: the companies
 * publish within ~60 minutes of an overflow starting or stopping, so a refresh
 * is a real feature worth designing (with a visible "as of" time and a manual
 * refresh), not something to bolt on invisibly.
 *
 * A failure of ONE company degrades rather than breaks: the layer draws whatever
 * did come back and reports what didn't. Only an all-companies failure marks the
 * layer unavailable.
 */

// Same box as the build-time scripts — see scripts/lib/southcoast.mjs, which is
// the pipeline's copy. [W, S, E, N].
const SOUTH_COAST_BBOX = [-6.2, 49.85, 0.6, 51.1];

// A page from an ArcGIS feature service. The services cap responses at 1000–2000
// records and South West Water alone has ~1300 in the box, so this must page.
const PAGE_SIZE = 1000;

// The companies whose networks reach the Land's End → Beachy Head coastline.
// (These four are exactly the companies present in the EA's annual return for
// the same box, so the two storm overflow layers cover the same operators.)
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

async function fetchCompany(company, signal) {
  const features = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const qs = new URLSearchParams({
      where: '1=1',
      outFields: '*',
      geometry: SOUTH_COAST_BBOX.join(','),
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outSR: '4326',
      returnGeometry: 'true',
      resultOffset: String(offset),
      resultRecordCount: String(PAGE_SIZE),
      f: 'geojson',
    });
    const res = await fetch(`${company.url}/query?${qs}`, { signal });
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
  const [names, ...settled] = await Promise.all([
    fetchNames(base, signal),
    ...COMPANIES.map((c) => fetchCompany(c, signal).then(
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
  for (const { company, features: raw } of ok) {
    for (const f of raw) {
      if (!f.geometry?.coordinates?.length) continue;
      const p = f.properties ?? {};
      const id = prop(p, 'id') ?? null;
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
      fetchedAt: Date.now(),
    },
  };
}
