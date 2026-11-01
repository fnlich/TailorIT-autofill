/*
 * AI answers (the owner's amendments, docs/SPEC-AMENDMENTS.md "Fill everything"; TailorIT's POST /api/autofill/ai/answer,
 * AutofillAnswerRequest in the contract). With settings.llm.answers on (the default since settings version 2), a
 * question nothing on the extension's side settled is asked of TailorIT, which answers from the resume and the
 * profile's non-sensitive facts it reads itself, or with its best guess (basis `guess`, marked "AI guess"):
 * - Which fields (answerItemOf): one that can be written, named by a label a person and the LLM may see, with no
 *   tripwire or attention check in its own text, no rule handing it to the person, no saved answer, and no EEO, legal
 *   or sensitive context (the classify screen over its label, description, section and options, which also withholds
 *   any field that offers a decline option, then the questions it belongs to: drafts.ts inClosedContext, E2). Its gap
 *   is one the AI may fill: an unknown question; a short free-text box (maxLength under DRAFT_MIN_LENGTH: a longer one
 *   takes a draft); a job preference, availability, referral, years of experience or skill the profile holds no value
 *   for (ANSWERABLE_PROFILE_CATEGORIES); or, among the profile's questions, a list only the LLM classified whose match
 *   was a tie no tiebreak could settle (an AI-only tie). Never a sensitive, legal, EEO, consent, attention or file
 *   question, never one only the person answers, and never one about another person, an identifier, a postal address
 *   or a security clearance (namesUnanswerableTopic, classifyRules' namesAnotherPerson: the Phase E review, M2).
 * - A lazy list (a combobox whose options show only when opened) whose question is answerable waits for its options
 *   (answerWaitsForOptions: the planner rows it waiting-for-options), so the loop reads it and the next pass asks with
 *   them (the Phase E review, M7).
 * - Its shape: a choice for a select, a radio group or a combobox (never a set, a lone checkbox, a typeahead, a date or
 *   an upload), whose list was read whole, holds nothing chosen yet, and offers 2 to ANSWER_MAX_OPTIONS options that
 *   can be chosen, an option whose label had injected text cut never among them; or a text for an empty text box or
 *   textarea that asks for no contact detail, link, date or postal code, capped at min(maxLength, ANSWER_TEXT_MAX).
 * - What is sent: visible text only, each string made by asUntrusted: the label, the description, the section's words
 *   and, for a choice, each option's clean label under its own index (the hash of that label stays here). No profile
 *   text: TailorIT reads the facts itself. The worker adds the posting's visible text, the lookup's company and title,
 *   the resume and the canaries.
 * - What comes back (AnswerVerdict, the worker's translation): a choice of one sent option, a text, or why there is
 *   none. planFrame writes a choice as an llm-pick naming the task, the option and the hash of its label as sent (the
 *   frame checks the option again: llmPickStillValid), and a text as an llm-answer naming the task and its basis; each
 *   through guardWrite (the canary scan included), never past the field's own cap. Either is accepted as written:
 *   `llm-answer-written`, or `ai-guess` when it rests on nothing, neither needing the person.
 * Pure: no text is logged or kept here; the worker holds the answers for the run only.
 */
import {
  ANSWER_HINT_MAX, ANSWER_MAX_OPTIONS, ANSWER_MIN_OPTIONS, ANSWER_QUESTION_MAX, ANSWER_SECTION_MAX, ANSWER_TEXT_MAX,
  DRAFT_MIN_LENGTH, TIEBREAK_LABEL_MAX,
} from '../confidence';
import type { FieldFormat, FieldKind } from '../enums';
import { detectionViews } from '../guard/fold';
import { llmMaySeeLabel } from '../guard/honeypot';
import { cutInjected } from '../guard/injected';
import { chooseable, prepareOptions } from '../matcher/prepare';
import { ANSWERABLE_PROFILE_CATEGORIES, policyClassOf, USER_ONLY_CATEGORIES } from '../resolver/categories';
import { classifiable, sectionWordsOfKey } from '../resolver/classify';
import { namesAnotherPerson } from '../resolver/classifyRules';
import { namesConsentTopic } from '../resolver/labelRules';
import type { FieldClassification } from '../resolver/resolve';
import { capCodePoints } from '../text/fold';
import { sectionKey } from '../text/keys';
import { normalizeLabel } from '../text/normalize';
import { sha256Hex } from '../text/sha256';
import { asUntrusted } from '../text/untrusted';
import type { FieldKey, FieldSpec } from '../types/field';
import type { FillResult, ReasonCode } from '../types/fill';
import type { AnswerBasis } from '../types/intent';
import type { Resolution } from '../types/match';
import type { UntrustedText, VisibleText } from '../types/text';
import { inClosedContext, type DraftContext } from './drafts';

