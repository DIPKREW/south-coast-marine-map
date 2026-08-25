/**
 * LIVE STATUS CONTROL — when the live discharge snapshot was taken, and a button
 * to take another.
 *
 * THE FIRST INTERACTIVE ELEMENT ON THIS MAP THAT IS NOT IN A PANEL. Everything
 * else a person can click lives in the control panel or the detail panel; the
 * only other thing floating over the map is the hover card, which is
 * `pointer-events: none`. Two consequences shape this file:
 *
 *  • It is mounted into #app, NEXT TO the panels, never into the map container.
 *    Auto-collapse listens on the map container in capture phase for
 *    pointerdown/click/wheel, so a Refresh button inside it would collapse the
 *    control panel on every press. Same reasoning as the search box.
 *  • It sits in a flex column with the control panel rather than at fixed
 *    coordinates, so it FOLLOWS the panel: under the full panel when it is open,
 *    under the small open button when it is collapsed. The panel is capped at
 *    90vh and the detail panel occupies the whole strip to its right, so there
 *    is nowhere else for this to go that is both beside the panel and free.
 *
 * WHY IT EXISTS AT ALL. Every other layer on this map is a committed file that
 * cannot have changed since the page loaded, so "when was this fetched" has one
 * answer for all of them and is not worth saying. This one is queried at runtime
 * from four water companies, and a status that is hours old is worse than
 * useless — so the age of the snapshot has to be readable, and there has to be a
 * way to take a new one.
 *
 * WHAT IT PROMISES, AND WHY IT SAYS SO. Refreshing clears the dropped pin and
 * closes the site briefing. A briefing carrying a live discharge line read from
 * the previous snapshot would sit beside a freshly refreshed map and quietly
 * disagree with it. That is stated on the control, in a line that is always
 * visible, rather than behind a confirmation dialogue — the point is that it is
 * known BEFORE the press, and a pin can be dropped at any moment.
 *
 * The pin is cleared when Refresh is PRESSED, not when it succeeds, so the
 * promise on the control is unconditional. A refresh that comes back partial or
 * fails leaves the map exactly as it was, but the pin is still gone.
 *
 * THE TIMESTAMP NEVER DESCRIBES ANYTHING BUT WHAT IS DRAWN. A partial or failed
 * refresh is rejected by the controller (see deferLayer), so there is no state
 * in which this shows a fresh time over a stale map. When that happens the
 * control keeps the old time and says which feeds were reached.
 */
import { el } from './dom.js';
import { snapshotTime, partialNote, COMPANY_NAMES } from '../map/liveOverflows.js';

/**
 * @param {object}   opts
 * @param {object}   opts.controller     the storm-live layer controller
 * @param {Function} opts.onBeforeRefresh runs the moment Refresh is pressed —
 *   main.js clears the pin and closes the briefing here
 * @param {Function} opts.onChange       called whenever this control's own state
 *   changes, so the page can re-sync anything that depends on it
 */
