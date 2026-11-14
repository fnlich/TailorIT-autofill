/*
 * v2.0 P9 (autofill API 8; docs/design/v2.0/09-extension-api8.md "The claim's daily limit") end to end, on synthetic
 * pages only, against the mock's daily-limit scenario (a Free account's daily auto-apply limit: each claim counts, and
 * past the limit the claim answers no job with `dailyLimit` reached and TailorIT's words; nothing real is ever
 * submitted):
 * - Run auto-apply takes and submits the job the limit allows (its result says its Submit was pressed, so TailorIT keeps
 *   the count), then the next claim is refused: Run auto-apply stays on, Options shows TailorIT's words as they are with
 *   Subscribe, and nothing more opens; the job left stays queued;
 * - the Queue tab opens the job the limit allows, then stops ('daily-limit'): nothing more opens, the jobs left stay
 *   queued, its line says TailorIT's words, and Start again before the reset gets the same answer.
 * Named 69 (the design's 67-daily-limit), so it runs after 67-queue: the specs share one browser, and the Queue tab's
 * run this spec leaves (stopped, its jobs listed) stays until a Start replaces it, while 67-queue's first test reads
 * the list before any run.
 */
import type { Page } from '@playwright/test';
import { COPY } from '../../src/shared/copy';
import { expect, test } from '../fixtures.ts';
import type { Extension } from '../helpers/extension.ts';
import { DAILY_LIMIT_MESSAGE, mock } from '../helpers/mock.ts';
import { DEFAULT_SETTINGS } from '../helpers/settings.ts';

const GREENHOUSE = 'fixtures/synthetic/submit/greenhouse.html';
const greenhouseAt = (id: string) => `https://job-boards.greenhouse.io/tailoritfixture/jobs/6767${id}`;

/** A queued job, as TailorIT's claims hand it out. */
function task(n: number, title: string) {
  return { id: `0000000${n}-dddd-4bbb-8ccc-00000006767${n}`, jobId: 67670 + n, url: greenhouseAt(`0${n}`),
    company: 'Northwind', title, resumeId: null };
}

/** The pages the context opens from now on at a queued job's address (or still blank). */
function watchJobs(ext: Extension): Page[] {
  const seen: Page[] = [];
  ext.context.on('page', (page) => {
    seen.push(page);
  });
  return seen;
}
const jobPages = (seen: Page[]) => seen.filter((page) => page.url() === 'about:blank'
  || page.url().startsWith('https://job-boards.greenhouse.io/tailoritfixture/jobs/6767'));

test.afterEach(async ({ ext }) => {
  await ext.send({ v: 1, type: 'agent/set', on: false });
  await ext.send({ v: 1, type: 'queue/stop' });
  await ext.data({ v: 1, type: 'settings/save', settings: DEFAULT_SETTINGS });
});

