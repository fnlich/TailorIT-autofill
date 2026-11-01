/*
 * What each field category means for policy (docs/design/core.md §8.2). Its class decides what may supply a value and
 * which uncertain steps may play any part in it, and CATEGORY_KINDS lists the field kinds it can appear on. The
 * resolver checks every rule's output and every LLM classification against CATEGORY_KINDS, so a category on a kind
 * that cannot hold it ("email" on a checkbox, "job title" on a select of honorifics) is no match at all.
 */
import { FIELD_KINDS, type FieldKind } from '../enums';
import type { FieldCategory, PolicyClass } from '../types/intent';

/** The policy class of every category (§8.2's table). Sexual orientation and transgender identity are eeo. */
export const CATEGORY_CLASS: Readonly<Record<FieldCategory, PolicyClass>> = {
  'identity.fullName': 'profile', 'identity.firstName': 'profile', 'identity.middleName': 'profile',
  'identity.lastName': 'profile', 'identity.preferredName': 'profile', 'identity.pronouns': 'sensitive',
  'contact.email': 'profile', 'contact.phone': 'profile', 'contact.phoneCountry': 'profile',
  'contact.phoneType': 'profile',
  'address.line1': 'profile', 'address.line2': 'profile', 'address.city': 'profile', 'address.region': 'profile',
  'address.postalCode': 'profile', 'address.country': 'profile', 'location.current': 'profile',
  'links.linkedin': 'profile', 'links.github': 'profile', 'links.portfolio': 'profile', 'links.website': 'profile',
  'links.twitter': 'profile', 'links.other': 'profile',
  'workAuth.authorized': 'legal', 'workAuth.sponsorship': 'legal', 'workAuth.sponsorshipNow': 'legal',
  'workAuth.sponsorshipFuture': 'legal', 'workAuth.status': 'legal', 'workAuth.visaType': 'legal',
  'workAuth.clearance': 'legal', 'screening.over18': 'legal', 'screening.criminalHistory': 'legal',
  'eeo.gender': 'eeo', 'eeo.hispanicLatino': 'eeo', 'eeo.race': 'eeo', 'eeo.veteran': 'eeo', 'eeo.disability': 'eeo',
  'eeo.sexualOrientation': 'eeo', 'eeo.transgender': 'eeo',
  'education.school': 'profile', 'education.degree': 'profile', 'education.highestLevel': 'profile',
  'education.field': 'profile', 'education.minor': 'profile', 'education.startDate': 'profile',
  'education.endDate': 'profile', 'education.gpa': 'profile',
  'experience.company': 'profile', 'experience.title': 'profile', 'experience.location': 'profile',
  'experience.startDate': 'profile', 'experience.endDate': 'profile', 'experience.current': 'profile',
  'experience.description': 'profile', 'experience.currentCompany': 'profile', 'experience.currentTitle': 'profile',
  'experience.totalYears': 'profile',
  'languages.language': 'profile', 'languages.proficiency': 'profile', 'skills.list': 'profile',
  'salary.expected': 'sensitive', 'salary.currency': 'sensitive',
  'availability.startDate': 'profile', 'availability.noticePeriod': 'profile',
  'preferences.relocation': 'profile', 'preferences.workArrangement': 'profile', 'preferences.travel': 'profile',
  'referral.source': 'profile', 'referral.referrerName': 'profile',
  'consent.privacy': 'consent', 'consent.terms': 'consent', 'consent.certify': 'consent',
  'consent.dataRetention': 'consent', 'consent.marketing': 'consent', 'consent.sms': 'consent',
  'consent.backgroundCheck': 'consent', 'consent.signature': 'consent', 'consent.aiAttestation': 'consent',
  'consent.other': 'consent',
  attentionCheck: 'attention',
  'freeText.whyCompany': 'free-text', 'freeText.whyRole': 'free-text', 'freeText.coverLetter': 'free-text',
  'freeText.additionalInfo': 'free-text', 'freeText.other': 'free-text',
  'file.resume': 'file', 'file.coverLetter': 'file', 'file.other': 'file',
  'screening.previouslyEmployed': 'unknown', 'screening.other': 'unknown',
  unknown: 'unknown',
};

/** The policy class of a category. */
export function policyClassOf(category: FieldCategory): PolicyClass {
  return CATEGORY_CLASS[category];
}

// Kind groups for CATEGORY_KINDS. A typeahead-remote field searches a server as the person types (a school, a city).

