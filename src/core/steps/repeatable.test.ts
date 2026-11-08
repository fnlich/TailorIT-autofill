import { describe, expect, it } from 'vitest';
import type { CurrentValue } from '../types/field';
import type { RepeatableCounter } from '../types/run';
import {
  assignEntries, blockPrint, companyKey, educationPrint, experiencePrint, isBlockEmpty, languagePrint, planAdd,
  planCurrentJob, planRepeatable, yearOf, type BlockField, type CurrentJobInput, type RepeatableBlock,
} from './repeatable';

const text = (value: string): CurrentValue => ({ kind: 'text', text: value });
const EMPTY: CurrentValue = { kind: 'empty' };

const initech = experiencePrint({ company: 'Initech', startDate: { y: 2021, m: 3 } });
const initechEarlier = experiencePrint({ company: 'Initech, Inc.', startDate: { y: 2017 } });
const globex = experiencePrint({ company: 'Globex Corporation', startDate: { y: 2015, m: 9 } });

/** A rendered experience block holding these values (none: an empty block). */
function experienceBlock(index: number, company?: string, start?: string): RepeatableBlock {
  const fields: BlockField[] = [
    { category: 'experience.company', current: company === undefined ? EMPTY : text(company) },
    { category: 'experience.title', current: EMPTY },
    { category: 'experience.startDate', current: start === undefined ? EMPTY : text(start) },
  ];
  return { index, print: blockPrint('experience', fields), empty: isBlockEmpty(fields) };
}

describe('fingerprints', () => {
  it('a company is known by its name without "The" or its legal form', () => {
    expect(companyKey('Initech, Inc.')).toBe('initech');
    expect(companyKey('The Home Depot LLC')).toBe('home depot');
    expect(companyKey('Globex Corp.')).toBe(companyKey('GLOBEX corporation'));
    // A name that is only a legal form keeps its last word.
    expect(companyKey('The Company')).toBe('company');
    expect(companyKey('  ')).toBe('');
  });

  it('a start date names its year in any of the usual spellings, and only one', () => {
    for (const spelling of ['03/2021', '2021-03', 'Mar 2021', 'March 2021', '2021']) expect(yearOf(spelling)).toBe(2021);
    expect(yearOf('2019 - 2021')).toBeNull();
    expect(yearOf('soon')).toBeNull();
  });

  it('a prefilled block names the entry it holds; an empty one names none', () => {
    const prefilled = experienceBlock(0, 'Initech Inc', '03/2021');
    expect(prefilled.print).toEqual({ id: initech.ids[0], detail: '2021' });
    expect(prefilled.empty).toBe(false);
    expect(experienceBlock(1)).toEqual({ index: 1, print: null, empty: true });
  });

  it('a school is known by every name it has, and a degree level tells two degrees there apart', () => {
    const entry = educationPrint({ institution: { canonicalName: 'The University of Texas at Austin',
      userText: 'UT Austin', aliases: ['UT-Austin'] }, degree: { level: 'bachelor' } });
    const block = blockPrint('education', [{ category: 'education.school', current: text('UT Austin') }],
      { degreeLevel: 'bachelor' });
    expect(entry.ids).toContain(block!.id);
    expect(block!.detail).toBe('bachelor');
    const chosen = blockPrint('education', [{ category: 'education.school',
      current: { kind: 'selected', labels: ['The University of Texas at Austin'] } }]);
    expect(entry.ids).toContain(chosen!.id);
  });

  it('a language is known by its name', () => {
    expect(languagePrint({ name: 'Spanish' }).ids)
      .toEqual([blockPrint('language', [{ category: 'languages.language', current: text('spanish') }])!.id]);
  });

  it('holds no text: hashes only', () => {
    expect(initech.ids[0]).toMatch(/^[a-f0-9]{16}$/);
    expect(JSON.stringify([initech, experienceBlock(0, 'Initech', '2021')])).not.toContain('nitech');
  });

  it('an entry or a block with no name has no fingerprint', () => {
    expect(experiencePrint({ company: '' }).ids).toEqual([]);
    expect(blockPrint('experience', [{ category: 'experience.startDate', current: text('2020') }])).toBeNull();
  });

  it('a block is empty when nothing is typed, ticked or uploaded; a list showing its first option is not something', () => {
    expect(isBlockEmpty([{ current: EMPTY }, { current: text('  ') }, { current: { kind: 'checked', checked: false } },
      { current: { kind: 'selected', labels: ['Select...'] } }, { current: { kind: 'files', count: 0 } }])).toBe(true);
    expect(isBlockEmpty([{ current: { kind: 'checked', checked: true } }])).toBe(false);
    expect(isBlockEmpty([{ current: { kind: 'files', count: 1 } }])).toBe(false);
  });
});

