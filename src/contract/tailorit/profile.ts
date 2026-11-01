import { z } from 'zod';
import {
  CalendarDateSchema,
  CountryCodeSchema,
  InstantSchema,
  sensitive,
  textOf,
  WebUrlSchema,
  YearMonthSchema,
} from './common';
import { AUTOFILL_RESUME_KINDS } from './resumes';

// The autofill profile (GET and PUT /api/autofill/profile), edited on Settings › Autofill and seeded from a resume.
// Two parts, stored and served apart: the profile, which the extension reads for every fill, and the sensitive part
// (work authorization, self-identification, age, criminal record, pronouns, pay), which it fetches only when a form
// asks such a question, and only with the profile:sensitive scope. Entities, not strings: the extension's matcher maps
// them onto each site's options. The value lists equal the extension's own (its src/core/enums.ts): DEGREE_LEVELS as
// written there, the others in kebab case.

/** `professional` covers MBA, JD and MD. */
export const DEGREE_LEVELS = [
  'highSchool',
  'associate',
  'bachelor',
  'master',
  'doctorate',
  'professional',
  'other',
] as const;
export type DegreeLevel = (typeof DEGREE_LEVELS)[number];

export const LANGUAGE_PROFICIENCIES = [
  'elementary',
  'limited-working',
  'professional-working',
  'full-professional',
  'native',
] as const;
export type LanguageProficiency = (typeof LANGUAGE_PROFICIENCIES)[number];

/** The job preferences' own list (Settings), which the seed copies. */
export const WORK_ARRANGEMENTS = ['remote', 'hybrid', 'onsite'] as const;
export type WorkArrangement = (typeof WORK_ARRANGEMENTS)[number];

/** A repeatable entry's id, kept across edits so the page can tell the entries apart (a UUID will do). */
const EntryIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);

/** Where a school or a job is; '' or null for what is not known. */
export const AutofillPlaceSchema = z.object({
  city: textOf(100),
  region: textOf(100),
  country: CountryCodeSchema.nullable(),
});
export type AutofillPlace = z.infer<typeof AutofillPlaceSchema>;

export const AutofillEducationSchema = z.object({
  id: EntryIdSchema,
  institution: z.object({
    /** The full official name ("The University of Texas at Austin"). */
    canonicalName: textOf(200).min(1, 'Required'),
    /** Other names forms use ("UT Austin", "UT-Austin"). */
    aliases: z.array(textOf(200)).max(10),
    /** Its IPEDS unit id and ROR id, when known: the extension's vocabulary looks those up first. */
    ids: z
      .object({ ipeds: z.string().regex(/^\d{6}$/).optional(), ror: z.string().regex(/^0[a-z0-9]{8}$/).optional() })
      .optional(),
  }),
  degree: z.object({
    level: z.enum(DEGREE_LEVELS),
    /** "BS", "BSc", "MBA"; '' when only the level is known. */
    type: textOf(40),
    /** Field of study ("Computer Science"); '' for none. */
    field: textOf(150),
    /** CIP 2020 code ("11.0701"), when known. */
    cip: z.string().regex(/^\d{2}\.\d{4}$/).optional(),
  }),
  /** '' for none. */
  minor: textOf(150),
  startDate: YearMonthSchema.nullable(),
  endDate: YearMonthSchema.nullable(),
  /** Still studying there; `endDate` is then the expected graduation. */
  current: z.boolean(),
  gpa: z.object({ value: z.number().min(0).max(100), scale: z.number().positive().max(100) }).nullable(),
  location: AutofillPlaceSchema,
});
export type AutofillEducation = z.infer<typeof AutofillEducationSchema>;

export const AutofillExperienceSchema = z.object({
  id: EntryIdSchema,
  company: textOf(200).min(1, 'Required'),
  title: textOf(200).min(1, 'Required'),
  location: AutofillPlaceSchema,
  startDate: YearMonthSchema.nullable(),
  endDate: YearMonthSchema.nullable(),
  /** "I currently work here": the extension ticks it and leaves the end date alone. */
  current: z.boolean(),
  /** Plain text, for forms that ask for a description per role. */
  description: textOf(4000),
});
export type AutofillExperience = z.infer<typeof AutofillExperienceSchema>;

