/*
 * jr7 FIX-background (the review's D-2 and A-5): Workday's page after submitting, through the real worker (index.ts,
 * submissions.ts) over WXT's fake browser and a fake TailorIT, with Workday's own adapter (adapters/workday/index.ts
 * confirmationAfter, WD7-05), no stand-in. Synthetic addresses of the snapshot7 shapes:
 * - the Submit is armed on the application's form, /en-US/<Site>/job/<location>/<slug>/apply/applyManually; the arm
 *   keeps the posting's canonical address (no locale, no /apply), which TailorIT records Applied with;
 * - D-2: the page after submitting that names a new Job_Application_ID, /en-US/<Site>?Job_Application_ID=<id>, reached by
 *   a route of the arming document (submit/detected 'confirmation-page' under the arm's key) or loaded as a new document
 *   (submit/after, read by the adapter against the arm's address), records POST /applied once; another tenant or site,
 *   a late page and another frame are refused;
 * - A-5: the candidate home's completed task, /en-US/<Site>/jobTasks/completed/application, also where a person opens
 *   their applications after a Submit Workday refused, records nothing by its address alone (submissions.ts
 *   routeWaitsForSign): the arm waits for Workday's finalize answered (the arming document's network sign) or its
 *   "Application Submitted" dialog drawn there (a success message), within SUBMIT_ARM_MS, and records it once.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { applicationOf } from '../adapters';
import { lookupAddressOf } from './job-cards';
import { CONFIRMATION_PAGE_MS, routeWaitsForSign, SUBMIT_ARM_MS, SUBMIT_ARM_PREFIX } from './submissions';
import { contentSender, goldens, startTestWorker, tokenRecord, type TestWorker } from './worker.testkit';

let logs: MockInstance;
beforeEach(() => {
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => logs.mockRestore());

const TAB = 7;
const HOST = 'https://acme.wd5.myworkdayjobs.com';
const POSTING = `${HOST}/en-US/External/job/Remote-USA/Senior-Engineer_R12345`;
const FORM = `${POSTING}/apply/applyManually`;
/** The page after submitting that names the new application (its id is never read: whether, never which). */
const SUBMITTED = `${HOST}/en-US/External?Job_Application_ID=a1b2c3`;
/** The candidate home's completed task (A-5). */
const COMPLETED = `${HOST}/en-US/External/jobTasks/completed/application`;
const KEY = applicationOf(new URL(FORM))!.applicationKey;
type Answer = { ok: boolean; error?: string };

const frame = (url: string, documentId: string, frameId = 0) =>
  contentSender({ url, tab: { id: TAB, url }, frameId, documentId });

/** The worker, with the Submit of the application armed on its form (the run's Submit Auto). */
async function armed(): Promise<TestWorker> {
  const worker = await startTestWorker({ token: tokenRecord() });
  worker.tailorit.reply('POST /api/autofill/applied', { json: goldens.lookup });
  await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, frame(FORM, 'doc-app'));
  expect(await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: KEY, by: 'auto' }, frame(FORM, 'doc-app')))
    .toEqual({ ok: true, data: {} });
  return worker;
}
const detected = (worker: TestWorker, sender: ReturnType<typeof frame>,
  evidence: 'confirmation-page' | 'success-message' | 'network') =>
  worker.deliver({ v: 1, type: 'submit/detected', applicationKey: KEY, evidence }, sender) as Promise<Answer>;
const after = (worker: TestWorker, sender: ReturnType<typeof frame>) =>
  worker.deliver({ v: 1, type: 'submit/after' }, sender) as Promise<Answer>;
const applied = (worker: TestWorker) => worker.tailorit.requests
  .filter((request) => request.method === 'POST' && request.path === '/api/autofill/applied')
  .map((request) => JSON.parse(request.body!) as Record<string, unknown>);
const armOf = async (worker: TestWorker) => Object.values(await worker.platform.storage.session
  .getMany(SUBMIT_ARM_PREFIX))[0] as { detectedAt?: number } | undefined;

