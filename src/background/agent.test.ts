/*
 * The auto-apply agent (v3 Phase 5; agent.ts), over hand fakes: TailorIT's queue as its server keeps it (GET
 * /agent/next hands a browser its own running row again, else takes the oldest queued one for it; POST
 * /agent/:id/result takes a submission always, any other result only for a running row its connection took, or once
 * that connection is gone, and the same result again unchanged; 404 for a row it does not know, 409 otherwise), the
 * windows, the alarm, storage and a hand-driven clock and timers.
 * - agentVerdict: every stop reason a report can give maps to the contract's state and reason; a Submit pressed, a run
 *   still working and a dry run wait; only the page's refusal of a Submit pressed is retried, once.
 * - claim and resume: one job at a time, opened in its own window at its canonical application address, only while a
 *   window of the person's is open; a worker that restarted finds its job in storage and never opens it twice; a record
 *   of another browser session (a tab id that may name the person's tab now) is left for the person, nothing closed.
 * - the task's own application: another posting's page, an address that names none (a closed posting), another
 *   posting's sign and run/begin for another application are never the task's; the task's job and resume are named.
 * - one Submit per job: no form document is started after it; its confirmation is awaited, then the job is the
 *   person's; the runs started per job are capped; a refused retry fails at once.
 * - backoff and results: an empty queue or a failure waits a minute, then five; a submitted result is kept for every
 *   refusal but 404 and 400, any other for TailorIT's failure or none; the alarm and the status keep a result untold.
 * - stop: Stop, the switch off, the agent blocked, the tab closed by the person, the connection changed (the switch
 *   off, its confirmation asked again); a job past its time; a page that never loads or never shows a form. Only the
 *   agent's tab is closed, never a window.
 */
import { describe, expect, it } from 'vitest';
import { applicationOf } from '../adapters';
import { agentApplicationUrl, type AutofillAgentResultBody, type AutofillAgentTask } from '../contract/tailorit';
import type { AgentAlarms, AgentWindows, StorageArea } from '../platform/types';
import type { FrameReport } from '../shared/report';
import {
  AGENT_ALARM, AGENT_BACKOFF_MS, AGENT_CONFIRM_MS, AGENT_FORM_WAIT_MS, AGENT_JOB_MAX_MS, AGENT_JOB_TIMEOUT_MS,
  AGENT_MAX_STARTS, AGENT_RUN_KEY, AGENT_SETTLE_MS, AGENT_SIGN_IN_WAIT_MS, AGENT_SWITCH_KEY, agentVerdict, createAgent,
  type AgentDeps,
  type AgentTask,
} from './agent';
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

const ID = (n: number) => `0000000${n}-aaaa-4bbb-8ccc-00000000000${n}`;
const task = (n: number, url = `https://job-boards.greenhouse.io/northwind/jobs/55${n}`): AutofillAgentTask =>
  ({ id: ID(n), jobId: 100 + n, url, company: 'Northwind', title: `Engineer ${n}`, resumeId: null });

/** A report of the agent's tab: at review by default. */
function report(overrides: Partial<FrameReport> = {}): FrameReport {
  return { v: 1, runId: 'run-1', frameId: 0, platform: 'greenhouse', adapter: 'greenhouse', mode: 'fill', status: 'review',
    pauseReason: null, fields: [], notices: [], counters: { passes: 1, hiddenControlsIgnored: 0, deferredFields: 0 },
    updatedAt: 1, ...overrides };
}
const notices = (...codes: Array<FrameReport['notices'][number]['code']>) => codes.map((code) => ({ code }));

/** One row of TailorIT's queue. */
interface Row {
  task: AutofillAgentTask;
  state: 'queued' | 'running' | AutofillAgentResultBody['state'];
  reason: AutofillAgentResultBody['reason'];
  /** The connection that took it. */
  claimedBy: string | null;
}

/** TailorIT's queue for the account, as its server keeps it (apps/api agent/queue.ts claimQueued, ownRun,
 *  resultEffect). */
interface Queue {
  rows: Row[];
  /** The connection this browser asks with, and the account's connections that still work. */
  token: string;
  live: Set<string>;
  next: { calls: number; fail: boolean };
  /** Every POST …/result, as sent. */
  results: Array<{ id: string; body: AutofillAgentResultBody }>;
  /** Answers every POST …/result with this instead, while set (TailorIT down, say). */
  failing: ServerResult<null> | null;
}

function queueOf(tasks: AutofillAgentTask[] = []): Queue {
  return { rows: tasks.map((each) => ({ task: each, state: 'queued', reason: null, claimedBy: null })), token: 'tok-1',
    live: new Set(['tok-1']), next: { calls: 0, fail: false }, results: [], failing: null };
}

function serverOf(q: Queue): AgentDeps['server'] {
  return {
    async agentNext() {
      q.next.calls += 1;
      if (q.next.fail) return { ok: false, failure: 'unreachable' };
      const own = q.rows.find((row) => row.state === 'running' && row.claimedBy === q.token);
      if (own !== undefined) return { ok: true, value: { item: own.task } };
      const queued = q.rows.find((row) => row.state === 'queued');
      if (queued === undefined) return { ok: true, value: { item: null } };
      queued.state = 'running';
      queued.claimedBy = q.token;
      return { ok: true, value: { item: queued.task } };
    },
    async agentResult(id, body) {
      q.results.push({ id, body });
      if (q.failing !== null) return q.failing;
      const row = q.rows.find((each) => each.task.id === id);
      if (row === undefined) return { ok: false, failure: 'not-found', status: 404 };
      const conflict = { ok: false, failure: 'conflict', status: 409 } as const;
      if (body.state === 'submitted') {
        if (row.state !== 'submitted') Object.assign(row, { state: 'submitted', reason: null });
        return { ok: true, value: null };
      }
      if (row.state === 'running') {
        if (row.claimedBy !== null && row.claimedBy !== q.token && q.live.has(row.claimedBy)) return conflict;
        Object.assign(row, { state: body.state, reason: body.reason });
        return { ok: true, value: null };
      }
      if (row.state === body.state && row.reason === body.reason) return { ok: true, value: null };
      return conflict;
    },
  };
}

