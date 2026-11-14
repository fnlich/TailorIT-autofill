/*
 * v1.4 F (PLAN decisions 15-17; TailorIT's contract tailor.ts, builder D's 32900ee): the job card's "Tailor resume for
 * this job" and "Generate cover letter", like Jobright's "Generate Custom Resume" and "Generate Cover Letter", done by
 * TailorIT: its tailoring writes a new built resume for the job (on the profile's resume template) and, when asked,
 * the cover letter beside it (on the profile's letter template), and links both to the job's tracker entry.
 *
 * - panel/tailor {tabId}: the tab's tailoring for the application its card frame shows now, from memory (nothing is
 *   asked); none for another application, connection or tab.
 * - panel/tailor {tabId, start}: the person's trusted click on a control seen CONTROL_SEEN_MS (the panel's hold and,
 *   on the page, the sidebar's gate), at most TAILOR_LIMIT a minute per tab. One tailoring per tab at a time: a start
 *   while one runs for the same application answers it. Nothing is written with AI-written answers off, where the
 *   posting forbids AI under profile-only, where the form states "I did not use AI", or where a run of the tab went
 *   profile-only ('ai-off'), as Write it now (cover-letters.ts); nor where the form frame's page cannot be read.
 * - The request (POST /api/autofill/tailor, scope ai:run): the lookup's job id (worker memory only), else the page's
 *   visible posting text, its company and title as the page's title names them, and its canaries; the resume the card
 *   attaches (the person's Change, else TailorIT's suggestion; this application's own tailored resume stands for the
 *   one it was tailored from, so a second tailoring starts from the same source); `coverLetter` for "Generate cover
 *   letter" alone. The templates are left out: TailorIT takes the profile's own (`documents`), as the person chose them
 *   in Options, Settings or the profile editor. A letter asked for that comes back without one (TailorIT answered an
 *   earlier resume-only tailoring, deduped) is asked once more with `force`.
 * - Then GET /tailor/:id every AUTOFILL_TAILOR_POLL_MS (at once when deduped), a 429's hint waited out, a failure on the
 *   way polled again, for at most TAILOR_CAP_MS. Each step TailorIT names, and its line, tells every panel
 *   (panel/changed 'tailor'), which reads its own tab's.
 * - Done: the tab attaches the tailored resume from now on, as a Change would (job-cards.ts setResume: the card is read
 *   again, the fill and a run going on attach it, "Apply without resume" is let go), while the tab still shows the
 *   same application; TailorIT has linked both documents to the tracker entry, so its lookup and its letter route find
 *   them for the next fill (the letter: the tracker entry's first). The new ids stay here, for Preview and Edit
 *   (documentOf) and the letter's preview.
 * - Refusals: 409 needs_editable_copy ('needs-copy': "Make an editable copy in TailorIT"), 429 ('rate-limited'), 503
 *   ai_unavailable ('ai-unavailable'), 409 ai_busy ('busy'), 403 ('not-allowed'), 401 ('not-connected'); a task that
 *   failed says 'failed' (or its own code's reason).
 *
 * Memory only, per tab: a worker that stops loses its poll (TailorIT goes on, and links what it made to the tracker
 * entry, which the next lookup reads). It goes with the tab, the token, and a start for another application. No log
 * line names a job, a resume, a template or a word of a document: codes, numbers and flags.
 */
import {
  AUTOFILL_TAILOR_LIMITS, AUTOFILL_TAILOR_POLL_MS, AutofillCoverLetterIdSchema, cutAtWord, type AutofillTailorRequest,
  type TailorResult,
} from '../contract/tailorit';
import { answerSchema, ok, type Answer } from '../messaging/envelope';
import { JobPostingTextAnswerSchema, type PageMessage } from '../messaging/schemas';
import type { TailorFailure, TailorKind, TailorView } from '../messaging/page-schemas';
import type { WorkerPlatform } from '../platform/types';
import { log } from '../shared/log';
import { frameTarget, type FrameEntry } from './frames';
import type { JobCards } from './job-cards';
import type { createRateLimit } from './locks';
import type { ServerClient, ServerResult } from './server-client';
import type { SettingsStore } from './settings';
import type { Timers } from './timers';

