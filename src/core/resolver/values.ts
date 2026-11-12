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
import { cutInjected } from '../guard/injected';
import { DEGREE_LEVEL_RANK } from '../profile/degreeParse';
import { placeText } from '../profile/canonicalize';
import { normalize, normalizeLabel } from '../text/normalize';
import type { FieldSpec, Option } from '../types/field';
import { COVER_LETTER_TEXT_PATH, type FieldCategory, type NoValuePlaceholder, type ProfilePath, type RuleId,
  type ValueOrigin } from '../types/intent';
import type { EducationEntry, ExperienceEntry, PhoneDeviceType, Profile, YearMonth, Ymd } from '../types/profile';
import type { RepeatableKind } from '../types/run';
import type { Vocab } from '../vocab/types';
import { none, value, type Choice, type ValueResult } from './candidate';
import { phoneText } from './format';
import { EMPLOYED_NOW, entryOf, EXPERIENCE_WITH, IN_TIME_ZONE, X_LINK, YEARS_IN } from './labelRules';
import { nameIdText } from './nameId';
import { US_TIME_ZONES, ZONE_SPELLINGS, zonesOfState, type UsTimeZone } from './usTimeZones';

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

/**
 * What `manyValues` joins a text box's several values with (jr6 RULES R0). A box that takes its answers one at a time
 * (a declared `tags` widget: Workday's Skills, UltiPro's review Skills) splits the planned text on it again and adds
 * each value (ENGINE's tags filler).
 */
export const MANY_SEPARATOR = ', ';

/** Several values as a set, joined for a text box, and one answer for a list only when there is exactly one. */
function manyValues(choices: readonly Choice[], texts: readonly string[], at: string, spec: FieldSpec,
  separator = MANY_SEPARATOR): ValueResult {
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
  // jr6 RULES (ICIMS-09, O7): a job's or a school's own block never takes the home address.
  if (HOME_PLACE_CATEGORIES.has(category) && entryOf(spec.section) !== null) return none('no-profile-value', false);
  const jr6 = jr6Value(category, ctx);
  if (jr6 !== undefined) return jr6;
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
    // s2 core-wd: Workday's My Information (the wd study §5).
    case 'contact.phoneType':
      return phoneTypeValue(contact.phone, vocab);
    case 'contact.phoneExtension':
      return textValue(contact.phone?.extension, 'contact.phone.extension');
    case 'identity.suffix':
      return suffixValue(identity.suffix, vocab);
    case 'identity.hasPreferredName':
      return hasPreferredNameValue(identity);
    // end s2 core-wd
    // jr6 RULES R3 (O2): a search's results that start with the street or the postal code, and name the city or the
    // state after it (Choice.street).
    case 'address.line1':
      return withStreet(textValue(address?.line1, 'address.line1'), address);
    case 'address.line2':
      return textValue(address?.line2, 'address.line2');
    // jr6 fix (REVC-3, RULES-SR2-CITY-RESULTS-UNASSIGNED): SmartRecruiters' City search (xplor-one-click,
    // jr6-wiser-one-click) words its results "City, State, Country": the city carries its place parts, so a list of
    // places is read by them (plan/frame.ts orPlace, matcher/place.ts matchPlace) where no option is the city alone.
    // The typed text stays the city (a search types it alone: resolve.ts searchPlace).
    case 'address.city':
      return placeValue(address?.city === undefined ? undefined : { city: address.city,
        ...(address.region ? { region: address.region } : {}), ...(address.country ? { country: address.country } : {}),
        text: address.city }, 'address.city');
    case 'address.postalCode':
      return withStreet(textValue(address?.postalCode, 'address.postalCode'), address);
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
      // s2 core-gh (decision 11): no website, the portfolio (never GitHub or LinkedIn).
      if ((links.website?.trim() ?? '') === '' && (links.portfolio?.trim() ?? '') !== '') {
        return textValue(links.portfolio, 'links.portfolio', VALUE_TRANSFORM, 'links.website-from-portfolio');
      }
      return textValue(links.website, 'links.website');
    // s2 core-gh (decision 9): X and Telegram, the link or its handle as the box asks.
    case 'links.twitter':
    case 'links.telegram':
      return handleLinkValue(category, spec, links);
    // s2 core-gh: texts composed from the profile's parts.
    case 'address.full':
    case 'skills.certifications':
    case 'preferences.relocationPlaces':
    case 'education.summary':
      return composedValue(category, ctx);
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
    case 'education.current':
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
      // s2 core-wd: the kind of source it is (the profile's category, else the vocabulary's first parent), chosen where
      // a list names no source of its own ("Job board" for Indeed) and typed as a search's reduced style.
      const kind = referralKind(source.category, source.id, vocab);
      if (source.id === 'other') {
        const text = source.otherText ?? '';
        return text === '' ? none('no-profile-value', false) : value({ origin: fromProfile('referralSource'),
          confidence: VALUE_EXPLICIT, text, choice: { intended: intendedUnknown('referral', text, [], vocab),
            domain: 'referral', ...(kind ? { fallback: kind } : {}) } });
      }
      const entity = vocab.entity(`ref:${source.id}`);
      if (!entity) return none('no-profile-value', false);
      return value({ origin: fromProfile('referralSource'), confidence: VALUE_EXPLICIT, text: entity.name,
        choice: { intended: intendedEntity(vocab, 'referral', entity), domain: 'referral',
          ...(kind ? { fallback: kind } : {}) } });
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
    case 'freeText.coverLetter': {
      // v3 Phase 3b: the run's cover letter as text, once the worker holds its words (planFrame waits for them).
      const text = profile.coverLetter?.text;
      return text === undefined ? none('no-profile-value', false)
        : value({ origin: fromProfile(COVER_LETTER_TEXT_PATH), confidence: VALUE_EXPLICIT, text });
    }
    default:
      return none('no-profile-value', false);
  }
}

// ── s2 core-gh ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Where X and Telegram links live, and what a handle there may be (X's 1 to 15, Telegram's 5 to 32 letters, digits or
 *  underscores). */
