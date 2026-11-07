/*
 * The behaviour review of 2026-11-06 in the content script (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06):
 * - B1: the invisible reCAPTCHA badge (.grecaptcha-badge, on every Greenhouse fixture, Dayforce's and CareerPlug's) holds
 *   no press. A Greenhouse Submit the person confirmed is pressed, Dayforce's Next and CareerPlug's Submit too; Dayforce's
 *   step whose challenge popup shows (fixtures/dayforce/submit-challenge) is still blocked, and so is a synthetic page
 *   whose bframe shows.
 * - M6 (the owner's decision; docs/SPEC-AMENDMENTS.md §12): a checkbox widget not yet solved (reCAPTCHA v2's, hCaptcha's),
 *   with no challenge popup shown, does not stop the fill. It holds every press until the person solves it: Next (the
 *   run's auto-advance and the panel's), Submit (Submit mode Auto and the panel's), the agent's entry and Sign-in Auto;
 *   the agent reads the review's CAPTCHA notice as needs-you captcha. The run never touches the widget: nothing is
 *   written into its frame or its response field, shown or not. Its challenge popup, once shown, still pauses the run
 *   before anything is filled.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import careerplugHtml from '../../fixtures/careerplug/cloudscouts-form.html?raw';
import dayforceInfoHtml from '../../fixtures/dayforce/candidate-info.html?raw';
import dayforceChallengeHtml from '../../fixtures/dayforce/submit-challenge.html?raw';
import discordHtml from '../../fixtures/greenhouse/discord-job.html?raw';
import axleHtml from '../../fixtures/greenhouse/axle-attached.html?raw';
import wizardHtml from '../../fixtures/synthetic/wizard-4-step/index.html?raw';
import { careerPlugAdapter } from '../adapters/careerplug';
import { dayforceAdapter } from '../adapters/dayforce';
import { greenhouseAdapter } from '../adapters/greenhouse';
import { e2eAdaptersFor, WIZARD_URL } from '../adapters/test';
import { SNAPSHOT_VIEWPORT } from '../adapters/test/expectations.testkit';
import type { Adapter } from '../adapters/types';
import { agentVerdict } from '../background/agent';
import { DEFAULT_SETTINGS, type Settings } from '../core/types/settings';
import { loadFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import { pageChallenged } from '../dom/pause-detect';
import { scan } from '../dom/scan';
import type { SignInCredential } from '../messaging/schemas';
import { createFakeWorker, testVocab } from './content.testkit';
import { pressEntry, pressStep, type PressPage } from './press';
import { startContentRuntime, type ContentRuntime } from './runtime';
import { signIn, type SignInContext } from './sign-in';

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

/** A snapshot's press page for `adapter`, its `target` button's click counted and held (nothing navigates). */
async function snapshot(html: string, adapter: Adapter, target: 'next' | 'submit') {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  fixture.doc.getAnimations().forEach((animation) => animation.finish());
  const root = adapter.detect(fixture.doc)!.formRoot;
  const button = (target === 'next' ? adapter.nextButton!(root) : adapter.submitButton!(root))!;
  const clicks: Event[] = [];
  button.addEventListener('click', (event) => {
    clicks.push(event);
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  const page: PressPage = { doc: fixture.doc, adapter, root, scan: () => ({ fields: [] }) as never };
  return { fixture, page, clicks };
}

describe('the invisible reCAPTCHA badge holds no press (B1)', () => {
  it.each([['discord-job', discordHtml], ['axle-attached', axleHtml]])('Greenhouse %s: a confirmed Submit is pressed',
    async (_name, html) => {
      const { fixture, page, clicks } = await snapshot(html, greenhouseAdapter, 'submit');
      expect(fixture.doc.querySelector('.grecaptcha-badge iframe')).not.toBeNull();
      expect(pageChallenged(fixture.doc)).toBe(false);
      expect(pressStep(page, 'submit', { confirmed: true })).toEqual({ outcome: 'pressed' });
      expect(clicks).toHaveLength(1);
    });

  it('Dayforce’s step 1 Next and CareerPlug’s Submit are pressed beside the badge', async () => {
    const dayforce = await snapshot(dayforceInfoHtml, dayforceAdapter, 'next');
    expect(pressStep(dayforce.page, 'next', { confirmed: true })).toEqual({ outcome: 'pressed' });
    expect(dayforce.clicks).toHaveLength(1);
    removeFixtures(document);
    const careerplug = await snapshot(careerplugHtml, careerPlugAdapter, 'submit');
    expect(pressStep(careerplug.page, 'submit', { confirmed: true })).toEqual({ outcome: 'pressed' });
    expect(careerplug.clicks).toHaveLength(1);
  });

  it('Dayforce’s step whose challenge popup shows is still blocked (fixtures/dayforce/submit-challenge)', async () => {
    const { fixture, page, clicks } = await snapshot(dayforceChallengeHtml, dayforceAdapter, 'submit');
    expect(pageChallenged(fixture.doc)).toBe(true);
    expect(pressStep(page, 'submit', { confirmed: true })).toEqual({ outcome: 'blocked' });
    expect(clicks).toEqual([]);
  });

  it('a Greenhouse Submit is blocked again once a challenge popup shows beside the badge (synthetic bframe)', async () => {
    const { fixture, page, clicks } = await snapshot(discordHtml, greenhouseAdapter, 'submit');
    const popup = fixture.doc.createElement('div');
    popup.style.cssText = 'position:absolute;left:0;top:0;visibility:visible;z-index:2000000000';
    const bframe = fixture.doc.createElement('iframe');
    bframe.setAttribute('srcdoc', '');
    bframe.title = 'recaptcha challenge expires in two minutes';
    bframe.style.cssText = 'width:400px;height:580px';
    bframe.setAttribute('src', 'https://www.google.com/recaptcha/api2/bframe?hl=en&k=x');
    popup.append(bframe);
    fixture.doc.body.append(popup);
    expect(pressStep(page, 'submit', { confirmed: true })).toEqual({ outcome: 'blocked' });
    expect(clicks).toEqual([]);
  });
});

// ── M6 ──
const GREENHOUSE = 'https://job-boards.greenhouse.io/tailoritfixture/jobs/4601';
const AUTO = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, submit: 'auto' as const } };

