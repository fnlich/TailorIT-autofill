import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReportLimiter, REPORT_PUTS_PER_SECOND } from './report';

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
