/*
 * v5 p1-shell (PLAN decision 1, Jobright's docked panel, read for behaviour only): the sidebar's frame, in the page
 * UI's closed shadow root of the tab's top frame. A white column SIDEBAR_WIDTH_PX wide (384), fixed at the window's
 * right edge from top to bottom, a 1 px line on its left and a soft shadow, scrolling on its own; it holds a container
 * the sidebar's bundle (shared/sidebar.ts, injected by the worker) mounts the side panel's views into. The page UI
 * pushes the page left while it is open (push.ts), hides the launcher meanwhile, and keeps the toasts left of it.
 * Every click in it must be the person's, as the in-page panel's (panel.ts): a capture listener on the frame stops
 * any untrusted click before the views hear it, and any trusted one made before the frame had been seen, without a
 * break, for CONTROL_SEEN_MS (IntersectionObserver v2, visible.ts; the audit of 2026-11-06, S-1), or that did not land
 * on what was seen (landed.ts: inside the frame, inside its scrolling body, on the control). The main button's own hold
 * (ui/panel/seen.ts) stands inside it. A link to the extension's own settings page, which a page may not open, is sent
 * to the worker instead (`options`: its fragment), on the same trusted, seen click; a link to Chrome's side panel
 * (sidepanel.html: what the sidebar leaves to the extension's own pages, the review's S6 and S7) asks the worker to
 * open it (`sidePanel`), inside that click.
 * The review of 2026-11-08:
 * - S2: a step's or the main button's click (`[data-step-action]`, `[data-main-action]`: Continue, Submit Application,
 *   Submit Anyway, Autofill) counts only once that button itself has been seen, as drawn, for CONTROL_SEEN_MS: each is
 *   watched as the views draw it, its time starts again whenever its meaning changes (its action, its words, its being
 *   hidden; never its being enabled, which the views' own hold decides: ui/panel/seen.ts), and one never watched never
 *   counts (failing closed).
 * - S3: a page may restyle what holds our UI (an html transform, say) to move or enlarge the sidebar under the
 *   person's pointer. A click counts only while the sidebar stands where it is drawn (its right edge at the window's,
 *   its top at the window's, SIDEBAR_WIDTH_PX wide or the window's width when narrower, the window's height; 1 px of
 *   slack; a CSS zoom on the page between ZOOM_RANGE scales the width), and its seen time starts again whenever its box
 *   changes (read every BOX_CHECK_MS while it is open) or is not where it is drawn. The host's own style is put back at
 *   once by shadow.ts.
 * - S4: a page's document.execCommand edits the box that has the focus with trusted input events. An edit counts only
 *   when the person's own trusted keystroke, paste, cut, drop or composition (or Chrome's beforeinput, which
 *   execCommand never fires) on that box came first, in the same task; any other input in a text box of the sidebar is
 *   stopped before the views hear it, and the box gets back the value it held.
 * The frame keeps nothing of the views once it closes: they are unmounted (their ports closed), and mounted afresh at
 * the next opening.
 */
import { every, startDeadline, type Cancel } from '../../dom/time';
import { PAGE_COPY } from '../../shared/copy';
import { log } from '../../shared/log';
import { SIDEBAR_WIDTH_PX, type SidebarApp, type SidebarMount } from '../../shared/sidebar';
import { landedInside } from './landed';
import { CONTROL_SEEN_MS } from './visible';

/** What the frame needs of the page UI's visibility watch (visible.ts). */
export interface SidebarVisibility {
  observe(el: Element): void;
  reset(el: Element): void;
  shownFor(el: Element, ms: number): boolean;
}

/** What the frame tells the page UI. */
export interface SidebarFrameHandlers {
  /** The views' minimise: the sidebar folds back to the launcher. */
  minimised(): void;
  /** A trusted, seen click on a link to the extension's settings page: `section`, its fragment (none: its top). */
  options(section: string | undefined): void;
  /** The review's S6 and S7: a trusted, seen click on a link to Chrome's side panel (sidepanel.html), inside the click. */
  sidePanel?(): void;
}

/** The sidebar's frame, drawn. */
export interface SidebarFrame {
  readonly el: HTMLElement;
  /** Where the views render. */
  readonly container: HTMLElement;
  readonly open: boolean;
  /** Opens the frame with the views of `app` mounted for the tab `tabId`; false, and nothing shows, when they could not
   *  be mounted. `byItself`: the sidebar opened by itself, not on the person's click (shared/sidebar.ts). */
  show(app: SidebarApp, tabId: number, byItself?: boolean): boolean;
  /** Closes it, the views unmounted. */
  hide(): void;
  /** S3: whether it stands where it is drawn now. */
  inPlace(): boolean;
  destroy(): void;
}

