/**
 * Build the Dorset Wildlife Trust reserves layer — EVERY reserve in DWT's
 * directory, as a shaded polygon where an OpenStreetMap boundary can be
 * confidently matched, and as a small marker everywhere else.
 *
 * Run with: npm run data:dwt
 *
 * Pipeline:
 *   A. Scrape DWT's reserve directory (sitemap → each reserve page) for the
 *      reserve name and its embedded schema.org coordinates (geocode by name via
 *      Nominatim only as a fallback). Verify each lands within Dorset.
 *   B. Pull ALL nature-reserve / protected-area polygons in Dorset from Overpass
 *      and match them to directory reserves by normalised NAME similarity AND
 *      proximity — conservative, so we never grab the wrong reserve.
 *   C. Emit one mixed-geometry FeatureCollection: matched reserves as polygons,
 *      the rest as markers (deduped against the gold visitor centres). Report
 *      honest counts; never fabricate a boundary or a location.
 *
 * DATA NOTE: DWT's authoritative boundaries are held by Dorset Environmental
 * Records Centre and are not open data, so polygons come from OSM and cover only
 * some reserves. Every directory reserve is shown at least as a marker.
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import mapshaper from 'mapshaper';
import osmtogeojson from 'osmtogeojson';
import { DORSET_BBOX, MASK_PATH, loadMaskString } from './lib/dorset.mjs';
import { areaHa, centroid, haversine, pointInGeometry } from './lib/geo.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, '../public/data/dwt-reserves.geojson');
const CENTRES_PATH = resolve(__dir, '../public/data/dwt-centres.geojson');

const SITE = 'https://www.dorsetwildlifetrust.org.uk';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const UA = 'dorset-nature-map/1.0 (data build; contact benthorne77@gmail.com)';

const DEDUP_M = 350; // a reserve marker this close to a visitor centre is dropped
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- name normalisation + similarity ------------------------------------

const STOP = new Set(['the', 'nature', 'reserve', 'reserves', 'dorset', 'wildlife', 'trust', 'dwt', 'nnr', 'lnr']);
function norm(name) {
  return (name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t && !STOP.has(t))
    .join(' ')
    .trim();
}
function bigrams(s) {
  const g = new Set();
  for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2));
  return g;
}
function dice(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a.replace(/ /g, '')), B = bigrams(b.replace(/ /g, ''));
  let inter = 0;
  for (const g of A) if (B.has(g)) inter += 1;
  return (2 * inter) / (A.size + B.size);
}
function tokensContained(a, b) {
  const A = a.split(' ').filter(Boolean), B = new Set(b.split(' ').filter(Boolean));
  return A.length >= 1 && A.every((t) => B.has(t));
}

// A confident match: strong name agreement, scaled by how close the geometries are.
function matchScore(rName, rPt, oName, oCentroid) {
  const a = norm(rName), b = norm(oName);
  if (!a || !b) return null;
  const d = haversine(rPt, oCentroid);
  const dc = dice(a, b);
  const contained = tokensContained(a, b) || tokensContained(b, a);
  let ok = false;
  if (a === b && d < 6000) ok = true;
  else if (dc >= 0.82 && d < 2500) ok = true;
  else if (contained && Math.min(a.length, b.length) >= 4 && d < 1500) ok = true;
  return ok ? { score: a === b ? 1 : dc, dist: d } : null;
}

// ---- Stage A: scrape the directory --------------------------------------

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.text();
}

async function reserveUrls() {
  const urls = new Set();
  for (const page of [1, 2]) {
    const xml = await getText(`${SITE}/sitemap.xml?page=${page}`);
    for (const m of xml.matchAll(/https:\/\/www\.dorsetwildlifetrust\.org\.uk\/nature-reserves\/[a-z0-9-]+/g)) {
      urls.add(m[0]);
    }
  }
  return [...urls].sort();
}

async function nominatim(name) {
  const q = encodeURIComponent(`${name}, Dorset, UK`);
  const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=jsonv2&limit=1&countrycodes=gb`, {
    headers: { 'User-Agent': UA },
  });
  await sleep(1100); // be polite to Nominatim
  if (!res.ok) return null;
  const j = await res.json();
  return j[0] ? [parseFloat(j[0].lon), parseFloat(j[0].lat)] : null;
}

async function scrapeReserve(url, maskGeom) {
  const html = await getText(url);
  const titleM = html.match(/<title>([^<]*?)\s*\|\s*Dorset Wildlife Trust<\/title>/i) || html.match(/<title>([^<]*)<\/title>/i);
  const name = (titleM ? titleM[1] : url.split('/').pop()).trim();
  const latM = html.match(/itemprop="latitude"\s+content="(-?\d+\.?\d*)"/i);
  const lonM = html.match(/itemprop="longitude"\s+content="(-?\d+\.?\d*)"/i);

  let pt = latM && lonM ? [parseFloat(lonM[1]), parseFloat(latM[1])] : null;
  let source = pt ? 'page' : null;
  if (!pt) {
    pt = await nominatim(name);
    source = pt ? 'nominatim' : null;
  }
  if (!pt) return { name, url, placed: false, reason: 'no coordinates' };

  const [lon, lat] = pt;
  const inBbox = lon >= DORSET_BBOX[0] && lon <= DORSET_BBOX[2] && lat >= DORSET_BBOX[1] && lat <= DORSET_BBOX[3];
  if (!inBbox) return { name, url, pt, placed: false, reason: `outside Dorset bbox (${lat.toFixed(3)}, ${lon.toFixed(3)})` };
  const inMask = pointInGeometry(pt, maskGeom);
  return { name, url, pt, source, inMask, placed: true };
}

// ---- Stage B: all OSM reserve polygons ----------------------------------

async function osmReservePolygons() {
  const [w, s, e, n] = DORSET_BBOX;
  const bbox = `${s},${w},${n},${e}`;
  const q = `[out:json][timeout:180];
(
  way["leisure"="nature_reserve"](${bbox});
  rel["leisure"="nature_reserve"](${bbox});
  way["boundary"="protected_area"](${bbox});
  rel["boundary"="protected_area"](${bbox});
);
out tags geom;`;
  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: 'data=' + encodeURIComponent(q),
  });
  if (!res.ok) throw new Error(`Overpass → ${res.status}`);
  const gj = osmtogeojson(await res.json());
  return gj.features
    .filter((f) => f.geometry && /Polygon$/.test(f.geometry.type) && f.properties?.name)
    .map((f) => ({ name: f.properties.name, geometry: f.geometry, c: centroid(f.geometry) }));
}

// ---- main ---------------------------------------------------------------

async function main() {
  const maskGeom = JSON.parse(await readFile(MASK_PATH, 'utf8')).features[0].geometry;
  // Visitor-centre coords are used to dedupe markers; degrade gracefully if absent.
  let centres = [];
  try {
    centres = JSON.parse(await readFile(CENTRES_PATH, 'utf8')).features.map((f) => f.geometry.coordinates);
  } catch {
    console.warn('   (no dwt-centres.geojson yet — run `npm run data:centres` first to dedupe markers)');
  }

  console.log('A. Scraping DWT reserve directory…');
  const urls = await reserveUrls();
  console.log(`   ${urls.length} reserves in the directory.`);
  const reserves = [];
  for (const url of urls) {
    reserves.push(await scrapeReserve(url, maskGeom));
    await sleep(250);
  }
  const placed = reserves.filter((r) => r.placed);
  const unplaceable = reserves.filter((r) => !r.placed);
  const viaNominatim = placed.filter((r) => r.source === 'nominatim');
  const outsideMask = placed.filter((r) => !r.inMask);
  console.log(`   placed: ${placed.length} (page coords: ${placed.length - viaNominatim.length}, geocoded: ${viaNominatim.length})`);
  if (outsideMask.length) console.log(`   note: ${outsideMask.length} placed just outside the simplified mask (kept; coords are DWT's own): ${outsideMask.map((r) => r.name).join(', ')}`);
  if (unplaceable.length) {
    console.log(`   UNPLACEABLE (${unplaceable.length}) — reported, not pinned:`);
    unplaceable.forEach((r) => console.log(`     • ${r.name} — ${r.reason}`));
  }

  console.log('B. Matching OpenStreetMap polygons by name + proximity…');
  const polys = await osmReservePolygons();
  console.log(`   ${polys.length} named reserve polygons in Dorset from OSM.`);

  // Build all confident (reserve, polygon) candidate pairs, then greedily assign
  // best-first so each reserve and each polygon is used at most once.
  const pairs = [];
  for (let ri = 0; ri < placed.length; ri++) {
    for (let pi = 0; pi < polys.length; pi++) {
      const m = matchScore(placed[ri].name, placed[ri].pt, polys[pi].name, polys[pi].c);
      if (m) pairs.push({ ri, pi, ...m });
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.dist - b.dist);
  const reservePoly = new Map(); // ri -> pi
  const usedPoly = new Set();
  for (const p of pairs) {
    if (reservePoly.has(p.ri) || usedPoly.has(p.pi)) continue;
    reservePoly.set(p.ri, p.pi);
    usedPoly.add(p.pi);
  }
  console.log(`   matched ${reservePoly.size} reserves to a polygon:`);
  for (const [ri, pi] of reservePoly) console.log(`     • ${placed[ri].name}  ←  OSM "${polys[pi].name}"  (${Math.round(pairs.find((q) => q.ri === ri && q.pi === pi).dist)} m)`);

  // ---- Stage C: assemble ----
  const polygonFeatures = [];
  const markerFeatures = [];
  let dedupedMarkers = 0;

  placed.forEach((r, ri) => {
    if (reservePoly.has(ri)) {
      const poly = polys[reservePoly.get(ri)];
      polygonFeatures.push({
        type: 'Feature',
        properties: { name: r.name, area_ha: areaHa(poly.geometry) },
        geometry: poly.geometry,
      });
    } else {
      // Marker — unless a gold visitor centre already marks this spot.
      const nearCentre = centres.some((c) => haversine(r.pt, c) < DEDUP_M);
      if (nearCentre) { dedupedMarkers += 1; return; }
      markerFeatures.push({ type: 'Feature', properties: { name: r.name }, geometry: { type: 'Point', coordinates: r.pt } });
    }
  });

  // Clip + simplify ONLY the polygons (markers are authoritative points).
  let polysOut = { type: 'FeatureCollection', features: [] };
  if (polygonFeatures.length) {
    const result = await mapshaper.applyCommands(
      '-i in.geojson -simplify 35% keep-shapes -clean -clip mask.geojson -clean -o precision=0.00001 format=geojson out.geojson',
      { 'in.geojson': JSON.stringify({ type: 'FeatureCollection', features: polygonFeatures }), 'mask.geojson': await loadMaskString() },
    );
    polysOut = JSON.parse(result['out.geojson']);
  }

  const features = [...polysOut.features, ...markerFeatures];
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({ type: 'FeatureCollection', features }));

  const kb = (Buffer.byteLength(JSON.stringify({ type: 'FeatureCollection', features })) / 1024).toFixed(0);
  console.log('C. Result:');
  console.log(`   reserves total (directory): ${reserves.length}`);
  console.log(`   • as polygons: ${polysOut.features.length}`);
  console.log(`   • as markers:  ${markerFeatures.length}  (+${dedupedMarkers} shown by a visitor centre instead)`);
  console.log(`   • unplaceable: ${unplaceable.length}`);
  console.log(`   Wrote ${OUT} (${kb} KB).`);
}

main().catch((err) => {
  console.error('Failed to build DWT reserves:', err.message);
  process.exit(1);
});
