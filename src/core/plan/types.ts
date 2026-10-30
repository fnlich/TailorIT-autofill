/*
 * The planner's contract with the worker. For each plan/request the worker hands planFrame (frame.ts) this pass's
 * fields with the canonical profile it holds, and answers the frame with the PlanOutput as it is (PlanAnswerSchema in
 * messaging/schemas.ts). So a frame receives values for its own fields only, never the profile.
 */
import type { MatchCacheStore } from '../matcher/cache';
import type { FieldKey, FieldSpec } from '../types/field';
import type { FillResult, PlannedWrite } from '../types/fill';
import type { Profile, SensitiveState, Ymd } from '../types/profile';
import type { SavedAnswer } from '../types/saved';
import type { Settings } from '../types/settings';
import type { Vocab } from '../vocab/types';

/** canonicalizeProfile's state, plus 'unavailable': the worker tried to fetch the sensitive part and failed for a reason
 *  other than a 403 (a timeout, a 5xx). Fields that need it are then left blank and flagged sensitive-unavailable. */
export type PlanSensitiveState = SensitiveState | 'unavailable';

export interface PlanInput {
  /** This pass's fields, in DOM order, as the frame scanned them (parsed and capped by the worker). */
  specs: readonly FieldSpec[];
  /** The page's canaries as the frame extracted them (at most 32). Every outgoing value is scanned for them. */
  canaries: readonly string[];
  profile: Profile;
  sensitiveState: PlanSensitiveState;
  /** The person's saved answers (Phase 6); empty until then. */
  savedAnswers: readonly SavedAnswer[];
  settings: Settings;
  vocab: Vocab;
  /** The worker's accepted-match cache, read only. */
  cache?: MatchCacheStore;
  /** A dry run plans rows only: `writes` is empty, so no value reaches the frame. */
  dryRun: boolean;
  now: Ymd;
}

export interface PlanOutput {
  /** One per field to write, in DOM order; each has passed guardWrite. */
  writes: PlannedWrite[];
  /** One row per spec, in the request's order. The row of a field with a write is the row its fill produces when the
   *  value reads back as planned (wrote false, verification 'not-checked'); the frame settles it after the fill. In a
   *  dry run these rows are the report. */
  results: FillResult[];
  /** Keys waiting for the LLM, whose writes come back through plan/poll (Phase 4; always empty before). */
  awaiting: FieldKey[];
  /** True when a field needs the sensitive part while sensitiveState is 'not-loaded'. The worker then fetches
   *  GET /profile/sensitive, once per run, and plans again; writes, results and awaiting are empty. */
  needsSensitive: boolean;
  /** The canaries the worker may keep in RunState: none that equals a profile value. */
  persistableCanaries: string[];
}
