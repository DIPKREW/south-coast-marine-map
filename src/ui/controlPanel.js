/**
 * The main control panel (top-left). Holds the wordmark + tagline and the layer
 * toggles, grouped, rendered from the data layer config — so new layers and
 * groups appear here automatically.
 *
 * This panel is TOGGLES ONLY. Each layer's legend, About text and special
 * controls used to expand inline underneath its row; they now live in the second
 * panel (see detailPanel.js), which sits to the right of this one. A row here is
 * just label, sub-label and switch.
 *
 * The header carries two controls:
 *   • the PIN, which suspends auto-collapse for as long as it is active;
 *   • the COLLAPSE chevron, which shrinks the panel to a small tab in the same
 *     corner. Collapsing only sets a class — the body is `display: none`, never
 *     rebuilt — so toggle positions survive a collapse/expand round trip.
 *
 * `onChange` fires whenever anything the second panel cares about moves: a
 * toggle, a late-arriving layer becoming ready or unavailable, a collapse or an
 * expand. main.js uses it to re-sync the detail panel.
 *
 * Returns { el, collapse, expand, isCollapsed, isPinned }.
 */
import { el } from './dom.js';

export function buildControlPanel({ layers, groups, controllers, wordmark, tagline, onChange, onCopyLink }) {
  const panel = el('section', 'panel', { role: 'region', 'aria-label': `${wordmark} controls` });
  const byId = new Map(layers.map((l) => [l.id, l]));

  const notify = () => onChange?.();

  // ---- Masthead ----
  const head = el('header', 'panel__head');
  const headText = el('div', 'panel__head-text');
  const mark = el('h1', 'panel__wordmark');
  mark.textContent = wordmark;
  const tag = el('p', 'panel__tagline');
  tag.textContent = tagline;
  headText.append(mark, tag);

  const actions = el('div', 'panel__actions');

  /*
   * Copy a link to the current view. Deliberately the smallest possible
   * affordance — one icon button next to the pin, no share dialog and no social
   * buttons. Confirmation is a tick on the button itself for a moment, which is
   * enough feedback without a toast.
   */
  const linkBtn = el('button', 'panel__link', { type: 'button' });
  const linkIcon =
    '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">' +
    '<path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" ' +
    'd="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2.3-2.3a2.6 2.6 0 0 0-3.7-3.7l-1 1M9.4 6.6a2.6 2.6 0 0 0-3.7 0L3.4 8.9a2.6 2.6 0 0 0 3.7 3.7l1-1"/>' +
    '</svg>';
  const tickIcon =
    '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">' +
    '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3.5 8.5l3 3 6-7"/>' +
    '</svg>';
  linkBtn.innerHTML = linkIcon;
  const setLinkLabel = (t) => { linkBtn.setAttribute('aria-label', t); linkBtn.setAttribute('title', t); };
  setLinkLabel('Copy link to this view');
  let linkTimer = null;
  linkBtn.addEventListener('click', async () => {
    const ok = await onCopyLink?.();
    clearTimeout(linkTimer);
    linkBtn.innerHTML = ok ? tickIcon : linkIcon;
    linkBtn.classList.toggle('is-done', !!ok);
    setLinkLabel(ok ? 'Link copied' : 'Could not copy — select the address bar instead');
    linkTimer = setTimeout(() => {
      linkBtn.innerHTML = linkIcon;
      linkBtn.classList.remove('is-done');
      setLinkLabel('Copy link to this view');
    }, 1800);
  });

  // Pin: while active, map interaction no longer collapses the panel. Manual
  // collapse via the chevron is deliberately unaffected.
  const pinBtn = el('button', 'panel__pin', { type: 'button', 'aria-pressed': 'false' });
  pinBtn.innerHTML =
    '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M9.6 1.2a1 1 0 0 1 1.4 0l3.8 3.8a1 1 0 0 1-.7 1.7c-.9 0-1.7.3-2.3.9l-.6.6.5 2.4a1 1 0 0 1-1.7.9L7.4 9.2l-3.6 3.6a1 1 0 0 1-1.4-1.4l3.6-3.6L2.5 5.5a1 1 0 0 1 .9-1.7l2.4.5.6-.6c.6-.6.9-1.4.9-2.3a1 1 0 0 1 .3-.2z"/>' +
    '</svg>';

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

  actions.append(linkBtn, pinBtn, collapseBtn);
  head.append(headText, actions);
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
    // Functions re-run whenever any toggle in the group changes. Only the
    // dormant group-level About uses this now; per-layer content moved out.
    const syncers = [];
    const runSyncers = () => {
      syncers.forEach((fn) => fn());
      notify();
    };

    const addLayerControls = (id, into) => {
      const layer = byId.get(id);
      const controller = layer && controllers.get(id);
      if (!controller) return;
      groupIds.push(id);
      into.appendChild(buildToggle(layer, controller, runSyncers));
    };

    for (const id of group.layerIds) addLayerControls(id, section);

    // Optional SUBGROUPS — a quieter subheading inside the group, for layers
    // that belong together but are different kinds of thing (the annual storm
    // overflow return vs the live status feed).
    for (const sub of group.subgroups ?? []) {
      const subSection = el('div', 'panel__subgroup');
      const subHeading = el('p', 'panel__subsection-label');
      subHeading.textContent = sub.label;
      subSection.appendChild(subHeading);
      const before = groupIds.length;
      for (const id of sub.layerIds) addLayerControls(id, subSection);
      if (groupIds.length === before) continue; // nothing rendered — no bare heading
      section.appendChild(subSection);
    }

    if (!groupIds.length) continue;

    /*
     * GROUP-level explanation drop-down — distinct from the per-layer About text
     * that moved to the detail panel, and left here deliberately.
     *
     * Only one group declares it (Dorset Wildlife Trust), and that group is
     * dormant behind SHOW_DORSET_LAND_LAYERS, so this renders nowhere today. It
     * describes a group rather than a layer, and the detail panel is organised
     * strictly one-section-per-layer, so there is nowhere for it to go there
     * without inventing a concept nothing currently needs. Kept working so that
     * flipping the flag back restores the DWT group exactly as it was.
     */
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

  // ---- Pin ----
  let pinned = false;
  const applyPin = () => {
    panel.classList.toggle('is-pinned', pinned);
    pinBtn.classList.toggle('is-active', pinned);
    pinBtn.setAttribute('aria-pressed', String(pinned));
    const label = pinned ? 'Unpin panels (allow auto-collapse)' : 'Pin panels open';
    pinBtn.setAttribute('aria-label', label);
    pinBtn.setAttribute('title', label);
  };
  pinBtn.addEventListener('click', () => {
    pinned = !pinned;
    applyPin();
  });
  applyPin();

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
    notify();
  };

  collapseBtn.addEventListener('click', () => setCollapsed(!collapsed));
  apply();

  return {
    el: panel,
    collapse: () => setCollapsed(true),
    expand: () => setCollapsed(false),
    isCollapsed: () => collapsed,
    isPinned: () => pinned,
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
  // fetch): re-sync when ready; grey the row out on failure.
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

/** The group-level drop-down described above. Per-layer About lives elsewhere. */
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
