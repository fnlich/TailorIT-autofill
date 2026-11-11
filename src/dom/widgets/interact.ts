/*
 * Acting on an ARIA widget (Phase 4; docs/design/runtime.md §6; docs/ARCHITECTURE.md "Filler"), with untrusted DOM
 * events only, and only these:
 * - open: at most one activation, an untrusted click() through assertNotSubmit, or the one mousedown, mouseup or focus
 *   the adapter declared for the widget (and named its snapshot for); then the page gets a quiet window to answer. A
 *   widget whose adapter names the element that says it is open (WidgetDecl.expanded: react-select's aria-expanded) is
 *   open by that element's word, and its declared activation, which toggles the list, is sent only while it says
 *   "false". The run's first declared activation that the page does not answer at all waits once for the page's script
 *   to attach (a bounded wait, WIDGET_READY_CAP_MS) and is sent once more (Greenhouse's React attaches seconds after its
 *   form shows, and nothing answers before: the capture of 2026-11-01);
 * - close: focusout and blur on the widget (the text filler's leave events), and only if its list is still open
 *   after them, an Escape its adapter declared (WidgetDecl.keys: a list that ignores focusout and blur), sent only
 *   while the widget says it is open (WidgetDecl.expanded), to its text box or, where the adapter says so, to the
 *   open list itself (WidgetDecl.keyTarget 'list': Workable's), then one more click() on a select-only combobox that a
 *   click opened (it toggles). A list its adapter says is drawn fixed at its field's place (WidgetDecl.listFollowsField)
 *   is judged visible where its field is (dom/visibility.ts followsItsField);
 * - wait for a list's options: a quiet window with the list's own busy signs cleared, capped (awaitOptions' rule,
 *   applied to the widget's list); the adapter's declared busy signs (WidgetDecl.busy) count as its own;
 * - React first (docs/SPEC-AMENDMENTS.md §12): a widget its adapter declares for the page-world bridge
 *   (WidgetDecl.bridge) has an option chosen by its own React code (bridgeChoose: one command, dom/bridge.ts), its
 *   text box first passed by assertNotSubmit and the option's label, as the frame read it, by optionWordsRefusal.
 *   What the bridge says comes back to the caller as it is (BridgeChoice): nothing done (absent, refused), chosen
 *   already, or sent. The answer is a claim, so the caller reads the widget back (afterBridge: one more bounded wait
 *   when it does not show the choice yet). The run's bridge goes off for the rest of the run (BridgeRun) after a command
 *   nothing answered within its dispatch, or a choice it said it made that never read back.
 * Never a pointer move, a hover, a touch or Space; never a key or a mouse event the adapter did not declare; nothing is
 * focused. A widget that does not answer untrusted events is reported as such (the caller flags it needs-your-click)
 * and is never tried another way.
 * Every wait is settle.ts's quietWait on dom/time.ts's timers: it ends on a DOM condition, its cap or the run's
 * signal, never a fixed sleep. While the person may Skip the write (v3 Phase 3: WidgetContext.runSignal), its Skip
 * ends the waits too; what the write had done to its widget is then put back (its typed text, its open list) through
 * skipTidyContext: a fresh, short-capped signal that only the run's own end aborts.
 * jr6 ENGINE E1 (FIXPLAN §6.2 items 1 and 3):
 * - a list its adapter declares outside the form root's own tree (another shadow tree: SmartRecruiters' menus; a portal
 *   at the end of the body: ADP's) is watched directly, with the hosts of rows slotted into it (watchList): the form
 *   root's observer sees neither;
 * - a choice presses the element its adapter names (chooseResult: pressTargetOf, with the declared event).
 */
import type { Adapter } from '../../adapters/types';
import type { OptionSetHash } from '../../core/types/field';
import { askBridge } from '../bridge';
import type { BridgeReason } from '../bridge-protocol';
import { fireKey, fireLeave, WIDGET_KEYS, windowOf, type WidgetKey } from '../fillers/events';
import { assertKeyTarget, assertNotSubmit, optionWordsRefusal } from '../fillers/not-submit';
import { quietWait, type QuietWait } from '../settle';
import { WIDGET_CAP_MS, WIDGET_QUIET_MS, WIDGET_READY_CAP_MS, WIDGET_READY_QUIET_MS } from '../thresholds';
import { monotonicNow, startDeadline } from '../time';
import type { WidgetTarget } from '../types';
import { followsItsField, isUserVisible, stopsFollowing } from '../visibility';
import { optionElementsOf, pressTargetOf, widgetListOf } from './aria';
import { listState, widgetBusy } from './options';

