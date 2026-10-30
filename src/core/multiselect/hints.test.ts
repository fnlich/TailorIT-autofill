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
