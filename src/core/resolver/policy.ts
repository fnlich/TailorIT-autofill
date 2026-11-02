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
 * - Consent: ticked when every consent kind the label names is pre-approved in settings (§8.7), else when the form
 *   requires it (the owner's decision of 2026-11-01: it is needed to apply, a binding clause included); an optional
 *   one not pre-approved is left unticked, decided. An AI attestation is ticked only when the run used no AI at all. A
 *   signature types the person's full name on the same terms.
 * - The sensitive part (authorization, EEO, age, criminal record, pronouns, pay): until it is loaded no such field is
 *   answered. While it is 'not-loaded' the plan asks the worker to fetch it (planFrame's needsSensitive); when the
 *   token may not read it ('not-shared') or the fetch failed ('unavailable'), those fields are blank and flagged, but
 *   a self-identification question while it is not shared, which takes the decline default (eeoDeclineDefault).
 */
import {
  POSTING_COUNTRY_FACTOR, VALUE_CONSENT_PREAPPROVED, VALUE_EXPLICIT, VALUE_TRANSFORM, VALUE_TWO_OR_MORE_RACES,
} from '../confidence';
import { CONSENT_CATEGORIES, type ConsentCategory, type FieldKind } from '../enums';
import { intendedDecline, intendedEntity, intendedText } from '../matcher/intended';
import type { MatchDomain } from '../matcher/types';
import type { PlanSensitiveState } from '../plan/types';
import { normalize } from '../text/normalize';
import type { FieldSpec } from '../types/field';
import type { FieldCategory, ProfilePath, RuleId, ValueOrigin, VocabDomain } from '../types/intent';
import type { Explicit, Profile, WorkAuthorization } from '../types/profile';
import type { Settings } from '../types/settings';
import type { Vocab } from '../vocab/types';
import { none, value, type Candidate, type Choice, type ValueResult } from './candidate';
import { USER_ONLY_CATEGORIES } from './categories';
import { basisClassAt, readBasisOptions, type BasisClass } from './workBasis';

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
  'eeo.disability', 'identity.pronouns', 'salary.expected', 'salary.currency']);

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
}

/** The work-authorization entry for the one country a question names (its label, else its description), or, under
 *  interpretation 1, the posting's country for a question that names none; or why there is none. A question that also
 *  names a place that may or may not be a country ("Georgia") names no one country. */
