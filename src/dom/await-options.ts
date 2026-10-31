/*
 * Dependent option lists (docs/design/runtime.md §7.1; docs/ARCHITECTURE.md "settle()"): a state list that fills in
 * after the country is chosen. awaitOptions waits until the list holds real options (not only placeholders, not a
 * "Loading..." row), their option-set hash differs from the one it had before its parent changed, and the list has
 * been quiet for OPTIONS_QUIET_MS; at OPTIONS_CAP_MS it answers never-loaded, and the field is flagged
 * options-never-loaded. It applies to a pending list that:
 * - has no options, or only placeholders;
 * - has an option whose text is a loading phrase (the core's one list, core/text/loading.ts, through settle.ts's
 *   isLoadingOptionLabel; such a row is never a usable option, so it counts in no option-set hash);
 * - carries aria-busy, or shows an indeterminate progress bar, itself or in its field container;
 * - or still has the hash it had before its parent changed (known from the reveal edges, or because its options
 *   changed during the last settle).
 * optionsState says which, right now, without waiting.
 *
 * Only native selects (kind select or multiselect) are read here; Phase 4's widget helper opens ARIA listboxes and
 * applies the same rule to them. The page may replace the list's element while it loads (React does): `refind`
 * finds it again, typically by the field's baseKey in a fresh scan, since the key itself changes with the options.
 * Every wait ends on that DOM condition, the cap or the run's signal (settle.ts's quietWait, dom/time.ts's timers);
 * there is no fixed sleep. It reads option labels only to hash them, and reports a reason, never an option.
 */
import type { OptionSetHash } from '../core/types/field';
import { fieldContainer } from './labels';
import { hashOfOptions, isUsableOption } from './option-hash';
import { isInOwnUi } from './own-ui';
import { newScanCache, type ScanCache, viewOf } from './scan-cache';
import { BUSY_ELEMENTS, busySignOf, isLoadingOptionLabel, quietWait } from './settle';
import { OPTIONS_CAP_MS, OPTIONS_QUIET_MS } from './thresholds';
import { monotonicNow } from './time';
import type { AwaitOptionsResult, FieldTarget, OptionsState, OptionsWaiting } from './types';
import { readSelectOptions } from './visible-text';
import { isUserVisible } from './visibility';

/** What awaitOptions needs besides the list. The window and the cap are overridable for tests. */
export interface AwaitOptionsOptions {
  /** The list's option-set hash before its parent changed: options count as arrived only once their hash differs.
   *  null when there was no earlier set to compare with (any real options will do). */
  prevHash: OptionSetHash | null;
  /** The run's signal: aborting it ends the wait at once with 'aborted'. */
  signal?: AbortSignal;
  /** The quiet window (OPTIONS_QUIET_MS). */
  quietMs?: number;
  /** The cap (OPTIONS_CAP_MS). */
  capMs?: number;
  /** When the wait for this list began (a monotonicNow() reading: the parent's write, say), so the cap counts from
   *  then and a settle spent waiting on the list is not waited again. Default: now. */
  startedAt?: number;
  /** Finds the list again once the page has replaced its element; null while it is not there. Without it a replaced
   *  list is 'gone' at once. */
  refind?: () => Element | null;
}

/** True when awaitOptions can read this field's options: a native select. */
export function isOptionList(control: Element): control is HTMLSelectElement {
  return control.localName === 'select';
}

