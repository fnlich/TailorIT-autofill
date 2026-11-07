/*
 * The in-page UI, put together (docs/design/runtime.md §10.1): the host and its closed shadow root (shadow.ts), the one
 * stylesheet (styles.ts), the launcher, the notices, the policy card and the Edit with AI buttons, all vanilla DOM; and the
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
 *   harvested through it does nothing (logged as content.ui-click-refused). The audit of 2026-11-06 (S-1): every
 *   control's trusted event counts only once the control has been seen without a break for CONTROL_SEEN_MS (600 ms),
 *   judged at the event itself, so a page that hides its decoy as the pointer comes (the control shown a moment before
 *   the click) harvests nothing. A click on a control not yet seen that long is refused, never counted later, whatever
 *   the control (a card button just shown included): the person clicks again.
 * - launcherShown() is the frame's own visibility on its page (S1): a frame the page around it hides (opacity 0,
 *   off-screen, in a zero-height wrapper) has a launcher that is not visible, which no check inside the frame can see.
 * - Edit with AI (the owner's amendments, ai-edits.ts): its buttons sit in their own layer, not hidden from assistive
 *   technology, each watched like a card button: a trusted click counts only once the button has been seen for
 *   CONTROL_SEEN_MS.
 * - Nothing is drawn over the page's fields (the owner's decision of 2026-11-01, docs/SPEC-AMENDMENTS.md §11): no
 *   outline or chip marks a field's status or the AI's answers; the review lists them, and Show on page scrolls to a
 *   field and focuses it (runtime.ts).
 * - v3 Phase 3 (Jobright's launcher): in the top frame the launcher sits in a tab at the window's right edge (edge.ts),
 *   which the person drags up and down by its grip and hides from its "×" menu (until next visit, on this site,
 *   everywhere); its place and hiding come from the worker (setLauncherPrefs: frame/hello's answer, then
 *   launcher/prefs), and the tab hides while a panel of ours shows the tab (the in-page panel, or the browser's side
 *   panel: setSidePanel). Its close button, grip and menu items keep the visible-click rule: a trusted event counts
 *   only once the control it lands on has been seen for CONTROL_SEEN_MS (a drag's start and the menu's choices
 *   alike). A frame inside another page keeps its launcher at the form's corner, never hidden: it is how its
 *   run knows the frame is seen (S1).
 */
import { PAGE_COPY } from '../../shared/copy';
import { log } from '../../shared/log';
import type { FrameReport } from '../../shared/report';
import type { LauncherPrefs } from '../../messaging/schemas';
import { createAiEdits, type AiEditItem, type AiPrompt } from './ai-edits';
import { createEdge, type Edge, type HideScope } from './edge';
import { createLauncher, type LauncherAction, type LauncherView } from './launcher';
import { createNotices, type NoticeCode, type PolicyChoice } from './notices';
import { createInPagePanel, type InPagePanel, type PanelActions } from './panel';
import { createUiHost } from './shadow';
import type { StyleMode } from './styles';
import { CONTROL_SEEN_MS, createVisibilityWatch } from './visible';

/** The launcher's size, and its inset from the form root's corner. */
export const LAUNCHER_PX = 32;
/** How far the anchor's column (the notices, the policy card) keeps from the tab at the window's edge. The visibility
 *  watch counts a box-shadow's ink as painted over what lies under it, and a card's shadow reaches about 18 px past its
 *  box (IN_PAGE_SHADOWS.card), so a column closer than this would hide the launcher and the grip from it (their clicks
 *  refused), and the tab's own shadow would do the same to a card's buttons. */
export const EDGE_CLEARANCE_PX = 24;
const INSET_PX = 8;

/** An embedded frame smaller than this (its own viewport, in CSS pixels) is too small for the in-page panel: the
 *  launcher's Open review opens the side panel instead. The top frame always has room. */
export const PANEL_MIN_VIEWPORT = { width: 420, height: 360 } as const;

