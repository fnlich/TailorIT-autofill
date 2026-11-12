import { describe, expect, it } from 'vitest';
import { CONSENT_CATEGORIES, FIELD_KINDS } from '../enums';
import { FIELD_CATEGORIES, POLICY_CLASSES, type FieldCategory, type PolicyClass } from '../types/intent';
import {
  AI_OPENED_CATEGORIES, CATEGORY_CLASS, CATEGORY_KINDS, CLASS_POLICIES, GUESS_ONLY_CATEGORIES, kindAllowed, OPEN_CLASSES,
  policyClassOf, USER_ONLY_CATEGORIES, VALUE_SOURCES, type ClassPolicy,
} from './categories';

/** §8.2's "Categories" column, read row by row; whatever no row names is profile. */
const DESIGN_CLASS: Array<[PolicyClass, (category: FieldCategory) => boolean]> = [
  // jr7 RULES-7 (UKGR-14): a national id or social security number, never filled from anything.
  ['sensitive', (c) => c.startsWith('salary.') || c === 'identity.pronouns' || c === 'identity.nationalId'],
  // s2 core-gh: the screening answers of snapshot round 2 are the person's own, legal.
  ['legal', (c) => c.startsWith('workAuth.') || c === 'screening.over18' || c === 'screening.criminalHistory'
    || ['screening.restrictiveAgreement', 'screening.governmentService', 'screening.relatives',
      'screening.essentialFunctions',
      // jr6 RULES R3 (WD-29): military training, from the service and veteran answers.
      'screening.militaryTraining'].includes(c)],
  ['eeo', (c) => c.startsWith('eeo.')],
  ['consent', (c) => c.startsWith('consent.')],
  ['attention', (c) => c === 'attentionCheck'],
  ['free-text', (c) => c.startsWith('freeText.')],
  ['file', (c) => c.startsWith('file.')],
  ['unknown', (c) => c === 'unknown' || c === 'screening.previouslyEmployed' || c === 'screening.other'],
];
/** The profile row: identity (except pronouns), contact, address, location, links, education, experience, languages,
 *  skills, referral, relocation, workArrangement, travel, availability. */
const PROFILE_FAMILIES = ['identity.', 'contact.', 'address.', 'location.', 'links.', 'education.', 'experience.',
  'languages.', 'skills.', 'referral.', 'preferences.relocation', 'preferences.workArrangement', 'preferences.travel',
  'availability.',
  // jr6 RULES R3 (ICIMS-26): the person's time zone, from their state.
  'preferences.timeZone',
  // jr6 RULES R4 (ADP-18): how the résumé is given, from the run's résumé.
  'application.'];

describe('CATEGORY_CLASS (§8.2)', () => {
  it('covers exactly the field categories', () => {
    expect(Object.keys(CATEGORY_CLASS).sort()).toEqual([...FIELD_CATEGORIES].sort());
  });

  it.each(FIELD_CATEGORIES.map((category) => [category]))('%s has the class §8.2 gives it', (category) => {
    const expected = DESIGN_CLASS.find(([, member]) => member(category))?.[0] ?? 'profile';
    expect(policyClassOf(category)).toBe(expected);
    if (expected === 'profile') expect(PROFILE_FAMILIES.some((family) => category.startsWith(family))).toBe(true);
  });

  it('puts sexual orientation and transgender identity in eeo', () => {
    expect(policyClassOf('eeo.sexualOrientation')).toBe('eeo');
    expect(policyClassOf('eeo.transgender')).toBe('eeo');
  });

  it('uses every policy class', () => {
    expect(new Set(Object.values(CATEGORY_CLASS))).toEqual(new Set(POLICY_CLASSES));
  });
});

