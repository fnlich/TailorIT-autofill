/*
 * The step machine through the real content runtime on the 4-step wizard (fixtures/synthetic/wizard-4-step; Phase 5,
 * wave 2; docs/SPEC.md Requirement C): the runtime, the e2e-only test adapter's hooks and the fake worker planning
 * with the real core and the golden profile. The test's own untrusted click() on a Next stands for the page moving
 * on; a trusted click (userEvent on the fixture's frame, at the button) is the person's.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { userEvent } from 'vitest/browser';
import html from '../../fixtures/synthetic/wizard-4-step/index.html?raw';
import { applicationOf } from '../adapters';
import { e2eAdaptersFor, WIZARD_URL } from '../adapters/test';
import type { Adapter } from '../adapters/types';
import type { PlanOutput } from '../core/plan/types';
import { createRunState } from '../core/steps/machine';
import type { FieldSpec } from '../core/types/field';
import type { FillResult, PlannedWrite } from '../core/types/fill';
import type { ProfilePath } from '../core/types/intent';
import type { RunState } from '../core/types/run';
// The Phase 2-6 behaviour these tests pin: version 1's defaults in version 2's shape (the owner's amendments' new
// defaults have tests of their own: fill-all.browser.test.ts).
import { CAUTIOUS_SETTINGS } from '../core/plan/settings.testkit';
import { loadFixture, logEvents, removeFixtures, untrustedViolations, type EventLog, type Fixture } from '../dom/fixture.testkit';
import type { FrameReport } from '../shared/report';
import { createFakeWorker, goldenProfile, PAGE_TEXT_SENTINELS, sentinelsIn, testVocab, VALUE_SENTINELS,
  type FakeWorker, type FakeWorkerOptions } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

const ADAPTER: Adapter = e2eAdaptersFor(new URL(WIZARD_URL))[0]!;
const SHIFT = 'Which shift pattern would you prefer?';
const [CURRENT_JOB, EARLIER_JOB] = goldenProfile().experience as [ReturnType<typeof goldenProfile>['experience'][0],
  ReturnType<typeof goldenProfile>['experience'][0]];

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
interface Record {
  step: number;
  next: Array<{ step: number; trusted: boolean }>;
  added: { experience: number; education: number };
  ignored: { education: number };
}

interface Loaded {
  fixture: Fixture;
  runtime: ContentRuntime;
  events: EventLog;
}

/** The wizard in a fresh document, its runtime started on `worker` (a reload is another load on the same worker). */
async function load(worker: FakeWorker, page = html): Promise<Loaded> {
  const fixture = await loadFixture(document, page, { width: 900, height: 1400 });
  const events = logEvents(fixture.doc);
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => WIZARD_URL, isTop: true,
    adapters: () => [ADAPTER], settle: { quietMs: 60 } });
  runtimes.push(runtime);
  return { fixture, runtime, events };
}

const record = (fixture: Fixture) => JSON.parse(JSON.stringify((fixture.view as unknown as { __wizard: Record })
  .__wizard)) as Record;
const byId = <T extends HTMLElement = HTMLInputElement>(fixture: Fixture, id: string) => fixture.doc.getElementById(id) as T;
const lastState = (worker: FakeWorker): RunState => worker.runStates.at(-1)!;
const lastReport = (worker: FakeWorker): FrameReport => worker.reports.at(-1)!;
const rowIn = (report: FrameReport, section: string, label: string) => {
  const found = report.fields.find((row) => row.section === section && row.label === label);
  if (found === undefined) throw new Error(`no row ${label} in ${section}: ${report.fields.map((row) => `${row.section} ${row.label}`).join(' | ')}`);
  return found;
};
const codes = (report: FrameReport) => report.notices.map((notice) => notice.code);

/** Waits until the stored RunState rests at `status` on a step other than those in `seen`. */
async function nextStep(worker: FakeWorker, seen: Set<string>, status: RunState['status']): Promise<RunState> {
  await vi.waitFor(() => {
    const state = lastState(worker);
    expect(state.status).toBe(status);
    expect(seen.has(state.stepSignature!)).toBe(false);
    expect(lastReport(worker).status).toBe(status);
  }, { timeout: 15_000, interval: 50 });
  const state = lastState(worker);
  seen.add(state.stepSignature!);
  return state;
}

/** The page moving on: the test's own click on the shown step's Next (not the extension's). */
function pageNext(fixture: Fixture): void {
  const step = record(fixture).step;
  const ids = ['next-details', 'next-experience', 'next-education'];
  byId<HTMLButtonElement>(fixture, ids[step - 1]!).click();
}

/** The person's own (trusted) click at an element inside the fixture's frame. */
async function personClick(fixture: Fixture, el: Element): Promise<void> {
  el.scrollIntoView({ block: 'center' });
  const box = el.getBoundingClientRect();
  await userEvent.click(fixture.frame, { position: { x: box.left + box.width / 2, y: box.top + box.height / 2 } });
}

