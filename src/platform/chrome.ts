/*
 * The one file over the browser's extension APIs (`browser` from wxt/browser), and over the web APIs the worker reaches
 * the outside with (fetch, IndexedDB, crypto). Browser differences, Chrome's callback-style messaging and its error
 * strings all stay here; the rest of the extension sees platform/types.ts.
 */
import { browser } from 'wxt/browser';
import { platformOfUrl } from '../shared/hosts';
import type {
  AgentAlarms,
  AgentWindows,
  ClientInfo,
  ContentPlatform,
  FrameSendFailure,
  Handler,
  PagePlatform,
  PortLike,
  SecretStore,
  Sender,
  SendFailure,
  StorageArea,
  WorkerPlatform,
} from './types';
import type { CapturePagePlatform, CaptureTarget, CaptureWorkerPlatform } from './types';

type RawSender = {
  id?: string;
  url?: string;
  origin?: string;
  tab?: { id?: number; url?: string; incognito?: boolean };
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
    tabUrl: raw?.tab?.url,
    frameId: raw?.frameId,
    documentId: raw?.documentId,
    documentLifecycle: raw?.documentLifecycle,
    incognito: raw?.tab?.incognito,
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

type RawPort = ReturnType<typeof browser.runtime.connect>;

function wrapPort(port: RawPort): PortLike {
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

const SECRETS_DB = 'tailorit';
const SECRETS_STORE = 'secrets';
const SECRETS_KEY = 'auth';

function openSecrets(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SECRETS_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(SECRETS_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexeddb-open-failed'));
    request.onblocked = () => reject(new Error('indexeddb-blocked'));
  });
}

async function inSecrets<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openSecrets();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(SECRETS_STORE, mode);
      const request = run(transaction.objectStore(SECRETS_STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? new Error('indexeddb-failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('indexeddb-aborted'));
    });
  } finally {
    db.close();
  }
}

/** The token's home: the extension origin's IndexedDB, which no content script can open. */
function indexedDbSecrets(): SecretStore {
  return {
    get: () => inSecrets<unknown>('readonly', (store) => store.get(SECRETS_KEY)),
    async set(value) {
      await inSecrets('readwrite', (store) => store.put(value, SECRETS_KEY));
    },
    async clear() {
      await inSecrets('readwrite', (store) => store.delete(SECRETS_KEY));
    },
  };
}

const OS_NAMES: Readonly<Record<string, ClientInfo['os']>> = { win: 'windows', mac: 'mac', linux: 'linux', cros: 'chromeos' };

async function clientInfo(): Promise<ClientInfo> {
  const navigatorLike = globalThis.navigator as { userAgentData?: { brands?: Array<{ brand?: string }> } } | undefined;
  const names = (navigatorLike?.userAgentData?.brands ?? []).map((entry) => entry.brand ?? '');
  const browserName: ClientInfo['browser'] = names.includes('Microsoft Edge')
    ? 'edge'
    : names.includes('Google Chrome')
      ? 'chrome'
      : 'other';
  let os: ClientInfo['os'] = 'other';
  try {
    const info = await browser.runtime.getPlatformInfo();
    os = OS_NAMES[info.os] ?? 'other';
  } catch {
    // Not known: 'other' still names the connection.
  }
  return { browser: browserName, os };
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Chrome's sentences when nothing receives a message: no such tab, frame or document, or no listener in it
 *  ("Could not establish connection. Receiving end does not exist."). */
const NO_RECEIVER = /receiving end does not exist|no frame with id|no tab with id|no document with id|invalid document id/i;

/** A failed tabs.sendMessage, sorted: 'gone' when nothing received it, 'unanswered' when a listener did not answer
 *  ("The message port closed before a response was received."). */
function frameSendFailure(error: unknown): FrameSendFailure {
  const message = error instanceof Error ? error.message : String(error);
  return NO_RECEIVER.test(message) ? 'gone' : 'unanswered';
}

/** The auto-apply agent's windows (v3 Phase 5): chrome.windows, tabs.get and tabs.update, no permission needed. An
 *  unfocused window is asked for, on an empty page (the job's address follows with navigate); a browser that cannot
 *  make one unfocused (some headless builds) gets a normal one instead. */
function agentWindows(): AgentWindows {
  return {
    async open() {
      let made: { id?: number; tabs?: Array<{ id?: number }> } | undefined;
      try {
        made = await browser.windows.create({ url: 'about:blank', focused: false, type: 'normal' });
      } catch {
        try {
          made = await browser.windows.create({ url: 'about:blank', type: 'normal' });
        } catch {
          return null;
        }
      }
      const tabId = made?.tabs?.[0]?.id;
      return made?.id === undefined || tabId === undefined ? null : { windowId: made.id, tabId };
    },
    async navigate(tabId, url) {
      try {
        await browser.tabs.update(tabId, { url });
        return true;
      } catch {
        return false;
      }
    },
    async closeTab(tabId) {
      try {
        await browser.tabs.remove(tabId);
      } catch {
        // Gone already.
      }
    },
    async tabExists(tabId) {
      try {
        return (await browser.tabs.get(tabId)) !== undefined;
      } catch {
        return false;
      }
    },
    async othersOpen(except) {
      try {
        const open = await browser.windows.getAll({ windowTypes: ['normal'] });
        return open.some((window) => window.id !== except);
      } catch {
        return false;
      }
    },
  };
}

/** The auto-apply agent's alarm (v3 Phase 5). */
function agentAlarms(): AgentAlarms {
  return {
    async start(name, periodMinutes) {
      await browser.alarms.create(name, { periodInMinutes: periodMinutes, delayInMinutes: periodMinutes });
    },
    async stop(name) {
      await browser.alarms.clear(name);
    },
    onAlarm: (cb) => browser.alarms.onAlarm.addListener((alarm) => cb(alarm.name)),
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
      clientInfo,
    },
    tabs: {
      async sendToFrame(tabId, message, target) {
        try {
          return await browser.tabs.sendMessage(tabId, message, target.documentId === undefined
            ? { frameId: target.frameId }
            : { frameId: target.frameId, documentId: target.documentId });
        } catch (error) {
          throw frameSendFailure(error);
        }
      },
      async create(url) {
        const tab = await browser.tabs.create({ url, active: true });
        return tab.id ?? null;
      },
      onRemoved: (cb) => browser.tabs.onRemoved.addListener((tabId) => cb(tabId)),
      async onAtsHost(tabId) {
        try {
          const url = (await browser.tabs.get(tabId)).url;
          return url !== undefined && platformOfUrl(url) !== null;
        } catch {
          return false;
        }
      },
      async hostOf(tabId) {
        try {
          const url = (await browser.tabs.get(tabId)).url;
          if (url === undefined) return null;
          const parsed = new URL(url);
          return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.hostname.toLowerCase() : null;
        } catch {
          return null;
        }
      },
    },
    storage: { local: area(browser.storage.local), session: area(browser.storage.session) },
    sidePanel: {
      open: (tabId) => browser.sidePanel.open({ tabId }),
      openOnActionClick: (on) => browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: on }),
    },
    windows: agentWindows(),
    alarms: agentAlarms(),
    secrets: indexedDbSecrets(),
    // The global is read at call time, so a test can stub it.
    fetch: (url, init) => fetch(url, init),
    timeout: (ms) => AbortSignal.timeout(ms),
    async sha256(bytes) {
      return hex(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
    },
    now: () => Date.now(),
    randomBytes: (count) => crypto.getRandomValues(new Uint8Array(count)),
  };
}

