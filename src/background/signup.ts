/*
 * jr6, Settings › Sign-up Information (the owner's words of 2026-11-10: "user can set and manage the password on
 * extension settings. if password is setted, user can't set signup auto"): the extension pages' messages over the
 * vault (signup-vault.ts), and Sign-in mode's guard.
 * - signup/status: whether a password is saved, its email and when; the email the box starts with when none is (the
 *   profile's, else the account's); whether "Import from TailorIT" is offered; (the jr6 review, R12) what the worker
 *   did by itself since the person last saved or deleted one (`notice`). Never the password.
 * - signup/save: the email and a new password that meets every rule (core/signup-password.ts, checked here again), or
 *   the email alone (the saved password kept under it).
 * - signup/delete: the password and its key go. Sign-in on Auto goes back to Manual (`reverted`), which the page says.
 * - signup/import ("Import from TailorIT", once: while none is saved here and the connection holds credentials:read):
 *   TailorIT's every-site sign-in (`*`), read with GET /api/autofill/credentials for SIGNUP_IMPORT_HOST, a candidate
 *   host no person saves a sign-in of their own for, so TailorIT answers its every-site one; saved here when its
 *   password meets the rules ('weak' otherwise: nothing saved, the person sets a new one here). TailorIT's own route and
 *   its saved sign-ins are left as they are.
 * - Sign-in mode's guard (coordinator decision 1 of jr6, an owner question: the owner's "if password is setted, user
 *   can't set signup auto" read as Auto needing a saved password): Auto is never stored without a password. A save of
 *   the settings that would hold Sign-in on Auto while none is saved is refused (index.ts, settings/save), and (the jr6
 *   review, sec-9) one that met a delete on its way is set back at once; deleting the password, one that can no longer
 *   be read, or a sign-in that finds none saved under Auto, sets it back to Manual (keepModeHonest), as does the
 *   worker's start-up for an install whose settings held Auto before jr6 (when the password was TailorIT's). The jr6
 *   review (R13): the change is applied onto the settings stored then (settings/save's M4 merge), so a save that lands
 *   meanwhile is kept. (R12): a change the person did not make here is said on the card (`notice`: storage.local
 *   SIGNUP_NOTICE_KEY, a word), until they next save, import or delete one.
 * These messages come from the extension's own pages alone: none is a sidebar's (background/senders.ts
 * SIDEBAR_PAGE_MESSAGES), whose page process hears what is typed into it.
 */
import { AUTOFILL_ANY_HOST } from '../contract/tailorit';
import { signupPasswordValid } from '../core/signup-password';
import type { Settings } from '../core/types/settings';
import { ok, refuse, type Answer } from '../messaging/envelope';
import { SIGNUP_NOTICES } from '../messaging/page-schemas';
import type { PageMessage, SignupNotice, SignupStatus } from '../messaging/schemas';
import type { StorageArea } from '../platform/types';
import { log } from '../shared/log';
import type { ServerClient } from './server-client';
import type { SettingsStore } from './settings';
import type { SignupVault } from './signup-vault';

/** The host "Import from TailorIT" asks TailorIT's sign-in route for (module header): a Workday tenant's form, which
 *  TailorIT's every-site sign-in covers, under a tenant name no company uses. TailorIT shows it as the host its
 *  every-site sign-in was last read for. */
export const SIGNUP_IMPORT_HOST = 'import.myworkdayjobs.com';
/** storage.local: what the card says the worker did by itself (SignupNotice, a word: module header). */
export const SIGNUP_NOTICE_KEY = 'signup:notice';

type SaveMessage = Extract<PageMessage, { type: 'signup/save' }>;

/** Why Sign-in is looked at for want of a password (keepModeHonest): the person's Delete (the card says so itself), a
 *  password that could no longer be read, the worker's start-up, a sign-in that found none, a save of Auto that met a
 *  delete. Each but the Delete is said on the card ('reverted') when it set Sign-in back. */
export type ModeCheck = 'deleted' | 'gone' | 'startup' | 'none' | 'save';

/** What the handlers need. */
export interface SignupDeps {
  vault: SignupVault;
  settings: Pick<SettingsStore, 'get' | 'save'>;
  /** storage.local, for the card's notice (SIGNUP_NOTICE_KEY). */
  local: StorageArea;
  /** TailorIT's sign-in route, for the one-time import. */
  server: Pick<ServerClient, 'credential'>;
  /** The connection's scopes now (none when not connected). */
  scopes(): Promise<readonly string[]>;
  /** The email the box starts with when none is saved: the profile's, else the account's; null when neither is read. */
  suggestedEmail(): Promise<string | null>;
  /** The password was saved or deleted (and `settings`: Sign-in went back to Manual): the frames hear their settings
   *  again, the panels read the status again. */
  changed(what: { settings: boolean }): Promise<void>;
}

