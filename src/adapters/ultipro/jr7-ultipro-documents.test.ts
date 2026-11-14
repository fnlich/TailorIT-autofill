/*
 * jr7 ULTIPRO-7 P2 (FIX7PLAN §6.8 item 5, UP7-07, owner question Q7-8's default; with jr7-auto-r3): UltiPro's documents
 * dialog after the person's Submit in a queued tab, through the real worker (index.ts, queue-runner.ts, submissions.ts)
 * over WXT's fake browser and a fake TailorIT. UltiPro is Queue-only (FIX7PLAN §5 D-5: UKG's sign-in, Turnstile), so the
 * Queue tab is its unattended path: the document's one hello naming the 'documents' hand-over (content/runtime.ts
 * sayHandOverOnce; the content's side on the real capture is jr7-ultipro.browser.test.ts) makes the job Ready for you
 * with its words, nothing pressed and nothing told; and once the person answers, the board's page after submitting
 * records the job submitted once (its result), even past CONFIRMATION_PAGE_MS (the arm waits SUBMIT_ARM_MS after a
 * hand-over). Synthetic addresses.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { contentSender, pageSender, sentToFrames, startTestWorker, tokenRecord, typeOfSent }
  from '../../background/worker.testkit';
import { CONFIRMATION_PAGE_MS } from '../../background/submissions';
import type { QueueTabs } from '../../platform/types';
import { applicationOf } from '../index';

let logs: MockInstance;
beforeEach(() => {
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => logs.mockRestore());

const OPTIONS = pageSender('options.html');
const PAGES = 'https://recruiting.ultipro.com/acme1000/JobBoard/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OPPORTUNITY = '2c3d4e5f-6a7b-4c8d-8e9f-1a2b3c4d5e6f';
const POSTING = `${PAGES}/OpportunityDetail?opportunityId=${OPPORTUNITY}`;
const FORM = `${PAGES}/OpportunityApply?opportunityId=${OPPORTUNITY}`;
const CONFIRM = `${PAGES}/OpportunityApply/ApplicationSubmitted?applicationId=3d4e5f6a-7b8c-4d9e-9f0a-2b3c4d5e6f7a`;
const KEY = applicationOf(new URL(FORM))!.applicationKey;
const TASK = { id: '5b2d7e1c-3a4f-4e8b-9c60-1d2e3f4a5b6c', jobId: 2051, url: POSTING, company: 'Acme',
  title: 'Platform Engineer', resumeId: null };

describe('jr7 UP7-07: UltiPro\'s documents dialog in a queued tab (jr7-auto-r3)', () => {
  it('makes the job Ready for you with its words, nothing pressed or told; the answered one recorded submitted once',
    async () => {
    expect(applicationOf(new URL(POSTING))!.applicationKey).toBe(KEY);
    const TAB = 61;
    const live = new Set<number>();
    const queueTabs: QueueTabs = {
      async open() {
        live.add(TAB);
        return TAB;
      },
      navigate: async (tabId) => live.has(tabId),
      focus: async (tabId) => live.has(tabId),
      state: async (tabId) => (live.has(tabId) ? 'background' : 'gone'),
      async close(tabId) {
        live.delete(tabId);
      },
    };
    const worker = await startTestWorker({ token: tokenRecord(), queueTabs });
    const ROW = { ...TASK, location: 'Remote', active: true, state: 'queued', reason: null, source: 'manual', attempts: 0,
      aiGuesses: null, createdAt: '2026-11-10T08:00:00.000Z', startedAt: null, finishedAt: null, applyUrl: POSTING,
      run: null };
    worker.tailorit.reply('GET /api/autofill/agent/queue', { json: { items: [ROW], total: 1, limit: 100 } });
    worker.tailorit.reply(`POST /api/autofill/agent/${TASK.id}/opened`, { json: { item: TASK, state: 'running',
      reason: null } });
    worker.tailorit.reply('GET /api/autofill/agent/next', { json: { item: null } });
    worker.tailorit.reply(`POST /api/autofill/agent/${TASK.id}/result`, { status: 204 });
    worker.fakes.frameAnswers = () => ({ ok: true, data: {} });
    expect(await worker.deliver({ v: 1, type: 'queue/start' }, OPTIONS)).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(live.has(TAB)).toBe(true));
    // The application (the posting's Apply, then UKG's sign-in, led here), the person's own Submit, then the dialog.
    const form = contentSender({ url: FORM, tab: { id: TAB, url: FORM }, documentId: 'doc-form' });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, form);
    expect(await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: KEY, by: 'page' }, form))
      .toEqual({ ok: true, data: {} });
    const sentBefore = sentToFrames(worker).length;
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: false, handOver: 'documents' }, form);
    await vi.waitFor(async () => expect(await worker.deliver({ v: 1, type: 'queue/list', offset: 0 }, OPTIONS))
      .toMatchObject({ ok: true, data: { items: [{ id: TASK.id, status: 'ready', note: 'documents', tab: true }] } }));
    expect(sentToFrames(worker).slice(sentBefore).filter((sent) => typeOfSent(sent) === 'run/start')).toEqual([]);
    expect(worker.tailorit.count(`POST /api/autofill/agent/${TASK.id}/result`)).toBe(0);
    expect(live.has(TAB)).toBe(true);
    // The person answers it after more than CONFIRMATION_PAGE_MS; the board's page after submitting, a new document.
    worker.clock.now += CONFIRMATION_PAGE_MS + 30_000;
    const done = contentSender({ url: CONFIRM, tab: { id: TAB, url: CONFIRM }, documentId: 'doc-done' });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: false }, done);
    expect(await worker.deliver({ v: 1, type: 'submit/detected',
      applicationKey: applicationOf(new URL(CONFIRM))!.applicationKey, evidence: 'confirmation-page' }, done))
      .toEqual({ ok: true, data: {} });
    // The queued job's own result records it (the Queue tab's, as the agent's: TailorIT marks it Applied), once.
    await vi.waitFor(() => expect(worker.tailorit.requests.filter((request) =>
      request.path === `/api/autofill/agent/${TASK.id}/result`).map((request) => JSON.parse(request.body!)))
      .toEqual([{ state: 'submitted', reason: null, aiGuesses: 0, submitPressed: true }]));
    expect(await worker.deliver({ v: 1, type: 'submit/detected',
      applicationKey: applicationOf(new URL(CONFIRM))!.applicationKey, evidence: 'confirmation-page' }, done))
      .toEqual({ ok: false, error: 'expired' });
    expect(worker.tailorit.count(`POST /api/autofill/agent/${TASK.id}/result`)).toBe(1);
  });
});
