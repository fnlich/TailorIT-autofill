/*
 * jr7 AUTO-7 r3 (UP7-07; the coordinator's request of 2026-11-13), the worker's side, through the real worker (index.ts,
 * agent.ts, queue-runner.ts, submissions.ts) over WXT's fake browser and a fake TailorIT: the hello a document says once
 * its documents dialog shows after an armed Submit (content/runtime.ts sayHandOverOnce; the content's side is
 * src/content/jr7-auto-r3.browser.test.ts) ends the agent's job needs-you, its words 'documents', its tab kept; and makes a
 * queued tab's job Ready for you with them, nothing pressed and nothing told. Synthetic addresses.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { applicationOf } from '../adapters';
import type { QueueTabs, WorkerPlatform } from '../platform/types';
import { AGENT_RUN_KEY } from './agent';
import { contentSender, pageSender, sentToFrames, startTestWorker, tokenRecord, typeOfSent } from './worker.testkit';

let logs: MockInstance;
beforeEach(() => {
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => logs.mockRestore());

const OPTIONS = pageSender('options.html');
const GREENHOUSE = 'https://job-boards.greenhouse.io/northwind/jobs/5512345002';
const KEY = applicationOf(new URL(GREENHOUSE))!.applicationKey;
const TASK = { id: '7c1e4f2a-9b3d-4a6e-8f50-2d9c1b7e3a64', jobId: 1042, url: GREENHOUSE, company: 'Northwind',
  title: 'Senior Backend Engineer', resumeId: null };

describe('jr7 AUTO-7 r3, UP7-07: the documents hand-over the document says after an armed Submit', () => {
  it('ends the agent’s job needs-you with its words, the tab kept for the person', async () => {
    const AGENT_TAB = 41;
    const tabs = new Set<number>();
    const closed: number[] = [];
    const windows: WorkerPlatform['windows'] = {
      async open() {
        tabs.add(AGENT_TAB);
        return { windowId: 4, tabId: AGENT_TAB };
      },
      navigate: async (tabId) => tabs.has(tabId),
      async closeTab(tabId) {
        closed.push(tabId);
        tabs.delete(tabId);
      },
      tabExists: async (tabId) => tabs.has(tabId),
      othersOpen: async () => true,
    };
    const worker = await startTestWorker({ token: tokenRecord(), windows });
    worker.tailorit.reply('GET /api/autofill/agent/next', { json: { item: TASK } });
    worker.tailorit.reply(`POST /api/autofill/agent/${TASK.id}/result`, { status: 204 });
    worker.fakes.frameAnswers = () => ({ ok: true, data: {} });
    expect(await worker.deliver({ v: 1, type: 'agent/set', on: true, confirmed: true }, OPTIONS))
      .toMatchObject({ ok: true, data: { on: true } });
    worker.timers.advance(1);
    await vi.waitFor(async () => expect(await fakeBrowser.storage.local.get(AGENT_RUN_KEY))
      .toMatchObject({ [AGENT_RUN_KEY]: { tabId: AGENT_TAB } }));
    const frame = contentSender({ url: GREENHOUSE, tab: { id: AGENT_TAB, url: GREENHOUSE }, documentId: 'doc-a' });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, frame);
    const begun = await worker.deliver({ v: 1, type: 'run/begin', applicationKey: KEY, trigger: 'agent', dryRun: false },
      frame) as { ok: boolean; data: { runId: string } };
    expect(await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: KEY, by: 'auto', runId: begun.data.runId },
      frame)).toEqual({ ok: true, data: {} });
    // The same document, its documents dialog drawn over the form: its one hello naming it.
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true, handOver: 'documents' }, frame);
    await vi.waitFor(() => expect(worker.tailorit.requests.filter((request) =>
      request.path === `/api/autofill/agent/${TASK.id}/result`).map((request) => JSON.parse(request.body!)))
      .toEqual([{ state: 'needs-you', reason: 'other', aiGuesses: 0 }]));
    expect(closed).toEqual([]);
    expect(await worker.deliver({ v: 1, type: 'agent/status' }, OPTIONS)).toMatchObject({ ok: true,
      data: { last: { state: 'needs-you', reason: 'other', note: 'documents' } } });
    // Let go of, never closed: run/cancel and the person's own settings to its frame.
    expect(sentToFrames(worker).filter((sent) => sent.tabId === AGENT_TAB).map(typeOfSent).slice(-2))
      .toEqual(['run/cancel', 'settings/changed']);
  });

  it('makes a queued tab’s job Ready for you with its words, nothing pressed and nothing told', async () => {
    const QUEUED_TAB = 51;
    const live = new Set<number>();
    const queueTabs: QueueTabs = {
      async open() {
        live.add(QUEUED_TAB);
        return QUEUED_TAB;
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
      aiGuesses: null, createdAt: '2026-11-10T08:00:00.000Z', startedAt: null, finishedAt: null, applyUrl: GREENHOUSE,
      run: null };
    worker.tailorit.reply('GET /api/autofill/agent/queue', { json: { items: [ROW], total: 1, limit: 100 } });
    worker.tailorit.reply(`POST /api/autofill/agent/${TASK.id}/opened`, { json: { item: TASK, state: 'running',
      reason: null } });
    worker.tailorit.reply('GET /api/autofill/agent/next', { json: { item: null } });
    worker.fakes.frameAnswers = () => ({ ok: true, data: {} });
    expect(await worker.deliver({ v: 1, type: 'queue/start' }, OPTIONS)).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(live.has(QUEUED_TAB)).toBe(true));
    const frame = contentSender({ url: GREENHOUSE, tab: { id: QUEUED_TAB, url: GREENHOUSE }, documentId: 'doc-q' });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, frame);
    // The person's own Submit (Record applications I submit myself: on by default), then the dialog's hello.
    expect(await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: KEY, by: 'page' }, frame))
      .toEqual({ ok: true, data: {} });
    const sentBefore = sentToFrames(worker).length;
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true, handOver: 'documents' }, frame);
    await vi.waitFor(async () => expect(await worker.deliver({ v: 1, type: 'queue/list', offset: 0 }, OPTIONS))
      .toMatchObject({ ok: true, data: { items: [{ id: TASK.id, status: 'ready', note: 'documents', tab: true }] } }));
    expect(sentToFrames(worker).slice(sentBefore).filter((sent) => typeOfSent(sent) === 'run/start')).toEqual([]);
    expect(worker.tailorit.count(`POST /api/autofill/agent/${TASK.id}/result`)).toBe(0);
  });
});
