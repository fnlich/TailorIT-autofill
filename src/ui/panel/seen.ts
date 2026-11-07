/*
 * The v4 review (security L4): the side panel's main button takes a click only once what it says has been shown for
 * CONTROL_SEEN_MS. What it says and does follows state the page controls: a page shows a password box and, within
 * WALL_LOOK_MS, "Autofill" reads "Sign up & Autofill" (PageState.wall), which grants the tab Sign-in Auto for a run. A
 * page that flips it as the pointer travels to the panel would otherwise harvest a click the person aimed at
 * "Autofill". So whenever its meaning changes (what it sends: a fill, a sign-up fill, a Continue; the tab it sends to;
 * or the button newly drawn), it is disabled until the new label has been shown CONTROL_SEEN_MS, then it acts on what it
 * shows. The page UI's rule for its own controls (content/ui/visible.ts) holds the same time.
 *
 * Time is checked on animation frames (page/frames.ts: the pages' one way to wait), which run only while the panel is
 * drawn; tests pass their own clock.
 */
import { useEffect, useState } from 'react';
import { afterFrames, animationFrames, type FrameScheduler } from '../page/frames';

/**
 * How long the main button's meaning must have been shown before a click counts: the page UI's CONTROL_SEEN_MS
 * (src/content/ui/visible.ts, 600 ms), the same value under the same name; the extension's pages may not import the
 * content script's modules (eslint: the UI talks to the worker through messaging only). Keep the two equal.
 */
export const CONTROL_SEEN_MS = 600;

/** The clock a control's showing is timed on: a monotonic time (ms) and the frames it is checked on. */
export interface SeenClock {
  now(): number;
  frames: FrameScheduler;
}

/** The browser's: its monotonic clock and its animation frames. */
export const BROWSER_SEEN_CLOCK: SeenClock = { now: () => performance.now(), frames: animationFrames };

/**
 * Whether what `meaning` names has been shown, unchanged, for CONTROL_SEEN_MS. A change starts the time again, a change
 * back to an earlier meaning included; so does the hook's mount (a control newly drawn).
 */
export function useShownFor(meaning: string, clock: SeenClock): boolean {
  const [shown, setShown] = useState<{ meaning: string; seen: boolean }>({ meaning, seen: false });
  // React's pattern for state that follows what is drawn: adjusted while rendering, so the render that draws a new
  // meaning already refuses it.
  if (shown.meaning !== meaning) setShown({ meaning, seen: false });
  useEffect(() => afterFrames(CONTROL_SEEN_MS, () => setShown((now) => (now.meaning === meaning ? { meaning, seen: true }
    : now)), clock.now, clock.frames), [meaning, clock]);
  return shown.meaning === meaning && shown.seen;
}
