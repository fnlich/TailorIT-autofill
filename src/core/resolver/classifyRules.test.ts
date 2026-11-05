import { describe, expect, it } from 'vitest';
import type { FieldKind } from '../enums';
import { normalizeLabel } from '../text/normalize';
import type { BaseKey, FieldKey, FieldSpec, OptionSetHash } from '../types/field';
import type { FieldCategory } from '../types/intent';
import {
  classifyByRules, combine, ruleText, SENSITIVE_TOPIC, type RuleClassification, type RuleVote,
} from './classifyRules';
import { policyClassOf } from './categories';
import { NEEDS_USER_CAUSES, type NeedsUserCause } from './labelRules';

/** A field as the scanner would describe it: only what a test names differs from a plain text field in 'main'. */
const field = (label: string, kind: FieldKind, extra: Partial<FieldSpec> = {}): FieldSpec => ({
  key: 'lever|main|field|none|0' as FieldKey, baseKey: 'lever|main|field|0' as BaseKey, platform: 'lever',
  section: { id: 'main' }, kind, label, labelSource: label === '' ? 'none' : 'for', labelVisible: label !== '',
  description: '', required: false,
  options: [], optionSetHash: 'none' as OptionSetHash, constraints: {}, autocomplete: [], nameAttr: '', idAttr: '',
  ordinal: 0, domOrder: 0, visibility: 'visible', disabled: false, readOnly: false, current: { kind: 'empty' },
  ...extra,
});

const WORK: Partial<FieldSpec> = { section: { id: 'experience', block: 0 } };
const SCHOOL: Partial<FieldSpec> = { section: { id: 'education', block: 0 } };

/**
 * Real-world labels, each decided by a label rule alone: [label, kind, category, confidence (§8.6: strong 0.97,
 * normal 0.92, weak 0.75), rule, anything else about the field].
 */
