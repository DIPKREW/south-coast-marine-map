/**
 * PLACE SEARCH — jump to a named location in the corridor.
 *
 * TWO SOURCES, LOCAL FIRST.
 *
 * The local index (public/data/search-index.json, 4,348 entries) holds every
 * named thing this map actually draws, so it can say what KIND each result is —
 * "Poole Harbour — water body" against "Poole Harbour — marine protected area" —
 * and it answers instantly with no network at all.
 *
 * It is not enough on its own. Measured against 40 common corridor place names it
 * resolves 37, but several only through oddly-named infrastructure ("New Swanage
 * Attenuation Tank" for Swanage) and it misses Durdle Door, Brixham and
 * Eastbourne outright. So ordinary place names come from Photon, which is
 * keyless and — unlike Nominatim, whose usage policy states outright that you
 * "must not implement such a service on the client side" — is built for
 * type-ahead.
 *
 * Photon is best-effort by its own terms ("we do not guarantee for the
 * availability"), so every network path here fails soft: local results still
 * show, and the dropdown says the place lookup is unreachable rather than the
 * box appearing broken.
 *
 * CORRIDOR CONSTRAINT. Photon is given the corridor bbox and its results are
 * re-checked against it here as well. A search for "Newcastle" must not fly the
 * map 400 km north; belt and braces, because the bbox is the remote service's
 * promise rather than ours.
 */
import { el } from './dom.js';

const CORRIDOR = { w: -6.2, s: 49.85, e: 0.245, n: 51.1 };
const inCorridor = ([lon, lat]) =>
  lon >= CORRIDOR.w && lon <= CORRIDOR.e && lat >= CORRIDOR.s && lat <= CORRIDOR.n;

const PHOTON = 'https://photon.komoot.io/api/';
const MIN_CHARS = 2;      // local index kicks in here
const REMOTE_CHARS = 3;   // don't trouble a shared service with one or two letters
const DEBOUNCE = 260;
const MAX_LOCAL = 6;
const MAX_REMOTE = 4;

/** Zoom by OSM feature type — a town needs a wider view than a sea arch. */
const PLACE_ZOOM = {
  city: 11, town: 12, village: 13, hamlet: 14, suburb: 13, locality: 13,
  bay: 12, beach: 14, arch: 15, cape: 13, cliff: 14, island: 12, islet: 14,
  harbour: 13, marina: 14, default: 13,
};

