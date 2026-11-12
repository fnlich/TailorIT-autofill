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
 *   and reason. v5 p1-rules (PLAN decision 9, like Jobright): an unticked checkbox CAPTCHA holds none of the agent's
 *   presses (its entry, Next, Submit): the site decides, and a press it refuses for the check rests the run at a CAPTCHA
 *   pause (content/orchestrator.ts refusedForCheck), which finishes the job needs-you captcha as before: the agent's
 *   window is unattended, so nobody ticks the box there.
 * - Finish: the result is kept, the agent's tab released (run/cancel and the person's own settings to its frames) and
 *   closed (that tab only, never a window, and never one already gone), and the result told to TailorIT (POST
 *   /api/autofill/agent/:id/result {state, reason, aiGuesses}). A result TailorIT could not take for now is kept and
 *   sent again, while the alarm keeps waking the worker (a submitted one is kept for every refusal but 404 and 400);
 *   one refused for good is dropped. Then the next job is taken.
 * - Wake: a chrome.alarms alarm (AGENT_ALARM, every AGENT_TICK_MINUTES) wakes the worker while Run auto-apply is on, or
 *   a result waits to be told. An empty queue or a failure waits AGENT_BACKOFF_MS (a minute, then five).
 * - An outage never drains the queue (the audit of 2026-11-06, M5): while the browser says it is offline no job is
 *   taken (blocked, offline); a page that never loaded is page_error, never a closed posting (closed only where the
 *   tab's address is a page of the platform's host that names no posting); and the agent pauses itself, Run auto-apply
 *   off with the reason said (AGENT_PAUSES), when Chrome opens no window for a job (that job is left for the person,
 *   needs-you cancelled) or after AGENT_MAX_PAGE_ERRORS jobs in a row ended page_error. The person turns it on again.
 * - Stop: Stop, Run auto-apply turned off, the person closing the tab, the agent blocked (a disclosure to acknowledge,
 *   a connection without agent:run, none) leave the running job for the person (needs-you, cancelled). A changed or
 *   dropped connection does too, and turns Run auto-apply off (its confirmation asked again). The person closing the
 *   agent's tab or window is their Stop (the audit's m14): the agent pauses (window-closed) until they turn Run
 *   auto-apply on again, so no next job opens by itself.
 * - The snapshot build of 2026-11-06 (core-x, item 3; docs/ARCHITECTURE.md, the snapshot build of 2026-11-06): where the tab's top frame is a company's
 *   wrapper that draws the application in a frame of its own (its hello's `wraps`: an iCIMS portal's
 *   iframe#icims_content_iframe), "the top frame" above is that frame, the one that claims the application (frames.ts
 *   claimFrameOf: its hello's `claimed`, on the wrapper's origin and at its application), and a chain frame it framed
 *   (agentFramesOf): its run, its entry, its report, its retry and its Submit's document are there, never the
 *   wrapper's. Any other subframe is never acted on.
 * Commands come only from the worker's own poll of TailorIT with its token: no page, frame or message can start the
 * agent, choose its job or make it submit. Nothing here logs a job, an address or a value: states and reasons are
 * logged as their places in the contract's lists.
 */
import { z } from 'zod';
import { applicationOf, platformAdapter } from '../adapters';
import {
  agentApplicationUrl, AUTOFILL_AGENT_FINISHED_STATES, AUTOFILL_AGENT_REASONS, AutofillAgentIdSchema,
  queueApplicationUrl, type AutofillAgentFinishedState, type AutofillAgentReason,
} from '../contract/tailorit';
import { ok, type Answer } from '../messaging/envelope';
import {
  AGENT_NOTES, type AgentBlock, type AgentNote, type AgentPause, type AgentStatus, type EntryAnswer, type EntryBlock,
} from '../messaging/schemas';
import { AGENT_PAUSES } from '../messaging/page-schemas';
import type { AgentAlarms, AgentWindows, AtsPage, StorageArea } from '../platform/types';
import { staticPlatformOfUrl } from '../shared/hosts';
import { log } from '../shared/log';
// jr7 ICIMS-7 (merge of jr7-auto-done with jr7-engine-e2): the hand-overs the hello's schema says (AGENT_NOTES' kinds),
// not adapters/types.ts HandOverKind, which E2 widened ('documents', not wired yet).
type HandOverKind = AgentNote;
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
/** A page of an ATS host that names no posting is looked at again this long after its load before the job is answered
 *  (round 3 of the v3 Phase 6/7b review, X8): a page's script may route on at once, a board to its posting. */
export const AGENT_LOAD_SETTLE_MS = 1_500;
/** Entry presses (Apply, Application) per job: a posting that keeps showing itself is not pressed forever. */
export const AGENT_MAX_ENTRIES = 2;
/** Runs started per job (one per document of the form): a form that keeps loading again is not filled forever. jr7
 *  AUTO-7 (AUTO7-15, FIX7PLAN D-9): 12, as iCIMS's applications show 5 and 6 form documents (gate, profile and its
 *  résumé reload, questions, EEO, IForm, Assessments: snapshot7 iCIMS1 and icims3), and a reload on a refusal or a
 *  two-page IForm packet adds more. */
