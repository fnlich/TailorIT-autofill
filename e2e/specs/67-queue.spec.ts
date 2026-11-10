/*
 * v1.5 QX end to end (PLAN decisions 7-9), on synthetic pages only, against the mock's queue (TailorIT v1.5 Q2's
 * routes: GET …/agent/queue with a token, POST …/agent/:id/opened; nothing real is ever submitted: every form posts
 * nothing, and routes.ts fails a test that reaches /__submitted):
 * - Start opens the queued jobs one by one in new tabs, on the settings' schedule (shortened: 1.5 s, then half a second
 *   more each time), each at its job's own address, TailorIT told of each opening first;
 * - a tab fills by itself (Autofill when a queued tab opens: Automatically) with the person's own settings, Submit
 *   Manual: its run rests for the person, and its job reads Ready for you; nothing is submitted;
 * - Pause keeps the seconds left and opens nothing; Resume goes on from them; Stop opens nothing more and leaves the
 *   tabs open;
 * - the Queue tab in the side panel shows the progress, the seconds left and the jobs' statuses, with no serious or
 *   critical accessibility violation.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { COPY } from '../../src/shared/copy';
import { DEFAULT_SETTINGS } from '../helpers/settings.ts';
import { expect, test } from '../fixtures.ts';
import type { Extension } from '../helpers/extension.ts';
import { mock } from '../helpers/mock.ts';

const GREENHOUSE = 'fixtures/synthetic/submit/greenhouse.html';
const greenhouseAt = (id: string) => `https://job-boards.greenhouse.io/tailoritfixture/jobs/67${id}`;

/** A queued job, as TailorIT's opened route hands it out. */
function task(n: number, title: string) {
  return { id: `0000000${n}-bbbb-4bbb-8ccc-00000000670${n}`, jobId: 6700 + n, url: greenhouseAt(`0${n}`),
    company: 'Northwind', title, resumeId: null };
}

interface QueueStatus {
  phase: string;
  hold: string | null;
  nextInMs: number | null;
  total: number;
  opened: number;
  counts: Record<string, number>;
}
interface QueueList {
  source: string;
  items: Array<{ id: string; status: string; tab: boolean }>;
}

/** Records each page the context opens, with when it opened (its tab is made first, on an empty page). */
function watchOpenings(ext: Extension): Array<{ page: Page; at: number }> {
  const seen: Array<{ page: Page; at: number }> = [];
  ext.context.on('page', (page) => {
    seen.push({ page, at: Date.now() });
  });
  return seen;
}

const status = (ext: Extension) => ext.data<QueueStatus>({ v: 1, type: 'queue/status' });
const listed = (ext: Extension) => ext.data<QueueList>({ v: 1, type: 'queue/list', offset: 0 });
/** The queued tabs among the pages opened: those whose address is a queued job's (the rest are the test's own). */
const queuedPages = (seen: Array<{ page: Page; at: number }>) => seen.filter(({ page }) =>
  page.url() === 'about:blank' || page.url().startsWith('https://job-boards.greenhouse.io/tailoritfixture/jobs/67'));

async function queueSettings(ext: Extension, queue: Partial<typeof DEFAULT_SETTINGS.queue>): Promise<void> {
  await ext.data({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
    queue: { ...DEFAULT_SETTINGS.queue, ...queue } } });
}

test.afterEach(async ({ ext }) => {
  await ext.send({ v: 1, type: 'queue/stop' });
  await ext.data({ v: 1, type: 'settings/save', settings: DEFAULT_SETTINGS });
});

