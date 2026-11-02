/*
 * The step driver on the 4-step wizard (fixtures/synthetic/wizard-4-step), against what the Phase 5 review found: each
 * case is one finding's scenario, through the real content runtime, the e2e-only test adapter and the fake worker
 * planning with the real core. A test's own untrusted click() on a page button stands for the page moving on; a
 * trusted click or key press (userEvent at the element, inside the fixture's frame) is the person's.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { userEvent } from 'vitest/browser';
import html from '../../fixtures/synthetic/wizard-4-step/index.html?raw';
import trap01b from '../../fixtures/traps/01b-canary-equals-profile.html?raw';
import { e2eAdaptersFor, WIZARD_URL } from '../adapters/test';
import type { Adapter } from '../adapters/types';
import { MAX_IDLE_TRANSITIONS } from '../core/steps/machine';
import type { RunState } from '../core/types/run';
// The Phase 2-6 behaviour these tests pin: version 1's defaults in version 2's shape (the owner's amendments' new
// defaults have tests of their own: fill-all.browser.test.ts).
import { CAUTIOUS_SETTINGS } from '../core/plan/settings.testkit';
import { loadFixture, logEvents, removeFixtures, type EventLog, type Fixture } from '../dom/fixture.testkit';
import { deadline } from '../dom/time';
import type { FrameReport } from '../shared/report';
import { createFakeWorker, goldenProfile, testVocab, trapUrl, type FakeWorker, type FakeWorkerOptions } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

const ADAPTER: Adapter = e2eAdaptersFor(new URL(WIZARD_URL))[0]!;
const AUTO = { settings: { ...CAUTIOUS_SETTINGS, modes: { ...CAUTIOUS_SETTINGS.modes, next: 'auto' as const } } } satisfies FakeWorkerOptions;
/** The worker's settings/changed push after the person saved auto-advance off in the options page. */
const SETTING_OFF = { v: 1, type: 'settings/changed', settings: { panel: 'side',
  modes: { next: CAUTIOUS_SETTINGS.modes.next, afterPageTurn: CAUTIOUS_SETTINGS.modes.afterPageTurn },
  llm: CAUTIOUS_SETTINGS.llm, offerToSaveAnswers: true } } as const;

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

/** What the page script keeps (index.html's header). */
interface Wizard {
  step: number;
  shown: number[];
  next: Array<{ step: number; trusted: boolean }>;
}

interface Loaded {
  fixture: Fixture;
  runtime: ContentRuntime;
  events: EventLog;
}

/** The wizard in a fresh document, its runtime started on `worker` (a reload is another load on the same worker). */
async function load(worker: FakeWorker, page = html, options: { isTop?: boolean; capMs?: number } = {}): Promise<Loaded> {
  const fixture = await loadFixture(document, page, { width: 900, height: 1400 });
  const events = logEvents(fixture.doc);
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => WIZARD_URL,
    isTop: options.isTop ?? true, adapters: () => [ADAPTER], settle: { quietMs: 60 },
    ...(options.capMs === undefined ? {} : { transition: { capMs: options.capMs } }) });
  runtimes.push(runtime);
  return { fixture, runtime, events };
}

const wizard = (fixture: Fixture) => JSON.parse(JSON.stringify((fixture.view as unknown as { __wizard: Wizard })
  .__wizard)) as Wizard;
const byId = <T extends HTMLElement = HTMLInputElement>(fixture: Fixture, id: string) => fixture.doc.getElementById(id) as T;
const lastState = (worker: FakeWorker): RunState => worker.runStates.at(-1)!;
const lastReport = (worker: FakeWorker): FrameReport => worker.reports.at(-1)!;
const codes = (report: FrameReport) => report.notices.map((notice) => notice.code);
const row = (report: FrameReport, label: string, section = 'your-details') => {
  const found = report.fields.find((candidate) => candidate.section === section && candidate.label === label);
  if (found === undefined) throw new Error(`no row ${label} in ${section}`);
  return found;
};

/** Waits until the run rests again, its report sent after the first `reports` of them, with RunState and the report
 *  at `status`. */
