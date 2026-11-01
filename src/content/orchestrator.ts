/*
 * A run in one frame (docs/design/runtime.md §8.2 to §8.9; docs/ARCHITECTURE.md "Orchestrator"; docs/SPEC.md
 * Requirement C): the multi-step machine (core/steps/machine.ts reduceRun) driven over the page. The core decides; this
 * file carries out each effect it answers, in order, and feeds it the events the page and the adapter give:
 *
 *   detect → (auth-needed) → scan-step → fill-step → validate → advance → wait-transition → … → review → done
 *
 * 1. run/begin {applicationKey, trigger, dryRun} answers the run id, the settings (auto-advance among them) and the
 *    policy states. In a frame inside another page, the run goes on only while the frame's launcher can be seen there
 *    (IntersectionObserver v2, ui/visible.ts): otherwise it fills nothing, reports the form-hidden notice and ends
 *    stopped (S1). The top frame is never checked.
 * 2. The machine starts from the run's RunState (createRunState and DETECTED for a fresh run; the runtime hands a
 *    paused or reloaded run its state and CONTINUE or RESUMED). Every transition stores RunState first (persist:
 *    runstate/put, never for a dry run), so a reload finds what was decided before anything was done.
 * 3. persist: RunState as report.ts persistedRunState gives it (the canaries a plan's answer allowed, never a value).
 *    report: the frame's report is due; it goes out when the run comes to rest (a review, a wait for the person's Next,
 *    a pause, the policy card, the end), so the side panel sees the statuses a person can act on.
 * 4. scan: the step as it is now. The policy gate (the posting page's and the stored copy's states at the first scan,
 *    this frame's visible text at every scan: a hit stops at policy-notice, Fill anyway or Cancel), the raw scan and
 *    the tripwire (every canary in memory for the frame's own scans; the 32 nearest to plan/request and RunState),
 *    detectPause (sign-in and account: AUTH; email code, entry choice, CAPTCHA: PAUSE; nothing on the step is filled),
 *    and the step's signature from the adapter's parts (SCANNED). A new step's notices start afresh.
 * 5. fill-step: repeatable sections first (repeatables.ts: the worker's entry counts from a plan of nothing, then one
 *    Add click at a time through assertNotSubmit, each counted in RunState before it is made: REPEATABLE), then the
 *    reactive loop (loop.ts), "I currently work here" (planCurrentJob's rows), the final Guard (verify.ts), the rows
 *    and the notices (FILLED); nothing is drawn over the page's fields (the owner's decision of 2026-11-01). A page still busy at a settle's cap pauses (page-busy); a pause or a
 *    hidden frame a later pass found cuts the loop (the Phase 3 review, L-S2 and L-S4): the pause, or the run ends
 *    stopped; a policy statement a later pass revealed shows the card (Cancel: stopped, policy-declined; Fill anyway:
 *    this run ends and a fresh one starts from its RunState, whose gate takes that decision).
 * 6. validate: a pause the step shows now (detectPause, the whole document: AUTH or PAUSE, never a click), then the
 *    adapter's errors (fixable: those on a field no pass planned, or one the page emptied after our write, never one
 *    the person emptied: one more pass where the step has an attempt left), its finality ('unknown' without the hook:
 *    treated as final), Next's visibility, the settle, unconfirmed drafts (VALIDATED). Errors are surfaced at review,
 *    never paused on.
 * 7. press-next: the one untrusted click() on the adapter's Next, through clickIfAllowed(…, {allowNext: true}), only
 *    when the reducer says so (auto-advance on, a step declared not final and clean); never Submit, which
 *    assertNotSubmit always refuses. Right before it, with nothing awaited between the checks and the click: a frame
 *    inside another page is still seen there (else a pause, the next-hidden notice), the step is the one validated,
 *    no pause shows (detectPause: AUTH or PAUSE), auto-advance is still on and no CAPTCHA on the step is unsolved
 *    (else NEXT_WITHHELD: Next is the person's). A refused or missing Next pauses with needs-click (the Phase 5
 *    review, C-S1, C-S2, X-S4, X-S8).
 * 8. await-transition (transition.ts): the step's signature watched until it changes and the page is quiet, capped
 *    after our own click (TIMED_OUT), with no cap when the person advances: the run then rests ('waiting'), its report
 *    sent, and the person's Next moves it on (TRANSITIONED, or STEP_UNCHANGED when errors showed instead).
 * 9. notify, show-review, pause, offer-continue: the in-page UI (notices, the launcher, the card). At review the run
 *    rests and still watches the step (an adapter that tells steps apart): the person's own Next after fixing what
 *    the review showed is a transition. A step change the machine ignores (a step at its limit) moves the watch on to
 *    what the page shows, and after MAX_IDLE_TRANSITIONS step changes in a row that filled nothing the run stops
 *    watching (the Phase 5 review, X-S5). A pause ends the run; Continue (the runtime) starts the next from its state,
 *    with what this one carries (RunCarry): the value hasher, each step's loop books, and the CAPTCHA the person was
 *    handed at a CAPTCHA pause, which does not pause that step again (X-S4). Cancel at a pause stops it for good
 *    (USER_STOPPED, stored and reported: C-S6).
 * Auto-advance is the run/begin answer's, then each settings/changed the worker pushes (settingsChanged: C-S2).
 * A run that fails (RunFailure) gives the machine ERROR before it rests, so RunState is at review and a reload offers
 * Continue rather than filling by itself (C-S7).
 * An 'expired' answer to run/begin, plan/request or report/put begins the run again, once; a second one ends the run in
 * the launcher's error state. plan/poll (Phase 4) never renews. The run ends for invalidation only on the platform's
 * word (channel.ts). Nothing here sends, stores or logs a value: RunState holds keys, hashes, counters and checked
 * canaries; rows hold labels and statuses.
 *
 * Phase 6 (wave 2): drafts, the person's fixes, and their answers.
 * - With drafts on (settings.llm.drafts), the top frame's plan/request carries the posting as the person sees it: the
 *   document's visible text outside the form root (postingText). An embedded frame sends none, and neither does a dry
 *   run, which asks for no draft (the Phase 6 review, E12). plan/request also carries the loop's reveal edges, so a box
 *   an EEO, legal or sensitive question revealed gets no draft (E2).
 * - A draft (an llm-draft write, guarded like any write, marked "AI" in the review) waits for the person: confirmDraft (the
 *   side panel's draft/confirm, or the in-page panel's Confirm draft) reads the field again first: it must still hold
 *   the draft as written (its value MAC; else the row is changed-by-you) and no canary (else canary-in-value), and only
 *   then is its row verified, the person's choice (E6). Their own edit makes the text theirs (changed-by-you), unless
 *   the text still equals the draft (E3: a page re-inserting it is no edit). Either way guardReady and the step's
 *   validation no longer count it as unconfirmed, on this attempt and on the step's later ones.
 * - The drafts written in a document outlive the run (E4): RunEnv.drafts keeps each one's base key and value MAC under
 *   the document's one hasher, so a later run (Fill again, Continue, Fill anyway) rows a field that still holds that
 *   text as an unconfirmed llm-draft, dashed, with Confirm draft. RunState.drafts keeps their stored base keys (keys
 *   only, never a value or its hash), so a run resumed after a reload rows a field there that holds text it did not
 *   write as an unconfirmed draft too.
 * - The person's trusted edit of a field the run left flagged (touches.ts editedSince during the fill; personInput at
 *   rest: an input after their own key, pointer, paste or drop on it, E3) sets the row's detail.userEdited, while
 *   settings.offerToSaveAnswers is on and a plan named the field savable (the core's screen: T6-1), and the report goes
 *   out again: the review then offers Save my answer. Their edit at rest of a value we wrote makes it theirs
 *   (changed-by-you), as the next pass would. readAnswer reads a field's answer for answer/read (option labels, a
 *   text, a checked state), refusing one that holds a canary or that no plan named savable; it is passed to the worker
 *   and never kept here.
 * - Before the step is left (our click on Next, or the person's activation at rest: a pointerdown, Enter or Space), the
 *   values we wrote are read again: one whose value MAC is no longer the one the fill left is rowed verify-mismatch and
 *   reported, so the accepted-match cache never takes a match the page or a widget changed at rest (E9).
 *
 * The owner's amendments (docs/SPEC-AMENDMENTS.md):
 * - Drafts are accepted as written (llm-draft-written) unless settings.llm.confirmDrafts keeps the Phase 6
 *   confirmation: an accepted draft reads back as confirmed in the final Guard, is no unconfirmed draft at validation,
 *   and is booked in the document like a waiting one, so a later run rows a field still holding it as the accepted draft
 *   it is. The AI's answers (llm-answer texts, and llm-picks with an answer's reason) are booked the same way, in memory
 *   only. The posting text goes with plan/request while drafts or answers are on.
 * - When a posting forbids AI (the policy gate at the first scan, or a later pass's hit), settings.llm.whenForbidden
 *   decides: 'ask' shows the policy card as before; 'profile-only' (the default) fills on with no card, from the
 *   profile only: every plan/request says noAi, so the worker asks the LLM nothing, the policy-profile-only notice
 *   shows, and Edit with AI is offered nowhere; 'use-ai' fills on with the AI, the policy notice shown. A plan answer
 *   that names an "I did not use AI" attestation in the frame's scan switches the run to profile-only the same way (the
 *   ai-attestation notice), unless the setting is 'use-ai'.
 * - Edit with AI: the plan answers name the text boxes the page may offer it on (`aiEditable`); while the run rests at
 *   review or waits for the person's Next, not in a dry run or a profile-only run and with no pause on the page, the
 *   page UI draws the button in each (ui/ai-edits.ts). rewriteField, on the person's trusted click on a visible button,
 *   reads the field again (still offered, visible, no honeypot, no canary in what it holds), sends draft/rewrite with
 *   the frame's scan, polls plan/poll for its draft, and writes it through writeField (the DOM Guard, then the frame
 *   Guard over every canary in memory). One rewrite at a time. A rewrite the box already holds writes nothing and
 *   leaves the box's row as it was (the AI's draft stays marked as the AI's). The person's later edit makes the text
 *   theirs (changed-by-you), as any draft's.
 */
import type { Adapter } from '../adapters/types';
import type { ApplicationRef } from '../adapters';
import type { z } from 'zod';
import { LLM_ANSWER, LLM_DRAFT } from '../core/confidence';
import { canariesIn, mergeCanaries } from '../core/guard/canary';
import { checkHoneypot } from '../core/guard/honeypot';
import { cutInjected } from '../core/guard/injected';
import { scanTripwires } from '../core/guard/tripwire';
import { baseKeyOf, MAX_REVEAL_EDGES, storedBaseKey } from '../core/loop/bookkeeping';
import { unresolvedRow } from '../core/loop/rows';
import { settleRow } from '../core/plan/settle';
import type { RepeatableAnswer } from '../core/steps/blocks';
import {
  createRunState, MAX_IDLE_TRANSITIONS, reduceRun, repeatableCounterKey, TRANSITION_CAP_MS, type ReviewCause,
  type RunContext, type RunEffect, type RunEvent, type StepFacts, type StepNotice,
} from '../core/steps/machine';
import { stepSignature } from '../core/steps/signature';
import type { BaseKey, FieldKey, FieldSpec } from '../core/types/field';
import type { FillResult, PlannedWrite, ReasonCode } from '../core/types/fill';
import type { ValueMac } from '../core/types/loop';
import { MAX_RUN_STATE_DRAFTS, type RepeatableKind, type RunState, type RunStatus } from '../core/types/run';
import { clickIfAllowed } from '../dom/fillers';
import { captchaElements, detectPause, unsolvedCaptchas, type PauseSignal } from '../dom/pause-detect';
import { rawScan, type RawPassage } from '../dom/raw-scan';
import { isUsableOption } from '../dom/option-hash';
import { newScanCache } from '../dom/scan-cache';
import { scan, toFieldSpec } from '../dom/scan';
import { deadline, monotonicNow } from '../dom/time';
import type { FieldTarget, ScannedField, ScanResult, WidgetReading } from '../dom/types';
import { visibleTextWithout } from '../dom/visible-text';
import { isUserVisible } from '../dom/visibility';
import type { ErrorCode } from '../messaging/envelope';
import { MAX_POSTING_TEXT, type AnswerReadAnswerSchema } from '../messaging/schemas';
import type { ContentPlatform } from '../platform/types';
import { log } from '../shared/log';
import { needsPerson } from '../shared/report';
import type { ContentSettings } from '../shared/settings';
import { Invalidated, type AnsweredType, type AnswerData, type Channel, type MessageOf } from './channel';
import { AI_POLL_MS, AI_WAIT_CAP_MS, runLoop, type LoopCarry, type LoopResult, type OptionsTimings,
  type SettleTimings } from './loop';
import { RunAborted, writeField, type PassEnv, type PlanAnswer } from './pass';
import { frameHitsOf, hiddenPolicyHits, policyGateOf, postingOutsideFrame, type PolicyView } from './policy';
import { addBlocks, currentJobRows, needsClicks, sectionsOf, type SectionView } from './repeatables';
import {
  buildReport, lastFillOf, NoticeBook, persistedRunState, uploadRow, type NoticeCode, type ReportHeader,
  type ReportLimiter,
} from './report';
import { postingNamesOf } from './job-relay';
import type { Heard, HeardType, TouchLog } from './touches';
import { awaitTransition } from './transition';
import type { LauncherView } from './ui/launcher';
import type { AiEditItem } from './ui/ai-edits';
import type { PolicyChoice } from './ui/notices';
import type { PageUi } from './ui/page-ui';
import type { ValueHasher } from './values';
import { finalGuard } from './verify';

