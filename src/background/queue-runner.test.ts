/*
 * v1.5 QX: the sequential auto-apply (queue-runner.ts), over hand fakes: TailorIT's queue as Q2's routes keep it (GET
 * …/agent/queue pages its queued rows; POST …/agent/:id/opened takes a queued row for this browser, 404 for one it does
 * not hold, 409 for one no longer queued; POST …/agent/:id/result as the agent's), the tabs, the alarm, storage and a
 * hand-driven clock and timers.
 * - the schedule: the first tab at Start, then duration + k × acceleration (8, 8.5, 9, 9.5, ...), as the settings say;
 * - the cap: at most maxOpenTabs queued tabs open and not done, the timer held with its seconds while they are;
 * - Pause and Resume keep the seconds left; Stop opens nothing more and leaves the open tabs to the person;
 * - a worker restart picks the run up from storage.session, its timer where it was;
 * - the background agent: Start turns Run auto-apply off;
 * - each job's status from its tab (opened, filling, ready for you, submitted, skipped, failed) and what TailorIT is
 *   told; only the queued address, read the agent's way, ever opens; nothing opens while disconnected, without
 *   agent:run, or before the disclosure is acknowledged;
 * - Automatically starts the first form once; Manually leaves the tab to the person.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type {
  AutofillAgentQueueItem, AutofillAgentReason, AutofillAgentResultBody, AutofillAgentState, AutofillAgentTask,
} from '../contract/tailorit';
import { DEFAULT_SETTINGS, type QueueSettings, type Settings } from '../core/types/settings';
import { QUEUE_ITEM_STATUSES } from '../messaging/page-schemas';
import type { AgentAlarms, AtsPage, QueueTabs, StorageArea } from '../platform/types';
import type { FrameReport } from '../shared/report';
import { agentAddressOf } from './agent';
import {
  createQueueRunner, QUEUE_ALARM, QUEUE_CLOSE_SUBMITTED_MS, QUEUE_ENTRY_WAIT_MS, QUEUE_FORM_WAIT_MS, QUEUE_RETRY_MS,
  QUEUE_RUN_KEY, statusOfReports, type QueueRunnerDeps,
} from './queue-runner';
import type { ServerResult } from './server-client';
import { manualTimers } from './timers';

/** A storage area over a Map, as chrome.storage keeps JSON. */
function memoryArea(): StorageArea & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get(key) {
      return data.has(key) ? structuredClone(data.get(key)) : undefined;
    },
    async getMany(prefix) {
      return Object.fromEntries([...data].filter(([key]) => key.startsWith(prefix)));
    },
    async set(entries) {
      for (const [key, value] of Object.entries(entries)) data.set(key, structuredClone(value));
    },
    async remove(keys) {
      for (const key of keys) data.delete(key);
    },
    async restrictToTrustedContexts() {},
  };
}

const ID = (n: number) => `0000000${n % 10}-aaaa-4bbb-8ccc-0000000${String(n).padStart(5, '0')}`;
const URL_OF = (n: number) => `https://job-boards.greenhouse.io/northwind/jobs/77${String(n).padStart(3, '0')}`;
/** A queued job as TailorIT's opened route hands it out (the task). */
const queued = (n: number, url = URL_OF(n)): AutofillAgentTask =>
  ({ id: ID(n), jobId: 500 + n, url, company: 'Northwind', title: `Engineer ${n}`,
    resumeId: n % 2 === 0 ? `resume-${n}` : null });
/** A row of the queue's list (TailorIT's AutofillAgentQueueItem), for a task in a state. */
const listed = (task: AutofillAgentTask, state: AutofillAgentState): AutofillAgentQueueItem => ({ id: task.id,
  jobId: task.jobId, title: task.title, company: task.company, location: 'Remote', url: task.url, active: true, state,
  reason: null, source: 'manual', attempts: 0, aiGuesses: null, createdAt: '2026-11-10T08:00:00.000Z', startedAt: null,
  finishedAt: null, applyUrl: task.url, run: null });

/** A report of a queued tab. */
function report(overrides: Partial<FrameReport> = {}): FrameReport {
  return { v: 1, runId: 'run-1', frameId: 0, platform: 'greenhouse', adapter: 'greenhouse', mode: 'fill', status: 'review',
    pauseReason: null, fields: [], notices: [], counters: { passes: 1, hiddenControlsIgnored: 0, deferredFields: 0 },
    updatedAt: 1, ...overrides };
}

const ok = <T>(value: T): ServerResult<T> => ({ ok: true, value });
const fail = (failure: 'not-found' | 'conflict' | 'unreachable' | 'server-error', status?: number): ServerResult<never> =>
  ({ ok: false, failure, ...(status === undefined ? {} : { status }) });

interface Harness {
  deps: QueueRunnerDeps;
  runner: ReturnType<typeof createQueueRunner>;
  clock: { now: number };
  timers: ReturnType<typeof manualTimers>;
  session: ReturnType<typeof memoryArea>;
  /** TailorIT's queue: its rows and what it was told. */
  rows: Array<{ task: AutofillAgentTask; state: string; finish?: { state: AutofillAgentState;
    reason: AutofillAgentReason | null } }>;
  results: Array<{ id: string; body: AutofillAgentResultBody }>;
  openedRoute: string[];
  /** The tabs the runner opened (when, by the clock), where it sent them, which are open, which is active. */
  tabs: Array<{ tabId: number; at: number; url: string | null }>;
  open: Set<number>;
  focused: number[];
  closed: number[];
  alarm: { on: boolean };
  sent: Array<{ tabId: number; message: unknown; target: unknown }>;
  filled: number[];
  assigned: Array<{ tabId: number; jobId: number; resumeId: string | null }>;
  reports: Map<number, FrameReport[]>;
  agent: { on: boolean; stopped: number };
  state: { scopes: string[] | null; disclosed: boolean; online: boolean; settings: Settings; refuseTab: boolean;
    refuseOpened: 'not-found' | 'conflict' | 'unreachable' | null; refuseResult: 'unreachable' | null };
  changes: { count: number };
  /** Moves the clock and the timers by `ms`, in steps, letting each tick finish. */
  advance(ms: number, step?: number): Promise<void>;
  /** A fresh runner over the same storage, as after a worker restart. */
  restart(): Harness;
}

