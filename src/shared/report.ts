/*
 * A frame's report: what the review panel shows. Its schema is strict and has no field that could hold a value or an
 * option label, so a report can be stored in storage.session and pushed to the panel without leaking anything typed.
 */
import { z } from 'zod';
import { FIELD_KINDS, FILL_STATUSES, MATCHER_STAGES, PLATFORMS, PROVENANCES } from '../core/enums';
import { REASON_CODES } from '../core/types/fill';
import { FIELD_CATEGORIES } from '../core/types/intent';
import { PAUSE_REASONS, REPEATABLE_KINDS, RUN_STATUSES } from '../core/types/run';

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
    })
    .optional(),
});

/** Notices the panel shows above the rows. */
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
  'page-turned'] as const;

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

/**
 * Whether a row needs the person: it asks for them (an AI draft to confirm, a question left for them), or the run left
 * it blocked, or flagged without writing it. A flagged row whose value was written (a low-confidence fill, a posting
 * country's answer) only says "check it" and is done (SPEC-AMENDMENTS §11). One rule for the review's count
 * (src/ui/report/model.ts) and the launcher's (the content orchestrator), so the two never disagree about a row: a
 * blocked row can come without `needsUserAction`.
 */
export function needsPerson(row: Pick<FrameReport['fields'][number], 'needsUserAction' | 'status' | 'wrote'>): boolean {
  return row.needsUserAction || row.status === 'blocked' || (row.status === 'flagged' && !row.wrote);
}

/** A report row. */
type Row = FrameReport['fields'][number];

/** Whether a row is done for the person: written (verified or filled, or flagged with its value written: it only says
 *  "check it", SPEC-AMENDMENTS §11), or a question that already held its answer or needed none (an end date for a job
 *  they still hold). A row that needs the person never is. */
export function isReady(row: Pick<Row, 'needsUserAction' | 'status' | 'wrote' | 'reason'>): boolean {
  if (needsPerson(row)) return false;
  return row.status === 'verified' || row.status === 'filled' || row.wrote || row.reason === 'already-correct'
    || row.reason === 'end-date-not-applicable';
}

/** Whether the person filled a field the run left for them, with their own input since (v3 Phase 3): it counts as filled
 *  in the progress and is no longer left for them, though its card stays open (Save my answer may be offered on it). */
export function filledByPerson(row: Pick<Row, 'detail'>): boolean {
  return row.detail?.filledByYou === true;
}

/** Whether a row is still left for the person: it needs them (needsPerson) and they have not filled it since. One rule
 *  for the review's count and the launcher's. */
export function leftForPerson(row: Pick<Row, 'needsUserAction' | 'status' | 'wrote' | 'detail'>): boolean {
  return needsPerson(row) && !filledByPerson(row);
}

/** A row in the field lists (v3 Phase 3, Jobright's three icons): 'filled' (isReady), 'missing' (it needs the person),
 *  'working' (a write still to come in the run that fills now, or the one being written: `current`), or 'none' (a
 *  question that needed nothing, left alone: no icon of either kind, and the progress leaves it out). */
export type RowProgress = 'filled' | 'missing' | 'working' | 'none';

/** A row's place in the progress, by its frame's live progress (`filling`) when its run fills now. */
export function rowProgressOf(row: Row, filling?: ProgressInput['filling']): RowProgress {
  if (filling !== undefined && (filling.current === row.key || filling.pending.includes(row.key))) return 'working';
  if (isReady(row) || filledByPerson(row)) return 'filled';
  if (needsPerson(row)) return 'missing';
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