const LABELS: Array<[string, FieldKind, FieldCategory, number, string, Partial<FieldSpec>?]> = [
  // Identity and contact
  ['First Name*', 'text', 'identity.firstName', 0.97, 'label.first-name'],
  ['First name (required)', 'text', 'identity.firstName', 0.97, 'label.first-name'],
  ['Given Name(s)', 'text', 'identity.firstName', 0.97, 'label.first-name'],
  ['Preferred first name', 'text', 'identity.preferredName', 0.97, 'label.preferred-name'],
  ['Name you go by', 'text', 'identity.preferredName', 0.97, 'label.preferred-name'],
  ['Middle name', 'text', 'identity.middleName', 0.97, 'label.middle-name'],
  ['Legal last name', 'text', 'identity.lastName', 0.97, 'label.last-name'],
  ['Family name', 'text', 'identity.lastName', 0.97, 'label.last-name'],
  ['Full name', 'text', 'identity.fullName', 0.97, 'label.full-name'],
  ['Name', 'text', 'identity.fullName', 0.97, 'label.full-name'],
  ['Your name', 'text', 'identity.fullName', 0.97, 'label.full-name'],
  ['Pronouns', 'select', 'identity.pronouns', 0.92, 'label.pronouns'],
  ['Email address', 'text', 'contact.email', 0.97, 'label.email'],
  ['E-mail', 'text', 'contact.email', 0.97, 'label.email'],
  ['Phone', 'text', 'contact.phone', 0.92, 'label.phone'],
  ['Phone number', 'text', 'contact.phone', 0.92, 'label.phone'],
  ['Mobile phone', 'text', 'contact.phone', 0.92, 'label.phone'],
  ['Country code', 'select', 'contact.phoneCountry', 0.92, 'label.phone-country'],
  ['Phone country code', 'select', 'contact.phoneCountry', 0.92, 'label.phone-country'],
  // Address and location
  ['Address line 1', 'text', 'address.line1', 0.92, 'label.address1'],
  ['Street address', 'text', 'address.line1', 0.92, 'label.address1'],
  ['Address line 2', 'text', 'address.line2', 0.92, 'label.address2'],
  ['City', 'text', 'address.city', 0.97, 'label.city'],
  ['State/Province', 'select', 'address.region', 0.97, 'label.region'],
  ['State', 'select', 'address.region', 0.97, 'label.region'],
  ['ZIP / Postal code', 'text', 'address.postalCode', 0.97, 'label.postal'],
  ['Zip code', 'text', 'address.postalCode', 0.97, 'label.postal'],
  ['Country', 'select', 'address.country', 0.97, 'label.country'],
  ['Current location', 'text', 'location.current', 0.92, 'label.location'],
  ['Location (City)', 'typeahead-remote', 'location.current', 0.92, 'label.location'],
  ['City, State', 'text', 'location.current', 0.92, 'label.location'],
  // Links
  ['LinkedIn Profile', 'text', 'links.linkedin', 0.97, 'label.linkedin'],
  ['LinkedIn URL', 'text', 'links.linkedin', 0.97, 'label.linkedin'],
  ['GitHub URL', 'text', 'links.github', 0.97, 'label.github'],
  ['Portfolio', 'text', 'links.portfolio', 0.92, 'label.portfolio'],
  ['Portfolio URL', 'text', 'links.portfolio', 0.92, 'label.portfolio'],
  ['Twitter URL', 'text', 'links.twitter', 0.92, 'label.twitter'],
  ['Website', 'text', 'links.website', 0.75, 'label.website'],
  ['Personal website', 'text', 'links.website', 0.75, 'label.website'],
  ['Other website', 'text', 'links.website', 0.75, 'label.website'],
  // Work authorization and screening
  ['Are you legally authorized to work in the United States?', 'radio', 'workAuth.authorized', 0.97,
    'label.work-auth'],
  ['Are you eligible to work in Canada?', 'select', 'workAuth.authorized', 0.97, 'label.work-auth'],
  ['Will you now or in the future require sponsorship for employment visa status (e.g. H-1B)?', 'radio',
    'workAuth.sponsorship', 0.97, 'label.sponsorship'],
  ['Do you currently require visa sponsorship?', 'radio', 'workAuth.sponsorshipNow', 0.97, 'label.sponsorship'],
  ['Will you require visa sponsorship in the future?', 'radio', 'workAuth.sponsorshipFuture', 0.97,
    'label.sponsorship'],
  ['Do you require H1B sponsorship?', 'select', 'workAuth.sponsorship', 0.97, 'label.sponsorship'],
  ['What is your current visa status?', 'select', 'workAuth.visaType', 0.92, 'label.visa-type'],
  ['Are you a U.S. citizen?', 'radio', 'workAuth.status', 0.92, 'label.citizenship'],
  ['Do you hold an active security clearance?', 'radio', 'workAuth.clearance', 0.92, 'label.clearance'],
  ['Are you at least 18 years of age?', 'radio', 'screening.over18', 0.97, 'label.over18'],
  ['Have you ever been convicted of a felony?', 'radio', 'screening.criminalHistory', 0.97, 'label.criminal'],
  // Self-identification
  ['Gender', 'select', 'eeo.gender', 0.97, 'label.gender'],
  ['Gender identity', 'radio', 'eeo.gender', 0.97, 'label.gender'],
  ['Are you Hispanic/Latino?', 'radio', 'eeo.hispanicLatino', 0.97, 'label.hispanic'],
  ['Race', 'select', 'eeo.race', 0.97, 'label.race'],
  ['Race/Ethnicity', 'checkbox-group', 'eeo.race', 0.97, 'label.race'],
  ['Veteran status', 'select', 'eeo.veteran', 0.97, 'label.veteran'],
  ['Disability status', 'select', 'eeo.disability', 0.97, 'label.disability'],
  ['Sexual orientation', 'select', 'eeo.sexualOrientation', 0.97, 'label.orientation'],
  ['Do you identify as transgender?', 'radio', 'eeo.transgender', 0.97, 'label.transgender'],
  // Education
  ['Highest level of education', 'select', 'education.highestLevel', 0.97, 'label.highest-level'],
  ['Degree', 'select', 'education.degree', 0.92, 'label.degree', SCHOOL],
  ['Major / Field of study', 'text', 'education.field', 0.92, 'label.field', SCHOOL],
  ['Discipline', 'select', 'education.field', 0.92, 'label.field', SCHOOL],
  ['School', 'text', 'education.school', 0.92, 'label.school', SCHOOL],
  ['School', 'typeahead-remote', 'education.school', 0.92, 'label.school', SCHOOL],
  ['University', 'combobox', 'education.school', 0.92, 'label.school', SCHOOL],
  ['GPA', 'text', 'education.gpa', 0.97, 'label.gpa', SCHOOL],
  ['Start date', 'date', 'education.startDate', 0.92, 'label.start-date', SCHOOL],
  ['End date', 'date', 'education.endDate', 0.92, 'label.end-date', SCHOOL],
  ['Graduation date', 'text', 'education.endDate', 0.92, 'label.end-date'],
  // Experience, and the start date by section
  ['Start date', 'date', 'experience.startDate', 0.92, 'label.start-date', WORK],
  ['Start date', 'text', 'experience.startDate', 0.92, 'label.start-date',
    { section: { id: 'work-experience', block: 1 } }],
  ['Start date', 'date', 'availability.startDate', 0.92, 'label.start-date'],
  ['End date', 'date', 'experience.endDate', 0.92, 'label.end-date', WORK],
  ['I currently work here', 'checkbox', 'experience.current', 0.97, 'label.current-job', WORK],
  ['Company', 'text', 'experience.company', 0.92, 'label.company', WORK],
  ['Current company', 'text', 'experience.currentCompany', 0.92, 'label.company'],
  ['Job title', 'text', 'experience.title', 0.92, 'label.title', WORK],
  ['Current job title', 'text', 'experience.currentTitle', 0.92, 'label.title'],
  ['Years of experience', 'text', 'experience.totalYears', 0.92, 'label.years'],
  ['How many years of professional experience do you have?', 'select', 'experience.totalYears', 0.92,
    'label.years'],
  // Pay, availability and preferences
  ['Expected salary', 'text', 'salary.expected', 0.92, 'label.salary'],
  ['What are your salary expectations?', 'textarea', 'salary.expected', 0.92, 'label.salary'],
  // "Current salary" and "Previous compensation" are the person's: see the needs-user table below.
  ['When can you start?', 'text', 'availability.startDate', 0.92, 'label.availability'],
  ['Earliest start date', 'date', 'availability.startDate', 0.92, 'label.start-date'],
  ['Notice period', 'text', 'availability.noticePeriod', 0.97, 'label.notice'],
  ['Are you willing to relocate?', 'radio', 'preferences.relocation', 0.97, 'label.relocation'],
  ['Are you comfortable working in a hybrid environment?', 'radio', 'preferences.workArrangement', 0.75,
    'label.arrangement'],
  ['Are you willing to travel?', 'radio', 'preferences.travel', 0.75, 'label.travel'],
  // Referral
  ['How did you hear about us?', 'select', 'referral.source', 0.97, 'label.referral-source'],
  ['How did you hear about this job?', 'combobox', 'referral.source', 0.97, 'label.referral-source'],
  ['Who referred you?', 'text', 'referral.referrerName', 0.92, 'label.referrer'],
  ['Referred by', 'text', 'referral.referrerName', 0.92, 'label.referrer'],
  // Files, skills and free text
  ['Resume/CV', 'file', 'file.resume', 0.97, 'label.resume'],
  ['Resume/CV', 'text', 'unknown', 0.97, 'label.resume'],
  ['Attach resume', 'file', 'file.resume', 0.97, 'label.resume'],
  ['Résumé', 'file', 'file.resume', 0.97, 'label.resume'],
  ['Cover letter', 'file', 'file.coverLetter', 0.97, 'label.cover-letter'],
  ['Cover letter', 'textarea', 'freeText.coverLetter', 0.97, 'label.cover-letter'],
  ['Why do you want to work here?', 'textarea', 'freeText.whyCompany', 0.92, 'label.why-company'],
  ['Why are you interested in working at Acme?', 'textarea', 'freeText.whyCompany', 0.92, 'label.why-company'],
  ['Why this role?', 'textarea', 'freeText.whyRole', 0.92, 'label.why-role'],
  ['Additional information', 'textarea', 'freeText.additionalInfo', 0.92, 'label.additional'],
  ['Which of these skills have you used?', 'checkbox-group', 'skills.list', 0.75, 'label.skills'],
  ['Which of these skills are your strongest? (choose up to 2)', 'multiselect', 'skills.list', 0.75,
    'label.skills'],
  ['Languages', 'multiselect', 'languages.language', 0.92, 'label.language'],
  // Consent
  ['I agree to the privacy policy', 'checkbox', 'consent.privacy', 0.97, 'label.consent-privacy'],
  ['I have read and agree to the Terms of Service', 'checkbox', 'consent.terms', 0.97, 'label.consent-terms'],
  ['I certify that the information is true and complete', 'checkbox', 'consent.certify', 0.97,
    'label.consent-certify'],
  ['I did not use AI to complete this application', 'checkbox', 'consent.aiAttestation', 0.97, 'label.consent-ai'],
  ['Please type your full legal name to sign', 'text', 'consent.signature', 0.97, 'label.consent-signature'],
  ['I consent to receive text messages', 'checkbox', 'consent.sms', 0.97, 'label.consent-sms'],
  ['Join our talent community', 'checkbox', 'consent.marketing', 0.97, 'label.consent-marketing'],
  ['Keep my application on file for future openings', 'checkbox', 'consent.dataRetention', 0.97,
    'label.consent-retention'],
  ['I authorize a background check', 'checkbox', 'consent.backgroundCheck', 0.97, 'label.consent-background'],
  ['I acknowledge', 'checkbox', 'consent.other', 0.97, 'label.consent-generic'],
];

