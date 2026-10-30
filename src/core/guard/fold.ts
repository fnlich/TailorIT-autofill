/*
 * Folding for detection (docs/design/core.md §7.1). The Guard's patterns run over this text, never over the page's own
 * spelling, so a Cyrillic "\u0410" in "\u0410I", a small capital "\u1D00\u026A" or a zero-width space inside a word
 * still reads as plain Latin text. Each folded character keeps the span of the original character it came from, so a
 * match can be cut out of the original label. Unlike normalization it keeps punctuation and does not cap the length: a
 * pattern after the 500th character of a job description must still be found. Its loose view reads the joiners and
 * brackets a page can put between words as spaces, so "if-you-are-an-AI" and "[if you are] an AI" read as words too,
 * and its spaced reading reads format characters between two letters as a space, so "if\u200Byou\u200Bare" does.
 */
import { foldLetters } from '../text/fold';

/** Cherokee capitals that look like Latin letters; their small letters are added beside them. */
const CHEROKEE: ReadonlyArray<readonly [string, string]> = [
  ['\u13A0', 'd'], ['\u13A1', 'r'], ['\u13A2', 't'], ['\u13A5', 'i'], ['\u13A9', 'y'], ['\u13AA', 'a'],
  ['\u13AB', 'j'], ['\u13AC', 'e'], ['\u13B3', 'w'], ['\u13B7', 'm'], ['\u13BB', 'h'], ['\u13BD', 'y'],
  ['\u13C0', 'g'], ['\u13C2', 'h'], ['\u13C3', 'z'], ['\u13CF', 'b'], ['\u13D2', 'r'], ['\u13D4', 'w'],
  ['\u13D5', 's'], ['\u13D9', 'v'], ['\u13DA', 's'], ['\u13DE', 'l'], ['\u13DF', 'c'], ['\u13E2', 'p'],
  ['\u13E6', 'k'], ['\u13F4', 'b'],
];

/**
 * A curated subset of Unicode's confusables, mapped to the lower-case Latin letter: Cyrillic, Greek, Armenian, Cherokee
 * and Lisu letters that look like Latin ones, the Latin small capitals and the IPA letters that pass for Latin ones,
 * the negative circled and squared capitals (which NFKD leaves alone), and the apostrophe look-alikes, so "you\u2019re"
 * reads "you're". A character is looked up as written, then each letter of its decomposition, both before
 * lower-casing, so a lunate sigma ("\u03F9", which NFKD turns into a Sigma) still reads "c".
 */
