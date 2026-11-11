import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FieldKind } from '../enums';
import { normalize, normalizeLabel } from '../text/normalize';
import { FIELD_CATEGORIES, type FieldCategory } from '../types/intent';
import {
  attestsNoAiUse, CONSENT_STRICTNESS, LABEL_RULES, matchLabelRules, NEEDS_USER_CAUSES, PRE_RULES, RULE_STRENGTHS, sectionKindOf,
  SPONSORSHIP_TIMES, sponsorshipKind, sponsorshipTime, UNLABELLED_TEXTAREA_RULE, unlabelledTextarea,
  UNRECOGNISED_FIELD_RULES, unrecognisedField, withDescriptionConsent, type SectionKind, type SponsorshipTime,
} from './labelRules';

/** The lines of §8.3's LABEL_RULES block, between its opening line and its closing `];`. */
function designRuleLines(): string[] {
  const design = readFileSync(new URL('../../../docs/design/core.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const block = /^export const LABEL_RULES[^\n]*\n([\s\S]*?)^\];$/m.exec(design.slice(design.indexOf('### 8.3')));
  expect(block).not.toBeNull();
  return block![1]!.split('\n').filter((line) => line.trim() !== '');
}

/** The label rules over a raw label, as classifyByRules runs them: its parentheticals and the raw label passed too. */
const labelHit = (label: string, kind: FieldKind, section: SectionKind = 'other', block?: number) => {
  const normalized = normalize(label, 'label');
  const qualifiers = normalized.qualifiers.map((qualifier) => qualifier.tokens.join(' ')).join(' ');
  return matchLabelRules(normalized.key, section, kind, { qualifiers, rawLabel: label,
    ...(block === undefined ? {} : { block }) });
};

describe('LABEL_RULES (§8.3)', () => {
  it('are the design’s, verbatim and in its order', () => {
    const lines = designRuleLines();
    const source = readFileSync(new URL('./labelRules.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n').split('\n');
    expect(lines.length).toBe(76);
    for (const line of lines) expect(source, line).toContain(line);
    const ids = lines.flatMap((line) => /\{ id: '([^']+)'/.exec(line)?.[1] ?? []);
    expect(LABEL_RULES.map((rule) => rule.id)).toEqual(ids);
  });

  it('has 75 rules with distinct ids, known strengths and known categories', () => {
    expect(LABEL_RULES.length).toBe(75);
    expect(new Set(LABEL_RULES.map((rule) => rule.id)).size).toBe(75);
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
  // jr6 RULES (JV-7): "Visa type" asks which status (WORK_AUTH_TYPE); an immigration status is still the visa type's.
  ['label.visa-type', 'Immigration status', 'select', 'other', 'workAuth.visaType'],
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
  // The Phase 2 review: Ashby's Education block (plaid, 2026-11-01).
  ['label.current-study', 'Still Student?', 'checkbox', 'education', 'education.current'],
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
    // Custom headings and camelCase ids name a work history too; bare "work" or "professional" do not.
    ['internships', 'experience'],
    ['career-history', 'experience'],
    ['positions-held', 'experience'],
    ['professional-background', 'experience'],
    ['workExperience', 'experience'],
    ['WorkHistory', 'experience'],
    ['educationSection', 'education'],
    ['work', 'other'],
    ['references', 'other'],
    ['professional-references', 'other'],
    ['professional-licenses', 'other'],
  ])('%j is %s', (id, kind) => {
    expect(sectionKindOf(id)).toBe(kind);
  });

  it('gives no date of its own to a block of a section it cannot name', () => {
    // In block 0 of a 'references' section, "Start date" is the block's, never the person's availability.
    expect(labelHit('Start date', 'date', 'other', 0)).toBeNull();
    expect(labelHit('End date', 'date', 'other', 0)).toBeNull();
    expect(labelHit('To', 'text', 'other', 2)).toBeNull();
    expect(labelHit('Start date', 'date', 'experience', 0)?.category).toBe('experience.startDate');
    expect(labelHit('Start date', 'date', 'other')?.category).toBe('availability.startDate');
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
    // jr6 RULES R3 (ICIMS-15): a signature is a box's kind too, so the box asks both (the strictest first).
    ['Sign below to certify your answers are true and complete', 'checkbox', 'consent.certify',
      ['consent.certify', 'consent.signature']],
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

  it('reads a box that certifies a fact as the certification, never as the fact', () => {
    // The specification: "I certify..." boxes are the user's click or a pre-approved category, never inferred from a
    // profile answer (here, over 18).
    expect(labelHit('I certify that I am at least 18 years of age', 'checkbox')).toMatchObject({
      rule: 'label.consent-certify', category: 'consent.certify', consentKinds: ['consent.certify'] });
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
  ])('%j (%s) matches nothing', (label, kind) => {
    expect(labelHit(label, kind)).toBeNull();
  });

  // A legal, EEO or sensitive question, or consent no kind of which fits, stops at a needs-user hit: falling through
  // let a later profile rule claim it ("Will you require sponsorship for this position?" became a job title).
  it.each<[string, FieldKind, string, FieldCategory]>([
    ['Gender', 'text', 'label.gender', 'eeo.gender'],
    // s2 core-gh (decision 11): a yes/no sponsorship or authorization question in a text box takes "Yes" or "No" now
    // (below); one not asked as yes or no is still the person's.
    ['Visa sponsorship needed for this position', 'text', 'label.sponsorship', 'workAuth.sponsorship'],
    ['Work authorization in the country where this position is located', 'text', 'label.work-auth',
      'workAuth.authorized'],
    ['Are you a protected veteran?', 'text', 'label.veteran', 'eeo.veteran'],
    ['Are you a U.S. citizen?', 'text', 'label.citizenship', 'workAuth.status'],
    // jr6 RULES (JZ-8): a status is asked as yes or no on a lone box too ("I am a U.S. citizen"), so a text box stands
    // for the kind that cannot hold it.
    ['I am a U.S. citizen or permanent resident', 'text', 'label.citizenship', 'workAuth.status'],
    // jr6 RULES R3 (ICIMS-15): a signature is a box's kind too, so a list stands for the kind that cannot hold it.
    ['Signature', 'select', 'label.consent-signature', 'consent.signature'],
    ['If you require sponsorship, please explain', 'textarea', 'label.sponsorship', 'workAuth.sponsorship'],
    ['I agree to the privacy policy', 'select', 'label.consent-privacy', 'consent.privacy'],
  ])('%j (%s) is the person’s: %s on a kind that cannot hold %s', (label, kind, rule, category) => {
    expect(labelHit(label, kind)).toMatchObject({ rule, category, needsUser: 'kind-mismatch' });
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

describe('AI attestations, as normalizeLabel writes them', () => {
  // normalizeLabel deletes apostrophes, so the label reads "didnt" and "havent": label.consent-ai's verbatim "didn't"
  // and "haven't" never match, and the refinement's apostrophe-free wordings must.
  it('reads "I didn\'t use AI" as an AI attestation', () => {
    expect(labelHit('I didn\'t use AI to write this application', 'checkbox')?.category).toBe('consent.aiAttestation');
  });

  it('reads "I haven\'t used AI" as an AI attestation', () => {
    expect(labelHit('I haven\u2019t used AI in this application', 'checkbox')?.category).toBe('consent.aiAttestation');
  });

  it.each<[string, FieldKind, FieldCategory[]]>([
    // A certification or an agreement that names AI is an AI attestation, which is never pre-approved (§8.7).
    ['I certify that I did not use generative AI tools to complete this application', 'checkbox',
      ['consent.aiAttestation', 'consent.certify']],
    ['I certify that I have not used any AI tools', 'checkbox', ['consent.aiAttestation', 'consent.certify']],
    ['I attest that my responses are my own and not AI-generated', 'checkbox',
      ['consent.aiAttestation', 'consent.certify']],
    ['I certify this application is my own work and was not written with ChatGPT or other AI', 'checkbox',
      ['consent.aiAttestation', 'consent.certify']],
    ['I certify that I didn\u2019t use AI tools', 'checkbox', ['consent.aiAttestation', 'consent.certify']],
    // Words between the negation and the AI term, either way round, with no consent verb at all.
    ['I confirm that no AI tools were used in preparing this application', 'checkbox', ['consent.aiAttestation']],
    ['I did not use any AI to write my answers', 'checkbox', ['consent.aiAttestation']],
    ['I have not used an AI assistant', 'checkbox', ['consent.aiAttestation']],
    ['I have not used AI tools', 'radio', ['consent.aiAttestation']],
  ])('%j (%s) is an AI attestation first: %j', (label, kind, consentKinds) => {
    expect(labelHit(label, kind)).toMatchObject({ rule: 'label.consent-ai', category: 'consent.aiAttestation',
      consentKinds });
  });

  it('takes an AI attestation from the box’s description too', () => {
    const hit = labelHit('I agree to the Terms of Service', 'checkbox')!;
    expect(withDescriptionConsent(hit, normalizeLabel('By checking this box you also confirm that you did not use AI '
      + 'to write your answers.'), 'checkbox')).toMatchObject({ category: 'consent.aiAttestation',
      consentKinds: ['consent.aiAttestation', 'consent.terms'] });
  });
});

/** Every regular expression and String.raw fragment in a resolver source file, with its line. */
function patternsIn(file: string): Array<{ line: string; source: string }> {
  const text = readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const lineAt = (at: number) => text.slice(text.lastIndexOf('\n', at) + 1, text.indexOf('\n', at));
  const found: Array<{ line: string; source: string }> = [];
  let at = 0;
  while (at < text.length) {
    const ch = text[at]!;
    if (text.startsWith('//', at)) at = text.indexOf('\n', at);
    else if (text.startsWith('/*', at)) at = text.indexOf('*/', at) + 2;
    else if (ch === '\'' || ch === '"') {
      let end = at + 1;
      while (text[end] !== ch) end += text[end] === '\\' ? 2 : 1;
      at = end + 1;
    } else if (ch === '`') {
      let end = at + 1;
      while (text[end] !== '`') end += text[end] === '\\' ? 2 : 1;
      if (text.slice(0, at).endsWith('String.raw')) {
        found.push({ line: lineAt(at), source: text.slice(at + 1, end).replace(/\$\{[^}]*\}/g, '') });
      }
      at = end + 1;
    } else if (ch === '/' && /[=:(,![&|?{};]$/.test(text.slice(0, at).trimEnd())) {
      let end = at + 1;
      let inClass = false;
      while (inClass || text[end] !== '/') {
        if (text[end] === '\\') end += 1;
        else if (text[end] === '[') inClass = true;
        else if (text[end] === ']') inClass = false;
        end += 1;
      }
      found.push({ line: lineAt(at), source: text.slice(at + 1, end) });
      at = end + 1;
    } else at += 1;
  }
  return found;
}

/** What a normalized label can hold: lower-case letters, digits, spaces, and `&`, `+` and `#` inside words. */
const LIVE = /[a-z0-9 &+#]/;

/** The characters a pattern needs that normalizeLabel never leaves in a label (apostrophes, hyphens, slashes,
 *  escaped dots, capitals...), and the character classes that hold only such characters. */
function deadCharacters(source: string): string[] {
  const dead = new Set<string>();
  let at = 0;
  while (at < source.length) {
    const ch = source[at]!;
    if (ch === '\\') {
      const next = source[at + 1] ?? '';
      if (next === 'p' || next === 'P' || (next === 'u' && source[at + 2] === '{')) at = source.indexOf('}', at) + 1;
      else if (next === 'u') at += 6;
      else {
        if (!/[sSbBwWdD]/.test(next) && !LIVE.test(next)) dead.add(next);
        at += 2;
      }
    } else if (ch === '[') {
      let end = at + 1;
      while (source[end] !== ']') end += source[end] === '\\' ? 2 : 1;
      const members = source.slice(at + 1, end);
      if (!members.startsWith('^') && !/\\[swd]|\\p\{/.test(members) && ![...members].some((m) => LIVE.test(m))) {
        dead.add(`[${members}]`);
      }
      at = end + 1;
    } else if (ch === '{' && /^\{\d+(?:,\d*)?\}/.test(source.slice(at))) at = source.indexOf('}', at) + 1;
    else if (ch === '(' && source[at + 1] === '?') at += source[at + 2] === '<' ? 4 : 3;
    else {
      if (!'^$.|?*+()'.includes(ch) && !LIVE.test(ch)) dead.add(ch);
      at += 1;
    }
  }
  return [...dead];
}

describe('the patterns over normalized labels', () => {
  /** The patterns that read text before normalization: the raw label ("Why Acme?"), attribute text, section ids, and
   *  where a passage breaks into sentences before each is normalized (classifyRules SENTENCE_BREAK, the core pass of
   *  2026-11-06). jr6 RULES R3 (SR-9): a help text's run of file types, read before normalization (classifyRules
   *  withoutFileTypes). */
  const RAW_TEXT = /WHY_NAME =|OTHER_PERSON_ID =|SENTENCE_BREAK =|\(\[a-z0-9\]\)\(\[A-Z\]\)|WORD_RUN =|run\.split\(','\)/;

  it('need no character normalizeLabel always removes, but the one the design’s AI line still writes', () => {
    const dead = ['./labelRules.ts', './classifyRules.ts'].flatMap((file) => patternsIn(file))
      .filter(({ line }) => !RAW_TEXT.test(line))
      .map(({ line, source }) => ({ rule: /id: '([^']+)'/.exec(line)?.[1] ?? line.trim().slice(0, 40),
        dead: deadCharacters(source) }))
      .filter(({ dead: chars }) => chars.length > 0);
    // §8.3's label.consent-ai still writes "didn't|haven't", kept verbatim here until the design changes; its
    // refinement reads "didnt" and "havent" (tested above). Any other entry is a pattern that can never match.
    expect(dead).toEqual([{ rule: 'label.consent-ai', dead: ['\''] }]);
  });

  it('finds what it looks for', () => {
    expect(deadCharacters(String.raw`didn't\s+use`)).toEqual(['\'']);
    expect(deadCharacters(String.raw`e\-mail|\.net|[,/]|Email`)).toEqual(['-', '.', '[,/]', 'E']);
    expect(deadCharacters(String.raw`(?:a|b)\s+c{0,3}[sz]\b(?<!x)\p{L}c\+\+`)).toEqual([]);
    expect(patternsIn('./labelRules.ts').length).toBeGreaterThan(LABEL_RULES.length);
  });
});

describe('sponsorshipTime: the time a sponsorship question asks about (docs/ARCHITECTURE.md)', () => {
  it('has four answers', () => {
    expect(SPONSORSHIP_TIMES).toEqual(['combined', 'now', 'future', 'unclear']);
  });

  it.each<[string, SponsorshipTime]>([
    // A "now" of the requirement and a future or open time: both times, so legal.sponsorship-combined answers.
    ['Sponsorship: Do you require sponsorship, or will you require sponsorship in the future for employment '
      + 'authorization in the United States?', 'combined'],
    ['Do you require visa sponsorship, or will you in the future?', 'combined'],
    ['Do you require sponsorship today or in the future?', 'combined'],
    ['Do you currently require or will you ever require visa sponsorship?', 'combined'],
    ['Do you need sponsorship now or later?', 'combined'],
    ['Will you require sponsorship to work in the US, now or at any time?', 'combined'],
    ['Will you now or at any point require sponsorship to work in the United States?', 'combined'],
    ['Will you now or ever require sponsorship?', 'combined'],
    ['Will you now, or at any point, require visa sponsorship?', 'combined'],
    ['Do you currently, or will you at any time, require sponsorship?', 'combined'],
    ['Will you require sponsorship now or later?', 'combined'],
    ['Do you or will you require sponsorship?', 'combined'],
    // "Ever" and "at any time" cover now as well: never future-only, which would drop a now-yes answer.
    ['Will you ever require sponsorship?', 'combined'],
    ['Will you at any time require sponsorship?', 'combined'],
    // One time alone.
    ['Do you require sponsorship at this time?', 'now'],
    ['Do you presently require visa sponsorship?', 'now'],
    ['Do you need visa sponsorship today?', 'now'],
    ['Are you currently in need of sponsorship?', 'now'],
    ['Do you require sponsorship in the future?', 'future'],
    // A "now" that belongs to another clause, and the past tense: the person answers.
    ['Are you currently located in the US, and will you require sponsorship?', 'unclear'],
    ['Will you require sponsorship for a role you are currently applying for?', 'unclear'],
    ['If you are currently on an F-1 visa, will you require sponsorship?', 'unclear'],
    ['Have you ever been sponsored?', 'unclear'],
    ['Has an employer sponsored you before?', 'unclear'],
  ])('%j asks %s', (label, time) => {
    expect(sponsorshipTime(normalizeLabel(label))).toBe(time);
  });

  it.each<[string, FieldCategory]>([
    ['Sponsorship: Do you require sponsorship, or will you require sponsorship in the future for employment '
      + 'authorization in the United States?', 'workAuth.sponsorship'],
    ['Do you require visa sponsorship, or will you in the future?', 'workAuth.sponsorship'],
    ['Do you require sponsorship today or in the future?', 'workAuth.sponsorship'],
    ['Do you currently require or will you ever require visa sponsorship?', 'workAuth.sponsorship'],
    ['Do you need sponsorship now or later?', 'workAuth.sponsorship'],
    ['Will you require sponsorship to work in the US, now or at any time?', 'workAuth.sponsorship'],
    ['Will you now or at any point require sponsorship to work in the United States?', 'workAuth.sponsorship'],
    ['Will you now or ever require sponsorship?', 'workAuth.sponsorship'],
    ['Do you require sponsorship at this time?', 'workAuth.sponsorshipNow'],
    ['Do you presently require visa sponsorship?', 'workAuth.sponsorshipNow'],
    // The parenthetical is read: "(now)" makes the question now-only.
    ['Do you require visa sponsorship (now)?', 'workAuth.sponsorshipNow'],
    ['Will you require visa sponsorship (now or in the future)?', 'workAuth.sponsorship'],
    ['Will you now or in the future require sponsorship for a visa to remain in your current location?',
      'workAuth.sponsorship'],
  ])('%j (radio) is %s', (label, category) => {
    expect(labelHit(label, 'radio')).toMatchObject({ rule: 'label.sponsorship', category });
    expect(labelHit(label, 'radio')?.needsUser).toBeUndefined();
  });

  it.each([
    'Are you currently located in the US, and will you require sponsorship?',
    'If you are currently on an F-1 visa, will you require sponsorship?',
  ])('hands %j to the person', (label) => {
    expect(labelHit(label, 'radio')).toMatchObject({ rule: 'label.sponsorship', needsUser: 'unclear-time' });
  });

  it('reads sponsorship only in its immigration sense', () => {
    expect(labelHit('Do you have experience with sponsorship sales?', 'radio')).toBeNull();
    expect(labelHit('Have you managed corporate sponsorship programs?', 'radio')).toBeNull();
    expect(labelHit('Sponsorship required?', 'radio')?.category).toBe('workAuth.sponsorship');
    expect(labelHit('Sponsorship', 'select')?.category).toBe('workAuth.sponsorship');
    expect(labelHit('Is your known visa status subject to sponsorship?', 'radio')?.category)
      .toBe('workAuth.sponsorship');
  });
});

describe('questions no profile answer states (PRE_RULES)', () => {
  it('run before §8.3’s list, each handing the field to the person', () => {
    expect(PRE_RULES.map((rule) => rule.id)).toEqual(['label.authorization-and-sponsorship', 'label.work-permit',
      'label.nationality', 'label.age']);
    for (const rule of PRE_RULES) expect(NEEDS_USER_CAUSES, rule.id).toContain(rule.needsUser);
  });

  it.each<[string, FieldKind]>([
    // Authorized now is not authorized without sponsorship: an OPT or H-1B holder answers No, not Yes.
    ['Are you legally authorized to work in the United States without the need for employer sponsorship, now or at '
      + 'any time in the future?', 'radio'],
    ['Are you authorized to work in the US without sponsorship?', 'radio'],
    ['Are you authorized to work in the U.S. without requiring visa sponsorship?', 'select'],
    ['I am authorized to work in the US and do not require sponsorship', 'checkbox'],
    ['I certify that I am legally authorized to work in the United States and will not require sponsorship',
      'checkbox'],
    // "Able to work without sponsorship" inverts the sponsorship answer.
    ['Will you be able to work in the US without visa sponsorship?', 'radio'],
    ['Are you able to work in the US without sponsorship?', 'radio'],
    ['Can you work in the U.S. without requiring sponsorship now or in the future?', 'radio'],
    // Two questions in one.
    ['Are you entitled to work in the UK, or will you need sponsorship?', 'radio'],
  ])('%j (%s) ties authorization to sponsorship', (label, kind) => {
    expect(labelHit(label, kind)).toMatchObject({ rule: 'label.authorization-and-sponsorship',
      category: 'workAuth.authorized', needsUser: 'authorization-and-sponsorship' });
  });

  it.each<[string, FieldKind, string, string]>([
    ['Do you need a work permit to work in Germany?', 'radio', 'label.work-permit', 'work-permit'],
    ['Do you hold a valid residence permit?', 'radio', 'label.work-permit', 'work-permit'],
    // s2 core-gh (decision 11): a nationality asked by country takes the citizenships (below); a birth place not.
    ['Country of birth', 'select', 'label.nationality', 'nationality'],
    ['Place of birth', 'text', 'label.nationality', 'nationality'],
    ['Export Control and Compliance: For the sole purpose of determining export licensing requirements, please list '
      + 'any countries of which you are a citizen or legal permanent resident, and when you obtained such status.',
    'textarea', 'label.nationality', 'nationality'],
    ['What is your age?', 'text', 'label.age', 'age'],
    ['Date of birth', 'date', 'label.age', 'age'],
    // Yes to "under 18" means the opposite of yes to "over 18"; 21 is another line.
    ['Are you under 18?', 'radio', 'label.age', 'age'],
    ['Are you 21 or older?', 'radio', 'label.age', 'age'],
    ['Age (optional)', 'text', 'label.age', 'age'],
  ])('%j (%s) is %s’s', (label, kind, rule, needsUser) => {
    expect(labelHit(label, kind)).toMatchObject({ rule, needsUser });
  });

  it('leaves the plain questions to §8.3', () => {
    expect(labelHit('Are you legally authorized to work in the United States?', 'radio')?.rule).toBe('label.work-auth');
    expect(labelHit('Do you require sponsorship?', 'radio')?.rule).toBe('label.sponsorship');
    expect(labelHit('Will you require sponsorship for a work visa?', 'radio')?.rule).toBe('label.sponsorship');
    expect(labelHit('Citizenship', 'select')?.rule).toBe('label.citizenship');
    expect(labelHit('Are you at least 18 years of age?', 'radio')?.rule).toBe('label.over18');
  });
});

describe('consent first, on a lone checkbox and on a radio that asks for it', () => {
  it.each<[string, FieldKind, FieldCategory]>([
    // An earlier rule's topic word no longer decides a consent box, so no profile answer ticks it.
    ['I acknowledge that Acme uses E-Verify to confirm work authorization', 'checkbox', 'consent.other'],
    ['I consent to the collection of my veteran status for EEO reporting', 'checkbox', 'consent.other'],
    ['I acknowledge that this position requires travel', 'checkbox', 'consent.other'],
    ['I understand that this is a remote position', 'checkbox', 'consent.other'],
    ['I consent to Acme retaining my CV for future opportunities', 'checkbox', 'consent.dataRetention'],
    ['I agree that my resume may be shared with affiliated companies', 'checkbox', 'consent.other'],
    ['I understand that former employees must be eligible for rehire', 'checkbox', 'consent.other'],
    ['I authorize a criminal background check', 'checkbox', 'consent.backgroundCheck'],
    ['Would you like to receive marketing emails?', 'radio', 'consent.marketing'],
    // Ashby's SMS consent beside a phone, a Yes and a No (v3 Phase 3: Consent boxes: All agreements chooses its Yes).
    ['Check Yes or No to indicate your agreement to receive text message updates from Acme regarding your job '
      + 'application. Message and data rates may apply.', 'radio', 'consent.sms'],
    ['Resume', 'checkbox', 'consent.other'],
  ])('%j (%s) is %s', (label, kind, category) => {
    expect(labelHit(label, kind)).toMatchObject({ category, consentKinds: [category] });
  });

  it('leaves a claim about the person’s record to the person, even in a certification', () => {
    expect(labelHit('I certify that I have never been convicted of a felony', 'checkbox')).toMatchObject({
      rule: 'label.criminal', category: 'screening.criminalHistory' });
    expect(labelHit('I certify that I have no criminal convictions and consent to a background check', 'checkbox'))
      .toMatchObject({ category: 'screening.criminalHistory' });
  });

  it('reads no consent into a radio that does not ask for it', () => {
    expect(labelHit('Do you have experience in marketing?', 'radio')).toBeNull();
    expect(labelHit('Have you worked with GDPR compliance?', 'radio')).toBeNull();
    expect(labelHit('Are you at least 18 years of age?', 'radio')?.category).toBe('screening.over18');
  });

  it('leaves the boxes that are not consent to their rules', () => {
    expect(labelHit('I currently work here', 'checkbox', 'experience')?.category).toBe('experience.current');
    // A consent topic word with no consent wording keeps §8.3's order: travel, not a marketing consent.
    expect(labelHit('Willing to travel for marketing events', 'checkbox')?.category).toBe('preferences.travel');
    expect(labelHit('Subscribe to our newsletter', 'checkbox')?.category).toBe('consent.marketing');
    expect(labelHit('I identify as one or more of the classifications of protected veteran', 'checkbox')?.category)
      .toBe('eeo.veteran');
  });
});

describe('unrecognised consent', () => {
  it.each<[string, FieldKind]>([
    ['I confirm that the information I have provided is correct', 'checkbox'],
    ['I declare that the information is complete and correct', 'checkbox'],
    ['I have read and understood the above', 'checkbox'],
    ['By checking this box, I give permission to contact my references', 'checkbox'],
    ['By submitting you agree that we may share your data', 'checkbox'],
  ])('%j (%s) is consent.other, which nothing ticks', (label, kind) => {
    expect(labelHit(label, kind)).toMatchObject({ rule: 'label.consent-generic', category: 'consent.other',
      consentKinds: ['consent.other'] });
  });

  it.each<[string, FieldCategory[]]>([
    // Each clause no specific kind covers adds consent.other, so a privacy pre-approval never agrees to arbitration.
    ['I acknowledge the Privacy Notice and agree to the Arbitration Agreement', ['consent.other', 'consent.privacy']],
    ['I agree to the Terms and Conditions and consent to drug testing', ['consent.other', 'consent.terms']],
    ['I have read the privacy policy and I consent to a credit check', ['consent.other', 'consent.privacy']],
    ['I agree to the privacy policy and accept the at-will employment terms', ['consent.other', 'consent.privacy']],
    ['I consent to a background check and agree to binding arbitration', ['consent.other', 'consent.backgroundCheck']],
    // A clause with no object of its own joins its neighbour.
    ['I acknowledge that I have read and agree to the Privacy Policy', ['consent.privacy']],
    ['I acknowledge receipt of the Privacy Notice', ['consent.privacy']],
    ['Privacy policy: I agree', ['consent.privacy']],
    ['I understand and agree', ['consent.other']],
  ])('%j (checkbox) is %j', (label, consentKinds) => {
    expect(labelHit(label, 'checkbox')).toMatchObject({ category: consentKinds[0], consentKinds });
  });

  it('takes the kinds a description adds, which only make the box stricter', () => {
    const hit = labelHit('I agree to the privacy policy', 'checkbox')!;
    const description = normalizeLabel('By ticking this box you also agree to binding arbitration of any disputes.');
    expect(withDescriptionConsent(hit, description, 'checkbox')).toMatchObject({ category: 'consent.other',
      consentKinds: ['consent.other', 'consent.privacy'] });
    expect(withDescriptionConsent(hit, normalizeLabel('Read it at acme.com/privacy'), 'checkbox')).toEqual(hit);
  });

  it('hands a box the person must sign for unrecognised consent to the person', () => {
    // The audit of 2026-11-06 (S-5): a binding waiver on anything but a lone checkbox is the person's, by its own cause.
    expect(labelHit('Sign below to agree to binding arbitration', 'text')).toMatchObject({ category: 'consent.other',
      needsUser: 'binding-waiver' });
    expect(labelHit('Sign below to agree to our privacy notice and terms', 'text')).toMatchObject({
      needsUser: 'kind-mismatch' });
  });
});

// CORE-1 (Phase 2 review): one consent verb with several objects ("agree to the privacy policy and to binding
// arbitration") was read as privacy alone, so a privacy pre-approval ticked an arbitration agreement.
describe('consent covers every object the box binds the person to', () => {
  it.each<[string, FieldCategory[]]>([
    ['I agree to the privacy policy and to binding arbitration', ['consent.other', 'consent.privacy']],
    ['I agree to the Privacy Policy and the Arbitration Agreement', ['consent.other', 'consent.privacy']],
    ['I agree to the privacy policy and binding arbitration', ['consent.other', 'consent.privacy']],
    ['I agree to the privacy policy and jury waiver', ['consent.other', 'consent.privacy']],
    ['I agree to the privacy policy and the non-compete agreement', ['consent.other', 'consent.privacy']],
    ['I accept the terms of service, the privacy policy, and the class action waiver',
      ['consent.other', 'consent.privacy', 'consent.terms']],
    // Commas read as spaces, so a named binding commitment counts wherever it stands.
    ['I agree to the privacy policy, arbitration agreement', ['consent.other', 'consent.privacy']],
    ['Arbitration agreement and privacy policy: I agree', ['consent.other', 'consent.privacy']],
    ['I consent to a background check and to drug testing', ['consent.other', 'consent.backgroundCheck']],
    ['I agree to receive text messages and phone calls', ['consent.other', 'consent.sms']],
    ['I agree to the privacy policy and that my data may be shared with partners',
      ['consent.other', 'consent.privacy']],
    ['I certify that my answers are true and that I will submit to a drug test', ['consent.other', 'consent.certify']],
    ['Keep my information on file for future opportunities and enroll me in binding arbitration',
      ['consent.other', 'consent.dataRetention']],
  ])('%j (checkbox) is %j: nothing pre-approved covers the extra object', (label, consentKinds) => {
    expect(labelHit(label, 'checkbox')).toMatchObject({ category: consentKinds[0], consentKinds });
  });

  it.each<[string, FieldCategory[]]>([
    // The opposites: every object is one the kinds name, so the box keeps its kinds.
    ['I agree to the terms and conditions and the privacy policy', ['consent.privacy', 'consent.terms']],
    ['I agree to the Terms of Service and Privacy Policy', ['consent.privacy', 'consent.terms']],
    ['I consent to a background check and to text messages', ['consent.sms', 'consent.backgroundCheck']],
    ['I consent to the collection and processing of my personal data in accordance with the privacy policy',
      ['consent.privacy']],
    ['I certify that my answers are true and complete', ['consent.certify']],
    ['I certify that my answers are accurate and complete to the best of my knowledge', ['consent.certify']],
    ['I certify that the above is true and agree to the privacy policy', ['consent.certify', 'consent.privacy']],
    ['I acknowledge that I have read and understood the privacy notice', ['consent.privacy']],
    ['I consent to Acme retaining my CV for future opportunities', ['consent.dataRetention']],
    ['I agree to receive marketing emails and text messages', ['consent.marketing', 'consent.sms']],
    ['I agree to receive text messages at the phone number provided', ['consent.sms']],
  ])('%j (checkbox) keeps %j', (label, consentKinds) => {
    expect(labelHit(label, 'checkbox')).toMatchObject({ category: consentKinds[0], consentKinds });
  });
});

// CORE-2 (Phase 2 review): an opt-out box ("I do not wish to receive marketing emails") was read as the consent it
// declines, so a marketing pre-approval ticked it.
describe('a consent box worded as an opt-out or a refusal is not the consent it names', () => {
  it.each<[string, FieldKind]>([
    ['I do not consent to receive text messages', 'checkbox'],
    ['I do not wish to receive marketing emails', 'checkbox'],
    ["I don't want to join the talent community", 'checkbox'],
    ['Opt out of SMS', 'checkbox'],
    ['Please opt me out of marketing emails', 'checkbox'],
    ['Do not contact me by SMS', 'checkbox'],
    ['Do not sell or share my personal information under the privacy policy', 'checkbox'],
    ['Check this box if you do not want to receive our newsletter', 'checkbox'],
    ['Tick here to opt out of job alerts', 'checkbox'],
    ['No, I do not want marketing updates about new roles', 'checkbox'],
    ['I decline the background check', 'checkbox'],
    ['Would you like to opt out of marketing emails?', 'radio'],
    ['Do you wish to unsubscribe from text messages?', 'radio'],
  ])('%j (%s) is consent.other, which nothing ticks', (label, kind) => {
    const hit = labelHit(label, kind);
    expect(hit?.category).toBe('consent.other');
    expect(hit?.consentKinds).toContain('consent.other');
  });

  it.each<[string, FieldCategory[]]>([
    // The opposites: a box that consents, whatever it says about opting out later.
    ['I agree to receive text messages. Reply STOP to opt out.', ['consent.sms']],
    ['I consent to receive text messages; you can opt out at any time', ['consent.sms']],
    ['Subscribe to our newsletter. You may unsubscribe at any time.', ['consent.marketing']],
    ['I agree to the privacy policy. Acme will not sell your data.', ['consent.privacy']],
    ['I would like to receive job alerts', ['consent.marketing']],
  ])('%j (checkbox) keeps %j', (label, consentKinds) => {
    expect(labelHit(label, 'checkbox')).toMatchObject({ category: consentKinds[0], consentKinds });
  });
});

describe('self-identification questions', () => {
  it.each<[string, FieldKind, FieldCategory]>([
    // Wordings real surveys use, beyond §8.3's anchored ones.
    ['What best describes your gender?', 'radio', 'eeo.gender'],
    ['What gender do you identify with?', 'radio', 'eeo.gender'],
    ['How do you describe your gender?', 'radio', 'eeo.gender'],
    ['Which gender do you identify as?', 'select', 'eeo.gender'],
    ['I identify my gender as', 'radio', 'eeo.gender'],
    ['Please select your gender', 'select', 'eeo.gender'],
    ['Your gender', 'select', 'eeo.gender'],
    ['What is your sex?', 'select', 'eeo.gender'],
    // Gender identity against the sex assigned at birth is the transgender question, never gender.
    ['Is your gender identity the same as the sex you were assigned at birth?', 'radio', 'eeo.transgender'],
    ['Sex assigned at birth', 'select', 'eeo.transgender'],
    ['Do you identify as cisgender?', 'radio', 'eeo.transgender'],
    ['I consider myself a member of the LGBTQ+ community. (optional)', 'combobox', 'eeo.sexualOrientation'],
    ['Do you identify as LGBTQ+?', 'radio', 'eeo.sexualOrientation'],
    ['What is your race?', 'select', 'eeo.race'],
    ['Please select your race', 'select', 'eeo.race'],
    ['Which race do you identify with?', 'select', 'eeo.race'],
    ['What is your race/ethnicity?:', 'radio', 'eeo.race'],
    ['What best describes your ethnicity?', 'radio', 'eeo.race'],
    ['Have you served in the U.S. Armed Forces?', 'radio', 'eeo.veteran'],
    ['Are you a veteran/have you served in the military?', 'radio', 'eeo.veteran'],
    ['Voluntary Self-Identification of Disability', 'radio', 'eeo.disability'],
    ['Are you Hispanic/Latino?', 'combobox', 'eeo.hispanicLatino'],
    // Criminal history before gender: "sex offender" is never the gender question.
    ['Are you a registered sex offender?', 'radio', 'screening.criminalHistory'],
    ['Do you have any unspent convictions?', 'radio', 'screening.criminalHistory'],
    ['Have you ever been found guilty of a crime?', 'radio', 'screening.criminalHistory'],
    ['Have you ever pleaded guilty to an offence?', 'radio', 'screening.criminalHistory'],
    ['Are you over the age of 18?', 'radio', 'screening.over18'],
    ['Are you 18 or older?', 'radio', 'screening.over18'],
  ])('%j (%s) is %s', (label, kind, category) => {
    expect(labelHit(label, kind)).toMatchObject({ category });
    expect(labelHit(label, kind)?.needsUser).toBeUndefined();
  });

  it.each<[string, FieldKind]>([
    // A topic word in a question about the job: never answered with the person's self-identification.
    ['Do you have experience supporting individuals with disabilities?', 'radio'],
    ['Do you have experience processing short-term disability claims?', 'radio'],
    ['Are you familiar with the Americans with Disabilities Act?', 'radio'],
    ['Please describe any disability accommodations you need', 'textarea'],
    ['Do you have experience marketing to Hispanic and Latino audiences?', 'radio'],
    ['Do you have experience serving military service members?', 'radio'],
    ['Do you have experience providing care to transgender patients?', 'radio'],
    ['Do you have experience supporting LGBTQ+ youth?', 'radio'],
    ['Do you have experience with racial equity programs?', 'radio'],
  ])('%j (%s) is the person’s own question', (label, kind) => {
    expect(labelHit(label, kind)).toMatchObject({ rule: 'label.sensitive-topic', category: 'screening.other',
      needsUser: 'sensitive-topic' });
  });

  it('reads "eligible to work" as authorization only with a place or "legally"', () => {
    expect(labelHit('Are you eligible to work overtime?', 'radio')).toBeNull();
    expect(labelHit('Are you permitted to work weekends?', 'radio')).toBeNull();
    expect(labelHit('Are you eligible to work in Canada?', 'select')?.category).toBe('workAuth.authorized');
    expect(labelHit('Are you legally eligible to work?', 'radio')?.category).toBe('workAuth.authorized');
    expect(labelHit('Are you entitled to work in the UK?', 'radio')?.category).toBe('workAuth.authorized');
  });
});

describe('an entity rule needs the label’s own noun, not a word in a question', () => {
  it.each<[string, FieldKind]>([
    // s2 core-wd: "Phone extension" is the phone's extension now (contact.phoneExtension), never the number.
    ['Phone extension number to call for an interview', 'text'],
    ['How many years of mobile development experience do you have?', 'select'],
    ['What is your availability for a phone interview?', 'textarea'],
    ['What size portfolio have you managed?', 'text'],
    ['What are your major accomplishments?', 'text'],
    ['Describe your experience with compensation planning', 'text'],
    ['Which business unit are you applying to?', 'text'],
    ['Microsoft Office Suite proficiency', 'text'],
    ['Excel proficiency', 'select'],
    ['Rate your proficiency in SQL', 'select'],
    ['Position applied for', 'text'],
    ['Which position are you applying for?', 'combobox'],
    ['Are you entitled to work overtime?', 'text'],
    ['Do you require relocation assistance?', 'radio'],
    ['Do you have any travel restrictions?', 'radio'],
    ['Are you comfortable working in the office three days a week in this role?', 'combobox'],
  ])('%j (%s) takes no profile value', (label, kind) => {
    const hit = labelHit(label, kind);
    expect(hit === null || hit.category === 'screening.other' || hit.category === 'unknown', JSON.stringify(hit))
      .toBe(true);
  });

  it.each<[string, FieldKind, FieldCategory]>([
    // The question's own rule, no longer taken by an earlier entity word.
    ['Have you previously worked for this company?', 'text', 'screening.previouslyEmployed'],
    ['Are you currently based in or willing to relocate to the Bay Area for this position?', 'combobox',
      'preferences.relocation'],
    ['Are you willing to relocate for this position?', 'combobox', 'preferences.relocation'],
    ['How did you hear about this position?', 'combobox', 'referral.source'],
    ['How did you hear about our company?', 'text', 'referral.source'],
    ['Why are you interested in this role?', 'text', 'freeText.whyRole'],
    ['Why do you want to work at our company?', 'text', 'freeText.whyCompany'],
    ['Language proficiency', 'select', 'languages.proficiency'],
    // Years with a skill or in a role, and availability for something else, are other questions.
    ['How many years of experience do you have in a similar role?', 'text', 'screening.other'],
    ['How many years of experience do you have at a SaaS company?', 'text', 'screening.other'],
    ['Years of experience in cell culture', 'text', 'screening.other'],
    // jr6 RULES R3 (JV-16): N years of experience in or as something is asked of the experience entries
    // (experience.yearsIn), never the total years.
    ['Do you have at least 3 years of experience in a similar role?', 'combobox', 'experience.yearsIn'],
    ['What is your availability for a phone interview?', 'text', 'screening.other'],
    // The fields themselves still classify.
    ['Phone', 'text', 'contact.phone'],
    ['Mobile phone number', 'text', 'contact.phone'],
    ['What is your phone number?', 'text', 'contact.phone'],
    ['Phone number, including country code', 'text', 'contact.phone'],
    ['Company name', 'text', 'experience.company'],
    ['Who is your current employer?', 'text', 'experience.currentCompany'],
    ['Most recent job title', 'text', 'experience.title'],
    ['Title/Position', 'text', 'experience.title'],
    ['Link to your portfolio', 'text', 'links.portfolio'],
    ['What is your major?', 'text', 'education.field'],
    ['Apartment, suite, etc.', 'text', 'address.line2'],
    ['What is your availability?', 'text', 'availability.startDate'],
    ['How many years of experience do you have?', 'text', 'experience.totalYears'],
    ['Spanish fluency', 'select', 'languages.proficiency'],
  ])('%j (%s) is %s', (label, kind, category) => {
    expect(labelHit(label, kind)?.category).toBe(category);
  });
});

describe('pay', () => {
  it.each<[string, FieldKind]>([
    ['Current salary', 'text'],
    ['What is your current base compensation?', 'text'],
    ['Previous compensation', 'select'],
    ['Given your current salary, what are your salary expectations?', 'text'],
    ['Salary history', 'text'],
  ])('%j (%s) asks for pay the profile does not hold: the person’s', (label, kind) => {
    expect(labelHit(label, kind)).toMatchObject({ rule: 'label.salary', needsUser: 'current-pay' });
  });

  it.each<[string, FieldKind]>([
    ['Expected pay range', 'text'],
    ['Desired annual base pay', 'text'],
    ['What is your expected total compensation?', 'text'],
    ['Expected salary', 'text'],
    // "Current" that is not the pay's own word.
    ['What salary do you expect in your current location?', 'text'],
  ])('%j (%s) is the expected salary', (label, kind) => {
    expect(labelHit(label, kind)).toMatchObject({ rule: 'label.salary', category: 'salary.expected' });
    expect(labelHit(label, kind)?.needsUser).toBeUndefined();
  });

  it('never reads an hourly rate as the yearly expectation', () => {
    expect(labelHit('Hourly rate', 'text')).toBeNull();
  });
});

describe('free-text questions', () => {
  it.each<[string, FieldCategory]>([
    ['Why are you interested in this role?', 'freeText.whyRole'],
    ['What excites you about this opportunity?', 'freeText.whyRole'],
    ['Why do you want to join Acme?', 'freeText.whyCompany'],
    ['Why do you want to join Figma?', 'freeText.whyCompany'],
    ['Why Acme?', 'freeText.whyCompany'],
    ['Why GitLab? *', 'freeText.whyCompany'],
    ['Why us?', 'freeText.whyCompany'],
  ])('%j (textarea) is %s', (label, category) => {
    expect(labelHit(label, 'textarea')?.category).toBe(category);
  });

  it.each(['Why not?', 'Why leaving?', 'WHY NOT?', 'What makes you a good fit for this role?'])(
    '%j (textarea) is no why-question of §8.3', (label) => {
      expect(labelHit(label, 'textarea')).toBeNull();
    });

  it('keeps "Do you want to join our talent community?" consent: marketing (the Phase E review, B1)', () => {
    expect(labelHit('Do you want to join our talent community?', 'checkbox')?.category).toBe('consent.marketing');
  });
});

describe('other wordings real forms use', () => {
  it.each<[string, FieldKind, FieldCategory]>([
    ['What is your current country of residence?', 'combobox', 'address.country'],
    ['What country do you live in?', 'select', 'address.country'],
    // Spotify's Lever survey asks it over a select of 250 countries.
    ['What is your location?', 'select', 'location.current'],
    ['Your current location', 'text', 'location.current'],
    ['What\u2019s the name you\u2019d prefer us to use throughout the interview process?', 'text',
      'identity.preferredName'],
  ])('%j (%s) is %s', (label, kind, category) => {
    expect(labelHit(label, kind)?.category).toBe(category);
  });

  it('never unanchors the country, so a work-authorization question keeps its rule', () => {
    expect(labelHit('Are you legally authorized to work in your country of residence?', 'radio')?.category)
      .toBe('workAuth.authorized');
  });
});

describe('the fallbacks (UNRECOGNISED_FIELD_RULES)', () => {
  it('make a labelled textarea free text and a lone checkbox unrecognised consent, both weak', () => {
    expect(UNRECOGNISED_FIELD_RULES).toEqual({
      textarea: { id: 'label.unrecognised-textarea', category: 'freeText.other', strength: 'weak' },
      checkbox: { id: 'label.unrecognised-checkbox', category: 'consent.other', strength: 'weak' },
    });
    expect(unrecognisedField('textarea')).toEqual({ rule: 'label.unrecognised-textarea', category: 'freeText.other',
      strength: 'weak', confidence: 0.75 });
    expect(unrecognisedField('checkbox')).toEqual({ rule: 'label.unrecognised-checkbox', category: 'consent.other',
      strength: 'weak', confidence: 0.75, consentKinds: ['consent.other'] });
    expect(unrecognisedField('text')).toBeNull();
    expect(unrecognisedField('radio')).toBeNull();
  });
});

describe('the language rule’s widening (Phase 2)', () => {
  it('reads "Which languages do you speak?" as the languages question, and a programming one as not', () => {
    expect(labelHit('Which languages do you speak?', 'checkbox-group')).toMatchObject({ rule: 'label.language',
      category: 'languages.language' });
    expect(labelHit('What languages can you speak fluently?', 'checkbox-group')?.category).toBe('languages.language');
    expect(labelHit('What programming languages do you know?', 'checkbox-group')?.category)
      .not.toBe('languages.language');
    expect(labelHit('What level of Spanish do you speak?', 'select')?.category).not.toBe('languages.language');
  });
});

describe('marketing and data retention (the Phase E review, B1)', () => {
  it.each<[string, FieldKind, FieldCategory[]]>([
    // Being contacted, emailed or told about future roles, or a talent community or pool: marketing.
    ['Spotify has my consent to contact me about future job opportunities.', 'checkbox', ['consent.marketing']],
    ['I agree to be contacted about future job opportunities', 'checkbox', ['consent.marketing']],
    ['Please contact me about future job opportunities', 'checkbox', ['consent.marketing']],
    ['Yes, I would like to receive emails about future roles', 'checkbox', ['consent.marketing']],
    ['Would you like to join our talent community?', 'radio', ['consent.marketing']],
    ['May we contact you about future openings?', 'radio', ['consent.marketing']],
    ['Would you like to hear about other roles at Acme?', 'radio', ['consent.marketing']],
    ['I would like to be considered for future roles and join the talent community', 'checkbox',
      ['consent.marketing']],
    // Retaining or keeping the application on file: retention.
    ['Keep my information on file for future opportunities', 'checkbox', ['consent.dataRetention']],
    ['I consent to Acme retaining my CV for future opportunities', 'checkbox', ['consent.dataRetention']],
    // Both: every kind must be pre-approved, so the default leaves it.
    ['Do you consent to us storing your CV in our talent pool?', 'radio', ['consent.dataRetention', 'consent.marketing']],
  ])('%j (%s) is %j', (label, kind, kinds) => {
    expect(labelHit(label, kind)).toMatchObject({ category: kinds[0], consentKinds: kinds });
  });
});

describe('an "I did not use AI" statement (the Phase E review, M5)', () => {
  it('is a negation of AI use, never consent wording that only names AI', () => {
    for (const text of ['i did not use ai to write this application', 'i certify that i have not used chatgpt',
      'no ai tools were used', 'ai was not used to prepare my answers', 'written without the use of ai']) {
      expect(attestsNoAiUse(text), text).toBe(true);
    }
    for (const text of ['i acknowledge the privacy notice including that ai tools may be used to review my application',
      'i consent to acme using ai to screen applications', 'i understand that ai may assist recruiters']) {
      expect(attestsNoAiUse(text), text).toBe(false);
      // Still an AI attestation to the consent policy, which nothing ticks.
      expect(labelHit(text, 'checkbox')?.consentKinds, text).toContain('consent.aiAttestation');
    }
  });

  // The core pass of 2026-11-06: Dropzone's AI policy on Greenhouse (the owner's snapshot of 2026-11-06) denies AI in two
  // joined participles, its AI term six words past "not".
  it('reads a denial in two joined participles (Dropzone\'s), and no warning that names them', () => {
    for (const text of ['all responses provided are my own original work and were not generated or substantially '
      + 'assisted by any ai tool', 'my answers were not written or assisted by ai']) {
      expect(attestsNoAiUse(text), text).toBe(true);
    }
    // A warning about such work states nothing of the applicant's.
    expect(attestsNoAiUse('answers generated or assisted by ai tools will be rejected')).toBe(false);
  });
});

// ── s2 core-gh (snapshot round 2: fixtures/greenhouse/s2-*, fixtures/lever/s2-ahead-*) ──────────────────────────────
describe('s2 core-gh: the snapshot round’s rules', () => {
  it.each<[string, FieldKind, FieldCategory, string]>([
    // Decision 11: a yes/no legal question in a text box, asked as yes or no.
    ['Will you require sponsorship for this position?', 'text', 'workAuth.sponsorship', 'label.sponsorship'],
    ['Are you legally authorized to work in the country where this position is located?', 'text', 'workAuth.authorized',
      'label.work-auth'],
    ['Do you require visa sponsorship to work at this company?', 'text', 'workAuth.sponsorship', 'label.sponsorship'],
    // Decision 11: a nationality by country; the parenthetical says what the country is.
    ['Nationality', 'select', 'workAuth.citizenship', 'label.citizenship-country'],
    ['Country of citizenship', 'select', 'workAuth.citizenship', 'label.citizenship-country'],
    ['Country (of citizenship)', 'select', 'workAuth.citizenship', 'label.citizenship-country'],
    ['Country of Origin', 'text', 'workAuth.citizenship', 'label.citizenship-country'],
    // Decision 13: a need for the employer to sponsor is sponsorship (s2-onestream-related-open).
    ['Will you now or in the future require OneStream to sponsor your employment visa status/work authorization in the '
      + 'country/province you are applying for?', 'combobox', 'workAuth.sponsorship', 'label.sponsorship'],
    // Decision 9: X and Telegram, and a link in a box of text.
    ['X username', 'text', 'links.twitter', 'label.twitter'],
    ['X (formerly Twitter) profile', 'text', 'links.twitter', 'label.twitter'],
    ['Telegram username', 'text', 'links.telegram', 'label.telegram'],
    ['LinkedIn Profile', 'textarea', 'links.linkedin', 'label.linkedin'],
    // The gh study's §1 and §3f.
    ['Have you ever been employed or appointed by Horace Mann or any of its subsidiaries as a contractor?', 'combobox',
      'screening.previouslyEmployed', 'label.previously-employed'],
    ['Are you currently a Full-Time/Part-Time employee or appointee of Horace Mann Inc or any of its subsidiaries?',
      'combobox', 'screening.previouslyEmployed', 'label.previously-employed'],
    ['Do you have a non-compete with your current company?', 'combobox', 'screening.restrictiveAgreement',
      'label.restrictive-agreement'],
    ['Are you related to anyone currently employed at OneStream?', 'combobox', 'screening.relatives', 'label.relatives'],
    ['Are you currently or have you within the last five years served in the U.S. armed forces or been employed by any '
      + 'U.S. federal, state, and local government?', 'combobox', 'screening.governmentService',
    'label.government-service'],
    ['Do you hold an Active TS/SCI?', 'combobox', 'workAuth.clearance', 'label.clearance'],
    ['What is your current address?', 'text', 'address.full', 'label.full-address'],
    ['Primary Residence Address', 'text', 'address.full', 'label.full-address'],
    ['Where do you currently reside? (City/State)?', 'text', 'location.current', 'label.location'],
    ['Please provide your city and state of residence.', 'text', 'location.current', 'label.location'],
    ['What city are you located in?', 'text', 'location.current', 'label.location'],
    ['Which of the following infrastructure-as-code tools have you used in a production environment?',
      'checkbox-group', 'skills.list', 'label.skills-used'],
    // The eeo study's §2C (s2-ahead-0).
    ['Confirm the ability to perform the requisite duties of the role with or without reasonable accommodations',
      'select', 'screening.essentialFunctions', 'label.essential-functions'],
    ['Do you hold any industry related certifications?', 'text', 'skills.certifications', 'label.certifications'],
    ['If so, where would you be open to relocating?', 'text', 'preferences.relocationPlaces',
      'label.relocation-places'],
    ['Provide All Post-Secondary Education Attained - Formatted as: College Name; Degree Obtained', 'textarea',
      'education.summary', 'label.education-summary'],
  ])('%j (%s) is %s by %s', (label, kind, category, rule) => {
    expect(labelHit(label, kind)).toMatchObject({ category, rule });
    expect(labelHit(label, kind)?.needsUser).toBeUndefined();
  });

  it.each<[string, FieldKind, FieldCategory | null]>([
    // Never a bare X, a Telegram number, a residence asked as yes or no, government clients, a named certification.
    ['X', 'text', null],
    ['Telegram number', 'text', null],
    ['Do you currently reside in Los Angeles County?', 'combobox', null],
    ['Have you ever worked for a government agency?', 'radio', 'screening.previouslyEmployed'],
    ['Do you have experience working with government clients?', 'radio', null],
    ['Address', 'text', 'address.line1'],
    ['Street address', 'text', 'address.line1'],
    ['Do you have any AWS certifications?', 'text', null],
  ])('%j (%s) is not read so', (label, kind, category) => {
    const hit = labelHit(label, kind);
    if (category === null) {
      expect([null, 'screening.other', 'unknown'].includes(hit?.category ?? null), JSON.stringify(hit)).toBe(true);
    } else {
      expect(hit?.category).toBe(category);
    }
  });

  it('keeps a yes/no legal answer out of a text box that does not ask yes or no', () => {
    expect(labelHit('If no, how many months is your current work authorization valid for?', 'text'))
      .toMatchObject({ category: 'workAuth.authorized', needsUser: 'kind-mismatch' });
  });

  it('reads Ridgeline’s question sentence alone, never the requirement stated after it', () => {
    const label = 'Will you now or in the future require sponsorship for employment visa status (e.g. H-1B, TN, F1, '
      + 'OPT, etc)? You must be work authorized in the United States without the need for employer sponsorship.';
    const text = normalizeLabel(label);
    const questions = normalizeLabel(label.slice(0, label.lastIndexOf('?') + 1));
    expect(matchLabelRules(text, 'other', 'combobox', { rawLabel: label, questions })).toMatchObject({
      rule: 'label.sponsorship', category: 'workAuth.sponsorship' });
    expect(matchLabelRules(text, 'other', 'combobox', { rawLabel: label })?.needsUser)
      .toBe('authorization-and-sponsorship');
  });

  it('reads a consent to an identity check asked as a question as unrecognised consent', () => {
    expect(labelHit('Due to fraud we are sending automated CLEAR ID verification. Are you okay doing this validation?',
      'radio')).toMatchObject({ category: 'consent.other', rule: 'label.consent-check' });
    expect(labelHit('Are you comfortable doing on-call rotations?', 'radio')?.category).not.toBe('consent.other');
  });
});

// ── s2 core-gh review (C5): a government's contractor or client is no government service ──
describe('s2 core-gh review (C5)', () => {
  it.each<[string]>([
    ['Have you worked for a federal government contractor?'],
    ['Are you currently employed by a U.S. government contractor or subcontractor?'],
    ['Have you worked with federal government clients?'],
  ])('%j is no government service', (label) => {
    expect(labelHit(label, 'radio')?.category).not.toBe('screening.governmentService');
  });
});
