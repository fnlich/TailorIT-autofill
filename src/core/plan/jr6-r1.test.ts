/*
 * jr6 RULES (FIXPLAN §6.3 R1, items 1 to 25): what the plan writes for each audit's field, with the golden synthetic
 * profile (fixtures/profiles/alex-rivera.*) or variants of it built here. Labels and option labels are the pages' own
 * text (questions and the forms' choices, as the audits quote them); no value of the owner's appears here.
 */
import { describe, expect, it } from 'vitest';
import { inputOf as matchInputOf, outcomeOf } from '../matcher/matcher.testkit';
import { policyClassOf } from '../resolver/categories';
import { openTopicsOfTexts } from '../resolver/classify';
import { classifyField, datePartChoice, datePartOf, dayOfLabel } from '../resolver/resolve';
import { countyChoice } from '../resolver/values';
import { sha256Hex } from '../text/sha256';
import { DEFAULT_SETTINGS } from '../types/settings';
import type { FieldSpec } from '../types/field';
import { ANSWER_BASES } from '../types/intent';
import type { Profile } from '../types/profile';
import { CAUTIOUS_SETTINGS, fieldOf, goldenProfile, inOrder, NOW, planOf, settingsWith, specOf, vocab } from './plan.testkit';
import type { AnswerVerdict } from './answers';
import type { PlanInput } from './types';

const golden = goldenProfile();
const TODAY = `${NOW.y}-${String(NOW.m).padStart(2, '0')}-${String(NOW.d).padStart(2, '0')}`;
/** What the plan writes into one field, and its row. */
const planned = (specs: FieldSpec[], spec: FieldSpec, extra: Partial<PlanInput> = {}) => fieldOf(planOf(specs, extra),
  spec);
/** The option label a write chose, or the text it typed. */
const written = (write: ReturnType<typeof fieldOf>['write']) => {
  const value = write?.value;
  if (value === undefined) return undefined;
  if (value.kind === 'option') return value.cleanLabel;
  if (value.kind === 'options') return value.cleanLabels;
  if (value.kind === 'text') return value.text;
  if (value.kind === 'date') return value.iso;
  return value.kind;
};
/** A golden profile with its EEO answers given. */
const withEeo = (eeo: Partial<Profile['eeo']>): Profile => ({ ...golden, eeo: { ...golden.eeo, ...eeo } });

describe('1 (WD-08): Workday’s race and ethnicity questions take the profile’s answer', () => {
  it('declines for the golden profile, which declines its race', () => {
    const spec = specOf('Please select the race/ethnicity that best applies to you:', 'select', {
      optionLabels: ['Hispanic or Latino', 'White (Not Hispanic or Latino)', 'Asian (Not Hispanic or Latino)',
        'I do not wish to self-identify'], required: true });
    expect(written(planned([spec], spec).write)).toBe('I do not wish to self-identify');
  });
});

describe('2 (WD-09): Workday’s agreement box is ticked as the terms', () => {
  const box = specOf('Please confirm your consent.', 'checkbox', { nameAttr: 'acceptTermsAndAgreements',
    required: true });
  it('under Consents: All (the default) and Required only', () => {
    expect(planned([box], box).write).toMatchObject({ value: { kind: 'check' },
      origin: { provenance: 'rule', ruleId: 'consent.preapproved' } });
    expect(planned([box], box, { settings: CAUTIOUS_SETTINGS }).write).toMatchObject({ value: { kind: 'check' },
      origin: { provenance: 'rule', ruleId: 'consent.required' } });
  });
});

describe('3 (WD-13): an employer’s support for a visa is sponsorship', () => {
  it('answers No for the golden profile, who needs none now or later', () => {
    const spec = specOf('Will you now or in the future require support from an employer to obtain/extend a work '
      + 'visa/permit in order to be employed (for example, H-1B, TN, Forms I-983/STEM OPT or other employment-based '
      + 'sponsorship/ support)?', 'select', { optionLabels: ['Yes', 'No'], required: true });
    expect(written(planned([spec], spec, { posting: { location: 'Hartford, CT' } }).write)).toBe('No');
  });
});

describe('4 (workday-new-2): an outside business is no employment by the company', () => {
  it('gives Parsons’ question no rule answer, and Travelers’ the rule’s No', () => {
    const outside = specOf('Are you currently the owner or employee of any outside company that is currently doing '
      + 'business with Parsons?', 'select', { optionLabels: ['Yes', 'No'], required: true });
    const own = specOf('Are you currently employed by Travelers (i.e., Travelers issues your paycheck)?', 'select', {
      optionLabels: ['Yes', 'No'], required: true });
    expect(planned([outside], outside, { posting: { company: 'Parsons' } }).write).toBeUndefined();
    expect(planned([own], own, { posting: { company: 'Travelers' } }).write).toMatchObject({
      value: { cleanLabel: 'No' }, origin: { provenance: 'rule', ruleId: 'screening.previously-employed' } });
  });
});