/** What every case holds: no value in a RunState, a report or a log line; no event the extension may not cause;
 *  nothing submitted, and Submit never touched. */
function expectInvariants(worker: FakeWorker, loaded: Loaded, personClicks: string[] = []): void {
  const sentinels = [...VALUE_SENTINELS, ...PAGE_TEXT_SENTINELS];
  expect(sentinelsIn(JSON.stringify(worker.runStates), sentinels)).toEqual([]);
  expect(sentinelsIn(JSON.stringify(worker.reports), sentinels)).toEqual([]);
  expect(sentinelsIn(JSON.stringify(logs.mock.calls), sentinels)).toEqual([]);
  for (const state of worker.runStates) {
    expect(state.stepSignature === null || /^[0-9a-f]{16}$/.test(state.stepSignature)).toBe(true);
    for (const keys of Object.values(state.filledFieldKeys)) {
      // Stored keys hash the section and label slug: no label reaches RunState.
      for (const key of keys) expect(key.split('|').slice(1, 3).every((part) => /^[0-9a-f]{16}$/.test(part)), key).toBe(true);
    }
  }
  const events = loaded.events.events.filter((event) => !(event.trusted && personClicks.includes(event.target)));
  expect(untrustedViolations(events)).toEqual([]);
  expect(loaded.events.events.filter((event) => event.type === 'submit')).toEqual([]);
  expect(loaded.events.on('submit')).toEqual([]);
}

describe('Autofill after page turn: Manually (v3 Phase 3)', () => {
  it('leaves a new step for the person’s Continue, silently (v4, D7: no page-turned notice), nothing on it written, and Continue fills it', async () => {
    const worker = createFakeWorker({ settings: { ...CAUTIOUS_SETTINGS,
      modes: { ...CAUTIOUS_SETTINGS.modes, afterPageTurn: 'manual' as const } } });
    const loaded = await load(worker);
    const { fixture, runtime } = loaded;
    expect(await runtime.fill({ trigger: 'panel' })).toBe('waiting');
    expect(lastReport(worker).fields.length).toBeGreaterThan(0);
    // The person's Next: step 2 shows, and is not read or filled.
    pageNext(fixture);
    await vi.waitFor(() => expect(lastReport(worker)).toMatchObject({ status: 'review', fields: [] }), { timeout: 10_000 });
    expect(codes(lastReport(worker))).not.toContain('page-turned');
    expect(runtime.ui!.toasts.shown).toEqual([]);
    await vi.waitFor(() => expect(runtime.run!.ended).toBe('paused'));
    expect(runtime.ui!.launcher.view).toMatchObject({ state: 'needs-you', action: 'continue' });
    expect(record(fixture).added).toEqual({ experience: 0, education: 0 });
    expect(byId(fixture, 'company-0').value).toBe('');
    // The person's Continue fills it, as the run would have by itself with Automatically.
    await worker.platform.deliver({ v: 1, type: 'run/continue' });
    await vi.waitFor(() => expect(byId(fixture, 'company-0').value).toBe(CURRENT_JOB.company), { timeout: 10_000 });
    await vi.waitFor(() => expect(codes(lastReport(worker))).not.toContain('page-turned'));
  });
});

describe('the v4 review: the side panel’s Autofill after a page turn continues the run (behaviour H1)', () => {
  it('run/start (not a dry run) on a run resting at a turned page continues it: its RunState, attempts and canaries kept', async () => {
    const worker = createFakeWorker({ settings: { ...CAUTIOUS_SETTINGS,
      modes: { ...CAUTIOUS_SETTINGS.modes, afterPageTurn: 'manual' as const } } });
    const loaded = await load(worker);
    const { fixture, runtime } = loaded;
    expect(await runtime.fill({ trigger: 'panel' })).toBe('waiting');
    const before = lastState(worker);
    expect(before.stepIndex).toBe(0);
    const firstStep = before.stepSignature!;
    pageNext(fixture);
    await vi.waitFor(() => expect(runtime.run!.ended).toBe('paused'), { timeout: 10_000 });
    const resting = runtime.run!;
    // The side panel's Autofill: panel/fill reaches the frame as run/start.
    expect(await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false })).toEqual({ ok: true, data: {} });
    await vi.waitFor(() => expect(byId(fixture, 'company-0').value).toBe(CURRENT_JOB.company), { timeout: 10_000 });
    expect(runtime.run).not.toBe(resting);
    const after = lastState(worker);
    // The same RunState, gone on: begun when the first step was, the first step's attempt kept, the second counted.
    expect(after.startedAt).toBe(before.startedAt);
    expect(after.stepIndex).toBe(1);
    expect(after.stepAttempts[firstStep]).toBe(1);
    expect(Object.keys(after.stepAttempts)).toHaveLength(2);
    expect(after.canarySet).toEqual(expect.arrayContaining(before.canarySet));
    expectInvariants(worker, loaded);
  });
});

