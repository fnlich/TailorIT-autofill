/*
 * The worker's only timers (lint bans setTimeout everywhere else in the worker). The profile's idle drop and the resume
 * bytes' 60-second release use them; fetch timeouts use AbortSignal.timeout instead. A worker that the browser stops
 * loses its timers with its memory, which is what both uses want: the data they guard is gone with it.
 */

/** Schedules work after a delay. Each call returns a function that cancels it (safe to call twice). */
export interface Timers {
  after(ms: number, fn: () => void): () => void;
}

/** The real timers. */
export const systemTimers: Timers = {
  after(ms, fn) {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
};

/** Timers a test drives by hand: nothing runs until `advance` passes its time. */
export function manualTimers(): Timers & { advance(ms: number): void; readonly pending: number } {
  let now = 0;
  let next = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  return {
    after(ms, fn) {
      const id = next++;
      due.set(id, { at: now + ms, fn });
      return () => void due.delete(id);
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const ready = [...due.entries()].filter(([, entry]) => entry.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!ready) break;
        due.delete(ready[0]);
        now = ready[1].at;
        ready[1].fn();
      }
      now = until;
    },
    get pending() {
      return due.size;
    },
  };
}
