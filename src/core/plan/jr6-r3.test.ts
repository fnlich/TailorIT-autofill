/*
 * jr6 RULES (FIXPLAN §6.3 R3, items 35 to 48): what the plan writes for each audit's field, with the golden synthetic
 * profile (fixtures/profiles/alex-rivera.*) or variants of it built here. Labels and option labels are the pages' own
 * text (questions and the forms' choices, as the audits quote them); no value of the owner's appears here.
 */
import { describe, expect, it } from 'vitest';
import { screenForClassify } from '../resolver/classify';
import { DEFAULT_SETTINGS } from '../types/settings';
import type { FieldSpec } from '../types/field';
import type { Profile } from '../types/profile';
import { CAUTIOUS_SETTINGS, fieldOf, goldenProfile, inOrder, planOf, specOf, vocab } from './plan.testkit';
import { signatureLast } from './order';
import type { PlanInput } from './types';

const golden = goldenProfile();
const YES_NO = ['Yes', 'No'];

/** What the plan writes into one field, and its row. */
const planned = (specs: FieldSpec[], spec: FieldSpec, extra: Partial<PlanInput> = {}) => fieldOf(planOf(specs, extra),
  spec);
/** The option label a write chose, the labels it chose, or the text it typed. */
const written = (write: ReturnType<typeof fieldOf>['write']) => {
  const value = write?.value;
  if (value === undefined) return undefined;
  if (value.kind === 'option') return value.cleanLabel;
  if (value.kind === 'options') return value.cleanLabels;
  if (value.kind === 'text') return value.text;
  return value.kind;
};
/** The golden profile with these screening answers. */
const screening = (answers: Partial<Profile['screening']>): Profile => ({ ...golden,
  screening: { ...golden.screening, ...answers } });
/** The golden profile living in another state. */
const livingIn = (code: string): Profile => ({ ...golden, address: { ...golden.address, region: { code, name: code } } });
/** The golden profile with one more employer. */
const workedAt = (company: string): Profile => ({ ...golden, experience: [...golden.experience,
  { company, title: 'Analyst', current: false, startDate: { y: 2017, m: 1 }, endDate: { y: 2018, m: 12 } }] });
/** The `all` and standard scopes' asks of a plan, by scope. */
const scopes = (specs: FieldSpec[], extra: Partial<PlanInput> = {}) => (planOf(specs, extra).ask?.answers ?? [])
  .map((item) => item.scope);

describe('35 (WD-11): Workday’s gender and veteran questions take the profile’s answers', () => {
  it('declines the gender (the golden profile declines it) and answers the veteran questions', () => {
    const gender = specOf('Please select a gender.', 'combobox', { optionLabels: ['Male', 'Female',
      'I do not wish to answer'], required: true });
    expect(written(planned([gender], gender).write)).toBe('I do not wish to answer');
    const veterans = ['I identify as one or more of the classifications of protected veterans',
      'I am not a protected veteran', 'I do not wish to self-identify'];
    for (const label of ['Veterans Status', 'If you believe you belong to any of the categories of protected veterans '
      + 'listed below, please indicate by checking the appropriate box below.']) {
      const spec = specOf(label, 'combobox', { optionLabels: veterans, required: true });
      expect(written(planned([spec], spec).write), label).toBe('I am not a protected veteran');
    }
  });
});

describe('36 (WD-12): the age of majority is the over-18 answer', () => {
  it('answers Yes for the golden profile', () => {
    const spec = specOf('Are you at least the age of majority under applicable law (i.e., age 18 in most states, but age '
      + '19 in Alabama and Nebraska) and have the right to contract in your own name?', 'radio', { optionLabels: YES_NO,
      required: true });
    expect(planned([spec], spec).write).toMatchObject({ value: { cleanLabel: 'Yes' },
      origin: { provenance: 'profile', path: 'screening.over18' } });
  });
});

