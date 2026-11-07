/*
 * The look, captured for a person to compare (`npm run shots`, never part of verify; playwright.config.ts adds this
 * project only with TIA_SHOTS=1): the e2e build against the TailorIT mock, each surface in the state it is meant for,
 * into e2e/artifacts/shots (git-ignored), with an index.html that shows them side by side. When TIA_SHOTS_REFERENCE
 * names a folder of reference pictures on this computer, the index shows them too, by their file: address; nothing of
 * them enters the repo.
 * - The side panel at 400 px: before Autofill, a real form's review, the résumé row's preview, the Settings view with a
 *   "?" showing its bubble, a trap's review (nothing flagged), and the review again under a dark system scheme (it stays
 *   light); v4 ui: the set-up view and its disclosure (last: it disconnects).
 * - v3 Phase 3 (Jobright's layout): "Autofilling… NN%" with the row being written and Skip (a slow resume), the
 *   Settings view and the Minimized view, a page Autofill does not work on, the launcher's tab at the page's edge with
 *   its hide menu, and the panel offering it back.
 * - v2: the job card found, not found with the Add pill, already applied, loading, unavailable, the résumé line's
 *   picker, and a custom question answered.
 * - Phase G: a fill's review with the cover letter attached, previewed under its row.
 * - v3 Phases 3b and 4: the dock's "Submit application", its question while required fields are empty, "Application
 *   submitted"; the wizard's "Continue to the next page"; "Autofill for another job" searched; the resume's preview;
 *   "Apply without resume"; "Your autofill information"; a posting page's card; Edit with AI's instruction box; and
 *   "Ask TailorIT to support this site" answered on an unsupported page; the review: the disclosure shown again.
 * - The page's own UI: the launcher at rest and at review, its notices and the policy card, the in-page panel open.
 * - v3 Phase 5: the options page's Auto-apply card (off, its one-time confirmation, running a job), the side panel's
 *   status line with Stop, Sign-in Auto signing in on a sign-in page, and Modes with Sign-in and the skip rules.
 * - The options page.
 * Every capture is in the light scheme with reduced motion and animations stopped, so a picture is the same each time.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../../src/core/types/settings';
import { DISCLOSURE_VERSION } from '../../src/shared/stored';
import { expect, test } from '../fixtures.ts';
import type { Extension } from '../helpers/extension.ts';
import { mock } from '../helpers/mock.ts';
import { expectation } from '../helpers/labels.ts';
import { PageUi } from '../helpers/page-ui.ts';
import { trap } from '../helpers/traps.ts';
import { WIZARD } from '../helpers/wizard.ts';
import { routesFile } from '../routes.ts';

/** e2e/artifacts/shots, from this file's own folder: never from wherever the run was started (it is emptied first). */
const OUT = resolve(import.meta.dirname, '..', 'artifacts', 'shots');
const PANEL_VIEWPORT = { width: 400, height: 860 } as const;
const SNAPSHOT = 'lever/spotify-ny';

/** The pictures taken, in order, with what each shows. */
const taken: Array<{ file: string; title: string }> = [];

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
});

test.afterAll(() => {
  const reference = process.env.TIA_SHOTS_REFERENCE;
  const pictures = reference !== undefined && existsSync(reference)
    ? readdirSync(reference).filter((name) => ['.png', '.jpg', '.jpeg', '.webp'].includes(extname(name).toLowerCase()))
      .map((name) => pathToFileURL(join(reference, name)).href)
    : [];
  const figure = (src: string, title: string) =>
    `<figure><img src="${src}" alt=""><figcaption>${title.replaceAll('<', '&lt;')}</figcaption></figure>`;
  writeFileSync(join(OUT, 'index.html'), `<!doctype html><meta charset="utf-8"><title>TailorIT Autofill: shots</title>
<style>body{font:14px system-ui;margin:24px;background:#f2f2f2}section{display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start}
figure{margin:0;background:#fff;padding:8px;border:1px solid #ddd}img{display:block;max-width:440px}figcaption{margin-top:6px}</style>
<h1>Shots</h1><section>${taken.map((shot) => figure(shot.file, shot.title)).join('')}</section>
${pictures.length > 0 ? `<h2>Reference</h2><section>${pictures.map((src) => figure(src, src.split('/').at(-1)!)).join('')}</section>` : ''}`);
});

/** Light, still: what every capture is taken in (a dark system scheme only where asked). */
async function still(page: Page, colorScheme: 'light' | 'dark' = 'light'): Promise<void> {
  await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
}

