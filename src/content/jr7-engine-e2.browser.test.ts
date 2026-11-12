/*
 * jr7 ENGINE-7 E2 (FIX7PLAN §6.2), the content half: how a run drives the doors and the step, through the content
 * runtime with a fake worker, on synthetic pages shaped as the jr7 audits describe each platform. Every value synthetic.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { genericAdapter } from '../adapters/generic';
import { greenhouseAdapter } from '../adapters/greenhouse';
import type { Adapter } from '../adapters/types';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { loadFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import { signInContainerOf, signInRefusal } from '../dom/sign-in-form';
import { deadline } from '../dom/time';
import { createFakeWorker, testVocab } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';
import { signIn, signInDetailOf, type AccountConsents, type SignInContext } from './sign-in';

const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

const HREF = 'https://job-boards.greenhouse.io/tailoritfixture/jobs/4403';

async function start(page: string, adapter: Adapter) {
  testVocab();
  const fixture = await loadFixture(document, page, { width: 1100, height: 1200 });
  const worker = createFakeWorker();
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => HREF, isTop: true,
    adapters: () => [adapter], settle: { quietMs: 40 } });
  runtimes.push(runtime);
  return { fixture, worker, runtime };
}

// ── item 5 (UKGR-9): the run opens the declared single-entry editor and fills what it draws ─────────────────────────
describe('item 5 (UKGR-9): a step whose editor opens on its Edit', () => {
  /** UKG Ready's Contact summary (snapshot7 secure7.saashr): "Missing Information" and its Edit, which draws the
   *  editor holding Last Name. */
  const PAGE = `<!doctype html><html><head><title>Apply</title></head><body><main><form id="application-form">
    <div><label for="first_name">First Name</label><input id="first_name" type="text"></div>
    <section id="contact"><h3>Contact</h3><p id="summary">Missing Information</p>
      <button type="button" id="edit">Edit</button>
      <div id="editor" hidden><label for="last_name">Last Name</label><input id="last_name" type="text"></div></section>
    <button id="submit" type="submit">Submit application</button></form></main>
    <script>
      window.edits = 0;
      document.getElementById('edit').addEventListener('click', () => {
        window.edits += 1;
        document.getElementById('editor').hidden = false;
      });
    </script></body></html>`;
  const contact = (declared: boolean): Adapter => ({ ...greenhouseAdapter,
    detect: (doc) => {
      const formRoot = doc.getElementById('application-form');
      return formRoot === null ? null : { formRoot };
    },
    submitButton: (root) => root.ownerDocument.getElementById('submit'),
    isFinalStep: () => 'final',
    neverPress: (root) => [root.ownerDocument.getElementById('edit')!],
    ...(declared ? { editorOpener: (root: Element) => {
      const edit = root.ownerDocument.getElementById('edit');
      return edit !== null && root.ownerDocument.getElementById('editor')!.hidden ? [edit] : [];
    } } : {}) });
  const lastName = (fixture: Fixture) => (fixture.doc.getElementById('last_name') as HTMLInputElement).value;
  const edits = (fixture: Fixture) => (fixture.view as unknown as { edits: number }).edits;

  it('opens it once and fills its fields; with no opener declared the editor stays shut', async () => {
    const opened = await start(PAGE, contact(true));
    expect(await opened.runtime.fill()).toBe('review');
    expect(edits(opened.fixture)).toBe(1);
    expect(lastName(opened.fixture)).not.toBe('');
    removeFixtures(document);
    const shut = await start(PAGE, contact(false));
    expect(await shut.runtime.fill()).toBe('review');
    expect([edits(shut.fixture), lastName(shut.fixture)]).toEqual([0, '']);
  });
});

