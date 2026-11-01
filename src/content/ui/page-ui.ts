/*
 * The in-page UI, put together (docs/design/runtime.md §10.1): the host and its closed shadow root (shadow.ts), the one
 * stylesheet (styles.ts), the launcher, the notices and the policy card, and the highlights, all vanilla DOM; and the
 * in-page review panel (panel.tsx, the only React in the content script), under the notices in the anchor's column,
 * so it never covers the launcher or the card. While it is open the notice stack hides its plain notices (the panel
 * shows them all); the card stays, since only it has the decision's buttons in the page. In a small embedded frame
 * (panelFits false) the panel does not open: the runtime opens the side panel instead.
 * - The launcher and the notices sit at the form root's top-right corner in document coordinates, measured against the
 *   host, because fixed positioning would land off-screen in an embedded form whose iframe grows to fit its content.
 * - Everything is re-measured in one animation frame, throttled, on scroll (any scroller, caught in the capture phase),
 *   on resize and when the form root changes size; positions never use a timer.
 * - The runtime decides what each control does; this file only draws and reports trusted clicks, and only those a
 *   person could have meant (S5): the launcher's and the policy card's buttons are watched with IntersectionObserver
 *   v2 (visible.ts), and a trusted click counts only while the control it lands on is visible. A page layer drawn over
 *   the launcher that lets clicks through (a decoy reading "Continue") makes the launcher not visible, so the click
 *   harvested through it does nothing (logged as content.ui-click-refused). The launcher must have been seen before
 *   the click, since Open review has to reach the worker inside it; a card button just shown is waited for (capped),
 *   since its choice needs no user gesture.
 * - launcherShown() is the frame's own visibility on its page (S1): a frame the page around it hides (opacity 0,
 *   off-screen, in a zero-height wrapper) has a launcher that is not visible, which no check inside the frame can see.
 * - Edit with AI (the owner's amendments, ai-edits.ts): its buttons sit in their own layer, beside the highlights and
 *   not hidden from assistive technology, each watched like a card button: a trusted click counts only while the
 *   button is visible (a button just drawn waits for the watch's first word, capped).
 */
import { log } from '../../shared/log';
import type { FrameReport } from '../../shared/report';
import { createAiEdits, type AiEditItem } from './ai-edits';
import { createHighlights, type HighlightItem } from './highlights';
import { createLauncher, type LauncherAction, type LauncherView } from './launcher';
import { createNotices, type NoticeCode, type PolicyChoice } from './notices';
import { createInPagePanel, type InPagePanel, type PanelActions } from './panel';
import { createUiHost } from './shadow';
import type { StyleMode } from './styles';
import { createVisibilityWatch } from './visible';

/** The launcher's size, and its inset from the form root's corner. */
export const LAUNCHER_PX = 32;
const INSET_PX = 8;

/** An embedded frame smaller than this (its own viewport, in CSS pixels) is too small for the in-page panel: the
 *  launcher's Open review opens the side panel instead. The top frame always has room. */
export const PANEL_MIN_VIEWPORT = { width: 420, height: 360 } as const;

