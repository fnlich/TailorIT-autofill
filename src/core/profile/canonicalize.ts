/*
 * canonicalizeProfile (docs/design/core.md §2.7, docs/ARCHITECTURE.md "Building the profile"): TailorIT's two wire
 * parts in, the canonical Profile out, entities rather than strings (Requirement A). The worker runs it once per
 * profile fetch, over data its zod schemas have already validated; it is pure, never guesses, and its issues carry a
 * path and a code, never a value. Phase 1's canonicalizers do the entity work: institutions (by id, then name, then
 * the entry's location), degrees, fields of study (CIP), countries and regions.
 *
 * The sensitive part maps tri-state: not provided becomes absent (the question is left blank and flagged), declined
 * becomes {kind: 'decline'} (the form's decline option, else blank), and a value becomes {kind: 'value'}. An answer
 * holding anything outside its closed list is absent as a whole, never a subset, so the field stays blank. Without the
 * sensitive part every one of those answers is absent and sensitiveState is 'not-loaded'; only the worker knows
 * 'not-shared' (a 403).
 *
 * The wire profile names the resume only by id, or not at all ("TailorIT's best match for each job"), so `resume` is
 * left absent here: the worker attaches the file it will upload, the lookup's suggestedResume, with attachResume.
 *
 * A phone number's calling code is read with the E.164 table (callingCodes.ts), with or without spaces
 * ("+15125550147"), and its country comes from that code; the address decides only among the countries that share it,
 * or when the number has no code (the review, CORE-7 and CORE-18).
 */
import type { AutofillProfile, AutofillResumeChoice, AutofillSensitive, SensitiveAnswer } from '../../contract/tailorit';
import { GENDERS, PROFICIENCIES, RACES, WORK_STATUSES, type Gender, type Race, type WorkStatus } from '../enums';
import type {
  EducationEntry, ExperienceEntry, Explicit, PlaceRef, Profile, Salary, SensitiveState, StartDate, WorkAuthorization,
  YearMonth, Ymd,
} from '../types/profile';
import { resolveText } from '../vocab/lookup';
import type { LanguageEntity, ReferralEntity, Vocab } from '../vocab/types';
import { callingCodeOf, CALLING_CODES } from './callingCodes';
import { canonicalDegree } from './degreeParse';
import {
  canonicalCountry, canonicalField, canonicalInstitution, canonicalRegion, type CanonicalizeIssue,
  type CanonicalizeIssueCode,
} from './entities';

/** canonicalizeProfile's answer. */
export interface CanonicalizeResult {
  profile: Profile;
  issues: CanonicalizeIssue[];
  /** 'loaded' when the sensitive part was given, else 'not-loaded'. Only the worker knows 'not-shared' (a 403). */
  sensitiveState: SensitiveState;
}

/** Spaces collapsed and trimmed. */
const tidy = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** A year and maybe a month from "2021" or "2021-09"; undefined for null or a malformed text. */
function yearMonth(text: string | null): YearMonth | undefined | 'invalid' {
  if (text === null || text.trim() === '') return undefined;
  const match = /^(\d{4})(?:-(\d{2}))?$/.exec(text.trim());
  if (!match) return 'invalid';
  const y = Number(match[1]);
  if (match[2] === undefined) return { y };
  const m = Number(match[2]);
  return m >= 1 && m <= 12 ? { y, m } : 'invalid';
}

/** A calendar date from "2026-12-01"; undefined for null, 'invalid' for a malformed one or a day that does not exist. */
function calendarDate(text: string | null): Ymd | undefined | 'invalid' {
  if (text === null) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) return 'invalid';
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return m >= 1 && m <= 12 && d >= 1 && d <= days[m - 1]! ? { y, m, d } : 'invalid';
}

/** Whether a year and maybe a month lie after `now`: a later year, or this year and a later month. */
function isAfter(date: YearMonth, now: Ymd): boolean {
  return date.y > now.y || (date.y === now.y && date.m !== undefined && date.m > now.m);
}

