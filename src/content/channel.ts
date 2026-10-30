/*
 * The content script's messages to the worker (docs/ARCHITECTURE.md "Messages"). Every answer is parsed with the
 * catalogue's own schema for its type (CONTENT_ANSWER_SCHEMAS inside the envelope), so drift fails loudly: an answer
 * that does not parse counts as 'internal'. A worker that cannot be reached answers 'unavailable'.
 *
 * The run ends for invalidation only on the platform's word: isValid() is false, or a send fails because the extension
 * context was invalidated. Either one calls onInvalidated (the runtime tears down) and throws Invalidated, which unwinds
 * the run. Nothing a page does can raise it: a page can forge WXT's DOM events, never the platform's answer.
 *
 * fire() is for panel/open from the launcher's click: it hands the message to the platform at once, in the caller's
 * own task, so nothing is awaited before it and the click still counts as the person's gesture.
 */
import type { z } from 'zod';
import { answerSchema, type Answer } from '../messaging/envelope';
import { CONTENT_ANSWER_SCHEMAS, type ContentMessage } from '../messaging/schemas';
import type { ContentPlatform } from '../platform/types';

/** The content messages the worker answers with data (e2e/probe aside). */
export type AnsweredType = keyof typeof CONTENT_ANSWER_SCHEMAS;
/** The data of the worker's answer to a message of type T. */
export type AnswerData<T extends AnsweredType> = z.infer<(typeof CONTENT_ANSWER_SCHEMAS)[T]>;
/** A content message of type T. */
export type MessageOf<T extends AnsweredType> = Extract<ContentMessage, { type: T }>;

/** Thrown when the platform says the extension is gone: the run unwinds and the runtime tears down. */
export class Invalidated extends Error {
  constructor() {
    super('the extension context was invalidated');
    this.name = 'Invalidated';
  }
}

/** The content script's end of the messages. */
export interface Channel {
  /** Sends a message and answers the worker's parsed answer. Throws Invalidated when the extension is gone. */
  request<T extends AnsweredType>(message: MessageOf<T>): Promise<Answer<AnswerData<T>>>;
  /** Hands a message to the platform at once and does not wait for, or read, its answer. */
  fire(message: ContentMessage): void;
  /** Whether the platform still holds the extension; calls onInvalidated when it does not. */
  valid(): boolean;
}

/** The answer schemas, built once per type. */
const schemas = new Map<string, z.ZodType>();
function schemaOf(type: AnsweredType): z.ZodType {
  let schema = schemas.get(type);
  if (schema === undefined) {
    schema = answerSchema(CONTENT_ANSWER_SCHEMAS[type]);
    schemas.set(type, schema);
  }
  return schema;
}

/** The channel over a content platform. `onInvalidated` runs once, the first time the platform says it is gone. */
export function createChannel(platform: ContentPlatform, onInvalidated: () => void): Channel {
  let gone = false;
  const invalidate = () => {
    if (gone) return;
    gone = true;
    onInvalidated();
  };
  const valid = () => {
    if (!gone && !platform.runtime.isValid()) invalidate();
    return !gone;
  };

  return {
    async request<T extends AnsweredType>(message: MessageOf<T>): Promise<Answer<AnswerData<T>>> {
      if (!valid()) throw new Invalidated();
      let raw: unknown;
      try {
        raw = await platform.runtime.send(message);
      } catch (failure) {
        if (failure === 'context-invalidated' || !platform.runtime.isValid()) {
          invalidate();
          throw new Invalidated();
        }
        return { ok: false, error: 'unavailable' };
      }
      const parsed = schemaOf((message as { type: AnsweredType }).type).safeParse(raw);
      if (!parsed.success) return { ok: false, error: 'internal' };
      return parsed.data as Answer<AnswerData<T>>;
    },
    fire(message) {
      if (!valid()) return;
      platform.runtime.send(message).catch((failure: unknown) => {
        if (failure === 'context-invalidated' || !platform.runtime.isValid()) invalidate();
      });
    },
    valid,
  };
}
