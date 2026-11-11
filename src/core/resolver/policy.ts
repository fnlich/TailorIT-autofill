/*
 * The EEO, legal and consent policy (docs/design/core.md §8.7, docs/ARCHITECTURE.md "Resolver"). These answers come
 * only from what the person stated: nothing is inferred, nothing is fuzzy-matched or sent to an LLM, and nothing is
 * cached (the matcher's domain table and the policy classes keep those stages off).
 * - EEO: an explicit value is matched through the EEO vocabulary; an explicit decline chooses the form's decline
 *   option (else blank, decline-option-missing). No answer chooses the form's decline option too while
 *   settings.interpretations.eeoDeclineByDefault is on (rule eeo.decline-default, the owner's amendments: a decline is
 *   no guess), and leaves the field blank and flagged otherwise (eeo-not-in-profile). A self-described gender chooses
 *   the self-describe option and types the person's own words into the box it reveals, always flagged. Several races
 *   on a single-choice question are blank and flagged, unless interpretation 2 is on ("Two or More Races", flagged). A
 *   race option that asserts a Hispanic or Latino answer is chosen only when the person's own explicit answer agrees
 *   (MatchInput.hispanicLatino).
 * - Legal: the answer of the work-authorization entry for the country the question names. A question that names no
 *   country, or several, is blank and flagged. Interpretation 1 answers one that names none from the entry for the
 *   posting's country, flagged: the country the lookup's location names (postingCountryOf), else the profile's only
 *   work-authorization entry's. A combined "now or in the future" sponsorship question is Yes when either answer is an
 *   explicit yes, No only when both are an explicit no, the decline option when either is declined and neither is yes,
 *   and blank otherwise. A question whose options state the basis of the right to work (workBasis.ts: permanent, a
 *   permit needing no sponsorship, sponsorship) takes the option the entry's answers state (basisOfEntry), and is left
 *   to the `all` scope's AI, with every option, when they do not settle it. Criminal history is the person's own
 *   answer in the sensitive part (version 2), matched by its polarity alone; absent or declined, the field is blank
 *   and flagged. It answers a generic conviction question; a narrower one (a felony, a time, unspent) only when it is
 *   No; never an arrest or a charge (criminal-not-covered).
 * - Consent: ticked when every consent kind the label names is approved (§8.7: under Consents: All, every kind the
 *   extension recognises, marketing and SMS included, v3 Phase 3; under Required only, those pre-approved in
 *   settings), else when the form requires it (the owner's decision of 2026-11-01: it is needed to apply, a binding
 *   clause included); an optional one not approved is left unticked, decided. An AI attestation is ticked only when
 *   the run used no AI at all. A signature types the person's full name on the same terms.
 * - The sensitive part (authorization, EEO, age, criminal record, pronouns, pay): until it is loaded no such field is
 *   answered. While it is 'not-loaded' the plan asks the worker to fetch it (planFrame's needsSensitive); when the
 *   token may not read it ('not-shared') or the fetch failed ('unavailable'), those fields are blank and flagged, but
 *   a self-identification question while it is not shared, which takes the decline default (eeoDeclineDefault).
 */
import {
  POSTING_COUNTRY_FACTOR, VALUE_CONSENT_PREAPPROVED, VALUE_EXPLICIT, VALUE_TRANSFORM, VALUE_TWO_OR_MORE_RACES,
} from '../confidence';
import { CONSENT_CATEGORIES, type ConsentCategory, type FieldKind, type WorkStatus } from '../enums';
import { intendedCountry, intendedDecline, intendedEntity, intendedText, intendedUnknown } from '../matcher/intended';
import type { MatchDomain } from '../matcher/types';
import type { PlanSensitiveState } from '../plan/types';
import { normalize } from '../text/normalize';
import type { FieldSpec } from '../types/field';
import type { FieldCategory, ProfilePath, RuleId, ValueOrigin, VocabDomain } from '../types/intent';
import type { AsianSubgroup, Explicit, Profile, SexualOrientation, WorkAuthorization, Ymd } from '../types/profile';
import type { Settings } from '../types/settings';
import type { Vocab } from '../vocab/types';
import { none, value, type Candidate, type Choice, type ValueResult } from './candidate';
import { USER_ONLY_CATEGORIES } from './categories';
import { prepareOptions } from '../matcher/prepare';
import { residencePlaceOf, YES_NO_QUESTION } from './labelRules';
import { companyKey, namesPostingCompany } from './values';
import { basisClassAt, readBasisOptions, type BasisClass, type BasisOption } from './workBasis';
import {
  asksYesOrNo, countriesOfStatus, meaningsOfStatus, namesStatusList, readStatusOptions, statusMeaningOf, statusOptionFor,
  type StatusMeaning, type StatusOption,
} from './workStatus';

const path = (text: string) => text as ProfilePath;
const fromProfile = (at: string, transform?: RuleId): ValueOrigin => (transform === undefined
  ? { provenance: 'profile', path: path(at) } : { provenance: 'profile', path: path(at), transform });
const byRule = (ruleId: RuleId, at: string): ValueOrigin => ({ provenance: 'rule', ruleId, path: path(at) });

// ---------------------------------------------------------------------------------------------------------------
// The sensitive part

/** The categories whose answer lives in the sensitive part: work authorization, age, criminal record (version 2),
 *  self-identification, pronouns and pay. Visa type, clearance, sexual orientation and transgender identity have no
 *  answer in either part, so they never need it. */
export const SENSITIVE_PART_CATEGORIES: ReadonlySet<FieldCategory> = new Set<FieldCategory>(['workAuth.authorized',
  'workAuth.sponsorship', 'workAuth.sponsorshipNow', 'workAuth.sponsorshipFuture', 'workAuth.status',
  'screening.over18', 'screening.criminalHistory', 'eeo.gender', 'eeo.hispanicLatino', 'eeo.race', 'eeo.veteran',
  'eeo.disability', 'identity.pronouns', 'salary.expected', 'salary.currency',
  // s2 core-gh: the snapshot round's answers from the sensitive part (core/types/profile.ts screening, eeo).
  'workAuth.clearance', 'workAuth.citizenship', 'screening.restrictiveAgreement', 'screening.governmentService',
  'screening.relatives', 'screening.essentialFunctions', 'eeo.sexualOrientation', 'eeo.transgender',
  // jr6 RULES R2 (WD-30): OPT, from the work-authorization entry.
  'workAuth.opt',
  // jr6 RULES R3 (WD-29): military training, from the service and veteran answers.
  'screening.militaryTraining']);

/** What the sensitive part's state means for a field of this category: answer it ('ready'), fetch the part first
 *  ('fetch'), or leave it blank and flagged with the state's reason. */
export function sensitiveGate(category: FieldCategory, state: PlanSensitiveState): 'ready' | 'fetch' | ValueResult {
  if (!SENSITIVE_PART_CATEGORIES.has(category) || state === 'loaded') return 'ready';
  if (state === 'not-loaded') return 'fetch';
  return none(state === 'not-shared' ? 'sensitive-not-shared' : 'sensitive-unavailable');
}

// ---------------------------------------------------------------------------------------------------------------
// Legal

/** The combined "now or in the future" sponsorship answer (legal.sponsorship-combined): yes when either answer is an
 *  explicit yes, no only when both are an explicit no, a decline when either is declined and neither is yes; absent
 *  otherwise. */
export function combinedSponsorship(now: Explicit<boolean> | undefined, future: Explicit<boolean> | undefined):
  Explicit<boolean> | undefined {
  const answers = [now, future];
  if (answers.some((answer) => answer?.kind === 'value' && answer.value)) return { kind: 'value', value: true };
  if (answers.every((answer) => answer?.kind === 'value' && !answer.value)) return { kind: 'value', value: false };
  if (answers.some((answer) => answer?.kind === 'decline')) return { kind: 'decline' };
  return undefined;
}

/** A short country spelling ("US", "UK", "USA") counts only written in capitals, dots allowed ("U.S."): the lower-case
 *  word "us" is a pronoun ("Are you authorized to work for us?"). */
function shortFormInCapitals(token: string, raw: string): boolean {
  const letters = token.toUpperCase().split('').map((letter) => `${letter}\\.?\\s?`).join('');
  return new RegExp(String.raw`(?<![\p{L}\p{N}])${letters}(?![\p{L}\p{N}])`, 'u').test(raw);
}

/** Cities whose names hold a country's but that stand elsewhere, or in a country the name does not settle: Jersey City
 *  is in New Jersey, and Panama City is in Florida as well as Panama. */
const CITIES_NAMED_FOR_A_COUNTRY: ReadonlyArray<readonly string[]> = [['jersey', 'city'], ['panama', 'city']];

/** The longest phrase of `phrases` that starts at `at` in `tokens`, as its length (0 for none) and its entity id; a
 *  short spelling counts only in capitals in `raw`. */
function phraseAt(phrases: ReadonlyMap<string, ReadonlyArray<{ tokens: readonly string[]; id: string; ambiguous: boolean }>>,
  tokens: readonly string[], at: number, raw: string): { length: number; id: string | null } {
  for (const phrase of phrases.get(tokens[at]!) ?? []) {
    if (phrase.ambiguous || phrase.tokens.length > tokens.length - at) continue;
    if (!phrase.tokens.every((token, offset) => tokens[at + offset] === token)) continue;
    if (phrase.tokens.length === 1 && phrase.tokens[0]!.length <= 3 && !shortFormInCapitals(phrase.tokens[0]!, raw)) {
      continue;
    }
    return { length: phrase.tokens.length, id: phrase.id };
  }
  return { length: 0, id: null };
}

/** The countries a question names, and whether it names a place that may or may not be a country. */
export interface PlacesNamed {
  /** ISO alpha-2 codes, each once. */
  countries: string[];
  /** A name a country shares with a region ("Georgia"): which one the question means is not said. */
  ambiguous: boolean;
}

/**
 * The places a question names (the review, CORE-13), read left to right, longest first: a country's phrase from the
 * country vocabulary, unless a region's phrase or a city's name there is longer and holds it ("New Mexico", "New
 * Jersey", "Jersey City" name no country), and a phrase a country and a region share in full ("Georgia") is ambiguous.
 */
export function placesNamed(text: string, vocab: Vocab): PlacesNamed {
  const { countries, ambiguous } = readPlaces(text, vocab);
  return { countries, ambiguous };
}

/** placesNamed's reading, with the countries of the regions it read besides ("NY", "Ontario"). */
interface PlacesRead extends PlacesNamed {
  /** The ISO alpha-2 codes of the countries the regions read belong to, each once. */
  regionCountries: string[];
}

/** The places a text names, read left to right, longest first (placesNamed), with its regions' countries. */
function readPlaces(text: string, vocab: Vocab): PlacesRead {
  const tokens = normalize(text, 'country').tokens;
  const countries = vocab.phrases('country');
  const regions = vocab.phrases('region');
  const found = new Set<string>();
  const ofRegions = new Set<string>();
  let ambiguous = false;
  let at = 0;
  while (at < tokens.length) {
    const country = phraseAt(countries, tokens, at, text);
    const city = CITIES_NAMED_FOR_A_COUNTRY.find((name) => name.every((token, offset) => tokens[at + offset] === token));
    const regionFound = phraseAt(regions, tokens, at, text);
    const region = Math.max(regionFound.length, city?.length ?? 0);
    if (country.length === 0 || region > country.length) {
      // A region (not a city named for a country): the country it belongs to is named too.
      if (regionFound.length > 0 && regionFound.length >= (city?.length ?? 0) && regionFound.id !== null) {
        const entity = vocab.entity(regionFound.id);
        if (entity?.kind === 'region') ofRegions.add(entity.country);
      }
      at += Math.max(region, 1);
      continue;
    }
    if (region === country.length) {
      ambiguous = true;
    } else {
      const entity = vocab.entity(country.id!);
      if (entity?.kind === 'country') found.add(entity.alpha2);
    }
    at += country.length;
  }
  return { countries: [...found], ambiguous, regionCountries: [...ofRegions] };
}