describe('37 (WD-14): an agreement in place that would limit the role is a restrictive agreement', () => {
  const spec = specOf('Do you have an agreement in place with a current or former employer that would prevent or limit '
    + 'your ability to do this role at Genworth?', 'radio', { optionLabels: YES_NO, required: true });
  it('answers the profile’s No, and asks the `all` scope where the profile says nothing', () => {
    expect(written(planned([spec], spec, { profile: screening({ restrictiveAgreement: { kind: 'value',
      value: false } }) }).write)).toBe('No');
    expect(scopes([spec])).toEqual(['all']);
  });
});

describe('38 (WD-15): a familial or personal relationship with an employee is a relative there', () => {
  const spec = specOf('Do you have a familial or personal relationship with any current Genworth employee (Relatives '
    + 'include spouse, parent, child, sibling)?', 'radio', { optionLabels: YES_NO, required: true });
  const posting = { company: 'Genworth' };
  it('answers from the companies where a relative works', () => {
    expect(written(planned([spec], spec, { posting, profile: screening({ relativesAt: { kind: 'value', value: [] } })
    }).write)).toBe('No');
    expect(written(planned([spec], spec, { posting, profile: screening({ relativesAt: { kind: 'value',
      value: ['Genworth'] } }) }).write)).toBe('Yes');
    // The golden profile names no such company: the question names a spouse and a parent too, so no AI is asked.
    expect(scopes([spec], { posting })).toEqual([]);
  });
  it('leaves a close friend’s question unclassified (owner Q14)', () => {
    const friend = specOf('Are you a relative or close friend of a Parsons employee?', 'radio', { optionLabels: YES_NO });
    expect(planned([friend], friend, { posting: { company: 'Parsons' }, profile: screening({ relativesAt: {
      kind: 'value', value: [] } }) }).write).toBeUndefined();
  });
});

describe('39 (WD-16, JV-12): the company by its initials', () => {
  it('answers No from the profile’s employers for RTS and VHL, and Yes for a former employee', () => {
    const rts = specOf('Have you previously been employed by RTS? CURRENT EMPLOYEES: Please reach out to your '
      + 'Recruiting Manager to discuss your options.', 'radio', { optionLabels: YES_NO, required: true });
    const posting = { company: 'Resolve Tech Solutions' };
    expect(planned([rts], rts, { posting })).toMatchObject({ write: { value: { cleanLabel: 'No' },
      origin: { provenance: 'rule', ruleId: 'screening.previously-employed' } }, row: { status: 'verified' } });
    expect(written(planned([rts], rts, { posting, profile: workedAt('Resolve Tech Solutions, Inc.') }).write))
      .toBe('Yes');
    const vhl = specOf('Have you worked for VHL in any capacity previously?', 'select', { optionLabels: [
      'Select an option...', 'Yes, Employee / Freelancer / Contractor / Intern / Temp', 'No'], required: true });
    expect(written(planned([vhl], vhl, { posting: { company: 'Vista Higher Learning' } }).write)).toBe('No');
  });
  it('never reads lower-case letters, or two-word initials, as the company', () => {
    const lower = specOf('Have you previously been employed by rts?', 'radio', { optionLabels: YES_NO });
    expect(planned([lower], lower, { posting: { company: 'Resolve Tech Solutions' } }).write).toBeUndefined();
  });
});

