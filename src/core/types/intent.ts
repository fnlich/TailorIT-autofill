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
  'education.startDate', 'education.endDate', 'education.gpa', 'education.current',
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
  // s2 core-gh (snapshot round 2, the gh and eeo studies): a Telegram link; a whole address in one box ("What is your
  // current address?", "Primary Residence Address"); the countries of citizenship ("Country of Origin"); a restrictive
  // agreement (a non-compete), U.S. military or government service, a relative at the company, the role's essential
  // functions, all from the sensitive part; the person's certifications, where they would relocate to, and their
  // education written out ("College Name; Degree Obtained").
  'links.telegram', 'address.full', 'workAuth.citizenship', 'screening.restrictiveAgreement',
  'screening.governmentService', 'screening.relatives', 'screening.essentialFunctions', 'skills.certifications',
  'preferences.relocationPlaces', 'education.summary',
  // s2 core-gh end
  // s2 core-wd: Workday's My Information (the wd study §5): a name's suffix, the phone's extension, and whether the
  // person goes by a preferred name ("I have a preferred name").
  'identity.suffix', 'contact.phoneExtension', 'identity.hasPreferredName',
  // jr6 RULES (FIXPLAN §6.3 R1): the date beside a signature (JV-1, JZ-15, workday-new-1); the language a form is
  // written in, never the person's (workday-new-1); an employer's own employee number (workday-new-1); a job's or a
  // school's city, region and country, never the home address (ICIMS-09, O7); an address search's "Enter manually"
  // (ICIMS-08); the county (JV-3, WD-26, ADP-14, O3); the residence a privacy policy is chosen by (JV-9); whether a
  // current employee referred the person (JV-15, ADP-19, U-11); a question that asks only of those living in a place
  // (JV-17).
  'consent.signatureDate', 'languages.formLanguage', 'identity.employeeId', 'experience.city', 'experience.region',
  'experience.country', 'education.city', 'education.region', 'education.country', 'address.lookup', 'address.county',
  'location.policyResidence', 'referral.employeeReferred', 'location.residesIn',
  // jr6 RULES R2 (FIXPLAN §6.3 items 27 to 34): OPT or CPT to begin or continue employment (WD-30).
  'workAuth.opt',
  // jr6 RULES R3 (FIXPLAN §6.3 items 35 to 48): military training or a certification for the role (WD-29); an address's
  // own type (ICIMS-13); how the person heard, specified further (ICIMS-19); the person's time zone, and whether they
  // live in one (ICIMS-26, JV-16); N years of experience in something, and experience with something (JV-16).
  'screening.militaryTraining', 'address.type', 'referral.detail', 'preferences.timeZone', 'location.inTimeZone',
  'experience.yearsIn', 'skills.experienceWith',
  // jr6 RULES R3 (FIXPLAN §6.3 items 49 to 61): whether the person lives or will work in a country a question names
  // (JZ-11); a former, previous or maiden name, which the profile never holds (U-11).
  'location.inCountry', 'identity.formerName',
  // jr6 RULES end
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
 *  answers "Have you worked here before?" from the profile's employers and the posting's company; 'legal.work-basis'
 *  chooses the option of a basis-of-right-to-work list the entry's answers state (resolver/workBasis.ts). */
