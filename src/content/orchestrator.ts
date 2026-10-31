/*
 * A run in one frame (docs/design/runtime.md §8.2, §8.3, §8.8; docs/ARCHITECTURE.md "Orchestrator"): begin, the
 * policy gate, the raw scan and tripwire, pause detection, the fill step, the final Guard, report. The fill step is the
 * reactive loop (loop.ts) on the core's bookkeeping, at most MAX_PASSES passes of scan, plan, write and settle; Phase 5
 * wraps it in the step machine.
 * 1. run/begin {applicationKey, trigger, dryRun} answers the run id, the settings and the policy states. In a frame
 *    inside another page, the run goes on only while the frame's launcher can be seen there (IntersectionObserver v2,
 *    ui/visible.ts): otherwise it fills nothing, reports the form-hidden notice and ends stopped (S1). The top frame
 *    is never checked: nothing outside it can hide it, and its form may simply sit below the fold.
 * 2. The policy gate, before anything is filled: a hit on the posting page, in the stored copy, or in this frame's own
 *    visible text stops the run at policy-notice, with the card shown and the report sent (so the side panel mirrors
 *    the card and its decision reaches this frame), until the person chooses Fill anyway or Cancel (trusted clicks on
 *    the card, or the side panel card's run/policyDecision to this frame; the toolbar's run/cancel also cancels, and
 *    its run/continue never fills). Cancel writes nothing. With nothing readable the
 *    couldn't-read notice shows, and a frame inside a page with none of our scripts adds posting-outside-frame.
 * 3. The raw scan and the tripwire: any hit shows the tripwire notice once. Every canary, nearest its hit first (at
 *    most 1024), stays in memory for the frame's own scans (before each write, and the final Guard), so decoys cannot
 *    push the real one out (CORE-15); only the 32 nearest go to plan/request and RunState. The policy patterns run over
 *    its hidden passages too: a hit only they make adds policy-hidden-text, and stops nothing.
 * 4. A sign-in, account, email-code or CAPTCHA step pauses: nothing on it is filled, and Continue starts afresh.
 * 5. The reactive loop (loop.ts: each pass's writes through pass.ts, settled and verified), then the final Guard
 *    (verify.ts) over the loop's rows and its latest scan. A page still busy at a settle's cap pauses the run (handoff,
 *    page-busy, the page-busy notice): what is left is flagged page-busy, and Continue starts a fresh run.
 *    Before every pass after the first, what the earlier passes revealed is checked as the page was at the start (the
 *    Phase 3 review, L-S2 and L-S4, decided by the lead): in a frame inside another page, the frame must still be seen
 *    (otherwise the loop is cut with form-hidden: the run ends stopped, with the form-hidden notice); the raw scan's new
 *    passages go through the tripwire (the notice once, their canaries merged into the frame's own, the 32 nearest
 *    recomputed for plan/request and RunState); the policy patterns run over the visible text (a hit cuts the loop at
 *    policy-notice and shows the card: Fill anyway starts a fresh run, whose gate sees the hit and takes that decision;
 *    Cancel ends the run stopped, policy-declined); and detectPause (a pause cuts the loop: the run pauses, with its
 *    notice, as at the start).
 * 6. report/put (no values; counters.passes the loop's) and runstate/put (the plan's persistableCanaries, or the 32
 *    nearest when a check found new canaries since the last plan, which the worker's store filters as it always does;
 *    the tripwire counts, lastFill, the loop's reveal edges, status review); the highlights and the launcher's
 *    "Review N".
 * An 'expired' answer to run/begin, plan/request or report/put begins the run again, once (the same call() will carry
 * plan/poll when Phase 4's fields wait for the LLM; before then nothing ever awaits); a second one ends the run in the
 * launcher's error state. The run ends for invalidation only on the platform's word (channel.ts).
 */
