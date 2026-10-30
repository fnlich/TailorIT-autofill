import { describe, expect, it } from 'vitest';
import type { BaseKey } from '../types/field';
import type { ValueMac } from '../types/loop';
import {
  baseKeyOf, childrenOf, createLoop, isFollowUpLabel, loopVerdict, MAX_OPTION_CHANGES, MAX_PASSES, MAX_REAPPEARANCES,
  MAX_REVEAL_EDGES, MAX_VALUE_FLIPS, observeScan, OPTION_WAIT_PASSES, orderPending, recordOptionsWait, recordRows,
  recordWrite, revealEdgesOf, type LoopEvent, type LoopField, type LoopState,
} from './bookkeeping';
import { field, fullSpec, inOrder, mac, rowOf, unwrittenRow, withOptions } from './loop.testkit';

/** The first scan of `fields`, every one of them planned and resolved by a row (verified unless given). */
function settled(fields: LoopField[], rows: Partial<Record<string, ReturnType<typeof rowOf>>> = {}): LoopState {
  const first = observeScan(createLoop(), fields).state;
  return recordRows(first, fields.map((spec) => rows[spec.label] ?? unwrittenRow(spec, 'no-profile-value')));
}

/** A write of `value` into `spec`, then its row. */
function written(state: LoopState, spec: LoopField, value: string, followUp = false): LoopState {
  return recordRows(recordWrite(state, spec.key, { valueMac: mac(value), followUp }), [rowOf(spec)]);
}

/** The value hashes of a scan, by label. */
function macsOf(values: Record<string, string>, fields: LoopField[]): Map<BaseKey, ValueMac> {
  return new Map(fields.filter((spec) => spec.label in values).map((spec) => [spec.baseKey, mac(values[spec.label]!)]));
}

const types = (events: readonly LoopEvent[]) => events.map((event) => event.type);

describe('pending fields', () => {
  const name = field('Full name', 'text');
  const email = field('Email', 'text');
  const city = field('City', 'text');

  it('are every field of the first scan, in DOM order, whatever order the scan lists them in', () => {
    const [a, b, c] = inOrder(name, email, city);
    const seen = observeScan(createLoop(), [c!, a!, b!]);
    expect(seen.pending).toEqual([a!.key, b!.key, c!.key]);
    expect(seen.verdict.done).toBe(false);
    expect(seen.state.pass).toBe(0);
    // Every field is new at the first scan: no appearance is reported, and none has a parent.
    expect(seen.events).toEqual([]);
    expect([...seen.state.fields.values()].every((tracked) => tracked.revealedBy === null)).toBe(true);
  });

  it('leave out every field that has its row: a settled field is never planned again', () => {
    const fields = inOrder(name, email, city);
    let state = settled(fields);
    state = recordWrite(state, fields[0]!.key, { valueMac: mac('Alex') });
    const again = observeScan(state, fields, { valueMacs: macsOf({ 'Full name': 'Alex' }, fields) });
    expect(again.pending).toEqual([]);
    expect(again.verdict).toEqual({ done: true, end: 'nothing-pending', unresolved: [] });
  });

  it('hold a field whose row has not been recorded yet', () => {
    const fields = inOrder(name, email);
    const first = observeScan(createLoop(), fields).state;
    const partly = recordRows(first, [rowOf(fields[0]!)]);
    expect(observeScan(partly, fields).pending).toEqual([fields[1]!.key]);
  });

  it('plan once more, and only once, a write the page moved out from under us', () => {
    const fields = inOrder(name, email);
    let state = settled(fields, { 'Full name': unwrittenRow(fields[0]!, 'element-not-found') });
    let seen = observeScan(state, fields);
    expect(seen.pending).toEqual([fields[0]!.key]);
    expect(seen.state.fields.get(fields[0]!.baseKey)).toMatchObject({ cause: 'retry', retries: 1 });
    // The page did not change and nothing was written, yet the retry is something new to plan: no stall.
    expect(seen.verdict.done).toBe(false);
    state = recordRows(seen.state, [unwrittenRow(fields[0]!, 'element-not-found')]);
    seen = observeScan(state, fields);
    expect(seen.pending).toEqual([]);
  });

  it('plan once more a choice the frame refused because its options moved under the same hash', () => {
    const country = field('Country', 'select', { options: ['Canada', 'United States'] });
    const state = settled([country], { Country: unwrittenRow(country, 'options-changed') });
    expect(observeScan(state, [country]).pending).toEqual([country.key]);
  });

  it('ignore a row under a key the field no longer has', () => {
    const state = observeScan(createLoop(), [name]).state;
    const stale = rowOf({ ...name, key: 'lever|main|full-name|deadbeefdeadbeef|0' as typeof name.key });
    expect(recordRows(state, [stale]).fields.get(name.baseKey)?.status).toBe('pending');
  });

  it('never read what a field holds: no value of the scan reaches the books or the events', () => {
    const fields = inOrder(name, email);
    const seen = observeScan(createLoop(), fields.map((spec) => fullSpec(spec, 'SECRET-VALUE-4417')));
    const books = JSON.stringify({ fields: [...seen.state.fields.values()], events: seen.events });
    expect(books).not.toContain('SECRET-VALUE-4417');
  });
});

