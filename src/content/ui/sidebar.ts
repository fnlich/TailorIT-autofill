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
 * to the worker instead (`options`: its fragment), on the same trusted, seen click.
 * The frame keeps nothing of the views once it closes: they are unmounted (their ports closed), and mounted afresh at
 * the next opening.
 */
import { PAGE_COPY } from '../../shared/copy';
import { log } from '../../shared/log';
import type { SidebarApp, SidebarMount } from '../../shared/sidebar';
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
}

/** The sidebar's frame, drawn. */
export interface SidebarFrame {
  readonly el: HTMLElement;
  /** Where the views render. */
  readonly container: HTMLElement;
  readonly open: boolean;
  /** Opens the frame with the views of `app` mounted for the tab `tabId`; false, and nothing shows, when they could not
   *  be mounted. */
  show(app: SidebarApp, tabId: number): boolean;
  /** Closes it, the views unmounted. */
  hide(): void;
  destroy(): void;
}

/** The click types the frame's controls answer. */
const CLICKS = ['click', 'auxclick', 'dblclick'] as const;

/** A settings page fragment the worker opens (messaging/schemas.ts sidebar/options). */
const SECTION = /^[a-z][a-z-]{0,39}$/;

/** Whether `href` is one of the extension's own pages: its host is the extension's id, on an extension scheme. */
function ownPage(href: string, ownId: string | undefined): boolean {
  if (ownId === undefined) return false;
  try {
    const url = new URL(href);
    return url.hostname === ownId && /extension:$/.test(url.protocol);
  } catch {
    return false;
  }
}

/** Builds the frame (hidden) for the extension `ownId` (whose pages a page may not open). */
export function createSidebarFrame(doc: Document, options: { visibility: SidebarVisibility; ownId: string | undefined;
  handlers: SidebarFrameHandlers }): SidebarFrame {
  const { visibility, handlers, ownId } = options;
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

  /** The settings page's fragment a click's link names, or undefined (null: no such link). */
  const ownLink = (event: Event): { section: string | undefined } | null => {
    const path = event.composedPath();
    const at = path.indexOf(el);
    const anchor = path.slice(0, at < 0 ? path.length : at).find((node) => (node as Element).nodeType === 1
      && (node as Element).tagName === 'A') as HTMLAnchorElement | undefined;
    if (anchor === undefined || !ownPage(anchor.href, ownId)) return null;
    const hash = anchor.hash.replace(/^#/, '');
    return { section: SECTION.test(hash) ? hash : undefined };
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
    if (!visibility.shownFor(el, CONTROL_SEEN_MS) || !landedInside(event, el, '.sidebar__body')) {
      log('content.ui-click-refused', { launcher: false, panel: true, sidebar: true });
      stop();
      return;
    }
    const link = event.type === 'click' ? ownLink(event) : null;
    if (link !== null) {
      // A page may not open the extension's own pages: the worker opens it, in a tab of its own.
      event.preventDefault();
      handlers.options(link.section);
    }
  };
  for (const type of CLICKS) el.addEventListener(type, gate, { capture: true });
  visibility.observe(el);

  let mounted: SidebarMount | null = null;
  let destroyed = false;

  const unmount = () => {
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
    show(app, tabId) {
      if (destroyed) return false;
      if (!el.hidden) return true;
      el.hidden = false;
      try {
        mounted = app.mount({ container, tabId, minimise: () => handlers.minimised() });
      } catch {
        el.hidden = true;
        unmount();
        return false;
      }
      visibility.reset(el);
      return true;
    },
    hide() {
      if (el.hidden) return;
      el.hidden = true;
      unmount();
    },
    destroy() {
      destroyed = true;
      el.hidden = true;
      unmount();
      el.remove();
    },
  };
}