describe('classifyByRules: real-world labels (§8.3)', () => {
  it.each(LABELS)('%j (%s) is %s at %s by %s', (label, kind, category, confidence, rule, extra) => {
    expect(classifyByRules(field(label, kind, extra))).toMatchObject({ category, confidence,
      classifiedBy: 'label-rule', rule, reason: 'ok', matchedOn: 'label' });
  });

  it.each<[string, FieldKind, Partial<FieldSpec>?]>([
    // label.phone's (?!\s+type) keeps the phone number out; no rule names a phone type.
    ['Phone type', 'select'],
    // The name says phone, but a phone number cannot go in a select.
    ['Phone type', 'select', { nameAttr: 'phone_type' }],
    // An extension is not the number, whatever the attributes say.
    ['Phone extension', 'text', { idAttr: 'phone-number--extension' }],
    ['Extension', 'text', { idAttr: 'phoneExtension' }],
    ['', 'text'],
  ])('%j (%s) is unclassified', (label, kind, extra) => {
    expect(classifyByRules(field(label, kind, extra))).toBeNull();
  });

  it.each<[string, FieldKind, FieldCategory, string, NeedsUserCause]>([
    // A self-identification question is chosen from options, never typed: the person answers it.
    ['Gender', 'text', 'eeo.gender', 'label.gender', 'kind-mismatch'],
    ['Will you require sponsorship for this position?', 'text', 'workAuth.sponsorship', 'label.sponsorship',
      'kind-mismatch'],
    ['Nationality', 'select', 'workAuth.status', 'label.nationality', 'nationality'],
    ['Current salary', 'text', 'unknown', 'label.salary', 'current-pay'],
    ['Previous compensation', 'text', 'unknown', 'label.salary', 'current-pay'],
    ['Are you authorized to work in the US without sponsorship?', 'radio', 'workAuth.authorized',
      'label.authorization-and-sponsorship', 'authorization-and-sponsorship'],
  ])('%j (%s) is the person’s: %s by %s (%s)', (label, kind, asks, rule, needsUser) => {
    const result = classifyByRules(field(label, kind));
    expect(result).toMatchObject({ asks, rule, needsUser });
    expect(result?.category).toBeUndefined();
  });

  it('keeps the reading’s confidence and source on a handed-over field, for the panel', () => {
    for (const label of ['Current salary', 'Previous compensation']) {
      expect(classifyByRules(field(label, 'text'))).toEqual({ asks: 'unknown', confidence: 0.92,
        classifiedBy: 'label-rule', rule: 'label.salary', reason: 'ok', matchedOn: 'label', needsUser: 'current-pay' });
    }
  });

  it('reads a sponsorship question’s parenthetical', () => {
    expect(classifyByRules(field('Do you require visa sponsorship (now)?', 'radio'))?.category)
      .toBe('workAuth.sponsorshipNow');
    expect(classifyByRules(field('Do you require visa sponsorship?', 'radio'))?.category).toBe('workAuth.sponsorship');
  });

  it.each<[string, FieldCategory | null, string | null]>([
    // Greenhouse draws every single-choice question as a combobox: a job title or an employer never sits on one.
    ['Are you currently based in or willing to relocate to the Bay Area for this position?', 'preferences.relocation',
      'label.relocation'],
    ['Do you have a non-compete with your current company?', null, null],
  ])('reads the Greenhouse combobox %j as %s', (label, category, rule) => {
    const classification = classifyByRules(field(label, 'combobox'));
    expect(classification === null ? null : [classification.category, classification.rule]).toEqual(
      category === null ? null : [category, rule]);
  });

  it('gives a date in a block of a section it cannot name no category of its own', () => {
    const block = { section: { id: 'references', block: 0 } };
    expect(classifyByRules(field('Start date', 'date', block))).toBeNull();
    expect(classifyByRules(field('Start date', 'date', { section: { id: 'internships', block: 0 } }))?.category)
      .toBe('experience.startDate');
  });
});