/** The countries a question names, as ISO alpha-2 codes (placesNamed's countries). */
export function countriesNamed(text: string, vocab: Vocab): string[] {
  return placesNamed(text, vocab).countries;
}

/**
 * The country a posting's location names (TailorIT's job location: "San Francisco, CA", "London, United Kingdom",
 * "Remote - Canada"), as an ISO alpha-2 code: the one country among those it names and those its regions (US states,
 * Canadian provinces) belong to; undefined when it names none, more than one ("New York, NY; London, United Kingdom",
 * "San Francisco, CA or Toronto, Canada": the Phase E review, MINOR 1), or a place that may or may not be a country.
 */
export function postingCountryOf(location: string, vocab: Vocab): string | undefined {
  const places = readPlaces(location, vocab);
  if (places.ambiguous) return undefined;
  const all = new Set([...places.countries, ...places.regionCountries]);
  return all.size === 1 ? [...all][0] : undefined;
}

/** What a legal question's country may come from besides its own words: interpretation 1, when it is on, and the
 *  posting's country, when the caller knows it (the lookup's location: postingCountryOf); with none, the profile's
 *  only work-authorization entry's. */
export interface LegalContext {
  settings: Settings;
  postingCountry?: string;
  /** s2 core-gh: the posting's company (a relative there) and the day (service within the last N years). */
  postingCompany?: string;
  now?: Ymd;
}

/** The work-authorization entry for the one country a question names (its label, else its description), or, under
 *  interpretation 1, the posting's country for a question that names none; or why there is none. A question that also
 *  names a place that may or may not be a country ("Georgia") names no one country. */
function authorizationEntry(spec: FieldSpec, profile: Profile, vocab: Vocab, legal: LegalContext):
  { index: number; fromPosting: boolean; located?: true }
  | { reason: 'work-auth-country-unknown' | 'legal-not-in-profile' } {
  let places = placesNamed(spec.label, vocab);
  if (places.countries.length === 0 && !places.ambiguous && spec.description !== '') {
    places = placesNamed(spec.description, vocab);
  }
  if (places.ambiguous) return { reason: 'work-auth-country-unknown' };
  let countries = places.countries;
  // jr6 RULES (SR-4): countries each qualified by where the person is located.
  if (countries.length > 1) {
    const located = locatedCountry(spec.label, countries, profile, vocab, legal.postingCountry);
    if (located === null) return { reason: 'work-auth-country-unknown' };
    const index = profile.workAuthorization.findIndex((entry) => entry.country === located.country);
    if (index < 0) return { reason: 'legal-not-in-profile' };
    return located.own ? { index, fromPosting: false, located: true } : { index, fromPosting: true };
  }
  // The posting's country, else the one country the person answered for (interpretation 1).
  const posting = legal.postingCountry
    ?? (profile.workAuthorization.length === 1 ? profile.workAuthorization[0]!.country : undefined);
  const fromPosting = countries.length === 0 && legal.settings.interpretations.postingCountryForLegal
    && posting !== undefined;
  if (fromPosting) countries = [posting];
  if (countries.length !== 1) return { reason: 'work-auth-country-unknown' };
  const index = profile.workAuthorization.findIndex((entry) => entry.country === countries[0]);
  return index < 0 ? { reason: 'legal-not-in-profile' } : { index, fromPosting };
}

/** jr6 RULES (SR-4): "if you are located (based, residing) in <country>", as a question qualifies each country it names
 *  (Wiser's "… in the US (if you are located in the US) or Canada (if you are located in Canada)?"). */
const LOCATED_IN = /\bif\s+(?:you\s+)?(?:are\s+|re\s+)?(?:currently\s+)?(?:located|based|residing|living|reside|live|resident)\s+(?:in|within)\s+([^()?,;.]+)/giu;

/**
 * jr6 RULES (SR-4, fixtures/smartrecruiters/jr6-wiser-screening): of the countries a question names, each qualified by
 * where the person is located (LOCATED_IN), the person's own: their address's country among them, else the one they
 * hold a work-authorization entry for (`own`); else the posting's among them. Null when a country stands unqualified,
 * or none of these says.
 */
function locatedCountry(label: string, countries: readonly string[], profile: Profile, vocab: Vocab,
  postingCountry: string | undefined): { country: string; own: boolean } | null {
  const qualified = new Set([...label.matchAll(LOCATED_IN)].flatMap((found) => placesNamed(found[1]!, vocab).countries));
  if (!countries.every((country) => qualified.has(country))) return null;
  const home = profile.address?.country;
  if (home !== undefined && countries.includes(home)) return { country: home, own: true };
  const held = countries.filter((country) => profile.workAuthorization.some((entry) => entry.country === country));
  if (held.length === 1) return { country: held[0]!, own: true };
  return postingCountry !== undefined && countries.includes(postingCountry)
    ? { country: postingCountry, own: false } : null;
}

/** A yes/no legal or EEO answer in its shapes: an option chosen by polarity, or a lone box ticked for yes. */
function yesNo(answer: boolean, origin: ValueOrigin, confidence = VALUE_EXPLICIT, extra: Partial<Candidate> = {}):
  ValueResult {
  return value({ origin, confidence, choice: { intended: { kind: 'boolean', value: answer }, domain: 'polarity' },
    check: answer, ...extra });
}

/** An explicit yes/no legal answer, or its decline (legal.decline), or why there is none. An answer read for the
 *  posting's country (interpretation 1) carries legal.posting-country, scores POSTING_COUNTRY_FACTOR less and is
 *  always flagged. */
function legalAnswer(answer: Explicit<boolean> | undefined, at: string, transform?: RuleId, fromPosting = false,
  located = false): ValueResult {
  if (answer === undefined) return none('legal-not-in-profile');
  // jr6 RULES (SR-4): the located country's entry is flagged as the posting's is (legal.located-country).
  const factor = fromPosting || located ? POSTING_COUNTRY_FACTOR : 1;
  const extra: Partial<Candidate> = fromPosting || located ? { flag: 'filled-low-confidence' } : {};
  if (answer.kind === 'decline') {
    return value({ origin: byRule('legal.decline', at), confidence: VALUE_EXPLICIT * factor,
      choice: { intended: intendedDecline('polarity'), domain: 'polarity' }, ...extra });
  }
  const own = fromPosting ? 'legal.posting-country' : located ? 'legal.located-country' : transform;
  return yesNo(answer.value, fromProfile(at, own), (own === undefined ? VALUE_EXPLICIT : VALUE_TRANSFORM) * factor, extra);
}

/** The work-authorization questions a basis set may answer (workBasis.ts): authorization, sponsorship at any time, and
 *  a work status. */
const BASIS_CATEGORIES: ReadonlySet<FieldCategory> = new Set<FieldCategory>(['workAuth.authorized',
  'workAuth.sponsorship', 'workAuth.sponsorshipNow', 'workAuth.sponsorshipFuture', 'workAuth.status']);

/**
 * The basis of the person's right to work an entry states (workBasis.ts): sponsorship when they need it now or later;
 * else, when they are explicitly authorized, a permanent right as a citizen or permanent resident, or a permit or a
 * visa needing no sponsorship (a work-visa, student-visa or other status with both sponsorship answers an explicit
 * no); a decline when the answer that decides it is declined; null when the entry does not settle it (no authorization
 * answer, no status, or a visa status with a sponsorship answer missing). Authorization is never read from a status
 * (types/profile.ts). jr6 RULES (SR-12): an entry with no status is a citizen's when the person's citizenships include
 * its country (`citizen`); an explicit "not authorized" is no right to work.
 */
function basisOfEntry(entry: WorkAuthorization, citizen = false): BasisClass | 'decline' | null {
  const sponsorship = combinedSponsorship(entry.sponsorshipNow, entry.sponsorshipFuture);
  if (sponsorship?.kind === 'value' && sponsorship.value) return 'sponsorship';
  if (entry.authorized?.kind === 'decline') return 'decline';
  if (entry.authorized?.kind !== 'value') return null;
  if (!entry.authorized.value) return 'none';
  const status = entry.status;
  if (status?.kind === 'decline') return 'decline';
  if (status === undefined) return citizen ? 'permanent' : null;
  if (status.value === 'citizen' || status.value === 'permanent-resident') return 'permanent';
  if (sponsorship?.kind === 'decline') return 'decline';
  return sponsorship === undefined ? null : 'permit';
}

/** jr6 RULES (SR-12): whether the person's citizenships include a country. */
function citizenOf(profile: Profile, country: string): boolean {
  const citizenships = profile.screening.citizenships;
  return citizenships?.kind === 'value' && citizenships.value.includes(country);
}

/**
 * jr6 RULES (SR-12, SmartRecruiters' Xplor "Which of the following statements best describes your right to work in the
 * United States?", fixtures/smartrecruiters/xplor-screening): the one permanent option the person's status names, when
 * the class holds several ("I am a US citizen", "I am a US lawful permanent resident (Green Card holder)"): a citizen's
 * (the entry's status, or the person's citizenships) or a permanent resident's (workStatus.ts statusMeaningOf), else
 * null.
 */
function permanentOptionOf(options: readonly BasisOption[], entry: WorkAuthorization, citizen: boolean):
  BasisOption | null {
  const status = entry.status?.kind === 'value' ? entry.status.value : citizen ? 'citizen' : null;
  if (status !== 'citizen' && status !== 'permanent-resident') return null;
  const meanings = meaningsOfStatus(status);
  const found = options.filter((option) => {
    const meaning = statusMeaningOf(option.clean);
    return meaning !== null && meanings.includes(meaning);
  });
  return found.length === 1 ? found[0]! : null;
}

/**
 * A work-authorization question asked as a basis set (workBasis.ts), answered from the entry's basis: its option chosen
 * by its own words (legal.work-basis; the posting's country's entry under interpretation 1 is legal.posting-country,
 * flagged), the form's decline option for a declined answer (legal.decline). An entry that does not settle it is
 * legal-not-in-profile, which the `all` scope asks TailorIT's AI about with every option the form shows (plan/answers.ts;
 * no profile value, and no list narrowed by one, is ever sent); a basis the form offers no option for is no-match, left
 * as it is. Null when the options are no basis set (or not read yet), so the question is read as before. jr6 RULES
 * (SR-12): of several options of the basis, the permanent one the person's status names (permanentOptionOf); else, as
 * of several of another class, ambiguous-options.
 */
function workBasisValue(spec: FieldSpec, profile: Profile, entry: WorkAuthorization, at: string, fromPosting: boolean,
  vocab: Vocab): ValueResult | null {
  const options = readBasisOptions(spec, vocab);
  if (options === null) return null;
  const citizen = citizenOf(profile, entry.country);
  const basis = basisOfEntry(entry, citizen);
  if (basis === null) return none('legal-not-in-profile');
  const factor = fromPosting ? POSTING_COUNTRY_FACTOR : 1;
  const extra: Partial<Candidate> = fromPosting ? { flag: 'filled-low-confidence' } : {};
  if (basis === 'decline') {
    return value({ origin: byRule('legal.decline', at), confidence: VALUE_EXPLICIT * factor,
      choice: { intended: intendedDecline('generic'), domain: 'generic' }, ...extra });
  }
  const offered = options.get(basis) ?? [];
  // jr6 RULES (SR-12): no right to work where the list offers none is left as before (the `all` scope's).
  if (offered.length === 0) return none(basis === 'none' ? 'legal-not-in-profile' : 'no-match');
  const option = offered.length === 1 ? offered[0]!
    : basis === 'permanent' ? permanentOptionOf(offered, entry, citizen) : null;
  if (option === null) return none('ambiguous-options');
  const derived = basis === 'permanent' && entry.status === undefined;
  return value({ origin: fromProfile(derived ? 'screening.citizenships' : at,
    fromPosting ? 'legal.posting-country' : 'legal.work-basis'),
  confidence: VALUE_TRANSFORM * factor, choice: { intended: intendedText(option.clean), domain: 'generic' }, ...extra });
}

