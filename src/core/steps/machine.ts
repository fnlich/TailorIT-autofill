/*
 * The multi-step state machine (Requirement C; docs/design/core.md §10.2; docs/ARCHITECTURE.md "Orchestrator";
 * docs/design/runtime.md §8.4-8.9). reduceRun runs in the content script: it takes the run's RunState and one event and
 * answers the next RunState and the effects the content script carries out, in order. The content script does all the
 * DOM work (the scan, the fill, the validation, the one click on Next, the waits, the pauses) and reports back with
 * events; the reducer decides. It is pure: the time comes in as ctx.now, and nothing here waits.
 *
 *   detect → (auth-needed) → scan-step → fill-step → validate → advance → wait-transition → … → review → done
 *
 * - Every event the status takes sets updatedAt to ctx.now and asks first for the RunState to be stored (persist), so
 *   a reload finds what was decided before anything was done; a change of status, pause or step also asks for a
 *   report. An event the status does not take is ignored: the same state, no effects.
 * - Step attempts are counted in RunState.stepAttempts by signature, across reloads: one when a step's fill starts,
 *   one more for a validation fix pass. A step scanned again after two attempts goes to review with step-retry-limit
 *   and nothing on it is written ("never loop on the same step more than twice").
 * - Auto-advance (off by default) presses the adapter's Next only when the setting is on, the step is declared not
 *   final, Next is visible, nothing on the step is flagged, blocked or unresolved, no draft is unconfirmed, no error
 *   shows, the step has settled and it has had fewer than two attempts (autoAdvanceVerdict). A final step goes to
 *   review with Submit highlighted, and a step whose finality is unknown is treated as final: nothing is pressed, Next
 *   and Submit are highlighted ("I can't tell whether this is the last step, so I won't press anything"). The final
 *   Submit is never pressed: no event leads from a final or unknown step to press-next.
 * - After the extension's click the transition is awaited at most TRANSITION_CAP_MS: at the cap an unchanged step
 *   pauses with needs-click, a changed but still busy page with page-busy. When the person is the one to press Next
 *   (auto-advance off, or a check failed), the wait has no timer.
 * - Validation errors are fixed in one more pass where the plan can (and the step has an attempt left), then surfaced
 *   at review; a run never pauses on them.
 * - Pauses: sign-in and account creation are auth-needed; a CAPTCHA, an email code, a bot check, Workday's entry
 *   choice, a page busy at the settle cap and a click the site needs are handoff with that pauseReason. Nothing is
 *   automated: only the person's trusted Continue (CONTINUE, or RESUMED by the person) leaves them, to scan the step
 *   again. resumeStatus records where the pause came from.
 * - After a reload (resumeMode): automatic in the same tab within RESUME_AUTO_MS of updatedAt, otherwise the person's
 *   Continue; never in another tab, and never once RunState has expired (RUN_STATE_TTL_MS). A paused run shows its
 *   pause again. A run at review (a final, unknown or limited step: the person's turn) is never filled again by
 *   itself: it offers Continue, and done is never resumed.
 * - RunState holds no value: signatures are hashes, filled keys are stored with their section and label slug hashed
 *   (storedFieldKey, as the reveal edges are), counters are numbers, and the canaries are the page's, which the worker
 *   checks against the profile before storing. The reducer never adds a field RunState does not declare.
 */
import { CANARY_MAX_LENGTH, mergeCanaries } from '../guard/canary';
import { sha256Hex } from '../text/sha256';
import type { Platform } from '../enums';
import type { FieldKey } from '../types/field';
import type { ReasonCode } from '../types/fill';
import {
  MAX_STEP_ATTEMPTS, MAX_STEPS, REPEATABLE_KINDS, RESUME_AUTO_MS, RUN_STATE_TTL_MS, type PauseReason,
  type RepeatableCounter, type RepeatableKind, type RunState, type RunStatus, type StepFinality,
} from '../types/run';
import { isStepSignature } from './signature';