// ── item 1 (ADP7-2): a required field the page holds read-only until it lets it in ────────────────────────────────────
describe('item 1 (ADP7-2): a required, empty field the page holds read-only', () => {
  /** ADP's personal step (snapshot7, jr7-adp1-personal-blank) as a synthetic page: Address Line 1 is required and
   *  read-only until the page lets it in, `unlockMs` after First Name's change (never with null); City follows it.
   *  `email`: a required Email the page shows read-only and filled (a signed-in account's). */
  const page = (unlockMs: number | null, email = false) => `<!doctype html><html><head><title>Apply</title></head><body>
    <form id="app" action="about:blank">
      <p><label for="first">First Name</label><input id="first" name="first" type="text" required></p>
      ${email ? '<p><label for="email">Email</label><input id="email" name="email" type="email" required readonly value="applicant@example.test"></p>' : ''}
      <p><label for="line1">Address Line 1</label><input id="line1" name="line1" type="text" required readonly></p>
      <p><label for="city">City</label><input id="city" name="city" type="text"></p>
    </form>
    <script>
      const UNLOCK = ${unlockMs === null ? 'null' : String(unlockMs)};
      const first = document.getElementById('first');
      first.addEventListener('change', () => {
        if (UNLOCK !== null) setTimeout(() => { document.getElementById('line1').readOnly = false; }, UNLOCK);
      });
    </script></body></html>`;
  const HELD_HREF = 'https://careers.example.org/apply/jr7-adp7-2';

  async function run(html: string) {
    testVocab();
    const logs = vi.spyOn(console, 'info');
    try {
      const fixture = await loadFixture(document, html, { width: 1100, height: 900 });
      const worker = createFakeWorker();
      const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => HELD_HREF, isTop: true,
        adapters: () => [genericAdapter], settle: { quietMs: 40 } });
      runtimes.push(runtime);
      await runtime.fill();
      const rows = new Map(worker.reports.at(-1)!.fields.map((row) => [row.label, row] as const));
      const ended = logs.mock.calls.filter((call) => call[0] === '[tailorit-autofill] content.loop-ended')
        .map((call) => call[1] as { cut: boolean; nothingPending: boolean });
      const value = (id: string) => (fixture.doc.getElementById(id) as HTMLInputElement).value;
      return { rows, ended, value };
    } finally {
      logs.mockRestore();
    }
  }

  for (const unlockMs of [400, 1_500]) {
    it(`waits for it and writes it once the page lets it in at ${unlockMs} ms`, async () => {
      const { rows, value } = await run(page(unlockMs));
      expect(value('line1')).not.toBe('');
      expect(rows.get('Address Line 1')).toMatchObject({ status: 'verified', wrote: true });
      expect(rows.get('City')).toMatchObject({ status: 'verified', wrote: true });
    }, 40_000);
  }

  it('never let in: flagged for the person past the bound, and the loop ends with nothing pending, not cut', async () => {
    const { rows, ended, value } = await run(page(null));
    expect(value('line1')).toBe('');
    expect(rows.get('Address Line 1')).toMatchObject({ status: 'flagged', reason: 'disabled-or-readonly', wrote: false,
      needsUserAction: true });
    expect(rows.get('City')).toMatchObject({ status: 'verified', wrote: true });
    expect(ended.at(-1)).toMatchObject({ cut: false, nothingPending: true });
  }, 40_000);

  it('a locked Email that holds a value never waits: its skip stands', async () => {
    const { rows } = await run(page(400, true));
    expect(rows.get('Email')).toMatchObject({ status: 'skipped', reason: 'disabled-or-readonly', needsUserAction: false });
    expect(rows.get('Address Line 1')).toMatchObject({ status: 'verified', wrote: true });
  }, 40_000);
});

// ── item 2 (ADP7-7): past the email code, the application's next document resumes by itself ──────────────────────────
describe('item 2 (ADP7-7): a run paused at an email code, then the application\'s next document shows its form', () => {
  /** ADP's code step (snapshot7 jr7-adp1-code) and the Personal Information document after it
   *  (jr7-adp1-personal-blank), as synthetic pages at one address: the same tab, the same application key. */
  const CODE = `<!doctype html><html><head><title>Apply</title></head><body><main><form id="app" action="about:blank">
    <p><label for="code">Verification code</label><input id="code" name="code" type="text"></p>
    <button type="submit">Verify</button></form></main></body></html>`;
  const PERSONAL = `<!doctype html><html><head><title>Apply</title></head><body><main><form id="app" action="about:blank">
    <p><label for="first">First Name</label><input id="first" name="first" type="text"></p>
    <p><label for="last">Last Name</label><input id="last" name="last" type="text"></p></form></main></body></html>`;
  const CODE_HREF = 'https://careers.example.org/apply/jr7-adp7-7';

  it('fills the form with no Continue: the run goes on past the code', async () => {
    testVocab();
    const worker = createFakeWorker();
    const open = async (html: string) => {
      const fixture = await loadFixture(document, html, { width: 1100, height: 900 });
      const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => CODE_HREF, isTop: true,
        adapters: () => [genericAdapter], settle: { quietMs: 40 } });
      runtimes.push(runtime);
      return { fixture, runtime };
    };
    const first = await open(CODE);
    expect(await first.runtime.fill()).toBe('paused');
    expect(worker.runStates.at(-1)).toMatchObject({ status: 'handoff', pauseReason: 'email-code' });
    first.runtime.stop();
    removeFixtures(document);
    const begun = worker.of('run/begin').length;
    const reported = worker.reports.length;

    const next = await open(PERSONAL);
    const box = (id: string) => (next.fixture.doc.getElementById(id) as HTMLInputElement).value;
    await vi.waitFor(() => expect(box('first')).not.toBe(''), { timeout: 15_000 });
    await vi.waitFor(() => expect(next.runtime.run?.ended).toBeDefined(), { timeout: 15_000 });
    expect(box('last')).not.toBe('');
    expect(worker.runStates.at(-1)!.status).not.toBe('handoff');
    // One run, the load's own resume: the pause is never shown again in the new document, nor left by a Continue (the
    // v4 watch's own, which a pause shown and gone at once would take).
    expect(worker.of('run/begin').slice(begun).map((begin) => begin.trigger)).toEqual(['resume']);
    expect(worker.reports.slice(reported).map((report) => report.status)).not.toContain('handoff');
  }, 40_000);
});

