/*
 * The worker's AI tasks (Phase 4; docs/ARCHITECTURE.md "Messages" › "The worker's limits", "The LLM tiebreak" and
 * "LLM classification"; docs/design/runtime.md §4.5; docs/design/tailorit.md §6). planFrame asks; this file translates
 * the core's questions into TailorIT's pick and classify requests, submits each batch as a task, polls it, and
 * translates the answers back into the verdicts planFrame completes the waiting fields with.
 *
 * Translation, out (pickItemOf, classifyItemOfCore):
 * - a pick item: the core's item id as its key, the core's pick category, the observed option-set hash, the intended
 *   value and at most 10 aliases (profile text), the visible label, and the options as {index, label}: each guard-passing
 *   candidate's clean label, under the option's own index;
 * - never sent: a candidate's label hash, its hardConflict or injected flag, an injected or hard-conflict candidate, and
 *   an item whose category is not one of TailorIT's pick categories (country and region never are), whose label names
 *   a sensitive topic, or whose value or aliases name a sum, or, outside a school, a degree and a field of study, a
 *   sensitive topic (EEO, legal, salary, consent; "Gender Studies" is a field's name: the Phase 4 review, T-F4). The
 *   core never builds such an item; this checks again, and a withheld item gets its verdict at once (no-match: the
 *   cascade's own answer stands);
 * - a classify item: the core's (visible text only, cut after a word at 200), with the frame's platform, its label,
 *   hint, section's words and options screened again.
 * Translation, back: a pick names an option's index, which maps to the core's candidate position, and the core's
 * readTiebreakReply validates it (in range, never an injected candidate, so a pick of the withheld injected option is
 * llm-pick-rejected). A hard-conflict option is never a candidate, so a pick of one names no candidate:
 * llm-invalid-output. `invalid` is llm-invalid-output and `sensitive` needs-user (llm-disabled-for-category): neither
 * is no-match. An item answered twice or not at all is llm-invalid-output. A classification is a category or null.
 *
 * Submitting (createAiTasks): POST answers 200 with the finished task or 202 {taskId}; a 202 is polled every
 * AUTOFILL_AI_POLL_MS until it finishes, at most AI_TASK_CAP_MS (120 s) from the start, and then its fields are left
 * blank and flagged (llm-unavailable). A task is never cancelled: TailorIT gives callers that ask the same one task,
 * which a DELETE would end for all of them, and prunes every task within its hour (the Phase 4 review, T-F2). A task
 * found cancelled (by someone else) is asked once more, then llm-unavailable. A 409 ai_busy waits for another task of
 * this worker to finish, or one poll interval when none is in flight here, then tries again, within the same cap. A
 * batch's task id is kept by the batch's name (batchHash: its questions and options, and for a pick the profile's
 * revision instead of its values; AiTaskIds: RunState.aiTasks), so a batch asked again after a worker restart or a
 * reload is read by its id within TailorIT's hour; a queued or running one is reattached through TailorIT's dedupe key
 * besides. Every call goes through the server client: its paths, credentials 'omit', the version header and
 * AbortSignal.timeout(25 s).
 *
 * Drafts (Phase 6, settings.llm.drafts on; core/plan/drafts.ts): a pass's free-text questions go as TailorIT's draft
 * requests, at most DRAFT_MAX_QUESTIONS a task, each with the posting's visible text as the frame read it (jobText,
 * '' for a form embedded in another page, and never TailorIT's stored copy), the lookup's company and job title, the
 * run's canaries and the resume the run attaches. A question naming a sensitive topic is never sent
 * (llm-disabled-for-category). What comes back is the core's DraftVerdict: drafted and trimmed are a text; every other
 * reason is why there is none (empty, too_long, canary, ai_reference, wrapper and contact as the draft-* or
 * canary-in-value reasons; invalid llm-invalid-output; sensitive llm-disabled-for-category), and a question answered
 * twice or not at all, or a text where none belongs, is llm-invalid-output. A draft's text stays in the run's memory
 * until the frame has it. Edit with AI's rewrite is one draft question with the box's current text as
 * `currentAnswer` (cut after a whole word at TailorIT's cap); a current text naming a sensitive answer, a sum, a contact
 * detail or a postal address is never sent (namesSensitiveAnswer, as the core screens it: the Phase E review, MAJOR 3).
 * v3 Phase 3b: the person's instruction typed in Edit with AI's box goes as that question's `instruction` (cut after a
 * whole word at 750), screened the same way (and for a sensitive topic): one that fails is never sent, and the rewrite
 * is llm-disabled-for-category, which the box says.
 *
 * Answers (the owner's amendments, docs/SPEC-AMENDMENTS.md; settings.llm.answers on; core/plan/answers.ts): a pass's
 * questions nothing else settled go as TailorIT's answer requests (POST …/ai/answer), at most ANSWER_MAX_ITEMS a task
 * and under the text cap, each with the posting's visible text, the lookup's company and title, the resume and the
 * canaries, as drafts are. Visible text only, screened again: an item whose question, hint, section or any option
 * names a sensitive topic is never sent (llm-disabled-for-category). An option's label hash stays here. What comes
 * back is the core's AnswerVerdict: an answered choice must name one of the item's own sent indices and repeat its
 * option set, and becomes that option with its label's hash as sent; an answered text must be a text; each keeps its
 * basis (`guess` is marked "AI guess" by the core). no_answer is llm-no-answer, canary canary-in-value, sensitive
 * llm-disabled-for-category, and every other reason, a value of the wrong shape, or an item answered twice or not at
 * all, llm-invalid-output.
 *
 * A run's questions (createRunAi): AI_RUN_TASKS (two since v5) tasks in flight per run, batches in the order they
 * were asked (classify, pick, draft, answer), the answers kept for the run only (memory). Nothing here logs an item,
 * a label or an answer: counts and statuses only.
 *
 * v5 p2-stream (Jobright parity, Phase 2: each answer fills as it lands). Where TailorIT streams (GET
 * /api/ai/tasks/:id/stream), a batch is asked with `Prefer: respond-async` (202 at once) and its task's stream is read:
 * each answer or draft TailorIT settles comes as it lands and is that key's verdict at once (a key of the batch, once;
 * the same translation as the finished task's, answerVerdicts and draftVerdicts over that one item), so the key's
 * state is done before its batch is, and the run's `onReady` hears it (the planner then tells the frame, plan/ready,
 * which polls at once). The stream's finished task ends the batch as a poll's would. Polling stays the fallback: a
 * stream that ends without its task (cut, idle 25 s, the cap), a stream TailorIT does not have (its 404 while the task
 * itself answers: streamOff for the worker's life) or any failure of it goes on polling the same task within the same
 * cap. A key answered on the stream keeps that verdict when its task then fails (what was written stands); a finished
 * task whose result differs from what streamed (TailorIT promises it never does) wins for later plans, logged as a
 * count. A batch's end tells `onReady` too, so the frame plans its keys at once instead of at its next poll.
 *
 * v5 p2-stream (one round; the coordinator's follow-up): an answer item the core marks `classify` (a question nothing
 * classified: frame.ts) goes with its category asked too, on the request's `platform` (one batch per platform; an item
 * of a platform TailorIT's contract does not name is asked as a plain answer, its classification unknown-field at
 * once, as a classify batch would withhold it). Its answer comes with `classification`, which becomes the key's
 * classification verdict as a classify task's would (oneRoundClassifications), and its answer verdict is marked
 * `oneRound` with its scope, so planFrame uses it only where that category leaves the question to the AI. A TailorIT
 * that answers such an item with no classification (one before v5's one round) has its answer dropped, unread, and
 * the worker asks classifications first for the rest of its life (oneRoundUsable false).
 * The P2 review: H1, what streamed is kept by its batch (a field asked again in another batch, a draft after a
 * free-text classification, waits for that batch, takes its stream and its failure); M1, an item asked with its
 * category that TailorIT's answer screen held back (`sensitive`, or the extension's own answer screen withheld) is
 * classified first, by a classify task, as before one round (RunAi.answers.classifyFirst).
 * v5 p2-stream (two at once): a run has up to AI_RUN_TASKS (2) tasks in flight, in the order its batches were asked,
 * as TailorIT runs two CLI processes of an account at once (AI_CLI_PER_ACCOUNT); idle() waits for every one.
 *
 * v1.3 B (the coordinator's decision 5, the run-start batch): when the job's questions are known (POST /forms/known),
 * the planner plans them once at the run's first plan and hands RunAi.prefetch the answer items that neither the
 * profile nor an earlier answer covers, across every step: they go as answer batches at once, under keys of their own
 * (`known|…`, never a field's). A later plan's answer item whose question, kind, shape, scope, options (by their
 * labels' hashes), cap and layout are the same (signatureOf) takes that answer instead of being asked again: at once
 * when it is in, else with its batch (its stream included); a choice's option index is the field's own option with the
 * same label hash. An answer that failed, or none at all, is asked again as before. The item went through the same
 * screens as any (answerBatches' own, the core's): a sensitive question, hidden text, a profile-only run and a dry run
 * are never asked, here as anywhere.
 */