async function restsAgain(worker: FakeWorker, reports: number, status: RunState['status'] = 'wait-transition') {
  await vi.waitFor(() => {
    expect(worker.reports.length).toBeGreaterThan(reports);
    expect(lastState(worker).status).toBe(status);
    expect(lastReport(worker).status).toBe(status);
  }, { timeout: 15_000, interval: 50 });
}

/** The person's own (trusted) click at an element inside the fixture's frame. */
async function personClick(fixture: Fixture, el: Element): Promise<void> {
  el.scrollIntoView({ block: 'center' });
  const box = el.getBoundingClientRect();
  await userEvent.click(fixture.frame, { position: { x: box.left + box.width / 2, y: box.top + box.height / 2 } });
}

/** The person types over a field's whole value (their own trusted key presses). The field is one the run wrote and
 *  the run rests: their edit makes it theirs, and the report says so at once (Phase 6, wave 2), before the test goes
 *  on. */
async function personTypes(fixture: Fixture, id: string, keys: string, worker: FakeWorker): Promise<void> {
  const before = worker.reports.length;
  await personClick(fixture, byId(fixture, id));
  await userEvent.keyboard(`{Control>}a{/Control}${keys}`);
  await vi.waitFor(() => expect(worker.reports.length).toBeGreaterThan(before), { timeout: 5000, interval: 25 });
}

/** The wizard with `script` run when step 1's phone (its last field) changes: what the page shows after our last write. */
const onPhoneChange = (script: string) => html.replace("wireCurrent(byId('experience-0'));",
  `byId('phone').addEventListener('change', () => { ${script} });\n      wireCurrent(byId('experience-0'));`);
const CAPTCHA = `if (byId('captcha')) return; const c = document.createElement('div'); c.className = 'g-recaptcha';
  c.id = 'captcha'; c.dataset.sitekey = '6Lc_test'; c.style.cssText = 'width:304px;height:78px'; byId('next-details').before(c);`;
const SIGN_IN = `if (byId('pw')) return; const d = document.createElement('div'); d.id = 'signin';
  d.innerHTML = '<label for="pw">Password</label><input id="pw" type="password">'; document.querySelector('main').before(d);`;
const CODE_BOX = `if (byId('code')) return; const d = document.createElement('div');
  d.innerHTML = '<label for="code">Verification code</label><input id="code">'; document.querySelector('main').before(d);`;

/** The wizard whose first Next on step 1 empties the phone and marks it invalid instead of moving on (typing clears
 *  the mark): the person's Next leaves an error a fix pass can address. */
const EMPTIES_PHONE = html.replace("button.addEventListener('click', (event) => {\n          wizard.next.push(",
  `button.addEventListener('click', (event) => {
          if (wizard.next.length === 0 && wizard.step === 1) { const phone = byId('phone'); phone.value = '';
            phone.setAttribute('aria-invalid', 'true'); wizard.next.push({ step: 0, trusted: event.isTrusted }); return; }
          wizard.next.push(`).replace("wireCurrent(byId('experience-0'));", `byId('phone').addEventListener('input', () => byId('phone').removeAttribute('aria-invalid'));
      wireCurrent(byId('experience-0'));`);