describe('5 (workday-new-1): Workday’s Self Identify date, language and employee number', () => {
  it('sets today’s date beside the signature, English for the form, and leaves the employee number to nobody', () => {
    const date = specOf('Date signed', 'date', { required: true });
    const language = specOf('Language of this form', 'select', { optionLabels: ['English', 'Español'],
      required: true });
    const employee = specOf('Employee ID (if applicable)', 'text');
    const out = planOf([language, employee, date]);
    expect(fieldOf(out, date).write).toMatchObject({ value: { kind: 'date', iso: TODAY },
      origin: { provenance: 'rule', ruleId: 'consent.signature-date' } });
    expect(fieldOf(out, language).write).toMatchObject({ value: { cleanLabel: 'English' },
      origin: { provenance: 'rule', ruleId: 'form.language' } });
    expect(fieldOf(out, employee)).toMatchObject({ write: undefined,
      row: { category: 'identity.employeeId', status: 'skipped', reason: 'no-profile-value' } });
    // Never asked of any AI.
    expect([...out.ask?.answers ?? [], ...out.ask?.classify ?? [], ...out.ask?.drafts ?? []]).toEqual([]);
  });

  it('chooses nothing on a form whose language list offers no English', () => {
    const language = specOf('Language of this form', 'select', { optionLabels: ['Français', 'Español'] });
    expect(planned([language], language).write).toBeUndefined();
  });
});

describe('6 (WD-07): a Role Description in a block the run assigned is the profile’s', () => {
  const block = (at: number, parsed: string) => specOf('Role Description', 'textarea', {
    section: { id: 'experience', block: at }, current: { kind: 'text', text: parsed } });
  it('replaces the parse’s text with the block’s entry’s description, flagged', () => {
    const spec = block(0, 'Text from another job');
    const out = planOf([spec], { repeatables: [{ kind: 'experience', entries: null }] });
    expect(fieldOf(out, spec).write).toMatchObject({ value: { kind: 'text' },
      origin: { provenance: 'profile', path: 'experience[0].description' } });
    expect(fieldOf(out, spec).row.reason).toBe('prefill-conflict');
  });

  it('keeps a box of prose outside an assigned block', () => {
    const spec = block(0, 'Text from another job');
    expect(planOf([spec]).results[0]).toMatchObject({ reason: 'prefill-kept', status: 'flagged' });
  });
});

describe('7 (ICIMS-09, O7): a job’s and a school’s City, State and Country are the entry’s', () => {
  const entryProfile: Profile = { ...golden, experience: golden.experience.map((entry, at) => (at === 1
    ? { ...entry, location: { text: 'Denver, CO', city: 'Denver', region: { code: 'CO', name: 'Colorado' },
      country: 'US' } } : entry)) };
  it('writes each block’s own place, never the home address, and nothing in a block with no entry', () => {
    const fields = [0, 1, 2].map((at) => [
      specOf('City', 'text', { section: { id: 'experience', block: at } }),
      specOf('State/Province', 'select', { section: { id: 'experience', block: at },
        optionLabels: ['Colorado', 'Texas'] })]).flat();
    const out = planOf(fields, { profile: entryProfile });
    expect(fields.map((spec) => written(fieldOf(out, spec).write))).toEqual(['Austin', 'Texas', 'Denver', 'Colorado',
      undefined, undefined]);
    expect(fieldOf(out, fields[0]!).write?.origin).toEqual({ provenance: 'profile',
      path: 'experience[0].location.city' });
  });

  it('writes a school’s place from its institution, and no home street, postcode or location in an entry', () => {
    const city = specOf('City', 'text', { section: { id: 'education', block: 0 } });
    const street = specOf('Address', 'text', { section: { id: 'education', block: 0 } });
    const zip = specOf('Zip Code', 'text', { section: { id: 'experience', block: 0 } });
    const out = planOf([city, street, zip]);
    expect(fieldOf(out, city).write).toMatchObject({ value: { text: 'Austin' },
      origin: { path: 'education[0].institution.city' } });
    expect(fieldOf(out, street).write).toBeUndefined();
    expect(fieldOf(out, zip).write).toBeUndefined();
  });

  it('keeps the home address outside an entry', () => {
    const city = specOf('City', 'text', { section: { id: 'employment-application' } });
    expect(written(planned([city], city).write)).toBe('Austin');
  });
});

describe('8 (ICIMS-11): "Opt Out" is a decline option', () => {
  it('chooses Opt Out for a declined EEO answer, and never for an SMS consent', () => {
    for (const label of ['Gender', 'Race']) {
      const spec = specOf(label, 'select', { optionLabels: ['— Make a Selection —', 'Male', 'Female', 'Opt Out'],
        required: true });
      expect(written(planned([spec], spec).write), label).toBe('Opt Out');
    }
    const sms = specOf('Would you like to receive text message updates?', 'radio', { optionLabels: ['Opt In',
      'Opt Out'] });
    expect(written(planned([sms], sms).write)).not.toBe('Opt Out');
    expect(written(planned([sms], sms, { settings: CAUTIOUS_SETTINGS }).write)).toBeUndefined();
  });

  it('makes an opt-out exclusive in a list that takes several', () => {
    const spec = specOf('Race', 'checkbox-group', { optionLabels: ['Asian', 'White', 'I opt out'] });
    const out = planOf([spec], { profile: withEeo({ race: { kind: 'value', value: ['asian', 'white'] } }) });
    expect(written(fieldOf(out, spec).write)).toEqual(['Asian', 'White']);
  });
});

