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
 *   and nothing on it is written ("never loop on the same step more than twice"). A step's index is its place among
 *   the steps filled, in the order first filled, so Back and forth never counts a step twice, and the MAX_STEPS guard
 *   counts distinct steps (the Phase 5 review, C-S8). At review, a step change to a step the run may no longer fill
 *   (its attempts used, or past the guard) is ignored: nothing scanned, stored or reported (X-S5).
 * - Auto-advance (off by default) presses the adapter's Next only when the setting is on, the step is declared not
 *   final, Next is visible, nothing on the step is flagged, blocked or unresolved, no draft is unconfirmed, no error
 *   shows, no CAPTCHA widget on it is unsolved (as far as can be known: an Arkose widget never is), the step has
 *   settled and it has had fewer than two attempts (autoAdvanceVerdict). A final step goes to
 *   review (the person presses Submit), and a step whose finality is unknown is treated as final: nothing is pressed
 *   ("I can't tell whether this is the last step, so I won't press anything"). Auto-advance
 *   never presses the final Submit: no event leads from a final or unknown step to press-next (Submit mode Auto's
 *   press-submit, below, is its own effect, off by default). The validation that follows the
 *   person's own Next (STEP_UNCHANGED) never presses: lastFill is cleared, so a press needs a fill of the step since
 *   their click (X-S2). press-next itself may find auto-advance turned off since: NEXT_WITHHELD, Next is the person's
 *   (C-S2).
 * - Submit mode Auto (v3 Phase 4, docs/SPEC-AMENDMENTS.md §12 Decision 6; off by default): a final step validated
 *   clean goes to review with press-submit after it, when autoSubmitVerdict passes: Submit visible, the step filled,
 *   settled, no draft waiting for its confirmation, no CAPTCHA not known solved, and the skip rules the person keeps
 *   (RunContext.autoSubmit: a required field still empty, a posting that forbids AI, a legal answer that was an AI
 *   guess). Otherwise it rests at review, its notice saying why (submit-held-*). The content script makes the press
 *   (src/content/press.ts, assertNotSubmit's Submit exception); a confirmation seen after it is SUBMITTED. An unknown
 *   step is never submitted, nor a step whose finality only the person's own Next could tell.
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
 *   itself: it offers Continue, and done is never resumed. Fill anyway at a card the new document only showed again
 *   (POLICY_ACCEPTED, scanned false) scans the step first: its raw scan, tripwire and canaries come before any write
 *   (C-S4).
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
/** A resting run follows at most this many step changes in a row that fill nothing (a page flipping its progress
 *  line, a step already at its limit, Back and forth over finished steps); then it stops watching the step, and the
 *  person's Fill or Continue starts the next run (the Phase 5 review, X-S5). The content script counts them: the
 *  watching is its own. */
export const MAX_IDLE_TRANSITIONS = 8;

/** A wall that needs the person's sign-in, a new account or (v3 Phase 7b) their email at an email gate (auth-needed). */
export type AuthWall = 'sign-in' | 'create-account' | 'email-gate';

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
  /** The step shows a CAPTCHA widget not known to be solved (dom/pause-detect.ts unsolvedCaptchas): a token-bearing
   *  one whose token is empty, or one whose vendor holds none (Arkose). Next is then the person's. */
  captchaUnsolved: boolean;
  /** v3 Phase 4, for Submit mode Auto: the adapter's Submit is there, visible and enabled (absent: no). */
  submitVisible?: boolean;
  /** Required fields the step leaves empty for the person (absent: 0). */
  requiredEmpty?: number;
  /** The run fills from the profile only because the posting forbids AI (absent: no). */
  noAi?: boolean;
  /** A legal question's answer on the step was an AI guess (absent: no). */
  legalGuess?: boolean;
  /** An attention check on the step is left for the person (the Phase 7a review: a check only they can answer, such as
   *  the posting's phrase, or one the AI did not answer; absent: no). Submit mode Auto always holds for it. */
  attentionLeft?: boolean;
  /** Profile entries (education, experience) the step's repeatable sections still lack, for the person to add (the
   *  Phase 7a review; absent: 0). Submit mode Auto always holds for them. */
  entriesLeft?: number;
  /** The snapshot build of 2026-11-06 (core-x, item 2): the required boxes of the form's account section (iCIMS's
   *  "Create a login") still empty, for the person (or Sign-in Auto) to fill (absent: 0). Auto-advance holds Next for
   *  them, as for any required field left for the person ('account-left'); the content script counts them among the
   *  required fields Submit mode Auto's rule reads (requiredEmpty). */
  accountLeft?: number;
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
  /** The person's Fill anyway at the policy card. `scanned`: this document scanned the step (its raw scan, tripwire,
   *  canaries and signature); false after a reload at the card, whose new document only showed it again. */
  | { type: 'POLICY_ACCEPTED'; scanned: boolean }
  /** The person's Cancel at the policy card. */
  | { type: 'POLICY_DECLINED' }
  /** The step's fill ended (its repeatable sections, then the reactive loop): the keys written, and the counts of the
   *  step's rows as they stand after it, as RunState.lastFill holds them (report.ts lastFillOf). */
  | { type: 'FILLED'; filledKeys: readonly FieldKey[]; flagged: number; blocked: number; unresolved: number }
  /** The step was validated: the errors it shows, how many of them a fix pass could address, and the step's facts. */
  | { type: 'VALIDATED'; errors: number; fixable: number; step: StepFacts }
  /** Next was pressed: by the extension (press-next's click), or by the person before the extension would have. */
  | { type: 'ADVANCED'; by: 'extension' | 'person' }
  /** press-next found, right before its click, that Next is the person's: their auto-advance setting is off now (they
   *  turned it off since the validation), or the step shows a CAPTCHA not known to be solved. Nothing was pressed. */
  | { type: 'NEXT_WITHHELD'; reason: 'setting-off' | 'captcha-unsolved' }
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
  'step-retry-limit', 'final-unknown', 'max-steps', 'captcha-next',
  // v3 Phase 4: Submit mode Auto held the final Submit back, and why (its notice says so; the person submits).
  'submit-held-required', 'submit-held-no-ai', 'submit-held-guess', 'submit-held-captcha', 'submit-held-check',
  // The Phase 7a review: an attention check left for the person held it, or entries still to add.
  'submit-held-attention', 'submit-held-entries',
  // The snapshot build of 2026-11-06 (core-x, item 2): the form's account section is the person's, so Next is theirs.
  'account-left'] as const;