interface Harness {
  agent: ReturnType<typeof createAgent>;
  local: ReturnType<typeof memoryArea>;
  session: ReturnType<typeof memoryArea>;
  timers: ReturnType<typeof manualTimers>;
  clock: { now: number };
  queue: Queue;
  /** What POST …/result was sent (the queue's). */
  results: Queue['results'];
  windows: { opened: string[]; closedTabs: number[]; tabs: Set<number>; othersOpen: boolean };
  alarms: { started: string[]; stopped: string[]; log: Array<'start' | 'stop'> };
  sent: Array<{ tabId: number; message: { type: string } & Record<string, unknown> }>;
  released: number[];
  assigned: Array<{ tabId: number; applicationKey: string; task: AgentTask }>;
  reports: Map<number, FrameReport[]>;
  scopes: { value: string[] | null };
  disclosed: { value: boolean };
  changes: { count: number };
  /** The frame's answer to agent/enter, and to run/start. */
  entry: { answer: Record<string, unknown> };
  start: { answer: unknown };
  deps: AgentDeps;
}

let nonces = 0;

function harness(options: { local?: ReturnType<typeof memoryArea>; session?: ReturnType<typeof memoryArea>;
  queue?: Queue; tasks?: AutofillAgentTask[]; firstWindow?: number } = {}): Harness {
  const queue = options.queue ?? queueOf(options.tasks);
  const h = {
    local: options.local ?? memoryArea(),
    session: options.session ?? memoryArea(),
    timers: manualTimers(),
    clock: { now: Date.UTC(2026, 10, 2, 12) },
    queue,
    results: queue.results,
    windows: { opened: [] as string[], closedTabs: [] as number[], tabs: new Set<number>(), othersOpen: true },
    alarms: { started: [] as string[], stopped: [] as string[], log: [] as Array<'start' | 'stop'> },
    sent: [] as Harness['sent'],
    released: [] as number[],
    assigned: [] as Harness['assigned'],
    reports: new Map<number, FrameReport[]>(),
    scopes: { value: ['agent:run', 'tracker:write'] as string[] | null },
    disclosed: { value: true },
    changes: { count: 0 },
    entry: { answer: { outcome: 'pressed' } as Record<string, unknown> },
    start: { answer: { ok: true, data: {} } as unknown },
  } as Omit<Harness, 'agent' | 'deps'>;
  let nextWindow = options.firstWindow ?? 10;
  const windows: AgentWindows = {
    async open() {
      nextWindow += 1;
      h.windows.tabs.add(nextWindow + 100);
      return { windowId: nextWindow, tabId: nextWindow + 100 };
    },
    async navigate(tabId, url) {
      h.windows.opened.push(url);
      return h.windows.tabs.has(tabId);
    },
    async closeTab(tabId) {
      h.windows.closedTabs.push(tabId);
      h.windows.tabs.delete(tabId);
    },
    tabExists: async (tabId) => h.windows.tabs.has(tabId),
    othersOpen: async () => h.windows.othersOpen,
  };
  const alarms: AgentAlarms = {
    async start(name) {
      h.alarms.started.push(name);
      h.alarms.log.push('start');
    },
    async stop(name) {
      h.alarms.stopped.push(name);
      h.alarms.log.push('stop');
    },
    onAlarm: () => undefined,
  };
  const deps: AgentDeps = {
    server: serverOf(queue),
    local: h.local,
    session: h.session,
    windows,
    alarms,
    timers: h.timers,
    now: () => h.clock.now,
    nonce: () => `session-nonce-${(nonces += 1)}`,
    scopes: async () => h.scopes.value,
    disclosed: async () => h.disclosed.value,
    reports: async (tabId) => h.reports.get(tabId) ?? [],
    topFrame: async () => ({ frameId: 0, documentId: 'doc-1' }),
    async send(tabId, message) {
      h.sent.push({ tabId, message: message as Harness['sent'][number]['message'] });
      const type = (message as { type: string }).type;
      return type === 'agent/enter' ? { ok: true, data: h.entry.answer } : h.start.answer;
    },
    async release(tabId) {
      h.released.push(tabId);
    },
    assign(tabId, applicationKey, assigned) {
      h.assigned.push({ tabId, applicationKey, task: assigned });
    },
    changed: () => {
      h.changes.count += 1;
    },
    dayOf: (ms) => new Date(ms).toISOString().slice(0, 10),
  };
  return { ...h, agent: createAgent(deps), deps };
}

/** Turns the agent on (the person confirmed) and lets its first tick run. */
async function on(h: Harness): Promise<void> {
  const answer = await h.agent.set(true, true);
  expect(answer.ok && answer.data.on).toBe(true);
  await h.agent.tick();
}

type RunView = { tabId: number | null; windowId: number | null; id: string; applicationKey: string; session: string | null;
  result: unknown; pressedAt: number | null; heldAt: number | null; starts: number };
const runRecord = async (h: Harness) => (await h.local.get(AGENT_RUN_KEY)) as RunView | undefined;

/** The running job's tab and application key. */
async function running(h: Harness): Promise<{ tabId: number; key: string }> {
  const run = (await runRecord(h))!;
  return { tabId: run.tabId!, key: run.applicationKey };
}

/** A frame's hello for the task's own application. */
const form = (key: string, documentId: string) => ({ frameId: 0, documentId, hasForm: true, applicationKey: key });

const pressedSubmit = { buttons: { final: 'final' as const, next: false, submit: true, pressed: 'submit' as const } };

