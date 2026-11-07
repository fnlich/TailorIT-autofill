import { z } from 'zod';
import { InstantSchema } from './common';
import { greenhouseBoardPage, parseAtsUrl, type AtsKind, type ParsedAtsUrl } from './lookup';

// The auto-apply agent's queue (version 3). The person queues jobs from TailorIT's Jobs and Tracker pages ("Auto-apply")
// and may turn on a rule ("auto-apply to new jobs of at least N% match", off until they turn it on); there is no daily
// limit. The extension's worker, with its token (scope agent:run) and only when the person turned on "Run auto-apply"
// in its options, takes one job at a time (GET /api/autofill/agent/next), opens its application page, fills and
// submits it, and reports how it went (POST /api/autofill/agent/:id/result); a submitted one is marked Applied in the
// tracker. The queue keeps states and reason codes only: never a value the form was filled with.

/**
 * Where a queued job stands. `queued`: waiting. `running`: a browser took it (that browser alone gets it again from
 * GET …/next; `needs-you` with `timed_out` when it does not report within AUTOFILL_AGENT_RUN_TIMEOUT_MS). `submitted`:
 * the form was sent, and the job is Applied in the tracker. `skipped`: the agent left it on purpose (the posting forbids
 * AI, it was applied for already). `needs-you`: the person must finish it (a CAPTCHA, a sign-in, an email code, a
 * required field the profile cannot fill, a run that never reported). `failed`: it went wrong (the page broke, the
 * posting closed, a validation error that stayed).
 */
export const AUTOFILL_AGENT_STATES = ['queued', 'running', 'submitted', 'skipped', 'needs-you', 'failed'] as const;
export type AutofillAgentState = (typeof AUTOFILL_AGENT_STATES)[number];

/** The states a result reports, and the ones "Clear finished" removes. */
export const AUTOFILL_AGENT_FINISHED_STATES = ['submitted', 'skipped', 'needs-you', 'failed'] as const;
export type AutofillAgentFinishedState = (typeof AUTOFILL_AGENT_FINISHED_STATES)[number];

/** How a job came into the queue: the person's Auto-apply, or the rule. */
export const AUTOFILL_AGENT_SOURCES = ['manual', 'rule'] as const;
export type AutofillAgentSource = (typeof AUTOFILL_AGENT_SOURCES)[number];

/**
 * Why a job was not submitted, a closed list (a new code is a new value in an answer: it bumps AUTOFILL_API_VERSION).
 * `required_field_empty`: a required field is still empty. `posting_forbids_ai`: the posting asks applicants not to
 * use AI. `ai_guess_legal`: a legal answer was an AI guess and the person's skip rule says to stop. `captcha`: a
 * CAPTCHA or bot check. `sign_in`: a sign-in or account page (Sign-in mode Manual, or no saved sign-in).
 * `sign_in_failed`: Sign-in mode Auto could not sign in. `email_code`: the site sent a code to the person's email.
 * `validation_error`: the page still shows an error after one retry. `unsupported_site`: the extension cannot fill this
 * page. `posting_closed`: the posting is gone (or TailorIT closed the job before the agent took it). `page_error`: the
 * page did not load or broke. `timed_out`: the run did not report within AUTOFILL_AGENT_RUN_TIMEOUT_MS.
 * `already_applied`: the site says the person applied already, or the tracker had the job past Saved when the agent
 * came to it. `cancelled`: the person stopped the run. `other`: none of these.
 */
export const AUTOFILL_AGENT_REASONS = [
  'required_field_empty',
  'posting_forbids_ai',
  'ai_guess_legal',
  'captcha',
  'sign_in',
  'sign_in_failed',
  'email_code',
  'validation_error',
  'unsupported_site',
  'posting_closed',
  'page_error',
  'timed_out',
  'already_applied',
  'cancelled',
  'other',
] as const;
export type AutofillAgentReason = (typeof AUTOFILL_AGENT_REASONS)[number];

/**
 * A run the agent took and did not report within this long is left for the person: `needs-you`, `timed_out` (it may
 * have been sent; they look and queue it again). It never goes back to the queue by itself.
 */
export const AUTOFILL_AGENT_RUN_TIMEOUT_MS = 30 * 60_000;

