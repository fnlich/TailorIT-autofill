/*
 * Cover letters (Phase G; docs/ARCHITECTURE.md "Cover letters"; docs/SPEC-AMENDMENTS.md §10). TailorIT keeps the
 * person's letters (Documents › Cover Letters) and writes one with its cover-letter AI when asked; the extension uploads
 * the letter's PDF into a form's cover-letter field.
 *
 * Asking (fetchLetter): POST /api/autofill/cover-letters with
 * - jobId: the run's lookup's job (TailorIT's own id, in the worker's memory only: it never reaches a frame or a page);
 * - company and jobTitle: the lookup's, else the page's own title's (plan/request's `posting`, page text);
 * - jobText: the posting's visible text as the frame read it ('' for a form inside another site's page, never TailorIT's
 *   stored copy), and the page's canaries, both only when TailorIT may write the letter (`generate`);
 * - resumeId: the resume the run attaches (resume-choice.ts);
 * - generate: TailorIT's AI may write one when the person has none (planFrame's word: not a dry run, not a profile-only
 *   run, AI-written answers on). With generate false TailorIT answers only a letter the person wrote or edited, and
 *   404 when there is none.
 * It asks in two steps: first a check (generate false, no page text: TailorIT counts checks apart, 60 a minute, so the
 * person's own letter never uses up the letters that may be written), then, only where TailorIT may write the letter
 * and the check found none to use (404, or `failed`: an empty letter TailorIT writes into, or the person's unfinished
 * one), the ask that may write (generate true: 10 a minute and 60 an hour per account). The answer says who wrote the
 * letter (`aiWritten`: TailorIT's AI, while it writes and until the person edits it), so a letter the AI wrote before
 * this run, or from the side panel's Write it now, is the AI's as one written now is. An answer `generating` is polled
 * (GET …/:id) every LETTER_POLL_MS, 30 a minute against TailorIT's 120 state reads a minute per account, or after a
 * 429's hint, for at most LETTER_CAP_MS from the first ask; `ready` is the letter to upload, `failed` and the refusals
 * leave the field flagged with why. A 409 ai_busy (two letters already being written for the account) is asked again
 * after LETTER_BUSY_MS (15 s, 30 s, then 60 s), so it makes at most 5 asks that may write within the cap; a 429 whose
 * hint goes past the cap ends the ask at once as TailorIT's limit (cover-letter-unavailable, `limited`), not a
 * time-out.
 *
 * One run's letter (createRunLetter): asked once per run, by the first plan that has a cover-letter upload to fill; the
 * keys waiting for it are planned again (plan/poll) once it is settled, and its id stays here for the resume port,
 * which sends the PDF as it sends a resume. A cover-letter text box (v3 Phase 3b; docs/SPEC-AMENDMENTS.md §12 Decision
 * 7) waits for the ready letter's words too: GET …/:id/text, read once per run, only when a plan's box asks for them
 * (PlanOutput.coverLetter.text) and never in a dry run (whose plans read none), kept here for the run alone and planned
 * into that box's text write (its guards: the canaries, the box's maxLength and visibility). A read answered 409, or
 * one that failed on the way (a time-out, no answer, a 5xx, a 429), is made once more after LETTER_POLL_MS (or the
 * 429's hint), only once a state read says the letter is still ready (the review of v3 Phase 3b); words that still do
 * not read (a refusal, empty, past the write's cap) leave the box cover-letter-unavailable. A run that went stops it.
 * A run whose letter TailorIT started writing is
 * marked in its value-free record (runs.ts `letterWritten`), so a worker that restarted still marks that letter as the
 * AI's. A worker that restarted between the plan and the upload has lost the letter's id: the resume port checks for
 * the person's letter again (checkLetter: generate false, so nothing is written).
 *
 * The side panel's row (createPanelLetters, panel/letter {tabId, write}): whether the person has a letter for the tab's
 * job (write false: nothing is written), or Write it now (write true: TailorIT's AI writes one when there is none, never
 * with AI-written answers off, in a dry run of the tab, where the form frame's page cannot be read, or where the tab
 * fills from the profile only: a posting that forbids AI under the default setting, an "I did not use AI" statement on
 * the form, or a run of the tab that went profile-only). It reads the job card the worker holds (job-cards.ts tabJob)
 * and, to write or for a posting TailorIT does not have, the form frame's visible posting text and names
 * (job/postingText). It answers a state only, kept per document for JOB_CARD_TTL_MS; never an id, never a word of a
 * letter.
 *
 * Memory only: nothing here is stored but the run record's flag, and no log line names a letter, a job, an address or
 * a word: codes and counts.
 */