describe('9 (ICIMS-08): iCIMS’s address search chooses "Enter manually"', () => {
  it('chooses it when the profile holds a street, and types no street into the search', () => {
    const name = 'rcf3048_PersonProfileFields.AddressStreet1';
    const lookup = specOf('Address', 'combobox', { nameAttr: name, required: true,
      optionLabels: ['4417 Quillfeather Ln, Austin, TX 78701', 'Enter manually'] });
    expect(planned([lookup], lookup).write).toMatchObject({ value: { kind: 'option', cleanLabel: 'Enter manually' },
      origin: { provenance: 'rule', ruleId: 'address.enter-manually' } });
    const box = specOf('Address', 'text', { nameAttr: name, required: true });
    expect(planned([box], box).write).toMatchObject({ value: { kind: 'text', text: '4417 Quillfeather Lane' } });
    const streetless = { ...golden, address: { ...golden.address!, line1: undefined } } as Profile;
    expect(planned([lookup], lookup, { profile: streetless }).write).toBeUndefined();
  });
});

describe('10 (ICIMS-10): a date’s day part', () => {
  it('reads the day after the label’s brackets', () => {
    expect(datePartOf('Start Date (if you do not know the day, enter 1) day')).toBe('day');
    expect(datePartOf('From Year (YYYY)')).toBe('year');
    expect(datePartOf('Start Date (if you do not know the day, enter 1) month')).toBe('month');
    expect(dayOfLabel('01')).toBe(1);
    expect(dayOfLabel('31st')).toBe(31);
    expect(dayOfLabel('32')).toBeNull();
  });

  it('chooses the date’s day, else the 1st, as the list shows it', () => {
    const days = (labels: string[]) => specOf('Start Date (if you do not know the day, enter 1) day', 'select', {
      section: { id: 'experience', block: 0 }, optionLabels: labels });
    const plain = days(['Day', ...Array.from({ length: 31 }, (_, at) => String(at + 1))]);
    const padded = days(['Day', ...Array.from({ length: 31 }, (_, at) => String(at + 1).padStart(2, '0'))]);
    expect(written(planned([plain], plain).write)).toBe('1');
    expect(written(planned([padded], padded).write)).toBe('01');
    expect(datePartChoice('Start date day', { y: 2021, m: 6, d: 14 }, padded.options)?.intended)
      .toEqual({ kind: 'text', text: '14' });
  });

  it('reads "day" as a part only in a box that holds one: a whole date box keeps the whole date', () => {
    const whole = specOf('Start date day', 'text', { section: { id: 'experience', block: 0 },
      constraints: { pattern: 'MM/YYYY' } });
    expect(written(planned([whole], whole).write)).toBe('06/2021');
  });

  it('types the year alone into the year box, and the day alone into a two-character day box', () => {
    const year = specOf('Start Date (if you do not know the day, enter 1) year', 'text', {
      section: { id: 'experience', block: 0 }, constraints: { maxLength: 4 } });
    const day = specOf('Start Date day', 'text', { section: { id: 'experience', block: 0 },
      constraints: { maxLength: 2 } });
    expect(written(planned([year], year).write)).toBe('2021');
    expect(written(planned([day], day).write)).toBe('1');
  });
});

describe('11 (JV-1, JZ-15): the date beside a signature is today', () => {
  it('sets a date control to today, and types today in the layout a box shows', () => {
    const date = specOf('Today\'s Date signature', 'date', { required: true });
    const box = specOf('Today\'s Date', 'text', { constraints: { pattern: 'MM/DD/YYYY' } });
    const out = planOf([date, box]);
    expect(fieldOf(out, date).write).toMatchObject({ value: { kind: 'date', iso: TODAY } });
    expect(fieldOf(out, box).write).toMatchObject({ value: { kind: 'text',
      text: `${String(NOW.m).padStart(2, '0')}/${String(NOW.d).padStart(2, '0')}/${NOW.y}` } });
  });

  it('follows the signature’s approval: required only, or left when optional and not approved', () => {
    const required = specOf('Date signed', 'date', { required: true });
    const optional = specOf('Signature date', 'date');
    const out = planOf([required, optional], { settings: CAUTIOUS_SETTINGS });
    expect(fieldOf(out, required).write?.origin).toEqual({ provenance: 'rule', ruleId: 'consent.required' });
    expect(fieldOf(out, optional)).toMatchObject({ write: undefined, row: { reason: 'consent-optional-unticked' } });
  });

  it('never writes over a date the field holds', () => {
    const held = specOf('Date signed', 'date', { required: true, current: { kind: 'text', text: '2026-10-01' } });
    expect(planned([held], held)).toMatchObject({ write: undefined, row: { reason: 'prefill-kept' } });
  });
});

describe('12 (JV-2): a veteran group labelled "Choose One" takes the profile’s veteran answer', () => {
  it('chooses "I am not a protected veteran" for the golden profile', () => {
    const spec = specOf('Choose One', 'radio', { optionLabels: ['I IDENTIFY AS ONE OR MORE OF THE CLASSIFICATIONS OF '
      + 'PROTECTED VETERANS LISTED ABOVE', 'I AM NOT A PROTECTED VETERAN', 'DECLINE SELF-IDENTIFICATION'] });
    expect(written(planned([spec], spec).write)).toBe('I AM NOT A PROTECTED VETERAN');
  });
});

