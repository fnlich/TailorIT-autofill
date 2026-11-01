import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AUTOFILL_FILE_MIME_TYPES, AutofillProfileSaveSchema, AutofillProfileSchema, AutofillSensitiveSaveSchema,
  AutofillSensitiveSchema, EMPTY_AUTOFILL_PROFILE, EMPTY_AUTOFILL_SENSITIVE, type AutofillProfile,
  type AutofillSensitive,
} from '../../contract/tailorit';
import { goldenWire, NOW, vocab } from '../plan/plan.testkit';
import { attachResume, canonicalizeProfile, placeText, RESUME_MIME_TYPES } from './canonicalize';
import { CANONICALIZE_ISSUE_CODES } from './entities';

const EXAMPLES = new URL('../../contract/tailorit/v1/fixtures/', import.meta.url);
const examples = (schema: string) => readdirSync(new URL(`${schema}/valid/`, EXAMPLES)).map((name) => ({ name,
  value: JSON.parse(readFileSync(new URL(`${schema}/valid/${name}`, EXAMPLES), 'utf8')) as unknown }));
const example = <T>(schema: string, name: string) => examples(schema).find((item) => item.name === name)!.value as T;

const canonical = (profile: AutofillProfile, sensitive: AutofillSensitive | null = null) =>
  canonicalizeProfile(profile, sensitive, vocab, NOW);

describe('the golden profile (fixtures/profiles)', () => {
  const wire = goldenWire();

  it('parses with TailorIT’s schemas, the stricter save schemas included', () => {
    expect(AutofillProfileSchema.safeParse(wire.profile).success).toBe(true);
    expect(AutofillProfileSaveSchema.safeParse(wire.profile).success).toBe(true);
    expect(AutofillSensitiveSchema.safeParse(wire.sensitive).success).toBe(true);
    expect(AutofillSensitiveSaveSchema.safeParse(wire.sensitive).success).toBe(true);
    expect(AutofillProfileSchema.parse(wire.profile)).toEqual(wire.profile);
  });

  it('canonicalizes into the expected entities: UT Austin by name, its CIP code, a bachelor’s BS', () => {
    const { profile, issues, sensitiveState } = canonical(wire.profile, wire.sensitive);
    expect(issues).toEqual([]);
    expect(sensitiveState).toBe('loaded');
    const [school] = profile.education;
    expect(school!.institution).toMatchObject({ canonicalName: 'The University of Texas at Austin',
      ids: { ipeds: '228778' }, source: 'vocab', city: 'Austin', region: 'TX', country: 'US',
      userText: 'The University of Texas at Austin' });
    expect(school!.degree).toMatchObject({ level: 'bachelor', type: 'BS',
      field: { name: 'Computer Science', cip: '11.0701' } });
    expect(school).toMatchObject({ startDate: { y: 2015, m: 8 }, endDate: { y: 2019, m: 5 }, inProgress: false,
      gpa: { value: 3.8, scale: 4 } });
  });

  it('holds the fixed values the trap fixtures rely on', () => {
    const { profile } = canonical(wire.profile, wire.sensitive);
    expect(profile.identity).toEqual({ fullName: 'Alex Rivera', firstName: 'Alex', lastName: 'Rivera',
      nameSplitDerived: false });
    expect(profile.contact).toEqual({ email: 'alex.rivera.f7q2@example.com', phone: { text: '+1 512 555 0147',
      digits: '15125550147', countryCallingCode: '1', country: 'US' } });
    expect(profile.address).toEqual({ line1: '4417 Quillfeather Lane', city: 'Austin',
      region: { code: 'TX', name: 'Texas' }, postalCode: '78701', country: 'US' });
    expect(profile.links).toEqual({ linkedin: 'https://www.linkedin.com/in/alex-rivera-f7q2',
      github: 'https://github.com/alexrivera-f7q2', portfolio: 'https://alexrivera-f7q2.example.com', other: [] });
    expect(profile.experience.map((entry) => [entry.company, entry.title, entry.current, entry.endDate])).toEqual([
      ['Quillfeather Labs', 'Senior Software Engineer', true, undefined],
      ['Marrowgate Systems', 'Software Engineer', false, { y: 2021, m: 5 }]]);
    expect(profile.experience[0]!.location).toEqual({ text: 'Austin, TX', city: 'Austin',
      region: { code: 'TX', name: 'Texas' }, country: 'US' });
    expect(profile.skills).toEqual(['TypeScript', 'PostgreSQL', 'Kubernetes']);
    expect(profile.languages).toEqual([{ code: 'en', name: 'English', proficiency: 'native' },
      { code: 'es', name: 'Spanish', proficiency: 'professional-working' }]);
    expect(profile.referralSource).toEqual({ id: 'linkedin' });
    expect(profile.workAuthorization).toEqual([{ country: 'US', authorized: { kind: 'value', value: true },
      sponsorshipNow: { kind: 'value', value: false }, sponsorshipFuture: { kind: 'value', value: false } }]);
    expect(profile.screening).toEqual({ over18: { kind: 'value', value: true } });
    expect(profile.eeo).toEqual({ gender: { kind: 'decline' }, hispanicLatino: { kind: 'decline' },
      race: { kind: 'decline' }, veteran: { kind: 'value', value: { veteran: false, protected: false } },
      disability: { kind: 'decline' } });
    expect(profile.resume).toBeUndefined();
  });
});