/** The click types the frame's controls answer. */
const CLICKS = ['click', 'auxclick', 'dblclick'] as const;

/** S2: the buttons whose click starts or presses something: watched each, and counted only once seen as drawn. */
const HELD_BUTTONS = '[data-step-action], [data-main-action]';

/** S3: how often the frame's box is read while it is open. */
export const BOX_CHECK_MS = 100;

/** S3: the CSS zoom on the page the frame's width may follow (a page drawn at 90 %, say), and no more. */
const ZOOM_RANGE = [0.5, 1.5] as const;

/** S4: the events by which the person edits a text box themselves (trusted ones only). */
const EDITS = ['keydown', 'paste', 'cut', 'drop', 'compositionstart', 'compositionupdate', 'compositionend',
  'beforeinput'] as const;

/** S4: the input types that take typed text (execCommand edits these). */
const TEXT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);

/** A settings page fragment the worker opens (messaging/schemas.ts sidebar/options). */
const SECTION = /^[a-z][a-z-]{0,39}$/;

/** Which of the extension's own pages `href` is (its host the extension's id, on an extension scheme), or null. */
function ownPage(href: string, ownId: string | undefined): 'side-panel' | 'options' | null {
  if (ownId === undefined) return null;
  try {
    const url = new URL(href);
    if (url.hostname !== ownId || !/extension:$/.test(url.protocol)) return null;
    return url.pathname === '/sidepanel.html' ? 'side-panel' : 'options';
  } catch {
    return null;
  }
}

/** S4: the text box an event is for (the first element on its path), or null. */
function textBoxOf(event: Event): HTMLInputElement | HTMLTextAreaElement | null {
  const target = event.composedPath()[0] as Element | undefined;
  if (target === undefined || target.nodeType !== 1) return null;
  if (target.tagName === 'TEXTAREA') return target as HTMLTextAreaElement;
  if (target.tagName === 'INPUT' && TEXT_TYPES.has((target as HTMLInputElement).type)) return target as HTMLInputElement;
  return null;
}

