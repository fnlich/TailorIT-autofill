/*
 * Core pass Z2 of 2026-11-06 (CORE-BLOCKERS item 29): a Yes/No question asked with two checkboxes (JazzHR's, the
 * jazzhr-3 and -4 snapshots) is answered as a Yes/No radio: its one matching box, the other left as it is.
 */
import { describe, expect, it } from 'vitest';
import { fieldOf, planOf, specOf } from '../plan/plan.testkit';
import { askedAs, isYesNoPair } from './yesNoPair';

const AUTHORIZED = 'Are you legally authorized to work in the United States?';
const SPONSORSHIP = 'Will you now or in the future require sponsorship for employment visa status?';

describe('a Yes/No pair of checkboxes', () => {
  it('is a checkbox group of two options, one Yes and one No by their first words, and nothing else', () => {
    expect(isYesNoPair(specOf(AUTHORIZED, 'checkbox-group', { optionLabels: ['Yes', 'No'] }))).toBe(true);
    expect(isYesNoPair(specOf(AUTHORIZED, 'checkbox-group', { optionLabels: ['No', 'Yes, I am'] }))).toBe(true);
    expect(isYesNoPair(specOf(AUTHORIZED, 'checkbox-group', { optionLabels: ['Yes', 'No', 'Prefer not to say'] })))
      .toBe(false);
    expect(isYesNoPair(specOf(AUTHORIZED, 'checkbox-group', { optionLabels: ['Yes', 'Yes'] }))).toBe(false);
    // The behaviour review of 2026-11-06 (minor 17, Z2i): exactly two, even where a third option's first word sorts
    // after the Yes and the No.
    expect(isYesNoPair(specOf(AUTHORIZED, 'checkbox-group', { optionLabels: ['Yes', 'No', 'Yes, with sponsorship'] })))
      .toBe(false);
    expect(isYesNoPair(specOf('Languages', 'checkbox-group', { optionLabels: ['English', 'Spanish'] }))).toBe(false);
    expect(isYesNoPair(specOf(AUTHORIZED, 'radio', { optionLabels: ['Yes', 'No'] }))).toBe(false);
    expect(isYesNoPair(specOf(AUTHORIZED, 'checkbox-group', { options: 'lazy' }))).toBe(false);
    expect(askedAs(specOf(AUTHORIZED, 'checkbox-group', { optionLabels: ['Yes', 'No'] })).kind).toBe('radio');
    const languages = specOf('Languages', 'checkbox-group', { optionLabels: ['English', 'Spanish'] });
    expect(askedAs(languages)).toBe(languages);
  });

  it('ticks the box that matches the answer, as a Yes/No radio would choose it', () => {
    const authorized = specOf(AUTHORIZED, 'checkbox-group', { optionLabels: ['Yes', 'No'], required: true });
    const sponsorship = specOf(SPONSORSHIP, 'checkbox-group', { optionLabels: ['Yes', 'No'] });
    const radio = specOf('Are you legally authorized to work in the US?', 'radio', { optionLabels: ['Yes', 'No'],
      required: true });
    const plan = planOf([authorized, sponsorship, radio]);
    expect(fieldOf(plan, authorized).write?.value).toEqual({ kind: 'options', indices: [0], cleanLabels: ['Yes'] });
    expect(fieldOf(plan, authorized).row).toMatchObject({ kind: 'checkbox-group', category: 'workAuth.authorized' });
    expect(fieldOf(plan, sponsorship).write?.value).toEqual({ kind: 'options', indices: [1], cleanLabels: ['No'] });
    expect(fieldOf(plan, radio).write?.value).toMatchObject({ kind: 'option', index: 0, cleanLabel: 'Yes' });
  });

  it('leaves a pair whose other box is ticked to the person, and one already answered as it is', () => {
    const against = specOf(AUTHORIZED, 'checkbox-group', { optionLabels: ['Yes', '*No'] });
    const answered = specOf(SPONSORSHIP, 'checkbox-group', { optionLabels: ['Yes', '*No'] });
    const plan = planOf([against, answered]);
    expect(fieldOf(plan, against).write).toBeUndefined();
    expect(fieldOf(plan, against).row.status).toBe('flagged');
    expect(fieldOf(plan, answered).write).toBeUndefined();
    expect(fieldOf(plan, answered).row).toMatchObject({ status: 'skipped', reason: 'already-correct' });
  });

  it('leaves a group of any other options as before: a yes/no question there is the person\'s', () => {
    const three = specOf(AUTHORIZED, 'checkbox-group', { optionLabels: ['Yes', 'No', 'Prefer not to say'] });
    const plan = planOf([three]);
    expect(fieldOf(plan, three).write).toBeUndefined();
    expect(fieldOf(plan, three).row).toMatchObject({ category: 'workAuth.authorized', needsUserAction: true });
  });
});
