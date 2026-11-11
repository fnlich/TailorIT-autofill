/*
 * jr6 RULES (FIXPLAN §6.3 R1, items 1 to 25): every label the eight platform audits gave, with the category and the
 * rule id the classifier now gives it, and the near misses each widened rule must not catch. Labels are the pages'
 * own text (the audits' quotations of the owner's snapshots: questions, never answers); no value of the owner's
 * appears here.
 */
import { describe, expect, it } from 'vitest';
import type { FieldKind } from '../enums';
import { specOf } from '../plan/plan.testkit';
import type { SectionRef } from '../types/field';
import type { FieldCategory } from '../types/intent';
import { classifyByRules } from './classifyRules';
import { classifyField } from './resolve';
import { vocab } from '../plan/plan.testkit';

/** One labelled field: its label, its kind, and what else the scanner gives it. */
interface Case {
  label: string;
  kind: FieldKind;
  section?: SectionRef;
  options?: string[];
  nameAttr?: string;
  idAttr?: string;
}

/** What the rules say: the category (or what a hand-over asks about), the rule id and the hand-over's cause. */
function read(field: Case) {
  const spec = specOf(field.label, field.kind, { ...(field.section ? { section: field.section } : {}),
    ...(field.options ? { optionLabels: field.options } : {}), ...(field.nameAttr ? { nameAttr: field.nameAttr } : {}),
    ...(field.idAttr ? { idAttr: field.idAttr } : {}) });
  const classified = classifyField(spec, vocab);
  const rules = classified.by === 'rules' ? classified.rules : null;
  return { category: rules?.category ?? rules?.asks ?? null, rule: rules?.rule ?? null,
    needsUser: rules?.needsUser ?? null, byRules: classifyByRules(spec) };
}

const VETERAN_STATEMENTS = ['I IDENTIFY AS ONE OR MORE OF THE CLASSIFICATIONS OF PROTECTED VETERANS LISTED ABOVE',
  'I AM NOT A PROTECTED VETERAN', 'DECLINE SELF-IDENTIFICATION'];
const JOB: SectionRef = { id: 'experience', block: 0 };
const SCHOOL: SectionRef = { id: 'education', block: 0 };
const TERMS_BOX = 'acceptTermsAndAgreements';
const STREET = 'rcf3048_PersonProfileFields.AddressStreet1';