export interface Signup {
  status(): Promise<Answer<SignupStatus>>;
  save(message: SaveMessage): Promise<Answer<SignupStatus>>;
  remove(): Promise<Answer<{ status: SignupStatus; reverted: boolean }>>;
  importFromTailorIT(): Promise<Answer<{ outcome: 'imported' | 'none' | 'weak'; status: SignupStatus }>>;
  /** Sign-in on Auto with no password saved goes back to Manual; answers whether it did (module header). */
  keepModeHonest(why: ModeCheck): Promise<boolean>;
  /** A sign-in found no password to use (background/sign-in.ts `missing`): a lost one is said on the card, and Sign-in
   *  goes back to Manual if it is on Auto. Answers whether it did. */
  passwordMissing(why: 'none' | 'gone'): Promise<boolean>;
}

/** Whether `next` would hold Sign-in on Auto (settings/save's guard: the caller checks for a saved password). */
export const holdsSignInAuto = (next: Settings): boolean => next.modes.signIn === 'auto';

export function createSignup(deps: SignupDeps): Signup {
  const { vault } = deps;

  /** The card's notice now (module header), or undefined. */
  async function noticeNow(): Promise<SignupNotice | undefined> {
    const held = await deps.local.get(SIGNUP_NOTICE_KEY).catch(() => undefined);
    return (SIGNUP_NOTICES as readonly unknown[]).includes(held) ? held as SignupNotice : undefined;
  }

  /** Says `notice` on the card from now on, or (null) nothing more. A 'gone' is never replaced by a 'reverted': it
   *  says why. */
  async function note(notice: SignupNotice | null): Promise<void> {
    try {
      if (notice === null) await deps.local.remove([SIGNUP_NOTICE_KEY]);
      else if (notice === 'gone' || (await noticeNow()) !== 'gone') await deps.local.set({ [SIGNUP_NOTICE_KEY]: notice });
    } catch {
      // A word on a card: the next read says nothing.
    }
  }

  async function statusNow(): Promise<SignupStatus> {
    const held = await vault.status();
    const scopes = await deps.scopes().catch(() => [] as readonly string[]);
    const suggested = held.set ? null : await deps.suggestedEmail().catch(() => null);
    const notice = await noticeNow();
    return { set: held.set, email: held.email, updatedAt: held.updatedAt,
      suggestedEmail: suggested === null || suggested === '' ? null : suggested.slice(0, 254),
      importable: !held.set && scopes.includes('credentials:read'), ...(notice === undefined ? {} : { notice }) };
  }

  async function keepModeHonest(why: ModeCheck): Promise<boolean> {
    const current = await deps.settings.get();
    if (current.modes.signIn !== 'auto' || (await vault.has())) return false;
    // The jr6 review (R13): Sign-in's change alone, applied onto the settings stored now (settings/save's M4 merge).
    await deps.settings.save({ ...current, modes: { ...current.modes, signIn: 'manual' } }, current);
    log('signup.mode-reverted', { check: ['deleted', 'gone', 'startup', 'none', 'save'].indexOf(why) });
    if (why !== 'deleted') await note('reverted');
    return true;
  }

  return {
    async status() {
      return ok(await statusNow());
    },
    async save(message) {
      const saved = await vault.save({ email: message.email,
        ...(message.password === undefined ? {} : { password: message.password }) });
      if (saved !== 'saved') return refuse('bad_message');
      await note(null);
      await deps.changed({ settings: false });
      return ok(await statusNow());
    },
    async remove() {
      await vault.remove();
      await note(null);
      const reverted = await keepModeHonest('deleted');
      await deps.changed({ settings: reverted });
      return ok({ status: await statusNow(), reverted });
    },
    async importFromTailorIT() {
      if ((await vault.has()) || !(await deps.scopes()).includes('credentials:read')) return refuse('unavailable');
      const answer = await deps.server.credential(SIGNUP_IMPORT_HOST);
      if (!answer.ok) {
        log('signup.imported', { found: false });
        if (answer.failure === 'not-found') return ok({ outcome: 'none' as const, status: await statusNow() });
        return refuse('unavailable');
      }
      // The every-site sign-in alone: one saved for the import's host itself is no person's.
      if (answer.value.host !== AUTOFILL_ANY_HOST) {
        log('signup.imported', { found: false, everySite: false });
        return ok({ outcome: 'none' as const, status: await statusNow() });
      }
      if (!signupPasswordValid(answer.value.password)) {
        log('signup.imported', { found: true, rules: false });
        return ok({ outcome: 'weak' as const, status: await statusNow() });
      }
      const saved = await vault.save({ email: answer.value.email, password: answer.value.password });
      log('signup.imported', { found: true, saved: saved === 'saved' });
      if (saved !== 'saved') return ok({ outcome: 'weak' as const, status: await statusNow() });
      await note(null);
      await deps.changed({ settings: false });
      return ok({ outcome: 'imported' as const, status: await statusNow() });
    },
    keepModeHonest,
    async passwordMissing(why) {
      if (why === 'gone') await note('gone');
      return keepModeHonest(why);
    },
  };
}