async function shoot(page: Page, file: string, title: string, options: Parameters<Page['screenshot']>[0] = {}): Promise<void> {
  await page.screenshot({ path: join(OUT, file), animations: 'disabled', ...options });
  taken.push({ file, title });
}

/** The side panel for a tab, at the panel's width. */
async function sidePanel(ext: Extension, tabId: number): Promise<Page> {
  const panel = await ext.reportPage(tabId);
  await panel.setViewportSize(PANEL_VIEWPORT);
  await still(panel);
  await expect(panel.locator('h1')).toBeVisible();
  // The main button, where there is one, as it looks once shown long enough to take a click (the v4 review, L4: grey
  // until then).
  await expect(panel.locator('button.tia-cta[data-main-action]:disabled:not([data-working])')).toHaveCount(0);
  return panel;
}

/** A region of the page around the first shown element of our UI for each selector, `pad` pixels out, inside the
 *  viewport. Each element's box is read at once: a later read of the closed root gives its nodes new ids. */
async function around(page: Page, ui: PageUi, selectors: readonly string[], pad = 16) {
  const boxes: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (const selector of selectors) {
    for (const target of (await ui.elements(selector)).filter((element) => element.shown)) {
      const box = await ui.box(target);
      if (box !== null) boxes.push(box);
    }
  }
  if (boxes.length === 0) throw new Error(`nothing of ${selectors.join(', ')} is shown`);
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const x = Math.max(0, Math.min(...boxes.map((box) => box.x)) - pad);
  const y = Math.max(0, Math.min(...boxes.map((box) => box.y)) - pad);
  const right = Math.min(viewport.width, Math.max(...boxes.map((box) => box.x + box.width)) + pad);
  const bottom = Math.min(viewport.height, Math.max(...boxes.map((box) => box.y + box.height)) + pad);
  return { x, y, width: right - x, height: bottom - y };
}

test("the side panel: before Autofill, a real form's review, the Settings view, and the dark scheme", async ({ extContext, connected: ext, routeLog }) => {
  const snapshot = expectation(SNAPSHOT);
  routeLog.serve(routesFile(`fixtures/${SNAPSHOT}.routes.json`));
  const page = await extContext.newPage();
  await page.goto(snapshot.source);
  const tabId = await ext.tabIdOf(page);
  await ext.frameWithForm(tabId);
  const panel = await sidePanel(ext, tabId);
  await shoot(panel, '01-side-panel-before.png', 'Side panel, before Autofill');

  await ext.fill(page);
  expect((await ext.settled(tabId)).status).toBe('review');
  await panel.bringToFront();
  await expect(panel.locator('[data-progress="rest"]')).toBeVisible();
  await shoot(panel, '02-side-panel-review.png', 'Side panel, a real form reviewed (top)');
  await shoot(panel, '02b-side-panel-review-full.png', 'Side panel, a real form reviewed (whole page)', { fullPage: true });
  await panel.locator('[data-group="required"]').scrollIntoViewIfNeeded();
  await shoot(panel, '02d-side-panel-required-optional.png', 'Side panel, the Required and Optional lists');
  // v4 ui: the résumé row's preview, then the Settings view with a "?" showing its bubble.
  const preview = panel.locator('li[data-file] button[data-action="preview"]').first();
  if (await preview.count() > 0) {
    await preview.click();
    await preview.scrollIntoViewIfNeeded();
    await shoot(panel, '02c-side-panel-row-preview.png', 'Side panel, the résumé row\'s Preview opened');
  }
  await panel.evaluate(() => window.scrollTo(0, 0));
  await panel.locator('button[data-panel-settings]').click();
  await expect(panel.locator('[data-settings-view]')).toBeVisible();
  await panel.locator('[data-setting-group="modes.afterPageTurn"] .tia-helptip__button').focus();
  await shoot(panel, '02e-side-panel-settings.png', 'Side panel, the Settings view, a "?" showing its explanation');
  await panel.locator('button[data-action="close-settings"]').click();
  await still(panel, 'dark');
  await shoot(panel, '09-side-panel-dark-scheme.png', 'Side panel under a dark system scheme: it stays light');
  await still(panel);
});

