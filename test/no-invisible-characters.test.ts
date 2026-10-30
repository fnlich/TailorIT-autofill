/*
 * No raw invisible character in the repo's hand-written files. The file tools can turn an escape typed as \u200B into
 * the character itself, and a zero-width space, a bidi control or a tag character in source reads as nothing (or
 * reorders what is read) while it changes what the code does. Such characters are written as \u escapes; tab, line
 * feed and carriage return are the only control characters allowed. Generated, downloaded and captured data, and build
 * output, are left out: they may hold such characters as data. Code files may hold no raw look-alike letter either
 * (a Cyrillic "\u0410", a full-width "\uFF35", a mathematical "\u{1D400}"): the Guard's tests write them as escapes,
 * so a reader sees what each test feeds in. Prose and data files may hold them: names are written in their own scripts.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** The folders of hand-written files. */
const SCANNED = ['src', 'scripts', 'test', 'e2e', 'vocab/curated', 'docs'] as const;
/** The hand-written files at the root. */
const ROOT_FILES = ['eslint.config.mjs', 'playwright.config.ts', 'vitest.config.ts', 'vitest.projects.ts', 'wxt.config.ts',
  'package.json', 'tsconfig.base.json', 'tsconfig.core-tests.json', 'tsconfig.core.json', 'tsconfig.json',
  'tsconfig.tools.json', 'README.md', 'THIRD_PARTY_NOTICES.md'] as const;
/** The folders under them that hold generated, downloaded or captured files, or build output. */
const SKIPPED = ['src/core/vocab/data', 'vocab/.sources', 'fixtures', 'e2e/artifacts', 'node_modules'] as const;
/** The text files a person writes. */
const TEXT = /\.(?:[cm]?[jt]sx?|json|html?|css|md|txt|ya?ml)$/;
/** Code, where a look-alike letter must be an escape. */
const CODE = /\.[cm]?[jt]sx?$/;
/** Letters and signs that pass for Latin letters or apostrophes, as [first, last] code points: Greek, Cyrillic,
 *  Armenian, Cherokee, Lisu, the phonetic extensions and small capitals, IPA, the modifier apostrophes, mathematical
 *  alphanumerics, full-width forms, Roman numerals and enclosed letters. */
const LOOK_ALIKES: ReadonlyArray<readonly [number, number]> = [
  [0x0370, 0x03ff], [0x1f00, 0x1fff], // Greek
  [0x0400, 0x052f], [0x1c80, 0x1c8f], [0x2de0, 0x2dff], [0xa640, 0xa69f], // Cyrillic
  [0x0530, 0x058f], // Armenian
  [0x13a0, 0x13ff], [0xab70, 0xabbf], // Cherokee
  [0xa4d0, 0xa4ff], // Lisu
  [0x1d00, 0x1dbf], [0xa730, 0xa7ff], [0x0250, 0x02af], [0x02b9, 0x02bc], // small capitals, IPA, modifier apostrophes
  [0x1d400, 0x1d7ff], [0xff00, 0xffef], [0x2160, 0x2188], [0x2460, 0x24ff], [0x1f100, 0x1f1ff],
];

/** Whether a character is a look-alike a code file must write as an escape. */
function isLookAlike(character: string): boolean {
  const code = character.codePointAt(0)!;
  return LOOK_ALIKES.some(([first, last]) => code >= first && code <= last);
}

/** A line with nothing but printable ASCII, tab and carriage return needs no closer look. */
const PLAIN_LINE = /^[ -~\t\r]*$/;
/** Control, format, line and paragraph separator, and space characters, by category. */
const BY_CATEGORY = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Zs}]/u;
/** The characters those categories hold that a file may contain: tab, line feed, carriage return and the space. */
const ALLOWED = new Set([0x09, 0x0a, 0x0d, 0x20]);
/** Characters of other categories that render as nothing or as a blank, as [first, last] code points. */
const BLANKS: ReadonlyArray<readonly [number, number]> = [
  [0x034f, 0x034f], // the combining grapheme joiner
  [0x115f, 0x1160], [0x3164, 0x3164], [0xffa0, 0xffa0], // the Hangul fillers
  [0x17b4, 0x17b5], // the Khmer inherent vowels
  [0x180b, 0x180d], [0x180f, 0x180f], // the Mongolian free variation selectors
  [0x2800, 0x2800], // the blank Braille pattern
  [0xfe00, 0xfe0f], [0xe0100, 0xe01ef], // the variation selectors
];

