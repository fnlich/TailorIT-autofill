/*
 * jr6: the job-site sign-up information a spec saves, as Settings › Sign-up Information does (signup/save, from the
 * extension's own page), and takes away again (signup/delete), so the next spec of the worker starts with none: the
 * vault lives in the context's storage and IndexedDB, which the specs of one Playwright worker share.
 * The synthetic account pages (fixtures/synthetic/signin/*.html, fixtures/synthetic/workday/account.html) check what
 * is typed against these dummies; the password meets the rules (src/core/signup-password.ts), as every saved one must.
 */
import type { Extension } from './extension.ts';

/** The dummies the synthetic account pages expect. */
export const SIGNUP_DUMMY = { email: 'alex.rivera@example.com', password: 'E2e-Dummy-Signup-Pass-2026!' } as const;

/** Saves the dummies as the person's Sign-up Information. */
export async function savePassword(ext: Extension): Promise<void> {
  await ext.data({ v: 1, type: 'signup/save', email: SIGNUP_DUMMY.email, password: SIGNUP_DUMMY.password });
}

/** Deletes whatever Sign-up Information is saved (none is fine). */
export async function deletePassword(ext: Extension): Promise<void> {
  await ext.send({ v: 1, type: 'signup/delete' });
}
