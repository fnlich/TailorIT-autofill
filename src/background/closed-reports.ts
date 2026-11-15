/*
 * v3.0 X1-EXT (autofill API 9; TailorIT docs/design/part2/14-extension-reports.md §3): closed-link reports to TailorIT,
 * POST /api/autofill/jobs/:jobId/closed (scope jobs:add, AutofillClosedReportRequest).
 *
 * - What a report holds: the job's TailorIT id, the posting's address as the lookup was asked with it (no session or
 *   tracking parameter; the server client names it to TailorIT as every address, tailoritAddressOf), a signal of the
 *   contract's closed list and its marker, how it was seen (`via`: page, agent, queue, person) and when. No page text,
 *   no screenshot, no other address, nothing about the person beyond the connection's account.
 * - Automatic reports (a closed sign in a posting the person opened, or an auto-apply job whose posting is gone) go
 *   only with Options › "Report closed jobs to TailorIT automatically" on (report-closed-setting.ts), a connection that
 *   holds jobs:add, the disclosure acknowledged as it reads now, and never from a private window (the callers keep those
 *   out). They wait in a small queue in storage.session (CLOSED_QUEUE_KEY, at most CLOSED_QUEUE_MAX) and go out one at
 *   a time, oldest first: a network failure, a timeout or TailorIT's own failure (5xx, a version it does not speak yet)
 *   is tried again after CLOSED_RETRY_MS (30 s, then 2, 10, 30 and 60 minutes), and a report older than the contract's
 *   AUTOFILL_CLOSED_SEEN_WITHIN_HOURS (24) is dropped unsent. A refusal for good (400, 403, 404, 401, any other 4xx) is
 *   dropped, and the card no longer says it was reported. The queue's alarm (CLOSED_ALARM) wakes the worker while a
 *   report waits; timers take the waits in between while it is awake.
 * - TailorIT's daily cap (429 rate_limited, its error's resetAt the next daily reset, 12:00 AM Pacific Time) holds every
 *   automatic report until that reset (CLOSED_HOLD_KEY): they stay queued, and go then if still within their day.
 * - The card's Report as closed (person) is the person's own report: sent at once, never queued, whatever the setting
 *   and the day's cap say (the cap's refusal is answered with TailorIT's own words, shown as they are), still never
 *   from a private window, before the disclosure or while disconnected.
 * - The auto-apply runs (agent.ts, queue-runner.ts) hold no address of their own: the posting address TailorIT named
 *   for a run's job is kept here, in storage.session (CLOSED_RUNS_KEY), while that run is open, for the report its
 *   posting_closed end may send; it goes with the run's end, and with CLOSED_DROP_MS at most.
 * - Which jobs were reported (by itself, or by the person) is memory only, for the job card, and goes with the token;
 *   so does the queue, and every run's address: a report is the connection's that saw it. Nothing here logs: the server
 *   client logs each request's status alone.
 */
import { z } from 'zod';
import {
  AUTOFILL_CLOSED_SEEN_WITHIN_HOURS, AUTOFILL_LOOKUP_URL_MAX, AutofillClosedReportRequestSchema,
  type AutofillClosedReportRequest,
} from '../contract/tailorit';
import type { ReportClosedOutcome } from '../messaging/page-schemas';
import type { AgentAlarms, StorageArea } from '../platform/types';
import { createKeyedQueue } from './locks';
import type { ServerClient } from './server-client';
import type { Timers } from './timers';

/** storage.session: the automatic reports waiting to go. */
export const CLOSED_QUEUE_KEY = 'closed:queue';
/** storage.session: TailorIT's daily cap holds automatic reports until this time (ms). */
export const CLOSED_HOLD_KEY = 'closed:hold';
/** storage.session: the auto-apply runs' jobs and posting addresses, while each run is open. */
export const CLOSED_RUNS_KEY = 'closed:runs';
/** The alarm that wakes the worker while a report waits, and how often (Chrome's floor is 0.5). */
export const CLOSED_ALARM = 'closed-reports';
export const CLOSED_ALARM_MINUTES = 1;
/** The waits before a report that could not go is tried again, by its tries so far (the last one from then on). */
export const CLOSED_RETRY_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000, 60 * 60_000] as const;
/** A report, or a run's address, is kept this long at most: the contract's day. */
export const CLOSED_DROP_MS = AUTOFILL_CLOSED_SEEN_WITHIN_HOURS * 60 * 60_000;
/** The most reports the queue holds (the oldest go first): TailorIT takes 50 a day per account. */
export const CLOSED_QUEUE_MAX = 50;
/** The most runs whose address is kept at once (a bound on what storage holds, not a cap that bites). */
export const CLOSED_RUNS_MAX = 200;
/** Without a resetAt in TailorIT's 429 (an older TailorIT), automatic reports wait this long. */
export const CLOSED_HOLD_FALLBACK_MS = 60 * 60_000;

