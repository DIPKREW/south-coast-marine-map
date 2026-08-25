/**
 * The DETAIL PANEL — the second panel, which slides out from behind the main
 * control panel and sits to its right.
 *
 * It is a single running holder for the content that used to live inline inside
 * each layer row: that layer's legend, its About text, and any special controls
 * (currently only the marine species checklist). One section per layer that is
 * switched ON.
 *
 * ORDER is main-panel list order, not toggle order. That falls out of the
 * construction rather than being maintained: every section is built ONCE, up
 * front, and appended in panel order; switching a layer on or off only toggles
 * `is-active` on its section. So a section can never be inserted in the wrong
 * place, and nothing is rebuilt — which is also what lets the species checklist
 * keep its open/closed state and its ticks across any number of toggles.
 *
 * A layer with no legend, no About and no special controls contributes NO
 * section — see `hasContent`. Two layers are in that position today (rivers &
 * waterways, and the inert beach-litter placeholder), and rivers & waterways is
 * the one layer that starts ON. Without this rule the panel would open as an
 * empty shell on first paint, which is exactly what it is asked never to do.
 *
 * Returns { el, sync } — `sync` is called by main.js whenever a toggle changes
 * or the main panel collapses/expands.
 */
import { el } from './dom.js';
import { READERS, READER_GROUPS, CAVEAT_GROUPS, RADIUS_KM } from '../map/briefingReaders.js';