test.describe('TailorIT’s daily auto-apply limit (v2.0 P9, API 8)', () => {
  test('Run auto-apply submits the job the limit allows, then waits with Run auto-apply on; Options says TailorIT’s words; nothing more opens', async ({ connected: ext, routeLog }) => {
    routeLog.serve({ [greenhouseAt('01')]: GREENHOUSE, [greenhouseAt('02')]: GREENHOUSE });
    await mock.scenario('daily-limit', { value: 1 });
    await mock.queueAgent([task(1, 'Senior Backend Engineer'), task(2, 'Platform Engineer')]);
    const seen = watchJobs(ext);
    const answer = await ext.data<{ on: boolean }>({ v: 1, type: 'agent/set', on: true, confirmed: true });
    expect(answer.on).toBe(true);
    // The job the limit allows: submitted by itself, its Submit pressed, so TailorIT keeps its count.
    await expect.poll(async () => (await mock.agent()).results, { timeout: 60_000 }).toEqual([{ id: task(1, '').id,
      body: { state: 'submitted', reason: null, aiGuesses: 0, submitPressed: true } }]);
    // The next claim: the limit reached. Run auto-apply stays on, blocked by the limit, with TailorIT's words.
    await expect.poll(async () => (await ext.data<{ blocked: string | null }>({ v: 1, type: 'agent/status' })).blocked,
      { timeout: 30_000 }).toBe('daily-limit');
    const status = await ext.data<{ on: boolean; phase: string; limit?: { message: string | null } }>(
      { v: 1, type: 'agent/status' });
    expect(status).toMatchObject({ on: true, phase: 'blocked', limit: { message: DAILY_LIMIT_MESSAGE } });
    // Options: the status line, then TailorIT's words as they are, and Subscribe.
    const options = await ext.page();
    await options.goto(ext.url('options.html'));
    const card = options.locator('[data-card="agent"]');
    await expect(card.locator('[data-agent-line]')).toContainText('Auto-apply: paused');
    const limit = card.locator('[data-agent-limit]');
    await expect(limit).toContainText(DAILY_LIMIT_MESSAGE);
    await expect(limit.locator('a[data-tailorit-link="subscribe"]')).toHaveAttribute('href', /\/settings#account$/);
    await expect(card.locator('input[data-setting="agent.on"]')).toBeChecked();
    // Nothing more opens: the second job stays queued in TailorIT.
    await new Promise((done) => setTimeout(done, 5_000));
    expect(jobPages(seen).filter((page) => page.url().endsWith('/676702'))).toEqual([]);
    expect((await mock.agent()).rows.map((row) => row.state)).toEqual(['submitted', 'queued']);
    expect(routeLog.submitted).toEqual([]);
  });

  test('the Queue tab opens the job the limit allows, then stops with TailorIT’s words, the rest still queued', async ({ connected: ext, routeLog }) => {
    routeLog.serve({ [greenhouseAt('01')]: GREENHOUSE, [greenhouseAt('02')]: GREENHOUSE, [greenhouseAt('03')]: GREENHOUSE });
    await mock.scenario('daily-limit', { value: 1 });
    await mock.queueAgent([task(1, 'Senior Backend Engineer'), task(2, 'Platform Engineer'), task(3, 'Data Engineer')]);
    await ext.data({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
      queue: { ...DEFAULT_SETTINGS.queue, durationSec: 1, accelerationSec: 0, autofillOnOpen: 'manual' } } });
    const seen = watchJobs(ext);
    await ext.data({ v: 1, type: 'queue/start' });
    type Status = { phase: string; stoppedBy: string | null; limit?: { message: string | null } };
    await expect.poll(async () => (await ext.data<Status>({ v: 1, type: 'queue/status' })).stoppedBy, { timeout: 20_000 })
      .toBe('daily-limit');
    expect(await ext.data<Status>({ v: 1, type: 'queue/status' })).toMatchObject({ phase: 'stopped',
      limit: { message: DAILY_LIMIT_MESSAGE } });
    // One tab opened; nothing more opens; the jobs left stay queued, here and in TailorIT.
    await new Promise((done) => setTimeout(done, 4_000));
    expect(jobPages(seen)).toHaveLength(1);
    const listed = await ext.data<{ items: Array<{ status: string }> }>({ v: 1, type: 'queue/list', offset: 0 });
    expect(listed.items.map((item) => item.status)).toEqual(['opened', 'queued', 'queued']);
    expect((await mock.agent()).rows.map((row) => row.state)).toEqual(['running', 'queued', 'queued']);
    // The Queue tab says TailorIT's words.
    const panel = await ext.reportPage(await ext.tabIdOf(jobPages(seen)[0]!));
    await panel.locator('[role="tab"][data-panel-tab="queue"]').click();
    await expect(panel.locator('[data-queue="stopped"]')).toBeVisible();
    await expect(panel.locator('[data-queue-line]')).toHaveText(DAILY_LIMIT_MESSAGE);
    await expect(panel.locator('[data-queue-line]')).not.toHaveText(COPY.queue.stopped.person);
    // Start again before the reset: TailorIT asked again, the same answer; still nothing more opens.
    expect(await ext.data<Status>({ v: 1, type: 'queue/start' })).toMatchObject({ phase: 'stopped',
      stoppedBy: 'daily-limit' });
    await new Promise((done) => setTimeout(done, 2_000));
    expect(jobPages(seen)).toHaveLength(1);
    expect(routeLog.submitted).toEqual([]);
  });
});
