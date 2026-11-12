/*
 * jr7 ENGINE-7 E2 (FIX7PLAN §6.2), the content half: how a run drives the doors and the step, through the content
 * runtime with a fake worker, on synthetic pages shaped as the jr7 audits describe each platform. Every value synthetic.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { genericAdapter } from '../adapters/generic';
import { greenhouseAdapter } from '../adapters/greenhouse';
import type { Adapter } from '../adapters/types';
import { loadFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import { createFakeWorker, testVocab } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';
import { signIn, signInDetailOf, type SignInContext } from './sign-in';

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