describe('C-S1, X-S1: a pause the step shows after a write is found before anything more is written or pressed', () => {
  for (const [name, script, status, reason] of [
    ['a CAPTCHA', CAPTCHA, 'handoff', 'captcha'],
    ['a sign-in box outside the form', SIGN_IN, 'auth-needed', null],
    ['an email-code box outside the form, known by its label', CODE_BOX, 'handoff', 'email-code'],
  ] as const) {
    it(`pauses on ${name} that step 1's last write revealed, and never presses Next past it`, async () => {
      const worker = createFakeWorker(AUTO);
      const loaded = await load(worker, onPhoneChange(script));
      expect(await loaded.runtime.fill()).toBe('paused');
      expect(wizard(loaded.fixture).next).toEqual([]);
      expect(lastState(worker)).toMatchObject({ status, pauseReason: reason });
      expect(lastReport(worker).status).toBe(status);
      expect(logs.mock.calls.filter(([line]) => line === '[tailorit-autofill] content.next-pressed')).toEqual([]);
    });
  }

  it('pauses on a CAPTCHA the page shows between the validation and the click on Next', async () => {
    let shown = false;
    const holder: { fixture?: Fixture } = {};
    const worker = createFakeWorker({ ...AUTO, onMessage: (message) => {
      const state = (message as { runState?: RunState }).runState;
      if (message.type !== 'runstate/put' || state?.status !== 'advance' || shown || holder.fixture === undefined) return;
      shown = true;
      const widget = holder.fixture.doc.createElement('div');
      widget.className = 'g-recaptcha';
      widget.dataset.sitekey = '6Lc_test';
      widget.style.cssText = 'width:304px;height:78px';
      holder.fixture.doc.getElementById('next-details')!.before(widget);
    } });
    const fixture = await loadFixture(document, html, { width: 900, height: 1400 });
    holder.fixture = fixture;
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => WIZARD_URL, isTop: true,
      adapters: () => [ADAPTER], settle: { quietMs: 60 } });
    runtimes.push(runtime);
    expect(await runtime.fill()).toBe('paused');
    expect(shown).toBe(true);
    expect(wizard(fixture).next).toEqual([]);
    expect(lastState(worker)).toMatchObject({ status: 'handoff', pauseReason: 'captcha', resumeStatus: 'advance' });
  });

  it('writes nothing more behind a sign-in box that the first write revealed outside the form', async () => {
    const page = html.replace("wireCurrent(byId('experience-0'));",
      `byId('name').addEventListener('change', () => { ${SIGN_IN} });\n      wireCurrent(byId('experience-0'));`);
    const worker = createFakeWorker();
    const loaded = await load(worker, page);
    expect(await loaded.runtime.fill()).toBe('paused');
    expect(['name', 'email', 'phone'].map((id) => byId(loaded.fixture, id).value !== '')).toEqual([true, false, false]);
    expect(loaded.events.on('email').filter((event) => event.type === 'input')).toEqual([]);
    expect(lastState(worker).status).toBe('auth-needed');
  });
});

describe('C-S2: auto-advance is read afresh', () => {
  it('presses nothing on a later step once the person turned auto-advance off mid-run', async () => {
    // Step 2 holds a question no profile answers (the run waits there); step 3 has nothing to fill (its school section
    // goes, and its Add is a hidden button the page script still finds).
    const shift = /<h3>Additional questions<\/h3>[\s\S]*?<\/select>/.exec(html)![0];
    const page = html.replace(shift, '')
      .replace('<div id="education-blocks" data-repeatable="education"></div>', '')
      .replace('<button id="add-education" class="add" data-add="education">Add education</button>',
        '<button id="add-education" type="button" hidden>Add education</button>')
      .replace('<button type="button" id="add-experience"', `${shift}\n<button type="button" id="add-experience"`);
    expect(page).not.toBe(html);
    const worker = createFakeWorker(AUTO);
    const loaded = await load(worker, page);
    expect(await loaded.runtime.fill()).toBe('waiting');
    expect(wizard(loaded.fixture)).toMatchObject({ step: 2, next: [{ step: 1, trusted: false }] });
    // The person turns auto-advance off in the options page; the worker pushes the change to the tab's frames.
    expect(await worker.platform.deliver(SETTING_OFF)).toEqual({ ok: true, data: {} });
    byId<HTMLButtonElement>(loaded.fixture, 'next-experience').click();
    await vi.waitFor(() => expect(wizard(loaded.fixture).step).toBe(3));
    await vi.waitFor(() => {
      expect(lastState(worker).status).toBe('wait-transition');
      expect(Object.keys(lastState(worker).stepAttempts)).toHaveLength(3);
    }, { timeout: 15_000 });
    expect(wizard(loaded.fixture).next.filter((click) => click.step === 3)).toEqual([]);
  });

  it('withholds the click when the setting is turned off between the validation and the click', async () => {
    let pushed = false;
    const worker: FakeWorker = createFakeWorker({ ...AUTO, onMessage: (message) => {
      const state = (message as { runState?: RunState }).runState;
      if (message.type !== 'runstate/put' || state?.status !== 'advance' || pushed) return;
      pushed = true;
      void worker.platform.deliver(SETTING_OFF);
    } });
    const loaded = await load(worker);
    expect(await loaded.runtime.fill()).toBe('waiting');
    expect(pushed).toBe(true);
    expect(wizard(loaded.fixture).next).toEqual([]);
    expect(lastState(worker)).toMatchObject({ status: 'wait-transition', stepIndex: 0 });
    // It rests there, waiting for the person's own Next: the report says so (v3 Phase 3 review), so no panel says
    // "Autofilling" meanwhile.
    await vi.waitFor(() => expect(lastReport(worker)).toMatchObject({ status: 'wait-transition', resting: true }));
  });
});

