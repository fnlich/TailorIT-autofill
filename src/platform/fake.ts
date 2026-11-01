/*
 * Hand fakes for what WXT's fake browser lacks or only stubs (its stubs throw): external messages, ports, storage
 * access levels, the side panel, the platform info, and messages to a tab's frame. Node tests (the ext project) call
 * installHandFakes() after fakeBrowser.reset(), then drive the real platform/chrome.ts, because WxtVitest aliases
 * wxt/browser to the fake.
 */
import { fakeBrowser } from 'wxt/testing/fake-browser';

type Listener = (...args: never[]) => unknown;

/** A minimal Chrome event: listeners in order, and a trigger that calls them all with the same arguments. */
function fakeEvent<L extends Listener>() {
  const listeners = new Set<L>();
  return {
    addListener: (cb: L) => void listeners.add(cb),
    removeListener: (cb: L) => void listeners.delete(cb),
    hasListener: (cb: L) => listeners.has(cb),
    hasListeners: () => listeners.size > 0,
    trigger: (...args: Parameters<L>) => [...listeners].map((cb) => cb(...args)),
  };
}

type MessageListener = (message: unknown, sender: unknown, sendResponse: (answer: unknown) => void) => unknown;

/** A raw sender as Chrome describes one (`chrome.runtime.MessageSender`). */
export interface RawSender {
  id?: string;
  url?: string;
  origin?: string;
  /** `url`: the tab's address now, which Chrome gives with the ATS host permissions (a single-page application's
   *  pushState moves it, while `url` above stays the document's first). */
  tab?: { id: number; url?: string };
  frameId?: number;
  documentId?: string;
  documentLifecycle?: string;
}

/** The test's end of a port the worker accepted. */
export interface FakePortPeer {
  /** Every message the worker posted, in order. */
  readonly received: unknown[];
  /** Posts a message to the worker, delivered asynchronously as Chrome does. */
  post(message: unknown): void;
  /** Calls `cb` with each message the worker posts from now on. */
  onMessage(cb: (message: unknown) => void): void;
  /** Disconnects from the test's side: the worker's onDisconnect fires. */
  disconnect(): void;
  /** True once the worker disconnected its end. */
  readonly disconnectedByWorker: boolean;
}

/** One message the worker sent to a tab's frame. */
export interface TabMessage {
  tabId: number;
  message: unknown;
  options: { frameId?: number; documentId?: string } | undefined;
}

/** The hand fakes a test drives and reads. */
export interface HandFakes {
  onMessageExternal: ReturnType<typeof fakeEvent<MessageListener>>;
  accessLevels: { local: string | null; session: string | null };
  /** Make storage.local.setAccessLevel reject, as Chrome before 140 does. */
  refuseAccessLevel: (refuse: boolean) => void;
  /** Leave storage.local.setAccessLevel unanswered until the returned release is called, as a slow start would. */
  holdAccessLevel: () => () => void;
  sidePanelCalls: Array<{ method: 'open' | 'setPanelBehavior'; args: unknown }>;
  /** Make sidePanel.open reject, as Chrome does without a user gesture. */
  refuseSidePanel: (refuse: boolean) => void;
  tabMessages: TabMessage[];
  /** What a frame answers the worker; undefined unless a test sets it. A thrown error is "no receiving end". */
  frameAnswers: (message: TabMessage) => unknown;
  /** Opens a port to the worker as `sender` would, and returns the test's end of it. */
  connect: (name: string, sender: RawSender) => FakePortPeer;
  /** commands.onCommand (WXT's fake leaves it unmocked): trigger(command, tab) calls listeners as Chrome does. */
  onCommand: ReturnType<typeof fakeEvent<(command: string, tab?: { id?: number; windowId: number; index: number }) => unknown>>;
  /** The tab ids pageCapture.saveAsMHTML was asked for (WXT's fake leaves it unmocked). */
  pageCaptures: number[];
  /** What pageCapture.saveAsMHTML answers for a tab; a thrown error is the browser refusing. */
  pageCapture: (tabId: number) => Blob;
}