import {
  answerInFormat, ATS_KINDS, AUTOFILL_AI_LIMITS, AUTOFILL_AI_POLL_MS, AUTOFILL_PICK_CATEGORIES, cutAtWord, type AtsKind,
  type AutofillAnswerItem, type AutofillAnswerReason, type AutofillAnswerRequest, type AutofillAnswerResult,
  type AutofillClassifyItem,
  type AutofillClassifyRequest, type AutofillClassifyResult, type AutofillDraftReason, type AutofillDraftRequest,
  type AutofillDraftResult, type AutofillPickItem, type AutofillPickRequest, type AutofillPickResult,
  type AutofillTaskView,
} from '../contract/tailorit';
import { ANSWER_MAX_ITEMS, ANSWER_TEXT_MAX, DRAFT_MAX_QUESTIONS, TIEBREAK_REQUEST_TEXT_SHARE } from '../core/confidence';
import type { Platform } from '../core/enums';
import { readTiebreakReply, tiebreakRequests } from '../core/matcher/tiebreak';
import type { TiebreakItem, TiebreakVerdict } from '../core/matcher/types';
import { attentionHits } from '../core/guard/attention';
import { hasTripwire } from '../core/guard/tripwire';
import {
  allowanceOf, namesUnanswerableTopic, type AnswerDiscard, type AnswerItem, type AnswerScope, type AnswerVerdict,
} from '../core/plan/answers';
import type { DraftDiscard, DraftItem, DraftVerdict } from '../core/plan/drafts';
import type { AnsweredVerdict, PlanAi, PlanAsk } from '../core/plan/types';
import type { RepeatableRequest } from '../core/steps/blocks';
import {
  namesSensitiveAnswer, namesSensitivePickValue, namesSensitiveTopic, openTopicsOfTexts, type ClassifyItem,
  type ClassifyVerdict,
} from '../core/resolver/classify';
import { sha256Hex } from '../core/text/sha256';
// v1.3 B
import { normalizeLabel } from '../core/text/normalize';
import type { BaseKey, FieldKey, FieldSpec } from '../core/types/field';
import type { Settings } from '../core/types/settings';
import type { VisibleText } from '../core/types/text';
import type { Vocab } from '../core/vocab/types';
import { log } from '../shared/log';
import type { AiStreamOptions, ServerClient, ServerResult } from './server-client';
import type { Timers } from './timers';

/** A batch's task is given up this long after it was first submitted (docs/ARCHITECTURE.md: the 120 s cap). */
export const AI_TASK_CAP_MS = 120_000;

/** v5 p2-stream: the tasks one run has in flight at once (TailorIT's AUTOFILL_AI_MAX_ACTIVE_PER_KIND places, and its
 *  two CLI processes an account runs at once). */
export const AI_RUN_TASKS = 2;

/** The kinds of task the worker submits: picks and classifications (Phase 4), drafts (Phase 6), answers (the owner's
 *  amendments). */
export const AI_KINDS = ['pick', 'classify', 'draft', 'answer'] as const;
export type AiKind = (typeof AI_KINDS)[number];

/** A classify request is filled to at most this many characters of text (TailorIT refuses above 100,000). */
const CLASSIFY_TEXT_BUDGET = Math.floor(AUTOFILL_AI_LIMITS.requestText * TIEBREAK_REQUEST_TEXT_SHARE);

// ── Translation ────────────────────────────────────────────────────────────────────────────────────────────────────

const PICK_CATEGORY_SET: ReadonlySet<string> = new Set(AUTOFILL_PICK_CATEGORIES);
const codePoints = (text: string) => [...text].length;

/** A verdict that keeps the cascade's own answer: the LLM gave nothing. */
function verdictOf(item: Pick<TiebreakItem, 'id' | 'optionSetHash'>, why: TiebreakVerdict['why']): TiebreakVerdict {
  return { id: item.id, optionSetHash: item.optionSetHash, picked: null, labelHash: null, why };
}

/**
 * The pick item TailorIT is sent for a core item, or null when it is never sent: a category outside TailorIT's pick
 * categories, a label, value or alias naming a sensitive topic or a sum, a string over TailorIT's caps, or no candidate
 * left once the injected and hard-conflict ones are withheld.
 */
export function pickItemOf(item: TiebreakItem): AutofillPickItem | null {
  const limits = AUTOFILL_AI_LIMITS.pick;
  if (!PICK_CATEGORY_SET.has(item.category)) return null;
  // A school's, a degree's or a field of study's value is screened only for a sum ("Gender Studies" is a field's name:
  // the review, T-F4); TailorIT compares it with the person's sensitive answers too.
  if (namesSensitiveTopic(item.fieldLabel)
    || [item.intended, ...item.aliases].some((value) => namesSensitivePickValue(value, item.category))) return null;
  const options = item.candidates.filter((candidate) => !candidate.hardConflict && !candidate.injected)
    .map((candidate) => ({ index: candidate.optionIndex, label: candidate.label as string }));
  if (options.length === 0 || options.length > limits.options) return null;
  if (codePoints(item.id) > AUTOFILL_AI_LIMITS.key || codePoints(item.intended) > limits.intendedValue
    || codePoints(item.fieldLabel) > limits.label || options.some((option) => codePoints(option.label) > limits.optionLabel)) {
    return null;
  }
  const aliases = item.aliases.filter((alias) => codePoints(alias) <= limits.alias).slice(0, limits.aliases);
  return { key: item.id, category: item.category, optionSetHash: item.optionSetHash, intendedValue: item.intended,
    aliases, label: item.fieldLabel, options };
}

/** A batch: the request's body and the core items it holds. */
export interface PickBatch {
  kind: 'pick';
  body: AutofillPickRequest;
  items: TiebreakItem[];
  /** The profile's revision the values were taken from: the batch's name holds it instead of the values. */
  revision: number;
}
export interface ClassifyBatch {
  kind: 'classify';
  body: AutofillClassifyRequest;
  items: ClassifyItem[];
}
export interface DraftBatch {
  kind: 'draft';
  body: AutofillDraftRequest;
  items: DraftItem[];
}
export interface AnswerBatch {
  kind: 'answer';
  body: AutofillAnswerRequest;
  items: AnswerItem[];
}
export type AiBatch = PickBatch | ClassifyBatch | DraftBatch | AnswerBatch;

/** A pass's tiebreak items as pick batches (the core's tiebreakRequests: at most 20 items, under the text cap), and
 *  the verdicts of those never sent. `revision` is the profile's the values came from. */
export function pickBatches(items: readonly TiebreakItem[], revision = 0):
  { batches: PickBatch[]; withheld: TiebreakVerdict[] } {
  const withheld: TiebreakVerdict[] = [];
  const sendable: TiebreakItem[] = [];
  for (const item of items) {
    if (pickItemOf(item) === null) withheld.push(verdictOf(item, 'no-match'));
    else sendable.push(item);
  }
  const batches: PickBatch[] = [];
  for (const request of tiebreakRequests(sendable)) {
    const sent = request.items.map((item) => ({ item, pick: pickItemOf(item)! }));
    batches.push({ kind: 'pick', body: { items: sent.map(({ pick }) => pick) }, items: sent.map(({ item }) => item),
      revision });
  }
  // tiebreakRequests drops what it may not send (a clash of ids): those keep the cascade's answer too.
  const batched = new Set(batches.flatMap((batch) => batch.items.map((item) => item.id)));
  for (const item of sendable) if (!batched.has(item.id)) withheld.push(verdictOf(item, 'llm-invalid-output'));
  return { batches, withheld };
}

/** The classify item TailorIT is sent, or null when its screen fails again (it is then needs-user, never sent). */
export function classifyItemOfCore(item: ClassifyItem): AutofillClassifyItem | null {
  const max = AUTOFILL_AI_LIMITS.classify.text;
  if ([item.label, item.hint, item.section, ...item.options].some(namesSensitiveTopic)) return null;
  if (codePoints(item.key) > AUTOFILL_AI_LIMITS.key) return null;
  const cut = (text: string) => cutAtWord(text, max);
  return { key: item.key, kind: item.kind, label: cut(item.label), hint: cut(item.hint), section: cut(item.section),
    options: item.options.slice(0, AUTOFILL_AI_LIMITS.classify.options).map(cut) };
}

/** The text a classify item holds, as TailorIT counts it. */
const textOf = (item: AutofillClassifyItem) => [item.key, item.kind, item.label, item.hint, item.section, ...item.options]
  .reduce((sum, text) => sum + text.length, 0);

/** Whether TailorIT's contract names a platform (its ATS_KINDS): a classify request names the form's platform, and one
 *  it does not list (PLATFORMS_AHEAD_OF_CONTRACT: since its API 6, `site` alone, a company's own page) would be
 *  refused. Every ATS's items, the new ATSs' and SmartRecruiters' included, are asked under their own platform. */
const knownToTailorIt = (platform: Platform): platform is AtsKind => (ATS_KINDS as readonly string[]).includes(platform);

/** A pass's classify items as batches, per platform, at most 20 items each and under the text cap, and the verdicts
 *  of those never sent: screened ones (llm-disabled-for-category), and those of a platform TailorIT's contract does not
 *  name yet (unknown-field, as when the AI names none: the field goes on to the AI answer, which names no platform). */
export function classifyBatches(items: readonly ClassifyItem[]): { batches: ClassifyBatch[]; withheld: ClassifyVerdict[] } {
  const withheld: ClassifyVerdict[] = [];
  const byPlatform = new Map<AtsKind, Array<{ item: ClassifyItem; sent: AutofillClassifyItem }>>();
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    const sent = classifyItemOfCore(item);
    const platform = item.platform;
    if (sent === null) withheld.push({ key: item.key, category: null, why: 'llm-disabled-for-category' });
    else if (!knownToTailorIt(platform)) withheld.push({ key: item.key, category: null, why: 'unknown-field' });
    else byPlatform.set(platform, [...(byPlatform.get(platform) ?? []), { item, sent }]);
  }
  const batches: ClassifyBatch[] = [];
  for (const [platform, entries] of byPlatform) {
    let chunk: typeof entries = [];
    let size = 0;
    const flush = () => {
      if (chunk.length === 0) return;
      batches.push({ kind: 'classify', body: { platform, items: chunk.map(({ sent }) => sent) },
        items: chunk.map(({ item }) => item) });
      chunk = [];
      size = 0;
    };
    for (const entry of entries) {
      const text = textOf(entry.sent);
      if (chunk.length === AUTOFILL_AI_LIMITS.classify.items || (chunk.length > 0 && size + text > CLASSIFY_TEXT_BUDGET)) flush();
      chunk.push(entry);
      size += text;
    }
    flush();
  }
  return { batches, withheld };
}

