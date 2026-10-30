/*
 * The EEO, legal and consent policy (docs/design/core.md §8.7, docs/ARCHITECTURE.md "Resolver"). These answers come
 * only from what the person stated: nothing is inferred, nothing is fuzzy-matched or sent to an LLM, and nothing is
 * cached (the matcher's domain table and the policy classes keep those stages off).
 * - EEO: an explicit value is matched through the EEO vocabulary; an explicit decline chooses the form's decline
 *   option (else blank, decline-option-missing); no answer leaves the field blank and flagged (eeo-not-in-profile). A
 *   self-described gender chooses the self-describe option and types the person's own words into the box it reveals,
 *   always flagged. Several races on a single-choice question are blank and flagged, unless the owner turned on
 *   interpretation 2 ("Two or More Races", flagged). A race option that asserts a Hispanic or Latino answer is chosen
 *   only when the person's own explicit answer agrees (MatchInput.hispanicLatino).
 * - Legal: the answer of the work-authorization entry for the country the question names. A question that names no
 *   country, or several, is blank and flagged. Interpretation 1, when the owner turns it on, answers one that names
 *   none from the entry for the posting's country, flagged; it needs the caller to know that country, and no plan
 *   request carries it yet, so it stays inert in planFrame. A combined "now or in the future" sponsorship question is
 *   Yes when either answer is an explicit yes, No only when both are an explicit no, the decline option when either is
 *   declined and neither is yes, and blank otherwise. Criminal history is always the person's.
 * - Consent: ticked only when every consent kind the label names is pre-approved in settings (§8.7); an AI attestation
 *   and unrecognised consent never can be. A pre-approved signature types the person's full name.
 * - The sensitive part (authorization, EEO, age, pronouns, pay): until it is loaded no such field is answered. While
 *   it is 'not-loaded' the plan asks the worker to fetch it (planFrame's needsSensitive); when the token may not read
 *   it ('not-shared') or the fetch failed ('unavailable'), those fields are blank and flagged.
 */
import {
  POSTING_COUNTRY_FACTOR, VALUE_CONSENT_PREAPPROVED, VALUE_EXPLICIT, VALUE_TRANSFORM, VALUE_TWO_OR_MORE_RACES,
} from '../confidence';
import { CONSENT_CATEGORIES, type ConsentCategory, type FieldKind } from '../enums';
import { intendedDecline, intendedEntity } from '../matcher/intended';
import type { MatchDomain } from '../matcher/types';
import type { PlanSensitiveState } from '../plan/types';
import { normalize } from '../text/normalize';
import type { FieldSpec } from '../types/field';
import type { FieldCategory, ProfilePath, RuleId, ValueOrigin, VocabDomain } from '../types/intent';
import type { Explicit, Profile } from '../types/profile';
import type { Settings } from '../types/settings';
import type { Vocab } from '../vocab/types';
import { none, value, type Candidate, type Choice, type ValueResult } from './candidate';
import { USER_ONLY_CATEGORIES } from './categories';

const path = (text: string) => text as ProfilePath;
const fromProfile = (at: string, transform?: RuleId): ValueOrigin => (transform === undefined
  ? { provenance: 'profile', path: path(at) } : { provenance: 'profile', path: path(at), transform });
const byRule = (ruleId: RuleId, at: string): ValueOrigin => ({ provenance: 'rule', ruleId, path: path(at) });

// ---------------------------------------------------------------------------------------------------------------
// The sensitive part

/** The categories whose answer lives in the sensitive part: work authorization, age, self-identification, pronouns
 *  and pay. Visa type, clearance, sexual orientation and transgender identity have no answer in either part, and
 *  criminal history is always the person's, so they never need it. */
export const SENSITIVE_PART_CATEGORIES: ReadonlySet<FieldCategory> = new Set<FieldCategory>(['workAuth.authorized',
  'workAuth.sponsorship', 'workAuth.sponsorshipNow', 'workAuth.sponsorshipFuture', 'workAuth.status',
  'screening.over18', 'eeo.gender', 'eeo.hispanicLatino', 'eeo.race', 'eeo.veteran', 'eeo.disability',
  'identity.pronouns', 'salary.expected', 'salary.currency']);

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

/** The countries a question names, as ISO alpha-2 codes, by the country vocabulary's phrases read left to right,
 *  longest first. */
