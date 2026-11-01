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
 * An answer `generating` is polled (GET …/:id) every LETTER_POLL_MS, 30 a minute against TailorIT's 120 state reads a
 * minute per account, or after a 429's hint, for at most LETTER_CAP_MS from the first ask; `ready` is the letter to
 * upload (aiWritten when TailorIT's AI wrote it during this run), `failed` and the refusals leave the field flagged
 * with why. A 409 ai_busy (two letters already being written for the account) is asked again within the cap.
 *
 * One run's letter (createRunLetter): asked once per run, by the first plan that has a cover-letter upload to fill; the
 * keys waiting for it are planned again (plan/poll) once it is settled, and its id stays here for the resume port,
 * which sends the PDF as it sends a resume. A run that went stops it. A run whose letter TailorIT started writing is
 * marked in its value-free record (runs.ts `letterWritten`), so a worker that restarted still marks that letter as the
 * AI's.
 *
 * The side panel's row (createPanelLetters, panel/letter {tabId, write}): whether the person has a letter for the tab's
 * job (write false: nothing is written), or Write it now (write true: TailorIT's AI writes one when there is none, never
 * with AI-written answers off, or where the tab fills from the profile only: a posting that forbids AI under the default
 * setting, or a run of the tab that went profile-only). It reads the job card the worker
 * holds (job-cards.ts tabJob) and, to write or for a posting TailorIT does not have, the form frame's visible posting
 * text and names (job/postingText). It answers a state only, kept per document for JOB_CARD_TTL_MS; never an id, never
 * a word of a letter.
 *
 * Memory only: nothing here is stored but the run record's flag, and no log line names a letter, a job, an address or
 * a word: codes and counts.
 */
import {
  AUTOFILL_COVER_LETTER_LIMITS, cutAtWord, type AutofillCoverLetterRequest, type AutofillCoverLetterState,
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
/** A letter not written this long after it was first asked for leaves its field flagged (cover-letter-timed-out). */
export const LETTER_CAP_MS = 180_000;
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

/** How asking ended: the letter to upload (its id, memory only, and whether TailorIT's AI wrote it during this run), or
 *  none, with why (`limited`: a 429 the caller would not wait on). */
export type LetterResult =
  | { state: 'ready'; letterId: string; aiWritten: boolean }
  | { state: 'none'; reason: CoverLetterGap; limited?: true };

/** What asking needs. */
export interface LetterDeps {
  server: Pick<ServerClient, 'coverLetter' | 'coverLetterState'>;
  timers: Timers;
  now(): number;
}

/** Failures worth another poll: the next one may answer. */
const TRANSIENT: ReadonlySet<string> = new Set(['timeout', 'unreachable', 'server-error']);

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
  const timedOut = (): LetterResult => {
    log('letter.timed-out', { s: Math.round(elapsed() / 1000) });
    return { state: 'none', reason: 'cover-letter-timed-out' };
  };
  /** A 429's wait: its hint, or one poll interval. */
  const hinted = (failure: { retryAfterSeconds?: number }) =>
    Math.max(LETTER_POLL_MS, (failure.retryAfterSeconds ?? 0) * 1000);

  let posted: { letterId: string; state: AutofillCoverLetterState };
  for (;;) {
    if (!active()) return gone;
    const answer = await deps.server.coverLetter(body);
    if (!active()) return gone;
    if (answer.ok) {
      posted = answer.value;
      break;
    }
    const busy = answer.failure === 'conflict' && answer.code === 'ai_busy';
    const limited = answer.failure === 'rate-limited';
    if (limited && options.waitOnLimit === false) return { state: 'none', reason: 'cover-letter-unavailable', limited: true };
    if (!busy && !limited) {
      log('letter.refused', { status: answer.status ?? 0 });
      return { state: 'none', reason: refusalOf(answer, ask.generate) };
    }
    const delay = limited ? hinted(answer) : LETTER_POLL_MS;
    if (elapsed() + delay > LETTER_CAP_MS) return timedOut();
    log(busy ? 'letter.busy' : 'letter.limited');
    await wait(delay);
  }

  const { letterId } = posted;
  if (posted.state === 'ready') {
    log('letter.ready', { written: ask.written === true });
    return { state: 'ready', letterId, aiWritten: ask.written === true };
  }
  if (posted.state === 'failed') {
    log('letter.failed');
    return { state: 'none', reason: 'cover-letter-failed' };
  }
  // Generating: only ever for an ask that may write (TailorIT never answers it to generate false).
  if (!ask.generate) {
    log('letter.refused', { generating: true });
    return gone;
  }
  options.onWriting?.();
  let delay = LETTER_POLL_MS;
  for (;;) {
    if (elapsed() + delay > LETTER_CAP_MS) return timedOut();
    await wait(delay);
    if (!active()) return gone;
    delay = LETTER_POLL_MS;
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
      continue;
    }
    if (TRANSIENT.has(view.failure)) continue;
    log('letter.refused', { status: view.status ?? 0, polled: true });
    return { state: 'none', reason: refusalOf(view, true) };
  }
}

/** One run's cover letter, in the worker's memory (module header). */
export interface RunLetter {
  /** What planFrame reads: undefined until asked, then waiting, then ready or none. */
  input(): CoverLetterState | undefined;
  /** Asks TailorIT, once per run: a later call changes nothing. */
  ask(ask: LetterAsk): void;
  /** The ready letter's id, for the resume port; null while there is none. Never sent anywhere but TailorIT. */
  readyId(): string | null;
  /** These keys wait for the letter, to be planned again with `context` once it is settled. */
  wait(keys: readonly FieldKey[], context: AskContext): void;
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
  return {
    input: () => status,
    ask(ask) {
      if (status !== undefined || stopped) return;
      status = { state: 'waiting' };
      done = fetchLetter(deps, ask, () => !stopped, { onWriting }).then((result) => {
        if (stopped) return;
        if (result.state === 'ready') {
          letterId = result.letterId;
          status = { state: 'ready', aiWritten: result.aiWritten };
        } else {
          status = { state: 'none', reason: result.reason };
        }
      }, () => {
        if (!stopped) status = { state: 'none', reason: 'cover-letter-unavailable' };
      });
    },
    readyId: () => (status?.state === 'ready' ? letterId : null),
    wait(keys, context) {
      for (const key of keys) waiting.set(key, context);
    },
    state(key) {
      if (!waiting.has(key)) return 'unknown';
      return status === undefined || status.state === 'waiting' ? 'waiting' : 'done';
    },
    contextOf: (key) => waiting.get(key),
    settle(keys) {
      for (const key of keys) waiting.delete(key);
    },
    idle: () => done,
    stop() {
      stopped = true;
      letterId = null;
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
      // Profile only: a posting that forbids AI, with the person's setting at its default, or a run of the tab that
      // fills from the profile only, gets no letter written by the AI. "Ask me" leaves it to the person's click, and
      // "Use AI anyway" writes it.
      const policy = page?.policy === true || ((await deps.policyHeld?.(tabId).catch(() => false)) ?? false);
      const held = (await deps.profileOnlyHeld?.(tabId).catch(() => false)) ?? false;
      if ((policy && settings.llm.whenForbidden === 'profile-only') || held) return 'ai-off';
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
