/*
 * A form root its page draws late (docs/ARCHITECTURE.md "How it works at run time"): Ashby's application form is drawn
 * by the page's own React 4.8 to 6.8 s after the page loads (the capture of 2026-11-01), long after the content script
 * started at document_idle, and again after the overview's Application tab changes the address. An adapter that says
 * so (quirks.formLateMs) has the content runtime look for its form root again as the page changes: each burst of
 * mutations in the document is answered by one look, LATE_FORM_LOOK_MS after its first record, until the look finds
 * one, the adapter's own wait is over (held at LATE_FORM_CAP_MS), or the runtime's signal aborts. No adapter of the
 * address saying so, nothing is watched: a page without a form shows no launcher, as before. A look reads the page
 * (the adapters' detect), never writes it.
 * While that wait runs, only the adapters that say their page draws its form late may claim the page (lateAdapters):
 * the generic adapter, which takes any page with a visible control, never takes one before its own adapter's form is
 * drawn; once the wait is over without it, every adapter may. The same watch waits for a posting page's own text
 * (Adapter.postingText: Ashby's overview, drawn as late), which is then read for the policy notice.
 * v3 Phase 8 (the review's B5): a company's own page, where the worker injected the content script, is watched for its
 * form for the document's life instead (watchForSiteForm), and cheaply: a batch of mutations counts only when it adds a
 * form, a control or JSON-LD (dom/page-signals.ts addsFormParts, by tag and attribute alone), and each look waits for
 * the browser's next frame (never in a hidden tab) and for its gap, SITE_LOOK_GAP_MS doubling up to
 * SITE_LOOK_MAX_GAP_MS.
 */
import type { Adapter } from '../adapters/types';
import { addsFormParts } from '../dom/page-signals';
import { monotonicNow, nextFrame, startDeadline, type Cancel } from '../dom/time';

/** One look at the page this long after the first mutation of a burst: the page has drawn more of its form by then. */
export const LATE_FORM_LOOK_MS = 100;
/** An adapter's wait for its late form is held at this at most. */
export const LATE_FORM_CAP_MS = 30_000;

/** The adapters that may claim a page while its own adapter waits for a form it draws late: those that say so (their
 *  order kept); every adapter when none does. */
export function lateAdapters(adapters: readonly Adapter[]): Adapter[] {
  const late = adapters.filter((adapter) => (adapter.quirks?.formLateMs ?? 0) > 0);
  return late.length > 0 ? late : [...adapters];
}

/** How long the adapters of an address wait for a late form root: the longest any of them says, held at the cap; 0
 *  when none says its form is drawn late. */
export function lateFormMs(adapters: readonly Adapter[]): number {
  let longest = 0;
  for (const adapter of adapters) {
    const ms = adapter.quirks?.formLateMs ?? 0;
    if (Number.isFinite(ms) && ms > longest) longest = ms;
  }
  return Math.min(longest, LATE_FORM_CAP_MS);
}

/**
 * Watches `doc` for `capMs` (see the header), calling `look` once after each burst of mutations; stops as soon as a
 * look answers true, at the cap (calling `expired`), or when `signal` aborts. Answers how to stop it sooner.
 */
export function watchForLateForm(doc: Document, capMs: number, look: () => boolean, signal: AbortSignal,
  expired?: () => void): Cancel {
  const view = doc.defaultView;
  if (view === null || capMs <= 0 || signal.aborted) return () => undefined;
  let pending: Cancel | null = null;
  let done = false;
  const observer = new view.MutationObserver(() => {
    if (done || pending !== null) return;
    pending = startDeadline(LATE_FORM_LOOK_MS, () => {
      pending = null;
      if (!done && look()) stop();
    }, signal);
  });
  const cap = startDeadline(capMs, () => {
    if (done) return;
    stop();
    expired?.();
  }, signal);
  function stop(): void {
    if (done) return;
    done = true;
    observer.disconnect();
    pending?.();
    pending = null;
    cap();
    signal.removeEventListener('abort', stop);
  }
  signal.addEventListener('abort', stop, { once: true });
  observer.observe(doc.documentElement ?? doc, { childList: true, subtree: true });
  return stop;
}

/** The least time between two looks for a company page's form; it doubles with each look, up to the most. */
export const SITE_LOOK_GAP_MS = 750;
export const SITE_LOOK_MAX_GAP_MS = 12_000;

/** Watches a company page for its form for the document's life (the module header): calls `look` when the page adds a
 *  form's parts, at the browser's next frame once the gap is over; stops as soon as a look answers true or `signal`
 *  aborts. Answers how to stop it sooner. */
export function watchForSiteForm(doc: Document, look: () => boolean, signal: AbortSignal): Cancel {
  const view = doc.defaultView;
  if (view === null || signal.aborted) return () => undefined;
  let looks = 0;
  let last = 0;
  let pending: Cancel | null = null;
  let done = false;
  const observer = new view.MutationObserver((records) => {
    if (done || pending !== null || !addsFormParts(records)) return;
    const gap = looks === 0 ? 0 : Math.min(SITE_LOOK_GAP_MS * 2 ** (looks - 1), SITE_LOOK_MAX_GAP_MS);
    let frame: Cancel | null = null;
    const timer = startDeadline(Math.max(0, last + gap - monotonicNow()), () => {
      frame = nextFrame(view, () => {
        pending = null;
        looks += 1;
        last = monotonicNow();
        if (!done && look()) stop();
      }, signal);
    }, signal);
    pending = () => {
      timer();
      frame?.();
    };
  });
  function stop(): void {
    if (done) return;
    done = true;
    observer.disconnect();
    pending?.();
    pending = null;
    signal.removeEventListener('abort', stop);
  }
  signal.addEventListener('abort', stop, { once: true });
  observer.observe(doc.documentElement ?? doc, { childList: true, subtree: true });
  return stop;
}
