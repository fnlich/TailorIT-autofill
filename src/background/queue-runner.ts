/*
 * v1.5 QX: the sequential auto-apply (PLAN decisions 7 and 8; the owner's words of 2026-11-10: "open new tab with job
 * link on auto-apply queue one by one. and then auto-apply will be applied by user setting ... new tab will be open in
 * `duration` time after previous tab is open. and accelation is also applied. e.g. 8s, 8.5s, 9s, 9.5s, ...").
 *
 * - Start (the panel's Queue tab, a trusted click on a control seen CONTROL_SEEN_MS) reads the person's queued jobs
 *   from TailorIT (queue-source.ts: GET …/agent/queue, every page, at most QUEUE_RUN_MAX) and opens the first one at
 *   once. The k-th wait after a tab opened is durationSec + k × accelerationSec (settings.queue; 8, 8.5, 9, ... by
 *   default: core/types/settings.ts queueWaitMs). Run auto-apply (the background agent, agent.ts) goes off first: the
 *   two never run together, and the agent turned on stops the queue (index.ts).
 * - At most settings.queue.maxOpenTabs queued tabs are open at once (5 by default): while as many are open and not done
 *   (opening, opened, filling, ready for you), the timer waits, the seconds it had left kept, and goes on when one is
 *   done or closed. Pause keeps the seconds left too; Resume goes on from them; Stop opens nothing more and leaves the
 *   open tabs to the person, whose results are still told.
 * - Opening: TailorIT takes the job for this run first (POST …/agent/:id/opened, TailorIT v1.5 Q2), so the background
 *   agent never takes the same job; its answer names the task (the form's address, the resume to attach), or none when
 *   TailorIT finished the job at the claim (applied already, closed, not one the agent opens: its state and reason
 *   shown, nothing told); a job taken by the agent or another browser, or gone, is skipped, never opened. Only the
 *   task's own address opens, read the agent's way (agent.ts agentAddressOf: the canonical application address, https
 *   on an applicant-tracking host the manifest's script runs on, with an application key), never one a page or a
 *   message names; a task with none fails (unsupported_site) and is never opened. The tab opens in the person's window,
 *   in the background, on an empty page, then the address. Nothing opens while the connection lacks agent:run or the
 *   disclosure is not acknowledged as it reads now (the run stops, saying why), nor while the browser is offline.
 * - Filling: with "Autofill when a queued tab opens" Automatically, the tab's first form of the job's application (its
 *   top frame, or the frame that claims a company wrapper's application) gets run/start, as the panel's Autofill sends
 *   it; a page with no form whose application frame shows the posting's own Apply, an entry choice or an account wall
 *   gets the panel's Autofill (panel.ts fill: its entry pressed, then the next form started). Once per job: the run's own
 *   "Autofill after page turn" takes the pages after. Manually: the tab waits for the person's Autofill. The tab's job
 *   and resume are the queued ones (JobCards.assign). Submit follows the person's Submit mode, and every guard of a
 *   run holds as it does for the person's own Autofill (CAPTCHA, sign-in, the skip rules, the never-press rules): the
 *   tab's settings are the person's (index.ts contentSettingsFor), never the agent's.
 * - Status, per job, from its tab: queued, opening (the tab made, no frame of ours heard yet), opened (a frame said
 *   hello), filling (a run at work), ready for you (the run at rest: review, a pause, a sign-in), submitted (the
 *   platform's sign for the job's own application, taken by submissions.ts: POST …/result {submitted}, which TailorIT
 *   takes as Applied; the tab closes a few seconds later unless the person is looking at it), skipped (the person
 *   closed the tab first: needs-you cancelled; or TailorIT no longer had it queued: nothing told), failed (no address:
 *   unsupported_site; no frame of ours within QUEUE_FORM_WAIT_MS: page_error, or posting_closed where the tab shows a
 *   page of the platform's host that names no posting; the tab stays the person's). A result TailorIT could not take
 *   for now is sent again at the next tick (a submitted one for every refusal but 404, 400 and a path refused).
 * - jr6 apply F4a (AF-5, as corrected; the owner's words of 2026-11-10: "extension should also click `apply` to find
 *   and run the form"): a job whose Autofill the queue gave at a page with no form (wall(): the posting's own Apply, an
 *   entry choice, an account wall) and whose tab no run has reported from since is Ready for you once
 *   QUEUE_ENTRY_WAIT_MS has passed from that start: an Apply the page refused, a choice or a wall the press led to that
 *   nothing took, a press that led nowhere. It keeps its place among the open tabs (Ready for you counts toward
 *   maxOpenTabs, as a run at rest does): the tab is the person's to finish or close. A run that reports in time leads
 *   its status as before, the timer gone (an email gate is a form: the grant starts its run, whose reports say filling,
 *   then ready). The queue never continues the press itself: its Autofill is the panel's, whose grant takes the walls
 *   and choices of the next documents (sign-up.ts takeStep); wall() still starts once per job.
 * - jr6 SHELL-B (INTEGRATION.md SHELL-B item 3; F4a's open gap, F4a.md §8): a job Filling whose tab no fill report shows
 *   any more (its run's page turned to a document where no run starts or reports: "Autofill after page turn: Manually",
 *   a wall the grant does not take, a form whose run/start never arrived) is Ready for you once that has lasted
 *   QUEUE_ENTRY_WAIT_MS, as F4a's entry wait (its words, its log, quietly: nothing told, nothing pressed, its open-tab
 *   place kept). The wait starts at the first look at the tab that finds no report (quietAt) and ends with the next
 *   report seen, so a working run's page turn, whose next step reports within moments, never flickers; the alarm stays
 *   on while a job fills, paused and stopped runs too, so a look still comes.
 * - It survives a worker restart: the run lives in storage.session (QUEUE_RUN_KEY; gone at a browser restart, with the
 *   tab ids it names), and the queue-tick alarm (chrome.alarms, every QUEUE_TICK_MINUTES) wakes the worker while it
 *   runs, a tab waits for its page or for its entry's run, or a result waits to be told; timers take the ticks in
 *   between while it is awake.
 *   It holds ids, titles, companies, statuses, the tabs' ids and the application's key (a hash), never an address: the
 *   address comes from TailorIT's answer as each job opens, and goes straight to its tab. Logs carry counts, phases and
 *   places in closed lists only.
 * - v2.0 P9 (autofill API 8):
 *   - TailorIT's claim of the next job (POST …/opened) may answer that the account's daily auto-apply limit is reached
 *     (its `dailyLimit`, no job): the run stops ('daily-limit'), keeping TailorIT's words and reset for the Queue tab;
 *     that job and every later one stay queued, and the tabs already open go on to their end. Start again before the
 *     reset asks again, and gets the same answer.
 *   - Every result says whether the job's Submit was pressed (`submitPressed`), by which TailorIT keeps or gives back its
 *     count.
 *   - A job TailorIT queued for the person to apply to by hand (run kind `manual`) is never read into a run, so never
 *     opened (queue-source.ts pageOf).
 *   - A submitted job's tab closes QUEUE_CLOSE_SUBMITTED_MS after the platform's sign, whether it is in front or not,
 *     while "Close the application tab when it's submitted" is on (close-tab.ts), and never while it is off; a tab the
 *     person was handed (a step that is theirs by design, a CAPTCHA, a bot check or a code at rest) is kept.
 */
