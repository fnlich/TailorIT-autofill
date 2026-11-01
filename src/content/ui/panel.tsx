/*
 * The in-page review panel (docs/design/runtime.md §10.1; docs/ARCHITECTURE.md "UI"): the same report components as
 * the side panel (src/ui/report), mounted in the page UI's closed shadow root, which adopts the report's stylesheet
 * beside the page UI's own. It is the one React file in the content script (eslint.config.mjs).
 * - It opens from the launcher's Open review when the person chose it in the options (settings.panel 'in-page'), and
 *   closes from its own Close button; the runtime tells the worker each time (panel/shown {open}), so the tab's
 *   combined report (report/update) reaches this frame alone, and only while the panel is open.
 * - It sits in the page UI's anchor column, under the launcher and the notices, so it never covers our own launcher
 *   or the policy card (their clicks count only while a person can see them).
 * - Its actions are this frame's own: Show on page and the closest options for this frame's rows (another frame's rows
 *   are shown, without actions). It never shows the policy card's buttons: the page's own card has them, and the side
 *   panel mirrors every notice, because a page could draw over this one.
 * - Every click in it must be the person's: a capture listener on the panel stops any untrusted click before React
 *   hears it. Confirm draft and Save my answer (Phase 6 wave 2 passes them) also need the panel to have been seen
 *   (IntersectionObserver v2, visible.ts) when the click came, as the launcher's own clicks do, and the click to have
 *   landed on what was seen (the Phase 6 review, E1): the watch speaks for the panel's box only, so the click's point
 *   (a keyboard's click: the control's centre) must lie inside that box, inside the scrolling body for a row's
 *   control, and on the control itself. The rows scroll inside the box (styles.ts), which clips anything past it. The
 *   panel then says what came of each, under its title.
 * - It renders synchronously (flushSync), so what it shows is what it was last given. It never shows or receives a
 *   value: reports hold none, and the suggested options' labels live in the open row's state only. Closed, it keeps
 *   nothing: its reports are dropped and its tree unmounted (E7), so the next opening waits for a fresh report.
 * - TailorIT's look: a white card with a 20 px radius (styles.ts), its head TailorIT's mark and "TailorIT Autofill"
 *   beside a round chevron that closes it (Close the review), then the run's status strip and what the last action
 *   did; its body the report (notices, completion, rows). It shows no job facts.
 */
import { useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { COPY } from '../../shared/copy';
import { log } from '../../shared/log';
import type { FrameReport } from '../../shared/report';
import { Brand, Icon } from '../../ui/brand';
import { adoptReportStyles, Report, RunStatusLine, type SuggestionLabel } from '../../ui/report';

/** What the panel's buttons ask the runtime for. Each is about one of this frame's own fields. */
export interface PanelActions {
  /** Show on page: scroll the field into view and focus it (nothing is drawn over it). */
  showField(fieldKey: string): void;
  /** The visible labels of the row's suggested options, from a fresh scan (null: the page could not say). */
  describeField(fieldKey: string): Promise<readonly SuggestionLabel[] | null>;
  /** Confirm draft (Phase 6 wave 2): answers what came of it, in the panel's words. Called only for a click the person
   *  made while the panel could be seen. */
  confirmDraft?(fieldKey: string): Promise<string>;
  /** Save my answer (Phase 6 wave 2): answers what came of it, in the panel's words. Called only for a click the person
   *  made while the panel could be seen. */
  saveAnswer?(fieldKey: string): Promise<string>;
  /** The person closed the panel. */
  closed(): void;
}

/** What the panel needs of the page UI's visibility watch (visible.ts). */
export interface PanelVisibility {
  observe(el: Element): void;
  shown(el: Element): boolean;
}

/** The in-page panel. */
export interface InPagePanel {
  /** The panel's element in the closed root (hidden while closed). */
  readonly el: HTMLElement;
  readonly open: boolean;
  /** The reports it was last given (null: none yet since it opened). */
  readonly reports: readonly FrameReport[] | null;
  show(): void;
  hide(): void;
  /** The tab's combined report, as report/update carries it. */
  update(reports: readonly FrameReport[]): void;
  destroy(): void;
}

/** The click types the panel's buttons answer. */
const CLICKS = ['click', 'auxclick', 'dblclick'] as const;

/** Slack for a box's edges, in CSS pixels (sub-pixel layout). */
const EDGE_PX = 1;

/** Whether a point lies inside a box. */
function within(x: number, y: number, box: DOMRect): boolean {
  return x >= box.left - EDGE_PX && x <= box.right + EDGE_PX && y >= box.top - EDGE_PX && y <= box.bottom + EDGE_PX;
}

/**
 * Whether a trusted click landed on what the person could see (E1): the control it reached (a button, else the panel)
 * at a point inside the panel's box and, for a control in the scrolling body, inside the body's box. A pointer's click
 * is judged at its point, which must also lie on the control; a keyboard's (detail 0, no point) at the control's
 * centre.
 */
function landedInside(event: Event, panel: HTMLElement): boolean {
  const path = event.composedPath();
  const at = path.indexOf(panel);
  if (at < 0) return false;
  const control = (path.slice(0, at).find((node) => (node as Node).nodeType === 1
    && (node as Element).tagName === 'BUTTON') ?? panel) as Element;
  const own = control.getBoundingClientRect();
  const mouse = event as MouseEvent;
  const pointer = typeof mouse.detail === 'number' && mouse.detail > 0;
  const x = pointer ? mouse.clientX : own.left + own.width / 2;
  const y = pointer ? mouse.clientY : own.top + own.height / 2;
  if (!within(x, y, panel.getBoundingClientRect()) || !within(x, y, own)) return false;
  const body = panel.querySelector('.panel__body');
  return body === null || !body.contains(control) || within(x, y, body.getBoundingClientRect());
}

/** The panel's head (TailorIT's name, Close, the run's status and what the last action did), then the report (or a
 *  loading line until the first report arrives). */
function PanelView({ reports, frameId, actions, seenAtClick }: {
  reports: readonly FrameReport[] | null;
  frameId: number | null;
  actions: PanelActions;
  seenAtClick: () => boolean;
}) {
  /** What the last action did, in the panel's words, and whether a request is on its way. */
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  /** A consequential action: only for a click made while the panel could be seen; its outcome is said under the
   *  title. */
  const seenOnly = (act: ((fieldKey: string) => Promise<string>) | undefined) => (act === undefined ? undefined
    : (_frameId: number, fieldKey: string) => {
      if (!seenAtClick()) {
        log('content.ui-click-refused', { launcher: false, panel: true });
        return;
      }
      setBusy(true);
      void act(fieldKey).then((said) => {
        setBusy(false);
        setFeedback(said);
      });
    });
  return (
    <>
      <header className="panel__head">
        <div className="panel__bar">
          <h2 className="panel__title tia-brand"><Brand markSize={24} /></h2>
          <button type="button" className="panel__close" aria-label={COPY.inPage.close} title={COPY.inPage.close}
            onClick={() => actions.closed()}>
            <Icon name="chevron-up" size={18} />
          </button>
        </div>
        {reports !== null && <RunStatusLine reports={reports} className="tia-run-status" />}
        {feedback !== null && <p className="tia-feedback" role="status" data-panel-feedback="">{feedback}</p>}
      </header>
      <div className="panel__body">
        {reports === null ? (
          <p className="panel__loading" role="status">{COPY.inPage.loading}</p>
        ) : (
          <Report
            reports={reports}
            actionsFrameId={frameId ?? -1}
            onShowField={(_frameId, fieldKey) => actions.showField(fieldKey)}
            describeField={(_frameId, fieldKey) => actions.describeField(fieldKey)}
            onConfirmDraft={seenOnly(actions.confirmDraft)}
            onSaveAnswer={seenOnly(actions.saveAnswer)}
            busy={busy}
          />
        )}
      </div>
    </>
  );
}

/**
 * Creates the panel inside `shadow` (it is not attached: the page UI places `el`). Nothing renders until it is first
 * shown. `frameId` is this frame's id as the worker gave it (null until frame/hello was answered).
 */
export function createInPagePanel(doc: Document, shadow: ShadowRoot, options: {
  actions: PanelActions;
  frameId(): number | null;
  visibility: PanelVisibility;
}): InPagePanel {
  const { actions, visibility } = options;
  const el = doc.createElement('section');
  el.className = 'panel tia-page';
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', COPY.inPage.region);
  el.dataset.panel = 'in-page';
  el.hidden = true;
  const container = doc.createElement('div');
  container.className = 'panel__root';
  el.append(container);

  // The person's clicks only: an untrusted one never reaches React. Whether the panel could be seen, and the click
  // landed on what was seen, is read at the click, before React runs the button's handler in the same dispatch.
  let seenAtClick = false;
  const gate = (event: Event) => {
    if (!event.isTrusted) {
      event.stopImmediatePropagation();
      event.preventDefault();
      return;
    }
    seenAtClick = visibility.shown(el) && landedInside(event, el);
  };
  for (const type of CLICKS) el.addEventListener(type, gate, { capture: true });
  visibility.observe(el);

  let root: Root | null = null;
  let reports: readonly FrameReport[] | null = null;
  let destroyed = false;

  function render(): void {
    if (destroyed || el.hidden) return;
    if (root === null) {
      adoptReportStyles(shadow);
      root = createRoot(container);
    }
    const mounted = root;
    flushSync(() => mounted.render(
      <PanelView reports={reports} frameId={options.frameId()} actions={actions} seenAtClick={() => seenAtClick} />));
  }

  return {
    el,
    get open() {
      return !el.hidden;
    },
    get reports() {
      return reports;
    },
    show() {
      if (destroyed || !el.hidden) return;
      // A panel opened afresh waits for the worker's report/update: what it showed before may be stale.
      reports = null;
      el.hidden = false;
      render();
    },
    hide() {
      // Closed, it keeps nothing of the tab's reports, other frames' labels included (E7).
      el.hidden = true;
      reports = null;
      root?.unmount();
      root = null;
    },
    update(next) {
      reports = [...next];
      render();
    },
    destroy() {
      destroyed = true;
      el.hidden = true;
      root?.unmount();
      root = null;
      el.remove();
    },
  };
}
