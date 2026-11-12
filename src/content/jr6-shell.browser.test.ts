/*
 * jr6 SHELL-A (INTEGRATION.md section 3; FIXPLAN §6.12 items 1, 3, 4 and 5; the APPLY merge's open items): the sign-in
 * shell on the owner's jr6 captures (docs/FIXTURES.md: fixtures/workday/jr6-*, fixtures/icims/jr6-*) and synthetic
 * pages, with the jr6 synthetic sign-in (a dummy address and dummy passwords, never the owner's):
 * - item 1 (WD-02, ICIMS-07): the page's own password rules read before typing; a saved password they refuse is never
 *   typed, nor anything else; the rule is said on the toast; the log names the rule's kind, never the password or its
 *   length; unreadable rules fail open;
 * - item 2 (WD-01, ICIMS-06): Workday's Create Account (aep) and Sign In (brookfield) typed on Manual and pressed on Auto;
 *   iCIMS's "Create a login" typed on careers-ars's, uscareers-nyu's and careers-sentinel's profiles, the section then
 *   left with nothing required empty, nothing pressed;
 * - item 3 (WD-05): a verify-email alert shown on arrival types and asks nothing; after a press the site refused, each
 *   kind of account error is said, each its own toast;
 * - item 4 (WD-04): none saved under Sign up & Autofill: the run waits for one to be saved (typeSignIn pushed), then tries
 *   the wall once more; none within the wait, or the person's Cancel: nothing more asked;
 * - item 7: a wall's own sign-in step (Sign up & Autofill at a wall with no form) says `entering`, and the panel's Cancel
 *   (run/cancel) ends it at once: nothing typed or pressed after.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import createHtml from '../../fixtures/workday/workday-create-account.html?raw';
import signInHtml from '../../fixtures/workday/workday-sign-in.html?raw';
import aepCreateHtml from '../../fixtures/workday/jr6-aep-create-account.html?raw';
import brookfieldSignInHtml from '../../fixtures/workday/jr6-brookfield-sign-in.html?raw';
import verilyVerifyHtml from '../../fixtures/workday/verily-sign-in-verify.html?raw';
import ninjaConsentHtml from '../../fixtures/jobvite/ninjaone-consent.html?raw';
import ninjaGateHtml from '../../fixtures/jobvite/ninjaone-consent-empty.html?raw';
import ninjaGateRoutes from '../../fixtures/jobvite/ninjaone-consent-empty.routes.json';
import { adaptersFor } from '../adapters';
import { genericAdapter } from '../adapters/generic';
import { icimsAdapter } from '../adapters/icims';
import { SNAPSHOT_VIEWPORT } from '../adapters/test/expectations.testkit';
import type { Adapter, PagePasswordRules } from '../adapters/types';
import { workdayAdapter } from '../adapters/workday';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { accountLeft } from '../dom/account-section';
import { loadFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import { deadline } from '../dom/time';
import type { SignInCredential } from '../messaging/schemas';
import { COPY } from '../shared/copy';
import { addressOf, openAt, runtimeAt, servedAdapter } from './apply.testkit';
import { createFakeWorker, testVocab, type FakeWorker } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';
import {
  ACCOUNT_ERROR_KINDS, PASSWORD_RULE_KINDS, signIn, signInDetailOf, type SignInContext,
} from './sign-in';

/** The jr6 synthetic sign-in: one the jr6 rule takes (16+, an uppercase, a lowercase, a digit, a special). */
const EMAIL = 'alex.rivera@example.com';
const PASSWORD = 'E2e-Dummy-Password-Not-Real';
const AUTO: SignInCredential = { host: '*', email: EMAIL, password: PASSWORD, press: true };
const MANUAL: SignInCredential = { ...AUTO, press: false };

const AEP = 'https://aep.wd1.myworkdayjobs.com/en-US/aepcareersite/job/Gahanna%2C-OH/Infrastructure-Engineer-Lead---Cloud-AI_R19366/apply/autofillWithResume';
const BROOKFIELD = 'https://brookfield.wd5.myworkdayjobs.com/en-US/brookfield/job/US-TN---Remote/Staff-Security-Engineer--Cloud---AI-Platform_R2052488-2/apply/autofillWithResume';
const VERILY = 'https://verily.wd1.myworkdayjobs.com/en-US/verily_careers/login?redirect=%2Fen-US%2Fverily_careers%2Fjob%2FDallas%252C-Texas%2FSecurity-Operations-Tech-Lead_REQ-966%2Fapply%2FautofillWithResume';
const WORKDAY = 'https://workday.wd5.myworkdayjobs.com/en-US/Workday/job/x/Senior-Product-Manager--Technical_JR-0110787/apply/applyManually';