/** "City, ST" in the US and Canada, "City, Region, Country" elsewhere, from the parts that are known; '' for none. */
export function placeText(place: { city?: string; region?: { code?: string; name: string }; country?: string },
  vocab: Vocab): string {
  const region = place.region ? place.region.code ?? place.region.name : undefined;
  const northAmerica = place.country === 'US' || place.country === 'CA';
  const countryName = place.country && !northAmerica
    ? vocab.countries.byAlpha2(place.country)?.name ?? place.country : undefined;
  return [place.city, region, countryName].filter((part): part is string => part !== undefined && part !== '')
    .join(', ');
}

/** The issues met while building one profile, and the helpers that record them. */
class Issues {
  readonly list: CanonicalizeIssue[] = [];
  add(path: string, code: CanonicalizeIssueCode): void {
    this.list.push({ path, code });
  }
  take<T>(result: { value: T; issues: CanonicalizeIssue[] }): T {
    this.list.push(...result.issues);
    return result.value;
  }
}

/** A tri-state answer (§2.7): not provided is absent, declined is a decline, and a value is kept when `check` accepts
 *  it, else absent as a whole with the issue `code`. */
function explicit<T, U>(answer: SensitiveAnswer<T>, path: string, issues: Issues, convert: (value: T) => U | null,
  code: CanonicalizeIssueCode = 'value-unknown'): Explicit<U> | undefined {
  if (answer.state === 'not_provided') return undefined;
  if (answer.state === 'declined') return { kind: 'decline' };
  const value = convert(answer.value);
  if (value === null) {
    issues.add(path, code);
    return undefined;
  }
  return { kind: 'value', value };
}

const inList = <T extends string>(list: readonly T[], value: string): value is T => (list as readonly string[]).includes(value);

/** A place from the wire's city, region and country, the region read within its country. */
function placeOf(place: { city: string; region: string; country: string | null }, path: string, issues: Issues,
  vocab: Vocab): PlaceRef | undefined {
  const city = tidy(place.city);
  const country = place.country === null ? undefined : issues.take(canonicalCountry(place.country, vocab,
    `${path}.country`)) || undefined;
  const region = tidy(place.region) === '' ? undefined
    : issues.take(canonicalRegion(place.region, country, vocab, `${path}.region`));
  if (city === '' && region === undefined && country === undefined) return undefined;
  const parts = { ...(city !== '' ? { city } : {}), ...(region ? { region } : {}), ...(country ? { country } : {}) };
  return { text: placeText(parts, vocab), ...parts };
}

/** One education entry. */
function educationOf(entry: AutofillProfile['education'][number], index: number, issues: Issues, vocab: Vocab,
  now: Ymd): EducationEntry {
  const path = `education[${index}]`;
  const { location } = entry;
  const institution = issues.take(canonicalInstitution({
    name: entry.institution.canonicalName,
    aliases: entry.institution.aliases,
    ...(entry.institution.ids ? { ids: entry.institution.ids } : {}),
    location: { city: location.city, region: location.region, ...(location.country ? { country: location.country } : {}) },
  }, vocab, `${path}.institution`));
  const degree = issues.take(canonicalDegree({
    level: entry.degree.level,
    ...(tidy(entry.degree.type) !== '' ? { type: entry.degree.type } : {}),
    ...(tidy(entry.degree.field) !== '' ? { field: entry.degree.field } : {}),
    ...(entry.degree.cip ? { cip: entry.degree.cip } : {}),
  }, vocab, `${path}.degree`));
  const minor = tidy(entry.minor) === '' ? undefined
    : issues.take(canonicalField({ text: entry.minor }, vocab, `${path}.minor`));
  const startDate = yearMonth(entry.startDate);
  const endDate = yearMonth(entry.endDate);
  if (startDate === 'invalid') issues.add(`${path}.startDate`, 'date-invalid');
  if (endDate === 'invalid') issues.add(`${path}.endDate`, 'date-invalid');
  const end = endDate === 'invalid' ? undefined : endDate;
  return {
    institution, degree,
    ...(minor ? { minor } : {}),
    ...(startDate && startDate !== 'invalid' ? { startDate } : {}),
    ...(end ? { endDate: end } : {}),
    inProgress: entry.current || (end !== undefined && isAfter(end, now)),
    ...(entry.gpa ? { gpa: { value: entry.gpa.value, scale: entry.gpa.scale } } : {}),
  };
}