function harness(queue: Partial<QueueSettings> = {}, kept?: Harness): Harness {
  const clock = kept?.clock ?? { now: 1_000_000 };
  const timers = manualTimers();
  const session = kept?.session ?? memoryArea();
  const rows = kept?.rows ?? [];
  const results = kept?.results ?? [];
  const openedRoute = kept?.openedRoute ?? [];
  const tabs = kept?.tabs ?? [];
  const open = kept?.open ?? new Set<number>();
  const focused = kept?.focused ?? [];
  const closed = kept?.closed ?? [];
  const alarm = kept?.alarm ?? { on: false };
  const sent = kept?.sent ?? [];
  const filled = kept?.filled ?? [];
  const assigned = kept?.assigned ?? [];
  const reports = kept?.reports ?? new Map<number, FrameReport[]>();
  const agent = kept?.agent ?? { on: false, stopped: 0 };
  const changes = kept?.changes ?? { count: 0 };
  const state = kept?.state ?? { scopes: ['profile:read', 'agent:run'], disclosed: true, online: true,
    settings: { ...DEFAULT_SETTINGS, queue: { ...DEFAULT_SETTINGS.queue, ...queue } }, refuseTab: false,
    refuseOpened: null, refuseResult: null };
  let nextTab = kept === undefined ? 40 : Math.max(40, ...tabs.map((tab) => tab.tabId + 1));
  const queueTabs: QueueTabs = {
    async open() {
      if (state.refuseTab) return null;
      const tabId = nextTab++;
      tabs.push({ tabId, at: clock.now, url: null });
      open.add(tabId);
      return tabId;
    },
    async navigate(tabId, url) {
      const tab = tabs.find((each) => each.tabId === tabId);
      if (tab === undefined || !open.has(tabId)) return false;
      tab.url = url;
      return true;
    },
    async focus(tabId) {
      if (!open.has(tabId)) return false;
      focused.push(tabId);
      return true;
    },
    async state(tabId) {
      if (!open.has(tabId)) return 'gone';
      return focused.at(-1) === tabId ? 'active' : 'background';
    },
    async close(tabId) {
      open.delete(tabId);
      closed.push(tabId);
    },
  };
  const alarms: AgentAlarms = {
    async start(name) {
      if (name === QUEUE_ALARM) alarm.on = true;
    },
    async stop(name) {
      if (name === QUEUE_ALARM) alarm.on = false;
    },
    onAlarm() {},
  };
  const deps: QueueRunnerDeps = {
    server: {
      async queuePage(cursor) {
        const all = rows.filter((row) => row.state === 'queued').map((row) => listed(row.task, 'queued'));
        const from = cursor === null ? 0 : Number(cursor.slice(1));
        const items = all.slice(from, from + 100);
        return ok({ items, total: all.length, limit: 100,
          ...(from + 100 < all.length ? { nextCursor: `c${from + 100}` } : {}) });
      },
      async queueOpened(id) {
        openedRoute.push(id);
        if (state.refuseOpened !== null) return fail(state.refuseOpened, state.refuseOpened === 'conflict' ? 409 : 404);
        const row = rows.find((each) => each.task.id === id);
        if (row === undefined) return fail('not-found', 404);
        if (row.state !== 'queued') return fail('conflict', 409);
        if (row.finish !== undefined) {
          row.state = row.finish.state;
          return ok({ item: null, ...row.finish });
        }
        row.state = 'running';
        return ok({ item: row.task, state: 'running', reason: null });
      },
      async agentResult(id, body) {
        if (state.refuseResult !== null) return fail(state.refuseResult);
        const row = rows.find((each) => each.task.id === id);
        if (row === undefined) return fail('not-found', 404);
        row.state = body.state;
        results.push({ id, body });
        return ok(null);
      },
    },
    session,
    tabs: queueTabs,
    alarms,
    timers,
    now: () => clock.now,
    settings: async () => state.settings,
    scopes: async () => state.scopes,
    disclosed: async () => state.disclosed,
    online: () => state.online,
    agentOn: async () => agent.on,
    stopAgent: async () => {
      agent.on = false;
      agent.stopped += 1;
    },
    reports: async (tabId) => reports.get(tabId) ?? [],
    atsPageOf: async (tabId): Promise<AtsPage | null> =>
      (tabs.find((tab) => tab.tabId === tabId)?.url?.includes('closed') === true ? { page: 'other', platform: 'greenhouse' }
        : null),
    send: async (tabId, message, target) => {
      sent.push({ tabId, message, target });
      return { ok: true, data: {} };
    },
    fill: async (tabId) => void filled.push(tabId),
    assign: (tabId, _key, task) => void assigned.push({ tabId, ...task }),
    changed: () => void (changes.count += 1),
  };
  const runner = createQueueRunner(deps);
  const self: Harness = {
    deps, runner, clock, timers, session, rows, results, openedRoute, tabs, open, focused, closed, alarm, sent, filled,
    assigned, reports, agent, state, changes,
    async advance(ms, step = 100) {
      for (let passed = 0; passed < ms; passed += step) {
        const by = Math.min(step, ms - passed);
        clock.now += by;
        timers.advance(by);
        await runner.tick();
      }
    },
    restart: () => harness(queue, self),
  };
  return self;
}

/** Queues `count` jobs in TailorIT. */
function seed(h: Harness, count: number, from = 1): void {
  for (let n = from; n < from + count; n += 1) h.rows.push({ task: queued(n), state: 'queued' });
}

/** Each open tab's page said hello (no form): its job is opened, so no page wait fails it. */
async function heardAll(h: Harness): Promise<void> {
  for (const tab of h.tabs) {
    if (h.open.has(tab.tabId)) await h.runner.hello(tab.tabId, { frameId: 0, documentId: `doc-${tab.tabId}`, hasForm: false }, true);
  }
}

/** When each tab opened, from Start. */
const openTimes = (h: Harness, start: number) => h.tabs.map((tab) => tab.at - start);

/** A hello of a queued tab's top frame at its job's own application. */
const KEY_OF = async (h: Harness, n: number) => {
  const { agentAddressOf } = await import('./agent');
  return agentAddressOf(URL_OF(n))!.applicationKey;
};