export const RULE_IDS = ['name.split', 'phone.format', 'date.format', 'location.compose', 'years.from-experience',
  'availability.from-notice', 'education.highest-completed', 'experience.current-checkbox', 'education.current-checkbox',
  'eeo.decline',
  'eeo.self-describe', 'eeo.two-or-more-races', 'legal.decline', 'legal.sponsorship-combined', 'legal.posting-country',
  'consent.preapproved',
  'consent.signature-preapproved', 'numeric.range-bucket', 'other.free-text', 'guard.revert', 'typeahead.query',
  'eeo.decline-default', 'screening.previously-employed', 'consent.required', 'consent.no-ai-attestation',
  'legal.work-basis',
  // s2 core-gh: the N/A an instruction asks for where the profile holds no value (decision 8); a handle taken from a
  // link (decision 9); the portfolio for a website (decision 11); a Yes or No written as text (decision 11); the
  // Hispanic or Latino option of a race list (decision 12); an answer a list does not offer, declined (decision 12);
  // an address, a list of places or of certifications, or the education, written out from the profile's parts.
  'placeholder.no-profile', 'link.handle', 'links.website-from-portfolio', 'legal.yes-no-text', 'eeo.hispanic-race',
  'eeo.not-offered', 'compose.text',
  // s2 core-gh end
  // jr6 RULES (FIXPLAN §6.3 R1): today's date beside an approved or required signature (JV-1, JZ-15); English for a
  // form's own language (workday-new-1); an address search's "Enter manually" (ICIMS-08); a follow-up's one "Not
  // Applicable" once the answer above is the opposite of its trigger (JV-6); a privacy policy's residence option (JV-9);
  // No to "referred by a current employee" for a source that is no person (JV-15, ADP-19, U-11); the "I do not live
  // there" option of a question asked only of those who do (JV-17); the qualifications a checklist names among the
  // person's skills and degrees (JV-5).
  'consent.signature-date', 'form.language', 'address.enter-manually', 'conditional.not-applicable',
  'location.policy-residence', 'referral.not-employee', 'location.not-there', 'skills.qualifications',
  // jr6 RULES R2 (FIXPLAN §6.3 items 27 to 34): a work status chosen by its meaning, or answered yes or no, from the
  // entry's status, the person's citizenships or a non-citizen's authorization and sponsorship answers (JV-7, JV-11,
  // JZ-7, JZ-8); the entry of the country the person is located in, among those a question qualifies so (SR-4); OPT or
  // CPT from the sponsorship answers and a student visa (WD-30).
  'legal.work-status', 'legal.located-country', 'legal.opt',
  // jr6 RULES R3 (FIXPLAN §6.3 items 35 to 48): No to military training from no military service and no veteran status
  // (WD-29); a home address's type (ICIMS-13); a time zone from the profile's state (ICIMS-26, JV-16); years in
  // something from the experience entries' titles and durations, and experience with something from the skills and the
  // entries (JV-16); an employer the question names, compared with the profile's (WD-17: screening.previously-employed
  // as before).
  'legal.military-training', 'address.type-home', 'location.time-zone', 'experience.years-in', 'skills.experience-with',
  // jr6 RULES R3 (FIXPLAN §6.3 items 49 to 61): yes or no to living or working in the country a question names, from the
  // profile's address (JZ-11).
  'location.in-country',
  // jr6 RULES end
] as const;
export type RuleId = (typeof RULE_IDS)[number];

/** s2 core-gh (decision 8): what the N/A rule (placeholder.no-profile) types: the only texts that rule may write
 *  (guard/provenance.ts checkProvenanceShape). */
export const NO_VALUE_PLACEHOLDERS = ['N/A', 'NA', 'None'] as const;
export type NoValuePlaceholder = (typeof NO_VALUE_PLACEHOLDERS)[number];

/** A profile location such as 'contact.email' or 'education[0].institution'. The worker checks that it resolves; the
 *  content script checks only its shape. */
export type ProfilePath = string & { readonly __brand: 'ProfilePath' };
// s2 core-gh: the profile's certifications (snapshot round 2) are a root of their own.
export const PROFILE_PATH_PATTERN =
  /^(identity|contact|address|location|links|workAuthorization|eeo|screening|education|experience|languages|skills|preferences|referralSource|resume|coverLetter|certifications)(\.[A-Za-z0-9]+|\[\d+\])*$/;

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
  | { provenance: 'llm-answer'; taskId: string; basis: AnswerBasis }
  /** v1.3 B: the person's own answer to this question in an application they submitted before (TailorIT's known
   *  questions; core/resolver/submitted.ts): `submittedId` names it in the run's list, `sameJob` says whether it was
   *  this job's (a re-apply) or another job's (only ever for a question that is not sensitive). */
  | { provenance: 'submitted-before'; submittedId: string; sameJob: boolean }
  /** v1.5 X (PLAN decision 4): the answer TailorIT prepared for this job's question ahead of time (its job application
   *  draft, read with the job's known questions; core/resolver/submitted.ts findDraftAnswer): `draftId` names it in the
   *  run's list. Never for a sensitive, consent or attention-check question, nor a file. */
  | { provenance: 'prebuilt'; draftId: string };

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

/** The profile path of the run's cover letter as text (v3 Phase 3b): a cover-letter text box takes its words, and no
 *  other field may (the Guard's category policy). */
export const COVER_LETTER_TEXT_PATH = 'coverLetter.text';

/** What the filler writes. Indices point into the field's visible options as scanned; each choice also carries the
 *  clean label (injected text cut) of the option it means, so a list the page re-ordered or re-labelled since the plan
 *  is refused as options-changed instead of choosing whatever now sits at that place. */
export type WriteValue =
  | { kind: 'text'; text: string }
  | { kind: 'option'; index: number; cleanLabel: string; freeText?: string }
  /** cleanLabels[i] is the clean label of the option at indices[i]: the same length and order. */
  | { kind: 'options'; indices: number[]; cleanLabels: string[] }
  /** Typeahead queries, typed one at a time; each is itself a guarded write. s2 core-wd: `other`, once they find
   *  nothing, the list's own "Other" is searched for (core/matcher/searchLimits.ts NO_MATCH_OTHER_QUERY) and chosen
   *  (settings.modes.noMatch 'other'; plan/frame.ts noMatchOtherAllowed). */
  | { kind: 'query'; queries: string[]; other?: true }
  | { kind: 'check' }
  /** The run's resume, or its cover letter (Phase G), which the frame receives over the resume port when it writes. */
  | { kind: 'file'; ref: FileRef }
  | { kind: 'date'; iso: string };
