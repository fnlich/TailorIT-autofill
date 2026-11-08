/*
 * s2 core-wd: Workday's My Information and My Experience read and answered (the wd study §4-5; labelRules.ts
 * WORKDAY_INFO_RULES, the label.phone-country, label.location and experience-description refinements; values.ts
 * phoneTypeValue, suffixValue, hasPreferredNameValue; categories.ts). Each label is the snapshot's
 * (fixtures/workday/s2-exelixis-state-open, s2-verily-my-information, s2-verily-field-of-study-open,
 * s2-exelixis-my-experience); the profile is the golden synthetic one.
 */
import { describe, expect, it } from 'vitest';
import { fieldOf, goldenProfile, planOf, specOf } from '../plan/plan.testkit';
import type { FieldSpec } from '../types/field';
import type { Profile } from '../types/profile';

const PHONE: Partial<FieldSpec> = { platform: 'workday', section: { id: 'phone' } };
const NAME: Partial<FieldSpec> = { platform: 'workday', section: { id: 'legal-name' } };

/** The golden profile with these changes. */
function profileWith(change: (profile: Profile) => Profile): Profile {
  return change(goldenProfile());
}
const withPhone = (extra: Partial<NonNullable<Profile['contact']['phone']>>) => profileWith((profile) => ({ ...profile,
  contact: { ...profile.contact, phone: { ...profile.contact.phone!, ...extra } } }));
const withIdentity = (extra: Partial<Profile['identity']>) => profileWith((profile) => ({ ...profile,
  identity: { ...profile.identity, ...extra } }));

describe('s2 core-wd: Phone Device Type', () => {
  const TYPE = specOf('Phone Device Type', 'combobox', { ...PHONE, required: true,
    optionLabels: ['Select One', 'Landline', 'Mobile', 'Work'] });

  it("chooses the phone's own type, by its usual spellings", () => {
    expect(fieldOf(planOf([TYPE], { profile: withPhone({ type: 'home' }) }), TYPE).write?.value)
      .toMatchObject({ kind: 'option', cleanLabel: 'Landline' });
    expect(fieldOf(planOf([TYPE], { profile: withPhone({ type: 'mobile' }) }), TYPE)).toMatchObject({
      write: { value: { cleanLabel: 'Mobile' }, origin: { provenance: 'profile', path: 'contact.phone.type' } },
      row: { category: 'contact.phoneType', status: 'verified' } });
    const business = specOf('Phone Type', 'select', { ...PHONE, optionLabels: ['Cell', 'Home Phone', 'Business'] });
    expect(fieldOf(planOf([business], { profile: withPhone({ type: 'work' }) }), business).write?.value)
      .toMatchObject({ cleanLabel: 'Business' });
  });

  it('decides "Mobile" for a phone without a type, filled and marked; nothing without a phone', () => {
    expect(fieldOf(planOf([TYPE]), TYPE)).toMatchObject({
      write: { value: { cleanLabel: 'Mobile' }, origin: { provenance: 'profile', path: 'contact.phone' } },
      row: { status: 'flagged', reason: 'filled-low-confidence' } });
    const none = profileWith(({ contact: { phone: _, ...contact }, ...profile }) => ({ ...profile, contact }));
    expect(fieldOf(planOf([TYPE], { profile: none }), TYPE).write).toBeUndefined();
  });
});

