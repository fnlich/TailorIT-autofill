/*
 * v3 Phase 5 in the content script: Sign-in mode Auto (sign-in.ts, dom/sign-in-form.ts) and the agent's messages
 * (runtime.ts).
 * - The standard rule reads a sign-in form (autocomplete username and current-password) and a create-account form (two
 *   new-password boxes), each with its one button and its required terms; nothing ambiguous.
 * - A sign-in types the worker's answer into the email and password boxes (and the confirmation), ticks the terms,
 *   presses the form's own button, and goes on once the form is gone; an error shown with the form still there is
 *   'failed', and the worker's "asked already" is 'failed' with nothing typed.
 * - Never: a hidden password box, a honeypot (out of the tab order, under aria-hidden, invisible on its background, too
 *   small), an http page, a form posting to another origin, or a sign-in for another host. Then nothing is typed, and
 *   (but for the host) the worker is never asked.
 * - A run paused at a sign-in with Sign-in on Auto says so, signs in, and goes on; with Manual it asks for nothing.
 * - run/start {agent} and agent/enter are taken from the worker's own script alone; agent/enter presses Greenhouse's
 *   declared Apply on a page with no form, and nothing on a page with one.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { ashbyAdapter } from '../adapters/ashby';
import { genericAdapter } from '../adapters/generic';
import { greenhouseAdapter } from '../adapters/greenhouse';
import type { Adapter, SignInForm } from '../adapters/types';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { COPY } from '../shared/copy';
import { loadFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import { guardSubmission, signInContainerOf, standardSignInForm, signInRefusal } from '../dom/sign-in-form';
import { deadline } from '../dom/time';
import type { SignInCredential } from '../messaging/schemas';
import createAccountHtml from '../../fixtures/synthetic/signin/create-account.html?raw';
import signInHtml from '../../fixtures/synthetic/signin/sign-in.html?raw';
import { createFakeWorker, testVocab } from './content.testkit';
import { pressEntry } from './press';
import { startContentRuntime, type ContentRuntime } from './runtime';
import { signIn, type SignInContext } from './sign-in';

const HOST = 'acme.wd5.myworkdayjobs.com';
/** An application's account page on a Workday tenant (the Workday parser reads it; its /login names no posting). */
const HREF = `https://${HOST}/en-US/careers/job/x/Engineer_JR-0000001/apply/applyManually`;
const CREDENTIAL: SignInCredential = { host: HOST, email: 'alex.rivera@example.com', password: 'dummy-password-not-real' };

/** Sets a loaded page's base address (a srcdoc page's own is about:srcdoc), after it loaded: the fixture loader lets
 *  no markup name a network address, and an action resolved against it fetches nothing. */
function setBase(doc: Document, base = `https://${HOST}/`): void {
  const element = doc.createElement('base');
  element.href = base;
  doc.head.prepend(element);
}

/** A sign-in page: email, password and a required terms box in one form, its button "Sign In". `before` goes in the
 *  form before the button; with `wrong`, the page's script shows an error and keeps the form. */
function signInPage(options: { before?: string; action?: string; method?: string; wrong?: boolean;
  passwordStyle?: string; passwordAttrs?: string; captcha?: boolean } = {}): string {
  return `<!doctype html><html><head><title>Sign In</title><style>
    body { margin: 0; background: #fff; color: #222; font: 16px/1.5 system-ui; }
    input[type=email], input[type=password] { display: block; width: 300px; padding: 6px; border: 1px solid #888; }
  </style></head><body><main>
  <p id="error" role="alert" hidden></p>
  <form id="sign-in" ${options.action === undefined ? '' : `action="${options.action}"`} method="${options.method ?? 'post'}">
    <label for="email">Email Address</label><input id="email" type="email" autocomplete="username">
    <label for="password">Password</label><input id="password" type="password" autocomplete="current-password"
      ${options.passwordAttrs ?? ''} ${options.passwordStyle === undefined ? '' : `style="${options.passwordStyle}"`}>
    <label><input id="terms" type="checkbox" required> I agree to the terms</label>
    ${options.before ?? ''}
    <button id="go" type="submit">Sign In</button>
  </form></main>
  <script>
    window.submits = 0;
    document.getElementById('sign-in').addEventListener('submit', (event) => {
      event.preventDefault();
      window.submits += 1;
      window.typed = { email: document.getElementById('email').value, password: document.getElementById('password').value,
        terms: document.getElementById('terms').checked };
      if (${options.captcha === true}) {
        // The press raises a challenge, and the form stays where it is.
        const widget = document.createElement('div');
        widget.className = 'g-recaptcha';
        widget.setAttribute('data-sitekey', 'k');
        widget.style.cssText = 'width:304px;height:78px;border:1px solid #888';
        document.querySelector('main').append(widget);
        return;
      }
      if (${options.wrong === true}) {
        const error = document.getElementById('error');
        error.textContent = "That email or password isn't right.";
        error.hidden = false;
        document.getElementById('password').value = '';
        return;
      }
      const main = document.querySelector('main');
      const done = document.createElement('form');
      const label = document.createElement('label');
      label.htmlFor = 'first';
      label.textContent = 'First Name';
      const first = document.createElement('input');
      first.id = 'first';
      done.append(label, first);
      main.replaceChildren(done);
    });
  </script></body></html>`;
}

const CREATE_ACCOUNT = `<!doctype html><html><body><form id="create" method="post">
  <label for="email">Email</label><input id="email" type="email" autocomplete="email" style="width:300px">
  <label for="p1">Password</label><input id="p1" type="password" autocomplete="new-password" style="width:300px">
  <label for="p2">Verify New Password</label><input id="p2" type="password" autocomplete="new-password" style="width:300px">
  <label><input id="terms" type="checkbox" aria-required="true"> I consent to the terms</label>
  <button id="create-button" type="submit">Create Account</button>
</form><script>
  document.getElementById('create').addEventListener('submit', (event) => {
    event.preventDefault();
    window.typed = { email: document.getElementById('email').value, p1: document.getElementById('p1').value,
      p2: document.getElementById('p2').value, terms: document.getElementById('terms').checked };
    document.getElementById('create').replaceWith(document.createElement('p'));
  });
</script></body></html>`;

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

type Typed = { email?: string; password?: string; p1?: string; p2?: string; terms?: boolean } | undefined;
const typedOn = (fixture: Fixture) => (fixture.view as unknown as { typed?: Typed }).typed;
const submitsOn = (fixture: Fixture) => (fixture.view as unknown as { submits?: number }).submits ?? 0;

/** A channel that answers signin/credential with `answer`, and what it was asked. */
function channelAnswering(answer: unknown) {
  const asked: unknown[] = [];
  return { asked, request: async (message: unknown) => {
    asked.push(message);
    return answer;
  } } as SignInContext['channel'] & { asked: unknown[] };
}

async function attempt(fixture: Fixture, channel: SignInContext['channel'], href = HREF) {
  return signIn({ doc: fixture.doc, adapter: genericAdapter, channel, href: () => href, isTop: true,
    signal: new AbortController().signal, settleMs: 1_500 });
}

describe('the standard sign-in form', () => {
  it('reads a sign-in and a create-account form, each with its one button and its required terms', async () => {
    const fixture = await loadFixture(document, signInPage());
    const form = standardSignInForm(fixture.doc, 'sign-in')!;
    expect([form.email?.id, form.password?.id, form.confirm, form.terms.map((box) => box.id), form.button.id])
      .toEqual(['email', 'password', null, ['terms'], 'go']);
    expect(signInRefusal(form, new URL(HREF))).toBeNull();
    const create = await loadFixture(document, CREATE_ACCOUNT);
    const account = standardSignInForm(create.doc, 'create-account')!;
    expect([account.email?.id, account.password?.id, account.confirm?.id, account.terms.map((box) => box.id),
      account.button.id]).toEqual(['email', 'p1', 'p2', ['terms'], 'create-button']);
    // Two submit buttons: no reading of one.
    const two = await loadFixture(document, signInPage({ before: '<button type="submit">Sign in with Google</button>' }));
    expect(standardSignInForm(two.doc, 'sign-in')).toBeNull();
  });

  it('reads where the form sends as the browser does: against the document’s base address, past named controls (the v3 Phase 5 review)', async () => {
    const refusalOf = async (page: string, tweak?: (doc: Document) => void, base = `https://${HOST}/`) => {
      const fixture = await loadFixture(document, page);
      setBase(fixture.doc, base);
      tweak?.(fixture.doc);
      return signInRefusal(standardSignInForm(fixture.doc, 'sign-in')!, new URL(HREF));
    };
    // A relative action on the page's own origin; and the same action under a <base> naming another origin.
    expect(await refusalOf(signInPage({ action: '/en-US/careers/login' }))).toBeNull();
    expect(await refusalOf(signInPage({ action: 'collect' }), undefined, 'https://collector.example/'))
      .toBe('cross-origin');
    expect(await refusalOf(signInPage(), (doc) => doc.getElementById('go')!.setAttribute('formaction', 'steal'),
      'https://collector.example/')).toBe('cross-origin');
    // A control named "action" shadows the form's own property, never its prototype's; one named "getAttribute" breaks
    // the page's own reading of its form: refused either way.
    expect(await refusalOf(signInPage({ action: 'https://collector.example/steal',
      before: '<input type="hidden" name="action" value="/en-US/careers/login">' }))).toBe('cross-origin');
    const broken = await loadFixture(document, signInPage({ action: '/en-US/careers/login',
      before: '<input type="hidden" name="getAttribute" value="x">' }));
    setBase(broken.doc);
    const channel = channelAnswering({ ok: true, data: CREDENTIAL });
    expect(await attempt(broken, channel)).toBe('unavailable');
    expect(channel.asked).toEqual([]);
    expect((broken.doc.getElementById('password') as HTMLInputElement).value).toBe('');
    // GET would put the password in an address, dialog sends nowhere: refused, a shadowing "method" control too.
    expect(await refusalOf(signInPage({ method: 'get' }))).toBe('method');
    expect(await refusalOf(signInPage({ method: 'dialog' }))).toBe('method');
    expect(await refusalOf(signInPage({ method: 'get',
      before: '<input type="hidden" name="method" value="post">' }))).toBe('method');
    expect(await refusalOf(signInPage(), (doc) =>
      doc.getElementById('go')!.setAttribute('formmethod', 'get'))).toBe('method');
    expect(await refusalOf(signInPage(), (doc) =>
      doc.getElementById('go')!.setAttribute('formmethod', 'post'))).toBeNull();
  });
});

