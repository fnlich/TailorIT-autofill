/*
 * The one file over the browser's extension APIs (`browser` from wxt/browser), and over the web APIs the worker reaches
 * the outside with (fetch, IndexedDB, crypto). Browser differences, Chrome's callback-style messaging and its error
 * strings all stay here; the rest of the extension sees platform/types.ts.
 */
import { browser } from 'wxt/browser';
import { postingAddressOf } from '../adapters/address';
import { isCompanySiteUrl, staticPlatformOfUrl, type SiteRegistration } from '../shared/hosts';
import type {
  AgentAlarms,
  AgentWindows,
  AtsPage,
  ClientInfo,
  ContentPlatform,
  FrameSendFailure,
  Handler,
  HostPermissions,
  PagePlatform,
  PortLike,
  QueueTabs,
  Sender,
  SendFailure,
  SitesScripting,
  StorageArea,
  WorkerPlatform,
} from './types';
import type { CapturePagePlatform, CaptureTarget, CaptureWorkerPlatform } from './types';
import { indexedDbSecret } from './indexed-db';

/** What a page shows by its address (tabs.atsPageOf): a posting or another page on an applicant-tracking host, and
 *  that host's platform; null off those hosts or for an address that does not parse. The P2 review (L3): the hosts the
 *  manifest's script runs on (shared/hosts.ts staticPlatformOfUrl): an employer's own domain at Oracle's Candidate
 *  Experience address is a company's own page here (reports.ts pageNow offers its reload only while the career sites
 *  act). */
function atsPageAt(url: string | undefined): AtsPage | null {
  if (url === undefined) return null;
  const platform = staticPlatformOfUrl(url);
  if (platform === null) return null;
  try {
    return { page: postingAddressOf(new URL(url)) === null ? 'other' : 'posting', platform };
  } catch {
    return null;
  }
}

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
      // jr7 AUTO-7: one window or several (the jobs' windows left open for the person).
      const excluded: readonly (number | null)[] = Array.isArray(except) ? except : [except as number | null];
      try {
        const open = await browser.windows.getAll({ windowTypes: ['normal'] });
        return open.some((window) => window.id === undefined || !excluded.includes(window.id));
      } catch {
        return false;
      }
    },
    // ── jr7 AUTO-7 (jr7-O1 part 4, D-9 Q-O2): the window flagged for the person, never focused ──
    async drawAttention(windowId) {
      try {
        await browser.windows.update(windowId, { drawAttention: true });
      } catch {
        // Gone already.
      }
    },
    // v2.0 fix wave (BEH-9): a kept window the person closed is dropped from the agent's list.
    async windowExists(windowId) {
      try {
        return (await browser.windows.get(windowId)) !== undefined;
      } catch {
        return false;
      }
    },
  };
}

// v1.5 QX
/** The sequential auto-apply's tabs (QueueTabs): chrome.tabs and chrome.windows, no permission needed. */
function queueTabs(): QueueTabs {
  return {
    async open() {
      try {
        const tab = await browser.tabs.create({ url: 'about:blank', active: false });
        return tab.id ?? null;
      } catch {
        return null;
      }
    },
    async navigate(tabId, url) {
      try {
        await browser.tabs.update(tabId, { url });
        return true;
      } catch {
        return false;
      }
    },
    async focus(tabId) {
      try {
        const tab = await browser.tabs.update(tabId, { active: true });
        if (tab?.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true });
        return true;
      } catch {
        return false;
      }
    },
    async state(tabId) {
      try {
        const tab = await browser.tabs.get(tabId);
        return tab === undefined ? 'gone' : tab.active ? 'active' : 'background';
      } catch {
        return 'gone';
      }
    },
    async close(tabId) {
      try {
        await browser.tabs.remove(tabId);
      } catch {
        // Gone already.
      }
    },
  };
}
// end v1.5 QX

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

/** A registration as Chrome answers it, in registrationsFor's shape (the fields the extension sets, nothing else). */
function registrationOf(raw: { id: string; js?: string[]; matches?: string[]; excludeMatches?: string[]; allFrames?: boolean;
  runAt?: string; persistAcrossSessions?: boolean; world?: string }): SiteRegistration {
  return { id: raw.id, js: [...(raw.js ?? [])], matches: [...(raw.matches ?? [])],
    ...(raw.excludeMatches === undefined || raw.excludeMatches.length === 0 ? {} : { excludeMatches: [...raw.excludeMatches] }),
    // What Chrome answers is compared with what the extension wants: anything else reads as a difference.
    allFrames: raw.allFrames as false, runAt: raw.runAt as 'document_idle',
    persistAcrossSessions: raw.persistAcrossSessions as true, world: (raw.world ?? 'ISOLATED') as 'ISOLATED' };
}

