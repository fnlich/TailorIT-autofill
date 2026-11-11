/*
 * jr6: the job-site password vault over the browser's own IndexedDB (platform/indexed-db.ts, key `signup-key`) and
 * WebCrypto, as the worker runs it: the key goes into the database as a CryptoKey, comes back out as one, still not
 * extractable (exportKey refuses it), and decrypts what it encrypted; the record holds no password.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { indexedDbSecret } from '../platform/indexed-db';
import type { StorageArea } from '../platform/types';
import { createSignupVault, SIGNUP_RECORD_KEY } from './signup-vault';

const PASSWORD = 'Synthetic-Browser-Pass-2026!kQ4#';
const EMAIL = 'alex.rivera@example.com';

const keys = indexedDbSecret('signup-key');
afterEach(async () => {
  await keys.clear();
});

function memoryArea(): StorageArea & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async (key) => data.get(key),
    getMany: async () => ({}),
    async set(entries) {
      for (const [key, value] of Object.entries(entries)) data.set(key, structuredClone(value));
    },
    async remove(names) {
      for (const key of names) data.delete(key);
    },
    async restrictToTrustedContexts() {},
  };
}

describe('the job-site password vault over IndexedDB', () => {
  it('keeps a non-extractable key in IndexedDB that decrypts what it encrypted', async () => {
    const local = memoryArea();
    const vault = createSignupVault({ local, keys, subtle: crypto.subtle,
      randomBytes: (count) => crypto.getRandomValues(new Uint8Array(count)), now: () => 1_000 });
    expect(await vault.save({ email: EMAIL, password: PASSWORD })).toBe('saved');

    const stored = await keys.get();
    expect(stored).toBeInstanceOf(CryptoKey);
    const key = stored as CryptoKey;
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    for (const format of ['raw', 'jwk'] as const) {
      await expect(crypto.subtle.exportKey(format, key), format).rejects.toThrow();
    }
    expect(JSON.stringify([...local.data])).not.toContain(PASSWORD);
    expect(local.data.has(SIGNUP_RECORD_KEY)).toBe(true);

    // A new worker (a fresh vault over the same database) reads it back.
    const again = createSignupVault({ local, keys, subtle: crypto.subtle,
      randomBytes: (count) => crypto.getRandomValues(new Uint8Array(count)), now: () => 2_000 });
    expect(await again.reveal()).toEqual({ ok: true, email: EMAIL, password: PASSWORD });

    expect(await again.remove()).toBe(true);
    expect(await keys.get()).toBeUndefined();
  });
});