let logs: MockInstance;
beforeAll(() => {
  testVocab();
  logs = vi.spyOn(console, 'info');
});
afterAll(() => logs.mockRestore());
const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

/** A Workday capture as the tenant serves it: its base address, its account form with neither method nor action. */
async function workday(html: string, address: string): Promise<Fixture> {
  const fixture = await loadFixture(document, html, { width: 1280, height: 900 });
  const base = fixture.doc.createElement('base');
  base.href = address;
  fixture.doc.head.prepend(base);
  const form = fixture.doc.querySelector('form[data-automation-id="signInFormo"]');
  form?.removeAttribute('action');
  form?.removeAttribute('method');
  return fixture;
}

/** What the stand-in for Workday's script saw: its click_filter's presses, and the boxes as they were then. */
interface Seen {
  presses: number;
  typed?: Record<string, string | boolean>;
}

/** The account form's boxes as they hold now. */
function boxesOf(doc: Document): Record<string, string | boolean> {
  const box = (id: string) => doc.querySelector<HTMLInputElement>(`input[data-automation-id="${id}"]`);
  return { email: box('email')?.value ?? '', password: box('password')?.value ?? '',
    verify: box('verifyPassword')?.value ?? '', terms: box('createAccountCheckbox')?.checked ?? false };
}

/** Workday's script, as far as an account needs it: a click on the visible click_filter reads the form and the account
 *  view leaves, or (`refuse`) the view stays and shows the account error with those words above its form, as Workday's
 *  own does. Nothing navigates. */
function actAsWorkday(fixture: Fixture, refuse?: string): Seen {
  const seen: Seen = { presses: 0 };
  const doc = fixture.doc;
  doc.addEventListener('click', (event) => {
    if ((event.target as Element).getAttribute('data-automation-id') !== 'click_filter') return;
    seen.presses += 1;
    seen.typed = boxesOf(doc);
    const content = doc.querySelector('[data-automation-id="signInContent"]');
    if (refuse === undefined) {
      content?.remove();
      return;
    }
    const alert = doc.createElement('div');
    alert.setAttribute('data-automation-id', 'errorMessage');
    alert.setAttribute('role', 'alert');
    alert.textContent = refuse;
    content?.prepend(alert);
  });
  return seen;
}

function channelAnswering(answer: unknown) {
  const asked: unknown[] = [];
  return { asked, request: async (message: unknown) => {
    asked.push(message);
    return answer;
  } } as SignInContext['channel'] & { asked: unknown[] };
}

const attempt = (fixture: Fixture, address: string, channel: SignInContext['channel'], extra: Partial<SignInContext> = {},
  adapter: Adapter = workdayAdapter) =>
  signIn({ doc: fixture.doc, adapter, channel, href: () => address, isTop: true, signal: new AbortController().signal,
    settleMs: 1_200, preludeMs: 1_500, keptMs: 60_000, ...extra });

/** Create Account's "A minimum of N characters" set to `n` (a variant made in the test: no capture shows a tenant
 *  asking more than 16). */
function minimumOf(doc: Document, n: number): void {
  const item = Array.from(doc.querySelectorAll('[data-automation-id="passwordRulesList"] li'))
    .find((li) => /^A minimum of \d+ characters$/.test((li.textContent ?? '').trim()))!;
  item.textContent = `A minimum of ${n} characters`;
}

/** The sign-in log lines' numbers: none is ever the password's length. */
function signInLogNumbers(): number[] {
  return logs.mock.calls.filter((call) => /content\.sign-in/.test(String(call[0])))
    .flatMap((call) => Object.values((call[1] ?? {}) as Record<string, unknown>))
    .filter((value): value is number => typeof value === 'number');
}

// ── Item 1: the page's own password rules (WD-02, ICIMS-07) ─────────────────────────────────────────────────────────

