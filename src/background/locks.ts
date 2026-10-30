/*
 * Small guards for the worker's shared state: a per-key queue, so two messages never interleave one read-modify-write
 * of the same stored record, and a sliding-window rate limit for what a frame may ask too often.
 */

/** Runs tasks one after another per key; tasks under different keys run freely. */
export function createKeyedQueue() {
  const tails = new Map<string, Promise<unknown>>();
  return {
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve();
      const next = previous.then(task, task);
      const tail = next.catch(() => undefined);
      tails.set(key, tail);
      void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key);
      });
      return next;
    },
  };
}

/** At most `limit` hits per key within `windowMs`. */
export function createRateLimit(limit: number, windowMs: number, now: () => number) {
  const hits = new Map<string, number[]>();
  return {
    /** Counts a hit for `key`: null when it is allowed, else the whole seconds until one would be. */
    take(key: string): number | null {
      const at = now();
      const recent = (hits.get(key) ?? []).filter((time) => time > at - windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return Math.max(1, Math.ceil((recent[0]! + windowMs - at) / 1000));
      }
      recent.push(at);
      hits.set(key, recent);
      return null;
    },
    /** Forgets every key that starts with `prefix` (a closed tab's). */
    forget(prefix: string): void {
      for (const key of [...hits.keys()]) if (key.startsWith(prefix)) hits.delete(key);
    },
  };
}