describe('canonicalizeProfile over the contract’s examples (§2.7)', () => {
  it('canonicalizes every valid example, with issues that carry a path and a known code and never a value', () => {
    for (const { name, value } of examples('AutofillProfile')) {
      for (const sensitive of examples('AutofillSensitive')) {
        const result = canonical(value as AutofillProfile, sensitive.value as AutofillSensitive);
        for (const issue of result.issues) {
          expect(Object.keys(issue).sort(), name).toEqual(['code', 'path']);
          expect(CANONICALIZE_ISSUE_CODES, name).toContain(issue.code);
          expect(issue.path, name).toMatch(/^[A-Za-z0-9.[\]]+$/);
        }
      }
    }
  });

  it('reads the golden example’s entities', () => {
    const { profile } = canonical(example<AutofillProfile>('AutofillProfile', 'golden.json'));
    expect(profile.identity).toEqual({ fullName: 'Elena Marisol Ruiz', firstName: 'Elena', middleName: 'Marisol',
      lastName: 'Ruiz', preferredName: 'Lena', nameSplitDerived: false });
    const [ut, tamu] = profile.education;
    expect(ut!.institution.ids).toEqual({ ipeds: '228778', ror: '00hj54h04' });
    expect(ut!.degree).toMatchObject({ level: 'master', type: 'MS', field: { cip: '11.0701' } });
    expect(tamu!.institution).toMatchObject({ source: 'vocab', country: 'US' });
    expect(tamu!.degree).toMatchObject({ level: 'bachelor', type: 'BS' });
    expect(tamu!.minor).toMatchObject({ name: 'Mathematics' });
    expect(tamu!.startDate).toEqual({ y: 2015 });
    expect(profile.address).toMatchObject({ line2: 'Apt 4B', region: { code: 'TX' } });
    expect(profile.links.other).toEqual([{ label: 'Kaggle', url: 'https://www.kaggle.com/elenaruizexample' }]);
    expect(profile.languages.map((language) => [language.code, language.proficiency])).toEqual([['en', 'native'],
      ['es', 'full-professional'], ['pt', undefined]]);
    expect(profile.preferences).toEqual({ startDate: { kind: 'date', date: { y: 2026, m: 12, d: 1 } },
      relocation: { kind: 'value', value: false }, workArrangements: ['remote', 'hybrid'], travelPercent: 10 });
    expect(profile.experience[0]).toMatchObject({ current: true, description: expect.stringContaining('ingestion') });
  });

  it('gives the empty profile no values, and no sensitive answers without the sensitive part', () => {
    const { profile, sensitiveState, issues } = canonical(EMPTY_AUTOFILL_PROFILE);
    expect(sensitiveState).toBe('not-loaded');
    expect(issues).toEqual([]);
    expect(profile).toEqual({
      identity: { fullName: '', firstName: '', lastName: '', nameSplitDerived: false }, contact: { email: '' },
      links: { other: [] }, workAuthorization: [], eeo: {}, screening: {}, education: [], experience: [],
      languages: [], skills: [], preferences: {} });
  });

  it('maps every sensitive answer tri-state: not provided absent, declined a decline, a value a value', () => {
    const wire = example<AutofillProfile>('AutofillProfile', 'golden.json');
    const empty = canonical(wire, EMPTY_AUTOFILL_SENSITIVE).profile;
    expect(empty.eeo).toEqual({});
    expect(empty.screening).toEqual({});
    expect(empty.identity.pronouns).toBeUndefined();
    const declined = canonical(wire, example<AutofillSensitive>('AutofillSensitive', 'all-declined.json')).profile;
    expect(declined.eeo).toEqual({ gender: { kind: 'decline' }, hispanicLatino: { kind: 'decline' },
      race: { kind: 'decline' }, veteran: { kind: 'decline' }, disability: { kind: 'decline' } });
    expect(declined.workAuthorization).toEqual([{ country: 'GB', authorized: { kind: 'decline' },
      sponsorshipNow: { kind: 'decline' }, sponsorshipFuture: { kind: 'decline' }, status: { kind: 'decline' } }]);
    expect(declined.identity.pronouns).toEqual({ kind: 'decline' });
    expect(declined.preferences.expectedSalary).toEqual({ kind: 'decline' });
    const golden = canonical(wire, example<AutofillSensitive>('AutofillSensitive', 'golden.json')).profile;
    expect(golden.eeo).toEqual({ gender: { kind: 'value', value: { identity: 'female' } },
      hispanicLatino: { kind: 'value', value: true }, race: { kind: 'value', value: ['white'] },
      veteran: { kind: 'value', value: { veteran: false, protected: false } }, disability: { kind: 'decline' } });
    expect(golden.workAuthorization[1]).toEqual({ country: 'CA', authorized: { kind: 'value', value: false },
      sponsorshipNow: { kind: 'value', value: true }, sponsorshipFuture: { kind: 'value', value: true } });
    expect(golden.preferences.expectedSalary).toEqual({ kind: 'value', value: { min: 150000, max: 180000,
      currency: 'USD', period: 'year' } });
    const own = canonical(wire, example<AutofillSensitive>('AutofillSensitive', 'self-described.json')).profile;
    expect(own.eeo.gender).toEqual({ kind: 'value', value: { identity: 'self-describe', selfDescribed: 'Genderqueer' } });
    expect(own.eeo.race).toEqual({ kind: 'value', value: ['asian', 'white'] });
    expect(own.eeo.veteran).toEqual({ kind: 'value', value: { veteran: true, protected: true } });
  });

  it('leaves an EEO answer holding an unknown value absent as a whole, never a subset', () => {
    const sensitive = structuredClone(EMPTY_AUTOFILL_SENSITIVE) as AutofillSensitive;
    sensitive.eeo.races = { state: 'value', value: ['white', 'martian' as 'white'] };
    sensitive.eeo.gender = { state: 'value', value: { identity: 'robot' as 'male', selfDescribed: '' } };
    const { profile, issues } = canonical(EMPTY_AUTOFILL_PROFILE, sensitive);
    expect(profile.eeo).toEqual({});
    expect(issues).toEqual([{ path: 'eeo.gender', code: 'eeo-value-unknown' },
      { path: 'eeo.race', code: 'eeo-value-unknown' }]);
  });

  it('reads an end date after today as still in progress, and a notice of no weeks as immediately', () => {
    const wire = structuredClone(goldenWire().profile);
    wire.education[0]!.endDate = '2027-05';
    wire.preferences.noticePeriodWeeks = 0;
    const { profile } = canonical(wire);
    expect(profile.education[0]!.inProgress).toBe(true);
    expect(profile.preferences.startDate).toEqual({ kind: 'immediately' });
    wire.preferences.noticePeriodWeeks = 2;
    expect(canonical(wire).profile.preferences.startDate).toEqual({ kind: 'notice', weeks: 2 });
  });

  it('keeps a referral source and a language the vocabulary does not know as written, with an issue', () => {
    const wire = structuredClone(goldenWire().profile);
    wire.preferences.referralSource = 'My aunt Rosalind';
    wire.languages = [{ language: 'Elvish', proficiency: null }];
    const { profile, issues } = canonical(wire);
    expect(profile.referralSource).toEqual({ id: 'other', otherText: 'My aunt Rosalind' });
    expect(profile.languages).toEqual([{ name: 'Elvish' }]);
    expect([...issues].sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: 'languages[0]', code: 'language-not-in-vocab' }, { path: 'referralSource', code: 'referral-not-in-vocab' }]);
  });
});

