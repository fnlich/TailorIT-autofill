/*
 * The browser as each part of the extension may use it. platform/chrome.ts is the only file over `browser.*`; tests
 * use fake.ts (Node, over WXT's fake browser plus hand fakes) and memory.ts (in-memory doubles). A content script gets
 * ContentPlatform, which has no storage, tabs, network or secrets at all.
 */

/** What Chrome says about who sent a message. The worker decides trust from this, never from a payload. */
export interface Sender {
  id?: string;
  url?: string;
  origin?: string;
  tabId?: number;
  /** The sender tab's address now (`sender.tab.url`), when the host permissions let Chrome say. Unlike `url` (the
   *  document's address when its script started), it follows a single-page application's history.pushState. */
  tabUrl?: string;
  frameId?: number;
  documentId?: string;
  documentLifecycle?: string;
  /** The sender's tab is a private (incognito) one (`sender.tab.incognito`). */
  incognito?: boolean;
}

/** An async message handler; the wrapper answers with sendResponse and keeps the channel open. */
export type Handler = (message: unknown, sender: Sender) => Promise<unknown>;

/** The long-lived connections the extension opens: the resume transfer (content) and the review panel (pages). */
export const PORT_NAMES = ['resume', 'panel'] as const;
/** One of PORT_NAMES. */
export type PortName = (typeof PORT_NAMES)[number];

/** One end of a long-lived connection. */
export interface PortLike {
  readonly name: string;
  readonly sender?: Sender;
  post(message: unknown): void;
  onMessage(cb: (message: unknown) => void): () => void;
  onDisconnect(cb: () => void): () => void;
  disconnect(): void;
}