// ── WD7-06 (WORKDAY-7's exact edit): the page's notices that are none of its errors are read too ──────────────────────
describe('WD7-06: a notice beside the sign-in form that the adapter reads as an account kind', () => {
  /** A sign-in page whose notice (role=alert) sits outside its form, as Workday's "verify your account" notice after
   *  Create Account does; the adapter's errors() reads only the form's own error boxes (none shown here). */
  const page = (notice: string) => `<!doctype html><html><head><title>Sign In</title></head><body><main>
    <div id="notice" role="alert">${notice}</div>
    <form id="sign-in" method="post">
      <p class="error" hidden></p>
      <label for="email">Email Address</label><input id="email" type="email" autocomplete="username">
      <label for="password">Password</label><input id="password" type="password" autocomplete="current-password">
      <button id="go" type="submit">Sign In</button>
    </form></main></body></html>`;
  /** The generic adapter with Workday's two hooks, in its manner: errors are the form's own; a notice asking to verify
   *  the account is verify-email, any other words none. */
  const noticing: Adapter = { ...genericAdapter,
    errors: (root) => Array.from(root.querySelectorAll('.error')).map((el) => ({ el })),
    accountErrorKind: (el) => (/verify your account/i.test(el.textContent ?? '') ? 'verify-email' : null) };
  const SIGN_IN_HREF = 'https://careers.example.org/login';

  async function arrive(notice: string) {
    const fixture = await loadFixture(document, page(notice), { width: 1100, height: 900 });
    const asked: unknown[] = [];
    const channel = { request: async (message: unknown) => {
      asked.push(message);
      return { ok: false, error: 'not_found' };
    } } as unknown as SignInContext['channel'];
    const outcome = await signIn({ doc: fixture.doc, adapter: noticing, channel, href: () => SIGN_IN_HREF, isTop: true,
      signal: new AbortController().signal, settleMs: 1_000 });
    return { outcome, asked, detail: signInDetailOf(fixture.doc), email: (fixture.doc.getElementById('email') as
      HTMLInputElement).value };
  }

  it('a verify notice outside the form, none of the errors: nothing asked or typed, the kind said', async () => {
    const { outcome, asked, detail, email } = await arrive('An email has been sent to you. Please verify your account.');
    expect(outcome).toBe('unavailable');
    expect(asked).toEqual([]);
    expect(email).toBe('');
    expect(detail).toEqual({ account: 'verify-email' });
  });

  it('an ordinary alert the adapter names no kind of changes nothing: the sign-in is asked for', async () => {
    const { asked, detail } = await arrive('Welcome back. Sign in to go on.');
    expect(asked).toHaveLength(1);
    expect(detail).toBeNull();
  });
});