export function buildDetailPanel({ layers, groups, controllers, onStateChange, briefing, base, currentUrl }) {
  const panel = el('aside', 'detail', { 'aria-label': 'Layer details', 'aria-live': 'polite' });
  const body = el('div', 'detail__body');
  panel.appendChild(body);

  const byId = new Map(layers.map((l) => [l.id, l]));

  // Main-panel list order: each group's own layers first, then its subgroups'.
  // This mirrors buildControlPanel's render order exactly; if that ever changes,
  // both must change together.
  const order = [];
  for (const group of groups ?? []) {
    for (const id of group.layerIds ?? []) order.push(id);
    for (const sub of group.subgroups ?? []) for (const id of sub.layerIds ?? []) order.push(id);
  }

  const hasContent = (layer, controller) =>
    Boolean(layer.about || layer.legend || (layer.species && (controller.setChecked || controller.setSpecies)) || (layer.pressures && controller.setWeights));

  // id → { el, isOn } for every section that exists.
  const sections = [];
  /*
   * Everything that must go back to its page-load value when Clear is pressed.
   * Each entry is the section's OWN reset closure, so resetting runs the same
   * code the user's own controls run — the checklist's box handler, the slider
   * group's existing "Reset to equal" — rather than a second route into the
   * same state.
   */
  const resetters = [];

  for (const id of order) {
    const layer = byId.get(id);
    const controller = layer && controllers.get(id);
    if (!controller || !hasContent(layer, controller)) continue;

    const section = el('section', 'detail__section', { 'data-layer': id });

    const head = el('header', 'detail__section-head');
    const swatch = el('span', 'detail__section-swatch', { 'aria-hidden': 'true' });
    if (layer.accentVar) swatch.style.background = `var(--${layer.accentVar})`;
    const title = el('h2', 'detail__section-title');
    /*
     * `detailLabel` exists for layers whose panel label only makes sense under
     * their subgroup heading. The four sea flood toggles are labelled just
     * "Undefended" / "Defended" in the main panel, which reads correctly beneath
     * "Sea flood risk — 1 in 200"; over here there is no subgroup heading, so
     * four sections would otherwise repeat those two words with nothing to tell
     * them apart.
     */
    title.textContent = layer.detailLabel ?? layer.label;
    head.append(swatch, title);
    section.appendChild(head);

    // Special controls first, then legend, then About — the same reading order
    // these had when they were inline in the main panel. Only the About block
    // collapses; the legend and the controls are short and stay visible.
    if (layer.pressures && controller.setWeights) {
      const w = buildWeightSliders(layer, controller, onStateChange);
      section.appendChild(w.el);
      resetters.push(w.reset);
    }
    if (layer.species && controller.setSpecies) section.appendChild(buildSelector(layer, controller));
    if (layer.species && controller.setChecked) {
      const cl = buildSpeciesChecklist(layer, controller, onStateChange);
      section.appendChild(cl.el);
      resetters.push(cl.reset);
    }
    if (layer.legend) section.appendChild(buildLegend(layer.legend));
    const about = layer.about ? buildAbout(layer.about) : null;
    if (about) section.appendChild(about.el);

    body.appendChild(section);
    if (about) resetters.push(() => about.close());
    sections.push({
      el: section,
      about,
      isOn: () => controller.isVisible(),
      // Tracks the off→on edge so the About block can be reset. Seeded from the
      // layer's current state so a default-on layer is not treated as newly on.
      wasOn: controller.isVisible(),
    });
  }

  /*
   * THE SITE BRIEFING SECTION — a section that is not a layer.
   *
   * It is appended AFTER the loop above, so it lands last in the panel and the
   * loop never has to know about it. It joins `sections` with its own `isOn`,
   * which is all `sync` requires, so it opens the panel on its own the moment a
   * pin is dropped. Its reset closure joins `resetters`, so Clear wipes it
   * through the route every other piece of surviving state already uses.
   */
  let briefingApi = null;
  if (briefing) {
    briefingApi = buildBriefingSection({ layers, order, byId, controllers, briefing, base, currentUrl });
    body.appendChild(briefingApi.el);
    sections.push({ el: briefingApi.el, about: null, isOn: () => briefing.getPin() != null, wasOn: false });
    resetters.push(() => briefingApi.clear());
  }

  /**
   * Show the panel only when it has something to say AND the main panel is open.
   * `collapsed` is passed in rather than read, so there is one source of truth
   * for the main panel's state.
   */
  const sync = ({ collapsed }) => {
    // A toggle, a preset or the load button can all change what a briefing is
    // able to report. This is the one place that notices; it re-reads only when
    // the set of loaded layers actually moved.
    briefingApi?.syncLoaded();
    let any = false;
    for (const s of sections) {
      const on = s.isOn();
      /*
       * Switching a layer OFF and back ON returns its About to closed.
       *
       * This has to be done explicitly. Sections are never rebuilt — that is
       * what makes an open About (and the checklist's ticks) survive unrelated
       * toggles and panel collapses — so left alone the open state would also
       * survive an off→on cycle, which is not what a re-opened layer should
       * look like. Only this edge resets it; every other path preserves state.
       */
      if (on && !s.wasOn) s.about?.close();
      s.wasOn = on;
      s.el.classList.toggle('is-active', on);
      if (on) any = true;
    }
    panel.classList.toggle('is-visible', any && !collapsed);
    // Hidden means hidden: nothing here should be reachable by tab or read out
    // while it is tucked behind the main panel.
    panel.setAttribute('aria-hidden', String(!(any && !collapsed)));
    panel.inert = !(any && !collapsed);
  };

  /**
   * Return every section to its page-load state: species unticked, weights
   * equal, disclosures closed. Layer visibility is NOT touched here — that goes
   * through the control panel's applyLayers, so Clear has exactly one route into
   * layer state and this handles only the state that outlives a toggle.
   */
  const reset = () => resetters.forEach((fn) => fn());

  return { el: panel, sync, reset, updateBriefing: (info) => briefingApi?.update(info), briefingText: () => briefingApi?.asText() ?? '' };
}

/**
 * STAGE ONE BRIEFING SHELL. The mechanism and the enumeration, not the content.
 *
 * What it proves: that the shell can enumerate EVERY layer in control-panel
 * order — including the two inert placeholder toggles, beach litter and
 * shellfish water quality, which have no data anywhere and will still need a
 * line each saying so — and that it can tell which of them are currently
 * loaded, because a briefing reads from loaded data.
 */