/** Waits until a dependent list's real options have arrived and changed, at most the cap (see the header). */
export function awaitOptions(field: FieldTarget | Element, options: AwaitOptionsOptions): Promise<AwaitOptionsResult> {
  const first = isElement(field) ? field : field.control;
  if (!isOptionList(first)) {
    return Promise.reject(new TypeError('awaitOptions reads native selects only; Phase 4 adds listbox widgets'));
  }
  const { prevHash, signal } = options;
  const capMs = options.capMs ?? OPTIONS_CAP_MS;
  const started = Math.min(options.startedAt ?? monotonicNow(), monotonicNow());
  /** Ready, or never-loaded with what the list was still waiting for. */
  const answer = (state: OptionsState): AwaitOptionsResult => state.ready
    ? { status: 'ready', optionSetHash: state.optionSetHash, ms: Math.round(monotonicNow() - started) }
    : { status: 'never-loaded', reason: 'options-never-loaded', waiting: state.waiting };
  if (signal?.aborted) return Promise.resolve({ status: 'aborted' });

  let list: HTMLSelectElement | null = first.isConnected ? first : found(options.refind);
  const view = list === null ? null : viewOf(list);
  if (list === null || view === null) return Promise.resolve({ status: 'gone' });
  const remaining = capMs - (monotonicNow() - started);
  // The cap already passed while the caller waited (a settle on the same list): answer from what the list holds now.
  if (remaining <= 0) return Promise.resolve(answer(optionsState(list, prevHash)));

  const wait = quietWait<AwaitOptionsResult>({
    view,
    quietMs: options.quietMs ?? OPTIONS_QUIET_MS,
    capMs: remaining,
    signal,
    aborted: { status: 'aborted' },
    atQuiet: () => {
      if (list === null || !list.isConnected) {
        if (options.refind === undefined) return { status: 'gone' };
        const again = found(options.refind);
        // Not back yet: look again after the next window. Back: watch it for one quiet window before reading it.
        if (again !== null) watch(again);
        return null;
      }
      const state = optionsState(list, prevHash);
      return state.ready ? answer(state) : null;
    },
    atCap: () => {
      if (list === null || !list.isConnected) list = found(options.refind);
      // Real, changed options that arrived inside the last window still count: they are not "never loaded".
      return list === null ? { status: 'gone' } : answer(optionsState(list, prevHash));
    },
  });
  function watch(next: HTMLSelectElement): void {
    list = next;
    wait.unobserveAll();
    wait.observe(listScope(next));
  }
  watch(list);
  return wait.done;
}

/**
 * A dependent list's state right now (OPTIONS_WAITING's order): gone, hidden, busy, loading, placeholders, unchanged,
 * or ready with the hash of its options. The hash is the scanner's (hashOfOptions over the same visible labels), so
 * a ready list's field has exactly this optionSetHash in the next scan.
 */
export function optionsState(list: HTMLSelectElement, prevHash: OptionSetHash | null,
  cache: ScanCache = newScanCache()): OptionsState {
  const waiting = (reason: OptionsWaiting): OptionsState => ({ ready: false, waiting: reason });
  if (!list.isConnected) return waiting('gone');
  if (!isUserVisible(list, cache)) return waiting('hidden');
  if (busyWithin(listScope(list), cache)) return waiting('busy');
  const labels = readSelectOptions(list, cache).map((option) => option.label);
  if (labels.some(isLoadingOptionLabel)) return waiting('loading');
  if (!labels.some(isUsableOption)) return waiting('placeholders');
  const hash = hashOfOptions(labels);
  if (prevHash !== null && hash === prevHash) return waiting('unchanged');
  return { ready: true, optionSetHash: hash };
}

/** Where a list's own busy signs and mutations are: its field container (the outermost ancestor holding no other
 *  field control), or the list alone when its parent holds other controls. */
function listScope(list: HTMLSelectElement): Element {
  return fieldContainer(list) ?? list;
}

/** A visible aria-busy or indeterminate progress bar at or inside `scope`. */
function busyWithin(scope: Element, cache: ScanCache): boolean {
  return [scope, ...Array.from(scope.querySelectorAll(BUSY_ELEMENTS))]
    .some((el) => busySignOf(el) !== null && !isInOwnUi(el) && isUserVisible(el, cache));
}

/** The caller's refind, kept only when it gives a select that is in the page. */
function found(refind: (() => Element | null) | undefined): HTMLSelectElement | null {
  const again = refind?.() ?? null;
  return again !== null && again.isConnected && isOptionList(again) ? again : null;
}

function isElement(value: FieldTarget | Element): value is Element {
  return typeof (value as Partial<Node>).nodeType === 'number';
}