// ── Drafts (Phase 6) ───────────────────────────────────────────────────────────────────────────────────────────────

/** What every draft request of a pass carries besides its questions and the run's canaries: the posting's visible text
 *  as the frame read it ('' for a form embedded in another page), the lookup's company and job title ('' without a
 *  job), and the resume the run attaches (null: TailorIT chooses). */
export interface DraftContext {
  jobText: string;
  company: string;
  jobTitle: string;
  resumeId: string | null;
}

/** TailorIT's reasons for no draft, as the core's (module header). */
const DRAFT_DISCARDS: Readonly<Record<Exclude<AutofillDraftReason, 'drafted' | 'trimmed'>, DraftDiscard>> = {
  empty: 'draft-empty',
  too_long: 'draft-too-long',
  canary: 'canary-in-value',
  ai_reference: 'draft-ai-reference',
  wrapper: 'draft-wrapper',
  contact: 'draft-contact',
  invalid: 'llm-invalid-output',
  sensitive: 'llm-disabled-for-category',
};

/** A pass's draft questions as draft batches (at most DRAFT_MAX_QUESTIONS each, every string within TailorIT's caps,
 *  cut after a whole word), and the verdicts of those never sent: a question naming a sensitive topic, a rewrite whose
 *  current text names a sensitive answer, a sum, a contact detail or a postal address (namesSensitiveAnswer, over the
 *  vocabulary) or holds text addressed to AI tools (the tripwire: the audit of 2026-11-06, S-10), or a key past
 *  TailorIT's cap. */
export function draftBatches(items: readonly DraftItem[], context: DraftContext, canaries: readonly string[],
  vocab: Vocab, rewrite?: { key: string; instruction: string }): { batches: DraftBatch[]; withheld: DraftVerdict[] } {
  const limits = AUTOFILL_AI_LIMITS.draft;
  const withheld: DraftVerdict[] = [];
  const sendable: DraftItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    // A rewrite's current text is screened as the core screens it (the Phase E review, MAJOR 3): what the box holds may
    // state a sensitive answer, a sum or a contact detail.
    // v3 Phase 3b: Edit with AI's instruction, the person's own words, is screened as the box's text is: one naming a
    // sensitive topic, or stating a sensitive answer, a sum, a contact detail or a postal address, is never sent.
    // The audit of 2026-11-06 (S-10): a rewrite's current text that holds words addressed to AI tools (the tripwire, as
    // the core screens it) is never sent: the page may have written it.
    const instruction = rewrite !== undefined && rewrite.key === item.key ? rewrite.instruction : undefined;
    if (namesSensitiveTopic(item.question)
      || (item.current !== undefined && namesSensitiveAnswer(item.current, vocab))
      || (item.current !== undefined && hasTripwire(item.current as string as VisibleText))
      || (instruction !== undefined && (namesSensitiveTopic(instruction) || namesSensitiveAnswer(instruction, vocab)))) {
      withheld.push({ key: item.key, text: null, why: 'llm-disabled-for-category' });
    } else if (codePoints(item.key) > AUTOFILL_AI_LIMITS.key || item.question.trim() === '') {
      withheld.push({ key: item.key, text: null, why: 'llm-invalid-output' });
    } else sendable.push(item);
  }
  const sent = canaries.filter((canary) => codePoints(canary) >= 2 && codePoints(canary) <= limits.canary)
    .slice(0, limits.canaries);
  const batches: DraftBatch[] = [];
  for (let at = 0; at < sendable.length; at += DRAFT_MAX_QUESTIONS) {
    const chunk = sendable.slice(at, at + DRAFT_MAX_QUESTIONS);
    batches.push({ kind: 'draft', items: chunk, body: {
      questions: chunk.map((item) => ({ key: item.key, question: cutAtWord(item.question, limits.question),
        maxLength: item.maxLength,
        ...(item.current === undefined ? {} : { currentAnswer: cutAtWord(item.current, limits.currentAnswer) }),
        ...(rewrite !== undefined && rewrite.key === item.key
          ? { instruction: cutAtWord(rewrite.instruction, limits.instruction) } : {}) })),
      jobText: cutAtWord(context.jobText, limits.jobText),
      company: cutAtWord(context.company, limits.company),
      jobTitle: cutAtWord(context.jobTitle, limits.jobTitle),
      resumeId: context.resumeId,
      canaries: sent,
    } });
  }
  return { batches, withheld };
}

/** The verdicts of a draft task's result for the questions it was asked (module header). */
export function draftVerdicts(items: readonly DraftItem[], result: AutofillDraftResult, taskId: string):
  Map<string, DraftVerdict> {
  const byKey = new Map<string, AutofillDraftResult['drafts']>();
  for (const draft of result.drafts) byKey.set(draft.key, [...(byKey.get(draft.key) ?? []), draft]);
  const verdicts = new Map<string, DraftVerdict>();
  for (const item of items) {
    const drafts = byKey.get(item.key) ?? [];
    const draft = drafts[0];
    let verdict: DraftVerdict;
    if (drafts.length !== 1 || draft === undefined) verdict = { key: item.key, text: null, why: 'llm-invalid-output' };
    else if (draft.reason === 'drafted' || draft.reason === 'trimmed') {
      verdict = draft.text === null || draft.text.trim() === '' ? { key: item.key, text: null, why: 'llm-invalid-output' }
        : { key: item.key, text: draft.text, taskId };
    } else {
      verdict = { key: item.key, text: null,
        why: draft.text === null ? DRAFT_DISCARDS[draft.reason] : 'llm-invalid-output' };
    }
    verdicts.set(item.key, verdict);
  }
  return verdicts;
}

// ── Answers (the owner's amendments) ───────────────────────────────────────────────────────────────────────────────

/** An answer request is filled to at most this many characters of text (TailorIT refuses above 100,000). */
const ANSWER_TEXT_BUDGET = Math.floor(AUTOFILL_AI_LIMITS.requestText * TIEBREAK_REQUEST_TEXT_SHARE);

/** Whether an item of the `all` scope is screened out again (the owner's decision of 2026-11-01): a topic of its
 *  question, hint, section or options the scope never asks about (a consent only in an attention check's own words),
 *  an EEO answer among its options, a decline option beside no open topic (classify.ts openTopicsOfTexts), or what an
 *  answer never states with what its topics let it name (namesUnanswerableTopic, allowanceOf). */
function openItemWithheld(item: AnswerItem, labels: readonly string[], vocab: Vocab): boolean {
  const attention = attentionHits(item.question, item.hint).length > 0;
  const topics = openTopicsOfTexts([item.question, item.hint, item.section], labels, vocab, attention);
  if (topics === null) return true;
  const allow = allowanceOf(topics, attention);
  return [item.question, item.hint, item.section, ...labels].some((text) => namesUnanswerableTopic(text, allow));
}

/** The answer item TailorIT is sent for a core item, or null when it is never sent: a question, hint, section or option
 *  naming a sensitive topic, or what an answer never states (another person, an identifier, a postal address, a
 *  security clearance, an "I did not use AI" attestation: namesUnanswerableTopic, the Phase E review, M2), screened
 *  again (an item of the `all` scope by openItemWithheld, with `vocab`); a key or a label past TailorIT's caps; or a
 *  shape that does not hold. */
export function answerItemOfCore(item: AnswerItem, vocab?: Vocab): AutofillAnswerItem | null {
  const limits = AUTOFILL_AI_LIMITS.answer;
  const labels = item.options.map((option) => option.label as string);
  const texts = [item.question, item.hint, item.section, ...labels];
  if (item.scope === 'all') {
    if (vocab === undefined || openItemWithheld(item, labels, vocab)) return null;
  } else if (texts.some((text) => namesSensitiveTopic(text)) || texts.some((text) => namesUnanswerableTopic(text))) {
    return null;
  }
  if (codePoints(item.key) > AUTOFILL_AI_LIMITS.key || item.question.trim() === '') return null;
  if (labels.some((label) => codePoints(label) > limits.optionLabel || label.trim() === '')) return null;
  if (item.shape === 'choice'
    ? item.optionSetHash === null || item.options.length < 2 || item.options.length > limits.options
    : item.options.length > 0 || (item.maxLength !== null && (item.maxLength < 1 || item.maxLength > limits.textMax))) {
    return null;
  }
  return { key: item.key, shape: item.shape, kind: item.kind, question: cutAtWord(item.question, limits.question),
    hint: cutAtWord(item.hint, limits.hint), section: cutAtWord(item.section, limits.section),
    optionSetHash: item.shape === 'choice' ? item.optionSetHash : null,
    options: item.options.map((option) => ({ index: option.index, label: option.label as string })),
    maxLength: item.shape === 'text' ? item.maxLength : null,
    // API 4: the layout a text's answer must have (a number box, a date box); never sent for a choice.
    ...(item.shape === 'text' && item.format !== null ? { format: item.format } : {}),
    // v5 p2-stream (one round): its category is asked too.
    ...(item.classify === true ? { classify: true as const } : {}) };
}

/** The text an answer item holds, as TailorIT counts it. */
const answerTextOf = (item: AutofillAnswerItem) => [item.key, item.shape, item.kind, item.question, item.hint,
  item.section, ...item.options.map((option) => option.label)].reduce((sum, text) => sum + text.length, 0);

/** A pass's answer items as answer batches (at most ANSWER_MAX_ITEMS each, under the text cap, each with the job
 *  context and the canaries, the items of each scope in batches of their own: the `all` scope only for the questions
 *  the standard one would not ask), and the verdicts of those never sent. */
