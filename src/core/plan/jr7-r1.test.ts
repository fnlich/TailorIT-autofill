/*
 * jr7 RULES-7 (FIX7PLAN §6.3 R1, tag jr7-rules-r1): what the plan writes or asks for each blocker the snapshot7 audits
 * found, with the golden synthetic profile (fixtures/profiles/alex-rivera.*) or variants of it built here. Labels and
 * option labels are the pages' own text (questions and the forms' choices, as the audits quote them); no value of the
 * owner's appears here.
 */
import { describe, expect, it } from 'vitest';
import { namesUnanswerableTopic } from './answers';
import { asksOnlyFollowUp } from './drafts';
import type { FieldSpec, SectionRef } from '../types/field';
import type { Profile } from '../types/profile';
import { fieldOf, goldenProfile, inOrder, NOW, planOf, specOf } from './plan.testkit';
import type { PlanInput } from './types';

const golden = goldenProfile();
const YES_NO = ['Yes', 'No'];
const JOB: SectionRef = { id: 'experience', block: 0 };

/** What the plan writes into one field, and its row. */
const planned = (specs: FieldSpec[], spec: FieldSpec, extra: Partial<PlanInput> = {}) => fieldOf(planOf(specs, extra),
  spec);
/** The option label a write chose, the labels it chose, the text it typed, the ISO date, or the kind of write. */
const written = (write: ReturnType<typeof fieldOf>['write']) => {
  const value = write?.value;
  if (value === undefined) return undefined;
  if (value.kind === 'option') return value.cleanLabel;
  if (value.kind === 'options') return value.cleanLabels;
  if (value.kind === 'text') return value.text;
  if (value.kind === 'date') return value.iso;
  if (value.kind === 'check') return true;
  return value.kind;
};
/** The keys a plan asks a classification, a draft or an answer for. */
const asked = (specs: FieldSpec[], extra: Partial<PlanInput> = {}) => {
  const ask = planOf(specs, extra).ask;
  return { classify: (ask?.classify ?? []).map((item) => item.key), drafts: (ask?.drafts ?? []).map((item) => item.key),
    answers: (ask?.answers ?? []).map((item) => item.key) };
};
const nothingAsked = { classify: [], drafts: [], answers: [] };

describe('WD7-01: Workday’s sponsorship question with five words between the need and the sponsorship', () => {
  const spec = specOf('Will you now, or in the future, require any immigration filing or visa sponsorship by Aristocrat '
    + 'to maintain work authorization (renewal/extension of open work permit, permanent residency, etc.)?', 'combobox', {
    optionLabels: YES_NO, required: true, platform: 'workday' });
  it('answers the golden profile’s sponsorship: No (never the authorization’s Yes)', () => {
    expect(planned([spec], spec)).toMatchObject({ row: { category: 'workAuth.sponsorship' } });
    expect(written(planned([spec], spec).write)).toBe('No');
  });
});

describe('WD7-02 + WD7V-01: Workday’s required notice period, a textarea ending ", if applicable"', () => {
  const consent = specOf('Do you consent to Aristocrat retaining your application data for future roles?', 'radio', {
    optionLabels: YES_NO, required: true, platform: 'workday' });
  const notice = specOf('What is your notice period in weeks, if applicable?', 'textarea', { required: true,
    platform: 'workday', ordinal: 1 });
  it('is its own question, never a follow-up of the one before it', () => {
    expect(asksOnlyFollowUp('What is your notice period in weeks, if applicable?')).toBe(false);
    expect(asksOnlyFollowUp('If applicable, please explain')).toBe(true);
    expect(asksOnlyFollowUp('Please explain, if applicable')).toBe(true);
    expect(asksOnlyFollowUp('Details, if applicable')).toBe(true);
    expect(asksOnlyFollowUp('Do you have a license? If applicable, please explain.')).toBe(false);
  });
  it('is the notice period, asked of the AI for the golden profile (none held)', () => {
    const specs = inOrder([consent, notice]);
    expect(planned(specs, notice).row.category).toBe('availability.noticePeriod');
    expect(asked(specs).answers).toContain(notice.key);
  });
  it('writes a profile notice period where one is held', () => {
    const weeks: Profile = { ...golden, preferences: { ...golden.preferences, startDate: { kind: 'notice', weeks: 2 } } };
    const specs = inOrder([consent, notice]);
    expect(written(planned(specs, notice, { profile: weeks }).write)).toBe('2 weeks');
  });
});

