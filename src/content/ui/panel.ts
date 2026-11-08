/*
 * The in-page review panel (docs/design/runtime.md §10.1; docs/ARCHITECTURE.md "UI"): the same report components as
 * the side panel (src/ui/report), mounted in the page UI's closed shadow root, which adopts the report's stylesheet
 * beside the page UI's own. v5 p1-shell: this file keeps the card's frame and its click gate; its React views
 * (card.tsx) come with the sidebar's bundle (`renderer`, SidebarApp.card), so the content script holds no React: the
 * card opens only once its renderer is there.
 * - It opens from the launcher's Open review when the person chose the panel on the page (settings.panel 'page'; v5: in a
 *   frame inside another page, the top frame's panel being the sidebar), and
 *   closes from its own Close button; the runtime tells the worker each time (panel/shown {open}), so the tab's
 *   combined report (report/update) reaches this frame alone, and only while the panel is open.
 * - It sits in the page UI's anchor column, under the launcher and the notices, so it never covers our own launcher
 *   or the policy card (their clicks count only while a person can see them).
 * - Its actions are this frame's own: Show on page and the closest options for this frame's rows (another frame's rows
 *   are shown, without actions). It never shows the policy card's buttons: the page's own card has them, and the side
 *   panel mirrors every notice, because a page could draw over this one.
 * - Every click in it must be the person's: a capture listener on the panel stops any untrusted click before React
 *   hears it, and (the audit of 2026-11-06, S-1) any trusted one made before the panel had been seen, without a break,
 *   for CONTROL_SEEN_MS (IntersectionObserver v2, visible.ts), as the launcher's own clicks, or one that did not land
 *   on what was seen (the Phase 6 review, E1): the watch speaks for the panel's box only, so the click's point (a
 *   keyboard's click: the control's centre) must lie inside that box, inside the scrolling body for a row's control,
 *   and on the control itself. The rows scroll inside the box (styles.ts), which clips anything past it. Confirm draft
 *   and Save my answer (Phase 6 wave 2 passes them) read the same verdict again before they act, and the panel then
 *   says what came of each, under its title.
 * - It renders synchronously (flushSync), so what it shows is what it was last given. It never shows or receives a
 *   value: reports hold none, and the suggested options' labels live in the open row's state only. Closed, it keeps
 *   nothing: its reports are dropped and its tree unmounted (E7), so the next opening waits for a fresh report.
 * - TailorIT's look: a white card with a 20 px radius (styles.ts), its head TailorIT's mark and "TailorIT Autofill"
 *   beside a round chevron that closes it (Close the review), then the run's status strip and what the last action
 *   did; its body the report (notices, completion, rows). It shows no job facts.
 * - v3 Phase 4: the report's dock ("Continue to the next page", "Submit application") presses this frame's own step
 *   (PanelActions.press, the run's press.ts), only for the person's trusted click made while the panel could be seen
 *   and on what was seen, as Confirm draft's: a page can neither click it (the capture gate stops an untrusted click)
 *   nor reach its handler any other way. The review (12): the dock's own button is watched too, and its click counts
 *   only once that button has been seen for CONTROL_SEEN_MS (500 ms before the audit of 2026-11-06), so a page cannot
 *   slide it under the pointer at the last moment.
 */
import { PAGE_COPY } from '../../shared/copy';
import { log } from '../../shared/log';
import type { FrameReport } from '../../shared/report';
import type { CardRenderer, PanelActions } from '../../shared/sidebar';
import { landedInside } from './landed';
import { CONTROL_SEEN_MS } from './visible';

export type { PanelActions } from '../../shared/sidebar';

/** What the panel needs of the page UI's visibility watch (visible.ts). */
export interface PanelVisibility {
  observe(el: Element): void;
  shown(el: Element): boolean;
  /** Seen for at least `ms` (visible.ts shownFor). */
  shownFor(el: Element, ms: number): boolean;
}