describe('C-S3: a later attempt on a step never writes over what the person typed meanwhile', () => {
  it('keeps the name the person typed while the run rested, in the fix pass after their Next', async () => {
    const worker = createFakeWorker();
    const loaded = await load(worker, EMPTIES_PHONE);
    expect(await loaded.runtime.fill()).toBe('waiting');
    const signature = lastState(worker).stepSignature!;
    expect(byId(loaded.fixture, 'name').value).toBe(goldenProfile().identity.fullName);
    await personTypes(loaded.fixture, 'name', 'Jordan Person', worker);
    const reports = worker.reports.length;
    await personClick(loaded.fixture, byId(loaded.fixture, 'next-details'));
    await restsAgain(worker, reports);
    expect(lastState(worker).stepAttempts[signature]).toBe(2);
    expect(byId(loaded.fixture, 'name').value).toBe('Jordan Person');
    expect(row(lastReport(worker), 'Full name')).toMatchObject({ status: 'flagged', reason: 'changed-by-you',
      wrote: false, provenance: null });
    // The page emptied the phone itself: that one is written again.
    expect(byId(loaded.fixture, 'phone').value.replace(/\D/g, '')).toContain('5125550147');
  });

  it('keeps the name the person typed when the page goes back to the step, and gives the step its own index', async () => {
    const worker = createFakeWorker();
    const loaded = await load(worker);
    expect(await loaded.runtime.fill()).toBe('waiting');
    await personTypes(loaded.fixture, 'name', 'Jordan Person', worker);
    let reports = worker.reports.length;
    byId<HTMLButtonElement>(loaded.fixture, 'next-details').click();
    await restsAgain(worker, reports);
    expect(lastState(worker).stepIndex).toBe(1);
    reports = worker.reports.length;
    byId<HTMLButtonElement>(loaded.fixture, 'back-experience').click();
    await restsAgain(worker, reports);
    expect(Object.values(lastState(worker).stepAttempts)).toEqual([2, 1]);
    expect(byId(loaded.fixture, 'name').value).toBe('Jordan Person');
    // C-S8: a step seen again keeps its place.
    expect(lastState(worker).stepIndex).toBe(0);
    expect(lastReport(worker).step).toEqual({ index: 0, progress: 'Step 1 of 4' });
    expect(row(lastReport(worker), 'Full name')).toMatchObject({ status: 'flagged', reason: 'changed-by-you' });
    expect(row(lastReport(worker), 'Email')).toMatchObject({ status: 'verified', wrote: true });
  });

  it('writes nothing over the person on a step the page went back to before the next step was filled', async () => {
    // The page goes back to step 1 as soon as step 2's Add is clicked, before step 2's first pass.
    const page = html.replace("byId('add-experience').addEventListener('click', () => wireCurrent(addBlock('experience', 'Position')));",
      `byId('add-experience').addEventListener('click', () => { wireCurrent(addBlock('experience', 'Position'));
        if (wizard.step === 2) byId('back-experience').click(); });`);
    expect(page).not.toBe(html);
    const worker = createFakeWorker();
    const loaded = await load(worker, page);
    expect(await loaded.runtime.fill()).toBe('waiting');
    await personTypes(loaded.fixture, 'name', 'Jordan Person', worker);
    const reports = worker.reports.length;
    byId<HTMLButtonElement>(loaded.fixture, 'next-details').click();
    await vi.waitFor(() => expect(wizard(loaded.fixture).shown).toEqual([1, 2, 1]), { timeout: 15_000 });
    await restsAgain(worker, reports);
    expect(byId(loaded.fixture, 'name').value).toBe('Jordan Person');
    expect(loaded.events.on('name').filter((event) => !event.trusted && event.type === 'input')).toHaveLength(1);
    expect(lastState(worker).stepIndex).toBe(0);
  });

  it('leaves a field the person emptied for them: it is no error a fix pass may fill', async () => {
    // The page refuses to move on from step 1 while the phone is empty, and marks it.
    const page = html.replace("button.addEventListener('click', (event) => {\n          wizard.next.push(",
      `button.addEventListener('click', (event) => {
          if (wizard.step === 1 && byId('phone').value === '') { byId('phone').setAttribute('aria-invalid', 'true');
            wizard.next.push({ step: 0, trusted: event.isTrusted }); return; }
          wizard.next.push(`);
    expect(page).not.toBe(html);
    const worker = createFakeWorker();
    const loaded = await load(worker, page);
    expect(await loaded.runtime.fill()).toBe('waiting');
    const signature = lastState(worker).stepSignature!;
    await personTypes(loaded.fixture, 'phone', '{Backspace}', worker);
    expect(byId(loaded.fixture, 'phone').value).toBe('');
    await personClick(loaded.fixture, byId(loaded.fixture, 'next-details'));
    await vi.waitFor(() => expect(lastState(worker).status).toBe('review'), { timeout: 15_000 });
    expect(lastState(worker).stepAttempts[signature]).toBe(1);
    expect(byId(loaded.fixture, 'phone').value).toBe('');
    expect(codes(lastReport(worker))).toContain('validation');
  });
});

