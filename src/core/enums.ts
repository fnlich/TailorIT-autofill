/*
 * Every closed list the extension uses, as `as const` arrays (TailorIT's convention: no TS enums). The pure core, the
 * DOM layer, the worker and the report all type against these, so a value outside a list cannot be written down.
 * The longer lists (field categories, reason codes, rule ids, degree types) sit beside the types that use them.
 */

/** The applicant-tracking systems with an adapter. Workable and SmartRecruiters come later. */
export const PLATFORMS = ['greenhouse', 'lever', 'ashby', 'workday'] as const;
export type Platform = (typeof PLATFORMS)[number];

/** The spec's field kinds plus one 'checkbox' (a lone box: consent, "I currently work here"). Equals TailorIT's list. */
export const FIELD_KINDS = ['text', 'textarea', 'select', 'radio', 'checkbox', 'checkbox-group', 'combobox',
  'multiselect', 'typeahead-remote', 'date', 'file'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

/** Where a value came from. profile, saved and rule are trusted; llm-pick is validated against the visible options
 *  (a tiebreak's pick, or an answer that chose one of the field's options); llm-draft is a free-text draft (written
 *  and accepted, or kept for the person's confirmation when settings.llm.confirmDrafts is on); llm-answer is a short
 *  text TailorIT's AI answered a question with (version 2: docs/SPEC-AMENDMENTS.md). */
export const PROVENANCES = ['profile', 'saved', 'rule', 'llm-pick', 'llm-draft', 'llm-answer'] as const;
export type Provenance = (typeof PROVENANCES)[number];
export const TRUSTED_PROVENANCES: ReadonlySet<Provenance> = new Set<Provenance>(['profile', 'saved', 'rule']);

/** Which stage of the matcher chose the option. 'cache' reuses an accepted match; 'not-applicable' is a field with no
 *  options (text, file). */
export const MATCHER_STAGES = ['cache', 'exact', 'alias', 'fuzzy', 'llm', 'other', 'none', 'not-applicable'] as const;
export type MatcherStage = (typeof MATCHER_STAGES)[number];

/** The spec's five statuses. When several apply: blocked > flagged > verified > filled > skipped. */
export const FILL_STATUSES = ['filled', 'verified', 'skipped', 'flagged', 'blocked'] as const;
export type FillStatus = (typeof FILL_STATUSES)[number];

/** Where a field's label came from, in the spec's order, then the adapter's, then none. */
export const LABEL_SOURCES = ['for', 'aria-labelledby', 'aria-label', 'wrapping-label', 'legend', 'placeholder',
  'adapter', 'none'] as const;
export type LabelSource = (typeof LABEL_SOURCES)[number];

/** Visible, or one of the two approved exceptions: a hidden native radio or checkbox, or a hidden file input, tied to a
 *  visible control. Anything else is a honeypot and never becomes a field. */
export const FIELD_VISIBILITIES = ['visible', 'hidden-native-with-visible-label', 'hidden-file-with-visible-control'] as const;
export type FieldVisibility = (typeof FIELD_VISIBILITIES)[number];

/** Formats a field asks for, from its type, inputmode, pattern or hint. */
export const FIELD_FORMATS = ['free', 'email', 'tel', 'url', 'number', 'integer', 'currency', 'percent', 'year',
  'month-year', 'date', 'postal-code'] as const;
export type FieldFormat = (typeof FIELD_FORMATS)[number];

/** The spec's degree levels: professional covers MBA, JD and MD. */
export const DEGREE_LEVELS = ['highSchool', 'associate', 'bachelor', 'master', 'doctorate', 'professional', 'other'] as const;
export type DegreeLevel = (typeof DEGREE_LEVELS)[number];

/** Degree types the matcher knows; equivalence classes (BS = BSc = SB, ...) live in the degree vocabulary. */
export const DEGREE_TYPES = ['HSD', 'GED', 'AA', 'AS', 'AAS', 'BA', 'BS', 'BSc', 'BEng', 'BBA', 'BFA', 'BArch', 'BSN',
  'BCom', 'BTech', 'BMus', 'BEd', 'LLB', 'MA', 'MS', 'MSc', 'MEng', 'MFA', 'MPH', 'MPA', 'MPP', 'MSW', 'MEd', 'MArch',
  'MPhil', 'MRes', 'MTech', 'LLM', 'MBA', 'PhD', 'DPhil', 'EdD', 'DBA', 'DSc', 'PsyD', 'JD', 'MD', 'DO', 'DDS', 'DMD',
  'PharmD', 'DVM', 'MBBS', 'Certificate', 'Diploma'] as const;
export type DegreeType = (typeof DEGREE_TYPES)[number];

// TailorIT's value lists, in kebab case. The contract test checks they equal the copied contract's (Phase 2).

/** Language proficiency, as TailorIT's profile records it. */
export const PROFICIENCIES = ['elementary', 'limited-working', 'professional-working', 'full-professional', 'native'] as const;
export type Proficiency = (typeof PROFICIENCIES)[number];

/** Race categories a person may give; "Two or More Races" is never stored, only derived on approval (interpretation 2). */
export const RACES = ['american-indian-alaska-native', 'asian', 'black-african-american', 'middle-eastern-north-african',
  'native-hawaiian-pacific-islander', 'white'] as const;
export type Race = (typeof RACES)[number];

export const GENDERS = ['female', 'male', 'non-binary', 'self-describe'] as const;
export type Gender = (typeof GENDERS)[number];

export const WORK_STATUSES = ['citizen', 'permanent-resident', 'work-visa', 'student-visa', 'other'] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

/** Consent categories a person may pre-approve in settings. AI attestations and unrecognised consent are not here:
 *  they can never be pre-approved. */
export const CONSENT_CATEGORIES = ['privacy', 'terms', 'certify', 'dataRetention', 'marketing', 'sms',
  'backgroundCheck', 'signature'] as const;
export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];