/**
 * Whether TailorIT's AI answer to a basis set (an `all` question the entry did not settle: workBasisValue) states what
 * the person's own answers deny: the sponsorship option when both sponsorship answers are an explicit no, an option
 * needing none when either is a yes, the permanent option when they are not authorized or hold a visa or another
 * status, the permit option when they are a citizen or permanent resident, the no-right option (jr6 RULES, SR-12) when
 * they are authorized. Such a pick is refused (planFrame planAnswer: llm-pick-rejected) and the field left flagged: a
 * guess never overrules the person's answer. Only the pick is compared here; nothing of the person's answers was sent.
 * False for any other field or option.
 */
export function basisPickContradicts(category: FieldCategory, spec: FieldSpec, index: number, profile: Profile,
  vocab: Vocab, legal: LegalContext): boolean {
  if (!BASIS_CATEGORIES.has(category)) return false;
  const options = readBasisOptions(spec, vocab);
  const picked = options === null ? null : basisClassAt(options, index);
  if (picked === null) return false;
  const found = authorizationEntry(spec, profile, vocab, legal);
  if ('reason' in found) return false;
  const entry = profile.workAuthorization[found.index]!;
  const sponsorship = combinedSponsorship(entry.sponsorshipNow, entry.sponsorshipFuture);
  const status = entry.status?.kind === 'value' ? entry.status.value : null;
  const permanentStatus = status === 'citizen' || status === 'permanent-resident';
  switch (picked) {
    case 'sponsorship':
      return sponsorship?.kind === 'value' && !sponsorship.value;
    case 'permanent':
      return (sponsorship?.kind === 'value' && sponsorship.value)
        || (entry.authorized?.kind === 'value' && !entry.authorized.value) || (status !== null && !permanentStatus);
    case 'permit':
      return (sponsorship?.kind === 'value' && sponsorship.value) || permanentStatus;
    case 'none':
      return entry.authorized?.kind === 'value' && entry.authorized.value;
  }
}

/** How a work status is written, for a list that offers statuses by name. */
const WORK_STATUS_TEXT: Readonly<Record<string, string>> = {
  citizen: 'Citizen', 'permanent-resident': 'Permanent resident', 'work-visa': 'Work visa',
  'student-visa': 'Student visa',
};

/** A criminal-history question the person's answer ("Have you ever been convicted of a crime?") never settles: an
 *  arrest, a charge (pending or not), sex-offender registration, a caution or warning, a sentence served, a diversion
 *  (the lead's decision on the Phase E review, M4). */
const NOT_CONVICTION = /\barrest\w*|\bcharge[sd]?\b|\bcharging\b|\bindict\w*|\bpending\b|\bsex(?:ual)?\s+offen\w*|\bregistered\s+(?:as\s+an?\s+)?(?:sex\s+)?offenders?\b|\boffenders?\s+regist\w*|\bcautions?\b|\breprimands?\b|\bfinal\s+warnings?\b|\bprobation\b|\bparole\b|\bincarcerat\w*|\bimprison\w*|\bjail\b|\bprison\b|\bdetained\b|\bunder\s+investigation\b|\bwarrants?\b|\bdiversion\b|\bdeferred\b|\bcited\b|\bcitations?\b/;
/** Wording that asks about a conviction at all: what the person's answer is to. */
const CONVICTION = /\bconvict\w*|\bcriminal\s+(?:records?|history|histories|background|past|offen[cs]es?|convictions?|activit\w*)\b|\bguilty\b|\bno\s+contest\b|\bnolo\s+contendere\b|\bcrimes?\b|\boffen[cs]es?\b/;
/** A narrower conviction question: one kind (a felony, a misdemeanour, a named offence), a time ("in the last 7 years",
 *  "since"), what is unspent, or exclusions ("other than minor traffic violations"). The person's No to any conviction
 *  answers it No; their Yes says nothing of it. */
const NARROWER_CONVICTION = /\bfelon\w*|\bmisdemeano\w*|\bunspent\b|\bspent\b|\b(?:in|within|during|over)\s+(?:the\s+)?(?:last|past|previous|preceding)\b|\b(?:last|past|previous)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)\s+(?:years?|months?)\b|\bsince\b|\bas\s+an?\s+(?:adult|juvenile)\b|\bexclud\w*|\bexcept\w*|\bother\s+than\b|\bnot\s+including\b|\bapart\s+from\b|\bexpunge\w*|\bsealed\b|\bpardon\w*|\bdui\b|\bdwi\b|\bdriving\b|\btraffic\b|\bdrugs?\b|\bviolen\w*|\bfraud\w*|\btheft\b|\bdishonest\w*|\bfinancial\b|\bassault\w*|\bweapons?\b|\bfirearms?\b|\bchild\w*|\bminors?\b|\bvulnerable\b|\bmoral\s+turpitude\b|\bbank\w*|\bembezzl\w*|\bmoney\s+laundering\b|\bbribery\b|\bcorruption\b|\bhealth\s?care\b/;

/**
 * The criminal-history answer (docs/SPEC-AMENDMENTS.md §6; the lead's decision on the Phase E review, M4): the person's
 * own answer is to "Have you ever been convicted of a crime?", matched by its polarity alone. A question with that
 * generic wording takes it; a narrower conviction question (NARROWER_CONVICTION) takes only a No, since no conviction
 * at all is none of a subset; an arrest, a charge or a registration (NOT_CONVICTION), or a question that asks about no
 * conviction at all, never takes it. What it does not settle is blank and flagged, criminal-not-covered.
 */
function criminalValue(spec: FieldSpec, profile: Profile): ValueResult {
  // A declined answer is theirs to give here: no decline rule fits it.
  const record = profile.screening.criminalRecord;
  if (record === undefined || record.kind === 'decline') return none('legal-not-in-profile');
  const label = normalize(spec.label, 'label');
  const question = [label.key, ...label.qualifiers.map((qualifier) => qualifier.tokens.join(' ')),
    normalize(spec.description, 'label').key].join(' ');
  if (NOT_CONVICTION.test(question) || !CONVICTION.test(question)) return none('criminal-not-covered');
  if (NARROWER_CONVICTION.test(question) && record.value) return none('criminal-not-covered');
  return yesNo(record.value, fromProfile('screening.criminalRecord'));
}

// ── s2 core-gh: the snapshot round's legal answers, each the person's own from the sensitive part ────────────────

/** The question's words as the rules read them: the label with its parentheticals, and its help text. */
function questionText(spec: FieldSpec): string {
  const label = normalize(spec.label, 'label');
  return [label.key, ...label.qualifiers.map((qualifier) => qualifier.tokens.join(' ')),
    normalize(spec.description, 'label').key].join(' ');
}

/** A yes/no legal answer as the field takes it: in a text box (decision 11) the words "Yes" or "No", only for a question
 *  asked as yes or no (labelRules YES_NO_QUESTION), the origin's transform legal.yes-no-text where it had none. */
function asTyped(result: ValueResult, spec: FieldSpec): ValueResult {
  if (spec.kind !== 'text' || !result.ok) return result;
  const { candidate } = result;
  const answer = candidate.choice?.intended;
  if (answer?.kind !== 'boolean' || !YES_NO_QUESTION.test(normalize(spec.label, 'label').key)) return result;
  const origin = candidate.origin.provenance === 'profile' && candidate.origin.transform === undefined
    ? { ...candidate.origin, transform: 'legal.yes-no-text' as const } : candidate.origin;
  return value({ ...candidate, origin, text: answer.value ? 'Yes' : 'No' });
}

/** The countries of citizenship ("Country of Origin": decision 11, the first; s2-sandtech-salary-open
 *  question_9737048101): typed by name, chosen as a country, or all of them for a list that takes several. */
function citizenshipValue(spec: FieldSpec, profile: Profile, vocab: Vocab): ValueResult {
  const answer = profile.screening.citizenships;
  if (answer === undefined) return none('legal-not-in-profile');
  if (answer.kind === 'decline') {
    return value({ origin: byRule('legal.decline', 'screening.citizenships'), confidence: VALUE_EXPLICIT,
      choice: { intended: intendedDecline('country'), domain: 'country' } });
  }
  const countries = answer.value.filter((code) => code.trim() !== '');
  if (countries.length === 0) return none('legal-not-in-profile');
  const choices = countries.map((code): Choice => ({ intended: intendedCountry(code, code, vocab), domain: 'country' }));
  const several = spec.kind === 'checkbox-group' || spec.kind === 'multiselect';
  return value({ origin: fromProfile('screening.citizenships'), confidence: VALUE_EXPLICIT,
    text: vocab.countries.byAlpha2(countries[0]!)?.name ?? countries[0]!, choice: choices[0]!,
    ...(several ? { set: choices } : {}) });
}

/** A clearance's levels, from the least. */
const CLEARANCE_RANK: Readonly<Record<string, number>> = { none: 0, 'public-trust': 1, confidential: 2, secret: 3,
  'top-secret': 4, 'ts-sci': 5 };
const CLEARANCE_TEXT: Readonly<Record<string, string>> = { none: 'None', 'public-trust': 'Public Trust',
  confidential: 'Confidential', secret: 'Secret', 'top-secret': 'Top Secret', 'ts-sci': 'TS/SCI' };

/** The level a clearance question asks about (any clearance when it names none). */
function clearanceAsked(question: string): number {
  if (/\bts\s*sci\b|\bsci\b/.test(question)) return CLEARANCE_RANK['ts-sci']!;
  if (/\btop\s+secret\b/.test(question)) return CLEARANCE_RANK['top-secret']!;
  if (/\bsecret\b/.test(question)) return CLEARANCE_RANK.secret!;
  if (/\bconfidential\b/.test(question)) return CLEARANCE_RANK.confidential!;
  return CLEARANCE_RANK['public-trust']!;
}

/** s2 core-gh review (C2): a clearance not held now (one to obtain, undergo or be sponsored for, one held once): the
 *  profile's level says nothing of it. */
const CLEARANCE_NOT_HELD = /\b(?:able|eligible|willing|qualif\w*|ready|prepared)\b(?:\s+\w+){0,3}?\s+(?:to\s+)?(?:obtain|get|acquire|undergo|receive|apply|be\s+granted|be\s+sponsored|pass)\b|\bobtain\w*\b|\bundergo\w*\b|\bsponsor\w*|\b(?:ever|previously|formerly|once)\s+(?:\w+\s+)?(?:held|had|been\s+granted|possessed)\b|\bin\s+the\s+past\b|\bexpired\b|\binactive\b/;
/** A clearance held now: hold, have, possess or maintain one, an active or a current one. */
const CLEARANCE_HELD = /\b(?:hold|holds|have|has|possess|possesses|maintain|maintains)\b|\bactive\b|\bcurrent(?:ly)?\b/;

/**
 * A clearance (s2-virtru-clearance-open question_9225664005 "Do you hold an Active TS/SCI?"): yes when the person's
 * level is the one asked or higher and, where the question asks for an active one, it is active; a text box asked for
 * the level gets its name. Only a clearance held now is answered (the s2 review, C2): one to obtain, undergo or be
 * sponsored for, or one held once, a polygraph, or an active one the profile does not say has no profile answer (the AI
 * answers it as any legal question, as settings.modes.ai allows).
 */