describe('40 (WD-17): a contractor at the company, and another company the question names', () => {
  it('answers the AEP contractor question from the employers', () => {
    const spec = specOf('Are you now or have you ever been a contractor at AEP?', 'combobox', { optionLabels: YES_NO });
    expect(written(planned([spec], spec, { posting: { company: 'American Electric Power' } }).write)).toBe('No');
  });
  it('answers another named company Yes only for an entry of it, flagged for review', () => {
    const spec = specOf('Have you previously worked for KPMG?', 'radio', { optionLabels: YES_NO });
    const posting = { company: 'Genworth' };
    expect(planned([spec], spec, { posting })).toMatchObject({ write: { value: { cleanLabel: 'No' } },
      row: { reason: 'filled-low-confidence' } });
    expect(written(planned([spec], spec, { posting, profile: workedAt('KPMG LLP') }).write)).toBe('Yes');
  });
  it('leaves a question that asks of a spouse too, and never sends it to an AI', () => {
    const spec = specOf('Have you or your spouse previously worked for KPMG?', 'radio', { optionLabels: YES_NO,
      required: true });
    const out = planOf([spec], { posting: { company: 'KPMG' } });
    expect(fieldOf(out, spec).write).toBeUndefined();
    expect(out.ask?.answers ?? []).toEqual([]);
  });
  it('leaves a company with its subsidiaries, and several companies, to the AI', () => {
    for (const label of ['Have you previously been employed by HJF or any of our subsidiaries or affiliates?',
      'Have you worked for Google, Meta or Amazon?']) {
      const spec = specOf(label, 'radio', { optionLabels: YES_NO });
      expect(planned([spec], spec, { posting: { company: 'Acme' } }).write, label).toBeUndefined();
    }
  });
});

describe('41 (WD-29): military training related to the position', () => {
  const spec = specOf('Do you have military training or a military certification related to this position?',
    'combobox', { optionLabels: YES_NO, required: true });
  it('answers No for no military service and no veteran status, both explicit', () => {
    expect(planned([spec], spec, { profile: screening({ governmentService: { kind: 'value',
      value: { military: false, government: false } } }) }).write).toMatchObject({ value: { cleanLabel: 'No' },
      origin: { provenance: 'profile', path: 'screening.governmentService', transform: 'legal.military-training' } });
  });
  it('leaves a veteran’s, and the golden profile’s (no service answer), to the `all` scope', () => {
    expect(planned([spec], spec, { profile: screening({ governmentService: { kind: 'value',
      value: { military: true, government: false } } }) }).write).toBeUndefined();
    expect(scopes([spec])).toEqual(['all']);
  });
});

describe('42, 43 (ICIMS-12, ICIMS-13): iCIMS’s phone and address types', () => {
  it('chooses Mobile for the phone and Home for the address', () => {
    const phone = specOf('Type', 'select', { optionLabels: ['Home', 'Mobile', 'Work', 'Email Backup', 'Other'],
      nameAttr: '-1_PersonProfileFields.PhoneType', required: true });
    expect(written(planned([phone], phone).write)).toBe('Mobile');
    const address = specOf('Type', 'select', { optionLabels: ['Work', 'Home', 'Other'],
      nameAttr: '-1_PersonProfileFields.AddressType', required: true, ordinal: 1 });
    expect(planned([address], address).write).toMatchObject({ value: { cleanLabel: 'Home' },
      origin: { provenance: 'rule', ruleId: 'address.type-home', path: 'address' } });
  });
  it('keeps a type the page already shows', () => {
    const shown = specOf('Type', 'combobox', { optionLabels: ['Work', 'Home', 'Other'],
      nameAttr: '-1_PersonProfileFields.AddressType', current: { kind: 'selected', labels: ['Work'] } });
    expect(planned([shown], shown)).toMatchObject({ write: undefined, row: { reason: 'prefill-kept' } });
  });
});