describe('classifyByRules: the three sources together (§8.1)', () => {
  it.each<[string, FieldSpec, RuleClassification]>([
    ['agreeing sources add 0.02, capped at 0.99',
      field('First Name*', 'text', { autocomplete: ['given-name'], nameAttr: 'first_name' }),
      { category: 'identity.firstName', confidence: 0.99, classifiedBy: 'label-rule', rule: 'label.first-name',
        reason: 'ok', matchedOn: 'label' }],
    ['a strong label rule names itself when autocomplete agrees',
      field('Email', 'text', { autocomplete: ['email'] }),
      { category: 'contact.email', confidence: 0.99, classifiedBy: 'label-rule', rule: 'label.email', reason: 'ok',
        matchedOn: 'label' }],
    ['autocomplete names itself when a normal label rule agrees',
      field('Phone', 'text', { autocomplete: ['tel'] }),
      { category: 'contact.phone', confidence: 0.99, classifiedBy: 'autocomplete', rule: 'autocomplete.tel',
        reason: 'ok' }],
    ['a whole-token name and a normal label rule agree',
      field('Phone', 'text', { nameAttr: 'phone' }),
      { category: 'contact.phone', confidence: 0.97, classifiedBy: 'name-id', rule: 'name-id.phone', reason: 'ok' }],
    ['a partial name and a normal label rule agree',
      field('Mobile', 'text', { idAttr: 'phoneNumber' }),
      { category: 'contact.phone', confidence: 0.94, classifiedBy: 'name-id', rule: 'name-id.phone', reason: 'ok' }],
    ['a weak autocomplete token and a weak label rule agree',
      field('Website', 'text', { autocomplete: ['url'] }),
      { category: 'links.website', confidence: 0.87, classifiedBy: 'autocomplete', rule: 'autocomplete.url',
        reason: 'ok' }],
    ['autocomplete alone',
      field('Contact', 'text', { autocomplete: ['email'] }),
      { category: 'contact.email', confidence: 0.98, classifiedBy: 'autocomplete', rule: 'autocomplete.email',
        reason: 'ok' }],
    ['a name alone, on an upload with a label no rule knows',
      field('Upload', 'file', { nameAttr: 'resume' }),
      { category: 'file.resume', confidence: 0.95, classifiedBy: 'name-id', rule: 'name-id.resume', reason: 'ok' }],
    ['a name on an unlabelled textarea, so the fallback is not needed',
      field('', 'textarea', { nameAttr: 'cover_letter' }),
      { category: 'freeText.coverLetter', confidence: 0.95, classifiedBy: 'name-id', rule: 'name-id.cover-letter',
        reason: 'ok' }],
  ])('%s', (_, spec, expected) => {
    expect(classifyByRules(spec)).toEqual(expected);
  });

  it.each<[string, FieldSpec, RuleClassification]>([
    ['autocomplete=given-name labelled "Nickname": the strong label rule wins, × 0.8',
      field('Nickname', 'text', { autocomplete: ['given-name'] }),
      { category: 'identity.preferredName', confidence: 0.776, classifiedBy: 'label-rule',
        rule: 'label.preferred-name', reason: 'classification-conflict', matchedOn: 'label' }],
    ['a normal label rule loses to autocomplete',
      field('Phone', 'text', { autocomplete: ['email'] }),
      { category: 'contact.email', confidence: 0.784, classifiedBy: 'autocomplete', rule: 'autocomplete.email',
        reason: 'classification-conflict' }],
    ['a generic autocomplete token gives way to the label naming its kind more precisely, with no conflict',
      field('Company', 'text', { ...WORK, autocomplete: ['organization'] }),
      { category: 'experience.company', confidence: 0.92, classifiedBy: 'label-rule', rule: 'label.company',
        reason: 'ok', matchedOn: 'label' }],
    ['a link label beats the generic url token, with no conflict',
      field('LinkedIn', 'text', { autocomplete: ['url'] }),
      { category: 'links.linkedin', confidence: 0.97, classifiedBy: 'label-rule', rule: 'label.linkedin',
        reason: 'ok', matchedOn: 'label' }],
    ['a label rule and a name that agree outvote one autocomplete token, flagged',
      field('Phone', 'text', { nameAttr: 'phone', autocomplete: ['name'] }),
      { category: 'contact.phone', confidence: 0.776, classifiedBy: 'name-id', rule: 'name-id.phone',
        reason: 'classification-conflict' }],
    ['the same with a phone id against an email token',
      field('Mobile number', 'text', { idAttr: 'mobile', autocomplete: ['email'] }),
      { category: 'contact.phone', confidence: 0.776, classifiedBy: 'name-id', rule: 'name-id.phone',
        reason: 'classification-conflict' }],
    ['a closed-class label contradicted by autocomplete is the person’s',
      field('Citizenship', 'select', { autocomplete: ['country-name'] }),
      { asks: 'workAuth.status', confidence: 0.736, classifiedBy: 'label-rule', rule: 'label.citizenship',
        reason: 'classification-conflict', matchedOn: 'label', needsUser: 'source-conflict' }],
    ['a nationality is the person’s, so a country token cannot fill it',
      field('Nationality', 'select', { autocomplete: ['country'] }),
      { asks: 'workAuth.status', confidence: 0.736, classifiedBy: 'label-rule', rule: 'label.nationality',
        reason: 'classification-conflict', matchedOn: 'label', needsUser: 'nationality' }],
    ['a strong label rule beats the name',
      field('Last name', 'text', { nameAttr: 'first_name' }),
      { category: 'identity.lastName', confidence: 0.776, classifiedBy: 'label-rule', rule: 'label.last-name',
        reason: 'classification-conflict', matchedOn: 'label' }],
    ['the name beats a normal label rule',
      field('Phone', 'text', { nameAttr: 'email' }),
      { category: 'contact.email', confidence: 0.76, classifiedBy: 'name-id', rule: 'name-id.email',
        reason: 'classification-conflict' }],
    ['autocomplete beats the name',
      field('Contact', 'text', { autocomplete: ['email'], nameAttr: 'phone' }),
      { category: 'contact.email', confidence: 0.784, classifiedBy: 'autocomplete', rule: 'autocomplete.email',
        reason: 'classification-conflict' }],
    ['two agree and one disagrees: the agreement bonus, then the conflict factor',
      field('Email', 'text', { autocomplete: ['email'], nameAttr: 'phone' }),
      { category: 'contact.email', confidence: 0.792, classifiedBy: 'label-rule', rule: 'label.email',
        reason: 'classification-conflict', matchedOn: 'label' }],
    ['a strong label rule beats autocomplete and name agreeing',
      field('Nickname', 'text', { autocomplete: ['given-name'], nameAttr: 'first_name' }),
      { category: 'identity.preferredName', confidence: 0.776, classifiedBy: 'label-rule',
        rule: 'label.preferred-name', reason: 'classification-conflict', matchedOn: 'label' }],
  ])('%s', (_, spec, expected) => {
    expect(classifyByRules(spec)).toEqual(expected);
  });

  it('drops a source whose category the kind cannot hold, so it cannot conflict', () => {
    expect(classifyByRules(field('Email me job alerts', 'checkbox', { autocomplete: ['email'] }))).toEqual({
      category: 'consent.marketing', confidence: 0.97, classifiedBy: 'label-rule', rule: 'label.consent-marketing',
      reason: 'ok', matchedOn: 'label', consentKinds: ['consent.marketing'] });
  });

  it('passes on every consent kind the label matched', () => {
    expect(classifyByRules(field('I certify the above is true and agree to the privacy policy', 'checkbox')))
      .toMatchObject({ category: 'consent.certify', consentKinds: ['consent.certify', 'consent.privacy'] });
  });
});