/**
 * The platforms whose application forms the agent fills: a job queues only when its posting is on one of them. A
 * platform joins only when the extension can walk its application end to end: an address that opens it (the posting
 * with its entry, or the form), its steps' Next, its Submit, and a sign of success its adapter reads, seen in a capture
 * or snapshot of the page after submitting. Version 6 (the owner's snapshots of 2026-11-06): iCIMS (its posting's
 * "Apply for this job online", the email gate, the steps' Submit, and /job?mode=submit_apply's .iCIMS_SuccessMessage)
 * and Pinpoint (its one-page form, and /applications/thanks's section#application-thanks). Not yet: Workday, Taleo,
 * SuccessFactors, Oracle Recruiting Cloud and SmartRecruiters (no page after submitting seen, so no success sign), Breezy
 * HR (its confirmation is in the form's markup, hidden in both snapshots: never seen shown), and the other new ATSs (no
 * confirmation in any snapshot).
 */
export const AUTOFILL_AGENT_ATS = [
  'greenhouse',
  'lever',
  'ashby',
  'workable',
  'icims',
  'pinpoint',
] as const satisfies readonly AtsKind[];

/** The longest application address the agent opens. */
export const AUTOFILL_AGENT_URL_MAX = 2048;

/**
 * The application form's address for a posting at `url`, on a host the extension's agent opens, or null when the agent
 * cannot fill it. Greenhouse: the posting's job page on job-boards.greenhouse.io (the form is on it), from its job page
 * on either global host, the embedded form naming its board, or a board's own page naming it in ?gh_jid=; never from a
 * company's own page naming it in ?gh_jid= (its form is a frame of the company's page, which the agent never opens), an
 * embed naming no board, or an EU board (the extension works on no EU Greenhouse host yet). Lever: `…/apply`, on either
 * of its hosts. Ashby: `…/application`, the board in lower case (percent-encoded), from the posting, its form or the
 * board naming it in ?ashby_jid=. Workable: apply.workable.com/{account}/j/{shortcode}/apply/, the account in lower case
 * and the shortcode in capitals, from the posting or its form on apply.workable.com or the account's own host; never
 * from a /j/{shortcode} link that names no account, nor from Workable's job-search site. Version 6: iCIMS, the
 * posting's own page, https://<portal>/jobs/<id>/job (its entry opens the email gate), from the posting, its gate or
 * any step after it; Pinpoint, the form, https://<tenant>.pinpointhq.com/en/postings/<uuid>/applications/new, from the
 * posting, the form or the page after submitting. Read with parseAtsUrl, so the extension and TailorIT agree: the
 * answer reads as itself again.
 */
export function agentApplicationUrl(url: string): string | null {
  const read = url.length <= AUTOFILL_AGENT_URL_MAX ? parseAtsUrl(url) : null;
  // parseAtsUrl reads any page naming the posting in ?gh_jid= with no board; a Greenhouse board's own page names one.
  const posting = read?.kind === 'greenhouse' && read.board === null ? greenhouseBoardPage(url) : read;
  const address = posting ? formAddress(posting) : null;
  return address !== null && address.length <= AUTOFILL_AGENT_URL_MAX ? address : null;
}

/** The application form's address of a posting on a platform the agent fills, when its board is known; else null. */
function formAddress({ kind, board, externalId, canonical }: ParsedAtsUrl): string | null {
  if (board === null) return null;
  switch (kind) {
    case 'greenhouse': {
      // One of the posting's own addresses, unless it is on an EU board.
      const page = `https://job-boards.greenhouse.io/${board}/jobs/${externalId}`;
      return canonical.includes(page) ? page : null;
    }
    case 'lever':
      return canonical[1] ?? null;
    case 'ashby':
      return `https://jobs.ashbyhq.com/${encodeURIComponent(board)}/${externalId}/application`;
    case 'workable':
      // The account is a host name's label and the shortcode hexadecimal: nothing to encode.
      return `https://apply.workable.com/${board}/j/${externalId}/apply/`;
    case 'icims':
    case 'pinpoint':
      // The posting's own page (iCIMS) or its form (Pinpoint), as parseAtsUrl builds it from the host and the id alone.
      return canonical[0] ?? null;
    default:
      return null;
  }
}

