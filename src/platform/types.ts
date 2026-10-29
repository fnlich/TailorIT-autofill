/*
 * The browser as each part of the extension may use it. platform/chrome.ts is the only file over `browser.*`; tests
 * use fake.ts (Node, over WXT's fake browser plus hand fakes) and memory.ts (browser mode). A content script gets
 * ContentPlatform, which has no storage, tabs or secrets at all.
 */

/** What Chrome says about who sent a message. The worker decides trust from this, never from a payload. */
export interface Sender {
  id?: string;
  url?: string;
  origin?: string;
  tabId?: number;
  frameId?: number;
  documentId?: string;
  documentLifecycle?: string;
}

/** An async message handler; the wrapper answers with sendResponse and keeps the channel open. */
export type Handler = (message: unknown, sender: Sender) => Promise<unknown>;

export interface PortLike {
  readonly name: string;
  readonly sender?: Sender;
  post(message: unknown): void;
  onMessage(cb: (message: unknown) => void): () => void;
  onDisconnect(cb: () => void): () => void;
  disconnect(): void;
}

export interface StorageArea {
  get(key: string): Promise<unknown>;
  getMany(prefix: string): Promise<Record<string, unknown>>;
  set(entries: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
  /** Restricts the area to trusted contexts (the worker and extension pages). */
  restrictToTrustedContexts(): Promise<void>;
}

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
  };
  tabs: {
    sendToFrame(tabId: number, message: unknown, target: { frameId: number; documentId?: string }): Promise<unknown>;
    create(url: string): Promise<number | null>;
    onRemoved(cb: (tabId: number) => void): void;
  };
  storage: { local: StorageArea; session: StorageArea };
  sidePanel: { open(tabId: number): Promise<void>; openOnActionClick(on: boolean): Promise<void> };
  now(): number;
  randomBytes(count: number): Uint8Array;
}

/** Why a message to the worker could not be delivered. */
export type SendFailure = 'context-invalidated' | 'no-receiver';

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

export interface PagePlatform {
  runtime: ContentPlatform['runtime'] & { getURL(path: string): string };
  activeTabId(): Promise<number | null>;
}
