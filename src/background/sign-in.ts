/*
 * Sign-in mode Auto, the worker's side (v3 Phase 5; docs/SPEC-AMENDMENTS.md §12 Decision 10; docs/PRIVACY.md
 * "Sign-in Auto"). A run that paused at a job site's sign-in or create-account page, in a tab's top frame, asks for the
 * person's job-site sign-in (signin/credential {wall}).
 * jr6 (the owner's words of 2026-11-10: "store the password on localstorage on browser like jobright.ai. if needed, you
 * should fetch this, and autofill it"): the sign-in is the one the person saved in this browser's Sign-up Information
 * (background/signup-vault.ts: one email and one password for every job site, the password encrypted), never TailorIT's:
 * nothing is asked of TailorIT here any more (its credentials:read route stays for the settings' one-time import). It is
 * the every-site sign-in (`*`), taken only where that one ever was. The worker answers only when:
 * - Sign-in acts now (signInAct): the person acknowledged the disclosure as it reads now, and then either Sign-in acts
 *   as Auto (the person's choice, or the tab's Sign up & Autofill grant for the sender's origin: background/sign-up.ts,
 *   the v4 review's M1), whose answer says `press` (the form's own button is pressed), or Sign-in is on Manual, whose
 *   answer is typed alone (`press` false: the person presses);
 * - the frame is a tab's top frame, or (the snapshot build of 2026-11-06, core-x item 3) the tab's claim frame: the one
 *   subframe that draws a company wrapper's application, directly below it, on its origin, at its application
 *   (frames.ts claimFrameOf: an iCIMS portal's iframe#icims_content_iframe); in no private (incognito) tab, at an https
 *   address Chrome reports (the sender's, never a payload's);
 * - the page is one the every-site sign-in covers (signInHostCovered: a Workday tenant's, an iCIMS portal's, Taleo's,
 *   SuccessFactors', Oracle's, SmartRecruiters', UltiPro's, and (TailorIT's API 6) ADP Workforce Now's and
 *   ClearCompany's by their candidate paths alone, the frame's path being the pathname of Chrome's address for it, never
 *   anything the message says), and never a company's own page the worker injected (v3 Phase 8, reach 'site': the
 *   Phase 8 review's P6);
 * - a password is saved and reads (the vault decrypts it for this answer alone). None saved: under Auto 'not_found' (the
 *   v4 review's M5: the page's toast then says to set one in Sign-up Information), on Manual 'unavailable' (the person
 *   signs in); either way Sign-in Auto, which needs one, is set back to Manual if it is on (`missing`: the jr6 review's
 *   sec-9, a save of Auto that met a delete).
 * The jr6 review (R1): `press` is limited, the typing is not. The tab is pressed for one host's wall at most once within
 * SIGN_IN_ONCE_MS: a password the site did not take is never pressed again by itself (no retry loop, whatever page the
 * site shows next); an Auto ask in that time is answered for the person to press (`press` false), never refused, so
 * the saved password can still be typed there (the owner's "if needed, you should fetch this, and autofill it"), but in
 * the auto-apply agent's tab (SignInAct 'agent', the review's sec-3), where nobody is there to press it: refused
 * (`expired`) as before. An ask the frame says it never presses (`typing`: a form's account section, a run on Manual)
 * is answered `press` false and neither meets nor sets the limit.
 * The answer to that frame's message is the one place the password goes: it is held in this function's memory only
 * until the answer is sent, never stored, logged, cached, put in a report or sent anywhere else, and the frame types it
 * into the page's password field only (src/content/sign-in.ts). At an email gate (v3 Phase 7b: wall 'email-gate', the
 * email-first identity step of Oracle Recruiting Cloud) the answer carries the email alone, never the password, and
 * (the jr6 review, R8) nothing is decrypted for it: the email is read from the record, where it is kept in the clear.
 * Logs say whether one was found, never a host, an email or a password.
 * jr6 SHELL-A (BUILD D-d; FIXPLAN §6.12 item 6, APPLYPLAN G): an email gate is answered in every Sign-in mode with the
 * email saved in Sign-up Information, else the TailorIT profile's contact email (profileEmail), never a password and
 * nothing decrypted; `press` only under Auto (the person's, or Sign up & Autofill), as for any wall.
 */
import { AUTOFILL_ANY_HOST, AUTOFILL_SIGN_IN_LIMITS, HostNameSchema, signInHostCovered } from '../contract/tailorit';
import { ok, refuse, type Answer } from '../messaging/envelope';
import type { ContentMessage, SignInCredential } from '../messaging/schemas';
import type { StorageArea } from '../platform/types';
import { sha256Hex } from '../core/text/sha256';
import { log } from '../shared/log';
import type { FrameEntry } from './frames';
import type { ContentChannel } from './router';
import type { SignupVault } from './signup-vault';