/** Builds the frame (hidden) for the extension `ownId` (whose pages a page may not open). */
export function createSidebarFrame(doc: Document, options: { visibility: SidebarVisibility; ownId: string | undefined;
  handlers: SidebarFrameHandlers }): SidebarFrame {
  const { visibility, handlers, ownId } = options;
  const view = doc.defaultView;
  const el = doc.createElement('aside');
  el.className = 'sidebar';
  el.dataset.sidebar = '';
  el.setAttribute('aria-label', PAGE_COPY.sidebar.region);
  el.hidden = true;
  const body = doc.createElement('div');
  body.className = 'sidebar__body';
  const container = doc.createElement('div');
  container.className = 'sidebar__app';
  body.append(container);
  el.append(body);

  /** The extension page a click's link names, and its fragment, or null (no such link). */
  const ownLink = (event: Event): { page: 'side-panel' | 'options'; section: string | undefined } | null => {
    const path = event.composedPath();
    const at = path.indexOf(el);
    const anchor = path.slice(0, at < 0 ? path.length : at).find((node) => (node as Element).nodeType === 1
      && (node as Element).tagName === 'A') as HTMLAnchorElement | undefined;
    const page = anchor === undefined ? null : ownPage(anchor.href, ownId);
    if (anchor === undefined || page === null) return null;
    const hash = anchor.hash.replace(/^#/, '');
    return { page, section: SECTION.test(hash) ? hash : undefined };
  };

  /** S3: whether the frame stands where it is drawn (module header). */
  const inPlace = (): boolean => {
    if (view === null || el.hidden) return false;
    const box = el.getBoundingClientRect();
    const zoom = (el as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom ?? 1;
    if (zoom < ZOOM_RANGE[0] || zoom > ZOOM_RANGE[1]) return false;
    const root = doc.documentElement;
    const width = Math.min(SIDEBAR_WIDTH_PX * zoom, view.innerWidth);
    return Math.abs(box.right - root.clientWidth) <= 1 && Math.abs(box.top) <= 1 && Math.abs(box.width - width) <= 1
      && [view.innerHeight, root.clientHeight].some((height) => Math.abs(box.height - height) <= 1);
  };

  // The person's clicks only (the module header), judged at the click, before the views' handlers run in the same
  // dispatch, and never later.
  const gate = (event: Event) => {
    const stop = () => {
      event.stopImmediatePropagation();
      event.preventDefault();
    };
    if (!event.isTrusted) {
      stop();
      return;
    }
    // S2: a step's or the main button's click, once that button itself has been seen as drawn (never watched: never).
    const button = event.composedPath().find((node) => (node as Element).nodeType === 1
      && (node as Element).matches?.(HELD_BUTTONS)) as Element | undefined;
    const placed = inPlace();
    if (!placed) visibility.reset(el);
    if (!placed || !visibility.shownFor(el, CONTROL_SEEN_MS) || !landedInside(event, el, '.sidebar__body')
      || (button !== undefined && !visibility.shownFor(button, CONTROL_SEEN_MS))) {
      log('content.ui-click-refused', { launcher: false, panel: true, sidebar: true, placed, dock: button !== undefined });
      stop();
      return;
    }
    const link = event.type === 'click' ? ownLink(event) : null;
    if (link !== null) {
      // A page may not open the extension's own pages: the worker opens them, the settings page in a tab of its own,
      // Chrome's side panel beside the page.
      event.preventDefault();
      if (link.page === 'side-panel') handlers.sidePanel?.();
      else handlers.options(link.section);
    }
  };
  for (const type of CLICKS) el.addEventListener(type, gate, { capture: true });
  visibility.observe(el);

  // S2: the held buttons, watched as the views draw them; a changed meaning starts their time again.
  const restart = (node: Node | null) => {
    const element = node === null ? null : node.nodeType === 1 ? node as Element : node.parentElement;
    const button = element?.closest(HELD_BUTTONS) ?? null;
    if (button !== null && container.contains(button)) visibility.reset(button);
  };
  const drawn = view === null ? null : new view.MutationObserver((records) => {
    for (const record of records) {
      restart(record.target);
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        const added = node as Element;
        for (const button of [...(added.matches(HELD_BUTTONS) ? [added] : []), ...added.querySelectorAll(HELD_BUTTONS)]) {
          visibility.reset(button);
        }
      }
    }
  });
  drawn?.observe(container, { subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['data-step-action', 'data-main-action', 'hidden'] });

  // S4: the person's own edits of the sidebar's text boxes (module header).
  const granted = new WeakMap<Element, number>();
  const held = new WeakMap<Element, string>();
  const grant = (event: Event) => {
    if (!event.isTrusted) return;
    const box = textBoxOf(event);
    if (box === null) return;
    if (!held.has(box)) held.set(box, box.value);
    granted.set(box, (granted.get(box) ?? 0) + 1);
    // Until the task ends: the edit it makes is dispatched in the same task.
    startDeadline(0, () => granted.delete(box));
  };
  for (const type of EDITS) el.addEventListener(type, grant, { capture: true });
  el.addEventListener('focusin', (event) => {
    const box = textBoxOf(event);
    if (box !== null) held.set(box, box.value);
  }, { capture: true });
  el.addEventListener('input', (event) => {
    const box = textBoxOf(event);
    if (box === null) return;
    const left = granted.get(box) ?? 0;
    if (event.isTrusted && left > 0) {
      granted.set(box, left - 1);
      held.set(box, box.value);
      return;
    }
    // Not the person's edit: the views never hear it, and the box shows what it held.
    event.stopImmediatePropagation();
    const before = held.get(box);
    if (before !== undefined && box.value !== before) box.value = before;
    log('content.ui-input-refused', { sidebar: true, trusted: event.isTrusted });
  }, { capture: true });

  let mounted: SidebarMount | null = null;
  let destroyed = false;
  /** S3: the frame's box last read, and the watch over it while open. */
  let box = '';
  let boxWatch: Cancel | null = null;
  const readBox = () => {
    const now = el.getBoundingClientRect();
    const read = [now.left, now.top, now.width, now.height].map((value) => Math.round(value)).join(',');
    if (read !== box || !inPlace()) visibility.reset(el);
    box = read;
  };

  const unmount = () => {
    boxWatch?.();
    boxWatch = null;
    box = '';
    const was = mounted;
    mounted = null;
    try {
      was?.unmount();
    } catch {
      // The views are gone either way.
    }
    container.replaceChildren();
  };

  return {
    el,
    container,
    get open() {
      return !el.hidden;
    },
    show(app, tabId, byItself = false) {
      if (destroyed) return false;
      if (!el.hidden) return true;
      el.hidden = false;
      try {
        mounted = app.mount({ container, tabId, minimise: () => handlers.minimised(), byItself });
      } catch {
        el.hidden = true;
        unmount();
        return false;
      }
      visibility.reset(el);
      boxWatch = every(BOX_CHECK_MS, readBox);
      return true;
    },
    hide() {
      if (el.hidden) return;
      el.hidden = true;
      unmount();
    },
    inPlace,
    destroy() {
      destroyed = true;
      el.hidden = true;
      drawn?.disconnect();
      unmount();
      el.remove();
    },
  };
}