/** Starts per tab and minute: each one is several Claude calls on TailorIT, which allows 10 an hour per account. */
export const TAILOR_LIMIT = { count: 4, windowMs: 60_000 } as const;
/** A tailoring not finished this long after it started is given up here (TailorIT's own runs a minute or two). */
export const TAILOR_CAP_MS = 10 * 60_000;
/** panel/openDocument per tab and minute: each opens a tab (the preview page, or TailorIT's editor). */
export const OPEN_DOCUMENT_LIMIT = { count: 10, windowMs: 60_000 } as const;

const LIMITS = AUTOFILL_TAILOR_LIMITS;
/** Failures worth another poll: the next one may answer. */
const TRANSIENT: ReadonlySet<string> = new Set(['timeout', 'unreachable', 'server-error', 'bad-answer']);
/** What a resume id may be to name TailorIT's editor (server-client.ts's own rule for its file route). */
const RESUME_ID = /^[a-z0-9-]{1,64}$/;

type Of<T extends PageMessage['type']> = Extract<PageMessage, { type: T }>;

/** What the tailoring needs. */
export interface TailoringDeps {
  server: Pick<ServerClient, 'tailor' | 'tailorTask'>;
  jobs: Pick<JobCards, 'tabJob' | 'setResume'>;
  tabs: Pick<WorkerPlatform['tabs'], 'sendToFrame'>;
  settings: Pick<SettingsStore, 'get'>;
  timers: Timers;
  connected(): Promise<boolean>;
  /** The token keeper's generation (auth.ts): nothing read across a change is kept. */
  generation(): number;
  /** The tab's card frame now (frames.ts cardFrameOf), read from the registry with nothing asked of TailorIT. */
  cardFrame(tabId: number): Promise<FrameEntry | null>;
  /** TAILOR_LIMIT, keyed `${tabId}/`. */
  limit: ReturnType<typeof createRateLimit>;
  /** Every panel reads its tab's tailoring again (reports.tellPanels('tailor')). */
  changed(): void;
  /** Whether a run of the tab raised a notice that the posting forbids AI (its reports). */
  policyHeld?(tabId: number): Promise<boolean>;
  /** Whether a run of the tab fills from the profile only. */
  profileOnlyHeld?(tabId: number): Promise<boolean>;
}

/** One tab's tailoring. */
interface Held {
  /** The card frame's application when it started (its key, else its document). */
  app: string;
  kind: TailorKind;
  generation: number;
  view: TailorView;
  /** The resume it was tailored from (null: TailorIT's own choice). */
  source: string | null;
  /** What it made, once done (ids: this worker's memory only). */
  result: { resumeId: string; coverLetterId: string | null } | null;
  /** Ended or replaced: its poll stops. */
  stopped: boolean;
}

/** The application a frame shows: its key as the worker read its address, else its document. */
const appOf = (frame: FrameEntry) => frame.applicationKey ?? `doc:${frame.frameId}:${frame.documentId ?? ''}`;

/** Why a refused call stops a tailoring (the module header). */
export function tailorRefusalOf(failure: Extract<ServerResult<unknown>, { ok: false }>): TailorFailure {
  if (failure.failure === 'not-connected' || failure.failure === 'unauthorized') return 'not-connected';
  if (failure.failure === 'forbidden') return 'not-allowed';
  if (failure.failure === 'rate-limited') return 'rate-limited';
  if (failure.code === 'needs_editable_copy') return 'needs-copy';
  if (failure.code === 'ai_busy') return 'busy';
  // v2.0 P9 (API 8): the person's AI usage used up is said as TailorIT's AI being unavailable.
  if (failure.code === 'ai_unavailable' || failure.code === 'ai_usage_exhausted') return 'ai-unavailable';
  return 'unavailable';
}

