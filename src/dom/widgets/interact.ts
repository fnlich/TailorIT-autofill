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
 *   after them, one more click() on a select-only combobox that a click opened (it toggles);
 * - wait for a list's options: a quiet window with the list's own busy signs cleared, capped (awaitOptions' rule,
 *   applied to the widget's list); the adapter's declared busy signs (WidgetDecl.busy) count as its own.
 * Never a key, a pointer move, a hover, a touch, Enter or Space; never a mouse event the adapter did not declare;
 * nothing is focused. A widget that does not answer untrusted events is reported as such (the caller flags it
 * needs-your-click) and is never tried another way.
 * Every wait is settle.ts's quietWait on dom/time.ts's timers: it ends on a DOM condition, its cap or the run's
 * signal, never a fixed sleep.
 */
import type { Adapter } from '../../adapters/types';
import type { OptionSetHash } from '../../core/types/field';
import { fireLeave, windowOf } from '../fillers/events';
import { assertNotSubmit } from '../fillers/not-submit';
import { quietWait, type QuietWait } from '../settle';
import { WIDGET_CAP_MS, WIDGET_QUIET_MS, WIDGET_READY_CAP_MS, WIDGET_READY_QUIET_MS } from '../thresholds';
import { monotonicNow } from '../time';
import type { WidgetTarget } from '../types';
import { isUserVisible } from '../visibility';
import { listOf } from './aria';
import { listState, widgetBusy } from './options';

/** What acting on a widget needs. */
export interface WidgetContext {
  adapter: Adapter | null;
  /** The form root: watched for the page's answer, and where the adapter's Submit button is looked up. */
  root: Element;
  /** The run's signal: aborting it ends every wait at once. */
  signal?: AbortSignal;
  /** The run's readiness for declared activations, one record for the whole run, so only its first unanswered
   *  activation waits for the page; a record of the call's own without it. */
  readiness?: WidgetReadiness;
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

/** The widget's list now, when a person can see it. */
export function openListOf(widget: WidgetTarget): Element | null {
  const listbox = listOf(widget.element, widget.input);
  return listbox !== null && isUserVisible(listbox) ? listbox : null;
}

/** Whether the widget says its list is open: the aria-expanded of the element its adapter names (WidgetDecl.expanded),
 *  "true" or not; null when the adapter names none. */
export function expandedState(widget: WidgetTarget): boolean | null {
  const el = widget.expanded ?? null;
  if (el === null) return null;
  return (el.getAttribute('aria-expanded') ?? '').trim().toLowerCase() === 'true';
}

/** Waits for the page to answer one action on a widget: a quiet window with no busy sign of the widget's own, at most
 *  `capMs`. Its list is watched too when the page draws it outside the form. */
export async function afterAction(widget: WidgetTarget, ctx: WidgetContext, capMs: number = WIDGET_CAP_MS):
  Promise<ActionAnswer> {
  const view = windowOf(ctx.root);
  let mutated = false;
  const wait: QuietWait<boolean> = quietWait<boolean>({
    view, quietMs: WIDGET_QUIET_MS, capMs, signal: ctx.signal, aborted: false,
    atQuiet: (): boolean | null => {
      const listbox = listOf(widget.element, widget.input);
      if (listbox !== null && !ctx.root.contains(listbox) && wait.observe(listbox)) return null;
      return widgetBusy(widget, listbox) ? null : true;
    },
    atCap: () => true,
    onPageRecords: () => {
      mutated = true;
    },
  });
  wait.observe(ctx.root);
  const listbox = listOf(widget.element, widget.input);
  if (listbox !== null && !ctx.root.contains(listbox)) wait.observe(listbox);
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

/** Closes a widget's list if it is open (see the header). Answers whether it is closed now. */
export async function closeList(widget: WidgetTarget, ctx: WidgetContext, opened: { activated: boolean }):
  Promise<boolean> {
  const closed = () => openListOf(widget) === null && expandedState(widget) !== true;
  if (closed()) return true;
  fireLeave(widget.input ?? widget.element);
  const answer = await afterAction(widget, ctx);
  if (answer.aborted || closed()) return closed();
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
      const listbox = listOf(widget.element, widget.input);
      if (listbox !== null && !ctx.root.contains(listbox) && wait.observe(listbox)) return null;
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
  const listbox = listOf(widget.element, widget.input);
  if (listbox !== null && !ctx.root.contains(listbox)) wait.observe(listbox);
  return { status: await wait.done, mutated };
}
