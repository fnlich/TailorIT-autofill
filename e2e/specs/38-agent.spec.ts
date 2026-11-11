/*
 * v3 Phase 5 end to end (docs/SPEC-AMENDMENTS.md §12 Decisions 9 and 10), on synthetic pages only, against the mock's
 * agent queue and job-site sign-ins (nothing real is ever submitted: every form posts nothing, and routes.ts fails a
 * test that reaches /__submitted):
 * - the auto-apply agent takes the queued jobs one at a time: it opens each in a window of its own, fills it, presses
 *   Submit by itself, sees the platform's confirmation, tells the mock the result (submitted, never POST /applied), closes
 *   the window and takes the next: Greenhouse's confirmation drawn in place, Lever's /apply (the address TailorIT hands
 *   out) sending it to the posting page first, whose Apply it presses (the entry), and then /thanks, Ashby's success
 *   message;
 * - a CAPTCHA page is left for the person (needs-you, captcha) and never submitted; a posting that forbids AI is
 *   skipped (posting_forbids_ai) and never submitted;
 * - Sign-in Auto signs in on the synthetic sign-in page with the sign-in saved in this browser's Sign-up Information
 *   (jr6: never TailorIT's, which is asked nothing; the email, the password, the terms), never fills the page's
 *   honeypot password boxes, and the run then fills the page that follows; Sign-in Manual with a password saved types
 *   it and leaves the press to the person, and with none leaves the page to the person; a sign-in the site does not take
 *   is tried once (sign-in-failed);
 * - neither a page's own script nor TailorIT's own pages (the one origin that may message the extension) can start the
 *   agent, press its Submit or obtain the password (jr6: nor read or change Sign-up Information);
 * - Options shows Auto-apply and Sign-in, whose Auto needs a saved job-site password (jr6).
 */
import type { Page } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../helpers/settings.ts';
import { COPY } from '../../src/shared/copy';
import { expect, test } from '../fixtures.ts';
import type { Extension } from '../helpers/extension.ts';
import { mock } from '../helpers/mock.ts';
import { CONNECT_PAGE } from '../helpers/pairing.ts';
import { deletePassword, savePassword, SIGNUP_DUMMY } from '../helpers/signup.ts';
import { MOCK_ORIGIN } from '../routes.ts';

const GREENHOUSE = 'fixtures/synthetic/submit/greenhouse.html';
const LEVER = 'fixtures/synthetic/submit/lever.html';
const LEVER_THANKS = 'fixtures/synthetic/submit/lever-thanks.html';
const LEVER_POSTING = 'fixtures/synthetic/agent/lever-posting.html';
const ASHBY = 'fixtures/synthetic/submit/ashby.html';
const CAPTCHA = 'fixtures/synthetic/agent/greenhouse-captcha.html';
const NO_AI = 'fixtures/synthetic/agent/greenhouse-no-ai.html';
const SIGN_IN = 'fixtures/synthetic/signin/sign-in.html';
const CREATE_ACCOUNT = 'fixtures/synthetic/signin/create-account.html';

const greenhouseAt = (id: string) => `https://job-boards.greenhouse.io/tailoritfixture/jobs/38${id}`;
const leverAt = (id: string) => `https://jobs.lever.co/tailorit-fixture/00000000-0000-4000-8000-0000000038${id}`;
const ashbyAt = (id: string) => `https://jobs.ashbyhq.com/tailorit-fixture/00000000-0000-4000-8000-0000000038${id}/application`;
// A Taleo portal's apply address (v3 Phase 7b: a candidate host the every-site sign-in covers, whose adapter knows no
// form of these synthetic pages, so the generic adapter's standard rule reads them; Workday's own sign-in is
// 42-workday.spec.ts's).
const SIGN_IN_HOST = 'tailoritfixture.taleo.net';
const signInAt = (job: string) => `https://${SIGN_IN_HOST}/careersection/ex/jobapply.ftl?job=${job}&lang=en`;
/** The sign-in saved in Sign-up Information (jr6): the fixtures' own dummies. */
const DUMMY = SIGNUP_DUMMY;

/** A queue task, as TailorIT's GET /agent/next answers it. */
function task(n: number, url: string, title: string) {
  return { id: `0000000${n}-aaaa-4bbb-8ccc-00000000380${n}`, jobId: 3800 + n, url, company: 'Northwind', title,
    resumeId: null };
}

const results = async () => (await mock.agent()).results;
const datasetOf = (page: Page, key: string) => page.evaluate((name) => document.body.dataset[name] ?? null, key);