function buildBriefingSection({ layers, order, byId, controllers, briefing, base, currentUrl }) {
  const root = el('section', 'detail__section detail__section--briefing', { 'data-briefing': 'true' });

  const head = el('header', 'detail__section-head');
  const swatch = el('span', 'detail__section-swatch', { 'aria-hidden': 'true' });
  swatch.style.background = 'var(--accent)';
  const title = el('h2', 'detail__section-title');
  title.textContent = 'Site briefing';
  head.append(swatch, title);
  root.appendChild(head);

  const where = el('p', 'briefing__where');
  const radius = el('p', 'briefing__radius');
  root.append(where, radius);

  const loadNote = el('p', 'briefing__loadnote');
  const actions = el('div', 'briefing__actions');
  const loadBtn = el('button', 'briefing__loadbtn', { type: 'button' });
  const LOAD_LABEL = 'Load their data';
  loadBtn.textContent = LOAD_LABEL;
  /*
   * Layers are NOT auto-loaded. Fetching a dozen layers behind someone's back
   * would download several megabytes they did not ask for. The briefing says
   * which are missing and offers the button.
   *
   * IT LOADS; IT DOES NOT SWITCH ANYTHING ON. Twenty layers drawn at once —
   * four flood extents, seabed, recreational and compound pressure — stack into
   * one purple wash and the map stops meaning anything. A briefing reads from
   * loaded data and does not need the layers drawn, so the toggles are left in
   * whatever state their owner set them: loading is not a viewing decision.
   *
   * Then it RE-READS. Nothing else does: the readers ran once when the pin was
   * dropped, and without this the rows would sit at "not loaded" over data that
   * had just arrived.
   */
  loadBtn.addEventListener('click', async () => {
    loadBtn.disabled = true;
    loadBtn.textContent = 'Loading…';
    await Promise.all(order.map((id) => controllers.get(id)?.load?.() ?? Promise.resolve()));
    loadBtn.textContent = LOAD_LABEL;
    loadBtn.disabled = false;
    refresh();
  });
  const copyBtn = el('button', 'briefing__loadbtn', { type: 'button' });
  copyBtn.textContent = 'Copy as text';
  actions.append(loadBtn, copyBtn);
  root.append(loadNote, actions);

  const list = el('ul', 'briefing__list');
  const rows = new Map();
  /* A grouped reader takes the place of its FIRST member in panel order and
   * swallows the others, so the four sea flood extents occupy one row where
   * they occupied four. Order is otherwise untouched. */
  const groupOf = new Map();
  for (const g of READER_GROUPS) for (const m of g.members) groupOf.set(m, g);
  const seen = new Set();
  for (const id of order) {
    const group = groupOf.get(id);
    if (group) {
      if (seen.has(group.id)) continue;
      seen.add(group.id);
    }
    const layer = byId.get(id);
    if (!layer && !group) continue;
    const rowId = group ? group.id : id;
    const label = group ? group.label : (layer.detailLabel ?? layer.label);
    const li = el('li', 'briefing__row');
    const name = el('span', 'briefing__row-name');
    name.textContent = label;
    const state = el('span', 'briefing__row-state');
    state.textContent = 'pending';
    const detail = el('ul', 'briefing__row-items');
    li.append(name, state, detail);
    list.appendChild(li);
    rows.set(rowId, { li, state, detail, label, group: group ?? null });
  }
  /**
   * HOW TO READ THESE FIGURES — every reporting layer's caveat, in one place.
   *
   * Closed by default and rebuilt on every pin, so it never carries a note from
   * a layer that is no longer reporting. Closed is a display choice only: the
   * copied text carries all of them in full whatever this is doing.
   */
  const notes = el('details', 'briefing__notes');
  const notesSummary = el('summary', 'briefing__notes-summary');
  const notesList = el('ul', 'briefing__notes-list');
  notes.append(notesSummary, notesList);
  notes.hidden = true;

  /** The notes that apply at this pin, bucketed by CAVEAT_GROUPS and in that
   *  order. A layer missing from the taxonomy falls to the end under its own
   *  heading rather than being dropped — a note that exists must be shown. */
  const collectNotes = (results) => {
    const taken = new Set();
    const out = [];
    for (const g of CAVEAT_GROUPS) {
      const items = [];
      for (const id of g.ids) {
        const c = results.get(id)?.caveat;
        if (!c) continue;
        taken.add(id);
        items.push([rows.get(id)?.label ?? id, c]);
      }
      if (items.length) out.push([g.label, items]);
    }
    const orphans = [];
    for (const [id, r] of rows) {
      const c = results.get(id)?.caveat;
      if (c && !taken.has(id)) orphans.push([r.label, c]);
    }
    if (orphans.length) out.push(['Other notes', orphans]);
    return out;
  };

  const renderNotes = (results) => {
    const groups = collectNotes(results);
    const total = groups.reduce((t, [, items]) => t + items.length, 0);
    notes.hidden = total === 0;
    notes.open = false;
    notesSummary.textContent =
      `${total} ${total === 1 ? 'note' : 'notes'} on how to read these figures`;
    notesList.replaceChildren();
    for (const [heading, items] of groups) {
      const head = el('li', 'briefing__note-head');
      head.textContent = heading;
      notesList.appendChild(head);
      for (const [label, text] of items) {
        const li = el('li', 'briefing__note');
        const who = el('span', 'briefing__note-layer');
        who.textContent = label;
        li.append(who, document.createTextNode(text));
        notesList.appendChild(li);
      }
    }
  };

  root.append(list, notes);

  /* Last rendered state, kept so "Copy as text" reproduces exactly what is on
   * screen rather than re-deriving it and risking a different answer. */
  let snapshot = null;

  const STATUS_TEXT = {
    'no-data': 'no data anywhere in the corridor',
    'not-loaded': 'not loaded',
    pending: 'pending',
  };

  const render = (id, result) => {
    const r = rows.get(id);
    if (!r) return;
    r.state.textContent = result.summary ?? STATUS_TEXT[result.status] ?? result.status;
    r.li.dataset.status = result.status;
    r.detail.replaceChildren();
    for (const item of result.items ?? []) {
      const li = el('li', 'briefing__item');
      li.textContent = item;
      r.detail.appendChild(li);
    }
    if (result.more) {
      const li = el('li', 'briefing__item briefing__item--more');
      li.textContent = `… and ${result.more} more`;
      r.detail.appendChild(li);
    }
    if (result.note) {
      const li = el('li', 'briefing__item briefing__item--more');
      li.textContent = result.note;
      r.detail.appendChild(li);
    }
    // The caveat does NOT go on the row. With twenty layers reporting, a note
    // under each one buries the figures it is meant to qualify. They collect
    // into one disclosure below, counted in its label so nobody has to guess
    // whether there are notes to read.
  };

  /*
   * WHETHER A READER MAY READ, which is no longer the same question as whether
   * the layer is drawn.
   *
   * It used to be `isVisible()`, because loading and showing were the same act.
   * They are not any more: "Load their data" fetches without drawing, so the
   * gate is `isLoaded()`. One consequence is deliberate — a layer switched on
   * and then off again stays loaded and keeps reporting. The data is there and
   * the reader can read it, and the alternative (remembering how each layer
   * came to be loaded) would let two identically loaded layers give different
   * answers.
   */
  const layerLoaded = (id) => {
    if (READERS[id]?.needsLayer === false) return true;
    return Boolean(controllers.get(id)?.isLoaded?.());
  };
  /** As above, but for a ROW — which may stand for several layers (the four sea
   *  flood extents) or for none (a placeholder with nothing to fetch). */
  const rowLoaded = (rowId) => {
    const g = rows.get(rowId)?.group;
    if (g) return g.members.some((m) => controllers.get(m)?.isLoaded?.());
    return layerLoaded(rowId);
  };

  /** One token per pin, so a slow read from an abandoned pin cannot paint over
   *  the current one. */
  let token = 0;

  /*
   * The last info `update` was given, so a re-read can repaint without it being
   * passed again. Held rather than defaulted: the place name arrives from an
   * async lookup after the first paint, and a re-read that dropped it would
   * blank the line that names where the pin is.
   */
  let lastInfo = {};

  /** Re-read every layer at the current pin with the info already in hand. */
  const refresh = () => paint(lastInfo);

  /*
   * Re-read when the SET OF LOADED LAYERS changes, and only then.
   *
   * A toggle, a preset or the load button can all change what a briefing is
   * able to report, and until now none of them re-read it — the rows sat at
   * whatever they said when the pin was dropped. Comparing a signature rather
   * than re-reading on every sync keeps that from running seventeen readers
   * again each time an unrelated panel state changes.
   */
  let loadedSig = null;
  const loadedSignature = () => order.map((id) => (layerLoaded(id) ? '1' : '0')).join('');
  const syncLoaded = () => {
    const sig = loadedSignature();
    if (sig === loadedSig) return;
    loadedSig = sig;
    if (briefing.getPin()) refresh();
  };

  const update = (info) => paint(info ?? {});

  const paint = (info) => {
    lastInfo = info;
    loadedSig = loadedSignature();
    const pin = briefing.getPin();
    if (!pin) return;
    const mine = ++token;
    const [lon, lat] = pin;
    const coords = `${lat.toFixed(4)}°N, ${Math.abs(lon).toFixed(4)}°${lon < 0 ? 'W' : 'E'}`;
    where.textContent = info?.place ? `${coords}\n${info.place}` : coords;
    radius.textContent = `Reporting on everything within ${RADIUS_KM} km of this point.`;

    /* A row may stand for several layers, and a placeholder stands for none —
     * it has nothing to fetch, so "not loaded" would be meaningless for it. */
    const readerFor = (id) => rows.get(id)?.group ?? READERS[id];

    const off = order.filter((id) => !layerLoaded(id));
    loadNote.textContent = off.length
      ? `${off.length} of ${order.length} layers are not loaded. A briefing reads from loaded data, so those cannot be`
        + ' reported on yet. Loading fetches their data; it does not switch the layers on.'
      : 'Every layer is loaded.';
    loadBtn.hidden = off.length === 0;

    const results = new Map();
    const pending = [];
    for (const [id, r] of rows) {
      r.li.classList.toggle('is-off', !rowLoaded(id));
      const reader = readerFor(id);
      let result;
      if (!rowLoaded(id)) result = { status: 'not-loaded', items: [] };
      else if (!reader) result = { status: 'pending', items: [] };
      else {
        result = { status: 'reading', summary: 'reading…', items: [] };
        pending.push(
          reader.read(pin, { base, controllers }).then(
            (out) => { if (mine === token) { results.set(id, out); render(id, out); } },
            (err) => {
              const out = { status: 'unavailable', summary: `could not be read (${err.message})`, items: [] };
              if (mine === token) { results.set(id, out); render(id, out); }
            },
          ),
        );
      }
      results.set(id, result);
      render(id, result);
    }
    snapshot = { coords, place: info?.place ?? null, results };
    renderNotes(results);
    Promise.all(pending).then(() => {
      if (mine !== token) return;
      snapshot = { coords, place: info?.place ?? null, results };
      // Re-run once the async readers have landed: a caveat belongs to a layer
      // that reported, and until they resolve we do not know which those are.
      renderNotes(results);
    });
  };

  /**
   * COPY AS TEXT — the whole briefing, silent layers included.
   *
   * Every line is carried, because a briefing that quietly dropped its silences
   * when pasted into an email would lose the half of it that is the point.
   */
  const asText = () => {
    if (!snapshot) return '';
    const lines = ['SITE BRIEFING', snapshot.coords];
    if (snapshot.place) lines.push(snapshot.place);
    lines.push(`Everything within ${RADIUS_KM} km of this point.`);

    /* WHEN, and WHERE TO GO BACK TO. A pasted briefing outlives the tab it came
     * from: the live discharge layer changes by the hour and the annual return
     * is replaced each year, so an undated figure eventually becomes a wrong
     * one. The link carries the pin, so the reader lands on this exact spot
     * rather than on a map of the whole south coast. */
    lines.push(`Generated ${new Date().toLocaleString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })}`);
    const href = currentUrl?.() ?? window.location.href;
    if (href) lines.push(href);
    lines.push('');

    for (const [id, r] of rows) {
      const res = snapshot.results.get(id) ?? { status: 'pending' };
      lines.push(`${r.label}: ${res.summary ?? STATUS_TEXT[res.status] ?? res.status}`);
      for (const item of res.items ?? []) lines.push(`    ${item}`);
      if (res.more) lines.push(`    … and ${res.more} more`);
      if (res.note) lines.push(`    ${res.note}`);
    }
    const caveats = collectNotes(snapshot.results);

    /* The caveats go in WHATEVER the disclosure on screen is doing. Collapsing
     * them is a way of keeping the panel readable; dropping them from a pasted
     * briefing would be a way of shipping figures without their limits. */
    if (caveats.length) {
      lines.push('', 'HOW TO READ THESE FIGURES');
      for (const [heading, items] of caveats) {
        lines.push('', `  ${heading}`);
        for (const [label, text] of items) lines.push(`    ${label}: ${text}`);
      }
    }

    lines.push('', 'South Coast Marine Recovery Map. Figures are per layer; no relationship between layers is implied.');
    return lines.join('\n');
  };

  copyBtn.addEventListener('click', async () => {
    const text = asText();
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = 'Copied';
    } catch {
      copyBtn.textContent = 'Copy failed';
    }
    setTimeout(() => { copyBtn.textContent = 'Copy as text'; }, 1800);
  });

  return {
    el: root,
    update,
    syncLoaded,
    asText,
    clear: () => {
      loadBtn.hidden = true;
      snapshot = null;
      notes.hidden = true;
      notes.open = false;
      lastInfo = {};
      loadedSig = null;
    },
  };
}