/** reCAPTCHA v2's checkbox as fixtures/jazzhr/invaluable-form.html draws it, its anchor frame same-origin here (srcdoc)
 *  and holding a box of its own, so a touch of the frame would show; `responseStyle` styles its response field. */
function widget(responseStyle = 'display:none'): string {
  const inner = '<input type=&quot;checkbox&quot; id=&quot;anchor-box&quot; aria-label=&quot;I am not a robot&quot;>';
  return `<div class="field-wrapper"><div class="g-recaptcha" id="widget" data-sitekey="x"><div style="width:304px;
    height:78px"><div><iframe id="anchor" title="reCAPTCHA" width="304" height="78" srcdoc="${inner}"
    src="https://www.google.com/recaptcha/api2/anchor?ar=1&amp;k=x&amp;size=normal"></iframe></div>
    <label for="g-recaptcha-response">Cover letter</label><textarea id="g-recaptcha-response" name="g-recaptcha-response"
    class="g-recaptcha-response" style="${responseStyle}"></textarea></div><iframe style="display:none"></iframe></div></div>`;
}

/** The challenge popup reCAPTCHA draws once the box is clicked (fixtures/dayforce/submit-challenge.html's bframe). */
const POPUP = `<div style="position:absolute;left:0;top:0;visibility:visible"><iframe srcdoc=""
  title="recaptcha challenge expires in two minutes" style="width:400px;height:580px"
  src="https://www.google.com/recaptcha/api2/bframe?hl=en&amp;k=x"></iframe></div>`;

/** A Greenhouse-shaped final step whose names the golden profile fills; `extra` before its Submit, `after` after it. */
function page(extra = '', after = ''): string {
  return `<!doctype html><html><head><title>Job Application for Engineer at Northwind</title></head><body>
  <main class="main"><h1>Engineer</h1>
  <form id="application-form" class="application--form">
    <div class="field-wrapper"><label for="first_name">First Name<span>*</span></label>
      <input id="first_name" name="first_name" type="text" aria-required="true"></div>
    <div class="field-wrapper"><label for="last_name">Last Name<span>*</span></label>
      <input id="last_name" name="last_name" type="text" aria-required="true"></div>
    ${extra}
    <div class="application--submit"><button id="submit" class="btn btn--pill" type="submit">Submit application</button></div>
  </form></main>${after}
  <script>
    window.submitted = 0;
    document.getElementById('application-form').addEventListener('submit', (event) => {
      event.preventDefault();
      window.submitted += 1;
    });
  </script></body></html>`;
}

const submitted = (fixture: Fixture) => (fixture.doc.defaultView as unknown as { submitted: number }).submitted;
const value = (fixture: Fixture, id: string) => (fixture.doc.getElementById(id) as HTMLInputElement).value;