describe('C-S4: Fill anyway after a reload at the policy card', () => {
  async function start(worker: FakeWorker) {
    const fixture = await loadFixture(document, trap01b);
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => trapUrl('01b-reload'),
      isTop: true, settle: { quietMs: 60 } });
    runtimes.push(runtime);
    return { fixture, runtime };
  }

  it('scans the step first: the tripwire is read and its canary blocks the write that holds it', async () => {
    const worker = createFakeWorker({ policy: { postingPage: 'hit', storedCopy: 'clear' } });
    const first = await start(worker);
    void first.runtime.fill();
    await vi.waitFor(() => expect(first.runtime.run!.atPolicyCard).toBe(true));
    first.runtime.stop();
    removeFixtures(document);
    const second = await start(worker);
    await vi.waitFor(() => expect(second.runtime.run?.atPolicyCard).toBe(true), { timeout: 10_000 });
    await worker.platform.deliver({ v: 1, type: 'run/policyDecision', decision: 'fill' });
    await vi.waitFor(() => expect(second.runtime.run!.ended).toBe('review'), { timeout: 10_000 });
    expect((second.fixture.doc.getElementById('city') as HTMLInputElement).value).toBe('');
    expect(codes(lastReport(worker))).toContain('tripwire');
    expect(worker.of('plan/request').at(-1)!.canaries).not.toEqual([]);
  });
});

describe('X-S2: the person\'s own Next on a slow page', () => {
  it('is never pressed again on top of theirs: no step is skipped unfilled', async () => {
    // Next is enabled a moment after the phone is typed, and the page moves on 400 ms after a click.
    const page = html
      .replace('<button type="button" id="next-details" data-action="next">', '<button type="button" id="next-details" data-action="next" disabled>')
      .replace('if (wizard.step < LAST) go(wizard.step + 1);', 'setTimeout(() => { if (wizard.step < LAST) go(wizard.step + 1); }, 400);')
      .replace("wireCurrent(byId('experience-0'));", `byId('phone').addEventListener('change', () => setTimeout(() => { byId('next-details').disabled = false; }, 250));
      wireCurrent(byId('experience-0'));`);
    expect(page).not.toBe(html);
    const worker = createFakeWorker(AUTO);
    const loaded = await load(worker, page);
    expect(await loaded.runtime.fill()).toBe('waiting');
    const next = byId<HTMLButtonElement>(loaded.fixture, 'next-details');
    await vi.waitFor(() => expect(next.disabled).toBe(false), { timeout: 5000 });
    await personClick(loaded.fixture, next);
    // Step 2 is filled before anything is pressed on it; its own Next is the extension's, once it is clean.
    await vi.waitFor(() => expect(wizard(loaded.fixture).step).toBe(3), { timeout: 15_000 });
    await vi.waitFor(() => expect(lastState(worker).status).toBe('wait-transition'), { timeout: 15_000 });
    expect(wizard(loaded.fixture).next.filter((click) => click.step === 1)).toEqual([{ step: 1, trusted: true }]);
    expect(wizard(loaded.fixture).shown).toEqual([1, 2, 3]);
    expect(byId(loaded.fixture, 'company-0').value).toBe(goldenProfile().experience[0]!.company);
  });
});