describe('13 (JV-3, WD-26, ADP-14, O3): the county', () => {
  it('is skipped while the profile holds no county, and never sent to an AI', () => {
    const spec = specOf('County of Residence', 'select', { required: true, optionLabels: ['Select...', 'Travis',
      'White', 'Williamson'] });
    const out = planOf([spec]);
    expect(fieldOf(out, spec)).toMatchObject({ write: undefined, row: { category: 'address.county',
      reason: 'no-profile-value' } });
    expect([...out.ask?.answers ?? [], ...out.ask?.classify ?? []]).toEqual([]);
  });

  it('matches a county with or without its County, Parish or Borough, never an EEO-like neighbour', () => {
    const neutral = Array.from({ length: 55 }, (_, at) => `Neutral${String.fromCharCode(65 + (at % 26))}`
      + `${String.fromCharCode(97 + Math.floor(at / 26))}ville`);
    for (const labels of [['Travis', 'White', 'Williamson', ...neutral], ['Travis County', 'White County',
      ...neutral]]) {
      const choice = countyChoice('Travis County', vocab);
      const outcome = outcomeOf(matchInputOf(choice.intended, labels, 'generic'), false);
      expect(outcome.done && outcome.match.optionIndex, labels[0]).toBe(0);
    }
    const parish = countyChoice('Orleans', vocab);
    const outcome = outcomeOf(matchInputOf(parish.intended, ['Orleans Parish', 'White', ...neutral], 'generic'), false);
    expect(outcome.done && outcome.match.optionIndex).toBe(0);
  });
});

describe('14 (JV-4): a school district question is no school', () => {
  it('goes to the AI with its options, never matched as a school', () => {
    const spec = specOf('Have you been employed by any United States K-12 School District since 2016 in any capacity?',
      'select', { optionLabels: ['Select...', 'Yes', 'No'], required: true });
    const out = planOf([spec]);
    expect(fieldOf(out, spec).row.category).not.toBe('education.school');
    expect(out.ask?.classify?.map((item) => item.key)).toEqual([spec.key]);
  });
});

describe('15 (JV-6): a follow-up whose answer above is its opposite takes its one "Not Applicable"', () => {
  const above = (answer: string | null) => specOf('Are you currently subject to a non-compete agreement?', 'radio', {
    optionLabels: ['Yes', 'No'], required: true,
    ...(answer === null ? {} : { current: { kind: 'selected' as const, labels: [answer] } }) });
  const follow = (labels: string[]) => specOf('If yes, do the terms of the agreement restrict you from working at '
    + 'Sikich?', 'radio', { optionLabels: labels, required: true });
  it('chooses it when the answer above is No, flagged', () => {
    const question = follow(['Yes', 'No', 'Not Applicable']);
    const out = planOf(inOrder([above('No'), question]));
    expect(fieldOf(out, question)).toMatchObject({ write: { value: { cleanLabel: 'Not Applicable' },
      origin: { provenance: 'rule', ruleId: 'conditional.not-applicable' } }, row: { status: 'flagged' } });
  });

  it('chooses nothing when the answer above is Yes, missing, or the list offers no single one', () => {
    for (const [answer, labels] of [['Yes', ['Yes', 'No', 'Not Applicable']], [null, ['Yes', 'No', 'N/A']],
      ['No', ['Yes', 'No']], ['No', ['Yes', 'No', 'N/A', 'Not applicable']]] as const) {
      const question = follow([...labels]);
      const out = planOf(inOrder([above(answer), question]));
      expect(fieldOf(out, question).write, `${answer} ${labels.join('|')}`).toBeUndefined();
    }
  });
});

describe('16 (JV-9): the privacy policy’s residence', () => {
  const gate = (labels: string[]) => specOf('Location of Residence and Language', 'select', {
    optionLabels: labels, required: true });
  it('chooses the option naming the profile’s country, else the one real option, else a Global English one', () => {
    const byCountry = gate(['Select your location of residence and language', 'Canada - English',
      'United States - English', 'Global - English']);
    const single = gate(['Select...', 'Global NinjaOne Candidate Privacy Policy - English']);
    const global = gate(['Select...', 'EU - Deutsch', 'Global - English', 'Japan - 日本語']);
    // NinjaOne's own two options (fixtures/jobvite/ninjaone-consent-empty).
    const ninjaone = gate(['Select your location of residence and language',
      'Global NinjaOne Candidate Privacy Policy - English']);
    for (const [spec, label] of [[byCountry, 'United States - English'], [single,
      'Global NinjaOne Candidate Privacy Policy - English'], [global, 'Global - English'],
    [ninjaone, 'Global NinjaOne Candidate Privacy Policy - English']] as const) {
      expect(planned([spec], spec).write, label).toMatchObject({ value: { cleanLabel: label },
        origin: { provenance: 'rule', ruleId: 'location.policy-residence' } });
      expect(planned([spec], spec).row.status).toBe('flagged');
    }
  });
});

