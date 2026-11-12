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
 *    this frame's visible text at every scan: a hit makes the run profile-only, or AI-anyway, as the person's setting
 *    says; v4: never a card), the raw scan and
 *    the tripwire (every canary in memory for the frame's own scans; the 32 nearest to plan/request and RunState),
 *    detectPause (sign-in and account: AUTH; email code, entry choice, CAPTCHA: PAUSE; nothing on the step is filled),
 *    and the step's signature from the adapter's parts (SCANNED). A new step's notices start afresh. The couldn't-read
 *    notice shows only when nothing was read: a top frame whose page shows the posting beside its form (a job board's
 *    description, policy.ts POSTING_READ_MIN) read it with its own visible text.
 * 5. fill-step: repeatable sections first (repeatables.ts: the worker's entry counts from a plan of nothing, then one
 *    Add click at a time through assertNotSubmit, each counted in RunState before it is made: REPEATABLE), then the
 *    reactive loop (loop.ts), "I currently work here" (planCurrentJob's rows), the final Guard (verify.ts), the rows
 *    and the notices (FILLED); nothing is drawn over the page's fields (the owner's decision of 2026-11-01). A page still busy at a settle's cap pauses (page-busy); a pause or a
 *    hidden frame a later pass found cuts the loop (the Phase 3 review, L-S2 and L-S4): the pause, or the run ends
 *    stopped; a policy statement a later pass revealed makes the rest of the fill profile-only (v4: no card).
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
 * 9. notify, show-review, pause, offer-continue: the in-page UI (v4: the toasts and the launcher). At review the run
 *    rests and still watches the step (an adapter that tells steps apart): the person's own Next after fixing what
 *    the review showed is a transition. A step change the machine ignores (a step at its limit) moves the watch on to
 *    what the page shows, and after MAX_IDLE_TRANSITIONS step changes in a row that filled nothing the run stops
 *    watching (the Phase 5 review, X-S5). A pause ends the run; Continue (the runtime) starts the next from its state,
 *    with what this one carries (RunCarry): the value hasher, each step's loop books, and the CAPTCHA the person was
 *    handed at a CAPTCHA pause, which does not pause that step again (X-S4). Cancel at a pause stops it for good
 *    (USER_STOPPED, stored and reported: C-S6).
 * Auto-advance is the run/begin answer's, then each settings/changed the worker pushes (settingsChanged: C-S2).
 *
 * v3 Phase 4 (docs/SPEC-AMENDMENTS.md §12 Decision 6): Next and Submit pressed for the person (press.ts).
 * - At rest (review, or waiting for the person's Next), each report says what the step offers the panel's buttons
 *   (FrameReport.buttons: its finality, and whether its Next and Submit can be pressed), never in a dry run.
 * - press (run/press, the side panel's click; or the in-page panel's trusted click): only at rest ('busy' while the run
 *   works), what the run wrote read again first (E9), then press.ts's one click on the adapter's own Next or Submit. A
 *   Submit pressed is armed (RunEnv.submitPressed: the runtime tells the worker and watches for the platform's
 *   confirmation), and the report says it waits for it (buttons.pressed). A Next the page did not take (the step still
 *   there PRESS_REFUSAL_MS later, with errors shown) is answered 'not-accepted'.
 * - Submit mode Auto: the step machine's press-submit effect, on a final step its autoSubmitVerdict passed with the
 *   step's facts (Submit shown, the required questions left unanswered, the posting forbidding AI, a legal answer that
 *   was an AI guess) and the person's skip rules; inside another page, only while the frame is seen (S1). Its facts are
 *   read again after its last wait (the mode still on, the same step, nothing the run wrote changed since, no error
 *   shown), its press re-counts the required questions while that rule holds, and it presses at most once per step.
 *   Otherwise the review's notice says why (submit-held-*). A posting whose AI rule could not be read does not hold it;
 *   the review then says it was submitted anyway (submit-auto-unchecked).
 * - The platform's confirmation seen after a press (submittedSeen, from the runtime, once the worker took it) is
 *   SUBMITTED: the run is done, at once when it rests or watches, else as soon as it comes to rest. None within the
 *   runtime's wait: the submit-unconfirmed notice (submitUnconfirmed); the page refusing it: submit-errors with its
 *   count (submitRefused); a watch that ended any other way clears the wait (submitWatchEnded).
 * v3 Phase 5 (docs/SPEC-AMENDMENTS.md §12 Decisions 9 and 10):
 * - The auto-apply agent's run (trigger 'agent', started by the worker alone in the window it opened) is a fill like
 *   any other: the worker answers its run/begin, and the settings it pushes to that tab, with Next and Submit on Auto
 *   and the person's skip rules, so the machine presses Next and Submit by itself where their checks pass.
 * - Sign-in mode Auto: a run that pauses at a sign-in or create-account page (AUTH) with Sign-in acting as Auto says so
 *   (sign-in-auto) and, once at rest, signs in once through RunEnv.signIn (content/sign-in.ts). The site taking it (the
 *   form gone, or a code or a CAPTCHA shown) continues the run (RunEnv.afterSignIn: the runtime's Continue, which scans
 *   again); none to use is sign-in-unavailable; the site refusing it is sign-in-failed. Either leaves the pause the
 *   person's, as before.
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
 * - Drafts are accepted as written (llm-draft-written; v4: always, llm.confirmDrafts is gone): an accepted draft reads
 *   back as confirmed in the final Guard, is no unconfirmed draft at validation, and is booked in the document like a
 *   waiting one, so a later run rows a field still holding it as the accepted draft it is. (The held-draft path for a
 *   page that saves as it is filled, Ashby's, is kept for a draft a stored run still names, and never starts now.) The AI's answers (llm-answer texts, and llm-picks with an answer's reason) are booked the same way, in memory
 *   only. The posting text goes with plan/request while drafts or answers are on.
 * - When a posting forbids AI (the policy gate at the first scan, or a later pass's hit), settings.llm.whenForbidden
 *   decides: 'profile-only' (the default) fills on from the profile only: every plan/request says noAi, so the worker
 *   asks the LLM nothing, the report says policy-profile-only, and Edit with AI is offered nowhere; 'use-ai' fills on
 *   with the AI, the report saying policy. A plan answer that names an "I did not use AI" attestation in the frame's
 *   scan switches the run to profile-only the same way (ai-attestation), unless the setting is 'use-ai'. v4 (D6): the
 *   policy card and "Ask me each time" are gone; nothing waits for the person.
 * - Edit with AI: the plan answers name the text boxes the page may offer it on (`aiEditable`); while the run rests at
 *   review or waits for the person's Next, not in a dry run or a profile-only run and with no pause on the page, the
 *   page UI draws the button in each (ui/ai-edits.ts). rewriteField, on the person's trusted click on a visible button,
 *   reads the field again (still offered, visible, no honeypot, no canary in what it holds), sends draft/rewrite with
 *   the frame's scan, polls plan/poll for its draft, and writes it through writeField (the DOM Guard, then the frame
 *   Guard over every canary in memory). One rewrite at a time. A rewrite the box already holds writes nothing and
 *   leaves the box's row as it was (the AI's draft stays marked as the AI's). The person's later edit makes the text
 *   theirs (changed-by-you), as any draft's.
 *
 * v4 (the owner, 2026-11-07: "Never flag to the user, just determine with your own"; docs/SPEC-AMENDMENTS.md §13, D1-D12):
 * - Nothing is handed to the person but the hard rules: a CAPTCHA, a bot check, an email code (never automated), and a
 *   sign-in the person's Sign-in mode leaves to them. A field the run could not or would not fill is simply not filled
 *   (shared/report.ts notFilled); only a required one left empty holds auto-Next (report.ts lastFillOf).
 * - What is left for the person shows as a branded toast on the page (drawToasts; ui/toasts.ts), never a notice stack or
 *   a card: the check to solve, the sign-in to make (or "Sign up & Autofill"), the job-site sign-in to add in TailorIT,
 *   Submit Auto holding back, the page refusing a Submit or showing errors the run could not fix, and the run's end. A
 *   toast leaves once its cause is gone. The report's notices are facts the worker reads, never shown.
 * - A run paused at what the page shows carries on by itself once the page no longer shows it (watchPauseGone: the
 *   pause detection again on each DOM change, coalesced, capped at PAUSE_WATCH_MS; RunEnv.resumeAfterPause), so the
 *   person never presses Continue for it. Workday's entry choice is answered with the adapter's declared entry
 *   (RunEnv.enterChoice: its "Apply manually"); a page still busy, a Next not taken, a new page with Autofill after page
 *   turn on Manual rest silently (D7). The launcher's badge shows progress only (D11).
 * - "Sign up & Autofill" (RunRequest.signIn): this run signs in or creates the account at an account wall as Sign-in
 *   mode Auto would, whatever the mode says (the worker answers the credential for that tab and run alone); with no
 *   job-site sign-in saved in TailorIT, the toast says to add one, with its Open action.
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
import { isBlockEmpty } from '../core/steps/repeatable';
import {
  createRunState, MAX_IDLE_TRANSITIONS, reduceRun, repeatableCounterKey, TRANSITION_CAP_MS, type ReviewCause,
  type RunContext, type RunEffect, type RunEvent, type StepFacts, type StepNotice, type SubmitSkipRules,
} from '../core/steps/machine';
import { stepSignature } from '../core/steps/signature';
import { fieldKey, labelSlug, OPTION_SET_NONE, sectionKey } from '../core/text/keys';
import type { BaseKey, CurrentValue, FieldKey, FieldSpec } from '../core/types/field';
import type { Platform } from '../core/enums';
import type { FillResult, PlannedWrite, ReasonCode } from '../core/types/fill';
import type { ValueMac } from '../core/types/loop';
import { MAX_REPEATABLE_BLOCKS, MAX_RUN_STATE_DRAFTS, type RepeatableKind, type RunState, type RunStatus }
  from '../core/types/run';
import { accountLeft } from '../dom/account-section';
import { signInContainerOf, signInFormOf } from '../dom/sign-in-form';
import { clickIfAllowed } from '../dom/fillers';
import { policyClassOf } from '../core/resolver/categories';
import {
  captchaElements, captchaErrorsShown, captchaRefusalShown, checkboxCaptchasUnsolved, detectPause, pageChallenged,
  type PauseSignal, withoutSolvedCaptchaErrors,
} from '../dom/pause-detect';
import { rawScan, type RawPassage } from '../dom/raw-scan';
import { isUsableOption } from '../dom/option-hash';
import { newScanCache } from '../dom/scan-cache';
import { scan, toFieldSpec } from '../dom/scan';
import { deadline, monotonicNow, startDeadline } from '../dom/time';
import type { FieldTarget, ScannedField, ScanResult, WidgetReading } from '../dom/types';
import { visibleText, visibleTextWithout } from '../dom/visible-text';
import { openEditors } from '../dom/fillers/editor-opener';
import { TEXT_CAP_LABEL } from '../dom/thresholds';
import { isEditingHost } from '../dom/kinds';
import { editableHidesText } from '../dom/values';
import type { HeldDialogs } from '../dom/patch-protocol';
import { isUserVisible } from '../dom/visibility';
import { learnable, learnedListKey, staleLearned } from '../dom/widgets';
import { storedListsWanted, type StoredListId } from '../shared/learned-lists';
import type { ErrorCode } from '../messaging/envelope';
import {
  MAX_EDIT_INSTRUCTION, MAX_POSTING_TEXT, type AnswerReadAnswerSchema, type PressAnswer, type RunTrigger, type StepTarget,
} from '../messaging/schemas';
import type { ContentPlatform } from '../platform/types';
import { PAGE_COPY } from '../shared/copy';
import { log } from '../shared/log';
import { leftForPerson, notFilled, progressOf, unfilledByRun } from '../shared/report';
import type { ContentSettings } from '../shared/settings';
import { Invalidated, type AnsweredType, type AnswerData, type Channel, type MessageOf } from './channel';
import { AI_POLL_MS, AI_WAIT_CAP_MS, AiWake, CurrentWrite, runLoop, type LoopCarry, type LoopResult, type OptionsTimings,
  type SettleTimings } from './loop';
import { RunAborted, writeField, type PassEnv, type PlanAnswer } from './pass';
import { frameHitsOf, hiddenPolicyHits, policyGateOf, POSTING_READ_MIN, type PolicyView } from './policy';
import {
  addBlocks, currentJobRows, entriesLeft, moreToAdd, needsClicks, savedSummaries, saveBlocks, sectionsOf,
  type SectionView,
} from './repeatables';
import {
  buildReport, createReportLimiter, lastFillOf, NoticeBook, persistedRunState, REPORT_PUTS_PER_SECOND, uploadRow,
  type NoticeCode, type ReportHeader, type ReportLimiter,
} from './report';
import { postingNamesOf } from './job-relay';
import { chainFactsOf } from './chain-frame'; // jr6 SHELL-B (ICIMS-17)
import { pressStep, refusalAfter, refusalNow, requiredLeftOf, stepButtonsOf, type PressPage } from './press';
import {
  signInChallenged, signInDetailOf, signInHandedOver, signInRefusalWaits, type SignInDetail, type SignInOutcome,
} from './sign-in';
import type { PressSnapshot } from './submitted';
import type { Heard, HeardType, TouchLog } from './touches';
import { awaitTransition } from './transition';
import type { LauncherView } from './ui/launcher';
import type { AiEditItem } from './ui/ai-edits';
import type { PageUi } from './ui/page-ui';
import type { ToastSpec } from './ui/toasts';
import { readBack, type ValueHasher } from './values';
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

/** What an Edit with AI came to (v3 Phase 3b; FillRun.rewrite). */
export type RewriteOutcome = 'rewritten' | 'sensitive' | 'unchanged' | 'refused' | 'failed'
  // v5 p2-fill review (security 3): a rich-text box holding text a person cannot see is never rewritten.
  | 'hidden';
export type RunEnd = (typeof RUN_ENDS)[number];

/** What a run started with. */
export interface RunRequest {
  /** 'resume': the runtime resumed this tab's RunState after a reload (run/begin's trigger). 'agent' (v3 Phase 5): the
   *  auto-apply agent's run, from the worker's own run/start alone. */
  trigger: RunTrigger;
  dryRun: boolean;
  /** v4, "Sign up & Autofill" (panel/fill {signIn: true}, run/start {signIn: true}): this run signs in or creates the
   *  account at an account wall as Sign-in mode Auto would, whatever the mode says. Its Continue keeps it. */
  signIn?: boolean;
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
  /** The poll interval and the cap on waiting for the LLM, and for the run's cover letter (loop.ts). */
  ai?: { pollMs?: number; capMs?: number; letterCapMs?: number };
  /** The cap on the next step after our own click on Next (TRANSITION_CAP_MS, or the adapter's quirk). */
  transition?: { capMs?: number };
  /** jr6 SHELL-A (WD-04): how long a sign-in that found no job-site password saved waits for one (PASSWORD_WAIT_MS). */
  signIn?: { passwordWaitMs?: number };
}

/** jr6 SHELL-A (FIXPLAN §6.12 item 5; WD-04, jr6-password's R5 remainder): how long a sign-in at a wall that found no
 *  job-site password saved, under Sign-in Auto or Sign up & Autofill, waits for one to be saved
 *  (ContentSettings.typeSignIn, which the worker pushes to the frame after signup/save) before it tries the wall once
 *  more: five minutes, as Jobright 1.25.2's account flow waits for its credential (~contents/pre-autofill-flow
 *  ./account-flow waitForCredential, 300 s: a behaviour reference only). Ended at once by the run's Stop or Cancel. */
export const PASSWORD_WAIT_MS = 5 * 60_000;

/** What a run needs from the runtime. */
export interface RunEnv {
  doc: Document;
  content: ContentPlatform;
  channel: Channel;
  limiter: ReportLimiter;
  ui(): PageUi | null;
  /** The frame's id from frame/hello (sent again if it went unanswered), and whether it is the top frame; `claimed`
   *  (core-x, item 3): a subframe whose adapter claims the tab's application (runtime.ts claimsApplication), which acts
   *  as a top frame does for Sign-in Auto. */
  frame(): Promise<{ frameId: number; isTop: boolean; claimed?: boolean }>;
  /** The behaviour review of 2026-11-06 (minor 7): no run began in this document before this one, so nothing the page
   *  shows was written by the extension (runtime.ts). Absent: not known, read as false. */
  firstInDocument?: boolean;
  /** Whether a person can see this frame's launcher on its page (IntersectionObserver v2; false without a launcher).
   *  `fresh`: from a notification after this call, not what was known before. */
  frameShown(signal: AbortSignal, fresh?: boolean): Promise<boolean>;
  page: RunPage;
  now(): number;
  options: RunOptions;
  /** The run's rows, once it has them: field/describe reads their suggestions. */
  onRows(rows: readonly FillResult[]): void;
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
  /** v3 Phase 4: a Submit this run pressed (the panel's, or Submit mode Auto's): the runtime tells the worker and
   *  watches for the platform's confirmation. */
  submitPressed?(by: 'panel' | 'auto', runId: string, before?: PressSnapshot | null): void;
  /** What the runtime reads right before a press (submitted.ts PressSnapshot: the application, the form, the success
   *  signs already shown), since the click may move the page before the press is armed (the review, M1 and M6). */
  beforePress?(): PressSnapshot | null;
  /** v1.3 B: the run is about to press the step's Next (its own, or the panel's): the runtime reads the step's
   *  questions and answers first (form-capture.ts), as the step's fields go once it is left. */
  stepLeaving?(): void;
  /** The review: the steps Submit mode Auto pressed in this document (application key, step index and signature),
   *  shared by every run of the document, so Auto presses a step at most once whatever starts the run again. */
  autoPressed?: Set<string>;
  /** v3 Phase 5, Sign-in mode Auto: signs in once on the page the run paused at (content/sign-in.ts), until `signal`
   *  (the run stopped, cancelled at its pause, or gone) aborts. jr6: `typeOnly`, Sign-in on Manual with a password
   *  saved: the email and the password are typed, and the press is the person's ('typed'). */
  signIn?(signal: AbortSignal, typeOnly?: boolean): Promise<SignInOutcome>;
  /** v3 Phase 5: the site took the sign-in in this document: the run goes on (the runtime's Continue). v4: also once the
   *  page no longer shows the pause the run rests at (watchPauseGone), and after the entry choice was answered. */
  afterSignIn?(): void;
  /** v4 (D7): at Workday's entry choice, the adapter's declared entry (its "Apply manually") pressed through the entry
   *  door (press.ts pressEntryChoice, from the runtime): 'pressed', or 'none' (no entry declared or shown, or a
   *  challenge on the page). */
  enterChoice?(): 'pressed' | 'none';
  /** v4 (D10): the no-sign-in toast's Open, inside the person's click: jr6, the extension's settings at Sign-up
   *  Information (TailorIT's Settings › Autofill before). */
  openSignInSettings?(): void;
  /** core-x, item 2, Sign-in mode Auto: types the saved job-site sign-in into the form's account section
   *  (content/sign-in.ts, SignInContext.section), pressing nothing, until `signal` aborts. jr6: on Manual too
   *  (`typeOnly`: the jr6 review's sec-3, typed only into a document shown to the person). */
  signInSection?(signal: AbortSignal, typeOnly?: boolean): Promise<SignInOutcome>;
  /** Core pass Z1, item 24, Sign-in mode Auto: presses the page's declared sign-in container's button (ADP's guest
   *  Continue, UltiPro's Create account) once the run rests on the step it fills (content/sign-in.ts,
   *  SignInContext.container), until `signal` aborts. */
  signInContainer?(signal: AbortSignal): Promise<SignInOutcome>;
}

// ── snapshot build 2026-11-06 (core pass Z1, item 24) ──
/** How many of a sign-in container's own required boxes a person can see are still empty (marked required or
 *  aria-required, in its light DOM and its open shadow roots), whatever the scan read of their labels: a container's
 *  button is never pressed before its page's own required boxes hold an answer. */
function containerLeft(container: Element): number {
  const cache = newScanCache();
  const boxes: Element[] = [];
  const scopes: ParentNode[] = [container];
  for (let at = 0; at < scopes.length; at += 1) {
    for (const el of Array.from(scopes[at]!.querySelectorAll('*'))) {
      if (el.shadowRoot !== null) scopes.push(el.shadowRoot);
      if (['input', 'select', 'textarea'].includes(el.localName)) boxes.push(el);
    }
  }
  // A radio group is answered by any of its radios.
  const chosen = new Set(boxes.filter((el) => (el as HTMLInputElement).type === 'radio' && (el as HTMLInputElement).checked)
    .map((el) => (el as HTMLInputElement).name));
  return boxes.filter((el) => {
    const box = el as HTMLInputElement;
    if (!box.required && el.getAttribute('aria-required') !== 'true') return false;
    if (box.disabled || ['hidden', 'submit', 'button', 'image', 'reset'].includes(box.type) || !isUserVisible(el, cache)) {
      return false;
    }
    if (box.type === 'radio') return !box.checked && (box.name === '' || !chosen.has(box.name));
    return box.type === 'checkbox' ? !box.checked : box.value.trim() === '';
  }).length;
}
// ── end core pass Z1, item 24 ──

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

/** While a step fills, its progress goes to the side panel at most this often (v3 Phase 3): two and a half reports a
 *  second, under report/put's four, so a report the run rests with always has its slot within the second. */
export const LIVE_REPORT_MS = 400;
/** How long after the person's input at rest the fields left for them are read again (refreshLeft): a page's own
 *  dropdown draws its pick after the click. */
export const LEFT_REFRESH_MS = 150;

/** The notices of one step: a new step's scan forgets them. The run's own (tripwire, policy and the policy states)
 *  stay. */
const STEP_NOTICE_CODES: readonly NoticeCode[] = ['attention-check', 'needs-click', 'deferred-fields', 'validation',
  'page-busy', 'auth', 'captcha', 'step-retry-limit', 'final-unknown', 'max-steps', 'next-hidden', 'captcha-next',
  'submit-held-required', 'submit-held-no-ai', 'submit-held-guess', 'submit-held-captcha', 'submit-held-check',
  'submit-held-attention', 'submit-held-entries', 'submit-unconfirmed', 'submit-errors', 'submit-auto-unchecked',
  'sign-in-auto', 'sign-in-unavailable', 'sign-in-failed', 'bot-check', 'account-left', 'errors-on-load'];

/** The notices that say the posting itself forbids AI (v3 Phase 4: Submit mode Auto's skip rule), whichever way the
 *  run went on: profile only, AI anyway, or the saved copy's word; and (the v3 Phase 4 review) a statement only text a
 *  person cannot see yet holds, which is one all the same. Not the form's "I did not use AI" statement, which a
 *  profile-only fill makes true, nor a posting that could not be read (policy-unreadable: the person chose Auto, and
 *  the review says it was submitted anyway), nor the tripwire's hits. */
const POSTING_NO_AI: readonly NoticeCode[] = ['policy', 'policy-profile-only', 'policy-stored-copy', 'policy-hidden-text'];

/** The event a pause signal gives: sign-in and account creation are AUTH, the rest PAUSE with their reason. */
function pauseEventOf(signal: PauseSignal): RunEvent {
  switch (signal.kind) {
    case 'sign-in':
    case 'create-account':
    case 'email-gate':
      return { type: 'AUTH', wall: signal.kind };
    case 'email-code':
      return { type: 'PAUSE', reason: 'email-code' };
    case 'entry-choice':
      return { type: 'PAUSE', reason: 'entry-choice' };
    case 'forgot-password':
      return { type: 'PAUSE', reason: 'forgot-password' };
    case 'captcha':
      return { type: 'PAUSE', reason: 'captcha' };
  }
}

/** The reason a pause found before a later pass gives what the loop leaves. */
function pauseCutOf(signal: PauseSignal): ReasonCode {
  return signal.kind === 'captcha' ? 'challenge-present' : 'auth-required';
}

/** What cut the loop before a later pass: the frame hidden, a pause, or the step moved on. */
type LoopCut = { kind: 'hidden' } | { kind: 'pause'; signal: PauseSignal } | { kind: 'moved'; signature: string };

/** v4 (D10): how long after a DOM change a run resting at a pause looks at the page again (watchPauseGone): the
 *  changes of one moment are read once. */
export const PAUSE_LOOK_MS = 250;
/** v4 (D10): how long a run resting at a pause watches for it to go, at most (RunState's own resume window). */
export const PAUSE_WATCH_MS = 30 * 60 * 1000;

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

/** Whether a field holds an answer at all (not empty, not only its placeholder; a box only while it is ticked). */
function holdsAnswer(current: CurrentValue): boolean {
  switch (current.kind) {
    case 'text':
      return current.text.trim() !== '';
    case 'checked':
      return current.checked;
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

/** v4: whether a row is a field the run did not fill, filled by the person since or not (shared/report.ts
 *  unfilledByRun: notFilled, filledByYou aside; a required field the run skipped among them, the v4 review's L-M7): the
 *  rows read again after the person's input at rest. */
function open(row: FillResult): boolean {
  return unfilledByRun(row);
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
  /** core-x, item 3: a subframe whose adapter claims the tab's application (RunEnv.frame's `claimed`). */
  private claimed = false;
  /** core-x, item 2: the steps (by signature) whose account section Sign-in Auto typed into, once each. */
  private readonly accountTyped = new Set<string>();
  /** Core pass Z1, item 24: the steps whose sign-in container this run pressed (or tried): at most once each. */
  private readonly containerPressed = new Set<string>();
  private autoAdvance = false;
  /** Autofill after page turn (modes.afterPageTurn): a new step is filled as it appears; off: Continue fills it. */
  private fillAfterTurn = true;
  /** v3 Phase 4: Submit mode Auto (modes.submit) and the skip rules it reads (modes.agentSkip). */
  private autoSubmitOn = false;
  private skipRules: SubmitSkipRules = { requiredEmpty: true, noAi: true, legalGuess: false };
  /** v3 Phase 5: Sign-in mode as it acts (modes.signIn, held Manual by the worker unless allowed). */
  private signInAuto = false;
  /** jr6: a job-site password is saved here and may be typed (ContentSettings.typeSignIn): on Manual, a sign-in or
   *  create-account page gets it typed and its button is left to the person. */
  private signInTypes = false;
  /** The run paused at a sign-in and signs in once it rests (sign-in-auto). */
  private signInDue = false;
  /** jr6: the sign-in due is Manual's: typed, never pressed. */
  private signInTyping = false;
  /** v4 (D10): what came of this run's sign-in, for its toast: the v4 review (M5) tells apart no job-site sign-in saved
   *  ('none-saved': the toast to add one), a challenge on the page ('challenged': the check to solve), the site refusing
   *  it ('failed'), and anything else ('unavailable': not allowed now, no form read: the sign-in to make on the page);
   *  jr6: typed on Manual, the press the person's ('typed'). */
  private signInSaid: 'none-saved' | 'challenged' | 'unavailable' | 'failed' | 'typed' | null = null;
  // ── jr6 SHELL-A ──
  /** What this run's last sign-in said beyond its outcome (sign-in.ts signInDetailOf): a password rule of the page's
   *  own the saved one breaks, or the kind of account error the page shows; each its own toast (FIXPLAN §6.12 items 1
   *  and 4). And what the form's account section's typing said (its toast at rest). */
  private signInDetail: SignInDetail | null = null;
  private sectionDetail: SignInDetail | null = null;
  /** The wall the run paused at (paused): an email gate's toasts are its own (D-d); null at none. */
  private restWall: 'sign-in' | 'create-account' | 'email-gate' | null = null;
  /** D-d (FIXPLAN §6.12 item 6, APPLYPLAN G): the step is an email gate the run fills as a step (gateFillable): the
   *  gate is no pause while its fields are scanned and written; its pause is taken at the validation, where the gate's
   *  sign-in step types its email and presses its Next on Auto alone. */
  private gateFilling = false;
  /** WD-04 (FIXPLAN §6.12 item 5): ends the wait for a job-site password to be saved (waitForPassword) when the worker
   *  says one may be typed (settingsChanged); null while none waits. A run waits once. */
  private passwordArrived: (() => void) | null = null;
  private passwordWaited = false;
  // ── end jr6 SHELL-A ──
  /** v4: a statement only text a person cannot see yet holds says the posting forbids AI (the Phase 2 review's S6):
   *  no notice any more, but Submit mode Auto's "posting forbids AI" skip rule still reads it. */
  private hiddenPolicy = false;
  /** v4 (D10): the step the run last validated is the final one (the end-of-run toast). */
  private finalStep = false;
  /** v4 (D10): the watch for the pause the run rests at to go (watchPauseGone), while one runs. */
  private pauseWatch: AbortController | null = null;
  /** Aborted when the person cancels the run at its pause (cancelPause): a sign-in on its way types nothing. */
  private readonly cancelled = new AbortController();
  /** A Submit this run pressed waits for the platform's confirmation (the report's buttons.pressed). */
  private submitPending = false;
  /** The steps Submit mode Auto pressed when the runtime keeps none (RunEnv.autoPressed). */
  private readonly autoPressedHere = new Set<string>();
  /** The platform's confirmation came while the run still worked: SUBMITTED is taken when it next rests. */
  private submittedLate = false;
  /** Aborted when the platform's confirmation is seen while the run watches the step: the watch ends as SUBMITTED. */
  private readonly confirmed = new AbortController();
  // ── v5 p1-rules: CAPTCHA like Jobright (PLAN decision 9) ──
  /** The page refused a press for its check (pause-detect.ts captchaRefusalShown): this run rests at a CAPTCHA pause,
   *  the "solve the check" toast shown, and carries on by itself once the check is solved (watchPauseGone). */
  private refusedByCheck = false;
  /** Such a refusal came while the run still worked: the pause is taken when it next rests. */
  private refusedLate = false;
  /** Aborted when such a refusal comes while the run watches the step: the watch ends as the CAPTCHA pause. */
  private readonly checkRefused = new AbortController();
  /** v5 review (F2): whether the step's form showed a checkbox CAPTCHA unticked as this run's last Submit was pressed. */
  private untickedAtSubmit = false;
  // ── end v5 p1-rules ──
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
  /** s2 lists: the lists this host's dropdowns showed before (lists/known, asked once a scan of the run holds a
   *  learnable dropdown), and those this run read whole since, by their label's key (dom/widgets' learnedListKey):
   *  every scan of the run reads them (ScanOptions.learnedLists). Option labels only (page text), in memory. */
  readonly learnedLists = new Map<string, readonly string[]>();
  private learnedAsked = false;
  /** The learned lists this run dropped as stale after a plan found no option in them (staleLearned), each once. */
  private readonly relearned = new Set<string>();
  /** s2 lists: the stored lists the worker served the run (lists/known's `stored`: background/stored-lists.ts), by
   *  id, which every scan of the run reads (ScanOptions.storedLists), and the ids asked for already. In memory. */
  readonly storedLists = new Map<StoredListId, readonly string[]>();
  private readonly storedAsked = new Set<StoredListId>();
  /** The lists this run told the worker of (label key and options), each once. */
  private readonly learnedSent = new Set<string>();
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
  /** The run rests at wait-transition, waiting for the person's own Next (FrameReport.resting). */
  private resting = false;
  /** The scan kept while the run rests, read field by field (currentOf); made again only when a field's elements left
   *  the page. */
  private restScan: ScanResult | null = null;
  /** Whether the batch of reads now has made its one fresh scan (refreshLeft). */
  private restScanned = false;
  /** A read of the fields left for the person waits (scheduleLeftRefresh), and when the person's input last came. */
  private leftRefreshing = false;
  private lastHeardAt = 0;
  /** The status the report shows instead of the machine's (the policy card a later pass's hit showed). */
  private reportStatus: RunStatus | null = null;
  /** The step's repeatable sections, and the worker's answers for them (counts, entries, current flags). */
  private sections: SectionView[] = [];
  private readonly answers = new Map<RepeatableKind, RepeatableAnswer>();
  /** Sections whose entries are left for the person to add. */
  private addsLeft = 0;
  /** The repeatable blocks this step saved (saveBlocks: their section keys): the page folded their fields away after
   *  our own Save, so what the run wrote there is no longer read back at rest (lookBeforeLeaving). */
  private savedBlocks: ReadonlySet<string> = new Set();
  private settledStep = true;
  private lastErrors = 0;
  /** The behaviour review of 2026-11-06 (minor 7): the errors the validation read last, and those the page showed at
   *  the step's first scan before the extension wrote anything in the document (noteLoadErrors). */
  private lastErrorEls: readonly Element[] = [];
  private loadErrors: { signature: string | null; errors: ReadonlySet<Element> } | null = null;
  /** The policy card at the first scan said only TailorIT's stored copy carried the statement. */
  private fromStoredCopy = false;
  /** The step's progress line as the adapter read it at the last scan ("Step 2 of 4"), for the report; null: none. */
  private stepProgress: string | null = null;
  /** The progress line the latest signature read. */
  private progressRead: string | null = null;
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
  /** v5 p2-fill review (security 4): what this run's holds of the page's dialogs held back, counts only (never words):
   *  the page's toast says so. */
  private heldDialogs: HeldDialogs = { alerts: 0, confirms: 0 };
  /** The AI's answers this run keeps when the document keeps none (RunEnv.answers). */
  private readonly ownAnswers = new Map<BaseKey, HeldAnswer>();
  /** The fields the person edited after the run left them flagged (their rows say userEdited), by base key. */
  private readonly edited = new Set<BaseKey>();
  /** The drafts the person confirmed or made their own, by base key: never unconfirmed again in this run. */
  private readonly confirmedDrafts = new Set<BaseKey>();
  /** The AI drafts held back from a page that saves as it is filled (module header), by base key, with their planned
   *  rows: written only at the person's Confirm. Memory only, never sent, stored or logged. */
  private readonly heldDrafts = new Map<BaseKey, { write: PlannedWrite; planned: FillResult }>();
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
  /** How far the step's fill is (v3 Phase 3: the loop's progress), while it fills; null otherwise. Rows and keys only. */
  private live: { rows: readonly FillResult[]; pending: readonly FieldKey[]; current: FieldKey | null } | null = null;
  /** A progress report is waiting for its time (LIVE_REPORT_MS since the last). */
  private liveWaiting = false;
  private liveSentAt = Number.NEGATIVE_INFINITY;
  /** Moves whenever the progress a live report would carry ends (the step's fill ends, the run rests): one built for an
   *  earlier gate is never sent. */
  private liveGate = 0;
  /** The live reports' own limit (report/live has its own budget at the worker): they never hold back report/put. */
  private readonly liveLimiter = createReportLimiter({ perSecond: REPORT_PUTS_PER_SECOND });
  /** The write being made now, which the person's Skip gives up (the loop fills it in). */
  private readonly writing = new CurrentWrite();
  /** v5 p2-stream: rung by the worker's plan/ready, so the loop's wait for the AI polls at once (loop.ts AiWake). */
  private readonly aiWake = new AiWake();
  /** v5 p2-stream (the P2 review, security 5): the fields whose AI answer or draft came on the stream and whose reply
   *  TailorIT then voided as a whole (plan/ready's `reviews`): what the run wrote from them is flagged for review. */
  private readonly voidedAi = new Set<BaseKey>();
  /** The step's repeatable sections as the report counts them: entries the profile has, and blocks the form shows. */
  private repeatableCounts: NonNullable<ReportHeader['repeatables']> = [];

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

  /** The run's id, as run/begin gave it (null before). */
  get begunAs(): string | null {
    return this.id;
  }

  /** What started the run (v3 Phase 5: a Continue after a sign-in keeps the agent's trigger). */
  get trigger(): RunTrigger {
    return this.request.trigger;
  }

  /** The machine's state, for the run that continues this one (null before it began). */
  get runState(): RunState | null {
    return this.machine;
  }

  /** Whether the run rests and watches for the next step (review, or the person's Next). */
  get watching(): boolean {
    return this.watchingNow;
  }

  /** Whether the run waits at the policy card: v4 (D6), never (kept for the runtime's run/policyDecision answer). */
  get atPolicyCard(): boolean {
    return false;
  }

  /** run/cancel while the run writes or watches: nothing more is written, and the run ends stopped. */
  stop(): void {
    this.cancelled.abort();
    this.stopRequested = true;
    this.stopping.abort();
  }

  /** Ends the run at once: its planned writes are dropped (invalidation, the document leaving, a new document). */
  abort(): void {
    this.controller.abort();
  }

  /** v5 p2-stream (plan/ready): answers this run waits for came in, by the worker's word: the loop's wait for the AI
   *  polls at once. Answers whether the word was this run's. The P2 review (security 5): `reviews` names fields whose
   *  streamed answer's reply was then voided: what the run wrote from them is flagged now at rest, else at its end. */
  aiReady(runId: string, reviews: readonly FieldKey[] = []): boolean {
    if (this.id === null || runId !== this.id) return false;
    for (const key of reviews) this.voidedAi.add(baseKeyOf(key));
    if (this.ended !== null) {
      if (reviews.length === 0) return false;
      this.replaceRows(this.reviewedRows(this.rows).filter((row, at) => row !== this.rows[at]));
      return true;
    }
    this.aiWake.ring();
    return true;
  }

  /** v5 p2-stream (the P2 review, security 5): a field written from an AI answer or draft whose reply TailorIT voided
   *  after its stream sent it stays as written, flagged for review (ai-reply-voided). A row already waiting for the
   *  person (a draft to confirm) or blocked stays as it is. */
  private reviewedRows(rows: readonly FillResult[]): FillResult[] {
    if (this.voidedAi.size === 0) return [...rows];
    return rows.map((row) => (this.voidedAi.has(baseKeyOf(row.key)) && row.wrote && row.status !== 'blocked'
      && (row.provenance === 'llm-answer' || row.provenance === 'llm-draft' || row.provenance === 'llm-pick')
      && !(row.status === 'flagged' && row.needsUserAction)
      ? { ...row, status: 'flagged' as const, reason: 'ai-reply-voided' as const, needsUserAction: true } : row));
  }

  /** The person's Skip (v3 Phase 3, run/skip): gives up the write of `key` when it is the one being made now, and the
   *  run goes on without it. Answers whether it was. Never a guard: a write given up only writes less. */
  skipField(key: FieldKey): boolean {
    if (this.ended !== null) return false;
    return this.writing.skip(key);
  }

  /** settings/changed: the person saved their settings. The Next mode is read from them from now on: a validation, and
   *  press-next right before its click, take it as it is (the Phase 5 review, C-S2); so is Autofill after page turn. */
  settingsChanged(settings: ContentSettings): void {
    this.pushes += 1;
    this.pushedAutoAdvance = settings.modes.next === 'auto';
    this.autoAdvance = settings.modes.next === 'auto';
    this.fillAfterTurn = settings.modes.afterPageTurn === 'auto';
    this.autoSubmitOn = settings.modes.submit === 'auto';
    this.skipRules = { ...settings.modes.agentSkip };
    this.signInAuto = settings.modes.signIn === 'auto';
    this.signInTypes = settings.typeSignIn === true;
    // jr6 SHELL-A (WD-04): a job-site password may be typed now (one was saved): the run that waits for one goes on.
    if (this.signInTypes) this.passwordArrived?.();
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
    if (this.heldDrafts.has(baseKeyOf(key))) return this.confirmHeldDraft(key);
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

  /** Whether an AI draft is held back from the page rather than written (module header): v4 (D6), never: a draft is
   *  always written and accepted. */
  private holdsDrafts(): boolean {
    return false;
  }

  /** The loop's draft about to be written (LoopEnv.holdDraft): held back, with the row that says so, on a page that
   *  saves as it is filled while drafts wait for the person; null to write it. */
  private holdDraft(write: PlannedWrite, planned: FillResult): FillResult | null {
    if (write.origin.provenance !== 'llm-draft' || write.value.kind !== 'text' || !this.holdsDrafts()) return null;
    this.heldDrafts.set(baseKeyOf(write.key), { write, planned });
    return { ...planned, status: 'flagged', provenance: 'llm-draft', matcherStage: 'not-applicable',
      reason: 'llm-draft-held', wrote: false, verification: 'not-applicable', needsUserAction: true };
  }

  /** Confirm draft on a draft held back (module header): written now, through both Guards, unless the person has
   *  typed into the field meanwhile (then it is theirs: changed-by-you, and the draft is dropped). */
  private async confirmHeldDraft(key: FieldKey): Promise<boolean> {
    const baseKey = baseKeyOf(key);
    const held = this.heldDrafts.get(baseKey)!;
    const row = this.rows.find((candidate) => baseKeyOf(candidate.key) === baseKey && candidate.reason === 'llm-draft-held');
    if (row === undefined || (this.ended !== 'review' && this.ended !== 'waiting') || this.stopRequested) return false;
    if (this.pauseNow() !== null) return false;
    const now = this.scanNow();
    const target = now.fields.find((candidate) => candidate.key === key)
      ?? now.fields.find((candidate) => candidate.baseKey === baseKey);
    if (target === undefined) return false;
    if (target.current.kind === 'text' && target.current.text.trim() !== '') {
      log('draft.confirm-refused', { changed: true });
      this.heldDrafts.delete(baseKey);
      this.replaceRow(unresolvedRow(row, 'changed-by-you'));
      return false;
    }
    const write: PlannedWrite = { ...held.write, key: target.key };
    const written = await writeField(this.passEnv(), now, target, write, { ...held.planned, key: target.key },
      new WeakMap());
    this.alive();
    if (written.written === undefined || written.row.wrote !== true || written.row.status === 'blocked') {
      log('draft.confirm-refused', { written: false });
      if (written.row.status === 'blocked') {
        this.heldDrafts.delete(baseKey);
        this.replaceRow(written.row);
      }
      return false;
    }
    this.heldDrafts.delete(baseKey);
    this.confirmedDrafts.add(baseKey);
    log('draft.confirmed');
    this.replaceRow(confirmedDraftRow({ ...written.row, provenance: 'llm-draft' }));
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
      && this.llm?.drafts !== false;
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
  async rewriteField(key: FieldKey, instruction = ''): Promise<boolean> {
    return (await this.rewrite(key, instruction)) === 'rewritten';
  }

  /**
   * Edit with AI with the person's instruction (v3 Phase 3b: the box's words, '' for none), as rewriteField: what came
   * of it, for the box to say. 'sensitive': nothing was rewritten because the question, the box's text or the
   * instruction names what never goes to the AI (the worker's screen or TailorIT's); 'unchanged': the rewrite was what
   * the box holds; 'refused': it may not be asked now; 'failed': no draft came.
   */
  async rewrite(key: FieldKey, instruction = ''): Promise<RewriteOutcome> {
    const refused = (why: Record<string, boolean>): 'refused' => {
      log('content.ai-edit-refused', why);
      return 'refused';
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
    // v5 p2-fill review (security 3): a rich-text box whose text a person cannot all see (off-screen, clipped,
    // see-through or tiny text in it: its innerText and its visible reading differ beyond white space) is never
    // rewritten: nothing is sent, and its row is flagged so the review says why (dom/values.ts editableHidesText).
    const control = fresh.target(field.key)?.control;
    if (control !== undefined && isEditingHost(control) && editableHidesText(control)) {
      const row = this.rows.find((candidate) => candidate.key === field.key);
      if (row !== undefined) this.replaceRow({ ...row, status: 'flagged', reason: 'hidden-text-in-box' });
      log('content.ai-edit-refused', { hidden: true });
      return 'hidden';
    }
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
      const words = instruction.trim().slice(0, MAX_EDIT_INSTRUCTION);
      const asked = await this.env.channel.request<'draft/rewrite'>({ v: 1, type: 'draft/rewrite', runId: this.runId,
        fieldKey: field.key, specs, canaries: [...this.sent], ...(postingText === '' ? {} : { postingText }),
        ...(revealEdges.length > 0 ? { revealEdges } : {}), ...(words === '' ? {} : { instruction: words }) });
      this.alive();
      if (!asked.ok) return refused({ worker: false });
      let answer: PlanAnswer = asked.data;
      const pollMs = this.env.options.ai?.pollMs ?? AI_POLL_MS;
      const capMs = this.env.options.ai?.capMs ?? AI_WAIT_CAP_MS;
      const started = monotonicNow();
      while (!answer.writes.some((write) => write.key === field.key) && answer.awaiting.includes(field.key)) {
        const left = capMs - (monotonicNow() - started);
        if (left <= 0) {
          log('content.ai-edit-refused', { timedOut: true });
          return 'failed';
        }
        if (await deadline(Math.min(pollMs, left), this.controller.signal) === 'aborted') return 'refused';
        const polled = await this.poll([field.key]);
        if (polled === 'expired' || polled === 'failed') return refused({ worker: false });
        answer = polled;
      }
      const write = (answer.writes as unknown as PlannedWrite[]).find((candidate) => candidate.key === field.key);
      const planned = (answer.results as unknown as FillResult[]).find((candidate) => candidate.key === field.key);
      // No draft (TailorIT refused or failed): what the field holds stays, and so does its row. One the screens kept
      // from the AI says so (v3 Phase 3b).
      if (write === undefined || planned === undefined || write.origin.provenance !== 'llm-draft') {
        log('content.ai-edit-refused', { drafted: false });
        return planned?.reason === 'llm-disabled-for-category' ? 'sensitive' : 'failed';
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
        return written.row.reason === 'already-correct' ? 'unchanged' : 'refused';
      }
      // The draft as written is booked, so the person's later edit makes it theirs (E3, E4).
      const after = this.scanNow().fields.find((candidate) => candidate.key === field.key);
      const mac = after === undefined ? undefined : await (await this.valueHasher()).mac(after.current);
      this.alive();
      if (mac !== undefined && heldDraftRow(written.row)) this.env.drafts.set(field.baseKey, mac);
      this.confirmedDrafts.delete(field.baseKey);
      this.storeDrafts();
      this.replaceRow(written.row);
      return 'rewritten';
    } catch (failure) {
      if (failure instanceof RunAborted || failure instanceof Invalidated) return 'refused';
      log('content.ai-edit-refused', { failed: true });
      return 'failed';
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
      // v5 p2-fill review (security 4)
      dialogsHeld: (held) => this.dialogsHeld(held),
      ...(env.options.resume ? { resume: env.options.resume } : {}),
    };
  }

  /** v5 p2-fill review (security 4): a write's hold of the page's dialogs held some back: added to the run's counts,
   *  which the page's toast says (toastsNow), counts only. */
  private dialogsHeld(held: HeldDialogs): void {
    this.heldDialogs = { alerts: this.heldDialogs.alerts + held.alerts,
      confirms: this.heldDialogs.confirms + held.confirms };
    this.drawToasts();
  }

  /** The run fills from the profile only from now on (module header): the notice says why, and Edit with AI goes. The
   *  fill loop gives up what still waits for the AI as ai-off-for-posting, and writes no AI answer that came in
   *  (LoopEnv.aiOff); every later plan/request says noAi, and the worker, marking the run, asks the AI nothing more. */
  private profileOnly(why: 'posting' | 'attestation'): void {
    if (!this.noAi) log('content.profile-only', { posting: why === 'posting', attestation: why === 'attestation' });
    this.noAi = true;
    this.notices.add(why === 'posting' ? 'policy-profile-only' : 'ai-attestation');
    this.drawAiEdits();
  }

  /** A row the run did not fill (v4: notFilled, or one the person filled since) with detail.filledByYou as what its
   *  field holds now says (v3 Phase 3): a flag only, which claims nothing about who filled it. Any other row as it is.
   *  `scanned`: a fresh scan was made in this batch already (currentOf makes at most one). */
  private withFilledByYou(row: FillResult, scanned: boolean): FillResult {
    if (!open(row)) return row;
    const current = this.currentOf(row.key, scanned);
    const holds = current !== null && holdsAnswer(current);
    if (holds === (row.detail?.filledByYou === true)) return row;
    const { filledByYou: _, ...rest } = row.detail ?? {};
    return { ...row, detail: holds ? { ...rest, filledByYou: true } : rest };
  }

  /** What a field holds now, by its key, read from the live elements of the scan kept at rest (readBack), never a whole
   *  scan per keystroke: a fresh scan only when the field's elements left the page (the page drew it again), and not
   *  when `scanned` says one was made in this batch. Null when the field is not there. */
  private currentOf(key: FieldKey, scanned = false): CurrentValue | null {
    const find = (from: ScanResult): FieldTarget | null => {
      const field = from.fields.find((candidate) => candidate.key === key)
        ?? from.fields.find((candidate) => candidate.baseKey === baseKeyOf(key));
      const target = field === undefined ? null : from.target(field.key);
      return target !== null && ownElements(target).every((el) => el.isConnected) ? target : null;
    };
    let target = this.restScan === null ? null : find(this.restScan);
    if (target === null && !scanned) {
      this.restScan = this.scanNow();
      this.restScanned = true;
      target = find(this.restScan);
    }
    return target === null ? null : readBack(target);
  }

  /** The fields left for the person, read again after their trusted input anywhere on the page while the run rests
   *  (v3 Phase 3 review): a pick in a page's own dropdown, a file chosen through a page's button, a box ticked or
   *  unticked, a field cleared again. Read LEFT_REFRESH_MS after the input, again while more comes; one report. */
  private scheduleLeftRefresh(): void {
    this.lastHeardAt = monotonicNow();
    if (this.leftRefreshing) return;
    this.leftRefreshing = true;
    const run = () => {
      const since = monotonicNow();
      void deadline(LEFT_REFRESH_MS, this.controller.signal).then((how) => {
        if (how === 'aborted') {
          this.leftRefreshing = false;
          return;
        }
        // More input came while it waited: read once it has settled.
        if (this.lastHeardAt > since) {
          run();
          return;
        }
        this.leftRefreshing = false;
        this.refreshLeft();
      });
    };
    run();
  }

  private refreshLeft(): void {
    if (this.ended === null || this.request.dryRun) return;
    this.restScanned = false;
    const changed = this.rows.flatMap((row) => {
      const next = this.withFilledByYou(row, this.restScanned);
      return next === row ? [] : [next];
    });
    if (changed.length > 0) log('content.left-reread', { flipped: changed.length });
    this.replaceRows(changed);
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
    // Any trusted input, click or change may have answered a field the run did not fill, wherever it landed (a page's
    // own dropdown list, a button that opens a file picker): those fields are read again (v3 Phase 3 review).
    if (this.rows.some(open)) this.scheduleLeftRefresh();
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
    // Read from the field's own elements (currentOf): never a whole scan per keystroke.
    const current = this.currentOf(key);
    const written = this.env.drafts.get(baseKey);
    const mac = current === null || written === undefined ? null : await (await this.valueHasher()).mac(current);
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
    // v3 Phase 3: a field left for the person flips in the review's lists the moment their input leaves an answer in it
    // (and back when they clear it): a flag from what the field holds, never its value.
    next = this.withFilledByYou(next, false);
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
          // A block the step saved (saveBlocks) holds its entry in the page's own summary now, its fields folded away.
          if (!row.wrote || row.verification !== 'verified' || row.provenance === 'llm-draft' || !books.has(baseKey)
            || this.savedBlocks.has(row.section)) {
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

  /** v1.3 B: every canary the run holds in memory (the frame's own scans' and the carried ones), for the form capture's
   *  screen (form-capture.ts). Never sent anywhere. */
  canariesNow(): readonly string[] {
    return this.inMemory;
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

  /** The rows changed while the run rests: the runtime's copy, the launcher's progress, the toasts and the report. */
  private rowsChanged(): void {
    this.env.onRows(this.rows);
    if (this.ended === 'review' || this.ended === 'waiting') {
      this.launcher({ state: 'review', action: 'open-review', ...this.progressNow() });
    }
    this.drawToasts();
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
    // Kept for reading the fields left for the person at rest, one by one (currentOf).
    this.restScan = fresh;
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
      const editedNow = next.reason !== 'changed-by-you' && target !== null && holdsAnswer(target.field.current)
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
    // Accepted as written (v4, D6: no draft waits for the person's confirmation).
    return { ...row, status: 'verified', provenance: 'llm-draft', matcherStage: 'not-applicable', confidence: LLM_DRAFT,
      reason: 'llm-draft-written', wrote: true, verification: 'verified', needsUserAction: false };
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
    this.cancelled.abort();
    this.pauseWatch?.abort();
    this.ended = 'stopped';
    log('content.pause-cancelled');
    this.drawToasts();
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

  private alive(): void {
    if (this.controller.signal.aborted) throw new RunAborted();
  }

  private launcher(view: LauncherView): void {
    if (this.controller.signal.aborted) return;
    this.env.ui()?.setLauncher(view);
  }

  /** v4 (D10): the toasts the page shows for this run now (ui/toasts.ts), recomputed from its state at each change, so a
   *  toast leaves once its cause is gone. */
  private drawToasts(): void {
    if (this.controller.signal.aborted) return;
    this.env.ui()?.setToasts(this.toastsNow());
  }

  /**
   * What is left for the person, as toasts (D10), in this order: the check to solve on the page (a CAPTCHA, a bot check
   * or an email code the run paused at, or one that holds Next or Submit at rest); the sign-in or account the page asks
   * for (Sign-in mode Manual, or a saved sign-in the site refused), or the job-site sign-in to add in TailorIT (Sign up
   * & Autofill, or Sign-in mode Auto, with none to use: its Open action); Submit mode Auto holding back; the page
   * refusing a Submit; errors the run could not fix; and, alone, the end of a run on the final step.
   */
  private toastsNow(): ToastSpec[] {
    const words = PAGE_COPY.toasts;
    const status = this.machine?.status ?? null;
    if (this.machine === null || status === 'done' || status === 'stopped' || this.ended === 'aborted'
      || this.ended === 'stopped') return [];
    const list: ToastSpec[] = [];
    const reason = this.machine.pauseReason;
    const paused = status === 'handoff' && (reason === 'captcha' || reason === 'bot-check' || reason === 'email-code');
    const atRest = this.ended === 'review' || this.ended === 'waiting';
    if (paused || (atRest && (this.botCheckLeft() || this.notices.has('captcha-next')
      || this.notices.has('submit-held-captcha')))) {
      list.push({ kind: 'challenge', text: words.challenge });
    }
    if (status === 'auth-needed' && this.ended === 'paused' && !this.signInDue) {
      // jr6 SHELL-A: what the sign-in said beyond its outcome (a password rule, an account error's kind), and an email
      // gate's own words (D-d).
      const detail = this.signInSaid === null ? null : this.signInDetail;
      const gate = this.restWall === 'email-gate';
      if (this.signInSaid === 'none-saved' && (this.signInAuto || this.request.signIn === true)) {
        const open = this.env.openSignInSettings;
        // jr6 SHELL-A (WD-04): while the run waits for a password to be saved, the toast says it goes on by itself.
        list.push({ kind: 'no-sign-in', text: this.passwordArrived !== null ? words.noSignInWaiting : words.noSignIn,
          ...(open === undefined ? {} : { action: { label: words.open, run: () => open() } }) });
      } else if (detail?.rule !== undefined) {
        list.push({ kind: 'sign-in', text: words.passwordRule(detail.rule.kind,
          detail.rule.kind === 'length' ? detail.rule.minLength : 0) });
      } else if (detail?.account !== undefined) {
        list.push({ kind: 'sign-in', text: words.account[detail.account] });
      } else if (this.signInSaid === 'typed') {
        // jr6: typed on Manual: the site's own button is the person's. jr6 SHELL-A: at an email gate, its Next.
        list.push({ kind: 'sign-in', text: gate ? words.gateTyped : words.signInTyped });
      } else if (this.signInSaid === 'challenged') {
        // The v4 review (M5): a challenge kept Sign-in Auto from asking: the check is what is left for the person.
        if (!list.some((toast) => toast.kind === 'challenge')) list.push({ kind: 'challenge', text: words.challenge });
      } else {
        list.push({ kind: 'sign-in', text: gate ? words.gate : this.signInSaid === 'failed' ? words.signInFailed
          : words.signIn });
      }
    }
    // jr6 SHELL-A (FIXPLAN §6.12 item 1): the form's account section left empty for a password rule of the page's own.
    const sectionRule = this.sectionDetail?.rule;
    if (atRest && sectionRule !== undefined && !list.some((toast) => toast.kind === 'sign-in')) {
      list.push({ kind: 'sign-in', text: words.passwordRule(sectionRule.kind,
        sectionRule.kind === 'length' ? sectionRule.minLength : 0) });
    }
    if (atRest) {
      const held = this.notices.has('submit-held-required') ? words.submitHeld.required
        : this.notices.has('submit-held-no-ai') ? words.submitHeld['no-ai']
          : this.notices.has('submit-held-guess') ? words.submitHeld.guess
            : this.notices.has('submit-held-attention') ? words.submitHeld.attention
              : this.notices.has('submit-held-check') ? words.submitHeld.check : null;
      if (held !== null) list.push({ kind: 'submit-held', text: held });
      if (this.notices.has('submit-errors')) list.push({ kind: 'submit-errors', text: words.submitErrors });
      if (this.notices.has('validation')) list.push({ kind: 'validation', text: words.validation });
      // The end of a run on the final step, alone (D10's optional toast): never while anything else is said.
      const progress = progressOf([{ fields: this.rows }]);
      if (list.length === 0 && this.ended === 'review' && status === 'review' && this.finalStep && !this.submitPending
        && !this.request.dryRun && progress.of > 0) {
        // The v4 review (L8): "required fields" only when the progress counts required fields, as the panel's line.
        list.push({ kind: 'complete', text: words.complete(progress.filled, progress.of, progress.requiredOnly) });
      }
    }
    // v5 p2-fill review (security 4): what the run's holds of the page's dialogs held back, counts only (never the
    // page's words), so the person knows the page said something while the run filled it.
    const { alerts, confirms } = this.heldDialogs;
    if (alerts > 0 || confirms > 0) list.push({ kind: 'dialogs', text: words.dialogs(alerts, confirms) });
    // Text on the page addressed to AI tools was ignored: the plan's own sentence, the one notice the hard rules keep
    // on the page (the trap specs read it there).
    if (this.notices.has('tripwire')) list.push({ kind: 'tripwire', text: PAGE_COPY.notices.tripwire });
    return list;
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

  /** v4 (D11): the launcher's progress, by the side panel's own rule (shared/report.ts progressOf): the percent of the
   *  required fields filled; none while no row counts. Progress only, never a count of fields "needing you". */
  private progressNow(): { percent?: number } {
    const progress = progressOf([{ fields: this.rows }]);
    return progress.of > 0 ? { percent: progress.percent } : {};
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
      this.autoAdvance = answer.data.settings.modes.next === 'auto' && (this.pushes === pushes || this.pushedAutoAdvance);
      if (this.pushes === pushes) {
        this.offerToSave = answer.data.settings.offerToSaveAnswers;
        this.llm = answer.data.settings.llm;
        this.fillAfterTurn = answer.data.settings.modes.afterPageTurn === 'auto';
        this.autoSubmitOn = answer.data.settings.modes.submit === 'auto';
        this.skipRules = { ...answer.data.settings.modes.agentSkip };
        this.signInAuto = answer.data.settings.modes.signIn === 'auto';
        this.signInTypes = answer.data.settings.typeSignIn === true;
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
    const repeatables = this.sections.map((section) => {
      const shown = kept ? [] : savedSummaries(this.env.page.adapter, section);
      return { kind: section.kind, entries: kept ? this.answers.get(section.kind)?.entries ?? null : null,
        ...(shown.length > 0 ? { shown } : {}) };
    });
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
    this.dropStaleLearned(answer);
    for (const canary of answer.persistableCanaries) this.checked.add(canary);
    if (!kept) for (const section of answer.repeatables ?? []) this.answers.set(section.kind, section);
    return answer;
  }

  /** s2 lists (the review of round 2, L2): a learned list the plan found no option of the value in is dropped for the
   *  rest of the run, once per key (dom/widgets' staleLearned): the field's next scan reads it lazy, so the waiting
   *  path reads its list whole and learns it again. */
  private dropStaleLearned(answer: PlanAnswer): void {
    if (this.learnedLists.size === 0) return;
    const scanned = this.scanNow();
    for (const key of staleLearned(answer, (fieldKey) => scanned.target(fieldKey as FieldKey))) {
      if (this.relearned.has(key)) continue;
      this.relearned.add(key);
      this.learnedLists.delete(key);
    }
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

  /** The posting this page shows beside its form, as the policy gate counts it: the posting's own text where the
   *  adapter names it (Adapter.postingText), outside the form; else every visible text outside the form. */
  private postingReadHere(): string {
    const { adapter } = this.env.page;
    if (adapter.postingText === undefined) return this.postingText();
    let scope: Element | null;
    try {
      scope = adapter.postingText(this.env.doc);
    } catch {
      scope = null;
    }
    if (scope === null || this.root.contains(scope) || scope.contains(this.root)) return '';
    return visibleTextWithout(scope, [], { cap: MAX_POSTING_TEXT }).trim();
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

  /** The report's header now: the run, its status, notices and counters, its step, and the repeatables' counts. */
  private header(runId: string): ReportHeader {
    const { page } = this.env;
    return { runId, frameId: this.frameId, platform: page.app.platform, adapter: page.adapter.id,
      dryRun: this.request.dryRun, status: this.status, pauseReason: this.machine?.pauseReason ?? null,
      notices: this.notices, counters: this.counters, now: this.env.now(),
      ...(this.repeatableCounts.length > 0 ? { repeatables: this.repeatableCounts } : {}),
      // Resting at wait-transition: the person's own Next is awaited, and nothing runs (v3 Phase 3 review).
      ...(this.resting ? { resting: true } : {}),
      // v3 Phase 4: what the step offers the panel's Next and Submit, at rest only, never in a dry run.
      ...(this.buttonsNow() ?? {}),
      ...(this.stepped && this.machine !== null
        ? { step: { index: this.machine.stepIndex, progress: this.stepProgress ?? undefined } } : {}) };
  }

  /** report/put: the step's rows and the run's notices, never a value. A refusal other than a second 'expired' is
   *  logged. */
  private async report(): Promise<void> {
    const rows = this.rows;
    const answer = await this.call<'report/put'>((runId) => {
      const report = buildReport(this.header(runId), rows);
      if (report === null) throw new RunFailure('internal');
      return { v: 1, type: 'report/put', runId, report };
    }, () => this.env.limiter.turn(this.controller.signal));
    if ('failed' in answer) log('content.report-refused');
  }

  /** The loop's progress (v3 Phase 3): kept, and sent within LIVE_REPORT_MS (liveReport). */
  private liveProgress(rows: readonly FillResult[], pending: readonly FieldKey[], current: FieldKey | null): void {
    if (this.request.dryRun || this.controller.signal.aborted) return;
    this.live = { rows, pending, current };
    // The launcher's badge says how far the fill is, by the side panel's own rule (shared/report.ts progressOf).
    const progress = progressOf([{ fields: rows, filling: { current, pending } }]);
    this.launcher({ state: 'running', action: null, ...(progress.of > 0 ? { percent: progress.percent } : {}) });
    this.scheduleLive();
  }

  /** A progress report once LIVE_REPORT_MS have passed since the last; one waits at a time, and it reads the progress
   *  as it is when it goes. */
  private scheduleLive(): void {
    if (this.liveWaiting) return;
    this.liveWaiting = true;
    const wait = Math.max(0, LIVE_REPORT_MS - (monotonicNow() - this.liveSentAt));
    const gate = this.liveGate;
    void deadline(wait, this.controller.signal).then((how) => {
      this.liveWaiting = false;
      if (how === 'aborted' || this.live === null || gate !== this.liveGate) return;
      this.liveSentAt = monotonicNow();
      void this.liveReport(gate).catch(() => undefined);
    });
  }

  /**
   * A report while the run works (v3 Phase 3): "Scanning the page" before any row, then each row the loop knows with the
   * field being written now and those still to be written (`filling`), so the side panel shows "Autofilling… NN%" and
   * spins the current row. It never renews the run and nothing waits for it: a refusal is dropped. It is built when its
   * slot comes, and not sent once the step's fill has ended (its own report says more, and goes after it).
   */
  private async liveReport(gate: number): Promise<void> {
    if (this.id === null) return;
    await this.liveLimiter.turn(this.controller.signal);
    const runId = this.id;
    const live = this.live;
    // Built and sent in one go, after the gate's check: a step whose fill ended meanwhile sends nothing more of it.
    if (this.controller.signal.aborted || runId === null || this.ended !== null || gate !== this.liveGate) return;
    const report = buildReport({ ...this.header(runId), filling: live === null ? { current: null, pending: [] }
      : { current: live.current, pending: [...live.pending] } }, live?.rows ?? []);
    if (report === null) return;
    const answer = await this.env.channel.request({ v: 1, type: 'report/live', runId, report });
    if (!answer.ok) log('content.report-refused');
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
        // What a posting that forbids AI does is the person's setting (module header): never a card (v4, D6).
        if ((this.llm?.whenForbidden ?? 'profile-only') === 'profile-only') this.profileOnly('posting');
        else this.notices.add('policy');
      } else if (hiddenPolicyHits(fresh).length > 0) {
        this.hiddenPolicy = true;
      }
    }
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
    const shown = detectPause(this.env.doc, this.root, this.env.page.adapter, newScanCache(),
      handed === undefined ? {} : { handed });
    // jr6 SHELL-A (D-d): while the run fills an email gate as a step, the gate itself is no pause (gateFilling): a check
    // or a code the page shows still is.
    return this.gateFilling && shown?.kind === 'email-gate' ? null : shown;
  }

  // ── jr6 SHELL-A (D-d; FIXPLAN §6.12 item 6, APPLYPLAN G: ICIMS-18, O9, AP-3, C5) ──
  /** Whether the page shows an email gate whose form its adapter declares (Adapter.signInForm 'email-gate': iCIMS's
   *  form#enterEmailForm, Oracle's gate), in a frame that may sign in (the tab's top frame, or the one that claims its
   *  application). */
  private gateDeclared(): boolean {
    if (!this.isTop && !this.claimed) return false;
    try {
      return signInFormOf(this.env.page.adapter, this.env.doc, 'email-gate') !== null;
    } catch {
      return false;
    }
  }

  /** Whether `signal` is an email gate the run fills as a step (gateFilling) before its sign-in step, in every Sign-in
   *  mode: its own fields from the profile like any step's (iCIMS's phone and its country code: the owner question OQ8's
   *  default yes, as Jobright fills them: ~contents/sites/icims getIcimsEmailPhoneCountryWidget; Oracle's email), its
   *  consent boxes decided by the plan per the Consents mode, a consent's scope the person's (no rule answers it), and
   *  never a press: its Next is the sign-in step's, on Auto alone. ICIMS-18's and O9's fix ("fill the gate's fields in an
   *  ordinary run"). */
  private gateFillable(signal: PauseSignal | null): boolean {
    return signal?.kind === 'email-gate' && this.gateDeclared();
  }
  // ── end jr6 SHELL-A ──

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
      fillAfterPageTurn: this.fillAfterTurn, ...(capMs === undefined ? {} : { transitionCapMs: capMs }),
      autoSubmit: this.autoSubmitOn && !this.request.dryRun ? this.skipRules : null };
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
    }
    return produced;
  }

  /** Feeds the machine from `first` until the run ends, resting where the person or the page must act. With Autofill
   *  after page turn: Manually, a new step (the person's Next, or ours) is not scanned or filled: the run offers
   *  Continue on it (pageTurned). */
  private async drive(first: RunEvent): Promise<void> {
    let event: RunEvent | null = first;
    for (;;) {
      while (event !== null) {
        if (event.type === 'TRANSITIONED' && !this.fillAfterTurn && this.stepped && !this.request.dryRun
          && event.signature !== this.state.stepSignature) {
          this.pageTurned();
          event = null;
          break;
        }
        event = await this.step(event);
      }
      await this.flushReport();
      event = await this.rest();
      // A confirmation that came while the run worked (submittedSeen) is taken now that it rests.
      if (event === null && this.submittedLate && this.ended !== null && this.ended !== 'stopped') {
        this.submittedLate = false;
        event = { type: 'SUBMITTED' };
        this.working();
      }
      // v5 (PLAN decision 9): a refusal for the page's check that came while the run worked (refusedForCheck).
      if (event === null && this.refusedLate && this.ended !== null && this.ended !== 'stopped'
        && this.ended !== 'paused') {
        this.refusedLate = false;
        event = { type: 'PAUSE', reason: 'captcha', refused: true };
        this.working();
      }
      if (event === null) return;
    }
  }

  /** The run comes to rest: it ends, or (at review, on a step the adapter tells apart) watches for the person's own
   *  Next. Answers the event that starts it again, or null. */
  private async rest(): Promise<RunEvent | null> {
    const { status } = this.state;
    if (this.offered || status === 'handoff' || status === 'auth-needed') {
      this.launcher({ state: 'needs-you', action: 'continue', reason: 'pause', ...this.progressNow() });
      this.end('paused');
      const signing = status === 'auth-needed' && this.signInDue;
      // v3 Phase 5: Sign-in mode Auto signs in now that the pause is reported (module header); its own outcome carries
      // the run on, or starts the watch below once the sign-in is the person's.
      if (signing) void this.signInNow().catch(() => undefined);
      // v4 (D7): Workday's entry choice is answered with the adapter's declared entry ("Apply manually").
      else if (status === 'handoff' && this.state.pauseReason === 'entry-choice') void this.enterChoiceNow();
      // v4 (D10): the run carries on by itself once the page no longer shows its pause.
      if (!this.offered && !signing) void this.watchPauseGone().catch(() => undefined);
      return null;
    }
    if (status === 'stopped' || status === 'done') {
      this.launcher({ state: 'idle', action: 'fill' });
      this.end('stopped');
      return null;
    }
    if (status === 'wait-transition') {
      // A wait the run could not keep (a dry run, or the watch ended): the person's turn, reported as a rest.
      this.resting = true;
      this.end('waiting');
      this.reportDue = true;
      await this.flushReport();
      return null;
    }
    this.launcher({ state: 'review', action: 'open-review', ...this.progressNow() });
    this.end('review');
    // Core pass Z1, item 24: Sign-in mode Auto presses the step's declared sign-in container now it rests.
    if (status === 'review') void this.signInContainerNow().catch(() => undefined);
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
        signal: AbortSignal.any([this.controller.signal, this.stopping.signal, this.confirmed.signal,
          this.checkRefused.signal]), watchNext,
        ...(this.env.options.settle ? { settle: this.env.options.settle } : {}) });
      this.alive();
      if (outcome.kind === 'aborted') {
        if (this.stopRequested) return { type: 'USER_STOPPED' };
        if (this.controller.signal.aborted) return null;
        if (this.confirmed.signal.aborted) return { type: 'SUBMITTED' };
        // v5 (PLAN decision 9): the page refused a press for its check (refusedForCheck): the CAPTCHA pause.
        if (this.checkRefused.signal.aborted) {
          this.refusedLate = false;
          return { type: 'PAUSE', reason: 'captcha', refused: true };
        }
        return null;
      }
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

  /** A new step under Autofill after page turn: Manually (the person's mode, docs/SPEC-AMENDMENTS.md §12): its fields
   *  are not read or filled, and the run rests offering Continue, which fills it (v4, D7: silently, no notice: the
   *  panel's Autofill fills the new page). */
  private pageTurned(): void {
    this.notices.forget(STEP_NOTICE_CODES);
    this.rows = [];
    this.counters = NO_COUNTERS;
    this.addsLeft = 0;
    // Nothing of the step left behind is said of the new one: its sections and its progress line go too.
    this.repeatableCounts = [];
    this.stepProgress = null;
    this.live = null;
    this.liveGate += 1;
    this.reportStatus = 'review';
    this.offered = true;
    this.reportDue = true;
    this.drawToasts();
    log('content.page-turned');
  }

  /** The run works again (the step moved on under it). */
  private working(): void {
    this.ended = null;
    this.resting = false;
    this.restScan = null;
    this.pauseWatch?.abort();
    this.launcher({ state: 'running', action: null });
    this.drawAiEdits();
    this.drawToasts();
  }

  private end(how: RunEnd): RunEnd {
    // jr6 SHELL-A (D-d): a run at rest fills no gate: the gate is its pause again (a fill cut before its validation).
    this.gateFilling = false;
    this.ended = how;
    this.liveGate += 1;
    const resolve = this.restedOnce;
    this.restedOnce = null;
    resolve?.(how);
    this.drawAiEdits();
    this.drawToasts();
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
        return this.paused();
      case 'notify':
        this.notify(effect.notice, effect.count);
        return null;
      case 'press-submit':
        await this.autoSubmit();
        return null;
      case 'show-review':
        this.showReview(effect.cause);
        return null;
      case 'offer-continue':
        this.offered = true;
        // A run found after a reload that offers Continue rests (the audit of 2026-11-06, m3): its report says so, as
        // a turned page's does (pageTurned), never the status it was stored at while it worked.
        this.reportStatus = 'review';
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
    this.repeatableCounts = [];
    this.drawAiEdits();
    // The side panel says "Scanning the page" at once (v3 Phase 3).
    this.liveGate += 1;
    if (!this.request.dryRun) void this.liveReport(this.liveGate).catch(() => undefined);
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
      // A top frame whose page shows the posting beside the form read it here (policy.ts POSTING_READ_MIN): only the
      // posting's own text where the adapter names it (Adapter.postingText).
      const readHere = this.isTop && [...this.postingReadHere()].length >= POSTING_READ_MIN;
      const gate = policyGateOf(this.policy ?? { postingPage: 'unseen', storedCopy: 'unavailable' }, frameHits,
        readHere);
      policyHits = gate.blocked ? Math.max(1, frameHits.length) : 0;
      this.fromStoredCopy = gate.fromStoredCopy;
    }
    // A posting that forbids AI (module header): the run fills on, from the profile only (the default) or with the AI,
    // and the report says which (v4, D6: never a card, nothing waits).
    if (policyHits > 0 && this.state.policyDecision !== 'accepted') {
      if ((this.llm?.whenForbidden ?? 'profile-only') === 'profile-only') this.profileOnly('posting');
      else this.notices.add('policy');
      if (first && this.fromStoredCopy) this.notices.add('policy-stored-copy');
    }
    const raw = await rawScan(env.doc, { signal: this.controller.signal });
    this.alive();
    const fresh = this.absorbPassages(raw.passages);
    // Policy text only text a person cannot see yet holds (behind "Show more") stops nothing (S6); Submit mode Auto's
    // "posting forbids AI" skip rule still reads it.
    if (policyHits === 0 && hiddenPolicyHits(first ? raw.passages : fresh).length > 0) this.hiddenPolicy = true;
    this.gateFilling = false;
    const paused = this.pauseNow();
    if (paused !== null) {
      // jr6 SHELL-A (D-d): an email gate whose form the adapter declares is filled as a step first; its pause comes at
      // the validation (gateFillable).
      if (!this.gateFillable(paused)) return pauseEventOf(paused);
      this.gateFilling = true;
      log('content.sign-in', { gate: true, filled: true });
    }
    const hits = Math.max(0, this.tripwireHits - this.hitsCounted);
    this.hitsCounted = this.tripwireHits;
    const signature = this.signatureNow();
    this.noteLoadErrors(signature);
    this.stepProgress = this.progressRead;
    return { type: 'SCANNED', signature, policyHits, tripwireHits: hits, canaries: this.sent };
  }

  /** The adapter's errors a person can see now, on the step's root; v5 (PLAN decision 9): a site's CAPTCHA-required
   *  error the person's solved check made stale is none (pause-detect.ts withoutSolvedCaptchaErrors). */
  private errorsNow(root: Element, cache = newScanCache()): Element[] {
    try {
      return withoutSolvedCaptchaErrors(this.env.page.adapter.errors?.(root) ?? [], this.env.doc, cache)
        .map((error) => error.el).filter((el) => isUserVisible(el, cache));
    } catch {
      return [];
    }
  }

  /** The behaviour review of 2026-11-06 (minor 7): at a step's first scan in the run, the errors the page shows before
   *  the extension wrote anything (the document's first run, not resumed nor continued, no write on the step): an item
   *  the page marks invalid on load (Oracle's profile item, fixtures/oracle/hjf-apply-section's
   *  .beautiful-timeline-item--invalid-block) is the person's, never the run's failure. */
  private noteLoadErrors(signature: string | null): void {
    if (this.loadErrors !== null && this.loadErrors.signature === signature) return;
    const fresh = this.env.firstInDocument === true && this.request.from === undefined
      && this.request.carry === undefined && (signature === null || !this.carries.has(signature));
    this.loadErrors = { signature, errors: new Set(fresh ? this.errorsNow(this.rootNow()) : []) };
  }

  /** Whether every error the validation read last was shown at the step's first scan, before anything was written. */
  private errorsOnLoad(): boolean {
    const load = this.loadErrors;
    return load !== null && load.signature === this.state.stepSignature && this.lastErrorEls.length > 0
      && this.lastErrorEls.every((el) => load.errors.has(el));
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
    // core-x, item 2: the form's account section follows Sign-in mode: on Auto, the saved sign-in typed into it once per
    // step (nothing pressed), before the rest of the form fills; on Manual it is the person's (validate holds Next).
    await this.signInAccountSection();
    this.alive();
    if (this.stopRequested) return { type: 'USER_STOPPED' };
    this.loopCut = null;
    this.fillStartedAt = monotonicNow();
    this.rows = [];
    this.savedBlocks = new Set();
    this.drawAiEdits();

    this.sections = sectionsOf(adapter, this.rootNow());
    // The editors the step began with that held nothing: their Save is the run's to press as much as the ones it opens
    // (repeatables.ts saveBlocks). The rows of the blocks a round saved stand for them in the rounds after it.
    const emptyAtStart = new Set<Element>();
    const opened = new Set<Element>();
    const savedRows = new Map<FieldKey, FillResult>();
    const written: FieldKey[] = [];
    // A page that keeps an entry only once its own Save is pressed (Workable's Add, disabled while an editor is open)
    // takes one entry a round: add, fill, save, until the profile's entries are in, never more rounds than entries.
    let rounds = 1;
    // jr7 ENGINE-7 E2 item 5 (UKGR-9): the single-entry editors the adapter names are opened first, each once per
    // document (dom/fillers/editor-opener.ts), never in a dry run; the loop then reads the fields they draw.
    if (!this.request.dryRun && openEditors(adapter, this.env.doc, this.rootNow()) > 0) {
      await deadline(EDITOR_OPEN_MS, this.controller.signal);
    }
    for (let round = 0; ; round += 1) {
      // 1. Repeatable sections: the worker's entry counts, then the Add clicks (never in a dry run).
      this.answers.clear();
      let outcomes: Awaited<ReturnType<typeof addBlocks>> = [];
      if (this.sections.length > 0) {
        const now = this.scanNow();
        if (round === 0) {
          for (const section of this.sections.filter((one) => one.save !== undefined)) {
            for (const [index, block] of section.blocks().entries()) {
              const name = sectionKey({ id: section.kind, block: index });
              const fields = now.fields.filter((field) => sectionKey(field.section) === name);
              if (fields.length > 0 && isBlockEmpty(fields)) emptyAtStart.add(block);
            }
          }
        }
        await this.plan(now.fields.map(toFieldSpec), [], 0);
        if (round === 0) {
          const entries = [...this.answers.values()].map((one) => one.profile);
          rounds = Math.min(MAX_REPEATABLE_BLOCKS, Math.max(1, ...entries));
        }
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
          for (const outcome of outcomes) for (const block of outcome.opened) opened.add(block);
        }
      }
      this.addsLeft = needsClicks(outcomes);
      // "Education · 2 of 3 added" (v3 Phase 3): the profile's entries, and the blocks the form shows for them now.
      this.repeatableCounts = outcomes.map((outcome) => ({ kind: outcome.kind,
        added: Math.min(outcome.counter.rendered, outcome.counter.profile), of: outcome.counter.profile }))
        .filter((count) => count.of > 0);

      // 2. The reactive loop, "I currently work here", then the final Guard over its rows and its latest scan. The loop
      // starts from this step's books in this run, and leaves its own for the step's next attempt (C-S3, C-S5).
      const signature = this.state.stepSignature;
      let loop: LoopResult;
      try {
        loop = await this.fillLoop(signature === null ? undefined : this.carries.get(signature));
      } finally {
        // The step's own report says more than its progress from here on.
        this.live = null;
        this.liveGate += 1;
      }
      if (signature !== null && !this.request.dryRun) this.carries.set(signature, loop.carry);
      written.push(...loop.written.map((entry) => entry.key).filter((key) => !written.includes(key)));
      const last = loop.scan;
      // A block an earlier round saved folded its fields away: its rows are the ones that round left.
      let rows = new Map(loop.rows.map((row) => [row.key, savedRows.get(row.key) ?? row]));
      for (const [key, row] of savedRows) if (!rows.has(key)) rows.set(key, row);
      for (const section of this.sections) rows = currentJobRows(rows, last, section, this.answers.get(section.kind));
      // The drafts the person confirmed earlier in the run read back as confirmed (Phase 6).
      const confirmedDrafts = new Set([...rows.keys()].filter((key) => this.confirmedDrafts.has(baseKeyOf(key))));
      const guarded = finalGuard({ adapter, root: this.rootNow(), canaries: this.inMemory, confirmedDrafts }, last,
        rows, loop.written);
      const after = guarded.reverted.size > 0 ? last.rescan() : last;

      // 3. The rows and notices. v4 (D7): a page still busy at the settle's cap is no hand-off: the step is validated as
      // it stands, not settled, so Next is never pressed by itself and the run rests for the person's own.
      const busy = loop.busy !== null;
      // Set by the checks before a later pass (recheck), while the loop ran.
      const cut = this.loopCut as LoopCut | null;
      if (cut?.kind === 'hidden') {
        log('content.form-hidden');
        this.notices.add('form-hidden');
      }
      // The person's confirmations and edits during the fill stand on the rows (Phase 6), and so do the drafts this
      // document wrote (E4).
      const rowsNow = [...guarded.rows.values(), ...last.unrecognisedUploads.map(uploadRow),
        // jr7 ENGINE-7 E1 item 10 (jr7-O7): a row for each required block left empty.
        ...this.requiredBlocksNow().map((block, ordinal) => requiredBlockRow(block, ordinal, this.env.page.app.platform))];
      const macs = await this.draftMacs(after, rowsNow);
      this.alive();
      const marked = this.markedRows(rowsNow, after, loop.carry.lastWriteAt, macs);
      this.bookDrafts(marked, macs);
      // v5 p2-stream (the P2 review, security 5): what was written from a voided reply is flagged for review.
      const all = this.reviewedRows(marked);
      this.noticesFromRows(all);
      this.counters = { passes: loop.passes, hiddenControlsIgnored: last.counters.hiddenControlsIgnored,
        deferredFields: last.counters.deferredFields };
      this.rows = all;
      this.settledStep = !busy;
      env.onRows(all);
      this.drawAiEdits();
      this.recordFindings(loop);

      // 4. How the step's fill ended.
      if (cut?.kind === 'hidden') return { type: 'USER_STOPPED' };
      if (cut?.kind === 'moved' && !this.stopRequested) return { type: 'TRANSITIONED', signature: cut.signature };
      if (this.stopRequested) return { type: 'USER_STOPPED' };
      if (cut?.kind === 'pause') return pauseEventOf(cut.signal);
      // 5. The blocks whose page keeps an entry only once its own Save is pressed (repeatables.ts saveBlocks:
      // Workable's editors): never in a dry run, only in a block the run opened or found empty, and only once its rows
      // hold our values with nothing left for the person; a block left open is the person's to finish (the needs-click
      // notice). A save that frees the Add for an entry still to add starts the next round.
      if (!this.request.dryRun && this.sections.some((section) => section.save !== undefined)) {
        const since = this.fillStartedAt;
        const saves = await saveBlocks({ adapter, root: this.rootNow(), signal: this.controller.signal,
          ...(env.options.settle ? { settle: env.options.settle } : {}),
          ours: (block) => opened.has(block) || emptyAtStart.has(block),
          // The person's own edits only: Chromium's trusted input after our click on a box is no edit (touches.ts E3).
          touched: (block) => env.touches.editedSince(block, since) }, this.sections, all);
        this.alive();
        this.savedBlocks = new Set([...this.savedBlocks, ...saves.saved]);
        for (const row of all) if (saves.saved.includes(row.section)) savedRows.set(row.key, row);
        if (this.stopRequested) return { type: 'USER_STOPPED' };
        const profile = new Map([...this.answers].map(([kind, answer]) => [kind, answer.profile]));
        if (saves.saved.length > 0 && saves.left === 0 && round + 1 < rounds && moreToAdd(this.sections, profile)) {
          // The next round counts again what is left for the person.
          this.notices.forget(['needs-click']);
          continue;
        }
        if (saves.left > 0) this.addsLeft += saves.left;
        // An entry the profile has that no block holds yet stays out of the form (v4, D1: nothing asks the person).
        this.addsLeft = Math.max(this.addsLeft, entriesLeft(this.sections, profile));
      }
      // v4 (D3): only a required field left empty, or a hard-rule stop, holds auto-Next (report.ts lastFillOf). jr7
      // ENGINE-7 E1 item 11 (ICIMS7-V4): left empty as this step's fresh scan reads it (heldIn).
      const counts = lastFillOf(all.map((row) => heldIn(after, row)));
      return { type: 'FILLED', filledKeys: written, flagged: counts.flagged, blocked: counts.blocked,
        unresolved: counts.unresolved };
    }
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
      widgetReadings: this.widgetReadings, learnedLists: this.learnedLists, storedLists: this.storedLists });
  }

  /** validate: the step's errors and facts (module header, 6). */
  private validateStep(): RunEvent {
    const { env } = this;
    const { adapter } = env.page;
    const root = this.rootNow();
    // Another step shows already (the person's Next during the fill): its facts are not this step's to judge.
    const moved = this.movedOn();
    if (moved !== null) return { type: 'TRANSITIONED', signature: moved };
    // jr6 SHELL-A (D-d): an email gate filled as a step is its pause again from here: its sign-in step comes now.
    this.gateFilling = false;
    // What the step's last write revealed may be a pause: it is the person's, never a reason to press on (C-S1).
    const paused = this.pauseNow();
    if (paused !== null) return pauseEventOf(paused);
    const cache = newScanCache();
    // v5 (PLAN decision 9): the page refused a Next for its unticked check (a Next, ours or the person's, that left the
    // step as it was: lastFill cleared), or shows its CAPTCHA-required error beside it: the check is the person's, and
    // the run carries on by itself once it is solved (refusedByCheck, watchPauseGone).
    if (!this.request.dryRun && captchaRefusalShown(env.doc, root, adapter, { afterPress: this.state.lastFill === null },
      cache)) {
      this.refusedByCheck = true;
      log('content.captcha-refused', { next: true });
      return { type: 'PAUSE', reason: 'captcha', refused: true };
    }
    const errors = this.errorsNow(root, cache);
    this.lastErrorEls = errors;
    // jr6 SHELL-B (ICIMS-17): an IForm leaf's portal step facts (chain-frame.ts), else null: its step judged by them.
    const facts = chainFactsOf(env.doc); // jr6 SHELL-B
    let finality: StepFacts['finality'] = 'unknown';
    try {
      finality = adapter.isFinalStep?.(env.doc, facts) ?? 'unknown'; // jr6 SHELL-B: facts
    } catch {
      finality = 'unknown';
    }
    let next: HTMLElement | null = null;
    try {
      next = adapter.nextButton?.(root, facts) ?? null; // jr6 SHELL-B: facts
    } catch {
      next = null;
    }
    const nextVisible = next !== null && isUserVisible(next, cache) && (next as HTMLButtonElement).disabled !== true;
    this.lastErrors = errors.length;
    this.finalStep = finality === 'final';
    // v3 Phase 4, for Submit mode Auto: what its verdict reads of the final step (the core decides).
    const submitFacts = finality === 'final' && this.autoSubmitOn && !this.request.dryRun ? this.submitFacts() : {};
    // core-x, item 2: the form's account section's required boxes still empty (dom/account-section.ts).
    const accountLeftNow = accountLeft(adapter, env.doc, root);
    return { type: 'VALIDATED', errors: errors.length, fixable: this.fixable(errors), step: { finality, nextVisible,
      settled: this.settledStep,
      unconfirmedDrafts: this.rows.filter((row) => row.provenance === 'llm-draft' && row.needsUserAction).length,
      captchaUnsolved: this.challengedNow(cache), ...submitFacts,
      ...(accountLeftNow > 0 ? { accountLeft: accountLeftNow } : {}) } };
  }

  /** What Submit mode Auto's verdict reads of the final step (v3 Phase 4): Submit shown, the required questions still
   *  left unanswered (press.ts requiredLeftOf: hidden uploads and the run's own rows left for the person included),
   *  the posting forbidding AI (its notice), a legal answer that was the AI's guess, and an attention check left for
   *  the person and profile entries still to add (the Phase 7a review). */
  private submitFacts(): Pick<StepFacts, 'submitVisible' | 'requiredEmpty' | 'noAi' | 'legalGuess' | 'attentionLeft'
    | 'entriesLeft'> {
    const buttons = stepButtonsOf({ doc: this.env.doc, adapter: this.env.page.adapter, root: this.rootNow(),
      facts: chainFactsOf(this.env.doc) }); // jr6 SHELL-B (ICIMS-17): an IForm leaf's portal step facts, else null
    const noAi = this.hiddenPolicy || POSTING_NO_AI.some((code) => this.notices.has(code));
    const legalGuess = this.rows.some((row) => row.reason === 'ai-guess' && policyClassOf(row.category) === 'legal');
    // v4: an attention check the run never answers (the posting's phrase) and left empty: the hard rule's hold.
    const attentionLeft = this.rows.some((row) => row.reason === 'attention-check' && notFilled(row));
    // core-x, item 2: an account section's required boxes still empty count as required fields left (they are no rows).
    const account = accountLeft(this.env.page.adapter, this.env.doc, this.rootNow());
    return { submitVisible: buttons.submit,
      // jr7 ENGINE-7 E1 item 10 (jr7-O7): and each required block the adapter reads empty (Oracle's Skills).
      requiredEmpty: requiredLeftOf(this.scanNow(), this.leftRequired()) + account + this.requiredBlocksNow().length,
      noAi, legalGuess, attentionLeft, entriesLeft: this.addsLeft };
  }

  // ── jr7 ENGINE-7 E1 item 10 (jr7-O7) ──
  /** The required blocks of the form that hold no control and no entry yet, as the adapter reads them now
   *  (Adapter.requiredBlocksLeft: Oracle's required Skills list with no tile, snapshot7 oraclecloud1), each still in
   *  the page; none where it declares none, or where its hook throws. Submit mode Auto holds for each
   *  ('submit-held-required'), the agent ending needs-you required_field_empty before any Submit, and the review shows
   *  a row for each (requiredBlockRow). */
  private requiredBlocksNow(): Element[] {
    const adapter = this.env.page.adapter;
    if (adapter.requiredBlocksLeft === undefined) return [];
    try {
      return adapter.requiredBlocksLeft(this.rootNow()).filter((block) => block.isConnected);
    } catch {
      return [];
    }
  }
  // ── end jr7 ENGINE-7 E1 item 10 ──

  /** The audit of 2026-11-06: whether the step holds a challenge the person must answer, which holds Next, Submit mode
   *  Auto and the agent as an unsolved CAPTCHA does: one anywhere on the page, not known solved, or a frame that reads
   *  like one (S-7, pause-detect.ts pageChallenged), or a bot check asked as a question still left for the person (a
   *  'bot-check' row: "Are you a robot?", "What is 4 + 3?", a site's own "I'm not a robot" box; S-2, S-3). */
  private challengedNow(cache = newScanCache()): boolean {
    return this.botCheckLeft() || pageChallenged(this.env.doc, cache);
  }

  /** Whether a bot check asked as a question is still left for the person on the step (S-2, S-3). */
  private botCheckLeft(): boolean {
    return this.rows.some((row) => row.reason === 'bot-check' && leftForPerson(row));
  }

  /** The keys of the step's rows on required fields still empty (v4: shared/report.ts notFilled, whoever's they are). */
  private leftRequired(): string[] {
    // jr7 ENGINE-7 E1 item 10 (jr7-O7): a required block's row is no field's: the blocks are counted as the adapter
    // reads them now (requiredBlocksNow), never by a row of an earlier read.
    return this.rows.filter((row) => row.required && notFilled(row) && row.section !== REQUIRED_BLOCKS_SECTION_KEY)
      .map((row) => row.key);
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
        // v4 (D7): no hand-off: the run rests for the person's own Next.
        return { type: 'NEXT_WITHHELD', reason: 'not-pressable' };
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
    // A CAPTCHA handed to the person and not known solved since, anywhere on the page (X-S4, tightened; S-7), or a bot
    // check asked as a question still left for them (S-2, S-3): Next is theirs.
    if (this.challengedNow()) {
      log('content.next-withheld');
      return { type: 'NEXT_WITHHELD', reason: 'captcha-unsolved' };
    }
    const facts = chainFactsOf(this.env.doc); // jr6 SHELL-B (ICIMS-17): an IForm leaf's portal step facts, else null
    let next: HTMLElement | null = null;
    try {
      next = adapter.nextButton?.(root, facts) ?? null; // jr6 SHELL-B: facts
    } catch {
      next = null;
    }
    // v4 (D7): no Next to press, or a click the page refused: no hand-off, the run rests for the person's own Next.
    if (next === null || !isUserVisible(next, newScanCache())) return { type: 'NEXT_WITHHELD', reason: 'not-pressable' };
    // v1.3 B: the step's questions and answers, read before it is left.
    this.env.stepLeaving?.();
    if (!clickIfAllowed(next, { adapter, root, allowNext: true, facts })) { // jr6 SHELL-B: facts
      log('content.next-refused');
      return { type: 'NEXT_WITHHELD', reason: 'not-pressable' };
    }
    log('content.next-pressed');
    return { type: 'ADVANCED', by: 'extension' };
  }

  /** await-transition: after our click, a capped wait while the run works; the person's turn, a rest (module header,
   *  8). A dry run never waits. */
  private async awaitStep(from: string, capMs: number | null): Promise<RunEvent | null> {
    if (capMs !== null) return this.watchStep(from, capMs, false);
    // It rests from here (resting): the report says so, and the panels show the review, not "Autofilling".
    this.resting = true;
    this.reportDue = true;
    await this.flushReport();
    this.launcher({ state: 'review', action: 'open-review', ...this.progressNow() });
    this.end('waiting');
    if (this.request.dryRun) return null;
    return this.watchStep(from, null, true);
  }

  /** pause {auth, handoff}: the page shows what only the person does; the run carries on once it goes (v4: by itself,
   *  watchPauseGone; or their Continue starts the next run, the runtime). At a CAPTCHA pause the widgets the step shows
   *  now are what the person is handed (carryOut, X-S4). */
  private paused(): null {
    // v3 Phase 5: a sign-in or account page, with Sign-in acting as Auto (or v4's Sign up & Autofill for this run): the
    // run signs in once it rests.
    // The v4 review (behaviour H2): only while the page shows an account wall now. A run restored at its sign-in pause
    // in the document the sign-in brought (resumeStored) shows none: it carries on (watchPauseGone), never asking for a
    // sign-in it no longer needs.
    const auto = this.signInAuto || this.request.signIn === true;
    // jr6: on Manual, a saved password is typed into a sign-in or account's creation (never an email gate's Next).
    // jr6 SHELL-A (D-d): and an email gate whose form the adapter declares gets its email in every Sign-in mode, no
    // password needed (the worker answers the Sign-up Information email, else the profile's); its Next stays Auto's.
    const gate = this.pauseNow()?.kind === 'email-gate' && this.gateDeclared();
    const typing = !auto && ((this.signInTypes && this.typeableWallShown()) || gate);
    const due = this.state.status === 'auth-needed' && (auto || typing)
      && !this.request.dryRun && this.env.signIn !== undefined && (this.isTop || this.claimed) && this.wallShown();
    // An account form whose press is the person's, typed already at this wall of the document (sign-in.ts
    // signInHandedOver): the run rests at it for them, never typing it again; its toast says what was typed.
    const kind = this.pauseNow()?.kind;
    // jr6 SHELL-A: the wall the run rests at, for its toasts.
    this.restWall = kind === 'sign-in' || kind === 'create-account' || kind === 'email-gate' ? kind : null;
    const handedOver = due && signInHandedOver(this.env.doc, kind === 'sign-in' || kind === 'create-account'
      || kind === 'email-gate' ? kind : null);
    if (handedOver) this.signInSaid = 'typed';
    this.signInDue = due && !handedOver;
    this.signInTyping = this.signInDue && typing;
    if (this.signInDue && !this.signInTyping) this.notices.add('sign-in-auto');
    if (this.state.pauseReason === 'captcha') {
      const signature = this.signatureNow();
      const before = this.handed !== null && this.handed.signature === signature ? [...this.handed.elements] : [];
      this.pausedBy = { signature, elements: new Set([...before, ...captchaElements(this.env.doc, this.root)]) };
    }
    this.launcher({ state: 'needs-you', action: 'continue', reason: 'pause', ...this.progressNow() });
    return null;
  }

  /** Whether the page shows an account wall now (a sign-in, an account's creation, an email gate: pauseNow). */
  private wallShown(): boolean {
    const kind = this.pauseNow()?.kind;
    return kind === 'sign-in' || kind === 'create-account' || kind === 'email-gate';
  }

  /** jr6: whether the wall the page shows is one Sign-in Manual types a saved password into (a sign-in, an account's
   *  creation), never an email gate, which asks no password (jr6 SHELL-A: its email is typed on Manual by paused's own
   *  rule, gateDeclared, saved password or not). */
  private typeableWallShown(): boolean {
    const kind = this.pauseNow()?.kind;
    return kind === 'sign-in' || kind === 'create-account';
  }

  /** The pause kinds the machine's own pause stands for (the v4 review, behaviour H2): an auth-needed run's account
   *  walls, a handoff's reason where the page shows it (a CAPTCHA, an email code, an entry choice, a password reset).
   *  Null for a pause no page signal names (a page still busy, a Next not taken, a bot check asked as a question). */
  private restingKinds(): ReadonlySet<PauseSignal['kind']> | null {
    const state = this.machine;
    if (state === null) return null;
    if (state.status === 'auth-needed') return new Set(['sign-in', 'create-account', 'email-gate']);
    if (state.status !== 'handoff') return null;
    switch (state.pauseReason) {
      case 'captcha':
      case 'email-code':
      case 'entry-choice':
      case 'forgot-password':
        return new Set([state.pauseReason]);
      default:
        return null;
    }
  }

  /**
   * v4 (D10): while the run rests at a pause the page shows (a CAPTCHA, a bot check, an email code, a sign-in or account
   * wall, a password reset, a choice of how to apply), the page is looked at again with the pause detection
   * (pauseNow) PAUSE_LOOK_MS after each DOM change (the changes of a moment read once), for PAUSE_WATCH_MS at most. Once
   * it no longer shows the pause it showed when the run came to rest (gone, or another one), the run carries on by
   * itself (RunEnv.afterSignIn: the runtime's Continue, which scans again and pauses again where it must). Nothing is
   * ever done to the challenge itself: it is only read for being there. A Sign-in Auto on its way first finishes.
   * The v4 review (behaviour H2): the pause it rests at is the machine's (restingKinds), as the page shows it now; one
   * the page no longer shows (a run restored at a sign-in, CAPTCHA or email code pause in the new document the person's
   * answer brought: resumeStored) has gone already, and the run carries on at once, bounded by the runtime's
   * MAX_AUTO_CONTINUES. A pause no page signal names is read from what the page shows at rest, as before.
   */
  private async watchPauseGone(): Promise<void> {
    const view = this.env.doc.defaultView;
    const resume = this.env.afterSignIn;
    if (view === null || resume === undefined || this.ended !== 'paused' || this.pauseWatch !== null) return;
    const watch = new AbortController();
    this.pauseWatch = watch;
    const signal = AbortSignal.any([watch.signal, this.controller.signal, this.cancelled.signal]);
    const shown = this.pauseShownNow()?.kind ?? null;
    const kinds = this.restingKinds();
    // The machine's pause the page no longer shows: never equal to what the page shows, so the first look carries on.
    const from: PauseSignal['kind'] | null | 'gone' = kinds === null ? shown
      : shown !== null && kinds.has(shown) ? shown : 'gone';
    let looking = false;
    let gone = false;
    const look = () => {
      if (signal.aborted || this.ended !== 'paused' || this.signInDue) return;
      const now = this.pauseShownNow()?.kind ?? null;
      // A Sign-in Auto a challenge held back (the v4 review, M5) is tried again once the page shows none; v5: one the
      // site refused for its unticked check, once the person ticked it (sign-in.ts signInRefusalWaits).
      const cleared = this.signInSaid === 'challenged' && !signInChallenged(this.env.doc)
        && !signInRefusalWaits(this.env.doc);
      if (now === from && !cleared) return;
      gone = true;
      log('content.pause-gone', { other: now !== null, cleared });
      watch.abort();
      resume();
    };
    const observer = new view.MutationObserver(() => {
      if (looking || signal.aborted) return;
      looking = true;
      void deadline(PAUSE_LOOK_MS, signal).then(() => {
        looking = false;
        look();
      });
    });
    try {
      observer.observe(this.env.doc.documentElement, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'disabled', 'type'] });
      // A pause already gone when the run came to rest (a document a sign-in brought, its wall gone) carries on at once.
      look();
      if (!gone) await deadline(PAUSE_WATCH_MS, signal);
    } finally {
      observer.disconnect();
      if (this.pauseWatch === watch) this.pauseWatch = null;
    }
  }

  /** v4 (D7): Workday's choice of how to apply ("Autofill with resume / Apply manually / Use my last application"): the
   *  adapter's declared entry is pressed (RunEnv.enterChoice: its "Apply manually", through the entry door) and the run
   *  carries on; with none declared or shown, it rests silently, and watchPauseGone follows the person's own choice.
   *  jr6 SHELL-A (CHAINS regression 1): it carries on once what the press brings shows (watchPauseGone: the choice gone
   *  in place, as Workday's dialog and ADP's privacy pane go), never at once: a choice still shown after the press is
   *  the page at work (Jobvite's consent gate, whose "I Accept" posts its form and leaves the page shown until the next
   *  one loads), never a reason to press it again. Before, the run carried on at once, met the same choice and pressed
   *  again: 21 presses in 5 s there (MAX_AUTO_CONTINUES), each starting the form's POST anew. */
  private async enterChoiceNow(): Promise<void> {
    const enter = this.env.enterChoice;
    if (enter === undefined || this.request.dryRun || (!this.isTop && !this.claimed)) return;
    const outcome = enter();
    log('content.entry-choice', { pressed: outcome === 'pressed' });
    if (outcome !== 'pressed' || this.controller.signal.aborted || this.ended !== 'paused') return;
    void this.watchPauseGone().catch(() => undefined);
  }

  private notify(notice: StepNotice, count?: number): void {
    if (notice === 'tripwire') this.notices.add('tripwire', this.tripwireHits);
    else if (notice === 'validation') {
      this.notices.add('validation', this.lastErrors);
      // The behaviour review of 2026-11-06 (minor 7): errors the page showed before anything was written are the
      // person's to fix (the agent leaves the job for them, never failed).
      if (this.errorsOnLoad()) this.notices.add('errors-on-load', this.lastErrors);
    } else this.notices.add(notice, count);
    this.drawToasts();
  }

  /** core-x, item 2 (dom/account-section.ts): with Sign-in acting as Auto, not in a dry run, in a frame that may sign in
   *  (the top one, or the subframe that claims the tab's application), the saved job-site sign-in typed once per step
   *  into the form's account section while one of its required boxes is empty (content/sign-in.ts, section mode:
   *  nothing pressed). Whatever comes of it, the fill goes on; a box still empty holds Next at validation. */
  private async signInAccountSection(): Promise<void> {
    const signInSection = this.env.signInSection;
    const step = this.state.stepSignature ?? '';
    // jr6: on Manual too, with a password saved (the section's press is the person's either way).
    if ((!this.signInAuto && !this.signInTypes) || this.request.dryRun || signInSection === undefined
      || (!this.isTop && !this.claimed) || this.accountTyped.has(step)) return;
    if (accountLeft(this.env.page.adapter, this.env.doc, this.rootNow()) === 0) return;
    // The jr6 review (sec-3): on Manual, typed only into a document shown to the person: a background tab's fill (the
    // sequential auto-apply's) goes on without it, and a run once it is shown types it.
    const typeOnly = !this.signInAuto && this.request.signIn !== true;
    if (typeOnly && this.env.doc.visibilityState !== 'visible') return;
    this.accountTyped.add(step);
    const outcome = await signInSection(AbortSignal.any([this.controller.signal, this.stopping.signal,
      this.cancelled.signal]), typeOnly);
    // jr6 SHELL-A (FIXPLAN §6.12 item 1; ICIMS-07): a password the page's own rules refuse was not typed: its toast.
    this.sectionDetail = outcome === 'unavailable' ? signInDetailOf(this.env.doc) : null;
    log('content.account-section', { typed: outcome === 'continue' });
  }

  // ── snapshot build 2026-11-06 (core pass Z1, item 24) ──
  /** Sign-in mode Auto on a step the adapter declares a sign-in container on (Adapter.signInContainer: ADP's guest page,
   *  UltiPro's account step), once the run rests there at review: with Sign-in acting as Auto, not in a dry run, in a
   *  frame that may sign in, once per step, and only while the step's required questions are all answered, no error
   *  shows and no challenge does (the person's otherwise), the container's button is pressed through content/sign-in.ts
   *  (every Sign-in Auto guard held there). The page it brings is the run's to follow (its watch of the step); whatever
   *  comes of it, nothing else is pressed. Sign-in Manual leaves the button to the person. */
  private async signInContainerNow(): Promise<void> {
    const press = this.env.signInContainer;
    const step = this.state.stepSignature ?? '';
    const declared = press === undefined ? null : signInContainerOf(this.env.page.adapter, this.env.doc);
    if (!this.signInAuto || this.request.dryRun || press === undefined || (!this.isTop && !this.claimed)
      || this.containerPressed.has(step) || declared?.container === undefined) return;
    if (this.lastErrors > 0 || this.challengedNow() || requiredLeftOf(this.scanNow(), this.leftRequired()) > 0
      || containerLeft(declared.container) > 0) return;
    this.containerPressed.add(step);
    const outcome = await press(AbortSignal.any([this.controller.signal, this.stopping.signal, this.cancelled.signal]));
    log('content.sign-in-container', { pressed: outcome === 'continue' });
  }
  // ── end core pass Z1, item 24 ──

  /** Sign-in mode Auto, once the run rests at its sign-in pause (module header): the site took it, and the run goes on;
   *  or the notice says why the sign-in is the person's, and the report goes out again. */
  private async signInNow(): Promise<void> {
    this.signInDue = false;
    const signIn = this.env.signIn;
    if (signIn === undefined) return;
    const typing = this.signInTyping;
    this.signInTyping = false;
    const outcome = await signIn(AbortSignal.any([this.controller.signal, this.stopping.signal, this.cancelled.signal]),
      typing);
    if (this.controller.signal.aborted || this.cancelled.signal.aborted || this.ended !== 'paused'
      || outcome === 'left') return;
    this.notices.forget(['sign-in-auto']);
    if (outcome === 'continue') {
      this.env.afterSignIn?.();
      return;
    }
    // v4 (D10): the toast says what is left: the job-site sign-in to add in TailorIT, the check to solve, or the
    // sign-in to make here (the v4 review, M5: each told apart).
    this.signInSaid = outcome;
    // jr6 SHELL-A (FIXPLAN §6.12 items 1 and 4): a password rule of the page's own, or the kind of account error the
    // page shows, said on the toast.
    this.signInDetail = signInDetailOf(this.env.doc);
    if (outcome === 'failed') this.notices.add('sign-in-failed');
    // jr6 SHELL-A (FIXPLAN §6.12 item 5; WD-04): none saved, under Auto or Sign up & Autofill: the run waits for one to
    // be saved (waitForPassword), once, and its toast says it goes on by itself meanwhile. Never the auto-apply agent's
    // run: its window is never told a password may be typed (background/settings.ts contentSettingsOf: typeSignIn is
    // false there), so no wait could end in a second try, and nobody is there to save one.
    const waits = outcome === 'none-saved' && !typing && !this.passwordWaited && this.request.trigger !== 'agent';
    if (waits) this.passwordWaited = true;
    const waited = waits ? this.waitForPassword() : null;
    this.drawToasts();
    await this.report();
    // The person signs in on the page, and the run carries on by itself once the wall goes.
    void this.watchPauseGone().catch(() => undefined);
    if (waited !== null) await waited;
  }

  /**
   * jr6 SHELL-A (FIXPLAN §6.12 item 5; WD-04, jr6-password's R5 remainder): a sign-in at the run's wall found no
   * job-site password saved, under Sign-in Auto or Sign up & Autofill. The run waits, PASSWORD_WAIT_MS at most, for one
   * to be saved in Sign-up Information (the worker then pushes ContentSettings.typeSignIn true: settingsChanged), and
   * then tries the wall once more (signInNow), if it still rests at that wall. The wait ends at once with the run (its
   * Stop, its Cancel at the pause, the document's end, a run that took over); the page's toast says meanwhile that the
   * run goes on by itself. Nothing is asked of the worker while it waits.
   */
  private waitForPassword(): Promise<void> {
    const signal = AbortSignal.any([this.controller.signal, this.stopping.signal, this.cancelled.signal]);
    const arrived = new Promise<boolean>((resolve) => {
      let stopTimer: () => void = () => undefined;
      const done = (saved: boolean) => {
        stopTimer();
        signal.removeEventListener('abort', gone);
        if (this.passwordArrived === saw) this.passwordArrived = null;
        resolve(saved);
      };
      const gone = () => done(false);
      const saw = () => done(true);
      if (signal.aborted) {
        resolve(false);
        return;
      }
      this.passwordArrived = saw;
      stopTimer = startDeadline(this.env.options.signIn?.passwordWaitMs ?? PASSWORD_WAIT_MS, () => done(false));
      signal.addEventListener('abort', gone, { once: true });
    });
    return arrived.then(async (saved) => {
      log('content.sign-in', { waited: true, saved });
      const still = saved && !signal.aborted && this.ended === 'paused' && this.machine?.status === 'auth-needed'
        && this.wallShown();
      if (!still) {
        // The wait is over: the toast says again to choose Sign Up & Autofill once a password is saved.
        this.drawToasts();
        return;
      }
      // Once more, as the run's pause would decide it now (the person's Auto may have gone back to Manual: typed then).
      this.pauseWatch?.abort();
      const auto = this.signInAuto || this.request.signIn === true;
      this.signInTyping = !auto;
      this.signInDue = auto || (this.signInTypes && this.typeableWallShown());
      this.signInSaid = null;
      this.signInDetail = null;
      if (!this.signInDue) {
        this.drawToasts();
        void this.watchPauseGone().catch(() => undefined);
        return;
      }
      this.drawToasts();
      await this.signInNow();
    });
  }

  /** The report's `buttons` now (v3 Phase 4): at rest (review, or waiting for the person's Next), not in a dry run;
   *  never while the run offers Continue or ended paused or stopped, when press() would refuse them (the audit of
   *  2026-11-06, m3: a run found after a reload at review). */
  private buttonsNow(): { buttons: NonNullable<ReportHeader['buttons']> } | null {
    if (this.request.dryRun || this.machine === null || (this.status !== 'review' && !this.resting)) return null;
    if (this.ended === null ? this.offered : this.ended !== 'review' && this.ended !== 'waiting') return null;
    let read: NonNullable<ReportHeader['buttons']>;
    try {
      read = stepButtonsOf({ doc: this.env.doc, adapter: this.env.page.adapter, root: this.rootNow(),
        facts: chainFactsOf(this.env.doc) }); // jr6 SHELL-B (ICIMS-17): an IForm leaf's portal step facts, else null
    } catch {
      return null;
    }
    return { buttons: this.submitPending ? { ...read, pressed: 'submit' } : read };
  }

  /**
   * The panel's "Continue to the next page" or "Submit application" (v3 Phase 4: run/press, or the in-page panel's
   * trusted click), on this run's step: only while the run rests, what it wrote read again first (E9), then press.ts's
   * one click. A Submit pressed is armed (RunEnv.submitPressed) and the report says it waits for its confirmation.
   */
  async press(target: StepTarget, confirmed: boolean): Promise<PressAnswer> {
    if (this.ended === null || this.request.dryRun || this.machine === null) {
      return { outcome: this.ended === null ? 'busy' : 'not-offered' };
    }
    if (this.ended !== 'review' && this.ended !== 'waiting') return { outcome: 'not-offered' };
    await this.lookBeforeLeaving();
    if (this.controller.signal.aborted) return { outcome: 'gone' };
    // From here to the click nothing is awaited: what is checked is what is clicked.
    const page = this.pressPage();
    const before = target === 'submit' ? this.env.beforePress?.() : undefined;
    if (target === 'submit') this.noteCheckAtSubmit(page.root);
    // v1.3 B: a Next leaves the step: its questions and answers are read first (a Submit's are, as it is armed).
    if (target === 'next') this.env.stepLeaving?.();
    const answer = pressStep(page, target, { confirmed });
    log(answer.outcome === 'pressed' ? 'content.step-pressed' : 'content.step-press-refused',
      { submit: target === 'submit', confirmed });
    if (answer.outcome === 'pressed' && target === 'submit') this.submitWasPressed('panel', before);
    // A Next the page did not take: the same step still shows, with what to fix (the review).
    if (answer.outcome === 'pressed' && target === 'next') {
      const from = this.stepped ? this.signatureNow() : null;
      const count = await refusalAfter(page, this.controller.signal);
      const stayed = !this.controller.signal.aborted && from !== null && this.signatureNow() === from
        && page.root.isConnected;
      // v5 (PLAN decision 9): a Next the page refused for its unticked check: the CAPTCHA pause (refusedForCheck).
      if (stayed && this.refusedForCheck('next')) return { outcome: 'not-accepted', count: Math.max(1, count) };
      if (stayed && count > 0) return { outcome: 'not-accepted', count };
    }
    return answer;
  }

  /** press-submit (Submit mode Auto, v3 Phase 4): the step machine's verdict passed on a final step. Inside another
   *  page, only while the frame is seen there (S1). After the last wait, what the verdict read is read again (the mode
   *  still on, the same step, nothing the run wrote changed, no error shown); the press re-counts the required
   *  questions while that skip rule holds; once per step. A press that cannot be made says why, and the person
   *  submits. */
  private async autoSubmit(): Promise<void> {
    if (this.stopRequested || this.request.dryRun || !this.autoSubmitOn) return;
    const pressed = this.env.autoPressed ?? this.autoPressedHere;
    const stepKey = this.autoPressKey();
    if (pressed.has(stepKey)) return;
    const changed = await this.lookBeforeLeaving();
    this.alive();
    if (!this.isTop && !(await this.env.frameShown(this.controller.signal, true))) {
      this.alive();
      this.notify('submit-held-check');
      return;
    }
    this.alive();
    // After the last await: every fact the verdict read must still hold, or the Submit is the person's.
    if (this.stopRequested || this.request.dryRun || !this.autoSubmitOn) return;
    if (changed || this.movedOn() !== null || refusalNow({ doc: this.env.doc, adapter: this.env.page.adapter,
      root: this.rootNow() }) > 0) {
      log('content.step-press-refused', { submit: true, auto: true });
      this.notify('submit-held-check');
      return;
    }
    // A challenge shown since, or a bot check still left for the person (S-2, S-3, S-7): the Submit is theirs.
    if (this.challengedNow()) {
      log('content.step-press-refused', { submit: true, auto: true });
      this.notify('submit-held-captcha');
      return;
    }
    pressed.add(stepKey);
    const before = this.env.beforePress?.();
    const page = this.pressPage();
    this.noteCheckAtSubmit(page.root);
    const answer = pressStep(page, 'submit', { confirmed: !this.skipRules.requiredEmpty });
    log(answer.outcome === 'pressed' ? 'content.step-pressed' : 'content.step-press-refused', { submit: true, auto: true });
    if (answer.outcome === 'pressed') {
      this.submitWasPressed('auto', before);
      return;
    }
    if (answer.outcome === 'required-empty') this.notify('submit-held-required', answer.count);
    else if (answer.outcome === 'not-accepted') {
      this.notices.add('submit-errors', Math.max(1, answer.count ?? 1));
      this.drawToasts();
    } else this.notify(answer.outcome === 'blocked' ? 'submit-held-captcha' : 'submit-held-check');
  }

  /** What press.ts reads of the page: the step's root now, a fresh scan, the run's rows left for the person, the
   *  CAPTCHA the person was handed. */
  private pressPage(): PressPage {
    const signature = this.stepped ? this.signatureNow() : null;
    const handed = this.handed !== null && this.handed.signature === signature ? this.handed.elements : undefined;
    return { doc: this.env.doc, adapter: this.env.page.adapter, root: this.rootNow(), scan: () => this.scanNow(),
      leftRequired: () => this.leftRequired(), ...(handed === undefined ? {} : { handed }),
      facts: chainFactsOf(this.env.doc) }; // jr6 SHELL-B (ICIMS-17): an IForm leaf's portal step facts, else null
  }

  /** A Submit was pressed by this run: the runtime arms it, and the report says it waits for its confirmation. */
  private submitWasPressed(by: 'panel' | 'auto', before?: PressSnapshot | null): void {
    this.submitPending = true;
    this.notices.forget(['submit-unconfirmed', 'submit-errors']);
    if (this.id !== null) this.env.submitPressed?.(by, this.id, before);
    this.rowsChanged();
  }

  /** The platform's confirmation was seen after a Submit (v3 Phase 4; the runtime, once the worker took it): the run is
   *  done (SUBMITTED). While it watches the step, the watch ends with it; at rest, the machine takes it here. */
  async submittedSeen(): Promise<void> {
    if (this.machine === null || this.request.dryRun) return;
    this.submitPending = false;
    // A sign seen after the wait said to check the page (the audit's m10: still watched, quietly, up to the arm's
    // life) settles it: the report no longer says the Submit went unconfirmed.
    this.notices.forget(['submit-unconfirmed', 'submit-errors']);
    if (this.watchingNow) {
      this.confirmed.abort();
      return;
    }
    if (this.ended === null) {
      // The run still works (Submit mode Auto's press, then its review): taken as soon as it rests (drive), and a
      // watch it starts meanwhile ends with it.
      this.submittedLate = true;
      this.confirmed.abort();
      return;
    }
    if (this.ended === 'stopped') return;
    await this.step({ type: 'SUBMITTED' });
    await this.flushReport();
    this.launcher({ state: 'idle', action: 'fill' });
  }

  /** No confirmation came within the runtime's wait after a Submit this run pressed: the review says to check the page
   *  (submit-unconfirmed), and the panel's Submit is offered again. */
  submitUnconfirmed(): void {
    if (!this.submitPending) return;
    this.submitPending = false;
    // v5 (PLAN decision 9): nothing came of a Submit while the page's check is still unticked: the check's (below), only
    // when it was unticked as the Submit was pressed or the site says so (v5 review, F2).
    if (this.refusedForCheck('unconfirmed')) {
      this.rowsChanged();
      return;
    }
    this.notices.add('submit-unconfirmed');
    this.rowsChanged();
  }

  /** The page refused a Submit pressed (the review): its errors, the fields its form marked, its failure message,
   *  `count` of them. The wait ends, the review says so (submit-errors), and the panel's Submit is offered again. */
  submitRefused(count: number): void {
    const waited = this.submitPending;
    this.submitPending = false;
    this.notices.forget(['submit-unconfirmed']);
    // v5 (PLAN decision 9): a Submit the page refused for its unticked check (its CAPTCHA-required error, or any refusal
    // while the box is unticked) is the check's: a CAPTCHA pause, never submit-errors (refusedForCheck).
    if (!this.refusedForCheck('refused')) {
      this.notices.add('submit-errors', Math.max(1, count));
      this.drawToasts();
    }
    if (waited || this.ended !== null) this.rowsChanged();
  }

  // ── v5 p1-rules: CAPTCHA like Jobright (PLAN decision 9) ──
  /** Submit mode Auto's once-per-step mark for the step the run is on (RunEnv.autoPressed). */
  private autoPressKey(): string {
    return `${this.state.applicationKey}|${this.state.stepIndex}|${this.state.stepSignature ?? ''}`;
  }

  /** v5 review (F2): what an unconfirmed Submit is read against: whether its step's form showed a checkbox CAPTCHA
   *  unticked as it was pressed (read right before the press, with nothing awaited between). */
  private noteCheckAtSubmit(root: Element): void {
    this.untickedAtSubmit = checkboxCaptchasUnsolved(this.env.doc, root) > 0;
  }

  /**
   * A press of the run's step the page refused (a Submit's refusal or silence, the panel's Next it did not take) while
   * the pressed step's form shows a checkbox CAPTCHA still unticked (pause-detect.ts captchaRefusalShown, over or inside
   * the step's root: v5 review, F8): the check is the person's. A Submit nothing confirmed (`unconfirmed`) is the
   * check's only when the box was unticked as it was pressed, or the site shows its CAPTCHA error (v5 review, F2: an
   * AJAX Submit that went through and then reset its widget is never pressed twice). No submit-errors, no unconfirmed
   * Submit: the run rests at a CAPTCHA pause (the "solve the check" toast), and carries on by itself once the check is
   * solved (watchPauseGone), where Submit mode Auto may press the step once more (its once-per-step mark released here:
   * the person solved the check the site asked for, and each further press needs them to solve it again). Nothing
   * touches the check. Answers whether the refusal was the check's, read from the page each time (F8: never sticky).
   */
  private refusedForCheck(kind: 'refused' | 'unconfirmed' | 'next'): boolean {
    if (this.machine === null || this.request.dryRun || this.controller.signal.aborted || this.ended === 'stopped'
      || (this.ended === 'paused' && !this.refusedByCheck)) return false;
    const { doc } = this.env;
    const { adapter } = this.env.page;
    const root = this.rootNow();
    if (!captchaRefusalShown(doc, root, adapter, { afterPress: true })) return false;
    if (kind === 'unconfirmed' && !this.untickedAtSubmit && captchaErrorsShown(doc, root, adapter).length === 0) {
      return false;
    }
    // Already resting at that pause: the page still shows it.
    if (this.refusedByCheck) return true;
    log('content.captcha-refused', { next: kind === 'next' });
    this.refusedByCheck = true;
    (this.env.autoPressed ?? this.autoPressedHere).delete(this.autoPressKey());
    if (this.watchingNow || this.ended === null) {
      // The watch ends with it (watchStep), or the run takes it as it next rests (drive).
      this.refusedLate = this.ended === null && !this.watchingNow;
      this.checkRefused.abort();
      return true;
    }
    void this.pauseAtRest().catch(() => undefined);
    return true;
  }

  /** The CAPTCHA pause a refusal brought while the run rested with no watch: the machine takes it, and the run rests
   *  at it (rest: the toast, then watchPauseGone). */
  private async pauseAtRest(): Promise<void> {
    this.working();
    await this.step({ type: 'PAUSE', reason: 'captcha', refused: true });
    await this.flushReport();
    await this.rest();
  }

  /** What a resting run's pause watch reads (watchPauseGone): the page's pause (pauseNow), else, after a refusal for the
   *  page's check (refusedByCheck), the CAPTCHA that refusal stands for while the box is still unticked. */
  private pauseShownNow(): PauseSignal | null {
    const shown = this.pauseNow();
    if (shown !== null || !this.refusedByCheck) return shown;
    return captchaRefusalShown(this.env.doc, this.root, this.env.page.adapter, { afterPress: true })
      ? { kind: 'captcha', evidence: 'captcha-container' } : null;
  }
  // ── end v5 p1-rules ──

  /** A Submit's watch ended without a confirmation and without a word to say (the person's own Submit, or one
   *  replaced by a newer press): the report no longer says it waits. */
  submitWatchEnded(): void {
    if (!this.submitPending) return;
    this.submitPending = false;
    this.rowsChanged();
  }

  /** Whether the run's resume upload is in place on the form: its row verified, written (for the tracker). */
  resumeAttached(): boolean {
    return this.rows.some((row) => row.category === 'file.resume' && row.status === 'verified' && row.wrote);
  }

  /** show-review: the launcher shows how far the fill is (v4, D11: progress only); nothing is drawn over the page. */
  private showReview(cause: ReviewCause): void {
    if (cause === 'error') log('content.step-review-error');
    this.drawAiEdits();
    this.launcher({ state: 'review', action: 'open-review', ...this.progressNow() });
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
    // A new run's toasts start afresh (the person's dismissals with them).
    env.ui()?.setToasts([]);
    this.launcher({ state: 'running', action: null });
    try {
      const frame = await env.frame();
      this.alive();
      this.frameId = frame.frameId;
      this.isTop = frame.isTop;
      this.claimed = frame.claimed === true;
      await this.begin();

      // 1b. A frame inside another page fills only while its launcher can be seen on that page (S1): the page around it
      // can hide the whole frame (opacity 0, off-screen, a zero-height wrapper), which no check inside the frame sees.
      if (!frame.isTop) {
        const shown = await env.frameShown(this.controller.signal);
        this.alive();
        if (!shown) {
          log('content.form-hidden');
          this.notices.add('form-hidden');
          // Before the machine starts: nothing is stored, and the report says the run stopped.
          this.reportStatus = 'stopped';
          await this.report();
          this.launcher({ state: 'idle', action: 'fill' });
          this.end('stopped');
          return;
        }
      }

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
      this.launcher({ state: 'error', action: 'fill', reason: code === 'not_connected' ? 'not-connected' : 'failed' });
      this.end('error');
    }
  }

  /** s2 lists: asks the worker (lists/known), before a step's loop, for the lists this host's dropdowns showed before,
   *  once a step's scan holds a learnable dropdown (dom/widgets' learnable), and for the stored lists the scan's
   *  adapter names (WidgetTarget.storedList, with their companions: shared/learned-lists.ts storedListsWanted) that it
   *  has not asked for yet: every later scan of the run gives each widget its list. An answer that does not come, or a
   *  refusal, leaves none: each is read when it opens, as before. */
  private async askLists(): Promise<void> {
    const held = this.scanNow();
    const widgets = held.fields.map((field) => held.target(field.key)?.widget)
      .filter((widget): widget is NonNullable<typeof widget> => widget !== undefined);
    const stored = storedListsWanted(widgets.flatMap((widget) => (widget.storedList === undefined ? [] : [widget.storedList])))
      .filter((id) => !this.storedAsked.has(id));
    const learned = !this.learnedAsked && widgets.some(learnable);
    if (stored.length === 0 && !learned) return;
    if (learned) this.learnedAsked = true;
    for (const id of stored) this.storedAsked.add(id);
    const answer = await this.env.channel.request<'lists/known'>({ v: 1, type: 'lists/known',
      ...(stored.length > 0 ? { stored } : {}) });
    this.alive();
    if (!answer.ok) return;
    for (const list of answer.data.lists) if (!this.learnedLists.has(list.key)) this.learnedLists.set(list.key, list.labels);
    for (const list of answer.data.stored ?? []) this.storedLists.set(list.id, list.labels);
  }

  /** s2 lists: a learnable dropdown's complete whole read (dom/widgets' LearnList): kept for the rest of the run under
   *  its label's key (another block's dropdown of the same label then plans from it), and told to the worker once. */
  private learnList(target: FieldTarget, labels: readonly string[]): void {
    const key = learnedListKey(labelSlug(target.field), target.widget?.learnContext);
    this.learnedLists.set(key, labels);
    const sent = `${key}\u001f${labels.join('\u001f')}`;
    if (this.learnedSent.has(sent)) return;
    this.learnedSent.add(sent);
    void this.env.channel.request<'lists/learn'>({ v: 1, type: 'lists/learn', key, labels: [...labels] })
      .catch(() => undefined);
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
    await this.askLists();
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
      // v5 p2-fill review (security 4)
      dialogsHeld: (held) => this.dialogsHeld(held),
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
      // A draft for a page that saves as it is filled, while drafts wait for the person: held back (module header).
      holdDraft: (write, planned) => this.holdDraft(write, planned),
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
      // v3 Phase 3: the side panel's progress, and the person's Skip of the write being made.
      progress: (rows, pending, current) => this.liveProgress(rows, pending, current),
      writing: this.writing,
      // v5 p2-stream: the worker's plan/ready ends a wait for the AI at once.
      wake: this.aiWake,
      ...(carry === undefined ? {} : { carry }),
      widgetReadings: this.widgetReadings,
      // s2 lists: what this host's dropdowns showed before, and each learnable dropdown's whole read told.
      learnedLists: this.learnedLists,
      storedLists: this.storedLists,
      learn: (target, labels) => this.learnList(target, labels),
      runId: () => this.runId,
      ...(env.options.resume ? { resume: env.options.resume } : {}),
      ...(env.options.settle ? { settle: env.options.settle } : {}),
      ...(env.options.awaitOptions ? { options: env.options.awaitOptions } : {}),
      ...(env.options.ai ? { ai: env.options.ai } : {}),
    });
  }

  /** The notices the rows raise (v4, D9: the facts the worker reads only): a bot check asked as a question (S-2, S-3),
   *  a CAPTCHA to the person and to the agent (needs-you captcha). */
  private noticesFromRows(rows: readonly FillResult[]): void {
    const bots = rows.filter((row) => row.reason === 'bot-check' && leftForPerson(row)).length;
    if (bots > 0) this.notices.add('bot-check', bots);
  }
}

// ── jr7 ENGINE-7 E1 item 10 (jr7-O7) ──
/** The section a required block's row is keyed in: the blocks' own, apart from every field's. */
const REQUIRED_BLOCKS_SECTION = { id: 'required-blocks' } as const;
/** Its section key, as a row carries it. */
const REQUIRED_BLOCKS_SECTION_KEY = sectionKey(REQUIRED_BLOCKS_SECTION);

/** A required block's title as the page shows it: its aria-label, else its first heading's text, else its
 *  visible text, on one line (at most TEXT_CAP_LABEL characters); '' where it shows none. Page text only. */
function blockTitleOf(block: Element): string {
  const named = (block.getAttribute('aria-label') ?? '').replace(/\s+/g, ' ').trim();
  if (named !== '') return named.slice(0, TEXT_CAP_LABEL);
  const heading = block.querySelector('h1, h2, h3, h4, h5, h6, legend, [role="heading" i]');
  return visibleText(heading ?? block, { singleLine: true, cap: TEXT_CAP_LABEL }).trim();
}

/** The review's row for a required block left empty (requiredBlocksNow): flagged, the person's (needs-your-click: the
 *  run presses no Add), required, labelled "<block>: add at least one" (PAGE_COPY.requiredBlockLeft). */
function requiredBlockRow(block: Element, ordinal: number, platform: Platform): FillResult {
  const title = blockTitleOf(block);
  const slug = labelSlug({ label: title, kind: 'multiselect', nameAttr: '', idAttr: '' });
  return { key: fieldKey({ platform, section: REQUIRED_BLOCKS_SECTION, labelSlug: slug, ordinal,
    optionSetHash: OPTION_SET_NONE }), label: PAGE_COPY.requiredBlockLeft(title === '' ? PAGE_COPY.report.untitledSection
    : title), kind: 'multiselect', category: 'unknown', section: REQUIRED_BLOCKS_SECTION_KEY, required: true,
  status: 'flagged', provenance: null, matcherStage: 'not-applicable', confidence: 0, reason: 'needs-your-click',
  wrote: false, verification: 'not-applicable', needsUserAction: true };
}
// ── end jr7 ENGINE-7 E1 item 10 ──

// ── jr7 ENGINE-7 E1 item 11 (ICIMS7-V4, as its verifier corrected it) ──
/** A row the run left open (unfilled by it) whose field holds an answer in `scanned` (the step's fresh scan at FILLED),
 *  with detail.filledByYou set, as withFilledByYou folds it in at rest: a required field the page answered itself
 *  (iCIMS's prefilled "Today's Date" month, day and year on arc-onesolutions' IForm, snapshot7 iCIMS1) is no required
 *  field left empty, so it holds no auto-Next (report.ts lastFillOf). Only a row of HELD_BY_PAGE_REASONS: any other
 *  row as it is. A flag only: it claims nothing about who filled the field. */
export function heldIn(scanned: ScanResult, row: FillResult): FillResult {
  // FIX7PLAN O-3 (the coordinator's note of 2026-11-12): only a row the run could not decide by its own limits
  // (HELD_BY_PAGE_REASONS). A row whose question it knows and leaves for the person (no-profile-value: iCIMS's salary
  // Time Frame with no profile pay, its page default "Hr." shown) is never counted filled by the page's default.
  if (!open(row) || row.detail?.filledByYou === true || !HELD_BY_PAGE_REASONS.has(row.reason)) return row;
  const field = scanned.fields.find((candidate) => candidate.key === row.key)
    ?? scanned.fields.find((candidate) => candidate.baseKey === baseKeyOf(row.key));
  if (field === undefined || !holdsAnswer(field.current)) return row;
  return { ...row, detail: { ...row.detail, filledByYou: true } };
}
/** The reasons of a row the run could not decide by its own limits, whose field the page may answer itself: a question
 *  it could not tell (unknown-field: iCIMS's "Today's Date" parts as the verifier probed them), or one it knows but
 *  cannot write in the page's shape (format-unsupported: a date asked as month, day and year lists). Never a question
 *  the run knows the person must answer (no-profile-value, a consent, a legal or EEO question). */
const HELD_BY_PAGE_REASONS: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['unknown-field', 'format-unsupported']);
// ── end jr7 ENGINE-7 E1 item 11 ──

/** jr7 ENGINE-7 E2 item 5: how long the fill lets an editor it opened draw its fields before the loop's first scan
 *  (the loop's settle and later scans read the rest). */
const EDITOR_OPEN_MS = 300;
