/*
 * jr6: the job-site sign-up information typed into the sites' own account forms (content/sign-in.ts with each
 * adapter's declarations), on the converted captures (docs/FIXTURES.md) with a small stand-in for the platform's own
 * script, and a synthetic sign-in that meets the password rules:
 * - Workday's Create Account (Workday's own tenant, Salesforce's, and Verily's from the owner's snapshot of 2026-11-08):
 *   the email, the password and Verify New Password typed, the account's terms box ticked where it has one; and its Sign
 *   In (Workday's, Snap's): the email and the password;
 * - Auto (the worker's answer `press`): the site's own Create Account or Sign In (its visible click_filter) pressed once;
 * - Manual (`press` false, or this run's own typeOnly while the worker says Auto): the same typed and ticked, nothing
 *   pressed ('typed'), the boxes kept for the person's own press until the run stops or ends or the document goes (the
 *   jr6 review's R11: no timer; then the password boxes are written empty again, the email kept);
 * - iCIMS's "Create a login" inside the profile (careers-githubinc's, uscareers-nyu's): the login (the email), the
 *   password and Password (Re-enter) typed, Submit Profile never pressed either way; its email gate (East West Bank's):
 *   the email alone, Next pressed on Auto alone;
 * - a run on Workday's Create Account: on Manual with a password saved (ContentSettings.typeSignIn) it is typed and the
 *   page's toast says the press is the person's; on Manual with none, nothing is asked; on Auto it is typed and pressed.
 * - the jr6 review: the browser's own submission held while a typed password waits for the person (sec-1); `typing`
 *   asked for what this frame never presses, and a refused press kept for the person (R1); a box typed into stays an
 *   auth field when the page shows it as text (sec-5); the keeps ended when the password is deleted (sec-8); a hidden
 *   tab typed into only once shown (sec-3); a password longer than its box never typed (R2); a form whose press is the
 *   person's typed once per document; and runs at Manual's walls and account section (R7).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import createHtml from '../../fixtures/workday/workday-create-account.html?raw';
import salesforceHtml from '../../fixtures/workday/salesforce-create-account.html?raw';
import verilyHtml from '../../fixtures/workday/s2-verily-create-account.html?raw';
import signInHtml from '../../fixtures/workday/workday-sign-in.html?raw';
import snapHtml from '../../fixtures/workday/snap-sign-in.html?raw';
import { genericAdapter } from '../adapters/generic';
import { icimsAdapter } from '../adapters/icims';
import { SNAPSHOT_VIEWPORT } from '../adapters/test/expectations.testkit';
import type { Adapter } from '../adapters/types';
import { workdayAdapter } from '../adapters/workday';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { loadFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import { kindOf } from '../dom/kinds';
import { deadline } from '../dom/time';
import type { SignInCredential } from '../messaging/schemas';
import { COPY } from '../shared/copy';
import { createFakeWorker, testVocab } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';
import { dropKeptSignIns, signIn, signInHandedOver, type SignInContext } from './sign-in';

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
      // jr6 ifix SEC-1: the page's own rules go with the ask (Workday's "Password Requirements").
      expect(channel.asked).toEqual([{ v: 1, type: 'signin/credential', wall: 'create-account',
        rules: { minLength: 8, requires: ['upper', 'lower', 'digit', 'special', 'alpha'] } }]);
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

  it('keeps a sign-in typed on Manual for the person’s press until the run ends, with no timer (the jr6 review, R11)',
    async () => {
      const fixture = await served(createHtml);
      const seen = actAsWorkday(fixture);
      const run = new AbortController();
      expect(await attempt(fixture, channelAnswering({ ok: true, data: MANUAL }), { keptMs: 300, signal: run.signal }))
        .toBe('typed');
      // Past the keep time a refused press has, it is still there for the person.
      await deadline(800);
      expect(boxesOf(fixture)).toMatchObject({ password: SAVED.password, verify: SAVED.password });
      // The run stops (or ends, or the document goes): the password boxes are emptied, the email kept.
      run.abort();
      expect(boxesOf(fixture)).toEqual({ email: SAVED.email, password: '', verify: '', terms: true });
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
        // The jr6 review (R1): a section is never pressed here, which the ask says.
        // jr6 ifix SEC-1: the page's own rules go with the ask (iCIMS's create-login rules, its boxes' maxlength).
        expect(channel.asked).toEqual([{ v: 1, type: 'signin/credential', wall: 'create-account', typing: true,
          rules: { maxLength: 128, minLength: name === 'nyu-profile.frame-1' ? 10 : 8, notLogin: true, requires: ['alpha', 'lower', 'upper', 'digit', 'special'] } }]);
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
  async function run(mode: 'auto' | 'manual', typeSignIn: boolean, credential: SignInCredential,
    script: Record<string, unknown[]> = {}) {
    const fixture = await served(createHtml);
    const seen = actAsWorkday(fixture);
    const settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn: mode } };
    const worker = createFakeWorker({ settings, typeSignIn,
      script: { 'signin/credential': [{ ok: true, data: credential }], ...script } as never });
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
    expect(worker.of('signin/credential')).toEqual([{ v: 1, type: 'signin/credential', wall: 'create-account',
      rules: { minLength: 8, requires: ['upper', 'lower', 'digit', 'special', 'alpha'] } }]); // jr6 ifix SEC-1
  });

  // The jr6 review (R7): the run's own Manual is what keeps the press the person's while the worker would say press (a
  // Sign Up & Autofill grant still live for the tab, a plain Autofill now).
  it('on Manual: typed and never pressed, though the worker’s answer says press (the jr6 review, R7)', async () => {
    const { fixture, seen, worker, runtime } = await run('manual', true, AUTO);
    await vi.waitFor(() => expect(boxesOf(fixture)).toEqual({ email: SAVED.email, password: SAVED.password,
      verify: SAVED.password, terms: true }));
    await vi.waitFor(() => expect(runtime.ui!.toasts.shown).toEqual(['sign-in']));
    await deadline(1_000);
    expect(seen.presses).toBe(0);
    // The ask said it never presses (the jr6 review, R1).
    expect(worker.of('signin/credential')).toEqual([{ v: 1, type: 'signin/credential', wall: 'create-account',
      typing: true, rules: { minLength: 8, requires: ['upper', 'lower', 'digit', 'special', 'alpha'] } }]); // jr6 ifix SEC-1
  });

  it('empties what it typed for the person once no password may be typed any more (the jr6 review, sec-8)', async () => {
    const { fixture, worker } = await run('manual', true, MANUAL);
    await vi.waitFor(() => expect(boxesOf(fixture)).toMatchObject({ password: SAVED.password, verify: SAVED.password }));
    // The password deleted: the worker tells every frame its settings, typeSignIn false.
    const settings = DEFAULT_SETTINGS;
    await worker.platform.deliver({ v: 1, type: 'settings/changed', settings: { panel: settings.panel, view: settings.view,
      modes: { next: settings.modes.next, afterPageTurn: settings.modes.afterPageTurn, submit: settings.modes.submit,
        agentSkip: settings.modes.agentSkip, signIn: 'manual', noMatch: settings.modes.noMatch,
        notifications: settings.modes.notifications }, llm: settings.llm, offerToSaveAnswers: settings.offerToSaveAnswers,
      typeSignIn: false } });
    expect(boxesOf(fixture)).toEqual({ email: SAVED.email, password: '', verify: '', terms: true });
  });

  // jr6 INT-2 (IFIX-CONTENT's open item 1; sec-8 as above): the password deleted while the page sat in the back/forward
  // cache, where no settings/changed reaches it. Back, the worker's answer to the frame's hello says none may be typed:
  // what was typed for the person's press is written empty, as at settings/changed.
  it('empties what it typed for the person when, back from the back/forward cache, hello says none may be typed (sec-8)',
    async () => {
      const hellos: unknown[] = [];
      const { fixture, runtime } = await run('manual', true, MANUAL, { 'frame/hello': hellos });
      await vi.waitFor(() => expect(boxesOf(fixture)).toMatchObject({ password: SAVED.password, verify: SAVED.password }));
      // The person leaves; the browser keeps the page (a trusted pagehide with persisted set): the press stays theirs,
      // and what was typed for it stays with the page.
      runtime.cached();
      expect(boxesOf(fixture)).toMatchObject({ password: SAVED.password, verify: SAVED.password });
      // Meanwhile the password is deleted. Back (a persisted pageshow), the frame says hello again.
      const s = DEFAULT_SETTINGS;
      hellos.push({ ok: true, data: { frameId: 0, connected: true, settings: { panel: s.panel, view: s.view,
        modes: { next: s.modes.next, afterPageTurn: s.modes.afterPageTurn, submit: s.modes.submit,
          agentSkip: s.modes.agentSkip, signIn: 'manual', noMatch: s.modes.noMatch, notifications: s.modes.notifications },
        llm: s.llm, offerToSaveAnswers: s.offerToSaveAnswers, typeSignIn: false } } });
      await runtime.restored();
      expect(hellos).toEqual([]);
      expect(boxesOf(fixture)).toEqual({ email: SAVED.email, password: '', verify: '', terms: true });
    });
});

// ── The jr6 review ───────────────────────────────────────────────────────────────────────────────────────────────────

describe('the jr6 review: a password typed for the person', () => {
  it('sec-1: the browser never sends the form itself while a password typed on Manual waits for the person', async () => {
    const fixture = await served(createHtml);
    const { doc } = fixture;
    // Named boxes, so a submission would carry them (Workday's own carry none).
    const box = (id: string) => doc.querySelector<HTMLInputElement>(`input[data-automation-id="${id}"]`)!;
    box('password').name = 'password';
    box('verifyPassword').name = 'verify';
    const form = doc.querySelector<HTMLFormElement>('form[data-automation-id="signInFormo"]')!;
    const hidden = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const run = new AbortController();
    expect(await attempt(fixture, channelAnswering({ ok: true, data: MANUAL }), { signal: run.signal })).toBe('typed');
    // What the browser's own submission met, read last (and then always held: nothing navigates here).
    const prevented: boolean[] = [];
    fixture.view.addEventListener('submit', (event) => {
      prevented.push(event.defaultPrevented);
      event.preventDefault();
    });
    // The person's press: the page's script clicks its hidden submit button, as Workday's does. A form with no method
    // and no action would go as a GET with the password in the address.
    hidden.click();
    expect(prevented).toEqual([true]);
    // A submission by the page's own form.submit() (no submit event) carries no password either.
    const entries = new FormData(form);
    expect([entries.get('password'), entries.get('verify')]).toEqual([null, null]);
    // Once the keep ends (the run stops), so does the guard.
    run.abort();
    hidden.click();
    expect(prevented).toEqual([true, false]);
  });

  it('sec-1: a password typed into a form whose press is the person’s stays guarded until the document goes', async () => {
    const fixture = await icims('githubinc-profile.frame-1');
    const form = (fixture.doc.getElementById('PersonProfileFields.Login') as HTMLInputElement).form!;
    form.noValidate = true;
    const run = new AbortController();
    const page = new AbortController();
    expect(await signIn({ doc: fixture.doc, adapter: icimsAdapter, channel: channelAnswering({ ok: true, data: MANUAL }),
      href: () => fixture.address, isTop: false, claimed: true, section: true, typeOnly: true, signal: run.signal,
      page: page.signal })).toBe('continue');
    // Read after the guard's own look (the fixture then holds every submission: nothing navigates).
    const prevented: boolean[] = [];
    fixture.view.addEventListener('submit', (event) => prevented.push(event.defaultPrevented), true);
    /** The browser's own submission, as the page's script would make it. */
    const sendAsThePage = () => {
      // eslint-disable-next-line no-restricted-syntax -- the test drives the browser's own submission, as a page would
      form.requestSubmit();
    };
    // The application's own Submit, a POST home: it goes.
    sendAsThePage();
    // The run ends, and the page turns the form into a GET: held while the document lasts.
    run.abort();
    form.method = 'get';
    sendAsThePage();
    expect(prevented).toEqual([false, true]);
    // The document goes: the guard with it.
    page.abort();
    sendAsThePage();
    expect(prevented).toEqual([false, true, false]);
  });

  it('R1: an ask this frame never presses says so; an Auto run’s does not', async () => {
    const fixture = await served(createHtml);
    const channel = channelAnswering({ ok: true, data: AUTO });
    expect(await attempt(fixture, channel, { typeOnly: true })).toBe('typed');
    expect(channel.asked).toEqual([{ v: 1, type: 'signin/credential', wall: 'create-account', typing: true,
      rules: { minLength: 8, requires: ['upper', 'lower', 'digit', 'special', 'alpha'] } }]); // jr6 ifix SEC-1
  });

  it('R1: a press the site refuses keeps what was typed for the person, SIGN_IN_KEPT_MS at most', async () => {
    const fixture = await served(signInHtml);
    const { doc } = fixture;
    // The site refuses the sign-in: its error shows in the form, which stays as it is.
    doc.addEventListener('click', (event) => {
      if ((event.target as Element).getAttribute('data-automation-id') !== 'click_filter') return;
      const alert = doc.createElement('div');
      alert.setAttribute('role', 'alert');
      alert.textContent = 'Wrong email address or password, or your account might be locked.';
      doc.querySelector('form[data-automation-id="signInFormo"]')!.prepend(alert);
    });
    expect(await attempt(fixture, channelAnswering({ ok: true, data: AUTO }), { keptMs: 600 })).toBe('failed');
    expect(boxesOf(fixture)).toMatchObject({ email: SAVED.email, password: SAVED.password });
    await vi.waitFor(() => expect(boxesOf(fixture)).toMatchObject({ email: SAVED.email, password: '' }), { timeout: 3_000 });
  });

  it('sec-5: a box the password was typed into stays an auth field when the page shows it as text', async () => {
    const fixture = await served(createHtml);
    expect(await attempt(fixture, channelAnswering({ ok: true, data: MANUAL }))).toBe('typed');
    const box = (id: string) => fixture.doc.querySelector<HTMLInputElement>(`input[data-automation-id="${id}"]`)!;
    // The page's "Show password".
    box('password').type = 'text';
    expect(kindOf(box('password'))).toEqual({ field: false, auth: true });
    // A text box the password was never typed into is what it was.
    expect(kindOf(box('email')).field).toBe(true);
  });

  it('sec-8: every keep of the document ends at once when the password may be typed no more', async () => {
    const fixture = await served(createHtml);
    expect(await attempt(fixture, channelAnswering({ ok: true, data: MANUAL }))).toBe('typed');
    dropKeptSignIns(fixture.doc);
    expect(boxesOf(fixture)).toMatchObject({ email: SAVED.email, password: '', verify: '' });
  });

  it('sec-3: a run on Manual types into a hidden tab only once it is shown', async () => {
    const fixture = await served(createHtml);
    let shown: DocumentVisibilityState = 'hidden';
    Object.defineProperty(fixture.doc, 'visibilityState', { configurable: true, get: () => shown });
    const channel = channelAnswering({ ok: true, data: MANUAL });
    const outcome = attempt(fixture, channel, { typeOnly: true });
    await deadline(400);
    expect(channel.asked).toEqual([]);
    expect(boxesOf(fixture)).toMatchObject({ email: '', password: '' });
    shown = 'visible';
    fixture.doc.dispatchEvent(new Event('visibilitychange'));
    expect(await outcome).toBe('typed');
    expect(boxesOf(fixture)).toMatchObject({ email: SAVED.email, password: SAVED.password });
  });

  it('R2: a password longer than its box takes is never typed, nor anything else', async () => {
    const fixture = await served(createHtml);
    // As Taleo's sign-in draws its box: maxlength 60 (here shorter than the synthetic password).
    fixture.doc.querySelector<HTMLInputElement>('input[data-automation-id="password"]')!.maxLength = 20;
    expect(await attempt(fixture, channelAnswering({ ok: true, data: MANUAL }))).toBe('unavailable');
    expect(boxesOf(fixture)).toEqual({ email: '', password: '', verify: '', terms: false });
    removeFixtures(document);
    // One it fits is typed.
    const fits = await served(createHtml);
    fits.doc.querySelector<HTMLInputElement>('input[data-automation-id="password"]')!.maxLength = SAVED.password.length;
    expect(await attempt(fits, channelAnswering({ ok: true, data: MANUAL }))).toBe('typed');
  });
});