/** What an answer is: one of the field's own options, or a short text (TailorIT's AUTOFILL_ANSWER_SHAPES). */
export type AnswerShape = 'choice' | 'text';

/** One option a choice is asked with: its own index, its clean label as sent, and that label's hash (never sent: the
 *  llm-pick it becomes names it, so the frame can tell the option still reads as the LLM saw it). */
export interface AnswerOption {
  index: number;
  label: UntrustedText;
  labelHash: string;
}

/** One question to answer (TailorIT's AutofillAnswerItem). */
export interface AnswerItem {
  /** The field's key: the item's identity, repeated in the answer. */
  key: FieldKey;
  shape: AnswerShape;
  kind: FieldKind;
  /** The field's visible label, quotable. */
  question: UntrustedText;
  /** Its visible description, '' when none. */
  hint: UntrustedText;
  /** Its section's words, '' for the form's main part. */
  section: UntrustedText;
  /** A choice's observed option-set hash; null for a text. */
  optionSetHash: string | null;
  /** A choice's options, in the field's order; [] for a text. */
  options: AnswerOption[];
  /** A text's cap: min(maxLength, ANSWER_TEXT_MAX), or null when the field names none (TailorIT then keeps to
   *  ANSWER_TEXT_MAX); null for a choice. */
  maxLength: number | null;
}

/** Why an answer is not written (the worker maps TailorIT's reasons to these; the frame adds the checks of its own). */
export type AnswerDiscard = Extract<ReasonCode, 'llm-no-answer' | 'llm-invalid-output' | 'llm-unavailable'
  | 'llm-disabled-for-category' | 'canary-in-value' | 'options-changed' | 'llm-pick-rejected' | 'maxlength-exceeded'>;

/** TailorIT's answer for one field, as the worker read it: a chosen option (its index, the hash of its label as sent),
 *  a text, or why there is none. */
export type AnswerVerdict =
  | { key: FieldKey; kind: 'choice'; optionSetHash: string; index: number; labelHash: string; basis: AnswerBasis;
      taskId: string }
  | { key: FieldKey; kind: 'text'; text: string; basis: AnswerBasis; taskId: string }
  | { key: FieldKey; kind: 'none'; why: AnswerDiscard };

/** The kinds each shape answers (the contract's AUTOFILL_ANSWER_KINDS). */
const CHOICE_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>(['select', 'radio', 'combobox']);
const TEXT_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>(['text', 'textarea']);

/** Formats an AI never writes: a contact detail, a link, a date or a postal code is the profile's or the person's. */
const NO_ANSWER_FORMATS: ReadonlySet<FieldFormat> = new Set<FieldFormat>(['email', 'tel', 'url', 'date', 'month-year',
  'postal-code']);

/**
 * What an AI answer never states, read in a question's text, its hint, its section's words and its options (the Phase
 * E review, M2): another person's details (an emergency contact, a referee or reference, a manager's, a spouse's), an
 * identifier (a number, an ID, a licence, a passport, a social security or insurance number), a postal address, and a
 * security clearance (TS/SCI, secret, ITAR: the legal class). Lower case, over every detection view.
 */
