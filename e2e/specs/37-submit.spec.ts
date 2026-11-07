/*
 * v3 Phase 4 end to end (docs/SPEC-AMENDMENTS.md §12 Decision 6), on synthetic pages for each platform
 * (fixtures/synthetic/submit) against the mock's version 3 routes:
 * - after a fill the side panel's dock offers "Submit application"; nothing is pressed until the person's own click
 *   there; then the page's own Submit is pressed once, its confirmation seen, and TailorIT told Applied (POST /applied):
 *   Greenhouse's confirmation drawn in place (and its /confirmation address), Ashby's success message (the card then
 *   shows Applied), Lever's /thanks page;
 * - the person's own click on the page's Submit counts the same way; a confirmation page no Submit came before records
 *   nothing;
 * - Submit mode Auto presses a clean final step by itself, and holds back where a required field is empty, saying why;
 * - "Continue to the next page" presses the wizard's Next for the person, never its Submit, and the next step is filled
 *   (Autofill after page turn: Automatically) or offered to Continue (Manually);
 * - required fields still empty: the dock asks first;
 * - the review: Greenhouse's confirmation as a page of its own (a new document), the resume a fill attached and the job
 *   chosen for the page named to the tracker, and a confirmation page with no Submit before it waited for to the end of
 *   its document's start-up (never a fixed sleep).
 */
import type { Page } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../../src/core/types/settings';
import { COPY } from '../../src/shared/copy';
import { expect, test } from '../fixtures.ts';
import type { Extension } from '../helpers/extension.ts';
import { GOLDEN_RESUME, mock } from '../helpers/mock.ts';
import type { RouteLog } from '../routes.ts';
import { NEXT, submitEvents, WIZARD, wizardRecord } from '../helpers/wizard.ts';

const APPLIED = 'POST /api/autofill/applied';
const GREENHOUSE = 'fixtures/synthetic/submit/greenhouse.html';
const ASHBY = 'fixtures/synthetic/submit/ashby.html';
const LEVER = 'fixtures/synthetic/submit/lever.html';
const LEVER_THANKS = 'fixtures/synthetic/submit/lever-thanks.html';
const GREENHOUSE_PAGE = 'fixtures/synthetic/submit/greenhouse-page.html';
const GREENHOUSE_CONFIRMATION = 'fixtures/synthetic/submit/greenhouse-confirmation.html';
const greenhouseAt = (id: string) => `https://job-boards.greenhouse.io/tailoritfixture/jobs/37${id}`;
const leverAt = (id: string) => `https://jobs.lever.co/tailorit-fixture/00000000-0000-4000-8000-0000000037${id}`;
const ashbyAt = (id: string) => `https://jobs.ashbyhq.com/tailorit-fixture/00000000-0000-4000-8000-0000000037${id}/application`;

const bodies = async (route: string) => (await mock.requestsTo(route)).map((request) => JSON.parse(request.body) as Record<string, unknown>);
const submittedOn = (page: Page) => page.evaluate(() => Number(document.body.dataset.submitted ?? '0'));
/** Waits for a tab's top document to finish its start-up (the e2e build's content-settled event): its confirmation
 *  page's sign, if any, has been told and answered by then. */
async function settledIn(ext: Extension, tabId: number): Promise<void> {
  await expect.poll(async () => (((await ext.session())['e2e:events'] as Array<{ type: string; tabId?: number }> | undefined)
    ?? []).some((event) => event.type === 'content-settled' && event.tabId === tabId)).toBe(true);
}

/** The page, filled from the side panel (the report page), resting at review. */
async function filled(ext: Extension, page: Page, routeLog: RouteLog, url: string, file: string) {
  routeLog.serve({ [url]: file });
  await page.goto(url);
  const tabId = await ext.fill(page);
  const report = await ext.settled(tabId);
  const panel = await ext.reportPage(tabId);
  return { tabId, report, panel };
}

test.afterEach(async ({ ext }) => {
  await ext.data({ v: 1, type: 'settings/save', settings: DEFAULT_SETTINGS });
});