export type StepNotice = (typeof STEP_NOTICES)[number];

/** Why a run is at review. 'final-step': the adapter says the step is the last (Submit is the person's);
 *  'final-unknown': it cannot tell, so it is treated as final; 'step-retry-limit': the step had its two attempts; 'max-steps': more
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
  /** Watch the step's signature until it differs from `from` and the page is quiet (then TRANSITIONED, or
   *  STEP_UNCHANGED when the person's Next leaves errors instead). `capMs` null: no timer, the person clicks; a number:
   *  TIMED_OUT at the cap. A signature that already differs when the watch starts is a transition at once. */
  | { type: 'await-transition'; from: string; capMs: number | null }
  /** Show the pause and wait for the person: 'auth' and 'handoff' for Continue, 'policy' for the policy card. */
  | { type: 'pause'; kind: 'auth' | 'handoff' | 'policy' }
  | { type: 'notify'; notice: StepNotice; count?: number }
  /** v3 Phase 4, Submit mode Auto: the one untrusted click on the adapter's Submit, through assertNotSubmit's Submit
   *  exception (src/content/press.ts), on a final step autoSubmitVerdict passed. It produces no event: the platform's
   *  confirmation, seen after it, is SUBMITTED. */
  | { type: 'press-submit' }
  /** The run is at review: the launcher counts what needs the person; `reason` is ERROR's (null otherwise). */
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
  /** The person's Autofill after page turn (settings modes.afterPageTurn 'auto'; absent: true). False: a reload never
   *  fills a step by itself, it offers Continue (the runtime leaves a new step to Continue the same way). */
  fillAfterPageTurn?: boolean;
  /** v3 Phase 4: Submit mode Auto, with the skip rules it reads (settings modes.agentSkip); absent or null: Manual, the
   *  person submits. Never in a dry run. */
  autoSubmit?: SubmitSkipRules | null;
}

