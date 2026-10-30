/*
 * The numeric-range rule (docs/design/core.md §4.3) for salary and years of experience: the value must fall inside
 * exactly one option's range ("$100k–$120k", "3-5 years", "10+", "Less than 2 years"). A value on a boundary two
 * options share is ambiguous, so nothing is chosen. An option written in another currency, or in another unit of
 * time ("1-2 months" for a value in weeks), is never chosen.
 */
import { MATCH_RANGE } from '../confidence';
import { fold } from '../text/fold';
import type { IntendedValue } from '../types/intent';
import { substantive } from './prepare';
import { stageHit, type StageHit } from './rank';
import type { PreparedOptions } from './types';

/** A parsed range: [lo, hi], each end open or closed. */
export interface NumericRange {
  lo: number;
  hi: number;
  loOpen: boolean;
  hiOpen: boolean;
  /** ISO 4217 when the label shows a currency symbol. */
  currency: string | null;
  /** The unit of time the label names, if any. */
  unit: 'year' | 'month' | 'week' | 'day' | 'hour' | null;
}

const NUMBER = /([$€£])?\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(k|m)?(?![a-z0-9])/g;
const CURRENCY: Readonly<Record<string, string>> = { '$': 'USD', '€': 'EUR', '£': 'GBP' };
const BETWEEN = /^\s*(?:-|–|—|to|and|through)\s*$/;
const AT_LEAST_AFTER = /^\s*(?:\+|or more|or above|and above|and up|plus|or higher|or greater)/;
const AT_MOST_AFTER = /^\s*(?:or less|or fewer|or below|or under)/;
const MORE_THAN_BEFORE = /(?:more than|over|greater than|above)\s*$/;
const AT_LEAST_BEFORE = /(?:at least|minimum(?: of)?|min\.?)\s*$/;
const LESS_THAN_BEFORE = /(?:less than|under|below|fewer than)\s*$/;
const AT_MOST_BEFORE = /(?:up to|at most|maximum(?: of)?|max\.?|no more than)\s*$/;
const UNITS: ReadonlyArray<[NumericRange['unit'], RegExp]> = [
  ['year', /\b(?:years?|yrs?|annual(?:ly)?|per annum|yearly)\b/], ['month', /\b(?:months?|mos?|monthly)\b/],
  ['week', /\b(?:weeks?|wks?|weekly)\b/], ['day', /\b(?:days?|daily)\b/], ['hour', /\b(?:hours?|hrs?|hourly)\b/],
];

function amount(digits: string, multiplier: string | undefined): number {
  const base = Number(digits.replace(/,/g, ''));
  return multiplier === 'k' ? base * 1000 : multiplier === 'm' ? base * 1_000_000 : base;
}

/** The range an option label states, or null when it states none (or more than two numbers). */
export function parseRange(label: string): NumericRange | null {
  const text = fold(label);
  const found = [...text.matchAll(NUMBER)];
  if (found.length === 0 || found.length > 2) return null;
  const symbol = found.find((match) => match[1] !== undefined)?.[1];
  const currency = symbol === undefined ? null : CURRENCY[symbol] ?? null;
  const unit = UNITS.find(([, re]) => re.test(text))?.[0] ?? null;
  const first = found[0]!;
  const firstEnd = first.index + first[0].length;
  if (found.length === 2) {
    const second = found[1]!;
    if (!BETWEEN.test(text.slice(firstEnd, second.index))) return null;
    const multiplier = first[3] ?? second[3];
    const a = amount(first[2]!, multiplier);
    const b = amount(second[2]!, second[3]);
    return { lo: Math.min(a, b), hi: Math.max(a, b), loOpen: false, hiOpen: false, currency, unit };
  }
  const value = amount(first[2]!, first[3]);
  const before = text.slice(0, first.index);
  const after = text.slice(firstEnd);
  if (AT_LEAST_AFTER.test(after) || AT_LEAST_BEFORE.test(before)) {
    return { lo: value, hi: Infinity, loOpen: false, hiOpen: true, currency, unit };
  }
  if (MORE_THAN_BEFORE.test(before)) return { lo: value, hi: Infinity, loOpen: true, hiOpen: true, currency, unit };
  if (LESS_THAN_BEFORE.test(before)) return { lo: -Infinity, hi: value, loOpen: true, hiOpen: true, currency, unit };
  if (AT_MOST_BEFORE.test(before) || AT_MOST_AFTER.test(after)) {
    return { lo: -Infinity, hi: value, loOpen: true, hiOpen: false, currency, unit };
  }
  return { lo: value, hi: value, loOpen: false, hiOpen: false, currency, unit };
}

/** Whether `value` lies in `range`. */
export function inRange(value: number, range: NumericRange): boolean {
  const aboveLo = range.loOpen ? value > range.lo : value >= range.lo;
  const belowHi = range.hiOpen ? value < range.hi : value <= range.hi;
  return aboveLo && belowHi;
}

/** The unit of time an intended number is in. */
function unitOf(unit: Extract<IntendedValue, { kind: 'number' }>['unit']): NumericRange['unit'] {
  switch (unit) {
    case 'currency-year':
    case 'years':
      return 'year';
    case 'currency-month':
      return 'month';
    case 'currency-hour':
      return 'hour';
    case 'weeks':
      return 'week';
  }
}

/** The numeric-range rule's hit: the one option whose range holds the value. */
export function rangeHits(intended: Extract<IntendedValue, { kind: 'number' }>, options: PreparedOptions): StageHit[] {
  const wantedUnit = unitOf(intended.unit);
  const holding = options.list.filter((option) => {
    if (!substantive(option)) return false;
    const range = parseRange(option.clean);
    if (!range) return false;
    if (range.unit !== null && range.unit !== wantedUnit) return false;
    const currencyKnown = range.currency !== null && intended.currency !== undefined;
    if (currencyKnown && range.currency !== intended.currency) return false;
    return inRange(intended.value, range);
  });
  if (holding.length !== 1) return [];
  return [stageHit(holding[0]!, 'alias', 'numeric-range', MATCH_RANGE, `key:${holding[0]!.fullKey}`)];
}
