/*
 * settle() (docs/design/runtime.md §7; docs/ARCHITECTURE.md "settle()"): after a pass's writes, the page gets a
 * bounded moment to react before it is scanned again and each written field is verified. It replaces Phase 2's
 * stand-in (src/content/quiet.ts) and answers the same SettleResult.
 * 1. A MutationObserver watches the form root and every open shadow root inside it (childList, subtree, attributes,
 *    characterData). Every page mutation starts the quiet window (SETTLE_QUIET_MS) again; the extension's own UI
 *    (registerOwnUiHost) does not count, nor does adding or removing its host. A shadow root first seen at a
 *    window's end (attachShadow makes no mutation record) is watched for one more window.
 * 2. At the end of each quiet window it looks for a busy sign a person can see (BUSY_SIGNS: aria-busy, an
 *    indeterminate progress bar, the adapter's isBusy, an option list still loading). If one shows it waits one more
 *    window and looks again, because a spinner animates without mutating the DOM; otherwise the page has settled.
 * 3. An option list still loading counts only up to OPTIONS_CAP_MS from the start: past that, the list is
 *    awaitOptions' to flag (options-never-loaded), not a busy page.
 * 4. At the cap (SETTLE_CAP_MS, raised by the adapter's quirks.settleCapMs up to SETTLE_CAP_MAX_MS) it answers
 *    page-still-busy, and the caller shows the page-busy notice. The run's AbortSignal ends it at once ('aborted').
 * Every wait ends on that DOM condition, the cap or the signal: the timers are dom/time.ts's, cleared here or by the
 * signal, and there is no fixed sleep. Nothing here reads or reports a value.
 *
 * The quiet-window machinery (quietWait) and the busy checks are shared with awaitOptions (await-options.ts).
 */
import type { Adapter } from '../adapters/types';
import { normalize } from '../core/text/normalize';
import { CONTROL_SELECTOR, kindOf } from './kinds';
import { cleanOptionLabel } from './option-hash';
import { isInOwnUi } from './own-ui';
import { newScanCache, type ScanCache, viewOf } from './scan-cache';
import { OPTIONS_CAP_MS, SETTLE_CAP_MAX_MS, SETTLE_CAP_MS, SETTLE_QUIET_MS } from './thresholds';
import { type Cancel, monotonicNow, startDeadline } from './time';
import { BUSY_SIGNS, type BusySign, type SettleResult } from './types';
import { readSelectOptions } from './visible-text';
import { isUserVisible } from './visibility';

/** What settle() needs besides the form root. The windows and caps are overridable for tests. */
export interface SettleOptions {
  /** The frame's adapter: its isBusy is a busy sign, and its quirks.settleCapMs may raise the cap. */
  adapter?: Adapter | null;
  /** The run's signal: aborting it ends the wait at once with 'aborted'. */
  signal?: AbortSignal;
  /** The quiet window (SETTLE_QUIET_MS). */
  quietMs?: number;
  /** The cap (settleCapFor(adapter)). */
  capMs?: number;
  /** How long an option list still loading counts as busy (OPTIONS_CAP_MS). */
  optionsCapMs?: number;
}

/** Waits until `root` has been quiet for a window with no busy sign showing, at most the cap. */
export function settle(root: Element, options: SettleOptions = {}): Promise<SettleResult> {
  const adapter = options.adapter ?? null;
  const optionsCapMs = options.optionsCapMs ?? OPTIONS_CAP_MS;
  const view = viewOf(root);
  const started = monotonicNow();
  if (view === null) return Promise.resolve({ settled: false, reason: 'aborted' });
  const wait = quietWait<SettleResult>({
    view,
    quietMs: options.quietMs ?? SETTLE_QUIET_MS,
    capMs: options.capMs ?? settleCapFor(adapter),
    signal: options.signal,
    aborted: { settled: false, reason: 'aborted' },
    atCap: () => ({ settled: false, reason: 'page-still-busy' }),
    atQuiet: () => {
      const shadows = shadowScopes(root);
      // A shadow root seen for the first time (attachShadow makes no mutation record) was not watched during this
      // window: watch it for one more before calling the page quiet.
      if (shadows.filter(wait.observe).length > 0) return null;
      const listsCount = monotonicNow() - started < optionsCapMs;
      const busy = busySignsIn(root, shadows, adapter, newScanCache())
        .some((sign) => sign !== 'options-loading' || listsCount);
      return busy ? null : { settled: true, ms: Math.round(monotonicNow() - started) };
    },
    // A shadow root that arrives with new nodes is watched from then on.
    onPageRecords: (records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (node.nodeType === 1) shadowScopes(node as Element).forEach(wait.observe);
        });
      }
    },
  });
  wait.observe(root);
  shadowScopes(root).forEach(wait.observe);
  return wait.done;
}

