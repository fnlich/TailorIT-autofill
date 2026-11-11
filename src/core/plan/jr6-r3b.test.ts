/*
 * jr6 RULES (FIXPLAN §6.3 R3, items 49 to 61): what the plan writes for each audit's field, with the golden synthetic
 * profile (fixtures/profiles/alex-rivera.*) or variants of it built here. Labels and option labels are the pages' own
 * text (questions and the forms' choices, as the audits quote them); no value of the owner's appears here.
 */
import { describe, expect, it } from 'vitest';
import { withoutFileTypes } from '../resolver/classifyRules';
import type { FieldSpec } from '../types/field';
import type { Profile } from '../types/profile';
import { namesUnanswerableTopic } from './answers';
import { asksOnlyFollowUp } from './drafts';
import { fieldOf, goldenProfile, inOrder, planOf, specOf } from './plan.testkit';
import type { PlanInput } from './types';

const golden = goldenProfile();
const YES_NO = ['Yes', 'No'];

/** What the plan writes into one field, and its row. */
const planned = (specs: FieldSpec[], spec: FieldSpec, extra: Partial<PlanInput> = {}) => fieldOf(planOf(specs, extra),
  spec);
/** The option label a write chose, the labels it chose, the text it typed, or the queries it types. */
const written = (write: ReturnType<typeof fieldOf>['write']) => {
  const value = write?.value;
  if (value === undefined) return undefined;
  if (value.kind === 'option') return value.cleanLabel;
  if (value.kind === 'options') return value.cleanLabels;
  if (value.kind === 'text') return value.text;
  if (value.kind === 'query') return value.queries;
  if (value.kind === 'date') return value.iso;
  return value.kind;
};
/** The scopes of the plan's AI answer asks. */
const scopes = (specs: FieldSpec[], extra: Partial<PlanInput> = {}) => (planOf(specs, extra).ask?.answers ?? [])
  .map((item) => item.scope);
/** The keys a plan asks a classification or a draft for. */
const classified = (specs: FieldSpec[]) => (planOf(specs).ask?.classify ?? []).map((item) => item.key);
const drafted = (specs: FieldSpec[], extra: Partial<PlanInput> = {}) => (planOf(specs, extra).ask?.drafts ?? [])
  .map((item) => item.key);
/** The golden profile with an expected salary. */
const paid = (currency: string): Profile => ({ ...golden, preferences: { ...golden.preferences,
  expectedSalary: { kind: 'value', value: { min: 150_000, currency, period: 'year' } } } });
/** The golden profile with these screening answers. */
const screening = (answers: Partial<Profile['screening']>): Profile => ({ ...golden,
  screening: { ...golden.screening, ...answers } });
/** The golden profile living in another country. */
const livingIn = (country: string, region: string): Profile => ({ ...golden, address: { ...golden.address,
  country, region: { code: region, name: region } } });

describe('49 (icims-new-3): a preferred or chosen last name is the last name', () => {
  it('types the profile’s last name, and the preferred first name for a chosen one', () => {
    const last = specOf('Preferred Last Name', 'text');
    expect(planned([last], last).write).toMatchObject({ value: { text: 'Rivera' },
      origin: { provenance: 'profile', path: 'identity.lastName' } });
    const chosen = specOf('Chosen First Name', 'text');
    expect(written(planned([chosen], chosen).write)).toBe('Alex');
  });
});

describe('50 (ADP-4): a state or territory is the region', () => {
  it('types the state’s code into ADP’s text box', () => {
    const spec = specOf('State / Territory', 'text', { required: true });
    expect(planned([spec], spec)).toMatchObject({ write: { value: { text: 'TX' } }, row: { status: 'verified' } });
  });
});

describe('51 (ADP-7): the currency by its code in the list’s words', () => {
  const list = specOf('Select currency type', 'select', { optionLabels: ['Select...', 'Canadian Dollar ( CAD )',
    'Pound Sterling ( GBP )', 'Euro ( EUR )'], required: true });
  it('chooses the option that writes the person’s code, and types the code in a box', () => {
    expect(planned([list], list, { profile: paid('CAD') }).write).toMatchObject({
      value: { cleanLabel: 'Canadian Dollar ( CAD )' },
      origin: { provenance: 'profile', path: 'preferences.expectedSalary' } });
    expect(written(planned([list], list, { profile: paid('EUR') }).write)).toBe('Euro ( EUR )');
    const box = specOf('Currency', 'text');
    expect(written(planned([box], box, { profile: paid('GBP') }).write)).toBe('GBP');
  });
  it('leaves it to the `all` scope where the profile holds no expected pay (no default from the posting: owner Q8)',
    () => {
      expect(planned([list], list).write).toBeUndefined();
      expect(scopes([list])).toEqual(['all']);
    });
});

