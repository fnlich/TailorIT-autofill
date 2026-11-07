/*
 * A frame's report: what the review panel shows. Its schema is strict and has no field that could hold a value or an
 * option label, so a report can be stored in storage.session and pushed to the panel without leaking anything typed.
 */
import { z } from 'zod';
import { FIELD_KINDS, FILL_STATUSES, MATCHER_STAGES, PLATFORMS, PROVENANCES } from '../core/enums';
import { PERSON_ONLY_REASONS, REASON_CODES, type ReasonCode } from '../core/types/fill';
import { FIELD_CATEGORIES } from '../core/types/intent';
import { PAUSE_REASONS, REPEATABLE_KINDS, RUN_STATUSES, STEP_FINALITIES } from '../core/types/run';

const Key = z.string().min(1).max(600);

export const FillResultSchema = z.strictObject({
  key: Key,
  label: z.string().max(300),
  kind: z.enum(FIELD_KINDS),
  category: z.enum(FIELD_CATEGORIES),
  section: z.string().max(200),
  required: z.boolean(),
  status: z.enum(FILL_STATUSES),
  provenance: z.enum(PROVENANCES).nullable(),
  matcherStage: z.enum(MATCHER_STAGES),
  confidence: z.number().min(0).max(1),
  reason: z.enum(REASON_CODES),
  wrote: z.boolean(),
  verification: z.enum(['verified', 'mismatch', 'not-checked', 'not-applicable']),
  needsUserAction: z.boolean(),
  detail: z
    .strictObject({
      suggestions: z.array(z.strictObject({ index: z.number().int().nonnegative(), score: z.number() })).max(3).optional(),
      revealedBy: Key.optional(),
      /** The person changed the field with their own input after the run left it flagged (Requirement F). */
      userEdited: z.literal(true).optional(),
      /** v3 Phase 3: the person's own input left an answer in a field the run left for them (a flag, no value). */
      filledByYou: z.literal(true).optional(),
      /** The v3 Phase 4 review: a cover letter longer than its text box takes (cover-letter-too-long): the letter's
       *  length and the box's limit, in characters. Counts only, never the words. */
      letterLength: z.strictObject({ length: z.number().int().nonnegative(), limit: z.number().int().positive() })
        .optional(),
    })
    .optional(),
});

/** The run's notices. v4 (the owner, 2026-11-07: "Never flag to the user"): no panel or page draws them any more; they
 *  are the facts the worker reads of a run (the auto-apply agent's verdict, the posting's AI rule, the counters), and
 *  the content script raises only those (content/orchestrator.ts). What the person must act on is a branded toast on
 *  the page (content/ui/toasts.ts). The codes stay, so a stored or older report still parses. */
export const NOTICE_CODES = ['tripwire', 'policy', 'policy-unreadable', 'attention-check', 'page-busy', 'auth', 'captcha',
  'validation', 'needs-click', 'posting-outside-frame', 'deferred-fields', 'step-retry-limit',
  // The Phase 2 review: policy text only hidden text holds (S6), and a form its page hides (S1).
  'policy-hidden-text', 'form-hidden',
  // The step machine (Phase 5): a step whose finality the adapter cannot tell, with auto-advance on; a runaway wizard.
  'final-unknown', 'max-steps',
  // The Phase 5 review (X-S8): a form its page hid just before auto-advance would have pressed Next; and (X-S4,
  // tightened) a step whose CAPTCHA is not known solved, whose Next is left to the person.
  'next-hidden', 'captcha-next',
  // Phase 6: the policy notice came only from TailorIT's saved copy of the posting. The page's card says so under its
  // sentence, and the report says it under the panel's, so the two read the same.
  'policy-stored-copy',
  // The owner's amendments (docs/SPEC-AMENDMENTS.md): the run filled from the profile only, because the posting forbids
  // AI, or because the form holds an "I did not use AI" attestation.
  'policy-profile-only', 'ai-attestation',
  // v3 Phase 3: the form moved to a new step while Autofill after page turn is Manually: Continue fills it.
  'page-turned',
  // v3 Phase 4: Submit mode Auto held the final Submit back, and why; and a Submit pressed (the panel's or Auto's) that
  // no confirmation followed within SUBMIT_CONFIRM_MS.
  'submit-held-required', 'submit-held-no-ai', 'submit-held-guess', 'submit-held-captcha', 'submit-held-check',
  'submit-unconfirmed',
  // The Phase 7a review: Submit mode Auto held the Submit for an attention check left for the person.
  'submit-held-attention', 'submit-held-entries',
  // The v3 Phase 4 review: the page refused a Submit pressed (its errors, its failure message; `count` of them), and
  // Submit mode Auto submitted a posting whose AI rule could not be read.
  'submit-errors', 'submit-auto-unchecked',
  // v3 Phase 5, Sign-in mode Auto: the run signs in with the person's saved job-site sign-in; it could not (no sign-in
  // for this site, a field it may not fill, Sign-in Auto not allowed); or the site did not take it.
  'sign-in-auto', 'sign-in-unavailable', 'sign-in-failed',
  // The audit of 2026-11-06 (S-2, S-3): a bot check or CAPTCHA asked as a question is left for the person (`count` of
  // them); while one is, Next and Submit are never pressed for them, and the agent leaves the job (needs-you captcha).
  'bot-check',
  // The snapshot build of 2026-11-06 (core-x, item 2): the form's own account section (iCIMS's "Create a login") still
  // has a required box empty: the person's (or Sign-in Auto's), and Next waits for it.
  'account-left',
  // The behaviour review of 2026-11-06 (minor 7): the errors the step shows were there before anything was written (an
  // item the page marked invalid on load): the person's to fix, and the agent leaves the job for them.
  'errors-on-load'] as const;