/** The settle cap for a frame: SETTLE_CAP_MS, or the adapter's larger quirks.settleCapMs, at most SETTLE_CAP_MAX_MS.
 *  An adapter may raise the cap, never lower it. */
export function settleCapFor(adapter: Adapter | null): number {
  const raised = adapter?.quirks?.settleCapMs;
  if (typeof raised !== 'number' || Number.isNaN(raised)) return SETTLE_CAP_MS;
  return Math.min(SETTLE_CAP_MAX_MS, Math.max(SETTLE_CAP_MS, raised));
}

// ── Busy signs ───────────────────────────────────────────────────────────────────────────────────────────────────

/** The busy signs a person can see in `root` right now, in BUSY_SIGNS order: the check settle() makes at the end of
 *  each quiet window. Callers may read it once more after a page-still-busy answer, to log which signs kept the page
 *  busy (names only, never page text). */
export function busySigns(root: Element, adapter: Adapter | null, cache: ScanCache = newScanCache()): BusySign[] {
  return busySignsIn(root, shadowScopes(root), adapter, cache);
}

/** Elements that may carry a busy sign: aria-busy, a progress bar, and the selects whose options may be loading. */
const BUSY_CANDIDATES = '[aria-busy], [role~="progressbar" i], progress, select';
/** The same without selects: what can be busy inside a list's field container. */
export const BUSY_ELEMENTS = '[aria-busy], [role~="progressbar" i], progress';

function busySignsIn(root: Element, shadows: readonly ShadowRoot[], adapter: Adapter | null, cache: ScanCache):
  BusySign[] {
  const found = new Set<BusySign>();
  // The root, or an ancestor around it, marked busy: the whole form is.
  for (let at: Element | null = root; at !== null; at = at.parentElement) {
    if (isAriaBusy(at) && !isInOwnUi(at) && isUserVisible(at, cache)) {
      found.add('aria-busy');
      break;
    }
  }
  for (const scope of [root, ...shadows]) {
    for (const el of Array.from(scope.querySelectorAll(BUSY_CANDIDATES))) {
      if (isInOwnUi(el)) continue;
      if (el.localName === 'select') {
        const select = el as HTMLSelectElement;
        if (hasLoadingOption(select, cache) || (isAriaBusy(select) && isUserVisible(select, cache))) {
          found.add('options-loading');
        }
        continue;
      }
      const sign = busySignOf(el);
      if (sign === null || !isUserVisible(el, cache)) continue;
      found.add(listHolding(el) === null ? sign : 'options-loading');
    }
  }
  if (adapterSaysBusy(adapter, root.ownerDocument)) found.add('adapter');
  return BUSY_SIGNS.filter((sign) => found.has(sign));
}

/** The busy sign an element carries by its markup alone (whether a person can see it is checked apart):
 *  aria-busy="true", or an indeterminate progress bar. */
export function busySignOf(el: Element): 'aria-busy' | 'progressbar' | null {
  if (isAriaBusy(el)) return 'aria-busy';
  return isIndeterminateProgress(el) ? 'progressbar' : null;
}

function isAriaBusy(el: Element): boolean {
  return (el.getAttribute('aria-busy') ?? '').trim().toLowerCase() === 'true';
}

/**
 * A progress bar that shows no amount: a <progress> with no value (its position is -1), or a role="progressbar"
 * with no numeric aria-valuenow. A determinate bar never counts, complete or not: a step indicator ("step 2 of 5")
 * is one, and a bar whose amount moves mutates the DOM anyway.
 */
