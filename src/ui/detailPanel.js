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

export function buildDetailPanel({ layers, groups, controllers, onStateChange }) {
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
    if (layer.pressures && controller.setWeights) section.appendChild(buildWeightSliders(layer, controller, onStateChange));
    if (layer.species && controller.setSpecies) section.appendChild(buildSelector(layer, controller));
    if (layer.species && controller.setChecked) section.appendChild(buildSpeciesChecklist(layer, controller, onStateChange));
    if (layer.legend) section.appendChild(buildLegend(layer.legend));
    const about = layer.about ? buildAbout(layer.about) : null;
    if (about) section.appendChild(about.el);

    body.appendChild(section);
    sections.push({
      el: section,
      about,
      isOn: () => controller.isVisible(),
      // Tracks the off→on edge so the About block can be reset. Seeded from the
      // layer's current state so a default-on layer is not treated as newly on.
      wasOn: controller.isVisible(),
    });
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

  return { el: panel, sync };
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

      box.addEventListener('change', () => {
        controller.setChecked(sp.key, box.checked);
        renderCount();
        onStateChange?.();
      });

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

  return root;
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

  reset.addEventListener('click', () => {
    const eq = {};
    for (const r of rows) { r.input.value = '1'; r.out.textContent = '1.0'; eq[r.key] = 1; }
    controller.setWeights(eq);
    onStateChange?.();
  });

  return root;
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