import {
  AUTOFILL_COVER_LETTER_LIMITS, cutAtWord, type AutofillCoverLetterRequest, type AutofillCoverLetterResponse,
} from '../contract/tailorit';
import type { CoverLetterGap, CoverLetterState } from '../core/plan/types';
import type { FieldKey } from '../core/types/field';
import { answerSchema, ok, type Answer } from '../messaging/envelope';
import {
  JobPostingTextAnswerSchema, type LetterOutcome, type PageMessage, type PanelLetterAnswer,
} from '../messaging/schemas';
import type { WorkerPlatform } from '../platform/types';
import { log } from '../shared/log';
import type { AskContext, AwaitState } from './ai-tasks';
import { frameTarget } from './frames';
import { JOB_CARD_TTL_MS, type JobCards } from './job-cards';
import type { createRateLimit } from './locks';
import type { ProfileCache } from './profile-cache';
import type { ServerClient, ServerResult } from './server-client';
import type { SettingsStore } from './settings';
import type { Timers } from './timers';

/** How often a letter being written is asked after: 30 a minute, under TailorIT's 120 state reads a minute. */
export const LETTER_POLL_MS = 2_000;
/** How long an ask TailorIT answers ai_busy waits before it is made again: the first wait, the second, then each one
 *  after. Each such ask may write, so TailorIT counts it against its 10 a minute and 60 an hour: at most 5 within
 *  LETTER_CAP_MS. */
export const LETTER_BUSY_MS = [15_000, 30_000, 60_000] as const;
/** A letter not written this long after it was first asked for leaves its field flagged (cover-letter-timed-out). */
export const LETTER_CAP_MS = 180_000;
/** The longest letter a cover-letter text box takes (v3 Phase 3b): a planned text write's cap (WriteValueSchema). */
export const MAX_LETTER_TEXT = 20_000;
/** panel/letter per tab: each may be a POST TailorIT counts against its 10 a minute. */
export const LETTER_LIMIT = { count: 6, windowMs: 60_000 } as const;
/** The most side-panel answers kept at once (one per document, resume and connection). */
const PANEL_KEPT = 50;

const LIMITS = AUTOFILL_COVER_LETTER_LIMITS;

/** What asking for a letter takes (module header). */
export interface LetterAsk {
  jobId: number | null;
  company: string;
  jobTitle: string;
  /** The posting's visible text as the frame read it; sent only with `generate`. */
  jobText: string;
  /** The resume the run attaches; null: none, and nothing is asked. */
  resumeId: string | null;
  generate: boolean;
  /** The page's canaries; sent only with `generate`. */
  canaries: readonly string[];
  /** This run had TailorIT start writing its letter before (a worker that restarted): a letter ready now is the AI's. */
  written?: boolean;
}

/** How asking ended: the letter to upload (its id, memory only, and whether TailorIT's AI wrote it: TailorIT's word, or
 *  this run had it written), or none, with why (`limited`: TailorIT's limit, which the caller would not or could not
 *  wait out). */
export type LetterResult =
  | { state: 'ready'; letterId: string; aiWritten: boolean }
  | { state: 'none'; reason: CoverLetterGap; limited?: true };

/** What asking needs. */
export interface LetterDeps {
  server: Pick<ServerClient, 'coverLetter' | 'coverLetterState'> & Partial<Pick<ServerClient, 'coverLetterText'>>;
  timers: Timers;
  now(): number;
}

