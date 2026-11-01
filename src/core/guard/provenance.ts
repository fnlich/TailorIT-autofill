/*
 * Provenance (docs/design/core.md §7.6, docs/ARCHITECTURE.md "Provenance"). A value without provenance cannot exist:
 * PlannedWrite requires an origin, and because messages cross contexts the Guard checks it again at run time, blocking
 * the field as a bug when it fails. Two forms of the check:
 * - checkProvenance, in the worker, which holds the profile and the saved answers: a profile path must resolve to a
 *   value, a rule must be known and allowed for the field's category, a saved answer must exist with this field's key,
 *   and an llm-pick must name a visible option whose clean text hashes as it did when the LLM saw it;
 * - checkProvenanceShape, in the content script before each write, without the profile: the origin is present, its
 *   path fits PROFILE_PATH_PATTERN, its rule id is known and an llm-pick's hash has the right shape. With the field's
 *   current options the frame also checks the llm-pick's option (llmPickStillValid).
 * Then the category policy (checkCategoryPolicy): EEO and legal values need `profile` or the decline rule (for EEO also
 * the decline-default rule), consent the pre-approval rule, a free text a saved answer, a draft or an AI answer, an
 * upload its own category's document (a resume upload the profile's resume, a cover-letter upload the run's cover
 * letter, Phase G; any other upload nothing, and a file write's origin always names the document it carries); an
 * attention check, and every category only the person answers, allow nothing. An AI
 * answer's text (llm-answer, version 2) fills an unknown or free-text field, or one of the profile categories
 * ANSWERABLE_PROFILE_CATEGORIES lists; never a sensitive, legal, EEO or consent one.
 */
import { TIEBREAK_LABEL_MAX } from '../confidence';
import { PROVENANCES } from '../enums';
import { ANSWERABLE_PROFILE_CATEGORIES, policyClassOf, USER_ONLY_CATEGORIES } from '../resolver/categories';
import { normalizeLabel } from '../text/normalize';
import { sha256Hex } from '../text/sha256';
import { asUntrusted } from '../text/untrusted';
import type { FieldSpec } from '../types/field';
import type { PlannedWrite, ReasonCode } from '../types/fill';
import {
  ANSWER_BASES, FILE_PATHS, PROFILE_PATH_PATTERN, RULE_IDS, type FieldCategory, type PolicyClass, type RuleId,
  type ValueOrigin,
} from '../types/intent';
import type { Profile } from '../types/profile';
import type { SavedAnswer } from '../types/saved';
import type { VisibleText } from '../types/text';
import { cutInjected } from './injected';

/** A check's answer: pass, or the reason the field is blocked. */
export type GuardVerdict = { ok: true } | { ok: false; reason: ReasonCode };

const PASS: GuardVerdict = { ok: true };
const fail = (reason: ReasonCode): GuardVerdict => ({ ok: false, reason });

/** The longest profile path the messages carry. */
const PROFILE_PATH_MAX = 200;
/** An llm-pick's label hash: the 64-hex SHA-256 of the clean option text as sent. */
const LABEL_HASH = /^[0-9a-f]{64}$/;

const isRuleId = (value: unknown): value is RuleId => typeof value === 'string'
  && (RULE_IDS as readonly string[]).includes(value);
const isPath = (value: unknown): value is string => typeof value === 'string' && value.length <= PROFILE_PATH_MAX
  && PROFILE_PATH_PATTERN.test(value);
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value !== '';

const IDENTITY_NAMES: readonly FieldCategory[] = ['identity.fullName', 'identity.firstName', 'identity.middleName',
  'identity.lastName'];
const DATES: readonly FieldCategory[] = ['education.startDate', 'education.endDate', 'experience.startDate',
  'experience.endDate', 'availability.startDate'];
/** The consent categories a person may pre-approve (settings' CONSENT_CATEGORIES, signature apart). */
const PREAPPROVABLE: readonly FieldCategory[] = ['consent.privacy', 'consent.terms', 'consent.certify',
  'consent.dataRetention', 'consent.marketing', 'consent.sms', 'consent.backgroundCheck'];
const OPEN_FOR_FOLLOW_UP: readonly PolicyClass[] = ['profile', 'free-text', 'unknown'];

/**
 * The categories each rule may produce or transform a value for (§7.6: a rule "not allowed for the category" is a
 * policy violation). guard.revert restores a field's own earlier value, so it fits any category the extension writes.
 */
