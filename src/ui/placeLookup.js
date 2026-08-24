/**
 * NEAREST-NAME REVERSE LOOKUP, from the local search index.
 *
 * public/data/search-index.json already holds 4,348 named things this map draws,
 * each with a centroid — it is what powers the place search. Reading it backwards
 * gives a place name for an arbitrary point with NO network call, which is why
 * the site briefing uses it instead of Photon: a briefing should not depend on a
 * third-party service that documents itself as best-effort.
 *
 * IT IS NOT A GAZETTEER, AND IT DOES NOT PRETEND TO BE. The index holds only
 * what this map draws: 1,865 wrecks, 1,696 storm overflows, 409 rivers, 224
 * licensed areas, 64 protected areas, 59 water bodies, 31 protected wreck sites.
 * There is not one settlement in it. Asked for the nearest entry to a pin in
 * Swanage Bay it answers "Harman's Cross Pumping Station", which is a true fact
 * about a sewer asset and a false answer to "where am I".
 *
 * So only the AREA kinds are consulted — water bodies and protected areas, the
 * two that describe a place rather than mark an object in it — and the result is
 * labelled as the nearest named feature rather than dressed up as a place name.
 * Beyond MAX_KM nothing is returned and the panel shows coordinates alone, which
 * is the honest answer for most of the open sea.
 */

/** The kinds that answer "where is this", rather than "what is at this point". */
const AREA_KINDS = new Set(['water body', 'marine protected area']);

/** Past this, the nearest named area is not a description of where the pin is. */
const MAX_KM = 6;

let cache = null;

export function createPlaceLookup(base = '/') {
  const load = () => {
    if (cache) return cache;
    cache = fetch(`${base}data/search-index.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => (j.entries ?? []).filter((e) => Array.isArray(e.c) && AREA_KINDS.has(e.k)))
      .catch((err) => {
        console.warn('[briefing] place lookup unavailable:', err.message);
        return [];
      });
    return cache;
  };

  return {
    /** @returns {Promise<string|null>} "nearest Name (kind)", or null. */
    async nearest([lon, lat]) {
      const entries = await load();
      if (!entries.length) return null;
      const kx = 111.320 * Math.cos((lat * Math.PI) / 180);
      const ky = 111.132;
      let best = null;
      let bestD = Infinity;
      for (const e of entries) {
        const dx = (e.c[0] - lon) * kx;
        const dy = (e.c[1] - lat) * ky;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = e; }
      }
      if (!best || Math.sqrt(bestD) > MAX_KM) return null;
      return `nearest named feature: ${best.n} (${best.k})`;
    },
  };
}
