/*
 * jr7 RULES-7 (FIX7PLAN §6.3 R2, tag jr7-rules-r2): what the plan writes or asks for the rest of the snapshot7 audits'
 * findings, and the defaults of the three owner-gated items (§9: Q7-3, Q7-4, jr6 Q8), with the golden synthetic profile
 * (fixtures/profiles/alex-rivera.*) or variants of it built here. Labels and option labels are the pages' own text; no
 * value of the owner's appears here.
 */
import { describe, expect, it } from 'vitest';
import type { FieldSpec, SectionRef } from '../types/field';
import type { Profile } from '../types/profile';
import { fieldOf, goldenProfile, inOrder, planOf, specOf } from './plan.testkit';
import type { PlanInput } from './types';

const golden = goldenProfile();
const YES_NO = ['Yes', 'No'];
const JOB_EDITOR: SectionRef = { id: 'experience' };
const DAYFORCE_JOB: SectionRef = { id: 'employment-history', block: 0 };
const DAYFORCE_SCHOOL: SectionRef = { id: 'education-history', block: 0 };

const planned = (specs: FieldSpec[], spec: FieldSpec, extra: Partial<PlanInput> = {}) => fieldOf(planOf(specs, extra),
  spec);
const written = (write: ReturnType<typeof fieldOf>['write']) => {
  const value = write?.value;
  if (value === undefined) return undefined;
  if (value.kind === 'option') return value.cleanLabel;
  if (value.kind === 'options') return value.cleanLabels;
  if (value.kind === 'text') return value.text;
  if (value.kind === 'date') return value.iso;
  return value.kind;
};
const asked = (specs: FieldSpec[], extra: Partial<PlanInput> = {}) => {
  const ask = planOf(specs, extra).ask;
  return { classify: (ask?.classify ?? []).map((item) => item.key), drafts: (ask?.drafts ?? []).map((item) => item.key),
    answers: (ask?.answers ?? []).map((item) => item.key) };
};
const nothingAsked = { classify: [], drafts: [], answers: [] };

describe('WD7-09, WD7-10, WD7-12: Workday’s questions read by rule', () => {
  it('answers right/entitlement Yes, a previous Unity employee No, and asks the start of the AI', () => {
    const right = specOf('Do you currently have the right/entitlement to work in the country where the job is located?',
      'combobox', { optionLabels: YES_NO, required: true, platform: 'workday' });
    expect(written(planned([right], right, { posting: { location: 'Las Vegas, NV, USA' } }).write)).toBe('Yes');
    const unity = specOf('Please select if you were a previous Unity employee.', 'radio', { optionLabels: YES_NO,
      required: true, platform: 'workday' });
    expect(written(planned([unity], unity, { posting: { company: 'Unity' } }).write)).toBe('No');
    const begin = specOf('If hired, when can you begin work?', 'date', { platform: 'workday' });
    expect(planned([begin], begin).row.category).toBe('availability.startDate');
    expect(asked([begin]).answers).toContain(begin.key);
  });
});

describe('WD7-11: the military box gets no skills', () => {
  it('writes nothing into "Please list any job related military experience or skills"', () => {
    const spec = specOf('Please list any job related military experience or skills', 'textarea', { platform: 'workday' });
    expect(planned([spec], spec).write).toBeUndefined();
  });
});

describe('WD7V-02: the preferred language for written communications', () => {
  it('chooses the native language', () => {
    const spec = specOf('What is your preferred language for written communications?', 'combobox', { required: true,
      platform: 'workday', optionLabels: ['English', 'French', 'Spanish'] });
    expect(written(planned([spec], spec).write)).toBe('English');
  });
});

describe('ICIMS7-08 + DF7-11 + jr7-O4: duties and responsibilities from the entry', () => {
  it.each<[string, SectionRef]>([['Duties', { id: 'experience', block: 0 }], ['Duties and Responsibilities', DAYFORCE_JOB],
    ['Responsibilities', JOB_EDITOR]])('writes the entry’s description into "%s", asking no AI', (label, section) => {
    const spec = specOf(label, 'textarea', { section, required: true });
    expect(written(planned([spec], spec).write)).toBe(golden.experience[0]!.description);
    expect(asked([spec])).toEqual(nothingAsked);
  });
});

