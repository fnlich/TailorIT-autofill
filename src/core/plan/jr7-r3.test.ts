/*
 * jr7 RULES-7 R3 (DFPC-7's P2, SP\jr7\build\DFPC-7.md edits 6 and 8): a job's or a school's own block never takes the
 * person's own phone or email, and Paycom's labels that map to existing categories. The golden synthetic profile
 * (fixtures/profiles/alex-rivera.*) or variants of it; labels are the pages' own text, no value of the owner's.
 */
import { describe, expect, it } from 'vitest';
import type { FieldSpec, SectionRef } from '../types/field';
import type { Profile } from '../types/profile';
import { fieldOf, goldenProfile, inOrder, planOf, specOf } from './plan.testkit';

const golden = goldenProfile();
const DAYFORCE_JOB: SectionRef = { id: 'employment-history', block: 0 };
const SCHOOL: SectionRef = { id: 'education', block: 0 };

const written = (specs: FieldSpec[], spec: FieldSpec, profile: Profile = golden) => {
  const value = fieldOf(planOf(specs, { profile }), spec).write?.value;
  if (value === undefined) return undefined;
  if (value.kind === 'text') return value.text;
  if (value.kind === 'option') return value.cleanLabel;
  return value.kind;
};

describe('R3-1 (safety): an entry’s own phone or email is never the person’s', () => {
  it('plans nothing from contact into a job block’s or a school block’s phone and email', () => {
    const specs = inOrder([
      specOf('Employer Phone Number', 'text', { section: DAYFORCE_JOB, platform: 'dayforce', ordinal: 0,
        constraints: { format: 'tel' } }),
      specOf('Employer Email', 'text', { section: DAYFORCE_JOB, platform: 'dayforce', ordinal: 1 }),
      specOf('Phone', 'text', { section: SCHOOL, platform: 'dayforce', ordinal: 2 }),
      specOf('Email', 'text', { section: SCHOOL, platform: 'dayforce', ordinal: 3 }),
      specOf('Phone Country Code', 'select', { section: DAYFORCE_JOB, platform: 'dayforce', ordinal: 4,
        optionLabels: ['United States (+1)', 'Canada (+1)'] }),
    ]);
    const output = planOf(specs);
    expect(output.writes).toEqual([]);
    expect(output.ask?.answers ?? []).toEqual([]);
  });
  it('still plans the person’s own phone and email outside any entry', () => {
    const phone = specOf('Phone', 'text', { platform: 'dayforce', ordinal: 0 });
    const email = specOf('Email', 'text', { platform: 'dayforce', ordinal: 1 });
    const specs = inOrder([phone, email]);
    expect(written(specs, phone)).toBeDefined();
    expect(written(specs, email)).toBe(golden.contact.email);
  });
});

describe('R3-2: Paycom’s labels that map to existing categories', () => {
  it('reads Legal Middle Name, Legal Suffix and "Apt / Suite / Other"', () => {
    const middle = specOf('Legal Middle Name', 'text', { required: true, platform: 'paycom', ordinal: 0 });
    const suffix = specOf('Legal Suffix', 'text', { platform: 'paycom', ordinal: 1 });
    const line2 = specOf('Apt / Suite / Other', 'text', { platform: 'paycom', ordinal: 2 });
    const specs = inOrder([middle, suffix, line2]);
    const output = planOf(specs);
    expect([middle, suffix, line2].map((spec) => fieldOf(output, spec).row.category))
      .toEqual(['identity.middleName', 'identity.suffix', 'address.line2']);
    const withMiddle: Profile = { ...golden, identity: { ...golden.identity, middleName: 'Jordan' } };
    expect(written(specs, middle, withMiddle)).toBe('Jordan');
  });
  it('never ticks "I do not have a middle name", required or not: the profile never states it', () => {
    for (const required of [false, true]) {
      const box = specOf('I do not have a middle name', 'checkbox', { required, platform: 'paycom' });
      const { write, row } = fieldOf(planOf([box]), box);
      expect(write, String(required)).toBeUndefined();
      expect(row.category).toBe('identity.middleName');
    }
  });
  it('keeps "Other" alone off address line 2', () => {
    const other = specOf('Other', 'text', { platform: 'paycom' });
    expect(fieldOf(planOf([other]), other).row.category).not.toBe('address.line2');
  });
});
