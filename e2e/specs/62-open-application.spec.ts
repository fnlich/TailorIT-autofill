/*
 * v5 Phase 2 (P2-fill), Autofill on a posting end to end (PLAN Phase 2, after Jobright's entry button): on Lever's
 * posting page (the owner's snapshot, fixtures/lever/ahead-posting.html, at its real address) the panel's main button
 * means 'open' (the site offers its own Apply) and, since jr6 apply F1 (the owner, 2026-11-10: "`Autofill` word will be
 * kept"; APPLYPLAN D1), reads "Autofill"; its trusted click presses the posting's own "Apply for this job" (the Lever
 * adapter's entryControl: the link to the posting's own /apply), and the application it opens (served here by the smoke
 * form at that address) is filled by itself, once, as the worker's grant starts the next form of that job. Nothing
 * submitted.
 */
import { expect, test } from '../fixtures.ts';
import { routesFile } from '../routes.ts';

const POSTING = 'https://jobs.lever.co/thinkahead/19f1f5f1-4d28-4d0d-b047-b3f9b6031091';

test.describe('Autofill presses the posting\'s Apply (v5 p2-fill, jr6 apply F1)', () => {
  test('presses the posting\'s own Apply at the panel\'s click and fills the application it opens', async ({ extContext, connected: ext, routeLog }) => {
    routeLog.serve({ ...routesFile('fixtures/lever/ahead-posting.routes.json'), [`${POSTING}/apply`]: 'fixtures/smoke/form.html' });
    const page = await extContext.newPage();
    await page.goto(POSTING);
    const tabId = await ext.tabIdOf(page);
    const panel = await ext.reportPage(tabId);
    const button = panel.locator('button.tia-cta[data-main-action="open"]');
    await expect(button).toHaveText('Autofill', { timeout: 15_000 });
    await expect(button).toBeEnabled();
    await button.click();
    await page.bringToFront();
    await page.waitForURL(`${POSTING}/apply`, { timeout: 15_000 });
    const report = await ext.settled(tabId);
    expect(report.fields.filter((row) => row.wrote).length).toBeGreaterThan(0);
    expect(routeLog.submitted).toEqual([]);
  });
});