describe('Sign-in mode Auto (sign-in.ts)', () => {
  it('signs in on the synthetic sign-in page (fixtures/synthetic/signin), never into its honeypot password boxes', async () => {
    // At its own address (e2e routes it there): its relative action resolves against it, as in a tab.
    const fixture = await loadFixture(document, signInHtml, { width: 1100, height: 900 });
    setBase(fixture.doc);
    const dummy = { host: HOST, email: 'alex.rivera@example.com', password: 'e2e-dummy-password-not-real' };
    expect(await attempt(fixture, channelAnswering({ ok: true, data: dummy }))).toBe('continue');
    const body = fixture.doc.body.dataset;
    expect([body.emailOk, body.passwordOk, body.terms, body.trapsEmpty, body.steal])
      .toEqual(['true', 'true', 'true', 'true', 'nothing']);
    const created = await loadFixture(document, createAccountHtml, { width: 1100, height: 900 });
    expect(await attempt(created, channelAnswering({ ok: true, data: dummy }))).toBe('continue');
    const made = created.doc.body.dataset;
    expect([made.emailOk, made.passwordOk, made.confirmOk, made.terms]).toEqual(['true', 'true', 'true', 'true']);
  });

  it('types the sign-in, ticks the terms, presses Sign In, and goes on once the form is gone', async () => {
    const fixture = await loadFixture(document, signInPage());
    const channel = channelAnswering({ ok: true, data: CREDENTIAL });
    expect(await attempt(fixture, channel)).toBe('continue');
    expect(channel.asked).toEqual([{ v: 1, type: 'signin/credential', wall: 'sign-in' }]);
    expect(typedOn(fixture)).toEqual({ email: CREDENTIAL.email, password: CREDENTIAL.password, terms: true });
    // Nothing of it was logged.
    expect(JSON.stringify(logs.mock.calls)).not.toContain(CREDENTIAL.password);
    expect(JSON.stringify(logs.mock.calls)).not.toContain(CREDENTIAL.email);
  });

  it('creates an account: the email, the password twice, the terms', async () => {
    const fixture = await loadFixture(document, CREATE_ACCOUNT);
    const channel = channelAnswering({ ok: true, data: CREDENTIAL });
    expect(await attempt(fixture, channel)).toBe('continue');
    expect(channel.asked).toEqual([{ v: 1, type: 'signin/credential', wall: 'create-account' }]);
    expect(typedOn(fixture)).toEqual({ email: CREDENTIAL.email, p1: CREDENTIAL.password, p2: CREDENTIAL.password, terms: true });
  });

  it('is failed when the site shows an error and keeps the form; and when the worker says the tab asked already', async () => {
    const fixture = await loadFixture(document, signInPage({ wrong: true }));
    expect(await attempt(fixture, channelAnswering({ ok: true, data: CREDENTIAL }))).toBe('failed');
    expect(submitsOn(fixture)).toBe(1);
    const again = await loadFixture(document, signInPage());
    expect(await attempt(again, channelAnswering({ ok: false, error: 'expired' }))).toBe('failed');
    expect(submitsOn(again)).toBe(0);
    expect((again.doc.getElementById('password') as HTMLInputElement).value).toBe('');
  });

  it('never fills a hidden password box or a honeypot, and asks for nothing', async () => {
    const cases: Array<Parameters<typeof signInPage>[0]> = [
      { passwordStyle: 'display: none' },
      { passwordAttrs: 'tabindex="-1"' },
      { passwordStyle: 'width: 4px; height: 4px; padding: 0' },
      { passwordStyle: 'border: 0; background: #fff; color: #fff' },
      { before: '<div aria-hidden="true"><input type="password" autocomplete="current-password" style="width:300px"></div>',
        passwordStyle: 'display: none' },
    ];
    for (const shape of cases) {
      const fixture = await loadFixture(document, signInPage(shape));
      const channel = channelAnswering({ ok: true, data: CREDENTIAL });
      expect(await attempt(fixture, channel), JSON.stringify(shape)).toBe('unavailable');
      expect(channel.asked, JSON.stringify(shape)).toEqual([]);
      for (const box of Array.from(fixture.doc.querySelectorAll('input'))) expect(box.value).toBe(box.type === 'checkbox' ? 'on' : '');
      expect(submitsOn(fixture)).toBe(0);
      removeFixtures(document);
    }
  });

  it('refuses an http page and a form posting to another origin, asking for nothing', async () => {
    const plain = await loadFixture(document, signInPage());
    const channel = channelAnswering({ ok: true, data: CREDENTIAL });
    expect(await attempt(plain, channel, `http://${HOST}/en-US/careers/login`)).toBe('unavailable');
    const away = await loadFixture(document, signInPage({ action: 'https://collector.example/steal' }));
    expect(await attempt(away, channel)).toBe('unavailable');
    const formaction = await loadFixture(document, signInPage({ before: '' }));
    formaction.doc.getElementById('go')!.setAttribute('formaction', 'https://collector.example/steal');
    expect(await attempt(formaction, channel)).toBe('unavailable');
    expect(channel.asked).toEqual([]);
    for (const fixture of [plain, away, formaction]) {
      expect((fixture.doc.getElementById('password') as HTMLInputElement).value).toBe('');
    }
  });

  it('refuses a sign-in for another host, typing nothing', async () => {
    const fixture = await loadFixture(document, signInPage());
    for (const host of ['other.wd5.myworkdayjobs.com', '*']) {
      // `*` is for covered hosts only: this page's host is no Workday tenant's under the rule when it is not one.
      const href = host === '*' ? 'https://careers.example.com/login' : HREF;
      expect(await attempt(fixture, channelAnswering({ ok: true, data: { ...CREDENTIAL, host } }), href)).toBe('unavailable');
    }
    expect((fixture.doc.getElementById('password') as HTMLInputElement).value).toBe('');
    expect((fixture.doc.getElementById('email') as HTMLInputElement).value).toBe('');
    expect(submitsOn(fixture)).toBe(0);
  });

  // ── snapshot build 2026-11-06 (contract6): TailorIT's API 6 ──
  it('takes the every-site sign-in on ADP’s and ClearCompany’s candidate paths, by the page’s pathname, and on none of their other pages',
    async () => {
      const everySite = () => channelAnswering({ ok: true, data: { ...CREDENTIAL, host: '*' } });
      // Their employee pages (the paths no candidate rule names), the hosts' other spellings of a candidate path.
      for (const href of ['https://workforcenow.adp.com/theme/index.html#/Myself_ttd_MyselfTabTimecard',
        'https://workforcenow.adp.com/mascsr/default/mdf/payroll/x.html?p=/mascsr/default/mdf/recruitment/',
        'https://vafb.clearcompany.com/app/dashboard', 'https://www.clearcompany.com/careers/x',
        'https://cc-app-static.clearcompany.com/careers/x']) {
        const fixture = await loadFixture(document, signInPage());
        expect(await attempt(fixture, everySite(), href), href).toBe('unavailable');
        expect((fixture.doc.getElementById('password') as HTMLInputElement).value, href).toBe('');
        expect(submitsOn(fixture), href).toBe(0);
      }
      // Their candidate pages (fixtures/adp's guest and steps, fixtures/clearcompany's account step, as the snapshots
      // name them): typed and pressed.
      for (const href of ['https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=x&jobId=1',
        'https://workforcenow.adp.com/mascsr/applicant/mdf/recruitment/postLogin.html?cid=x&jobId=1&OTP_login=true',
        'https://vafb.clearcompany.com/careers/jobs/9485c936-3d5f-0a3b-27a4-708fe87203d8/apply']) {
        const fixture = await loadFixture(document, signInPage());
        expect(await attempt(fixture, everySite(), href), href).toBe('continue');
        expect(typedOn(fixture), href).toEqual({ email: CREDENTIAL.email, password: CREDENTIAL.password, terms: true });
      }
    });

  it('lets a declared form its page’s script sends through on ADP’s candidate paths alone, by the page’s pathname',
    async () => {
      // No method and no action written: a GET to the page itself, were the browser to send it (dom/sign-in-form.ts).
      const fixture = await loadFixture(document, signInPage({ method: '' }));
      const owner = fixture.doc.getElementById('sign-in') as HTMLFormElement;
      const form = { ...standardSignInForm(fixture.doc, 'sign-in')!, declared: true as const, scriptSubmits: true as const,
        form: owner };
      expect(signInRefusal(form, new URL(HREF))).toBeNull();
      expect(signInRefusal(form, new URL('https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=x')))
        .toBeNull();
      expect(signInRefusal(form, new URL('https://vafb.clearcompany.com/careers/jobs/1/apply'))).toBeNull();
      for (const href of ['https://workforcenow.adp.com/theme/index.html', 'https://vafb.clearcompany.com/app/x',
        'https://careers.example.com/careers/']) {
        expect(signInRefusal(form, new URL(href)), href).toBe('method');
      }
    });
  // ── end contract6 ──
});