/** A step's progress line as the adapter reads it from the page ("Step 2 of 4"), at most this long. */
export const MAX_STEP_PROGRESS = 120;

export const FrameReportSchema = z.strictObject({
  v: z.literal(1),
  runId: z.string().min(1).max(64),
  frameId: z.number().int().nonnegative(),
  platform: z.enum(PLATFORMS),
  adapter: z.enum(['generic', ...PLATFORMS]),
  mode: z.enum(['fill', 'dry-run']),
  status: z.enum(RUN_STATUSES),
  pauseReason: z.enum(PAUSE_REASONS).nullable(),
  /** The step the multi-step machine is on: its index (RunState.stepIndex, from 0), and the adapter's progress line
   *  when the page shows one (visible page text, like a label). The panel shows the progress line where there is one. */
  step: z.strictObject({ index: z.number().int().nonnegative(), of: z.number().int().positive().optional(),
    progress: z.string().min(1).max(MAX_STEP_PROGRESS).optional() }).optional(),
  fields: z.array(FillResultSchema).max(500),
  /** While the run fills a step (v3 Phase 3, a report it sends mid-fill): the key of the field being written now (null
   *  between writes) and the keys of those still to be written this pass, so the panels spin the current row and count
   *  only what is done. Keys only, never a value. */
  filling: z.strictObject({ current: Key.nullable(), pending: z.array(Key).max(500) }).optional(),
  /** The step's repeatable sections (v3 Phase 3): of each kind, the entries the profile has and those the form shows a
   *  block for, so the review says "Education · 2 of 3 added". Counts only. */
  repeatables: z.array(z.strictObject({ kind: z.enum(REPEATABLE_KINDS), added: z.number().int().nonnegative(),
    of: z.number().int().nonnegative() })).max(REPEATABLE_KINDS.length).optional(),
  /** The run rests in a status that otherwise means it works (v3 Phase 3 review): at wait-transition while it waits for
   *  the person's own Next, nothing runs, so the panels show the review at rest, not "Autofilling". */
  resting: z.literal(true).optional(),
  /** v3 Phase 4: the step's own buttons as the adapter reads them at rest, for the panel's "Continue to the next page"
   *  and "Submit application": whether the step is the last (`final`, 'unknown' when the adapter cannot tell), whether
   *  its Next and its Submit show (visible and enabled), and a Submit the panel or Submit mode Auto pressed that waits
   *  for the platform's confirmation (`pressed`). Flags only. */
  buttons: z.strictObject({ final: z.enum(STEP_FINALITIES), next: z.boolean(), submit: z.boolean(),
    pressed: z.literal('submit').optional() }).optional(),
  notices: z.array(z.strictObject({ code: z.enum(NOTICE_CODES), count: z.number().int().positive().optional() })).max(20),
  counters: z.strictObject({
    passes: z.number().int().nonnegative(),
    hiddenControlsIgnored: z.number().int().nonnegative(),
    deferredFields: z.number().int().nonnegative(),
  }),
  updatedAt: z.number().int().nonnegative(),
});
export type FrameReport = z.infer<typeof FrameReportSchema>;