test("the side panel: a trap's review, nothing flagged", async ({ extContext, connected: ext, routeLog }) => {
  const served = trap('01');
  routeLog.serve({ [served.url]: served.file });
  const page = await extContext.newPage();
  await page.goto(served.url);
  const tabId = await ext.fill(page);
  expect((await ext.settled(tabId)).status).toBe('review');
  const panel = await sidePanel(ext, tabId);
  await panel.bringToFront();
  await expect(panel.locator('[data-progress="rest"]')).toBeVisible();
  await shoot(panel, '03-side-panel-review.png', 'Side panel, a trap\'s review: ticks and empty circles, no flag (trap 01)',
    { fullPage: true });

  // The page's own UI after it: the launcher at review, its badge, and the notices.
  const ui = await PageUi.of(page);
  await still(page);
  await page.bringToFront();
  await expect.poll(async () => (await ui.launcher())?.attributes['data-state']).toBe('review');
  await shoot(page, '05b-launcher-review.png', 'Launcher at review, its count in the badge',
    { clip: await around(page, ui, ['button.launcher'], 44) });
  await shoot(page, '08-page-notices.png', 'The page’s toasts (v4)',
    { clip: await around(page, ui, ['button.launcher', '.toast']) });
  await ui.close();
});

test('v4: a branded toast on the page (the tripwire’s, the hard rules’ one notice)', async ({ extContext, connected: ext, routeLog }) => {
  const served = trap('01');
  routeLog.serve({ [served.url]: served.file });
  const page = await extContext.newPage();
  await page.goto(served.url);
  const tabId = await ext.fill(page);
  await ext.settled(tabId);
  const ui = await PageUi.of(page);
  await still(page);
  await page.bringToFront();
  await expect.poll(async () => (await ui.noticeTexts()).length).toBeGreaterThan(0);
  await shoot(page, '08b-page-toast.png', 'A TailorIT toast on the page', { clip: await around(page, ui, ['.toast']) });
  await ui.close();
});

test('the in-page panel, and the launcher at rest', async ({ extContext, connected: ext, routeLog }) => {
  await ext.data({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS, panel: 'in-page' } });
  try {
    const served = trap('03');
    routeLog.serve({ [served.url]: served.file });
    const page = await extContext.newPage();
    await page.goto(served.url);
    const tabId = await ext.tabIdOf(page);
    await ext.frameWithForm(tabId);
    await still(page);
    const ui = await PageUi.of(page);
    await expect.poll(async () => (await ui.launcher())?.shown ?? false).toBe(true);
    await shoot(page, '05a-launcher-idle.png', 'Launcher at rest', { clip: await around(page, ui, ['button.launcher'], 44) });

    await ui.clickLauncher();
    expect((await ext.settled(tabId)).status).toBe('review');
    await expect.poll(async () => (await ui.launcher())?.attributes['data-state']).toBe('review');
    await ui.clickLauncher();
    await expect.poll(async () => (await ui.elements('[data-panel="in-page"]'))[0]?.shown).toBe(true);
    await expect.poll(async () => (await ui.elements('[data-panel="in-page"] li[data-field-key]')).length).toBeGreaterThan(0);
    await shoot(page, '06-in-page-panel.png', 'The in-page panel under the launcher',
      { clip: await around(page, ui, ['button.launcher', '[data-panel="in-page"]']) });
    await ui.clickButton('Close the review');
    await ui.close();
  } finally {
    await ext.data({ v: 1, type: 'settings/save', settings: DEFAULT_SETTINGS });
  }
});

/** A Lever posting TailorIT can add from, for the card's states (the synthetic form, its posting's title above it). */
const CARD_APPLY = (id: string) => `https://jobs.lever.co/tailorit-fixture/00000000-0000-4000-8000-00000000c${id}/apply`;

/** The side panel of a fresh tab showing the synthetic form at `url`, once its card is past `state` (or at it). */
async function cardPanel(ext: Extension, page: Page, routeLog: { serve(routes: Record<string, string>): void }, url: string) {
  routeLog.serve({ [url]: 'fixtures/synthetic/policy-apply.html' });
  await page.goto(url);
  const tabId = await ext.tabIdOf(page);
  await ext.frameWithForm(tabId);
  const panel = await sidePanel(ext, tabId);
  await panel.bringToFront();
  return { tabId, panel, card: panel.locator('[data-job-card]') };
}

