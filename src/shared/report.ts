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
    })
    .optional(),
});

/** Notices the panel shows above the rows. */
export const NOTICE_CODES = ['tripwire', 'policy', 'policy-unreadable', 'attention-check', 'page-busy', 'auth', 'captcha',
  'validation', 'needs-click', 'posting-outside-frame', 'deferred-fields', 'step-retry-limit',
  // The Phase 2 review: policy text only hidden text holds (S6), and a form its page hides (S1).
  'policy-hidden-text', 'form-hidden'] as const;

export const FrameReportSchema = z.strictObject({
  v: z.literal(1),
  runId: z.string().min(1).max(64),
  frameId: z.number().int().nonnegative(),
  platform: z.enum(PLATFORMS),
  adapter: z.enum(['generic', ...PLATFORMS]),
  mode: z.enum(['fill', 'dry-run']),
  status: z.enum(RUN_STATUSES),
  pauseReason: z.enum(PAUSE_REASONS).nullable(),
  step: z.strictObject({ index: z.number().int().nonnegative(), of: z.number().int().positive().optional() }).optional(),
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