export function buildSearch({ map, onNavigate }) {
  const root = el('div', 'search');

  const input = el('input', 'search__input', {
    type: 'search', placeholder: 'Search a place…', autocomplete: 'off',
    'aria-label': 'Search for a place in the corridor',
    role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'search-results',
  });
  const list = el('ul', 'search__results', { id: 'search-results', role: 'listbox' });
  root.append(input, list);

  let index = null;      // lazily fetched local index
  let indexFailed = false;
  let items = [];        // current result set
  let active = -1;
  let timer = null;
  let seq = 0;           // guards against out-of-order responses

  const loadIndex = async () => {
    if (index || indexFailed) return;
    try {
      const base = import.meta.env.BASE_URL ?? '/';
      const res = await fetch(`${base}data/search-index.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      index = (await res.json()).entries ?? [];
    } catch (err) {
      indexFailed = true;
      console.warn('[search] local index unavailable:', err?.message || err);
    }
  };

  /** Local matching: prefix hits rank above interior hits, then by source rank. */
  const searchLocal = (q) => {
    if (!index) return [];
    const k = q.toLowerCase();
    const out = [];
    for (const e of index) {
      const i = e.n.toLowerCase().indexOf(k);
      if (i < 0) continue;
      out.push({ name: e.n, kind: e.k, center: e.c, zoom: e.z, score: (i === 0 ? 0 : 100) + e.r, local: true });
      if (out.length > 400) break;
    }
    out.sort((a, b) => a.score - b.score || a.name.length - b.name.length);
    return out.slice(0, MAX_LOCAL);
  };

  const searchRemote = async (q, signal) => {
    const url = `${PHOTON}?q=${encodeURIComponent(q)}&limit=8`
      + `&bbox=${CORRIDOR.w},${CORRIDOR.s},${CORRIDOR.e},${CORRIDOR.n}`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const gj = await res.json();
    const out = [];
    for (const f of gj.features ?? []) {
      const c = f.geometry?.coordinates;
      // Re-check the corridor ourselves rather than trusting the bbox parameter.
      if (!c || !inCorridor(c)) continue;
      const p = f.properties ?? {};
      if (!p.name) continue;
      const kind = p.osm_value && p.osm_value !== 'yes' ? String(p.osm_value).replace(/_/g, ' ') : 'place';
      const where = p.county || p.state || p.district;
      out.push({
        name: p.name,
        kind: where && where !== p.name ? `${kind} · ${where}` : kind,
        center: [c[0], c[1]],
        zoom: PLACE_ZOOM[p.osm_value] ?? PLACE_ZOOM.default,
        local: false,
      });
      if (out.length >= MAX_REMOTE) break;
    }
    return out;
  };

  const render = (results, { remoteFailed = false, pending = false } = {}) => {
    list.innerHTML = '';
    items = results;
    active = -1;
    if (!results.length) {
      const li = el('li', 'search__empty');
      li.textContent = pending ? 'Searching…'
        : remoteFailed ? 'Nothing on the map matches, and the place lookup is unreachable.'
        : 'No matching place in this corridor.';
      list.appendChild(li);
    } else {
      results.forEach((r, i) => {
        const li = el('li', 'search__result', { role: 'option', id: `search-opt-${i}`, 'aria-selected': 'false' });
        const nm = el('span', 'search__result-name');
        nm.textContent = r.name;
        const kd = el('span', 'search__result-kind');
        kd.textContent = r.kind;
        li.append(nm, kd);
        li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(i); });
        list.appendChild(li);
      });
      if (remoteFailed) {
        const li = el('li', 'search__note');
        li.textContent = 'Place lookup unreachable — showing map features only.';
        list.appendChild(li);
      }
    }
    open(true);
  };

  const open = (v) => {
    root.classList.toggle('is-open', v && list.childElementCount > 0);
    input.setAttribute('aria-expanded', String(v && list.childElementCount > 0));
  };
  const close = () => { root.classList.remove('is-open'); input.setAttribute('aria-expanded', 'false'); active = -1; };

  const highlight = (next) => {
    const nodes = [...list.querySelectorAll('.search__result')];
    if (!nodes.length) return;
    active = ((next % nodes.length) + nodes.length) % nodes.length;
    nodes.forEach((n, i) => {
      n.classList.toggle('is-active', i === active);
      n.setAttribute('aria-selected', String(i === active));
    });
    input.setAttribute('aria-activedescendant', `search-opt-${active}`);
    nodes[active].scrollIntoView({ block: 'nearest' });
  };

  const choose = (i) => {
    const r = items[i];
    if (!r) return;
    close();
    input.value = r.name;
    input.blur();
    map.flyTo({ center: r.center, zoom: r.zoom, speed: 1.2, essential: true });
    onNavigate?.(r);
  };

  const run = async () => {
    const q = input.value.trim();
    if (q.length < MIN_CHARS) { close(); return; }
    const mine = ++seq;
    await loadIndex();
    if (mine !== seq) return;

    const local = searchLocal(q);
    if (q.length < REMOTE_CHARS) { render(local); return; }

    // Show local hits immediately; the geocoder fills in behind them.
    render(local.length ? local : [], { pending: !local.length });

    let remote = [], failed = false;
    try {
      remote = await searchRemote(q);
    } catch (err) {
      failed = true;
      console.warn('[search] place lookup failed:', err?.message || err);
    }
    if (mine !== seq) return;

    // De-duplicate: a Photon result whose name already appears locally adds nothing.
    const seen = new Set(local.map((r) => r.name.toLowerCase()));
    render([...local, ...remote.filter((r) => !seen.has(r.name.toLowerCase()))], { remoteFailed: failed });
  };

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, DEBOUNCE); });
  input.addEventListener('focus', () => { if (items.length) open(true); });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(active - 1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active >= 0 ? active : 0);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (root.classList.contains('is-open')) close();
      else { input.value = ''; input.blur(); }
    }
  });

  return { el: root, focus: () => input.focus() };
}
