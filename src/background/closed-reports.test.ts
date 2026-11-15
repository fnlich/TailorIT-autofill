/*
 * v3.0 X1-EXT (autofill API 9; TailorIT docs/design/part2/14-extension-reports.md §3.3): the closed-link reports'
 * queue (closed-reports.ts), on its own: what may go by itself, one at a time, backoff, the 24-hour drop, the 429 hold
 * until TailorIT's reset, a refusal for good, the person's own report, the runs' addresses, and what a token change takes.
 * Undo proofs: send while the hold lasts (drop the `hold > now` check) and the 429 test fails; keep a refused report and
 * the refusal test fails; read the setting as off when absent and the first test fails.
 */
import { describe, expect, it } from 'vitest';
import type { AutofillClosedReportRequest, AutofillClosedReportResponse } from '../contract/tailorit';
import type { StorageArea } from '../platform/types';
import {
  CLOSED_ALARM, CLOSED_DROP_MS, CLOSED_HOLD_FALLBACK_MS, CLOSED_HOLD_KEY, CLOSED_QUEUE_KEY, CLOSED_RETRY_MS, CLOSED_RUNS_KEY,
  createClosedReports, isoOf,
} from './closed-reports';
import type { ServerResult } from './server-client';
import { manualTimers } from './timers';

/** A storage area over a Map, as chrome.storage keeps JSON. */
function memoryArea(): StorageArea & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async (key) => (data.has(key) ? JSON.parse(JSON.stringify(data.get(key))) as unknown : undefined),
    getMany: async () => ({}),
    async set(entries) {
      for (const [key, value] of Object.entries(entries)) data.set(key, JSON.parse(JSON.stringify(value)) as unknown);
    },
    async remove(keys) {
      for (const key of keys) data.delete(key);
    },
    async restrictToTrustedContexts() {},
  };
}

type Answer = ServerResult<AutofillClosedReportResponse>;
const START = Date.UTC(2026, 10, 14, 18);
const URL = 'https://jobs.smartrecruiters.com/Northwind/1234567890-engineer';
const report = (overrides: Partial<AutofillClosedReportRequest> = {}): AutofillClosedReportRequest =>
  ({ url: URL, signal: 'marker', marker: 'smartrecruiters.expired', via: 'page', seenAt: isoOf(START), ...overrides });
const queued: Answer = { ok: true, value: { outcome: 'queued' } };

function harness(options: { session?: ReturnType<typeof memoryArea>; clock?: { now: number } } = {}) {
  const session = options.session ?? memoryArea();
  const clock = options.clock ?? { now: START };
  const timers = manualTimers();
  const sent: Array<{ jobId: number; body: AutofillClosedReportRequest }> = [];
  const answers: Answer[] = [];
  const alarms: string[] = [];
  const state = { automatic: true, connected: true, disclosed: true, scopes: ['jobs:lookup', 'jobs:add'] as string[] | null,
    changes: 0 };
  let nonce = 0;
  const reports = createClosedReports({
    server: {
      async closedReport(jobId, body) {
        sent.push({ jobId, body });
        return answers.shift() ?? queued;
      },
    },
    session,
    automatic: async () => state.automatic,
    timers,
    alarms: { start: async (name) => void alarms.push(`start ${name}`), stop: async (name) => void alarms.push(`stop ${name}`) },
    now: () => clock.now,
    nonce: () => `nonce-${String((nonce += 1)).padStart(4, '0')}`,
    connected: async () => state.connected,
    disclosed: async () => state.disclosed,
    scopes: async () => state.scopes,
    changed: () => void (state.changes += 1),
  });
  /** Moves the clock and the timers on, then lets the queue's work settle. */
  const advance = async (ms: number) => {
    clock.now += ms;
    timers.advance(ms);
    await reports.flush();
  };
  return { session, clock, timers, sent, answers, alarms, state, reports, advance };
}

