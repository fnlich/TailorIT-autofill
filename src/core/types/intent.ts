/*
 * What a field asks for, what we mean to put in it, and where that value came from. A value without an origin cannot
 * be typed: PlannedWrite requires one, and the Guard re-checks it at run time because messages cross contexts.
 */
import type { DegreeLevel, DegreeType } from '../enums';

/** What a field asks for. The resolver's rules, the LLM classification (through SERVER_CATEGORY_MAP) and saved answers
 *  all land on one of these. */
export const FIELD_CATEGORIES = [
  'identity.fullName', 'identity.firstName', 'identity.middleName', 'identity.lastName', 'identity.preferredName',
  'identity.pronouns',
  'contact.email', 'contact.phone', 'contact.phoneCountry', 'contact.phoneType',
  'address.line1', 'address.line2', 'address.city', 'address.region', 'address.postalCode', 'address.country',
  'location.current',
  'links.linkedin', 'links.github', 'links.portfolio', 'links.website', 'links.twitter', 'links.other',
  'workAuth.authorized', 'workAuth.sponsorship', 'workAuth.sponsorshipNow', 'workAuth.sponsorshipFuture',
  'workAuth.status', 'workAuth.visaType', 'workAuth.clearance', 'screening.over18', 'screening.criminalHistory',
  // Sexual orientation and transgender identity are recognised so they are never "unknown": the profile holds no answer
  // for them yet (a Later item), so they are left blank and flagged like any unanswered EEO question.
  'eeo.gender', 'eeo.hispanicLatino', 'eeo.race', 'eeo.veteran', 'eeo.disability', 'eeo.sexualOrientation',
  'eeo.transgender',
  'education.school', 'education.degree', 'education.highestLevel', 'education.field', 'education.minor',
  'education.startDate', 'education.endDate', 'education.gpa',
  'experience.company', 'experience.title', 'experience.location', 'experience.startDate', 'experience.endDate',
  'experience.current', 'experience.description', 'experience.currentCompany', 'experience.currentTitle',
  'experience.totalYears',
  'languages.language', 'languages.proficiency', 'skills.list',
  'salary.expected', 'salary.currency', 'availability.startDate', 'availability.noticePeriod',
  'preferences.relocation', 'preferences.workArrangement', 'preferences.travel',
  'referral.source', 'referral.referrerName',
  'consent.privacy', 'consent.terms', 'consent.certify', 'consent.dataRetention', 'consent.marketing', 'consent.sms',
  'consent.backgroundCheck', 'consent.signature', 'consent.aiAttestation', 'consent.other',
  'attentionCheck',
  'freeText.whyCompany', 'freeText.whyRole', 'freeText.coverLetter', 'freeText.additionalInfo', 'freeText.other',
  'file.resume', 'file.coverLetter', 'file.other',
  'screening.previouslyEmployed', 'screening.other',
  'unknown',
] as const;
export type FieldCategory = (typeof FIELD_CATEGORIES)[number];

/** Where a value may come from, per category. Only profile, free-text and unknown allow saved answers, the LLM tiebreak,
 *  LLM classification or fuzzy matching to play any part (docs/design/core.md §8.2). */
export const POLICY_CLASSES = ['profile', 'sensitive', 'legal', 'eeo', 'consent', 'attention', 'free-text', 'file',
  'unknown'] as const;
export type PolicyClass = (typeof POLICY_CLASSES)[number];

/** Rules that produce or transform a value; every 'rule' provenance names one. 'eeo.two-or-more-races',
 *  'legal.posting-country' and 'eeo.decline-default' apply only while the matching interpretation is on in settings
 *  (on by default since settings version 2). 'eeo.decline-default' chooses the form's decline option for a
 *  self-identification question the profile does not answer (it names no profile path); 'screening.previously-employed'
 *  answers "Have you worked here before?" from the profile's employers and the posting's company. */
export const RULE_IDS = ['name.split', 'phone.format', 'date.format', 'location.compose', 'years.from-experience',
  'availability.from-notice', 'education.highest-completed', 'experience.current-checkbox', 'eeo.decline',
  'eeo.self-describe', 'eeo.two-or-more-races', 'legal.decline', 'legal.sponsorship-combined', 'legal.posting-country',
  'consent.preapproved',
  'consent.signature-preapproved', 'numeric.range-bucket', 'other.free-text', 'guard.revert', 'typeahead.query',
  'eeo.decline-default', 'screening.previously-employed'] as const;
export type RuleId = (typeof RULE_IDS)[number];

/** A profile location such as 'contact.email' or 'education[0].institution'. The worker checks that it resolves; the
 *  content script checks only its shape. */
export type ProfilePath = string & { readonly __brand: 'ProfilePath' };
export const PROFILE_PATH_PATTERN =
  /^(identity|contact|address|location|links|workAuthorization|eeo|screening|education|experience|languages|skills|preferences|referralSource|resume|coverLetter)(\.[A-Za-z0-9]+|\[\d+\])*$/;