describe('classifyByRules: the description (§8.3)', () => {
  it('is read when the label alone matches nothing, but a legal category found only there is the person’s', () => {
    expect(classifyByRules(field('Question 4', 'radio', {
      description: 'Are you legally authorized to work in the US?' }))).toEqual({
      asks: 'workAuth.authorized', confidence: 0.97, classifiedBy: 'label-rule', rule: 'label.work-auth',
      reason: 'ok', matchedOn: 'description', needsUser: 'description-only' });
  });

  it.each<[string, FieldKind, string]>([
    // Help text names topics the question does not ask.
    ['Do you need any accommodations?', 'radio', 'If you have a disability and need an accommodation, tell us.'],
    ['Same as mailing address', 'checkbox', 'We process your data as our privacy policy describes.'],
    ['Question 7', 'select', 'Do you have a disability?'],
  ])('hands %j (%s) to the person when only its help text names a closed class', (label, kind, description) => {
    expect(classifyByRules(field(label, kind, { description }))).toMatchObject({ matchedOn: 'description' });
    expect(classifyByRules(field(label, kind, { description }))?.needsUser).toBeDefined();
  });

  it('adds the consent kinds of a consent box’s description', () => {
    expect(classifyByRules(field('I agree to the Terms of Service', 'checkbox', {
      description: 'By checking this box you also confirm that you did not use AI to write your answers.' })))
      .toMatchObject({ category: 'consent.aiAttestation', consentKinds: ['consent.aiAttestation', 'consent.terms'],
        matchedOn: 'label' });
    expect(classifyByRules(field('I agree to the privacy policy', 'checkbox', {
      description: 'By ticking this box you also agree to binding arbitration of any disputes.' })))
      .toMatchObject({ category: 'consent.other', consentKinds: ['consent.other', 'consent.privacy'] });
  });

  it('is not read when the label matches', () => {
    expect(classifyByRules(field('Email', 'text', { description: 'We may send text messages about interviews' })))
      .toMatchObject({ category: 'contact.email', matchedOn: 'label' });
  });

  it('reads an "Address" asking for a city and a country, not a street, as the location (Workable\'s)', () => {
    expect(classifyByRules(field('Address', 'text', { description: 'Include your city, region, and country, so that '
      + 'employers can easily manage your application.' }))).toMatchObject({ category: 'location.current',
      rule: 'label.address1', matchedOn: 'label' });
    // A street, a postcode or no such help keeps it the street address.
    for (const description of ['', 'Street, city, postcode and country', 'Your street address, city and country']) {
      expect(classifyByRules(field('Address', 'text', { description })), description)
        .toMatchObject({ category: 'address.line1' });
    }
    // Only the word Address alone is read so (the Phase 7a review): a street address stays the street, whatever its
    // help says.
    const place = 'Include your city, region, and country.';
    for (const label of ['Street address', 'Address line 1', 'Address (flat and street)']) {
      expect(classifyByRules(field(label, 'text', { description: place })), label)
        .toMatchObject({ category: 'address.line1' });
    }
  });

  it("reads the Workable capture's work authorization and experience wordings (the Phase 7a review)", () => {
    for (const [label, kind] of [['Work Authorization Status', 'select'],
      ['Which best describes your work authorization status?', 'radio']] as const) {
      expect(classifyByRules(field(label, kind)), label).toMatchObject({ category: 'workAuth.status',
        rule: 'label.work-auth-status' });
    }
    expect(classifyByRules(field('Are you legally eligible to be employed in the United States?', 'radio')))
      .toMatchObject({ category: 'workAuth.authorized', rule: 'label.work-auth' });
    // Eligibility for a shift is no authorization.
    expect(classifyByRules(field('Are you eligible to work overtime?', 'radio'))?.category).not.toBe('workAuth.authorized');
    // An experience block's own Summary is the role's description; a Summary elsewhere is not.
    expect(classifyByRules(field('Summary', 'textarea', WORK))).toMatchObject({ category: 'experience.description',
      rule: 'label.experience-description' });
    expect(classifyByRules(field('Summary', 'textarea'))?.category).not.toBe('experience.description');
  });

  it('can classify an unlabelled textarea before the fallback does', () => {
    expect(classifyByRules(field('', 'textarea', { description: 'Why do you want to work here?' }))).toEqual({
      category: 'freeText.whyCompany', confidence: 0.92, classifiedBy: 'label-rule', rule: 'label.why-company',
      reason: 'ok', matchedOn: 'description' });
  });
});

