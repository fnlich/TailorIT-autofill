import { describe, expect, it } from 'vitest';
import type { FieldKind } from '../enums';
import type { BaseKey, FieldKey, FieldSpec, OptionSetHash } from '../types/field';
import type { FieldCategory } from '../types/intent';
import { classifyByRules, combine, type RuleClassification, type RuleVote } from './classifyRules';

/** A field as the scanner would describe it: only what a test names differs from a plain text field in 'main'. */
const field = (label: string, kind: FieldKind, extra: Partial<FieldSpec> = {}): FieldSpec => ({
  key: 'lever|main|field|none|0' as FieldKey, baseKey: 'lever|main|field|0' as BaseKey, platform: 'lever',
  section: { id: 'main' }, kind, label, labelSource: label === '' ? 'none' : 'for', description: '', required: false,
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
  ['Current salary', 'text', 'unknown', 0.92, 'label.salary'],
  ['Previous compensation', 'text', 'unknown', 0.92, 'label.salary'],
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
  ['Join our talent community', 'checkbox', 'consent.dataRetention', 0.97, 'label.consent-retention'],
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
    ['Nationality', 'select'],
    ['Tell us about a project you are proud of', 'textarea'],
    ['Comments', 'textarea'],
    // A self-identification question is chosen from options, never typed.
    ['Gender', 'text'],
    ['', 'text'],
  ])('%j (%s) is unclassified', (label, kind, extra) => {
    expect(classifyByRules(field(label, kind, extra))).toBeNull();
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
    ['a normal label rule loses to autocomplete even on a generic token (calibration, reported)',
      field('Company', 'text', { ...WORK, autocomplete: ['organization'] }),
      { category: 'experience.currentCompany', confidence: 0.68, classifiedBy: 'autocomplete',
        rule: 'autocomplete.organization', reason: 'classification-conflict' }],
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
  it('is read when the label alone matches nothing', () => {
    expect(classifyByRules(field('Question 4', 'radio', {
      description: 'Are you legally authorized to work in the US?' }))).toEqual({
      category: 'workAuth.authorized', confidence: 0.97, classifiedBy: 'label-rule', rule: 'label.work-auth',
      reason: 'ok', matchedOn: 'description' });
  });

  it('is not read when the label matches', () => {
    expect(classifyByRules(field('Email', 'text', { description: 'We may send text messages about interviews' })))
      .toMatchObject({ category: 'contact.email', matchedOn: 'label' });
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