/** What acting on a widget needs. */
export interface WidgetContext {
  adapter: Adapter | null;
  /** The form root: watched for the page's answer, and where the adapter's Submit button is looked up. */
  root: Element;
  /** The run's signal: aborting it ends every wait at once. */
  signal?: AbortSignal;
  /** While the person may Skip this write (v3 Phase 3): the run's own signal, which only the run's end aborts; `signal`
   *  then aborts on the Skip too. A wait `signal` ended while this did not was ended by the Skip (skipTidyContext). */
  runSignal?: AbortSignal;
  /** The run's readiness for declared activations, one record for the whole run, so only its first unanswered
   *  activation waits for the page; a record of the call's own without it. */
  readiness?: WidgetReadiness;
  /** The run's page-world bridge (BridgeRun), one record for the whole run; a record of the call's own without it. */
  bridge?: BridgeRun;
  /** This write has had its one command to the bridge already (content/pass.ts, before a long list's search): no
   *  second one is sent for it. `sent`: the bridge said it chose, and nothing read back; `before`: what the widget
   *  showed chosen before that command. */
  bridgeTried?: { sent: boolean; before: readonly string[] };
}

/** How long putting back what a skipped write did to its widget may take (its typed text, its open list). */
export const SKIP_TIDY_CAP_MS = 1_500;

/** A context to put back what a write the person skipped had done to its widget (see the header): its signal fresh,
 *  capped at SKIP_TIDY_CAP_MS, and aborted by the run's own end. Null when no Skip ended the wait (the run itself ended,
 *  or nothing aborted): nothing is tidied then. */
export function skipTidyContext<T extends WidgetContext>(ctx: T): T | null {
  const run = ctx.runSignal;
  if (run === undefined || run.aborted || ctx.signal?.aborted !== true) return null;
  const capped = new AbortController();
  startDeadline(SKIP_TIDY_CAP_MS, () => capped.abort(), run);
  const { runSignal: _, ...rest } = ctx;
  return { ...rest, signal: AbortSignal.any([run, capped.signal]) } as T;
}

/** The context to close a list with: the skip's tidy context when the person's Skip ended the write's waits (an
 *  aborted signal would close nothing: closeList stops at its first wait), else the write's own. */
export function closingContext<T extends WidgetContext>(ctx: T): T {
  return skipTidyContext(ctx) ?? ctx;
}

/** Whether the run's page-world bridge is off: after a command nothing answered within its dispatch (no bridge, or a
 *  page that swallows commands), or a choice it said it made that never read back, no more is sent this run. */
export interface BridgeRun {
  off: boolean;
}

/** A run's bridge record, before any command. */
export function newBridgeRun(): BridgeRun {
  return { off: false };
}

/** Whether the page has answered a declared activation yet, and whether the run's one wait for it is spent. */
export interface WidgetReadiness {
  answered: boolean;
  waited: boolean;
}

/** A run's readiness record, before any activation. */
export function newReadiness(): WidgetReadiness {
  return { answered: false, waited: false };
}

/** What the page did after one action. */
export interface ActionAnswer {
  /** The page mutated after the action (it answered, somehow). */
  mutated: boolean;
  aborted: boolean;
}

/** The widget's list now, when a person can see it: one its adapter says is drawn fixed at its field's place
 *  (WidgetDecl.listFollowsField) judged where its field is (dom/visibility.ts followsItsField). */
export function openListOf(widget: WidgetTarget): Element | null {
  const listbox = widgetListOf(widget);
  if (listbox !== null && widget.listFollowsField === true) followsItsField(listbox, widget.input ?? widget.element);
  return listbox !== null && isUserVisible(listbox) ? listbox : null;
}

/** Whether the widget says its list is open: the aria-expanded of the element its adapter names (WidgetDecl.expanded),
 *  "true" or not; null when the adapter names none. */
export function expandedState(widget: WidgetTarget): boolean | null {
  const el = widget.expanded ?? null;
  if (el === null) return null;
  return (el.getAttribute('aria-expanded') ?? '').trim().toLowerCase() === 'true';
}