describe('disappearances', () => {
  const referral = field('Do you have a referral?', 'radio', { options: ['Yes', 'No'] });
  const referrer = field("Referrer's name", 'text');

  it('drop a planned field the scan no longer finds, and report it', () => {
    const fields = inOrder(referral, referrer);
    const state = settled(fields);
    const seen = observeScan(state, [fields[0]!]);
    expect(seen.events).toEqual([{ type: 'field-disappeared', key: fields[1]!.key, baseKey: fields[1]!.baseKey,
      wrote: false }]);
    expect(seen.state.fields.get(fields[1]!.baseKey)).toMatchObject({ status: 'disappeared', present: false,
      reason: 'field-disappeared' });
    expect(seen.pending).toEqual([]);
  });

  it('say when the field that went was one we wrote, so its recorded write is dropped', () => {
    const fields = inOrder(referrer, referral);
    const state = written(settled(fields), fields[0]!, 'Sam Lee');
    const seen = observeScan(state, [fields[1]!]);
    expect(seen.events).toEqual([{ type: 'field-disappeared', key: fields[0]!.key, baseKey: fields[0]!.baseKey,
      wrote: true }]);
    expect(seen.state.fields.get(fields[0]!.baseKey)).toMatchObject({ wrote: false, valueMac: null });
  });

  it('drop silently a field that went before it was planned', () => {
    const fields = inOrder(referral, referrer);
    const first = observeScan(createLoop(), fields).state;
    const seen = observeScan(recordRows(first, [rowOf(fields[0]!)]), [fields[0]!]);
    expect(seen.events).toEqual([]);
  });

  it('plan a field again when it comes back, as a first write', () => {
    const fields = inOrder(referral, referrer);
    let state = written(settled(fields), fields[1]!, 'Sam Lee');
    state = observeScan(state, [fields[0]!]).state;
    const back = observeScan(state, fields);
    expect(back.pending).toEqual([fields[1]!.key]);
    expect(back.events).toEqual([{ type: 'field-appeared', key: fields[1]!.key, baseKey: fields[1]!.baseKey,
      revealedBy: null, certain: false, again: true }]);
    // Its next write is a first one: no flip.
    const rewritten = recordWrite(back.state, fields[1]!.key, { valueMac: mac('Sam Lee') });
    expect(rewritten.fields.get(fields[1]!.baseKey)?.flips).toBe(0);
  });

  it(`stop a field that comes back more than ${MAX_REAPPEARANCES} times`, () => {
    const fields = inOrder(referral, referrer);
    let state = settled(fields);
    const comebacks: string[] = [];
    for (let round = 0; round <= MAX_REAPPEARANCES; round += 1) {
      state = observeScan(state, [fields[0]!]).state;
      const back = observeScan(state, fields);
      comebacks.push(...types(back.events));
      state = recordRows(back.state, [unwrittenRow(fields[1]!, 'no-profile-value')]);
    }
    expect(comebacks).toEqual([...Array<string>(MAX_REAPPEARANCES).fill('field-appeared'), 'reveal-cycle']);
    expect(state.fields.get(fields[1]!.baseKey)).toMatchObject({ status: 'oscillating', reason: 'reveal-cycle' });
    // A stopped field that goes again stays stopped, and is never planned again.
    state = observeScan(state, [fields[0]!]).state;
    const after = observeScan(state, fields);
    expect(after.pending).toEqual([]);
    expect(after.state.fields.get(fields[1]!.baseKey)?.status).toBe('oscillating');
  });
});