describe('52 (ADP-8, WD-27): when the person could start', () => {
  const notice = { ...golden, preferences: { ...golden.preferences, startDate: { kind: 'notice' as const, weeks: 2 } } };
  it('dates the start from the notice period, and asks the AI where the profile holds none', () => {
    const when = specOf('When could you start?', 'date', { required: true });
    expect(planned([when], when, { profile: notice }).write).toMatchObject({ value: { iso: '2026-11-13' },
      origin: { provenance: 'rule', ruleId: 'availability.from-notice' } });
    const soon = specOf('If an offer is presented, how soon can you start?', 'text', { required: true });
    expect(planned([soon], soon).write).toBeUndefined();
    expect(scopes([soon])).toEqual(['standard']);
  });
});

describe('53 (JV-13): a current employee of the company', () => {
  const spec = specOf('Are you a current NinjaOne Employee', 'radio', { optionLabels: YES_NO, required: true });
  const posting = { company: 'NinjaOne' };
  it('answers No from the current entries, Yes for a current employee there', () => {
    expect(planned([spec], spec, { posting }).write).toMatchObject({ value: { cleanLabel: 'No' },
      origin: { provenance: 'rule', ruleId: 'screening.previously-employed' } });
    const there: Profile = { ...golden, experience: [{ company: 'NinjaOne', title: 'Engineer', current: true,
      startDate: { y: 2024, m: 1 } }, ...golden.experience] };
    expect(written(planned([spec], spec, { posting, profile: there }).write)).toBe('Yes');
  });
  it('never answers for a company the question sets aside (“outside of Twitch”, “other than GitHub”)', () => {
    const twitch = specOf('Are you a current employee with Amazon or any Amazon subsidiary (outside of Twitch)?',
      'radio', { optionLabels: YES_NO });
    expect(planned([twitch], twitch, { posting: { company: 'Twitch' } }).write).toBeUndefined();
    const github = specOf('Are you a current Full-Time employee at Microsoft or a Microsoft subsidiary other than GitHub?',
      'select', { optionLabels: YES_NO });
    expect(planned([github], github, { posting: { company: 'GitHub' } }).write).toBeUndefined();
  });
  // jr6 fix (ICIMS:stage1-4, merge1-18): on githubinc-candidate-questions.frame-1 that question's options name
  // Microsoft's subsidiaries, among them "Gaming Studios: Id Software", which the answer screen read as an identifier:
  // the question was left for the person, never asked of the AI as the item's moved row says.
  it('asks the AI a set-aside company’s question whose options name a company called "Id"', () => {
    const github = specOf('Are you a current Full-Time employee at Microsoft or a Microsoft subsidiary other than GitHub?',
      'select', { required: true, optionLabels: ['Select...', 'No', 'Microsoft', 'LinkedIn', 'Gaming Studios: Id Software',
        'Gaming Studios: Mojang'] });
    expect(scopes([github], { posting: { company: 'GitHub' } })).toEqual(['standard']);
    expect(planned([github], github, { posting: { company: 'GitHub' } }).row).toMatchObject({
      category: 'screening.previouslyEmployed', reason: 'unknown-field' });
    expect(namesUnanswerableTopic('Gaming Studios: Id Software')).toBe(false);
    // An identifier stays one, in capitals or not, before an identifier's word or alone.
    for (const text of ['ID', 'Login Id', 'Employee Id Number', 'Please enter your id', 'Skype id', 'Id Card',
      'Gaming Studios: ID Software']) {
      expect(namesUnanswerableTopic(text), text).toBe(true);
    }
  });
});