/** A tab is answered one host's sign-in for one wall to press at most once this long (no retry loop; the jr6 review's
 *  R1: typed for the person to press after it). */
export const SIGN_IN_ONCE_MS = 10 * 60_000;
/** storage.session `signin-tried:<tabId>|<wall>|<host hash>`: when the tab was last answered for a press (a time; the
 *  host as the first 16 hex digits of its SHA-256, never the host). */
export const SIGN_IN_TRIED_PREFIX = 'signin-tried:';

type CredentialMessage = Extract<ContentMessage, { type: 'signin/credential' }>;

/** How Sign-in acts now for a frame (module header): 'auto' (typed and pressed), 'type' (Manual: typed, the press the
 *  person's), or null (not at all: the disclosure as it reads now not acknowledged). The jr6 review (sec-3): 'agent',
 *  Auto in the auto-apply agent's tab, where nobody is there to press what would be typed for them: a wall it pressed
 *  already is refused as before (`expired`), never typed for a person (R1's typing is the person's tabs' alone). */
export type SignInAct = 'auto' | 'agent' | 'type' | null;

/** What the sign-in needs. */
export interface SignInDeps {
  /** jr6: the sign-up information saved in this browser (signup-vault.ts): decrypted (reveal) for a sign-in or an
   *  account's creation alone; an email gate reads its email from the record (status), never decrypted. */
  vault: Pick<SignupVault, 'reveal' | 'status'>;
  session: StorageArea;
  now(): number;
  /** How Sign-in acts now for a frame of the tab on `origin` (SignInAct): the person's Auto, or v4's Sign up & Autofill
   *  grant for that tab given for that origin (the v4 review, M1), is 'auto'. */
  signInAct(tabId: number, origin: string): Promise<SignInAct>;
  /** core-x, item 3: the tab's claim frame (frames.ts claimFrameOf), or null; absent: only a top frame is answered. */
  claimFrame?(tabId: number): Promise<Pick<FrameEntry, 'frameId' | 'documentId'> | null>;
  /** jr6: no saved password to use: none is saved (`none`), or the saved one can never be read again (`gone`: its key
   *  went, and the vault removed it). Sign-in Auto, which needs one, goes back to Manual (index.ts). */
  missing?(why: 'none' | 'gone'): Promise<void>;
  /** jr6 SHELL-A (BUILD D-d): the TailorIT profile's contact email (index.ts: the profile cache's), or null: an email
   *  gate's email where none is saved in Sign-up Information. Never a password. */
  profileEmail?(): Promise<string | null>;
}

/** The frame's host name and (TailorIT's API 6, contract6) its path, the pathname alone (no query, no fragment), when
 *  its address is https; null otherwise. */
function httpsPageOf(url: string): { host: string; path: string } | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? { host: parsed.hostname.toLowerCase(), path: parsed.pathname } : null;
  } catch {
    return null;
  }
}

/** jr6 SHELL-A (BUILD D-d): a profile's contact email an email gate may be answered with: one the answer's schema takes
 *  (SignInCredentialAnswerSchema.email: 1 to AUTOFILL_SIGN_IN_LIMITS.email characters, trimmed), else null. */
function gateEmail(email: string | null): string | null {
  const trimmed = email?.trim() ?? '';
  return trimmed !== '' && trimmed.length <= AUTOFILL_SIGN_IN_LIMITS.email ? trimmed : null;
}