describe('ICIMS7-13: an Other that excludes the source', () => {
  it('never chooses "Other (Non Internet)" for an internet source', () => {
    const spec = specOf('How did you hear about us?', 'select', { platform: 'icims',
      optionLabels: ['Employee Referral', 'Newspaper', 'Career Fair', 'Other (Non Internet)'] });
    expect(written(planned([spec], spec).write)).not.toBe('Other (Non Internet)');
  });
  it('still chooses a plain "Other" with the source as its text', () => {
    const spec = specOf('How did you hear about us?', 'select', { platform: 'icims',
      optionLabels: ['Employee Referral', 'Newspaper', 'Other'] });
    expect(planned([spec], spec).write?.value).toMatchObject({ cleanLabel: 'Other', freeText: 'LinkedIn' });
  });
});

describe('ICIMS7-14: arc-onesolutions’ optional extras', () => {
  it('skips the licence boxes and the Other School beside a listed school, asking no AI', () => {
    const SCHOOL: SectionRef = { id: 'education', block: 0 };
    const list = specOf('School', 'combobox', { section: SCHOOL, ordinal: 0,
      optionLabels: ['Rice University', 'The University of Texas at Austin', 'Other'] });
    const other = specOf('Other School', 'text', { section: SCHOOL, ordinal: 1 });
    const name = specOf('License/Certification Name/Type', 'text', { ordinal: 2 });
    const number = specOf('License/Certification Number', 'text', { ordinal: 3 });
    const state = specOf('License/Certification State', 'typeahead-remote', { ordinal: 4 });
    const specs = inOrder([list, other, name, number, state]);
    const output = planOf(specs);
    for (const spec of [other, name, number, state]) expect(fieldOf(output, spec).write, spec.label).toBeUndefined();
    expect(asked(specs)).toEqual(nothingAsked);
  });
});

describe('ICIMS7-V4 (rules half): the IForm date parts beside a signature', () => {
  it('reads "Today’s Date" month, day and year as the signature’s date, today', () => {
    const parts = inOrder([
      specOf('Today\'s Date month', 'select', { ordinal: 0, platform: 'icims', required: true,
        optionLabels: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
          'November', 'December'] }),
      specOf('Today\'s Date day', 'select', { ordinal: 1, platform: 'icims', required: true,
        optionLabels: Array.from({ length: 31 }, (_, at) => String(at + 1)) }),
      specOf('Today\'s Date year', 'text', { ordinal: 2, platform: 'icims', required: true }),
    ]);
    const output = planOf(parts);
    expect(parts.map((spec) => fieldOf(output, spec).row.category)).toEqual(Array(3).fill('consent.signatureDate'));
    expect(parts.map((spec) => written(fieldOf(output, spec).write))).toEqual(['October', '30', '2026']);
  });
});

describe('ADP7-8 + ADP7-9: ADP’s pay rate and related experience', () => {
  const rate = specOf('What is the minimum hourly rate you would consider for this position?', 'text', { required: true,
    platform: 'adp' });
  it('writes an hourly profile figure, never converts a yearly one (the `all` scope asks the AI)', () => {
    const hourly: Profile = { ...golden, preferences: { ...golden.preferences,
      expectedSalary: { kind: 'value', value: { min: 70, currency: 'USD', period: 'hour' } } } };
    expect(written(planned([rate], rate, { profile: hourly }).write)).toBe('70');
    const yearly: Profile = { ...golden, preferences: { ...golden.preferences,
      expectedSalary: { kind: 'value', value: { min: 120_000, currency: 'USD', period: 'year' } } } };
    expect(planned([rate], rate, { profile: yearly }).write).toBeUndefined();
    expect(asked([rate], { profile: yearly }).answers).toContain(rate.key);
  });
  it('answers related experience from the entries', () => {
    const years = specOf('How many years of related experience do you have?', 'text', { platform: 'adp' });
    expect(planned([years], years).row.category).toBe('experience.totalYears');
    expect(written(planned([years], years).write)).toBeDefined();
  });
});

describe('jr7-O6: Oracle’s lone "Hispanic or Latino" box', () => {
  const box = specOf('Hispanic or Latino', 'checkbox', { platform: 'oracle', section: { id: 'ethnicity' } });
  it('reads already correct (unticked) for a decline, and is ticked for an explicit yes', () => {
    expect(planned([box], box).row).toMatchObject({ category: 'eeo.hispanicLatino' });
    expect(planned([box], box).row.reason).not.toBe('format-unsupported');
    expect(planned([box], box).write?.value).not.toMatchObject({ kind: 'check', checked: true });
    const yes: Profile = { ...golden, eeo: { ...golden.eeo, hispanicLatino: { kind: 'value', value: true } } };
    expect(planned([box], box, { profile: yes }).write).toMatchObject({ value: { kind: 'check' } });
  });
});

