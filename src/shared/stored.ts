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

/** storage.local `disclosure` (the v3 Phase 4 review): the version of the first-run disclosure the person last
 *  acknowledged, by connecting (pairing shows it) or by choosing I understand when it changed. */
export const DISCLOSURE_KEY = 'disclosure';
/** The disclosure's version (shared/copy.ts COPY.options.connection.disclosure): 1, the wording up to v3 Phase 3 (an
 *  install connected before it was kept holds none, read as 1); 2, v3 Phases 3b and 4 (Submit pressed for the person,
 *  Applied recorded, a posting's address told as it loads, the profile editor, the resume's preview). Raise it whenever
 *  the disclosure's substance changes. */
export const DISCLOSURE_VERSION = 2;
export const DisclosureRecordSchema = z.strictObject({ version: z.number().int().positive() });

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
  /** Phase G: TailorIT's AI started writing this run's cover letter (a flag; the letter's id stays in memory). */
  letterWritten: z.literal(true).optional(),
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

/** storage.session `aitasks`: the AI tasks the worker submitted (Phase 4), by application and batch hash: ids and
 *  hashes only, never an item or an answer. A batch asked again after a worker restart or a reload is read by its id
 *  within TailorIT's hour (AUTOFILL_TASK_RETENTION_MS), and every runstate/put folds an application's entries into its
 *  RunState.aiTasks. At most MAX_AI_TASK_ENTRIES are kept, the oldest going first. */
export const AI_TASKS_KEY = 'aitasks';
/** The most entries the record holds: RunState.aiTasks' own cap (RUN_STATE_RECORD_CAPS.aiTasks). */
export const MAX_AI_TASK_ENTRIES = 720;
/** The record: one entry per application and batch. */
export const AiTaskRecordSchema = z.array(z.strictObject({
  applicationKey: ApplicationKeySchema,
  /** The batch's hash (ai-tasks.ts batchHash): `<kind>:<32 hex>`. */
  hash: z.string().regex(/^[a-z]+:[0-9a-f]{32}$/),
  taskId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
  /** When it was noted, by the worker's clock. */
  at: z.number().int().nonnegative(),
})).max(MAX_AI_TASK_ENTRIES);
/** A checked task record. */
export type AiTaskRecord = z.infer<typeof AiTaskRecordSchema>;
