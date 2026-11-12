/*
 * jr7 RULES-7 (FIX7PLAN §6.3): every label the snapshot7 audits gave the rules, with the category and the rule id the
 * classifier now gives it, and the near misses each widened or narrowed rule must not catch. Labels are the pages' own
 * text (the audits' quotations of the owner's snapshot7 captures: questions, never answers); no value of the owner's
 * appears here.
 */
import { describe, expect, it } from 'vitest';
import type { FieldKind } from '../enums';
import { specOf, vocab } from '../plan/plan.testkit';
import type { FieldSpec, SectionRef } from '../types/field';
import type { FieldCategory } from '../types/intent';
import { classifyByRules } from './classifyRules';
import { classifyField } from './resolve';

/** One labelled field: its label, its kind, and what else the scanner gives it. */
interface Case {
  label: string;
  kind: FieldKind;
  section?: SectionRef;
  options?: string[];
  nameAttr?: string;
  description?: string;
  pattern?: string;
}

const specFor = (field: Case): FieldSpec => specOf(field.label, field.kind, {
  ...(field.section ? { section: field.section } : {}), ...(field.options ? { optionLabels: field.options } : {}),
  ...(field.nameAttr ? { nameAttr: field.nameAttr } : {}), ...(field.description ? { description: field.description } : {}),
  ...(field.pattern ? { constraints: { pattern: field.pattern } } : {}) });

/** What the rules say: the category (or what a hand-over asks about), the rule id and the hand-over's cause. */
function read(field: Case) {
  const spec = specFor(field);
  const classified = classifyField(spec, vocab);
  const rules = classified.by === 'rules' ? classified.rules : null;
  return { category: rules?.category ?? rules?.asks ?? null, rule: rules?.rule ?? null,
    needsUser: rules?.needsUser ?? null, byRules: classifyByRules(spec) };
}

const YES_NO = ['Yes', 'No'];

// Workday's aristocrat (snapshot7 workday1).
const ARISTOCRAT_SPONSORSHIP = 'Will you now, or in the future, require any immigration filing or visa sponsorship by '
  + 'Aristocrat to maintain work authorization (renewal/extension of open work permit, permanent residency, etc.)?';
// careers-quartzbenefits' attestation (snapshot7 icims3), as the audit quotes it.
const QUARTZ_CERTIFY = 'I certify that the information provided in this application, is true, complete and correct. I '
  + 'confirm that all statements regarding my skills, qualifications, and experiences, are my own.';
const QUARTZ_BACKGROUND = 'Quartz supports a safe, drug-free workplace. All employment offers are contingent upon '
  + 'successful completion of a pre-employment criminal background check. Are you willing to submit to a '
  + 'pre-employment background check if offered a position?';
// Greenhouse's Zip (snapshot7 greenhouse).
const ZIP_SPONSORSHIP = 'Do you now or will you in the future require any form of immigration sponsorship or work '
  + 'authorization support from Zip to legally work in the United States (e.g. new visa, transfer, renewal, extension, '
  + 'green card, etc.)?';