export { MAX_STEP_ATTEMPTS, MAX_STEPS } from '../types/run';

/** After the extension's own click on Next, the next step is awaited at most this long (the adapter may raise it:
 *  RunContext.transitionCapMs). The content script runs the timer; the core only names the cap. */
export const TRANSITION_CAP_MS = 20_000;
/** RunState.filledFieldKeys keeps at most this many keys per step, the first written. A stored key is about 63
 *  characters, so MAX_STEPS such steps weigh about 100 KB, inside the RunState store's accounted worst case
 *  (background/runstate-store.ts MAX_RUN_STATE_BYTES); RunStateSchema would take 500. The keys are a hint, so a step
 *  with more loses nothing but the hint for the rest. */
export const MAX_FILLED_KEYS_PER_STEP = 50;

/** A wall that needs the person's sign-in or a new account (auth-needed). */
export type AuthWall = 'sign-in' | 'create-account';

/** What validation and auto-advance read of the step, as the content script found it at validation. */
export interface StepFacts {
  /** The adapter's isFinalStep; 'unknown' is treated as final. */
  finality: StepFinality;
  /** The adapter's Next button is there, visible and enabled. */
  nextVisible: boolean;
  /** The step's last settle() was quiet (not stopped at its cap). */
  settled: boolean;
  /** Drafts on the step the person has not confirmed. */
  unconfirmedDrafts: number;
}

/** What the content script tells the machine. Counts, keys and hashes only: no event carries a value. */
export type RunEvent =
  /** The application's form was found (detect → scan-step). */
  | { type: 'DETECTED' }
  /** The address is no application after all (detect → stopped). */
  | { type: 'NOT_AN_APPLICATION' }
  /** A sign-in or account-creation wall: the person must act (auth-needed). */
  | { type: 'AUTH'; wall: AuthWall }
  /** Anything else that needs the person (handoff): a CAPTCHA, an email code, a bot check, Workday's entry choice, a
   *  page still busy at the settle cap, a click the site needs (the Next click refused or ignored). */
  | { type: 'PAUSE'; reason: PauseReason }
  /** The person's trusted Continue on a paused run. */
  | { type: 'CONTINUE' }
  /** The step was scanned: its signature (stepSignature), the policy statements and tripwire hits found on it, and its
   *  canaries, nearest their hit first (the worker drops any that equals a profile value when it stores RunState). */
  | { type: 'SCANNED'; signature: string; policyHits: number; tripwireHits: number; canaries: readonly string[] }
  /** The person's Fill anyway at the policy card. */
  | { type: 'POLICY_ACCEPTED' }
  /** The person's Cancel at the policy card. */
  | { type: 'POLICY_DECLINED' }
  /** The step's fill ended (its repeatable sections, then the reactive loop): the keys written, and the counts of the
   *  step's rows as they stand after it, as RunState.lastFill holds them (report.ts lastFillOf). */
  | { type: 'FILLED'; filledKeys: readonly FieldKey[]; flagged: number; blocked: number; unresolved: number }
  /** The step was validated: the errors it shows, how many of them a fix pass could address, and the step's facts. */
  | { type: 'VALIDATED'; errors: number; fixable: number; step: StepFacts }
  /** Next was pressed: by the extension (press-next's click), or by the person before the extension would have. */
  | { type: 'ADVANCED'; by: 'extension' | 'person' }
  /** The step's signature changed and the page is quiet (a step the person or the page moved to). */
  | { type: 'TRANSITIONED'; signature: string }
  /** The person's Next left the step as it was (errors showed instead): validate it again. */
  | { type: 'STEP_UNCHANGED' }
  /** TRANSITION_CAP_MS passed after the extension's click; `signature` is the step's at that moment. */
  | { type: 'TIMED_OUT'; signature: string }
  /** The platform's confirmation page: the person submitted. */
  | { type: 'SUBMITTED' }
  /** A new document found this tab's RunState (`load`, the content script's own start), or the person chose
   *  Continue on it (`person`, a trusted click). `sameTab`: the worker's tab index names this tab. */
  | { type: 'RESUMED'; by: 'load' | 'person'; sameTab: boolean }
  /** A repeatable section's counters on the current step (planRepeatable's), stored before each Add click. */
  | { type: 'REPEATABLE'; kind: RepeatableKind; counter: RepeatableCounter }
  /** The person's Cancel. */
  | { type: 'USER_STOPPED' }
  /** Something failed: the run goes to review with the reason. */
  | { type: 'ERROR'; reason: ReasonCode };