export function answerBatches(items: readonly AnswerItem[], context: DraftContext, canaries: readonly string[],
  vocab?: Vocab): { batches: AnswerBatch[]; withheld: AnswerVerdict[]; classified: ClassifyVerdict[];
    classifyFirst: FieldKey[] } {
  const limits = AUTOFILL_AI_LIMITS.answer;
  const withheld: AnswerVerdict[] = [];
  /** v5 p2-stream (one round): the classifications of items asked as plain answers (a platform TailorIT does not
   *  name: unknown-field, as classifyBatches withholds it), and of items never sent (screened, as classify's). */
  const classified: ClassifyVerdict[] = [];
  /** The P2 review (M1): the items asked with their category that the answer screen withheld: classified first. */
  const classifyFirst: FieldKey[] = [];
  const sendable: Array<{ item: AnswerItem; sent: AutofillAnswerItem }> = [];
  const seen = new Set<string>();
  for (const asked of items) {
    if (seen.has(asked.key)) continue;
    seen.add(asked.key);
    const unnamed = asked.classify === true && (asked.platform === undefined || !knownToTailorIt(asked.platform));
    const item: AnswerItem = unnamed ? withoutClassify(asked) : asked;
    if (unnamed) classified.push({ key: item.key, category: null, why: 'unknown-field' });
    const sent = answerItemOfCore(item, vocab);
    if (sent === null) {
      // The P2 review (M1): an item the answer screen withholds, asked with its category, is classified first (a
      // classify task names what the answer screen may not ask about), its answer not asked.
      if (item.classify === true) classifyFirst.push(item.key);
      else withheld.push({ key: item.key, kind: 'none', why: 'llm-disabled-for-category' });
    } else sendable.push({ item, sent });
  }
  const shared = {
    jobText: cutAtWord(context.jobText, limits.jobText),
    company: cutAtWord(context.company, limits.company),
    jobTitle: cutAtWord(context.jobTitle, limits.jobTitle),
    resumeId: context.resumeId,
    canaries: canaries.filter((canary) => codePoints(canary) >= 2 && codePoints(canary) <= limits.canary)
      .slice(0, limits.canaries),
  };
  const sharedText = shared.jobText.length + shared.company.length + shared.jobTitle.length
    + (shared.resumeId ?? '').length + shared.canaries.reduce((sum, canary) => sum + canary.length, 0);
  const batches: AnswerBatch[] = [];
  // v5 p2-stream (one round): items that ask their category go in batches of their platform, which names it.
  const platformOf = (item: AnswerItem): AtsKind | null => (item.classify === true ? item.platform as AtsKind : null);
  for (const scope of ['standard', 'all'] as const satisfies readonly AnswerScope[]) {
    const inScope = sendable.filter(({ item }) => item.scope === scope);
    for (const platform of [...new Set(inScope.map(({ item }) => platformOf(item)))]) {
      let chunk: typeof sendable = [];
      let size = sharedText;
      const flush = () => {
        if (chunk.length === 0) return;
        batches.push({ kind: 'answer', body: { items: chunk.map(({ sent }) => sent), scope, ...shared,
          ...(platform === null ? {} : { platform }) }, items: chunk.map(({ item }) => item) });
        chunk = [];
        size = sharedText;
      };
      for (const entry of inScope.filter(({ item }) => platformOf(item) === platform)) {
        const text = answerTextOf(entry.sent);
        if (chunk.length === ANSWER_MAX_ITEMS || (chunk.length > 0 && size + text > ANSWER_TEXT_BUDGET)) flush();
        chunk.push(entry);
        size += text;
      }
      flush();
    }
  }
  return { batches, withheld, classified, classifyFirst };
}

/** v5 p2-stream (one round): an item asked as a plain answer, its category not asked. */
function withoutClassify(item: AnswerItem): AnswerItem {
  const { classify: _classify, platform: _platform, ...plain } = item;
  return plain;
}

/**
 * v5 p2-stream (one round): the classifications an answer task's result gives the items asked with `classify`, as a
 * classify task's would (classifyVerdicts): `classified` with a category is that category; `unknown` unknown-field;
 * `sensitive` llm-disabled-for-category; anything else llm-invalid-output. 'missing' for an item answered with no
 * classification (a TailorIT before v5's one round), or answered twice or not at all (llm-invalid-output then).
 */
export function oneRoundClassifications(items: readonly AnswerItem[], result: AutofillAnswerResult):
  Map<string, ClassifyVerdict | 'missing' | 'held'> {
  const byKey = new Map<string, AutofillAnswerResult['answers']>();
  for (const answer of result.answers) byKey.set(answer.key, [...(byKey.get(answer.key) ?? []), answer]);
  const verdicts = new Map<string, ClassifyVerdict | 'missing' | 'held'>();
  for (const item of items) {
    if (item.classify !== true) continue;
    const answers = byKey.get(item.key) ?? [];
    const classification = answers.length === 1 ? answers[0]!.classification : null;
    let verdict: ClassifyVerdict | 'missing' | 'held';
    if (classification === undefined) verdict = 'missing';
    else if (classification === null) verdict = { key: item.key, category: null, why: 'llm-invalid-output' };
    else if (classification.reason === 'classified' && classification.category !== null) {
      verdict = { key: item.key, category: classification.category, why: 'ok' };
    } else if (classification.reason === 'unknown') verdict = { key: item.key, category: null, why: 'unknown-field' };
    // The P2 review (M1): held back by TailorIT's answer screen, which also holds back the person's own details and,
    // under the standard scope, legal and pay questions: not classified, so a classify task names it (the profile's
    // value, or the `all` scope's question), as before one round.
    else if (classification.reason === 'sensitive') verdict = 'held';
    else verdict = { key: item.key, category: null, why: 'llm-invalid-output' };
    verdicts.set(item.key, verdict);
  }
  return verdicts;
}

/** TailorIT's reasons for no answer, as the core's (module header). */
const ANSWER_DISCARDS: Readonly<Record<Exclude<AutofillAnswerReason, 'answered'>, AnswerDiscard>> = {
  no_answer: 'llm-no-answer',
  invalid: 'llm-invalid-output',
  too_long: 'llm-invalid-output',
  canary: 'canary-in-value',
  ai_reference: 'llm-invalid-output',
  wrapper: 'llm-invalid-output',
  contact: 'llm-invalid-output',
  sensitive: 'llm-disabled-for-category',
};

/** The verdicts of an answer task's result for the items it was asked (module header). */
export function answerVerdicts(items: readonly AnswerItem[], result: AutofillAnswerResult, taskId: string):
  Map<string, AnswerVerdict> {
  const byKey = new Map<string, AutofillAnswerResult['answers']>();
  for (const answer of result.answers) byKey.set(answer.key, [...(byKey.get(answer.key) ?? []), answer]);
  const verdicts = new Map<string, AnswerVerdict>();
  for (const item of items) {
    const answers = byKey.get(item.key) ?? [];
    const answer = answers[0];
    const invalid: AnswerVerdict = { key: item.key, kind: 'none', why: 'llm-invalid-output' };
    let verdict: AnswerVerdict = invalid;
    if (answers.length === 1 && answer !== undefined) {
      if (answer.reason !== 'answered') {
        verdict = answer.index === null && answer.text === null
          ? { key: item.key, kind: 'none', why: ANSWER_DISCARDS[answer.reason] } : invalid;
      } else if (answer.basis !== null && item.shape === 'choice' && answer.text === null && answer.index !== null
        && answer.optionSetHash === item.optionSetHash && item.optionSetHash !== null) {
        const option = item.options.find((candidate) => candidate.index === answer.index);
        if (option !== undefined) {
          verdict = { key: item.key, kind: 'choice', optionSetHash: item.optionSetHash, index: option.index,
            labelHash: option.labelHash, basis: answer.basis, taskId };
        }
      } else if (answer.basis !== null && item.shape === 'text' && answer.index === null && answer.text !== null
        && answer.optionSetHash === null && answer.text.trim() !== '') {
        // A text asked in a layout is checked in it again, as TailorIT checks it (answerInFormat): one value of it, as
        // TailorIT writes it, or nothing.
        const text = item.format === null ? answer.text : answerInFormat(answer.text, item.format);
        if (text !== null) verdict = { key: item.key, kind: 'text', text, basis: answer.basis, taskId };
      }
    }
    // v5 p2-stream (one round): asked with its category, under this scope.
    verdicts.set(item.key, item.classify === true ? { ...verdict, oneRound: item.scope } : verdict);
  }
  return verdicts;
}

/**
 * What a batch's name is the hash of: a classify body whole (page text only); a pick body without its profile text
 * (each item's key, category, option-set hash and options), with the profile's revision instead, so a stored name
 * (RunState.aiTasks keeps it for a day) never stands for a value that can be guessed back from it (the review, R7),
 * and a profile edited since asks again.
 */
export function batchIdentity(batch: AiBatch): string {
  // A draft or an answer body holds page text, TailorIT's own company and title, a resume id and the page's canaries:
  // no profile.
  if (batch.kind === 'classify' || batch.kind === 'draft' || batch.kind === 'answer') return JSON.stringify(batch.body);
  return JSON.stringify({ revision: batch.revision, items: batch.body.items.map((item) => ({ key: item.key,
    category: item.category, optionSetHash: item.optionSetHash, options: item.options })) });
}

/** A batch's name: its kind and the hash of its identity, as RunState.aiTasks keys it (at most 64 characters). */
export function batchHash(batch: AiBatch): string {
  return `${batch.kind}:${sha256Hex(batchIdentity(batch)).slice(0, 32)}`;
}

/**
 * The verdicts of a pick task's result for the items it was asked. Each answer's option index becomes the core's
 * candidate position (an index that is no candidate's becomes one out of range), and the core's readTiebreakReply
 * judges it; `invalid` is llm-invalid-output, `sensitive` llm-disabled-for-category, and an item answered twice or
 * not at all llm-invalid-output.
 */
