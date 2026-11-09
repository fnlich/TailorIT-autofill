/*
 * Drafts for free-text questions (Phase 6; docs/ARCHITECTURE.md "Resolver" › "Free text"; docs/design/core.md §8.2's
 * free-text row; the owner's amendments, docs/SPEC-AMENDMENTS.md). With settings.llm.drafts on (the default since
 * settings version 2), planFrame asks TailorIT to draft an answer for a free-text question no saved answer fills, and
 * writes what comes back as an llm-draft: accepted as written (llm-draft-written, nothing asked of the person), or,
 * while settings.llm.confirmDrafts is on, kept for the person to confirm or edit before the form is ready
 * (llm-draft-needs-confirmation, the Phase 6 behaviour).
 * - Which fields: a free-text category the rules gave (never one the rules hand to the person), or one only the LLM
 *   classified as a free-text question (the owner's amendments: §8.2's "draft only"), with no saved answer, a label a
 *   person and the LLM may see, an empty text box or textarea that can be written, and a maxLength of
 *   DRAFT_MIN_LENGTH or more (or none; a shorter box takes an AI answer, plan/answers.ts). A dry run asks for none:
 *   TailorIT's drafts are few a day, and a dry run writes nothing.
 * - Never in an EEO, legal or sensitive context (the Phase 6 review, E2): the box itself passes the classify screen
 *   (screenForClassify: its label, description, section's words and options), and so does every question it belongs
 *   to, none of which may be of the eeo, legal, sensitive, consent or attention class: the question whose answer
 *   revealed it (the loop's reveal edges) and, for a box that only asks for more about another question ("Please
 *   provide details", "If yes, please explain"), the question before it in its section. A "Please provide details" box
 *   under Criminal history, or after a felony question, gets no draft; nor does a box in a section whose every other
 *   question is closed (a self-identification or legal block whose heading the screen does not name). In a section
 *   that also holds open questions, its other questions close nothing else (the Phase E review, M1): a legal radio
 *   beside "Why do you want to work here?" in one Greenhouse section leaves that question open.
 * - What is asked: the field's key, its visible label (UntrustedText) and min(maxLength, DRAFT_MAX_LENGTH), or null
 *   with no maxLength (TailorIT then keeps the draft to DRAFT_DEFAULT_LENGTH). The worker adds the posting's visible
 *   text, the lookup's company and title, the canaries and the resume.
 * - Edit with AI (the owner's amendments): aiEditableField names the text boxes the page offers the button on, by the
 *   same screens (a free-text or unknown question, visible, labelled, no tripwire or attention check, no EEO, legal or
 *   sensitive context); rewriteItemOf is the one field's draft question at the person's click, with what the box holds
 *   now (`current`, page text quoted as untrusted, line breaks kept) for TailorIT to rewrite, the empty-box rule left
 *   out for that key only, and none when what it holds names a sensitive answer, a sum, a contact detail or a postal
 *   address (namesSensitiveAnswer: the Phase E review, MAJOR 3), or holds text addressed to AI tools (the tripwire:
 *   the audit of 2026-11-06, S-10).
 * - What comes back (DraftVerdict, the worker's translation of TailorIT's answer): a text, or why there is none. A
 *   discarded draft is never written: its row is flagged with the reason. A text longer than the field's cap (its
 *   maxLength, else DRAFT_DEFAULT_LENGTH) is discarded too (draft-too-long), and the Guard's canary scan blocks one
 *   holding a canary (canary-in-value) before it reaches the frame, which scans it again before it writes.
 * - What is written: the text, provenance llm-draft {taskId, confirmedByUser: false}, at LLM_DRAFT.
 * Pure: no text is logged or kept here; the worker holds the drafts for the run only.
 */
