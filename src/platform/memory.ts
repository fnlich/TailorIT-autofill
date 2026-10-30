/*
 * In-memory doubles of the platform for tests that run without a real extension: a ContentPlatform whose worker is a
 * scripted double (the content runtime takes its platform as a parameter), linked port pairs, and a SecretStore over a
 * variable for the worker's Node tests. Nothing here touches a browser API.
 */
import type { ContentPlatform, Handler, PortLike, SecretStore, Sender } from './types';

/** A copy, as the browser's structured clone would make one for plain data. */
const copyOf = (value: unknown): unknown => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/**
 * Two linked port ends. A message posted on one reaches the other's listeners asynchronously, as in the browser;
 * disconnecting one end fires the other's onDisconnect; posting on a closed pair throws.
 */
export function memoryPortPair(name: string, sender?: Sender): [PortLike, PortLike] {
  let open = true;
  const listeners: [Array<(message: unknown) => void>, Array<(message: unknown) => void>] = [[], []];
  const disconnects: [Array<() => void>, Array<() => void>] = [[], []];
  const end = (self: 0 | 1): PortLike => {
    const other = self === 0 ? 1 : 0;
    return {
      name,
      sender: self === 1 ? sender : undefined,
      post(message) {
        if (!open) throw new Error('Attempting to use a disconnected port object');
        const copy = copyOf(message);
        queueMicrotask(() => {
          if (open) for (const cb of [...listeners[other]]) cb(copy);
        });
      },
      onMessage(cb) {
        listeners[self].push(cb);
        return () => void listeners[self].splice(listeners[self].indexOf(cb), 1);
      },
      onDisconnect(cb) {
        disconnects[self].push(cb);
        return () => void disconnects[self].splice(disconnects[self].indexOf(cb), 1);
      },
      disconnect() {
        if (!open) return;
        open = false;
        queueMicrotask(() => {
          for (const cb of [...disconnects[other]]) cb();
        });
      },
    };
  };
  return [end(0), end(1)];
}

/**
 * A content platform whose worker is `worker`: every send is answered by it, in order. A port the content opens is
 * handed, as the worker's end, to `connectWorker` (sender: this frame), or disconnected at once without one.
 */
export function createMemoryContentPlatform(
  worker: (message: unknown) => Promise<unknown>,
  connectWorker?: (port: PortLike) => void,
): ContentPlatform & {
  sent: unknown[];
  deliver(message: unknown): Promise<unknown>;
} {
  const sent: unknown[] = [];
  let toFrame: Handler | null = null;
  return {
    sent,
    runtime: {
      id: 'memory-extension',
      async send(message) {
        sent.push(message);
        return worker(message);
      },
      connect(name) {
        const [content, workerEnd] = memoryPortPair(name, { id: 'memory-extension' });
        if (connectWorker) connectWorker(workerEnd);
        else workerEnd.disconnect();
        return content;
      },
      onMessage(handler) {
        toFrame = handler;
      },
      isValid: () => true,
    },
    now: () => 0,
    deliver: (message) => (toFrame ? toFrame(message, { id: 'memory-extension' }) : Promise.resolve(undefined)),
  };
}

/** A SecretStore over a variable, holding a copy of what was set. */
export function createMemorySecrets(): SecretStore & { readonly value: unknown } {
  let value: unknown;
  return {
    get value() {
      return value;
    },
    get: async () => copyOf(value),
    async set(next) {
      value = copyOf(next);
    },
    async clear() {
      value = undefined;
    },
  };
}
