import { describe, expect, it } from 'vitest';
import { clockText, secondsLeft } from './countdown';

describe("the pairing countdown's arithmetic", () => {
  it('counts whole seconds up to the deadline, and never below zero', () => {
    expect(secondsLeft(10_000, 0)).toBe(10);
    expect(secondsLeft(10_000, 9_001)).toBe(1);
    expect(secondsLeft(10_000, 10_000)).toBe(0);
    expect(secondsLeft(10_000, 60_000)).toBe(0);
  });

  it('writes seconds as minutes and seconds', () => {
    expect([clockText(600), clockText(581), clockText(5), clockText(0)]).toEqual(['10:00', '9:41', '0:05', '0:00']);
  });
});
