/**
 * @see buildBriefingPane below. Split out of detailPanel.js when the briefing
 * became a pane in its own right rather than a section inside another one.
 */
import { el } from './dom.js';
import { READERS, READER_GROUPS, CAVEAT_GROUPS, RADIUS_KM } from '../map/briefingReaders.js';

/**
 * THE SITE BRIEFING PANE — what every layer says at one point, and what every
 * layer is silent about there.
 *
 * IT HAS ITS OWN PANE because it stopped fitting in the detail panel. It used to
 * be a section appended after every layer's legend, which put it at offsetTop
 * 2808px inside an 810px-tall pane: three and a half panes of scrolling to reach
 * the thing you had just asked for.
 *
 * IT TAKES THE DETAIL PANEL'S SLOT rather than opening beside it. Three panes do
 * not fit — the control panel is 312px and the detail panel 330px, so a third
 * would end at x=1014 and leave 10px of map at 1024 wide. So the detail panel
 * yields while a briefing is open, and both panes occupy exactly the same
 * 330px slot at exactly the same coordinates.
 *
 * NOTHING IS STORED TO MAKE THAT REVERSIBLE. The detail panel's visibility is
 * recomputed on every sync from `any && !collapsed`, and its aria-hidden and
 * inert flags come off the same expression; this adds `&& !briefingOpen` to it.
 * So "the detail panel comes back afterwards" is not implemented at all — there
 * is no saved state, and therefore no saved state to restore wrongly.
 *
 * It enumerates EVERY layer in control-panel order, including the two inert
 * placeholders — beach litter and shellfish water quality — which have no data
 * anywhere in the corridor and say so in a line each.
 */
export function buildBriefingPane({ order, byId, controllers, briefing, base, currentUrl }) {
  const root = el('aside', 'briefing-pane', { 'aria-label': 'Site briefing', 'aria-live': 'polite' });

  const head = el('header', 'detail__section-head');
  const swatch = el('span', 'detail__section-swatch', { 'aria-hidden': 'true' });
  swatch.style.background = 'var(--accent)';
  const title = el('h2', 'detail__section-title');
  title.textContent = 'Site briefing';
  head.append(swatch, title);
  root.appendChild(head);

  // Only this scrolls, so the heading and the pin's coordinates stay put.
  const body = el('div', 'briefing-pane__body');
  root.appendChild(body);

  const where = el('p', 'briefing__where');
  const radius = el('p', 'briefing__radius');
  body.append(where, radius);

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
  body.append(loadNote, actions);

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

  body.append(list, notes);

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

  /**
   * Open exactly while there is a pin, and never while the control panel is
   * collapsed — the same rule the detail panel follows, for the same reason:
   * a collapsed panel means the map is being used, and a pane floating beside
   * a 46px tab is chrome nobody asked for.
   *
   * `syncLoaded` rides along here because the same call happens on every toggle,
   * preset and Clear, which is exactly when what a briefing can report changes.
   */
  const sync = ({ collapsed = false } = {}) => {
    syncLoaded();
    const show = briefing.getPin() != null && !collapsed;
    root.classList.toggle('is-visible', show);
    root.setAttribute('aria-hidden', String(!show));
    root.inert = !show;
  };

  return {
    el: root,
    update,
    sync,
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