/** One work entry. */
function experienceOf(entry: AutofillProfile['experience'][number], index: number, issues: Issues, vocab: Vocab):
  ExperienceEntry {
  const path = `experience[${index}]`;
  const location = placeOf(entry.location, `${path}.location`, issues, vocab);
  const startDate = yearMonth(entry.startDate);
  const endDate = yearMonth(entry.endDate);
  if (startDate === 'invalid') issues.add(`${path}.startDate`, 'date-invalid');
  if (endDate === 'invalid') issues.add(`${path}.endDate`, 'date-invalid');
  const description = entry.description.trim();
  return {
    company: tidy(entry.company), title: tidy(entry.title),
    ...(location ? { location } : {}),
    ...(startDate && startDate !== 'invalid' ? { startDate } : {}),
    // "I currently work here" leaves the end date alone.
    ...(endDate && endDate !== 'invalid' && !entry.current ? { endDate } : {}),
    current: entry.current,
    ...(description !== '' ? { description } : {}),
  };
}

/** The work authorization rows of the sensitive part, one per country. */
function workAuthorizationOf(rows: AutofillSensitive['workAuthorization'], issues: Issues): WorkAuthorization[] {
  return rows.map((row, index) => {
    const path = `workAuthorization[${index}]`;
    const bool = (value: boolean) => value;
    const authorized = explicit(row.authorized, `${path}.authorized`, issues, bool);
    const sponsorshipNow = explicit(row.sponsorshipNow, `${path}.sponsorshipNow`, issues, bool);
    const sponsorshipFuture = explicit(row.sponsorshipFuture, `${path}.sponsorshipFuture`, issues, bool);
    const status = explicit(row.status, `${path}.status`, issues,
      (value: string): WorkStatus | null => (inList(WORK_STATUSES, value) ? value : null));
    return {
      country: row.country,
      ...(authorized ? { authorized } : {}),
      ...(sponsorshipNow ? { sponsorshipNow } : {}),
      ...(sponsorshipFuture ? { sponsorshipFuture } : {}),
      ...(status ? { status } : {}),
    };
  });
}

/** The self-identification answers of the sensitive part (§2.7): each absent as a whole when it holds an unknown
 *  value. */
function eeoOf(eeo: AutofillSensitive['eeo'], issues: Issues): Profile['eeo'] {
  const code = 'eeo-value-unknown';
  const gender = explicit(eeo.gender, 'eeo.gender', issues, (value): { identity: Gender; selfDescribed?: string } | null => {
    if (!inList(GENDERS, value.identity)) return null;
    const words = tidy(value.selfDescribed);
    return value.identity === 'self-describe' && words !== '' ? { identity: value.identity, selfDescribed: words }
      : { identity: value.identity };
  }, code);
  const hispanicLatino = explicit(eeo.hispanicOrLatino, 'eeo.hispanicLatino', issues, (value: boolean) => value, code);
  const race = explicit(eeo.races, 'eeo.race', issues, (value: string[]): Race[] | null => {
    const races = [...new Set(value)];
    return races.length > 0 && races.every((item) => inList(RACES, item)) ? races as Race[] : null;
  }, code);
  const veteran = explicit(eeo.veteran, 'eeo.veteran', issues, (value) => (value.isProtectedVeteran && !value.isVeteran
    ? null : { veteran: value.isVeteran, protected: value.isProtectedVeteran }), code);
  const disability = explicit(eeo.disability, 'eeo.disability', issues, (value: boolean) => value, code);
  return {
    ...(gender ? { gender } : {}),
    ...(hispanicLatino ? { hispanicLatino } : {}),
    ...(race ? { race } : {}),
    ...(veteran ? { veteran } : {}),
    ...(disability ? { disability } : {}),
  };
}

