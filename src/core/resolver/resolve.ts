/*
 * The resolver (docs/design/core.md §8.1, §8.6; docs/ARCHITECTURE.md "Resolver"): what a field asks for, what value to
 * put there, where it came from and how sure we are. The spec's order (autocomplete, name/id, label rules, saved
 * answers, LLM classification, unknown) is read as the evaluation order:
 *   0. a tripwire in the field's own label or description blocks it, and an attention check is the person's; both
 *      pre-empt everything;
 *   1-3. the rules decide the category (classifyByRules, Phase 1); one that hands the field to the person (a needsUser
 *      cause) makes it needs-user, whatever its topic's class would allow;
 *   4. a saved answer with the exact key, in a scope the category's policy allows, supplies the value: that is how
 *      saved answers beat the profile and the rules;
 *   5. LLM classification is Phase 4: a field nothing classified is 'unknown', and takes only a saved answer;
 *   then the value: the profile's (values.ts), or the EEO, legal and consent policy's (policy.ts), behind the
 *   sensitive part's gate, shaped for the field's kind (candidate.ts).
 * Confidence is classification × value here; the match multiplies in later (planFrame). An unanswered EEO, legal or
 * sensitive question, and a required field with no value, are flagged rather than skipped, so the person sees them.
 */
import { CLASSIFY_SAVED_EXACT, FILL_AT, FLAG_AT, LABEL_RULE_CONFIDENCE } from '../confidence';
import { attentionHits, namesConsentTopic } from '../guard/attention';
import { hasTripwire } from '../guard/tripwire';
import { intendedText } from '../matcher/intended';
import { typeaheadQueries } from '../matcher/typeahead';
import type { PlanSensitiveState } from '../plan/types';
import type { FieldSpec } from '../types/field';
import type { ReasonCode } from '../types/fill';
import type { FieldCategory, IntendedValue } from '../types/intent';
import type { Action, Classifier, Resolution } from '../types/match';
import type { Profile, Ymd } from '../types/profile';
import type { SavedAnswer } from '../types/saved';
import type { Settings } from '../types/settings';
import type { VisibleText } from '../types/text';
import type { Vocab } from '../vocab/types';
import { none, SHAPE_OF_KIND, value, type Candidate, type Choice, type ValueResult } from './candidate';
import { policyClassOf } from './categories';
import { classifyByRules, type RuleClassification } from './classifyRules';
import { dateIso, dateText } from './format';
import type { NeedsUserCause } from './labelRules';
import { consentValue, eeoValue, legalValue, sensitiveGate } from './policy';
import { findSavedAnswer, type CompanyScope } from './saved';
import { profileValue } from './values';

/** What the resolver reads besides the field. */
export interface ResolveContext {
  profile: Profile;
  sensitiveState: PlanSensitiveState;
  savedAnswers: readonly SavedAnswer[];
  settings: Settings;
  vocab: Vocab;
  now: Ymd;
  /** The company the form belongs to, for answers saved for one company; absent when unknown. */
  company?: CompanyScope;
  /** The form has its own control for the phone's country code in this field's section. */
  separatePhoneCountry?: boolean;
  /** The posting's country (ISO alpha-2), for interpretation 1; absent when unknown, as in every plan request so far. */
  postingCountry?: string;
}

/** What decided a field's category, before any value: a tripwire in its label, an attention check, the rules, or
 *  nothing. */
export type FieldClassification =
  | { by: 'tripwire'; rules: RuleClassification | null }
  | { by: 'attention'; patternId: string; consent: FieldCategory | null }
  | { by: 'rules'; rules: RuleClassification }
  | { by: 'none' };

