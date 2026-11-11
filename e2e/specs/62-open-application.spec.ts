/*
 * v5 Phase 2 (P2-fill), Autofill on a posting end to end (PLAN Phase 2, after Jobright's entry button): on Lever's
 * posting page (the owner's snapshot, fixtures/lever/ahead-posting.html, at its real address) the panel's main button
 * means 'open' (the site offers its own Apply) and, since jr6 apply F1 (the owner, 2026-11-10: "`Autofill` word will be
 * kept"; APPLYPLAN D1), reads "Autofill"; its trusted click presses the posting's own "Apply for this job" (the Lever
 * adapter's entryControl: the link to the posting's own /apply), and the application it opens (served here by the smoke
 * form at that address) is filled by itself, once, as the worker's grant starts the next form of that job. Nothing
 * submitted.
 *
 * The F1 fixer (the line P review, C1, C2, C4), in the real extension (F1, F2 and F3a together), reading every line of
 * words the panel shows:
 * - a posting whose Apply never comes within Lever's entry wait (F2's synthetic late-Apply page, its Apply drawn after
 *   60 s): while the frame waits, the posting's strip alone (no run line), the button busy, the focus on Cancel and the
 *   press said to a screen reader; then the "no form" modal's words alone, then its line alone;
 * - a list of jobs on Lever (three Applies, no posting address): its strip promises no Apply, and Autofill's answer
 *   claims neither a search nor a page without an Apply. Nothing is pressed on it.
 */
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { COPY } from '../../src/shared/copy';
import { expect, test } from '../fixtures.ts';
import { routesFile } from '../routes.ts';

const POSTING = 'https://jobs.lever.co/thinkahead/19f1f5f1-4d28-4d0d-b047-b3f9b6031091';
/** F2's late-Apply page's own address (its script names it). */
const LATE = 'https://jobs.lever.co/tailorit-fixture/0a6e1c52-5b1f-4e2a-9c43-7d1f2a3b4c5d';
const BOARD = 'https://jobs.lever.co/tailorit-fixture';
const HTML = { contentType: 'text/html; charset=utf-8' } as const;

/** Every line of words the panel's main view shows (strips, the line under the button, a modal's text), in order. */
const linesOf = (panel: Page) => panel.locator('.tia-strip, .tia-feedback, .tia-modal__text').evaluateAll((all) =>
  all.map((each) => {
    const kind = (each as HTMLElement).dataset.strip ?? (each.classList.contains('tia-feedback') ? 'feedback' : 'modal');
    return `[${kind}] ${each.textContent}`;
  }));

/** A Lever list of jobs: three made-up jobs, each with its Apply (no capture). */
function board(): string {
  const job = (id: string, title: string) => `<div class="posting"><a class="posting-title" href="${BOARD}/${id}">`
    + `<h5>${title}</h5></a><a class="posting-btn-submit template-btn-submit" href="${BOARD}/${id}/apply">Apply</a></div>`;
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Synthetic Co jobs</title></head><body>'
    + '<div class="postings-wrapper">'
    + job('11111111-2222-4333-8444-555555555551', 'Platform Engineer')
    + job('11111111-2222-4333-8444-555555555552', 'Data Analyst')
    + job('11111111-2222-4333-8444-555555555553', 'Designer')
    + '</div></body></html>';
}

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

  test('a posting whose Apply never comes: one line at a time, the press busy and heard, then the "no form" words alone (the line P review C1, C4)', async ({ extContext, connected: ext, routeLog }) => {
    const html = readFileSync('fixtures/synthetic/apply/late-apply-in-place.html', 'utf8')
      .replace('data-apply-delay="3000"', 'data-apply-delay="60000"');
    expect(html).toContain('data-apply-delay="60000"');
    routeLog.serve({ [LATE]: { body: html, ...HTML } });
    const page = await extContext.newPage();
    await page.goto(LATE);
    const tabId = await ext.tabIdOf(page);
    const panel = await ext.reportPage(tabId);
    const button = panel.locator('button.tia-cta[data-main-action="fill"]');
    await expect(button).toBeEnabled({ timeout: 15_000 });
    expect(await linesOf(panel)).toEqual([`[no-form] ${COPY.strip.posting}`]);
    await button.click();
    // The frame waits for the site's Apply (Lever's entry wait): Cancel, the button busy, the press said, the focus the
    // button had on Cancel (C4), and the strip alone, no run line (C1).
    const cancel = panel.locator('[data-action="cancel"]');
    await expect(cancel).toBeVisible({ timeout: 5_000 });
    await expect(panel.locator('button.tia-cta')).toHaveAttribute('aria-busy', 'true');
    await expect(panel.locator('[data-entry-status]')).toHaveText(COPY.mainView.entering);
    await expect(cancel).toBeFocused();
    expect(await linesOf(panel)).toEqual([`[no-form] ${COPY.strip.posting}`]);
    // No Apply came: the "no form" modal says why, alone; closed, its line alone.
    await expect(panel.locator('[data-modal-reason="no-form"]')).toBeVisible({ timeout: 25_000 });
    expect(await linesOf(panel)).toEqual([`[modal] ${COPY.mainView.entryRefused.none}`]);
    await panel.locator('[data-modal-action="cancel"]').click();
    await expect.poll(() => linesOf(panel)).toEqual([`[entry-refused] ${COPY.mainView.entryRefused.none}`]);
    await expect(panel.locator('[data-entry-status]')).toHaveText(COPY.mainView.entryRefused.none);
    expect(await page.evaluate(() => (window as unknown as { applyPressed: number }).applyPressed)).toBe(0);
    expect(page.url()).toBe(LATE);
    expect(routeLog.submitted).toEqual([]);
  });

  test('a list of jobs: its strip promises no Apply, and Autofill\'s answer claims no search and no page without an Apply (the line P review C2)', async ({ extContext, connected: ext, routeLog }) => {
    routeLog.serve({ [BOARD]: { body: board(), ...HTML } });
    const page = await extContext.newPage();
    await page.goto(BOARD);
    const tabId = await ext.tabIdOf(page);
    const panel = await ext.reportPage(tabId);
    const button = panel.locator('button.tia-cta[data-main-action="fill"]');
    await expect(button).toBeEnabled({ timeout: 15_000 });
    expect(await linesOf(panel)).toEqual([`[no-form] ${COPY.strip.noForm}`]);
    await button.click();
    // The frame finds no Apply of one job's to press within Lever's wait: the "no form" modal, its words true here.
    await expect(panel.locator('[data-modal-reason="no-form"]')).toBeVisible({ timeout: 25_000 });
    expect(await linesOf(panel)).toEqual([`[modal] ${COPY.modals.errors['no-form']}`]);
    expect(COPY.modals.errors['no-form']).not.toMatch(/no Apply button|no Apply that opens|no Apply on/i);
    expect(COPY.modals.errors['no-form']).not.toMatch(/\b(found|looked|searched|checked)\b/i);
    await panel.locator('[data-modal-action="cancel"]').click();
    await expect.poll(() => linesOf(panel)).toEqual([`[entry-refused] ${COPY.mainView.entryRefused.none}`]);
    // Nothing pressed: the list is where it was.
    expect(page.url()).toBe(BOARD);
    expect(routeLog.submitted).toEqual([]);
  });
});