describe('WD7-03: "identification" as a work task is no identifier', () => {
  it.each([
    'Do you have 2 years of experience with problem identification techniques and analyzing reports to support service '
      + 'delivery?',
    'Describe your experience with risk-identification and mitigation',
    'Experience with hazard identification and analysis',
    'Do you have experience with identification of root causes?',
    'Describe your work in the identification of opportunities for improvement',
  ])('asks the AI about %s', (label) => {
    expect(namesUnanswerableTopic(label)).toBe(false);
  });
  it.each([
    'Identification type', 'Type of identification', 'Form of identification', 'Voluntary Self-Identification',
    'Please upload a copy of your identification', 'Identification number', 'Government-issued identification',
    'What form of identification can you provide?',
  ])('never asks the AI about %s', (label) => {
    expect(namesUnanswerableTopic(label)).toBe(true);
  });
  it('asks Workday’s question in the plan', () => {
    const spec = specOf('Do you have 2 years of experience with problem identification techniques and analyzing reports '
      + 'to support service delivery?', 'combobox', { optionLabels: YES_NO, required: true, platform: 'workday' });
    expect(asked([spec]).answers).toContain(spec.key);
  });
});

describe('ICIMS7-05: a current job’s required end date on iCIMS', () => {
  const LABEL = 'End Date (If presently employed put today\'s date)';
  const parts = (label: string, extra: Partial<FieldSpec> = {}) => [
    specOf(`${label} month`, 'select', { section: JOB, ordinal: 0, required: true, platform: 'icims',
      optionLabels: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
        'November', 'December'], ...extra }),
    specOf(`${label} day`, 'select', { section: JOB, ordinal: 1, required: true, platform: 'icims',
      optionLabels: Array.from({ length: 31 }, (_, at) => String(at + 1)), ...extra }),
    specOf(`${label} year`, 'text', { section: JOB, ordinal: 2, required: true, platform: 'icims', ...extra }),
  ];
  it('writes today’s month, day and year where the label says so', () => {
    const specs = inOrder(parts(LABEL));
    const output = planOf(specs);
    expect(specs.map((spec) => written(fieldOf(output, spec).write))).toEqual(['October', String(NOW.d), String(NOW.y)]);
    expect(specs.map((spec) => fieldOf(output, spec).row.reason)).toEqual(['ok', 'ok', 'ok']);
  });
  it('leaves it empty where the label says to leave it blank, or where the block has a currently-here box', () => {
    const blank = inOrder(parts('End Date (Leave blank if current employer)'));
    expect(blank.map((spec) => planned(blank, spec).row.reason)).toEqual(Array(3).fill('end-date-not-applicable'));
    const box = specOf('I currently work here', 'checkbox', { section: JOB, ordinal: 3, platform: 'icims' });
    const withBox = inOrder([...parts('End Date'), box]);
    expect(withBox.slice(0, 3).map((spec) => planned(withBox, spec).write)).toEqual([undefined, undefined, undefined]);
  });
  it('writes today, flagged, where it is required and says neither; leaves an optional one empty', () => {
    const required = inOrder(parts('End Date'));
    const output = planOf(required);
    expect(written(fieldOf(output, required[2]!).write)).toBe(String(NOW.y));
    expect(required.map((spec) => fieldOf(output, spec).row.reason)).toEqual(Array(3).fill('filled-low-confidence'));
    const optional = inOrder(parts('End Date', { required: false }));
    expect(optional.map((spec) => planned(optional, spec).write)).toEqual([undefined, undefined, undefined]);
  });
  it('writes a past job’s own end date as before', () => {
    const past = inOrder(parts(LABEL, { section: { id: 'experience', block: 1 } }));
    expect(written(planned(past, past[2]!).write)).toBe('2021');
  });
});