/** The page as the request needs it (job/postingText's answer). */
type PageText = { text: string; canaries: readonly string[]; names?: { company: string; title: string } | undefined };

/** The request for the tab's job, or null when there is no job to name: TailorIT has none, and the page names no company,
 *  title or text. Page text goes only for a job TailorIT does not have. */
export function tailorRequestOf(job: { jobId: number | null }, page: PageText, source: string | null, kind: TailorKind,
  force = false): AutofillTailorRequest | null {
  const base = { coverLetter: kind === 'coverLetter', ...(source !== null && RESUME_ID.test(source)
    ? { resumeId: source } : {}), ...(force ? { force: true } : {}) };
  if (job.jobId !== null) return { ...base, jobId: job.jobId };
  const company = cutAtWord((page.names?.company ?? '').trim(), LIMITS.company);
  const title = cutAtWord((page.names?.title ?? '').trim(), LIMITS.title);
  const jobDescription = cutAtWord(page.text.trim(), LIMITS.jobDescription);
  if (company === '' || title === '' || jobDescription === '') return null;
  const canaries = [...new Set(page.canaries.filter((canary) => canary.length >= 2)
    .map((canary) => canary.slice(0, LIMITS.canary)))].slice(0, LIMITS.canaries);
  return { ...base, jobDescription, company, title, ...(canaries.length > 0 ? { canaries } : {}) };
}

/** TailorIT's editor for a document (PLAN decision 17): a built resume's `/resumes/<id>`, a letter's
 *  `/cover-letter/<id>`; v1.5 X (PLAN decision 3): an upload's `/resumes/<id>/edit`, TailorIT's route that makes (or
 *  reuses) its editable copy, with progress, then opens the editor; null for an id that may not name a path. */
export function editorUrlOf(origin: string, kind: TailorKind, id: string, built = true): string | null {
  if (kind === 'coverLetter') {
    return AutofillCoverLetterIdSchema.safeParse(id).success ? `${origin}/cover-letter/${id}` : null;
  }
  if (!RESUME_ID.test(id)) return null;
  return built ? `${origin}/resumes/${id}` : `${origin}/resumes/${id}/edit`;
}

/** Each failure as a number in the log. */
const FAILURE_LOG: Readonly<Record<TailorFailure, number>> = { 'needs-copy': 1, 'rate-limited': 2, 'ai-off': 3,
  'ai-unavailable': 4, busy: 5, 'no-job': 6, 'not-allowed': 7, 'not-connected': 8, failed: 9, unavailable: 10 };

