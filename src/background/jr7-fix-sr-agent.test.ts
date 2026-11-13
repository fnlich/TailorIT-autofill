/*
 * jr7 FIX-background (the review's D-1; FIX7PLAN §2 O-8, §5 D-1, §8): SmartRecruiters' chained run through the AGENT
 * (Run auto-apply), the agent twin of jr7-boards-o8.test.ts (which drives the Queue tab), through the real worker
 * (index.ts, agent.ts, frames.ts, chain.ts, submissions.ts) over WXT's fake browser, the hand fakes and a fake TailorIT,
 * at the addresses of the owner's snapshot7 smartrecruiter1 captures (the committed fixtures' headers; no per-person
 * value is in an address):
 * - the agent opens the posting (TailorIT's agentApplicationUrl) under its key and presses its entry ("I'm interested":
 *   agent/enter, then the content's agent/entered); the one-click page, a new document chained to the posting by its
 *   referrer, is the job's (the posting's key): the agent starts its run there (run/start);
 * - the screening step is a route of that document, and its Submit is armed under the posting's key (Submit Auto);
 * - the route to /success: the page's own confirmation, under the publication's key, is taken by the arm's pageKey
 *   (AUTOV-01): the job is submitted, TailorIT told once (POST …/result), never POST /applied;
 * - a reload at /success (a new document under the publication's key): the agent holds it (AUTO7-08 (b): the job's own
 *   platform's page after submitting under another key), never ends or closes it, and its confirmation, taken by the
 *   pageKey, records the job once;
 * - another publication's page after Submit records nothing and does not end the job submitted.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import oneClickHtml from '../../fixtures/smartrecruiters/jr7-smartrecruiter1-oneclick-filled.html?raw';
import postingHtml from '../../fixtures/smartrecruiters/jr7-smartrecruiter1-posting.html?raw';
import successHtml from '../../fixtures/smartrecruiters/jr7-smartrecruiter1-success.html?raw';
import { applicationOf } from '../adapters';
import { hrefHash } from '../adapters/chain';
import type { TabMessage } from '../platform/fake';
import type { WorkerPlatform } from '../platform/types';
import { AGENT_CONFIRM_MS, AGENT_RUN_KEY, agentAddressOf } from './agent';
import { contentSender, pageSender, sentToFrames, startTestWorker, tokenRecord, typeOfSent, type TestWorker } from './worker.testkit';

const sourceOf = (html: string): string => /"source":"([^"]+)"/.exec(html)![1]!;
const POSTING = sourceOf(postingHtml);
const ONE_CLICK = sourceOf(oneClickHtml);
const SUCCESS = sourceOf(successHtml);
const SCREENING = SUCCESS.replace('/success?', '/screening?');
/** Another publication of the same company (a made-up UUID). */
const OTHER_SUCCESS = SUCCESS.replace(/publication\/[0-9a-f-]{36}\//, 'publication/99999999-2222-4333-8444-555555555555/');

const OPTIONS = pageSender('options.html');
const TASK = { id: '7c1e4f2a-9b3d-4a6e-8f50-2d9c1b7e3a71', jobId: 2043, url: POSTING, company: 'Company',
  title: 'Posting', resumeId: null };
const AGENT_TAB = 43;

let logs: MockInstance;
beforeEach(() => {
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => logs.mockRestore());

/** Windows that open one tab each, as Chrome's do (agent-worker.test.ts's). */
function windows(): WorkerPlatform['windows'] & { opened: string[]; closed: number[] } {
  const tabs = new Set<number>();
  const opened: string[] = [];
  const closed: number[] = [];
  return {
    opened,
    closed,
    async open() {
      tabs.add(AGENT_TAB);
      return { windowId: 5, tabId: AGENT_TAB };
    },
    async navigate(tabId, url) {
      opened.push(url);
      return tabs.has(tabId);
    },
    async closeTab(tabId) {
      closed.push(tabId);
      tabs.delete(tabId);
    },
    tabExists: async (tabId) => tabs.has(tabId),
    othersOpen: async () => true,
  };
}

type Answer = { ok: boolean; error?: string; data?: { chained?: { applicationKey: string }; runId?: string } };
const keyOf = (href: string) => applicationOf(new URL(href))!.applicationKey;
const frame = (url: string, documentId: string) =>
  contentSender({ url, tab: { id: AGENT_TAB, url }, frameId: 0, documentId });
const hello = (worker: TestWorker, url: string, documentId: string, extra: Record<string, unknown> = {}) =>
  worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true, ...extra }, frame(url, documentId)) as
    Promise<Answer>;
