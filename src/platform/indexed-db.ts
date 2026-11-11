/*
 * The extension origin's IndexedDB (database `tailorit`, store `secrets`): one value per key. A content script runs
 * under the page's origin, so it can never open this database; only the worker and the extension's pages can.
 * - `auth`: the bearer token (background/auth.ts reads what comes out);
 * - jr6 (the owner's words of 2026-11-10: the job-site password kept in the browser "like jobright.ai"), `signup-key`:
 *   the AES-GCM key the job-site password is encrypted with (background/signup-vault.ts). It is a CryptoKey made with
 *   extractable false, which IndexedDB stores as it is (a structured clone): its bytes can be read by nothing, not even
 *   the extension, which can only ask the browser to encrypt and decrypt with it.
 * Apart from platform/chrome.ts, so the dom tests can open the real database (no `browser` import here).
 */
import type { SecretStore } from './types';

const SECRETS_DB = 'tailorit';
const SECRETS_STORE = 'secrets';

/** The keys of the store, each its own value. */
export type SecretKey = 'auth' | 'signup-key';

function openSecrets(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SECRETS_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(SECRETS_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexeddb-open-failed'));
    request.onblocked = () => reject(new Error('indexeddb-blocked'));
  });
}

async function inSecrets<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openSecrets();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(SECRETS_STORE, mode);
      const request = run(transaction.objectStore(SECRETS_STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? new Error('indexeddb-failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('indexeddb-aborted'));
    });
  } finally {
    db.close();
  }
}

/** One key of the store, read, written and deleted. */
export function indexedDbSecret(key: SecretKey): SecretStore {
  return {
    get: () => inSecrets<unknown>('readonly', (store) => store.get(key)),
    async set(value) {
      await inSecrets('readwrite', (store) => store.put(value, key));
    },
    async clear() {
      await inSecrets('readwrite', (store) => store.delete(key));
    },
  };
}