/** Failures worth another poll: the next one may answer. */
const TRANSIENT: ReadonlySet<string> = new Set(['timeout', 'unreachable', 'server-error']);
/** A text read worth one more try once the letter reads ready again: not ready yet (409), or one that failed on the
 *  way. */
const TEXT_RETRIED: ReadonlySet<string> = new Set([...TRANSIENT, 'conflict', 'rate-limited']);

/** The request for an ask, or null when TailorIT cannot be asked: no resume, or a posting it does not have whose page
 *  names no company or title. Page text goes only where TailorIT may write the letter. */
export function letterRequestOf(ask: LetterAsk): AutofillCoverLetterRequest | null {
  if (ask.resumeId === null || ask.resumeId === '' || ask.resumeId.length > 64) return null;
  const company = cutAtWord(ask.company.trim(), LIMITS.company);
  const jobTitle = cutAtWord(ask.jobTitle.trim(), LIMITS.jobTitle);
  if (ask.jobId === null && (company === '' || jobTitle === '')) return null;
  const jobText = ask.generate ? cutAtWord(ask.jobText.trim(), LIMITS.jobText) : '';
  const canaries = ask.generate ? [...new Set(ask.canaries.filter((canary) => canary.length >= 2)
    .map((canary) => canary.slice(0, LIMITS.canary)))].slice(0, LIMITS.canaries) : [];
  return {
    ...(ask.jobId === null ? {} : { jobId: ask.jobId }),
    company,
    jobTitle,
    ...(jobText === '' ? {} : { jobText }),
    resumeId: ask.resumeId,
    generate: ask.generate,
    ...(canaries.length > 0 ? { canaries } : {}),
  };
}

/** Why a refused call leaves the field: the connection predates cover letters (403), or TailorIT could not help. */
function refusalOf(failure: Extract<ServerResult<unknown>, { ok: false }>, generate: boolean): CoverLetterGap {
  if (failure.failure === 'forbidden') return 'cover-letter-reconnect';
  // With generate false, 404 is "no letter of the person's for this job"; with it, a job or a resume not there.
  if (failure.failure === 'not-found' && !generate) return 'cover-letter-none';
  return 'cover-letter-unavailable';
}

/**
 * Asks TailorIT for the letter and waits until it is settled (module header). `active` false stops it (the run went,
 * or the token changed): then it answers unavailable. `waitOnLimit` false answers a 429 at once (`limited`), as the
 * side panel would rather say so than wait. `onWriting` is told when TailorIT starts writing it for this ask.
 */