export function pickVerdicts(items: readonly TiebreakItem[], result: AutofillPickResult): Map<string, TiebreakVerdict> {
  const byKey = new Map<string, AutofillPickResult['picks']>();
  for (const pick of result.picks) byKey.set(pick.key, [...(byKey.get(pick.key) ?? []), pick]);
  const answers: Array<{ id: string; optionSetHash: string; index: number | null }> = [];
  const fixed = new Map<string, TiebreakVerdict>();
  for (const item of items) {
    const picks = byKey.get(item.id) ?? [];
    const pick = picks[0];
    if (picks.length !== 1 || pick === undefined || pick.optionSetHash !== item.optionSetHash) {
      fixed.set(item.id, verdictOf(item, 'llm-invalid-output'));
      continue;
    }
    if (pick.reason === 'invalid') fixed.set(item.id, verdictOf(item, 'llm-invalid-output'));
    else if (pick.reason === 'sensitive') fixed.set(item.id, verdictOf(item, 'llm-disabled-for-category'));
    else if (pick.reason === 'no_match' || pick.index === null) {
      if (pick.index !== null || pick.reason !== 'no_match') fixed.set(item.id, verdictOf(item, 'llm-invalid-output'));
      else answers.push({ id: item.id, optionSetHash: item.optionSetHash, index: null });
    } else {
      // The answer names an option's own index: the core judges its candidate by position.
      const position = item.candidates.findIndex((candidate) => candidate.optionIndex === pick.index);
      answers.push({ id: item.id, optionSetHash: item.optionSetHash, index: position >= 0 ? position : -1 });
    }
  }
  const verdicts = readTiebreakReply(items, { answers });
  for (const [id, verdict] of fixed) verdicts.set(id, verdict);
  return verdicts;
}

/** The classifications of a classify task's result for the items it was asked. */
export function classifyVerdicts(items: readonly ClassifyItem[], result: AutofillClassifyResult):
  Map<string, ClassifyVerdict> {
  const byKey = new Map<string, AutofillClassifyResult['items']>();
  for (const entry of result.items) byKey.set(entry.key, [...(byKey.get(entry.key) ?? []), entry]);
  const verdicts = new Map<string, ClassifyVerdict>();
  for (const item of items) {
    const entries = byKey.get(item.key) ?? [];
    const entry = entries[0];
    let verdict: ClassifyVerdict;
    if (entries.length !== 1 || entry === undefined) verdict = { key: item.key, category: null, why: 'llm-invalid-output' };
    else if (entry.reason === 'classified' && entry.category !== null) {
      verdict = { key: item.key, category: entry.category, why: 'ok' };
    } else if (entry.category !== null) verdict = { key: item.key, category: null, why: 'llm-invalid-output' };
    else if (entry.reason === 'unknown') verdict = { key: item.key, category: null, why: 'unknown-field' };
    else if (entry.reason === 'sensitive') verdict = { key: item.key, category: null, why: 'llm-disabled-for-category' };
    else verdict = { key: item.key, category: null, why: 'llm-invalid-output' };
    verdicts.set(item.key, verdict);
  }
  return verdicts;
}

/** Every item of a batch given up: what its fields get. */
function failedVerdicts(batch: AiBatch, why: 'llm-unavailable' | 'llm-invalid-output'):
  { picks: TiebreakVerdict[]; classes: ClassifyVerdict[]; drafts: DraftVerdict[]; answers: AnswerVerdict[] } {
  const none = { picks: [], classes: [], drafts: [], answers: [] };
  if (batch.kind === 'pick') return { ...none, picks: batch.items.map((item) => verdictOf(item, why)) };
  if (batch.kind === 'draft') return { ...none, drafts: batch.items.map((item) => ({ key: item.key, text: null, why })) };
  if (batch.kind === 'answer') {
    return { ...none, answers: batch.items.map((item): AnswerVerdict => ({ key: item.key, kind: 'none', why })) };
  }
  return { ...none, classes: batch.items.map((item) => ({ key: item.key, category: null, why })) };
}

// ── Submitting and polling ────────────────────────────────────────────────────────────────────────────────────────

/** A batch's task id by the batch's hash: RunState.aiTasks (runstate-store.ts), for one run's application and tab. */
export interface AiTaskIds {
  get(hash: string): Promise<string | null>;
  note(hash: string, taskId: string): Promise<void>;
  forget(hash: string): Promise<void>;
  /** Whether the application has any task noted (an earlier run of it asked TailorIT's AI): an "I did not use AI"
   *  attestation is then untrue (the owner's decision of 2026-11-01). Absent: none known. */
  any?(): Promise<boolean>;
}

/** How a batch's task ended: its result, or why there is none. */
export type TaskOutcome =
  | { ok: true; taskId: string; result: AutofillPickResult | AutofillClassifyResult | AutofillDraftResult
      | AutofillAnswerResult }
  | { ok: false; why: 'llm-unavailable' | 'llm-invalid-output'; timedOut?: boolean };

/** What the task client needs. Never a cancel: a task TailorIT deduplicated may be another caller's too, and TailorIT
 *  prunes every task within its hour (the review, T-F2). */
export interface AiTasksDeps {
  /** v5 p2-stream: `aiTaskStream` where the worker reads a task's stream (absent: it polls, as before). */
  server: Pick<ServerClient, 'aiPick' | 'aiClassify' | 'aiDraft' | 'aiAnswer' | 'aiTask'>
    & Partial<Pick<ServerClient, 'aiTaskStream'>>;
  timers: Timers;
  now(): number;
}

/** Failures worth another poll: the next one may answer. */
const TRANSIENT: ReadonlySet<string> = new Set(['timeout', 'unreachable', 'server-error', 'rate-limited']);

const TASK_KIND = { pick: 'autofill_pick', classify: 'autofill_classify', draft: 'autofill_draft',
  answer: 'autofill_answer' } as const;

/** v5 p2-stream: an answer or a draft as the task's stream brought it. */
export type StreamedItem = Parameters<AiStreamOptions['onEvent']>[0];

/** v5 p2-stream: what a run gives a batch's task besides its questions: where streamed items go (with the task's id),
 *  and the signal that ends the stream when the run goes. */
export interface RunHooks {
  onItem?(item: StreamedItem, taskId: string): void;
  signal?: AbortSignal;
}

/** The task client: runs one batch's task to its end. */
export interface AiTasks {
  /** Submits a batch (or reads its known task), polls it, and answers how it ended. `active` false stops it (the run
   *  went), cancelling the task. v5 p2-stream: reads the task's stream first, where TailorIT has one (`hooks`). */
  run(batch: AiBatch, ids: AiTaskIds, active: () => boolean, hooks?: RunHooks): Promise<TaskOutcome>;
  /** v5 p2-stream (one round): whether TailorIT classifies within an answer task, as far as this worker knows. */
  oneRoundUsable?(): boolean;
  /** v5 p2-stream (one round): TailorIT answered an item asked with its category without one. */
  oneRoundMissing?(): void;
}

