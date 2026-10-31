/*
 * The reactive loop's value hashes (docs/design/core.md §10.1; src/core/types/loop.ts). The core counts how often a
 * written field's value flips without ever seeing a value: the content script hands it a keyed hash (ValueMac) of what
 * each field holds, at the write's read-back and at every scan after it.
 * - The key is random bytes made once per run with crypto.subtle (HMAC-SHA-256), not extractable, and held in this
 *   run's memory only: it is never sent, stored or logged, so nothing outside the run can link or reverse a hash.
 * - Both readings go through one canonical form of the field's CurrentValue (canonicalValue): the scanner's own
 *   `current`, or readBack's, which builds the same CurrentValue from the live elements of the target just written
 *   (dom/values.ts's currentValueOf, over the same visible option labels). An option label is cut to the scanner's
 *   300 code points and a selection is sorted, so the two readings of one value always hash alike.
 * Values and hashes stay in memory: nothing here sends or logs either.
 */
import { capCodePoints } from '../core/text/fold';
import type { BaseKey, CurrentValue } from '../core/types/field';
import type { ValueMac } from '../core/types/loop';
import { TEXT_CAP_LABEL } from '../dom/thresholds';
import type { FieldTarget, ScannedField } from '../dom/types';
import { currentValueOf, type SelectableOption } from '../dom/values';

/** Separates the parts of a canonical value: no label or text can hold it unnoticed, and none is ever shown. */
const PART = '\u{0}';

/** One canonical string per value a field can hold: equal values, as the scanner reads them, give equal strings. */
export function canonicalValue(current: CurrentValue): string {
  switch (current.kind) {
    case 'empty':
      return 'empty';
    case 'text':
      return `text${PART}${current.text}`;
    case 'checked':
      return current.checked ? 'checked' : 'unchecked';
    case 'selected':
      return `selected${PART}${current.labels.map((label) => capCodePoints(label, TEXT_CAP_LABEL)).sort().join(PART)}`;
    case 'files':
      return `files${PART}${current.count}`;
  }
}

/** What a field holds right after a write, read from the target's live elements as the scanner reads a field: a
 *  select's options and a group's members carry the field's visible option labels, in the scan's order. */
export function readBack(target: FieldTarget): CurrentValue {
  const { field, control } = target;
  const labels = field.options === 'lazy' ? [] : field.options.map((option) => option.label);
  let selectable: SelectableOption[] = [];
  if (target.options.length > 0) {
    selectable = target.options.map((option, at) => ({ label: labels[at] ?? '', selected: option.selected }));
  } else if (target.members.length > 0) {
    selectable = target.members.map((member, at) => ({ label: labels[at] ?? '', selected: member.checked }));
  }
  return currentValueOf(field.kind, control, selectable);
}

/** Keyed hashes of values under one run's key. */
export interface ValueHasher {
  /** The keyed hash of a value's canonical form. */
  mac(current: CurrentValue): Promise<ValueMac>;
  /** The hashes of these fields' values as a scan read them, by base key. */
  macsOf(fields: readonly Pick<ScannedField, 'baseKey' | 'current'>[]): Promise<Map<BaseKey, ValueMac>>;
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A hasher with a fresh random key, for one run. `subtle` is the window's crypto.subtle by default. */
export async function createValueHasher(subtle: SubtleCrypto = crypto.subtle): Promise<ValueHasher> {
  const key = await subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const encoder = new TextEncoder();
  const mac = async (current: CurrentValue): Promise<ValueMac> =>
    hex(await subtle.sign('HMAC', key, encoder.encode(canonicalValue(current)))) as ValueMac;
  return {
    mac,
    async macsOf(fields) {
      const pairs = await Promise.all(fields.map(async (field) => [field.baseKey, await mac(field.current)] as const));
      return new Map(pairs);
    },
  };
}
