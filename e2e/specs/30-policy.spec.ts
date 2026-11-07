/*
 * Policy notices end to end (docs/ARCHITECTURE.md "Policy notices"; the Testing section's two policy specs). v4 (the
 * owner, 2026-11-07, docs/SPEC-AMENDMENTS.md §13 D6 and D9): the run decides, and nothing waits or is said on the page; the cases
 * below were the Phase 2 card's, kept for their pages:
 * - the Lever posting page says "Do not use AI tools to apply" and its /apply page does not: the content script on the
 *   posting page records the hit for the application, and the /apply page's run stops at the policy card before any
 *   write, until the person's own click on Fill anyway;
 * - the same /apply page opened directly, with no posting page seen and no stored copy (the mock's golden lookup holds
 *   no posting text): the couldn't-read notice, which does not block, is there before any write;
 * - TailorIT's stored copy says it (the mock's with-posting-text lookup): the card again, and Cancel writes nothing.
 * The card is the "Ask me each time" setting's (the owner's amendments, docs/SPEC-AMENDMENTS.md), which these cases
 * save first; with the default, "Fill from my profile only", the posting page's hit fills the form from the profile
 * with no card and no AI request, and the notice says so.
 * Each case is its own posting, so no policy record from another reaches it.
 */
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS } from '../../src/core/types/settings';
import { expect, test } from '../fixtures.ts';
import { mock } from '../helpers/mock.ts';
import { applicationKeyOf, noticeCount, row } from '../helpers/extension.ts';
import { GOLDEN } from '../helpers/golden.ts';
import { assertTrapInvariants } from '../helpers/invariants.ts';
import { SYNTHETIC_LABELS } from '../helpers/labels.ts';
import { PageUi } from '../helpers/page-ui.ts';

const POSTING = 'https://jobs.lever.co/tailorit-fixture/00000000-0000-4000-8000-00000000a001';
const APPLY_AFTER_POSTING = `${POSTING}/apply`;
const APPLY_DIRECTLY = 'https://jobs.lever.co/tailorit-fixture/00000000-0000-4000-8000-00000000a002/apply';
const APPLY_STORED_COPY = 'https://jobs.lever.co/tailorit-fixture/00000000-0000-4000-8000-00000000a003/apply';
const POSTING_FILE = 'fixtures/synthetic/policy-posting.html';
const APPLY_FILE = 'fixtures/synthetic/policy-apply.html';
const LABELS = SYNTHETIC_LABELS['policy-apply'];
const APPLY_PROFILE_ONLY = 'https://jobs.lever.co/tailorit-fixture/00000000-0000-4000-8000-00000000a004';

test.describe('policy notices, the default: fill from the profile only', () => {
  test('a posting page that says "Do not use AI tools to apply": no card, no AI request, the notice, the profile written', async ({ extContext, connected: ext, routeLog, logs }) => {
    const apply = `${APPLY_PROFILE_ONLY}/apply`;
    // The posting page at this case's own posting, its link leading to this posting's /apply.
    const posting = readFileSync(POSTING_FILE, 'utf8').replaceAll(APPLY_AFTER_POSTING, apply);
    routeLog.serve({ [APPLY_PROFILE_ONLY]: { body: posting, contentType: 'text/html; charset=utf-8' }, [apply]: APPLY_FILE });
    const page = await extContext.newPage();
    await page.goto(APPLY_PROFILE_ONLY);
    const key = applicationKeyOf(apply)!;
    await expect.poll(async () => (await ext.session())[`policy:${key}`]).toEqual({ hits: ['do-not-use-ai'], clear: false });
    await page.getByRole('link', { name: 'Apply for this job' }).click();
    await page.waitForURL(apply);
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId);
    expect(report.status).toBe('review');
    expect(noticeCount(report, 'policy-profile-only')).toBe(1);
    expect(await (await PageUi.of(page)).policyCardShown()).toBe(false);
    expect(row(report, 'Full name')).toMatchObject({ status: 'verified', provenance: 'profile' });
    await expect(page.locator('#name')).toHaveValue(GOLDEN.full);
    expect(await mock.requestsTo('POST /api/autofill/ai/*'), 'an AI request').toEqual([]);
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
      applicationKey: key });
  });
});