describe('classifyByRules: the unlabelled textarea (§8.3)', () => {
  it.each(['', '*', '   '])('a textarea labelled %j is freeText.other, weak', (label) => {
    expect(classifyByRules(field(label, 'textarea'))).toEqual({ category: 'freeText.other', confidence: 0.75,
      classifiedBy: 'label-rule', rule: 'label.unlabelled-textarea', reason: 'ok', matchedOn: 'label' });
  });

  it('applies only to textareas', () => {
    expect(classifyByRules(field('', 'text'))).toBeNull();
    expect(classifyByRules(field('', 'select'))).toBeNull();
  });
});

describe('classifyByRules: what no rule classifies', () => {
  it.each(['Tell us about a project you are proud of', 'Comments', 'Tell us about yourself',
    'What makes you a good fit for this role?'])('a textarea labelled %j is free text, kept to one company', (label) => {
    expect(classifyByRules(field(label, 'textarea'))).toEqual({ category: 'freeText.other', confidence: 0.75,
      classifiedBy: 'label-rule', rule: 'label.unrecognised-textarea', reason: 'ok', matchedOn: 'label' });
  });

  it('leaves a textarea in an employment or school block to LLM classification: likely the entry’s own text', () => {
    expect(classifyByRules(field('Role description', 'textarea', WORK))).toBeNull();
    expect(classifyByRules(field('Activities and societies', 'textarea', SCHOOL))).toBeNull();
    expect(classifyByRules(field('', 'textarea', WORK))?.rule).toBe('label.unlabelled-textarea');
  });

  it.each(['Same as mailing address', 'Custom'])('a lone checkbox labelled %j is unrecognised consent', (label) => {
    expect(classifyByRules(field(label, 'checkbox'))).toEqual({ category: 'consent.other', confidence: 0.75,
      classifiedBy: 'label-rule', rule: 'label.unrecognised-checkbox', reason: 'ok', matchedOn: 'label',
      consentKinds: ['consent.other'] });
  });

  it.each<[string, FieldKind]>([
    // Screened before saved answers could fill them, and before the fallbacks.
    ['Describe your experience with compensation planning', 'textarea'],
    ['Are you eligible to work overtime?', 'radio'],
    ['Do you have experience with sponsorship sales?', 'radio'],
    ['Are you subject to any employment agreements and/or post-employment restrictions with your current employer or '
      + 'a past employer?', 'combobox'],
    ['Do you have experience with sex education programs?', 'checkbox'],
  ])('%j (%s) names a sensitive topic: the person’s', (label, kind) => {
    expect(classifyByRules(field(label, kind))).toEqual({ asks: 'unknown', confidence: 0.75,
      classifiedBy: 'label-rule', rule: 'label.sensitive-topic', reason: 'ok', matchedOn: 'label',
      needsUser: 'sensitive-topic' });
  });

  it('screens on whole words', () => {
    expect(SENSITIVE_TOPIC.test(normalizeLabel('What is the average deal size you manage?'))).toBe(false);
    expect(SENSITIVE_TOPIC.test(normalizeLabel('Do you have offensive security experience?'))).toBe(false);
    expect(SENSITIVE_TOPIC.test(normalizeLabel('What is your age?'))).toBe(true);
  });
});