/** Turns Run auto-apply on, as Options does after the person's confirmation. */
async function agentOn(ext: Extension): Promise<void> {
  const answer = await ext.data<{ on: boolean; phase: string }>({ v: 1, type: 'agent/set', on: true, confirmed: true });
  expect(answer.on).toBe(true);
}

/** The next window the agent opens for `url`: its page, once it shows that address. */
async function agentPage(ext: Extension, url: string): Promise<Page> {
  const page = await ext.context.waitForEvent('page', { predicate: (opened) => opened.url().startsWith(url)
    || opened.url() === 'about:blank', timeout: 30_000 });
  await page.waitForURL((address) => address.href.startsWith(url), { timeout: 30_000 });
  return page;
}

test.afterEach(async ({ ext }) => {
  await ext.send({ v: 1, type: 'agent/set', on: false });
  await ext.data({ v: 1, type: 'settings/save', settings: DEFAULT_SETTINGS });
});

test.describe('the auto-apply agent (v3 Phase 5)', () => {
  test('takes each queued job in its own window, submits it, reports it, closes it and takes the next', async ({ connected: ext, routeLog }) => {
    routeLog.serve({
      [greenhouseAt('01')]: GREENHOUSE,
      [leverAt('02')]: LEVER_POSTING,
      // TailorIT hands out Lever's /apply: the first visit is sent on to the posting page (by the page's own script: a
      // routed HTTP redirect's new request is not routed), whose Apply opens the form.
      [`${leverAt('02')}/apply`]: [{ body: `<!doctype html><title>Platform Engineer</title><script>location.replace(${
        JSON.stringify(leverAt('02'))})</script>`, contentType: 'text/html; charset=utf-8' }, LEVER],
      [`${leverAt('02')}/thanks`]: LEVER_THANKS,
      [ashbyAt('03')]: ASHBY,
    });
    await mock.queueAgent([task(1, greenhouseAt('01'), 'Senior Backend Engineer'),
      task(2, `${leverAt('02')}/apply`, 'Platform Engineer'), task(3, ashbyAt('03'), 'Data Engineer')]);
    const first = agentPage(ext, greenhouseAt('01'));
    await agentOn(ext);

    // Greenhouse: filled, submitted by itself, its confirmation drawn in place, reported submitted, the window closed.
    // (A submitted result needs the platform's sign, which the page shows only after its own submit handler ran.)
    const greenhouse = await first;
    const second = agentPage(ext, leverAt('02'));
    await expect.poll(async () => (await results()).length, { timeout: 45_000 }).toBeGreaterThanOrEqual(1);
    expect((await results())[0]).toEqual({ id: task(1, '', '').id, body: { state: 'submitted', reason: null, aiGuesses: 0 } });
    await expect.poll(() => greenhouse.isClosed(), { timeout: 15_000 }).toBe(true);

    // Lever: /apply sends it to its posting page first, whose Apply the agent presses (the entry), then the form, then
    // /thanks.
    const lever = await second;
    const third = agentPage(ext, ashbyAt('03'));
    await expect.poll(async () => (await results()).length, { timeout: 45_000 }).toBeGreaterThanOrEqual(2);
    expect((await results())[1]).toEqual({ id: task(2, '', '').id, body: { state: 'submitted', reason: null, aiGuesses: 0 } });
    await expect.poll(() => lever.isClosed(), { timeout: 15_000 }).toBe(true);

    // Ashby: its success message after the agent's Submit.
    const ashby = await third;
    await expect.poll(async () => (await results()).length, { timeout: 45_000 }).toBe(3);
    expect((await results())[2]).toEqual({ id: task(3, '', '').id, body: { state: 'submitted', reason: null, aiGuesses: 0 } });
    await expect.poll(() => ashby.isClosed(), { timeout: 15_000 }).toBe(true);

    // TailorIT marks them Applied with the result: the extension never called POST /applied for them.
    expect(await mock.requestsTo('POST /api/autofill/applied')).toEqual([]);
    // The status says what it did, value-free.
    const status = await ext.data<{ doneToday: number; last: { state: string } | null; phase: string }>(
      { v: 1, type: 'agent/status' });
    expect(status).toMatchObject({ doneToday: 3, last: { state: 'submitted' } });
    expect(routeLog.submitted).toEqual([]);
    // TailorIT took every result (none refused), each row submitted.
    const queue = await mock.agent();
    expect(queue.refused).toEqual([]);
    expect(queue.rows.map((row) => row.state)).toEqual(['submitted', 'submitted', 'submitted']);
  });

  test('leaves a CAPTCHA page for the person and skips a posting that forbids AI, submitting neither', async ({ connected: ext, routeLog }) => {
    routeLog.serve({ [greenhouseAt('04')]: CAPTCHA, [greenhouseAt('05')]: NO_AI });
    await mock.queueAgent([task(4, greenhouseAt('04'), 'Platform Engineer'), task(5, greenhouseAt('05'), 'Data Engineer')]);
    const first = agentPage(ext, greenhouseAt('04'));
    await agentOn(ext);
    const captcha = await first;
    const second = agentPage(ext, greenhouseAt('05'));
    await expect.poll(async () => (await results()).length, { timeout: 45_000 }).toBeGreaterThanOrEqual(1);
    expect((await results())[0]).toMatchObject({ id: task(4, '', '').id, body: { state: 'needs-you', reason: 'captcha' } });
    await expect.poll(() => captcha.isClosed(), { timeout: 15_000 }).toBe(true);

    const noAi = await second;
    await expect.poll(async () => (await results()).length, { timeout: 45_000 }).toBe(2);
    expect((await results())[1]).toMatchObject({ id: task(5, '', '').id,
      body: { state: 'skipped', reason: 'posting_forbids_ai' } });
    await expect.poll(() => noAi.isClosed(), { timeout: 15_000 }).toBe(true);
    // Nothing was submitted, and nothing of it went to the AI (a profile-only fill).
    expect(await mock.requestsTo('POST /api/autofill/ai/*')).toEqual([]);
  });

  test('Stop leaves the running job for the person and turns auto-apply off', async ({ connected: ext, routeLog }) => {
    // A page that never shows a form keeps the job running until Stop.
    routeLog.serve({ [greenhouseAt('06')]: { body: '<!doctype html><title>Loading</title><p>Loading…</p>',
      contentType: 'text/html; charset=utf-8' } });
    await mock.queueAgent([task(6, greenhouseAt('06'), 'Site Engineer')]);
    const opened = agentPage(ext, greenhouseAt('06'));
    await agentOn(ext);
    const page = await opened;
    await expect.poll(async () => (await ext.data<{ phase: string }>({ v: 1, type: 'agent/status' })).phase).toBe('running');
    const stopped = await ext.data<{ on: boolean }>({ v: 1, type: 'agent/stop' });
    expect(stopped.on).toBe(false);
    await expect.poll(async () => (await results()).length).toBe(1);
    expect((await results())[0]).toMatchObject({ body: { state: 'needs-you', reason: 'cancelled' } });
    await expect.poll(() => page.isClosed(), { timeout: 15_000 }).toBe(true);
  });
});

