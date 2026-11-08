/*
 * v5 p1-shell (PLAN decisions 1, 2 and 8; Jobright's sidebar, read for behaviour only), end to end in the real browser:
 * with the defaults ("Where the panel shows: On the page", "Default view: Expanded") a supported page opens the sidebar
 * by itself: the worker runs the sidebar's bundle in the tab's top frame (sidebar/load), whose views (the side panel's)
 * ask the worker over that frame's content channel and watch the tab on its port. The page is pushed left by the
 * sidebar's width, the honeypots untouched (trap 04's spies). The person's Autofill in the sidebar fills the form, the
 * rows come into the sidebar's review, the header's minimise folds it back to the pill, whose click opens it again; no
 * side panel is ever asked for. Replaces the in-page card's spec: the top frame's panel on the page is the sidebar now
 * (the card stays a frame inside another page's: src/content/ui/panel.browser.test.ts).
 */
import { COPY } from '../../src/shared/copy';
import { SIDEBAR_WIDTH_PX } from '../../src/shared/sidebar';
import { PRODUCT_SETTINGS } from '../helpers/settings.ts';
import { expect, test } from '../fixtures.ts';
import type { ConsoleEntry } from '../helpers/console.ts';
import { applicationKeyOf } from '../helpers/extension.ts';
import { assertTrapInvariants } from '../helpers/invariants.ts';
import { PageUi } from '../helpers/page-ui.ts';
import { spyRecord } from '../helpers/spies.ts';
import { trap } from '../helpers/traps.ts';

const said = (entries: readonly ConsoleEntry[], source: ConsoleEntry['source'], code: string) =>
  entries.filter((entry) => entry.source === source && entry.text.includes(`[tailorit-autofill] ${code}`)).length;

test('the sidebar opens by itself on the page, pushes it, fills from its Autofill, and folds back to the pill', async ({ extContext, connected: ext, routeLog, logs }) => {
  // The product's own defaults: On the page, Expanded (the suite's own start minimized: helpers/settings.ts).
  await ext.data({ v: 1, type: 'settings/save', settings: PRODUCT_SETTINGS });
  const served = trap('04');
  routeLog.serve({ [served.url]: served.file });
  const page = await extContext.newPage();
  await page.goto(served.url);
  const tabId = await ext.tabIdOf(page);
  await ext.frameWithForm(tabId);
  // In front, as a person's page is: a page behind another draws (and slides) nothing, and is seen by no one.
  await page.bringToFront();
  const ui = await PageUi.of(page);

  // It opens by itself: the bundle ran in the top frame, and its views drew the side panel's main view.
  await expect.poll(async () => (await ui.elements('[data-sidebar]'))[0]?.shown ?? false,
    { message: 'the sidebar never opened' }).toBe(true);
  expect(said(logs(), 'worker', 'sidebar.injected')).toBe(1);
  await expect.poll(async () => (await ui.elements('[data-sidebar] main[data-view="main"]')).length,
    { message: 'the sidebar never showed the main view' }).toBe(1);
  const [frame] = await ui.elements('[data-sidebar]');
  expect(await ui.style(frame!, ['width', 'background-color', 'position'])).toEqual({ width: `${SIDEBAR_WIDTH_PX}px`,
    'background-color': 'rgb(255, 255, 255)', position: 'fixed' });
  const edgeX = await page.evaluate(() => document.documentElement.clientWidth);
  // Slid in: docked at the right edge, from top to bottom.
  await expect.poll(async () => {
    const box = (await ui.box(frame!))!;
    return [Math.round(box.x + box.width), Math.round(box.y), Math.round(box.height)];
  }).toEqual([edgeX, 0, page.viewportSize()!.height]);
  // The page pushed left; the pill hidden meanwhile.
  expect(await page.evaluate(() => getComputedStyle(document.body).paddingRight)).toBe(`${SIDEBAR_WIDTH_PX}px`);
  expect((await ui.launcher())?.shown).toBe(false);

  // The person's Autofill in the sidebar fills the form; the rows come into the sidebar's review.
  await expect.poll(async () => (await ui.elements('[data-sidebar] button[data-main-action="fill"]'))[0]
    ?.attributes.disabled === undefined, { message: 'no Autofill in the sidebar' }).toBe(true);
  // Read again just before the click: every read of the root names its nodes afresh.
  const [main] = await ui.elements('[data-sidebar] button[data-main-action="fill"]');
  await ui.click(main!);
  const report = await ext.settled(tabId);
  expect(report.status).toBe('review');
  const shownRows = report.fields.filter((row) => row.wrote).map((row) => row.key);
  expect(shownRows.length).toBeGreaterThan(0);
  await expect.poll(async () => (await ui.elements('[data-sidebar] li[data-field-key]'))
    .map((row) => row.attributes['data-field-key'])).toEqual(expect.arrayContaining(shownRows));

  // The header's minimise folds it back to the pill, the page as it was; the pill opens it again, with no second load.
  await ui.clickButton(COPY.sidebar.minimise);
  await expect.poll(async () => (await ui.elements('[data-sidebar]'))[0]?.shown).toBe(false);
  expect(await page.evaluate(() => getComputedStyle(document.body).paddingRight)).toBe('0px');
  await expect.poll(async () => (await ui.launcher())?.shown ?? false).toBe(true);
  await ui.clickLauncher();
  await expect.poll(async () => (await ui.elements('[data-sidebar]'))[0]?.shown ?? false).toBe(true);
  expect(said(logs(), 'worker', 'sidebar.injected')).toBe(1);
  // No side panel was asked for, and nothing of ours touched a honeypot or broke the page's policy.
  expect(said(logs(), 'worker', 'panel.opened') + said(logs(), 'worker', 'panel.open-failed')).toBe(0);
  const spies = await spyRecord(page.mainFrame());
  expect([spies.honeypotMutations, spies.cspViolations]).toEqual([0, []]);

  await ui.close();
  await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: served.markers, canaries: served.canaries,
    labels: served.labels, applicationKey: applicationKeyOf(served.url) });
});
