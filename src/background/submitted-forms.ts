/*
 * v1.3 B (the owner, 2026-11-09; docs/SPEC-AMENDMENTS.md §16, the coordinator's decisions 3 and 5): the worker's two
 * translations between the extension and TailorIT's forms routes (the contract's forms.ts), both pure.
 *
 * Out (submissionBodyOf): a submitted form, as the frame captured it (content/form-capture.ts, held by
 * submissions.ts for the arm alone), becomes POST /api/autofill/submissions' body:
 * - each question: its field key as `ref`; normalizeLabel(label) as `questionKey` (the saved answers' key); its label
 *   on one line; its kind; its options' clean labels and their hash (none while a list was never read); its section
 *   (core/text/keys.ts sectionKey, so a known question names the field's section again); whether it is required; its
 *   step and its place on it; and the extension's own classification of it as TailorIT names categories
 *   (formCategoryOf), with which TailorIT screens which answers it ever gives to another job;
 * - each answer, only while "Keep my submitted answers in TailorIT" is on: a text, the options' labels, a box's state,
 *   or an upload's file name, with where it came from (the run's row: its provenance where the run wrote it and the
 *   person left it so; `person` where they typed or changed it; none known otherwise);
 * - the posting the page showed (its title's names and its visible text) only for a job TailorIT has no id of;
 * - nothing that does not fit the contract: a question whose label normalizes to nothing is left out, with its answer;
 * - jr7 FIX-background (the review's A-7): never a national id (identity.nationalId: a social security or national
 *   insurance number the person typed), question or answer, as the capture never takes a password or a one-time code;
 *   a body the contract would refuse is never sent (null: POST /applied records the application instead).
 * In (submittedAnswersOf): POST /api/autofill/forms/known's earlier answers become the resolver's SubmittedAnswer list
 * (core/resolver/submitted.ts) for the run, in memory only: a question read from Greenhouse's board API has its key and
 * option set computed here from its label and options, as the extension computes them; a file's answer is never one
 * (nothing fills an upload from it).
 */
import {
  AUTOFILL_ANSWER_PROVENANCES, AUTOFILL_FIELD_KINDS, AUTOFILL_FORM_LIMITS, AutofillFormQuestionSchema,
  AutofillQuestionKeySchema,
  AutofillSubmissionRequestSchema, AutofillSubmittedAnswerValueSchema,
  submittedAnswerFits, type AutofillAnswerProvenance, type AutofillFieldCategory, type AutofillFormQuestion,
  type AutofillFormsKnownResponse, type AutofillSubmissionAnswer, type AutofillSubmissionRequest,
} from '../contract/tailorit';
import type { FieldKind } from '../core/enums';
import { cutInjected } from '../core/guard/injected';
import { policyClassOf } from '../core/resolver/categories';
import { SERVER_CATEGORY_MAP } from '../core/resolver/classify';
import { classifyField } from '../core/resolver/resolve';
import type { Vocab } from '../core/vocab/types';
import { optionSetHash, sectionKey } from '../core/text/keys';
import { normalizeLabel } from '../core/text/normalize';
import type { FieldSpec, OptionSetHash } from '../core/types/field';
import type { FieldCategory } from '../core/types/intent';
import type { SubmittedAnswer } from '../core/types/submitted';
import type { CapturedField, CapturedPosting } from '../messaging/schemas';
import type { FrameReport } from '../shared/report';

type Row = FrameReport['fields'][number];

/** A submitted form as the worker holds it for an arm: memory only. */
export interface HeldForm {
  at: number;
  frameId: number;
  documentId: string | null;
  fields: CapturedField[];
  posting: CapturedPosting | null;
}

/** One line: control characters as spaces, spaces folded, trimmed, at most `max` characters (never half a pair). */
function oneLine(text: string, max: number): string {
  const line = text.replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return (last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut).trim();
}

// ── jr7 FIX-background (the review's A-7) ──
/** The classifications whose question and answer never go to TailorIT (module header): a national id the person typed
 *  (core/resolver/labelRules.ts nationalIdHit), which the extension never fills either. */