test.describe('Sign-in mode Auto (v3 Phase 5)', () => {
  /** jr6: the dummies saved in this browser's Sign-up Information. */
  async function withSignIn(ext: Extension): Promise<void> {
    await savePassword(ext);
  }

  test.afterEach(async ({ ext }) => {
    await ext.data({ v: 1, type: 'settings/save', settings: DEFAULT_SETTINGS });
    await deletePassword(ext);
    await ext.send({ v: 1, type: 'auth/disconnect' });
  });

  test('signs in with the saved sign-in, never into a honeypot, and then fills the page that follows', async ({ extContext, connected: ext, routeLog }) => {
    await withSignIn(ext);
    await ext.data({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
      modes: { ...DEFAULT_SETTINGS.modes, signIn: 'auto' } } });
    const page = await extContext.newPage();
    routeLog.serve({ [signInAt('login')]: SIGN_IN });
    await page.goto(signInAt('login'));
    const tabId = await ext.fill(page);
    await expect.poll(() => datasetOf(page, 'submits'), { timeout: 30_000 }).toBe('1');
    expect(await datasetOf(page, 'emailOk')).toBe('true');
    expect(await datasetOf(page, 'passwordOk')).toBe('true');
    expect(await datasetOf(page, 'terms')).toBe('true');
    expect(await datasetOf(page, 'trapsEmpty')).toBe('true');
    expect(await datasetOf(page, 'steal')).toBe('nothing');
    // jr6: the sign-in is this browser's own: TailorIT is asked for none.
    expect(await mock.requestsTo('GET /api/autofill/credentials')).toEqual([]);
    // The run then goes on: the page that follows is filled.
    await expect.poll(async () => page.locator('#first').inputValue(), { timeout: 30_000 }).not.toBe('');
    const report = (await ext.reports(tabId)).find((each) => each.frameId === 0);
    expect(report?.notices.map((notice) => notice.code)).not.toContain('sign-in-failed');
    // Nothing of the password reached storage.
    const stored = JSON.stringify(await ext.storage());
    expect(stored).not.toContain(DUMMY.password);
  });

  test('creates the account on a create-account page: the email, the password twice, the terms', async ({ extContext, connected: ext, routeLog }) => {
    await withSignIn(ext);
    await ext.data({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
      modes: { ...DEFAULT_SETTINGS.modes, signIn: 'auto' } } });
    const page = await extContext.newPage();
    routeLog.serve({ [signInAt('create-account')]: CREATE_ACCOUNT });
    await page.goto(signInAt('create-account'));
    await ext.fill(page);
    await expect.poll(() => datasetOf(page, 'passwordOk'), { timeout: 30_000 }).toBe('true');
    expect(await datasetOf(page, 'confirmOk')).toBe('true');
    expect(await datasetOf(page, 'emailOk')).toBe('true');
    expect(await datasetOf(page, 'terms')).toBe('true');
  });

  test('a sign-in the site does not take is pressed once, and says so; Autofill again types it for the person', async ({ extContext, connected: ext, routeLog }) => {
    await withSignIn(ext);
    await ext.data({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
      modes: { ...DEFAULT_SETTINGS.modes, signIn: 'auto' } } });
    const page = await extContext.newPage();
    const url = `${signInAt('login')}&wrong`;
    routeLog.serve({ [url]: SIGN_IN });
    await page.goto(url);
    const tabId = await ext.fill(page);
    await expect.poll(async () => (await ext.reports(tabId)).find((each) => each.frameId === 0)?.notices
      .map((notice) => notice.code), { timeout: 45_000 }).toContain('sign-in-failed');
    expect(await datasetOf(page, 'submits')).toBe('1');
    // The page emptied its password box itself.
    await expect(page.locator('#password')).toHaveValue('');
    // Autofill again on the same page: the tab pressed it already, so it is not pressed again; the jr6 review (R1): the
    // saved password is typed for the person's own press instead, never refused.
    await ext.fill(page);
    await expect(page.locator('#password')).toHaveValue(DUMMY.password, { timeout: 30_000 });
    await expect.poll(async () => (await ext.reports(tabId)).find((each) => each.frameId === 0)?.status,
      { timeout: 30_000 }).toBe('auth-needed');
    expect(await datasetOf(page, 'submits')).toBe('1');
    expect(await mock.requestsTo('GET /api/autofill/credentials')).toEqual([]);
  });

  test('jr6: Sign-in Manual with a password saved types it, and leaves Sign In to the person', async ({ extContext, connected: ext, routeLog }) => {
    await withSignIn(ext);
    const page = await extContext.newPage();
    routeLog.serve({ [signInAt('login')]: SIGN_IN });
    await page.goto(signInAt('login'));
    const tabId = await ext.fill(page, { plain: true });
    await expect(page.locator('#password')).toHaveValue(DUMMY.password, { timeout: 30_000 });
    await expect(page.locator('#email')).toHaveValue(DUMMY.email);
    const report = await ext.settled(tabId);
    expect(report.status).toBe('auth-needed');
    expect(report.notices.map((notice) => notice.code)).not.toContain('sign-in-auto');
    expect(await datasetOf(page, 'submits')).toBe('0');
    expect(await datasetOf(page, 'trapsEmpty')).not.toBe('false');
    expect(await mock.requestsTo('GET /api/autofill/credentials')).toEqual([]);
  });

  test('Sign-in Manual with no password saved leaves the page to the person', async ({ extContext, connected: ext, routeLog }) => {
    const page = await extContext.newPage();
    routeLog.serve({ [signInAt('login')]: SIGN_IN });
    await page.goto(signInAt('login'));
    // A plain Autofill (the page's own launcher's): at this wall the side panel's button is Sign up & Autofill, which
    // would grant Sign-in Auto for the run (v4).
    const tabId = await ext.fill(page, { plain: true });
    const report = await ext.settled(tabId);
    expect(report.status).toBe('auth-needed');
    expect(report.notices.map((notice) => notice.code)).toContain('auth');
    expect(report.notices.map((notice) => notice.code)).not.toContain('sign-in-auto');
    expect(await page.locator('#email').inputValue()).toBe('');
    expect(await page.locator('#password').inputValue()).toBe('');
    expect(await datasetOf(page, 'submits')).toBe('0');
    expect(await mock.requestsTo('GET /api/autofill/credentials')).toEqual([]);
  });
});

