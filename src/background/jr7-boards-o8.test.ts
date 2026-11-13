/*
 * jr7 BOARDS-7 P2 (FIX7PLAN §2 O-8, §5 D-1, §8; SP\jr7\build\BOARDS-7.md): SmartRecruiters' chained run, through the
 * real worker (index.ts, frames.ts, chain.ts, submissions.ts, queue-runner.ts) over WXT's fake browser, the hand fakes
 * and a fake TailorIT, at the addresses of the owner's snapshot7 smartrecruiter1 captures (the committed fixtures'
 * headers: the posting at its lower-case company address, its one-click application and the page after Submit; no
 * per-person value is in an address). The Queue tab opens the posting (queueApplicationUrl: SmartRecruiters' posting,
 * never its one-click application), the one-click page chains to it by its referrer, the screening step is a route of
 * the same document, and its Submit is armed under the posting's key; the app then routes to /success:
 * - the page's own confirmation (submit/detected 'confirmation-page' under the publication's key, as the content
 *   runtime sends it: J7V-SR-5) is taken by the arm's pageKey (AUTOV-01, D-1 item 1): the job is submitted, TailorIT told
 *   once (POST …/result), never POST /applied;
 * - the drawn sign (J7-SR-4, D-1 item 2: the arming document's own watch reports 'success-message' under the arm's key)
 *   is taken alike, and with both the job is told once;
 * - another publication's page after Submit is refused, and the job stays open.
 * The agent (Run auto-apply) takes no SmartRecruiters job before TAILORIT-7's 7b (O-9): this is the gate's worker test,
 * on the run that opens SmartRecruiters today.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import oneClickHtml from '../../fixtures/smartrecruiters/jr7-smartrecruiter1-oneclick-filled.html?raw';
import postingHtml from '../../fixtures/smartrecruiters/jr7-smartrecruiter1-posting.html?raw';
import successHtml from '../../fixtures/smartrecruiters/jr7-smartrecruiter1-success.html?raw';
import { applicationOf } from '../adapters';
import { hrefHash } from '../adapters/chain';
import { queueApplicationUrl } from '../contract/tailorit';
import type { QueueTabs } from '../platform/types';
import { contentSender, pageSender, startTestWorker, tokenRecord, type TestWorker } from './worker.testkit';

const sourceOf = (html: string): string => /"source":"([^"]+)"/.exec(html)![1]!;
/** The snapshot7 addresses (the fixtures' headers): the posting as captured (its company in lower case), the one-click
 *  page its "I'm interested" opened, its screening step (a route of the same app), and the page after Submit. */
const POSTING = sourceOf(postingHtml);
const ONE_CLICK = sourceOf(oneClickHtml);
const SUCCESS = sourceOf(successHtml);
const SCREENING = SUCCESS.replace('/success?', '/screening?');
/** Another publication of the same company (a made-up UUID). */
const OTHER_SUCCESS = SUCCESS.replace(/publication\/[0-9a-f-]{36}\//, 'publication/99999999-2222-4333-8444-555555555555/');

const OPTIONS = pageSender('options.html');
const ROW = { id: '7c1e4f2a-9b3d-4a6e-8f50-2d9c1b7e3a70', jobId: 2042, url: POSTING, company: 'Company',
  title: 'Posting', location: 'Remote', active: true, state: 'queued', reason: null, source: 'manual', attempts: 0,
  aiGuesses: null, createdAt: '2026-11-11T08:00:00.000Z', startedAt: null, finishedAt: null, applyUrl: POSTING,
  run: null };
const TASK = { id: ROW.id, jobId: ROW.jobId, url: ROW.url, company: ROW.company, title: ROW.title, resumeId: 'resume-7' };
const TAB = 61;

let logs: MockInstance;
beforeEach(() => {
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => logs.mockRestore());

/** Tabs that open one by one, as Chrome's do (queue-worker.test.ts's). */
function tabs(): QueueTabs & { opened: string[] } {
  const live = new Set<number>();
  const opened: string[] = [];
  let next = TAB;
  return {
    opened,
    async open() {
      live.add(next);
      return next++;
    },
    async navigate(tabId, url) {
      opened.push(url);
      return live.has(tabId);
    },
    focus: async (tabId) => live.has(tabId),
    state: async (tabId) => (live.has(tabId) ? 'background' : 'gone'),
    async close(tabId) {
      live.delete(tabId);
    },
  };
}

type Answer = { ok: boolean; error?: string; data?: { chained?: { applicationKey: string }; runId?: string } };
const keyOf = (href: string) => applicationOf(new URL(href))!.applicationKey;
/** The queued tab's top frame, at `url`, in document `documentId`. */
const frame = (url: string, documentId: string) => contentSender({ url, tab: { id: TAB, url }, frameId: 0, documentId });
const hello = (worker: TestWorker, url: string, documentId: string, extra: Record<string, unknown> = {}) =>
  worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true, ...extra }, frame(url, documentId)) as
    Promise<Answer>;
