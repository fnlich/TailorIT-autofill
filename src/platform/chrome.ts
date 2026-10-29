/*
 * The one file over the browser's extension APIs (`browser` from wxt/browser). Browser differences, Chrome's
 * callback-style messaging and its error strings all stay here; the rest of the extension sees platform/types.ts.
 */
import { browser } from 'wxt/browser';
import type { ContentPlatform, Handler, PagePlatform, PortLike, Sender, SendFailure, StorageArea, WorkerPlatform } from './types';

type RawSender = {
  id?: string;
  url?: string;
  origin?: string;
  tab?: { id?: number };
  frameId?: number;
  documentId?: string;
  documentLifecycle?: string;
};

function toSender(raw: RawSender | undefined): Sender {
  return {
    id: raw?.id,
    url: raw?.url,
    origin: raw?.origin,
    tabId: raw?.tab?.id,
    frameId: raw?.frameId,
    documentId: raw?.documentId,
    documentLifecycle: raw?.documentLifecycle,
  };
}

/**
 * One listener that runs the async handler and answers through sendResponse, returning true synchronously so the
 * channel stays open. A handler that throws answers {ok: false, error: 'internal'}.
 */
function listen(event: { addListener(cb: (m: unknown, s: RawSender, r: (a: unknown) => void) => boolean): void }, handler: Handler) {
  event.addListener((message, sender, sendResponse) => {
    handler(message, toSender(sender)).then(sendResponse, () => sendResponse({ ok: false, error: 'internal' }));
    return true;
  });
}

function wrapPort(port: ReturnType<typeof browser.runtime.connect>): PortLike {
  return {
    name: port.name,
    sender: port.sender ? toSender(port.sender as RawSender) : undefined,
    post: (message) => port.postMessage(message),
    onMessage(cb) {
      const listener = (message: unknown) => cb(message);
      port.onMessage.addListener(listener);
      return () => port.onMessage.removeListener(listener);
    },
    onDisconnect(cb) {
      const listener = () => cb();
      port.onDisconnect.addListener(listener);
      return () => port.onDisconnect.removeListener(listener);
    },
    disconnect: () => port.disconnect(),
  };
}

type RawArea = typeof browser.storage.local;

function area(raw: RawArea): StorageArea {
  return {
    async get(key) {
      const found = await raw.get(key);
      return found[key];
    },
    async getMany(prefix) {
      const all = await raw.get(null);
      return Object.fromEntries(Object.entries(all).filter(([key]) => key.startsWith(prefix)));
    },
    set: (entries) => raw.set(entries),
    remove: (keys) => raw.remove(keys),
    async restrictToTrustedContexts() {
      await (raw as RawArea & { setAccessLevel(o: { accessLevel: string }): Promise<void> }).setAccessLevel({
        accessLevel: 'TRUSTED_CONTEXTS',
      });
    },
  };
}

export function createWorkerPlatform(): WorkerPlatform {
  return {
    runtime: {
      id: browser.runtime.id,
      get version() {
        return browser.runtime.getManifest().version;
      },
      getURL: (path) => browser.runtime.getURL(path as never),
      onMessage: (handler) => listen(browser.runtime.onMessage as never, handler),
      onMessageExternal: (handler) => listen(browser.runtime.onMessageExternal as never, handler),
      onConnect: (cb) => browser.runtime.onConnect.addListener((port) => cb(wrapPort(port))),
      onInstalled: (cb) => browser.runtime.onInstalled.addListener(() => cb()),
    },
    tabs: {
      sendToFrame: (tabId, message, target) => browser.tabs.sendMessage(tabId, message, target),
      async create(url) {
        const tab = await browser.tabs.create({ url, active: true });
        return tab.id ?? null;
      },
      onRemoved: (cb) => browser.tabs.onRemoved.addListener((tabId) => cb(tabId)),
    },
    storage: { local: area(browser.storage.local), session: area(browser.storage.session) },
    sidePanel: {
      open: (tabId) => browser.sidePanel.open({ tabId }),
      openOnActionClick: (on) => browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: on }),
    },
    now: () => Date.now(),
    randomBytes: (count) => crypto.getRandomValues(new Uint8Array(count)),
  };
}

function sendFailure(error: unknown): SendFailure {
  const message = error instanceof Error ? error.message : String(error);
  return /context invalidated/i.test(message) ? 'context-invalidated' : 'no-receiver';
}

function contentRuntime(): ContentPlatform['runtime'] {
  return {
    get id() {
      return browser.runtime?.id;
    },
    async send(message) {
      try {
        return await browser.runtime.sendMessage(message);
      } catch (error) {
        throw sendFailure(error);
      }
    },
    connect: (name) => wrapPort(browser.runtime.connect({ name })),
    onMessage: (handler) => listen(browser.runtime.onMessage as never, handler),
    isValid: () => browser.runtime?.id != null,
  };
}

export function createContentPlatform(): ContentPlatform {
  return { runtime: contentRuntime(), now: () => Date.now() };
}

export function createPagePlatform(): PagePlatform {
  return {
    runtime: { ...contentRuntime(), getURL: (path) => browser.runtime.getURL(path as never) },
    async activeTabId() {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      return tab?.id ?? null;
    },
  };
}

/**
 * The e2e build only: tries storage.local once from a content script and reports whether it was refused. Proves the
 * worker's access-level restriction. Compiled out of production (check-build scans for it).
 */
export async function probeStorageLocalFromContent(): Promise<'refused' | 'allowed'> {
  if (!__E2E__) return 'refused';
  try {
    await browser.storage.local.get('settings:v1');
    return 'allowed';
  } catch {
    return 'refused';
  }
}
