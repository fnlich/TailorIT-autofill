/*
 * v1.5 X (PLAN decisions 2 and 3; the owner's 2026-11-09 words and screenshot 10.png, Jobright's "Your Autofill
 * information" window, read for its look alone and drawn in TailorIT's teal): the documents' dialogs over the page,
 * in the tab's top frame, each when the worker asks (preview/show, edit/confirm: runtime.ts takes them from the
 * worker's own script alone):
 * - **The preview** ("Your Resume" and the file's name, or "Your Cover Letter"): a white, rounded window centred over a
 *   dimmed page, at most DIALOG_MAX_WIDTH_PX wide and 85 % of the window high, a close ×, the Résumé and Cover Letter
 *   tabs where the panel previews both, "Open In A New Tab" (the full-window preview page, which the worker opens), and
 *   the document in a frame of the extension's own preview page (preview.html, the extension's one web-accessible
 *   resource, at its address of this browser session), which receives the PDF over the preview port with the worker's
 *   grant: the bytes stay in the extension's own process, and the page's scripts can reach neither the frame (it is
 *   in a closed shadow root, and of another origin) nor what it shows. Another tab replaces the frame (its document,
 *   and the PDF it held, go).
 * - **The upload edit confirm**: "Editing an uploaded resume needs an editable copy…", "Don't show this again", Cancel
 *   and Continue, whose click tells the worker (edit/confirmed, with its grant), which opens TailorIT's editor for the
 *   copy: the resume's id never reaches the page.
 * Both are a native modal <dialog> (showModal: the top layer, the page behind it inert) in a closed shadow root of
 * their own (shadow.ts: registered as our own UI, events kept from the page, put back once if the page removes it, its
 * style put back if the page changes it), as the applied window (applied.ts). One at a time per document: a new one
 * replaces the one open. None in a hidden tab (the worker falls back). Every control takes trusted clicks only, each
 * counted once that control has been seen without a break for CONTROL_SEEN_MS (visible.ts), the sidebar's rule: a
 * page cannot press Continue or switch a tab for the person, nor harvest a click aimed at its own decoy. Escape (the
 * dialog's own trusted cancel) closes it; Tab and Shift+Tab cycle inside it; the focus starts on the close × (the
 * confirm: Cancel) and goes back where it was when the dialog closes (the dialog's own restoring).
 * Nothing is stored or logged but value-free codes; the file's name is the person's own, shown in the closed root.
 */
import { DOCUMENT_KINDS, type DocumentKind } from '../../messaging/schemas';
import { PAGE_COPY } from '../../shared/copy';
import { ICONS } from '../../shared/icons';
import { log } from '../../shared/log';
import { BRAND, FONT_STACK, NEUTRAL, SHADOWS } from '../../shared/palette';
import { createUiHost, type UiHost } from './shadow';
import { applyStyles } from './styles';
import { svgOf } from './svg';
import { CONTROL_SEEN_MS, createVisibilityWatch, type VisibilityWatch } from './visible';

/** The preview's widest (Jobright's window is about this wide on a large screen). */
export const DIALOG_MAX_WIDTH_PX = 1056;

const WORDS = PAGE_COPY.documentDialog;

/** The dialogs' stylesheet, in their own closed root: TailorIT's colours, light only. No transform, opacity under 1 or
 *  filter on the window or its controls (visible.ts judges them). */
