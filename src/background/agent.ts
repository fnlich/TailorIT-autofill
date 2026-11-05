/*
 * The auto-apply agent (v3 Phase 5; docs/SPEC-AMENDMENTS.md §12 Decision 9; docs/PRIVACY.md "The auto-apply agent").
 * With Options › "Run auto-apply" on (off by default; on only with the person's one-time confirmation that
 * applications go out unattended with AI-guessed answers, a connection holding agent:run and the disclosure
 * acknowledged as it reads now), the worker takes the jobs the person queued in TailorIT, one at a time:
 * - Claim: GET /api/autofill/agent/next, only while a browser window of the person's is open. TailorIT binds the row
 *   it answers to this connection (running) and gives the same row back to a worker that restarted. The agent keeps its
 *   own record of the job in storage.local (AGENT_RUN_KEY: the queue id, the task's application key, job id and resume
 *   id, the job's company and title, the window and tab ids with the browser session they belong to, times and counts;
 *   never an address or anything the form held). A worker that restarted finds its job again; a record of another
 *   browser session (AGENT_SESSION_KEY, a nonce in storage.session, which a browser restart empties) names a tab and
 *   window that are not the agent's any more: that job is left for the person (needs-you, cancelled), nothing is
 *   closed, and its form is never opened twice.
 * - Open: only a task whose address the agent fills (agentApplicationUrl reads it, on an applicant-tracking host, with
 *   an application key), at that canonical application address, in a new unfocused window: the window first, on an
 *   empty page, then the address (chrome.windows, tabs.update; no permission).
 * - Fill: the window's top frame saying hello with a form of the task's own application (its key: another posting's,
 *   or an address that names none, is never filled) gets run/start {agent} (once per document, at most
 *   AGENT_MAX_STARTS a job), which the content script takes from the worker's own script alone and which resumes the
 *   tab's stored RunState, so its step counts carry across documents. The worker answers that tab's run/begin and
 *   settings with Next and Submit on Auto and the person's skip rules (settings.ts contentSettingsOf, agent), names the
 *   task's job and resume for it (JobCards.assign), and only while the agent may run (the switch on, nothing blocked).
 *   A page with no form gets agent/enter: the adapter's declared entry control (Greenhouse's and Lever's Apply,
 *   Ashby's Application tab), at most AGENT_MAX_ENTRIES times a job. Sign-in follows the person's Sign-in mode.
 * - One Submit per job: once the job's Submit was pressed (armed in its tab, or a report says so), a later form
 *   document is never started, and any document but the one it was pressed in gets Submit on Manual (a run the page's
 *   load resumes by itself presses nothing); the platform's confirmation is waited for AGENT_CONFIRM_MS, then the job
 *   is the person's. The page's refusal of that Submit gets one retry in the same document, never more.
 * - Watch: every report of the tab is read (agentVerdict); the platform's sign, taken by submissions.ts for the Submit
 *   this tab armed for the task's application, finishes the job submitted (TailorIT marks it Applied with the result:
 *   POST /applied is not called for it; a sign of another posting is recorded the normal way, and the job left for the
 *   person). A CAPTCHA, a bot check, an email code, a sign-in it cannot do, a required field left empty, a posting that
 *   forbids AI (with those skip rules on), the page's refusal after one retry, a closed posting, a page that never
 *   loads, and AGENT_JOB_TIMEOUT_MS without progress (AGENT_JOB_MAX_MS in all) each finish it with the contract's state
 *   and reason.
 * - Finish: the result is kept, the agent's tab released (run/cancel and the person's own settings to its frames) and
 *   closed (that tab only, never a window, and never one already gone), and the result told to TailorIT (POST
 *   /api/autofill/agent/:id/result {state, reason, aiGuesses}). A result TailorIT could not take for now is kept and
 *   sent again, while the alarm keeps waking the worker (a submitted one is kept for every refusal but 404 and 400);
 *   one refused for good is dropped. Then the next job is taken.
 * - Wake: a chrome.alarms alarm (AGENT_ALARM, every AGENT_TICK_MINUTES) wakes the worker while Run auto-apply is on, or
 *   a result waits to be told. An empty queue or a failure waits AGENT_BACKOFF_MS (a minute, then five).
 * - Stop: Stop, Run auto-apply turned off, the person closing the tab, the agent blocked (a disclosure to acknowledge,
 *   a connection without agent:run, none) leave the running job for the person (needs-you, cancelled). A changed or
 *   dropped connection does too, and turns Run auto-apply off (its confirmation asked again).
 * Commands come only from the worker's own poll of TailorIT with its token: no page, frame or message can start the
 * agent, choose its job or make it submit. Nothing here logs a job, an address or a value: states and reasons are
 * logged as their places in the contract's lists.
 */
import { z } from 'zod';
import { applicationOf } from '../adapters';
import {
  agentApplicationUrl, AUTOFILL_AGENT_FINISHED_STATES, AUTOFILL_AGENT_REASONS, AutofillAgentIdSchema,
  type AutofillAgentFinishedState, type AutofillAgentReason,
} from '../contract/tailorit';
import { ok, type Answer } from '../messaging/envelope';
import type { AgentBlock, AgentStatus, EntryAnswer, EntryBlock } from '../messaging/schemas';
import type { AgentAlarms, AgentWindows, StorageArea } from '../platform/types';
import { platformOfUrl } from '../shared/hosts';
import { log } from '../shared/log';
import type { FrameReport } from '../shared/report';
import type { FrameEntry } from './frames';
import { createKeyedQueue } from './locks';
import type { ServerClient, ServerFailure } from './server-client';
import type { Timers } from './timers';

/** The alarm that wakes the worker while Run auto-apply is on, and how often (Chrome's floor). */
export const AGENT_ALARM = 'agent-tick';
export const AGENT_TICK_MINUTES = 0.5;
/** A job with no progress this long (no new report, no page, the run not working) is the person's: timed_out. A
 *  window Chrome hides may stretch the fill's waits (its timers throttled), so this counts from the last progress. */