const detected = (worker: TestWorker, url: string, documentId: string, applicationKey: string,
  evidence: 'confirmation-page' | 'success-message') =>
  worker.deliver({ v: 1, type: 'submit/detected', applicationKey, evidence }, frame(url, documentId)) as Promise<Answer>;
const results = (worker: TestWorker) => worker.tailorit.requests
  .filter((request) => request.path === `/api/autofill/agent/${ROW.id}/result`).map((request) => JSON.parse(request.body!));

/** The Queue tab's SmartRecruiters job, opened at its posting; the one-click page chained to it; the screening step a
 *  route of that document, its Submit armed (the person's press: the queue's Submit Manual). */
async function armedAtScreening(): Promise<{ worker: TestWorker; posting: string }> {
  const worker = await startTestWorker({ token: tokenRecord(), queueTabs: tabs() });
  worker.tailorit.reply('GET /api/autofill/agent/queue', { json: { items: [ROW], total: 1, limit: 100 } });
  worker.tailorit.reply(`POST /api/autofill/agent/${ROW.id}/opened`, { json: { item: TASK, state: 'running',
    reason: null } });
  worker.tailorit.reply(`POST /api/autofill/agent/${ROW.id}/result`, { status: 204 });
  worker.tailorit.reply('GET /api/autofill/agent/next', { json: { item: null } });
  worker.fakes.frameAnswers = () => ({ ok: true, data: {} });
  expect(await worker.deliver({ v: 1, type: 'queue/start' }, contentSender())).toMatchObject({ ok: true,
    data: { phase: 'running', opened: 1 } });
  const posting = keyOf(POSTING);
  // The posting (no form): its "I'm interested" is the entry the tab's Autofill presses.
  await hello(worker, POSTING, 'doc-posting', { hasForm: false });
  // The one-click page, chained to the posting by its referrer: the posting's key.
  expect((await hello(worker, ONE_CLICK, 'doc-app', { chain: { from: hrefHash(POSTING) } })).data?.chained)
    .toEqual({ applicationKey: posting });
  const begun = await worker.deliver({ v: 1, type: 'run/begin', applicationKey: posting, trigger: 'panel',
    dryRun: false }, frame(ONE_CLICK, 'doc-app')) as Answer;
  expect(begun.ok).toBe(true);
  // Next: the app routes to its screening step in the same document.
  await hello(worker, SCREENING, 'doc-app', { nav: 1 });
  expect(await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: posting, by: 'panel',
    runId: begun.data!.runId }, frame(SCREENING, 'doc-app'))).toEqual({ ok: true, data: {} });
  return { worker, posting };
}

