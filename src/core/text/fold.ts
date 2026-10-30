/*
 * Folding: the first five normalization steps (docs/design/core.md §3.1, steps 0 to 4). Every comparison the matcher
 * makes and every key the vocabulary build stores starts from this text, so it is static: no data files, no locale and
 * no options. The Guard's detection folding (guard/fold.ts) reuses the letter and diacritic steps.
 */

/** Step 0: at most this many code points of a text are folded; the rest is dropped. */
export const FOLD_MAX_CODE_POINTS = 500;

/** Step 1: zero-width characters, bidi controls, the byte-order mark and the soft hyphen. */
const INVISIBLES = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/**
 * Step 2: letters that have no Unicode decomposition, so step 3 alone would keep them. Both cases are listed because
 * case folding comes last ("Łódź" becomes "Lodz" before it becomes "lodz").
 */
export const LETTERS_WITHOUT_DECOMPOSITION: ReadonlyMap<string, string> = new Map([
  ['ß', 'ss'], ['ẞ', 'SS'], ['æ', 'ae'], ['Æ', 'AE'], ['œ', 'oe'], ['Œ', 'OE'], ['ø', 'o'], ['Ø', 'O'],
  ['đ', 'd'], ['Đ', 'D'], ['ł', 'l'], ['Ł', 'L'], ['þ', 'th'], ['Þ', 'TH'], ['ı', 'i'],
]);
const LETTERS = /[ßẞæÆœŒøØđĐłŁþÞı]/g;

/** Step 3: combining marks, deleted after the compatibility decomposition. */
const MARKS = /\p{M}/gu;

/** Any character outside ASCII. A pure-ASCII text needs only steps 0 and 4. */
const NON_ASCII = /[\u0080-\uFFFF]/;

/** The first `max` code points of `text`. A surrogate pair is never split; a lone surrogate counts as one. */
export function capCodePoints(text: string, max: number): string {
  if (text.length <= max) return text;
  let units = 0;
  for (let count = 0; count < max && units < text.length; count += 1) {
    const unit = text.charCodeAt(units);
    const pair = unit >= 0xd800 && unit <= 0xdbff && units + 1 < text.length
      && (text.charCodeAt(units + 1) & 0xfc00) === 0xdc00;
    units += pair ? 2 : 1;
  }
  return text.slice(0, units);
}

/** Step 1: deletes the invisible characters ("UT\u200B Austin" becomes "UT Austin"). */
export function removeInvisibles(text: string): string {
  return text.replace(INVISIBLES, '');
}

/**
 * Steps 2 and 3: letters without a decomposition are spelt out, then the text is decomposed (NFKD) and its combining
 * marks are deleted, so "Montréal" becomes "Montreal" and full-width letters become ASCII. The letter table runs after
 * the decomposition, which gives the same result and also catches a letter that a decomposition produces ("ǿ" is "ø"
 * plus an accent). Case is left alone.
 */
export function foldLetters(text: string): string {
  return text.normalize('NFKD').replace(LETTERS, (letter) => LETTERS_WITHOUT_DECOMPOSITION.get(letter) ?? letter)
    .replace(MARKS, '');
}

/**
 * Steps 0 to 4: the first 500 code points, invisibles deleted, letters and diacritics folded, then lower case
 * (locale-free: a Turkish "İ" has already lost its dot in step 3).
 */
export function fold(text: string): string {
  const capped = capCodePoints(text, FOLD_MAX_CODE_POINTS);
  if (!NON_ASCII.test(capped)) return capped.toLowerCase();
  return foldLetters(removeInvisibles(capped)).toLowerCase();
}
