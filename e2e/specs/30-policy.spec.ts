/*
 * Policy notices end to end (docs/ARCHITECTURE.md "Policy notices"; the Testing section's two policy specs). A posting
 * that says AI-assisted applications are not allowed is the person's decision, but they are told before anything is
 * written:
 * - the Lever posting page says "Do not use AI tools to apply" and its /apply page does not: the content script on the
 *   posting page records the hit for the application, and the /apply page's run stops at the policy card before any
 *   write, until the person's own click on Fill anyway;
 * - the same /apply page opened directly, with no posting page seen and no stored copy (the mock's golden lookup holds
 *   no posting text): the couldn't-read notice, which does not block, is there before any write;
 * - TailorIT's stored copy says it (the mock's with-posting-text lookup): the card again, and Cancel writes nothing.
 * Each case is its own posting, so no policy record from another reaches it.
 */
import { COPY } from '../../src/shared/copy';
import { expect, test } from '../fixtures.ts';
import { applicationKeyOf, noticeCount, row } from '../helpers/extension.ts';
import { GOLDEN } from '../helpers/golden.ts';
import { assertTrapInvariants } from '../helpers/invariants.ts';
import { SYNTHETIC_LABELS } from '../helpers/labels.ts';
import { PageUi } from '../helpers/page-ui.ts';
import { writeEvents } from '../helpers/page-state.ts';

const POSTING = 'https://jobs.lever.co/tailorit-fixture/00000000-0000-4000-8000-00000000a001';
const APPLY_AFTER_POSTING = `${POSTING}/apply`;
const APPLY_DIRECTLY = 'https://jobs.lever.co/tailorit-fixture/00000000-0000-4000-8000-00000000a002/apply';
const APPLY_STORED_COPY = 'https://jobs.lever.co/tailorit-fixture/00000000-0000-4000-8000-00000000a003/apply';
const POSTING_FILE = 'fixtures/synthetic/policy-posting.html';
const APPLY_FILE = 'fixtures/synthetic/policy-apply.html';
const LABELS = SYNTHETIC_LABELS['policy-apply'];

test.describe('policy notices', () => {
  test('a posting page that says "Do not use AI tools to apply" stops its /apply page at the card, before any write', async ({ extContext, connected: ext, routeLog, logs }) => {
    routeLog.serve({ [POSTING]: POSTING_FILE, [APPLY_AFTER_POSTING]: APPLY_FILE });
    const page = await extContext.newPage();
    await page.goto(POSTING);
    // The posting and its form share one application key, which the posting page's reading is kept under.
    const key = applicationKeyOf(APPLY_AFTER_POSTING)!;
    expect(applicationKeyOf(POSTING)).toBe(key);
    await expect.poll(async () => (await ext.session())[`policy:${key}`]).toEqual({ hits: ['do-not-use-ai'], clear: false });

    await page.getByRole('link', { name: 'Apply for this job' }).click();
    await page.waitForURL(APPLY_AFTER_POSTING);
    const tabId = await ext.fill(page);
    const waiting = await ext.settled(tabId);
    expect(waiting.status).toBe('policy-notice');
    expect(noticeCount(waiting, 'policy')).toBe(1);
    expect(waiting.fields.filter((field) => field.wrote)).toEqual([]);
    expect(await writeEvents(page), 'a write before the person chose').toEqual([]);
    for (const id of ['#name', '#email', '#phone']) await expect(page.locator(id)).toHaveValue('');
    const ui = await PageUi.of(page);
    expect(await ui.policyCardShown()).toBe(true);

    // Only the person's own click lets the fill go on.
    await ui.clickButton(COPY.policyFillAnyway);
    const filled = await ext.settled(tabId, { until: (report) => report.status !== 'policy-notice' });
    expect(filled.status).toBe('review');
    expect(row(filled, 'Full name')).toMatchObject({ status: 'verified', provenance: 'profile' });
    await expect(page.locator('#name')).toHaveValue(GOLDEN.full);
    await expect(page.locator('#email')).toHaveValue(GOLDEN.email);
    expect((await ext.runState(key))?.policyDecision).toBe('accepted');
    await ui.close();
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
      applicationKey: key });
  });

  test('the same /apply page opened directly, with no stored copy, shows the couldn’t-read notice before any write', async ({ extContext, connected: ext, routeLog, logs }) => {
    routeLog.serve({ [APPLY_DIRECTLY]: APPLY_FILE });
    const page = await extContext.newPage();
    await page.goto(APPLY_DIRECTLY);
    const tabId = await ext.tabIdOf(page);
    const pushed = await ext.watchReports(tabId);
    await ext.fill(page);
    const report = await ext.settled(tabId);
    expect(report.status).toBe('review');
    expect(noticeCount(report, 'policy-unreadable')).toBe(1);
    expect(noticeCount(report, 'policy')).toBe(0);
    expect(row(report, 'Email')).toMatchObject({ status: 'verified', provenance: 'profile' });
    // Every version of the report the panel was sent: none shows a write without the notice beside it.
    const versions = (await pushed()).flat().filter((frame) => frame.frameId === 0 && frame.mode === 'fill');
    expect(versions.length).toBeGreaterThan(0);
    expect(versions.filter((frame) => frame.fields.some((field) => field.wrote) && noticeCount(frame, 'policy-unreadable') === 0))
      .toEqual([]);
    const ui = await PageUi.of(page);
    expect(await ui.noticeTexts()).toContain(COPY.notices['policy-unreadable']);
    await ui.close();
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
      applicationKey: applicationKeyOf(APPLY_DIRECTLY) });
  });

  test("TailorIT's stored copy saying it stops the run at the card too, and Cancel writes nothing", async ({ extContext, connected: ext, routeLog, logs, tailorit }) => {
    await tailorit.scenario('lookup-posting-text');
    routeLog.serve({ [APPLY_STORED_COPY]: APPLY_FILE });
    const page = await extContext.newPage();
    await page.goto(APPLY_STORED_COPY);
    const tabId = await ext.fill(page);
    const waiting = await ext.settled(tabId);
    expect(waiting.status).toBe('policy-notice');
    expect(noticeCount(waiting, 'policy')).toBe(1);
    expect(noticeCount(waiting, 'policy-stored-copy')).toBe(1);
    const ui = await PageUi.of(page);
    expect(await ui.policyCardShown()).toBe(true);
    // The page's card and the panel's say the same words, the stored-copy line included (Phase 6).
    const cardLines = (await ui.elements('[role="alertdialog"] p')).filter((line) => line.shown).map((line) => line.text);
    expect(cardLines).toEqual([COPY.notices.policy, COPY.policyFromStoredCopy]);
    const panel = await ext.reportPage(tabId);
    await expect(panel.locator('[data-notice="policy"] p')).toHaveText([COPY.notices.policy, COPY.policyFromStoredCopy]);
    await page.bringToFront();
    await ui.clickButton(COPY.policyCancel);
    const stopped = await ext.settled(tabId, { until: (report) => report.status !== 'policy-notice' });
    expect(stopped.status).toBe('stopped');
    expect(stopped.fields.filter((field) => field.wrote)).toEqual([]);
    expect(await writeEvents(page)).toEqual([]);
    for (const id of ['#name', '#email', '#phone']) await expect(page.locator(id)).toHaveValue('');
    await ui.close();
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
      applicationKey: applicationKeyOf(APPLY_STORED_COPY) });
  });
});