const detected = (worker: TestWorker, url: string, documentId: string, applicationKey: string,
  evidence: 'confirmation-page' | 'success-message') =>
  worker.deliver({ v: 1, type: 'submit/detected', applicationKey, evidence }, frame(url, documentId)) as Promise<Answer>;
const results = (worker: TestWorker) => worker.tailorit.requests
  .filter((request) => request.path === `/api/autofill/agent/${TASK.id}/result`).map((request) => JSON.parse(request.body!));
const runRecord = async () => (await fakeBrowser.storage.local.get(AGENT_RUN_KEY))[AGENT_RUN_KEY] as
  { result: unknown; tabId: number | null; heldAt?: number | null } | undefined;
const sentOf = (worker: TestWorker, type: string) => sentToFrames(worker)
  .filter((sent) => sent.tabId === AGENT_TAB && typeOfSent(sent) === type);

/** Run auto-apply's SmartRecruiters job: the posting opened, its entry pressed, the one-click page chained to it, the
 *  agent's run there, the screening route, and its Submit armed under the posting's key. */
async function armedAtScreening(): Promise<{ worker: TestWorker; win: ReturnType<typeof windows>; posting: string }> {
  const win = windows();
  const worker = await startTestWorker({ token: tokenRecord(), windows: win });
  worker.tailorit.reply('GET /api/autofill/agent/next', { json: { item: TASK } });
  worker.tailorit.reply(`POST /api/autofill/agent/${TASK.id}/result`, { status: 204 });
  worker.fakes.frameAnswers = (sent: TabMessage) => (typeOfSent(sent) === 'agent/enter'
    ? { ok: true, data: { outcome: 'pressed' } } : { ok: true, data: {} });
  expect(await worker.deliver({ v: 1, type: 'agent/set', on: true, confirmed: true }, OPTIONS))
    .toMatchObject({ ok: true, data: { on: true } });
  worker.timers.advance(1);
  const opened = agentAddressOf(POSTING)!;
  await vi.waitFor(() => expect(win.opened).toEqual([opened.address]));
  await vi.waitFor(async () => expect(await runRecord()).toMatchObject({ tabId: AGENT_TAB, result: null }));
  const posting = keyOf(POSTING);
  expect(opened.applicationKey).toBe(posting);
  // The posting (no form): the agent presses its entry, "I'm interested"; the page says so before it goes.
  await hello(worker, opened.address, 'doc-posting', { hasForm: false });
  await vi.waitFor(() => expect(sentOf(worker, 'agent/enter')).toHaveLength(1));
  expect(await worker.deliver({ v: 1, type: 'agent/entered' }, frame(opened.address, 'doc-posting')))
    .toEqual({ ok: true, data: {} });
  // The one-click page, a new document chained to the posting by its referrer: the job's own (the posting's key).
  expect((await hello(worker, ONE_CLICK, 'doc-app', { chain: { from: hrefHash(opened.address) } })).data?.chained)
    .toEqual({ applicationKey: posting });
  await vi.waitFor(() => expect(sentOf(worker, 'run/start').map((sent) => sent.options))
    .toEqual([{ frameId: 0, documentId: 'doc-app' }]));
  const begun = await worker.deliver({ v: 1, type: 'run/begin', applicationKey: posting, trigger: 'agent',
    dryRun: false }, frame(ONE_CLICK, 'doc-app')) as Answer;
  expect(begun.ok).toBe(true);
  // Its screening step, a route of the same document; Submit Auto's press there.
  await hello(worker, SCREENING, 'doc-app', { nav: 1 });
  expect(await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: posting, by: 'auto',
    runId: begun.data!.runId }, frame(SCREENING, 'doc-app'))).toEqual({ ok: true, data: {} });
  expect(await runRecord()).toMatchObject({ result: null });
  return { worker, win, posting };
}

