/*
 * Phase 2's settle, a stand-in until Phase 3 builds dom/settle.ts (docs/design/runtime.md §7). After the pass's writes
 * the page gets a bounded quiet moment before it is scanned again and each written field is verified:
 * 1. one animation frame, so a framework re-renders after our events (raced against the quiet window, because a
 *    background tab runs no animation frames);
 * 2. then SETTLE_QUIET_MS (250) in which a MutationObserver on the form root sees no mutation (childList, subtree,
 *    attributes, characterData; mutations inside the extension's own UI do not count), every mutation starting the
 *    window again;
 * 3. capped at SETTLE_CAP_MS (8000) from the start, after which it answers page-still-busy and the run shows the
 *    page-busy notice.
 * Every wait ends on that DOM condition or the cap: the timers are dom/time.ts's, cleared here or by the run's signal,
 * and there is no fixed sleep. Unlike Phase 3's settle() it does not look for busy signs (aria-busy, progress bars,
 * the adapter's spinner) and does not wait for dependent option lists; Phase 3 replaces this file, and its one caller
 * (orchestrator.ts, settleWrites), with settle() and keeps the same SettleResult.
 */
import { isInOwnUi } from '../dom/own-ui';
import { SETTLE_CAP_MS, SETTLE_QUIET_MS } from '../dom/thresholds';
import { monotonicNow, startDeadline, type Cancel } from '../dom/time';
import type { SettleResult } from '../dom/types';

/** The quiet window and the cap, overridable for tests. */
export interface QuietOptions {
  quietMs?: number;
  capMs?: number;
  signal?: AbortSignal;
}

/** Waits one animation frame, then until `root` has been quiet for the quiet window, at most the cap. */
export function waitForQuiet(root: Element, options: QuietOptions = {}): Promise<SettleResult> {
  const quietMs = options.quietMs ?? SETTLE_QUIET_MS;
  const capMs = options.capMs ?? SETTLE_CAP_MS;
  const { signal } = options;
  const view = root.ownerDocument.defaultView;
  const started = monotonicNow();
  return new Promise((resolve) => {
    if (signal?.aborted || view === null) {
      resolve({ settled: false, reason: 'aborted' });
      return;
    }
    let done = false;
    let cancelQuiet: Cancel = () => undefined;
    let frame: number | null = null;
    const observer = new view.MutationObserver((records) => {
      if (records.every((record) => isInOwnUi(record.target))) return;
      restartQuiet();
    });
    const finish = (result: SettleResult) => {
      if (done) return;
      done = true;
      observer.disconnect();
      cancelQuiet();
      cancelCap();
      cancelFirst();
      if (frame !== null) view.cancelAnimationFrame(frame);
      signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = () => finish({ settled: false, reason: 'aborted' });
    function restartQuiet(): void {
      cancelQuiet();
      cancelQuiet = startDeadline(quietMs, () => finish({ settled: true, ms: Math.round(monotonicNow() - started) }),
        signal);
    }
    function startWatching(): void {
      if (done || frame === null) return;
      frame = null;
      cancelFirst();
      observer.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
      restartQuiet();
    }
    const cancelCap = startDeadline(capMs, () => finish({ settled: false, reason: 'page-still-busy' }), signal);
    frame = view.requestAnimationFrame(startWatching);
    // A background tab runs no animation frames: the first quiet window stands in for the frame there.
    const cancelFirst = startDeadline(quietMs, startWatching, signal);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