export function countriesNamed(text: string, vocab: Vocab): string[] {
  const tokens = normalize(text, 'country').tokens;
  const phrases = vocab.phrases('country');
  const found = new Set<string>();
  let at = 0;
  while (at < tokens.length) {
    let length = 0;
    for (const phrase of phrases.get(tokens[at]!) ?? []) {
      if (phrase.ambiguous || phrase.tokens.length > tokens.length - at) continue;
      if (length > 0 && phrase.tokens.length < length) break;
      if (!phrase.tokens.every((token, offset) => tokens[at + offset] === token)) continue;
      if (phrase.tokens.length === 1 && phrase.tokens[0]!.length <= 3 && !shortFormInCapitals(phrase.tokens[0]!, text)) {
        continue;
      }
      length = phrase.tokens.length;
      const entity = vocab.entity(phrase.id);
      if (entity?.kind === 'country') found.add(entity.alpha2);
    }
    at += length > 0 ? length : 1;
  }
  return [...found];
}

/** What a legal question's country may come from besides its own words: interpretation 1, when the owner has turned
 *  it on, and the posting's country, when the caller knows it (no plan request carries it yet). */
export interface LegalContext {
  settings: Settings;
  postingCountry?: string;
}

/** The work-authorization entry for the one country a question names (its label, else its description), or, under
 *  interpretation 1, the posting's country for a question that names none; or why there is none. */
function authorizationEntry(spec: FieldSpec, profile: Profile, vocab: Vocab, legal: LegalContext):
  { index: number; fromPosting: boolean } | { reason: 'work-auth-country-unknown' | 'legal-not-in-profile' } {
  let countries = countriesNamed(spec.label, vocab);
  if (countries.length === 0 && spec.description !== '') countries = countriesNamed(spec.description, vocab);
  const fromPosting = countries.length === 0 && legal.settings.interpretations.postingCountryForLegal
    && legal.postingCountry !== undefined;
  if (fromPosting) countries = [legal.postingCountry!];
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

/** How a work status is written, for a list that offers statuses by name. */
const WORK_STATUS_TEXT: Readonly<Record<string, string>> = {
  citizen: 'Citizen', 'permanent-resident': 'Permanent resident', 'work-visa': 'Work visa',
  'student-visa': 'Student visa',
};

/** The value of a legal question (§8.7): authorization, sponsorship, status and age from explicit answers only. */
export function legalValue(category: FieldCategory, spec: FieldSpec, profile: Profile, vocab: Vocab,
  legal: LegalContext): ValueResult {
  if (category === 'screening.criminalHistory') return none('legal-not-in-profile', true, true);
  if (category === 'screening.over18') return legalAnswer(profile.screening.over18, 'screening.over18');
  if (category === 'workAuth.visaType' || category === 'workAuth.clearance') return none('legal-not-in-profile');
  const found = authorizationEntry(spec, profile, vocab, legal);
  if ('reason' in found) return none(found.reason);
  const entry = profile.workAuthorization[found.index]!;
  const at = `workAuthorization[${found.index}]`;
  const { fromPosting } = found;
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

/** The value of a self-identification question (§8.7). */
export function eeoValue(category: FieldCategory, spec: FieldSpec, profile: Profile, settings: Settings, vocab: Vocab):
  ValueResult {
  const domain = EEO_DOMAIN[category];
  if (domain === undefined) return none('eeo-not-in-profile');
  const { eeo } = profile;
  const question = category.slice('eeo.'.length) as 'gender' | 'hispanicLatino' | 'race' | 'veteran' | 'disability';
  const answer: Explicit<unknown> | undefined = eeo[question];
  if (answer === undefined) return none('eeo-not-in-profile');
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

/** The value of a consent field (§8.7): every consent kind the label names must be pre-approved. */
export function consentValue(category: FieldCategory, consentKinds: readonly FieldCategory[] | undefined,
  profile: Profile, settings: Settings): ValueResult {
  if (USER_ONLY_CATEGORIES.has(category)) return none('consent-requires-user', true, true);
  const kinds = consentKinds && consentKinds.length > 0 ? consentKinds : [category];
  const approved = kinds.every((kind) => {
    const setting = consentCategoryOf(kind);
    return setting !== null && settings.preapprovedConsent.includes(setting);
  });
  if (!approved) return none('consent-requires-user', true, true);
  if (category === 'consent.signature') {
    const name = profile.identity.fullName.trim();
    if (name === '') return none('no-profile-value');
    return value({ origin: byRule('consent.signature-preapproved', 'identity.fullName'),
      confidence: VALUE_CONSENT_PREAPPROVED, text: name });
  }
  return value({ origin: { provenance: 'rule', ruleId: 'consent.preapproved' }, confidence: VALUE_CONSENT_PREAPPROVED,
    choice: { intended: { kind: 'boolean', value: true }, domain: 'polarity' satisfies MatchDomain }, check: true });
}