const JobId = z.number().int().positive();
const Instant = z.number().int().nonnegative();
const QueuedSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  jobId: JobId,
  report: AutofillClosedReportRequestSchema,
  addedAt: Instant,
  nextAt: Instant,
  tries: z.number().int().nonnegative(),
});
type Queued = z.infer<typeof QueuedSchema>;
const QueueSchema = z.array(QueuedSchema).max(CLOSED_QUEUE_MAX);
const RunSchema = z.strictObject({ jobId: JobId, url: z.string().min(1).max(AUTOFILL_LOOKUP_URL_MAX), at: Instant });
const RunsSchema = z.record(z.string().regex(/^(?:agent|queue):[A-Za-z0-9_-]{1,64}$/), RunSchema);

/** What the card says of a job: reported by itself, or by the person. */
export type ClosedReported = 'auto' | 'person';

/** What the queue needs. */
export interface ClosedReportsDeps {
  server: Pick<ServerClient, 'closedReport'>;
  session: StorageArea;
  /** storage.local: the setting (report-closed-setting.ts). */
  automatic(): Promise<boolean>;
  timers: Timers;
  alarms?: Pick<AgentAlarms, 'start' | 'stop'>;
  now(): number;
  /** A fresh random id (8 to 64 of [A-Za-z0-9_-]). */
  nonce(): string;
  connected(): Promise<boolean>;
  /** The disclosure acknowledged as it reads now. */
  disclosed(): Promise<boolean>;
  /** The token's scopes, or null when not connected. */
  scopes(): Promise<readonly string[] | null>;
  /** What the cards say changed (a report queued, refused, the person's own). */
  changed(): void;
}

/** The person's Report as closed: what came of it, with TailorIT's words for its daily cap. */
export interface PersonReportAnswer {
  outcome: ReportClosedOutcome;
  message?: string;
}

/** The reports. */
export interface ClosedReports {
  /** Settles once the queue was looked at after a start (what a stopped worker left goes out). */
  readonly ready: Promise<void>;
  /** An automatic report (via page, agent or queue): queued when it may go (the setting on, connected with jobs:add,
   *  the disclosure acknowledged); answers whether it was. The caller keeps private tabs out. */
  automatic(jobId: number, report: AutofillClosedReportRequest): Promise<boolean>;
  /** The card's Report as closed: sent at once (signal and via `person`). */
  person(jobId: number, url: string): Promise<PersonReportAnswer>;
  /** Whether the job was reported in this connection: by itself, or by the person (null: neither). */
  reportedOf(jobId: number): ClosedReported | null;
  /** Sends the reports that are due (a timer, the alarm, start-up). */
  flush(): Promise<void>;
  /** An auto-apply run (`agent:<id>`, `queue:<id>`) opened its job's posting: its address kept for its report. */
  runOpened(key: string, jobId: number, url: string): Promise<void>;
  /** The run's job and address, or null; `forget` takes it out too. */
  runOf(key: string, forget?: boolean): Promise<{ jobId: number; url: string } | null>;
  /** The token changed: the queue, the hold, the runs' addresses and what was reported go. */
  dropTokenData(): Promise<void>;
}

/** An instant in the contract's form (UTC, with its offset). */
export const isoOf = (ms: number) => new Date(ms).toISOString();

