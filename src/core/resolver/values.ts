/*
 * The values (docs/design/core.md §8.5): what the profile holds for each category, in every shape it can be written
 * (candidate.ts), with its origin and how sure it is. Explicit values are 1; a deterministic layout or composition
 * (a phone laid out for the field, "City, ST", the highest completed degree) 0.97; a derived figure (years from the
 * entries, a start date from a notice period) 0.85.
 * - Education and work fields use the entry of their block in a repeatable section, else the most recent entry (the
 *   profile lists them most recent first); the current-employer fields use the current entry, else the most recent.
 *   A block's entry is the one the plan assigned it (ValueContext.blockEntries, steps/blocks.ts: a block the site
 *   prefilled with an entry is filled from that entry), else the block's place; a block the plan assigned no entry
 *   gets none (Phase 5).
 * - "I currently work here" is ticked only for a current entry; such an entry's end date is not filled.
 * - Several values (skills, languages, races, work arrangements) are a set for a list that takes several, joined for a
 *   text box, and for a list that takes one answer only when there is exactly one.
 * - EEO, legal and consent values are policy.ts's; the classes with no profile value (free text, unknown) get one only
 *   from a saved answer (saved.ts).
 */
import { VALUE_DERIVED, VALUE_EXPLICIT, VALUE_TRANSFORM } from '../confidence';
import type { FieldKind } from '../enums';
import {
  intendedCountry, intendedDegree, intendedEntity, intendedField, intendedInstitution, intendedRegion, intendedText,
  intendedUnknown,
} from '../matcher/intended';
import type { PlaceParts } from '../matcher/place';
import { DEGREE_LEVEL_RANK } from '../profile/degreeParse';
import { placeText } from '../profile/canonicalize';
import { normalize } from '../text/normalize';
import type { FieldSpec } from '../types/field';
import type { FieldCategory, ProfilePath, RuleId, ValueOrigin } from '../types/intent';
import type { EducationEntry, ExperienceEntry, Profile, YearMonth, Ymd } from '../types/profile';
import type { RepeatableKind } from '../types/run';
import type { Vocab } from '../vocab/types';
import { none, value, type Choice, type ValueResult } from './candidate';
import { phoneText } from './format';

/** The profile entry each block of a repeatable section is filled from, by block index (null: no entry), for the
 *  sections the plan assigned (steps/blocks.ts). */
export type BlockEntries = Readonly<Partial<Record<RepeatableKind, readonly (number | null)[]>>>;

/** What the value table reads besides the profile. */
export interface ValueContext {
  spec: FieldSpec;
  profile: Profile;
  vocab: Vocab;
  now: Ymd;
  /** The form has its own control for the phone's country code in this field's section. */
  separatePhoneCountry: boolean;
  /** The entry each assigned block is filled from; a section absent here uses each block's place. */
  blockEntries?: BlockEntries;
}

const path = (text: string) => text as ProfilePath;
const fromProfile = (at: string, transform?: RuleId): ValueOrigin => (transform === undefined
  ? { provenance: 'profile', path: path(at) } : { provenance: 'profile', path: path(at), transform });
const byRule = (ruleId: RuleId, at: string): ValueOrigin => ({ provenance: 'rule', ruleId, path: path(at) });

/** A text value: typed into a box, or matched as text against a list. */
function textValue(text: string | undefined, at: string, confidence = VALUE_EXPLICIT, transform?: RuleId): ValueResult {
  const trimmed = text?.trim() ?? '';
  if (trimmed === '') return none('no-profile-value', false);
  return value({ origin: fromProfile(at, transform), confidence, text: trimmed,
    choice: { intended: intendedText(trimmed), domain: 'generic' } });
}

/** A place: typed into a box, or chosen from a list of places by its parts (Choice.place: a location search's "Austin,
 *  Texas, United States" for the person's "Austin, TX"). */
function placeValue(place: (PlaceParts & { text?: string }) | undefined, at: string, confidence = VALUE_EXPLICIT,
  transform?: RuleId): ValueResult {
  const found = textValue(place?.text, at, confidence, transform);
  if (place?.city === undefined || !found.ok || found.candidate.choice === undefined) return found;
  const parts: PlaceParts = { city: place.city, ...(place.region ? { region: place.region } : {}),
    ...(place.country ? { country: place.country } : {}) };
  return value({ ...found.candidate, choice: { ...found.candidate.choice, place: parts } });
}

