/*
 * Folding: the first five normalization steps (docs/design/core.md §3.1, steps 0 to 4). Every comparison the matcher
 * makes and every key the vocabulary build stores starts from this text, so it is static: no data files, no locale and
 * no options. The Guard's detection folding (guard/fold.ts) reuses the letter and diacritic steps.
 */

/** Step 0: at most this many code points of the folded text are kept; the rest is dropped. */
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

/** Before step 3: the spacing acute accent, which pages write for an apostrophe ("Bachelor\u00B4s"). The decomposition
 *  would make it a space and a combining mark, so it becomes an apostrophe first, which step 8 then deletes. */
const ACUTE_ACCENT = /\u00B4/g;

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

/**
 * `text` with at most `max` code points: a longer text is cut after its last whole word within them, so no word is
 * split, and only a first word longer than `max` is cut inside; the spaces at the cut go. TailorIT's cutAtWord (the
 * contract's ai.ts) to the letter, which test/contract.test.ts checks: the core may not import it.
 */
export function cutAtWord(text: string, max: number): string {
  const points = [...text];
  if (points.length <= max) return text;
  const head = points.slice(0, Math.max(0, max));
  let end = head.length;
  if (!/\s/.test(points[end] ?? '')) {
    while (end > 0 && !/\s/.test(head[end - 1]!)) end -= 1;
  }
  const kept = head.slice(0, end).join('').trimEnd();
  return kept === '' ? head.join('').trimEnd() : kept;
}

/** Step 1: deletes the invisible characters ("UT\u200B Austin" becomes "UT Austin"). */
export function removeInvisibles(text: string): string {
  return text.replace(INVISIBLES, '');
}

/**
 * Steps 2 and 3: letters without a decomposition are spelt out, then the text is decomposed (NFKD) and its combining
 * marks are deleted, so "Montréal" becomes "Montreal" and full-width letters become ASCII. The letter table runs after
 * the decomposition, which gives the same result and also catches a letter that a decomposition produces ("ǿ" is "ø"
 * plus an accent). A spacing acute accent becomes an apostrophe first. Case is left alone.
 */
export function foldLetters(text: string): string {
  return text.replace(ACUTE_ACCENT, "'").normalize('NFKD')
    .replace(LETTERS, (letter) => LETTERS_WITHOUT_DECOMPOSITION.get(letter) ?? letter).replace(MARKS, '');
}

/**
 * Steps 0 to 4: invisibles deleted, letters and diacritics folded, the first 500 code points of the result kept, then
 * lower case (locale-free: a Turkish "İ" has lost its dot in step 3). The cap comes after the deletions and the
 * decomposition, so invisibles and marks never count towards it, and a decomposition that expands ("\uFDFA" is 18
 * letters) can never take the text past it.
 */
export function fold(text: string): string {
  if (!NON_ASCII.test(text)) return capCodePoints(text, FOLD_MAX_CODE_POINTS).toLowerCase();
  return capCodePoints(foldLetters(removeInvisibles(text)), FOLD_MAX_CODE_POINTS).toLowerCase();
}
