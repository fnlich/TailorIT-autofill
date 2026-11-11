/*
 * Sign-in's worker handler (sign-in.ts createSignIn) on its own. jr6: the sign-in is the one saved in this browser's
 * Sign-up Information (signup-vault.ts), the every-site one (`*`), never TailorIT's:
 * - it is answered only on a page the every-site sign-in covers: a Workday tenant's, an iCIMS portal's, and (TailorIT's
 *   API 6, the snapshot build of 2026-11-06) ADP Workforce Now's and ClearCompany's hosts at their candidate paths alone,
 *   the path being the pathname of Chrome's address for the frame (from.url), never anything the message carries; never
 *   an employee page of the same host, never a company's own page (reach 'site'). The real worker never hears a frame
 *   off those paths (the extension's match patterns end at them); the handler is held to the rule anyway;
 * - Sign-in on Auto (or Sign up & Autofill) answers `press`; on Manual it is typed alone (`press` false); with the
 *   disclosure not acknowledged nothing is answered;
 * - none saved: under Auto `not_found` (the page then says to save one), on Manual `unavailable`; one that can no longer
 *   be read is told (`gone`);
 * - once per tab, wall and host (`expired`);
 * - no log line holds a path, a host, an email, a password or the password's length.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { StorageArea } from '../platform/types';
import type { ContentChannel } from './router';
import { createSignIn, type SignInAct } from './sign-in';
import type { Revealed } from './signup-vault';

const PASSWORD = 'Dummy-Password-Not-Real-2026!';
const EMAIL = 'alex.rivera@example.com';
const ADP_GUEST = 'https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=267cfc8f-e6d3-499b-8a38-c6abe8ee3d82&jobId=590196';
const CC_APPLY = 'https://vafb.clearcompany.com/careers/jobs/9485c936-3d5f-0a3b-27a4-708fe87203d8/apply';
const WORKDAY = 'https://acme.wd5.myworkdayjobs.com/en-US/careers/job/x/Engineer_JR-1/apply/applyManually';
const ICIMS = 'https://careers-acme.icims.com/jobs/1234/engineer/candidate?from=login';

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

/** The handler over a vault that answers `saved`, Sign-in acting as `act`. */
function handler(options: { act?: SignInAct; saved?: Revealed } = {}) {
  let reveals = 0;
  let gone = 0;
  const signIn = createSignIn({
    vault: { reveal: async () => {
      reveals += 1;
      return options.saved ?? { ok: true, email: EMAIL, password: PASSWORD };
    } },
    session: memoryArea(),
    now: () => 1_000,
    signInAct: async () => (options.act === undefined ? 'auto' : options.act),
    gone: async () => {
      gone += 1;
    },
  });
  return { signIn, reveals: () => reveals, gone: () => gone };
}

let tab = 30;
/** A top frame at `url`, as the router reads Chrome's sender. */
const frameAt = (url: string, extra: Partial<ContentChannel> = {}): ContentChannel =>
  ({ kind: 'content', tabId: (tab += 1), frameId: 0, documentId: `doc-${tab}`, url, ...extra });
const ask = (wall: 'sign-in' | 'create-account' | 'email-gate') => ({ v: 1, type: 'signin/credential', wall }) as const;

describe('the job-site sign-in, from this browser’s Sign-up Information (jr6)', () => {
  it('answers the saved sign-in on Workday’s and iCIMS’s pages, pressing on Auto', async () => {
    const { signIn } = handler();
    expect(await signIn.credential(ask('create-account'), frameAt(WORKDAY)))
      .toEqual({ ok: true, data: { host: '*', email: EMAIL, password: PASSWORD, press: true } });
    expect(await signIn.credential(ask('sign-in'), frameAt(ICIMS)))
      .toEqual({ ok: true, data: { host: '*', email: EMAIL, password: PASSWORD, press: true } });
  });

  it('on Manual answers it to be typed alone (press false)', async () => {
    const { signIn } = handler({ act: 'type' });
    expect(await signIn.credential(ask('sign-in'), frameAt(WORKDAY)))
      .toEqual({ ok: true, data: { host: '*', email: EMAIL, password: PASSWORD, press: false } });
  });

  it('answers nothing while the disclosure is not acknowledged, and reads nothing', async () => {
    const { signIn, reveals } = handler({ act: null });
    expect(await signIn.credential(ask('sign-in'), frameAt(WORKDAY))).toEqual({ ok: false, error: 'unavailable' });
    expect(reveals()).toBe(0);
  });

  it('with none saved: not_found under Auto (the page says to save one), unavailable on Manual', async () => {
    expect(await handler({ saved: { ok: false, why: 'none' } }).signIn.credential(ask('sign-in'), frameAt(WORKDAY)))
      .toEqual({ ok: false, error: 'not_found' });
    expect(await handler({ act: 'type', saved: { ok: false, why: 'none' } }).signIn
      .credential(ask('sign-in'), frameAt(WORKDAY))).toEqual({ ok: false, error: 'unavailable' });
    expect(await handler({ saved: { ok: false, why: 'unreadable' } }).signIn.credential(ask('sign-in'), frameAt(WORKDAY)))
      .toEqual({ ok: false, error: 'unavailable' });
  });

  it('tells when the saved one can no longer be read (its key gone)', async () => {
    const { signIn, gone } = handler({ saved: { ok: false, why: 'gone' } });
    expect(await signIn.credential(ask('sign-in'), frameAt(WORKDAY))).toEqual({ ok: false, error: 'not_found' });
    expect(gone()).toBe(1);
  });

  it('answers a tab once per wall and host for a press', async () => {
    const { signIn, reveals } = handler();
    const frame = frameAt(WORKDAY);
    expect(await signIn.credential(ask('sign-in'), frame)).toMatchObject({ ok: true });
    expect(await signIn.credential(ask('sign-in'), frame)).toEqual({ ok: false, error: 'expired' });
    expect(await signIn.credential(ask('create-account'), frame)).toMatchObject({ ok: true });
    expect(reveals()).toBe(2);
  });

  it('counts no sign-in typed on Manual as a try: nothing was pressed', async () => {
    let act: SignInAct = 'type';
    const signIn = createSignIn({ vault: { reveal: async () => ({ ok: true, email: EMAIL, password: PASSWORD }) },
      session: memoryArea(), now: () => 1_000, signInAct: async () => act });
    const frame = frameAt(WORKDAY);
    expect(await signIn.credential(ask('sign-in'), frame)).toMatchObject({ ok: true, data: { press: false } });
    expect(await signIn.credential(ask('sign-in'), frame)).toMatchObject({ ok: true, data: { press: false } });
    // Sign up & Autofill then presses it once.
    act = 'auto';
    expect(await signIn.credential(ask('sign-in'), frame)).toMatchObject({ ok: true, data: { press: true } });
    expect(await signIn.credential(ask('sign-in'), frame)).toEqual({ ok: false, error: 'expired' });
  });

  it('at an email gate answers the email alone', async () => {
    const { signIn } = handler();
    expect(await signIn.credential(ask('email-gate'), frameAt(ADP_GUEST)))
      .toEqual({ ok: true, data: { host: '*', email: EMAIL, press: true } });
  });

  it('refuses a subframe, a private tab and an http page before reading anything', async () => {
    const { signIn, reveals } = handler();
    expect(await signIn.credential(ask('sign-in'), frameAt(WORKDAY, { frameId: 3 }))).toEqual({ ok: false, error: 'bad_sender' });
    expect(await signIn.credential(ask('sign-in'), frameAt(WORKDAY, { incognito: true }))).toEqual({ ok: false, error: 'bad_sender' });
    expect(await signIn.credential(ask('sign-in'), frameAt(WORKDAY.replace('https:', 'http:'))))
      .toEqual({ ok: false, error: 'bad_sender' });
    expect(reveals()).toBe(0);
  });
});