/** [item and finding, the field, the category it asks, the rule id]. */
const LABELS: Array<[string, Case, FieldCategory, string]> = [
  // 1. WD-08: Workday's Voluntary Disclosures race and ethnicity questions.
  ['1 WD-08', { label: 'Please select the ethnicity which most accurately describes how you identify yourself.',
    kind: 'select' }, 'eeo.race', 'label.race'],
  ['1 WD-08', { label: 'Please select the ethnicity witch most accurately describe(s) how you identify yourself.',
    kind: 'checkbox-group' }, 'eeo.race', 'label.race'],
  ['1 WD-08', { label: 'Please select the race/ethnicity that best applies to you:', kind: 'select' }, 'eeo.race',
    'label.race'],
  ['1 WD-08', { label: 'If you identify with one or more ethnic groups please choose from the list below.',
    kind: 'checkbox-group' }, 'eeo.race', 'label.race'],
  ['1 WD-08', { label: 'Which race or ethnicity best describes you?', kind: 'radio' }, 'eeo.race', 'label.race'],
  // 2. WD-09: Workday's agreement box, by its name.
  ['2 WD-09', { label: 'Please confirm your consent.', kind: 'checkbox', nameAttr: TERMS_BOX }, 'consent.terms',
    'name-id.accept-terms'],
  ['2 WD-09', { label: 'You must AGREE to proceed.', kind: 'checkbox', nameAttr: TERMS_BOX }, 'consent.terms',
    'name-id.accept-terms'],
  // 3. WD-13: Travelers' sponsorship question in an employer's support.
  ['3 WD-13', { label: 'Will you now or in the future require support from an employer to obtain/extend a work '
    + 'visa/permit in order to be employed (for example, H-1B, TN, Forms I-983/STEM OPT or other employment-based '
    + 'sponsorship/ support)?', kind: 'combobox' }, 'workAuth.sponsorship', 'label.sponsorship'],
  ['3 WD-13', { label: 'Will you need assistance from your employer to maintain your work authorization?',
    kind: 'select' }, 'workAuth.sponsorship', 'label.sponsorship'],
  // 4. workday-new-2: employment by the company now, still read so.
  ['4 workday-new-2', { label: 'Are you currently employed by Travelers (i.e., Travelers issues your paycheck)?',
    kind: 'combobox' }, 'screening.previouslyEmployed', 'label.previously-employed'],
  // 5. workday-new-1: Workday's Self Identify (the label contract of FIXPLAN §3.2).
  ['5 workday-new-1', { label: 'Date signed', kind: 'date' }, 'consent.signatureDate', 'label.signature-date'],
  ['5 workday-new-1', { label: 'Language of this form', kind: 'select' }, 'languages.formLanguage',
    'label.form-language'],
  ['5 workday-new-1', { label: 'Employee ID (if applicable)', kind: 'text' }, 'identity.employeeId',
    'label.employee-id'],
  // 7. ICIMS-09, O7: a job's and a school's place, in their blocks (iCIMS) and editor (Oracle).
  ['7 ICIMS-09', { label: 'City', kind: 'text', section: JOB }, 'experience.city', 'label.city'],
  ['7 ICIMS-09', { label: 'State/Province', kind: 'combobox', section: JOB }, 'experience.region', 'label.region'],
  ['7 ICIMS-09', { label: 'Country', kind: 'combobox', section: JOB }, 'experience.country', 'label.country'],
  ['7 ICIMS-09', { label: 'City', kind: 'text', section: SCHOOL }, 'education.city', 'label.city'],
  ['7 ICIMS-09', { label: 'State', kind: 'combobox', section: SCHOOL }, 'education.region', 'label.region'],
  ['7 ICIMS-09', { label: 'Country', kind: 'combobox', section: SCHOOL }, 'education.country', 'label.country'],
  ['7 O7', { label: 'City', kind: 'text', section: { id: 'education' } }, 'education.city', 'label.city'],
  ['7 O7', { label: 'Country', kind: 'combobox', section: { id: 'education' } }, 'education.country',
    'label.country'],
  // 9. ICIMS-08: iCIMS's address search, by its name; the box that replaces it.
  ['9 ICIMS-08', { label: 'Address', kind: 'combobox', nameAttr: STREET }, 'address.lookup',
    'name-id.address-street1'],
  ['9 ICIMS-08', { label: 'Address', kind: 'text', nameAttr: STREET }, 'address.line1', 'name-id.address-street1'],
  // 11. JV-1, JZ-15: a signature's date (Jobvite's, by its adapter's "signature"; a box labelled so).
  ['11 JV-1', { label: 'Today’s Date signature', kind: 'date' }, 'consent.signatureDate', 'label.signature-date'],
  ['11 JV-1', { label: 'Today\'s Date', kind: 'text' }, 'consent.signatureDate', 'label.signature-date'],
  ['11 JZ-15', { label: 'Signature date', kind: 'text' }, 'consent.signatureDate', 'label.signature-date'],
  ['11 JZ-15', { label: 'Date signature', kind: 'date' }, 'consent.signatureDate', 'label.signature-date'],
  // 12. JV-2: the veteran group labelled only "Choose One".
  ['12 JV-2', { label: 'Choose One', kind: 'radio', options: VETERAN_STATEMENTS }, 'eeo.veteran',
    'options.veteran-statements'],
  ['12 JV-2', { label: 'Pre-Employment request for Veteran Classification', kind: 'select',
    options: VETERAN_STATEMENTS }, 'eeo.veteran', 'options.veteran-statements'],
  // 13. JV-3, WD-26, ADP-14, O3: the county.
  ['13 JV-3', { label: 'County of Residence', kind: 'select' }, 'address.county', 'label.county'],
  ['13 WD-26', { label: 'County', kind: 'text' }, 'address.county', 'label.county'],
  ['13 O3', { label: 'County', kind: 'combobox' }, 'address.county', 'label.county'],
  // 14. JV-4: a school's own label.
  ['14 JV-4', { label: 'School', kind: 'text' }, 'education.school', 'label.school'],
  ['14 JV-4', { label: 'School Name', kind: 'combobox' }, 'education.school', 'label.school'],
  ['14 JV-4', { label: 'University attended', kind: 'text' }, 'education.school', 'label.school'],
  ['14 JV-4', { label: 'Name of institution', kind: 'text' }, 'education.school', 'label.school'],
  ['14 JV-4', { label: 'College / University', kind: 'text' }, 'education.school', 'label.school'],
  ['14 JV-4', { label: 'School or Institution', kind: 'text' }, 'education.school', 'label.school'],
  ['14 JV-4', { label: 'Enter school name if not in the list above', kind: 'text' }, 'education.school',
    'label.school'],
  ['14 JV-4', { label: 'Which university did you attend?', kind: 'typeahead-remote' }, 'education.school',
    'label.school'],
  // 16. JV-9: Jobvite's consent gate (the label contract).
  ['16 JV-9', { label: 'Location of Residence and Language', kind: 'select' }, 'location.policyResidence',
    'label.policy-residence'],
  // 17. JV-14: NinjaOne asks to text the person, on a list of Yes and No (a consent asked as a choice) and on a radio.
  ['17 JV-14', { label: 'Can NinjaOne text you about your application?', kind: 'select',
    options: ['Select an option...', 'Yes', 'No'] }, 'consent.sms', 'label.consent-sms'],
  ['17 JV-14', { label: 'Can NinjaOne text you about your application?', kind: 'radio', options: ['Yes', 'No'] },
    'consent.sms', 'label.consent-sms'],
  ['17 JV-14', { label: 'May we contact you by text about interviews?', kind: 'checkbox' }, 'consent.sms',
    'label.consent-sms'],
  // 18. JV-15, JV-22, ADP-19, U-11: the referrer's name, and a referral by an employee.
  ['18 JV-15', { label: 'If yes, please provide their name or enter N/A if you were not referred.', kind: 'text' },
    'referral.referrerName', 'label.referrer'],
  ['18 JV-22', { label: 'Referral Name', kind: 'text' }, 'referral.referrerName', 'label.referrer'],
  ['18 JV-15', { label: 'Name of the employee who referred you', kind: 'text' }, 'referral.referrerName',
    'label.referrer'],
  ['18 JV-15', { label: 'Were you referred to this role by a current NinjaOne employee?', kind: 'select' },
    'referral.employeeReferred', 'label.employee-referred'],
  ['18 ADP-19', { label: 'Did any of our employees inform you about this position?', kind: 'radio' },
    'referral.employeeReferred', 'label.employee-referred'],
  ['18 U-11', { label: 'Were you referred by a current employee?', kind: 'radio' }, 'referral.employeeReferred',
    'label.employee-referred'],
  // 19. JV-17: questions asked only of those who live in, or within reach of, a place.
  ['19 JV-17', { label: 'If you live in Illinois, is your address in the City of Chicago?', kind: 'select' },
    'location.residesIn', 'label.resides-in'],
  ['19 JV-17', { label: 'Question 10: If within commutable distance to Boston, MA, are you willing and able to work '
    + 'the Hybrid schedule outlined in the job description?', kind: 'radio' }, 'location.residesIn',
  'label.resides-in'],
  // 20. jobvite-new-1: a restrictive agreement asked as a fact (still the person's own answer first).
  ['20 jobvite-new-1', { label: 'Are you currently subject to a non-compete, non-solicitation or any other '
    + 'restrictive employment agreement?', kind: 'radio', options: ['Yes', 'No'] }, 'screening.restrictiveAgreement',
  'label.restrictive-agreement'],
  // 22. SR-3: "In your own words" is an instruction on a box of prose; an affirmed statement is an attestation.
  ['22 SR-3', { label: 'Think about the industry or part of the business this role serves. In your own words, '
    + 'what’s one real challenge they face, and how does your experience relate?', kind: 'textarea' },
  'freeText.other', 'label.unrecognised-textarea'],
  ['22 SR-3', { label: 'I confirm this application is my own work', kind: 'checkbox' }, 'consent.aiAttestation',
    'label.consent-ai'],
  ['22 SR-3', { label: 'Can you confirm that everything in this application is true and your own?', kind: 'radio',
    options: ['Yes', 'No'] }, 'consent.aiAttestation', 'label.consent-ai'],
  // 23. U-02: UltiPro's period boxes (the label contract), by the section's kind.
  ['23 U-02', { label: 'From Month', kind: 'select', section: JOB }, 'experience.startDate', 'label.period-part'],
  ['23 U-02', { label: 'From Year (YYYY)', kind: 'text', section: JOB }, 'experience.startDate', 'label.period-part'],
  ['23 U-02', { label: 'To Month', kind: 'select', section: SCHOOL }, 'education.endDate', 'label.period-part'],
  ['23 U-02', { label: 'To Year (YYYY)', kind: 'text', section: SCHOOL }, 'education.endDate', 'label.period-part'],
  // 24. U-09, ADP-17: the EEO decline boxes (UltiPro's label contract, ADP's own), and UltiPro's "Ethnic Origin".
  ['24 U-09', { label: 'Gender I decline to say', kind: 'checkbox' }, 'eeo.gender', 'label.eeo-decline-box'],
  ['24 U-09', { label: 'Ethnic Origin I decline to say', kind: 'checkbox' }, 'eeo.hispanicLatino',
    'label.eeo-decline-box'],
  ['24 U-09', { label: 'Race I decline to say', kind: 'checkbox' }, 'eeo.race', 'label.eeo-decline-box'],
  ['24 ADP-17', { label: 'I decline to identify my race and ethnicity', kind: 'checkbox' }, 'eeo.race',
    'label.eeo-decline-box'],
  ['24 U-09', { label: 'Ethnic Origin', kind: 'select', options: ['Hispanic/Latino', 'Not Hispanic/Latino'] },
    'eeo.hispanicLatino', 'label.ethnic-origin'],
  // 25. JV-5: the checklist stays the skills question (its options decide what is ticked: values.ts).
  ['25 JV-5', { label: 'Please select the education, skills and/or experience that you currently possess',
    kind: 'checkbox-group' }, 'skills.list', 'label.skills'],
];