/** Why a run could not go on: a refusal from the worker, or a second 'expired'. */
export class RunFailure extends Error {
  constructor(readonly code: ErrorCode) {
    super(`the run failed: ${code}`);
    this.name = 'RunFailure';
  }
}

/** Where a run rests or how it ended: 'review' (the person's turn at review), 'waiting' (for the person's Next), a
 *  pause, stopped, failed, or aborted. */
export const RUN_ENDS = ['review', 'waiting', 'stopped', 'paused', 'error', 'aborted'] as const;
export type RunEnd = (typeof RUN_ENDS)[number];

/** What a run started with. */
export interface RunRequest {
  /** 'resume': the runtime resumed this tab's RunState after a reload (run/begin's trigger). */
  trigger: 'launcher' | 'panel' | 'resume';
  dryRun: boolean;
  /** The person chose Fill anyway at the policy card a run ago, on this page (the card a later pass's hit showed):
   *  this run's gate takes that decision instead of asking again. Set by the runtime only. */
  policyAccepted?: boolean;
  /** Where the machine starts: a RunState and the event that resumes it (CONTINUE after a pause, RESUMED after a
   *  reload or at the person's Continue). Without it a fresh RunState and DETECTED. Set by the runtime only. */
  from?: { state: RunState; event: RunEvent };
  /** What the run before this one in the same document carries over (Continue, or Fill anyway mid-fill). Set by the
   *  runtime only. Memory only. */
  carry?: RunCarry;
}

/** What a run hands the next run in its document (FillRun.carryOut; the Phase 5 review, C-S3 and X-S4). Memory only:
 *  the loop books hold value hashes and what was written. */
export interface RunCarry {
  /** The run's keyed value hasher, so the books' hashes still compare. */
  hasher: ValueHasher | null;
  /** Each step's loop books, by step signature (LoopResult.carry). */
  steps: ReadonlyMap<string, LoopCarry>;
  /** The CAPTCHA frames and containers the person was handed on a step, at their Continue at its CAPTCHA pause. */
  handed: HandedCaptcha | null;
}

/** The CAPTCHA elements a step showed when the run paused on it (captchaElements), and that step's signature. */
export interface HandedCaptcha {
  signature: string;
  elements: ReadonlySet<Element>;
}

/** The page a run fills: its application, adapter and form root, as they were when it started. */
export interface RunPage {
  app: ApplicationRef;
  adapter: Adapter;
  root: Element;
}

/** Overrides of the run's waits, for tests. */
export interface RunOptions {
  /** settle()'s windows and caps. */
  settle?: SettleTimings;
  /** awaitOptions()' window and cap. */
  awaitOptions?: OptionsTimings;
  resume?: { idleMs?: number; releaseAfterMs?: number };
  /** The poll interval and the cap on waiting for the LLM (loop.ts). */
  ai?: { pollMs?: number; capMs?: number };
  /** The cap on the next step after our own click on Next (TRANSITION_CAP_MS, or the adapter's quirk). */
  transition?: { capMs?: number };
}

/** What a run needs from the runtime. */
export interface RunEnv {
  doc: Document;
  content: ContentPlatform;
  channel: Channel;
  limiter: ReportLimiter;
  ui(): PageUi | null;
  /** The frame's id from frame/hello (sent again if it went unanswered), and whether it is the top frame. */
  frame(): Promise<{ frameId: number; isTop: boolean }>;
  /** Whether a person can see this frame's launcher on its page (IntersectionObserver v2; false without a launcher).
   *  `fresh`: from a notification after this call, not what was known before. */
  frameShown(signal: AbortSignal, fresh?: boolean): Promise<boolean>;
  page: RunPage;
  now(): number;
  options: RunOptions;
  /** The run's rows, once it has them: field/describe reads their suggestions. */
  onRows(rows: readonly FillResult[]): void;
  /** Starts a fresh run once this one has ended (Fill anyway at a policy card a later pass showed). */
  fillAgain(request: RunRequest): void;
  /** The adapter's form root is another element now (the page drew its whole form again): the runtime anchors its UI to
   *  it and reads it from now on. */
  rootMoved?(root: Element): void;
  /** The person's trusted input on the document, heard all along (touches.ts): what they typed while a run rested. */
  touches: TouchLog;
  /** The document's keyed value hasher, made once (values.ts): every run of the document hashes under its key, so
   *  their value MACs compare (E4). Memory only. */
  hasher(): Promise<ValueHasher>;
  /** The drafts written in this document and not yet the person's, by base key: the value MAC of each as written,
   *  under the document's hasher (E4), whether it waits for the person's confirmation or was accepted. Every run of the
   *  document reads and keeps it. Memory only. */
  drafts: Map<BaseKey, ValueMac>;
  /** The AI's answers written in this document and not yet the person's (the owner's amendments), by base key: the
   *  value MAC of each as written and the row it had, so a later run rows a field still holding one as that answer.
   *  Memory only; absent: the run keeps its own. */
  answers?: Map<BaseKey, HeldAnswer>;
}

/** An AI answer written in the document (RunEnv.answers): its value MAC as written, and its row's provenance and
 *  reason. */
export interface HeldAnswer {
  mac: ValueMac;
  provenance: 'llm-answer' | 'llm-pick';
  reason: 'llm-answer-written' | 'ai-guess';
}

/** The reasons of a row the AI's answer wrote. */
const ANSWER_REASONS: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['llm-answer-written', 'ai-guess']);

/** A report's counters before anything was scanned for the fill. */
const NO_COUNTERS: ReportHeader['counters'] = { passes: 0, hiddenControlsIgnored: 0, deferredFields: 0 };

/** The notices of one step: a new step's scan forgets them. The run's own (tripwire, policy and the policy states)
 *  stay. */
const STEP_NOTICE_CODES: readonly NoticeCode[] = ['attention-check', 'needs-click', 'deferred-fields', 'validation',
  'page-busy', 'auth', 'captcha', 'step-retry-limit', 'final-unknown', 'max-steps', 'next-hidden', 'captcha-next'];

/** The event a pause signal gives: sign-in and account creation are AUTH, the rest PAUSE with their reason. */
function pauseEventOf(signal: PauseSignal): RunEvent {
  switch (signal.kind) {
    case 'sign-in':
    case 'create-account':
      return { type: 'AUTH', wall: signal.kind };
    case 'email-code':
      return { type: 'PAUSE', reason: 'email-code' };
    case 'entry-choice':
      return { type: 'PAUSE', reason: 'entry-choice' };
    case 'captcha':
      return { type: 'PAUSE', reason: 'captcha' };
  }
}

/** The reason a pause found before a later pass gives what the loop leaves. */
function pauseCutOf(signal: PauseSignal): ReasonCode {
  return signal.kind === 'captcha' ? 'challenge-present' : 'auth-required';
}

/** What cut the loop before a later pass: the frame hidden, a policy statement, or a pause. */
type LoopCut = { kind: 'hidden' } | { kind: 'policy' } | { kind: 'pause'; signal: PauseSignal }
  | { kind: 'moved'; signature: string };

/** A passage's identity: a new one is one the run has not read. */
const passageId = (passage: RawPassage) => `${passage.origin}\u{0}${passage.text}`;

/** answer/read's answer: a field's answer and its option-set hash, or why it cannot be saved (Phase 6). */
export type AnswerRead = z.infer<typeof AnswerReadAnswerSchema>;

/** The kinds that take one option, and those that take several (a saved answer's shape, resolver/saved.ts). */
const ONE_OPTION_KINDS: ReadonlySet<string> = new Set(['select', 'radio', 'combobox']);
const SET_KINDS: ReadonlySet<string> = new Set(['checkbox-group', 'multiselect']);
/** TailorIT's caps on a saved answer (AUTOFILL_SAVED_ANSWER_LIMITS): a text, and its options' labels. */
const SAVED_TEXT_MAX = 5000;
const SAVED_LABEL_MAX = 300;
const SAVED_LABELS_MAX = 50;

/** The elements that are a field's own: its control, its group's members, its proxy. */
function ownElements(target: FieldTarget): Element[] {
  return [target.control, ...target.members, ...(target.proxy === null ? [] : [target.proxy])];
}

/** Whether a field holds an answer at all (not empty, not only its placeholder). */
function holdsAnswer(field: ScannedField): boolean {
  const { current } = field;
  switch (current.kind) {
    case 'text':
      return current.text.trim() !== '';
    case 'checked':
      return true;
    case 'selected':
      return current.labels.some((label) => label.trim() !== '');
    case 'files':
      return current.count > 0;
    default:
      return false;
  }
}

/** A draft the person confirmed: their choice, verified (Phase 6). */
function confirmedDraftRow(row: FillResult): FillResult {
  return { ...row, status: 'verified', reason: 'ok', needsUserAction: false };
}

/** Whether a row is a draft this document holds as written: one waiting for the person, or one accepted. */
function heldDraftRow(row: FillResult): boolean {
  return row.provenance === 'llm-draft' && row.wrote
    && (row.reason === 'llm-draft-needs-confirmation' || row.reason === 'llm-draft-written');
}

/** Whether a row is one the AI's answer wrote (an llm-answer text, or an llm-pick with an answer's reason). */
function aiAnswerRow(row: FillResult): boolean {
  return row.wrote && ANSWER_REASONS.has(row.reason)
    && (row.provenance === 'llm-answer' || row.provenance === 'llm-pick');
}

/** One run. start() runs it until it first comes to rest; accept(), decline() and stop() are the person's choices. */
export class FillRun {
  /** Where the run rests (or how it ended); null while it works. */
  ended: RunEnd | null = null;
  private readonly controller = new AbortController();
  /** Aborted when the person stops the run: a wait for a list's options, or for the next step, ends at once. */
  private readonly stopping = new AbortController();
  private readonly notices = new NoticeBook();
  private choose: ((choice: PolicyChoice) => void) | null = null;
  private stopRequested = false;
  private id: string | null = null;
  private expiredSeen = 0;
  private policy: PolicyView | null = null;
  private frameId = 0;
  private tripwireHits = 0;
  /** The tripwire hits already counted in RunState. */
  private hitsCounted = 0;
  private started: Promise<RunEnd> | null = null;
  private restedOnce: ((how: RunEnd) => void) | null = null;
  private isTop = true;
  private autoAdvance = false;
  /** The machine's state (null until the run has begun). */
  private machine: RunState | null = null;
  /** Every canary this frame holds in memory (at most 1024, nearest their hit first): every write is scanned for them. */
  private inMemory: readonly string[] = [];
  /** The 32 nearest, for plan/request and RunState. */
  private sent: readonly string[] = [];
  /** The canaries a stored RunState carried (page text of earlier steps, checked by the worker). */
  private carried: readonly string[] = [];
  /** The canaries a plan's answer allowed into RunState (and those a stored RunState held). */
  private readonly checked = new Set<string>();
  /** The raw passages read so far, and those with a tripwire hit: a later check reads only what is new. */
  private readonly passagesSeen = new Set<string>();
  /** What this run read of its lazy widgets, by base key (Phase 4): the loop's scans read it, and so do field/focus
   *  and field/describe once the run has rows. Option labels only (page text), in memory. */
  readonly widgetReadings = new Map<BaseKey, WidgetReading>();
  private hitPassages: RawPassage[] = [];
  /** What cut the loop before a later pass. */
  private loopCut: LoopCut | null = null;
  /** The form root now (a step may replace it). */
  private root: Element;
  private scans = 0;
  /** The step's rows and counters, as the report carries them. */
  private rows: readonly FillResult[] = [];
  private counters: ReportHeader['counters'] = NO_COUNTERS;
  private reportDue = false;
  /** The status the report shows instead of the machine's (the policy card a later pass's hit showed). */
  private reportStatus: RunStatus | null = null;
  /** The step's repeatable sections, and the worker's answers for them (counts, entries, current flags). */
  private sections: SectionView[] = [];
  private readonly answers = new Map<RepeatableKind, RepeatableAnswer>();
  /** Sections whose entries are left for the person to add. */
  private addsLeft = 0;
  private settledStep = true;
  private lastErrors = 0;
  /** The policy card at the first scan said only TailorIT's stored copy carried the statement. */
  private fromStoredCopy = false;
  /** The step's progress line as the adapter read it at the last scan ("Step 2 of 4"), for the report; null: none. */
  private stepProgress: string | null = null;
  /** The progress line the latest signature read. */
  private progressRead: string | null = null;
  /** The run handed over: it ended so that a fresh one could start (Fill anyway after a later pass's hit). */
  private halted = false;
  private offered = false;
  /** The run watches for the next step while it rests. */
  private watchingNow = false;
  /** The run's keyed value hasher (made at its first fill, or carried). */
  private hasher: ValueHasher | null;
  /** Each step's loop books in this run, by step signature: its next attempt starts from them (C-S3). */
  private readonly carries: Map<string, LoopCarry>;
  /** The CAPTCHA the person was handed on a step, at their Continue (X-S4): it does not pause that step again. */
  private readonly handed: HandedCaptcha | null;
  /** The CAPTCHA this run paused on, for the Continue that follows. */
  private pausedBy: HandedCaptcha | null = null;
  /** Step changes in a row that filled nothing (X-S5). */
  private idleTransitions = 0;
  /** What the page showed at a step change the machine ignored: a resting run watches from it. */
  private watchFrom: string | null = null;
  /** settings/changed pushes so far, and the last one's auto-advance (C-S2). */
  private pushes = 0;
  private pushedAutoAdvance = false;
  /** Phase 6: whether the person's fixes are marked for Save my answer (settings.offerToSaveAnswers), and the AI
   *  switches (settings.llm: drafts, answers, the draft confirmation, what a posting that forbids AI does): run/begin's,
   *  then each settings/changed. */
  private offerToSave = false;
  private llm: ContentSettings['llm'] | null = null;
  /** The run fills from the profile only (the owner's amendments): its posting forbids AI, or its form holds an "I did
   *  not use AI" attestation. Every plan/request says so; Edit with AI is offered nowhere. */
  private noAi = false;
  /** The planned fields the page may offer Edit with AI on, by base key: each plan answer's `aiEditable`. */
  private readonly aiEditable = new Set<BaseKey>();
  /** The field whose Edit with AI is on its way (one at a time). */
  private rewriting: FieldKey | null = null;
  /** The AI's answers this run keeps when the document keeps none (RunEnv.answers). */
  private readonly ownAnswers = new Map<BaseKey, HeldAnswer>();
  /** The fields the person edited after the run left them flagged (their rows say userEdited), by base key. */
  private readonly edited = new Set<BaseKey>();
  /** The drafts the person confirmed or made their own, by base key: never unconfirmed again in this run. */
  private readonly confirmedDrafts = new Set<BaseKey>();
  /** Each row's field elements at the step's last fill, for the person's edits at rest. */
  private owners = new WeakMap<Element, FieldKey>();
  /** When the step's fill began (monotonicNow): an edit after it may mark a flagged row userEdited. */
  private fillStartedAt = 0;
  /** The planned fields whose answer the person may save, by base key: each plan answer's `savable` (T6-1). */
  private readonly savable = new Set<BaseKey>();
  /** The drafts a stored RunState names (stored base keys): written in an earlier document, never confirmed (E4). */
  private readonly restoredDrafts: ReadonlySet<string>;
  /** A look at what was written before the step is left (E9) is on its way. */
  private looking = false;

