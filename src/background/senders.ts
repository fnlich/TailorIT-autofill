/*
 * Who may talk to the worker. Trust comes from what Chrome says about the sender, never from a payload: a content
 * message needs our own extension id, a tab, a frame, an ATS address and an active document; a page message must come
 * from one of our own extension pages; an external message must come from TailorIT's connect page, at TailorIT's exact
 * origin. Anything else is refused before its payload is parsed.
 * v3 Phase 8 (docs/SPEC-AMENDMENTS.md §12 Decision 13) adds two, and nothing else: a frame off the ATS hosts the worker
 * itself injected the content script into (its tab, frame and document as the injection recorded them: a company's own
 * page), which may send what a frame on the ATS hosts sends, and nothing of the sentinel's (allowedOn); and the
 * sentinel's top frame on an https page, for page/recognised alone, whose address the worker checks again before it
 * injects anything.
 */
import { MatchPattern } from 'wxt/utils/match-patterns';
import { ATS_MATCHES } from '../shared/hosts';
import type { Sender } from '../platform/types';

const ATS_PATTERNS = ATS_MATCHES.map((pattern) => new MatchPattern(pattern));

/** A content channel's `url` is the frame's address as Chrome says it (`addressFrom`): the tab's address now for the
 *  top frame ('tab'), else the document's address when its script started ('document'), which a single-page
 *  application's pushState since then does not move. */
export type Channel =
  | { kind: 'content'; tabId: number; frameId: number; documentId: string | undefined; url: string;
    addressFrom?: 'tab' | 'document';
    /** The tab is a private (incognito) one: nothing is looked up as its pages load (v3 Phase 3 review). */
    incognito?: true;
    /** v3 Phase 8: a frame off the ATS hosts: one the worker injected the content script into ('site', a company's
     *  own page), or the sentinel's top frame before that ('sentinel'). Absent on the ATS hosts. */
    reach?: Reach }
  | { kind: 'page' };

/** v3 Phase 8: what a frame off the ATS hosts is to the worker. */
export type Reach = 'site' | 'sentinel';
/** v3 Phase 8: the frame kinds the worker injects the content script into. */
export type InjectedKind = Exclude<Reach, 'sentinel'>;
type ContentChannelOf = Extract<Channel, { kind: 'content' }>;

/** v3 Phase 8: the sentinel's one message: its frame may send nothing else, and no other frame may send it. */
const SENTINEL_MESSAGES: ReadonlySet<string> = new Set(['page/recognised']);

/** Whether a content channel may send a message of `type` (v3 Phase 8). */
export function allowedOn(channel: ContentChannelOf, type: string): boolean {
  return channel.reach === 'sentinel' ? SENTINEL_MESSAGES.has(type) : !SENTINEL_MESSAGES.has(type);
}

function isAtsAddress(url: string): boolean {
  if (ATS_PATTERNS.some((pattern) => pattern.includes(url))) return true;
  // The e2e fallback build serves fixtures from 127.0.0.1 when routed pages get no content script.
  return __E2E__ && /^http:\/\/127\.0\.0\.1:\d+\//.test(url);
}

/** The origin of an address, or null when it does not read. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The top frame's address now (v2, the Phase E review): Chrome's `sender.url` is the document's address when its
 * content script started, so after a single-page application's history.pushState it names the previous posting. The
 * tab's address (`sender.tab.url`, readable on the ATS hosts) follows it, so for the top frame it is taken when it is
 * on the document's own origin (pushState cannot leave it) and an ATS address; otherwise, and for any subframe (whose
 * address now Chrome does not give), `sender.url`.
 */
function addressOf(sender: Sender & { url: string }): { url: string; addressFrom: 'tab' | 'document' } {
  const tabUrl = sender.tabUrl;
  if (sender.frameId === 0 && tabUrl !== undefined && tabUrl !== sender.url && isAtsAddress(tabUrl)
    && originOf(tabUrl) !== null && originOf(tabUrl) === originOf(sender.url)) {
    return { url: tabUrl, addressFrom: 'tab' };
  }
  return { url: sender.url, addressFrom: sender.frameId === 0 && tabUrl === sender.url ? 'tab' : 'document' };
}

