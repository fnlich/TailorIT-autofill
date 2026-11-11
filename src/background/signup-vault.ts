/*
 * jr6, the job-site sign-up information (the owner's words of 2026-11-10: "Create Account (On Workday, or iCIMS), you
 * should store the password on localstorage on browser like jobright.ai. if needed, you should fetch this, and autofill
 * it. user can set and manage the password on extension settings"). One email and one password for the job sites' own
 * accounts, kept in this browser alone, encrypted:
 * - the key: AES-GCM, 256 bits, made once by the worker with extractable false (crypto.subtle.generateKey) and kept in
 *   the extension origin's IndexedDB (platform/indexed-db.ts, key `signup-key`), where no content script reaches; being
 *   not extractable, no script (the extension's included) can export its bytes: the browser encrypts and decrypts with
 *   it, nothing more;
 * - the record: storage.local `signup:v1` {v, iv, data, email, updatedAt}: a fresh 96-bit nonce per save, the
 *   ciphertext with its tag (its additional data names the record's purpose and version alone: the email is not bound
 *   to it, so an email changed alone needs no decryption), and the email and the time in the clear. storage.local is
 *   kept to the extension's trusted contexts (the worker restricts it at start-up; Chrome before 140 refuses that, and
 *   then a content script could write it), is never synced, and is never exported (the options page's export holds the
 *   counters alone). It is never inside the settings (`settings:v1`), never sent to TailorIT, never in a report, a
 *   RunState, a log line or any message but the one that types it (background/sign-in.ts).
 * - What this keeps the password from (the jr6 review, sec-7): other extensions, the job sites' pages and content
 *   scripts, sync, exports and a casual dump of the extension's storage. Not from someone who can read this browser's
 *   profile folder on this computer (local malware, a copy or backup of the profile, another account with access to its
 *   files): Chrome keeps the IndexedDB key's structured clone, raw bytes included, in that folder's LevelDB unencrypted
 *   beside storage.local's ciphertext, and LevelDB keeps old values until it compacts, so Delete is no wipe either. The
 *   settings card says so and suggests a password kept for job sites alone (ui/page/signup-copy.ts).
 * - Jobright 1.25.2 (read for behaviour only: its ~store/workday-signup-info) keeps the password as plain text in
 *   chrome.storage.local (`WORKDAY_SIGNUP_INFORMATION`: {password, updatedAt}) and the email on its own server. Here both
 *   stay in this browser and the password is never stored in the clear.
 * The password is decrypted in the worker alone (reveal), only when a sign-in or an account's creation is about to be
 * typed (sign-in.ts credential), and is held in that call's memory only, never kept: an email changed alone is written
 * over the record as it stands, its ciphertext untouched (coordinator decision 2 of jr6). A save takes a password that
 * meets every rule of core/signup-password.ts; none is ever logged, nor its length.
 */
import { z } from 'zod';
import { signupPasswordValid } from '../core/signup-password';
import type { SecretStore, StorageArea } from '../platform/types';
import { log } from '../shared/log';
import { fromBase64, toBase64 } from './bytes';
import { createKeyedQueue } from './locks';

/** storage.local: the record (module header). */
export const SIGNUP_RECORD_KEY = 'signup:v1';
/** The longest email a job site's account takes (TailorIT's cap on an email). */
export const SIGNUP_EMAIL_MAX = 254;
/** AES-GCM's nonce: 96 bits, fresh for every save. */
const IV_BYTES = 12;
/** Bound into every ciphertext (the encryption's additional data): what the record is, and its version. */
const AAD = new TextEncoder().encode('tailorit-signup:v1');

/** An email as a job site's account takes it. */
export const SignupEmailSchema = z.email().max(SIGNUP_EMAIL_MAX);

const RecordSchema = z.strictObject({
  v: z.literal(1),
  /** 12 bytes, base64 (16 characters, no padding). */
  iv: z.string().regex(/^[A-Za-z0-9+/]{16}$/),
  /** The ciphertext and its 16-byte tag, base64: at most 64 characters of password, so well under the cap. */
  data: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(400),
  email: SignupEmailSchema,
  updatedAt: z.number().int().nonnegative(),
});
type SignupRecord = z.infer<typeof RecordSchema>;

/** What the settings show of it: never the password. */
export interface SignupStatus {
  set: boolean;
  email: string | null;
  updatedAt: number | null;
}

/** The sign-up information decrypted (reveal), or why there is none: none saved; one saved that can never be read
 *  again (its key gone, or its ciphertext or nonce changed: it was removed); the key could not be read now (kept, tried
 *  again). */
export type Revealed = { ok: true; email: string; password: string } | { ok: false; why: 'none' | 'gone' | 'unreadable' };

/** A save: the email, and a new password (absent: the saved one is kept, under the new email, never decrypted). */
export interface SignupSave {
  email: string;
  password?: string;
}

/** Why a save was refused, or 'saved'. */
export type SignupSaved = 'saved' | 'invalid-email' | 'invalid-password' | 'no-password';

/** What the vault needs. */
export interface SignupVaultDeps {
  local: StorageArea;
  /** The extension origin's IndexedDB, key `signup-key` (platform/indexed-db.ts). */
  keys: SecretStore;
  subtle: SubtleCrypto;
  randomBytes(count: number): Uint8Array;
  now(): number;
}

