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
 *    reactive loop (loop.ts), "I currently work here" (planCurrentJob's rows), the final Guard (verify.ts), the rows,
 *    the notices and the highlights (FILLED). A page still busy at a settle's cap pauses (page-busy); a pause or a
 *    hidden frame a later pass found cuts the loop (the Phase 3 review, L-S2 and L-S4): the pause, or the run ends
 *    stopped; a policy statement a later pass revealed shows the card (Cancel: stopped, policy-declined; Fill anyway:
 *    this run ends and a fresh one starts from its RunState, whose gate takes that decision).
 * 6. validate: the adapter's errors (fixable: those on a field no pass planned, or one the page emptied after our write:
 *    one more pass where the step has an attempt left), its finality ('unknown' without the hook: treated as final),
 *    Next's visibility, the settle, unconfirmed drafts (VALIDATED). Errors are surfaced at review, never paused on.
 * 7. press-next: the one untrusted click() on the adapter's Next, through clickIfAllowed(…, {allowNext: true}), only
 *    when the reducer says so (auto-advance on, a step declared not final and clean); never Submit, which
 *    assertNotSubmit always refuses. A refused or missing Next pauses with needs-click.
 * 8. await-transition (transition.ts): the step's signature watched until it changes and the page is quiet, capped
 *    after our own click (TIMED_OUT), with no cap when the person advances: the run then rests ('waiting'), its report
 *    sent, and the person's Next moves it on (TRANSITIONED, or STEP_UNCHANGED when errors showed instead).
 * 9. highlight-next, highlight-submit, notify, show-review, pause, offer-continue: the in-page UI. At review the run
 *    rests and still watches the step (an adapter that tells steps apart): the person's own Next after fixing what
 *    the review showed is a transition. A pause ends the run; Continue (the runtime) starts the next from its state.
 * An 'expired' answer to run/begin, plan/request or report/put begins the run again, once; a second one ends the run in
 * the launcher's error state. plan/poll (Phase 4) never renews. The run ends for invalidation only on the platform's
 * word (channel.ts). Nothing here sends, stores or logs a value: RunState holds keys, hashes, counters and checked
 * canaries; rows hold labels and statuses.
 */
import type { Adapter } from '../adapters/types';
import type { ApplicationRef } from '../adapters';
import { mergeCanaries } from '../core/guard/canary';
import { scanTripwires } from '../core/guard/tripwire';
import type { RepeatableAnswer } from '../core/steps/blocks';
import {
  createRunState, reduceRun, repeatableCounterKey, TRANSITION_CAP_MS, type ReviewCause, type RunContext, type RunEffect,
  type RunEvent, type StepFacts, type StepNotice,
} from '../core/steps/machine';
import { stepSignature } from '../core/steps/signature';
import type { BaseKey, FieldKey, FieldSpec } from '../core/types/field';
import type { FillResult, ReasonCode } from '../core/types/fill';
import type { RepeatableKind, RunState, RunStatus } from '../core/types/run';
import { clickIfAllowed } from '../dom/fillers';
import { detectPause, type PauseSignal } from '../dom/pause-detect';
import { rawScan, type RawPassage } from '../dom/raw-scan';
import { newScanCache } from '../dom/scan-cache';
import { scan, toFieldSpec } from '../dom/scan';
import type { ScanResult, WidgetReading } from '../dom/types';
import { isUserVisible } from '../dom/visibility';
import type { ErrorCode } from '../messaging/envelope';
import type { ContentPlatform } from '../platform/types';
import { log } from '../shared/log';
import { Invalidated, type AnsweredType, type AnswerData, type Channel, type MessageOf } from './channel';
import { runLoop, type LoopResult, type OptionsTimings, type SettleTimings } from './loop';
import { RunAborted, type PlanAnswer } from './pass';
import { frameHitsOf, hiddenPolicyHits, policyGateOf, postingOutsideFrame, type PolicyView } from './policy';
import { addBlocks, currentJobRows, needsClicks, sectionsOf, type SectionView } from './repeatables';
import {
  buildReport, lastFillOf, NoticeBook, persistedRunState, uploadRow, type NoticeCode, type ReportHeader,
  type ReportLimiter,
} from './report';
import { highlightItems } from './targets';
import { awaitTransition } from './transition';
import type { LauncherView } from './ui/launcher';
import type { HighlightItem } from './ui/highlights';
import type { PolicyChoice } from './ui/notices';
import type { PageUi } from './ui/page-ui';
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
}

