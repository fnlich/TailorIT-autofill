/*
 * The look, captured for a person to compare (`npm run shots`, never part of verify; playwright.config.ts adds this
 * project only with TIA_SHOTS=1): the e2e build against the TailorIT mock, each surface in the state it is meant for,
 * into e2e/artifacts/shots (git-ignored), with an index.html that shows them side by side. When TIA_SHOTS_REFERENCE
 * names a folder of reference pictures on this computer, the index shows them too, by their file: address; nothing of
 * them enters the repo.
 * - The side panel at 400 px: before Autofill, a real form's review, a trap's review that needs the person, a row
 *   opened, the policy card, and the review again under a dark system scheme (it stays light).
 * - v3 Phase 3 (Jobright's layout): "Autofilling… NN%" with the row being written and Skip (a slow resume), the
 *   Minimized view, the gear's menu of modes, a page Autofill does not work on, the launcher's tab at the page's edge
 *   with its hide menu, and the panel offering it back.
 * - v2: the job card found, not found with Add, already applied, loading, unavailable, a dry run's "Would attach", the
 *   resume picker, and a custom question answered.
 * - Phase G: the job card's cover-letter row: "Written by AI when the form asks for one" with Write it now, Writing…,
 *   then Ready; the person's own letter; and a fill's review with the letter attached, marked "AI".
 * - The page's own UI: the launcher at rest and at review, its notices and the policy card, the in-page panel open.
 * - The options page.
 * Every capture is in the light scheme with reduced motion and animations stopped, so a picture is the same each time.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../../src/core/types/settings';
import { expect, test } from '../fixtures.ts';
import type { Extension } from '../helpers/extension.ts';
import { expectation } from '../helpers/labels.ts';
import { PageUi } from '../helpers/page-ui.ts';
import { trap } from '../helpers/traps.ts';
import { routesFile } from '../routes.ts';

/** e2e/artifacts/shots, from this file's own folder: never from wherever the run was started (it is emptied first). */
const OUT = resolve(import.meta.dirname, '..', 'artifacts', 'shots');
const PANEL_VIEWPORT = { width: 400, height: 860 } as const;
const SNAPSHOT = 'lever/spotify-ny';
const STORED_COPY_APPLY = 'https://jobs.lever.co/tailorit-fixture/00000000-0000-4000-8000-0000000a0f01/apply';

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

test("the side panel: before Autofill, a real form's review, a row opened, and the dark scheme", async ({ extContext, connected: ext, routeLog }) => {
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
  const folded = panel.locator('li[data-layout="line"] button.tia-row__toggle').first();
  await folded.click();
  await folded.scrollIntoViewIfNeeded();
  await shoot(panel, '02c-side-panel-row-open.png', 'Side panel, a folded row opened');
  await panel.evaluate(() => window.scrollTo(0, 0));
  await still(panel, 'dark');
  await shoot(panel, '09-side-panel-dark-scheme.png', 'Side panel under a dark system scheme: it stays light');
  await still(panel);
});

test("the side panel: a trap's review, with what needs the person", async ({ extContext, connected: ext, routeLog }) => {
  const served = trap('01');
  routeLog.serve({ [served.url]: served.file });
  const page = await extContext.newPage();
  await page.goto(served.url);
  const tabId = await ext.fill(page);
  expect((await ext.settled(tabId)).status).toBe('review');
  const panel = await sidePanel(ext, tabId);
  await panel.bringToFront();
  await expect(panel.locator('[data-notice="tripwire"]')).toBeVisible();
  await shoot(panel, '03-side-panel-needs-you.png', 'Side panel, a review that needs the person (trap 01)', { fullPage: true });

  // The page's own UI after it: the launcher at review, its badge, and the notices.
  const ui = await PageUi.of(page);
  await still(page);
  await page.bringToFront();
  await expect.poll(async () => (await ui.launcher())?.attributes['data-state']).toBe('review');
  await shoot(page, '05b-launcher-review.png', 'Launcher at review, its count in the badge',
    { clip: await around(page, ui, ['button.launcher'], 44) });
  await shoot(page, '08-page-notices.png', 'The page’s notices under the launcher',
    { clip: await around(page, ui, ['button.launcher', '.notice']) });
  await ui.close();
});