export const AGENT_JOB_TIMEOUT_MS = 10 * 60_000;
/** The most a job may take in all, under TailorIT's own AUTOFILL_AGENT_RUN_TIMEOUT_MS (30 min). */
export const AGENT_JOB_MAX_MS = 25 * 60_000;
/** A window whose page never showed a form this long after it opened: closed (a page said hello) or not loaded. */
export const AGENT_FORM_WAIT_MS = 60_000;
/** A run at rest whose report decides nothing (no Submit pressed, nothing held), unchanged this long, is the person's. */
export const AGENT_SETTLE_MS = 15_000;
/** Sign-in mode Auto signing in: its outcome is waited for this long, then the sign-in is the person's. */
export const AGENT_SIGN_IN_WAIT_MS = 60_000;
/** After the job's Submit, a form document that shows again is not started: the confirmation is waited this long. */
export const AGENT_CONFIRM_MS = 90_000;
/** The waits before the queue is asked again after it was empty, or after a failure: a minute, then five. */
export const AGENT_BACKOFF_MS = [60_000, 5 * 60_000] as const;
/** How soon after a job finished the next one is taken. */
export const AGENT_NEXT_MS = 1_000;
/** Entry presses (Apply, Application) per job: a posting that keeps showing itself is not pressed forever. */
export const AGENT_MAX_ENTRIES = 2;
/** Runs started per job (one per document of the form): a form that keeps loading again is not filled forever. */
export const AGENT_MAX_STARTS = 8;

/** storage.local: the switch, the running job, today's tally. storage.session: when the queue is asked next, and the
 *  browser session's nonce. */
export const AGENT_SWITCH_KEY = 'agent';
export const AGENT_RUN_KEY = 'agent:run';
export const AGENT_TALLY_KEY = 'agent:day';
export const AGENT_POLL_KEY = 'agent:poll';
export const AGENT_SESSION_KEY = 'agent:session';

const Count = z.number().int().nonnegative();
const ResultSchema = z.strictObject({
  state: z.enum(AUTOFILL_AGENT_FINISHED_STATES),
  reason: z.enum(AUTOFILL_AGENT_REASONS).nullable(),
});
const NONCE = /^[A-Za-z0-9_-]{8,64}$/;

/** Run auto-apply, and whether the person gave the one-time confirmation. */
const SwitchSchema = z.strictObject({ on: z.boolean(), confirmed: z.boolean() });
type AgentSwitch = z.infer<typeof SwitchSchema>;

/** The job the agent runs: ids, keys, times and counts, the job's company and title as TailorIT named them; never an
 *  address or a value. */
const RunSchema = z.strictObject({
  id: AutofillAgentIdSchema,
  /** The task's application key (adapters' applicationOf: a hash of its canonical address, never the address). */
  applicationKey: z.string().regex(/^[a-z]+:[0-9a-f]{16}$/),
  /** TailorIT's job and the resume the task names for it (null: TailorIT's suggestion). */
  jobId: z.number().int().positive(),
  resumeId: z.string().max(64).nullable(),
  company: z.string().max(200),
  title: z.string().max(300),
  /** The browser session the window and tab ids belong to (AGENT_SESSION_KEY); null before the window opened. */
  session: z.string().regex(NONCE).nullable(),
  windowId: z.number().int().nullable(),
  tabId: z.number().int().nonnegative().nullable(),
  claimedAt: Count,
  openedAt: Count.nullable(),
  /** When a frame of the tab first said hello, and first showed a form; the last progress (a hello, a new report, a run
   *  at work); the top report's time last read. */
  heardAt: Count.nullable(),
  formAt: Count.nullable(),
  progressAt: Count,
  lastReportAt: Count.nullable(),
  /** Runs started (and their documents, Chrome's ids), and the documents whose entry was pressed. */
  starts: Count,
  started: z.array(z.string().max(100)).max(AGENT_MAX_STARTS),
  entered: z.array(z.string().max(100)).max(AGENT_MAX_ENTRIES),
  /** When the job's Submit was pressed, and in which document (Chrome's id; null when not known); when a form document
   *  showed after it (held, not started). */
  pressedAt: Count.nullable(),
  pressedDoc: z.string().max(100).nullable(),
  heldAt: Count.nullable(),
  /** The one retry after the page refused the Submit was used; the run it retried (its reports no longer count). */
  retried: z.boolean(),
  staleRunId: z.string().max(64).nullable(),
  /** The most AI guesses a report showed, per step. */
  guesses: z.record(z.string().regex(/^\d{1,3}$/), Count),
  /** A resting report that decides nothing yet: what it waits for, since when, and that report's time. */
  waiting: z.strictObject({ kind: z.enum(['settle', 'sign-in']), at: Count, updatedAt: Count }).nullable(),
  /** The result once decided, until TailorIT took it. */
  result: ResultSchema.extend({ aiGuesses: Count }).nullable(),
});
type AgentRun = z.infer<typeof RunSchema>;

const TallySchema = z.strictObject({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), done: Count, last: ResultSchema.nullable() });
type AgentTally = z.infer<typeof TallySchema>;

const PollSchema = z.strictObject({ nextAt: Count, misses: Count });
type AgentPoll = z.infer<typeof PollSchema>;

/** What the agent decides from its tab's report. */
export type AgentVerdict =
  | { kind: 'wait' }
  /** At rest, and nothing decides it: the person's (needs-you, other) unless it changes within AGENT_SETTLE_MS. */
  | { kind: 'settle' }
  /** Sign-in mode Auto signs in: its outcome, or the person's (needs-you, sign_in) after AGENT_SIGN_IN_WAIT_MS. */
  | { kind: 'sign-in' }
  /** The page refused the Submit pressed: one more fill and Submit, in the same document. */
  | { kind: 'retry' }
  | { kind: 'finish'; state: AutofillAgentFinishedState; reason: AutofillAgentReason | null };