/** Where a value came from. A value without one cannot exist: the Guard blocks it as a bug. */
export type ValueOrigin =
  | { provenance: 'profile'; path: ProfilePath; transform?: RuleId }
  | { provenance: 'saved'; savedAnswerId: string }
  | { provenance: 'rule'; ruleId: RuleId; path?: ProfilePath }
  /** labelHash: an unkeyed SHA-256 of the clean option text as sent. Page text, never stored; it proves the option
   *  has not changed since the LLM saw it. */
  | { provenance: 'llm-pick'; taskId: string; pickedCandidate: number; labelHash: string }
  | { provenance: 'llm-draft'; taskId: string; confirmedByUser: boolean }
  /** A short text TailorIT's AI answered with (version 2), and what it rested on: the resume, the profile, the job's
   *  own words, or nothing (a guess, marked "AI guess"). */
  | { provenance: 'llm-answer'; taskId: string; basis: AnswerBasis };

/** What an AI answer rested on (TailorIT's AUTOFILL_ANSWER_BASES): `guess` when nothing in the resume, the profile or
 *  the posting settles it. */
export const ANSWER_BASES = ['resume', 'profile', 'job', 'guess'] as const;
export type AnswerBasis = (typeof ANSWER_BASES)[number];

/** Vocabulary domains: which tables, and which matcher stages, a value is compared through. */
export const VOCAB_DOMAINS = ['institution', 'degree', 'field', 'country', 'region', 'language', 'proficiency',
  'referral', 'eeo.gender', 'eeo.race', 'eeo.hispanicLatino', 'eeo.veteran', 'eeo.disability', 'polarity',
  'generic'] as const;
export type VocabDomain = (typeof VOCAB_DOMAINS)[number];

/** How trustworthy a spelling of an entity is. 'raw' is exactly what the person typed. */
export const SURFACE_TIERS = ['raw', 'primary', 'curated', 'vocab', 'generated', 'flagship'] as const;
export type SurfaceTier = (typeof SURFACE_TIERS)[number];
/** A spelling the matcher may compare against. */
export interface Surface {
  text: string;
  tier: SurfaceTier;
  ambiguous: boolean;
}

/** What the resolver means to put in a field, before the matcher maps it onto this site's widget. In memory only. */
export type IntendedValue =
  | { kind: 'text'; text: string }
  | { kind: 'entity'; domain: VocabDomain; id: string | null; display: string; surfaces: Surface[] }
  | { kind: 'degree'; level: DegreeLevel; type: DegreeType | null; display: string; surfaces: Surface[] }
  /** Yes/no questions; true on a checkbox means "tick", false means "leave it alone". */
  | { kind: 'boolean'; value: boolean }
  /** Choose the form's decline option. */
  | { kind: 'decline'; domain: VocabDomain }
  | { kind: 'number'; value: number; unit: 'currency-year' | 'currency-month' | 'currency-hour' | 'years' | 'weeks';
      currency?: string }
  | { kind: 'date'; y: number; m?: number; d?: number }
  /** A set, highest priority first (a lower number is more important). */
  | { kind: 'set'; items: Array<{ value: IntendedValue; priority: number }> }
  | { kind: 'file'; file: FileRef };

/** The documents an upload field can be given (Phase G): the run's resume, or its cover letter from TailorIT. Each is
 *  the profile's own path (FILE_PATHS): an upload's origin must name the one its value names. */
export const FILE_REFS = ['resume', 'cover-letter'] as const;
export type FileRef = (typeof FILE_REFS)[number];

/** The profile path each document is attached at (the worker attaches it: attachResume, withCoverLetter). */
export const FILE_PATHS: Readonly<Record<FileRef, string>> = { resume: 'resume', 'cover-letter': 'coverLetter' };

/** What the filler writes. Indices point into the field's visible options as scanned; each choice also carries the
 *  clean label (injected text cut) of the option it means, so a list the page re-ordered or re-labelled since the plan
 *  is refused as options-changed instead of choosing whatever now sits at that place. */
export type WriteValue =
  | { kind: 'text'; text: string }
  | { kind: 'option'; index: number; cleanLabel: string; freeText?: string }
  /** cleanLabels[i] is the clean label of the option at indices[i]: the same length and order. */
  | { kind: 'options'; indices: number[]; cleanLabels: string[] }
  /** Typeahead queries, typed one at a time; each is itself a guarded write. */
  | { kind: 'query'; queries: string[] }
  | { kind: 'check' }
  /** The run's resume, or its cover letter (Phase G), which the frame receives over the resume port when it writes. */
  | { kind: 'file'; ref: FileRef }
  | { kind: 'date'; iso: string };