export const AutofillProfileSchema = z.object({
  name: z.object({
    first: textOf(100),
    middle: textOf(100),
    last: textOf(100),
    /** "Jr.", "III". */
    suffix: textOf(20),
    /** "Preferred first name"; '' = the same as `first`. */
    preferred: textOf(100),
  }),
  contact: z.object({
    /** '' = the account's sign-in address (GET answers with it filled in, when this rule takes it; else ''). */
    email: z.union([z.literal(''), z.email('Enter a valid email address').max(254, 'Use at most 254 characters')]),
    phone: z.object({
      /** As written, E.164 preferred ("+1 512 555 0100"); the extension formats it per widget. */
      number: z
        .string()
        .max(30, 'Use at most 30 characters')
        .regex(/^[0-9+().\s-]*$/, 'Use digits, spaces and + ( ) - only'),
      country: CountryCodeSchema.nullable(),
      extension: z.string().max(8, 'Use at most 8 digits').regex(/^\d*$/, 'Use digits only'),
    }),
    address: z.object({
      line1: textOf(200),
      line2: textOf(200),
      city: textOf(100),
      /** A US state or Canadian province code ("TX", "ON"), else the region as written. */
      region: textOf(100),
      postalCode: textOf(20),
      country: CountryCodeSchema.nullable(),
    }),
  }),
  links: z.object({
    linkedin: WebUrlSchema,
    github: WebUrlSchema,
    portfolio: WebUrlSchema,
    website: WebUrlSchema,
    other: z.array(z.object({ label: textOf(60), url: WebUrlSchema })).max(10),
  }),
  /** Most recent first, as on the resume. */
  education: z.array(AutofillEducationSchema).max(10),
  experience: z.array(AutofillExperienceSchema).max(30),
  languages: z
    .array(
      z.object({ language: textOf(60).min(1, 'Required'), proficiency: z.enum(LANGUAGE_PROFICIENCIES).nullable() }),
    )
    .max(20),
  skills: z.array(textOf(80)).max(200),
  preferences: z.object({
    earliestStartDate: CalendarDateSchema.nullable(),
    noticePeriodWeeks: z.number().int().min(0).max(52).nullable(),
    willingToRelocate: z.enum(['yes', 'no']).nullable(),
    workArrangements: z.array(z.enum(WORK_ARRANGEMENTS)).max(3),
    travelPercent: z.number().int().min(0).max(100).nullable(),
    /** The usual answer to "How did you hear about us?"; '' = ask each time. */
    referralSource: textOf(100),
  }),
  /**
   * The resume to attach unless the application tracked for the job names its own; null = TailorIT's best match for
   * each job. The extension attaches the lookup's suggestedResume.
   */
  documents: z.object({ resumeId: z.string().max(64).nullable() }),
});
export type AutofillProfile = z.infer<typeof AutofillProfileSchema>;

export const RACE_CATEGORIES = [
  'american-indian-alaska-native',
  'asian',
  'black-african-american',
  'middle-eastern-north-african',
  'native-hawaiian-pacific-islander',
  'white',
] as const;
export type RaceCategory = (typeof RACE_CATEGORIES)[number];

/** `self-describe` carries the person's own words (`selfDescribed`). */
export const GENDER_IDENTITIES = ['female', 'male', 'non-binary', 'self-describe'] as const;
export type GenderIdentity = (typeof GENDER_IDENTITIES)[number];

export const WORK_STATUSES = ['citizen', 'permanent-resident', 'work-visa', 'student-visa', 'other'] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

export const EXPECTED_SALARY_PERIODS = ['year', 'month', 'hour'] as const;
export type ExpectedSalaryPeriod = (typeof EXPECTED_SALARY_PERIODS)[number];

export const AutofillSensitiveSchema = z.object({
  /** One row per country answered for; a question about another country is left blank and flagged. */
  workAuthorization: z
    .array(
      z.object({
        country: CountryCodeSchema,
        /** "Are you legally authorized to work in <country>?" */
        authorized: sensitive(z.boolean()),
        /** "Will you now require sponsorship…?" */
        sponsorshipNow: sensitive(z.boolean()),
        /** "Will you in the future require sponsorship…?" A combined "now or in the future" question uses both. */
        sponsorshipFuture: sensitive(z.boolean()),
        /** Only where a form asks for the status itself; never derived from the answers above. */
        status: sensitive(z.enum(WORK_STATUSES)),
      }),
    )
    .max(20),
  eeo: z.object({
    gender: sensitive(z.object({ identity: z.enum(GENDER_IDENTITIES), selfDescribed: textOf(100) })),
    hispanicOrLatino: sensitive(z.boolean()),
    /** Every race that applies; "Two or more races" is derived from two or more. */
    races: sensitive(z.array(z.enum(RACE_CATEGORIES)).min(1, 'Choose at least one').max(6)),
    veteran: sensitive(z.object({ isVeteran: z.boolean(), isProtectedVeteran: z.boolean() })),
    disability: sensitive(z.boolean()),
    pronouns: sensitive(textOf(40).min(1, 'Required')),
  }),
  legal: z.object({
    atLeast18: sensitive(z.boolean()),
    /**
     * "Have you ever been convicted of a crime?" (version 2): true, yes; false, no. Matched to a form's question by
     * its polarity alone, never guessed and never sent to Claude. Optional in what is sent (an older extension's
     * copy, a row saved before it): absent reads as not provided, so every answer carries it, and a save that leaves
     * it out keeps the answer already stored.
     */
    criminalRecord: sensitive(z.boolean()).default(() => ({ state: 'not_provided' as const })),
  }),
  compensation: z.object({
    expectedSalary: sensitive(
      z.object({
        min: z.number().int().positive(),
        max: z.number().int().positive().nullable(),
        currency: z.string().regex(/^[A-Z]{3}$/, 'Use a three-letter currency code, like USD'),
        period: z.enum(EXPECTED_SALARY_PERIODS),
      }),
    ),
  }),
});
export type AutofillSensitive = z.infer<typeof AutofillSensitiveSchema>;

