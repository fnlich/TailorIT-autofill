import { describe, expect, it } from 'vitest';
import {
  capCodePoints, fold, FOLD_MAX_CODE_POINTS, foldLetters, LETTERS_WITHOUT_DECOMPOSITION, removeInvisibles,
} from './fold';

describe('fold: normalization steps 0 to 4', () => {
  it.each([
    // Step 1: invisibles.
    ['UT\u200B Austin', 'ut austin'],
    ['zero\u200Cwidth\u200Djoin\u200Eand\u200Fmarks', 'zerowidthjoinandmarks'],
    ['bidi\u202A\u202B\u202C\u202D\u202Econtrols', 'bidicontrols'],
    ['word\u2060joiner\u2061\u2062\u2063\u2064', 'wordjoiner'],
    ['isolates\u2066\u2067\u2068\u2069', 'isolates'],
    ['\uFEFFbom and soft\u00ADhyphen', 'bom and softhyphen'],
    // Step 2: letters without a decomposition, both cases.
    ['Łódź', 'lodz'],
    ['Straße', 'strasse'],
    ['STRAẞE', 'strasse'],
    ['Ærø', 'aero'],
    ['Œuvre', 'oeuvre'],
    ['Øresund', 'oresund'],
    ['Đorđe', 'dorde'],
    ['Þór', 'thor'],
    ['Iğdır', 'igdir'],
    ['ǿ ǽ', 'o ae'],
    // Step 3: diacritics and compatibility forms.
    ['Montréal', 'montreal'],
    ['São Paulo', 'sao paulo'],
    ['\uFF35\uFF34\u3000\uFF21\uFF55\uFF53\uFF54\uFF49\uFF4E', 'ut austin'],
    ['ﬁnance', 'finance'],
    // Step 4: case, locale-free.
    ['İstanbul', 'istanbul'],
    ['UT AUSTIN', 'ut austin'],
    ['already folded', 'already folded'],
  ])('%j folds to %j', (input, expected) => {
    expect(fold(input)).toBe(expected);
  });

  it('keeps punctuation, which the later steps handle', () => {
    expect(fold('UT-Austin (B.S.), A&M')).toBe('ut-austin (b.s.), a&m');
  });

  it.each([
    ['ß', 'ẞ', 'ss'], ['æ', 'Æ', 'ae'], ['œ', 'Œ', 'oe'], ['ø', 'Ø', 'o'], ['đ', 'Đ', 'd'], ['ł', 'Ł', 'l'], ['þ', 'Þ', 'th'],
  ])('spells out %s and %s as %s', (lower, upper, spelt) => {
    expect(LETTERS_WITHOUT_DECOMPOSITION.has(lower) && LETTERS_WITHOUT_DECOMPOSITION.has(upper)).toBe(true);
    expect([fold(lower), fold(upper)]).toEqual([spelt, spelt]);
  });

  it('reads the dotless i as i, and leaves case to step 4', () => {
    expect(foldLetters('ı')).toBe('i');
    expect(foldLetters('Łódź')).toBe('Lodz');
  });

  it('removes only the listed invisibles in step 1', () => {
    expect(removeInvisibles('a\u200Bb\u2066c\u00ADd')).toBe('abcd');
    expect(removeInvisibles('a b\u00A0c')).toBe('a b\u00A0c');
  });
});

describe('a spacing acute accent written for an apostrophe', () => {
  it('becomes the apostrophe before the decomposition could make it a space', () => {
    expect(foldLetters('Bachelor\u00B4s')).toBe("Bachelor's");
    expect(fold('BACHELOR\u00B4S')).toBe("bachelor's");
  });
});

describe('step 0: the 500 code point cap', () => {
  it.each([
    ['ASCII', 'a'.repeat(600), 'a'.repeat(FOLD_MAX_CODE_POINTS)],
    ['a surrogate pair at the edge is kept whole', `${'a'.repeat(499)}😀b`, `${'a'.repeat(499)}😀`],
    ['astral text counts code points, not UTF-16 units', '😀'.repeat(600), '😀'.repeat(FOLD_MAX_CODE_POINTS)],
    ['a short text is untouched', 'UT Austin', 'ut austin'],
    ['invisibles never count towards it', `${'\u200B'.repeat(500)}MIT`, 'mit'],
    ['a decomposition that expands stays within it', '\uFDFA'.repeat(500),
      '\uFDFA'.repeat(28).normalize('NFKD').slice(0, FOLD_MAX_CODE_POINTS).toLowerCase()],
    ['an expansion is counted after it decomposes', `${'a'.repeat(499)}\u3392😀`, `${'a'.repeat(499)}m`],
  ])('%s', (_name, input, expected) => {
    expect(fold(input)).toBe(expected);
  });

  it('never gives more than 500 code points, whatever the text decomposes to', () => {
    for (const text of ['\uFDFA'.repeat(500), '\u3392'.repeat(300), `${'\u00E9'.repeat(400)}\uFB03`.repeat(2)]) {
      expect([...fold(text)].length).toBeLessThanOrEqual(FOLD_MAX_CODE_POINTS);
    }
  });

  it.each([
    ['😀😀😀', 2, '😀😀'],
    ['a😀b', 2, 'a😀'],
    ['\uD800\uD800x', 2, '\uD800\uD800'],
    ['abc', 5, 'abc'],
    ['abc', 0, ''],
  ])('capCodePoints(%j, %d) is %j', (input, max, expected) => {
    expect(capCodePoints(input, max)).toBe(expected);
  });
});
