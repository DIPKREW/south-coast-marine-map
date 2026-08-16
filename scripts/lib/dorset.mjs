/**
 * Shared geographic config for the data pipeline. Both data layers query the
 * same whole-of-Dorset bounding box and clip to the same Dorset LNRS area
 * boundary, so they share one clean county footprint.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));

// Whole-of-Dorset query envelope (padded around the LNRS area): [W, S, E, N].
// The precise edge comes from the clip mask; this just bounds the source query.
export const DORSET_BBOX = [-3.0, 50.5, -1.65, 51.1];

// The Dorset LNRS area boundary (Dorset Council + BCP) — Natural England open
// data, "Local Nature Recovery Strategy Areas (England)", the Dorset feature.
// Simplified and committed so the build is reproducible and offline-capable.
export const MASK_PATH = resolve(__dir, '../dorset-lnrs-area.geojson');

export async function loadMaskString() {
  return readFile(MASK_PATH, 'utf8');
}