// ── item 3 (jr7-O1 part 3): a Submit of the run's own that brings an email code says nothing of it unconfirmed ───────
describe('item 3 (jr7-O1 part 3): resting at an email-code pause after its own Submit', () => {
  /** A Greenhouse-shaped final step whose Submit draws an email-code step in the form instead of a confirmation (Oracle's
   *  "Verify your email" after its Submit: snapshot7 oracle -submit-code), or (`code` false) draws
   *  nothing at all. */
  const page = (code: boolean) => `<!doctype html><html><head><title>Apply</title></head><body><main class="main">
    <form id="application-form" class="application--form">
      <div class="field-wrapper"><label for="first_name">First Name<span>*</span></label>
        <input id="first_name" name="first_name" type="text" aria-required="true"></div>
      <div class="application--submit"><button id="submit" class="btn" type="submit">Submit application</button></div>
    </form></main>
    <script>
      const form = document.getElementById('application-form');
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (${code ? 'true' : 'false'}) {
          form.innerHTML = '<h2>Verify your email</h2><div><label for="code">Verification code</label>'
            + '<input id="code" name="code" type="text"></div><button type="button">Verify</button>';
        }
      });
    </script></body></html>`;

  /** Greenhouse's adapter with a step signature (a wizard's steps, as Oracle's are), so the run at review watches the
   *  step for its change after the Submit. */
  const stepped: Adapter = { ...greenhouseAdapter, stepSignature: (doc) => ({
    heading: doc.querySelector('#application-form h2')?.textContent ?? 'Apply', anchors: [] }) };

  async function pressed(code: boolean) {
    testVocab();
    const fixture = await loadFixture(document, page(code), { width: 1100, height: 1200 });
    const worker = createFakeWorker({ settings: DEFAULT_SETTINGS });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => HREF, isTop: true,
      adapters: () => [stepped], settle: { quietMs: 40 }, submitConfirmMs: 1_500 });
    runtimes.push(runtime);
    expect(await runtime.fill()).toBe('review');
    expect(await worker.platform.deliver({ v: 1, type: 'run/press', target: 'submit', confirmed: true }))
      .toEqual({ ok: true, data: { outcome: 'pressed' } });
    return worker;
  }

  it('the pause is the report\'s word: no submit-unconfirmed beside it once the wait passes', async () => {
    const worker = await pressed(true);
    await vi.waitFor(() => expect(worker.reports.at(-1)).toMatchObject({ status: 'handoff', pauseReason: 'email-code' }),
      { timeout: 10_000 });
    await deadline(3_000);
    expect(worker.reports.flatMap((report) => report.notices.map((notice) => notice.code)))
      .not.toContain('submit-unconfirmed');
    expect(worker.reports.at(-1)).toMatchObject({ status: 'handoff', pauseReason: 'email-code' });
  }, 40_000);

  it('the control: a Submit that brings nothing still says it went unconfirmed', async () => {
    const worker = await pressed(false);
    await vi.waitFor(() => expect(worker.reports.at(-1)!.notices).toContainEqual({ code: 'submit-unconfirmed' }),
      { timeout: 10_000 });
  }, 40_000);
});

// ── jr6 leftovers (BUILD7): a dependent decided again when its lazy parent is read, or its parent settles no-match ────
describe('jr6 leftovers: a school box under a lazy School list that holds neither the school nor "Other"', () => {
  /** iCIMS's School list and its "Enter school name if not in the list above" box (jr6-nyu-profile-parsed, ICIMS-24),
   *  as a synthetic page: the list a select-only combobox whose rows are drawn only while it is open (read lazily),
   *  holding two synthetic schools and no "Other"; the box under it. */
  const PAGE = `<!doctype html><html><head><title>Apply</title></head><body>
<form id="app" action="about:blank"><h2>Education</h2>
  <div><span id="school-label">School</span>
    <div id="school" role="combobox" tabindex="0" aria-labelledby="school-label" aria-haspopup="listbox"
      aria-expanded="false" aria-controls="school-list">Select a school</div>
    <ul id="school-list" role="listbox" aria-labelledby="school-label" hidden></ul></div>
  <p><label for="school-box">Enter school name if not in the list above</label>
    <input id="school-box" name="school-box" type="text"></p>
</form>
<script>
  const school = document.getElementById('school');
  const list = document.getElementById('school-list');
  const show = (open) => {
    list.replaceChildren(...(open ? ['Northfield University', 'Lakeside College'] : []).map((name, at) => {
      const row = document.createElement('li');
      row.id = 'school-option-' + at;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(school.textContent === name));
      row.textContent = name;
      row.addEventListener('click', () => { school.textContent = name; show(false); });
      return row;
    }));
    list.hidden = !open;
    school.setAttribute('aria-expanded', String(open));
  };
  school.addEventListener('click', () => show(list.hidden));
  school.addEventListener('focusout', () => show(false));
</script></body></html>`;
  const LEFTOVER_HREF = 'https://careers.example.org/apply/jr7-leftovers';

  async function run(declared: boolean) {
    testVocab();
    const fixture = await loadFixture(document, PAGE, { width: 1100, height: 900 });
    const doc = fixture.doc;
    const adapter: Adapter = declared ? { ...genericAdapter, dependsOn: (control: Element) => (control.id === 'school-box'
      ? doc.getElementById('school') : null) } : genericAdapter;
    const worker = createFakeWorker({ settings: DEFAULT_SETTINGS });
    const runtime = await startContentRuntime(worker.platform, doc, { href: () => LEFTOVER_HREF, isTop: true,
      adapters: () => [adapter], settle: { quietMs: 40 } });
    runtimes.push(runtime);
    await runtime.fill();
    const rows = new Map(worker.reports.at(-1)!.fields.map((row) => [row.label, row] as const));
    return { rows, box: (doc.getElementById('school-box') as HTMLInputElement).value };
  }

  it('the box takes the school once the list is read and holds no option of it', async () => {
    const { rows, box } = await run(true);
    expect(box).not.toBe('');
    expect(rows.get('Enter school name if not in the list above')).toMatchObject({ status: 'verified', wrote: true });
  }, 40_000);

  it('the control: with no parent named, the box stays as it was decided while the list was unread', async () => {
    const { rows, box } = await run(false);
    expect(box).toBe('');
    expect(rows.get('Enter school name if not in the list above')).toMatchObject({ wrote: false,
      reason: 'conditional-question' });
  }, 40_000);
});