describe('jr7 FIX-background, D-2: Workday’s page after submitting, recorded through the real worker', () => {
  it('reads the shapes: no parser reads either page after submitting, and the arm keeps the canonical posting', () => {
    expect(applicationOf(new URL(SUBMITTED))).toBeNull();
    expect(applicationOf(new URL(COMPLETED))).toBeNull();
    expect(lookupAddressOf(FORM)).toBe(POSTING.replace('/en-US', ''));
    expect(routeWaitsForSign('workday', SUBMITTED)).toBe(false);
  });

  it('(a) a route of the arming document to it records POST /applied once, by the posting’s canonical address', async () => {
    const worker = await armed();
    expect(await detected(worker, frame(SUBMITTED, 'doc-app'), 'confirmation-page')).toEqual({ ok: true, data: {} });
    expect(applied(worker)).toEqual([{ url: POSTING.replace('/en-US', '') }]);
    expect(await detected(worker, frame(SUBMITTED, 'doc-app'), 'confirmation-page')).toMatchObject({ ok: false });
    expect(applied(worker)).toHaveLength(1);
  });

  // Undo proof: Workday's confirmationAfter returns null (no reading) and this fails ('expired', nothing posted).
  it('(b) a new document there, through submit/after and Workday’s own confirmationAfter, records it once', async () => {
    const worker = await armed();
    expect(await after(worker, frame(SUBMITTED, 'doc-done'))).toEqual({ ok: true, data: {} });
    expect(applied(worker)).toEqual([{ url: POSTING.replace('/en-US', '') }]);
    expect(await after(worker, frame(SUBMITTED, 'doc-done'))).toMatchObject({ ok: false, error: 'expired' });
    expect(applied(worker)).toHaveLength(1);
    // The same with no locale in the page's address (the site loads so): one site whatever its locale.
    const bare = await armed();
    expect(await after(bare, frame(SUBMITTED.replace('/en-US', ''), 'doc-done'))).toEqual({ ok: true, data: {} });
    expect(applied(bare)).toHaveLength(1);
  });

  it('(c) refuses another tenant, another site, a late page and another frame, by either way', async () => {
    const refused: Array<[string, (worker: TestWorker) => Promise<Answer>]> = [
      ['another tenant', (w) => after(w, frame(SUBMITTED.replace('acme.wd5', 'globex.wd5'), 'doc-done'))],
      ['another site', (w) => after(w, frame(SUBMITTED.replace('/External?', '/Internal?'), 'doc-done'))],
      ['another frame (a new document)', (w) => after(w, frame(SUBMITTED, 'doc-done', 3))],
      ['another frame (a route)', (w) => detected(w, frame(SUBMITTED, 'doc-sub', 3), 'confirmation-page')],
      ['two ids', (w) => after(w, frame(`${SUBMITTED}&Job_Application_ID=d4`, 'doc-done'))],
      ['the form again', (w) => after(w, frame(FORM, 'doc-again'))],
    ];
    for (const [name, sign] of refused) {
      const worker = await armed();
      expect(await sign(worker), name).toMatchObject({ ok: false });
      expect(applied(worker), name).toEqual([]);
    }
    for (const way of ['route', 'new document'] as const) {
      const worker = await armed();
      worker.clock.now += CONFIRMATION_PAGE_MS + 1;
      const answer = way === 'route' ? await detected(worker, frame(SUBMITTED, 'doc-app'), 'confirmation-page')
        : await after(worker, frame(SUBMITTED, 'doc-done'));
      expect(answer, way).toMatchObject({ ok: false, error: 'expired' });
      expect(applied(worker), way).toEqual([]);
    }
  });
});

describe('jr7 FIX-background, A-5: Workday’s completed task alone records nothing; its sign does', () => {
  // Undo proof: drop ROUTE_ADDRESS_WAITS' workday entry and this fails (the route alone records Applied).
  it('the route of the arming document, or a new document there, records nothing and leaves the arm waiting',
    async () => {
      expect(routeWaitsForSign('workday', COMPLETED)).toBe(true);
      expect(routeWaitsForSign('workday', `${COMPLETED}/`)).toBe(true);
      const worker = await armed();
      expect(await detected(worker, frame(COMPLETED, 'doc-app'), 'confirmation-page'))
        .toMatchObject({ ok: false, error: 'expired' });
      expect(await after(worker, frame(COMPLETED, 'doc-home'))).toMatchObject({ ok: false, error: 'expired' });
      expect(await after(worker, frame(COMPLETED.replace('/en-US', ''), 'doc-home'))).toMatchObject({ ok: false });
      expect(applied(worker)).toEqual([]);
      // Still armed, its sign not taken.
      expect(await armOf(worker)).toMatchObject({ at: expect.any(Number) });
      expect((await armOf(worker))!.detectedAt).toBeUndefined();
    });

  it('Workday’s finalize answered (the arming document’s network sign) then records it once', async () => {
    const worker = await armed();
    expect(await detected(worker, frame(COMPLETED, 'doc-app'), 'confirmation-page')).toMatchObject({ ok: false });
    expect(await detected(worker, frame(COMPLETED, 'doc-app'), 'network')).toEqual({ ok: true, data: {} });
    expect(applied(worker)).toEqual([{ url: POSTING.replace('/en-US', '') }]);
    expect(await detected(worker, frame(COMPLETED, 'doc-app'), 'network')).toMatchObject({ ok: false });
    expect(applied(worker)).toHaveLength(1);
  });

  it('its "Application Submitted" dialog drawn there (a success message) records it once, minutes later', async () => {
    const worker = await armed();
    expect(await detected(worker, frame(COMPLETED, 'doc-app'), 'confirmation-page')).toMatchObject({ ok: false });
    worker.clock.now += CONFIRMATION_PAGE_MS + 30_000;
    expect(CONFIRMATION_PAGE_MS + 30_000).toBeLessThan(SUBMIT_ARM_MS);
    expect(await detected(worker, frame(COMPLETED, 'doc-app'), 'success-message')).toEqual({ ok: true, data: {} });
    expect(applied(worker)).toHaveLength(1);
    expect(await detected(worker, frame(COMPLETED, 'doc-app'), 'success-message')).toMatchObject({ ok: false });
    expect(applied(worker)).toHaveLength(1);
  });
});