export const DOCUMENT_DIALOG_CSS = `
:host { all: initial; }
[hidden] { display: none !important; }
dialog {
  pointer-events: auto; box-sizing: border-box; display: flex; flex-direction: column; max-width: none; max-height: none;
  margin: auto; padding: 0; overflow: hidden; border: 0; border-radius: 20px; background: ${NEUTRAL.surface};
  color: ${NEUTRAL.fg}; box-shadow: ${SHADOWS.pop}; font: 400 14px/1.5 ${FONT_STACK}; color-scheme: light;
}
dialog:not([open]) { display: none; }
dialog.preview { width: min(${DIALOG_MAX_WIDTH_PX}px, calc(100vw - 32px)); height: min(85vh, calc(100vh - 32px)); }
dialog.confirm { width: min(480px, calc(100vw - 32px)); }
dialog::backdrop { background: rgb(15 23 42 / 0.5); }
dialog:focus { outline: none; }
button, input { font: inherit; }
button { cursor: pointer; }
.head { display: flex; align-items: center; gap: 12px; padding: 18px 20px 14px 24px; }
.titles { display: flex; flex: 1 1 auto; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; min-width: 0; }
h2 { margin: 0; font: 700 17px/1.3 ${FONT_STACK}; letter-spacing: -0.01em; }
.file { overflow: hidden; color: ${NEUTRAL.muted}; font: 400 14px/1.3 ${FONT_STACK}; text-overflow: ellipsis;
  white-space: nowrap; max-width: 100%; }
.close {
  display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; width: 32px; height: 32px; margin: 0;
  padding: 0; border: 0; border-radius: 999px; background: ${NEUTRAL.track}; color: ${NEUTRAL.fg};
}
.close:hover { background: ${NEUTRAL.line}; }
.strip { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 10px 24px;
  background: ${NEUTRAL.subtle}; border-top: 1px solid ${NEUTRAL.line}; border-bottom: 1px solid ${NEUTRAL.line}; }
.tabs { display: inline-flex; gap: 4px; padding: 3px; border-radius: 999px; background: ${NEUTRAL.chip}; }
.tab { min-height: 32px; margin: 0; padding: 0 16px; border: 0; border-radius: 999px; background: transparent;
  color: ${NEUTRAL.fg}; font: 600 13px/1 ${FONT_STACK}; }
.tab[aria-selected="true"] { background: ${NEUTRAL.surface}; box-shadow: ${SHADOWS.control}; }
.newtab { margin: 0 0 0 auto; padding: 4px 0; border: 0; background: transparent; color: ${BRAND.ink};
  font: 600 14px/1.3 ${FONT_STACK}; text-decoration: underline; text-underline-offset: 3px; }
.newtab:hover { color: ${BRAND.inkHover}; }
.body { display: flex; flex: 1 1 auto; min-height: 0; background: ${NEUTRAL.track}; }
iframe { display: block; flex: 1 1 auto; width: 100%; height: 100%; border: 0; background: ${NEUTRAL.track}; }
.text { margin: 0; padding: 0 24px; color: ${NEUTRAL.fg}; font: 400 15px/1.55 ${FONT_STACK}; }
.check { display: flex; align-items: center; gap: 10px; margin: 16px 24px 0; color: ${NEUTRAL.fg};
  font: 400 14px/1.4 ${FONT_STACK}; cursor: pointer; }
.check input { width: 18px; height: 18px; margin: 0; accent-color: ${BRAND.ink}; cursor: pointer; }
.actions { display: flex; justify-content: flex-end; gap: 10px; padding: 20px 24px 22px; }
.action { min-height: 40px; margin: 0; padding: 0 20px; border-radius: 999px; font: 700 14px/1 ${FONT_STACK}; }
.cancel { border: 1px solid ${NEUTRAL.control}; background: ${NEUTRAL.surface}; color: ${NEUTRAL.fg}; }
.cancel:hover { background: ${NEUTRAL.hover}; }
.continue { border: 0; background: ${BRAND.ink}; color: ${NEUTRAL.surface}; }
.continue:hover { background: ${BRAND.inkHover}; }
.close:focus-visible, .tab:focus-visible, .newtab:focus-visible, .action:focus-visible, .check input:focus-visible {
  outline: 2px solid ${BRAND.ink}; outline-offset: 2px; }
@media (forced-colors: active) { dialog { border: 1px solid CanvasText; } .action, .tab { border: 1px solid ButtonText; } }
`;

/** A dialog open now (for the runtime and tests). */
export interface DocumentDialog {
  /** Its host on the page (tests click through it, as a person's pointer does). */
  readonly host: HTMLElement;
  readonly dialog: HTMLDialogElement;
  /** Settles once it is closed (by the person, Escape, the page going away, another dialog, or remove()). */
  readonly closed: Promise<void>;
  /** The preview's document shown now; null for the confirm. */
  shown(): DocumentKind | null;
  /** Takes it away (the document is going, or the extension's UI is removed). */
  remove(): void;
}

interface DialogBase {
  /** The visibility watch the controls' clicks are judged by (tests pass their own); IntersectionObserver v2 by default. */
  watch?: VisibilityWatch;
  /** The page UI's host-maker (tests may pass their own); shadow.ts's by default. */
  host?(doc: Document): UiHost;
}

export interface PreviewDialogOptions extends DialogBase {
  /** The tabs, in this order of DOCUMENT_KINDS; `kind` first shown. */
  kinds: readonly DocumentKind[];
  kind: DocumentKind;
  /** Each document's file name, for the title (none: the title alone). */
  names: Partial<Record<DocumentKind, string>>;
  /** The embedded preview page's address for a document (the extension's preview.html, with the tab and the grant). */
  frameUrl(kind: DocumentKind): string;
  /** "Open In A New Tab": the worker opens the full-window preview page (preview/openTab), inside the person's click. */
  openTab(kind: DocumentKind): void;
}

