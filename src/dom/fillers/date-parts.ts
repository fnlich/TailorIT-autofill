/*
 * s2 wd (snapshot round 2, the coordinator's decision 3): a date its page draws as separate parts, each a control a
 * person cannot see behind the digits it displays, as its adapter declares it (Adapter.dateFor: Workday's date input,
 * fixtures/workday/s2-exelixis-my-experience.html: per part an aria-hidden div[data-automation-id=dateSection<Part>-
 * display] showing "MM", "DD" or "YYYY" over a 1 px, scale(0.01) input[role=spinbutton]). The scanner makes one field of
 * kind 'date' of it (dom/scan.ts), its control the element around the parts; this module reads and writes it:
 * - what it holds (datePartsValue): the digits each part shows, read from its display, else its aria-valuenow (a part
 *   drawn with no display, its own value); a placeholder ("MM") is nothing. Every part showing digits is the ISO date of
 *   its parts ("2025-04" for month and year), none is empty, anything else the words it shows ("04/YYYY");
 * - the layout (formatOfParts): a year alone is 'year', month and year 'month-year', month, day and year 'date';
 * - the write (fillDateParts): each part's own digits ("04", "2025"), never a part the date lacks: a day is never made up,
 *   so a month and year go into no month/day/year input (format-unsupported). First the value setter, input and change
 *   on every part, and no focusout or blur between them: the page's answer is awaited (one quiet window, capped: never a
 *   fixed sleep), and only once the parts show what was taken is the date left, focusout and blur on each part in turn
 *   (leaveDate). The fix of 2026-11-08 (snapshot5, [pureinsurance.wd5.myworkdayjobs.com] Senior Security Analyst – Cloud
 *   Security.mht, My Experience after a fill): a blur after the month alone, before the year was written and drawn, had
 *   Workday validate the date then, and every date written so showed "Error: Invalid Date: 09/" under it and in the
 *   step's "Errors Found" though both parts then held their digits (its field alert, [data-automation-id=inputAlert],
 *   stays until the date is left again). A part the page did not take gets its own value back and, where its adapter
 *   declares the digits (`keys: 'digits'`), one untrusted keydown and keyup per digit, as a person's typing would send
 *   (events.ts DIGIT_KEYS, to that part only, through assertKeyTarget), the date left again once they show, and read back
 *   again. A date nothing was taken in is never left (the page would validate what it held: a required one, empty).
 *   A date that already holds the planned value but shows its page's alert (DatePartsTarget.alert: one left before it
 *   was whole, by this filler before the fix) is left once more, so the page validates it whole again.
 *   The calendar is never used. Read back as planned: verified; some part shows another value: written, not verified;
 *   nothing taken: each part gets its own value back, and the person writes it (needs-your-click).
 * Values stay in memory: nothing here logs or sends one.
 */
import type { CurrentValue } from '../../core/types/field';
import { quietWait } from '../settle';
import { WIDGET_CAP_MS, WIDGET_QUIET_MS } from '../thresholds';
import type { DatePart, DatePartsTarget, FieldTarget, FillOutcome } from '../types';
import { fireChange, fireInput, fireKey, fireLeave, setValue, windowOf, type DigitKey } from './events';
import { assertKeyTarget, type NotSubmitContext } from './not-submit';
import { done, mismatch, refused } from './outcome';

/** The digits of a part as text: two for a month or a day, four for a year. */
const WIDTH: Record<DatePart['part'], number> = { month: 2, day: 2, year: 4 };

/** The number a part shows now: its display's digits, else its aria-valuenow (else, drawn with no display, its own
 *  value's digits); null while it shows a placeholder or nothing. */
export function partShown(part: DatePart): number | null {
  if (part.display !== null) {
    const text = (part.display.textContent ?? '').trim();
    if (/^\d{1,4}$/.test(text)) return Number(text);
  }
  const now = (part.input.getAttribute('aria-valuenow') ?? '').trim();
  if (/^\d{1,4}$/.test(now)) return Number(now);
  if (part.display === null && /^\d{1,4}$/.test(part.input.value.trim())) return Number(part.input.value.trim());
  return null;
}

