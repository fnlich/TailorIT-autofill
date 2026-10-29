/*
 * Who may talk to the worker. Trust comes from what Chrome says about the sender, never from a payload: a content
 * message needs our own extension id, a tab, a frame, an ATS address and an active document; a page message must come
 * from one of our own extension pages. Anything else is refused before its payload is parsed.
 */
import { MatchPattern } from 'wxt/utils/match-patterns';
import { ATS_MATCHES } from '../shared/hosts';
import type { Sender } from '../platform/types';

const ATS_PATTERNS = ATS_MATCHES.map((pattern) => new MatchPattern(pattern));

export type Channel =
  | { kind: 'content'; tabId: number; frameId: number; documentId: string | undefined; url: string }
  | { kind: 'page' };

function isAtsAddress(url: string): boolean {
  if (ATS_PATTERNS.some((pattern) => pattern.includes(url))) return true;
  // The e2e fallback build serves fixtures from 127.0.0.1 when routed pages get no content script.
  return __E2E__ && /^http:\/\/127\.0\.0\.1:\d+\//.test(url);
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
  return { kind: 'content', tabId: sender.tabId, frameId: sender.frameId, documentId: sender.documentId, url: sender.url };
}