/** The in-page panel. */
export interface InPagePanel {
  /** The panel's element in the closed root (hidden while closed). */
  readonly el: HTMLElement;
  readonly open: boolean;
  /** The reports it was last given (null: none yet since it opened). */
  readonly reports: readonly FrameReport[] | null;
  /** Opens it, drawn by `renderer` (v5: the sidebar's bundle's card views). */
  show(renderer: CardRenderer): void;
  hide(): void;
  /** The tab's combined report, as report/update carries it. */
  update(reports: readonly FrameReport[]): void;
  destroy(): void;
}

/** The click types the panel's buttons answer. */
const CLICKS = ['click', 'auxclick', 'dblclick'] as const;

/**
 * Creates the panel (it is not attached: the page UI places `el`). Nothing renders until it is first shown. `frameId`
 * is this frame's id as the worker gave it (null until frame/hello was answered).
 */
export function createInPagePanel(doc: Document, options: {
  actions: PanelActions;
  frameId(): number | null;
  visibility: PanelVisibility;
}): InPagePanel {
  const { actions, visibility } = options;
  const el = doc.createElement('section');
  el.className = 'panel tia-page';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', PAGE_COPY.inPage.region);
  el.dataset.panel = 'in-page';
  el.hidden = true;
  const container = doc.createElement('div');
  container.className = 'panel__root';
  el.append(container);

  // The person's clicks only: an untrusted one never reaches the views, nor (the audit of 2026-11-06, S-1) a trusted one
  // made before the panel had been seen, without a break, for CONTROL_SEEN_MS, or that did not land on what was seen.
  // That is read at the click, before the views run the button's handler in the same dispatch, and never later.
  let seenAtClick = false;
  const gate = (event: Event) => {
    const stop = () => {
      event.stopImmediatePropagation();
      event.preventDefault();
    };
    if (!event.isTrusted) {
      seenAtClick = false;
      stop();
      return;
    }
    seenAtClick = visibility.shownFor(el, CONTROL_SEEN_MS) && landedInside(event, el, '.panel__body');
    // The dock's button: seen itself, for CONTROL_SEEN_MS (the review, 12).
    const dock = event.composedPath().find((node) => (node as Element).nodeType === 1
      && (node as Element).hasAttribute?.('data-step-action')) as Element | undefined;
    if (dock !== undefined) seenAtClick = seenAtClick && visibility.shownFor(dock, CONTROL_SEEN_MS);
    if (!seenAtClick) {
      log('content.ui-click-refused', { launcher: false, panel: true, dock: dock !== undefined });
      stop();
    }
  };
  for (const type of CLICKS) el.addEventListener(type, gate, { capture: true });
  visibility.observe(el);

  /** The card's views while it is open (none: closed, or no renderer given yet). */
  let drawn: CardRenderer | null = null;
  let reports: readonly FrameReport[] | null = null;
  let destroyed = false;

  function render(): void {
    if (destroyed || el.hidden || drawn === null) return;
    drawn.render(container, { reports, frameId: options.frameId(), actions, seenAtClick: () => seenAtClick });
    // The dock's buttons are watched as they are drawn (an element observed twice is one observation).
    for (const button of container.querySelectorAll('button[data-step-action]')) visibility.observe(button);
  }

  function unmount(): void {
    drawn?.unmount(container);
    drawn = null;
    container.replaceChildren();
  }

  return {
    el,
    get open() {
      return !el.hidden;
    },
    get reports() {
      return reports;
    },
    show(renderer) {
      if (destroyed || !el.hidden) return;
      // A panel opened afresh waits for the worker's report/update: what it showed before may be stale.
      reports = null;
      drawn = renderer;
      el.hidden = false;
      render();
    },
    hide() {
      // Closed, it keeps nothing of the tab's reports, other frames' labels included (E7).
      el.hidden = true;
      reports = null;
      unmount();
    },
    update(next) {
      reports = [...next];
      render();
    },
    destroy() {
      destroyed = true;
      el.hidden = true;
      unmount();
      el.remove();
    },
  };
}