describe('ICIMS7-06: careers-quartzbenefits’ attestation on a Yes/No dropdown', () => {
  const LABEL = 'I certify that the information provided in this application, is true, complete and correct. I confirm '
    + 'that all statements regarding my skills, qualifications, and experiences, are my own.';
  it.each(['select', 'combobox'] as const)('is the consent on a %s, chosen Yes as a required consent', (kind) => {
    const spec = specOf(LABEL, kind, { optionLabels: YES_NO, required: true, platform: 'icims' });
    const { row, write } = planned([spec], spec);
    expect(row.category).not.toBe('skills.list');
    expect(written(write)).toBe('Yes');
  });
});

describe('ICIMS7-07: careers-quartzbenefits’ willingness to a background check', () => {
  const LABEL = 'Quartz supports a safe, drug-free workplace. All employment offers are contingent upon successful '
    + 'completion of a pre-employment criminal background check. Are you willing to submit to a pre-employment background '
    + 'check if offered a position?';
  it.each(['select', 'combobox'] as const)('is the background-check consent on a %s, chosen Yes', (kind) => {
    const spec = specOf(LABEL, kind, { optionLabels: YES_NO, required: true, platform: 'icims' });
    const { row, write } = planned([spec], spec);
    expect(row.category).toBe('consent.backgroundCheck');
    expect(written(write)).toBe('Yes');
  });
});

describe('ICIMS7-V3: arc-onesolutions’ Desired Salary parts', () => {
  const yearly: Profile = { ...golden, preferences: { ...golden.preferences,
    expectedSalary: { kind: 'value', value: { min: 120_000, currency: 'USD', period: 'year' } } } };
  const hourly: Profile = { ...golden, preferences: { ...golden.preferences,
    expectedSalary: { kind: 'value', value: { min: 70, currency: 'USD', period: 'hour' } } } };
  const currency = specOf('Desired Salary currency', 'select', { optionLabels: ['USD $', 'EUR €', 'GBP £'],
    required: true, platform: 'icims', ordinal: 0 });
  const amount = specOf('Desired Salary amount', 'text', { required: true, platform: 'icims', ordinal: 1 });
  const frame = specOf('Desired Salary time frame', 'select', { optionLabels: ['Hr.', 'Da.', 'Wk.', 'Mo.', 'Yr.'],
    required: true, platform: 'icims', ordinal: 2 });
  const specs = inOrder([currency, amount, frame]);
  it('writes the currency, the amount and the period each as itself', () => {
    const output = planOf(specs, { profile: yearly });
    expect(written(fieldOf(output, currency).write)).toBe('USD $');
    expect(written(fieldOf(output, amount).write)).toBe('120000');
    expect(written(fieldOf(output, frame).write)).toBe('Yr.');
    expect(written(fieldOf(planOf(specs, { profile: hourly }), frame).write)).toBe('Hr.');
  });
  it('never asks the AI for the period, and never chooses Wk. or Da.', () => {
    expect(planned(specs, frame).write).toBeUndefined();
    expect(asked(specs).answers).not.toContain(frame.key);
  });
});

describe('ADP7-3: ADP’s "Have you ever worked for …? If no, type N/A." in a text box', () => {
  const spec = specOf('Have you ever worked for Acme Industrial? If no, type N/A.', 'text', { required: true,
    platform: 'adp' });
  const posting = { company: 'Acme Industrial' };
  it('types our N/A for a no', () => {
    const { write, row } = planned([spec], spec, { posting });
    expect(written(write)).toBe('N/A');
    expect(write?.origin).toMatchObject({ provenance: 'rule', ruleId: 'screening.previously-employed' });
    expect(row.category).toBe('screening.previouslyEmployed');
  });
  it('types "No" where no placeholder is asked for', () => {
    const plain = specOf('Have you ever worked for Acme Industrial?', 'text', { required: true, platform: 'adp' });
    expect(written(planned([plain], plain, { posting }).write)).toBe('No');
  });
  it('leaves a yes to the person, flagged', () => {
    const there: Profile = { ...golden, experience: [{ ...golden.experience[0]!, company: 'Acme Industrial' }] };
    expect(planned([spec], spec, { posting, profile: there })).toMatchObject({ write: undefined,
      row: { status: 'flagged', needsUserAction: true } });
  });
});

