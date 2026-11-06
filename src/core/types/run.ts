/*
 * The multi-step state machine's persisted state (Requirement C). It survives page reloads and worker restarts in
 * storage.local, so it holds keys, hashes, counters, ids and canaries the worker has checked: never a field value.
 */
import type { Platform } from '../enums';
import type { BaseKey, FieldKey } from './field';

/** 'handoff': the user must act (a CAPTCHA, an email code, a bot check, Workday's entry choice, a busy page, a click the
 *  site needs, v3 Phase 7b's password reset). 'auth-needed': sign-in, account creation or an email gate. Neither is ever
 *  automated, but by Sign-in mode Auto at an auth-needed pause (docs/SPEC-AMENDMENTS.md §12). */
export const RUN_STATUSES = ['detect', 'auth-needed', 'handoff', 'policy-notice', 'scan-step', 'fill-step', 'validate',
  'advance', 'wait-transition', 'review', 'done', 'stopped'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const PAUSE_REASONS = ['captcha', 'email-code', 'bot-check', 'entry-choice', 'page-busy', 'needs-click',
  'forgot-password'] as const;
export type PauseReason = (typeof PAUSE_REASONS)[number];

/** At most two fill attempts per step, counted across reloads. */
export const MAX_STEP_ATTEMPTS = 2;
/** A runaway-wizard guard. */
export const MAX_STEPS = 30;
/** RunState.drafts keeps at most this many keys. */
export const MAX_RUN_STATE_DRAFTS = 100;
/** RunState expires this long after its last update. */
export const RUN_STATE_TTL_MS = 24 * 60 * 60 * 1000;
/** After a reload, a run resumes by itself in its own tab only this soon after its last update; later (until
 *  RUN_STATE_TTL_MS) the person's Continue resumes it (Phase 5, steps/machine.ts resumeMode). */
export const RESUME_AUTO_MS = 30 * 60 * 1000;

/** How the adapter judges a step (adapters/types.ts isFinalStep). 'unknown' is treated as final: nothing is pressed. */
export const STEP_FINALITIES = ['final', 'not-final', 'unknown'] as const;
export type StepFinality = (typeof STEP_FINALITIES)[number];

/** The repeatable sections an adapter declares (adapters/types.ts repeatables): one counter each per step. */
export const REPEATABLE_KINDS = ['experience', 'education', 'language'] as const;
export type RepeatableKind = (typeof REPEATABLE_KINDS)[number];
/** At most this many blocks of one repeatable section are planned (plan/request's and its answer's cap, Phase 5). */
export const MAX_REPEATABLE_BLOCKS = 100;

/**
 * Persisted per application under `run:${applicationKey}`. The run id is minted per document at run/begin and never
 * persisted; expiry is updatedAt + RUN_STATE_TTL_MS.
 */
export interface RunState {
  version: 1;
  /** `${platform}:${hex16(sha256(canonical application URL))}`; the adapter's url.ts gives the canonical URL. */
  applicationKey: string;
  platform: Platform;
  status: RunStatus;
  /** Where 'handoff' returns to. */
  resumeStatus: RunStatus | null;
  /** Set exactly when status is 'handoff'. */
  pauseReason: PauseReason | null;
  stepSignature: string | null;
  stepIndex: number;
  /** Fill attempts per step signature. */
  stepAttempts: Record<string, number>;
  /** Per step signature. */
  filledFieldKeys: Record<string, FieldKey[]>;
  repeatableCounters: Record<string, { profile: number; rendered: number; addClicks: number }>;
  /** Page-derived canaries, at most 32. The worker drops any that equals a profile value before this is stored. */
  canarySet: string[];
  tripwire: { triggered: boolean; hits: number };
  policyDecision: 'accepted' | 'declined' | null;
  /** Parent → child reveal edges, by base key. */
  revealEdges: Array<[BaseKey, BaseKey]>;
  /** Batch hash → TailorIT task id, so a finished AI answer is re-read after a reload rather than asked again. */
  aiTasks: Record<string, string>;
  /** The AI drafts written and still waiting for the person (the Phase 6 review, E4), by stored base key
   *  (bookkeeping.ts storedBaseKey: keys only, never a value or its hash), at most MAX_RUN_STATE_DRAFTS: a run resumed
   *  after a reload rows a field there that holds text it did not write as an unconfirmed draft. Absent: none. */
  drafts?: BaseKey[];
  lastFill: { flagged: number; blocked: number; unresolved: number } | null;
  startedAt: number;
  updatedAt: number;
}

/** One repeatable section's counts on one step (RunState.repeatableCounters, keyed `${stepSignature}:${kind}`): the
 *  profile's entries, the blocks rendered when it was last planned, and the Add clicks made, each counted before it is
 *  made, so a reload never clicks past the profile's count. Counts only. */
export type RepeatableCounter = RunState['repeatableCounters'][string];
