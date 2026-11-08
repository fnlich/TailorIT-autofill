/*
 * Whether the extension's own controls can be seen where they are drawn (docs/ARCHITECTURE.md "UI" and "Isolation";
 * the Phase 2 review's S1 and S5). IntersectionObserver v2 (trackVisibility) gives each observed element isVisible:
 * Chromium's own judgement, across frame boundaries, that the element is in the viewport and nothing makes it unseen,
 * no opacity under 1, no filter, no transform other than a 2D move or upscale, nothing painted over it (a layer that
 * lets clicks through included). So a frame its parent page hides (opacity 0, off-screen, a zero-height wrapper) has a
 * launcher that is not visible, and so has a launcher a page draws a decoy over.
 * - Only the extension's own controls are observed (the launcher, the tab's controls, the policy card's two buttons,
 *   the Edit with AI buttons, the in-page panel), never the page's elements: a page element is legitimately covered
 *   by our UI and by sticky headers, so observing it would block real fills.
 * - The answer is the latest notification's. Chromium sends one at least VISIBILITY_DELAY_MS apart and only when
 *   something changes, so until the first one comes after observe() or reset(), nothing is known, which counts as not
 *   visible (fails closed). settled() waits for that first one, capped.
 * - A trusted event on one of our controls counts only once the control has been seen without a break for
 *   CONTROL_SEEN_MS (shownFor; the audit of 2026-11-06, S-1): a notification saying unseen, a reset() or an
 *   unobserve() starts the time again.
 * - A browser without IntersectionObserver v2 never says visible (the extension's floor, Chrome 144, has it).
 * The only timer is dom/time.ts's deadline, as the cap of a wait.
 */
import { deadline, monotonicNow } from '../../dom/time';

/** The observer's delay (Chromium's minimum for trackVisibility is 100 ms). */
export const VISIBILITY_DELAY_MS = 100;
/**
 * How long one of our controls must have been seen, without a break, before a trusted event on it counts (the audit of
 * 2026-11-06, S-1): the launcher, the tab's ×, grip and hide menu, the policy card, Edit with AI and its Generate, the
 * in-page panel and its dock. A page that covers a control (a top-layer popover over the tab) and uncovers it as the
 * pointer comes would otherwise harvest the click a person aimed at its own decoy; a cover starts the time again
 * (shownFor). A click on a control not yet seen this long is refused, never counted later: the person clicks again.
 */
export const CONTROL_SEEN_MS = 600;
/** settled() gives up after this long without a notification. */
export const VISIBILITY_SETTLE_CAP_MS = 1_500;

/** What is known of the observed elements' visibility. */
export interface VisibilityWatch {
  /** Starts watching `el`. */
  observe(el: Element): void;
  /** v5 p1-shell (the review's S3): every observed element's time starts again (its host was restyled). */
  resetAll(): void;
  /** Whether the latest notification for `el` said visible; false when none has come since observe() or reset(). */
  shown(el: Element): boolean;
  /** Whether a notification for `el` has come since observe() or reset(). */
  known(el: Element): boolean;
  /** The review (12): whether `el` has been seen, without a notification saying otherwise, for at least `ms` (since
   *  the notification that first said visible). */
  shownFor(el: Element, ms: number): boolean;
  /** Forgets what is known of `el` (it was just shown) and asks for a fresh notification. */
  reset(el: Element): void;
  /** Stops watching `el` (it was removed), and forgets what is known of it. */
  unobserve(el: Element): void;
  /** shown(el) once a notification has come, at once if one has; false after `capMs`, or when `signal` aborts. */
  settled(el: Element, signal?: AbortSignal, capMs?: number): Promise<boolean>;
  disconnect(): void;
}

type EntryV2 = IntersectionObserverEntry & { isVisible?: boolean };

/** Watches elements of `view`'s document with IntersectionObserver v2. */
export function createVisibilityWatch(view: (Window & typeof globalThis) | null): VisibilityWatch {
  const state = new WeakMap<Element, boolean>();
  /** When each observed element was last notified visible after not being so (monotonic ms). */
  const since = new WeakMap<Element, number>();
  const waiting = new Map<Element, Array<() => void>>();
  /** The elements observed now (resetAll). */
  const observed = new Set<Element>();
  let observer: IntersectionObserver | null = null;
  const supported = view !== null && typeof view.IntersectionObserver === 'function'
    && typeof view.IntersectionObserverEntry === 'function' && 'isVisible' in view.IntersectionObserverEntry.prototype;
  if (supported) {
    try {
      observer = new view.IntersectionObserver((entries) => {
        for (const entry of entries as EntryV2[]) {
          const visible = entry.isVisible === true;
          if (!visible) since.delete(entry.target);
          else if (state.get(entry.target) !== true) since.set(entry.target, monotonicNow());
          state.set(entry.target, visible);
          const wake = waiting.get(entry.target);
          waiting.delete(entry.target);
          for (const resolve of wake ?? []) resolve();
        }
      }, { trackVisibility: true, delay: VISIBILITY_DELAY_MS, threshold: [0] } as IntersectionObserverInit);
    } catch {
      observer = null;
    }
  }

  const watch: VisibilityWatch = {
    observe(el) {
      observed.add(el);
      observer?.observe(el);
    },
    resetAll() {
      for (const el of [...observed]) {
        if (el.isConnected) watch.reset(el);
        else watch.unobserve(el);
      }
    },
    shown: (el) => state.get(el) === true,
    known: (el) => state.has(el),
    shownFor(el, ms) {
      const from = since.get(el);
      return state.get(el) === true && from !== undefined && monotonicNow() - from >= ms;
    },
    reset(el) {
      state.delete(el);
      since.delete(el);
      observed.add(el);
      if (observer === null) return;
      // A target observed afresh gets a notification of its own, even when nothing about it changed.
      observer.unobserve(el);
      observer.observe(el);
    },
    async settled(el, signal, capMs = VISIBILITY_SETTLE_CAP_MS) {
      if (state.has(el)) return watch.shown(el);
      if (observer === null || signal?.aborted) return false;
      const stop = new AbortController();
      const abort = () => stop.abort();
      signal?.addEventListener('abort', abort, { once: true });
      let wake: (() => void) | null = null;
      const arrived = new Promise<void>((resolve) => {
        wake = resolve;
        waiting.set(el, [...(waiting.get(el) ?? []), resolve]);
      });
      try {
        await Promise.race([arrived, deadline(capMs, stop.signal)]);
      } finally {
        stop.abort();
        signal?.removeEventListener('abort', abort);
        const rest = (waiting.get(el) ?? []).filter((resolve) => resolve !== wake);
        if (rest.length > 0) waiting.set(el, rest);
        else waiting.delete(el);
      }
      return !signal?.aborted && watch.shown(el);
    },
    unobserve(el) {
      state.delete(el);
      since.delete(el);
      observed.delete(el);
      observer?.unobserve(el);
    },
    disconnect() {
      observed.clear();
      observer?.disconnect();
      observer = null;
      for (const wake of waiting.values()) for (const resolve of wake) resolve();
      waiting.clear();
    },
  };
  return watch;
}