describe('a run paused at a sign-in (v3 Phase 5)', () => {
  async function start(page: string, signInMode: 'auto' | 'manual', script: Record<string, unknown[]> = {}) {
    const fixture = await loadFixture(document, page, { width: 1100, height: 900 });
    const settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn: signInMode } };
    const worker = createFakeWorker({ settings, script: script as never });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => HREF, isTop: true,
      adapters: () => [genericAdapter], settle: { quietMs: 40 } });
    runtimes.push(runtime);
    return { fixture, worker, runtime };
  }

  it('says it signs in, signs in, and goes on to fill the page that follows', async () => {
    const { fixture, worker, runtime } = await start(signInPage(), 'auto',
      { 'signin/credential': [{ ok: true, data: CREDENTIAL }] });
    expect(await runtime.fill()).toBe('paused');
    expect(worker.reports.at(-1)!.notices.map((notice) => notice.code)).toEqual(expect.arrayContaining(['sign-in-auto']));
    await vi.waitFor(() => expect(submitsOn(fixture)).toBe(1), { timeout: 5_000 });
    // The run goes on (Continue): a second run, which fills the page that followed.
    await vi.waitFor(() => expect(worker.of('run/begin')).toHaveLength(2), { timeout: 5_000 });
    await vi.waitFor(() => expect((fixture.doc.getElementById('first') as HTMLInputElement).value).not.toBe(''),
      { timeout: 10_000 });
    // No report, RunState or message but the worker's one answer held the password.
    const sent = JSON.stringify(worker.messages);
    expect(sent).not.toContain(CREDENTIAL.password);
  });

  it('with Sign-in Manual asks for nothing and leaves the page to the person', async () => {
    const { fixture, worker, runtime } = await start(signInPage(), 'manual');
    expect(await runtime.fill()).toBe('paused');
    const report = worker.reports.at(-1)!;
    expect(report.status).toBe('auth-needed');
    expect(report.notices.map((notice) => notice.code)).not.toContain('sign-in-auto');
    expect(worker.of('signin/credential')).toEqual([]);
    expect((fixture.doc.getElementById('password') as HTMLInputElement).value).toBe('');
  });

  it('types nothing once the person cancels the run while its sign-in waits for the worker (the v3 Phase 5 review)', async () => {
    let answer!: (value: unknown) => void;
    const held = new Promise((resolve) => {
      answer = resolve;
    });
    const { fixture, worker, runtime } = await start(signInPage(), 'auto', { 'signin/credential': [held] });
    expect(await runtime.fill()).toBe('paused');
    await vi.waitFor(() => expect(worker.of('signin/credential')).toHaveLength(1));
    // The person's Cancel at the pause, then the worker's answer.
    expect(await worker.platform.deliver({ v: 1, type: 'run/cancel' })).toEqual({ ok: true, data: {} });
    answer({ ok: true, data: CREDENTIAL });
    await deadline(500);
    expect((fixture.doc.getElementById('password') as HTMLInputElement).value).toBe('');
    expect((fixture.doc.getElementById('email') as HTMLInputElement).value).toBe('');
    expect(submitsOn(fixture)).toBe(0);
  });

  it('says so on the page when the worker has none for the page: the branded toast to add one in TailorIT (v4, D10)', async () => {
    // The v4 review (M5): the worker's not_found, none saved, alone says to add one.
    const { worker, runtime } = await start(signInPage(), 'auto', { 'signin/credential': [{ ok: false, error: 'not_found' }] });
    expect(await runtime.fill()).toBe('paused');
    await vi.waitFor(() => expect(runtime.ui!.toasts.shown).toEqual(['no-sign-in']));
    expect(runtime.ui!.toasts.button('no-sign-in', 'action')?.textContent).toBe(COPY.toasts.open);
    // The report holds no notice of it (v4, D9), and no longer says it signs in.
    await vi.waitFor(() => expect(worker.reports.at(-1)!.notices.map((notice) => notice.code)).not.toContain('sign-in-auto'));
    expect(worker.reports.at(-1)!.notices.map((notice) => notice.code)).not.toContain('sign-in-unavailable');
  });
});

describe('v4: the account wall, its toast, and Sign up & Autofill (docs/SPEC-AMENDMENTS.md §13)', () => {
  async function start(page: string, signInMode: 'auto' | 'manual', script: Record<string, unknown[]> = {},
    adapters: Adapter[] = [genericAdapter]) {
    const fixture = await loadFixture(document, page, { width: 1100, height: 900 });
    const settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn: signInMode } };
    const worker = createFakeWorker({ settings, script: script as never });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => HREF, isTop: true,
      adapters: () => adapters, settle: { quietMs: 40 } });
    runtimes.push(runtime);
    return { fixture, worker, runtime };
  }
  /** The person signs in on the page: the wall goes, and the application's form shows in its place. */
  const signedIn = (fixture: Fixture) => {
    const { doc } = fixture;
    const form = doc.createElement('form');
    form.id = 'done';
    const label = doc.createElement('label');
    label.htmlFor = 'first';
    label.textContent = 'First Name';
    const first = doc.createElement('input');
    first.id = 'first';
    first.name = 'first';
    form.append(label, first);
    doc.querySelector('main')!.replaceChildren(form);
  };
  /** A wall with no form root: an adapter that reads the account page and claims no form (Workday's landing). */
  const walled: Adapter = { ...genericAdapter, id: 'workday', detect: () => null,
    authState: (doc) => (doc.querySelector('input[type=password]') === null ? null : 'sign-in') };

  it('with Sign-in Manual: the branded sign-in toast, nothing asked; once the person signed in, the run carries on by itself', async () => {
    const { fixture, worker, runtime } = await start(signInPage(), 'manual');
    expect(await runtime.fill()).toBe('paused');
    expect(runtime.ui!.toasts.shown).toEqual(['sign-in']);
    expect(worker.of('signin/credential')).toEqual([]);
    // Never a "needs you" badge: the launcher offers Continue with its progress, never "!".
    expect(runtime.ui!.launcher.el.querySelector('.badge')!.textContent).not.toBe('!');
    signedIn(fixture);
    await vi.waitFor(() => expect(worker.of('run/begin')).toHaveLength(2), { timeout: 5_000 });
    await vi.waitFor(() => expect((fixture.doc.getElementById('first') as HTMLInputElement).value).not.toBe(''),
      { timeout: 10_000 });
    expect(runtime.ui!.toasts.shown).not.toContain('sign-in');
  });

  it('Sign up & Autofill (run/start {signIn}) signs in under Sign-in Manual, for that run', async () => {
    const { fixture, worker, runtime } = await start(signInPage(), 'manual',
      { 'signin/credential': [{ ok: true, data: CREDENTIAL }] });
    expect(await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false, signIn: true })).toEqual({ ok: true,
      data: {} });
    await vi.waitFor(() => expect(submitsOn(fixture)).toBe(1), { timeout: 5_000 });
    expect(worker.of('signin/credential')).toHaveLength(1);
    expect(runtime.run!.request.signIn).toBe(true);
    removeFixtures(document);
    // A plain Autofill on the same page asks for nothing.
    const plain = await start(signInPage(), 'manual');
    expect(await plain.runtime.fill()).toBe('paused');
    expect(plain.worker.of('signin/credential')).toEqual([]);
  });

  it('Sign up & Autofill with no job-site sign-in saved: the toast to add one, with its Open', async () => {
    const { worker, runtime } = await start(signInPage(), 'manual', { 'signin/credential': [{ ok: false,
      error: 'not_found' }] });
    await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false, signIn: true });
    await vi.waitFor(() => expect(runtime.ui!.toasts.shown).toEqual(['no-sign-in']), { timeout: 5_000 });
    expect(runtime.ui!.shadow.querySelector('.toast[data-kind="no-sign-in"] .notice')?.textContent)
      .toBe(COPY.toasts.noSignIn);
  });

  it('tells the worker the page’s wall before any run (frame/wall), and that it went', async () => {
    const { fixture, worker } = await start(signInPage(), 'manual');
    await vi.waitFor(() => expect(worker.of('frame/wall').map((message) => message.wall)).toEqual(['sign-in']));
    expect(worker.of('run/begin')).toEqual([]);
    signedIn(fixture);
    await vi.waitFor(() => expect(worker.of('frame/wall').map((message) => message.wall)).toEqual(['sign-in', null]));
  });

  it('at a wall with no form: Autofill shows the sign-in toast under Manual; Sign up & Autofill signs in there', async () => {
    const manual = await start(signInPage(), 'manual', {}, [walled]);
    expect(manual.runtime.page).toBeNull();
    await vi.waitFor(() => expect(manual.worker.of('frame/wall').map((message) => message.wall)).toEqual(['sign-in']));
    await manual.worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
    await vi.waitFor(() => expect(manual.runtime.ui?.toasts.shown).toEqual(['sign-in']));
    expect(manual.worker.of('signin/credential')).toEqual([]);
    expect(manual.worker.of('run/begin')).toEqual([]);
    manual.runtime.stop();
    removeFixtures(document);

    const signUp = await start(signInPage(), 'manual', { 'signin/credential': [{ ok: true, data: CREDENTIAL }] },
      [walled]);
    await signUp.worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false, signIn: true });
    await vi.waitFor(() => expect(submitsOn(signUp.fixture)).toBe(1), { timeout: 5_000 });
    signUp.runtime.stop();
    removeFixtures(document);
    // Never in a dry run.
    const dry = await start(signInPage(), 'auto', {}, [walled]);
    await dry.worker.platform.deliver({ v: 1, type: 'run/start', dryRun: true, signIn: true });
    await deadline(300);
    expect(dry.worker.of('signin/credential')).toEqual([]);
  });
});