/** The channel a message arrived on, or null when the sender may not talk to the worker at all. */
export function channelOf(sender: Sender, ownId: string, ownPagesPrefix: string): Channel | null {
  if (sender.id !== ownId || !sender.url) return null;
  if (sender.tabId === undefined) {
    return sender.url.startsWith(ownPagesPrefix) ? { kind: 'page' } : null;
  }
  // An extension page opened as a normal tab (the report page under test) still counts as a page.
  if (sender.url.startsWith(ownPagesPrefix)) return { kind: 'page' };
  if (typeof sender.frameId !== 'number' || !isAtsAddress(sender.url)) return null;
  if (sender.documentLifecycle !== undefined && sender.documentLifecycle !== 'active') return null;
  const { url, addressFrom } = addressOf({ ...sender, url: sender.url });
  return { kind: 'content', tabId: sender.tabId, frameId: sender.frameId, documentId: sender.documentId, url, addressFrom,
    ...(sender.incognito === true ? { incognito: true as const } : {}) };
}

/** v3 Phase 8: what the worker knows of a frame off the ATS hosts: whether it injected the content script into that
 *  document, and as which kind (background/sites.ts). `now` answers from memory (undefined: not known there yet, as
 *  after a restart), so a launcher's click keeps its gesture; `read` asks storage. */
export interface InjectedOf {
  now(tabId: number, frameId: number, documentId: string | undefined): InjectedKind | null | undefined;
  read(tabId: number, frameId: number, documentId: string | undefined): Promise<InjectedKind | null>;
}

/** v3 Phase 8: a content sender off the ATS hosts, as a channel with no reach yet: an https frame of a tab, with our id
 *  and an active document. Its address is the tab's now for the top frame when on the document's own origin (a
 *  single-page application's pushState), else the document's. Null for anything else. */
export function offAtsSenderOf(sender: Sender, ownId: string, ownPagesPrefix: string): ContentChannelOf | null {
  if (sender.id !== ownId || !sender.url || sender.tabId === undefined || typeof sender.frameId !== 'number') return null;
  if (sender.url.startsWith(ownPagesPrefix) || !/^https:\/\//i.test(sender.url) || isAtsAddress(sender.url)) return null;
  if (sender.documentLifecycle !== undefined && sender.documentLifecycle !== 'active') return null;
  const tabUrl = sender.tabUrl;
  const sameOrigin = sender.frameId === 0 && tabUrl !== undefined && originOf(tabUrl) !== null
    && originOf(tabUrl) === originOf(sender.url);
  return { kind: 'content', tabId: sender.tabId, frameId: sender.frameId, documentId: sender.documentId,
    url: sameOrigin ? tabUrl! : sender.url, addressFrom: sameOrigin ? 'tab' : 'document',
    ...(sender.incognito === true ? { incognito: true as const } : {}) };
}

/** v3 Phase 8: such a sender's channel: the kind the worker injected, else the sentinel's top frame for page/recognised
 *  alone, else none. */
export function offAtsChannelOf(base: ContentChannelOf, injected: InjectedKind | null, type: string | null):
  ContentChannelOf | null {
  if (injected !== null) return { ...base, reach: injected };
  return type === 'page/recognised' && base.frameId === 0 ? { ...base, reach: 'sentinel' } : null;
}

/** TailorIT's page that hands over a connect code (Settings › Autofill), at exactly TailorIT's origin. */
export const CONNECT_PAGE_PATH = '/settings/autofill';

/** Whether an external message comes from TailorIT's connect page: its origin is TailorIT's exactly (scheme, host and
 *  port) and its address is that page. */
export function isConnectPage(sender: Sender, origin: string): boolean {
  if (sender.origin !== origin || !sender.url) return false;
  let url: URL;
  try {
    url = new URL(sender.url);
  } catch {
    return false;
  }
  return url.origin === origin && (url.pathname === CONNECT_PAGE_PATH || url.pathname === `${CONNECT_PAGE_PATH}/`);
}
