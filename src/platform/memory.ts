/*
 * In-memory doubles of the platform for tests that run without a real extension: a ContentPlatform whose worker is a
 * scripted double (the content runtime takes its platform as a parameter), linked port pairs, and a SecretStore over a
 * variable for the worker's Node tests. Nothing here touches a browser API.
 */
import type { ContentPlatform, Handler, PortLike, SecretStore, Sender } from './types';
import type { CapturePagePlatform, PagePlatform } from './types';

/** A copy, as the browser's structured clone would make one for plain data. */
const copyOf = (value: unknown): unknown => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/**
 * Two linked port ends. A message posted on one reaches the other's listeners asynchronously, as in the browser, and
 * in order: one posted just before disconnect() still arrives, before the other end's onDisconnect fires (the worker's
 * refusal path, resume/error then disconnect, relies on that). Posting on a closed pair throws.
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
        // Queued before any disconnect that follows, so it is delivered first, as Chrome delivers it.
        queueMicrotask(() => {
          for (const cb of [...listeners[other]]) cb(copy);
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

/** A page platform for the side panel's and the options page's tests, and what the test drives and reads of it. */
export interface MemoryPagePlatform extends PagePlatform {
  /** Every message the page sent, in order (copies). */
  readonly sent: unknown[];
  /** How many times the page opened the `panel` port. */
  readonly connects: number;
  /** Makes `tabId` this window's active tab and tells the page, as tabs.onActivated does. */
  activate(tabId: number | null): void;
  /** A tab became active in another window: the page is told, and this window's active tab stays as it was. */
  activateElsewhere(tabId: number): void;
  /** The extension was reloaded or removed under the page: sends reject and nothing connects. */
  invalidate(): void;
  /** A tab finished loading a page, as tabs.onUpdated says with status 'complete'. */
  loaded(tabId: number): void;
  /** v3 Phase 8: every requestHosts the page made, in order (the origins asked for). */
  readonly hostRequests: string[][];
  /** The Phase 8 review (P8): every removeHosts the page made, in order. */
  readonly hostRemovals: string[][];
}

/**
 * A page platform whose worker is `worker`: every send is answered by it, with a copy of the message, as the browser's
 * messaging would. Each `panel` port the page opens is handed, as the worker's end, to `connectWorker` (or closed at
 * once without one). The active tab is the test's to set.
 */
export function createMemoryPagePlatform(
  worker: (message: unknown) => Promise<unknown>,
  options: { connectWorker?: (port: PortLike) => void; activeTabId?: number | null;
    /** v3 Phase 8: what Chrome answers a host permission request (granted by default). */
    grantHosts?: (origins: readonly string[]) => boolean } = {},
): MemoryPagePlatform {
  const sent: unknown[] = [];
  const hostRequests: string[][] = [];
  const hostRemovals: string[][] = [];
  const listeners = new Set<(tabId: number) => void>();
  const loads = new Set<(tabId: number) => void>();
  let active = options.activeTabId ?? null;
  let valid = true;
  let connects = 0;
  return {
    sent,
    get connects() {
      return connects;
    },
    runtime: {
      get id() {
        return valid ? 'memory-extension' : undefined;
      },
      async send(message) {
        if (!valid) throw 'context-invalidated';
        sent.push(copyOf(message));
        return copyOf(await worker(copyOf(message)));
      },
      connect(name) {
        if (!valid) throw new Error('Extension context invalidated.');
        connects += 1;
        const sender = { id: 'memory-extension', url: 'chrome-extension://memory-extension/sidepanel.html' };
        const [page, workerEnd] = memoryPortPair(name, sender);
        if (options.connectWorker) options.connectWorker(workerEnd);
        else workerEnd.disconnect();
        return page;
      },
      getURL: (path) => `chrome-extension://memory-extension${path.startsWith('/') ? path : `/${path}`}`,
      isValid: () => valid,
    },
    activeTabId: async () => active,
    onActiveTabChanged(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    onTabLoaded(cb) {
      loads.add(cb);
      return () => void loads.delete(cb);
    },
    loaded(tabId) {
      for (const cb of [...loads]) cb(tabId);
    },
    activate(tabId) {
      active = tabId;
      if (tabId !== null) for (const cb of [...listeners]) cb(tabId);
    },
    activateElsewhere(tabId) {
      for (const cb of [...listeners]) cb(tabId);
    },
    invalidate() {
      valid = false;
    },
    hostRequests,
    async requestHosts(origins) {
      hostRequests.push([...origins]);
      return options.grantHosts?.(origins) ?? true;
    },
    hostRemovals,
    async removeHosts(origins) {
      hostRemovals.push([...origins]);
      return true;
    },
  };
}

/** A capture platform over `capture`: each call's tab id is recorded, and a throw is the browser refusing to save. */
export function createMemoryCapturePlatform(capture: (tabId: number) => Blob): CapturePagePlatform & { readonly asked: number[] } {
  const asked: number[] = [];
  return {
    asked,
    async saveAsMHTML(tabId) {
      asked.push(tabId);
      return capture(tabId);
    },
  };
}
