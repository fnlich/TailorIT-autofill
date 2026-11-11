/*
 * jr6 RULES (FIXPLAN §6.3 R2, items 27 to 34): what the plan writes for each audit's work-authorization question, with
 * the golden synthetic profile (fixtures/profiles/alex-rivera.*) or variants of it built here. Labels and option labels
 * are the pages' own text (questions and the forms' choices, as the audits quote them); no value of the owner's appears
 * here.
 */
import { describe, expect, it } from 'vitest';
import { basisPickContradicts, legalValue } from '../resolver/policy';
import { basisClassOf } from '../resolver/workBasis';
import { statusMeaningOf } from '../resolver/workStatus';
import { DEFAULT_SETTINGS } from '../types/settings';
import type { FieldSpec } from '../types/field';
import type { Explicit, Profile, WorkAuthorization } from '../types/profile';
import type { WorkStatus } from '../enums';
import { fieldOf, goldenProfile, planOf, specOf, vocab } from './plan.testkit';
import type { PlanInput } from './types';

const golden = goldenProfile();
const yes = { kind: 'value', value: true } as const;
const no = { kind: 'value', value: false } as const;

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
/** One country's work-authorization entry. */
const entry = (country: string, parts: Partial<Omit<WorkAuthorization, 'country' | 'status'>> & {
  status?: WorkStatus } = {}): WorkAuthorization => {
  const { status, ...rest } = parts;
  return { country, ...rest, ...(status !== undefined ? { status: { kind: 'value', value: status } } : {}) };
};
/** The golden profile with these work-authorization entries, citizenships, clearance or address country. */
const withAuth = (entries: WorkAuthorization[], screening: Partial<Profile['screening']> = {},
  country?: string): Profile => ({ ...golden, workAuthorization: entries,
  screening: { ...golden.screening, ...screening },
  ...(country !== undefined ? { address: { ...golden.address, country } } : {}) });
const citizenships = (codes: string[]): Partial<Profile['screening']> => ({ citizenships: { kind: 'value',
  value: codes } as Explicit<string[]> });
/** An authorized person with no sponsorship need, of this status. */
const settled = (status?: WorkStatus) => entry('US', { authorized: yes, sponsorshipNow: no, sponsorshipFuture: no,
  ...(status !== undefined ? { status } : {}) });
/** The `all` scope's asks of a plan. */
const allAsked = (specs: FieldSpec[], extra: Partial<PlanInput> = {}) => (planOf(specs, extra).ask?.answers ?? [])
  .filter((item) => item.scope === 'all').length;

const NINJAONE_TYPES = ['Select an option...', 'US Citizen', 'Permanent Resident', 'H1B', 'H4', 'TN Visa', 'F1Visa',
  'OPT', 'EAD', 'Other'];
const VHL_STATUSES = ['Select an option...', 'U.S. Citizen/Permanent Resident',
  'Non-citizen allowed to work for any employer', 'Non-citizen allowed to work for current employer',
  'Non-citizen seeking work authorization', 'Canadian Citizen/Permanent Resident'];
const JAZZHR_STATUSES = ['No answer', 'I am a U.S. Citizen/Permanent Resident',
  'Non-citizen allowed to work for any employer', 'Non-citizen allowed to work for current employer',
  'Non-citizen seeking work authorization', 'I am a Canadian Citizen/Permanent Resident', 'Other'];
const XPLOR_RIGHTS = ['I am a US citizen', 'I am a US lawful permanent resident (Green Card holder)',
  'I am on a temporary work or student visa (e.g. H-1B, L-1, OPT, CPT) requiring sponsorship',
  'I have an EAD that does not require sponsorship (e.g. asylee, refugee, TPS, H-4)',
  'I do not currently have any US work rights'];