export function createAiTasks(deps: AiTasksDeps): AiTasks {
  /** The tasks this worker has in flight, so an ai_busy waits for one of them to end. */
  const inFlight = new Set<Promise<unknown>>();
  /** Those of them waiting because TailorIT answered ai_busy: they hold no place there. */
  const busyWaiting = new Set<Promise<unknown>>();
  /** A wait on the worker's timers, and its cancel. */
  const timer = (ms: number) => {
    let cancel = () => undefined as void;
    const done = new Promise<void>((resolve) => {
      cancel = deps.timers.after(Math.max(0, ms), resolve);
    });
    return { done, cancel };
  };
  const wait = (ms: number) => timer(ms).done;
  // v5 p2-stream: TailorIT answered a task's stream 404 while the task itself answered: it has no stream, so this
  // worker polls from now on (a new worker tries again).
  let streamOff = false;
  const streams = () => deps.server.aiTaskStream !== undefined && !streamOff;

  /** A finished view as an outcome ('cancelled' for a task someone cancelled), or null while it is queued or running. */
  function settled(batch: AiBatch, view: AutofillTaskView): TaskOutcome | 'cancelled' | null {
    if (view.kind !== TASK_KIND[batch.kind]) return { ok: false, why: 'llm-invalid-output' };
    if (view.status === 'queued' || view.status === 'running') return null;
    if (view.status === 'cancelled') return 'cancelled';
    if (view.status !== 'succeeded') return { ok: false, why: 'llm-unavailable' };
    return view.result === null ? { ok: false, why: 'llm-invalid-output' } : { ok: true, taskId: view.id, result: view.result };
  }

  async function submit(batch: AiBatch): Promise<ServerResult<{ done: true; task: AutofillTaskView } | { done: false; taskId: string }>> {
    // v5 p2-stream: a worker that reads the stream asks for the 202 at once.
    const options = streams() ? { async: true } : undefined;
    if (batch.kind === 'pick') return deps.server.aiPick(batch.body, options);
    if (batch.kind === 'answer') return deps.server.aiAnswer(batch.body, options);
    return batch.kind === 'draft' ? deps.server.aiDraft(batch.body, options) : deps.server.aiClassify(batch.body, options);
  }

  // v5 p2-stream
  /**
   * The task's stream, read until its finished task, the cap, or the run's end: its items go to `hooks.onItem` as they
   * land. Answers the finished task's outcome ('cancelled' for one someone cancelled), 'poll' when the stream ended
   * without it (or failed), and 'probe' when TailorIT answered it 404 (no stream, or the task gone: the next poll says).
   */
  async function streamOf(batch: AiBatch, taskId: string, cap: number, hooks: RunHooks):
    Promise<TaskOutcome | 'cancelled' | 'poll' | 'probe'> {
    const left = cap - deps.now();
    const read = deps.server.aiTaskStream;
    if (left <= 0 || read === undefined) return 'poll';
    const ended = new AbortController();
    const cancel = deps.timers.after(left, () => ended.abort());
    try {
      const signal = hooks.signal === undefined ? ended.signal : AbortSignal.any([ended.signal, hooks.signal]);
      const answer = await read(taskId, { signal, onEvent: (item) => hooks.onItem?.(item, taskId) });
      if (!answer.ok) return answer.failure === 'not-found' ? 'probe' : 'poll';
      if (answer.value === null) return 'poll';
      return settled(batch, answer.value) ?? 'poll';
    } finally {
      cancel();
    }
  }
  // v5 p2-stream end

  async function execute(batch: AiBatch, ids: AiTaskIds, active: () => boolean, self: Promise<unknown>,
    hooks: RunHooks = {}): Promise<TaskOutcome> {
    const hash = batchHash(batch);
    const cap = deps.now() + AI_TASK_CAP_MS;
    let taskId: string | null = await ids.get(hash);
    /** A task found cancelled is asked once more: TailorIT shares one task between callers that ask the same, and one
     *  of them (an older extension, another tab) may have cancelled it (the review, T-F2). */
    let askedAgain = false;
    const askAgain = async (): Promise<boolean> => {
      await ids.forget(hash);
      if (askedAgain) return false;
      askedAgain = true;
      log('ai.cancelled', { items: batch.items.length, again: true });
      return true;
    };

    // A task this batch already has (a restart, a reload): read it again rather than ask again.
    if (taskId !== null) {
      const known = await deps.server.aiTask(taskId);
      const outcome = known.ok ? settled(batch, known.value) : null;
      if (known.ok && outcome === null) {
        log('ai.reattached', { items: batch.items.length });
      } else if (outcome !== null && outcome !== 'cancelled' && outcome.ok) {
        log('ai.reattached', { items: batch.items.length, finished: true });
        return outcome;
      } else {
        // Gone (its hour passed), failed or cancelled: ask again (a cancelled one is the one more ask).
        if (outcome === 'cancelled') await askAgain();
        else await ids.forget(hash);
        taskId = null;
      }
    }

    for (;;) {
      while (taskId === null) {
        if (!active()) return { ok: false, why: 'llm-unavailable' };
        const answer = await submit(batch);
        if (answer.ok) {
          if (answer.value.done) {
            const outcome = settled(batch, answer.value.task);
            if (outcome === 'cancelled') {
              if (await askAgain()) continue;
              return { ok: false, why: 'llm-unavailable' };
            }
            if (outcome !== null) {
              if (outcome.ok) await ids.note(hash, outcome.taskId);
              log('ai.answered', { items: batch.items.length, waited: false, ok: outcome.ok });
              return outcome;
            }
            // A 200 with an unfinished task: poll it like a 202.
            taskId = answer.value.task.id;
          } else {
            taskId = answer.value.taskId;
          }
          await ids.note(hash, taskId);
          log('ai.submitted', { items: batch.items.length });
          break;
        }
        const busy = answer.failure === 'conflict' && answer.code === 'ai_busy';
        if (!busy) {
          log('ai.failed', { items: batch.items.length, ...(answer.status === undefined ? {} : { status: answer.status }) });
          return { ok: false, why: answer.failure === 'bad-answer' ? 'llm-invalid-output' : 'llm-unavailable' };
        }
        // TailorIT holds two of this kind for the account: finish one in flight, then try again.
        log('ai.busy', { items: batch.items.length });
        const left = cap - deps.now();
        if (left <= 0) return { ok: false, why: 'llm-unavailable', timedOut: true };
        // Only a task that holds a place counts: two that both wait on ai_busy (the places held elsewhere) would
        // otherwise wait on each other until their caps.
        const others = [...inFlight].filter((task) => task !== self && !busyWaiting.has(task));
        const capped = timer(others.length > 0 ? left : Math.min(AUTOFILL_AI_POLL_MS, left));
        busyWaiting.add(self);
        await Promise.race([...others.map((task) => task.then(() => undefined, () => undefined)), capped.done]);
        busyWaiting.delete(self);
        capped.cancel();
      }

      let cancelled = false;
      // v5 p2-stream: the task's stream first, where TailorIT has one; what it leaves is polled as before.
      let probe = false;
      if (streams() && active()) {
        const streamed = await streamOf(batch, taskId, cap, hooks);
        if (streamed === 'cancelled') cancelled = true;
        else if (streamed === 'probe') probe = true;
        else if (streamed !== 'poll') {
          if (streamed.ok) await ids.note(hash, streamed.taskId);
          log('ai.answered', { items: batch.items.length, waited: true, ok: streamed.ok, streamed: true });
          return streamed;
        }
      }
      for (;;) {
        if (cancelled) break;
        const left = cap - deps.now();
        if (left <= 0 || !active()) break;
        await wait(Math.min(AUTOFILL_AI_POLL_MS, left));
        if (!active()) break;
        const view = await deps.server.aiTask(taskId);
        // v5 p2-stream: the task answers where its stream did not: this TailorIT has none.
        if (probe && view.ok) {
          probe = false;
          streamOff = true;
          log('ai.stream-unsupported');
        }
        if (view.ok) {
          const outcome = settled(batch, view.value);
          if (outcome === 'cancelled') {
            cancelled = true;
            break;
          }
          if (outcome !== null) {
            log('ai.answered', { items: batch.items.length, waited: true, ok: outcome.ok });
            return outcome;
          }
          continue;
        }
        if (TRANSIENT.has(view.failure)) continue;
        if (view.failure === 'not-found') await ids.forget(hash);
        log('ai.failed', { items: batch.items.length, ...(view.status === undefined ? {} : { status: view.status }) });
        return { ok: false, why: view.failure === 'bad-answer' ? 'llm-invalid-output' : 'llm-unavailable' };
      }
      if (cancelled) {
        taskId = null;
        if (await askAgain()) continue;
        return { ok: false, why: 'llm-unavailable' };
      }
      // The cap, or the run went: the task is left to TailorIT, which prunes it (a cancel would end it for every
      // caller sharing it), and its id kept, so the batch asked again reads it. Its fields are the person's.
      const timedOut = active();
      if (timedOut) log('ai.timed-out', { items: batch.items.length });
      return { ok: false, why: 'llm-unavailable', timedOut };
    }
  }

  // v5 p2-stream (one round): TailorIT answered an item asked with its category without one (a TailorIT before it).
  let oneRoundOff = false;

  return {
    oneRoundUsable: () => !oneRoundOff,
    oneRoundMissing() {
      if (!oneRoundOff) log('ai.one-round-unsupported');
      oneRoundOff = true;
    },
    run(batch, ids, active, hooks) {
      let self: Promise<TaskOutcome> | null = null;
      const started = Promise.resolve().then(() => execute(batch, ids, active, self!, hooks))
        .catch((): TaskOutcome => ({ ok: false, why: 'llm-unavailable' }));
      self = started;
      inFlight.add(started);
      void started.finally(() => inFlight.delete(started));
      return started;
    },
  };
}

// ── One run's questions ────────────────────────────────────────────────────────────────────────────────────────────

/** Where a waiting field stands. */
export type AwaitState = 'done' | 'waiting' | 'unknown';

/** What a waiting key was asked from: the request's scan and canaries, which it is planned again with once answered,
 *  and its repeatable sections with the entries their blocks were given (Phase 5), so it is filled from the same one. */
export interface AskContext {
  specs: readonly FieldSpec[];
  canaries: readonly string[];
  repeatables?: readonly RepeatableRequest[];
  /** The posting's visible text the frame sent with the request (Phase 6, drafts on, the top frame only). */
  postingText?: string;
  /** The loop's reveal edges the frame sent with the request ([parent, child] base keys), for a draft's context (the
   *  Phase 6 review, E2). */
  revealEdges?: ReadonlyArray<readonly [BaseKey, BaseKey]>;
  /** What a draft or an answer request carries besides its questions (Phase 6; the owner's amendments), made from
   *  postingText and the run's lookup when a plan first asks for either; absent: none is sent. */
  draft?: DraftContext;
  /** The request said its run fills from the profile only (plan/request's noAi): planned again the same way. */
  noAi?: boolean;
  /** Edit with AI: the one key this context rewrites (draft/rewrite), planned again as a rewrite. */
  rewrite?: FieldKey;
  /** v3 Phase 3b: the person's instruction for that rewrite (draft/rewrite's `instruction`), trimmed, never empty. */
  instruction?: string;
  /** Phase G: the company and job title the frame's page title names (plan/request's `posting`), for a cover letter
   *  of a posting TailorIT does not have. Page text, memory only. */
  posting?: { company: string; title: string };
}

/** One run's LLM questions and answers, in the worker's memory for the run only. */
export interface RunAi {
  /** The answers so far, as planFrame reads them. */
  readonly answers: PlanAi;
  /** Takes what a plan asks: its awaiting keys wait for their batches, two tasks at a time (v5); an item never sent is
   *  answered at once. `context` is what the keys are planned again with once answered, `revision` the profile's
   *  revision the plan read (a pick batch's name holds it instead of the values). */
  ask(ask: PlanAsk, awaiting: readonly FieldKey[], context: AskContext, llm: Settings['llm'], revision: number): void;
  /** Whether a key's answer is in (plan it again), still waited for, or unknown to this run (a worker that restarted). */
  state(key: FieldKey): AwaitState;
  /** What a waiting key was asked from. */
  contextOf(key: FieldKey): AskContext | undefined;
  /** The keys are planned again: they no longer wait. */
  settle(keys: readonly FieldKey[]): void;
  /** Edit with AI: the run's draft and answer of these keys are dropped, so their next plan asks again (a rewrite
   *  asked twice with the same text reads the same task, by its name). */
  forget(keys: readonly FieldKey[]): void;
  /** Settles when every batch asked so far has ended (for tests and the run's end). */
  idle(): Promise<void>;
  /** Whether this run has handed TailorIT's AI anything (a batch submitted): its "I did not use AI" attestation is
   *  then untrue (the owner's decision of 2026-11-01). */
  used(): boolean;
  /** The run went: nothing more is submitted, and a task in flight is cancelled. */
  stop(): void;
  /** The P2 review (security 5): the keys whose answer or draft came on this run's stream and whose reply TailorIT then
   *  voided as a whole (`streamedThenVoided`), not yet told to the frame: taken once, so the fields written from them
   *  are flagged for review (ai-reply-voided). */
  takeReviews(): FieldKey[];
  /** v1.3 B: the run-start batch (module header): answer items of the job's known questions, asked at once under their
   *  own keys; a later plan's item with the same signature takes their answers. Answers how many were sent. */
  prefetch?(items: readonly AnswerItem[], context: AskContext, llm: Settings['llm']): number;
}

