/*
 * How the extension's own views (the side panel, the options page, and since v5 the sidebar on the page) ask the worker
 * anything: one page message, and its answer checked against the catalogue's schema (messaging/schemas.ts,
 * PAGE_ANSWER_SCHEMAS), so a view never acts on an answer of the wrong shape. Views talk to the worker through
 * messaging only, over the transport they were given (PageTransport):
 * - an extension page's (platform/chrome.ts createPagePlatform): Chrome's runtime messaging from the extension's origin;
 * - v5 p1-shell, the sidebar's (platform/sidebar.ts createSidebarPlatform): the same messages over the tab's top-frame
 *   content channel, which the worker takes for the sidebar's own messages alone, naming no tab but its own
 *   (background/senders.ts sidebarMayAsk), while the panel shows on the page.
 * The views never know which: the same Panel draws both.
 */
import { answerSchema, type Answer } from '../../messaging/envelope';
import { type PageMessage } from '../../messaging/schemas';
import { PAGE_ANSWER_SCHEMAS } from '../../messaging/page-schemas';
import type { PagePlatform } from '../../platform/types';

/** What the worker answers a page message of type T, once checked. */
export type PageAnswer<T extends PageMessage['type']> = ReturnType<(typeof PAGE_ANSWER_SCHEMAS)[T]['parse']>;

/** The part of a view's platform its messages travel over: an extension page's runtime, or (v5 p1-shell) the sidebar's
 *  content channel. */
export type PageTransport = Pick<PagePlatform, 'runtime'>;

/**
 * Sends one page message and checks the answer. A send the browser could not deliver answers 'unavailable'; an answer
 * that fails the catalogue's schema answers 'internal'. It never throws.
 */
export async function request<M extends PageMessage>(platform: PageTransport, message: M):
  Promise<Answer<PageAnswer<M['type']>>> {
  let raw: unknown;
  try {
    raw = await platform.runtime.send(message);
  } catch {
    return { ok: false, error: 'unavailable' };
  }
  const parsed = answerSchema(PAGE_ANSWER_SCHEMAS[message.type]).safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'internal' };
  return parsed.data as Answer<PageAnswer<M['type']>>;
}