describe('27 (JV-7): NinjaOne’s type of work authorization is the status, by its meaning', () => {
  const spec = specOf('What is your US Work Authorization type?', 'select', { optionLabels: NINJAONE_TYPES,
    required: true });
  it('chooses the citizen’s and the permanent resident’s own option', () => {
    expect(planned([spec], spec, { profile: withAuth([settled('citizen')]) }).write).toMatchObject({
      value: { cleanLabel: 'US Citizen' },
      origin: { provenance: 'profile', path: 'workAuthorization[0].status', transform: 'legal.work-status' } });
    expect(written(planned([spec], spec, { profile: withAuth([settled('permanent-resident')]) }).write))
      .toBe('Permanent Resident');
    // A citizen by the person's citizenships, the entry stating no status.
    expect(planned([spec], spec, { profile: withAuth([settled()], citizenships(['US'])) }).write).toMatchObject({
      value: { cleanLabel: 'US Citizen' }, origin: { path: 'screening.citizenships' } });
  });
  it('asks the `all` scope’s AI for the golden profile, which states no status, and never picks a visa by its type', () => {
    expect(planned([spec], spec).row).toMatchObject({ status: 'flagged', reason: 'legal-not-in-profile' });
    expect(allAsked([spec])).toBe(1);
    const visa = planned([spec], spec, { profile: withAuth([entry('US', { authorized: yes, sponsorshipNow: yes,
      sponsorshipFuture: yes, status: 'work-visa' })]) });
    expect(visa).toMatchObject({ write: undefined, row: { reason: 'legal-not-in-profile' } });
  });
  it('reads an authorization question whose options are statuses as the status', () => {
    const list = specOf('Work Authorization', 'select', { optionLabels: ['Select...', 'US Citizen', 'Green Card Holder',
      'H-1B Visa', 'Other'] });
    expect(written(planned([list], list, { profile: withAuth([settled('permanent-resident')]) }).write))
      .toBe('Green Card Holder');
  });
});

describe('28 (JV-11): VHL’s status sentences, by the country the options name', () => {
  const spec = specOf('Citizen/Employment Status', 'select', { optionLabels: VHL_STATUSES, required: true });
  it('chooses the U.S. citizen’s option from the citizenships, and the Canadian’s from a Canadian entry', () => {
    expect(planned([spec], spec, { profile: withAuth(golden.workAuthorization, citizenships(['US'])) }).write)
      .toMatchObject({ value: { cleanLabel: 'U.S. Citizen/Permanent Resident' },
        origin: { path: 'screening.citizenships', transform: 'legal.work-status' } });
    expect(written(planned([spec], spec, { profile: withAuth([entry('CA', { authorized: yes,
      status: 'citizen' })]) }).write)).toBe('Canadian Citizen/Permanent Resident');
  });
  it('gives a non-citizen’s right only from the authorization and sponsorship answers, flagged', () => {
    const visa = (parts: Partial<WorkAuthorization>) => planned([spec], spec, { profile: withAuth([{ ...entry('US'),
      status: { kind: 'value', value: 'work-visa' }, ...parts }]) });
    expect(visa({ authorized: yes, sponsorshipNow: no, sponsorshipFuture: no })).toMatchObject({
      write: { value: { cleanLabel: 'Non-citizen allowed to work for any employer' },
        origin: { path: 'workAuthorization[0].authorized' } }, row: { reason: 'filled-low-confidence' } });
    expect(written(visa({ authorized: yes, sponsorshipNow: yes, sponsorshipFuture: yes }).write))
      .toBe('Non-citizen allowed to work for current employer');
    expect(written(visa({ authorized: no }).write)).toBe('Non-citizen seeking work authorization');
    expect(visa({ authorized: yes })).toMatchObject({ write: undefined, row: { reason: 'legal-not-in-profile' } });
  });
  it('leaves the golden profile’s unsettled status to the `all` scope, never work-auth-country-unknown', () => {
    expect(planned([spec], spec).row).toMatchObject({ status: 'flagged', reason: 'legal-not-in-profile' });
    expect(allAsked([spec])).toBe(1);
  });
});

describe('29 (JZ-7): JazzHR’s eligibility sentences', () => {
  const spec = specOf('What’s your citizenship / employment eligibility?', 'select', { optionLabels: JAZZHR_STATUSES,
    required: true });
  it('reads “non-citizen” as no citizen (workBasis and the status reader alike)', () => {
    expect(basisClassOf('Non-citizen allowed to work for any employer')).toBeNull();
    expect(statusMeaningOf('Non-citizen allowed to work for any employer')).toBe('any-employer');
    expect(statusMeaningOf('I am a Canadian Citizen/Permanent Resident')).toBe('citizen-or-resident');
  });
  it('chooses the citizen of the option’s own country only, and lets the posting decide between two entries', () => {
    expect(written(planned([spec], spec, { profile: withAuth([settled('citizen')]) }).write))
      .toBe('I am a U.S. Citizen/Permanent Resident');
    const both = withAuth([settled('citizen'), entry('CA', { authorized: yes, status: 'permanent-resident' })]);
    expect(planned([spec], spec, { profile: both }).row).toMatchObject({ status: 'flagged',
      reason: 'work-auth-country-unknown' });
    expect(written(planned([spec], spec, { profile: both, posting: { location: 'Toronto, Ontario, Canada' } }).write))
      .toBe('I am a Canadian Citizen/Permanent Resident');
  });
});