export type RunEventType = RunEvent['type'];

/** The notices a transition asks for, each one of NOTICE_CODES (src/shared/report.ts). 'final-unknown' ("I can't tell
 *  whether this is the last step, so I won't press anything.") is asked for only with auto-advance on, the one time it
 *  explains something nobody would expect; 'max-steps' when a wizard has more steps than MAX_STEPS. */
export const STEP_NOTICES = ['tripwire', 'policy', 'auth', 'captcha', 'page-busy', 'needs-click', 'validation',
  'step-retry-limit', 'final-unknown', 'max-steps'] as const;
export type StepNotice = (typeof STEP_NOTICES)[number];

/** Why a run is at review. 'final-step': the adapter says the step is the last (Submit highlighted); 'final-unknown':
 *  it cannot tell, so it is treated as final; 'step-retry-limit': the step had its two attempts; 'max-steps': more
 *  than MAX_STEPS steps (a runaway wizard); 'validation-errors': errors the plan cannot fix; 'error': ERROR's reason. */
export const REVIEW_CAUSES = ['final-step', 'final-unknown', 'step-retry-limit', 'max-steps', 'validation-errors',
  'error'] as const;
export type ReviewCause = (typeof REVIEW_CAUSES)[number];

/** What the content script does, in order. It does all the DOM work; each of these ends in the event named. */
export type RunEffect =
  /** Store RunState (runstate/put). Always first. */
  | { type: 'persist' }
  /** Send the frame's report: the status, pause or step changed. */
  | { type: 'report' }
  /** Scan the step: its signature, pause signs, policy text and tripwires (then SCANNED, AUTH or PAUSE). */
  | { type: 'scan' }
  /** Fill the step: repeatable sections first, then the reactive loop (then FILLED, or PAUSE). `attempt` is this
   *  step's count after this one; `fix` marks validation's fix pass. */
  | { type: 'fill-step'; attempt: number; fix: boolean }
  /** Read the step's errors and facts (then VALIDATED). */
  | { type: 'validate' }
  /** The one untrusted click on the adapter's Next, through assertNotSubmit's Next exception (then ADVANCED, or PAUSE
   *  needs-click when the click is refused or Next is gone). Never Submit. */
  | { type: 'press-next' }
  | { type: 'highlight-next' }
  | { type: 'highlight-submit' }
  /** Watch the step's signature until it differs from `from` and the page is quiet (then TRANSITIONED, or
   *  STEP_UNCHANGED when the person's Next leaves errors instead). `capMs` null: no timer, the person clicks; a number:
   *  TIMED_OUT at the cap. A signature that already differs when the watch starts is a transition at once. */
  | { type: 'await-transition'; from: string; capMs: number | null }
  /** Show the pause and wait for the person: 'auth' and 'handoff' for Continue, 'policy' for the policy card. */
  | { type: 'pause'; kind: 'auth' | 'handoff' | 'policy' }
  | { type: 'notify'; notice: StepNotice }
  /** The run is at review: highlight what needs the person; `reason` is ERROR's (null otherwise). */
  | { type: 'show-review'; cause: ReviewCause; reason: ReasonCode | null }
  /** A reload found an active run too old to resume by itself: offer Continue (then RESUMED by the person). */
  | { type: 'offer-continue' };
export type RunEffectType = RunEffect['type'];