describe('agentVerdict: what a report of the agent’s run means', () => {
  const verdict = (overrides: Partial<FrameReport>, retried = false) => agentVerdict(report(overrides), { retried });
  const finish = (state: string, reason: string | null) => ({ kind: 'finish', state, reason });

  it('waits while the run works, for a Submit pressed, for the confirmation, and ignores a dry run', () => {
    for (const status of ['detect', 'scan-step', 'fill-step', 'validate', 'advance'] as const) {
      expect(verdict({ status })).toEqual({ kind: 'wait' });
    }
    expect(verdict({ status: 'wait-transition' })).toEqual({ kind: 'wait' });
    expect(verdict(pressedSubmit)).toEqual({ kind: 'wait' });
    expect(verdict({ status: 'done' })).toEqual({ kind: 'wait' });
    expect(verdict({ mode: 'dry-run', status: 'handoff', pauseReason: 'captcha' })).toEqual({ kind: 'wait' });
  });

  it('maps each stop to the contract’s state and reason', () => {
    expect(verdict({ status: 'handoff', pauseReason: 'captcha' })).toEqual(finish('needs-you', 'captcha'));
    expect(verdict({ status: 'handoff', pauseReason: 'bot-check' })).toEqual(finish('needs-you', 'captcha'));
    expect(verdict({ status: 'handoff', pauseReason: 'email-code' })).toEqual(finish('needs-you', 'email_code'));
    expect(verdict({ status: 'handoff', pauseReason: 'page-busy' })).toEqual(finish('failed', 'page_error'));
    expect(verdict({ status: 'handoff', pauseReason: 'entry-choice' })).toEqual(finish('needs-you', 'other'));
    expect(verdict({ status: 'auth-needed', notices: notices('auth') })).toEqual(finish('needs-you', 'sign_in'));
    expect(verdict({ status: 'auth-needed', notices: notices('sign-in-unavailable') })).toEqual(finish('needs-you', 'sign_in'));
    expect(verdict({ status: 'auth-needed', notices: notices('sign-in-failed') })).toEqual(finish('needs-you', 'sign_in_failed'));
    expect(verdict({ status: 'auth-needed', notices: notices('sign-in-auto') })).toEqual({ kind: 'sign-in' });
    expect(verdict({ status: 'policy-notice' })).toEqual(finish('skipped', 'posting_forbids_ai'));
    expect(verdict({ status: 'stopped', notices: notices('form-hidden') })).toEqual(finish('failed', 'page_error'));
    expect(verdict({ status: 'stopped' })).toEqual(finish('needs-you', 'cancelled'));
    expect(verdict({ notices: notices('policy-profile-only', 'submit-held-no-ai') })).toEqual(finish('skipped', 'posting_forbids_ai'));
    expect(verdict({ notices: notices('submit-held-required') })).toEqual(finish('needs-you', 'required_field_empty'));
    expect(verdict({ notices: notices('submit-held-guess') })).toEqual(finish('needs-you', 'ai_guess_legal'));
    expect(verdict({ notices: notices('submit-held-captcha') })).toEqual(finish('needs-you', 'captcha'));
    expect(verdict({ status: 'wait-transition', resting: true, notices: notices('captcha-next') }))
      .toEqual(finish('needs-you', 'captcha'));
    expect(verdict({ notices: notices('submit-unconfirmed') })).toEqual(finish('needs-you', 'other'));
    expect(verdict({ notices: notices('final-unknown') })).toEqual(finish('needs-you', 'unsupported_site'));
    expect(verdict({ notices: notices('step-retry-limit') })).toEqual(finish('failed', 'validation_error'));
    expect(verdict({ notices: notices('max-steps') })).toEqual(finish('failed', 'validation_error'));
    expect(verdict({ notices: notices('next-hidden') })).toEqual(finish('failed', 'page_error'));
  });

  it('retries only the page’s refusal of a Submit pressed, once; errors before any press and a held Submit are not retried', () => {
    expect(verdict({ notices: notices('submit-errors') })).toEqual({ kind: 'retry' });
    expect(verdict({ notices: notices('submit-errors') }, true)).toEqual(finish('failed', 'validation_error'));
    // Errors the run's own fix pass met before any Submit: the page refuses its answers, no Submit to retry.
    expect(verdict({ notices: notices('validation') })).toEqual(finish('failed', 'validation_error'));
    // A Submit held for another check was never pressed: the person's.
    expect(verdict({ notices: notices('submit-held-check') })).toEqual(finish('needs-you', 'other'));
    expect(verdict({ notices: notices('submit-held-check') }, true)).toEqual(finish('needs-you', 'other'));
    expect(verdict({})).toEqual({ kind: 'settle' });
  });
});