  constructor(private readonly env: RunEnv, readonly request: RunRequest) {
    this.root = env.page.root;
    this.hasher = request.carry?.hasher ?? null;
    this.carries = new Map(request.carry?.steps ?? []);
    this.handed = request.carry?.handed ?? null;
    this.restoredDrafts = new Set(request.from?.state.drafts ?? []);
  }

  /** Runs the run; resolves with where it first rests (or how it ended). It may move on later: at review or while it
   *  waits for the person's Next, the step changing starts it working again. */
  start(): Promise<RunEnd> {
    this.started ??= new Promise<RunEnd>((resolve) => {
      this.restedOnce = resolve;
      void this.execute();
    });
    return this.started;
  }

  /** The run's status as the report and RunState carry it. */
  get status(): RunStatus {
    return this.reportStatus ?? this.machine?.status ?? 'detect';
  }

  /** The machine's state, for the run that continues this one (null before it began). */
  get runState(): RunState | null {
    return this.machine;
  }

  /** Whether the run rests and watches for the next step (review, or the person's Next). */
  get watching(): boolean {
    return this.watchingNow;
  }

  /** Whether the run waits at the policy card. */
  get atPolicyCard(): boolean {
    return this.choose !== null;
  }

  /** Fill anyway (the card, or run/policyDecision 'fill'): answers whether the run was waiting for it. */
  accept(): boolean {
    return this.answer('accepted');
  }

  /** Cancel at the card (or run/policyDecision 'cancel', or run/cancel): answers whether the run was waiting for it. */
  decline(): boolean {
    return this.answer('declined');
  }

  /** run/cancel while the run writes or watches: nothing more is written, and the run ends stopped. */
  stop(): void {
    if (this.decline()) return;
    this.stopRequested = true;
    this.stopping.abort();
  }

  /** Ends the run at once: its planned writes are dropped (invalidation, the document leaving, a new document). */
  abort(): void {
    this.controller.abort();
  }

  /** settings/changed: the person saved their settings. Auto-advance is read from them from now on: a validation, and
   *  press-next right before its click, take it as it is (the Phase 5 review, C-S2). */
  settingsChanged(settings: ContentSettings): void {
    this.pushes += 1;
    this.pushedAutoAdvance = settings.autoAdvance;
    this.autoAdvance = settings.autoAdvance;
    this.llm = settings.llm;
    // AI-written answers turned off (or on) at rest: Edit with AI goes (or comes back) at once.
    this.drawAiEdits();
    const offered = this.offerToSave;
    this.offerToSave = settings.offerToSaveAnswers;
    // Turned off: no row offers Save my answer any more.
    if (offered && !this.offerToSave && this.rows.some((row) => row.detail?.userEdited === true)) {
      this.rows = this.rows.map((row) => {
        if (row.detail?.userEdited !== true) return row;
        const { userEdited: _userEdited, ...detail } = row.detail;
        const { detail: _detail, ...rest } = row;
        return Object.keys(detail).length === 0 ? rest : { ...rest, detail };
      });
      this.rowsChanged();
    }
  }

  /**
   * Confirm draft (the side panel's draft/confirm, or the in-page panel's): the draft of this field, written and
   * waiting for the person, is theirs now. The field is read again first (E6): it must still hold the draft as written
   * (its value MAC), else its row is changed-by-you; and no canary the frame knows, else canary-in-value. Answers
   * whether a draft waited and was confirmed.
   */
  async confirmDraft(key: FieldKey): Promise<boolean> {
    const waiting = (candidate: FillResult | undefined): candidate is FillResult => candidate !== undefined
      && candidate.provenance === 'llm-draft' && candidate.wrote && candidate.needsUserAction
      && candidate.status === 'flagged' && candidate.reason === 'llm-draft-needs-confirmation';
    if (this.ended === null || !waiting(this.rows.find((candidate) => candidate.key === key))) return false;
    const baseKey = baseKeyOf(key);
    const written = this.env.drafts.get(baseKey);
    const field = this.fieldNow(key);
    const mac = field === null || written === undefined ? null : await (await this.valueHasher()).mac(field.current);
    const row = this.rows.find((candidate) => candidate.key === key);
    if (this.ended === null || !waiting(row)) return false;
    if (field === null || mac === null || mac !== written) {
      // What the field holds now is no longer the draft as written: never confirmed as one.
      log('draft.confirm-refused', { changed: true });
      this.forgetDraft(baseKey);
      this.replaceRow(unresolvedRow(row, 'changed-by-you'));
      return false;
    }
    const text = field.current.kind === 'text' ? field.current.text : '';
    if (canariesIn([text], this.inMemory).length > 0) {
      log('draft.confirm-refused', { canary: true });
      this.forgetDraft(baseKey);
      this.replaceRow({ ...row, status: 'blocked', reason: 'canary-in-value', provenance: null, wrote: false,
        verification: 'not-applicable', needsUserAction: true });
      return false;
    }
    this.confirmedDrafts.add(baseKey);
    this.forgetDraft(baseKey);
    log('draft.confirmed');
    this.replaceRow(confirmedDraftRow(row));
    return true;
  }

  /** The AI's answers written in this document (RunEnv.answers, else the run's own). */
  private get heldAnswers(): Map<BaseKey, HeldAnswer> {
    return this.env.answers ?? this.ownAnswers;
  }

  /** Whether the page may offer Edit with AI now: the run rests at review or for the person's Next, not in a dry run
   *  or a profile-only run, with AI-written answers on (settings.llm.drafts, as the person last saved them: the Phase E
   *  review, MINOR 8), with no rewrite on its way and no policy card waiting. */
  private get aiEditsOpen(): boolean {
    return (this.ended === 'review' || this.ended === 'waiting') && !this.request.dryRun && !this.noAi
      && this.llm?.drafts !== false && this.choose === null;
  }

  /** The Edit with AI buttons the page shows now (module header): one per offered field found on the step, none while
   *  they may not be offered. */
  private drawAiEdits(): void {
    if (this.controller.signal.aborted) return;
    const ui = this.env.ui();
    if (ui === null) return;
    if (!this.aiEditsOpen || this.aiEditable.size === 0) {
      ui.setAiEdits([]);
      return;
    }
    const fresh = this.scanNow();
    const items: AiEditItem[] = [];
    for (const row of this.rows) {
      if (row.status === 'blocked' || !this.aiEditable.has(baseKeyOf(row.key))) continue;
      const target = fresh.target(row.key);
      if (target === null || target.field.visibility !== 'visible') continue;
      items.push({ key: row.key, elements: [target.control], busy: this.rewriting === row.key });
    }
    ui.setAiEdits(items);
  }

  /**
   * Edit with AI (module header), on the person's trusted click on the button in one field: TailorIT rewrites what the
   * field holds, and the draft is written over it through both Guards. Answers whether a draft was written. Refused
   * (nothing sent) when the button may not be offered now, another rewrite is on its way, a pause shows, or the field
   * is no longer offered, visible and writable, or holds a canary.
   */
  async rewriteField(key: FieldKey): Promise<boolean> {
    const refused = (why: Record<string, boolean>): false => {
      log('content.ai-edit-refused', why);
      return false;
    };
    if (!this.aiEditsOpen || this.rewriting !== null) return refused({ resting: this.aiEditsOpen });
    if (!this.aiEditable.has(baseKeyOf(key))) return refused({ offered: false });
    if (this.pauseNow() !== null) return refused({ pause: true });
    const fresh = this.scanNow();
    const field = fresh.fields.find((candidate) => candidate.key === key)
      ?? fresh.fields.find((candidate) => candidate.baseKey === baseKeyOf(key));
    if (field === undefined || field.visibility !== 'visible' || field.disabled || field.readOnly
      || (field.kind !== 'text' && field.kind !== 'textarea')) return refused({ field: false });
    const spec = toFieldSpec(field);
    if (!checkHoneypot(spec).ok) return refused({ honeypot: true });
    const text = field.current.kind === 'text' ? field.current.text : '';
    if (canariesIn([text], this.inMemory).length > 0) return refused({ canary: true });
    this.rewriting = field.key;
    this.drawAiEdits();
    log('content.ai-edit');
    try {
      const specs = fresh.fields.map(toFieldSpec);
      const postingText = this.isTop ? this.postingText() : '';
      const revealEdges = this.state.revealEdges.slice(0, MAX_REVEAL_EDGES)
        .map(([parent, child]): [BaseKey, BaseKey] => [parent, child]);
      const asked = await this.env.channel.request<'draft/rewrite'>({ v: 1, type: 'draft/rewrite', runId: this.runId,
        fieldKey: field.key, specs, canaries: [...this.sent], ...(postingText === '' ? {} : { postingText }),
        ...(revealEdges.length > 0 ? { revealEdges } : {}) });
      this.alive();
      if (!asked.ok) return refused({ worker: false });
      let answer: PlanAnswer = asked.data;
      const pollMs = this.env.options.ai?.pollMs ?? AI_POLL_MS;
      const capMs = this.env.options.ai?.capMs ?? AI_WAIT_CAP_MS;
      const started = monotonicNow();
      while (!answer.writes.some((write) => write.key === field.key) && answer.awaiting.includes(field.key)) {
        const left = capMs - (monotonicNow() - started);
        if (left <= 0) return refused({ timedOut: true });
        if (await deadline(Math.min(pollMs, left), this.controller.signal) === 'aborted') return false;
        const polled = await this.poll([field.key]);
        if (polled === 'expired' || polled === 'failed') return refused({ worker: false });
        answer = polled;
      }
      const write = (answer.writes as unknown as PlannedWrite[]).find((candidate) => candidate.key === field.key);
      const planned = (answer.results as unknown as FillResult[]).find((candidate) => candidate.key === field.key);
      // No draft (TailorIT refused or failed): what the field holds stays, and so does its row.
      if (write === undefined || planned === undefined || write.origin.provenance !== 'llm-draft') {
        return refused({ drafted: false });
      }
      if (!this.aiEditsOpen || this.stopRequested) return refused({ resting: false });
      const now = this.scanNow();
      const target = now.fields.find((candidate) => candidate.key === field.key);
      if (target === undefined) return refused({ field: false });
      const written = await writeField(this.passEnv(), now, target, write, planned, new WeakMap());
      this.alive();
      if (written.written === undefined) {
        log('content.ai-edit-refused', { written: false });
        // A rewrite the box holds already changes nothing: the box's row stays (the AI's draft, or the person's text),
        // not the planner's already-correct skip, which carries no provenance.
        if (written.row.reason !== 'already-correct') this.replaceRow(written.row);
        return false;
      }
      // The draft as written is booked, so the person's later edit makes it theirs (E3, E4).
      const after = this.scanNow().fields.find((candidate) => candidate.key === field.key);
      const mac = after === undefined ? undefined : await (await this.valueHasher()).mac(after.current);
      this.alive();
      if (mac !== undefined && heldDraftRow(written.row)) this.env.drafts.set(field.baseKey, mac);
      this.confirmedDrafts.delete(field.baseKey);
      this.storeDrafts();
      this.replaceRow(written.row);
      return true;
    } catch (failure) {
      if (failure instanceof RunAborted || failure instanceof Invalidated) return false;
      return refused({ failed: true });
    } finally {
      this.rewriting = null;
      this.drawAiEdits();
    }
  }

