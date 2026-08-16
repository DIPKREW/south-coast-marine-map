/**
 * Build the "High Opportunity Nature Areas" GeoJSON covering the whole of Dorset
 * from Dorset's official Local Habitat Map GeoPackage.
 *
 * Source of truth: Dorset Council, "Dorset's nature recovery maps" — the spatial
 * download of the Local Habitat Map (Open Government Licence). In that dataset
 * the layer named **ACB** is, per the bundled Read Me, the Dorset LNRS
 * "high opportunity nature areas" layer (Defra: "areas that could become of
 * importance"). Geometry is EPSG:27700 (British National Grid).
 *
 *   Download page: https://www.dorsetcouncil.gov.uk/dorset-s-nature-recovery-maps
 *                  → "Download the spatial layers of the local habitat map"
 *   That yields a zip containing "Dorset local habitat map.gpkg" (~1 GB).
 *
 * This script reads ACB straight from the GeoPackage (no GDAL needed), reprojects
 * to WGS84, clips to the Dorset LNRS area (the same mask the SSSI layer uses),
 * simplifies aggressively, and writes public/data/hona.geojson (committed, so the
 * app runs out of the box). The 1 GB source is NOT committed; point this script
 * at it with the HONA_GPKG env var or the default path below.
 *
 * Run with: npm run data:hona
 */
import { writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import proj4 from 'proj4';
import mapshaper from 'mapshaper';
import { DORSET_BBOX as BBOX, loadMaskString } from './lib/dorset.mjs';
import { areaHa } from './lib/geo.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, '../public/data/hona.geojson');

// Where to find the GeoPackage (override with HONA_GPKG=/path/to/file.gpkg).
const GPKG =
  process.env.HONA_GPKG || '/tmp/lnrs_data/Dorset local habitat map.gpkg';

// British National Grid → WGS84 (display-grade 7-parameter transform).
proj4.defs(
  'EPSG:27700',
  '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 ' +
    '+ellps=airy +towgs84=446.448,-125.157,542.060,0.1502,0.2470,0.8421,-20.4894 +units=m +no_defs',
);
const toWgs = proj4('EPSG:27700', 'EPSG:4326');
const toBng = proj4('EPSG:4326', 'EPSG:27700');

// ---- GeoPackage geometry blob (GPB) + WKB parsing -----------------------

function readGeometry(blob) {
  // GPB header: 'GP', version, flags, srs_id(int32), envelope, then WKB.
  const flags = blob[3];
  const envCode = (flags >> 1) & 0x07;
  const envBytes = [0, 32, 48, 48, 64][envCode] ?? 0;
  let pos = 8 + envBytes;

  const readU32 = (le) => {
    const v = le ? blob.readUInt32LE(pos) : blob.readUInt32BE(pos);
    pos += 4;
    return v;
  };
  const readPts = (le, n) => {
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const x = le ? blob.readDoubleLE(pos) : blob.readDoubleBE(pos);
      const y = le ? blob.readDoubleLE(pos + 8) : blob.readDoubleBE(pos + 8);
      pos += 16;
      const [lon, lat] = toWgs.forward([x, y]);
      out[i] = [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
    }
    return out;
  };
  const readPolygon = () => {
    const le = blob[pos] === 1;
    pos += 1;
    const type = (le ? blob.readUInt32LE(pos) : blob.readUInt32BE(pos)) % 1000;
    pos += 4;
    if (type !== 3) throw new Error(`expected polygon, got ${type}`);
    const nRings = readU32(le);
    const rings = new Array(nRings);
    for (let r = 0; r < nRings; r++) rings[r] = readPts(le, readU32(le));
    return rings;
  };

  const le = blob[pos] === 1;
  pos += 1;
  const type = (le ? blob.readUInt32LE(pos) : blob.readUInt32BE(pos)) % 1000;
  pos += 4;

  if (type === 3) {
    // Single polygon — rewind the per-polygon header we just consumed.
    pos -= 5;
    return { type: 'Polygon', coordinates: readPolygon() };
  }
  if (type === 6) {
    const nPoly = readU32(le);
    const polys = new Array(nPoly);
    for (let p = 0; p < nPoly; p++) polys[p] = readPolygon();
    return { type: 'MultiPolygon', coordinates: polys };
  }
  throw new Error(`unsupported geometry type ${type}`);
}

// ---- Main ---------------------------------------------------------------

async function main() {
  try {
    await access(GPKG);
  } catch {
    console.error(
      `\nGeoPackage not found at:\n  ${GPKG}\n\n` +
        'Download "Dorset local habitat map.gpkg" from\n' +
        '  https://www.dorsetcouncil.gov.uk/dorset-s-nature-recovery-maps\n' +
        '("Download the spatial layers of the local habitat map"), then either place it\n' +
        'at the path above or run: HONA_GPKG=/path/to/file.gpkg npm run data:hona\n',
    );
    process.exit(1);
  }

  // BBox → BNG extent for the spatial-index query (sample edges, take min/max).
  const samples = [
    [BBOX[0], BBOX[1]], [BBOX[2], BBOX[1]], [BBOX[2], BBOX[3]], [BBOX[0], BBOX[3]],
    [(BBOX[0] + BBOX[2]) / 2, BBOX[1]], [(BBOX[0] + BBOX[2]) / 2, BBOX[3]],
  ];
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const p of samples) {
    const [x, y] = toBng.forward(p);
    minx = Math.min(minx, x); maxx = Math.max(maxx, x);
    miny = Math.min(miny, y); maxy = Math.max(maxy, y);
  }

  console.log('Reading High Opportunity Nature Areas (ACB) from the Local Habitat Map…');
  const db = new DatabaseSync(GPKG, { readOnly: true });
  const ids = db
    .prepare(
      'SELECT id FROM rtree_ACB_geom WHERE maxx>=? AND minx<=? AND maxy>=? AND miny<=?',
    )
    .all(minx, maxx, miny, maxy)
    .map((r) => r.id);

  const stmt = db.prepare('SELECT acb_id, geom FROM ACB WHERE acb_id = ?');
  const features = [];
  for (const id of ids) {
    const row = stmt.get(id);
    if (!row?.geom) continue;
    try {
      const geometry = readGeometry(Buffer.from(row.geom));
      features.push({
        type: 'Feature',
        properties: { acb_id: row.acb_id, area_ha: areaHa(geometry) },
        geometry,
      });
    } catch (err) {
      console.warn(`  skipped acb_id ${row.acb_id}: ${err.message}`);
    }
  }
  db.close();
  console.log(`Got ${features.length} areas across Dorset. Clipping & simplifying…`);

  // County-wide ACB is large, so simplify aggressively (but topology-preservingly
  // via Visvalingam + keep-shapes), drop slivers, then clip to the LNRS boundary
  // LAST so the edge matches the SSSI layer's footprint exactly.
  const raw = { type: 'FeatureCollection', features };
  const commands =
    '-i in.geojson -simplify 6% keep-shapes -clean ' +
    '-filter-slivers min-area=2000m2 ' +
    '-clip mask.geojson -clean ' +
    '-o precision=0.00001 format=geojson out.geojson';
  const result = await mapshaper.applyCommands(commands, {
    'in.geojson': JSON.stringify(raw),
    'mask.geojson': await loadMaskString(),
  });
  const out = result['out.geojson'];

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, out);
  const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
  const n = JSON.parse(out).features.length;
  console.log(`Wrote ${OUT} — ${n} features, ${kb} KB.`);
}

main().catch((err) => {
  console.error('Failed to build HONA data:', err.message);
  process.exit(1);
});