// ── jr6 leftover (INT-2 open 1): a paused run's wait for a password hears hello's answer ─────────────────────────────
describe('jr6 leftover: a run paused at its wall, waiting for a job-site password, hears hello\'s answer', () => {
  /** A sign-in page (email, password, its button "Sign In") at an application's address. */
  const PAGE = `<!doctype html><html><head><title>Sign In</title></head><body><main>
    <form id="sign-in" method="post">
      <label for="email">Email Address</label><input id="email" type="email" autocomplete="username">
      <label for="password">Password</label><input id="password" type="password" autocomplete="current-password">
      <button id="go" type="submit">Sign In</button>
    </form></main>
    <script>document.getElementById('sign-in').addEventListener('submit', (event) => event.preventDefault());</script>
    </body></html>`;
  const WALL_HREF = 'https://acme.wd5.myworkdayjobs.com/en-US/careers/job/x/Engineer_JR-0000001/apply/applyManually';
  const SAVED = { ok: true, data: { host: 'acme.wd5.myworkdayjobs.com', email: 'applicant@example.test',
    password: 'synthetic-password-1', press: true } };

  async function waiting() {
    testVocab();
    const fixture = await loadFixture(document, PAGE, { width: 1100, height: 900 });
    const settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn: 'manual' as const } };
    const worker = createFakeWorker({ settings, script: { 'signin/credential': [{ ok: false, error: 'not_found' },
      SAVED] } as never });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => WALL_HREF, isTop: true,
      adapters: () => [genericAdapter], settle: { quietMs: 40 }, signIn: { passwordWaitMs: 60_000 } });
    runtimes.push(runtime);
    await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false, signIn: true });
    await vi.waitFor(() => expect(runtime.ui!.toasts.shown).toEqual(['no-sign-in']), { timeout: 10_000 });
    expect(worker.of('signin/credential')).toHaveLength(1);
    return { worker, runtime };
  }

  it('a password saved while the page was away (hello says one may be typed): the wall is asked again', async () => {
    const { worker, runtime } = await waiting();
    runtime.run!.helloAnswered({ typeSignIn: true });
    await vi.waitFor(() => expect(worker.of('signin/credential')).toHaveLength(2), { timeout: 10_000 });
  }, 40_000);

  it('a hello that says none may be typed leaves the wait as it is', async () => {
    const { worker, runtime } = await waiting();
    runtime.run!.helloAnswered({ typeSignIn: false });
    await deadline(800);
    expect(worker.of('signin/credential')).toHaveLength(1);
  }, 40_000);
});