describe('the sequential auto-apply (v1.5 QX)', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it('opens the first queued job at Start and each next one duration + k × acceleration later (8, 8.5, 9, 9.5, ...)', async () => {
    h = harness({ maxOpenTabs: 10 });
    seed(h, 6);
    const start = h.clock.now;
    const answer = await h.runner.start();
    expect(answer).toMatchObject({ ok: true, data: { phase: 'running', total: 6, opened: 1 } });
    expect(openTimes(h, start)).toEqual([0]);
    await h.advance(50_000);
    expect(openTimes(h, start)).toEqual([0, 8_000, 16_500, 25_500, 35_000, 45_000]);
    // Only the queued addresses, the agent's canonical ones, in order.
    expect(h.tabs.map((tab) => tab.url)).toEqual([1, 2, 3, 4, 5, 6].map(URL_OF));
    expect(h.openedRoute).toEqual([1, 2, 3, 4, 5, 6].map(ID));
    expect((await h.runner.status()).nextInMs).toBeNull();
  });

  it('follows the duration and acceleration the settings hold (3 s, then 1 s more each time)', async () => {
    h = harness({ durationSec: 3, accelerationSec: 1, maxOpenTabs: 10 });
    seed(h, 4);
    const start = h.clock.now;
    await h.runner.start();
    await h.advance(20_000);
    expect(openTimes(h, start)).toEqual([0, 3_000, 7_000, 12_000]);
  });

  it('says the seconds left until the next tab, live', async () => {
    seed(h, 3);
    await h.runner.start();
    expect((await h.runner.status()).nextInMs).toBe(8_000);
    await h.advance(2_500);
    expect((await h.runner.status()).nextInMs).toBe(5_500);
    await h.advance(5_500);
    expect((await h.runner.status())).toMatchObject({ opened: 2, nextInMs: 8_500 });
  });

  it('holds the timer while maxOpenTabs queued tabs are open and not done, then goes on from the seconds it had left', async () => {
    h = harness({ maxOpenTabs: 2 });
    seed(h, 4);
    const start = h.clock.now;
    await h.runner.start();
    await h.advance(8_000);
    expect(openTimes(h, start)).toEqual([0, 8_000]);
    await heardAll(h);
    // Two open: the third waits however long it takes, with its 8.5 s kept.
    await h.advance(60_000);
    expect(h.tabs).toHaveLength(2);
    expect(await h.runner.status()).toMatchObject({ hold: 'cap', nextInMs: 8_500, openTabs: 2, maxOpenTabs: 2 });
    // The person closes the first: the timer goes on, the third opens 8.5 s later (not at once).
    const closedAt = h.clock.now;
    h.open.delete(h.tabs[0]!.tabId);
    await h.runner.tabRemoved(h.tabs[0]!.tabId);
    expect(h.tabs).toHaveLength(2);
    await h.advance(8_400);
    expect(h.tabs).toHaveLength(2);
    await h.advance(200);
    expect(h.tabs).toHaveLength(3);
    expect(h.tabs[2]!.at - closedAt).toBe(8_500);
    await heardAll(h);
    // A submitted job frees its place too.
    expect(await h.runner.status()).toMatchObject({ hold: 'cap', openTabs: 2 });
    const key = await KEY_OF(h, 2);
    expect(await h.runner.submitted(h.tabs[1]!.tabId, key)).toBe('recorded');
    await h.advance(9_000);
    expect(h.tabs).toHaveLength(4);
  });

  it('keeps a submitted job’s place free, and a job ready for you holds its place', async () => {
    h = harness({ maxOpenTabs: 1 });
    seed(h, 2);
    await h.runner.start();
    const first = h.tabs[0]!.tabId;
    await h.runner.hello(first, { frameId: 0, documentId: 'doc-1', hasForm: true, applicationKey: await KEY_OF(h, 1) }, true);
    h.reports.set(first, [report({ status: 'review' })]);
    await h.runner.reported(first);
    await h.advance(30_000);
    expect(h.tabs).toHaveLength(1);
    expect((await h.runner.list(0)).ok && (await h.runner.list(0))).toMatchObject({ data: { items: [
      { id: ID(1), status: 'ready', tab: true }, { id: ID(2), status: 'queued', tab: false }] } });
  });

  it('pauses with the seconds left kept and resumes from them', async () => {
    seed(h, 3);
    await h.runner.start();
    await h.advance(3_000);
    expect(await h.runner.pause()).toMatchObject({ ok: true, data: { phase: 'paused', nextInMs: 5_000 } });
    await h.advance(120_000);
    expect(h.tabs).toHaveLength(1);
    expect((await h.runner.status()).nextInMs).toBe(5_000);
    const resumedAt = h.clock.now;
    expect(await h.runner.resume()).toMatchObject({ ok: true, data: { phase: 'running', nextInMs: 5_000 } });
    await h.advance(4_900);
    expect(h.tabs).toHaveLength(1);
    await h.advance(100);
    expect(h.tabs).toHaveLength(2);
    expect(h.tabs[1]!.at - resumedAt).toBe(5_000);
    // A resume that is not paused, or a pause that is not running, changes nothing.
    expect((await h.runner.resume()).ok).toBe(true);
    await h.runner.pause();
    expect((await h.runner.pause())).toMatchObject({ data: { phase: 'paused' } });
  });

  it('stops: nothing more opens, the open tabs stay the person’s, and their results are still told', async () => {
    seed(h, 3);
    await h.runner.start();
    await h.advance(8_000);
    await heardAll(h);
    expect(await h.runner.stop()).toMatchObject({ ok: true, data: { phase: 'stopped', stoppedBy: 'person', nextInMs: null } });
    await h.advance(60_000);
    expect(h.tabs).toHaveLength(2);
    expect(h.closed).toEqual([]);
    // The third is still queued in TailorIT: never told it was opened.
    expect(h.openedRoute).toEqual([ID(1), ID(2)]);
    // The person submits the second afterwards: TailorIT hears it.
    expect(await h.runner.submitted(h.tabs[1]!.tabId, await KEY_OF(h, 2))).toBe('recorded');
    expect(h.results).toEqual([{ id: ID(2), body: { state: 'submitted', reason: null, aiGuesses: 0 } }]);
    expect(await h.runner.status()).toMatchObject({ phase: 'stopped', counts: { submitted: 1, opened: 1, queued: 1 } });
  });

  it('picks the run up after a worker restart: its timer where it was, its tabs still its own', async () => {
    seed(h, 3);
    await h.runner.start();
    await h.advance(5_000);
    expect(h.alarm.on).toBe(true);
    expect(h.session.data.has(QUEUE_RUN_KEY)).toBe(true);
    // The worker stops: memory and its timers go; storage.session and the alarm stay.
    const again = h.restart();
    await again.runner.boot();
    expect(await again.runner.status()).toMatchObject({ phase: 'running', opened: 1, nextInMs: 3_000 });
    await again.advance(3_000);
    expect(again.tabs).toHaveLength(2);
    // The first tab is still the run's: its close is the person's skip.
    again.open.delete(again.tabs[0]!.tabId);
    await again.runner.tabRemoved(again.tabs[0]!.tabId);
    expect(again.results).toEqual([{ id: ID(1), body: { state: 'needs-you', reason: 'cancelled', aiGuesses: 0 } }]);
    // Never opened twice.
    expect(again.openedRoute).toEqual([ID(1), ID(2)]);
  });

  it('turns Run auto-apply off at Start (the two never run together), and says so', async () => {
    seed(h, 2);
    h.agent.on = true;
    expect((await h.runner.status()).agentOn).toBe(true);
    const answer = await h.runner.start();
    expect(h.agent).toEqual({ on: false, stopped: 1 });
    expect(answer).toMatchObject({ ok: true, data: { phase: 'running', agentStopped: true, agentOn: false } });
    // Stopped for the agent: the run says why.
    expect(await h.runner.active()).toBe(true);
    expect(await h.runner.stop('agent')).toMatchObject({ data: { phase: 'stopped', stoppedBy: 'agent', agentStopped: false } });
    expect(await h.runner.active()).toBe(false);
    // Not on: nothing turned off.
    const quiet = harness();
    seed(quiet, 1);
    await quiet.runner.start();
    expect(quiet.agent.stopped).toBe(0);
    expect((await quiet.runner.status()).agentStopped).toBe(false);
  });

  it('reads each job’s status from its tab: opened, filling, ready for you, submitted (told), and the panels hear it', async () => {
    seed(h, 2);
    await h.runner.start();
    const tab = h.tabs[0]!.tabId;
    const key = await KEY_OF(h, 1);
    expect((await h.runner.status()).counts).toMatchObject({ opening: 1, queued: 1 });
    const heard = h.changes.count;
    await h.runner.hello(tab, { frameId: 0, documentId: 'doc-1', hasForm: true, applicationKey: key }, true);
    expect((await h.runner.status()).counts).toMatchObject({ filling: 1 });
    expect(h.changes.count).toBeGreaterThan(heard);
    h.reports.set(tab, [report({ status: 'fill-step' })]);
    await h.runner.reported(tab);
    expect((await h.runner.status()).counts.filling).toBe(1);
    h.reports.set(tab, [report({ status: 'handoff', pauseReason: 'captcha' })]);
    await h.runner.reported(tab);
    expect((await h.runner.status()).counts.ready).toBe(1);
    h.reports.set(tab, [report({ status: 'review', fields: [
      { fieldKey: 'f1', label: 'Q', category: 'freeText.other', status: 'filled', required: true, wrote: true,
        reason: 'ai-guess' } as unknown as FrameReport['fields'][number]] })]);
    await h.runner.reported(tab);
    expect(await h.runner.submitted(tab, key)).toBe('recorded');
    expect(h.results).toEqual([{ id: ID(1), body: { state: 'submitted', reason: null, aiGuesses: 1 } }]);
    expect((await h.runner.status()).counts).toMatchObject({ submitted: 1, ready: 0 });
    // Its tab closes a few seconds later, while the person looks elsewhere.
    await h.advance(QUEUE_CLOSE_SUBMITTED_MS);
    expect(h.closed).toEqual([tab]);
  });

  it('leaves a submitted job’s tab open while it is the active tab', async () => {
    seed(h, 1);
    await h.runner.start();
    const tab = h.tabs[0]!.tabId;
    await h.runner.focus(ID(1));
    expect(h.focused).toEqual([tab]);
    await h.runner.submitted(tab, await KEY_OF(h, 1));
    await h.advance(QUEUE_CLOSE_SUBMITTED_MS + 1_000);
    expect(h.closed).toEqual([]);
    expect((await h.runner.status()).phase).toBe('finished');
  });

  it('takes another posting’s sign in a queued tab as not the job’s (recorded the normal way)', async () => {
    seed(h, 1);
    await h.runner.start();
    expect(await h.runner.submitted(h.tabs[0]!.tabId, 'greenhouse:0000000000000000')).toBe('not-ours');
    expect(await h.runner.submitted(999, await KEY_OF(h, 1))).toBe('not-ours');
    expect(h.results).toEqual([]);
  });

  it('skips a job whose tab the person closed (needs-you cancelled), and fails one whose page never came', async () => {
    seed(h, 3);
    h.rows[1]!.task = { ...h.rows[1]!.task, url: URL_OF(2) };
    await h.runner.start();
    h.open.delete(h.tabs[0]!.tabId);
    await h.runner.tabRemoved(h.tabs[0]!.tabId);
    expect(h.results.at(-1)).toEqual({ id: ID(1), body: { state: 'needs-you', reason: 'cancelled', aiGuesses: 0 } });
    // The second opens, and no frame of ours ever says hello.
    await h.advance(8_000 + QUEUE_FORM_WAIT_MS);
    expect(h.results.at(-1)).toEqual({ id: ID(2), body: { state: 'failed', reason: 'page_error', aiGuesses: 0 } });
    // Its tab stays the person's.
    expect(h.open.has(h.tabs[1]!.tabId)).toBe(true);
    expect(h.closed).toEqual([]);
  });

  it('fails a job whose tab shows a page of the platform that names no posting (posting_closed)', async () => {
    h.rows.push({ task: queued(1), state: 'queued' });
    await h.runner.start();
    h.tabs[0]!.url = `${URL_OF(1)}?closed=1`;
    await h.advance(QUEUE_FORM_WAIT_MS);
    expect(h.results).toEqual([{ id: ID(1), body: { state: 'failed', reason: 'posting_closed', aiGuesses: 0 } }]);
  });

  it('never opens a job with no address the extension fills: failed unsupported_site, the next opened at once', async () => {
    h.rows.push({ task: queued(1, 'https://careers.example.com/jobs/1'), state: 'queued' });
    h.rows.push({ task: queued(2, 'javascript:alert(1)'), state: 'queued' });
    seed(h, 1, 3);
    await h.runner.start();
    expect(h.tabs.map((tab) => tab.url)).toEqual([URL_OF(3)]);
    expect(h.results).toEqual([
      { id: ID(1), body: { state: 'failed', reason: 'unsupported_site', aiGuesses: 0 } },
      { id: ID(2), body: { state: 'failed', reason: 'unsupported_site', aiGuesses: 0 } }]);
    expect((await h.runner.status()).counts).toMatchObject({ failed: 2, opening: 1 });
  });

  it('skips a job TailorIT no longer has queued (removed, or taken by the agent or another browser), never opening it', async () => {
    seed(h, 3);
    h.rows[0]!.state = 'running';
    h.rows.splice(1, 1);
    // The run read them before TailorIT changed: put the snapshot back.
    const snapshot = [1, 2, 3].map((n) => listed(queued(n), 'queued'));
    h.deps.server.queuePage = async () => ok({ items: snapshot, total: 3, limit: 100 });
    await h.runner.start();
    expect(h.tabs.map((tab) => tab.url)).toEqual([URL_OF(3)]);
    expect(h.results).toEqual([]);
    expect((await h.runner.status()).counts).toMatchObject({ skipped: 2, opening: 1 });
  });

  it('shows a job TailorIT finished at the claim as it said (applied already, closed), opens the next, tells nothing', async () => {
    seed(h, 4);
    h.rows[0]!.finish = { state: 'skipped', reason: 'already_applied' };
    h.rows[1]!.finish = { state: 'failed', reason: 'posting_closed' };
    await h.runner.start();
    expect(h.tabs.map((tab) => tab.url)).toEqual([URL_OF(3)]);
    expect(h.results).toEqual([]);
    const listedNow = await h.runner.list(0);
    expect(listedNow.ok && listedNow.data.items.map((item) => [item.status, item.reason])).toEqual([
      ['skipped', 'already_applied'], ['failed', 'posting_closed'], ['opening', null], ['queued', null]]);
    // The schedule counts the tab that opened only.
    expect(await h.runner.status()).toMatchObject({ opened: 3, nextInMs: 8_000 });
  });

  it('keeps no address in storage.session: ids, titles, statuses and the application’s key alone', async () => {
    seed(h, 2);
    await h.runner.start();
    const stored = JSON.stringify(h.session.data.get(QUEUE_RUN_KEY));
    expect(stored).not.toContain('http');
    expect(stored).not.toContain('greenhouse.io');
    expect(stored).toContain('greenhouse:');
  });

  it('tries an opening again when TailorIT does not answer, the schedule unchanged', async () => {
    seed(h, 2);
    h.state.refuseOpened = 'unreachable';
    await h.runner.start();
    expect(h.tabs).toEqual([]);
    expect(await h.runner.status()).toMatchObject({ phase: 'running', hold: 'server', nextInMs: QUEUE_RETRY_MS });
    h.state.refuseOpened = null;
    await h.advance(QUEUE_RETRY_MS);
    expect(h.tabs).toHaveLength(1);
    expect((await h.runner.status()).hold).toBeNull();
  });

  it('keeps a result TailorIT could not take, and tells it at the next tick', async () => {
    seed(h, 2);
    await h.runner.start();
    h.state.refuseResult = 'unreachable';
    h.open.delete(h.tabs[0]!.tabId);
    await h.runner.tabRemoved(h.tabs[0]!.tabId);
    expect(h.results).toEqual([]);
    expect((await h.runner.status()).pending).toBe(true);
    h.state.refuseResult = null;
    await h.advance(100);
    expect(h.results).toEqual([{ id: ID(1), body: { state: 'needs-you', reason: 'cancelled', aiGuesses: 0 } }]);
    expect((await h.runner.status()).pending).toBe(false);
  });

  it('opens nothing while not connected, without agent:run, or before the disclosure is acknowledged', async () => {
    seed(h, 2);
    for (const [scopes, disclosed, blocked] of [[null, true, 'not-connected'], [['profile:read'], true, 'no-scope'],
      [['agent:run'], false, 'disclosure']] as const) {
      h.state.scopes = scopes === null ? null : [...scopes];
      h.state.disclosed = disclosed;
      expect(await h.runner.start()).toMatchObject({ ok: true, data: { phase: 'idle', blocked } });
      expect(h.tabs).toEqual([]);
      expect(h.openedRoute).toEqual([]);
    }
    h.state.scopes = null;
    expect((await h.runner.list(0))).toEqual({ ok: false, error: 'not_connected' });
  });

  it('stops when the connection or the disclosure changes while it runs, opening nothing more', async () => {
    seed(h, 3);
    await h.runner.start();
    h.state.disclosed = false;
    await h.advance(20_000);
    expect(h.tabs).toHaveLength(1);
    expect(await h.runner.status()).toMatchObject({ phase: 'stopped', stoppedBy: 'disclosure' });
    const other = harness();
    seed(other, 3);
    await other.runner.start();
    await other.runner.tokenChanged();
    await other.advance(20_000);
    expect(other.tabs).toHaveLength(1);
    expect(await other.runner.status()).toMatchObject({ phase: 'stopped', stoppedBy: 'connection' });
  });

  it('opens nothing while the browser is offline, and goes on once it is back', async () => {
    seed(h, 2);
    h.state.online = false;
    await h.runner.start();
    expect(h.tabs).toEqual([]);
    expect((await h.runner.status()).hold).toBe('offline');
    h.state.online = true;
    await h.advance(100);
    expect(h.tabs).toHaveLength(1);
  });

  it('stops when Chrome opens no tab', async () => {
    seed(h, 2);
    h.state.refuseTab = true;
    expect(await h.runner.start()).toMatchObject({ data: { phase: 'stopped', stoppedBy: 'no-tab' } });
    expect(h.results).toEqual([{ id: ID(1), body: { state: 'needs-you', reason: 'cancelled', aiGuesses: 0 } }]);
  });

  it('with Automatically, starts the first form of the job’s own application once, names its job and resume', async () => {
    seed(h, 2);
    await h.runner.start();
    await h.advance(8_000);
    const tab = h.tabs[1]!.tabId;
    const key = await KEY_OF(h, 2);
    // A subframe that is not the application's, and another posting's page, start nothing.
    await h.runner.hello(tab, { frameId: 3, documentId: 'doc-x', hasForm: true, applicationKey: key }, false);
    await h.runner.hello(tab, { frameId: 0, documentId: 'doc-0', hasForm: true, applicationKey: 'lever:0123456789abcdef' }, true);
    expect(h.sent).toEqual([]);
    expect(h.assigned).toEqual([]);
    await h.runner.hello(tab, { frameId: 0, documentId: 'doc-1', hasForm: true, applicationKey: key }, true);
    await Promise.resolve();
    expect(h.sent).toEqual([{ tabId: tab, message: { v: 1, type: 'run/start', dryRun: false },
      target: { frameId: 0, documentId: 'doc-1' } }]);
    expect(h.assigned).toEqual([{ tabId: tab, jobId: 502, resumeId: 'resume-2' }]);
    // A later page of the same application: its own "Autofill after page turn" takes it.
    await h.runner.hello(tab, { frameId: 0, documentId: 'doc-2', hasForm: true, applicationKey: key }, true);
    await Promise.resolve();
    expect(h.sent).toHaveLength(1);
  });

  it('with Automatically, presses a posting’s own Apply (the panel’s Autofill) once at a page with no form', async () => {
    seed(h, 1);
    await h.runner.start();
    const tab = h.tabs[0]!.tabId;
    const key = await KEY_OF(h, 1);
    await h.runner.hello(tab, { frameId: 0, documentId: 'doc-1', hasForm: false, applicationKey: key }, true);
    expect((await h.runner.status()).counts.opened).toBe(1);
    await h.runner.wall(tab, { applicationKey: 'lever:0123456789abcdef', wall: false });
    expect(h.filled).toEqual([]);
    await h.runner.wall(tab, { applicationKey: key, wall: false });
    await h.runner.wall(tab, { applicationKey: key, wall: false });
    expect(h.filled).toEqual([tab]);
    expect((await h.runner.status()).counts.filling).toBe(1);
    // The form it opens is the grant's to start (sign-up.ts), not a second start of the queue's.
    await h.runner.hello(tab, { frameId: 0, documentId: 'doc-2', hasForm: true, applicationKey: key }, true);
    await Promise.resolve();
    expect(h.sent).toEqual([]);
  });

  /*
   * jr6 apply F4a (AF-5, as corrected: the timeout only): a job the queue's Autofill started at a page with no form
   * (wall()) and whose tab no run reported from since is Ready for you QUEUE_ENTRY_WAIT_MS after that start, keeping its
   * open-tab place; a run that reports leads its status as before. The queue never continues the press (the panel's
   * grant takes the next documents' walls and choices: sign-up.ts takeStep, F3a).
   */
  describe('jr6 apply F4a: never Filling for ever after an entry', () => {
    let logs: MockInstance;
    beforeEach(() => {
      logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    });
    afterEach(() => logs.mockRestore());
    /** What queue.entry-timeout logged, each call's data. */
    const timeouts = () => logs.mock.calls.filter(([line]) => line === '[tailorit-autofill] queue.entry-timeout')
      .map((call) => call[1] as unknown);
    const FROM_FILLING = { from: QUEUE_ITEM_STATUSES.indexOf('filling') };
    const ICIMS_POSTING = 'https://careers-northwind.icims.com/jobs/5157/job';
    /** The job's tab heard (its posting, no form) and its frame/wall's entry taken: the queue's Autofill, once. */
    async function entered(on: Harness, n: number, url = URL_OF(n)) {
      const target = agentAddressOf(url)!;
      const tab = on.tabs.find((each) => each.url === target.address)!.tabId;
      await on.runner.hello(tab, { frameId: 0, documentId: `posting-${n}`, hasForm: false,
        applicationKey: target.applicationKey }, true);
      await on.runner.wall(tab, { applicationKey: target.applicationKey, wall: false });
      return { tab, key: target.applicationKey };
    }
    /** The tab's run says where it stands (report/put or report/live). */
    async function says(on: Harness, tab: number, status: FrameReport['status']) {
      on.reports.set(tab, [report({ status })]);
      await on.runner.reported(tab);
    }
    const countsOf = async (on: Harness) => (await on.runner.status()).counts;
    /** Lets every promise the timers set off settle (no tick of the harness's own). */
    const settled = async () => {
      for (let step = 0; step < 3; step += 1) await new Promise((resolve) => setImmediate(resolve));
    };

    it('a refused entry (no run reports) is Ready for you QUEUE_ENTRY_WAIT_MS after its start, its open-tab place still held', async () => {
      h = harness({ maxOpenTabs: 1 });
      seed(h, 2);
      await h.runner.start();
      const { tab } = await entered(h, 1);
      const startedAt = h.clock.now;
      expect(h.filled).toEqual([tab]);
      expect(await countsOf(h)).toMatchObject({ filling: 1, queued: 1 });
      // The frame refused its Apply (frame/wall entryRefused, which index.ts never hands the queue), and no run reports.
      await h.advance(QUEUE_ENTRY_WAIT_MS - 100);
      expect(await countsOf(h)).toMatchObject({ filling: 1, ready: 0 });
      expect(timeouts()).toEqual([]);
      await h.advance(100);
      expect(h.clock.now - startedAt).toBe(QUEUE_ENTRY_WAIT_MS);
      expect(await h.runner.status()).toMatchObject({ phase: 'running', hold: 'cap', openTabs: 1, maxOpenTabs: 1,
        counts: { filling: 0, ready: 1, queued: 1 } });
      // Logged once, a place in a closed list only.
      expect(timeouts()).toEqual([FROM_FILLING]);
      const listed = await h.runner.list(0);
      expect(listed.ok && listed.data.items.map((item) => [item.status, item.tab])).toEqual([['ready', true],
        ['queued', false]]);
      // Ten minutes on: the tab is still the person's and holds its place; nothing pressed again, nothing told.
      await h.advance(10 * 60_000, 1_000);
      expect(h.tabs).toHaveLength(1);
      expect(await h.runner.status()).toMatchObject({ hold: 'cap', counts: { ready: 1, queued: 1 } });
      expect(h.filled).toEqual([tab]);
      expect(h.sent).toEqual([]);
      expect(h.results).toEqual([]);
      expect(timeouts()).toHaveLength(1);
      // The person closes it: its place frees, and the next job opens on the schedule.
      h.open.delete(tab);
      await h.runner.tabRemoved(tab);
      await h.advance(8_000);
      expect(h.tabs).toHaveLength(2);
    });

    it('a no-form choice the press led to is Ready for you after the wait from the entry: the queue presses nothing more', async () => {
      seed(h, 1);
      await h.runner.start();
      const { tab, key } = await entered(h, 1);
      const startedAt = h.clock.now;
      await h.advance(5_000);
      // The next document shows a choice and no form (Workday's Apply Manually page): its frame/wall reaches the queue,
      // which started this job once already (the panel's grant takes the step: sign-up.ts takeStep).
      await h.runner.hello(tab, { frameId: 0, documentId: 'choice-1', hasForm: false, applicationKey: key }, true);
      await h.runner.wall(tab, { applicationKey: key, wall: false });
      expect(h.filled).toEqual([tab]);
      expect(h.sent).toEqual([]);
      // Nothing took it: Ready for you, the wait counted from the entry (not from the choice).
      await h.advance(QUEUE_ENTRY_WAIT_MS - 5_000 - 100);
      expect(await countsOf(h)).toMatchObject({ filling: 1, ready: 0 });
      await h.advance(100);
      expect(h.clock.now - startedAt).toBe(QUEUE_ENTRY_WAIT_MS);
      expect(await countsOf(h)).toMatchObject({ filling: 0, ready: 1 });
      expect(timeouts()).toEqual([FROM_FILLING]);
      expect(h.filled).toEqual([tab]);
      // A run that comes after all (the person's Autofill, or the grant's step and then its form) still leads.
      await says(h, tab, 'fill-step');
      expect(await countsOf(h)).toMatchObject({ filling: 1, ready: 0 });
      await says(h, tab, 'review');
      expect(await countsOf(h)).toMatchObject({ filling: 0, ready: 1 });
      expect(h.filled).toEqual([tab]);
      expect(h.sent).toEqual([]);
    });

    it('a job whose run reports within the wait follows its reports as before, the timer gone', async () => {
      seed(h, 1);
      await h.runner.start();
      const { tab, key } = await entered(h, 1);
      await h.advance(20_000);
      // The press's next document holds the form: the grant starts it (sign-up.ts takeFill), never a second queue start.
      await h.runner.hello(tab, { frameId: 0, documentId: 'form-1', hasForm: true, applicationKey: key }, true);
      await Promise.resolve();
      expect(h.sent).toEqual([]);
      await says(h, tab, 'review');
      expect(await countsOf(h)).toMatchObject({ filling: 0, ready: 1 });
      // The person's Autofill again: its run works on past the entry's wait, and stays filling all along.
      await h.advance(20_000);
      await says(h, tab, 'scan-step');
      for (let passed = 0; passed < QUEUE_ENTRY_WAIT_MS; passed += 1_000) {
        await h.advance(1_000);
        expect(await countsOf(h)).toMatchObject({ filling: 1, ready: 0 });
      }
      await says(h, tab, 'review');
      expect(await countsOf(h)).toMatchObject({ filling: 0, ready: 1 });
      expect(timeouts()).toEqual([]);
      expect(h.filled).toEqual([tab]);
    });

    it('the iCIMS email gate (a form root) goes filling, then ready, from its run’s reports, not from the timer', async () => {
      h.rows.push({ task: queued(1, ICIMS_POSTING), state: 'queued' });
      await h.runner.start();
      const { tab, key } = await entered(h, 1, ICIMS_POSTING);
      const startedAt = h.clock.now;
      expect(h.filled).toEqual([tab]);
      // The posting's Apply moved the top frame to the email gate: a form root, so its hello starts nothing of the
      // queue's and no frame/wall of it reaches the queue; the panel's grant starts its run (sign-up.ts takeFill).
      await h.advance(3_000);
      await h.runner.hello(tab, { frameId: 0, documentId: 'gate', hasForm: true, applicationKey: key }, true);
      await Promise.resolve();
      expect(h.sent).toEqual([]);
      await says(h, tab, 'detect');
      expect(await countsOf(h)).toMatchObject({ filling: 1, ready: 0 });
      // Sign-in Manually: the gate's Next is the person's (the run rests at the AUTH pause).
      await h.advance(1_000);
      await says(h, tab, 'auth-needed');
      expect(await countsOf(h)).toMatchObject({ filling: 0, ready: 1 });
      // The person presses Next: the gate's document goes, and the application form's run (Autofill after page turn)
      // fills.
      await h.advance(76_000);
      h.reports.delete(tab);
      await h.runner.hello(tab, { frameId: 0, documentId: 'form-1', hasForm: true, applicationKey: key }, true);
      await h.advance(2_000);
      await says(h, tab, 'fill-step');
      expect(await countsOf(h)).toMatchObject({ filling: 1, ready: 0 });
      // A page turn of the form across the wait: its step's reports go with its document, the next step's run has not
      // reported yet. Still filling: the reports lead, never the timer.
      await h.advance(6_000);
      expect(h.clock.now - startedAt).toBe(88_000);
      h.reports.delete(tab);
      await h.advance(3_000);
      expect(h.clock.now - startedAt).toBeGreaterThan(QUEUE_ENTRY_WAIT_MS);
      expect(await countsOf(h)).toMatchObject({ filling: 1, ready: 0 });
      await says(h, tab, 'fill-step');
      await h.advance(10_000);
      expect(await countsOf(h)).toMatchObject({ filling: 1, ready: 0 });
      // It rests at review: Ready for you, from its report.
      await says(h, tab, 'review');
      expect(await countsOf(h)).toMatchObject({ filling: 0, ready: 1 });
      expect(timeouts()).toEqual([]);
      expect(h.filled).toEqual([tab]);
      expect(h.sent).toEqual([]);
    });

    it('a run’s report heard as its message comes ends the wait, though no look at the tabs saw it', async () => {
      seed(h, 1);
      await h.runner.start();
      const { tab, key } = await entered(h, 1);
      const startedAt = h.clock.now;
      // A slow entry: the form's run reports late in the wait, and its page turns at once (its reports go with it).
      await h.advance(85_000);
      await h.runner.hello(tab, { frameId: 0, documentId: 'form-1', hasForm: true, applicationKey: key }, true);
      await says(h, tab, 'fill-step');
      h.reports.delete(tab);
      // Across the wait, the next step's run not heard yet: still filling (a run reported), never the timer.
      await h.advance(7_000);
      expect(h.clock.now - startedAt).toBeGreaterThan(QUEUE_ENTRY_WAIT_MS);
      expect(await countsOf(h)).toMatchObject({ filling: 1, ready: 0 });
      await says(h, tab, 'review');
      expect(await countsOf(h)).toMatchObject({ filling: 0, ready: 1 });
      expect(timeouts()).toEqual([]);
    });

    it('ends an entry’s wait while the run is paused too, by its own timer, the alarm kept while it waits', async () => {
      seed(h, 2);
      await h.runner.start();
      const tab = h.tabs[0]!.tabId;
      const key = await KEY_OF(h, 1);
      await h.runner.hello(tab, { frameId: 0, documentId: 'posting-1', hasForm: false, applicationKey: key }, true);
      await h.runner.pause();
      expect(h.alarm.on).toBe(false);
      // The frame's entry arrives while paused: the queue's Autofill (as before), and the wait keeps the worker waking.
      await h.runner.wall(tab, { applicationKey: key, wall: false });
      expect(h.filled).toEqual([tab]);
      expect(h.alarm.on).toBe(true);
      // Only the timers run (no other tick, no alarm): the wait's own timer ends it.
      for (let passed = 0; passed < QUEUE_ENTRY_WAIT_MS; passed += 1_000) {
        h.clock.now += 1_000;
        h.timers.advance(1_000);
        await settled();
      }
      expect(await countsOf(h)).toMatchObject({ filling: 1, ready: 0 });
      h.clock.now += 100;
      h.timers.advance(100);
      await settled();
      expect(await h.runner.status()).toMatchObject({ phase: 'paused', counts: { filling: 0, ready: 1, queued: 1 } });
      expect(timeouts()).toEqual([FROM_FILLING]);
      expect(h.alarm.on).toBe(false);
      expect(h.tabs).toHaveLength(1);
    });

    it('picks an entry’s wait up after a worker restart, from its start as saved, and never revives one a run ended', async () => {
      h = harness({ maxOpenTabs: 2 });
      seed(h, 2);
      await h.runner.start();
      await h.advance(8_000);
      const first = await entered(h, 1);
      const second = await entered(h, 2);
      const startedAt = h.clock.now;
      // The second's form run reports, seen by a look at the tabs (its message missed while the worker slept).
      h.reports.set(second.tab, [report({ status: 'fill-step' })]);
      await h.advance(1_000);
      await h.advance(49_000, 1_000);
      // The worker stops; meanwhile the second's page turns (its reports go with the document).
      const again = h.restart();
      again.reports.delete(second.tab);
      await again.runner.boot();
      expect(await countsOf(again)).toMatchObject({ filling: 2, ready: 0 });
      await again.advance(startedAt + QUEUE_ENTRY_WAIT_MS - 100 - again.clock.now);
      expect(await countsOf(again)).toMatchObject({ filling: 2, ready: 0 });
      await again.advance(100);
      const listed = await again.runner.list(0);
      expect(listed.ok && listed.data.items.map((item) => item.status)).toEqual(['ready', 'filling']);
      expect(timeouts()).toEqual([FROM_FILLING]);
      expect(again.filled).toEqual([first.tab, second.tab]);
    });

    it('an account wall’s start is Ready for you at once, and its wait ends with nothing logged; Manually times nothing', async () => {
      seed(h, 1);
      await h.runner.start();
      const tab = h.tabs[0]!.tabId;
      const key = await KEY_OF(h, 1);
      await h.runner.hello(tab, { frameId: 0, documentId: 'wall-1', hasForm: false, applicationKey: key }, true);
      await h.runner.wall(tab, { applicationKey: key, wall: true });
      expect(h.filled).toEqual([tab]);
      expect(await countsOf(h)).toMatchObject({ ready: 1 });
      await h.advance(QUEUE_ENTRY_WAIT_MS + 1_000, 1_000);
      expect(await countsOf(h)).toMatchObject({ ready: 1 });
      expect(timeouts()).toEqual([]);
      expect(h.alarm.on).toBe(true); // the run still runs (its tab open)
      const manual = harness({ autofillOnOpen: 'manual' });
      seed(manual, 1);
      await manual.runner.start();
      await entered(manual, 1);
      expect(manual.filled).toEqual([]);
      await manual.advance(QUEUE_ENTRY_WAIT_MS + 1_000, 1_000);
      expect(await countsOf(manual)).toMatchObject({ opened: 1, filling: 0, ready: 0 });
      expect(timeouts()).toEqual([]);
    });
  });

  it('with Manually, leaves each tab for the person’s Autofill', async () => {
    h = harness({ autofillOnOpen: 'manual' });
    seed(h, 1);
    await h.runner.start();
    const tab = h.tabs[0]!.tabId;
    const key = await KEY_OF(h, 1);
    await h.runner.hello(tab, { frameId: 0, documentId: 'doc-1', hasForm: true, applicationKey: key }, true);
    await h.runner.wall(tab, { applicationKey: key, wall: true });
    await Promise.resolve();
    expect(h.sent).toEqual([]);
    expect(h.filled).toEqual([]);
    expect(await h.runner.status()).toMatchObject({ autofillOnOpen: 'manual', counts: { opened: 1 } });
    // The job and resume are still the queued ones, for the person's Autofill.
    expect(h.assigned).toEqual([{ tabId: tab, jobId: 501, resumeId: null }]);
    // The person's Autofill: its reports say so.
    h.reports.set(tab, [report({ status: 'scan-step' })]);
    await h.runner.reported(tab);
    expect((await h.runner.status()).counts.filling).toBe(1);
  });

  it('finishes once every job is done, and lets the alarm go', async () => {
    seed(h, 2);
    await h.runner.start();
    await h.advance(8_000);
    for (const [index, n] of [[0, 1], [1, 2]] as const) {
      await h.runner.submitted(h.tabs[index]!.tabId, await KEY_OF(h, n));
    }
    expect(await h.runner.status()).toMatchObject({ phase: 'finished', total: 2, opened: 2, counts: { submitted: 2 } });
    expect(h.alarm.on).toBe(false);
  });

  it('lists TailorIT’s queued jobs before a run, then the run’s, a page at a time; a row’s click focuses its tab', async () => {
    seed(h, 120);
    const before = await h.runner.list(0);
    expect(before).toMatchObject({ ok: true, data: { source: 'queue', total: 120, more: true } });
    expect(before.ok && before.data.items).toHaveLength(50);
    const third = await h.runner.list(100);
    expect(third).toMatchObject({ ok: true, data: { source: 'queue', offset: 100, more: false } });
    expect(third.ok && third.data.items).toHaveLength(20);
    expect(third.ok && third.data.items[0]).toEqual({ id: ID(101), title: 'Engineer 101', company: 'Northwind',
      status: 'queued', reason: null, tab: false });
    await h.runner.start();
    const run = await h.runner.list(0);
    expect(run).toMatchObject({ ok: true, data: { source: 'run', total: 120, more: true } });
    expect(run.ok && run.data.items[0]).toMatchObject({ id: ID(1), status: 'opening', tab: true });
    expect(await h.runner.focus(ID(1))).toEqual({ ok: true, data: { focused: true } });
    expect(await h.runner.focus(ID(2))).toEqual({ ok: true, data: { focused: false } });
    expect(h.focused).toEqual([h.tabs[0]!.tabId]);
  });

  it('carries an earlier run’s open tabs into the next Start, holding their places', async () => {
    h = harness({ maxOpenTabs: 1 });
    seed(h, 1);
    await h.runner.start();
    await h.runner.stop();
    seed(h, 1, 2);
    await h.runner.start();
    // The first job's tab is still open and not done: the second waits for it.
    expect(h.tabs).toHaveLength(1);
    expect(await h.runner.status()).toMatchObject({ phase: 'running', total: 2, hold: 'cap' });
  });

  it('maps reports: a working run is filling, one at rest is ready for you, none is no change', () => {
    expect(statusOfReports([])).toBeNull();
    expect(statusOfReports([report({ mode: 'dry-run' as FrameReport['mode'] })])).toBeNull();
    for (const status of ['detect', 'scan-step', 'fill-step', 'validate', 'advance', 'wait-transition'] as const) {
      expect(statusOfReports([report({ status })])).toBe('filling');
    }
    expect(statusOfReports([report({ status: 'wait-transition', resting: true })])).toBe('ready');
    for (const status of ['review', 'handoff', 'auth-needed', 'policy-notice', 'stopped', 'done'] as const) {
      expect(statusOfReports([report({ status })])).toBe('ready');
    }
    expect(statusOfReports([report({ status: 'review' }), report({ frameId: 2, status: 'fill-step' })])).toBe('filling');
  });
});
