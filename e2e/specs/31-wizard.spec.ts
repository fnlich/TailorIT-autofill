/*
 * The multi-step machine end to end on the 4-step wizard (Phase 5; docs/SPEC.md Requirement C; docs/ARCHITECTURE.md
 * "Orchestrator" › the multi-step machine, auto-advance and repeatable sections, and "Testing" › "Synthetic fixtures";
 * docs/design/core.md §10.2; docs/design/runtime.md §8.4 to §8.6 and §8.9). fixtures/synthetic/wizard-4-step/index.html
 * says what the page does, and the e2e-only test adapter (src/adapters/test/wizard.ts) gives the step machine its
 * steps. Written in Phase 5's first wave, run from its second, once the content runtime drives the machine. Each case
 * is an application of its own (its own address, so its own RunState), filled from the side panel with the golden
 * profile, and ends with assertTrapInvariants:
 * - auto-advance off (the default): the run fills each step and waits for the person's own Next (Playwright's trusted
 *   click stands for theirs), pressing nothing itself:
 *   - step 1: name, email and phone verified;
 *   - step 2: "Add another position" clicked once (two positions in the profile, one block shown), never twice; the
 *     current job in the first block, its "I currently work here" ticked and its End date, which the page then
 *     disables, never touched and skipped, not flagged; the earlier job in the second block, its box left alone;
 *   - step 3: "Add education", a typeless button inside the form that ignores untrusted clicks, never clicked and
 *     flagged needs-your-click; the required shift question, which the profile cannot answer, asked of TailorIT's AI
 *     (docs/SPEC-AMENDMENTS.md §1), and with the mock's default no answer, blank and flagged;
 *   - step 4, Review: the final step, at review, and Submit has no event at all;
 *   - after each step RunState holds no value, the step is a new signature, attempted once, and stepIndex one more;
 * - auto-advance on: Next pressed on the two clean steps (1 and 2), each after the step's writes; step 3, which holds
 *   flagged fields, waits for the person; the Review step is never advanced and Submit never pressed;
 * - across reloads: the first visit is attempt 1 and a reload attempt 2 (the run resumes by itself in its own tab and
 *   writes the step again); the next reload stops with step-retry-limit and writes nothing;
 * - the worker stopped between steps: the person's Next reaches a stopped worker; the content script's own messages
 *   wake a new one, which reads the profile again, and step 2 is filled as before.
 *
 * What this holds the runtime to (wave 2 builds it; a change here is the lead's to agree):
 * - RunState (storage.local, read without the worker): status 'wait-transition' while the run waits for a Next, and
 *   'review' on the final step and after step-retry-limit; stepSignature the current step's; stepAttempts by
 *   signature; stepIndex one more per new step; repeatableCounters keyed `${signature}:${kind}`;
 * - the report mirrors RunState's status, and its rows carry the block in their section ('experience[1]');
 * - a refused Add is no row (an Add button is no field: FIELD_KINDS has no kind for it), but the needs-click notice,
 *   and it counts among the step's flagged items in RunState.lastFill, so auto-advance never presses past it (wave 2's
 *   revision); the third visit's report carries the step-retry-limit notice;
 * - RunState.filledFieldKeys hold stored keys (section and label slug hashed), never a raw key: nothing here reads
 *   them but their step signatures.
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures.ts';
import { DEFAULT_SETTINGS } from '../../src/core/types/settings';
import type { FrameReport } from '../../src/shared/report';
import { applicationKeyOf, noticeCount, row, rowOf, type Extension } from '../helpers/extension.ts';
import { GOLDEN, GOLDEN_PROFILE } from '../helpers/golden.ts';
import { assertTrapInvariants } from '../helpers/invariants.ts';
import { mock } from '../helpers/mock.ts';
import { eventsOn, writeEvents } from '../helpers/page-state.ts';
import { writesOn } from '../helpers/reactive.ts';
import type { SpyEvent } from '../helpers/spies.ts';
import { closeSidePanelViews, stopWorker, workerStatus } from '../helpers/stop-worker.ts';
import {
  ADD, ADD_EDUCATION_LABEL, BACK, expectValueFree, extensionClicks, NEXT, nextStepAt, rowIn, runAt, submitEvents,
  WIZARD, WIZARD_LABELS, wizardRecord, type RunAt,
} from '../helpers/wizard.ts';

const SHIFT = 'Which shift pattern would you prefer?';
/** Step 1's fields and the categories their rows carry. */
const DETAILS = [['Full name', 'identity.fullName'], ['Email', 'contact.email'], ['Phone', 'contact.phone']] as const;
type Job = (typeof GOLDEN_PROFILE.experience)[number];
/** The golden profile's two positions, most recent first: the current job, then the earlier one. */
const [CURRENT_JOB, EARLIER_JOB] = GOLDEN_PROFILE.experience as [Job, Job];
const PROFILE_ROUTE = 'GET /api/autofill/profile';