  /** What a single write at rest needs (Edit with AI), as the fill loop's writes have it. */
  private passEnv(): PassEnv {
    const { env } = this;
    const rootNow = () => this.rootNow();
    return {
      content: env.content, adapter: env.page.adapter, platform: env.page.app.platform,
      // The form root the adapter finds at each read: a form drawn again is found again.
      get root() {
        return rootNow();
      },
      frameId: this.frameId, dryRun: this.request.dryRun, canaries: this.inMemory, signal: this.controller.signal,
      valid: () => env.channel.valid(), stopped: () => this.stopRequested, runId: () => this.runId,
      heldBy: () => {
        const signal = this.pauseNow();
        return signal === null ? (this.movedOn() !== null ? 'field-disappeared' : null) : pauseCutOf(signal);
      },
      ...(env.options.resume ? { resume: env.options.resume } : {}),
    };
  }

  /** The run fills from the profile only from now on (module header): the notice says why, and Edit with AI goes. The
   *  fill loop gives up what still waits for the AI as ai-off-for-posting, and writes no AI answer that came in
   *  (LoopEnv.aiOff); every later plan/request says noAi, and the worker, marking the run, asks the AI nothing more. */
  private profileOnly(why: 'posting' | 'attestation'): void {
    if (!this.noAi) log('content.profile-only', { posting: why === 'posting', attestation: why === 'attestation' });
    this.noAi = true;
    this.notices.add(why === 'posting' ? 'policy-profile-only' : 'ai-attestation');
    this.showNotices();
    this.drawAiEdits();
  }

  /** A field of the step as a fresh scan reads it now, by its key or its base key; null when it is not there. */
  private fieldNow(key: FieldKey): ScannedField | null {
    const fresh = this.scanNow();
    return fresh.fields.find((candidate) => candidate.key === key)
      ?? fresh.fields.find((candidate) => candidate.baseKey === baseKeyOf(key)) ?? null;
  }

  /** The run's hasher: the one it carries, else the document's (E4). */
  private async valueHasher(): Promise<ValueHasher> {
    this.hasher ??= await this.env.hasher();
    return this.hasher;
  }

  /** A draft is no longer one waiting for the person (confirmed, or made theirs): the document and the stored RunState
   *  forget it (E4). */
  private forgetDraft(baseKey: BaseKey): void {
    if (!this.env.drafts.delete(baseKey)) return;
    this.storeDrafts();
  }

  /** The document's waiting drafts into the machine's state, stored at once while the run rests (E4): keys only. */
  private storeDrafts(): void {
    if (this.machine === null || this.request.dryRun) return;
    const drafts = [...this.env.drafts.keys()].map(storedBaseKey).slice(0, MAX_RUN_STATE_DRAFTS);
    const before = this.machine.drafts ?? [];
    if (before.length === drafts.length && before.every((key, at) => key === drafts[at])) return;
    this.machine = { ...this.machine, drafts };
    if (this.ended !== null) void this.persist().catch(() => undefined);
  }

  /**
   * The person's trusted input on the page while the run rests (touches.ts): their edit (an input after their own key,
   * pointer, paste or drop on it: E3) of a field the run left makes a draft or a value we wrote theirs (changed-by-you)
   * and marks a field the run left flagged, that a plan named savable, as edited by them (detail.userEdited, while the
   * setting is on), and the report goes out again. A draft whose text still equals the draft as written stays an
   * unconfirmed draft (its value MAC: a page re-inserting it is no edit). Their activation (a pointerdown, Enter or
   * Space) first reads again what the run wrote (E9). Elements only, and a value's MAC; no value is kept.
   */
  personInput(type: HeardType, path: readonly Element[], heard: Heard): void {
    if (this.ended === null || this.request.dryRun || this.rows.length === 0) return;
    if (heard.activation) this.lookBeforeLeaving();
    if (type !== 'input' || !heard.edit) return;
    let key: FieldKey | undefined;
    for (const el of path) {
      key = this.owners.get(el);
      if (key !== undefined) break;
    }
    const row = key === undefined ? undefined : this.rows.find((candidate) => candidate.key === key);
    if (row === undefined || row.status === 'blocked') return;
    if (row.wrote && row.provenance === 'llm-draft' && this.env.drafts.has(baseKeyOf(row.key))) {
      void this.draftEdited(row.key).catch(() => undefined);
      return;
    }
    if (aiAnswerRow(row)) this.heldAnswers.delete(baseKeyOf(row.key));
    this.edit(row);
  }

  /** The person's edit of a draft that waits (E3): theirs only once its text is no longer the draft as written. */
  private async draftEdited(key: FieldKey): Promise<void> {
    const baseKey = baseKeyOf(key);
    const field = this.fieldNow(key);
    const written = this.env.drafts.get(baseKey);
    const mac = field === null || written === undefined ? null : await (await this.valueHasher()).mac(field.current);
    const row = this.rows.find((candidate) => candidate.key === key);
    if (this.ended === null || row === undefined || row.provenance !== 'llm-draft' || !row.wrote) return;
    if (mac !== null && mac === written) return;
    this.edit(row);
  }

  /** The person's edit of a row's field, at rest: our value or our draft is theirs now (changed-by-you), and a field
   *  the run left flagged, that a plan named savable, says userEdited while the setting is on. */
  private edit(row: FillResult): void {
    const baseKey = baseKeyOf(row.key);
    const flagged = row.status === 'flagged';
    let next = row;
    if (row.wrote) {
      // Our value, or our draft, which the person changed: theirs now.
      if (row.provenance === 'llm-draft') {
        this.confirmedDrafts.add(baseKey);
        this.forgetDraft(baseKey);
      }
      next = unresolvedRow(row, 'changed-by-you');
    }
    // Only a field the run left flagged: a value of ours the person changed is theirs, but no fix of a flagged field.
    if (flagged && row.reason !== 'changed-by-you' && this.offerToSave && row.kind !== 'file'
      && row.detail?.userEdited !== true && this.savable.has(baseKey)) {
      this.edited.add(baseKey);
      next = { ...next, detail: { ...next.detail, userEdited: true } };
    }
    if (next === row) return;
    log('content.person-edited', { flagged, wrote: row.wrote });
    this.replaceRow(next);
  }

  /**
   * Before the step is left (E9): what the run wrote on it is read again, at once (a pointerdown comes before the
   * click it starts), and a written row whose value MAC is no longer the one the fill left is rowed verify-mismatch and
   * reported, so the accepted-match cache never takes a match the page or a widget changed at rest. Drafts are the
   * person's to confirm, and never cached: they are left alone. One look at a time.
   */
  private lookBeforeLeaving(): Promise<boolean> {
    if (this.looking || this.request.dryRun || this.hasher === null) return Promise.resolve(false);
    const signature = this.machine?.stepSignature ?? null;
    const carry = signature === null ? undefined : this.carries.get(signature);
    const ours = (carry?.fields ?? []).filter((tracked) => tracked.wrote && tracked.valueMac !== null);
    if (ours.length === 0) return Promise.resolve(false);
    const fresh = this.scanNow();
    const books = new Map(ours.map((tracked) => [tracked.baseKey, tracked.valueMac] as const));
    const fields = fresh.fields.filter((field) => books.has(field.baseKey));
    const hasher = this.hasher;
    this.looking = true;
    return (async () => {
      try {
        const macs = await hasher.macsOf(fields);
        const changed = this.rows.flatMap((row) => {
          const baseKey = baseKeyOf(row.key);
          if (!row.wrote || row.verification !== 'verified' || row.provenance === 'llm-draft' || !books.has(baseKey)) {
            return [];
          }
          const mac = macs.get(baseKey);
          return mac !== undefined && mac === books.get(baseKey) ? [] : [settleRow(row, { kind: 'mismatch' })];
        });
        if (changed.length === 0) return false;
        log('content.changed-at-rest', { fields: changed.length });
        this.replaceRows(changed);
        return true;
      } finally {
        this.looking = false;
      }
    })();
  }

  /**
   * answer/read (Phase 6): the answer a field holds now, as Save my answer sends it to TailorIT: its options' clean
   * labels (never their places), its text, or its box's state, with its observed option-set hash. Null when the field
   * is not on the page; refused when no plan named it savable (T6-1), there is nothing to save, a list whose options
   * were never read, or a value holding a canary. Memory only: never kept, never logged.
   */
  readAnswer(key: FieldKey): AnswerRead | null {
    const field = this.fieldNow(key);
    if (field === null) return null;
    // A field no plan named savable (the core's screen, T6-1) is never read for TailorIT.
    if (!this.savable.has(field.baseKey)) return { refused: 'sensitive' };
    const unsupported: AnswerRead = { refused: 'unsupported' };
    let answer: Extract<AnswerRead, { answer: unknown }>['answer'];
    if (field.kind === 'text' || field.kind === 'textarea') {
      const text = field.current.kind === 'text' ? field.current.text : '';
      if (text.trim() === '' || [...text].length > SAVED_TEXT_MAX) return unsupported;
      answer = { kind: 'text', text };
    } else if (field.kind === 'checkbox') {
      if (field.current.kind !== 'checked') return unsupported;
      answer = { kind: 'checked', checked: field.current.checked };
    } else if (ONE_OPTION_KINDS.has(field.kind) || SET_KINDS.has(field.kind)) {
      if (field.optionSetHash === 'lazy' || field.options === 'lazy') return unsupported;
      const shown = field.options.filter((option) => option.selected).map((option) => option.label);
      const raw = shown.length > 0 ? shown : field.current.kind === 'selected' ? field.current.labels : [];
      const labels = [...new Set(raw.map((label) => cutInjected(label).clean.trim())
        .filter((label) => label !== '' && isUsableOption(label)))];
      const fits = ONE_OPTION_KINDS.has(field.kind) ? labels.length === 1 : labels.length > 0;
      if (!fits || labels.length > SAVED_LABELS_MAX || labels.some((label) => [...label].length > SAVED_LABEL_MAX)) {
        return unsupported;
      }
      answer = { kind: 'options', labels };
    } else {
      return unsupported;
    }
    const texts = answer.kind === 'text' ? [answer.text] : answer.kind === 'options' ? answer.labels : [];
    if (canariesIn(texts, this.inMemory).length > 0) return { refused: 'canary' };
    return { optionSetHash: field.optionSetHash === 'none' ? 'none' : field.optionSetHash, answer };
  }

  /** One row changed at rest: the rows, the launcher's count, and the report again. */
  private replaceRow(next: FillResult): void {
    this.replaceRows([next]);
  }

  /** Some rows changed at rest, at once: the rows, the Edit with AI buttons, the launcher's count, and one report. */
  private replaceRows(changed: readonly FillResult[]): void {
    if (changed.length === 0) return;
    const byKey = new Map(changed.map((row) => [row.key, row] as const));
    this.rows = this.rows.map((row) => byKey.get(row.key) ?? row);
    this.drawAiEdits();
    this.rowsChanged();
  }

  /** The rows changed while the run rests: the runtime's copy, the launcher's count, and the report. */
  private rowsChanged(): void {
    this.env.onRows(this.rows);
    if (this.ended === 'review' || this.ended === 'waiting') {
      this.launcher({ state: 'review', action: 'open-review', count: this.needing() });
    }
    if (this.ended === null || this.id === null) return;
    void this.report().catch(() => undefined);
  }

  /**
   * The step's rows as the person left them (Phase 6): a draft they confirmed, or made theirs, stays so; a field that
   * still holds a draft this document wrote (or, resumed from a stored RunState, text where one was) is an unconfirmed
   * draft (heldDraft, E4); a field the run left flagged, that a plan named savable (T6-1), and that they edited during
   * the fill (an input after their intent, a paste or a drop on its own elements after the fill began and after our
   * last write to it), or before at rest, says userEdited while the setting is on. Also notes each row's field
   * elements, for the person's edits at rest. `macs`: draftMacs's.
   */
  private markedRows(rows: readonly FillResult[], fresh: ScanResult, lastWriteAt: ReadonlyMap<BaseKey, number>,
    macs: ReadonlyMap<BaseKey, ValueMac>): FillResult[] {
    const owners = new WeakMap<Element, FieldKey>();
    const marked = rows.map((row) => {
      const target = fresh.target(row.key);
      const own = target === null ? [] : ownElements(target);
      for (const el of own) owners.set(el, row.key);
      const baseKey = baseKeyOf(row.key);
      let next = this.heldDraft(row, target?.field ?? null, macs) ?? this.heldAnswer(row, target?.field ?? null, macs)
        ?? row;
      if (next.provenance === 'llm-draft' && this.confirmedDrafts.has(baseKey) && next.status === 'flagged'
        && next.reason === 'llm-draft-needs-confirmation') next = confirmedDraftRow(next);
      if (next.status !== 'flagged' || !this.offerToSave || next.kind === 'file' || this.request.dryRun
        || !this.savable.has(baseKey)) return next;
      const since = Math.max(this.fillStartedAt, lastWriteAt.get(baseKey) ?? Number.NEGATIVE_INFINITY);
      // A value of ours the person changed during the fill (changed-by-you) is theirs, but no fix of a flagged field.
      const editedNow = next.reason !== 'changed-by-you' && target !== null && holdsAnswer(target.field)
        && own.some((el) => this.env.touches.editedSince(el, since));
      if (editedNow) this.edited.add(baseKey);
      if (!this.edited.has(baseKey)) return next;
      return { ...next, detail: { ...next.detail, userEdited: true as const } };
    });
    this.owners = owners;
    return marked;
  }

