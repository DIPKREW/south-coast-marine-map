/**
 * OS GRID REFERENCE → polygon, plus the NBN Atlas grid-facet query both species
 * layers are built from.
 *
 * Extracted from build-species.mjs (the Dorset land species grid) so the marine
 * species layer runs on exactly the same code rather than a second copy of it.
 * The honesty rules live here too, because they are the point of this approach:
 *
 *   • We never render individual records. NBN holds millions, they are heavily
 *     recording-biased, and sensitive species are deliberately blurred. Instead
 *     we ask NBN to FACET on its own pre-computed grid-reference field, which
 *     gives "recorded in this square" + a count, and no point data at all.
 *   • We pick, per species, the grid resolution the data actually supports, and
 *     only bin records at-or-finer than that resolution — so a cell never
 *     implies more precision than NBN itself published.
 */
import proj4 from 'proj4';

export const NBN_API = 'https://records-ws.nbnatlas.org/occurrences/search';
export const NBN_UA = 'south-coast-marine-map/1.0 (data build; contact benthorne77@gmail.com)';

// British National Grid → WGS84 (display-grade).
proj4.defs(
  'EPSG:27700',
  '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 ' +
    '+ellps=airy +towgs84=446.448,-125.157,542.060,0.1502,0.2470,0.8421,-20.4894 +units=m +no_defs',
);
export const toWgs = proj4('EPSG:27700', 'EPSG:4326');

const TETRAD = 'ABCDEFGHIJKLMNPQRSTUVWXYZ'; // 5×5, no 'O'

function letterPairEN(s) {
  let c1 = s.charCodeAt(0) - 65;
  let c2 = s.charCodeAt(1) - 65;
  if (c1 > 7) c1--; // skip 'I'
  if (c2 > 7) c2--;
  const e = ((c1 - 2) % 5) * 5 + (c2 % 5);
  const n = 19 - Math.floor(c1 / 5) * 5 - Math.floor(c2 / 5);
  return [e * 100000, n * 100000];
}

/** Parse a 2 km tetrad (SY99R) or 10 km (SY99) reference → { e, n, size }. */
export function parseGridRef(ref) {
  ref = String(ref).trim().toUpperCase();
  if (ref.length < 3) return null;
  let [e, n] = letterPairEN(ref.slice(0, 2));
  const rest = ref.slice(2);
  const tetrad = /^(\d)(\d)([A-Z])$/.exec(rest);
  if (tetrad) {
    e += +tetrad[1] * 10000;
    n += +tetrad[2] * 10000;
    const idx = TETRAD.indexOf(tetrad[3]);
    if (idx < 0) return null;
    e += Math.floor(idx / 5) * 2000;
    n += (idx % 5) * 2000;
    return { e, n, size: 2000 };
  }
  const tenk = /^(\d)(\d)$/.exec(rest);
  if (tenk) {
    e += +tenk[1] * 10000;
    n += +tenk[2] * 10000;
    return { e, n, size: 10000 };
  }
  return null;
}

/** The grid square as a WGS84 polygon. */
export function cellPolygon(e, n, size) {
  const corners = [[e, n], [e + size, n], [e + size, n + size], [e, n + size], [e, n]];
  return {
    type: 'Polygon',
    coordinates: [
      corners.map(([x, y]) => {
        const [lon, lat] = toWgs.forward([x, y]);
        return [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
      }),
    ],
  };
}

/** Centre of a grid square, in WGS84 — used to test corridor membership. */
export function cellCentre(e, n, size) {
  return toWgs.forward([e + size / 2, n + size / 2]);
}

/** A rectangle as the WKT polygon the NBN spatial filter takes. */
export function bboxWkt([w, s, e, n]) {
  return `POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))`;
}

/**
 * How many records this species has in the area, and how they split by grid
 * resolution — which is what decides the honest cell size.
 */
export async function resolutionProfile(wkt, sci) {
  const usp = new URLSearchParams({
    wkt,
    pageSize: '0',
    facet: 'on',
    fq: `taxon_name:"${sci}"`,
    facets: 'gridSizeInMeters',
    flimit: '-1',
  });
  const res = await fetch(`${NBN_API}?${usp}`, { headers: { 'User-Agent': NBN_UA } });
  if (!res.ok) throw new Error(`NBN API → ${res.status} ${res.statusText}`);
  const json = await res.json();
  const dist = {};
  for (const f of json.facetResults || []) for (const v of f.fieldResult || []) dist[v.label] = v.count;
  const fine = Object.entries(dist).reduce((a, [k, c]) => a + (Number(k) <= 2000 ? c : 0), 0);
  const coarse = Object.entries(dist).reduce((a, [k, c]) => a + (Number(k) > 2000 ? c : 0), 0);
  return { total: json.totalRecords || 0, dist, fine, coarse, res: fine > coarse ? 2000 : 10000 };
}

/** Facet on the grid field at the chosen resolution → [{ ref, count }]. */
export async function gridCells(wkt, sci, res) {
  const field = res === 2000 ? 'grid_ref_2000' : 'grid_ref_10000';
  const usp = new URLSearchParams();
  usp.append('wkt', wkt);
  usp.append('pageSize', '0');
  usp.append('facet', 'on');
  usp.append('fq', `taxon_name:"${sci}"`);
  usp.append('fq', `gridSizeInMeters:[1 TO ${res}]`);
  usp.append('facets', field);
  usp.append('flimit', '-1');
  const res2 = await fetch(`${NBN_API}?${usp}`, { headers: { 'User-Agent': NBN_UA } });
  if (!res2.ok) throw new Error(`NBN API → ${res2.status} ${res2.statusText}`);
  const json = await res2.json();
  const out = [];
  for (const f of json.facetResults || []) {
    for (const v of f.fieldResult || []) out.push({ ref: v.label || '', count: v.count });
  }
  return out;
}