function clearanceValue(spec: FieldSpec, profile: Profile, vocab: Vocab): ValueResult {
  const answer = profile.screening.clearance;
  if (answer === undefined) return none('legal-not-in-profile');
  if (answer.kind === 'decline') return legalAnswer({ kind: 'decline' }, 'screening.clearance');
  const question = questionText(spec);
  if (/\bpolygraph\b/.test(question) || CLEARANCE_NOT_HELD.test(question)) return none('legal-not-in-profile');
  const { level, active } = answer.value;
  // jr6 RULES (ADP-9): which clearance the person holds, asked as a list of them.
  if (asksClearanceType(spec, question)) return clearanceTypeValue(spec, level, vocab);
  const asksLevel = spec.kind === 'text' && !YES_NO_QUESTION.test(normalize(spec.label, 'label').key);
  if (asksLevel) {
    return value({ origin: fromProfile('screening.clearance'), confidence: VALUE_EXPLICIT,
      text: CLEARANCE_TEXT[level] ?? level });
  }
  if (!CLEARANCE_HELD.test(question)) return none('legal-not-in-profile');
  const held = (CLEARANCE_RANK[level] ?? 0) >= clearanceAsked(question) && level !== 'none';
  if (held && /\bactive\b|\bcurrent(?:ly)?\b/.test(question) && active !== true) {
    return active === false ? asTyped(yesNo(false, fromProfile('screening.clearance')), spec)
      : none('legal-not-in-profile');
  }
  return asTyped(yesNo(held, fromProfile('screening.clearance')), spec);
}

/** jr6 RULES (ADP-9): a clearance asked by its type or level ("Do you have a security clearance? If yes, please indicate
 *  which type"). */
const CLEARANCE_TYPE_ASKED = /\b(?:which|what)\s+(?:type|level|kind)\b|\btype\s+of\s+(?:security\s+)?clearance\b|\bclearance\s+(?:type|level)\b/;
/** jr6 RULES (ADP-9): the option that says the person holds none ("None", "No Clearance", "N/A", "I do not have a
 *  clearance"). */
const NO_CLEARANCE_OPTION = /^(?:none|no\s+(?:active\s+|current\s+|security\s+)?clearance|not\s+applicable|n\s?a|i\s+do\s+not\s+(?:have|hold)\b(?:\s+\w+){0,4}\s+clearance)\b/;
/** The spellings a list may write a clearance level with, the first its name. */
const CLEARANCE_SPELLINGS: Readonly<Record<string, readonly [string, ...string[]]>> = {
  none: ['None', 'No Clearance', 'Not Applicable', 'N/A', 'No Security Clearance'],
  'public-trust': ['Public Trust'], confidential: ['Confidential'], secret: ['Secret'], 'top-secret': ['Top Secret'],
  'ts-sci': ['TS/SCI', 'Top Secret/SCI', 'Top Secret SCI'],
};

/** jr6 RULES (ADP-9): whether a clearance question asks which one the person holds: a list that takes several, or a
 *  list whose question asks for a type or a level, or whose options are levels rather than a yes and a no. */
function asksClearanceType(spec: FieldSpec, question: string): boolean {
  if (spec.kind === 'multiselect' || spec.kind === 'checkbox-group') return true;
  if (spec.kind === 'checkbox' || spec.kind === 'text') return false;
  if (spec.options !== 'lazy' && asksYesOrNo(spec)) return false;
  return CLEARANCE_TYPE_ASKED.test(question);
}

/**
 * jr6 RULES (ADP-9, ADP's "Do you have a security clearance? If yes, please indicate which type (Hold CTRL to select
 * multiple)", fixtures/adp/questions): which clearance the person holds, chosen by its name: for a level of none the
 * option that says so (NO_CLEARANCE_OPTION), for a level held the option naming it. On a list read, exactly one option
 * must say it (else no-match or ambiguous-options); on a list not read yet, its spellings, which the matcher finds once
 * it loads. "Meets the requirement" and "eligible to obtain" are never read from citizenship (CLEARANCE_NOT_HELD).
 */
function clearanceTypeValue(spec: FieldSpec, level: string, vocab: Vocab): ValueResult {
  const spellings = CLEARANCE_SPELLINGS[level] ?? [level];
  let choice: Choice = { intended: intendedUnknown('generic', spellings[0], spellings.slice(1), vocab), domain: 'generic' };
  if (spec.options !== 'lazy') {
    const options = prepareOptions(spec.options, 'generic', vocab).list
      .filter((option) => !option.unusable && !option.disabled && !option.injected && option.clean.trim() !== '');
    const named = level === 'none'
      ? options.filter((option) => NO_CLEARANCE_OPTION.test(normalize(option.clean, 'label').key))
      : options.filter((option) => spellings.some((spelling) => normalize(spelling, 'label').key
        === normalize(option.clean, 'label').key));
    if (named.length === 0) return none('no-match');
    if (named.length > 1) return none('ambiguous-options');
    choice = { intended: intendedText(named[0]!.clean), domain: 'generic' };
  }
  const several = spec.kind === 'multiselect' || spec.kind === 'checkbox-group';
  return value({ origin: fromProfile('screening.clearance'), confidence: VALUE_EXPLICIT, choice,
    ...(several ? { set: [choice] } : {}) });
}

/** Numbers a "within the last N years" may be written in. */
const YEAR_WORDS: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20 };
const YEAR_COUNT = String.raw`(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty)`;
/** "within the last five years", "within 5 years", "in the past 10 years" (the s2 review, C3). */
const WITHIN_YEARS = new RegExp(String.raw`\bwithin\s+(?:the\s+)?(?:(?:last|past|previous|preceding)\s+)?${YEAR_COUNT}\s+years?\b|\b(?:in|during|over)\s+the\s+(?:last|past|previous|preceding)\s+${YEAR_COUNT}\s+years?\b`);
/** A time limit of any wording ("since 2019", "in the last decade"): one WITHIN_YEARS cannot read has no answer. */
const TIME_LIMIT = /\bwithin\b|\b(?:last|past|previous|preceding)\s+(?:\w+\s+){0,2}?(?:years?|decade|months?)\b|\bsince\b/;
/** Service now: "currently", "now", "presently", "active", "a current federal employee". */
const SERVING_NOW = /\b(?:currently|presently|now)\b|\bat\s+present\b|\bactive\s+(?:duty|members?|service|serving|reserves?)\b|\bcurrent\s+(?:\w+\s+){0,2}?(?:employee|member|official|service)\b/;
/** A question about service before now too ("have you … served", "ever", "previously"). */
const SERVED_BEFORE = /\bhave\s+you\b|\bever\b|\bpreviously\b|\bformer(?:ly)?\b|\bin\s+the\s+past\b|\bwere\s+you\b/;

/**
 * U.S. military or government service (s2-onestream-related-open question_8152429009 "Are you currently or have you
 * within the last five years served in the U.S. armed forces or been employed by any U.S. federal, state, and local
 * government?"): yes when the person served in a branch the question names, and for a time limit ("within the last N
 * years", "within N years") ended it then or later; for service now only ("Are you currently…", "a current federal
 * employee"), still serves (no end year). No when every branch it names is a no, or ended outside that time. A time
 * limit it cannot read has no answer (the s2 review, C3). An empty end year means still serving.
 */
function governmentServiceValue(spec: FieldSpec, profile: Profile, now: Ymd | undefined): ValueResult {
  const answer = profile.screening.governmentService;
  if (answer === undefined) return none('legal-not-in-profile');
  if (answer.kind === 'decline') return legalAnswer({ kind: 'decline' }, 'screening.governmentService');
  const question = questionText(spec);
  const military = /\b(?:armed\s+forces|military|army|navy|air\s+force|marines?|marine\s+corps|coast\s+guard|national\s+guard|space\s+force)\b/
    .test(question);
  const government = /\bgovernment\b|\bfederal\b|\bpublic\s+sector\b/.test(question);
  if (!military && !government) return none('legal-not-in-profile');
  const within = WITHIN_YEARS.exec(question);
  const count = within?.[1] ?? within?.[2];
  const years = count === undefined ? null : YEAR_WORDS[count] ?? Number(count);
  if (years === null && TIME_LIMIT.test(question)) return none('legal-not-in-profile');
  if (years !== null && now === undefined) return none('legal-not-in-profile');
  const nowOnly = years === null && SERVING_NOW.test(question) && !SERVED_BEFORE.test(question);
  const service = answer.value;
  /** Whether one branch answers yes: never served, no; still serving (no end year), yes; else within the limit. */
  const served = (did: boolean, ended: number | undefined): boolean => {
    if (!did) return false;
    if (ended === undefined) return true;
    if (nowOnly) return false;
    return years === null || ended >= now!.y - years;
  };
  const yes = (military && served(service.military, service.militaryEndYear))
    || (government && served(service.government, service.governmentEndYear));
  return asTyped(yesNo(yes, fromProfile('screening.governmentService')), spec);
}

/**
 * A relative at the company (s2-onestream-related-open question_8152427009 "Are you related to anyone currently
 * employed at OneStream?"): yes when the person named the posting's company (values.ts companyKey) among those where a
 * relative works, no otherwise (none named: no everywhere). Only for a question that names the posting's company or
 * points at it ("here", "this company"); without the posting's company there is no answer. No relative's name is held.
 */
function relativesValue(spec: FieldSpec, profile: Profile, postingCompany: string | undefined): ValueResult {
  const answer = profile.screening.relativesAt;
  if (answer === undefined) return none('legal-not-in-profile');
  if (answer.kind === 'decline') return legalAnswer({ kind: 'decline' }, 'screening.relativesAt');
  const company = postingCompany === undefined ? '' : companyKey(postingCompany);
  if (company === '' || !namesPostingCompany(`${spec.label} ${spec.description}`, company)) {
    return none('legal-not-in-profile');
  }
  const related = answer.value.some((name) => companyKey(name) === company);
  return asTyped(yesNo(related, fromProfile('screening.relativesAt')), spec);
}

/** The two sentences a right-to-work question may offer instead of a Yes and a No (s2-tripledot-right-to-work-open
 *  question_9934444101: "I have the right to work", "I require visa/sponsorship"), as normalizeLabel reads them. */
const RIGHT_OPTION = /^i\s+(?:have|hold)\s+(?:the\s+|a\s+)?(?:legal\s+)?right\s+to\s+work\b|^i\s+am\s+(?:legally\s+)?(?:authori[sz]ed|eligible|entitled|permitted)\s+to\s+work\b/;
const NEED_OPTION = /^i\s+(?:will\s+)?(?:require|need)\b(?:\s+\w+){0,3}?\s+(?:visas?|sponsor\w*|work\s+permits?|immigration)\b/;

/**
 * An authorization question whose two options state the right to work and the need for a visa or sponsorship: the
 * first for a person explicitly authorized, the second for one who is not and needs sponsorship (now or later), chosen
 * by its own words. Null for any other list (or one not read yet), so the question is read as before.
 */
