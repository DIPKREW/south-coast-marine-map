/**
 * The single floating control panel (top-left). Holds the wordmark + tagline
 * and the layer toggles, grouped, rendered from the data layer config — so new
 * layers and groups appear here automatically.
 *
 * A group may declare an `about` drop-down: a short explanation that expands
 * beneath the group's toggles whenever any of its layers is on, with a caret to
 * collapse/expand manually. It auto-expands when the group is (re)activated and
 * hides when every layer in the group is off.
 *
 * The panel COLLAPSES to a small icon tab in the same corner, so it never covers
 * the map. Collapsing only sets a class — the body is `display: none`, never
 * rebuilt — so toggle positions and per-section about states survive a
 * collapse/expand round trip for free.
 *
 * Returns a handle: { el, collapse, expand, isCollapsed } — `el` is the element
 * to mount, the rest lets the caller (main.js) collapse on map interaction.
 */
export function buildControlPanel({ layers, groups, controllers, wordmark, tagline }) {
  const panel = el('section', 'panel', { role: 'region', 'aria-label': `${wordmark} controls` });
  const byId = new Map(layers.map((l) => [l.id, l]));

  // ---- Masthead ----
  const head = el('header', 'panel__head');
  const headText = el('div', 'panel__head-text');
  const mark = el('h1', 'panel__wordmark');
  mark.textContent = wordmark;
  const tag = el('p', 'panel__tagline');
  tag.textContent = tagline;
  headText.append(mark, tag);

  // Collapse control, top-right of the header. When collapsed the panel shrinks
  // to this button, so the button *is* the tab that reopens it — click only, no
  // hover, so it never fights the map's own hover cards.
  const bodyId = 'panel-body';
  const collapseBtn = el('button', 'panel__collapse', {
    type: 'button',
    'aria-expanded': 'true',
    'aria-controls': bodyId,
  });
  collapseBtn.appendChild(el('span', 'panel__collapse-icon', { 'aria-hidden': 'true' }));

  head.append(headText, collapseBtn);
  panel.appendChild(head);

  // Everything below the masthead lives in the scrollable, collapsible body.
  const body = el('div', 'panel__body', { id: bodyId });
  panel.appendChild(body);

  // ---- Layer toggles, grouped ----
  const groupDefs = groups?.length ? groups : [{ label: 'Layers', layerIds: layers.map((l) => l.id) }];

  for (const group of groupDefs) {
    const section = el('div', 'panel__group');
    const heading = el('p', 'panel__section-label');
    heading.textContent = group.label;
    section.appendChild(heading);

    const groupIds = [];
    // Functions re-run whenever any toggle in the group changes (legends, about).
    const syncers = [];
    const runSyncers = () => syncers.forEach((fn) => fn());

    for (const id of group.layerIds) {
      const layer = byId.get(id);
      const controller = layer && controllers.get(id);
      if (!controller) continue;
      groupIds.push(id);
      section.appendChild(buildToggle(layer, controller, runSyncers));

      // Optional per-layer species selector (one species at a time).
      if (layer.species && controller.setSpecies) {
        const selector = buildSelector(layer, controller);
        section.appendChild(selector.el);
        const sync = () => selector.setVisible(controller.isVisible());
        syncers.push(sync);
        sync();
      }

      // Optional per-layer legend, shown only while that layer is on.
      if (layer.legend) {
        const legend = buildLegend(layer.legend);
        section.appendChild(legend.el);
        const sync = () => legend.setVisible(controller.isVisible());
        syncers.push(sync);
        sync();
      }

      // Optional per-layer about drop-down, shown only while that layer is on.
      if (layer.about) {
        const about = buildAbout(layer.about);
        section.appendChild(about.el);
        let wasOn = controller.isVisible();
        const sync = () => {
          const on = controller.isVisible();
          if (on && !wasOn) about.open(); // re-activated → expand
          about.setVisible(on);
          wasOn = on;
        };
        syncers.push(sync);
        sync();
      }
    }
    if (!groupIds.length) continue;

    // Optional explanation drop-down for the whole group.
    if (group.about) {
      const about = buildAbout(group.about);
      section.appendChild(about.el);

      const isActive = () => groupIds.some((id) => controllers.get(id).isVisible());
      let wasActive = isActive();
      const sync = () => {
        const active = isActive();
        if (active && !wasActive) about.open(); // re-activated → expand
        about.setVisible(active);
        wasActive = active;
      };
      syncers.push(sync);
      sync(); // initial state
    }

    body.appendChild(section);
  }

  // ---- Collapse / expand ----
  let collapsed = false;
  const apply = () => {
    panel.classList.toggle('is-collapsed', collapsed);
    collapseBtn.setAttribute('aria-expanded', String(!collapsed));
    const label = collapsed ? 'Show layer controls' : 'Hide layer controls';
    collapseBtn.setAttribute('aria-label', label);
    collapseBtn.setAttribute('title', label);
  };

  const setCollapsed = (next) => {
    if (next === collapsed) return;
    collapsed = next;
    apply();
  };

  collapseBtn.addEventListener('click', () => setCollapsed(!collapsed));
  apply();

  return {
    el: panel,
    collapse: () => setCollapsed(true),
    expand: () => setCollapsed(false),
    isCollapsed: () => collapsed,
  };
}

