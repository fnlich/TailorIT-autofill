/*
 * The native date filler (docs/design/runtime.md §6): the value setter with ISO text, then input and change. A date
 * input takes YYYY-MM-DD and a month input YYYY-MM; a day is never made up, so a month-only date cannot go into a
 * date input (format-unsupported). datetime-local, week and time inputs are not written. A date in a text input is
 * the core's to format, and goes through the text filler.
 */
import type { FillOutcome } from '../types';
import { fireChange, fireInput, setValue } from './events';
import { done, mismatch, refused } from './outcome';

/** The value a native date control takes for an ISO date (YYYY, YYYY-MM or YYYY-MM-DD), or null when it cannot be
 *  written without inventing a part of it. */
export function dateValueFor(input: HTMLInputElement, iso: string): string | null {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(iso);
  if (!match) return null;
  const [, year, month, day] = match;
  if (input.type === 'date') return month !== undefined && day !== undefined ? `${year}-${month}-${day}` : null;
  if (input.type === 'month') return month !== undefined ? `${year}-${month}` : null;
  return null;
}

/** Writes an ISO date into a native date or month input and reads it back. */
export function fillDate(input: HTMLInputElement, iso: string): FillOutcome {
  const value = dateValueFor(input, iso);
  if (value === null) return refused('format-unsupported');
  const before = input.value;
  if (before === value) return done(false, 'already-correct');
  setValue(input, value);
  fireInput(input, 'plain');
  fireChange(input);
  const after = input.value;
  if (after === value) return done(true, 'ok');
  // The browser blanks a value it rejects; a page that ignored the events puts the old one back.
  if (after === before) return refused('needs-your-click');
  return mismatch(after === '' ? 'value-rejected-by-site' : 'verify-mismatch');
}