function isIndeterminateProgress(el: Element): boolean {
  if (el.localName === 'progress') return (el as HTMLProgressElement).position === -1;
  const roles = (el.getAttribute('role') ?? '').trim().toLowerCase().split(/\s+/);
  if (!roles.includes('progressbar')) return false;
  const now = (el.getAttribute('aria-valuenow') ?? '').trim();
  return now === '' || !Number.isFinite(Number(now));
}

/** The adapter's isBusy. An adapter that throws counts as busy: the cap still ends the wait. */
function adapterSaysBusy(adapter: Adapter | null, doc: Document): boolean {
  if (adapter?.isBusy === undefined) return false;
  try {
    return adapter.isBusy(doc);
  } catch {
    return true;
  }
}

/**
 * The select whose field container holds `el` (the list's own wrapper: an ancestor holding no other field control,
 * labels.ts fieldContainer), or the select `el` is or sits in. Null when `el` belongs to the page around more than one
 * control, or to none. A busy sign there is an option list's, not the page's.
 */
export function listHolding(el: Element): HTMLSelectElement | null {
  for (let at: Element | null = el; at !== null; at = at.parentElement) {
    if (at.localName === 'select') return at as HTMLSelectElement;
    if (at.localName === 'body' || at.localName === 'html' || at.localName === 'form') return null;
    const controls = Array.from(at.querySelectorAll(CONTROL_SELECTOR)).filter(isFieldControl);
    if (controls.length === 0) continue;
    return controls.length === 1 && controls[0]!.localName === 'select' ? controls[0] as HTMLSelectElement : null;
  }
  return null;
}

/** A control the scanner could make a field of, or an auth field (labels.ts counts the same ones). */
function isFieldControl(el: Element): boolean {
  const kind = kindOf(el);
  return kind.field || kind.auth;
}

// ── Loading phrases ──────────────────────────────────────────────────────────────────────────────────────────────

/** Option texts that mean a list is still loading when they are the whole text ("Please wait..."). */
export const LOADING_OPTION_PHRASES = ['Loading', 'Fetching', 'Retrieving', 'Searching', 'Updating', 'Please wait',
  'One moment', 'One moment please', 'Just a moment'] as const;
/** Words that mean a list is still loading when an option's text starts with them ("Loading states...",
 *  "Fetching cities"). */
export const LOADING_OPTION_LEADS = ['Loading', 'Fetching', 'Retrieving', 'Searching'] as const;

/** Both lists as answer keys: compared through the core's normalizer, as the placeholders are (option-hash.ts), so
 *  case, punctuation and an ellipsis make no difference. */
const LOADING_KEYS: ReadonlySet<string> = new Set(LOADING_OPTION_PHRASES.map((phrase) => answerKey(phrase)));
const LOADING_LEAD_KEYS: readonly string[] = LOADING_OPTION_LEADS.map((lead) => `${answerKey(lead)} `);

function answerKey(text: string): string {
  return normalize(text, 'answer').key;
}

/** True when an option's label says its list is still loading ("Loading...", "Please wait", "Fetching cities"). The
 *  injected text is cut first, as for every option label. */
export function isLoadingOptionLabel(label: string): boolean {
  const key = answerKey(cleanOptionLabel(label));
  return LOADING_KEYS.has(key) || LOADING_LEAD_KEYS.some((lead) => key.startsWith(lead));
}

/** A visible select one of whose visible options is a loading phrase. */
function hasLoadingOption(select: HTMLSelectElement, cache: ScanCache): boolean {
  return readSelectOptions(select, cache).some((option) => isLoadingOptionLabel(option.label));
}

// ── Shadow roots ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Every open shadow root at or under `el`, nested ones included; the extension's own host is never entered. */
export function shadowScopes(el: Element): ShadowRoot[] {
  const found: ShadowRoot[] = [];
  const visit = (at: Element) => {
    if (at.shadowRoot === null || isInOwnUi(at)) return;
    found.push(at.shadowRoot);
    at.shadowRoot.querySelectorAll('*').forEach(visit);
  };
  visit(el);
  el.querySelectorAll('*').forEach(visit);
  return found;
}

// ── The quiet-window wait ────────────────────────────────────────────────────────────────────────────────────────