describe('auto-advance off: each step filled, then the person moves on', () => {
  it('fills the four steps, adds a position, refuses the typeless Add, and stops at review on the final step',
    async () => {
      const worker = createFakeWorker();
      const loaded = await load(worker);
      const { fixture, runtime } = loaded;
      const seen = new Set<string>();
      expect(await runtime.fill({ trigger: 'panel' })).toBe('waiting');

      // Step 1: filled, then the run waits for the person's Next; nothing pressed.
      let state = await nextStep(worker, seen, 'wait-transition');
      expect(state.stepIndex).toBe(0);
      expect(state.stepAttempts).toEqual({ [state.stepSignature!]: 1 });
      expect(state.filledFieldKeys[state.stepSignature!]).toHaveLength(3);
      // The adapter's progress line rides with the step (Phase 6), as the page shows it.
      expect(lastReport(worker).step).toEqual({ index: 0, progress: 'Step 1 of 4' });
      for (const label of ['Full name', 'Email', 'Phone']) {
        expect(rowIn(lastReport(worker), 'your-details', label)).toMatchObject({ status: 'verified', wrote: true });
      }
      expect(record(fixture).next).toEqual([]);
      expect(runtime.run!.ended).toBe('waiting');
      expect(runtime.ui!.launcher.view).toMatchObject({ state: 'review', action: 'open-review' });

      // Step 2: one Add (two positions, one block shown), the current job first, its end date never touched.
      pageNext(fixture);
      state = await nextStep(worker, seen, 'wait-transition');
      expect(state.stepIndex).toBe(1);
      expect(record(fixture).added).toEqual({ experience: 1, education: 0 });
      expect(loaded.events.on('add-experience').filter((event) => event.type === 'click')).toEqual([
        { type: 'click', trusted: false, target: 'add-experience' }]);
      expect(state.repeatableCounters[`${state.stepSignature}:experience`]).toEqual({ profile: 2, rendered: 2, addClicks: 1 });
      const two = lastReport(worker);
      for (const label of ['Company', 'Job title', 'Start date', 'I currently work here']) {
        expect(rowIn(two, 'experience[0]', label), label).toMatchObject({ status: 'verified', wrote: true });
      }
      expect(rowIn(two, 'experience[0]', 'End date')).toMatchObject({ status: 'skipped', reason: 'end-date-not-applicable',
        wrote: false, provenance: null });
      expect([byId(fixture, 'company-0').value, byId(fixture, 'start-0').value, byId(fixture, 'current-0').checked,
        byId(fixture, 'end-0').disabled, byId(fixture, 'end-0').value])
        .toEqual([CURRENT_JOB.company, '2021-06', true, true, '']);
      expect(loaded.events.on('end-0')).toEqual([]);
      for (const label of ['Company', 'Job title', 'Start date', 'End date']) {
        expect(rowIn(two, 'experience[1]', label), label).toMatchObject({ status: 'verified', wrote: true });
      }
      expect([byId(fixture, 'company-1').value, byId(fixture, 'end-1').value, byId(fixture, 'current-1').checked])
        .toEqual([EARLIER_JOB.company, '2021-05', false]);
      expect(rowIn(two, 'experience[1]', 'I currently work here')).toMatchObject({ wrote: false });
      expect(loaded.events.on('current-1')).toEqual([]);

      // Step 3: "Add education" is a submit button: never clicked, no row (an Add is no field), the needs-click notice.
      pageNext(fixture);
      state = await nextStep(worker, seen, 'wait-transition');
      expect(state.stepIndex).toBe(2);
      expect(loaded.events.on('add-education')).toEqual([]);
      expect(record(fixture)).toMatchObject({ added: { education: 0 }, ignored: { education: 0 } });
      expect(state.repeatableCounters[`${state.stepSignature}:education`]).toEqual({ profile: 1, rendered: 0, addClicks: 0 });
      const three = lastReport(worker);
      expect(three.fields.map((row) => row.label)).not.toContain('Add education');
      expect(three.fields.filter((row) => row.reason === 'needs-your-click')).toEqual([]);
      // v4 (D7, D9): the typeless Add is simply not pressed: no needs-click notice.
      expect(three.notices.map((notice) => notice.code)).not.toContain('needs-click');
      expect(three.fields.find((row) => row.label === SHIFT)).toMatchObject({ status: 'flagged', wrote: false });
      // v4 (D3): the required field left empty holds Next (never pressed on); the education entry the run could not add
      // holds nothing.
      expect(state.lastFill).toMatchObject({ flagged: 1, blocked: 0, unresolved: 0 });

      // Step 4: the final step. Review, Submit the person's, nothing pressed.
      pageNext(fixture);
      state = await nextStep(worker, seen, 'review');
      expect(state.stepIndex).toBe(3);
      expect(Object.values(state.stepAttempts)).toEqual([1, 1, 1, 1]);
      expect(lastReport(worker)).toMatchObject({ status: 'review', fields: [], step: { index: 3 } });
      expect(record(fixture).next).toEqual([{ step: 1, trusted: false }, { step: 2, trusted: false },
        { step: 3, trusted: false }]);
      expect(runtime.ui!.launcher.view).toMatchObject({ state: 'review' });
      // The three Next clicks are the test's own; the extension made none.
      expectInvariants(worker, loaded);
      expect(loaded.events.events.filter((event) => event.target.startsWith('next-') && event.type === 'click'))
        .toHaveLength(3);
    });

  it('stops when the person cancels while it waits for their Next, and the page moving on then changes nothing',
    async () => {
      const worker = createFakeWorker();
      const loaded = await load(worker);
      expect(await loaded.runtime.fill()).toBe('waiting');
      expect(loaded.runtime.run!.watching).toBe(true);
      // The toolbar's Cancel while the run waits for the person's Next.
      expect(await worker.platform.deliver({ v: 1, type: 'run/cancel' })).toEqual({ ok: true, data: {} });
      await vi.waitFor(() => expect(loaded.runtime.run!.ended).toBe('stopped'));
      expect(lastState(worker).status).toBe('stopped');
      expect(lastReport(worker).status).toBe('stopped');
      // The page moving on now changes nothing: the run is over.
      const before = worker.runStates.length;
      pageNext(loaded.fixture);
      await new Promise((resolve) => loaded.fixture.view.requestAnimationFrame(resolve));
      expect(worker.runStates).toHaveLength(before);
      expect(loaded.events.on('company-0')).toEqual([]);
    });
});