export const CONFUSABLES: ReadonlyMap<string, string> = new Map<string, string>([
  // Cyrillic capitals.
  ['\u0410', 'a'], ['\u0412', 'b'], ['\u0421', 'c'], ['\u0415', 'e'], ['\u041D', 'h'], ['\u0406', 'i'],
  ['\u0408', 'j'], ['\u041A', 'k'], ['\u041C', 'm'], ['\u041E', 'o'], ['\u0420', 'p'], ['\u0405', 's'],
  ['\u0422', 't'], ['\u0425', 'x'], ['\u0423', 'y'], ['\u04AE', 'y'], ['\u04BA', 'h'], ['\u04C0', 'i'],
  ['\u0500', 'd'], ['\u051A', 'q'], ['\u051C', 'w'], ['\u0474', 'v'], ['\u0460', 'w'], ['\u050C', 'g'],
  ['\u0492', 'f'],
  // Cyrillic small letters, those shaped like Latin small capitals included ("\u043D" is "\u029C").
  ['\u0430', 'a'], ['\u0441', 'c'], ['\u0435', 'e'], ['\u04BB', 'h'], ['\u0456', 'i'], ['\u0458', 'j'],
  ['\u043E', 'o'], ['\u0440', 'p'], ['\u0455', 's'], ['\u0445', 'x'], ['\u0443', 'y'], ['\u04AF', 'y'],
  ['\u04CF', 'l'], ['\u0501', 'd'], ['\u051B', 'q'], ['\u051D', 'w'], ['\u0432', 'b'], ['\u0433', 'r'],
  ['\u043A', 'k'], ['\u043C', 'm'], ['\u043D', 'h'], ['\u043F', 'n'], ['\u0442', 't'], ['\u044C', 'b'],
  ['\u0475', 'v'], ['\u0461', 'w'], ['\u0493', 'f'], ['\u050D', 'g'],
  // Greek capitals.
  ['\u0391', 'a'], ['\u0392', 'b'], ['\u0395', 'e'], ['\u0396', 'z'], ['\u0397', 'h'], ['\u0399', 'i'],
  ['\u039A', 'k'], ['\u039C', 'm'], ['\u039D', 'n'], ['\u039F', 'o'], ['\u03A1', 'p'], ['\u03A4', 't'],
  ['\u03A5', 'y'], ['\u03A7', 'x'], ['\u03F9', 'c'], ['\u037F', 'j'], ['\u03DC', 'f'],
  // Greek small letters.
  ['\u03B1', 'a'], ['\u03B3', 'y'], ['\u03B9', 'i'], ['\u03BA', 'k'], ['\u03BD', 'v'], ['\u03BF', 'o'],
  ['\u03C1', 'p'], ['\u03C5', 'u'], ['\u03C7', 'x'], ['\u03F2', 'c'], ['\u03F3', 'j'], ['\u03B7', 'n'],
  ['\u03C3', 'o'], ['\u03C4', 't'], ['\u03C9', 'w'], ['\u03F1', 'p'],
  // Armenian capitals and small letters.
  ['\u053C', 'l'], ['\u054D', 'u'], ['\u0555', 'o'], ['\u0566', 'q'], ['\u0570', 'h'], ['\u0575', 'j'],
  ['\u0578', 'n'], ['\u057D', 'u'], ['\u0581', 'g'], ['\u0585', 'o'],
  // Cherokee, capitals and small letters.
  ...CHEROKEE,
  ...CHEROKEE.map(([capital, latin]) => [capital.toLowerCase(), latin] as const),
  // Lisu letters, which are shaped like Latin capitals.
  ['\uA4D0', 'b'], ['\uA4D1', 'p'], ['\uA4D3', 'd'], ['\uA4D4', 't'], ['\uA4D6', 'g'], ['\uA4D7', 'k'],
  ['\uA4D9', 'j'], ['\uA4DA', 'c'], ['\uA4DC', 'z'], ['\uA4DD', 'f'], ['\uA4DF', 'm'], ['\uA4E0', 'n'],
  ['\uA4E1', 'l'], ['\uA4E2', 's'], ['\uA4E3', 'r'], ['\uA4E6', 'v'], ['\uA4E7', 'h'], ['\uA4EA', 'w'],
  ['\uA4EB', 'x'], ['\uA4EC', 'y'], ['\uA4EE', 'a'], ['\uA4F0', 'e'], ['\uA4F2', 'i'], ['\uA4F3', 'o'],
  ['\uA4F4', 'u'],
  // Latin small capitals.
  ['\u1D00', 'a'], ['\u0299', 'b'], ['\u1D04', 'c'], ['\u1D05', 'd'], ['\u1D07', 'e'], ['\uA730', 'f'],
  ['\u0262', 'g'], ['\u029C', 'h'], ['\u026A', 'i'], ['\u1D0A', 'j'], ['\u1D0B', 'k'], ['\u029F', 'l'],
  ['\u1D0D', 'm'], ['\u0274', 'n'], ['\u1D0F', 'o'], ['\u1D18', 'p'], ['\uA7AF', 'q'], ['\u0280', 'r'],
  ['\uA731', 's'], ['\u1D1B', 't'], ['\u1D1C', 'u'], ['\u1D20', 'v'], ['\u1D21', 'w'], ['\u028F', 'y'],
  ['\u1D22', 'z'],
  // IPA letters that pass for Latin ones: alpha, script g, iota, dotless j and the dental click.
  ['\u0251', 'a'], ['\u0261', 'g'], ['\u0269', 'i'], ['\u0237', 'j'], ['\u01C0', 'l'],
  // Negative circled and negative squared capitals (U+1F150 and U+1F170 on).
  ...[0x1f150, 0x1f170].flatMap((base) => Array.from({ length: 26 },
    (_, offset) => [String.fromCodePoint(base + offset), String.fromCharCode(0x61 + offset)] as const)),
  // Apostrophe look-alikes: the single quotation marks, the reversed comma, the modifier letters, the prime.
  ['\u2018', "'"], ['\u2019', "'"], ['\u201B', "'"], ['\u02B9', "'"], ['\u02BB', "'"], ['\u02BC', "'"],
  ['\u2032', "'"],
]);

/** Deleted: every format character (zero-width, bidi controls, tag characters, the soft hyphen; a superset of
 *  normalization step 1). A reader sees nothing there, not even a space; the spaced reading reads a run of them
 *  between two letters or digits as one, since a page can put them where the spaces go. */