function rightToWorkValue(spec: FieldSpec, entry: WorkAuthorization, at: string, fromPosting: boolean, vocab: Vocab):
  ValueResult | null {
  if (spec.options === 'lazy') return null;
  const usable = prepareOptions(spec.options, 'generic', vocab).list.filter((option) => !option.unusable);
  if (usable.length !== 2) return null;
  const read = usable.map((option) => ({ option, label: normalize(option.clean, 'label').key }));
  const right = read.find(({ label }) => RIGHT_OPTION.test(label));
  const need = read.find(({ label }) => NEED_OPTION.test(label));
  if (right === undefined || need === undefined || right === need) return null;
  const authorized = entry.authorized;
  if (authorized === undefined) return none('legal-not-in-profile');
  if (authorized.kind === 'decline') return none('decline-option-missing');
  const sponsorship = combinedSponsorship(entry.sponsorshipNow, entry.sponsorshipFuture);
  const chosen = authorized.value ? right : sponsorship?.kind === 'value' && sponsorship.value ? need : null;
  if (chosen === null) return none('legal-not-in-profile');
  const factor = fromPosting ? POSTING_COUNTRY_FACTOR : 1;
  return value({ origin: fromProfile(`${at}.authorized`, fromPosting ? 'legal.posting-country' : undefined),
    confidence: VALUE_EXPLICIT * factor, choice: { intended: intendedText(chosen.option.clean), domain: 'generic' },
    ...(fromPosting ? { flag: 'filled-low-confidence' as const } : {}) });
}

// s2 core-gh end

/** The value of a legal question (§8.7): authorization, sponsorship, status and age from explicit answers only. */
export function legalValue(category: FieldCategory, spec: FieldSpec, profile: Profile, vocab: Vocab,
  legal: LegalContext): ValueResult {
  if (category === 'screening.criminalHistory') return criminalValue(spec, profile);
  if (category === 'screening.over18') return legalAnswer(profile.screening.over18, 'screening.over18');
  // s2 core-gh: the snapshot round's legal answers (decision 11 and the gh study's §1).
  switch (category) {
    case 'workAuth.citizenship':
      return citizenshipValue(spec, profile, vocab);
    case 'workAuth.clearance':
      return clearanceValue(spec, profile, vocab);
    case 'screening.restrictiveAgreement':
      return asTyped(legalAnswer(profile.screening.restrictiveAgreement, 'screening.restrictiveAgreement'), spec);
    case 'screening.essentialFunctions':
      return asTyped(legalAnswer(profile.screening.essentialFunctions, 'screening.essentialFunctions'), spec);
    case 'screening.governmentService':
      return governmentServiceValue(spec, profile, legal.now);
    case 'screening.relatives':
      return relativesValue(spec, profile, legal.postingCompany);
    // jr6 RULES R3 (WD-29).
    case 'screening.militaryTraining':
      return asTyped(militaryTrainingValue(profile), spec);
    default:
      break;
  }
  if (category === 'workAuth.visaType') return none('legal-not-in-profile');
  // jr6 RULES (JV-7, JV-11, JZ-7, JZ-8): a work status by its meaning, for the country the question or its options name;
  // a basis set whose options state a sponsorship need is read as before, below (a visa named by its type alone, "H-1B
  // Visa", is a status there).
  if (category === 'workAuth.status' && (readBasisOptions(spec, vocab) === null
    || (spec.options !== 'lazy' && namesStatusList(spec.options.map((option) => option.label))))) {
    return workStatusValue(spec, profile, vocab, legal);
  }
  const found = authorizationEntry(spec, profile, vocab, legal);
  if ('reason' in found) return none(found.reason);
  const entry = profile.workAuthorization[found.index]!;
  const at = `workAuthorization[${found.index}]`;
  const { fromPosting } = found;
  // jr6 RULES (SR-4): the located country's entry, flagged (a basis set or a right-to-work pair as the posting's).
  const located = found.located === true;
  const flagged = fromPosting || located;
  // A status is never read for a country the question does not name (below), as a basis set or by name.
  const basis = BASIS_CATEGORIES.has(category) && !(category === 'workAuth.status' && fromPosting)
    ? workBasisValue(spec, profile, entry, at, flagged, vocab) : null;
  if (basis !== null) return basis;
  switch (category) {
    // s2 core-gh (decision 11): a text box asked yes or no takes the words (asTyped).
    case 'workAuth.authorized':
      return rightToWorkValue(spec, entry, at, flagged, vocab)
        ?? asTyped(legalAnswer(entry.authorized, `${at}.authorized`, undefined, fromPosting, located), spec);
    case 'workAuth.sponsorshipNow':
      return asTyped(legalAnswer(entry.sponsorshipNow, `${at}.sponsorshipNow`, undefined, fromPosting, located), spec);
    case 'workAuth.sponsorshipFuture':
      return asTyped(legalAnswer(entry.sponsorshipFuture, `${at}.sponsorshipFuture`, undefined, fromPosting, located),
        spec);
    case 'workAuth.sponsorship':
      return asTyped(legalAnswer(combinedSponsorship(entry.sponsorshipNow, entry.sponsorshipFuture), at,
        'legal.sponsorship-combined', fromPosting, located), spec);
    case 'workAuth.status': {
      const status = entry.status;
      if (status === undefined) return none('legal-not-in-profile');
      // A status is written by name, never read for a country the question does not name.
      if (fromPosting) return none('work-auth-country-unknown');
      if (status.kind === 'decline') {
        return value({ origin: byRule('legal.decline', `${at}.status`), confidence: VALUE_EXPLICIT,
          choice: { intended: intendedDecline('generic'), domain: 'generic' } });
      }
      const text = WORK_STATUS_TEXT[status.value];
      if (text === undefined) return none('legal-not-in-profile');
      return value({ origin: fromProfile(`${at}.status`), confidence: VALUE_EXPLICIT, text,
        choice: { intended: { kind: 'text', text }, domain: 'generic' } });
    }
    // jr6 RULES (WD-30): OPT or CPT to begin or continue employment.
    case 'workAuth.opt':
      return asTyped(optValue(entry, at, flagged), spec);
    default:
      return none('legal-not-in-profile');
  }
}

// ── jr6 RULES (FIXPLAN §6.3 R2, items 27 to 34): work authorization read by its meaning ──────────────────────────────

/** The country a work-status question asks about (JV-7, JV-11, JZ-7, JZ-8), or why there is none: the one its label
 *  (else its description) names, by name, short form or its people's adjective; else the one its options name (each
 *  names at most one: "U.S. Citizen/Permanent Resident", "Canadian Citizen/Permanent Resident"), and of several the one
 *  the person holds an entry or a citizenship for, else the posting's among them (JZ-7); else, under interpretation 1,
 *  the posting's (`fromPosting`), where only a yes or no is ever read (a status is never written for a country the
 *  question does not name). */
function statusCountry(spec: FieldSpec, profile: Profile, vocab: Vocab, legal: LegalContext,
  options: readonly StatusOption[] | null): { country: string; fromPosting: boolean }
  | { reason: 'work-auth-country-unknown' } {
  let places = placesNamed(spec.label, vocab);
  let named = countriesOfStatus(spec.label, vocab);
  if (named.length === 0 && !places.ambiguous && spec.description !== '') {
    places = placesNamed(spec.description, vocab);
    named = countriesOfStatus(spec.description, vocab);
  }
  if (places.ambiguous || named.length > 1) return { reason: 'work-auth-country-unknown' };
  if (named.length === 1) return { country: named[0]!, fromPosting: false };
  const offered = [...new Set((options ?? []).flatMap((option) => option.countries))];
  if (offered.length === 1) return { country: offered[0]!, fromPosting: false };
  if (offered.length > 1) {
    const citizenships = profile.screening.citizenships?.kind === 'value' ? profile.screening.citizenships.value : [];
    const held = offered.filter((country) => profile.workAuthorization.some((entry) => entry.country === country)
      || citizenships.includes(country));
    if (held.length === 1) return { country: held[0]!, fromPosting: false };
    return legal.postingCountry !== undefined && offered.includes(legal.postingCountry)
      ? { country: legal.postingCountry, fromPosting: false } : { reason: 'work-auth-country-unknown' };
  }
  const posting = legal.postingCountry
    ?? (profile.workAuthorization.length === 1 ? profile.workAuthorization[0]!.country : undefined);
  return legal.settings.interpretations.postingCountryForLegal && posting !== undefined
    ? { country: posting, fromPosting: true } : { reason: 'work-auth-country-unknown' };
}

/** The person's work status for a country: the entry's own (or its decline), else a citizen of a country among their
 *  citizenships (`derived`: item 28, "status from screening.citizenships when none is set"); null when neither says. */
function personStatus(profile: Profile, country: string):
  { status: WorkStatus | 'decline'; at: string; derived: boolean; index: number } | null {
  const index = profile.workAuthorization.findIndex((entry) => entry.country === country);
  const status = index < 0 ? undefined : profile.workAuthorization[index]!.status;
  if (status !== undefined) {
    return { status: status.kind === 'decline' ? 'decline' : status.value, at: `workAuthorization[${index}].status`,
      derived: false, index };
  }
  const citizenships = profile.screening.citizenships;
  if (citizenships?.kind === 'value' && citizenships.value.includes(country)) {
    return { status: 'citizen', at: 'screening.citizenships', derived: true, index };
  }
  return null;
}

/** The right a non-citizen's entry states (JV-11, JZ-7: "Non-citizen allowed to work …"), only from its authorization
 *  and sponsorship answers: authorized with no sponsorship now or later, any employer; authorized and needing it now,
 *  the current employer; not authorized, seeking authorization. Null when they do not say. */
function nonCitizenRight(entry: WorkAuthorization | undefined): StatusMeaning | null {
  if (entry?.authorized?.kind !== 'value') return null;
  if (!entry.authorized.value) return 'seeking';
  const sponsorship = combinedSponsorship(entry.sponsorshipNow, entry.sponsorshipFuture);
  if (sponsorship?.kind === 'value' && !sponsorship.value) return 'any-employer';
  return entry.sponsorshipNow?.kind === 'value' && entry.sponsorshipNow.value ? 'current-employer' : null;
}

/** The statuses a yes-or-no question asks about (JZ-8): a citizen, a permanent resident, or either. */
const ASKED_STATUSES: Readonly<Partial<Record<StatusMeaning, readonly WorkStatus[]>>> = {
  citizen: ['citizen'], resident: ['permanent-resident'], 'citizen-or-resident': ['citizen', 'permanent-resident'],
};

/** JZ-8: a question (or a box's statement) of the person's own status: "Are you a US citizen …", "I am a U.S. citizen",
 *  "Do you hold a green card". Never a requirement the status may meet ("… which requires US citizenship. Do you meet
 *  this requirement?": ADP-9, never inferred from citizenship). */
const ASKS_OWN_STATUS = /^(?:(?:are|r)\s+you|i\s+am|im|you\s+are)\s+(?:currently\s+|now\s+|either\s+)?(?:a\s+|an\s+)?(?:\w+\s+){0,3}?(?:citizen|permanent\s+resident|green\s+card)|^(?:do|did)\s+you\s+(?:currently\s+)?(?:have|hold|possess)\s+(?:a\s+|an\s+)?(?:\w+\s+){0,2}?(?:citizenship|green\s+card|permanent\s+residen\w*)/;

/**
 * JZ-8 (JazzHR's "Are you a US Citizen or Permanent Resident?", Yes/No boxes; "Are you a U.S. citizen?"): a status asked
 * as yes or no. Yes for a status among those it asks of that country (a citizen among the person's citizenships too),
 * no for any other explicit status, and for a citizenship-only question no when the person's citizenships, stated, do
 * not include that country; else nothing (legal-not-in-profile). Only a question of the person's own status
 * (ASKS_OWN_STATUS).
 */