/**
 * Whether a character must be written as an escape: every control character but tab, line feed and carriage return;
 * every format character (zero-width characters, bidi controls, the byte-order mark, tags); the line and paragraph
 * separators; every space but U+0020; and BLANKS.
 */
function isInvisible(character: string): boolean {
  const code = character.codePointAt(0)!;
  if (ALLOWED.has(code)) return false;
  return BY_CATEGORY.test(character) || BLANKS.some(([first, last]) => code >= first && code <= last);
}

const posix = (path: string) => relative(ROOT, path).split('\\').join('/');

function textFilesUnder(dir: string): string[] {
  const rel = posix(dir);
  if (SKIPPED.some((skip) => rel === skip || rel.startsWith(`${skip}/`))) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return textFilesUnder(path);
    return entry.isFile() && TEXT.test(entry.name) ? [path] : [];
  });
}

/** Every hand-written text file: the scanned folders and the root's own files. */
const handWritten = () => [...SCANNED.flatMap((folder) => textFilesUnder(join(ROOT, folder))),
  ...ROOT_FILES.map((name) => join(ROOT, name))];

/** Where `test` finds a character in the files, as "path:line U+XXXX". */
function charactersIn(files: readonly string[], test: (character: string) => boolean): string[] {
  const found: string[] = [];
  for (const path of files) {
    readFileSync(path, 'utf8').split('\n').forEach((line, index) => {
      if (PLAIN_LINE.test(line)) return;
      for (const character of line) {
        if (!test(character)) continue;
        const code = character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
        found.push(`${posix(path)}:${index + 1} U+${code}`);
      }
    });
  }
  return found;
}

describe('the hand-written files', () => {
  it('hold no raw invisible, bidi, tag or control character', () => {
    const files = handWritten();
    expect(files.length).toBeGreaterThan(100);
    expect(files.map(posix)).toEqual(expect.arrayContaining(['docs/design/core.md', 'vitest.config.ts']));
    expect(charactersIn(files, isInvisible), 'write each as a \\u escape').toEqual([]);
  });

  it('hold no raw look-alike letter in code', () => {
    const code = handWritten().filter((path) => CODE.test(path));
    expect(code.length).toBeGreaterThan(100);
    expect(charactersIn(code, isLookAlike), 'write each as a \\u escape').toEqual([]);
  });

  it('would catch each kind of look-alike, and allows the letters and signs prose uses', () => {
    for (const code of [0x0410, 0x0391, 0x0585, 0x13a5, 0xa4ee, 0x1d00, 0x026a, 0x02bc, 0x1d400, 0xff35, 0x216c,
      0x24b6, 0x1f170]) {
      expect(isLookAlike(String.fromCodePoint(code)), code.toString(16)).toBe(true);
    }
    for (const character of ['a', '\u{E9}', '\u{FC}', '\u{2014}', '\u{2019}', '\u{A7}', '\u{D7}', '\u{1F600}']) {
      expect(isLookAlike(character), JSON.stringify(character)).toBe(false);
    }
  });

  it('would catch each kind of character, and allows tab, line feed, carriage return and visible text', () => {
    for (const code of [0x0001, 0x007f, 0x0085, 0x00a0, 0x00ad, 0x034f, 0x061c, 0x200b, 0x200d, 0x202e, 0x2066, 0x2028,
      0x2800, 0x3000, 0x3164, 0xfe0f, 0xfeff, 0xe0041, 0xe0100]) {
      expect(isInvisible(String.fromCodePoint(code)), code.toString(16)).toBe(true);
    }
    for (const character of ['\t', '\n', '\r', ' ', 'a', '\u{E9}', '\u{2014}', '\u{1F600}', '\u{1D400}']) {
      expect(isInvisible(character), JSON.stringify(character)).toBe(false);
    }
  });
});