test('the job card: found, not found with Add, already applied, loading, unavailable', async ({ extContext, connected: ext, routeLog, tailorit }) => {
  const found = await cardPanel(ext, await extContext.newPage(), routeLog, CARD_APPLY('001'));
  await expect(found.card).toHaveAttribute('data-job-state', 'found');
  await shoot(found.panel, '10-job-card-found.png', 'Job card: found, its match, Autofill, Ask custom question, the résumé');
  await found.panel.locator('[data-job-resume]').getByRole('button', { name: 'Change', exact: true }).click();
  await expect(found.panel.locator('[data-resume-choice=""]').first()).toBeVisible();
  await shoot(found.panel, '10b-job-card-change.png', 'The résumé line: Change, the resumes to choose from');

  await tailorit.scenario('lookup-not-found');
  const missing = await cardPanel(ext, await extContext.newPage(), routeLog, CARD_APPLY('002'));
  await expect(missing.card).toHaveAttribute('data-job-state', 'not-found');
  await shoot(missing.panel, '11-job-card-not-found.png', 'Job card: not in TailorIT, with "+ Add this job in one click"');
  await tailorit.reset();

  await tailorit.scenario('lookup-applied');
  const applied = await cardPanel(ext, await extContext.newPage(), routeLog, CARD_APPLY('003'));
  await expect(applied.card.locator('[data-job-applied]')).toBeVisible();
  await shoot(applied.panel, '12-job-card-applied.png', 'Job card: already applied, its badge alone');
  await tailorit.reset();

  await tailorit.scenario('lookup-slow', { delayMs: 20_000, times: 1 });
  const loading = await cardPanel(ext, await extContext.newPage(), routeLog, CARD_APPLY('004'));
  await expect(loading.card).toHaveAttribute('data-job-state', 'loading');
  await shoot(loading.panel, '13-job-card-loading.png', 'Job card: loading');
  await tailorit.reset();

  await tailorit.scenario('lookup-fails');
  const unavailable = await cardPanel(ext, await extContext.newPage(), routeLog, CARD_APPLY('005'));
  await expect(unavailable.card).toHaveAttribute('data-job-state', 'unavailable');
  await shoot(unavailable.panel, '14-job-card-unavailable.png', 'Job card: TailorIT could not say');
});

test('a custom question answered', async ({ extContext, connected: ext, routeLog }) => {
  const page = await extContext.newPage();
  const { panel } = await cardPanel(ext, page, routeLog, CARD_APPLY('006'));
  await panel.getByRole('button', { name: 'Ask custom question', exact: true }).click();
  await panel.getByLabel('Your question').fill('Why do you want to work at Northwind?');
  await panel.getByRole('button', { name: 'Get answer', exact: true }).click();
  const answer = panel.locator('[data-ask-answer]');
  await expect(answer).toBeVisible();
  await answer.scrollIntoViewIfNeeded();
  await shoot(panel, '16-custom-question.png', 'Ask a custom question, answered from the resume the card attaches');
});

test('the cover letter attached in a review, previewed from its row (v4 ui)', async ({ extContext, connected: ext, routeLog, tailorit }) => {
  const url = 'https://jobs.lever.co/tailorit-fixture/cover-shot-filled/apply';
  routeLog.serve({ [url]: 'fixtures/synthetic/cover-letter-upload.html' });
  await tailorit.scenario('letter-generating-then-ready', { times: 1 });
  const page = await extContext.newPage();
  await page.goto(url);
  const tabId = await ext.fill(page);
  expect((await ext.settled(tabId)).status).toBe('review');
  const panel = await sidePanel(ext, tabId);
  await panel.bringToFront();
  const row = panel.locator('li[data-category="file.coverLetter"]').first();
  await expect(row).toHaveAttribute('data-status', 'verified');
  await row.locator('button[data-action="preview"]').click();
  await expect(row.locator('iframe[data-preview-frame]')).toBeVisible();
  await row.scrollIntoViewIfNeeded();
  await shoot(panel, '17-cover-letter-preview.png', 'Review: the cover letter attached, its Preview opened under its row');
});