/** Step 0 and steps 1 to 3 (§8.1): the tripwire in the field's own text, then attention checks, then the rules. */
export function classifyField(spec: FieldSpec): FieldClassification {
  if (hasTripwire(spec.label as VisibleText) || hasTripwire(spec.description as VisibleText)) {
    return { by: 'tripwire', rules: classifyByRules(spec) };
  }
  const attention = attentionHits(spec.label, spec.description);
  if (attention.length > 0) {
    let consent: FieldCategory | null = null;
    if (namesConsentTopic(spec.label, spec.description)) {
      const rules = classifyByRules(spec);
      const category = rules?.category ?? rules?.asks;
      consent = category !== undefined && policyClassOf(category) === 'consent' ? category : 'consent.other';
    }
    return { by: 'attention', patternId: attention[0]!, consent };
  }
  const rules = classifyByRules(spec);
  return rules === null ? { by: 'none' } : { by: 'rules', rules };
}

/** The value in the shape the field's kind takes. */
export type Shaped =
  | { shape: 'text'; text: string }
  | { shape: 'choice'; choice: Choice }
  | { shape: 'set'; set: Choice[] }
  | { shape: 'check'; check: boolean }
  | { shape: 'date'; iso: string }
  | { shape: 'file' }
  | { shape: 'search'; queries: string[]; choice: Choice };

/** The resolver's full answer for one field: the Resolution, the value shaped for the field, and whether the field
 *  waits for the sensitive part. */
export interface ResolvedField {
  resolution: Resolution;
  /** Null when nothing is to be written. */
  shaped: Shaped | null;
  /** The field needs the sensitive part, which is not loaded yet (planFrame then asks the worker to fetch it). */
  needsSensitive: boolean;
}

/** The action a confidence gives (§8.6): fill at FILL_AT or more, fill and flag from FLAG_AT, else leave blank. A
 *  value that must always be flagged is filled and flagged at most. */
export function actionFor(confidence: number, alwaysFlag: boolean): Action {
  if (confidence >= FILL_AT && !alwaysFlag) return 'fill';
  if (confidence >= FLAG_AT) return 'fill-and-flag';
  return 'leave-blank';
}

/** Why a field handed to the person is so, as the panel words it: by the class of what it asks, or a conflict. */
function needsUserReason(cause: NeedsUserCause, asks: FieldCategory): ReasonCode {
  if (cause === 'source-conflict') return 'classification-conflict';
  switch (policyClassOf(asks)) {
    case 'legal':
      return 'legal-not-in-profile';
    case 'eeo':
      return 'eeo-not-in-profile';
    case 'consent':
      return 'consent-requires-user';
    case 'sensitive':
      return 'no-profile-value';
    case 'attention':
      return 'attention-check';
    case 'free-text':
      return 'free-text-requires-user';
    default:
      return 'unknown-field';
  }
}

/** A saved answer as a candidate (provenance 'saved'): option labels matched as text, a text typed, a box ticked. */
function savedCandidate(answer: SavedAnswer): Candidate {
  const origin = { provenance: 'saved' as const, savedAnswerId: answer.id };
  const { answer: saved } = answer;
  switch (saved.kind) {
    case 'options': {
      const set = saved.labels.map((label): Choice => ({ intended: intendedText(label), domain: 'generic' }));
      return { origin, confidence: 1, set, ...(set.length === 1 ? { choice: set[0]! } : {}) };
    }
    case 'text':
      return { origin, confidence: 1, text: saved.text, choice: { intended: intendedText(saved.text), domain: 'generic' } };
    case 'checked':
      return { origin, confidence: 1, check: saved.checked };
  }
}

/** The value in the shape the field's kind takes (candidate.ts), and whether its layout was guessed; null when the
 *  value has no such shape. */
