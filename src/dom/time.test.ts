import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deadline, every, monotonicNow, startDeadline, yieldToPage } from './time';

describe("the content side's timers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires a deadline once, after its time', () => {
    const fired = vi.fn();
    startDeadline(100, fired);
    vi.advanceTimersByTime(99);
    expect(fired).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    vi.advanceTimersByTime(1000);
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it('never fires a deadline that was cancelled, or whose signal aborted', () => {
    const fired = vi.fn();
    const cancel = startDeadline(100, fired);
    cancel();
    cancel();
    const controller = new AbortController();
    startDeadline(100, fired, controller.signal);
    controller.abort();
    startDeadline(100, fired, controller.signal);
    vi.advanceTimersByTime(1000);
    expect(fired).not.toHaveBeenCalled();
  });

  it('resolves a cap as expired, or as aborted the moment its signal aborts', async () => {
    const expired = deadline(50);
    vi.advanceTimersByTime(50);
    await expect(expired).resolves.toBe('expired');
    const controller = new AbortController();
    const aborted = deadline(10_000, controller.signal);
    controller.abort();
    await expect(aborted).resolves.toBe('aborted');
    await expect(deadline(10, controller.signal)).resolves.toBe('aborted');
  });

  it('ticks a poll until it is cancelled or its signal aborts', () => {
    const tick = vi.fn();
    const cancel = every(100, tick);
    vi.advanceTimersByTime(350);
    expect(tick).toHaveBeenCalledTimes(3);
    cancel();
    vi.advanceTimersByTime(1000);
    expect(tick).toHaveBeenCalledTimes(3);
    const controller = new AbortController();
    const other = vi.fn();
    every(100, other, controller.signal);
    vi.advanceTimersByTime(100);
    controller.abort();
    vi.advanceTimersByTime(1000);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('measures with a monotonic clock', () => {
    const start = monotonicNow();
    vi.advanceTimersByTime(25);
    expect(monotonicNow() - start).toBeGreaterThanOrEqual(25);
  });
});

describe('yieldToPage', () => {
  it('lets other work run, and resolves', async () => {
    let ran = false;
    void Promise.resolve().then(() => {
      ran = true;
    });
    await yieldToPage();
    expect(ran).toBe(true);
  });
});
