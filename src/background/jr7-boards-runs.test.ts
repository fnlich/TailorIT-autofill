/*
 * jr7 BOARDS-7 P2 (FIX7PLAN §6.13 "P2", §8): Jobvite's and JazzHR's runs to submitted, through the real worker
 * (index.ts, frames.ts, submissions.ts, queue-runner.ts) and the Queue tab, at the addresses of the owner's snapshot7
 * captures (the committed fixtures' headers: jobvite1, applytojob1; no per-person value in an address):
 * - Jobvite: the Queue tab opens the posting's …/apply (queueApplicationUrl: Jobvite's canonical[0]); its steps are
 *   one document (AngularJS), Send Application is armed under the application's key, and /applyConfirmation (the
 *   same key: url.ts reads it as that application's page after submitting) finishes the job submitted once.
 *   Jobvite joins Run auto-apply only with TAILORIT-7's 7b (O-9): the agent half is INT-7's after the pull.
 * - JazzHR: the Queue tab opens the posting's page, which holds its form; Submit is armed under the form's key, and
 *   the page after submitting, /apply/confirm/<code>, a new document under a key of its own, is paired with that arm by
 *   its address (submissions.ts confirmedArm: the tab's Submit armed on that posting), once. Its Human Check stays
 *   the person's (J7-JZ-1): JazzHR is the Queue tab's only.
 * Neither ever sends POST /applied from a queued tab (the queue tells TailorIT by …/result).
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import jazzConfirmHtml from '../../fixtures/jazzhr/jr7-applytojob1-confirmation.html?raw';
import jazzFormHtml from '../../fixtures/jazzhr/jr7-applytojob1-form.html?raw';
import jobviteConfirmHtml from '../../fixtures/jobvite/jr7-jobvite1-confirmation.html?raw';
import jobvitePostingHtml from '../../fixtures/jobvite/jr7-jobvite1-posting.html?raw';
import jobviteStep1Html from '../../fixtures/jobvite/jr7-jobvite1-step1.html?raw';
import { applicationOf } from '../adapters';
import { queueApplicationUrl } from '../contract/tailorit';
import type { QueueTabs } from '../platform/types';
import { contentSender, pageSender, startTestWorker, tokenRecord, type TestWorker } from './worker.testkit';

const sourceOf = (html: string): string => /"source":"([^"]+)"/.exec(html)![1]!;
/** An address without its query (TailorIT keeps a posting's address so: the capture's own carries a referral tag). */
const bare = (href: string): string => href.split('?')[0]!;

const OPTIONS = pageSender('options.html');
const TAB = 71;
const ROW_ID = '7c1e4f2a-9b3d-4a6e-8f50-2d9c1b7e3a80';

let logs: MockInstance;
beforeEach(() => {
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => logs.mockRestore());

/** Tabs that open one by one (queue-worker.test.ts's). */
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

type Answer = { ok: boolean; error?: string; data?: { runId?: string } };
const keyOf = (href: string) => applicationOf(new URL(href))!.applicationKey;
const frame = (url: string, documentId: string) => contentSender({ url, tab: { id: TAB, url }, frameId: 0, documentId });
const hello = (worker: TestWorker, url: string, documentId: string, extra: Record<string, unknown> = {}) =>
  worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true, ...extra }, frame(url, documentId)) as
    Promise<Answer>;
const detected = (worker: TestWorker, url: string, documentId: string, applicationKey: string) =>
  worker.deliver({ v: 1, type: 'submit/detected', applicationKey, evidence: 'confirmation-page' },
    frame(url, documentId)) as Promise<Answer>;
const results = (worker: TestWorker) => worker.tailorit.requests
  .filter((request) => request.path === `/api/autofill/agent/${ROW_ID}/result`).map((request) => JSON.parse(request.body!));

/** The Queue tab started on one job at `posting`; answers the address it opened. */
async function queued(posting: string): Promise<{ worker: TestWorker; opened: string[] }> {
  const tabsOf = tabs();
  const worker = await startTestWorker({ token: tokenRecord(), queueTabs: tabsOf });
  const row = { id: ROW_ID, jobId: 3042, url: posting, company: 'Company', title: 'Posting', location: 'Remote',
    active: true, state: 'queued', reason: null, source: 'manual', attempts: 0, aiGuesses: null,
    createdAt: '2026-11-11T08:00:00.000Z', startedAt: null, finishedAt: null, applyUrl: posting, run: null };
  worker.tailorit.reply('GET /api/autofill/agent/queue', { json: { items: [row], total: 1, limit: 100 } });
  worker.tailorit.reply(`POST /api/autofill/agent/${ROW_ID}/opened`, { json: { item: { id: row.id, jobId: row.jobId,
    url: row.url, company: row.company, title: row.title, resumeId: 'resume-7' }, state: 'running', reason: null } });
  worker.tailorit.reply(`POST /api/autofill/agent/${ROW_ID}/result`, { status: 204 });
  worker.tailorit.reply('GET /api/autofill/agent/next', { json: { item: null } });
  worker.fakes.frameAnswers = () => ({ ok: true, data: {} });
  expect(await worker.deliver({ v: 1, type: 'queue/start' }, contentSender())).toMatchObject({ ok: true,
    data: { phase: 'running', opened: 1 } });
  return { worker, opened: tabsOf.opened };
}

