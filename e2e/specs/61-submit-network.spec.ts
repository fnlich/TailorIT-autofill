/*
 * v5 p2-detect (PLAN decision 14, adopted for "applied" detection; the engine audit's J11 and gap 3) end to end, on the
 * synthetic Workday steps page at Review (fixtures/synthetic/workday/steps.html, ?review&finalize): the page-world
 * submit watcher (src/entrypoints/submit-watch.content.ts, world MAIN, from document_start) sees the page's own
 * finalize, POST /wday/cxs/<tenant>/jobapplication/<id>/finalize, and its answer's status alone:
 * - answered 200 after the person's own Submit, by fetch or by XMLHttpRequest, the application is recorded Applied
 *   (POST /applied) from the tab that armed it;
 * - answered 400, or 200 with an answer that names no application (v5 p2-detect, the owner's word of 2026-11-08: Jobright's
 *   reading of the finalize's answer), nothing is recorded, and the page still had its own answer.
 * - the P2 review (M3): on Workday's shared host, loaded at the job list and moved to the form by the app's own
 *   pushState, the watcher was there from the list, and the Submit is recorded the same way.
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

  // The owner's word of 2026-11-08 (Jobright's reading): a 200 that names no application is no sign either.
  test('Workday: a finalize answered 400, or 200 naming no application, records nothing, and the page has its own answer',
    async ({ extContext, connected: ext, routeLog }) => {
      for (const [status, body] of [[400, '{"errors":[{"message":"x"}]}'], [200, '{"errors":[{"message":"x"}]}']] as const) {
        const url = reviewAt(`finalize&s=${status}`);
        routeLog.serve({ [url]: STEPS_PAGE, [FINALIZE]: { body, contentType: 'application/json', status } });
        const before = (await mock.requestsTo(APPLIED)).length;
        const page = await extContext.newPage();
        const tabId = await submitAt(ext, page, url);
        await expect.poll(() => finalizedOn(page)).toEqual([status]);
        // A sign would be told within the answer's own task; a second is ample for its message to the worker.
        await page.waitForTimeout(1_000);
        expect(await submittedState(ext, tabId), String(status)).toBeUndefined();
        expect((await mock.requestsTo(APPLIED)).length, String(status)).toBe(before);
        await page.close();
      }
      expect(routeLog.unexpected).toEqual([]);
    });

  // The P2 review (M3): Workday's shared host is a single-page app a person enters at its job list. The watcher installs
  // there (anywhere under /recruiting/<tenant>/<site>: adapters/bridge-address.ts submitWatchInstallsAt), so after the
  // app's own move to the form (its pushState, no new document) the person's Submit is recorded by the finalize.
  test("Workday's shared host: loaded at the job list, moved to the form in the app, the person's Submit is recorded",
    async ({ extContext, connected: ext, routeLog }) => {
      const site = 'https://wd5.myworkdaysite.com';
      const list = `${site}/recruiting/tailoritfixture/careers?review&finalize`;
      const form = '/recruiting/tailoritfixture/careers/job/x/Fixture-Steps_JR-0000002/apply/applyManually?review&finalize';
      routeLog.serve({ [list]: STEPS_PAGE,
        [`${site}/wday/cxs/tailoritfixture/jobapplication/JA-0000002/finalize`]: { body: '{"id":"JA-0000002"}',
          contentType: 'application/json' } });
      const before = (await mock.requestsTo(APPLIED)).length;
      const page = await extContext.newPage();
      await page.goto(list);
      await page.evaluate((to) => history.pushState({}, '', to), form);
      const tabId = await ext.fill(page);
      await ext.settled(tabId);
      await page.bringToFront();
      await page.locator('[data-automation-id="pageFooterNextButton"]').click();
      await expect.poll(() => finalizedOn(page)).toEqual([200]);
      await expect.poll(() => submittedState(ext, tabId)).toBe('recorded');
      expect((await mock.requestsTo(APPLIED)).length - before).toBe(1);
      await page.close();
      expect(routeLog.unexpected).toEqual([]);
      expect(routeLog.submitted).toEqual([]);
    });
});