describe('44 (ICIMS-15): the IForm Signature box', () => {
  const box = specOf('Signature', 'checkbox', { idAttr: 'icims_f_signature', required: true });
  it('is ticked as any consent box: approved under All, required under Required only', () => {
    expect(planned([box], box).write).toMatchObject({ value: { kind: 'check' },
      origin: { provenance: 'rule', ruleId: 'consent.signature-preapproved' } });
    expect(planned([box], box, { settings: CAUTIOUS_SETTINGS }).write).toMatchObject({ value: { kind: 'check' },
      origin: { ruleId: 'consent.required' } });
    const optional = specOf('Signature', 'checkbox', { idAttr: 'icims_f_signature' });
    expect(planned([optional], optional, { settings: CAUTIOUS_SETTINGS })).toMatchObject({ write: undefined,
      row: { reason: 'consent-optional-unticked' } });
  });
  it('keeps the stricter rules of an AI attestation beside it', () => {
    const attested = specOf('Signature: I did not use AI to write any part of this application', 'checkbox', {
      required: true });
    // A run that used AI before cannot tick it; one that used none (the frame is profile-only) ticks the attestation's
    // own rule, never the signature's.
    expect(planned([attested], attested, { aiUsed: true }).write).toBeUndefined();
    expect(planned([attested], attested).write).toMatchObject({ origin: { ruleId: 'consent.no-ai-attestation' } });
  });
  it('is written last in the pass', () => {
    const queue = [
      { write: { value: { kind: 'check' as const } }, planned: { category: 'consent.signature' }, id: 'sign' },
      { write: { value: { kind: 'text' as const, text: 'x' } }, planned: { category: 'contact.email' }, id: 'mail' },
      { write: { value: { kind: 'check' as const } }, planned: { category: 'consent.privacy' }, id: 'privacy' },
    ];
    expect(signatureLast(queue).map((item) => item.id)).toEqual(['mail', 'privacy', 'sign']);
  });
});

describe('45 (ICIMS-19): “Please specify” after “How did you hear about us?”', () => {
  const source = specOf('How did you hear about us?', 'select', { optionLabels: ['Job Board', 'Company Website',
    'Other'], required: true });
  it('takes the profile’s source among the list’s boards, else its Other', () => {
    const detail = specOf('Please specify', 'select', { optionLabels: ['', 'GoogleJobs', 'Indeed', 'LinkedIn',
      'Salary.com'], required: true, ordinal: 1 });
    const out = planOf(inOrder([source, detail]));
    expect(fieldOf(out, detail)).toMatchObject({ write: { value: { cleanLabel: 'LinkedIn' },
      origin: { provenance: 'profile', path: 'referralSource' } }, row: { category: 'referral.detail' } });
    const other = specOf('Please specify further', 'select', { optionLabels: ['Indeed', 'Monster', 'Other'],
      required: true, ordinal: 1 });
    expect(fieldOf(planOf(inOrder([source, other])), other).write).toMatchObject({ value: { cleanLabel: 'Other' } });
  });
  it('reads it so by iCIMS’s id alone, and screens a site’s name as a name', () => {
    const byId = specOf('Please specify', 'select', { optionLabels: ['Indeed', 'LinkedIn'], idAttr: 'rcf3049' });
    expect(written(planned([byId], byId).write)).toBe('LinkedIn');
    const boards = specOf('Please specify', 'select', { optionLabels: ['Indeed', 'Salary.com', 'Talent.com'] });
    expect(screenForClassify(boards, vocab)).toBeNull();
    expect(screenForClassify(specOf('Please specify', 'select', { optionLabels: ['Indeed', 'Salary'] }), vocab))
      .toBe('sensitive');
  });
  it('leaves a “Please specify” after any other question as before', () => {
    const before = specOf('What is your favourite colour?', 'select', { optionLabels: ['Red', 'Blue'] });
    const detail = specOf('Please specify', 'select', { optionLabels: ['Indeed', 'LinkedIn'], ordinal: 1 });
    expect(fieldOf(planOf(inOrder([before, detail])), detail).write).toBeUndefined();
  });
});

describe('46 (ICIMS-20): NYU’s “How did you hear about us?” falls to Other', () => {
  const spec = specOf('How did you hear about us?', 'select', { optionLabels: ['uscareers', 'Job Fair', 'NYU Alumni',
    'Other', 'USA Job Portal'], required: true });
  it('chooses the list’s Other (with the source’s name for its box) rather than asking a tiebreak', () => {
    const out = planOf([spec]);
    expect(fieldOf(out, spec).write).toMatchObject({ value: { cleanLabel: 'Other', freeText: 'LinkedIn' } });
    expect(out.ask?.tiebreaks ?? []).toEqual([]);
  });
  it('asks the tiebreak as before when the person leaves a list with no match empty', () => {
    const leave = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, noMatch: 'leave' as const } };
    const out = planOf([spec], { settings: leave });
    expect(fieldOf(out, spec).write).toBeUndefined();
    expect(out.ask?.tiebreaks?.length).toBe(1);
  });
});