/** "2021" or "2021-09" as a year and maybe a month; null when malformed (that is reported on its own). */
function yearMonthOf(text: string | null): { year: number; month: number | null } | null {
  const match = text === null ? null : /^(\d{4})(?:-(\d{2}))?$/.exec(text);
  if (!match) return null;
  return { year: Number(match[1]), month: match[2] === undefined ? null : Number(match[2]) };
}

/** An end before its start. Months count only when both dates have one: "2021" ends "2021-09" fine. */
function endsBeforeStart(start: string | null, end: string | null): boolean {
  const from = yearMonthOf(start);
  const to = yearMonthOf(end);
  if (!from || !to) return false;
  if (to.year !== from.year) return to.year < from.year;
  return from.month !== null && to.month !== null && to.month < from.month;
}

const END_BEFORE_START = 'The end date is before the start date';

interface DatedEntry {
  id: string;
  startDate: string | null;
  endDate: string | null;
  current: boolean;
}

function checkEntries(list: 'education' | 'experience', entries: readonly DatedEntry[], ctx: z.RefinementCtx): void {
  const ids = new Set<string>();
  entries.forEach((entry, index) => {
    if (ids.has(entry.id)) {
      ctx.addIssue({ code: 'custom', path: [list, index, 'id'], message: 'Each entry needs its own id' });
    }
    ids.add(entry.id);
    if (!entry.current && endsBeforeStart(entry.startDate, entry.endDate)) {
      ctx.addIssue({ code: 'custom', path: [list, index, 'endDate'], message: END_BEFORE_START });
    }
  });
}

/** First and last name required; an end never before its start (unless current); a GPA within its scale; unique ids. */
function checkProfile(profile: AutofillProfile, ctx: z.RefinementCtx): void {
  if (!profile.name.first.trim()) ctx.addIssue({ code: 'custom', path: ['name', 'first'], message: 'Required' });
  if (!profile.name.last.trim()) ctx.addIssue({ code: 'custom', path: ['name', 'last'], message: 'Required' });
  checkEntries('education', profile.education, ctx);
  checkEntries('experience', profile.experience, ctx);
  profile.education.forEach((entry, index) => {
    if (entry.gpa && entry.gpa.value > entry.gpa.scale) {
      ctx.addIssue({
        code: 'custom',
        path: ['education', index, 'gpa', 'value'],
        message: 'The GPA is above its scale',
      });
    }
  });
}

/** One row per country; a self-described gender has its words; a protected veteran is a veteran; max >= min. */
function checkSensitive(answers: AutofillSensitive, ctx: z.RefinementCtx): void {
  const countries = new Set<string>();
  answers.workAuthorization.forEach((row, index) => {
    if (countries.has(row.country)) {
      ctx.addIssue({
        code: 'custom',
        path: ['workAuthorization', index, 'country'],
        message: 'That country is already listed',
      });
    }
    countries.add(row.country);
  });
  const { gender, veteran } = answers.eeo;
  if (gender.state === 'value' && gender.value.identity === 'self-describe' && !gender.value.selfDescribed.trim()) {
    ctx.addIssue({
      code: 'custom',
      path: ['eeo', 'gender', 'value', 'selfDescribed'],
      message: 'Describe your gender, or choose another answer',
    });
  }
  if (veteran.state === 'value' && veteran.value.isProtectedVeteran && !veteran.value.isVeteran) {
    ctx.addIssue({ code: 'custom', path: ['eeo', 'veteran'], message: 'A protected veteran is a veteran' });
  }
  const salary = answers.compensation.expectedSalary;
  if (salary.state === 'value' && salary.value.max !== null && salary.value.max < salary.value.min) {
    ctx.addIssue({
      code: 'custom',
      path: ['compensation', 'expectedSalary', 'value', 'max'],
      message: 'The maximum is below the minimum',
    });
  }
}