describe('item 1: the page’s own password rules, read before typing (WD-02, ICIMS-07)', () => {
  it('Workday’s Create Account (aep) asking more characters than the saved password has: nothing typed, nothing pressed, '
    + 'the rule said; the log names the rule, never the password or its length', async () => {
    for (const credential of [AUTO, MANUAL]) {
      const fixture = await workday(aepCreateHtml, AEP);
      minimumOf(fixture.doc, 40);
      const seen = actAsWorkday(fixture);
      logs.mockClear();
      expect(await attempt(fixture, AEP, channelAnswering({ ok: true, data: credential }))).toBe('unavailable');
      expect(seen.presses).toBe(0);
      expect(boxesOf(fixture.doc)).toEqual({ email: '', password: '', verify: '', terms: false });
      expect(signInDetailOf(fixture.doc)).toEqual({ rule: { kind: 'length', minLength: 40 } });
      expect(logs.mock.calls).toContainEqual(['[tailorit-autofill] content.sign-in-refused',
        { rules: PASSWORD_RULE_KINDS.indexOf('length') }]);
      expect(JSON.stringify(logs.mock.calls)).not.toContain(PASSWORD);
      expect(signInLogNumbers()).not.toContain(PASSWORD.length);
      removeFixtures(document);
    }
  });

  it('types it where the page’s minimum is met (aep as captured: 8 characters)', async () => {
    const fixture = await workday(aepCreateHtml, AEP);
    const seen = actAsWorkday(fixture);
    expect(await attempt(fixture, AEP, channelAnswering({ ok: true, data: AUTO }))).toBe('continue');
    expect(seen.presses).toBe(1);
    expect(seen.typed).toMatchObject({ email: EMAIL, password: PASSWORD, verify: PASSWORD });
    expect(signInDetailOf(fixture.doc)).toBeNull();
  });

  it('refuses a saved password missing a class the page lists, each named (a synthetic page and rules)', async () => {
    const page = `<!doctype html><html><body><form id="create" method="post">
      <label for="email">Email</label><input id="email" type="email" autocomplete="email" style="width:300px">
      <label for="p1">Password</label><input id="p1" type="password" autocomplete="new-password" style="width:300px">
      <label for="p2">Verify New Password</label><input id="p2" type="password" autocomplete="new-password" style="width:300px">
      <button id="create-button" type="submit">Create Account</button></form></body></html>`;
    const cases: ReadonlyArray<readonly [PagePasswordRules, string, string]> = [
      [{ requires: ['upper'] }, 'e2e-dummy-password-not-real', 'upper'],
      [{ requires: ['lower'] }, 'E2E-DUMMY-PASSWORD-NOT-REAL', 'lower'],
      [{ requires: ['digit'] }, 'Dummy-Password-Not-Real', 'digit'],
      [{ requires: ['special'] }, 'E2eDummyPasswordNotReal', 'special'],
      [{ requires: ['alpha'] }, '2026-1111-2222-3333', 'alpha'],
      [{ minLength: 30, requires: ['upper'] }, 'e2e', 'length'],
    ];
    for (const [rules, password, kind] of cases) {
      const fixture = await loadFixture(document, page, { width: 1100, height: 900 });
      const adapter: Adapter = { ...genericAdapter, id: 'workday', passwordRules: () => rules };
      const channel = channelAnswering({ ok: true, data: { ...AUTO, password } });
      expect(await attempt(fixture, WORKDAY, channel, {}, adapter), kind).toBe('unavailable');
      expect(signInDetailOf(fixture.doc)?.rule?.kind, kind).toBe(kind);
      expect((fixture.doc.getElementById('email') as HTMLInputElement).value, kind).toBe('');
      removeFixtures(document);
    }
  });

  it('refuses one the same as the login where the page says so (iCIMS’s "cannot be the same as your login")', async () => {
    const fixture = await icims('githubinc-profile.frame-1');
    // A login that passes every class iCIMS lists, so the login rule is the one that refuses.
    const same = 'Alex.Rivera2026@example.com';
    const channel = channelAnswering({ ok: true, data: { host: '*', email: same, password: same, press: false } });
    expect(await signIn({ doc: fixture.doc, adapter: icimsAdapter, channel, href: () => fixture.address, isTop: false,
      claimed: true, section: true, signal: new AbortController().signal })).toBe('unavailable');
    expect(signInDetailOf(fixture.doc)).toEqual({ rule: { kind: 'login' } });
    expect((fixture.doc.getElementById('PersonProfileFields.Password') as HTMLInputElement).value).toBe('');
  });

  it('fails open: a rules hook that throws, or none at all, never stops the typing', async () => {
    const fixture = await workday(createHtml, WORKDAY);
    const throwing: Adapter = { ...workdayAdapter, passwordRules: () => {
      throw new Error('unreadable');
    } };
    actAsWorkday(fixture);
    expect(await attempt(fixture, WORKDAY, channelAnswering({ ok: true, data: MANUAL }), {}, throwing)).toBe('typed');
    expect(boxesOf(fixture.doc)).toMatchObject({ email: EMAIL, password: PASSWORD, verify: PASSWORD });
    removeFixtures(document);
    // Sign In has no rules of its own: none read, typed.
    const signInPage = await workday(signInHtml, WORKDAY);
    expect(await attempt(signInPage, WORKDAY, channelAnswering({ ok: true, data: MANUAL }))).toBe('typed');
  });

  it('a run at Create Account says the rule on the page’s toast', async () => {
    const fixture = await workday(aepCreateHtml, AEP);
    minimumOf(fixture.doc, 40);
    const seen = actAsWorkday(fixture);
    const settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn: 'manual' as const } };
    const worker = createFakeWorker({ settings, typeSignIn: true,
      script: { 'signin/credential': [{ ok: true, data: MANUAL }] } as never });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => AEP, isTop: true,
      adapters: () => [workdayAdapter], settle: { quietMs: 40 } });
    runtimes.push(runtime);
    expect(await runtime.fill()).toBe('paused');
    await vi.waitFor(() => expect(runtime.ui!.shadow.querySelector('.toast[data-kind="sign-in"] .notice')?.textContent)
      .toBe(COPY.toasts.passwordRule('length', 40)));
    expect(boxesOf(fixture.doc)).toMatchObject({ email: '', password: '', verify: '' });
    expect(seen.presses).toBe(0);
  });
});

