import { describe, expect, it } from 'vitest';
import { fieldOf, goldenProfile, planOf, specOf, vocab } from '../plan/plan.testkit';
import type { CurrentValue, FieldSpec } from '../types/field';
import { MAX_REPEATABLE_BLOCKS, planBlocks, planRepeatables } from './blocks';

const profile = goldenProfile();
/** The golden profile's jobs, most recent first: Quillfeather Labs (current, from 2021-06), then Marrowgate Systems
 *  (2019-07 to 2021-05). */
const [CURRENT, EARLIER] = profile.experience as [typeof profile.experience[0], typeof profile.experience[0]];

const text = (value: string): CurrentValue => ({ kind: 'text', text: value });

/** One position block's fields, as the scanner keys them (section experience, the block's index), holding `held`. */
function position(block: number, held: { company?: string; start?: string; title?: string } = {}): FieldSpec[] {
  const section = { id: 'experience', block };
  return [
    specOf('Company', 'text', { section, idAttr: `company-${block}`, current: held.company ? text(held.company) : { kind: 'empty' } }),
    specOf('Job title', 'text', { section, idAttr: `title-${block}`, current: held.title ? text(held.title) : { kind: 'empty' } }),
    specOf('Start date', 'date', { section, idAttr: `start-${block}`, constraints: { format: 'month-year' },
      current: held.start ? text(held.start) : { kind: 'empty' } }),
  ];
}

const companyOf = (specs: readonly FieldSpec[], block: number) =>
  specs.find((spec) => spec.section.block === block && spec.label === 'Company')!;
const titleOf = (specs: readonly FieldSpec[], block: number) =>
  specs.find((spec) => spec.section.block === block && spec.label === 'Job title')!;

describe('planBlocks: which profile entry each block is filled from', () => {
  it('gives empty blocks the entries in the profile\'s order, with the count and the current-job flags', () => {
    const specs = [...position(0), ...position(1)];
    expect(planBlocks({ kind: 'experience', entries: null }, specs, profile, vocab))
      .toEqual({ kind: 'experience', profile: 2, entries: [0, 1], current: [true, false] });
  });

  it('matches a block the site prefilled to the entry it holds, by company and start year, and gives the rest in order',
    () => {
      const specs = [...position(0), ...position(1, { company: `${CURRENT.company} Inc.`, start: '06/2021' })];
      expect(planBlocks({ kind: 'experience', entries: null }, specs, profile, vocab))
        .toEqual({ kind: 'experience', profile: 2, entries: [1, 0], current: [false, true] });
    });

  it('tells two jobs at one company apart by their start years', () => {
    const twice = { ...profile, experience: [CURRENT, { ...EARLIER, company: CURRENT.company }] };
    const specs = [...position(0, { company: CURRENT.company, start: '2019-07' }),
      ...position(1, { company: CURRENT.company, start: '2021-06' })];
    expect(planBlocks({ kind: 'experience', entries: null }, specs, twice, vocab).entries).toEqual([1, 0]);
  });

  it('gives a block no entry takes none, and counts a block the scan does not show as empty', () => {
    const specs = [...position(0), ...position(2)];
    expect(planBlocks({ kind: 'experience', entries: null }, specs, profile, vocab))
      .toEqual({ kind: 'experience', profile: 2, entries: [0, 1, null], current: [true, false, false] });
  });

  it('keeps the frame\'s own assignment, each entry checked against the profile', () => {
    expect(planBlocks({ kind: 'experience', entries: [1, 0, 5, null, 1.5] }, position(0), profile, vocab))
      .toEqual({ kind: 'experience', profile: 2, entries: [1, 0, null, null, null], current: [false, true, false, false, false] });
    const long = Array.from({ length: MAX_REPEATABLE_BLOCKS + 5 }, () => 0);
    expect(planBlocks({ kind: 'experience', entries: long }, [], profile, vocab).entries).toHaveLength(MAX_REPEATABLE_BLOCKS);
  });

  it('matches a prefilled school by any of its names, and a language by its name', () => {
    const school = (block: number, held: string) => specOf('School', 'text', { section: { id: 'education', block },
      idAttr: `school-${block}`, current: held === '' ? { kind: 'empty' } : text(held) });
    expect(planBlocks({ kind: 'education', entries: null }, [school(0, 'Stanford University'),
      school(1, 'University of Texas at Austin')], profile, vocab))
      .toEqual({ kind: 'education', profile: 1, entries: [null, 0], current: [false, false] });
    const language = (block: number, held: string) => specOf('Language', 'text', { section: { id: 'language', block },
      idAttr: `language-${block}`, current: held === '' ? { kind: 'empty' } : text(held) });
    expect(planBlocks({ kind: 'language', entries: null }, [language(0, ''), language(1, 'English')], profile, vocab)
      .entries).toEqual([1, 0]);
  });

  it('finds the entry a saved summary shows by its fingerprint, never by its place (the Phase 7a review)', () => {
    // Workable: the draft restored the earlier job as a summary (block 0, no fields); the run opened an editor (block 1).
    const shown = [{ block: 0, values: [{ category: 'experience.title' as const, text: EARLIER.title },
      { category: 'experience.company' as const, text: EARLIER.company }, { category: 'experience.startDate' as const,
        text: 'July 2019' }] }];
    expect(planBlocks({ kind: 'experience', entries: null, shown }, position(1), profile, vocab))
      .toEqual({ kind: 'experience', profile: 2, entries: [1, 0], current: [false, true] });
    // A summary of a job the profile does not hold is no entry's: never given one by its place.
    const other = [{ block: 0, values: [{ category: 'experience.company' as const, text: 'Brightwater Analytics' }] }];
    expect(planBlocks({ kind: 'experience', entries: null, shown: other }, position(1), profile, vocab))
      .toEqual({ kind: 'experience', profile: 2, entries: [null, 0], current: [false, true] });
  });

  it('answers each kind once, and nothing for an unknown one', () => {
    const answers = planRepeatables([{ kind: 'experience', entries: null }, { kind: 'experience', entries: [1] },
      { kind: 'skills' as 'language', entries: null }, { kind: 'education', entries: null }], position(0), profile, vocab);
    expect(answers.map((answer) => [answer.kind, answer.entries])).toEqual([['experience', [0]], ['education', []]]);
  });

  it('answers counts, indices and flags only: no fingerprint, no value', () => {
    const specs = [...position(0, { company: EARLIER.company, title: EARLIER.title })];
    const answer = JSON.stringify(planBlocks({ kind: 'experience', entries: null }, specs, profile, vocab));
    expect(answer).toBe('{"kind":"experience","profile":2,"entries":[1],"current":[false]}');
  });
});

