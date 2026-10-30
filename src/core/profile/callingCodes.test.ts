import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { callingCodeOf, CALLING_CODES } from './callingCodes';

const fixture = JSON.parse(readFileSync(new URL('../matcher/phone-countries.fixture.json', import.meta.url), 'utf8')) as {
  options: Array<[name: string, dialCode: string, code: string]>;
};

describe('the calling codes (CALLING_CODES)', () => {
  it('are the captured phone picker’s, each country under its own code', () => {
    const captured = new Map<string, Set<string>>();
    for (const [, dial, code] of fixture.options) {
      const digits = dial.slice(1);
      if (!captured.has(digits)) captured.set(digits, new Set());
      captured.get(digits)!.add(code);
    }
    expect(Object.keys(CALLING_CODES).sort()).toEqual([...captured.keys()].sort());
    for (const [digits, codes] of captured) expect([...CALLING_CODES[digits]!].sort(), digits).toEqual([...codes].sort());
  });

  it('are prefix-free, so a number’s code is never in doubt', () => {
    const codes = Object.keys(CALLING_CODES);
    for (const code of codes) {
      expect(codes.filter((other) => other !== code && other.startsWith(code)), code).toEqual([]);
    }
  });
});

describe('callingCodeOf', () => {
  it.each([
    ['+15125550147', '1'], ['+1 512 555 0147', '1'], ['+1-512-555-0147', '1'], ['+1 (512) 555-0147', '1'],
    ['+442079460958', '44'], ['+44 (0)20 7946 0958', '44'], ['+353 1 234 5678', '353'], ['+7 495 123 4567', '7'],
    ['  +33 1 23 45 67 89 ', '33'],
  ])('reads %j as +%s', (number, code) => {
    expect(callingCodeOf(number)).toBe(code);
  });

  it.each(['512-555-0147', '0044 20 7946 0958', '+999 123 456', '+1 512 ext. 7', '', '+'])(
    'reads no code in %j', (number) => {
      expect(callingCodeOf(number)).toBeUndefined();
    });
});