function buildToggle(layer, controller, onChange) {
  const row = el('label', 'toggle');
  row.setAttribute('for', `toggle-${layer.id}`);
  if (layer.accentVar) row.style.setProperty('--toggle-accent', `var(--${layer.accentVar})`);

  const text = el('span', 'toggle__text');
  const label = el('span', 'toggle__label');
  label.textContent = layer.label;
  text.appendChild(label);
  if (layer.description) {
    const desc = el('span', 'toggle__desc');
    desc.textContent = layer.description;
    text.appendChild(desc);
  }

  const input = el('input', 'toggle__input', { type: 'checkbox', id: `toggle-${layer.id}` });
  input.checked = controller.isVisible();
  input.setAttribute('role', 'switch');
  input.setAttribute('aria-checked', String(input.checked));

  const track = el('span', 'toggle__track', { 'aria-hidden': 'true' });
  track.appendChild(el('span', 'toggle__thumb'));

  input.addEventListener('change', () => {
    if (input.checked) controller.show();
    else controller.hide();
    input.setAttribute('aria-checked', String(input.checked));
    onChange?.();
  });

  // Layers that finish setting up after the panel is built (e.g. the PMTiles
  // fetch): re-sync legends/abouts when ready; grey the row out on failure.
  controller.onReady?.(() => onChange?.());
  controller.onUnavailable?.(() => {
    input.checked = false;
    input.disabled = true;
    input.setAttribute('aria-checked', 'false');
    row.classList.add('is-unavailable');
    onChange?.();
  });

  row.append(text, input, track);
  return row;
}

function buildAbout({ title, body }) {
  const root = el('div', 'panel__about');

  const headBtn = el('button', 'panel__about-head', { type: 'button', 'aria-expanded': 'true' });
  headBtn.append(el('span', 'panel__about-caret', { 'aria-hidden': 'true' }));
  const titleEl = el('span', 'panel__about-title');
  titleEl.textContent = title;
  headBtn.appendChild(titleEl);

  const bodyEl = el('div', 'panel__about-body');
  const inner = el('div', 'panel__about-inner');
  for (const para of body) {
    const p = el('p', 'panel__about-para');
    p.textContent = para;
    inner.appendChild(p);
  }
  bodyEl.appendChild(inner);

  root.append(headBtn, bodyEl);

  let open = true;
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
    open: () => {
      open = true;
      apply();
    },
    setVisible: (visible) => root.classList.toggle('is-active', visible),
  };
}

// A species selector (dropdown) + the current species' common + scientific name,
// shown only while its layer is on. Changing it calls controller.setSpecies.
function buildSelector(layer, controller) {
  const root = el('div', 'panel__selector');

  const select = el('select', 'panel__selector-input', { 'aria-label': 'Choose species' });
  for (const s of layer.species) {
    const opt = el('option');
    opt.value = s.key;
    opt.textContent = s.common;
    select.appendChild(opt);
  }
  select.value = controller.getSpecies();

  const name = el('p', 'panel__selector-name');
  const sci = el('span', 'panel__selector-sci');
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
  return { el: root, setVisible: (v) => root.classList.toggle('is-active', v) };
}

// A small colour-swatch legend, shown only while its layer is on.
function buildLegend(items) {
  const root = el('div', 'panel__legend');
  for (const it of items) {
    const row = el('span', 'panel__legend-item');
    const sw = el('span', 'panel__legend-swatch', { 'aria-hidden': 'true' });
    sw.style.background = `var(--${it.colorVar})`;
    const lb = el('span', 'panel__legend-label');
    lb.textContent = it.label;
    row.append(sw, lb);
    root.appendChild(row);
  }
  return { el: root, setVisible: (v) => root.classList.toggle('is-active', v) };
}

function el(tag, className, attrs = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}