/** The mutation records the extension's own UI caused: inside its host, or adding or removing the host itself. */
export function isOwnRecord(record: MutationRecord): boolean {
  if (isInOwnUi(record.target)) return true;
  if (record.type !== 'childList') return false;
  const nodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
  return nodes.length > 0 && nodes.every((node) => isInOwnUi(node));
}

/** What one quiet-window wait does: settle() and awaitOptions() differ only in these. */
export interface QuietWaitSpec<T> {
  /** The window the observed nodes live in: its MutationObserver is used. */
  view: Window & typeof globalThis;
  /** A page mutation starts this window again. */
  quietMs: number;
  /** The wait ends with atCap() this long after it began. */
  capMs: number;
  signal: AbortSignal | undefined;
  /** The answer when the signal aborts. */
  aborted: T;
  /** At the end of each quiet window: an answer ends the wait; null waits one more window. */
  atQuiet(): T | null;
  /** The answer at the cap. */
  atCap(): T;
  /** The page's own records of each observer callback (the extension's own already left out). */
  onPageRecords?(records: readonly MutationRecord[]): void;
}

/** A running quiet-window wait. */
export interface QuietWait<T> {
  /** The answer. It rejects only when atQuiet or atCap throws, so a broken check never leaves a wait hanging. */
  readonly done: Promise<T>;
  /** Watches one more node (childList, subtree, attributes, characterData). True when it was not watched yet;
   *  watching a node twice is harmless. */
  readonly observe: (target: Node) => boolean;
  /** Stops watching every node, before watching a replacement. */
  readonly unobserveAll: () => void;
}

const OBSERVE_ALL: MutationObserverInit = { childList: true, subtree: true, attributes: true, characterData: true };

/**
 * Starts a wait that ends at the first quiet window whose atQuiet() answers, at the cap with atCap(), or with
 * `aborted` when the signal aborts. Every page mutation on an observed node starts the window again. Its only timers
 * are dom/time.ts's deadlines, all cleared when it ends.
 */
export function quietWait<T>(spec: QuietWaitSpec<T>): QuietWait<T> {
  const { view, quietMs, capMs, signal } = spec;
  let finished = false;
  let cancelQuiet: Cancel = () => undefined;
  let cancelCap: Cancel = () => undefined;
  let settleDone: (answer: T) => void = () => undefined;
  let failDone: (error: unknown) => void = () => undefined;
  const done = new Promise<T>((resolve, reject) => {
    settleDone = resolve;
    failDone = reject;
  });
  const watched = new Set<Node>();
  const observer = new view.MutationObserver((records) => {
    if (finished) return;
    const page = records.filter((record) => !isOwnRecord(record));
    if (page.length === 0) return;
    guarded(() => {
      spec.onPageRecords?.(page);
      restartQuiet();
    });
  });

  function end(): void {
    finished = true;
    observer.disconnect();
    watched.clear();
    cancelQuiet();
    cancelCap();
    signal?.removeEventListener('abort', onAbort);
  }
  function finish(answer: T): void {
    if (finished) return;
    end();
    settleDone(answer);
  }
  function guarded(step: () => void): void {
    try {
      step();
    } catch (error) {
      if (finished) return;
      end();
      failDone(error);
    }
  }
  function onAbort(): void {
    finish(spec.aborted);
  }
  function restartQuiet(): void {
    cancelQuiet();
    cancelQuiet = startDeadline(quietMs, atQuiet, signal);
  }
  function atQuiet(): void {
    if (finished) return;
    guarded(() => {
      const answer = spec.atQuiet();
      if (answer !== null) finish(answer);
      else restartQuiet();
    });
  }

  const observe = (target: Node): boolean => {
    if (finished || watched.has(target)) return false;
    watched.add(target);
    observer.observe(target, OBSERVE_ALL);
    return true;
  };
  const unobserveAll = () => {
    observer.disconnect();
    watched.clear();
  };
  if (signal?.aborted) {
    finish(spec.aborted);
    return { done, observe, unobserveAll };
  }
  signal?.addEventListener('abort', onAbort, { once: true });
  cancelCap = startDeadline(capMs, () => guarded(() => finish(spec.atCap())), signal);
  restartQuiet();
  return { done, observe, unobserveAll };
}