/** When the person can start: an explicit date, else a notice period (none is "immediately"). */
function startDateOf(preferences: AutofillProfile['preferences'], issues: Issues): StartDate | undefined {
  const date = calendarDate(preferences.earliestStartDate);
  if (date === 'invalid') issues.add('preferences.startDate', 'date-invalid');
  else if (date !== undefined) return { kind: 'date', date };
  const weeks = preferences.noticePeriodWeeks;
  if (weeks === null) return undefined;
  return weeks === 0 ? { kind: 'immediately' } : { kind: 'notice', weeks };
}

/** "How did you hear about us": the referral vocabulary's id, else 'other' with the person's words. */
function referralOf(text: string, issues: Issues, vocab: Vocab): Profile['referralSource'] {
  const words = tidy(text);
  if (words === '') return undefined;
  const resolution = resolveText(vocab, 'referral', words);
  const entity = resolution.id === null ? undefined : vocab.entity(resolution.id);
  if (entity?.kind === 'referral') return { id: (entity as ReferralEntity).answerId };
  issues.add('referralSource', 'referral-not-in-vocab');
  return { id: 'other', otherText: words };
}

/** The languages, each with its code when the vocabulary knows its name. */
function languagesOf(languages: AutofillProfile['languages'], issues: Issues, vocab: Vocab): Profile['languages'] {
  return languages.map((entry, index) => {
    const name = tidy(entry.language);
    const resolution = resolveText(vocab, 'language', name);
    const entity = resolution.id === null ? undefined : vocab.entity(resolution.id);
    const code = entity?.kind === 'language' ? (entity as LanguageEntity).code : undefined;
    if (code === undefined) issues.add(`languages[${index}]`, 'language-not-in-vocab');
    const proficiency = entry.proficiency !== null && inList(PROFICIENCIES, entry.proficiency) ? entry.proficiency
      : undefined;
    if (entry.proficiency !== null && proficiency === undefined) issues.add(`languages[${index}].proficiency`, 'value-unknown');
    return { ...(code !== undefined ? { code } : {}), name, ...(proficiency ? { proficiency } : {}) };
  });
}

/** Each text once (compared without case), in order, empty ones left out. */
function distinct(texts: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of texts) {
    const text = tidy(raw);
    if (text === '' || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push(text);
  }
  return out;
}

/**
 * The phone's country (the review, CORE-7). A number with a calling code is the code's country: the one the phone or
 * the address names among the countries that share the code, else the code's only country. A country the phone names
 * that does not use the code, or a shared code that neither the phone nor the address settles while the address names
 * another country ("+1 ..." with an address in Britain), gives none, with an issue, so the phone's country field is
 * left blank and flagged. A number with no code takes the phone's own country, else the address's.
 */
function phoneCountryOf(code: string | undefined, own: string | undefined, address: string | undefined,
  issues: Issues): string | undefined {
  if (code === undefined) return own ?? address;
  const sharing = CALLING_CODES[code]!;
  if (own !== undefined && sharing.includes(own)) return own;
  if (own === undefined && address !== undefined && sharing.includes(address)) return address;
  if (own === undefined && sharing.length === 1) return sharing[0];
  if (own !== undefined || address !== undefined) issues.add('contact.phone.country', 'phone-country-mismatch');
  return undefined;
}