/** The run of the queued tab's form at `url` (document `documentId`), begun as the panel's Autofill; its Submit
 *  pressed by the person (the queue's Submit Manual), armed under the page's key. */
async function armed(worker: TestWorker, url: string, documentId: string): Promise<string> {
  await hello(worker, url, documentId);
  const key = keyOf(url);
  const begun = await worker.deliver({ v: 1, type: 'run/begin', applicationKey: key, trigger: 'panel', dryRun: false },
    frame(url, documentId)) as Answer;
  expect(begun.ok).toBe(true);
  expect(await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: key, by: 'panel', runId: begun.data!.runId },
    frame(url, documentId))).toEqual({ ok: true, data: {} });
  return key;
}

describe('jr7 BOARDS-7 P2: Jobvite\'s run to submitted in the Queue tab (the snapshot7 jobvite1 addresses)', () => {
  const POSTING = sourceOf(jobvitePostingHtml);
  const APPLY = sourceOf(jobviteStep1Html);
  const CONFIRMATION = sourceOf(jobviteConfirmHtml);

  it('opens …/apply; the steps and the confirmation share the application\'s key', () => {
    expect(queueApplicationUrl(POSTING)).toBe(APPLY);
    expect([applicationOf(new URL(POSTING))?.page, applicationOf(new URL(APPLY))?.page,
      applicationOf(new URL(CONFIRMATION))?.page]).toEqual(['posting', 'application', 'confirmation']);
    expect(keyOf(CONFIRMATION)).toBe(keyOf(APPLY));
  });

  it.each([['as a route of the steps\' document', 'doc-apply', { hasForm: false, nav: 1 }],
    ['as a new document', 'doc-confirm', { hasForm: false }]] as const)(
    'Send Application, then /applyConfirmation %s: submitted once, never POST /applied', async (_how, doc, extra) => {
      const { worker, opened } = await queued(POSTING);
      expect(opened).toEqual([APPLY]);
      const key = await armed(worker, APPLY, 'doc-apply');
      await hello(worker, CONFIRMATION, doc, extra);
      expect(await detected(worker, CONFIRMATION, doc, key)).toEqual({ ok: true, data: {} });
      expect(results(worker)).toEqual([{ state: 'submitted', reason: null, aiGuesses: 0, submitPressed: true }]);
      expect(await detected(worker, CONFIRMATION, doc, key)).toMatchObject({ ok: false, error: 'expired' });
      expect(results(worker)).toHaveLength(1);
      expect(worker.tailorit.count('POST /api/autofill/applied')).toBe(0);
      expect(await worker.deliver({ v: 1, type: 'queue/status' }, OPTIONS)).toMatchObject({ ok: true,
        data: { counts: { submitted: 1 } } });
    });
});

describe('jr7 BOARDS-7 P2: JazzHR\'s confirm page recorded by its address (the snapshot7 applytojob1 addresses)', () => {
  const FORM = sourceOf(jazzFormHtml);
  const CONFIRM = sourceOf(jazzConfirmHtml);

  it('opens the posting\'s page with its form; the page after submitting has a key of its own', () => {
    expect(queueApplicationUrl(bare(FORM))).toBe(bare(FORM));
    expect([applicationOf(new URL(FORM))?.page, applicationOf(new URL(CONFIRM))?.page])
      .toEqual(['application', 'confirmation']);
    expect(keyOf(CONFIRM)).not.toBe(keyOf(FORM));
  });

  it('Submit, then /apply/confirm/<code> as a new document under its own key: paired by its address, once', async () => {
    const { worker, opened } = await queued(bare(FORM));
    expect(opened).toEqual([bare(FORM)]);
    await armed(worker, FORM, 'doc-form');
    await hello(worker, CONFIRM, 'doc-confirm', { hasForm: false });
    expect(await detected(worker, CONFIRM, 'doc-confirm', keyOf(CONFIRM))).toEqual({ ok: true, data: {} });
    expect(results(worker)).toEqual([{ state: 'submitted', reason: null, aiGuesses: 0, submitPressed: true }]);
    expect(await detected(worker, CONFIRM, 'doc-confirm', keyOf(CONFIRM))).toMatchObject({ ok: false, error: 'expired' });
    expect(results(worker)).toHaveLength(1);
    expect(worker.tailorit.count('POST /api/autofill/applied')).toBe(0);
  });

  it('refuses another posting\'s confirm page: nothing recorded', async () => {
    const { worker } = await queued(bare(FORM));
    await armed(worker, FORM, 'doc-form');
    const other = CONFIRM.replace(/\/apply\/confirm\/[^?]+/, '/apply/confirm/ZZZZZZZZZZ');
    await hello(worker, other, 'doc-other', { hasForm: false });
    expect(await detected(worker, other, 'doc-other', keyOf(other))).toMatchObject({ ok: false, error: 'expired' });
    expect(results(worker)).toEqual([]);
  });
});