/** Every event the run might cause on the widget: in the page on its response field, and inside its frame. */
function watchWidget(fixture: Fixture): { events: string[] } {
  const events: string[] = [];
  const types = ['focus', 'focusin', 'input', 'change', 'click', 'keydown', 'beforeinput', 'pointerdown'];
  const response = fixture.doc.getElementById('g-recaptcha-response')!;
  for (const type of types) response.addEventListener(type, () => events.push(`response:${type}`), true);
  const inner = (fixture.doc.getElementById('anchor') as HTMLIFrameElement).contentDocument!;
  for (const type of types) inner.addEventListener(type, () => events.push(`frame:${type}`), true);
  return { events };
}

async function start(html: string, settings: Settings = AUTO) {
  const fixture = await loadFixture(document, html, { width: 1100, height: 1200 });
  const frame = fixture.doc.getElementById('anchor') as HTMLIFrameElement | null;
  if (frame !== null && frame.contentDocument?.getElementById('anchor-box') == null) {
    await new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  }
  const worker = createFakeWorker({ settings });
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => GREENHOUSE, isTop: true,
    adapters: () => [greenhouseAdapter], settle: { quietMs: 40 } });
  runtimes.push(runtime);
  return { fixture, worker, runtime };
}

const codes = (worker: ReturnType<typeof createFakeWorker>) => worker.reports.at(-1)!.notices.map((notice) => notice.code);