import {
  DRAFT_CURRENT_MAX, DRAFT_DEFAULT_LENGTH, DRAFT_MAX_LENGTH, DRAFT_MIN_LENGTH, DRAFT_QUESTION_MAX,
} from '../confidence';
import { llmMaySeeLabel } from '../guard/honeypot';
import { hasTripwire } from '../guard/tripwire';
import { policyClassOf } from '../resolver/categories';
import { namesSensitiveAnswer, openAnswerTopics, screenForClassify } from '../resolver/classify';
import type { FieldClassification } from '../resolver/resolve';
import { capCodePoints, foldLetters } from '../text/fold';
import { asUntrusted } from '../text/untrusted';
import type { BaseKey, FieldKey, FieldSpec } from '../types/field';
import type { FillResult, ReasonCode } from '../types/fill';
import type { FieldCategory, PolicyClass } from '../types/intent';
import type { Resolution } from '../types/match';
import type { UntrustedText, VisibleText } from '../types/text';
import type { Vocab } from '../vocab/types';

/** One free-text question to draft an answer for (TailorIT's AutofillDraftQuestion). */
export interface DraftItem {
  /** The field's key: the item's identity, repeated in the answer. */
  key: FieldKey;
  /** The field's visible label, quotable. */
  question: UntrustedText;
  /** min(maxLength, DRAFT_MAX_LENGTH), or null when the field names none. */
  maxLength: number | null;
  /** Edit with AI: what the box holds now, each line quotable, at most DRAFT_CURRENT_MAX; absent for a new draft. */
  current?: UntrustedText;
}

/** The reasons a draft is not written (the worker maps TailorIT's to these; the core adds draft-too-long). */
export type DraftDiscard = Extract<ReasonCode, 'draft-empty' | 'draft-too-long' | 'draft-ai-reference' | 'draft-wrapper'
  | 'draft-contact' | 'canary-in-value' | 'llm-invalid-output' | 'llm-unavailable' | 'llm-disabled-for-category'
  | 'drafts-disabled'>;

/** TailorIT's draft for one field, as the worker read it: a text and its task, or why there is none. */
export type DraftVerdict =
  | { key: FieldKey; text: string; taskId: string }
  | { key: FieldKey; text: null; why: DraftDiscard };

/** The kinds a draft is written into. */
const PROSE_KINDS: ReadonlySet<FieldSpec['kind']> = new Set<FieldSpec['kind']>(['text', 'textarea']);

/** A draft's question is cleaned whole, then cut. */
const QUOTE_MAX = 4 * DRAFT_QUESTION_MAX;

/** The cap a field's draft is held to: its maxLength (never more than DRAFT_MAX_LENGTH), else TailorIT's default. */
export function draftCap(spec: Pick<FieldSpec, 'constraints'>): number {
  const max = spec.constraints.maxLength;
  return max === undefined ? DRAFT_DEFAULT_LENGTH : Math.min(max, DRAFT_MAX_LENGTH);
}

/** The classes whose questions no draft may belong to (E2). */
const NO_DRAFT_CLASSES: ReadonlySet<PolicyClass> = new Set<PolicyClass>(['eeo', 'legal', 'sensitive', 'consent',
  'attention']);

/** A box that only asks for more about another question: "Please provide details", "If yes, please explain",
 *  "Details", "Please specify", "Explain your answer" (read in lower case, its marks folded). */
const FOLLOW_UP_ASK = /\b(?:if\s+(?:yes|no|so|not|applicable|other)|please\s+(?:provide|give|add|share|list|explain|describe|elaborate|specify|detail|clarify)|details?|explain|explanation|elaborate|specify|clarify)\b/;

/** One of the frame's fields, with what classified it, as the planner holds them. */
export interface DraftNeighbour {
  spec: FieldSpec;
  classification: FieldClassification;
}

/** What a field's draft is judged against besides the field (E2): the frame's whole scan in DOM order, with each
 *  field's classification, the loop's reveal edges (parent, child), and the vocabulary. */