/** TailorIT's two wire parts in, the canonical Profile out (§2.7). */
export function canonicalizeProfile(profile: AutofillProfile, sensitive: AutofillSensitive | null, vocab: Vocab,
  now: Ymd): CanonicalizeResult {
  const issues = new Issues();
  const { name, contact, links, preferences } = profile;
  const first = tidy(name.first);
  const middle = tidy(name.middle);
  const last = tidy(name.last);
  const suffix = tidy(name.suffix);
  const preferred = tidy(name.preferred);
  const pronouns = sensitive ? explicit(sensitive.eeo.pronouns, 'identity.pronouns', issues,
    (value: string) => (tidy(value) === '' ? null : tidy(value))) : undefined;

  const { address: wireAddress } = contact;
  const addressCountry = wireAddress.country === null ? undefined
    : issues.take(canonicalCountry(wireAddress.country, vocab, 'address.country')) || undefined;

  const phoneText = tidy(contact.phone.number);
  const callingCode = phoneText === '' ? undefined : callingCodeOf(phoneText);
  const phoneCountry = phoneText === '' ? undefined
    : phoneCountryOf(callingCode, contact.phone.country ?? undefined, addressCountry, issues);
  const phone = phoneText === '' ? undefined : {
    text: phoneText, digits: phoneText.replace(/\D/g, ''),
    ...(callingCode !== undefined ? { countryCallingCode: callingCode } : {}),
    ...(phoneCountry ? { country: phoneCountry } : {}),
  };
  const addressRegion = tidy(wireAddress.region) === '' ? undefined
    : issues.take(canonicalRegion(wireAddress.region, addressCountry, vocab, 'address.region'));
  const addressParts = {
    ...(tidy(wireAddress.line1) !== '' ? { line1: tidy(wireAddress.line1) } : {}),
    ...(tidy(wireAddress.line2) !== '' ? { line2: tidy(wireAddress.line2) } : {}),
    ...(tidy(wireAddress.city) !== '' ? { city: tidy(wireAddress.city) } : {}),
    ...(addressRegion ? { region: addressRegion } : {}),
    ...(tidy(wireAddress.postalCode) !== '' ? { postalCode: tidy(wireAddress.postalCode) } : {}),
    ...(addressCountry ? { country: addressCountry } : {}),
  };
  const link = (url: string) => (url.trim() === '' ? undefined : url.trim());
  const linkedin = link(links.linkedin);
  const github = link(links.github);
  const portfolio = link(links.portfolio);
  const website = link(links.website);

  const salary = sensitive ? explicit(sensitive.compensation.expectedSalary, 'preferences.expectedSalary', issues,
    (value): Salary => ({ min: value.min, ...(value.max !== null ? { max: value.max } : {}), currency: value.currency,
      period: value.period })) : undefined;
  const startDate = startDateOf(preferences, issues);
  const relocation: Explicit<boolean> | undefined = preferences.willingToRelocate === null ? undefined
    : { kind: 'value', value: preferences.willingToRelocate === 'yes' };
  const arrangements = [...new Set(preferences.workArrangements)];
  const referralSource = referralOf(preferences.referralSource, issues, vocab);
  const over18 = sensitive ? explicit(sensitive.legal.atLeast18, 'screening.over18', issues, (value: boolean) => value)
    : undefined;
  // Version 2: an older copy of the sensitive part has no criminal record, which reads as not provided.
  const criminalRecord = sensitive?.legal.criminalRecord === undefined ? undefined
    : explicit(sensitive.legal.criminalRecord, 'screening.criminalRecord', issues, (value: boolean) => value);
  const travel = preferences.travelPercent;

  const canonical: Profile = {
    identity: {
      fullName: [first, middle, last, suffix].filter((part) => part !== '').join(' '),
      firstName: first,
      ...(middle !== '' ? { middleName: middle } : {}),
      lastName: last,
      ...(preferred !== '' ? { preferredName: preferred } : {}),
      ...(pronouns ? { pronouns } : {}),
      nameSplitDerived: false,
    },
    contact: { email: tidy(contact.email), ...(phone ? { phone } : {}) },
    ...(Object.keys(addressParts).length > 0 ? { address: addressParts } : {}),
    links: {
      ...(linkedin ? { linkedin } : {}), ...(github ? { github } : {}), ...(portfolio ? { portfolio } : {}),
      ...(website ? { website } : {}),
      other: links.other.filter((item) => item.url.trim() !== '').map((item) => ({ label: tidy(item.label),
        url: item.url.trim() })),
    },
    workAuthorization: sensitive ? workAuthorizationOf(sensitive.workAuthorization, issues) : [],
    eeo: sensitive ? eeoOf(sensitive.eeo, issues) : {},
    screening: { ...(over18 ? { over18 } : {}), ...(criminalRecord ? { criminalRecord } : {}) },
    education: profile.education.map((entry, index) => educationOf(entry, index, issues, vocab, now)),
    experience: profile.experience.map((entry, index) => experienceOf(entry, index, issues, vocab)),
    languages: languagesOf(profile.languages, issues, vocab),
    skills: distinct(profile.skills),
    preferences: {
      ...(salary ? { expectedSalary: salary } : {}),
      ...(startDate ? { startDate } : {}),
      ...(relocation ? { relocation } : {}),
      ...(arrangements.length > 0 ? { workArrangements: arrangements } : {}),
      ...(typeof travel === 'number' && Number.isInteger(travel) && travel >= 0 && travel <= 100
        ? { travelPercent: travel } : {}),
    },
    ...(referralSource ? { referralSource } : {}),
  };
  return { profile: canonical, issues: issues.list, sensitiveState: sensitive ? 'loaded' : 'not-loaded' };
}

