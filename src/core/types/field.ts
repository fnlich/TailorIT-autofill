/*
 * What the pure layers see of a form field. The scanner builds these from the DOM; the resolver, matcher and Guard read
 * them without touching the DOM. Everything here is page text, hashes or flags: an answer never appears in a field's
 * identity, and the current value lives in memory only.
 */
import type { FieldFormat, FieldKind, FieldVisibility, LabelSource, Platform } from '../enums';

/** One option exactly as the scanner read it (visibleText rules, at most 300 characters). Page content: untrusted. */
export interface Option {
  /** 0-based position among the visible options in DOM order: the only identity the planner, the cache and the LLM use. */
  index: number;
  label: string;
  /** The native value attribute, for the filler only. Never matched on, never sent to an LLM: it is not visible. */
  value?: string;
  /** The visible optgroup or section heading. */
  group?: string;
  disabled: boolean;
  selected: boolean;
}

/** What a field allows, from its attributes and its visible label and hint. */
export interface Constraints {
  maxSelections?: number;
  minSelections?: number;
  /** "Choose 3". */
  exactSelections?: number;
  /** The legitimate phrase "select all that apply": select those that apply to the profile. */
  selectAllThatApply?: boolean;
  format?: FieldFormat;
  /** A pattern from the placeholder or the adapter ("MM/YYYY", "(###) ###-####"). Shapes formatting, never values. */
  pattern?: string;
  maxLength?: number;
  min?: number;
  max?: number;
  /** A file input's accept tokens, lower case. */
  accept?: string[];
}

/** What the field holds when scanned: a prefill, or our earlier write. In memory only, never logged or stored. */
export type CurrentValue =
  | { kind: 'empty' }
  | { kind: 'text'; text: string }
  | { kind: 'checked'; checked: boolean }
  /** The visible labels of the selected options or chips. */
  | { kind: 'selected'; labels: string[] }
  /** `held` (the behaviour review of 2026-11-06, M2): the input itself holds no file, and the page shows one it took
   *  (Adapter.uploadHeld): the person's setting "Résumé already on the page" decides whether it stays. `names`: the
   *  names the page shows beside those files (Adapter.uploadHeldNames), which the planner compares with the person's
   *  chosen résumé's so it never puts it in a second time (the integration of 2026-11-06). */
  | { kind: 'files'; count: number; held?: true; names?: string[] };

/** `${platform}|${sectionId}|${labelSlug}|${optionSetHash}|${ordinal}`, the spec's composition. Page text and hashes only. */
export type FieldKey = string & { readonly __brand: 'FieldKey' };
/** The key without the option-set hash: one field's identity while its options change (country, then the state list). */
export type BaseKey = string & { readonly __brand: 'BaseKey' };
/** SHA-256 (16 hex) of the sorted, normalized clean labels of the usable options. 'none' for a field without options
 *  ('' on TailorIT's wire), 'lazy' until a custom widget is opened. */
export type OptionSetHash = string & { readonly __brand: 'OptionSetHash' };

/** Where a field sits: the adapter's section id or the slug of the nearest visible heading, plus its block index in a
 *  repeatable section. */
export interface SectionRef {
  id: string;
  block?: number;
}

/** Everything the resolver, matcher and Guard read of a field. */
export interface FieldSpec {
  key: FieldKey;
  baseKey: BaseKey;
  /** The platform of the frame's host (shared/hosts.ts), even when the generic adapter handles the page. */
  platform: Platform;
  section: SectionRef;
  kind: FieldKind;
  label: string;
  labelSource: LabelSource;
  /** A visible source names this field. False for 'none', and for an aria-label whose words are not visible beside the
   *  control: such a label may drive the rules, but the field is never written (no-visible-label), never asks for the
   *  sensitive part, and its label never reaches an LLM. */
  labelVisible: boolean;
  /** Visible help text (aria-describedby or an adjacent hint); '' when none. */
  description: string;
  /** The core pass of 2026-11-06: set only when the field's own visible label, past the 300 characters `label` keeps,
   *  states that no AI was used (resolver/classifyRules statesNoAiUse over the whole label, which the frame alone
   *  reads): Dropzone's AI policy states its attestation in its last sentences. The field is then an "I did not use
   *  AI" attestation (plan/attestation.ts). */
  statesNoAi?: true;
  required: boolean;
  options: Option[] | 'lazy';
  /** Set only when a widget's list was read in part (a cap stopped the read before its end, the Phase 4 review, R9):
   *  an answer may lie past what was read, so the planner chooses only an exact or alias match there, always flagged
   *  (options-incomplete), and never a loose, Other or LLM one. */
  optionsPartial?: true;
  /** v4 (drop): set only when `options` are what one typed query showed (a remote typeahead's results, or a long list
   *  its own text box filtered: content/pass.ts resultsSpec), never the field's whole list: one is chosen only in the
   *  fill band, never by the LLM, and when none is, the frame types its next query (plan/frame.ts planChoice). */
  searchResults?: true;
  optionSetHash: OptionSetHash;
  constraints: Constraints;
  /** autocomplete tokens, lower case, with section-, shipping and billing prefixes removed. */
  autocomplete: string[];
  nameAttr: string;
  idAttr: string;
  /** Earlier fields in DOM order with the same platform, section id and label slug. The option-set hash never affects it. */
  ordinal: number;
  domOrder: number;
  visibility: FieldVisibility;
  disabled: boolean;
  readOnly: boolean;
  current: CurrentValue;
}

/** Opaque to the core. The DOM layer re-finds the element by key on every use, because React replaces nodes; it never
 *  caches a node. The core passes handles through and never reads them. */
export interface ElementHandle {
  readonly key: FieldKey;
  readonly frameId: number;
}

/** The spec's FieldDescriptor: the pure spec plus the handle the DOM layer acts through. */
export interface FieldDescriptor extends FieldSpec {
  el: ElementHandle;
}
