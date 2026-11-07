/*
 * What a frame tells the worker about its run (docs/ARCHITECTURE.md "Message catalogue": report/put and runstate/put;
 * docs/design/runtime.md §4.7). Neither ever carries a value:
 * - A FrameReport holds the rows (the core's FillResult: labels, statuses, reasons and provenance, never a value or an
 *   option label), the notices and the counters. It is checked against the strict FrameReportSchema before it leaves.
 *   report/put goes out at most REPORT_PUTS_PER_SECOND times a second per frame: a put that would pass the limit waits
 *   for its slot, with dom/time.ts's deadline as the only timer.
 * - RunState is the step machine's (Phase 5): keys, hashes, counts, the reactive loop's reveal edges (base keys, at
 *   most MAX_REVEAL_EDGES) and the canaries a plan's persistableCanaries allowed (never one that equals a profile
 *   value), never a field value. The worker stamps its own updatedAt.
 * A hidden file input beside a visible upload control that did not qualify gets a flagged row of its own here
 * (upload-control-not-recognized); it is never written, focused or sent an event.
 * v4 (the owner, 2026-11-07: "Never flag to the user, just determine with your own"; docs/_v4/run.md):
 * - a report's rows keep the core's statuses and needsUserAction (the trap specs read them); what asks anything of the
 *   person is shared/report.ts needsPerson alone (a hard-rule stop), and what is filled its isReady;
 * - the notices are the facts the worker reads (the agent's verdict, the posting's AI rule, the counters), never shown:
 *   NoticeBook drops the informational ones (DROPPED_NOTICES, D9) no reader takes;
 * - RunState.lastFill counts what holds auto-advance: the required fields the fill left empty (`flagged`) and the
 *   hard-rule stops left (`blocked`); `unresolved` is always 0 (nothing decidable holds Next: D3).
 */
import type { AdapterId } from '../adapters/types';
import type { Platform } from '../core/enums';
import { MAX_REVEAL_EDGES } from '../core/loop/bookkeeping';
import { sectionKey } from '../core/text/keys';
import type { FillResult } from '../core/types/fill';
import type { PauseReason, RunState, RunStatus } from '../core/types/run';
import { deadline, monotonicNow } from '../dom/time';
import type { UnrecognisedUpload } from '../dom/types';
import { log } from '../shared/log';
import { FrameReportSchema, MAX_STEP_PROGRESS, needsPerson, notFilled, type FrameReport } from '../shared/report';

/** report/put's limit per frame (the worker refuses more). */
export const REPORT_PUTS_PER_SECOND = 4;
const REPORT_WINDOW_MS = 1000;
/** A report holds at most this many rows (FrameReportSchema's cap). */
export const MAX_REPORT_ROWS = 500;

/** A report notice's code. */
export type NoticeCode = FrameReport['notices'][number]['code'];

/** The row of a hidden file input that did not qualify, beside a visible upload control. */
export function uploadRow(upload: UnrecognisedUpload): FillResult {
  return {
    key: upload.key, label: upload.label, kind: 'file', category: 'file.other', section: sectionKey(upload.section),
    required: false, status: 'flagged', provenance: null, matcherStage: 'not-applicable', confidence: 0,
    reason: 'upload-control-not-recognized', wrote: false, verification: 'not-applicable', needsUserAction: true,
  };
}

/** v4 (D9): the informational notices no reader of a report takes (the worker's agent, its no-AI checks and counters
 *  read the rest): never raised, so no report carries them. */
export const DROPPED_NOTICES: ReadonlySet<NoticeCode> = new Set<NoticeCode>(['policy-unreadable', 'attention-check',
  'page-busy', 'needs-click', 'posting-outside-frame', 'deferred-fields', 'policy-hidden-text', 'submit-auto-unchecked',
  'sign-in-unavailable', 'account-left', 'page-turned', 'submit-held-entries']);

/** The run's notices in the order they were raised, each once, with an optional count (DROPPED_NOTICES never). */
export class NoticeBook {
  private readonly entries = new Map<NoticeCode, number | undefined>();

  add(code: NoticeCode, count?: number): void {
    if (DROPPED_NOTICES.has(code)) return;
    const before = this.entries.get(code);
    this.entries.set(code, count === undefined ? before : Math.max(before ?? 0, count));
  }

  has(code: NoticeCode): boolean {
    return this.entries.has(code);
  }

  /** Forgets these codes: a new step's notices start afresh (Phase 5), the run's own (tripwire, policy) kept. */
  forget(codes: readonly NoticeCode[]): void {
    for (const code of codes) this.entries.delete(code);
  }

  /** The codes, in order. */
  codes(): NoticeCode[] {
    return [...this.entries.keys()];
  }

  /** As a FrameReport carries them (a count only when it is positive). */
  forReport(): FrameReport['notices'] {
    return [...this.entries].map(([code, count]) => (count !== undefined && count > 0 ? { code, count } : { code }));
  }
}