describe('X-S4: a CAPTCHA the person was handed', () => {
  const withCaptcha = (inner = '') => html.replace('<button type="button" id="next-details"',
    `<div class="g-recaptcha" id="captcha" data-sitekey="6Lc_test" style="width:304px;height:78px">${inner}</div>
        <button type="button" id="next-details"`);

  it('fills at the person\'s Continue once they solved it, the widget still in place holding its token', async () => {
    const page = withCaptcha('<textarea id="g-recaptcha-response" name="g-recaptcha-response" style="display:none"></textarea>');
    const worker = createFakeWorker();
    const loaded = await load(worker, page);
    expect(await loaded.runtime.fill()).toBe('paused');
    byId<HTMLTextAreaElement>(loaded.fixture, 'g-recaptcha-response').value = '03AFcWeA-token';
    await worker.platform.deliver({ v: 1, type: 'run/continue' });
    await vi.waitFor(() => expect(lastReport(worker).status).toBe('wait-transition'), { timeout: 15_000 });
    expect(byId(loaded.fixture, 'name').value).toBe(goldenProfile().identity.fullName);
    expect(byId(loaded.fixture, 'captcha').isConnected).toBe(true);
  });

  it('does not pause again for the widget it handed over, but does for one the page puts in its place', async () => {
    const worker = createFakeWorker();
    const loaded = await load(worker, withCaptcha());
    expect(await loaded.runtime.fill()).toBe('paused');
    // The page swaps in a new widget before the person's Continue: that one has not been handed over.
    const fresh = byId(loaded.fixture, 'captcha').cloneNode(true) as HTMLElement;
    byId(loaded.fixture, 'captcha').replaceWith(fresh);
    await worker.platform.deliver({ v: 1, type: 'run/continue' });
    await vi.waitFor(() => expect(worker.of('run/begin')).toHaveLength(2));
    await vi.waitFor(() => expect(loaded.runtime.run!.ended).toBe('paused'), { timeout: 15_000 });
    expect(lastState(worker)).toMatchObject({ status: 'handoff', pauseReason: 'captcha' });
    expect(byId(loaded.fixture, 'name').value).toBe('');
    // Continue again: the widget the person now has is theirs, and the step is filled with it in place.
    await worker.platform.deliver({ v: 1, type: 'run/continue' });
    await vi.waitFor(() => expect(lastReport(worker).status).toBe('wait-transition'), { timeout: 15_000 });
    expect(byId(loaded.fixture, 'name').value).toBe(goldenProfile().identity.fullName);
  });

  describe('with auto-advance on: Next is never pressed on a step whose CAPTCHA is not known solved', () => {
    /** Fills, pauses at the widget, and continues: the step is filled with the widget in place. */
    async function continued(page: string, solve?: (fixture: Fixture) => void) {
      const worker = createFakeWorker(AUTO);
      const loaded = await load(worker, page);
      expect(await loaded.runtime.fill()).toBe('paused');
      solve?.(loaded.fixture);
      await worker.platform.deliver({ v: 1, type: 'run/continue' });
      await vi.waitFor(() => expect(byId(loaded.fixture, 'phone').value).not.toBe(''), { timeout: 15_000 });
      return { worker, loaded };
    }

    it('fills the step after the person\'s Continue, leaves Next to them with the notice, and follows their Next', async () => {
      const { worker, loaded } = await continued(withCaptcha(
        '<textarea id="g-recaptcha-response" name="g-recaptcha-response" style="display:none"></textarea>'));
      await vi.waitFor(() => expect(lastReport(worker).status).toBe('wait-transition'), { timeout: 15_000 });
      expect(byId(loaded.fixture, 'name').value).toBe(goldenProfile().identity.fullName);
      expect(wizard(loaded.fixture).next).toEqual([]);
      expect(codes(lastReport(worker))).toContain('captcha-next');
      // The person's own Next: the run follows to step 2, fills it and, step 2 being clean, presses its Next.
      await personClick(loaded.fixture, byId(loaded.fixture, 'next-details'));
      await vi.waitFor(() => expect(wizard(loaded.fixture).step).toBe(3), { timeout: 15_000 });
      expect(wizard(loaded.fixture).next).toEqual([{ step: 1, trusted: true }, { step: 2, trusted: false }]);
      expect(byId(loaded.fixture, 'company-0').value).toBe(goldenProfile().experience[0]!.company);
    });

    it('presses Next as before once the widget holds its token', async () => {
      const { loaded } = await continued(withCaptcha(
        '<textarea id="g-recaptcha-response" name="g-recaptcha-response" style="display:none"></textarea>'),
      (fixture) => {
        byId<HTMLTextAreaElement>(fixture, 'g-recaptcha-response').value = '03AFcWeA-token';
      });
      await vi.waitFor(() => expect(wizard(loaded.fixture).next[0]).toEqual({ step: 1, trusted: false }),
        { timeout: 15_000 });
    });

    it('never presses Next past a widget whose vendor has no token field (Arkose), whatever sits beside it', async () => {
      const page = html.replace('<button type="button" id="next-details"', `<div id="arkose"><iframe srcdoc=""
          src="https://client-api.arkoselabs.com/fc/gc/?token=x" style="width:300px;height:200px;border:0"></iframe>
          <input type="hidden" name="fc-token" value=""></div>
        <button type="button" id="next-details"`);
      const { worker, loaded } = await continued(page, (fixture) => {
        fixture.doc.querySelector<HTMLInputElement>('input[name="fc-token"]')!.value = 'solved-looking';
      });
      await vi.waitFor(() => expect(lastReport(worker).status).toBe('wait-transition'), { timeout: 15_000 });
      await deadline(300);
      expect(wizard(loaded.fixture).next).toEqual([]);
      expect(codes(lastReport(worker))).toContain('captcha-next');
    });
  });
});

