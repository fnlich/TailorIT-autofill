/*
 * Tokens: normalization steps 7 to 12 (dotted abbreviations, apostrophes, ampersands, punctuation and spaces) and the
 * stopwords of step 14, per context (docs/design/core.md §3.1). The input is text that fold() has already folded.
 */
import type { NormContext } from './normalize';

/**
 * Step 7: single letters each followed by a dot, two or more ("b.s.", "u.s.a."), or spaced throughout ("u. s. a.").
 * A run never starts right after a letter and a dot, and never mixes the two spacings, so neighbouring abbreviations
 * stay apart: "Ph.D. M.D." gives "phd md", never "phdmd".
 */
const DOTTED = /(?<!\p{L}\.)\b[a-z]\.(?:(?:[a-z]\.)+|(?:\s[a-z]\.)+)/gu;
/** Step 7: a dot between two letters ("ph.d." becomes "phd."). A dot between digits is kept ("3.85"). */
const DOT_BETWEEN_LETTERS = /(?<=\p{L})\.(?=\p{L})/gu;
/** Step 8: the apostrophes deleted ("bachelor's" becomes "bachelors"). */
const APOSTROPHES = /['\u2018\u2019\u02BC]/g;
/** Step 9: a letter, `&` and a letter, chains included, become one token ("a & m" becomes "a&m"). */
const LETTER_AMPERSAND_LETTER = /\b[a-z](?:\s*&\s*[a-z])+\b/g;
/** Step 10: a step-9 token is kept whole; every other `&` becomes " and ". */
const OTHER_AMPERSAND = /\b[a-z](?:&[a-z])+\b|&/g;
/** Step 11: punctuation and symbols. */
const PUNCTUATION = /[\p{P}\p{S}]/gu;
/** Step 12: whitespace and control characters separate tokens. */
const SEPARATORS = /[\s\p{Cc}]+/u;

const isDigit = (code: number) => code >= 0x30 && code <= 0x39;

/** Steps 7 to 12 over folded text: the tokens, in order. Only `&` inside a step-9 token and `.` between digits survive
 *  as punctuation. */
export function tokenize(folded: string): string[] {
  let text = folded;
  // Each step runs only when its character is present: most labels have no dot and no ampersand.
  const dots = text.includes('.');
  if (dots) text = text.replace(DOTTED, (dotted) => dotted.replace(/[.\s]/g, '')).replace(DOT_BETWEEN_LETTERS, '');
  text = text.replace(APOSTROPHES, '');
  const ampersands = text.includes('&');
  if (ampersands) {
    text = text.replace(LETTER_AMPERSAND_LETTER, (token) => token.replace(/\s+/g, ''));
    text = text.replace(OTHER_AMPERSAND, (match) => (match === '&' ? ' and ' : match));
  }
  text = dots || ampersands
    ? text.replace(PUNCTUATION, (mark: string, offset: number, whole: string) => {
      if (mark === '&') return mark;
      if (mark === '.' && isDigit(whole.charCodeAt(offset - 1)) && isDigit(whole.charCodeAt(offset + 1))) return mark;
      return ' ';
    })
    : text.replace(PUNCTUATION, ' ');
  return text.split(SEPARATORS).filter((token) => token !== '');
}

const INSTITUTION_FIELD = ['the', 'of', 'at', 'and', 'in', 'for', 'a', 'an', 'on', 'de', 'del', 'della', 'des', 'di',
  'du', 'da', 'do', 'dos', 'das', 'la', 'le', 'les', 'el', 'los', 'und', 'y'];

/**
 * Step 14: the words each context removes from `core`. Labels keep every word, because their rules are regexes over
 * the text; the design names no stopwords for addresses, so they keep every word too.
 */
export const STOPWORDS: Readonly<Record<NormContext, ReadonlySet<string>>> = {
  institution: new Set(INSTITUTION_FIELD),
  field: new Set(INSTITUTION_FIELD),
  degree: new Set(['the', 'of', 'in', 'and', 'a', 'an', 'degree']),
  country: new Set(['the', 'of', 'and']),
  region: new Set(['the', 'of', 'and']),
  answer: new Set(['the']),
  label: new Set(),
  address: new Set(),
};

/** Step 14, degree context: level words lose a plural `s` ("bachelors" becomes "bachelor"). */
export const DEGREE_LEVEL_PLURALS: ReadonlyMap<string, string> = new Map([
  ['associates', 'associate'], ['bachelors', 'bachelor'], ['masters', 'master'], ['doctorates', 'doctorate'],
]);

/** Step 14: the tokens without the context's stopwords, or all of them when removal would leave nothing. */
export function removeStopwords(tokens: readonly string[], context: NormContext): string[] {
  const stopwords = STOPWORDS[context];
  const kept = tokens.filter((token) => !stopwords.has(token));
  const core = kept.length > 0 ? kept : [...tokens];
  return context === 'degree' ? core.map((token) => DEGREE_LEVEL_PLURALS.get(token) ?? token) : core;
}