type ReportView = Pick<FrameReport, 'mode' | 'status' | 'pauseReason' | 'notices' | 'buttons' | 'resting'>;

const finish = (state: AutofillAgentFinishedState, reason: AutofillAgentReason | null): AgentVerdict =>
  ({ kind: 'finish', state, reason });
const WAIT: AgentVerdict = { kind: 'wait' };

/**
 * What a report of the agent's run means (the contract's states and reasons, AUTOFILL_AGENT_REASONS):
 * - working (scan, fill, validate, Next pressed and its page awaited): wait; a dry run's report never counts;
 * - done: wait (the platform's confirmation, taken by the worker, finishes it submitted);
 * - the policy card: skipped, posting_forbids_ai (the agent's settings turn "ask me" into the profile only, so the card
 *   shows only for a page the settings did not reach; the noAi skip rule then decides at the Submit);
 * - a sign-in or account page: Sign-in Auto signing in waits (sign-in); its failure is needs-you sign_in_failed;
 *   otherwise needs-you sign_in;
 * - a pause: a CAPTCHA or a bot check needs-you captcha, an email code needs-you email_code, a page still busy failed
 *   page_error, anything else (an entry choice, a control that takes only the person's click) needs-you other;
 * - stopped: a form its page hid failed page_error; else needs-you cancelled (the person's Cancel);
 * - at rest (review, or waiting for a Next): a Submit pressed waits for its confirmation; then, in order, the skip
 *   rules' notices (no-AI posting: skipped posting_forbids_ai; a required field empty: needs-you required_field_empty;
 *   an AI-guessed legal answer: needs-you ai_guess_legal), a CAPTCHA (needs-you captcha), a sign-in (needs-you sign_in),
 *   the page refusing the Submit pressed (one retry, then failed validation_error), errors shown before any Submit
 *   (failed validation_error: the run's own fix pass came first), a Submit no confirmation followed (needs-you other),
 *   a last step the adapter cannot tell (needs-you unsupported_site), a step tried to its limit or a runaway wizard
 *   (failed validation_error), a form gone out of view (failed page_error), a Submit held for another check (needs-you
 *   other); nothing of these: settle.
 */
export function agentVerdict(report: ReportView, context: { retried: boolean }): AgentVerdict {
  if (report.mode !== 'fill') return WAIT;
  const has = (code: FrameReport['notices'][number]['code']) => report.notices.some((notice) => notice.code === code);
  switch (report.status) {
    case 'done':
      return WAIT;
    case 'policy-notice':
      return finish('skipped', 'posting_forbids_ai');
    case 'auth-needed':
      if (has('sign-in-failed')) return finish('needs-you', 'sign_in_failed');
      if (has('sign-in-auto')) return { kind: 'sign-in' };
      return finish('needs-you', 'sign_in');
    case 'handoff':
      switch (report.pauseReason) {
        case 'captcha':
        case 'bot-check':
          return finish('needs-you', 'captcha');
        case 'email-code':
          return finish('needs-you', 'email_code');
        case 'page-busy':
          return finish('failed', 'page_error');
        default:
          return finish('needs-you', 'other');
      }
    case 'stopped':
      return has('form-hidden') ? finish('failed', 'page_error') : finish('needs-you', 'cancelled');
    case 'review':
      return atRest(report, has, context);
    case 'wait-transition':
      return report.resting === true ? atRest(report, has, context) : WAIT;
    default:
      return WAIT;
  }
}

function atRest(report: ReportView, has: (code: FrameReport['notices'][number]['code']) => boolean,
  context: { retried: boolean }): AgentVerdict {
  if (report.buttons?.pressed === 'submit') return WAIT;
  if (has('submit-held-no-ai')) return finish('skipped', 'posting_forbids_ai');
  if (has('submit-held-required')) return finish('needs-you', 'required_field_empty');
  if (has('submit-held-guess')) return finish('needs-you', 'ai_guess_legal');
  if (has('submit-held-attention') || has('submit-held-entries')) return finish('needs-you', 'other');
  if (has('submit-held-captcha') || has('captcha-next') || has('captcha')) return finish('needs-you', 'captcha');
  if (has('auth')) return finish('needs-you', 'sign_in');
  if (has('submit-errors')) return context.retried ? finish('failed', 'validation_error') : { kind: 'retry' };
  if (has('validation')) return finish('failed', 'validation_error');
  if (has('submit-unconfirmed')) return finish('needs-you', 'other');
  if (has('final-unknown')) return finish('needs-you', 'unsupported_site');
  if (has('step-retry-limit') || has('max-steps')) return finish('failed', 'validation_error');
  if (has('next-hidden') || has('form-hidden')) return finish('failed', 'page_error');
  if (has('submit-held-check')) return finish('needs-you', 'other');
  return { kind: 'settle' };
}

/** What an entry's block means (agent/enter answered 'blocked'). */
const ENTRY_RESULTS: Record<EntryBlock, { state: AutofillAgentFinishedState; reason: AutofillAgentReason }> = {
  'sign-in': { state: 'needs-you', reason: 'sign_in' },
  'sign-in-failed': { state: 'needs-you', reason: 'sign_in_failed' },
  'email-code': { state: 'needs-you', reason: 'email_code' },
  captcha: { state: 'needs-you', reason: 'captcha' },
  other: { state: 'needs-you', reason: 'other' },
};

/** The task the agent's tab runs, as run/begin needs it: the job and resume to name for it. */
export interface AgentTask {
  jobId: number;
  resumeId: string | null;
}

/** The task for one document of the agent's tab: with whether its Submit stays on Manual there (the job's Submit was
 *  pressed in another document, or one not known). */
export interface AgentDocumentTask extends AgentTask {
  submitHeld: boolean;
}