/** The reports over storage.session and the server client. */
export function createClosedReports(deps: ClosedReportsDeps): ClosedReports {
  const reported = new Map<number, ClosedReported>();
  const writes = createKeyedQueue();
  let soon: (() => void) | null = null;

  async function queueOf(): Promise<Queued[]> {
    const parsed = QueueSchema.safeParse(await deps.session.get(CLOSED_QUEUE_KEY).catch(() => undefined));
    return parsed.success ? parsed.data : [];
  }
  async function saveQueue(queue: readonly Queued[]): Promise<void> {
    if (queue.length === 0) await deps.session.remove([CLOSED_QUEUE_KEY]);
    else await deps.session.set({ [CLOSED_QUEUE_KEY]: queue.slice(-CLOSED_QUEUE_MAX) });
  }
  async function holdUntil(): Promise<number> {
    const parsed = Instant.safeParse(await deps.session.get(CLOSED_HOLD_KEY).catch(() => undefined));
    return parsed.success ? parsed.data : 0;
  }
  async function runsOf(): Promise<Record<string, z.infer<typeof RunSchema>>> {
    const parsed = RunsSchema.safeParse(await deps.session.get(CLOSED_RUNS_KEY).catch(() => undefined));
    return parsed.success ? parsed.data : {};
  }
  async function saveRuns(runs: Record<string, z.infer<typeof RunSchema>>): Promise<void> {
    const now = deps.now();
    const kept = Object.entries(runs).filter(([, run]) => now - run.at < CLOSED_DROP_MS)
      .sort((a, b) => a[1].at - b[1].at).slice(-CLOSED_RUNS_MAX);
    if (kept.length === 0) await deps.session.remove([CLOSED_RUNS_KEY]);
    else await deps.session.set({ [CLOSED_RUNS_KEY]: Object.fromEntries(kept) });
  }

  /** The hold TailorIT's 429 names: its resetAt, else a Retry-After of some seconds (the server client reads a missing
   *  header as 0, which is none), else an hour: never a hold that is already over, which would ask again at once. */
  function holdOf(failure: { resetAt?: string; retryAfterSeconds?: number }): number {
    const reset = failure.resetAt === undefined ? Number.NaN : Date.parse(failure.resetAt);
    if (Number.isFinite(reset) && reset > deps.now()) return reset;
    if (failure.retryAfterSeconds !== undefined && failure.retryAfterSeconds > 0) {
      return deps.now() + failure.retryAfterSeconds * 1000;
    }
    return deps.now() + CLOSED_HOLD_FALLBACK_MS;
  }

  /** Keeps the wake-ups while a report waits: a timer for the next due one, and the alarm. */
  async function schedule(queue: readonly Queued[], hold: number): Promise<void> {
    soon?.();
    soon = null;
    if (queue.length === 0) {
      await deps.alarms?.stop(CLOSED_ALARM).catch(() => undefined);
      return;
    }
    const next = Math.max(hold, Math.min(...queue.map((item) => item.nextAt)));
    soon = deps.timers.after(Math.max(0, next - deps.now()), () => void flush().catch(() => undefined));
    await deps.alarms?.start(CLOSED_ALARM, CLOSED_ALARM_MINUTES).catch(() => undefined);
  }

  /** Whether a report may go out by itself now (the setting, the connection, its scope, the disclosure). */
  async function mayGo(): Promise<boolean> {
    if (!(await deps.automatic()) || !(await deps.connected()) || !(await deps.disclosed())) return false;
    return (await deps.scopes())?.includes('jobs:add') === true;
  }

  function flush(): Promise<void> {
    return writes.run('closed', async () => {
      let queue = await queueOf();
      const now = deps.now();
      // A report is about its day: older ones go unsent.
      const fresh = queue.filter((item) => now - item.addedAt < CLOSED_DROP_MS);
      if (fresh.length !== queue.length) {
        queue = fresh;
        await saveQueue(queue);
      }
      const hold = await holdUntil();
      if (queue.length === 0 || hold > now || !(await mayGo())) {
        await schedule(queue, hold > now ? hold : 0);
        return;
      }
      let held = 0;
      for (;;) {
        const item = queue.filter((each) => each.nextAt <= deps.now()).sort((a, b) => a.addedAt - b.addedAt)[0];
        if (item === undefined) break;
        const answer = await deps.server.closedReport(item.jobId, item.report);
        if (answer.ok) {
          queue = queue.filter((each) => each.id !== item.id);
          await saveQueue(queue);
          continue;
        }
        if (answer.failure === 'rate-limited') {
          held = holdOf(answer);
          await deps.session.set({ [CLOSED_HOLD_KEY]: held });
          break;
        }
        const later = ['unreachable', 'timeout', 'server-error', 'bad-answer', 'version-mismatch'].includes(answer.failure);
        if (later) {
          const tries = item.tries + 1;
          const wait = CLOSED_RETRY_MS[Math.min(tries, CLOSED_RETRY_MS.length) - 1]!;
          queue = queue.map((each) => (each.id === item.id ? { ...each, tries, nextAt: deps.now() + wait } : each));
          await saveQueue(queue);
          break;
        }
        // Refused for good (or the connection went): dropped, and the card no longer says it was reported.
        queue = queue.filter((each) => each.id !== item.id);
        await saveQueue(queue);
        if (reported.get(item.jobId) === 'auto' && !queue.some((each) => each.jobId === item.jobId)) {
          reported.delete(item.jobId);
          deps.changed();
        }
      }
      await schedule(queue, held);
    });
  }

  const ready = Promise.resolve().then(() => flush()).catch(() => undefined);

  return {
    ready,
    async automatic(jobId, report) {
      if (!JobId.safeParse(jobId).success || !AutofillClosedReportRequestSchema.safeParse(report).success) return false;
      if (reported.has(jobId) || !(await mayGo())) return false;
      const queued = await writes.run('closed', async () => {
        const queue = await queueOf();
        // One report per job waits at a time.
        if (queue.some((item) => item.jobId === jobId)) return false;
        const now = deps.now();
        await saveQueue([...queue, { id: deps.nonce(), jobId, report, addedAt: now, nextAt: now, tries: 0 }]);
        return true;
      });
      if (!queued) return false;
      reported.set(jobId, 'auto');
      deps.changed();
      void flush().catch(() => undefined);
      return true;
    },
    async person(jobId, url) {
      if (!JobId.safeParse(jobId).success || url.length === 0 || url.length > AUTOFILL_LOOKUP_URL_MAX) {
        return { outcome: 'unavailable' };
      }
      if (!(await deps.connected())) return { outcome: 'not-connected' };
      if (!(await deps.disclosed())) return { outcome: 'unavailable' };
      if ((await deps.scopes())?.includes('jobs:add') !== true) return { outcome: 'not-allowed' };
      const answer = await deps.server.closedReport(jobId,
        { url, signal: 'person', via: 'person', seenAt: isoOf(deps.now()) });
      if (answer.ok) {
        reported.set(jobId, 'person');
        deps.changed();
        const outcome = answer.value.outcome;
        return { outcome: outcome === 'queued' ? 'reported' : outcome === 'closed' ? 'closed' : 'already-closed' };
      }
      if (answer.failure === 'rate-limited') {
        await deps.session.set({ [CLOSED_HOLD_KEY]: holdOf(answer) });
        return { outcome: 'limited', ...(answer.message === undefined ? {} : { message: answer.message.slice(0, 400) }) };
      }
      if (answer.failure === 'forbidden') return { outcome: 'not-allowed' };
      if (answer.failure === 'not-connected' || answer.failure === 'unauthorized') return { outcome: 'not-connected' };
      return { outcome: 'unavailable' };
    },
    reportedOf: (jobId) => reported.get(jobId) ?? null,
    flush,
    async runOpened(key, jobId, url) {
      if (!JobId.safeParse(jobId).success || url.length === 0 || url.length > AUTOFILL_LOOKUP_URL_MAX) return;
      await writes.run('runs', async () => {
        const runs = await runsOf();
        runs[key] = { jobId, url, at: deps.now() };
        await saveRuns(runs);
      }).catch(() => undefined);
    },
    async runOf(key, forget = false) {
      return writes.run('runs', async () => {
        const runs = await runsOf();
        const run = runs[key];
        if (forget && run !== undefined) {
          delete runs[key];
          await saveRuns(runs);
        }
        return run === undefined || deps.now() - run.at >= CLOSED_DROP_MS ? null : { jobId: run.jobId, url: run.url };
      }).catch(() => null);
    },
    async dropTokenData() {
      reported.clear();
      soon?.();
      soon = null;
      await writes.run('closed', async () => {
        await deps.session.remove([CLOSED_QUEUE_KEY, CLOSED_HOLD_KEY]);
        await deps.alarms?.stop(CLOSED_ALARM).catch(() => undefined);
      }).catch(() => undefined);
      await writes.run('runs', () => deps.session.remove([CLOSED_RUNS_KEY])).catch(() => undefined);
    },
  };
}

// ── The auto-apply runs' side (agent.ts, queue-runner.ts) ──

/** The signals a run the extension opened itself may report (the contract's run-only ones). */
export type ClosedRunSignal = 'no_posting' | 'redirected';

/** What the auto-apply runs tell of their jobs: a run opened its job's posting (TailorIT's address for it, kept for its
 *  report), and a run ended: posting_closed in its tab, with the signal its own rule saw (`redirected`: the tab ended
 *  on a page of the platform's host that names no posting; `no_posting`: the posting's page showed no posting, or no
 *  form in time), or any other way (null). Each report follows the person's setting (index.ts). */
export interface ClosedRunHooks {
  opened(key: string, jobId: number, url: string): Promise<void>;
  ended(key: string, closed: { tabId: number; signal: ClosedRunSignal; via: 'agent' | 'queue'; platform: string | null }
    | null): Promise<void>;
}

/** How long a run's end waits for its report to be taken (its look in the tab and its queueing) before the run goes on
 *  (the agent then closes the tab, as before). */
export const CLOSED_RUN_WAIT_MS = 3_000;