// ── Item 2: coverage on the jr6 captures (WD-01, ICIMS-06) ───────────────────────────────────────────────────────────

describe('item 2: the jr6 captures’ account forms with the saved sign-in (WD-01, ICIMS-06)', () => {
  it.each([['Create Account', aepCreateHtml, AEP, 'create-account'], ['Sign In', brookfieldSignInHtml, BROOKFIELD, 'sign-in']] as const)(
    'Workday’s %s (aep, brookfield): typed and never pressed on Manual; typed and pressed on Auto',
    async (_name, html, address, wall) => {
      const manual = await workday(html, address);
      const kept = actAsWorkday(manual);
      const asked = channelAnswering({ ok: true, data: MANUAL });
      expect(await attempt(manual, address, asked)).toBe('typed');
      expect(asked.asked).toEqual([{ v: 1, type: 'signin/credential', wall }]);
      expect(kept.presses).toBe(0);
      expect(boxesOf(manual.doc)).toMatchObject({ email: EMAIL, password: PASSWORD,
        ...(wall === 'create-account' ? { verify: PASSWORD } : {}) });
      removeFixtures(document);
      const auto = await workday(html, address);
      const pressed = actAsWorkday(auto);
      expect(await attempt(auto, address, channelAnswering({ ok: true, data: AUTO }))).toBe('continue');
      expect(pressed.presses).toBe(1);
      expect(pressed.typed).toMatchObject({ email: EMAIL, password: PASSWORD });
    });

  it.each([['jr6-ars-profile', true], ['jr6-nyu-profile-parsed.frame-1', false], ['jr6-sentinel-basic-info.frame-1', false]] as const)(
    'iCIMS’s "Create a login" (%s): the login, the password and its re-entry typed, nothing required left in it, nothing pressed',
    async (name, top) => {
      for (const credential of [AUTO, MANUAL]) {
        const fixture = await icims(name);
        const root = icimsAdapter.detect(fixture.doc)!.formRoot;
        expect(accountLeft(icimsAdapter, fixture.doc, root), name).toBeGreaterThan(0);
        const clicked = vi.fn();
        fixture.doc.addEventListener('click', clicked, true);
        const channel = channelAnswering({ ok: true, data: credential });
        expect(await signIn({ doc: fixture.doc, adapter: icimsAdapter, channel, href: () => fixture.address, isTop: top,
          claimed: !top, section: true, signal: new AbortController().signal }), name).toBe('continue');
        expect(channel.asked).toEqual([{ v: 1, type: 'signin/credential', wall: 'create-account', typing: true }]);
        const box = (id: string) => (fixture.doc.getElementById(id) as HTMLInputElement).value;
        expect([box('PersonProfileFields.Login'), box('PersonProfileFields.Password'),
          box('PersonProfileFields.Password_Confirm')], name).toEqual([EMAIL, PASSWORD, PASSWORD]);
        expect(accountLeft(icimsAdapter, fixture.doc, root), name).toBe(0);
        expect(clicked).not.toHaveBeenCalled();
        removeFixtures(document);
      }
    });
});

// ── Item 3: the page's account errors (WD-05) ────────────────────────────────────────────────────────────────────────