/** What a save must pass: the shapes above and the cross-field rules. Answers stay lenient (the empty one parses). */
export const AutofillProfileSaveSchema = AutofillProfileSchema.superRefine(checkProfile);
export const AutofillSensitiveSaveSchema = AutofillSensitiveSchema.superRefine(checkSensitive);

/**
 * GET /api/autofill/profile. With no row yet: the empty profile, revision 0 and updatedAt null. An empty
 * `contact.email` is answered as the account's sign-in address when the email rule above takes it, else it stays ''.
 * It never carries the sensitive part.
 */
export const AutofillProfileEnvelopeSchema = z.object({
  apiVersion: z.number().int(),
  /** Bumped by every save; a save names the revision it was made from. */
  revision: z.number().int().nonnegative(),
  updatedAt: InstantSchema.nullable(),
  profile: AutofillProfileSchema,
});
export type AutofillProfileEnvelope = z.infer<typeof AutofillProfileEnvelopeSchema>;

/** GET /api/autofill/profile/sensitive (scope profile:sensitive): the same row, its sensitive part only. */
export const AutofillSensitiveEnvelopeSchema = z.object({
  apiVersion: z.number().int(),
  revision: z.number().int().nonnegative(),
  updatedAt: InstantSchema.nullable(),
  sensitive: AutofillSensitiveSchema,
});
export type AutofillSensitiveEnvelope = z.infer<typeof AutofillSensitiveEnvelopeSchema>;

/**
 * PUT /api/autofill/profile (the Settings page only): both parts in one save, from the revision the page loaded (0
 * before the first save). A stale revision is refused (409 `revision_conflict`).
 */
export const PutAutofillProfileBodySchema = z.object({
  revision: z.number().int().nonnegative(),
  profile: AutofillProfileSaveSchema,
  sensitive: AutofillSensitiveSaveSchema,
});
export type PutAutofillProfileBody = z.infer<typeof PutAutofillProfileBodySchema>;

/** PUT's answer: the row as saved. */
export const PutAutofillProfileResponseSchema = z.object({
  revision: z.number().int().nonnegative(),
  updatedAt: InstantSchema,
  profile: AutofillProfileSchema,
  sensitive: AutofillSensitiveSchema,
});
export type PutAutofillProfileResponse = z.infer<typeof PutAutofillProfileResponseSchema>;

/** GET /api/autofill/profile/seed?resumeId= (the Settings page only): that resume, else the default, else the last. */
export const AutofillSeedQuerySchema = z.object({ resumeId: z.string().min(1).max(64).optional() });
export type AutofillSeedQuery = z.infer<typeof AutofillSeedQuerySchema>;

/** "Fill from my resume": the page merges it into empty fields only. Nothing sensitive is ever seeded. */
export const AutofillSeedSchema = z.object({
  /** The resume read; null when there is none to read. */
  source: z.object({ resumeId: z.string(), label: z.string(), kind: z.enum(AUTOFILL_RESUME_KINDS) }).nullable(),
  /** A whole profile: what the resume, the account and the preferences say; everything else empty. */
  profile: AutofillProfileSchema,
  /** Paths the seed filled ("name.first", "education.0.degree.level"), so the page can mark them "From your resume". */
  filled: z.array(z.string()),
  /** Sentences to check ("Check how your name was split."). */
  notes: z.array(z.string()),
});
export type AutofillSeed = z.infer<typeof AutofillSeedSchema>;

/** Empty strings and lists, and null for what may be null: what GET answers before the first save. */
export const EMPTY_AUTOFILL_PROFILE: AutofillProfile = {
  name: { first: '', middle: '', last: '', suffix: '', preferred: '' },
  contact: {
    email: '',
    phone: { number: '', country: null, extension: '' },
    address: { line1: '', line2: '', city: '', region: '', postalCode: '', country: null },
  },
  links: { linkedin: '', github: '', portfolio: '', website: '', other: [] },
  education: [],
  experience: [],
  languages: [],
  skills: [],
  preferences: {
    earliestStartDate: null,
    noticePeriodWeeks: null,
    willingToRelocate: null,
    workArrangements: [],
    travelPercent: null,
    referralSource: '',
  },
  documents: { resumeId: null },
};

/** Every answer not provided, and no country. */
export const EMPTY_AUTOFILL_SENSITIVE: AutofillSensitive = {
  workAuthorization: [],
  eeo: {
    gender: { state: 'not_provided' },
    hispanicOrLatino: { state: 'not_provided' },
    races: { state: 'not_provided' },
    veteran: { state: 'not_provided' },
    disability: { state: 'not_provided' },
    pronouns: { state: 'not_provided' },
  },
  legal: { atLeast18: { state: 'not_provided' }, criminalRecord: { state: 'not_provided' } },
  compensation: { expectedSalary: { state: 'not_provided' } },
};