const HANDLE_LINKS: Readonly<Record<'links.twitter' | 'links.telegram', { host: RegExp; handle: RegExp;
  own: 'x' | 'telegram' }>> = {
  'links.twitter': { host: /^(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:#!\/)?@?([A-Za-z0-9_]+)\/?(?:[?#].*)?$/i,
    handle: /^[A-Za-z0-9_]{1,15}$/, own: 'x' },
  'links.telegram': { host: /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/@?([A-Za-z0-9_]+)\/?(?:[?#].*)?$/i,
    handle: /^[A-Za-z0-9_]{5,32}$/, own: 'telegram' },
};
/** A box that takes a handle rather than a link: its label or help text names a username or a handle, or shows "@",
 *  and no URL, link or profile address. */
const ASKS_HANDLE = /\b(?:user\s?names?|handles?)\b|@/i;
const ASKS_LINK = /\b(?:urls?|links?|web\s?address|profile\s+(?:url|link|address))\b|https?:/i;

/** The handle a stored link names (its path's first part), or the stored text itself when it is a bare handle
 *  ("@name", "name"); null when it is neither. */
function handleOf(link: string, form: (typeof HANDLE_LINKS)[keyof typeof HANDLE_LINKS]): string | null {
  const text = link.trim();
  const bare = text.replace(/^@/, '');
  if (form.handle.test(bare)) return bare;
  const found = form.host.exec(text)?.[1];
  return found !== undefined && form.handle.test(found) ? found : null;
}

/** The profile's X or Telegram link: its own (links.x, links.telegram), else the one link of links.other on that
 *  host; 'several' when links.other holds more than one there. */
function handleLinkOf(category: 'links.twitter' | 'links.telegram', links: Profile['links']):
  { text: string; at: string } | 'several' | null {
  const form = HANDLE_LINKS[category];
  const own = links[form.own]?.trim() ?? '';
  if (own !== '') return { text: own, at: `links.${form.own}` };
  const others = links.other.map((link, index) => ({ link, index }))
    .filter(({ link }) => form.host.test(link.url.trim()));
  if (others.length > 1) return 'several';
  return others.length === 1 ? { text: others[0]!.link.url.trim(), at: `links.other[${others[0]!.index}].url` } : null;
}

/**
 * s2 core-gh (decision 9): an X or Telegram field (screenshot 7 of 2026-11-07: "X username …", "Telegram username …")
 * from the profile's link (handleLinkOf). A box that asks for a username or a handle gets the bare handle
 * (link.handle), "@handle" only when its label or help text shows "@"; any other gets the link as stored. The s2 review
 * (C6): a box that names both ("Telegram/X username (If you don't have a profile, please type N/A)") takes Telegram,
 * then X, and only with neither the N/A its words ask for (resolve.ts).
 */
function handleLinkValue(category: 'links.twitter' | 'links.telegram', spec: FieldSpec, links: Profile['links']):
  ValueResult {
  const label = normalize(spec.label, 'label').key;
  const both = category === 'links.telegram' ? X_LINK.test(label) || /\btwitter\b/.test(label)
    : /\btelegram\b/.test(label);
  const order: Array<'links.twitter' | 'links.telegram'> = both ? ['links.telegram', 'links.twitter'] : [category];
  const tried = order.map((network) => ({ network, found: handleLinkOf(network, links) }));
  const chosen = tried.find(({ found }) => found !== null && found !== 'several');
  if (chosen === undefined) {
    const several = tried.some(({ found }) => found === 'several');
    return none(several ? 'ambiguous-options' : 'no-profile-value', several);
  }
  const found = chosen.found as { text: string; at: string };
  const asked = `${spec.label} ${spec.description}`;
  if (!ASKS_HANDLE.test(asked) || ASKS_LINK.test(asked)) return textValue(found.text, found.at);
  const handle = handleOf(found.text, HANDLE_LINKS[chosen.network]);
  if (handle === null) return none('format-unsupported');
  return textValue(asked.includes('@') ? `@${handle}` : handle, found.at, VALUE_TRANSFORM, 'link.handle');
}

/** What a certification question asks about after the word (s2 core-gh review, C4): "certifications in AWS" → ["aws"];
 *  [] for the generic question ("Do you hold any industry related certifications?"). */
const CERTIFICATION_TOPIC = /\bcertifications?\s+(?:in|for|related\s+to|relevant\s+to|with|on|from|such\s+as|like|including|covering)\s+(.+)$/;
/** Words a topic is read without. */
const TOPIC_FILLER = new Set(['the', 'a', 'an', 'any', 'of', 'and', 'or', 'your', 'our', 'this', 'that', 'such', 'as',
  'like', 'eg', 'e', 'g', 'etc', 'field', 'fields', 'area', 'areas', 'in', 'for', 'to', 'you', 'do', 'have', 'hold']);

function certificationTopic(question: string): string[] {
  const found = CERTIFICATION_TOPIC.exec(normalize(question, 'label').key)?.[1] ?? '';
  return found.split(' ').filter((word) => word.length > 1 && !TOPIC_FILLER.has(word));
}

/** An address's parts in one line: the street lines, the city, the region with the postcode, the country's name. */
function addressText(address: NonNullable<Profile['address']>, vocab: Vocab): string {
  const region = [address.region?.code ?? address.region?.name, address.postalCode].filter((part) => part).join(' ');
  const country = address.country === undefined ? undefined : vocab.countries.byAlpha2(address.country)?.name
    ?? address.country;
  return [address.line1, address.line2, address.city, region, country].map((part) => part?.trim() ?? '')
    .filter((part) => part !== '').join(', ');
}

/**
 * s2 core-gh: a text composed from the profile's parts (compose.text): a whole address in one box (its street and
 * city at least); the person's certifications, joined (a yes or no whether there is any); where they would relocate
 * to, joined for a box, chosen for a list; the education written out, one "School; Degree" line an entry. Nothing is
 * written when a part it needs is missing: an empty list is no answer.
 */
function composedValue(category: FieldCategory, ctx: ValueContext): ValueResult {
  const { spec, profile, vocab } = ctx;
  switch (category) {
    case 'address.full': {
      const address = profile.address;
      if (address?.line1 === undefined || address.city === undefined) return none('no-profile-value', false);
      return textValue(addressText(address, vocab), 'address', VALUE_TRANSFORM, 'compose.text');
    }
    case 'skills.certifications': {
      // s2 core-gh review (C4): the generic question takes them all; one about certifications in a field ("in cloud
      // computing", "related to project management") only those whose names hold its words. None matching, or none
      // stored, is no profile answer: the AI may answer it (ANSWERABLE_PROFILE_CATEGORIES), as before this round.
      const names = (profile.certifications ?? []).map((certification) => certification.name.trim())
        .filter((name) => name !== '');
      const topic = certificationTopic(`${spec.label} ${spec.description}`);
      const named = topic.length === 0 ? names : names.filter((name) => {
        const words = new Set(normalize(name, 'label').tokens);
        return topic.every((word) => words.has(word));
      });
      if (named.length === 0) return none('no-profile-value', false);
      return value({ origin: byRule('compose.text', 'certifications'), confidence: VALUE_TRANSFORM, text: named.join('; '),
        choice: { intended: { kind: 'boolean', value: true }, domain: 'polarity' }, check: true });
    }
    case 'preferences.relocationPlaces': {
      const places = (profile.preferences.relocationPlaces ?? []).map((place) => place.trim())
        .filter((place) => place !== '');
      if (places.length === 0) return none('no-profile-value', false);
      const choices = places.map((place): Choice => ({ intended: intendedText(place), domain: 'generic' }));
      return value({ origin: byRule('compose.text', 'preferences.relocationPlaces'), confidence: VALUE_TRANSFORM,
        text: places.join(', '), set: choices, ...(choices.length === 1 ? { choice: choices[0]! } : {}) });
    }
    case 'education.summary': {
      const lines = profile.education.map((entry) => {
        const school = entry.institution.userText.trim() || entry.institution.canonicalName;
        const degree = degreeValue(entry, 'education', vocab);
        return [school, degree.ok ? degree.candidate.text ?? '' : ''].filter((part) => part.trim() !== '').join('; ');
      }).filter((line) => line !== '');
      if (lines.length === 0) return none('no-profile-value', false);
      return value({ origin: byRule('compose.text', 'education'), confidence: VALUE_TRANSFORM,
        text: lines.join(spec.kind === 'textarea' ? '\n' : ' | ') });
    }
    default:
      return none('no-profile-value', false);
  }
}

/** s2 core-gh (decision 8): what a box is given when its own words tell an applicant without the answer to type a
 *  placeholder (types/intent.ts NO_VALUE_PLACEHOLDERS). The page's token only selects one: its characters are never
 *  copied. */
export { NO_VALUE_PLACEHOLDERS, type NoValuePlaceholder } from '../types/intent';

const QUOTE = String.raw`["'‘’“”]?`;
const DONT_HAVE = String.raw`(?:do\s*not|don'?t|dont)\s+have`;
const TYPE_VERB = String.raw`(?:type|write|enter|put|input|use|insert|mark|answer)`;
const TOKEN = String.raw`${QUOTE}(n\/a|na|none)${QUOTE}(?![\w/])`;
/** The instructions (screenshot 7 of 2026-11-07: "(If you don't have a profile, please type N/A)"), on the label or the
 *  help text folded to lower case with plain quotes: "if you don't have one, type N/A", "(N/A if none)", "type N/A if
 *  not applicable", "if none, write None". */
const PLACEHOLDER_INSTRUCTIONS: readonly RegExp[] = [
  new RegExp(String.raw`\bif\s+you\s+${DONT_HAVE}\s+(?:an?\s+|one\b|any\b)?[^.;)]{0,30}?[,)]?\s*(?:then\s+)?(?:please\s+)?${TYPE_VERB}\s+${TOKEN}`),
  new RegExp(String.raw`\bif\s+(?:none|not\s+applicable|n\/a)\s*,?\s*(?:then\s+)?(?:please\s+)?${TYPE_VERB}\s+${TOKEN}`),
  new RegExp(String.raw`\b${TYPE_VERB}\s+${TOKEN}\s+if\s+(?:none|not\s+applicable|you\s+${DONT_HAVE}\s+(?:one|any|an?\s+\w+))\b`),
  new RegExp(String.raw`\(\s*${TOKEN}\s+if\s+(?:none|not\s+applicable|you\s+${DONT_HAVE}\s+(?:one|any|an?\s+\w+))\s*\)`),
  // jr6 RULES (JV-15, fixtures ninjaone-step3: "If yes, please provide their name or enter N/A if you were not
  // referred."): "enter N/A if you were (or are, have, did) not …".
  new RegExp(String.raw`\b${TYPE_VERB}\s+${TOKEN}\s+if\s+you\s+(?:were|are|have|had|did|do)\s+(?:not|never)\b`),
];
const TOKEN_PLACEHOLDER: Readonly<Record<string, NoValuePlaceholder>> = { 'n/a': 'N/A', na: 'NA', none: 'None' };

/**
 * s2 core-gh (decision 8; the gh study's 2c.4): the placeholder a field's own words ask an applicant without the answer
 * to type ("Telegram username (If you don't have a profile, please type N/A)"), from NO_VALUE_PLACEHOLDERS, else null.
 * Only a visible label or its help text is read (a label nobody sees asks nothing). The tripwire, bot and attention
 * checks run before any value (resolve.ts classifyField): "If you are an AI, type N/A" never gets here.
 */
export function placeholderAsked(spec: Pick<FieldSpec, 'label' | 'description' | 'labelVisible'>): NoValuePlaceholder | null {
  const texts = [spec.labelVisible ? spec.label : '', spec.description];
  for (const raw of texts) {
    const text = raw.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ');
    for (const instruction of PLACEHOLDER_INSTRUCTIONS) {
      const token = instruction.exec(text)?.[1];
      if (token !== undefined) return TOKEN_PLACEHOLDER[token] ?? null;
    }
  }
  return null;
}

// s2 core-gh end
// s2 core-wd: a referral source's kind.

/** A referral source's kind as a choice of its own (Choice.fallback): the profile's referralSource.category (a
 *  referral-vocabulary id: 'job-board', 'social-media', ...), else the source's first parent in the vocabulary
 *  (LinkedIn: a job board); none for 'other', for the source itself, or for an id the vocabulary does not hold. */
function referralKind(category: string | undefined, sourceId: string, vocab: Vocab): Choice | undefined {
  const own = vocab.entity(`ref:${sourceId}`);
  const id = category !== undefined && category !== 'other' ? `ref:${category}`
    : own?.kind === 'referral' ? own.parents[0] : undefined;
  if (id === undefined || id === `ref:${sourceId}`) return undefined;
  const entity = vocab.entity(id);
  return entity?.kind === 'referral' ? { intended: intendedEntity(vocab, 'referral', entity), domain: 'referral' }
    : undefined;
}

/** A phone device type's words as lists write them (Workday's required "Phone Device Type", formField-phoneType in
 *  fixtures/workday/s2-exelixis-state-open; its options were never seen open, so the usual spellings), the first the
 *  one a text box takes. */
const PHONE_TYPE_WORDS: Readonly<Record<PhoneDeviceType, readonly [string, ...string[]]>> = {
  mobile: ['Mobile', 'Cell', 'Cellular', 'Mobile Phone', 'Cell Phone', 'Cellphone', 'Mobile/Cell', 'Personal Mobile'],
  home: ['Home', 'Landline', 'Land Line', 'Home Phone', 'Residence'],
  work: ['Work', 'Business', 'Office', 'Work Phone', 'Business Phone', 'Office Phone'],
};

/** The phone's device type (contact.phone.type); a phone without one is a mobile, decided (VALUE_DERIVED: filled and
 *  marked), since the question is required where it is asked and nearly every applicant gives a mobile. None without a
 *  phone. */
function phoneTypeValue(phone: Profile['contact']['phone'], vocab: Vocab): ValueResult {
  if (phone === undefined) return none('no-profile-value', false);
  const [first, ...rest] = PHONE_TYPE_WORDS[phone.type ?? 'mobile'];
  return value({ origin: fromProfile(phone.type === undefined ? 'contact.phone' : 'contact.phone.type'),
    confidence: phone.type === undefined ? VALUE_DERIVED : VALUE_EXPLICIT, text: first,
    choice: { intended: intendedUnknown('generic', first, rest, vocab), domain: 'generic' } });
}

/** A name's suffix (identity.suffix: "Jr.", "III"), typed as the person wrote it, or chosen from a list by it and its
 *  other spellings ("Jr" and "Junior" for "Jr."). */
function suffixValue(suffix: string | undefined, vocab: Vocab): ValueResult {
  const text = suffix?.trim() ?? '';
  if (text === '') return none('no-profile-value', false);
  const bare = text.replace(/\.$/, '');
  const spelled = SUFFIX_WORDS[bare.toLowerCase()] ?? [];
  return value({ origin: fromProfile('identity.suffix'), confidence: VALUE_EXPLICIT, text,
    choice: { intended: intendedUnknown('generic', text, [bare, `${bare}.`, ...spelled], vocab), domain: 'generic' } });
}

/** The spelled-out forms of the common suffixes. */
const SUFFIX_WORDS: Readonly<Record<string, readonly string[]>> = {
  jr: ['Junior'], sr: ['Senior'], ii: ['2nd', 'The Second'], iii: ['3rd', 'The Third'], iv: ['4th', 'The Fourth'],
};

/** "I have a preferred name" (Workday's formField-preferredCheck): ticked, or answered yes, only when the person's
 *  preferred name is set and is not their first name; otherwise nothing is written (the box stays as it is). */
function hasPreferredNameValue(identity: Profile['identity']): ValueResult {
  const preferred = identity.preferredName?.trim() ?? '';
  if (preferred === '' || preferred.toLowerCase() === identity.firstName.trim().toLowerCase()) {
    return none('no-profile-value', false);
  }
  return value({ origin: fromProfile('identity.preferredName'), confidence: VALUE_EXPLICIT, check: true,
    choice: { intended: { kind: 'boolean', value: true }, domain: 'polarity' } });
}

// end s2 core-wd

/** A company's name as two names are compared: folded, without its punctuation and its legal form ("Inc.", "LLC",
 *  "Ltd", "GmbH", "Corp", "AB"). */
export function companyKey(name: string): string {
  return normalize(name, 'label').tokens
    .filter((token) => !/^(?:inc|incorporated|llc|llp|lp|ltd|limited|plc|gmbh|corp|corporation|co|company|sa|ag|bv|nv|ab|oy|aps|kg|pty|pte|sarl|sas|srl|spa)$/.test(token))
    .join(' ');
}

/** Words that point at the posting's own company: "this company", "our organization", "here", "a former employee".
 *  "us" counts only in lower case, as the page wrote it ("the US" is a country). */
const NAMES_THIS_COMPANY = /\b(?:this|our|the\s+same)\s+(?:company|organi[sz]ation|firm|business|employer|group)\b|\bhere\b|\b(?:former|ex|previous|past)\s+employees?\b|\bboomerang\b|\balumn(?:us|a|i|ae)\b/;
const US = /\bus\b/;

/** jr6 RULES (WD-16, JV-12): the words a company's initials leave out ("Bank of America": "BOA" or "BA"). */
const INITIALS_SKIP = new Set(['of', 'and', 'the', 'for', 'at', 'de']);

/** jr6 RULES (WD-16: "RTS" for Resolve Tech Solutions, fixtures resolvetech-source-open; JV-12: "VHL" for Vista Higher
 *  Learning, fixtures jr6-vhl-step1; WD-17: "AEP" for American Electric Power): a company's initials, three letters or
 *  more, of a name of two words or more, every word's or the main words'. */
function initialsOf(company: string): string[] {
  const words = company.split(' ').filter((token) => token !== '');
  if (words.length < 2) return [];
  const every = words.map((word) => word[0]!).join('');
  const main = words.filter((word) => !INITIALS_SKIP.has(word)).map((word) => word[0]!).join('');
  return [...new Set([every, main])].filter((initials) => initials.length >= 3 && /^[a-z]+$/.test(initials));
}

/** Whether a question names the posting's company (its companyKey's words, in order) or points at it ("here", "this
 *  company", "us", "former employee"). jr6 RULES (WD-16, JV-12): or writes its initials in capitals ("Have you
 *  previously been employed by RTS?"). */
export function namesPostingCompany(question: string, company: string): boolean {
  if (NAMES_THIS_COMPANY.test(question.toLowerCase()) || US.test(question)) return true;
  const name = company.split(' ').filter((token) => token !== '');
  const tokens = normalize(question, 'label').tokens;
  if (name.length > 0 && tokens.some((_, at) => name.every((token, offset) => tokens[at + offset] === token))) {
    return true;
  }
  return initialsOf(company).some((initials) => new RegExp(String.raw`(?<![\p{L}\p{N}])${initials.toUpperCase()}`
    + String.raw`(?![\p{L}\p{N}])`, 'u').test(question));
}

/** jr6 RULES (WD-17, Workday's Genworth "Have you or your spouse previously worked for KPMG?"): a question that asks of
 *  someone else besides the person (a spouse, a partner, a relative): theirs (owner Q14), never answered by rule. */
const ALSO_ANOTHER = /\b(?:or|and)\s+(?:your|their|his|her)\s+(?:spouse|partner|husband|wife|family|relatives?|domestic\s+partner|immediate\s+family(?:\s+members?)?)\b|\bspouse\b/i;
/** jr6 RULES (WD-17): the employer a question names by its own capitals after the verb ("worked for KPMG", "a
 *  contractor at Acme Corp"), never an article or a pronoun ("a government agency", "any of our competitors"). */
const NAMED_EMPLOYER = /\b(?:[Ww]orked|[Ee]mployed|[Cc]ontractor|[Cc]ontracted|[Aa]ppointed|[Ii]nterned)\s+(?:[Bb]y|[Ff]or|[Aa]t|[Ww]ith)\s+(?:[Tt]he\s+)?(\p{Lu}[\p{L}\p{N}&.'\u2019-]*(?:\s+(?:\p{Lu}[\p{L}\p{N}&.'\u2019-]*|&|of|and))*)([^?.;]*)/u;
const NOT_A_NAME = /^(?:A|An|The|Any|Our|This|That|These|Those|Your|One|Another|Other|Some|Each|Either|Neither|Us|Me)$/;
/** jr6 RULES R3: a company a question sets aside ("outside of Twitch", "other than GitHub", "excluding …"), to the end
 *  of its clause. */
const SET_ASIDE = /\b(?:outside\s+of|other\s+than|excluding|except(?:\s+for)?|besides|not\s+including)\s+[^?.;,()]*/gi;
/** jr6 RULES (WD-17): companies a name does not settle: its subsidiaries, affiliates, parent or partners. */
const RELATED_COMPANIES = /\b(?:subsidiar(?:y|ies)|affiliat\w*|parent\s+compan\w*|sister\s+compan\w*|partners?|divisions?|brands?)\b/i;

/** jr6 RULES (WD-17): the one employer a question names, or null (none, a determiner, several: "Google, Meta or
 *  Amazon", or a name with its subsidiaries or affiliates, which the profile's entries do not settle). */
function namedEmployer(question: string): string | null {
  const found = NAMED_EMPLOYER.exec(question);
  if (found === null || RELATED_COMPANIES.test(question)) return null;
  const name = found[1]!.replace(/['\u2019]s$/, '').replace(/\s+(?:of|and|&)$/, '').trim();
  const first = name.split(/\s+/)[0]!;
  if (NOT_A_NAME.test(first)) return null;
  if (/(?:,|\bor\b|\band\b|\/)\s*(?:the\s+)?\p{Lu}/u.test(found[2]!)) return null;
  return name;
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
  // jr6 RULES (WD-17): a question that also asks of a spouse or a relative is theirs too (owner Q14).
  if (ALSO_ANOTHER.test(question)) return none('unknown-field', false);
  const company = postingCompany === undefined ? '' : companyKey(postingCompany);
  // s2 core-gh (s2-horacemann-certify-open question_20182378004): employed there now asks of the current entries only.
  const now = EMPLOYED_NOW.test(normalize(question, 'label').key);
  // jr6 RULES R3 (JV-13's neighbours: Twitch's "Are you a current employee with Amazon or any Amazon subsidiary (outside
  // of Twitch)?", fixtures/greenhouse/twitch-job; GitHub's "… at Microsoft or a Microsoft subsidiary other than
  // GitHub?", fixtures/icims/githubinc-candidate-questions.frame-1): a company the question sets aside is not the one it
  // asks about.
  const asked = question.replace(SET_ASIDE, ' ');
  if (company === '' || !namesPostingCompany(asked, company)) {
    // jr6 RULES (WD-17: "Have you previously worked for KPMG?" on Genworth's form): another employer the question
    // names is answered from the profile's entries too, Yes only for an entry of that employer, flagged for review.
    const other = namedEmployer(asked);
    const key = other === null ? '' : companyKey(other);
    if (key === '') return none('unknown-field', false);
    const there = profile.experience.some((entry) => (!now || entry.current) && companyKey(entry.company) === key);
    return value({ origin: { provenance: 'rule', ruleId: 'screening.previously-employed' }, confidence: VALUE_TRANSFORM,
      choice: { intended: { kind: 'boolean', value: there }, domain: 'polarity' }, check: there,
      flag: 'filled-low-confidence' });
  }
  const worked = profile.experience.some((entry) => (!now || entry.current) && companyKey(entry.company) === company);
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
    case 'education.current':
      // "Still Student?" (Ashby's Education block), as "I currently work here" is a job's: ticked for an entry the
      // person still studies at.
      return value({ origin: byRule('education.current-checkbox', `${at}.inProgress`), confidence: VALUE_EXPLICIT,
        check: entry.inProgress });
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

// ── jr6 RULES (FIXPLAN §6.3 R1): the values of the eight platform audits' categories ─────────────────────────────

/** ICIMS-09, O7: the home address's categories, which a job's or a school's own block never takes (labelRules
 *  entryOf): ClearCompany's and iCIMS's employer blocks hold an Address and a City of the employer's. */
const HOME_PLACE_CATEGORIES: ReadonlySet<FieldCategory> = new Set<FieldCategory>(['address.line1', 'address.line2',
  'address.city', 'address.region', 'address.postalCode', 'address.country', 'address.full', 'address.county',
  'address.lookup', 'location.current']);

/** A region as a place part: typed by its code (else its name), chosen in its country's list. */
function regionValue(region: { code?: string; name: string } | undefined, country: string | undefined, at: string,
  vocab: Vocab): ValueResult {
  if (region === undefined) return none('no-profile-value', false);
  const text = region.code ?? region.name;
  return value({ origin: fromProfile(at), confidence: VALUE_EXPLICIT, text,
    choice: { intended: intendedRegion(region, country, text, vocab), domain: 'region' } });
}

/** A country as a place part: typed by its name, chosen as a country. */
function countryValue(country: string | undefined, at: string, vocab: Vocab): ValueResult {
  if (country === undefined) return none('no-profile-value', false);
  return value({ origin: fromProfile(at), confidence: VALUE_EXPLICIT, text: vocab.countries.byAlpha2(country)?.name
    ?? country, choice: { intended: intendedCountry(country, country, vocab), domain: 'country' } });
}

/**
 * ICIMS-09, O7: a job's or a school's City, State/Region or Country, from that entry's own place (a job's location, a
 * school's institution), never the home address. A block the plan assigned no entry, or past the profile's entries,
 * gets nothing.
 */
function entryPlaceValue(category: FieldCategory, ctx: ValueContext): ValueResult {
  const { spec, profile, vocab } = ctx;
  const part = category.slice(category.indexOf('.') + 1);
  if (category.startsWith('experience.')) {
    const index = entryIndex(spec, profile.experience, 'experience', ctx.blockEntries);
    const place = index === null ? undefined : profile.experience[index]!.location;
    if (index === null || place === undefined) return none('no-profile-value', false);
    const at = `experience[${index}].location`;
    if (part === 'city') return textValue(place.city, `${at}.city`);
    if (part === 'region') return regionValue(place.region, place.country, `${at}.region`, vocab);
    return countryValue(place.country, `${at}.country`, vocab);
  }
  const index = entryIndex(spec, profile.education, 'education', ctx.blockEntries);
  if (index === null) return none('no-profile-value', false);
  const { institution } = profile.education[index]!;
  const at = `education[${index}].institution`;
  if (part === 'city') return textValue(institution.city, `${at}.city`);
  if (part === 'region') {
    const region = institution.region?.trim() ?? '';
    return region === '' ? none('no-profile-value', false) : regionValue({ ...(/^[A-Z]{2}$/.test(region)
      ? { code: region } : {}), name: region }, institution.country, `${at}.region`, vocab);
  }
  return countryValue(institution.country, `${at}.country`, vocab);
}

/** workday-new-1: a form's own language (Workday's disability form "Language", "Language of this form"): English, the
 *  language the rule read the label in, where the list offers it (form.language); never the person's languages. */
function formLanguageValue(spec: FieldSpec, vocab: Vocab): ValueResult {
  if (spec.options !== 'lazy' && !spec.options.some((option) => /^english\b/.test(normalizeLabel(option.label)))) {
    return none('no-match', false);
  }
  const english = vocab.languages.byCode('en');
  return value({ origin: { provenance: 'rule', ruleId: 'form.language' }, confidence: VALUE_TRANSFORM, text: 'English',
    choice: { intended: english ? intendedEntity(vocab, 'language', english, 'English')
      : intendedText('English'), domain: english ? 'language' : 'generic' } });
}

/** ICIMS-08: the other spellings of an address search's "Enter manually" option (Jobright's ./operations picks the
 *  result `#result-selectable_<id>_-2` "enter manually", cited as a fact). */
const ENTER_MANUALLY = ['Enter address manually', 'Enter it manually', 'Enter manually instead', 'Manual entry',
  'Enter manual address', 'Manually enter address'];

/** ICIMS-08: iCIMS's address search (its dropdown, name …PersonProfileFields.AddressStreet1): its "Enter manually" is
 *  chosen when the profile holds a street, which the box it reveals then takes as the street (address.line1); a street
 *  is never typed into the search itself. */
function addressLookupValue(profile: Profile, vocab: Vocab): ValueResult {
  if ((profile.address?.line1?.trim() ?? '') === '') return none('no-profile-value', false);
  return value({ origin: byRule('address.enter-manually', 'address.line1'), confidence: VALUE_TRANSFORM,
    choice: { intended: intendedUnknown('generic', 'Enter manually', ENTER_MANUALLY, vocab), domain: 'generic' } });
}

/** The words a county's name is written with or without ("Travis County", "Orleans Parish", "Nome Census Area"). */
const COUNTY_SUFFIX = /\s+(?:county|parish|borough|census\s+area|municipality|city\s+and\s+borough)$/i;

/**
 * JV-3, WD-26, ADP-14, O3: a county as a list chooses it, matched with or without its County, Parish, Borough or
 * Census Area ("Travis" and "Travis County" alike). The profile holds no county yet (owner question 13: a county
 * worked out once from the ZIP code, or a table here), so profileValue gives none: the question is skipped, and never
 * sent to an AI (address.county is no category an AI answers).
 */
export function countyChoice(county: string, vocab: Vocab): Choice {
  const base = county.trim().replace(COUNTY_SUFFIX, '');
  const spellings = [base, `${base} County`, `${base} Parish`, `${base} Borough`, `${base} Census Area`];
  return { intended: intendedUnknown('generic', county.trim(), spellings, vocab), domain: 'generic' };
}

/** JV-15, ADP-19, U-11: the referral sources that may name a person at the company (an employee's referral, a friend,
 *  a recruiter), and the person's own text, which no rule reads. */
const PERSON_SOURCES: ReadonlySet<string> = new Set(['employee-referral', 'friend', 'recruiter', 'other']);

/** JV-15, ADP-19, U-11: whether a current employee referred the person ("Were you referred to this role by a current
 *  NinjaOne employee?", "Did any of our employees inform you about this position?"): No when the profile's referral
 *  source is none that could name someone at the company (a job board, a site, an advertisement, …); otherwise, or
 *  with no source, nothing. */
function employeeReferredValue(profile: Profile): ValueResult {
  const source = profile.referralSource;
  if (source === undefined || PERSON_SOURCES.has(source.id)
    || (source.category !== undefined && PERSON_SOURCES.has(source.category))) return none('no-profile-value', false);
  return value({ origin: byRule('referral.not-employee', 'referralSource'), confidence: VALUE_TRANSFORM,
    choice: { intended: { kind: 'boolean', value: false }, domain: 'polarity' }, check: false });
}

/** JV-5: an option that states a qualification ("3. Experience with relational databases (such as PostgreSQL and
 *  MySQL)", "1. Associate or bachelor's degree …"): a sentence of three words or more about experience, a degree,
 *  years, knowledge or a skill. */
const QUALIFICATION = /\b(?:experience[ds]?|degrees?|years?|knowledge|familiar\w*|proficien\w*|certif\w*|background|skills?|understanding|ability|working)\b/;
/** The words each degree level is named by in a qualification. */
const DEGREE_WORDS: Readonly<Partial<Record<EducationEntry['degree']['level'], RegExp>>> = {
  highSchool: /\bhigh\s+school\b|\bged\b/,
  associate: /\bassociates?\s+(?:degree|of)\b|\bassociates?\b(?=.*\bdegree\b)/,
  bachelor: /\bbachelors?\b|\bbaccalaureate\b|\bundergraduate\s+degree\b/,
  master: /\bmasters?\b|\bgraduate\s+degree\b/,
  doctorate: /\bdoctorates?\b|\bdoctoral\b|\bph\s?d\b/,
  professional: /\b(?:mba|jd|md|professional\s+degree)\b/,
};

/** A whole word or phrase of the person's own in a text, whatever its case and its marks ("PostgreSQL", "C++"). */
function namesWhole(text: string, word: string): boolean {
  const escaped = word.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return escaped !== '' && new RegExp(String.raw`(?<![\p{L}\p{N}])${escaped}(?![\p{L}\p{N}+#])`, 'iu').test(text);
}

// jr6 fix (revD-02): what else a qualification states, each of which must hold before it is ticked.

/** A count of years ("10+ years of experience …", "at least 3 years", "3-5 years"), as normalizeLabel writes it (the
 *  least captured). */
const YEARS_STATED = /\b(\d{1,2})(?:\s+(?:to\s+)?\d{1,2})?\s+(?:or\s+more\s+|plus\s+)?years?\b/g;
/** A certification, a licence or a clearance an option names ("Active Certified Kubernetes Administrator (CKA)
 *  certification"). */
const CREDENTIAL = /\bcertif(?:ied|icates?|ications?)\b|\blicen[cs](?:e|ed|es|ure)\b|\bclearances?\b/;
/** An example clause ("(such as PostgreSQL and MySQL)", "e.g. Chef or Puppet", "including Go"): its items illustrate
 *  what stands before it, any one of which the person may hold. */
const EXAMPLES = /\(\s*(?:such\s+as|e\.?\s?g\.?|eg|including|includes|like|for\s+example|ex\.?)\b[^)]*\)|\b(?:such\s+as|e\.\s?g\.|including|for\s+example)\s+[^;.()]*/gi;
/** Where a list of tools stops and the claim around it goes on: the words that introduce what is held. */
const LIST_BREAK = /[;:.()]|\s(?:with|in|using|of|on|for|at|to|from|across|via|by|through)\s/;
/** The words an item of a list is written around, which name nothing held. */
const ITEM_FILLER = /\b(?:experience[ds]?|knowledge|familiarity|proficiency|expertise|skills?|background|understanding|working|hands|strong|solid|deep|good|excellent|basic|advanced|demonstrated|proven|professional|practical|technical|the|a|an|any|other|related|similar|tools?|technologies|technology|frameworks?|platforms?|languages?)\b/g;
/** A degree's field as an option names it ("degree in Computer Science or a related field", "BS in Accounting,
 *  Finance"), on the option's lower-cased text with its commas: the fields up to the clause's end. */
const DEGREE_FIELD = /\b(?:degree|diploma|bachelor(?:'|’)?s?|master(?:'|’)?s?|associate(?:'|’)?s?|doctorate|ph\.?\s?d\.?|b\.?\s?sc?\.?|b\.?\s?a\.?|m\.?\s?sc?\.?|m\.?\s?a\.?|mba)\s+(?:\([^)]*\)\s+)?(?:of\s+(?:science|arts)\s+)?in\s+([^;.()]+)/;
/** A field the option names that no profile value settles ("a related field", "a technical discipline", "STEM"). */
const GENERIC_FIELD = /\b(?:related|similar|relevant|equivalent|comparable|technical|quantitative|stem|other|any|applicable|appropriate)\b/;

/** The fields of study an option asks a degree in ("computer science" of "… degree in Computer Science or a related
 *  field"), as normalized words; [] when it names none, or only fields no profile value settles. */
function degreeFieldsAsked(label: string): string[] {
  const asked = DEGREE_FIELD.exec(label.toLowerCase())?.[1] ?? '';
  const parts: string[] = [];
  for (const part of asked.split(/\s*,\s*|\s+(?:or|and|&)\s+|\s*\/\s*/)) {
    // The fields end where the claim goes on ("… and 3 years of experience").
    if (/\d|\byears?\b|\bexperience\b/.test(part)) break;
    const key = normalizeLabel(part.replace(/^(?:a|an|the)\s+/, ''));
    if (key !== '' && !GENERIC_FIELD.test(key) && !/^(?:field|discipline|area|subject|major)s?$/.test(key)) parts.push(key);
  }
  return parts;
}

/** Whether one of the person's completed education entries is of a level the option names and in a field it names
 *  ("Bachelor's degree in Accounting, Finance or a related field" is no Computer Science graduate's); true when the
 *  option names neither. */
function degreeHolds(label: string, entries: readonly EducationEntry[]): boolean {
  const words = normalizeLabel(label);
  const levels = Object.entries(DEGREE_WORDS).filter(([, re]) => re.test(words)).map(([level]) => level);
  const parts = degreeFieldsAsked(label);
  if (levels.length === 0 && parts.length === 0) return true;
  const held = levels.length === 0 ? entries : entries.filter((entry) => levels.includes(entry.degree.level));
  if (held.length === 0) return false;
  if (parts.length === 0) return true;
  return held.some((entry) => {
    const field = entry.degree.field;
    const names = field === undefined ? [] : [field.name, field.userText, ...field.aliases].map((name) => normalizeLabel(name))
      .filter((name) => name !== '');
    return names.some((name) => parts.some((part) => namesWhole(name, part) || namesWhole(part, name)));
  });
}

/** Whether a count of years an option states holds: the person's experience reaches it in what it names, the skills
 *  it names (entries whose title or description names one) or the work it names after the count (entries whose titles
 *  name it, as the years-in rule reads them: titleNames); a count with nothing named after it needs the whole of the
 *  person's experience to reach it. */
function yearsHold(label: string, profile: Profile, skills: readonly string[], now: Ymd): boolean {
  const words = normalizeLabel(label);
  const counts = [...words.matchAll(YEARS_STATED)];
  if (counts.length === 0) return true;
  const total = yearsOfExperience(profile.experience, now);
  if (total === null) return false;
  return counts.every((count) => {
    const asked = Number(count[1]);
    if (total < asked) return false;
    const naming = profile.experience.filter((entry) => skills.some((skill) => namesWhole(entry.title, skill)
      || namesWhole(entry.description ?? '', skill)));
    if (skills.length > 0 && (yearsOfExperience(naming, now) ?? 0) >= asked) return true;
    const after = words.slice((count.index ?? 0) + count[0].length).split(/\s+(?:and|or|plus|with)\s+/)[0] ?? '';
    const subject = after.replace(ITEM_FILLER, ' ').split(' ')
      .filter((word) => word !== '' && !ROLE_FILLER.has(word) && !/^(?:of|in|as|on|at|for|running|building|developing|managing|using|leading|production|work|years?)$/.test(word));
    if (subject.length === 0) return skills.length === 0;
    return (yearsOfExperience(profile.experience.filter((entry) => titleNames(entry.title, subject)), now) ?? 0)
      >= asked;
  });
}

/** Whether a certification, licence or clearance an option names is one the person lists (never a clearance: the
 *  sensitive part is never read for a checklist). */
function credentialHolds(label: string, profile: Profile): boolean {
  const lower = label.toLowerCase();
  if (!CREDENTIAL.test(lower)) return true;
  if (/\bclearances?\b/.test(lower)) return false;
  return (profile.certifications ?? []).some((certification) => namesWhole(label, certification.name));
}

/** Whether every tool an option joins with "and" to one of the person's skills is held too ("Experience with
 *  Kubernetes and Terraform" is no Kubernetes user's alone); a list joined with "or" asks only one, and an example
 *  clause ("such as PostgreSQL and MySQL") illustrates, so its items are left out first. */
function listHolds(label: string, profile: Profile): boolean {
  const own = normalizeLabel([...profile.skills, ...profile.experience.flatMap((entry) => [entry.title,
    entry.description ?? ''])].join(' | '));
  const core = label.toLowerCase().replace(EXAMPLES, ' ');
  for (const segment of core.split(new RegExp(LIST_BREAK.source, 'g'))) {
    if (!profile.skills.some((skill) => namesWhole(segment, skill))) continue;
    if (/\bor\b|\band\s*\/\s*or\b/.test(segment) || !/\band\b|&/.test(segment)) continue;
    for (const item of segment.split(/\s*,\s*|\s+(?:and|&)\s+|\s*&\s*/)) {
      const words = normalizeLabel(item).replace(ITEM_FILLER, ' ').replace(/\s+/g, ' ').trim();
      if (words === '' || Object.values(DEGREE_WORDS).some((re) => re.test(words))) continue;
      if (!profile.skills.some((skill) => namesWhole(item, skill)) && !namesWhole(own, words)) return false;
    }
  }
  return true;
}

/**
 * JV-5 (VHL's "Please select the education, skills and/or experience that you currently possess", fixtures
 * jr6-vhl-step3-filled): a checkbox group (or a list that takes several) whose options are qualification sentences
 * ticks, flagged, only the options naming one of the person's skills, or a degree they hold, as a whole word; the rest
 * stays for the person (owner question 12: a multi-choice AI answer). Undefined for any other field (the skills are
 * then chosen as before); none when no option names one. jr6 fix (revD-02): a ticked box says "I currently possess
 * this", so an option is ticked only when nothing else it states is unmet: a count of years (yearsHold), a degree's
 * level and field (degreeHolds), a certification, licence or clearance (credentialHolds), and every tool joined with
 * "and" (listHolds).
 */
function qualificationsValue(spec: FieldSpec, profile: Profile, now: Ymd): ValueResult | undefined {
  if (!SEVERAL.includes(spec.kind) || spec.options === 'lazy') return undefined;
  const options = spec.options.filter((option) => !option.disabled && option.label.trim() !== '');
  const sentences = options.filter((option) => {
    const words = normalizeLabel(option.label);
    return words.split(' ').length >= 3 && QUALIFICATION.test(words);
  });
  if (options.length < 2 || sentences.length * 3 < options.length * 2) return undefined;
  const completed = profile.education.filter((entry) => !entry.inProgress);
  const levels = completed.map((entry) => DEGREE_WORDS[entry.degree.level]).filter((re): re is RegExp => re !== undefined);
  let skilled = false;
  const named = sentences.filter((option) => {
    const skills = profile.skills.filter((skill) => namesWhole(option.label, skill));
    const byLevel = levels.some((re) => re.test(normalizeLabel(option.label)));
    if (skills.length === 0 && !byLevel) return false;
    const holds = degreeHolds(option.label, completed) && yearsHold(option.label, profile, skills, now)
      && credentialHolds(option.label, profile) && listHolds(option.label, profile);
    skilled ||= holds && skills.length > 0;
    return holds;
  });
  if (named.length === 0) return none('no-profile-value', false);
  const set = named.map((option): Choice => ({ intended: intendedText(option.label.trim()), domain: 'generic' }));
  return value({ origin: byRule('skills.qualifications', skilled ? 'skills' : 'education'), confidence: VALUE_DERIVED,
    set, flag: 'filled-low-confidence', ...(set.length === 1 ? { choice: set[0]! } : {}) });
}

/** The value of a jr6 category, or undefined for a category the table above answers. */
function jr6Value(category: FieldCategory, ctx: ValueContext): ValueResult | undefined {
  switch (category) {
    // workday-new-1: an employer's own number for the person, which the profile never holds: skipped, never sent to
    // an AI (identity.employeeId is no category an AI answers).
    case 'identity.employeeId':
      return none('no-profile-value', false);
    case 'languages.formLanguage':
      return formLanguageValue(ctx.spec, ctx.vocab);
    case 'experience.city':
    case 'experience.region':
    case 'experience.country':
    case 'education.city':
    case 'education.region':
    case 'education.country':
      return entryPlaceValue(category, ctx);
    case 'address.lookup':
      return addressLookupValue(ctx.profile, ctx.vocab);
    // The profile holds no county yet (owner question 13; countyChoice).
    case 'address.county':
      return none('no-profile-value', false);
    case 'referral.employeeReferred':
      return employeeReferredValue(ctx.profile);
    case 'skills.list':
      return qualificationsValue(ctx.spec, ctx.profile, ctx.now);
    // jr6 RULES R3 (ICIMS-13, ICIMS-19, ICIMS-26, JV-16).
    case 'address.type':
      return addressTypeValue(ctx.spec, ctx.profile, ctx.vocab);
    case 'referral.detail':
      return profileValue('referral.source', ctx);
    case 'preferences.timeZone':
      return timeZoneValue(ctx.profile, ctx.vocab);
    case 'location.inTimeZone':
      return inTimeZoneValue(ctx.spec, ctx.profile);
    case 'experience.yearsIn':
      return yearsInValue(ctx.spec, ctx.profile, ctx.now);
    case 'skills.experienceWith':
      return experienceWithValue(ctx.spec, ctx.profile);
    // jr6 RULES R3 (U-11): a former name the profile never holds: left as the page has it, never asked of an AI.
    case 'identity.formerName':
      return none('no-profile-value', false);
    // jr6 RULES R3 (ADP-7): the pay's currency, by its ISO code in the list's own words.
    case 'salary.currency':
      return currencyValue(ctx.spec, ctx.profile);
    // jr6 RULES R4 (WD-25, ADP-14, JV-19): a prefix, an address's third line, a mailing address only where it differs:
    // the profile holds none of them, so they are left as the page has them, never asked of an AI.
    case 'identity.prefix':
    case 'address.line3':
    case 'address.mailing':
      return none('no-profile-value', false);
    // jr6 RULES R4 (ICIMS-25, ADP-16, ADP-18, ADP-20, SR-13, O13).
    case 'education.graduated':
      return graduatedValue(ctx);
    case 'salary.period':
      return payPeriodValue(ctx.profile, ctx.vocab);
    case 'application.resumeMethod':
      return resumeMethodValue(ctx.spec, ctx.profile);
    case 'education.highSchool':
      return highSchoolValue(ctx.profile);
    case 'links.facebook':
      return facebookValue(ctx.profile.links);
    case 'links.numbered':
      return numberedLinkValue(ctx.spec, ctx.profile.links);
    default:
      return undefined;
  }
}

// ── jr6 RULES R3 (FIXPLAN §6.3 items 35 to 48) ─────────────────────────────────────────────────────────────────────

/** A list's prompt rather than a choice ("— Make a Selection —", "Select…", "Please choose"). */
const PROMPT = /^[\s\-–—]*(?:select|make\s+a\s+selection|choose|please\s+(?:select|choose)|none\s+selected)\b/i;

/**
 * ICIMS-13 (iCIMS's address "Type": Work, Home, Other; required on Sentinel's and GitHub's profiles): a home address's
 * type, "Home", derived (address.type-home: the profile's address is the person's home), where the profile holds one.
 * A type the page already shows is kept (Jobright's getIcimsPreservedAddressTypeRules keeps a real preselected choice:
 * cited): prefill-kept.
 */
function addressTypeValue(spec: FieldSpec, profile: Profile, vocab: Vocab): ValueResult {
  if (profile.address === undefined) return none('no-profile-value', false);
  const shown = spec.current.kind === 'selected' ? spec.current.labels.filter((label) => label.trim() !== ''
    && !PROMPT.test(label)) : [];
  const chosen = spec.options !== 'lazy' && spec.options.some((option) => option.selected && option.label.trim() !== ''
    && !PROMPT.test(option.label)) && spec.kind !== 'select';
  if (shown.length > 0 || chosen) return none('prefill-kept', false);
  return value({ origin: byRule('address.type-home', 'address'), confidence: VALUE_DERIVED, text: 'Home',
    choice: { intended: intendedUnknown('generic', 'Home', ['Home Address', 'Residence', 'Residential', 'Primary Home'],
      vocab), domain: 'generic' } });
}

/** The person's US time zones (their state's), or null where the profile holds no US state. */
function personZones(profile: Profile): readonly UsTimeZone[] | null {
  const address = profile.address;
  const code = address?.region?.code;
  if (code === undefined || (address?.country !== undefined && address.country !== 'US')) return null;
  return zonesOfState(code);
}

/**
 * ICIMS-26 (ARS's required "Time Zone"): the person's time zone from their state (usTimeZones.ts, public facts):
 * location.time-zone, typed by its name or chosen by its spellings ("Central Time (US & Canada)", "CST", "US/Central");
 * flagged for a state that spans two zones. None without a US state. jr6 fix (RULES-R48-TZ): a state in one zone gives
 * it as a deterministic lookup (VALUE_TRANSFORM, as inTimeZoneValue's), so a search chooses its result; a state in two
 * stays a flagged derivation, which a search never chooses (blank beats wrong).
 */
function timeZoneValue(profile: Profile, vocab: Vocab): ValueResult {
  const zones = personZones(profile);
  if (zones === null || zones.length === 0) return none('no-profile-value', false);
  const [first, ...rest] = ZONE_SPELLINGS[zones[0]!];
  return value({ origin: byRule('location.time-zone', 'address.region'),
    confidence: zones.length > 1 ? VALUE_DERIVED : VALUE_TRANSFORM, text: first,
    choice: { intended: intendedUnknown('generic', first, rest, vocab), domain: 'generic' },
    ...(zones.length > 1 ? { flag: 'filled-low-confidence' as const } : {}) });
}

/**
 * JV-16 (VHL's "Question 9: Do you currently reside in a state located within the Eastern US Time Zone?"): yes when the
 * person's state keeps that zone (flagged for a state that spans two), no when it keeps none of it
 * (location.time-zone); nothing without a US state, or where the zone asked is only the state's smaller part.
 */
function inTimeZoneValue(spec: FieldSpec, profile: Profile): ValueResult {
  const asked = IN_TIME_ZONE.exec(questionKey(spec.label))?.[1] as UsTimeZone | undefined;
  const zones = personZones(profile);
  if (asked === undefined || !US_TIME_ZONES.includes(asked) || zones === null || zones.length === 0) {
    return none('no-profile-value', false);
  }
  if (zones.includes(asked) && zones[0] !== asked) return none('no-profile-value', false);
  const yes = zones[0] === asked;
  return value({ origin: byRule('location.time-zone', 'address.region'), confidence: VALUE_TRANSFORM,
    choice: { intended: { kind: 'boolean', value: yes }, domain: 'polarity' }, check: yes,
    ...(zones.length > 1 ? { flag: 'filled-low-confidence' as const } : {}) });
}

/** A question's label as the rules read it: normalized, a leading "Question N" set aside (classifyRules). */
function questionKey(label: string): string {
  return normalize(label, 'label').key.replace(/^question\s+\d+\s+/, '');
}

/** Words a role's or a field's name is written around ("in a DevOps role", "as an engineer", "in the field of"). */
const ROLE_FILLER = new Set(['a', 'an', 'the', 'role', 'roles', 'position', 'positions', 'capacity', 'field', 'fields',
  'of', 'or', 'and', 'similar', 'related', 'environment', 'industry', 'setting', 'professional', 'experience']);

/** Whether a job title names every word of what a question asks experience in ("Engineering" in "Senior Software
 *  Engineer", "management" in "Engineering Manager"): the same word, one starting the other (four letters at least), or
 *  the same first six letters. */
function titleNames(title: string, words: readonly string[]): boolean {
  const own = normalizeLabel(title).split(' ').filter((word) => word !== '');
  const alike = (word: string, titleWord: string) => word === titleWord
    || (Math.min(word.length, titleWord.length) >= 4 && (titleWord.startsWith(word) || word.startsWith(titleWord)))
    || (word.length >= 6 && titleWord.length >= 6 && word.slice(0, 6) === titleWord.slice(0, 6));
  return words.every((word) => own.some((titleWord) => alike(word, titleWord)));
}

/**
 * JV-16 (VHL's "Question 2: Do you have 10+ years of work experience in Engineering?"): N years of experience in or as
 * something, from the experience entries' durations (overlaps once: yearsOfExperience), flagged
 * (experience.years-in): yes when the entries whose titles name it reach N; no when all the person's experience falls
 * short of N; otherwise nothing (TailorIT's AI answers it: ANSWERABLE_PROFILE_CATEGORIES).
 */
function yearsInValue(spec: FieldSpec, profile: Profile, now: Ymd): ValueResult {
  const found = YEARS_IN.exec(questionKey(spec.label));
  if (found === null) return none('no-profile-value', false);
  const asked = Number(found[1]);
  const words = found[2]!.split(' ').filter((word) => word !== '' && !ROLE_FILLER.has(word));
  const total = yearsOfExperience(profile.experience, now);
  if (total === null) return none('no-profile-value', false);
  const named = words.length === 0 ? null
    : yearsOfExperience(profile.experience.filter((entry) => titleNames(entry.title, words)), now);
  const answer = named !== null && named >= asked ? true : total < asked ? false : null;
  if (answer === null) return none('no-profile-value', false);
  return value({ origin: byRule('experience.years-in', 'experience'), confidence: VALUE_DERIVED,
    choice: { intended: { kind: 'boolean', value: answer }, domain: 'polarity' }, check: answer,
    flag: 'filled-low-confidence' });
}

/**
 * JV-16 (VHL's "Question 4: Do you have experience with …?"): experience with a tool or a field, yes when the person's
 * skills, or an experience entry's title or description, name it as a whole word (each of "A and B"; any of "A, B or
 * C") (skills.experience-with); otherwise nothing, never a no (TailorIT's AI answers it).
 */
function experienceWithValue(spec: FieldSpec, profile: Profile): ValueResult {
  const found = EXPERIENCE_WITH.exec(questionKey(spec.label));
  if (found === null) return none('no-profile-value', false);
  const asked = found[1]!.replace(/^(?:a|an|the)\s+/, '').trim();
  const all = /\s+and\s+/.test(asked);
  const parts = asked.split(/\s+(?:and|or)\s+|\s*,\s*/).map((part) => part.replace(/^(?:a|an|the)\s+/, '').trim())
    .filter((part) => part !== '');
  const own = normalizeLabel([...profile.skills, ...profile.experience.flatMap((entry) => [entry.title,
    entry.description ?? ''])].join(' | '));
  const named = (part: string) => new RegExp(String.raw`(?<![\p{L}\p{N}])${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+')}(?![\p{L}\p{N}])`, 'u').test(own);
  const yes = parts.length > 0 && (all ? parts.every(named) : parts.some(named));
  if (!yes) return none('no-profile-value', false);
  const bySkill = parts.some((part) => profile.skills.some((skill) => normalizeLabel(skill) === part));
  return value({ origin: byRule('skills.experience-with', bySkill ? 'skills' : 'experience'),
    confidence: VALUE_TRANSFORM, choice: { intended: { kind: 'boolean', value: true }, domain: 'polarity' },
    check: true });
}

/** jr6 RULES R3 (O2): an address line's or a postal code's value with the places a search's result names after it
 *  (Choice.street: the city, the state's code and name). */
function withStreet(result: ValueResult, address: Profile['address']): ValueResult {
  if (!result.ok || result.candidate.choice === undefined || result.candidate.text === undefined) return result;
  const places = [address?.city, address?.region?.code, address?.region?.name]
    .filter((place): place is string => place !== undefined && place.trim() !== '');
  if (places.length === 0) return result;
  return value({ ...result.candidate, choice: { ...result.candidate.choice,
    street: { text: result.candidate.text, places } } });
}

/**
 * jr6 RULES R3 (ADP-7: ADP's required "Select currency type", 158 options written "United States Dollar ( USD )",
 * fixtures/adp/questions): the pay's currency (preferences.expectedSalary), typed as its ISO code, or chosen as the one
 * option that is the code or writes it in capitals ("( USD )"), else matched by the code. None without an expected
 * salary, or for a declined one (a default from the posting's country waits on the owner, question 8).
 */
function currencyValue(spec: FieldSpec, profile: Profile): ValueResult {
  const salary = profile.preferences.expectedSalary;
  if (salary === undefined || salary.kind === 'decline') return none('no-profile-value');
  const code = salary.value.currency.trim();
  if (!/^[A-Z]{3}$/.test(code) || spec.options === 'lazy') return textValue(code, 'preferences.expectedSalary');
  const writes = new RegExp(String.raw`(?<![\p{L}\p{N}])${code}(?![\p{L}\p{N}])`, 'u');
  const named = spec.options.map((option) => cutInjected(option.label).clean.trim())
    .filter((clean, at) => clean !== '' && !(spec.options as Option[])[at]!.disabled && writes.test(clean));
  const text = named.length === 1 ? named[0]! : code;
  return value({ origin: fromProfile('preferences.expectedSalary'), confidence: VALUE_EXPLICIT, text: code,
    choice: { intended: intendedText(text), domain: 'generic' } });
}

// ── jr6 RULES R4 (FIXPLAN §6.3 items 62 to 79) ─────────────────────────────────────────────────────────────────────

/** Whether a year-month is before a day's month. */
const beforeMonth = (date: YearMonth, now: Ymd) => date.y < now.y || (date.y === now.y && (date.m ?? 12) < now.m);

/**
 * ICIMS-25 (NYU's iCIMS "Did You Graduate?" in an education block, fixtures jr6-nyu-profile-parsed): yes when the
 * block's entry (else the most recent) holds a degree, is no longer in progress and ended before this month; no while it
 * is in progress (education.graduated). Nothing otherwise: TailorIT's AI answers it (ANSWERABLE_PROFILE_CATEGORIES).
 */
function graduatedValue(ctx: ValueContext): ValueResult {
  const { spec, profile, now } = ctx;
  const index = entryIndex(spec, profile.education, 'education', ctx.blockEntries);
  if (index === null) return none('no-profile-value', false);
  const entry = profile.education[index]!;
  const degree = entry.degree.level !== 'other' || entry.degree.type !== undefined;
  const answer = entry.inProgress ? false
    : degree && entry.endDate !== undefined && beforeMonth(entry.endDate, now) ? true : null;
  if (answer === null) return none('no-profile-value', false);
  return value({ origin: byRule('education.graduated', `education[${index}]`), confidence: VALUE_TRANSFORM,
    choice: { intended: { kind: 'boolean', value: answer }, domain: 'polarity' }, check: answer });
}

/**
 * ADP-20 (ADP's "Are you a high school graduate or passed the GED?", fixtures jr6-questions2-blank): yes when an
 * education entry holds a degree past high school, or a completed high-school one (education.high-school). Nothing
 * otherwise: TailorIT's AI answers it.
 */
function highSchoolValue(profile: Profile): ValueResult {
  const past = profile.education.some((entry) => entry.degree.level !== 'other'
    && (DEGREE_LEVEL_RANK[entry.degree.level] > DEGREE_LEVEL_RANK.highSchool || !entry.inProgress));
  if (!past) return none('no-profile-value', false);
  return value({ origin: byRule('education.high-school', 'education'), confidence: VALUE_TRANSFORM,
    choice: { intended: { kind: 'boolean', value: true }, domain: 'polarity' }, check: true });
}

/** The words each pay period is written with on a list ("Annually | Hourly", ADP's), the first a box's. */
const PERIOD_WORDS: Readonly<Record<'year' | 'month' | 'hour', readonly [string, ...string[]]>> = {
  year: ['Annually', 'Annual', 'Yearly', 'Per Year', 'Per Annum', 'Salary', 'Salaried'],
  month: ['Monthly', 'Per Month', 'Month'],
  hour: ['Hourly', 'Per Hour', 'Hour'],
};

/**
 * ADP-16 (ADP's desired-salary Annually | Hourly radios, "<block title> pay basis" by the label contract): the expected
 * pay's period (preferences.expectedSalary); none without it, so the field is left (no default: Jobright's preselected
 * Annually is not taken).
 */
function payPeriodValue(profile: Profile, vocab: Vocab): ValueResult {
  const salary = profile.preferences.expectedSalary;
  if (salary === undefined || salary.kind === 'decline') return none('no-profile-value');
  const [first, ...rest] = PERIOD_WORDS[salary.value.period];
  return value({ origin: fromProfile('preferences.expectedSalary'), confidence: VALUE_EXPLICIT, text: first,
    choice: { intended: intendedUnknown('generic', first, rest, vocab), domain: 'generic' } });
}

/** ADP-18: an option that uploads a file ("Upload File"), and one that types the résumé's parts in instead ("Enter
 *  Professional Details"), which is never chosen. */
const UPLOAD_OPTION = /\b(?:upload|attach|my\s+computer|from\s+(?:my\s+)?(?:device|computer))\b/i;
const TYPED_OPTION = /\b(?:enter|type|fill|manual\w*|professional\s+details|paste)\b/i;

/**
 * ADP-18 (ADP's "How would you like to provide the candidate's resume?", Upload File | Enter Professional Details,
 * fixtures jr6-resume-choice): the one option that uploads a file, for a run that has a résumé to upload, where no
 * option is chosen yet (resume.upload-method); one chosen already is kept (prefill-kept). Never the typed alternative.
 */
function resumeMethodValue(spec: FieldSpec, profile: Profile): ValueResult {
  if (profile.resume === undefined) return none('no-profile-value', false);
  if (spec.options === 'lazy') return none('waiting-for-options');
  const options = spec.options.filter((option) => !option.disabled && cutInjected(option.label).clean.trim() !== '');
  if (options.some((option) => option.selected && !PROMPT.test(option.label))
    || (spec.current.kind === 'selected' && spec.current.labels.some((label) => label.trim() !== ''))) {
    return none('prefill-kept', false);
  }
  const uploads = options.filter((option) => UPLOAD_OPTION.test(option.label) && !TYPED_OPTION.test(option.label));
  if (uploads.length !== 1) return none('no-match');
  return value({ origin: byRule('resume.upload-method', 'resume'), confidence: VALUE_TRANSFORM,
    choice: { intended: intendedText(cutInjected(uploads[0]!.label).clean.trim()), domain: 'generic' } });
}

/** SR-13: a Facebook address (facebook.com, fb.com, m.facebook.com). */
const FACEBOOK_LINK = /^(?:https?:\/\/)?(?:www\.|m\.|web\.)?(?:facebook|fb)\.com\//i;

/** SR-13 (SmartRecruiters' "Facebook", fixtures/smartrecruiters/xplor-one-click): the profile's one Facebook address
 *  among its other links, else nothing (never asked of an AI; Jobright keeps only a facebook.com address there). */
function facebookValue(links: Profile['links']): ValueResult {
  const found = links.other.map((link, index) => ({ link, index }))
    .filter(({ link }) => FACEBOOK_LINK.test(link.url.trim()));
  if (found.length !== 1) return none(found.length === 0 ? 'no-profile-value' : 'ambiguous-options', found.length > 1);
  return textValue(found[0]!.link.url, `links.other[${found[0]!.index}].url`);
}

/** O13: Oracle's numbered link boxes, name="siteLink-N" (the label contract of FIXPLAN §3.2), their number captured. */
const SITE_LINK = /(?:^|[_ ])site_?link_?(\d{1,2})(?=[_ ]|$)/;

/**
 * O13 (Oracle's "Link 1" … in Supporting Documents and URLs, fixtures/oracle/hjf-apply-section; Jobright's
 * applyOracleProfileLinkAnswers fills LinkedIn, GitHub and the website into Link 1..n: cited): the box's number picks
 * the profile's links in that order (the website, else the portfolio), then its other links; none past them.
 */
function numberedLinkValue(spec: FieldSpec, links: Profile['links']): ValueResult {
  const number = Number(SITE_LINK.exec(nameIdText(spec.nameAttr, spec.idAttr))?.[1] ?? Number.NaN);
  const website = (links.website?.trim() ?? '') !== '' ? { url: links.website ?? '', at: 'links.website' }
    : { url: links.portfolio ?? '', at: 'links.portfolio' };
  const ordered = [{ url: links.linkedin ?? '', at: 'links.linkedin' }, { url: links.github ?? '', at: 'links.github' },
    website, ...links.other.map((link, index) => ({ url: link.url, at: `links.other[${index}].url` }))]
    .filter((link) => link.url.trim() !== '');
  const chosen = Number.isInteger(number) && number >= 1 ? ordered[number - 1] : undefined;
  return chosen === undefined ? none('no-profile-value', false) : textValue(chosen.url, chosen.at);
}

// jr6 RULES end
