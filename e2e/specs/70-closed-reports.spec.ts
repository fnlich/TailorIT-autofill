/*
 * v3.0 X1-EXT (autofill API 9; TailorIT docs/design/part2/14-extension-reports.md §2-3) end to end, against the mock at
 * API 9, on SmartRecruiters' expired posting (fixtures/smartrecruiters/bertelsmann-expired.html) served at its address:
 * - the page-load lookup answers an open job (the golden one: lookup-untracked, as the mock reads no SmartRecruiters
 *   address as a job of its own), the worker's look in that one document finds the platform's marker and reports it by
 *   itself (POST /jobs/1042/closed: the address the lookup was asked with, marker smartrecruiters.expired, via page),
 *   and the side panel's card says "This posting looks closed. Reported to TailorIT.";
 * - with Report closed jobs to TailorIT automatically off, nothing goes by itself: the card offers Report as closed,
 *   whose press says TailorIT's own words for its daily cap, then, pressed again, sends the person's report and says
 *   "You reported this posting as closed.".
 * Nothing of the page's text reaches the mock. Each test disconnects at its end, so the next one pairs again and starts
 * with no report remembered (what was reported goes with the token).
 */
import { expect, test } from '../fixtures.ts';
import type { Extension } from '../helpers/extension.ts';
import { CLOSED_LIMIT_MESSAGE, mock } from '../helpers/mock.ts';
import { routesFile } from '../routes.ts';
import { API9_COPY } from '../../src/ui/options/copy-api9';

const POSTING = 'https://jobs.smartrecruiters.com/Bertelsmann-Jobs/744000159908317--senior-infrastructure-engineer-ai-ml-penguin-random-house-open-to-remote-';
const ROUTES = routesFile('fixtures/smartrecruiters/bertelsmann-expired.routes.json');
const CLOSED = 'POST /api/autofill/jobs/1042/closed';
const words = API9_COPY.card;

/** The address the page-load lookup was asked with (the posting's, as the worker names it to TailorIT). */
async function lookedUpAs(): Promise<string> {
  await expect.poll(async () => (await mock.requestsTo('POST /api/autofill/lookup')).length, { timeout: 20_000 })
    .toBeGreaterThan(0);
  return (JSON.parse((await mock.requestsTo('POST /api/autofill/lookup'))[0]!.body) as { url: string }).url;
}

async function disconnect(ext: Extension): Promise<void> {
  await ext.send({ v: 1, type: 'auth/disconnect' });
}

test.describe('closed-link reports (v3.0 X1-EXT, autofill API 9)', () => {
  test('reports an expired posting by itself, its marker and no page text, and the card says so', async ({ extContext,
    connected: ext, routeLog, tailorit }) => {
    await tailorit.scenario('lookup-untracked');
    routeLog.serve(ROUTES);
    const page = await extContext.newPage();
    await page.goto(POSTING);
    const tabId = await ext.tabIdOf(page);
    const asked = await lookedUpAs();
    await expect.poll(async () => (await mock.closedReports()).length, { timeout: 30_000 }).toBe(1);
    const [report] = await mock.closedReports();
    expect(report!.jobId).toBe(1042);
    expect(report!.body).toMatchObject({ url: asked, signal: 'marker', marker: 'smartrecruiters.expired', via: 'page' });
    expect(Object.keys(report!.body).sort()).toEqual(['marker', 'seenAt', 'signal', 'url', 'via']);
    // Nothing of the page's text: not its words, its title or its company.
    const sent = (await mock.requestsTo(CLOSED)).map((request) => request.body).join('\n');
    for (const text of ['Sorry', 'Senior Infrastructure Engineer', 'Penguin Random House']) expect(sent).not.toContain(text);
    const panel = await ext.reportPage(tabId);
    const card = panel.locator('[data-job-card]');
    await expect(card.locator('[data-job-closed]')).toHaveText(`${words.looksClosed} ${words.reportedAuto}`);
    await expect(card.locator('[data-job-action="report-closed"]')).toHaveCount(0);
    expect(routeLog.unexpected).toEqual([]);
    await disconnect(ext);
  });

  test('with the setting off, sends nothing by itself; Report as closed says TailorIT’s cap, then sends the person’s report',
    async ({ extContext, connected: ext, routeLog, tailorit }) => {
      await tailorit.scenario('lookup-untracked');
      expect(await ext.send({ v: 1, type: 'reports/closedAuto', on: false })).toEqual({ ok: true, data: { on: false } });
      try {
        routeLog.serve(ROUTES);
        const page = await extContext.newPage();
        await page.goto(POSTING);
        const tabId = await ext.tabIdOf(page);
        const asked = await lookedUpAs();
        const panel = await ext.reportPage(tabId);
        const card = panel.locator('[data-job-card]');
        await expect(card.locator('[data-job-closed="seen"]')).toContainText(words.looksClosed, { timeout: 30_000 });
        expect(await mock.closedReports()).toEqual([]);
        const report = card.locator('[data-job-action="report-closed"]');
        await tailorit.scenario('closed-report-limit', { times: 1 });
        await report.click();
        await expect(card.locator('[data-report-outcome="limited"]')).toHaveText(CLOSED_LIMIT_MESSAGE);
        expect(await mock.closedReports()).toEqual([]);
        await report.click();
        await expect(card.locator('[data-job-closed="yours"]')).toHaveText(words.reportedYours);
        expect(await mock.closedReports()).toEqual([{ jobId: 1042,
          body: expect.objectContaining({ url: asked, signal: 'person', via: 'person' }) as unknown }]);
        expect(routeLog.unexpected).toEqual([]);
      } finally {
        await ext.send({ v: 1, type: 'reports/closedAuto', on: true });
        await disconnect(ext);
      }
    });
});
