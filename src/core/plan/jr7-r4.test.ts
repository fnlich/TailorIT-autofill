/*
 * jr7 RULES-7 R4 (RBP7-07, RBP-7's P2 on snapshot7 rippling1): a typed-name signature asked in a sentence past the
 * first 500 characters of a long help text, after words that name documents. The help texts here are synthetic,
 * written to the capture's shape (its length and the order of its words); the golden synthetic profile fills them.
 */
import { describe, expect, it } from 'vitest';
import { classifyByRules } from '../resolver/classifyRules';
import type { Profile } from '../types/profile';
import { fieldOf, goldenProfile, planOf, specOf } from './plan.testkit';

const golden = goldenProfile();

/** Synthetic: about 560 characters certifying the documents submitted, then the ask for the typed name. */
const LONG_HELP = 'I certify that all of the information I have provided in this application, including my resume, my cover '
  + 'letters, my online profiles and any other materials or statements submitted with or in support of it, is true, '
  + 'correct and complete to the best of my knowledge and belief. I understand that any misrepresentation, falsification '
  + 'or material omission of information in this application or in any document, interview or test that is part of the '
  + 'hiring process may result in my not being hired or, if I am hired, in the end of my employment at any time. '
  + 'Please acknowledge this by typing your full name in the text field.';

describe('R4 (RBP7-07): a typed-name signature asked late in a long help text', () => {
  it('is past the first 500 characters, after words that name documents', () => {
    expect(LONG_HELP.length).toBeGreaterThan(500);
    expect(LONG_HELP.indexOf('typing your full name')).toBeGreaterThan(500);
  });
  it('reads the box as the signature and types the full name', () => {
    const spec = specOf('Truth Certification/Attestation Clause', 'text', { required: true, platform: 'rippling',
      description: LONG_HELP });
    expect(classifyByRules(spec)).toMatchObject({ asks: 'consent.signature', needsUser: 'description-only' });
    const { write, row } = fieldOf(planOf([spec]), spec);
    expect(row.category).toBe('consent.signature');
    expect(write?.value).toEqual({ kind: 'text', text: golden.identity.fullName });
  });
  it('never makes an upload whose help mentions the name a signature', () => {
    const upload = specOf('Resume', 'file', { required: true, platform: 'rippling', description: 'Upload your resume '
      + 'as a PDF. Please name the file with your full name, for example First Last Resume.' });
    expect(classifyByRules(upload)?.category).toBe('file.resume');
    // Even a help that asks for the name typed: a file input (its label naming nothing) takes no typed signature, so
    // the upload is never handed over as one.
    const asked = specOf('Attachment', 'file', { required: true, platform: 'rippling',
      description: `${LONG_HELP} Upload your resume as a PDF.` });
    const rules = classifyByRules(asked);
    expect(rules?.category ?? rules?.asks ?? null).not.toBe('consent.signature');
  });
  it('never makes a box whose help only says to type the name a signature', () => {
    const certifies = LONG_HELP.replace(/Please acknowledge.*$/, '');
    const plain = specOf('Attestation', 'text', { description: `${certifies} Please type your full name.` });
    const rules = classifyByRules(plain);
    expect(rules?.category ?? rules?.asks).not.toBe('consent.signature');
  });
});

describe('R4 (UKGREADY-7 P2): a second email and a work phone are no repeats of the person’s one', () => {
  const contact = (label: string, kind: 'text' = 'text', extra: { nameAttr?: string; ordinal?: number } = {}) =>
    specOf(label, kind, { platform: 'ukgready', section: { id: 'contact' }, ordinal: extra.ordinal ?? 0,
      ...(extra.nameAttr ? { nameAttr: extra.nameAttr } : {}) });
  const written = (spec: ReturnType<typeof contact>, profile = golden) => {
    const value = fieldOf(planOf([spec], { profile }), spec).write?.value;
    return value?.kind === 'text' ? value.text : value?.kind;
  };
  it('(a) leaves a secondary or alternate email, by its label or its name, and fills the primary', () => {
    for (const spec of [contact('Secondary Email'), contact('Alternate Email'), contact('Email', 'text',
      { nameAttr: 'secondaryEmail' })]) {
      expect(written(spec), spec.label).toBeUndefined();
    }
    expect(written(contact('Email'))).toBe(golden.contact.email);
  });
  it('(b) leaves a work phone unless the profile’s phone is a work phone; home, cell and mobile keep it', () => {
    expect(written(contact('Work Phone'))).toBeUndefined();
    expect(written(contact('Phone', 'text', { nameAttr: 'workPhone' }))).toBeUndefined();
    for (const label of ['Home Phone', 'Cell Phone', 'Mobile Phone', 'Phone']) {
      expect(written(contact(label)), label).toBeDefined();
    }
    const atWork: Profile = { ...golden, contact: { ...golden.contact, phone: { ...golden.contact.phone!, type: 'work' } } };
    expect(written(contact('Work Phone'), atWork)).toBeDefined();
  });
});