describe('the phone’s calling code and country', () => {
  /** The golden wire with this phone number, phone country and address country. */
  const withPhone = (number: string, country: string | null, addressCountry: string | null) => {
    const wire = structuredClone(goldenWire().profile);
    wire.contact.phone = { ...wire.contact.phone, number, country };
    wire.contact.address = { ...wire.contact.address, country: addressCountry };
    return canonical(wire);
  };

  // CORE-18 (Phase 2 review): a strict E.164 number ("+15125550147") got no calling code, so the code was written
  // twice beside a code select and the field's pattern went unused.
  it('reads the calling code of a number written with or without spaces', () => {
    for (const number of ['+15125550147', '+1 512 555 0147', '+1-512-555-0147', '+1 (512) 555-0147']) {
      expect(withPhone(number, 'US', 'US').profile.contact.phone, number).toMatchObject({ countryCallingCode: '1',
        digits: '15125550147', country: 'US' });
    }
    expect(withPhone('+442079460958', null, 'GB').profile.contact.phone).toMatchObject({ countryCallingCode: '44',
      country: 'GB' });
    expect(withPhone('+353 1 234 5678', null, null).profile.contact.phone).toMatchObject({ countryCallingCode: '353',
      country: 'IE' });
    expect(withPhone('512-555-0147', null, 'US').profile.contact.phone?.countryCallingCode).toBeUndefined();
    expect(withPhone('+999 123 456', null, null).profile.contact.phone?.countryCallingCode).toBeUndefined();
  });

  // CORE-7 (Phase 2 review): the phone's country fell back to the address's despite a calling code, so "+1 512 ..."
  // with an address in Britain chose the United Kingdom (+44).
  it('takes the phone’s country from its calling code, the address only without one, and none on a mismatch', () => {
    const british = withPhone('+1 512 555 0147', null, 'GB');
    expect(british.profile.contact.phone?.country).toBeUndefined();
    expect(british.profile.contact.phone?.countryCallingCode).toBe('1');
    expect(british.issues).toContainEqual({ path: 'contact.phone.country', code: 'phone-country-mismatch' });
    expect(withPhone('+1 512 555 0147', 'GB', 'US').profile.contact.phone?.country).toBeUndefined();
    // A code several countries share takes the one the address or the phone names.
    expect(withPhone('+1 416 555 0147', null, 'CA').profile.contact.phone?.country).toBe('CA');
    expect(withPhone('+1 512 555 0147', 'CA', 'US').profile.contact.phone?.country).toBe('CA');
    // A code of one country is that country's; a shared one with nothing to choose by is none.
    expect(withPhone('+33 1 23 45 67 89', null, null).profile.contact.phone?.country).toBe('FR');
    expect(withPhone('+1 512 555 0147', null, null).profile.contact.phone?.country).toBeUndefined();
    // With no calling code the phone's own country, else the address's.
    expect(withPhone('020 7946 0958', null, 'GB').profile.contact.phone?.country).toBe('GB');
    expect(withPhone('020 7946 0958', 'IE', 'GB').profile.contact.phone?.country).toBe('IE');
    expect(withPhone('+1 512 555 0147', 'US', 'US').issues).toEqual([]);
  });
});

describe('placeText', () => {
  it('writes "City, ST" in North America and "City, Region, Country" elsewhere', () => {
    expect(placeText({ city: 'Austin', region: { code: 'TX', name: 'Texas' }, country: 'US' }, vocab)).toBe('Austin, TX');
    expect(placeText({ city: 'Lyon', region: { name: 'Rhône' }, country: 'FR' }, vocab)).toBe('Lyon, Rhône, France');
    expect(placeText({}, vocab)).toBe('');
  });
});

describe('attachResume', () => {
  const { profile } = canonical(goldenWire().profile);

  it('gives the profile the lookup’s suggested resume, and takes it away for none', () => {
    const withResume = attachResume(profile, { id: 'r1', fileName: 'Alex.pdf', fileKind: 'pdf' }, 1234);
    expect(withResume.resume).toEqual({ id: 'r1', fileName: 'Alex.pdf', mime: 'application/pdf', sizeBytes: 1234 });
    expect(attachResume(withResume, null).resume).toBeUndefined();
  });

  it('knows the contract’s MIME type of every file kind', () => {
    expect(RESUME_MIME_TYPES).toEqual(AUTOFILL_FILE_MIME_TYPES);
  });
});