describe('ADP7-4: ADP’s multi-select time zone', () => {
  it('chooses the profile’s one zone as a set of one', () => {
    const spec = specOf('What time zone do you live in?', 'multiselect', { required: true, platform: 'adp',
      optionLabels: ['Eastern Time', 'Central Time', 'Mountain Time', 'Pacific Time'] });
    expect(written(planned([spec], spec).write)).toEqual(['Central Time']);
  });
});

describe('UP7-08: UltiPro’s required screening questions', () => {
  it('answers "legally eligible … to begin employment" from the authorization: Yes', () => {
    const spec = specOf('If offered employment by Acme, would you be legally eligible in the United States to begin '
      + 'employment immediately?', 'radio', { optionLabels: YES_NO, required: true, platform: 'ultipro' });
    expect(planned([spec], spec).row.category).toBe('workAuth.authorized');
    expect(written(planned([spec], spec).write)).toBe('Yes');
  });
  it('chooses "I Confirm" for the truthful certification (a required consent)', () => {
    const spec = specOf('I confirm that the information provided within this application is truthful, complete, and '
      + 'accurate.', 'radio', { optionLabels: ['I Confirm', 'No'], required: true, platform: 'ultipro' });
    expect(written(planned([spec], spec).write)).toBe('I Confirm');
  });
  it('leaves the restrictive-agreement textarea to the person when the profile holds no answer', () => {
    const spec = specOf('Are you currently subject to any non-competition, non-solicitation, or other restrictive '
      + 'covenant agreement with a current or former employer?', 'textarea', { required: true, platform: 'ultipro' });
    expect(planned([spec], spec)).toMatchObject({ write: undefined,
      row: { category: 'screening.restrictiveAgreement', reason: 'legal-not-in-profile' } });
  });
});

describe('UKGR-14: UKG Ready’s SSN box', () => {
  const ssn = specOf('999-99-9999', 'text', { nameAttr: 'SSN', constraints: { pattern: '999-99-9999', format: 'tel' },
    labelSource: 'placeholder', platform: 'ukgready' });
  const idType = specOf('Primary National ID', 'select', { optionLabels: ['SSN'], platform: 'ukgready', ordinal: 1 });
  it('is never written, never the phone, never asked of an AI', () => {
    const specs = inOrder([ssn, idType]);
    for (const spec of specs) {
      const { write, row } = planned(specs, spec);
      expect(write, spec.label).toBeUndefined();
      expect(row.category, spec.label).toBe('identity.nationalId');
    }
    expect(asked(specs)).toEqual(nothingAsked);
  });
});

describe('UKGR-13: UKG Ready’s reference editor', () => {
  const REFERENCES: SectionRef = { id: 'professional-references' };
  it('writes none of the person’s own details into a referee’s boxes, and asks no AI', () => {
    const specs = inOrder([
      specOf('First Name', 'text', { section: REFERENCES, platform: 'ukgready', ordinal: 0 }),
      specOf('Last Name', 'text', { section: REFERENCES, platform: 'ukgready', ordinal: 1 }),
      specOf('Company', 'text', { section: REFERENCES, platform: 'ukgready', ordinal: 2 }),
      specOf('Email', 'text', { section: REFERENCES, platform: 'ukgready', ordinal: 3 }),
      specOf('Phone Number', 'text', { section: REFERENCES, platform: 'ukgready', ordinal: 4,
        constraints: { format: 'tel' } }),
    ]);
    const output = planOf(specs);
    expect(output.writes).toEqual([]);
    expect(asked(specs).answers).toEqual([]);
  });
});

