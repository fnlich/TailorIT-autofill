/*
 * A dependent option list that loads asynchronously, end to end (docs/SPEC.md Requirement D: "Wait until options are
 * populated before matching"; docs/design/runtime.md §7.1 and §11.e). fixtures/synthetic/async-options/index.html
 * says what the page does in each variant; each is served at its own address, so each test has an application of its
 * own. The golden profile chooses the United States, whose states then load:
 * - after 400 ms and after 1200 ms (the plan's range): Texas is chosen once the states are there, never before, and
 *   the page settled (no page-busy notice);
 * - never (the request never answers; the list's own busy signs stay): the state is flagged options-never-loaded
 *   within OPTIONS_CAP_MS plus 1 s of the request, with no page-busy notice, and the run completes;
 * - a request that fails (the busy signs clear and the list keeps its placeholder only): flagged options-never-loaded
 *   the same way;
 * - a page that stays busy (aria-busy on the form, a progress bar outside any one list's field): the settle's cap is
 *   hit, the page-busy notice shows, and the state is left for the person;
 * - then assertTrapInvariants.
 * It waits for Phase 3's wave 2: the content runtime's loop with settle() and awaitOptions() (src/dom/settle.ts,
 * src/dom/await-options.ts). Phase 2's single pass plans the state while it holds only its placeholder.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { OPTIONS_CAP_MS, SETTLE_CAP_MS } from '../../src/dom/thresholds';
import type { FrameReport } from '../../src/shared/report';
import { expect, test } from '../fixtures.ts';
import type { ConsoleEntry } from '../helpers/console.ts';
import { applicationKeyOf, noticeCount, row, rowOf, type Extension } from '../helpers/extension.ts';
import { GOLDEN } from '../helpers/golden.ts';
import { assertTrapInvariants } from '../helpers/invariants.ts';
import { eventsOn, selectedTexts } from '../helpers/page-state.ts';
import { ASYNC, type AsyncVariant, pageCounter, syntheticLabels, writesOn } from '../helpers/reactive.ts';
import type { RouteLog } from '../routes.ts';

const LABELS = syntheticLabels(ASYNC.expectations);
/** How late the options arrive, per the page's header. */
const ARRIVES_AFTER_MS = { fast: 400, slow: 1200 } as const;

interface Run {
  extContext: BrowserContext;
  ext: Extension;
  routeLog: RouteLog;
  logs: () => ConsoleEntry[];
}

interface Filled {
  url: string;
  page: Page;
  tabId: number;
  report: FrameReport;
  /** Every report version the worker pushed for the tab, in order (frame 0's). */
  versions: FrameReport[];
}

/** Serves a variant at its address, fills it from the side panel and waits for its report to rest, following every
 *  version the worker pushes on the way. */
async function fillVariant(variant: AsyncVariant, run: Run): Promise<Filled> {
  const url = ASYNC.url(variant);
  run.routeLog.serve({ [url]: ASYNC.file });
  const page = await run.extContext.newPage();
  await page.goto(url);
  const pushed = await run.ext.watchReports(await run.ext.tabIdOf(page));
  const tabId = await run.ext.fill(page);
  const report = await run.ext.settled(tabId);
  const versions = (await pushed()).flat().filter((version) => version.frameId === 0);
  return { url, page, tabId, report, versions };
}

async function invariants(filled: Filled, run: Run): Promise<void> {
  await assertTrapInvariants({ page: filled.page, ext: run.ext, tabId: filled.tabId, routeLog: run.routeLog,
    console: run.logs(), markers: [], canaries: [], labels: LABELS, applicationKey: applicationKeyOf(filled.url) });
}

/** The page's own Date.now() when the last options request started (the Country write's change). */
async function requestedAt(page: Page): Promise<number> {
  const at = await pageCounter(page, '__optionsRequestedAt');
  expect(at, 'the Country write started a request').not.toBeNull();
  return at!;
}

/** The fields before the state: written from the profile, Country included, so the request did start; verified too,
 *  unless the pass stopped at the settle's cap before reading them back. */
async function contactAndCountry(filled: Filled, options: { verified: boolean } = { verified: true }): Promise<void> {
  for (const label of ['Full name', 'Email', 'Country']) {
    expect(row(filled.report, label), label).toMatchObject({ provenance: 'profile', wrote: true,
      ...(options.verified ? { status: 'verified' } : {}) });
  }
  await expect(filled.page.locator('#name')).toHaveValue(GOLDEN.full);
  await expect(filled.page.locator('#country')).toHaveValue('US');
  expect(await pageCounter(filled.page, '__optionsRequests')).toBe(1);
}

/** The never-loading cases: the state flagged options-never-loaded within the cap plus 1 s of the request (the first
 *  report version showing it), nothing chosen and nothing written, no busy page, and the run completed. */
