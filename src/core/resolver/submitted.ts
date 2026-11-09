/*
 * v1.3 B (the owner, 2026-11-09; docs/SPEC-AMENDMENTS.md §16, the coordinator's decision 5): the person's own answers to
 * the questions of applications they submitted, as TailorIT gives them back with the job's known questions (POST
 * /api/autofill/forms/known, in the worker's memory for the run), fill the same question again with no AI. The
 * resolver asks here only once the profile, the policy (EEO, legal, consent) and a saved answer gave the field nothing,
 * so the person's profile still wins wherever it holds a value: their earlier answer only fills a gap (resolve.ts).
 *
 * Which answer, in this order (the newest first among equals):
 * 1. This job's (a re-apply: `sameJob`), by the normalized label and the observed option-set hash;
 * 2. this job's, by the normalized label alone, for an options answer: while the list is not read yet (a lazy widget)
 *    it is planned as a choice, which the planner rows waiting-for-options so the loop reads the list; once read, each
 *    label must still be one of its options (the clean label, as keys.ts qualifiedLabel reads it), or the answer is
 *    not written: `gone`, flagged submitted-option-gone, and no AI answers it either;
 *    where this job's form asks the same label more than once, the question in the field's own section, then the one
 *    at the field's ordinal among them (in form order), is the field's; none is when that does not settle it;
 * 3. another job's, only by the normalized label and the same option-set hash (a lazy list: by the label, then checked
 *    by its hash once read), and only for a question that is not sensitive: the profile and unknown classes, never a
 *    question the classify screen withholds (a sensitive topic in its label, description, section or options, an EEO
 *    answer or a decline phrase among its options), and never free text (a "Why do you want to work here?" answer is
 *    that job's). TailorIT sends none of those either.
 * Never for a consent, an attention check, a bot check or an upload, whoever's; an EEO, legal or sensitive question,
 * or one the screen withholds, takes this job's own answer only while this browser may read the person's sensitive
 * answers (the sensitive part loaded): their earlier answers never reach further than their profile would.
 * Pure: nothing is logged or kept here.
 * v1.5 X (PLAN decision 4; the owner, 2026-11-09: "all answer for question for every saved job ... stored as job
 * application draft"): the answers TailorIT prepared for this job's questions ahead of time (its job application draft,
 * read with the known questions as `match: 'draft'`, ready ones alone: SubmittedAnswer.draft) fill a gap after this
 * job's own earlier answer and before another job's and any AI (findDraftAnswer; resolve.ts the order): this job's
 * question by its label and option set (a list not read yet by its label, each option checked once read: one no longer
 * offered leaves the gap to the AI, unflagged), only for a question that is not sensitive: the profile classes an AI may
 * answer (ANSWERABLE_PROFILE_CATEGORIES), unknown and free text; never an EEO, legal or sensitive question, one the
 * classify screen withholds, a consent, an attention or bot check, or an upload.
 */
import type { FieldKind } from '../enums';
import { cutInjected } from '../guard/injected';
import { qualifiedLabel, sectionKey } from '../text/keys';
import { normalizeLabel } from '../text/normalize';
import { ANSWERABLE_PROFILE_CATEGORIES } from './categories';
import type { FieldSpec } from '../types/field';
import type { FieldCategory, PolicyClass } from '../types/intent';
import type { SubmittedAnswer, SubmittedValue } from '../types/submitted';

/** The classes this job's earlier answer may fill; EEO, legal and sensitive only with the sensitive part loaded. */
const SAME_JOB_CLASSES: ReadonlySet<PolicyClass> = new Set<PolicyClass>(['profile', 'unknown', 'free-text', 'eeo',
  'legal', 'sensitive']);
const SENSITIVE_CLASSES: ReadonlySet<PolicyClass> = new Set<PolicyClass>(['eeo', 'legal', 'sensitive']);
/** The classes another job's answer may fill: never a sensitive one, never free text. */
const OTHER_JOB_CLASSES: ReadonlySet<PolicyClass> = new Set<PolicyClass>(['profile', 'unknown']);

