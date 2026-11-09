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
 *  Applied recorded, a posting's address told as it loads, the profile editor, the resume's preview); 3, v3 Phase 5 (the
 *  auto-apply agent, which submits unattended, and Sign-in mode Auto, which reads the job-site password); 4, v3 Phase 7a
 *  (Workable's application pages read and filled, what Ashby and Workable keep before Submit, and the accepted list
 *  options kept sealed: its review); 5, v3 Phases 6 and 7b (Workday's, iCIMS's, Taleo's, SuccessFactors' and Oracle's
 *  pages read, the postings on platforms TailorIT reads told to it as they load, and Sign-in Auto at an email-first
 *  step: the email typed there alone); 6, v3 Phase 8 (Company career sites: every https page read, LinkedIn and the
 *  employee HR systems never, to recognise an application form on an employer's own site, filled as on the other sites,
 *  its origin and path (and the posting's id) told to TailorIT when its side panel opens or Autofill starts); 7, the
 *  snapshot build of 2026-11-06 (SmartRecruiters, fifteen more applicant-tracking sites, Oracle's government cloud and
 *  Workable's job-search site read and filled, only their job pages on sites that also hold an employer's staff pages;
 *  Workday's, iCIMS's and Oracle's application forms filled by their own rules; the page's path told to TailorIT for
 *  the sign-in on ADP Workforce Now's and ClearCompany's job pages; a page that names no job taken as the job of the
 *  tab's page before it, kept per tab in session storage; a form filled beside an unticked checkbox CAPTCHA, every press
 *  waiting for the person); 8, v4 (the owner's request of 2026-11-07: every field it can answer filled without asking
 *  and the rest listed as left empty, the AI's best guess no longer marked, Sign up & Autofill using the saved job-site
 *  sign-in for one run, a run carrying on by itself once the person ticks a checkbox CAPTCHA, and no Dry run to choose);
 *  9, snapshot round 2 (2026-11-07 evening: the options of some sites' dropdown lists kept in this browser to choose at
 *  once next time; government service among the questions the AI may guess; the new sensitive answers, sexual
 *  orientation, citizenship, clearance, non-compete, government service, relatives and essential functions, named
 *  among those that never go to the AI); 10, v5 Phase 1 (2026-11-08, the owner's "Implement like jobright": the panel
 *  on the page itself, opening by itself and moving the page aside, its contents out of the site's scripts' reach though
 *  the site can tell it shows and hears what is typed into it, its closed notes kept, the toolbar icon opening it on any
 *  https page it may run on, the side panel a choice; every https and http page granted at install, Company career sites on unless turned off, never
 *  in a CAPTCHA vendor's frame; an unticked checkbox CAPTCHA holding no press, the site deciding, a site's request for
 *  the check waited out, a refused sign-in left typed for the person); 11, v5 Phase 2 (2026-11-08: a small script in
 *  the page's own context on Workday's, ClearCompany's, Oracle Recruiting Cloud's and SuccessFactors' candidate pages
 *  telling the extension only whether the site took the application, read on three of them from the request or its
 *  answer; a second one, once a fill starts, holding back the alerts and confirms the writes bring and answering the
 *  site's own file picker with the chosen resume; either visible to the site's scripts; rich-text boxes typed with the
 *  browser's own editing; Open Application; the AI's answers streamed back). Raise it whenever the disclosure's
 *  substance changes. */
export const DISCLOSURE_VERSION = 11;
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
  /** The audit of 2026-11-06 (M6): the job its lookup named and the resume it attaches, ids only (null: none), so a
   *  Submit after the worker was stopped still records them; absent until known, and gone with the token. */
  jobId: z.number().int().positive().nullable().optional(),
  resumeId: z.string().max(64).nullable().optional(),
});
/** A checked run record. */
export type RunRecord = z.infer<typeof RunRecordSchema>;

/** The audit of 2026-11-06 (M1, m9): storage.session `jobchoice:<tabId>`, what the person chose in the side panel for
 *  the tab's application, so a worker Chrome stopped while idle keeps it: the resume chosen with Change, "Apply
 *  without resume", the job chosen for "Autofill for another job" (TailorIT's id) and the tab's last search's job ids.
 *  Ids and keys only: an application's key (or, for an address no parser reads, its document's), a resume's id, job
 *  ids. Dropped with the tab and with the token. */
export const JOB_CHOICE_PREFIX = 'jobchoice:';
/** An application the choices are for: its key, or `doc:<tabId>:<frameId>:<documentId>` for an address no parser
 *  reads. */
const ChoiceAppSchema = z.union([ApplicationKeySchema, z.string().regex(/^doc:\d+:\d+:\S{0,100}$/)]);
/** A tab's choices. */
export const JobChoiceRecordSchema = z.strictObject({
  resume: z.strictObject({ app: ChoiceAppSchema.nullable(), id: z.string().min(1).max(64) }).optional(),
  without: ChoiceAppSchema.optional(),
  job: z.strictObject({ app: ChoiceAppSchema, jobId: z.number().int().positive() }).optional(),
  search: z.strictObject({ docKey: z.string().regex(/^\d+:\d+:\S{0,100}$/),
    ids: z.array(z.number().int().positive()).max(10) }).optional(),
});
/** A checked choices record. */
export type JobChoiceRecord = z.infer<typeof JobChoiceRecordSchema>;

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