describe('54 (JZ-11): living or working inside a country', () => {
  const inside = specOf('Will you be working from inside the United States?', 'select', { optionLabels: YES_NO,
    required: true });
  it('answers from the address’s country, flagged', () => {
    expect(planned([inside], inside)).toMatchObject({ write: { value: { cleanLabel: 'Yes' },
      origin: { provenance: 'rule', ruleId: 'location.in-country', path: 'address.country' } },
    row: { reason: 'filled-low-confidence' } });
    expect(written(planned([inside], inside, { profile: livingIn('CA', 'ON') }).write)).toBe('No');
    const either = specOf('Are you currently located in the United States or Canada?', 'combobox', {
      optionLabels: YES_NO });
    expect(written(planned([either], either, { profile: livingIn('CA', 'ON') }).write)).toBe('Yes');
  });
  it('answers a Yes/No pair of boxes as its radio', () => {
    const pair = specOf('Are you able to work remotely from a state within the United States?', 'checkbox-group', {
      optionLabels: YES_NO });
    expect(written(planned([pair], pair).write)).toEqual(['Yes']);
  });
  it('leaves a place no country names to the AI', () => {
    const state = specOf('Do you live in Illinois?', 'radio', { optionLabels: YES_NO, required: true });
    expect(planned([state], state).write).toBeUndefined();
    expect(scopes([state])).toEqual(['standard']);
  });
});

describe('55 (SR-7): how the person first heard', () => {
  it('chooses the profile’s source', () => {
    const spec = specOf('How did you first hear about this opportunity?', 'select', { optionLabels: ['Indeed',
      'LinkedIn', 'Other'] });
    expect(written(planned([spec], spec).write)).toBe('LinkedIn');
  });
});

describe('56 (SR-9, smartrecruiters-new-2): a restriction’s file types name no résumé', () => {
  const restriction = 'Supported files: DOC, DOT, RMR, RSM, RESUME, OXPS, PDF, P7S, AI, RTF, PAGES, GDOC, GSLIDES, XLS, '
    + 'DOCX, ODT, TXT, JPG, PNG (10MB size limit)';
  it('uploads nothing into an extra drop zone', () => {
    for (const label of ['Additional attachments', 'Portfolio', 'Writing sample', 'Transcript']) {
      const spec = specOf(label, 'file', { description: restriction });
      expect(planned([spec], spec).row.category, label).not.toBe('file.resume');
      expect(planned([spec], spec).write, label).toBeUndefined();
    }
  });
  it('still uploads the résumé by its own label', () => {
    const spec = specOf('Resume', 'file', { description: restriction });
    expect(planned([spec], spec).write).toMatchObject({ value: { kind: 'file', ref: 'resume' } });
  });
  it('still reads a drop zone under a résumé’s own heading as the résumé (Workday’s M2), and no other help text', () => {
    const workday = specOf('Upload a file (5MB max)', 'file', { description: 'Resume/CV' });
    expect(planned([workday], workday).write).toMatchObject({ value: { kind: 'file', ref: 'resume' } });
    const attachments = specOf('Upload a file (5MB max)', 'file', { description: 'Additional Attachments' });
    expect(planned([attachments], attachments).write).toBeUndefined();
    const sentence = specOf('Upload a file', 'file', { description: 'Attach any document, such as a resume or a cover '
      + 'letter' });
    expect(planned([sentence], sentence).write).toBeUndefined();
  });
  // jr6 fix (RULES-R56, WD-R3: Workday's Dana-Farber and Travelers My Experience draw "Upload a file (5MB max)" under
  // "Resume/CV/Cover Letter"): a heading that lists documents starting with the résumé is the résumé's.
  it('reads a drop zone under a list of documents that starts with the résumé as the résumé', () => {
    for (const description of ['Resume/CV/Cover Letter', 'Resume or Cover Letter', 'Resume and Cover Letter',
      'Upload your resume and cover letter', 'CV / Cover Letter', 'Resume and supporting documents']) {
      const spec = specOf('Upload a file (5MB max)', 'file', { description, section: { id: 'resume-cv-cover-letter' } });
      expect(planned([spec], spec).row.category, description).toBe('file.resume');
      expect(planned([spec], spec).write, description).toMatchObject({ value: { kind: 'file', ref: 'resume' } });
    }
    for (const description of ['Cover Letter', 'Cover Letter/Resume', 'Additional attachments', 'Portfolio',
      'Writing sample', 'Transcript']) {
      const spec = specOf('Upload a file (5MB max)', 'file', { description });
      expect(planned([spec], spec).row.category, description).not.toBe('file.resume');
    }
  });

  it('drops a run of file types and keeps a list of documents', () => {
    expect(withoutFileTypes('Supported files: DOC, DOCX, PDF (5MB)').replace(/\s+/g, ' ')).toBe('Supported files: (5MB)');
    expect(withoutFileTypes('Upload your Resume, CV, Bio')).toBe('Upload your Resume, CV, Bio');
    expect(withoutFileTypes('Accepted: .pdf, .docx, .txt')).not.toMatch(/pdf/);
  });
});

