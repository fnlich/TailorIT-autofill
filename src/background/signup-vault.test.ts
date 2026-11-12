/*
 * jr6: the job-site sign-up information's vault (signup-vault.ts) on its own, with the browser's real WebCrypto (Node's
 * crypto.subtle) and its key kept as IndexedDB keeps one (a structured clone: platform/memory.ts createMemoryKeyStore;
 * the real database: signup-vault.browser.test.ts):
 * - the round trip: saved, then read back; the record holds no password, a fresh nonce each save;
 * - the key: AES-GCM 256, extractable false, its bytes refused to exportKey in every format; a planted extractable key
 *   is never used;
 * - a record whose ciphertext or nonce was changed, or whose key is gone, can never be read: it is removed; IndexedDB
 *   not answering keeps it;
 * - the rules: a password that misses one, or an email that is none, is never saved; an email changed alone keeps the
 *   password, and decrypts nothing (decrypting is for a fill alone);
 * - delete takes the record and the key;
 * - no log line ever holds the password, the email, or the password's length.
 * - jr6 ifix SEC-1 (the jr6 integration review's SEC-1): reveal(rules) refuses a password the page's own rules break
 *   (its boxes' maxlength, its minimum) before it decrypts anything, at the exact edges; takes what every saved password
 *   meets (the classes, "not the login" with an email); and leaves a changed ciphertext to the decryption ('gone').
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { SIGN_IN_PASSWORD_CLASSES } from '../messaging/schemas';
import { createMemoryKeyStore } from '../platform/memory';
import type { SecretStore, StorageArea } from '../platform/types';
import { createSignupVault, SIGNUP_RECORD_KEY } from './signup-vault';

/** A synthetic password that meets every rule, of an unusual length (37) a log line's numbers can be checked for. */
const PASSWORD = 'Synthetic-Vault-Pass-2026!xQ7#mW3$kL9';
const EMAIL = 'alex.rivera@example.com';

let logs: MockInstance;
beforeEach(() => {
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => logs.mockRestore());

function memoryArea(): StorageArea & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async (key) => (data.has(key) ? structuredClone(data.get(key)) : undefined),
    getMany: async (prefix) => Object.fromEntries([...data].filter(([key]) => key.startsWith(prefix))),
    async set(entries) {
      for (const [key, value] of Object.entries(entries)) data.set(key, structuredClone(value));
    },
    async remove(keys) {
      for (const key of keys) data.delete(key);
    },
    async restrictToTrustedContexts() {},
  };
}

function vaultOver(keys: SecretStore = createMemoryKeyStore(), local = memoryArea()) {
  let clock = 1_000;
  const vault = createSignupVault({ local, keys, subtle: globalThis.crypto.subtle,
    randomBytes: (count) => globalThis.crypto.getRandomValues(new Uint8Array(count)), now: () => (clock += 1) });
  return { vault, local, keys };
}

/** Every value a log line carried, as text, and its numbers. */
function logged(): { text: string; numbers: number[] } {
  const text = JSON.stringify(logs.mock.calls);
  const numbers = logs.mock.calls.flatMap((call) => Object.values((call[1] ?? {}) as Record<string, unknown>))
    .filter((value): value is number => typeof value === 'number');
  return { text, numbers };
}

