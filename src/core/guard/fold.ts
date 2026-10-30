/*
 * Folding for detection (docs/design/core.md §7.1). The Guard's patterns run over this text, never over the page's own
 * spelling, so a Cyrillic "\u0410" in "\u0410I" or a zero-width space inside a word still reads as plain Latin
 * text. Each folded character keeps the span of the original character it came from, so a match can be cut out of the
 * original label. Unlike normalization it keeps punctuation and does not cap the length: a pattern after the 500th
 * character of a job description must still be found.
 */
import { foldLetters } from '../text/fold';

/**
 * A curated subset of Unicode's confusables: Cyrillic and Greek letters that look like Latin ones, mapped to the
 * lower-case Latin letter (case-aware, applied before lower-casing), plus the apostrophe look-alikes, so "you’re"
 * reads "you're".
 */
export const CONFUSABLES: ReadonlyMap<string, string> = new Map([
  // Cyrillic capitals.
  ['\u0410', 'a'], ['\u0412', 'b'], ['\u0421', 'c'], ['\u0415', 'e'], ['\u041D', 'h'], ['\u0406', 'i'],
  ['\u0408', 'j'], ['\u041A', 'k'], ['\u041C', 'm'], ['\u041E', 'o'], ['\u0420', 'p'], ['\u0405', 's'],
  ['\u0422', 't'], ['\u0425', 'x'], ['\u0423', 'y'], ['\u04AE', 'y'], ['\u04BA', 'h'], ['\u04C0', 'i'],
  ['\u0500', 'd'], ['\u051A', 'q'], ['\u051C', 'w'],
  // Cyrillic small letters.
  ['\u0430', 'a'], ['\u0441', 'c'], ['\u0435', 'e'], ['\u04BB', 'h'], ['\u0456', 'i'], ['\u0458', 'j'],
  ['\u043E', 'o'], ['\u0440', 'p'], ['\u0455', 's'], ['\u0445', 'x'], ['\u0443', 'y'], ['\u04AF', 'y'],
  ['\u04CF', 'l'], ['\u0501', 'd'], ['\u051B', 'q'], ['\u051D', 'w'],
  // Greek capitals.
  ['\u0391', 'a'], ['\u0392', 'b'], ['\u0395', 'e'], ['\u0396', 'z'], ['\u0397', 'h'], ['\u0399', 'i'],
  ['\u039A', 'k'], ['\u039C', 'm'], ['\u039D', 'n'], ['\u039F', 'o'], ['\u03A1', 'p'], ['\u03A4', 't'],
  ['\u03A5', 'y'], ['\u03A7', 'x'], ['\u03F9', 'c'], ['\u037F', 'j'],
  // Greek small letters.
  ['\u03B1', 'a'], ['\u03B3', 'y'], ['\u03B9', 'i'], ['\u03BA', 'k'], ['\u03BD', 'v'], ['\u03BF', 'o'],
  ['\u03C1', 'p'], ['\u03C5', 'u'], ['\u03C7', 'x'], ['\u03F2', 'c'], ['\u03F3', 'j'],
  // Apostrophe look-alikes: left and right single quotation marks, the modifier letter apostrophe, the prime.
  ['\u2018', "'"], ['\u2019', "'"], ['\u02BC', "'"], ['\u2032', "'"],
]);

/** Deleted: every format character (zero-width, bidi controls, tag characters, the soft hyphen; a superset of
 *  normalization step 1) and the Hangul fillers, which render as blanks. */
const INVISIBLE = /[\p{Cf}\u115F\u1160\u3164\uFFA0]/u;
/** Read as a space: control characters as well as whitespace, so a control character cannot join two words. */
const CONTROL = /\p{Cc}/u;
const SPACE = /\s/;

/** Text folded for detection, with the source of each folded character. */
export interface DetectionText {
  /** Steps 1 to 4 of normalization plus the confusables, lower case, whitespace collapsed to single spaces and
   *  trimmed. Punctuation is kept. */
  text: string;
  /** For each UTF-16 index of `text`: where its source character starts in the original. */
  starts: number[];
  /** For each UTF-16 index of `text`: where its source character ends in the original. */
  ends: number[];
}

/** Folds `original` for the Guard's patterns, keeping the map back to the original. */
export function foldForDetection(original: string): DetectionText {
  const chars: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let lastIsSpace = false;
  const pushSpace = (start: number, end: number) => {
    if (chars.length === 0) return;
    if (lastIsSpace) {
      ends[ends.length - 1] = end;
      return;
    }
    chars.push(' ');
    starts.push(start);
    ends.push(end);
    lastIsSpace = true;
  };
  const pushText = (piece: string, start: number, end: number) => {
    for (let k = 0; k < piece.length; k += 1) {
      chars.push(piece[k]!);
      starts.push(start);
      ends.push(end);
    }
    lastIsSpace = false;
  };
  let index = 0;
  for (const cp of original) {
    const start = index;
    index += cp.length;
    const code = cp.charCodeAt(0);
    if (code < 0x80) {
      if (code <= 0x20 || code === 0x7f) pushSpace(start, index);
      else pushText(code >= 0x41 && code <= 0x5a ? String.fromCharCode(code + 0x20) : cp, start, index);
      continue;
    }
    if (INVISIBLE.test(cp)) continue;
    if (CONTROL.test(cp) || SPACE.test(cp)) {
      pushSpace(start, index);
      continue;
    }
    for (const letter of foldLetters(cp)) {
      const latin = CONFUSABLES.get(letter) ?? letter.toLowerCase();
      if (SPACE.test(latin)) pushSpace(start, index);
      else pushText(latin, start, index);
    }
  }
  if (lastIsSpace) {
    chars.pop();
    starts.pop();
    ends.pop();
  }
  return { text: chars.join(''), starts, ends };
}

/** Any character outside ASCII. */
const NON_ASCII = /[\x80-\u{FFFF}]/u;

/** The text foldForDetection gives, without the map back: all a pattern test needs. ASCII text takes a fast path. */
export function detectionText(original: string): string {
  if (NON_ASCII.test(original)) return foldForDetection(original).text;
  return original.toLowerCase().replace(/[\p{Cc} ]+/gu, ' ').trim();
}

/** The span of the original text that the folded range [start, end) came from. */
export function originalSpan(folded: DetectionText, start: number, end: number): { start: number; end: number } {
  const length = folded.text.length;
  if (end > start && start < length) {
    return { start: folded.starts[start]!, end: folded.ends[Math.min(end, length) - 1]! };
  }
  const at = start < length ? folded.starts[start]! : (folded.ends[length - 1] ?? 0);
  return { start: at, end: at };
}