/** True when the agent can apply to the posting at `url` (the Jobs and Tracker pages' `autoApply`). */
export function agentCanApply(url: string): boolean {
  return agentApplicationUrl(url) !== null;
}
/** The most jobs one Auto-apply click queues, and the most rows an account's queue holds. */
export const AUTOFILL_AGENT_ENQUEUE_MAX = 100;
export const AUTOFILL_AGENT_QUEUE_MAX = 500;
/** The rule's default threshold, used until the person sets one. */
export const AUTOFILL_AGENT_DEFAULT_MIN_MATCH = 80;

/** A queue row's id: TailorIT's random UUID in lower case. */
export const AutofillAgentIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

/**
 * The job the agent applies to now: open `url`, the application form's address (agentApplicationUrl: Greenhouse's job
 * page on job-boards.greenhouse.io, Lever's `…/apply`, Ashby's `…/application`, Workable's `…/apply/`, and since
 * version 6 iCIMS's posting page `…/jobs/<id>/job` and Pinpoint's `…/applications/new`), and attach `resumeId` when
 * set.
 */
export const AutofillAgentTaskSchema = z.object({
  id: AutofillAgentIdSchema,
  jobId: z.number().int().positive(),
  url: z.string().max(AUTOFILL_AGENT_URL_MAX).regex(/^https?:\/\/\S+$/i),
  company: z.string(),
  title: z.string(),
  /** The resume to attach: the one TailorIT matched to the job (a rule's), the tracker entry's, else null (the lookup's
   *  suggestion then). */
  resumeId: z.string().nullable(),
});
export type AutofillAgentTask = z.infer<typeof AutofillAgentTaskSchema>;

/**
 * GET /api/autofill/agent/next (scope agent:run): this browser's own running job again, when it has one (a worker that
 * restarted asks anew; nothing changes); else the account's oldest queued job, now `running` for this browser (checked
 * again as it is taken: one tracked past Saved by now is `skipped`, a closed one `failed`, and the next taken); else,
 * with the rule on, a new job: open, posted (else updated, else first seen) since the rule was turned on, from a board
 * TailorIT reads (not an import alone), not tracked, never queued, never taken out of the queue by the person, on a
 * platform the agent fills (agentCanApply), and whose match with the account's best resume for it is at least the
 * rule's `minMatch`; weighed in the order TailorIT first saw them, each once, and counted toward
 * AUTOFILL_AGENT_QUEUE_MAX. `item` null: nothing to do.
 */
export const AutofillAgentNextSchema = z.object({ item: AutofillAgentTaskSchema.nullable() });
export type AutofillAgentNext = z.infer<typeof AutofillAgentNextSchema>;

/**
 * POST /api/autofill/agent/:id/result (scope agent:run): how a run went. `submitted` (no reason) is taken whatever the
 * row's state, from any of the account's browsers, so a sent form is never lost (a run left `needs-you`, `timed_out`
 * included): the job is marked Applied in the tracker (POST /api/autofill/applied's way, with the run's resume as the
 * entry's when it is made or restored now); again for a submitted row, it changes nothing. Any other state needs a
 * reason, and the row `running` for this browser, or for a connection that no longer works (revoked, expired or
 * deleted: a browser that connected again during the run reports it with its new token); 409 `conflict` otherwise, but
 * the same result again, which changes nothing. 404 for another account's row or one removed since. `aiGuesses`: how
 * many answers were AI guesses, a count only (shown on TailorIT's Auto-apply page). Answers 204.
 */
export const AutofillAgentResultBodySchema = z
  .object({
    state: z.enum(AUTOFILL_AGENT_FINISHED_STATES),
    reason: z.enum(AUTOFILL_AGENT_REASONS).nullable(),
    aiGuesses: z.number().int().min(0).max(1000).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.state === 'submitted' && body.reason !== null) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'A submitted application has no reason' });
    }
    if (body.state !== 'submitted' && body.reason === null) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Say why it was not submitted' });
    }
  });
export type AutofillAgentResultBody = z.infer<typeof AutofillAgentResultBodySchema>;

