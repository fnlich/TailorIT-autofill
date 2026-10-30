/*
 * The in-page UI, put together (docs/design/runtime.md §10.1): the host and its closed shadow root (shadow.ts), the one
 * stylesheet (styles.ts), the launcher, the notices and the policy card, and the highlights, all vanilla DOM. The
 * in-page review panel (content/ui/panel.tsx, the only React in the content script) arrives in Phase 6.
 * - The launcher and the notices sit at the form root's top-right corner in document coordinates, measured against the
 *   host, because fixed positioning would land off-screen in an embedded form whose iframe grows to fit its content.
 * - Everything is re-measured in one animation frame, throttled, on scroll (any scroller, caught in the capture phase),
 *   on resize and when the form root changes size; positions never use a timer.
 * - The runtime decides what each control does; this file only draws and reports trusted clicks.
 */
import { createHighlights, type HighlightItem } from './highlights';
import { createLauncher, type LauncherAction, type LauncherView } from './launcher';
import { createNotices, type NoticeCode, type PolicyChoice } from './notices';
import { createUiHost } from './shadow';
import type { StyleMode } from './styles';

/** The launcher's size, and its inset from the form root's corner. */
export const LAUNCHER_PX = 32;
const INSET_PX = 8;

/** What the person's trusted clicks ask for. */
export interface PageUiHandlers {
  onLauncher(action: LauncherAction): void;
  onPolicyChoice(choice: PolicyChoice): void;
}

/** The mounted in-page UI. */
export interface PageUi {
  readonly host: HTMLElement;
  /** The closed root: only the content script holds it (tests read through it). */
  readonly shadow: ShadowRoot;
  readonly styleMode: StyleMode;
  readonly launcher: { readonly el: HTMLButtonElement; readonly view: LauncherView };
  readonly notices: { readonly shown: readonly NoticeCode[]; readonly cardShown: boolean };
  readonly highlightCount: number;
  readonly focusShown: boolean;
  /** The element the launcher and notices are anchored to: the form root (null: nothing to anchor, launcher hidden). */
  anchorTo(root: Element | null): void;
  setLauncher(view: LauncherView): void;
  setNotices(codes: readonly NoticeCode[]): void;
  /** A new run: notices the person dismissed show again. */
  resetNotices(): void;
  showPolicyCard(options: { fromStoredCopy: boolean }): void;
  hidePolicyCard(): void;
  setHighlights(items: readonly HighlightItem[]): void;
  /** Outlines one field on request (field/focus), after the caller scrolled it into view; null removes it. */
  showFocus(elements: readonly Element[] | null): void;
  /** Re-measures in the next animation frame. */
  refresh(): void;
  destroy(): void;
}

/** Mounts the in-page UI on `doc`. */
export function mountPageUi(doc: Document, handlers: PageUiHandlers): PageUi {
  const view = doc.defaultView;
  const mounted = createUiHost(doc);
  const { root } = mounted;
  const layer = doc.createElement('div');
  layer.className = 'layer';
  const highlightLayer = doc.createElement('div');
  highlightLayer.className = 'highlights';
  const anchor = doc.createElement('div');
  anchor.className = 'anchor';
  const launcher = createLauncher(doc, (action) => handlers.onLauncher(action));
  const notices = createNotices(doc, (choice) => handlers.onPolicyChoice(choice));
  anchor.append(launcher.el, notices.el);
  layer.append(highlightLayer, anchor);
  root.append(layer);
  const highlights = createHighlights(doc, highlightLayer);

  let anchorRoot: Element | null = null;
  let frame: number | null = null;
  const lifetime = new AbortController();
  const resizes = view !== null && typeof view.ResizeObserver === 'function'
    ? new view.ResizeObserver(() => schedule()) : null;

  function layout(): void {
    frame = null;
    if (!mounted.host.isConnected) return;
    const hostRect = mounted.host.getBoundingClientRect();
    if (anchorRoot === null || !anchorRoot.isConnected) {
      anchor.hidden = true;
    } else {
      anchor.hidden = false;
      const rect = anchorRoot.getBoundingClientRect();
      const right = Math.max(rect.right, rect.left + LAUNCHER_PX + INSET_PX * 2);
      const left = Math.max(0, right - hostRect.left - INSET_PX - LAUNCHER_PX);
      const top = Math.max(0, rect.top - hostRect.top + INSET_PX);
      // The anchor's right edge is the launcher's, so the notices under it line up with the form's corner.
      anchor.style.left = `${left + LAUNCHER_PX}px`;
      anchor.style.top = `${top}px`;
      anchor.style.transform = 'translateX(-100%)';
    }
    highlights.render(hostRect);
  }

  function schedule(): void {
    if (frame !== null || view === null) return;
    frame = view.requestAnimationFrame(layout);
  }

  if (view !== null) {
    view.addEventListener('scroll', schedule, { capture: true, passive: true, signal: lifetime.signal });
    view.addEventListener('resize', schedule, { passive: true, signal: lifetime.signal });
  }

  return {
    host: mounted.host,
    shadow: root,
    styleMode: mounted.styleMode,
    launcher,
    notices,
    get highlightCount() {
      return highlights.count;
    },
    get focusShown() {
      return highlights.focusShown;
    },
    anchorTo(next) {
      if (anchorRoot !== null) resizes?.unobserve(anchorRoot);
      anchorRoot = next;
      if (next !== null) resizes?.observe(next);
      layout();
    },
    setLauncher(next) {
      launcher.set(next);
    },
    setNotices(codes) {
      notices.set(codes);
      schedule();
    },
    resetNotices() {
      notices.reset();
    },
    showPolicyCard(options) {
      notices.showPolicyCard(options);
      schedule();
    },
    hidePolicyCard() {
      notices.hidePolicyCard();
      schedule();
    },
    setHighlights(items) {
      highlights.set(items);
      layout();
    },
    showFocus(elements) {
      highlights.showFocus(elements);
      layout();
    },
    refresh: schedule,
    destroy() {
      lifetime.abort();
      resizes?.disconnect();
      if (frame !== null) view?.cancelAnimationFrame(frame);
      frame = null;
      mounted.remove();
    },
  };
}