// ── A form whose press is the person's, typed once in a document ────────────────────────────────────────────────────

/** A wall whose create-account form declares its press the person's (as SuccessFactors' account page does), a POST
 *  home, with the run's own adapter reading it. */
const PERSON_PRESSES = `<!doctype html><html><body><main><form id="account" method="post" action="/career">
  <label for="email">Email</label><input id="email" type="email" autocomplete="email" style="width:300px">
  <label for="p1">Password</label><input id="p1" type="password" autocomplete="new-password" style="width:300px">
  <label for="p2">Confirm Password</label><input id="p2" type="password" autocomplete="new-password" style="width:300px">
  <label for="first">First Name</label><input id="first" style="width:300px">
  <button id="create" type="submit">Create Account</button>
</form></main></body></html>`;
const personPresses: Adapter = { ...genericAdapter, id: 'workday',
  authState: (doc) => (doc.querySelector('input[type=password]') === null ? null : 'create-account'),
  signInForm: (doc, wall) => {
    if (wall !== 'create-account') return null;
    const box = (id: string) => doc.getElementById(id) as HTMLInputElement | null;
    const form = doc.getElementById('account') as HTMLFormElement | null;
    const button = doc.getElementById('create');
    return form === null || button === null ? null : { email: box('email'), password: box('p1'), confirm: box('p2'),
      terms: [], button, form, personPresses: true };
  } };

