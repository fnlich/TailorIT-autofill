/*
 * Sign-in mode Auto, the worker's side (v3 Phase 5; docs/SPEC-AMENDMENTS.md §12 Decision 10; docs/PRIVACY.md
 * "Sign-in Auto"). A run that paused at a job site's sign-in or create-account page, in a tab's top frame, asks for the
 * person's job-site sign-in (signin/credential {wall}). The worker answers it only when:
 * - Sign-in mode acts as Auto: the person chose it, the connection holds credentials:read (they ticked the sign-in box
 *   when connecting) and they acknowledged the disclosure as it reads now (settings.ts holdSignIn);
 * - the frame is a tab's top frame, in no private (incognito) tab, at an https address Chrome reports (the sender's,
 *   never a payload's), whose host name is the one TailorIT is asked for;
 * - the tab was not answered a sign-in for this host and wall within SIGN_IN_ONCE_MS: a password the site did not take
 *   is never typed again by itself (no retry loop, whatever page the site shows next). Only an answered sign-in counts:
 *   TailorIT down, or no sign-in saved for the host, is 'unavailable' and may be asked again;
 * - TailorIT answers one (GET /api/autofill/credentials?host=: the host's own, else, on a host signInHostCovered
 *   covers, the one for every site), and it is for this host: its own host equal to the frame's, or `*` on a covered
 *   host, checked again here.
 * The answer to that frame's message is the one place the password goes: it is held in this function's memory only
 * until the answer is sent, never stored, logged, cached, put in a report or sent anywhere else, and the frame types it
 * into the page's password field only (src/content/sign-in.ts). Logs say whether one was found, never a host, an email
 * or a password.
 */
import {
  AUTOFILL_ANY_HOST, HostNameSchema, signInHostCovered,
} from '../contract/tailorit';
import { ok, refuse, type Answer } from '../messaging/envelope';
import type { ContentMessage, SignInCredential } from '../messaging/schemas';
import type { StorageArea } from '../platform/types';
import { sha256Hex } from '../core/text/sha256';
import { log } from '../shared/log';
import type { ContentChannel } from './router';
import type { ServerClient } from './server-client';

/** A tab is answered one host's sign-in for one wall at most once this long (no retry loop). */
export const SIGN_IN_ONCE_MS = 10 * 60_000;
/** storage.session `signin-tried:<tabId>|<wall>|<host hash>`: when the tab was last answered (a time; the host as the
 *  first 16 hex digits of its SHA-256, never the host). */
export const SIGN_IN_TRIED_PREFIX = 'signin-tried:';

type CredentialMessage = Extract<ContentMessage, { type: 'signin/credential' }>;

/** What the sign-in needs. */
export interface SignInDeps {
  server: Pick<ServerClient, 'credential'>;
  session: StorageArea;
  now(): number;
  /** Sign-in mode as it acts now: Auto, and allowed (credentials:read, the disclosure acknowledged). */
  signInAuto(): Promise<boolean>;
}

/** The frame's host name, when its address is https; null otherwise. */
function httpsHostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** The sign-in handler, as index.ts wires it. */
export function createSignIn(deps: SignInDeps) {
  return {
    /** signin/credential (module header). Refusals: `unavailable` (not allowed now, none for this host, TailorIT not
     *  reached), `expired` (the tab was answered this host's sign-in for this wall already: the site did not take it),
     *  `bad_sender` (not a top frame, not https, a private tab), `rate_limited` (TailorIT's limit). */
    async credential(message: CredentialMessage, from: ContentChannel): Promise<Answer<SignInCredential>> {
      if (from.incognito === true || from.frameId !== 0) {
        log('signin.refused', { top: from.frameId === 0, incognito: from.incognito === true });
        return refuse('bad_sender');
      }
      const host = httpsHostOf(from.url);
      if (host === null || !HostNameSchema.safeParse(host).success) {
        log('signin.refused', { https: false });
        return refuse('bad_sender');
      }
      if (!(await deps.signInAuto())) {
        log('signin.refused', { allowed: false });
        return refuse('unavailable');
      }
      const key = `${SIGN_IN_TRIED_PREFIX}${from.tabId}|${message.wall}|${sha256Hex(host).slice(0, 16)}`;
      const tried = await deps.session.get(key);
      if (typeof tried === 'number' && deps.now() - tried >= 0 && deps.now() - tried < SIGN_IN_ONCE_MS) {
        log('signin.refused', { again: true });
        return refuse('expired');
      }
      const answer = await deps.server.credential(host);
      if (!answer.ok) {
        log('signin.credential', { found: false, status: answer.status ?? 0 });
        return answer.failure === 'rate-limited'
          ? (answer.retryAfterSeconds === undefined ? refuse('rate_limited')
            : { ok: false, error: 'rate_limited', retryAfterSeconds: answer.retryAfterSeconds })
          : refuse('unavailable');
      }
      const { host: own, email, password } = answer.value;
      if (own !== host && !(own === AUTOFILL_ANY_HOST && signInHostCovered(host))) {
        log('signin.refused', { host: false });
        return refuse('unavailable');
      }
      // Answered: this tab, wall and host are not answered again within SIGN_IN_ONCE_MS.
      await deps.session.set({ [key]: deps.now() });
      log('signin.credential', { found: true, everySite: own === AUTOFILL_ANY_HOST });
      return ok({ host: own, email, password });
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
