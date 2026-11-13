import { describe, expect, it } from 'vitest';
import { dateIso, dateText, phoneShownNationally, phoneText } from './format';

describe('dateText (date.format)', () => {
  it('lays a date out by the field’s pattern, and refuses one that needs a missing part', () => {
    expect(dateText({ y: 2015, m: 8 }, { pattern: 'MM/YYYY' })).toEqual({ text: '08/2015', guessed: false });
    expect(dateText({ y: 2015, m: 8 }, { pattern: 'yyyy-mm' })).toEqual({ text: '2015-08', guessed: false });
    expect(dateText({ y: 2026, m: 12, d: 1 }, { pattern: 'MM/DD/YYYY' })).toEqual({ text: '12/01/2026', guessed: false });
    // jr7 RULES-7 R5 (E4-2, amending docs/design/core.md §8.5 as DF7-04 did): a pattern with a day given a
    // month-precision date takes the month's 1st, guessed; a date with no month is still refused.
    expect(dateText({ y: 2015, m: 8 }, { pattern: 'MM/DD/YYYY' })).toEqual({ text: '08/01/2015', guessed: true });
    expect(dateText({ y: 2015, m: 8 }, { pattern: 'dd.mm.yyyy' })).toEqual({ text: '01.08.2015', guessed: true });
    expect(dateText({ y: 2015 }, { pattern: 'MM/DD/YYYY' })).toBeNull();
    expect(dateText({ y: 2015 }, { pattern: 'DD/YYYY' })).toBeNull();
    expect(dateText({ y: 2015 }, { pattern: 'MM/YYYY' })).toBeNull();
  });

  it('follows the field’s format, else guesses the usual layout and says so', () => {
    expect(dateText({ y: 2015, m: 8 }, { format: 'year' })).toEqual({ text: '2015', guessed: false });
    expect(dateText({ y: 2015, m: 8 }, { format: 'month-year' })).toEqual({ text: '08/2015', guessed: false });
    // jr7 RULES-7 R5 (E4-2): the month's 1st, guessed; no month, nothing.
    expect(dateText({ y: 2015, m: 8 }, { format: 'date' })).toEqual({ text: '08/01/2015', guessed: true });
    expect(dateText({ y: 2015 }, { format: 'date' })).toBeNull();
    expect(dateText({ y: 2026, m: 12, d: 1 }, { format: 'date' })).toEqual({ text: '12/01/2026', guessed: false });
    expect(dateText({ y: 2015, m: 8 }, {})).toEqual({ text: '08/2015', guessed: true });
    expect(dateText({ y: 2015 }, {})).toEqual({ text: '2015', guessed: true });
    expect(dateText({ y: 2026, m: 12, d: 1 }, {})).toEqual({ text: '12/01/2026', guessed: true });
  });

  it('leaves a pattern that is no date pattern to the format', () => {
    expect(dateText({ y: 2015, m: 8 }, { pattern: '(###) ###-####', format: 'month-year' }))
      .toEqual({ text: '08/2015', guessed: false });
  });
});

describe('dateIso', () => {
  it('gives a date control exactly the parts its format takes', () => {
    expect(dateIso({ y: 2015, m: 8 }, { format: 'month-year' })).toEqual({ iso: '2015-08', guessed: false });
    expect(dateIso({ y: 2026, m: 12, d: 1 }, {})).toEqual({ iso: '2026-12-01', guessed: false });
    // jr7 RULES-7 (DF7-04, amending docs/design/core.md §8.5): a full-date control given a month-precision date takes
    // the month's 1st, guessed; a date with no month still gives nothing.
    expect(dateIso({ y: 2015, m: 8 }, {})).toEqual({ iso: '2015-08-01', guessed: true });
    expect(dateIso({ y: 2015 }, {})).toBeNull();
    expect(dateIso({ y: 2015, m: 8 }, { format: 'year' })).toEqual({ iso: '2015', guessed: false });
  });
});

describe('phoneText (phone.format)', () => {
  const phone = { text: '+1 512 555 0147', digits: '15125550147', countryCallingCode: '1' };

  it('fills the pattern’s slots with the national or the whole number, its digits unchanged', () => {
    expect(phoneText(phone, { pattern: '(###) ###-####' }, false)).toBe('(512) 555-0147');
    expect(phoneText(phone, { pattern: '+# ### ### ####' }, false)).toBe('+1 512 555 0147');
    expect(phoneText(phone, { pattern: '##-##' }, false)).toBe('+1 512 555 0147');
  });

  it('drops the country code when the form has its own control for it, and keeps the person’s spelling otherwise', () => {
    expect(phoneText(phone, {}, true)).toBe('512 555 0147');
    expect(phoneText(phone, {}, false)).toBe('+1 512 555 0147');
    expect(phoneText({ text: '512-555-0147', digits: '5125550147' }, {}, true)).toBe('512-555-0147');
  });
});

describe('phoneShownNationally', () => {
  const plus1 = new Set(['1']);

  it('holds a number the page draws nationally beside a country control that shows its dial code', () => {
    expect(phoneShownNationally('(512) 555-0188', '+1 512 555 0188', plus1)).toBe(true);
    expect(phoneShownNationally('512-555-0188', '+15125550188', plus1)).toBe(true);
    // A national form with its trunk prefix.
    expect(phoneShownNationally('020 7946 0958', '+44 20 7946 0958', new Set(['44']))).toBe(true);
    expect(phoneShownNationally('20 7946 0958', '+44 20 7946 0958', new Set(['1', '44']))).toBe(true);
  });

  it('never holds another number, one whose code no country control shows, or a box that shows a code of its own', () => {
    expect(phoneShownNationally('(512) 555-0199', '+1 512 555 0188', plus1)).toBe(false);
    expect(phoneShownNationally('(512) 555-0188', '+1 512 555 0188', new Set(['44']))).toBe(false);
    expect(phoneShownNationally('(512) 555-0188', '+1 512 555 0188', new Set())).toBe(false);
    expect(phoneShownNationally('+44 512 555 0188', '+1 512 555 0188', plus1)).toBe(false);
    expect(phoneShownNationally('00 512 555 0188', '+1 512 555 0188', plus1)).toBe(false);
  });

  it('never holds a number planned without its code: the box must show its own digits', () => {
    expect(phoneShownNationally('(512) 555-0147', '512 555 0147', plus1)).toBe(false);
    expect(phoneShownNationally('555-0147', '1 512 555 0147', plus1)).toBe(false);
  });
});