describe('the agent', () => {
  it('turns on only with the confirmation, agent:run and the disclosure; its status is value-free', async () => {
    const h = harness();
    expect((await h.agent.set(true, false)).ok).toBe(true);
    expect((await h.agent.status()).on).toBe(false);
    h.scopes.value = ['tracker:write'];
    expect((await h.agent.set(true, true) as { data: { on: boolean; blocked: string } }).data).toMatchObject({ on: false,
      blocked: 'no-scope' });
    h.scopes.value = ['agent:run'];
    h.disclosed.value = false;
    expect((await h.agent.status()).blocked).toBe('disclosure');
    h.disclosed.value = true;
    h.scopes.value = null;
    expect((await h.agent.status()).blocked).toBe('not-connected');
    h.scopes.value = ['agent:run'];
    const answer = await h.agent.set(true, true);
    expect(answer.ok && answer.data).toEqual({ on: true, confirmed: true, phase: 'waiting', blocked: null, allowed: true,
      pending: false, job: null, doneToday: 0, last: null });
    expect(h.alarms.started).toEqual([AGENT_ALARM]);
    // Confirmed once: on again without asking.
    await h.agent.set(false, false);
    expect((await h.agent.set(true, false) as { data: { on: boolean } }).data.on).toBe(true);
  });

  it('claims one job, opens its address in its own window, starts its run there, and reports it submitted on its sign', async () => {
    const h = harness({ tasks: [task(1), task(2)] });
    await on(h);
    expect(h.windows.opened).toEqual([task(1).url]);
    const { tabId, key } = await running(h);
    expect(await h.agent.status()).toMatchObject({ phase: 'running', job: { company: 'Northwind', title: 'Engineer 1' } });
    // Another tick does not take a second job while one runs.
    await h.agent.tick();
    expect(h.windows.opened).toHaveLength(1);
    // The window's form says hello: the agent's run is started there, once per document.
    await h.agent.hello(tabId, form(key, 'doc-1'));
    await h.agent.hello(tabId, form(key, 'doc-1'));
    await h.agent.hello(tabId + 1, form(key, 'doc-9'));
    expect(h.sent).toEqual([{ tabId, message: { v: 1, type: 'run/start', dryRun: false, agent: true } }]);
    // An AI guess counted, then the platform's sign: submitted, the tab released and closed, the next job taken soon.
    h.reports.set(tabId, [report({ fields: [{ key: 'k', label: 'Visa', kind: 'radio', category: 'unknown', section: '',
      required: true, status: 'filled', provenance: 'llm-pick', matcherStage: 'llm', confidence: 0.5, reason: 'ai-guess',
      wrote: true, verification: 'verified', needsUserAction: false }], ...pressedSubmit })]);
    await h.agent.reported(tabId);
    expect(await h.agent.submitted(tabId + 1, key)).toBe('not-ours');
    expect(await h.agent.submitted(tabId, key)).toBe('recorded');
    expect(h.results).toEqual([{ id: ID(1), body: { state: 'submitted', reason: null, aiGuesses: 1 } }]);
    expect(h.released).toEqual([tabId]);
    expect(h.windows.closedTabs).toEqual([tabId]);
    expect(await runRecord(h)).toBeUndefined();
    expect(await h.agent.status()).toMatchObject({ doneToday: 1, last: { state: 'submitted', reason: null } });
    h.timers.advance(1_000);
    await h.agent.tick();
    expect(h.windows.opened).toEqual([task(1).url, task(2).url]);
  });

  it('opens the canonical application address, and claims nothing it cannot fill (failed, unsupported_site)', async () => {
    const lever = 'https://jobs.lever.co/northwind/0b9f2d3e-1c4a-4e8b-9a7d-5f6e3c2b1a00';
    const board = 'https://job-boards.greenhouse.io/northwind?gh_jid=5540001';
    const h = harness({ tasks: [task(1, lever), task(2, board), task(3, 'https://example.com/jobs/1'),
      // A company's own page naming a Greenhouse posting (its form a frame of that page), and an EU board.
      task(4, 'https://www.northwind.example/careers?gh_jid=5540002'),
      task(5, 'https://job-boards.eu.greenhouse.io/northwind/jobs/5540003')] });
    await on(h);
    // Lever's posting: its application form's address, as TailorIT's agentApplicationUrl reads it.
    expect(h.windows.opened).toEqual([`${lever}/apply`]);
    expect(agentApplicationUrl(lever)).toBe(`${lever}/apply`);
    await h.agent.stop();
    // A board's page naming the posting: the posting's own job page, where its form is.
    await on(h);
    expect(h.windows.opened.at(-1)).toBe('https://job-boards.greenhouse.io/northwind/jobs/5540001');
    await h.agent.stop();
    await on(h);
    for (let n = 0; n < 3; n += 1) {
      h.timers.advance(1_000);
      await h.agent.tick();
    }
    expect(h.windows.opened).toHaveLength(2);
    expect(h.results.slice(2)).toEqual([3, 4, 5].map((n) => ({ id: ID(n), body: { state: 'failed',
      reason: 'unsupported_site', aiGuesses: 0 } })));
  });

  it('names the task’s job and resume for its tab, and answers run/begin only for the task’s application', async () => {
    const h = harness({ tasks: [{ ...task(1), resumeId: 'resume-7' }] });
    await on(h);
    const { tabId, key } = await running(h);
    await h.agent.hello(tabId, form(key, 'doc-1'));
    expect(h.assigned).toEqual([{ tabId, applicationKey: key, task: { jobId: 101, resumeId: 'resume-7' } }]);
    expect(await h.agent.task(tabId, key, 'doc-1')).toEqual({ jobId: 101, resumeId: 'resume-7', submitHeld: false });
    // Another application, none, or another tab: no task (run/begin {agent} is refused).
    expect(await h.agent.task(tabId, 'greenhouse:00000000000000ff')).toBeNull();
    expect(await h.agent.task(tabId, undefined)).toBeNull();
    expect(await h.agent.task(tabId + 1, key)).toBeNull();
  });

  it('presses a posting page’s entry once per document, at most twice a job, and never on a confirmation page', async () => {
    const h = harness({ tasks: [task(1, 'https://jobs.lever.co/northwind/0b9f2d3e-1c4a-4e8b-9a7d-5f6e3c2b1a00')] });
    await on(h);
    const { tabId, key } = await running(h);
    const page = (documentId: string, extra: Record<string, unknown>) => ({ frameId: 0, documentId, hasForm: false,
      applicationKey: key, ...extra });
    await h.agent.hello(tabId, page('doc-1', { posting: true }));
    await h.agent.hello(tabId, page('doc-1', { posting: true }));
    await h.agent.hello(tabId, page('doc-c', { confirmation: true }));
    expect(h.sent.map((sent) => sent.message.type)).toEqual(['agent/enter']);
    // Not offered (a form drawn late, a page still loading): nothing finishes; the form's wait covers it.
    h.entry.answer = { outcome: 'not-offered' };
    await h.agent.hello(tabId, page('doc-2', { posting: true }));
    expect(h.results).toEqual([]);
    await h.agent.hello(tabId, page('doc-3', { posting: true }));
    expect(h.results).toEqual([{ id: ID(1), body: { state: 'failed', reason: 'page_error', aiGuesses: 0 } }]);
  });

  it('maps an entry’s block to its reason: a sign-in, one that failed, an email code, a CAPTCHA, another', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ outcome: 'blocked', block: 'sign-in' }, 'sign_in'],
      [{ outcome: 'blocked', block: 'sign-in-failed' }, 'sign_in_failed'],
      [{ outcome: 'blocked', block: 'email-code' }, 'email_code'],
      [{ outcome: 'blocked', block: 'captcha' }, 'captcha'],
      [{ outcome: 'blocked', block: 'other' }, 'other'],
    ];
    for (const [answer, reason] of cases) {
      const h = harness({ tasks: [task(1)] });
      h.entry.answer = answer;
      await on(h);
      const { tabId, key } = await running(h);
      await h.agent.hello(tabId, { frameId: 0, documentId: 'doc-1', hasForm: false, posting: true, applicationKey: key });
      expect(h.results, reason).toEqual([{ id: ID(1), body: { state: 'needs-you', reason, aiGuesses: 0 } }]);
      expect(h.windows.closedTabs).toEqual([tabId]);
    }
  });

  it('never fills another posting’s page, nor a page that names no posting (a closed one)', async () => {
    const h = harness({ tasks: [task(1), task(2)] });
    await on(h);
    const first = await running(h);
    expect(first.key).toMatch(/^greenhouse:[0-9a-f]{16}$/);
    await h.agent.hello(first.tabId, form(first.key, 'doc-1'));
    expect(h.sent).toHaveLength(1);
    await h.agent.hello(first.tabId, form('greenhouse:00000000000000ff', 'doc-2'));
    expect(h.sent).toHaveLength(1);
    expect(h.results).toEqual([{ id: ID(1), body: { state: 'needs-you', reason: 'other', aiGuesses: 0 } }]);
    h.timers.advance(1_000);
    await h.agent.tick();
    const second = await running(h);
    // The platform's board, or its "not found": an address on its host that names no posting.
    await h.agent.hello(second.tabId, { frameId: 0, documentId: 'doc-3', hasForm: false });
    expect(h.sent).toHaveLength(1);
    expect(h.results.at(-1)).toEqual({ id: ID(2), body: { state: 'failed', reason: 'posting_closed', aiGuesses: 0 } });
  });

  it('a page that said hello but never showed a form is a closed posting; one that never loaded, a page error', async () => {
    const h = harness({ tasks: [task(1), task(2)] });
    await on(h);
    const { tabId, key } = await running(h);
    await h.agent.hello(tabId, { frameId: 0, documentId: 'doc-1', hasForm: false, applicationKey: key });
    h.entry.answer = { outcome: 'not-offered' };
    h.clock.now += AGENT_FORM_WAIT_MS;
    await h.agent.tick();
    expect(h.results).toEqual([{ id: ID(1), body: { state: 'failed', reason: 'posting_closed', aiGuesses: 0 } }]);
    h.timers.advance(1_000);
    await h.agent.tick();
    h.clock.now += AGENT_FORM_WAIT_MS;
    await h.agent.tick();
    expect(h.results.at(-1)).toEqual({ id: ID(2), body: { state: 'failed', reason: 'page_error', aiGuesses: 0 } });
  });

  it('takes another posting’s sign as not the task’s: the job is the person’s, and the sign recorded the normal way', async () => {
    const h = harness({ tasks: [task(1)] });
    await on(h);
    const { tabId, key } = await running(h);
    await h.agent.hello(tabId, form(key, 'doc-1'));
    expect(await h.agent.submitted(tabId, 'greenhouse:00000000000000ff')).toBe('not-ours');
    expect(h.results).toEqual([{ id: ID(1), body: { state: 'needs-you', reason: 'other', aiGuesses: 0 } }]);
    expect(h.windows.closedTabs).toEqual([tabId]);
  });

  it('starts no form document after the job’s Submit: it awaits the confirmation, then leaves the job for the person', async () => {
    const h = harness({ tasks: [task(1), task(2)] });
    await on(h);
    const first = await running(h);
    await h.agent.hello(first.tabId, form(first.key, 'doc-1'));
    // Submit mode Auto armed the job's Submit (submit/armed in its tab).
    await h.agent.pressed(first.tabId, 'greenhouse:00000000000000ff', 'doc-1');
    expect((await runRecord(h))!.pressedAt).toBeNull();
    expect(await h.agent.task(first.tabId, first.key, 'doc-2')).toMatchObject({ submitHeld: false });
    await h.agent.pressed(first.tabId, first.key, 'doc-1');
    // Submit stays Auto in the document it was pressed in (its one retry), Manual in any other (a run the page's load
    // resumes there by itself presses nothing).
    expect(await h.agent.task(first.tabId, first.key, 'doc-1')).toMatchObject({ submitHeld: false });
    expect(await h.agent.task(first.tabId, first.key, 'doc-2')).toMatchObject({ submitHeld: true });
    expect(await h.agent.task(first.tabId, first.key, undefined)).toMatchObject({ submitHeld: true });
    // The form shows again in a new document (the page reloaded): never filled again.
    await h.agent.hello(first.tabId, form(first.key, 'doc-2'));
    expect(h.sent.filter((sent) => sent.message.type === 'run/start')).toHaveLength(1);
    expect((await runRecord(h))!.heldAt).not.toBeNull();
    h.clock.now += AGENT_CONFIRM_MS - 1;
    await h.agent.tick();
    expect(h.results).toEqual([]);
    h.clock.now += 1;
    await h.agent.tick();
    expect(h.results).toEqual([{ id: ID(1), body: { state: 'needs-you', reason: 'other', aiGuesses: 0 } }]);
    // A report saying the Submit was pressed counts too, and after the one retry the job failed.
    h.timers.advance(1_000);
    await h.agent.tick();
    const second = await running(h);
    await h.agent.hello(second.tabId, form(second.key, 'doc-1'));
    h.reports.set(second.tabId, [report({ notices: notices('submit-errors') })]);
    await h.agent.reported(second.tabId);
    h.reports.set(second.tabId, [report({ runId: 'run-2', updatedAt: 2, ...pressedSubmit })]);
    await h.agent.reported(second.tabId);
    expect((await runRecord(h))!.pressedAt).not.toBeNull();
    await h.agent.hello(second.tabId, form(second.key, 'doc-2'));
    expect(h.sent.filter((sent) => sent.tabId === second.tabId && sent.message.type === 'run/start')).toHaveLength(2);
    h.clock.now += AGENT_CONFIRM_MS;
    await h.agent.tick();
    expect(h.results.at(-1)).toEqual({ id: ID(2), body: { state: 'failed', reason: 'validation_error', aiGuesses: 0 } });
  });

  it('starts at most AGENT_MAX_STARTS runs a job: a form that keeps loading again is the person’s', async () => {
    const h = harness({ tasks: [task(1)] });
    await on(h);
    const { tabId, key } = await running(h);
    for (let n = 1; n <= AGENT_MAX_STARTS; n += 1) await h.agent.hello(tabId, form(key, `doc-${n}`));
    expect(h.sent.filter((sent) => sent.message.type === 'run/start')).toHaveLength(AGENT_MAX_STARTS);
    expect(h.results).toEqual([]);
    await h.agent.hello(tabId, form(key, 'doc-last'));
    expect(h.sent.filter((sent) => sent.message.type === 'run/start')).toHaveLength(AGENT_MAX_STARTS);
    expect(h.results).toEqual([{ id: ID(1), body: { state: 'needs-you', reason: 'other', aiGuesses: 0 } }]);
  });

  it('leaves a job for the person on a CAPTCHA, a sign-in, an empty required field; skips a no-AI posting', async () => {
    const cases: Array<[Partial<FrameReport>, string, string]> = [
      [{ status: 'handoff', pauseReason: 'captcha' }, 'needs-you', 'captcha'],
      [{ status: 'auth-needed', notices: notices('auth') }, 'needs-you', 'sign_in'],
      [{ notices: notices('submit-held-required') }, 'needs-you', 'required_field_empty'],
      [{ notices: notices('submit-held-no-ai') }, 'skipped', 'posting_forbids_ai'],
    ];
    for (const [shape, state, reason] of cases) {
      const h = harness({ tasks: [task(1)] });
      await on(h);
      const { tabId } = await running(h);
      h.reports.set(tabId, [report(shape)]);
      await h.agent.reported(tabId);
      expect(h.results).toEqual([{ id: ID(1), body: { state, reason, aiGuesses: 0 } }]);
      expect(h.windows.closedTabs).toEqual([tabId]);
    }
  });

  it('retries a refused Submit once (its run’s reports no longer count), then fails it; a refused retry fails at once', async () => {
    const h = harness({ tasks: [task(1), task(2)] });
    await on(h);
    const { tabId } = await running(h);
    h.reports.set(tabId, [report({ runId: 'run-1', notices: notices('submit-errors') })]);
    await h.agent.reported(tabId);
    expect(h.sent).toEqual([{ tabId, message: { v: 1, type: 'run/start', dryRun: false, agent: true, retry: true } }]);
    // The retried run's last report again: nothing yet.
    await h.agent.reported(tabId);
    expect(h.results).toEqual([]);
    h.reports.set(tabId, [report({ runId: 'run-2', notices: notices('submit-errors'), updatedAt: 2 })]);
    await h.agent.reported(tabId);
    expect(h.results).toEqual([{ id: ID(1), body: { state: 'failed', reason: 'validation_error', aiGuesses: 0 } }]);
    // The frame refuses the retry (its run started elsewhere, the page gone): failed now, not at the timeout.
    h.timers.advance(1_000);
    await h.agent.tick();
    const second = await running(h);
    h.start.answer = { ok: false, error: 'expired' };
    h.reports.set(second.tabId, [report({ runId: 'run-3', notices: notices('submit-errors') })]);
    await h.agent.reported(second.tabId);
    expect(h.results.at(-1)).toEqual({ id: ID(2), body: { state: 'failed', reason: 'validation_error', aiGuesses: 0 } });
  });

  it('settles a rest nothing decides after AGENT_SETTLE_MS, and a sign-in after AGENT_SIGN_IN_WAIT_MS', async () => {
    const h = harness({ tasks: [task(1), task(2)] });
    await on(h);
    const { tabId } = await running(h);
    h.reports.set(tabId, [report()]);
    await h.agent.reported(tabId);
    h.clock.now += AGENT_SETTLE_MS - 1;
    await h.agent.reported(tabId);
    expect(h.results).toEqual([]);
    h.clock.now += 1;
    await h.agent.reported(tabId);
    expect(h.results).toEqual([{ id: ID(1), body: { state: 'needs-you', reason: 'other', aiGuesses: 0 } }]);
    h.timers.advance(1_000);
    await h.agent.tick();
    const second = await running(h);
    await h.agent.hello(second.tabId, form(second.key, 'doc-1'));
    h.reports.set(second.tabId, [report({ status: 'auth-needed', notices: notices('sign-in-auto') })]);
    await h.agent.reported(second.tabId);
    h.clock.now += AGENT_SIGN_IN_WAIT_MS;
    await h.agent.tick();
    expect(h.results.at(-1)).toEqual({ id: ID(2), body: { state: 'needs-you', reason: 'sign_in', aiGuesses: 0 } });
  });

  it('finds its job again after a worker restart, and never opens it twice', async () => {
    const local = memoryArea();
    const session = memoryArea();
    const queue = queueOf([task(1)]);
    const first = harness({ local, session, queue });
    await on(first);
    const { tabId } = await running(first);
    // A new worker over the same storage and TailorIT: it watches the same tab and asks TailorIT for nothing new.
    const calls = queue.next.calls;
    const again = harness({ local, session, queue });
    again.windows.tabs.add(tabId);
    await again.agent.start();
    expect(again.windows.opened).toEqual([]);
    expect(queue.next.calls).toBe(calls);
    expect(await again.agent.ownsTab(tabId)).toBe(true);
    // Its tab gone meanwhile (closed by the person): the job is the person's, never opened again, nothing closed.
    const later = harness({ local, session, queue });
    await later.agent.start();
    expect(later.windows.opened).toEqual([]);
    expect(later.windows.closedTabs).toEqual([]);
    expect(later.results).toEqual([{ id: ID(1), body: { state: 'needs-you', reason: 'cancelled', aiGuesses: 0 } }]);
  });

  it('leaves a job of another browser session for the person: a tab with its old id is never the agent’s, nor closed', async () => {
    const local = memoryArea();
    const queue = queueOf([task(1), task(2)]);
    const first = harness({ local, queue });
    await on(first);
    const { tabId } = await running(first);
    expect((await runRecord(first))!.session).toMatch(/^session-nonce-\d+$/);
    // The browser restarted: storage.session is empty, and Chrome gave the same tab id to one of the person's tabs.
    const fresh = harness({ local, session: memoryArea(), queue, firstWindow: 50 });
    fresh.windows.tabs.add(tabId);
    expect(await fresh.agent.ownsTab(tabId)).toBe(false);
    expect(await fresh.agent.task(tabId, (await runRecord(first))!.applicationKey)).toBeNull();
    await fresh.agent.hello(tabId, form((await runRecord(first))!.applicationKey, 'doc-1'));
    expect(fresh.sent).toEqual([]);
    expect(fresh.assigned).toEqual([]);
    await fresh.agent.start();
    expect(fresh.results).toEqual([{ id: ID(1), body: { state: 'needs-you', reason: 'cancelled', aiGuesses: 0 } }]);
    // Nothing closed, nothing released: that tab is the person's.
    expect(fresh.windows.closedTabs).toEqual([]);
    expect(fresh.released).toEqual([]);
    expect(fresh.windows.tabs.has(tabId)).toBe(true);
    // The next job opens in this session's own window.
    fresh.timers.advance(1_000);
    await fresh.agent.tick();
    expect(await runRecord(fresh)).toMatchObject({ id: ID(2), tabId: 151 });
    expect(await fresh.agent.ownsTab(151)).toBe(true);
  });

  it('opens a job claimed but never opened from the row TailorIT gives back, and drops one TailorIT no longer runs', async () => {
    const now = Date.UTC(2026, 10, 2, 12);
    const keyOf = (url: string) => applicationOf(new URL(agentApplicationUrl(url)!))!.applicationKey;
    // The worker stopped between its claim and opening the window: the record holds no tab.
    const unopened = (n: number, applicationKey: string) => ({ id: ID(n), applicationKey, jobId: 100 + n, resumeId: null,
      company: 'Northwind', title: `Engineer ${n}`, session: null, windowId: null, tabId: null, claimedAt: now,
      openedAt: null, heardAt: null, formAt: null, progressAt: now, lastReportAt: null, starts: 0, started: [], entered: [],
      pressedAt: null, pressedDoc: null, heldAt: null, retried: false, staleRunId: null, guesses: {}, waiting: null,
      result: null });
    const claimed = (n: number) => {
      const queue = queueOf([task(n)]);
      Object.assign(queue.rows[0]!, { state: 'running', claimedBy: queue.token });
      return queue;
    };
    const withRecord = async (record: object) => {
      const local = memoryArea();
      await local.set({ [AGENT_SWITCH_KEY]: { on: true, confirmed: true }, [AGENT_RUN_KEY]: record });
      return local;
    };
    // TailorIT gives its row back: opened, once.
    const h = harness({ local: await withRecord(unopened(1, keyOf(task(1).url))), queue: claimed(1) });
    await h.agent.start();
    expect(h.windows.opened).toEqual([task(1).url]);
    // A record whose key is not the row's address's: never opened (failed, unsupported_site).
    const wrong = harness({ local: await withRecord(unopened(2, 'greenhouse:0000000000000000')), queue: claimed(2) });
    await wrong.agent.start();
    expect(wrong.windows.opened).toEqual([]);
    expect(wrong.results).toEqual([{ id: ID(2), body: { state: 'failed', reason: 'unsupported_site', aiGuesses: 0 } }]);
    // A row TailorIT no longer runs for this browser: the record goes, nothing opened, nothing told.
    const gone = harness({ local: await withRecord(unopened(3, keyOf(task(3).url))), queue: queueOf() });
    await gone.agent.start();
    expect(gone.windows.opened).toEqual([]);
    expect(gone.results).toEqual([]);
    expect(await gone.local.get(AGENT_RUN_KEY)).toBeUndefined();
  });

  it('backs off an empty queue and a failure: a minute, then five', async () => {
    const h = harness();
    await on(h);
    expect(h.queue.next.calls).toBe(1);
    h.clock.now += AGENT_BACKOFF_MS[0] - 1;
    await h.agent.tick();
    expect(h.queue.next.calls).toBe(1);
    h.clock.now += 1;
    await h.agent.tick();
    expect(h.queue.next.calls).toBe(2);
    h.clock.now += AGENT_BACKOFF_MS[0];
    await h.agent.tick();
    expect(h.queue.next.calls).toBe(2);
    h.clock.now += AGENT_BACKOFF_MS[1] - AGENT_BACKOFF_MS[0];
    h.queue.next.fail = true;
    await h.agent.tick();
    expect(h.queue.next.calls).toBe(3);
    h.clock.now += AGENT_BACKOFF_MS[0];
    await h.agent.tick();
    expect(h.queue.next.calls).toBe(3);
  });

  it('takes no job while no window of the person’s is open, and says so', async () => {
    const h = harness({ tasks: [task(1)] });
    h.windows.othersOpen = false;
    await on(h);
    expect(h.queue.next.calls).toBe(0);
    expect(await h.agent.status()).toMatchObject({ phase: 'blocked', blocked: 'no-window' });
    h.windows.othersOpen = true;
    await h.agent.tick();
    expect(h.windows.opened).toEqual([task(1).url]);
  });

  it('keeps a submitted result for every refusal but 404 and 400, and sends it again', async () => {
    const kept: Array<ServerResult<null>> = [
      { ok: false, failure: 'unreachable' },
      { ok: false, failure: 'unauthorized', status: 401 },
      { ok: false, failure: 'forbidden', status: 403 },
      { ok: false, failure: 'conflict', status: 409 },
      { ok: false, failure: 'server-error', status: 500 },
    ];
    for (const failing of kept) {
      const h = harness({ tasks: [task(1)] });
      await on(h);
      const { tabId, key } = await running(h);
      h.queue.failing = failing;
      expect(await h.agent.submitted(tabId, key), JSON.stringify(failing)).toBe('not-recorded');
      expect(await runRecord(h)).toMatchObject({ result: { state: 'submitted' } });
      expect(await h.agent.status()).toMatchObject({ pending: true, phase: 'waiting' });
      h.queue.failing = null;
      await h.agent.tick();
      expect(h.results.map((sent) => sent.body.state)).toEqual(['submitted', 'submitted']);
      expect(h.queue.rows[0]!.state).toBe('submitted');
      expect(await runRecord(h)).toBeUndefined();
      expect(await h.agent.status()).toMatchObject({ pending: false, doneToday: 1 });
    }
    const dropped: Array<ServerResult<null>> = [{ ok: false, failure: 'not-found', status: 404 },
      { ok: false, failure: 'bad-request', status: 400 }];
    for (const failing of dropped) {
      const h = harness({ tasks: [task(1)] });
      await on(h);
      const { tabId, key } = await running(h);
      h.queue.failing = failing;
      expect(await h.agent.submitted(tabId, key)).toBe('not-recorded');
      expect(await runRecord(h)).toBeUndefined();
    }
  });

  it('keeps any other result for TailorIT’s failure, and drops one TailorIT refused for good', async () => {
    const h = harness({ tasks: [task(1), task(2)] });
    await on(h);
    const first = await running(h);
    h.queue.failing = { ok: false, failure: 'unreachable' };
    h.reports.set(first.tabId, [report({ status: 'handoff', pauseReason: 'captcha' })]);
    await h.agent.reported(first.tabId);
    expect(await runRecord(h)).toMatchObject({ result: { state: 'needs-you', reason: 'captcha' } });
    h.queue.failing = null;
    await h.agent.tick();
    expect(h.queue.rows[0]).toMatchObject({ state: 'needs-you', reason: 'captcha' });
    h.timers.advance(1_000);
    await h.agent.tick();
    const second = await running(h);
    // TailorIT ended the row meanwhile (the person took it out of the queue): its 409 drops the result.
    Object.assign(h.queue.rows[1]!, { state: 'skipped', reason: 'other' });
    h.reports.set(second.tabId, [report({ status: 'handoff', pauseReason: 'captcha' })]);
    await h.agent.reported(second.tabId);
    expect(await runRecord(h)).toBeUndefined();
    expect(await h.agent.status()).toMatchObject({ pending: false });
  });

  it('stops: Stop and the switch off leave the job for the person; a result untold keeps the alarm', async () => {
    const h = harness({ tasks: [task(1), task(2)] });
    await on(h);
    const first = await running(h);
    const stopped = await h.agent.stop();
    expect(stopped.ok && stopped.data).toMatchObject({ on: false, phase: 'off', pending: false });
    expect(h.results).toEqual([{ id: ID(1), body: { state: 'needs-you', reason: 'cancelled', aiGuesses: 0 } }]);
    expect(h.windows.closedTabs).toEqual([first.tabId]);
    expect(h.alarms.log.at(-1)).toBe('stop');
    // Off: a tick takes nothing.
    await h.agent.tick();
    expect(h.queue.next.calls).toBe(1);
    await on(h);
    const second = await running(h);
    // TailorIT down when the person stops: the result waits, and the alarm stays to tell it.
    h.queue.failing = { ok: false, failure: 'unreachable' };
    const off = await h.agent.set(false, false);
    expect(off.ok && off.data).toMatchObject({ on: false, phase: 'off', pending: true });
    expect(h.alarms.log.at(-1)).toBe('start');
    h.queue.failing = null;
    await h.agent.tick();
    expect(h.queue.rows[1]).toMatchObject({ state: 'needs-you', reason: 'cancelled' });
    expect(await h.agent.status()).toMatchObject({ pending: false });
    expect(h.alarms.log.at(-1)).toBe('stop');
    expect(h.windows.closedTabs).toEqual([first.tabId, second.tabId]);
  });

  it('the person closing its tab leaves the job for them, and nothing is closed', async () => {
    const h = harness({ tasks: [task(1)] });
    await on(h);
    const { tabId } = await running(h);
    h.windows.tabs.delete(tabId);
    await h.agent.tabRemoved(tabId);
    expect(h.results).toEqual([{ id: ID(1), body: { state: 'needs-you', reason: 'cancelled', aiGuesses: 0 } }]);
    expect(h.windows.closedTabs).toEqual([]);
    expect(h.released).toEqual([]);
  });

  it('finishes and closes the running job when it is blocked: a disclosure to acknowledge, no agent:run', async () => {
    for (const block of ['disclosure', 'no-scope'] as const) {
      const h = harness({ tasks: [task(1)] });
      await on(h);
      const { tabId, key } = await running(h);
      if (block === 'disclosure') h.disclosed.value = false;
      else h.scopes.value = ['tracker:write'];
      // Blocked: the tab is no longer the agent's, its frames get no task, no run is started.
      expect(await h.agent.ownsTab(tabId)).toBe(false);
      expect(await h.agent.task(tabId, key)).toBeNull();
      await h.agent.hello(tabId, form(key, 'doc-1'));
      expect(h.sent).toEqual([]);
      await h.agent.tick();
      expect(h.windows.closedTabs, block).toEqual([tabId]);
      expect(h.released, block).toEqual([tabId]);
      if (block === 'disclosure') {
        expect(h.results).toEqual([{ id: ID(1), body: { state: 'needs-you', reason: 'cancelled', aiGuesses: 0 } }]);
      } else {
        // Without agent:run the result waits to be told.
        expect(h.results).toEqual([]);
        expect(await h.agent.status()).toMatchObject({ pending: true });
      }
    }
  });

  it('a changed connection turns Run auto-apply off, its confirmation asked again, and closes the job to tell later', async () => {
    const h = harness({ tasks: [task(1)] });
    await on(h);
    const { tabId } = await running(h);
    h.scopes.value = null;
    await h.agent.tokenChanged();
    expect(h.windows.closedTabs).toEqual([tabId]);
    expect(await h.agent.status()).toMatchObject({ on: false, confirmed: false, phase: 'off', pending: true });
    expect(h.alarms.log.at(-1)).toBe('start');
    // Connected again (a new connection; the old one gone): told then, and on only with the confirmation again.
    h.queue.live.delete('tok-1');
    h.queue.token = 'tok-2';
    h.queue.live.add('tok-2');
    h.scopes.value = ['agent:run'];
    await h.agent.tick();
    expect(h.results).toEqual([{ id: ID(1), body: { state: 'needs-you', reason: 'cancelled', aiGuesses: 0 } }]);
    expect(h.queue.rows[0]).toMatchObject({ state: 'needs-you', reason: 'cancelled' });
    expect((await h.agent.set(true, false) as { data: { on: boolean } }).data.on).toBe(false);
    expect((await h.agent.set(true, true) as { data: { on: boolean } }).data.on).toBe(true);
  });

  it('a job past its time, or with no progress, is finished; a run at work in a hidden window is progress', async () => {
    const h = harness({ tasks: [task(1), task(2)] });
    await on(h);
    const first = await running(h);
    await h.agent.hello(first.tabId, form(first.key, 'doc-1'));
    // Done, its confirmation never come, nothing new for AGENT_JOB_TIMEOUT_MS: timed out.
    h.reports.set(first.tabId, [report({ status: 'done', updatedAt: 5 })]);
    await h.agent.reported(first.tabId);
    h.clock.now += AGENT_JOB_TIMEOUT_MS;
    await h.agent.tick();
    expect(h.results).toEqual([{ id: ID(1), body: { state: 'needs-you', reason: 'timed_out', aiGuesses: 0 } }]);
    h.timers.advance(1_000);
    await h.agent.tick();
    const second = await running(h);
    await h.agent.hello(second.tabId, form(second.key, 'doc-1'));
    // Filling, its AI answers awaited (the report unchanged): progress, past AGENT_JOB_TIMEOUT_MS between two looks.
    h.reports.set(second.tabId, [report({ status: 'fill-step', updatedAt: 7 })]);
    await h.agent.reported(second.tabId);
    h.clock.now += AGENT_JOB_TIMEOUT_MS + 60_000;
    await h.agent.tick();
    expect(h.results).toHaveLength(1);
    // Never past AGENT_JOB_MAX_MS in all.
    h.clock.now += AGENT_JOB_MAX_MS;
    await h.agent.tick();
    expect(h.results.at(-1)).toEqual({ id: ID(2), body: { state: 'needs-you', reason: 'timed_out', aiGuesses: 0 } });
  });
});