test.describe.configure({ timeout: 120_000 });

/** Step 1's rows: verified from the profile. */
function expectDetailsFilled(report: FrameReport): void {
  for (const [label, category] of DETAILS) {
    expect(row(report, label), label).toMatchObject({ category, status: 'verified', provenance: 'profile', wrote: true });
  }
}

/** Step 1's values on the page. */
async function expectDetailsOnPage(page: Page): Promise<void> {
  await expect(page.locator('#name')).toHaveValue(GOLDEN.full);
  await expect(page.locator('#email')).toHaveValue(GOLDEN.email);
  expect((await page.locator('#phone').inputValue()).replace(/\D/g, '')).toContain(GOLDEN.phoneDigits.slice(-10));
}

/** Step 2: one Add, the current job in the first block, the earlier one in the second. */
async function expectExperienceFilled(page: Page, report: FrameReport): Promise<void> {
  expect((await wizardRecord(page)).added).toEqual({ experience: 1, education: 0 });
  expect(await extensionClicks(page, ADD.experience)).toHaveLength(1);
  await expect(page.locator('#experience-blocks > .block')).toHaveCount(2);

  // The current job: its box ticked, so its End date is disabled and never touched; skipped, not flagged.
  for (const label of ['Company', 'Job title', 'Start date', 'I currently work here']) {
    expect(rowIn(report, 'experience[0]', label), label).toMatchObject({ status: 'verified', wrote: true });
  }
  await expect(page.locator('#company-0')).toHaveValue(CURRENT_JOB.company);
  await expect(page.locator('#title-0')).toHaveValue(CURRENT_JOB.title);
  await expect(page.locator('#start-0')).toHaveValue(CURRENT_JOB.startDate ?? '');
  await expect(page.locator('#current-0')).toBeChecked();
  expect(await extensionClicks(page, '#current-0')).toHaveLength(1);
  await expect(page.locator('#end-0')).toBeDisabled();
  await expect(page.locator('#end-0')).toHaveValue('');
  expect(await eventsOn(page, '#end-0'), 'an event on the current job\'s End date').toEqual([]);
  const end = rowIn(report, 'experience[0]', 'End date');
  expect(end).toMatchObject({ status: 'skipped', wrote: false, provenance: null });
  expect(['end-date-not-applicable', 'disabled-or-readonly']).toContain(end.reason);

  // The earlier job: every date written, its box left as it was.
  for (const label of ['Company', 'Job title', 'Start date', 'End date']) {
    expect(rowIn(report, 'experience[1]', label), label).toMatchObject({ status: 'verified', provenance: 'profile', wrote: true });
  }
  await expect(page.locator('#company-1')).toHaveValue(EARLIER_JOB.company);
  await expect(page.locator('#title-1')).toHaveValue(EARLIER_JOB.title);
  await expect(page.locator('#start-1')).toHaveValue(EARLIER_JOB.startDate ?? '');
  await expect(page.locator('#end-1')).toHaveValue(EARLIER_JOB.endDate ?? '');
  await expect(page.locator('#current-1')).not.toBeChecked();
  expect(await eventsOn(page, '#current-1'), 'an event on the earlier job\'s box').toEqual([]);
  expect(rowIn(report, 'experience[1]', 'I currently work here')).toMatchObject({ wrote: false });
}

/** Step 3: the Add the extension may not click, and the question the profile cannot answer. */
async function expectEducationFlagged(page: Page, report: FrameReport): Promise<void> {
  // Refused before any click: no event of any kind on it, and the page saw no click to ignore.
  expect(await eventsOn(page, ADD.education)).toEqual([]);
  expect(await wizardRecord(page)).toMatchObject({ added: { education: 0 }, ignored: { education: 0 } });
  await expect(page.locator('#education-blocks > *')).toHaveCount(0);
  // An Add button is no field (FillResult.kind is one of FIELD_KINDS, which has none for a button), so it gets no
  // row: the needs-click notice carries it (wave 2's decision), counted with the step's flagged fields in lastFill.
  expect(report.fields.filter((candidate) => candidate.reason === 'needs-your-click')).toEqual([]);
  expect(report.fields.map((candidate) => candidate.label)).not.toContain(ADD_EDUCATION_LABEL);
  // v4 (D7, D9): the Add the run could not press is simply not pressed; no needs-click notice.
  expect(noticeCount(report, 'needs-click')).toBe(0);

  // The owner's amendments (docs/SPEC-AMENDMENTS.md §1): the question the profile cannot answer is TailorIT's AI's,
  // and the mock's answer task has no answer for it by default, so it stays blank and flagged.
  const asked = (await mock.requestsTo('POST /api/autofill/ai/answer'))
    .flatMap((request) => (JSON.parse(request.body) as { items: Array<{ question: string }> }).items);
  expect(asked.map((item) => item.question)).toContain(SHIFT);
  expect(row(report, SHIFT)).toMatchObject({ category: 'unknown', status: 'flagged', reason: 'llm-no-answer', required: true,
    wrote: false, provenance: null });
  await expect(page.locator('#shift')).toHaveValue('');
}