  /**
   * The row of a field that holds a draft written in this document earlier (E4): its value MAC equals the draft's as
   * written (RunEnv.drafts), or, in a run resumed from a stored RunState, it holds text this run did not write where an
   * unconfirmed draft was (RunState.drafts). It is an unconfirmed llm-draft row (dashed, Confirm draft), or blocked
   * when it holds a canary the frame knows; null for any other field (one this run wrote is its own row). A field that
   * no longer holds its draft is forgotten.
   */
  private heldDraft(row: FillResult, field: ScannedField | null, macs: ReadonlyMap<BaseKey, ValueMac>): FillResult | null {
    if (row.wrote || row.status === 'blocked' || field === null || this.request.dryRun) return null;
    const baseKey = baseKeyOf(row.key);
    const written = this.env.drafts.get(baseKey);
    const mac = macs.get(baseKey);
    const text = field.current.kind === 'text' ? field.current.text : '';
    if (written !== undefined) {
      if (mac !== written) {
        this.forgetDraft(baseKey);
        return null;
      }
    } else if (!this.restoredDrafts.has(storedBaseKey(baseKey)) || text.trim() === '' || mac === undefined
      || this.confirmedDrafts.has(baseKey)) {
      return null;
    } else {
      this.env.drafts.set(baseKey, mac);
    }
    if (canariesIn([text], this.inMemory).length > 0) {
      this.forgetDraft(baseKey);
      return { ...row, status: 'blocked', reason: 'canary-in-value', provenance: null, needsUserAction: true };
    }
    // Accepted as written unless the person's setting keeps drafts for their confirmation.
    if (this.llm?.confirmDrafts !== true) {
      return { ...row, status: 'verified', provenance: 'llm-draft', matcherStage: 'not-applicable', confidence: LLM_DRAFT,
        reason: 'llm-draft-written', wrote: true, verification: 'verified', needsUserAction: false };
    }
    return { ...row, status: 'flagged', provenance: 'llm-draft', matcherStage: 'not-applicable', confidence: LLM_DRAFT,
      reason: 'llm-draft-needs-confirmation', wrote: true, verification: 'verified', needsUserAction: true };
  }

  /** The row of a field that holds an AI answer this document wrote earlier, as written (its value MAC): that answer's
   *  row again, or blocked when it holds a canary the frame knows; null for any other field. One that no longer holds
   *  it is forgotten. */
  private heldAnswer(row: FillResult, field: ScannedField | null, macs: ReadonlyMap<BaseKey, ValueMac>): FillResult | null {
    if (row.wrote || row.status === 'blocked' || field === null || this.request.dryRun) return null;
    const baseKey = baseKeyOf(row.key);
    const held = this.heldAnswers.get(baseKey);
    if (held === undefined) return null;
    if (macs.get(baseKey) !== held.mac) {
      this.heldAnswers.delete(baseKey);
      return null;
    }
    const texts = field.current.kind === 'text' ? [field.current.text]
      : field.current.kind === 'selected' ? field.current.labels : [];
    if (canariesIn(texts, this.inMemory).length > 0) {
      this.heldAnswers.delete(baseKey);
      return { ...row, status: 'blocked', reason: 'canary-in-value', provenance: null, needsUserAction: true };
    }
    return { ...row, status: 'verified', provenance: held.provenance,
      matcherStage: held.provenance === 'llm-pick' ? 'llm' : 'not-applicable', confidence: LLM_ANSWER,
      reason: held.reason, wrote: true, verification: 'verified', needsUserAction: false };
  }

  /** The value MACs, at the step's last scan, of the fields a draft concerns (E4): this document's drafts, those a
   *  stored RunState names, and the drafts this fill wrote. Memory only. */
  private async draftMacs(fresh: ScanResult, rows: readonly FillResult[]): Promise<Map<BaseKey, ValueMac>> {
    const drafted = new Set(rows.filter((row) => (row.provenance === 'llm-draft' && row.wrote) || aiAnswerRow(row))
      .map((row) => baseKeyOf(row.key)));
    const wanted = fresh.fields.filter((field) => drafted.has(field.baseKey) || this.env.drafts.has(field.baseKey)
      || this.heldAnswers.has(field.baseKey)
      || (this.restoredDrafts.size > 0 && this.restoredDrafts.has(storedBaseKey(field.baseKey))));
    if (wanted.length === 0) return new Map();
    return (await this.valueHasher()).macsOf(wanted);
  }

  /** The drafts this fill wrote, still as written and waiting for the person, go in the document's book; those the
   *  person made theirs or confirmed leave it (E4). Then RunState is told. */
  private bookDrafts(rows: readonly FillResult[], macs: ReadonlyMap<BaseKey, ValueMac>): void {
    for (const row of rows) {
      const baseKey = baseKeyOf(row.key);
      // A draft waiting for the person, or one accepted as written (the owner's amendments).
      const waiting = heldDraftRow(row);
      const mac = macs.get(baseKey);
      if (waiting && mac !== undefined) this.env.drafts.set(baseKey, mac);
      else if (this.env.drafts.has(baseKey) && !waiting) this.env.drafts.delete(baseKey);
      // The AI's answers, in memory only.
      const answered = aiAnswerRow(row) && mac !== undefined;
      if (answered) {
        this.heldAnswers.set(baseKey, { mac, provenance: row.provenance as HeldAnswer['provenance'],
          reason: row.reason as HeldAnswer['reason'] });
      } else if (this.heldAnswers.has(baseKey)) this.heldAnswers.delete(baseKey);
    }
    this.storeDrafts();
  }

  /** What the run that continues this one in its document carries over (RunCarry). `continued`: the person's trusted
   *  Continue at this run's pause, which hands them a CAPTCHA it paused on. */
  carryOut(continued: boolean): RunCarry {
    return { hasher: this.hasher, steps: new Map(this.carries),
      handed: continued && this.pausedBy !== null ? this.pausedBy : this.handed };
  }

  /** Cancel while the run rests at a pause (or an offer to continue): it stops for good, stored and reported stopped,
   *  so neither Continue nor a reload resumes it (the Phase 5 review, C-S6). */
  async cancelPause(): Promise<void> {
    if (this.ended !== 'paused' || this.machine === null) return;
    this.ended = 'stopped';
    log('content.pause-cancelled');
    this.env.ui()?.hidePolicyCard();
    this.launcher({ state: 'idle', action: 'fill' });
    const next = reduceRun(this.machine, { type: 'USER_STOPPED' }, this.ctx());
    this.machine = next.state;
    try {
      for (const effect of next.effects) {
        if (effect.type === 'persist') await this.persist();
        else if (effect.type === 'report') this.reportDue = true;
      }
      await this.flushReport();
    } catch {
      // The extension went, or the worker refused: the run is stopped here all the same.
    }
  }

  private answer(choice: PolicyChoice): boolean {
    const choose = this.choose;
    if (choose === null) return false;
    this.choose = null;
    choose(choice);
    return true;
  }

  private alive(): void {
    if (this.controller.signal.aborted) throw new RunAborted();
  }

  private launcher(view: LauncherView): void {
    if (this.controller.signal.aborted) return;
    // At review, a notice that stands keeps the badge from a tick, as it keeps the report from its all-clear (the Phase F1
    // review, 3).
    const notices = this.notices.codes().some((code) => code !== 'policy-stored-copy');
    this.env.ui()?.setLauncher(view.state === 'review' ? { ...view, notices } : view);
  }

  /** The notices the stack shows: the report's, but the policy notice and its stored-copy line, which the card is (with
   *  the "Ask me each time" setting; with "Use AI anyway" there is no card, so the stack shows them). */
  private showNotices(): void {
    if (this.controller.signal.aborted) return;
    const card = (this.llm?.whenForbidden ?? 'profile-only') === 'ask';
    this.env.ui()?.setNotices(this.notices.codes().filter((code) => !card
      || (code !== 'policy' && code !== 'policy-stored-copy')));
  }

  private get state(): RunState {
    if (this.machine === null) throw new RunFailure('internal');
    return this.machine;
  }

  private get runId(): string {
    if (this.id === null) throw new RunFailure('internal');
    return this.id;
  }

  /** The adapter tells steps apart: its reports carry the step, and a resting run watches for the next one. */
  private get stepped(): boolean {
    return typeof this.env.page.adapter.stepSignature === 'function';
  }

  /** How many rows (and Add buttons left to the person) need the person, for the launcher's review: the rows by the
   *  review's own rule (needsPerson), so the badge and the panel count a row alike. */
  private needing(): number {
    return this.rows.filter(needsPerson).length + this.addsLeft;
  }

  // ── The run's messages ──────────────────────────────────────────────────────────────────────────────────────────

  private async begin(): Promise<void> {
    const { page, channel } = this.env;
    const pushes = this.pushes;
    const answer = await channel.request({ v: 1, type: 'run/begin', applicationKey: page.app.applicationKey,
      trigger: this.request.trigger, dryRun: this.request.dryRun });
    this.alive();
    if (answer.ok) {
      this.id = answer.data.runId;
      this.policy ??= answer.data.policy;
      // A settings/changed that arrived meanwhile may be newer than the answer: both must say on.
      this.autoAdvance = answer.data.settings.autoAdvance && (this.pushes === pushes || this.pushedAutoAdvance);
      if (this.pushes === pushes) {
        this.offerToSave = answer.data.settings.offerToSaveAnswers;
        this.llm = answer.data.settings.llm;
      }
      return;
    }
    if (answer.error === 'expired') return this.renew();
    throw new RunFailure(answer.error);
  }

  /** An 'expired' answer: begin again, once. */
  private async renew(): Promise<void> {
    this.expiredSeen += 1;
    if (this.expiredSeen > 1) throw new RunFailure('expired');
    log('content.run-renewed');
    await this.begin();
  }

  /** Sends a run-scoped message, beginning the run again once on 'expired'. */
  private async call<T extends AnsweredType>(make: (runId: string) => MessageOf<T>, before?: () => Promise<void>):
    Promise<AnswerData<T> | { failed: ErrorCode }> {
    for (;;) {
      await before?.();
      this.alive();
      const answer = await this.env.channel.request<T>(make(this.runId));
      this.alive();
      if (answer.ok) return answer.data;
      if (answer.error !== 'expired') return { failed: answer.error };
      await this.renew();
    }
  }

  /**
   * plan/request: the whole scan as context, planKeys to plan (LC-2), the 32 nearest canaries, the notices, and the
   * step's repeatable sections (Phase 5). A request over the whole scan lets the worker assign each block its entry
   * afresh (`kept` false); one over some fields only (a typeahead's results) carries the step's assignment. The
   * canaries the answer allows are the ones RunState may hold.
   */
  private async plan(specs: FieldSpec[], planKeys: FieldKey[], pass: number,
    options: { kept?: boolean; revealEdges?: ReadonlyArray<readonly [BaseKey, BaseKey]> } = {}): Promise<PlanAnswer> {
    const kept = options.kept === true;
    const revealEdges = (options.revealEdges ?? []).slice(0, MAX_REVEAL_EDGES)
      .map(([parent, child]): [BaseKey, BaseKey] => [parent, child]);
    const notices = [
      ...(this.notices.has('tripwire') ? [{ kind: 'tripwire' as const, count: this.tripwireHits }] : []),
      ...(this.machine?.policyDecision === 'accepted' ? [{ kind: 'policy' as const, count: 1 }] : []),
    ];
    const canaries = [...this.sent];
    const repeatables = this.sections.map((section) => ({ kind: section.kind,
      entries: kept ? this.answers.get(section.kind)?.entries ?? null : null }));
    // Drafts or answers on (Phase 6; the owner's amendments): the posting as the person sees it, from the top frame
    // only, for their job text; never in a dry run, which asks for neither (E12), nor in a profile-only run.
    const aiText = this.llm !== null && (this.llm.drafts || this.llm.answers);
    const postingText = aiText && this.isTop && !this.request.dryRun && !this.noAi && planKeys.length > 0
      ? this.postingText() : '';
    const noAi = this.noAi;
    // Phase G: a pass that plans an upload sends the company and job title its page title names, for a cover letter of
    // a posting TailorIT does not have (page text, never kept).
    const planned = new Set<string>(planKeys);
    const names = specs.some((spec) => spec.kind === 'file' && planned.has(spec.key))
      ? postingNamesOf(this.env.doc, this.env.page.app.platform) : null;
    const answer = await this.call<'plan/request'>((runId) => ({ v: 1, type: 'plan/request', runId, pass, specs,
      planKeys, canaries, notices, ...(repeatables.length > 0 ? { repeatables } : {}),
      ...(postingText === '' ? {} : { postingText }), ...(revealEdges.length > 0 ? { revealEdges } : {}),
      ...(noAi ? { noAi: true as const } : {}), ...(names === null ? {} : { posting: names }) }));
    if ('failed' in answer) throw new RunFailure(answer.failed);
    this.noteSavable(answer);
    this.noteAiAnswer(answer);
    for (const canary of answer.persistableCanaries) this.checked.add(canary);
    if (!kept) for (const section of answer.repeatables ?? []) this.answers.set(section.kind, section);
    return answer;
  }

