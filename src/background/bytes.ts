/*
 * Byte helpers for the worker: base64 for the resume's chunks, base64url for the random ids it mints (pairing states
 * and run ids), and the file signatures it checks before handing a resume over.
 */

/** Standard base64 with padding, as the content script's decoder expects. Built in slices, so a 256 KiB chunk never
 *  becomes one oversized argument list. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 8192) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  }
  return btoa(binary);
}

/** jr6: standard base64 back to bytes (the job-site password's ciphertext and nonce, signup-vault.ts); null for text
 *  that is no base64. */
export function fromBase64(text: string): Uint8Array | null {
  try {
    const binary = atob(text);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

/** base64url without padding: 32 bytes become 43 characters, 16 bytes 22. */
export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Whether `bytes` begins with `prefix`. */
export function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);
}

/** "%PDF-": every PDF begins with it. */
export const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;
/** "PK\x03\x04": a ZIP's local file header, which every DOCX begins with. */
export const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04] as const;
