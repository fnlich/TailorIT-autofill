import { describe, expect, it } from 'vitest';
import { extractQualifiers, isNoiseQualifier, NOISE_QUALIFIERS } from './qualifiers';

describe('extractQualifiers: normalization step 6', () => {
  it.each([
    ['computer science (b.s.)', 'computer science', ['b.s.']],
    ['university of texas (austin)', 'university of texas', ['austin']],
    ['university of texas (dallas)', 'university of texas', ['dallas']],
    ['doctorate (phd, md, jd)', 'doctorate', ['phd, md, jd']],
    ['penn state (main campus)', 'penn state', ['main campus']],
    ['mba [online]', 'mba', ['online']],
    ['other (please specify)', 'other', ['please specify']],
    ['(austin) ut', 'ut', ['austin']],
    ['a (b) c (d)', 'a c', ['b', 'd']],
    // Nested segments are flattened into the one around them.
    ['doctorate (phd (or equivalent), md)', 'doctorate', ['phd or equivalent , md']],
    ['x [a (b) c]', 'x', ['a b c']],
    // An empty segment leaves nothing behind; an unclosed opener or a stray closer is ordinary punctuation.
    ['option () b', 'option b', []],
    ['computer science (b.s.', 'computer science (b.s.', []],
    ['austin) college', 'austin) college', []],
    ['(a (b) c', '(a c', ['b']],
    ['no brackets', 'no brackets', []],
  ])('%j gives main %j and qualifiers %j', (input, main, qualifiers) => {
    const extracted = extractQualifiers(input);
    expect({ main: extracted.main.replace(/\s+/g, ' ').trim(), qualifiers: extracted.qualifiers })
      .toEqual({ main, qualifiers });
  });

  it('leaves a space where a segment was, so the words around it never join', () => {
    expect(extractQualifiers('abc(def)ghi').main.split(/\s+/)).toEqual(['abc', 'ghi']);
  });
});

describe('noise qualifiers (§3.4)', () => {
  it('has the design’s list', () => {
    expect(NOISE_QUALIFIERS).toEqual(['optional', 'required', 'preferred', 'please', 'specify', 'select', 'one', 'if',
      'applicable', 'any', 'eg', 'ie', 'etc', 'or', 'equivalent', 'higher', 'above', 'including', 'only']);
  });

  it.each([
    [['optional'], true],
    [['please', 'specify'], true],
    [['if', 'applicable'], true],
    [['select', 'one'], true],
    [['or', 'higher'], true],
    [['austin'], false],
    [['main', 'campus'], false],
    [['eg', 'bs'], false],
    [['phd', 'md', 'jd'], false],
  ])('%j is noise: %s', (tokens, noise) => {
    expect(isNoiseQualifier({ tokens })).toBe(noise);
  });
});