import type { Adapter } from '../adapters/types';
import type { ApplicationRef } from '../adapters';
import { scanTripwires } from '../core/guard/tripwire';
import type { BaseKey, FieldKey, FieldSpec } from '../core/types/field';
import type { FillResult, ReasonCode } from '../core/types/fill';
import type { PauseReason, RunState, RunStatus } from '../core/types/run';
import { detectPause, type PauseSignal } from '../dom/pause-detect';
import { rawScan, type RawPassage } from '../dom/raw-scan';
import type { ScanResult, WidgetReading } from '../dom/types';
import type { ErrorCode } from '../messaging/envelope';
import type { ContentPlatform } from '../platform/types';
import { log } from '../shared/log';
import { Invalidated, type AnsweredType, type AnswerData, type Channel, type MessageOf } from './channel';
import { runLoop, type LoopResult, type OptionsTimings, type SettleTimings } from './loop';
import { RunAborted, type PlanAnswer } from './pass';
import { frameHitsOf, hiddenPolicyHits, policyGateOf, postingOutsideFrame, type PolicyView } from './policy';
import { buildReport, buildRunState, NoticeBook, uploadRow, type ReportHeader, type ReportLimiter } from './report';
import { highlightItems } from './targets';
import type { LauncherView } from './ui/launcher';
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

/** How a run ended. */
export const RUN_ENDS = ['review', 'stopped', 'paused', 'error', 'aborted'] as const;
export type RunEnd = (typeof RUN_ENDS)[number];

/** What a run started with. */
export interface RunRequest {
  trigger: 'launcher' | 'panel';
  dryRun: boolean;
  /** The person chose Fill anyway at the policy card a run ago, on this page (the card a later pass's hit showed):
   *  this run's gate takes that decision instead of asking again. Set by the runtime only. */
  policyAccepted?: boolean;
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

/** What a pause sets: the run's status, its reason, and the notice. */
function pauseOf(signal: PauseSignal): { status: RunStatus; reason: PauseReason | null; notice: 'auth' | 'captcha' } {
  switch (signal.kind) {
    case 'sign-in':
    case 'create-account':
      return { status: 'auth-needed', reason: null, notice: 'auth' };
    case 'email-code':
      return { status: 'handoff', reason: 'email-code', notice: 'auth' };
    case 'entry-choice':
      return { status: 'handoff', reason: 'entry-choice', notice: 'auth' };
    case 'captcha':
      return { status: 'handoff', reason: 'captcha', notice: 'captcha' };
  }
}

/** The reason a pause found before a later pass gives what the loop leaves. */
function pauseCutOf(signal: PauseSignal): ReasonCode {
  return signal.kind === 'captcha' ? 'challenge-present' : 'auth-required';
}

/** What cut the loop before a later pass: the frame hidden, a policy statement, or a pause. */
type LoopCut = { kind: 'hidden' } | { kind: 'policy' } | { kind: 'pause'; signal: PauseSignal };

/** A passage's identity: a new one is one the run has not read. */
const passageId = (passage: RawPassage) => `${passage.origin}\u{0}${passage.text}`;

/** One run. start() runs it once; accept(), decline() and stop() are the person's choices while it runs. */
export class FillRun {
  /** The run's status as the report and RunState carry it. */
  status: RunStatus = 'detect';
  /** How it ended, once it has. */
  ended: RunEnd | null = null;
  private readonly controller = new AbortController();
  /** Aborted when the person stops the run: a wait for a list's options ends at once. */
  private readonly stopping = new AbortController();
  private readonly notices = new NoticeBook();
  private choose: ((choice: PolicyChoice) => void) | null = null;
  private stopRequested = false;
  private id: string | null = null;
  private expiredSeen = 0;
  private policy: PolicyView | null = null;
  private frameId = 0;
  private pauseReason: PauseReason | null = null;
  private policyDecision: RunState['policyDecision'] = null;
  private tripwireHits = 0;
  private started: Promise<RunEnd> | null = null;
  private isTop = true;
  /** Every canary this frame holds in memory (at most 1024, nearest their hit first): every write is scanned for them. */
  private inMemory: readonly string[] = [];
  /** The 32 nearest, for plan/request and RunState. */
  private sent: readonly string[] = [];
  /** A check found canaries no plan/request has carried yet. */
  private sentUnplanned = false;
  /** The raw passages read so far, and those with a tripwire hit: a later check reads only what is new. */
  private readonly passagesSeen = new Set<string>();
  /** What this run read of its lazy widgets, by base key (Phase 4): the loop's scans read it, and so do field/focus
   *  and field/describe once the run has rows. Option labels only (page text), in memory. */
  readonly widgetReadings = new Map<BaseKey, WidgetReading>();
  private hitPassages: RawPassage[] = [];
  /** What cut the loop before a later pass. */
  private loopCut: LoopCut | null = null;

