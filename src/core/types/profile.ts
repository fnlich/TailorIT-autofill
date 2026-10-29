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

export interface Profile {
  identity: {
    fullName: string;
    firstName: string;
    middleName?: string;
    lastName: string;
    preferredName?: string;
    pronouns?: Explicit<string>;
    /** First and last name were split from the full name, so the panel asks the person to check them. */
    nameSplitDerived: boolean;
  };
  contact: { email: string; phone?: { text: string; digits: string; countryCallingCode?: string; country?: string } };
  address?: { line1?: string; line2?: string; city?: string; region?: { code?: string; name: string };
    postalCode?: string; country?: string };
  links: { linkedin?: string; github?: string; portfolio?: string; website?: string;
    other: Array<{ label: string; url: string }> };
  workAuthorization: WorkAuthorization[];
  eeo: {
    /** 'self-describe' carries the person's own words, typed into the box the form's self-describe option reveals. */
    gender?: Explicit<{ identity: Gender; selfDescribed?: string }>;
    hispanicLatino?: Explicit<boolean>;
    race?: Explicit<Race[]>;
    veteran?: Explicit<{ veteran: boolean; protected: boolean }>;
    disability?: Explicit<boolean>;
  };
  screening: { over18?: Explicit<boolean> };
  education: EducationEntry[];
  experience: ExperienceEntry[];
  languages: Array<{ code?: string; name: string; proficiency?: Proficiency }>;
  skills: string[];
  preferences: {
    expectedSalary?: Explicit<Salary>;
    startDate?: StartDate;
    relocation?: Explicit<boolean>;
    workArrangements?: Array<'remote' | 'hybrid' | 'onsite'>;
  };
  /** "How did you hear about us": a referral-vocabulary id, or 'other' with text. */
  referralSource?: { id: string; otherText?: string };
  resume?: { id: string; fileName: string; mime: string; sizeBytes: number };
}