describe('s2 core-wd: Suffix, Phone Extension and "I have a preferred name"', () => {
  const SUFFIX = specOf('Suffix', 'combobox', { ...NAME, optionLabels: ['Select One', 'II', 'III', 'Jr.', 'Sr.'] });
  const EXTENSION = specOf('Phone Extension', 'text', { ...PHONE });
  const PREFERRED = specOf('I have a preferred name', 'checkbox', { ...NAME });

  it("chooses the name's suffix however the list writes it, and leaves the list without one", () => {
    expect(fieldOf(planOf([SUFFIX], { profile: withIdentity({ suffix: 'Jr' }) }), SUFFIX).write?.value)
      .toMatchObject({ kind: 'option', cleanLabel: 'Jr.' });
    expect(fieldOf(planOf([SUFFIX], { profile: withIdentity({ suffix: 'III' }) }), SUFFIX).write?.value)
      .toMatchObject({ cleanLabel: 'III' });
    expect(fieldOf(planOf([SUFFIX]), SUFFIX)).toMatchObject({ write: undefined,
      row: { category: 'identity.suffix', status: 'skipped', reason: 'no-profile-value' } });
  });

  it("types the phone's extension, and leaves the box without one", () => {
    expect(fieldOf(planOf([EXTENSION], { profile: withPhone({ extension: '204' }) }), EXTENSION).write)
      .toMatchObject({ value: { kind: 'text', text: '204' }, origin: { path: 'contact.phone.extension' } });
    expect(fieldOf(planOf([EXTENSION]), EXTENSION)).toMatchObject({ write: undefined,
      row: { category: 'contact.phoneExtension', status: 'skipped' } });
  });

  it('ticks "I have a preferred name" only for a preferred name that is not the first name', () => {
    expect(fieldOf(planOf([PREFERRED], { profile: withIdentity({ preferredName: 'AJ' }) }), PREFERRED).write)
      .toMatchObject({ value: { kind: 'check' }, origin: { provenance: 'profile', path: 'identity.preferredName' } });
    for (const preferredName of [undefined, 'Alex', ' alex ']) {
      const planned = fieldOf(planOf([PREFERRED], { profile: withIdentity({ preferredName }) }), PREFERRED);
      expect(planned.write, String(preferredName)).toBeUndefined();
      // Never unrecognised consent any more: the person's own question.
      expect(planned.row.category).toBe('identity.hasPreferredName');
    }
  });
});

describe('s2 core-wd: Country Phone Code (a prompt) and the number beside it', () => {
  const CODE = specOf('Country Phone Code', 'typeahead-remote', { ...PHONE, required: true, options: [] });
  const NUMBER = specOf('Phone Number', 'text', { ...PHONE, required: true, nameAttr: 'phoneNumber' });

  it("searches the phone's country by its name, another spelling and its dial code, then the list's Other", () => {
    expect(fieldOf(planOf([CODE, NUMBER]), CODE).write).toMatchObject({
      value: { kind: 'query', queries: ['United States', 'USA', '+1'], other: true },
      origin: { provenance: 'profile', path: 'contact.phone', transform: 'typeahead.query' } });
  });

  it('types the number without its country code once the code has a control of its own in the section', () => {
    const alone = fieldOf(planOf([NUMBER]), NUMBER).write?.value;
    const beside = fieldOf(planOf([CODE, NUMBER]), NUMBER).write?.value;
    expect(alone).toMatchObject({ kind: 'text' });
    expect(beside).toMatchObject({ kind: 'text' });
    const digits = (value: typeof beside) => (value?.kind === 'text' ? value.text.replace(/\D/g, '') : '');
    expect(digits(alone).startsWith('1')).toBe(true);
    expect(digits(beside)).toBe('5125550147');
  });

  it("chooses the phone's country among the prompt's results as Workday writes it", () => {
    const results = specOf('Country Phone Code', 'typeahead-remote', { ...PHONE, searchResults: true,
      optionLabels: ['United States Minor Outlying Islands (+1)', 'United States of America (+1)'] });
    expect(fieldOf(planOf([results]), results).write?.value)
      .toMatchObject({ kind: 'option', index: 1, cleanLabel: 'United States of America (+1)' });
  });
});

describe('s2 core-wd: My Experience', () => {
  const block = (id: string, at: number): Partial<FieldSpec> => ({ platform: 'workday', section: { id, block: at } });

  it("writes each job's own place into its block's Location, never the person's current location", () => {
    const first = specOf('Location', 'text', block('experience', 0));
    const planned = fieldOf(planOf([first], { repeatables: [] }), first);
    expect(planned.row.category).toBe('experience.location');
    expect(planned.write?.origin).toMatchObject({ provenance: 'profile', path: 'experience[0].location' });
    // A block with no entry of the profile's gets nothing (the person's current location never stands in).
    const past = specOf('Location', 'text', block('experience', 9));
    expect(fieldOf(planOf([past]), past)).toMatchObject({ write: undefined, row: { category: 'experience.location' } });
  });

  it("writes a job's description into its Role Description, and a GPA into \"Overall Result (GPA)\"", () => {
    const role = specOf('Role Description', 'textarea', block('experience', 0));
    expect(fieldOf(planOf([role]), role)).toMatchObject({ row: { category: 'experience.description' },
      write: { origin: { path: 'experience[0].description' } } });
    const gpa = specOf('Overall Result (GPA)', 'text', block('education', 0));
    expect(fieldOf(planOf([gpa]), gpa).row.category).toBe('education.gpa');
  });
});
