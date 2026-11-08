/*
 * v5 p1-panel (PLAN decision 5; Jobright's applied-success popup, in our words and drawing): once the platform confirmed
 * an application and TailorIT's tracker recorded it, the worker tells the tab's top frame (applied/popup, sent once per
 * recorded submission: background/submissions.ts), and the page shows a window over itself:
 * - TailorIT's mark and name, a close ×, our own success drawing (a teal disc with a white tick in a soft ring, with
 *   four sparks), "Application Submitted!", "This job was added to your TailorIT tracker." and a full-width
 *   "Go To Application Tracker", which opens TailorIT's /tracker in a new tab inside the person's click and closes it;
 * - a native modal <dialog> (showModal: the top layer, the page behind it inert, a soft scrim) in a closed shadow root
 *   of its own, so it shows on a page with no form and no other UI of ours (a confirmation page); the host is
 *   shadow.ts's (registered as our own UI, events kept from the page, put back once if the page removes it);
 * - only in the top frame (the runtime's word: runtime.ts takes applied/popup from the worker in the top frame alone),
 *   and only while the tab is visible: a hidden tab shows it when the person comes back to it, and never once the page
 *   is going away (pagehide); at most one at a time;
 * - its two buttons take trusted clicks only, each counted only once it has been seen without a break for
 *   CONTROL_SEEN_MS (visible.ts, S-1), so a page cannot press "Go To Application Tracker" nor dismiss it for the person;
 *   Escape closes it (the dialog's own cancel, trusted), and Tab cycles between its two buttons.
 * Nothing here names the job or the person: the window's words are fixed, and the address is TailorIT's tracker.
 */
import { CONTROL_SEEN_MS, createVisibilityWatch, type VisibilityWatch } from './visible';
import { PAGE_COPY } from '../../shared/copy';
import { BRAND, FONT_STACK, NEUTRAL, SHADOWS } from '../../shared/palette';
import { ICONS, LOGO_MARK, type IconDef } from '../../shared/icons';
import { log } from '../../shared/log';
import { createUiHost, type UiHost } from './shadow';
import { applyStyles } from './styles';
import { svgOf } from './svg';

