/*
 * The shape every message and answer shares. Each channel parses its messages with one strict zod union
 * (schemas.ts); an answer is {ok: true, data} or {ok: false, error} with a closed error list, and receivers parse
 * answers too, so drift fails loudly instead of silently.
 */
import { z } from 'zod';

export const MESSAGE_VERSION = 1;

/** Why a message was refused. `not_found` (the v4 review, M5): what was asked for is not held, though it may be asked
 *  for (signin/credential: no job-site sign-in saved in TailorIT for the page; `unavailable` there says Sign-in Auto is
 *  not allowed now, or TailorIT was not reached). */
export const ERROR_CODES = ['bad_message', 'bad_sender', 'not_connected', 'not_implemented', 'unavailable',
  'rate_limited', 'too_large', 'expired', 'internal', 'not_found'] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export type Answer<T> = { ok: true; data: T } | { ok: false; error: ErrorCode; retryAfterSeconds?: number };

export const ErrorAnswerSchema = z.strictObject({
  ok: z.literal(false),
  error: z.enum(ERROR_CODES),
  retryAfterSeconds: z.number().int().nonnegative().optional(),
});

/** The schema of an answer whose data has the given schema. */
export function answerSchema<T extends z.ZodType>(data: T) {
  return z.union([z.strictObject({ ok: z.literal(true), data }), ErrorAnswerSchema]);
}

export const ok = <T>(data: T): Answer<T> => ({ ok: true, data });
export const refuse = (error: ErrorCode): Answer<never> => ({ ok: false, error });