describe('17 (JV-14): NinjaOne asks to text the person', () => {
  it('chooses Yes under Consents: All, and nothing when it is optional and not approved', () => {
    const spec = specOf('Can NinjaOne text you about your application?', 'select', {
      optionLabels: ['Select an option...', 'Yes', 'No'] });
    expect(written(planned([spec], spec).write)).toBe('Yes');
    expect(planned([spec], spec, { settings: CAUTIOUS_SETTINGS }).write).toBeUndefined();
  });
});

describe('18 (JV-15, JV-22, ADP-19, U-11): a referral by an employee, and its name', () => {
  const referred = specOf('Were you referred to this role by a current NinjaOne employee?', 'select', {
    optionLabels: ['Select an option...', 'No, I was not referred', 'Yes, I was referred by a NinjaOne employee'],
    required: true });
  const name = specOf('If yes, please provide their name or enter N/A if you were not referred.', 'text', {
    required: true });
  it('answers No from a referral source that names nobody, and types the N/A the follow-up asks for', () => {
    const out = planOf(inOrder([referred, name]));
    expect(fieldOf(out, referred).write).toMatchObject({ value: { cleanLabel: 'No, I was not referred' },
      origin: { provenance: 'rule', ruleId: 'referral.not-employee' } });
    expect(fieldOf(out, name).write).toMatchObject({ value: { kind: 'text', text: 'N/A' },
      origin: { provenance: 'rule', ruleId: 'placeholder.no-profile' } });
  });

  it('answers nothing for an employee’s referral, a friend, or no source', () => {
    for (const referralSource of [{ id: 'employee-referral' }, { id: 'friend' }, undefined]) {
      const profile = { ...golden, referralSource } as Profile;
      expect(planned([referred], referred, { profile }).write, referralSource?.id).toBeUndefined();
    }
  });

  it('never sends an optional "Referral Name" to an AI', () => {
    const spec = specOf('Referral Name', 'text');
    const out = planOf([spec]);
    expect(fieldOf(out, spec)).toMatchObject({ write: undefined, row: { status: 'skipped' } });
    expect([...out.ask?.answers ?? [], ...out.ask?.classify ?? []]).toEqual([]);
  });

  it('answers ADP’s and UltiPro’s yes/no radios No', () => {
    for (const label of ['Did any of our employees inform you about this position?',
      'Were you referred by a current employee?']) {
      const spec = specOf(label, 'radio', { optionLabels: ['Yes', 'No'] });
      expect(written(planned([spec], spec).write), label).toBe('No');
    }
  });
});

describe('19 (JV-17): a question asked only of a place’s residents', () => {
  const illinois = specOf('If you live in Illinois, is your address in the City of Chicago?', 'select', {
    optionLabels: ['Select an option...', 'N/A - I do not live in Illinois.', 'Yes', 'No'], required: true });
  const boston = specOf('Question 10: If within commutable distance to Boston, MA, are you willing and able to work '
    + 'the Hybrid schedule?', 'radio', { optionLabels: ['Yes', 'No', 'Currently reside outside commutable distance'],
    required: true });
  it('chooses the option saying the golden profile (Austin, TX) lives elsewhere, flagged', () => {
    const out = planOf([illinois, boston]);
    expect(fieldOf(out, illinois)).toMatchObject({ write: { value: { cleanLabel: 'N/A - I do not live in Illinois.' },
      origin: { provenance: 'rule', ruleId: 'location.not-there' } }, row: { status: 'flagged' } });
    expect(written(fieldOf(out, boston).write)).toBe('Currently reside outside commutable distance');
  });

  it('chooses nothing for a person who lives there', () => {
    const local = { ...golden, address: { ...golden.address!, city: 'Springfield',
      region: { code: 'IL', name: 'Illinois' } } } as Profile;
    expect(planned([illinois], illinois, { profile: local }).write).toBeUndefined();
  });
});