test('v3 Phase 3: Autofilling with a percent, the row being written and Skip; Minimized; the gear’s modes', async ({ extContext, connected: ext, routeLog, tailorit }) => {
  test.setTimeout(120_000);
  // A real form with required fields (v3 Phase 3 review), its resume slow to arrive: the Required list shows while it
  // fills.
  const snapshot = expectation(SNAPSHOT);
  routeLog.serve(routesFile(`fixtures/${SNAPSHOT}.routes.json`));
  await tailorit.scenario('resume-slow', { times: 1, delayMs: 30_000 });
  const page = await extContext.newPage();
  await page.goto(snapshot.source);
  const tabId = await ext.tabIdOf(page);
  await ext.frameWithForm(tabId);
  const panel = await sidePanel(ext, tabId);
  await panel.bringToFront();
  await shoot(panel, '20-side-panel-ready.png', 'Side panel before Autofill: the job, Autofill, the résumé');
  await panel.getByRole('button', { name: 'Autofill', exact: true }).click();
  await expect(panel.locator('li[data-current="true"]')).toBeVisible({ timeout: 20_000 });
  await shoot(panel, '21-side-panel-autofilling.png', 'Side panel: "Autofilling… NN%", the row being written');
  await expect(panel.locator('button[data-action="skip"]')).toBeVisible({ timeout: 10_000 });
  await shoot(panel, '22-side-panel-skip.png', 'Side panel: Skip on the field written for 2 s');
  await panel.locator('button[data-action="skip"]').click();
  expect((await ext.settled(tabId, { timeout: 30_000 })).status).toBe('review');
  await panel.bringToFront();
  await shoot(panel, '23-side-panel-after-skip.png', 'Side panel: the review after Skip, "N/M required fields filled | NN%"');

  await panel.locator('button[data-panel-settings]').click();
  await expect(panel.locator('[data-settings-view]')).toBeVisible();
  await panel.locator('input[data-setting="view.minimized"]').check();
  await shoot(panel, '24-side-panel-settings.png', 'Side panel: the Settings view, a change waiting for Save');
  await panel.locator('button[data-action="save-settings"]').click();
  await panel.locator('button[data-action="close-settings"]').click();
  await expect(panel.locator('button[data-action="toggle-fields"]')).toHaveAttribute('aria-expanded', 'false');
  await shoot(panel, '25-side-panel-minimized.png', 'Side panel: the Minimized view, the review folded to its line');
  await ext.data({ v: 1, type: 'settings/save', settings: DEFAULT_SETTINGS });
});

test('v3 Phase 3: the launcher’s tab at the page’s edge, its hide menu, an unsupported page, and the panel offering it back', async ({ extContext, connected: ext, routeLog }) => {
  const url = 'https://jobs.lever.co/tailorit-fixture/shots-edge/apply';
  routeLog.serve({ [url]: 'fixtures/synthetic/resume-upload.html' });
  const page = await extContext.newPage();
  await page.goto(url);
  const tabId = await ext.tabIdOf(page);
  await ext.frameWithForm(tabId);
  await still(page);
  const ui = await PageUi.of(page);
  await expect.poll(async () => (await ui.launcher())?.shown ?? false).toBe(true);
  await shoot(page, '26-launcher-edge.png', 'The launcher’s tab at the page’s right edge', {
    clip: await around(page, ui, ['[data-edge]'], 24) });
  await ui.clickButton('Hide the TailorIT button');
  await expect.poll(async () => (await ui.elements('[data-hide]')).filter((item) => item.shown).length).toBe(3);
  await shoot(page, '27-launcher-hide-menu.png', 'The launcher’s hide menu', {
    clip: await around(page, ui, ['[data-edge]', '[role="menu"]'], 24) });
  await ui.clickButton('Hide on this site');
  await ui.close();
  const panel = await sidePanel(ext, tabId);
  await expect(panel.locator('[data-launcher-hidden="site"]')).toBeVisible();
  await shoot(panel, '28-side-panel-launcher-hidden.png', 'Side panel: "Show the TailorIT button again"');
  await panel.getByRole('button', { name: 'Show the TailorIT button again', exact: true }).click();

  // A site the extension has no access to: the browser does not tell it the tab's address, so the tab is the new one.
  const tabIds = async () => (await ext.page()).evaluate(async () => (await (globalThis as unknown as {
    chrome: { tabs: { query(query: object): Promise<Array<{ id?: number }>> } } }).chrome.tabs.query({}))
    .flatMap((tab) => (tab.id === undefined ? [] : [tab.id])));
  const before = await tabIds();
  const elsewhere = await extContext.newPage();
  routeLog.serve({ 'https://www.example.org/careers': 'fixtures/synthetic/resume-upload.html' });
  await elsewhere.goto('https://www.example.org/careers');
  const otherTab = (await tabIds()).find((id) => !before.includes(id))!;
  const unsupported = await sidePanel(ext, otherTab);
  await expect(unsupported.locator('[data-unsupported]')).toBeVisible();
  await shoot(unsupported, '29-side-panel-unsupported.png', 'Side panel: "Autofill isn’t supported on this page"');
  await unsupported.locator('button[data-action="site-request"]').click();
  await expect(unsupported.locator('[data-site-request]')).toBeVisible();
  await shoot(unsupported, '29b-side-panel-site-request.png', 'Side panel: "Ask TailorIT to support this site", answered');
});

