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
  | { kind: 'files'; count: number };

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
  /** Visible help text (aria-describedby or an adjacent hint); '' when none. */
  description: string;
  required: boolean;
  options: Option[] | 'lazy';
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