describe('auto-advance on', () => {
  it('presses Next on the clean steps only, after their writes, and never on the Review step or Submit', async () => {
    const worker = createFakeWorker({ settings: { ...CAUTIOUS_SETTINGS, modes: { ...CAUTIOUS_SETTINGS.modes, next: 'auto' as const } } });
    const loaded = await load(worker);
    const { fixture, runtime } = loaded;
    // Steps 1 and 2 are clean, so the run presses their Next; step 3 holds flagged fields, so it waits there.
    expect(await runtime.fill()).toBe('waiting');
    const state = lastState(worker);
    expect(state.status).toBe('wait-transition');
    expect(Object.values(state.stepAttempts)).toEqual([1, 1, 1]);
    expect(record(fixture).step).toBe(3);
    expect(record(fixture).next).toEqual([{ step: 1, trusted: false }, { step: 2, trusted: false }]);
    const events = loaded.events.events;
    const lastAt = (target: string, type: string) => events.map((event) => event.target === target && event.type === type)
      .lastIndexOf(true);
    const firstAt = (target: string, type: string) => events.findIndex((event) => event.target === target
      && event.type === type);
    expect(firstAt('next-details', 'click')).toBeGreaterThan(lastAt('phone', 'change'));
    expect(lastAt('end-1', 'change')).toBeGreaterThan(firstAt('next-details', 'click'));
    expect(firstAt('next-experience', 'click')).toBeGreaterThan(lastAt('end-1', 'change'));
    expect(logs.mock.calls.filter(([line]) => line === '[tailorit-autofill] content.next-pressed')).toHaveLength(2);

    // The person's Next on step 3; the Review step is final, so nothing is pressed there.
    pageNext(fixture);
    await vi.waitFor(() => expect(lastState(worker).status).toBe('review'), { timeout: 15_000 });
    expect(Object.keys(lastState(worker).stepAttempts)).toHaveLength(4);
    expect(record(fixture).next).toHaveLength(3);
    expect(byId(fixture, 'submit').ownerDocument).toBe(fixture.doc);
    expectInvariants(worker, loaded);
  });

  it('never judges or presses on a step that showed during the fill: it scans and fills that step first', async () => {
    // The page moves on by itself as soon as the phone, step 1's last field, changes.
    const page = html.replace("wireCurrent(byId('experience-0'));",
      "byId('phone').addEventListener('change', () => byId('next-details').click());\n      wireCurrent(byId('experience-0'));");
    expect(page).not.toBe(html);
    const worker = createFakeWorker({ settings: { ...CAUTIOUS_SETTINGS, modes: { ...CAUTIOUS_SETTINGS.modes, next: 'auto' as const } } });
    const loaded = await load(worker, page);
    expect(await loaded.runtime.fill()).toBe('waiting');
    // Step 2 was filled (its Add and its positions) before anything was pressed on it.
    expect(byId(loaded.fixture, 'company-0').value).toBe(CURRENT_JOB.company);
    expect(byId(loaded.fixture, 'company-1').value).toBe(EARLIER_JOB.company);
    expect(Object.keys(lastState(worker).stepAttempts)).toHaveLength(3);
    // The page's own Next on step 1, then ours on step 2 once it was clean; step 3 waits for the person.
    expect(record(loaded.fixture).next).toEqual([{ step: 1, trusted: false }, { step: 2, trusted: false }]);
    expect(record(loaded.fixture).step).toBe(3);
  });

  it('rests for the person’s Next when its Next leaves the step as it was, at the transition cap (v4, D7: no hand-off)', async () => {
    // A page whose first Next does nothing.
    const page = html.replace("button.addEventListener('click', (event) => {\n          wizard.next.push(",
      "button.addEventListener('click', (event) => {\n          if (wizard.next.length === 0) { wizard.next.push({ step: 0, trusted: event.isTrusted }); return; }\n          wizard.next.push(");
    expect(page).not.toBe(html);
    const worker = createFakeWorker({ settings: { ...CAUTIOUS_SETTINGS, modes: { ...CAUTIOUS_SETTINGS.modes, next: 'auto' as const } } });
    const fixture = await loadFixture(document, page, { width: 900, height: 1400 });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => WIZARD_URL, isTop: true,
      adapters: () => [ADAPTER], settle: { quietMs: 60 }, transition: { capMs: 600 } });
    runtimes.push(runtime);
    expect(await runtime.fill()).toBe('waiting');
    // Validated again, its lastFill cleared: Next is never pressed again by itself; nothing is handed over.
    expect(lastState(worker)).toMatchObject({ status: 'wait-transition', pauseReason: null, lastFill: null });
    expect(codes(lastReport(worker))).not.toContain('needs-click');
    expect(runtime.ui!.launcher.view.state).toBe('review');
    expect(runtime.ui!.toasts.shown).toEqual([]);
    expect(record(fixture).next).toHaveLength(1);
  });
});

