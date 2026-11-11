/*
 * jr6: the job-site sign-up information typed into the sites' own account forms (content/sign-in.ts with each
 * adapter's declarations), on the converted captures (docs/FIXTURES.md) with a small stand-in for the platform's own
 * script, and a synthetic sign-in that meets the password rules:
 * - Workday's Create Account (Workday's own tenant, Salesforce's, and Verily's from the owner's snapshot of 2026-11-08):
 *   the email, the password and Verify New Password typed, the account's terms box ticked where it has one; and its Sign
 *   In (Workday's, Snap's): the email and the password;
 * - Auto (the worker's answer `press`): the site's own Create Account or Sign In (its visible click_filter) pressed once;
 * - Manual (`press` false, or this run's own typeOnly while the worker says Auto): the same typed and ticked, nothing
 *   pressed ('typed'), the boxes kept for the person's own press, SIGN_IN_KEPT_MS at most (then the password boxes are
 *   written empty again, the email kept), as a sign-in refused for its check is (the v5 review's S8);
 * - iCIMS's "Create a login" inside the profile (careers-githubinc's, uscareers-nyu's): the login (the email), the
 *   password and Password (Re-enter) typed, Submit Profile never pressed either way; its email gate (East West Bank's):
 *   the email alone, Next pressed on Auto alone;
 * - a run on Workday's Create Account: on Manual with a password saved (ContentSettings.typeSignIn) it is typed and the
 *   page's toast says the press is the person's; on Manual with none, nothing is asked; on Auto it is typed and pressed.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import createHtml from '../../fixtures/workday/workday-create-account.html?raw';
import salesforceHtml from '../../fixtures/workday/salesforce-create-account.html?raw';
import verilyHtml from '../../fixtures/workday/s2-verily-create-account.html?raw';
import signInHtml from '../../fixtures/workday/workday-sign-in.html?raw';
import snapHtml from '../../fixtures/workday/snap-sign-in.html?raw';
import { icimsAdapter } from '../adapters/icims';
import { SNAPSHOT_VIEWPORT } from '../adapters/test/expectations.testkit';
import { workdayAdapter } from '../adapters/workday';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { loadFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import type { SignInCredential } from '../messaging/schemas';
import { COPY } from '../shared/copy';
import { createFakeWorker, testVocab } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';
import { signIn, type SignInContext } from './sign-in';

const ACCOUNT = 'https://workday.wd5.myworkdayjobs.com/en-US/Workday/job/x/Senior-Product-Manager--Technical_JR-0110787/apply/applyManually';
/** A synthetic sign-in, the every-site one, whose password meets the rules (core/signup-password.ts). */
const SAVED = { host: '*', email: 'alex.rivera@example.com', password: 'Synthetic-Fill-Pass-2026!' } as const;
const AUTO: SignInCredential = { ...SAVED, press: true };
const MANUAL: SignInCredential = { ...SAVED, press: false };

beforeAll(() => {
  testVocab();
});
const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

/** A Workday capture as the tenant serves it: its base address, its account form with neither method nor action. */
async function served(html: string): Promise<Fixture> {
  const fixture = await loadFixture(document, html, { width: 1280, height: 900 });
  const base = fixture.doc.createElement('base');
  base.href = ACCOUNT;
  fixture.doc.head.prepend(base);
  const form = fixture.doc.querySelector('form[data-automation-id="signInFormo"]')!;
  form.removeAttribute('action');
  form.removeAttribute('method');
  return fixture;
}

/** What the stand-in for Workday's script saw: its click_filter's presses, and the boxes as they were then. */
interface Seen {
  presses: number;
  typed?: Record<string, string | boolean>;
}

/** Workday's script, as far as an account needs it: a click on the visible click_filter reads the form and the account
 *  view leaves (as Workday's own does, by script). Nothing navigates. */
function actAsWorkday(fixture: Fixture): Seen {
  const seen: Seen = { presses: 0 };
  const doc = fixture.doc;
  doc.addEventListener('click', (event) => {
    if ((event.target as Element).getAttribute('data-automation-id') !== 'click_filter') return;
    seen.presses += 1;
    seen.typed = boxesOf(fixture);
    doc.querySelector('[data-automation-id="signInContent"]')?.remove();
  });
  return seen;
}

/** The account form's boxes as they hold now. */
function boxesOf(fixture: Fixture): Record<string, string | boolean> {
  const box = (id: string) => fixture.doc.querySelector<HTMLInputElement>(`input[data-automation-id="${id}"]`);
  return { email: box('email')?.value ?? '', password: box('password')?.value ?? '', verify: box('verifyPassword')?.value ?? '',
    terms: box('createAccountCheckbox')?.checked ?? false };
}

function channelAnswering(answer: unknown) {
  const asked: unknown[] = [];
  return { asked, request: async (message: unknown) => {
    asked.push(message);
    return answer;
  } } as SignInContext['channel'] & { asked: unknown[] };
}