async function neverLoaded(filled: Filled): Promise<void> {
  expect(filled.report.status).toBe('review');
  await contactAndCountry(filled);
  expect(row(filled.report, 'State')).toMatchObject({ category: 'address.region', status: 'flagged',
    reason: 'options-never-loaded', wrote: false, provenance: null });
  await expect(filled.page.locator('#state')).toHaveValue('');
  expect(await eventsOn(filled.page, '#state')).toEqual([]);
  expect(noticeCount(filled.report, 'page-busy')).toBe(0);
  const flagged = [...filled.versions, filled.report]
    .find((version) => rowOf(version, 'State')?.reason === 'options-never-loaded');
  expect(flagged, 'a report version with the state flagged').toBeDefined();
  const elapsed = flagged!.updatedAt - await requestedAt(filled.page);
  // Kept in the test's annotations, so a run shows how close it came to the bound.
  test.info().annotations.push({ type: 'flagged after (ms)', description: String(elapsed) });
  expect(elapsed, 'flagged within the cap plus 1 s').toBeLessThanOrEqual(OPTIONS_CAP_MS + 1_000);
}

test.describe('a dependent list whose options load asynchronously', () => {
  for (const variant of ['fast', 'slow'] as const) {
    test(`options that arrive after ${ARRIVES_AFTER_MS[variant]} ms: the state matches once they are there`, async ({ extContext, connected: ext, routeLog, logs }) => {
      const run = { extContext, ext, routeLog, logs };
      const filled = await fillVariant(variant, run);
      expect(filled.report.status).toBe('review');
      await contactAndCountry(filled);
      expect(row(filled.report, 'State')).toMatchObject({ category: 'address.region', status: 'verified',
        provenance: 'profile', wrote: true });
      expect(await selectedTexts(filled.page, '#state')).toEqual(['Texas']);
      // Matched and written once, after the list had loaded: never against "Loading..." or the placeholder.
      expect(await writesOn(filled.page, '#state')).toBe(1);
      const loadedAt = await pageCounter(filled.page, '__optionsSettledAt');
      expect(loadedAt, 'the states arrived').not.toBeNull();
      const writes = (await eventsOn(filled.page, '#state')).filter((event) => !event.trusted);
      expect(writes.every((event) => event.at >= loadedAt!), 'written only after the states arrived').toBe(true);
      // The page's own delay, give or take its clock's millisecond rounding.
      expect(loadedAt! - await requestedAt(filled.page)).toBeGreaterThanOrEqual(ARRIVES_AFTER_MS[variant] - 5);
      // The state was planned in a later pass than the Country write, and the page settled: no busy notice.
      expect(filled.report.counters.passes).toBeGreaterThanOrEqual(2);
      expect(noticeCount(filled.report, 'page-busy')).toBe(0);
      await invariants(filled, run);
    });
  }

  test('options that never load: options-never-loaded within the cap plus 1 s, and the run completes', async ({ extContext, connected: ext, routeLog, logs }) => {
    const run = { extContext, ext, routeLog, logs };
    const filled = await fillVariant('never', run);
    await neverLoaded(filled);
    // The list's own busy signs are still up: they never made the page busy.
    await expect(filled.page.locator('#state-progress')).toBeVisible();
    await invariants(filled, run);
  });

  test('a request that fails, leaving the placeholder only: options-never-loaded, and the page is not busy', async ({ extContext, connected: ext, routeLog, logs }) => {
    const run = { extContext, ext, routeLog, logs };
    const filled = await fillVariant('failed', run);
    await neverLoaded(filled);
    await expect(filled.page.locator('#state-status')).not.toBeEmpty();
    await invariants(filled, run);
  });

  test('a page that stays busy: the settle cap is hit and the page-busy notice shows', async ({ extContext, connected: ext, routeLog, logs }) => {
    const run = { extContext, ext, routeLog, logs };
    const filled = await fillVariant('page-busy', run);
    expect(noticeCount(filled.report, 'page-busy')).toBe(1);
    await contactAndCountry(filled, { verified: false });
    // The run waited the whole cap after the Country write before it stopped.
    expect(filled.report.updatedAt - await requestedAt(filled.page)).toBeGreaterThanOrEqual(SETTLE_CAP_MS - 100);
    // The states did arrive, but the pass stopped at the cap: the state is left for the person, unwritten.
    await expect(filled.page.locator('#state option[value="TX"]')).toHaveCount(1);
    expect(row(filled.report, 'State')).toMatchObject({ category: 'address.region', status: 'flagged', reason: 'page-busy',
      wrote: false, provenance: null });
    await expect(filled.page.locator('#state')).toHaveValue('');
    expect(await writesOn(filled.page, '#state')).toBe(0);
    await invariants(filled, run);
  });
});