/** What the reducer reads besides the state and the event. */
export interface RunContext {
  /** The person's auto-advance setting, as it is now. */
  autoAdvance: boolean;
  /** The time (ms since the epoch), the content script's clock. */
  now: number;
  /** The adapter's longer transition cap (quirks.transitionCapMs); TRANSITION_CAP_MS otherwise. */
  transitionCapMs?: number;
}

export interface RunStep {
  state: RunState;
  effects: RunEffect[];
}

/** Why auto-advance would not press Next, in the order they are checked. */
export const ADVANCE_REFUSALS = ['setting-off', 'final', 'final-unknown', 'no-next', 'errors', 'not-filled',
  'flagged', 'blocked', 'unresolved', 'unconfirmed-draft', 'not-settled', 'attempts'] as const;
export type AdvanceRefusal = (typeof ADVANCE_REFUSALS)[number];
export type AdvanceVerdict = { advance: true } | { advance: false; refusal: AdvanceRefusal };

/** How a run found after a reload goes on: by itself, at the person's Continue, or not at all. */
export type ResumeMode = 'auto' | 'continue' | 'none';

/** Statuses in which the extension is working on a step: a pause may interrupt them. */
const WORKING: ReadonlySet<RunStatus> = new Set<RunStatus>(['detect', 'scan-step', 'fill-step', 'validate', 'advance',
  'wait-transition']);
/** Statuses that wait for the person's own decision. */
const PAUSED: ReadonlySet<RunStatus> = new Set<RunStatus>(['auth-needed', 'handoff', 'policy-notice']);
/** Statuses a run never leaves. */
const FINISHED: ReadonlySet<RunStatus> = new Set<RunStatus>(['done', 'stopped']);
/** Statuses after a step's fill in which the step may change under the run (the person's Next, the page). */
const MAY_TRANSITION: ReadonlySet<RunStatus> = new Set<RunStatus>(['fill-step', 'validate', 'advance',
  'wait-transition', 'review']);
const KINDS: ReadonlySet<string> = new Set<string>(REPEATABLE_KINDS);

/** A RunState for a new run on an application: status detect, nothing counted. */
export function createRunState(input: { applicationKey: string; platform: Platform; now: number }): RunState {
  const now = whole(input.now);
  return {
    version: 1, applicationKey: input.applicationKey, platform: input.platform, status: 'detect',
    resumeStatus: null, pauseReason: null, stepSignature: null, stepIndex: 0, stepAttempts: {}, filledFieldKeys: {},
    repeatableCounters: {}, canarySet: [], tripwire: { triggered: false, hits: 0 }, policyDecision: null,
    revealEdges: [], aiTasks: {}, lastFill: null, startedAt: now, updatedAt: now,
  };
}

/**
 * A field key as RunState.filledFieldKeys stores it: its section and its label slug, both page text that may echo a
 * value the page shows back, each replaced by the first 16 hex of its SHA-256 (as loop/bookkeeping.ts storedBaseKey
 * does for the reveal edges); the platform, option-set hash and ordinal stay. A key of another shape is hashed whole.
 * The stored keys are a hint: a resumed step's fields are verified again, never skipped for being listed.
 */
export function storedFieldKey(key: FieldKey): FieldKey {
  const parts = key.split('|');
  if (parts.length !== 5) return sha256Hex(key).slice(0, 16) as FieldKey;
  return [parts[0], sha256Hex(parts[1]!).slice(0, 16), sha256Hex(parts[2]!).slice(0, 16), parts[3], parts[4]]
    .join('|') as FieldKey;
}

/** The repeatableCounters key of a section kind on a step. */
export function repeatableCounterKey(signature: string, kind: RepeatableKind): string {
  return `${signature}:${kind}`;
}

/** The notice a pause reason shows (the words the content script's pauses already use, orchestrator.ts pauseOf). */
export function noticeOfPause(reason: PauseReason): StepNotice {
  switch (reason) {
    case 'captcha':
    case 'bot-check':
      return 'captcha';
    case 'email-code':
    case 'entry-choice':
      return 'auth';
    case 'page-busy':
      return 'page-busy';
    case 'needs-click':
      return 'needs-click';
  }
}