/**
 * Watches a widget's list where the form root's observer cannot see it (see the header): the list itself when it sits
 * outside the root's own tree (Node.contains and a MutationObserver both stop at a shadow root, and a portal is outside
 * the root), and, for a list its adapter declares, the parents of rows that are not inside it (rows slotted into it from
 * their host's light tree: WidgetResults.options). True when anything new is watched now, so the wait goes on one more
 * quiet window.
 */
function watchList(wait: Pick<QuietWait<unknown>, 'observe'>, widget: WidgetTarget, listbox: Element | null,
  root: Element): boolean {
  if (listbox === null) return false;
  let added = false;
  if (!root.contains(listbox)) added = wait.observe(listbox) || added;
  if (widget.results?.options !== undefined) {
    for (const row of optionElementsOf(listbox, widget.results)) {
      const parent = row.parentNode;
      if (parent !== null && parent !== listbox && !listbox.contains(parent) && !root.contains(parent)) {
        added = wait.observe(parent) || added;
      }
    }
  }
  return added;
}

/** Waits for the page to answer one action on a widget: a quiet window with no busy sign of the widget's own, at most
 *  `capMs`. Its list is watched too when the page draws it outside the form (watchList). */
export async function afterAction(widget: WidgetTarget, ctx: WidgetContext, capMs: number = WIDGET_CAP_MS):
  Promise<ActionAnswer> {
  const view = windowOf(ctx.root);
  let mutated = false;
  const wait: QuietWait<boolean> = quietWait<boolean>({
    view, quietMs: WIDGET_QUIET_MS, capMs, signal: ctx.signal, aborted: false,
    atQuiet: (): boolean | null => {
      const listbox = widgetListOf(widget);
      if (watchList(wait, widget, listbox, ctx.root)) return null;
      return widgetBusy(widget, listbox) ? null : true;
    },
    atCap: () => true,
    onPageRecords: () => {
      mutated = true;
    },
  });
  wait.observe(ctx.root);
  watchList(wait, widget, widgetListOf(widget), ctx.root);
  const done = await wait.done;
  return { mutated, aborted: !done };
}

/** The one activation that opens a widget: the adapter's declared mousedown, mouseup or focus, else click(); false
 *  when assertNotSubmit refuses its opener. A declared mouse event bubbles, as a page's listener on an ancestor needs
 *  (react-select's wrapper in Greenhouse), with the main button. Nothing else is dispatched. */
export function activate(widget: WidgetTarget, ctx: WidgetContext): boolean {
  const opener = widget.opener ?? (widget.element as HTMLElement);
  if (!assertNotSubmit(opener, ctx).ok) return false;
  const view = windowOf(opener);
  const declared = widget.activation[0];
  if (declared === 'mousedown' || declared === 'mouseup') {
    opener.dispatchEvent(new view.MouseEvent(declared, { bubbles: true, cancelable: true, composed: true, button: 0 }));
  } else if (declared === 'focus') {
    opener.dispatchEvent(new view.FocusEvent('focus', { composed: true }));
  } else {
    opener.click();
  }
  return true;
}

/** How the page answered a widget's activation: 'answered' (it says its list is open, or, with no element that says
 *  so, it changed), 'ignored' (it did nothing), 'gone' (the page replaced the widget while the run waited for it to be
 *  ready), 'refused' (assertNotSubmit refused the opener) or 'aborted'. */
export interface Activation {
  status: 'answered' | 'ignored' | 'gone' | 'refused' | 'aborted';
  mutated: boolean;
}

/** One activation and the page's answer (see the header): sent once more, after the run's one wait for the page, when
 *  it is a declared activation, the page has answered none yet, and it answered nothing at all to this one. */
export async function activateAndAwait(widget: WidgetTarget, ctx: WidgetContext): Promise<Activation> {
  const readiness = ctx.readiness ?? newReadiness();
  let mutated = false;
  for (let attempt = 0; ; attempt += 1) {
    if (!activate(widget, ctx)) return { status: 'refused', mutated };
    const answer = await afterAction(widget, ctx);
    mutated ||= answer.mutated;
    if (answer.aborted) return { status: 'aborted', mutated };
    const expanded = expandedState(widget);
    if (expanded === true || (expanded === null && (answer.mutated || openListOf(widget) !== null))) {
      if (widget.activation.length > 0) readiness.answered = true;
      return { status: 'answered', mutated };
    }
    if (attempt > 0 || widget.activation.length === 0 || readiness.answered || readiness.waited || answer.mutated) {
      return { status: 'ignored', mutated };
    }
    readiness.waited = true;
    if (await awaitReady(ctx) === 'aborted') return { status: 'aborted', mutated };
    if (!widget.element.isConnected) return { status: 'gone', mutated };
  }
}

