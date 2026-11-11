/*
 * The content runtime's fixes from the audit of 2026-11-06 (runtime.ts, submitted.ts):
 * - M3: Continue after a paused dry run is a dry run too, so it writes nothing the paused run only showed;
 * - m13: a new run (the panel's Fill) never starts beside a paused run whose Sign-in Auto still waits: that run is
 *   ended first, so it types and presses nothing;
 * - m10: a Submit's sign that comes after SUBMIT_CONFIRM_MS is still watched for, quietly, until SUBMIT_WATCH_MS, and
 *   records the application; after that it is not;
 * - S-9: a frame on a domain that also holds an employer's own pages, below a page of its own origin that is no
 *   posting's, does nothing at all (no listener, no frame/hello, no UI); below a posting's own page, another origin's
 *   page, or on a host that serves only public job postings, it speaks as before;
 * - the sign already on the page at the press is never this Submit's, even once the form is gone (the surviving
 *   mutation of submitted.ts newSuccessSign's `before`, which a form still shown had masked).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import trap11 from '../../fixtures/traps/11-forged-wxt-events.html?raw';
import { genericAdapter } from '../adapters/generic';
import { greenhouseAdapter } from '../adapters/greenhouse';
import type { Adapter } from '../adapters/types';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import type { Settings } from '../core/types/settings';
import { loadFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import { deadline } from '../dom/time';
import { createFakeWorker, testVocab, trapUrl } from './content.testkit';
import { startContentRuntime, type ContentRuntime, type RuntimeOptions } from './runtime';
import { newSuccessSign, signsOf } from './submitted';

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

async function start(html: string, href: string, options: { adapters?: Adapter[]; settings?: Settings;
  script?: Record<string, unknown[]>; runtime?: Partial<RuntimeOptions> } = {}) {
  const fixture = await loadFixture(document, html, { width: 1100, height: 1000 });
  const worker = createFakeWorker({ settings: options.settings ?? DEFAULT_SETTINGS, script: (options.script ?? {}) as never });
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => href, isTop: true,
    adapters: () => options.adapters ?? [genericAdapter], settle: { quietMs: 40 }, ...options.runtime });
  runtimes.push(runtime);
  return { fixture, worker, runtime };
}

/** The values of every form control on the page: what the extension may have written. */
const formValues = (doc: Document) => Array.from(doc.querySelectorAll<HTMLInputElement>('input'), (el) => el.value);

const PLAIN = trap11.replace(/<script>[\s\S]*<\/script>/, '');

describe('M3: Continue after a paused dry run', () => {
  it('continues as a dry run: nothing is written, and the second run/begin says dry run', async () => {
    const page = PLAIN.replace('<button type="submit">', '<label for="pw" id="pw-label">Password</label>'
      + '<input id="pw" type="password"><button type="submit">');
    const { fixture, worker, runtime } = await start(page, trapUrl('m3-dry'));
    expect(await runtime.fill({ dryRun: true })).toBe('paused');
    expect(worker.reports.at(-1)).toMatchObject({ status: 'auth-needed', mode: 'dry-run' });
    // The person signs in: the password box goes, and they choose Continue.
    fixture.doc.getElementById('pw')!.remove();
    fixture.doc.getElementById('pw-label')!.remove();
    expect(await worker.platform.deliver({ v: 1, type: 'run/continue' })).toEqual({ ok: true, data: {} });
    await vi.waitFor(() => expect(worker.of('run/begin')).toHaveLength(2));
    await vi.waitFor(() => expect(runtime.run?.ended).toBe('review'));
    expect(worker.of('run/begin').map((begin) => begin.dryRun)).toEqual([true, true]);
    expect(runtime.run?.request.dryRun).toBe(true);
    expect(formValues(fixture.doc)).toEqual(['', '', '']);
    expect(worker.reports.at(-1)).toMatchObject({ status: 'review', mode: 'dry-run' });
    expect(worker.runStates).toEqual([]);
  });
});

const HOST = 'acme.wd5.myworkdayjobs.com';
/** An application's account page on a Workday tenant (as content/sign-in.browser.test.ts's). */
const SIGN_IN_HREF = `https://${HOST}/en-US/careers/job/x/Engineer_JR-0000001/apply/applyManually`;
const CREDENTIAL = { host: HOST, email: 'alex.rivera@example.com', password: 'dummy-password-not-real', press: true };
const SIGN_IN_PAGE = `<!doctype html><html><head><title>Sign In</title><style>
    body { margin: 0; background: #fff; color: #222; font: 16px/1.5 system-ui; }
    input[type=email], input[type=password] { display: block; width: 300px; padding: 6px; border: 1px solid #888; }
  </style></head><body><main>
  <form id="sign-in" method="post">
    <label for="email">Email Address</label><input id="email" type="email" autocomplete="username">
    <label for="password">Password</label><input id="password" type="password" autocomplete="current-password">
    <label><input id="terms" type="checkbox" required> I agree to the terms</label>
    <button id="go" type="submit">Sign In</button>
  </form></main>
  <script>
    window.submits = 0;
    document.getElementById('sign-in').addEventListener('submit', (event) => {
      event.preventDefault();
      window.submits += 1;
    });
  </script></body></html>`;

