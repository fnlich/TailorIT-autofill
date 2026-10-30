/*
 * The whole loop over a scripted conditional-reveal page (Requirement D), driven the way the content script drives it:
 * scan, observeScan, plan the pending fields, write them in orderPending's order (recordWrite after each), settle,
 * verify, recordRows; at the end, loopRows. The page reacts as a real form's scripts do:
 * - authorization "No" reveals the sponsorship and visa questions;
 * - "Other" reveals "Please specify";
 * - choosing the country swaps the state list (and clears it);
 * - the preferred name is cleared by the page after every write;
 * - answering "Do you have a referral?" removes the referrer's name.
 * The planner is a stand-in that answers by label: the loop never sees a value, only the hashes the page's values give.
 */
import { describe, expect, it } from 'vitest';
import type { FieldKind } from '../enums';
import { settleRow } from '../plan/settle';
import type { BaseKey, FieldKey } from '../types/field';
import type { FillResult, ReasonCode } from '../types/fill';
import type { ValueMac } from '../types/loop';
import {
  createLoop, observeScan, orderPending, recordRows, recordWrite, revealEdgesOf, type LoopEvent, type LoopField,
  type LoopState, type LoopVerdict,
} from './bookkeeping';
import { field, inOrder, mac, rowOf, unwrittenRow } from './loop.testkit';
import { loopRows } from './rows';

const AUTH = 'Are you legally authorized to work in the US?';
const SPONSOR = 'Will you require visa sponsorship?';
const VISA = 'Visa type';
const SOURCE = 'How did you hear about us?';
const SPECIFY = 'Please specify';
const COUNTRY = 'Country';
const STATE = 'State or province';
const PREFERRED = 'Preferred name';
const HAS_REFERRAL = 'Do you have a referral?';
const REFERRER = "Referrer's name";

interface PageField {
  label: string;
  kind: FieldKind;
  options?: string[];
  value: string;
}

/** The scripted page: its visible fields in DOM order, and the reactions of its scripts. */
class ScriptedPage {
  fields: PageField[] = [
    { label: AUTH, kind: 'radio', options: ['Yes', 'No'], value: '' },
    { label: SOURCE, kind: 'select', options: ['LinkedIn', 'Indeed', 'Other'], value: '' },
    { label: COUNTRY, kind: 'select', options: ['Canada', 'United States'], value: 'Canada' },
    { label: STATE, kind: 'select', options: ['Ontario', 'Quebec'], value: '' },
    { label: PREFERRED, kind: 'text', value: '' },
    { label: HAS_REFERRAL, kind: 'radio', options: ['Yes', 'No'], value: '' },
    { label: REFERRER, kind: 'text', value: '' },
  ];

  /** What the scanner reports: keys from the labels, kinds and options. */
  scan(): LoopField[] {
    return inOrder(...this.fields.map((item) => field(item.label, item.kind,
      item.options ? { options: item.options } : {})));
  }

  /** The content script's keyed hash of every value. */
  macs(scan: readonly LoopField[]): Map<BaseKey, ValueMac> {
    return new Map(scan.map((spec) => [spec.baseKey, mac(this.find(spec.label)!.value)]));
  }

  find(label: string): PageField | undefined {
    return this.fields.find((item) => item.label === label);
  }

  /** A write, and the page's scripts reacting at once (a change listener). */
  write(label: string, value: string): void {
    this.find(label)!.value = value;
    const after = (anchor: string, ...added: PageField[]) => {
      if (added.every((item) => this.find(item.label))) return;
      const at = this.fields.findIndex((item) => item.label === anchor);
      this.fields.splice(at + 1, 0, ...added);
    };
    if (label === AUTH && value === 'No') {
      after(AUTH, { label: SPONSOR, kind: 'select', options: ['Yes', 'No'], value: '' },
        { label: VISA, kind: 'select', options: ['H-1B', 'F-1 OPT', 'Other'], value: '' });
    }
    if (label === SOURCE && value === 'Other') after(SOURCE, { label: SPECIFY, kind: 'text', value: '' });
    if (label === COUNTRY && value === 'United States') Object.assign(this.find(STATE)!, { options: ['California', 'Texas'], value: '' });
    if (label === HAS_REFERRAL && value === 'No') this.fields = this.fields.filter((item) => item.label !== REFERRER);
  }

  /** What the page does while the loop settles: it clears the preferred name. */
  settle(): void {
    this.find(PREFERRED)!.value = '';
  }
}

