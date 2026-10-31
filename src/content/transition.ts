/*
 * The wait for the next step (WAIT_TRANSITION; docs/SPEC.md Requirement C: "wait until the step signature changes and
 * the DOM is quiet. No fixed sleeps"; docs/ARCHITECTURE.md "Orchestrator" › auto-advance; docs/design/core.md §10.2,
 * the await-transition effect). It watches the page for a reason to look again, and each time it looks it first lets
 * the page settle:
 * - a reason to look: any page mutation in the document (the extension's own UI does not count), an address change
 *   (location.ts: the Navigation API, popstate, hashchange, or the poll without the Navigation API), and, when asked, a
 *   trusted click on the step's Next (the person's own click; Playwright's stands for it in tests);
 * - each look: settle() over the form root the adapter finds now (a step may replace it), then the step's signature.
 *   A signature other than the one the wait started from is a transition ('changed'). A look after the person's Next
 *   that finds the step as it was (errors showed instead) is 'unchanged'. A look whose settle hit its cap waits for the
 *   next reason;
 * - the cap (`capMs`, after the extension's own click: TRANSITION_CAP_MS or the adapter's): at the cap the answer is
 *   'timed-out' with the signature then, and the machine decides needs-click or page-busy. No cap (the person's turn):
 *   it waits as long as the page shows the step, until the run ends ('aborted').
 * A signature that already differs when the wait starts is a transition at once, once the page is quiet. The only
 * timers are dom/time.ts's (the cap, settle's windows). Nothing here reads or logs a value: the signature is a hash.
 */
import type { Adapter } from '../adapters/types';
import { isOwnRecord, settle, type SettleOptions } from '../dom/settle';
import { startDeadline } from '../dom/time';
import { watchLocation } from './location';

/** How a wait for the next step ended. */
export type TransitionOutcome =
  | { kind: 'changed'; signature: string }
  | { kind: 'unchanged' }
  | { kind: 'timed-out'; signature: string }
  | { kind: 'aborted' };

/** What the wait needs. */
export interface TransitionWatch {
  doc: Document;
  adapter: Adapter;
  /** The form root to settle, found again at each look (the adapter's detect, else the run's root). */
  root(): Element;
  /** The step's signature now. */
  signature(): string;
  /** The signature the wait started from. */
  from: string;
  /** null: no cap (the person clicks Next). */
  capMs: number | null;
  /** The run's signal: it ends the wait ('aborted'). */
  signal: AbortSignal;
  /** Watch the person's trusted click on the step's Next: a look after it that finds the step unchanged ends the wait. */
  watchNext: boolean;
  settle?: Pick<SettleOptions, 'quietMs' | 'capMs' | 'optionsCapMs'>;
}

/** Waits for the step to change (module header). */
export function awaitTransition(watch: TransitionWatch): Promise<TransitionOutcome> {
  const { doc, adapter, signal } = watch;
  const view = doc.defaultView;
  if (view === null || signal.aborted) return Promise.resolve({ kind: 'aborted' });
  return new Promise<TransitionOutcome>((resolve) => {
    const own = new AbortController();
    const stop = AbortSignal.any([signal, own.signal]);
    let finished = false;
    let looking = false;
    let again = false;
    /** A trusted click on Next since the last look began. */
    let nextClicked = false;

    const finish = (outcome: TransitionOutcome) => {
      if (finished) return;
      finished = true;
      observer.disconnect();
      cancelCap();
      own.abort();
      resolve(outcome);
    };

    const look = async (): Promise<void> => {
      if (finished) return;
      if (looking) {
        again = true;
        return;
      }
      looking = true;
      const clicked = nextClicked;
      nextClicked = false;
      try {
        const settled = await settle(watch.root(), { adapter, signal: stop, ...watch.settle });
        if (finished) return;
        if (!settled.settled && settled.reason === 'aborted') {
          finish({ kind: 'aborted' });
          return;
        }
        if (!settled.settled) return;
        const now = watch.signature();
        if (now !== watch.from) finish({ kind: 'changed', signature: now });
        else if (clicked) finish({ kind: 'unchanged' });
      } finally {
        looking = false;
        if (again && !finished) {
          again = false;
          void look();
        }
      }
    };

    const observer = new view.MutationObserver((records) => {
      if (records.some((record) => !isOwnRecord(record))) void look();
    });
    observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    watchLocation(view, () => doc.location.href, () => void look(), stop);
    if (watch.watchNext) {
      doc.addEventListener('click', (event) => {
        if (!event.isTrusted) return;
        let next: HTMLElement | null = null;
        try {
          next = adapter.nextButton?.(watch.root()) ?? null;
        } catch {
          next = null;
        }
        const target = event.composedPath()[0];
        if (next === null || !(target instanceof view.Node) || !next.contains(target)) return;
        nextClicked = true;
        void look();
      }, { capture: true, signal: stop });
    }
    const cancelCap = watch.capMs === null ? () => undefined
      : startDeadline(watch.capMs, () => finish({ kind: 'timed-out', signature: watch.signature() }), stop);
    signal.addEventListener('abort', () => finish({ kind: 'aborted' }), { once: true, signal: own.signal });
    void look();
  });
}