const UNANSWERABLE: readonly RegExp[] = [
  // Another person.
  /\bemergency\b/, /\breferences?\b/, /\breferees?\b/, /\bnext\s+of\s+kin\b/, /\bspouses?\b/, /\bguardians?\b/,
  /\b(?:manager|supervisor|spouse|partner|parent|guardian)(?:'|’)s\b/,
  /\b(?:managers?|supervisors?)\s+(?:name|e\s?-?mail|phone|contact|title)\b/,
  // Identifiers ("Number of years" counts, so a number followed by "of" is none).
  /\bnumbers?\b(?!\s+of\b)/, /\bids?\b/, /\bidentification\b/, /\bidentifier\b/, /\blicen[cs]e[sd]?\b/, /\bpassports?\b/,
  /\bssn\b/, /\bsocial\s+(?:security|insurance)\b/, /\bnational\s+insurance\b/, /\btax\s+(?:id|file|number)\b/,
  // A postal address ("address" as a verb, "How would you address a conflict?", is none).
  /\b(?:home|mailing|postal|street|current|permanent|residential|billing|physical|full|your|e\s?-?mail)\s+address(?:es)?\b/,
  /^\W*address(?:es)?\b/, /\baddress\s+(?:line|1|2|of\s+residence)\b/, /\bstreet\b/, /\bzip\b/, /\bpostal\b/,
  /\bpost\s?codes?\b/, /\bp\.?\s?o\.?\s+box\b/, /\bapartment\b/, /\bwhere\s+do\s+you\s+(?:currently\s+)?live\b/,
  // A security clearance.
  /\bclearances?\b/, /\bts\s*[/-]?\s*sci\b/, /\bsecret\b/, /\bitar\b/, /\bpolygraph\b/,
];

/** The short identifiers matched in capitals only, as the page wrote them: SIN, NI ("sin" and "ni" are words too). */
const UNANSWERABLE_ACRONYMS: readonly RegExp[] = [/\bSIN\b/, /\bNI\b/];

/** Whether page text names what an AI answer never states (UNANSWERABLE, the Phase E review, M2), or asks for a
 *  consent (labelRules namesConsentTopic: a newsletter, being contacted about other roles, a talent pool), which only
 *  the person or a pre-approval gives. The worker screens each answer item again with it (ai-tasks.ts
 *  answerItemOfCore). */
export function namesUnanswerableTopic(text: string): boolean {
  if (text.trim() === '') return false;
  if (UNANSWERABLE_ACRONYMS.some((acronym) => acronym.test(text))) return true;
  if (namesConsentTopic(normalizeLabel(text))) return true;
  return detectionViews(text).some((view) => {
    const lower = view.toLowerCase();
    return UNANSWERABLE.some((pattern) => pattern.test(lower));
  });
}

/** The reasons a profile field's row gives for a gap an AI answer may fill (ANSWERABLE_PROFILE_CATEGORIES). */
const PROFILE_GAPS: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['no-profile-value', 'low-confidence', 'no-match',
  'ambiguous-options', 'unknown-field']);

/** The reasons an AI-only tie leaves (a list only the LLM classified, whose match the tiebreak may not settle). */
const TIE_GAPS: ReadonlySet<ReasonCode> = new Set<ReasonCode>(['ambiguous-options', 'low-confidence']);

/** Whether the field's gap is one an AI answer may fill (module header), by its class, its row and how it was
 *  classified. */
function answerableGap(spec: FieldSpec, resolution: Resolution, row: FillResult): boolean {
  const { category } = resolution;
  if (USER_ONLY_CATEGORIES.has(category)) return false;
  switch (policyClassOf(category)) {
    case 'unknown':
      return row.reason === 'unknown-field';
    case 'free-text': {
      // A box too short for a draft; a longer one takes the draft path.
      const max = spec.constraints.maxLength;
      return resolution.reason === 'free-text-requires-user' && max !== undefined && max < DRAFT_MIN_LENGTH;
    }
    case 'profile':
      if (ANSWERABLE_PROFILE_CATEGORIES.has(category)) return PROFILE_GAPS.has(row.reason);
      return resolution.classifiedBy === 'llm-classify' && CHOICE_KINDS.has(spec.kind) && TIE_GAPS.has(row.reason);
    default:
      return false;
  }
}

/** A text cut after a whole code point limit, quotable. */
function quote(text: string, max: number): UntrustedText {
  return capCodePoints(asUntrusted(text as VisibleText, 4 * max), max).trimEnd() as UntrustedText;
}

/** The options a choice is asked with: every one that can be chosen and has a label, none whose label had injected text
 *  cut; null when the list was not read whole, already holds a choice, or has too few or too many to ask about. */
function choiceOptions(spec: FieldSpec, context: DraftContext): AnswerOption[] | null {
  if (spec.options === 'lazy' || spec.optionsPartial === true) return null;
  const prepared = prepareOptions(spec.options, 'generic', context.vocab);
  // A list with a choice of its own (the page's, the person's) is theirs. A native select always shows an option, so
  // its selection says something only when it has a placeholder to show instead (planChoice's rule).
  const selected = prepared.list.some((option) => option.selected && !option.unusable && !option.placeholder);
  const labels = spec.current.kind === 'selected' ? spec.current.labels.filter((label) => label.trim() !== '') : [];
  const holds = spec.kind === 'select' ? selected && prepared.list.some((option) => option.placeholder)
    : selected || labels.length > 0;
  if (holds) return null;
  const usable = prepared.list.filter((option) => chooseable(option) && !option.injected && option.clean.trim() !== '');
  if (usable.length < ANSWER_MIN_OPTIONS || usable.length > ANSWER_MAX_OPTIONS) return null;
  const options = usable.map((option) => {
    const label = asUntrusted(option.clean as VisibleText, TIEBREAK_LABEL_MAX);
    return { index: option.index, label, labelHash: sha256Hex(label) };
  });
  return options.some((option) => option.label === '') ? null : options;
}