/** A pair of linked port ends: the worker gets `raw` (Chrome's Port shape), the test gets the peer. */
function portPair(name: string, sender: RawSender): { raw: unknown; peer: FakePortPeer } {
  const toWorker = fakeEvent<(message: unknown) => unknown>();
  const workerDisconnect = fakeEvent<() => unknown>();
  const toPeer: Array<(message: unknown) => void> = [];
  const received: unknown[] = [];
  let open = true;
  let disconnectedByWorker = false;

  const raw = {
    name,
    sender,
    postMessage(message: unknown) {
      if (!open) throw new Error('Attempting to use a disconnected port object');
      const copy = JSON.parse(JSON.stringify(message)) as unknown;
      queueMicrotask(() => {
        received.push(copy);
        for (const cb of toPeer) cb(copy);
      });
    },
    onMessage: toWorker,
    onDisconnect: workerDisconnect,
    disconnect() {
      if (!open) return;
      open = false;
      disconnectedByWorker = true;
    },
  };
  const peer: FakePortPeer = {
    received,
    post(message) {
      if (!open) throw new Error('Attempting to use a disconnected port object');
      const copy = JSON.parse(JSON.stringify(message)) as unknown;
      queueMicrotask(() => {
        if (open) toWorker.trigger(copy);
      });
    },
    onMessage: (cb) => void toPeer.push(cb),
    disconnect() {
      if (!open) return;
      open = false;
      queueMicrotask(() => workerDisconnect.trigger());
    },
    get disconnectedByWorker() {
      return disconnectedByWorker;
    },
  };
  return { raw, peer };
}

/** Puts the hand fakes on WXT's fake browser (after fakeBrowser.reset()). */
export function installHandFakes(): HandFakes {
  let refusingAccess = false;
  let holdingAccess: Promise<void> | null = null;
  let refusingSidePanel = false;
  const onConnect = fakeEvent<(port: unknown) => unknown>();
  const fakes: HandFakes = {
    onMessageExternal: fakeEvent<MessageListener>(),
    accessLevels: { local: null, session: null },
    refuseAccessLevel: (refuse) => {
      refusingAccess = refuse;
    },
    holdAccessLevel: () => {
      let release: () => void = () => undefined;
      holdingAccess = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        holdingAccess = null;
        release();
      };
    },
    sidePanelCalls: [],
    refuseSidePanel: (refuse) => {
      refusingSidePanel = refuse;
    },
    tabMessages: [],
    frameAnswers: () => undefined,
    connect(name, sender) {
      const { raw, peer } = portPair(name, sender);
      onConnect.trigger(raw);
      return peer;
    },
    onCommand: fakeEvent<(command: string, tab?: { id?: number; windowId: number; index: number }) => unknown>(),
    pageCaptures: [],
    pageCapture: () => new Blob(['From: <Saved by Blink>\r\n'], { type: 'multipart/related' }),
  };
  const browser = fakeBrowser as unknown as Record<string, Record<string, unknown>>;
  const runtime = browser.runtime as Record<string, unknown>;
  runtime.onMessageExternal = fakes.onMessageExternal;
  runtime.onConnect = onConnect;
  runtime.getManifest = () => ({ manifest_version: 3, name: 'test', version: '0.0.0' });
  runtime.getPlatformInfo = async () => ({ os: 'win', arch: 'x86-64', nacl_arch: 'x86-64' });
  const storage = browser.storage as Record<string, Record<string, unknown>>;
  storage.local!.setAccessLevel = async (options: { accessLevel: string }) => {
    if (holdingAccess) await holdingAccess;
    if (refusingAccess) throw new Error('This StorageArea is not available for setting access level');
    fakes.accessLevels.local = options.accessLevel;
  };
  storage.session!.setAccessLevel = async (options: { accessLevel: string }) => {
    fakes.accessLevels.session = options.accessLevel;
  };
  browser.sidePanel = {
    open: (args: unknown) => {
      fakes.sidePanelCalls.push({ method: 'open', args });
      return refusingSidePanel
        ? Promise.reject(new Error('`sidePanel.open()` may only be called in response to a user gesture.'))
        : Promise.resolve();
    },
    setPanelBehavior: async (args: unknown) => void fakes.sidePanelCalls.push({ method: 'setPanelBehavior', args }),
  };
  (browser.tabs as Record<string, unknown>).sendMessage = async (tabId: number, message: unknown, options: TabMessage['options']) => {
    const sent: TabMessage = { tabId, message, options };
    fakes.tabMessages.push(sent);
    return fakes.frameAnswers(sent);
  };
  browser.commands = { onCommand: fakes.onCommand, getAll: async () => [] };
  browser.pageCapture = {
    saveAsMHTML: async (details: { tabId: number }) => {
      fakes.pageCaptures.push(details.tabId);
      return fakes.pageCapture(details.tabId);
    },
  };
  return fakes;
}
