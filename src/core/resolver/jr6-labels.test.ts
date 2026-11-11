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
import { classifyByRules, statesNoAiUse } from './classifyRules';
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
  // 16: the person's own country of residence.
  ['16', { label: 'Country of residence', kind: 'select' }, 'location.policyResidence'],
  // 18: a referral that names no employee; how the person heard; the source, not a name.
  ['18', { label: 'Were you referred by a recruiter?', kind: 'radio' }, 'referral.employeeReferred'],
  ['18', { label: 'How did you hear about us?', kind: 'select' }, 'referral.employeeReferred'],
  ['18', { label: 'Referral source', kind: 'select' }, 'referral.referrerName'],
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

  // jr6 fix (RULES-R22): "in my own words" affirmed on a box or a choice is the attestation; only on a text box or a
  // textarea is "in your own words" an instruction.
  it('reads "in my own words" on a box or a choice as the AI attestation, an instruction only over a box of text (22)',
    () => {
      for (const label of ['I certify that all answers are in my own words',
        'I confirm that I wrote all of my answers in my own words']) {
        expect(read({ label, kind: 'checkbox' }), label).toMatchObject({ category: 'consent.aiAttestation',
          rule: 'label.consent-ai' });
      }
      const radio = specOf('Are your answers written in your own words?', 'radio', { optionLabels: ['Yes', 'No'] });
      expect(statesNoAiUse(radio)).toBe(true);
      const essay = specOf('Describe a project you led, in your own words.', 'textarea');
      expect(statesNoAiUse(essay)).toBe(false);
      expect(read({ label: 'Describe a project you led, in your own words.', kind: 'textarea' }).category)
        .toBe('freeText.other');
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

// ── jr6 RULES R2 (FIXPLAN §6.3 items 27 to 34): work authorization read by its meaning ───────────────────────────────

const NINJAONE_TYPES = ['Select an option...', 'US Citizen', 'Permanent Resident', 'H1B', 'H4', 'TN Visa', 'F1Visa',
  'OPT', 'EAD', 'Other'];
const VHL_STATUSES = ['Select an option...', 'U.S. Citizen/Permanent Resident',
  'Non-citizen allowed to work for any employer', 'Non-citizen allowed to work for current employer',
  'Non-citizen seeking work authorization', 'Canadian Citizen/Permanent Resident'];
const XPLOR_RIGHTS = ['I am a US citizen', 'I am a US lawful permanent resident (Green Card holder)',
  'I am on a temporary work or student visa (e.g. H-1B, L-1, OPT, CPT) requiring sponsorship',
  'I have an EAD that does not require sponsorship (e.g. asylee, refugee, TPS, H-4)',
  'I do not currently have any US work rights'];

/** [item and finding, the field, the category it asks, the rule id]. */
const LABELS_R2: Array<[string, Case, FieldCategory, string]> = [
  // 27. JV-7: NinjaOne's type of work authorization, and the wordings beside it; an authorization question whose
  // options are statuses.
  ['27 JV-7', { label: 'What is your US Work Authorization type?', kind: 'select', options: NINJAONE_TYPES },
    'workAuth.status', 'label.work-auth-status'],
  ['27 JV-7', { label: 'Type of work authorization', kind: 'select' }, 'workAuth.status', 'label.work-auth-status'],
  ['27 JV-7', { label: 'Visa type', kind: 'select' }, 'workAuth.status', 'label.work-auth-status'],
  ['27 JV-7', { label: 'US Employment Status', kind: 'select' }, 'workAuth.status', 'label.work-auth-status'],
  ['27 JV-7', { label: 'Work Authorization', kind: 'select', options: ['Select...', 'US Citizen', 'Green Card Holder',
    'H-1B Visa', 'Other'] }, 'workAuth.status', 'options.work-status'],
  ['27 JV-7', { label: 'Employment Status', kind: 'select', options: ['US Citizen', 'Permanent Resident', 'H1B'] },
    'workAuth.status', 'options.work-status'],
  // 28. JV-11: VHL's status sentences.
  ['28 JV-11', { label: 'Citizen/Employment Status', kind: 'select', options: VHL_STATUSES }, 'workAuth.status',
    'label.citizenship'],
  // 29. JZ-7: JazzHR's standard eligibility question, and the harness's relabelled form.
  ['29 JZ-7', { label: 'What’s your citizenship / employment eligibility?', kind: 'select' }, 'workAuth.status',
    'label.citizenship'],
  ['29 JZ-7', { label: 'What is your U.S. citizenship / employment eligibility?', kind: 'select' }, 'workAuth.status',
    'label.citizenship'],
  // 30. JZ-8: a status asked as yes or no (a Yes/No pair of boxes is read as its radio), and on a lone box.
  ['30 JZ-8', { label: 'Are you a US Citizen or Permanent Resident? (Note - EAD does not qualify for this position)',
    kind: 'checkbox-group', options: ['Yes', 'No'] }, 'workAuth.status', 'label.citizenship'],
  ['30 JZ-8', { label: 'Are you a U.S. citizen?', kind: 'select', options: ['Yes', 'No'] }, 'workAuth.status',
    'label.citizenship'],
  ['30 JZ-8', { label: 'I am a U.S. citizen', kind: 'checkbox' }, 'workAuth.status', 'label.citizenship'],
  // 31. SR-4: Wiser's sponsorship question naming two countries, each where the person is located.
  ['31 SR-4', { label: 'Do you, now or in the future, require sponsorship to maintain employment in the US (if you are '
    + 'located in the US) or Canada (if you are located in Canada)?', kind: 'radio', options: ['Yes', 'No'] },
  'workAuth.sponsorship', 'label.sponsorship'],
  // 32. SR-12: Xplor's right-to-work statements (a basis set).
  ['32 SR-12', { label: 'Which of the following statements best describes your right to work in the United States?',
    kind: 'select', options: XPLOR_RIGHTS }, 'workAuth.authorized', 'label.work-auth'],
  // 33. WD-30: AEP's OPT question.
  ['33 WD-30', { label: 'Will you be using Optional Practical Training (OPT) or STEM OPT to begin employment at AEP?',
    kind: 'combobox', options: ['Yes', 'No'] }, 'workAuth.opt', 'label.opt'],
  ['33 WD-30', { label: 'Do you plan to use CPT in order to continue working for us?', kind: 'radio',
    options: ['Yes', 'No'] }, 'workAuth.opt', 'label.opt'],
  // 34. ADP-9: ADP's clearance questions.
  ['34 ADP-9', { label: 'Do you have a security clearance? If yes, please indicate which type (Hold CTRL to select '
    + 'multiple)', kind: 'multiselect', options: ['None', 'Secret', 'Top Secret'] }, 'workAuth.clearance',
  'label.clearance'],
  ['34 ADP-9', { label: 'If you do not have a government security clearance, are you eligible to obtain and maintain '
    + 'one?', kind: 'radio', options: ['Yes', 'No'] }, 'workAuth.clearance', 'label.clearance'],
  ['34 ADP-9', { label: 'This position requires you to obtain and maintain a US Government Security Clearance, which '
    + 'requires US citizenship. Do you meet this requirement?', kind: 'radio', options: ['Yes', 'No'] },
  'workAuth.status', 'label.citizenship'],
];

describe('jr6 RULES R2: the audits’ labels', () => {
  it.each(LABELS_R2)('%s: %j', (_item, field, category, rule) => {
    expect(read(field)).toMatchObject({ category, rule, needsUser: null });
  });
});

/** [item and finding, the field, what it must not be read as]: near misses of the R2 rules. */
const NEAR_MISSES_R2: Array<[string, Case, FieldCategory]> = [
  // 27: a person's own employment, a sponsorship for a visa, an authorization asked yes or no.
  ['27', { label: 'What is your current employment status?', kind: 'select',
    options: ['Employed full-time', 'Employed part-time', 'Unemployed', 'Student'] }, 'workAuth.status'],
  ['27', { label: 'Employment type', kind: 'select', options: ['Full-time', 'Part-time', 'Contract'] },
    'workAuth.status'],
  ['27', { label: 'Will you require sponsorship for any visa type?', kind: 'radio', options: ['Yes', 'No'] },
    'workAuth.status'],
  ['27', { label: 'Work Authorization', kind: 'select', options: ['Yes', 'No'] }, 'workAuth.status'],
  ['27', { label: 'Work Authorization', kind: 'select', options: ['Yes, I am a US citizen', 'Yes, I hold a green card',
    'No'] }, 'workAuth.status'],
  // 32: a basis set stays the authorization question (its options state a sponsorship need).
  ['32', { label: 'Which of the following statements best describes your right to work in the United States?',
    kind: 'select', options: XPLOR_RIGHTS }, 'workAuth.status'],
  // 33: OPT named without beginning or continuing employment.
  ['33', { label: 'Are you currently on OPT?', kind: 'radio', options: ['Yes', 'No'] }, 'workAuth.opt'],
  ['33', { label: 'Describe your experience with OPT reporting tools', kind: 'textarea' }, 'workAuth.opt'],
];

describe('jr6 RULES R2: the widened rules’ near misses', () => {
  it.each(NEAR_MISSES_R2)('%s: %j is no %s', (_item, field, category) => {
    expect(read(field).category).not.toBe(category);
  });
});

// ── jr6 RULES R3 (FIXPLAN §6.3 items 35 to 48) ──────────────────────────────────────────────────────────────────────

const DANAFARBER_VETERANS = 'If you believe you belong to any of the categories of protected veterans listed below, '
  + 'please indicate by checking the appropriate box below. Submission of this information is voluntary and failing to '
  + 'provide it will not adversely affect your application.';

/** [item and finding, the field, the category it asks, the rule id]. */
const LABELS_R3: Array<[string, Case, FieldCategory, string]> = [
  // 35. WD-11: Workday's Voluntary Disclosures.
  ['35 WD-11', { label: 'Please select a gender.', kind: 'combobox' }, 'eeo.gender', 'label.gender'],
  ['35 WD-11', { label: 'Veterans Status', kind: 'select' }, 'eeo.veteran', 'label.veteran'],
  ['35 WD-11', { label: DANAFARBER_VETERANS, kind: 'combobox' }, 'eeo.veteran', 'label.veteran'],
  // 36. WD-12: verily's age of majority.
  ['36 WD-12', { label: 'Are you at least the age of majority under applicable law (i.e., age 18 in most states, but '
    + 'age 19 in Alabama and Nebraska) and have the right to contract in your own name?', kind: 'radio',
  options: ['Yes', 'No'] }, 'screening.over18', 'label.over18'],
  // 37. WD-14: Genworth's agreement in place.
  ['37 WD-14', { label: 'Do you have an agreement in place with a current or former employer that would prevent or '
    + 'limit your ability to do this role at Genworth?', kind: 'radio', options: ['Yes', 'No'] },
  'screening.restrictiveAgreement', 'label.restrictive-agreement'],
  // 38. WD-15: relatives at the company.
  ['38 WD-15', { label: 'Do you have a familial or personal relationship with any current Genworth employee (Relatives '
    + 'include spouse, parent, child, sibling)?', kind: 'radio', options: ['Yes', 'No'] }, 'screening.relatives',
  'label.relatives'],
  ['38 WD-15', { label: 'Are you a relative of a Parsons employee?', kind: 'radio', options: ['Yes', 'No'] },
    'screening.relatives', 'label.relatives'],
  // 39. WD-16, JV-12: the company by its initials; worked for it in any capacity previously.
  ['39 WD-16', { label: 'Have you previously been employed by RTS? CURRENT EMPLOYEES: Please reach out to your '
    + 'Recruiting Manager to discuss your options.', kind: 'radio', options: ['Yes', 'No'] },
  'screening.previouslyEmployed', 'label.previously-employed'],
  ['39 JV-12', { label: 'Have you worked for VHL in any capacity previously?', kind: 'select',
    options: ['Select an option...', 'Yes, Employee / Freelancer / Contractor / Intern / Temp', 'No'] },
  'screening.previouslyEmployed', 'label.previously-employed'],
  // 40. WD-17: a contractor at the company; another company (with a spouse: the person's).
  ['40 WD-17', { label: 'Are you now or have you ever been a contractor at AEP?', kind: 'combobox',
    options: ['Yes', 'No'] }, 'screening.previouslyEmployed', 'label.previously-employed'],
  ['40 WD-17', { label: 'Have you or your spouse previously worked for KPMG?', kind: 'radio', options: ['Yes', 'No'] },
    'screening.previouslyEmployed', 'label.previously-employed'],
  // 41. WD-29: AEP's military training.
  ['41 WD-29', { label: 'Do you have military training or a military certification related to this position?',
    kind: 'combobox', options: ['Yes', 'No'] }, 'screening.militaryTraining', 'label.military-training'],
  // 42, 43. ICIMS-12, ICIMS-13: iCIMS's phone and address "Type", by their names; an address type by its label.
  ['42 ICIMS-12', { label: 'Type', kind: 'select', options: ['Home', 'Mobile', 'Work', 'Email Backup', 'Other'],
    nameAttr: '-1_PersonProfileFields.PhoneType' }, 'contact.phoneType', 'name-id.phone-type'],
  ['43 ICIMS-13', { label: 'Type', kind: 'select', options: ['Work', 'Home', 'Other'],
    nameAttr: '-1_PersonProfileFields.AddressType' }, 'address.type', 'name-id.address-type'],
  ['43 ICIMS-13', { label: 'Address Type', kind: 'combobox' }, 'address.type', 'label.address-type'],
  // 44. ICIMS-15: the IForm's Signature box.
  ['44 ICIMS-15', { label: 'Signature', kind: 'checkbox', idAttr: 'icims_f_signature' }, 'consent.signature',
    'label.consent-signature'],
  // 45. ICIMS-19: "Please specify" (select#rcf3049).
  ['45 ICIMS-19', { label: 'Please specify', kind: 'select', idAttr: 'rcf3049' }, 'referral.detail',
    'name-id.referral-detail'],
  // 47. ICIMS-21, JV-8, JZ-9: the state the person lives in, or will work from.
  ['47 ICIMS-21', { label: 'What state are you physically located in today?', kind: 'select' }, 'address.region',
    'label.residence-state'],
  ['47 JV-8', { label: 'In which state do you currently live?', kind: 'select' }, 'address.region',
    'label.residence-state'],
  ['47 JZ-9', { label: 'What state do you live in?', kind: 'select' }, 'address.region', 'label.residence-state'],
  ['47 JZ-9', { label: 'State of Residence', kind: 'select' }, 'address.region', 'label.residence-state'],
  ['47 JZ-9', { label: 'From which state will you be working?', kind: 'select' }, 'address.region', 'label.work-state'],
  // 48. ICIMS-26, JV-16: a time zone; living in one; years in something; experience with something.
  ['48 ICIMS-26', { label: 'Time Zone', kind: 'combobox' }, 'preferences.timeZone', 'label.time-zone'],
  ['48 JV-16', { label: 'Question 9: Do you currently reside in a state located within the Eastern US Time Zone?',
    kind: 'radio', options: ['Yes', 'No'] }, 'location.inTimeZone', 'label.in-time-zone'],
  ['48 JV-16', { label: 'Question 2: Do you have 10+ years of work experience in Engineering?', kind: 'radio',
    options: ['Yes', 'No'] }, 'experience.yearsIn', 'label.years-in'],
  ['48 JV-16', { label: 'Question 3: Do you have 5+ years’ work experience in a DevOps role?', kind: 'radio',
    options: ['Yes', 'No'] }, 'experience.yearsIn', 'label.years-in'],
  ['48 JV-16', { label: 'Question 4: Do you have experience with Kubernetes?', kind: 'radio', options: ['Yes', 'No'] },
    'skills.experienceWith', 'label.experience-with'],
];

describe('jr6 RULES R3: the audits’ labels', () => {
  it.each(LABELS_R3)('%s: %j', (_item, field, category, rule) => {
    expect(read(field)).toMatchObject({ category, rule, needsUser: null });
  });
});

/** [item and finding, the field, what it must not be read as]: near misses of the R3 rules. */
const NEAR_MISSES_R3: Array<[string, Case, FieldCategory]> = [
  // 35: a gender-neutral word, veterans as clients, a holiday.
  ['35', { label: 'Please select a gender neutral title', kind: 'select' }, 'eeo.gender'],
  ['35', { label: 'Do you have experience working with veterans?', kind: 'radio', options: ['Yes', 'No'] },
    'eeo.veteran'],
  ['35', { label: 'Veterans Day shift availability', kind: 'select' }, 'eeo.veteran'],
  // 36: a majority owner.
  ['36', { label: 'Are you the majority owner of a business?', kind: 'radio', options: ['Yes', 'No'] },
    'screening.over18'],
  // 37: an agreement that limits nothing.
  ['37', { label: 'Do you have an agreement in place with a staffing agency?', kind: 'radio', options: ['Yes', 'No'] },
    'screening.restrictiveAgreement'],
  // 38: a close friend, a customer or a vendor (owner Q14), a relationship with no employee.
  ['38', { label: 'Are you a relative or close friend of a Parsons employee?', kind: 'radio', options: ['Yes', 'No'] },
    'screening.relatives'],
  ['38', { label: 'Are you a relative of any Parsons customer, subcontractor or vendor?', kind: 'radio',
    options: ['Yes', 'No'] }, 'screening.relatives'],
  ['38', { label: 'Describe your personal relationship with technology', kind: 'textarea' }, 'screening.relatives'],
  // 39: having worked with something before is no employment.
  ['39', { label: 'If you have worked with these tools before, tell us how', kind: 'textarea' },
    'screening.previouslyEmployed'],
  // 40: a subcontractor of another.
  ['40', { label: 'Are you a subcontractor for a staffing agency?', kind: 'radio', options: ['Yes', 'No'] },
    'screening.previouslyEmployed'],
  // 41: military service itself is the veteran question.
  ['41', { label: 'Have you served in the military?', kind: 'radio', options: ['Yes', 'No'] },
    'screening.militaryTraining'],
  // 42, 43: another part's type.
  ['42', { label: 'Type', kind: 'select', options: ['Full-time', 'Part-time'], nameAttr: 'jobType' },
    'contact.phoneType'],
  ['43', { label: 'Type', kind: 'select', options: ['Full-time', 'Part-time'], nameAttr: 'employmentType' },
    'address.type'],
  // 44: a signature's typed name stays a text box's.
  // 45: "Please specify" with no id of iCIMS's.
  ['45', { label: 'Please specify', kind: 'select', options: ['A', 'B'] }, 'referral.detail'],
  // 47: a company's state, a preference.
  ['47', { label: 'In which state is your company incorporated?', kind: 'select' }, 'address.region'],
  ['47', { label: 'Which state do you prefer to work in?', kind: 'select' }, 'address.region'],
  // 48: a field of experience, a sensitive topic, total years, a zone's hours.
  ['48', { label: 'Do you have experience in marketing?', kind: 'radio', options: ['Yes', 'No'] },
    'skills.experienceWith'],
  ['48', { label: 'Do you have experience with sponsorship sales?', kind: 'radio', options: ['Yes', 'No'] },
    'skills.experienceWith'],
  ['48', { label: 'How many years of experience do you have?', kind: 'text' }, 'experience.yearsIn'],
  ['48', { label: 'Are you willing to work Eastern Time Zone hours?', kind: 'radio', options: ['Yes', 'No'] },
    'location.inTimeZone'],
  ['48', { label: 'What time zone are our offices in?', kind: 'select' }, 'preferences.timeZone'],
];

describe('jr6 RULES R3: the widened rules’ near misses', () => {
  it.each(NEAR_MISSES_R3)('%s: %j is no %s', (_item, field, category) => {
    expect(read(field).category).not.toBe(category);
  });

  it('keeps a typed signature a text box’s (44, ICIMS-15)', () => {
    expect(read({ label: 'Signature', kind: 'text' })).toMatchObject({ category: 'consent.signature',
      rule: 'label.consent-signature' });
  });
});

// ── jr6 RULES R3 (FIXPLAN §6.3 items 49 to 61) ──────────────────────────────────────────────────────────────────────

/** [item and finding, the field, the category it asks, the rule id]. */
const LABELS_R3B: Array<[string, Case, FieldCategory, string]> = [
  // 49. icims-new-3: GitHub's iCIMS "Preferred Last Name"; NinjaOne's Jobvite "Chosen Last Name", "Chosen First Name".
  ['49 icims-new-3', { label: 'Preferred Last Name', kind: 'text' }, 'identity.lastName', 'label.last-name'],
  ['49 icims-new-3', { label: 'Preferred Family Name', kind: 'text' }, 'identity.lastName', 'label.last-name'],
  ['49 icims-new-3', { label: 'Preferred Surname', kind: 'text' }, 'identity.lastName', 'label.last-name'],
  ['49 icims-new-3', { label: 'Chosen Last Name', kind: 'text' }, 'identity.lastName', 'label.last-name'],
  ['49 icims-new-3', { label: 'Chosen First Name', kind: 'text' }, 'identity.preferredName', 'label.preferred-name'],
  // 50. ADP-4: ADP's "State / Territory" (a text box until a country is chosen).
  ['50 ADP-4', { label: 'State / Territory', kind: 'text' }, 'address.region', 'label.region'],
  ['50 ADP-4', { label: 'State or Territory', kind: 'select' }, 'address.region', 'label.region'],
  ['50 ADP-4', { label: 'Province or Territory', kind: 'select' }, 'address.region', 'label.region'],
  ['50 ADP-4', { label: 'Territory', kind: 'text' }, 'address.region', 'label.region'],
  // 51. ADP-7: ADP's "Select currency type"; Breezy's "Desired Salary currency".
  ['51 ADP-7', { label: 'Select currency type', kind: 'combobox' }, 'salary.currency', 'label.currency'],
  ['51 ADP-7', { label: 'Select currency type', kind: 'select',
    options: ['Canadian Dollar ( CAD )', 'Euro ( EUR )'] }, 'salary.currency', 'label.currency'],
  ['51 ADP-7', { label: 'Desired Salary currency', kind: 'select' }, 'salary.currency', 'label.currency'],
  ['51 ADP-7', { label: 'Currency', kind: 'text' }, 'salary.currency', 'label.currency'],
  // 52. ADP-8, WD-27: how soon, when could the person start.
  ['52 ADP-8', { label: 'If an offer is presented, how soon can you start?', kind: 'text' }, 'availability.startDate',
    'label.availability'],
  ['52 WD-27', { label: 'When could you start?', kind: 'date' }, 'availability.startDate', 'label.availability'],
  ['52 WD-27', { label: 'When would you be able to start?', kind: 'text' }, 'availability.startDate',
    'label.availability'],
  // 53. JV-13: a current employee of the company named before the noun.
  ['53 JV-13', { label: 'Are you a current NinjaOne Employee', kind: 'radio', options: ['Yes', 'No'] },
    'screening.previouslyEmployed', 'label.previously-employed'],
  ['53 JV-13', { label: 'Are you a current Full-Time GitHub employee?', kind: 'select', options: ['Yes', 'No'] },
    'screening.previouslyEmployed', 'label.previously-employed'],
  // 54. JZ-11: living or working inside a country.
  ['54 JZ-11', { label: 'Will you be working from inside the United States?', kind: 'select', options: ['Yes', 'No'] },
    'location.inCountry', 'label.in-country'],
  ['54 JZ-11', { label: 'Are you able to work remotely from a state within the United States?', kind: 'checkbox-group',
    options: ['Yes', 'No'] }, 'location.inCountry', 'label.in-country'],
  ['54 JZ-11', { label: 'Do you currently reside in the United States?', kind: 'radio', options: ['Yes', 'No'] },
    'location.inCountry', 'label.in-country'],
  ['54 JZ-11', { label: 'Are you currently located in the United States or Canada?', kind: 'combobox',
    options: ['Yes', 'No'] }, 'location.inCountry', 'label.in-country'],
  // 55. SR-7: how the person first heard.
  ['55 SR-7', { label: 'How did you first hear about this opportunity?', kind: 'combobox' }, 'referral.source',
    'label.referral-source'],
  ['55 SR-7', { label: 'How did you first learn about Affirm as an employer?', kind: 'combobox' }, 'referral.source',
    'label.referral-source'],
  // 56. SR-9: the résumé by its own label, whatever the help text lists.
  ['56 SR-9', { label: 'Resume', kind: 'file' }, 'file.resume', 'label.resume'],
  // 58. U-11: UltiPro's "Former Name"; "Where are you currently located?" as a box of prose.
  ['58 U-11', { label: 'Former Name', kind: 'text' }, 'identity.formerName', 'label.former-name'],
  ['58 U-11', { label: 'Maiden Name', kind: 'text' }, 'identity.formerName', 'label.former-name'],
  ['58 U-11', { label: 'Previous Last Name(s)', kind: 'text' }, 'identity.formerName', 'label.former-name'],
  ['58 U-11', { label: 'Where are you currently located?', kind: 'textarea' }, 'location.current', 'label.location'],
  // 60. adp-new-2: a civilian employee at a government agency.
  ['60 adp-new-2', { label: 'Have you ever been employed as a civilian employee at a government agency?', kind: 'radio',
    options: ['Yes', 'No'] }, 'screening.governmentService', 'label.government-service'],
  // 61. O2: Oracle's ZIP Code, a search or a list.
  ['61 O2', { label: 'ZIP Code', kind: 'combobox' }, 'address.postalCode', 'label.postal'],
  ['61 O2', { label: 'ZIP Code', kind: 'typeahead-remote' }, 'address.postalCode', 'label.postal'],
];

describe('jr6 RULES R3 (items 49 to 61): the audits’ labels', () => {
  it.each(LABELS_R3B)('%s: %j', (_item, field, category, rule) => {
    expect(read(field)).toMatchObject({ category, rule, needsUser: null });
  });
});

/** [item and finding, the field, what it must not be read as]: near misses of the items 49 to 61 rules. */
const NEAR_MISSES_R3B: Array<[string, Case, FieldCategory]> = [
  // 49: a preferred something else.
  ['49', { label: 'Preferred Location (In Office)', kind: 'select' }, 'identity.lastName'],
  ['49', { label: 'Preferred Contact Method', kind: 'select' }, 'identity.lastName'],
  // 50: a sales territory.
  ['50', { label: 'Which sales territory have you managed?', kind: 'text' }, 'address.region'],
  ['50', { label: 'Territory manager experience', kind: 'textarea' }, 'address.region'],
  // 51: a currency as a field of work, or asked yes or no.
  ['51', { label: 'Currency trading experience in years', kind: 'text' }, 'salary.currency'],
  ['51', { label: 'Are you comfortable being paid in local currency?', kind: 'radio', options: ['Yes', 'No'] },
    'salary.currency'],
  // 52: how soon something else happens.
  ['52', { label: 'How soon can you respond to client emails?', kind: 'text' }, 'availability.startDate'],
  // 53: a student.
  ['53', { label: 'Are you a current student?', kind: 'radio', options: ['Yes', 'No'] }, 'screening.previouslyEmployed'],
  // 54: a relocation, a right to work, a county, an area, a field of work, a kind of place.
  ['54', { label: 'Are you willing to relocate to the United States?', kind: 'radio', options: ['Yes', 'No'] },
    'location.inCountry'],
  ['54', { label: 'Are you legally authorized to work in the United States?', kind: 'radio', options: ['Yes', 'No'] },
    'location.inCountry'],
  ['54', { label: 'Do you currently reside in Los Angeles County?', kind: 'combobox' }, 'location.inCountry'],
  ['54', { label: 'Do you currently reside in the Denver Metro area?', kind: 'combobox' }, 'location.inCountry'],
  ['54', { label: 'Do you currently work in sales?', kind: 'radio', options: ['Yes', 'No'] }, 'location.inCountry'],
  ['54', { label: 'Do you live in a city with public transit?', kind: 'radio', options: ['Yes', 'No'] },
    'location.inCountry'],
  // 55: how the person first heard of something else.
  ['55', { label: 'How did you first hear of our products?', kind: 'text' }, 'availability.startDate'],
  // 58: another name, a former employer, a long question about a location.
  ['58', { label: 'Former employer name', kind: 'text' }, 'identity.formerName'],
  ['58', { label: 'Have you ever used another name?', kind: 'radio', options: ['Yes', 'No'] }, 'identity.formerName'],
  ['58', { label: 'Where are you currently located, and would you consider relocating for this role? Explain.',
    kind: 'textarea' }, 'location.current'],
  // 60: a government's contractor, an agency of another kind.
  ['60', { label: 'Have you ever been employed as a contractor for a government agency?', kind: 'radio',
    options: ['Yes', 'No'] }, 'screening.governmentService'],
  ['60', { label: 'Have you ever been employed as a civilian employee at a staffing agency?', kind: 'radio',
    options: ['Yes', 'No'] }, 'screening.governmentService'],
];

describe('jr6 RULES R3 (items 49 to 61): the widened rules’ near misses', () => {
  it.each(NEAR_MISSES_R3B)('%s: %j is no %s', (_item, field, category) => {
    expect(read(field).category).not.toBe(category);
  });

  it('keeps a current or former employee every employer’s question (53, JV-13)', () => {
    expect(read({ label: 'Are you a current or former employee of Acme?', kind: 'radio', options: ['Yes', 'No'] }))
      .toMatchObject({ category: 'screening.previouslyEmployed', rule: 'label.previously-employed' });
  });

  it('reads no "Middle" box alone as the middle name (58, U-11: only beside the first and last names, in the frame)',
    () => {
      expect(read({ label: 'Middle', kind: 'text' }).category).toBeNull();
    });
});

// ── jr6 RULES R4 (FIXPLAN §6.3 items 62 to 79) ──────────────────────────────────────────────────────────────────────

const DANAFARBER_TRAINING = 'Have you ever, or are you currently participating in a student training program offered by '
  + 'Dana-Farber’s Office of Workforce Development (such as scientific skills training or a summer internship)?';
const ADP_RESUME_CHOICE = ['Upload File', 'Enter Professional Details'];

/** [item and finding, the field, the category it asks, the rule id]. */
const LABELS_R4: Array<[string, Case, FieldCategory, string]> = [
  // 62. WD-25: Workday's "Prefix"; a salutation; a "Title" list of honorifics.
  ['62 WD-25', { label: 'Prefix', kind: 'combobox' }, 'identity.prefix', 'label.prefix'],
  ['62 WD-25', { label: 'Salutation', kind: 'select' }, 'identity.prefix', 'label.prefix'],
  ['62 WD-25', { label: 'Name Prefix', kind: 'text' }, 'identity.prefix', 'label.prefix'],
  ['62 WD-25', { label: 'Title', kind: 'select', options: ['Mr.', 'Mrs.', 'Ms.', 'Dr.'] }, 'identity.prefix',
    'options.honorifics'],
  // 63. WD-28: a list of skills that takes several answers stays the skills question.
  ['63 WD-28', { label: 'Do you have any of these skills?', kind: 'checkbox-group', options: ['Python', 'SQL'] },
    'skills.list', 'label.skills'],
  ['63 WD-28', { label: 'Skills', kind: 'text' }, 'skills.list', 'label.skills'],
  // 66. ICIMS-25: NYU's "Did You Graduate?".
  ['66 ICIMS-25', { label: 'Did You Graduate?', kind: 'select', options: ['Yes', 'No'] }, 'education.graduated',
    'label.graduated'],
  ['66 ICIMS-25', { label: 'Have you graduated?', kind: 'radio', options: ['Yes', 'No'] }, 'education.graduated',
    'label.graduated'],
  // 67. ADP-14: "Address Line 3".
  ['67 ADP-14', { label: 'Address Line 3', kind: 'text' }, 'address.line3', 'label.address3'],
  // 68. ADP-16: the pay basis (the label contract: "<block title> pay basis"); Breezy's "Desired Salary period".
  ['68 ADP-16', { label: 'What is your desired salary? pay basis', kind: 'radio', options: ['Annually', 'Hourly'] },
    'salary.period', 'label.pay-basis'],
  ['68 ADP-16', { label: 'Desired Salary period', kind: 'select' }, 'salary.period', 'label.pay-basis'],
  // 69. ADP-18: how the résumé is provided.
  ['69 ADP-18', { label: 'How would you like to provide the candidate\'s resume?', kind: 'radio',
    options: ADP_RESUME_CHOICE }, 'application.resumeMethod', 'label.resume-method'],
  // 70. ADP-20: a high-school diploma or the GED.
  ['70 ADP-20', { label: 'Are you a high school graduate or passed the GED?', kind: 'radio', options: ['Yes', 'No'] },
    'education.highSchool', 'label.high-school'],
  ['70 ADP-20', { label: 'Do you have a high school diploma or equivalent?', kind: 'select', options: ['Yes', 'No'] },
    'education.highSchool', 'label.high-school'],
  // 71. adp-new-3: ADP's "I have a preferred or chosen name".
  ['71 adp-new-3', { label: 'I have a preferred or chosen name', kind: 'checkbox' }, 'identity.hasPreferredName',
    'label.has-preferred-name'],
  ['71 adp-new-3', { label: 'Do you have a chosen name?', kind: 'radio', options: ['Yes', 'No'] },
    'identity.hasPreferredName', 'label.has-preferred-name'],
  // 72. JV-19: VHL's "Mailing Address, if different from above".
  ['72 JV-19', { label: 'Mailing Address, if different from above', kind: 'textarea' }, 'address.mailing',
    'label.address-if-different'],
  ['72 JV-19', { label: 'Mailing address if different than your home address', kind: 'text' }, 'address.mailing',
    'label.address-if-different'],
  // 74. SR-10: "Country/Region", "Country or Region", "Country/Region of Residence".
  ['74 SR-10', { label: 'Country/Region', kind: 'select' }, 'address.country', 'label.country'],
  ['74 SR-10', { label: 'Country or Region', kind: 'combobox' }, 'address.country', 'label.country'],
  ['74 SR-10', { label: 'Country/Region of Residence', kind: 'select' }, 'address.country', 'label.country'],
  // 75. SR-13: "Facebook".
  ['75 SR-13', { label: 'Facebook', kind: 'text' }, 'links.facebook', 'label.facebook'],
  ['75 SR-13', { label: 'Facebook Profile URL', kind: 'text' }, 'links.facebook', 'label.facebook'],
  // 78. O7: Oracle's "Average Grade".
  ['78 O7', { label: 'Average Grade', kind: 'text', section: SCHOOL }, 'education.gpa', 'label.gpa'],
  // 79. O13: Oracle's "Link 1" by its name (the label contract).
  ['79 O13', { label: 'Link 1', kind: 'text', nameAttr: 'siteLink-1' }, 'links.numbered', 'name-id.site-link'],
  ['79 O13', { label: 'Link 3', kind: 'text', nameAttr: 'siteLink-3' }, 'links.numbered', 'name-id.site-link'],
];

describe('jr6 RULES R4 (items 62 to 79): the audits’ labels', () => {
  it.each(LABELS_R4)('%s: %j', (_item, field, category, rule) => {
    expect(read(field)).toMatchObject({ category, rule, needsUser: null });
  });
});

/** [item and finding, the field, what it must not be read as]: near misses of the items 62 to 79 rules. */
const NEAR_MISSES_R4: Array<[string, Case, FieldCategory]> = [
  // 62: a job title, a list of titles that are no honorifics, a phone's prefix.
  ['62', { label: 'Title', kind: 'text' }, 'identity.prefix'],
  ['62', { label: 'Title', kind: 'select', options: ['Engineer', 'Manager', 'Director'] }, 'identity.prefix'],
  ['62', { label: 'Phone Prefix', kind: 'text' }, 'identity.prefix'],
  // 63: a yes or no question that names skills.
  ['63 WD-28', { label: DANAFARBER_TRAINING, kind: 'radio', options: ['Yes', 'No'] }, 'skills.list'],
  ['63', { label: 'Do you have strong communication skills?', kind: 'select', options: ['Yes', 'No'] }, 'skills.list'],
  // 66: a graduation of another kind.
  ['66', { label: 'Did you graduate with honors?', kind: 'radio', options: ['Yes', 'No'] }, 'education.graduated'],
  ['66', { label: 'Graduation Date', kind: 'date', section: SCHOOL }, 'education.graduated'],
  // 67: the second line stays the second line.
  ['67', { label: 'Address Line 2', kind: 'text' }, 'address.line3'],
  // 68: the pay itself.
  ['68', { label: 'What is your desired salary?', kind: 'text' }, 'salary.period'],
  // 69: the résumé's own upload.
  ['69', { label: 'Resume', kind: 'file' }, 'application.resumeMethod'],
  // 70: a high school's name, a question that asks for no diploma.
  ['70', { label: 'High School Name', kind: 'text' }, 'education.highSchool'],
  ['70', { label: 'Did you attend high school in the United States?', kind: 'radio', options: ['Yes', 'No'] },
    'education.highSchool'],
  // 71: the preferred name itself.
  ['71', { label: 'Preferred Name', kind: 'text' }, 'identity.hasPreferredName'],
  // 72: the address itself.
  ['72', { label: 'Mailing Address', kind: 'textarea' }, 'address.mailing'],
  ['72', { label: 'Phone (if different from above)', kind: 'text' }, 'address.mailing'],
  // 74: a phone's country code.
  ['74', { label: 'Country/Region Code', kind: 'select' }, 'address.country'],
  // 75: Facebook as a field of work.
  ['75', { label: 'Do you have experience with Facebook Ads?', kind: 'radio', options: ['Yes', 'No'] },
    'links.facebook'],
  // 78: a grade of another kind.
  ['78', { label: 'Grade level taught', kind: 'text' }, 'education.gpa'],
  // 79: a numbered link without Oracle's name.
  ['79', { label: 'Link 1', kind: 'text' }, 'links.numbered'],
];

describe('jr6 RULES R4 (items 62 to 79): the widened rules’ near misses', () => {
  it.each(NEAR_MISSES_R4)('%s: %j is no %s', (_item, field, category) => {
    expect(read(field).category).not.toBe(category);
  });

  it('keeps "Phone (if different from above)" the phone (72: the bracket is left out)', () => {
    expect(read({ label: 'Phone (if different from above)', kind: 'text' }).category).toBe('contact.phone');
  });
});

// ── jr6 fix round 1: the reviews' findings in these rules (SP\jr6\build\RULES.md "Fix round 1") ─────────────────────

/** [issue id, the field, the category it asks (null: none), the rule id (null: any)]: what each fix reads. */
const LABELS_FIX: Array<[string, Case, FieldCategory | null, string | null]> = [
  // RULES-R51: a pay question that asks for its currency too is the pay; the currency's own label is the currency.
  ['R51', { label: 'What is your expected salary? Please specify the currency.', kind: 'text' }, 'salary.expected',
    'label.salary'],
  ['R51', { label: 'What are your salary expectations? Please include currency and pay period.', kind: 'text' },
    'salary.expected', 'label.salary'],
  ['R51', { label: 'Currency', kind: 'text' }, 'salary.currency', 'label.currency'],
  ['R51', { label: 'Desired Salary currency', kind: 'text' }, 'salary.currency', 'label.currency'],
  ['R51', { label: 'What currency would you like to be paid in?', kind: 'select' }, 'salary.currency',
    'label.currency'],
  // RULES-R70: a question of the diploma alone, never one that asks for more.
  ['R70', { label: 'Do you have a high school diploma or equivalent?', kind: 'radio', options: ['Yes', 'No'] },
    'education.highSchool', 'label.high-school'],
  ['R70', { label: 'Are you a high school graduate or passed the GED?', kind: 'radio', options: ['Yes', 'No'] },
    'education.highSchool', 'label.high-school'],
  ['R70', { label: 'Do you have a high school diploma and a valid driver’s license?', kind: 'radio',
    options: ['Yes', 'No'] }, null, null],
  ['R70', { label: 'Question 1: Do you have a minimum of a High School diploma or GED along with relevant/required work '
    + 'experience?', kind: 'radio', options: ['Yes', 'No'] }, null, null],
  ['R70', { label: 'Do you have a high school diploma or GED and are you able to lift 50 pounds?', kind: 'radio',
    options: ['Yes', 'No'] }, null, null],
];

describe('jr6 fix round 1: what the fixed rules read', () => {
  it.each(LABELS_FIX)('%s: %j', (_issue, field, category, rule) => {
    const got = read(field);
    expect(got.category).toBe(category);
    if (rule !== null) expect(got.rule).toBe(rule);
  });
});