describe('20 (jobvite-new-1): a restrictive agreement asked as a fact goes to the `all` scope’s AI', () => {
  const spec = specOf('Are you currently subject to a non-compete, non-solicitation or any other restrictive '
    + 'employment agreement?', 'radio', { optionLabels: ['Yes', 'No'], required: true });
  it('is asked in the all scope, never the standard one, and the profile’s own answer comes first', () => {
    expect(planOf([spec]).ask?.answers?.map((item) => item.scope)).toEqual(['all']);
    expect(planOf([spec], { settings: settingsWith({ modes: { ...DEFAULT_SETTINGS.modes, ai: 'profile' } }) })
      .ask?.answers ?? []).toEqual([]);
    const answered = { ...golden, screening: { ...golden.screening,
      restrictiveAgreement: { kind: 'value' as const, value: false } } };
    expect(written(planned([spec], spec, { profile: answered }).write)).toBe('No');
  });

  // jr6 fix (revD-04): no résumé settles a contract the person may be bound by: TailorIT's answer is a guess, shown so
  // and counted by the auto-apply agent's legal-guess rule, whatever basis it came with.
  it('writes the AI’s answer as an "AI guess" whatever its basis, a legal guess', () => {
    for (const basis of ANSWER_BASES) {
      const verdict: AnswerVerdict = { key: spec.key, kind: 'choice', optionSetHash: spec.optionSetHash, index: 1,
        labelHash: sha256Hex('No'), basis, taskId: 'c3e5a7b9-2d4f-4b6c-8e0a-1f3b5d7e9a20' };
      const { write, row } = fieldOf(planOf([spec], { ai: { verdicts: new Map(), classifications: new Map(),
        answers: new Map([[spec.key, verdict]]) } }), spec);
      expect(write, basis).toMatchObject({ value: { kind: 'option', cleanLabel: 'No' },
        origin: { provenance: 'llm-pick' } });
      expect(row, basis).toMatchObject({ category: 'screening.restrictiveAgreement', status: 'verified',
        reason: 'ai-guess', needsUserAction: false });
      // The orchestrator's legal-guess fact (content/orchestrator.ts submitFacts) reads the row so.
      expect(row.reason === 'ai-guess' && policyClassOf(row.category) === 'legal', basis).toBe(true);
    }
  });

  it('never opens an ask to agree to one', () => {
    const ask = specOf('Do you agree to sign a non-compete agreement?', 'radio', { optionLabels: ['Yes', 'No'] });
    expect(planOf([ask]).ask?.answers ?? []).toEqual([]);
  });

  // jr6 fix (revD-01): the essential functions ask about a disability or the accommodation it needs, a
  // self-identification's topic: the profile's explicit answer, else the person's, never an AI's (in any scope).
  it('never asks the AI an essential-functions, accommodation or health question', () => {
    const wordings = ['Can you perform the essential functions of this job without reasonable accommodation?',
      'Can you perform the essential functions of this job with or without reasonable accommodation?',
      'Do you require a reasonable accommodation to perform the essential functions of this job?',
      'Do you need an accommodation to perform the essential functions of this position?',
      'Do you have any physical or mental condition that would prevent you from performing the essential functions '
        + 'of this job?',
      // No health word at all: closed by its category alone.
      'Are you able to perform the essential functions of this position?'];
    for (const label of wordings) {
      const question = specOf(label, 'radio', { optionLabels: ['Yes', 'No'], required: true });
      expect(fieldOf(planOf([question]), question).row.category, label).toBe('screening.essentialFunctions');
      expect(planOf([question]).ask?.answers ?? [], label).toEqual([]);
    }
    // A health question no rule classifies, once the classifier knows no category for it: no answer is asked either.
    const health = specOf('Do you have any physical or mental condition that may affect your work here?', 'radio',
      { optionLabels: ['Yes', 'No'], required: true });
    const ai = { verdicts: new Map(), classifications: new Map([[health.key as string, { key: health.key,
      category: null, why: 'unknown-field' as const }]]) };
    expect(planOf([health], { ai }).ask?.answers ?? []).toEqual([]);
    // The profile's own answer is still written by rule.
    const able = { ...golden, screening: { ...golden.screening,
      essentialFunctions: { kind: 'value' as const, value: true } } };
    const first = specOf(wordings[0]!, 'radio', { optionLabels: ['Yes', 'No'], required: true });
    expect(written(planned([first], first, { profile: able }).write)).toBe('Yes');
  });

  it('reads "agreement" as a contract only in a restrictive agreement, never in a consent', () => {
    expect(openTopicsOfTexts(['Are you currently subject to a non-compete, non-solicitation or any other restrictive '
      + 'employment agreement?'], ['Yes', 'No'], vocab, false)).toEqual(new Set());
    expect(openTopicsOfTexts(['Do you agree to our terms of employment?'], ['Yes', 'No'], vocab, false)).toBeNull();
    expect(openTopicsOfTexts(['Do you agree to sign a confidentiality agreement?'], ['Yes', 'No'], vocab, false))
      .toBeNull();
  });
});

describe('21 (JZ-6): JazzHR’s race list', () => {
  const RACES = ['Decline to answer', 'Hispanic or Latino', 'White, not Hispanic or Latino',
    'Black or African-American, not Hispanic or Latino', 'Asian, not Hispanic or Latino',
    'Two or More Races, not Hispanic or Latino', 'MENA (Middle Eastern and North African)'];
  const spec = specOf('Race/Ethnicity', 'select', { optionLabels: RACES, required: true });
  it('reads ", not Hispanic or Latino" as the bracket, and MENA by its spelled-out name', () => {
    const white = withEeo({ race: { kind: 'value', value: ['white'] }, hispanicLatino: { kind: 'value', value: false } });
    const mena = withEeo({ race: { kind: 'value', value: ['middle-eastern-north-african'] },
      hispanicLatino: { kind: 'value', value: false } });
    expect(written(planned([spec], spec, { profile: white }).write)).toBe('White, not Hispanic or Latino');
    expect(written(planned([spec], spec, { profile: mena }).write)).toBe('MENA (Middle Eastern and North African)');
  });

  it('flags a race given with no Hispanic answer, never declines it', () => {
    const profile = withEeo({ race: { kind: 'value', value: ['white'] }, hispanicLatino: undefined });
    expect(planned([spec], spec, { profile })).toMatchObject({ write: undefined, row: { status: 'flagged' } });
  });

  it('flags a list with an option it cannot read, never declines it', () => {
    const odd = specOf('Race', 'select', { optionLabels: ['Decline to answer', 'Asian', 'Something we cannot read'] });
    const white = withEeo({ race: { kind: 'value', value: ['white'] } });
    expect(planned([odd], odd, { profile: white })).toMatchObject({ write: undefined, row: { status: 'flagged' } });
    // A list it reads whole that does not offer the answer is still declined (s2 core-gh, decision 12).
    const known = specOf('Race', 'select', { optionLabels: ['Decline to answer', 'Asian', 'Black or African American'] });
    expect(written(planned([known], known, { profile: white }).write)).toBe('Decline to answer');
  });
});

