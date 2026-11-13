/*
 * Every closed list the extension uses, as `as const` arrays (TailorIT's convention: no TS enums). The pure core, the
 * DOM layer, the worker and the report all type against these, so a value outside a list cannot be written down.
 * The longer lists (field categories, reason codes, rule ids, degree types) sit beside the types that use them.
 */

/** The applicant-tracking systems with an adapter (Workable since v3 Phase 7a; iCIMS, Taleo, SuccessFactors and Oracle
 *  Recruiting Cloud since v3 Phase 7b, their sign-in and posting pages). The new ATSs of the owner's snapshots of
 *  2026-11-06 (DESIGN-NEW-ATS, Phase 0: Jobvite to ADP Workforce Now, each a static ATS match of src/shared/hosts.ts;
 *  until its own adapter lands, a page of one gets the generic adapter: standard semantics, nothing pressed). And (v3
 *  Phase 8) `site`: a company's own careers page the sentinel recognised, whose application form the site adapter
 *  claims by the application-form score (src/adapters/site). The snapshot build of 2026-11-06
 *  (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06): `smartrecruiters`, its postings and its one-click application on
 *  jobs.smartrecruiters.com (src/adapters/smartrecruiters). TailorIT's ATS_KINDS lists every one but `site` since
 *  its API 6 (PLATFORMS_AHEAD_OF_CONTRACT), and, jr7, every one but the snapshot7 platforms until its API 7. */
export const PLATFORMS = ['greenhouse', 'lever', 'ashby', 'workday', 'workable', 'icims', 'taleo', 'successfactors',
  'oracle',
  // ── New ATSs (DESIGN-NEW-ATS Phase 0) ──
  'jobvite', 'jazzhr', 'bamboohr', 'rippling', 'breezy', 'careerplug', 'pinpoint', 'paycor', 'hibob', 'ultipro',
  'dayforce', 'paylocity', 'dice', 'clearcompany', 'adp',
  // ── end New ATSs ──
  'site',
  // ── snapshot build 2026-11-06 (oracle-sf-sr): SmartRecruiters ──
  'smartrecruiters',
  // ── jr7 ENGINE-7 E0 (FIX7PLAN §3.2; AUTO7-12, UKGR-1, PC7-01, JDEF-1 stage 1, ICIMS7-11): the owner's snapshot7
  // platforms, appended in this order: UKG Ready (secure<n>.saashr.com), Paycom (www.paycomonline.net's candidate
  // portal), JobDiva (www<n>.jobdiva.com/portal/), Eightfold (<company>.eightfold.ai/careers) and Jibe, iCIMS's
  // candidate front (<customer>.jibeapply.com/jobs/), whose application is on iCIMS. Each is a static ATS match of
  // src/shared/hosts.ts whose adapter is its package's (until then a stub that reads nothing: src/adapters/<platform>).
  'ukgready', 'paycom', 'jobdiva', 'eightfold', 'jibe',
  // ── end jr7 ENGINE-7 E0 ──
] as const;
export type Platform = (typeof PLATFORMS)[number];

/** The platforms the extension works on that TailorIT's contract does not list (its ATS_KINDS). Since TailorIT's API 6
 *  (the snapshot build of 2026-11-06, docs/ARCHITECTURE.md, the snapshot build of 2026-11-06), which lists every ATS of PLATFORMS, the new ATSs of
 *  DESIGN-NEW-ATS and SmartRecruiters included, in this order, with their addresses in parseAtsUrl: only `site` (v3
 *  Phase 8), a company's own page, which is no ATS and which the contract never lists. A platform here is named to
 *  TailorIT nowhere: its AI classification is not asked for (the fields go on to the AI answer, which names no
 *  platform) and no saved answer keeps it. test/contract.test.ts holds ATS_KINDS to PLATFORMS without these, and fails
 *  once the contract lists one, so a platform the extension adds ahead of TailorIT goes here until it does. */
export const PLATFORMS_AHEAD_OF_CONTRACT: readonly Platform[] = ['site',
  // jr7 ENGINE-7 E0 (FIX7PLAN §3.2 item 1): the snapshot7 platforms, until TailorIT's API 7 lists them (TAILORIT-7 7b,
  // pulled by INT-7, which puts this list back to ['site', 'jibe']). `jibe` stays for good: TailorIT keeps a Jibe
  // job as the iCIMS job its Apply leads to (FIX7PLAN §5 D-6).
  'ukgready', 'paycom', 'jobdiva', 'eightfold', 'jibe'];

/** The spec's field kinds plus one 'checkbox' (a lone box: consent, "I currently work here"). Equals TailorIT's list. */
export const FIELD_KINDS = ['text', 'textarea', 'select', 'radio', 'checkbox', 'checkbox-group', 'combobox',
  'multiselect', 'typeahead-remote', 'date', 'file'] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

/** Where a value came from. profile, saved and rule are trusted; llm-pick is validated against the visible options
 *  (a tiebreak's pick, or an answer that chose one of the field's options); llm-draft is a free-text draft (written
 *  and accepted, or kept for the person's confirmation when settings.llm.confirmDrafts is on); llm-answer is a short
 *  text TailorIT's AI answered a question with (version 2: docs/SPEC-AMENDMENTS.md). v1.3 B: submitted-before is the
 *  person's own answer to the same question in an application they submitted before (TailorIT's known questions,
 *  core/resolver/submitted.ts), trusted as their own words are. */
export const PROVENANCES = ['profile', 'saved', 'rule', 'llm-pick', 'llm-draft', 'llm-answer',
  // v1.3 B
  'submitted-before',
  // v1.5 X (PLAN decision 4): an answer TailorIT prepared for this job ahead of time (a job application draft,
  // POST /forms/known's `match: 'draft'`; core/resolver/submitted.ts findDraftAnswer). AI-made, so not trusted.
  'prebuilt'] as const;
export type Provenance = (typeof PROVENANCES)[number];
export const TRUSTED_PROVENANCES: ReadonlySet<Provenance> = new Set<Provenance>(['profile', 'saved', 'rule',
  'submitted-before']);

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
