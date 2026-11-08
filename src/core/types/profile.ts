/*
 * The canonical profile: entities, not strings (Requirement A). canonicalizeProfile (Phase 2) builds it in the worker
 * from TailorIT's two wire parts, AutofillProfile and, when fetched, AutofillSensitive. It never leaves the worker; a
 * frame receives only the values planned for its own fields.
 */
import type { DegreeLevel, DegreeType, Gender, Proficiency, Race, WorkStatus } from '../enums';

/** An explicit answer or an explicit decline. Absent means never answered: the field is left blank and flagged.
 *  TailorIT's "not provided" maps to absent, its "declined" to `{kind: 'decline'}`. */
export type Explicit<T> = { kind: 'value'; value: T } | { kind: 'decline' };

export interface YearMonth {
  y: number;
  m?: number;
}
export interface Ymd {
  y: number;
  m: number;
  d: number;
}

export interface Institution {
  canonicalName: string;
  aliases: string[];
  ids: { ipeds?: string; ror?: string };
  city?: string;
  /** The USPS code in the US, else the subdivision's name. */
  region?: string;
  /** ISO 3166-1 alpha-2. */
  country?: string;
  campus?: string;
  /** 'user' when the vocabulary did not resolve it: the person's own spelling is used. */
  source: 'vocab' | 'user';
  /** Exactly what the person typed: the first spelling the matcher tries. */
  userText: string;
}

export interface FieldOfStudy {
  name: string;
  /** CIP 2020 code ("11.0701"), when known. */
  cip?: string;
  aliases: string[];
  userText: string;
}

export interface Degree {
  level: DegreeLevel;
  type?: DegreeType;
  field?: FieldOfStudy;
  userText: string;
}

export interface EducationEntry {
  institution: Institution;
  degree: Degree;
  minor?: FieldOfStudy;
  startDate?: YearMonth;
  endDate?: YearMonth;
  /** Still studying there, or the end date is after `now`. */
  inProgress: boolean;
  gpa?: { value: number; scale?: number };
}

export interface PlaceRef {
  text: string;
  city?: string;
  region?: { code?: string; name: string };
  country?: string;
}

export interface ExperienceEntry {
  company: string;
  title: string;
  location?: PlaceRef;
  startDate?: YearMonth;
  endDate?: YearMonth;
  /** "I currently work here": the box is ticked and the end date left alone. */
  current: boolean;
  description?: string;
}

/** One country's work authorization. Explicit only: authorization is never inferred from citizenship. A combined
 *  "now or in the future" question is derived from the two sponsorship answers (rule legal.sponsorship-combined). */
export interface WorkAuthorization {
  country: string;
  authorized?: Explicit<boolean>;
  sponsorshipNow?: Explicit<boolean>;
  sponsorshipFuture?: Explicit<boolean>;
  status?: Explicit<WorkStatus>;
}

export interface Salary {
  min: number;
  max?: number;
  currency: string;
  period: 'year' | 'month' | 'hour';
}

export type StartDate = { kind: 'immediately' } | { kind: 'date'; date: Ymd } | { kind: 'notice'; weeks: number };

/** Whether the sensitive part (authorization, EEO, age, pronouns, pay) is in hand. 'not-shared': this browser's token
 *  lacks the scope, so those questions are left blank with sensitive-not-shared. */
export type SensitiveState = 'loaded' | 'not-loaded' | 'not-shared';

/** Snapshot round 2 (2026-11-07): the new profile values' choices. */
export const PHONE_DEVICE_TYPES = ['mobile', 'home', 'work'] as const;
export type PhoneDeviceType = (typeof PHONE_DEVICE_TYPES)[number];
export const ASIAN_SUBGROUPS = ['east-asian', 'south-asian', 'southeast-asian'] as const;
export type AsianSubgroup = (typeof ASIAN_SUBGROUPS)[number];
export const SEXUAL_ORIENTATIONS = ['asexual', 'bisexual-pansexual', 'gay', 'heterosexual', 'lesbian', 'queer',
  'self-describe'] as const;
export type SexualOrientation = (typeof SEXUAL_ORIENTATIONS)[number];
export const CLEARANCE_LEVELS = ['none', 'public-trust', 'confidential', 'secret', 'top-secret', 'ts-sci'] as const;
export type ClearanceLevel = (typeof CLEARANCE_LEVELS)[number];
export const REFERRAL_CATEGORIES = ['job-board', 'company-website', 'employee-referral', 'recruiter', 'social-media',
  'event', 'other'] as const;
export type ReferralCategory = (typeof REFERRAL_CATEGORIES)[number];