describe('item 3: the kind of account error the page shows (WD-05)', () => {
  it('a verify-email alert on arrival (verily’s Sign In): nothing asked, nothing typed, the kind said', async () => {
    const fixture = await workday(verilyVerifyHtml, VERILY);
    const channel = channelAnswering({ ok: true, data: AUTO });
    expect(await attempt(fixture, VERILY, channel)).toBe('unavailable');
    expect(channel.asked).toEqual([]);
    expect(boxesOf(fixture.doc)).toMatchObject({ email: '', password: '' });
    expect(signInDetailOf(fixture.doc)).toEqual({ account: 'verify-email' });
  });

  it.each([
    ['verify-email', 'Verify your account before you sign in or request a verification email.'],
    ['reset-password', 'Your administrator has requested that you reset your password.'],
    ['wrong-credentials', 'Wrong email address or password, or your account might be locked.'],
  ] as const)('after a press the site refused with a %s alert: failed, the kind said, what was typed kept', async (kind, words) => {
    const fixture = await workday(signInHtml, WORKDAY);
    const seen = actAsWorkday(fixture, words);
    logs.mockClear();
    expect(await attempt(fixture, WORKDAY, channelAnswering({ ok: true, data: AUTO }))).toBe('failed');
    expect(seen.presses).toBe(1);
    expect(signInDetailOf(fixture.doc)).toEqual({ account: kind });
    expect(logs.mock.calls).toContainEqual(['[tailorit-autofill] content.sign-in',
      { account: ACCOUNT_ERROR_KINDS.indexOf(kind) }]);
    // The jr6 review (R1): what a refused press typed stays for the person's own press, a while.
    expect(boxesOf(fixture.doc)).toMatchObject({ email: EMAIL, password: PASSWORD });
  });

  it('an error with words of no kind: failed, as before, nothing more said', async () => {
    const fixture = await workday(signInHtml, WORKDAY);
    actAsWorkday(fixture, 'Something went wrong.');
    expect(await attempt(fixture, WORKDAY, channelAnswering({ ok: true, data: AUTO }))).toBe('failed');
    expect(signInDetailOf(fixture.doc)).toBeNull();
  });

  it('says each kind on the page’s toast: on arrival at a wall, and after a run’s own press', async () => {
    const settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn: 'auto' as const } };
    // Verily's Sign In at its /login address is a wall no run holds: the person's Autofill there is run/start (atWall).
    const verify = await workday(verilyVerifyHtml, VERILY);
    const first = createFakeWorker({ settings, typeSignIn: true });
    const one = await startContentRuntime(first.platform, verify.doc, { href: () => VERILY, isTop: true,
      adapters: () => [workdayAdapter], settle: { quietMs: 40 } });
    runtimes.push(one);
    expect(one.page).toBeNull();
    await first.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
    await vi.waitFor(() => expect(one.ui!.shadow.querySelector('.toast[data-kind="sign-in"] .notice')?.textContent)
      .toBe(COPY.toasts.account['verify-email']));
    expect(first.of('signin/credential')).toEqual([]);
    one.stop();
    removeFixtures(document);
    const wrong = await workday(signInHtml, WORKDAY);
    actAsWorkday(wrong, 'Wrong email address or password, or your account might be locked.');
    const second = createFakeWorker({ settings, typeSignIn: true,
      script: { 'signin/credential': [{ ok: true, data: AUTO }] } as never });
    const two = await startContentRuntime(second.platform, wrong.doc, { href: () => WORKDAY, isTop: true,
      adapters: () => [workdayAdapter], settle: { quietMs: 40 } });
    runtimes.push(two);
    expect(await two.fill()).toBe('paused');
    await vi.waitFor(() => expect(two.ui!.shadow.querySelector('.toast[data-kind="sign-in"] .notice')?.textContent)
      .toBe(COPY.toasts.account['wrong-credentials']), { timeout: 30_000 });
  }, 60_000);
});

// ── Item 4: the wait for a password to be saved (WD-04) ──────────────────────────────────────────────────────────────

/** settings/changed as the worker pushes it after a Sign-up Information save (typeSignIn true) or a delete. */
function typeSignInPushed(typeSignIn: boolean, signIn: 'manual' | 'auto' = 'manual') {
  const s = DEFAULT_SETTINGS;
  return { v: 1, type: 'settings/changed', settings: { panel: s.panel, view: s.view, modes: { next: s.modes.next,
    afterPageTurn: s.modes.afterPageTurn, submit: s.modes.submit, agentSkip: s.modes.agentSkip, signIn,
    noMatch: s.modes.noMatch, notifications: s.modes.notifications }, llm: s.llm,
  offerToSaveAnswers: s.offerToSaveAnswers, typeSignIn } } as const;
}