export interface EditConfirmOptions extends DialogBase {
  /** Continue: the worker opens TailorIT's editable copy (edit/confirmed); `skip` is "Don't show this again". */
  onContinue(skip: boolean): void;
}

/** The dialog open now, per document. */
const open = new WeakMap<Document, DocumentDialog>();

/** A new element with a class. */
function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string): HTMLElementTagNameMap[K] {
  const made = doc.createElement(tag);
  if (className !== undefined) made.className = className;
  return made;
}

/** A button of ours. */
function button(doc: Document, className: string, text: string): HTMLButtonElement {
  const made = element(doc, 'button', className);
  made.type = 'button';
  made.textContent = text;
  return made;
}

/** The frame of one: its host, dialog and head, its gate and its end (module header). Null where none may show. */
function frame(doc: Document, options: DialogBase, kind: 'preview' | 'confirm', title: string) {
  const view = doc.defaultView;
  if (view === null || doc.documentElement === null || doc.visibilityState !== 'visible') return null;
  open.get(doc)?.remove();
  const host = (options.host ?? createUiHost)(doc);
  applyStyles(host.root, DOCUMENT_DIALOG_CSS);
  const watch = options.watch ?? createVisibilityWatch(view as Window & typeof globalThis);
  const dialog = element(doc, 'dialog', kind);
  dialog.dataset.documentDialog = kind;
  const id = `tia-document-${Math.floor(Math.random() * 1e9).toString(36)}`;
  dialog.setAttribute('aria-labelledby', `${id}-title`);
  const head = element(doc, 'div', 'head');
  const titles = element(doc, 'div', 'titles');
  const heading = element(doc, 'h2');
  heading.id = `${id}-title`;
  heading.textContent = title;
  titles.append(heading);
  const close = element(doc, 'button', 'close');
  close.type = 'button';
  close.dataset.dialogAction = 'close';
  close.setAttribute('aria-label', WORDS.close);
  close.title = WORDS.close;
  close.append(svgOf(doc, ICONS.close, 16));
  head.append(titles, close);
  dialog.append(head);

  /** Every control a click is judged on, in Tab's order. */
  const controls: HTMLElement[] = [];
  let done = false;
  let settle: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const finish = () => {
    if (done) return;
    done = true;
    if (open.get(doc)?.dialog === dialog) open.delete(doc);
    view.removeEventListener('pagehide', finish);
    for (const control of controls) watch.unobserve(control);
    if (options.watch === undefined) watch.disconnect();
    if (dialog.open) dialog.close();
    host.remove();
    settle();
  };
  /** A trusted click on one of its controls counts only once that control has been seen long enough (module header).
   *  A refused click does nothing (a box keeps its state). */
  const counts = (event: MouseEvent, control: HTMLElement, keepDefault = false) => {
    if (!keepDefault) event.preventDefault();
    if (event.isTrusted && control.isConnected && watch.shownFor(control, CONTROL_SEEN_MS)) return true;
    if (keepDefault) event.preventDefault();
    log('content.ui-click-refused', { document: true, trusted: event.isTrusted, known: watch.known(control),
      shown: watch.shown(control) });
    return false;
  };
  /** Watches a control, and runs `act` on its counted click. */
  const gate = (control: HTMLElement, act: () => void, keepDefault = false) => {
    controls.push(control);
    watch.observe(control);
    control.addEventListener('click', (event) => {
      if (counts(event, control, keepDefault)) act();
    });
  };
  gate(close, finish);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    if (event.isTrusted) finish();
  });
  dialog.addEventListener('close', finish);
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const order = [...controls, ...dialog.querySelectorAll('iframe')].filter((each) => !each.closest('[hidden]'));
    if (order.length === 0) return;
    event.preventDefault();
    const at = order.indexOf(host.root.activeElement as HTMLElement);
    const next = event.shiftKey ? (at <= 0 ? order.length - 1 : at - 1) : (at === -1 || at === order.length - 1 ? 0 : at + 1);
    order[next]?.focus();
  });
  view.addEventListener('pagehide', finish);
  // v5 p1-shell (the review's S3): a page that restyled the host (put back at once): every control's seen time starts
  // again.
  host.onRestyled(() => {
    for (const control of controls) watch.reset(control);
  });
  /** Shows it (the top layer) with the focus on `first`; null where the document refuses a modal. */
  const show = (made: DocumentDialog, first: HTMLElement): DocumentDialog | null => {
    host.root.append(dialog);
    try {
      dialog.showModal();
    } catch {
      finish();
      return null;
    }
    first.focus({ preventScroll: true });
    open.set(doc, made);
    return made;
  };
  return { host, dialog, titles, heading, close, closed, finish, gate, show };
}