export interface DraftContext {
  fields: readonly DraftNeighbour[];
  revealEdges: ReadonlyArray<readonly [BaseKey, BaseKey]>;
  vocab: Vocab;
  /** Whether the profile holds no work-authorization entry at all: a question whose country cannot be read is then one
   *  the profile does not answer, which an `all` answer may (plan/answers.ts). Absent: unknown, never asked. */
  noWorkAuthorization?: boolean;
}

/** The category a classification asks about: the rules' (the one they hand to the person included), an attention
 *  check's, the LLM's suggestion, or unknown. */
function askedCategory(classification: FieldClassification): FieldCategory {
  switch (classification.by) {
    case 'tripwire':
      return classification.rules?.category ?? classification.rules?.asks ?? 'unknown';
    case 'attention':
      return classification.consent ?? 'attentionCheck';
    case 'rules':
      return classification.rules.needsUser !== undefined ? classification.rules.asks
        : classification.rules.category ?? 'unknown';
    case 'llm':
      return classification.llm.kind === 'none' ? 'unknown' : classification.llm.category;
    case 'none':
      return 'unknown';
  }
}

/** Whether a question is one no draft or AI answer may belong to: its class, a tripwire in its own text, or the
 *  classify screen. */
export function closedQuestion(field: DraftNeighbour, vocab: Vocab): boolean {
  return field.classification.by === 'tripwire'
    || NO_DRAFT_CLASSES.has(policyClassOf(askedCategory(field.classification)))
    || screenForClassify(field.spec, vocab) !== null;
}

/** The questions a box belongs to (module header): the questions whose answers revealed it, and the question before it
 *  in its section when it only asks for more. Its section's other questions are not among them (the Phase E review,
 *  M1): Greenhouse puts a form's every question in one section, a legal or consent one among the rest. */
export function questionsOf(spec: FieldSpec, context: DraftContext): DraftNeighbour[] {
  const related: DraftNeighbour[] = [];
  for (const [parent, child] of context.revealEdges) {
    if (child !== spec.baseKey) continue;
    const found = context.fields.find((field) => field.spec.baseKey === parent);
    if (found !== undefined) related.push(found);
  }
  if (FOLLOW_UP_ASK.test(foldLetters(spec.label).toLowerCase())) {
    const before = context.fields.filter((field) => field.spec.key !== spec.key
      && field.spec.section.id === spec.section.id && field.spec.domOrder < spec.domOrder)
      .sort((a, b) => b.spec.domOrder - a.spec.domOrder)[0];
    if (before !== undefined) related.push(before);
  }
  return related;
}

/** The classes a question of an `all` answer's context may not be of (the owner's decision of 2026-11-01): a
 *  self-identification or consent question. A legal, pay or attention-check question beside it closes nothing. */
const OPEN_CLOSING_CLASSES: ReadonlySet<PolicyClass> = new Set<PolicyClass>(['eeo', 'consent']);

/** Whether a question closes the context of an AI answer of TailorIT's `all` scope (plan/answers.ts): a tripwire in
 *  its own text, a self-identification, consent or pronoun question, or text that names a topic the scope never asks
 *  about or offers an EEO answer (classify.ts openAnswerTopics). */
export function closesOpenAnswer(field: DraftNeighbour, vocab: Vocab): boolean {
  const category = askedCategory(field.classification);
  return field.classification.by === 'tripwire' || OPEN_CLOSING_CLASSES.has(policyClassOf(category))
    || category === 'identity.pronouns'
    || openAnswerTopics(field.spec, vocab, field.classification.by === 'attention') === null;
}

/** Whether a box sits in a block of closed questions only, whose heading the screen does not name ("Voluntary
 *  disclosures", "Legal"): a section of its own, every other question of which (its block's) is one no draft or AI
 *  answer may belong to (with `open`, one that closes an `all` answer's context). A section that also holds questions
 *  of the person's own (Greenhouse's one section) is none. */