describe('57 (U-10): a whole question that ends “Please briefly explain” stands alone', () => {
  const salary = specOf('What are your salary expectations?', 'text', { ordinal: 0 });
  const sql = specOf('Do you have experience with SQL, APIs, data mapping, validation, transformation, and integration '
    + 'troubleshooting? Please briefly explain:', 'textarea', { required: true, ordinal: 1 });
  it('is drafted, though a pay question stands before it', () => {
    expect(drafted(inOrder([salary, sql]))).toEqual([sql.key]);
  });
  it('keeps a bare follow-up a follow-up', () => {
    const felony = specOf('Have you ever been convicted of a felony?', 'radio', { optionLabels: YES_NO, ordinal: 0 });
    const explain = specOf('If yes, please explain', 'textarea', { ordinal: 1 });
    expect(drafted(inOrder([felony, explain]))).toEqual([]);
    expect(asksOnlyFollowUp('Please provide details')).toBe(true);
    expect(asksOnlyFollowUp('Please explain why')).toBe(true);
    expect(asksOnlyFollowUp('Do you have a license? Please explain.')).toBe(false);
    expect(asksOnlyFollowUp('Please explain how your experience and background would make you a good candidate'))
      .toBe(false);
  });
});

describe('58 (U-11): UltiPro’s Middle, Former Name and location', () => {
  const section = { id: 'personal-information' };
  const first = specOf('First', 'text', { section, ordinal: 0, nameAttr: 'FirstName' });
  const middle = specOf('Middle', 'text', { section, ordinal: 1 });
  const last = specOf('Last', 'text', { section, ordinal: 2, nameAttr: 'LastName' });
  const names = inOrder([specOf('First Name', 'text', { section, ordinal: 0 }), middle,
    specOf('Last Name', 'text', { section, ordinal: 2 })]);
  it('reads "Middle" between the first and last names as the middle name, with no AI', () => {
    expect(planned(names, middle)).toMatchObject({ write: undefined, row: { category: 'identity.middleName',
      reason: 'no-profile-value' } });
    expect(classified(names)).toEqual([]);
    const withMiddle: Profile = { ...golden, identity: { ...golden.identity, middleName: 'Jordan' } };
    expect(written(planned(names, middle, { profile: withMiddle }).write)).toBe('Jordan');
    // Alone, or far from the names, it is not.
    expect(classified(inOrder([middle]))).toEqual([middle.key]);
    expect(first.label).toBe('First');
    expect(last.label).toBe('Last');
  });
  it('leaves a former name as the page has it, never asked of an AI', () => {
    const former = specOf('Former Name', 'text');
    const out = planOf([former]);
    expect(fieldOf(out, former)).toMatchObject({ write: undefined, row: { category: 'identity.formerName',
      status: 'skipped' } });
    expect(out.ask).toBeUndefined();
  });
  it('types the location into a box of prose that asks only that', () => {
    const where = specOf('Where are you currently located?', 'textarea', { required: true });
    expect(planned([where], where).write).toMatchObject({ value: { text: 'Austin, TX' },
      origin: { provenance: 'profile', transform: 'location.compose' } });
  });
});

describe('59 (jazzhr-new-1): references are never drafted', () => {
  it('leaves a references box flagged for the person, and still drafts a message to the hiring manager', () => {
    const references = specOf('References: Please enter names and contact information', 'textarea', { required: true });
    expect(drafted([references])).toEqual([]);
    expect(planned([references], references).row).toMatchObject({ status: 'flagged',
      reason: 'free-text-requires-user' });
    const message = specOf('Let the company know about your interest working there', 'textarea',
      { idAttr: 'hiring-manager-message-input' });
    expect(drafted([message])).toEqual([message.key]);
  });
});

describe('60 (adp-new-2): a civilian employee at a government agency is government service', () => {
  const spec = specOf('Have you ever been employed as a civilian employee at a government agency?', 'radio', {
    optionLabels: YES_NO, required: true });
  it('answers from the government answer, with no level named', () => {
    expect(written(planned([spec], spec, { profile: screening({ governmentService: { kind: 'value',
      value: { military: false, government: true } } }) }).write)).toBe('Yes');
    expect(written(planned([spec], spec, { profile: screening({ governmentService: { kind: 'value',
      value: { military: true, government: false } } }) }).write)).toBe('No');
    expect(scopes([spec])).toEqual(['all']);
  });
});