/** [finding, the field, the category it asks, the rule id]. */
const LABELS: Array<[string, Case, FieldCategory, string]> = [
  // WD7-01: five words between the need and the sponsorship.
  ['WD7-01', { label: ARISTOCRAT_SPONSORSHIP, kind: 'combobox', options: YES_NO }, 'workAuth.sponsorship',
    'label.sponsorship'],
  ['WD7-01', { label: ARISTOCRAT_SPONSORSHIP, kind: 'select', options: YES_NO }, 'workAuth.sponsorship',
    'label.sponsorship'],
  // jr6 WD-13 and the s2 OneStream rows stay.
  ['WD7-01 (WD-13 stays)', { label: 'Will you now or in the future require support from an employer to obtain/extend a '
    + 'work visa/permit in order to be employed (for example, H-1B, TN, Forms I-983/STEM OPT or other employment-based '
    + 'sponsorship/ support)?', kind: 'combobox' }, 'workAuth.sponsorship', 'label.sponsorship'],
  ['WD7-01 (OneStream stays)', { label: 'Will you now or in the future require OneStream to sponsor your employment visa '
    + 'status/work authorization in the country/province you are applying for?', kind: 'select', options: YES_NO },
  'workAuth.sponsorship', 'label.sponsorship'],
  // WD7-01, negative: an authorization question with a later disclaimer about sponsorship stays authorization.
  ['WD7-01 (disclaimer)', { label: 'Are you legally authorized to work in the United States? Candidates who will require '
    + 'any immigration filing or visa sponsorship are not eligible.', kind: 'radio', options: YES_NO },
  'workAuth.authorized', 'label.work-auth'],
  // WD7-02: a notice period in a box of prose.
  ['WD7-02', { label: 'What is your notice period in weeks, if applicable?', kind: 'textarea' },
    'availability.noticePeriod', 'label.notice'],
  // ICIMS7-06: an attestation that names skills, on a list of Yes and No, is the consent, never the skills list.
  ['ICIMS7-06', { label: QUARTZ_CERTIFY, kind: 'select', options: YES_NO }, 'consent.other', 'label.consent-generic'],
  ['ICIMS7-06', { label: QUARTZ_CERTIFY, kind: 'combobox', options: YES_NO }, 'consent.other', 'label.consent-generic'],
  // ICIMS7-07: a willingness to undergo a background check is the background-check consent.
  ['ICIMS7-07', { label: QUARTZ_BACKGROUND, kind: 'select', options: YES_NO }, 'consent.backgroundCheck',
    'label.consent-background'],
  ['ICIMS7-07', { label: QUARTZ_BACKGROUND, kind: 'combobox', options: YES_NO }, 'consent.backgroundCheck',
    'label.consent-background'],
  ['ICIMS7-07', { label: 'Do you consent to a criminal background check?', kind: 'select', options: YES_NO },
    'consent.backgroundCheck', 'label.consent-background'],
  // ICIMS7-V3: the salary's parts by the label contract (FIX7PLAN §3.3).
  ['ICIMS7-V3', { label: 'Desired Salary time frame', kind: 'select', options: ['Hr.', 'Da.', 'Wk.', 'Mo.', 'Yr.'] },
    'salary.period', 'label.pay-basis'],
  ['ICIMS7-V3', { label: 'Desired Salary currency', kind: 'select', options: ['USD $', 'EUR €'] }, 'salary.currency',
    'label.currency'],
  ['ICIMS7-V3', { label: 'Desired Salary amount', kind: 'text' }, 'salary.expected', 'label.salary'],
  // ADP7-4: a time zone on a list that takes several.
  ['ADP7-4', { label: 'What time zone do you live in?', kind: 'multiselect', options: ['Eastern Time', 'Central Time'] },
    'preferences.timeZone', 'label.time-zone'],
  // UP7-08: legally eligible to begin employment; a truthful certification; a restrictive agreement in a box of prose.
  ['UP7-08', { label: 'If offered employment by Acme, would you be legally eligible in the United States to begin '
    + 'employment immediately?', kind: 'radio', options: YES_NO }, 'workAuth.authorized', 'label.work-auth'],
  ['UP7-08', { label: 'I confirm that the information provided within this application is truthful, complete, and '
    + 'accurate.', kind: 'checkbox' }, 'consent.other', 'label.consent-generic'],
  // J7-GH-1: the sponsorship question that names Zip, on a combobox and a text box.
  ['J7-GH-1', { label: ZIP_SPONSORSHIP, kind: 'combobox', options: YES_NO }, 'workAuth.sponsorship',
    'label.sponsorship'],
  ['J7-GH-1', { label: ZIP_SPONSORSHIP, kind: 'text' }, 'workAuth.sponsorship', 'label.sponsorship'],
  ['J7-GH-1', { label: 'Have you previously worked at Zip?', kind: 'combobox', options: YES_NO },
    'screening.previouslyEmployed', 'label.previously-employed'],
  ['J7-GH-1', { label: 'How did you hear about Zip?', kind: 'text' }, 'referral.source', 'label.referral-source'],
  ['J7-GH-1', { label: 'Why do you want to work at Zip?', kind: 'textarea' }, 'freeText.whyCompany',
    'label.why-company'],
  // J7-GH-1, the ZIP questions that stay the postal code.
  ['J7-GH-1 (stays)', { label: 'Zip', kind: 'text' }, 'address.postalCode', 'label.postal'],
  ['J7-GH-1 (stays)', { label: 'Zip Code', kind: 'text' }, 'address.postalCode', 'label.postal'],
  ['J7-GH-1 (stays)', { label: 'ZIP / Postal code', kind: 'text' }, 'address.postalCode', 'label.postal'],
  ['J7-GH-1 (stays)', { label: 'Please enter your 5 digit zip code', kind: 'text' }, 'address.postalCode',
    'label.postal'],
  ['J7-GH-1 (stays)', { label: 'Please provide the zip code of your current home address', kind: 'text' },
    'address.postalCode', 'label.postal'],
  ['J7-GH-1 (stays)', { label: 'In what zip code do you currently reside?', kind: 'text' }, 'address.postalCode',
    'label.postal'],
  // RBP7-19: Pinpoint's source as a textarea.
  ['RBP7-19', { label: 'How did you hear about this job?', kind: 'textarea' }, 'referral.source',
    'label.referral-source'],
  // EFA-10: Eightfold's self-identification wordings.
  ['EFA-10', { label: 'Voluntary Self-Identification of Gender', kind: 'radio',
    options: ['Male', 'Female', 'Gender Nonconforming', 'I don\'t wish to answer'] }, 'eeo.gender', 'label.gender'],
  ['EFA-10', { label: 'Voluntary Self-Identification of Sexual Orientation', kind: 'radio',
    options: ['Heterosexual', 'Gay', 'I don\'t wish to answer'] }, 'eeo.sexualOrientation', 'label.orientation'],
  // DF7-V3: Dayforce's candidate acknowledgement is the application's terms.
  ['DF7-V3', { label: 'I agree to the Candidate Acknowledgement', kind: 'checkbox' }, 'consent.terms',
    'label.consent-terms'],
];