/** v1.3 B: what makes two answer items one question (module header): never the key, the hint or the section's words,
 *  nor a text's cap (claimedVerdict and capFits check it). */
export function signatureOf(item: AnswerItem): string {
  return JSON.stringify([normalizeLabel(item.question), item.kind, item.shape, item.scope, item.optionSetHash,
    item.options.map((option) => option.labelHash).sort(), item.format, item.classify === true]);
}

/** v1.3 B: whether a text the prefetched item was asked under any cap of fits the field's: its cap is no larger. */
export function capFits(from: AnswerItem, to: AnswerItem): boolean {
  return from.shape !== 'text' || (from.maxLength ?? ANSWER_TEXT_MAX) <= (to.maxLength ?? ANSWER_TEXT_MAX);
}

/** v1.3 B: a prefetched answer as the field's: its key, and a choice's index the field's own option with the label hash
 *  the answer named; null when the field offers none, or a text is longer than the field takes. */
export function claimedVerdict(verdict: AnswerVerdict, from: AnswerItem, to: AnswerItem): AnswerVerdict | null {
  if (verdict.kind === 'text' && [...verdict.text].length > (to.maxLength ?? ANSWER_TEXT_MAX)) return null;
  if (verdict.kind !== 'choice') return { ...verdict, key: to.key };
  const option = to.options.find((candidate) => candidate.labelHash === verdict.labelHash);
  const named = from.options.find((candidate) => candidate.index === verdict.index);
  if (option === undefined || named === undefined || named.labelHash !== verdict.labelHash) return null;
  return { ...verdict, key: to.key, index: option.index };
}

/** The field a tiebreak item or verdict is for: its id is the field's key, with a value's reference after '#' when one
 *  field asks for several (tiebreakId). */
const fieldKeyOf = (item: { id: string }): string => item.id.split('#')[0]!;

/** Creates a run's questions over the task client and the run's task ids; `vocab` screens a rewrite's current text
 *  (draftBatches). v5 p2-stream: `onReady` hears the keys whose answers came in (an item on its task's stream, or a
 *  batch's end), so the frame is told to plan them now. */