function statusYesNo(spec: FieldSpec, profile: Profile, country: string, fromPosting: boolean): ValueResult {
  const asked = ASKS_OWN_STATUS.test(normalize(spec.label, 'label').key)
    ? ASKED_STATUSES[statusMeaningOf(spec.label) ?? 'visa'] : undefined;
  if (asked === undefined) return none('legal-not-in-profile');
  const person = personStatus(profile, country);
  const factor = fromPosting ? POSTING_COUNTRY_FACTOR : 1;
  const extra: Partial<Candidate> = fromPosting ? { flag: 'filled-low-confidence' } : {};
  const transform = fromPosting ? 'legal.posting-country' : 'legal.work-status';
  if (person?.status === 'decline') return legalAnswer({ kind: 'decline' }, person.at, undefined, fromPosting);
  if (person !== null && (!person.derived || asked.includes('citizen'))) {
    return yesNo(asked.includes(person.status), fromProfile(person.at, transform),
      (person.derived ? VALUE_TRANSFORM : VALUE_EXPLICIT) * factor, extra);
  }
  const citizenships = profile.screening.citizenships;
  if (person === null && asked.length === 1 && asked[0] === 'citizen' && citizenships?.kind === 'value'
    && citizenships.value.length > 0) {
    return yesNo(false, fromProfile('screening.citizenships', transform), VALUE_TRANSFORM * factor, extra);
  }
  return none('legal-not-in-profile');
}

/**
 * JV-7, JV-11, JZ-7 (FIXPLAN §6.3 items 27 to 29): a work status chosen among a list's statuses by their meaning
 * (workStatus.ts), for the country the question names, or its options name (statusCountry): a citizen's (or a citizen
 * by the person's citizenships) or a permanent resident's own option, of that country or none; a non-citizen's right
 * (nonCitizenRight), flagged; never a visa by its type (the profile holds none). A status the profile does not settle is
 * legal-not-in-profile, which the `all` scope asks TailorIT's AI about, never work-auth-country-unknown; a known status
 * the list does not offer is no-match. A list not read yet (or read in part) takes the status by name, as before; a
 * status asked as yes or no is statusYesNo's.
 */
function workStatusValue(spec: FieldSpec, profile: Profile, vocab: Vocab, legal: LegalContext): ValueResult {
  const yesOrNo = asksYesOrNo(spec);
  const options = yesOrNo ? null : readStatusOptions(spec, vocab);
  const found = statusCountry(spec, profile, vocab, legal, options);
  if ('reason' in found) return none(found.reason);
  const { country, fromPosting } = found;
  if (yesOrNo) return statusYesNo(spec, profile, country, fromPosting);
  const person = personStatus(profile, country);
  if (person === null) return none('legal-not-in-profile');
  // A status is written by name, never read for a country the question does not name.
  if (fromPosting) return none('work-auth-country-unknown');
  if (person.status === 'decline') {
    return value({ origin: byRule('legal.decline', person.at), confidence: VALUE_EXPLICIT,
      choice: { intended: intendedDecline('generic'), domain: 'generic' } });
  }
  if (options === null) {
    const text = WORK_STATUS_TEXT[person.status];
    if (text === undefined || person.derived) return none('legal-not-in-profile');
    return value({ origin: fromProfile(person.at), confidence: VALUE_EXPLICIT, text,
      choice: { intended: { kind: 'text', text }, domain: 'generic' } });
  }
  const entry = person.index < 0 ? undefined : profile.workAuthorization[person.index];
  const permanent = person.status === 'citizen' || person.status === 'permanent-resident';
  const right = permanent ? null : nonCitizenRight(entry);
  if (!permanent && right === null) return none('legal-not-in-profile');
  const meanings = permanent ? meaningsOfStatus(person.status as 'citizen' | 'permanent-resident') : [right!];
  const option = statusOptionFor(options, meanings, country);
  if (option === 'none') return none(permanent ? 'no-match' : 'legal-not-in-profile');
  if (option === 'several') return none('ambiguous-options');
  const at = permanent ? person.at : `workAuthorization[${person.index}].authorized`;
  return value({ origin: fromProfile(at, 'legal.work-status'),
    confidence: permanent && !person.derived ? VALUE_EXPLICIT : VALUE_TRANSFORM,
    choice: { intended: intendedText(option.clean), domain: 'generic' },
    ...(permanent ? {} : { flag: 'filled-low-confidence' as const }) });
}

/**
 * WD-30 (AEP's "Will you be using Optional Practical Training (OPT) or STEM OPT to begin employment at AEP?"): OPT or
 * CPT to begin or continue employment. No only when the person needs no sponsorship now or later (both an explicit
 * no); yes for a student visa (F-1, on which OPT is worked), flagged; otherwise nothing.
 */
function optValue(entry: WorkAuthorization, at: string, fromPosting: boolean): ValueResult {
  const sponsorship = combinedSponsorship(entry.sponsorshipNow, entry.sponsorshipFuture);
  const factor = fromPosting ? POSTING_COUNTRY_FACTOR : 1;
  const transform = fromPosting ? 'legal.posting-country' : 'legal.opt';
  if (sponsorship?.kind === 'value' && !sponsorship.value) {
    return yesNo(false, fromProfile(at, transform), VALUE_TRANSFORM * factor,
      fromPosting ? { flag: 'filled-low-confidence' } : {});
  }
  if (entry.status?.kind === 'value' && entry.status.value === 'student-visa') {
    return yesNo(true, fromProfile(`${at}.status`, transform), VALUE_TRANSFORM * factor,
      { flag: 'filled-low-confidence' });
  }
  return none('legal-not-in-profile');
}

// jr6 RULES end

// ---------------------------------------------------------------------------------------------------------------
// EEO

/** The vocabulary domain of each EEO category the profile can answer. */
const EEO_DOMAIN: Readonly<Partial<Record<FieldCategory, VocabDomain>>> = {
  'eeo.gender': 'eeo.gender', 'eeo.hispanicLatino': 'eeo.hispanicLatino', 'eeo.race': 'eeo.race',
  'eeo.veteran': 'eeo.veteran', 'eeo.disability': 'eeo.disability',
};

/** The kinds an EEO answer is chosen through; a lone checkbox states one answer in its label, which the policy does
 *  not read, so it is left to the person. */
const EEO_CHOICE_KINDS: readonly FieldKind[] = ['select', 'radio', 'combobox', 'checkbox-group', 'multiselect'];

/** An EEO vocabulary entity as a choice. */
function eeoChoice(domain: VocabDomain, answer: string, vocab: Vocab, extra: Partial<Choice> = {}): Choice | null {
  const entity = vocab.entity(`${domain}:${answer}`);
  return entity ? { intended: intendedEntity(vocab, domain, entity), domain, ...extra } : null;
}

/** Whether a veteran question asks about protected status (VEVRAA's classifications), by its label, its help text or
 *  its options: then a veteran who is not a protected one answers "not a protected veteran". */
function asksProtectedStatus(spec: FieldSpec): boolean {
  const options = spec.options === 'lazy' ? [] : spec.options.map((option) => option.label);
  return [spec.label, spec.description, ...options].some((text) => /\bprotected\b/i.test(text));
}

/**
 * The decline default (rule eeo.decline-default, settings.interpretations.eeoDeclineByDefault): the form's decline
 * option for a self-identification question the profile leaves unanswered, or one asked while this browser may not read
 * the sensitive part. It names no profile path; the matcher chooses only a decline option (decline-option-missing
 * when the form offers none), and a lone checkbox stays the person's. Null while the setting is off.
 */
export function eeoDeclineDefault(category: FieldCategory, spec: FieldSpec, settings: Settings): ValueResult | null {
  if (!settings.interpretations.eeoDeclineByDefault) return null;
  if (!EEO_CHOICE_KINDS.includes(spec.kind)) return none('format-unsupported');
  const domain: VocabDomain = EEO_DOMAIN[category] ?? 'generic';
  return value({ origin: { provenance: 'rule', ruleId: 'eeo.decline-default' }, confidence: VALUE_EXPLICIT,
    choice: { intended: intendedDecline(domain), domain }, note: 'eeo-decline-default' });
}

// ── s2 core-gh (decision 12: the eeo study's §2A, fixtures/greenhouse/s2-pie-eeo-0..8) ─────────────────────────────

/** A question that asks about serving members too ("a veteran or active member"). */
const ACTIVE_MEMBER = /\bactive\s+(?:duty|members?|military|service|serving|reserv\w*)\b|\bcurrently\s+serving\b/i;
/** A race list's own Hispanic or Latino option, as normalizeLabel reads it ("Hispanic, Latinx or of Spanish Origin",
 *  "Hispanic or Latino"); "White (Not Hispanic or Latino)" reads "white". */
const HISPANIC_RACE_OPTION = /^(?:hispanic|latin[aoex]|latine|spanish)\b/;
/** A race list's Asian subgroup options, and its plain Asian option. */
const ASIAN_SUBGROUP_OPTION = /^(?:east|south|southeast|south\s+east)\s+asian\b/;
const ASIAN_OPTION = /^asian(?:\s+american)?$/;
/** The Asian subgroups as Pie's demographic list words them (s2-pie-eeo-1), with their other spellings. */
const SUBGROUP_LABELS: Readonly<Record<AsianSubgroup, readonly [string, ...string[]]>> = {
  'east-asian': ['East Asian'], 'south-asian': ['South Asian'], 'southeast-asian': ['Southeast Asian', 'South East Asian',
    'South-East Asian'],
};
/** Sexual orientations as Pie's demographic list words them (s2-pie-eeo-2), with their other spellings. */
const ORIENTATION_LABELS: Readonly<Record<SexualOrientation, readonly [string, ...string[]]>> = {
  asexual: ['Asexual'], 'bisexual-pansexual': ['Bisexual and/or pansexual', 'Bisexual or pansexual', 'Bisexual',
    'Pansexual'], gay: ['Gay'], heterosexual: ['Heterosexual', 'Straight', 'Heterosexual or straight',
    'Straight/Heterosexual'], lesbian: ['Lesbian'], queer: ['Queer'],
  'self-describe': ['I prefer to self-describe', 'Prefer to self-describe', 'Self-describe', 'I use another term'],
};
const SELF_DESCRIBE = ORIENTATION_LABELS['self-describe'];

const optionLabels = (spec: FieldSpec) => (spec.options === 'lazy' ? []
  : spec.options.map((option) => normalize(option.label, 'label').key));
/** Whether a race list offers its own Hispanic or Latino option. */
const offersHispanicRace = (spec: FieldSpec) => optionLabels(spec).some((label) => HISPANIC_RACE_OPTION.test(label));
/** Whether a race list splits Asian into subgroups and offers no plain Asian option. */
const splitsAsian = (spec: FieldSpec) => {
  const labels = optionLabels(spec);
  return labels.some((label) => ASIAN_SUBGROUP_OPTION.test(label)) && !labels.some((label) => ASIAN_OPTION.test(label));
};

/** An Asian subgroup as a choice, by its words. */
function subgroupChoice(subgroup: AsianSubgroup, vocab: Vocab, extra: Partial<Choice>): Choice {
  const [first, ...rest] = SUBGROUP_LABELS[subgroup];
  return { intended: intendedUnknown('eeo.race', first, rest, vocab), domain: 'eeo.race', ...extra };
}

/**
 * Sexual orientation (a set, s2-pie-eeo-2 "How would you describe your sexual orientation? (mark all that apply)")
 * and whether the person identifies as transgender (s2-pie-eeo-3), from the sensitive part: an orientation chosen by its
 * words, several on a list that takes several, one on a list that takes one only when there is one, the self-describe
 * option with the person's words; transgender by polarity. A decline is the form's decline option; no answer the
 * decline default, as before.
 */
