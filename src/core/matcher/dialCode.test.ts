/*
 * The dial code a phone country picker shows beside a country's name (dialCode.ts): left out of the name, and read as
 * the code the picker shows.
 */
import { describe, expect, it } from 'vitest';
import { dialCodeOf, withoutDialCode } from './dialCode';

describe('withoutDialCode', () => {
  it('leaves the name of a country shown with its dial code before or after it', () => {
    for (const label of ['Canada +1', '+1 Canada', 'Canada (+1)', 'Canada+1', ' Canada  +1 ']) {
      expect(withoutDialCode(label), label).toBe('Canada');
    }
    expect(withoutDialCode('Jersey +44 1534')).toBe('Jersey');
  });

  it('keeps a text that is nothing but a dial code, and any text that shows none', () => {
    expect(withoutDialCode('+1')).toBe('+1');
    expect(withoutDialCode('Plan 1')).toBe('Plan 1');
  });
});

describe('dialCodeOf', () => {
  it('reads the code a phone country picker shows, beside a name or alone', () => {
    expect(dialCodeOf('Canada +1')).toBe('1');
    expect(dialCodeOf('+1')).toBe('1');
    expect(dialCodeOf('United States (+1)')).toBe('1');
    expect(dialCodeOf('+44 United Kingdom')).toBe('44');
    expect(dialCodeOf('Jersey +44 1534')).toBe('44');
    expect(dialCodeOf('Afghanistan+93')).toBe('93');
  });

  it('reads none where no dial code stands at either end', () => {
    expect(dialCodeOf('Canada')).toBeNull();
    expect(dialCodeOf('Plan 1')).toBeNull();
    expect(dialCodeOf('Call +1 for help, then Canada')).toBeNull();
    expect(dialCodeOf('')).toBeNull();
  });
});