// ── The v4 review ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('the v4 review: a pause restored in the document the person’s answer brought (behaviour H2)', () => {
  /** The application's form, as the document a sign-in or a solved check brings shows it: no wall, no challenge. */
  const FORM_PAGE = `<!doctype html><html><body><main><form id="done">
    <label for="first">First Name</label><input id="first" name="first" style="width:300px">
  </form></main></body></html>`;
  /** A form step a CAPTCHA pauses before anything is filled (a drawn widget, no checkbox). */
  const CAPTCHA_PAGE = `<!doctype html><html><body><main><form id="done">
    <label for="first">First Name</label><input id="first" name="first" style="width:300px">
    <div class="g-recaptcha" data-sitekey="k" style="display:block;width:304px;height:78px;border:1px solid #888"></div>
  </form></main></body></html>`;

  /** The first document: a run that pauses there; then (`next`) the document that follows in its place, on the same
   *  worker (the tab's store), at the same address, its runtime started as the page loads. */
  async function paused(first: string, signInMode: 'auto' | 'manual', script: Record<string, unknown[]> = {}) {
    const fixture = await loadFixture(document, first, { width: 1100, height: 900 });
    const settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn: signInMode } };
    const worker = createFakeWorker({ settings, script: script as never });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => HREF, isTop: true,
      adapters: () => [genericAdapter], settle: { quietMs: 40 } });
    runtimes.push(runtime);
    expect(await runtime.fill()).toBe('paused');
    const next = async () => {
      runtime.stop();
      removeFixtures(document);
      const shown = await loadFixture(document, FORM_PAGE, { width: 1100, height: 900 });
      const after = await startContentRuntime(worker.platform, shown.doc, { href: () => HREF, isTop: true,
        adapters: () => [genericAdapter], settle: { quietMs: 40 } });
      runtimes.push(after);
      return { fixture: shown, runtime: after };
    };
    return { fixture, worker, runtime, next };
  }
  const first = (fixture: Fixture) => (fixture.doc.getElementById('first') as HTMLInputElement).value;

  it('carries on at once from a sign-in pause, Sign-in Manual: the form filled, the sign-in toast gone', async () => {
    const run = await paused(signInPage(), 'manual');
    expect(run.runtime.ui!.toasts.shown).toEqual(['sign-in']);
    expect(run.worker.runStates.at(-1)!.status).toBe('auth-needed');
    const begun = run.worker.of('run/begin').length;
    const shown = await run.next();
    await vi.waitFor(() => expect(first(shown.fixture)).not.toBe(''), { timeout: 10_000 });
    // The restored run, then the one it carried on as (its Continue): the stored RunState's.
    expect(run.worker.of('run/begin')).toHaveLength(begun + 2);
    expect(shown.runtime.ui!.toasts.shown).not.toContain('sign-in');
  });

  it('with Sign-in Auto asks for no sign-in where the page shows no wall, and carries on: no toast to add one', async () => {
    const run = await paused(signInPage(), 'auto', { 'signin/credential': [{ ok: false, error: 'not_found' }] });
    await vi.waitFor(() => expect(run.runtime.ui!.toasts.shown).toEqual(['no-sign-in']));
    const reported = run.worker.reports.length;
    const shown = await run.next();
    await vi.waitFor(() => expect(first(shown.fixture)).not.toBe(''), { timeout: 10_000 });
    expect(run.worker.of('signin/credential')).toHaveLength(1);
    // The restored run never set out to sign in there (no sign-in-auto said of it).
    expect(run.worker.reports.slice(reported).flatMap((report) => report.notices.map((notice) => notice.code)))
      .not.toContain('sign-in-auto');
    expect(shown.runtime.ui!.toasts.shown).not.toContain('no-sign-in');
    expect(shown.runtime.ui!.toasts.shown).not.toContain('sign-in');
  });

  it('carries on at once from a CAPTCHA pause once the new document shows none: the challenge toast gone', async () => {
    const run = await paused(CAPTCHA_PAGE, 'manual');
    expect(run.runtime.ui!.toasts.shown).toEqual(['challenge']);
    expect(run.worker.runStates.at(-1)).toMatchObject({ status: 'handoff', pauseReason: 'captcha' });
    expect(first(run.fixture)).toBe('');
    const shown = await run.next();
    await vi.waitFor(() => expect(first(shown.fixture)).not.toBe(''), { timeout: 10_000 });
    expect(shown.runtime.ui!.toasts.shown).not.toContain('challenge');
  });
});

describe('the v4 review: the side panel’s Autofill at a pause (behaviour H1)', () => {
  it('continues the paused run, with Sign up & Autofill when asked; never a dry run’s, which a fill starts afresh', async () => {
    const fixture = await loadFixture(document, signInPage(), { width: 1100, height: 900 });
    const worker = createFakeWorker({ settings: DEFAULT_SETTINGS,
      script: { 'signin/credential': [{ ok: false, error: 'not_found' }] } as never });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => HREF, isTop: true,
      adapters: () => [genericAdapter], settle: { quietMs: 40 } });
    runtimes.push(runtime);
    expect(await runtime.fill({ dryRun: true })).toBe('paused');
    const dry = runtime.run!;
    await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
    await vi.waitFor(() => expect(runtime.run).not.toBe(dry));
    // A fresh fill, not the dry run's Continue.
    expect(runtime.run!.request).toMatchObject({ trigger: 'panel', dryRun: false });
    expect(runtime.run!.request.from).toBeUndefined();
    await vi.waitFor(() => expect(runtime.run!.ended).toBe('paused'));
    const paused = runtime.run!;
    await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false, signIn: true });
    await vi.waitFor(() => expect(runtime.run).not.toBe(paused));
    // Its Continue: from the stored RunState, Sign up & Autofill with it.
    expect(runtime.run!.request).toMatchObject({ dryRun: false, signIn: true, from: { event: { type: 'CONTINUE' } } });
    await vi.waitFor(() => expect(worker.of('signin/credential')).toHaveLength(1), { timeout: 5_000 });
    // A plain Autofill then (its panel/fill ends the tab's grant): the run's Continue, without Sign up & Autofill.
    await vi.waitFor(() => expect(runtime.run!.ended).toBe('paused'));
    const signedUp = runtime.run!;
    await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
    await vi.waitFor(() => expect(runtime.run).not.toBe(signedUp));
    expect(runtime.run!.request.from?.event).toEqual({ type: 'CONTINUE' });
    expect(runtime.run!.request.signIn).toBeUndefined();
  });
});