function buildAbout({ body }) {
  const root = el('div', 'detail__about');

  const headBtn = el('button', 'detail__about-head', { type: 'button', 'aria-expanded': 'false' });
  headBtn.append(el('span', 'detail__about-caret', { 'aria-hidden': 'true' }));
  const label = el('span', 'detail__about-title');
  label.textContent = 'About';
  headBtn.appendChild(label);

  const bodyEl = el('div', 'detail__about-body');
  const inner = el('div', 'detail__about-inner');
  for (const para of body) {
    const p = el('p', 'detail__about-para');
    p.textContent = para;
    inner.appendChild(p);
  }
  bodyEl.appendChild(inner);

  root.append(headBtn, bodyEl);

  // Closed by default, and independent of every other section: `open` is a
  // local of this closure, so nothing here is shared between layers.
  let open = false;
  const apply = () => {
    root.classList.toggle('is-open', open);
    headBtn.setAttribute('aria-expanded', String(open));
  };
  headBtn.addEventListener('click', () => {
    open = !open;
    apply();
  });
  apply();

  return {
    el: root,
    close: () => {
      open = false;
      apply();
    },
  };
}

/** A small colour-swatch legend. */
function buildLegend(items) {
  const root = el('div', 'detail__legend');
  for (const it of items) {
    const row = el('span', 'detail__legend-item');
    const sw = el('span', 'detail__legend-swatch', { 'aria-hidden': 'true' });
    sw.style.background = `var(--${it.colorVar})`;
    const lb = el('span', 'detail__legend-label');
    lb.textContent = it.label;
    row.append(sw, lb);
    root.appendChild(row);
  }
  return root;
}