/** The kinds that take several answers. */
const SEVERAL: readonly FieldKind[] = ['checkbox-group', 'multiselect'];

/** Several values as a set, joined for a text box, and one answer for a list only when there is exactly one. */
function manyValues(choices: readonly Choice[], texts: readonly string[], at: string, spec: FieldSpec,
  separator = ', '): ValueResult {
  if (choices.length === 0) return none('no-profile-value', false);
  const single = choices.length === 1 ? choices[0] : undefined;
  if (!SEVERAL.includes(spec.kind) && spec.kind !== 'text' && spec.kind !== 'textarea' && single === undefined) {
    return none('ambiguous-options');
  }
  return value({ origin: fromProfile(at), confidence: VALUE_EXPLICIT, set: [...choices], text: texts.join(separator),
    ...(single ? { choice: single } : {}) });
}

/** The entry a block of `kind` is filled from: the plan's assignment when the section has one (null: none, also for
 *  a block past it), else the block's place; null when the profile has no such entry. */
function blockEntry(spec: FieldSpec, block: number, kind: RepeatableKind, count: number,
  blockEntries: BlockEntries | undefined): number | null {
  const assigned = spec.section.id === kind ? blockEntries?.[kind] : undefined;
  if (assigned === undefined) return block < count ? block : null;
  const entry = assigned[block];
  return entry === undefined || entry === null || entry >= count ? null : entry;
}

/** The index of the entry a field is about: its block's in a repeatable section, else the first `preferred` one,
 *  else the most recent (index 0); null when there is no such entry. */
function entryIndex<T>(spec: FieldSpec, entries: readonly T[], kind: RepeatableKind,
  blockEntries: BlockEntries | undefined, preferred?: (entry: T) => boolean): number | null {
  const block = spec.section.block;
  if (block !== undefined) return blockEntry(spec, block, kind, entries.length, blockEntries);
  if (entries.length === 0) return null;
  if (preferred) {
    const at = entries.findIndex(preferred);
    if (at >= 0) return at;
  }
  return 0;
}

/** The months between two year-months (the start's month to the end's), a missing month read as January. */
const monthsOf = (date: YearMonth) => date.y * 12 + ((date.m ?? 1) - 1);

/** Years of experience from the entries, overlaps counted once; null when no entry has a usable span. */
export function yearsOfExperience(entries: readonly ExperienceEntry[], now: Ymd): number | null {
  const spans = entries.flatMap((entry) => {
    if (entry.startDate === undefined) return [];
    const end = entry.current ? { y: now.y, m: now.m } : entry.endDate;
    if (end === undefined) return [];
    const from = monthsOf(entry.startDate);
    const to = monthsOf(end);
    return to > from ? [[from, to] as const] : [];
  }).sort((a, b) => a[0] - b[0]);
  if (spans.length === 0) return null;
  let total = 0;
  let [start, end] = spans[0]!;
  for (const [from, to] of spans.slice(1)) {
    if (from <= end) end = Math.max(end, to);
    else {
      total += end - start;
      [start, end] = [from, to];
    }
  }
  total += end - start;
  return total / 12;
}

/** Days since 1970-01-01 of a calendar date, and back (Howard Hinnant's civil algorithms): date arithmetic without
 *  Date, which reads the clock. */
