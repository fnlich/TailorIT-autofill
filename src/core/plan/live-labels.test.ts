/*
 * Three labels the live Ashby check of 2026-11-01 found the rules reading wrongly (the Phase 2 review), planned end to
 * end with the golden profile:
 * - "Still Student?" in an Education block was unrecognised consent (only the person ticks it): it is the entry's
 *   "still studying", ticked for an entry in progress as "I currently work here" is for a current job;
 * - "Best Contact Number", a type=tel box, was nothing at all: a telephone box whose label no rule reads is a phone,
 *   filled and flagged for a look (never another person's number, a fax or an extension);
 * - "Do you identify as disabled, or as having a disability?" (multiverse's UK survey) was a sensitive topic for the
 *   person: it is the disability question, answered from the profile's answer with the form's own options.
 */
import { describe, expect, it } from 'vitest';
import type { Profile } from '../types/profile';
import { fieldOf, goldenProfile, planOf, specOf } from './plan.testkit';

const golden = goldenProfile();

describe('"Still Student?" in an Education block', () => {
  const box = specOf('Still Student?', 'checkbox', { section: { id: 'education', block: 0 } });

  it('is the entry’s "still studying", ticked for an entry in progress', () => {
    const studying: Profile = { ...golden, education: golden.education.map((entry, at) => (at === 0
      ? { ...entry, inProgress: true } : entry)) };
    const { write, row } = fieldOf(planOf([box], { profile: studying }), box);
    expect(row).toMatchObject({ category: 'education.current', provenance: 'rule' });
    expect(write).toMatchObject({ value: { kind: 'check' },
      origin: { provenance: 'rule', ruleId: 'education.current-checkbox' } });
  });

  it('is never ticked for an entry the person finished, and is never consent', () => {
    const finished: Profile = { ...golden, education: golden.education.map((entry) => ({ ...entry, inProgress: false })) };
    const { write, row } = fieldOf(planOf([box], { profile: finished }), box);
    expect(row.category).toBe('education.current');
    expect(write).toBeUndefined();
  });
});

describe('a telephone box whose label no rule reads', () => {
  it('is a phone, written from the profile and flagged for a look', () => {
    const phone = specOf('Best Contact Number', 'text', { constraints: { format: 'tel' } });
    const { write, row } = fieldOf(planOf([phone]), phone);
    expect(row).toMatchObject({ category: 'contact.phone', status: 'flagged', reason: 'filled-low-confidence' });
    expect(write?.value.kind).toBe('text');
  });

  it('is nothing of the kind without type=tel, or when it names another person, a fax or an extension', () => {
    for (const spec of [specOf('Best Contact Number', 'text'),
      specOf('Emergency contact number', 'text', { constraints: { format: 'tel' } }),
      specOf('Fax', 'text', { constraints: { format: 'tel' } }),
      specOf('Extension', 'text', { constraints: { format: 'tel' } })]) {
      expect(fieldOf(planOf([spec]), spec).row.category, spec.label).not.toBe('contact.phone');
    }
  });
});

describe('"Do you identify as disabled, or as having a disability?"', () => {
  const question = specOf('Do you identify as disabled, or as having a disability?', 'radio',
    { optionLabels: ['Yes', 'No', 'I prefer not to answer'] });
  const withDisability = (disability: NonNullable<Profile['eeo']>['disability']): Profile =>
    ({ ...golden, eeo: { ...golden.eeo, disability } });

  it('is the disability question, answered with the form’s own option for the profile’s answer', () => {
    const chosen = (profile: Profile) => {
      const { write, row } = fieldOf(planOf([question], { profile }), question);
      expect(row.category).toBe('eeo.disability');
      return write?.value.kind === 'option' ? write.value.cleanLabel : null;
    };
    expect(chosen(withDisability({ kind: 'value', value: true }))).toBe('Yes');
    expect(chosen(withDisability({ kind: 'value', value: false }))).toBe('No');
    expect(chosen(withDisability({ kind: 'decline' }))).toBe('I prefer not to answer');
  });
});