/** The run's one wait for a page whose script has not attached yet: until the form root has changed and then been
 *  quiet for WIDGET_READY_QUIET_MS (the page rebuilt its form), or has left the page (it drew the whole form again,
 *  its root included: the run finds the new one), else WIDGET_READY_CAP_MS. */
async function awaitReady(ctx: WidgetContext): Promise<'ready' | 'aborted'> {
  let changed = false;
  const wait = quietWait<'ready' | 'aborted'>({
    view: windowOf(ctx.root), quietMs: WIDGET_READY_QUIET_MS, capMs: WIDGET_READY_CAP_MS, signal: ctx.signal,
    aborted: 'aborted', atQuiet: () => (changed || !ctx.root.isConnected ? 'ready' : null), atCap: () => 'ready',
    onPageRecords: () => {
      changed = true;
    },
  });
  wait.observe(ctx.root);
  return wait.done;
}

/** s2 lists: the run's one wait for a page whose script has not answered yet (awaitReady), sent outside an activation:
 *  a stored list's react-select is planned on the run's first pass, so a command to the page-world bridge may be the
 *  run's first contact with the widget, before the page's React attached (the bridge's 'no-react'). False, and nothing
 *  waited for, when the run has no readiness record, the page answered an activation already, the run's one wait is
 *  spent, or the wait was aborted. */
export async function awaitPageReady(ctx: WidgetContext): Promise<boolean> {
  const readiness = ctx.readiness;
  if (readiness === undefined || readiness.answered || readiness.waited) return false;
  readiness.waited = true;
  return (await awaitReady(ctx)) === 'ready';
}

/** How opening a widget went. 'ignored': the page did nothing at all; 'no-list': it answered, but shows no list;
 *  'gone': the page replaced the widget while the run waited for it to be ready. */
export type OpenResult =
  | { open: true; listbox: Element; activated: boolean }
  | { open: false; reason: 'refused' | 'ignored' | 'no-list' | 'gone' | 'aborted'; mutated: boolean };

/** Opens a widget's list, unless it is open already: one activation, then the page's answer. */
export async function openList(widget: WidgetTarget, ctx: WidgetContext): Promise<OpenResult> {
  const shown = openListOf(widget);
  const expanded = expandedState(widget);
  if (shown !== null && expanded !== false) return { open: true, listbox: shown, activated: false };
  // Open already, with nothing a person can see in it (a search before anything is typed): no activation, which would
  // close it.
  if (expanded === true) return { open: false, reason: 'no-list', mutated: false };
  const answer = await activateAndAwait(widget, ctx);
  if (answer.status === 'refused' || answer.status === 'aborted' || answer.status === 'gone') {
    return { open: false, reason: answer.status, mutated: answer.mutated };
  }
  const listbox = openListOf(widget);
  if (listbox !== null) return { open: true, listbox, activated: true };
  return { open: false, reason: answer.status === 'answered' ? 'no-list' : 'ignored', mutated: answer.mutated };
}

/** Sends one key the widget's adapter declared (WidgetDecl.keys) to its text box, else its element, or to its open
 *  list when the adapter says the keys go there (WidgetDecl.keyTarget 'list': Workable's dropdowns): an untrusted
 *  keydown and keyup, bubbling, built with the element's own window. False, and nothing sent, when the widget does not
 *  declare the key, assertNotSubmit refuses its target, its list is to take it and none is shown, or the key is Escape
 *  and the widget does not say, right now, that its list is open (WidgetDecl.expanded): an Escape to a closed widget
 *  is the page's to read as it likes. */
export function pressDeclaredKey(widget: WidgetTarget, key: WidgetKey, ctx: WidgetContext): boolean {
  if (!(WIDGET_KEYS as readonly string[]).includes(key) || !(widget.keys ?? []).includes(key)) return false;
  if (key === 'Escape' && expandedState(widget) !== true) return false;
  const target = widget.keyTarget === 'list' ? openListOf(widget) : widget.input ?? widget.element;
  if (target === null || !assertKeyTarget(target, ctx).ok) return false;
  fireKey(target, key);
  return true;
}