export const RULE_SCOPES: Readonly<Record<RuleId, (category: FieldCategory) => boolean>> = {
  'name.split': (category) => IDENTITY_NAMES.includes(category),
  'phone.format': (category) => category === 'contact.phone' || category === 'contact.phoneCountry',
  'date.format': (category) => DATES.includes(category),
  'location.compose': (category) => category === 'location.current' || category === 'experience.location',
  'years.from-experience': (category) => category === 'experience.totalYears',
  'availability.from-notice': (category) => category === 'availability.startDate',
  'education.highest-completed': (category) => category === 'education.highestLevel'
    || category === 'education.degree',
  'experience.current-checkbox': (category) => category === 'experience.current',
  'eeo.decline': (category) => policyClassOf(category) === 'eeo',
  'eeo.self-describe': (category) => category === 'eeo.gender',
  'eeo.two-or-more-races': (category) => category === 'eeo.race',
  'legal.decline': (category) => policyClassOf(category) === 'legal' && category !== 'screening.criminalHistory',
  'legal.sponsorship-combined': (category) => category === 'workAuth.sponsorship',
  'legal.posting-country': (category) => category.startsWith('workAuth.'),
  'consent.preapproved': (category) => PREAPPROVABLE.includes(category),
  'consent.signature-preapproved': (category) => category === 'consent.signature',
  'numeric.range-bucket': (category) => category === 'salary.expected' || category === 'experience.totalYears'
    || category === 'availability.noticePeriod',
  'other.free-text': (category) => OPEN_FOR_FOLLOW_UP.includes(policyClassOf(category)),
  'guard.revert': () => true,
  'typeahead.query': (category) => policyClassOf(category) === 'profile',
  'eeo.decline-default': (category) => policyClassOf(category) === 'eeo',
  'screening.previously-employed': (category) => category === 'screening.previouslyEmployed',
};

/** The value a profile path names ('contact.email', 'education[0].institution'), or undefined. Only the profile's own
 *  data is read (the review, CORE-16): a name is an own property of an object that is no list, an index an own entry
 *  of a list, so 'identity.constructor' and 'skills.length' name nothing, and neither does a function. Empty strings
 *  and empty lists name nothing. */
