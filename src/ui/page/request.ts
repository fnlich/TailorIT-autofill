/*
 * How the extension's own pages (the side panel, the options page) ask the worker anything: one page message, and its
 * answer checked against the catalogue's schema (messaging/schemas.ts, PAGE_ANSWER_SCHEMAS), so a page never acts on
 * an answer of the wrong shape. Pages talk to the worker through messaging only; the platform is passed in.
 */
import { answerSchema, type Answer } from '../../messaging/envelope';
import { type PageMessage } from '../../messaging/schemas';
import { PAGE_ANSWER_SCHEMAS } from '../../messaging/page-schemas';
import type { PagePlatform } from '../../platform/types';

/** What the worker answers a page message of type T, once checked. */
export type PageAnswer<T extends PageMessage['type']> = ReturnType<(typeof PAGE_ANSWER_SCHEMAS)[T]['parse']>;

/**
 * Sends one page message and checks the answer. A send the browser could not deliver answers 'unavailable'; an answer
 * that fails the catalogue's schema answers 'internal'. It never throws.
 */
export async function request<M extends PageMessage>(platform: PagePlatform, message: M): Promise<Answer<PageAnswer<M['type']>>> {
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