/**
 * How a RunState found after a reload goes on. None: there is none, it belongs to another tab, it has expired or the
 * run is finished. Continue: it is paused (the person must act), at review (the person's turn: never filled again by
 * itself), or more than RESUME_AUTO_MS have passed since its last update. Otherwise it resumes by itself at the step it
 * was on (its attempts counted).
 */
export function resumeMode(state: RunState | null, input: { now: number; sameTab: boolean }): ResumeMode {
  if (state === null || !input.sameTab || expired(state, input.now) || FINISHED.has(state.status)) return 'none';
  if (PAUSED.has(state.status) || state.status === 'review' || input.now - state.updatedAt > RESUME_AUTO_MS) {
    return 'continue';
  }
  return 'auto';
}

/**
 * Whether auto-advance may press Next on the step being validated: the setting on, the step declared not final, Next
 * visible, no error, the step filled with nothing flagged, blocked or unresolved (RunState.lastFill), no unconfirmed
 * draft, the step settled, and fewer than MAX_STEP_ATTEMPTS attempts. The first rule that fails is the refusal.
 */
export function autoAdvanceVerdict(state: RunState, check: { errors: number; step: StepFacts },
  ctx: Pick<RunContext, 'autoAdvance'>): AdvanceVerdict {
  const refuse = (refusal: AdvanceRefusal): AdvanceVerdict => ({ advance: false, refusal });
  const { step } = check;
  if (!ctx.autoAdvance) return refuse('setting-off');
  if (step.finality === 'final') return refuse('final');
  if (step.finality !== 'not-final') return refuse('final-unknown');
  if (!step.nextVisible) return refuse('no-next');
  if (check.errors > 0) return refuse('errors');
  const fill = state.lastFill;
  if (fill === null) return refuse('not-filled');
  if (fill.flagged > 0) return refuse('flagged');
  if (fill.blocked > 0) return refuse('blocked');
  if (fill.unresolved > 0) return refuse('unresolved');
  if (step.unconfirmedDrafts > 0) return refuse('unconfirmed-draft');
  if (!step.settled) return refuse('not-settled');
  if (attemptsOf(state) >= MAX_STEP_ATTEMPTS) return refuse('attempts');
  return { advance: true };
}

/** The machine: the next RunState and what the content script does, in order (module header). */
export function reduceRun(state: RunState, event: RunEvent, ctx: RunContext): RunStep {
  const outcome = transition(state, event, ctx);
  if (outcome === null) return { state, effects: [] };
  // Only a new document's RESUMED is quiet: nothing changes, so nothing is stored, but its frame reports what it shows.
  if (outcome.kind === 'quiet') return { state, effects: [{ type: 'report' }, ...outcome.effects] };
  const next: RunState = { ...outcome.state, updatedAt: whole(ctx.now) };
  // A resumed run reports whatever it changed: its frame is a new document, or the person just chose Continue.
  const changed = next.status !== state.status || next.pauseReason !== state.pauseReason
    || next.stepIndex !== state.stepIndex || next.stepSignature !== state.stepSignature || event.type === 'RESUMED';
  const effects: RunEffect[] = [{ type: 'persist' }];
  if (changed && !outcome.silent) effects.push({ type: 'report' });
  effects.push(...outcome.effects);
  return { state: next, effects };
}

// ── The transitions ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A transition: a new state with its effects (`silent`: no report), or effects alone (`quiet`: nothing changes, so
 *  nothing is stored either). */
type Outcome =
  | { kind: 'move'; state: RunState; effects: RunEffect[]; silent?: boolean }
  | { kind: 'quiet'; effects: RunEffect[] };

const move = (state: RunState, effects: RunEffect[] = [], silent = false): Outcome =>
  ({ kind: 'move', state, effects, silent });