/** One line of text. */
const LINE: readonly FieldKind[] = ['text'];
/** A line or a box of text. */
const PROSE: readonly FieldKind[] = ['text', 'textarea'];
/** One answer from a short list. */
const CHOICE: readonly FieldKind[] = ['select', 'radio', 'combobox'];
/** Yes or no: one answer from a short list, or a lone box ticked for yes. */
const YES_NO: readonly FieldKind[] = ['select', 'radio', 'combobox', 'checkbox'];
/** A place or a name from a long list: typed, chosen or searched for. */
const LOOKUP: readonly FieldKind[] = ['text', 'select', 'combobox', 'typeahead-remote'];
/** A name typed or searched for, never chosen from a fixed list (an employer, a job title). A combobox is a fixed list:
 *  Greenhouse draws every single-choice question as one, Yes/No included, so a title there is never this. */
const TYPED_NAME: readonly FieldKind[] = ['text', 'typeahead-remote'];
/** A date: a date control, typed text, or month and year lists. */
const DATE: readonly FieldKind[] = ['text', 'date', 'select', 'combobox'];
/** A self-identification answer: chosen from the form's options, never typed. A lone box covers "I am a veteran". */
const EEO: readonly FieldKind[] = ['select', 'radio', 'combobox', 'checkbox', 'checkbox-group', 'multiselect'];
/** A consent: a box to tick, or a Yes/I agree radio (the comment above the design's consent rules). */
const CONSENT: readonly FieldKind[] = ['checkbox', 'radio'];
/** Anything that holds an answer. */
const ANY: readonly FieldKind[] = FIELD_KINDS;
/** Any answer except an upload. */
const ANY_ANSWER: readonly FieldKind[] = FIELD_KINDS.filter((kind) => kind !== 'file');

/**
 * The field kinds each category allows (§8.2). The design fixes four: `file.*` only `file`, `contact.email` only
 * `text`, `experience.current` only `checkbox`, `consent.signature` only `text`. The rest follow the same idea: a kind
 * is listed when that category's answer can really be given through it. A legal or yes/no question in a text box is
 * left out on purpose: no value could be matched into it, so the label rules hand it to the person (needs-user,
 * `kind-mismatch`) rather than let a later rule claim it.
 */
export const CATEGORY_KINDS: Readonly<Record<FieldCategory, readonly FieldKind[]>> = {
  'identity.fullName': LINE, 'identity.firstName': LINE, 'identity.middleName': LINE, 'identity.lastName': LINE,
  'identity.preferredName': LINE,
  'identity.pronouns': ['text', 'select', 'radio', 'combobox', 'checkbox-group', 'multiselect'],
  'contact.email': LINE, 'contact.phone': LINE, 'contact.phoneCountry': ['text', 'select', 'combobox'],
  'contact.phoneType': CHOICE,
  'address.line1': ['text', 'textarea', 'typeahead-remote'], 'address.line2': LINE, 'address.city': LOOKUP,
  'address.region': LOOKUP, 'address.postalCode': LINE, 'address.country': LOOKUP, 'location.current': LOOKUP,
  'links.linkedin': LINE, 'links.github': LINE, 'links.portfolio': LINE, 'links.website': LINE, 'links.twitter': LINE,
  'links.other': PROSE,
  'workAuth.authorized': YES_NO, 'workAuth.sponsorship': YES_NO, 'workAuth.sponsorshipNow': YES_NO,
  'workAuth.sponsorshipFuture': YES_NO, 'workAuth.status': CHOICE, 'workAuth.visaType': ['text', ...CHOICE],
  'workAuth.clearance': ['text', ...YES_NO], 'screening.over18': YES_NO,
  // Never filled: recognised on any answer widget, so it is never taken for something else.
  'screening.criminalHistory': ['text', 'textarea', ...YES_NO],
  'eeo.gender': EEO, 'eeo.hispanicLatino': EEO, 'eeo.race': EEO, 'eeo.veteran': EEO, 'eeo.disability': EEO,
  'eeo.sexualOrientation': EEO, 'eeo.transgender': EEO,
  'education.school': LOOKUP, 'education.degree': ['text', 'select', 'radio', 'combobox', 'typeahead-remote'],
  'education.highestLevel': ['text', ...CHOICE], 'education.field': LOOKUP, 'education.minor': LOOKUP,
  'education.startDate': DATE, 'education.endDate': DATE, 'education.gpa': ['text', 'select', 'combobox'],
  'experience.company': TYPED_NAME, 'experience.title': TYPED_NAME, 'experience.location': LOOKUP,
  'experience.startDate': DATE, 'experience.endDate': DATE, 'experience.current': ['checkbox'],
  'experience.description': PROSE, 'experience.currentCompany': TYPED_NAME, 'experience.currentTitle': TYPED_NAME,
  'experience.totalYears': ['text', ...CHOICE],
  'languages.language': [...LOOKUP, 'checkbox-group', 'multiselect'], 'languages.proficiency': CHOICE,
  'skills.list': ['text', 'textarea', 'combobox', 'typeahead-remote', 'checkbox-group', 'multiselect'],
  'salary.expected': ['text', 'textarea', ...CHOICE], 'salary.currency': ['text', 'select', 'combobox'],
  'availability.startDate': ['text', 'textarea', 'date', ...CHOICE], 'availability.noticePeriod': ['text', ...CHOICE],
  'preferences.relocation': YES_NO, 'preferences.workArrangement': [...YES_NO, 'checkbox-group', 'multiselect'],
  // A text box takes the profile's travel share (docs/SPEC-AMENDMENTS.md §8; the Phase E review, MINOR 6).
  'preferences.travel': [...YES_NO, 'text'],
  'referral.source': ['text', ...CHOICE, 'checkbox-group', 'multiselect'], 'referral.referrerName': LINE,
  'consent.privacy': CONSENT, 'consent.terms': CONSENT, 'consent.certify': CONSENT, 'consent.dataRetention': CONSENT,
  'consent.marketing': CONSENT, 'consent.sms': CONSENT, 'consent.backgroundCheck': CONSENT,
  'consent.signature': LINE, 'consent.aiAttestation': CONSENT, 'consent.other': CONSENT,
  attentionCheck: ANY,
  'freeText.whyCompany': PROSE, 'freeText.whyRole': PROSE, 'freeText.coverLetter': PROSE,
  'freeText.additionalInfo': PROSE, 'freeText.other': PROSE,
  'file.resume': ['file'], 'file.coverLetter': ['file'], 'file.other': ['file'],
  'screening.previouslyEmployed': ANY_ANSWER, 'screening.other': ANY_ANSWER,
  unknown: ANY,
};