function orientationOrTransgender(category: 'eeo.sexualOrientation' | 'eeo.transgender', spec: FieldSpec,
  profile: Profile, settings: Settings, vocab: Vocab): ValueResult {
  const answer = category === 'eeo.transgender' ? profile.eeo.transgender : profile.eeo.sexualOrientation;
  if (answer === undefined) return eeoDeclineDefault(category, spec, settings) ?? none('eeo-not-in-profile');
  if (!EEO_CHOICE_KINDS.includes(spec.kind)) return none('format-unsupported');
  const at = category === 'eeo.transgender' ? 'eeo.transgender' : 'eeo.sexualOrientation';
  if (answer.kind === 'decline') {
    return value({ origin: byRule('eeo.decline', at), confidence: VALUE_EXPLICIT,
      choice: { intended: intendedDecline('generic'), domain: 'generic' } });
  }
  if (typeof answer.value === 'boolean') return yesNo(answer.value, fromProfile(at));
  const { values, selfDescribed } = answer.value;
  const set = values.map((orientation): Choice => {
    const [first, ...rest] = ORIENTATION_LABELS[orientation];
    return { intended: intendedUnknown('generic', first, rest, vocab), domain: 'generic',
      ...(orientation === 'self-describe' && selfDescribed ? { freeText: selfDescribed } : {}) };
  });
  if (set.length === 0) return none('eeo-not-in-profile');
  const several = spec.kind === 'checkbox-group' || spec.kind === 'multiselect';
  if (!several && set.length > 1) return none('ambiguous-options');
  return value({ origin: fromProfile(at), confidence: VALUE_EXPLICIT, set,
    ...(set.length === 1 ? { choice: set[0]! } : {}) });
}

// s2 core-gh end