export async function fetchLetter(deps: LetterDeps, ask: LetterAsk, active: () => boolean,
  options: { waitOnLimit?: boolean; onWriting?(): void } = {}): Promise<LetterResult> {
  const body = letterRequestOf(ask);
  if (body === null) {
    log('letter.not-asked', { resume: ask.resumeId !== null });
    return { state: 'none', reason: 'cover-letter-unavailable' };
  }
  const started = deps.now();
  let waited = 0;
  const elapsed = () => Math.max(deps.now() - started, waited);
  const wait = (ms: number) => new Promise<void>((resolve) => {
    waited += ms;
    deps.timers.after(ms, resolve);
  });
  const gone: LetterResult = { state: 'none', reason: 'cover-letter-unavailable' };
  const limitedOut: LetterResult = { state: 'none', reason: 'cover-letter-unavailable', limited: true };
  /** Whether waiting `delay` more stays within the cap; past it, how the ask ends: TailorIT's limit said as such. */
  const pastCap = (delay: number, limited: boolean): LetterResult | null => {
    if (elapsed() + delay <= LETTER_CAP_MS) return null;
    if (limited) {
      log('letter.limited', { capped: true });
      return limitedOut;
    }
    log('letter.timed-out', { s: Math.round(elapsed() / 1000) });
    return { state: 'none', reason: 'cover-letter-timed-out' };
  };
  /** A 429's wait: its hint, or one poll interval. */
  const hinted = (failure: { retryAfterSeconds?: number }) =>
    Math.max(LETTER_POLL_MS, (failure.retryAfterSeconds ?? 0) * 1000);

  /** One POST, made again past ai_busy (LETTER_BUSY_MS) and a 429 (its hint) within the cap; a 404 is `missing`. */
  async function post(request: AutofillCoverLetterRequest):
    Promise<{ posted: AutofillCoverLetterResponse } | { missing: true } | { ended: LetterResult }> {
    for (let busy = 0; ;) {
      if (!active()) return { ended: gone };
      const answer = await deps.server.coverLetter(request);
      if (!active()) return { ended: gone };
      if (answer.ok) return { posted: answer.value };
      const isBusy = answer.failure === 'conflict' && answer.code === 'ai_busy';
      const limited = answer.failure === 'rate-limited';
      if (limited && options.waitOnLimit === false) return { ended: limitedOut };
      if (!isBusy && !limited) {
        log('letter.refused', { status: answer.status ?? 0 });
        if (answer.failure === 'not-found' && !request.generate) return { missing: true };
        return { ended: { state: 'none', reason: refusalOf(answer, request.generate) } };
      }
      const delay = limited ? hinted(answer) : LETTER_BUSY_MS[Math.min(busy, LETTER_BUSY_MS.length - 1)]!;
      if (isBusy) busy += 1;
      const capped = pastCap(delay, limited);
      if (capped !== null) return { ended: capped };
      log(isBusy ? 'letter.busy' : 'letter.limited');
      await wait(delay);
    }
  }

  // The check first (generate false); the ask that may write only where TailorIT may write the letter and the check
  // found none to use: none of the person's (404), or one that is not ready (an empty letter TailorIT writes into).
  let request = ask.generate ? letterRequestOf({ ...ask, generate: false })! : body;
  let step = await post(request);
  if (ask.generate && ('missing' in step || ('posted' in step && step.posted.state === 'failed'))) {
    request = body;
    step = await post(request);
  }
  if ('ended' in step) return step.ended;
  if ('missing' in step) return { state: 'none', reason: 'cover-letter-none' };
  const { letterId, state } = step.posted;
  const aiWritten = step.posted.aiWritten || ask.written === true;
  if (state === 'ready') {
    log('letter.ready', { written: aiWritten });
    return { state: 'ready', letterId, aiWritten };
  }
  if (state === 'failed') {
    log('letter.failed');
    return { state: 'none', reason: 'cover-letter-failed' };
  }
  // Generating: only ever for an ask that may write (TailorIT never answers it to a check).
  if (!request.generate) {
    log('letter.refused', { generating: true });
    return gone;
  }
  options.onWriting?.();
  let delay = LETTER_POLL_MS;
  let limited = false;
  for (;;) {
    const capped = pastCap(delay, limited);
    if (capped !== null) return capped;
    await wait(delay);
    if (!active()) return gone;
    delay = LETTER_POLL_MS;
    limited = false;
    const view = await deps.server.coverLetterState(letterId);
    if (!active()) return gone;
    if (view.ok) {
      if (view.value.state === 'ready') {
        log('letter.ready', { written: true, s: Math.round(elapsed() / 1000) });
        return { state: 'ready', letterId, aiWritten: true };
      }
      if (view.value.state === 'failed') {
        log('letter.failed', { written: true });
        return { state: 'none', reason: 'cover-letter-failed' };
      }
      continue;
    }
    if (view.failure === 'rate-limited') {
      delay = hinted(view);
      limited = true;
      continue;
    }
    if (TRANSIENT.has(view.failure)) continue;
    log('letter.refused', { status: view.status ?? 0, polled: true });
    return { state: 'none', reason: refusalOf(view, true) };
  }
}

/**
 * The person's own letter for a run, checked for again (generate false: nothing is written, and only a letter they wrote
 * or edited is answered): the resume port's way back to a letter whose id a worker that restarted between the plan and
 * the upload has lost (the Phase G review, MINOR 7). Its id when it is ready, else null; a 429 is not waited on.
 */
