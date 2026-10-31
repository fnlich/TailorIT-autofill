/*
 * What a frame tells the worker about its run (docs/ARCHITECTURE.md "Message catalogue": report/put and runstate/put;
 * docs/design/runtime.md §4.7). Neither ever carries a value:
 * - A FrameReport holds the rows (the core's FillResult: labels, statuses, reasons and provenance, never a value or an
 *   option label), the notices and the counters. It is checked against the strict FrameReportSchema before it leaves.
 *   report/put goes out at most REPORT_PUTS_PER_SECOND times a second per frame: a put that would pass the limit waits
 *   for its slot, with dom/time.ts's deadline as the only timer.
 * - RunState holds keys, counts, the reactive loop's reveal edges (base keys, at most MAX_REVEAL_EDGES) and the plan's
 *   persistableCanaries (the canaries the worker allows, never one that equals a profile value), never a field value.
 *   The worker stamps its own updatedAt.
 * A hidden file input beside a visible upload control that did not qualify gets a flagged row of its own here
 * (upload-control-not-recognized); it is never written, focused or sent an event.
 */
import type { AdapterId } from '../adapters/types';
import type { Platform } from '../core/enums';
import { MAX_REVEAL_EDGES } from '../core/loop/bookkeeping';
import { sectionKey } from '../core/text/keys';
import type { BaseKey } from '../core/types/field';
import type { FillResult } from '../core/types/fill';
import type { PauseReason, RunState, RunStatus } from '../core/types/run';
import { deadline, monotonicNow } from '../dom/time';
import type { UnrecognisedUpload } from '../dom/types';
import { log } from '../shared/log';
import { FrameReportSchema, type FrameReport } from '../shared/report';

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

/** The run's notices in the order they were raised, each once, with an optional count. */
export class NoticeBook {
  private readonly entries = new Map<NoticeCode, number | undefined>();

  add(code: NoticeCode, count?: number): void {
    const before = this.entries.get(code);
    this.entries.set(code, count === undefined ? before : Math.max(before ?? 0, count));
  }

  has(code: NoticeCode): boolean {
    return this.entries.has(code);
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
  now: number;
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
    fields: rows.slice(0, MAX_REPORT_ROWS),
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

/** RunState's lastFill: flagged and blocked rows, and rows that still need the person otherwise (a value that did
 *  not stick). */
export function lastFillOf(rows: readonly FillResult[]): NonNullable<RunState['lastFill']> {
  return {
    flagged: rows.filter((row) => row.status === 'flagged').length,
    blocked: rows.filter((row) => row.status === 'blocked').length,
    unresolved: rows.filter((row) => row.needsUserAction && row.status !== 'flagged' && row.status !== 'blocked').length,
  };
}

/** What RunState records of a run. */
export interface RunStateInput {
  applicationKey: string;
  platform: Platform;
  status: RunStatus;
  pauseReason: PauseReason | null;
  canarySet: readonly string[];
  tripwire: { triggered: boolean; hits: number };
  policyDecision: RunState['policyDecision'];
  rows: readonly FillResult[] | null;
  /** The reactive loop's parent and child edges (revealEdgesOf); none for a run that filled nothing. */
  revealEdges?: ReadonlyArray<readonly [BaseKey, BaseKey]>;
  startedAt: number;
  now: number;
}

/** A RunState for a single-step run (no step signature and no AI tasks before Phases 4 and 5). */
export function buildRunState(input: RunStateInput): RunState {
  const handoff = input.status === 'handoff';
  return {
    version: 1,
    applicationKey: input.applicationKey,
    platform: input.platform,
    status: input.status,
    resumeStatus: handoff || input.status === 'auth-needed' ? 'fill-step' : null,
    pauseReason: handoff ? input.pauseReason : null,
    stepSignature: null,
    stepIndex: 0,
    stepAttempts: {},
    filledFieldKeys: {},
    repeatableCounters: {},
    canarySet: [...input.canarySet].slice(0, 32),
    tripwire: { triggered: input.tripwire.triggered, hits: Math.max(0, input.tripwire.hits) },
    policyDecision: input.policyDecision,
    revealEdges: (input.revealEdges ?? []).slice(0, MAX_REVEAL_EDGES).map(([parent, child]) => [parent, child]),
    aiTasks: {},
    lastFill: input.rows === null ? null : lastFillOf(input.rows),
    startedAt: Math.max(0, Math.floor(input.startedAt)),
    updatedAt: Math.max(0, Math.floor(input.now)),
  };
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