const pad = (value: number, width: number) => String(value).padStart(width, '0');

/** The layout a date's parts take (see the header); undefined for parts no layout names. */
export function formatOfParts(parts: readonly Pick<DatePart, 'part'>[]): 'year' | 'month-year' | 'date' | undefined {
  const names = parts.map((part) => part.part).sort().join(',');
  if (names === 'year') return 'year';
  if (names === 'month,year') return 'month-year';
  if (names === 'day,month,year') return 'date';
  return undefined;
}

/** What a date drawn in parts holds now (see the header), as the scanner and the read-back read it. */
export function datePartsValue(target: DatePartsTarget): CurrentValue {
  const shown = target.parts.map(partShown);
  if (shown.every((value) => value === null)) return { kind: 'empty' };
  const at = (name: DatePart['part']) => {
    const index = target.parts.findIndex((part) => part.part === name);
    return index < 0 ? undefined : shown[index];
  };
  const [year, month, day] = [at('year'), at('month'), at('day')];
  if (shown.every((value) => value !== null) && typeof year === 'number' && formatOfParts(target.parts) !== undefined) {
    return { kind: 'text', text: [pad(year, 4), ...(typeof month === 'number' ? [pad(month, 2)] : []),
      ...(typeof day === 'number' ? [pad(day, 2)] : [])].join('-') };
  }
  const words = target.parts.map((part, index) => {
    const value = shown[index];
    return typeof value === 'number' ? pad(value, WIDTH[part.part]) : (part.display?.textContent ?? '').trim();
  });
  return { kind: 'text', text: words.join('/') };
}

/** The value each part takes for an ISO date (YYYY, YYYY-MM or YYYY-MM-DD), in the parts' order; null when a part the
 *  page draws is one the date lacks (a day is never made up). */
export function partValuesFor(parts: readonly Pick<DatePart, 'part'>[], iso: string): number[] | null {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(iso.trim());
  if (match === null || parts.length === 0) return null;
  const values: Record<DatePart['part'], number | undefined> = { year: Number(match[1]),
    month: match[2] === undefined ? undefined : Number(match[2]), day: match[3] === undefined ? undefined : Number(match[3]) };
  const out: number[] = [];
  for (const part of parts) {
    const value = values[part.part];
    if (value === undefined) return null;
    out.push(value);
  }
  return out;
}

/** Whether a date drawn in parts shows `iso` now: every part shows its own value of it. */
export function holdsDateParts(target: DatePartsTarget, iso: string): boolean {
  const wanted = partValuesFor(target.parts, iso);
  return wanted !== null && target.parts.every((part, index) => partShown(part) === wanted[index]);
}

/** What a write into a date drawn in parts needs: the adapter and the form root (assertKeyTarget, and where the page's
 *  answer is watched), and the run's signal. */
export interface DatePartsContext extends NotSubmitContext {
  root: Element;
  signal?: AbortSignal;
}

/** The value setter's write of one part, with input and change: never focusout or blur, which leave the date (the fix of
 *  2026-11-08, see the header; leaveDate). */
function writePart(input: HTMLInputElement, text: string): void {
  setValue(input, text);
  fireInput(input, 'text');
  fireChange(input);
}

/** The alert the page shows for a date now (DatePartsTarget.alert), or null; a hook that fails shows none. */
function alertOf(target: DatePartsTarget): Element | null {
  try {
    return target.alert?.() ?? null;
  } catch {
    return null;
  }
}

/** Leaves the date once its parts show what was taken: focusout and blur on each part in turn (the page validates the
 *  whole date then, every part drawn), and its answer awaited. False when the run's signal ended the wait. */
async function leaveDate(parts: readonly DatePart[], ctx: DatePartsContext): Promise<boolean> {
  for (const part of parts) fireLeave(part.input);
  return answered(ctx);
}

