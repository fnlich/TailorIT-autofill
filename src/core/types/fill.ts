/*
 * What the worker sends a frame to write, and the value-free row the review panel shows for every field. The trap
 * fixtures assert these reason codes by name, so a code is never renamed without its fixtures.
 */
import type { FieldKind, FillStatus, MatcherStage, Provenance } from '../enums';
import type { BaseKey, FieldKey } from './field';
import type { FieldCategory, ValueOrigin, WriteValue } from './intent';
import type { Match } from './match';

/** Why a field ended as it did. */
export const REASON_CODES = [
  // done, possibly needing a look
  'ok', 'filled-low-confidence', 'already-correct', 'prefill-kept', 'prefill-conflict', 'llm-pick-needs-review',
  'llm-draft-needs-confirmation', 'other-option-with-free-text', 'other-without-free-text',
  'option-label-had-injected-text',
  // resolution gaps
  'no-profile-value', 'unknown-field', 'low-confidence', 'classification-conflict', 'eeo-not-in-profile',
  'legal-not-in-profile', 'decline-option-missing', 'work-auth-country-unknown', 'consent-requires-user',
  'attention-check', 'free-text-requires-user', 'drafts-disabled', 'llm-disabled-for-category', 'llm-unavailable',
  'llm-invalid-output', 'llm-pick-rejected', 'saved-answer-not-allowed-for-category', 'end-date-not-applicable',
  'sensitive-not-shared', 'sensitive-unavailable', 'statement-not-affirmative',
  // matcher
  'no-match', 'ambiguous-options', 'distinctive-token-mismatch', 'waiting-for-options', 'options-never-loaded',
  'options-changed', 'max-selections-reached', 'partial-multi-select', 'exclusive-conflict', 'preselected-left-untouched',
  // guard
  'honeypot', 'not-user-visible', 'no-visible-label', 'canary-in-value', 'canary-equals-profile-value',
  'missing-provenance', 'policy-violation', 'mark-all-aborted', 'exceeds-profile-set', 'tripwire-in-label',
  'injected-option-only',
  // filler and verification
  'verify-mismatch', 'widget-unsupported', 'needs-your-click', 'unexpected-selection', 'element-not-found',
  'disabled-or-readonly', 'value-rejected-by-site', 'format-unsupported', 'maxlength-exceeded',
  'upload-control-not-recognized', 'pdf-only-input', 'resume-unavailable', 'resume-transfer-failed',
  'resume-format-unsupported',
  // loop and steps
  'field-disappeared', 'value-oscillated', 'reveal-cycle', 'max-passes-reached', 'page-busy', 'step-retry-limit',
  'auth-required', 'challenge-present', 'policy-declined', 'user-stopped',
  // the reactive loop (Phase 3): a list whose options kept changing
  'options-oscillated',
  // the Phase 3 review: a value the person changed after our write (LC-4); the loop cut at a policy notice or by a
  // frame its page hid mid-fill (L-S2, L-S4)
  'changed-by-you', 'policy-notice', 'form-hidden',
  // the LLM steps (Phase 4): a field whose category only the LLM's classification gave, filled and flagged
  'llm-classified-needs-review',
  // the Phase 4 review (R9): a widget's list read only in part, so its answer may lie past what was read
  'options-incomplete',
  // drafts (Phase 6): a draft TailorIT discarded, or one past the field's cap, is never written: the resume had nothing
  // to say; it was longer than the field allows; it spoke of being an AI; it held the prompt's wrapper or sentinels; it
  // named a link, an email or a phone number that is not the person's
  'draft-empty', 'draft-too-long', 'draft-ai-reference', 'draft-wrapper', 'draft-contact',
  // the owner's amendments (docs/SPEC-AMENDMENTS.md), each on a row that needs nothing of the person: a draft written
  // and accepted; an AI answer resting on the resume, the profile or the job; an AI answer with nothing to rest on
  // (marked "AI guess"); the form's decline option chosen for a self-identification question the profile leaves
  // unanswered. Then, flagged: the AI gave no answer; the posting forbids AI, so a question only the AI could answer
  // was left for the person
  'llm-draft-written', 'llm-answer-written', 'ai-guess', 'eeo-decline-default', 'llm-no-answer', 'ai-off-for-posting',
  // the Phase E review: a criminal-history question the person's one answer ("convicted of a crime?") does not settle:
  // a narrower one when the answer is yes, or an arrest, a charge or a registration
  'criminal-not-covered',
  // cover letters (Phase G), on a cover-letter upload: the person's own letter for the job attached; one TailorIT's AI
  // wrote (during this run, or before it and never edited) attached (marked "AI"); a dry run's promise that a fill has
  // TailorIT's AI write one. Then, flagged: TailorIT is finding or writing it (the row while the field waits);
  // TailorIT could not write one, or the person's own is not finished; there is none and TailorIT's AI may not write
  // one here; TailorIT could not be asked or could not send it; it took past the cap; this connection was made before
  // cover letters
  'cover-letter-attached', 'cover-letter-written', 'cover-letter-would-write', 'cover-letter-waiting',
  'cover-letter-failed', 'cover-letter-none', 'cover-letter-unavailable', 'cover-letter-timed-out',
  'cover-letter-reconnect',
  // the owner's decisions of 2026-11-01 (docs/SPEC-AMENDMENTS.md §11): an optional consent not pre-approved (marketing,
  // SMS), left unticked and recorded as decided; an "I did not use AI" attestation left for the person because the run
  // used AI, so ticking it would be untrue
  'consent-optional-unticked', 'ai-attestation-ai-used',
  // v3 Phase 2 (Ashby): a file the page's own upload rejected (its failure message names it), or whose upload the page
  // never showed done within the wait; an AI draft held back from a page that saves every answer at once, while the
  // person's setting keeps drafts for their confirmation (written only when they confirm it)
  'upload-failed', 'upload-not-confirmed', 'llm-draft-held',
  // a bug
  'internal-error',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

/** What the worker answers a frame's plan/request with, one per field to write. `origin` is required, so a value without
 *  provenance cannot be typed. */
export interface PlannedWrite {
  key: FieldKey;
  value: WriteValue;
  origin: ValueOrigin;
  match: Match;
}

/** One row of the review panel: the spec's FillResult, extended. It never carries a value or an option label. */
export interface FillResult {
  key: FieldKey;
  /** The field's visible label (page text, at most 300 characters). */
  label: string;
  kind: FieldKind;
  category: FieldCategory;
  section: string;
  required: boolean;
  status: FillStatus;
  /**
   * The provenance of the field's planned write: null exactly when the field has no write, planned or done. A dry run
   * writes nothing, yet its rows keep the provenance a fill would use (with `wrote` false), so the panel shows where
   * each value would come from; a write the frame refused or could not make (settleRow's blocked and not-written) is
   * null again.
   */
  provenance: Provenance | null;
  matcherStage: MatcherStage;
  confidence: number;
  reason: ReasonCode;
  wrote: boolean;
  verification: 'verified' | 'mismatch' | 'not-checked' | 'not-applicable';
  needsUserAction: boolean;
  /**
   * Suggestions by index and score only; the panel asks the frame for their labels when a row is expanded.
   * `userEdited`: the person changed this field with their own (trusted) input after the run left it flagged, so the
   * review may offer "Save my answer" (Requirement F; the content runtime sets it, Phase 6 wave 2). Never a value.
   */
  detail?: { suggestions?: Array<{ index: number; score: number }>; revealedBy?: BaseKey; userEdited?: true };
}