test.describe('Submit, pressed for the person (v3 Phase 4)', () => {
  test('Greenhouse: the dock offers Submit; nothing is pressed until the person’s click; then Applied is recorded', async ({ extContext, connected: ext, routeLog }) => {
    const page = await extContext.newPage();
    const url = greenhouseAt('01');
    const { report, panel } = await filled(ext, page, routeLog, url, GREENHOUSE);
    expect(report.status).toBe('review');
    expect(report.buttons).toEqual({ final: 'final', next: false, submit: true });
    const submit = panel.locator('button[data-step-action="submit"]');
    await expect(submit).toHaveText(COPY.panel.step.submit);
    // Nothing was pressed by the fill.
    expect(await submittedOn(page)).toBe(0);
    expect(await mock.requestsTo(APPLIED)).toEqual([]);
    await submit.click();
    await expect.poll(() => submittedOn(page)).toBe(1);
    await expect(panel.locator('[data-submitted="recorded"]')).toContainText(COPY.panel.submitted.title);
    await expect(panel.locator('[data-submitted] a[data-tailorit-link="tracker"]')).toHaveText(COPY.panel.submitted.openTracker);
    // The job the run looked up, by its id (the mock's golden job), and the resume it attached.
    const recorded = await bodies(APPLIED);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ jobId: expect.any(Number) });
    expect(await submittedOn(page)).toBe(1);
    expect(routeLog.submitted).toEqual([]);
  });

  test('Ashby: its success message after the panel’s Submit; the card then shows Applied', async ({ extContext, connected: ext, routeLog }) => {
    const page = await extContext.newPage();
    const { panel } = await filled(ext, page, routeLog, ashbyAt('a1'), ASHBY);
    await panel.locator('button[data-step-action="submit"]').click();
    await expect.poll(() => submittedOn(page)).toBe(1);
    await expect(panel.locator('[data-submitted="recorded"]')).toBeVisible();
    await expect(panel.locator('[data-job-card] [data-job-applied]')).toHaveText(COPY.job.applied);
    expect(await bodies(APPLIED)).toHaveLength(1);
  });

  test('Lever: the /thanks page after the panel’s Submit is the sign; a /thanks page with no Submit before it records nothing', async ({ extContext, connected: ext, routeLog }) => {
    const page = await extContext.newPage();
    const url = `${leverAt('b1')}/apply`;
    routeLog.serve({ [`${leverAt('b1')}/thanks`]: LEVER_THANKS, [`${leverAt('b2')}/thanks`]: LEVER_THANKS });
    const { tabId, panel } = await filled(ext, page, routeLog, url, LEVER);
    await panel.locator('button[data-step-action="submit"]').click();
    await page.waitForURL(`${leverAt('b1')}/thanks`);
    await expect.poll(async () => (await ext.data<{ page?: { submitted?: string } }>({ v: 1, type: 'panel/reports', tabId }))
      .page?.submitted).toBe('recorded');
    expect(await bodies(APPLIED)).toHaveLength(1);
    // Page text alone never says it was sent: once that page's start-up is over, nothing was recorded.
    const other = await extContext.newPage();
    await other.goto(`${leverAt('b2')}/thanks`);
    const otherTab = await ext.tabIdOf(other);
    await settledIn(ext, otherTab);
    expect((await ext.data<{ page?: { submitted?: string } }>({ v: 1, type: 'panel/reports', tabId: otherTab })).page
      ?.submitted).toBeUndefined();
    expect(await bodies(APPLIED)).toHaveLength(1);
  });

  test('the person’s own click on the page’s Submit counts the same way', async ({ extContext, connected: ext, routeLog }) => {
    const page = await extContext.newPage();
    const { tabId } = await filled(ext, page, routeLog, greenhouseAt('02'), GREENHOUSE);
    await page.bringToFront();
    await page.getByRole('button', { name: 'Submit application' }).click();
    await expect.poll(() => submittedOn(page)).toBe(1);
    await expect.poll(async () => (await ext.data<{ page?: { submitted?: string } }>({ v: 1, type: 'panel/reports', tabId }))
      .page?.submitted).toBe('recorded');
  });

  test('Greenhouse: its confirmation as a page of its own counts too, and the side panel keeps the job, Applied', async ({ extContext, connected: ext, routeLog }) => {
    const page = await extContext.newPage();
    const url = greenhouseAt('06');
    routeLog.serve({ [`${url}/confirmation`]: GREENHOUSE_CONFIRMATION });
    const { tabId, panel } = await filled(ext, page, routeLog, url, GREENHOUSE_PAGE);
    await panel.locator('button[data-step-action="submit"]').click();
    await page.waitForURL(`${url}/confirmation`);
    await expect.poll(async () => (await ext.data<{ page?: { submitted?: string } }>({ v: 1, type: 'panel/reports', tabId }))
      .page?.submitted).toBe('recorded');
    expect(await bodies(APPLIED)).toHaveLength(1);
    // The panel on the confirmation page: the job card, Applied, beside "Application submitted" naming the job.
    await expect(panel.locator('[data-submitted="recorded"] [data-submitted-job]')).toContainText('Senior Backend Engineer');
    await expect(panel.locator('[data-job-card] [data-job-applied]')).toHaveText(COPY.job.applied);
    await expect(panel.getByRole('button', { name: COPY.panel.fill, exact: true })).toHaveCount(0);
  });

  test('names to the tracker the job chosen for the page and the resume the fill attached', async ({ extContext, connected: ext, routeLog }) => {
    const page = await extContext.newPage();
    const url = `${greenhouseAt('07')}?resume`;
    routeLog.serve({ [url]: GREENHOUSE });
    await page.goto(url);
    const tabId = await ext.tabIdOf(page);
    await ext.frameWithForm(tabId);
    const panel = await ext.reportPage(tabId);
    // "Autofill for another job": the tracked job about payments.
    await panel.locator('button[data-job-action="another"]').click();
    await panel.getByPlaceholder(COPY.job.another.placeholder).fill('payments');
    await panel.getByRole('button', { name: COPY.job.another.label, exact: true }).click();
    await panel.locator('button[data-job-choice="j0"]').click();
    await expect(panel.locator('[data-job-card] [data-job-chosen]')).toBeVisible();
    await ext.fill(page);
    const report = await ext.settled(tabId);
    expect(report.fields.find((field) => field.category === 'file.resume')).toMatchObject({ status: 'verified', wrote: true });
    await panel.locator('button[data-step-action="submit"]').click();
    await expect.poll(async () => (await bodies(APPLIED)).length).toBe(1);
    expect((await bodies(APPLIED))[0]).toEqual({ jobId: 1077, resumeId: GOLDEN_RESUME.id });
  });

  test('asks the person first while required fields are empty', async ({ extContext, connected: ext, routeLog }) => {
    const page = await extContext.newPage();
    const url = `${greenhouseAt('03')}?badge`;
    const { panel } = await filled(ext, page, routeLog, url, GREENHOUSE);
    await panel.locator('button[data-step-action="submit"]').click();
    await expect(panel.locator('[data-step-confirm]')).toContainText(COPY.panel.step.confirmEmpty(1));
    expect(await submittedOn(page)).toBe(0);
    await panel.getByRole('button', { name: COPY.panel.step.keepEditing }).click();
    expect(await submittedOn(page)).toBe(0);
    await panel.locator('button[data-step-action="submit"]').click();
    await panel.getByRole('button', { name: COPY.panel.step.submitAnyway }).click();
    await expect.poll(() => submittedOn(page)).toBe(1);
  });
});

