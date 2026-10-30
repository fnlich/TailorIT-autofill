import { describe, expect, it } from 'vitest';
import { checkMarkAll, type MarkAllOption } from './markAll';

/** Options from a pattern: 'o' a plain option, 'x' an exclusive one, 's' selected, 'u' unusable. */
const options = (pattern: string): MarkAllOption[] => pattern.split(' ').map((flags, index) => ({ index,
  selectable: !flags.includes('u'), exclusive: flags.includes('x'), selected: flags.includes('s') }));

describe('the mark-all check (§7.7)', () => {
  it('aborts a write that would leave every selectable option selected in a group of more than two', () => {
    expect(checkMarkAll({ options: options('o o o'), added: [0, 1, 2], kept: 0, profileSetSize: 3 }))
      .toEqual({ ok: false, reason: 'mark-all-aborted' });
    // Leaving "None of the above" out does not dodge it.
    expect(checkMarkAll({ options: options('o o o x'), added: [0, 1, 2], kept: 0, profileSetSize: 3 }))
      .toEqual({ ok: false, reason: 'mark-all-aborted' });
    // The page's own selections count towards the cover.
    expect(checkMarkAll({ options: options('os o o'), added: [1, 2], kept: 1, profileSetSize: 3 }))
      .toEqual({ ok: false, reason: 'mark-all-aborted' });
  });

  it('lets a group of two be filled whole, and a group of more be filled in part', () => {
    expect(checkMarkAll({ options: options('o o'), added: [0, 1], kept: 0, profileSetSize: 2 })).toEqual({ ok: true });
    expect(checkMarkAll({ options: options('o o o o o o'), added: [0, 3], kept: 0, profileSetSize: 3 }))
      .toEqual({ ok: true });
    // Unusable options are not selectable, so they leave no gap.
    expect(checkMarkAll({ options: options('o o o u'), added: [0, 1, 2], kept: 0, profileSetSize: 3 }))
      .toEqual({ ok: false, reason: 'mark-all-aborted' });
  });

  it('aborts when the options the person would hold outnumber the profile’s values', () => {
    expect(checkMarkAll({ options: options('o o o o o'), added: [0, 1], kept: 1, profileSetSize: 2 }))
      .toEqual({ ok: false, reason: 'exceeds-profile-set' });
    // The page's own selections are not ours to count.
    expect(checkMarkAll({ options: options('os os o o o o'), added: [2, 3], kept: 0, profileSetSize: 2 }))
      .toEqual({ ok: true });
  });

  it('adds nothing to a group the page selected whole', () => {
    expect(checkMarkAll({ options: options('os os os'), added: [], kept: 2, profileSetSize: 2 })).toEqual({ ok: true });
    expect(checkMarkAll({ options: options('os os os x'), added: [3], kept: 0, profileSetSize: 1 }))
      .toEqual({ ok: false, reason: 'preselected-left-untouched' });
  });

  it('runs the cover test alone where the profile is unknown (the frame)', () => {
    expect(checkMarkAll({ options: options('o o o'), added: [0, 1, 2] })).toEqual({ ok: false, reason: 'mark-all-aborted' });
    expect(checkMarkAll({ options: options('o o o'), added: [0, 1] })).toEqual({ ok: true });
  });
});
