/*
 * The snapshot build of 2026-11-06 (contract6): Sign-in Auto's worker handler (sign-in.ts createSignIn) on its own, for
 * TailorIT's API 6, where the every-site sign-in covers ADP Workforce Now's and ClearCompany's hosts by their candidate
 * paths alone. The real worker (agent-worker.test.ts) never hears a frame off those paths: the extension's match
 * patterns (src/shared/hosts.ts) end at them. The handler is held to the rule anyway, as if one did:
 * - the path is the pathname of Chrome's address for the frame (from.url), sent to TailorIT only where it decides the
 *   every-site sign-in (a candidate path of such a host), never a query, and nothing the message carries;
 * - `*` is taken at a candidate path alone: never on an employee page of the same host, never on a company's own page
 *   (reach 'site').
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { AutofillCredential } from '../contract/tailorit';
import type { StorageArea } from '../platform/types';
import type { ContentChannel } from './router';
import type { ServerResult } from './server-client';
import { createSignIn } from './sign-in';

const PASSWORD = 'dummy-password-not-real';
const EVERY_SITE: AutofillCredential = { host: '*', email: 'alex.rivera@example.com', password: PASSWORD };
const ADP_GUEST = 'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=267cfc8f-e6d3-499b-8a38-c6abe8ee3d82&jobId=590196';
const CC_APPLY = 'https://vafb.clearcompany.com/careers/jobs/9485c936-3d5f-0a3b-27a4-708fe87203d8/apply';

let logs: MockInstance;
beforeEach(() => {
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => logs.mockRestore());

function memoryArea(): StorageArea {
  const data = new Map<string, unknown>();
  return {
    get: async (key) => data.get(key),
    getMany: async (prefix) => Object.fromEntries([...data].filter(([key]) => key.startsWith(prefix))),
    async set(entries) {
      for (const [key, value] of Object.entries(entries)) data.set(key, value);
    },
    async remove(keys) {
      for (const key of keys) data.delete(key);
    },
    async restrictToTrustedContexts() {},
  };
}

/** The handler with a TailorIT that answers `credential` and records what it was asked. */
function handler(credential: AutofillCredential = EVERY_SITE) {
  const asked: Array<[string, string | undefined]> = [];
  const signIn = createSignIn({
    server: {
      async credential(host: string, path?: string): Promise<ServerResult<AutofillCredential>> {
        asked.push([host, path]);
        return { ok: true, value: credential };
      },
    },
    session: memoryArea(),
    now: () => 1_000,
    signInAuto: async () => true,
  });
  return { signIn, asked };
}

let tab = 30;
/** A top frame at `url`, as the router reads Chrome's sender. */
const frameAt = (url: string, extra: Partial<ContentChannel> = {}): ContentChannel =>
  ({ kind: 'content', tabId: (tab += 1), frameId: 0, documentId: `doc-${tab}`, url, ...extra });

describe('Sign-in Auto on the hosts covered by their candidate paths (TailorIT’s API 6)', () => {
  it('takes `*` at ADP’s guest page and steps and ClearCompany’s /careers/, asking with the pathname alone', async () => {
    const { signIn, asked } = handler();
    const steps = 'https://workforcenow.adp.com/mascsr/applicant/mdf/recruitment/postLogin.html?cid=x&OTP_login=true';
    expect(await signIn.credential({ v: 1, type: 'signin/credential', wall: 'email-gate' }, frameAt(ADP_GUEST)))
      .toEqual({ ok: true, data: { host: '*', email: EVERY_SITE.email } });
    expect(await signIn.credential({ v: 1, type: 'signin/credential', wall: 'sign-in' }, frameAt(steps)))
      .toMatchObject({ ok: true, data: { host: '*', password: PASSWORD } });
    expect(await signIn.credential({ v: 1, type: 'signin/credential', wall: 'create-account' }, frameAt(`${CC_APPLY}#top`)))
      .toMatchObject({ ok: true, data: { host: '*' } });
    expect(asked).toEqual([['workforcenow.adp.com', '/mascsr/default/mdf/recruitment/recruitment.html'],
      ['workforcenow.adp.com', '/mascsr/applicant/mdf/recruitment/postLogin.html'],
      ['vafb.clearcompany.com', '/careers/jobs/9485c936-3d5f-0a3b-27a4-708fe87203d8/apply']]);
  });

  it('never takes `*` on an employee page of those hosts, and sends no path from one', async () => {
    const { signIn, asked } = handler();
    for (const url of ['https://workforcenow.adp.com/theme/index.html#/Myself', 'https://workforcenow.adp.com/mascsr/default/mdf/payroll/x.html',
      'https://vafb.clearcompany.com/app/dashboard', 'https://vafb.clearcompany.com/Careers/jobs/1/apply']) {
      expect(await signIn.credential({ v: 1, type: 'signin/credential', wall: 'sign-in' }, frameAt(url)), url)
        .toEqual({ ok: false, error: 'not_found' });
    }
    expect(asked).toEqual([['workforcenow.adp.com', undefined], ['workforcenow.adp.com', undefined],
      ['vafb.clearcompany.com', undefined], ['vafb.clearcompany.com', undefined]]);
  });

  it('still takes the sign-in saved for the exact host on an employee page (the host’s own, not the every-site one)',
    async () => {
      const own = { ...EVERY_SITE, host: 'workforcenow.adp.com' };
      const { signIn, asked } = handler(own);
      expect(await signIn.credential({ v: 1, type: 'signin/credential', wall: 'sign-in' },
        frameAt('https://workforcenow.adp.com/theme/index.html'))).toMatchObject({ ok: true, data: { host: own.host } });
      expect(asked).toEqual([['workforcenow.adp.com', undefined]]);
    });

  it('reads the path from the frame’s address, never from the message', async () => {
    const { signIn, asked } = handler();
    const message = { v: 1, type: 'signin/credential', wall: 'sign-in',
      path: '/mascsr/default/mdf/recruitment/recruitment.html', url: ADP_GUEST } as unknown as
      Parameters<typeof signIn.credential>[0];
    expect(await signIn.credential(message, frameAt('https://workforcenow.adp.com/theme/index.html')))
      .toEqual({ ok: false, error: 'not_found' });
    expect(asked).toEqual([['workforcenow.adp.com', undefined]]);
  });

  it('never sends the path from a company’s own page, nor takes `*` there (reach site)', async () => {
    const { signIn, asked } = handler();
    expect(await signIn.credential({ v: 1, type: 'signin/credential', wall: 'sign-in' },
      frameAt(CC_APPLY, { reach: 'site' }))).toEqual({ ok: false, error: 'not_found' });
    expect(asked).toEqual([['vafb.clearcompany.com', undefined]]);
  });

  it('logs no path, host, email or password', async () => {
    const { signIn } = handler();
    await signIn.credential({ v: 1, type: 'signin/credential', wall: 'sign-in' }, frameAt(ADP_GUEST));
    const logged = JSON.stringify(logs.mock.calls);
    for (const secret of [PASSWORD, EVERY_SITE.email, 'workforcenow', 'mascsr']) expect(logged).not.toContain(secret);
  });
});
