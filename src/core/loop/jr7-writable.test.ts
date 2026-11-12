/*
 * jr7 ENGINE-7 E2 item 1 (FIX7PLAN §6.2, ADP7-2), the books' half: a required, empty field the page holds disabled or
 * read-only (ADP's Address Line 1, read-only until its Country is in) waits for the page to let it in, as a list with
 * no options waits for them, instead of being skipped for good. The content script names such fields (recordRows'
 * `locked`), tells which the page now lets in (ScanInput.writable) and when the bound passed (recordWritableWait).
 */
import { describe, expect, it } from 'vitest';
import type { FieldKey } from '../types/field';
import { createLoop, loopVerdict, observeScan, recordRows, recordWritableWait, type LoopState } from './bookkeeping';
import { field, inOrder, unwrittenRow } from './loop.testkit';
import { loopRows } from './rows';

const [address, email] = inOrder(field('Address Line 1', 'text', { required: true }),
  field('Email', 'text', { required: true }));
const locked = (spec: typeof address) => unwrittenRow(spec!, 'disabled-or-readonly',
  { status: 'skipped', needsUserAction: false });

/** The first pass: Address Line 1 named held (required, empty, locked); Email locked too but holding a value. */
function firstPass(): LoopState {
  const first = observeScan(createLoop(), [address!, email!]).state;
  return recordRows(first, [locked(address), locked(email)], { locked: [address!.key] });
}

describe('jr7 ENGINE-7 E2 item 1 (ADP7-2): a required, empty field the page holds disabled or read-only', () => {
  it('waits, and keeps the loop from ending, while the page holds it', () => {
    const state = firstPass();
    expect(state.fields.get(address!.baseKey)).toMatchObject({ status: 'waiting-writable', reason: 'disabled-or-readonly' });
    // A field holding a value is never named: its skip stands, and it never waits.
    expect(state.fields.get(email!.baseKey)).toMatchObject({ status: 'resolved', reason: 'disabled-or-readonly' });
    const again = observeScan(state, [address!, email!], { writable: new Set() });
    expect(again.pending).toEqual([]);
    expect(again.verdict.done).toBe(false);
    expect(again.state.fields.get(address!.baseKey)!.status).toBe('waiting-writable');
  });

  it('is planned again once a scan finds it writable', () => {
    const seen = observeScan(firstPass(), [address!, email!], { writable: new Set([address!.baseKey]) });
    expect(seen.pending).toEqual([address!.key]);
    expect(seen.state.fields.get(address!.baseKey)).toMatchObject({ status: 'pending', cause: 'writable' });
    expect(seen.state.stalled).toBe(false);
  });

  it('past the bound is flagged for the person, never skipped, and the loop ends with nothing pending', () => {
    const waited = observeScan(firstPass(), [address!, email!], { writable: new Set() }).state;
    const over = recordWritableWait(waited, address!.key);
    expect(over.fields.get(address!.baseKey)).toMatchObject({ status: 'unresolvable', reason: 'disabled-or-readonly' });
    const end = observeScan(over, [address!, email!], { writable: new Set() });
    expect(end.verdict).toMatchObject({ done: true, end: 'nothing-pending' });
    const rows = new Map(loopRows(end.state, end.verdict).map((row) => [row.label, row] as const));
    expect(rows.get('Address Line 1')).toMatchObject({ status: 'flagged', reason: 'disabled-or-readonly',
      needsUserAction: true, wrote: false });
    expect(rows.get('Email')).toMatchObject({ status: 'skipped', reason: 'disabled-or-readonly' });
  });

  it('a loop that ends while it waits (the passes run out, a cut) leaves it flagged, with the cut\'s reason if cut', () => {
    const waited = firstPass();
    expect(loopVerdict({ ...waited, pass: 1_000 }).unresolved).toEqual([{ key: address!.key,
      baseKey: address!.baseKey, reason: 'disabled-or-readonly' }]);
    expect(loopVerdict(waited, { cut: 'user-stopped' }).unresolved).toEqual([{ key: address!.key,
      baseKey: address!.baseKey, reason: 'user-stopped' }]);
  });

  it('recordWritableWait leaves alone a field that does not wait so, or a key it no longer has', () => {
    const state = firstPass();
    expect(recordWritableWait(state, email!.key)).toBe(state);
    expect(recordWritableWait(state, 'lever|main|nothing|none|0' as FieldKey)).toBe(state);
  });
});
