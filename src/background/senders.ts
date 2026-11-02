/*
 * Who may talk to the worker. Trust comes from what Chrome says about the sender, never from a payload: a content
 * message needs our own extension id, a tab, a frame, an ATS address and an active document; a page message must come
 * from one of our own extension pages; an external message must come from TailorIT's connect page, at TailorIT's exact
 * origin. Anything else is refused before its payload is parsed.
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
    incognito?: true }
  | { kind: 'page' };

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