/** v3 Phase 8: the sentinel's registrations and the content script's one injection (chrome.scripting). */
function sitesScripting(): SitesScripting {
  type Scripting = {
    getRegisteredContentScripts(filter: { ids: string[] }): Promise<Array<Parameters<typeof registrationOf>[0]>>;
    registerContentScripts(scripts: unknown[]): Promise<void>;
    unregisterContentScripts(filter: { ids: string[] }): Promise<void>;
    executeScript(injection: { target: { tabId: number; frameIds?: number[]; documentIds?: string[] }; files?: string[];
      func?: () => unknown; injectImmediately?: boolean; world?: 'MAIN' }): Promise<Array<{ documentId?: string; frameId?: number;
      result?: unknown }>>;
  };
  const scripting = () => (browser as unknown as { scripting: Scripting }).scripting;
  return {
    async registered(ids) {
      return (await scripting().getRegisteredContentScripts({ ids: [...ids] })).map(registrationOf);
    },
    async register(scripts) {
      await scripting().registerContentScripts(scripts.map((script) => ({ ...script, js: [...script.js],
        matches: [...script.matches], ...(script.excludeMatches === undefined ? {} : { excludeMatches: [...script.excludeMatches] }) })));
    },
    async unregister(ids) {
      if (ids.length > 0) await scripting().unregisterContentScripts({ ids: [...ids] });
    },
    async inject(tabId, target, file, world) {
      await scripting().executeScript({ target: target.documentId === undefined ? { tabId, frameIds: [target.frameId] }
        : { tabId, documentIds: [target.documentId] }, files: [file], ...(world === undefined ? {} : { world }) });
    },
    // v5 p1-shell: a function in the top frame that reads its own address; Chrome's answer names its document.
    async topDocument(tabId) {
      try {
        const [result] = await scripting().executeScript({ target: { tabId, frameIds: [0] },
          func: () => location.href });
        return typeof result?.documentId === 'string' && typeof result.result === 'string'
          ? { documentId: result.documentId, url: result.result } : null;
      } catch {
        return null;
      }
    },
  };
}

/** v3 Phase 8: the optional host permissions, read, given back and heard of. */
function hostPermissions(): HostPermissions {
  return {
    contains: (origins) => browser.permissions.contains({ origins: [...origins] }),
    remove: (origins) => browser.permissions.remove({ origins: [...origins] }),
    onChanged(cb) {
      browser.permissions.onAdded.addListener(() => cb());
      browser.permissions.onRemoved.addListener(() => cb());
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
      onLoaded: (cb) => browser.tabs.onUpdated.addListener((tabId, change, tab) => {
        if (change.status === 'complete') cb(tabId, () => atsPageAt(change.url ?? tab.url));
      }),
      async onAtsHost(tabId) {
        try {
          const url = (await browser.tabs.get(tabId)).url;
          // The P2 review (L3): as atsPageAt reads it.
          return url !== undefined && staticPlatformOfUrl(url) !== null;
        } catch {
          return false;
        }
      },
      async atsPageOf(tabId) {
        try {
          return atsPageAt((await browser.tabs.get(tabId)).url);
        } catch {
          return null;
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
      async ids() {
        try {
          return (await browser.tabs.query({})).map((tab) => tab.id).filter((id): id is number => typeof id === 'number');
        } catch {
          return [];
        }
      },
      async companySite(tabId) {
        try {
          const url = (await browser.tabs.get(tabId)).url;
          return url !== undefined && isCompanySiteUrl(url);
        } catch {
          return false;
        }
      },
    },
    storage: { local: area(browser.storage.local), session: area(browser.storage.session) },
    sidePanel: {
      open: (tabId) => browser.sidePanel.open({ tabId }),
      openOnActionClick: (on) => browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: on }),
    },
    // v5 p1-shell: the toolbar icon, while the panel shows on the page.
    action: {
      onClicked: (cb) => browser.action.onClicked.addListener((tab) => {
        if (typeof tab.id === 'number') {
          cb({ id: tab.id, ...(tab.url === undefined ? {} : { url: tab.url }), ...(tab.incognito ? { incognito: true } : {}) });
        }
      }),
    },
    windows: agentWindows(),
    alarms: agentAlarms(),
    queueTabs: queueTabs(), // v1.5 QX
    scripting: sitesScripting(),
    permissions: hostPermissions(),
    secrets: indexedDbSecret('auth'),
    // jr6: the job-site password's key (signup-vault.ts), beside the token, never extractable.
    signupKey: indexedDbSecret('signup-key'),
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
    // Called inside the person's click: nothing is awaited before Chrome is asked.
    requestHosts: (origins) => browser.permissions.request({ origins: [...origins] }),
    removeHosts: (origins) => browser.permissions.remove({ origins: [...origins] }),
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
