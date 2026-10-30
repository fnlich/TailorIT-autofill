import { describe, expect, it } from 'vitest';
import type { IntendedValue } from '../types/intent';
import { doneMatch, inputOf, outcomeOf } from './matcher.testkit';
import { inRange, parseRange } from './range';

const years = (value: number): IntendedValue => ({ kind: 'number', value, unit: 'years' });
const salary = (value: number, currency = 'USD'): IntendedValue => ({ kind: 'number', value, unit: 'currency-year',
  currency });
const match = (intended: IntendedValue, labels: string[]) =>
  doneMatch(outcomeOf(inputOf(intended, labels, 'number', { policy: 'sensitive' }), false));

describe('parseRange', () => {
  it.each([
    ['$100k–$120k', { lo: 100_000, hi: 120_000, loOpen: false, hiOpen: false, currency: 'USD' }],
    ['$100,000 - $120,000 per year', { lo: 100_000, hi: 120_000, currency: 'USD', unit: 'year' }],
    ['100-120k', { lo: 100_000, hi: 120_000 }],
    ['3-5 years', { lo: 3, hi: 5, unit: 'year' }],
    ['3 to 5 years', { lo: 3, hi: 5 }],
    ['10+ years', { lo: 10, hi: Infinity, loOpen: false }],
    ['More than 10 years', { lo: 10, hi: Infinity, loOpen: true }],
    ['Less than 2 years', { lo: -Infinity, hi: 2, hiOpen: true }],
    ['Up to 2 years', { lo: -Infinity, hi: 2, hiOpen: false }],
    ['5 years', { lo: 5, hi: 5 }],
    ['€50k - €60k', { currency: 'EUR' }],
  ] as const)('%j', (label, expected) => {
    expect(parseRange(label)).toMatchObject(expected);
  });

  it('reads no range from text without numbers or with more than two', () => {
    expect(parseRange('Entry level')).toBeNull();
    expect(parseRange('1, 2 or 3 years')).toBeNull();
    expect(parseRange('3 years, 5 months')).toBeNull();
  });

  it('respects open and closed ends', () => {
    expect(inRange(10, parseRange('10+')!)).toBe(true);
    expect(inRange(10, parseRange('More than 10')!)).toBe(false);
    expect(inRange(2, parseRange('Less than 2')!)).toBe(false);
  });
});

describe('the numeric-range rule (§4.3)', () => {
  it('chooses the one range that holds the value, at 0.95', () => {
    expect(match(years(4), ['0-2 years', '3-5 years', '6+ years']))
      .toMatchObject({ stage: 'alias', optionIndex: 1, rule: 'numeric-range', confidence: 0.95 });
    expect(match(salary(110_000), ['$80k-$100k', '$100k-$120k', '$120k+'])).toMatchObject({ optionIndex: 1 });
  });

  it('leaves a value on a shared boundary blank', () => {
    expect(match(years(5), ['0-5 years', '5-10 years'])).toMatchObject({ stage: 'none', optionIndex: null });
  });

  it('never chooses another currency or another unit of time', () => {
    expect(match(salary(55_000), ['€50k - €60k']).optionIndex).toBeNull();
    expect(match({ kind: 'number', value: 3, unit: 'weeks' }, ['1-2 months', '3-4 months']).optionIndex).toBeNull();
  });

  it('has no exact stage: the value is never compared as text', () => {
    expect(match(years(3), ['3']).stage).toBe('alias');
  });
});