/** What the person's trusted clicks ask for. */
export interface PageUiHandlers {
  onLauncher(action: LauncherAction): void;
  onPolicyChoice(choice: PolicyChoice): void;
  /** Edit with AI on one field (the owner's amendments): a trusted click on its visible button opens its instruction
   *  box (v3 Phase 3b), whose trusted Generate on a visible button asks for the rewrite with what the person typed
   *  (possibly nothing). Answers what to say in the box (null: it was rewritten, and the box closes). */
  onAiEdit?(key: string, instruction: string): Promise<string | null> | void;
  /** The form root the UI is anchored to has left the page (the page drew its whole form again): the runtime finds the
   *  new one and anchors the UI to it (anchorTo), else the launcher stays hidden. Asked at a layout, not a click. */
  rootGone?(): void;
  /** The in-page panel's actions, for this frame's own fields, and this frame's id (none: no panel is made). */
  panel?: PanelActions & { frameId(): number | null };
  /** v3 Phase 3: the launcher sits in the tab at the window's right edge (the top frame). Its place, dropped by the
   *  person (a fraction of the window's height), and its hiding on this site or everywhere go to the worker. */
  edge?: { placed(top: number): void; hidden(scope: HideScope): void };
}

/** The mounted in-page UI. */
export interface PageUi {
  readonly host: HTMLElement;
  /** The closed root: only the content script holds it (tests read through it). */
  readonly shadow: ShadowRoot;
  readonly styleMode: StyleMode;
  readonly launcher: { readonly el: HTMLButtonElement; readonly view: LauncherView };
  readonly notices: { readonly shown: readonly NoticeCode[]; readonly cardShown: boolean };
  /** The element the launcher and notices are anchored to: the form root (null: nothing to anchor, launcher hidden). */
  anchorTo(root: Element | null): void;
  setLauncher(view: LauncherView): void;
  setNotices(codes: readonly NoticeCode[]): void;
  /** A new run: notices the person dismissed show again. */
  resetNotices(): void;
  showPolicyCard(options: { fromStoredCopy: boolean }): void;
  hidePolicyCard(): void;
  /** The Edit with AI buttons (ai-edits.ts): one per item; [] removes them all. */
  setAiEdits(items: readonly AiEditItem[]): void;
  /** The Edit with AI buttons drawn now (for tests). */
  readonly aiEditButtons: readonly HTMLButtonElement[];
  /** v3 Phase 3b: Edit with AI's instruction box open now (for tests), or null. */
  readonly aiPrompt: AiPrompt | null;
  /** The in-page panel (null when the handlers gave it no actions). */
  readonly panel: InPagePanel | null;
  /** The launcher's tab at the window's right edge (v3 Phase 3; null in a frame inside another page). */
  readonly edge: Edge | null;
  /** The launcher's place and whether the person hid it, for this frame's site (the worker's). `shownAgain`: the
   *  person asked for it back from the side panel, which also undoes "Hide until next visit". A frame inside another
   *  page hides its corner launcher while hidden, except while a run fills (S1). */
  setLauncherPrefs(prefs: LauncherPrefs, shownAgain?: boolean): void;
  /** Whether the browser's side panel shows this tab: the tab hides while it does. */
  setSidePanel(open: boolean): void;
  /** Whether the launcher's tab is hidden now (by the person, or while a panel shows the tab). */
  readonly edgeHidden: boolean;
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
  /** Whether a trusted click on one of our controls would count now: the watch has seen it, without a break, for
   *  CONTROL_SEEN_MS (the audit of 2026-11-06, S-1). For tests. */
  readyNow(el: Element): boolean;
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
  const aiEditLayer = doc.createElement('div');
  aiEditLayer.className = 'ai-edits';
  const anchor = doc.createElement('div');
  anchor.className = 'anchor';
  const visibility = createVisibilityWatch(view as (Window & typeof globalThis) | null);
  /** Whether a trusted event on one of our controls counts now: the control has been seen, without a break, for
   *  CONTROL_SEEN_MS (the audit of 2026-11-06, S-1). Decided at the event, never later: a refusal is logged, and the
   *  person's next click is judged afresh. */
  const counts = (control: Element, launcherClick = false): boolean => {
    if (visibility.shownFor(control, CONTROL_SEEN_MS)) return true;
    log('content.ui-click-refused', { launcher: launcherClick, known: visibility.known(control),
      shown: visibility.shown(control) });
    return false;
  };
  const launcher = createLauncher(doc, (action) => {
    // Open review must go out inside the click, so the launcher must already have been seen: no waiting here.
    if (counts(launcher.el, true)) handlers.onLauncher(action);
  });
  const notices = createNotices(doc, (choice, button) => {
    if (counts(button) && notices.cardShown) handlers.onPolicyChoice(choice);
  });
  // v3 Phase 3: the top frame's launcher sits in the tab at the window's right edge; a frame inside another page keeps
  // it at its form's corner.
  /** Runs `action` for a trusted event on one of the tab's controls once it has been seen long enough (module
   *  header). */
  const act = (control: Element, action: () => void) => {
    if (control.isConnected && counts(control)) action();
  };
  /** The person hid the tab until the document goes ("Hide until next visit"): this document's memory only. */
  let hiddenForVisit = false;
  let prefs: LauncherPrefs = { top: null, hidden: false };
  let sideOpen = false;
  const edgeHandlers = handlers.edge;
  const edge = edgeHandlers === undefined ? null : createEdge(doc, launcher.el, {
    placed: (top) => edgeHandlers.placed(top),
    hide(scope: HideScope) {
      if (scope === 'next-visit') hiddenForVisit = true;
      else prefs = { ...prefs, hidden: true };
      // The worker hears every scope: "until next visit" too, so the side panel can offer it back (v3 Phase 3 review).
      edgeHandlers.hidden(scope);
      showEdge();
    },
    act,
    controls(added, removed) {
      for (const control of removed) visibility.unobserve(control);
      for (const control of added) visibility.observe(control);
    },
  });
  if (edge === null) anchor.append(launcher.el, notices.el);
  else anchor.append(notices.el);
  // The Edit with AI buttons are controls, so their layer is not hidden from assistive technology. The tab at the edge
  // comes before the anchor's column, whose layout keeps it left of the tab (edgeLimit), so neither covers the other.
  layer.append(aiEditLayer, ...(edge === null ? [] : [edge.el]), anchor);
  root.append(layer);
  /** A trusted click on one of the layer's controls counts only once it has been seen long enough (a control just
   *  drawn included: its click is refused, and the person clicks again). */
  const whenSeen = (button: HTMLButtonElement, act: () => void) => {
    if (button.isConnected && !button.disabled && counts(button)) act();
  };
  const aiEdits = createAiEdits(doc, aiEditLayer, (key, button) => whenSeen(button, () => {
    // v3 Phase 3b: the button opens the field's instruction box; its Generate asks for the rewrite.
    aiEdits.openPrompt(key);
    layout();
  }), (added, removed) => {
    for (const button of removed) visibility.unobserve(button);
    for (const button of added) visibility.observe(button);
  }, (key, instruction, generate) => whenSeen(generate, () => {
    aiEdits.promptSaid(key, PAGE_COPY.editingWithAi);
    void Promise.resolve(handlers.onAiEdit?.(key, instruction)).then((said) => aiEdits.promptSaid(key, said ?? null),
      () => aiEdits.promptSaid(key, PAGE_COPY.aiEdit.outcomes.failed));
  }), (shown, hidden) => {
    if (hidden !== null) visibility.unobserve(hidden);
    if (shown !== null) visibility.observe(shown);
  });
  visibility.observe(launcher.el);
  if (edge !== null) for (const control of [edge.close, edge.grip]) visibility.observe(control);
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
    showEdge();
    schedule();
  };

  /** Whether the tab is hidden: the person hid it (for this visit, this site or everywhere), or a panel of ours shows
   *  the tab. */
  function edgeHidden(): boolean {
    return hiddenForVisit || prefs.hidden || sideOpen || panel?.open === true || anchorRoot === null
      || !anchorRoot.isConnected;
  }

  /** A frame inside another page (no tab): its corner launcher hides while the person hid the button everywhere (or on
   *  the frame's site), except while a run fills, when its being seen is how the run knows the frame is seen (S1). */
  function showCorner(): void {
    if (edge !== null) return;
    const hide = prefs.hidden && launcher.view.state !== 'running';
    if (launcher.el.hidden === hide) return;
    launcher.el.hidden = hide;
    if (!hide) visibility.reset(launcher.el);
  }

  /** Shows or hides the tab as edgeHidden says; shown again, what the watch knew of its controls is stale. The anchor's
   *  column is laid out again either way: it keeps left of the tab only while the tab shows. */
  function showEdge(): void {
    if (edge === null) return;
    const hide = edgeHidden();
    if (edge.el.hidden === hide) return;
    edge.el.hidden = hide;
    schedule();
    if (hide) {
      edge.closeMenu();
      return;
    }
    edge.layout();
    for (const control of [launcher.el, edge.close, edge.grip]) visibility.reset(control);
  }

  let anchorRoot: Element | null = null;
  let frame: number | null = null;
  const lifetime = new AbortController();
  const resizes = view !== null && typeof view.ResizeObserver === 'function'
    ? new view.ResizeObserver(() => schedule()) : null;

  function layout(): void {
    frame = null;
    if (!mounted.host.isConnected) return;
    if (anchorRoot !== null && !anchorRoot.isConnected) {
      // The form root left the page (the page drew its whole form again; its removal reaches the ResizeObserver): the
      // runtime anchors to the new one, whose anchorTo has laid everything out already.
      handlers.rootGone?.();
      if (anchorRoot.isConnected) return;
    }
    const hostRect = mounted.host.getBoundingClientRect();
    if (anchorRoot === null || !anchorRoot.isConnected) {
      anchor.hidden = true;
    } else {
      anchor.hidden = false;
      const rect = anchorRoot.getBoundingClientRect();
      const right = Math.max(rect.right, rect.left + LAUNCHER_PX + INSET_PX * 2);
      const left = Math.max(0, right - hostRect.left - INSET_PX - LAUNCHER_PX);
      const top = Math.max(0, rect.top - hostRect.top + INSET_PX);
      // The anchor's right edge is the launcher's, so the notices under it line up with the form's corner; in the top
      // frame, never past the tab at the window's edge: a notice or the policy card over the tab would hide the
      // launcher from the visibility watch (its clicks refused), and the tab over them would hide their buttons.
      anchor.style.left = `${Math.min(left + LAUNCHER_PX, edgeLimit(hostRect))}px`;
      anchor.style.top = `${top}px`;
      anchor.style.transform = 'translateX(-100%)';
    }
    aiEdits.render(hostRect);
  }

  /** The furthest right the anchor's column may reach, in the host's pixels: EDGE_CLEARANCE_PX left of the tab at the
   *  window's edge while it shows, anywhere when there is none or it is hidden. */
  function edgeLimit(hostRect: DOMRect): number {
    if (edge === null || edge.el.hidden) return Number.POSITIVE_INFINITY;
    const tab = edge.el.getBoundingClientRect();
    return tab.width > 0 ? tab.left - hostRect.left - EDGE_CLEARANCE_PX : Number.POSITIVE_INFINITY;
  }

  function schedule(): void {
    if (frame !== null || view === null) return;
    frame = view.requestAnimationFrame(layout);
  }

  if (view !== null) {
    view.addEventListener('scroll', schedule, { capture: true, passive: true, signal: lifetime.signal });
    view.addEventListener('resize', schedule, { passive: true, signal: lifetime.signal });
    // The tab keeps its place within a window that grew or shrank.
    if (edge !== null) view.addEventListener('resize', () => edge.layout(), { passive: true, signal: lifetime.signal });
  }

  return {
    host: mounted.host,
    shadow: root,
    styleMode: mounted.styleMode,
    launcher,
    notices,
    anchorTo(next) {
      if (anchorRoot !== null) resizes?.unobserve(anchorRoot);
      anchorRoot = next;
      if (next !== null) resizes?.observe(next);
      layout();
      // The tab shows only while there is a form to fill (v3 Phase 3).
      showEdge();
    },
    setLauncher(next) {
      launcher.set(next);
      showCorner();
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
    setAiEdits(items) {
      aiEdits.set(items);
      layout();
    },
    get aiEditButtons() {
      return aiEdits.buttons;
    },
    get aiPrompt() {
      return aiEdits.prompt;
    },
    panel,
    edge,
    setLauncherPrefs(next, shownAgain = false) {
      prefs = { top: next.top, hidden: next.hidden };
      // The person's "Show the TailorIT button again" also undoes their "Hide until next visit".
      if (shownAgain) hiddenForVisit = false;
      edge?.setTop(next.top);
      showEdge();
      showCorner();
    },
    setSidePanel(open) {
      sideOpen = open;
      showEdge();
    },
    get edgeHidden() {
      return edge !== null && edgeHidden();
    },
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
    readyNow: (el) => visibility.shownFor(el, CONTROL_SEEN_MS),
    refresh: schedule,
    destroy() {
      lifetime.abort();
      edge?.destroy();
      panel?.destroy();
      visibility.disconnect();
      resizes?.disconnect();
      if (frame !== null) view?.cancelAnimationFrame(frame);
      frame = null;
      mounted.remove();
    },
  };
}