describe('item 4: none saved under Sign up & Autofill, the run waits for one, then tries the wall once more (WD-04)', () => {
  async function atCreateAccount(passwordWaitMs: number, credentials: unknown[]) {
    const fixture = await workday(createHtml, WORKDAY);
    const seen = actAsWorkday(fixture);
    const settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn: 'manual' as const } };
    const worker = createFakeWorker({ settings, script: { 'signin/credential': credentials } as never });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => WORKDAY, isTop: true,
      adapters: () => [workdayAdapter], settle: { quietMs: 40 }, signIn: { passwordWaitMs } });
    runtimes.push(runtime);
    await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false, signIn: true });
    await vi.waitFor(() => expect(runtime.ui?.toasts.shown).toEqual(['no-sign-in']), { timeout: 10_000 });
    return { fixture, seen, worker, runtime };
  }
  const toastText = (runtime: ContentRuntime) =>
    runtime.ui!.shadow.querySelector('.toast[data-kind="no-sign-in"] .notice')?.textContent;

  it('a password saved meanwhile: the wall is asked again, typed and pressed', async () => {
    const { seen, worker, runtime } = await atCreateAccount(60_000,
      [{ ok: false, error: 'not_found' }, { ok: true, data: AUTO }]);
    expect(toastText(runtime)).toBe(COPY.toasts.noSignInWaiting);
    expect(worker.of('signin/credential')).toHaveLength(1);
    // The person saves one in Sign-up Information: the worker pushes typeSignIn.
    await worker.platform.deliver(typeSignInPushed(true));
    await vi.waitFor(() => expect(seen.presses).toBe(1), { timeout: 10_000 });
    expect(worker.of('signin/credential')).toHaveLength(2);
    expect(seen.typed).toMatchObject({ email: EMAIL, password: PASSWORD, verify: PASSWORD });
  });

  it('none saved within the wait: nothing asked again, and the toast says to choose Sign Up & Autofill again', async () => {
    const { seen, worker, runtime } = await atCreateAccount(800, [{ ok: false, error: 'not_found' }]);
    await vi.waitFor(() => expect(toastText(runtime)).toBe(COPY.toasts.noSignIn), { timeout: 5_000 });
    // One saved later is no reason to ask: the wait is over.
    await worker.platform.deliver(typeSignInPushed(true));
    await deadline(600);
    expect(worker.of('signin/credential')).toHaveLength(1);
    expect(seen.presses).toBe(0);
  });

  it('the person’s Cancel ends the wait: a password saved after it asks nothing', async () => {
    const { seen, worker } = await atCreateAccount(60_000, [{ ok: false, error: 'not_found' }, { ok: true, data: AUTO }]);
    await worker.platform.deliver({ v: 1, type: 'run/cancel' });
    await worker.platform.deliver(typeSignInPushed(true));
    await deadline(800);
    expect(worker.of('signin/credential')).toHaveLength(1);
    expect(seen.presses).toBe(0);
  });

  // The agent's window is never told a password may be typed (background/settings.ts: typeSignIn false there): its run
  // never waits for one, and its toast never says it goes on by itself.
  it('the auto-apply agent’s run waits for none: the toast says to save one, nothing asked again', async () => {
    const fixture = await workday(createHtml, WORKDAY);
    const seen = actAsWorkday(fixture);
    const settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn: 'auto' as const } };
    const worker = createFakeWorker({ settings, script: { 'signin/credential': [{ ok: false, error: 'not_found' },
      { ok: true, data: AUTO }] } as never });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => WORKDAY, isTop: true,
      adapters: () => [workdayAdapter], settle: { quietMs: 40 }, signIn: { passwordWaitMs: 60_000 } });
    runtimes.push(runtime);
    expect(await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false, agent: true }))
      .toEqual({ ok: true, data: {} });
    await vi.waitFor(() => expect(runtime.ui?.toasts.shown).toEqual(['no-sign-in']), { timeout: 10_000 });
    expect(worker.of('run/begin')).toEqual([expect.objectContaining({ trigger: 'agent' })]);
    expect(toastText(runtime)).toBe(COPY.toasts.noSignIn);
    await worker.platform.deliver(typeSignInPushed(true));
    await deadline(800);
    expect(worker.of('signin/credential')).toHaveLength(1);
    expect(seen.presses).toBe(0);
  });

  it('a wall with no form (Sign up & Autofill there): the same wait, then the wall asked again', async () => {
    const fixture = await workday(createHtml, WORKDAY);
    const seen = actAsWorkday(fixture);
    // The account page as a wall no run holds (as the v4 tests draw one: no form root of its own).
    const walled: Adapter = { ...workdayAdapter, detect: () => null };
    const settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn: 'manual' as const } };
    const worker = createFakeWorker({ settings, script: { 'signin/credential': [{ ok: false, error: 'not_found' },
      { ok: true, data: AUTO }] } as never });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => WORKDAY, isTop: true,
      adapters: () => [walled], settle: { quietMs: 40 }, signIn: { passwordWaitMs: 60_000 } });
    runtimes.push(runtime);
    expect(runtime.page).toBeNull();
    await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false, signIn: true });
    await vi.waitFor(() => expect(runtime.ui?.toasts.shown).toEqual(['no-sign-in']), { timeout: 10_000 });
    expect(toastText(runtime)).toBe(COPY.toasts.noSignInWaiting);
    await worker.platform.deliver(typeSignInPushed(true));
    await vi.waitFor(() => expect(seen.presses).toBe(1), { timeout: 10_000 });
    expect(worker.of('signin/credential')).toHaveLength(2);
  });
});

// ── Item 7: Cancel during a wall's own sign-in step ─────────────────────────────────────────────────────────────────

