/*
 * v5 p1-shell (the review of 2026-11-08, F5): a multi-step run under the product's own defaults ("Where the panel
 * shows: On the page", "Default view: Expanded"), the sidebar open by itself and the page pushed left the whole time:
 * the 4-step wizard (fixtures/synthetic/wizard-4-step) with auto-advance on, its clean steps 1 and 2 filled and their
 * Next pressed by the run, step 3 waiting for the person, the Review step never advanced and Submit never pressed.
 * The push moves the page's layout, never what the run reads or presses: the same values land, the same Nexts are
 * pressed, nothing is submitted, and nothing of ours touches what it must not (assertTrapInvariants).
 */
import { SIDEBAR_WIDTH_PX } from '../../src/shared/sidebar';
import { expect, test } from '../fixtures.ts';
import { applicationKeyOf } from '../helpers/extension.ts';
import { GOLDEN } from '../helpers/golden.ts';
import { assertTrapInvariants } from '../helpers/invariants.ts';
import { PageUi } from '../helpers/page-ui.ts';
import { DEFAULT_SETTINGS, PRODUCT_SETTINGS } from '../helpers/settings.ts';
import { extensionClicks, NEXT, runAt, submitEvents, WIZARD, WIZARD_LABELS, wizardRecord } from '../helpers/wizard.ts';

test.describe.configure({ timeout: 120_000 });

test('the sidebar open and the page pushed, the wizard\'s clean steps fill and advance, and nothing is submitted', async ({ extContext, connected: ext, routeLog, logs }) => {
  await ext.data({ v: 1, type: 'settings/save', settings: { ...PRODUCT_SETTINGS,
    modes: { ...PRODUCT_SETTINGS.modes, next: 'auto' } } });
  try {
    const url = WIZARD.url('sidebar-steps');
    routeLog.serve({ [url]: WIZARD.file });
    const key = applicationKeyOf(url)!;
    const page = await extContext.newPage();
    await page.goto(url);
    await page.bringToFront();
    const ui = await PageUi.of(page);
    // It opened by itself, and the page is pushed left by its width.
    await expect.poll(async () => (await ui.elements('[data-sidebar]'))[0]?.shown ?? false,
      { message: 'the sidebar never opened' }).toBe(true);
    const pushed = () => page.evaluate(() => [document.documentElement.hasAttribute('data-tailorit-sidebar'),
      getComputedStyle(document.body).paddingRight]);
    expect(await pushed()).toEqual([true, `${SIDEBAR_WIDTH_PX}px`]);

    const tabId = await ext.fill(page);
    const at = await runAt(ext, tabId, key, { statuses: ['wait-transition'],
      until: (runState) => Object.keys(runState.stepAttempts).length === 3 });
    expect(Object.values(at.runState.stepAttempts)).toEqual([1, 1, 1]);
    const record = await wizardRecord(page);
    expect(record.step).toBe(3);
    expect(record.next).toEqual([{ step: 1, trusted: false }, { step: 2, trusted: false }]);
    expect(await extensionClicks(page, NEXT.education)).toEqual([]);
    // Step 1's values landed with the page pushed.
    await expect(page.locator('#name')).toHaveValue(GOLDEN.full);
    await expect(page.locator('#email')).toHaveValue(GOLDEN.email);
    // Still open and pushed after the run's own Nexts.
    await page.bringToFront();
    expect((await ui.elements('[data-sidebar]'))[0]?.shown).toBe(true);
    expect(await pushed()).toEqual([true, `${SIDEBAR_WIDTH_PX}px`]);
    expect(await submitEvents(page)).toEqual([]);

    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: WIZARD_LABELS,
      applicationKey: key });
  } finally {
    await ext.data({ v: 1, type: 'settings/save', settings: DEFAULT_SETTINGS });
  }
});