  /** What a plan answer says of its rows' fields for the AI (the owner's amendments): which the page may offer Edit
   *  with AI on, and whether the frame's scan holds an "I did not use AI" attestation, which makes the run profile-only
   *  unless the person's setting is to use the AI anyway. */
  private noteAiAnswer(answer: PlanAnswer): void {
    const named = new Set<string>(answer.aiEditable ?? []);
    for (const row of answer.results) {
      const baseKey = baseKeyOf(row.key as FieldKey);
      if (named.has(row.key)) this.aiEditable.add(baseKey);
      else this.aiEditable.delete(baseKey);
    }
    if (answer.aiAttestation === true && this.llm?.whenForbidden !== 'use-ai') this.profileOnly('attestation');
  }

  /** What a plan answer says of its rows' fields: whether the person may save their answer (T6-1). */
  private noteSavable(answer: PlanAnswer): void {
    const named = new Set<string>(answer.savable ?? []);
    for (const row of answer.results) {
      const baseKey = baseKeyOf(row.key as FieldKey);
      if (named.has(row.key)) this.savable.add(baseKey);
      else this.savable.delete(baseKey);
    }
  }

  /** The posting as the person sees it (Phase 6): the document's visible text outside the form root, within TailorIT's
   *  cap on a draft's job text. Page text: sent with plan/request, never kept. */
  private postingText(): string {
    const body = this.env.doc.body;
    return body === null ? '' : visibleTextWithout(body, [this.root], { cap: MAX_POSTING_TEXT }).trim();
  }

  /**
   * plan/poll for fields that wait for the LLM (Phase 4). Sent as it is, never renewing the run: 'expired' means the
   * worker knows none of them (it restarted), and the loop sends them in plan/request again, which renews the run when
   * the worker no longer knows it either. Any other refusal is 'failed': the fields are left to the person.
   */
  private async poll(keys: FieldKey[]): Promise<PlanAnswer | 'expired' | 'failed'> {
    const answer = await this.env.channel.request<'plan/poll'>({ v: 1, type: 'plan/poll', runId: this.runId, keys });
    this.alive();
    if (answer.ok) {
      this.noteSavable(answer.data);
      this.noteAiAnswer(answer.data);
      return answer.data;
    }
    return answer.error === 'expired' ? 'expired' : 'failed';
  }

  /** report/put: the step's rows and the run's notices, never a value. A refusal other than a second 'expired' is
   *  logged. */
  private async report(): Promise<void> {
    const { page } = this.env;
    const rows = this.rows;
    const answer = await this.call<'report/put'>((runId) => {
      const report = buildReport({ runId, frameId: this.frameId, platform: page.app.platform, adapter: page.adapter.id,
        dryRun: this.request.dryRun, status: this.status, pauseReason: this.machine?.pauseReason ?? null,
        notices: this.notices, counters: this.counters, now: this.env.now(),
        ...(this.stepped && this.machine !== null
          ? { step: { index: this.machine.stepIndex, progress: this.stepProgress ?? undefined } } : {}) }, rows);
      if (report === null) throw new RunFailure('internal');
      return { v: 1, type: 'report/put', runId, report };
    }, () => this.env.limiter.turn(this.controller.signal));
    if ('failed' in answer) log('content.report-refused');
  }

  /** The report, when a transition asked for one since the last went out. */
  private async flushReport(): Promise<void> {
    if (!this.reportDue) return;
    this.reportDue = false;
    await this.report();
  }

  /** runstate/put: the machine's state, its canaries those a plan allowed; never a value, never for a dry run. */
  private async persist(): Promise<void> {
    if (this.request.dryRun || this.machine === null) return;
    const runState = persistedRunState(this.machine, this.checked);
    const answer = await this.env.channel.request({ v: 1, type: 'runstate/put', runState });
    this.alive();
    if (!answer.ok) log('content.runstate-refused');
  }

  // ── What the page shows ─────────────────────────────────────────────────────────────────────────────────────────

  /** Reads raw passages into the tripwire: those not read before go through scanTripwires with the passages that hit
   *  before, so the notice is raised once, every canary is merged into the frame's own, and the 32 nearest are
   *  recomputed (a stored RunState's canaries after them). Answers the new passages. */
  private absorbPassages(passages: readonly RawPassage[]): RawPassage[] {
    const fresh = passages.filter((passage) => !this.passagesSeen.has(passageId(passage)));
    for (const passage of fresh) this.passagesSeen.add(passageId(passage));
    if (fresh.length === 0) return fresh;
    const read = [...this.hitPassages, ...fresh];
    const tripwire = scanTripwires(read);
    if (!tripwire.notice) return fresh;
    const hit = new Set(tripwire.hits.map((found) => found.passage));
    this.hitPassages = read.filter((_, at) => hit.has(at));
    this.inMemory = [...tripwire.allCanaries, ...this.carried];
    this.sent = mergeCanaries(tripwire.canaries, this.carried);
    this.tripwireHits = tripwire.hits.length;
    this.notices.add('tripwire', tripwire.hits.length);
    return fresh;
  }

  /** The checks before a pass after the first (L-S2, L-S4): null to go on, or the reason that cuts the loop. */
  private async recheck(): Promise<ReasonCode | null> {
    const { env } = this;
    if (!this.isTop) {
      // A fresh reading: what the watch knew may be from before the page hid the frame.
      const shown = await env.frameShown(this.controller.signal, true);
      this.alive();
      if (!shown) {
        this.loopCut = { kind: 'hidden' };
        return 'form-hidden';
      }
    }
    const raw = await rawScan(env.doc, { signal: this.controller.signal });
    this.alive();
    const fresh = this.absorbPassages(raw.passages);
    if (this.state.policyDecision !== 'accepted') {
      if (frameHitsOf(env.doc).length > 0) {
        // What a posting that forbids AI does is the person's setting (module header): only 'ask' shows the card.
        const mode = this.llm?.whenForbidden ?? 'profile-only';
        if (mode === 'ask') {
          this.loopCut = { kind: 'policy' };
          this.showNotices();
          return 'policy-notice';
        }
        if (mode === 'profile-only') this.profileOnly('posting');
        else this.notices.add('policy');
      } else if (hiddenPolicyHits(fresh).length > 0) {
        this.notices.add('policy-hidden-text');
      }
    }
    this.showNotices();
    const paused = this.pauseNow();
    if (paused !== null) {
      this.loopCut = { kind: 'pause', signal: paused };
      return pauseCutOf(paused);
    }
    // The person (or the page) moved on to another step mid-fill: its fields are the next step's to fill.
    const moved = this.movedOn();
    if (moved !== null) {
      this.loopCut = { kind: 'moved', signature: moved };
      return 'field-disappeared';
    }
    return null;
  }

  /** A pause the page shows now, anywhere in the document (detectPause), but the CAPTCHA the person was handed on this
   *  step at their Continue (X-S4). */
  private pauseNow(): PauseSignal | null {
    const handed = this.handed !== null && this.handed.signature === this.signatureNow() ? this.handed.elements
      : undefined;
    return detectPause(this.env.doc, this.root, this.env.page.adapter, newScanCache(),
      handed === undefined ? {} : { handed });
  }

  /** The step's signature now, when it is no longer the step being worked on (an adapter that tells steps apart);
   *  null otherwise. */
  private movedOn(): string | null {
    if (!this.stepped || this.machine?.stepSignature === null || this.machine === null) return null;
    const now = this.signatureNow();
    return now === this.machine.stepSignature ? null : now;
  }

  /** The form root the adapter finds now, else the one the run had. A new element (the page drew its whole form again,
   *  as Twitch's Greenhouse form is drawn again once its first render fails) is the run's from now on, and the
   *  runtime's (RunEnv.rootMoved): every scan, write and wait reads it, never the detached one. */
  private rootNow(): Element {
    try {
      const found = this.env.page.adapter.detect(this.env.doc);
      if (found !== null && found.formRoot.isConnected && found.formRoot !== this.root) {
        this.root = found.formRoot;
        this.env.rootMoved?.(found.formRoot);
      }
    } catch {
      // The adapter failed on this page: the run's root stands.
    }
    return this.root;
  }

  /** The step's signature now: the adapter's parts, hashed (one signature for every step without its hook). */
  private signatureNow(): string {
    let parts: ReturnType<NonNullable<Adapter['stepSignature']>> | undefined;
    try {
      parts = this.env.page.adapter.stepSignature?.(this.env.doc);
    } catch {
      parts = undefined;
    }
    this.progressRead = parts?.progress ?? null;
    return stepSignature(parts ?? { anchors: [] });
  }

  // ── The machine ─────────────────────────────────────────────────────────────────────────────────────────────────

  private ctx(): RunContext {
    const quirk = this.env.page.adapter.quirks?.transitionCapMs;
    const capMs = this.env.options.transition?.capMs
      ?? (typeof quirk === 'number' && quirk > TRANSITION_CAP_MS ? quirk : undefined);
    return { autoAdvance: this.autoAdvance && !this.request.dryRun, now: this.env.now(),
      ...(capMs === undefined ? {} : { transitionCapMs: capMs }) };
  }

  /** The machine takes one event: its state, then each of its effects in order. Answers the event an effect produced
   *  (at most one does: a scan, a fill, a validation, the click on Next, a wait, the policy card). */
  private async step(event: RunEvent): Promise<RunEvent | null> {
    const next = reduceRun(this.state, event, this.ctx());
    // A step change the machine ignores (a step at its limit, seen at review): the watch goes on from what the page
    // shows, so the same change is not seen again at once (X-S5).
    if (event.type === 'TRANSITIONED' && next.effects.length === 0) this.watchFrom = event.signature;
    this.machine = next.state;
    let produced: RunEvent | null = null;
    for (const effect of next.effects) {
      const answer = await this.perform(effect);
      if (answer !== null) produced = answer;
      if (this.halted) return null;
    }
    return produced;
  }

  /** Feeds the machine from `first` until the run ends, resting where the person or the page must act. */
  private async drive(first: RunEvent): Promise<void> {
    let event: RunEvent | null = first;
    for (;;) {
      while (event !== null) {
        event = await this.step(event);
        if (this.halted) return;
      }
      await this.flushReport();
      event = await this.rest();
      if (event === null) return;
    }
  }

  /** The run comes to rest: it ends, or (at review, on a step the adapter tells apart) watches for the person's own
   *  Next. Answers the event that starts it again, or null. */
  private async rest(): Promise<RunEvent | null> {
    const { status } = this.state;
    if (this.offered || status === 'handoff' || status === 'auth-needed') {
      this.launcher({ state: 'needs-you', action: 'continue', reason: 'pause' });
      this.end('paused');
      return null;
    }
    if (status === 'stopped' || status === 'done') {
      this.launcher({ state: 'idle', action: 'fill' });
      this.end('stopped');
      return null;
    }
    if (status === 'wait-transition') {
      // A wait the run could not keep (a dry run, or the watch ended): the person's turn.
      this.end('waiting');
      return null;
    }
    this.launcher({ state: 'review', action: 'open-review', count: this.needing() });
    this.end('review');
    if (status !== 'review' || !this.stepped || this.request.dryRun) return null;
    // A page whose step keeps changing with nothing to fill is no longer followed (X-S5).
    if (this.idleTransitions >= MAX_IDLE_TRANSITIONS) {
      log('content.watch-ended');
      return null;
    }
    const from = this.watchFrom ?? this.state.stepSignature;
    if (from === null) return null;
    return this.watchStep(from, null, false);
  }

  /** Watches for the step to change (transition.ts): the event it ends with, or null when the run ended first. */
  private async watchStep(from: string, capMs: number | null, watchNext: boolean): Promise<RunEvent | null> {
    this.watchingNow = capMs === null;
    try {
      const outcome = await awaitTransition({ doc: this.env.doc, adapter: this.env.page.adapter,
        root: () => this.rootNow(), signature: () => this.signatureNow(), from, capMs,
        signal: AbortSignal.any([this.controller.signal, this.stopping.signal]), watchNext,
        ...(this.env.options.settle ? { settle: this.env.options.settle } : {}) });
      this.alive();
      if (outcome.kind === 'aborted') return this.stopRequested ? { type: 'USER_STOPPED' } : null;
      this.working();
      if (outcome.kind === 'changed') {
        this.idleTransitions += 1;
        return { type: 'TRANSITIONED', signature: outcome.signature };
      }
      if (outcome.kind === 'unchanged') return { type: 'STEP_UNCHANGED' };
      return { type: 'TIMED_OUT', signature: outcome.signature };
    } finally {
      this.watchingNow = false;
    }
  }

  /** The run works again (the step moved on under it). */
  private working(): void {
    this.ended = null;
    this.launcher({ state: 'running', action: null });
    this.drawAiEdits();
  }

