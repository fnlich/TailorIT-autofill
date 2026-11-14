/*
 * "Ask a custom question" (v2; docs/ARCHITECTURE.md "The custom question"): the side panel's panel/ask {tabId,
 * question, length}, answered by TailorIT's AI from the tab's active resume.
 * - The question is screened first, by the same screens the planner uses: one that names a self-identification, legal,
 *   pay or consent topic, or reads like an attention check, is answered 'sensitive' with nothing sent.
 * - The active resume: the one the person chose for the tab, else the one the tab's job card attaches (read through the
 *   form frame when no card is held: job-cards.ts), else the profile's own choice. None: 'no-resume', nothing sent.
 * - The draft request: one question (the person's own words, at most 1000 characters) with the length's cap
 *   (AUTOFILL_CUSTOM_QUESTION_LENGTHS), the card's company and job title, the posting's visible text as the form frame
 *   reads it ('' for a form inside another site's page, and never TailorIT's stored copy: job/postingText), the page's
 *   canaries and the active resume's id. It goes to POST /api/autofill/ai/draft, and a task TailorIT did not finish
 *   within its wait is polled every AUTOFILL_AI_POLL_MS, for at most ASK_CAP_MS.
 * - What comes back is checked again here: a draft holding a canary, or longer than its cap, is 'unusable'.
 * - It is written by the AI, so it follows the AI-drafts switch (`llm.drafts`, on by default): with it off, the answer is
 *   'ai-off' and nothing is sent (the panel disables the box too).
 * - It works in profile-only mode too, because the person asked; the answer says whether the posting says AI-assisted
 *   applications are not allowed (`policy`: the form frame's visible text, or a notice a run of the tab raised, which
 *   covers the posting page and TailorIT's saved copy), so the panel shows that notice with it, even before any run.
 * - A token change while it is asked (another window connected or disconnected) sends nothing: 'not-connected'.
 * The question and the answer pass through the worker's memory only for the call: nothing is stored, and no log line
 * holds either (an outcome flag only).
 */
import {
  AUTOFILL_AI_LIMITS, AUTOFILL_AI_POLL_MS, AUTOFILL_CUSTOM_QUESTION_LENGTHS, cutAtWord, type AutofillDraftTask,
  type AutofillTaskView,
} from '../contract/tailorit';
import { canariesIn } from '../core/guard/canary';
import { attentionHits } from '../core/guard/attention';
import { namesSensitiveTopic } from '../core/resolver/classify';
import { answerSchema, ok, refuse, type Answer } from '../messaging/envelope';
import { JobPostingTextAnswerSchema, type PageMessage, type PanelAskAnswer } from '../messaging/schemas';
import type { WorkerPlatform } from '../platform/types';
import { log } from '../shared/log';
import { frameTarget } from './frames';
import type { JobCards } from './job-cards';
import type { createRateLimit } from './locks';
import type { ProfileCache } from './profile-cache';
import { aiRefusalOf } from './ai-notice'; // v2.0 fix wave (REQ-1)
import type { ServerClient, ServerResult } from './server-client';
import type { SettingsStore } from './settings';
import type { Timers } from './timers';

/** A custom question's task is given up this long after it was submitted (the planner's AI cap). */
export const ASK_CAP_MS = 120_000;
/** panel/ask per tab: each is one AI task on TailorIT. */
export const ASK_LIMIT = { count: 6, windowMs: 60_000 } as const;
/** The draft item's key: one question per task. */
const ASK_KEY = 'custom-question';

type Ask = Extract<PageMessage, { type: 'panel/ask' }>;
type Refused = Exclude<PanelAskAnswer, { outcome: 'answered' }>['outcome'];

/** What the custom question needs. */
export interface AskDeps {
  jobs: Pick<JobCards, 'tabJob'>;
  server: Pick<ServerClient, 'aiDraft' | 'aiTask' | 'resumes'>;
  profiles: Pick<ProfileCache, 'get'>;
  tabs: Pick<WorkerPlatform['tabs'], 'sendToFrame'>;
  timers: Timers;
  now(): number;
  connected(): Promise<boolean>;
  /** The token keeper's generation (auth.ts): a question asked across a change is not sent. */
  generation(): number;
  /** The settings: `llm.drafts` switches the custom question on and off. */
  settings: Pick<SettingsStore, 'get'>;
  /** Whether a run of the tab raised a notice that the posting forbids AI (its reports). */
  policyHeld?(tabId: number): Promise<boolean>;
  /** ASK_LIMIT, keyed `${tabId}/`. */
  limit: ReturnType<typeof createRateLimit>;
}

/** Whether a question may never go to the AI: a sensitive topic, or an attention check. */
export function screenQuestion(question: string): 'sensitive' | null {
  return namesSensitiveTopic(question) || attentionHits(question, '').length > 0 ? 'sensitive' : null;
}

/** v2.0 fix wave (REQ-1): a refusal with TailorIT's words, when its AI refused (unavailable, or the usage used up). */
function refusedWith(outcome: Refused, words: { code?: string; message?: string } | null | undefined): PanelAskAnswer {
  const message = aiRefusalOf(words)?.message;
  return message === undefined ? { outcome } : { outcome, message };
}

/** What a refused AI call means to the person. */
function refusalOf(failure: Extract<ServerResult<unknown>, { ok: false }>): Refused {
  if (failure.failure === 'not-connected' || failure.failure === 'unauthorized') return 'not-connected';
  if (failure.failure === 'rate-limited') return 'rate-limited';
  if (failure.failure === 'not-found') return 'no-resume';
  return 'unavailable';
}