describe('the v4 review: each sign-in the run could not make says why (behaviour M5)', () => {
  /** reCAPTCHA v2's checkbox, unsolved: no pause for detectPause, a challenge for Sign-in Auto. */
  const CHECKBOX = '<div class="g-recaptcha" data-sitekey="x"><div style="width:304px;height:78px"><div><iframe srcdoc="" '
    + 'title="reCAPTCHA" width="304" height="78" src="https://www.google.com/recaptcha/api2/anchor?ar=1&amp;k=x&amp;'
    + 'size=normal"></iframe></div><textarea name="g-recaptcha-response" style="display:none"></textarea></div></div>';
  async function start(page: string, script: Record<string, unknown[]>, adapters: Adapter[] = [genericAdapter]) {
    const fixture = await loadFixture(document, page, { width: 1100, height: 900 });
    const settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn: 'auto' as const } };
    const worker = createFakeWorker({ settings, script: script as never });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => HREF, isTop: true,
      adapters: () => adapters, settle: { quietMs: 40 } });
    runtimes.push(runtime);
    return { fixture, worker, runtime };
  }
  const walled: Adapter = { ...genericAdapter, id: 'workday', detect: () => null,
    authState: (doc) => (doc.querySelector('input[type=password]') === null ? null : 'sign-in') };

  it('reads the worker’s answer: not_found is none saved, unavailable is not allowed, expired is failed', async () => {
    const page = await loadFixture(document, signInPage());
    for (const [error, outcome] of [['not_found', 'none-saved'], ['unavailable', 'unavailable'], ['expired', 'failed']]) {
      expect(await attempt(page, channelAnswering({ ok: false, error })), error).toBe(outcome);
    }
    const checked = await loadFixture(document, signInPage({ before: CHECKBOX }));
    const channel = channelAnswering({ ok: true, data: CREDENTIAL });
    expect(await attempt(checked, channel)).toBe('challenged');
    expect(channel.asked).toEqual([]);
  });

  it('in a run: none saved says to add one, not allowed says to sign in here, a challenge says to solve it', async () => {
    const cases: Array<[string, Record<string, unknown[]>, string]> = [
      [signInPage(), { 'signin/credential': [{ ok: false, error: 'not_found' }] }, 'no-sign-in'],
      [signInPage(), { 'signin/credential': [{ ok: false, error: 'unavailable' }] }, 'sign-in'],
      [signInPage({ before: CHECKBOX }), {}, 'challenge'],
    ];
    for (const [page, script, toast] of cases) {
      const { worker, runtime } = await start(page, script);
      expect(await runtime.fill(), toast).toBe('paused');
      await vi.waitFor(() => expect(runtime.ui!.toasts.shown, toast).toEqual([toast]), { timeout: 5_000 });
      if (toast === 'challenge') expect(worker.of('signin/credential')).toEqual([]);
      runtime.stop();
      removeFixtures(document);
    }
  });

  it('at a wall with no form: the same three toasts', async () => {
    const cases: Array<[string, Record<string, unknown[]>, string]> = [
      [signInPage(), { 'signin/credential': [{ ok: false, error: 'not_found' }] }, 'no-sign-in'],
      [signInPage(), { 'signin/credential': [{ ok: false, error: 'unavailable' }] }, 'sign-in'],
      [signInPage({ before: CHECKBOX }), {}, 'challenge'],
    ];
    for (const [page, script, toast] of cases) {
      const { worker, runtime } = await start(page, script, [walled]);
      expect(runtime.page).toBeNull();
      await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false, signIn: true });
      await vi.waitFor(() => expect(runtime.ui?.toasts.shown, toast).toEqual([toast]), { timeout: 5_000 });
      if (toast === 'no-sign-in') {
        expect(runtime.ui!.toasts.button('no-sign-in', 'action')?.textContent).toBe(COPY.toasts.open);
      }
      if (toast === 'challenge') expect(worker.of('signin/credential')).toEqual([]);
      runtime.stop();
      removeFixtures(document);
    }
  });
});