describe('jr7 FIX-background, D-1: SmartRecruiters’ chained run through the agent, recorded once', () => {
  it('reads the capture’s addresses: the agent opens the posting; the pages after it share the publication’s key', () => {
    expect(agentAddressOf(POSTING)?.applicationKey).toBe(keyOf(POSTING));
    expect([applicationOf(new URL(ONE_CLICK))?.page, applicationOf(new URL(SCREENING))?.page,
      applicationOf(new URL(SUCCESS))?.page]).toEqual(['application', 'application', 'confirmation']);
    expect(keyOf(SUCCESS)).toBe(keyOf(ONE_CLICK));
    expect(keyOf(SUCCESS)).not.toBe(keyOf(POSTING));
    expect(keyOf(OTHER_SUCCESS)).not.toBe(keyOf(SUCCESS));
  });

  // Undo proof: confirmedArm without the pageKey pairing (AUTOV-01) and this fails ('expired', nothing told).
  it('the route to /success: its confirmation under the publication’s key finishes the job submitted, told once',
    async () => {
      const { worker, win, posting } = await armedAtScreening();
      await hello(worker, SUCCESS, 'doc-app', { hasForm: false, nav: 2 });
      expect(results(worker)).toEqual([]);
      expect(await detected(worker, SUCCESS, 'doc-app', keyOf(SUCCESS), 'confirmation-page'))
        .toEqual({ ok: true, data: {} });
      expect(results(worker)).toEqual([{ state: 'submitted', reason: null, aiGuesses: 0 }]);
      expect(worker.tailorit.count('POST /api/autofill/applied')).toBe(0);
      // Once: the drawn sign the arming document's watch reports after it records nothing more.
      expect(await detected(worker, SUCCESS, 'doc-app', posting, 'success-message')).toMatchObject({ ok: false });
      expect(results(worker)).toHaveLength(1);
      expect(await worker.deliver({ v: 1, type: 'agent/status' }, OPTIONS)).toMatchObject({ ok: true,
        data: { doneToday: 1, last: { state: 'submitted', reason: null } } });
      expect(win.closed).toEqual([AGENT_TAB]);
    });

  // Undo proofs: the pageKey pairing dropped, or AUTO7-08 (b)'s hold (agent.ts hello: another key's page after
  // submitting on the job's platform ends the job needs-you 'other' at once) dropped, and this fails.
  it('a reload at /success: held by the agent, never ended, then its confirmation records the job once', async () => {
    const { worker, win } = await armedAtScreening();
    await hello(worker, SUCCESS, 'doc-success', { hasForm: false });
    // Held for its sign (AUTO7-08 b): no result, the tab open.
    expect(results(worker)).toEqual([]);
    expect(win.closed).toEqual([]);
    expect(await runRecord()).toMatchObject({ result: null });
    expect(await detected(worker, SUCCESS, 'doc-success', keyOf(SUCCESS), 'confirmation-page'))
      .toEqual({ ok: true, data: {} });
    expect(results(worker)).toEqual([{ state: 'submitted', reason: null, aiGuesses: 0 }]);
    expect(worker.tailorit.count('POST /api/autofill/applied')).toBe(0);
    expect(await detected(worker, SUCCESS, 'doc-success', keyOf(SUCCESS), 'confirmation-page'))
      .toMatchObject({ ok: false });
    expect(results(worker)).toHaveLength(1);
  });

  it('another publication’s page after Submit records nothing, and the job is not ended submitted', async () => {
    const { worker, posting } = await armedAtScreening();
    await hello(worker, OTHER_SUCCESS, 'doc-other', { hasForm: false });
    // Its page says its own key: no arm, no pairing; nor the arm's page key said from that page.
    expect(await detected(worker, OTHER_SUCCESS, 'doc-other', keyOf(OTHER_SUCCESS), 'confirmation-page'))
      .toMatchObject({ ok: false, error: 'expired' });
    expect(await detected(worker, OTHER_SUCCESS, 'doc-other', keyOf(SUCCESS), 'confirmation-page'))
      .toMatchObject({ ok: false, error: 'expired' });
    expect(results(worker)).toEqual([]);
    expect(worker.tailorit.count('POST /api/autofill/applied')).toBe(0);
    expect(await runRecord()).toMatchObject({ result: null });
    expect(posting).toBe(keyOf(POSTING));
    // Held for the job's own sign (AUTO7-08 b), which never comes: AGENT_CONFIRM_MS later it is the person's, timed_out
    // (it may have been sent), never submitted.
    worker.clock.now += AGENT_CONFIRM_MS + 100;
    worker.timers.advance(AGENT_CONFIRM_MS + 100);
    await vi.waitFor(() => expect(results(worker)).toEqual([{ state: 'needs-you', reason: 'timed_out', aiGuesses: 0 }]));
    expect(worker.tailorit.count('POST /api/autofill/applied')).toBe(0);
  });
});