export const AGENT_MAX_STARTS = 12;
/** Jobs in a row ended page_error before the agent pauses itself (the audit of 2026-11-06, M5): pages that do not load
 *  one after another are an outage, not the jobs', and the queue is not drained through it. */
export const AGENT_MAX_PAGE_ERRORS = 3;

/** storage.local: the switch, the running job, today's tally. storage.session: when the queue is asked next, and the
 *  browser session's nonce. */
export const AGENT_SWITCH_KEY = 'agent';
export const AGENT_RUN_KEY = 'agent:run';
export const AGENT_TALLY_KEY = 'agent:day';
export const AGENT_POLL_KEY = 'agent:poll';
export const AGENT_SESSION_KEY = 'agent:session';
/** storage.session: how many jobs in a row ended page_error (a count; M5). */
export const AGENT_ERRORS_KEY = 'agent:errors';

const Count = z.number().int().nonnegative();
const ResultSchema = z.strictObject({
  state: z.enum(AUTOFILL_AGENT_FINISHED_STATES),
  reason: z.enum(AUTOFILL_AGENT_REASONS).nullable(),
  /** jr7 AUTO-7 (ICIMS7-04): why, in the extension's own words, beside the contract's reason: the application went on
   *  with a step that is the person's by design (Adapter.handOver). */
  note: z.enum(AGENT_NOTES).optional(),
});
const NONCE = /^[A-Za-z0-9_-]{8,64}$/;

/** Run auto-apply, whether the person gave the one-time confirmation, and, while it is off because the agent paused
 *  itself (M5, m14), why. */
const SwitchSchema = z.strictObject({ on: z.boolean(), confirmed: z.boolean(), paused: z.enum(AGENT_PAUSES).optional() });
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
  /** Runs started (and their documents, Chrome's ids), and the documents whose entry was asked for. */
  starts: Count,
  started: z.array(z.string().max(100)).max(AGENT_MAX_STARTS),
  entered: z.array(z.string().max(100)).max(AGENT_MAX_ENTRIES),
  /** When an entry first answered 'pressed' (the v3 Phase 6/7b review's round 2, K4: the job has begun); absent in a
   *  run kept before it. */
  pressedEntryAt: Count.nullable().optional(),
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
  // ── jr7 AUTO-7 (FIX7PLAN §6.4) ──
  /** AUTO7-03: the entry answered that it offered nothing, and whether an adapter of the page declares an entry at all
   *  (not declared: the agent cannot press this site's Apply, unsupported_site; declared and not found: a closed
   *  posting, as before). */
  notOffered: z.strictObject({ declared: z.boolean() }).nullable().optional(),
  /** AUTO7-10: the latest hello of a frame the agent acts in (the form's wait counts from it too). */
  helloAt: Count.nullable().optional(),
  /** AUTO7-08: what the hold after the job's Submit waits on: a form that showed again ('form': other, or
   *  validation_error after the retry, as before), or a page after the Submit that names no application of the task or
   *  another one ('page': its sign is waited for, then timed_out: it may have been sent). */
  heldKind: z.enum(['form', 'page']).optional(),
  // ── end jr7 AUTO-7 ──
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
 *   rules' notices (no-AI posting: skipped posting_forbids_ai; then a bot check asked as a question, the audit's S-2
 *   and S-3: needs-you captcha; a required field empty: needs-you required_field_empty;
 *   an AI-guessed legal answer: needs-you ai_guess_legal), a CAPTCHA (needs-you captcha), a sign-in (needs-you sign_in),
 *   the page refusing the Submit pressed (one retry, then failed validation_error), errors the page showed before
 *   anything was written (needs-you validation_error: the behaviour review of 2026-11-06, minor 7), other errors shown
 *   before any Submit (failed validation_error: the run's own fix pass came first), a Submit no confirmation followed
 *   (needs-you other),
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
        case 'forgot-password':
          return finish('needs-you', 'sign_in');
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
  // The audit of 2026-11-06 (S-2, S-3): a bot check asked as a question is a CAPTCHA, whether or not it is required.
  if (has('bot-check')) return finish('needs-you', 'captcha');
  if (has('submit-held-required')) return finish('needs-you', 'required_field_empty');
  if (has('submit-held-guess')) return finish('needs-you', 'ai_guess_legal');
  if (has('submit-held-attention') || has('submit-held-entries')) return finish('needs-you', 'other');
  // v5 p1-rules (PLAN decision 9): these notices now come only from a challenge that is no checkbox widget (a popup, a
  // vendor's frame that reads like one, a bot check); a checkbox widget's refusal is the CAPTCHA pause (handoff above).
  if (has('submit-held-captcha') || has('captcha-next') || has('captcha')) return finish('needs-you', 'captcha');
  if (has('auth')) return finish('needs-you', 'sign_in');
  if (has('submit-errors')) return context.retried ? finish('failed', 'validation_error') : { kind: 'retry' };
  // The behaviour review of 2026-11-06 (minor 7): errors the page showed before anything was written (Oracle's profile
  // item it marks invalid on load) are the person's to fix: needs-you, never the agent's failure.
  if (has('errors-on-load')) return finish('needs-you', 'validation_error');
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
  /** Whether the browser says it is online (navigator.onLine; M5). Absent: online. */
  online?(): boolean;
  /** The tab's reports, as the panels read them. */
  reports(tabId: number): Promise<readonly FrameReport[]>;
  /** What the tab shows by its address (WorkerPlatform tabs.atsPageOf): 'other' for a page on an ATS host that names no
   *  posting, where no frame of ours says hello (round 2, K3), and the host's platform (round 3, X8). Absent: not
   *  known. */
  atsPageOf?(tabId: number): Promise<AtsPage | null>;
  /** The tab's top frame of ours, as the frame registry holds it. */
  topFrame(tabId: number): Promise<Pick<FrameEntry, 'frameId' | 'documentId'> | null>;
  /** The snapshot build of 2026-11-06 (core-x, item 3): the frames the agent acts in for the tab's application besides
   *  its top frame (frames.ts agentFramesOf: the frame that claims a company wrapper's application, and a chain frame
   *  it framed). Absent: the top frame alone. */
  agentFrames?(tabId: number): Promise<FrameEntry[]>;
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
  // ── jr7 AUTO-7 ──
  /** AUTO7-05 (b): the host name of the tab's page, in lower case (WorkerPlatform tabs.hostOf), or null. Absent: not
   *  known. */
  hostOf?(tabId: number): Promise<string | null>;
  /** AUTO7-05 (b): whether `host` is one the platform's own sign-in leaves to (its adapter's identityHosts). Absent:
   *  none is. */
  identityHost?(platform: string, host: string): boolean;
  // ── end jr7 AUTO-7 ──
}

