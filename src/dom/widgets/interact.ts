/*
 * Acting on an ARIA widget (Phase 4; docs/design/runtime.md §6; docs/ARCHITECTURE.md "Filler"), with untrusted DOM
 * events only, and only these:
 * - open: at most one activation, an untrusted click() through assertNotSubmit, or the one mousedown or focus the
 *   adapter declared for the widget (and named its snapshot for); then the page gets a quiet window to answer;
 * - close: focusout and blur on the widget (the text filler's leave events), and only if its list is still open
 *   after them, one more click() on a select-only combobox that a click opened (it toggles);
 * - wait for a list's options: a quiet window with the list's own busy signs cleared, capped (awaitOptions' rule,
 *   applied to the widget's list).
 * Never a key, a pointer move, a hover, a touch, Enter or Space; nothing is focused. A widget that does not answer
 * untrusted events is reported as such (the caller flags it needs-your-click) and is never tried another way.
 * Every wait is settle.ts's quietWait on dom/time.ts's timers: it ends on a DOM condition, its cap or the run's
 * signal, never a fixed sleep.
 */
import type { Adapter } from '../../adapters/types';
import type { OptionSetHash } from '../../core/types/field';
import { fireLeave, windowOf } from '../fillers/events';
import { assertNotSubmit } from '../fillers/not-submit';
import { quietWait, type QuietWait } from '../settle';
import { WIDGET_CAP_MS, WIDGET_QUIET_MS } from '../thresholds';
import { monotonicNow } from '../time';
import type { WidgetTarget } from '../types';
import { isUserVisible } from '../visibility';
import { listOf } from './aria';
import { busyIn, busyScopes, listState } from './options';

/** What acting on a widget needs. */
export interface WidgetContext {
  adapter: Adapter | null;
  /** The form root: watched for the page's answer, and where the adapter's Submit button is looked up. */
  root: Element;
  /** The run's signal: aborting it ends every wait at once. */
  signal?: AbortSignal;
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
      return busyIn(busyScopes(widget, listbox)) ? null : true;
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

/** The one activation that opens a widget: the adapter's declared mousedown or focus, else click(); false when
 *  assertNotSubmit refuses its opener. Nothing else is dispatched. */
export function activate(widget: WidgetTarget, ctx: WidgetContext): boolean {
  const opener = widget.opener ?? (widget.element as HTMLElement);
  if (!assertNotSubmit(opener, ctx).ok) return false;
  const view = windowOf(opener);
  const declared = widget.activation[0];
  if (declared === 'mousedown') {
    opener.dispatchEvent(new view.MouseEvent('mousedown', { bubbles: true, cancelable: true, composed: true, button: 0 }));
  } else if (declared === 'focus') {
    opener.dispatchEvent(new view.FocusEvent('focus', { composed: true }));
  } else {
    opener.click();
  }
  return true;
}

/** How opening a widget went. 'ignored': the page did nothing at all; 'no-list': it answered, but shows no list. */
export type OpenResult =
  | { open: true; listbox: Element; activated: boolean }
  | { open: false; reason: 'refused' | 'ignored' | 'no-list' | 'aborted'; mutated: boolean };

/** Opens a widget's list, unless it is open already: one activation, then the page's answer. */
export async function openList(widget: WidgetTarget, ctx: WidgetContext): Promise<OpenResult> {
  const shown = openListOf(widget);
  if (shown !== null) return { open: true, listbox: shown, activated: false };
  if (!activate(widget, ctx)) return { open: false, reason: 'refused', mutated: false };
  const answer = await afterAction(widget, ctx);
  if (answer.aborted) return { open: false, reason: 'aborted', mutated: answer.mutated };
  const listbox = openListOf(widget);
  if (listbox !== null) return { open: true, listbox, activated: true };
  return { open: false, reason: answer.mutated ? 'no-list' : 'ignored', mutated: answer.mutated };
}

/** Closes a widget's list if it is open (see the header). Answers whether it is closed now. */
export async function closeList(widget: WidgetTarget, ctx: WidgetContext, opened: { activated: boolean }):
  Promise<boolean> {
  if (openListOf(widget) === null) return true;
  fireLeave(widget.input ?? widget.element);
  const answer = await afterAction(widget, ctx);
  if (answer.aborted || openListOf(widget) === null) return openListOf(widget) === null;
  const opener = widget.opener ?? (widget.element as HTMLElement);
  // A select-only combobox that our click opened toggles shut on a second click; a text box does not.
  if (opened.activated && widget.input === null && widget.activation.length === 0 && assertNotSubmit(opener, ctx).ok) {
    opener.click();
    await afterAction(widget, ctx);
  }
  return openListOf(widget) === null;
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
      if (busyIn(busyScopes(widget, listbox))) {
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