const quiet = (effects: RunEffect[]): Outcome => ({ kind: 'quiet', effects });
const notify = (notice: StepNotice): RunEffect => ({ type: 'notify', notice });
const review = (cause: ReviewCause, reason: ReasonCode | null = null): RunEffect =>
  ({ type: 'show-review', cause, reason });

/** `state` at `status`, out of any pause unless `patch` says otherwise. */
function enter(state: RunState, status: RunStatus, patch: Partial<RunState> = {}): RunState {
  return { ...state, resumeStatus: null, pauseReason: null, ...patch, status };
}

function transition(state: RunState, event: RunEvent, ctx: RunContext): Outcome | null {
  const { status } = state;
  if (FINISHED.has(status)) return null;
  switch (event.type) {
    case 'DETECTED':
      return status === 'detect' ? move(enter(state, 'scan-step'), [{ type: 'scan' }]) : null;
    case 'NOT_AN_APPLICATION':
      return status === 'detect' ? move(enter(state, 'stopped')) : null;
    case 'AUTH':
      return auth(state);
    case 'PAUSE':
      return pause(state, event.reason);
    case 'CONTINUE':
      return status === 'auth-needed' || status === 'handoff' ? rescan(state) : null;
    case 'SCANNED':
      return status === 'scan-step' ? scanned(state, event) : null;
    case 'POLICY_ACCEPTED':
      return status === 'policy-notice' ? startFill(state, { policyDecision: 'accepted' }, [], false) : null;
    case 'POLICY_DECLINED':
      return status === 'policy-notice' ? move(enter(state, 'stopped', { policyDecision: 'declined' })) : null;
    case 'FILLED':
      return status === 'fill-step' ? filled(state, event) : null;
    case 'VALIDATED':
      return status === 'validate' ? validated(state, event, ctx) : null;
    case 'ADVANCED':
      return advanced(state, event.by, ctx);
    case 'TRANSITIONED':
      return MAY_TRANSITION.has(status) && isStepSignature(event.signature) && event.signature !== state.stepSignature
        ? rescan(state) : null;
    case 'STEP_UNCHANGED':
      return status === 'wait-transition' ? move(enter(state, 'validate'), [{ type: 'validate' }]) : null;
    case 'TIMED_OUT':
      return status === 'wait-transition'
        ? pause(state, event.signature === state.stepSignature ? 'needs-click' : 'page-busy') : null;
    case 'SUBMITTED':
      return move(enter(state, 'done'));
    case 'RESUMED':
      return resumed(state, event, ctx);
    case 'REPEATABLE':
      return repeatable(state, event.kind, event.counter);
    case 'USER_STOPPED':
      return move(enter(state, 'stopped'));
    case 'ERROR':
      return move(enter(state, 'review'), [review('error', event.reason)]);
  }
}

/** Scan the step again: after the person's Continue, a resume, or a transition. */
function rescan(state: RunState): Outcome {
  return move(enter(state, 'scan-step'), [{ type: 'scan' }]);
}

/** A sign-in or account wall: auth-needed, remembering where it came from (a handoff keeps its own origin). */
function auth(state: RunState): Outcome | null {
  if (!WORKING.has(state.status) && state.status !== 'handoff') return null;
  const from = state.status === 'handoff' ? state.resumeStatus : state.status;
  return move(enter(state, 'auth-needed', { resumeStatus: from }), [{ type: 'pause', kind: 'auth' }, notify('auth')]);
}

/** A pause that hands the run to the person: handoff with the reason. A run already handed off takes the newer
 *  reason and keeps where it came from. */
function pause(state: RunState, reason: PauseReason): Outcome | null {
  if (state.status === 'handoff') {
    if (state.pauseReason === reason) return null;
    return move({ ...state, pauseReason: reason }, [{ type: 'pause', kind: 'handoff' }, notify(noticeOfPause(reason))]);
  }
  if (!WORKING.has(state.status)) return null;
  return move(enter(state, 'handoff', { resumeStatus: state.status, pauseReason: reason }),
    [{ type: 'pause', kind: 'handoff' }, notify(noticeOfPause(reason))]);
}