/** The stand-in planner's answers, by label: a value to write (with an Other choice's free text), or a reason. */
const ANSWERS: Record<string, { value: string; freeText?: string } | ReasonCode> = {
  [AUTH]: { value: 'No' },
  [SPONSOR]: { value: 'Yes' },
  [VISA]: { value: 'H-1B' },
  [SOURCE]: { value: 'Other', freeText: 'Hacker News' },
  [SPECIFY]: 'free-text-requires-user',
  [COUNTRY]: { value: 'United States' },
  [STATE]: { value: 'Texas' },
  [PREFERRED]: { value: 'Alex' },
  [HAS_REFERRAL]: { value: 'No' },
  [REFERRER]: { value: 'Sam Lee' },
};

interface Pass {
  pending: string[];
  events: LoopEvent[];
  writes: string[];
}

/** Runs the loop over the page, as the content script would. */
function run(page: ScriptedPage): { passes: Pass[]; verdict: LoopVerdict; state: LoopState; written: string[] } {
  let loop = createLoop();
  const passes: Pass[] = [];
  const written: string[] = [];
  const freeText = new Map<FieldKey, string>();
  for (;;) {
    const scan = page.scan();
    const seen = observeScan(loop, scan, { valueMacs: page.macs(scan) });
    loop = seen.state;
    const labelOf = (key: FieldKey) => scan.find((spec) => spec.key === key)?.label ?? key;
    const pass: Pass = { pending: seen.pending.map(labelOf), events: seen.events, writes: [] };
    passes.push(pass);
    if (seen.verdict.done) return { passes, verdict: seen.verdict, state: loop, written };

    // The plan: a write and its row for each pending field the planner can answer, a row for the rest.
    const specs = new Map(scan.map((spec) => [spec.key, spec]));
    const writes = new Map<FieldKey, { value: string; freeText?: string; flag?: ReasonCode }>();
    const rows = new Map<FieldKey, FillResult>();
    for (const key of seen.pending) {
      const spec = specs.get(key)!;
      const answer = ANSWERS[spec.label]!;
      const options = page.find(spec.label)!.options;
      if (typeof answer === 'string') rows.set(key, unwrittenRow(spec, answer));
      else if (options && !options.includes(answer.value)) rows.set(key, unwrittenRow(spec, 'no-match'));
      else writes.set(key, { ...answer, ...(answer.freeText ? { flag: 'other-option-with-free-text' as const } : {}) });
    }
    // The box an Other choice revealed takes its free text (a rule write, flagged like the choice).
    for (const event of seen.events) {
      if (event.type !== 'follow-up-found') continue;
      const text = freeText.get(event.parent);
      if (text !== undefined) writes.set(event.child, { value: text, flag: 'other-option-with-free-text' });
    }

    const done: Array<{ key: FieldKey; value: string; row: FillResult }> = [];
    for (const key of orderPending(loop, [...writes.keys()])) {
      const spec = specs.get(key)!;
      const write = writes.get(key)!;
      if (page.find(spec.label) === undefined) {
        rows.set(key, unwrittenRow(spec, 'element-not-found'));
        continue;
      }
      page.write(spec.label, write.value);
      pass.writes.push(spec.label);
      written.push(spec.label);
      if (write.freeText !== undefined) freeText.set(key, write.freeText);
      loop = recordWrite(loop, key, { valueMac: mac(page.find(spec.label)!.value),
        followUp: write.freeText !== undefined });
      const row = rowOf(spec, write.flag ? { status: 'flagged', reason: write.flag, needsUserAction: true } : {});
      done.push({ key, value: write.value, row });
    }
    page.settle();
    // The verification after the settle: what no longer reads as written did not stick.
    for (const { key, value, row } of done) {
      const now = page.find(specs.get(key)!.label);
      rows.set(key, now === undefined || now.value === value ? row : settleRow(row, { kind: 'mismatch' }));
    }
    loop = recordRows(loop, rows.values());
  }
}

