/*
 * jr7 ENGINE-7, the jr6 leftovers BUILD7 assigns (SP jr6 FIXERS-I "Left for jr7"; IFIX-ADAPTERS open 1 and 3), the
 * books' half: a field its adapter names as reset by another (ScanInput.dependsOn) is decided again ('parent-settled')
 * - once that other's row settles no-match with nothing written (iCIMS's School list whose search finds no school and
 *   offers no "Other": its "Enter school name if not in the list above" box, left empty while the search ran);
 * - once that other, a lazy list, is read for the first time (a box that follows its list, decided while it was unread).
 * Bounded: each settlement and each first read once; never without the adapter's word.
 */
import { describe, expect, it } from 'vitest';
import { OPTION_SET_LAZY } from '../text/keys';
import type { BaseKey } from '../types/field';
import { createLoop, observeScan, recordRows, type LoopField, type LoopState } from './bookkeeping';
import { field, inOrder, unwrittenRow, withOptions } from './loop.testkit';

const [school, box] = inOrder(field('School', 'combobox', { options: [] }),
  field('Enter school name if not in the list above', 'text'));
const left = (spec: LoopField) => unwrittenRow(spec, 'conditional-question', { status: 'skipped',
  needsUserAction: false });
const noMatch = (spec: LoopField) => unwrittenRow(spec, 'no-match');
const dependsOn = new Map<BaseKey, BaseKey>([[box!.baseKey, school!.baseKey]]);

/** The first pass: the box left empty (it follows its list), the list's search under way (its row comes later). */
function searching(): LoopState {
  const first = observeScan(createLoop(), [school!, box!], { dependsOn }).state;
  return recordRows(first, [left(box!)]);
}

describe('jr7 ENGINE-7 (jr6 leftover): a parent\'s no-match row re-plans its dependent', () => {
  it('the box is decided again once the list settles no-match, with nothing written', () => {
    const settled = recordRows(searching(), [noMatch(school!)]);
    expect(settled.settled).toEqual([school!.baseKey]);
    const seen = observeScan(settled, [school!, box!], { dependsOn });
    expect(seen.pending).toEqual([box!.key]);
    expect(seen.state.fields.get(box!.baseKey)).toMatchObject({ status: 'pending', cause: 'parent-settled' });
    // Told once: the next scan's books start afresh.
    expect(seen.state.settled).toBeUndefined();
  });

  it('once only: the same no-match again re-plans nothing; nor without the adapter\'s word', () => {
    const settled = recordRows(searching(), [noMatch(school!)]);
    const again = recordRows(observeScan(settled, [school!, box!], { dependsOn }).state, [left(box!), noMatch(school!)]);
    expect(again.settled).toBeUndefined();
    expect(observeScan(again, [school!, box!], { dependsOn }).pending).toEqual([]);
    expect(observeScan(settled, [school!, box!]).pending).toEqual([]);
  });

  it('a list that took the school (written) or still waits re-plans nothing this way', () => {
    const waiting = recordRows(searching(), [unwrittenRow(school!, 'waiting-for-options')]);
    expect(waiting.settled).toBeUndefined();
    expect(observeScan(waiting, [school!, box!], { dependsOn }).pending).toEqual([]);
  });
});

describe('jr7 ENGINE-7 (jr6 leftover): a lazy list\'s first read re-plans its dependent', () => {
  const lazy: LoopField = { ...withOptions(school!, []), optionSetHash: OPTION_SET_LAZY,
    key: school!.key.replace(school!.optionSetHash, OPTION_SET_LAZY) as LoopField['key'] };
  const read = withOptions(school!, ['Northfield University', 'Lakeside College']);

  function unread(): LoopState {
    const first = observeScan(createLoop(), [lazy, box!], { dependsOn }).state;
    return recordRows(first, [unwrittenRow(lazy, 'waiting-for-options'), left(box!)]);
  }

  it('the box decided while its list was unread is decided again with the list, at the first read', () => {
    const seen = observeScan(unread(), [read, box!], { dependsOn });
    expect(seen.pending).toEqual([read.key, box!.key]);
    expect(seen.state.fields.get(box!.baseKey)).toMatchObject({ cause: 'parent-settled' });
  });

  it('not without the adapter\'s word, and not at a later change of options', () => {
    expect(observeScan(unread(), [read, box!]).pending).toEqual([read.key]);
    const once = observeScan(unread(), [read, box!], { dependsOn }).state;
    const decided = recordRows(once, [unwrittenRow(read, 'no-profile-value'), left(box!)]);
    const other = withOptions(school!, ['Northfield University']);
    expect(observeScan(decided, [other, box!], { dependsOn }).pending).toEqual([other.key]);
  });
});
