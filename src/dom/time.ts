/*
 * The content side's only timers (docs/ARCHITECTURE.md "Isolation", "settle()"). Every wait in the content script ends
 * on a DOM condition or one of these caps, never on a fixed sleep: a timer here only ever bounds a wait or polls the
 * address, and it is cleared by whoever started it or by the run's own AbortSignal. WXT's context timers are never
 * used, because a page can reach that context. Lint allows setTimeout and setInterval in this file alone.
 */

/** Cancels a timer started here; calling it twice is harmless. */
export type Cancel = () => void;

/** Calls `onExpire` once after `ms`, unless cancelled first or `signal` aborts. A cap, never a sleep. */
export function startDeadline(ms: number, onExpire: () => void, signal?: AbortSignal): Cancel {
  if (signal?.aborted) return () => undefined;
  let id: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
    id = undefined;
    signal?.removeEventListener('abort', cancel);
    onExpire();
  }, Math.max(0, ms));
  function cancel(): void {
    if (id !== undefined) clearTimeout(id);
    id = undefined;
    signal?.removeEventListener('abort', cancel);
  }
  signal?.addEventListener('abort', cancel, { once: true });
  return cancel;
}

/** Resolves 'expired' after `ms`, or 'aborted' as soon as `signal` aborts. Raced against a DOM condition as its cap. */
export function deadline(ms: number, signal?: AbortSignal): Promise<'expired' | 'aborted'> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve('aborted');
      return;
    }
    const onAbort = () => {
      cancel();
      resolve('aborted');
    };
    const cancel = startDeadline(ms, () => {
      signal?.removeEventListener('abort', onAbort);
      resolve('expired');
    }, signal);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Calls `tick` every `ms` until cancelled or `signal` aborts: the address poll where the Navigation API is missing. */
export function every(ms: number, tick: () => void, signal?: AbortSignal): Cancel {
  if (signal?.aborted) return () => undefined;
  let id: ReturnType<typeof setInterval> | undefined = setInterval(tick, Math.max(1, ms));
  function cancel(): void {
    if (id !== undefined) clearInterval(id);
    id = undefined;
    signal?.removeEventListener('abort', cancel);
  }
  signal?.addEventListener('abort', cancel, { once: true });
  return cancel;
}

/** A monotonic clock in milliseconds, for measuring how long a slice or a settle took. */
export function monotonicNow(): number {
  return performance.now();
}

/** The Prioritized Task Scheduling API, which TypeScript's DOM library does not declare yet. */
interface TaskScheduler {
  yield(): Promise<void>;
}

/** Lets the page run between two slices of long work (the raw scan): scheduler.yield() where the browser has it,
 *  else one MessageChannel round trip, which yields without a timer. */
export function yieldToPage(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: Partial<TaskScheduler> }).scheduler;
  if (scheduler && typeof scheduler.yield === 'function') return scheduler.yield();
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}