const INVISIBLE = /\p{Cf}/u;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
/** Read as a space: control characters as well as whitespace, so a control character cannot join two words, and the
 *  characters that render as a blank (the Hangul fillers and the blank Braille pattern), which a reader takes for
 *  one. */
const CONTROL = /\p{Cc}/u;
const SPACE = /\s/;
const BLANK = /[\u115F\u1160\u2800\u3164\uFFA0]/;

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

/** How foldForDetection reads format characters. */
export interface FoldOptions {
  /** The spaced reading: a run of format characters between two letters or digits reads as one space instead of
   *  nothing ("if\u200Byou" reads "if you"). The strict reading (the default) deletes them, so "A\u200BI" reads "ai". */
  formatAsSpace?: boolean;
}

/** Folds `original` for the Guard's patterns, keeping the map back to the original. */
export function foldForDetection(original: string, options: FoldOptions = {}): DetectionText {
  const chars: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let lastIsSpace = false;
  /** The run of format characters since the last folded character, which the spaced reading may read as a space. */
  const gap = { open: false, start: 0, end: 0 };
  const pushSpace = (start: number, end: number) => {
    gap.open = false;
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
    const between = gap.open && !lastIsSpace && LETTER_OR_DIGIT.test(piece[0] ?? '')
      && LETTER_OR_DIGIT.test(chars[chars.length - 1] ?? '');
    if (between) pushSpace(gap.start, gap.end);
    gap.open = false;
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
    if (INVISIBLE.test(cp)) {
      if (options.formatAsSpace) {
        if (!gap.open) Object.assign(gap, { open: true, start });
        gap.end = index;
      }
      continue;
    }
    if (CONTROL.test(cp) || SPACE.test(cp) || BLANK.test(cp)) {
      pushSpace(start, index);
      continue;
    }
    const confusable = CONFUSABLES.get(cp);
    if (confusable !== undefined) {
      pushText(confusable, start, index);
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

/** Any UTF-16 unit outside ASCII, so astral characters count through their surrogates. With the u flag the class would
 *  end at U+FFFF and miss them, and a label disguised only with astral letters ("\u{1D400}\u{1D408}" for "AI") would
 *  skip the fold. */
const NON_ASCII = /[\u0080-\uFFFF]/;

/** The text foldForDetection gives, without the map back: all a pattern test needs. ASCII text takes a fast path. */
export function detectionText(original: string): string {
  if (NON_ASCII.test(original)) return foldForDetection(original).text;
  return original.toLowerCase().replace(/[\p{Cc} ]+/gu, ' ').trim();
}

/** A joiner between two letters or digits: hyphens and dashes, the underscore, the full stop and the middle dots
 *  ("if-you-are", "if_you_are", "A.I."). */
const JOINER = /(?<=[\p{L}\p{N}])[-_.\u00B7\u2010-\u2015\u2027\u2212\u30FB](?=[\p{L}\p{N}])/gu;
/** Brackets, double quotes, guillemets and asterisks, which can split one phrase in two ("[if you are] an AI"). */
const WRAPPER = /[()[\]{}"*\u00AB\u00BB\u201C\u201D]/g;

/**
 * The loose view of folded text: joiners between letters, and every bracket, double quote and asterisk, read as
 * spaces, so "if-you-are-an-AI", "A.I." and "Option A [if you are] an AI" read as words. Each replaced character is one
 * UTF-16 unit and becomes one space, so the view has the folded text's length and an offset into it maps back through
 * the same DetectionText. The patterns run over both texts: "<im_start>" and "[INST]" need the folded text itself.
 */
export function looseView(folded: string): string {
  return folded.replace(JOINER, ' ').replace(WRAPPER, ' ');
}

const FORMAT = /\p{Cf}/u;

/** Whether `original` has a format character, so its spaced reading may differ from its strict one. */
export function hasFormatCharacter(original: string): boolean {
  return FORMAT.test(original);
}

/**
 * The texts the Guard's patterns run over for `original`: its folded text and that text's loose view, of one length,
 * then, when it has a format character, its spaced reading and that reading's loose view (of their own length). A hit
 * in any counts.
 */
export function detectionViews(original: string): [string, string, ...string[]] {
  const text = detectionText(original);
  if (!hasFormatCharacter(original)) return [text, looseView(text)];
  const spaced = foldForDetection(original, { formatAsSpace: true }).text;
  return [text, looseView(text), spaced, looseView(spaced)];
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
