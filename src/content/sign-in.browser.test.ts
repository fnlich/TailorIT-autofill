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
import type { Adapter } from '../adapters/types';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { loadFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import { standardSignInForm, signInRefusal } from '../dom/sign-in-form';
import { deadline } from '../dom/time';
import type { SignInCredential } from '../messaging/schemas';
import createAccountHtml from '../../fixtures/synthetic/signin/create-account.html?raw';
import signInHtml from '../../fixtures/synthetic/signin/sign-in.html?raw';
import { createFakeWorker, testVocab } from './content.testkit';
import { pressEntry } from './press';
import { startContentRuntime, type ContentRuntime } from './runtime';
import { signIn, type SignInContext } from './sign-in';

const HOST = 'acme.wd5.myworkdayjobs.com';
const HREF = `https://${HOST}/en-US/careers/login`;
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
  passwordStyle?: string; passwordAttrs?: string } = {}): string {
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
    expect([form.email?.id, form.password.id, form.confirm, form.terms.map((box) => box.id), form.button.id])
      .toEqual(['email', 'password', null, ['terms'], 'go']);
    expect(signInRefusal(form, new URL(HREF))).toBeNull();
    const create = await loadFixture(document, CREATE_ACCOUNT);
    const account = standardSignInForm(create.doc, 'create-account')!;
    expect([account.email?.id, account.password.id, account.confirm?.id, account.terms.map((box) => box.id),
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

  it('says sign-in-unavailable when the worker has none for the page', async () => {
    const { worker, runtime } = await start(signInPage(), 'auto', { 'signin/credential': [{ ok: false, error: 'unavailable' }] });
    expect(await runtime.fill()).toBe('paused');
    await vi.waitFor(() => expect(worker.reports.at(-1)!.notices.map((notice) => notice.code))
      .toContain('sign-in-unavailable'));
    expect(worker.reports.at(-1)!.notices.map((notice) => notice.code)).not.toContain('sign-in-auto');
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
    // The worker's own: the declared Apply, pressed once.
    expect(await worker.platform.deliver({ v: 1, type: 'agent/enter' })).toEqual({ ok: true, data: { outcome: 'pressed' } });
    expect(applied(fixture)).toBe(1);
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