export async function checkLetter(deps: LetterDeps, ask: Pick<LetterAsk, 'jobId' | 'company' | 'jobTitle' | 'resumeId'
  | 'written'>, active: () => boolean): Promise<string | null> {
  const result = await fetchLetter(deps, { ...ask, generate: false, jobText: '', canaries: [] }, active,
    { waitOnLimit: false });
  return result.state === 'ready' ? result.letterId : null;
}

/** One run's cover letter, in the worker's memory (module header). */
export interface RunLetter {
  /** What planFrame reads: undefined until asked, then waiting, then ready or none. */
  input(): CoverLetterState | undefined;
  /** Asks TailorIT, once per run: a later call changes nothing. */
  ask(ask: LetterAsk): void;
  /** The ready letter's id, for the resume port; null while there is none. Never sent anywhere but TailorIT. */
  readyId(): string | null;
  /** These keys wait for the letter, to be planned again with `context` once it is settled; `text` (v3 Phase 3b): a
   *  cover-letter text box among them, which waits for the ready letter's words too. */
  wait(keys: readonly FieldKey[], context: AskContext, text?: boolean): void;
  /** Whether a key may be planned again (done), still waits, or is not one of this run's. */
  state(key: FieldKey): AwaitState;
  contextOf(key: FieldKey): AskContext | undefined;
  /** The keys are planned again: they no longer wait. */
  settle(keys: readonly FieldKey[]): void;
  /** Settles once the ask has ended (tests). */
  idle(): Promise<void>;
  /** The run went: the letter is no longer asked after, and its id goes. */
  stop(): void;
}

/** A run's letter over `deps`; `onWriting` marks the run's record when TailorIT starts writing it. */
export function createRunLetter(deps: LetterDeps, onWriting: () => void = () => undefined): RunLetter {
  let status: CoverLetterState | undefined;
  let letterId: string | null = null;
  let stopped = false;
  let done: Promise<void> = Promise.resolve();
  const waiting = new Map<FieldKey, AskContext>();
  /** v3 Phase 3b: whether a text box waits for the letter's words, and where reading them stands (memory only). */
  let wantsText = false;
  let words: string | undefined;
  let wordsState: 'unread' | 'reading' | 'read' | 'failed' = 'unread';
  /** Reads the ready letter's words once, when a text box asks for them. */
  function readWords(): void {
    if (!wantsText || wordsState !== 'unread' || stopped || status?.state !== 'ready' || letterId === null) return;
    const read = deps.server.coverLetterText;
    if (read === undefined) {
      wordsState = 'failed';
      return;
    }
    wordsState = 'reading';
    const id = letterId;
    done = done.then(async () => {
      let answer = await read(id);
      if (stopped) return;
      // Once more, after a short wait and only while the letter reads ready (module header).
      if (!answer.ok && TEXT_RETRIED.has(answer.failure)) {
        const delay = Math.min(LETTER_BUSY_MS[0], Math.max(LETTER_POLL_MS, (answer.retryAfterSeconds ?? 0) * 1000));
        await new Promise<void>((resolve) => deps.timers.after(delay, resolve));
        if (stopped) return;
        const view = await deps.server.coverLetterState(id);
        if (stopped) return;
        if (view.ok && view.value.state === 'ready') {
          log('letter.text', { retried: true });
          answer = await read(id);
          if (stopped) return;
        }
      }
      const text = answer.ok ? answer.value.text : '';
      // A write takes at most MAX_LETTER_TEXT; what does not fit, or reads empty, is no letter for a text box.
      if (text.trim() === '' || text.length > MAX_LETTER_TEXT) {
        log('letter.text', { read: false, status: answer.ok ? 200 : answer.status ?? 0 });
        wordsState = 'failed';
        return;
      }
      log('letter.text', { read: true });
      words = text;
      wordsState = 'read';
    }).catch(() => {
      if (!stopped) wordsState = 'failed';
    });
  }
  return {
    input() {
      if (status?.state !== 'ready') return status;
      return { ...status, ...(words === undefined ? {} : { text: words }),
        ...(wordsState === 'failed' ? { textUnavailable: true as const } : {}) };
    },
    ask(ask) {
      if (status !== undefined || stopped) return;
      status = { state: 'waiting' };
      done = fetchLetter(deps, ask, () => !stopped, { onWriting }).then((result) => {
        if (stopped) return;
        if (result.state === 'ready') {
          letterId = result.letterId;
          status = { state: 'ready', aiWritten: result.aiWritten };
          readWords();
        } else {
          status = { state: 'none', reason: result.reason };
        }
      }, () => {
        if (!stopped) status = { state: 'none', reason: 'cover-letter-unavailable' };
      });
    },
    readyId: () => (status?.state === 'ready' ? letterId : null),
    wait(keys, context, text) {
      for (const key of keys) waiting.set(key, context);
      if (text === true && !wantsText) {
        wantsText = true;
        readWords();
      }
    },
    state(key) {
      if (!waiting.has(key)) return 'unknown';
      if (status === undefined || status.state === 'waiting') return 'waiting';
      return status.state === 'ready' && wantsText && (wordsState === 'unread' || wordsState === 'reading') ? 'waiting'
        : 'done';
    },
    contextOf: (key) => waiting.get(key),
    settle(keys) {
      for (const key of keys) waiting.delete(key);
    },
    idle: () => done,
    stop() {
      stopped = true;
      letterId = null;
      words = undefined;
    },
  };
}

