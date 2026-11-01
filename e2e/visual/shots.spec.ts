/*
 * The look, captured for a person to compare (`npm run shots`, never part of verify; playwright.config.ts adds this
 * project only with TIA_SHOTS=1): the e2e build against the TailorIT mock, each surface in the state it is meant for,
 * into e2e/artifacts/shots (git-ignored), with an index.html that shows them side by side. When TIA_SHOTS_REFERENCE
 * names a folder of reference pictures on this computer, the index shows them too, by their file: address; nothing of
 * them enters the repo.
 * - The side panel at 400 px: before Autofill, a real form's review, a trap's review that needs the person, a row
 *   opened, the policy card, and the review again under a dark system scheme (it stays light).
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

const OUT = resolve('e2e/artifacts/shots');
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
  await expect(panel.locator('[data-completion]')).toBeVisible();
  await shoot(panel, '02-side-panel-review.png', 'Side panel, a real form reviewed (top)');
  await shoot(panel, '02b-side-panel-review-full.png', 'Side panel, a real form reviewed (whole page)', { fullPage: true });
  const folded = panel.locator('li[data-layout="line"] summary').first();
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

test('the options page', async ({ extContext, connected: ext }) => {
  const options = await extContext.newPage();
  await options.setViewportSize({ width: 1000, height: 900 });
  await still(options);
  await options.goto(ext.url('options.html'));
  await expect(options.locator('h1')).toBeVisible();
  await expect(options.locator('[data-card="panel"]')).toBeVisible();
  await shoot(options, '07-options.png', 'The options page', { fullPage: true });
});