/** The kinds that show options to choose one of (a remote search's typed choice among them), and several of. */
const ONE_OF: ReadonlySet<FieldKind> = new Set<FieldKind>(['select', 'radio', 'combobox', 'typeahead-remote']);
const SEVERAL: ReadonlySet<FieldKind> = new Set<FieldKind>(['checkbox-group', 'multiselect']);
const TYPED: ReadonlySet<FieldKind> = new Set<FieldKind>(['text', 'textarea']);

/** v1.5 X: the classes an answer TailorIT prepared for the job may fill (module header). */
const DRAFT_CLASSES: ReadonlySet<PolicyClass> = new Set<PolicyClass>(['profile', 'unknown', 'free-text']);

/** Whether an earlier answer's shape can be given through a field of this kind. */
export function submittedFitsKind(answer: SubmittedValue, kind: FieldKind): boolean {
  switch (answer.kind) {
    case 'options':
      return (ONE_OF.has(kind) && answer.labels.length === 1) || (SEVERAL.has(kind) && answer.labels.length > 0);
    case 'text':
      return TYPED.has(kind) && answer.text.trim() !== '';
    case 'checked':
      return kind === 'checkbox';
  }
}

/** What the resolver knows of the field besides its spec. */
export interface SubmittedContext {
  /** The class of what the field asks (categories.ts policyClassOf). */
  policy: PolicyClass;
  /** The classify screen withholds the field (resolver/classify.ts screenForClassify): a sensitive question. */
  screened: boolean;
  /** This browser may read the person's sensitive answers, and the part is loaded. */
  sensitiveReady: boolean;
}

/** An earlier answer for the field: written, or (`gone`) one whose option the field no longer offers. */
export interface SubmittedFound {
  answer: SubmittedAnswer;
  gone: boolean;
}

/** The clean labels a field offers now, as keys.ts reads them; null while its list is not read. */
function offered(spec: Pick<FieldSpec, 'options'>): ReadonlySet<string> | null {
  if (spec.options === 'lazy') return null;
  return new Set(spec.options.filter((option) => !option.disabled)
    .map((option) => qualifiedLabel(cutInjected(option.label).clean)).filter((label) => label !== ''));
}

/** Whether each of an options answer's labels is still offered. */
function stillOffered(answer: SubmittedValue, labels: ReadonlySet<string>): boolean {
  return answer.kind !== 'options' || answer.labels.every((label) => labels.has(qualifiedLabel(label)));
}

/** The newest of a list, or null. */
function newest(list: readonly SubmittedAnswer[]): SubmittedAnswer | null {
  let best: SubmittedAnswer | null = null;
  for (const answer of list) if (best === null || answer.submittedAt > best.submittedAt) best = answer;
  return best;
}

/** This job's answers to the field's own question (module header, 2): one question's, else null. Answers TailorIT
 *  names no question of are one question each. */