function sendFailure(error: unknown): SendFailure {
  const message = error instanceof Error ? error.message : String(error);
  return /context invalidated/i.test(message) ? 'context-invalidated' : 'no-receiver';
}

async function sendToWorker(message: unknown): Promise<unknown> {
  try {
    return await browser.runtime.sendMessage(message);
  } catch (error) {
    throw sendFailure(error);
  }
}

function contentRuntime(): ContentPlatform['runtime'] {
  return {
    get id() {
      return browser.runtime?.id;
    },
    send: sendToWorker,
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
    runtime: {
      get id() {
        return browser.runtime?.id;
      },
      send: sendToWorker,
      connect: (name) => wrapPort(browser.runtime.connect({ name })),
      getURL: (path) => browser.runtime.getURL(path as never),
      isValid: () => browser.runtime?.id != null,
    },
    async activeTabId() {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      return tab?.id ?? null;
    },
    onActiveTabChanged(cb) {
      const listener = (info: { tabId: number }) => cb(info.tabId);
      browser.tabs.onActivated.addListener(listener);
      return () => browser.tabs.onActivated.removeListener(listener);
    },
    onTabLoaded(cb) {
      const listener = (tabId: number, change: { status?: string }) => {
        if (change.status === 'complete') cb(tabId);
      };
      browser.tabs.onUpdated.addListener(listener);
      return () => browser.tabs.onUpdated.removeListener(listener);
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

/**
 * Development builds only: the snapshot hotkeys' commands and background tab (background/capture.ts). index.ts calls it
 * behind a compile-time switch, so production bundles drop it with the hook.
 */
export function createCaptureWorkerPlatform(): CaptureWorkerPlatform {
  return {
    onCommand(cb) {
      browser.commands.onCommand.addListener((command, tab) => {
        const target: CaptureTarget | null = tab?.id === undefined ? null : { tabId: tab.id, windowId: tab.windowId, index: tab.index };
        cb(command, target);
      });
    },
    async openBeside(url, target) {
      // Not active: the captured page keeps its focus, so an open dropdown stays open.
      await browser.tabs.create({ url, active: false, windowId: target.windowId, index: target.index + 1, openerTabId: target.tabId });
    },
    getURL: (path) => browser.runtime.getURL(path as never),
  };
}

/** Development builds only: the capture page's pageCapture call. Only the capture page, which they alone build, uses it. */
export function createCapturePagePlatform(): CapturePagePlatform {
  return {
    async saveAsMHTML(tabId) {
      const saved = await browser.pageCapture.saveAsMHTML({ tabId });
      if (!saved) throw new Error('page-capture-empty');
      return saved;
    },
  };
}