describe('jr7 RULES-7 R1: the snapshot7 audits’ labels', () => {
  it.each(LABELS)('%s: %j', (_finding, field, category, rule) => {
    expect(read(field)).toMatchObject({ category, rule, needsUser: null });
  });
});

describe('ICIMS7-06: a skills list is never a Yes and No list, nor an attestation', () => {
  it('turns the skills rule away on a Yes/No list, keeping a skills list of skills', () => {
    expect(read({ label: 'Do you have skills in Python?', kind: 'combobox', options: YES_NO }).category)
      .not.toBe('skills.list');
    expect(read({ label: 'Please list your skills', kind: 'textarea' }).category).toBe('skills.list');
    expect(read({ label: 'Skills', kind: 'combobox', options: ['Python', 'Go'] }).category).toBe('skills.list');
    // A placeholder option aside, the list is still a Yes and a No.
    expect(read({ label: 'Do you have the skills required?', kind: 'select',
      options: ['Make a Selection', 'Yes', 'No'] }).category).not.toBe('skills.list');
  });
  it('turns it away on certify wording, whatever the kind', () => {
    for (const label of ['I hereby certify my skills are accurate', 'To the best of my knowledge my skills are listed',
      'I attest that the skills above are my own']) {
      expect(read({ label, kind: 'textarea' }).category, label).not.toBe('skills.list');
    }
  });
});

describe('ICIMS7-07: a conviction question stays criminal history', () => {
  it.each([
    'Have you ever been convicted of a felony?',
    'Are you willing to disclose any criminal convictions in a background check?',
    'Have you been arrested or charged? We will run a background check if you are willing.',
  ])('%s', (label) => {
    expect(read({ label, kind: 'select', options: YES_NO })).toMatchObject({ category: 'screening.criminalHistory' });
  });
});

describe('UP7-08: a restrictive agreement asked as a fact in a box of prose', () => {
  it('is the restrictive agreement, the person’s, never the binding waiver', () => {
    const textarea = read({ label: 'Are you currently subject to any non-competition, non-solicitation, or other '
      + 'restrictive covenant agreement with a current or former employer? If yes, please explain.', kind: 'textarea' });
    expect(textarea).toMatchObject({ category: 'screening.restrictiveAgreement', rule: 'label.restrictive-agreement',
      needsUser: 'kind-mismatch' });
    // The radio question of the same family stays as before; an ask to agree to one stays the binding waiver.
    expect(read({ label: 'Are you currently bound to any Employment and/ or Company Agreement (non-competition, '
      + 'non-solicitation, confidentiality)?', kind: 'radio', options: YES_NO }))
      .toMatchObject({ category: 'screening.restrictiveAgreement', needsUser: null });
    expect(read({ label: 'Do you agree to sign a non-compete agreement?', kind: 'textarea' }))
      .toMatchObject({ needsUser: 'binding-waiver' });
  });
});