// ── The side panel's row ──────────────────────────────────────────────────────────────────────────────────────────

type LetterMessage = Extract<PageMessage, { type: 'panel/letter' }>;

/** What the side panel's row needs. */
export interface PanelLettersDeps extends LetterDeps {
  jobs: Pick<JobCards, 'tabJob'>;
  profiles: Pick<ProfileCache, 'get'>;
  tabs: Pick<WorkerPlatform['tabs'], 'sendToFrame'>;
  settings: Pick<SettingsStore, 'get'>;
  connected(): Promise<boolean>;
  /** The token keeper's generation (auth.ts): an answer read across a change is not kept or sent. */
  generation(): number;
  /** Whether a run of the tab raised a notice that the posting forbids AI (its reports). */
  policyHeld?(tabId: number): Promise<boolean>;
  /** Whether a run of the tab fills from the profile only (its reports' policy-profile-only or ai-attestation). */
  profileOnlyHeld?(tabId: number): Promise<boolean>;
  /** Whether the tab's latest run is a dry run (its latest report's mode), which writes nothing. */
  dryRunHeld?(tabId: number): Promise<boolean>;
  /** LETTER_LIMIT, keyed `${tabId}/`. */
  limit: ReturnType<typeof createRateLimit>;
}

/** What the row says for an ask's result. */
function outcomeOf(result: LetterResult): LetterOutcome {
  if (result.state === 'ready') return result.aiWritten ? 'written' : 'yours';
  if (result.limited === true) return 'rate-limited';
  switch (result.reason) {
    case 'cover-letter-none':
      return 'none';
    case 'cover-letter-failed':
      return 'failed';
    case 'cover-letter-reconnect':
      return 'not-allowed';
    default:
      return 'unavailable';
  }
}