  private end(how: RunEnd): RunEnd {
    this.ended = how;
    const resolve = this.restedOnce;
    this.restedOnce = null;
    resolve?.(how);
    this.drawAiEdits();
    return how;
  }

  private async perform(effect: RunEffect): Promise<RunEvent | null> {
    switch (effect.type) {
      case 'persist':
        await this.persist();
        return null;
      case 'report':
        this.reportDue = true;
        return null;
      case 'scan':
        return this.scanStep();
      case 'fill-step':
        return this.fillStep();
      case 'validate':
        return this.validateStep();
      case 'press-next':
        return this.pressNext();
      case 'await-transition':
        return this.awaitStep(effect.from, effect.capMs);
      case 'pause':
        return effect.kind === 'policy' ? this.policyCard() : this.paused();
      case 'notify':
        this.notify(effect.notice);
        return null;
      case 'show-review':
        this.showReview(effect.cause);
        return null;
      case 'offer-continue':
        this.offered = true;
        return null;
    }
  }

  // ── The effects ─────────────────────────────────────────────────────────────────────────────────────────────────

  /** scan: the policy gate, the tripwire, a pause, and the step's signature (module header, 4). */
  private async scanStep(): Promise<RunEvent> {
    const { env } = this;
    if (this.stopRequested) return { type: 'USER_STOPPED' };
    this.launcher({ state: 'running', action: null });
    this.notices.forget(STEP_NOTICE_CODES);
    this.rows = [];
    this.counters = NO_COUNTERS;
    this.addsLeft = 0;
    this.drawAiEdits();
    if (!this.isTop && this.scans > 0) {
      // A frame inside another page: it fills a later step only while it is still seen there (S1).
      const shown = await env.frameShown(this.controller.signal, true);
      this.alive();
      if (!shown) {
        log('content.form-hidden');
        this.notices.add('form-hidden');
        return { type: 'USER_STOPPED' };
      }
    }
    const first = this.scans === 0;
    this.scans += 1;
    this.watchFrom = null;
    this.rootNow();
    const frameHits = frameHitsOf(env.doc);
    let policyHits = frameHits.length;
    if (first) {
      const gate = policyGateOf(this.policy ?? { postingPage: 'unseen', storedCopy: 'unavailable' }, frameHits);
      policyHits = gate.blocked ? Math.max(1, frameHits.length) : 0;
      this.fromStoredCopy = gate.fromStoredCopy;
      if (!gate.blocked && gate.unreadable) this.notices.add('policy-unreadable');
    }
    // A posting that forbids AI (module header): the card only with the 'ask' setting; otherwise the run fills on,
    // from the profile only (the default) or with the AI, and the notice says which.
    const mode = this.llm?.whenForbidden ?? 'profile-only';
    if (policyHits > 0 && mode !== 'ask' && this.state.policyDecision !== 'accepted') {
      if (mode === 'profile-only') this.profileOnly('posting');
      else this.notices.add('policy');
      if (first && this.fromStoredCopy) this.notices.add('policy-stored-copy');
      policyHits = 0;
    }
    if (policyHits > 0) this.notices.add('policy');
    // The card says when only TailorIT's saved copy held the statement, and so does the panel's (Phase 6).
    if (policyHits > 0 && first && this.fromStoredCopy) this.notices.add('policy-stored-copy');
    this.showNotices();
    const raw = await rawScan(env.doc, { signal: this.controller.signal });
    this.alive();
    const fresh = this.absorbPassages(raw.passages);
    // Policy text only text a person cannot see yet holds (behind "Show more") informs; it stops nothing (S6).
    if (policyHits === 0 && hiddenPolicyHits(first ? raw.passages : fresh).length > 0) {
      this.notices.add('policy-hidden-text');
    }
    this.showNotices();
    // A policy statement is the person's decision first; a pause the step shows is found when the fill starts.
    if (policyHits === 0 || this.state.policyDecision === 'accepted') {
      const paused = this.pauseNow();
      if (paused !== null) return pauseEventOf(paused);
    }
    const hits = Math.max(0, this.tripwireHits - this.hitsCounted);
    this.hitsCounted = this.tripwireHits;
    const signature = this.signatureNow();
    this.stepProgress = this.progressRead;
    return { type: 'SCANNED', signature, policyHits, tripwireHits: hits, canaries: this.sent };
  }

  /** fill-step: the repeatable sections, the reactive loop and the final Guard (module header, 5). */
  private async fillStep(): Promise<RunEvent | null> {
    const { env } = this;
    const { adapter } = env.page;
    this.launcher({ state: 'running', action: null });
    this.idleTransitions = 0;
    const paused = this.pauseNow();
    if (paused !== null) return pauseEventOf(paused);
    if (this.stopRequested) return { type: 'USER_STOPPED' };
    this.loopCut = null;
    this.fillStartedAt = monotonicNow();
    this.rows = [];
    this.drawAiEdits();

    // 1. Repeatable sections: the worker's entry counts, then the Add clicks (never in a dry run).
    this.sections = sectionsOf(adapter, this.rootNow());
    this.answers.clear();
    let outcomes: Awaited<ReturnType<typeof addBlocks>> = [];
    if (this.sections.length > 0) {
      const now = this.scanNow();
      await this.plan(now.fields.map(toFieldSpec), [], 0);
      if (!this.request.dryRun) {
        const step = this.state.stepSignature;
        outcomes = await addBlocks({
          adapter, root: this.root, signal: this.controller.signal,
          ...(env.options.settle ? { settle: env.options.settle } : {}),
          profile: new Map([...this.answers].map(([kind, answer]) => [kind, answer.profile])),
          prior: (kind) => (step === null ? null
            : this.state.repeatableCounters[repeatableCounterKey(step, kind)] ?? null),
          record: (kind, counter) => this.feed({ type: 'REPEATABLE', kind, counter }),
          stopped: () => this.stopRequested,
        }, this.sections);
        this.alive();
      }
    }
    this.addsLeft = needsClicks(outcomes);

    // 2. The reactive loop, "I currently work here", then the final Guard over its rows and its latest scan. The loop
    // starts from this step's books in this run, and leaves its own for the step's next attempt (C-S3, C-S5).
    const signature = this.state.stepSignature;
    const loop = await this.fillLoop(signature === null ? undefined : this.carries.get(signature));
    if (signature !== null && !this.request.dryRun) this.carries.set(signature, loop.carry);
    const last = loop.scan;
    let rows = new Map(loop.rows.map((row) => [row.key, row]));
    for (const section of this.sections) rows = currentJobRows(rows, last, section, this.answers.get(section.kind));
    // The drafts the person confirmed earlier in the run read back as confirmed (Phase 6).
    const confirmedDrafts = new Set([...rows.keys()].filter((key) => this.confirmedDrafts.has(baseKeyOf(key))));
    const guarded = finalGuard({ adapter, root: this.rootNow(), canaries: this.inMemory, confirmedDrafts }, last, rows,
      loop.written);
    const after = guarded.reverted.size > 0 ? last.rescan() : last;

    // 3. The rows and notices.
    const busy = loop.busy !== null;
    if (busy) this.notices.add('page-busy');
    // Set by the checks before a later pass (recheck), while the loop ran.
    const cut = this.loopCut as LoopCut | null;
    if (cut?.kind === 'hidden') {
      log('content.form-hidden');
      this.notices.add('form-hidden');
    }
    // The person's confirmations and edits during the fill stand on the rows (Phase 6), and so do the drafts this
    // document wrote (E4).
    const rowsNow = [...guarded.rows.values(), ...last.unrecognisedUploads.map(uploadRow)];
    const macs = await this.draftMacs(after, rowsNow);
    this.alive();
    const all = this.markedRows(rowsNow, after, loop.carry.lastWriteAt, macs);
    this.bookDrafts(all, macs);
    this.noticesFromRows(all, last);
    this.counters = { passes: loop.passes, hiddenControlsIgnored: last.counters.hiddenControlsIgnored,
      deferredFields: last.counters.deferredFields };
    this.rows = all;
    this.settledStep = !busy;
    env.onRows(all);
    this.drawAiEdits();
    this.showNotices();
    this.recordFindings(loop);

    // 4. How the step's fill ended.
    if (cut?.kind === 'hidden') return { type: 'USER_STOPPED' };
    if (cut?.kind === 'moved' && !this.stopRequested) return { type: 'TRANSITIONED', signature: cut.signature };
    if (cut?.kind === 'policy' && !this.stopRequested) return this.policyMidFill();
    if (this.stopRequested) return { type: 'USER_STOPPED' };
    if (busy) return { type: 'PAUSE', reason: 'page-busy' };
    if (cut?.kind === 'pause') return pauseEventOf(cut.signal);
    const counts = lastFillOf(all);
    return { type: 'FILLED', filledKeys: loop.written.map((entry) => entry.key), flagged: counts.flagged + this.addsLeft,
      blocked: counts.blocked, unresolved: counts.unresolved };
  }

  /** What the loop found that RunState keeps beyond the machine's own events: the reveal edges (keys only), and the
   *  tripwire hits a later pass's check found. */
  private recordFindings(loop: LoopResult): void {
    const state = this.state;
    const edges = new Map(state.revealEdges.map((edge) => [`${edge[0]}\u{0}${edge[1]}`, edge] as const));
    for (const edge of loop.revealEdges) edges.set(`${edge[0]}\u{0}${edge[1]}`, edge);
    const hits = Math.max(0, this.tripwireHits - this.hitsCounted);
    this.hitsCounted = this.tripwireHits;
    this.machine = { ...state, revealEdges: [...edges.values()],
      tripwire: hits > 0 ? { triggered: true, hits: state.tripwire.hits + hits } : state.tripwire };
  }

  /** An event the machine takes without leaving the step (REPEATABLE): its state, then its persist. */
  private async feed(event: RunEvent): Promise<void> {
    const next = reduceRun(this.state, event, this.ctx());
    this.machine = next.state;
    for (const effect of next.effects) if (effect.type === 'persist') await this.persist();
  }

  /** A fresh scan of the form root, with what the run read of its widgets. */
  private scanNow(): ScanResult {
    const { page } = this.env;
    return scan(this.rootNow(), page.adapter, { platform: page.app.platform, frameId: this.frameId,
      widgetReadings: this.widgetReadings });
  }

  /** validate: the step's errors and facts (module header, 6). */
  private validateStep(): RunEvent {
    const { env } = this;
    const { adapter } = env.page;
    const root = this.rootNow();
    // Another step shows already (the person's Next during the fill): its facts are not this step's to judge.
    const moved = this.movedOn();
    if (moved !== null) return { type: 'TRANSITIONED', signature: moved };
    // What the step's last write revealed may be a pause: it is the person's, never a reason to press on (C-S1).
    const paused = this.pauseNow();
    if (paused !== null) return pauseEventOf(paused);
    const cache = newScanCache();
    let errors: Element[] = [];
    try {
      errors = (adapter.errors?.(root) ?? []).map((error) => error.el).filter((el) => isUserVisible(el, cache));
    } catch {
      errors = [];
    }
    let finality: StepFacts['finality'] = 'unknown';
    try {
      finality = adapter.isFinalStep?.(env.doc) ?? 'unknown';
    } catch {
      finality = 'unknown';
    }
    let next: HTMLElement | null = null;
    try {
      next = adapter.nextButton?.(root) ?? null;
    } catch {
      next = null;
    }
    const nextVisible = next !== null && isUserVisible(next, cache) && (next as HTMLButtonElement).disabled !== true;
    this.lastErrors = errors.length;
    return { type: 'VALIDATED', errors: errors.length, fixable: this.fixable(errors), step: { finality, nextVisible,
      settled: this.settledStep,
      unconfirmedDrafts: this.rows.filter((row) => row.provenance === 'llm-draft' && row.needsUserAction).length,
      captchaUnsolved: unsolvedCaptchas(env.doc, root, cache) > 0 } };
  }

  /** The errors one more pass could address: on a field no pass of this step planned (it showed after the loop), or
   *  on one the page emptied after our write. An error on a field the person must answer, that holds our value, or
   *  that the person emptied themselves (their own input since our write: C-S3), is surfaced instead. */
  private fixable(errors: readonly Element[]): number {
    if (errors.length === 0) return 0;
    const fresh = this.scanNow();
    const byKey = new Map(this.rows.map((row) => [row.key, row] as const));
    const signature = this.state.stepSignature;
    const carry = signature === null ? undefined : this.carries.get(signature);
    let count = 0;
    for (const error of errors) {
      let own: Element[] = [];
      const field = fresh.fields.find((candidate) => {
        const target = fresh.target(candidate.key);
        if (target === null) return false;
        own = [target.control, ...target.members, ...(target.proxy === null ? [] : [target.proxy])];
        return own.some((el) => el === error || el.contains(error) || error.contains(el));
      });
      if (field === undefined) continue;
      const row = byKey.get(field.key);
      const emptied = field.current.kind === 'empty' || (field.current.kind === 'text' && field.current.text === '');
      const since = carry?.lastWriteAt.get(field.baseKey) ?? Number.NEGATIVE_INFINITY;
      const theirs = own.some((el) => this.env.touches.touchedSince(el, since));
      if (row === undefined || (row.wrote && emptied && !theirs)) count += 1;
    }
    return count;
  }

