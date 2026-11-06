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
 * A run's questions (createRunAi): one task in flight per run, batches in the order they were asked (classify, pick,
 * draft, answer), the answers kept for the run only (memory). Nothing here logs an item, a label or an answer: counts
 * and statuses only.
 */
import {
  answerInFormat, ATS_KINDS, AUTOFILL_AI_LIMITS, AUTOFILL_AI_POLL_MS, AUTOFILL_PICK_CATEGORIES, cutAtWord, type AtsKind,
  type AutofillAnswerItem, type AutofillAnswerReason, type AutofillAnswerRequest, type AutofillAnswerResult,
  type AutofillClassifyItem,
  type AutofillClassifyRequest, type AutofillClassifyResult, type AutofillDraftReason, type AutofillDraftRequest,
  type AutofillDraftResult, type AutofillPickItem, type AutofillPickRequest, type AutofillPickResult,
  type AutofillTaskView,
} from '../contract/tailorit';
import { ANSWER_MAX_ITEMS, DRAFT_MAX_QUESTIONS, TIEBREAK_REQUEST_TEXT_SHARE } from '../core/confidence';
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
import type { BaseKey, FieldKey, FieldSpec } from '../core/types/field';
import type { Settings } from '../core/types/settings';
import type { VisibleText } from '../core/types/text';
import type { Vocab } from '../core/vocab/types';
import { log } from '../shared/log';
import type { ServerClient, ServerResult } from './server-client';
import type { Timers } from './timers';

/** A batch's task is given up this long after it was first submitted (docs/ARCHITECTURE.md: the 120 s cap). */
export const AI_TASK_CAP_MS = 120_000;

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
 *  it does not list yet (PLATFORMS_AHEAD_OF_CONTRACT, empty since its API 5) would be refused. */
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
    ...(item.shape === 'text' && item.format !== null ? { format: item.format } : {}) };
}

/** The text an answer item holds, as TailorIT counts it. */
const answerTextOf = (item: AutofillAnswerItem) => [item.key, item.shape, item.kind, item.question, item.hint,
  item.section, ...item.options.map((option) => option.label)].reduce((sum, text) => sum + text.length, 0);

/** A pass's answer items as answer batches (at most ANSWER_MAX_ITEMS each, under the text cap, each with the job
 *  context and the canaries, the items of each scope in batches of their own: the `all` scope only for the questions
 *  the standard one would not ask), and the verdicts of those never sent. */
export function answerBatches(items: readonly AnswerItem[], context: DraftContext, canaries: readonly string[],
  vocab?: Vocab): { batches: AnswerBatch[]; withheld: AnswerVerdict[] } {
  const limits = AUTOFILL_AI_LIMITS.answer;
  const withheld: AnswerVerdict[] = [];
  const sendable: Array<{ item: AnswerItem; sent: AutofillAnswerItem }> = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    const sent = answerItemOfCore(item, vocab);
    if (sent === null) withheld.push({ key: item.key, kind: 'none', why: 'llm-disabled-for-category' });
    else sendable.push({ item, sent });
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
  for (const scope of ['standard', 'all'] as const satisfies readonly AnswerScope[]) {
    let chunk: typeof sendable = [];
    let size = sharedText;
    const flush = () => {
      if (chunk.length === 0) return;
      batches.push({ kind: 'answer', body: { items: chunk.map(({ sent }) => sent), scope, ...shared },
        items: chunk.map(({ item }) => item) });
      chunk = [];
      size = sharedText;
    };
    for (const entry of sendable.filter(({ item }) => item.scope === scope)) {
      const text = answerTextOf(entry.sent);
      if (chunk.length === ANSWER_MAX_ITEMS || (chunk.length > 0 && size + text > ANSWER_TEXT_BUDGET)) flush();
      chunk.push(entry);
      size += text;
    }
    flush();
  }
  return { batches, withheld };
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
    verdicts.set(item.key, verdict);
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
  server: Pick<ServerClient, 'aiPick' | 'aiClassify' | 'aiDraft' | 'aiAnswer' | 'aiTask'>;
  timers: Timers;
  now(): number;
}

/** Failures worth another poll: the next one may answer. */
const TRANSIENT: ReadonlySet<string> = new Set(['timeout', 'unreachable', 'server-error', 'rate-limited']);

const TASK_KIND = { pick: 'autofill_pick', classify: 'autofill_classify', draft: 'autofill_draft',
  answer: 'autofill_answer' } as const;

/** The task client: runs one batch's task to its end. */
export interface AiTasks {
  /** Submits a batch (or reads its known task), polls it, and answers how it ended. `active` false stops it (the run
   *  went), cancelling the task. */
  run(batch: AiBatch, ids: AiTaskIds, active: () => boolean): Promise<TaskOutcome>;
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

