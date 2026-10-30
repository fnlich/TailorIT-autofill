/*
 * The shapes of what the worker keeps between messages, outside RunState and reports: the token record in IndexedDB,
 * and its value-free records in storage.session (the pending pairing, the runs, the posting pages' policy hits). The
 * worker checks each one with these schemas on the way out, because storage can hold anything an older build wrote.
 * None of them holds a profile value, a page URL or page text.
 */
import { z } from 'zod';
import { EXTENSION_SCOPES } from '../contract/tailorit/connect';
import { PLATFORMS } from '../core/enums';

/** The token's IndexedDB record: the token, its id, expiry and scopes. The account's name and email are never stored:
 *  the worker reads them from TailorIT's session into memory. */
export const TokenRecordSchema = z.strictObject({
  token: z.string().regex(/^tia_[A-Za-z0-9_-]{43}$/),
  tokenId: z.string().min(1).max(100),
  /** ms since the epoch. */
  expiresAt: z.number().int().nonnegative(),
  scopes: z.array(z.enum(EXTENSION_SCOPES)).max(EXTENSION_SCOPES.length),
});
/** A checked token record. */
export type TokenRecord = z.infer<typeof TokenRecordSchema>;

/** storage.session `pairing`: the single-use state a pairing waits for, 32 random bytes in base64url. */
export const PAIRING_KEY = 'pairing';
/** The pending pairing's record. */
export const PairingRecordSchema = z.strictObject({
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresAt: z.number().int().nonnegative(),
});
/** A checked pairing record. */
export type PairingRecord = z.infer<typeof PairingRecordSchema>;

/** `${platform}:${hex16}`: the application's key, a hash of its canonical address (never the address itself). */
export const ApplicationKeySchema = z.string().regex(new RegExp(`^(?:${PLATFORMS.join('|')}):[a-f0-9]{16}$`));

/** storage.session `runs:<runId>`: a run's identity and the frame it belongs to, so a run survives the worker being
 *  stopped between messages. The run's lookup and profile stay in the worker's memory only. */
export const RUN_PREFIX = 'runs:';
/** A run's record. */
export const RunRecordSchema = z.strictObject({
  runId: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  tabId: z.number().int().nonnegative(),
  frameId: z.number().int().nonnegative(),
  documentId: z.string().max(100).nullable(),
  applicationKey: ApplicationKeySchema,
  dryRun: z.boolean(),
  /** What became of this run's one fetch of the sensitive part. */
  sensitive: z.enum(['untried', 'loaded', 'not-shared', 'unavailable']),
  startedAt: z.number().int().nonnegative(),
});
/** A checked run record. */
export type RunRecord = z.infer<typeof RunRecordSchema>;

/** storage.session `policy:<applicationKey>`: the policy pattern ids a posting page matched, and whether one was read
 *  and found clear. Ids only, never the posting's text. */
export const POLICY_PREFIX = 'policy:';
/** An application's policy record. */
export const PolicyRecordSchema = z.strictObject({
  hits: z.array(z.string().regex(/^[a-z0-9.-]{1,40}$/)).max(10),
  clear: z.boolean(),
});
/** A checked policy record. */
export type PolicyRecord = z.infer<typeof PolicyRecordSchema>;
