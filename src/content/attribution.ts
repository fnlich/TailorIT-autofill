/*
 * The DOM layer's attribution for the reactive loop (ScanInput.attribution, docs/design/core.md §10.1): which write
 * made a field appear, or changed its options. Every scan the run makes of the form root is seen here in order: the
 * pass's own, and each pre-write scan of the DOM guard (domGuardBeforeWrite scans afresh before every write). A base
 * key that appears, or whose key changes (its options), between a write and the very next scan belongs to that write:
 * nothing else wrote in between, and no page timer has had its turn yet. So Country, whose change handler replaces
 * Postal code with ZIP code, is named as ZIP code's parent, not the City that sits before it in the page. What a page
 * changes later (during the settle, after a request) is not attributed: the bookkeeping guesses that edge, and says so.
 * A field keeps the first write it was attributed to; a write is never its own parent. Keys only, never a value.
 */
import type { BaseKey, FieldKey } from '../core/types/field';
import type { ScannedField } from '../dom/types';

/** Tracks the scans and writes of one run, and the "this field followed that write" pairs between them. */
export class Attribution {
  /** The latest scan's fields: base key to key. */
  private last: ReadonlyMap<BaseKey, FieldKey> | null = null;
  /** The field written since the latest scan, if any. */
  private writer: BaseKey | null = null;
  private pairs = new Map<BaseKey, BaseKey>();

  /** A scan of the form root, in the order the run makes them. */
  saw(fields: readonly Pick<ScannedField, 'key' | 'baseKey'>[]): void {
    const now = new Map<BaseKey, FieldKey>();
    for (const field of fields) if (!now.has(field.baseKey)) now.set(field.baseKey, field.key);
    const writer = this.writer;
    if (writer !== null && this.last !== null) {
      for (const [baseKey, key] of now) {
        if (this.last.get(baseKey) === key || baseKey === writer || this.pairs.has(baseKey)) continue;
        this.pairs.set(baseKey, writer);
      }
    }
    this.last = now;
    this.writer = null;
  }

  /** A write that changed a field, right after its fill: what the next scan finds new is that write's. */
  wrote(baseKey: BaseKey): void {
    this.writer = baseKey;
  }

  /** Whether a write still waits for the scan that tells what it changed. */
  get awaitingScan(): boolean {
    return this.writer !== null;
  }

  /** The pairs found since the last call, child to parent, for observeScan; the next pass starts afresh. */
  take(): Map<BaseKey, BaseKey> {
    const pairs = this.pairs;
    this.pairs = new Map();
    return pairs;
  }
}