import { z } from 'zod';
import {
  AUTOFILL_AGENT_FINISHED_STATES, AUTOFILL_AGENT_REASONS, AutofillAgentIdSchema, type AutofillAgentFinishedState,
  type AutofillAgentReason, type AutofillAgentState,
} from '../contract/tailorit';
import { queueWaitMs, type Settings } from '../core/types/settings';
import { ok, refuse, type Answer } from '../messaging/envelope';
import {
  QUEUE_HOLDS, QUEUE_ITEM_STATUSES, QUEUE_LIST_PAGE, QUEUE_STATUS_STOPS, type AutoApplyLimit, type QueueBlock,
  type QueueItemStatus, type QueueListAnswer, type QueueStatus, type QueueStatusStop, type QueueStop,
} from '../messaging/page-schemas';
import { AGENT_NOTES, type AgentNote } from '../messaging/schemas';
import type { AgentAlarms, AtsPage, QueueTabs, StorageArea } from '../platform/types';
import { log } from '../shared/log';
import type { FrameReport } from '../shared/report';
import { agentAddressOf, queueAddressOf } from './agent';
import { queueSubmitIsPersons } from './settings';
import type { FrameEntry } from './frames';
import { createKeyedQueue } from './locks';
import { pageOf, type QueueTask } from './queue-source';
import type { ServerClient, ServerFailure } from './server-client';
import type { Timers } from './timers';

/** The alarm that wakes the worker while the queue runs, and how often (Chrome's floor). */
export const QUEUE_ALARM = 'queue-tick';
export const QUEUE_TICK_MINUTES = 0.5;
/** storage.session: the run. */
export const QUEUE_RUN_KEY = 'queue:run';
/** The most jobs one run holds (the owner: "a lot of saved or applied jobs (about 3000)"). */
export const QUEUE_RUN_MAX = 3000;
/** A queued tab no frame of ours said hello in this long after it opened: failed (page_error, or posting_closed). */
export const QUEUE_FORM_WAIT_MS = 60_000;
/** A submitted job's tab closes this long after the platform's sign, unless it is its window's active tab. */
export const QUEUE_CLOSE_SUBMITTED_MS = 5_000;
/** TailorIT did not answer an opening (offline, a failure): tried again this long after. */
export const QUEUE_RETRY_MS = 30_000;
/** jr6 apply F4a (AF-5): a job the queue's Autofill started at a page with no form (wall()) whose tab no run reported
 *  from in this long after that start is Ready for you, never Filling for ever. Longer than the waits on the entry's
 *  way (the frame's wait for a late Apply or form; the grant's 30 s to arm and 60 s for the press's next document,
 *  sign-up.ts), so a run that comes is heard first. */
export const QUEUE_ENTRY_WAIT_MS = 90_000;
/** Runs started per job: the first form of its application, once. */
const WORKING: ReadonlySet<FrameReport['status']> = new Set<FrameReport['status']>(['detect', 'scan-step', 'fill-step',
  'validate', 'advance', 'wait-transition']);

const Count = z.number().int().nonnegative();
const ResultSchema = z.strictObject({ state: z.enum(AUTOFILL_AGENT_FINISHED_STATES),
  reason: z.enum(AUTOFILL_AGENT_REASONS).nullable(), aiGuesses: Count.max(1000) });

/** One job of the run: ids, its title and company as TailorIT named them, its application's key once it opened
 *  (agentAddressOf's: a hash, never the address), the resume TailorIT names for it, where it stands, its tab, and the
 *  result to tell. */
const ItemSchema = z.strictObject({
  id: AutofillAgentIdSchema,
  jobId: z.number().int().positive(),
  resumeId: z.string().max(64).nullable(),
  title: z.string().max(300),
  company: z.string().max(200),
  applicationKey: z.string().regex(/^[a-z]+:[0-9a-f]{16}$/).nullable(),
  status: z.enum(QUEUE_ITEM_STATUSES),
  reason: z.enum(AUTOFILL_AGENT_REASONS).nullable(),
  tabId: z.number().int().nonnegative().nullable(),
  openedAt: Count.nullable(),
  heardAt: Count.nullable(),
  /** When its fill was started (Automatically), once per job. */
  startedAt: Count.nullable(),
  /** jr6 apply F4a (AF-5): when wall() started its fill at a page with no form, until a run of its tab reports (or
   *  QUEUE_ENTRY_WAIT_MS passes: Ready for you); null otherwise. A run saved without it reads as null. */
  entryAt: Count.nullable().default(null),
  /** jr6 SHELL-B (F4a's gap): when a look first found the tab of this Filling job with no fill report (its run's page
   *  turned to a document where no run reports), until a report shows again (or QUEUE_ENTRY_WAIT_MS passes: Ready for
   *  you); null otherwise. A run saved without it reads as null. */
  quietAt: Count.nullable().default(null),
  /** The result TailorIT has not taken yet. */
  tell: ResultSchema.nullable(),
  // ── jr7 AUTO-7 ──
  /** AUTO7-01 (D-4): when a Submit of the job's application was armed in its tab: a job whose Submit is the person's
   *  is Ready for you from then on, and a tab closed after it is never told cancelled (it may have been sent:
   *  timed_out). A run saved without it reads as null. */
  pressedAt: Count.nullable().default(null),
  /** ICIMS7-04: why the job rests with the person, in the extension's words (a step that is theirs by design). */
  note: z.enum(AGENT_NOTES).nullable().default(null),
  // ── end jr7 AUTO-7 ──
});
type Item = z.infer<typeof ItemSchema>;

/** v2.0 P9: TailorIT's daily auto-apply limit, as the claim that stopped the run answered it (AutoApplyLimit). */
const LimitSchema = z.strictObject({ message: z.string().max(400).nullable(), resetsAt: Count });

const RunSchema = z.strictObject({
  phase: z.enum(['running', 'paused', 'finished', 'stopped']),
  startedAt: Count,
  /** Tabs opened in this run: the schedule's k is one less. */
  opened: Count,
  /** When the next tab opens (running, the timer going); null otherwise. */
  nextAt: Count.nullable(),
  /** The ms kept while paused or held. */
  leftMs: Count.nullable(),
  hold: z.enum(QUEUE_HOLDS).nullable(),
  stoppedBy: z.enum(QUEUE_STATUS_STOPS).nullable(), // v2.0 P9: 'daily-limit' too
  agentStopped: z.boolean(),
  items: z.array(ItemSchema).max(QUEUE_RUN_MAX),
  /** v2.0 P9: stopped by 'daily-limit', TailorIT's words and its reset; null otherwise (a run saved without it too). */
  limit: LimitSchema.nullable().default(null),
});
type Run = z.infer<typeof RunSchema>;