describe('classifyByRules: a field about another person', () => {
  it.each<[string, Partial<FieldSpec>, RuleClassification['classifiedBy']]>([
    ['Referrer email', { nameAttr: 'referrer_email' }, 'label-rule'],
    ['Emergency contact phone', { nameAttr: 'emergency_contact_phone' }, 'label-rule'],
    ['Referrer first name', { nameAttr: 'referrer_first_name' }, 'label-rule'],
    ['First name', { nameAttr: 'reference1_first_name', section: { id: 'references' } }, 'label-rule'],
    ['Email', { nameAttr: 'reference_email', section: { id: 'references' } }, 'label-rule'],
    ['Email', { nameAttr: 'supervisor_email' }, 'name-id'],
    ['Phone', { nameAttr: 'phone', section: { id: 'emergencyContact' } }, 'label-rule'],
  ])('%j (%j) takes none of the applicant’s own details', (label, extra, classifiedBy) => {
    expect(classifyByRules(field(label, 'text', extra))).toMatchObject({ category: 'screening.other',
      rule: 'label.another-person', classifiedBy });
  });

  it('keeps the referral fields and a job’s own reference', () => {
    expect(classifyByRules(field('Referrer name', 'text'))?.category).toBe('referral.referrerName');
    expect(classifyByRules(field('Who referred you?', 'text', { nameAttr: 'referrer' }))?.category)
      .toBe('referral.referrerName');
    expect(classifyByRules(field('Referral source', 'select', { nameAttr: 'referral_source' }))?.category)
      .toBe('referral.source');
    expect(classifyByRules(field('Email', 'text', { nameAttr: 'job_reference_email' }))?.category)
      .toBe('contact.email');
    expect(classifyByRules(field('Email', 'text', { nameAttr: 'reference_number_email' }))?.category)
      .toBe('contact.email');
  });
});

