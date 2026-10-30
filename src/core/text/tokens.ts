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
/** Step 8: the apostrophes deleted ("bachelor's" becomes "bachelors"), with the marks pages write for one: the grave
 *  and acute accents, the single quotation marks, the reversed comma, the modifier letters, the prime and the
 *  full-width apostrophe. */
const APOSTROPHES = /['`\u00B4\u2018\u2019\u201B\u02B9\u02BB\u02BC\u2032\uFF07]/g;
/** Step 9: a letter, `&` and a letter, chains included, become one token ("a & m" becomes "a&m"). */
const LETTER_AMPERSAND_LETTER = /\b[a-z](?:\s*&\s*[a-z])+\b/g;
/** Step 10: a step-9 token is kept whole; every other `&` becomes " and ". */
const OTHER_AMPERSAND = /\b[a-z](?:&[a-z])+\b|&/g;
/**
 * Step 11: punctuation and symbols. Two marks that tell names apart are matched first (the groups) and kept: a run of
 * `+` or `#` that ends a word right after a letter, so "C++" and "C#" keep apart from "C" and "A+" from "A"; and a `-`
 * that ends a one-letter word, so the grade "A-" keeps apart from "A". A `+` after a digit ("10+") or standing alone,
 * and a `-` with a space before it ("Option A - ..."), are spaces like every other mark.
 */
const PUNCTUATION = new RegExp([
  String.raw`(?<=\p{L})([+#]+)(?![\p{L}\p{N}+#])`,
  String.raw`(?<=(?:^|[^\p{L}\p{N}])\p{L})(-)(?![\p{L}\p{N}+#-])`,
  String.raw`[\p{P}\p{S}]`,
].join('|'), 'gu');
/** Step 12: whitespace and control characters separate tokens. */
const SEPARATORS = /[\s\p{Cc}]+/u;

const isDigit = (code: number) => code >= 0x30 && code <= 0x39;

/** Step 11 for one mark: kept when it is a word's closing `+`, `#` or one-letter `-`, a step-9 `&`, or a dot between
 *  digits. */
function keepOrSpace(mark: string, signs: string | undefined, minus: string | undefined, offset: number,
  whole: string): string {
  if (signs !== undefined || minus !== undefined || mark === '&') return mark;
  if (mark === '.' && isDigit(whole.charCodeAt(offset - 1)) && isDigit(whole.charCodeAt(offset + 1))) return mark;
  return ' ';
}

/** Steps 7 to 12 over folded text: the tokens, in order. Only `&` inside a step-9 token, `.` between digits and a
 *  word's closing `+`, `#` or one-letter `-` survive as punctuation. */
export function tokenize(folded: string): string[] {
  let text = folded;
  // Each step runs only when its character is present: most labels have no dot, ampersand, plus, hash or hyphen.
  const dots = text.includes('.');
  if (dots) text = text.replace(DOTTED, (dotted) => dotted.replace(/[.\s]/g, '')).replace(DOT_BETWEEN_LETTERS, '');
  text = text.replace(APOSTROPHES, '');
  const ampersands = text.includes('&');
  if (ampersands) {
    text = text.replace(LETTER_AMPERSAND_LETTER, (token) => token.replace(/\s+/g, ''));
    text = text.replace(OTHER_AMPERSAND, (match) => (match === '&' ? ' and ' : match));
  }
  const signs = text.includes('+') || text.includes('#') || text.includes('-');
  text = dots || ampersands || signs ? text.replace(PUNCTUATION, keepOrSpace) : text.replace(PUNCTUATION, ' ');
  return text.split(SEPARATORS).filter((token) => token !== '');
}

/**
 * Step 14, institution and field: English articles and prepositions only. The articles and particles that begin
 * names in other languages ("De La Salle", "Los Angeles", "El Camino") are kept: dropping them gave distinct schools
 * one key ("De La Salle University" and "La Salle University").
 */
const INSTITUTION_FIELD = ['the', 'of', 'at', 'and', 'in', 'for', 'a', 'an', 'on'];

/**
 * The articles and particles of other languages that version 1 removed as stopwords and step 14 now keeps in keys.
 * Listed for callers that want only a name's telling words, as a search query does ("Universidad Andes" rather than
 * "Universidad de").
 */
export const NAME_PARTICLES = ['de', 'del', 'della', 'des', 'di', 'du', 'da', 'do', 'dos', 'das', 'la', 'le', 'les', 'el',
  'los', 'und', 'y'] as const;

/** Stopwords that are also place codes ("IN" for Indiana, "ON" for Ontario). normalize() keeps them in the institution
 *  and field contexts when the text writes them in capitals among lower-case letters ("Saint Mary's College IN"). */
export const PLACE_CODE_STOPWORDS = ['in', 'on'] as const;

const NO_WORDS: ReadonlySet<string> = new Set();

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

/** Step 14: the tokens without the context's stopwords, or all of them when removal would leave nothing. A token in
 *  `keep` is never removed (the place codes normalize() found written in capitals). */
export function removeStopwords(tokens: readonly string[], context: NormContext, keep: ReadonlySet<string> = NO_WORDS):
  string[] {
  const stopwords = STOPWORDS[context];
  const kept = tokens.filter((token) => keep.has(token) || !stopwords.has(token));
  const core = kept.length > 0 ? kept : [...tokens];
  return context === 'degree' ? core.map((token) => DEGREE_LEVEL_PLURALS.get(token) ?? token) : core;
}