describe('UP7-11: UltiPro’s "<degree>’s level degree" radios', () => {
  it('chooses the bachelor’s level', () => {
    const spec = specOf('Please select the highest level of education you have attained.', 'radio', { required: true,
      platform: 'ultipro', optionLabels: ['High school diploma or equivalent', 'Associate\'s level degree',
        'Bachelor\'s level degree', 'Master\'s level degree', 'Doctorate level degree'] });
    expect(written(planned([spec], spec).write)).toBe('Bachelor\'s level degree');
  });
});

describe('UKGR-15 + UKGR-16: UKG Ready’s editors and labels', () => {
  it('writes the title and ticks Present for the current job, the street, and the eligibility box', () => {
    const title = specOf('Job title #1', 'text', { section: JOB_EDITOR, platform: 'ukgready', ordinal: 0 });
    const present = specOf('Present', 'checkbox', { section: JOB_EDITOR, platform: 'ukgready', ordinal: 1 });
    expect(written(planned(inOrder([title, present]), title).write)).toBe(golden.experience[0]!.title);
    expect(written(planned(inOrder([title, present]), present).write)).toBe('check');
    const eligible = specOf('Eligible For Work in the USA', 'checkbox', { required: true, platform: 'ukgready' });
    expect(written(planned([eligible], eligible, { posting: { location: 'Austin, TX, USA' } }).write)).toBe('check');
    const referral = specOf('Referral', 'select', { platform: 'ukgready', optionLabels: ['LinkedIn', 'Indeed', 'Other'] });
    expect(written(planned([referral], referral).write)).toBe('LinkedIn');
  });
});

describe('UKGR-18 + UKGR-V2: UKG Ready’s typed signature', () => {
  const sign = (description: string) => specOf('Full name to confirm', 'text', { required: true, platform: 'ukgready',
    description });
  it('types the first and last name where the prompt shows the name, else the full name, as a signature', () => {
    const middle: Profile = { ...golden, identity: { ...golden.identity, fullName: 'Alex J. Rivera', middleName: 'J.' } };
    const shows = sign('Please type your full name to confirm: Alex Rivera');
    expect(planned([shows], shows, { profile: middle })).toMatchObject({ row: { category: 'consent.signature' } });
    expect(written(planned([shows], shows, { profile: middle }).write)).toBe('Alex Rivera');
    const plain = sign('');
    expect(written(planned([plain], plain, { profile: middle }).write)).toBe('Alex J. Rivera');
  });
});

describe('RBP7-07: Rippling’s typed-name attestation', () => {
  it('types the name as the signature, read from its help text', () => {
    const spec = specOf('Truth Certification/Attestation Clause', 'text', { required: true, platform: 'rippling',
      description: 'All information I have provided is true. Please acknowledge this by typing your full name in the '
        + 'text field.' });
    expect(written(planned([spec], spec).write)).toBe(golden.identity.fullName);
  });
});

describe('RBP7-08: the residence in listed states', () => {
  const ask = (states: string) => specOf(`Acme can only hire candidates with a primary residence in the following States: `
    + `${states}`, 'combobox', { optionLabels: YES_NO, required: true, platform: 'rippling' });
  it('answers Yes where the profile’s state is listed, No where another state of the country is', () => {
    const listed = ask('AZ, CA, CO, TX, WA');
    expect(written(planned([listed], listed).write)).toBe('Yes');
    const unlisted = ask('AZ, CA, CO, WA');
    expect(written(planned([unlisted], unlisted).write)).toBe('No');
  });
});

describe('RBP7-15 + J7-GH-2: BambooHR’s Date Available, Greenhouse’s US state', () => {
  it('lays a profile start date out by the placeholder, and chooses the state', () => {
    const start: Profile = { ...golden, preferences: { ...golden.preferences,
      startDate: { kind: 'date', date: { y: 2026, m: 12, d: 1 } } } };
    const date = specOf('Date Available', 'text', { platform: 'bamboohr', constraints: { pattern: 'mm/dd/yyyy',
      format: 'date' } });
    expect(written(planned([date], date, { profile: start }).write)).toBe('12/01/2026');
    const state = specOf('What US state do you reside in?', 'select', { platform: 'greenhouse', required: true,
      optionLabels: ['California', 'Ohio', 'Texas'] });
    expect(written(planned([state], state).write)).toBe('Texas');
  });
});