export const NEVER_SENT: ReadonlySet<FieldCategory> = new Set<FieldCategory>(['identity.nationalId']);
// ── end jr7 FIX-background ──

/** TailorIT's category for a question (the contract's AUTOFILL_FIELD_CATEGORIES): a self-identification, legal or pay
 *  question by its class, a consent, an attention check or free text as such, else the classification's own name, or
 *  null when TailorIT names none for it. */
export function formCategoryOf(category: FieldCategory): AutofillFieldCategory | null {
  if (NEVER_SENT.has(category)) return null; // jr7 FIX-background (A-7): no self-identification label
  switch (policyClassOf(category)) {
    case 'eeo':
      return 'sensitive_eeo';
    case 'legal':
      return 'sensitive_legal';
    case 'sensitive':
      return category.startsWith('salary.') ? 'sensitive_compensation' : 'sensitive_eeo';
    case 'consent':
      return 'consent';
    case 'attention':
      return 'attention_check';
    case 'free-text':
      return 'free_text_question';
    default:
      for (const [server, target] of Object.entries(SERVER_CATEGORY_MAP)) {
        if (target === category) return server as AutofillFieldCategory;
      }
      return null;
  }
}

/** The extension's own classification of a question, as the resolver's first steps read it (the tripwire, attention
 *  checks, the rules; resolve.ts classifyField), or null when they leave it unknown. */
export function categoryOfSpec(spec: FieldSpec, vocab: Vocab): FieldCategory | null {
  const classification = classifyField(spec, vocab);
  switch (classification.by) {
    case 'rules':
      return classification.rules.category ?? classification.rules.asks ?? null;
    case 'attention':
      return classification.botCheck === true ? 'attentionCheck' : classification.consent ?? 'attentionCheck';
    case 'tripwire':
      return classification.rules?.category ?? classification.rules?.asks ?? null;
    default:
      return null;
  }
}

/** Where an answer came from, by the run's row of its field (module header). */
export function provenanceOf(row: Pick<Row, 'provenance' | 'wrote' | 'reason' | 'detail'> | undefined):
  AutofillAnswerProvenance | null {
  if (row === undefined) return null;
  if (row.reason === 'changed-by-you' || row.detail?.userEdited === true || row.detail?.filledByYou === true) {
    return 'person';
  }
  // v1.5 X: an answer TailorIT prepared for the job is its AI's (a TailorIT that names it takes it so). v2.0 (API 8):
  // the extension's own name for it stays `prebuilt` (src/core, which the content script reads); the wire's is
  // `prepared` (PREPARED_AS).
  if (row.wrote && row.provenance !== null) return row.provenance === 'prebuilt' ? PREPARED_AS : row.provenance;
  return 'person';
}

/** v1.5 X, renamed by API 8 (v2.0): how /submissions names an answer TailorIT prepared for the job: `prepared` where
 *  TailorIT's contract has it, else an AI answer. The internal `prebuilt` never goes on the wire. */
const PREPARED_AS: AutofillAnswerProvenance = (AUTOFILL_ANSWER_PROVENANCES as readonly string[]).includes('prepared')
  ? 'prepared' as AutofillAnswerProvenance : 'llm-answer';

/** A question's options as TailorIT keeps them: each clean label once, at most AUTOFILL_FORM_LIMITS.options. */
function optionsOf(spec: FieldSpec): string[] {
  if (spec.options === 'lazy') return [];
  const labels = spec.options.map((option) => oneLine(cutInjected(option.label).clean, AUTOFILL_FORM_LIMITS.optionLabel))
    .filter((label) => label !== '');
  return [...new Set(labels)].slice(0, AUTOFILL_FORM_LIMITS.options);
}

const KINDS: ReadonlySet<string> = new Set(AUTOFILL_FIELD_KINDS);

