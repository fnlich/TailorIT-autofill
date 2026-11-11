/*
 * jr6 RULES (FIXPLAN §6.3 R2, items 27 to 30): a work status asked by its meaning. A work-status question offers the
 * statuses themselves ("US Citizen", "Permanent Resident", "H1B", "EAD"; Jobvite's NinjaOne "What is your US Work
 * Authorization type?", JV-7), sentences of them ("I am a U.S. Citizen/Permanent Resident", "Non-citizen allowed to
 * work for any employer": Jobvite's VHL "Citizen/Employment Status", JV-11; JazzHR's standard "What's your citizenship /
 * employment eligibility?", JZ-7), or asks one as yes or no ("Are you a US Citizen or Permanent Resident?", JZ-8).
 * Each option is read by what it says, never by its exact words:
 * - a citizen, a permanent resident (a green card), or both ("Citizen/Permanent Resident"), of the country it names
 *   (by its name, a short form in capitals, or its people's adjective: "Canadian");
 * - a non-citizen, which "non-citizen" negates (workBasis' PERMANENT once read it as a citizen), allowed to work for any
 *   employer, for the current employer only, or seeking work authorization;
 * - a visa or a permit by its type (H-1B, TN, F-1, OPT, EAD): never chosen, since the profile holds no visa type.
 * Which option the person's answers give is the policy's (policy.ts workStatusValue); this file only reads the page's
 * own words. Pure: nothing is kept.
 */
import { prepareOptions } from '../matcher/prepare';
import { normalize } from '../text/normalize';
import type { FieldSpec } from '../types/field';
import type { Vocab } from '../vocab/types';
import { placesNamed } from './policy';

/** What a status option (or a status asked as yes or no) says. */
export const STATUS_MEANINGS = ['citizen', 'resident', 'citizen-or-resident', 'visa', 'any-employer',
  'current-employer', 'seeking'] as const;
export type StatusMeaning = (typeof STATUS_MEANINGS)[number];

/** A non-citizen ("Non-citizen allowed to work …", "not a U.S. citizen"): never the citizen's option. */
const NON_CITIZEN = /\bnon\s?(?:us\s+|u\s+s\s+)?citizens?\b|\bnot\s+(?:an?\s+)?(?:us\s+|u\s+s\s+|\w+\s+)?citizens?\b/;
const CITIZEN = /\bcitizens?\b|\bcitizenship\b/;
/** A permanent resident, or a green card's holder. */
const RESIDENT = /\bpermanent\s+residen\w*|\bgreen\s+card\w*|\blawful(?:ly)?\s+permanent\b|\blpr\b/;
/** A non-citizen's own right, as the sentences put it. */
const ANY_EMPLOYER = /\b(?:allowed|authori[sz]ed|permitted|eligible|able|entitled)\s+to\s+work\s+for\s+any\s+(?:us\s+|u\s+s\s+)?employer\b/;
const CURRENT_EMPLOYER = /\b(?:allowed|authori[sz]ed|permitted|eligible|able|entitled)\s+to\s+work\s+(?:only\s+)?for\s+(?:my\s+|the\s+|a\s+|their\s+)?(?:current|present|specific|sponsoring)\s+employer\b/;
const SEEKING = /\bseeking\s+(?:work\s+|employment\s+)?authori[sz]ation\b|\b(?:need|needs|require|requires|requiring)\s+(?:work\s+|employment\s+)?authori[sz]ation\b/;
/** A visa or a permit by its type. normalize joins "F1Visa" into one word, so "visa" is read inside a word too. */
const VISA = /\bh\s?1\s?b\b|\bh\s?4\b|\bl\s?1\b|\bo\s?1\b|\be\s?3\b|\btn\b|\bf\s?1\b|\bj\s?1\b|\bopt\b|\bcpt\b|\bead\b|visas?\b|\bwork\s+permits?\b|\btemporary\s+(?:work|resident)\b/;

/** An option's words as the status rules read them: folded, its brackets' words kept. */
function wordsOf(label: string): string {
  return normalize(label.replace(/[()[\]]/g, ' '), 'label').folded;
}

/** What one option's label (or a yes-or-no question) says of a work status, or null when it says none. */
export function statusMeaningOf(label: string): StatusMeaning | null {
  const words = wordsOf(label);
  if (NON_CITIZEN.test(words)) {
    if (ANY_EMPLOYER.test(words)) return 'any-employer';
    if (CURRENT_EMPLOYER.test(words)) return 'current-employer';
    return SEEKING.test(words) ? 'seeking' : null;
  }
  const citizen = CITIZEN.test(words);
  const resident = RESIDENT.test(words);
  if (citizen && resident) return 'citizen-or-resident';
  if (citizen) return 'citizen';
  if (resident) return 'resident';
  return VISA.test(words) ? 'visa' : null;
}

