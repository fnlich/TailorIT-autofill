/*
 * Helpers for the reactive loop's tests: scanned fields built with the core's own key functions, the rows a pass
 * would record for them, and a stand-in for the content script's keyed value hash. A testkit: no non-test code imports
 * it.
 */
import type { FieldKind } from '../enums';
import { baseKey, fieldKey, labelSlug, OPTION_SET_NONE, optionSetHash } from '../text/keys';
import type { FieldKey, FieldSpec, OptionSetHash, SectionRef } from '../types/field';
import type { FillResult } from '../types/fill';
import type { ValueMac } from '../types/loop';
import { sha256Hex } from '../text/sha256';
import type { LoopField } from './bookkeeping';

/** The kinds a scanned field has options for. */
const OPTION_KINDS: readonly FieldKind[] = ['select', 'radio', 'checkbox-group', 'combobox', 'multiselect'];

/** What a test may set on a field besides its label and kind. */
export interface FieldExtra {
  /** Its options' labels, which make its option-set hash ([] for a list with no usable option). */
  options?: readonly string[];
  domOrder?: number;
  section?: SectionRef;
  ordinal?: number;
  required?: boolean;
}

/** A scanned field on Lever, in 'main', keyed as the scanner keys it. */
export function field(label: string, kind: FieldKind, extra: FieldExtra = {}): LoopField {
  const section = extra.section ?? { id: 'main' };
  const ordinal = extra.ordinal ?? 0;
  const slug = labelSlug({ label, kind, nameAttr: '', idAttr: '' });
  const hash: OptionSetHash = OPTION_KINDS.includes(kind) ? optionSetHash(extra.options ?? []) : OPTION_SET_NONE;
  const parts = { platform: 'lever' as const, section, labelSlug: slug, ordinal };
  return { key: fieldKey({ ...parts, optionSetHash: hash }), baseKey: baseKey(parts), kind, label, section,
    required: extra.required ?? false, optionSetHash: hash, domOrder: extra.domOrder ?? 0 };
}

/** The same field with other options (a new option-set hash, the same base key). */
export function withOptions(spec: LoopField, options: readonly string[]): LoopField {
  const hash = optionSetHash(options);
  const parts = spec.key.split('|');
  parts[3] = hash;
  return { ...spec, optionSetHash: hash, key: parts.join('|') as FieldKey };
}

/** Fields in DOM order: each gets its position. */
export function inOrder(...fields: LoopField[]): LoopField[] {
  return fields.map((spec, domOrder) => ({ ...spec, domOrder }));
}

/** A whole FieldSpec around a loop field, holding `text` as its current value (to show the loop never reads it). */
export function fullSpec(spec: LoopField, text: string): FieldSpec {
  return { ...spec, platform: 'lever', labelSource: 'for', labelVisible: true, description: '', options: [],
    constraints: {}, autocomplete: [], nameAttr: '', idAttr: '', ordinal: 0, visibility: 'visible', disabled: false,
    readOnly: false, current: { kind: 'text', text } };
}

/** A row for a field, as a pass would record it: verified and written unless `extra` says otherwise. */
export function rowOf(spec: Pick<LoopField, 'key' | 'label' | 'kind'>, extra: Partial<FillResult> = {}): FillResult {
  return {
    key: spec.key, label: spec.label, kind: spec.kind, category: 'unknown', section: 'main', required: false,
    status: 'verified', provenance: 'profile', matcherStage: 'not-applicable', confidence: 0.99, reason: 'ok',
    wrote: true, verification: 'verified', needsUserAction: false, ...extra,
  };
}

/** A row that wrote nothing, with its reason: flagged unless `extra` says otherwise. */
export function unwrittenRow(spec: Pick<LoopField, 'key' | 'label' | 'kind'>, reason: FillResult['reason'],
  extra: Partial<FillResult> = {}): FillResult {
  return rowOf(spec, { status: 'flagged', provenance: null, reason, wrote: false, verification: 'not-applicable',
    needsUserAction: true, ...extra });
}

/** The tests' stand-in for the content script's keyed hash of a value (HMAC under the run's key). */
export function mac(value: string): ValueMac {
  return sha256Hex(`run-key\u0000${value}`).slice(0, 32) as ValueMac;
}
