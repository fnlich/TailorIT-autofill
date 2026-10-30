/*
 * A run in one frame (docs/design/runtime.md §8.2, §8.3, §8.8; docs/ARCHITECTURE.md "Orchestrator"). Phase 2's run is
 * one pass: begin, the policy gate, the raw scan and tripwire, pause detection, plan and write, settle, verify, the
 * final Guard, report. Phase 3 replaces fillStep() (one pass, then settleWrites()) with the reactive loop on the
 * core's bookkeeping, up to MAX_PASSES; Phase 5 wraps that in the step machine. The rest stays.
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
 * 5. One pass (pass.ts), the settle (quiet.ts), the verification and the final Guard (verify.ts).
 * 6. report/put (no values) and runstate/put (the plan's persistableCanaries, the tripwire counts, lastFill, status
 *    review); the highlights and the launcher's "Review N".
 * An 'expired' answer to run/begin, plan/request or report/put begins the run again, once (the same call() will carry
 * plan/poll when Phase 4's fields wait for the LLM; before then nothing ever awaits); a second one ends the run in the
 * launcher's error state. The run ends for invalidation only on the platform's word (channel.ts).
 */
import type { Adapter } from '../adapters/types';
import type { ApplicationRef } from '../adapters';
import { scanTripwires } from '../core/guard/tripwire';
import type { FieldSpec } from '../core/types/field';
import type { FillResult } from '../core/types/fill';
import type { PauseReason, RunState, RunStatus } from '../core/types/run';
import { detectPause, type PauseSignal } from '../dom/pause-detect';
import { rawScan } from '../dom/raw-scan';
import type { ScanResult, SettleResult } from '../dom/types';
import type { ErrorCode } from '../messaging/envelope';
import type { ContentPlatform } from '../platform/types';
import { log } from '../shared/log';
import { Invalidated, type AnsweredType, type AnswerData, type Channel, type MessageOf } from './channel';
import { RunAborted, runPass, type PassResult, type PlanAnswer } from './pass';
import { frameHitsOf, hiddenPolicyHits, policyGateOf, postingOutsideFrame, type PolicyView } from './policy';
import { waitForQuiet, type QuietOptions } from './quiet';
import { buildReport, buildRunState, NoticeBook, uploadRow, type ReportLimiter } from './report';
import { highlightItems } from './targets';
import type { LauncherView } from './ui/launcher';
import type { PolicyChoice } from './ui/notices';
import type { PageUi } from './ui/page-ui';
import { finalGuard, verifyWritten } from './verify';

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
}

/** The page a run fills: its application, adapter and form root, as they were when it started. */
export interface RunPage {
  app: ApplicationRef;
  adapter: Adapter;
  root: Element;
}

/** Overrides of the run's waits, for tests. */
export interface RunOptions {
  quiet?: Omit<QuietOptions, 'signal'>;
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
  /** Whether a person can see this frame's launcher on its page (IntersectionObserver v2; false without a launcher). */
  frameShown(signal: AbortSignal): Promise<boolean>;
  page: RunPage;
  now(): number;
  options: RunOptions;
  /** The run's rows, once it has them: field/describe reads their suggestions. */
  onRows(rows: readonly FillResult[]): void;
}

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

/** One run. start() runs it once; accept(), decline() and stop() are the person's choices while it runs. */
export class FillRun {
  /** The run's status as the report and RunState carry it. */
  status: RunStatus = 'detect';
  /** How it ended, once it has. */
  ended: RunEnd | null = null;
  private readonly controller = new AbortController();
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

  private async plan(specs: FieldSpec[], pass: number, canaries: readonly string[]): Promise<PlanAnswer> {
    const notices = [
      ...(this.notices.has('tripwire') ? [{ kind: 'tripwire' as const, count: this.tripwireHits }] : []),
      ...(this.policyDecision === 'accepted' ? [{ kind: 'policy' as const, count: 1 }] : []),
    ];
    const answer = await this.call<'plan/request'>((runId) => ({ v: 1, type: 'plan/request', runId, pass, specs,
      canaries: [...canaries], notices }));
    if ('failed' in answer) throw new RunFailure(answer.failed);
    return answer;
  }

