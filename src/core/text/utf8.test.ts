import { describe, expect, it } from 'vitest';
import { utf8Encode } from './utf8';

describe('utf8Encode', () => {
  it.each([
    ['empty', ''],
    ['ASCII', 'abc'],
    ['two bytes', 'é ß \u07FF'],
    ['three bytes', '€ \u0800 \uFFFF 中文'],
    ['four bytes', '😀 \uD800\uDC00 \uDBFF\uDFFF'],
    ['a lone high surrogate', 'a\uD800b'],
    ['a lone low surrogate', 'a\uDC00b'],
    ['a surrogate pair reversed', '\uDC00\uD800'],
    ['a high surrogate at the end', 'abc\uD83D'],
    ['mixed', 'Łódź — São Paulo 😀 \uFF35\uFF34'],
  ])('gives the same bytes as TextEncoder for %s', (_name, text) => {
    expect([...utf8Encode(text)]).toEqual([...new TextEncoder().encode(text)]);
    expect([...utf8Encode(text)]).toEqual([...Buffer.from(text, 'utf8')]);
  });

  it('encodes a lone surrogate as U+FFFD', () => {
    expect([...utf8Encode('\uD800')]).toEqual([0xef, 0xbf, 0xbd]);
  });
});