describe('UKGR-14: a national id or a social security number', () => {
  it.each<[string, Case]>([
    ['the placeholder mask alone (UKG Ready)', { label: '999-99-9999', kind: 'text', pattern: '999-99-9999',
      nameAttr: 'SSN' }],
    ['the mask as the only label', { label: '999-99-9999', kind: 'text' }],
    ['the mask in the pattern', { label: 'Number', kind: 'text', pattern: '###-##-####' }],
    ['the name SSN', { label: '', kind: 'text', nameAttr: 'SSN' }],
    ['"Primary National ID" (its type)', { label: 'Primary National ID', kind: 'select', options: ['SSN'] }],
    ['"Social Security Number"', { label: 'Social Security Number', kind: 'text' }],
    ['"Last 4 digits of your SSN"', { label: 'Last 4 digits of your SSN', kind: 'text' }],
    ['"National Insurance Number"', { label: 'National Insurance Number', kind: 'text' }],
  ])('%s is identity.nationalId, handed to the person', (_name, field) => {
    expect(read(field)).toMatchObject({ category: 'identity.nationalId', rule: 'label.national-id',
      needsUser: 'identifier' });
  });
  it.each<[string, Case, FieldCategory]>([
    ['a phone mask', { label: 'Phone', kind: 'text', pattern: '(999) 999-9999' }, 'contact.phone'],
    ['a phone mask with no label', { label: '999-999-9999', kind: 'text', pattern: '999-999-9999' }, 'contact.phone'],
  ])('%s stays the phone', (_name, field, category) => {
    const spec = { ...specFor(field), constraints: { pattern: field.pattern!, format: 'tel' as const } };
    const classified = classifyField(spec, vocab);
    expect(classified.by === 'rules' ? classified.rules.category : null).toBe(category);
  });
  it('never takes a question about social security benefits', () => {
    expect(read({ label: 'Do you receive Social Security disability benefits?', kind: 'radio', options: YES_NO })
      .category).not.toBe('identity.nationalId');
  });
});

describe('UKGR-13: nobody’s own details in a references section', () => {
  const REFERENCES: SectionRef = { id: 'professional-references' };
  it.each<[string, FieldKind]>([['Company', 'text'], ['Email', 'text'], ['Phone Number', 'text'], ['First Name', 'text'],
    ['Last Name', 'text'], ['Job Title', 'text']])('%s is no contact, identity or experience field', (label, kind) => {
    const { category } = read({ label, kind, section: REFERENCES });
    expect(category === null || !/^(?:contact|identity|experience|address)\./.test(category), String(category))
      .toBe(true);
  });
  it('a phone box there is no phone either, by its type', () => {
    const spec = { ...specFor({ label: 'Phone Number', kind: 'text', section: REFERENCES }),
      constraints: { format: 'tel' as const } };
    const rules = classifyByRules(spec);
    expect(rules?.category ?? rules?.asks ?? null).not.toBe('contact.phone');
  });
});

describe('J7-GH-1: a question that names Zip', () => {
  it('reads a yes-or-no question about ZIP codes as no postal code', () => {
    expect(read({ label: 'Is your zip code within 50 miles of the office?', kind: 'radio', options: YES_NO }).category)
      .not.toBe('address.postalCode');
  });
});

describe('EFA-10: Eightfold’s self-identification and acknowledgement labels', () => {
  it('reads the other self-identification wordings as before', () => {
    expect(read({ label: 'Voluntary Self-Identification of Disability', kind: 'radio', options: YES_NO }).category)
      .toBe('eeo.disability');
    expect(read({ label: 'Gender Identity', kind: 'select', options: ['Male', 'Female'] }).category).toBe('eeo.gender');
    // Gender beside a transgender wording stays the transgender question.
    expect(read({ label: 'Voluntary Self-Identification of Gender Identity assigned at birth', kind: 'radio',
      options: YES_NO }).category).not.toBe('eeo.gender');
  });
  it('reads an "Acknowledge" box by its legend: privacy, and an AI attestation where it names AI', () => {
    const privacy = read({ label: 'Acknowledge', kind: 'checkbox', description: 'By clicking the "Acknowledge" button, '
      + 'you acknowledge that Twilio processes data in accordance with the Twilio Applicant Privacy Policy.' });
    expect(privacy.byRules?.consentKinds).toContain('consent.privacy');
    const ai = read({ label: 'Acknowledge', kind: 'checkbox', description: 'By checking this box, I confirm I have read, '
      + 'reviewed and understood the guidelines outlined in the Candidate AI Responsible Use Policy. I affirm that all the '
      + 'information and materials I submit throughout my application and candidacy will reflect my own work and '
      + 'experience.' });
    expect(ai.byRules?.consentKinds?.[0]).toBe('consent.aiAttestation');
  });
});