function daysFromCivil({ y, m, d }: Ymd): number {
  const year = m <= 2 ? y - 1 : y;
  const era = Math.floor(year / 400);
  const yoe = year - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
function civilFromDays(days: number): Ymd {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

/** `now` plus some weeks. */
export function addWeeks(now: Ymd, weeks: number): Ymd {
  return civilFromDays(daysFromCivil(now) + weeks * 7);
}

/** The highest completed education entry (education.highest-completed), the most recent of equals; null for none. */
function highestCompleted(entries: readonly EducationEntry[]): number | null {
  let best: number | null = null;
  entries.forEach((entry, index) => {
    if (entry.inProgress) return;
    if (best === null || DEGREE_LEVEL_RANK[entry.degree.level] > DEGREE_LEVEL_RANK[entries[best]!.degree.level]) {
      best = index;
    }
  });
  return best;
}

/** An education entry's degree in its shapes. */
function degreeValue(entry: EducationEntry, at: string, vocab: Vocab, transform?: RuleId): ValueResult {
  const intended = intendedDegree(entry.degree, vocab);
  if (intended.kind !== 'degree' || (entry.degree.level === 'other' && entry.degree.type === undefined)) {
    return none('no-profile-value', false);
  }
  const choice: Choice = { intended, domain: 'degree', ...(entry.degree.field ? { degreeField: entry.degree.field } : {}) };
  return value({ origin: fromProfile(at, transform), confidence: transform === undefined ? VALUE_EXPLICIT : VALUE_TRANSFORM,
    text: intended.display, choice });
}

/** The work arrangements as a form names them. */
const ARRANGEMENT_TEXT: Readonly<Record<string, string>> = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site' };

/** The period a pay question names, if any. */
function payPeriodNamed(text: string): 'year' | 'month' | 'hour' | null {
  if (/\b(?:hour|hourly|per\s+hour|an\s+hour|hr)\b/i.test(text)) return 'hour';
  if (/\b(?:month|monthly|per\s+month|a\s+month)\b/i.test(text)) return 'month';
  if (/\b(?:annual|annually|annum|yearly|year|per\s+year|a\s+year)\b/i.test(text)) return 'year';
  return null;
}

/** The currencies a dollar sign or the word "dollars" may mean. */
const DOLLAR_CURRENCIES = ['USD', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD', 'TWD', 'MXN', 'ARS', 'CLP', 'COP', 'UYU', 'JMD',
  'TTD', 'BSD', 'BBD', 'BZD', 'BMD', 'KYD', 'XCD', 'FJD', 'NAD', 'LRD', 'GYD', 'SRD', 'BND'] as const;
/** How pay questions name a currency, the most specific first, each with the ISO codes it may mean: a marker found is
 *  taken out of the text, so "US$" is not read again as a bare "$". A sign's letters ("C$", "A$") and the ISO codes
 *  count only in capitals and joined to the sign ("as a $ amount" names no Australian dollars; "CAD" is never the word
 *  "cad"); a currency's name counts in any case. */
const CURRENCY_MARKERS: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/\bUS ?\$/g, ['USD']],
  [/\bCA?N?\$/g, ['CAD']],
  [/\bAU?\$/g, ['AUD']],
  [/\bNZ\$/g, ['NZD']],
  [/\bSG?\$/g, ['SGD']],
  [/\bHK\$/g, ['HKD']],
  [/\bR\$/g, ['BRL']],
  [/\bMX\$/g, ['MXN']],
  [/\bU\.?\s?S\.?\s+dollars?\b|\bamerican\s+dollars?\b/gi, ['USD']],
  [/\bcanadian\s+dollars?\b/gi, ['CAD']],
  [/\baustralian\s+dollars?\b/gi, ['AUD']],
  [/\bnew\s+zealand\s+dollars?\b/gi, ['NZD']],
  [/\bsingapore\s+dollars?\b/gi, ['SGD']],
  [/\bhong\s+kong\s+dollars?\b/gi, ['HKD']],
  [/\bbrazilian\s+reais\b/gi, ['BRL']],
  [/\bmexican\s+pesos?\b/gi, ['MXN']],
  [/\$|\bdollars?\b/gi, DOLLAR_CURRENCIES],
  [/\u{00A3}|\bpounds?\s+sterling\b|\bsterling\b|\bpounds?\b/giu, ['GBP']],
  [/\u{20AC}|\beuros?\b/giu, ['EUR']],
  [/\u{20B9}|\brupees?\b|\blakhs?\b|\blacs?\b|\blpa\b|\bcrores?\b/giu, ['INR', 'PKR', 'LKR', 'NPR', 'BDT']],
  [/\u{00A5}|\byen\b/giu, ['JPY', 'CNY']],
  [/\byuan\b|\brenminbi\b|\bRMB\b/gi, ['CNY']],
  [/\u{20A9}/gu, ['KRW']],
  [/\u{20AA}|\bshekels?\b/giu, ['ILS']],
  [/\u{20B1}/gu, ['PHP']],
  [/\u{20BA}|\blira\b/giu, ['TRY']],
  [/\u{20BD}|\broubles?\b|\brubles?\b/giu, ['RUB']],
  [/\bz\u{0142}|\bzloty\b/giu, ['PLN']],
  [/\bswiss\s+francs?\b/gi, ['CHF']],
  [/\bkronor\b|\bkrona\b/gi, ['SEK', 'ISK']],
  [/\bkroner\b|\bkrone\b/gi, ['NOK', 'DKK']],
  [/\bpesos?\b/gi, ['MXN', 'ARS', 'CLP', 'COP', 'PHP', 'UYU', 'DOP']],
  [/\b(?:USD|EUR|GBP|CAD|AUD|NZD|CHF|JPY|CNY|HKD|SGD|INR|SEK|NOK|DKK|ISK|PLN|CZK|HUF|RON|BGN|ILS|AED|SAR|QAR|KWD|BRL|MXN|ARS|CLP|COP|PEN|ZAR|NGN|KES|EGP|KRW|TWD|THB|MYR|IDR|PHP|VND|TRY|RUB|UAH|PKR|BDT|LKR|NPR)\b/g, []],
];