/** The notices that say the posting forbids AI (v2): the policy notice past or without its card, the profile-only and
 *  attestation notices, and the saved copy's. */
export const NO_AI_NOTICES: ReadonlySet<(typeof NOTICE_CODES)[number]> = new Set(['policy', 'policy-profile-only',
  'ai-attestation', 'policy-stored-copy']);

/** Whether a frame's report says the posting forbids AI: its run waits at the policy card, or it raised one of
 *  NO_AI_NOTICES. The side panel shows that notice above the custom question, and the worker tells the question's
 *  answer so. */
export function saysNoAi(report: Pick<FrameReport, 'status' | 'notices'>): boolean {
  return report.status === 'policy-notice' || report.notices.some((notice) => NO_AI_NOTICES.has(notice.code));
}

/** Whether a frame's run fills from the profile only (Phase G): it raised policy-profile-only or ai-attestation, so
 *  nothing of it goes to the AI, the side panel's Write it now included. */
export function fillsFromProfileOnly(report: Pick<FrameReport, 'notices'>): boolean {
  return report.notices.some((notice) => notice.code === 'policy-profile-only' || notice.code === 'ai-attestation');
}

/** A tab's latest report (its latest updatedAt), or null when it has none: its mode says whether the tab's latest run
 *  is a dry run (the Phase G review, MINOR 4: Write it now writes nothing there). */
export function latestReport<T extends Pick<FrameReport, 'updatedAt'>>(reports: readonly T[]): T | null {
  return reports.reduce<T | null>((latest, report) => (latest === null || report.updatedAt > latest.updatedAt ? report
    : latest), null);
}

// ── v4 run: "Never flag to the user, just determine with your own" (the owner, 2026-11-07; docs/SPEC-AMENDMENTS.md §13) ──

/** A report row. */
type Row = FrameReport['fields'][number];

/** The reasons of a row that stays the person's whatever the run decides (the hard rules): a bot check or CAPTCHA asked
 *  as a question (the audit of 2026-11-06, S-2, S-3), never answered, ticked or sent to an AI; while one is left, Next,
 *  Submit mode Auto and the agent hold as at a CAPTCHA, and the page's toast says to solve it. The only row that does. */
export const HARD_STOP_REASONS: ReadonlySet<ReasonCode> = PERSON_ONLY_REASONS;

/** The reasons of a row left out of the person's counts and lists, besides every guard refusal (status 'blocked'): a
 *  field hidden from people, one no visible label names, one whose label addresses AI tools (D8). Never filled. */
const LEFT_OUT_REASONS: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['honeypot', 'not-user-visible',
  'no-visible-label', 'tripwire-in-label']);

/**
 * Whether a row stops for the person (D1): only a hard-rule stop (HARD_STOP_REASONS) not answered yet. The run decides
 * every other field itself: one it could not or would not fill is simply not filled (notFilled), never "needs you".
 * One rule for the review, the launcher and the step's holds, so none of them disagrees about a row.
 */
export function needsPerson(row: Pick<Row, 'status' | 'wrote' | 'reason'>): boolean {
  return !row.wrote && row.status !== 'blocked' && HARD_STOP_REASONS.has(row.reason);
}

/** Whether a row is left out of the person's counts and lists (D8): a guard refusal (a honeypot, a canary, a trap), or a
 *  field hidden from people, named by no visible label, or whose label addresses AI tools. */
export function leftOut(row: Pick<Row, 'status' | 'reason'>): boolean {
  return row.status === 'blocked' || LEFT_OUT_REASONS.has(row.reason);
}

/** Whether a row is done (D3, D4): written (verified or filled, a low-confidence fill or a posting country's answer
 *  among them: no "check it" any more), or a question that already held its answer, needed none (an end date for a job
 *  they still hold), or keeps the page's own text (prefill-kept). A hard-rule stop or a row left out never is. */