/** The tailoring's handler, and what index.ts and the preview read of it. */
export function createTailoring(deps: TailoringDeps) {
  const held = new Map<number, Held>();

  /** The tab's tailoring for the application it shows now, under the current token; null for none. */
  async function current(tabId: number): Promise<Held | null> {
    const entry = held.get(tabId);
    if (entry === undefined || entry.generation !== deps.generation()) return null;
    const frame = await deps.cardFrame(tabId);
    return frame !== null && appOf(frame) === entry.app ? entry : null;
  }

  /** The form frame's visible posting text, canaries, policy reading and page names; null without an answer. */
  async function pageOf(tabId: number, frame: FrameEntry) {
    try {
      const answer = await deps.tabs.sendToFrame(tabId, { v: 1, type: 'job/postingText' }, frameTarget(frame));
      const parsed = answerSchema(JobPostingTextAnswerSchema).safeParse(answer);
      if (parsed.success && parsed.data.ok) return parsed.data.data;
    } catch {
      log('frame.unreachable');
    }
    return null;
  }

  /** Follows the task until it ends (the module header). */
  async function follow(tabId: number, entry: Held, first: { taskId: string; deduped: boolean },
    request: AutofillTailorRequest): Promise<void> {
    const live = () => !entry.stopped && entry.generation === deps.generation() && held.get(tabId) === entry;
    const end = (reason: TailorFailure) => {
      entry.view = { state: 'failed', kind: entry.kind, reason };
      log('tailor.failed', { reason: FAILURE_LOG[reason] });
      deps.changed();
    };
    let taskId = first.taskId;
    let delay = first.deduped ? 0 : AUTOFILL_TAILOR_POLL_MS;
    let forced = request.force === true;
    let waited = 0;
    for (;;) {
      if (waited + delay > TAILOR_CAP_MS) return end('unavailable');
      if (delay > 0) await new Promise<void>((resolve) => deps.timers.after(delay, resolve));
      waited += delay;
      if (!live()) return;
      delay = AUTOFILL_TAILOR_POLL_MS;
      const read = await deps.server.tailorTask(taskId);
      if (!live()) return;
      if (!read.ok) {
        if (read.failure === 'rate-limited') {
          delay = Math.max(AUTOFILL_TAILOR_POLL_MS, (read.retryAfterSeconds ?? 0) * 1000);
          continue;
        }
        if (TRANSIENT.has(read.failure)) continue;
        return end(tailorRefusalOf(read));
      }
      const task = read.value;
      if (task.status === 'queued' || task.status === 'running') {
        const step = task.step ?? (task.status === 'queued' ? 'waiting' : null);
        const message = task.message === null ? null : cutAtWord(task.message, 200);
        const view: TailorView = { state: 'running', kind: entry.kind, step, message };
        if (JSON.stringify(view) !== JSON.stringify(entry.view)) {
          entry.view = view;
          log('tailor.step', { step: step === null ? 0 : ['waiting', 'analyzing', 'writing', 'revising', 'saving']
            .indexOf(step) + 1 });
          deps.changed();
        }
        continue;
      }
      if (task.status === 'succeeded' && task.result !== null) {
        if (entry.kind === 'coverLetter' && task.result.coverLetterId === null && !forced) {
          // An earlier resume-only tailoring answered (deduped): the letter is asked for once more, forced.
          forced = true;
          const again = await deps.server.tailor({ ...request, force: true });
          if (!live()) return;
          if (!again.ok) return end(tailorRefusalOf(again));
          taskId = again.value.taskId;
          delay = again.value.deduped ? 0 : AUTOFILL_TAILOR_POLL_MS;
          continue;
        }
        return done(tabId, entry, task.result, live);
      }
      const code = task.error?.code ?? '';
      // v2.0 P9 (API 8): a task TailorIT failed because the person's AI usage ran out is said as AI unavailable.
      return end(code === 'ai_unavailable' || code === 'ai_usage_exhausted' ? 'ai-unavailable'
        : code === 'needs_editable_copy' ? 'needs-copy' : 'failed');
    }
  }

  /** Done: what it made is kept, and the tab attaches the tailored resume while it shows the same application. */
  async function done(tabId: number, entry: Held, result: TailorResult, live: () => boolean): Promise<void> {
    entry.result = { resumeId: result.resumeId, coverLetterId: result.coverLetterId };
    entry.view = { state: 'done', kind: entry.kind, title: cutAtWord(result.title, 200),
      letter: result.coverLetterId !== null, score: result.ats?.score ?? null, scoreBefore: result.ats?.scoreBefore ?? null };
    log('tailor.done', { letter: result.coverLetterId !== null, score: result.ats?.score ?? -1 });
    const frame = await deps.cardFrame(tabId);
    if (live() && frame !== null && appOf(frame) === entry.app && RESUME_ID.test(result.resumeId)) {
      await deps.jobs.setResume({ v: 1, type: 'panel/setResume', tabId, resumeId: result.resumeId });
    }
    deps.changed();
  }

  /** "Tailor resume for this job" or "Generate cover letter" (the module header). */
  async function start(tabId: number, kind: TailorKind): Promise<TailorView> {
    const failed = (reason: TailorFailure): TailorView => {
      log('tailor.refused', { reason: FAILURE_LOG[reason] });
      return { state: 'failed', kind, reason };
    };
    if (!(await deps.connected())) return failed('not-connected');
    const settings = await deps.settings.get();
    if (!settings.llm.drafts) return failed('ai-off');
    const generation = deps.generation();
    const job = await deps.jobs.tabJob(tabId);
    if (job.frame === null) return failed('unavailable');
    const app = appOf(job.frame);
    const before = held.get(tabId);
    const same = before !== undefined && before.app === app && before.generation === generation ? before : null;
    if (same?.view.state === 'running') return same.view;
    const page = await pageOf(tabId, job.frame);
    // A page that could not be read may forbid AI or hold an "I did not use AI" statement: nothing is written.
    if (page === null) return failed('unavailable');
    const policy = page.policy || ((await deps.policyHeld?.(tabId).catch(() => false)) ?? false);
    const attested = page.attestation === true && settings.llm.whenForbidden !== 'use-ai';
    const profileOnly = (await deps.profileOnlyHeld?.(tabId).catch(() => false)) ?? false;
    if ((policy && settings.llm.whenForbidden === 'profile-only') || attested || profileOnly) return failed('ai-off');
    // The resume the card attaches; this application's own tailored resume stands for the one it came from.
    let source = job.resume?.id ?? null;
    if (same?.result !== null && same?.result !== undefined && source === same.result.resumeId) source = same.source;
    const request = tailorRequestOf(job, page, source, kind);
    if (request === null) return failed('no-job');
    if (generation !== deps.generation()) return failed('not-connected');
    if (before !== undefined) before.stopped = true;
    const entry: Held = { app, kind, generation, view: { state: 'running', kind, step: 'waiting', message: null }, source,
      result: same?.result ?? null, stopped: false };
    held.set(tabId, entry);
    deps.changed();
    const answer = await deps.server.tailor(request);
    if (generation !== deps.generation()) return failed('not-connected');
    // The tab closed meanwhile: nothing to show.
    if (entry.stopped) return { state: 'idle' };
    if (!answer.ok) {
      entry.view = failed(tailorRefusalOf(answer));
      deps.changed();
      return entry.view;
    }
    log('tailor.started', { job: request.jobId !== undefined, deduped: answer.value.deduped, letter: request.coverLetter });
    void follow(tabId, entry, answer.value, request).catch(() => {
      if (held.get(tabId) !== entry || entry.stopped) return;
      entry.view = { state: 'failed', kind, reason: 'unavailable' };
      deps.changed();
    });
    return entry.view;
  }

  return {
    /** panel/tailor: a read, or a start (the module header). */
    async tailor(message: Of<'panel/tailor'>): Promise<Answer<TailorView>> {
      if (message.start === undefined) return ok((await current(message.tabId))?.view ?? { state: 'idle' });
      const retry = deps.limit.take(`${message.tabId}/`);
      if (retry !== null) {
        log('tailor.refused', { reason: FAILURE_LOG['rate-limited'] });
        return ok({ state: 'failed', kind: message.start, reason: 'rate-limited' });
      }
      return ok(await start(message.tabId, message.start));
    },
    /** The id of what the tab's tailoring made of `kind`, for the application it shows now; null for none. */
    async documentOf(tabId: number, kind: TailorKind): Promise<string | null> {
      const entry = await current(tabId);
      if (entry?.result === null || entry?.result === undefined) return null;
      return kind === 'resume' ? entry.result.resumeId : entry.result.coverLetterId;
    },
    forgetTab(tabId: number): void {
      const entry = held.get(tabId);
      if (entry !== undefined) entry.stopped = true;
      held.delete(tabId);
    },
    dropTokenData(): void {
      for (const entry of held.values()) entry.stopped = true;
      held.clear();
    },
  };
}

/** The tailoring, as index.ts wires it. */
export type Tailoring = ReturnType<typeof createTailoring>;