test('v3 Phase 4: the dock’s Submit, its question, Application submitted, and Continue to the next page', async ({ extContext, connected: ext, routeLog }) => {
  const GREENHOUSE = (id: string) => `https://job-boards.greenhouse.io/tailoritfixture/jobs/38${id}`;
  const filled = async (url: string, file: string) => {
    routeLog.serve({ [url]: file });
    const page = await extContext.newPage();
    await page.goto(url);
    const tabId = await ext.fill(page);
    expect((await ext.settled(tabId)).status).toBe('review');
    const panel = await sidePanel(ext, tabId);
    await panel.bringToFront();
    return { page, tabId, panel };
  };

  const ready = await filled(GREENHOUSE('01'), 'fixtures/synthetic/submit/greenhouse.html');
  const submit = ready.panel.locator('button[data-step-action="submit"]');
  await submit.scrollIntoViewIfNeeded();
  await shoot(ready.panel, '40-side-panel-submit.png', 'Side panel: the dock’s "Submit application" after a fill');
  await submit.click();
  await expect(ready.panel.locator('[data-submitted="recorded"]')).toBeVisible();
  await ready.panel.locator('[data-submitted]').scrollIntoViewIfNeeded();
  await shoot(ready.panel, '41-side-panel-submitted.png', 'Side panel: "Application submitted", with Open tracker');

  const empty = await filled(`${GREENHOUSE('02')}?badge`, 'fixtures/synthetic/submit/greenhouse.html');
  await empty.panel.locator('button[data-step-action="submit"]').click();
  await expect(empty.panel.locator('[data-step-confirm]')).toBeVisible();
  await empty.panel.locator('[data-step-confirm]').scrollIntoViewIfNeeded();
  await shoot(empty.panel, '42-side-panel-submit-confirm.png', 'Side panel: Submit while a required field is empty asks first');

  const url = WIZARD.url('shots');
  routeLog.serve({ [url]: WIZARD.file });
  const wizard = await extContext.newPage();
  await wizard.goto(url);
  const tabId = await ext.fill(wizard);
  await expect.poll(async () => (await ext.reports(tabId)).find((report) => report.frameId === 0)?.buttons?.next).toBe(true);
  const panel = await sidePanel(ext, tabId);
  await panel.bringToFront();
  const next = panel.locator('button[data-step-action="next"]');
  await next.scrollIntoViewIfNeeded();
  await shoot(panel, '43-side-panel-next.png', 'Side panel: the dock’s "Continue to the next page" on a step not the last');
});

test('v3 Phase 3b: another job, the resume’s preview, without resume, the profile editor, a posting page', async ({ extContext, connected: ext, routeLog }) => {
  const another = await cardPanel(ext, await extContext.newPage(), routeLog, CARD_APPLY('101'));
  await expect(another.card).toHaveAttribute('data-job-state', 'found');
  await another.panel.locator('button[data-job-action="another"]').click();
  await expect(another.panel.locator('button[data-job-choice]').first()).toBeVisible();
  await shoot(another.panel, '44-job-card-another-job.png', 'Job card: "Autofill for another job", the tracked jobs to choose from');
  await another.panel.locator('button[data-job-choice="j0"]').click();
  await expect(another.card.locator('[data-job-chosen]')).toBeVisible();
  await shoot(another.panel, '44b-job-card-chosen.png', 'Job card: another job chosen, with "Use this page’s own job"');

  const preview = await cardPanel(ext, await extContext.newPage(), routeLog, CARD_APPLY('102'));
  await preview.panel.locator('button[data-job-action="preview"]').click();
  await expect(preview.panel.locator('iframe[data-preview-frame]')).toBeVisible();
  await shoot(preview.panel, '45-job-card-preview.png', 'Job card: the resume’s preview, in the side panel');

  const without = await cardPanel(ext, await extContext.newPage(), routeLog, CARD_APPLY('103'));
  await without.panel.locator('button[data-job-action="change"]').click();
  await expect(without.panel.locator('button[data-resume-choice="without"]')).toBeVisible();
  await shoot(without.panel, '46-job-card-change-without.png', 'Job card: Change, with "Apply without resume"');
  await without.panel.locator('button[data-resume-choice="without"]').click();
  await expect(without.panel.locator('[data-job-resume][data-without-resume]')).toBeVisible();
  await shoot(without.panel, '46b-job-card-without-resume.png', 'Job card: applying without a resume');

  const profile = await cardPanel(ext, await extContext.newPage(), routeLog, CARD_APPLY('104'));
  await profile.panel.locator('button[data-panel-settings]').click();
  await profile.panel.locator('[data-settings-view] button[data-open-profile]').click();
  const editor = profile.panel.locator('[data-profile]');
  await expect(editor).toBeVisible();
  await shoot(profile.panel, '47-side-panel-profile.png', 'Side panel: "Your autofill information"');
  await editor.getByRole('textbox', { name: 'Anything else we should know?' }).fill('I prefer remote work.\nMy visa expires in May.');
  await editor.locator('button[data-profile-save]').click();
  await expect(editor.locator('[data-profile-flagged]')).toBeVisible();
  await editor.locator('[data-profile-flagged]').scrollIntoViewIfNeeded();
  await shoot(profile.panel, '47b-side-panel-profile-saved.png', 'Side panel: the profile saved, the note’s line kept from the AI named');

  const posting = 'https://jobs.lever.co/tailorit-fixture/00000000-0000-4000-8000-00000000c105';
  routeLog.serve({ [posting]: 'fixtures/synthetic/policy-posting.html' });
  const page = await extContext.newPage();
  await page.goto(posting);
  const panel = await sidePanel(ext, await ext.tabIdOf(page));
  await panel.bringToFront();
  await expect(panel.locator('[data-job-card]')).toHaveAttribute('data-job-state', 'found');
  await shoot(panel, '48-side-panel-posting.png', 'Side panel: a posting page with no form, its card without Autofill');
});