describe('22 (SR-3): "In your own words" turns off no AI', () => {
  it('lets the step’s other questions go to the AI, and keeps an affirmed statement an attestation', () => {
    const essay = specOf('Think about the industry or part of the business this role serves. In your own words, '
      + 'what’s one real challenge they face, and how does your experience relate?', 'textarea', { required: true });
    const source = specOf('How did you first hear about this opportunity?', 'select', { optionLabels: ['Select...',
      'Company website', 'Other'] });
    const out = planOf(inOrder([essay, source]));
    expect(out.aiAttestation).toBeUndefined();
    expect(fieldOf(out, source).row.reason).not.toBe('ai-off-for-posting');
    const box = specOf('I confirm this application is my own work', 'checkbox');
    expect(planOf([box]).aiAttestation).toBe(true);
    expect(classifyField(essay, vocab)).toMatchObject({ by: 'rules', rules: { category: 'freeText.other' } });
  });

  // jr6 fix (RULES-R22): affirmed on a box or a choice, "in my own words" is the attestation: never ticked once AI was
  // used (the owner's rule of 2026-11-01), and it makes the frame profile-only.
  it('never ticks "… in my own words" once the run used AI, and reads the radio as the attestation', () => {
    for (const label of ['I certify that all answers are in my own words',
      'I confirm that I wrote all of my answers in my own words']) {
      const box = specOf(label, 'checkbox', { required: true });
      const out = planOf([box], { aiUsed: true });
      expect(fieldOf(out, box).write, label).toBeUndefined();
      expect(fieldOf(out, box).row.category, label).toBe('consent.aiAttestation');
      expect(out.aiAttestation, label).toBe(true);
    }
    const radio = specOf('Are your answers written in your own words?', 'radio', { optionLabels: ['Yes', 'No'],
      required: true });
    const out = planOf([radio], { aiUsed: true });
    expect(fieldOf(out, radio).write).toBeUndefined();
    expect(out.aiAttestation).toBe(true);
  });
});