describe('C-S5: a fix pass keeps the first attempt\'s rows', () => {
  it('reports the first attempt\'s verified writes as ours, and counts both attempts\' passes', async () => {
    const worker = createFakeWorker();
    const loaded = await load(worker, EMPTIES_PHONE);
    expect(await loaded.runtime.fill()).toBe('waiting');
    const passes = lastReport(worker).counters.passes;
    const signature = lastState(worker).stepSignature!;
    const reports = worker.reports.length;
    await personClick(loaded.fixture, byId(loaded.fixture, 'next-details'));
    await restsAgain(worker, reports);
    expect(lastState(worker).stepAttempts[signature]).toBe(2);
    const report = lastReport(worker);
    for (const label of ['Full name', 'Email', 'Phone']) {
      expect(row(report, label), label).toMatchObject({ status: 'verified', wrote: true });
    }
    expect(report.counters.passes).toBeGreaterThan(passes);
  });
});

describe('C-S6: Cancel at a pause', () => {
  it('stops the run for good: RunState and the report say stopped, and Continue no longer resumes it', async () => {
    const page = html.replace('<button type="button" id="next-details"',
      '<div class="g-recaptcha" data-sitekey="6Lc_test" style="width:304px;height:78px"></div>\n<button type="button" id="next-details"');
    const worker = createFakeWorker();
    const loaded = await load(worker, page);
    expect(await loaded.runtime.fill()).toBe('paused');
    expect(await worker.platform.deliver({ v: 1, type: 'run/cancel' })).toEqual({ ok: true, data: {} });
    await vi.waitFor(() => {
      expect(lastState(worker).status).toBe('stopped');
      expect(lastReport(worker).status).toBe('stopped');
    });
    expect(loaded.runtime.ui!.launcher.view).toMatchObject({ state: 'idle', action: 'fill' });
    await worker.platform.deliver({ v: 1, type: 'run/continue' });
    await deadline(300);
    expect(worker.of('run/begin')).toHaveLength(1);
    expect(byId(loaded.fixture, 'name').value).toBe('');
  });
});