/** Our own success drawing (module header): a soft ring, a teal disc with a white tick, four sparks. */
export const SUCCESS_DRAWING: IconDef = {
  viewBox: '0 0 80 80',
  stroked: false,
  parts: [
    { tag: 'circle', attrs: { cx: '40', cy: '40', r: '34', fill: BRAND.tint } },
    { tag: 'circle', attrs: { cx: '40', cy: '40', r: '24', fill: BRAND.fill } },
    { tag: 'path', attrs: { d: 'M29 40.5l7.5 7.5L52 32.5', fill: 'none', stroke: NEUTRAL.surface, 'stroke-width': '5',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round' } },
    { tag: 'path', attrs: { d: 'M40 1.5v6M40 72.5v6M1.5 40h6M72.5 40h6', fill: 'none', stroke: BRAND.ink,
      'stroke-width': '3', 'stroke-linecap': 'round' } },
  ],
};

/** The window's stylesheet, in its own closed root: TailorIT's colours, light only. No transform, opacity under 1 or
 *  filter on the window or its buttons (visible.ts judges them). */
export const APPLIED_CSS = `
:host { all: initial; }
[hidden] { display: none !important; }
dialog {
  pointer-events: auto; box-sizing: border-box; width: min(440px, calc(100vw - 32px)); max-width: none; margin: auto;
  padding: 20px 24px 24px; border: 0; border-radius: 24px; background: ${NEUTRAL.surface}; color: ${NEUTRAL.fg};
  box-shadow: ${SHADOWS.pop}; font: 400 14px/1.5 ${FONT_STACK}; color-scheme: light;
}
dialog::backdrop { background: rgb(15 23 42 / 0.4); }
dialog:focus { outline: none; }
.head { display: flex; align-items: center; gap: 8px; }
.name { flex: 1 1 auto; font: 800 17px/1.2 ${FONT_STACK}; letter-spacing: -0.02em; }
.name .it { color: ${BRAND.ink}; }
button { font: inherit; cursor: pointer; }
.close {
  display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; margin: 0; padding: 0;
  border: 0; border-radius: 999px; background: ${NEUTRAL.track}; color: ${NEUTRAL.fg};
}
.close:hover { background: ${NEUTRAL.line}; }
.body { display: grid; justify-items: center; gap: 10px; padding: 18px 0 22px; text-align: center; }
.success { display: block; }
h2 { margin: 6px 0 0; font: 800 22px/1.25 ${FONT_STACK}; letter-spacing: -0.01em; }
p { margin: 0; color: ${NEUTRAL.muted}; font: 400 15px/1.5 ${FONT_STACK}; }
.tracker {
  display: flex; align-items: center; justify-content: center; width: 100%; min-height: 48px; margin: 0; padding: 0 16px;
  border: 0; border-radius: 12px; background: ${BRAND.ink}; color: ${NEUTRAL.surface}; font: 700 16px/1.2 ${FONT_STACK};
}
.tracker:hover { background: ${BRAND.inkHover}; }
.close:focus-visible, .tracker:focus-visible { outline: 2px solid ${BRAND.ink}; outline-offset: 2px; }
@media (forced-colors: active) { dialog { border: 1px solid CanvasText; } .tracker { border: 1px solid ButtonText; } }
`;

/** The window shown now (for the runtime and tests). */
export interface AppliedPopup {
  /** Its host on the page (tests click through it, as a person's pointer does). */
  readonly host: HTMLElement;
  readonly dialog: HTMLDialogElement;
  readonly tracker: HTMLButtonElement;
  readonly close: HTMLButtonElement;
  /** Settles once it is closed (by the person, Escape, the page going away, or remove()). */
  readonly closed: Promise<void>;
  /** Takes it away (the document is going, or the extension's UI is removed). */
  remove(): void;
}

export interface AppliedOptions {
  /** TailorIT's tracker (`${origin}/tracker`). */
  trackerUrl: string;
  /** Opens the tracker in a new tab, inside the person's click; the page's window.open by default. */
  open?(url: string): void;
  /** The visibility watch the buttons' clicks are judged by (tests pass their own); IntersectionObserver v2 by default. */
  watch?: VisibilityWatch;
  /** The page UI's host-maker (tests may pass their own); shadow.ts's by default. */
  host?(doc: Document): UiHost;
}

/** The one window open now, per document. */
const shown = new WeakMap<Document, AppliedPopup>();
/** Documents waiting for their tab to be visible, so a second word does not wait twice. */
const waiting = new WeakSet<Document>();

/** Draws the window and opens it (module header); the open one when there is one already. */
function draw(doc: Document, options: AppliedOptions): AppliedPopup | null {
  const already = shown.get(doc);
  if (already !== undefined) return already;
  const view = doc.defaultView;
  if (view === null || doc.documentElement === null) return null;
  const host = (options.host ?? createUiHost)(doc);
  applyStyles(host.root, APPLIED_CSS);
  const watch = options.watch ?? createVisibilityWatch(view as Window & typeof globalThis);
  const words = PAGE_COPY.applied;

  const dialog = doc.createElement('dialog');
  const titleId = `tia-applied-${Math.floor(Math.random() * 1e9).toString(36)}`;
  dialog.setAttribute('aria-labelledby', `${titleId}-title`);
  dialog.setAttribute('aria-describedby', `${titleId}-body`);
  const head = doc.createElement('div');
  head.className = 'head';
  const name = doc.createElement('span');
  name.className = 'name';
  const it = doc.createElement('span');
  it.className = 'it';
  it.textContent = PAGE_COPY.brand.name[1];
  name.append(PAGE_COPY.brand.name[0], it);
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'close';
  close.setAttribute('aria-label', words.close);
  close.title = words.close;
  close.append(svgOf(doc, ICONS.close, 16));
  head.append(svgOf(doc, LOGO_MARK, 28, 'mark'), name, close);
  const body = doc.createElement('div');
  body.className = 'body';
  const title = doc.createElement('h2');
  title.id = `${titleId}-title`;
  title.textContent = words.title;
  const text = doc.createElement('p');
  text.id = `${titleId}-body`;
  text.textContent = words.body;
  body.append(svgOf(doc, SUCCESS_DRAWING, 80, 'success'), title, text);
  const tracker = doc.createElement('button');
  tracker.type = 'button';
  tracker.className = 'tracker';
  tracker.textContent = words.tracker;
  dialog.append(head, body, tracker);
  host.root.append(dialog);

  let done = false;
  let settle: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const finish = () => {
    if (done) return;
    done = true;
    shown.delete(doc);
    view.removeEventListener('pagehide', finish);
    for (const control of [close, tracker]) watch.unobserve(control);
    if (options.watch === undefined) watch.disconnect();
    if (dialog.open) dialog.close();
    host.remove();
    settle();
  };
  /** A trusted click on one of its buttons counts only once that button has been seen long enough (module header). */
  const counts = (event: MouseEvent, control: HTMLButtonElement) => {
    event.preventDefault();
    if (!event.isTrusted || !control.isConnected) return false;
    if (watch.shownFor(control, CONTROL_SEEN_MS)) return true;
    log('content.ui-click-refused', { applied: true, known: watch.known(control), shown: watch.shown(control) });
    return false;
  };
  close.addEventListener('click', (event) => {
    if (counts(event, close)) finish();
  });
  tracker.addEventListener('click', (event) => {
    if (!counts(event, tracker)) return;
    try {
      if (options.open !== undefined) options.open(options.trackerUrl);
      else view.open(options.trackerUrl, '_blank', 'noopener,noreferrer');
    } catch {
      // A page that took window.open away: nothing opens, and the window still closes.
    }
    finish();
  });
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    if (event.isTrusted) finish();
  });
  dialog.addEventListener('close', finish);
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const active = host.root.activeElement;
    (event.shiftKey ? (active === close ? tracker : close) : (active === tracker ? close : tracker)).focus();
  });
  view.addEventListener('pagehide', finish);
  for (const control of [close, tracker]) watch.observe(control);
  // v5 p1-shell (the review's S3): a page that restyled the window's host (put back at once): its buttons' seen time
  // starts again.
  host.onRestyled(() => {
    for (const control of [close, tracker]) watch.reset(control);
  });
  try {
    dialog.showModal();
  } catch {
    // A document that will not take a modal (it is going away): nothing is left behind.
    finish();
    return null;
  }
  close.focus({ preventScroll: true });
  const popup: AppliedPopup = { host: host.host, dialog, tracker, close, closed, remove: finish };
  shown.set(doc, popup);
  return popup;
}

/**
 * Shows the window in `doc` (the top frame's document) once its tab is visible (module header). Answers the window
 * when it showed at once, else null: a hidden tab shows it when it becomes visible, unless the page goes first.
 */
export function showApplied(doc: Document, options: AppliedOptions): AppliedPopup | null {
  const view = doc.defaultView;
  if (view === null) return null;
  if (doc.visibilityState === 'visible') return draw(doc, options);
  if (waiting.has(doc)) return null;
  waiting.add(doc);
  const stop = () => {
    waiting.delete(doc);
    doc.removeEventListener('visibilitychange', seen);
    view.removeEventListener('pagehide', stop);
  };
  const seen = () => {
    if (doc.visibilityState !== 'visible') return;
    stop();
    draw(doc, options);
  };
  doc.addEventListener('visibilitychange', seen);
  view.addEventListener('pagehide', stop, { once: true });
  return null;
}

/** The window open in `doc` now, or null (tests). */
export function appliedShown(doc: Document): AppliedPopup | null {
  return shown.get(doc) ?? null;
}