/** The step's scan: a new step is counted, then the attempt limit, the step guard and the policy gate, then the fill. */
function scanned(state: RunState, event: Extract<RunEvent, { type: 'SCANNED' }>): Outcome {
  const signature = event.signature;
  if (!isStepSignature(signature)) return move(enter(state, 'review'), [review('error', 'internal-error')]);
  const isNew = state.stepSignature !== null && state.stepSignature !== signature;
  const known = Object.hasOwn(state.stepAttempts, signature);
  const attempts = known ? state.stepAttempts[signature]! : 0;
  const hits = whole(event.tripwireHits);
  const canaries = event.canaries.filter((canary) => canary.length <= CANARY_MAX_LENGTH);
  const seen: Partial<RunState> = {
    stepSignature: signature,
    stepIndex: state.stepIndex + (isNew ? 1 : 0),
    canarySet: mergeCanaries(canaries, state.canarySet),
    // A step's hits count once, at its first scan; a reload's scan of the same step finds the same text again.
    tripwire: { triggered: state.tripwire.triggered || hits > 0, hits: state.tripwire.hits + (known ? 0 : hits) },
  };
  const notices = hits > 0 ? [notify('tripwire')] : [];
  if (attempts >= MAX_STEP_ATTEMPTS) {
    return move(enter(state, 'review', seen),
      [...notices, notify('step-retry-limit'), review('step-retry-limit')]);
  }
  const stepIndex = seen.stepIndex!;
  if (stepIndex >= MAX_STEPS || (!known && Object.keys(state.stepAttempts).length >= MAX_STEPS)) {
    return move(enter(state, 'review', seen), [...notices, notify('max-steps'), review('max-steps')]);
  }
  if (whole(event.policyHits) > 0 && state.policyDecision === null) {
    return move(enter(state, 'policy-notice', seen), [...notices, { type: 'pause', kind: 'policy' }, notify('policy')]);
  }
  return startFill({ ...state, ...seen }, {}, notices, false);
}

/** The step's fill starts: one attempt more, counted before anything is written. */
function startFill(state: RunState, patch: Partial<RunState>, before: RunEffect[], fix: boolean): Outcome {
  const signature = state.stepSignature;
  if (signature === null) return move(enter(state, 'review'), [review('error', 'internal-error')]);
  const attempt = (state.stepAttempts[signature] ?? 0) + 1;
  // lastFill describes the step being filled: a new attempt starts without one, a fix pass replaces it when it ends.
  const next = enter(state, 'fill-step', { ...patch, stepAttempts: { ...state.stepAttempts, [signature]: attempt },
    lastFill: fix ? state.lastFill : null });
  return move(next, [...before, { type: 'fill-step', attempt, fix }]);
}

/** The fill's keys (stored form, each once, capped) and counts are recorded, then the step is validated. */
function filled(state: RunState, event: Extract<RunEvent, { type: 'FILLED' }>): Outcome {
  const signature = state.stepSignature;
  if (signature === null) return move(enter(state, 'review'), [review('error', 'internal-error')]);
  const keys = [...new Set([...(state.filledFieldKeys[signature] ?? []), ...event.filledKeys.map(storedFieldKey)])]
    .slice(0, MAX_FILLED_KEYS_PER_STEP);
  return move(enter(state, 'validate', {
    filledFieldKeys: { ...state.filledFieldKeys, [signature]: keys },
    lastFill: { flagged: whole(event.flagged), blocked: whole(event.blocked), unresolved: whole(event.unresolved) },
  }), [{ type: 'validate' }]);
}