describe('the agent’s messages (v3 Phase 5)', () => {
  const POSTING = `<!doctype html><html><body><main><div class="job__header"><h1>Engineer</h1>
    <button type="button" class="btn btn--pill" aria-label="Apply" id="apply">Apply</button></div>
    <p>We build things.</p></main><script>
      window.applied = 0;
      document.getElementById('apply').addEventListener('click', () => { window.applied += 1; });
    </script></body></html>`;
  const applied = (fixture: Fixture) => (fixture.view as unknown as { applied: number }).applied;

  it('takes run/start {agent} and agent/enter from the worker’s own script alone', async () => {
    const fixture = await loadFixture(document, POSTING, { width: 1100, height: 900 });
    const worker = createFakeWorker();
    const runtime = await startContentRuntime(worker.platform, fixture.doc,
      { href: () => 'https://job-boards.greenhouse.io/northwind/jobs/4401', isTop: true, adapters: () => [greenhouseAdapter],
        settle: { quietMs: 40 } });
    runtimes.push(runtime);
    const id = worker.platform.runtime.id!;
    for (const sender of [{ id, tabId: 7 }, { id, url: `chrome-extension://${id}/sidepanel.html` }]) {
      expect(await worker.platform.deliverFrom({ v: 1, type: 'agent/enter' }, sender))
        .toEqual({ ok: false, error: 'bad_sender' });
      expect(await worker.platform.deliverFrom({ v: 1, type: 'run/start', dryRun: false, agent: true }, sender))
        .toEqual({ ok: false, error: 'bad_sender' });
    }
    expect(applied(fixture)).toBe(0);
    expect(worker.of('run/begin')).toEqual([]);
    expect(worker.of('agent/entered')).toEqual([]);
    // The worker's own: the declared Apply, pressed once, and told as it was made (round 3 of the v3 Phase 6/7b review,
    // X8: before the entry's answer, which a press that takes the page away never sends).
    expect(await worker.platform.deliver({ v: 1, type: 'agent/enter' })).toEqual({ ok: true, data: { outcome: 'pressed' } });
    expect(applied(fixture)).toBe(1);
    expect(worker.of('agent/entered')).toEqual([{ v: 1, type: 'agent/entered' }]);
  });

  it('never presses an entry the adapter never presses, unless the adapter marks it so (Ashby’s Application tab)', async () => {
    // fixtures/ashby/openai-closed.html's tabs: <a id="job-overview" role="tab">, <a id="job-application-form" role="tab"
    // href=".../application">; the overview's "Apply for this Job" link, both on Ashby's neverPress list.
    const overview = `<!doctype html><html><body><nav><a id="job-overview" role="tab" href="#overview">Overview</a>
      <a id="job-application-form" role="tab" href="#application">Application</a></nav><main><h1>Engineer</h1>
      <a id="apply-link" href="#application">Apply for this Job</a></main><script>window.applied = 0;
      for (const id of ['job-application-form', 'apply-link']) document.getElementById(id).addEventListener('click',
        (event) => { event.preventDefault(); window.applied += 1; });</script></body></html>`;
    const fixture = await loadFixture(document, overview, { width: 1100, height: 900 });
    const tab = () => fixture.doc.getElementById('job-application-form') as HTMLElement;
    const link = () => fixture.doc.getElementById('apply-link') as HTMLElement;
    const signal = new AbortController().signal;
    expect(ashbyAdapter.neverPress!(fixture.doc.documentElement)).toEqual(expect.arrayContaining([tab(), link()]));
    expect(ashbyAdapter.entryNeverPressed).toBe(true);
    // Unmarked: an entry neverPress lists is refused, and so is one holding a never-pressed element.
    const unmarked: Adapter = { ...ashbyAdapter, entryNeverPressed: undefined, entryControl: () => tab() };
    expect(await pressEntry(fixture.doc, [unmarked], signal, 200)).toEqual({ outcome: 'not-offered' });
    const holding: Adapter = { ...ashbyAdapter, entryControl: () => fixture.doc.querySelector('main') as HTMLElement };
    expect(await pressEntry(fixture.doc, [holding], signal, 200)).toEqual({ outcome: 'not-offered' });
    // Marked: that element alone, never another never-pressed one.
    const other: Adapter = { ...ashbyAdapter, entryControl: () => link() };
    expect(await pressEntry(fixture.doc, [{ ...other, entryNeverPressed: undefined }], signal, 200))
      .toEqual({ outcome: 'not-offered' });
    expect(applied(fixture)).toBe(0);
    const marked: Adapter = { ...ashbyAdapter, entryControl: () => tab() };
    expect(await pressEntry(fixture.doc, [marked], signal, 200)).toEqual({ outcome: 'pressed' });
    expect(applied(fixture)).toBe(1);
  });

  it('says what blocked the entry: a CAPTCHA, an email code; a sign-in before any form is signed in to with Sign-in Auto', async () => {
    const posting = 'https://job-boards.greenhouse.io/northwind/jobs/4405';
    const enter = async (page: string, signInMode: 'auto' | 'manual' = 'manual', script: Record<string, unknown[]> = {}) => {
      const fixture = await loadFixture(document, page, { width: 1100, height: 900 });
      const settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn: signInMode } };
      const worker = createFakeWorker({ settings, script: script as never });
      const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => posting, isTop: true,
        adapters: () => [greenhouseAdapter], settle: { quietMs: 40 } });
      runtimes.push(runtime);
      return { fixture, answer: await worker.platform.deliver({ v: 1, type: 'agent/enter' }), worker };
    };
    // reCAPTCHA's explicit-render container (pause-detect.ts), drawn before any form.
    const captcha = `<!doctype html><html><body><main><h1>Engineer</h1><div class="g-recaptcha" data-sitekey="k"
      style="width:304px;height:78px;border:1px solid #888"></div></main></body></html>`;
    expect((await enter(captcha)).answer).toEqual({ ok: true, data: { outcome: 'blocked', block: 'captcha' } });
    removeFixtures(document);
    const code = `<!doctype html><html><body><main><h1>Check your email</h1><p>Enter the verification code we sent to
      your email.</p><label for="code">Verification code</label><input id="code" autocomplete="one-time-code"
      style="width:200px"></main></body></html>`;
    expect((await enter(code)).answer).toEqual({ ok: true, data: { outcome: 'blocked', block: 'email-code' } });
    removeFixtures(document);
    // A sign-in page before any form: Manual blocks it; Auto signs in, once, and the entry goes on.
    expect((await enter(signInPage())).answer).toEqual({ ok: true, data: { outcome: 'blocked', block: 'sign-in' } });
    removeFixtures(document);
    const signedIn = await enter(signInPage(), 'auto', { 'signin/credential': [{ ok: true, data: { ...CREDENTIAL,
      host: 'job-boards.greenhouse.io' } }] });
    expect(signedIn.answer).toEqual({ ok: true, data: { outcome: 'pressed' } });
    expect(submitsOn(signedIn.fixture)).toBe(1);
    removeFixtures(document);
    const refused = await enter(signInPage({ wrong: true }), 'auto', { 'signin/credential': [{ ok: true, data: {
      ...CREDENTIAL, host: 'job-boards.greenhouse.io' } }] });
    expect(refused.answer).toEqual({ ok: true, data: { outcome: 'blocked', block: 'sign-in-failed' } });
  });

  it('answers the agent\u2019s entry blocked by the challenge a sign-in\u2019s press raised, never pressed (round 2, E7)', async () => {
    const posting = 'https://job-boards.greenhouse.io/northwind/jobs/4407';
    const fixture = await loadFixture(document, signInPage({ captcha: true }), { width: 1100, height: 900 });
    const settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn: 'auto' as const } };
    const worker = createFakeWorker({ settings, script: { 'signin/credential': [{ ok: true, data: { ...CREDENTIAL,
      host: 'job-boards.greenhouse.io' } }] } as never });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => posting, isTop: true,
      adapters: () => [greenhouseAdapter], settle: { quietMs: 40 } });
    runtimes.push(runtime);
    expect(await worker.platform.deliver({ v: 1, type: 'agent/enter' }))
      .toEqual({ ok: true, data: { outcome: 'blocked', block: 'captcha' } });
    // The challenge is the person's, and the password stays typed for them to press Sign In once they solved it.
    expect(fixture.doc.querySelector<HTMLInputElement>('#password')!.value).toBe(CREDENTIAL.password);
  });

  it('resumes the tab’s stored RunState in the next document, so its counts carry across documents', async () => {
    const posting = 'https://job-boards.greenhouse.io/northwind/jobs/4406';
    const page = `<!doctype html><html><body><main><form id="application-form" class="application--form">
      <div class="field-wrapper"><label for="first_name">First Name</label><input id="first_name" type="text"></div>
      <div class="application--submit"><button type="submit">Submit application</button></div></form></main>
      </body></html>`;
    const worker = createFakeWorker();
    const documentOf = async () => {
      const fixture = await loadFixture(document, page, { width: 1100, height: 900 });
      const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => posting, isTop: true,
        adapters: () => [greenhouseAdapter], settle: { quietMs: 40 } });
      runtimes.push(runtime);
      return runtime;
    };
    const first = await documentOf();
    expect(await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false, agent: true })).toEqual({ ok: true, data: {} });
    await vi.waitFor(() => expect(worker.runStates.at(-1)?.status).toBe('review'), { timeout: 10_000 });
    const before = worker.runStates.at(-1)!;
    const attempts = Object.values(before.stepAttempts).reduce((sum, count) => sum + count, 0);
    expect(attempts).toBeGreaterThan(0);
    // The page loads again (a new document, whose load offers to go on by itself): the agent's run there goes on from
    // the stored state.
    first.stop();
    removeFixtures(document);
    const count = worker.runStates.length;
    await documentOf();
    expect(await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false, agent: true })).toEqual({ ok: true, data: {} });
    await vi.waitFor(() => expect(worker.runStates.length).toBeGreaterThan(count), { timeout: 10_000 });
    await vi.waitFor(() => expect(worker.runStates.at(-1)?.status).toBe('review'), { timeout: 10_000 });
    const after = worker.runStates.at(-1)!;
    expect(after.startedAt).toBe(before.startedAt);
    expect(Object.values(after.stepAttempts).reduce((sum, n) => sum + n, 0)).toBeGreaterThan(attempts);
  });

  it('presses nothing on a page whose form shows, and starts the agent’s run there', async () => {
    const page = `<!doctype html><html><body><main><button type="button" aria-label="Apply" id="apply">Apply</button>
      <form id="application-form" class="application--form"><div class="field-wrapper"><label for="first_name">First
      Name</label><input id="first_name" type="text"></div><div class="application--submit"><button type="submit">Submit
      application</button></div></form></main><script>window.applied = 0;
      document.getElementById('apply').addEventListener('click', () => { window.applied += 1; });</script></body></html>`;
    const fixture = await loadFixture(document, page, { width: 1100, height: 900 });
    const worker = createFakeWorker();
    const runtime = await startContentRuntime(worker.platform, fixture.doc,
      { href: () => 'https://job-boards.greenhouse.io/northwind/jobs/4402', isTop: true, adapters: () => [greenhouseAdapter],
        settle: { quietMs: 40 } });
    runtimes.push(runtime);
    expect(await worker.platform.deliver({ v: 1, type: 'agent/enter' })).toEqual({ ok: true, data: { outcome: 'not-offered' } });
    expect(applied(fixture)).toBe(0);
    expect(await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false, agent: true })).toEqual({ ok: true, data: {} });
    await vi.waitFor(() => expect(worker.of('run/begin')).toEqual([expect.objectContaining({ trigger: 'agent' })]));
  });
});

// ── snapshot build 2026-11-06 (core pass Z1, item 24): a declared sign-in container ──
/** A page the run fills like a step whose account part has no <form> (ADP's guest page, adp-6): its names and email
 *  inside div#guest, and its Continue (role=button) there, which the page's script answers by showing a code dialog.
 *  `inside` goes in the container, `after` after it. */
function guestPage(options: { inside?: string; after?: string } = {}): string {
  return `<!doctype html><html><head><style>
    body { margin: 0; background: #fff; color: #222; font: 16px/1.5 system-ui; }
    input { display: block; width: 300px; padding: 6px; border: 1px solid #888; }
    #continue { display: inline-block; padding: 6px 12px; border: 1px solid #333; }
  </style></head><body><main>
  <div id="guest"><h1>Tell us about yourself.</h1>
    <label for="first">First Name</label><input id="first" type="text" required>
    <label for="em">Email</label><input id="em" type="text" required>
    ${options.inside ?? ''}
    <div id="continue" role="button" tabindex="0" aria-label="Continue">Continue</div>
  </div>${options.after ?? ''}</main>
  <script>
    window.presses = 0;
    document.getElementById('continue').addEventListener('click', () => {
      window.presses += 1;
      window.typed = { first: document.getElementById('first').value, em: document.getElementById('em').value };
      const dialog = document.createElement('div');
      dialog.innerHTML = '<label for="otp">Verification code</label><input id="otp" autocomplete="one-time-code">';
      document.getElementById('guest').replaceWith(dialog);
    });
  </script></body></html>`;
}

/** The adapter of guestPage: div#guest its root and its one step (final 'unknown': no Next, no Submit), its sign-in
 *  container that div with Continue its button, no box (a declared container: Adapter.signInContainer). `button` and
 *  `never` stand a test's change in. */
function guestAdapter(options: { button?: (doc: Document) => HTMLElement | null; never?: (doc: Document) => Element[];
  container?: (doc: Document) => Element | null } = {}): Adapter {
  const containerOf = options.container ?? ((doc: Document) => doc.getElementById('guest'));
  return {
    ...genericAdapter,
    id: 'generic',
    detect: (doc) => {
      const root = doc.getElementById('guest');
      return root === null ? null : { formRoot: root };
    },
    stepSignature: (doc) => ({ anchors: [doc.getElementById('guest') === null ? 'gone' : 'guest'] }),
    isFinalStep: () => 'unknown',
    nextButton: () => null,
    submitButton: () => null,
    neverPress: (root) => options.never?.(root.ownerDocument) ?? [],
    signInContainer(doc) {
      const container = containerOf(doc);
      const button = (options.button ?? ((each: Document) => each.getElementById('continue')))(doc);
      return container === null || button === null ? null
        : { email: null, password: null, confirm: null, terms: [], button, container };
    },
  };
}