describe('assignEntries', () => {
  it('fills blocks in order when none is prefilled, and counts the blocks still missing', () => {
    expect(assignEntries([initech, globex], [experienceBlock(0)])).toEqual({
      assignments: [{ entry: 0, block: 0, by: 'order', prefilled: false },
        { entry: 1, block: null, by: null, prefilled: false }],
      missing: 1, extra: [],
    });
  });

  it('reuses a block the site prefilled with an entry, wherever it is, so nothing is added twice', () => {
    // The resume parse put Globex first; the profile lists Initech first.
    const match = assignEntries([initech, globex], [experienceBlock(0, 'Globex Corp', '09/2015'), experienceBlock(1)]);
    expect(match.assignments).toEqual([{ entry: 0, block: 1, by: 'order', prefilled: false },
      { entry: 1, block: 0, by: 'fingerprint', prefilled: true }]);
    expect(match.missing).toBe(0);
  });

  it('tells two jobs at one company apart by their start year, and takes a block without one by its name', () => {
    const blocks = [experienceBlock(0, 'Initech', '2017'), experienceBlock(1, 'Initech', '2021')];
    expect(assignEntries([initech, initechEarlier], blocks).assignments.map((a) => [a.entry, a.block, a.by]))
      .toEqual([[0, 1, 'fingerprint'], [1, 0, 'fingerprint']]);
    // The parse missed the date: the name alone matches, the strict pass having found nothing better.
    expect(assignEntries([globex], [experienceBlock(0, 'Globex')]).assignments[0])
      .toEqual({ entry: 0, block: 0, by: 'fingerprint', prefilled: true });
  });

  it('gives a block prefilled with another spelling to the next entry, to be reconciled, rather than adding one', () => {
    // "Initrode" may be the parser's reading of the profile's job: its fields are reconciled (profile wins, flagged).
    const match = assignEntries([initech], [experienceBlock(0, 'Initrode', '2021')]);
    expect(match.assignments).toEqual([{ entry: 0, block: 0, by: 'order', prefilled: true }]);
    expect(match.missing).toBe(0);
  });

  it('reports blocks no entry takes, and never asks for any to go', () => {
    const match = assignEntries([initech], [experienceBlock(0, 'Initech', '2021'), experienceBlock(1, 'Globex', '2015'),
      experienceBlock(2)]);
    expect(match.assignments).toEqual([{ entry: 0, block: 0, by: 'fingerprint', prefilled: true }]);
    expect(match.extra).toEqual([1, 2]);
  });

  it('follows the blocks\' page order, whatever order they are listed in', () => {
    const match = assignEntries([initech, globex], [experienceBlock(1), experienceBlock(0)]);
    expect(match.assignments.map((assignment) => assignment.block)).toEqual([0, 1]);
  });
});

describe('planAdd', () => {
  const counter = (rendered: number, addClicks: number, profile = 2): RepeatableCounter => ({ profile, rendered, addClicks });

  it('plans one Add at a time, counted before the click', () => {
    expect(planAdd({ profile: 2, rendered: 0, prior: null, afterClick: false, addButton: true }))
      .toEqual({ add: true, counter: counter(0, 1), stop: null, reason: null });
    // After that click settled and a block appeared: the next one.
    expect(planAdd({ profile: 2, rendered: 1, prior: counter(0, 1), afterClick: true, addButton: true }))
      .toEqual({ add: true, counter: counter(1, 2), stop: null, reason: null });
    expect(planAdd({ profile: 2, rendered: 2, prior: counter(1, 2), afterClick: true, addButton: true }))
      .toEqual({ add: false, counter: counter(2, 2), stop: 'complete', reason: null });
  });

  it('never adds past the profile\'s count: a page that already shows enough blocks gets no click', () => {
    expect(planAdd({ profile: 1, rendered: 3, prior: null, afterClick: false, addButton: true }))
      .toMatchObject({ add: false, stop: 'complete' });
  });

  it('stops when our click added no block: the page ignores untrusted clicks, so the person adds the rest', () => {
    expect(planAdd({ profile: 2, rendered: 0, prior: counter(0, 1), afterClick: true, addButton: true }))
      .toEqual({ add: false, counter: counter(0, 1), stop: 'add-ignored', reason: 'needs-your-click' });
  });

  it('counts clicks across reloads: the clicks on a step never pass the profile\'s count', () => {
    // A reload lost the blocks the first visit added; its two clicks are already counted.
    expect(planAdd({ profile: 2, rendered: 0, prior: counter(2, 2), afterClick: false, addButton: true }))
      .toEqual({ add: false, counter: counter(0, 2), stop: 'add-cap', reason: 'needs-your-click' });
    expect(planAdd({ profile: 2, rendered: 1, prior: counter(2, 1), afterClick: false, addButton: true }))
      .toMatchObject({ add: true, counter: counter(1, 2) });
  });

  it('asks the person when the adapter found no Add button', () => {
    expect(planAdd({ profile: 1, rendered: 0, prior: null, afterClick: false, addButton: false }))
      .toMatchObject({ add: false, stop: 'no-add-button', reason: 'needs-your-click' });
  });

  // s2 wd (snapshot round 2, decision 6): Workday keeps no block it has not saved across a reload.
  it('starts the count again on a new document that shows fewer blocks than were counted, and only then', () => {
    // The page was loaded again and shows none of the two blocks the counted clicks added: the run adds them again.
    expect(planAdd({ profile: 2, rendered: 0, prior: counter(2, 2), afterClick: false, addButton: true,
      newDocument: true })).toEqual({ add: true, counter: counter(0, 1), stop: null, reason: null });
    // The same document, or a new one that shows as many blocks as were counted: the cap stands.
    expect(planAdd({ profile: 2, rendered: 0, prior: counter(2, 2), afterClick: false, addButton: true,
      newDocument: false })).toMatchObject({ add: false, stop: 'add-cap' });
    expect(planAdd({ profile: 3, rendered: 2, prior: counter(2, 3, 3), afterClick: false, addButton: true,
      newDocument: true })).toMatchObject({ add: false, stop: 'add-cap' });
    // After our own click the page's answer decides, as before.
    expect(planAdd({ profile: 2, rendered: 0, prior: counter(0, 1), afterClick: true, addButton: true,
      newDocument: true })).toMatchObject({ add: false, stop: 'add-ignored' });
  });
});

