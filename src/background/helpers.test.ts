import { describe, expect, it } from 'vitest';
import { PDF_SIGNATURE, startsWith, toBase64, toBase64Url, ZIP_SIGNATURE } from './bytes';
import { createKeyedQueue, createRateLimit } from './locks';
import { isConnectPage } from './senders';
import { manualTimers } from './timers';

describe('bytes', () => {
  it('encodes base64 the way the browser and Node do, in slices past 8 KiB', () => {
    const bytes = Uint8Array.from({ length: 70_001 }, (_, index) => (index * 31 + 7) % 256);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    expect(toBase64(new Uint8Array(0))).toBe('');
  });

  it('makes base64url ids of the expected lengths, with no padding', () => {
    const state = toBase64Url(new Uint8Array(32).fill(0xff));
    expect(state).toHaveLength(43);
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(toBase64Url(new Uint8Array(16).fill(0xfb))).toHaveLength(22);
  });

  it('checks file signatures', () => {
    expect(startsWith(new TextEncoder().encode('%PDF-1.7'), PDF_SIGNATURE)).toBe(true);
    expect(startsWith(new TextEncoder().encode('%PD'), PDF_SIGNATURE)).toBe(false);
    expect(startsWith(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0]), ZIP_SIGNATURE)).toBe(true);
    expect(startsWith(Uint8Array.from([0x50, 0x4b, 0x05, 0x06]), ZIP_SIGNATURE)).toBe(false);
  });
});

describe('the keyed queue', () => {
  it('runs tasks of one key one after another, and goes on after a failure', async () => {
    const queue = createKeyedQueue();
    const order: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = queue.run('a', async () => {
      await held;
      order.push('a1');
    });
    const failing = queue.run('a', async () => {
      order.push('a2');
      throw new Error('x');
    });
    const third = queue.run('a', async () => void order.push('a3'));
    const other = queue.run('b', async () => void order.push('b1'));
    await other;
    expect(order).toEqual(['b1']);
    release();
    await first;
    await expect(failing).rejects.toThrow('x');
    await third;
    expect(order).toEqual(['b1', 'a1', 'a2', 'a3']);
  });
});

describe('the rate limit', () => {
  it('allows `limit` hits per window per key and answers the wait in whole seconds', () => {
    let now = 0;
    const limit = createRateLimit(2, 10_000, () => now);
    expect(limit.take('a')).toBeNull();
    now = 4000;
    expect(limit.take('a')).toBeNull();
    expect(limit.take('a')).toBe(6);
    expect(limit.take('b')).toBeNull();
    now = 10_001;
    expect(limit.take('a')).toBeNull();
    limit.forget('a');
    expect(limit.take('a')).toBeNull();
  });
});

describe('the connect page check', () => {
  const ORIGIN = 'http://localhost:3100';
  it.each([
    [{ origin: ORIGIN, url: `${ORIGIN}/settings/autofill?tab=extension&connect=1&state=x` }, true],
    [{ origin: ORIGIN, url: `${ORIGIN}/settings/autofill/` }, true],
    [{ origin: ORIGIN, url: `${ORIGIN}/settings/autofill#code` }, true],
    [{ origin: ORIGIN, url: `${ORIGIN}/settings/autofill-x` }, false],
    [{ origin: ORIGIN, url: `${ORIGIN}/settings` }, false],
    [{ origin: 'http://localhost:31000', url: 'http://localhost:31000/settings/autofill' }, false],
    [{ origin: ORIGIN, url: 'http://evil.example/settings/autofill' }, false],
    [{ origin: undefined, url: `${ORIGIN}/settings/autofill` }, false],
    [{ origin: ORIGIN, url: undefined }, false],
    [{ origin: ORIGIN, url: 'not a url' }, false],
  ])('%j → %s', (sender, expected) => {
    expect(isConnectPage(sender, ORIGIN)).toBe(expected);
  });
});

describe('the manual timers', () => {
  it('run what is due, in order, and nothing cancelled', () => {
    const timers = manualTimers();
    const ran: number[] = [];
    timers.after(30, () => ran.push(30));
    const cancel = timers.after(10, () => ran.push(10));
    timers.after(20, () => ran.push(20));
    cancel();
    cancel();
    timers.advance(25);
    expect(ran).toEqual([20]);
    expect(timers.pending).toBe(1);
    timers.advance(5);
    expect(ran).toEqual([20, 30]);
  });
});
