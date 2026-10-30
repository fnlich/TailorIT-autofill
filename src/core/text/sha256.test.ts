import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bytesToHex, sha256Bytes, sha256Hex } from './sha256';

const nodeSha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

describe('sha256: the NIST vectors (FIPS 180-4 examples)', () => {
  it.each([
    ['the empty string', '', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['"abc"', 'abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['the 448-bit message', 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
    ['the 896-bit message',
      'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
      'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1'],
    ['one million "a"', 'a'.repeat(1_000_000), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'],
  ])('hashes %s', (_name, text, digest) => {
    expect(sha256Hex(text)).toBe(digest);
  });
});

describe('sha256 against node:crypto', () => {
  it.each([
    ['two-byte letters', 'Łódź, Straße, São Paulo'],
    ['three-byte text', '中文 € ＵＴ\u3000Ａｕｓｔｉｎ'],
    ['astral characters', '😀👩\u200D💻 𝐀'],
    ['a lone surrogate', 'a\uD800b'],
    ['a separator', 'no\u001fyes'],
    ['a long multi-byte text', 'é😀中'.repeat(5000)],
  ])('hashes %s over UTF-8', (_name, text) => {
    expect(sha256Hex(text)).toBe(nodeSha256(text));
  });

  it('hashes every length around the block boundaries', () => {
    for (let length = 0; length <= 130; length += 1) {
      expect(sha256Hex('x'.repeat(length)), String(length)).toBe(nodeSha256('x'.repeat(length)));
    }
  });

  it('hashes raw bytes', () => {
    const bytes = Uint8Array.from({ length: 1000 }, (_, i) => (i * 31 + 7) & 0xff);
    expect(bytesToHex(sha256Bytes(bytes))).toBe(nodeSha256(bytes));
    expect(sha256Bytes(bytes)).toHaveLength(32);
  });

  it('writes lower-case hex', () => {
    expect(bytesToHex(Uint8Array.from([0, 1, 0xab, 0xff]))).toBe('0001abff');
  });
});