export function createRunAi(tasks: AiTasks, ids: AiTaskIds, vocab: Vocab,
  onReady?: (keys: readonly FieldKey[]) => void): RunAi {
  const verdicts = new Map<string, AnsweredVerdict>();
  const classifications = new Map<string, ClassifyVerdict>();
  const drafts = new Map<string, DraftVerdict>();
  const answers = new Map<string, AnswerVerdict>();
  /** The batch each waiting key is answered by (null: answered at once), and the scan it was asked from. */
  const waiting = new Map<FieldKey, { batch: string | null; context: AskContext }>();
  /** Batches by hash, and whether each has ended. */
  const batches = new Map<string, { done: boolean }>();
  /** The batch that last answered each key, so Edit with AI can ask it again (forget). */
  const answeredBy = new Map<FieldKey, string>();
  // v5 p2-stream (two at once): the batches waiting for a place, those in flight, and who waits for all to end.
  const queue: Array<() => Promise<void>> = [];
  let flying = 0;
  let quiet: Array<() => void> = [];
  let stopped = false;
  let submitted = false;
  // v5 p2-stream: the keys whose verdict came on their task's stream, before the task ended, each with the batch that
  // streamed it (the P2 review, H1: a key asked again in another batch is that batch's own), and the stream's end.
  const streamed = new Map<string, string>();
  /** The P2 review (M1): the keys an answer task held back that a classify task names first. */
  const classifyFirst = new Set<string>();
  /** The P2 review (security 5): streamed keys whose reply was then voided, until the frame is told (takeReviews). */
  const reviews = new Set<FieldKey>();
  const halt = new AbortController();
  // v1.3 B: the run-start batch's items by signature, and the fields that took one while its batch flies.
  const prefetched = new Map<string, { item: AnswerItem; hash: string }>();
  const claims = new Map<string, Array<{ item: AnswerItem; pre: AnswerItem }>>();

  /** v1.3 B: a prefetched answer is in for `pre`: each field that took it gets it as its own (module header). */
  function settleClaims(hash: string, preKey?: string): void {
    const list = claims.get(hash);
    if (list === undefined) return;
    const done: string[] = [];
    const left = list.filter(({ item, pre }) => {
      if (preKey !== undefined && pre.key !== preKey) return true;
      const verdict = answers.get(pre.key);
      const claimed = verdict === undefined ? null : claimedVerdict(verdict, pre, item);
      answers.set(item.key, claimed ?? { key: item.key, kind: 'none', why: 'llm-invalid-output' });
      const classified = classifications.get(pre.key);
      if (classified !== undefined) classifications.set(item.key, { ...classified, key: item.key });
      if (preKey !== undefined) streamed.set(item.key, hash);
      done.push(item.key);
      return false;
    });
    if (left.length === 0) claims.delete(hash);
    else claims.set(hash, left);
    ready(done);
  }

  /** v1.3 B: whether a prefetched answer may stand for another item: in, and no failure (asked again then). */
  function usablePrefetched(pre: AnswerItem): boolean {
    const verdict = answers.get(pre.key);
    return verdict !== undefined && !(verdict.kind === 'none' && verdict.why !== 'llm-no-answer');
  }

  /** Tells the run that keys' answers are in (the planner tells the frame). Never throws. */
  function ready(keys: readonly string[]): void {
    if (stopped || keys.length === 0 || onReady === undefined) return;
    try {
      onReady(keys as FieldKey[]);
    } catch {
      // The frame is told at its next poll anyway.
    }
  }

  /** One answer or draft from a batch's stream: that key's verdict now, once per batch. */
  function streamedItem(batch: AiBatch, hash: string, item: StreamedItem, taskId: string): void {
    if (stopped) return;
    let key: string | null = null;
    if (batch.kind === 'answer' && item.type === 'answer') {
      const asked = batch.items.find((entry) => entry.key === item.answer.key);
      if (asked === undefined || streamed.get(asked.key) === hash) return;
      // v5 p2-stream (one round): its classification first; an answer with none is never taken, and one held back
      // waits for its batch's end, then is classified first (M1).
      const classified = oneRoundClassifications([asked], { answers: [item.answer] }).get(asked.key);
      if (classified === 'missing' || classified === 'held') return;
      if (classified !== undefined) classifications.set(asked.key, classified);
      answers.set(asked.key, answerVerdicts([asked], { answers: [item.answer] }, taskId).get(asked.key)!);
      key = asked.key;
    } else if (batch.kind === 'draft' && item.type === 'draft') {
      const asked = batch.items.find((entry) => entry.key === item.draft.key);
      if (asked === undefined || streamed.get(asked.key) === hash) return;
      drafts.set(asked.key, draftVerdicts([asked], { drafts: [item.draft] }, taskId).get(asked.key)!);
      key = asked.key;
    }
    if (key === null) return;
    streamed.set(key, hash);
    ready([key]);
    // v1.3 B: a prefetched answer streamed: the fields that took it have it now.
    settleClaims(hash, key);
  }

  /** The keys a batch answers. */
  const keysOf = (batch: AiBatch): string[] => batch.items.map((item) => (batch.kind === 'pick'
    ? fieldKeyOf(item as TiebreakItem) : (item as ClassifyItem | DraftItem | AnswerItem).key));

  function record(batch: AiBatch, hash: string, outcome: TaskOutcome): void {
    /** Whether this batch's own stream brought the key's verdict (H1: never another batch's). */
    const ownStream = (key: string) => streamed.get(key) === hash;
    /**
     * The P2 review (security 5): the items TailorIT sent on the stream before voiding their reply as a whole. One
     * this run took from its own stream stands as written and is told to the frame for review; one it never took (its
     * stream lost, the result polled) is not trusted: no answer.
     */
    const voidedOf = (entries: ReadonlyArray<{ key: string; streamedThenVoided?: true }>) => {
      const voided = new Set<string>();
      for (const entry of entries) {
        if (entry.streamedThenVoided !== true) continue;
        voided.add(entry.key);
        if (ownStream(entry.key)) reviews.add(entry.key as FieldKey);
      }
      return voided;
    };
    if (!outcome.ok) {
      const failed = failedVerdicts(batch, outcome.why);
      for (const verdict of failed.picks) verdicts.set(verdict.id, { verdict, taskId: '' });
      for (const verdict of failed.classes) classifications.set(verdict.key, verdict);
      // v5 p2-stream: what came on this batch's stream before its task failed stands (it may be written already).
      for (const verdict of failed.drafts) if (!ownStream(verdict.key)) drafts.set(verdict.key, verdict);
      for (const verdict of failed.answers) if (!ownStream(verdict.key)) answers.set(verdict.key, verdict);
      // v5 p2-stream (one round): an item asked with its category has none either.
      if (batch.kind === 'answer') {
        for (const item of batch.items) {
          if (item.classify === true && !ownStream(item.key)) {
            classifications.set(item.key, { key: item.key, category: null, why: outcome.why });
          }
        }
      }
      return;
    }
    if (batch.kind === 'pick') {
      for (const [id, verdict] of pickVerdicts(batch.items, outcome.result as AutofillPickResult)) {
        verdicts.set(id, { verdict, taskId: outcome.taskId });
      }
    } else if (batch.kind === 'draft') {
      let differ = 0;
      const result = outcome.result as AutofillDraftResult;
      const voided = voidedOf(result.drafts);
      for (const [key, verdict] of draftVerdicts(batch.items, result, outcome.taskId)) {
        if (voided.has(key) && !ownStream(key)) {
          drafts.set(key, { key: key as FieldKey, text: null, why: 'llm-invalid-output' });
          continue;
        }
        if (ownStream(key) && JSON.stringify(drafts.get(key)) !== JSON.stringify(verdict)) differ += 1;
        drafts.set(key, verdict);
      }
      if (differ > 0) log('ai.stream-differs', { items: differ });
    } else if (batch.kind === 'answer') {
      let differ = 0;
      const result = outcome.result as AutofillAnswerResult;
      // v5 p2-stream (one round): each classification first; an answer that came without the one it was asked is
      // dropped, unread (a TailorIT before v5's one round), and the worker classifies first from now on.
      const classified = oneRoundClassifications(batch.items, result);
      const voided = voidedOf(result.answers);
      let missing = 0;
      for (const [key, verdict] of answerVerdicts(batch.items, result, outcome.taskId)) {
        if (voided.has(key) && !ownStream(key)) {
          if (classified.has(key)) classifications.set(key, { key: key as FieldKey, category: null, why: 'llm-invalid-output' });
          answers.set(key, { key: key as FieldKey, kind: 'none', why: 'llm-invalid-output' });
          continue;
        }
        const classification = classified.get(key);
        if (classification === 'missing') {
          missing += 1;
          continue;
        }
        // The P2 review (M1): held back by the answer screen: classified first, its answer never taken.
        if (classification === 'held') {
          classifyFirst.add(key);
          continue;
        }
        if (classification !== undefined) classifications.set(key, classification);
        if (ownStream(key) && JSON.stringify(answers.get(key)) !== JSON.stringify(verdict)) differ += 1;
        answers.set(key, verdict);
      }
      if (missing > 0) tasks.oneRoundMissing?.();
      if (differ > 0) log('ai.stream-differs', { items: differ });
    } else {
      for (const [key, verdict] of classifyVerdicts(batch.items, outcome.result as AutofillClassifyResult)) {
        classifications.set(key, verdict);
      }
    }
  }

  function enqueue(batch: AiBatch): string {
    const hash = batchHash(batch);
    if (batches.has(hash)) return hash;
    const entry = { done: false };
    batches.set(hash, entry);
    if (!stopped) submitted = true;
    queue.push(async () => {
      const outcome = stopped ? { ok: false as const, why: 'llm-unavailable' as const }
        : await tasks.run(batch, ids, () => !stopped,
          { signal: halt.signal, onItem: (item, taskId) => streamedItem(batch, hash, item, taskId) });
      record(batch, hash, outcome);
      entry.done = true;
      // v1.3 B: the fields that took this batch's prefetched answers have them now.
      settleClaims(hash);
      // v5 p2-stream: the batch's other keys are in now: the frame plans them at once (H1: by this batch's stream);
      // the frame is told too when a streamed one waits for review (security 5).
      const wake = keysOf(batch).filter((key) => streamed.get(key) !== hash);
      ready(wake.length === 0 && reviews.size > 0 ? keysOf(batch) : wake);
    });
    pump();
    return hash;
  }

  /** v5 p2-stream (two at once): starts the batches waiting, in order, while fewer than AI_RUN_TASKS fly. */
  function pump(): void {
    while (flying < AI_RUN_TASKS && queue.length > 0) {
      const job = queue.shift()!;
      flying += 1;
      void job().catch(() => undefined).finally(() => {
        flying -= 1;
        pump();
        if (flying === 0 && queue.length === 0) {
          const waiting = quiet;
          quiet = [];
          for (const resolve of waiting) resolve();
        }
      });
    }
  }

  return {
    answers: { verdicts, classifications, drafts, answers, classifyFirst },
    ask(ask, awaiting, context, llm, revision) {
      const owner = new Map<string, string | null>();
      const picks = llm.tiebreak ? pickBatches(ask.tiebreaks, revision)
        : { batches: [], withheld: ask.tiebreaks.map((item) => verdictOf(item, 'llm-disabled-for-category')) };
      const classes = llm.classify ? classifyBatches(ask.classify)
        : { batches: [], withheld: ask.classify.map((item): ClassifyVerdict => ({ key: item.key, category: null,
          why: 'llm-disabled-for-category' })) };
      for (const verdict of picks.withheld) {
        verdicts.set(verdict.id, { verdict, taskId: '' });
        owner.set(fieldKeyOf(verdict), null);
      }
      for (const verdict of classes.withheld) {
        classifications.set(verdict.key, verdict);
        owner.set(verdict.key, null);
      }
      // Drafts (Phase 6): only with the setting on and a context to send them with.
      const asked = ask.drafts ?? [];
      const written = llm.drafts && context.draft !== undefined
        ? draftBatches(asked, context.draft, context.canaries, vocab, context.rewrite !== undefined
          && context.instruction !== undefined ? { key: context.rewrite, instruction: context.instruction } : undefined)
        : { batches: [], withheld: asked.map((item): DraftVerdict => ({ key: item.key, text: null, why: 'drafts-disabled' })) };
      for (const verdict of written.withheld) {
        drafts.set(verdict.key, verdict);
        owner.set(verdict.key, null);
      }
      // Answers (the owner's amendments): only with the setting on and a context to send them with.
      // v1.3 B: an item the run-start batch asked takes its answer (at once, or with its batch); the rest are asked.
      const questions = (ask.answers ?? []).filter((item) => {
        const pre = llm.answers ? prefetched.get(signatureOf(item)) : undefined;
        if (pre === undefined || pre.item.key === item.key) return true;
        const entry = batches.get(pre.hash);
        if (entry?.done === true || streamed.get(pre.item.key) === pre.hash) {
          if (!usablePrefetched(pre.item)) return true;
          const claimed = claimedVerdict(answers.get(pre.item.key)!, pre.item, item);
          if (claimed === null) return true;
          answers.set(item.key, claimed);
          const classified = classifications.get(pre.item.key);
          if (classified !== undefined) classifications.set(item.key, { ...classified, key: item.key });
          owner.set(item.key, null);
          return false;
        }
        if (entry === undefined || !capFits(pre.item, item)) return true;
        claims.set(pre.hash, [...(claims.get(pre.hash) ?? []), { item, pre: pre.item }]);
        owner.set(item.key, pre.hash);
        answeredBy.set(item.key, pre.hash);
        return false;
      });
      const answered = llm.answers && context.draft !== undefined
        ? answerBatches(questions, context.draft, context.canaries, vocab)
        : { batches: [], withheld: questions.map((item): AnswerVerdict => ({ key: item.key, kind: 'none',
          why: 'llm-disabled-for-category' })), classified: [] as ClassifyVerdict[], classifyFirst: [] as FieldKey[] };
      for (const verdict of answered.withheld) {
        answers.set(verdict.key, verdict);
        owner.set(verdict.key, null);
      }
      // v5 p2-stream (one round): the classifications its answer batches settle at once, and (M1) the items the
      // answer screen withheld, classified first: answered at once, so the next plan asks their classification.
      for (const verdict of answered.classified) classifications.set(verdict.key, verdict);
      for (const key of answered.classifyFirst) {
        classifyFirst.add(key);
        owner.set(key, null);
      }
      const withheld = picks.withheld.length + classes.withheld.length + written.withheld.length
        + answered.withheld.length;
      if (withheld > 0) log('ai.withheld', { items: withheld });
      for (const batch of [...classes.batches, ...picks.batches, ...written.batches, ...answered.batches]) {
        const hash = enqueue(batch);
        for (const key of keysOf(batch)) {
          owner.set(key, hash);
          answeredBy.set(key as FieldKey, hash);
        }
      }
      for (const key of awaiting) waiting.set(key, { batch: owner.get(key) ?? null, context });
    },
    state(key) {
      const entry = waiting.get(key);
      if (entry === undefined) return 'unknown';
      if (entry.batch === null) return 'done';
      // v5 p2-stream: an answer or draft that came on its own batch's stream is in before that batch ends (H1).
      if (streamed.get(key) === entry.batch) return 'done';
      return batches.get(entry.batch)?.done === true ? 'done' : 'waiting';
    },
    contextOf: (key) => waiting.get(key)?.context,
    settle(keys) {
      for (const key of keys) waiting.delete(key);
    },
    forget(keys) {
      for (const key of keys) {
        drafts.delete(key);
        answers.delete(key);
        streamed.delete(key);
        // The batch that answered it, once ended, is enqueued afresh when asked again (its name may be the same: then
        // its task is read again by its id).
        const hash = answeredBy.get(key);
        if (hash !== undefined && batches.get(hash)?.done === true) batches.delete(hash);
        answeredBy.delete(key);
        waiting.delete(key);
      }
    },
    idle: () => (flying === 0 && queue.length === 0 ? Promise.resolve()
      : new Promise<void>((resolve) => void quiet.push(resolve))),
    used: () => submitted,
    stop() {
      stopped = true;
      halt.abort();
    },
    takeReviews() {
      const taken = [...reviews];
      reviews.clear();
      return taken;
    },
    // v1.3 B: the run-start batch (module header).
    prefetch(items, context, llm) {
      if (stopped || !llm.answers || context.draft === undefined || items.length === 0) return 0;
      const fresh = items.filter((item) => !prefetched.has(signatureOf(item)));
      const answered = answerBatches(fresh, context.draft, context.canaries, vocab);
      let sent = 0;
      for (const batch of answered.batches) {
        const hash = enqueue(batch);
        for (const item of batch.items) {
          prefetched.set(signatureOf(item), { item, hash });
          sent += 1;
        }
      }
      if (sent > 0) log('ai.known-batch', { items: sent, batches: answered.batches.length });
      return sent;
    },
  };
}
