/*
 * v1.3 B (the owner, 2026-11-09; docs/SPEC-AMENDMENTS.md §16): the person's own answers to the questions of the
 * applications they submitted, as TailorIT gives them back (POST /api/autofill/forms/known), held in the worker's
 * memory for one run and never stored by the extension. One fills the same question again with no AI
 * (core/resolver/submitted.ts, provenance submitted-before): this job's first (a re-apply), another job's only for a
 * question that is not sensitive. The answer's shape is the saved answers' (an option's labels, never its place; a
 * text; a box's state).
 */
import type { FieldKind } from '../enums';
import type { OptionSetHash } from './field';

/** An answer as it was submitted: option labels (clean, never their places), a text, or a box's state. */
export type SubmittedValue =
  | { kind: 'options'; labels: string[] }
  | { kind: 'text'; text: string }
  | { kind: 'checked'; checked: boolean };

/** One question the person answered in an application they submitted. */
export interface SubmittedAnswer {
  /** The worker's id for it within the run (an llm-pick names its task the same way): the write's origin names it. */
  id: string;
  /** normalizeLabel(question) as the extension computed it when it was submitted. */
  labelKey: string;
  /** The observed option-set hash when it was submitted; 'none' for a question without options. */
  optionSetHash: OptionSetHash;
  /** This job's own question it answered (TailorIT's question id), when it is this job's: several questions of one
   *  form with the same label are told apart by `section` and `order`. */
  questionId?: number;
  /** The question's section as the extension sent it (core/text/keys.ts sectionKey), '' when unknown. */
  section?: string;
  /** The question's place in its form (its step, then its position), for questions with the same label. */
  order?: number;
  kind: FieldKind;
  answer: SubmittedValue;
  /** This job's own (the same TailorIT job, or the same posting): a re-apply. False: another job's. */
  sameJob: boolean;
  /** When it was submitted (ms since the epoch): the newest wins among equals. */
  submittedAt: number;
}