describe('across reloads', () => {
  it('counts attempt 1, then attempt 2 on a reload, then stops at review with step-retry-limit, writing nothing',
    async () => {
      const worker = createFakeWorker();
      const first = await load(worker);
      expect(await first.runtime.fill()).toBe('waiting');
      const signature = lastState(worker).stepSignature!;
      expect(lastState(worker).stepAttempts).toEqual({ [signature]: 1 });

      // A reload: a new document on the same worker. The run resumes by itself, on the same step, as attempt 2.
      first.runtime.stop();
      removeFixtures(document);
      const second = await load(worker);
      expect(worker.of('runstate/get')).toHaveLength(2);
      await vi.waitFor(() => expect(lastState(worker).stepAttempts[signature]).toBe(2), { timeout: 15_000 });
      await vi.waitFor(() => expect(lastReport(worker).status).toBe('wait-transition'), { timeout: 15_000 });
      expect(worker.of('run/begin').at(-1)).toMatchObject({ trigger: 'resume' });
      expect(lastState(worker)).toMatchObject({ stepSignature: signature, stepIndex: 0 });
      expect(byId(second.fixture, 'name').value).toBe(goldenProfile().identity.fullName);
      expect(second.events.on('name').filter((event) => event.type === 'change')).toHaveLength(1);

      // The next reload: the step had its two attempts. Review, the notice, and nothing written.
      second.runtime.stop();
      removeFixtures(document);
      const third = await load(worker);
      await vi.waitFor(() => expect(lastState(worker).status).toBe('review'), { timeout: 15_000 });
      await vi.waitFor(() => expect(lastReport(worker).status).toBe('review'), { timeout: 15_000 });
      expect(lastState(worker).stepAttempts).toEqual({ [signature]: 2 });
      expect(codes(lastReport(worker))).toContain('step-retry-limit');
      expect(lastReport(worker).fields).toEqual([]);
      // Nothing of ours: the browser's own events (the test runner's pointer resting over the new page) are no write.
      expect(third.events.events.filter((event) => !event.trusted && !['scroll'].includes(event.type))).toEqual([]);
      expect(['name', 'email', 'phone'].map((id) => byId(third.fixture, id).value)).toEqual(['', '', '']);
      expect(third.runtime.ui!.launcher.view).toMatchObject({ state: 'review' });
      expectInvariants(worker, third);
    });

  it('offers Continue on a reload at review instead of filling again, and fills on the person\'s Continue', async () => {
    const worker = createFakeWorker();
    const first = await load(worker);
    expect(await first.runtime.fill()).toBe('waiting');
    // The run moves on to the end, then the page is loaded again at review.
    pageNext(first.fixture);
    await vi.waitFor(() => expect(lastState(worker).stepIndex).toBe(1), { timeout: 15_000 });
    await vi.waitFor(() => expect(lastState(worker).status).toBe('wait-transition'), { timeout: 15_000 });
    const atReview = { ...lastState(worker), status: 'review' as const };
    first.runtime.stop();
    removeFixtures(document);
    await worker.platform.runtime.send({ v: 1, type: 'runstate/put', runState: atReview });
    const second = await load(worker);
    await vi.waitFor(() => expect(second.runtime.run?.ended).toBe('paused'));
    expect(second.runtime.ui!.launcher.view).toMatchObject({ state: 'needs-you', action: 'continue' });
    expect(second.events.events.filter((event) => event.type === 'change')).toEqual([]);
    expect(lastReport(worker).status).toBe('review');
    // The person's Continue (run/continue from the toolbar): the step is scanned and filled again.
    await worker.platform.deliver({ v: 1, type: 'run/continue' });
    await vi.waitFor(() => expect(lastState(worker).status).toBe('wait-transition'), { timeout: 15_000 });
    expect(byId(second.fixture, 'email').value).toBe(goldenProfile().contact.email);
  });
});