/** Validation: a fix pass where it can help, review for a final step or what remains, else Next. */
function validated(state: RunState, event: Extract<RunEvent, { type: 'VALIDATED' }>, ctx: RunContext): Outcome {
  const errors = whole(event.errors);
  const fixable = whole(event.fixable);
  if (errors > 0) {
    if (fixable > 0 && attemptsOf(state) < MAX_STEP_ATTEMPTS) return startFill(state, {}, [], true);
    // Errors are surfaced, never paused on. Fixable ones left because the step had its two attempts say so.
    return fixable > 0
      ? move(enter(state, 'review'), [notify('validation'), notify('step-retry-limit'), review('step-retry-limit')])
      : move(enter(state, 'review'), [notify('validation'), review('validation-errors')]);
  }
  const { finality } = event.step;
  if (finality === 'final') {
    return move(enter(state, 'review'), [{ type: 'highlight-submit' }, review('final-step')]);
  }
  if (finality !== 'not-final') {
    return move(enter(state, 'review'), [{ type: 'highlight-next' }, { type: 'highlight-submit' },
      ...(ctx.autoAdvance ? [notify('final-unknown')] : []), review('final-unknown')]);
  }
  if (autoAdvanceVerdict(state, { errors, step: event.step }, ctx).advance) {
    return move(enter(state, 'advance'), [{ type: 'press-next' }]);
  }
  return awaitTransition(state, null, [{ type: 'highlight-next' }]);
}

/** Next was pressed: the extension's click is awaited with its cap, the person's without a timer. */
function advanced(state: RunState, by: 'extension' | 'person', ctx: RunContext): Outcome | null {
  if (state.status === 'advance') {
    return awaitTransition(state, by === 'extension' ? ctx.transitionCapMs ?? TRANSITION_CAP_MS : null);
  }
  if (state.status === 'validate' && by === 'person') return awaitTransition(state, null);
  return null;
}

function awaitTransition(state: RunState, capMs: number | null, before: RunEffect[] = []): Outcome {
  const from = state.stepSignature;
  if (from === null) return move(enter(state, 'review'), [review('error', 'internal-error')]);
  return move(enter(state, 'wait-transition'), [...before, { type: 'await-transition', from, capMs }]);
}

/** A run found after a reload, or the person's Continue on one (resumeMode's rules, checked again here). */
function resumed(state: RunState, event: Extract<RunEvent, { type: 'RESUMED' }>, ctx: RunContext): Outcome | null {
  if (!event.sameTab || expired(state, ctx.now)) return null;
  const { status } = state;
  if (status === 'policy-notice') return quiet([{ type: 'pause', kind: 'policy' }, notify('policy')]);
  if (event.by === 'person') return rescan(state);
  if (status === 'auth-needed') return quiet([{ type: 'pause', kind: 'auth' }, notify('auth')]);
  if (status === 'handoff') {
    return quiet([{ type: 'pause', kind: 'handoff' }, notify(noticeOfPause(state.pauseReason ?? 'needs-click'))]);
  }
  // Review is the person's turn: a reload never fills that step again by itself.
  if (status === 'review' || ctx.now - state.updatedAt > RESUME_AUTO_MS) return quiet([{ type: 'offer-continue' }]);
  return rescan(state);
}

/** A repeatable section's counters on the step being filled: stored, nothing else changes. */
function repeatable(state: RunState, kind: RepeatableKind, counter: RepeatableCounter): Outcome | null {
  const signature = state.stepSignature;
  if (state.status !== 'fill-step' || signature === null || !KINDS.has(kind)) return null;
  const stored = { profile: whole(counter.profile), rendered: whole(counter.rendered),
    addClicks: whole(counter.addClicks) };
  return move({ ...state, repeatableCounters: { ...state.repeatableCounters,
    [repeatableCounterKey(signature, kind)]: stored } }, [], true);
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The current step's attempts so far. */
function attemptsOf(state: RunState): number {
  return state.stepSignature === null ? MAX_STEP_ATTEMPTS : state.stepAttempts[state.stepSignature] ?? 0;
}

function expired(state: RunState, now: number): boolean {
  return state.updatedAt + RUN_STATE_TTL_MS <= now;
}

/** A count or a time as RunStateSchema takes it: a whole number, never negative (NaN is 0). */
function whole(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