/** What the person's trusted clicks ask for. */
export interface PageUiHandlers {
  onLauncher(action: LauncherAction): void;
  onPolicyChoice(choice: PolicyChoice): void;
  /** Edit with AI on one field (the owner's amendments): a trusted click on its visible button. */
  onAiEdit?(key: string): void;
  /** The in-page panel's actions, for this frame's own fields, and this frame's id (none: no panel is made). */
  panel?: PanelActions & { frameId(): number | null };
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
  /** The Edit with AI buttons (ai-edits.ts): one per item; [] removes them all. */
  setAiEdits(items: readonly AiEditItem[]): void;
  /** The Edit with AI buttons drawn now (for tests). */
  readonly aiEditButtons: readonly HTMLButtonElement[];
  /** Outlines one field on request (field/focus), after the caller scrolled it into view; null removes it. */
  showFocus(elements: readonly Element[] | null): void;
  /** The in-page panel (null when the handlers gave it no actions). */
  readonly panel: InPagePanel | null;
  /** Whether this frame has room for the in-page panel: the top frame always, an embedded one at PANEL_MIN_VIEWPORT. */
  panelFits(): boolean;
  /** Opens the in-page panel; false, and nothing opens, when the frame has no room for it or there is no panel. */
  openPanel(): boolean;
  closePanel(): void;
  /** The tab's combined report (report/update), for the panel. */
  updatePanel(reports: readonly FrameReport[]): void;
  /** Whether a person can see the launcher where it is drawn now (IntersectionObserver v2), once the watch knows; false
   *  when it is not known within the cap, or `signal` aborts. A frame its page hides answers false (S1). `fresh`: what
   *  the watch knew is forgotten first, so the answer is a notification that comes after this call (the check before
   *  a later pass, L-S4: the page may have hidden the frame a moment ago, and Chromium tells of a change only at its
   *  next notification). */
  launcherShown(signal?: AbortSignal, fresh?: boolean): Promise<boolean>;
  /** What the visibility watch last said of one of our controls (the launcher, a card button); null: not known yet. */
  visibleNow(el: Element): boolean | null;
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
  const aiEditLayer = doc.createElement('div');
  aiEditLayer.className = 'ai-edits';
  const anchor = doc.createElement('div');
  anchor.className = 'anchor';
  const visibility = createVisibilityWatch(view as (Window & typeof globalThis) | null);
  const launcher = createLauncher(doc, (action) => {
    // Open review must go out inside the click, so the launcher must already have been seen: no waiting here.
    if (visibility.shown(launcher.el)) handlers.onLauncher(action);
    else log('content.ui-click-refused', { launcher: true, known: visibility.known(launcher.el) });
  });
  const notices = createNotices(doc, (choice, button) => {
    if (visibility.known(button)) {
      if (visibility.shown(button)) handlers.onPolicyChoice(choice);
      else log('content.ui-click-refused', { launcher: false, known: true });
      return;
    }
    // The card has just been shown: its choice needs no user gesture, so the click waits for the watch's first word.
    void visibility.settled(button, lifetime.signal).then((shown) => {
      if (shown && notices.cardShown) handlers.onPolicyChoice(choice);
      else log('content.ui-click-refused', { launcher: false, known: visibility.known(button) });
    });
  });
  anchor.append(launcher.el, notices.el);
  // The outlines repeat what the report says; assistive technology reads the report, not them. The Edit with AI
  // buttons are controls, so their layer is not hidden.
  highlightLayer.setAttribute('aria-hidden', 'true');
  layer.append(highlightLayer, aiEditLayer, anchor);
  root.append(layer);
  const highlights = createHighlights(doc, highlightLayer);
  const aiEdits = createAiEdits(doc, aiEditLayer, (key, button) => {
    const act = () => handlers.onAiEdit?.(key);
    if (visibility.known(button)) {
      if (visibility.shown(button)) act();
      else log('content.ui-click-refused', { launcher: false, known: true });
      return;
    }
    // A button just drawn: its rewrite needs no user gesture, so the click waits for the watch's first word.
    void visibility.settled(button, lifetime.signal).then((shown) => {
      if (shown && button.isConnected && !button.disabled) act();
      else log('content.ui-click-refused', { launcher: false, known: visibility.known(button) });
    });
  }, (added, removed) => {
    for (const button of removed) visibility.unobserve(button);
    for (const button of added) visibility.observe(button);
  });
  visibility.observe(launcher.el);
  for (const button of notices.cardButtons) visibility.observe(button);
  const panelHandlers = handlers.panel;
  const panel = panelHandlers === undefined ? null : createInPagePanel(doc, root, {
    actions: panelHandlers,
    frameId: () => panelHandlers.frameId(),
    visibility,
  });
  if (panel !== null) anchor.append(panel.el);

  const panelFits = () => {
    if (view === null) return false;
    if (view.top === view) return true;
    return view.innerWidth >= PANEL_MIN_VIEWPORT.width && view.innerHeight >= PANEL_MIN_VIEWPORT.height;
  };
  const panelShown = (open: boolean) => {
    notices.el.classList.toggle('with-panel', open);
    schedule();
  };

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
    aiEdits.render(hostRect);
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
      const wasShown = notices.cardShown;
      notices.showPolicyCard(options);
      // What the watch knew of the hidden buttons is stale: a click waits for its fresh word.
      if (!wasShown) for (const button of notices.cardButtons) visibility.reset(button);
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
    setAiEdits(items) {
      aiEdits.set(items);
      layout();
    },
    get aiEditButtons() {
      return aiEdits.buttons;
    },
    showFocus(elements) {
      highlights.showFocus(elements);
      layout();
    },
    panel,
    panelFits,
    openPanel() {
      if (panel === null || !panelFits()) return false;
      panel.show();
      panelShown(true);
      return true;
    },
    closePanel() {
      if (panel === null) return;
      panel.hide();
      panelShown(false);
    },
    updatePanel(reports) {
      panel?.update(reports);
    },
    launcherShown(signal, fresh = false) {
      if (fresh) visibility.reset(launcher.el);
      return visibility.settled(launcher.el, signal);
    },
    visibleNow: (el) => (visibility.known(el) ? visibility.shown(el) : null),
    refresh: schedule,
    destroy() {
      lifetime.abort();
      panel?.destroy();
      visibility.disconnect();
      resizes?.disconnect();
      if (frame !== null) view?.cancelAnimationFrame(frame);
      frame = null;
      mounted.remove();
    },
  };
}