test.describe('a page cannot reach the agent or the password (v3 Phase 5)', () => {
  /** What the worker would act on if it took them: the agent's, the run's and Sign-in's messages; jr6, Sign-up
   *  Information's. */
  const ATTEMPTS = [{ v: 1, type: 'agent/set', on: true, confirmed: true }, { v: 1, type: 'agent/stop' },
    { v: 1, type: 'agent/status' }, { v: 1, type: 'run/start', dryRun: false, agent: true }, { v: 1, type: 'agent/enter' },
    { v: 1, type: 'signin/credential', wall: 'sign-in' }, { v: 1, type: 'run/press', target: 'submit', confirmed: true },
    { v: 1, type: 'run/begin', applicationKey: 'greenhouse:0000000000000001', trigger: 'agent', dryRun: false },
    { v: 1, type: 'signup/status' }, { v: 1, type: 'signup/delete' }, { v: 1, type: 'signup/import' },
    { v: 1, type: 'signup/save', email: 'mallory@example.com', password: 'Mallory-Chosen-Pass-99!' }];

  test.afterEach(async ({ ext }) => {
    await ext.data({ v: 1, type: 'settings/save', settings: DEFAULT_SETTINGS });
    await deletePassword(ext);
  });

  test('TailorIT’s own pages, the one origin that may message the extension, start no agent and get no password', async ({ extContext, connected: ext }) => {
    // jr6: a password saved, so Sign-in may be on Auto.
    await savePassword(ext);
    await ext.data({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
      modes: { ...DEFAULT_SETTINGS.modes, signIn: 'auto', submit: 'auto' } } });
    await mock.queueAgent([task(8, greenhouseAt('08'), 'Site Engineer')]);
    const page = await extContext.newPage();
    // The connect page (externally_connectable), and any other page of TailorIT's origin.
    for (const address of [CONNECT_PAGE, `${MOCK_ORIGIN}/__mock/health`]) {
      await page.goto(address);
      const answers = await page.evaluate(async ({ id, attempts }) => {
        const runtime = (globalThis as unknown as { chrome?: { runtime?: { sendMessage?: unknown } } }).chrome?.runtime;
        if (runtime === undefined || typeof runtime.sendMessage !== 'function') return null;
        const send = runtime.sendMessage as (target: string, message: unknown) => Promise<unknown>;
        const out: string[] = [];
        for (const message of attempts) {
          try {
            out.push(JSON.stringify(await send(id, message) ?? null));
          } catch {
            out.push('threw');
          }
        }
        return out;
      }, { id: ext.id, attempts: ATTEMPTS });
      // The page could message the extension (its origin may), and every message was refused.
      expect(answers, address).not.toBeNull();
      expect(answers, address).toHaveLength(ATTEMPTS.length);
      for (const answer of answers!) expect(answer, address).toMatch(/^\{"ok":false,"error":"bad_(?:sender|message)"\}$/);
    }
    const status = await ext.data<{ on: boolean }>({ v: 1, type: 'agent/status' });
    expect(status.on).toBe(false);
    expect(await mock.requestsTo('GET /api/autofill/agent/next')).toEqual([]);
    expect(await mock.requestsTo('GET /api/autofill/credentials')).toEqual([]);
    expect((await mock.agent()).rows.map((row) => row.state)).toEqual(['queued']);
    // jr6: Sign-up Information is still the person's own, as they saved it.
    expect(await ext.data({ v: 1, type: 'signup/status' })).toMatchObject({ set: true, email: DUMMY.email });
  });

  test('a job site’s page script starts no agent, presses no Submit and gets no password', async ({ extContext, connected: ext, routeLog }) => {
    // Sign-in and Submit on Auto, but the page never asked through a run of ours: its own tries reach nothing (a job
    // site's page cannot message the extension at all: it is not TailorIT's origin). jr6: a password saved for Auto.
    await savePassword(ext);
    await ext.data({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
      modes: { ...DEFAULT_SETTINGS.modes, signIn: 'auto', submit: 'auto' } } });
    const page = await extContext.newPage();
    routeLog.serve({ [signInAt('login')]: SIGN_IN, [greenhouseAt('07')]: GREENHOUSE });
    await page.goto(signInAt('login'));
    await ext.frameWithForm(await ext.tabIdOf(page));
    const reachable = await page.evaluate(() => typeof (globalThis as unknown as { chrome?: { runtime?: { sendMessage?: unknown } } })
      .chrome?.runtime?.sendMessage === 'function');
    expect(reachable).toBe(false);
    // jr6: never signup/save's own attempt here, whose `password` field the page's own detector would take for a leak.
    const tries = ATTEMPTS.filter((message) => !('password' in message));
    await page.evaluate((attempts) => {
      for (const message of attempts) {
        window.postMessage(message, '*');
        document.dispatchEvent(new CustomEvent('tailorit:bridge', { detail: JSON.stringify({ v: 1, id: 'x', op: message.type }) }));
      }
    }, tries);
    await page.waitForTimeout(1_000);
    expect(await datasetOf(page, 'steal')).toBe('nothing');
    expect(await page.locator('#password').inputValue()).toBe('');
    expect(await mock.requestsTo('GET /api/autofill/credentials')).toEqual([]);
    expect((await ext.data<{ on: boolean }>({ v: 1, type: 'agent/status' })).on).toBe(false);
    expect(await mock.requestsTo('GET /api/autofill/agent/next')).toEqual([]);
    // A Greenhouse form: the page's own script cannot make the extension press its Submit either.
    const form = await extContext.newPage();
    await form.goto(greenhouseAt('07'));
    await ext.frameWithForm(await ext.tabIdOf(form));
    await form.evaluate((attempts) => {
      for (const message of attempts) {
        window.postMessage(message, '*');
        document.dispatchEvent(new CustomEvent('tailorit:bridge', { detail: JSON.stringify({ v: 1, id: 'y', op: message.type }) }));
      }
    }, tries);
    await form.waitForTimeout(1_000);
    expect(await datasetOf(form, 'submitted')).toBe('0');
  });
});