describe('jr7 BOARDS-7 P2, O-8: SmartRecruiters\' chained run recorded once (the snapshot7 addresses)', () => {
  it('reads the capture\'s addresses: the Queue tab opens the posting; the pages after it share the publication\'s key',
    () => {
      expect(queueApplicationUrl(POSTING)).toBe(POSTING.replace(/\/$/, ''));
      expect(applicationOf(new URL(POSTING))?.page).toBe('posting');
      expect([applicationOf(new URL(ONE_CLICK))?.page, applicationOf(new URL(SCREENING))?.page,
        applicationOf(new URL(SUCCESS))?.page]).toEqual(['application', 'application', 'confirmation']);
      expect(keyOf(SUCCESS)).toBe(keyOf(ONE_CLICK));
      expect(keyOf(SUCCESS)).not.toBe(keyOf(POSTING));
    });

  it('the route to /success: the page\'s own confirmation, under the publication\'s key, finishes the job submitted once',
    async () => {
      const { worker } = await armedAtScreening();
      await hello(worker, SUCCESS, 'doc-app', { hasForm: false, nav: 2 });
      expect(await detected(worker, SUCCESS, 'doc-app', keyOf(SUCCESS), 'confirmation-page')).toEqual({ ok: true,
        data: {} });
      expect(results(worker)).toEqual([{ state: 'submitted', reason: null, aiGuesses: 0 }]);
      expect(worker.tailorit.count('POST /api/autofill/applied')).toBe(0);
      // Once: the drawn sign the arming document's watch reports after it records nothing more.
      expect(await detected(worker, SUCCESS, 'doc-app', keyOf(POSTING), 'success-message'))
        .toMatchObject({ ok: false });
      expect(results(worker)).toHaveLength(1);
      expect(await worker.deliver({ v: 1, type: 'queue/status' }, OPTIONS)).toMatchObject({ ok: true,
        data: { counts: { submitted: 1 } } });
    });

  it('the drawn sign alone (J7-SR-4: the arming document\'s watch, under the arm\'s key) finishes it submitted once',
    async () => {
      const { worker, posting } = await armedAtScreening();
      await hello(worker, SUCCESS, 'doc-app', { hasForm: false, nav: 2 });
      expect(await detected(worker, SUCCESS, 'doc-app', posting, 'success-message')).toEqual({ ok: true, data: {} });
      expect(results(worker)).toEqual([{ state: 'submitted', reason: null, aiGuesses: 0 }]);
      expect(await detected(worker, SUCCESS, 'doc-app', keyOf(SUCCESS), 'confirmation-page'))
        .toMatchObject({ ok: false });
      expect(results(worker)).toHaveLength(1);
      expect(worker.tailorit.count('POST /api/autofill/applied')).toBe(0);
    });

  it('a new document at /success (a reload) is taken by the arm\'s page key too, once', async () => {
    const { worker } = await armedAtScreening();
    await hello(worker, SUCCESS, 'doc-success', { hasForm: false });
    expect(await detected(worker, SUCCESS, 'doc-success', keyOf(SUCCESS), 'confirmation-page')).toEqual({ ok: true,
      data: {} });
    expect(results(worker)).toHaveLength(1);
  });

  it('refuses another publication\'s page after Submit: nothing recorded, the job still open', async () => {
    const { worker, posting } = await armedAtScreening();
    await hello(worker, OTHER_SUCCESS, 'doc-other', { hasForm: false });
    // Its page says its own key, as the content runtime sends it (no chain reads /success): no arm, no pairing.
    expect(await detected(worker, OTHER_SUCCESS, 'doc-other', keyOf(OTHER_SUCCESS), 'confirmation-page'))
      .toMatchObject({ ok: false, error: 'expired' });
    // Nor the arm's page key said from that page: its own address reads another key (AUTO-7 A1's rule).
    expect(await detected(worker, OTHER_SUCCESS, 'doc-other', keyOf(SUCCESS), 'confirmation-page'))
      .toMatchObject({ ok: false, error: 'expired' });
    expect(results(worker)).toEqual([]);
    expect(posting).toBe(keyOf(POSTING));
    expect(worker.tailorit.count('POST /api/autofill/applied')).toBe(0);
    expect(await worker.deliver({ v: 1, type: 'queue/status' }, OPTIONS)).toMatchObject({ ok: true,
      data: { counts: { submitted: 0 } } });
  });
});