/** panel/letter's handler, with what it keeps per document; `forgetTab` and `dropTokenData` for index.ts. */
export function createPanelLetters(deps: PanelLettersDeps) {
  const kept = new Map<string, { outcome: LetterOutcome; at: number }>();

  /** The form frame's visible posting text, canaries, policy reading and page names; none without an answer. */
  async function pageOf(tabId: number, frame: NonNullable<Awaited<ReturnType<JobCards['tabJob']>>['frame']>) {
    try {
      const answer = await deps.tabs.sendToFrame(tabId, { v: 1, type: 'job/postingText' }, frameTarget(frame));
      const parsed = answerSchema(JobPostingTextAnswerSchema).safeParse(answer);
      if (parsed.success && parsed.data.ok) return parsed.data.data;
    } catch {
      log('frame.unreachable');
    }
    return null;
  }

  async function answer({ tabId, write }: LetterMessage): Promise<LetterOutcome> {
    if (!(await deps.connected())) return 'not-connected';
    const settings = await deps.settings.get();
    if (write && !settings.llm.drafts) return 'ai-off';
    // A dry run writes nothing: its card offers no Write it now, and one that comes anyway is refused.
    if (write && ((await deps.dryRunHeld?.(tabId).catch(() => true)) ?? false)) return 'unavailable';
    const generation = deps.generation();
    const job = await deps.jobs.tabJob(tabId);
    if (job.frame === null) return 'unavailable';
    let resumeId = job.resume?.id ?? null;
    if (resumeId === null) {
      const profile = await deps.profiles.get();
      resumeId = profile.ok ? profile.value.resumeId : null;
    }
    if (resumeId === null) return 'unavailable';
    const key = `${tabId}:${job.frame.frameId}:${job.frame.documentId ?? ''}|${resumeId}|${generation}`;
    const held = kept.get(key);
    if (!write && held !== undefined && deps.now() - held.at < JOB_CARD_TTL_MS) return held.outcome;
    const page = write || job.jobId === null ? await pageOf(tabId, job.frame) : null;
    if (write) {
      // A page that could not be read may forbid AI or hold an "I did not use AI" statement: nothing is written.
      if (page === null) return 'unavailable';
      // Profile only: a posting that forbids AI, with the person's setting at its default, a form that states "I did
      // not use AI" (unless the setting is to use the AI anyway, as planFrame reads it), or a run of the tab that fills
      // from the profile only, gets no letter written by the AI. "Ask me" leaves the posting's notice to the person's
      // click, and "Use AI anyway" writes it.
      const policy = page.policy || ((await deps.policyHeld?.(tabId).catch(() => false)) ?? false);
      const attested = page.attestation === true && settings.llm.whenForbidden !== 'use-ai';
      const held = (await deps.profileOnlyHeld?.(tabId).catch(() => false)) ?? false;
      if ((policy && settings.llm.whenForbidden === 'profile-only') || attested || held) return 'ai-off';
    }
    if (generation !== deps.generation()) return 'not-connected';
    const result = await fetchLetter(deps, {
      jobId: job.jobId,
      company: job.company !== '' ? job.company : page?.names?.company ?? '',
      jobTitle: job.jobTitle !== '' ? job.jobTitle : page?.names?.title ?? '',
      jobText: write ? page?.text ?? '' : '',
      resumeId,
      generate: write,
      canaries: write ? page?.canaries ?? [] : [],
    }, () => generation === deps.generation(), { waitOnLimit: false });
    if (generation !== deps.generation()) return 'not-connected';
    const outcome = outcomeOf(result);
    if (outcome !== 'rate-limited' && outcome !== 'unavailable') {
      kept.delete(key);
      kept.set(key, { outcome, at: deps.now() });
      while (kept.size > PANEL_KEPT) kept.delete(kept.keys().next().value!);
    }
    return outcome;
  }

  return {
    async letter(message: LetterMessage): Promise<Answer<PanelLetterAnswer>> {
      const retry = deps.limit.take(`${message.tabId}/`);
      if (retry !== null) return ok({ outcome: 'rate-limited' });
      const outcome = await answer(message);
      log('job.letter-answered', { write: message.write, outcome: LETTER_LOG[outcome] });
      return ok({ outcome });
    },
    forgetTab(tabId: number) {
      for (const key of [...kept.keys()]) if (key.startsWith(`${tabId}:`)) kept.delete(key);
    },
    dropTokenData() {
      kept.clear();
    },
  };
}

/** Each outcome as a number in the log (codes and counts only). */
const LETTER_LOG: Readonly<Record<LetterOutcome, number>> = { yours: 1, written: 2, none: 3, failed: 4, 'ai-off': 5,
  'not-allowed': 6, 'rate-limited': 7, 'not-connected': 8, unavailable: 9 };