describe('47 (ICIMS-21, JV-8, JZ-9): the state the person lives in', () => {
  const codes = (more: string[]) => specOf('In which state do you currently live?', 'select', { optionLabels: [
    'Select an option...', ...more, 'none of these'], required: true });
  it('chooses the profile’s state by its code, else the list’s “none of these”', () => {
    expect(written(planned([codes(['CA', 'TN', 'TX', 'WA'])], codes(['CA', 'TN', 'TX', 'WA'])).write)).toBe('TX');
    expect(written(planned([codes(['CA', 'TN', 'WA'])], codes(['CA', 'TN', 'WA'])).write)).toBe('none of these');
  });
  it('reads the state one will work from as the one lived in, flagged', () => {
    const spec = specOf('From which state will you be working?', 'select', { optionLabels: ['-- No answer --', 'Alabama',
      'Texas', 'Wyoming'], required: true });
    expect(planned([spec], spec)).toMatchObject({ write: { value: { cleanLabel: 'Texas' } },
      row: { reason: 'filled-low-confidence' } });
  });
});

describe('48 (ICIMS-26, JV-16): time zones, years in something, experience with something', () => {
  it('gives the state’s time zone, flagged for a state in two zones', () => {
    const spec = specOf('Time Zone', 'select', { optionLabels: ['Eastern', 'Central', 'Mountain', 'Pacific'],
      required: true });
    expect(planned([spec], spec)).toMatchObject({ write: { value: { cleanLabel: 'Central' },
      origin: { provenance: 'rule', ruleId: 'location.time-zone', path: 'address.region' } },
    row: { reason: 'filled-low-confidence' } });
    expect(written(planned([spec], spec, { profile: livingIn('NY') }).write)).toBe('Eastern');
  });
  it('answers whether the person lives in a zone', () => {
    const spec = specOf('Question 9: Do you currently reside in a state located within the Eastern US Time Zone?',
      'radio', { optionLabels: YES_NO, required: true });
    expect(written(planned([spec], spec).write)).toBe('No');
    expect(written(planned([spec], spec, { profile: livingIn('NY') }).write)).toBe('Yes');
  });
  it('answers years in something from the entries, flagged, and leaves what they do not settle to the AI', () => {
    const tenYears = specOf('Question 2: Do you have 10+ years of work experience in Engineering?', 'radio', {
      optionLabels: YES_NO, required: true });
    expect(planned([tenYears], tenYears)).toMatchObject({ write: { value: { cleanLabel: 'No' },
      origin: { provenance: 'rule', ruleId: 'experience.years-in' } }, row: { reason: 'filled-low-confidence' } });
    const asEngineer = specOf('Do you have 5+ years of experience as a Software Engineer?', 'radio', {
      optionLabels: YES_NO });
    expect(written(planned([asEngineer], asEngineer).write)).toBe('Yes');
    const devops = specOf('Question 3: Do you have 5+ years’ work experience in a DevOps role?', 'radio', {
      optionLabels: YES_NO, required: true });
    expect(planned([devops], devops).write).toBeUndefined();
    expect(scopes([devops])).toEqual(['standard']);
  });
  it('answers experience with a skill Yes, and leaves one the profile does not name to the AI', () => {
    const kubernetes = specOf('Question 4: Do you have experience with Kubernetes?', 'radio', { optionLabels: YES_NO });
    expect(planned([kubernetes], kubernetes).write).toMatchObject({ value: { cleanLabel: 'Yes' },
      origin: { provenance: 'rule', ruleId: 'skills.experience-with', path: 'skills' } });
    const rust = specOf('Do you have experience with Rust?', 'radio', { optionLabels: YES_NO, required: true });
    expect(planned([rust], rust).write).toBeUndefined();
    expect(scopes([rust])).toEqual(['standard']);
  });
});
