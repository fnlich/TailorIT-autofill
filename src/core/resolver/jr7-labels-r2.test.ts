/*
 * jr7 RULES-7 (FIX7PLAN §6.3 R2): the rest of the snapshot7 audits' labels, with the category and the rule id the
 * classifier now gives each, and the near misses each widened rule must not catch. Labels are the pages' own text (the
 * audits' quotations of the owner's snapshot7 captures: questions, never answers); no value of the owner's appears here.
 */
import { describe, expect, it } from 'vitest';
import type { FieldKind } from '../enums';
import { specOf, vocab } from '../plan/plan.testkit';
import type { SectionRef } from '../types/field';
import type { FieldCategory } from '../types/intent';
import { classifyField } from './resolve';

interface Case {
  label: string;
  kind: FieldKind;
  section?: SectionRef;
  options?: string[];
  required?: boolean;
  description?: string;
}

function read(field: Case) {
  const spec = specOf(field.label, field.kind, { ...(field.section ? { section: field.section } : {}),
    ...(field.options ? { optionLabels: field.options } : {}), ...(field.required ? { required: true } : {}),
    ...(field.description ? { description: field.description } : {}) });
  const classified = classifyField(spec, vocab);
  const rules = classified.by === 'rules' ? classified.rules : null;
  return { category: rules?.category ?? rules?.asks ?? null, rule: rules?.rule ?? null,
    needsUser: rules?.needsUser ?? null };
}

const YES_NO = ['Yes', 'No'];
const JOB: SectionRef = { id: 'experience', block: 0 };
const JOB_EDITOR: SectionRef = { id: 'experience' };
const SCHOOL: SectionRef = { id: 'education', block: 0 };
const DAYFORCE_JOB: SectionRef = { id: 'employment-history', block: 0 };
const DAYFORCE_SCHOOL: SectionRef = { id: 'education-history', block: 0 };

/** [finding, the field, the category it asks, the rule id]. */
const LABELS: Array<[string, Case, FieldCategory, string]> = [
  // WD7-09: a right or an entitlement to work.
  ['WD7-09', { label: 'Do you currently have the right/entitlement to work in the country where the job is located?',
    kind: 'combobox', options: YES_NO }, 'workAuth.authorized', 'label.work-auth'],
  ['WD7-09', { label: 'Do you have the entitlement to work in the UK?', kind: 'radio', options: YES_NO },
    'workAuth.authorized', 'label.work-auth'],
  // WD7-10: a previous employee of the company.
  ['WD7-10', { label: 'Please select if you were a previous Unity employee.', kind: 'radio', options: YES_NO },
    'screening.previouslyEmployed', 'label.previously-employed'],
  // WD7-12: when the person could begin.
  ['WD7-12', { label: 'If hired, when can you begin work?', kind: 'date' }, 'availability.startDate',
    'label.availability'],
  // WD7V-02: the preferred language for written communications.
  ['WD7V-02', { label: 'What is your preferred language for written communications?', kind: 'combobox',
    options: ['English', 'French', 'Spanish'] }, 'languages.preferred', 'label.preferred-language'],
  // ICIMS7-08, DF7-11, jr7-O4: duties and responsibilities in a job's entry.
  ['ICIMS7-08', { label: 'Duties', kind: 'textarea', section: JOB }, 'experience.description', 'label.experience-description'],
  ['DF7-11', { label: 'Duties and Responsibilities', kind: 'textarea', section: DAYFORCE_JOB }, 'experience.description',
    'label.experience-description'],
  ['jr7-O4', { label: 'Responsibilities', kind: 'textarea', section: JOB_EDITOR }, 'experience.description',
    'label.entry-field'],
  // ICIMS7-14: the school's companion, and a licence's name, number and state.
  ['ICIMS7-14', { label: 'Other School', kind: 'text', section: SCHOOL }, 'education.school', 'label.school'],
  ['ICIMS7-14', { label: 'License/Certification Name/Type', kind: 'text' }, 'skills.certifications', 'label.licence'],
  ['ICIMS7-14', { label: 'License/Certification Number', kind: 'text' }, 'skills.certificationDetail', 'label.licence'],
  ['ICIMS7-14', { label: 'License/Certification State', kind: 'typeahead-remote' }, 'skills.certificationDetail',
    'label.licence'],
  // ADP7-8: the lowest hourly rate the person would take.
  ['ADP7-8', { label: 'What is the minimum hourly rate you would consider for this position?', kind: 'text' },
    'salary.expected', 'label.salary'],
  // ADP7-9: related experience.
  ['ADP7-9', { label: 'How many years of related experience do you have?', kind: 'text' }, 'experience.totalYears',
    'label.years'],
  // jr7-O4: Oracle's tile editor.
  ['jr7-O4', { label: 'Education Institution', kind: 'text', section: { id: 'education' } }, 'education.school',
    'label.school'],
  ['jr7-O4', { label: 'Employer City', kind: 'text', section: JOB_EDITOR }, 'experience.city', 'label.entry-field'],
  ['jr7-O4', { label: 'Employer Country', kind: 'combobox', section: JOB_EDITOR, options: ['United States', 'Canada'] },
    'experience.country', 'label.entry-field'],
  // UKGR-15: UKG Ready's work editor.
  ['UKGR-15', { label: 'Job title #1', kind: 'text', section: JOB_EDITOR }, 'experience.title', 'label.entry-field'],
  ['UKGR-15', { label: 'Present', kind: 'checkbox', section: JOB_EDITOR }, 'experience.current', 'label.entry-field'],
  // UKGR-16: Street, the eligibility box, Referral.
  ['UKGR-16', { label: 'Street', kind: 'text' }, 'address.line1', 'label.address1'],
  ['UKGR-16', { label: 'Eligible For Work in the USA', kind: 'checkbox' }, 'workAuth.authorized', 'label.work-auth'],
  ['UKGR-16', { label: 'Referral', kind: 'select', options: ['LinkedIn', 'Indeed', 'Other'] }, 'referral.source',
    'label.referral-source'],
  // UKGR-18 + RBP7-07: a typed name as the signature.
  ['UKGR-18', { label: 'Full name to confirm', kind: 'text' }, 'consent.signature', 'label.consent-signature'],
  ['RBP7-07', { label: 'Please type your full name', kind: 'text' },
    'consent.signature', 'label.consent-signature'],
  // DF7-11: Dayforce's records.
  ['DF7-11', { label: 'Not Completed', kind: 'checkbox', section: DAYFORCE_SCHOOL }, 'education.current',
    'label.entry-field'],
  ['DF7-11', { label: 'Division / Dept.', kind: 'text', section: DAYFORCE_JOB }, 'experience.detail',
    'label.entry-field'],
  ['DF7-11', { label: 'Reason For Leaving?', kind: 'text', section: DAYFORCE_JOB }, 'experience.detail',
    'label.entry-field'],
  // RBP7-08: living in one of the listed states.
  ['RBP7-08', { label: 'Acme can only hire candidates with a primary residence in the following States: AZ, CA, CO, TX, '
    + 'WA', kind: 'combobox', options: YES_NO }, 'location.inListedRegion', 'label.in-listed-regions'],
  // RBP7-15: Date Available.
  ['RBP7-15', { label: 'Date Available', kind: 'text' }, 'availability.startDate', 'label.availability'],
  // J7-GH-2: a US state of residence.
  ['J7-GH-2', { label: 'What US state do you reside in?', kind: 'select', options: ['Texas', 'Ohio'] }, 'address.region',
    'label.residence-state'],
  ['J7-GH-2', { label: 'Which United States state do you live in?', kind: 'select', options: ['Texas', 'Ohio'] },
    'address.region', 'label.residence-state'],
];

