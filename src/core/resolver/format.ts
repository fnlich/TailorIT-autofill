/*
 * How a profile value is laid out for a field (docs/design/core.md §8.5: phone.format and date.format). The layout is
 * a transform of an explicit value, never a new value: a phone number keeps its digits, a date its year, month and
 * day. A field that states its layout (the constraints' format, or a pattern from its placeholder or the adapter, such
 * as "MM/YYYY" or "(###) ###-####") gets exactly that; a date for a field that states none is laid out the usual way and
 * flagged as a guess, and a layout that needs a part the profile lacks (a day for "MM/DD/YYYY") gives nothing, so the
 * field is flagged rather than filled with an invented part.
 */
import type { Constraints } from '../types/field';

/** A date as the profile holds it: a year, maybe a month, maybe a day. */
export interface DateParts {
  y: number;
  m?: number;
  d?: number;
}

/** A laid-out value, and whether its layout was guessed (no format or pattern given). */
export interface Laid {
  text: string;
  guessed: boolean;
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/** The date tokens a pattern may hold, longest first, and the separators between them. */
const DATE_PATTERN = /^(?:YYYY|YY|MM|DD|[\s/.-])+$/;

/** A date laid out by a pattern such as "MM/YYYY" or "YYYY-MM-DD"; null when the pattern is no date pattern or needs a
 *  part the date lacks. */
function byPattern(date: DateParts, pattern: string): string | null {
  const upper = pattern.trim().toUpperCase();
  if (!DATE_PATTERN.test(upper)) return null;
  if (upper.includes('MM') && date.m === undefined) return null;
  if (upper.includes('DD') && date.d === undefined) return null;
  return upper.replace(/YYYY|YY|MM|DD/g, (token) => {
    if (token === 'YYYY') return String(date.y);
    if (token === 'YY') return pad(date.y % 100);
    if (token === 'MM') return pad(date.m!);
    return pad(date.d!);
  });
}

/** A date as text for a text field (§8.5, date.format): by the field's pattern, else its format, else month and year
 *  ("08/2015"), the full date ("12/01/2026") or the year, flagged as a guess. Null when the field's layout needs a part
 *  the date lacks. */
export function dateText(date: DateParts, constraints: Constraints): Laid | null {
  if (constraints.pattern !== undefined && DATE_PATTERN.test(constraints.pattern.trim().toUpperCase())) {
    const text = byPattern(date, constraints.pattern);
    return text === null ? null : { text, guessed: false };
  }
  switch (constraints.format) {
    case 'year':
      return { text: String(date.y), guessed: false };
    case 'month-year':
      return date.m === undefined ? null : { text: `${pad(date.m)}/${date.y}`, guessed: false };
    case 'date':
      return date.m === undefined || date.d === undefined ? null
        : { text: `${pad(date.m)}/${pad(date.d)}/${date.y}`, guessed: false };
    default:
      if (date.m === undefined) return { text: String(date.y), guessed: true };
      if (date.d === undefined) return { text: `${pad(date.m)}/${date.y}`, guessed: true };
      return { text: `${pad(date.m)}/${pad(date.d)}/${date.y}`, guessed: true };
  }
}

/** A date for a native date control: ISO text of exactly the parts its format takes ("2015-08" for a month control,
 *  "2026-12-01" for a date control), and whether a part was guessed. Null when the control needs a part the date lacks.
 *  jr7 RULES-7 (DF7-04, Dayforce's required Start Dates, `input[type=date]`, snapshot7 dayforce1; Jobright's
 *  fillDayforceDateField writes the month's first day: cited): a date control given a month-precision date takes the
 *  1st of that month, guessed (filled and flagged for a look). This amends docs/design/core.md §8.5 ("a layout needing a
 *  part the profile lacks gives nothing") for a full-date control. A date with no month still gives nothing. */
export function dateIso(date: DateParts, constraints: Constraints): { iso: string; guessed: boolean } | null {
  const year = pad(date.y, 4);
  switch (constraints.format) {
    case 'year':
      return { iso: year, guessed: false };
    case 'month-year':
      return date.m === undefined ? null : { iso: `${year}-${pad(date.m)}`, guessed: false };
    default:
      if (date.m === undefined) return null;
      return { iso: `${year}-${pad(date.m)}-${pad(date.d ?? 1)}`, guessed: date.d === undefined };
  }
}

/** The slots a phone pattern holds: '#', '9', 'X' or 'x', each one digit ("(###) ###-####"). */
const PHONE_SLOT = /[#9Xx]/g;

/**
 * A phone number laid out for the field (§8.5, phone.format): into the slots of the field's pattern when their count
 * is the number's own digits or its national digits; as the national number (without its "+1") when the form has a
 * separate country-code control; otherwise as the person wrote it. The digits never change.
 */
export function phoneText(phone: { text: string; digits: string; countryCallingCode?: string }, constraints: Constraints,
  separateCountryCode: boolean): string {
  const code = phone.countryCallingCode;
  const national = code !== undefined && phone.digits.startsWith(code) ? phone.digits.slice(code.length) : phone.digits;
  const pattern = constraints.pattern;
  if (pattern !== undefined) {
    const slots = pattern.match(PHONE_SLOT)?.length ?? 0;
    const digits = slots === phone.digits.length ? phone.digits : slots === national.length ? national : null;
    if (slots > 0 && digits !== null) {
      let at = 0;
      return pattern.replace(PHONE_SLOT, () => digits[at++]!);
    }
  }
  if (separateCountryCode && code !== undefined) {
    return phone.text.replace(new RegExp(String.raw`^\+${code}[\s().-]*`), '').trim() || national;
  }
  return phone.text;
}

/**
 * Whether a phone box shows the number planned for it in its national form, its dial code held by the form's own
 * country control (one of `codes`, the dial codes the country controls beside it show): Greenhouse draws the number
 * so once a country is chosen in its phone country picker ("(512) 555-0188" beside "+1" for "+1 512 555 0188"). The
 * national digits may start with the trunk prefix 0 ("020 7946 0958" for "+44 20 7946 0958"). The planned number must
 * carry the code, and the box must show none of its own.
 */
export function phoneShownNationally(shown: string, planned: string, codes: ReadonlySet<string>): boolean {
  if (!/^\s*\+/.test(planned) || /^\s*\+/.test(shown)) return false;
  const digits = planned.replace(/\D/g, '');
  const now = shown.replace(/\D/g, '');
  return [...codes].some((code) => {
    const national = digits.startsWith(code) ? digits.slice(code.length) : '';
    return national !== '' && (now === national || now === `0${national}`);
  });
}