test('the v3 Phase 4 review: the disclosure shown again when it changed', async ({ extContext, connected: ext, routeLog }) => {
  const setDisclosure = async (version: number) => (await ext.page()).evaluate(async (value) => {
    await (globalThis as unknown as { chrome: { storage: { local: { set(items: object): Promise<void> } } } }).chrome
      .storage.local.set({ disclosure: { version: value } });
  }, version);
  await setDisclosure(1);
  const shown = await cardPanel(ext, await extContext.newPage(), routeLog, CARD_APPLY('120'));
  await expect(shown.panel.locator('[data-disclosure-changed]')).toBeVisible();
  await shoot(shown.panel, '50-side-panel-disclosure-changed.png', 'Side panel: the disclosure shown again, with I understand');
  await setDisclosure(DISCLOSURE_VERSION);
});

test('v3 Phase 5: Auto-apply in the options page and the side panel', async ({ extContext, connected: ext, routeLog, tailorit }) => {
  expect(tailorit).toBe(mock);
  const options = await extContext.newPage();
  await options.setViewportSize({ width: 1000, height: 900 });
  await still(options);
  await options.goto(ext.url('options.html'));
  const card = options.locator('[data-card="agent"]');
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator('[data-agent-line]')).toBeVisible();
  await shoot(options, '51-options-auto-apply-off.png', 'Options › Auto-apply: off',
    { clip: (await card.boundingBox()) ?? undefined });
  // A job whose page never shows a form keeps the agent running while the pictures are taken.
  const job = 'https://job-boards.greenhouse.io/tailoritfixture/jobs/5101';
  routeLog.serve({ [job]: { body: '<!doctype html><title>Loading</title><p>Loading…</p>', contentType: 'text/html; charset=utf-8' } });
  await mock.queueAgent([{ id: '00000051-aaaa-4bbb-8ccc-000000005101', jobId: 5101, url: job, company: 'Northwind',
    title: 'Senior Backend Engineer', resumeId: null }]);
  await card.locator('input[data-setting="agent.on"]').click();
  const confirm = card.locator('[data-agent-confirm]');
  if (await confirm.isVisible()) {
    await shoot(options, '52-options-auto-apply-confirm.png', 'Options › Auto-apply: the one-time confirmation',
      { clip: (await card.boundingBox()) ?? undefined });
    await card.locator('button[data-action="agent-confirm"]').click();
  }
  await expect(card.locator('[data-agent="running"]')).toBeVisible({ timeout: 30_000 });
  await options.bringToFront();
  await shoot(options, '53-options-auto-apply-running.png', 'Options › Auto-apply: running a job, with Stop',
    { clip: (await card.boundingBox()) ?? undefined });
  const shown = await cardPanel(ext, await extContext.newPage(), routeLog, CARD_APPLY('151'));
  await expect(shown.panel.locator('[data-agent="running"]')).toBeVisible();
  await shoot(shown.panel, '54-side-panel-auto-apply.png', 'Side panel: "Auto-apply: running … · N done today", Stop');
  await shown.panel.locator('button[data-action="agent-stop"]').click();
  await expect(shown.panel.locator('[data-agent]')).toHaveCount(0);
  await options.close();
});