describe('61 (O2): Oracle’s ZIP Code and Address Line 1 searches', () => {
  it('types the five digits, then the first three', () => {
    const zip = specOf('ZIP Code', 'typeahead-remote', { required: true });
    expect(written(planned([zip], zip).write)).toEqual(['78701', '787']);
    const plus4: Profile = { ...golden, address: { ...golden.address, postalCode: '78701-1234' } };
    expect(written(planned([zip], zip, { profile: plus4 }).write)).toEqual(['78701', '787']);
    const london: Profile = { ...golden, address: { ...golden.address, postalCode: 'SW1A 1AA' } };
    expect(written(planned([zip], zip, { profile: london }).write)).toEqual(['SW1A 1AA']);
  });
  it('chooses a postal code’s result that names the city after it', () => {
    const results = specOf('ZIP Code', 'typeahead-remote', { optionLabels: ['78702 - Austin, TX', '78701 - Austin, TX'],
      searchResults: true });
    expect(written(planned([results], results).write)).toBe('78701 - Austin, TX');
  });
  it('chooses the address result that starts with the street and names the city and state', () => {
    const results = specOf('Address Line 1', 'typeahead-remote', { optionLabels: [
      '4417 QUILLFEATHER LN, AUSTIN, MN 55912', '4417 QUILLFEATHER LN, AUSTIN, TX 78701',
      '4471 Quillfeather Lane, Austin, TX'], searchResults: true, required: true });
    expect(planned([results], results).write).toMatchObject({
      value: { cleanLabel: '4417 QUILLFEATHER LN, AUSTIN, TX 78701' }, match: { stage: 'alias', rule: 'place' } });
  });
  it('chooses none of results that name another street or no place of the person’s', () => {
    const results = specOf('Address Line 1', 'typeahead-remote', { optionLabels: ['4417 Quill Lane, Austin, TX',
      '4417 Quillfeather Lane, Dallas, OK'], searchResults: true });
    expect(planned([results], results).write).toBeUndefined();
  });
});

// jr6 fix (RULES-R51): a pay question in a text box that asks for its currency too gets the pay, never the code alone.
describe('51 (RULES-R51): a salary box that also asks for its currency', () => {
  it('types the expected pay, not the currency’s code', () => {
    for (const label of ['What is your expected salary? Please specify the currency.',
      'What are your salary expectations? Please include currency and pay period.']) {
      const box = specOf(label, 'text', { required: true });
      const { write, row } = planned([box], box, { profile: paid('CAD') });
      expect(row.category, label).toBe('salary.expected');
      expect(written(write), label).toMatch(/\d/);
      expect(written(write), label).not.toBe('CAD');
    }
  });
});

// jr6 fix (REVC-3, RULES-SR2-CITY-RESULTS-UNASSIGNED): SmartRecruiters' City search (xplor-one-click,
// jr6-wiser-one-click) words its results "City, State, Country"; the golden profile lives in Austin, TX, US.
describe('SR-2 (REVC-3): a city search’s results read by their place parts', () => {
  it('types the city alone, as before', () => {
    const city = specOf('City', 'typeahead-remote', { required: true });
    expect(planned([city], city).write).toMatchObject({ value: { kind: 'query', queries: ['Austin'] },
      origin: { provenance: 'profile', path: 'address.city', transform: 'typeahead.query' } });
  });
  it('chooses the result naming the person’s city and region, never another region’s', () => {
    const results = specOf('City', 'typeahead-remote', { required: true, searchResults: true,
      optionLabels: ['Austin, Minnesota, United States', 'Austin, Texas, United States'] });
    const { write, row } = planned([results], results);
    expect(write).toMatchObject({ value: { cleanLabel: 'Austin, Texas, United States' },
      match: { stage: 'alias', rule: 'place' } });
    expect(row).toMatchObject({ category: 'address.city', status: 'verified' });
    const elsewhere = specOf('City', 'typeahead-remote', { required: true, searchResults: true,
      optionLabels: ['Austin, Minnesota, United States', 'Austin, Arkansas, United States'] });
    expect(planned([elsewhere], elsewhere).write).toBeUndefined();
  });
  it('still chooses a list’s option that is the city alone, and types the city into a box', () => {
    const list = specOf('City', 'select', { optionLabels: ['Select...', 'Austin', 'Austin, MN', 'Dallas'] });
    expect(written(planned([list], list).write)).toBe('Austin');
    const box = specOf('City', 'text', { required: true });
    expect(written(planned([box], box).write)).toBe('Austin');
  });
});