// ── jr7 AUTO-7 ──
/** AUTOV-03: an entry the agent asked for (agent/enter, sent inside serial()), its answer awaited outside it. */
interface PendingEntry {
  runId: string;
  answer: Promise<unknown>;
}
/** storage.session: the windows of jobs the agent left open for the person (jr7-O1 part 4, D-9: a code or a check after
 *  its own Submit; ICIMS7-04: an assessment after it), their ids alone: never counted as a window of the person's. */
export const AGENT_KEPT_KEY = 'agent:kept';
/** The most such windows remembered (the oldest forgotten first). */
export const AGENT_KEPT_MAX = 20;
/** How a finished job's tab goes: closed (as before), or kept for the person (`keepTab`), its window flagged
 *  (windows.update drawAttention, no permission); `note` says why in the extension's words. */
interface FinishOptions {
  keepTab?: boolean;
  note?: AgentNote;
}
// ── end jr7 AUTO-7 ──

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
 *  (agentApplicationUrl), https on an applicant-tracking host, with an application key; null when there is none. The
 *  P2 review (L3): an applicant-tracking host the manifest's script runs on (shared/hosts.ts staticPlatformOfUrl); an
 *  employer's own domain at Oracle's Candidate Experience address is never the agent's (its content script comes only
 *  through the sentinel, once the page shows the app), whether or not the career sites act. */
export function agentAddressOf(url: string): { address: string; applicationKey: string } | null {
  const address = agentApplicationUrl(url);
  if (address === null || staticPlatformOfUrl(address) === null) return null;
  const applicationKey = applicationKeyOf(address);
  return applicationKey === null ? null : { address, applicationKey };
}

// ── jr7 AUTO-7 ──
/** AUTO7-01 (F4b; FIX7PLAN §6.4 item 3): the address the Queue tab opens for a task's `url` the agent does not open:
 *  the contract's queueApplicationUrl (jr7-tailorit-a: the posting, or the form, of a platform the extension fills,
 *  read so that it says hello before any redirect: UltiPro's OpportunityDetail, never OpportunityApply, AUTO7-05 a),
 *  https on an applicant-tracking host the manifest's script runs on, with an application key; null when there is none.
 *  The queue opens agentAddressOf(url) ?? queueAddressOf(url). */
export function queueAddressOf(url: string): { address: string; applicationKey: string } | null {
  const address = queueApplicationUrl(url);
  if (address === null || staticPlatformOfUrl(address) === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(address);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const applicationKey = applicationKeyOf(address);
  return applicationKey === null ? null : { address, applicationKey };
}

/** AUTO7-05 (b, c): whether `host` (lower case) is one `platform`'s own sign-in leaves to: its adapter's identityHosts,
 *  whole-host patterns (a list, never a page read). */
export function identityHostOf(platform: string, host: string): boolean {
  const patterns = platformAdapter(platform)?.identityHosts ?? [];
  return patterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(host);
  });
}
// ── end jr7 AUTO-7 ──