/** Whether a field of this kind can hold this category's answer. */
export function kindAllowed(category: FieldCategory, kind: FieldKind): boolean {
  return CATEGORY_KINDS[category].includes(kind);
}

/** What may supply a field's value (§8.2's "Value comes from"). */
export const VALUE_SOURCES = [
  /** The profile, derived values included (a name split, years computed from entries, a composed location). */
  'profile',
  /** Only a value the person gave explicitly in the profile: nothing derived or inferred. */
  'explicit-profile',
  /** The form's decline option, when the profile holds an explicit decline. */
  'explicit-decline',
  /** A deterministic rule ("I currently work here" from the current entry, a start date from a notice period). */
  'rule',
  /** A consent category the person pre-approved in settings. */
  'preapproved-consent',
  /** An answer the person saved earlier (Requirement F). */
  'saved',
  /** A draft from the resume (version 2: written and accepted; kept for the person's confirmation while
   *  settings.llm.confirmDrafts is on). */
  'llm-draft',
  /** An AI answer (version 2): one of the field's own options, or a short text, marked "AI guess" when nothing settles
   *  it (plan/answers.ts). */
  'llm-answer',
] as const;
export type ValueSource = (typeof VALUE_SOURCES)[number];

/** Where a class's value may come from, and which uncertain steps may play any part in it (one row of §8.2). */
export interface ClassPolicy {
  valueFrom: readonly ValueSource[];
  /** Whether a saved answer may supply the value: in any scope, only the company's (same platform and board), never. */
  savedAnswers: 'global' | 'company' | 'never';
  /** Whether the LLM tiebreak may choose an option: as the matcher's domain allows, for any option list (the
   *  `generic` pick category), or never. */
  llmTiebreak: 'per-domain' | 'allowed' | 'never' | 'not-applicable';
  /** What a category that came only from LLM classification may do: fill, always flagged; write a draft; nothing. */
  llmClassified: 'fill-flagged' | 'draft-only' | 'never' | 'not-applicable';
  /** Whether fuzzy matching may run: as the matcher's domain allows, the generic matching, or never. */
  fuzzy: 'per-domain' | 'generic' | 'never' | 'not-applicable';
}

/**
 * §8.2's table, one row per class. The owner's amendments (docs/SPEC-AMENDMENTS.md) put back its "draft only" cell for
 * a free-text category only the LLM classified (docs/ARCHITECTURE.md had made it needs-user), and add the AI answer as
 * a source of the unknown and free-text classes (a short text, or one of the field's options), and of the profile
 * categories ANSWERABLE_PROFILE_CATEGORIES lists. The rule source of the unknown class is
 * screening.previously-employed.
 */