const attempt = (fixture: Fixture, channel: SignInContext['channel'], extra: Partial<SignInContext> = {}) =>
  signIn({ doc: fixture.doc, adapter: workdayAdapter, channel, href: () => ACCOUNT, isTop: true,
    signal: new AbortController().signal, settleMs: 1_500, preludeMs: 1_500, ...extra });

describe('Workday’s Create Account and Sign In with the saved job-site sign-in (jr6)', () => {
  const CREATE = [['Workday', createHtml, true], ['Salesforce', salesforceHtml, true], ['Verily', verilyHtml, false]] as const;

  it.each(CREATE)('Create Account (%s) on Auto: the email, the password and its verify typed, the terms ticked, pressed',
    async (_name, html, hasTerms) => {
      const fixture = await served(html);
      const seen = actAsWorkday(fixture);
      const channel = channelAnswering({ ok: true, data: AUTO });
      expect(await attempt(fixture, channel)).toBe('continue');
      expect(channel.asked).toEqual([{ v: 1, type: 'signin/credential', wall: 'create-account' }]);
      expect(seen).toEqual({ presses: 1, typed: { email: SAVED.email, password: SAVED.password, verify: SAVED.password,
        terms: hasTerms } });
    });

  it.each(CREATE)('Create Account (%s) on Manual: the same typed and ticked, never pressed, the boxes kept',
    async (_name, html, hasTerms) => {
      for (const [credential, extra] of [[MANUAL, {}], [AUTO, { typeOnly: true as const }]] as const) {
        const fixture = await served(html);
        const seen = actAsWorkday(fixture);
        expect(await attempt(fixture, channelAnswering({ ok: true, data: credential }), extra)).toBe('typed');
        expect(seen.presses).toBe(0);
        expect(boxesOf(fixture)).toEqual({ email: SAVED.email, password: SAVED.password, verify: SAVED.password,
          terms: hasTerms });
        removeFixtures(document);
      }
    });

  it('keeps a sign-in typed on Manual for the person’s press for a while only: then the password boxes are emptied',
    async () => {
      const fixture = await served(createHtml);
      const seen = actAsWorkday(fixture);
      expect(await attempt(fixture, channelAnswering({ ok: true, data: MANUAL }), { keptMs: 300 })).toBe('typed');
      expect(boxesOf(fixture)).toMatchObject({ password: SAVED.password, verify: SAVED.password });
      await vi.waitFor(() => expect(boxesOf(fixture)).toEqual({ email: SAVED.email, password: '', verify: '',
        terms: true }), { timeout: 3_000 });
      expect(seen.presses).toBe(0);
    });

  it.each([['Workday', signInHtml], ['Snap', snapHtml]] as const)(
    'Sign In (%s): the email and the password, pressed on Auto alone', async (_name, html) => {
      const fixture = await served(html);
      const seen = actAsWorkday(fixture);
      const channel = channelAnswering({ ok: true, data: AUTO });
      expect(await attempt(fixture, channel)).toBe('continue');
      expect(channel.asked).toEqual([{ v: 1, type: 'signin/credential', wall: 'sign-in' }]);
      expect(seen).toEqual({ presses: 1, typed: { email: SAVED.email, password: SAVED.password, verify: '', terms: false } });
      removeFixtures(document);
      const manual = await served(html);
      const none = actAsWorkday(manual);
      expect(await attempt(manual, channelAnswering({ ok: true, data: MANUAL }))).toBe('typed');
      expect(none.presses).toBe(0);
      expect(boxesOf(manual)).toMatchObject({ email: SAVED.email, password: SAVED.password });
    });
});

// ── iCIMS ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const PAGES = import.meta.glob('../../fixtures/icims/*.html', { query: '?raw', import: 'default', eager: true }) as
  Record<string, string>;
const ROUTES = import.meta.glob('../../fixtures/icims/*.routes.json', { import: 'default', eager: true }) as
  Record<string, Record<string, string>>;
const byFile = <T>(table: Record<string, T>, file: string): T | undefined =>
  Object.entries(table).find(([path]) => path.endsWith(`/${file}`))?.[1];