  /** press-next: the one untrusted click on the adapter's Next, never Submit (module header, 7). What the run wrote
   *  is read again first, and a value changed since the fill is reported (E9). */
  private async pressNext(): Promise<RunEvent> {
    if (this.stopRequested) return { type: 'USER_STOPPED' };
    if (await this.lookBeforeLeaving()) await this.report();
    this.alive();
    if (this.stopRequested) return { type: 'USER_STOPPED' };
    if (!this.isTop) {
      // A fresh reading: the page may have hidden the frame since the fill (X-S8). Never a click the person cannot see.
      const shown = await this.env.frameShown(this.controller.signal, true);
      this.alive();
      if (!shown) {
        log('content.form-hidden');
        this.notices.add('next-hidden');
        this.showNotices();
        return { type: 'PAUSE', reason: 'needs-click' };
      }
      if (this.stopRequested) return { type: 'USER_STOPPED' };
    }
    // From here to the click nothing is awaited: what is checked is what is clicked.
    const { adapter } = this.env.page;
    const root = this.rootNow();
    // Never a click on a step other than the one validated: one that shows already is scanned instead.
    const moved = this.movedOn();
    if (moved !== null) return { type: 'TRANSITIONED', signature: moved };
    // A pause shown since the validation is the person's (C-S1), and so is Next once they turned auto-advance off (C-S2)
    // or while a CAPTCHA on the step is not known solved (X-S4).
    const paused = this.pauseNow();
    if (paused !== null) return pauseEventOf(paused);
    if (!this.ctx().autoAdvance) {
      log('content.next-withheld');
      return { type: 'NEXT_WITHHELD', reason: 'setting-off' };
    }
    // A CAPTCHA handed to the person and not known solved since: Next is theirs (X-S4, tightened).
    if (unsolvedCaptchas(this.env.doc, root) > 0) {
      log('content.next-withheld');
      return { type: 'NEXT_WITHHELD', reason: 'captcha-unsolved' };
    }
    let next: HTMLElement | null = null;
    try {
      next = adapter.nextButton?.(root) ?? null;
    } catch {
      next = null;
    }
    if (next === null || !isUserVisible(next, newScanCache())) return { type: 'PAUSE', reason: 'needs-click' };
    if (!clickIfAllowed(next, { adapter, root, allowNext: true })) {
      log('content.next-refused');
      return { type: 'PAUSE', reason: 'needs-click' };
    }
    log('content.next-pressed');
    return { type: 'ADVANCED', by: 'extension' };
  }

  /** await-transition: after our click, a capped wait while the run works; the person's turn, a rest (module header,
   *  8). A dry run never waits. */
  private async awaitStep(from: string, capMs: number | null): Promise<RunEvent | null> {
    if (capMs !== null) return this.watchStep(from, capMs, false);
    await this.flushReport();
    this.launcher({ state: 'review', action: 'open-review', count: this.needing() });
    this.end('waiting');
    if (this.request.dryRun) return null;
    return this.watchStep(from, null, true);
  }

  /** pause {policy}: the card, until the person chooses (a run whose request carries Fill anyway takes it at once). */
  private async policyCard(): Promise<RunEvent> {
    // Whether this document read the step: one that only showed the card again (a reload at it) scans first (C-S4).
    if (this.request.policyAccepted === true) return { type: 'POLICY_ACCEPTED', scanned: this.scans > 0 };
    const ui = this.env.ui();
    this.notices.add('policy');
    this.showNotices();
    ui?.showPolicyCard({ fromStoredCopy: this.fromStoredCopy });
    this.launcher({ state: 'needs-you', action: 'open-review', reason: 'policy' });
    const waiting = this.waitForChoice();
    // Handled here as well: if the report fails or the run is aborted first, nothing waits on it.
    waiting.catch(() => undefined);
    this.reportDue = true;
    await this.flushReport();
    const choice = await waiting;
    this.alive();
    ui?.hidePolicyCard();
    if (choice === 'declined') return { type: 'POLICY_DECLINED' };
    this.launcher({ state: 'running', action: null });
    return { type: 'POLICY_ACCEPTED', scanned: this.scans > 0 };
  }

  /**
   * The policy card a later pass's hit showed (L-S2): the run waits there, its rows reported at policy-notice. Cancel
   * ends it stopped (policy-declined); Fill anyway ends it and starts a fresh run from its RunState, whose gate takes
   * that decision.
   */
  private async policyMidFill(): Promise<RunEvent | null> {
    const ui = this.env.ui();
    this.notices.add('policy');
    this.reportStatus = 'policy-notice';
    this.showNotices();
    ui?.showPolicyCard({ fromStoredCopy: false });
    this.launcher({ state: 'needs-you', action: 'open-review', reason: 'policy' });
    const waiting = this.waitForChoice();
    waiting.catch(() => undefined);
    await this.report();
    const choice = await waiting;
    this.alive();
    ui?.hidePolicyCard();
    this.reportStatus = null;
    if (choice === 'declined') {
      this.rows = this.rows.map((row) => (row.reason === 'policy-notice' ? { ...row, reason: 'policy-declined' as const }
        : row));
      this.env.onRows(this.rows);
      this.machine = { ...this.state, policyDecision: 'declined' };
      return { type: 'USER_STOPPED' };
    }
    this.halted = true;
    this.end('stopped');
    this.env.fillAgain({ ...this.request, policyAccepted: true,
      from: { state: this.state, event: { type: 'RESUMED', by: 'person', sameTab: true } }, carry: this.carryOut(false) });
    return null;
  }

  /** pause {auth, handoff}: the person acts; their Continue starts the next run (the runtime). At a CAPTCHA pause the
   *  widgets the step shows now are what the person is handed (carryOut, X-S4). */
  private paused(): null {
    if (this.state.pauseReason === 'captcha') {
      const signature = this.signatureNow();
      const before = this.handed !== null && this.handed.signature === signature ? [...this.handed.elements] : [];
      this.pausedBy = { signature, elements: new Set([...before, ...captchaElements(this.env.doc, this.root)]) };
    }
    this.launcher({ state: 'needs-you', action: 'continue', reason: 'pause' });
    return null;
  }

  private notify(notice: StepNotice): void {
    if (notice === 'tripwire') this.notices.add('tripwire', this.tripwireHits);
    else if (notice === 'validation') this.notices.add('validation', this.lastErrors);
    else this.notices.add(notice);
    this.showNotices();
  }

  /** show-review: the launcher says how many rows need the person (the review lists them); nothing is drawn over the
   *  page. */
  private showReview(cause: ReviewCause): void {
    if (cause === 'error') log('content.step-review-error');
    this.drawAiEdits();
    this.launcher({ state: 'review', action: 'open-review', count: this.needing() });
  }

  private waitForChoice(): Promise<PolicyChoice> {
    return new Promise((resolve, reject) => {
      const signal = this.controller.signal;
      const onAbort = () => {
        this.choose = null;
        reject(new RunAborted());
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
      this.choose = (choice) => {
        signal.removeEventListener('abort', onAbort);
        resolve(choice);
      };
    });
  }

  // ── The run ─────────────────────────────────────────────────────────────────────────────────────────────────────

  /** A run that failed: the machine takes ERROR (review), stored and reported, so a reload finds the person's turn
   *  rather than a fill to resume by itself (C-S7). Best effort: the failure stands whatever this meets. */
  private async failed(): Promise<void> {
    if (this.machine === null || this.controller.signal.aborted) return;
    try {
      const next = reduceRun(this.machine, { type: 'ERROR', reason: 'internal-error' }, this.ctx());
      this.machine = next.state;
      for (const effect of next.effects) {
        if (effect.type === 'persist') await this.persist();
        else if (effect.type === 'report') this.reportDue = true;
      }
      await this.flushReport();
    } catch {
      // The worker is unreachable, or the run was aborted meanwhile: nothing more to do.
    }
  }

  private async execute(): Promise<void> {
    const { env } = this;
    const { page } = env;
    const ui = env.ui();
    ui?.resetNotices();
    ui?.hidePolicyCard();
    this.showNotices();
    this.launcher({ state: 'running', action: null });
    try {
      const frame = await env.frame();
      this.alive();
      this.frameId = frame.frameId;
      this.isTop = frame.isTop;
      await this.begin();

      // 1b. A frame inside another page fills only while its launcher can be seen on that page (S1): the page around it
      // can hide the whole frame (opacity 0, off-screen, a zero-height wrapper), which no check inside the frame sees.
      if (!frame.isTop) {
        const shown = await env.frameShown(this.controller.signal);
        this.alive();
        if (!shown) {
          log('content.form-hidden');
          this.notices.add('form-hidden');
          this.showNotices();
          // Before the machine starts: nothing is stored, and the report says the run stopped.
          this.reportStatus = 'stopped';
          await this.report();
          this.launcher({ state: 'idle', action: 'fill' });
          this.end('stopped');
          return;
        }
      }
      const view = env.doc.defaultView;
      if (view !== null && postingOutsideFrame(view, frame.isTop)) this.notices.add('posting-outside-frame');

      // 2. The machine, from the run's RunState.
      const from = this.request.from;
      this.machine = from?.state ?? createRunState({ applicationKey: page.app.applicationKey,
        platform: page.app.platform, now: env.now() });
      if (from !== undefined) {
        // A stored RunState's canaries are page text the worker checked: every write is scanned for them too.
        this.carried = from.state.canarySet;
        for (const canary of this.carried) this.checked.add(canary);
        this.inMemory = [...this.carried];
        this.sent = [...this.carried];
        this.hitsCounted = 0;
      }
      await this.drive(from?.event ?? { type: 'DETECTED' });
      if (this.ended === null) this.end(this.state.status === 'review' ? 'review' : 'stopped');
    } catch (failure) {
      if (failure instanceof Invalidated || failure instanceof RunAborted || this.controller.signal.aborted) {
        this.end('aborted');
        return;
      }
      const code: ErrorCode = failure instanceof RunFailure ? failure.code : 'internal';
      log('content.run-failed', { notConnected: code === 'not_connected', expired: code === 'expired' });
      await this.failed();
      env.ui()?.hidePolicyCard();
      this.launcher({ state: 'error', action: 'fill', reason: code === 'not_connected' ? 'not-connected' : 'failed' });
      this.end('error');
    } finally {
      this.choose = null;
    }
  }

  /** The fill step's reactive loop (loop.ts). plan/request carries the 32 nearest canaries; each write is scanned for
   *  all of the frame's (both as the checks before each later pass leave them), and refused while a pause shows or
   *  once another step shows. */
  private async fillLoop(carry: LoopCarry | undefined): Promise<LoopResult> {
    const { env } = this;
    const inMemory = () => this.inMemory;
    const rootNow = () => this.rootNow();
    const hasher = await this.valueHasher();
    this.alive();
    return runLoop({
      content: env.content,
      adapter: env.page.adapter,
      // The form root the adapter finds at each read: a form the page draws again mid-fill is found again, and the
      // loop's next scan reads the new one.
      get root() {
        return rootNow();
      },
      platform: env.page.app.platform,
      frameId: this.frameId,
      dryRun: this.request.dryRun,
      get canaries() {
        return inMemory();
      },
      signal: this.controller.signal,
      valid: () => env.channel.valid(),
      stopped: () => this.stopRequested,
      stopSignal: this.stopping.signal,
      plan: (specs, planKeys, pass, revealEdges) => this.plan(specs, planKeys, pass,
        revealEdges === undefined ? {} : { revealEdges }),
      planSome: (specs, planKeys, pass) => this.plan(specs, planKeys, pass, { kept: true }),
      poll: (keys) => this.poll(keys),
      // Profile-only from now on (a later pass's policy hit, an attestation found): what still waits for the AI is
      // given up (the Phase E review, security MINOR 4).
      aiOff: () => this.noAi,
      recheck: () => this.recheck(),
      heldBy: () => {
        // Never a write on a step other than the one being filled (the page moved on, or went back, mid-fill).
        const moved = this.movedOn();
        if (moved !== null) {
          this.loopCut ??= { kind: 'moved', signature: moved };
          return 'field-disappeared';
        }
        const signal = this.pauseNow();
        if (signal === null) return null;
        this.loopCut ??= { kind: 'pause', signal };
        return pauseCutOf(signal);
      },
      hasher,
      touches: env.touches,
      ...(carry === undefined ? {} : { carry }),
      widgetReadings: this.widgetReadings,
      runId: () => this.runId,
      ...(env.options.resume ? { resume: env.options.resume } : {}),
      ...(env.options.settle ? { settle: env.options.settle } : {}),
      ...(env.options.awaitOptions ? { options: env.options.awaitOptions } : {}),
      ...(env.options.ai ? { ai: env.options.ai } : {}),
    });
  }

  /** The notices the rows and the scan raise: attention checks, controls that need the person's click (an Add button
   *  left to them among them), and fields not rendered yet. */
  private noticesFromRows(rows: readonly FillResult[], scanned: ScanResult): void {
    const attention = rows.filter((row) => row.reason === 'attention-check').length;
    if (attention > 0) this.notices.add('attention-check', attention);
    const clicks = rows.filter((row) => row.reason === 'needs-your-click').length + this.addsLeft;
    if (clicks > 0) this.notices.add('needs-click', clicks);
    if (scanned.counters.deferredFields > 0) this.notices.add('deferred-fields', scanned.counters.deferredFields);
  }
}