describe('R5 (E4-2): a month-precision date into a text date box whose pattern holds a day', () => {
  const SCHOOL = { id: 'education', block: 0 };
  const box = (pattern: string) => specOf('Start date', 'text', { section: SCHOOL, platform: 'ukgready',
    constraints: { pattern, format: 'date' } });
  it('writes the month’s 1st, flagged as a guess in the row, as DF7-04 does for a date control', () => {
    const spec = box('MM/DD/YYYY');
    const { write, row } = fieldOf(planOf([spec]), spec);
    expect(write?.value).toEqual({ kind: 'text', text: '08/01/2015' });
    expect(row).toMatchObject({ reason: 'filled-low-confidence', status: 'flagged' });
    // The same row as DF7-04's native date control gives.
    const native = specOf('Start date', 'date', { section: SCHOOL, platform: 'ukgready', constraints: { format: 'date' } });
    expect(fieldOf(planOf([native]), native).row).toMatchObject({ reason: row.reason, status: row.status });
  });
  it('keeps a full date as it is, and refuses a year-only date', () => {
    const spec = box('MM/DD/YYYY');
    const exact: Profile = { ...golden, education: [{ ...golden.education[0]!, startDate: { y: 2015, m: 8 } }] };
    expect(fieldOf(planOf([spec], { profile: exact }), spec).write?.value).toEqual({ kind: 'text', text: '08/01/2015' });
    const yearOnly: Profile = { ...golden, education: [{ ...golden.education[0]!, startDate: { y: 2015 } }] };
    expect(fieldOf(planOf([spec], { profile: yearOnly }), spec)).toMatchObject({ write: undefined,
      row: { reason: 'format-unsupported' } });
    const start: Profile = { ...golden, preferences: { ...golden.preferences,
      startDate: { kind: 'date', date: { y: 2026, m: 12, d: 9 } } } };
    const available = specOf('Date Available', 'text', { platform: 'bamboohr', constraints: { pattern: 'MM/DD/YYYY' } });
    expect(fieldOf(planOf([available], { profile: start }), available)).toMatchObject({
      write: { value: { kind: 'text', text: '12/09/2026' } }, row: { reason: 'ok' } });
  });
});

describe('R5 (UP7-11): the degree level among an attainment list of eleven', () => {
  // UltiPro's options as its list labels them (public list words, written here synthetically).
  const OPTIONS = ['Less than HS Graduate', 'HS Graduate or equivalent', 'Some college', 'Technical School',
    '2 year college degree', 'Bachelor\'s level degree', 'Some graduate school', 'Master\'s level degree',
    'Doctorate Academic', 'Doctorate Professional', 'Post doctorate'];
  const spec = specOf('Please select the highest level of education you have attained.', 'radio', { required: true,
    platform: 'ultipro', optionLabels: OPTIONS });
  const entry = golden.education[0]!;
  const holding = (degree: Partial<typeof entry.degree>): Profile => ({ ...golden,
    education: [{ ...entry, degree: { ...entry.degree, ...degree } }] });
  const chosen = (profile: Profile) => {
    const value = fieldOf(planOf([spec], { profile }), spec).write?.value;
    return value?.kind === 'option' ? value.cleanLabel : undefined;
  };
  it.each<[string, Profile, string]>([
    ['the golden bachelor', golden, 'Bachelor\'s level degree'],
    ['a master', holding({ level: 'master', type: 'MS' }), 'Master\'s level degree'],
    ['an associate', holding({ level: 'associate', type: 'AS' }), '2 year college degree'],
    ['a high-school graduate', holding({ level: 'highSchool', type: 'HSD' }), 'HS Graduate or equivalent'],
  ])('chooses %s’s own level', (_who, profile, label) => {
    expect(chosen(profile)).toBe(label);
  });
  it('never chooses an attainment short of a degree', () => {
    const shortOf = new Set(['Less than HS Graduate', 'Some college', 'Technical School', 'Some graduate school']);
    for (const level of ['highSchool', 'associate', 'bachelor', 'master'] as const) {
      const label = chosen(holding({ level }));
      expect(label === undefined || !shortOf.has(label), `${level}: ${label}`).toBe(true);
    }
  });
});

describe('R5 (UP7-11): attainments short of a degree, in other lists', () => {
  const entry = golden.education[0]!;
  const highSchool: Profile = { ...golden, education: [{ ...entry, degree: { ...entry.degree, level: 'highSchool',
    type: 'HSD' } }] };
  const chosen = (options: string[], profile: Profile = golden) => {
    const spec = specOf('Highest level of education completed', 'radio', { required: true, optionLabels: options });
    const value = fieldOf(planOf([spec], { profile }), spec).write?.value;
    return value?.kind === 'option' ? value.cleanLabel : undefined;
  };
  it('reads the degree levels of a list where most options are attainments short of one', () => {
    expect(chosen(['Less than HS Graduate', 'Some high school', 'Some college', 'Some college, no degree',
      'Technical School', 'Vocational training', 'Some graduate school', 'Bachelor\'s level degree',
      'Master\'s level degree', 'Doctorate'])).toBe('Bachelor\'s level degree');
  });
  it('never takes "Less than High School" for a high-school graduate, nor some coursework for a degree', () => {
    // "Some Bachelor's" names a level and no field, so only its own words say it is short of the degree.
    const options = ['Less than High School', 'High School Diploma or GED', 'Some Bachelor\'s', 'Bachelor\'s Degree',
      'Master\'s Degree'];
    expect(chosen(options, highSchool)).toBe('High School Diploma or GED');
    expect(chosen(options)).toBe('Bachelor\'s Degree');
  });
});