/** The value of a self-identification question (§8.7). */
export function eeoValue(category: FieldCategory, spec: FieldSpec, profile: Profile, settings: Settings, vocab: Vocab):
  ValueResult {
  // s2 core-gh (decision 12): sexual orientation and transgender identity have answers now.
  if (category === 'eeo.sexualOrientation' || category === 'eeo.transgender') {
    return orientationOrTransgender(category, spec, profile, settings, vocab);
  }
  const domain = EEO_DOMAIN[category];
  if (domain === undefined) return eeoDeclineDefault(category, spec, settings) ?? none('eeo-not-in-profile');
  const { eeo } = profile;
  const question = category.slice('eeo.'.length) as 'gender' | 'hispanicLatino' | 'race' | 'veteran' | 'disability';
  const answer: Explicit<unknown> | undefined = eeo[question];
  if (answer === undefined) return eeoDeclineDefault(category, spec, settings) ?? none('eeo-not-in-profile');
  if (!EEO_CHOICE_KINDS.includes(spec.kind)) return none('format-unsupported');
  const at = `eeo.${question}`;
  if (answer.kind === 'decline') {
    return value({ origin: byRule('eeo.decline', at), confidence: VALUE_EXPLICIT,
      choice: { intended: intendedDecline(domain), domain } });
  }
  const explicitValue = (choice: Choice | null, transform?: RuleId, extra: Partial<Candidate> = {}): ValueResult =>
    (choice === null ? none('eeo-not-in-profile')
      : value({ origin: fromProfile(at, transform), confidence: VALUE_EXPLICIT, choice, set: [choice], ...extra }));
  switch (question) {
    case 'gender': {
      const gender = eeo.gender as Extract<Profile['eeo']['gender'], { kind: 'value' }>;
      const { identity, selfDescribed } = gender.value;
      if (identity !== 'self-describe') return explicitValue(eeoChoice(domain, identity, vocab));
      const choice = eeoChoice(domain, identity, vocab, selfDescribed ? { freeText: selfDescribed } : {});
      return explicitValue(choice, 'eeo.self-describe', { flag: 'other-option-with-free-text' });
    }
    case 'hispanicLatino':
    case 'disability': {
      const yes = (answer as { value: boolean }).value;
      return explicitValue(eeoChoice(domain, yes ? 'yes' : 'no', vocab));
    }
    case 'veteran': {
      // A question about protected status (VEVRAA's "I am not a protected veteran") is answered by protected status:
      // every classification needs service, so someone who never served is not a protected veteran either. A question
      // about service is answered by service.
      const veteran = (eeo.veteran as Extract<Profile['eeo']['veteran'], { kind: 'value' }>).value;
      // s2 core-gh (decision 12; s2-pie-eeo-5 "Are you a veteran or active member of the United States Armed Forces?"):
      // serving now answers a question that asks about active members too.
      const serving = veteran.activeDuty === true && ACTIVE_MEMBER.test(`${spec.label} ${spec.description}`);
      const id = veteran.protected ? 'protected-veteran'
        : asksProtectedStatus(spec) ? 'not-protected-veteran' : veteran.veteran || serving ? 'veteran' : 'not-veteran';
      return explicitValue(eeoChoice(domain, id, vocab));
    }
    case 'race': {
      const races = (eeo.race as Extract<Profile['eeo']['race'], { kind: 'value' }>).value;
      const hispanic = eeo.hispanicLatino?.kind === 'value' ? { hispanicLatino: eeo.hispanicLatino.value } : {};
      // s2 core-gh (decision 12; s2-pie-eeo-1): a list that splits "Asian" takes the person's subgroups instead.
      const split = splitsAsian(spec);
      const subgroups = split ? eeo.raceSubgroups ?? [] : [];
      const choices = races.flatMap((race) => (race === 'asian' && subgroups.length > 0
        ? subgroups.map((subgroup) => subgroupChoice(subgroup, vocab, hispanic))
        : [eeoChoice(domain, race, vocab, hispanic)]));
      if (choices.some((choice) => choice === null)) return none('eeo-not-in-profile');
      const set = choices as Choice[];
      // s2 core-gh (decision 12): Hispanic or Latino, answered yes, is the list's Hispanic or Latino option where it
      // offers one: added to a list that takes several, chosen on a list that takes one (EEO-1's rule).
      const latino = hispanic.hispanicLatino === true && offersHispanicRace(spec)
        ? eeoChoice(domain, 'hispanic-latino', vocab, hispanic) : null;
      if (spec.kind === 'checkbox-group' || spec.kind === 'multiselect') {
        const own = eeo.raceSelfDescribed?.trim() ?? '';
        const described = own === '' ? [] : [{ intended: intendedUnknown('generic', SELF_DESCRIBE[0], SELF_DESCRIBE.slice(1),
          vocab), domain: 'generic', freeText: own } satisfies Choice];
        return value({ origin: fromProfile(at), confidence: VALUE_EXPLICIT,
          set: [...set, ...(latino === null ? [] : [latino]), ...described] });
      }
      if (latino !== null) return explicitValue(latino, 'eeo.hispanic-race');
      if (set.length === 1) return explicitValue(set[0]!);
      if (!settings.interpretations.twoOrMoreRaces) return none('ambiguous-options');
      const two = eeoChoice(domain, 'two-or-more-races', vocab, hispanic);
      return two === null ? none('ambiguous-options')
        : value({ origin: fromProfile(at, 'eeo.two-or-more-races'), confidence: VALUE_TWO_OR_MORE_RACES, choice: two,
          flag: 'filled-low-confidence' });
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Consent

/** The settings category a consent kind is pre-approved under; AI attestations and unrecognised consent have none. */
function consentCategoryOf(category: FieldCategory): ConsentCategory | null {
  const kind = category.startsWith('consent.') ? category.slice('consent.'.length) : '';
  return (CONSENT_CATEGORIES as readonly string[]).includes(kind) ? kind as ConsentCategory : null;
}

/** What a consent's answer reads besides its kinds (the owner's decision of 2026-11-01). */
export interface ConsentContext {
  /** The form requires it: it is needed to apply. */
  required: boolean;
  /** The run used no AI at all (a profile-only frame, and no AI asked for its application before), so an "I did not
   *  use AI" attestation is true. */
  aiFree: boolean;
  /** For a consent asked as a choice (classifyRules consentChoiceOption): the clean label of its one option that
   *  plainly agrees, which its tick chooses; 'pending' while its options are not read; null or absent for a box, or a
   *  radio group of Yes and No (its Yes chosen by polarity). */
  choice?: string | 'pending' | null;
  /** The field is a list, a combobox or a radio group (absent: a box or a text). With no `choice`, it offers an option
   *  that does not agree (a Yes and a No): a question. */
  list?: boolean;
  /** jr6 RULES R3 (ICIMS-15): the field is a lone box (a signature ticked, not typed). */
  box?: boolean;
  /** v4 (D5): a binding waiver the rules once handed to the person, asked as an agreement (Yes/No), decided here: agreed
   *  only when the form requires it, under either mode, and an optional one left unanswered, decided, as an optional
   *  binding box is (the disclosure: "except a binding clause the form does not require"). A consent read from its help
   *  text alone (the other cause the rules once handed over) needs no flag: its kinds decide it like any consent's (the
   *  v4 review, security M3). */
  bindingWaiver?: true;
}

/** A consent's tick (or Yes, or its one option that agrees: `option`), by the rule that gives it. */
const ticked = (ruleId: RuleId, option?: string | null): ValueResult => value({ origin: { provenance: 'rule', ruleId },
  confidence: VALUE_CONSENT_PREAPPROVED,
  choice: typeof option === 'string' ? { intended: intendedText(option), domain: 'generic' satisfies MatchDomain }
    : { intended: { kind: 'boolean', value: true }, domain: 'polarity' satisfies MatchDomain }, check: true });

/**
 * The value of a consent field (§8.7; the owner's decision of 2026-11-01, docs/SPEC-AMENDMENTS.md §11): an AI
 * attestation (any consent that names AI) is ticked only when the run used no AI at all (consent.no-ai-attestation),
 * and otherwise left for the person (ai-attestation-ai-used), whatever the Consents mode. Every other consent is ticked
 * when each kind it names is approved (consent.preapproved), else when the form requires it, binding clauses included
 * (consent.required: it is needed to apply). Approved means, under Consents: All (settings.modes.consents, the
 * default since v3 Phase 3: the owner's decision of 2026-11-01, SPEC-AMENDMENTS §12), that every kind it names is one
 * the extension recognises, marketing, text messages and future jobs included, like Jobright; under Required only, that
 * each is pre-approved in settings. An unrecognised consent (a binding clause) is never approved: it is ticked only when
 * the form requires it. An optional one not approved is left unticked and recorded as decided
 * (consent-optional-unticked, never the person's). A signature types the person's full name on the same terms. A
 * consent asked as a choice ticks by choosing its one option that agrees (ConsentContext.choice), and waits for its
 * options while they are not read (waiting-for-options: the loop opens the list), so it is decided on what the list
 * really offers.
 */
export function consentValue(category: FieldCategory, consentKinds: readonly FieldCategory[] | undefined,
  profile: Profile, settings: Settings, consent: ConsentContext): ValueResult {
  const named = consentKinds && consentKinds.length > 0 ? consentKinds : [category];
  const attests = category === 'consent.aiAttestation' || named.includes('consent.aiAttestation');
  if (attests && !consent.aiFree) return none('ai-attestation-ai-used', true, true);
  if (consent.choice === 'pending') return none('waiting-for-options');
  const option = consent.choice;
  if (category === 'consent.aiAttestation') return ticked('consent.no-ai-attestation', option);
  // A true attestation among the label's kinds asks nothing more: the rest decide.
  const kinds = named.filter((kind) => kind !== 'consent.aiAttestation');
  const all = settings.modes.consents === 'all';
  // The v4 review (security M3): a consent read from its help text alone is approved by its kinds like any other, never
  // whatever it covers: an optional binding clause there ("By checking this box I agree to binding arbitration") is
  // left unticked under All too.
  const approved = consent.bindingWaiver !== true && kinds.length > 0 && kinds.every((kind) => {
    const setting = consentCategoryOf(kind);
    return setting !== null && (all || settings.preapprovedConsent.includes(setting));
  });
  if (!approved && !consent.required) return none('consent-optional-unticked', false);
  // v4 (D5, the owner's word of 2026-11-07: "just determine with your own"): a Yes/No question a consent is asked as
  // is decided like any consent: its agreeing answer is chosen (the Yes, by polarity) when approved or required. A
  // binding waiver is never approved, so it is agreed only when the form requires it, and an optional one is left
  // unanswered (decided, never the person's), as an optional binding box is. Both were the person's before (the audit of
  // 2026-11-06, S-5); nothing is the person's now.

  // jr6 RULES R3 (ICIMS-15, iCIMS's IForm Signature box `icims_f_signature`; Jobright's fillSignatureCheckboxes ticks
  // it: cited): a signature asked as a box is ticked on the signature's terms, as any consent box (written last in the
  // pass: plan/order.ts signatureLast). Owner Q6 may keep IForm signatures for the person.
  if (category === 'consent.signature' && consent.box === true) {
    return ticked(approved ? 'consent.signature-preapproved' : 'consent.required');
  }
  if (category === 'consent.signature') {
    const name = profile.identity.fullName.trim();
    if (name === '') return none('no-profile-value');
    return value({ origin: byRule(approved ? 'consent.signature-preapproved' : 'consent.required', 'identity.fullName'),
      confidence: VALUE_CONSENT_PREAPPROVED, text: name });
  }
  return ticked(approved && !USER_ONLY_CATEGORIES.has(category) ? 'consent.preapproved' : 'consent.required', option);
}

// ── jr6 RULES (FIXPLAN §6.3 R1): a signature's date, an EEO decline box, and the choices read from a list's own words ─

/**
 * JV-1, JZ-15, workday-new-1: the date that goes with a signature (consent.signatureDate: Jobvite's "Today's Date",
 * Workday's "Date signed"): today (`now`; YYYY-MM-DD in a date control, the layout the box shows in a text box),
 * written on the same terms as the signature's name (consentValue): when signatures are approved (Consents: All, or
 * "signature" pre-approved: consent.signature-date), else when the form requires it (consent.required); an optional
 * one not approved is left, decided. Never over a value the field holds (Jobright's jobvite `formatAnswer` sets
 * "Date" to today; cited as a behaviour).
 */
export function signatureDateValue(spec: FieldSpec, settings: Settings, now: Ymd): ValueResult {
  if (spec.current.kind === 'text' && spec.current.text.trim() !== '') return none('prefill-kept', false);
  const approved = settings.modes.consents === 'all' || settings.preapprovedConsent.includes('signature');
  if (!approved && !spec.required) return none('consent-optional-unticked', false);
  return value({ origin: { provenance: 'rule', ruleId: approved ? 'consent.signature-date' : 'consent.required' },
    confidence: VALUE_CONSENT_PREAPPROVED, date: { y: now.y, m: now.m, d: now.d } });
}

/** The EEO questions a decline box may belong to, by category. */
const DECLINE_BOX_QUESTIONS: Readonly<Partial<Record<FieldCategory, 'gender' | 'hispanicLatino' | 'race' | 'veteran'
  | 'disability'>>> = {
  'eeo.gender': 'gender', 'eeo.hispanicLatino': 'hispanicLatino', 'eeo.race': 'race', 'eeo.veteran': 'veteran',
  'eeo.disability': 'disability',
};

/**
 * U-09, ADP-17: a lone box that declines a self-identification question (labelRules label.eeo-decline-box: UltiPro's
 * "<question> I decline to say", ADP's "I decline to identify my race and ethnicity"): ticked (eeo.decline) for the
 * person's explicit decline, left unticked for an answer, which the list beside it carries; nothing without either (a
 * decline default is the list's, never the box's). Whether the list beside it already offers its own decline is the
 * planner's (plan/eeoDeclineBox.ts): the box is ticked only where the list lacks one.
 */
export function eeoDeclineBoxValue(category: FieldCategory, profile: Profile): ValueResult {
  const question = DECLINE_BOX_QUESTIONS[category];
  const answer: Explicit<unknown> | undefined = question === undefined ? undefined : profile.eeo[question];
  if (answer === undefined) return none('eeo-not-in-profile', false);
  const declined = answer.kind === 'decline';
  return value({ origin: declined ? byRule('eeo.decline', `eeo.${question}`) : fromProfile(`eeo.${question}`),
    confidence: VALUE_EXPLICIT, check: declined,
    choice: { intended: { kind: 'boolean', value: declined }, domain: 'polarity' } });
}

/** The usable options of a list read whole: none a placeholder, disabled, empty or injected. */
function plainOptions(spec: FieldSpec, vocab: Vocab) {
  if (spec.options === 'lazy') return null;
  return prepareOptions(spec.options, 'generic', vocab).list
    .filter((option) => !option.unusable && !option.disabled && !option.injected && option.clean.trim() !== '');
}

/** The one option of `options` a test picks, or null for none or several. */
function onlyOption<T extends { clean: string }>(options: readonly T[], test: (text: string) => boolean): T | null {
  const found = options.filter((option) => test(option.clean));
  return found.length === 1 ? found[0]! : null;
}

/**
 * JV-9 (Jobvite's consent gate, "Location of Residence and Language", select#jv-country-select: fixtures
 * ninjaone-consent-empty): the privacy policy's residence, chosen by the option naming the profile's country, else the
 * single real option, else one naming Global with English (then Global, then English), flagged
 * (location.policy-residence). Jobright's rules answer `label[for=jv-country-select]` through its server (cited).
 */
export function policyResidenceValue(spec: FieldSpec, profile: Profile, vocab: Vocab): ValueResult {
  const options = plainOptions(spec, vocab);
  if (options === null) return none('waiting-for-options', true);
  const country = profile.address?.country;
  const byCountry = country === undefined ? null
    : onlyOption(options, (text) => countriesNamed(text, vocab).includes(country));
  const chosen = byCountry ?? (options.length === 1 ? options[0]! : null)
    ?? onlyOption(options, (text) => /\bglobal\b/i.test(text) && /\benglish\b/i.test(text))
    ?? onlyOption(options, (text) => /\bglobal\b/i.test(text)) ?? onlyOption(options, (text) => /\benglish\b/i.test(text));
  if (chosen === null) return none('no-match', true);
  return value({ origin: { provenance: 'rule', ruleId: 'location.policy-residence',
    ...(byCountry !== null ? { path: 'address.country' as ProfilePath } : {}) }, confidence: VALUE_TRANSFORM,
  choice: { intended: intendedText(chosen.clean), domain: 'generic' }, flag: 'filled-low-confidence' });
}

/** JV-17: an option that says the person does not live in, or within reach of, the place ("N/A - I do not live in
 *  Illinois.", "Currently reside outside commutable distance"), as normalizeLabel reads it. */
const NOT_THERE_OPTION = /\boutside\b|\b(?:do\s+not|dont|does\s+not|doesnt)\s+(?:currently\s+)?(?:live|reside)\b|\bnot\s+(?:live|living|reside|residing|located|based)\b/;

/** The regions a text names (a state's name, or its code in capitals in `raw`), as region entities. */
function regionsNamed(text: string, raw: string, vocab: Vocab): Array<{ code: string; country: string }> {
  const tokens = normalize(text, 'country').tokens;
  const phrases = vocab.phrases('region');
  const found: Array<{ code: string; country: string }> = [];
  for (let at = 0; at < tokens.length;) {
    const hit = phraseAt(phrases, tokens, at, raw);
    const entity = hit.id === null ? undefined : vocab.entity(hit.id);
    if (entity?.kind === 'region') found.push({ code: entity.code, country: entity.country });
    at += Math.max(hit.length, 1);
  }
  return found;
}

/**
 * JV-17 (VHL's "Question 10: If within commutable distance to Boston, MA, are you willing and able to work the Hybrid
 * schedule …", NinjaOne's "If you live in Illinois, is your address in the City of Chicago?"): a question asked only of
 * those living in, or within reach of, a place it names. When the profile's state is not that place's (or, for a place
 * with no state, its city or country is not that place), the option saying so is chosen (location.not-there, flagged);
 * when it is, or the profile does not say, nothing is (the person's, or the AI's).
 */
export function residesInValue(spec: FieldSpec, profile: Profile, vocab: Vocab): ValueResult {
  const asked = residencePlaceOf(normalize(spec.label, 'label').key);
  const address = profile.address;
  if (asked === null || address === undefined) return none('no-profile-value', false);
  const regions = regionsNamed(asked.place, spec.label, vocab);
  let elsewhere: { at: string } | null = null;
  if (regions.length > 0) {
    const own = address.region?.code;
    if (own === undefined) return none('no-profile-value', false);
    const home = regions.some((region) => region.code === own && region.country === (address.country ?? region.country));
    if (home) return none('no-profile-value', true);
    elsewhere = { at: 'address.region' };
  } else if (!asked.commute) {
    const countries = countriesNamed(asked.place, vocab);
    if (countries.length === 1 && address.country !== undefined) {
      if (countries[0] === address.country) return none('no-profile-value', true);
      elsewhere = { at: 'address.country' };
    } else if (address.city !== undefined) {
      if (normalize(address.city, 'label').key === asked.place) return none('no-profile-value', true);
      elsewhere = { at: 'address.city' };
    }
  }
  if (elsewhere === null) return none('no-profile-value', false);
  const options = plainOptions(spec, vocab);
  if (options === null) return none('waiting-for-options', true);
  const option = onlyOption(options, (text) => NOT_THERE_OPTION.test(normalize(text, 'label').key));
  if (option === null) return none('no-match', true);
  return value({ origin: byRule('location.not-there', elsewhere.at), confidence: VALUE_TRANSFORM,
    choice: { intended: intendedText(option.clean), domain: 'generic' }, flag: 'filled-low-confidence' });
}

/**
 * jr6 RULES R3 (WD-29, Workday's AEP "Do you have military training or a military certification related to this
 * position?", fixtures aep-application-questions-2): a qualification, never a self-identification. No when the person
 * served in no military branch (screening.governmentService) and is no veteran (eeo.veteran), both explicit
 * (legal.military-training); otherwise nothing (the `all` scope's AI).
 */
function militaryTrainingValue(profile: Profile): ValueResult {
  const service = profile.screening.governmentService;
  const veteran = profile.eeo.veteran;
  if (service?.kind !== 'value' || service.value.military || veteran?.kind !== 'value' || veteran.value.veteran) {
    return none('legal-not-in-profile');
  }
  return yesNo(false, fromProfile('screening.governmentService', 'legal.military-training'), VALUE_TRANSFORM);
}

/**
 * jr6 RULES R3 (JZ-11: JazzHR's "Will you be working from inside the United States?", "Are you able to work remotely
 * from a state within the United States?"; "Do you currently reside in the United States?"): yes when the profile's
 * address is in a country the question names (labelRules IN_COUNTRY), no when it is in another, flagged as the
 * inference it is (location.in-country). Nothing where the question names no country, or a place that may or may not be
 * one ("Georgia"), or the profile holds no country: TailorIT's AI answers it (ANSWERABLE_PROFILE_CATEGORIES). Never a
 * relocation question (labelRules IN_COUNTRY_NOT).
 */
export function inCountryValue(spec: FieldSpec, profile: Profile, vocab: Vocab): ValueResult {
  const home = profile.address?.country;
  const places = placesNamed(spec.label, vocab);
  if (home === undefined || places.ambiguous || places.countries.length === 0) return none('no-profile-value', false);
  return yesNo(places.countries.includes(home), byRule('location.in-country', 'address.country'), VALUE_TRANSFORM,
    { flag: 'filled-low-confidence' });
}

// jr6 RULES end