describe('item 7: the panel’s Cancel during a wall’s own sign-in step (APPLY-MERGE round 2 §8 item 9)', () => {
  it('says entering while it works; run/cancel ends it: nothing typed or pressed after, entering cleared', async () => {
    const fixture = await workday(createHtml, WORKDAY);
    const seen = actAsWorkday(fixture);
    const walled: Adapter = { ...workdayAdapter, detect: () => null };
    let answer: (value: unknown) => void = () => undefined;
    const held = new Promise((resolve) => {
      answer = resolve;
    });
    const settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn: 'manual' as const } };
    const worker = createFakeWorker({ settings, script: { 'signin/credential': [held] } as never });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => WORKDAY, isTop: true,
      adapters: () => [walled], settle: { quietMs: 40 } });
    runtimes.push(runtime);
    await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false, signIn: true });
    // The credential is asked while the frame says it is entering (the panel's spinner, with Cancel).
    await vi.waitFor(() => expect(worker.of('signin/credential')).toHaveLength(1));
    expect(worker.of('frame/wall').at(-1)).toMatchObject({ wall: 'create-account', entering: true });
    await worker.platform.deliver({ v: 1, type: 'run/cancel' });
    answer({ ok: true, data: AUTO });
    await deadline(800);
    expect(seen.presses).toBe(0);
    expect(boxesOf(fixture.doc)).toMatchObject({ email: '', password: '', verify: '' });
    await vi.waitFor(() => expect(worker.of('frame/wall').at(-1)).not.toHaveProperty('entering'));
  });
});

// ── jr6 ifix B1 (the integration review's behaviour lens): a wall's own step and the back/forward cache ─────────────

describe('jr6 ifix B1: a wall step waiting for a password, and the back/forward cache', () => {
  /** frame/hello's answer as the worker gives it, with typeSignIn as said. */
  const helloAnswer = (typeSignIn: boolean) => ({ ok: true, data: { frameId: 0, connected: true,
    settings: typeSignInPushed(typeSignIn).settings } });

  /** Sign up & Autofill at Workday's account page drawn as a wall with no form, none saved: the step waits (WD-04). */
  async function waiting(hellos: unknown[] = []) {
    const fixture = await workday(createHtml, WORKDAY);
    const seen = actAsWorkday(fixture);
    const walled: Adapter = { ...workdayAdapter, detect: () => null };
    const settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn: 'manual' as const } };
    const worker = createFakeWorker({ settings, script: { 'signin/credential': [{ ok: false, error: 'not_found' },
      { ok: true, data: AUTO }], ...(hellos.length === 0 ? {} : { 'frame/hello': hellos }) } as never });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => WORKDAY, isTop: true,
      adapters: () => [walled], settle: { quietMs: 40 }, signIn: { passwordWaitMs: 60_000 } });
    runtimes.push(runtime);
    await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false, signIn: true });
    await vi.waitFor(() => expect(runtime.ui?.toasts.shown).toEqual(['no-sign-in']), { timeout: 10_000 });
    expect(worker.of('frame/wall').at(-1)).toMatchObject({ wall: 'create-account', entering: true });
    expect(worker.of('signin/credential')).toHaveLength(1);
    return { fixture, seen, worker, runtime };
  }

  it('kept in the cache, the step ends (no lock held); back, its wall is told afresh and Sign up & Autofill acts again',
    async () => {
      const { seen, worker, runtime } = await waiting();
      // The person leaves; the browser keeps the page (a trusted pagehide with persisted set).
      runtime.cached();
      await vi.waitFor(() => expect(worker.of('frame/wall').at(-1)).not.toHaveProperty('entering'));
      // Its toast no longer says the step goes on by itself.
      expect(runtime.ui?.toasts.shown).toEqual([]);
      const told = worker.of('frame/wall').length;
      // Back: the worker forgot this frame while it was away; the hello, then the wall told again.
      await runtime.restored();
      await vi.waitFor(() => expect(worker.of('frame/wall').length).toBeGreaterThan(told));
      expect(worker.of('frame/wall').at(-1)).toMatchObject({ wall: 'create-account' });
      // The person's Sign up & Autofill is not held by the step that was frozen: asked, typed and pressed.
      await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false, signIn: true });
      await vi.waitFor(() => expect(seen.presses).toBe(1), { timeout: 10_000 });
      expect(worker.of('signin/credential')).toHaveLength(2);
    });

  it('a hello answered while the step waits, saying a password may be typed now, wakes it: the wall asked again',
    async () => {
      // restored() stands for any hello this document says again (here with no hide before it, the step still waiting).
      const { seen, worker, runtime } = await waiting([helloAnswer(false), helloAnswer(true)]);
      await runtime.restored();
      await vi.waitFor(() => expect(seen.presses).toBe(1), { timeout: 10_000 });
      expect(worker.of('signin/credential')).toHaveLength(2);
    });
});