/** The sign-in handler, as index.ts wires it. */
export function createSignIn(deps: SignInDeps) {
  /** core-x, item 3: whether a subframe is the tab's claim frame, in its document now. */
  async function claims(from: ContentChannel): Promise<boolean> {
    const claim = (await deps.claimFrame?.(from.tabId).catch(() => null)) ?? null;
    return claim !== null && claim.frameId === from.frameId && claim.frameId !== 0
      && claim.documentId === (from.documentId ?? null);
  }
  /** The answer when no saved password can be used (module header): Sign-in Auto set back to Manual if it is on, and
   *  under Auto the page says to set one (the v4 review, M5); on Manual the sign-in is the person's. */
  async function none(why: 'none' | 'gone' | 'unreadable', act: SignInAct): Promise<Answer<SignInCredential>> {
    log('signin.credential', { found: false, gone: why === 'gone' });
    if (why !== 'unreadable') await deps.missing?.(why).catch(() => undefined);
    return refuse((act === 'auto' || act === 'agent') && why !== 'unreadable' ? 'not_found' : 'unavailable');
  }
  return {
    /** signin/credential (module header). Refusals: `unavailable` (Sign-in does not act now, the page is not one the
     *  every-site sign-in covers, or (on Manual) none is saved), `not_found` (Sign-in acts as Auto and no password is
     *  saved, or the saved one can no longer be read: the page says to set one), `bad_sender` (not a top frame, not
     *  https, a private tab). Since the jr6 review (R1) a tab pressed for this host's wall already is answered `press`
     *  false, never refused. */
    async credential(message: CredentialMessage, from: ContentChannel): Promise<Answer<SignInCredential>> {
      if (from.incognito === true || (from.frameId !== 0 && !(await claims(from)))) {
        log('signin.refused', { top: from.frameId === 0, incognito: from.incognito === true });
        return refuse('bad_sender');
      }
      // The page as Chrome reports the sender (from.url: its own frame's address), never anything the message says.
      const page = httpsPageOf(from.url);
      if (page === null || !HostNameSchema.safeParse(page.host).success) {
        log('signin.refused', { https: false });
        return refuse('bad_sender');
      }
      const { host, path } = page;
      const act = await deps.signInAct(from.tabId, new URL(from.url).origin);
      if (act === null) {
        log('signin.refused', { allowed: false });
        return refuse('unavailable');
      }
      // The every-site sign-in's pages alone (TailorIT's API 6: a path-scoped host at a candidate path), never a
      // company's own page (reach 'site').
      if (from.reach === 'site' || !signInHostCovered(host, path)) {
        log('signin.refused', { host: false });
        return refuse('unavailable');
      }
      // The jr6 review (R1): an ask this frame never presses is typed alone and never meets the press limit; a press
      // within SIGN_IN_ONCE_MS of the tab's last one for this wall and host is typed for the person instead (no loop:
      // nothing is pressed by itself again).
      const key = `${SIGN_IN_TRIED_PREFIX}${from.tabId}|${message.wall}|${sha256Hex(host).slice(0, 16)}`;
      let press = (act === 'auto' || act === 'agent') && message.typing !== true;
      let again = false;
      if (press) {
        const tried = await deps.session.get(key);
        again = typeof tried === 'number' && deps.now() - tried >= 0 && deps.now() - tried < SIGN_IN_ONCE_MS;
        // The auto-apply agent's tab (sec-3): nobody is there to press what would be typed: refused, as before R1.
        if (again && act === 'agent') {
          log('signin.refused', { again: true });
          return refuse('expired');
        }
        if (again) press = false;
      }
      // An email gate (v3 Phase 7b) types the email alone: the password never leaves the worker for one, and (the jr6
      // review, R8) is not decrypted for it: the record's email is kept in the clear. jr6 SHELL-A (BUILD D-d; FIXPLAN
      // §6.12 item 6, APPLYPLAN G): in every Sign-in mode, the Sign-up Information email, else the profile's contact
      // email (with none saved, Sign-in Auto still goes back to Manual: `missing`).
      if (message.wall === 'email-gate') {
        const held = await deps.vault.status();
        const saved = held.set && held.email !== null ? held.email : null;
        const email = saved ?? gateEmail(await deps.profileEmail?.().catch(() => null) ?? null);
        if (email === null) return none('none', act);
        if (saved === null) await deps.missing?.('none').catch(() => undefined);
        if (press) await deps.session.set({ [key]: deps.now() });
        log('signin.credential', { found: true, press, again, gate: true, profile: saved === null });
        return ok({ host: AUTOFILL_ANY_HOST, email, press });
      }
      const saved = await deps.vault.reveal();
      if (!saved.ok) return none(saved.why, act);
      // Answered for a press: this tab, wall and host are not pressed again within SIGN_IN_ONCE_MS. jr6: one typed on
      // Manual is no try (nothing is pressed, the site refused nothing), so Sign up & Autofill may still press it.
      if (press) await deps.session.set({ [key]: deps.now() });
      log('signin.credential', { found: true, press, again });
      return ok({ host: AUTOFILL_ANY_HOST, email: saved.email, password: saved.password, press });
    },

    /** A closed tab's asks go with it. */
    async forgetTab(tabId: number): Promise<void> {
      const held = Object.keys(await deps.session.getMany(`${SIGN_IN_TRIED_PREFIX}${tabId}|`));
      if (held.length > 0) await deps.session.remove(held);
    },
  };
}

/** The sign-in handler, as index.ts wires it. */
export type SignIn = ReturnType<typeof createSignIn>;