describe('the job-site password vault', () => {
  it('saves and reads back the email and the password, and stores no password', async () => {
    const { vault, local } = vaultOver();
    expect(await vault.status()).toEqual({ set: false, email: null, updatedAt: null });
    expect(await vault.save({ email: EMAIL, password: PASSWORD })).toBe('saved');
    expect(await vault.status()).toMatchObject({ set: true, email: EMAIL });
    expect(await vault.reveal()).toEqual({ ok: true, email: EMAIL, password: PASSWORD });
    const stored = JSON.stringify([...local.data]);
    expect(stored).not.toContain(PASSWORD);
    expect(stored).not.toContain(Buffer.from(PASSWORD).toString('base64'));
    expect(Object.keys(local.data.get(SIGNUP_RECORD_KEY) as object).sort()).toEqual(['data', 'email', 'iv', 'updatedAt', 'v']);
    // Nothing of it inside the settings.
    expect([...local.data.keys()]).toEqual([SIGNUP_RECORD_KEY]);
  });

  it('encrypts with a fresh nonce each save', async () => {
    const { vault, local } = vaultOver();
    await vault.save({ email: EMAIL, password: PASSWORD });
    const first = local.data.get(SIGNUP_RECORD_KEY) as { iv: string; data: string };
    await vault.save({ email: EMAIL, password: PASSWORD });
    const second = local.data.get(SIGNUP_RECORD_KEY) as { iv: string; data: string };
    expect(second.iv).not.toBe(first.iv);
    expect(second.data).not.toBe(first.data);
    expect(await vault.reveal()).toMatchObject({ ok: true, password: PASSWORD });
  });

  it('keeps a non-extractable AES-GCM 256 key: exportKey refuses it in every format', async () => {
    const keys = createMemoryKeyStore();
    const { vault } = vaultOver(keys);
    await vault.save({ email: EMAIL, password: PASSWORD });
    const key = keys.value as CryptoKey;
    expect(key).toBeInstanceOf(CryptoKey);
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toEqual({ name: 'AES-GCM', length: 256 });
    expect([...key.usages].sort()).toEqual(['decrypt', 'encrypt']);
    for (const format of ['raw', 'jwk', 'pkcs8', 'spki'] as const) {
      await expect(globalThis.crypto.subtle.exportKey(format, key), format).rejects.toThrow();
    }
    // The key read back from the store (a structured clone, as IndexedDB answers) is just as closed.
    const again = (await keys.get()) as CryptoKey;
    expect(again.extractable).toBe(false);
    await expect(globalThis.crypto.subtle.exportKey('raw', again)).rejects.toThrow();
  });

  it('never uses an extractable key it finds: it makes its own', async () => {
    const keys = createMemoryKeyStore();
    const planted = await globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    await keys.set(planted);
    const { vault } = vaultOver(keys);
    expect(await vault.save({ email: EMAIL, password: PASSWORD })).toBe('saved');
    expect((keys.value as CryptoKey).extractable).toBe(false);
    expect(await vault.reveal()).toMatchObject({ ok: true, password: PASSWORD });
  });

  it('removes a record whose ciphertext or nonce was changed, or whose key is gone: it can never be read', async () => {
    for (const change of ['data', 'iv', 'key'] as const) {
      const { vault, local, keys } = vaultOver();
      await vault.save({ email: EMAIL, password: PASSWORD });
      const held = local.data.get(SIGNUP_RECORD_KEY) as Record<string, string>;
      if (change === 'data') local.data.set(SIGNUP_RECORD_KEY, { ...held, data: `A${held.data!.slice(1)}` === held.data
        ? `B${held.data!.slice(1)}` : `A${held.data!.slice(1)}` });
      if (change === 'iv') local.data.set(SIGNUP_RECORD_KEY, { ...held, iv: 'AAAAAAAAAAAAAAAA' });
      if (change === 'key') await keys.clear();
      expect(await vault.reveal(), change).toEqual({ ok: false, why: 'gone' });
      expect(await vault.has(), change).toBe(false);
    }
  });

  it('keeps the record when IndexedDB does not answer, and reads it once it does', async () => {
    const real = createMemoryKeyStore();
    let failing = false;
    const keys: SecretStore = { get: async () => {
      if (failing) throw new Error('blocked');
      return real.get();
    }, set: (value) => real.set(value), clear: () => real.clear() };
    const { vault } = vaultOver(keys);
    await vault.save({ email: EMAIL, password: PASSWORD });
    failing = true;
    expect(await vault.reveal()).toEqual({ ok: false, why: 'unreadable' });
    expect(await vault.has()).toBe(true);
    failing = false;
    expect(await vault.reveal()).toMatchObject({ ok: true, password: PASSWORD });
  });

  it('saves only a password that meets every rule, and only a real email', async () => {
    const { vault, local } = vaultOver();
    for (const weak of ['short1!A', 'nouppercase-1234567', 'NOLOWERCASE-1234567', 'NoDigits-Anywhere-x', 'NoSpecials1234567x',
      'Has space 1234567!x', 'Has"quote1234567!x']) {
      expect(await vault.save({ email: EMAIL, password: weak }), weak).toBe('invalid-password');
    }
    expect(await vault.save({ email: 'not an email', password: PASSWORD })).toBe('invalid-email');
    expect(await vault.save({ email: EMAIL })).toBe('no-password');
    expect(local.data.size).toBe(0);
  });

  it('keeps the saved password when the email alone changes, decrypting nothing to do so', async () => {
    let decrypts = 0;
    const subtle = globalThis.crypto.subtle;
    const counting = new Proxy(subtle, { get: (target, name) => name === 'decrypt'
      ? (...args: Parameters<SubtleCrypto['decrypt']>) => {
        decrypts += 1;
        return target.decrypt(...args);
      } : (Reflect.get(target, name) as (...args: unknown[]) => unknown).bind(target) });
    const local = memoryArea();
    const vault = createSignupVault({ local, keys: createMemoryKeyStore(), subtle: counting,
      randomBytes: (count) => globalThis.crypto.getRandomValues(new Uint8Array(count)), now: () => 2_000 });
    await vault.save({ email: EMAIL, password: PASSWORD });
    const before = local.data.get(SIGNUP_RECORD_KEY) as Record<string, string>;
    expect(await vault.save({ email: 'alex.r@example.org' })).toBe('saved');
    expect(decrypts).toBe(0);
    const after = local.data.get(SIGNUP_RECORD_KEY) as Record<string, string>;
    expect([after.iv, after.data, after.email]).toEqual([before.iv, before.data, 'alex.r@example.org']);
    expect(await vault.reveal()).toEqual({ ok: true, email: 'alex.r@example.org', password: PASSWORD });
    expect(decrypts).toBe(1);
  });

  it('deletes the record and its key', async () => {
    const { vault, local, keys } = vaultOver();
    await vault.save({ email: EMAIL, password: PASSWORD });
    expect(await vault.remove()).toBe(true);
    expect(local.data.size).toBe(0);
    expect(await keys.get()).toBeUndefined();
    expect(await vault.reveal()).toEqual({ ok: false, why: 'none' });
    expect(await vault.remove()).toBe(false);
    // A new save makes a new key.
    expect(await vault.save({ email: EMAIL, password: PASSWORD })).toBe('saved');
    expect(await vault.reveal()).toMatchObject({ ok: true, password: PASSWORD });
  });

  it('logs no password, no email and no password length', async () => {
    const { vault, local } = vaultOver();
    await vault.save({ email: EMAIL, password: PASSWORD });
    await vault.reveal();
    await vault.save({ email: EMAIL, password: 'weak' });
    await vault.save({ email: 'alex.r@example.org' });
    const held = local.data.get(SIGNUP_RECORD_KEY) as Record<string, string>;
    local.data.set(SIGNUP_RECORD_KEY, { ...held, iv: 'AAAAAAAAAAAAAAAA' });
    await vault.reveal();
    await vault.remove();
    const { text, numbers } = logged();
    expect(logs.mock.calls.length).toBeGreaterThan(3);
    for (const secret of [PASSWORD, EMAIL, 'alex.r@example.org', 'example']) expect(text).not.toContain(secret);
    expect(numbers).not.toContain(PASSWORD.length);
  });
});

