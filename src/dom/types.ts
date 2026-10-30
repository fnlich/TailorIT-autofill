/*
 * The DOM layer's own types: what a scan adds to the core's FieldSpec, and what settle() reports. The DOM layer works
 * from each element's ownerDocument and defaultView, never page globals, so it is correct inside any frame.
 *
 * Phase 2 added the scan's result (fields, counters, and re-finding a field by key), the filler's outcome, which maps
 * onto the review row's own fields, and the DOM half of the pre-write Guard's verdict.
 */
import type { BaseKey, FieldDescriptor, FieldKey, ReasonCode, SectionRef } from '../core/types';

/** How a visually hidden native control qualified to be filled (the proxy rule): through its tied visible label, or
 *  through an element the adapter declared. Highlights point at this element, not the hidden input. */
export type ProxyKind = 'label' | 'adapter';

/** A scanned field as the content script holds it: the descriptor plus where its highlight goes. */
export interface ScannedField extends FieldDescriptor {
  proxy: ProxyKind | null;
  /** The label was read from text a person can see. False for 'none', and for an aria-label whose words are not
   *  visible beside the control: such a label may drive the rules but never reaches an LLM, and the field is never
   *  filled. FieldSpec has no such flag, so the label source alone tells the worker ('aria-label' is never visible). */
  labelVisible: boolean;
  /** A text-like control drawn so it cannot be seen (no border, a background matching the page, no shadow, outline or
   *  visible placeholder). It is reported, but the DOM guard refuses to write it. */
  camouflaged: boolean;
}

/** What one scan of a form root found, besides its fields. Counts only: no text. */
export interface ScanCounters {
  hiddenControlsIgnored: number;
  /** Fields not rendered yet (content-visibility: auto); the notice asks the person to scroll to them. */
  deferredFields: number;
}

/** settle() ends on a DOM condition or its cap, never a fixed sleep. */
export type SettleResult = { settled: true; ms: number } | { settled: false; reason: 'page-still-busy' | 'aborted' };

/** A field's live elements in one scan, for the guard and the fillers to act on at once. Never kept across a write:
 *  the page may replace them (React does), so the next write re-finds them by key. */
export interface FieldTarget {
  readonly field: ScannedField;
  /** The control, or a group's first member. */
  readonly control: Element;
  /** A radio or checkbox group's members in option order: members[i] is field.options[i]. [] otherwise. */
  readonly members: readonly HTMLInputElement[];
  /** A select's visible options in option order: options[i] is field.options[i]. [] otherwise. */
  readonly options: readonly HTMLOptionElement[];
  /** Where the highlight goes for a hidden control: its label or the adapter's widget. */
  readonly proxy: Element | null;
}

/** A hidden file input that did not qualify, beside a visible upload control: it gets a flagged row with reason
 *  upload-control-not-recognized, and is never written, focused or sent an event. */
export interface UnrecognisedUpload {
  key: FieldKey;
  baseKey: BaseKey;
  /** The upload control's visible text (at most 300 characters). */
  label: string;
  section: SectionRef;
}

/** One scan of a form root. */
export interface ScanResult {
  /** The fields, in DOM order (at most MAX_SCAN_FIELDS). */
  readonly fields: readonly ScannedField[];
  readonly counters: ScanCounters;
  /** Visible password and one-time-code controls: never fields. A step that has one is an auth pause. */
  readonly authFields: number;
  readonly unrecognisedUploads: readonly UnrecognisedUpload[];
  /** The form had more fields than MAX_SCAN_FIELDS; the rest were left out. */
  readonly truncated: boolean;
  /** This scan's elements for a field. Use them at once: after any write, rescan. */
  target(key: FieldKey): FieldTarget | null;
  /** A fresh scan of the same root, with the same adapter and options: how a field is re-found by key on every use. */
  rescan(): ScanResult;
}

/** The reason codes a filler can end with. */
export const FILL_OUTCOME_REASONS = ['ok', 'already-correct', 'verify-mismatch', 'needs-your-click',
  'unexpected-selection', 'element-not-found', 'disabled-or-readonly', 'not-user-visible', 'maxlength-exceeded',
  'pdf-only-input', 'resume-format-unsupported', 'resume-unavailable', 'format-unsupported', 'value-rejected-by-site',
  'options-changed', 'widget-unsupported', 'internal-error'] as const satisfies readonly ReasonCode[];
export type FillOutcomeReason = (typeof FILL_OUTCOME_REASONS)[number];

/**
 * What one filler call did, for the core's row-settling helper. Its fields are the review row's own (FillResult's
 * wrote, verification, reason and needsUserAction), so settling a planned row is a merge. It never carries a value.
 * - verified: written (or already right) and read back equivalent: 'ok' or 'already-correct';
 * - mismatch: written, but it reads back differently ('verify-mismatch', 'unexpected-selection',
 *   'value-rejected-by-site'): the row is filled, not verified;
 * - not-checked: nothing was written, for the reason given ('needs-your-click' when the page ignored our events or a
 *   click was refused; 'maxlength-exceeded', 'pdf-only-input', 'disabled-or-readonly', ...).
 */
export interface FillOutcome {
  /** The control changed state because of us: a setter ran and stuck, or a click toggled it. */
  wrote: boolean;
  verification: 'verified' | 'mismatch' | 'not-checked';
  reason: FillOutcomeReason;
  /** The person must act: the site ignored untrusted events, or a click was refused as one that could submit. */
  needsUserAction: boolean;
}

/** How a read-back is compared with what was written: digits for phones, case-folded for emails, as numbers for
 *  amounts, with collapsed white space for other text, or exactly. */
export const READ_BACK_RULES = ['text', 'digits', 'casefold', 'numeric', 'exact'] as const;
export type ReadBackRule = (typeof READ_BACK_RULES)[number];

/** The reason codes the DOM half of the pre-write Guard can refuse a write with. */
export const DOM_GUARD_REASONS = ['element-not-found', 'options-changed', 'not-user-visible', 'disabled-or-readonly',
  'no-visible-label', 'auth-required', 'internal-error'] as const satisfies readonly ReasonCode[];
export type DomGuardReason = (typeof DOM_GUARD_REASONS)[number];

/** The DOM half of the pre-write Guard: the field re-found now, or why it may not be written. */
export type DomGuardVerdict = { ok: true; target: FieldTarget } | { ok: false; reason: DomGuardReason };