describe('options that change', () => {
  const country = field('Country', 'select', { options: ['Canada', 'United States'], domOrder: 0 });
  const state = field('State or province', 'select', { options: ['Ontario', 'Quebec'], domOrder: 1 });
  const usStates = withOptions(state, ['California', 'Texas']);

  it('keep the field and match it again: not gone, not new', () => {
    let books = settled([country, state], { 'State or province': unwrittenRow(state, 'no-match') });
    books = written(books, country, 'United States');
    const seen = observeScan(books, [country, usStates]);
    expect(seen.events).toEqual([{ type: 'options-changed', baseKey: state.baseKey, from: state.key,
      to: usStates.key }]);
    expect(seen.pending).toEqual([usStates.key]);
    expect(seen.state.fields.get(state.baseKey)).toMatchObject({ key: usStates.key, status: 'pending',
      cause: 'options-changed', optionChanges: 1 });
    // The edge records the dependency, for ordering later passes.
    expect(seen.state.edges).toEqual([{ parent: country.baseKey, child: state.baseKey, certain: true,
      kind: 'options' }]);
  });

  it('drop the old match: a row under the old key no longer resolves the field', () => {
    let books = settled([country, state]);
    books = written(books, country, 'United States');
    const seen = observeScan(books, [country, usStates]);
    const late = recordRows(seen.state, [rowOf(state)]);
    expect(late.fields.get(state.baseKey)?.status).toBe('pending');
    expect(recordRows(seen.state, [rowOf(usStates)]).fields.get(state.baseKey)?.status).toBe('resolved');
  });

  it('count no flip for a value lost with the old options, and make the next write a first one', () => {
    let books = settled([country, state]);
    books = written(books, state, 'Ontario');
    const seen = observeScan(books, [country, usStates], { valueMacs: new Map([[state.baseKey, mac('')]]) });
    expect(seen.state.fields.get(state.baseKey)).toMatchObject({ flips: 0, wrote: false, valueMac: null });
    const rewrite = recordWrite(seen.state, usStates.key, { valueMac: mac('Texas') });
    expect(rewrite.fields.get(state.baseKey)?.flips).toBe(0);
  });

  it(`stop a list whose options change more than ${MAX_OPTION_CHANGES} times`, () => {
    let books = settled([state]);
    const lists = [['A1', 'A2'], ['B1', 'B2'], ['C1', 'C2'], ['D1', 'D2']];
    const seen: string[] = [];
    for (const list of lists) {
      const next = observeScan(books, [withOptions(state, list)]);
      seen.push(...types(next.events));
      books = recordRows(next.state, [rowOf(withOptions(state, list))]);
    }
    expect(seen).toEqual(['options-changed', 'options-changed', 'options-changed', 'oscillating']);
    expect(books.fields.get(state.baseKey)).toMatchObject({ status: 'oscillating', reason: 'options-oscillated' });
    expect(observeScan(books, [withOptions(state, ['E1'])]).pending).toEqual([]);
  });
});