/** An iCIMS capture's frame at its own address (its route map's), a submission posting nothing. */
async function icims(name: string) {
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

describe('iCIMS’s "Create a login" and its email gate with the saved job-site sign-in (jr6)', () => {
  it.each(['githubinc-profile.frame-1', 'nyu-profile.frame-1'])(
    '%s: the login, the password and its re-entry typed; Submit Profile never pressed, on Auto or Manual', async (name) => {
      for (const credential of [AUTO, MANUAL]) {
        const fixture = await icims(name);
        const submit = fixture.doc.querySelector<HTMLElement>('input#cp_form_submit_i')!;
        const clicked = vi.fn();
        submit.addEventListener('click', clicked);
        const channel = channelAnswering({ ok: true, data: credential });
        expect(await signIn({ doc: fixture.doc, adapter: icimsAdapter, channel, href: () => fixture.address, isTop: false,
          claimed: true, section: true, signal: new AbortController().signal })).toBe('continue');
        expect(channel.asked).toEqual([{ v: 1, type: 'signin/credential', wall: 'create-account' }]);
        const box = (id: string) => (fixture.doc.getElementById(id) as HTMLInputElement).value;
        expect([box('PersonProfileFields.Login'), box('PersonProfileFields.Password'),
          box('PersonProfileFields.Password_Confirm')]).toEqual([SAVED.email, SAVED.password, SAVED.password]);
        expect(clicked).not.toHaveBeenCalled();
        removeFixtures(document);
      }
    });

  it('its email gate (East West Bank’s): the email typed, Next pressed on Auto alone', async () => {
    for (const credential of [{ host: '*', email: SAVED.email, press: true }, { host: '*', email: SAVED.email, press: false }]) {
      const fixture = await icims('eastwestbank-email-gate.frame-1');
      // As iCIMS serves it: a POST to the portal's own gate.
      const gate = fixture.doc.querySelector<HTMLFormElement>('form#enterEmailForm')!;
      gate.setAttribute('action', fixture.address.replace('?in_iframe=1', '?step=email&in_iframe=1'));
      gate.setAttribute('method', 'post');
      const next = fixture.doc.querySelector<HTMLElement>('input#enterEmailSubmitButton')!;
      const pressed = vi.fn();
      next.addEventListener('click', pressed);
      const channel = channelAnswering({ ok: true, data: credential });
      const outcome = await signIn({ doc: fixture.doc, adapter: icimsAdapter, channel, href: () => fixture.address,
        isTop: false, claimed: true, signal: new AbortController().signal, settleMs: 600 });
      expect(channel.asked).toEqual([{ v: 1, type: 'signin/credential', wall: 'email-gate' }]);
      expect((fixture.doc.querySelector('input#email') as HTMLInputElement).value).toBe(SAVED.email);
      expect(pressed).toHaveBeenCalledTimes(credential.press ? 1 : 0);
      if (!credential.press) expect(outcome).toBe('typed');
      removeFixtures(document);
    }
  });
});

// ── A run at Workday's Create Account ────────────────────────────────────────────────────────────────────────────────

describe('a run at Workday’s Create Account (jr6)', () => {
  async function run(mode: 'auto' | 'manual', typeSignIn: boolean, credential: SignInCredential) {
    const fixture = await served(createHtml);
    const seen = actAsWorkday(fixture);
    const settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn: mode } };
    const worker = createFakeWorker({ settings, typeSignIn, script: { 'signin/credential': [{ ok: true, data: credential }] } as never });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => ACCOUNT, isTop: true,
      adapters: () => [workdayAdapter], settle: { quietMs: 40 } });
    runtimes.push(runtime);
    expect(await runtime.fill()).toBe('paused');
    return { fixture, seen, worker, runtime };
  }

  it('on Manual with a password saved: typed, never pressed, and the toast says the press is the person’s', async () => {
    const { fixture, seen, worker, runtime } = await run('manual', true, MANUAL);
    await vi.waitFor(() => expect(worker.of('signin/credential')).toHaveLength(1));
    await vi.waitFor(() => expect(boxesOf(fixture)).toEqual({ email: SAVED.email, password: SAVED.password,
      verify: SAVED.password, terms: true }));
    await vi.waitFor(() => expect(runtime.ui!.toasts.shown).toEqual(['sign-in']));
    expect(runtime.ui!.shadow.querySelector('.toast[data-kind="sign-in"] .notice')?.textContent).toBe(COPY.toasts.signInTyped);
    expect(seen.presses).toBe(0);
    // Not Sign-in Auto: the report never says it signs in.
    expect(worker.reports.flatMap((report) => report.notices.map((notice) => notice.code))).not.toContain('sign-in-auto');
    // Nothing of the sign-in reached a report or a stored run.
    const held = JSON.stringify([worker.reports, worker.liveReports, worker.runStates]);
    expect(held).not.toContain(SAVED.password);
    expect(held).not.toContain(SAVED.email);
  });

  it('on Manual with none saved: nothing asked, nothing typed', async () => {
    const { fixture, seen, worker, runtime } = await run('manual', false, MANUAL);
    await vi.waitFor(() => expect(runtime.ui!.toasts.shown).toEqual(['sign-in']));
    expect(runtime.ui!.shadow.querySelector('.toast[data-kind="sign-in"] .notice')?.textContent).toBe(COPY.toasts.signIn);
    expect(worker.of('signin/credential')).toEqual([]);
    expect(boxesOf(fixture)).toEqual({ email: '', password: '', verify: '', terms: false });
    expect(seen.presses).toBe(0);
  });

  it('on Auto: typed and Create Account pressed', async () => {
    const { seen, worker } = await run('auto', true, AUTO);
    await vi.waitFor(() => expect(seen.presses).toBe(1), { timeout: 5_000 });
    expect(seen.typed).toEqual({ email: SAVED.email, password: SAVED.password, verify: SAVED.password, terms: true });
    expect(worker.of('signin/credential')).toEqual([expect.objectContaining({ type: 'signin/credential', wall: 'create-account' })]);
  });
});