export function createLiveStatusControl({ controller, onBeforeRefresh, onChange }) {
  const root = el('div', 'livestatus', { role: 'status', 'aria-live': 'polite' });

  const head = el('div', 'livestatus__head');
  const when = el('p', 'livestatus__when');
  const btn = el('button', 'livestatus__refresh', { type: 'button' });
  btn.textContent = 'Refresh';
  head.append(when, btn);

  // The standing warning. Always shown while the control is, because a pin can
  // be dropped at any moment and this must be read before the press, not after.
  const cost = el('p', 'livestatus__cost');
  cost.textContent = 'Refreshing clears any pin and closes the briefing.';

  // Everything that is only sometimes true: a partial snapshot, a company that
  // returned nothing, the outcome of a refresh that did not take.
  const notes = el('div', 'livestatus__notes');

  root.append(head, cost, notes);

  let busy = false;
  // The outcome of the last refresh, while it still needs saying. Cleared by the
  // next press, not by a timer — a refresh that did not take is not a
  // notification, it is the current state of the thing on screen.
  let outcome = null;

  const note = (text, kind) => {
    const p = el('p', `livestatus__note${kind ? ` livestatus__note--${kind}` : ''}`);
    p.textContent = text;
    notes.appendChild(p);
  };

  const render = () => {
    const prepared = controller.getPrepared?.();
    const stats = prepared?.stats;
    const time = snapshotTime(stats);
    notes.replaceChildren();

    if (busy) {
      // Keep the old time on screen while the new one is in flight: it is still
      // the time of what is drawn, right up until the swap.
      when.textContent = time ? `Refreshing — showing ${time}` : 'Fetching live status…';
      btn.disabled = true;
      btn.textContent = 'Refreshing…';
      root.classList.add('is-busy');
      root.removeAttribute('title');
      return;
    }

    root.classList.remove('is-busy');
    btn.textContent = 'Refresh';

    if (!stats) {
      // The layer is on but `prepare` has not landed yet. There is no snapshot
      // to name a time for, and inventing one is exactly the thing this control
      // exists to prevent.
      when.textContent = 'Fetching live status…';
      btn.disabled = true;
      root.removeAttribute('title');
      return;
    }

    when.textContent = time ? `Snapshot taken at ${time}` : 'Snapshot taken when the layer was switched on';
    btn.disabled = false;

    /*
     * PER-COMPANY RECORD COUNTS, as the control's tooltip.
     *
     * A company answering HTTP 200 with an empty list counts as a success
     * everywhere else, so this is the one place the difference is visible. It is
     * reported as a count and nothing more: a zero here is not evidence of a
     * failure, and no line on this control treats it as one.
     */
    const received = stats.received ?? {};
    const seen = COMPANY_NAMES.filter((c) => c in received);
    if (seen.length) {
      root.setAttribute(
        'title',
        `Records returned by each company feed, before the catchment filter:\n${
          seen.map((c) => `${c}: ${received[c]}`).join('\n')}`,
      );
    } else {
      root.removeAttribute('title');
    }

    // The snapshot itself is short of a company.
    const partial = partialNote(stats);
    if (partial) note(partial, 'warn');

    // A company that answered with nothing. Stated, not interpreted — see above.
    const empty = seen.filter((c) => received[c] === 0);
    if (empty.length) note(`${empty.join(' and ')} returned no records.`);

    // What the last refresh did, if it did not take.
    if (outcome) note(outcome, 'warn');
  };

  const refresh = async () => {
    if (busy) return; // a second press while one is in flight is not a refresh
    busy = true;
    outcome = null;
    render();
    onChange?.();

    // Unconditional, and before the fetch: the line on the control promises it.
    onBeforeRefresh?.();

    const before = snapshotTime(controller.getPrepared?.()?.stats);
    const res = await controller.refresh();
    busy = false;

    if (res?.ok) {
      outcome = null;
    } else if (res?.reason === 'partial') {
      const missed = res.failed ?? [];
      const still = before ? ` Still showing the ${before} snapshot.` : ' The snapshot is unchanged.';
      outcome = `Refresh reached ${COMPANY_NAMES.length - missed.length} of ${COMPANY_NAMES.length} feeds — ${
        missed.join(' and ')} did not respond, so it was not applied.${still}`;
    } else {
      const still = before ? ` Still showing the ${before} snapshot.` : ' The snapshot is unchanged.';
      outcome = `Refresh failed — no company feed responded.${still}`;
    }
    render();
    onChange?.();
  };

  btn.addEventListener('click', refresh);

  /**
   * Show the control exactly while the layer is on, and never a moment longer.
   *
   * `isVisible()` is INTENT, so this appears the instant the toggle is pressed
   * and carries "Fetching live status…" until the data lands — the same signal
   * the panel's own legend responds on. Every route that switches the layer off
   * — the toggle, a preset, Clear — runs through the same apply() and the same
   * onChange, so there is one path in and nothing to linger.
   */
  const sync = () => {
    const on = controller.isVisible?.() ?? false;
    root.hidden = !on;
    if (on) render();
  };

  // The initial fetch resolves long after the toggle was pressed; both outcomes
  // have to repaint. deferLayer fires each of these exactly once.
  controller.onReady?.(() => sync());
  controller.onUnavailable?.(() => sync());

  sync();

  return { el: root, sync };
}
