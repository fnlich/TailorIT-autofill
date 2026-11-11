/*
 * jr6 apply F2 (APPLYPLAN §5 F2 tests, e2e 68; the owner, 2026-11-10: "extension should also click `apply` to find and
 * run the form"): end to end in Chrome, on synthetic pages served at Lever posting addresses
 * (fixtures/synthetic/apply/*.html, their own scripts standing for a site's):
 * - a posting whose Apply is drawn 3 s after load, and whose application form the page draws in place after Apply, is
 *   filled by one press of the panel's main button (data-main-action="open": the frame presses the page's own Apply,
 *   watches the document, claims the form drawn in place with Lever's own adapter at the posting's address, and the
 *   worker's grant starts its run);
 * - a posting whose Apply opens a dialog asking how to apply: its "Apply manually" (the generic second step) is pressed,
 *   never "Sign in" or "Autofill with Resume", and the form it draws in place is filled.
 * Nothing is submitted, and the page never leaves its address. The button's word is F1's (Autofill); this spec reads
 * the button by its meaning.
 */
import { expect, test } from '../fixtures.ts';

const LATE = 'https://jobs.lever.co/tailorit-fixture/0a6e1c52-5b1f-4e2a-9c43-7d1f2a3b4c5d';
const DIALOG = 'https://jobs.lever.co/tailorit-fixture/5d4c3b2a-1f2e-4a3b-9c8d-7e6f5a4b3c2d';

test.describe('Autofill presses the site’s Apply and fills the form drawn in place (jr6 apply F2)', () => {
  test('an Apply drawn 3 s late, its form drawn in place after the press: one press fills it', async ({ extContext,
    connected: ext, routeLog }) => {
    routeLog.serve({ [LATE]: 'fixtures/synthetic/apply/late-apply-in-place.html' });
    const page = await extContext.newPage();
    await page.goto(LATE);
    const tabId = await ext.tabIdOf(page);
    const panel = await ext.reportPage(tabId);
    const button = panel.locator('button.tia-cta[data-main-action="open"]');
    await expect(button).toBeEnabled({ timeout: 20_000 });
    await button.click();
    await page.bringToFront();
    await expect.poll(() => page.evaluate(() => (window as unknown as { formDrawn: number }).formDrawn),
      { timeout: 15_000 }).toBe(1);
    const report = await ext.settled(tabId);
    expect(report.fields.filter((row) => row.wrote).length).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as unknown as { applyPressed: number }).applyPressed)).toBe(1);
    expect(page.url()).toBe(LATE);
    expect(routeLog.submitted).toEqual([]);
  });

  test('a dialog that asks how to apply: "Apply manually" pressed, never "Sign in"; the form it draws filled', async ({
    extContext, connected: ext, routeLog }) => {
    routeLog.serve({ [DIALOG]: 'fixtures/synthetic/apply/dialog-second-step.html' });
    const page = await extContext.newPage();
    await page.goto(DIALOG);
    const tabId = await ext.tabIdOf(page);
    const panel = await ext.reportPage(tabId);
    const button = panel.locator('button.tia-cta[data-main-action="open"]');
    await expect(button).toBeEnabled({ timeout: 15_000 });
    await button.click();
    await page.bringToFront();
    await expect.poll(() => page.evaluate(() => (window as unknown as { pressed: Record<string, number> }).pressed),
      { timeout: 15_000 }).toEqual({ apply: 1, manually: 1, signIn: 0, autofill: 0 });
    await expect(page.locator('form#application-form')).toBeVisible({ timeout: 10_000 });
    const report = await ext.settled(tabId);
    expect(report.fields.filter((row) => row.wrote).length).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as unknown as { pressed: Record<string, number> }).pressed))
      .toEqual({ apply: 1, manually: 1, signIn: 0, autofill: 0 });
    expect(page.url()).toBe(DIALOG);
    expect(routeLog.submitted).toEqual([]);
  });
});