/** One storage area (local or session), read by key or by key prefix. */
export interface StorageArea {
  get(key: string): Promise<unknown>;
  getMany(prefix: string): Promise<Record<string, unknown>>;
  set(entries: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
  /** Restricts the area to trusted contexts (the worker and extension pages). */
  restrictToTrustedContexts(): Promise<void>;
}

/**
 * The extension origin's IndexedDB (database `tailorit`, store `secrets`, key `auth`): where the bearer token lives.
 * A content script runs under the page's origin, so it can never open this database. Its reader (background/auth.ts)
 * checks what comes out.
 */
export interface SecretStore {
  get(): Promise<unknown>;
  set(value: unknown): Promise<void>;
  clear(): Promise<void>;
}

/** The browser and operating system a token is for, which name the connection in TailorIT ("Chrome on Windows"). */
export interface ClientInfo {
  browser: 'chrome' | 'edge' | 'other';
  os: 'windows' | 'mac' | 'linux' | 'chromeos' | 'other';
}

/** One HTTP request, as the worker's server client makes it. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Why a message to a frame got no answer. 'gone': nothing receives in that frame and document (the document was
 * replaced or closed, or no listener runs in it). 'unanswered': it arrived, and its listener gave no answer.
 */
export type FrameSendFailure = 'gone' | 'unanswered';

/** What the service worker may use. */
export interface WorkerPlatform {
  runtime: {
    id: string;
    version: string;
    getURL(path: string): string;
    /** Registers the worker's one message listener. Call synchronously in main(), before any await. */
    onMessage(handler: Handler): void;
    onMessageExternal(handler: Handler): void;
    onConnect(cb: (port: PortLike) => void): void;
    onInstalled(cb: () => void): void;
    /** The browser and operating system, for the redeem request. Never rejects: what it cannot tell is 'other'. */
    clientInfo(): Promise<ClientInfo>;
  };
  tabs: {
    /** Sends to one frame of a tab (to one document of it, with `documentId`) and resolves with its answer; rejects
     *  with a FrameSendFailure. */
    sendToFrame(tabId: number, message: unknown, target: { frameId: number; documentId?: string }): Promise<unknown>;
    /** Opens a tab in front; resolves with its id. */
    create(url: string): Promise<number | null>;
    onRemoved(cb: (tabId: number) => void): void;
    /** Whether a tab shows a page on one of the applicant-tracking hosts (v3 Phase 3 review: the side panel says
     *  "Reload the page" when it does and no frame of ours said hello). Chrome gives a tab's address only on the hosts
     *  the extension may read, so false for any other; never the address itself. */
    onAtsHost?(tabId: number): Promise<boolean>;
    /** v3 Phase 3b ("Ask TailorIT to support this site"): the host name of the tab's page, in lower case, when Chrome
     *  gives the tab's address (an applicant-tracking host, or a tab the person invoked the extension on with the
     *  toolbar icon: activeTab, kept across same-origin moves, taken back on another origin or when the tab closes)
     *  and it is http or https; null otherwise. The host alone. */
    hostOf?(tabId: number): Promise<string | null>;
  };
  storage: { local: StorageArea; session: StorageArea };
  /** open() must be called before any await in the handler of the message that carries the click, or the browser no
   *  longer counts the click as the person's gesture. */
  sidePanel: { open(tabId: number): Promise<void>; openOnActionClick(on: boolean): Promise<void> };
  /** v3 Phase 5: the auto-apply agent's windows (chrome.windows, no permission needed). */
  windows: AgentWindows;
  /** v3 Phase 5: the auto-apply agent's wake-ups (chrome.alarms, the `alarms` permission: no install warning). */
  alarms: AgentAlarms;
  /** The token's home (extension-origin IndexedDB). */
  secrets: SecretStore;
  fetch: FetchLike;
  /** A signal that aborts after `ms` (AbortSignal.timeout). */
  timeout(ms: number): AbortSignal;
  /** The lower-case hex SHA-256 of `bytes` (crypto.subtle). */
  sha256(bytes: Uint8Array): Promise<string>;
  now(): number;
  randomBytes(count: number): Uint8Array;
}

/**
 * The windows the auto-apply agent opens (v3 Phase 5): one unfocused, normal window per job, closed when the job is
 * over. No address is ever read back from a tab: the agent knows its tab by id alone.
 */
export interface AgentWindows {
  /** Opens a new normal window that does not take the focus, on an empty page; answers the window and its one tab, or
   *  null when the browser would not open it. The job's address follows with navigate(), once the tab exists. */
  open(): Promise<{ windowId: number; tabId: number } | null>;
  /** Sends the agent's tab to `url`; false when the tab is gone. */
  navigate(tabId: number, url: string): Promise<boolean>;
  /** Closes the agent's own tab (and with it its window, when nothing else is in it); a tab already gone is no
   *  error. Never a window: the person may have moved tabs of their own into it. */
  closeTab(tabId: number): Promise<void>;
  /** Whether a tab is still there. */
  tabExists(tabId: number): Promise<boolean>;
  /** Whether a normal browser window other than `except` is open: the agent works only while the person's browser is. */
  othersOpen(except: number | null): Promise<boolean>;
}

/** The auto-apply agent's alarm (v3 Phase 5): a periodic wake-up that outlives a stopped worker. */
export interface AgentAlarms {
  /** Starts (or restarts) the alarm `name`, every `periodMinutes` (Chrome's floor is 0.5). */
  start(name: string, periodMinutes: number): Promise<void>;
  stop(name: string): Promise<void>;
  /** Calls `cb` with an alarm's name each time one fires. Registered synchronously at start-up. */
  onAlarm(cb: (name: string) => void): void;
}

/** Why a message to the worker could not be delivered. */
export type SendFailure = 'context-invalidated' | 'no-receiver';

/** What a content script may use: messages and the resume port, nothing else. */
export interface ContentPlatform {
  runtime: {
    id: string | undefined;
    /** Sends to the worker. Rejects with a SendFailure when the extension was reloaded or the worker cannot answer. */
    send(message: unknown): Promise<unknown>;
    connect(name: 'resume'): PortLike;
    /** Messages from the worker to this frame. */
    onMessage(handler: Handler): void;
    /** False once the extension has been reloaded or removed under this page. */
    isValid(): boolean;
  };
  now(): number;
}

/** What an extension page (the side panel, the report page, the options page) may use. */
export interface PagePlatform {
  runtime: {
    id: string | undefined;
    /** Sends to the worker. Rejects with a SendFailure when it cannot answer. */
    send(message: unknown): Promise<unknown>;
    /** The review panel's live connection: post `panel/watch {tabId}`, receive `panel/update` on every change; and
     *  (v3 Phase 3b) the resume preview's transfer, `preview`. */
    connect(name: 'panel' | 'preview'): PortLike;
    getURL(path: string): string;
    isValid(): boolean;
  };
  /** The active tab of the page's own window, or null. */
  activeTabId(): Promise<number | null>;
  /** Calls `cb` with the tab's id whenever a tab becomes active; the returned function stops listening. */
  onActiveTabChanged(cb: (tabId: number) => void): () => void;
  /** Calls `cb` with a tab's id whenever it finishes loading a page (tabs.onUpdated, status 'complete': no permission
   *  needed, and no address read); the returned function stops listening. The side panel reads its tab again then
   *  (v2), since a page without our script says no hello. */
  onTabLoaded(cb: (tabId: number) => void): () => void;
}

/** The tab a keyboard command was pressed in: where the capture page opens beside it. */
export interface CaptureTarget {
  tabId: number;
  windowId: number;
  /** Its position in its window's tab strip. */
  index: number;
}

/**
 * What the development build's snapshot hotkeys use in the worker (background/capture.ts). Production builds declare
 * no `commands`, and index.ts creates this only behind a compile-time switch, so their bundles hold none of it.
 */
export interface CaptureWorkerPlatform {
  /** Calls `cb` with each keyboard command and the tab active when it was pressed (null when the browser gave none). */
  onCommand(cb: (command: string, target: CaptureTarget | null) => void): void;
  /** Opens `url` in a new tab right after `target`, without moving the focus away from it. */
  openBeside(url: string, target: CaptureTarget): Promise<void>;
  getURL(path: string): string;
}

/** What the development build's capture page uses (src/entrypoints/capture): pageCapture, a development-only permission. */
export interface CapturePagePlatform {
  /** The tab's live page, every frame included, as MHTML (pageCapture.saveAsMHTML). Rejects when it cannot be saved. */
  saveAsMHTML(tabId: number): Promise<Blob>;
}