/** The skip rules Submit mode Auto reads (settings modes.agentSkip): which of these leave the Submit to the person. */
export interface SubmitSkipRules {
  requiredEmpty: boolean;
  noAi: boolean;
  legalGuess: boolean;
}

/** Why Submit mode Auto would not press Submit, in the order they are checked (v3 Phase 4). */
export const SUBMIT_REFUSALS = ['setting-off', 'not-final', 'no-submit', 'errors', 'not-filled', 'required-empty',
  'no-ai', 'legal-guess', 'attention-left', 'entries-left', 'unconfirmed-draft', 'captcha-unsolved',
  'not-settled'] as const;
export type SubmitRefusal = (typeof SUBMIT_REFUSALS)[number];
export type SubmitVerdict = { submit: true } | { submit: false; refusal: SubmitRefusal };

/** The notice that says why Submit mode Auto held a Submit back. */
export function noticeOfSubmitRefusal(refusal: Exclude<SubmitRefusal, 'setting-off' | 'not-final'>): StepNotice {
  switch (refusal) {
    case 'required-empty':
      return 'submit-held-required';
    case 'no-ai':
      return 'submit-held-no-ai';
    case 'legal-guess':
      return 'submit-held-guess';
    case 'attention-left':
      return 'submit-held-attention';
    case 'entries-left':
      return 'submit-held-entries';
    case 'captcha-unsolved':
      return 'submit-held-captcha';
    default:
      return 'submit-held-check';
  }
}

export interface RunStep {
  state: RunState;
  effects: RunEffect[];
}

/** Why auto-advance would not press Next, in the order they are checked. 'captcha-unsolved': the step shows a CAPTCHA
 *  widget not known to be solved (the Phase 5 review, X-S4 tightened by the coordinator). */
export const ADVANCE_REFUSALS = ['setting-off', 'final', 'final-unknown', 'no-next', 'errors', 'not-filled',
  // core-x, item 2: a required box of the form's account section is still empty (StepFacts.accountLeft): checked before
  // the rows, which never show it, so its notice says why Next is the person's whatever else the step left.
  'account-left',
  'flagged', 'blocked', 'unresolved', 'unconfirmed-draft', 'captcha-unsolved', 'not-settled', 'attempts'] as const;
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
    case 'forgot-password':
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
 * draft, no CAPTCHA not known solved, the step settled, and fewer than MAX_STEP_ATTEMPTS attempts. The first rule that fails is the refusal.
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
  // core-x, item 2: the form's account section still has a required box empty (it is no row: never filled from the
  // profile), so Next is the person's, as for any required field left for them.
  if ((step.accountLeft ?? 0) > 0) return refuse('account-left');
  if (fill.flagged > 0) return refuse('flagged');
  if (fill.blocked > 0) return refuse('blocked');
  if (fill.unresolved > 0) return refuse('unresolved');
  if (step.unconfirmedDrafts > 0) return refuse('unconfirmed-draft');
  if (step.captchaUnsolved) return refuse('captcha-unsolved');
  if (!step.settled) return refuse('not-settled');
  if (attemptsOf(state) >= MAX_STEP_ATTEMPTS) return refuse('attempts');
  return { advance: true };
}