describe('CATEGORY_KINDS (§8.2)', () => {
  it('covers exactly the field categories, each with known, distinct kinds', () => {
    expect(Object.keys(CATEGORY_KINDS).sort()).toEqual([...FIELD_CATEGORIES].sort());
    for (const [category, kinds] of Object.entries(CATEGORY_KINDS)) {
      expect(kinds.length, category).toBeGreaterThan(0);
      expect(new Set(kinds).size, category).toBe(kinds.length);
      for (const kind of kinds) expect(FIELD_KINDS, category).toContain(kind);
    }
  });

  it('has the four kinds the design fixes', () => {
    for (const category of ['file.resume', 'file.coverLetter', 'file.other'] as const) {
      expect(CATEGORY_KINDS[category]).toEqual(['file']);
    }
    expect(CATEGORY_KINDS['contact.email']).toEqual(['text']);
    expect(CATEGORY_KINDS['experience.current']).toEqual(['checkbox']);
    // jr6 RULES R3 (ICIMS-15): a signature is also a box to tick (iCIMS's IForm Signature).
    expect(CATEGORY_KINDS['consent.signature']).toEqual(['text', 'checkbox']);
  });

  it('allows an upload only for files and the categories that take any kind', () => {
    const withFile = FIELD_CATEGORIES.filter((category) => kindAllowed(category, 'file'));
    expect(withFile).toEqual(['attentionCheck', 'file.resume', 'file.coverLetter', 'file.other', 'unknown']);
  });

  it('allows a consent only on a box or a radio, a signature only as text', () => {
    for (const category of FIELD_CATEGORIES.filter((c) => c.startsWith('consent.') && c !== 'consent.signature'
      && c !== 'consent.signatureDate')) {
      expect(CATEGORY_KINDS[category], category).toEqual(['checkbox', 'radio']);
    }
    // jr6 RULES (JV-1, JZ-15, workday-new-1): a signature's date is typed or set in a date control; jr6 fix (RULES-R11):
    // or chosen part by part (iCIMS's IForm dates).
    expect(CATEGORY_KINDS['consent.signatureDate']).toEqual(['text', 'date', 'select', 'combobox']);
  });

  it('never allows typed text for a self-identification or a yes/no legal question', () => {
    const chosenOnly: FieldCategory[] = [...FIELD_CATEGORIES.filter((c) => c.startsWith('eeo.')), 'workAuth.status',
      'screening.over18', 'screening.restrictiveAgreement', 'screening.governmentService', 'screening.relatives',
      'screening.essentialFunctions'];
    for (const category of chosenOnly) {
      expect(kindAllowed(category, 'text'), category).toBe(false);
      expect(kindAllowed(category, 'textarea'), category).toBe(false);
    }
    // s2 core-gh (decision 11): authorization and sponsorship asked yes or no in a text box take "Yes" or "No"
    // (labelRules YES_NO_QUESTION); never a box of prose.
    for (const category of ['workAuth.authorized', 'workAuth.sponsorship', 'workAuth.sponsorshipNow',
      'workAuth.sponsorshipFuture'] as const) {
      expect(kindAllowed(category, 'text'), category).toBe(true);
      expect(kindAllowed(category, 'textarea'), category).toBe(false);
    }
  });

  it.each<[FieldCategory, (typeof FIELD_KINDS)[number], boolean]>([
    ['contact.email', 'checkbox', false],
    ['contact.phone', 'select', false],
    ['experience.title', 'select', false],
    // A combobox is a fixed list (Greenhouse's Yes/No questions): an employer or a title is typed or searched for.
    ['experience.title', 'combobox', false],
    ['experience.currentTitle', 'combobox', false],
    ['experience.company', 'combobox', false],
    ['experience.currentCompany', 'combobox', false],
    ['experience.currentCompany', 'typeahead-remote', true],
    ['experience.current', 'checkbox', true],
    ['education.school', 'typeahead-remote', true],
    ['location.current', 'typeahead-remote', true],
    ['eeo.race', 'checkbox-group', true],
    ['freeText.whyCompany', 'textarea', true],
    ['freeText.coverLetter', 'select', false],
    ['unknown', 'file', true],
  ])('kindAllowed(%s, %s) is %s', (category, kind, allowed) => {
    expect(kindAllowed(category, kind)).toBe(allowed);
  });
});