/** POST /api/autofill/agent/queue (the Jobs and Tracker pages' Auto-apply): queue these jobs. */
export const AutofillAgentEnqueueBodySchema = z.object({
  jobIds: z.array(z.number().int().positive()).min(1).max(AUTOFILL_AGENT_ENQUEUE_MAX),
});
export type AutofillAgentEnqueueBody = z.infer<typeof AutofillAgentEnqueueBodySchema>;

/**
 * Why a job was not queued: `already_queued` (queued or running now), `already_applied` (its tracker entry is past
 * Saved, or the agent submitted it), `posting_closed` (the posting has closed), `unsupported_site` (the agent cannot
 * open its posting's form: not on a platform the agent fills, or a company's own page naming a Greenhouse posting in
 * ?gh_jid=: agentCanApply), `not_found` (TailorIT has no such job). `timed_out` is never answered by POST …/queue; it
 * is listed so one set of words labels both these skips and the rows' reasons.
 */
export const AUTOFILL_AGENT_SKIPS = [
  'already_queued',
  'already_applied',
  'posting_closed',
  'timed_out',
  'unsupported_site',
  'not_found',
] as const;
export type AutofillAgentSkip = (typeof AUTOFILL_AGENT_SKIPS)[number];

/**
 * The answer: the jobs queued now (a job the agent left earlier, skipped, needing the person or failed, is queued
 * again), and the rest with why. 409 `conflict` when the queue would hold more than AUTOFILL_AGENT_QUEUE_MAX rows.
 */
export const AutofillAgentEnqueueResponseSchema = z.object({
  queued: z.array(z.number().int().positive()),
  skipped: z.array(z.object({ jobId: z.number().int().positive(), reason: z.enum(AUTOFILL_AGENT_SKIPS) })),
});
export type AutofillAgentEnqueueResponse = z.infer<typeof AutofillAgentEnqueueResponseSchema>;

/** One row of the Auto-apply page. */
export const AutofillAgentQueueItemSchema = z.object({
  id: AutofillAgentIdSchema,
  jobId: z.number().int().positive(),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  /** The posting's address. */
  url: z.string(),
  /** The job is still open. */
  active: z.boolean(),
  state: z.enum(AUTOFILL_AGENT_STATES),
  /** Why it was not submitted; null while queued or running, and when submitted. */
  reason: z.enum(AUTOFILL_AGENT_REASONS).nullable(),
  source: z.enum(AUTOFILL_AGENT_SOURCES),
  /** How many times the agent took it. */
  attempts: z.number().int().nonnegative(),
  /** AI guesses in the run that finished it; null when it did not say. */
  aiGuesses: z.number().int().nonnegative().nullable(),
  createdAt: InstantSchema,
  startedAt: InstantSchema.nullable(),
  finishedAt: InstantSchema.nullable(),
});
export type AutofillAgentQueueItem = z.infer<typeof AutofillAgentQueueItemSchema>;

/**
 * GET /api/autofill/agent/queue (the Auto-apply page): the account's queue, running first, then queued (oldest first,
 * the order the agent takes them), then the finished ones (latest first). `limit` is AUTOFILL_AGENT_QUEUE_MAX.
 * DELETE /api/autofill/agent/queue/:id removes one (204); POST /api/autofill/agent/queue/clear-finished removes the
 * finished ones ({removed}).
 */
export const AutofillAgentQueueListSchema = z.object({
  items: z.array(AutofillAgentQueueItemSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
});
export type AutofillAgentQueueList = z.infer<typeof AutofillAgentQueueListSchema>;

/** POST /api/autofill/agent/queue/clear-finished's answer: how many finished rows were removed. */
export const AutofillAgentClearedSchema = z.object({ removed: z.number().int().nonnegative() });
export type AutofillAgentCleared = z.infer<typeof AutofillAgentClearedSchema>;

/**
 * GET and PUT /api/autofill/agent/settings (the Auto-apply page): the rule "auto-apply to new jobs of at least
 * `minMatch`% match", off by default. Turning it on starts its "new": only jobs TailorIT first sees from then on.
 */
export const AutofillAgentSettingsSchema = z.object({
  ruleEnabled: z.boolean(),
  minMatch: z.number().int().min(0).max(100),
});
export type AutofillAgentSettings = z.infer<typeof AutofillAgentSettingsSchema>;