/** What the agent needs. */
export interface AgentDeps {
  server: Pick<ServerClient, 'agentNext' | 'agentResult'>;
  local: StorageArea;
  session: StorageArea;
  windows: AgentWindows;
  alarms: AgentAlarms;
  timers: Timers;
  now(): number;
  /** A fresh random nonce (8 to 64 of [A-Za-z0-9_-]): the browser session's, made once per session. */
  nonce(): string;
  /** The token's scopes, or null when not connected. */
  scopes(): Promise<readonly string[] | null>;
  /** The person acknowledged the disclosure as it reads now (auth.ts). */
  disclosed(): Promise<boolean>;
  /** The tab's reports, as the panels read them. */
  reports(tabId: number): Promise<readonly FrameReport[]>;
  /** The tab's top frame of ours, as the frame registry holds it. */
  topFrame(tabId: number): Promise<Pick<FrameEntry, 'frameId' | 'documentId'> | null>;
  /** One message to one frame of a tab: its answer, or a throw when it cannot be reached. */
  send(tabId: number, message: unknown, target: { frameId: number; documentId?: string }): Promise<unknown>;
  /** The agent lets go of its tab before closing it: run/cancel and the person's own settings to its frames. */
  release(tabId: number): Promise<void>;
  /** The task's job and resume for its tab (JobCards.assign). */
  assign(tabId: number, applicationKey: string, task: AgentTask): void;
  /** The status changed (the panels and the options page read it again). */
  changed(): void;
  /** The day a time falls on in this browser's time zone, YYYY-MM-DD (the tally's day). */
  dayOf?(ms: number): string;
  /** How long the new window rests on its empty page before the job's address is opened in it (0 by default; the e2e
   *  build waits for its test browser to route the new page first, so no request of it can reach a real site). */
  windowSettleMs?: number;
}

/** A failure TailorIT may answer differently later: the result is kept and sent again. */
const PASSING: ReadonlySet<ServerFailure> = new Set(['unreachable', 'timeout', 'server-error', 'rate-limited',
  'not-connected', 'version-mismatch']);
/** The refusals that drop even a submitted result (the job, or the body, is not one TailorIT can take): every other
 *  answer keeps it, so a sent form is never lost. */
const DROPS_SUBMITTED: ReadonlySet<ServerFailure> = new Set(['not-found', 'bad-request', 'refused-path']);

/** The local day of `ms`, YYYY-MM-DD. */
function localDay(ms: number): string {
  const at = new Date(ms);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
}

/** The application key of an address (the adapters' reading), or null. */
function applicationKeyOf(url: string): string | null {
  try {
    return applicationOf(new URL(url))?.applicationKey ?? null;
  } catch {
    return null;
  }
}

/** The address the agent opens for a task's `url`: the canonical application address the agent fills
 *  (agentApplicationUrl), https on an applicant-tracking host, with an application key; null when there is none. */
export function agentAddressOf(url: string): { address: string; applicationKey: string } | null {
  const address = agentApplicationUrl(url);
  if (address === null || platformOfUrl(address) === null) return null;
  const applicationKey = applicationKeyOf(address);
  return applicationKey === null ? null : { address, applicationKey };
}