/** The currencies a pay question names, as ISO codes; empty when it names none. */
function currenciesNamed(text: string): Set<string> {
  const named = new Set<string>();
  let rest = text;
  for (const [marker, codes] of CURRENCY_MARKERS) {
    rest = rest.replace(marker, (found) => {
      for (const code of codes.length > 0 ? codes : [found]) named.add(code);
      return ' ';
    });
  }
  return named;
}

/** A pay question that asks in a scale other than units: thousands ("in thousands", "(k)", "$K", "e.g. 120k", "000s"),
 *  millions, lakhs or crores. 401(k) is no scale. */
const PAY_SCALE = /\bin\s+(?:thousands|millions|k)\b|\bthousands\b|\bmillions?\b|\blakhs?\b|\blacs?\b|\blpa\b|\bcrores?\b|\(\s*k\s*\)|[$\u{00A3}\u{20AC}\u{20B9}\u{00A5}]\s?k\b|\b(?!401k\b)\d+(?:[.,]\d+)?\s?k\b|(?:\b|')000'?s\b/iu;

/** The profile's language entry a proficiency question is about: the one its label names, else its block's, else the
 *  only one. */
function languageAsked(spec: FieldSpec, languages: Profile['languages'], blockEntries: BlockEntries | undefined):
  number | null {
  const words = ` ${normalize(`${spec.label} ${spec.description}`, 'answer').key} `;
  const named = languages.flatMap((language, index) => {
    const key = normalize(language.name, 'answer').key;
    return key !== '' && words.includes(` ${key} `) ? [index] : [];
  });
  if (named.length === 1) return named[0]!;
  if (named.length > 1) return null;
  const block = spec.section.block;
  if (block !== undefined) return blockEntry(spec, block, 'language', languages.length, blockEntries);
  return languages.length === 1 ? 0 : null;
}

/** A language as a choice: its vocabulary entity when its code is known, else its name. */
function languageChoice(language: Profile['languages'][number], vocab: Vocab): Choice {
  const entity = language.code === undefined ? undefined : vocab.languages.byCode(language.code);
  const intended = entity ? intendedEntity(vocab, 'language', entity, language.name)
    : intendedUnknown('language', language.name, [], vocab);
  return { intended, domain: 'language' };
}

/** The value of a category the profile answers directly (§8.5): identity, contact, address, links, education, work,
 *  languages, skills, availability, preferences, referral, pay and pronouns, and the resume. */
export function profileValue(category: FieldCategory, ctx: ValueContext): ValueResult {
  const { spec, profile, vocab, now } = ctx;
  const { identity, contact, links } = profile;
  const address = profile.address;
  switch (category) {
    case 'identity.fullName':
      return textValue(identity.fullName, 'identity.fullName');
    case 'identity.firstName':
      return textValue(identity.firstName, 'identity.firstName');
    case 'identity.middleName':
      return textValue(identity.middleName, 'identity.middleName');
    case 'identity.lastName':
      return textValue(identity.lastName, 'identity.lastName');
    case 'identity.preferredName':
      // TailorIT's profile reads an empty preferred name as "the same as the first name".
      return identity.preferredName ? textValue(identity.preferredName, 'identity.preferredName')
        : textValue(identity.firstName, 'identity.firstName');
    case 'identity.pronouns': {
      const pronouns = identity.pronouns;
      if (pronouns === undefined) return none('no-profile-value');
      if (pronouns.kind === 'decline') {
        return value({ origin: fromProfile('identity.pronouns'), confidence: VALUE_EXPLICIT,
          choice: { intended: { kind: 'decline', domain: 'generic' }, domain: 'generic' } });
      }
      return textValue(pronouns.value, 'identity.pronouns');
    }
    case 'contact.email':
      return textValue(contact.email, 'contact.email');
    case 'contact.phone': {
      const phone = contact.phone;
      if (phone === undefined) return none('no-profile-value', false);
      const text = phoneText(phone, spec.constraints, ctx.separatePhoneCountry);
      return text === phone.text ? textValue(text, 'contact.phone')
        : textValue(text, 'contact.phone', VALUE_TRANSFORM, 'phone.format');
    }
    case 'contact.phoneCountry': {
      const phone = contact.phone;
      if (phone?.country === undefined && phone?.countryCallingCode === undefined) return none('no-profile-value', false);
      const choice = phone.country !== undefined
        ? { intended: intendedCountry(phone.country, phone.country, vocab), domain: 'country' as const } : undefined;
      return value({ origin: fromProfile('contact.phone'), confidence: VALUE_EXPLICIT,
        ...(phone.countryCallingCode !== undefined ? { text: `+${phone.countryCallingCode}` } : {}),
        ...(choice ? { choice } : {}) });
    }
    case 'address.line1':
      return textValue(address?.line1, 'address.line1');
    case 'address.line2':
      return textValue(address?.line2, 'address.line2');
    case 'address.city':
      return textValue(address?.city, 'address.city');
    case 'address.postalCode':
      return textValue(address?.postalCode, 'address.postalCode');
    case 'address.region': {
      const region = address?.region;
      if (region === undefined) return none('no-profile-value', false);
      return value({ origin: fromProfile('address.region'), confidence: VALUE_EXPLICIT, text: region.code ?? region.name,
        choice: { intended: intendedRegion(region, address?.country, region.code ?? region.name, vocab),
          domain: 'region' } });
    }
    case 'address.country': {
      const country = address?.country;
      if (country === undefined) return none('no-profile-value', false);
      const name = vocab.countries.byAlpha2(country)?.name ?? country;
      return value({ origin: fromProfile('address.country'), confidence: VALUE_EXPLICIT, text: name,
        choice: { intended: intendedCountry(country, country, vocab), domain: 'country' } });
    }
    case 'location.current': {
      if (address?.city === undefined) return none('no-profile-value', false);
      return placeValue({ ...address, text: placeText(address, vocab) }, 'address', VALUE_TRANSFORM, 'location.compose');
    }
    case 'links.linkedin':
      return textValue(links.linkedin, 'links.linkedin');
    case 'links.github':
      return textValue(links.github, 'links.github');
    case 'links.portfolio':
      return textValue(links.portfolio, 'links.portfolio');
    case 'links.website':
      return textValue(links.website, 'links.website');
    case 'links.other': {
      if (links.other.length === 1) return textValue(links.other[0]!.url, 'links.other[0].url');
      if (links.other.length > 1 && spec.kind === 'textarea') {
        return textValue(links.other.map((link) => link.url).join('\n'), 'links.other');
      }
      return none(links.other.length === 0 ? 'no-profile-value' : 'ambiguous-options', links.other.length > 1);
    }
    case 'education.school':
    case 'education.degree':
    case 'education.field':
    case 'education.minor':
    case 'education.startDate':
    case 'education.endDate':
    case 'education.gpa':
      return educationValue(category, ctx);
    case 'education.highestLevel': {
      const index = highestCompleted(profile.education);
      if (index === null) return none('no-profile-value', false);
      return degreeValue(profile.education[index]!, `education[${index}].degree`, vocab, 'education.highest-completed');
    }
    case 'experience.company':
    case 'experience.title':
    case 'experience.location':
    case 'experience.startDate':
    case 'experience.endDate':
    case 'experience.current':
    case 'experience.description':
    case 'experience.currentCompany':
    case 'experience.currentTitle':
      return experienceValue(category, ctx);
    case 'experience.totalYears': {
      const years = yearsOfExperience(profile.experience, now);
      if (years === null) return none('no-profile-value', false);
      return value({ origin: byRule('years.from-experience', 'experience'), confidence: VALUE_DERIVED,
        text: String(Math.floor(years)),
        choice: { intended: { kind: 'number', value: years, unit: 'years' }, domain: 'number' } });
    }
    case 'languages.language': {
      const languages = profile.languages;
      const block = spec.section.block;
      if (block !== undefined) {
        const entry = blockEntry(spec, block, 'language', languages.length, ctx.blockEntries);
        const language = entry === null ? undefined : languages[entry];
        return language === undefined ? none('no-profile-value', false)
          : value({ origin: fromProfile(`languages[${entry}]`), confidence: VALUE_EXPLICIT, text: language.name,
            choice: languageChoice(language, vocab) });
      }
      return manyValues(languages.map((language) => languageChoice(language, vocab)),
        languages.map((language) => language.name), 'languages', spec);
    }
    case 'languages.proficiency': {
      const index = languageAsked(spec, profile.languages, ctx.blockEntries);
      const proficiency = index === null ? undefined : profile.languages[index]!.proficiency;
      if (index === null || proficiency === undefined) return none('no-profile-value', false);
      const entity = vocab.entity(`prof:${proficiency}`);
      if (!entity) return none('no-profile-value', false);
      return value({ origin: fromProfile(`languages[${index}].proficiency`), confidence: VALUE_EXPLICIT,
        text: entity.name, choice: { intended: intendedEntity(vocab, 'proficiency', entity), domain: 'proficiency' } });
    }
    case 'skills.list':
      return manyValues(profile.skills.map((skill) => ({ intended: intendedText(skill), domain: 'generic' as const })),
        profile.skills, 'skills', spec);
    case 'salary.expected': {
      const salary = profile.preferences.expectedSalary;
      if (salary === undefined) return none('no-profile-value');
      if (salary.kind === 'decline') {
        return value({ origin: fromProfile('preferences.expectedSalary'), confidence: VALUE_EXPLICIT,
          choice: { intended: { kind: 'decline', domain: 'generic' }, domain: 'generic' } });
      }
      // The question's period, currency and scale must be the person's: pay is never converted (the review, CORE-8).
      const question = `${spec.label} ${spec.description}`;
      const asked = payPeriodNamed(question);
      if (asked !== null && asked !== salary.value.period) return none('format-unsupported');
      const currencies = currenciesNamed(question);
      if (currencies.size > 0 && !currencies.has(salary.value.currency)) return none('format-unsupported');
      if (PAY_SCALE.test(question)) return none('format-unsupported');
      const { min, currency, period } = salary.value;
      return value({ origin: fromProfile('preferences.expectedSalary'), confidence: VALUE_EXPLICIT, text: String(min),
        choice: { intended: { kind: 'number', value: min, unit: `currency-${period}`, currency }, domain: 'number' } });
    }
    case 'salary.currency': {
      const salary = profile.preferences.expectedSalary;
      if (salary === undefined) return none('no-profile-value');
      if (salary.kind === 'decline') return none('no-profile-value');
      return textValue(salary.value.currency, 'preferences.expectedSalary');
    }
    case 'availability.startDate': {
      const start = profile.preferences.startDate;
      if (start === undefined) return none('no-profile-value', false);
      if (start.kind === 'date') {
        return value({ origin: fromProfile('preferences.startDate'), confidence: VALUE_EXPLICIT, date: start.date });
      }
      const date = start.kind === 'immediately' ? now : addWeeks(now, start.weeks);
      return value({ origin: byRule('availability.from-notice', 'preferences.startDate'), confidence: VALUE_DERIVED,
        date });
    }
    case 'availability.noticePeriod': {
      const start = profile.preferences.startDate;
      if (start === undefined || start.kind === 'date') return none('no-profile-value', false);
      const weeks = start.kind === 'immediately' ? 0 : start.weeks;
      return value({ origin: fromProfile('preferences.startDate'), confidence: VALUE_EXPLICIT,
        text: weeks === 1 ? '1 week' : `${weeks} weeks`,
        choice: { intended: { kind: 'number', value: weeks, unit: 'weeks' }, domain: 'number' } });
    }
    case 'preferences.relocation': {
      const relocation = profile.preferences.relocation;
      if (relocation === undefined || relocation.kind === 'decline') return none('no-profile-value', false);
      return value({ origin: fromProfile('preferences.relocation'), confidence: VALUE_EXPLICIT,
        choice: { intended: { kind: 'boolean', value: relocation.value }, domain: 'polarity' }, check: relocation.value });
    }
    case 'preferences.travel': {
      // How much the person will travel (TailorIT's travelPercent): a text box takes the share, a yes/no question or a
      // lone box whether it is any at all.
      const percent = profile.preferences.travelPercent;
      if (percent === undefined) return none('no-profile-value', false);
      const willing = percent > 0;
      return value({ origin: fromProfile('preferences.travelPercent'), confidence: VALUE_EXPLICIT, text: `${percent}%`,
        choice: { intended: { kind: 'boolean', value: willing }, domain: 'polarity' }, check: willing });
    }
    case 'preferences.workArrangement': {
      const texts = (profile.preferences.workArrangements ?? []).map((arrangement) => ARRANGEMENT_TEXT[arrangement]!);
      if (spec.kind === 'checkbox') return none('format-unsupported');
      return manyValues(texts.map((text) => ({ intended: intendedText(text), domain: 'generic' as const })), texts,
        'preferences.workArrangements', spec);
    }
    case 'referral.source': {
      const source = profile.referralSource;
      if (source === undefined) return none('no-profile-value', false);
      if (source.id === 'other') {
        const text = source.otherText ?? '';
        return text === '' ? none('no-profile-value', false) : value({ origin: fromProfile('referralSource'),
          confidence: VALUE_EXPLICIT, text, choice: { intended: intendedUnknown('referral', text, [], vocab),
            domain: 'referral' } });
      }
      const entity = vocab.entity(`ref:${source.id}`);
      if (!entity) return none('no-profile-value', false);
      return value({ origin: fromProfile('referralSource'), confidence: VALUE_EXPLICIT, text: entity.name,
        choice: { intended: intendedEntity(vocab, 'referral', entity), domain: 'referral' } });
    }
    case 'file.resume':
      return profile.resume === undefined ? none('resume-unavailable')
        : value({ origin: fromProfile('resume'), confidence: VALUE_EXPLICIT, file: 'resume' });
    case 'file.coverLetter':
      // The run's cover letter (Phase G), once the worker has it ready (planFrame asks for it otherwise).
      return profile.coverLetter === undefined ? none('no-profile-value')
        : value({ origin: fromProfile('coverLetter'), confidence: VALUE_EXPLICIT, file: 'cover-letter' });
    case 'file.other':
      return none('no-profile-value');
    default:
      return none('no-profile-value', false);
  }
}

/** A company's name as two names are compared: folded, without its punctuation and its legal form ("Inc.", "LLC",
 *  "Ltd", "GmbH", "Corp", "AB"). */
function companyKey(name: string): string {
  return normalize(name, 'label').tokens
    .filter((token) => !/^(?:inc|incorporated|llc|llp|lp|ltd|limited|plc|gmbh|corp|corporation|co|company|sa|ag|bv|nv|ab|oy|aps|kg|pty|pte|sarl|sas|srl|spa)$/.test(token))
    .join(' ');
}

/** Words that point at the posting's own company: "this company", "our organization", "here", "a former employee".
 *  "us" counts only in lower case, as the page wrote it ("the US" is a country). */
const NAMES_THIS_COMPANY = /\b(?:this|our|the\s+same)\s+(?:company|organi[sz]ation|firm|business|employer|group)\b|\bhere\b|\b(?:former|ex|previous|past)\s+employees?\b|\bboomerang\b|\balumn(?:us|a|i|ae)\b/;
const US = /\bus\b/;

/** Whether a question names the posting's company (its companyKey's words, in order) or points at it ("here", "this
 *  company", "us", "former employee"). */
function namesPostingCompany(question: string, company: string): boolean {
  if (NAMES_THIS_COMPANY.test(question.toLowerCase()) || US.test(question)) return true;
  const name = company.split(' ').filter((token) => token !== '');
  const tokens = normalize(question, 'label').tokens;
  return name.length > 0 && tokens.some((_, at) => name.every((token, offset) => tokens[at + offset] === token));
}

/**
 * "Have you worked here before?" (rule screening.previously-employed): yes when an employer of the profile's is the
 * company the posting names (the lookup's company, compared by companyKey), else no. Only for a question that names
 * that company or points at it (namesPostingCompany): "Have you ever worked for a government agency?" or "at a
 * competitor of ours?" asks something else, which the AI answers, marked (the Phase E review, M3). Without the posting's
 * company it has no value. A deterministic rule over the profile's own entries (VALUE_TRANSFORM); it names no path,
 * since a profile with no employer answers no.
 */
export function previouslyEmployedValue(profile: Profile, postingCompany: string | undefined,
  question: string): ValueResult {
  const company = postingCompany === undefined ? '' : companyKey(postingCompany);
  if (company === '' || !namesPostingCompany(question, company)) return none('unknown-field', false);
  const worked = profile.experience.some((entry) => companyKey(entry.company) === company);
  return value({ origin: { provenance: 'rule', ruleId: 'screening.previously-employed' }, confidence: VALUE_TRANSFORM,
    choice: { intended: { kind: 'boolean', value: worked }, domain: 'polarity' }, check: worked });
}

/** The value of an education field: its entry's school, degree, field, minor, dates or GPA. */
function educationValue(category: FieldCategory, ctx: ValueContext): ValueResult {
  const { spec, profile, vocab } = ctx;
  const index = entryIndex(spec, profile.education, 'education', ctx.blockEntries);
  if (index === null) return none('no-profile-value', false);
  const entry = profile.education[index]!;
  const at = `education[${index}]`;
  switch (category) {
    case 'education.school': {
      const { institution } = entry;
      return value({ origin: fromProfile(`${at}.institution`), confidence: VALUE_EXPLICIT,
        text: institution.userText.trim() || institution.canonicalName,
        choice: { intended: intendedInstitution(institution, vocab), domain: 'institution' } });
    }
    case 'education.degree':
      return degreeValue(entry, `${at}.degree`, vocab);
    case 'education.field':
    case 'education.minor': {
      const field = category === 'education.field' ? entry.degree.field : entry.minor;
      if (field === undefined) return none('no-profile-value', false);
      return value({ origin: fromProfile(category === 'education.field' ? `${at}.degree.field` : `${at}.minor`),
        confidence: VALUE_EXPLICIT, text: field.userText.trim() || field.name,
        choice: { intended: intendedField(field, vocab), domain: 'field' } });
    }
    case 'education.startDate':
    case 'education.endDate': {
      const date = category === 'education.startDate' ? entry.startDate : entry.endDate;
      if (date === undefined) return none('no-profile-value', false);
      return value({ origin: fromProfile(`${at}.${category === 'education.startDate' ? 'startDate' : 'endDate'}`),
        confidence: VALUE_EXPLICIT, date });
    }
    case 'education.gpa':
      return entry.gpa === undefined ? none('no-profile-value', false) : textValue(String(entry.gpa.value), `${at}.gpa`);
    default:
      return none('no-profile-value', false);
  }
}

/** The value of a work field: its entry's employer, title, place, dates, "I currently work here" or description. */
function experienceValue(category: FieldCategory, ctx: ValueContext): ValueResult {
  const { spec, profile } = ctx;
  const current = category === 'experience.currentCompany' || category === 'experience.currentTitle';
  const index = entryIndex(spec, profile.experience, 'experience', ctx.blockEntries,
    current ? (entry) => entry.current : undefined);
  if (index === null) return none('no-profile-value', false);
  const entry = profile.experience[index]!;
  const at = `experience[${index}]`;
  switch (category) {
    case 'experience.company':
    case 'experience.currentCompany':
      return textValue(entry.company, `${at}.company`);
    case 'experience.title':
    case 'experience.currentTitle':
      return textValue(entry.title, `${at}.title`);
    case 'experience.location':
      return placeValue(entry.location, `${at}.location`);
    case 'experience.description':
      return textValue(entry.description, `${at}.description`);
    case 'experience.startDate':
      return entry.startDate === undefined ? none('no-profile-value', false)
        : value({ origin: fromProfile(`${at}.startDate`), confidence: VALUE_EXPLICIT, date: entry.startDate });
    case 'experience.endDate':
      if (entry.current) return none('end-date-not-applicable', false);
      return entry.endDate === undefined ? none('no-profile-value', false)
        : value({ origin: fromProfile(`${at}.endDate`), confidence: VALUE_EXPLICIT, date: entry.endDate });
    case 'experience.current':
      return value({ origin: byRule('experience.current-checkbox', `${at}.current`), confidence: VALUE_EXPLICIT,
        check: entry.current });
    default:
      return none('no-profile-value', false);
  }
}