describe('lists waiting for their options', () => {
  const country = field('Country', 'select', { options: ['United States'], domOrder: 0 });
  const empty = field('State', 'select', { options: [], domOrder: 1 });
  const loaded = withOptions(empty, ['California', 'Texas']);

  function waitingBooks(): LoopState {
    return written(settled([country, empty], { State: unwrittenRow(empty, 'waiting-for-options') }), country,
      'United States');
  }

  it('wait unplanned, keeping the loop going, and are planned once their options arrive', () => {
    const books = waitingBooks();
    expect(books.fields.get(empty.baseKey)?.status).toBe('waiting-options');
    const still = observeScan(books, [country, empty]);
    expect(still.pending).toEqual([]);
    expect(still.waiting).toEqual([empty.key]);
    expect(still.verdict.done).toBe(false);
    const arrived = observeScan(still.state, [country, loaded]);
    expect(arrived.pending).toEqual([loaded.key]);
    expect(types(arrived.events)).toEqual(['options-changed']);
  });

  it(`are options-never-loaded after ${OPTION_WAIT_PASSES} scans without them`, () => {
    let books = waitingBooks();
    const events: string[] = [];
    for (let scan = 0; scan < OPTION_WAIT_PASSES; scan += 1) {
      const next = observeScan(books, [country, empty], { valueMacs: new Map([[country.baseKey, mac('United States')]]) });
      events.push(...types(next.events));
      books = next.state;
      if (next.verdict.done) {
        expect(next.verdict).toMatchObject({ end: 'nothing-pending', unresolved: [{ key: empty.key,
          reason: 'options-never-loaded' }] });
      }
    }
    expect(events).toEqual(['options-never-loaded']);
    expect(books.fields.get(empty.baseKey)).toMatchObject({ status: 'unresolvable', reason: 'options-never-loaded' });
  });

  it("are options-never-loaded at once when the DOM's wait says so, and recover if the options come later", () => {
    let books = recordOptionsWait(waitingBooks(), empty.key, 'never-loaded');
    expect(books.fields.get(empty.baseKey)).toMatchObject({ status: 'unresolvable', reason: 'options-never-loaded' });
    const ended = observeScan(books, [country, empty]);
    expect(ended.verdict).toEqual({ done: true, end: 'nothing-pending', unresolved: [{ key: empty.key,
      baseKey: empty.baseKey, reason: 'options-never-loaded' }] });
    books = ended.state;
    expect(observeScan(books, [country, loaded]).pending).toEqual([loaded.key]);
  });

  it('take no other answer of the wait, and no wait for a list that is not waiting', () => {
    const books = waitingBooks();
    expect(recordOptionsWait(books, empty.key, 'ready')).toBe(books);
    expect(recordOptionsWait(books, empty.key, 'aborted')).toBe(books);
    expect(recordOptionsWait(books, country.key, 'never-loaded')).toBe(books);
  });
});