/** The handler of panel/ask. */
export function createAsk(deps: AskDeps): (message: Ask) => Promise<Answer<PanelAskAnswer>> {
  const wait = (ms: number) => new Promise<void>((resolve) => deps.timers.after(ms, resolve));

  /** The active resume's id and title: the chosen one or the card's, else the profile's; null when there is none. */
  async function activeResume(job: Awaited<ReturnType<JobCards['tabJob']>>): Promise<{ id: string; label: string } | null> {
    let id = job.resume?.id ?? null;
    let label = job.resume?.label ?? null;
    if (id === null) {
      const profile = await deps.profiles.get();
      id = profile.ok ? profile.value.resumeId : null;
    }
    if (id === null) return null;
    if (label === null) {
      const list = await deps.server.resumes();
      const item = list.ok ? list.value.items.find((entry) => entry.id === id) : undefined;
      if (list.ok && item === undefined) return null;
      label = item?.label ?? '';
    }
    return { id, label: cutAtWord(label, 200) };
  }

  /** The posting's visible text, the page's canaries and whether the frame's text forbids AI, from the form frame; none
   *  without one. */
  async function pageText(tabId: number, job: Awaited<ReturnType<JobCards['tabJob']>>):
    Promise<{ text: string; canaries: string[]; policy: boolean }> {
    if (job.frame === null) return { text: '', canaries: [], policy: false };
    try {
      const answer = await deps.tabs.sendToFrame(tabId, { v: 1, type: 'job/postingText' }, frameTarget(job.frame));
      const parsed = answerSchema(JobPostingTextAnswerSchema).safeParse(answer);
      if (parsed.success && parsed.data.ok) return parsed.data.data;
    } catch {
      log('frame.unreachable');
    }
    return { text: '', canaries: [], policy: false };
  }

  /** The task once finished: polled within ASK_CAP_MS; null when it never finished. */
  async function finished(started: number, taskId: string): Promise<ServerResult<AutofillTaskView> | null> {
    while (deps.now() - started < ASK_CAP_MS) {
      await wait(AUTOFILL_AI_POLL_MS);
      const view = await deps.server.aiTask(taskId);
      if (!view.ok) return view;
      if (view.value.status !== 'queued' && view.value.status !== 'running') return view;
    }
    return null;
  }

  async function answer(message: Ask): Promise<PanelAskAnswer> {
    if (!(await deps.connected())) return { outcome: 'not-connected' };
    const question = message.question.trim();
    if (screenQuestion(question) !== null) return { outcome: 'sensitive' };
    if (!(await deps.settings.get()).llm.drafts) return { outcome: 'ai-off' };
    const generation = deps.generation();
    const job = await deps.jobs.tabJob(message.tabId);
    const resume = await activeResume(job);
    if (resume === null) return { outcome: 'no-resume' };
    const { text, canaries, policy: here } = await pageText(message.tabId, job);
    const policy = here || ((await deps.policyHeld?.(message.tabId).catch(() => false)) ?? false);
    // Another connection since the question was asked: its card, resume and posting are not this one's to send.
    if (generation !== deps.generation()) return { outcome: 'not-connected' };
    const maxLength = AUTOFILL_CUSTOM_QUESTION_LENGTHS[message.length];
    const limits = AUTOFILL_AI_LIMITS.draft;
    const started = deps.now();
    const submitted = await deps.server.aiDraft({
      questions: [{ key: ASK_KEY, question: cutAtWord(question, limits.question), maxLength }],
      jobText: cutAtWord(text, limits.jobText),
      company: cutAtWord(job.company, limits.company),
      jobTitle: cutAtWord(job.jobTitle, limits.jobTitle),
      resumeId: resume.id,
      canaries: canaries.filter((canary) => canary.length >= 2).map((canary) => canary.slice(0, limits.canary))
        .slice(0, limits.canaries),
    });
    if (!submitted.ok) return refusedWith(refusalOf(submitted), submitted); // v2.0 fix wave (REQ-1)
    let task: AutofillTaskView;
    if (submitted.value.done) task = submitted.value.task;
    else {
      const view = await finished(started, submitted.value.taskId);
      if (view === null) return { outcome: 'unavailable' };
      if (!view.ok) return refusedWith(refusalOf(view), view); // v2.0 fix wave (REQ-1)
      task = view.value;
    }
    // v2.0 fix wave (REQ-1): a task TailorIT failed for its AI's refusal says its words.
    if (task.kind !== 'autofill_draft' || task.status !== 'succeeded' || task.result === null) {
      return refusedWith('unavailable', task.error);
    }
    const draft = (task as AutofillDraftTask).result?.drafts.find((each) => each.key === ASK_KEY);
    if (draft === undefined) return { outcome: 'unusable' };
    if (draft.reason === 'sensitive') return { outcome: 'sensitive' };
    if ((draft.reason !== 'drafted' && draft.reason !== 'trimmed') || draft.text === null) return { outcome: 'unusable' };
    const written = draft.text.trim();
    if (written === '' || [...written].length > maxLength || canariesIn([written], canaries).length > 0) {
      return { outcome: 'unusable' };
    }
    return { outcome: 'answered', text: written, resumeLabel: resume.label, policy };
  }

  return async (message) => {
    if (message.question.trim() === '') return refuse('bad_message');
    const retry = deps.limit.take(`${message.tabId}/`);
    if (retry !== null) return ok({ outcome: 'rate-limited' });
    const result = await answer(message);
    log('job.ask-answered', { answered: result.outcome === 'answered' });
    return ok(result);
  };
}