describe('CLASS_POLICIES (§8.2)', () => {
  it.each<[PolicyClass, ClassPolicy]>([
    ['profile', { valueFrom: ['profile', 'rule'], savedAnswers: 'global', llmTiebreak: 'per-domain',
      llmClassified: 'fill-flagged', fuzzy: 'per-domain' }],
    ['sensitive', { valueFrom: ['explicit-profile'], savedAnswers: 'never', llmTiebreak: 'never',
      llmClassified: 'never', fuzzy: 'never' }],
    ['legal', { valueFrom: ['explicit-profile', 'explicit-decline'], savedAnswers: 'never', llmTiebreak: 'never',
      llmClassified: 'never', fuzzy: 'never' }],
    ['eeo', { valueFrom: ['explicit-profile', 'explicit-decline'], savedAnswers: 'never', llmTiebreak: 'never',
      llmClassified: 'never', fuzzy: 'never' }],
    ['consent', { valueFrom: ['preapproved-consent'], savedAnswers: 'never', llmTiebreak: 'never',
      llmClassified: 'never', fuzzy: 'never' }],
    ['attention', { valueFrom: [], savedAnswers: 'never', llmTiebreak: 'never', llmClassified: 'never',
      fuzzy: 'never' }],
    // The owner's amendments (docs/SPEC-AMENDMENTS.md) put back §8.2's "draft only" for a free-text category only the
    // LLM classified, and add the AI answer (a short box).
    ['free-text', { valueFrom: ['saved', 'llm-draft', 'llm-answer'], savedAnswers: 'company',
      llmTiebreak: 'not-applicable', llmClassified: 'draft-only', fuzzy: 'not-applicable' }],
    ['file', { valueFrom: ['profile'], savedAnswers: 'never', llmTiebreak: 'never', llmClassified: 'never',
      fuzzy: 'not-applicable' }],
    // The AI answer, and the rule that answers "Have you worked here before?" (the owner's amendments).
    ['unknown', { valueFrom: ['saved', 'rule', 'llm-answer'], savedAnswers: 'global', llmTiebreak: 'allowed',
      llmClassified: 'not-applicable', fuzzy: 'generic' }],
  ])('%s follows its row', (policyClass, policy) => {
    expect(CLASS_POLICIES[policyClass]).toEqual(policy);
  });

  it('covers every class, with known value sources', () => {
    expect(Object.keys(CLASS_POLICIES).sort()).toEqual([...POLICY_CLASSES].sort());
    for (const policy of Object.values(CLASS_POLICIES)) {
      for (const source of policy.valueFrom) expect(VALUE_SOURCES).toContain(source);
    }
  });

  it('lets saved answers, the LLM and fuzzy matching play no part outside profile, free-text and unknown', () => {
    expect(OPEN_CLASSES).toEqual(['profile', 'free-text', 'unknown']);
    const off = ['never', 'not-applicable'];
    for (const policyClass of POLICY_CLASSES) {
      const policy = CLASS_POLICIES[policyClass];
      const closed = policy.savedAnswers === 'never' && off.includes(policy.llmTiebreak)
        && off.includes(policy.llmClassified) && off.includes(policy.fuzzy)
        && !policy.valueFrom.includes('saved') && !policy.valueFrom.includes('llm-draft')
        && !policy.valueFrom.includes('llm-answer');
      expect(closed, policyClass).toBe(!OPEN_CLASSES.includes(policyClass));
    }
  });
});

describe('USER_ONLY_CATEGORIES', () => {
  it('holds attention checks, AI attestations and unrecognised consent', () => {
    // Criminal history left the set with the owner's amendments: it is answered from the person's own answer in the
    // sensitive part, by its polarity alone (policy.ts), never by an AI.
    expect([...USER_ONLY_CATEGORIES].sort()).toEqual(['attentionCheck', 'consent.aiAttestation', 'consent.other']);
  });

  it('holds no consent category a person may pre-approve', () => {
    for (const category of CONSENT_CATEGORIES) {
      expect(USER_ONLY_CATEGORIES.has(`consent.${category}` as FieldCategory), category).toBe(false);
    }
  });
});

// jr6 fix (revD-04): the `all` scope's categories are pinned, so any widening is a deliberate change of this list.
describe('AI_OPENED_CATEGORIES and GUESS_ONLY_CATEGORIES', () => {
  it('opens exactly the owner’s legal, pay and attention-check questions and jr6’s screening questions', () => {
    expect([...AI_OPENED_CATEGORIES].sort()).toEqual(['attentionCheck', 'salary.currency', 'salary.expected',
      'screening.criminalHistory', 'screening.governmentService', 'screening.militaryTraining', 'screening.over18',
      'screening.relatives', 'screening.restrictiveAgreement', 'workAuth.authorized', 'workAuth.clearance',
      'workAuth.opt', 'workAuth.sponsorship', 'workAuth.sponsorshipFuture', 'workAuth.sponsorshipNow',
      'workAuth.status', 'workAuth.visaType']);
    // jr6 fix (revD-01): never a self-identification's topic (a disability, the accommodation it needs).
    expect(AI_OPENED_CATEGORIES.has('screening.essentialFunctions')).toBe(false);
    for (const category of AI_OPENED_CATEGORIES) expect(policyClassOf(category), category).not.toBe('eeo');
  });

  it('always marks as a guess the opened legal questions no résumé can settle', () => {
    expect([...GUESS_ONLY_CATEGORIES].sort()).toEqual(['screening.militaryTraining', 'screening.relatives',
      'screening.restrictiveAgreement']);
    for (const category of GUESS_ONLY_CATEGORIES) {
      expect(AI_OPENED_CATEGORIES.has(category), category).toBe(true);
      expect(policyClassOf(category), category).toBe('legal');
    }
  });
});