/** The statuses of a job whose tab is open and not done: they count toward maxOpenTabs. */
const OPEN: ReadonlySet<QueueItemStatus> = new Set<QueueItemStatus>(['opening', 'opened', 'filling', 'ready']);
/** A failure TailorIT may answer differently later: the result is kept and sent again. */
const PASSING: ReadonlySet<ServerFailure> = new Set(['unreachable', 'timeout', 'server-error', 'rate-limited',
  'not-connected', 'version-mismatch']);
/** The refusals that drop even a submitted result. */
const DROPS_SUBMITTED: ReadonlySet<ServerFailure> = new Set(['not-found', 'bad-request', 'refused-path']);
/** v2.0 P9 (A20): the pauses a run rests at for the person after a Submit: a check or a code. A tab showing one when the
 *  platform's sign comes is theirs, never closed. */
const PERSONS_PAUSES: ReadonlySet<FrameReport['pauseReason']> = new Set<FrameReport['pauseReason']>(['captcha',
  'bot-check', 'email-code']);
/** The refusals of an opening that mean TailorIT no longer has the job queued for this browser: it is skipped. */
const NOT_QUEUED: ReadonlySet<ServerFailure> = new Set(['not-found', 'conflict', 'bad-request', 'refused-path', 'forbidden']);

/** What the runner needs. */
export interface QueueRunnerDeps {
  server: Pick<ServerClient, 'queuePage' | 'queueOpened' | 'agentResult'>;
  session: StorageArea;
  tabs: QueueTabs;
  alarms: AgentAlarms;
  timers: Timers;
  now(): number;
  settings(): Promise<Settings>;
  /** The token's scopes, or null when not connected. */
  scopes(): Promise<readonly string[] | null>;
  /** The person acknowledged the disclosure as it reads now. */
  disclosed(): Promise<boolean>;
  /** Whether the browser says it is online. Absent: online. */
  online?(): boolean;
  /** Run auto-apply is on (agent.ts), and turning it off (its running job left for the person). */
  agentOn(): Promise<boolean>;
  stopAgent(): Promise<void>;
  /** The tab's reports, as the panels read them. */
  reports(tabId: number): Promise<readonly FrameReport[]>;
  /** What the tab shows by its address (WorkerPlatform tabs.atsPageOf). Absent: not known. */
  atsPageOf?(tabId: number): Promise<AtsPage | null>;
  /** One message to one frame of a tab. */
  send(tabId: number, message: unknown, target: { frameId: number; documentId?: string }): Promise<unknown>;
  /** The panel's Autofill for the tab (panel.ts fill): a page with no form whose application frame shows the posting's
   *  own Apply, an entry choice or an account wall. */
  fill(tabId: number): Promise<void>;
  /** The job and resume of the tab's application (JobCards.assign). */
  assign(tabId: number, applicationKey: string, task: { jobId: number; resumeId: string | null }): void;
  /** The status changed (the panels read it again). */
  changed(): void;
  /** How long the new tab rests on its empty page before the job's address opens in it (the e2e build's routing). */
  tabSettleMs?: number;
  // ── jr7 AUTO-7 (AUTO7-05 c) ──
  /** The host name of the tab's page, in lower case (WorkerPlatform tabs.hostOf), or null. Absent: not known. */
  hostOf?(tabId: number): Promise<string | null>;
  /** Whether `host` is one the platform's own sign-in leaves to (its adapter's identityHosts). Absent: none is. */
  identityHost?(platform: string, host: string): boolean;
  // ── end jr7 AUTO-7 ──
  /** v2.0 P9: "Close the application tab when it's submitted" (close-tab.ts closeTabOnSubmit). Absent: on. */
  closeTab?(): Promise<boolean>;
}

/** A frame of a queued tab, as its hello registered it. */
export type QueueFrame = Pick<FrameEntry, 'frameId' | 'documentId' | 'hasForm'> & { applicationKey?: string | undefined };

/** The wait the schedule takes after `opened` tabs, for the settings now. */
const waitAfter = (settings: Settings, opened: number) => queueWaitMs(settings.queue, opened);

/** Whether a job's tab is open and not done. */
const isOpen = (item: Item) => item.tabId !== null && OPEN.has(item.status);

/** The job's status from its tab's reports: filling while a run works, ready for you once it rests; null when no run
 *  reported (the page loaded, nothing started). */
export function statusOfReports(reports: readonly FrameReport[]): 'filling' | 'ready' | null {
  const fills = reports.filter((report) => report.mode === 'fill');
  if (fills.length === 0) return null;
  return fills.some((report) => WORKING.has(report.status) && report.resting !== true) ? 'filling' : 'ready';
}

/** What the panels show of a run, and what the run holds of each job, in short: a change of it is saved and told to
 *  them (panel/changed 'queue'). */
function signatureOf(run: Run): string {
  // jr6 apply F4a: whether an entry still waits for its run (so its start and its end are saved).
  const items = run.items.map((item) => `${item.status}:${item.reason ?? ''}:${item.tabId ?? ''}:${item.tell === null ? 0 : 1}`
    + `:${item.entryAt === null ? 0 : 1}`
    + `:${item.quietAt === null ? 0 : 1}` // jr6 SHELL-B: a quiet tab's wait, its start and end saved
    + `:${item.pressedAt === null ? 0 : 1}:${item.note ?? ''}`); // jr7 AUTO-7
  return [run.phase, run.hold, run.nextAt, run.leftMs, run.opened, run.stoppedBy, ...items].join('|');
}

/** The AI guesses a tab's reports show, a count only. */
const guessesOf = (reports: readonly FrameReport[]) => Math.min(1000, reports.reduce((sum, report) =>
  sum + report.fields.filter((row) => row.wrote && row.reason === 'ai-guess').length, 0));

