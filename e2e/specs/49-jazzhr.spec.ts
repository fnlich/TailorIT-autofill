/*
 * JazzHR's one-page application end to end (DESIGN-NEW-ATS, builder C): the synthetic page fixtures/synthetic/jazzhr,
 * written by hand in the shapes the JazzHR adapter reads from the owner's snapshots (jazzhr-0 to -4), served at a
 * JazzHR tenant's address (https://tailorit-fixture.applytojob.com/apply/<code>/<slug>), where the static content script
 * runs and the registry gives the JazzHR configured adapter. Filled by the real extension with the golden profile:
 * - the text boxes written and read back (the address's City, State/Province and Postal named by their placeholders);
 * - the résumé put into its visible input;
 * - the checkbox question (its title naming no element, its two boxes named apart) read as one required question,
 *   its category the work authorization, answered as a Yes/No radio (core pass Z2 of 2026-11-06,
 *   core/resolver/yesNoPair.ts): its "Yes" box ticked, its "No" box left unticked, and both read back;
 * - the select question answered "No" (no sponsorship);
 * - the step read as final with its Submit link offered (the panel's dock), and nothing pressed by the fill: not the
 *   Submit link, the "Paste resume" switch, "View All Jobs", the share link or the cookie banner (the page records any
 *   click), and nothing submitted (assertTrapInvariants).
 * Then the person presses Submit application in the side panel, which presses the page's Submit link once, through the
 * Submit gate, and the page shows its own "Submitting...please wait..." (jazzhr-4).
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures.ts';
import { applicationKeyOf, row, type Extension } from '../helpers/extension.ts';
import { GOLDEN } from '../helpers/golden.ts';
import { assertTrapInvariants } from '../helpers/invariants.ts';
import { GOLDEN_RESUME } from '../helpers/mock.ts';
import { fileHeld, selectedTexts } from '../helpers/page-state.ts';
import { syntheticLabels } from '../helpers/reactive.ts';
import type { RouteLog } from '../routes.ts';

const PAGE_FILE = 'fixtures/synthetic/jazzhr/index.html';
const LABELS = syntheticLabels('fixtures/synthetic/jazzhr/index.expect.json');
const at = (n: number) => `https://tailorit-fixture.applytojob.com/apply/0000000A0${n}/Senior-Backend-Engineer`;
const AUTHORIZED = 'Are you legally authorized to work in the United States?';
const SPONSORSHIP = 'Will you now or in the future require sponsorship for employment visa status?';

interface Log {
  pressed: string[];
  submitted: number;
}

const logOf = (page: Page) => page.evaluate(() => (window as unknown as { __jazz: Log }).__jazz);
/** The values of the question's checked boxes, in page order. */
const ticked = (page: Page) => page.locator('input.resumator-questionnaire-checkbox').evaluateAll((boxes) =>
  boxes.filter((box) => (box as HTMLInputElement).checked).map((box) => (box as HTMLInputElement).value));

/** The page at `url`, filled from the side panel, resting at review. */
async function filled(ext: Extension, page: Page, routeLog: RouteLog, url: string) {
  routeLog.serve({ [url]: PAGE_FILE });
  await page.goto(url);
  await expect(page.locator('#resumator-firstname-value')).toBeVisible();
  const tabId = await ext.fill(page);
  const report = await ext.settled(tabId);
  return { tabId, report };
}

test.describe("JazzHR's one-page application", () => {
  test('filled: the text boxes, the résumé, the select; the checkbox question one, its Yes box ticked; nothing pressed', async ({ extContext, connected: ext, routeLog, logs }) => {
    test.setTimeout(120_000);
    const page = await extContext.newPage();
    const url = at(1);
    const { tabId, report } = await filled(ext, page, routeLog, url);
    expect(report.status).toBe('review');
    const verified = { status: 'verified', wrote: true, verification: 'verified' };

    expect(row(report, 'First Name')).toMatchObject(verified);
    await expect(page.locator('#resumator-firstname-value')).toHaveValue(GOLDEN.first);
    expect(row(report, 'Last Name')).toMatchObject(verified);
    expect(row(report, 'Email Address')).toMatchObject(verified);
    await expect(page.locator('#resumator-email-value')).toHaveValue(GOLDEN.email);
    expect(row(report, 'Phone')).toMatchObject({ wrote: true, verification: 'verified' });
    expect(row(report, 'City')).toMatchObject(verified);
    await expect(page.locator('#resumator-city-value')).toHaveValue(GOLDEN.city);

    // The résumé, in its visible input.
    expect(row(report, 'Resume')).toMatchObject({ ...verified, category: 'file.resume' });
    expect(await fileHeld(page, '#resumator-resume-value')).toEqual({ count: 1, name: GOLDEN_RESUME.fileName,
      type: GOLDEN_RESUME.mime, size: GOLDEN_RESUME.size, sha256: GOLDEN_RESUME.sha256 });

    // The checkbox question: one required question (groupOf), its category read, answered as the Yes/No radio it asks
    // (core pass Z2 of 2026-11-06, core/resolver/yesNoPair.ts): the profile's yes ticks its "Yes" box alone, and the
    // read-back holds both boxes (the "Yes" ticked, the "No" not).
    expect(row(report, AUTHORIZED)).toMatchObject({ kind: 'checkbox-group', category: 'workAuth.authorized', required: true,
      wrote: true, verification: 'verified' });
    expect(await ticked(page)).toEqual(['Yes']);
    // The select question: the profile's "no sponsorship".
    expect(row(report, SPONSORSHIP)).toMatchObject({ kind: 'select', category: 'workAuth.sponsorship', wrote: true,
      verification: 'verified' });
    expect(await selectedTexts(page, '#resumator-questionnaire-q7002')).toEqual(['No']);

    // One page, final, its Submit link offered; nothing pressed by the fill, nothing submitted.
    expect(report.buttons).toEqual({ final: 'final', next: false, submit: true });
    expect(await logOf(page)).toEqual({ pressed: [], submitted: 0 });
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
      applicationKey: applicationKeyOf(url) });
  });

  test('the side panel\'s Submit presses the Submit link once; the page shows it is submitting', async ({ extContext, connected: ext, routeLog, logs }) => {
    test.setTimeout(120_000);
    const page = await extContext.newPage();
    const url = at(2);
    const { tabId, report } = await filled(ext, page, routeLog, url);
    expect(report.buttons).toEqual({ final: 'final', next: false, submit: true });
    expect(await logOf(page)).toEqual({ pressed: [], submitted: 0 });
    // The checkbox question is answered by the fill; the person presses Submit application in the panel.
    expect(await ticked(page)).toEqual(['Yes']);
    const panel = await ext.reportPage(tabId);
    await panel.locator('button[data-step-action="submit"]').click();
    await expect.poll(async () => (await logOf(page)).submitted).toBe(1);
    await expect(page.locator('#resumator-submit')).toHaveText('Submitting...please wait...');
    expect((await logOf(page)).pressed).toEqual([]);
    expect(routeLog.submitted).toEqual([]);
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
      applicationKey: applicationKeyOf(url), panelSubmitted: true });
  });
});
