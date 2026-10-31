import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_STEP_PROGRESS } from '../shared/report';
import { buildReport, createReportLimiter, NoticeBook, progressLine, REPORT_PUTS_PER_SECOND, type ReportHeader } from './report';

// DOM-15: the limiter worked, but nothing tested it.
describe('the report/put limiter', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lets four puts through at once and holds the rest until the second-long window has room, in call order', async () => {
    expect(REPORT_PUTS_PER_SECOND).toBe(4);
    const limiter = createReportLimiter();
    const passed: number[] = [];
    for (let i = 0; i < 6; i += 1) void limiter.turn().then(() => passed.push(i));
    await vi.advanceTimersByTimeAsync(0);
    expect(passed).toEqual([0, 1, 2, 3]);
    await vi.advanceTimersByTimeAsync(999);
    expect(passed).toEqual([0, 1, 2, 3]);
    await vi.advanceTimersByTimeAsync(2);
    expect(passed).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('ends a waiting turn at once when its signal aborts, without taking a slot from the next put', async () => {
    const limiter = createReportLimiter({ perSecond: 1 });
    await limiter.turn();
    const controller = new AbortController();
    let aborted = false;
    void limiter.turn(controller.signal).then(() => {
      aborted = true;
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(aborted).toBe(false);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(aborted).toBe(true);
    let next = false;
    void limiter.turn().then(() => {
      next = true;
    });
    await vi.advanceTimersByTimeAsync(980);
    expect(next).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    expect(next).toBe(true);
  });
});

describe('the report’s step (Phase 6)', () => {
  const header = (step?: { index: number; progress?: string }): ReportHeader => ({ runId: 'run-1', frameId: 0,
    platform: 'workday', adapter: 'workday', dryRun: false, status: 'review', pauseReason: null, notices: new NoticeBook(),
    counters: { passes: 1, hiddenControlsIgnored: 0, deferredFields: 0 }, now: 1, ...(step === undefined ? {} : { step }) });

  it('carries the adapter’s progress line as the page shows it: whitespace collapsed, capped, none when empty', () => {
    expect(progressLine('  Step 2\n of   4 ')).toBe('Step 2 of 4');
    expect(progressLine('')).toBeUndefined();
    expect(progressLine('   ')).toBeUndefined();
    expect(progressLine(undefined)).toBeUndefined();
    expect(progressLine('x'.repeat(MAX_STEP_PROGRESS + 40))).toHaveLength(MAX_STEP_PROGRESS);
    expect(buildReport(header({ index: 1, progress: ' Step 2 of 4 ' }), [])?.step).toEqual({ index: 1, progress: 'Step 2 of 4' });
    expect(buildReport(header({ index: 1, progress: ' ' }), [])?.step).toEqual({ index: 1 });
    expect(buildReport(header(), [])).not.toHaveProperty('step');
  });
});