describe('30 (JZ-8): a status asked as yes or no', () => {
  const pair = specOf('Are you a US Citizen or Permanent Resident? (Note - EAD does not qualify for this position)',
    'checkbox-group', { optionLabels: ['Yes', 'No'], required: true });
  const citizenOnly = specOf('Are you a U.S. citizen?', 'select', { optionLabels: ['Yes', 'No'] });
  it('answers Yes for a citizen or a permanent resident, No for any other explicit status (an EAD holder)', () => {
    expect(written(planned([pair], pair, { profile: withAuth([settled('citizen')]) }).write)).toEqual(['Yes']);
    expect(written(planned([pair], pair, { profile: withAuth([settled('permanent-resident')]) }).write))
      .toEqual(['Yes']);
    expect(written(planned([pair], pair, { profile: withAuth([settled('work-visa')]) }).write)).toEqual(['No']);
  });
  it('answers a citizenship-only question from the citizenships, both ways', () => {
    expect(written(planned([citizenOnly], citizenOnly, { profile: withAuth(golden.workAuthorization,
      citizenships(['US'])) }).write)).toBe('Yes');
    expect(written(planned([citizenOnly], citizenOnly, { profile: withAuth(golden.workAuthorization,
      citizenships(['IN'])) }).write)).toBe('No');
  });
  it('ticks the lone box of a citizen, and leaves the golden profile’s unsettled status', () => {
    const box = specOf('I am a U.S. citizen', 'checkbox');
    expect(planned([box], box, { profile: withAuth(golden.workAuthorization, citizenships(['US'])) }).write)
      .toMatchObject({ value: { kind: 'check' } });
    expect(planned([pair], pair).row).toMatchObject({ reason: 'legal-not-in-profile' });
  });
  it('never reads a requirement the status may meet from the citizenships (ADP-9)', () => {
    const meets = specOf('This position requires you to obtain and maintain a US Government Security Clearance, which '
      + 'requires US citizenship. Do you meet this requirement?', 'radio', { optionLabels: ['Yes', 'No'] });
    expect(planned([meets], meets, { profile: withAuth([settled('citizen')], citizenships(['US'])) }))
      .toMatchObject({ write: undefined, row: { reason: 'legal-not-in-profile' } });
  });
});

describe('31 (SR-4): a sponsorship question naming two countries, each where the person is located', () => {
  const label = 'Do you, now or in the future, require sponsorship to maintain employment in the US (if you are located '
    + 'in the US) or Canada (if you are located in Canada)?';
  const spec = specOf(label, 'radio', { optionLabels: ['Yes', 'No'], required: true });
  it('answers from the entry of the country the person lives in, flagged', () => {
    expect(planned([spec], spec)).toMatchObject({ write: { value: { cleanLabel: 'No' },
      origin: { provenance: 'profile', transform: 'legal.located-country' } },
    row: { status: 'flagged', reason: 'filled-low-confidence' } });
    const canada = withAuth([settled(), entry('CA', { authorized: yes, sponsorshipNow: yes, sponsorshipFuture: yes })],
      {}, 'CA');
    expect(written(planned([spec], spec, { profile: canada }).write)).toBe('Yes');
  });
  it('takes the posting’s country among them when the person’s own is neither', () => {
    const elsewhere = withAuth([settled(), entry('CA', { authorized: yes, sponsorshipNow: yes,
      sponsorshipFuture: yes })], {}, 'GB');
    expect(planned([spec], spec, { profile: elsewhere, posting: { location: 'Toronto, Ontario, Canada' } }).write)
      .toMatchObject({ value: { cleanLabel: 'Yes' }, origin: { transform: 'legal.posting-country' } });
    expect(planned([spec], spec, { profile: elsewhere }).row.reason).toBe('work-auth-country-unknown');
  });
  it('leaves two countries no clause qualifies', () => {
    const plain = specOf('Do you require sponsorship to work in the US or Canada?', 'radio', {
      optionLabels: ['Yes', 'No'] });
    expect(planned([plain], plain).row.reason).toBe('work-auth-country-unknown');
  });
});