describe('m13: a new run beside a paused run’s Sign-in Auto', () => {
  it('ends the paused run first: its sign-in, still waiting for the worker, types and presses nothing', async () => {
    let answer!: (value: unknown) => void;
    const held = new Promise((resolve) => {
      answer = resolve;
    });
    const auto = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, signIn: 'auto' as const } };
    const { fixture, worker, runtime } = await start(SIGN_IN_PAGE, SIGN_IN_HREF, { settings: auto,
      script: { 'signin/credential': [held, { ok: false, error: 'unavailable' }] } });
    expect(await runtime.fill()).toBe('paused');
    await vi.waitFor(() => expect(worker.of('signin/credential')).toHaveLength(1));
    const paused = runtime.run;
    // The side panel's Fill, while the paused run's sign-in waits for the worker's answer.
    expect(await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false })).toEqual({ ok: true, data: {} });
    await vi.waitFor(() => expect(worker.of('run/begin')).toHaveLength(2));
    expect(runtime.run).not.toBe(paused);
    // The worker answers the paused run's request now: nothing of it is typed, nothing pressed.
    answer({ ok: true, data: CREDENTIAL });
    await deadline(600);
    const doc = fixture.doc;
    expect((doc.getElementById('password') as HTMLInputElement).value).toBe('');
    expect((doc.getElementById('email') as HTMLInputElement).value).toBe('');
    expect((doc.getElementById('terms') as HTMLInputElement).checked).toBe(false);
    expect((fixture.view as unknown as { submits: number }).submits).toBe(0);
  });
});

const GREENHOUSE = 'https://job-boards.greenhouse.io/tailoritfixture/jobs/4401';

/** A Greenhouse-shaped form (as content/press.browser.test.ts's): its Submit in .application--submit. `onSubmit` is the
 *  page's script once the form is submitted, `main` its <main>; `before` goes before <main>. */
function greenhousePage(onSubmit: string, before = ''): string {
  return `<!doctype html><html><head><title>Job Application for Engineer at Northwind</title></head><body>${before}
  <main class="main"><h1>Engineer</h1>
  <form id="application-form" class="application--form">
    <div class="field-wrapper"><label for="first_name">First Name<span>*</span></label>
      <input id="first_name" name="first_name" type="text" aria-required="true"></div>
    <div class="field-wrapper"><label for="last_name">Last Name<span>*</span></label>
      <input id="last_name" name="last_name" type="text" aria-required="true" value="Rivera"></div>
    <div class="application--submit"><button id="submit" class="btn btn--pill" type="submit">Submit application</button></div>
  </form></main>
  <script>
    window.submitted = 0;
    document.getElementById('application-form').addEventListener('submit', (event) => {
      event.preventDefault();
      window.submitted += 1;
      const main = document.querySelector('main');
      ${onSubmit}
    });
  </script></body></html>`;
}

/** The page's confirmation, drawn in place of the form `afterMs` after the submit. */
const confirmationAfter = (afterMs: number) => `setTimeout(() => {
        main.replaceChildren();
        const box = document.createElement('div');
        box.className = 'confirmation';
        box.innerHTML = '<div class="confirmation__content"><h1>Thank you for applying to Northwind!</h1></div>';
        main.append(box);
      }, ${afterMs});`;

describe('m10: a Submit’s sign after SUBMIT_CONFIRM_MS', () => {
  it('still records the application when the sign comes after the review said to check the page', async () => {
    const { worker, runtime } = await start(greenhousePage(confirmationAfter(3_500)), GREENHOUSE,
      { adapters: [greenhouseAdapter], runtime: { submitConfirmMs: 2_500 } });
    expect(await runtime.fill()).toBe('review');
    expect(await worker.platform.deliver({ v: 1, type: 'run/press', target: 'submit', confirmed: true }))
      .toEqual({ ok: true, data: { outcome: 'pressed' } });
    await vi.waitFor(() => expect(worker.reports.at(-1)!.notices).toContainEqual({ code: 'submit-unconfirmed' }),
      { timeout: 6_000 });
    expect(worker.of('submit/detected')).toEqual([]);
    // The platform's sign, a second later: the quiet watch takes it, and the run is done.
    await vi.waitFor(() => expect(worker.of('submit/detected')).toHaveLength(1), { timeout: 6_000 });
    await vi.waitFor(() => expect(worker.reports.at(-1)!.status).toBe('done'), { timeout: 3_000 });
    // The sign settles it: the done report no longer says to check the page.
    expect(worker.reports.at(-1)!.notices).not.toContainEqual({ code: 'submit-unconfirmed' });
  });

  it('stops watching at SUBMIT_WATCH_MS after the press', async () => {
    const { worker, runtime } = await start(greenhousePage(confirmationAfter(3_500)), GREENHOUSE,
      { adapters: [greenhouseAdapter], runtime: { submitConfirmMs: 2_500, submitWatchMs: 3_000 } });
    expect(await runtime.fill()).toBe('review');
    expect(await worker.platform.deliver({ v: 1, type: 'run/press', target: 'submit', confirmed: true }))
      .toEqual({ ok: true, data: { outcome: 'pressed' } });
    await vi.waitFor(() => expect(worker.reports.at(-1)!.notices).toContainEqual({ code: 'submit-unconfirmed' }),
      { timeout: 6_000 });
    await deadline(2_000);
    expect(worker.of('submit/detected')).toEqual([]);
    expect(worker.reports.at(-1)!.status).not.toBe('done');
  });
});