  constructor(private readonly env: RunEnv, readonly request: RunRequest) {}

  /** Runs the run (once); resolves with how it ended. */
  start(): Promise<RunEnd> {
    this.started ??= this.execute();
    return this.started;
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

  /** run/cancel while the run writes: nothing more is written, and the run ends stopped. */
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

  private get runId(): string {
    if (this.id === null) throw new RunFailure('internal');
    return this.id;
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

  /** plan/request: the whole scan as context, planKeys to plan (LC-2), the 32 nearest canaries and the notices. */
  private async plan(specs: FieldSpec[], planKeys: FieldKey[], pass: number): Promise<PlanAnswer> {
    const notices = [
      ...(this.notices.has('tripwire') ? [{ kind: 'tripwire' as const, count: this.tripwireHits }] : []),
      ...(this.policyDecision === 'accepted' ? [{ kind: 'policy' as const, count: 1 }] : []),
    ];
    const canaries = [...this.sent];
    this.sentUnplanned = false;
    const answer = await this.call<'plan/request'>((runId) => ({ v: 1, type: 'plan/request', runId, pass, specs,
      planKeys, canaries, notices }));
    if ('failed' in answer) throw new RunFailure(answer.failed);
    return answer;
  }

  /** report/put: the run's rows and notices, never a value. A refusal other than a second 'expired' is logged. */
  private async report(rows: readonly FillResult[], counters: ReportHeader['counters'] = NO_COUNTERS): Promise<void> {
    const { page } = this.env;
    const answer = await this.call<'report/put'>((runId) => {
      const report = buildReport({ runId, frameId: this.frameId, platform: page.app.platform, adapter: page.adapter.id,
        dryRun: this.request.dryRun, status: this.status, pauseReason: this.pauseReason, notices: this.notices,
        counters, now: this.env.now() }, rows);
      if (report === null) throw new RunFailure('internal');
      return { v: 1, type: 'report/put', runId, report };
    }, () => this.env.limiter.turn(this.controller.signal));
    if ('failed' in answer) log('content.report-refused');
  }

  /** runstate/put: keys, counts, reveal edges and the canaries the worker allows; never a value. Not for a dry run. */
  private async putRunState(canarySet: readonly string[], rows: readonly FillResult[] | null, startedAt: number,
    revealEdges: ReadonlyArray<readonly [BaseKey, BaseKey]> = []): Promise<void> {
    if (this.request.dryRun) return;
    const { page } = this.env;
    const runState = buildRunState({ applicationKey: page.app.applicationKey, platform: page.app.platform,
      status: this.status, pauseReason: this.pauseReason, canarySet,
      tripwire: { triggered: this.tripwireHits > 0, hits: this.tripwireHits }, policyDecision: this.policyDecision, rows,
      revealEdges, startedAt, now: this.env.now() });
    const answer = await this.env.channel.request({ v: 1, type: 'runstate/put', runState });
    this.alive();
    if (!answer.ok) log('content.runstate-refused');
  }

  // ── What the page shows ─────────────────────────────────────────────────────────────────────────────────────────

  /** Reads raw passages into the tripwire: those not read before go through scanTripwires with the passages that hit
   *  before, so the notice is raised once, every canary is merged into the frame's own, and the 32 nearest are
   *  recomputed. Answers the new passages. */
  private absorbPassages(passages: readonly RawPassage[]): RawPassage[] {
    const fresh = passages.filter((passage) => !this.passagesSeen.has(passageId(passage)));
    for (const passage of fresh) this.passagesSeen.add(passageId(passage));
    if (fresh.length === 0) return fresh;
    const read = [...this.hitPassages, ...fresh];
    const tripwire = scanTripwires(read);
    if (!tripwire.notice) return fresh;
    const hit = new Set(tripwire.hits.map((found) => found.passage));
    this.hitPassages = read.filter((_, at) => hit.has(at));
    if (tripwire.canaries.join('\u{0}') !== this.sent.join('\u{0}')) this.sentUnplanned = true;
    this.inMemory = tripwire.allCanaries;
    this.sent = tripwire.canaries;
    this.tripwireHits = tripwire.hits.length;
    this.notices.add('tripwire', tripwire.hits.length);
    return fresh;
  }

  /** The checks before a pass after the first (L-S2, L-S4): null to go on, or the reason that cuts the loop. */
  private async recheck(): Promise<ReasonCode | null> {
    const { env } = this;
    const { page } = env;
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
    if (this.policyDecision !== 'accepted') {
      if (frameHitsOf(env.doc).length > 0) {
        this.loopCut = { kind: 'policy' };
        this.showNotices();
        return 'policy-notice';
      }
      if (hiddenPolicyHits(fresh).length > 0) this.notices.add('policy-hidden-text');
    }
    this.showNotices();
    const paused = detectPause(env.doc, page.root, page.adapter);
    if (paused !== null) {
      this.loopCut = { kind: 'pause', signal: paused };
      return pauseCutOf(paused);
    }
    return null;
  }

  // ── The run ─────────────────────────────────────────────────────────────────────────────────────────────────────

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

  private end(how: RunEnd): RunEnd {
    this.ended = how;
    return how;
  }

  private async execute(): Promise<RunEnd> {
    const { env } = this;
    const { page } = env;
    const startedAt = env.now();
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
          this.status = 'stopped';
          this.showNotices();
          await this.report([]);
          this.launcher({ state: 'idle', action: 'fill' });
          return this.end('stopped');
        }
      }

      // 2. The policy gate, before anything is filled.
      const view = env.doc.defaultView;
      if (view !== null && postingOutsideFrame(view, frame.isTop)) this.notices.add('posting-outside-frame');
      const gate = policyGateOf(this.policy ?? { postingPage: 'unseen', storedCopy: 'unavailable' }, frameHitsOf(env.doc));
      if (gate.blocked && this.request.policyAccepted === true) {
        // The person chose Fill anyway at this page's card, which a later pass of the run before showed.
        this.notices.add('policy');
        this.policyDecision = 'accepted';
      } else if (gate.blocked) {
        this.notices.add('policy');
        this.status = 'policy-notice';
        this.showNotices();
        ui?.showPolicyCard({ fromStoredCopy: gate.fromStoredCopy });
        this.launcher({ state: 'needs-you', action: 'open-review', reason: 'policy' });
        const waiting = this.waitForChoice();
        // Handled here as well: if the report fails or the run is aborted first, nothing waits on it.
        waiting.catch(() => undefined);
        await this.report([]);
        const choice = await waiting;
        this.alive();
        ui?.hidePolicyCard();
        if (choice === 'declined') {
          this.policyDecision = 'declined';
          this.status = 'stopped';
          await this.report([]);
          await this.putRunState([], null, startedAt);
          this.launcher({ state: 'idle', action: 'fill' });
          return this.end('stopped');
        }
        this.policyDecision = 'accepted';
        this.launcher({ state: 'running', action: null });
      } else if (gate.unreadable) {
        this.notices.add('policy-unreadable');
      }
      this.showNotices();

      // 3. The raw scan and the tripwire: page text addressed to AI tools, wherever it is hidden.
      const raw = await rawScan(env.doc, { signal: this.controller.signal });
      this.alive();
      // The 32 nearest their hit are sent and stored; the frame's own scans read them all (CORE-15).
      this.absorbPassages(raw.passages);
      // Policy text that only text a person cannot see yet holds (behind "Show more") informs; it stops nothing (S6).
      if (!gate.blocked && hiddenPolicyHits(raw.passages).length > 0) this.notices.add('policy-hidden-text');
      this.showNotices();

      // 4. A step that needs the person: nothing on it is filled.
      const paused = detectPause(env.doc, page.root, page.adapter);
      if (paused !== null) {
        const pause = pauseOf(paused);
        this.status = pause.status;
        this.pauseReason = pause.reason;
        this.notices.add(pause.notice);
        this.showNotices();
        await this.report([]);
        await this.putRunState(this.sent, null, startedAt);
        this.launcher({ state: 'needs-you', action: 'continue', reason: 'pause' });
        return this.end('paused');
      }

      // The person stopped the run before anything was planned: nothing is.
      if (this.stopRequested) {
        this.status = 'stopped';
        await this.report([]);
        await this.putRunState(this.sent, null, startedAt);
        this.launcher({ state: 'idle', action: 'fill' });
        return this.end('stopped');
      }

      // 5. The fill step: the reactive loop, then the final Guard over its rows and its latest scan.
      this.status = 'fill-step';
      const loop = await this.fillStep();
      const last = loop.scan;
      const guarded = finalGuard({ adapter: page.adapter, root: page.root, canaries: this.inMemory }, last,
        new Map(loop.rows.map((row) => [row.key, row])), loop.written);
      const after = guarded.reverted.size > 0 ? last.rescan() : last;

      // 6. Report. A page still busy at a settle's cap pauses the run: Continue starts afresh. So does a pause a later
      // pass found; a frame its page hid mid-fill ends stopped; a policy statement shows the card.
      const busy = loop.busy !== null;
      if (busy) this.notices.add('page-busy');
      const cut = this.loopCut;
      if (cut?.kind === 'hidden') {
        log('content.form-hidden');
        this.notices.add('form-hidden');
      }
      if (cut?.kind === 'pause') this.notices.add(pauseOf(cut.signal).notice);
      const all = [...guarded.rows.values(), ...last.unrecognisedUploads.map(uploadRow)];
      this.noticesFromRows(all, last);
      const counters = { passes: loop.passes, hiddenControlsIgnored: last.counters.hiddenControlsIgnored,
        deferredFields: last.counters.deferredFields };
      // The canaries a later check found since the last plan are stored too (the worker's store filters them).
      const persisted = this.sentUnplanned ? this.sent : loop.persistableCanaries;
      env.onRows(all);
      // A dry run wrote nothing, so only what would need the person is outlined.
      const outlined = this.request.dryRun
        ? new Map([...guarded.rows].filter(([, row]) => row.needsUserAction)) : guarded.rows;
      env.ui()?.setHighlights(highlightItems(after, outlined, guarded.removeSelection));
      if (cut?.kind === 'policy' && !this.stopRequested) {
        return await this.waitAtPolicyCard(all, counters, persisted, startedAt, loop.revealEdges);
      }
      const end: RunEnd = this.stopRequested || cut?.kind === 'hidden' || cut?.kind === 'policy' ? 'stopped'
        : busy || cut?.kind === 'pause' ? 'paused' : 'review';
      const pause = cut?.kind === 'pause' && !this.stopRequested ? pauseOf(cut.signal) : null;
      this.status = end === 'stopped' ? 'stopped' : pause !== null ? pause.status : end === 'paused' ? 'handoff'
        : 'review';
      this.pauseReason = pause !== null ? pause.reason : end === 'paused' ? 'page-busy' : null;
      this.showNotices();
      await this.report(all, counters);
      await this.putRunState(persisted, all, startedAt, loop.revealEdges);
      const count = all.filter((row) => row.needsUserAction).length;
      this.launcher(end === 'stopped' ? { state: 'idle', action: 'fill' }
        : end === 'paused' ? { state: 'needs-you', action: 'continue', reason: 'pause' }
          : { state: 'review', action: 'open-review', count });
      return this.end(end);
    } catch (failure) {
      if (failure instanceof Invalidated || failure instanceof RunAborted || this.controller.signal.aborted) {
        return this.end('aborted');
      }
      const code: ErrorCode = failure instanceof RunFailure ? failure.code : 'internal';
      log('content.run-failed', { notConnected: code === 'not_connected', expired: code === 'expired' });
      env.ui()?.hidePolicyCard();
      this.launcher({ state: 'error', action: 'fill', reason: code === 'not_connected' ? 'not-connected' : 'failed' });
      return this.end('error');
    } finally {
      this.choose = null;
    }
  }