/** v4 (drop): the declared key a search needs after each typed query (WidgetDecl.queryKey: Lever's location search
 *  starts on a keydown, never on the input event), sent to its text box as an untrusted keydown and keyup; false, and
 *  nothing sent, when the widget declares none or assertKeyTarget refuses its box. */
export function pressQueryKey(widget: WidgetTarget, ctx: WidgetContext): boolean {
  const key = widget.queryKey;
  const box = widget.input;
  if (key === undefined || box === null || !assertKeyTarget(box, ctx).ok) return false;
  fireKey(box, key);
  return true;
}

/** Closes a widget's list if it is open (see the header). Answers whether it is closed now. */
export async function closeList(widget: WidgetTarget, ctx: WidgetContext, opened: { activated: boolean }):
  Promise<boolean> {
  // The run is done with the list: a list drawn where its field is is judged as fixed again (stopsFollowing).
  const shown = widgetListOf(widget);
  try {
    return await closeListNow(widget, ctx, opened);
  } finally {
    if (shown !== null) stopsFollowing(shown);
  }
}

/** closeList's own work: focusout and blur, the declared Escape, then a second click on a select-only box. */
async function closeListNow(widget: WidgetTarget, ctx: WidgetContext, opened: { activated: boolean }):
  Promise<boolean> {
  const closed = () => openListOf(widget) === null && expandedState(widget) !== true;
  if (closed()) return true;
  fireLeave(widget.input ?? widget.element);
  const answer = await afterAction(widget, ctx);
  if (answer.aborted || closed()) return closed();
  // A list that ignores focusout and blur, whose adapter declares Escape for it.
  if (pressDeclaredKey(widget, 'Escape', ctx)) {
    const escaped = await afterAction(widget, ctx);
    if (escaped.aborted || closed()) return closed();
  }
  const opener = widget.opener ?? (widget.element as HTMLElement);
  // A select-only combobox that our click opened toggles shut on a second click; a text box does not.
  if (opened.activated && widget.input === null && widget.activation.length === 0 && assertNotSubmit(opener, ctx).ok) {
    opener.click();
    await afterAction(widget, ctx);
  }
  return closed();
}

/** How a wait for a widget's options ended. 'empty': the page answered (its busy sign came and went, or the list stayed
 *  quiet and empty past `emptyAfterMs`) and shows no option. */
export interface ListWait {
  status: 'ready' | 'empty' | 'never-loaded' | 'aborted';
  /** The page mutated during the wait. */
  mutated: boolean;
}

/**
 * Waits for a widget's list to show real options whose hash differs from `prevHash` (any, when null), quiet for one
 * window with its busy signs cleared; at `capMs` it answers never-loaded (awaitOptions' rule for a listbox). A list that
 * shows no option once its busy sign has cleared, or after `emptyAfterMs` of quiet, is 'empty'. The same results again
 * after a busy sign count as ready.
 */
export async function awaitList(widget: WidgetTarget, ctx: WidgetContext,
  options: { prevHash: OptionSetHash | null; capMs: number; emptyAfterMs?: number }): Promise<ListWait> {
  const view = windowOf(ctx.root);
  const started = monotonicNow();
  let mutated = false;
  let sawBusy = false;
  const wait: QuietWait<ListWait['status']> = quietWait<ListWait['status']>({
    view, quietMs: WIDGET_QUIET_MS, capMs: options.capMs, signal: ctx.signal, aborted: 'aborted',
    atQuiet: (): ListWait['status'] | null => {
      const listbox = widgetListOf(widget);
      if (watchList(wait, widget, listbox, ctx.root)) return null;
      // The widget's own busy sign counts while its list is hidden too: a search often hides it while it runs.
      if (widgetBusy(widget, listbox)) {
        sawBusy = true;
        return null;
      }
      const state = listState(widget, options.prevHash);
      if (state.ready) return 'ready';
      if (state.waiting === 'busy' || state.waiting === 'loading') {
        sawBusy = true;
        return null;
      }
      if (sawBusy) return state.waiting === 'unchanged' ? 'ready' : 'empty';
      if (options.emptyAfterMs !== undefined && monotonicNow() - started >= options.emptyAfterMs
        && (state.waiting === 'placeholders' || state.waiting === 'unchanged')) return 'empty';
      return null;
    },
    atCap: () => (listState(widget, options.prevHash).ready ? 'ready' : 'never-loaded'),
    onPageRecords: () => {
      mutated = true;
    },
  });
  wait.observe(ctx.root);
  watchList(wait, widget, widgetListOf(widget), ctx.root);
  return { status: await wait.done, mutated };
}

