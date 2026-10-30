import { describe, expect, it } from 'vitest';
import { prepareOptions } from '../matcher/prepare';
import { optionsOf, vocab } from '../plan/plan.testkit';
import type { Match } from '../types/match';
import { planMultiSelect, sharedDomain, type MultiSelectValue } from './plan';

/** Options from labels ('*' selected, '!' disabled), prepared in the generic domain. */
const prepared = (labels: string[]) => prepareOptions(optionsOf(labels), 'generic', vocab).list;
const selectedOf = (labels: string[]) => new Set(optionsOf(labels).filter((option) => option.selected)
  .map((option) => option.index));
/** A value matched to option `index` (null: no match), by priority order. */
const values = (...indices: Array<number | null>): MultiSelectValue[] => indices.map((index, order) => ({
  ref: `v${order}`, priority: order, order,
  match: { stage: index === null ? 'none' : 'exact', optionIndex: index, rule: index === null ? null : 'raw',
    confidence: index === null ? 0 : 1, flags: [], suggestions: [], reason: index === null ? 'no-match' : 'ok' } as Match,
}));
const plan = (labels: string[], picked: Array<number | null>, limits = {}) => planMultiSelect({
  options: prepared(labels), selected: selectedOf(labels), values: values(...picked), limits });

const SKILLS = ['TypeScript', 'Go', '*PostgreSQL', 'Rust', 'Kubernetes', 'Java', 'Swift', 'None of the above'];

describe('planMultiSelect (§9)', () => {
  it('adds each matched value once, keeps what is already right, never clicks it again (trap 10a)', () => {
    const result = plan(SKILLS, [0, 2, 4]);
    expect(result.add).toEqual([{ ref: 'v0', index: 0 }, { ref: 'v2', index: 4 }]);
    expect(result.keep).toEqual([{ ref: 'v1', index: 2 }]);
    expect(result).toMatchObject({ extraneous: [], verdict: 'ok', reason: 'ok', expectedFinal: [0, 2, 4] });
  });

  it('records two values matching one option as one add, on the higher-priority value', () => {
    expect(plan(['A', 'B', 'C', 'D'], [1, 1, 3]).add).toEqual([{ ref: 'v0', index: 1 }, { ref: 'v2', index: 3 }]);
  });

  it('reports values that matched nothing, as partial success', () => {
    expect(plan(['A', 'B', 'C', 'D'], [0, null])).toMatchObject({ add: [{ ref: 'v0', index: 0 }], unmatched: ['v1'],
      verdict: 'partial', reason: 'partial-multi-select' });
    expect(plan(['A', 'B', '!C', 'D'], [2])).toMatchObject({ add: [], unmatched: ['v0'], verdict: 'partial' });
  });

  it('reports a selected option nobody wants and never unticks it', () => {
    expect(plan(['A', '*B', 'C', 'D'], [0])).toMatchObject({ add: [{ ref: 'v0', index: 0 }], extraneous: [1],
      reason: 'unexpected-selection', expectedFinal: [0, 1] });
  });

  it('takes the highest-priority values under a cap (trap 10b)', () => {
    const result = plan(['Kubernetes', 'Go', 'PostgreSQL', 'TypeScript'], [3, 2, 0], { max: 2 });
    expect(result.add).toEqual([{ ref: 'v0', index: 3 }, { ref: 'v1', index: 2 }]);
    expect(result).toMatchObject({ skippedByMax: ['v2'], verdict: 'partial', reason: 'max-selections-reached' });
    expect(plan(['*A', '*B', 'C', 'D'], [2], { max: 2 })).toMatchObject({ add: [], skippedByMax: ['v0'] });
  });

  it('adds an exclusive option only alone, and only when it is all the profile asks for', () => {
    expect(plan(['Asian', 'White', 'Decline to answer'], [2])).toMatchObject({ add: [{ ref: 'v0', index: 2 }],
      verdict: 'ok' });
    expect(plan(['A', 'B', 'C', 'None of the above'], [0, 3])).toMatchObject({ add: [{ ref: 'v0', index: 0 }],
      conflicts: [{ ref: 'v1', reason: 'exclusive-conflict' }], reason: 'exclusive-conflict' });
    expect(plan(['A', 'B', 'C', '*None of the above'], [0])).toMatchObject({ add: [],
      conflicts: [{ ref: 'v0', reason: 'exclusive-conflict' }] });
    expect(plan(['*A', 'B', 'C', 'None of the above'], [3])).toMatchObject({ add: [],
      conflicts: [{ ref: 'v0', reason: 'exclusive-conflict' }] });
  });

  it('runs the mark-all check before any write, so a plan that would mark everything adds nothing (trap 5b)', () => {
    expect(plan(['TypeScript', 'PostgreSQL', 'Kubernetes'], [0, 1, 2])).toMatchObject({ add: [],
      verdict: 'mark-all-aborted', reason: 'mark-all-aborted' });
    expect(plan(['A', 'B'], [0, 1])).toMatchObject({ verdict: 'ok' });
  });

  it('adds nothing to a group the page selected whole, and shows the person', () => {
    expect(plan(['*A', '*B', '*C'], [0, 1])).toMatchObject({ add: [], reason: 'preselected-left-untouched' });
  });

  it('says when there is nothing to do', () => {
    expect(plan(['*A', 'B', 'C'], [0])).toMatchObject({ add: [], verdict: 'nothing-to-do', reason: 'already-correct' });
  });

  it('flags a minimum or an exact count it cannot reach', () => {
    expect(plan(['A', 'B', 'C', 'D'], [0], { min: 2 })).toMatchObject({ verdict: 'partial',
      reason: 'partial-multi-select' });
  });
});

describe('sharedDomain', () => {
  it('names the domain a set’s values share, or none', () => {
    expect(sharedDomain(['eeo.race', 'eeo.race'])).toBe('eeo.race');
    expect(sharedDomain(['generic', 'language'])).toBeNull();
    expect(sharedDomain([])).toBeNull();
  });
});