/**
 * The multi-select species CHECKLIST — moved here wholesale, behaviour untouched.
 *
 * It KEEPS its own open/closed disclosure, unlike the About text. That is not an
 * inconsistency: 18 rows shown unconditionally would swamp every other section
 * in the panel, and the brief is that this control goes on working exactly as it
 * does now. Ticking a species is still what fetches it, so an untouched list
 * still costs nothing.
 */
function buildSpeciesChecklist(layer, controller, onStateChange) {
  const root = el('div', 'detail__checklist');

  const headBtn = el('button', 'detail__checklist-head', { type: 'button', 'aria-expanded': 'false' });
  headBtn.append(el('span', 'detail__checklist-caret', { 'aria-hidden': 'true' }));
  const titleEl = el('span', 'detail__checklist-title');
  titleEl.textContent = 'Choose species';
  headBtn.appendChild(titleEl);
  const countEl = el('span', 'detail__checklist-count');
  headBtn.appendChild(countEl);

  const bodyEl = el('div', 'detail__checklist-body');
  const inner = el('div', 'detail__checklist-inner');

  const boxes = [];
  const groups = layer.speciesGroups?.length ? layer.speciesGroups : [{ key: null, label: null }];

  for (const g of groups) {
    const members = layer.species.filter((sp) => (g.key ? sp.group === g.key : true));
    if (!members.length) continue;
    if (g.label) {
      const h = el('p', 'detail__checklist-group');
      h.textContent = g.label;
      inner.appendChild(h);
    }
    for (const sp of members) {
      const id = `sp-${layer.id}-${sp.key}`;
      const row = el('label', 'detail__checklist-row');
      row.setAttribute('for', id);

      const box = el('input', 'detail__checklist-box', { type: 'checkbox', id });
      box.checked = controller.isChecked(sp.key);

      const sw = el('span', 'detail__checklist-swatch', { 'aria-hidden': 'true' });
      if (sp.colorVar) sw.style.background = `var(--${sp.colorVar})`;

      const text = el('span', 'detail__checklist-text');
      const common = el('span', 'detail__checklist-common');
      common.textContent = sp.common;
      const sci = el('span', 'detail__checklist-sci');
      sci.textContent = sp.sci;
      text.append(common, sci);

      // One path for a click and for a programmatic reset.
      const applyBox = (want) => {
        if (box.checked === want && controller.isChecked(sp.key) === want) return;
        box.checked = want;
        controller.setChecked(sp.key, want);
        renderCount();
        onStateChange?.();
      };
      box.addEventListener('change', () => applyBox(box.checked));
      boxes.push(applyBox);

      row.append(box, sw, text);
      inner.appendChild(row);
    }
  }

  bodyEl.appendChild(inner);
  root.append(headBtn, bodyEl);

  const renderCount = () => {
    const n = controller.checkedKeys().length;
    countEl.textContent = n ? `${n} of ${layer.species.length}` : `none of ${layer.species.length}`;
  };
  renderCount();

  let open = false;
  const apply = () => {
    root.classList.toggle('is-open', open);
    headBtn.setAttribute('aria-expanded', String(open));
  };
  headBtn.addEventListener('click', () => {
    open = !open;
    apply();
  });
  apply();

  return {
    el: root,
    /*
     * Page-load state for this control: nothing ticked, disclosure closed.
     *
     * Ticks are cleared through each box's own applyBox(), the same closure a
     * click on that box runs, so the controller, the count label and the URL all
     * update exactly as if the user had unticked all eighteen by hand.
     *
     * Deliberately NOT what presets do: presets leave ticks alone so a species
     * selection survives switching views. Clear is the one action that wipes.
     */
    reset: () => {
      boxes.forEach((applyBox) => applyBox(false));
      open = false;
      apply();
    },
  };
}