describe('reveal edges', () => {
  const auth = field('Are you legally authorized to work in the US?', 'radio', { options: ['Yes', 'No'] });
  const name = field('Full name', 'text');
  const sponsor = field('Will you require sponsorship?', 'select', { options: ['Yes', 'No'] });
  const visa = field('Visa type', 'select', { options: ['H-1B', 'Other'] });

  it('name the one writer of the last pass as a certain parent', () => {
    let books = settled(inOrder(auth));
    books = written(books, auth, 'No');
    const seen = observeScan(books, inOrder(auth, sponsor, visa));
    expect(seen.events).toEqual([
      { type: 'field-appeared', key: sponsor.key, baseKey: sponsor.baseKey, revealedBy: auth.baseKey, certain: true,
        again: false },
      { type: 'field-appeared', key: visa.key, baseKey: visa.baseKey, revealedBy: auth.baseKey, certain: true,
        again: false }]);
    expect(revealEdgesOf(seen.state)).toEqual([[auth.baseKey, sponsor.baseKey], [auth.baseKey, visa.baseKey]]);
    expect(childrenOf(seen.state, auth.baseKey)).toEqual([sponsor.baseKey, visa.baseKey]);
  });

  it('guess the nearest writer before the new field when several wrote, and say it is a guess', () => {
    const fields = inOrder(name, auth);
    let books = settled(fields);
    books = written(books, fields[0]!, 'Alex Rivera');
    books = written(books, fields[1]!, 'No');
    const scan = inOrder(name, auth, sponsor);
    const seen = observeScan(books, scan);
    expect(seen.state.fields.get(sponsor.baseKey)).toMatchObject({ revealedBy: auth.baseKey, revealCertain: false });
    // A field above every writer goes to the nearest writer after it.
    const above = field('Preferred name', 'text');
    const top = observeScan(books, inOrder(above, name, auth));
    expect(top.state.fields.get(above.baseKey)?.revealedBy).toBe(name.baseKey);
  });

  it("take the DOM layer's attribution as certain", () => {
    const fields = inOrder(name, auth);
    let books = written(written(settled(fields), fields[0]!, 'Alex'), fields[1]!, 'No');
    books = observeScan(books, inOrder(name, auth, sponsor),
      { attribution: new Map([[sponsor.baseKey, name.baseKey]]) }).state;
    expect(books.fields.get(sponsor.baseKey)).toMatchObject({ revealedBy: name.baseKey, revealCertain: true });
  });

  it('give no parent to a field that appeared after a pass with no write', () => {
    const books = settled(inOrder(name));
    const seen = observeScan(books, inOrder(name, sponsor));
    expect(seen.state.fields.get(sponsor.baseKey)?.revealedBy).toBeNull();
    expect(seen.state.edges).toEqual([]);
  });

  it('order a pass parents first, then by DOM order, from this run and earlier runs', () => {
    const state = field('State', 'select', { options: ['Texas'] });
    const country = field('Country', 'select', { options: ['United States'] });
    // An earlier run learned that the country changes the state list; here the state comes first on the page.
    const fields = inOrder(state, name, country);
    const books = observeScan(createLoop({ revealEdges: [[country.baseKey, state.baseKey]] }), fields).state;
    expect(orderPending(books, fields.map((spec) => spec.key))).toEqual([name.key, country.key, state.key]);
    // A cycle among them is broken at its first field in DOM order.
    const cyclic = observeScan(createLoop({ revealEdges: [[country.baseKey, state.baseKey],
      [state.baseKey, country.baseKey]] }), fields).state;
    expect(orderPending(cyclic, fields.map((spec) => spec.key))).toEqual([name.key, state.key, country.key]);
  });

  it(`keep this run's edges first, then earlier runs' not found again, at most ${MAX_REVEAL_EDGES}`, () => {
    const prior = Array.from({ length: MAX_REVEAL_EDGES + 5 },
      (_, index) => [`p|${index}` as BaseKey, `c|${index}` as BaseKey] as const);
    const start = createLoop({ revealEdges: [[auth.baseKey, sponsor.baseKey], ...prior] });
    expect(start.priorEdges).toHaveLength(MAX_REVEAL_EDGES);
    let books = recordRows(observeScan(start, inOrder(auth)).state, [unwrittenRow(auth, 'no-profile-value')]);
    books = written(books, auth, 'No');
    const seen = observeScan(books, inOrder(auth, sponsor, visa)).state;
    const edges = revealEdgesOf(seen);
    expect(edges.slice(0, 3)).toEqual([[auth.baseKey, sponsor.baseKey], [auth.baseKey, visa.baseKey],
      ['p|0', 'c|0']]);
    expect(edges).toHaveLength(MAX_REVEAL_EDGES);
  });

  it('stop the fields on a cycle of certain edges, and never on a guessed one', () => {
    const fields = inOrder(auth, sponsor);
    let books = settled([fields[0]!]);
    books = written(books, fields[0]!, 'No');
    books = observeScan(books, fields).state;                 // auth reveals sponsor (certain)
    books = written(books, fields[1]!, 'Yes');
    books = observeScan(books, [fields[1]!]).state;          // sponsor's answer hides auth...
    books = written(books, fields[1]!, 'Yes');
    const seen = observeScan(books, fields);                  // ...and brings it back: sponsor reveals auth
    expect(seen.events).toContainEqual({ type: 'reveal-cycle', keys: [auth.baseKey, sponsor.baseKey] });
    expect(seen.pending).toEqual([]);
    expect(seen.state.fields.get(auth.baseKey)).toMatchObject({ status: 'oscillating', reason: 'reveal-cycle' });

    // The same shape with two writers each time is only guessed, and stops nothing.
    let guessed = settled(inOrder(name, auth));
    guessed = written(written(guessed, name, 'Alex'), auth, 'No');
    guessed = observeScan(guessed, inOrder(name, auth, sponsor)).state;
    guessed = written(written(guessed, name, 'Alex'), sponsor, 'Yes');
    guessed = observeScan(guessed, inOrder(name, sponsor)).state;
    guessed = written(written(guessed, name, 'Alex'), sponsor, 'Yes');
    const free = observeScan(guessed, inOrder(name, sponsor, auth));
    expect(free.state.edges.filter((edge) => !edge.certain).map((edge) => [edge.parent, edge.child]))
      .toEqual([[auth.baseKey, sponsor.baseKey], [sponsor.baseKey, auth.baseKey]]);
    expect(types(free.events)).not.toContain('reveal-cycle');
    expect(free.pending).toEqual([auth.key]);
  });
});