describe('planRepeatable', () => {
  it('assigns what is rendered and plans the next Add for what is not', () => {
    const plan = planRepeatable({ kind: 'experience', entries: [initech, globex],
      blocks: [experienceBlock(0, 'Globex', '2015')], prior: null, afterClick: false, addButton: true });
    expect(plan).toMatchObject({ kind: 'experience', missing: 1, extra: [], add: true,
      counter: { profile: 2, rendered: 1, addClicks: 1 } });
    expect(plan.assignments).toEqual([{ entry: 0, block: null, by: null, prefilled: false },
      { entry: 1, block: 0, by: 'fingerprint', prefilled: true }]);
  });

  it('plans nothing for a profile with no entries, and reports every block', () => {
    expect(planRepeatable({ kind: 'language', entries: [], blocks: [{ index: 0, print: null, empty: true }], prior: null,
      afterClick: false, addButton: true })).toEqual({ kind: 'language', assignments: [], missing: 0, extra: [0],
      add: false, counter: { profile: 0, rendered: 1, addClicks: 0 }, stop: 'complete', reason: null });
  });
});

describe('"I currently work here"', () => {
  const input = (patch: Partial<CurrentJobInput>): CurrentJobInput =>
    ({ current: true, box: 'unchecked', endDate: 'empty', endDateRequired: false, ...patch });

  it('ticks the box first and decides the end date only after the tick has settled', () => {
    expect(planCurrentJob(input({}))).toEqual({ tick: true, box: null, endDate: 'pending' });
    expect(planCurrentJob(input({ endDate: 'absent' }))).toEqual({ tick: true, box: null, endDate: null });
  });

  it('skips an end date the page then disables, without a flag', () => {
    expect(planCurrentJob(input({ box: 'checked', endDate: 'disabled' }))).toEqual({ tick: false,
      box: { status: 'skipped', reason: 'already-correct' }, endDate: { status: 'skipped', reason: 'end-date-not-applicable' } });
  });

  it('never writes a current job\'s end date: left empty, flagged only when the page requires one', () => {
    expect(planCurrentJob(input({ box: 'checked', endDate: 'empty' })).endDate)
      .toEqual({ status: 'skipped', reason: 'end-date-not-applicable' });
    expect(planCurrentJob(input({ box: 'absent', endDate: 'empty', endDateRequired: true })))
      .toEqual({ tick: false, box: null, endDate: { status: 'flagged', reason: 'end-date-not-applicable' } });
    // An end date the site prefilled for a job the profile says is current: kept, and the conflict flagged.
    expect(planCurrentJob(input({ box: 'checked', endDate: 'filled' })).endDate)
      .toEqual({ status: 'flagged', reason: 'prefill-conflict' });
  });

  it('never ticks the box for a past job, and never unticks one the page ticked', () => {
    expect(planCurrentJob(input({ current: false }))).toEqual({ tick: false,
      box: { status: 'skipped', reason: 'already-correct' }, endDate: 'write' });
    expect(planCurrentJob(input({ current: false, box: 'checked', endDate: 'disabled' }))).toEqual({ tick: false,
      box: { status: 'flagged', reason: 'unexpected-selection' }, endDate: { status: 'flagged', reason: 'unexpected-selection' } });
    expect(planCurrentJob(input({ current: false, box: 'absent', endDate: 'filled' })))
      .toEqual({ tick: false, box: null, endDate: 'write' });
    expect(planCurrentJob(input({ current: false, box: 'unchecked', endDate: 'disabled' })).endDate)
      .toEqual({ status: 'skipped', reason: 'disabled-or-readonly' });
  });
});