// ── iCIMS's captures at their own addresses ─────────────────────────────────────────────────────────────────────────

const PAGES = import.meta.glob('../../fixtures/icims/*.html', { query: '?raw', import: 'default', eager: true }) as
  Record<string, string>;
const ROUTES = import.meta.glob('../../fixtures/icims/*.routes.json', { import: 'default', eager: true }) as
  Record<string, Record<string, string>>;
const byFile = <T>(table: Record<string, T>, file: string): T | undefined =>
  Object.entries(table).find(([path]) => path.endsWith(`/${file}`))?.[1];

/** An iCIMS capture's page or frame at its own address (its route map's), a submission posting nothing. */
async function icims(name: string): Promise<Fixture & { address: string }> {
  const base = name.replace(/\.frame-\d+$/, '');
  const routes = byFile(ROUTES, `${base}.routes.json`) ?? {};
  const address = Object.entries(routes).find(([, path]) => path === `fixtures/icims/${name}.html`)?.[0] ?? '';
  const fixture = await loadFixture(document, byFile(PAGES, `${name}.html`) ?? '', SNAPSHOT_VIEWPORT);
  const element = fixture.doc.createElement('base');
  element.href = address;
  fixture.doc.head.prepend(element);
  fixture.doc.addEventListener('submit', (event) => event.preventDefault(), true);
  return { ...fixture, address };
}

// ── CHAINS regression 1 (CHAINS.md section 4): the run's entry choice pressed once ───────────────────────────────────

/** The registry's adapters for an address, each platform one reading the page as served at `address`. */
const registry = (doc: Document, address: string) => (url: URL): Adapter[] =>
  adaptersFor(url, doc).map((adapter) => (adapter.id === 'generic' ? adapter : servedAdapter(adapter, address)));

/** A hello that says the frame has a form now. */
const helloWithForm = (worker: FakeWorker) => worker.messages
  .some((message) => message.type === 'frame/hello' && message.hasForm === true);

/** Jobvite's /apply gate (ninjaone-consent-empty) at `address`, its AngularJS stood in for (as jr6-chains' pin does):
 *  a residence chosen shows ninjaone-consent's policy details with "I Accept" and "I Decline", and hides the gate's
 *  Cancel. Each press of the consent form's submit buttons is recorded by its words; the form's POST is held, so the
 *  page stays shown, as it does in a browser until the next page loads. */
async function jobviteGate(address: string) {
  const consent = new DOMParser().parseFromString(ninjaConsentHtml, 'text/html');
  const gate = await openAt(ninjaGateHtml, address);
  gate.doc.addEventListener('submit', (event) => event.preventDefault(), true);
  const select = gate.doc.querySelector<HTMLSelectElement>('select#jv-country-select')!;
  select.addEventListener('change', () => {
    if (select.value === '') return;
    const form = gate.doc.querySelector('form[name="consentForm"]')!;
    for (const back of Array.from(form.querySelectorAll('div[ng-show="showBackButton"]'))) back.classList.add('ng-hide');
    form.querySelector('div[ng-show="showConsentPolicyDetails"]')!.replaceWith(gate.doc.importNode(
      consent.querySelector('form[name="consentForm"] div[ng-show="showConsentPolicyDetails"]')!, true));
  });
  const pressed: string[] = [];
  gate.doc.addEventListener('click', (event) => {
    const button = (event.target as Element).closest('form[name="consentForm"] button');
    if (button !== null) pressed.push((button.textContent ?? '').replace(/\s+/g, ' ').trim());
  }, true);
  return { ...gate, select, pressed };
}

describe('the run’s entry choice is pressed once, and the run waits for what it brings (CHAINS regression 1)', () => {
  it('Jobvite’s consent gate: "I Accept" pressed once while its form posts (the page still shown), never again there',
    async () => {
      const APPLY = addressOf(ninjaGateRoutes, 'fixtures/jobvite/ninjaone-consent-empty.html');
      const gate = await jobviteGate(APPLY);
      const { worker, runtime } = await runtimeAt(gate.doc, APPLY, registry(gate.doc, APPLY));
      runtimes.push(runtime);
      await vi.waitFor(() => expect(helloWithForm(worker)).toBe(true), { timeout: 8_000 });
      await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
      await vi.waitFor(() => expect(gate.pressed.length).toBeGreaterThan(0), { timeout: 30_000 });
      // The residence chosen from the profile (RULES item 16), then the policy's "I Accept" (never "I Decline").
      expect(gate.select.selectedIndex).toBe(1);
      // A form's POST and the next page take a moment: 2 s here, the page still shown all along.
      await deadline(2_000);
      expect(gate.pressed).toEqual(['I Accept']);
    }, 60_000);
});