/** The sequential auto-apply of this worker. */
export function createQueueRunner(deps: QueueRunnerDeps) {
  const queue = createKeyedQueue();
  const serial = <T>(task: () => Promise<T>) => queue.run('queue', task);
  /** The run as last read or written (memory: storage.session holds it across worker restarts). */
  let cached: Run | null | undefined;
  /** The next tick a timer takes (memory only: the alarm covers a stopped worker). */
  let soon: { at: number; cancel(): void } | null = null;
  /** TailorIT's queued jobs before a run (memory only), for the Queue tab's list. */
  let preview: { items: QueueTask[]; next: string | null; total: number } | null = null;

  async function load(): Promise<Run | null> {
    if (cached !== undefined) return cached;
    const parsed = RunSchema.nullable().safeParse((await deps.session.get(QUEUE_RUN_KEY)) ?? null);
    cached = parsed.success ? parsed.data : null;
    return cached;
  }
  async function save(run: Run | null): Promise<void> {
    cached = run;
    if (run === null) await deps.session.remove([QUEUE_RUN_KEY]);
    else await deps.session.set({ [QUEUE_RUN_KEY]: run });
  }

  /** Why the queue may not run now, or null. */
  async function blockOf(): Promise<QueueBlock | null> {
    const scopes = await deps.scopes();
    if (scopes === null) return 'not-connected';
    if (!scopes.includes('agent:run')) return 'no-scope';
    if (!(await deps.disclosed())) return 'disclosure';
    return null;
  }

  const pending = (run: Run | null) => run?.items.some((item) => item.tell !== null) === true;
  const waitingForPage = (run: Run | null) => run?.items.some((item) => item.status === 'opening' && item.tabId !== null)
    === true;
  /** jr6 apply F4a: an open job whose entry waits for its run (paused or stopped too: it still ends Ready for you). */
  const waitingForEntry = (run: Run | null) => run?.items.some((item) => item.entryAt !== null && isOpen(item)) === true;
  /** jr6 SHELL-B (F4a's gap): an open job Filling (paused or stopped too): a look must still come to find its reports
   *  gone, and its quiet wait (quietAt) ends Ready for you. */
  const waitingForRun = (run: Run | null) => run?.items.some((item) => item.status === 'filling' && isOpen(item)) === true;

  /** Keeps the alarm while there is a reason to wake: the run going, a tab waiting for its page or for its entry's run,
   *  a result to tell; jr6 SHELL-B, a job filling. */
  async function keepAlarm(run: Run | null): Promise<void> {
    if (run !== null && (run.phase === 'running' || pending(run) || waitingForPage(run) || waitingForEntry(run)
      || waitingForRun(run))) { // jr6 SHELL-B
      await deps.alarms.start(QUEUE_ALARM, QUEUE_TICK_MINUTES).catch(() => undefined);
    } else {
      await deps.alarms.stop(QUEUE_ALARM).catch(() => undefined);
    }
  }

  /** The next tick by a timer, at `at` (the earliest asked wins while the worker is awake). */
  function tickAt(at: number): void {
    if (soon !== null && soon.at <= at) return;
    soon?.cancel();
    const ms = Math.max(0, at - deps.now());
    const cancel = deps.timers.after(ms, () => {
      soon = null;
      void tick().catch(() => undefined);
    });
    soon = { at, cancel };
  }

  /** Timers for what the run waits on: the next tab, a page not heard from, an entry no run took. */
  function schedule(run: Run): void {
    const times: number[] = [];
    if (run.phase === 'running' && run.nextAt !== null) times.push(run.nextAt);
    for (const item of run.items) {
      if (item.status === 'opening' && item.openedAt !== null) times.push(item.openedAt + QUEUE_FORM_WAIT_MS + 100);
      if (item.entryAt !== null && isOpen(item)) times.push(item.entryAt + QUEUE_ENTRY_WAIT_MS + 100); // jr6 apply F4a
      if (item.quietAt !== null && isOpen(item)) times.push(item.quietAt + QUEUE_ENTRY_WAIT_MS + 100); // jr6 SHELL-B
    }
    if (times.length > 0) tickAt(Math.min(...times));
  }

  /** Tells TailorIT one job's result; answers whether it was taken. Taken, or refused for good: dropped. */
  async function tellOne(item: Item): Promise<boolean> {
    const result = item.tell;
    if (result === null) return true;
    if ((await deps.scopes())?.includes('agent:run') !== true) return false;
    // v2.0 P9 (API 8): whether the job's Submit was pressed, by which TailorIT keeps or gives back its daily count.
    const answer = await deps.server.agentResult(item.id, { state: result.state, reason: result.reason,
      aiGuesses: result.aiGuesses, submitPressed: item.pressedAt !== null });
    const kept = !answer.ok && (result.state === 'submitted' ? !DROPS_SUBMITTED.has(answer.failure)
      : PASSING.has(answer.failure));
    if (kept) {
      log('queue.report-failed', { status: answer.ok ? 0 : answer.status ?? 0 });
      return false;
    }
    if (!answer.ok) log('queue.report-failed', { status: answer.status ?? 0, dropped: true });
    item.tell = null;
    return answer.ok;
  }

  /** Every result not told yet, told now. */
  async function tellPending(run: Run): Promise<boolean> {
    let changed = false;
    for (const item of run.items) {
      if (item.tell === null) continue;
      await tellOne(item);
      if (item.tell === null) changed = true;
    }
    return changed;
  }

  /** A job ends: its status and reason, and what TailorIT is told (nothing for a job it no longer had queued).
   *  jr7 FIX-background (the review's B-3): why it rested with the person (its hand-over's note) goes with it, so a job
   *  recorded submitted after its documents dialog or its assessment no longer shows those words. */
  function finish(item: Item, status: 'submitted' | 'skipped' | 'failed', result: { state: AutofillAgentFinishedState;
    reason: AutofillAgentReason | null } | null, aiGuesses = 0): void {
    item.status = status;
    item.reason = result?.reason ?? null;
    item.note = null; // jr7 FIX-background (B-3)
    item.tell = result === null ? null : { ...result, aiGuesses };
    log('queue.finished', { status: QUEUE_ITEM_STATUSES.indexOf(status),
      reason: result?.reason == null ? -1 : AUTOFILL_AGENT_REASONS.indexOf(result.reason) });
  }

  /** A job TailorIT finished at the claim, shown as it said (nothing to tell). */
  function finishAs(item: Item, state: AutofillAgentState, reason: AutofillAgentReason | null): void {
    const status = state === 'submitted' ? 'submitted' : state === 'failed' ? 'failed' : 'skipped';
    finish(item, status, null);
    item.reason = reason;
  }

  /** The unfinished job whose tab `tabId` is, or null. */
  const openItemOf = (run: Run | null, tabId: number) =>
    run?.items.find((item) => item.tabId === tabId && OPEN.has(item.status)) ?? null;

  // ── jr7 AUTO-7 ──
  /** AUTO7-05 (c): whether the job's tab shows its platform's own sign-in (identityHosts). */
  async function onIdentityHost(item: Item, tabId: number): Promise<boolean> {
    if (item.applicationKey === null || deps.hostOf === undefined || deps.identityHost === undefined) return false;
    const host = await deps.hostOf(tabId).catch(() => null);
    return host !== null && deps.identityHost(item.applicationKey.split(':')[0] ?? '', host);
  }
  // ── end jr7 AUTO-7 ──

  /** The phase once nothing is queued: finished while no tab is open and not done. */
  function settle(run: Run): void {
    if (run.phase !== 'running') return;
    if (run.items.some((item) => item.status === 'queued')) return;
    run.nextAt = null;
    run.hold = null;
    run.leftMs = null;
    if (!run.items.some(isOpen)) {
      run.phase = 'finished';
      log('queue.done', { jobs: run.items.length });
    }
  }

  /** Opens the next queued job that can be: TailorIT takes it for this run first, then a background tab, then the
   *  task's own address. Answers 'opened', 'none' (nothing left), 'retry' (TailorIT did not answer), 'stopped'
   *  (Chrome opened no tab) or, v2.0 P9, 'limit' (TailorIT's daily auto-apply limit is reached: the job stays queued,
   *  the limit kept on the run). */
  async function openNext(run: Run): Promise<'opened' | 'none' | 'retry' | 'stopped' | 'limit'> {
    for (const item of run.items) {
      if (item.status !== 'queued') continue;
      const answer = await deps.server.queueOpened(item.id);
      if (!answer.ok) {
        if (NOT_QUEUED.has(answer.failure)) {
          // Removed in TailorIT, taken by the agent or another browser, or finished meanwhile: never opened, nothing to
          // tell.
          finish(item, 'skipped', null);
          continue;
        }
        log('queue.open-failed', { status: answer.status ?? 0 });
        return 'retry';
      }
      const task = answer.value.item;
      // v2.0 P9 (API 8): the account's daily auto-apply limit is reached: TailorIT kept the job queued, and so does the
      // run, with every later one; the run stops with TailorIT's words.
      const limit = answer.value.dailyLimit;
      if (task === null && limit?.reached === true) {
        const resetsAt = Date.parse(limit.resetsAt);
        run.limit = { message: limit.message ?? null,
          resetsAt: Number.isFinite(resetsAt) && resetsAt > 0 ? resetsAt : deps.now() } satisfies AutoApplyLimit;
        return 'limit';
      }
      if (task === null) {
        // TailorIT finished it at the claim (applied already, closed, not one the agent opens): shown as it said.
        finishAs(item, answer.value.state, answer.value.reason);
        continue;
      }
      // jr7 AUTO-7 (AUTO7-01, F4b): the agent's address, else the Queue tab's (the posting or the form of every
      // platform the extension fills, read so it says hello before any redirect; the contract's queueApplicationUrl).
      const target = agentAddressOf(task.url) ?? queueAddressOf(task.url);
      if (target === null) {
        // No address the extension fills: never opened.
        finish(item, 'failed', { state: 'failed', reason: 'unsupported_site' });
        await tellOne(item);
        continue;
      }
      const tabId = await deps.tabs.open();
      if (tabId === null) {
        log('queue.open-failed', { tab: false });
        finish(item, 'skipped', { state: 'needs-you', reason: 'cancelled' });
        await tellOne(item);
        return 'stopped';
      }
      Object.assign(item, { status: 'opening', tabId, openedAt: deps.now(), heardAt: null, startedAt: null, entryAt: null,
        quietAt: null, // jr6 SHELL-B
        pressedAt: null, note: null, // jr7 AUTO-7
        reason: null, applicationKey: target.applicationKey,
        resumeId: task.resumeId === null ? null : task.resumeId.slice(0, 64) });
      await save(run);
      const settleMs = deps.tabSettleMs ?? 0;
      if (settleMs > 0) await new Promise<void>((done) => void deps.timers.after(settleMs, done));
      if (!(await deps.tabs.navigate(tabId, target.address))) {
        // The tab went before its address opened (the person closed it).
        finish(item, 'skipped', { state: 'needs-you', reason: 'cancelled' });
        item.tabId = null;
        await tellOne(item);
        return 'opened';
      }
      log('queue.opened', { k: run.opened });
      return 'opened';
    }
    return 'none';
  }

  /** The open jobs' tabs looked at: gone (the person closed it: skipped), no page heard in time (failed), their reports
   *  read again (a worker that slept missed them), and an entry no run took in time (Ready for you). */
  async function sweep(run: Run): Promise<void> {
    const now = deps.now();
    for (const item of run.items) {
      if (item.tabId === null || !OPEN.has(item.status)) continue;
      const tabId = item.tabId;
      if ((await deps.tabs.state(tabId)) === 'gone') {
        // jr7 FIX-background (the review's B-2): as tabRemoved (AUTO7-01, D-4): a Submit armed in it may have sent it.
        finish(item, 'skipped', { state: 'needs-you', reason: item.pressedAt !== null ? 'timed_out' : 'cancelled' });
        item.tabId = null;
        continue;
      }
      if (item.status === 'opening' && item.openedAt !== null && now - item.openedAt >= QUEUE_FORM_WAIT_MS) {
        // jr7 AUTO-7 (AUTO7-05 c; the UltiPro verifier's addition): a tab at the job's platform's own sign-in (its
        // adapter's identityHosts) is never failed page_error: Ready for you, its place kept, and its hellos taken at
        // the job's key once the person signed in.
        if (await onIdentityHost(item, tabId)) {
          item.status = 'ready';
          log('queue.held', { identity: true });
          continue;
        }
        const shown = deps.atsPageOf === undefined ? null : await deps.atsPageOf(tabId).catch(() => null);
        finish(item, 'failed', { state: 'failed', reason: shown?.page === 'other' ? 'posting_closed' : 'page_error' });
        continue;
      }
      const status = statusOfReports(await deps.reports(tabId).catch(() => []));
      if (status !== null) {
        // jr6 apply F4a: a run reported: its reports lead from now on, the entry's wait over.
        item.entryAt = null;
        item.quietAt = null; // jr6 SHELL-B: a report shows: the tab is not quiet
        if (item.status !== 'opening') item.status = status;
      } else if (item.entryAt === null && item.status === 'opened' && item.quietAt !== null && item.startedAt === null) {
        // jr7 AUTO-7 (AUTO7-04, O-10: on SHELL-B's quiet rule): with Automatically, an application frame that said hello
        // with no form and showed no wall, choice or entry (its quietAt, hello) is Ready for you QUEUE_ENTRY_WAIT_MS
        // later, its open-tab place kept: the person is told to act, never "Opened" for ever.
        if (now - item.quietAt >= QUEUE_ENTRY_WAIT_MS) {
          item.quietAt = null;
          log('queue.entry-timeout', { from: QUEUE_ITEM_STATUSES.indexOf(item.status), opened: true });
          item.status = 'ready';
        }
      } else if (item.entryAt === null && item.status === 'filling') {
        // jr6 SHELL-B (F4a's gap): Filling, and no fill report shows on the tab (its run's page turned to a document
        // where no run reports): from the first look that finds it so, QUEUE_ENTRY_WAIT_MS, then Ready for you, as F4a's
        // entry wait ends (its open-tab place kept; nothing told, nothing pressed). A report seen before then ends the
        // wait.
        if (item.quietAt === null) item.quietAt = now;
        else if (now - item.quietAt >= QUEUE_ENTRY_WAIT_MS) {
          item.quietAt = null;
          log('queue.entry-timeout', { from: QUEUE_ITEM_STATUSES.indexOf(item.status), quiet: true });
          item.status = 'ready';
        }
      } else if (item.entryAt !== null && now - item.entryAt >= QUEUE_ENTRY_WAIT_MS) {
        // jr6 apply F4a (AF-5): the queue's Autofill at a page with no form, and no run of the tab reported since
        // (refused, a choice or a wall nothing took, nothing followed): Ready for you, never Filling for ever. It keeps
        // its open-tab place ('ready' is OPEN); the queue presses nothing more (the panel's grant takes the steps).
        item.entryAt = null;
        if (item.status !== 'ready') {
          log('queue.entry-timeout', { from: QUEUE_ITEM_STATUSES.indexOf(item.status) });
          item.status = 'ready';
        }
      }
    }
  }

  /** Stops the run (nothing more opens; the open tabs stay the person's, their results still told). */
  function stopRun(run: Run, by: QueueStatusStop): void {
    if (run.phase !== 'running' && run.phase !== 'paused') return;
    Object.assign(run, { phase: 'stopped', nextAt: null, leftMs: null, hold: null, stoppedBy: by });
    soon?.cancel();
    soon = null;
    log('queue.stopped', { by: QUEUE_STATUS_STOPS.indexOf(by) });
  }

  /** A tick (a timer, the alarm, an event, start-up): results told, tabs looked at, the cap and the timer, the next tab
   *  opened when it is due. */
  async function tick(): Promise<void> {
    await serial(async () => {
      const run = await load();
      if (run === null) {
        await keepAlarm(null);
        return;
      }
      const before = signatureOf(run);
      await sweep(run);
      if (run.phase === 'running') {
        const blocked = await blockOf();
        if (blocked !== null) stopRun(run, blocked === 'disclosure' ? 'disclosure' : 'connection');
      }
      if (run.phase === 'running') await advance(run);
      // Every result not told yet (those decided now among them), told now.
      const told = await tellPending(run);
      // Written only when something moved: a run of thousands of jobs is not rewritten at every tick.
      const moved = told || signatureOf(run) !== before;
      if (moved) await save(run);
      await keepAlarm(run);
      schedule(run);
      if (moved) deps.changed();
    });
  }

  /** The schedule: the cap held or released, and the next tab opened when it is due. */
  async function advance(run: Run): Promise<void> {
    settle(run);
    if (run.phase !== 'running' || !run.items.some((item) => item.status === 'queued')) return;
    const settings = await deps.settings();
    const now = deps.now();
    const open = run.items.filter(isOpen).length;
    if (open >= settings.queue.maxOpenTabs) {
      // The timer waits while as many queued tabs are open as the settings allow, the seconds it had left kept.
      if (run.hold !== 'cap') {
        run.leftMs = run.nextAt === null ? run.leftMs ?? 0 : Math.max(0, run.nextAt - now);
        run.nextAt = null;
        run.hold = 'cap';
      }
      return;
    }
    if (run.hold === 'cap') {
      run.nextAt = now + (run.leftMs ?? 0);
      run.leftMs = null;
      run.hold = null;
    }
    if (deps.online?.() === false) {
      run.hold = 'offline';
      return;
    }
    if (run.hold === 'offline') run.hold = null;
    if (run.nextAt === null || run.nextAt > now) return;
    if (run.hold === 'server') run.hold = null;
    const outcome = await openNext(run);
    if (outcome === 'stopped') {
      stopRun(run, 'no-tab');
      return;
    }
    // v2.0 P9 (API 8): TailorIT's daily limit: nothing more opens; the tabs open go on to their end.
    if (outcome === 'limit') {
      stopRun(run, 'daily-limit');
      return;
    }
    if (outcome === 'retry') {
      // TailorIT did not answer: tried again shortly, the schedule unchanged.
      run.hold = 'server';
      run.nextAt = now + QUEUE_RETRY_MS;
      return;
    }
    if (outcome === 'opened') {
      run.opened += 1;
      run.nextAt = now + waitAfter(settings, run.opened);
    }
    settle(run);
    // The tab just opened may have reached the cap: held from the full wait.
    if (run.phase === 'running' && run.items.filter(isOpen).length >= settings.queue.maxOpenTabs
      && run.items.some((item) => item.status === 'queued')) {
      run.leftMs = run.nextAt === null ? 0 : Math.max(0, run.nextAt - now);
      run.nextAt = null;
      run.hold = 'cap';
    }
  }

  /** The status the Queue tab shows. */
  async function status(): Promise<QueueStatus> {
    const [run, settings, blocked, agentOn] = [await load(), await deps.settings(), await blockOf(),
      await deps.agentOn().catch(() => false)];
    const counts = Object.fromEntries(QUEUE_ITEM_STATUSES.map((each) => [each, 0])) as Record<QueueItemStatus, number>;
    for (const item of run?.items ?? []) counts[item.status] += 1;
    const now = deps.now();
    const nextInMs = run === null ? null : run.phase === 'running' && run.nextAt !== null
      ? Math.max(0, run.nextAt - now) : run.phase === 'running' || run.phase === 'paused' ? run.leftMs : null;
    return {
      phase: run?.phase ?? 'idle',
      hold: run?.phase === 'running' ? run.hold : null,
      nextInMs,
      total: run?.items.length ?? 0,
      opened: run === null ? 0 : run.items.filter((item) => item.status !== 'queued').length,
      counts,
      openTabs: run?.items.filter(isOpen).length ?? 0,
      maxOpenTabs: settings.queue.maxOpenTabs,
      stoppedBy: run?.phase === 'stopped' ? run.stoppedBy : null,
      // v2.0 P9: TailorIT's words for the limit that stopped the run.
      ...(run?.phase === 'stopped' && run.stoppedBy === 'daily-limit' && run.limit !== null ? { limit: run.limit } : {}),
      agentStopped: run?.agentStopped === true && (run.phase === 'running' || run.phase === 'paused'),
      agentOn,
      blocked,
      pending: pending(run),
      autofillOnOpen: settings.queue.autofillOnOpen,
      submit: settings.modes.submit === 'auto' && blocked !== 'disclosure' ? 'auto' : 'manual',
    };
  }

  /** Every queued job TailorIT holds (all its pages, at most QUEUE_RUN_MAX), or null when it could not be read. */
  async function readQueue(): Promise<QueueTask[] | null> {
    const tasks: QueueTask[] = [];
    let cursor: string | null = null;
    do {
      const answer = await deps.server.queuePage(cursor);
      if (!answer.ok) {
        log('queue.read-failed', { status: answer.status ?? 0 });
        return null;
      }
      const page = pageOf(answer.value);
      tasks.push(...page.items.filter((task) => task.state === 'queued'));
      cursor = page.next;
    } while (cursor !== null && tasks.length < QUEUE_RUN_MAX);
    return tasks.slice(0, QUEUE_RUN_MAX);
  }

  /** A queued job as the run keeps it: ids, title and company, nothing of its address. */
  function itemOf(task: QueueTask): Item {
    return { id: task.id, jobId: task.jobId, resumeId: null, title: task.title.slice(0, 300),
      company: task.company.slice(0, 200), applicationKey: null, status: 'queued', reason: null, tabId: null,
      openedAt: null, heardAt: null, startedAt: null, entryAt: null, quietAt: null, tell: null, // jr6 SHELL-B
      pressedAt: null, note: null }; // jr7 AUTO-7
  }

  async function start(): Promise<Answer<QueueStatus>> {
    const answer = await serial(async (): Promise<'started' | 'blocked' | 'unavailable' | 'already'> => {
      const held = await load();
      if (held !== null && (held.phase === 'running' || held.phase === 'paused')) return 'already';
      if ((await blockOf()) !== null) return 'blocked';
      const tasks = await readQueue();
      if (tasks === null) return 'unavailable';
      // The background agent never runs beside the queue: Run auto-apply goes off first.
      const agentStopped = await deps.agentOn().catch(() => false);
      if (agentStopped) await deps.stopAgent().catch(() => undefined);
      // The jobs of an earlier run whose tabs are still open and not done stay in this one (they hold their places).
      const carried = (held?.items ?? []).filter((item) => isOpen(item) || item.tell !== null);
      const ids = new Set(carried.map((item) => item.id));
      const items = [...carried, ...tasks.filter((task) => !ids.has(task.id)).map(itemOf)].slice(0, QUEUE_RUN_MAX);
      const run: Run = { phase: 'running', startedAt: deps.now(), opened: 0, nextAt: deps.now(), leftMs: null, hold: null,
        stoppedBy: null, agentStopped, items, limit: null };
      preview = null;
      await save(run);
      log('queue.started', { jobs: items.length, agent: agentStopped });
      return 'started';
    });
    if (answer === 'unavailable') return refuse('unavailable');
    if (answer === 'started') await tick();
    return ok(await status());
  }

  /** Stop, Pause and Resume, each on the run as it stands. */
  async function control(change: (run: Run) => boolean): Promise<Answer<QueueStatus>> {
    const changed = await serial(async () => {
      const run = await load();
      if (run === null || !change(run)) return false;
      await save(run);
      await keepAlarm(run);
      return true;
    });
    if (changed) {
      deps.changed();
      await tick();
    }
    return ok(await status());
  }

  /** queue/list: a page of the run's jobs, or of TailorIT's queued ones before a run. */
  async function list(offset: number): Promise<Answer<QueueListAnswer>> {
    const run = await load();
    if (run !== null && run.items.length > 0) {
      const items = run.items.slice(offset, offset + QUEUE_LIST_PAGE).map((item) => ({ id: item.id,
        title: item.title, company: item.company, status: item.status, reason: item.reason,
        tab: item.tabId !== null,
        // jr7 AUTO-7 (D-4, ICIMS7-04): Submit is the person's on this job's site; why it rests with them.
        ...(item.applicationKey !== null && queueSubmitIsPersons(item.applicationKey) && OPEN.has(item.status)
          ? { submitYours: true as const } : {}),
        ...(item.note === null ? {} : { note: item.note }) }));
      return ok({ source: 'run', items, offset, total: run.items.length,
        more: offset + QUEUE_LIST_PAGE < run.items.length });
    }
    if ((await blockOf()) === 'not-connected') return refuse('not_connected');
    if (offset === 0 || preview === null) {
      const first = await deps.server.queuePage(null);
      if (!first.ok) return refuse(first.failure === 'not-connected' ? 'not_connected' : 'unavailable');
      const page = pageOf(first.value);
      preview = { items: page.items.filter((task) => task.state === 'queued'), next: page.next, total: page.total };
    }
    while (preview.items.length < offset + QUEUE_LIST_PAGE && preview.next !== null) {
      const answer = await deps.server.queuePage(preview.next);
      if (!answer.ok) return refuse('unavailable');
      const page = pageOf(answer.value);
      preview = { items: [...preview.items, ...page.items.filter((task) => task.state === 'queued')], next: page.next,
        total: page.total };
    }
    const items = preview.items.slice(offset, offset + QUEUE_LIST_PAGE).map((task) => ({ id: task.id,
      title: task.title.slice(0, 300), company: task.company.slice(0, 200), status: 'queued' as const, reason: null,
      tab: false }));
    return ok({ source: 'queue', items, offset, total: Math.max(preview.total, preview.items.length),
      more: offset + QUEUE_LIST_PAGE < preview.items.length || preview.next !== null });
  }

  /** A change of one job's status from its tab: saved, the panels told, and a tick when a place in the cap freed. */
  async function onItem(tabId: number, change: (run: Run, item: Item) => Promise<boolean>, any = false): Promise<void> {
    let freed = false;
    const changed = await serial(async () => {
      const run = await load();
      const item = any ? run?.items.find((each) => each.tabId === tabId) ?? null : openItemOf(run, tabId);
      if (run === null || item === null) return false;
      const wasOpen = isOpen(item);
      if (!(await change(run, item))) return false;
      freed = wasOpen && !isOpen(item);
      settle(run);
      await save(run);
      await keepAlarm(run);
      schedule(run); // jr6 apply F4a: an entry's wait gets its timer at once (paused or stopped runs too)
      return true;
    });
    if (!changed) return;
    deps.changed();
    if (freed) await tick();
  }

  return {
    status,
    list,
    start,
    tick,

    /** Starts the runner with the worker: the alarm again while it runs or a result waits, and a first look. */
    async boot(): Promise<void> {
      await keepAlarm(await load());
      await tick();
    },

    stop: (by: QueueStop = 'person') => control((run) => {
      if (run.phase !== 'running' && run.phase !== 'paused') return false;
      stopRun(run, by);
      return true;
    }),

    pause: () => control((run) => {
      if (run.phase !== 'running') return false;
      const now = deps.now();
      run.leftMs = run.nextAt !== null ? Math.max(0, run.nextAt - now) : run.leftMs;
      Object.assign(run, { phase: 'paused', nextAt: null, hold: null });
      soon?.cancel();
      soon = null;
      log('queue.paused');
      return true;
    }),

    resume: () => control((run) => {
      if (run.phase !== 'paused') return false;
      const now = deps.now();
      Object.assign(run, { phase: 'running', nextAt: now + (run.leftMs ?? 0), leftMs: null, hold: null });
      log('queue.resumed');
      return true;
    }),

    /** Whether the queue runs now (or is paused): Run auto-apply turned on stops it first (index.ts). */
    async active(): Promise<boolean> {
      const run = await load();
      return run !== null && (run.phase === 'running' || run.phase === 'paused');
    },

    /** A row's click: the job's tab to the front, while it is open. */
    async focus(id: string): Promise<Answer<{ focused: boolean }>> {
      const item = (await load())?.items.find((each) => each.id === id) ?? null;
      if (item === null || item.tabId === null) return ok({ focused: false });
      return ok({ focused: await deps.tabs.focus(item.tabId) });
    },

    /** Whether a tab is one the queue opened for a job not done yet. */
    async ownsTab(tabId: number): Promise<boolean> {
      return openItemOf(await load(), tabId) !== null;
    },

    /** A frame of a queued tab said hello (`acts`: the tab's top frame, or the frame that claims its application, as
     *  index.ts reads the registry): the job's page is open; at the job's own application its job and resume are
     *  named, and with Automatically its first form gets its run, once. */
    hello: (tabId: number, frame: QueueFrame, acts: boolean, said: { handOver?: AgentNote | undefined } = {}) =>
      onItem(tabId, async (_run, item) => {
      let changed = false;
      const now = deps.now();
      if (item.status === 'opening') {
        Object.assign(item, { status: 'opened', heardAt: now });
        changed = true;
      }
      if (!acts || item.applicationKey === null || frame.applicationKey !== item.applicationKey) return changed;
      deps.assign(tabId, item.applicationKey, { jobId: item.jobId, resumeId: item.resumeId });
      // jr7 AUTO-7 (ICIMS7-04): a step that is the person's by design: Ready for you, with its words; nothing pressed.
      if (said.handOver !== undefined) {
        Object.assign(item, { status: 'ready', note: said.handOver, entryAt: null, quietAt: null });
        log('queue.held', { handOver: true });
        return true;
      }
      // jr7 AUTO-7 (AUTO7-04): an application frame with no form, before anything started: its quiet wait begins
      // (Automatically only; a wall, a choice or an entry it then shows starts the panel's Autofill, wall(), and ends it).
      if (!frame.hasForm && item.startedAt === null && item.status === 'opened' && item.quietAt === null
        && (await deps.settings()).queue.autofillOnOpen === 'auto') {
        item.quietAt = now;
        return true;
      }
      if (!frame.hasForm || item.startedAt !== null) return changed;
      if ((await deps.settings()).queue.autofillOnOpen !== 'auto') return changed;
      Object.assign(item, { startedAt: now, status: 'filling' });
      log('queue.fill-started', { form: true });
      const target = frame.documentId === null ? { frameId: frame.frameId }
        : { frameId: frame.frameId, documentId: frame.documentId };
      // Sent once the hello is answered: the frame then takes it as the panel's Autofill.
      void Promise.resolve().then(() => deps.send(tabId, { v: 1, type: 'run/start', dryRun: false }, target))
        .catch(() => log('frame.unreachable'));
      return true;
    }),

    /** The application frame of a queued tab with no form shows the posting's own Apply, an entry choice or an account
     *  wall (frame/wall): with Automatically, the panel's Autofill there, once per job. */
    wall: (tabId: number, frame: { applicationKey?: string | undefined; wall: boolean }) => onItem(tabId,
      async (_run, item) => {
        if (item.startedAt !== null || item.applicationKey === null || frame.applicationKey !== item.applicationKey) {
          return false;
        }
        if ((await deps.settings()).queue.autofillOnOpen !== 'auto') return false;
        // An account wall rests for the person (or Sign-in Auto signs in, and the next form's run says so).
        // jr6 apply F4a: an entry or a choice whose run never reports is Ready for you after QUEUE_ENTRY_WAIT_MS (sweep).
        const now = deps.now();
        Object.assign(item, { startedAt: now, entryAt: now, status: frame.wall ? 'ready' : 'filling',
          quietAt: null }); // jr6 SHELL-B: the entry's own wait leads
        log('queue.fill-started', { form: false });
        void deps.fill(tabId).catch(() => undefined);
        return true;
      }),

    /** A queued tab's reports changed: filling while its run works, ready for you once it rests. */
    reported: (tabId: number) => onItem(tabId, async (_run, item) => {
      if (item.status === 'opening') return false;
      const next = statusOfReports(await deps.reports(tabId).catch(() => []));
      if (next === null) return false;
      // jr6 apply F4a: a run of the tab reported: its reports lead from now on, the entry's wait over (saved).
      // jr6 SHELL-B: and the tab is not quiet (a quiet wait ends).
      const waited = item.entryAt !== null || item.quietAt !== null;
      item.entryAt = null;
      item.quietAt = null;
      if (next === item.status) return waited;
      item.status = next;
      return true;
    }),

    /** The platform confirmed a Submit in a queued tab (submissions.ts took its sign): for the job's own application,
     *  submitted, TailorIT told (it marks the job Applied), and, v2.0 P9 (A20), the tab closed QUEUE_CLOSE_SUBMITTED_MS
     *  later, in front or not, while "Close the application tab when it's submitted" is on, unless it was handed to the
     *  person (a step that is theirs by design, a check or a code at rest); another posting's, or a tab the queue did
     *  not open, is 'not-ours' (recorded the normal way, its tab never closed here). */
    async submitted(tabId: number, applicationKey: string): Promise<'not-ours' | 'recorded' | 'not-recorded'> {
      let outcome: 'not-ours' | 'recorded' | 'not-recorded' = 'not-ours';
      await onItem(tabId, async (_run, item) => {
        if (item.status === 'submitted' || item.status === 'skipped' || item.applicationKey !== applicationKey) {
          return false;
        }
        const reports = await deps.reports(tabId).catch(() => []);
        // v2.0 P9 (A20): read before finish() clears the note.
        const handed = item.note !== null || reports.some((report) => report.mode === 'fill'
          && report.status === 'handoff' && PERSONS_PAUSES.has(report.pauseReason));
        finish(item, 'submitted', { state: 'submitted', reason: null }, guessesOf(reports));
        outcome = (await tellOne(item)) ? 'recorded' : 'not-recorded';
        if (!handed && (deps.closeTab === undefined || await deps.closeTab().catch(() => true))) {
          deps.timers.after(QUEUE_CLOSE_SUBMITTED_MS, () => void (async () => {
            if ((await deps.tabs.state(tabId)) !== 'gone') await deps.tabs.close(tabId);
          })().catch(() => undefined));
        }
        return true;
      }, true);
      return outcome;
    },

    // ── jr7 AUTO-7 (AUTO7-01, FIX7PLAN D-4) ──
    /** A Submit of the job's own application was armed in its tab (submit/armed taken): noted; where the platform's
     *  Submit is the person's (no success sign read: QUEUE_SUBMIT_PLATFORMS), the job is Ready for you, never
     *  cancelled; a sign that still fires records it (submitted). */
    pressed: (tabId: number, applicationKey: string) => onItem(tabId, async (_run, item) => {
      if (item.applicationKey !== applicationKey || item.pressedAt !== null) return false;
      item.pressedAt = deps.now();
      if (queueSubmitIsPersons(applicationKey)) {
        item.status = 'ready';
        item.entryAt = null;
        item.quietAt = null;
      }
      log('queue.pressed', { persons: queueSubmitIsPersons(applicationKey) });
      return true;
    }),

    /** Whether a frame of a queued tab (an open job's) at `applicationKey` (or the job's own, where the frame names
     *  none) keeps Submit on Manual: its platform is not one whose success sign a capture shows read (D-4). */
    async submitHeld(tabId: number, applicationKey: string | null): Promise<boolean> {
      const item = openItemOf(await load(), tabId);
      if (item === null) return false;
      const key = applicationKey ?? item.applicationKey;
      return key === null || queueSubmitIsPersons(key)
        || (item.applicationKey !== null && queueSubmitIsPersons(item.applicationKey));
    },
    // ── end jr7 AUTO-7 ──

    /** A tab closed: a queued job not done is skipped (the person closed it: needs-you cancelled), and its place in the
     *  cap freed; a done job's tab is no longer open. jr7 AUTO-7 (AUTO7-01, D-4): one whose Submit was armed in it is
     *  never told cancelled: it may have been sent (needs-you timed_out, TailorIT's "check the site"). */
    tabRemoved: (tabId: number) => onItem(tabId, async (_run, item) => {
      if (OPEN.has(item.status)) {
        finish(item, 'skipped', { state: 'needs-you', reason: item.pressedAt !== null ? 'timed_out' : 'cancelled' });
      }
      item.tabId = null;
      if (item.tell !== null) await tellOne(item);
      return true;
    }, true),

    /** The connection changed or went: the run stops (its results wait for a connection to tell them). */
    async tokenChanged(): Promise<void> {
      await control((run) => {
        if (run.phase !== 'running' && run.phase !== 'paused') return false;
        stopRun(run, 'connection');
        return true;
      });
    },
  };
}

/** The runner, as index.ts wires it. */
export type QueueRunner = ReturnType<typeof createQueueRunner>;