describe('a form whose press is the person’s, at its wall (the jr6 review)', () => {
  it('is typed once in a document: the run rests at it after, asking nothing again, its toast saying what was typed', async () => {
    const fixture = await loadFixture(document, PERSON_PRESSES, { width: 1100, height: 900 });
    const base = fixture.doc.createElement('base');
    base.href = ACCOUNT;
    fixture.doc.head.prepend(base);
    fixture.doc.addEventListener('submit', (event) => event.preventDefault(), true);
    const settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn: 'manual' as const } };
    const worker = createFakeWorker({ settings, typeSignIn: true, script: { 'signin/credential': [
      { ok: true, data: MANUAL }, { ok: true, data: MANUAL }, { ok: true, data: MANUAL }] } as never });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => ACCOUNT, isTop: true,
      adapters: () => [personPresses], settle: { quietMs: 40 } });
    runtimes.push(runtime);
    expect(await runtime.fill()).toBe('paused');
    await vi.waitFor(() => expect((fixture.doc.getElementById('p1') as HTMLInputElement).value).toBe(SAVED.password));
    expect(signInHandedOver(fixture.doc, 'create-account')).toBe(true);
    expect(signInHandedOver(fixture.doc, 'sign-in')).toBe(false);
    // The run carries on, finds the same wall, and rests there for the person: nothing asked or typed again.
    await vi.waitFor(() => expect(worker.of('run/begin').length).toBeGreaterThan(1), { timeout: 5_000 });
    await deadline(1_000);
    expect(worker.of('signin/credential')).toHaveLength(1);
    await vi.waitFor(() => expect(runtime.ui!.shadow.querySelector('.toast[data-kind="sign-in"] .notice')?.textContent)
      .toBe(COPY.toasts.signInTyped));
  });
});