  /** The policy card a later pass's hit showed (L-S2): the run waits there, its rows reported. Cancel ends it stopped
   *  (policy-declined); Fill anyway ends it and starts a fresh run, whose gate takes that decision. */
  private async waitAtPolicyCard(rows: readonly FillResult[], counters: ReportHeader['counters'],
    persisted: readonly string[], startedAt: number, revealEdges: ReadonlyArray<readonly [BaseKey, BaseKey]>):
    Promise<RunEnd> {
    const ui = this.env.ui();
    this.notices.add('policy');
    this.status = 'policy-notice';
    this.showNotices();
    ui?.showPolicyCard({ fromStoredCopy: false });
    this.launcher({ state: 'needs-you', action: 'open-review', reason: 'policy' });
    const waiting = this.waitForChoice();
    // Handled here as well: if the report fails or the run is aborted first, nothing waits on it.
    waiting.catch(() => undefined);
    await this.report(rows, counters);
    const choice = await waiting;
    this.alive();
    ui?.hidePolicyCard();
    if (choice === 'declined') {
      this.policyDecision = 'declined';
      this.status = 'stopped';
      const declined = rows.map((row) => (row.reason === 'policy-notice' ? { ...row, reason: 'policy-declined' as const }
        : row));
      this.env.onRows(declined);
      await this.report(declined, counters);
      await this.putRunState(persisted, declined, startedAt, revealEdges);
      this.launcher({ state: 'idle', action: 'fill' });
      return this.end('stopped');
    }
    this.policyDecision = 'accepted';
    const ended = this.end('stopped');
    this.env.fillAgain({ ...this.request, policyAccepted: true });
    return ended;
  }

