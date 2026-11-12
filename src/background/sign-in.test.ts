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
 * - none saved: under Auto `not_found` (the page then says to save one), on Manual `unavailable`; either way, and for one
 *   that can no longer be read, Sign-in's mode is looked at (`missing`: the jr6 review's sec-9);
 * - the jr6 review (R1): a press once per tab, wall and host; an Auto ask within that time is typed for the person
 *   (`press` false), never refused; an ask that says it never presses (`typing`) is typed alone and neither meets nor
 *   sets the limit;
 * - the jr6 review (R8): an email gate is answered from the record's email, nothing decrypted;
 * - no log line holds a path, a host, an email, a password or the password's length.
 * - jr6 ifix SEC-1 (the jr6 integration review's SEC-1), over the real vault (signup-vault.ts, Node's WebCrypto): an ask
 *   whose page rules (`rules`) the saved password breaks is refused in closed words, with no password, nothing
 *   decrypted and no `signin-tried:` key; a password saved after it, which meets them, is pressed as a first ask is.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { ContentMessageSchema, SIGN_IN_RULE_KINDS, type SignInRules } from '../messaging/schemas';
import { createMemoryKeyStore } from '../platform/memory';
import type { StorageArea } from '../platform/types';
import type { ContentChannel } from './router';
import { createSignIn, SIGN_IN_ONCE_MS, SIGN_IN_TRIED_PREFIX, type SignInAct } from './sign-in';
import { createSignupVault, type Revealed, type SignupStatus } from './signup-vault';

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

/** The status a vault that answers `saved` gives (its email in the clear, never the password). */
const statusOf = (saved: Revealed): SignupStatus => (saved.ok ? { set: true, email: saved.email, updatedAt: 1 }
  : saved.why === 'none' ? { set: false, email: null, updatedAt: null } : { set: true, email: EMAIL, updatedAt: 1 });

/** The handler over a vault that answers `saved`, Sign-in acting as `act`, at `clock.now`; jr6 SHELL-A: the profile's
 *  contact email `profileEmail` (none by default). */
function handler(options: { act?: SignInAct; saved?: Revealed; clock?: { now: number }; profileEmail?: string | null }
  = {}) {
  let reveals = 0;
  const missing: Array<'none' | 'gone'> = [];
  const saved = () => options.saved ?? { ok: true, email: EMAIL, password: PASSWORD };
  const signIn = createSignIn({
    vault: {
      reveal: async () => {
        reveals += 1;
        return saved();
      },
      status: async () => statusOf(saved()),
    },
    session: memoryArea(),
    now: () => options.clock?.now ?? 1_000,
    signInAct: async () => (options.act === undefined ? 'auto' : options.act),
    missing: async (why) => {
      missing.push(why);
    },
    ...(options.profileEmail === undefined ? {} : { profileEmail: async () => options.profileEmail ?? null }),
  });
  return { signIn, reveals: () => reveals, missing: () => missing, gone: () => missing.filter((why) => why === 'gone').length };
}

let tab = 30;
/** A top frame at `url`, as the router reads Chrome's sender. */
const frameAt = (url: string, extra: Partial<ContentChannel> = {}): ContentChannel =>
  ({ kind: 'content', tabId: (tab += 1), frameId: 0, documentId: `doc-${tab}`, url, ...extra });
