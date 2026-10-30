import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FieldKind } from '../enums';
import { normalizeLabel } from '../text/normalize';
import { FIELD_CATEGORIES, type FieldCategory } from '../types/intent';
import {
  CONSENT_STRICTNESS, LABEL_RULES, matchLabelRules, RULE_STRENGTHS, sectionKindOf, sponsorshipKind,
  UNLABELLED_TEXTAREA_RULE, unlabelledTextarea, type SectionKind,
} from './labelRules';

/** The lines of §8.3's LABEL_RULES block, between its opening line and its closing `];`. */
function designRuleLines(): string[] {
  const design = readFileSync(new URL('../../../docs/design/core.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const block = /^export const LABEL_RULES[^\n]*\n([\s\S]*?)^\];$/m.exec(design.slice(design.indexOf('### 8.3')));
  expect(block).not.toBeNull();
  return block![1]!.split('\n').filter((line) => line.trim() !== '');
}

/** The label rules over a raw label, as classifyByRules runs them. */
const labelHit = (label: string, kind: FieldKind, section: SectionKind = 'other') =>
  matchLabelRules(normalizeLabel(label), section, kind);

describe('LABEL_RULES (§8.3)', () => {
  it('are the design’s, verbatim and in its order', () => {
    const lines = designRuleLines();
    const source = readFileSync(new URL('./labelRules.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n').split('\n');
    expect(lines.length).toBe(75);
    for (const line of lines) expect(source, line).toContain(line);
    const ids = lines.flatMap((line) => /\{ id: '([^']+)'/.exec(line)?.[1] ?? []);
    expect(LABEL_RULES.map((rule) => rule.id)).toEqual(ids);
  });

  it('has 74 rules with distinct ids, known strengths and known categories', () => {
    expect(LABEL_RULES.length).toBe(74);
    expect(new Set(LABEL_RULES.map((rule) => rule.id)).size).toBe(74);
    for (const rule of LABEL_RULES) {
      expect(RULE_STRENGTHS, rule.id).toContain(rule.strength);
      expect(rule.re.flags, rule.id).toBe('');
      if (typeof rule.category === 'string') expect(FIELD_CATEGORIES, rule.id).toContain(rule.category);
    }
  });
});

/** One label per rule that this rule, and no earlier one, decides; with the kind and section it is asked on. */
const RULE_EXAMPLES: Array<[string, string, FieldKind, SectionKind, FieldCategory]> = [
  ['label.preferred-name', 'Preferred name', 'text', 'other', 'identity.preferredName'],
  ['label.first-name', 'Legal first name', 'text', 'other', 'identity.firstName'],
  ['label.middle-name', 'Middle initial', 'text', 'other', 'identity.middleName'],
  ['label.last-name', 'Surname', 'text', 'other', 'identity.lastName'],
  ['label.full-name', 'Full name', 'text', 'other', 'identity.fullName'],
  ['label.pronouns', 'Pronouns', 'select', 'other', 'identity.pronouns'],
  ['label.email', 'E-mail', 'text', 'other', 'contact.email'],
  ['label.phone-country', 'Dialing code', 'select', 'other', 'contact.phoneCountry'],
  ['label.phone', 'Mobile number', 'text', 'other', 'contact.phone'],
  ['label.address2', 'Apt / Suite', 'text', 'other', 'address.line2'],
  ['label.address1', 'Street address', 'text', 'other', 'address.line1'],
  ['label.city', 'Town', 'text', 'other', 'address.city'],
  ['label.region', 'State / Province', 'select', 'other', 'address.region'],
  ['label.postal', 'Postcode', 'text', 'other', 'address.postalCode'],
  ['label.country', 'Country of residence', 'select', 'other', 'address.country'],
  ['label.location', 'Where are you currently located?', 'text', 'other', 'location.current'],
  ['label.linkedin', 'Linked In URL', 'text', 'other', 'links.linkedin'],
  ['label.github', 'Git Hub profile', 'text', 'other', 'links.github'],
  ['label.portfolio', 'Portfolio link', 'text', 'other', 'links.portfolio'],
  ['label.twitter', 'X handle', 'text', 'other', 'links.twitter'],
  ['label.website', 'Personal blog', 'text', 'other', 'links.website'],
  ['label.work-auth', 'Do you have the right to work in the UK?', 'radio', 'other', 'workAuth.authorized'],
  ['label.sponsorship', 'Will you require H-1B sponsorship in the future?', 'radio', 'other',
    'workAuth.sponsorshipFuture'],
  ['label.visa-type', 'Visa type', 'select', 'other', 'workAuth.visaType'],
  ['label.citizenship', 'Citizenship', 'select', 'other', 'workAuth.status'],
  ['label.clearance', 'Security clearance level', 'select', 'other', 'workAuth.clearance'],
  ['label.over18', 'Are you 18 years or older?', 'radio', 'other', 'screening.over18'],
  ['label.criminal', 'Do you have a criminal record?', 'radio', 'other', 'screening.criminalHistory'],
  ['label.hispanic', 'Hispanic or Latino', 'radio', 'other', 'eeo.hispanicLatino'],
  ['label.race', 'Ethnicity', 'select', 'other', 'eeo.race'],
  ['label.gender', 'What is your gender?', 'select', 'other', 'eeo.gender'],
  ['label.veteran', 'Protected veteran status', 'select', 'other', 'eeo.veteran'],
  ['label.disability', 'Do you have a disability?', 'radio', 'other', 'eeo.disability'],
  ['label.orientation', 'Sexual orientation', 'select', 'other', 'eeo.sexualOrientation'],
  ['label.transgender', 'Do you identify as transgender?', 'radio', 'other', 'eeo.transgender'],
  ['label.highest-level', 'Highest degree', 'select', 'other', 'education.highestLevel'],
  ['label.degree', 'Level of education', 'select', 'other', 'education.degree'],
  ['label.field', 'Area of study', 'text', 'education', 'education.field'],
  ['label.minor', 'Minor', 'text', 'education', 'education.minor'],
  ['label.gpa', 'Grade point average', 'text', 'education', 'education.gpa'],
  ['label.school', 'College / University', 'text', 'education', 'education.school'],
  ['label.start-date', 'Date started', 'date', 'experience', 'experience.startDate'],
  ['label.end-date', 'Expected graduation date', 'text', 'other', 'education.endDate'],
  ['label.current-job', 'This is my current role', 'checkbox', 'experience', 'experience.current'],
  ['label.company', 'Employer', 'text', 'experience', 'experience.company'],
  ['label.title', 'Job title', 'text', 'experience', 'experience.title'],
  ['label.years', 'How many years of relevant experience do you have?', 'text', 'other', 'experience.totalYears'],
  ['label.salary', 'Desired pay', 'text', 'other', 'salary.expected'],
  ['label.availability', 'Availability', 'text', 'other', 'availability.startDate'],
  ['label.notice', 'What is your notice period?', 'text', 'other', 'availability.noticePeriod'],
  ['label.relocation', 'Open to relocation?', 'radio', 'other', 'preferences.relocation'],
  ['label.arrangement', 'Remote, hybrid or on-site?', 'select', 'other', 'preferences.workArrangement'],
  ['label.travel', 'Are you willing to travel?', 'radio', 'other', 'preferences.travel'],
  ['label.referral-source', 'Where did you find this job?', 'select', 'other', 'referral.source'],
  ['label.referrer', 'Referrer name', 'text', 'other', 'referral.referrerName'],
  ['label.previously-employed', 'Have you ever been employed by Acme?', 'radio', 'other',
    'screening.previouslyEmployed'],
  ['label.language', 'Languages spoken', 'checkbox-group', 'other', 'languages.language'],
  ['label.proficiency', 'English proficiency', 'select', 'other', 'languages.proficiency'],
  ['label.skills', 'Which technologies do you know?', 'checkbox-group', 'other', 'skills.list'],
  ['label.resume', 'Upload your resume', 'file', 'other', 'file.resume'],
  ['label.cover-letter', 'Cover letter (optional)', 'file', 'other', 'file.coverLetter'],
  ['label.why-company', 'Why this company?', 'textarea', 'other', 'freeText.whyCompany'],
  ['label.why-role', 'Why the role?', 'textarea', 'other', 'freeText.whyRole'],
  ['label.additional', 'Anything else we should know?', 'textarea', 'other', 'freeText.additionalInfo'],
  ['label.consent-ai', 'I have not used AI tools to write this application', 'checkbox', 'other',
    'consent.aiAttestation'],
  ['label.consent-privacy', 'I have read the candidate privacy notice', 'checkbox', 'other', 'consent.privacy'],
  ['label.consent-terms', 'Terms of use', 'checkbox', 'other', 'consent.terms'],
  ['label.consent-certify', 'I hereby certify that my answers are accurate', 'checkbox', 'other', 'consent.certify'],
  ['label.consent-retention', 'Keep my information on file for future opportunities', 'checkbox', 'other',
    'consent.dataRetention'],
  ['label.consent-marketing', 'Subscribe to our newsletter', 'checkbox', 'other', 'consent.marketing'],
  ['label.consent-sms', 'Receive texts about my application', 'checkbox', 'other', 'consent.sms'],
  ['label.consent-background', 'Background check authorization', 'checkbox', 'other', 'consent.backgroundCheck'],
  ['label.consent-signature', 'Signature', 'text', 'other', 'consent.signature'],
  ['label.consent-generic', 'I acknowledge', 'checkbox', 'other', 'consent.other'],
];

describe('every label rule', () => {
  it('has an example below', () => {
    expect(RULE_EXAMPLES.map(([id]) => id)).toEqual(LABEL_RULES.map((rule) => rule.id));
  });

  it.each(RULE_EXAMPLES)('%s decides %j (%s, %s section) as %s', (id, label, kind, section, category) => {
    const strength = LABEL_RULES.find((rule) => rule.id === id)!.strength;
    const confidence = { strong: 0.97, normal: 0.92, weak: 0.75 }[strength];
    expect(labelHit(label, kind, section)).toMatchObject({ rule: id, category, strength, confidence });
  });
});

describe('sponsorshipKind (§8.3, docs/ARCHITECTURE.md)', () => {
  it.each<[string, FieldCategory]>([
    ['Will you now or in the future require sponsorship for employment visa status?', 'workAuth.sponsorship'],
    ['Do you now, or will you in the future, require visa sponsorship?', 'workAuth.sponsorship'],
    ['Will you require sponsorship now or at any time in the future?', 'workAuth.sponsorship'],
    ['Do you currently, or will you in the future, need sponsorship?', 'workAuth.sponsorship'],
    ['Will you in the future require sponsorship?', 'workAuth.sponsorshipFuture'],
    ['Will you require H-1B sponsorship in the future?', 'workAuth.sponsorshipFuture'],
    ['Do you currently require visa sponsorship?', 'workAuth.sponsorshipNow'],
    ['Do you require sponsorship now?', 'workAuth.sponsorshipNow'],
    // No time named: the combined question, which answers No only when both answers are an explicit no.
    ['Do you require sponsorship?', 'workAuth.sponsorship'],
    ['Will you require H-1B sponsorship?', 'workAuth.sponsorship'],
    // Whole words only: "known" is not "now".
    ['Is your known visa status subject to sponsorship?', 'workAuth.sponsorship'],
  ])('%j asks %s', (label, category) => {
    expect(sponsorshipKind(normalizeLabel(label))).toBe(category);
    expect(labelHit(label, 'radio')).toMatchObject({ rule: 'label.sponsorship', category });
  });
});

describe('sectionKindOf', () => {
  it.each<[string, SectionKind]>([
    ['experience', 'experience'],
    ['work-experience', 'experience'],
    ['professional-experience', 'experience'],
    ['employment-history', 'experience'],
    ['work-history', 'experience'],
    ['job-history', 'experience'],
    ['Experience', 'experience'],
    ['education', 'education'],
    ['education-history', 'education'],
    ['academic-background', 'education'],
    ['school', 'education'],
    ['main', 'other'],
    ['eeo', 'other'],
    ['', 'other'],
    ['work-authorization', 'other'],
    ['history', 'other'],
    ['education-and-experience', 'other'],
  ])('%j is %s', (id, kind) => {
    expect(sectionKindOf(id)).toBe(kind);
  });

  it.each<[SectionKind, FieldCategory, FieldCategory]>([
    ['experience', 'experience.startDate', 'experience.endDate'],
    ['education', 'education.startDate', 'education.endDate'],
    ['other', 'availability.startDate', 'education.endDate'],
  ])('decides the dates of a %s section', (section, start, end) => {
    expect(labelHit('Start date', 'date', section)?.category).toBe(start);
    expect(labelHit('End date', 'date', section)?.category).toBe(end);
    expect(labelHit('From', 'text', section)?.category).toBe(start);
    expect(labelHit('To', 'text', section)?.category).toBe(end);
  });
});

describe('consent: the strictest kind wins (§8.7)', () => {
  it('ranks an AI attestation, unrecognised consent, a certification and a signature first', () => {
    expect(CONSENT_STRICTNESS).toEqual(['consent.aiAttestation', 'consent.other', 'consent.certify',
      'consent.signature']);
  });

  it.each<[string, FieldKind, FieldCategory, FieldCategory[]]>([
    ['I certify that the above is true and agree to the privacy policy', 'checkbox', 'consent.certify',
      ['consent.certify', 'consent.privacy']],
    ['I did not use AI, and I agree to the terms of service', 'checkbox', 'consent.aiAttestation',
      ['consent.aiAttestation', 'consent.terms']],
    ['I consent to a background check and to text messages', 'checkbox', 'consent.sms',
      ['consent.sms', 'consent.backgroundCheck']],
    // Equals keep the rules' order: privacy comes before terms.
    ['I agree to the terms and conditions and the privacy policy', 'checkbox', 'consent.privacy',
      ['consent.privacy', 'consent.terms']],
    // A kind the field cannot hold does not compete: a certification is a box, a signature is typed.
    ['Sign below to certify your answers are true and complete', 'text', 'consent.signature', ['consent.signature']],
    ['Sign below to certify your answers are true and complete', 'checkbox', 'consent.certify', ['consent.certify']],
    // The generic "I agree" is the fallback for consent nothing else recognises.
    ['I agree to the privacy policy', 'checkbox', 'consent.privacy', ['consent.privacy']],
    ['I consent to receive text messages', 'checkbox', 'consent.sms', ['consent.sms']],
    ['I understand that this is an at-will position', 'checkbox', 'consent.other', ['consent.other']],
    ['I agree', 'radio', 'consent.other', ['consent.other']],
  ])('%j (%s) is %s', (label, kind, category, consentKinds) => {
    expect(labelHit(label, kind)).toMatchObject({ category, consentKinds, strength: 'strong', confidence: 0.97 });
  });

  it('gives no consent kinds outside consent', () => {
    expect(labelHit('Email', 'text')?.consentKinds).toBeUndefined();
  });

  it('lets an earlier non-consent rule decide a label that also reads as consent', () => {
    expect(labelHit('I certify that I am at least 18 years of age', 'checkbox')).toMatchObject({
      rule: 'label.over18', category: 'screening.over18' });
  });
});

describe('a rule whose category the kind cannot hold is no match', () => {
  it.each<[string, FieldKind, string, FieldCategory]>([
    // label.title's \bposition\b and \brole\b match first, but a job title is not a textarea.
    ['Why this position?', 'textarea', 'label.why-role', 'freeText.whyRole'],
    ['What interests you about this role?', 'textarea', 'label.why-role', 'freeText.whyRole'],
    // label.company's \bcompany\b matches first, but an employer is not a radio.
    ['Have you previously worked for this company?', 'radio', 'label.previously-employed',
      'screening.previouslyEmployed'],
    // label.phone matches first, but a phone number is not a checkbox.
    ['I agree to receive text messages at the phone number provided', 'checkbox', 'label.consent-sms', 'consent.sms'],
  ])('%j (%s) falls through to %s', (label, kind, rule, category) => {
    expect(labelHit(label, kind)).toMatchObject({ rule, category });
  });

  it.each<[string, FieldKind]>([
    ['Phone', 'select'],
    ['Email address', 'checkbox'],
    ['Cover letter', 'select'],
    ['I currently work here', 'text'],
    ['Gender', 'text'],
    ['Signature', 'checkbox'],
  ])('%j (%s) matches nothing', (label, kind) => {
    expect(labelHit(label, kind)).toBeNull();
  });
});

describe('the unlabelled textarea (§8.3)', () => {
  it('is freeText.other, weak', () => {
    expect(UNLABELLED_TEXTAREA_RULE).toEqual({ id: 'label.unlabelled-textarea', category: 'freeText.other',
      strength: 'weak' });
    expect(unlabelledTextarea('', 'textarea')).toEqual({ rule: 'label.unlabelled-textarea',
      category: 'freeText.other', strength: 'weak', confidence: 0.75 });
  });

  it('applies only to a textarea with an empty normalized label', () => {
    expect(unlabelledTextarea('', 'text')).toBeNull();
    expect(unlabelledTextarea('comments', 'textarea')).toBeNull();
    expect(unlabelledTextarea(normalizeLabel('*'), 'textarea')).not.toBeNull();
  });

  it('is never matched by a rule over an empty label', () => {
    expect(matchLabelRules('', 'other', 'textarea')).toBeNull();
  });
});

describe('known gaps, kept as the design means them (reported)', () => {
  // label.consent-ai lists "didn't" and "haven't", but normalizeLabel deletes apostrophes (step 8), so the label reads
  // "didnt" and those alternatives can never match. The rule is kept verbatim; these fail until the design changes it.
  it.fails('reads "I didn\'t use AI" as an AI attestation', () => {
    expect(labelHit('I didn\'t use AI to write this application', 'checkbox')?.category).toBe('consent.aiAttestation');
  });

  it.fails('reads "I haven\'t used AI" as an AI attestation', () => {
    expect(labelHit('I haven’t used AI in this application', 'checkbox')?.category).toBe('consent.aiAttestation');
  });
});
