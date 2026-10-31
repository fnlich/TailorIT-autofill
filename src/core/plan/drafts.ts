/*
 * Drafts for free-text questions (Phase 6; docs/ARCHITECTURE.md "Resolver" › "Free text"; docs/design/core.md §8.2's
 * free-text row). With settings.llm.drafts on (off by default), planFrame asks TailorIT to draft an answer for a
 * free-text question no saved answer fills, and writes what comes back as an llm-draft that the person must confirm or
 * edit before the form is ready:
 * - Which fields: a free-text category the rules gave (never one only the LLM classified, nor one the rules hand to
 *   the person), with no saved answer, a label a person and the LLM may see, an empty text box or textarea that can be
 *   written, no sensitive topic in its label or description, and a maxLength of DRAFT_MIN_LENGTH or more (or none).
 *   A dry run asks for none: TailorIT's drafts are few a day, and a dry run writes nothing.
 * - What is asked: the field's key, its visible label (UntrustedText) and min(maxLength, DRAFT_MAX_LENGTH), or null
 *   with no maxLength (TailorIT then keeps the draft to DRAFT_DEFAULT_LENGTH). The worker adds the posting's visible
 *   text, the lookup's company and title, the canaries and the resume.
 * - What comes back (DraftVerdict, the worker's translation of TailorIT's answer): a text, or why there is none. A
 *   discarded draft is never written: its row is flagged with the reason. A text longer than the field's cap (its
 *   maxLength, else DRAFT_DEFAULT_LENGTH) is discarded too (draft-too-long), and the Guard's canary scan blocks one
 *   holding a canary (canary-in-value) before it reaches the frame, which scans it again before it writes.
 * - What is written: the text, provenance llm-draft {taskId, confirmedByUser: false}, at LLM_DRAFT (always flagged,
 *   llm-draft-needs-confirmation).
 * Pure: no text is logged or kept here; the worker holds the drafts for the run only.
 */
import { DRAFT_DEFAULT_LENGTH, DRAFT_MAX_LENGTH, DRAFT_MIN_LENGTH, DRAFT_QUESTION_MAX } from '../confidence';
import { llmMaySeeLabel } from '../guard/honeypot';
import { policyClassOf } from '../resolver/categories';
import { namesSensitiveTopic } from '../resolver/classify';
import type { FieldClassification } from '../resolver/resolve';
import { asUntrusted } from '../text/untrusted';
import type { FieldKey, FieldSpec } from '../types/field';
import type { ReasonCode } from '../types/fill';
import type { Resolution } from '../types/match';
import type { UntrustedText, VisibleText } from '../types/text';

/** One free-text question to draft an answer for (TailorIT's AutofillDraftQuestion). */
export interface DraftItem {
  /** The field's key: the item's identity, repeated in the answer. */
  key: FieldKey;
  /** The field's visible label, quotable. */
  question: UntrustedText;
  /** min(maxLength, DRAFT_MAX_LENGTH), or null when the field names none. */
  maxLength: number | null;
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

/**
 * The draft question for a field, or null when it gets none (module header): its class, its resolution, its label,
 * its kind and current value, its topic and its cap all decide. `writable` is the planner's own check (no honeypot,
 * not disabled or read-only).
 */
export function draftItemOf(spec: FieldSpec, classification: FieldClassification, resolution: Resolution,
  writable: boolean): DraftItem | null {
  if (!writable || classification.by !== 'rules' || classification.rules.needsUser !== undefined) return null;
  const category = classification.rules.category;
  if (category === undefined || policyClassOf(category) !== 'free-text') return null;
  // A saved answer fills it, or the resolution is no longer the person's (a draft is asked for nothing else).
  if (resolution.classifiedBy === 'saved' || resolution.action !== 'needs-user'
    || resolution.reason !== 'free-text-requires-user') return null;
  if (!PROSE_KINDS.has(spec.kind) || !llmMaySeeLabel(spec.labelSource)) return null;
  if (spec.current.kind === 'text' && spec.current.text.trim() !== '') return null;
  if (spec.current.kind !== 'text' && spec.current.kind !== 'empty') return null;
  if (namesSensitiveTopic(spec.label) || namesSensitiveTopic(spec.description)) return null;
  const max = spec.constraints.maxLength;
  if (max !== undefined && max < DRAFT_MIN_LENGTH) return null;
  const question = asUntrusted(spec.label as VisibleText, QUOTE_MAX);
  const cut = [...question].slice(0, DRAFT_QUESTION_MAX).join('').trimEnd() as UntrustedText;
  if (cut === '') return null;
  return { key: spec.key, question: cut, maxLength: max === undefined ? null : Math.min(max, DRAFT_MAX_LENGTH) };
}

/** Why a draft text may not be written into this field, or null: past the field's cap, or empty. */
export function draftRefusal(spec: Pick<FieldSpec, 'constraints'>, text: string): DraftDiscard | null {
  if (text.trim() === '') return 'draft-empty';
  return [...text].length > draftCap(spec) ? 'draft-too-long' : null;
}