describe('value flips', () => {
  const preferred = field('Preferred name', 'text');
  const scanWith = (books: LoopState, value: string) =>
    observeScan(books, [preferred], { valueMacs: new Map([[preferred.baseKey, mac(value)]]) });

  it('count a reset after our write as one flip, and plan the field again', () => {
    const books = written(settled([preferred]), preferred, 'Alex');
    const seen = scanWith(books, '');
    expect(seen.events).toEqual([{ type: 'value-changed', key: preferred.key, baseKey: preferred.baseKey, flips: 1 }]);
    expect(seen.pending).toEqual([preferred.key]);
  });

  it(`stop and flag a field the page resets after every write: two writes, then more than ${MAX_VALUE_FLIPS} flips`, () => {
    let books = settled([preferred]);
    let writes = 0;
    const log: string[] = [];
    for (let pass = 0; pass < 6; pass += 1) {
      if (pass > 0) {
        const seen = scanWith(books, '');                      // the page cleared it again
        log.push(...types(seen.events));
        books = seen.state;
        if (!seen.pending.includes(preferred.key)) break;
      }
      books = written(books, preferred, 'Alex');
      writes += 1;
    }
    expect(writes).toBe(2);
    expect(log).toEqual(['value-changed', 'oscillating']);
    expect(books.fields.get(preferred.baseKey)).toMatchObject({ status: 'oscillating', reason: 'value-oscillated',
      flips: 3 });
    // Never touched again, whatever the page does next.
    expect(scanWith(books, 'Alex').pending).toEqual([]);
    expect(loopVerdict(scanWith(books, 'x').state)).toMatchObject({ done: true, unresolved: [{ key: preferred.key,
      reason: 'value-oscillated' }] });
  });

  it('accept a page that changes our value once and keeps it: one flip, and our row stays', () => {
    let books = written(settled([preferred]), preferred, '5125550147');
    const seen = scanWith(books, '(512) 555-0147');
    expect(seen.pending).toEqual([preferred.key]);
    // Planned again, the value is found in place: the row of the write that put it there stays.
    books = recordRows(seen.state, [rowOf(preferred, { status: 'skipped', reason: 'already-correct', wrote: false,
      provenance: null, verification: 'not-applicable' })]);
    expect(books.fields.get(preferred.baseKey)?.row).toMatchObject({ status: 'verified', wrote: true });
    const calm = scanWith(books, '(512) 555-0147');
    expect(calm.pending).toEqual([]);
    expect(calm.state.fields.get(preferred.baseKey)?.flips).toBe(1);
  });

  it('ignore a change to a value we never wrote', () => {
    const books = settled([preferred]);
    const first = scanWith(books, 'typed by the person');
    expect(scanWith(first.state, 'typed again').pending).toEqual([]);
  });

  it('count our own rewrite that changes the value as a flip', () => {
    let books = written(settled([preferred]), preferred, 'Alex');
    books = scanWith(books, 'Al').state;
    expect(recordWrite(books, preferred.key, { valueMac: mac('Alex') }).fields.get(preferred.baseKey)?.flips).toBe(2);
  });
});