describe('jr7 RULES-7 R2: the snapshot7 audits’ labels', () => {
  it.each(LABELS)('%s: %j', (_finding, field, category, rule) => {
    expect(read(field)).toMatchObject({ category, rule, needsUser: null });
  });
});

describe('RBP7-07: a typed-name signature read from the help text alone', () => {
  it('is the signature, decided by the Consents mode (description-only)', () => {
    expect(read({ label: 'Truth Certification/Attestation Clause', kind: 'text', description: 'All information I have '
      + 'provided is true. Please acknowledge this by typing your full name in the text field.' }))
      .toMatchObject({ category: 'consent.signature', needsUser: 'description-only' });
  });
});

describe('R2 near misses', () => {
  it('WD7-11: a military question is never the skills list', () => {
    expect(read({ label: 'Please list any job related military experience or skills', kind: 'textarea' }).category)
      .not.toBe('skills.list');
    expect(read({ label: 'Please list your technical skills', kind: 'textarea' }).category).toBe('skills.list');
  });
  it('WD7-10: an employee of a vendor or a supplier is no previous employee of the company', () => {
    expect(read({ label: 'Are you a previous employee of one of our vendors?', kind: 'radio', options: YES_NO })
      .category).not.toBe('screening.previouslyEmployed');
  });
  it('J7-GH-2: the role’s state is no state of residence', () => {
    expect(read({ label: 'What US state is the role in?', kind: 'select', options: ['Texas', 'Ohio'] }).rule)
      .not.toBe('label.residence-state');
  });
  it('UKGR-16: a bare "Referral" box may name the referrer, never the source', () => {
    expect(read({ label: 'Referral', kind: 'text' }).category).not.toBe('referral.source');
  });
  it('UKGR-16: eligible for work in a shift is no authorization', () => {
    expect(read({ label: 'Are you eligible for work in the evenings?', kind: 'radio', options: YES_NO }).category)
      .not.toBe('workAuth.authorized');
  });
  it('DF7-11: a required reason for leaving stays the AI’s (jr6 by design); a supervisor is another person', () => {
    expect(read({ label: 'Reason For Leaving?', kind: 'text', section: DAYFORCE_JOB, required: true }).category)
      .not.toBe('experience.detail');
    expect(read({ label: 'Supervisor', kind: 'text', section: DAYFORCE_JOB }).rule).toBe('label.another-person');
  });
  it('UKGR-15: "Present" outside a job entry is no current flag; a title outside one is the person’s title', () => {
    expect(read({ label: 'Present', kind: 'checkbox' }).category).not.toBe('experience.current');
    expect(read({ label: 'Job title', kind: 'text' }).category).toBe('experience.title');
  });
  it('ICIMS7-08: "Responsibilities" outside a job entry is no description', () => {
    expect(read({ label: 'Responsibilities', kind: 'textarea' }).category).not.toBe('experience.description');
  });
  it('ADP7-8: a rate as a topic is no pay question', () => {
    expect(read({ label: 'What is your experience with hourly rate negotiations?', kind: 'textarea' }).category)
      .not.toBe('salary.expected');
  });
});