/** The agent of this worker. */
export function createAgent(deps: AgentDeps) {
  const queue = createKeyedQueue();
  const dayOf = deps.dayOf ?? localDay;
  /** No browser window of the person's was open at the last look (memory only). */
  let noWindow = false;
  /** The next tick already scheduled by a timer (memory only: the alarm covers a stopped worker). */
  let soon: (() => void) | null = null;
  /** The browser session's nonce, once read (storage.session holds it across worker restarts). */
  let heldNonce: string | null = null;

  const serial = <T>(task: () => Promise<T>) => queue.run('agent', task);

  async function read<T>(area: StorageArea, key: string, schema: z.ZodType<T>, fallback: T): Promise<T> {
    const parsed = schema.safeParse(await area.get(key));
    return parsed.success ? parsed.data : fallback;
  }
  const switchOf = () => read<AgentSwitch>(deps.local, AGENT_SWITCH_KEY, SwitchSchema, { on: false, confirmed: false });
  const runOf = () => read<AgentRun | null>(deps.local, AGENT_RUN_KEY, RunSchema.nullable(), null);
  const tallyOf = () => read<AgentTally | null>(deps.local, AGENT_TALLY_KEY, TallySchema.nullable(), null);
  const pollOf = () => read<AgentPoll>(deps.session, AGENT_POLL_KEY, PollSchema, { nextAt: 0, misses: 0 });
  const saveRun = (run: AgentRun | null) => (run === null ? deps.local.remove([AGENT_RUN_KEY])
    : deps.local.set({ [AGENT_RUN_KEY]: run }));
  const savePoll = (poll: AgentPoll) => deps.session.set({ [AGENT_POLL_KEY]: poll });
  const guessesOf = (run: AgentRun) => Object.values(run.guesses).reduce((sum, count) => sum + count, 0);

  /** This browser session's nonce: storage.session's, made when it holds none (a browser restart empties it). */
  async function sessionNonce(): Promise<string> {
    if (heldNonce !== null) return heldNonce;
    const stored = await deps.session.get(AGENT_SESSION_KEY);
    if (typeof stored === 'string' && NONCE.test(stored)) {
      heldNonce = stored;
      return stored;
    }
    const made = deps.nonce();
    await deps.session.set({ [AGENT_SESSION_KEY]: made });
    heldNonce = made;
    return made;
  }

  /** Whether the run's tab and window ids are this browser session's (a run not opened yet has none). */
  async function ofThisSession(run: AgentRun): Promise<boolean> {
    return run.session !== null && run.session === (await sessionNonce());
  }

  /** Whether a result may be told now: a connection that holds agent:run. */
  async function mayTell(): Promise<boolean> {
    return (await deps.scopes())?.includes('agent:run') === true;
  }

  /** Why the agent may not run now, or null. */
  async function blockOf(): Promise<Exclude<AgentBlock, 'no-window'> | null> {
    const scopes = await deps.scopes();
    if (scopes === null) return 'not-connected';
    if (!scopes.includes('agent:run')) return 'no-scope';
    if (!(await deps.disclosed())) return 'disclosure';
    return null;
  }

  /** The job running now in a tab of this session, while the agent may run (the switch on, nothing blocked): null
   *  otherwise. Its tab is the agent's only then. */
  async function activeRun(): Promise<AgentRun | null> {
    const run = await runOf();
    if (run === null || run.result !== null || run.tabId === null || !(await ofThisSession(run))) return null;
    if (!(await switchOf()).on || (await blockOf()) !== null) return null;
    return run;
  }

  /** Takes the next tick in `ms` (one at a time, while the worker is awake; the alarm covers the rest). */
  function tickIn(ms: number): void {
    soon?.();
    soon = deps.timers.after(ms, () => {
      soon = null;
      void tick().catch(() => undefined);
    });
  }

  async function status(): Promise<AgentStatus> {
    const [on, run, tally, blocked] = [await switchOf(), await runOf(), await tallyOf(), await blockOf()];
    const today = dayOf(deps.now());
    const running = run !== null && run.result === null;
    const block: AgentBlock | null = blocked ?? (on.on && !running && noWindow ? 'no-window' : null);
    return {
      on: on.on,
      confirmed: on.confirmed,
      phase: !on.on ? 'off' : running ? 'running' : block !== null ? 'blocked' : 'waiting',
      blocked: on.on ? block : blocked,
      allowed: blocked === null,
      pending: run !== null && run.result !== null,
      job: running ? { company: run.company, title: run.title } : null,
      doneToday: tally !== null && tally.day === today ? tally.done : 0,
      last: tally?.last ?? null,
    };
  }

  /** Lets go of the run's tab and closes it: only a tab of this session that is still there, never a window. */
  async function release(run: AgentRun): Promise<void> {
    if (run.tabId === null || !(await ofThisSession(run))) return;
    if (!(await deps.windows.tabExists(run.tabId))) return;
    await deps.release(run.tabId).catch(() => undefined);
    await deps.windows.closeTab(run.tabId).catch(() => undefined);
  }

  /** Keeps the alarm while there is a reason to wake: Run auto-apply on, or a result not told yet. */
  async function keepAlarm(): Promise<void> {
    const pending = (await runOf())?.result != null;
    if ((await switchOf()).on || pending) await deps.alarms.start(AGENT_ALARM, AGENT_TICK_MINUTES).catch(() => undefined);
    else await deps.alarms.stop(AGENT_ALARM).catch(() => undefined);
  }

  /** The job's result: kept, its tab released and closed, then told to TailorIT (reportResult). */
  async function finishRun(run: AgentRun, state: AutofillAgentFinishedState, reason: AutofillAgentReason | null):
    Promise<boolean> {
    const done: AgentRun = { ...run, result: { state, reason, aiGuesses: guessesOf(run) }, waiting: null };
    await saveRun(done);
    log('agent.finished', { state: AUTOFILL_AGENT_FINISHED_STATES.indexOf(state),
      reason: reason === null ? -1 : AUTOFILL_AGENT_REASONS.indexOf(reason) });
    await release(done);
    if (!(await mayTell())) {
      await keepAlarm();
      deps.changed();
      return false;
    }
    return reportResult(done);
  }

  /** POST …/result for a finished job: answers whether TailorIT took it. Taken, or refused for good: the job is over,
   *  counted, and the next is taken soon. A submitted result is kept for every refusal but 404 and 400; any other result
   *  for TailorIT's failure or none (offline): kept, and sent again at the next tick. */
  async function reportResult(run: AgentRun): Promise<boolean> {
    const result = run.result;
    if (result === null) return false;
    const answer = await deps.server.agentResult(run.id, { state: result.state, reason: result.reason,
      aiGuesses: Math.min(result.aiGuesses, 1000) });
    const kept = !answer.ok && (result.state === 'submitted' ? !DROPS_SUBMITTED.has(answer.failure)
      : PASSING.has(answer.failure));
    if (kept) {
      log('agent.report-failed', { status: answer.ok ? 0 : answer.status ?? 0 });
      await keepAlarm();
      deps.changed();
      return false;
    }
    if (!answer.ok) log('agent.report-failed', { status: answer.status ?? 0, dropped: true });
    await saveRun(null);
    const day = dayOf(deps.now());
    const tally = await tallyOf();
    await deps.local.set({ [AGENT_TALLY_KEY]: { day, done: (tally?.day === day ? tally.done : 0) + 1,
      last: { state: result.state, reason: result.reason } } satisfies AgentTally });
    await savePoll({ nextAt: 0, misses: 0 });
    await keepAlarm();
    deps.changed();
    if ((await switchOf()).on) tickIn(AGENT_NEXT_MS);
    return answer.ok;
  }

  /** A record of another browser session: its tab and window ids name nothing of the agent's now (a browser restart).
   *  The job is the person's; nothing is closed. Answers the run as it stands after. */
  async function adopt(run: AgentRun | null): Promise<AgentRun | null> {
    if (run === null || run.result !== null || run.tabId === null || (await ofThisSession(run))) return run;
    log('agent.finished', { stale: true });
    await finishRun({ ...run, tabId: null, windowId: null, session: null }, 'needs-you', 'cancelled');
    return runOf();
  }

  /** Opens the job's address in its own unfocused window: the window first (its ids and session kept before anything
   *  loads), then the address. */
  async function open(run: AgentRun, address: string): Promise<void> {
    const opened = await deps.windows.open();
    if (opened === null) {
      log('agent.open-failed');
      await finishRun(run, 'failed', 'page_error');
      return;
    }
    const now = deps.now();
    const placed: AgentRun = { ...run, session: await sessionNonce(), windowId: opened.windowId, tabId: opened.tabId,
      openedAt: now, progressAt: now };
    await saveRun(placed);
    const settle = deps.windowSettleMs ?? 0;
    if (settle > 0) await new Promise<void>((done) => void deps.timers.after(settle, done));
    if (!(await deps.windows.navigate(opened.tabId, address))) {
      log('agent.open-failed', { navigated: false });
      await finishRun(placed, 'needs-you', 'cancelled');
      return;
    }
    log('agent.opened');
    deps.changed();
    // While the worker is awake, the page's load is looked at again when it is due.
    deps.timers.after(AGENT_FORM_WAIT_MS + 100, () => void tick().catch(() => undefined));
  }

  /** Takes the next job, past the backoff and while a window of the person's is open. */
  async function claim(): Promise<void> {
    const now = deps.now();
    const poll = await pollOf();
    if (poll.nextAt > now) return;
    if (!(await deps.windows.othersOpen(null))) {
      if (!noWindow) deps.changed();
      noWindow = true;
      return;
    }
    if (noWindow) deps.changed();
    noWindow = false;
    const answer = await deps.server.agentNext();
    if (!answer.ok || answer.value.item === null) {
      const misses = poll.misses + 1;
      await savePoll({ nextAt: now + AGENT_BACKOFF_MS[Math.min(misses, AGENT_BACKOFF_MS.length) - 1]!, misses });
      if (answer.ok) log('agent.empty', { misses });
      else log('agent.next-failed', { status: answer.status ?? 0 });
      deps.changed();
      return;
    }
    const item = answer.value.item;
    await savePoll({ nextAt: 0, misses: 0 });
    const target = agentAddressOf(item.url);
    const run: AgentRun = { id: item.id, applicationKey: target?.applicationKey ?? 'unknown:0000000000000000',
      jobId: item.jobId, resumeId: item.resumeId, company: item.company.slice(0, 200), title: item.title.slice(0, 300),
      session: null, windowId: null, tabId: null, claimedAt: now, openedAt: null, heardAt: null, formAt: null,
      progressAt: now, lastReportAt: null, starts: 0, started: [], entered: [], pressedAt: null, pressedDoc: null,
      heldAt: null, retried: false, staleRunId: null, guesses: {}, waiting: null, result: null };
    await saveRun(run);
    log('agent.claimed');
    deps.changed();
    if (target === null) {
      await finishRun(run, 'failed', 'unsupported_site');
      return;
    }
    await open(run, target.address);
  }

  /** The running job, at a tick: its window opened (a claim a stopped worker left unopened: TailorIT gives its row
   *  back), its tab still there, within its time, its page loaded, its confirmation come; then its reports. */
  async function watch(run: AgentRun): Promise<void> {
    const now = deps.now();
    if (run.tabId === null) {
      const again = await deps.server.agentNext();
      if (!again.ok) return;
      const item = again.value.item;
      if (item === null || item.id !== run.id) {
        // Another job, or none: this one is no longer running for this browser (TailorIT left it for the person).
        await saveRun(null);
        if (item !== null) log('agent.claimed', { other: true });
        deps.changed();
        tickIn(AGENT_NEXT_MS);
        return;
      }
      const target = agentAddressOf(item.url);
      if (target === null || target.applicationKey !== run.applicationKey) {
        await finishRun(run, 'failed', 'unsupported_site');
        return;
      }
      await open(run, target.address);
      return;
    }
    if (!(await deps.windows.tabExists(run.tabId))) {
      // Closed (by the person): nothing of it to close.
      await finishRun({ ...run, tabId: null, windowId: null }, 'needs-you', 'cancelled');
      return;
    }
    if (now - run.claimedAt >= AGENT_JOB_MAX_MS) {
      await finishRun(run, 'needs-you', 'timed_out');
      return;
    }
    if (run.formAt === null && run.openedAt !== null && now - run.openedAt >= AGENT_FORM_WAIT_MS) {
      // A page said hello and never showed a form (its posting gone, a page that says so): closed. None: not loaded.
      await finishRun(run, 'failed', run.heardAt !== null ? 'posting_closed' : 'page_error');
      return;
    }
    if (run.heldAt !== null && now - run.heldAt >= AGENT_CONFIRM_MS) {
      await finishRun(run, run.retried ? 'failed' : 'needs-you', run.retried ? 'validation_error' : 'other');
      return;
    }
    // Its report first: a run at work is progress (its AI answers awaited, its waits stretched in a hidden window), even
    // when the worker slept through its reports. Then the time without progress.
    await evaluate(run);
    const after = await runOf();
    if (after !== null && after.id === run.id && after.result === null && now - after.progressAt >= AGENT_JOB_TIMEOUT_MS) {
      await finishRun(after, 'needs-you', 'timed_out');
    }
  }

  /** Reads the agent's tab's top report and acts on its verdict. */
  async function evaluate(run: AgentRun): Promise<void> {
    if (run.tabId === null || run.result !== null) return;
    const reports = await deps.reports(run.tabId);
    const top = reports.find((report) => report.frameId === 0)
      ?? [...reports].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (top === undefined || top.runId === run.staleRunId) return;
    const now = deps.now();
    const step = String(Math.min(top.step?.index ?? 0, 999));
    const guesses = top.fields.filter((row) => row.wrote && row.reason === 'ai-guess').length;
    const verdict = agentVerdict(top, { retried: run.retried });
    // Progress: a report not read before, or a run at work (its AI answers awaited, its waits stretched in a hidden
    // window); never a run done, or a Submit's confirmation awaited (AGENT_JOB_MAX_MS and AGENT_CONFIRM_MS bound those).
    const working = verdict.kind === 'wait' && top.status !== 'done' && top.buttons?.pressed !== 'submit';
    const fresh = top.updatedAt !== run.lastReportAt || working;
    // A report saying the Submit was pressed, before its arm was heard: pressed in the top document there now.
    const pressedNow = top.buttons?.pressed === 'submit' && run.pressedAt === null;
    const next: AgentRun = {
      ...run,
      guesses: guesses > (run.guesses[step] ?? 0) ? { ...run.guesses, [step]: guesses } : run.guesses,
      lastReportAt: top.updatedAt,
      progressAt: fresh ? now : run.progressAt,
      pressedAt: pressedNow ? now : run.pressedAt,
      pressedDoc: pressedNow ? (await deps.topFrame(run.tabId))?.documentId ?? null : run.pressedDoc,
    };
    switch (verdict.kind) {
      case 'wait':
        await saveRun({ ...next, waiting: null });
        return;
      case 'finish':
        await finishRun(next, verdict.state, verdict.reason);
        return;
      case 'retry': {
        await saveRun({ ...next, retried: true, staleRunId: top.runId, waiting: null });
        const frame = await deps.topFrame(run.tabId);
        log('agent.retried');
        const answer = await sendTo(run.tabId, frame, { v: 1, type: 'run/start', dryRun: false, agent: true, retry: true });
        if ((answer as { ok?: unknown } | undefined)?.ok !== true) {
          await finishRun((await runOf()) ?? next, 'failed', 'validation_error');
        }
        return;
      }
      case 'settle':
      case 'sign-in': {
        const limit = verdict.kind === 'settle' ? AGENT_SETTLE_MS : AGENT_SIGN_IN_WAIT_MS;
        const held = run.waiting;
        if (held !== null && held.kind === verdict.kind && held.updatedAt === top.updatedAt) {
          if (now - held.at >= limit) {
            await finishRun(next, 'needs-you', verdict.kind === 'settle' ? 'other' : 'sign_in');
          } else {
            await saveRun(next);
          }
          return;
        }
        await saveRun({ ...next, waiting: { kind: verdict.kind, at: now, updatedAt: top.updatedAt } });
        const tabId = run.tabId;
        deps.timers.after(limit + 100, () => void reported(tabId).catch(() => undefined));
        return;
      }
    }
  }

  /** One message to the tab's top frame of ours (its document, when known); undefined when it could not be reached. */
  async function sendTo(tabId: number, frame: Pick<FrameEntry, 'frameId' | 'documentId'> | null, message: unknown):
    Promise<unknown> {
    const target = frame === null ? { frameId: 0 } : frame.documentId === null ? { frameId: frame.frameId }
      : { frameId: frame.frameId, documentId: frame.documentId };
    try {
      return await deps.send(tabId, message, target);
    } catch {
      log('frame.unreachable');
      return undefined;
    }
  }

  /** A tick (the alarm, a timer, the switch, start-up): a result waiting to be told; off or blocked, the running job
   *  left for the person; the running job looked at; or the next one taken. */
  async function tick(): Promise<void> {
    await serial(async () => {
      const on = await switchOf();
      const run = await adopt(await runOf());
      if (run !== null && run.result !== null) {
        if (await mayTell()) await reportResult(run);
        else await keepAlarm();
        return;
      }
      const blocked = await blockOf();
      if (!on.on || blocked !== null) {
        if (blocked !== null) log('agent.blocked', { connected: blocked !== 'not-connected', scope: blocked !== 'no-scope' });
        if (run !== null) await finishRun(run, 'needs-you', 'cancelled');
        else await keepAlarm();
        return;
      }
      if (run !== null) await watch(run);
      else await claim();
    });
  }

  /** The tab's reports changed (report/put, report/live): the agent's own tab's are read. */
  async function reported(tabId: number): Promise<void> {
    await serial(async () => {
      const run = await activeRun();
      if (run === null || run.tabId !== tabId) return;
      await evaluate(run);
    });
  }

  /** Options › Run auto-apply. On only while allowed, with the person's one-time confirmation; off leaves the job
   *  running now for the person. */
  async function set(on: boolean, confirmed: boolean): Promise<Answer<AgentStatus>> {
    await serial(async () => {
      const held = await switchOf();
      if (!on) {
        await deps.local.set({ [AGENT_SWITCH_KEY]: { on: false, confirmed: held.confirmed } satisfies AgentSwitch });
        const run = await adopt(await runOf());
        if (run !== null && run.result === null) await finishRun(run, 'needs-you', 'cancelled');
        await keepAlarm();
        log('agent.switched', { on: false });
        return;
      }
      if ((await blockOf()) !== null || (!held.confirmed && !confirmed)) {
        log('agent.refused', { confirmed: held.confirmed || confirmed });
        return;
      }
      await deps.local.set({ [AGENT_SWITCH_KEY]: { on: true, confirmed: true } satisfies AgentSwitch });
      await savePoll({ nextAt: 0, misses: 0 });
      await keepAlarm();
      log('agent.switched', { on: true });
    });
    deps.changed();
    if ((await switchOf()).on) tickIn(0);
    return ok(await status());
  }

  return {
    status,
    tick,
    reported,
    set,

    /** Starts the agent with the worker: the alarm again while it is on or a result waits, and a first look. */
    async start(): Promise<void> {
      await keepAlarm();
      await tick();
    },

    /** The status's Stop: the job running now left for the person, Run auto-apply off. */
    stop: (): Promise<Answer<AgentStatus>> => set(false, false),

    /** The agent's tab, while the agent may run (its job of this session, the switch on, nothing blocked), or null. */
    async tab(): Promise<number | null> {
      return (await activeRun())?.tabId ?? null;
    },

    /** Whether a tab is the agent's now (tab()). */
    async ownsTab(tabId: number): Promise<boolean> {
      return (await activeRun())?.tabId === tabId;
    },

    /** The agent's task for a frame of `tabId` whose application is `applicationKey`, in document `documentId`, or null
     *  when the tab is not the agent's now or the application is not the task's (run/begin, a frame's hello: their
     *  settings and job). */
    async task(tabId: number, applicationKey: string | null | undefined, documentId?: string | null):
      Promise<AgentDocumentTask | null> {
      const run = await activeRun();
      if (run === null || run.tabId !== tabId || applicationKey !== run.applicationKey) return null;
      const submitHeld = run.pressedAt !== null && (run.pressedDoc === null || documentId !== run.pressedDoc);
      return { jobId: run.jobId, resumeId: run.resumeId, submitHeld };
    },

    /** A frame of the agent's tab said hello: another posting's page (or one that names none: a closed posting) ends
     *  the job; a form's document gets its run (once each, at most AGENT_MAX_STARTS, never after the job's Submit); one
     *  with no form its entry (once each, at most AGENT_MAX_ENTRIES), never the platform's page after submitting. */
    async hello(tabId: number, entry: Pick<FrameEntry, 'frameId' | 'documentId' | 'hasForm' | 'posting' | 'confirmation'
      | 'applicationKey'>): Promise<void> {
      await serial(async () => {
        const run = await activeRun();
        if (run === null || run.tabId !== tabId || entry.frameId !== 0) return;
        if (entry.applicationKey === undefined) {
          // An address on the platform's host that names no posting: the board, or its "not found" (a closed posting).
          await finishRun(run, 'failed', 'posting_closed');
          return;
        }
        if (entry.applicationKey !== run.applicationKey) {
          // Another posting's page (a redirect, a link followed): never filled.
          await finishRun(run, 'needs-you', 'other');
          return;
        }
        const doc = entry.documentId ?? '';
        const now = deps.now();
        const heard: AgentRun = { ...run, heardAt: run.heardAt ?? now, progressAt: now };
        deps.assign(tabId, run.applicationKey, { jobId: run.jobId, resumeId: run.resumeId });
        if (entry.hasForm) {
          const shown: AgentRun = { ...heard, formAt: run.formAt ?? now };
          if (run.started.includes(doc)) {
            await saveRun(shown);
            return;
          }
          if (run.pressedAt !== null) {
            // One Submit per job: a form that shows again after it is never filled again; its confirmation is awaited.
            await saveRun({ ...shown, heldAt: run.heldAt ?? now });
            deps.timers.after(AGENT_CONFIRM_MS + 100, () => void tick().catch(() => undefined));
            return;
          }
          if (run.starts >= AGENT_MAX_STARTS) {
            await finishRun(shown, 'needs-you', 'other');
            return;
          }
          await saveRun({ ...shown, starts: run.starts + 1, started: [...run.started, doc].slice(-AGENT_MAX_STARTS) });
          log('agent.run-started');
          await sendTo(tabId, entry, { v: 1, type: 'run/start', dryRun: false, agent: true });
          return;
        }
        if (entry.confirmation === true || run.entered.includes(doc)) {
          await saveRun(heard);
          return;
        }
        if (run.entered.length >= AGENT_MAX_ENTRIES) {
          await finishRun(heard, 'failed', 'page_error');
          return;
        }
        await saveRun({ ...heard, entered: [...run.entered, doc] });
        const answer = await sendTo(tabId, entry, { v: 1, type: 'agent/enter' });
        const data = (answer as { ok?: boolean; data?: EntryAnswer } | undefined)?.data;
        log('agent.entered', { pressed: data?.outcome === 'pressed' });
        // A CAPTCHA, a sign-in or a code before the form: the person's. Not offered (a form drawn late, a page still
        // loading): the form's wait covers it.
        if (data?.outcome === 'blocked') {
          const result = ENTRY_RESULTS[data.block ?? 'other'];
          await finishRun((await runOf()) ?? heard, result.state, result.reason);
        }
      });
    },

    /** A Submit of the task's application was pressed (armed) in the agent's tab, in document `documentId`: the job's
     *  one Submit (its first press, and where it was pressed, are kept). */
    async pressed(tabId: number, applicationKey: string, documentId?: string | null): Promise<void> {
      await serial(async () => {
        const run = await activeRun();
        if (run === null || run.tabId !== tabId || run.applicationKey !== applicationKey) return;
        const first = run.pressedAt === null;
        await saveRun({ ...run, pressedAt: first ? deps.now() : run.pressedAt,
          pressedDoc: first ? documentId ?? null : run.pressedDoc, progressAt: deps.now() });
      });
    },

    /** The platform confirmed the Submit this tab armed (submissions.ts took its sign): the job is submitted, and
     *  TailorIT marks it Applied with the result. Another posting's sign leaves the job for the person and answers
     *  'not-ours', so it is recorded the normal way; so is any tab but the agent's. */
    async submitted(tabId: number, applicationKey: string): Promise<'not-ours' | 'recorded' | 'not-recorded'> {
      return serial(async () => {
        const run = await adopt(await runOf());
        if (run === null || run.result !== null || run.tabId !== tabId || !(await ofThisSession(run))) return 'not-ours';
        if (run.applicationKey !== applicationKey) {
          await finishRun(run, 'needs-you', 'other');
          return 'not-ours';
        }
        return (await finishRun(run, 'submitted', null)) ? 'recorded' : 'not-recorded';
      });
    },

    /** A tab closed: the agent's, closed by the person, leaves its job for them (nothing left to close). */
    async tabRemoved(tabId: number): Promise<void> {
      await serial(async () => {
        const run = await runOf();
        if (run === null || run.result !== null || run.tabId !== tabId || !(await ofThisSession(run))) return;
        await finishRun({ ...run, tabId: null, windowId: null }, 'needs-you', 'cancelled');
      });
    },

    /** The connection changed or went: Run auto-apply goes off (its confirmation asked again), and the running job is
     *  left for the person, its tab closed; its result waits for a connection to tell it. */
    async tokenChanged(): Promise<void> {
      const changed = await serial(async () => {
        const held = await switchOf();
        const switched = held.on || held.confirmed;
        if (switched) await deps.local.set({ [AGENT_SWITCH_KEY]: { on: false, confirmed: false } satisfies AgentSwitch });
        const run = await runOf();
        const running = run !== null && run.result === null;
        if (running) {
          await saveRun({ ...run, result: { state: 'needs-you', reason: 'cancelled', aiGuesses: guessesOf(run) },
            waiting: null });
          await release(run);
        }
        if (switched || running) await keepAlarm();
        return switched || running;
      });
      if (changed) deps.changed();
    },
  };
}

/** The agent, as index.ts wires it. */
export type Agent = ReturnType<typeof createAgent>;
