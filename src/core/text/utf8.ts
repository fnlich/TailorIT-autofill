/*
 * A UTF-8 encoder for the pure core, which has no TextEncoder (its type program has no DOM library and its lint bans
 * the global). It gives the same bytes as TextEncoder: a lone surrogate becomes U+FFFD.
 */

/** The UTF-8 bytes of `text`. */
export function utf8Encode(text: string): Uint8Array {
  // At most 3 bytes per UTF-16 unit: a surrogate pair is 2 units and 4 bytes.
  const out = new Uint8Array(text.length * 3);
  let length = 0;
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      code = 0x10000 + ((code - 0xd800) << 10) + (text.charCodeAt(i + 1) - 0xdc00);
      i += 1;
      out[length++] = 0xf0 | (code >> 18);
      out[length++] = 0x80 | ((code >> 12) & 0x3f);
      out[length++] = 0x80 | ((code >> 6) & 0x3f);
      out[length++] = 0x80 | (code & 0x3f);
      continue;
    }
    if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) {
      out[length++] = code;
    } else if (code < 0x800) {
      out[length++] = 0xc0 | (code >> 6);
      out[length++] = 0x80 | (code & 0x3f);
    } else {
      out[length++] = 0xe0 | (code >> 12);
      out[length++] = 0x80 | ((code >> 6) & 0x3f);
      out[length++] = 0x80 | (code & 0x3f);
    }
  }
  return out.slice(0, length);
}
