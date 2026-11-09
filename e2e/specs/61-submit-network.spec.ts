/*
 * v5 p2-detect (PLAN decision 14, adopted for "applied" detection; the engine audit's J11 and gap 3) end to end, on the
 * synthetic Workday steps page at Review (fixtures/synthetic/workday/steps.html, ?review&finalize): the page-world
 * submit watcher (src/entrypoints/submit-watch.content.ts, world MAIN, from document_start) sees the page's own
 * finalize, POST /wday/cxs/<tenant>/jobapplication/<id>/finalize, and its answer's status alone:
 * - answered 200 after the person's own Submit, by fetch or by XMLHttpRequest, the application is recorded Applied
 *   (POST /applied) from the tab that armed it;
 * - answered 400, nothing is recorded, and the page still had its own answer.
 * The routes answer the finalize; nothing else leaves the page (routes.ts fails a test that reaches anything else).
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures.ts';
import type { Extension } from '../helpers/extension.ts';
import { mock } from '../helpers/mock.ts';

const APPLIED = 'POST /api/autofill/applied';
const HOST = 'tailoritfixture.wd5.myworkdayjobs.com';
const STEPS_PAGE = 'fixtures/synthetic/workday/steps.html';
const FINALIZE = `https://${HOST}/wday/cxs/tailoritfixture/jobapplication/JA-0000002/finalize`;
const reviewAt = (query: string) => `https://${HOST}/en-US/careers/job/x/Fixture-Steps_JR-0000002/apply/applyManually?review&${query}`;

const finalizedOn = (page: Page) => page.evaluate(() => (window as unknown as { __wd: { finalized: number[] } }).__wd.finalized);
const submittedState = async (ext: Extension, tabId: number) =>
  (await ext.data<{ page?: { submitted?: string } }>({ v: 1, type: 'panel/reports', tabId })).page?.submitted;

/** The Review step, filled (nothing to fill: the run rests at review), then the person's own click on its Submit. */
async function submitAt(ext: Extension, page: Page, url: string): Promise<number> {
  await page.goto(url);
  const tabId = await ext.fill(page);
  await ext.settled(tabId);
  await page.bringToFront();
  await page.locator('[data-automation-id="pageFooterNextButton"]').click();
  return tabId;
}

test.describe("a platform's network sign records Applied (v5 p2-detect)", () => {
  test("Workday: the finalize answered 200 after the person's Submit records the application, by fetch or XMLHttpRequest",
    async ({ extContext, connected: ext, routeLog }) => {
      for (const query of ['finalize', 'finalize&xhr']) {
        const url = reviewAt(query);
        routeLog.serve({ [url]: STEPS_PAGE, [FINALIZE]: { body: '{"id":"JA-0000002"}', contentType: 'application/json' } });
        const before = (await mock.requestsTo(APPLIED)).length;
        const page = await extContext.newPage();
        const tabId = await submitAt(ext, page, url);
        await expect.poll(() => finalizedOn(page), { message: query }).toEqual([200]);
        await expect.poll(() => submittedState(ext, tabId), { message: query }).toBe('recorded');
        expect((await mock.requestsTo(APPLIED)).length - before, query).toBe(1);
        await page.close();
      }
      expect(routeLog.unexpected).toEqual([]);
      expect(routeLog.submitted).toEqual([]);
    });

  test('Workday: a finalize answered 400 records nothing, and the page has its own answer', async ({ extContext, connected: ext, routeLog }) => {
    const url = reviewAt('finalize');
    routeLog.serve({ [url]: STEPS_PAGE, [FINALIZE]: { body: '{"errors":[{"message":"x"}]}', contentType: 'application/json',
      status: 400 } });
    const before = (await mock.requestsTo(APPLIED)).length;
    const page = await extContext.newPage();
    const tabId = await submitAt(ext, page, url);
    await expect.poll(() => finalizedOn(page)).toEqual([400]);
    // A sign would be told within the answer's own task; a second is ample for its message to the worker.
    await page.waitForTimeout(1_000);
    expect(await submittedState(ext, tabId)).toBeUndefined();
    expect((await mock.requestsTo(APPLIED)).length).toBe(before);
    expect(routeLog.unexpected).toEqual([]);
  });
});
