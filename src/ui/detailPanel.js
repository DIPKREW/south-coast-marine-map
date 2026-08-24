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

export function buildDetailPanel({ layers, groups, controllers, onStateChange, briefing }) {
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
    briefingApi = buildBriefingSection({ layers, order, byId, controllers, briefing });
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

  return { el: panel, sync, reset, updateBriefing: (info) => briefingApi?.update(info) };
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
function buildBriefingSection({ layers, order, byId, controllers, briefing }) {
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
  const loadBtn = el('button', 'briefing__loadbtn', { type: 'button' });
  loadBtn.textContent = 'Load them';
  /*
   * Layers are NOT auto-loaded. Switching a dozen layers on behind someone's
   * back would download several megabytes they did not ask for and change the
   * map under them. The briefing says which are missing and offers the button.
   */
  loadBtn.addEventListener('click', () => {
    for (const id of order) controllers.get(id)?.show?.();
  });
  root.append(loadNote, loadBtn);

  const list = el('ul', 'briefing__list');
  const rows = new Map();
  for (const id of order) {
    const layer = byId.get(id);
    if (!layer) continue;
    const li = el('li', 'briefing__row');
    const name = el('span', 'briefing__row-name');
    name.textContent = layer.detailLabel ?? layer.label;
    const state = el('span', 'briefing__row-state');
    state.textContent = 'pending';
    li.append(name, state);
    list.appendChild(li);
    rows.set(id, { li, state });
  }
  root.appendChild(list);

  const update = (info) => {
    const pin = briefing.getPin();
    if (!pin) return;
    const [lon, lat] = pin;
    const coords = `${lat.toFixed(4)}°N, ${Math.abs(lon).toFixed(4)}°${lon < 0 ? 'W' : 'E'}`;
    // Coordinates lead. Any name is a SECOND line and is labelled for what it
    // is — the nearest named feature, not a place name; see placeLookup.js.
    where.textContent = info?.place ? `${coords}\n${info.place}` : coords;
    radius.textContent = `Reporting on everything within ${briefing.radiusKm} km of this point.`;
    const off = order.filter((id) => !controllers.get(id)?.isVisible?.());
    for (const [id, r] of rows) {
      const on = controllers.get(id)?.isVisible?.();
      r.state.textContent = 'pending';
      r.li.classList.toggle('is-off', !on);
    }
    loadNote.textContent = off.length
      ? `${off.length} of ${rows.size} layers are not loaded. A briefing reads from loaded data, so those cannot be reported on yet.`
      : 'Every layer is loaded.';
    loadBtn.hidden = off.length === 0;
  };

  return { el: root, update, clear: () => { loadBtn.hidden = true; } };
}

/**
 * A layer's About text, behind a chevron and CLOSED by default.
 *
 * The prose is the long part of a section — one to three paragraphs each — and
 * with several layers on it pushed everything below it off the bottom of the
 * panel. The legend and the species checklist stay visible unconditionally;
 * only this collapses.
 *
 * The disclosure is the same one the old inline main-panel About used (and that
 * the species checklist still uses): a caret that rotates, and a grid-rows
 * transition that animates intrinsic height. Its styling is shared with the
 * checklist's rather than duplicated — see the grouped selectors in style.css.
 *
 * The registry's authored `title` is deliberately NOT rendered: the section is
 * already headed by the layer's name, so "About marine protected areas" under
 * "Marine protected areas" said it twice. The label is a plain "About" instead.
 * Only that heading string is dropped — every paragraph of the prose is copied
 * verbatim, and several are still marked "proposed, for review", so this remains
 * a relocation rather than an approval of any pending wording.
 */
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