/**
 * The compound pressure WEIGHT SLIDERS.
 *
 * Five sliders, one per pressure, equal by default — because there is no
 * scientifically correct default and pretending otherwise would be the whole
 * problem with this layer. The reset control restores that equal weighting
 * rather than any "recommended" one, for the same reason.
 *
 * `input` fires continuously during a drag, and the renderer only calls
 * setPaintProperty, so the map follows the thumb without a re-parse.
 */
function buildWeightSliders(layer, controller, onStateChange) {
  const root = el('div', 'detail__weights');

  const head = el('div', 'detail__weights-head');
  const title = el('span', 'detail__weights-title');
  title.textContent = 'Weighting';
  const reset = el('button', 'detail__weights-reset', { type: 'button' });
  reset.textContent = 'Reset to equal';
  head.append(title, reset);
  root.appendChild(head);

  const note = el('p', 'detail__weights-note');
  note.textContent = 'No weighting here is more correct than another — that judgement is yours.';
  root.appendChild(note);

  const rows = [];
  for (const pr of layer.pressures) {
    const row = el('label', 'detail__weight-row');
    const lab = el('span', 'detail__weight-label');
    const sw = el('span', 'detail__weight-swatch', { 'aria-hidden': 'true' });
    if (pr.colorVar) sw.style.background = `var(--${pr.colorVar})`;
    const txt = el('span', 'detail__weight-name');
    txt.textContent = pr.label;
    const out = el('span', 'detail__weight-value');
    lab.append(sw, txt, out);

    const input = el('input', 'detail__weight-input', {
      type: 'range', min: '0', max: '3', step: '0.1', value: '1',
      'aria-label': `Weight for ${pr.label}`,
    });
    input.addEventListener('input', () => {
      out.textContent = Number(input.value).toFixed(1);
      controller.setWeights({ [pr.key]: Number(input.value) });
      onStateChange?.();
    });
    // Seeded from the CONTROLLER, not hardcoded, so a weight restored from the
    // URL before the panel is built shows up on the slider rather than silently
    // disagreeing with the map.
    const start = controller.getWeights?.()[pr.key] ?? 1;
    input.value = String(start);
    out.textContent = Number(start).toFixed(1);
    row.append(lab, input);
    root.appendChild(row);
    rows.push({ key: pr.key, input, out });
  }

  const toEqual = () => {
    const eq = {};
    for (const r of rows) { r.input.value = '1'; r.out.textContent = '1.0'; eq[r.key] = 1; }
    controller.setWeights(eq);
    onStateChange?.();
  };
  reset.addEventListener('click', toEqual);

  // Equal weighting IS the page-load state, so Clear reuses the same closure the
  // visible "Reset to equal" button runs.
  return { el: root, reset: toEqual };
}

/**
 * The single-species dropdown, for the one-species-at-a-time grid layer. Only
 * the dormant Dorset `species` layer uses it, so it renders nowhere while
 * SHOW_DORSET_LAND_LAYERS is false — kept working so flipping that flag back
 * restores the layer whole.
 */
function buildSelector(layer, controller) {
  const root = el('div', 'detail__selector');

  const select = el('select', 'detail__selector-input', { 'aria-label': 'Choose species' });
  for (const s of layer.species) {
    const opt = el('option');
    opt.value = s.key;
    opt.textContent = s.common;
    select.appendChild(opt);
  }
  select.value = controller.getSpecies();

  const name = el('p', 'detail__selector-name');
  const sci = el('span', 'detail__selector-sci');
  const render = (key) => {
    const s = layer.species.find((x) => x.key === key);
    name.textContent = s ? s.common + ' · ' : '';
    sci.textContent = s ? s.sci : '';
    name.appendChild(sci);
  };
  render(select.value);

  select.addEventListener('change', () => {
    controller.setSpecies(select.value);
    render(select.value);
  });

  root.append(select, name);
  return root;
}