/** What submissionBodyOf reads besides the form. */
export interface BodyContext {
  /** The arm's job (TailorIT's id) or posting address: one of them. */
  jobId: number | null;
  url: string | null;
  resumeId: string | null;
  /** "Keep my submitted answers in TailorIT" (settings.modes.keepAnswers). */
  keepAnswers: boolean;
  /** The extension's classification of a question (core/resolver/resolve.ts classifyField's category). */
  categoryOf(spec: FieldSpec): FieldCategory | null;
  /** The run's row of a field, by its key (the frame's report), when there is one. */
  rowOf(key: string): Pick<Row, 'provenance' | 'wrote' | 'reason' | 'detail'> | undefined;
}

/** POST /submissions' body for a submitted form (module header), or null when there is none to send. */
export function submissionBodyOf(form: Pick<HeldForm, 'fields' | 'posting'>, ctx: BodyContext):
  AutofillSubmissionRequest | null {
  if (ctx.jobId === null && ctx.url === null) return null;
  const questions: AutofillFormQuestion[] = [];
  const answers: AutofillSubmissionAnswer[] = [];
  const refs = new Set<string>();
  let optionCount = 0;
  for (const field of form.fields) {
    if (questions.length >= AUTOFILL_FORM_LIMITS.questions) break;
    // The schema's strings are the core's branded keys (messaging/schemas.check.ts proves the shapes equal).
    const spec = field.spec as unknown as FieldSpec;
    const ref: string = spec.key;
    const questionKey = normalizeLabel(spec.label);
    const label = oneLine(spec.label, AUTOFILL_FORM_LIMITS.label);
    if (refs.has(ref) || [...ref].length > AUTOFILL_FORM_LIMITS.ref || label === '' || !KINDS.has(spec.kind)
      || !AutofillQuestionKeySchema.safeParse(questionKey).success) continue;
    const hashed = spec.optionSetHash !== 'none' && spec.optionSetHash !== 'lazy' && /^[0-9a-f]{16}$/.test(spec.optionSetHash);
    let options = hashed ? optionsOf(spec) : [];
    if (optionCount + options.length > AUTOFILL_FORM_LIMITS.optionsTotal) options = [];
    optionCount += options.length;
    const category = ctx.categoryOf(spec);
    // jr7 FIX-background (A-7): a national id is never sent, question or answer.
    if (category !== null && NEVER_SENT.has(category)) {
      optionCount -= options.length;
      continue;
    }
    // Each question as the contract takes it, or it is left out with its answer.
    const question = AutofillFormQuestionSchema.safeParse({ ref, questionKey, label, kind: spec.kind, options,
      optionSetHash: options.length > 0 ? spec.optionSetHash : '',
      section: oneLine(sectionKey(spec.section), AUTOFILL_FORM_LIMITS.section), required: spec.required,
      step: Math.min(field.step, AUTOFILL_FORM_LIMITS.step), position: Math.min(spec.domOrder, AUTOFILL_FORM_LIMITS.position),
      category: category === null ? null : formCategoryOf(category) });
    if (!question.success) {
      optionCount -= options.length;
      continue;
    }
    refs.add(ref);
    questions.push(question.data);
    const answer = field.answer;
    if (!ctx.keepAnswers || answer === undefined) continue;
    // Each answer as the contract takes it, or none for that question (its question is still kept).
    const value = AutofillSubmittedAnswerValueSchema.safeParse(answer);
    if (!value.success || !submittedAnswerFits(value.data, spec.kind)) continue;
    answers.push({ ref, answer: value.data, provenance: provenanceOf(ctx.rowOf(ref)) });
  }
  const posting = ctx.jobId === null && form.posting !== null ? form.posting : null;
  const body = { ...(ctx.jobId !== null ? { jobId: ctx.jobId } : { url: ctx.url! }),
    ...(ctx.resumeId === null ? {} : { resumeId: ctx.resumeId }),
    ...(posting === null ? {} : { posting: { title: posting.title, company: posting.company,
      description: posting.description } }),
    questions, ...(ctx.keepAnswers ? { answers } : {}) };
  const parsed = AutofillSubmissionRequestSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

/** The option-set hash TailorIT's Greenhouse-read question would have here (module header). */
function hashOfLabels(labels: readonly string[]): OptionSetHash {
  const clean = labels.map((label) => cutInjected(label).clean).filter((label) => label.trim() !== '');
  return clean.length === 0 ? 'none' as OptionSetHash : optionSetHash(clean);
}

/** Field kinds the resolver may fill from an earlier answer (never an upload). */
const FILLABLE: ReadonlySet<FieldKind> = new Set<FieldKind>(['text', 'textarea', 'select', 'radio', 'checkbox',
  'checkbox-group', 'combobox', 'multiselect', 'typeahead-remote']);

/** The earlier answers of a known-form answer as the resolver reads them (module header). `submittedAt` that does
 *  not read counts as the oldest. */
export function submittedAnswersOf(known: AutofillFormsKnownResponse): SubmittedAnswer[] {
  const questions = new Map(known.questions.map((question) => [question.id, question] as const));
  return known.answers.flatMap((item, at): SubmittedAnswer[] => {
    const { answer } = item;
    if (answer.kind === 'file' || !FILLABLE.has(item.fieldKind)) return [];
    const question = item.questionId === null ? undefined : questions.get(item.questionId);
    const fromApi = question?.source === 'ats-api';
    const labelKey = fromApi ? normalizeLabel(question.label) : item.questionKey;
    const optionSetHash = fromApi ? hashOfLabels(question.options)
      : item.optionSetHash === '' ? 'none' as OptionSetHash : item.optionSetHash as OptionSetHash;
    const submittedAt = Date.parse(item.submittedAt);
    return [{ id: `s${at}`, labelKey, optionSetHash, kind: item.fieldKind, answer, sameJob: item.match === 'sameJob',
      submittedAt: Number.isFinite(submittedAt) ? submittedAt : 0,
      ...(question === undefined ? {} : { questionId: question.id, section: question.section,
        order: question.step * 10_000 + question.position }) }];
  });
}

// ── v1.5 X (PLAN decision 4) ──
/**
 * The person's prebuilt draft answers for the job (POST /forms/known's `drafts`, apart from `answers`: TailorIT's
 * contract), as the resolver reads them: each ready one, for one of the job's own questions, becomes this job's answer
 * marked `draft` (core/resolver/submitted.ts findDraftAnswer: after this job's own earlier answer, before another
 * job's and any AI, never a sensitive, consent or attention-check question). A `not_ready` one is left out (the fill's
 * own AI path makes it, as before), and so is one answering a file, or a question the answer does not name.
 */
export function draftAnswersOf(known: AutofillFormsKnownResponse): SubmittedAnswer[] {
  const questions = new Map(known.questions.map((question) => [question.id, question] as const));
  return (known.drafts ?? []).flatMap((item, at): SubmittedAnswer[] => {
    const { answer } = item;
    if (item.status !== 'ready' || answer === null || answer.kind === 'file' || !FILLABLE.has(item.fieldKind)) return [];
    const question = questions.get(item.questionId);
    if (question === undefined || question.kind === 'file') return [];
    const fromApi = question.source === 'ats-api' || item.optionSetHash === null;
    const labelKey = question.source === 'ats-api' ? normalizeLabel(question.label) : item.questionKey;
    const optionSetHash = fromApi ? hashOfLabels(question.options)
      : item.optionSetHash === '' ? 'none' as OptionSetHash : item.optionSetHash as OptionSetHash;
    const preparedAt = Date.parse(item.preparedAt);
    return [{ id: `d${at}`, labelKey, optionSetHash, kind: item.fieldKind, answer, sameJob: true, draft: true,
      submittedAt: Number.isFinite(preparedAt) ? preparedAt : 0, questionId: question.id, section: question.section,
      order: question.step * 10_000 + question.position }];
  });
}
// ── end v1.5 X ──