/**
 * Chooses a row of a widget's list (v4, drop; jr6 ENGINE E1 for every declared list): the one event its adapter
 * declared for its results (WidgetDecl.results.choose 'mousedown': Lever's location search chooses on a mousedown,
 * bubbling to its document's listener, with the main button), else click(), on the element a choice presses
 * (pressTargetOf: the adapter's WidgetResults.pressTarget, else s2 wd's label part, else the row). The caller has passed
 * both the row and that element through assertNotSubmit (pressAllowed).
 */
export function chooseResult(widget: WidgetTarget, option: Element): void {
  const target = pressTargetOf(widget, option);
  const view = windowOf(target);
  if (widget.results?.choose === 'mousedown') {
    target.dispatchEvent(new view.MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true, button: 0 }));
    return;
  }
  // An element with no click() of its own (an SVG part) gets the same untrusted click as an event.
  if (typeof (target as Partial<HTMLElement>).click === 'function') (target as HTMLElement).click();
  else target.dispatchEvent(new view.MouseEvent('click', { bubbles: true, cancelable: true, composed: true, button: 0 }));
}

/** Whether a row may be chosen with chooseResult: assertNotSubmit passes the row and the element its choice presses. */
export function pressAllowed(widget: WidgetTarget, option: Element, ctx: WidgetContext): boolean {
  return assertNotSubmit(option, ctx).ok && assertNotSubmit(pressTargetOf(widget, option), ctx).ok;
}

/** How one choice through the page-world bridge went (see the header), as the bridge said it:
 * - 'absent': nothing was sent or nothing answered (no bridge declared, the run's bridge off, no bridge in the frame);
 * - 'refused': nothing was done: our own checks held the command back, or the bridge declined (`reason`);
 * - 'chosen': the bridge says the option is chosen already, and did nothing (a multi-select's must not be clicked:
 *   that would remove it);
 * - 'sent': the bridge says it chose, and the page's answer has been awaited, as after a click. A claim: read back. */
export type BridgeChoice =
  | { status: 'absent' }
  | { status: 'refused'; reason: BridgeReason | 'not-allowed' }
  | { status: 'chosen' }
  | { status: 'sent' };

/** Asks the page-world bridge to choose the option `label` in a widget its adapter declares for it (see the header).
 *  `label` is the option's clean label as the frame read it from the page; `shown` its label with what the frame cut
 *  from it, which optionWordsRefusal reads. A command nothing answers turns the run's bridge off. */
export async function bridgeChoose(widget: WidgetTarget, option: { label: string; shown: string }, multi: boolean,
  ctx: WidgetContext): Promise<BridgeChoice> {
  const input = widget.input;
  if (widget.bridge !== 'react-select' || input === null || ctx.bridge?.off === true) return { status: 'absent' };
  if (!assertNotSubmit(input, ctx).ok || optionWordsRefusal(option.shown) !== null
    || optionWordsRefusal(option.label) !== null) return { status: 'refused', reason: 'not-allowed' };
  const answer = askBridge(input, { op: 'react-select.choose', label: option.label, multi }, ctx.signal);
  if (answer === null) {
    if (ctx.bridge !== undefined) ctx.bridge.off = true;
    return { status: 'absent' };
  }
  if (!answer.ok) return answer.reason === 'chosen' ? { status: 'chosen' } : { status: 'refused', reason: answer.reason };
  await afterAction(widget, ctx);
  return { status: 'sent' };
}

/** After the bridge said it chose: whether the widget shows the choice (`shows`), with one more bounded wait for the
 *  page when it does not yet. When it never does, the run's bridge goes off: its word did not hold. */
export async function afterBridge(widget: WidgetTarget, ctx: WidgetContext, shows: () => boolean): Promise<boolean> {
  if (shows()) return true;
  await afterAction(widget, ctx);
  if (shows()) return true;
  if (ctx.bridge !== undefined) ctx.bridge.off = true;
  return false;
}