/** The pointer's own comings and goings: after the person's (Playwright's) trusted click on Next, the next step is laid
 *  out under the resting cursor, and the browser tells whatever is now under it (a Back button where Next was) with
 *  trusted hover events. They press nothing, and the extension cannot make a trusted event. */
const CURSOR_HOVER = new Set(['pointerover', 'pointerenter', 'pointerout', 'pointerleave', 'pointermove', 'mouseover',
  'mouseenter', 'mouseout', 'mouseleave', 'mousemove']);
const notTheCursor = (events: readonly SpyEvent[]) =>
  events.filter((event) => !(event.trusted && CURSOR_HOVER.has(event.type)));

/** The extension pressed none of the wizard's Back buttons and nothing on Submit: no untrusted event of any kind on
 *  them, and no trusted one but the resting cursor's hover. */
async function expectNoBackNoSubmit(page: Page): Promise<void> {
  for (const back of BACK) expect(notTheCursor(await eventsOn(page, back)), back).toEqual([]);
  expect(notTheCursor(await submitEvents(page)), 'an event on Submit').toEqual([]);
}

/** Each step a new signature, attempted once, and the step index one more than the last. */
function expectStepCounted(runState: RunAt['runState'], index: number, steps: number): void {
  expect(runState.stepIndex).toBe(index);
  expect(Object.keys(runState.stepAttempts)).toHaveLength(steps);
  expect(runState.stepAttempts[runState.stepSignature!]).toBe(1);
}

async function withAutoAdvance<T>(ext: Extension, body: () => Promise<T>): Promise<T> {
  await ext.data({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
    modes: { ...DEFAULT_SETTINGS.modes, next: 'auto' } } });
  try {
    return await body();
  } finally {
    await ext.data({ v: 1, type: 'settings/save', settings: DEFAULT_SETTINGS });
  }
}