test.describe('Options: Auto-apply and Sign-in (v3 Phase 5)', () => {
  test('shows Run auto-apply and its status, Sign-in with its Auto needing a saved job-site password (jr6), and the skip rules', async ({ connected: ext }) => {
    const options = await ext.page();
    await options.goto(ext.url('options.html'));
    const card = options.locator('[data-card="agent"]');
    await expect(card).toBeVisible();
    const run = card.locator('input[data-setting="agent.on"]');
    await expect(run).not.toBeChecked();
    await expect(card.locator('[data-agent-line]')).toContainText('Auto-apply: off');
    await expect(card.locator('a[data-tailorit-link="auto-apply"]')).toHaveText(COPY.agent.open);
    // Whether this connection was confirmed before (another test may have): the first click asks only when it was not.
    const confirmed = (await ext.data<{ confirmed: boolean }>({ v: 1, type: 'agent/status' })).confirmed;
    const question = card.locator('[data-agent-confirm]');
    await run.click();
    if (!confirmed) {
      await expect(question).toBeVisible();
      await question.locator('button[data-action="agent-confirm"]').click();
    }
    await expect(question).toHaveCount(0);
    await expect(run).toBeChecked();
    await expect(card.locator('[data-agent-line]')).toContainText('Auto-apply: waiting for a job');
    await card.locator('button[data-action="agent-stop"]').click();
    await expect(run).not.toBeChecked();
    // Confirmed now: on again at a click, asking nothing.
    await run.click();
    await expect(run).toBeChecked();
    await expect(question).toHaveCount(0);
    await card.locator('button[data-action="agent-stop"]').click();
    await expect(run).not.toBeChecked();
    const signIn = options.locator('[data-setting-group="modes.signIn"]');
    await expect(signIn.locator('input[data-setting="modes.signIn.manual"]')).toBeChecked();
    // jr6: no job-site password is saved in this browser: Auto cannot be chosen, and the group says why.
    await expect(signIn.locator('input[data-setting="modes.signIn.auto"]')).toBeDisabled();
    // v4 ui: why, in the group's "?".
    await expect(signIn).toHaveAttribute('data-mode-blocked', 'auto');
    await expect(signIn.locator('[role="tooltip"]')).toContainText(COPY.options.modes.signIn.needsPassword);
    const skips = options.locator('[data-setting-group="modes.agentSkip"]');
    await expect(skips.locator('input[data-setting="modes.agentSkip.requiredEmpty"]')).toBeChecked();
    await expect(skips.locator('input[data-setting="modes.agentSkip.noAi"]')).toBeChecked();
    await expect(skips.locator('input[data-setting="modes.agentSkip.legalGuess"]')).not.toBeChecked();
  });
});