test('the policy card, in the side panel and on the page', async ({ extContext, connected: ext, routeLog, tailorit }) => {
  // The card is the "Ask me" choice for a posting that forbids AI (the default fills from the profile only).
  await ext.data({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
    llm: { ...DEFAULT_SETTINGS.llm, whenForbidden: 'ask' } } });
  try {
    await tailorit.scenario('lookup-posting-text');
    routeLog.serve({ [STORED_COPY_APPLY]: 'fixtures/synthetic/policy-apply.html' });
    const page = await extContext.newPage();
    await page.goto(STORED_COPY_APPLY);
    const tabId = await ext.fill(page);
    expect((await ext.settled(tabId)).status).toBe('policy-notice');
    const panel = await sidePanel(ext, tabId);
    await panel.bringToFront();
    await expect(panel.locator('[data-notice="policy"] button')).toHaveCount(2);
    await shoot(panel, '04-side-panel-policy.png', 'Side panel, a run waiting at the policy card');

    const ui = await PageUi.of(page);
    await still(page);
    await page.bringToFront();
    await expect.poll(async () => ui.policyCardShown()).toBe(true);
    await shoot(page, '08b-page-policy-card.png', 'The page’s policy card under the launcher',
      { clip: await around(page, ui, ['button.launcher', '[role="alertdialog"]']) });
    await ui.close();
  } finally {
    await ext.data({ v: 1, type: 'settings/save', settings: DEFAULT_SETTINGS });
  }
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
  await shoot(found.panel, '10-job-card-found.png', 'Job card: found, with its match and the resume it attaches');
  await found.card.getByRole('button', { name: 'Change', exact: true }).click();
  await expect(found.panel.locator('[data-resume-choice=""]').first()).toBeVisible();
  await shoot(found.panel, '10b-job-card-change.png', 'Job card: Change, the resumes to choose from');

  await tailorit.scenario('lookup-not-found');
  const missing = await cardPanel(ext, await extContext.newPage(), routeLog, CARD_APPLY('002'));
  await expect(missing.card).toHaveAttribute('data-job-state', 'not-found');
  await shoot(missing.panel, '11-job-card-not-found.png', 'Job card: not in TailorIT, with Add this job to TailorIT');
  await tailorit.reset();

  await tailorit.scenario('lookup-applied');
  const applied = await cardPanel(ext, await extContext.newPage(), routeLog, CARD_APPLY('003'));
  await expect(applied.card.locator('[data-job-warning]')).toBeVisible();
  await shoot(applied.panel, '12-job-card-applied.png', 'Job card: already applied, closed and archived');
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

test('the job card in a dry run, and a custom question answered', async ({ extContext, connected: ext, routeLog }) => {
  const page = await extContext.newPage();
  const { tabId, panel, card } = await cardPanel(ext, page, routeLog, CARD_APPLY('006'));
  await ext.fill(page, { dryRun: true });
  expect((await ext.settled(tabId, { mode: 'dry-run' })).status).toBe('review');
  await panel.bringToFront();
  await expect(card).toContainText('Would attach');
  await shoot(panel, '15-job-card-dry-run.png', 'Job card in a dry run: "Would attach"', { fullPage: true });

  await panel.getByText('Ask a custom question', { exact: true }).click();
  await panel.getByLabel('Your question').fill('Why do you want to work at Northwind?');
  await panel.getByRole('button', { name: 'Get answer', exact: true }).click();
  const answer = panel.locator('[data-ask-answer]');
  await expect(answer).toBeVisible();
  await answer.scrollIntoViewIfNeeded();
  await shoot(panel, '16-custom-question.png', 'Ask a custom question, answered from the resume the card attaches');
});

test('the cover letter on the job card, and attached in a review', async ({ extContext, connected: ext, routeLog, tailorit }) => {
  const COVER = (name: string) => `https://jobs.lever.co/tailorit-fixture/cover-shot-${name}/apply`;
  const serve = (url: string) => routeLog.serve({ [url]: 'fixtures/synthetic/cover-letter-upload.html' });
  const open = async (url: string) => {
    serve(url);
    const page = await extContext.newPage();
    await page.goto(url);
    const tabId = await ext.tabIdOf(page);
    await ext.frameWithForm(tabId);
    const panel = await sidePanel(ext, tabId);
    await panel.bringToFront();
    return { page, tabId, panel, letter: panel.locator('[data-job-letter]') };
  };

  const none = await open(COVER('none'));
  await expect(none.letter).toHaveAttribute('data-letter-outcome', 'none');
  await none.letter.scrollIntoViewIfNeeded();
  await shoot(none.panel, '17-cover-letter-row.png', 'Job card: the cover letter, written by AI when the form asks, with Write it now');
  await tailorit.scenario('letter-generating-then-ready', { times: 1, delayMs: 6_000 });
  await none.letter.getByRole('button', { name: 'Write it now' }).click();
  await expect(none.letter.getByRole('button', { name: 'Writing…' })).toBeVisible();
  await shoot(none.panel, '17b-cover-letter-writing.png', 'Job card: Write it now, Writing…');
  await expect(none.letter).toHaveAttribute('data-letter-outcome', 'written', { timeout: 20_000 });
  await shoot(none.panel, '17c-cover-letter-ready.png', 'Job card: the cover letter written, Ready');
  await tailorit.reset();

  await tailorit.scenario('letter-ready');
  const own = await open(COVER('own'));
  await expect(own.letter).toHaveAttribute('data-letter-outcome', 'yours');
  await shoot(own.panel, '17d-cover-letter-yours.png', "Job card: the person's own letter for this job");
  await tailorit.reset();

  const filled = await open(COVER('filled'));
  await ext.fill(filled.page);
  expect((await ext.settled(filled.tabId)).status).toBe('review');
  await filled.panel.bringToFront();
  const row = filled.panel.locator('.tia-row', { hasText: 'Cover letter' }).first();
  await expect(row).toHaveAttribute('data-status', 'verified');
  await row.scrollIntoViewIfNeeded();
  await shoot(filled.panel, '17e-cover-letter-review.png', 'Review: the cover letter attached, marked "AI"');
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
  await shoot(panel, '20-side-panel-ready.png', 'Side panel before Autofill: the job, Autofill, what the fill uses');
  await panel.getByRole('button', { name: 'Autofill', exact: true }).click();
  await expect(panel.locator('li[data-current="true"]')).toBeVisible({ timeout: 20_000 });
  await shoot(panel, '21-side-panel-autofilling.png', 'Side panel: "Autofilling… NN%", the row being written');
  await expect(panel.locator('button[data-action="skip"]')).toBeVisible({ timeout: 10_000 });
  await shoot(panel, '22-side-panel-skip.png', 'Side panel: Skip on the field written for 2 s');
  await panel.locator('button[data-action="skip"]').click();
  expect((await ext.settled(tabId, { timeout: 30_000 })).status).toBe('review');
  await panel.bringToFront();
  await shoot(panel, '23-side-panel-after-skip.png', 'Side panel: the review after Skip, "N of M required fields filled · NN%"');

  await panel.locator('button[data-panel-menu]').click();
  await expect(panel.locator('[data-menu]')).toBeVisible();
  await shoot(panel, '24-side-panel-modes.png', 'Side panel: the gear’s menu, the modes');
  await panel.locator('input[data-setting="view.minimized"]').check();
  await panel.locator('button[data-panel-menu]').click();
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