test.describe('the sequential auto-apply (v1.5 QX)', () => {
  test('opens the queued jobs one by one on the schedule, fills each with the person’s own settings, and says how each stands', async ({ connected: ext, routeLog }) => {
    routeLog.serve({ [greenhouseAt('01')]: GREENHOUSE, [greenhouseAt('02')]: GREENHOUSE, [greenhouseAt('03')]: GREENHOUSE });
    await mock.queueAgent([task(1, 'Senior Backend Engineer'), task(2, 'Platform Engineer'), task(3, 'Data Engineer')]);
    await queueSettings(ext, { durationSec: 1.5, accelerationSec: 0.5 });
    // Before a run: TailorIT's queued jobs.
    expect((await listed(ext)).items.map((item) => [item.id, item.status])).toEqual([1, 2, 3]
      .map((n) => [task(n, '').id, 'queued']));
    const seen = watchOpenings(ext);
    const started = Date.now();
    const answer = await ext.data<QueueStatus>({ v: 1, type: 'queue/start' });
    expect(answer).toMatchObject({ phase: 'running', total: 3, opened: 1 });
    await expect.poll(() => queuedPages(seen).length, { timeout: 20_000 }).toBe(3);
    const at = queuedPages(seen).map((opened) => opened.at - started);
    // The first at once; the next 1.5 s after it; the third 2 s after that (the acceleration), within the browser's
    // own lag.
    expect(at[0]).toBeLessThan(1_200);
    expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(1_350);
    expect(at[1]! - at[0]!).toBeLessThan(2_600);
    expect(at[2]! - at[1]!).toBeGreaterThanOrEqual(1_850);
    expect(at[2]! - at[1]!).toBeLessThan(3_200);
    // Each at its own job's address, TailorIT told of each opening first (the agent never takes them).
    const pages = queuedPages(seen).map((opened) => opened.page);
    for (const [index, page] of pages.entries()) {
      await page.waitForURL(greenhouseAt(`0${index + 1}`), { timeout: 15_000 });
    }
    expect((await mock.requestsTo('POST /api/autofill/agent/*')).filter((request) => request.path.endsWith('/opened')))
      .toHaveLength(3);
    expect((await mock.agent()).rows.map((row) => row.state)).toEqual(['running', 'running', 'running']);
    // Each fills by itself with the person's settings (Submit Manual): its run rests for the person.
    await expect.poll(async () => pages[0]!.locator('#first_name').inputValue(), { timeout: 30_000 }).not.toBe('');
    await expect.poll(async () => (await listed(ext)).items.map((item) => item.status), { timeout: 45_000 })
      .toEqual(['ready', 'ready', 'ready']);
    expect((await listed(ext)).items.every((item) => item.tab)).toBe(true);
    expect(await status(ext)).toMatchObject({ phase: 'running', total: 3, opened: 3, counts: { ready: 3 } });
    // Nothing was submitted, and no result told yet (each waits for the person).
    expect(routeLog.submitted).toEqual([]);
    expect((await mock.agent()).results).toEqual([]);
    // The person closes the first tab: it is skipped, TailorIT told.
    await pages[0]!.close();
    await expect.poll(async () => (await mock.agent()).results.length, { timeout: 15_000 }).toBe(1);
    expect((await mock.agent()).results[0]).toEqual({ id: task(1, '').id,
      body: { state: 'needs-you', reason: 'cancelled', aiGuesses: 0 } });
    await expect.poll(async () => (await listed(ext)).items[0]!.status).toBe('skipped');
  });

  test('Pause keeps the seconds left and opens nothing; Resume goes on from them; Stop leaves the tabs open', async ({ connected: ext, routeLog, extContext }) => {
    routeLog.serve({ [greenhouseAt('04')]: GREENHOUSE, [greenhouseAt('05')]: GREENHOUSE, [greenhouseAt('06')]: GREENHOUSE });
    await mock.queueAgent([task(4, 'Site Engineer'), task(5, 'QA Engineer'), task(6, 'Support Engineer')]);
    await queueSettings(ext, { durationSec: 3, accelerationSec: 0, autofillOnOpen: 'manual' });
    const seen = watchOpenings(ext);
    await ext.data({ v: 1, type: 'queue/start' });
    await expect.poll(() => queuedPages(seen).length, { timeout: 10_000 }).toBe(1);
    const paused = await ext.data<QueueStatus>({ v: 1, type: 'queue/pause' });
    expect(paused.phase).toBe('paused');
    expect(paused.nextInMs).toBeGreaterThan(1_000);
    expect(paused.nextInMs).toBeLessThanOrEqual(3_000);
    // Paused well past the wait: nothing more opens, the seconds kept.
    await new Promise((done) => setTimeout(done, 4_500));
    expect(queuedPages(seen)).toHaveLength(1);
    expect((await status(ext)).nextInMs).toBe(paused.nextInMs);
    const resumedAt = Date.now();
    expect((await ext.data<QueueStatus>({ v: 1, type: 'queue/resume' })).phase).toBe('running');
    await expect.poll(() => queuedPages(seen).length, { timeout: 10_000 }).toBe(2);
    const gap = queuedPages(seen)[1]!.at - resumedAt;
    expect(gap).toBeGreaterThanOrEqual(paused.nextInMs! - 400);
    expect(gap).toBeLessThan(paused.nextInMs! + 1_500);
    // Manually: the tab waits for the person's Autofill, its job Opened.
    await expect.poll(async () => (await listed(ext)).items[0]!.status, { timeout: 15_000 }).toBe('opened');
    // Stop: nothing more opens; the tabs stay.
    expect((await ext.data<QueueStatus>({ v: 1, type: 'queue/stop' }))).toMatchObject({ phase: 'stopped' });
    await new Promise((done) => setTimeout(done, 4_000));
    expect(queuedPages(seen)).toHaveLength(2);
    expect(queuedPages(seen).every(({ page }) => !page.isClosed())).toBe(true);
    expect((await mock.agent()).rows.map((row) => row.state)).toEqual(['running', 'running', 'queued']);
    // The Queue tab in the side panel says where it stands.
    const tabId = await ext.tabIdOf(queuedPages(seen)[0]!.page);
    const panel = await ext.reportPage(tabId);
    await panel.locator('[role="tab"][data-panel-tab="queue"]').click();
    await expect(panel.locator('[data-queue="stopped"]')).toBeVisible();
    await expect(panel.locator('[data-queue-progress]')).toHaveText('2 of 3');
    await expect(panel.locator('[data-queue-line]')).toHaveText(COPY.queue.stopped.person);
    await expect(panel.locator('.tia-queue__row')).toHaveCount(3);
    await expect(panel.locator('.tia-queue__row').nth(2).locator('.tia-queue__chip')).toHaveText(COPY.queue.statuses.queued);
    // No violation a person relying on assistive technology would be stopped by.
    const violations = (await new AxeBuilder({ page: panel }).analyze()).violations
      .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
      .map((violation) => ({ id: violation.id, targets: violation.nodes.map((node) => node.target.join(' ')) }));
    expect(violations).toEqual([]);
    // A row with an open tab is a button to it.
    await panel.locator('button[data-action="queue-focus"]').first().click();
    await panel.close();
    expect(extContext.pages().length).toBeGreaterThan(0);
  });
});