// ── jr6 ifix SEC-1 (the jr6 integration review's SEC-1) ──
describe('reveal(rules): the page’s own rules, checked before anything is decrypted (jr6 ifix SEC-1)', () => {
  /** The vault over a WebCrypto whose every decryption is counted. */
  function counted() {
    let decrypted = 0;
    const subtle = globalThis.crypto.subtle;
    const counting = new Proxy(subtle, { get(target, key) {
      if (key === 'decrypt') {
        return (...args: Parameters<SubtleCrypto['decrypt']>) => {
          decrypted += 1;
          return target.decrypt(...args);
        };
      }
      const value = Reflect.get(target, key) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    } });
    const local = memoryArea();
    const vault = createSignupVault({ local, keys: createMemoryKeyStore(), subtle: counting,
      randomBytes: (count) => globalThis.crypto.getRandomValues(new Uint8Array(count)), now: () => 1 });
    return { vault, local, decrypted: () => decrypted };
  }

  it('refuses at the exact edges of the page’s numbers, decrypting nothing for a refusal', async () => {
    const { vault, decrypted } = counted();
    await vault.save({ email: EMAIL, password: PASSWORD });
    const n = PASSWORD.length;
    expect(await vault.reveal({ maxLength: n - 1 })).toEqual({ ok: false, why: 'refused', refused: { refused: 'fits' } });
    expect(await vault.reveal({ minLength: n + 1 }))
      .toEqual({ ok: false, why: 'refused', refused: { refused: 'rules', rule: 'length' } });
    // The boxes' maxlength is checked first, as the frame checks it.
    expect(await vault.reveal({ minLength: n + 1, maxLength: n - 1 }))
      .toEqual({ ok: false, why: 'refused', refused: { refused: 'fits' } });
    expect(decrypted()).toBe(0);
    expect(await vault.reveal({ maxLength: n, minLength: n })).toEqual({ ok: true, email: EMAIL, password: PASSWORD });
    expect(decrypted()).toBe(1);
  });

  it('takes every class a page may list and "not the login" with an email the vault takes', async () => {
    const { vault } = counted();
    await vault.save({ email: EMAIL, password: PASSWORD });
    expect(await vault.reveal({ requires: [...SIGN_IN_PASSWORD_CLASSES], notLogin: true, minLength: 8 }))
      .toEqual({ ok: true, email: EMAIL, password: PASSWORD });
    // An email of the password's very length: its dot is no character a saved password holds, so it is not the login.
    const sameLength = `${'a'.repeat(PASSWORD.length - '@example.com'.length)}@example.com`;
    expect(sameLength).toHaveLength(PASSWORD.length);
    await vault.save({ email: sameLength });
    expect(await vault.reveal({ notLogin: true })).toEqual({ ok: true, email: sameLength, password: PASSWORD });
  });

  it('none saved is none, rules or not; a ciphertext no save could have written is left to the decryption', async () => {
    const { vault, local } = counted();
    expect(await vault.reveal({ minLength: 99 })).toEqual({ ok: false, why: 'none' });
    await vault.save({ email: EMAIL, password: PASSWORD });
    const held = local.data.get(SIGNUP_RECORD_KEY) as Record<string, string>;
    // Cut to 8 bytes: shorter than any saved password's ciphertext, so its length says nothing: decrypted, found changed.
    local.data.set(SIGNUP_RECORD_KEY, { ...held, data: 'AAAAAAAAAAA=' });
    expect(await vault.reveal({ minLength: 64 })).toEqual({ ok: false, why: 'gone' });
  });

  it('logs nothing of a refusal: no password, email or length', async () => {
    const { vault } = counted();
    await vault.save({ email: EMAIL, password: PASSWORD });
    logs.mockClear();
    await vault.reveal({ maxLength: 20 });
    await vault.reveal({ minLength: 60 });
    const { text, numbers } = logged();
    for (const secret of [PASSWORD, EMAIL]) expect(text).not.toContain(secret);
    expect(numbers).not.toContain(PASSWORD.length);
  });
});
// ── end jr6 ifix SEC-1 ──