test.describe('policy notices (v4, D6 and D9: no card and nothing on the page; the run decides)', () => {
  test.afterEach(async ({ connected: ext }) => {
    await ext.data({ v: 1, type: 'settings/save', settings: DEFAULT_SETTINGS });
  });

  test('"Use AI anyway": a posting page that says "Do not use AI tools to apply" fills its /apply page at once, no card', async ({ extContext, connected: ext, routeLog, logs }) => {
    await ext.data({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
      llm: { ...DEFAULT_SETTINGS.llm, whenForbidden: 'use-ai' } } });
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
    const filled = await ext.settled(tabId);
    expect(filled.status).toBe('review');
    expect(noticeCount(filled, 'policy')).toBe(1);
    expect(row(filled, 'Full name')).toMatchObject({ status: 'verified', provenance: 'profile' });
    await expect(page.locator('#name')).toHaveValue(GOLDEN.full);
    await expect(page.locator('#email')).toHaveValue(GOLDEN.email);
    const ui = await PageUi.of(page);
    expect(await ui.policyCardShown()).toBe(false);
    expect((await ui.noticeTexts()).filter((text) => !text.startsWith('Autofill complete'))).toEqual([]);
    await ui.close();
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
      applicationKey: key });
  });

  test('the same /apply page opened directly, with no stored copy, fills with nothing said of the unread posting', async ({ extContext, connected: ext, routeLog, logs }) => {
    routeLog.serve({ [APPLY_DIRECTLY]: APPLY_FILE });
    const page = await extContext.newPage();
    await page.goto(APPLY_DIRECTLY);
    const tabId = await ext.fill(page);
    const report = await ext.settled(tabId);
    expect(report.status).toBe('review');
    expect(noticeCount(report, 'policy-unreadable')).toBe(0);
    expect(noticeCount(report, 'policy')).toBe(0);
    expect(row(report, 'Email')).toMatchObject({ status: 'verified', provenance: 'profile' });
    const ui = await PageUi.of(page);
    expect((await ui.noticeTexts()).filter((text) => !text.startsWith('Autofill complete'))).toEqual([]);
    await ui.close();
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
      applicationKey: applicationKeyOf(APPLY_DIRECTLY) });
  });

  test("TailorIT's stored copy saying it fills from the profile only, with no card and no AI request", async ({ extContext, connected: ext, routeLog, logs, tailorit }) => {
    await tailorit.scenario('lookup-posting-text');
    routeLog.serve({ [APPLY_STORED_COPY]: APPLY_FILE });
    const page = await extContext.newPage();
    await page.goto(APPLY_STORED_COPY);
    const tabId = await ext.fill(page);
    const filled = await ext.settled(tabId);
    expect(filled.status).toBe('review');
    expect(noticeCount(filled, 'policy-profile-only')).toBe(1);
    expect(noticeCount(filled, 'policy-stored-copy')).toBe(1);
    expect(row(filled, 'Full name')).toMatchObject({ status: 'verified', provenance: 'profile' });
    expect(await mock.requestsTo('POST /api/autofill/ai/*'), 'an AI request').toEqual([]);
    const ui = await PageUi.of(page);
    expect(await ui.policyCardShown()).toBe(false);
    expect((await ui.noticeTexts()).filter((text) => !text.startsWith('Autofill complete'))).toEqual([]);
    await ui.close();
    await assertTrapInvariants({ page, ext, tabId, routeLog, console: logs(), markers: [], canaries: [], labels: LABELS,
      applicationKey: applicationKeyOf(APPLY_STORED_COPY) });
  });
});