export interface SignupVault {
  status(): Promise<SignupStatus>;
  /** Whether a password is saved (the record is there; reveal says whether it still reads). */
  has(): Promise<boolean>;
  save(input: SignupSave): Promise<SignupSaved>;
  /** Deletes the record and the key; answers whether a record was held. */
  remove(): Promise<boolean>;
  /** The email and the password, decrypted, for the one sign-in about to be typed (module header). */
  reveal(): Promise<Revealed>;
}

/** Whether `value` is the vault's key as made: AES-GCM, never extractable, for encrypting and decrypting. */
function isVaultKey(value: unknown): value is CryptoKey {
  return typeof CryptoKey !== 'undefined' && value instanceof CryptoKey && value.algorithm.name === 'AES-GCM'
    && value.extractable === false && value.usages.includes('encrypt') && value.usages.includes('decrypt');
}

const encoder = new TextEncoder();

export function createSignupVault(deps: SignupVaultDeps): SignupVault {
  const { local, keys, subtle } = deps;
  /** One write at a time (a save never interleaves a delete). */
  const writes = createKeyedQueue();

  async function record(): Promise<SignupRecord | null> {
    const parsed = RecordSchema.safeParse(await local.get(SIGNUP_RECORD_KEY));
    return parsed.success ? parsed.data : null;
  }

  /** The key, made and kept the first time it is needed (`make`). Null when there is none and none is to be made. */
  async function keyOf(make: boolean): Promise<CryptoKey | null> {
    const held = await keys.get();
    if (isVaultKey(held)) return held;
    if (!make) return null;
    const made = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await keys.set(made);
    log('signup.key-made');
    return made;
  }

  /** Decrypts the record as it is now (the caller holds the write queue or reads only). */
  async function open(held: SignupRecord): Promise<Revealed> {
    let key: CryptoKey | null;
    try {
      key = await keyOf(false);
    } catch {
      // IndexedDB did not answer: the record stays, and is read again next time.
      log('signup.unreadable', { key: false, kept: true });
      return { ok: false, why: 'unreadable' };
    }
    const iv = fromBase64(held.iv);
    const data = fromBase64(held.data);
    let plain: Uint8Array | null = null;
    if (key !== null && iv !== null && iv.length === IV_BYTES && data !== null) {
      try {
        plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer>,
          additionalData: AAD }, key, data as Uint8Array<ArrayBuffer>));
      } catch {
        plain = null;
      }
    }
    if (plain === null) {
      // Its key is gone (the browser's site data cleared) or its ciphertext was changed: it can never be read again.
      await local.remove([SIGNUP_RECORD_KEY]);
      log('signup.unreadable', { key: key !== null, kept: false });
      return { ok: false, why: 'gone' };
    }
    const password = new TextDecoder().decode(plain);
    plain.fill(0);
    return { ok: true, email: held.email, password };
  }

  return {
    async status() {
      const held = await record();
      return held === null ? { set: false, email: null, updatedAt: null }
        : { set: true, email: held.email, updatedAt: held.updatedAt };
    },
    async has() {
      return (await record()) !== null;
    },
    save(input) {
      return writes.run(SIGNUP_RECORD_KEY, async () => {
        if (!SignupEmailSchema.safeParse(input.email).success) {
          log('signup.refused', { email: false });
          return 'invalid-email';
        }
        const password = input.password;
        const before = await record();
        if (password === undefined) {
          // The email changed alone: the record as it stands, under the new email; nothing is decrypted.
          if (before === null) {
            log('signup.refused', { password: false });
            return 'no-password';
          }
          await local.set({ [SIGNUP_RECORD_KEY]: { ...before, email: input.email, updatedAt: deps.now() } });
          log('signup.saved', { replaced: true, emailAlone: true });
          return 'saved';
        }
        if (!signupPasswordValid(password)) {
          log('signup.refused', { rules: false });
          return 'invalid-password';
        }
        const key = await keyOf(true);
        if (key === null) throw new Error('no key');
        const iv = deps.randomBytes(IV_BYTES);
        const plain = encoder.encode(password);
        let data: Uint8Array;
        try {
          data = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer>,
            additionalData: AAD }, key, plain));
        } finally {
          plain.fill(0);
        }
        const next: SignupRecord = { v: 1, iv: toBase64(iv), data: toBase64(data), email: input.email,
          updatedAt: deps.now() };
        await local.set({ [SIGNUP_RECORD_KEY]: next });
        log('signup.saved', { replaced: before !== null });
        return 'saved';
      });
    },
    remove() {
      return writes.run(SIGNUP_RECORD_KEY, async () => {
        const held = (await local.get(SIGNUP_RECORD_KEY)) !== undefined;
        await local.remove([SIGNUP_RECORD_KEY]);
        // The key goes with it: the next save makes a new one.
        await keys.clear().catch(() => undefined);
        log('signup.removed', { held });
        return held;
      });
    },
    reveal() {
      return writes.run(SIGNUP_RECORD_KEY, async () => {
        const held = await record();
        if (held === null) return { ok: false, why: 'none' } as const;
        return open(held);
      });
    },
  };
}