  /** The fill step: the reactive loop (loop.ts). plan/request carries the 32 nearest canaries; each write is scanned
   *  for all of the frame's (both as the checks before each later pass leave them). */
  private fillStep(): Promise<LoopResult> {
    const { env } = this;
    const inMemory = () => this.inMemory;
    return runLoop({
      content: env.content,
      adapter: env.page.adapter,
      root: env.page.root,
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
      recheck: () => this.recheck(),
      widgetReadings: this.widgetReadings,
      runId: () => this.runId,
      ...(env.options.resume ? { resume: env.options.resume } : {}),
      ...(env.options.settle ? { settle: env.options.settle } : {}),
      ...(env.options.awaitOptions ? { options: env.options.awaitOptions } : {}),
    });
  }

  /** The notices the rows and the scan raise: attention checks, controls that need the person's click, fields not
   *  rendered yet, and errors the page shows. */
  private noticesFromRows(rows: readonly FillResult[], scan: ScanResult): void {
    const attention = rows.filter((row) => row.reason === 'attention-check').length;
    if (attention > 0) this.notices.add('attention-check', attention);
    const clicks = rows.filter((row) => row.reason === 'needs-your-click').length;
    if (clicks > 0) this.notices.add('needs-click', clicks);
    if (scan.counters.deferredFields > 0) this.notices.add('deferred-fields', scan.counters.deferredFields);
    let errors = 0;
    try {
      errors = this.env.page.adapter.errors?.(this.env.page.root).length ?? 0;
    } catch {
      errors = 0;
    }
    if (errors > 0) this.notices.add('validation', errors);
  }
}