describe('32 (SR-12): Xplor’s right-to-work statements', () => {
  const spec = specOf('Which of the following statements best describes your right to work in the United States?',
    'select', { optionLabels: XPLOR_RIGHTS, required: true });
  const pick = (profile: Profile) => written(planned([spec], spec, { profile }).write);
  it('chooses within the permanent class by status or citizenship', () => {
    expect(pick(withAuth([settled()], citizenships(['US'])))).toBe(XPLOR_RIGHTS[0]);
    expect(pick(withAuth([settled('permanent-resident')]))).toBe(XPLOR_RIGHTS[1]);
  });
  it('chooses the visa needing sponsorship, the EAD only for a status that says so, and no right to work', () => {
    expect(pick(withAuth([entry('US', { authorized: yes, sponsorshipNow: yes, sponsorshipFuture: yes,
      status: 'work-visa' })]))).toBe(XPLOR_RIGHTS[2]);
    expect(pick(withAuth([settled('other')]))).toBe(XPLOR_RIGHTS[3]);
    expect(pick(withAuth([entry('US', { authorized: no, sponsorshipNow: no, sponsorshipFuture: no })])))
      .toBe(XPLOR_RIGHTS[4]);
  });
  it('leaves the golden profile, which states no status, to the `all` scope', () => {
    expect(planned([spec], spec).row).toMatchObject({ status: 'flagged', reason: 'legal-not-in-profile' });
    expect(allAsked([spec])).toBe(1);
  });
  it('refuses an AI pick of no right to work for an authorized person', () => {
    const legal = { settings: DEFAULT_SETTINGS };
    expect(basisPickContradicts('workAuth.authorized', spec, 4, golden, vocab, legal)).toBe(true);
    expect(basisPickContradicts('workAuth.authorized', spec, 0, golden, vocab, legal)).toBe(false);
  });
});

describe('33 (WD-30): OPT to begin employment', () => {
  const spec = specOf('Will you be using Optional Practical Training (OPT) or STEM OPT to begin employment at AEP?',
    'combobox', { optionLabels: ['Yes', 'No'], required: true });
  it('answers No for the golden profile, who needs no sponsorship now or later (flagged: the posting’s country)', () => {
    expect(planned([spec], spec)).toMatchObject({ write: { value: { cleanLabel: 'No' } },
      row: { reason: 'filled-low-confidence' } });
  });
  it('answers Yes for a student visa, and nothing for an unsettled entry', () => {
    const student = withAuth([entry('US', { authorized: yes, sponsorshipNow: no, sponsorshipFuture: yes,
      status: 'student-visa' })]);
    expect(planned([spec], spec, { profile: student }).write).toMatchObject({ value: { cleanLabel: 'Yes' } });
    expect(planned([spec], spec, { profile: withAuth([entry('US', { authorized: yes })]) }).write).toBeUndefined();
  });
});

describe('34 (ADP-9): which clearance the person holds', () => {
  const label = 'Do you have a security clearance? If yes, please indicate which type (Hold CTRL to select multiple)';
  const clearance = (level: 'none' | 'secret') => ({ clearance: { kind: 'value' as const, value: { level } } });
  it('chooses the none option for a level of none, and the level held by its name', () => {
    const list = specOf(label, 'multiselect', { optionLabels: ['None', 'Confidential', 'Secret', 'Top Secret', 'TS/SCI'],
      required: true });
    expect(planned([list], list, { profile: withAuth(golden.workAuthorization, clearance('none')) }).write)
      .toMatchObject({ value: { kind: 'options', cleanLabels: ['None'] },
        origin: { provenance: 'profile', path: 'screening.clearance' } });
    const other = specOf(label, 'multiselect', { optionLabels: ['No Clearance', 'Secret', 'Top Secret'] });
    expect(written(planned([other], other, { profile: withAuth(golden.workAuthorization, clearance('none')) }).write))
      .toEqual(['No Clearance']);
    expect(written(planned([other], other, { profile: withAuth(golden.workAuthorization, clearance('secret')) }).write))
      .toEqual(['Secret']);
  });
  it('gives a list not read yet the spellings of none, which the matcher finds once it loads', () => {
    const lazy = specOf(label, 'multiselect', { options: 'lazy' });
    const result = legalValue('workAuth.clearance', lazy, withAuth(golden.workAuthorization, clearance('none')), vocab,
      { settings: DEFAULT_SETTINGS });
    expect(result.ok && result.candidate.choice?.intended).toMatchObject({ kind: 'entity', display: 'None' });
  });
  it('never infers “eligible to obtain” from the citizenships or a level of none', () => {
    const eligible = specOf('If you do not have a government security clearance, are you eligible to obtain and '
      + 'maintain one?', 'radio', { optionLabels: ['Yes', 'No'] });
    expect(planned([eligible], eligible, { profile: withAuth(golden.workAuthorization, { ...clearance('none'),
      ...citizenships(['US']) }) })).toMatchObject({ write: undefined, row: { reason: 'legal-not-in-profile' } });
  });
});