describe('follow-ups', () => {
  const source = field('How did you hear about us?', 'select', { options: ['LinkedIn', 'Other'] });
  const specify = field('Please specify', 'text');
  const notes = field('Anything else?', 'textarea');
  const phone = field('Phone', 'text');

  it('name the box an Other choice revealed, for its free text', () => {
    let books = settled([source]);
    books = written(books, source, 'Other', true);
    const seen = observeScan(books, inOrder(source, specify));
    expect(seen.events).toContainEqual({ type: 'follow-up-found', parent: source.key, child: specify.key,
      certain: true });
    // The box is still planned: the planner gives it its row.
    expect(seen.pending).toEqual([specify.key]);
  });

  it('prefer the box that asks to specify, else the only box, else none', () => {
    const found = (boxes: LoopField[]) => {
      const books = written(settled([source]), source, 'Other', true);
      return observeScan(books, inOrder(source, ...boxes)).events.filter((event) => event.type === 'follow-up-found');
    };
    expect(found([notes, specify])).toEqual([{ type: 'follow-up-found', parent: source.key, child: specify.key,
      certain: true }]);
    expect(found([phone])).toEqual([{ type: 'follow-up-found', parent: source.key, child: phone.key, certain: true }]);
    expect(found([phone, notes])).toEqual([]);
    expect(found([specify, field('If other, please describe', 'text')])).toEqual([]);
  });

  it('name nothing for a choice written without free text, or at a later scan', () => {
    const plain = written(settled([source]), source, 'LinkedIn');
    expect(types(observeScan(plain, inOrder(source, specify)).events)).not.toContain('follow-up-found');
    let books = written(settled([source]), source, 'Other', true);
    books = observeScan(books, [source]).state;
    expect(types(observeScan(books, inOrder(source, specify)).events)).not.toContain('follow-up-found');
  });

  it('name a box only on a certain edge when several Other choices wrote in one pass', () => {
    const referral = field('Referral source', 'select', { options: ['Friend', 'Other'] });
    const fields = inOrder(source, referral);
    let books = settled(fields);
    books = written(written(books, fields[0]!, 'Other', true), fields[1]!, 'Other', true);
    const scan = inOrder(source, specify, referral);
    expect(types(observeScan(books, scan).events)).not.toContain('follow-up-found');
    const attributed = observeScan(books, scan, { attribution: new Map([[specify.baseKey, source.baseKey]]) });
    expect(attributed.events).toContainEqual({ type: 'follow-up-found', parent: fields[0]!.key, child: specify.key,
      certain: true });
  });

  it.each([
    ['Please specify', true], ['If other, please specify', true], ['Other (please specify)', true],
    ['If Other, please describe', true], ['Other', true], ['Please explain', true], ['Please self-describe', true],
    ['Phone', false], ['Visa type', false], ['Anything else?', false], ['Another name', false],
  ])('reads %j as a follow-up box: %s', (label, expected) => {
    expect(isFollowUpLabel(label)).toBe(expected);
  });
});

