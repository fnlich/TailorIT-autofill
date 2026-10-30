import { describe, expect, it } from 'vitest';
import { createLoop, loopVerdict, observeScan, recordRows, recordWrite } from './bookkeeping';
import { field, inOrder, mac, rowOf, unwrittenRow, withOptions } from './loop.testkit';
import { disappearedRow, loopRows, unplannedRow, unresolvedRow } from './rows';

const email = field('Email', 'text');
const country = field('Country', 'select', { options: ['Canada', 'United States'] });

describe('disappearedRow', () => {
  it('rows a field we wrote as a write that did not read back, for the person to check', () => {
    expect(disappearedRow(rowOf(email))).toMatchObject({ status: 'filled', reason: 'field-disappeared', wrote: true,
      provenance: 'profile', verification: 'not-checked', needsUserAction: true });
    expect(disappearedRow(rowOf(email, { status: 'flagged', reason: 'filled-low-confidence' }))).toMatchObject({
      status: 'flagged', reason: 'field-disappeared', needsUserAction: true });
  });

  it('rows a field we did not write as skipped: there is nothing left to do', () => {
    for (const row of [unwrittenRow(email, 'no-profile-value'), unwrittenRow(email, 'canary-in-value',
      { status: 'blocked' })]) {
      expect(disappearedRow(row)).toMatchObject({ status: 'skipped', reason: 'field-disappeared', wrote: false,
        provenance: null, verification: 'not-applicable', needsUserAction: false });
    }
  });

  it('leaves a row already rowed so', () => {
    const once = disappearedRow(rowOf(email));
    expect(disappearedRow(once)).toBe(once);
  });
});

describe('unresolvedRow', () => {
  it('flags the row with the loop’s reason, under the key the field has now', () => {
    const swapped = withOptions(country, ['Mexico']);
    expect(unresolvedRow(rowOf(country), 'value-oscillated', swapped.key)).toMatchObject({ key: swapped.key,
      status: 'flagged', reason: 'value-oscillated', wrote: true, verification: 'not-checked', needsUserAction: true });
    expect(unresolvedRow(unwrittenRow(country, 'waiting-for-options'), 'options-never-loaded')).toMatchObject({
      key: country.key, status: 'flagged', reason: 'options-never-loaded', verification: 'not-applicable' });
  });

  it("keeps a blocked row's status and reason: the Guard's word stands", () => {
    const blocked = unwrittenRow(email, 'canary-in-value', { status: 'blocked' });
    expect(unresolvedRow(blocked, 'max-passes-reached')).toEqual(blocked);
  });
});

describe('unplannedRow', () => {
  it('rows a field nothing classified, flagged with the reason', () => {
    const tracked = observeScan(createLoop(), [country]).state.fields.get(country.baseKey)!;
    expect(unplannedRow(tracked, 'max-passes-reached')).toEqual({ key: country.key, label: 'Country', kind: 'select',
      category: 'unknown', section: 'main', required: false, status: 'flagged', provenance: null, matcherStage: 'none',
      confidence: 0, reason: 'max-passes-reached', wrote: false, verification: 'not-applicable',
      needsUserAction: true });
    const text = observeScan(createLoop(), [email]).state.fields.get(email.baseKey)!;
    expect(unplannedRow(text, 'page-busy').matcherStage).toBe('not-applicable');
  });
});

describe('loopRows', () => {
  const auth = field('Are you legally authorized to work in the US?', 'radio', { options: ['Yes', 'No'] });
  const sponsor = field('Will you require sponsorship?', 'select', { options: ['Yes', 'No'] });

  it('lists the present fields in DOM order, then the ones that went, naming each revealer', () => {
    const first = inOrder(email, auth);
    let books = observeScan(createLoop(), first).state;
    books = recordRows(books, [unwrittenRow(email, 'no-profile-value')]);
    books = recordRows(recordWrite(books, auth.key, { valueMac: mac('No') }), [rowOf(auth)]);
    const second = inOrder(auth, sponsor);
    const seen = observeScan(books, second);
    books = recordRows(recordWrite(seen.state, sponsor.key, { valueMac: mac('Yes') }), [rowOf(sponsor)]);
    const end = observeScan(books, second);
    expect(end.verdict.done).toBe(true);
    const rows = loopRows(end.state, end.verdict);
    expect(rows.map((row) => [row.label, row.status, row.reason, row.detail?.revealedBy ?? null])).toEqual([
      [auth.label, 'verified', 'ok', null],
      [sponsor.label, 'verified', 'ok', auth.baseKey],
      [email.label, 'skipped', 'field-disappeared', null],
    ]);
  });

  it('gives a field the loop never planned a row only when the verdict leaves it unresolved', () => {
    const books = observeScan(createLoop(), [email]).state;
    expect(loopRows(books, loopVerdict(books))).toEqual([]);
    const cut = loopVerdict(books, { cut: 'page-busy' });
    expect(loopRows(books, cut)).toEqual([unplannedRow(books.fields.get(email.baseKey)!, 'page-busy')]);
  });

  it('flags a stopped field with its reason, even while the loop goes on', () => {
    let books = recordRows(observeScan(createLoop(), [email]).state, [rowOf(email)]);
    for (const value of ['a', 'b', 'c', 'd']) {
      books = recordWrite(books, email.key, { valueMac: mac(value) });
    }
    expect(books.fields.get(email.baseKey)?.status).toBe('oscillating');
    expect(loopRows(books, { done: false, end: null, unresolved: [] })).toMatchObject([{ key: email.key,
      status: 'flagged', reason: 'value-oscillated' }]);
  });
});