/**
 * Whether Submit mode Auto may press Submit on the final step being validated (v3 Phase 4): the mode on, the step
 * declared final, Submit visible, no error, the step filled, then the skip rules the person keeps (a required field
 * still empty, a posting that forbids AI, a legal answer that was an AI guess), no draft waiting for confirmation, no
 * CAPTCHA not known solved, and the step settled. The first rule that fails is the refusal.
 */
export function autoSubmitVerdict(state: RunState, check: { errors: number; step: StepFacts },
  ctx: Pick<RunContext, 'autoSubmit'>): SubmitVerdict {
  const refuse = (refusal: SubmitRefusal): SubmitVerdict => ({ submit: false, refusal });
  const { step } = check;
  const rules = ctx.autoSubmit ?? null;
  if (rules === null) return refuse('setting-off');
  if (step.finality !== 'final') return refuse('not-final');
  if (step.submitVisible !== true) return refuse('no-submit');
  if (check.errors > 0) return refuse('errors');
  if (state.lastFill === null) return refuse('not-filled');
  if (rules.requiredEmpty && (step.requiredEmpty ?? 0) > 0) return refuse('required-empty');
  if (rules.noAi && step.noAi === true) return refuse('no-ai');
  if (rules.legalGuess && step.legalGuess === true) return refuse('legal-guess');
  // An attention check left for the person always holds it, whatever the skip rules (the Phase 7a review).
  if (step.attentionLeft === true) return refuse('attention-left');
  if ((step.entriesLeft ?? 0) > 0) return refuse('entries-left');
  if (step.unconfirmedDrafts > 0) return refuse('unconfirmed-draft');
  if (step.captchaUnsolved) return refuse('captcha-unsolved');
  if (!step.settled) return refuse('not-settled');
  return { submit: true };
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
const notify = (notice: StepNotice, count?: number): RunEffect =>
  (count === undefined ? { type: 'notify', notice } : { type: 'notify', notice, count });
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
      if (status !== 'policy-notice') return null;
      // A document that only showed the card again (a reload at it) has read nothing of the step: no raw scan, no
      // tripwire, no canary. It scans first, and the scan's gate takes the decision (the Phase 5 review, C-S4).
      return event.scanned ? startFill(state, { policyDecision: 'accepted' }, [], false)
        : move(enter(state, 'scan-step', { policyDecision: 'accepted' }), [{ type: 'scan' }]);
    case 'POLICY_DECLINED':
      return status === 'policy-notice' ? move(enter(state, 'stopped', { policyDecision: 'declined' })) : null;
    case 'FILLED':
      return status === 'fill-step' ? filled(state, event) : null;
    case 'VALIDATED':
      return status === 'validate' ? validated(state, event, ctx) : null;
    case 'ADVANCED':
      return advanced(state, event.by, ctx);
    case 'NEXT_WITHHELD':
      return status === 'advance' ? awaitTransition(state, null,
        event.reason === 'captcha-unsolved' ? [notify('captcha-next')] : []) : null;
    case 'TRANSITIONED':
      if (!MAY_TRANSITION.has(status) || !isStepSignature(event.signature) || event.signature === state.stepSignature) {
        return null;
      }
      // At review, a step the run may no longer fill is no reason to scan, store or report (the Phase 5 review, X-S5).
      return status === 'review' && atLimit(state, event.signature) ? null : rescan(state);
    case 'STEP_UNCHANGED':
      // The person's Next left the step as it was: what the fill left is no longer what Next would press on, so the
      // validation that follows never presses it (lastFill null: not-filled). A fix pass fills it again (X-S2).
      return status === 'wait-transition'
        ? move(enter(state, 'validate', { lastFill: null }), [{ type: 'validate' }]) : null;
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

/** The step's scan: the step's place, then the attempt limit, the step guard and the policy gate, then the fill. */
function scanned(state: RunState, event: Extract<RunEvent, { type: 'SCANNED' }>): Outcome {
  const signature = event.signature;
  if (!isStepSignature(signature)) return move(enter(state, 'review'), [review('error', 'internal-error')]);
  const known = Object.hasOwn(state.stepAttempts, signature);
  const attempts = known ? state.stepAttempts[signature]! : 0;
  const hits = whole(event.tripwireHits);
  const canaries = event.canaries.filter((canary) => canary.length <= CANARY_MAX_LENGTH);
  const seen: Partial<RunState> = {
    stepSignature: signature,
    stepIndex: positionOf(state, signature),
    canarySet: mergeCanaries(canaries, state.canarySet),
    // A step's hits count once, at its first scan; a reload's scan of the same step finds the same text again.
    tripwire: { triggered: state.tripwire.triggered || hits > 0, hits: state.tripwire.hits + (known ? 0 : hits) },
  };
  const notices = hits > 0 ? [notify('tripwire')] : [];
  if (attempts >= MAX_STEP_ATTEMPTS) {
    return move(enter(state, 'review', seen),
      [...notices, notify('step-retry-limit'), review('step-retry-limit')]);
  }
  // The step guard counts distinct steps: Back and forth over the same steps never trips it (the Phase 5 review, C-S8).
  if (!known && Object.keys(state.stepAttempts).length >= MAX_STEPS) {
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
    // Submit mode Auto (v3 Phase 4): the press follows the review, or the notice says why the person submits.
    const verdict = autoSubmitVerdict(state, { errors, step: event.step }, ctx);
    if (verdict.submit) return move(enter(state, 'review'), [review('final-step'), { type: 'press-submit' }]);
    if (verdict.refusal === 'setting-off' || verdict.refusal === 'not-final') {
      return move(enter(state, 'review'), [review('final-step')]);
    }
    const count = verdict.refusal === 'required-empty' ? event.step.requiredEmpty : undefined;
    return move(enter(state, 'review'), [notify(noticeOfSubmitRefusal(verdict.refusal), count), review('final-step')]);
  }
  if (finality !== 'not-final') {
    return move(enter(state, 'review'), [...(ctx.autoAdvance ? [notify('final-unknown')] : []),
      review('final-unknown')]);
  }
  const verdict = autoAdvanceVerdict(state, { errors, step: event.step }, ctx);
  if (verdict.advance) return move(enter(state, 'advance'), [{ type: 'press-next' }]);
  // A CAPTCHA not known solved is the one refusal the person would not expect: the notice says to press Next. So is an
  // account section left for them (core-x, item 2), which shows no row.
  const why = verdict.refusal === 'captcha-unsolved' ? [notify('captcha-next')]
    : verdict.refusal === 'account-left' ? [notify('account-left')] : [];
  return awaitTransition(state, null, why);
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
  // Review is the person's turn: a reload never fills that step again by itself; nor any step, with Autofill after page
  // turn: Manually (v3 Phase 3).
  if (status === 'review' || ctx.fillAfterPageTurn === false || ctx.now - state.updatedAt > RESUME_AUTO_MS) {
    return quiet([{ type: 'offer-continue' }]);
  }
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

/** A step's place among the steps the run has filled, in the order it first filled them (stepAttempts keeps that
 *  order: a signature is never an array index); a step not filled yet comes after them. Back and forth keeps each
 *  step's place (the Phase 5 review, C-S8). */
function positionOf(state: RunState, signature: string): number {
  const order = Object.keys(state.stepAttempts);
  const at = order.indexOf(signature);
  return at >= 0 ? at : order.length;
}

/** A step the run may no longer fill: it had its attempts, or it would pass the step guard. */
function atLimit(state: RunState, signature: string): boolean {
  if (Object.hasOwn(state.stepAttempts, signature)) return state.stepAttempts[signature]! >= MAX_STEP_ATTEMPTS;
  return Object.keys(state.stepAttempts).length >= MAX_STEPS;
}

function expired(state: RunState, now: number): boolean {
  return state.updatedAt + RUN_STATE_TTL_MS <= now;
}

/** A count or a time as RunStateSchema takes it: a whole number, never negative (NaN is 0). */
function whole(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
