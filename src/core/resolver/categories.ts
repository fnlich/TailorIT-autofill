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
  'education.endDate': 'profile', 'education.gpa': 'profile', 'education.current': 'profile',
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
  // s2 core-gh: the new categories (types/intent.ts). The citizenships and the screening answers are the person's own
  // from the sensitive part, matched by polarity or by country, never sent to an AI: legal.
  'links.telegram': 'profile', 'address.full': 'profile', 'workAuth.citizenship': 'legal',
  'screening.restrictiveAgreement': 'legal', 'screening.governmentService': 'legal', 'screening.relatives': 'legal',
  'screening.essentialFunctions': 'legal', 'skills.certifications': 'profile', 'preferences.relocationPlaces': 'profile',
  'education.summary': 'profile',
  // s2 core-gh end
  // s2 core-wd
  'identity.suffix': 'profile', 'contact.phoneExtension': 'profile', 'identity.hasPreferredName': 'profile',
  // jr6 RULES (types/intent.ts): a signature's date is decided as its signature is (consent); the rest are the
  // profile's, or a rule over the form's own options.
  'consent.signatureDate': 'consent', 'languages.formLanguage': 'profile', 'identity.employeeId': 'profile',
  'experience.city': 'profile', 'experience.region': 'profile', 'experience.country': 'profile',
  'education.city': 'profile', 'education.region': 'profile', 'education.country': 'profile',
  'address.lookup': 'profile', 'address.county': 'profile', 'location.policyResidence': 'profile',
  'referral.employeeReferred': 'profile', 'location.residesIn': 'profile',
  // jr6 RULES R2: OPT or CPT, a legal answer from the work-authorization entry (WD-30).
  'workAuth.opt': 'legal',
  // jr6 RULES R3: military training from the sensitive part's service and veteran answers (legal); the rest the
  // profile's, or a rule over its own values.
  'screening.militaryTraining': 'legal', 'address.type': 'profile', 'referral.detail': 'profile',
  'preferences.timeZone': 'profile', 'location.inTimeZone': 'profile', 'experience.yearsIn': 'profile',
  'skills.experienceWith': 'profile',
  // jr6 RULES R3 (items 49 to 61): the profile's address, and a name the profile never holds.
  'location.inCountry': 'profile', 'identity.formerName': 'profile',
  // jr6 RULES R4 (items 62 to 79): the pay's period is the expected pay's (sensitive); the rest the profile's.
  'identity.prefix': 'profile', 'education.graduated': 'profile', 'address.line3': 'profile', 'salary.period': 'sensitive',
  'application.resumeMethod': 'profile', 'education.highSchool': 'profile', 'address.mailing': 'profile',
  'links.facebook': 'profile', 'links.numbered': 'profile',
  // jr7 RULES-7 (UKGR-14): a national id or a social security number, which the profile never holds and nothing else
  // may give (sensitive: no saved answer, no AI, no tiebreak).
  'identity.nationalId': 'sensitive',
  // jr7 RULES-7 R2 (DF7-11, ICIMS7-14): an entry's detail and a licence's number or state, the profile's (none held).
  'experience.detail': 'profile', 'skills.certificationDetail': 'profile',
  // jr7 RULES-7 R2 (WD7V-02): the person's native language.
  'languages.preferred': 'profile',
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
/** s2 core-gh (decision 11): a yes/no legal question, also asked in a text box ("Yes" or "No" typed). */
const YES_NO_TEXT: readonly FieldKind[] = [...YES_NO, 'text'];
/** A self-identification answer: chosen from the form's options, never typed. A lone box covers "I am a veteran". */
const EEO: readonly FieldKind[] = ['select', 'radio', 'combobox', 'checkbox', 'checkbox-group', 'multiselect'];
/** A consent: a box to tick, or a Yes/I agree radio (the comment above the design's consent rules). A list or a
 *  combobox whose one option agrees ("Acknowledge/Confirm") is read as consent by its options, beside the label rules
 *  (classifyRules consentChoice), never through these kinds. */
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
 * `kind-mismatch`) rather than let a later rule claim it. s2 core-gh (decision 11): authorization and sponsorship take
 * a text box, only when asked as yes or no (labelRules TYPED_YES_NO), where "Yes" or "No" is typed.
 */