describe('C-S7: a run that failed', () => {
  it('rests at review in RunState, so a reload offers Continue and fills nothing by itself', async () => {
    const worker = createFakeWorker({ script: { 'plan/request': [{ ok: false, error: 'internal' }] } });
    const first = await load(worker);
    expect(await first.runtime.fill()).toBe('error');
    expect(lastState(worker).status).toBe('review');
    expect(first.runtime.ui!.launcher.view).toMatchObject({ state: 'error' });
    first.runtime.stop();
    removeFixtures(document);
    const second = await load(worker);
    await vi.waitFor(() => expect(second.runtime.run?.ended).toBe('paused'), { timeout: 10_000 });
    expect(second.runtime.ui!.launcher.view).toMatchObject({ state: 'needs-you', action: 'continue' });
    expect(worker.of('plan/request')).toHaveLength(1);
    expect(byId(second.fixture, 'name').value).toBe('');
  });
});

describe('X-S5: a page that keeps flipping its step', () => {
  it('stores and reports a bounded number of times, keeps each step\'s index, and stops watching', async () => {
    const worker = createFakeWorker();
    const loaded = await load(worker);
    expect(await loaded.runtime.fill()).toBe('waiting');
    const progress = byId<HTMLElement>(loaded.fixture, 'progress');
    const flips = 3 * MAX_IDLE_TRANSITIONS;
    for (let flip = 1; flip <= flips; flip += 1) {
      progress.textContent = flip % 2 === 1 ? 'Step 1 of 4 (again)' : 'Step 1 of 4';
      // A look, its settle and whatever it started.
      await deadline(150);
      await vi.waitFor(() => expect(loaded.runtime.run!.watching || loaded.runtime.run!.ended === 'review').toBe(true),
        { timeout: 10_000 });
    }
    expect(loaded.runtime.run!.watching).toBe(false);
    expect(loaded.runtime.run!.ended).toBe('review');
    expect(worker.runStates.length).toBeLessThan(flips);
    expect(worker.reports.length).toBeLessThan(flips / 2);
    expect(Math.max(...worker.runStates.map((state) => state.stepIndex))).toBeLessThanOrEqual(1);
    expect(Object.values(lastState(worker).stepAttempts).every((count) => count <= 2)).toBe(true);
    // Once it stopped watching, the page flipping again changes nothing.
    const puts = worker.runStates.length;
    progress.textContent = 'Step 1 of 4 (once more)';
    await deadline(300);
    expect(worker.runStates).toHaveLength(puts);
  }, 60_000);
});

describe('X-S8: a frame its page hides just before the click on Next', () => {
  it('pauses instead of pressing Next where the person cannot see it', async () => {
    let hidden = false;
    const holder: { fixture?: Fixture } = {};
    const worker = createFakeWorker({ ...AUTO, onMessage: (message) => {
      const state = (message as { runState?: RunState }).runState;
      if (message.type !== 'runstate/put' || state?.status !== 'advance' || hidden || holder.fixture === undefined) return;
      hidden = true;
      holder.fixture.frame.style.opacity = '0';
    } });
    const fixture = await loadFixture(document, html, { width: 900, height: 1400 });
    holder.fixture = fixture;
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => WIZARD_URL, isTop: false,
      adapters: () => [ADAPTER], settle: { quietMs: 60 } });
    runtimes.push(runtime);
    expect(await runtime.fill()).toBe('paused');
    expect(hidden).toBe(true);
    expect(wizard(fixture).next).toEqual([]);
    expect(lastState(worker)).toMatchObject({ status: 'handoff', pauseReason: 'needs-click' });
    expect(codes(lastReport(worker))).toContain('next-hidden');
  });
});
