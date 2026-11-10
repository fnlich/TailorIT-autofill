/*
 * v1.5 QX in the real worker (index.ts, queue-runner.ts, submissions.ts, panel.ts), over WXT's fake browser, the hand
 * fakes and a fake TailorIT:
 * - queue/status, queue/list, queue/start, queue/stop, queue/pause, queue/resume and queue/focus from the extension's
 *   pages, and from the sidebar (its tab's top frame, while the panel shows on the page); never from a subframe;
 * - Start reads TailorIT's queue, tells it the first job opened, opens a background tab at that job's canonical address,
 *   and that tab's first form gets run/start with the person's own settings (Submit Manual here), the job's job and
 *   resume named for the lookup;
 * - the platform's sign in that tab finishes the job submitted through POST …/result (never POST /applied);
 * - Run auto-apply and the queue never run together: Start turns it off, and turning it on stops the queue.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { applicationOf } from '../adapters';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import type { QueueTabs } from '../platform/types';
import { SIDEBAR_PAGE_MESSAGES } from './senders';
import {
  contentSender, pageSender, sentToFrames, startTestWorker, tokenRecord, typeOfSent, type TestWorker,
} from './worker.testkit';

const OPTIONS = pageSender('options.html');
const GREENHOUSE = 'https://job-boards.greenhouse.io/northwind/jobs/5512345002';
/** Two rows of TailorIT's queue list (AutofillAgentQueueItem), and the task its opened route hands out for each. */
const ROW = { id: '7c1e4f2a-9b3d-4a6e-8f50-2d9c1b7e3a64', jobId: 1042, url: GREENHOUSE, company: 'Northwind',
  title: 'Senior Backend Engineer', location: 'Remote', active: true, state: 'queued', reason: null, source: 'manual',
  attempts: 0, aiGuesses: null, createdAt: '2026-11-10T08:00:00.000Z', startedAt: null, finishedAt: null,
  applyUrl: GREENHOUSE, run: null };
const SECOND = { ...ROW, id: '7c1e4f2a-9b3d-4a6e-8f50-2d9c1b7e3a65', jobId: 1043,
  url: 'https://job-boards.greenhouse.io/northwind/jobs/5512345003', title: 'Platform Engineer' };
const taskOf = (row: typeof ROW) => ({ id: row.id, jobId: row.jobId, url: row.url, company: row.company, title: row.title,
  resumeId: 'resume-7' });
const QUEUED_TAB = 51;