export const CATEGORY_KINDS: Readonly<Record<FieldCategory, readonly FieldKind[]>> = {
  'identity.fullName': LINE, 'identity.firstName': LINE, 'identity.middleName': LINE, 'identity.lastName': LINE,
  'identity.preferredName': LINE,
  'identity.pronouns': ['text', 'select', 'radio', 'combobox', 'checkbox-group', 'multiselect'],
  // s2 core-wd: Workday's Country Phone Code is a prompt (a remote search: the wd study §5).
  'contact.email': LINE, 'contact.phone': LINE,
  'contact.phoneCountry': ['text', 'select', 'combobox', 'typeahead-remote'],
  'contact.phoneType': CHOICE,
  'address.line1': ['text', 'textarea', 'typeahead-remote'], 'address.line2': LINE, 'address.city': LOOKUP,
  // jr6 RULES R3 (O2: Oracle's ZIP Code, a cx-select search, fixtures/oracle/hjf-apply-section): a postal code is also
  // searched for, or chosen from a list.
  'address.region': LOOKUP, 'address.postalCode': ['text', 'combobox', 'typeahead-remote'], 'address.country': LOOKUP,
  // jr6 RULES R3 (U-11: UltiPro's "Where are you currently located?" drawn as a box of prose, fixtures/ultipro/
  // application): a box of prose too, where the label is only that question (labelRules LOCATION_WHOLE).
  'location.current': [...LOOKUP, 'textarea'],
  // s2 core-gh (decision 9; the gh study's 2a: s2-onestream-related-open question_8152421009, "LinkedIn Profile" drawn as
  // a textarea, was read as free text and asked for an AI essay): a link goes into a line or a box of text.
  'links.linkedin': PROSE, 'links.github': PROSE, 'links.portfolio': PROSE, 'links.website': PROSE,
  'links.twitter': PROSE, 'links.other': PROSE,
  // s2 core-gh (decision 11; s2-robotspencils-clear-id-open question_18670483008, s2-ahead-0's "Will you now or in the
  // future require AHEAD to sponsor you…?"): a Yes/No legal question asked in a text box takes "Yes" or "No" from the
  // profile's explicit answer (policy.ts legal.yes-no-text).
  'workAuth.authorized': YES_NO_TEXT, 'workAuth.sponsorship': YES_NO_TEXT, 'workAuth.sponsorshipNow': YES_NO_TEXT,
  'workAuth.sponsorshipFuture': YES_NO_TEXT,
  // jr6 RULES (JZ-8): a status asked as yes or no on a lone box too ("I am a U.S. citizen").
  'workAuth.status': YES_NO, 'workAuth.visaType': ['text', ...CHOICE],
  // jr6 RULES (ADP-9): which clearances are held, on a list that takes several too.
  'workAuth.clearance': ['text', ...YES_NO, 'checkbox-group', 'multiselect'], 'screening.over18': YES_NO,
  // Never filled: recognised on any answer widget, so it is never taken for something else.
  'screening.criminalHistory': ['text', 'textarea', ...YES_NO],
  'eeo.gender': EEO, 'eeo.hispanicLatino': EEO, 'eeo.race': EEO, 'eeo.veteran': EEO, 'eeo.disability': EEO,
  'eeo.sexualOrientation': EEO, 'eeo.transgender': EEO,
  'education.school': LOOKUP, 'education.degree': ['text', 'select', 'radio', 'combobox', 'typeahead-remote'],
  'education.highestLevel': ['text', ...CHOICE], 'education.field': LOOKUP, 'education.minor': LOOKUP,
  'education.startDate': DATE, 'education.endDate': DATE, 'education.gpa': ['text', 'select', 'combobox'],
  'education.current': ['checkbox'],
  'experience.company': TYPED_NAME, 'experience.title': TYPED_NAME, 'experience.location': LOOKUP,
  'experience.startDate': DATE, 'experience.endDate': DATE, 'experience.current': ['checkbox'],
  'experience.description': PROSE, 'experience.currentCompany': TYPED_NAME, 'experience.currentTitle': TYPED_NAME,
  'experience.totalYears': ['text', ...CHOICE],
  'languages.language': [...LOOKUP, 'checkbox-group', 'multiselect'], 'languages.proficiency': CHOICE,
  'skills.list': ['text', 'textarea', 'combobox', 'typeahead-remote', 'checkbox-group', 'multiselect'],
  'salary.expected': ['text', 'textarea', ...CHOICE], 'salary.currency': ['text', 'select', 'combobox'],
  // jr7 RULES-7 (WD7-02: Workday draws its questionnaire's text questions as textareas, aristocrat's required "What is
  // your notice period in weeks, if applicable?", snapshot7 workday1): a notice period in a box of prose too.
  'availability.startDate': ['text', 'textarea', 'date', ...CHOICE],
  'availability.noticePeriod': ['text', 'textarea', ...CHOICE],
  'preferences.relocation': YES_NO, 'preferences.workArrangement': [...YES_NO, 'checkbox-group', 'multiselect'],
  // A text box takes the profile's travel share (docs/SPEC-AMENDMENTS.md §8; the Phase E review, MINOR 6).
  'preferences.travel': [...YES_NO, 'text'],
  // s2 core-wd: Workday's "How Did You Hear About Us?" is a prompt on some tenants (verily, exelixis: the wd study §5).
  // jr7 RULES-7 (RBP7-19: Pinpoint's required "How did you hear about this job?" is a textarea, snapshot7 pinpointhq1):
  // the profile's source written in a box of prose too.
  'referral.source': ['text', 'textarea', ...CHOICE, 'typeahead-remote', 'checkbox-group', 'multiselect'],
  'referral.referrerName': LINE,
  'consent.privacy': CONSENT, 'consent.terms': CONSENT, 'consent.certify': CONSENT, 'consent.dataRetention': CONSENT,
  'consent.marketing': CONSENT, 'consent.sms': CONSENT, 'consent.backgroundCheck': CONSENT,
  // jr6 RULES R3 (ICIMS-15, iCIMS's IForm Signature box `icims_f_signature`): a signature is also a box to tick.
  'consent.signature': ['text', 'checkbox'], 'consent.aiAttestation': CONSENT, 'consent.other': CONSENT,
  attentionCheck: ANY,
  'freeText.whyCompany': PROSE, 'freeText.whyRole': PROSE, 'freeText.coverLetter': PROSE,
  'freeText.additionalInfo': PROSE, 'freeText.other': PROSE,
  'file.resume': ['file'], 'file.coverLetter': ['file'], 'file.other': ['file'],
  'screening.previouslyEmployed': ANY_ANSWER, 'screening.other': ANY_ANSWER,
  // s2 core-gh: the new categories.
  'links.telegram': PROSE, 'address.full': PROSE,
  'workAuth.citizenship': ['text', 'select', 'combobox', 'typeahead-remote', 'checkbox-group', 'multiselect'],
  'screening.restrictiveAgreement': YES_NO, 'screening.governmentService': YES_NO, 'screening.relatives': YES_NO,
  'screening.essentialFunctions': YES_NO, 'skills.certifications': [...PROSE, ...YES_NO],
  'preferences.relocationPlaces': [...PROSE, 'checkbox-group', 'multiselect'], 'education.summary': PROSE,
  // s2 core-gh end
  // s2 core-wd: a suffix typed or chosen from a list (Workday's Suffix); an extension typed; "I have a preferred name"
  // ticked, or answered yes or no.
  'identity.suffix': ['text', ...CHOICE], 'contact.phoneExtension': LINE, 'identity.hasPreferredName': YES_NO,
  // jr6 RULES: a signature's date in a date control or typed (JV-1's Jobvite date, Workday's "Date signed"); a form's
  // language chosen; an employee number typed; a job's or a school's place as its address parts are; an address
  // search's "Enter manually", on iCIMS's dropdown (never a remote search: the label contract of FIXPLAN §3.2); a
  // county typed or chosen; a privacy policy's residence, a place a question asks only of its residents, chosen; a
  // referral by an employee, yes or no. jr6 fix (RULES-R11): a signature's date drawn in parts takes its month and day
  // from lists (iCIMS's IForm dates; labelRules reads a list only as one part of the date).
  'consent.signatureDate': ['text', 'date', 'select', 'combobox'], 'languages.formLanguage': CHOICE,
  'identity.employeeId': LINE,
  'experience.city': LOOKUP, 'experience.region': LOOKUP, 'experience.country': LOOKUP, 'education.city': LOOKUP,
  'education.region': LOOKUP, 'education.country': LOOKUP, 'address.lookup': ['select', 'combobox'],
  'address.county': ['text', 'select', 'combobox'], 'location.policyResidence': CHOICE,
  'referral.employeeReferred': YES_NO, 'location.residesIn': CHOICE,
  // jr6 RULES R2: OPT or CPT, yes or no (WD-30).
  'workAuth.opt': YES_NO_TEXT,
  // jr6 RULES R3: yes or no questions; an address's type, a source's detail chosen from a list; a time zone typed or
  // chosen, jr6 fix (RULES-R48-TZ, IC-R2: ARS's iCIMS "Time Zone", a dropdown with icimsdropdown-search, fixtures
  // jr6-ars-profile) or searched for.
  'screening.militaryTraining': YES_NO, 'address.type': CHOICE, 'referral.detail': CHOICE,
  // jr7 RULES-7 (ADP7-4: ADP's "What time zone do you live in?" is a multi react-select, snapshot7 adp1): one zone as a
  // set of one on a list that takes several too.
  'preferences.timeZone': ['text', ...CHOICE, 'typeahead-remote', 'multiselect'], 'location.inTimeZone': YES_NO,
  'experience.yearsIn': YES_NO,
  'skills.experienceWith': YES_NO,
  // jr6 RULES R3: living or working in a country, yes or no; a former name typed.
  'location.inCountry': YES_NO, 'identity.formerName': LINE,
  // jr6 RULES R4: a prefix typed or chosen; yes or no; a line typed; a period, a method chosen; a box of an address or a
  // link.
  'identity.prefix': ['text', ...CHOICE], 'education.graduated': YES_NO, 'address.line3': LINE, 'salary.period': CHOICE,
  'application.resumeMethod': CHOICE, 'education.highSchool': YES_NO, 'address.mailing': PROSE,
  'links.facebook': PROSE, 'links.numbered': PROSE,
  // jr7 RULES-7 (UKGR-14): a national id or social security number typed, or its type chosen; never filled.
  'identity.nationalId': ['text', ...CHOICE],
  // jr7 RULES-7 R2: an entry's detail typed or chosen; a licence's number typed, its state typed, chosen or searched.
  'experience.detail': ['text', 'textarea', ...CHOICE], 'skills.certificationDetail': [...LOOKUP],
  'languages.preferred': ['text', ...CHOICE],
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
 * own: an attention check TailorIT's AI answers while settings.modes.ai is 'all' (AI_OPENED_CATEGORIES), a required
 * unrecognised consent is ticked by the rule consent.required, and an AI attestation by consent.no-ai-attestation, only
 * when the run used no AI at all (policy.ts consentValue; the Guard allows those and nothing else).
 */
export const USER_ONLY_CATEGORIES: ReadonlySet<FieldCategory> = new Set<FieldCategory>(['attentionCheck',
  'consent.aiAttestation', 'consent.other']);

/**
 * The closed categories TailorIT's AI may answer when the profile holds no value for them, while the person lets it
 * (settings.modes.ai 'all', the default: the owner's decision of 2026-11-01, docs/SPEC-AMENDMENTS.md §11): work
 * authorization, sponsorship (now, in the future, or both), a work status, a visa type, a clearance, being 18 or over,
 * criminal history, the expected pay and its currency, and attention checks. Never a self-identification (EEO)
 * question, pronouns, a consent, a contact detail or an identity number. The answer is TailorIT's `all` scope (an
 * "AI guess" unless a fact settles it); the person's own sensitive answers never reach the AI.
 */
export const AI_OPENED_CATEGORIES: ReadonlySet<FieldCategory> = new Set<FieldCategory>(['workAuth.authorized',
  'workAuth.sponsorship', 'workAuth.sponsorshipNow', 'workAuth.sponsorshipFuture', 'workAuth.status',
  'workAuth.visaType', 'workAuth.clearance', 'screening.over18', 'screening.criminalHistory', 'salary.expected',
  'salary.currency', 'attentionCheck',
  // s2 core-gh: U.S. government or military service, which the AI answered before it had a category of its own ("Have
  // you ever worked for the US government?"), where the profile holds no answer.
  'screening.governmentService',
  // jr6 RULES (jobvite-new-1, the owner's "absolutely all"): the other yes/no screening questions of snapshot round 2
  // (Sikich's "Are you currently subject to a non-compete, non-solicitation or any other restrictive employment
  // agreement?"), where the profile holds no answer; marked "AI guess" unless a fact settles it. jr6 fix (revD-01):
  // never the essential functions, which ask about a disability or the accommodation it needs (a self-identification's
  // topic: the profile's explicit answer only, else the person's).
  'screening.restrictiveAgreement', 'screening.relatives',
  // jr6 RULES R2 (WD-30): OPT or CPT, where the entry does not settle it.
  'workAuth.opt',
  // jr6 RULES R3 (WD-29): military training, where the service and veteran answers do not settle it.
  'screening.militaryTraining']);

/**
 * jr6 fix (revD-04): the AI-opened categories no résumé or posting can settle (a contract the person may be bound by,
 * relatives at the company, military training for this role): TailorIT's answer to one is always written as an "AI
 * guess" (plan/frame.ts planAnswer), whatever basis it gives, so a legal guess is never shown as a fact and the
 * auto-apply agent's legal-guess rule (settings.agentSkip.legalGuess) sees it.
 */
export const GUESS_ONLY_CATEGORIES: ReadonlySet<FieldCategory> = new Set<FieldCategory>([
  'screening.restrictiveAgreement', 'screening.relatives', 'screening.militaryTraining']);

/**
 * The profile categories an AI answer may fill when the profile holds no value for them (the owner's amendments): job
 * preferences, availability, how the person heard of the job, years of experience and a skill chosen from a list. Never
 * a name, contact detail, address, link, school, employer, date or file: those come from the profile or stay blank.
 */
export const ANSWERABLE_PROFILE_CATEGORIES: ReadonlySet<FieldCategory> = new Set<FieldCategory>([
  'preferences.relocation', 'preferences.workArrangement', 'preferences.travel', 'availability.noticePeriod',
  'availability.startDate', 'referral.source', 'experience.totalYears', 'skills.list',
  // s2 core-gh review (C4): certifications the profile does not settle, as the AI answered them before this round.
  'skills.certifications',
  // jr6 RULES R3 (JV-16): years in something, experience with something, and a time zone the rules do not settle.
  'experience.yearsIn', 'skills.experienceWith', 'location.inTimeZone',
  // jr6 RULES R3 (JZ-11): living or working in a country the address does not settle (a place no country names).
  'location.inCountry',
  // jr6 RULES R4 (ICIMS-25, ADP-20): a graduation, a high-school diploma the education entries do not settle.
  'education.graduated', 'education.highSchool']);
