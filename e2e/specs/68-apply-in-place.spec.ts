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
 * - (jr6 apply merge: F1, F2 and F3a together) Autofill pressed before the page draws its Apply: the button is offered
 *   with no Apply told (F1, D2: meaning 'fill'), the worker sends run/start to the application frame whatever it told
 *   (F3a), the frame waits for the late Apply (entryWaitOf), presses it, and the grant its press armed starts the form
 *   the page draws in place (F2, F3a). Meanwhile the panel says one thing, the posting's strip, and no run line under
 *   the button, during the wait or after the fill (the F1 fixer's C1, applied at the APPLY merge, round 2).
 * Nothing is submitted, and the page never leaves its address. The button's word is F1's (Autofill); this spec reads
 * the button by its meaning.
 */
import { readFileSync } from 'node:fs';
import { COPY } from '../../src/shared/copy';
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

  test('Autofill pressed before the Apply is drawn: the frame waits for it, presses it once, and the form drawn in place is filled (jr6 apply merge)',
    async ({ extContext, connected: ext, routeLog }) => {
      // The same page with its Apply drawn 6 s after load (Lever's entry wait is 8 s from the run/start).
      const html = readFileSync('fixtures/synthetic/apply/late-apply-in-place.html', 'utf8')
        .replace('data-apply-delay="3000"', 'data-apply-delay="6000"');
      expect(html).toContain('data-apply-delay="6000"');
      routeLog.serve({ [LATE]: { body: html, contentType: 'text/html; charset=utf-8' } });
      const page = await extContext.newPage();
      await page.goto(LATE);
      const tabId = await ext.tabIdOf(page);
      const panel = await ext.reportPage(tabId);
      // No Apply told yet: Autofill is offered all the same, as a plain fill (F1, D2).
      const button = panel.locator('button.tia-cta[data-main-action="fill"]');
      await expect(button).toHaveText('Autofill');
      await expect(button).toBeEnabled({ timeout: 5_000 });
      await button.click();
      // The click was made before the page drew its Apply.
      expect(await page.evaluate(() => document.getElementById('apply') === null)).toBe(true);
      // The F1 fixer (the line P review, C1): while the frame waits for the late Apply, the panel says one thing: the
      // posting's strip, and no run line under the button.
      await expect(panel.locator('[data-action="cancel"]')).toBeVisible({ timeout: 5_000 });
      expect(await panel.locator('.tia-strip, .tia-feedback, .tia-modal__text').allTextContents())
        .toEqual([COPY.strip.posting]);
      await page.bringToFront();
      await expect.poll(() => page.evaluate(() => (window as unknown as { formDrawn: number }).formDrawn),
        { timeout: 20_000 }).toBe(1);
      const report = await ext.settled(tabId);
      expect(report.fields.filter((row) => row.wrote).length).toBeGreaterThan(0);
      expect(await page.evaluate(() => (window as unknown as { applyPressed: number }).applyPressed)).toBe(1);
      // Nor once the form drawn in place was filled.
      await expect(panel.locator('.tia-feedback')).toHaveCount(0);
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
