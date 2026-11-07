/*
 * Sign-in mode Auto, the worker's side (v3 Phase 5; docs/SPEC-AMENDMENTS.md §12 Decision 10; docs/PRIVACY.md
 * "Sign-in Auto"). A run that paused at a job site's sign-in or create-account page, in a tab's top frame, asks for the
 * person's job-site sign-in (signin/credential {wall}). The worker answers it only when:
 * - Sign-in mode acts as Auto: the person chose it, the connection holds credentials:read (they ticked the sign-in box
 *   when connecting) and they acknowledged the disclosure as it reads now (settings.ts holdSignIn);
 * - the frame is a tab's top frame, or (the snapshot build of 2026-11-06, core-x item 3) the tab's claim frame: the one
 *   subframe that draws a company wrapper's application, directly below it, on its origin, at its application
 *   (frames.ts claimFrameOf: an iCIMS portal's iframe#icims_content_iframe); in no private (incognito) tab, at an https
 *   address Chrome reports (the sender's, never a payload's), whose host name is the one TailorIT is asked for;
 * - the tab was not answered a sign-in for this host and wall within SIGN_IN_ONCE_MS: a password the site did not take
 *   is never typed again by itself (no retry loop, whatever page the site shows next). Only an answered sign-in counts:
 *   TailorIT down, or no sign-in saved for the host, is 'unavailable' and may be asked again;
 * - TailorIT answers one (GET /api/autofill/credentials?host=: the host's own, else, on a host signInHostCovered
 *   covers, the one for every site), and it is for this host: its own host equal to the frame's, or `*` on a covered
 *   host, checked again here; a company's own page the worker injected (v3 Phase 8, reach 'site') takes its exact
 *   host's alone, never `*` (the Phase 8 review, P6). TailorIT's API 6 (the snapshot build of 2026-11-06, contract6):
 *   on a host the every-site sign-in covers by its candidate paths alone (ADP Workforce Now's
 *   /mascsr/default|applicant/mdf/recruitment/, a ClearCompany tenant's /careers/), the frame's path, the pathname of
 *   Chrome's address for it (never a query, a fragment or anything the message says), decides it: it goes to TailorIT
 *   as &path= at such a path alone, and `*` is taken there alone, never on that host's employee pages.
 * v4 (background/sign-up.ts): "Sign up & Autofill" grants a tab Sign-in Auto for one run: signInAuto(tabId) then says
 * Auto for that tab alone, every other rule above held.
 * The answer to that frame's message is the one place the password goes: it is held in this function's memory only
 * until the answer is sent, never stored, logged, cached, put in a report or sent anywhere else, and the frame types it
 * into the page's password field only (src/content/sign-in.ts). At an email gate (v3 Phase 7b: wall 'email-gate', the
 * email-first identity step of Oracle Recruiting Cloud) the answer carries the email alone, never the password. Logs
 * say whether one was found, never a host, an email or a password.
 */
import {
  AUTOFILL_ANY_HOST, HostNameSchema, signInHostCovered,
} from '../contract/tailorit';
import { ok, refuse, type Answer } from '../messaging/envelope';
import type { ContentMessage, SignInCredential } from '../messaging/schemas';
import type { StorageArea } from '../platform/types';
import { sha256Hex } from '../core/text/sha256';
import { log } from '../shared/log';
import type { FrameEntry } from './frames';
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
  /** Sign-in mode as it acts now for the tab: Auto (the person's mode, or v4's Sign up & Autofill grant for that tab),
   *  and allowed (credentials:read, the disclosure acknowledged). */
  signInAuto(tabId: number): Promise<boolean>;
  /** core-x, item 3: the tab's claim frame (frames.ts claimFrameOf), or null; absent: only a top frame is answered. */
  claimFrame?(tabId: number): Promise<Pick<FrameEntry, 'frameId' | 'documentId'> | null>;
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

/** The sign-in handler, as index.ts wires it. */
export function createSignIn(deps: SignInDeps) {
  /** core-x, item 3: whether a subframe is the tab's claim frame, in its document now. */
  async function claims(from: ContentChannel): Promise<boolean> {
    const claim = (await deps.claimFrame?.(from.tabId).catch(() => null)) ?? null;
    return claim !== null && claim.frameId === from.frameId && claim.frameId !== 0
      && claim.documentId === (from.documentId ?? null);
  }
  return {
    /** signin/credential (module header). Refusals: `unavailable` (not allowed now, none for this host, TailorIT not
     *  reached), `expired` (the tab was answered this host's sign-in for this wall already: the site did not take it),
     *  `bad_sender` (not a top frame, not https, a private tab), `rate_limited` (TailorIT's limit). */
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
      if (!(await deps.signInAuto(from.tabId))) {
        log('signin.refused', { allowed: false });
        return refuse('unavailable');
      }
      const key = `${SIGN_IN_TRIED_PREFIX}${from.tabId}|${message.wall}|${sha256Hex(host).slice(0, 16)}`;
      const tried = await deps.session.get(key);
      if (typeof tried === 'number' && deps.now() - tried >= 0 && deps.now() - tried < SIGN_IN_ONCE_MS) {
        log('signin.refused', { again: true });
        return refuse('expired');
      }
      // TailorIT's API 6 (contract6): the page's path goes with the host only where it decides the every-site sign-in,
      // a host covered by its candidate paths alone (ADP Workforce Now, ClearCompany) at one of those paths; nowhere
      // else, and never from a company's own page, which never takes that sign-in.
      const byPath = from.reach !== 'site' && !signInHostCovered(host) && signInHostCovered(host, path);
      const answer = await deps.server.credential(host, byPath ? path : undefined);
      if (!answer.ok) {
        log('signin.credential', { found: false, status: answer.status ?? 0 });
        return answer.failure === 'rate-limited'
          ? (answer.retryAfterSeconds === undefined ? refuse('rate_limited')
            : { ok: false, error: 'rate_limited', retryAfterSeconds: answer.retryAfterSeconds })
          : refuse('unavailable');
      }
      const { host: own, email, password } = answer.value;
      // A company's own page (v3 Phase 8, the review's P6) takes a sign-in saved for its exact host alone: never the
      // every-site one, whose hosts are the job sites' (signInHostCovered), not a company's or an employer's.
      if (own !== host && !(own === AUTOFILL_ANY_HOST && from.reach !== 'site' && signInHostCovered(host, path))) {
        log('signin.refused', { host: false });
        return refuse('unavailable');
      }
      // Answered: this tab, wall and host are not answered again within SIGN_IN_ONCE_MS.
      await deps.session.set({ [key]: deps.now() });
      log('signin.credential', { found: true, everySite: own === AUTOFILL_ANY_HOST });
      // An email gate (v3 Phase 7b) types the email alone: the password never leaves the worker for one.
      return ok(message.wall === 'email-gate' ? { host: own, email } : { host: own, email, password });
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
