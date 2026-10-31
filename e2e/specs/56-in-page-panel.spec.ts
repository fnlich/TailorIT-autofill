/*
 * The in-page panel end to end (Phase 6; docs/ARCHITECTURE.md "UI" and the message catalogue's panel/shown): with the
 * in-page panel chosen in the settings, the launcher's Open review opens the report in the frame's own closed root
 * (no side panel), the frame tells the worker so (panel/shown), and the worker sends that frame alone the tab's report
 * (report/update), which the panel draws as the report page does. Its Close button closes it and the worker forgets the
 * frame. The settings go back to the side panel afterwards: the extension's context outlives this test.
 */
import { DEFAULT_SETTINGS } from '../../src/core/types/settings';
import { COPY } from '../../src/shared/copy';
import { expect, test } from '../fixtures.ts';
import type { ConsoleEntry } from '../helpers/console.ts';
import { applicationKeyOf } from '../helpers/extension.ts';
import { assertTrapInvariants } from '../helpers/invariants.ts';
import { PageUi } from '../helpers/page-ui.ts';
import { trap } from '../helpers/traps.ts';

const workerSaid = (entries: readonly ConsoleEntry[], code: string) =>
  entries.filter((entry) => entry.source === 'worker' && entry.text.includes(`[tailorit-autofill] ${code}`)).length;

test('the in-page panel opens in the frame from the launcher, receives the tab’s report there, and closes', async ({ extContext, connected: ext, routeLog, logs }) => {
  await ext.data({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS, panel: 'in-page' } });
  try {
    const served = trap('03');
    routeLog.serve({ [served.url]: served.file });
    const page = await extContext.newPage();
    await page.goto(served.url);
    const tabId = await ext.tabIdOf(page);
    await ext.frameWithForm(tabId);
    const ui = await PageUi.of(page);
    await expect.poll(async () => (await ui.launcher())?.shown ?? false, { message: 'the launcher never showed' }).toBe(true);

    // The person's own click on the launcher fills; once the run rests at review, its action is Open review.
    await ui.clickLauncher();
    const report = await ext.settled(tabId);
    expect(report.status).toBe('review');
    await expect.poll(async () => (await ui.launcher())?.attributes['data-state']).toBe('review');
    expect(await ui.elements('[data-panel="in-page"]')).toEqual([expect.objectContaining({ shown: false })]);

    await ui.clickLauncher();
    await expect.poll(async () => (await ui.elements('[data-panel="in-page"]'))[0]?.shown,
      { message: 'the in-page panel never opened' }).toBe(true);
    expect(await ext.session()).toMatchObject({ [`panel-frame:${tabId}`]: { frameId: 0 } });
    // The worker's report reached the panel: every row, by key and status, as the report holds them (by section).
    const sections = [...new Set(report.fields.map((row) => row.section))];
    const expected = sections.flatMap((section) => report.fields.filter((row) => row.section === section))
      .map((row) => [row.key, row.status]);
    await expect.poll(async () => (await ui.elements('[data-panel="in-page"] li[data-field-key]'))
      .map((row) => [row.attributes['data-field-key'], row.attributes['data-status']])).toEqual(expected);
    const panelText = (await ui.elements('[data-panel="in-page"]'))[0]!.text;
    expect(panelText).toContain(COPY.notices.tripwire);
    expect(workerSaid(logs(), 'panel.shown')).toBe(1);
    expect(workerSaid(logs(), 'panel.updated')).toBeGreaterThanOrEqual(1);
    // The side panel was not asked for.
    expect(workerSaid(logs(), 'panel.opened') + workerSaid(logs(), 'panel.open-failed')).toBe(0);
    // While the panel shows the notices, the page's own stack keeps only what has buttons.
    expect(await ui.noticeTexts()).toEqual([]);

    await ui.clickButton(COPY.inPage.close);
    await expect.poll(async () => (await ui.elements('[data-panel="in-page"]'))[0]?.shown).toBe(false);
    await expect.poll(async () => Object.keys(await ext.session()).includes(`panel-frame:${tabId}`)).toBe(false);
    expect(await ui.noticeTexts()).toContain(COPY.notices.tripwire);
    await ui.close();
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: served.markers, canaries: served.canaries,
      labels: served.labels, applicationKey: applicationKeyOf(served.url) });
  } finally {
    await ext.data({ v: 1, type: 'settings/save', settings: DEFAULT_SETTINGS });
  }
});
