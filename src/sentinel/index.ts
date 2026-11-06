/*
 * The sentinel (v3 Phase 8, docs/SPEC-AMENDMENTS.md §12 Decision 13): the only script of the extension that runs on
 * every https page (but the ATS hosts, LinkedIn's and the employee HR systems') once the person turned "Company career
 * sites" on in Options. The worker registers it, in the top frame only, with chrome.scripting.registerContentScripts
 * (background/sites.ts). Until it recognises the page (recognise.ts) it is dormant: it reads the page and its address,
 * and that is all. No hello, no UI, no DOM write, no listener on the page (only the extension's own message channel,
 * for the worker's stop), nothing sent.
 * - It reads the page once loaded, again after each address change of a single-page application (the address is read
 *   every SENTINEL_POLL_MS), and again whenever the page adds a form, a control or JSON-LD (a MutationObserver for the
 *   document's life, the Phase 8 review's B5; its records are looked at by tag and attribute alone, at most
 *   LOOK_NODES of them a batch: dom/page-signals.ts addsFormParts).
 * - Each reading waits for the browser's next frame (nextFrame), so a hidden tab is never read until shown, and for
 *   its gap: SENTINEL_SETTLE_MS after the reading before, doubling with each reading of the same address up to
 *   SENTINEL_MAX_GAP_MS (P2). A reading itself is bounded (dom/form-score.ts, dom/page-signals.ts).
 * - Recognised, it sends the worker `page/recognised {reason}` and nothing else. The worker checks the frame's address
 *   again itself, limits the asks per tab, and only then injects the content script into this frame alone. Once the
 *   worker took it (or after SENTINEL_MAX_ASKS asks in this document) the sentinel stops for good: the content script
 *   follows the page from then on.
 * - It stops too when the worker says the career sites were turned off (platform.onStop: site/stop, from the worker
 *   alone), when the extension is gone (reloaded or removed: platform.alive), and it never starts in a private tab
 *   (P7).
 * Its bundle holds no React, no zod and no DOM write (scripts/check-build.mjs holds it to SENTINEL_BUDGET).
 */
import { addsFormParts } from '../dom/page-signals';
import { every, monotonicNow, nextFrame, startDeadline, type Cancel } from '../dom/time';
import { recognisePage } from './recognise';

/** What the sentinel uses of the browser (src/platform/sentinel.ts). */
export interface SentinelPlatform {
  /** One message to the worker. */
  send(message: unknown): Promise<unknown>;
  /** Whether the extension still runs (false once it was reloaded or removed); true when absent. */
  alive?(): boolean;
  /** Calls `stop` when the worker says the career sites were turned off; answers how to stop listening. */
  onStop?(stop: () => void): () => void;
  /** A private (incognito) tab: the sentinel never starts there. */
  incognito?: boolean;
}

/** How often the address is read again (a single-page application's route). */
export const SENTINEL_POLL_MS = 1000;
/** The least time between two readings of one address; it doubles with each reading of it. */
export const SENTINEL_SETTLE_MS = 750;
/** The most time between two readings the page asked for by drawing a form, a control or JSON-LD. */
export const SENTINEL_MAX_GAP_MS = 12_000;
/** The most times one document asks the worker. */
export const SENTINEL_MAX_ASKS = 3;

/** Whether the worker's answer took the page (an ok envelope). */
const taken = (answer: unknown) => typeof answer === 'object' && answer !== null && (answer as { ok?: unknown }).ok === true;

/** Starts the sentinel in `doc`'s top frame; answers its stop (tests). A subframe gets nothing. Tests, whose fixtures
 *  are frames, say the frame is the top one and give its address. */
export function startSentinel(doc: Document, platform: SentinelPlatform,
  options: { isTop?: boolean; href?: () => string } = {}): () => void {
  const view = doc.defaultView;
  if (view === null || platform.incognito === true || !(options.isTop ?? view.top === view)) return () => undefined;
  const readHref = options.href ?? (() => doc.location.href);
  const life = new AbortController();
  let asks = 0;
  let asking = false;
  let lastHref = readHref();
  /** Readings of this address so far, and when the last one ran. */
  let readings = 0;
  let lastReading = 0;
  let pending: Cancel | null = null;
  let observer: MutationObserver | null = null;
  let unlisten: () => void = () => undefined;

  const alive = () => {
    try {
      return platform.alive?.() ?? true;
    } catch {
      return false;
    }
  };

  function finish(): void {
    if (life.signal.aborted) return;
    life.abort();
    observer?.disconnect();
    observer = null;
    pending?.();
    pending = null;
    unlisten();
  }

  function look(): void {
    if (life.signal.aborted || asking) return;
    if (!alive()) {
      finish();
      return;
    }
    readings += 1;
    lastReading = monotonicNow();
    let reason;
    try {
      reason = recognisePage(doc, readHref());
    } catch {
      reason = null;
    }
    if (reason === null) return;
    asking = true;
    asks += 1;
    let answer: Promise<unknown>;
    try {
      answer = platform.send({ v: 1, type: 'page/recognised', reason });
    } catch {
      // The extension is gone (its context invalidated): nothing more to ask.
      finish();
      return;
    }
    answer.then((answered) => {
      if (taken(answered) || asks >= SENTINEL_MAX_ASKS) finish();
    }, () => {
      if (asks >= SENTINEL_MAX_ASKS || !alive()) finish();
    }).finally(() => {
      asking = false;
    });
  }

  /** A reading at the browser's next frame, once the gap since the last reading of this address is over. */
  function soon(): void {
    if (pending !== null || life.signal.aborted) return;
    const gap = readings === 0 ? 0 : Math.min(SENTINEL_SETTLE_MS * 2 ** (readings - 1), SENTINEL_MAX_GAP_MS);
    let frame: Cancel | null = null;
    const timer = startDeadline(Math.max(0, lastReading + gap - monotonicNow()), () => {
      frame = nextFrame(view!, () => {
        pending = null;
        look();
      }, life.signal);
    }, life.signal);
    pending = () => {
      timer();
      frame?.();
    };
  }

  unlisten = platform.onStop?.(finish) ?? unlisten;
  const Observer = view.MutationObserver;
  if (typeof Observer === 'function' && doc.documentElement !== null) {
    observer = new Observer((records) => {
      if (pending === null && !life.signal.aborted && addsFormParts(records)) soon();
    });
    observer.observe(doc.documentElement, { childList: true, subtree: true });
  }
  every(SENTINEL_POLL_MS, () => {
    if (!alive()) {
      finish();
      return;
    }
    const href = readHref();
    if (href === lastHref) return;
    lastHref = href;
    readings = 0;
    pending?.();
    pending = null;
    soon();
  }, life.signal);
  soon();
  return finish;
}