export const CLASS_POLICIES: Readonly<Record<PolicyClass, ClassPolicy>> = {
  profile: { valueFrom: ['profile', 'rule'], savedAnswers: 'global', llmTiebreak: 'per-domain',
    llmClassified: 'fill-flagged', fuzzy: 'per-domain' },
  sensitive: { valueFrom: ['explicit-profile'], savedAnswers: 'never', llmTiebreak: 'never', llmClassified: 'never',
    fuzzy: 'never' },
  legal: { valueFrom: ['explicit-profile', 'explicit-decline'], savedAnswers: 'never', llmTiebreak: 'never',
    llmClassified: 'never', fuzzy: 'never' },
  eeo: { valueFrom: ['explicit-profile', 'explicit-decline'], savedAnswers: 'never', llmTiebreak: 'never',
    llmClassified: 'never', fuzzy: 'never' },
  consent: { valueFrom: ['preapproved-consent'], savedAnswers: 'never', llmTiebreak: 'never', llmClassified: 'never',
    fuzzy: 'never' },
  attention: { valueFrom: [], savedAnswers: 'never', llmTiebreak: 'never', llmClassified: 'never', fuzzy: 'never' },
  'free-text': { valueFrom: ['saved', 'llm-draft', 'llm-answer'], savedAnswers: 'company', llmTiebreak: 'not-applicable',
    llmClassified: 'draft-only', fuzzy: 'not-applicable' },
  file: { valueFrom: ['profile'], savedAnswers: 'never', llmTiebreak: 'never', llmClassified: 'never',
    fuzzy: 'not-applicable' },
  unknown: { valueFrom: ['saved', 'rule', 'llm-answer'], savedAnswers: 'global', llmTiebreak: 'allowed',
    llmClassified: 'not-applicable', fuzzy: 'generic' },
};

/**
 * The only classes in which saved answers, the LLM tiebreak, LLM classification or fuzzy matching may play any part
 * (docs/ARCHITECTURE.md). In every other class the value comes only from the profile, a rule or settings.
 */
export const OPEN_CLASSES: readonly PolicyClass[] = ['profile', 'free-text', 'unknown'];

/**
 * Categories no profile value, saved answer, LLM classification or pre-approval may fill: an attention check, an AI
 * attestation and unrecognised consent can never be pre-approved (§8.7). Criminal history was here until the owner's
 * amendments (docs/SPEC-AMENDMENTS.md §6). Since the owner's decisions of 2026-11-01 (§11) each has one way in of its
 * own: an attention check TailorIT's AI answers while settings.llm.answerAll is on (AI_OPENED_CATEGORIES), a required
 * unrecognised consent is ticked by the rule consent.required, and an AI attestation by consent.no-ai-attestation, only
 * when the run used no AI at all (policy.ts consentValue; the Guard allows those and nothing else).
 */
export const USER_ONLY_CATEGORIES: ReadonlySet<FieldCategory> = new Set<FieldCategory>(['attentionCheck',
  'consent.aiAttestation', 'consent.other']);

/**
 * The closed categories TailorIT's AI may answer when the profile holds no value for them, while the person lets it
 * (settings.llm.answerAll, on by default: the owner's decision of 2026-11-01, docs/SPEC-AMENDMENTS.md §11): work
 * authorization, sponsorship (now, in the future, or both), a work status, a visa type, a clearance, being 18 or over,
 * criminal history, the expected pay and its currency, and attention checks. Never a self-identification (EEO)
 * question, pronouns, a consent, a contact detail or an identity number. The answer is TailorIT's `all` scope (an
 * "AI guess" unless a fact settles it); the person's own sensitive answers never reach the AI.
 */
export const AI_OPENED_CATEGORIES: ReadonlySet<FieldCategory> = new Set<FieldCategory>(['workAuth.authorized',
  'workAuth.sponsorship', 'workAuth.sponsorshipNow', 'workAuth.sponsorshipFuture', 'workAuth.status',
  'workAuth.visaType', 'workAuth.clearance', 'screening.over18', 'screening.criminalHistory', 'salary.expected',
  'salary.currency', 'attentionCheck']);

/**
 * The profile categories an AI answer may fill when the profile holds no value for them (the owner's amendments): job
 * preferences, availability, how the person heard of the job, years of experience and a skill chosen from a list. Never
 * a name, contact detail, address, link, school, employer, date or file: those come from the profile or stay blank.
 */
export const ANSWERABLE_PROFILE_CATEGORIES: ReadonlySet<FieldCategory> = new Set<FieldCategory>([
  'preferences.relocation', 'preferences.workArrangement', 'preferences.travel', 'availability.noticePeriod',
  'availability.startDate', 'referral.source', 'experience.totalYears', 'skills.list']);
