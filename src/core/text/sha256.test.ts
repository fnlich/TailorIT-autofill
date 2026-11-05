import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bytesToHex, hmacSha256Hex, sha256Bytes, sha256Hex } from './sha256';

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
    ['three-byte text', '中文 € \uFF35\uFF34\u3000\uFF21\uFF55\uFF53\uFF54\uFF49\uFF4E'],
    ['astral characters', '😀👩\u200D💻 \u{1D400}'],
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

describe('hmacSha256: the RFC 4231 vectors and node:crypto', () => {
  const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((pair) => parseInt(pair, 16)));

  it.each([
    ['test case 1', '0b'.repeat(20), 'Hi There', 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'],
    ['test case 2 (a short key)', '4a656665', 'what do ya want for nothing?',
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843'],
    ['test case 6 (a key longer than a block)', 'aa'.repeat(131),
      'Test Using Larger Than Block-Size Key - Hash Key First',
      '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54'],
  ])('%s', (_name, key, text, mac) => {
    expect(hmacSha256Hex(bytes(key), text)).toBe(mac);
  });

  it.each([
    ['an empty text', ''],
    ['a separator', 'n:typescript\u001fx'],
    ['multi-byte text', 'São Paulo 中文 😀'],
    ['a text of two blocks', 'y'.repeat(130)],
  ])('agrees with node:crypto on %s', (_name, text) => {
    const key = Uint8Array.from({ length: 32 }, (_, i) => (i * 53 + 11) & 0xff);
    expect(hmacSha256Hex(key, text)).toBe(createHmac('sha256', key).update(text).digest('hex'));
  });
});
