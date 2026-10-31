/*
 * The planner's contract with the worker. For each plan/request the worker hands planFrame (frame.ts) the frame's
 * scan and the keys this pass plans, with the canonical profile it holds, and answers the frame with the PlanOutput as
 * it is (PlanAnswerSchema in messaging/schemas.ts). So a frame receives values for its own fields only, never the
 * profile.
 */
import type { MatchCacheStore } from '../matcher/cache';
import type { TiebreakItem, TiebreakVerdict } from '../matcher/types';
import type { ClassifyItem, ClassifyVerdict } from '../resolver/classify';
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
  /** The frame's whole scan, in DOM order, as it scanned it (parsed and capped by the worker): the fields to plan and
   *  the context the planner reads across the frame (a code select beside a phone). */
  specs: readonly FieldSpec[];
  /** The keys of the specs to plan this pass (a later pass plans only what is pending). Only these are resolved,
   *  matched, written and rowed; the rest are context only. Absent: every spec (the Phase 3 review, LC-2). */
  planKeys?: readonly FieldKey[];
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
  /** What the LLM has answered in this run (Phase 4); absent: nothing yet. The worker keeps it for the run only. */
  ai?: PlanAi;
}

/** A tiebreak verdict, with the TailorIT task that gave it: an llm-pick write names that task. */
export interface AnsweredVerdict {
  verdict: TiebreakVerdict;
  taskId: string;
}

/** The LLM's answers so far in a run, which planFrame completes waiting fields with (Phase 4). */
export interface PlanAi {
  /** Tiebreak verdicts by item id (tiebreakId). A verdict completes only the item it was given for. */
  verdicts: ReadonlyMap<string, AnsweredVerdict>;
  /** Classifications by field key. */
  classifications: ReadonlyMap<string, ClassifyVerdict>;
}

/** The questions a plan needs the LLM for (Phase 4): each awaiting key has exactly one. */
export interface PlanAsk {
  /** Single-answer fields the cascade could not decide, as tiebreak items (settings.llm.tiebreak on). */
  tiebreaks: TiebreakItem[];
  /** Fields nothing classified, screened and with something to classify (settings.llm.classify on). */
  classify: ClassifyItem[];
}

export interface PlanOutput {
  /** One per field to write, in DOM order; each has passed guardWrite. */
  writes: PlannedWrite[];
  /** One row per planned spec, in the request's order. The row of a field with a write is the row its fill produces when the
   *  value reads back as planned (wrote false, verification 'not-checked'); the frame settles it after the fill. In a
   *  dry run these rows are the report. */
  results: FillResult[];
  /** Keys waiting for the LLM, whose writes come back through plan/poll (Phase 4). Each has a row in `results`: the
   *  one that stands until the LLM answers (blank and flagged), and the question in `ask`. */
  awaiting: FieldKey[];
  /** What to ask the LLM for the awaiting keys; absent when nothing waits. */
  ask?: PlanAsk;
  /** True when a field needs the sensitive part while sensitiveState is 'not-loaded'. The worker then fetches
   *  GET /profile/sensitive, once per run, and plans again; writes, results and awaiting are empty. */
  needsSensitive: boolean;
  /** The canaries the worker may keep in RunState: none that equals a profile value. */
  persistableCanaries: string[];
}