const ask = (wall: 'sign-in' | 'create-account' | 'email-gate', typing = false) =>
  ({ v: 1, type: 'signin/credential', wall, ...(typing ? { typing: true as const } : {}) }) as const;

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

  it('looks at Sign-in’s mode when none is saved, at a sign-in and at an email gate (the jr6 review, sec-9)', async () => {
    const none = handler({ saved: { ok: false, why: 'none' } });
    await none.signIn.credential(ask('sign-in'), frameAt(WORKDAY));
    await none.signIn.credential(ask('email-gate'), frameAt(ADP_GUEST));
    expect(none.missing()).toEqual(['none', 'none']);
    // Not when the key could not be read now (kept, tried again).
    const unreadable = handler({ saved: { ok: false, why: 'unreadable' } });
    await unreadable.signIn.credential(ask('sign-in'), frameAt(WORKDAY));
    expect(unreadable.missing()).toEqual([]);
  });

  it('presses a tab’s wall once per host; an Auto ask after it is typed for the person, never refused (the jr6 review, R1)', async () => {
    const clock = { now: 1_000 };
    const { signIn, reveals } = handler({ clock });
    const frame = frameAt(WORKDAY);
    expect(await signIn.credential(ask('sign-in'), frame)).toMatchObject({ ok: true, data: { press: true } });
    expect(await signIn.credential(ask('sign-in'), frame))
      .toEqual({ ok: true, data: { host: '*', email: EMAIL, password: PASSWORD, press: false } });
    // Another wall of the same host is its own.
    expect(await signIn.credential(ask('create-account'), frame)).toMatchObject({ ok: true, data: { press: true } });
    expect(reveals()).toBe(3);
    // Once the time is past, the wall may be pressed again.
    clock.now += SIGN_IN_ONCE_MS;
    expect(await signIn.credential(ask('sign-in'), frame)).toMatchObject({ ok: true, data: { press: true } });
  });

  it('types an ask that says it never presses, neither meeting nor setting the press limit (the jr6 review, R1)', async () => {
    const { signIn } = handler();
    const frame = frameAt(ICIMS);
    // An account section on Auto (iCIMS's "Create a login", in two documents of the tab): typed both times.
    expect(await signIn.credential(ask('create-account', true), frame)).toMatchObject({ ok: true, data: { press: false } });
    expect(await signIn.credential(ask('create-account', true), frame)).toMatchObject({ ok: true, data: { press: false } });
    // The wall's own press is still the first.
    expect(await signIn.credential(ask('create-account'), frame)).toMatchObject({ ok: true, data: { press: true } });
    // And after it, a typing ask is still answered.
    expect(await signIn.credential(ask('create-account', true), frame)).toMatchObject({ ok: true, data: { press: false } });
  });

  it('in the auto-apply agent’s tab presses once and never types a wall for a person after it (the jr6 review, sec-3)', async () => {
    const { signIn } = handler({ act: 'agent' });
    const frame = frameAt(WORKDAY);
    expect(await signIn.credential(ask('sign-in'), frame)).toMatchObject({ ok: true, data: { press: true } });
    // Nobody is there to press it: refused, as before the jr6 review.
    expect(await signIn.credential(ask('sign-in'), frame)).toEqual({ ok: false, error: 'expired' });
    // Its application form's account section is still typed (the agent submits the form).
    expect(await signIn.credential(ask('create-account', true), frame)).toMatchObject({ ok: true, data: { press: false } });
    // None saved: the agent's page is told none is saved, as Auto's is.
    expect(await handler({ act: 'agent', saved: { ok: false, why: 'none' } }).signIn.credential(ask('sign-in'),
      frameAt(WORKDAY))).toEqual({ ok: false, error: 'not_found' });
  });

  it('counts no sign-in typed on Manual as a try: nothing was pressed', async () => {
    let act: SignInAct = 'type';
    const signIn = createSignIn({ vault: { reveal: async () => ({ ok: true, email: EMAIL, password: PASSWORD }),
      status: async () => ({ set: true, email: EMAIL, updatedAt: 1 }) },
    session: memoryArea(), now: () => 1_000, signInAct: async () => act });
    const frame = frameAt(WORKDAY);
    expect(await signIn.credential(ask('sign-in'), frame)).toMatchObject({ ok: true, data: { press: false } });
    expect(await signIn.credential(ask('sign-in'), frame)).toMatchObject({ ok: true, data: { press: false } });
    // Sign up & Autofill then presses it once; after that it is typed for the person.
    act = 'auto';
    expect(await signIn.credential(ask('sign-in'), frame)).toMatchObject({ ok: true, data: { press: true } });
    expect(await signIn.credential(ask('sign-in'), frame)).toMatchObject({ ok: true, data: { press: false } });
  });

  it('at an email gate answers the email alone, decrypting nothing for it (the jr6 review, R8)', async () => {
    const { signIn, reveals } = handler();
    const frame = frameAt(ADP_GUEST);
    expect(await signIn.credential(ask('email-gate'), frame))
      .toEqual({ ok: true, data: { host: '*', email: EMAIL, press: true } });
    // Pressed once, then the email typed for the person.
    expect(await signIn.credential(ask('email-gate'), frame))
      .toEqual({ ok: true, data: { host: '*', email: EMAIL, press: false } });
    expect(reveals()).toBe(0);
    // None saved: none answered, still nothing decrypted.
    const none = handler({ saved: { ok: false, why: 'none' } });
    expect(await none.signIn.credential(ask('email-gate'), frameAt(ADP_GUEST))).toEqual({ ok: false, error: 'not_found' });
    expect(none.reveals()).toBe(0);
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

// ── jr6 SHELL-A (BUILD D-d; FIXPLAN §6.12 item 6, APPLYPLAN G) ──
describe('an email gate in every Sign-in mode: the Sign-up Information email, else the profile’s, never a password', () => {
  const PROFILE_EMAIL = 'alex.rivera.profile@example.com';
  const GATE = 'https://careers-acme.icims.com/jobs/1234/engineer/login?in_iframe=1';

  it('with none saved, answers the profile’s contact email: typed alone on Manual, pressed on Auto', async () => {
    const manual = handler({ act: 'type', saved: { ok: false, why: 'none' }, profileEmail: PROFILE_EMAIL });
    expect(await manual.signIn.credential(ask('email-gate', true), frameAt(GATE)))
      .toEqual({ ok: true, data: { host: '*', email: PROFILE_EMAIL, press: false } });
    expect(manual.reveals()).toBe(0);
    // Sign-in's mode is still looked at (none saved: Auto, which needs one, goes back to Manual).
    expect(manual.missing()).toEqual(['none']);
    const auto = handler({ saved: { ok: false, why: 'none' }, profileEmail: PROFILE_EMAIL });
    expect(await auto.signIn.credential(ask('email-gate'), frameAt(GATE)))
      .toEqual({ ok: true, data: { host: '*', email: PROFILE_EMAIL, press: true } });
  });

  it('answers the Sign-up Information email before the profile’s', async () => {
    const { signIn } = handler({ act: 'type', profileEmail: PROFILE_EMAIL });
    expect(await signIn.credential(ask('email-gate', true), frameAt(GATE)))
      .toEqual({ ok: true, data: { host: '*', email: EMAIL, press: false } });
  });

  // The undo proof's case: a saved password never goes to an email gate, in any mode, and is never decrypted for one.
  it('never answers a password at an email gate, whatever the mode, and decrypts nothing for one', async () => {
    for (const act of ['auto', 'type', 'agent'] as const) {
      const { signIn, reveals } = handler({ act, profileEmail: PROFILE_EMAIL });
      const answer = await signIn.credential(ask('email-gate', act === 'type'), frameAt(GATE));
      expect(answer, act).toMatchObject({ ok: true, data: { host: '*', email: EMAIL } });
      expect(answer, act).not.toHaveProperty('data.password');
      expect(JSON.stringify(answer), act).not.toContain(PASSWORD);
      expect(reveals(), act).toBe(0);
    }
  });

  it('never presses on Manual: its answer says press false', async () => {
    const { signIn } = handler({ act: 'type', saved: { ok: false, why: 'none' }, profileEmail: PROFILE_EMAIL });
    expect(await signIn.credential(ask('email-gate'), frameAt(GATE))).toMatchObject({ ok: true, data: { press: false } });
  });

  it('answers nothing with no email at all, nor with one the answer cannot carry, nor before the disclosure', async () => {
    expect(await handler({ saved: { ok: false, why: 'none' }, profileEmail: null }).signIn
      .credential(ask('email-gate'), frameAt(GATE))).toEqual({ ok: false, error: 'not_found' });
    expect(await handler({ act: 'type', saved: { ok: false, why: 'none' }, profileEmail: '  ' }).signIn
      .credential(ask('email-gate', true), frameAt(GATE))).toEqual({ ok: false, error: 'unavailable' });
    expect(await handler({ act: 'type', saved: { ok: false, why: 'none' }, profileEmail: `${'a'.repeat(250)}@example.com` })
      .signIn.credential(ask('email-gate', true), frameAt(GATE))).toEqual({ ok: false, error: 'unavailable' });
    expect(await handler({ act: null, saved: { ok: false, why: 'none' }, profileEmail: PROFILE_EMAIL }).signIn
      .credential(ask('email-gate'), frameAt(GATE))).toEqual({ ok: false, error: 'unavailable' });
  });

  it('logs no email, the profile’s included', async () => {
    const { signIn } = handler({ act: 'type', saved: { ok: false, why: 'none' }, profileEmail: PROFILE_EMAIL });
    await signIn.credential(ask('email-gate', true), frameAt(GATE));
    expect(JSON.stringify(logs.mock.calls)).not.toContain(PROFILE_EMAIL);
    expect(logs.mock.calls).toContainEqual(['[tailorit-autofill] signin.credential',
      { found: true, press: false, again: false, gate: true, profile: true }]);
  });
});
// ── end jr6 SHELL-A ──

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

// ── jr6 ifix SEC-1 (the jr6 integration review's SEC-1) ──
describe('the page’s own password rules, checked before anything is decrypted or marked (jr6 ifix SEC-1)', () => {
  /** Synthetic passwords that meet every rule of core/signup-password.ts: 20 characters, and 32. */
  const SHORT = 'Synthetic-Pass-20ch!';
  const LONG = 'Synthetic-Rules-Pass-2026-32ch!!';
  /** Workday's Create Account asking `minLength` (its captured classes), and iCIMS's create-login rules. */
  const workdayAsking = (minLength: number): SignInRules =>
    ({ minLength, requires: ['upper', 'lower', 'digit', 'special', 'alpha'] });
  const ICIMS_RULES: SignInRules = { maxLength: 128, minLength: 8, notLogin: true,
    requires: ['alpha', 'lower', 'upper', 'digit', 'special'] };

  /** The real vault and the handler over it, Sign-in acting as `act`; every decryption counted. */
  function realVault(act: SignInAct = 'auto') {
    const subtle = globalThis.crypto.subtle;
    let decrypted = 0;
    const counting = new Proxy(subtle, { get(target, key) {
      if (key === 'decrypt') {
        return (...args: Parameters<SubtleCrypto['decrypt']>) => {
          decrypted += 1;
          return target.decrypt(...args);
        };
      }
      const value = Reflect.get(target, key) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    } });
    let clock = 1_000;
    const vault = createSignupVault({ local: memoryArea(), keys: createMemoryKeyStore(), subtle: counting,
      randomBytes: (count) => globalThis.crypto.getRandomValues(new Uint8Array(count)), now: () => (clock += 1) });
    const session = memoryArea();
    const signIn = createSignIn({ vault, session, now: () => 5_000, signInAct: async () => act });
    return { vault, signIn, decrypted: () => decrypted,
      tried: async () => Object.keys(await session.getMany(SIGN_IN_TRIED_PREFIX)) };
  }
  /** An ask as the router parses it (the schema's own bounds held). */
  const askWith = (wall: 'sign-in' | 'create-account' | 'email-gate', rules: SignInRules, typing = false) =>
    ContentMessageSchema.parse({ ...ask(wall, typing), rules }) as ReturnType<typeof ask>;

  it('refuses a password the page’s minimum breaks: no password, nothing decrypted, no press marked; one saved after '
    + 'it that meets the minimum is pressed (Sign up & Autofill’s second press)', async () => {
    const { vault, signIn, decrypted, tried } = realVault();
    expect(await vault.save({ email: EMAIL, password: SHORT })).toBe('saved');
    const frame = frameAt(WORKDAY);
    const refused = await signIn.credential(askWith('create-account', workdayAsking(30)), frame);
    expect(refused).toEqual({ ok: true, data: { refused: 'rules', rule: 'length' } });
    expect(JSON.stringify(refused)).not.toContain(SHORT);
    expect(JSON.stringify(refused)).not.toContain(EMAIL);
    expect(decrypted()).toBe(0);
    expect(await tried()).toEqual([]);
    expect(logs.mock.calls).toContainEqual(['[tailorit-autofill] signin.refused',
      { rules: SIGN_IN_RULE_KINDS.indexOf('length') }]);
    // The person saves a longer one and presses Sign up & Autofill again within the ten minutes: pressed, once.
    expect(await vault.save({ email: EMAIL, password: LONG })).toBe('saved');
    expect(await signIn.credential(askWith('create-account', workdayAsking(30)), frame))
      .toEqual({ ok: true, data: { host: '*', email: EMAIL, password: LONG, press: true } });
    expect(decrypted()).toBe(1);
    expect(await tried()).toHaveLength(1);
  });

  it('refuses one longer than the page’s password boxes take (`fits`), at a sign-in too; one that fits is answered',
    async () => {
      const { vault, signIn, decrypted, tried } = realVault();
      await vault.save({ email: EMAIL, password: LONG });
      const frame = frameAt(WORKDAY);
      expect(await signIn.credential(askWith('sign-in', { maxLength: 30 }), frame))
        .toEqual({ ok: true, data: { refused: 'fits' } });
      expect(logs.mock.calls).toContainEqual(['[tailorit-autofill] signin.refused', { fits: false }]);
      expect([decrypted(), (await tried()).length]).toEqual([0, 0]);
      // A box that takes exactly its length takes it.
      expect(await signIn.credential(askWith('sign-in', { maxLength: LONG.length }), frame))
        .toMatchObject({ ok: true, data: { password: LONG, press: true } });
    });

  it('takes what every saved password meets: the classes a page lists, its minimum met exactly, "not the login" with '
    + 'an email (iCIMS’s create-login rules)', async () => {
    const { vault, signIn, decrypted } = realVault('type');
    await vault.save({ email: EMAIL, password: SHORT });
    expect(await signIn.credential(askWith('create-account', ICIMS_RULES, true), frameAt(ICIMS)))
      .toEqual({ ok: true, data: { host: '*', email: EMAIL, password: SHORT, press: false } });
    expect(await signIn.credential(askWith('create-account', workdayAsking(SHORT.length)), frameAt(WORKDAY)))
      .toMatchObject({ ok: true, data: { password: SHORT } });
    expect(await signIn.credential(askWith('create-account', workdayAsking(SHORT.length + 1)), frameAt(WORKDAY)))
      .toEqual({ ok: true, data: { refused: 'rules', rule: 'length' } });
    expect(decrypted()).toBe(2);
  });

  it('in the auto-apply agent’s tab, a wall the rules refused is not refused `expired` once a password that meets them '
    + 'is saved: it was never pressed', async () => {
    const { vault, signIn, tried } = realVault('agent');
    await vault.save({ email: EMAIL, password: SHORT });
    const frame = frameAt(WORKDAY);
    expect(await signIn.credential(askWith('create-account', workdayAsking(24)), frame))
      .toEqual({ ok: true, data: { refused: 'rules', rule: 'length' } });
    expect(await tried()).toEqual([]);
    await vault.save({ email: EMAIL, password: LONG });
    expect(await signIn.credential(askWith('create-account', workdayAsking(24)), frame))
      .toMatchObject({ ok: true, data: { password: LONG, press: true } });
  });

  it('never refuses an email gate for rules: it asks for no password, and nothing is decrypted', async () => {
    const { vault, signIn, decrypted } = realVault();
    await vault.save({ email: EMAIL, password: SHORT });
    expect(await signIn.credential(askWith('email-gate', { minLength: 64 }), frameAt(ADP_GUEST)))
      .toEqual({ ok: true, data: { host: '*', email: EMAIL, press: true } });
    expect(decrypted()).toBe(0);
  });

  it('logs no password, email or length on a refusal, only the rule’s place', async () => {
    const { vault, signIn } = realVault();
    await vault.save({ email: EMAIL, password: SHORT });
    logs.mockClear();
    await signIn.credential(askWith('create-account', workdayAsking(40)), frameAt(WORKDAY));
    await signIn.credential(askWith('sign-in', { maxLength: 17 }), frameAt(WORKDAY));
    const logged = JSON.stringify(logs.mock.calls);
    for (const secret of [SHORT, EMAIL]) expect(logged).not.toContain(secret);
    const numbers = logs.mock.calls.flatMap((call) => Object.values((call[1] ?? {}) as Record<string, unknown>))
      .filter((value): value is number => typeof value === 'number');
    expect(numbers).not.toContain(SHORT.length);
    expect(numbers.every((n) => n < SIGN_IN_RULE_KINDS.length)).toBe(true);
  });
});
// ── end jr6 ifix SEC-1 ──