describe('23 (U-02): UltiPro’s period boxes', () => {
  it('fill a school’s start and end, and leave a current job’s end', () => {
    const school = { id: 'education', block: 0 };
    const job = { id: 'experience', block: 0 };
    const fromYear = specOf('From Year (YYYY)', 'text', { section: school, constraints: { maxLength: 4 } });
    const toMonth = specOf('To Month', 'select', { section: school, optionLabels: ['Jan', 'Feb', 'Mar', 'Apr', 'May',
      'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] });
    const jobTo = specOf('To Year (YYYY)', 'text', { section: job });
    const out = planOf([fromYear, toMonth, jobTo]);
    expect(written(fieldOf(out, fromYear).write)).toBe('2015');
    expect(written(fieldOf(out, toMonth).write)).toBe('May');
    expect(fieldOf(out, jobTo)).toMatchObject({ write: undefined, row: { reason: 'end-date-not-applicable' } });
  });
});

describe('24 (U-09, ADP-17): an EEO decline box beside its list', () => {
  const gender = specOf('Gender', 'select', { optionLabels: ['Select...', 'Male', 'Female'], required: true,
    section: { id: 'eeo' } });
  const genderBox = specOf('Gender I decline to say', 'checkbox', { section: { id: 'eeo' } });
  it('is ticked for the person’s explicit decline the list lacks, and the list is then left without a flag', () => {
    const out = planOf(inOrder([gender, genderBox]));
    expect(fieldOf(out, genderBox).write).toMatchObject({ value: { kind: 'check' },
      origin: { provenance: 'rule', ruleId: 'eeo.decline' } });
    expect(fieldOf(out, gender)).toMatchObject({ write: undefined,
      row: { status: 'skipped', reason: 'decline-option-missing' } });
  });

  it('is left when the list offers its own decline, or when the person answers the question', () => {
    const offering = specOf('Gender', 'select', { optionLabels: ['Male', 'Female', 'I do not wish to answer'],
      section: { id: 'eeo' } });
    const out = planOf(inOrder([offering, genderBox]));
    expect(written(fieldOf(out, offering).write)).toBe('I do not wish to answer');
    expect(fieldOf(out, genderBox)).toMatchObject({ write: undefined, row: { status: 'skipped',
      reason: 'already-correct' } });
    const answered = planOf(inOrder([gender, genderBox]), { profile: withEeo({ gender: { kind: 'value',
      value: { identity: 'female' } } }) });
    expect(written(fieldOf(answered, gender).write)).toBe('Female');
    expect(fieldOf(answered, genderBox)).toMatchObject({ write: undefined, row: { status: 'skipped' } });
  });

  it('reads UltiPro’s "Ethnic Origin" as the Hispanic question, and ADP’s box beside answered lists', () => {
    const origin = specOf('Ethnic Origin', 'select', { optionLabels: ['Hispanic/Latino', 'Not Hispanic/Latino'],
      section: { id: 'eeo' } });
    const originBox = specOf('Ethnic Origin I decline to say', 'checkbox', { section: { id: 'eeo' } });
    const out = planOf(inOrder([origin, originBox]));
    expect(fieldOf(out, origin).row.category).toBe('eeo.hispanicLatino');
    expect(fieldOf(out, originBox).write).toMatchObject({ value: { kind: 'check' } });
    const race = specOf('Race', 'select', { optionLabels: ['Asian', 'White', 'I do not wish to answer'],
      section: { id: 'self-id' } });
    const adpBox = specOf('I decline to identify my race and ethnicity', 'checkbox', { section: { id: 'self-id' } });
    const adp = planOf(inOrder([race, adpBox]));
    expect(fieldOf(adp, adpBox)).toMatchObject({ write: undefined, row: { status: 'skipped' } });
  });
});

describe('25 (JV-5): a checklist of qualifications', () => {
  const QUALIFICATIONS = 'Please select the education, skills and/or experience that you currently possess';
  const checklist = specOf('Please select the education, skills and/or experience that you currently possess',
    'checkbox-group', { required: true, optionLabels: [
      '1. Associate or bachelor’s degree in Computer Science or a related field',
      '2. Experience working in the publishing or ed-tech industry',
      '3. Experience with relational databases (such as PostgreSQL and MySQL)',
      '4. Experience with Chef, Packer', '5. Experience with GitHub Actions'] });
  it('ticks, flagged, only the options naming a skill or a degree the person holds', () => {
    const { write, row } = planned([checklist], checklist);
    expect(written(write)).toEqual(['1. Associate or bachelor’s degree in Computer Science or a related field',
      '3. Experience with relational databases (such as PostgreSQL and MySQL)']);
    expect(write?.origin).toEqual({ provenance: 'rule', ruleId: 'skills.qualifications', path: 'skills' });
    expect(row.status).toBe('flagged');
  });

  // jr6 fix (revD-02): a ticked box says "I currently possess this": an option naming a skill or a degree the person
  // holds is ticked only when nothing else it states is unmet (the golden profile: TypeScript, PostgreSQL and
  // Kubernetes, a BS in Computer Science, jobs since 2019-07, no certification).
  it('ticks no option whose years, degree field, credential or joined tool the profile does not hold', () => {
    const relational = 'Experience with relational databases such as PostgreSQL and MySQL';
    const claims = specOf(QUALIFICATIONS, 'checkbox-group', { required: true, optionLabels: ['10+ years of experience running Kubernetes in production',
        'Bachelor’s degree in Accounting, Finance or a related field',
        'Active Certified Kubernetes Administrator (CKA) certification', relational,
        'Experience with Kubernetes and Terraform'] });
    const { write, row } = planned([claims], claims);
    expect(written(write)).toEqual([relational]);
    expect(row).toMatchObject({ status: 'flagged', reason: 'filled-low-confidence' });
  });

  it('ticks an option whose years, field, credential and tools the profile holds', () => {
    const held = specOf(QUALIFICATIONS, 'checkbox-group', { optionLabels: [
      'Bachelor’s degree and 5+ years of experience', 'Bachelor’s degree in Computer Science or a related field',
      'Experience with Kubernetes, Terraform or Pulumi', 'Experience with TypeScript and PostgreSQL',
      'Bachelor’s degree and 3+ years of software engineering experience', 'Experience with Go and Rust'] });
    expect(written(planned([held], held).write)).toEqual(['Bachelor’s degree and 5+ years of experience',
      'Bachelor’s degree in Computer Science or a related field', 'Experience with Kubernetes, Terraform or Pulumi',
      'Experience with TypeScript and PostgreSQL', 'Bachelor’s degree and 3+ years of software engineering experience']);
    // A certification the profile lists, by its name.
    const certified = { ...golden, certifications: [{ name: 'Certified Kubernetes Administrator' }] };
    const cka = specOf(QUALIFICATIONS, 'checkbox-group', { optionLabels: [
      'Active Certified Kubernetes Administrator (CKA) certification', 'Experience with Go and Rust',
      'Experience with Java'] });
    expect(written(planned([cka], cka, { profile: certified }).write)).toEqual([
      'Active Certified Kubernetes Administrator (CKA) certification']);
  });

  it('leaves a plain skills list to the skills, and ticks nothing when no option names one', () => {
    const plain = specOf('Skills', 'checkbox-group', { optionLabels: ['TypeScript', 'Go', 'PostgreSQL'] });
    expect(written(planned([plain], plain).write)).toEqual(['TypeScript', 'PostgreSQL']);
    const none = specOf('Which of these do you have?', 'checkbox-group', { optionLabels: [
      '1. Experience with Chef, Packer', '2. Experience with GitHub Actions', '3. Knowledge of Rust tooling'] });
    expect(planned([none], none).write).toBeUndefined();
  });
});
