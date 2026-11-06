/*
 * The in-page UI's host (docs/design/runtime.md §10.1; docs/ARCHITECTURE.md "UI"): one div on the document element,
 * outside any framework's root, holding a closed shadow root made from the isolated world, so page scripts can neither
 * reach the root nor patch attachShadow for it. The host is registered with the DOM layer (registerOwnUiHost), so the
 * scanner, the raw scan and the visibility checks never treat the extension's own UI as page content.
 * - Its styles are inline with !important, set through the CSSOM: they beat every page stylesheet, and a page's CSP
 *   does not govern them. It is a zero-size box at the document's origin that lets clicks through (pointer-events
 *   none); only the launcher, the notices and the card take pointer events.
 * - Events stop propagating at the host, so page listeners in the bubble phase never see what the person does in our
 *   UI (capture-phase listeners above the host cannot be kept out, and need not be: the host carries no page data).
 *   The audit of 2026-11-06 (S-8): every composed event a person's use of our UI makes, not only clicks and keys: the
 *   text events that carry what they type (textInput, beforeinput, input, the composition events), the clipboard's
 *   (paste, cut, copy), a drag's (dragstart to drop, whose data a page could read) and the pointer's and mouse's
 *   moves, so the instruction typed into Edit with AI's box reaches no bubbling listener of the page.
 * - A page that removes the host gets it back, at most MAX_REATTACH times; after that it stays gone, the run carries
 *   on without it (the side panel mirrors everything), and the loss is logged.
 */
import { registerOwnUiHost } from '../../dom/own-ui';
import { log } from '../../shared/log';
import { applyStyles, type StyleMode } from './styles';

/** A page that removes the host gets it back at most this many times. */
export const MAX_REATTACH = 3;

/** The host's inline styles, each set with !important. */
const HOST_STYLE: ReadonlyArray<readonly [string, string]> = [
  ['all', 'initial'],
  ['display', 'block'],
  ['position', 'absolute'],
  ['top', '0'],
  ['left', '0'],
  ['width', '0'],
  ['height', '0'],
  ['margin', '0'],
  ['padding', '0'],
  ['border', '0'],
  ['overflow', 'visible'],
  ['visibility', 'visible'],
  ['opacity', '1'],
  ['transform', 'none'],
  ['filter', 'none'],
  ['clip-path', 'none'],
  ['pointer-events', 'none'],
  ['z-index', '2147483647'],
];

/** Events the host keeps from bubbling into the page: every composed UI event a person's use of our UI makes (the
 *  audit of 2026-11-06, S-8). `change` and `select` are not composed (they never leave the closed root) and are listed
 *  for safety. */
export const CONTAINED_EVENTS = ['click', 'dblclick', 'auxclick', 'contextmenu', 'mousedown', 'mouseup', 'mousemove',
  'mouseover', 'mouseout', 'pointerdown', 'pointerup', 'pointermove', 'pointerover', 'pointerout', 'pointercancel',
  'gotpointercapture', 'lostpointercapture', 'touchstart', 'touchend', 'touchmove', 'touchcancel', 'keydown', 'keyup',
  'keypress', 'focusin', 'focusout', 'input', 'change', 'beforeinput', 'textInput', 'compositionstart',
  'compositionupdate', 'compositionend', 'paste', 'cut', 'copy', 'select', 'selectstart', 'selectionchange', 'drag',
  'dragstart', 'dragend', 'dragenter', 'dragover', 'dragleave', 'drop', 'wheel'] as const;

/** The mounted host. */
export interface UiHost {
  readonly host: HTMLElement;
  /** The closed root. Only the content script holds this reference; the page can never reach it. */
  readonly root: ShadowRoot;
  readonly styleMode: StyleMode;
  /** How many times the host was put back after the page removed it. */
  reattachments(): number;
  /** Removes the host for good (the run ended for invalidation, or the document is going away). */
  remove(): void;
}

/** Creates the host on `doc`'s document element, with its closed root and stylesheet. */
export function createUiHost(doc: Document, options: { maxReattach?: number } = {}): UiHost {
  const maxReattach = options.maxReattach ?? MAX_REATTACH;
  const host = doc.createElement('div');
  for (const [name, value] of HOST_STYLE) host.style.setProperty(name, value, 'important');
  const root = host.attachShadow({ mode: 'closed' });
  registerOwnUiHost(host);
  const styleMode = applyStyles(root);
  const stop = (event: Event) => event.stopPropagation();
  for (const type of CONTAINED_EVENTS) host.addEventListener(type, stop);

  let reattached = 0;
  let removed = false;
  const view = doc.defaultView;
  const observer = view === null ? null : new view.MutationObserver(() => {
    if (removed || host.isConnected) return;
    if (reattached >= maxReattach) {
      observer?.disconnect();
      log('content.ui-removed', { reattached });
      return;
    }
    const parent = doc.documentElement;
    if (parent === null) return;
    reattached += 1;
    parent.append(host);
    watch();
    log('content.ui-reattached', { reattached });
  });
  function watch(): void {
    observer?.observe(doc, { childList: true });
    if (doc.documentElement !== null) observer?.observe(doc.documentElement, { childList: true });
  }

  (doc.documentElement ?? doc.body)?.append(host);
  watch();
  return {
    host,
    root,
    styleMode,
    reattachments: () => reattached,
    remove() {
      removed = true;
      observer?.disconnect();
      host.remove();
    },
  };
}