describe('the reactive loop over a scripted conditional reveal', () => {
  const page = new ScriptedPage();
  const result = run(page);
  const { passes, verdict, state } = result;
  const keyOf = (label: string) => field(label, page.find(label)?.kind ?? 'text',
    page.find(label)?.options ? { options: page.find(label)!.options! } : {});

  it('plans two passes and observes a third, then ends with nothing pending', () => {
    expect(passes).toHaveLength(3);
    expect(verdict.end).toBe('nothing-pending');
    expect(passes[0]!.pending).toEqual([AUTH, SOURCE, COUNTRY, STATE, PREFERRED, HAS_REFERRAL, REFERRER]);
    expect(passes[1]!.pending).toEqual([SPONSOR, VISA, SPECIFY, STATE, PREFERRED]);
    expect(passes[2]!.pending).toEqual([]);
  });

  it('writes the revealed questions on the pass after their parent, each naming it', () => {
    expect(passes[0]!.writes).toEqual([AUTH, SOURCE, COUNTRY, PREFERRED, HAS_REFERRAL]);
    expect(passes[1]!.writes).toEqual([SPONSOR, VISA, SPECIFY, STATE, PREFERRED]);
    const appeared = passes[1]!.events.flatMap((event) => event.type === 'field-appeared' ? [event] : []);
    expect(appeared.map((event) => [event.baseKey, event.revealedBy, event.certain])).toEqual([
      [keyOf(SPONSOR).baseKey, keyOf(AUTH).baseKey, false],
      [keyOf(VISA).baseKey, keyOf(AUTH).baseKey, false],
      [keyOf(SPECIFY).baseKey, keyOf(SOURCE).baseKey, false],
    ]);
  });

  it('types the Other choice’s free text into the box it revealed', () => {
    expect(passes[1]!.events).toContainEqual({ type: 'follow-up-found', parent: keyOf(SOURCE).key,
      child: keyOf(SPECIFY).key, certain: false });
    expect(page.find(SPECIFY)!.value).toBe('Hacker News');
  });

  it('matches the state again when the country swaps its list, and writes it from the new list', () => {
    const before = field(STATE, 'select', { options: ['Ontario', 'Quebec'] });
    expect(passes[1]!.events).toContainEqual({ type: 'options-changed', baseKey: before.baseKey, from: before.key,
      to: keyOf(STATE).key });
    expect(page.find(STATE)!.value).toBe('Texas');
  });

  it('stops fighting the field the page resets: two writes, then flagged value-oscillated', () => {
    expect(result.written.filter((label) => label === PREFERRED)).toHaveLength(2);
    expect(passes[1]!.events).toContainEqual({ type: 'value-changed', key: keyOf(PREFERRED).key,
      baseKey: keyOf(PREFERRED).baseKey, flips: 1 });
    expect(passes[2]!.events).toEqual([{ type: 'oscillating', key: keyOf(PREFERRED).key,
      baseKey: keyOf(PREFERRED).baseKey, reason: 'value-oscillated' }]);
    expect(verdict.unresolved).toEqual([{ key: keyOf(PREFERRED).key, baseKey: keyOf(PREFERRED).baseKey,
      reason: 'value-oscillated' }]);
  });

  it('drops the question another removed, and reports it', () => {
    const referrer = field(REFERRER, 'text');
    expect(passes[1]!.events).toContainEqual({ type: 'field-disappeared', key: referrer.key,
      baseKey: referrer.baseKey, wrote: false });
    expect(result.written).not.toContain(REFERRER);
  });

  it('reports every field once, value-free, with the reveal edges kept for later runs', () => {
    const rows = loopRows(state, verdict);
    expect(rows.map((row) => [row.label, row.status, row.reason, row.detail?.revealedBy ?? null])).toEqual([
      [AUTH, 'verified', 'ok', null],
      [SPONSOR, 'verified', 'ok', keyOf(AUTH).baseKey],
      [VISA, 'verified', 'ok', keyOf(AUTH).baseKey],
      [SOURCE, 'flagged', 'other-option-with-free-text', null],
      [SPECIFY, 'flagged', 'other-option-with-free-text', keyOf(SOURCE).baseKey],
      [COUNTRY, 'verified', 'ok', null],
      [STATE, 'verified', 'ok', null],
      [PREFERRED, 'flagged', 'value-oscillated', null],
      [HAS_REFERRAL, 'verified', 'ok', null],
      [REFERRER, 'skipped', 'field-disappeared', null],
    ]);
    expect(rows.find((row) => row.label === STATE)?.key).toBe(keyOf(STATE).key);
    expect(JSON.stringify(rows)).not.toMatch(/Hacker News|Texas|Alex|Sam Lee|H-1B/);
    expect(revealEdgesOf(state)).toEqual([
      [keyOf(AUTH).baseKey, keyOf(SPONSOR).baseKey],
      [keyOf(AUTH).baseKey, keyOf(VISA).baseKey],
      [keyOf(SOURCE).baseKey, keyOf(SPECIFY).baseKey],
      [keyOf(COUNTRY).baseKey, keyOf(STATE).baseKey],
    ]);
  });
});