export interface Profile {
  identity: {
    fullName: string;
    firstName: string;
    middleName?: string;
    lastName: string;
    preferredName?: string;
    /** Snapshot round 2 (2026-11-07): the contract's name.suffix ("Jr.", "III"), for Workday's Suffix list. */
    suffix?: string;
    pronouns?: Explicit<string>;
    /** First and last name were split from the full name, so the panel asks the person to check them. */
    nameSplitDerived: boolean;
  };
  contact: { email: string; phone?: { text: string; digits: string; countryCallingCode?: string; country?: string;
    /** Snapshot round 2: the contract's phone.extension (digits), and the phone's device type (Workday's required
     *  "Phone Device Type"). */
    extension?: string; type?: PhoneDeviceType } };
  address?: { line1?: string; line2?: string; city?: string; region?: { code?: string; name: string };
    postalCode?: string; country?: string };
  links: { linkedin?: string; github?: string; portfolio?: string; website?: string;
    /** Snapshot round 2 (the owner: "you can add them on autofill profile data"): X (Twitter) and Telegram, as links
     *  (https://x.com/<handle>, https://t.me/<handle>); a "username" box takes the handle. */
    x?: string; telegram?: string;
    other: Array<{ label: string; url: string }> };
  workAuthorization: WorkAuthorization[];
  eeo: {
    /** 'self-describe' carries the person's own words, typed into the box the form's self-describe option reveals. */
    gender?: Explicit<{ identity: Gender; selfDescribed?: string }>;
    hispanicLatino?: Explicit<boolean>;
    race?: Explicit<Race[]>;
    veteran?: Explicit<{ veteran: boolean; protected: boolean;
      /** Snapshot round 2: serving now ("a veteran or active member of the United States Armed Forces"). */
      activeDuty?: boolean }>;
    disability?: Explicit<boolean>;
    /** Snapshot round 2 (Greenhouse's U.S. Standard Demographic Questions, fixtures/greenhouse/s2-pie-eeo-*): the
     *  Asian subgroups a list may split "Asian" into, the person's own words for race, sexual orientation (a set, with
     *  self-described words) and whether the person identifies as transgender. All from the sensitive part. */
    raceSubgroups?: AsianSubgroup[];
    raceSelfDescribed?: string;
    sexualOrientation?: Explicit<{ values: SexualOrientation[]; selfDescribed?: string }>;
    transgender?: Explicit<boolean>;
  };
  /** From the sensitive part: whether the person is 18 or older, and (version 2) whether they have ever been convicted
   *  of a crime, answered once in TailorIT and matched to a question by its polarity alone, never guessed and never
   *  sent to an AI. */
  screening: { over18?: Explicit<boolean>; criminalRecord?: Explicit<boolean>;
    /** Snapshot round 2, from the sensitive part, each answered once in TailorIT and matched by polarity, never sent to
     *  an AI: bound by a non-compete or non-solicitation agreement now; U.S. military or government service (and the
     *  year it ended, for "within the last N years"); the companies where a relative works (empty: none); able to
     *  perform the role's essential functions with or without accommodation; a security clearance; citizenships
     *  (ISO alpha-2, for "Country of Origin" and nationality questions). */
    restrictiveAgreement?: Explicit<boolean>;
    governmentService?: Explicit<{ military: boolean; militaryEndYear?: number; government: boolean;
      governmentEndYear?: number }>;
    relativesAt?: Explicit<string[]>;
    essentialFunctions?: Explicit<boolean>;
    clearance?: Explicit<{ level: ClearanceLevel; active?: boolean; polygraph?: 'none' | 'ci' | 'full-scope' }>;
    citizenships?: Explicit<string[]>;
  };
  education: EducationEntry[];
  experience: ExperienceEntry[];
  languages: Array<{ code?: string; name: string; proficiency?: Proficiency }>;
  skills: string[];
  preferences: {
    expectedSalary?: Explicit<Salary>;
    startDate?: StartDate;
    relocation?: Explicit<boolean>;
    workArrangements?: Array<'remote' | 'hybrid' | 'onsite'>;
    /** How much of the time the person is willing to travel, 0 to 100 (TailorIT's travelPercent). */
    travelPercent?: number;
    /** Snapshot round 2: where the person would relocate or work hybrid from (place texts, at most 10). */
    relocationPlaces?: string[];
  };
  /** Snapshot round 2: the person's certifications ("Do you hold any industry related certifications?"). */
  certifications?: Array<{ name: string; issuer?: string; year?: number }>;
  /** "How did you hear about us": a referral-vocabulary id, or 'other' with text. */
  referralSource?: { id: string; otherText?: string;
    /** Snapshot round 2 (Workday's two-level "How Did You Hear About Us?"): its kind, for a list of categories. */
    category?: ReferralCategory };
  resume?: { id: string; fileName: string; mime: string; sizeBytes: number };
  /** The run's cover letter (Phase G), attached by the worker only once TailorIT has it ready to upload
   *  (withCoverLetter): whether TailorIT's AI wrote it (and the person never edited it). No id, no name and no word of
   *  the letter: they stay in the worker's memory, and the bytes travel only over the resume port. */
  coverLetter?: { aiWritten: boolean; text?: string };
}