describe('J7-GH-1: Greenhouse’s sponsorship question that names Zip', () => {
  it('answers the sponsorship: No', () => {
    const spec = specOf('Do you now or will you in the future require any form of immigration sponsorship or work '
      + 'authorization support from Zip to legally work in the United States (e.g. new visa, transfer, renewal, '
      + 'extension, green card, etc.)?', 'combobox', { optionLabels: YES_NO, required: true, platform: 'greenhouse' });
    expect(written(planned([spec], spec).write)).toBe('No');
  });
});

describe('RBP7-19: Pinpoint’s required source textarea', () => {
  it('writes the profile’s source', () => {
    const spec = specOf('How did you hear about this job?', 'textarea', { required: true, platform: 'pinpoint' });
    expect(written(planned([spec], spec).write)).toBe('LinkedIn');
  });
});

describe('EFA-10: Eightfold’s required self-identification radios', () => {
  it('reads gender and sexual orientation, so the decline is chosen', () => {
    const gender = specOf('Voluntary Self-Identification of Gender', 'radio', { required: true, platform: 'eightfold',
      optionLabels: ['Male', 'Female', 'Gender Nonconforming', 'I don’t wish to answer'] });
    expect(planned([gender], gender).row.category).toBe('eeo.gender');
    expect(written(planned([gender], gender).write)).toBe('I don’t wish to answer');
    const orientation = specOf('Voluntary Self-Identification of Sexual Orientation', 'radio', { required: true,
      platform: 'eightfold', optionLabels: ['Heterosexual', 'Gay', 'Lesbian', 'Bisexual', 'I don’t wish to answer'] });
    expect(planned([orientation], orientation).row.category).toBe('eeo.sexualOrientation');
  });
  it('ticks the "Acknowledge" box whose legend names AI only in a run that used no AI', () => {
    const box = specOf('Acknowledge', 'checkbox', { required: true, platform: 'eightfold', description: 'By checking this '
      + 'box, I confirm I have read, reviewed and understood the guidelines outlined in the Candidate AI Responsible Use '
      + 'Policy. I affirm that all the information and materials I submit throughout my application and candidacy will '
      + 'reflect my own work and experience.' });
    // Its own "my own work" attestation makes the frame profile-only (the owner's decision of 2026-11-01): true, ticked.
    expect(planned([box], box)).toMatchObject({ write: { origin: { ruleId: 'consent.no-ai-attestation' } },
      row: { category: 'consent.aiAttestation' } });
    // A run that already used AI for this application never ticks it (a false statement).
    expect(planned([box], box, { aiUsed: true }).write).toBeUndefined();
  });
});

describe('DF7-04: Dayforce’s required native Start Dates', () => {
  const SCHOOL: SectionRef = { id: 'education-history', block: 0 };
  it('writes the month’s first day, flagged as a guess', () => {
    const spec = specOf('Start Date', 'date', { section: SCHOOL, required: true, platform: 'dayforce',
      constraints: { format: 'date' } });
    expect(planned([spec], spec)).toMatchObject({ row: { reason: 'filled-low-confidence' } });
    expect(written(planned([spec], spec).write)).toBe('2015-08-01');
  });
  it('never writes a current job’s end date that way', () => {
    const spec = specOf('End Date', 'date', { section: { id: 'employment-history', block: 0 }, platform: 'dayforce',
      constraints: { format: 'date' } });
    expect(planned([spec], spec).write).toBeUndefined();
  });
});

describe('DF7-V3: Dayforce’s candidate acknowledgement in its Submit step', () => {
  it('is the application’s terms, ticked as the Consents mode pre-approves', () => {
    const spec = specOf('I agree to the Candidate Acknowledgement', 'checkbox', { platform: 'dayforce' });
    expect(planned([spec], spec).row.category).toBe('consent.terms');
    expect(written(planned([spec], spec).write)).toBe(true);
  });
});