describe('jr6 RULES R1: the audits’ labels', () => {
  it.each(LABELS)('%s: %j', (_item, field, category, rule) => {
    expect(read(field)).toMatchObject({ category, rule, needsUser: null });
  });
});

/** [item and finding, the field, what it must not be read as]. Each is a near miss of a widened rule. */
const NEAR_MISSES: Array<[string, Case, FieldCategory]> = [
  // 1: a question about the job that names ethnicity, never the person's own race.
  ['1', { label: 'Please describe what racial and ethnic diversity means to you.', kind: 'textarea' }, 'eeo.race'],
  ['1', { label: 'Please select the shift that best applies to you', kind: 'select' }, 'eeo.race'],
  ['1', { label: 'Which of these ethnic restaurants would you recommend to a visitor?', kind: 'select' }, 'eeo.race'],
  // 3: support or assistance that is no visa.
  ['3', { label: 'Will you need support from your manager to obtain a promotion?', kind: 'select' },
    'workAuth.sponsorship'],
  ['3', { label: 'Do you require assistance from an employer to obtain housing?', kind: 'select' },
    'workAuth.sponsorship'],
  // 4: an outside business, a vendor, a customer, a competitor.
  ['4', { label: 'Are you currently the owner or employee of any outside company that is currently doing business '
    + 'with Parsons?', kind: 'combobox' }, 'screening.previouslyEmployed'],
  ['4', { label: 'Have you ever worked for one of our vendors or suppliers?', kind: 'radio' },
    'screening.previouslyEmployed'],
  ['4', { label: 'Are you currently employed by a competitor of Acme?', kind: 'radio' }, 'screening.previouslyEmployed'],
  // 5: the person's own languages, and a bare date.
  ['5', { label: 'Language', kind: 'select' }, 'languages.formLanguage'],
  ['5', { label: 'Languages spoken', kind: 'select' }, 'languages.formLanguage'],
  ['5', { label: 'Date', kind: 'date' }, 'consent.signatureDate'],
  ['5', { label: 'Employee referral bonus program', kind: 'text' }, 'identity.employeeId'],
  // 7: the home address outside an entry's own block.
  ['7', { label: 'City', kind: 'text', section: { id: 'employment-application' } }, 'experience.city'],
  ['7', { label: 'City', kind: 'text', section: { id: 'work-experience' } }, 'experience.city'],
  ['7', { label: 'Country', kind: 'select', section: { id: 'main' } }, 'education.country'],
  // 9: the street's second line, and a remote search.
  ['9', { label: 'Address Line 2', kind: 'combobox', nameAttr: 'PersonProfileFields.AddressStreet2' },
    'address.lookup'],
  ['9', { label: 'Address', kind: 'typeahead-remote', nameAttr: STREET }, 'address.lookup'],
  // 11: the signature's name, and a date on a list.
  ['11', { label: 'Your Name signature', kind: 'text' }, 'consent.signatureDate'],
  ['11', { label: 'Today\'s Date', kind: 'select' }, 'consent.signatureDate'],
  // 12: a choice with one veteran word, or none.
  ['12', { label: 'Choose One', kind: 'radio', options: ['Yes', 'No'] }, 'eeo.veteran'],
  ['12', { label: 'Choose One', kind: 'radio', options: ['Veteran discount program', 'None'] }, 'eeo.veteran'],
  // 13: country, and a yes or no about a county.
  ['13', { label: 'Country', kind: 'select' }, 'address.county'],
  ['13', { label: 'Have you lived in Travis County for five years?', kind: 'select' }, 'address.county'],
  // 14: a school district in a question about employment.
  ['14', { label: 'Have you been employed by any United States K-12 School District since 2016 in any capacity?',
    kind: 'select' }, 'education.school'],
  ['14', { label: 'Did you attend a school in the United Kingdom?', kind: 'radio' }, 'education.school'],
  // 17: text that is no message to the person.
  ['17', { label: 'Please confirm the text you entered above is correct', kind: 'checkbox' }, 'consent.sms'],
  // 18: a referral that names no employee; how the person heard.
  ['18', { label: 'Were you referred by a recruiter?', kind: 'radio' }, 'referral.employeeReferred'],
  ['18', { label: 'How did you hear about us?', kind: 'select' }, 'referral.employeeReferred'],
  // 19: a residence asked outright, or a place outside.
  ['19', { label: 'Do you live in Illinois?', kind: 'radio' }, 'location.residesIn'],
  ['19', { label: 'If you live outside the United States, which time zone are you in?', kind: 'select' },
    'location.residesIn'],
  // 22: an explicit denial stays an attestation whatever the kind.
  // 23: a period part outside a job's or a school's section.
  ['23', { label: 'From Month', kind: 'select' }, 'availability.startDate'],
  // 24: a box that declines something else.
  ['24', { label: 'I decline to receive marketing emails', kind: 'checkbox' }, 'eeo.race'],
  ['24', { label: 'Ethnic Origin', kind: 'select', options: ['Irish', 'Italian', 'Other'] }, 'eeo.hispanicLatino'],
];