describe('the closed-link reports’ queue (closed-reports.ts)', () => {
  it('sends a report that may go by itself at once, one per job, and says the job was reported by itself', async () => {
    const h = harness();
    await h.reports.ready;
    expect(await h.reports.automatic(1042, report())).toBe(true);
    await h.reports.flush();
    expect(h.sent).toEqual([{ jobId: 1042, body: report() }]);
    expect(h.reports.reportedOf(1042)).toBe('auto');
    expect(h.state.changes).toBe(1);
    expect(h.session.data.has(CLOSED_QUEUE_KEY)).toBe(false);
    // The same job again: already reported, nothing more goes.
    expect(await h.reports.automatic(1042, report({ signal: 'valid_through_past', marker: undefined }))).toBe(false);
    await h.reports.flush();
    expect(h.sent).toHaveLength(1);
  });

  it('queues nothing with the setting off, without a connection, its jobs:add scope or the disclosure acknowledged', async () => {
    for (const change of [{ automatic: false }, { connected: false }, { scopes: ['jobs:lookup'] }, { scopes: null },
      { disclosed: false }] as const) {
      const h = harness();
      Object.assign(h.state, change);
      expect(await h.reports.automatic(1042, report()), JSON.stringify(change)).toBe(false);
      await h.reports.flush();
      expect(h.sent, JSON.stringify(change)).toEqual([]);
      expect(h.reports.reportedOf(1042)).toBeNull();
    }
  });

  it('refuses a report the contract refuses, or a job id that is no positive integer, before anything is queued', async () => {
    const h = harness();
    expect(await h.reports.automatic(0, report())).toBe(false);
    expect(await h.reports.automatic(1042, report({ signal: 'person' }))).toBe(false);
    expect(await h.reports.automatic(1042, report({ signal: 'no_posting', marker: undefined }))).toBe(false);
    await h.reports.flush();
    expect(h.sent).toEqual([]);
  });

  it('tries again after a network failure or TailorIT’s own, 30 s, then 2, 10, 30 and 60 minutes, waking by its alarm', async () => {
    const h = harness();
    h.answers.push({ ok: false, failure: 'unreachable' }, { ok: false, failure: 'server-error', status: 503 },
      { ok: false, failure: 'timeout' }, { ok: false, failure: 'bad-answer' }, { ok: false, failure: 'version-mismatch' });
    await h.reports.automatic(1042, report());
    await h.reports.flush();
    expect(h.sent).toHaveLength(1);
    expect(h.alarms.at(-1)).toBe(`start ${CLOSED_ALARM}`);
    let total = 1;
    for (const wait of CLOSED_RETRY_MS) {
      await h.advance(wait - 1);
      expect(h.sent, `before ${wait}`).toHaveLength(total);
      await h.advance(1);
      total += 1;
      expect(h.sent, `after ${wait}`).toHaveLength(total);
    }
    // The sixth went: the queue is empty, its alarm stopped.
    expect(h.session.data.has(CLOSED_QUEUE_KEY)).toBe(false);
    expect(h.alarms.at(-1)).toBe(`stop ${CLOSED_ALARM}`);
    expect(h.reports.reportedOf(1042)).toBe('auto');
  });

  it('drops a report still not sent after its day (the contract’s 24 hours)', async () => {
    const h = harness();
    h.answers.push(...Array.from({ length: 40 }, (): Answer => ({ ok: false, failure: 'unreachable' })));
    await h.reports.automatic(1042, report());
    await h.reports.flush();
    await h.advance(CLOSED_DROP_MS - 60 * 60_000);
    const before = h.sent.length;
    expect(h.session.data.has(CLOSED_QUEUE_KEY)).toBe(true);
    await h.advance(60 * 60_000);
    expect(h.session.data.has(CLOSED_QUEUE_KEY)).toBe(false);
    await h.advance(CLOSED_RETRY_MS.at(-1)!);
    expect(h.sent.length).toBeLessThanOrEqual(before + 1);
  });

  it('drops a report TailorIT refuses for good, and the card no longer says it was reported', async () => {
    for (const failure of ['not-found', 'bad-request', 'forbidden', 'unauthorized', 'conflict'] as const) {
      const h = harness();
      h.answers.push({ ok: false, failure });
      await h.reports.automatic(1042, report());
      await h.reports.flush();
      expect(h.session.data.has(CLOSED_QUEUE_KEY), failure).toBe(false);
      expect(h.reports.reportedOf(1042), failure).toBeNull();
      expect(h.state.changes, failure).toBe(2);
      await h.advance(CLOSED_RETRY_MS.at(-1)!);
      expect(h.sent, failure).toHaveLength(1);
    }
  });

  it('holds every automatic report until TailorIT’s reset after its daily cap (429), and sends the waiting ones then', async () => {
    const h = harness();
    const resetAt = START + 6 * 60 * 60_000;
    h.answers.push({ ok: false, failure: 'rate-limited', status: 429, message: 'You can report up to 50 closed jobs a day.',
      resetAt: isoOf(resetAt) });
    await h.reports.automatic(1042, report());
    await h.reports.flush();
    expect(h.session.data.get(CLOSED_HOLD_KEY)).toBe(resetAt);
    // Another job's report waits too: nothing goes before the reset.
    expect(await h.reports.automatic(1043, report())).toBe(true);
    await h.advance(resetAt - START - 1);
    expect(h.sent.map((each) => each.jobId)).toEqual([1042]);
    await h.advance(1);
    expect(h.sent.map((each) => each.jobId)).toEqual([1042, 1042, 1043]);
    expect(h.session.data.has(CLOSED_QUEUE_KEY)).toBe(false);
  });

  it('holds an hour after a 429 that names no reset (an older TailorIT), or Retry-After’s seconds', async () => {
    // A missing Retry-After reads as 0 seconds (the server client): no hold of 0, which would ask again at once.
    const h = harness();
    h.answers.push({ ok: false, failure: 'rate-limited', status: 429, retryAfterSeconds: 0 });
    await h.reports.automatic(1042, report());
    await h.reports.flush();
    expect(h.session.data.get(CLOSED_HOLD_KEY)).toBe(START + CLOSED_HOLD_FALLBACK_MS);
    await h.advance(CLOSED_HOLD_FALLBACK_MS - 1);
    expect(h.sent).toHaveLength(1);
    const other = harness();
    other.answers.push({ ok: false, failure: 'rate-limited', status: 429, retryAfterSeconds: 90 });
    await other.reports.automatic(1042, report());
    await other.reports.flush();
    expect(other.session.data.get(CLOSED_HOLD_KEY)).toBe(START + 90_000);
  });

  it('sends the person’s own report at once, whatever the setting and the hold, and says what came of it', async () => {
    const h = harness();
    h.state.automatic = false;
    await h.session.set({ [CLOSED_HOLD_KEY]: START + 60 * 60_000 });
    expect(await h.reports.person(1042, URL)).toEqual({ outcome: 'reported' });
    expect(h.sent).toEqual([{ jobId: 1042, body: { url: URL, signal: 'person', via: 'person', seenAt: isoOf(START) } }]);
    expect(h.reports.reportedOf(1042)).toBe('person');
    h.answers.push({ ok: true, value: { outcome: 'closed' } }, { ok: true, value: { outcome: 'already_closed' } });
    expect(await h.reports.person(7, URL)).toEqual({ outcome: 'closed' });
    expect(await h.reports.person(8, URL)).toEqual({ outcome: 'already-closed' });
    // The day's cap, in TailorIT's words; a connection without jobs:add; none; TailorIT's failure.
    h.answers.push({ ok: false, failure: 'rate-limited', status: 429, message: 'You can report up to 50 closed jobs a day.',
      resetAt: isoOf(START + 1000) });
    expect(await h.reports.person(9, URL)).toEqual({ outcome: 'limited', message: 'You can report up to 50 closed jobs a day.' });
    h.answers.push({ ok: false, failure: 'forbidden', status: 403 }, { ok: false, failure: 'unreachable' });
    expect(await h.reports.person(10, URL)).toEqual({ outcome: 'not-allowed' });
    expect(await h.reports.person(11, URL)).toEqual({ outcome: 'unavailable' });
    h.state.scopes = ['jobs:lookup'];
    expect(await h.reports.person(12, URL)).toEqual({ outcome: 'not-allowed' });
    h.state.connected = false;
    expect(await h.reports.person(13, URL)).toEqual({ outcome: 'not-connected' });
    expect(h.sent.map((each) => each.jobId)).toEqual([1042, 7, 8, 9, 10, 11]);
  });

  it('never sends the person’s report before the disclosure is acknowledged as it reads now', async () => {
    const h = harness();
    h.state.disclosed = false;
    expect(await h.reports.person(1042, URL)).toEqual({ outcome: 'unavailable' });
    expect(h.sent).toEqual([]);
  });

  it('keeps a run’s job and address while it is open, gives them once when asked to forget, and drops them after a day', async () => {
    const h = harness();
    await h.reports.runOpened('agent:run-1', 101, URL);
    await h.reports.runOpened('queue:row-2', 102, `${URL}-2`);
    expect(await h.reports.runOf('agent:run-1')).toEqual({ jobId: 101, url: URL });
    expect(await h.reports.runOf('agent:run-1', true)).toEqual({ jobId: 101, url: URL });
    expect(await h.reports.runOf('agent:run-1')).toBeNull();
    h.clock.now += CLOSED_DROP_MS;
    expect(await h.reports.runOf('queue:row-2')).toBeNull();
    await h.reports.runOpened('agent:run-3', 103, URL);
    expect(Object.keys(h.session.data.get(CLOSED_RUNS_KEY) as object)).toEqual(['agent:run-3']);
  });

  it('a token change takes the queue, the hold, the runs’ addresses and what was reported', async () => {
    const h = harness();
    h.answers.push({ ok: false, failure: 'unreachable' });
    await h.reports.automatic(1042, report());
    await h.reports.flush();
    await h.session.set({ [CLOSED_HOLD_KEY]: START + 1000 });
    await h.reports.runOpened('agent:run-1', 101, URL);
    await h.reports.dropTokenData();
    expect([...h.session.data.keys()]).toEqual([]);
    expect(h.reports.reportedOf(1042)).toBeNull();
    expect(h.alarms.at(-1)).toBe(`stop ${CLOSED_ALARM}`);
    await h.advance(CLOSED_RETRY_MS[0]);
    expect(h.sent).toHaveLength(1);
  });

  it('sends what a stopped worker left in storage.session once it starts again', async () => {
    const first = harness();
    first.answers.push({ ok: false, failure: 'unreachable' });
    await first.reports.automatic(1042, report());
    await first.reports.flush();
    first.clock.now += CLOSED_RETRY_MS[0];
    const second = harness({ session: first.session, clock: first.clock });
    await second.reports.ready;
    expect(second.sent).toEqual([{ jobId: 1042, body: report() }]);
    expect(first.session.data.has(CLOSED_QUEUE_KEY)).toBe(false);
  });
});