/** The agent of this worker. */
export function createAgent(deps: AgentDeps) {
  const queue = createKeyedQueue();
  const dayOf = deps.dayOf ?? localDay;
  /** No browser window of the person's was open at the last look (memory only). */
  let noWindow = false;
  /** The browser said it was offline at the last look (memory only; M5). */
  let offline = false;
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
  const errorsOf = () => read<number>(deps.session, AGENT_ERRORS_KEY, Count, 0);
  const guessesOf = (run: AgentRun) => Object.values(run.guesses).reduce((sum, count) => sum + count, 0);
  /** Whether the job has begun (the v3 Phase 6/7b review's round 2, K4): an entry answered 'pressed', or a form showed. */
  const begun = (run: AgentRun) => (run.pressedEntryAt ?? null) !== null || run.formAt !== null;

  /**
   * The agent's tab shows a page of an ATS host that names no posting (a hello with no key, or, where no frame says
   * hello, its address at load: round 2, K3). After the job's Submit: nothing yet, its confirmation is awaited. Once it
   * has begun, on the job's own platform: the person's sign-in (a route to Workday's /login, SuccessFactors' post-back
   * showing its sign-in); on another platform, or one not known (round 3, X8), a page the job did not lead to, the
   * person's to look at, never a sign-in. Before it began: the board or its "not found", a closed posting, at once.
   */
  async function noPosting(run: AgentRun, samePlatform: boolean | null): Promise<void> {
    if (run.pressedAt !== null) {
      // jr7 AUTO-7 (AUTO7-08 a): after the job's Submit, a page of its own platform that names no application (UltiPro's
      // ApplicationSubmitted, Oracle's my-profile, iCIMS's Assessments) is held AGENT_CONFIRM_MS for the sign its
      // adapter reads (confirmationAfter), then the person's: timed_out (it may have been sent), never other.
      if (samePlatform === true) await holdForSign(run, 'page');
      return;
    }
    if (begun(run)) {
      await finishRun(run, 'needs-you', samePlatform === true ? 'sign_in' : 'other');
      return;
    }
    await finishRun(run, 'failed', 'posting_closed');
  }

  /** Whether a page of `platform`'s host is the job's own platform's. */
  const onJobPlatform = (run: AgentRun, platform: string) => run.applicationKey.startsWith(`${platform}:`);

  // ── jr7 AUTO-7 ──
  /** AUTO7-08: after the job's Submit, a page whose sign is awaited (`kind`), held from now (once) for
   *  AGENT_CONFIRM_MS: never acted on, never closed meanwhile; its sign (submitted) ends it. */
  async function holdForSign(run: AgentRun, kind: 'form' | 'page'): Promise<void> {
    if (run.heldAt !== null) return;
    await saveRun({ ...run, heldAt: deps.now(), heldKind: kind });
    deps.timers.after(AGENT_CONFIRM_MS + 100, () => void tick().catch(() => undefined));
  }

  /** AUTO7-05 (b): whether the run's tab shows a page on a host its platform's own sign-in leaves to (https, the
   *  adapter's identityHosts: a list, never a page read). */
  async function onIdentityHost(run: AgentRun): Promise<boolean> {
    if (run.tabId === null || deps.hostOf === undefined || deps.identityHost === undefined) return false;
    const host = await deps.hostOf(run.tabId).catch(() => null);
    const platform = run.applicationKey.split(':')[0] ?? '';
    return host !== null && deps.identityHost(platform, host);
  }
  // ── end jr7 AUTO-7 ──

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
    const block: AgentBlock | null = blocked
      ?? (on.on && !running && noWindow ? 'no-window' : on.on && !running && offline ? 'offline' : null);
    return {
      on: on.on,
      confirmed: on.confirmed,
      phase: !on.on ? 'off' : running ? 'running' : block !== null ? 'blocked' : 'waiting',
      blocked: on.on ? block : blocked,
      paused: on.on ? null : on.paused ?? null,
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

  // ── jr7 AUTO-7 (jr7-O1 part 4, D-9 Q-O2; ICIMS7-04) ──
  /** The windows of jobs left open for the person (AGENT_KEPT_KEY). */
  async function keptWindows(): Promise<number[]> {
    const parsed = z.array(z.number().int()).max(AGENT_KEPT_MAX).safeParse(await deps.session.get(AGENT_KEPT_KEY));
    return parsed.success ? parsed.data : [];
  }

  /** Lets go of the run's tab for the person to finish in (a code or a check its own Submit drew, an assessment after
   *  it): run/cancel and the person's settings to its frames (deps.release), never closed; the runtime's armed Submit
   *  stays, so a later sign is recorded the normal way (POST /applied). Its window is flagged and is never counted as
   *  the person's (claim: othersOpen). Only a tab of this session that is still there. */
  async function keep(run: AgentRun): Promise<void> {
    if (run.tabId === null || !(await ofThisSession(run))) return;
    if (!(await deps.windows.tabExists(run.tabId))) return;
    await deps.release(run.tabId).catch(() => undefined);
    if (run.windowId !== null) {
      const kept = (await keptWindows()).filter((id) => id !== run.windowId);
      await deps.session.set({ [AGENT_KEPT_KEY]: [...kept, run.windowId].slice(-AGENT_KEPT_MAX) });
      await deps.windows.drawAttention?.(run.windowId).catch(() => undefined);
    }
  }
  // ── end jr7 AUTO-7 ──

  /** Keeps the alarm while there is a reason to wake: Run auto-apply on, or a result not told yet. */
  async function keepAlarm(): Promise<void> {
    const pending = (await runOf())?.result != null;
    if ((await switchOf()).on || pending) await deps.alarms.start(AGENT_ALARM, AGENT_TICK_MINUTES).catch(() => undefined);
    else await deps.alarms.stop(AGENT_ALARM).catch(() => undefined);
  }

  /** The agent pauses itself (M5, m14): Run auto-apply off, the person's confirmation kept, the reason said, no next
   *  job taken until the person turns it on again. Nothing while it is off already. */
  async function pause(reason: AgentPause): Promise<void> {
    const held = await switchOf();
    if (!held.on) return;
    await deps.local.set({ [AGENT_SWITCH_KEY]: { on: false, confirmed: held.confirmed, paused: reason } satisfies AgentSwitch });
    soon?.();
    soon = null;
    log('agent.paused', { reason: AGENT_PAUSES.indexOf(reason) });
    await keepAlarm();
    deps.changed();
  }

  /** The job's result: kept, its tab released and closed, then told to TailorIT (reportResult). Jobs that end
   *  page_error one after another pause the agent at AGENT_MAX_PAGE_ERRORS (M5). */
  async function finishRun(run: AgentRun, state: AutofillAgentFinishedState, reason: AutofillAgentReason | null,
    options: FinishOptions = {}): Promise<boolean> {
    const done: AgentRun = { ...run, result: { state, reason, aiGuesses: guessesOf(run),
      ...(options.note === undefined ? {} : { note: options.note }) }, waiting: null };
    await saveRun(done);
    log('agent.finished', { state: AUTOFILL_AGENT_FINISHED_STATES.indexOf(state),
      reason: reason === null ? -1 : AUTOFILL_AGENT_REASONS.indexOf(reason), ...(options.keepTab ? { kept: true } : {}) });
    const errors = reason === 'page_error' ? (await errorsOf()) + 1 : 0;
    await deps.session.set({ [AGENT_ERRORS_KEY]: errors >= AGENT_MAX_PAGE_ERRORS ? 0 : errors });
    if (errors >= AGENT_MAX_PAGE_ERRORS) await pause('page-errors');
    // jr7 AUTO-7 (jr7-O1 part 4, ICIMS7-04): a tab the person must finish in is let go of, never closed.
    if (options.keepTab === true) await keep(done);
    else await release(done);
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
      last: { state: result.state, reason: result.reason,
        ...(result.note === undefined ? {} : { note: result.note }) } } satisfies AgentTally }); // jr7 AUTO-7
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
      // The browser would not open a window (M5): nothing of the job was tried, so it is left for the person, and the
      // agent pauses rather than take the next job into the same refusal.
      log('agent.open-failed');
      await pause('no-window');
      await finishRun(run, 'needs-you', 'cancelled');
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
    // jr7 AUTO-7 (jr7-O1 part 4): a window left open for the person after a job is never counted as theirs.
    if (!(await deps.windows.othersOpen(await keptWindows()))) {
      if (!noWindow) deps.changed();
      noWindow = true;
      return;
    }
    if (noWindow) deps.changed();
    noWindow = false;
    // Offline (M5): no job is taken, so none is opened into pages that cannot load; the next look tries again.
    if (deps.online?.() === false) {
      if (!offline) deps.changed();
      offline = true;
      return;
    }
    if (offline) deps.changed();
    offline = false;
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
      // Closed (by the person): their Stop (m14), and nothing of it to close.
      await pause('window-closed');
      await finishRun({ ...run, tabId: null, windowId: null }, 'needs-you', 'cancelled');
      return;
    }
    if (now - run.claimedAt >= AGENT_JOB_MAX_MS) {
      await finishRun(run, 'needs-you', 'timed_out');
      return;
    }
    // jr7 AUTO-7 (AUTO7-10): the form's wait counts from the latest progress before a form: the window's opening, the
    // entry's press, the latest hello, a wait a report began (a sign-in at work); AGENT_JOB_MAX_MS still bounds it.
    const formSince = Math.max(run.openedAt ?? 0, run.pressedEntryAt ?? 0, run.helloAt ?? 0, run.waiting?.at ?? 0);
    if (run.formAt === null && run.openedAt !== null && now - formSince >= AGENT_FORM_WAIT_MS) {
      // The tab's address names a page of the platform's host that shows no posting (which says no hello: the v3 Phase
      // 6/7b review, S3): a closed posting, or, once the job has begun, the person's sign-in on the job's own platform
      // (round 2, E8; noPosting). A page that said hello and never showed a form (its posting gone, a page that says
      // so): closed before the job began, the person's after. Anything else, the tab still at the posting's or its
      // form's address included, never loaded: page_error, never a closed posting (the audit of 2026-11-06, M5).
      const shown = deps.atsPageOf === undefined ? null : await deps.atsPageOf(run.tabId).catch(() => null);
      if (shown?.page === 'other') {
        await noPosting(run, onJobPlatform(run, shown.platform));
        return;
      }
      if (run.heardAt !== null) {
        // jr7 AUTO-7 (AUTO7-05 b): once the job began, a tab on a host the job's platform's own sign-in leaves to
        // (its adapter's identityHosts: UKG's signin-us.ultipro.com) is the person's sign-in, never 'other'.
        if (begun(run) && await onIdentityHost(run)) {
          await finishRun(run, 'needs-you', 'sign_in');
          return;
        }
        // jr7 AUTO-7 (AUTO7-03): an entry no adapter of the page declares is one the agent cannot press: the site is
        // not one it fills unattended (unsupported_site); declared and not found, a closed posting, as before.
        if (!begun(run) && run.notOffered?.declared === false) {
          await finishRun(run, 'needs-you', 'unsupported_site');
          return;
        }
        await finishRun(run, begun(run) ? 'needs-you' : 'failed', begun(run) ? 'other' : 'posting_closed');
        return;
      }
      await finishRun(run, 'failed', 'page_error');
      return;
    }
    if (run.heldAt !== null && now - run.heldAt >= AGENT_CONFIRM_MS) {
      // jr7 AUTO-7 (AUTO7-08): a page after the Submit whose sign never came: it may have been sent (timed_out).
      if (run.heldKind === 'page') await finishRun(run, 'needs-you', 'timed_out');
      else await finishRun(run, run.retried ? 'failed' : 'needs-you', run.retried ? 'validation_error' : 'other');
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
    // core-x, item 3: the top frame's report, else the latest of the frames the agent acts in (a wrapper's application
    // frame), else the latest.
    const frames = (await deps.agentFrames?.(run.tabId).catch(() => [])) ?? [];
    const latest = (list: readonly FrameReport[]) => [...list].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const top = reports.find((report) => report.frameId === 0)
      ?? latest(reports.filter((report) => frames.some((frame) => frame.frameId === report.frameId)))
      ?? latest(reports);
    /** The frame that report came from, as the registry holds it (its document), for a retry and the job's Submit. */
    const tabId = run.tabId;
    const reportFrame = async () => frames.find((frame) => frame.frameId === top?.frameId)
      ?? (top?.frameId === 0 || top === undefined ? await deps.topFrame(tabId) : { frameId: top.frameId, documentId: null });
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
      pressedDoc: pressedNow ? (await reportFrame())?.documentId ?? null : run.pressedDoc,
    };
    switch (verdict.kind) {
      case 'wait':
        await saveRun({ ...next, waiting: null });
        return;
      case 'finish':
        // jr7 AUTO-7 (jr7-O1 part 4, D-9 Q-O2): a code or a check the job's own Submit drew keeps its tab for the person
        // (never closed, never typed); its sign, when it comes, is recorded the normal way.
        await finishRun(next, verdict.state, verdict.reason, { keepTab: next.pressedAt !== null
          && (verdict.reason === 'email_code' || verdict.reason === 'captcha') });
        return;
      case 'retry': {
        await saveRun({ ...next, retried: true, staleRunId: top.runId, waiting: null });
        // The security fix of 2026-11-06 (S12): the retry goes to the report's frame only when it is one the agent
        // acts in (agentFramesOf) or the top frame; a report from any other subframe retries in the top frame, never
        // in that subframe.
        const frame = frames.find((each) => each.frameId === top.frameId) ?? await deps.topFrame(tabId);
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
        // The person's own off: a pause the agent made is theirs now, and its reason goes.
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
      await deps.session.set({ [AGENT_ERRORS_KEY]: 0 });
      await keepAlarm();
      log('agent.switched', { on: true });
    });
    deps.changed();
    if ((await switchOf()).on) tickIn(0);
    return ok(await status());
  }

  /** A frame the agent acts in said hello (hello: the tab's top frame, or core-x item 3's claim frame and its chain
   *  frame), at the task's application: a form's document gets its run (once each, at most AGENT_MAX_STARTS, never
   *  after the job's Submit); one with no form its entry (once each, at most AGENT_MAX_ENTRIES), never the platform's
   *  page after submitting, nor (minor 13) any page after the job's Submit. Called inside serial().
   *  jr7 AUTO-7 (AUTOV-03): agent/enter is sent here, inside serial(), and its answer is the caller's to await outside
   *  it (entryAnswered then records it in a serial step of its own), so a tick, the person's Stop or a closed tab is
   *  heard while a Sign-in Auto at the posting signs in. ICIMS7-04 (2): after the job's Submit, a step that is the
   *  person's by design (`handOver`: iCIMS's Assessments) ends the job needs-you with its words, its tab kept. */
  async function act(tabId: number, run: AgentRun, entry: Pick<FrameEntry, 'frameId' | 'documentId' | 'hasForm'
    | 'confirmation'>, handOver: HandOverKind | null = null): Promise<PendingEntry | null> {
    const doc = entry.documentId ?? '';
    const now = deps.now();
    const heard: AgentRun = { ...run, heardAt: run.heardAt ?? now, progressAt: now, helloAt: now };
    deps.assign(tabId, run.applicationKey, { jobId: run.jobId, resumeId: run.resumeId });
    // jr7 AUTO-7 (ICIMS7-04 (2)): never timed_out after ten minutes; the person takes the assessment in this tab.
    if (handOver !== null && run.pressedAt !== null) {
      await finishRun(heard, 'needs-you', 'other', { keepTab: true, note: handOver });
      return null;
    }
    if (entry.hasForm) {
      const shown: AgentRun = { ...heard, formAt: run.formAt ?? now };
      if (run.started.includes(doc)) {
        await saveRun(shown);
        return null;
      }
      if (run.pressedAt !== null) {
        // One Submit per job: a form that shows again after it is never filled again; its confirmation is awaited.
        await saveRun(shown);
        await holdForSign(shown, 'form'); // jr7 AUTO-7
        return null;
      }
      if (run.starts >= AGENT_MAX_STARTS) {
        await finishRun(shown, 'needs-you', 'other');
        return null;
      }
      await saveRun({ ...shown, starts: run.starts + 1, started: [...run.started, doc].slice(-AGENT_MAX_STARTS) });
      log('agent.run-started');
      await sendTo(tabId, entry, { v: 1, type: 'run/start', dryRun: false, agent: true });
      return null;
    }
    if (entry.confirmation === true || run.entered.includes(doc)) {
      await saveRun(heard);
      return null;
    }
    if (run.pressedAt !== null) {
      // The behaviour review of 2026-11-06 (minor 13): after the job's Submit, a page with no form is never entered (an
      // entry pressed there would begin the application again); its confirmation is awaited, as a form's is. jr7 AUTO-7
      // (AUTO7-08 a): a page, so timed_out once AGENT_CONFIRM_MS passed with no sign (it may have been sent).
      await saveRun(heard);
      await holdForSign(heard, 'page');
      return null;
    }
    if (run.entered.length >= AGENT_MAX_ENTRIES) {
      await finishRun(heard, 'failed', 'page_error');
      return null;
    }
    await saveRun({ ...heard, entered: [...run.entered, doc] });
    // jr7 AUTO-7 (AUTOV-03): sent now, inside serial(); answered outside it (entryAnswered).
    return { runId: run.id, answer: sendTo(tabId, entry, { v: 1, type: 'agent/enter' }) };
  }

  /** jr7 AUTO-7 (AUTOV-03): what an entry answered, recorded in a serial step of its own on the run as it stands now
   *  (a Stop, a tick or a closed tab may have finished it meanwhile: nothing then). */
  async function entryAnswered(pending: PendingEntry): Promise<void> {
    const answer = await pending.answer;
    const data = (answer as { ok?: boolean; data?: EntryAnswer } | undefined)?.data;
    log('agent.entered', { pressed: data?.outcome === 'pressed' });
    await serial(async () => {
      const run = await runOf();
      if (run === null || run.id !== pending.runId || run.result !== null) return;
      if (data?.outcome === 'pressed') {
        if ((run.pressedEntryAt ?? null) === null) await saveRun({ ...run, pressedEntryAt: deps.now() });
        return;
      }
      // A CAPTCHA, a sign-in or a code before the form: the person's. Not offered (a form drawn late, a page still
      // loading): the form's wait covers it; jr7 AUTO-7 (AUTO7-03): with whether an adapter declares the entry at all.
      if (data?.outcome === 'blocked') {
        const result = ENTRY_RESULTS[data.block ?? 'other'];
        await finishRun(run, result.state, result.reason);
        return;
      }
      if (data?.outcome === 'not-offered' && data.declared !== undefined) {
        await saveRun({ ...run, notOffered: { declared: data.declared } });
      }
    });
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

    /** A tab finished loading a page (round 2, K3 and E8). Only the agent's own tab is looked at (round 3, X8): where
     *  the address the load reports (`shown`) is a page of an ATS host that names no posting, which says no hello (the
     *  review's S3), and still is once AGENT_LOAD_SETTLE_MS later (a page's script may route on at once), the job is
     *  answered (noPosting), by that page's platform; any other page is the hellos' to answer. */
    async loaded(tabId: number, shown: () => AtsPage | null): Promise<void> {
      if (deps.atsPageOf === undefined) return;
      const first = await activeRun();
      if (first === null || first.tabId !== tabId || first.result !== null) return;
      if (shown()?.page !== 'other') return;
      await new Promise<void>((resolve) => deps.timers.after(AGENT_LOAD_SETTLE_MS, resolve));
      const now = await deps.atsPageOf(tabId).catch(() => null);
      if (now?.page !== 'other') return;
      await serial(async () => {
        const run = await activeRun();
        if (run === null || run.tabId !== tabId || run.result !== null) return;
        await noPosting(run, onJobPlatform(run, now.platform));
      });
    },

    /** A frame of the agent's tab said hello: another posting's page (or one that names none: a closed posting) ends
     *  the job; a form's document gets its run (once each, at most AGENT_MAX_STARTS, never after the job's Submit); one
     *  with no form its entry (once each, at most AGENT_MAX_ENTRIES), never the platform's page after submitting.
     *  jr7 AUTO-7: `said.handOver`, the step its adapter reads as the person's by design (ICIMS7-04); the entry's answer is
     *  awaited after the serial step (AUTOV-03). */
    async hello(tabId: number, entry: Pick<FrameEntry, 'frameId' | 'documentId' | 'hasForm' | 'posting' | 'confirmation'
      | 'applicationKey'> & Partial<Pick<FrameEntry, 'platform' | 'wraps'>>,
    said: { handOver?: HandOverKind | undefined } = {}): Promise<void> {
      const handOver = said.handOver ?? null;
      const pending = await serial(async (): Promise<PendingEntry[]> => {
        const run = await activeRun();
        if (run === null || run.tabId !== tabId) return [];
        // The snapshot build of 2026-11-06 (core-x, item 3): a subframe only where it is one of the frames the agent acts
        // in for the tab's application (frames.ts agentFramesOf: the frame that claims a company wrapper's application,
        // an iCIMS portal's iframe#icims_content_iframe, and a chain frame it framed); the S-9 rules keep any other
        // silent, and nothing a frame says of itself makes it one but the registry's own checks.
        if (entry.frameId !== 0) {
          const frames = (await deps.agentFrames?.(tabId).catch(() => [])) ?? [];
          if (!frames.some((frame) => frame.frameId === entry.frameId && frame.documentId === entry.documentId)) return [];
          if (entry.applicationKey !== run.applicationKey) return [];
          const one = await act(tabId, run, entry, handOver);
          return one === null ? [] : [one];
        }
        if (entry.applicationKey === undefined) {
          await noPosting(run, entry.platform === null || entry.platform === undefined ? null
            : onJobPlatform(run, entry.platform));
          return [];
        }
        if (entry.applicationKey !== run.applicationKey) {
          // jr7 AUTO-7 (AUTO7-08 b, J7-AG-1, UP7-01 item 4): after the job's Submit, the top frame's page after
          // submitting of the job's own platform under another key (a chained application's: SmartRecruiters'
          // publication, JazzHR's /apply/confirm) is held for its sign (submitted, by the arm's key), never acted on.
          if (run.pressedAt !== null && entry.confirmation === true && entry.platform !== null
            && entry.platform !== undefined && onJobPlatform(run, entry.platform)) {
            await holdForSign(run, 'page');
            return [];
          }
          // Another posting's page (a redirect, a link followed): never filled.
          await finishRun(run, 'needs-you', 'other');
          return [];
        }
        if (entry.wraps === true) {
          // core-x, item 3: a company's wrapper draws the application in a frame of its own: the agent acts there, never
          // here. That frame's hello may have come first: it is acted on now, once each document.
          const now = deps.now();
          let held: AgentRun = { ...run, heardAt: run.heardAt ?? now, progressAt: now, helloAt: now };
          await saveRun(held);
          const found: PendingEntry[] = [];
          for (const frame of (await deps.agentFrames?.(tabId).catch(() => [])) ?? []) {
            if (frame.frameId === 0 || frame.applicationKey !== run.applicationKey) continue;
            const current = await runOf();
            if (current === null || current.id !== run.id || current.result !== null) return found;
            held = current;
            const one = await act(tabId, held, frame);
            if (one !== null) found.push(one);
          }
          return found;
        }
        const one = await act(tabId, run, entry, handOver);
        return one === null ? [] : [one];
      });
      // jr7 AUTO-7 (AUTOV-03): each entry's answer awaited outside the serial step.
      await Promise.all(pending.map((each) => entryAnswered(each)));
    },

    /** A Submit of the task's application was pressed (armed) in the agent's tab, in document `documentId`: the job's
     *  one Submit (its first press, and where it was pressed, are kept). */
    /** The agent's tab's top frame pressed the job's entry, told before the entry waits on what the press brings (round
     *  3 of the v3 Phase 6/7b review, X8): the job has begun, even where the press takes the document away before
     *  agent/enter is answered. Only a document the agent asked to enter counts. */
    async entered(tabId: number, documentId?: string | null): Promise<void> {
      await serial(async () => {
        const run = await activeRun();
        if (run === null || run.tabId !== tabId || run.result !== null || (run.pressedEntryAt ?? null) !== null) return;
        if (!run.entered.includes(documentId ?? '')) return;
        await saveRun({ ...run, pressedEntryAt: deps.now(), progressAt: deps.now() });
      });
    },

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

    /** A tab closed: the agent's, closed by the person (its tab or its window), is their Stop (the audit's m14): its job
     *  is left for them (nothing left to close), and the agent pauses until they turn Run auto-apply on again. */
    async tabRemoved(tabId: number): Promise<void> {
      await serial(async () => {
        const run = await runOf();
        if (run === null || run.result !== null || run.tabId !== tabId || !(await ofThisSession(run))) return;
        await pause('window-closed');
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
