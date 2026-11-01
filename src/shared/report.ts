/*
 * A frame's report: what the review panel shows. Its schema is strict and has no field that could hold a value or an
 * option label, so a report can be stored in storage.session and pushed to the panel without leaking anything typed.
 */
import { z } from 'zod';
import { FIELD_KINDS, FILL_STATUSES, MATCHER_STAGES, PLATFORMS, PROVENANCES } from '../core/enums';
import { REASON_CODES } from '../core/types/fill';
import { FIELD_CATEGORIES } from '../core/types/intent';
import { PAUSE_REASONS, RUN_STATUSES } from '../core/types/run';

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
  'policy-profile-only', 'ai-attestation'] as const;

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
 * it flagged or blocked. One rule for the review's count (src/ui/report/model.ts) and the launcher's (the content
 * orchestrator), so the two never disagree about a row: a blocked row can come without `needsUserAction`.
 */
export function needsPerson(row: Pick<FrameReport['fields'][number], 'needsUserAction' | 'status'>): boolean {
  return row.needsUserAction || row.status === 'flagged' || row.status === 'blocked';
}