describe('jr6 RULES R1: the widened rules’ near misses', () => {
  it.each(NEAR_MISSES)('%s: %j is no %s', (_item, field, category) => {
    expect(read(field).category).not.toBe(category);
  });

  it('keeps an explicit "I did not use AI" an attestation on any kind (22, SR-3)', () => {
    for (const kind of ['textarea', 'text', 'checkbox'] as const) {
      expect(read({ label: 'I did not use AI tools to write any part of this application', kind }).category, kind)
        .toBe('consent.aiAttestation');
    }
  });

  it('reads an employer’s support for a visa as the combined sponsorship question, by its time (3, WD-13)', () => {
    expect(read({ label: 'Will you require support from an employer to obtain a work visa in the future?',
      kind: 'select' })).toMatchObject({ category: 'workAuth.sponsorshipFuture', rule: 'label.sponsorship' });
  });

  it('leaves the agreement box’s name to a label that reads as a consent kind of its own (2, WD-09)', () => {
    expect(read({ label: 'I agree to the privacy policy', kind: 'checkbox', nameAttr: TERMS_BOX }))
      .toMatchObject({ category: 'consent.privacy', rule: 'label.consent-privacy' });
    // Without the name, the box is no recognised consent.
    expect(read({ label: 'Please confirm your consent.', kind: 'checkbox' }).category).not.toBe('consent.terms');
  });
});