const pressesOn = (fixture: Fixture) => (fixture.view as unknown as { presses?: number }).presses ?? 0;

describe('a declared sign-in container (core pass Z1, item 24)', () => {
  async function pressAt(fixture: Fixture, adapter: Adapter, answer: unknown = { ok: true, data: { host: HOST,
    email: CREDENTIAL.email } }, href = HREF) {
    const channel = channelAnswering(answer);
    const outcome = await signIn({ doc: fixture.doc, adapter, channel, href: () => href, isTop: true, container: true,
      signal: new AbortController().signal, settleMs: 1_500 });
    return { outcome, asked: channel.asked };
  }

  it('asks as an email gate, presses the button the adapter names, and goes on once the container is gone', async () => {
    const fixture = await loadFixture(document, guestPage(), { width: 1100, height: 900 });
    const pressed = await pressAt(fixture, guestAdapter());
    expect(pressed).toEqual({ outcome: 'continue', asked: [{ v: 1, type: 'signin/credential', wall: 'email-gate' }] });
    expect(pressesOn(fixture)).toBe(1);
    // A container is no wall: without container mode the page offers Sign-in Auto nothing.
    const again = await loadFixture(document, guestPage(), { width: 1100, height: 900 });
    expect(await attempt(again, channelAnswering({ ok: true, data: CREDENTIAL }))).toBe('unavailable');
    expect(pressesOn(again)).toBe(0);
  });

  it('keeps every Sign-in Auto guard: a challenge first, a challenge frame, https, the host, the worker’s word',
    async () => {
      const refused: Array<[string, string, Partial<{ answer: unknown; href: string }>]> = [
        ['a CAPTCHA shown', '<div class="g-recaptcha" data-sitekey="k" style="width:304px;height:78px"></div>', {}],
        ['a frame reading like a challenge', '<iframe srcdoc="" src="https://shield.example/captcha/frame" '
          + 'style="width:300px;height:80px"></iframe>', {}],
        ['an http page', '', { href: `http://${HOST}/en-US/careers/job/x/Engineer_JR-0000001/apply/applyManually` }],
        ['a sign-in for another host', '', { answer: { ok: true, data: { host: 'other.wd5.myworkdayjobs.com',
          email: CREDENTIAL.email } } }],
        ['no sign-in saved for the host', '', { answer: { ok: false, error: 'unavailable' } }],
      ];
      for (const [what, after, change] of refused) {
        const fixture = await loadFixture(document, guestPage({ after }), { width: 1100, height: 900 });
        const { outcome, asked } = await pressAt(fixture, guestAdapter(), change.answer, change.href);
        expect(outcome, what).not.toBe('continue');
        expect(pressesOn(fixture), what).toBe(0);
        // A challenge or http: nothing is even asked.
        if (after !== '' || change.href !== undefined) expect(asked, what).toEqual([]);
        removeFixtures(document);
      }
    });

  it('never presses a button outside the container’s document, or one the never-press list holds (adversarial)',
    async () => {
      // The button of a frame's document named as the container's: refused as a form, and by the door.
      const framed = await loadFixture(document, guestPage({ after: '<iframe id="inner" style="width:400px;height:120px" '
        + 'srcdoc="&lt;div id=&quot;away&quot; role=&quot;button&quot; style=&quot;padding:6px&quot;&gt;Continue&lt;/div&gt;">'
        + '</iframe>' }), { width: 1100, height: 900 });
      const inner = (framed.doc.getElementById('inner') as HTMLIFrameElement).contentDocument!;
      await vi.waitFor(() => expect(inner.getElementById('away')).not.toBeNull());
      let awayPressed = 0;
      inner.getElementById('away')!.addEventListener('click', () => {
        awayPressed += 1;
      });
      const outside = guestAdapter({ button: () => inner.getElementById('away') });
      expect(signInRefusal(signInContainerOf(outside, framed.doc)!, new URL(HREF))).toBe('shape');
      expect((await pressAt(framed, outside)).outcome).toBe('unavailable');
      expect([awayPressed, pressesOn(framed)]).toEqual([0, 0]);
      removeFixtures(document);
      // The button the adapter names never to press, or one inside or around one.
      for (const never of [(doc: Document) => [doc.getElementById('continue')!],
        (doc: Document) => [doc.getElementById('guest')!]]) {
        const fixture = await loadFixture(document, guestPage(), { width: 1100, height: 900 });
        expect((await pressAt(fixture, guestAdapter({ never }))).outcome).toBe('unavailable');
        expect(pressesOn(fixture)).toBe(0);
        removeFixtures(document);
      }
    });

  it('is no place for a password, and holds its boxes, its button’s form and its own form to the rules of one',
    async () => {
      const refusal = async (options: Parameters<typeof guestPage>[0], adapter: Adapter = guestAdapter(),
        base = `https://${HOST}/`) => {
        const fixture = await loadFixture(document, guestPage(options), { width: 1100, height: 900 });
        setBase(fixture.doc, base);
        const read = signInContainerOf(adapter, fixture.doc);
        const answer = read === null ? 'none' : signInRefusal(read, new URL(HREF));
        removeFixtures(document);
        return answer;
      };
      expect(await refusal({})).toBeNull();
      // A password box inside the container (the "password box" guard).
      expect(await refusal({ inside: '<label for="pw">Password</label><input id="pw" type="password">' })).toBe('shape');
      // A native button outside the container that belongs to another form.
      expect(await refusal({ after: '<form id="other" method="post"><input name="q"><button id="b" type="submit">Go'
        + '</button></form>' }, guestAdapter({ button: (doc) => doc.getElementById('b') }))).toBe('shape');
      // A container that is a <form>: its method and action as a sign-in form's.
      const formContainer = (doc: Document) => doc.getElementById('guest-form');
      const asForm = (method: string, action = '') => ({ after: `<form id="guest-form" method="${method}"${action}>`
        + '<input id="x" aria-label="X" style="width:300px"></form>' });
      expect(await refusal(asForm('post'), guestAdapter({ container: formContainer }))).toBeNull();
      expect(await refusal(asForm('get'), guestAdapter({ container: formContainer }))).toBe('method');
      expect(await refusal(asForm('post', ' action="https://collector.example/x"'), guestAdapter({ container: formContainer })))
        .toBe('cross-origin');
      // Only a declared form names a container (the standard rule never does).
      const fixture = await loadFixture(document, guestPage(), { width: 1100, height: 900 });
      const plain = { email: null, password: null, confirm: null, terms: [], button: fixture.doc.getElementById('continue')!,
        container: fixture.doc.getElementById('guest')! };
      expect(signInRefusal(plain, new URL(HREF))).toBe('shape');
    });

  it('guards the <form> a box-less container stands for: a submission as anything but a POST home is cancelled',
    async () => {
      const fixture = await loadFixture(document, guestPage({ after: '<form id="guest-form" method="post">'
        + '<input name="first" aria-label="First" style="width:300px"></form>' }), { width: 1100, height: 900 });
      setBase(fixture.doc);
      const form = fixture.doc.getElementById('guest-form') as HTMLFormElement;
      const read = signInContainerOf(guestAdapter({ container: () => form }), fixture.doc)!;
      const watching = new AbortController();
      const stop = guardSubmission(read, new URL(HREF), watching.signal);
      const sent: boolean[] = [];
      fixture.view.addEventListener('submit', (event) => {
        sent.push(!event.defaultPrevented);
        event.preventDefault();
      });
      form.setAttribute('method', 'get');
      // eslint-disable-next-line no-restricted-syntax -- the test drives the browser's own submission, as a page would
      form.requestSubmit();
      form.setAttribute('method', 'post');
      // eslint-disable-next-line no-restricted-syntax -- the test drives the browser's own submission, as a page would
      form.requestSubmit();
      stop();
      expect(sent).toEqual([false, true]);
    });

  async function startRun(page: string, signInMode: 'auto' | 'manual', adapter: Adapter, script: Record<string, unknown[]> = {}) {
    const fixture = await loadFixture(document, page, { width: 1100, height: 900 });
    const settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn: signInMode } };
    const worker = createFakeWorker({ settings, script: script as never });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => HREF, isTop: true,
      adapters: () => [adapter], settle: { quietMs: 40 } });
    runtimes.push(runtime);
    return { fixture, worker, runtime };
  }

  it('with Sign-in Auto, presses the container’s button once the run filled the step and rests', async () => {
    const { fixture, worker, runtime } = await startRun(guestPage(), 'auto', guestAdapter(),
      { 'signin/credential': [{ ok: true, data: { host: HOST, email: CREDENTIAL.email } }] });
    await runtime.fill();
    await vi.waitFor(() => expect(pressesOn(fixture)).toBe(1), { timeout: 5_000 });
    // The step's fields were the profile's, filled before the press.
    const typed = (fixture.view as unknown as { typed?: { first: string; em: string } }).typed!;
    expect(typed.first).not.toBe('');
    expect(typed.em).not.toBe('');
    expect(worker.of('signin/credential')).toEqual([expect.objectContaining({ wall: 'email-gate' })]);
  });

  it('with Sign-in Manual leaves the button to the person, asking for nothing', async () => {
    const { fixture, worker, runtime } = await startRun(guestPage(), 'manual', guestAdapter());
    await runtime.fill();
    await deadline(800);
    expect(pressesOn(fixture)).toBe(0);
    expect(worker.of('signin/credential')).toEqual([]);
  });

  it('with Sign-in Auto, never presses while a required question of the step is left unanswered', async () => {
    const { fixture, worker, runtime } = await startRun(guestPage({ inside: '<label for="ssn">Social Security Number</label>'
      + '<input id="ssn" type="text" required>' }), 'auto', guestAdapter(),
    { 'signin/credential': [{ ok: true, data: { host: HOST, email: CREDENTIAL.email } }] });
    await runtime.fill();
    await deadline(800);
    expect((fixture.doc.getElementById('ssn') as HTMLInputElement).value).toBe('');
    expect(pressesOn(fixture)).toBe(0);
    expect(worker.of('signin/credential')).toEqual([]);
  });

  it('with Sign-in Auto, never presses while one of the container’s own required boxes is empty, labelled or not',
    async () => {
      // A required box no label names (the scan reads no question there, as UltiPro's register labels read today).
      const { fixture, worker, runtime } = await startRun(guestPage({ inside: '<input id="unnamed" type="text" '
        + 'aria-required="true">' }), 'auto', guestAdapter(),
      { 'signin/credential': [{ ok: true, data: { host: HOST, email: CREDENTIAL.email } }] });
      await runtime.fill();
      await deadline(800);
      expect((fixture.doc.getElementById('unnamed') as HTMLInputElement).value).toBe('');
      expect(pressesOn(fixture)).toBe(0);
      expect(worker.of('signin/credential')).toEqual([]);
    });
});
// ── end core pass Z1, item 24 ──