describe('combine (§8.1)', () => {
  const vote = (classifiedBy: RuleVote['classifiedBy'], category: FieldCategory, confidence: number,
    strongLabel = false): RuleVote => ({ classifiedBy, category, confidence, rule: `${classifiedBy}.x`, strongLabel });

  it('gives nothing without votes', () => {
    expect(combine([])).toBeNull();
    expect(combine([null, null, null])).toBeNull();
  });

  it('passes one vote through', () => {
    expect(combine([null, vote('name-id', 'contact.email', 0.85), null])).toEqual({ category: 'contact.email',
      confidence: 0.85, classifiedBy: 'name-id', rule: 'name-id.x', reason: 'ok' });
  });

  it('rounds away float noise, so 0.92 + 0.02 is 0.94 and 0.75 × 0.8 is 0.6', () => {
    expect(combine([vote('name-id', 'contact.phone', 0.85), vote('label-rule', 'contact.phone', 0.92)])?.confidence)
      .toBe(0.94);
    expect(combine([vote('autocomplete', 'links.website', 0.75), vote('label-rule', 'links.github', 0.92)])
      ?.confidence).toBe(0.6);
  });

  it.each<[string, RuleVote[], RuleVote['classifiedBy'], FieldCategory]>([
    ['a strong label rule outranks autocomplete', [vote('autocomplete', 'contact.email', 0.98),
      vote('label-rule', 'contact.email', 0.97, true)], 'label-rule', 'contact.email'],
    ['autocomplete outranks a normal label rule', [vote('label-rule', 'contact.phone', 0.92),
      vote('autocomplete', 'contact.phone', 0.98)], 'autocomplete', 'contact.phone'],
    ['autocomplete outranks the name', [vote('name-id', 'contact.phone', 0.95),
      vote('autocomplete', 'contact.email', 0.98)], 'autocomplete', 'contact.email'],
    ['the name outranks a weak label rule', [vote('label-rule', 'links.website', 0.75),
      vote('name-id', 'links.github', 0.95)], 'name-id', 'links.github'],
  ])('%s', (_, votes, classifiedBy, category) => {
    expect(combine(votes)).toMatchObject({ classifiedBy, category });
  });
});

describe('classifyByRules: a field handed to the person (needsUser)', () => {
  /** One field per cause. */
  const HANDED_OVER: Array<[NeedsUserCause, FieldSpec]> = [
    ['kind-mismatch', field('Gender', 'text')],
    ['description-only', field('Question 4', 'radio', { description: 'Are you legally authorized to work in the US?' })],
    ['source-conflict', field('Citizenship', 'select', { autocomplete: ['country-name'] })],
    ['sensitive-topic', field('Are you eligible to work overtime?', 'radio')],
    ['authorization-and-sponsorship', field('Are you authorized to work in the US without sponsorship?', 'radio')],
    ['unclear-time', field('If you are currently on an F-1 visa, will you require sponsorship?', 'radio')],
    ['work-permit', field('Do you need a work permit to work in Germany?', 'radio')],
    ['nationality', field('Nationality', 'select')],
    ['age', field('What is your age?', 'text')],
    ['current-pay', field('Current salary', 'text')],
  ];

  it('has a field for every cause', () => {
    expect(HANDED_OVER.map(([cause]) => cause).sort()).toEqual([...NEEDS_USER_CAUSES].sort());
  });

  it.each(HANDED_OVER)('%s carries no category to fill, only what it asks', (cause, spec) => {
    const result = classifyByRules(spec)!;
    expect(result.needsUser).toBe(cause);
    expect(result.category).toBeUndefined();
    expect(result.asks).toBeDefined();
    if (result.needsUser !== undefined) {
      // @ts-expect-error -- a handed-over classification has no category whose policy could be looked up.
      policyClassOf(result.category);
    }
  });
});

describe('classifyByRules: a closing "#"', () => {
  it.each(['Phone#', 'Cell#', 'Mobile Phone#', 'Phone #'])('reads %j as the phone number', (label) => {
    expect(classifyByRules(field(label, 'text'))).toMatchObject({ category: 'contact.phone', rule: 'label.phone' });
  });

  it('keeps it on a one-letter word, so "C#" is still not "C"', () => {
    expect(ruleText('years of c# experience')).toBe('years of c# experience');
    expect(ruleText('phone# or cell##')).toBe('phone or cell');
  });
});