describe('the end of the loop', () => {
  const name = field('Full name', 'text');

  it('comes when nothing is pending, waiting or awaited', () => {
    const books = settled([name]);
    expect(observeScan(books, [name]).verdict).toEqual({ done: true, end: 'nothing-pending', unresolved: [] });
  });

  it(`comes at the scan after ${MAX_PASSES} planned passes, with what is left`, () => {
    // A page that reveals one more question after every write.
    let books = createLoop();
    let scan: LoopField[] = [field('Question 0', 'text')];
    let planned = 0;
    let verdict: ReturnType<typeof loopVerdict>;
    for (;;) {
      const seen = observeScan(books, scan);
      books = seen.state;
      verdict = seen.verdict;
      if (verdict.done) break;
      planned += 1;
      for (const key of seen.pending) {
        const spec = scan.find((candidate) => candidate.key === key)!;
        books = written(books, spec, 'answer');
      }
      scan = inOrder(...scan, field(`Question ${scan.length}`, 'text'));
    }
    expect(planned).toBe(MAX_PASSES);
    expect(books.pass).toBe(MAX_PASSES);
    expect(verdict).toEqual({ done: true, end: 'max-passes', unresolved: [{ key: scan.at(-1)!.key,
      baseKey: scan.at(-1)!.baseKey, reason: 'max-passes-reached' }] });
  });

  it('comes when the same scan repeats with no write between and nothing new to plan', () => {
    const email = field('Email', 'text');
    const fields = inOrder(name, email);
    const first = observeScan(createLoop(), fields).state;
    // The pass wrote nothing, and no row came back for the email.
    const books = recordRows(first, [unwrittenRow(fields[0]!, 'no-profile-value')]);
    const stalled = observeScan(books, fields);
    expect(stalled.verdict).toEqual({ done: true, end: 'stalled', unresolved: [{ key: email.key,
      baseKey: email.baseKey, reason: 'internal-error' }] });
    // A page that changed is no stall, even with nothing new to plan.
    expect(observeScan(books, [fields[1]!]).state.stalled).toBe(false);
  });

  it('does not come after a write, or when a value we wrote changed', () => {
    let books = settled([name]);
    books = recordWrite(books, name.key, { valueMac: mac('Alex') });
    const afterWrite = observeScan(books, [name], { valueMacs: new Map([[name.baseKey, mac('Alex')]]) });
    expect(afterWrite.state.stalled).toBe(false);
    const changed = observeScan(afterWrite.state, [name], { valueMacs: new Map([[name.baseKey, mac('')]]) });
    expect(changed.state.stalled).toBe(false);
    expect(changed.verdict.done).toBe(false);
  });

  it('can be cut short: what is pending or waiting takes the cut reason, what was decided keeps its own', () => {
    const list = field('State', 'select', { options: [] });
    const other = field('Province', 'select', { options: [] });
    const first = observeScan(createLoop(), inOrder(name, list, other)).state;
    let books = recordRows(first, [unwrittenRow(list, 'waiting-for-options'), unwrittenRow(other, 'waiting-for-options')]);
    books = recordOptionsWait(books, other.key, 'never-loaded');
    expect(loopVerdict(books, { cut: 'page-busy' })).toEqual({ done: true, end: 'cut', unresolved: [
      { key: name.key, baseKey: name.baseKey, reason: 'page-busy' },
      { key: list.key, baseKey: list.baseKey, reason: 'page-busy' },
      { key: other.key, baseKey: other.baseKey, reason: 'options-never-loaded' }] });
    expect(loopVerdict(books, { cut: 'user-stopped' }).unresolved.map((left) => left.reason))
      .toEqual(['user-stopped', 'user-stopped', 'options-never-loaded']);
  });

  it('waits for fields the LLM is asked about, and never calls that stalled', () => {
    const school = field('School', 'select', { options: ['University of Texas at Austin'] });
    const first = observeScan(createLoop(), [school]).state;
    const books = recordRows(first, [unwrittenRow(school, 'llm-pick-needs-review')], { awaiting: [school.key] });
    expect(books.fields.get(school.baseKey)?.status).toBe('awaiting-llm');
    const once = observeScan(books, [school]);
    const twice = observeScan(once.state, [school]);
    expect([once.verdict.done, twice.verdict.done, twice.state.stalled]).toEqual([false, false, true]);
  });
});

describe('keys', () => {
  it('finds the base key inside a field key, whatever the section and slug', () => {
    for (const spec of [field('Email', 'text'), field('Degree', 'select', { options: ['BS'], section: { id: 'education',
      block: 2 }, ordinal: 3 }), field('x'.repeat(80), 'text')]) {
      expect(baseKeyOf(spec.key)).toBe(spec.baseKey);
    }
  });
});