  /** report/put: the run's rows and notices, never a value. A refusal other than a second 'expired' is logged. */
  private async report(rows: readonly FillResult[], scan: ScanResult | null): Promise<void> {
    const counters = { passes: scan === null ? 0 : 1, hiddenControlsIgnored: scan?.counters.hiddenControlsIgnored ?? 0,
      deferredFields: scan?.counters.deferredFields ?? 0 };
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

  /** runstate/put: keys, counts and the canaries the worker allows; never a value. Not for a dry run. */
  private async putRunState(canarySet: readonly string[], rows: readonly FillResult[] | null, startedAt: number):
    Promise<void> {
    if (this.request.dryRun) return;
    const { page } = this.env;
    const runState = buildRunState({ applicationKey: page.app.applicationKey, platform: page.app.platform,
      status: this.status, pauseReason: this.pauseReason, canarySet,
      tripwire: { triggered: this.tripwireHits > 0, hits: this.tripwireHits }, policyDecision: this.policyDecision, rows,
      startedAt, now: this.env.now() });
    const answer = await this.env.channel.request({ v: 1, type: 'runstate/put', runState });
    this.alive();
    if (!answer.ok) log('content.runstate-refused');
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
    let pass: PassResult | null = null;
    try {
      const frame = await env.frame();
      this.alive();
      this.frameId = frame.frameId;
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
          await this.report([], null);
          this.launcher({ state: 'idle', action: 'fill' });
          return this.end('stopped');
        }
      }

      // 2. The policy gate, before anything is filled.
      const view = env.doc.defaultView;
      if (view !== null && postingOutsideFrame(view, frame.isTop)) this.notices.add('posting-outside-frame');
      const gate = policyGateOf(this.policy ?? { postingPage: 'unseen', storedCopy: 'unavailable' }, frameHitsOf(env.doc));
      if (gate.blocked) {
        this.notices.add('policy');
        this.status = 'policy-notice';
        this.showNotices();
        ui?.showPolicyCard({ fromStoredCopy: gate.fromStoredCopy });
        this.launcher({ state: 'needs-you', action: 'open-review', reason: 'policy' });
        const waiting = this.waitForChoice();
        // Handled here as well: if the report fails or the run is aborted first, nothing waits on it.
        waiting.catch(() => undefined);
        await this.report([], null);
        const choice = await waiting;
        this.alive();
        ui?.hidePolicyCard();
        if (choice === 'declined') {
          this.policyDecision = 'declined';
          this.status = 'stopped';
          await this.report([], null);
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
      const tripwire = scanTripwires(raw.passages);
      // The 32 nearest their hit are sent and stored; the frame's own scans read them all (CORE-15).
      const canaries = tripwire.canaries;
      const inMemory = tripwire.allCanaries;
      this.tripwireHits = tripwire.hits.length;
      if (tripwire.notice) this.notices.add('tripwire', tripwire.hits.length);
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
        await this.report([], null);
        await this.putRunState(canaries, null, startedAt);
        this.launcher({ state: 'needs-you', action: 'continue', reason: 'pause' });
        return this.end('paused');
      }

      // The person stopped the run before anything was planned: nothing is.
      if (this.stopRequested) {
        this.status = 'stopped';
        await this.report([], null);
        await this.putRunState(canaries, null, startedAt);
        this.launcher({ state: 'idle', action: 'fill' });
        return this.end('stopped');
      }

      // 5. Fill (Phase 3 replaces fillStep with the reactive loop).
      this.status = 'fill-step';
      pass = await this.fillStep(canaries, inMemory);
      const settled = pass.written.length > 0 ? await this.settleWrites() : null;
      if (settled !== null && !settled.settled) this.notices.add('page-busy');
      const fresh = pass.scan.rescan();
      const rows = new Map(pass.rows);
      for (const written of pass.written) rows.set(written.key, verifyWritten(fresh, written));
      const guarded = finalGuard({ adapter: page.adapter, root: page.root, canaries: inMemory }, fresh, rows,
        pass.written);
      const after = guarded.reverted.size > 0 ? fresh.rescan() : fresh;

      // 6. Report.
      const all = [...guarded.rows.values(), ...pass.scan.unrecognisedUploads.map(uploadRow)];
      this.noticesFromRows(all, pass.scan);
      this.status = this.stopRequested ? 'stopped' : 'review';
      this.showNotices();
      env.onRows(all);
      // A dry run wrote nothing, so only what would need the person is outlined.
      const outlined = this.request.dryRun
        ? new Map([...guarded.rows].filter(([, row]) => row.needsUserAction)) : guarded.rows;
      env.ui()?.setHighlights(highlightItems(after, outlined, guarded.removeSelection));
      await this.report(all, pass.scan);
      await this.putRunState(pass.persistableCanaries, all, startedAt);
      const count = all.filter((row) => row.needsUserAction).length;
      this.launcher(this.stopRequested ? { state: 'idle', action: 'fill' }
        : { state: 'review', action: 'open-review', count });
      return this.end(this.stopRequested ? 'stopped' : 'review');
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
      for (const written of pass?.written ?? []) written.resume?.release();
    }
  }

  /** Phase 2's fill step: one pass. Phase 3 runs passes until nothing is pending (MAX_PASSES), settling between.
   *  `canaries` go to plan/request; the pass scans each write for `inMemory`, all of the frame's canaries. */
  private fillStep(canaries: readonly string[], inMemory: readonly string[]): Promise<PassResult> {
    const { env } = this;
    return runPass({
      content: env.content,
      adapter: env.page.adapter,
      root: env.page.root,
      platform: env.page.app.platform,
      frameId: this.frameId,
      dryRun: this.request.dryRun,
      canaries: inMemory,
      signal: this.controller.signal,
      valid: () => env.channel.valid(),
      stopped: () => this.stopRequested,
      plan: (specs, pass) => this.plan(specs, pass, canaries),
      runId: () => this.runId,
      ...(env.options.resume ? { resume: env.options.resume } : {}),
    }, 0);
  }

  /** Phase 2's settle after the writes (quiet.ts); Phase 3 calls dom/settle.ts's settle() here instead. */
  private async settleWrites(): Promise<SettleResult> {
    const result = await waitForQuiet(this.env.page.root, { ...this.env.options.quiet, signal: this.controller.signal });
    this.alive();
    return result;
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