describe('pauses: nothing automated, the person continues', () => {
  /** The wizard with `markup` on its first step. */
  const withOnStepOne = (markup: string) => html.replace('<button type="button" id="next-details"', `${markup}
        <button type="button" id="next-details"`);

  it('pauses on a CAPTCHA, writing nothing, and Continue scans the step again', async () => {
    const page = withOnStepOne('<div class="g-recaptcha" id="captcha" data-sitekey="6Lc_test" style="width:304px;height:78px"></div>');
    const worker = createFakeWorker();
    const loaded = await load(worker, page);
    expect(await loaded.runtime.fill()).toBe('paused');
    expect(lastState(worker)).toMatchObject({ status: 'handoff', pauseReason: 'captcha', resumeStatus: 'scan-step' });
    expect(lastReport(worker)).toMatchObject({ status: 'handoff', pauseReason: 'captcha', fields: [] });
    expect(codes(lastReport(worker))).toContain('captcha');
    expect(worker.of('plan/request')).toEqual([]);
    expect(loaded.events.events.filter((event) => event.type === 'input')).toEqual([]);
    // The person solved it, the widget staying where it is (as a vendor's does): Continue (a new run from this one's
    // state) fills the step, and the widget it handed over does not pause it again (the Phase 5 review, X-S4).
    await worker.platform.deliver({ v: 1, type: 'run/continue' });
    await vi.waitFor(() => expect(lastState(worker).status).toBe('wait-transition'), { timeout: 15_000 });
    expect(loaded.fixture.doc.getElementById('captcha')!.isConnected).toBe(true);
    expect(worker.of('run/begin')).toHaveLength(2);
    expect(Object.values(lastState(worker).stepAttempts)).toEqual([1]);
    expect(byId(loaded.fixture, 'name').value).toBe(goldenProfile().identity.fullName);
  });

  it('is auth-needed on a sign-in step, and never fills it', async () => {
    const page = withOnStepOne('<label for="pw">Password</label><input id="pw" type="password">');
    const worker = createFakeWorker();
    const loaded = await load(worker, page);
    expect(await loaded.runtime.fill()).toBe('paused');
    expect(lastState(worker)).toMatchObject({ status: 'auth-needed', pauseReason: null });
    expect(codes(lastReport(worker))).toContain('auth');
    expect(byId(loaded.fixture, 'name').value).toBe('');
  });
});

describe('validation', () => {
  it('surfaces an error the plan cannot fix at review, never pauses on it, and presses nothing', async () => {
    // The page marks the required shift question invalid as soon as step 3 shows.
    const page = html.replace('<select id="shift" name="shift" required>', '<select id="shift" name="shift" required aria-invalid="true">');
    const worker = createFakeWorker({ settings: { ...CAUTIOUS_SETTINGS, modes: { ...CAUTIOUS_SETTINGS.modes, next: 'auto' as const } } });
    const loaded = await load(worker, page);
    expect(await loaded.runtime.fill()).toBe('review');
    expect(lastState(worker).status).toBe('review');
    expect(Object.values(lastState(worker).stepAttempts)).toEqual([1, 1, 1]);
    expect(lastReport(worker).notices).toContainEqual({ code: 'validation', count: 1 });
    expect(record(loaded.fixture).next).toEqual([{ step: 1, trusted: false }, { step: 2, trusted: false }]);
  });

  it('fixes an error on a field the page emptied in one more pass (attempt 2), then waits for the person', async () => {
    // The page's first Next empties the phone and marks it invalid instead of moving on; typing clears the mark.
    const page = html.replace("button.addEventListener('click', (event) => {\n          wizard.next.push(",
      `button.addEventListener('click', (event) => {
          if (wizard.next.length === 0 && wizard.step === 1) { const phone = byId('phone'); phone.value = '';
            phone.setAttribute('aria-invalid', 'true'); wizard.next.push({ step: 0, trusted: event.isTrusted }); return; }
          wizard.next.push(`).replace("wireCurrent(byId('experience-0'));", `byId('phone').addEventListener('input', () => byId('phone').removeAttribute('aria-invalid'));
      wireCurrent(byId('experience-0'));`);
    expect(page).not.toBe(html);
    const worker = createFakeWorker();
    const loaded = await load(worker, page);
    expect(await loaded.runtime.fill()).toBe('waiting');
    const signature = lastState(worker).stepSignature!;
    // The person's Next: the step stays, with an error on a field we wrote and the page emptied.
    await personClick(loaded.fixture, byId(loaded.fixture, 'next-details'));
    await vi.waitFor(() => expect(lastState(worker).stepAttempts[signature]).toBe(2), { timeout: 15_000 });
    await vi.waitFor(() => expect(lastState(worker).status).toBe('wait-transition'), { timeout: 15_000 });
    expect(byId(loaded.fixture, 'phone').getAttribute('aria-invalid')).toBeNull();
    expect(byId(loaded.fixture, 'phone').value.replace(/\D/g, '')).toContain('5125550147');
    expect(record(loaded.fixture).step).toBe(1);
    expectInvariants(worker, loaded, ['next-details', 'application', 'document']);
  });
});

