/*
 * v3 Phase 3 end to end: the side panel's progress and Skip, and the launcher's tab at the page's right edge.
 * - A resume that takes long to arrive (the mock's resume-slow): the panel shows "Autofilling" with a percent, the
 *   resume's row being written (a spinner), and after 2 s on it Skip. Skip gives up that one write: the row is flagged
 *   skipped-by-you, nothing is put into the file input, and the run goes on with the fields after it.
 * - The launcher sits in a tab at the window's right edge; its "×" opens the hide menu, and "Hide on this site" hides
 *   it there (the worker keeps it, by a hash of the host), even after a reload; the side panel then offers "Show the
 *   TailorIT button again", which brings it back. Every click is the person's own (trusted) one.
 */
import { COPY } from '../../src/shared/copy';
import { expect, test } from '../fixtures.ts';
import { row } from '../helpers/extension.ts';
import { RESUME_FILE_ROUTE, mock } from '../helpers/mock.ts';
import { fileHeld } from '../helpers/page-state.ts';
import { PageUi } from '../helpers/page-ui.ts';
import { closeSidePanelViews } from '../helpers/stop-worker.ts';

const PAGE_FILE = 'fixtures/synthetic/resume-upload.html';
const at = (name: string) => `https://jobs.lever.co/tailorit-fixture/${name}/apply`;

test.describe('the side panel’s progress and Skip (v3 Phase 3)', () => {
  test('shows the field being written and, after 2 s on it, Skip, which gives that one write up and lets the run go on', async ({ extContext, connected: ext, routeLog, tailorit }) => {
    test.setTimeout(90_000);
    const url = at('skip-resume');
    routeLog.serve({ [url]: PAGE_FILE });
    await tailorit.scenario('resume-slow', { times: 1, delayMs: 30_000 });
    const page = await extContext.newPage();
    await page.goto(url);
    const tabId = await ext.fill(page);
    const panel = await ext.reportPage(tabId);
    await panel.bringToFront();
    // While the resume is on its way: Autofilling, a percent, the resume's row being written, and Cancel.
    await expect(panel.locator('[data-progress="filling"]')).toBeVisible({ timeout: 20_000 });
    await expect(panel.locator('.tia-progress-line__title')).toContainText(COPY.report.autofilling);
    await expect(panel.locator('.tia-progress-line__percent')).toHaveText(/^\d{1,3}%$/);
    const current = panel.locator('li[data-current="true"]');
    await expect(current).toHaveAttribute('data-progress', 'working', { timeout: 20_000 });
    await expect(panel.locator('.tia-progress-line button[data-action="cancel"]')).toBeVisible();
    // Skip only after 2 s on the same field.
    const skip = current.locator('button[data-action="skip"]');
    await expect(skip).toBeVisible({ timeout: 10_000 });
    const skipped = await current.getAttribute('data-field-key');
    await skip.click();
    const report = await ext.settled(tabId, { timeout: 30_000 });
    expect(report.status).toBe('review');
    const resume = report.fields.find((field) => field.key === skipped)!;
    expect(resume).toMatchObject({ category: 'file.resume', status: 'flagged', reason: 'skipped-by-you', wrote: false });
    expect(await fileHeld(page, '#resume')).toBeNull();
    // The rest of the form was filled as before.
    expect(row(report, 'Email')).toMatchObject({ status: 'verified', wrote: true });
    // The worker was asked for the file once, and its answer, when it came, was never used.
    expect((await mock.requestsTo(RESUME_FILE_ROUTE)).length).toBeLessThanOrEqual(1);
    await expect(panel.locator(`li[data-field-key="${skipped}"]`)).toHaveAttribute('data-progress', 'missing');
  });
});

test.describe('the launcher’s tab at the page’s edge (v3 Phase 3)', () => {
  test('hides on this site from its × menu, stays hidden after a reload, and comes back from the side panel', async ({ extContext, extensionId, connected: ext, routeLog }) => {
    const url = at('hide-menu');
    routeLog.serve({ [url]: PAGE_FILE });
    // The browser's own side panel, left open by an earlier spec, would show this tab once it is in front, and the tab
    // hides while it does (as it should): only the report page, a tab of its own, shows it here.
    await closeSidePanelViews(extContext, await ext.page(), extensionId);
    const page = await extContext.newPage();
    await page.goto(url);
    const tabId = await ext.tabIdOf(page);
    await ext.frameWithForm(tabId);
    const ui = await PageUi.of(page);
    try {
      // The tab at the window's right edge, the launcher in it.
      await expect.poll(async () => (await ui.launcher())?.shown ?? false).toBe(true);
      const edge = (await ui.elements('[data-edge]'))[0]!;
      const box = (await ui.box(edge))!;
      expect(box.x + box.width).toBeCloseTo(page.viewportSize()!.width, 0);
      // Its ×: the menu, then Hide on this site.
      await ui.clickButton(COPY.launcherHide.open);
      await expect.poll(async () => (await ui.elements('[data-hide]')).filter((item) => item.shown).map((item) => item.text))
        .toEqual([COPY.launcherHide.nextVisit, COPY.launcherHide.site, COPY.launcherHide.everywhere]);
      await ui.clickButton(COPY.launcherHide.site);
      await expect.poll(async () => (await ui.launcher())?.shown ?? true).toBe(false);
      // A reload keeps it hidden on this site.
      await page.reload();
      await ext.frameWithForm(tabId);
      const again = await PageUi.of(page);
      await expect.poll(async () => (await again.mounted())).toBe(true);
      await expect.poll(async () => (await again.launcher())?.shown ?? true).toBe(false);
      // The side panel offers it back.
      const panel = await ext.reportPage(tabId);
      await expect(panel.locator('[data-launcher-hidden="site"]')).toBeVisible();
      await panel.getByRole('button', { name: COPY.panel.showLauncher, exact: true }).click();
      await expect(panel.locator('[data-launcher-hidden]')).toHaveCount(0);
      await page.bringToFront();
      await expect.poll(async () => (await again.launcher())?.shown ?? false).toBe(true);
      await again.close();
    } finally {
      await ui.close();
    }
  });
});
