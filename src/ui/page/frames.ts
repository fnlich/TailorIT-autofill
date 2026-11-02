/*
 * The pages' one way to wait (the extension's only timers are dom/time.ts and background/timers.ts): animation frames,
 * which the browser runs only while the page is visible, which is all a page's clock needs (the options page's pairing
 * countdown, the side panel's Skip after 2 s on one field). Tests pass their own frames and clock.
 */

/** Calls `callback` before the next repaint, and returns a function that cancels it. */
export type FrameScheduler = (callback: () => void) => () => void;

/** The browser's animation frames. */
export const animationFrames: FrameScheduler = (callback) => {
  const id = requestAnimationFrame(() => callback());
  return () => cancelAnimationFrame(id);
};

/** Calls `onDue` once `ms` have passed on `now`, checked on each frame; answers how to stop. */
export function afterFrames(ms: number, onDue: () => void, now: () => number, frames: FrameScheduler): () => void {
  const from = now();
  let cancel: (() => void) | null = null;
  const tick = () => {
    if (now() - from >= ms) {
      cancel = null;
      onDue();
      return;
    }
    cancel = frames(tick);
  };
  cancel = frames(tick);
  return () => cancel?.();
}