export function shapeFor(spec: FieldSpec, candidate: Candidate, vocab: Vocab): { shaped: Shaped; guessed: boolean } | null {
  const plain = (shaped: Shaped) => ({ shaped, guessed: false });
  switch (SHAPE_OF_KIND[spec.kind]) {
    case 'text': {
      if (candidate.text !== undefined) return plain({ shape: 'text', text: candidate.text });
      if (candidate.date === undefined) return null;
      const laid = dateText(candidate.date, spec.constraints);
      return laid === null ? null : { shaped: { shape: 'text', text: laid.text }, guessed: laid.guessed };
    }
    case 'choice': {
      const choice = candidate.choice ?? (candidate.set?.length === 1 ? candidate.set[0] : undefined);
      return choice ? plain({ shape: 'choice', choice }) : null;
    }
    case 'set': {
      const set = candidate.set ?? (candidate.choice ? [candidate.choice] : undefined);
      return set && set.length > 0 ? plain({ shape: 'set', set }) : null;
    }
    case 'check':
      return candidate.check === undefined ? null : plain({ shape: 'check', check: candidate.check });
    case 'date': {
      if (candidate.date === undefined) return null;
      const iso = dateIso(candidate.date, spec.constraints);
      return iso === null ? null : plain({ shape: 'date', iso });
    }
    case 'file':
      return candidate.file ? plain({ shape: 'file' }) : null;
    case 'search': {
      const choice = candidate.choice ?? (candidate.text !== undefined
        ? { intended: intendedText(candidate.text), domain: 'generic' as const } : undefined);
      if (!choice) return null;
      const queries = typeaheadQueries(choice.intended, vocab);
      return queries.length === 0 ? null : plain({ shape: 'search', queries, choice });
    }
  }
}

/** The intended value a shaped value stands for, for the Resolution. */
function intendedOf(shaped: Shaped): IntendedValue {
  switch (shaped.shape) {
    case 'text':
      return { kind: 'text', text: shaped.text };
    case 'choice':
    case 'search':
      return shaped.choice.intended;
    case 'set':
      return { kind: 'set', items: shaped.set.map((choice, priority) => ({ value: choice.intended, priority })) };
    case 'check':
      return { kind: 'boolean', value: shaped.check };
    case 'date': {
      const [y, m, d] = shaped.iso.split('-').map(Number);
      return { kind: 'date', y: y!, ...(m !== undefined ? { m } : {}), ...(d !== undefined ? { d } : {}) };
    }
    case 'file':
      return { kind: 'file', file: 'resume' };
  }
}

/** The value of a classified field, by its class (§8.2): the profile's, the policy's, or none. */
function valueOf(category: FieldCategory, rules: RuleClassification, spec: FieldSpec, ctx: ResolveContext): ValueResult {
  const { profile, settings, vocab, now } = ctx;
  switch (policyClassOf(category)) {
    case 'legal':
      return legalValue(category, spec, profile, vocab, { settings,
        ...(ctx.postingCountry !== undefined ? { postingCountry: ctx.postingCountry } : {}) });
    case 'eeo':
      return eeoValue(category, spec, profile, settings, vocab);
    case 'consent':
      return consentValue(category, rules.consentKinds, profile, settings);
    case 'attention':
      return none('attention-check', true, true);
    case 'free-text':
      return none('free-text-requires-user', true, true);
    case 'unknown':
      return none('unknown-field', false);
    default:
      return profileValue(category, { spec, profile, vocab, now, separatePhoneCountry: ctx.separatePhoneCountry ?? false });
  }
}

/** No value: needs-user for a field only the person answers, leave-blank (flagged) when a candidate existed or the
 *  person must see it (a required field among them), skip otherwise. */
function withoutValue(base: Omit<Resolution, 'action' | 'reason' | 'intended' | 'origin'>, spec: FieldSpec,
  reason: ReasonCode, flagged: boolean, needsUser: boolean): Resolution {
  const required = spec.required && (reason === 'no-profile-value' || reason === 'unknown-field');
  const action: Action = needsUser ? 'needs-user' : flagged || required ? 'leave-blank' : 'skip';
  return { ...base, intended: null, origin: null, action, reason };
}

/** Confidences are rounded to this many decimals, so float noise never moves a value across a threshold. */
const round = (value: number) => Math.round(value * 1e6) / 1e6;