/** A report's counters before anything was scanned for the fill. */
const NO_COUNTERS: ReportHeader['counters'] = { passes: 0, hiddenControlsIgnored: 0, deferredFields: 0 };

/** The notices of one step: a new step's scan forgets them. The run's own (tripwire, policy and the policy states)
 *  stay. */
const STEP_NOTICE_CODES: readonly NoticeCode[] = ['attention-check', 'needs-click', 'deferred-fields', 'validation',
  'page-busy', 'auth', 'captcha', 'step-retry-limit', 'final-unknown', 'max-steps'];

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
  private fieldHighlights: HighlightItem[] = [];
  private buttonHighlights: HighlightItem[] = [];
  /** The step's repeatable sections, and the worker's answers for them (counts, entries, current flags). */
  private sections: SectionView[] = [];
  private readonly answers = new Map<RepeatableKind, RepeatableAnswer>();
  /** Sections whose entries are left for the person to add. */
  private addsLeft = 0;
  private settledStep = true;
  private lastErrors = 0;
  /** The policy card at the first scan said only TailorIT's stored copy carried the statement. */
  private fromStoredCopy = false;
  /** The run handed over: it ended so that a fresh one could start (Fill anyway after a later pass's hit). */
  private halted = false;
  private offered = false;
  /** The run watches for the next step while it rests. */
  private watchingNow = false;

  constructor(private readonly env: RunEnv, readonly request: RunRequest) {
    this.root = env.page.root;
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
    if (!this.controller.signal.aborted) this.env.ui()?.setLauncher(view);
  }

  /** The notices the stack shows: the report's, but the policy notice, which the card is. */
  private showNotices(): void {
    if (this.controller.signal.aborted) return;
    this.env.ui()?.setNotices(this.notices.codes().filter((code) => code !== 'policy'));
  }

  private drawHighlights(): void {
    if (this.controller.signal.aborted) return;
    this.env.ui()?.setHighlights([...this.fieldHighlights, ...this.buttonHighlights]);
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

  /** How many rows (and Add buttons left to the person) need the person, for the launcher's review. */
  private needing(): number {
    return this.rows.filter((row) => row.needsUserAction).length + this.addsLeft;
  }

  // ── The run's messages ──────────────────────────────────────────────────────────────────────────────────────────

  private async begin(): Promise<void> {
    const { page, channel } = this.env;
    const answer = await channel.request({ v: 1, type: 'run/begin', applicationKey: page.app.applicationKey,
      trigger: this.request.trigger, dryRun: this.request.dryRun });
    this.alive();
    if (answer.ok) {
      this.id = answer.data.runId;
      this.policy ??= answer.data.policy;
      this.autoAdvance = answer.data.settings.autoAdvance;
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
  private async plan(specs: FieldSpec[], planKeys: FieldKey[], pass: number, kept = false): Promise<PlanAnswer> {
    const notices = [
      ...(this.notices.has('tripwire') ? [{ kind: 'tripwire' as const, count: this.tripwireHits }] : []),
      ...(this.machine?.policyDecision === 'accepted' ? [{ kind: 'policy' as const, count: 1 }] : []),
    ];
    const canaries = [...this.sent];
    const repeatables = this.sections.map((section) => ({ kind: section.kind,
      entries: kept ? this.answers.get(section.kind)?.entries ?? null : null }));
    const answer = await this.call<'plan/request'>((runId) => ({ v: 1, type: 'plan/request', runId, pass, specs,
      planKeys, canaries, notices, ...(repeatables.length > 0 ? { repeatables } : {}) }));
    if ('failed' in answer) throw new RunFailure(answer.failed);
    for (const canary of answer.persistableCanaries) this.checked.add(canary);
    if (!kept) for (const section of answer.repeatables ?? []) this.answers.set(section.kind, section);
    return answer;
  }

  /**
   * plan/poll for fields that wait for the LLM (Phase 4). Sent as it is, never renewing the run: 'expired' means the
   * worker knows none of them (it restarted), and the loop sends them in plan/request again, which renews the run when
   * the worker no longer knows it either. Any other refusal is 'failed': the fields are left to the person.
   */
  private async poll(keys: FieldKey[]): Promise<PlanAnswer | 'expired' | 'failed'> {
    const answer = await this.env.channel.request<'plan/poll'>({ v: 1, type: 'plan/poll', runId: this.runId, keys });
    this.alive();
    if (answer.ok) return answer.data;
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
        ...(this.stepped && this.machine !== null ? { step: { index: this.machine.stepIndex } } : {}) }, rows);
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
        this.loopCut = { kind: 'policy' };
        this.showNotices();
        return 'policy-notice';
      }
      if (hiddenPolicyHits(fresh).length > 0) this.notices.add('policy-hidden-text');
    }
    this.showNotices();
    const paused = detectPause(env.doc, this.root, env.page.adapter);
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

  /** The step's signature now, when it is no longer the step being worked on (an adapter that tells steps apart);
   *  null otherwise. */
  private movedOn(): string | null {
    if (!this.stepped || this.machine?.stepSignature === null || this.machine === null) return null;
    const now = this.signatureNow();
    return now === this.machine.stepSignature ? null : now;
  }

  /** The form root the adapter finds now, else the one the run had. */
  private rootNow(): Element {
    try {
      const found = this.env.page.adapter.detect(this.env.doc);
      if (found !== null && found.formRoot.isConnected) this.root = found.formRoot;
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
    const from = this.state.stepSignature;
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
      if (outcome.kind === 'changed') return { type: 'TRANSITIONED', signature: outcome.signature };
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
  }

  private end(how: RunEnd): RunEnd {
    this.ended = how;
    const resolve = this.restedOnce;
    this.restedOnce = null;
    resolve?.(how);
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
      case 'highlight-next':
      case 'highlight-submit':
        this.highlightButton(effect.type === 'highlight-next' ? 'next' : 'submit');
        return null;
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
    this.fieldHighlights = [];
    this.buttonHighlights = [];
    this.addsLeft = 0;
    this.drawHighlights();
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
    this.rootNow();
    const frameHits = frameHitsOf(env.doc);
    let policyHits = frameHits.length;
    if (first) {
      const gate = policyGateOf(this.policy ?? { postingPage: 'unseen', storedCopy: 'unavailable' }, frameHits);
      policyHits = gate.blocked ? Math.max(1, frameHits.length) : 0;
      this.fromStoredCopy = gate.fromStoredCopy;
      if (!gate.blocked && gate.unreadable) this.notices.add('policy-unreadable');
    }
    if (policyHits > 0) this.notices.add('policy');
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
      const paused = detectPause(env.doc, this.root, env.page.adapter);
      if (paused !== null) return pauseEventOf(paused);
    }
    const hits = Math.max(0, this.tripwireHits - this.hitsCounted);
    this.hitsCounted = this.tripwireHits;
    return { type: 'SCANNED', signature: this.signatureNow(), policyHits, tripwireHits: hits, canaries: this.sent };
  }

  /** fill-step: the repeatable sections, the reactive loop and the final Guard (module header, 5). */
  private async fillStep(): Promise<RunEvent | null> {
    const { env } = this;
    const { adapter } = env.page;
    this.launcher({ state: 'running', action: null });
    const paused = detectPause(env.doc, this.root, adapter);
    if (paused !== null) return pauseEventOf(paused);
    if (this.stopRequested) return { type: 'USER_STOPPED' };
    this.loopCut = null;
    this.rows = [];
    this.fieldHighlights = [];
    this.buttonHighlights = [];
    this.drawHighlights();

    // 1. Repeatable sections: the worker's entry counts, then the Add clicks (never in a dry run).
    this.sections = sectionsOf(adapter, this.root);
    this.answers.clear();
    let outcomes: Awaited<ReturnType<typeof addBlocks>> = [];
    if (this.sections.length > 0) {
      const now = this.scanNow();
      await this.plan(now.fields.map(toFieldSpec), [], 0);
      if (!this.request.dryRun) {
        const signature = this.state.stepSignature;
        outcomes = await addBlocks({
          adapter, root: this.root, signal: this.controller.signal,
          ...(env.options.settle ? { settle: env.options.settle } : {}),
          profile: new Map([...this.answers].map(([kind, answer]) => [kind, answer.profile])),
          prior: (kind) => (signature === null ? null
            : this.state.repeatableCounters[repeatableCounterKey(signature, kind)] ?? null),
          record: (kind, counter) => this.feed({ type: 'REPEATABLE', kind, counter }),
          stopped: () => this.stopRequested,
        }, this.sections);
        this.alive();
      }
    }
    this.addsLeft = needsClicks(outcomes);

    // 2. The reactive loop, "I currently work here", then the final Guard over its rows and its latest scan.
    const loop = await this.fillLoop();
    const last = loop.scan;
    let rows = new Map(loop.rows.map((row) => [row.key, row]));
    for (const section of this.sections) rows = currentJobRows(rows, last, section, this.answers.get(section.kind));
    const guarded = finalGuard({ adapter, root: this.root, canaries: this.inMemory }, last, rows, loop.written);
    const after = guarded.reverted.size > 0 ? last.rescan() : last;

    // 3. The rows, notices and highlights.
    const busy = loop.busy !== null;
    if (busy) this.notices.add('page-busy');
    // Set by the checks before a later pass (recheck), while the loop ran.
    const cut = this.loopCut as LoopCut | null;
    if (cut?.kind === 'hidden') {
      log('content.form-hidden');
      this.notices.add('form-hidden');
    }
    const all = [...guarded.rows.values(), ...last.unrecognisedUploads.map(uploadRow)];
    this.noticesFromRows(all, last);
    this.counters = { passes: loop.passes, hiddenControlsIgnored: last.counters.hiddenControlsIgnored,
      deferredFields: last.counters.deferredFields };
    this.rows = all;
    this.settledStep = !busy;
    env.onRows(all);
    // A dry run wrote nothing, so only what would need the person is outlined.
    const outlined = this.request.dryRun
      ? new Map([...guarded.rows].filter(([, row]) => row.needsUserAction)) : guarded.rows;
    this.fieldHighlights = highlightItems(after, outlined, guarded.removeSelection);
    this.drawHighlights();
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
    return scan(this.root, page.adapter, { platform: page.app.platform, frameId: this.frameId,
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
      settled: this.settledStep, unconfirmedDrafts: this.rows.filter((row) => row.provenance === 'llm-draft').length } };
  }

  /** The errors one more pass could address: on a field no pass of this step planned (it showed after the loop), or
   *  on one the page emptied after our write. An error on a field the person must answer, or that holds our value,
   *  is surfaced instead. */
  private fixable(errors: readonly Element[]): number {
    if (errors.length === 0) return 0;
    const fresh = this.scanNow();
    const byKey = new Map(this.rows.map((row) => [row.key, row] as const));
    let count = 0;
    for (const error of errors) {
      const field = fresh.fields.find((candidate) => {
        const target = fresh.target(candidate.key);
        if (target === null) return false;
        const own = [target.control, ...target.members, ...(target.proxy === null ? [] : [target.proxy])];
        return own.some((el) => el === error || el.contains(error) || error.contains(el));
      });
      if (field === undefined) continue;
      const row = byKey.get(field.key);
      const emptied = field.current.kind === 'empty' || (field.current.kind === 'text' && field.current.text === '');
      if (row === undefined || (row.wrote && emptied)) count += 1;
    }
    return count;
  }

  /** press-next: the one untrusted click on the adapter's Next, never Submit (module header, 7). */
  private pressNext(): RunEvent {
    if (this.stopRequested) return { type: 'USER_STOPPED' };
    const { adapter } = this.env.page;
    const root = this.rootNow();
    // Never a click on a step other than the one validated: one that shows already is scanned instead.
    const moved = this.movedOn();
    if (moved !== null) return { type: 'TRANSITIONED', signature: moved };
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

  /** Outlines the step's Next or Submit for the person (drawn over it, never on it). */
  private highlightButton(which: 'next' | 'submit'): void {
    const { adapter } = this.env.page;
    let button: HTMLElement | null = null;
    try {
      button = which === 'next' ? adapter.nextButton?.(this.root) ?? null : adapter.submitButton?.(this.root) ?? null;
    } catch {
      button = null;
    }
    if (button === null) return;
    this.buttonHighlights = [...this.buttonHighlights.filter((item) => item.key !== `step:${which}`),
      { key: `step:${which}`, status: 'flagged', draft: false, elements: [button] }];
    this.drawHighlights();
  }

  /** pause {policy}: the card, until the person chooses (a run whose request carries Fill anyway takes it at once). */
  private async policyCard(): Promise<RunEvent> {
    if (this.request.policyAccepted === true) return { type: 'POLICY_ACCEPTED' };
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
    return { type: 'POLICY_ACCEPTED' };
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
      from: { state: this.state, event: { type: 'RESUMED', by: 'person', sameTab: true } } });
    return null;
  }

  /** pause {auth, handoff}: the person acts; their Continue starts the next run (the runtime). */
  private paused(): null {
    this.launcher({ state: 'needs-you', action: 'continue', reason: 'pause' });
    return null;
  }

  private notify(notice: StepNotice): void {
    if (notice === 'tripwire') this.notices.add('tripwire', this.tripwireHits);
    else if (notice === 'validation') this.notices.add('validation', this.lastErrors);
    else this.notices.add(notice);
    this.showNotices();
  }

  /** show-review: what needs the person is outlined, Next and Submit included when asked; the launcher says how many. */
  private showReview(cause: ReviewCause): void {
    if (cause === 'error') log('content.step-review-error');
    this.drawHighlights();
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

  private async execute(): Promise<void> {
    const { env } = this;
    const { page } = env;
    const ui = env.ui();
    ui?.resetNotices();
    ui?.hidePolicyCard();
    ui?.setHighlights([]);
    ui?.showFocus(null);
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
      env.ui()?.hidePolicyCard();
      this.launcher({ state: 'error', action: 'fill', reason: code === 'not_connected' ? 'not-connected' : 'failed' });
      this.end('error');
    } finally {
      this.choose = null;
    }
  }

  /** The fill step's reactive loop (loop.ts). plan/request carries the 32 nearest canaries; each write is scanned for
   *  all of the frame's (both as the checks before each later pass leave them). */
  private fillLoop(): Promise<LoopResult> {
    const { env } = this;
    const inMemory = () => this.inMemory;
    return runLoop({
      content: env.content,
      adapter: env.page.adapter,
      root: this.root,
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
      plan: (specs, planKeys, pass) => this.plan(specs, planKeys, pass),
      planSome: (specs, planKeys, pass) => this.plan(specs, planKeys, pass, true),
      poll: (keys) => this.poll(keys),
      recheck: () => this.recheck(),
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