/** The page's answer to what was just sent: one quiet window on the form root, at most WIDGET_CAP_MS (React draws a
 *  part's digits after the event that set them). False when the run's signal ended the wait. */
async function answered(ctx: DatePartsContext): Promise<boolean> {
  const wait = quietWait<boolean>({ view: windowOf(ctx.root), quietMs: WIDGET_QUIET_MS, capMs: WIDGET_CAP_MS,
    signal: ctx.signal, aborted: false, atQuiet: () => true, atCap: () => true });
  wait.observe(ctx.root);
  return wait.done;
}

/** Writes an ISO date into a date drawn in parts and reads it back (see the header). */
export async function fillDateParts(target: FieldTarget, iso: string, ctx: DatePartsContext): Promise<FillOutcome> {
  const dated = target.dateParts;
  if (dated === undefined) return refused('internal-error');
  const { parts } = dated;
  if (parts.some((part) => !part.input.isConnected)) return refused('element-not-found');
  if (parts.some((part) => part.input.disabled || part.input.readOnly)) return refused('disabled-or-readonly');
  const wanted = partValuesFor(parts, iso);
  if (wanted === null) return refused('format-unsupported');
  const shownBefore = parts.map(partShown);
  if (parts.every((_, index) => shownBefore[index] === wanted[index])) {
    // The fix of 2026-11-08: a date that holds the planned value but shows its page's alert (left before it was whole,
    // as this filler did before: snapshot5) is left once more, so the page validates it whole.
    if (alertOf(dated) !== null) await leaveDate(parts, ctx);
    return done(false, 'already-correct');
  }
  const valuesBefore = parts.map((part) => part.input.value);
  const texts = wanted.map((value, index) => pad(value, WIDTH[parts[index]!.part]));
  const pending = () => parts.flatMap((part, index) => (partShown(part) === wanted[index] ? [] : [index]));

  // Whether the page took something since the write began: a part shows another value than before it.
  const taken = () => parts.some((part, index) => partShown(part) !== shownBefore[index]);
  // The value setter first, each part the date does not show yet, every part before the date is left.
  for (const index of pending()) writePart(parts[index]!.input, texts[index]!);
  const outcome = (): FillOutcome => {
    const left = pending();
    if (left.length === 0) return done(true, 'ok');
    // A part the page did not take gets its own value back: what it shows and what it holds agree again. v5 review
    // (T1): only while it still holds what this filler wrote; a value typed meanwhile (the person's) is never erased.
    for (const index of left) {
      const input = parts[index]!.input;
      if (partShown(parts[index]!) === shownBefore[index] && input.value !== valuesBefore[index]
        && input.value === texts[index]) {
        writePart(input, valuesBefore[index]!);
      }
    }
    const changed = parts.some((part, index) => partShown(part) !== shownBefore[index]);
    return changed ? mismatch('verify-mismatch') : refused('needs-your-click');
  };
  if (!await answered(ctx)) return outcome();
  // The parts are drawn: the date is left once, now, where the page took something (a date it took nothing in is not
  // validated by us).
  if (taken() && !await leaveDate(parts, ctx)) return outcome();
  if (pending().length === 0 || !dated.digits) return outcome();

  // The digits its adapter declares, typed into each part the setter's write did not reach, that part's own value
  // given back first, so the page's state and the part agree before the keys.
  for (const index of pending()) {
    const input = parts[index]!.input;
    if (!assertKeyTarget(input, ctx).ok) continue;
    // v5 review (T1): a part holding neither its own value nor what this filler wrote was typed into meanwhile: the
    // person's, never given back nor typed over.
    if (input.value !== valuesBefore[index] && input.value !== texts[index]) continue;
    if (input.value !== valuesBefore[index]) writePart(input, valuesBefore[index]!);
    for (const digit of texts[index]!) fireKey(input, digit as DigitKey);
  }
  if (await answered(ctx) && taken()) await leaveDate(parts, ctx);
  return outcome();
}