function authorizationEntry(spec: FieldSpec, profile: Profile, vocab: Vocab, legal: LegalContext):
  { index: number; fromPosting: boolean } | { reason: 'work-auth-country-unknown' | 'legal-not-in-profile' } {
  let places = placesNamed(spec.label, vocab);
  if (places.countries.length === 0 && !places.ambiguous && spec.description !== '') {
    places = placesNamed(spec.description, vocab);
  }
  if (places.ambiguous) return { reason: 'work-auth-country-unknown' };
  let countries = places.countries;
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

/** A yes/no legal or EEO answer in its shapes: an option chosen by polarity, or a lone box ticked for yes. */
function yesNo(answer: boolean, origin: ValueOrigin, confidence = VALUE_EXPLICIT, extra: Partial<Candidate> = {}):
  ValueResult {
  return value({ origin, confidence, choice: { intended: { kind: 'boolean', value: answer }, domain: 'polarity' },
    check: answer, ...extra });
}

/** An explicit yes/no legal answer, or its decline (legal.decline), or why there is none. An answer read for the
 *  posting's country (interpretation 1) carries legal.posting-country, scores POSTING_COUNTRY_FACTOR less and is
 *  always flagged. */
function legalAnswer(answer: Explicit<boolean> | undefined, at: string, transform?: RuleId, fromPosting = false):
  ValueResult {
  if (answer === undefined) return none('legal-not-in-profile');
  const factor = fromPosting ? POSTING_COUNTRY_FACTOR : 1;
  const extra: Partial<Candidate> = fromPosting ? { flag: 'filled-low-confidence' } : {};
  if (answer.kind === 'decline') {
    return value({ origin: byRule('legal.decline', at), confidence: VALUE_EXPLICIT * factor,
      choice: { intended: intendedDecline('polarity'), domain: 'polarity' }, ...extra });
  }
  const own = fromPosting ? 'legal.posting-country' : transform;
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
 * answer, a no, no status, or a visa status with a sponsorship answer missing). Authorization is never read from a
 * status (types/profile.ts).
 */
function basisOfEntry(entry: WorkAuthorization): BasisClass | 'decline' | null {
  const sponsorship = combinedSponsorship(entry.sponsorshipNow, entry.sponsorshipFuture);
  if (sponsorship?.kind === 'value' && sponsorship.value) return 'sponsorship';
  if (entry.authorized?.kind === 'decline') return 'decline';
  if (entry.authorized?.kind !== 'value' || !entry.authorized.value) return null;
  const status = entry.status;
  if (status?.kind === 'decline') return 'decline';
  if (status === undefined) return null;
  if (status.value === 'citizen' || status.value === 'permanent-resident') return 'permanent';
  if (sponsorship?.kind === 'decline') return 'decline';
  return sponsorship === undefined ? null : 'permit';
}

/**
 * A work-authorization question asked as a basis set (workBasis.ts), answered from the entry's basis: its option chosen
 * by its own words (legal.work-basis; the posting's country's entry under interpretation 1 is legal.posting-country,
 * flagged), the form's decline option for a declined answer (legal.decline). An entry that does not settle it is
 * legal-not-in-profile, which the `all` scope asks TailorIT's AI about with every option the form shows (plan/answers.ts;
 * no profile value, and no list narrowed by one, is ever sent); a basis the form offers no option for is no-match, left
 * as it is. Null when the options are no basis set (or not read yet), so the question is read as before.
 */
function workBasisValue(spec: FieldSpec, entry: WorkAuthorization, at: string, fromPosting: boolean, vocab: Vocab):
  ValueResult | null {
  const options = readBasisOptions(spec, vocab);
  if (options === null) return null;
  const basis = basisOfEntry(entry);
  if (basis === null) return none('legal-not-in-profile');
  const factor = fromPosting ? POSTING_COUNTRY_FACTOR : 1;
  const extra: Partial<Candidate> = fromPosting ? { flag: 'filled-low-confidence' } : {};
  if (basis === 'decline') {
    return value({ origin: byRule('legal.decline', at), confidence: VALUE_EXPLICIT * factor,
      choice: { intended: intendedDecline('generic'), domain: 'generic' }, ...extra });
  }
  const option = options.get(basis);
  if (option === undefined) return none('no-match');
  return value({ origin: fromProfile(at, fromPosting ? 'legal.posting-country' : 'legal.work-basis'),
    confidence: VALUE_TRANSFORM * factor, choice: { intended: intendedText(option.clean), domain: 'generic' }, ...extra });
}

/**
 * Whether TailorIT's AI answer to a basis set (an `all` question the entry did not settle: workBasisValue) states what
 * the person's own answers deny: the sponsorship option when both sponsorship answers are an explicit no, an option
 * needing none when either is a yes, the permanent option when they are not authorized or hold a visa or another
 * status, the permit option when they are a citizen or permanent resident. Such a pick is refused (planFrame
 * planAnswer: llm-pick-rejected) and the field left flagged: a guess never overrules the person's answer. Only the pick
 * is compared here; nothing of the person's answers was sent. False for any other field or option.
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

/** The value of a legal question (§8.7): authorization, sponsorship, status and age from explicit answers only. */
export function legalValue(category: FieldCategory, spec: FieldSpec, profile: Profile, vocab: Vocab,
  legal: LegalContext): ValueResult {
  if (category === 'screening.criminalHistory') return criminalValue(spec, profile);
  if (category === 'screening.over18') return legalAnswer(profile.screening.over18, 'screening.over18');
  if (category === 'workAuth.visaType' || category === 'workAuth.clearance') return none('legal-not-in-profile');
  const found = authorizationEntry(spec, profile, vocab, legal);
  if ('reason' in found) return none(found.reason);
  const entry = profile.workAuthorization[found.index]!;
  const at = `workAuthorization[${found.index}]`;
  const { fromPosting } = found;
  // A status is never read for a country the question does not name (below), as a basis set or by name.
  const basis = BASIS_CATEGORIES.has(category) && !(category === 'workAuth.status' && fromPosting)
    ? workBasisValue(spec, entry, at, fromPosting, vocab) : null;
  if (basis !== null) return basis;
  switch (category) {
    case 'workAuth.authorized':
      return legalAnswer(entry.authorized, `${at}.authorized`, undefined, fromPosting);
    case 'workAuth.sponsorshipNow':
      return legalAnswer(entry.sponsorshipNow, `${at}.sponsorshipNow`, undefined, fromPosting);
    case 'workAuth.sponsorshipFuture':
      return legalAnswer(entry.sponsorshipFuture, `${at}.sponsorshipFuture`, undefined, fromPosting);
    case 'workAuth.sponsorship':
      return legalAnswer(combinedSponsorship(entry.sponsorshipNow, entry.sponsorshipFuture), at,
        'legal.sponsorship-combined', fromPosting);
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
    default:
      return none('legal-not-in-profile');
  }
}

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

/** The value of a self-identification question (§8.7). */
export function eeoValue(category: FieldCategory, spec: FieldSpec, profile: Profile, settings: Settings, vocab: Vocab):
  ValueResult {
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
      const id = veteran.protected ? 'protected-veteran'
        : asksProtectedStatus(spec) ? 'not-protected-veteran' : veteran.veteran ? 'veteran' : 'not-veteran';
      return explicitValue(eeoChoice(domain, id, vocab));
    }
    case 'race': {
      const races = (eeo.race as Extract<Profile['eeo']['race'], { kind: 'value' }>).value;
      const hispanic = eeo.hispanicLatino?.kind === 'value' ? { hispanicLatino: eeo.hispanicLatino.value } : {};
      const choices = races.map((race) => eeoChoice(domain, race, vocab, hispanic));
      if (choices.some((choice) => choice === null)) return none('eeo-not-in-profile');
      const set = choices as Choice[];
      if (spec.kind === 'checkbox-group' || spec.kind === 'multiselect') {
        return value({ origin: fromProfile(at), confidence: VALUE_EXPLICIT, set });
      }
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
}

/** A consent's tick (or Yes, or its one option that agrees: `option`), by the rule that gives it. */
const ticked = (ruleId: RuleId, option?: string | null): ValueResult => value({ origin: { provenance: 'rule', ruleId },
  confidence: VALUE_CONSENT_PREAPPROVED,
  choice: typeof option === 'string' ? { intended: intendedText(option), domain: 'generic' satisfies MatchDomain }
    : { intended: { kind: 'boolean', value: true }, domain: 'polarity' satisfies MatchDomain }, check: true });

/**
 * The value of a consent field (§8.7; the owner's decision of 2026-11-01, docs/SPEC-AMENDMENTS.md §11): an AI
 * attestation (any consent that names AI) is ticked only when the run used no AI at all (consent.no-ai-attestation),
 * and otherwise left for the person (ai-attestation-ai-used). Every other consent is ticked when each kind it names is
 * pre-approved in settings (consent.preapproved), else when the form requires it, binding clauses included
 * (consent.required: it is needed to apply); an optional one not pre-approved (marketing, SMS) is left unticked and
 * recorded as decided (consent-optional-unticked, never the person's). A signature types the person's full name on
 * the same terms. A consent asked as a choice ticks by choosing its one option that agrees (ConsentContext.choice), and
 * waits for its options while they are not read (waiting-for-options: the loop opens the list), so it is decided on
 * what the list really offers.
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
  const approved = kinds.length > 0 && kinds.every((kind) => {
    const setting = consentCategoryOf(kind);
    return setting !== null && settings.preapprovedConsent.includes(setting);
  });
  if (!approved && !consent.required) return none('consent-optional-unticked', false);
  if (category === 'consent.signature') {
    const name = profile.identity.fullName.trim();
    if (name === '') return none('no-profile-value');
    return value({ origin: byRule(approved ? 'consent.signature-preapproved' : 'consent.required', 'identity.fullName'),
      confidence: VALUE_CONSENT_PREAPPROVED, text: name });
  }
  return ticked(approved && !USER_ONLY_CATEGORIES.has(category) ? 'consent.preapproved' : 'consent.required', option);
}