describe('DF7-11: Dayforce’s records', () => {
  it('ticks Not Completed only for a school still in progress, and leaves the extras empty, asking no AI', () => {
    const notDone = specOf('Not Completed', 'checkbox', { section: DAYFORCE_SCHOOL, platform: 'dayforce' });
    expect(planned([notDone], notDone).write).toBeUndefined();
    const studying: Profile = { ...golden, education: [{ ...golden.education[0]!, inProgress: true,
      endDate: { y: 2027, m: 5 } }] };
    expect(written(planned([notDone], notDone, { profile: studying }).write)).toBe('check');
    const ended: Profile = { ...golden, education: [{ ...golden.education[0]!, inProgress: true }] };
    expect(planned([notDone], notDone, { profile: ended }).write).toBeUndefined();
    const extras = inOrder([
      specOf('Division / Dept.', 'text', { section: DAYFORCE_JOB, platform: 'dayforce', ordinal: 0 }),
      specOf('Supervisor', 'text', { section: DAYFORCE_JOB, platform: 'dayforce', ordinal: 1 }),
      specOf('Reason For Leaving?', 'text', { section: DAYFORCE_JOB, platform: 'dayforce', ordinal: 2 }),
    ]);
    const output = planOf(extras);
    expect(output.writes).toEqual([]);
    expect(asked(extras)).toEqual(nothingAsked);
  });
});

describe('the jr6 leftover: a school list’s Other beside its companion box', () => {
  it('chooses Other with no free text of its own; the box takes the school', () => {
    const SCHOOL: SectionRef = { id: 'education', block: 0 };
    const list = specOf('School', 'combobox', { section: SCHOOL, ordinal: 0, platform: 'icims',
      optionLabels: ['Rice University', 'Baylor University', 'Other'] });
    const box = specOf('Enter school name if not in the list above', 'text', { section: SCHOOL, ordinal: 1,
      platform: 'icims' });
    const specs = inOrder([list, box]);
    const output = planOf(specs);
    expect(fieldOf(output, list).write?.value).toEqual({ kind: 'option', index: 2, cleanLabel: 'Other' });
    expect(fieldOf(output, list).write?.match).not.toHaveProperty('freeText');
    expect(fieldOf(output, list).row.reason).not.toBe('other-without-free-text');
    expect(written(fieldOf(output, box).write)).toBe('The University of Texas at Austin');
    // A list with no companion box keeps the school as its Other's free text.
    const alone = planOf([list]);
    expect(fieldOf(alone, list).write?.value).toMatchObject({ cleanLabel: 'Other',
      freeText: 'The University of Texas at Austin' });
  });
});

describe('the owner-gated items, held to their defaults (§9; the owner accepted every default on 2026-11-11)', () => {
  it('WD7-07 (Q7-3, default yours): unity’s export-control citizenship is the person’s, never written nor asked', () => {
    const spec = specOf('For the purpose of determining if an export control license may be required, are you currently '
      + 'a citizen or permanent resident of any of the following countries/regions? If you are not, please select "Not '
      + 'Applicable."', 'combobox', { required: true, platform: 'workday',
      optionLabels: ['Cuba', 'Iran', 'North Korea', 'Syria', 'Not Applicable'] });
    expect(planned([spec], spec)).toMatchObject({ write: undefined, row: { needsUserAction: true } });
    expect(asked([spec])).toEqual(nothingAsked);
  });
  it('WD7-08 (Q7-4, default yours): an employer’s own AI-use consent is never answered nor asked', () => {
    const spec = specOf('Do you consent to the use of AI to create written transcripts and summaries of your interviews?',
      'combobox', { required: true, platform: 'workday', optionLabels: YES_NO });
    expect(planned([spec], spec).write).toBeUndefined();
    expect(asked([spec]).answers).toEqual([]);
  });
  it('ADP7-6 (jr6 Q8, default the profile’s currency only): a required currency list is left without one', () => {
    // ADP's list holds 158 rows, more than an AI answer takes (ANSWER_MAX_OPTIONS): 40 stand for them here.
    const spec = specOf('Select currency type', 'combobox', { required: true, platform: 'adp',
      optionLabels: ['Euro Member Countries ( EUR )', 'United States Dollar ( USD )', 'Canada Dollar ( CAD )',
        ...Array.from({ length: 37 }, (_, at) => `Currency ${at + 1} ( C${String(at).padStart(2, '0')} )`)] });
    expect(planned([spec], spec).write).toBeUndefined();
    expect(asked([spec]).answers).toEqual([]);
    const euro: Profile = { ...golden, preferences: { ...golden.preferences,
      expectedSalary: { kind: 'value', value: { min: 90_000, currency: 'EUR', period: 'year' } } } };
    expect(written(planned([spec], spec, { profile: euro }).write)).toBe('Euro Member Countries ( EUR )');
  });
});