function inClosedBlock(spec: FieldSpec, context: DraftContext, open: boolean): boolean {
  if (spec.section.id === 'main') return false;
  const others = context.fields.filter((field) => field.spec.key !== spec.key
    && field.spec.section.id === spec.section.id && field.spec.section.block === spec.section.block);
  const closes = (field: DraftNeighbour) => (open ? closesOpenAnswer(field, context.vocab)
    : closedQuestion(field, context.vocab));
  return others.length > 0 && others.every(closes);
}

/** Whether a field sits in an EEO, legal or sensitive context (E2): its own screen (its section's words included),
 *  the questions it belongs to, and a block of closed questions only. A legal, consent or EEO question beside it in a
 *  section that holds other open questions closes nothing else (the Phase E review, M1). With `open` (an answer of
 *  TailorIT's `all` scope, whose own text plan/answers.ts screens with openAnswerTopics): only the questions it belongs
 *  to and its block, by closesOpenAnswer. */
export function inClosedContext(spec: FieldSpec, context: DraftContext, open = false): boolean {
  if (open) {
    return questionsOf(spec, context).some((field) => closesOpenAnswer(field, context.vocab))
      || inClosedBlock(spec, context, true);
  }
  return screenForClassify(spec, context.vocab) !== null
    || questionsOf(spec, context).some((field) => closedQuestion(field, context.vocab))
    || inClosedBlock(spec, context, false);
}

/** Whether the classification says the field is a free-text question a draft may answer: the rules' free-text
 *  category, or a free-text question only the LLM classified (§8.2's "draft only"). */
function freeTextQuestion(classification: FieldClassification): boolean {
  if (classification.by === 'rules') {
    const { category, needsUser } = classification.rules;
    return needsUser === undefined && category !== undefined && policyClassOf(category) === 'free-text';
  }
  return classification.by === 'llm' && classification.llm.kind === 'needs-user'
    && classification.llm.reason === 'free-text-requires-user' && policyClassOf(classification.llm.category) === 'free-text';
}

/** The field's visible label as a draft's question, or '' when nothing quotable is left. */
function questionOf(spec: FieldSpec): UntrustedText {
  const question = asUntrusted(spec.label as VisibleText, QUOTE_MAX);
  return [...question].slice(0, DRAFT_QUESTION_MAX).join('').trimEnd() as UntrustedText;
}

/**
 * The draft question for a field, or null when it gets none (module header): its class, its resolution, its label,
 * its kind and current value, its screen and its context's, and its cap all decide. `writable` is the planner's own
 * check (no honeypot, not disabled or read-only).
 */
export function draftItemOf(spec: FieldSpec, classification: FieldClassification, resolution: Resolution,
  writable: boolean, context: DraftContext): DraftItem | null {
  if (!writable || !freeTextQuestion(classification)) return null;
  // A saved answer fills it, or the resolution is no longer the person's (a draft is asked for nothing else).
  if (resolution.classifiedBy === 'saved' || resolution.action !== 'needs-user'
    || resolution.reason !== 'free-text-requires-user') return null;
  if (!PROSE_KINDS.has(spec.kind) || !llmMaySeeLabel(spec.labelSource)) return null;
  if (spec.current.kind === 'text' && spec.current.text.trim() !== '') return null;
  if (spec.current.kind !== 'text' && spec.current.kind !== 'empty') return null;
  // Never in an EEO, legal or sensitive context: the box's own screen, then the questions it belongs to (E2).
  if (inClosedContext(spec, context)) return null;
  const max = spec.constraints.maxLength;
  if (max !== undefined && max < DRAFT_MIN_LENGTH) return null;
  const cut = questionOf(spec);
  if (cut === '') return null;
  return { key: spec.key, question: cut, maxLength: max === undefined ? null : Math.min(max, DRAFT_MAX_LENGTH) };
}

/** The policy classes Edit with AI is offered on: an open question, never one whose value comes from the profile. */
const EDITABLE_CLASSES: ReadonlySet<PolicyClass> = new Set<PolicyClass>(['free-text', 'unknown']);

