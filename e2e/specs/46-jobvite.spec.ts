/*
 * Jobvite's three-step application end to end (DESIGN-NEW-ATS §5, builder B): fixtures/synthetic/jobvite/apply.html,
 * written in the markup of the owner's Jobvite snapshots (fixtures/jobvite) and served at Jobvite addresses, so the
 * Jobvite adapter (src/adapters/jobvite) drives the run, filled by the real extension with the golden profile:
 * - each step read from its ng-form (scopeData.step1 to step3), Next by its aria-label, the last step by its shown
 *   "Send Application" (Next ng-hide there);
 * - step 1: the resume put into #file-input-0, the input in a body-level popover outside the form, read by its
 *   section's heading "Add Resume*" and its opener, and verified once the page shows its file row; the names, the
 *   email and the phone verified;
 * - step 2: the city, under its sub-section's h4; step 3: how the person heard of the job, from the profile;
 * - Next mode Auto: Next pressed on steps 1 and 2 (untrusted clicks), never on the last, and Send Application never;
 * - Next mode Manual (the default): the run fills step 1 and waits; the person's Next (Playwright's trusted click)
 *   takes it to step 2, which it fills;
 * - nothing submitted, no event but the fillers' (assertTrapInvariants).
 */
import type { Page } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../helpers/settings.ts';
import { expect, test } from '../fixtures.ts';
import { applicationKeyOf, row, type Extension } from '../helpers/extension.ts';
import { GOLDEN, GOLDEN_PROFILE } from '../helpers/golden.ts';
import { assertTrapInvariants } from '../helpers/invariants.ts';
import { GOLDEN_RESUME } from '../helpers/mock.ts';
import { fileHeld } from '../helpers/page-state.ts';
import { runAt } from '../helpers/wizard.ts';

const PAGE_FILE = 'fixtures/synthetic/jobvite/apply.html';
const at = (job: string) => `https://jobs.jobvite.com/tailorit-fixture/job/${job}/apply`;
/** Every label the page shows a control under. */
const LABELS = ['Add Resume', 'Chosen First Name', 'Chosen Last Name', 'Email', 'Cell Phone', 'City',
  'How did you hear about this job?'];

test.describe.configure({ timeout: 120_000 });

/** What the page saw (window.__jv). */
interface JobviteRecord {
  step: number;
  next: Array<{ step: number; trusted: boolean }>;
  files: string[];
}
const record = (page: Page) => page.evaluate(() => (globalThis as unknown as { __jv: JobviteRecord }).__jv);

/** Runs `body` with Next mode Auto, and restores the defaults after. */
async function withNextAuto(ext: Extension, body: () => Promise<void>): Promise<void> {
  await ext.data({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
    modes: { ...DEFAULT_SETTINGS.modes, next: 'auto' } } });
  try {
    await body();
  } finally {
    await ext.data({ v: 1, type: 'settings/save', settings: DEFAULT_SETTINGS });
  }
}

/** Step 1's values on the page: the profile's names, email and phone, and the golden resume in the popover's input. */
async function expectStepOneOnPage(page: Page): Promise<void> {
  await expect(page.locator('#jv-field-first')).toHaveValue(GOLDEN.first);
  await expect(page.locator('#jv-field-last')).toHaveValue(GOLDEN.last);
  await expect(page.locator('#jv-field-email')).toHaveValue(GOLDEN.email);
  expect((await page.locator('#jv-field-phone').inputValue()).replace(/\D/g, '')).toContain(GOLDEN.phoneDigits.slice(-10));
  expect(await fileHeld(page, '#file-input-0')).toMatchObject({ count: 1, name: GOLDEN_RESUME.fileName });
  // The page took it: its file row is drawn and the opener's wrapper is ng-hide (step 1 itself may be hidden by now).
  await expect(page.locator('#attachResume ul.jv-file-list div.jv-file')).toHaveCount(1);
  await expect(page.locator('#attachResume > div.opener.ng-hide')).toHaveCount(1);
}

test.describe("Jobvite's three steps", () => {
  test('Next mode Auto: steps 1 and 2 filled and advanced, the last filled and never sent', async ({ extContext, connected: ext, routeLog, logs }) => {
    const url = at('oFixture1');
    routeLog.serve({ [url]: PAGE_FILE });
    const key = applicationKeyOf(url)!;
    await withNextAuto(ext, async () => {
      const page = await extContext.newPage();
      await page.goto(url);
      const tabId = await ext.fill(page);
      const last = await runAt(ext, tabId, key, { statuses: ['review'],
        until: (runState) => Object.keys(runState.stepAttempts).length === 3 });
      expect(await record(page)).toEqual({ step: 3, next: [{ step: 1, trusted: false }, { step: 2, trusted: false }],
        files: [GOLDEN_RESUME.fileName] });
      await expectStepOneOnPage(page);
      await expect(page.locator('#jv-field-f1')).toHaveValue(GOLDEN.city);
      await expect(page.locator('#jv-field-f2')).toHaveValue(GOLDEN_PROFILE.preferences.referralSource);
      expect(row(last.report!, 'How did you hear about this job?')).toMatchObject({ status: 'verified', wrote: true });
      await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
        applicationKey: key });
    });
  });

  test("Next mode Manual: step 1 filled, the resume verified, the run waits for the person's Next", async ({ extContext, connected: ext, routeLog, logs }) => {
    const url = at('oFixture2');
    routeLog.serve({ [url]: PAGE_FILE });
    const key = applicationKeyOf(url)!;
    const page = await extContext.newPage();
    await page.goto(url);
    const tabId = await ext.fill(page);
    const first = await runAt(ext, tabId, key, { statuses: ['wait-transition'],
      until: (runState) => Object.keys(runState.stepAttempts).length === 1 });
    for (const label of ['Chosen First Name', 'Chosen Last Name', 'Email', 'Cell Phone', 'Add Resume']) {
      expect(row(first.report!, label), label).toMatchObject({ status: 'verified', wrote: true });
    }
    await expectStepOneOnPage(page);
    await expect(page.locator('#attachResume ul.jv-file-list div.jv-file')).toBeVisible();
    expect((await record(page)).next).toEqual([]);
    // The person's Next: the run fills step 2, and waits again.
    await page.locator('#jv-next').click();
    const second = await runAt(ext, tabId, key, { statuses: ['wait-transition'],
      until: (runState) => Object.keys(runState.stepAttempts).length === 2 });
    expect(row(second.report!, 'City')).toMatchObject({ status: 'verified', wrote: true });
    await expect(page.locator('#jv-field-f1')).toHaveValue(GOLDEN.city);
    expect((await record(page)).next).toEqual([{ step: 1, trusted: true }]);
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
      applicationKey: key, personClicked: ['#jv-next'] });
  });
});