/** What a report says about the run, besides its rows. */
export interface ReportHeader {
  runId: string;
  frameId: number;
  platform: Platform;
  adapter: AdapterId;
  dryRun: boolean;
  status: RunStatus;
  pauseReason: PauseReason | null;
  notices: NoticeBook;
  counters: { passes: number; hiddenControlsIgnored: number; deferredFields: number };
  /** The step the multi-step machine is on (RunState.stepIndex), for an adapter that tells steps apart; none for one
   *  that cannot (the generic adapter). `progress`: the adapter's progress line ("Step 2 of 4"), visible page text. */
  step?: { index: number; progress?: string | undefined };
  now: number;
  /** While the run fills (v3 Phase 3): the field written now and those still to be written. Keys only. */
  filling?: FrameReport['filling'];
  /** The step's repeatable sections, counted (v3 Phase 3). */
  repeatables?: FrameReport['repeatables'];
  /** The run rests in a working status (FrameReport.resting): waiting for the person's own Next. */
  resting?: boolean;
  /** v3 Phase 4: what the step offers the panel's Next and Submit (FrameReport.buttons), at rest. */
  buttons?: FrameReport['buttons'];
}

/** A progress line as a report carries it: whitespace collapsed, at most MAX_STEP_PROGRESS characters, none when
 *  empty. */
export function progressLine(text: string | undefined): string | undefined {
  const line = (text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_STEP_PROGRESS).trim();
  return line === '' ? undefined : line;
}

/** The report's step: its index, and the progress line when there is one. */
function stepOf(step: NonNullable<ReportHeader['step']>): NonNullable<FrameReport['step']> {
  const progress = progressLine(step.progress);
  return { index: Math.max(0, Math.floor(step.index)), ...(progress === undefined ? {} : { progress }) };
}

/** A FrameReport, or null when it would not pass the strict schema (a bug: it is logged, never sent). */
export function buildReport(header: ReportHeader, rows: readonly FillResult[]): FrameReport | null {
  const report = {
    v: 1 as const,
    runId: header.runId,
    frameId: header.frameId,
    platform: header.platform,
    adapter: header.adapter,
    mode: header.dryRun ? 'dry-run' as const : 'fill' as const,
    status: header.status,
    pauseReason: header.status === 'handoff' ? header.pauseReason : null,
    ...(header.step === undefined ? {} : { step: stepOf(header.step) }),
    fields: rows.slice(0, MAX_REPORT_ROWS),
    ...(header.filling === undefined ? {} : { filling: { current: header.filling.current,
      pending: header.filling.pending.slice(0, MAX_REPORT_ROWS) } }),
    ...(header.repeatables === undefined || header.repeatables.length === 0 ? {}
      : { repeatables: header.repeatables.map((count) => ({ ...count })) }),
    ...(header.resting === true ? { resting: true as const } : {}),
    ...(header.buttons === undefined ? {} : { buttons: { ...header.buttons } }),
    notices: header.notices.forReport(),
    counters: header.counters,
    updatedAt: Math.max(0, Math.floor(header.now)),
  };
  const parsed = FrameReportSchema.safeParse(report);
  if (!parsed.success) {
    log('content.report-invalid', { fields: report.fields.length });
    return null;
  }
  return parsed.data;
}

/** RunState's lastFill (v4, D3): what holds auto-advance on the step. `flagged`: the required fields the fill left
 *  empty (shared/report.ts notFilled, a hard-rule stop aside); `blocked`: the hard-rule stops left (a bot check asked
 *  as a question); `unresolved`: nothing (a low-confidence fill, a kept prefill, a hidden or refused field, a value the
 *  page shows differently: none of them holds Next any more). */
export function lastFillOf(rows: readonly FillResult[]): NonNullable<RunState['lastFill']> {
  return {
    flagged: rows.filter((row) => row.required && notFilled(row) && !needsPerson(row)).length,
    blocked: rows.filter((row) => needsPerson(row)).length,
    unresolved: 0,
  };
}

/**
 * RunState as runstate/put carries it (Phase 5): the step machine's own state (steps/machine.ts reduceRun keeps it),
 * with its canary set narrowed to the canaries a plan's answer allowed into RunState (persistableCanaries) or that a
 * stored RunState already held: page text the worker has checked, never one that equals a profile value. The worker
 * checks them again when it stores, and stamps its own updatedAt. Keys, hashes, counts and ids only: never a value.
 */
export function persistedRunState(state: RunState, checkedCanaries: ReadonlySet<string>): RunState {
  return { ...state, canarySet: state.canarySet.filter((canary) => checkedCanaries.has(canary)).slice(0, 32),
    revealEdges: state.revealEdges.slice(0, MAX_REVEAL_EDGES).map(([parent, child]) => [parent, child]) };
}

/** Keeps report/put to REPORT_PUTS_PER_SECOND a second for this frame: every put waits for its turn first. */
export interface ReportLimiter {
  /** Resolves when one more put fits the window (in call order), and counts it. */
  turn(signal?: AbortSignal): Promise<void>;
}

/** One limiter per frame, shared by its runs. */
export function createReportLimiter(options: { perSecond?: number } = {}): ReportLimiter {
  const perSecond = options.perSecond ?? REPORT_PUTS_PER_SECOND;
  const sent: number[] = [];
  let queue: Promise<void> = Promise.resolve();

  async function slot(signal?: AbortSignal): Promise<void> {
    for (;;) {
      const now = monotonicNow();
      while (sent.length > 0 && now - sent[0]! >= REPORT_WINDOW_MS) sent.shift();
      if (sent.length < perSecond) {
        sent.push(now);
        return;
      }
      if (await deadline(REPORT_WINDOW_MS - (now - sent[0]!) + 1, signal) === 'aborted') return;
    }
  }

  return {
    turn(signal) {
      const mine = queue.then(() => slot(signal));
      queue = mine.catch(() => undefined);
      return mine;
    },
  };
}