describe('a prefilled position', () => {
  it('fills the block the site prefilled from the entry it holds, and adds no block for it twice', async () => {
    // A resume parse put the earlier job in the only block shown.
    const page = html.replace('<input id="company-0" name="experience[0][company]" required>',
      `<input id="company-0" name="experience[0][company]" required value="${EARLIER_JOB.company}">`)
      .replace('<input id="start-0" name="experience[0][start]" type="month" required data-start>',
        '<input id="start-0" name="experience[0][start]" type="month" required data-start value="2019-07">');
    const worker = createFakeWorker();
    const loaded = await load(worker, page);
    const { fixture } = loaded;
    expect(await loaded.runtime.fill()).toBe('waiting');
    pageNext(fixture);
    await vi.waitFor(() => expect(lastState(worker).stepIndex).toBe(1), { timeout: 15_000 });
    await vi.waitFor(() => expect(lastState(worker).status).toBe('wait-transition'), { timeout: 15_000 });
    expect(record(fixture).added).toEqual({ experience: 1, education: 0 });
    // Block 0 keeps the earlier job, now complete; the current job goes into the block that was added.
    expect([byId(fixture, 'company-0').value, byId(fixture, 'title-0').value, byId(fixture, 'end-0').value,
      byId(fixture, 'current-0').checked]).toEqual([EARLIER_JOB.company, EARLIER_JOB.title, '2021-05', false]);
    expect([byId(fixture, 'company-1').value, byId(fixture, 'title-1').value, byId(fixture, 'current-1').checked,
      byId(fixture, 'end-1').disabled]).toEqual([CURRENT_JOB.company, CURRENT_JOB.title, true, true]);
    const report = lastReport(worker);
    expect(rowIn(report, 'experience[0]', 'Company')).toMatchObject({ status: 'skipped', reason: 'already-correct',
      wrote: false });
    expect(rowIn(report, 'experience[1]', 'End date')).toMatchObject({ status: 'skipped', reason: 'end-date-not-applicable' });
    expect(loaded.events.on('company-0').filter((event) => event.type === 'input')).toEqual([]);
  });
});

describe('cancel mid-step', () => {
  it('writes nothing more once the person cancels during a step\'s plan, and the run ends stopped', async () => {
    const worker = createFakeWorker({ onMessage: (message) => {
      // The second step's first full plan (after its count plan): the person cancels.
      if (message.type === 'plan/request' && ((message as { planKeys?: unknown[] }).planKeys ?? []).length > 0
        && worker.of('plan/request').filter((sent) => (sent.planKeys as unknown[]).length > 0).length === 2) {
        void worker.platform.deliver({ v: 1, type: 'run/cancel' });
      }
    } } satisfies FakeWorkerOptions);
    const loaded = await load(worker);
    expect(await loaded.runtime.fill()).toBe('waiting');
    pageNext(loaded.fixture);
    await vi.waitFor(() => expect(lastState(worker).status).toBe('stopped'), { timeout: 15_000 });
    expect(lastReport(worker).status).toBe('stopped');
    expect(lastReport(worker).fields.filter((row) => row.reason === 'user-stopped').length).toBeGreaterThan(0);
    expect(loaded.events.on('company-0')).toEqual([]);
    expect(loaded.runtime.ui!.launcher.view).toMatchObject({ state: 'idle', action: 'fill' });
  });
});