describe('a sign already on the page at the press (submitted.ts newSuccessSign)', () => {
  const PLANTED = `<aside><div class="confirmation"><div class="confirmation__content"><h1>Thank you for applying to
    Northwind!</h1></div></div></aside>`;

  it('is never this Submit’s, even once the form is gone', async () => {
    // The press takes the form away and draws nothing new: only the block that was there before shows.
    const { fixture, worker, runtime } = await start(greenhousePage('main.replaceChildren();', PLANTED), GREENHOUSE,
      { adapters: [greenhouseAdapter], runtime: { submitConfirmMs: 2_500 } });
    expect(await runtime.fill()).toBe('review');
    expect(await worker.platform.deliver({ v: 1, type: 'run/press', target: 'submit', confirmed: true }))
      .toEqual({ ok: true, data: { outcome: 'pressed' } });
    await vi.waitFor(() => expect((fixture.view as unknown as { submitted: number }).submitted).toBe(1));
    expect(fixture.doc.getElementById('application-form')).toBeNull();
    await deadline(400);
    expect(worker.of('submit/detected')).toEqual([]);
    expect(worker.reports.at(-1)!.status).not.toBe('done');
  });

  it('reads only a sign that is new since the press, where the form was', async () => {
    const fixture: Fixture = await loadFixture(document, greenhousePage('', PLANTED), { width: 1100, height: 1000 });
    const root = greenhouseAdapter.detect(fixture.doc)!.formRoot;
    const before = new Set(signsOf(fixture.doc, 'greenhouse'));
    expect(before.size).toBe(1);
    const armedWith = { before, root, adapter: greenhouseAdapter };
    // The form still shown: nothing.
    expect(newSuccessSign(fixture.doc, 'greenhouse', armedWith)).toBeNull();
    // The form gone, and only the block that was there at the press: nothing.
    root.remove();
    expect(newSuccessSign(fixture.doc, 'greenhouse', armedWith)).toBeNull();
    // A new block drawn: that one.
    const fresh = fixture.doc.createElement('div');
    fresh.className = 'confirmation';
    const content = fixture.doc.createElement('div');
    content.className = 'confirmation__content';
    content.textContent = 'Thank you';
    fresh.append(content);
    fixture.doc.body.append(fresh);
    expect(newSuccessSign(fixture.doc, 'greenhouse', armedWith)).toBe(content);
  });
});

describe('S-9: a frame below an employer’s own page', () => {
  const TALEO_POSTING = 'https://acme.taleo.net/careersection/2/jobdetail.ftl?job=123456';

  it('does nothing at all below a page of its own origin that shows no posting', async () => {
    const fixture = await loadFixture(document, PLAIN);
    const worker = createFakeWorker();
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => TALEO_POSTING, isTop: false,
      adapters: () => [genericAdapter], ancestors: () => ['https://acme.taleo.net/enterprise/home'] });
    runtimes.push(runtime);
    expect(runtime.stopped).toBe(true);
    expect(runtime.ui).toBeNull();
    expect(worker.platform.handlerRegistered).toBe(false);
    expect(worker.of('frame/hello')).toEqual([]);
    expect(fixture.doc.documentElement.lastElementChild?.localName).toBe('body');
  });

  it('reads its ancestors from its window by default: below the test page (no posting’s), it is silent', async () => {
    const fixture = await loadFixture(document, PLAIN);
    const worker = createFakeWorker();
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => TALEO_POSTING, isTop: false,
      adapters: () => [genericAdapter] });
    runtimes.push(runtime);
    expect(runtime.stopped).toBe(true);
    expect(worker.of('frame/hello')).toEqual([]);
  });

  it('speaks below a posting’s own page, below another origin’s page, at the top and on a job board’s host', async () => {
    const speaks = async (href: string, isTop: boolean, ancestors?: readonly string[]) => {
      const fixture = await loadFixture(document, PLAIN);
      const worker = createFakeWorker();
      const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => href, isTop,
        adapters: () => [genericAdapter], ...(ancestors === undefined ? {} : { ancestors: () => ancestors }) });
      runtimes.push(runtime);
      return worker.of('frame/hello').length === 1 && !runtime.stopped;
    };
    expect(await speaks(TALEO_POSTING, false, [TALEO_POSTING])).toBe(true);
    expect(await speaks(TALEO_POSTING, false, [])).toBe(true);
    expect(await speaks(TALEO_POSTING, true, ['https://acme.taleo.net/enterprise/home'])).toBe(true);
    // The fixture board's form, below the test page itself: a host that serves only public job postings.
    expect(await speaks(trapUrl('s9'), false)).toBe(true);
  });
});