// ── ULTIPRO-7's UP7-04: a declared ARIA account term the page does not mark required, per the Consents mode ──────────
describe('UP7-04: UltiPro\'s Register privacy box, a declared ARIA term with no aria-required', () => {
  /** UltiPro's Register as a synthetic page (snapshot7 ultipro1's markup shape): names in div#register, the privacy
   *  box a ukg-checkbox-like ARIA checkbox with no aria-required, drawn ticked a moment after its click, and Create
   *  account, enabled once it is ticked, which replaces the step when pressed. `news`: the term is instead an optional
   *  native consent box ("Send me job alerts"), Create account enabled from the start. */
  const page = (news: boolean) => `<!doctype html><html><head><style>
    body { margin: 0; background: #fff; color: #222; font: 16px/1.5 system-ui; }
    input[type=text] { display: block; width: 300px; padding: 6px; border: 1px solid #888; }
  </style></head><body><main>
  <div id="register"><h1>Create your account</h1>
    <label for="first">First name</label><input id="first" type="text">
    ${news ? '<label><input id="news" type="checkbox"> Send me job alerts</label>' : `<span id="privacy" role="checkbox"
      aria-checked="false" tabindex="0" style="display:inline-block;padding:4px;border:1px solid #333">I have read and
      agree to the Privacy Policy</span>`}
    <button id="create" type="button" ${news ? '' : 'disabled'}>Create account</button>
  </div></main>
  <script>
    window.presses = 0;
    const privacy = document.getElementById('privacy');
    const create = document.getElementById('create');
    privacy?.addEventListener('click', () => setTimeout(() => {
      privacy.setAttribute('aria-checked', 'true');
      create.disabled = false;
    }, 60));
    create.addEventListener('click', () => {
      window.presses += 1;
      setTimeout(() => document.getElementById('register').replaceWith(Object.assign(document.createElement('p'),
        { textContent: 'Welcome' })), 30);
    });
  </script></body></html>`;
  const REGISTER_HREF = 'https://recruiting2.ultipro.com/ACM1000ACME/JobBoard/a1b2c3d4-0000-4000-8000-000000000001/Account/Register';
  const register: Adapter = { ...genericAdapter, id: 'generic',
    detect: (doc) => {
      const root = doc.getElementById('register');
      return root === null ? null : { formRoot: root };
    },
    signInContainer(doc) {
      const container = doc.getElementById('register');
      const button = doc.getElementById('create');
      const terms = ['privacy', 'news'].map((id) => doc.getElementById(id)).filter((el): el is HTMLElement => el !== null);
      return container === null || button === null ? null : { email: null, password: null, confirm: null, terms, button,
        container, enablesWhenFilled: true };
    } };

  async function pressed(consents: AccountConsents | undefined, news = false) {
    const fixture = await loadFixture(document, page(news), { width: 1100, height: 900 });
    const doc = fixture.doc;
    const refusal = signInRefusal(signInContainerOf(register, doc)!, new URL(REGISTER_HREF));
    // Held now: Create account draws the next step in the container's place.
    const privacy = doc.getElementById('privacy');
    const newsBox = doc.getElementById('news') as HTMLInputElement | null;
    const channel = { request: async () => ({ ok: true, data: { host: 'recruiting2.ultipro.com',
      email: 'applicant@example.test', press: true } }) } as unknown as SignInContext['channel'];
    const outcome = await signIn({ doc, adapter: register, channel, href: () => REGISTER_HREF, isTop: true,
      container: true, signal: new AbortController().signal, settleMs: 1_500, ...(consents === undefined ? {} : { consents }) });
    return { refusal, outcome, ticked: privacy?.getAttribute('aria-checked') ?? null, news: newsBox?.checked ?? null,
      presses: (fixture.view as unknown as { presses: number }).presses };
  }

  it('Consents All: the container is taken, the box ticked and read back, Create account pressed once', async () => {
    expect(await pressed({ mode: 'all', preapproved: [] })).toEqual({ refusal: null, outcome: 'continue',
      ticked: 'true', news: null, presses: 1 });
  });

  it('Required only with privacy and terms pre-approved (the defaults) ticks it too', async () => {
    expect(await pressed({ mode: 'required', preapproved: ['privacy', 'terms', 'dataRetention'] }))
      .toMatchObject({ outcome: 'continue', ticked: 'true', presses: 1 });
  });

  it('Required only with neither pre-approved, or no mode known: left for the person, nothing pressed', async () => {
    for (const consents of [{ mode: 'required', preapproved: [] } as const, undefined]) {
      expect(await pressed(consents)).toMatchObject({ refusal: null, outcome: 'failed', ticked: 'false', presses: 0 });
      removeFixtures(document);
    }
  });

  it('an optional native consent at the gate is still left (the plan\'s), whatever the mode', async () => {
    expect(await pressed({ mode: 'all', preapproved: [] }, true)).toEqual({ refusal: null, outcome: 'continue',
      ticked: null, news: false, presses: 1 });
  });
});