/** Whether a field's question is one an AI answer may fill, its options aside (module header): writable, labelled for
 *  the LLM, no tripwire or attention check, no rule or LLM handing it to the person, no saved answer, a gap an answer
 *  may fill, no EEO, legal or sensitive context, and nothing an answer never states (namesUnanswerableTopic, another
 *  person). */
function answerable(spec: FieldSpec, classification: FieldClassification, resolution: Resolution, row: FillResult,
  writable: boolean, context: DraftContext): boolean {
  if (!writable || !classifiable(spec) || !llmMaySeeLabel(spec.labelSource)) return false;
  if (classification.by === 'tripwire' || classification.by === 'attention') return false;
  if (classification.by === 'rules' && classification.rules.needsUser !== undefined) return false;
  // What the LLM hands to the person (a sensitive, consent or attention-check question) is theirs; a free-text
  // question it names takes a draft, or an answer when its box is short.
  if (classification.by === 'llm' && classification.llm.kind === 'needs-user'
    && policyClassOf(classification.llm.category) !== 'free-text') return false;
  if (resolution.classifiedBy === 'saved' || row.status === 'blocked' || row.wrote) return false;
  if (!answerableGap(spec, resolution, row)) return false;
  if (inClosedContext(spec, context)) return false;
  const options = spec.options === 'lazy' ? [] : spec.options.map((option) => cutInjected(option.label).clean);
  if ([spec.label, spec.description, sectionWordsOfKey(sectionKey(spec.section)), ...options]
    .some(namesUnanswerableTopic)) return false;
  return !namesAnotherPerson(spec);
}

/**
 * Whether a field would be asked once its options are read (the Phase E review, M7): a single choice whose list is
 * lazy (a combobox read only when opened) and whose question is answerable. The planner then rows it
 * waiting-for-options, so the loop reads the widget and the next pass asks with the real options.
 */
export function answerWaitsForOptions(spec: FieldSpec, classification: FieldClassification, resolution: Resolution,
  row: FillResult, writable: boolean, context: DraftContext): boolean {
  return spec.options === 'lazy' && CHOICE_KINDS.has(spec.kind)
    && answerable(spec, classification, resolution, row, writable, context);
}

/**
 * The answer item of a field, or null when it gets none (module header). `row` is the row planField gave it (the gap
 * it leaves), `writable` the planner's own check (no honeypot, not disabled or read-only).
 */
export function answerItemOf(spec: FieldSpec, classification: FieldClassification, resolution: Resolution,
  row: FillResult, writable: boolean, context: DraftContext): AnswerItem | null {
  if (!answerable(spec, classification, resolution, row, writable, context)) return null;
  const question = quote(spec.label, ANSWER_QUESTION_MAX);
  if (question === '') return null;
  const base = { key: spec.key, kind: spec.kind, question, hint: quote(spec.description, ANSWER_HINT_MAX),
    section: quote(sectionWordsOfKey(sectionKey(spec.section)), ANSWER_SECTION_MAX) };
  if (CHOICE_KINDS.has(spec.kind)) {
    const options = choiceOptions(spec, context);
    if (options === null || spec.optionSetHash === 'lazy' || spec.optionSetHash === 'none') return null;
    return { ...base, shape: 'choice', optionSetHash: spec.optionSetHash, options, maxLength: null };
  }
  if (!TEXT_KINDS.has(spec.kind)) return null;
  if (spec.current.kind === 'text' ? spec.current.text.trim() !== '' : spec.current.kind !== 'empty') return null;
  const format = spec.constraints.format;
  if (format !== undefined && NO_ANSWER_FORMATS.has(format)) return null;
  const max = spec.constraints.maxLength;
  if (max !== undefined && max < 1) return null;
  return { ...base, shape: 'text', optionSetHash: null, options: [],
    maxLength: max === undefined ? null : Math.min(max, ANSWER_TEXT_MAX) };
}

/** The cap an answer's text is held to in this field: its maxLength, never more than ANSWER_TEXT_MAX. */
export function answerCap(spec: Pick<FieldSpec, 'constraints'>): number {
  const max = spec.constraints.maxLength;
  return max === undefined ? ANSWER_TEXT_MAX : Math.min(max, ANSWER_TEXT_MAX);
}

/** Why an answer's text may not be written into this field, or null: empty, past its cap, or a line break in a one-line
 *  box. */
export function answerRefusal(spec: Pick<FieldSpec, 'constraints' | 'kind'>, text: string): AnswerDiscard | null {
  if (text.trim() === '') return 'llm-no-answer';
  if ([...text].length > answerCap(spec)) return 'maxlength-exceeded';
  return spec.kind === 'text' && /[\r\n]/.test(text) ? 'llm-invalid-output' : null;
}