// ── The behaviour review of 2026-11-06 (M7): the sign-in container's safety gates, each pinned ──
describe('a declared sign-in container’s gates (the behaviour review of 2026-11-06, M7)', () => {
  /** A step whose root (main#step) is wider than its sign-in container (div#guest): `after` goes in the step, outside
   *  the container. */
  const stepPage = (after = '', required = true) => guestPage({ after }).replace('<main>', '<main id="step">')
    .replace(/ required>/g, required ? ' required>' : '>');
  const stepAdapter: Adapter = { ...guestAdapter(),
    detect: (doc) => {
      const root = doc.getElementById('step');
      return root === null ? null : { formRoot: root };
    } };
  const SAVED = { 'signin/credential': [{ ok: true, data: { host: HOST, email: CREDENTIAL.email } }] };

  async function run(page: string, request: { dryRun?: boolean } = {}) {
    const fixture = await loadFixture(document, page, { width: 1100, height: 900 });
    const settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn: 'auto' as const } };
    const worker = createFakeWorker({ settings, script: SAVED as never });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => HREF, isTop: true,
      adapters: () => [stepAdapter], settle: { quietMs: 40 } });
    runtimes.push(runtime);
    await runtime.fill(request);
    return { fixture, worker };
  }

  /** Whether the run went to the container's press at all (content.sign-in-container: its outcome, logged). */
  const containerTried = () => logs.mock.calls.some(([line]) => line === '[tailorit-autofill] content.sign-in-container');

  it('control: presses once the step around it is filled and rests', async () => {
    logs.mockClear();
    const { fixture } = await run(stepPage());
    await vi.waitFor(() => expect(pressesOn(fixture)).toBe(1), { timeout: 5_000 });
    await vi.waitFor(() => expect(containerTried()).toBe(true), { timeout: 10_000 });
  });

  it('never presses in a dry run, whatever the container holds (Z1w)', async () => {
    const { fixture, worker } = await run(stepPage('', false), { dryRun: true });
    await deadline(1_200);
    expect(pressesOn(fixture)).toBe(0);
    expect(worker.of('signin/credential')).toEqual([]);
  });

  it('never presses while a required question of the step outside the container is empty (Z1q)', async () => {
    const { fixture, worker } = await run(stepPage('<label for="ssn">Social Security Number</label>'
      + '<input id="ssn" type="text" required>'));
    await deadline(1_200);
    expect((fixture.doc.getElementById('ssn') as HTMLInputElement).value).toBe('');
    expect(pressesOn(fixture)).toBe(0);
    expect(worker.of('signin/credential')).toEqual([]);
  });

  it('never presses while the step shows an error outside the container (Z1t)', async () => {
    const { fixture, worker } = await run(stepPage('<label for="colour">Favourite colour</label>'
      + '<input id="colour" type="text" aria-invalid="true">'));
    await deadline(1_200);
    expect(pressesOn(fixture)).toBe(0);
    expect(worker.of('signin/credential')).toEqual([]);
  });

  it('never presses while a checkbox CAPTCHA on the step is unsolved, though the step was filled (M6)', async () => {
    const widget = '<div class="g-recaptcha" data-sitekey="x"><div style="width:304px;height:78px"><div><iframe srcdoc="" '
      + 'title="reCAPTCHA" width="304" height="78" src="https://www.google.com/recaptcha/api2/anchor?ar=1&amp;k=x&amp;'
      + 'size=normal"></iframe></div><textarea name="g-recaptcha-response" style="display:none"></textarea></div></div>';
    logs.mockClear();
    const { fixture, worker } = await run(stepPage(widget));
    await vi.waitFor(() => expect((fixture.doc.getElementById('first') as HTMLInputElement).value).not.toBe(''));
    await deadline(1_200);
    expect(pressesOn(fixture)).toBe(0);
    expect(worker.of('signin/credential')).toEqual([]);
    // Held by the run's own gate (Z1s), before Sign-in Auto's own challenge guard is reached.
    expect(containerTried()).toBe(false);
  });

  /** A page holding the application's form and a container, read as the adapter declares it. */
  async function refusalOf(html: string, declared: (doc: Document) => Partial<SignInForm>) {
    const fixture = await loadFixture(document, `<!doctype html><html><head><style>
      input { display: block; width: 300px; padding: 6px; border: 1px solid #888; }
      button { padding: 6px 12px; border: 1px solid #333; }</style></head><body>${html}</body></html>`);
    setBase(fixture.doc);
    const adapter: Adapter = { ...genericAdapter, id: 'generic',
      detect: (doc) => ({ formRoot: doc.getElementById('app') ?? doc.body }),
      submitButton: (root) => root.ownerDocument.getElementById('apply'),
      signInContainer: (doc) => ({ email: null, password: null, confirm: null, terms: [],
        button: doc.getElementById('continue')!, container: doc.getElementById('guest')!, ...declared(doc) }) };
    const read = signInContainerOf(adapter, fixture.doc)!;
    const answer = signInRefusal(read, new URL(HREF));
    removeFixtures(document);
    return answer;
  }
  const GUEST_FORM = '<form id="guest" method="post"><label for="em">Email</label><input id="em" type="email">'
    + '<button id="continue" type="submit">Continue</button></form>';
  const email = (doc: Document) => ({ email: doc.getElementById('em') as HTMLInputElement });

  it('control: a container that is its own form, its box and its terms inside it, passes', async () => {
    expect(await refusalOf(GUEST_FORM, email)).toBeNull();
    expect(await refusalOf(GUEST_FORM.replace('<button', '<label><input id="t" type="checkbox"> I agree</label><button'),
      (doc) => ({ ...email(doc), terms: [doc.getElementById('t') as HTMLInputElement] }))).toBeNull();
  });

  it('refuses a container inside the application’s form, whose press would send it (Z1g)', async () => {
    expect(await refusalOf(`<form id="app" method="post"><label for="first">First</label><input id="first">
      <div id="guest"><label for="em">Email</label><input id="em" type="email">
      <button id="continue" type="submit">Continue</button></div>
      <button id="apply" type="submit">Submit application</button></form>`, email)).toBe('shape');
  });

  it('refuses a declared box or terms box outside the container, though the container’s form owns it (Z1f, Z1i)',
    async () => {
      expect(await refusalOf(`<form id="guest" method="post"><label for="x">X</label><input id="x">
        <button id="continue" type="submit">Continue</button></form>
        <label for="em">Email</label><input id="em" type="email" form="guest">`, email)).toBe('shape');
      expect(await refusalOf(`${GUEST_FORM}<label><input id="t" type="checkbox" form="guest"> I agree</label>`,
        (doc) => ({ ...email(doc), terms: [doc.getElementById('t') as HTMLInputElement] }))).toBe('shape');
    });

  it('refuses a declared container that also names a <form> (Z1e)', async () => {
    expect(await refusalOf(GUEST_FORM, (doc) => ({ ...email(doc),
      form: doc.getElementById('guest') as HTMLFormElement }))).toBe('shape');
  });
});
// ── end of the behaviour review's block (M7) ──