function ownQuestion(own: readonly SubmittedAnswer[], spec: Pick<FieldSpec, 'section' | 'ordinal'>):
  readonly SubmittedAnswer[] | null {
  const identity = (answer: SubmittedAnswer, at: number) => (answer.questionId === undefined ? `#${at}` : `q${answer.questionId}`);
  const questions = new Set(own.map(identity));
  if (questions.size <= 1) return [...own];
  const section = sectionKey(spec.section);
  const here = own.filter((answer) => answer.section === section);
  const pool = here.length > 0 ? here : own;
  const ids = [...new Set(pool.map(identity))];
  if (ids.length === 1) return pool;
  // Several questions with the field's label in its section: the one at its ordinal, in form order.
  const firstOrder = new Map<string, number>();
  pool.forEach((answer, at) => {
    const id = identity(answer, at);
    firstOrder.set(id, Math.min(firstOrder.get(id) ?? Number.POSITIVE_INFINITY, answer.order ?? Number.POSITIVE_INFINITY));
  });
  const ordered = [...firstOrder.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
  if (ordered.some((id) => firstOrder.get(id) === Number.POSITIVE_INFINITY)) return null;
  const chosen = ordered[spec.ordinal];
  return chosen === undefined ? null : pool.filter((answer, at) => identity(answer, at) === chosen);
}

/**
 * The earlier answer for a field (module header), or null. A field whose label is empty gets none; so does one in a
 * class no earlier answer may fill.
 */
export function findSubmittedAnswer(
  spec: Pick<FieldSpec, 'label' | 'optionSetHash' | 'kind' | 'options' | 'section' | 'ordinal'>,
  answers: readonly SubmittedAnswer[], ctx: SubmittedContext): SubmittedFound | null {
  if (answers.length === 0) return null;
  const labelKey = normalizeLabel(spec.label);
  if (labelKey === '') return null;
  const sensitive = SENSITIVE_CLASSES.has(ctx.policy) || ctx.screened;
  const sameJobAllowed = SAME_JOB_CLASSES.has(ctx.policy) && (!sensitive || ctx.sensitiveReady);
  const otherJobAllowed = OTHER_JOB_CLASSES.has(ctx.policy) && !sensitive;
  if (!sameJobAllowed && !otherJobAllowed) return null;
  const lazy = spec.optionSetHash === 'lazy';
  const fits = answers.filter((answer) => answer.labelKey === labelKey && submittedFitsKind(answer.answer, spec.kind));
  if (fits.length === 0) return null;
  if (sameJobAllowed) {
    const own = ownQuestion(fits.filter((answer) => answer.sameJob), spec);
    if (own !== null && own.length > 0) {
      const byHash = lazy ? null : newest(own.filter((answer) => answer.optionSetHash === spec.optionSetHash));
      if (byHash !== null) return { answer: byHash, gone: false };
      // The form changed since (its options differ), or its list is not read yet: by the label, each option checked.
      const byLabel = newest(own.filter((answer) => answer.answer.kind === 'options'));
      if (byLabel !== null) {
        const labels = offered(spec);
        return { answer: byLabel, gone: labels !== null && !stillOffered(byLabel.answer, labels) };
      }
    }
  }
  if (otherJobAllowed) {
    const others = fits.filter((answer) => !answer.sameJob && answer.optionSetHash !== 'lazy');
    if (!lazy) {
      const byHash = newest(others.filter((answer) => answer.optionSetHash === spec.optionSetHash));
      if (byHash !== null) return { answer: byHash, gone: false };
    } else {
      // A lazy list: by the label, so the loop reads it; once read, its hash decides (above).
      const byLabel = newest(others.filter((answer) => answer.answer.kind === 'options'));
      if (byLabel !== null) return { answer: byLabel, gone: false };
    }
  }
  return null;
}

// ── v1.5 X (PLAN decision 4) ──

/** What the draft step knows of the field besides its spec: its category, its class and the classify screen. */
export interface DraftContext {
  category: FieldCategory;
  policy: PolicyClass;
  /** The classify screen withholds the field (resolver/classify.ts screenForClassify): a sensitive question. */
  screened: boolean;
}

/**
 * The answer TailorIT prepared for this job's question ahead of time (module header), or null: none in a class a draft
 * may not fill, none for the field's label and option set, or one whose option the field no longer offers (the gap
 * then goes on to another job's earlier answer and the AI, unflagged).
 */
export function findDraftAnswer(
  spec: Pick<FieldSpec, 'label' | 'optionSetHash' | 'kind' | 'options' | 'section' | 'ordinal'>,
  drafts: readonly SubmittedAnswer[], ctx: DraftContext): SubmittedAnswer | null {
  if (!DRAFT_CLASSES.has(ctx.policy) || ctx.screened || spec.kind === 'file') return null;
  if (ctx.policy === 'profile' && !ANSWERABLE_PROFILE_CATEGORIES.has(ctx.category)) return null;
  // Read as this job's own answers, through the same matching, with no sensitive class allowed.
  const found = findSubmittedAnswer(spec, drafts.filter((answer) => answer.draft === true)
    .map((answer) => ({ ...answer, sameJob: true })), { policy: ctx.policy, screened: false, sensitiveReady: false });
  if (found === null || found.gone) return null;
  return drafts.find((answer) => answer.id === found.answer.id) ?? null;
}
// ── end v1.5 X ──