let logs: MockInstance;
beforeEach(() => {
  logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => logs.mockRestore());

/** Tabs that open one by one, as Chrome's do. */
function tabs(): QueueTabs & { opened: string[]; live: Set<number> } {
  const live = new Set<number>();
  const opened: string[] = [];
  let next = QUEUED_TAB;
  return {
    opened,
    live,
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

async function withQueue(): Promise<{ worker: TestWorker; tabsOf: ReturnType<typeof tabs> }> {
  const tabsOf = tabs();
  const worker = await startTestWorker({ token: tokenRecord(), queueTabs: tabsOf });
  worker.tailorit.reply('GET /api/autofill/agent/queue', { json: { items: [ROW, SECOND], total: 2, limit: 100 } });
  worker.tailorit.reply(`POST /api/autofill/agent/${ROW.id}/opened`, { json: { item: taskOf(ROW), state: 'running',
    reason: null } });
  worker.tailorit.reply(`POST /api/autofill/agent/${SECOND.id}/opened`, { json: { item: taskOf(SECOND),
    state: 'running', reason: null } });
  worker.tailorit.reply(`POST /api/autofill/agent/${ROW.id}/result`, { status: 204 });
  worker.tailorit.reply('GET /api/autofill/agent/next', { json: { item: null } });
  return { worker, tabsOf };
}

describe('the sequential auto-apply in the worker (v1.5 QX)', () => {
  it('may be read and driven by the extension’s pages and the sidebar, never by a subframe', async () => {
    for (const type of ['queue/status', 'queue/list', 'queue/start', 'queue/stop', 'queue/pause', 'queue/resume',
      'queue/focus']) expect(SIDEBAR_PAGE_MESSAGES.has(type), type).toBe(true);
    const { worker } = await withQueue();
    expect(await worker.deliver({ v: 1, type: 'queue/status' }, OPTIONS)).toMatchObject({ ok: true,
      data: { phase: 'idle', total: 0, blocked: null, agentOn: false, autofillOnOpen: 'auto', submit: 'manual',
        maxOpenTabs: 5 } });
    // The sidebar: the tab's top frame, while the panel shows on the page (the default).
    const top = contentSender();
    expect(await worker.deliver({ v: 1, type: 'queue/list', offset: 0 }, top)).toMatchObject({ ok: true,
      data: { source: 'queue', total: 2, items: [{ id: ROW.id, title: ROW.title, status: 'queued', tab: false },
        { id: SECOND.id, status: 'queued' }] } });
    expect(await worker.deliver({ v: 1, type: 'queue/status' }, contentSender({ frameId: 2, documentId: 'doc-2' })))
      .toEqual({ ok: false, error: 'bad_sender' });
    // Strictly parsed.
    expect(await worker.deliver({ v: 1, type: 'queue/focus', id: 'not-an-id' }, OPTIONS)).toEqual({ ok: false,
      error: 'bad_message' });
  });

  it('opens the first queued job at Start in a background tab, fills it with the person’s own settings, and reports its submission', async () => {
    const { worker, tabsOf } = await withQueue();
    worker.fakes.frameAnswers = () => ({ ok: true, data: {} });
    expect(await worker.deliver({ v: 1, type: 'queue/start' }, contentSender())).toMatchObject({ ok: true,
      data: { phase: 'running', total: 2, opened: 1, nextInMs: 8_000 } });
    expect(tabsOf.opened).toEqual([GREENHOUSE]);
    // The queued rows, a page as the contract's query names it, with the token.
    const read = worker.tailorit.requests.find((request) => request.path === '/api/autofill/agent/queue')!;
    expect([new URL(read.url).searchParams.get('state'), new URL(read.url).searchParams.get('limit'),
      read.headers.authorization?.startsWith('Bearer ')]).toEqual(['queued', '100', true]);
    expect(worker.tailorit.count(`POST /api/autofill/agent/${ROW.id}/opened`)).toBe(1);
    expect(worker.tailorit.count(`POST /api/autofill/agent/${SECOND.id}/opened`)).toBe(0);
    // Its page says hello: the person's own settings (Submit Manual), and the first form's run.
    const frame = contentSender({ url: GREENHOUSE, tab: { id: QUEUED_TAB, url: GREENHOUSE }, documentId: 'doc-q' });
    expect(await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, frame)).toMatchObject({
      ok: true, data: { settings: { modes: { submit: 'manual', next: 'manual' } } } });
    await vi.waitFor(() => expect(sentToFrames(worker).filter((sent) => typeOfSent(sent) === 'run/start'))
      .toEqual([{ tabId: QUEUED_TAB, message: { v: 1, type: 'run/start', dryRun: false },
        options: { frameId: 0, documentId: 'doc-q' } }]));
    await vi.waitFor(async () => expect(await worker.deliver({ v: 1, type: 'queue/list', offset: 0 }, OPTIONS))
      .toMatchObject({ ok: true, data: { source: 'run', items: [{ id: ROW.id, status: 'filling', tab: true },
        { id: SECOND.id, status: 'queued', tab: false }] } }));
    // The run's begin: no agent run in a queued tab, ever.
    const key = applicationOf(new URL(GREENHOUSE))!.applicationKey;
    expect(await worker.deliver({ v: 1, type: 'run/begin', applicationKey: key, trigger: 'agent', dryRun: false }, frame))
      .toEqual({ ok: false, error: 'bad_message' });
    const begun = await worker.deliver({ v: 1, type: 'run/begin', applicationKey: key, trigger: 'panel', dryRun: false },
      frame) as { ok: boolean; data: { runId: string; settings: { modes: { submit: string } } } };
    expect(begun).toMatchObject({ ok: true, data: { settings: { modes: { submit: 'manual' } } } });
    // The person presses Submit; the platform's sign: the job is reported submitted, never POST /applied.
    expect(await worker.deliver({ v: 1, type: 'submit/armed', applicationKey: key, by: 'panel', runId: begun.data.runId },
      frame)).toEqual({ ok: true, data: {} });
    expect(await worker.deliver({ v: 1, type: 'submit/detected', applicationKey: key, evidence: 'success-message' },
      frame)).toEqual({ ok: true, data: {} });
    const results = worker.tailorit.requests.filter((request) => request.path === `/api/autofill/agent/${ROW.id}/result`);
    expect(results.map((request) => JSON.parse(request.body!))).toEqual([{ state: 'submitted', reason: null, aiGuesses: 0 }]);
    expect(worker.tailorit.count('POST /api/autofill/applied')).toBe(0);
    expect(await worker.deliver({ v: 1, type: 'queue/status' }, OPTIONS)).toMatchObject({ ok: true,
      data: { counts: { submitted: 1, queued: 1 } } });
    // A row's click brings its tab to the front.
    expect(await worker.deliver({ v: 1, type: 'queue/focus', id: ROW.id }, OPTIONS)).toEqual({ ok: true,
      data: { focused: true } });
  });

  it('never runs beside Run auto-apply: Start turns it off, and turning it on stops the queue', async () => {
    const { worker } = await withQueue();
    expect(await worker.deliver({ v: 1, type: 'agent/set', on: true, confirmed: true }, OPTIONS)).toMatchObject({ ok: true,
      data: { on: true } });
    expect(await worker.deliver({ v: 1, type: 'queue/status' }, OPTIONS)).toMatchObject({ data: { agentOn: true } });
    expect(await worker.deliver({ v: 1, type: 'queue/start' }, OPTIONS)).toMatchObject({ ok: true,
      data: { phase: 'running', agentStopped: true, agentOn: false } });
    expect(await worker.deliver({ v: 1, type: 'agent/status' }, OPTIONS)).toMatchObject({ data: { on: false } });
    // Run auto-apply on again: the queue stops first, saying why.
    expect(await worker.deliver({ v: 1, type: 'agent/set', on: true }, OPTIONS)).toMatchObject({ data: { on: true } });
    expect(await worker.deliver({ v: 1, type: 'queue/status' }, OPTIONS)).toMatchObject({ data: { phase: 'stopped',
      stoppedBy: 'agent' } });
  });

  it('opens nothing while not connected, and stops when the connection goes', async () => {
    const tabsOf = tabs();
    const offline = await startTestWorker({ queueTabs: tabsOf });
    expect(await offline.deliver({ v: 1, type: 'queue/start' }, OPTIONS)).toMatchObject({ ok: true,
      data: { phase: 'idle', blocked: 'not-connected' } });
    expect(tabsOf.opened).toEqual([]);
    const { worker } = await withQueue();
    await worker.deliver({ v: 1, type: 'queue/start' }, OPTIONS);
    expect(await worker.deliver({ v: 1, type: 'auth/disconnect' }, OPTIONS)).toMatchObject({ ok: true });
    await vi.waitFor(async () => expect(await worker.deliver({ v: 1, type: 'queue/status' }, OPTIONS)).toMatchObject({
      data: { phase: 'stopped', stoppedBy: 'connection' } }));
  });

  it('takes the queue settings from the settings, and the sidebar may save them', async () => {
    const { worker } = await withQueue();
    const settings = { ...DEFAULT_SETTINGS, queue: { durationSec: 3, accelerationSec: 0, autofillOnOpen: 'manual' as const,
      maxOpenTabs: 2 } };
    expect(await worker.deliver({ v: 1, type: 'settings/save', settings, base: DEFAULT_SETTINGS }, contentSender()))
      .toMatchObject({ ok: true, data: { settings: { queue: settings.queue } } });
    expect(await worker.deliver({ v: 1, type: 'queue/start' }, OPTIONS)).toMatchObject({ data: { nextInMs: 3_000,
      autofillOnOpen: 'manual', maxOpenTabs: 2 } });
  });
});
