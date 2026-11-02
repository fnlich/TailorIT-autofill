/*
 * The pairing countdown on the options page ("This request ends in 9:41"), from auth/status's pairingExpiresAt. It
 * uses no timer (the extension's only timers are dom/time.ts and background/timers.ts): it repaints on animation
 * frames, which the browser runs only while the page is visible, which is all a countdown needs. The person is usually
 * in TailorIT's tab meanwhile, and the right time shows the moment they come back. Tests pass their own frames and
 * clock.
 */
import { useEffect, useEffectEvent, useState } from 'react';
import { animationFrames, type FrameScheduler } from '../page/frames';

export { animationFrames, type FrameScheduler };

/** Whole seconds from `now` until `until` (ms), never below zero. */
export function secondsLeft(until: number, now: number): number {
  return Math.max(0, Math.ceil((until - now) / 1000));
}

/** Seconds as a clock: "9:41", "0:05". */
export function clockText(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Seconds left until `until`, repainted on each frame while above zero; null without a deadline or before the first
 *  frame. */
export function useSecondsLeft(until: number | null, now: () => number, frames: FrameScheduler): number | null {
  const [left, setLeft] = useState<{ until: number; seconds: number } | null>(null);
  const read = useEffectEvent(() => now());
  useEffect(() => {
    if (until === null) return undefined;
    let cancel: (() => void) | null = null;
    const tick = () => {
      const seconds = secondsLeft(until, read());
      setLeft((previous) => (previous?.until === until && previous.seconds === seconds ? previous : { until, seconds }));
      cancel = seconds > 0 ? frames(tick) : null;
    };
    cancel = frames(tick);
    return () => cancel?.();
  }, [until, frames]);
  return until !== null && left?.until === until ? left.seconds : null;
}