describe('planFrame with repeatable sections: each block filled from its assigned entry', () => {
  it('fills a block from the entry the site prefilled in it, not the one its place names', () => {
    const specs = [...position(0), ...position(1, { company: CURRENT.company, start: '2021-06' })];
    const plan = planOf(specs, { repeatables: [{ kind: 'experience', entries: null }] });
    expect(plan.repeatables).toEqual([{ kind: 'experience', profile: 2, entries: [1, 0], current: [false, true] }]);
    expect(fieldOf(plan, companyOf(specs, 0)).write?.value)
      .toEqual({ kind: 'text', text: EARLIER.company });
    expect(fieldOf(plan, titleOf(specs, 0)).write?.value).toEqual({ kind: 'text', text: EARLIER.title });
    expect(fieldOf(plan, titleOf(specs, 1)).write?.value).toEqual({ kind: 'text', text: CURRENT.title });
    // The prefilled company already reads as the entry's: nothing is written there, so nothing is duplicated.
    expect(fieldOf(plan, companyOf(specs, 1))).toMatchObject({ write: undefined, row: { status: 'skipped',
      reason: 'already-correct' } });
  });

  it('fills a block no entry takes with nothing', () => {
    const specs = [...position(0), ...position(1), ...position(2)];
    const plan = planOf(specs, { repeatables: [{ kind: 'experience', entries: null }] });
    expect(fieldOf(plan, companyOf(specs, 2))).toMatchObject({ write: undefined, row: { reason: 'no-profile-value' } });
    expect(fieldOf(plan, companyOf(specs, 1)).write?.value).toEqual({ kind: 'text', text: EARLIER.company });
  });

  it('plans with the frame\'s own assignment for a request that carries only some of its fields', () => {
    const specs = position(1);
    const plan = planOf(specs, { repeatables: [{ kind: 'experience', entries: [1, 0] }] });
    expect(fieldOf(plan, companyOf(specs, 1)).write?.value).toEqual({ kind: 'text', text: CURRENT.company });
  });

  it('without sections named, fills each block from the entry its place names and answers no sections', () => {
    const specs = [...position(0), ...position(1, { company: CURRENT.company, start: '2021-06' })];
    const plan = planOf(specs);
    expect(plan.repeatables).toBeUndefined();
    expect(fieldOf(plan, titleOf(specs, 0)).write?.value).toEqual({ kind: 'text', text: CURRENT.title });
  });
});
