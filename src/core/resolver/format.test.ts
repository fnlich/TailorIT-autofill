import { describe, expect, it } from 'vitest';
import { dateIso, dateText, phoneText } from './format';

describe('dateText (date.format)', () => {
  it('lays a date out by the field’s pattern, and refuses one that needs a missing part', () => {
    expect(dateText({ y: 2015, m: 8 }, { pattern: 'MM/YYYY' })).toEqual({ text: '08/2015', guessed: false });
    expect(dateText({ y: 2015, m: 8 }, { pattern: 'yyyy-mm' })).toEqual({ text: '2015-08', guessed: false });
    expect(dateText({ y: 2026, m: 12, d: 1 }, { pattern: 'MM/DD/YYYY' })).toEqual({ text: '12/01/2026', guessed: false });
    expect(dateText({ y: 2015, m: 8 }, { pattern: 'MM/DD/YYYY' })).toBeNull();
    expect(dateText({ y: 2015 }, { pattern: 'MM/YYYY' })).toBeNull();
  });

  it('follows the field’s format, else guesses the usual layout and says so', () => {
    expect(dateText({ y: 2015, m: 8 }, { format: 'year' })).toEqual({ text: '2015', guessed: false });
    expect(dateText({ y: 2015, m: 8 }, { format: 'month-year' })).toEqual({ text: '08/2015', guessed: false });
    expect(dateText({ y: 2015, m: 8 }, { format: 'date' })).toBeNull();
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
    expect(dateIso({ y: 2015, m: 8 }, { format: 'month-year' })).toBe('2015-08');
    expect(dateIso({ y: 2026, m: 12, d: 1 }, {})).toBe('2026-12-01');
    expect(dateIso({ y: 2015, m: 8 }, {})).toBeNull();
    expect(dateIso({ y: 2015, m: 8 }, { format: 'year' })).toBe('2015');
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
