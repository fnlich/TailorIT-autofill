/*
 * jr7 FIX-background (the review's D-3 and C-3; the coordinator's decision: build PC7-05 as planned): Paycom's contact
 * dialog's "Continue To Application" (Adapter.signInContainer, PC7-05) is pressed by Sign-in Auto alone. The content
 * asks the worker as at an email gate (content/sign-in.ts CONTAINER_WALL) before anything is typed or pressed, and the
 * worker answers only on a page TailorIT's every-site sign-in covers (signInHostCovered). TailorIT's
 * jr7-tailorit-fix (API 7, pulled into src/contract/tailorit) covers Paycom's candidate pages by their path:
 * www.paycomonline.net's /v4/ats/web.php/portal/<32 hex>/jobs/<n> and …/applications, never an employee page.
 * Through the real worker (index.ts, sign-in.ts) over WXT's fake browser, with a synthetic sign-up saved:
 * - Sign-in Auto: the posting's contact dialog (and the /applications page) is answered with the press;
 * - Sign-in Manual: answered with no press (the email typed for the person at most; content/orchestrator.ts
 *   signInContainerNow asks nothing on Manual);
 * - an employee page of the same host, a look-alike host, a portal key of another shape, a path below the candidate
 *   pages and a subframe: refused.
 * The content's half (Auto presses once, Manual nothing, a shown check hands over) is
 * jr7-fix-paycom-signin.browser.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { signInHostCovered } from '../contract/tailorit';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import {
  contentSender, pageSender, saveSignup, SIGNUP_EMAIL, startTestWorker, tokenRecord, type TestWorker,
} from './worker.testkit';

let logs: MockInstance;
beforeEach(() => {
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => logs.mockRestore());

const OPTIONS = pageSender('options.html');
const PORTAL = 'https://www.paycomonline.net/v4/ats/web.php/portal/0123456789ABCDEF0123456789ABCDEF';
/** The posting, where the contact dialog (its Continue To Application) shows (fixtures/paycom/…-account's shape). */
const POSTING = `${PORTAL}/jobs/4321`;
const APPLICATIONS = `${PORTAL}/applications`;

let tabs = 30;
const at = (url: string, extra: Record<string, unknown> = {}) => {
  tabs += 1;
  return contentSender({ url, tab: { id: tabs, url }, documentId: `doc-${tabs}`, ...extra });
};
const ask = (worker: TestWorker, sender: ReturnType<typeof at>) =>
  worker.deliver({ v: 1, type: 'signin/credential', wall: 'email-gate' }, sender);

async function signInWorker(mode: 'auto' | 'manual'): Promise<TestWorker> {
  const worker = await startTestWorker({ token: tokenRecord() });
  await saveSignup(worker);
  await worker.deliver({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
    modes: { ...DEFAULT_SETTINGS.modes, signIn: mode } } }, OPTIONS);
  return worker;
}

describe('jr7 FIX-background, D-3: Paycom’s Continue To Application, the worker’s answer', () => {
  it('the contract covers Paycom’s candidate pages by their path, never its employee pages', () => {
    expect(signInHostCovered('www.paycomonline.net', new URL(POSTING).pathname)).toBe(true);
    expect(signInHostCovered('www.paycomonline.net', new URL(APPLICATIONS).pathname)).toBe(true);
    expect(signInHostCovered('www.paycomonline.net')).toBe(false);
    expect(signInHostCovered('www.paycomonline.net', '/v4/ee/web.php/app/login')).toBe(false);
  });

  // Undo proof: the contract before jr7-tailorit-fix (no Paycom in SIGN_IN_PATH_HOSTS) and this fails ('unavailable').
  it('Sign-in Auto: the posting’s contact dialog and the /applications page are answered with the press', async () => {
    const worker = await signInWorker('auto');
    expect(await ask(worker, at(POSTING))).toEqual({ ok: true, data: { host: '*', email: SIGNUP_EMAIL, press: true } });
    expect(await ask(worker, at(APPLICATIONS))).toEqual({ ok: true,
      data: { host: '*', email: SIGNUP_EMAIL, press: true } });
    expect(worker.tailorit.requests).toEqual([]);
  });

  it('Sign-in Manual: never answered with the press', async () => {
    const worker = await signInWorker('manual');
    expect(await ask(worker, at(POSTING))).toEqual({ ok: true, data: { host: '*', email: SIGNUP_EMAIL, press: false } });
  });

  it('refuses an employee page, a look-alike host, another portal key, a page below the candidate ones, a subframe',
    async () => {
      const worker = await signInWorker('auto');
      // Each refused, by the router (a frame on no page the extension's script runs on: bad_sender) or by the
      // sign-in's coverage (unavailable); never answered.
      const refused: Array<[string, string, Record<string, unknown>?]> = [
        ['an employee page', 'https://www.paycomonline.net/v4/ee/web.php/app/login'],
        ['a look-alike host', POSTING.replace('www.paycomonline.net', 'www.paycomonline.net.example.com')],
        ['another host of the domain', POSTING.replace('www.', 'hr.')],
        ['a portal key of another shape', POSTING.replace('0123456789ABCDEF0123456789ABCDEF', 'not-a-key')],
        ['a page below the posting', `${POSTING}/share`],
        ['a subframe', POSTING, { frameId: 3 }],
      ];
      const errors: Record<string, unknown> = {};
      for (const [name, url, extra] of refused) {
        const answer = await ask(worker, at(url, extra ?? {})) as { ok: boolean; error?: string };
        expect(answer.ok, name).toBe(false);
        errors[name] = answer.error;
        if (extra === undefined) expect(signInHostCovered(new URL(url).hostname, new URL(url).pathname), name).toBe(false);
      }
      // The employee page and the other hosts are no page the extension's script runs on (src/shared/hosts.ts: Paycom's
      // host is scoped to its candidate portal); the portal's other paths are not covered by the sign-in.
      expect(errors).toEqual({ 'an employee page': 'bad_sender', 'a look-alike host': 'bad_sender',
        'another host of the domain': 'bad_sender', 'a portal key of another shape': 'unavailable',
        'a page below the posting': 'unavailable', 'a subframe': 'bad_sender' });
    });
});