describe('the hosts covered by their candidate paths (TailorIT’s API 6), with this browser’s sign-in', () => {
  it('takes `*` at ADP’s guest page and steps and ClearCompany’s /careers/', async () => {
    const { signIn } = handler();
    const steps = 'https://workforcenow.adp.com/mascsr/applicant/mdf/recruitment/postLogin.html?cid=x&OTP_login=true';
    expect(await signIn.credential(ask('email-gate'), frameAt(ADP_GUEST)))
      .toEqual({ ok: true, data: { host: '*', email: EMAIL, press: true } });
    expect(await signIn.credential(ask('sign-in'), frameAt(steps)))
      .toMatchObject({ ok: true, data: { host: '*', password: PASSWORD } });
    expect(await signIn.credential(ask('create-account'), frameAt(`${CC_APPLY}#top`)))
      .toMatchObject({ ok: true, data: { host: '*' } });
  });

  it('never answers on an employee page of those hosts, nor on a page of no job site', async () => {
    const { signIn, reveals } = handler();
    for (const url of ['https://workforcenow.adp.com/theme/index.html#/Myself', 'https://workforcenow.adp.com/mascsr/default/mdf/payroll/x.html',
      'https://vafb.clearcompany.com/app/dashboard', 'https://vafb.clearcompany.com/Careers/jobs/1/apply',
      'https://www.example.com/careers/apply', 'https://jobs.lever.co/acme/1234/apply']) {
      expect(await signIn.credential(ask('sign-in'), frameAt(url)), url).toEqual({ ok: false, error: 'unavailable' });
    }
    expect(reveals()).toBe(0);
  });

  it('reads the path from the frame’s address, never from the message', async () => {
    const { signIn } = handler();
    const message = { ...ask('sign-in'), path: '/mascsr/default/mdf/recruitment/recruitment.html', url: ADP_GUEST } as
      unknown as Parameters<typeof signIn.credential>[0];
    expect(await signIn.credential(message, frameAt('https://workforcenow.adp.com/theme/index.html')))
      .toEqual({ ok: false, error: 'unavailable' });
  });

  it('never answers on a company’s own page (reach site), even a covered host', async () => {
    const { signIn, reveals } = handler();
    expect(await signIn.credential(ask('sign-in'), frameAt(CC_APPLY, { reach: 'site' })))
      .toEqual({ ok: false, error: 'unavailable' });
    expect(await signIn.credential(ask('sign-in'), frameAt(WORKDAY, { reach: 'site' })))
      .toEqual({ ok: false, error: 'unavailable' });
    expect(reveals()).toBe(0);
  });

  it('logs no path, host, email or password, nor the password’s length', async () => {
    const { signIn } = handler();
    await signIn.credential(ask('sign-in'), frameAt(ADP_GUEST));
    await signIn.credential(ask('sign-in'), frameAt(WORKDAY));
    const logged = JSON.stringify(logs.mock.calls);
    for (const secret of [PASSWORD, EMAIL, 'workforcenow', 'mascsr', 'acme']) expect(logged).not.toContain(secret);
    const numbers = logs.mock.calls.flatMap((call) => Object.values((call[1] ?? {}) as Record<string, unknown>))
      .filter((value) => typeof value === 'number');
    expect(numbers).not.toContain(PASSWORD.length);
  });
});
