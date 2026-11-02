/*
 * The dial code a phone country picker (intl-tel-input, Greenhouse's react-select beside the phone) shows beside a
 * country's name: "+1 United States", "Afghanistan+93", "Canada (+1)", "Canada +1", "Jersey +44 1534". It is no part of
 * the country's name, which the matcher reads without it (prepare.ts), a list search types without it (listSearch.ts),
 * and it tells the planner which code a phone's country control shows (plan/frame.ts). No country's name holds a digit.
 */

/** A dial code before or after a country's name. */
const LEADING_DIAL_CODE = /^\(?\+\d{1,4}(?:[\s-]\d{1,4})?\)?\s*/;
const TRAILING_DIAL_CODE = /\s*\(?\+\d{1,4}(?:[\s-]\d{1,4})?\)?$/;

/** A country's name without the dial code shown beside it ("Canada +1": "Canada"); the text itself when that would
 *  leave nothing. */
export function withoutDialCode(text: string): string {
  const name = text.trim().replace(LEADING_DIAL_CODE, '').replace(TRAILING_DIAL_CODE, '').trim();
  return name === '' ? text : name;
}

/** The dial code a text shows beside a country's name, or alone ("Canada +1", "+1", "United States (+1)": "1";
 *  "Jersey +44 1534": its first group, "44"), or null for a text that shows none. */
export function dialCodeOf(text: string): string | null {
  const trimmed = text.trim();
  const shown = TRAILING_DIAL_CODE.exec(trimmed)?.[0] ?? LEADING_DIAL_CODE.exec(trimmed)?.[0] ?? '';
  return /\+(\d{1,4})/.exec(shown)?.[1] ?? null;
}