/**
 * Whether the page may offer Edit with AI on a field (module header): a text box or textarea that can be written, is
 * visible and named by a label a person and the LLM can see, no tripwire or attention check in its own text, a
 * free-text or unknown question no rule hands to the person, not blocked, a cap a draft can keep to, and no EEO, legal
 * or sensitive context. `row` is the field's row in this plan.
 */
export function aiEditableField(spec: FieldSpec, classification: FieldClassification, resolution: Resolution,
  row: Pick<FillResult, 'status'>, writable: boolean, context: DraftContext): boolean {
  if (!writable || !PROSE_KINDS.has(spec.kind) || spec.visibility !== 'visible' || spec.labelVisible === false
    || !llmMaySeeLabel(spec.labelSource) || spec.label.trim() === '' || row.status === 'blocked') return false;
  if (classification.by === 'tripwire' || classification.by === 'attention') return false;
  if (classification.by === 'rules' && classification.rules.needsUser !== undefined) return false;
  // What the LLM hands to the person (a sensitive, consent or attention-check question) is theirs; a free-text
  // question it names is open.
  if (classification.by === 'llm' && classification.llm.kind === 'needs-user'
    && policyClassOf(classification.llm.category) !== 'free-text') return false;
  if (!EDITABLE_CLASSES.has(policyClassOf(resolution.category))) return false;
  const max = spec.constraints.maxLength;
  if (max !== undefined && max < DRAFT_MIN_LENGTH) return false;
  return !inClosedContext(spec, context) && questionOf(spec) !== '';
}

/** What a box holds now, quoted line by line (asUntrusted folds a line's spaces, so lines are cleaned one at a time),
 *  at most DRAFT_CURRENT_MAX; '' when nothing is left. A rich-text box's `current` is the visibleText walker's reading
 *  of it (dom/values.ts editableVisibleText: v5 p2-fill review, security 3), so no text a person cannot see is here. */
function currentOf(spec: FieldSpec): UntrustedText {
  if (spec.current.kind !== 'text') return '' as UntrustedText;
  const lines = spec.current.text.split(/\r\n?|\n/).map((line) => asUntrusted(line as VisibleText, DRAFT_CURRENT_MAX));
  return capCodePoints(lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), DRAFT_CURRENT_MAX).trimEnd() as UntrustedText;
}

/** Edit with AI (module header): the one field's draft question at the person's click, with what it holds now; null
 *  when the page may not offer the button on it, or what it holds names a sensitive answer, a sum, a contact detail
 *  or a postal address (classify.ts namesSensitiveAnswer: the Phase E review, MAJOR 3). */
export function rewriteItemOf(spec: FieldSpec, classification: FieldClassification, resolution: Resolution,
  row: Pick<FillResult, 'status'>, writable: boolean, context: DraftContext): DraftItem | null {
  if (!aiEditableField(spec, classification, resolution, row, writable, context)) return null;
  const max = spec.constraints.maxLength;
  const current = currentOf(spec);
  if (current !== '' && namesSensitiveAnswer(current, context.vocab)) return null;
  // What the box holds is the page's words as much as the person's (a page may have written it): text addressed to AI
  // tools in it is never sent (the audit of 2026-11-06, S-10; the tripwire's screen, as on a label).
  if (spec.current.kind === 'text' && hasTripwire(spec.current.text as VisibleText)) return null;
  return { key: spec.key, question: questionOf(spec), maxLength: max === undefined ? null : Math.min(max, DRAFT_MAX_LENGTH),
    ...(current === '' ? {} : { current }) };
}

/** Why a draft text may not be written into this field, or null: past the field's cap, or empty. */
export function draftRefusal(spec: Pick<FieldSpec, 'constraints'>, text: string): DraftDiscard | null {
  if (text.trim() === '') return 'draft-empty';
  return [...text].length > draftCap(spec) ? 'draft-too-long' : null;
}