/** The MIME type of each file kind TailorIT sends (the contract's AUTOFILL_FILE_MIME_TYPES, which the core may not
 *  import at run time; a test checks they are equal). */
export const RESUME_MIME_TYPES: Readonly<Record<AutofillResumeChoice['fileKind'], string>> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
};

/** The name a file is uploaded under: no path or control characters, the kind's extension, at most 255 characters;
 *  `fallback` when nothing is left (a resume's 'Resume', a cover letter's 'Cover Letter'). The worker's file transfer
 *  names the file it sends so (background/resume-transfer.ts), and the planner reads the person's résumé under that
 *  name among the files a page shows (core/plan/frame.ts showsResume). */
export function uploadName(fileName: string, kind: 'pdf' | 'docx', fallback = 'Resume'): string {
  const extension = `.${kind}`;
  let base = fileName.replace(/[\p{Cc}\p{Cf}\\/:*?"<>|]+/gu, ' ').replace(/\s+/g, ' ').trim();
  if (base.toLowerCase().endsWith(extension)) base = base.slice(0, -extension.length).trim();
  base = base.replace(/[. ]+$/, '');
  return `${(base || fallback).slice(0, 255 - extension.length)}${extension}`;
}

/** The profile with the resume the worker will upload: the lookup's suggestedResume. Its size is the file
 *  transfer's to give (0 until then). A null choice leaves the profile without a resume, so an upload field is
 *  flagged. */
export function attachResume(profile: Profile, choice: Pick<AutofillResumeChoice, 'id' | 'fileName' | 'fileKind'> | null,
  sizeBytes = 0): Profile {
  if (choice === null) {
    const { resume: _dropped, ...rest } = profile;
    return rest;
  }
  return { ...profile, resume: { id: choice.id, fileName: choice.fileName, mime: RESUME_MIME_TYPES[choice.fileKind],
    sizeBytes } };
}

/** The profile with the run's cover letter (Phase G) when the worker holds it ready to upload, as the Guard checks an
 *  upload's origin against it (profile path `coverLetter`); without it otherwise, so a cover-letter upload is never
 *  planned for a letter that is not there. Whether TailorIT's AI wrote it, and (v3 Phase 3b) its words when a
 *  cover-letter text box asked for them (profile path `coverLetter.text`): never an id. */
export function withCoverLetter(profile: Profile, letter: { state: string; aiWritten?: boolean; text?: string }
  | undefined): Profile {
  const { coverLetter: _dropped, ...rest } = profile;
  if (letter?.state !== 'ready') return rest;
  return { ...rest, coverLetter: { aiWritten: letter.aiWritten === true,
    ...(typeof letter.text === 'string' && letter.text.trim() !== '' ? { text: letter.text } : {}) } };
}