describe('a checkbox widget holds every press but never the fill (M6)', () => {
  it('fills the step, holds Submit mode Auto, and the agent reads it as needs-you captcha', async () => {
    const { fixture, worker, runtime } = await start(page(widget()));
    const watched = watchWidget(fixture);
    expect(await runtime.fill()).toBe('review');
    // Filled: the step's own fields, from the profile.
    expect(value(fixture, 'first_name')).not.toBe('');
    expect(value(fixture, 'last_name')).not.toBe('');
    await vi.waitFor(() => expect(codes(worker)).toContain('submit-held-captcha'));
    expect(submitted(fixture)).toBe(0);
    expect(worker.of('submit/armed')).toEqual([]);
    const report = worker.reports.at(-1)!;
    expect(report.status).toBe('review');
    expect(agentVerdict(report, { retried: false })).toEqual({ kind: 'finish', state: 'needs-you', reason: 'captcha' });
    // The panel's Submit, with the person's word, is blocked too.
    expect(await worker.platform.deliver({ v: 1, type: 'run/press', target: 'submit', confirmed: true }))
      .toEqual({ ok: true, data: { outcome: 'blocked' } });
    expect(submitted(fixture)).toBe(0);
    // Nothing touched the widget: its frame's box, its response field, and no row names it.
    const inner = (fixture.doc.getElementById('anchor') as HTMLIFrameElement).contentDocument!;
    expect((inner.getElementById('anchor-box') as HTMLInputElement).checked).toBe(false);
    expect(value(fixture, 'g-recaptcha-response')).toBe('');
    expect(watched.events).toEqual([]);
    expect(report.fields.map((row) => row.label)).not.toContain('Cover letter');
  });

  it('never writes into the response field a page shows and labels as a question (adversarial)', async () => {
    const { fixture, worker, runtime } = await start(page(widget('display:block;width:250px;height:40px')));
    const watched = watchWidget(fixture);
    expect(await runtime.fill()).toBe('review');
    expect(value(fixture, 'first_name')).not.toBe('');
    expect(value(fixture, 'g-recaptcha-response')).toBe('');
    expect(watched.events).toEqual([]);
    expect(worker.reports.at(-1)!.fields.map((row) => row.label)).not.toContain('Cover letter');
    expect(worker.of('plan/request').flatMap((request) => (request as unknown as { specs: Array<{ label: string }> }).specs)
      .map((field) => field.label)).not.toContain('Cover letter');
  });

  it('presses once the person solved it: its token in the vendor’s field', async () => {
    const { fixture, worker, runtime } = await start(page(widget()), DEFAULT_SETTINGS);
    expect(await runtime.fill()).toBe('review');
    expect(await worker.platform.deliver({ v: 1, type: 'run/press', target: 'submit', confirmed: true }))
      .toEqual({ ok: true, data: { outcome: 'blocked' } });
    (fixture.doc.getElementById('g-recaptcha-response') as HTMLTextAreaElement).value = '03AFcWeA-token';
    expect(await worker.platform.deliver({ v: 1, type: 'run/press', target: 'submit', confirmed: true }))
      .toEqual({ ok: true, data: { outcome: 'pressed' } });
    expect(submitted(fixture)).toBe(1);
  });

  it('pauses before anything is filled once the challenge popup shows (adversarial)', async () => {
    const { fixture, worker, runtime } = await start(page(widget(), POPUP));
    const watched = watchWidget(fixture);
    expect(await runtime.fill()).toBe('paused');
    expect(worker.reports.at(-1)).toMatchObject({ status: 'handoff', pauseReason: 'captcha', fields: [] });
    expect(value(fixture, 'first_name')).toBe('');
    expect(worker.of('plan/request')).toEqual([]);
    expect(watched.events).toEqual([]);
    expect(agentVerdict(worker.reports.at(-1)!, { retried: false }))
      .toEqual({ kind: 'finish', state: 'needs-you', reason: 'captcha' });
  });

  it('holds auto-advance’s Next on a step it filled, and the review says why', async () => {
    const ADAPTER = e2eAdaptersFor(new URL(WIZARD_URL))[0]!;
    const html = wizardHtml.replace('<button type="button" id="next-details"', `${widget()}
        <button type="button" id="next-details"`);
    const fixture = await loadFixture(document, html, { width: 900, height: 1400 });
    const worker = createFakeWorker({ settings: { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes,
      next: 'auto' as const } } });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => WIZARD_URL, isTop: true,
      adapters: () => [ADAPTER], settle: { quietMs: 60 } });
    runtimes.push(runtime);
    const nexts: Event[] = [];
    fixture.doc.getElementById('next-details')!.addEventListener('click', (event) => nexts.push(event), true);
    await runtime.fill();
    await vi.waitFor(() => expect(codes(worker)).toContain('captcha-next'), { timeout: 15_000 });
    expect(nexts).toEqual([]);
    expect((fixture.view as unknown as { __wizard: { step: number } }).__wizard.step).toBe(1);
    expect(worker.reports.at(-1)!.fields.filter((row) => row.wrote).length).toBeGreaterThan(0);
    expect(agentVerdict(worker.reports.at(-1)!, { retried: false }))
      .toEqual({ kind: 'finish', state: 'needs-you', reason: 'captcha' });
  });

  it('blocks the agent’s entry on a posting page that shows one, pressing nothing', async () => {
    const posting = `<!doctype html><html><body><main><h1>Engineer</h1>
      <a id="apply" class="btn" href="#application" role="button">Apply</a>${widget()}</main></body></html>`;
    const fixture = await loadFixture(document, posting, { width: 1100, height: 900 });
    const pressed: Element[] = [];
    fixture.doc.addEventListener('click', (event) => {
      pressed.push(event.target as Element);
      event.preventDefault();
    }, true);
    const entry: Adapter = { ...greenhouseAdapter, detect: () => null,
      entryControl: (doc) => doc.getElementById('apply') };
    expect(await pressEntry(fixture.doc, [entry], new AbortController().signal, 300, 300))
      .toEqual({ outcome: 'blocked', block: 'captcha' });
    expect(pressed).toEqual([]);
  });

  it('keeps Sign-in Auto from typing or pressing on a sign-in page that shows one; the pause is the sign-in', async () => {
    const host = 'acme.wd5.myworkdayjobs.com';
    const signInPage = `<!doctype html><html><body><main><form id="sign-in" method="post">
      <label for="email">Email Address</label><input id="email" type="email" autocomplete="username" style="width:300px">
      <label for="password">Password</label><input id="password" type="password" autocomplete="current-password"
        style="width:300px">${widget()}<button id="go" type="submit">Sign In</button></form></main></body></html>`;
    const fixture = await loadFixture(document, signInPage, { width: 1100, height: 900 });
    const base = fixture.doc.createElement('base');
    base.href = `https://${host}/`;
    fixture.doc.head.prepend(base);
    const asked: unknown[] = [];
    const credential: SignInCredential = { host, email: 'alex.rivera@example.com', password: 'dummy-password-not-real' };
    const channel = { request: async (message: unknown) => {
      asked.push(message);
      return { ok: true, data: credential };
    } } as unknown as SignInContext['channel'];
    const presses: Event[] = [];
    fixture.doc.getElementById('go')!.addEventListener('click', (event) => {
      presses.push(event);
      event.preventDefault();
    }, true);
    const outcome = await signIn({ doc: fixture.doc, adapter: greenhouseAdapter, channel,
      href: () => `https://${host}/en-US/careers/login`, isTop: true, signal: new AbortController().signal,
      settleMs: 300 });
    // The v4 review (M5): 'challenged', so the page's toast says to solve the check.
    expect(outcome).toBe('challenged');
    expect(asked).toEqual([]);
    expect(presses).toEqual([]);
    expect(value(fixture, 'email')).toBe('');
    expect(value(fixture, 'password')).toBe('');
    expect(scan(fixture.doc.getElementById('sign-in')!, null, { platform: 'workday' }).fields
      .map((field) => field.nameAttr)).not.toContain('g-recaptcha-response');
  });
});