test('v3 Phase 5: Sign-in Auto signing in on a sign-in page, and Modes with Sign-in and the skip rules', async ({ extContext, connected: ext, routeLog }) => {
  const options = await extContext.newPage();
  await options.setViewportSize({ width: 1000, height: 1400 });
  await still(options);
  await options.goto(ext.url('options.html'));
  const signIn = options.locator('[data-setting-group="modes.signIn"]');
  await signIn.scrollIntoViewIfNeeded();
  await shoot(options, '55-options-sign-in-blocked.png', 'Modes › Sign-in: Auto needs the sign-in permission',
    { clip: (await signIn.boundingBox()) ?? undefined });
  const skips = options.locator('[data-setting-group="modes.agentSkip"]');
  await skips.scrollIntoViewIfNeeded();
  await shoot(options, '56-options-skip-rules.png', 'Modes › Auto-apply leaves a job for you when',
    { clip: (await skips.boundingBox()) ?? undefined });
  // A run paused at a sign-in with Sign-in on Manual: the review says it is the person's.
  const page = await extContext.newPage();
  const url = 'https://tailoritfixture.taleo.net/careersection/ex/jobapply.ftl?job=login&lang=en';
  routeLog.serve({ [url]: 'fixtures/synthetic/signin/sign-in.html' });
  await page.goto(url);
  // A plain Autofill (the page's own launcher's): the panel's button at this wall would sign up.
  const tabId = await ext.fill(page, { plain: true });
  await ext.settled(tabId);
  const panel = await sidePanel(ext, tabId);
  // v4 ui (D10): what the sign-in asks is the page's notification; the panel's main button goes on (or signs up), once
  // shown long enough to take a click (the v4 review, L4).
  await expect(panel.locator('button.tia-cta')).toBeEnabled();
  await shoot(panel, '57-side-panel-sign-in-manual.png', 'Side panel: a sign-in page, Sign-in on Manual');
});

test('v3 Phase 3b: Edit with AI’s instruction box, on the page', async ({ extContext, connected: ext, routeLog }) => {
  const served = trap('01');
  routeLog.serve({ [served.url]: served.file });
  const page = await extContext.newPage();
  await page.goto(served.url);
  const tabId = await ext.fill(page);
  await ext.settled(tabId);
  await page.bringToFront();
  await still(page);
  const ui = await PageUi.of(page);
  const why = await page.locator('#why').boundingBox();
  await expect.poll(async () => (await ui.elements('button[aria-label="Edit with AI"]')).filter((el) => el.shown).length)
    .toBeGreaterThanOrEqual(1);
  for (const button of (await ui.elements('button[aria-label="Edit with AI"]')).filter((el) => el.shown)) {
    const box = await ui.box(button);
    if (box !== null && why !== null && box.y >= why.y && box.y + box.height <= why.y + why.height) {
      await ui.click(button);
      break;
    }
  }
  await expect.poll(async () => (await ui.elements('textarea.ai-prompt__input')).filter((el) => el.shown).length).toBe(1);
  await page.keyboard.type('Make it two sentences');
  await shoot(page, '49-ai-edit-instruction.png', 'Edit with AI: "Tell me what to add, change or improve"', {
    clip: await around(page, ui, ['textarea.ai-prompt__input', 'button.ai-prompt__generate'], 48) });
});

test('the options page', async ({ extContext, connected: ext }) => {
  const options = await extContext.newPage();
  await options.setViewportSize({ width: 1000, height: 900 });
  await still(options);
  await options.goto(ext.url('options.html'));
  await expect(options.locator('h1')).toBeVisible();
  await expect(options.locator('[data-card="panel"]')).toBeVisible();
  await shoot(options, '07-options.png', 'The options page', { fullPage: true });
  await options.locator('[data-card="modes"]').scrollIntoViewIfNeeded();
  await shoot(options, '07b-options-modes.png', 'The options page: Modes', {
    clip: (await options.locator('[data-card="modes"]').boundingBox()) ?? undefined });
});

test('v4 ui: the set-up view, not connected, and its first step\'s disclosure', async ({ extContext, connected: ext, routeLog }) => {
  const page = await extContext.newPage();
  const { tabId } = await cardPanel(ext, page, routeLog, CARD_APPLY('099'));
  await ext.data({ v: 1, type: 'auth/disconnect' });
  const panel = await sidePanel(ext, tabId);
  await panel.reload();
  await expect(panel.locator('[data-setup]')).toBeVisible();
  await still(panel);
  await shoot(panel, '30-setup-view.png', 'Side panel, not connected: the set-up view');
  await panel.locator('button[data-step-action="account"]').click();
  await expect(panel.locator('[data-consent]')).toBeVisible();
  await shoot(panel, '31-setup-consent.png', 'Set-up view: what connecting means, before Connect');
});