test.describe('Apply without resume, then Submit (the review)', () => {
  test('a required upload left empty makes the panel’s Submit ask first', async ({ extContext, connected: ext, routeLog }) => {
    const page = await extContext.newPage();
    const url = `${greenhouseAt('08')}?resume`;
    routeLog.serve({ [url]: GREENHOUSE });
    await page.goto(url);
    const tabId = await ext.tabIdOf(page);
    await ext.frameWithForm(tabId);
    const panel = await ext.reportPage(tabId);
    await panel.locator('button[data-job-action="change"]').click();
    await panel.locator('button[data-resume-choice="without"]').click();
    await expect(panel.locator('[data-job-resume][data-without-resume]')).toBeVisible();
    await ext.fill(page);
    await ext.settled(tabId);
    await panel.locator('button[data-step-action="submit"]').click();
    await expect(panel.locator('[data-step-confirm]')).toContainText(COPY.panel.step.confirmEmpty(1));
    expect(await submittedOn(page)).toBe(0);
  });
});

test.describe('Continue to the next page (v3 Phase 4)', () => {
  test('presses the wizard’s own Next for the person on a step not final, and never its Submit', async ({ extContext, connected: ext, routeLog }) => {
    const page = await extContext.newPage();
    const url = WIZARD.url('dock');
    routeLog.serve({ [url]: WIZARD.file });
    await page.goto(url);
    const tabId = await ext.fill(page);
    await expect.poll(async () => (await ext.reports(tabId)).find((report) => report.frameId === 0)?.buttons)
      .toEqual({ final: 'not-final', next: true, submit: false });
    const panel = await ext.reportPage(tabId);
    const next = panel.locator('button[data-step-action="next"]');
    await expect(next).toHaveText(COPY.panel.step.next);
    expect((await wizardRecord(page)).next).toEqual([]);
    await next.click();
    await expect.poll(async () => (await wizardRecord(page)).next.length).toBe(1);
    expect((await wizardRecord(page)).next[0]).toMatchObject({ step: 1, trusted: false });
    expect(await submitEvents(page)).toEqual([]);
    expect(NEXT.details).toBe('#next-details');
    // Autofill after page turn: Automatically (the default): the next step is filled.
    // The run rests on it again (waiting for the person's Next: wait-transition, resting), its rows written.
    await expect.poll(async () => {
      const report = (await ext.reports(tabId)).find((each) => each.frameId === 0);
      return report?.step?.index === 1 && report.resting === true && report.fields.some((field) => field.wrote);
    }, { timeout: 20_000 }).toBe(true);
  });

  test('with Autofill after page turn: Manually, the next step is offered to Continue, not filled', async ({ extContext, connected: ext, routeLog }) => {
    await ext.data({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
      modes: { ...DEFAULT_SETTINGS.modes, afterPageTurn: 'manual' } } });
    const page = await extContext.newPage();
    const url = WIZARD.url('dock-manual');
    routeLog.serve({ [url]: WIZARD.file });
    await page.goto(url);
    const tabId = await ext.fill(page);
    await expect.poll(async () => (await ext.reports(tabId)).find((report) => report.frameId === 0)?.buttons?.next).toBe(true);
    const panel = await ext.reportPage(tabId);
    await panel.locator('button[data-step-action="next"]').click();
    await expect.poll(async () => (await wizardRecord(page)).next.length).toBe(1);
    // v4 (D7): the new page rests silently (no page-turned notice), nothing on it read or filled.
    await expect.poll(async () => (await ext.reports(tabId)).find((report) => report.frameId === 0)?.fields.length)
      .toBe(0);
    const turned = (await ext.reports(tabId)).find((report) => report.frameId === 0)!;
    expect(turned.notices.map((notice) => notice.code)).not.toContain('page-turned');
  });
});