test.describe('the 4-step wizard', () => {
  test('auto-advance off: each step filled, then the person\'s own Next; nothing pressed, nothing submitted', async ({ extContext, connected: ext, routeLog, logs }) => {
    const url = WIZARD.url('off');
    routeLog.serve({ [url]: WIZARD.file });
    const key = applicationKeyOf(url)!;
    const page = await extContext.newPage();
    await page.goto(url);
    const tabId = await ext.fill(page);
    const seen = new Set<string>();

    // Step 1: filled, then the run waits for the person.
    let at = await nextStepAt(ext, tabId, key, seen, { statuses: ['wait-transition'],
      report: (report) => rowOf(report, 'Full name') !== undefined });
    const first = at.runState.stepIndex;
    expectStepCounted(at.runState, first, 1);
    expectDetailsFilled(at.report!);
    await expectDetailsOnPage(page);
    expect((await wizardRecord(page)).step).toBe(1);
    expect(await extensionClicks(page, NEXT.details), 'the run pressed Next with auto-advance off').toEqual([]);
    await expectValueFree(at.runState, page);

    // Step 2.
    await page.locator(NEXT.details).click();
    at = await nextStepAt(ext, tabId, key, seen, { statuses: ['wait-transition'],
      report: (report) => report.fields.some((candidate) => candidate.section === 'experience[1]') });
    expectStepCounted(at.runState, first + 1, 2);
    expect((await wizardRecord(page)).step).toBe(2);
    await expectExperienceFilled(page, at.report!);
    expect(Object.entries(at.runState.repeatableCounters)).toContainEqual([`${at.runState.stepSignature}:experience`,
      expect.objectContaining({ profile: 2, addClicks: 1 })]);
    expect(await extensionClicks(page, NEXT.experience)).toEqual([]);
    await expectValueFree(at.runState, page);

    // Step 3.
    await page.locator(NEXT.experience).click();
    at = await nextStepAt(ext, tabId, key, seen, { statuses: ['wait-transition'],
      report: (report) => rowOf(report, SHIFT) !== undefined });
    expectStepCounted(at.runState, first + 2, 3);
    expect((await wizardRecord(page)).step).toBe(3);
    await expectEducationFlagged(page, at.report!);
    expect(Object.entries(at.runState.repeatableCounters)).toContainEqual([`${at.runState.stepSignature}:education`,
      expect.objectContaining({ profile: 1, rendered: 0 })]);
    // v4 (D3): the required shift question left empty holds Next; the education entry not added holds nothing.
    expect(at.runState.lastFill?.flagged).toBe(1);
    expect(await extensionClicks(page, NEXT.education)).toEqual([]);
    await expectValueFree(at.runState, page);

    // Step 4, Review: the final step. The run stops at review; nothing is pressed, and Submit has no event at all.
    await page.locator(NEXT.education).click();
    at = await nextStepAt(ext, tabId, key, seen, { statuses: ['review'] });
    expectStepCounted(at.runState, first + 3, 4);
    expect(at.report!.status).toBe('review');
    const record = await wizardRecord(page);
    expect(record.step).toBe(4);
    expect(record.next).toEqual([{ step: 1, trusted: true }, { step: 2, trusted: true }, { step: 3, trusted: true }]);
    expect(record.shown).toEqual([1, 2, 3, 4]);
    for (const next of Object.values(NEXT)) expect(await extensionClicks(page, next), next).toEqual([]);
    await expectNoBackNoSubmit(page);
    await expectValueFree(at.runState, page);

    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: WIZARD_LABELS,
      applicationKey: key, personClicked: Object.values(NEXT) });
  });

  test('auto-advance on: Next pressed on the clean steps only, never on the Review step, never Submit', async ({ extContext, connected: ext, routeLog, logs }) => {
    const url = WIZARD.url('auto');
    routeLog.serve({ [url]: WIZARD.file });
    const key = applicationKeyOf(url)!;
    await withAutoAdvance(ext, async () => {
      const page = await extContext.newPage();
      await page.goto(url);
      const tabId = await ext.fill(page);

      // Steps 1 and 2 are clean, so the run presses their Next itself; step 3 holds flagged fields, so it waits.
      let at = await runAt(ext, tabId, key, { statuses: ['wait-transition'],
        until: (runState) => Object.keys(runState.stepAttempts).length === 3,
        report: (report) => rowOf(report, SHIFT) !== undefined });
      expect(Object.values(at.runState.stepAttempts)).toEqual([1, 1, 1]);
      const record = await wizardRecord(page);
      expect(record.step).toBe(3);
      expect(record.next).toEqual([{ step: 1, trusted: false }, { step: 2, trusted: false }]);
      expect((await extensionClicks(page, NEXT.details)).length).toBe(1);
      expect((await extensionClicks(page, NEXT.experience)).length).toBe(1);
      expect(await extensionClicks(page, NEXT.education)).toEqual([]);
      await expectEducationFlagged(page, at.report!);

      // Each Next came after its step's writes: the last write of step 1 (Phone), and of step 2 (the second End date).
      const events = await writeEvents(page);
      const matches = (control: string, type: string) => events.map((event) => event.control === control && event.type === type);
      const firstAt = (control: string, type: string) => matches(control, type).indexOf(true);
      const lastAt = (control: string, type: string) => matches(control, type).lastIndexOf(true);
      expect(lastAt('#phone', 'change')).toBeGreaterThan(-1);
      expect(firstAt(NEXT.details, 'click')).toBeGreaterThan(lastAt('#phone', 'change'));
      expect(lastAt('#end-1', 'change')).toBeGreaterThan(firstAt(NEXT.details, 'click'));
      expect(firstAt(NEXT.experience, 'click')).toBeGreaterThan(lastAt('#end-1', 'change'));
      await expectDetailsOnPage(page);
      await expect(page.locator('#company-1')).toHaveValue(EARLIER_JOB.company);
      await expectValueFree(at.runState, page);

      // The person's Next on step 3; the Review step is final, so the run stops there and presses nothing.
      await page.locator(NEXT.education).click();
      at = await runAt(ext, tabId, key, { statuses: ['review'],
        until: (runState) => Object.keys(runState.stepAttempts).length === 4 });
      expect(at.report!.status).toBe('review');
      expect(await wizardRecord(page)).toMatchObject({ step: 4, shown: [1, 2, 3, 4],
        next: [{ step: 1, trusted: false }, { step: 2, trusted: false }, { step: 3, trusted: true }] });
      expect(await extensionClicks(page, NEXT.education)).toEqual([]);
      await expectNoBackNoSubmit(page);
      await expectValueFree(at.runState, page);

      await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: WIZARD_LABELS,
        applicationKey: key, personClicked: [NEXT.education] });
    });
  });

  test('across reloads: attempt 1, then attempt 2, then step-retry-limit with nothing written', async ({ extContext, connected: ext, routeLog, logs }) => {
    const url = WIZARD.url('reload');
    routeLog.serve({ [url]: WIZARD.file });
    const key = applicationKeyOf(url)!;
    const page = await extContext.newPage();
    await page.goto(url);
    const tabId = await ext.fill(page);

    // The first visit: attempt 1.
    const first = await nextStepAt(ext, tabId, key, new Set(), { statuses: ['wait-transition'],
      report: (report) => rowOf(report, 'Full name')?.status === 'verified' });
    const signature = first.runState.stepSignature!;
    expect(first.runState.stepAttempts).toEqual({ [signature]: 1 });
    await expectDetailsOnPage(page);

    // A reload: the run resumes by itself in its own tab, on the same step, and writes it again (attempt 2).
    await page.reload();
    const second = await runAt(ext, tabId, key, { statuses: ['wait-transition'],
      until: (runState) => runState.stepAttempts[signature] === 2,
      report: (report) => rowOf(report, 'Full name')?.status === 'verified' });
    expect(second.runState.stepSignature).toBe(signature);
    expect(second.runState.stepIndex).toBe(first.runState.stepIndex);
    expectDetailsFilled(second.report!);
    await expectDetailsOnPage(page);
    expect(await writesOn(page, '#name')).toBe(1);
    await expectValueFree(second.runState, page);

    // The next reload: the step has had its two attempts, so the run goes to review and writes nothing.
    await page.reload();
    const third = await runAt(ext, tabId, key, { statuses: ['review'],
      until: (runState) => runState.stepSignature === signature,
      report: (report) => noticeCount(report, 'step-retry-limit') === 1 });
    expect(third.runState.stepAttempts).toEqual({ [signature]: 2 });
    expect(await writeEvents(page), 'the extension wrote on a step past its attempts').toEqual([]);
    for (const control of ['#name', '#email', '#phone']) await expect(page.locator(control), control).toHaveValue('');
    expect((await wizardRecord(page)).step).toBe(1);
    for (const next of Object.values(NEXT)) expect(await extensionClicks(page, next), next).toEqual([]);
    await expectNoBackNoSubmit(page);
    await expectValueFree(third.runState, page);

    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: WIZARD_LABELS,
      applicationKey: key });
  });

  test('the worker stopped between steps: the next step still fills, from a new worker', async ({ extContext, extensionId, connected: ext, routeLog, logs }) => {
    const url = WIZARD.url('restart');
    routeLog.serve({ [url]: WIZARD.file });
    const key = applicationKeyOf(url)!;
    const page = await extContext.newPage();
    await page.goto(url);
    const tabId = await ext.fill(page);
    const seen = new Set<string>();
    const first = await nextStepAt(ext, tabId, key, seen, { statuses: ['wait-transition'],
      report: (report) => rowOf(report, 'Full name')?.status === 'verified' });
    const profileReads = (await mock.requestsTo(PROFILE_ROUTE)).length;
    expect(profileReads).toBeGreaterThan(0);

    // The report page's panel port, and any side panel view, would start the worker again the moment it stops.
    await ext.closeReportPages();
    const api = await ext.page();
    await closeSidePanelViews(extContext, api, extensionId);
    await stopWorker(extContext, api, extensionId);
    expect(await workerStatus(extContext, api, extensionId), 'something started the worker again before the Next').toBe('stopped');

    // The person's Next: the content script's messages wake a new worker, which reads the profile again.
    await page.locator(NEXT.details).click();
    const stored = await nextStepAt(ext, tabId, key, seen, { statuses: ['wait-transition'], report: false });
    expect(stored.runState.stepIndex).toBe(first.runState.stepIndex + 1);
    expect((await mock.requestsTo(PROFILE_ROUTE)).length).toBeGreaterThan(profileReads);
    const at = await runAt(ext, tabId, key, { statuses: ['wait-transition'],
      until: (runState) => runState.stepSignature === stored.runState.stepSignature,
      report: (report) => report.fields.some((candidate) => candidate.section === 'experience[1]') });
    await expectExperienceFilled(page, at.report!);
    await expectValueFree(at.runState, page);
    await expectNoBackNoSubmit(page);

    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: WIZARD_LABELS,
      applicationKey: key, personClicked: [NEXT.details] });
  });
});