/** The resolver's full answer for one field (§8.1). `classification` is classifyField's, when the caller has it. */
export function resolveField(spec: FieldSpec, ctx: ResolveContext, classification = classifyField(spec)):
  ResolvedField {
  const answer = (resolution: Resolution, shaped: Shaped | null = null, needsSensitive = false): ResolvedField =>
    ({ resolution, shaped, needsSensitive });
  if (classification.by === 'tripwire') {
    const rules = classification.rules;
    const category = rules?.category ?? rules?.asks ?? 'unknown';
    return answer({ key: spec.key, category, classifiedBy: rules?.classifiedBy ?? 'none',
      rule: 'guard.tripwire-in-label', intended: null, origin: null, confidence: 0, policy: policyClassOf(category),
      action: 'needs-user', reason: 'tripwire-in-label', awaiting: null });
  }
  if (classification.by === 'attention') {
    const category = classification.consent ?? 'attentionCheck';
    return answer({ key: spec.key, category, classifiedBy: 'label-rule', rule: `attention.${classification.patternId}`,
      intended: null, origin: null, confidence: LABEL_RULE_CONFIDENCE.strong, policy: policyClassOf(category),
      action: 'needs-user', reason: classification.consent === null ? 'attention-check' : 'consent-requires-user',
      awaiting: null });
  }
  const rules = classification.by === 'rules' ? classification.rules : null;
  if (rules?.needsUser !== undefined) {
    return answer({ key: spec.key, category: rules.asks, classifiedBy: rules.classifiedBy, rule: rules.rule,
      intended: null, origin: null, confidence: rules.confidence, policy: policyClassOf(rules.asks),
      action: 'needs-user', reason: needsUserReason(rules.needsUser, rules.asks), awaiting: null });
  }
  const category: FieldCategory = rules?.category ?? 'unknown';
  const policy = policyClassOf(category);
  const saved = findSavedAnswer(spec, ctx.savedAnswers, policy, ctx.company);
  const classifiedBy: Classifier = rules?.classifiedBy ?? (saved ? 'saved' : 'none');
  const classifyConfidence = saved ? Math.max(rules?.confidence ?? 0, CLASSIFY_SAVED_EXACT) : rules?.confidence ?? 0;
  const base = { key: spec.key, category, classifiedBy, rule: saved ? 'saved.exact-key' : rules?.rule ?? null,
    confidence: classifyConfidence, policy, awaiting: null };

  let result: ValueResult;
  let needsSensitive = false;
  if (saved) {
    result = value(savedCandidate(saved));
  } else if (rules === null) {
    result = none('unknown-field', false);
  } else {
    const gate = sensitiveGate(category, ctx.sensitiveState);
    if (gate === 'fetch') {
      needsSensitive = true;
      result = none('no-profile-value');
    } else {
      result = gate === 'ready' ? valueOf(category, rules, spec, ctx) : gate;
    }
  }
  if (!result.ok) {
    const { reason, flagged, needsUser } = result.none;
    return answer(withoutValue(base, spec, reason, flagged, needsUser === true), null, needsSensitive);
  }
  const { candidate } = result;
  const shaped = shapeFor(spec, candidate, ctx.vocab);
  if (shaped === null) return answer(withoutValue(base, spec, 'format-unsupported', true, false));
  const confidence = round(classifyConfidence * candidate.confidence);
  const flag: ReasonCode | undefined = candidate.flag ?? (shaped.guessed ? 'filled-low-confidence' : undefined)
    ?? (rules?.reason === 'classification-conflict' ? 'classification-conflict' : undefined);
  const action = actionFor(confidence, flag !== undefined);
  return answer({ ...base, confidence, intended: intendedOf(shaped.shaped), origin: candidate.origin,
    action, reason: action === 'leave-blank' ? 'low-confidence' : flag ?? 'ok' }, action === 'leave-blank'
    ? null : shaped.shaped);
}

/** The resolver's verdict on one field (§8.1): what it asks for, what value to put there, where that value came from
 *  and how sure we are, before matching. */
export function resolve(spec: FieldSpec, ctx: ResolveContext): Resolution {
  return resolveField(spec, ctx).resolution;
}