/** The preview dialog (module header), shown at once; null where none may show (a hidden tab, a modal refused). */
export function showPreviewDialog(doc: Document, options: PreviewDialogOptions): DocumentDialog | null {
  const kinds = DOCUMENT_KINDS.filter((each) => options.kinds.includes(each));
  if (!kinds.includes(options.kind)) return null;
  const base = frame(doc, options, 'preview', WORDS.titles[options.kind]);
  if (base === null) return null;
  const { dialog, titles, heading, gate } = base;
  let current: DocumentKind = options.kind;
  const file = element(doc, 'span', 'file');
  file.dataset.documentFile = '';
  titles.append(file);

  const strip = element(doc, 'div', 'strip');
  const tabs = element(doc, 'div', 'tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', WORDS.tabsLabel);
  tabs.hidden = kinds.length < 2;
  const body = element(doc, 'div', 'body');
  body.setAttribute('role', 'tabpanel');
  const tabButtons = new Map<DocumentKind, HTMLButtonElement>();
  const ids = `${heading.id}-tab`;
  let frameEl: HTMLIFrameElement | null = null;

  /** Shows `kind`: its title, its tab selected, and a new frame of its own (the one before goes with its document). */
  const choose = (kind: DocumentKind) => {
    current = kind;
    heading.textContent = WORDS.titles[kind];
    const name = options.names[kind];
    file.textContent = name ?? '';
    file.hidden = name === undefined;
    if (name !== undefined) file.title = name;
    for (const [each, tab] of tabButtons) tab.setAttribute('aria-selected', String(each === kind));
    body.setAttribute('aria-labelledby', `${ids}-${kind}`);
    dialog.dataset.documentShown = kind;
    const next = element(doc, 'iframe');
    next.title = WORDS.frames[kind];
    next.referrerPolicy = 'no-referrer';
    next.dataset.documentFrame = kind;
    next.src = options.frameUrl(kind);
    if (frameEl === null) body.append(next);
    else frameEl.replaceWith(next);
    frameEl = next;
  };
  for (const kind of kinds) {
    const tab = button(doc, 'tab', WORDS.tabs[kind]);
    tab.id = `${ids}-${kind}`;
    tab.setAttribute('role', 'tab');
    tab.dataset.documentTab = kind;
    tabButtons.set(kind, tab);
    tabs.append(tab);
    gate(tab, () => {
      if (current !== kind) choose(kind);
    });
  }
  const newTab = button(doc, 'newtab', WORDS.openTab);
  newTab.dataset.dialogAction = 'open-tab';
  gate(newTab, () => {
    options.openTab(current);
    base.finish();
  });
  strip.append(tabs, newTab);
  dialog.append(strip, body);
  choose(options.kind);
  return base.show({ host: base.host.host, dialog, closed: base.closed, shown: () => current, remove: base.finish },
    base.close);
}

/** The upload edit confirm (module header), shown at once; null where none may show. */
export function showEditConfirm(doc: Document, options: EditConfirmOptions): DocumentDialog | null {
  const base = frame(doc, options, 'confirm', WORDS.editTitle);
  if (base === null) return null;
  const { dialog, gate } = base;
  const text = element(doc, 'p', 'text');
  text.id = `${base.heading.id}-text`;
  text.textContent = WORDS.editText;
  dialog.setAttribute('aria-describedby', text.id);
  dialog.setAttribute('role', 'alertdialog');
  const label = element(doc, 'label', 'check');
  const box = element(doc, 'input');
  box.type = 'checkbox';
  box.dataset.dialogSetting = 'dont-show';
  label.append(box, WORDS.dontShow);
  // The box's own click: counted as any control's (a refused one leaves it as it was).
  gate(box, () => undefined, true);
  const actions = element(doc, 'div', 'actions');
  const cancel = button(doc, 'action cancel', WORDS.cancel);
  cancel.dataset.dialogAction = 'cancel';
  const go = button(doc, 'action continue', WORDS.continue);
  go.dataset.dialogAction = 'continue';
  gate(cancel, base.finish);
  gate(go, () => {
    options.onContinue(box.checked);
    base.finish();
  });
  actions.append(cancel, go);
  dialog.append(text, label, actions);
  return base.show({ host: base.host.host, dialog, closed: base.closed, shown: () => null, remove: base.finish },
    cancel);
}

/** The dialog open in `doc` now, or null (tests). */
export function documentDialogShown(doc: Document): DocumentDialog | null {
  return open.get(doc) ?? null;
}