  /** A finished view as an outcome ('cancelled' for a task someone cancelled), or null while it is queued or running. */
  function settled(batch: AiBatch, view: AutofillTaskView): TaskOutcome | 'cancelled' | null {
    if (view.kind !== TASK_KIND[batch.kind]) return { ok: false, why: 'llm-invalid-output' };
    if (view.status === 'queued' || view.status === 'running') return null;
    if (view.status === 'cancelled') return 'cancelled';
    if (view.status !== 'succeeded') return { ok: false, why: 'llm-unavailable' };
    return view.result === null ? { ok: false, why: 'llm-invalid-output' } : { ok: true, taskId: view.id, result: view.result };
  }

  async function submit(batch: AiBatch): Promise<ServerResult<{ done: true; task: AutofillTaskView } | { done: false; taskId: string }>> {
    if (batch.kind === 'pick') return deps.server.aiPick(batch.body);
    if (batch.kind === 'answer') return deps.server.aiAnswer(batch.body);
    return batch.kind === 'draft' ? deps.server.aiDraft(batch.body) : deps.server.aiClassify(batch.body);
  }

  async function execute(batch: AiBatch, ids: AiTaskIds, active: () => boolean, self: Promise<unknown>): Promise<TaskOutcome> {
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
      for (;;) {
        const left = cap - deps.now();
        if (left <= 0 || !active()) break;
        await wait(Math.min(AUTOFILL_AI_POLL_MS, left));
        if (!active()) break;
        const view = await deps.server.aiTask(taskId);
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

  return {
    run(batch, ids, active) {
      let self: Promise<TaskOutcome> | null = null;
      const started = Promise.resolve().then(() => execute(batch, ids, active, self!))
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
  /** Takes what a plan asks: its awaiting keys wait for their batches, submitted one task at a time; an item never sent
   *  is answered at once. `context` is what the keys are planned again with once answered, `revision` the profile's
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
}

/** The field a tiebreak item or verdict is for: its id is the field's key, with a value's reference after '#' when one
 *  field asks for several (tiebreakId). */
const fieldKeyOf = (item: { id: string }): string => item.id.split('#')[0]!;

/** Creates a run's questions over the task client and the run's task ids; `vocab` screens a rewrite's current text
 *  (draftBatches). */
export function createRunAi(tasks: AiTasks, ids: AiTaskIds, vocab: Vocab): RunAi {
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
  let chain: Promise<void> = Promise.resolve();
  let stopped = false;
  let submitted = false;

  function record(batch: AiBatch, outcome: TaskOutcome): void {
    if (!outcome.ok) {
      const failed = failedVerdicts(batch, outcome.why);
      for (const verdict of failed.picks) verdicts.set(verdict.id, { verdict, taskId: '' });
      for (const verdict of failed.classes) classifications.set(verdict.key, verdict);
      for (const verdict of failed.drafts) drafts.set(verdict.key, verdict);
      for (const verdict of failed.answers) answers.set(verdict.key, verdict);
      return;
    }
    if (batch.kind === 'pick') {
      for (const [id, verdict] of pickVerdicts(batch.items, outcome.result as AutofillPickResult)) {
        verdicts.set(id, { verdict, taskId: outcome.taskId });
      }
    } else if (batch.kind === 'draft') {
      for (const [key, verdict] of draftVerdicts(batch.items, outcome.result as AutofillDraftResult, outcome.taskId)) {
        drafts.set(key, verdict);
      }
    } else if (batch.kind === 'answer') {
      for (const [key, verdict] of answerVerdicts(batch.items, outcome.result as AutofillAnswerResult, outcome.taskId)) {
        answers.set(key, verdict);
      }
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
    chain = chain.then(async () => {
      const outcome = stopped ? { ok: false as const, why: 'llm-unavailable' as const }
        : await tasks.run(batch, ids, () => !stopped);
      record(batch, outcome);
      entry.done = true;
    });
    return hash;
  }

  return {
    answers: { verdicts, classifications, drafts, answers },
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
      const questions = ask.answers ?? [];
      const answered = llm.answers && context.draft !== undefined
        ? answerBatches(questions, context.draft, context.canaries, vocab)
        : { batches: [], withheld: questions.map((item): AnswerVerdict => ({ key: item.key, kind: 'none',
          why: 'llm-disabled-for-category' })) };
      for (const verdict of answered.withheld) {
        answers.set(verdict.key, verdict);
        owner.set(verdict.key, null);
      }
      const withheld = picks.withheld.length + classes.withheld.length + written.withheld.length
        + answered.withheld.length;
      if (withheld > 0) log('ai.withheld', { items: withheld });
      for (const batch of [...classes.batches, ...picks.batches, ...written.batches, ...answered.batches]) {
        const hash = enqueue(batch);
        for (const item of batch.items) {
          const key = batch.kind === 'pick' ? fieldKeyOf(item as TiebreakItem)
            : (item as ClassifyItem | DraftItem | AnswerItem).key;
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
        // The batch that answered it, once ended, is enqueued afresh when asked again (its name may be the same: then
        // its task is read again by its id).
        const hash = answeredBy.get(key);
        if (hash !== undefined && batches.get(hash)?.done === true) batches.delete(hash);
        answeredBy.delete(key);
        waiting.delete(key);
      }
    },
    idle: () => chain,
    used: () => submitted,
    stop() {
      stopped = true;
    },
  };
}