export function resolveProfilePath(profile: Profile, path: string): unknown {
  if (!isPath(path)) return undefined;
  let value: unknown = profile;
  for (const [, name, index] of path.matchAll(/([A-Za-z0-9]+)|\[(\d+)\]/g)) {
    if (value === null || typeof value !== 'object') return undefined;
    const key = name ?? index!;
    if (Array.isArray(value) === (name !== undefined) || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  if (value === '' || value === null || typeof value === 'function'
    || (Array.isArray(value) && value.length === 0)) return undefined;
  return value;
}

/** The text an llm-pick's labelHash was taken over: the option's clean label as the tiebreak sends it. */
function sentLabel(label: string): string {
  return asUntrusted(cutInjected(label).clean as VisibleText, TIEBREAK_LABEL_MAX);
}

/** Whether an llm-pick still names the option the LLM saw: an option write to a current, enabled option whose label
 *  had nothing cut and whose clean text hashes to the origin's labelHash. True for any other origin. */
export function llmPickStillValid(write: PlannedWrite, spec: Pick<FieldSpec, 'options'>): boolean {
  const { origin, value } = write;
  if (origin.provenance !== 'llm-pick') return true;
  if (value.kind !== 'option' || spec.options === 'lazy') return false;
  const option = spec.options.find((candidate) => candidate.index === value.index);
  if (!option || option.disabled) return false;
  const cut = cutInjected(option.label);
  if (cut.injected || cut.clean === '') return false;
  return sha256Hex(sentLabel(option.label)) === origin.labelHash;
}

/** The structural check (§7.6) the content script runs before each write, without the profile. */
export function checkProvenanceShape(write: PlannedWrite): GuardVerdict {
  const origin = (write as { origin?: unknown }).origin as ValueOrigin | undefined;
  if (origin === undefined || origin === null || typeof origin !== 'object'
    || !(PROVENANCES as readonly string[]).includes(origin.provenance)) return fail('missing-provenance');
  switch (origin.provenance) {
    case 'profile':
      if (!isPath(origin.path)) return fail('missing-provenance');
      // An upload names the document it takes, and its origin the profile's path of that document (Phase G): the
      // resume is never sent as a cover letter, nor a cover letter as the resume.
      if (write.value.kind === 'file' && (origin.transform !== undefined
        || origin.path !== FILE_PATHS[write.value.ref])) return fail('policy-violation');
      return origin.transform === undefined || isRuleId(origin.transform) ? PASS : fail('policy-violation');
    case 'saved':
      return nonEmpty(origin.savedAnswerId) ? PASS : fail('missing-provenance');
    case 'rule':
      if (!isRuleId(origin.ruleId)) return fail('policy-violation');
      return origin.path === undefined || isPath(origin.path) ? PASS : fail('missing-provenance');
    case 'llm-pick':
      if (!nonEmpty(origin.taskId) || !Number.isInteger(origin.pickedCandidate) || origin.pickedCandidate < 0
        || typeof origin.labelHash !== 'string' || !LABEL_HASH.test(origin.labelHash)) return fail('llm-pick-rejected');
      return write.value.kind === 'option' ? PASS : fail('llm-pick-rejected');
    case 'llm-draft':
      if (!nonEmpty(origin.taskId)) return fail('missing-provenance');
      return write.value.kind === 'text' ? PASS : fail('policy-violation');
    case 'llm-answer':
      if (!nonEmpty(origin.taskId) || !(ANSWER_BASES as readonly string[]).includes(origin.basis)) {
        return fail('missing-provenance');
      }
      return write.value.kind === 'text' ? PASS : fail('policy-violation');
    default:
      return fail('missing-provenance');
  }
}

/** What the worker's full check reads besides the write. */
export interface ProvenanceContext {
  profile: Profile;
  savedAnswers: readonly SavedAnswer[];
}

/** The key a saved answer is matched by: the field's normalized label and its observed option-set hash. */
export function savedAnswerFits(answer: SavedAnswer, spec: Pick<FieldSpec, 'label' | 'optionSetHash'>): boolean {
  return answer.labelKey === normalizeLabel(spec.label) && answer.optionSetHash === spec.optionSetHash;
}

/**
 * The worker's full provenance check (§7.6): the structural check, then a profile path that resolves, a known rule
 * allowed for the category (and its path, when it names one), a saved answer that exists with this field's key, and an
 * llm-pick of a current option whose text is unchanged.
 */
export function checkProvenance(write: PlannedWrite, spec: FieldSpec, category: FieldCategory, ctx: ProvenanceContext):
  GuardVerdict {
  const shape = checkProvenanceShape(write);
  if (!shape.ok) return shape;
  const { origin } = write;
  switch (origin.provenance) {
    case 'profile':
      if (resolveProfilePath(ctx.profile, origin.path) === undefined) return fail('missing-provenance');
      return origin.transform === undefined || RULE_SCOPES[origin.transform](category) ? PASS : fail('policy-violation');
    case 'rule':
      if (!RULE_SCOPES[origin.ruleId](category)) return fail('policy-violation');
      if (origin.path !== undefined && resolveProfilePath(ctx.profile, origin.path) === undefined) {
        return fail('missing-provenance');
      }
      return PASS;
    case 'saved': {
      const answer = ctx.savedAnswers.find((candidate) => candidate.id === origin.savedAnswerId);
      return answer !== undefined && savedAnswerFits(answer, spec) ? PASS : fail('missing-provenance');
    }
    case 'llm-pick':
      return llmPickStillValid(write, spec) ? PASS : fail('llm-pick-rejected');
    case 'llm-draft':
    case 'llm-answer':
      return PASS;
  }
}

/** The rules each class's values may come from, besides `profile` and `saved` where the class allows those. */
const CLASS_RULES: Readonly<Record<PolicyClass, readonly RuleId[] | 'any'>> = {
  profile: 'any',
  sensitive: ['guard.revert'],
  legal: ['legal.decline', 'guard.revert'],
  eeo: ['eeo.decline', 'eeo.decline-default', 'guard.revert'],
  consent: ['consent.preapproved', 'consent.signature-preapproved', 'guard.revert'],
  attention: [],
  'free-text': ['other.free-text', 'guard.revert'],
  file: [],
  unknown: ['other.free-text', 'screening.previously-employed', 'guard.revert'],
};

/** The provenances each class's values may have (§7.6, §8.2): `rule` is narrowed further by CLASS_RULES. */
const CLASS_PROVENANCES: Readonly<Record<PolicyClass, readonly ValueOrigin['provenance'][]>> = {
  profile: ['profile', 'saved', 'rule', 'llm-pick', 'llm-answer'],
  sensitive: ['profile', 'rule'],
  legal: ['profile', 'rule'],
  eeo: ['profile', 'rule'],
  consent: ['rule'],
  attention: [],
  'free-text': ['saved', 'llm-draft', 'llm-answer', 'rule'],
  file: ['profile'],
  unknown: ['saved', 'llm-pick', 'llm-answer', 'rule'],
};

/** The category policy (§7.6's last row, §8.2): whether a value of this origin may fill a field of this category. */
export function checkCategoryPolicy(origin: ValueOrigin, category: FieldCategory): GuardVerdict {
  if (USER_ONLY_CATEGORIES.has(category)) return fail('policy-violation');
  const policy = policyClassOf(category);
  if (!CLASS_PROVENANCES[policy].includes(origin.provenance)) return fail('policy-violation');
  if (origin.provenance === 'llm-answer' && policy === 'profile' && !ANSWERABLE_PROFILE_CATEGORIES.has(category)) {
    return fail('policy-violation');
  }
  if (origin.provenance === 'rule') {
    const rules = CLASS_RULES[policy];
    if (rules !== 'any' && !rules.includes(origin.ruleId)) return fail('policy-violation');
  }
  // An upload takes only its own category's document (Phase G): a resume upload the profile's resume, a cover-letter
  // upload the run's cover letter, and any other upload nothing.
  if (policy === 'file' && (origin.provenance !== 'profile' || origin.transform !== undefined
    || origin.path !== FILE_DOCUMENTS[category])) {
    return fail('policy-violation');
  }
  return PASS;
}

/** The profile path of the one document each upload category takes (Phase G): none for any other upload. */
const FILE_DOCUMENTS: Readonly<Partial<Record<FieldCategory, string>>> = {
  'file.resume': FILE_PATHS.resume,
  'file.coverLetter': FILE_PATHS['cover-letter'],
};