test.describe('Submit mode Auto (v3 Phase 4)', () => {
  test('presses a clean final step by itself, and holds back where a required field is empty, saying why', async ({ extContext, connected: ext, routeLog }) => {
    await ext.data({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
      modes: { ...DEFAULT_SETTINGS.modes, submit: 'auto' } } });
    const page = await extContext.newPage();
    await filled(ext, page, routeLog, greenhouseAt('04'), GREENHOUSE);
    await expect.poll(() => submittedOn(page)).toBe(1);
    await expect.poll(async () => (await bodies(APPLIED)).length).toBe(1);

    const held = await extContext.newPage();
    const { report, panel } = await filled(ext, held, routeLog, `${greenhouseAt('05')}?badge`, GREENHOUSE);
    expect(await submittedOn(held)).toBe(0);
    expect(report.notices).toContainEqual({ code: 'submit-held-required', count: 1 });
    await expect(panel.getByText(COPY.notices['submit-held-required'])).toBeVisible();
    // The person can still submit from the dock.
    await expect(panel.locator('button[data-step-action="submit"]')).toBeVisible();
  });

  test('Modes shows Submit, Manual by default, and (since v3 Phase 5) Sign-in, Manual by default', async ({ ext }) => {
    const options = await ext.page();
    await options.goto(ext.url('options.html'));
    const group = options.locator('[data-setting-group="modes.submit"]');
    await expect(group).toBeVisible();
    await expect(group.locator('input[data-setting="modes.submit.manual"]')).toBeChecked();
    await expect(options.locator('[data-setting-group="modes.signIn"] input[data-setting="modes.signIn.manual"]'))
      .toBeChecked();
  });
});