describe('prefill before our first write on a step (reconcilePrefill)', () => {
  /** A plain form whose boxes the site filled in (a resume parse), on the generic adapter. */
  const page = `<!doctype html><body style="margin:0;font:16px sans-serif"><main><h1>Engineer</h1><p>A visible description.</p>
    <form action="/__submitted"><label for="summary">Job summary</label><input id="summary" value="Built the billing service">
    <label for="start">Start date</label><input id="start" value="06/2021">
    <label for="city">City</label><input id="city" value="Dallas"><button type="submit">Submit application</button>
    </form></main></body>`;
  /** The plan, with a job description written into the summary and a start date into the date box (as an adapter's
   *  section would plan them). */
  const describing = (plan: PlanOutput, specs: readonly FieldSpec[]): PlanOutput => {
    const spec = (label: string) => specs.find((candidate) => candidate.label === label)!;
    const write = (label: string, value: PlannedWrite['value'], path: string): PlannedWrite => ({ key: spec(label).key, value,
      origin: { provenance: 'profile', path: path as ProfilePath }, match: { stage: 'not-applicable', optionIndex: null,
        rule: null, confidence: 1, flags: [], suggestions: [], reason: 'ok' } });
    const rowOf = (label: string, category: FillResult['category']) => (row: FillResult): FillResult => (row.key === spec(label).key
      ? { ...row, category, status: 'verified', provenance: 'profile', reason: 'ok', wrote: false, verification: 'not-checked',
        needsUserAction: false } : row);
    if (!specs.some((candidate) => candidate.label === 'Job summary')) return plan;
    return { ...plan, results: plan.results.map(rowOf('Job summary', 'experience.description'))
      .map(rowOf('Start date', 'experience.startDate')),
    writes: [...plan.writes.filter((planned) => planned.key !== spec('Job summary').key && planned.key !== spec('Start date').key),
      write('Job summary', { kind: 'text', text: 'Leads the platform team' }, 'experience[0].description'),
      write('Start date', { kind: 'date', iso: '2021-06' }, 'experience[0].startDate')] };
  };

  it('keeps prose and the same date written another way, and replaces a structured answer, flagged', async () => {
    const worker = createFakeWorker({ editPlan: describing });
    const fixture = await loadFixture(document, page);
    const events = logEvents(fixture.doc);
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => 'https://jobs.lever.co/tailorit-fixture/prefill/apply',
      isTop: true, settle: { quietMs: 60 } });
    runtimes.push(runtime);
    expect(await runtime.fill()).toBe('review');
    const report = lastReport(worker);
    const row = (label: string) => report.fields.find((candidate) => candidate.label === label)!;
    expect(row('Job summary')).toMatchObject({ status: 'flagged', reason: 'prefill-kept', wrote: false, provenance: null });
    expect(row('Start date')).toMatchObject({ status: 'skipped', reason: 'already-correct', wrote: false });
    expect(row('City')).toMatchObject({ status: 'flagged', reason: 'prefill-conflict', wrote: true });
    expect([byId(fixture, 'summary').value, byId(fixture, 'start').value]).toEqual(['Built the billing service', '06/2021']);
    expect([...events.on('summary'), ...events.on('start')]).toEqual([]);
    expect(byId(fixture, 'city').value).toBe(goldenProfile().address!.city);
  });
});

describe('the confirmation page', () => {
  const POSTING = 'https://jobs.lever.co/tailorit-fixture/0b9f2d3e-1c4a-4e8b-9a7d-5f6e3c2b1a00';

  it('marks the application\'s RunState done once the worker takes it after a Submit this tab armed, and starts no run', async () => {
    const worker = createFakeWorker();
    const applicationKey = applicationOf(new URL(`${POSTING}/apply`))!.applicationKey;
    expect(applicationOf(new URL(`${POSTING}/thanks`))).toMatchObject({ page: 'confirmation', applicationKey });
    const atReview = { ...createRunState({ applicationKey, platform: 'lever', now: 0 }), status: 'review' as const };
    await worker.platform.runtime.send({ v: 1, type: 'runstate/put', runState: atReview });
    // The Submit pressed on the form's page before it (v3 Phase 4).
    await worker.platform.runtime.send({ v: 1, type: 'submit/armed', applicationKey, by: 'page' });
    const fixture = await loadFixture(document, '<!doctype html><body><h1>Thank you for applying.</h1></body>');
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => `${POSTING}/thanks`, isTop: true });
    runtimes.push(runtime);
    expect(worker.of('submit/detected')).toEqual([expect.objectContaining({ applicationKey, evidence: 'confirmation-page' })]);
    expect(lastState(worker)).toMatchObject({ applicationKey, status: 'done' });
    expect(runtime.run).toBeNull();
    expect(worker.of('run/begin')).toEqual([]);
  });

  it('marks nothing where no Submit of this tab came before: page text alone never says it was sent', async () => {
    const worker = createFakeWorker();
    const applicationKey = applicationOf(new URL(`${POSTING}/apply`))!.applicationKey;
    const atReview = { ...createRunState({ applicationKey, platform: 'lever', now: 0 }), status: 'review' as const };
    await worker.platform.runtime.send({ v: 1, type: 'runstate/put', runState: atReview });
    const fixture = await loadFixture(document, '<!doctype html><body><h1>Thank you for applying.</h1></body>');
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => `${POSTING}/thanks`, isTop: true });
    runtimes.push(runtime);
    expect(worker.of('submit/detected')).toHaveLength(1);
    expect(lastState(worker)).toMatchObject({ applicationKey, status: 'review' });
  });
});