export function isReady(row: Pick<Row, 'status' | 'wrote' | 'reason'>): boolean {
  if (needsPerson(row) || leftOut(row)) return false;
  return row.status === 'verified' || row.status === 'filled' || row.wrote || row.reason === 'already-correct'
    || row.reason === 'end-date-not-applicable' || row.reason === 'prefill-kept';
}

/** Whether a row is a field the run did not fill, whatever the person did since (notFilled reads their input too): not
 *  done, not left out, and not an optional question left alone on purpose (skipped: optional, or needing nothing). A
 *  required field is one whatever its status (the v4 review, L-M7): a résumé the form requires under "Apply without
 *  resume" (resume-not-attached), a required field the page disabled (disabled-or-readonly) or took away
 *  (field-disappeared) is skipped by the run, and empty all the same, so it counts as missing and holds auto-Next. A
 *  hard-rule stop not answered yet is one. */
export function unfilledByRun(row: Pick<Row, 'status' | 'wrote' | 'reason' | 'required'>): boolean {
  return !isReady(row) && !leftOut(row) && (row.status !== 'skipped' || row.required);
}

/** Whether a row is a question the run did not fill and the person still may (D1: an empty circle in the lists, never
 *  "Needs you"): one the run did not fill (unfilledByRun: a required one whatever its status), and not filled by the
 *  person since. */
export function notFilled(row: Pick<Row, 'status' | 'wrote' | 'reason' | 'required' | 'detail'>): boolean {
  return unfilledByRun(row) && !filledByPerson(row);
}

/** Whether the person filled a field the run did not, with their own input since (v3 Phase 3): it counts as filled in
 *  the progress. */
export function filledByPerson(row: Pick<Row, 'detail'>): boolean {
  return row.detail?.filledByYou === true;
}

/** Whether a hard-rule stop is still left for the person: it needs them (needsPerson) and they have not answered it
 *  since. */
export function leftForPerson(row: Pick<Row, 'status' | 'wrote' | 'reason' | 'detail'>): boolean {
  return needsPerson(row) && !filledByPerson(row);
}

/** A row in the field lists (v3 Phase 3, Jobright's three icons): 'filled' (isReady, or filled by the person since),
 *  'missing' (v4, D1: not filled, notFilled: an empty circle, never "needs you"; a required field the run skipped among
 *  them, the v4 review's L-M7), 'working' (a write still to come in the
 *  run that fills now, or the one being written: `current`), or 'none' (a question left alone on purpose, or a row left
 *  out (D8): no icon of either kind, and the progress leaves it out). */
export type RowProgress = 'filled' | 'missing' | 'working' | 'none';

/** A row's place in the progress, by its frame's live progress (`filling`) when its run fills now. */
export function rowProgressOf(row: Row, filling?: ProgressInput['filling']): RowProgress {
  if (filling !== undefined && (filling.current === row.key || filling.pending.includes(row.key))) return 'working';
  if (isReady(row) || (filledByPerson(row) && !leftOut(row))) return 'filled';
  if (notFilled(row)) return 'missing';
  return 'none';
}

/** How far the tab's forms are (v3 Phase 3), one rule for the side panel, the in-page panel and the launcher's badge:
 *  the required rows filled of the required rows the progress counts (filled, missing or working), or of every such
 *  row when none is required (`requiredOnly` false, Jobright's "fields filled"); the percent rounded down, so 100% means
 *  every one is filled. */
export interface Progress {
  filled: number;
  of: number;
  requiredOnly: boolean;
  /** 0 to 100; 0 when nothing counts. */
  percent: number;
}

/** What the progress reads of a frame's report: its rows, and its live progress while it fills. */
export interface ProgressInput {
  fields: readonly Row[];
  filling?: { current: string | null; pending: readonly string[] } | undefined;
}

/** The progress across the tab's frame reports (Progress). */
export function progressOf(reports: readonly ProgressInput[]): Progress {
  const counted = reports.flatMap((report) => report.fields.map((row) => ({ row,
    state: rowProgressOf(row, report.filling) }))).filter((entry) => entry.state !== 'none');
  const required = counted.filter((entry) => entry.row.required);
  const requiredOnly = required.length > 0;
  const pool = requiredOnly ? required : counted;
  const filled = pool.filter((entry) => entry.state === 'filled').length;
  const of = pool.length;
  return { filled, of, requiredOnly, percent: of === 0 ? 0 : Math.floor((filled / of) * 100) };
}