/** The people's adjectives a status option names its country by ("Canadian Citizen"): public facts, the few countries
 *  a work-status list names beside the United States. */
const DEMONYMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bamerican\b/, 'US'], [/\bcanadian\b/, 'CA'], [/\bbritish\b/, 'GB'], [/\baustralian\b/, 'AU'],
  [/\bmexican\b/, 'MX'], [/\birish\b/, 'IE'], [/\bnew\s+zealand(?:er)?\b/, 'NZ'], [/\bindian\b/, 'IN'],
];

/** The countries a status text names, as ISO alpha-2 codes: by name or short form (placesNamed), or by its people's
 *  adjective. */
export function countriesOfStatus(text: string, vocab: Vocab): string[] {
  const words = wordsOf(text);
  const found = new Set(placesNamed(text, vocab).countries);
  for (const [re, code] of DEMONYMS) if (re.test(words)) found.add(code);
  return [...found];
}

/** An option that states a need of sponsorship, or denies one ("… requiring sponsorship", "does not require
 *  sponsorship"): a basis of the right to work (workBasis.ts), never a status list. A visa named by its type alone
 *  ("H-1B Visa") is a status. */
const SPONSORSHIP_NAMED = /\bsponsor\w*|\b(?:immigration|visa)\s+(?:support|assistance)\b/;

/** A yes or no option ("Yes", "No", "Yes, I am"). */
const YES_NO_OPTION = /^(?:yes|no)\b/;

/**
 * Whether a list's own options make it a work-status question (classifyRules: an authorization question asked as one,
 * or a question the rules read nothing certain in): read whole, no yes or no among them, at least two options naming a
 * status (a citizen, a permanent resident, a non-citizen's right, a visa type), and none stating a sponsorship need
 * (a basis of the right to work: workBasis.ts reads those).
 */
export function namesStatusList(labels: readonly string[]): boolean {
  const words = labels.map((label) => wordsOf(label)).filter((text) => text !== '');
  if (words.some((text) => YES_NO_OPTION.test(text))) return false;
  if (words.some((text) => SPONSORSHIP_NAMED.test(text))) return false;
  const meanings = labels.map((label) => statusMeaningOf(label)).filter((meaning) => meaning !== null);
  return meanings.length >= 2 && meanings.some((meaning) => meaning !== 'visa');
}

/** One status option: its index among the field's options, its clean label, what it says and the countries it names. */
export interface StatusOption {
  index: number;
  clean: string;
  meaning: StatusMeaning | null;
  countries: string[];
}

/** The field's usable options read as statuses, or null for a list not read whole. A placeholder, a decline, "Other"
 *  and "None of the above" are left out. */
export function readStatusOptions(spec: Pick<FieldSpec, 'options' | 'optionsPartial'>, vocab: Vocab):
  StatusOption[] | null {
  if (spec.options === 'lazy' || spec.optionsPartial === true) return null;
  return prepareOptions(spec.options, 'generic', vocab).list
    .filter((option) => !option.unusable && !option.disabled && !option.injected && !option.decline && !option.other
      && !option.exclusive && option.clean.trim() !== '')
    .map((option) => ({ index: option.index, clean: option.clean, meaning: statusMeaningOf(option.clean),
      countries: countriesOfStatus(option.clean, vocab) }));
}

/** Whether a list's options are yes and no (a status asked as yes or no: JZ-8). */
export function asksYesOrNo(spec: Pick<FieldSpec, 'kind' | 'options'>): boolean {
  if (spec.kind === 'checkbox') return true;
  if (spec.options === 'lazy') return false;
  const words = spec.options.map((option) => wordsOf(option.label));
  return words.some((text) => /^yes\b/.test(text)) && words.some((text) => /^no\b(?!\s+answer\b)/.test(text));
}

/** The meanings a person's status is offered under. */
const OFFERED_AS: Readonly<Record<'citizen' | 'permanent-resident', readonly StatusMeaning[]>> = {
  citizen: ['citizen', 'citizen-or-resident'],
  'permanent-resident': ['resident', 'citizen-or-resident'],
};

/**
 * The status option a person's status (or a non-citizen's right) takes, for `country`: an option of one of `meanings`
 * that names no country or names this one. The one such option, or 'none' or 'several'.
 */
export function statusOptionFor(options: readonly StatusOption[], meanings: readonly StatusMeaning[],
  country: string): StatusOption | 'none' | 'several' {
  const found = options.filter((option) => option.meaning !== null && meanings.includes(option.meaning)
    && (option.countries.length === 0 || option.countries.includes(country)));
  if (found.length === 0) return 'none';
  return found.length === 1 ? found[0]! : 'several';
}

/** The meanings a citizen's or a permanent resident's status is offered under (OFFERED_AS). */
export function meaningsOfStatus(status: 'citizen' | 'permanent-resident'): readonly StatusMeaning[] {
  return OFFERED_AS[status];
}
