import { describe, expect, it } from 'vitest';
import { parseSelectionHints, selectionLimits } from './hints';

describe('parseSelectionHints (§9)', () => {
  it('reads "select all that apply" as several answers, never as a cap', () => {
    expect(parseSelectionHints('Which of these skills do you use? (select all that apply)', '')).toEqual({
      selectAllThatApply: true });
    expect(parseSelectionHints('Languages', 'Check all that apply.')).toEqual({ selectAllThatApply: true });
  });

  it('reads a cap, an exact count and a minimum, in digits or words', () => {
    expect(parseSelectionHints('Which of these skills are your strongest? (choose up to 2)', ''))
      .toMatchObject({ maxSelections: 2 });
    expect(parseSelectionHints('Select no more than three', '')).toMatchObject({ maxSelections: 3 });
    expect(parseSelectionHints('List your top 5 tools', '')).toMatchObject({ maxSelections: 5 });
    expect(parseSelectionHints('Choose 3 of the following', '')).toMatchObject({ exactSelections: 3 });
    expect(parseSelectionHints('Pick exactly two', '')).toMatchObject({ exactSelections: 2 });
    expect(parseSelectionHints('Skills', 'Select at least 2.')).toMatchObject({ minSelections: 2 });
  });

  // CORE-9 (Phase 2 review): a cap with no verb before it was missed, and a range was read as an exact count of its
  // first number, so "Select 1-3" took one value.
  it.each([
    ['Which skills do you use most? (up to 3)', '', { maxSelections: 3 }],
    ['Preferred locations (max 3)', '', { maxSelections: 3 }],
    ['Up to 3 selections', '', { maxSelections: 3 }],
    ['Which teams interest you? (Maximum of 2)', '', { maxSelections: 2 }],
    ['Areas of interest', 'At most four.', { maxSelections: 4 }],
    ['Select 1-3', '', { minSelections: 1, maxSelections: 3 }],
    ['Choose 2 or 3 of the following', '', { minSelections: 2, maxSelections: 3 }],
    ['Pick between 2 and 4 options', '', { minSelections: 2, maxSelections: 4 }],
    ['Top skills (1\u{2013}3 selections)', '', { minSelections: 1, maxSelections: 3 }],
    ['Your strongest areas (1 to 3)', '', { minSelections: 1, maxSelections: 3 }],
  ] as const)('reads %j', (label, description, hints) => {
    const parsed = parseSelectionHints(label, description);
    expect(parsed).toMatchObject(hints);
    expect(parsed.exactSelections).toBeUndefined();
    if (!('minSelections' in hints)) expect(parsed.minSelections).toBeUndefined();
  });

  it('reads no cap in a length of time or a count of people', () => {
    for (const label of ['Which tools have you used for up to 3 years?', 'Teams of up to 10 people you led',
      'Select the shifts you can work (2-3 hours each)']) {
      expect(parseSelectionHints(label, ''), label).toEqual({ selectAllThatApply: false });
    }
  });

  it('reads no count where there is none', () => {
    expect(parseSelectionHints('Select one or more', '')).toEqual({ selectAllThatApply: false });
    expect(parseSelectionHints('Which languages do you speak?', '')).toEqual({ selectAllThatApply: false });
    expect(parseSelectionHints('Select all', '')).toEqual({ selectAllThatApply: false });
  });
});

describe('selectionLimits', () => {
  it('lets the tighter bound win, an exact count capping too', () => {
    expect(selectionLimits({ maxSelections: 4 }, { selectAllThatApply: false, maxSelections: 2 })).toEqual({ max: 2 });
    expect(selectionLimits({}, { selectAllThatApply: false, exactSelections: 3 })).toEqual({ max: 3, exact: 3 });
    expect(selectionLimits({ minSelections: 1 }, { selectAllThatApply: true, minSelections: 2 })).toEqual({ min: 2 });
    expect(selectionLimits({}, { selectAllThatApply: true })).toEqual({});
  });
});
