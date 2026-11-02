/*
 * The resolver (docs/design/core.md §8.1, §8.6; docs/ARCHITECTURE.md "Resolver"): what a field asks for, what value to
 * put there, where it came from and how sure we are. The spec's order (autocomplete, name/id, label rules, saved
 * answers, LLM classification, unknown) is read as the evaluation order:
 *   0. a tripwire in the field's own label or description blocks it, and an attention check is the person's; both
 *      pre-empt everything;
 *   1-3. the rules decide the category (classifyByRules, Phase 1), and where they leave a list, a combobox or a radio
 *      group open, its one option that agrees makes it a consent asked as a choice (classifyRules consentChoice, the
 *      owner's decisions of 2026-11-01); one that hands the field to the person (a needsUser cause) makes it
 *      needs-user, whatever its topic's class would allow;
 *   4. a saved answer with the exact key, in a scope the category's policy allows, supplies the value: that is how
 *      saved answers beat the profile and the rules. Never for a field the classify screen withholds
 *      (screenForClassify: a sensitive topic in its label, description, section or options, an EEO answer or a decline
 *      phrase among its options): an EEO or legal question whose label names no topic ("How do you identify?" with
 *      Man, Woman, Non-binary) is the person's every time (the Phase 6 review, T6-1);
 *   5. LLM classification (Phase 4, classify.ts): a field nothing classified takes the category the LLM gave it, when
 *      planFrame has one, always flagged (answerFromLlm); otherwise it is 'unknown', and takes only a saved answer;
 *   then the value: the profile's (values.ts), or the EEO, legal and consent policy's (policy.ts), behind the
 *   sensitive part's gate, shaped for the field's kind (candidate.ts).
 * Confidence is classification × value here; the match multiplies in later (planFrame). An unanswered EEO, legal or
 * sensitive question, and a required field with no value, are flagged rather than skipped, so the person sees them.
 */
import { CLASSIFY_LLM, CLASSIFY_SAVED_EXACT, FILL_AT, FLAG_AT, LABEL_RULE_CONFIDENCE } from '../confidence';
import { attentionHits, namesConsentTopic } from '../guard/attention';
import { cutInjected } from '../guard/injected';
import { hasTripwire } from '../guard/tripwire';
import { intendedText } from '../matcher/intended';
import { typeaheadQueries } from '../matcher/typeahead';
import type { PlanSensitiveState } from '../plan/types';
import { normalize, normalizeLabel } from '../text/normalize';
import type { FieldSpec } from '../types/field';
import type { ReasonCode } from '../types/fill';
import type { FieldCategory, FileRef, IntendedValue } from '../types/intent';
import type { Action, Classifier, Resolution } from '../types/match';
import type { Profile, Ymd } from '../types/profile';
import type { SavedAnswer } from '../types/saved';
import type { Settings } from '../types/settings';
import type { VisibleText } from '../types/text';
import type { Vocab } from '../vocab/types';
import { none, NOTE_REASONS, SHAPE_OF_KIND, value, type Candidate, type Choice, type ValueResult } from './candidate';
import { policyClassOf } from './categories';
import { screenForClassify, type LlmClassification } from './classify';
import { classifyByRules, consentChoice, consentChoiceOption, type RuleClassification } from './classifyRules';
import { dateIso, dateText, type DateParts } from './format';
import { statementPolarity, type NeedsUserCause } from './labelRules';
import { consentValue, eeoDeclineDefault, eeoValue, legalValue, sensitiveGate } from './policy';
import { findSavedAnswer, type CompanyScope } from './saved';
import { previouslyEmployedValue, profileValue, type BlockEntries } from './values';

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
  /** The posting's country (ISO alpha-2), for interpretation 1 (the lookup's location: postingCountryOf); absent when
   *  unknown. */
  postingCountry?: string;
  /** The posting's company (the lookup's), for "Have you worked here before?"; absent when unknown. */
  postingCompany?: string;
  /** The profile entry each block of an assigned repeatable section is filled from (steps/blocks.ts, Phase 5). */
  blockEntries?: BlockEntries;
  /** The run used no AI at all (a profile-only frame, and no AI asked for its application before): an "I did not use
   *  AI" attestation is then true, and ticked (the owner's decision of 2026-11-01). */
  aiFree?: boolean;
}

/** What decided a field's category, before any value: a tripwire in its label, an attention check, the rules, the
 *  LLM (step 5, Phase 4: classify.ts's judgement of its answer, or of the screen that kept the field from it), or
 *  nothing. */
export type FieldClassification =
  | { by: 'tripwire'; rules: RuleClassification | null }
  | { by: 'attention'; patternId: string; consent: FieldCategory | null }
  | { by: 'rules'; rules: RuleClassification }
  | { by: 'llm'; llm: LlmClassification }
  | { by: 'none' };

/** Step 0 and steps 1 to 3 (§8.1): the tripwire in the field's own text, then attention checks, then the rules; with
 *  the vocabulary, a consent asked as a choice where the rules leave it open (classifyRules consentChoice: one
 *  option that plainly agrees, as the live BeyondTrust form's "Acknowledge/Confirm"). */
export function classifyField(spec: FieldSpec, vocab?: Vocab): FieldClassification {
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
  const choice = vocab === undefined ? null : consentChoice(spec, rules, vocab);
  if (choice !== null) return { by: 'rules', rules: choice };
  return rules === null ? { by: 'none' } : { by: 'rules', rules };
}

/** The value in the shape the field's kind takes. */
export type Shaped =
  | { shape: 'text'; text: string }
  | { shape: 'choice'; choice: Choice }
  | { shape: 'set'; set: Choice[] }
  | { shape: 'check'; check: boolean }
  | { shape: 'date'; iso: string }
  | { shape: 'file'; ref: FileRef }
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

/** The months, by their English names, as a list of months shows them. */
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
  'November', 'December'] as const;

/** Which part of a date a field asks for, by its label's last word: "Start Date month" and "Start date year", as
 *  Ashby's Education block (its adapter's suffixes) and Greenhouse's education fields name them; null otherwise. */
export function datePartOf(label: string): 'month' | 'year' | null {
  const last = label.trim().toLowerCase().split(/\s+/).at(-1);
  return last === 'month' || last === 'year' ? last : null;
}

/** The month an option's label names: its English name or abbreviation ("January", "Jan", "Sept."), its number ("1",
 *  "01"), or both ("01 - January", "1. Jan"); null for any other label, and for a label whose parts name two months. */
export function monthOfLabel(label: string): number | null {
  const words = label.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word !== '');
  if (words.length === 0 || words.length > 2) return null;
  let month: number | null = null;
  for (const word of words) {
    let named: number | null = null;
    if (/^\d{1,2}$/.test(word)) {
      const number = Number(word);
      named = number >= 1 && number <= 12 ? number : null;
    } else {
      const at = MONTH_NAMES.findIndex((name) => name.toLowerCase() === word
        || (word.length >= 3 && name.toLowerCase().startsWith(word) && (word.length === 3 || word === 'sept')));
      named = at < 0 ? null : at + 1;
    }
    if (named === null || (month !== null && month !== named)) return null;
    month = named;
  }
  return month;
}

/** A date's part as a list of months or of years answers it (datePartOf). The year is its four digits. The month is the
 *  option the list itself shows for it, read by monthOfLabel ("Aug", "08", "08 - August"), when the list is read and
 *  exactly one option names it; a list whose options name months but none or several of them this one has no answer
 *  (flagged); otherwise its English name, which the matcher then finds among the options. Undefined for any other
 *  label, and for a month the date lacks. */
export function datePartChoice(label: string, date: DateParts, options: FieldSpec['options'] = 'lazy'): Choice | undefined {
  const part = datePartOf(label);
  if (part === 'year') return { intended: intendedText(String(date.y)), domain: 'generic' };
  if (part !== 'month' || date.m === undefined || date.m < 1 || date.m > 12) return undefined;
  if (options !== 'lazy') {
    const read = options.map((option) => cutInjected(option.label).clean.trim());
    const named = read.filter((label) => monthOfLabel(label) === date.m);
    if (named.length === 1) return { intended: intendedText(named[0]!), domain: 'generic' };
    if (named.length > 1 || read.some((label) => monthOfLabel(label) !== null)) return undefined;
  }
  return { intended: intendedText(MONTH_NAMES[date.m - 1]!), domain: 'generic' };
}

/** The value in the shape the field's kind takes (candidate.ts), and whether its layout was guessed; null when the
 *  value has no such shape. A date for a list of months or of years is its part (datePartChoice), and for a text box
 *  that asks for its year (Greenhouse's "Start date year") its four digits. */
export function shapeFor(spec: FieldSpec, candidate: Candidate, vocab: Vocab): { shaped: Shaped; guessed: boolean } | null {
  const plain = (shaped: Shaped) => ({ shaped, guessed: false });
  switch (SHAPE_OF_KIND[spec.kind]) {
    case 'text': {
      if (candidate.text !== undefined) return plain({ shape: 'text', text: candidate.text });
      if (candidate.date === undefined) return null;
      if (datePartOf(spec.label) === 'year') return plain({ shape: 'text', text: String(candidate.date.y) });
      const laid = dateText(candidate.date, spec.constraints);
      return laid === null ? null : { shaped: { shape: 'text', text: laid.text }, guessed: laid.guessed };
    }
    case 'choice': {
      const choice = candidate.choice ?? (candidate.set?.length === 1 ? candidate.set[0] : undefined)
        ?? (candidate.date === undefined ? undefined : datePartChoice(spec.label, candidate.date, spec.options));
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
      return candidate.file ? plain({ shape: 'file', ref: candidate.file }) : null;
    case 'search': {
      const choice = candidate.choice ?? (candidate.text !== undefined
        ? { intended: intendedText(candidate.text), domain: 'generic' as const } : undefined);
      if (!choice) return null;
      const queries = typeaheadQueries(choice.intended, vocab, choice.place);
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
      return { kind: 'file', file: shaped.ref };
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
      return consentValue(category, rules.consentKinds, profile, settings,
        { required: spec.required, aiFree: ctx.aiFree === true, choice: consentChoiceOption(spec, vocab) });
    case 'attention':
      return none('attention-check', true, true);
    case 'free-text':
      // v3 Phase 3b: a cover-letter text box takes the run's letter's words, once the worker holds them.
      if (category === 'freeText.coverLetter' && profile.coverLetter?.text !== undefined) {
        return profileValue(category, { spec, profile, vocab, now, separatePhoneCountry: false });
      }
      return none('free-text-requires-user', true, true);
    case 'unknown':
      return category === 'screening.previouslyEmployed'
        ? previouslyEmployedValue(profile, ctx.postingCompany, `${spec.label} ${spec.description}`)
        : none('unknown-field', false);
    default:
      return profileValue(category, { spec, profile, vocab, now, separatePhoneCountry: ctx.separatePhoneCountry ?? false,
        ...(ctx.blockEntries ? { blockEntries: ctx.blockEntries } : {}) });
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

/** Everything a lone checkbox's statement says, normalized: its label with the parentheticals, and its help text
 *  when the rules read the category there. */
function statementText(spec: FieldSpec, rules: RuleClassification | null): string {
  const label = normalize(spec.label, 'label');
  const words = [label.key, ...label.qualifiers.map((qualifier) => qualifier.tokens.join(' '))];
  if (rules?.matchedOn === 'description') words.push(normalizeLabel(spec.description));
  return words.join(' ');
}

/**
 * Step 5 (§8.4): a field only the LLM classified (classify.ts judged its answer). An accepted category scores
 * CLASSIFY_LLM (0.70) at most and is always flagged; a field the person must answer (a needs-user category, a screened
 * field, a lone checkbox, one that offers a decline option) shows the suggested category and stays blank; one the LLM
 * left unknown keeps its reason, flagged when the LLM could not help (unreachable, or an answer that could not be used).
 */
function answerFromLlm(spec: FieldSpec, ctx: ResolveContext, llm: LlmClassification): ResolvedField {
  const answer = (resolution: Resolution, shaped: Shaped | null = null): ResolvedField =>
    ({ resolution, shaped, needsSensitive: false });
  if (llm.kind === 'none') {
    const unknown = { key: spec.key, category: 'unknown' as const, classifiedBy: 'none' as const, rule: null,
      confidence: 0, policy: 'unknown' as const, awaiting: null };
    return answer(withoutValue(unknown, spec, llm.reason, llm.reason !== 'unknown-field', false));
  }
  const { category } = llm;
  const base = { key: spec.key, category, classifiedBy: 'llm-classify' as const, rule: 'llm.classify',
    confidence: CLASSIFY_LLM, policy: policyClassOf(category), awaiting: null };
  if (llm.kind === 'needs-user') {
    return answer({ ...base, intended: null, origin: null, action: 'needs-user', reason: llm.reason });
  }
  // judgeClassification lets only the profile class through, whose values need no sensitive part; checked again.
  if (sensitiveGate(category, ctx.sensitiveState) !== 'ready' || policyClassOf(category) !== 'profile') {
    return answer(withoutValue(base, spec, 'llm-disabled-for-category', true, true));
  }
  const result = profileValue(category, { spec, profile: ctx.profile, vocab: ctx.vocab, now: ctx.now,
    separatePhoneCountry: ctx.separatePhoneCountry ?? false, ...(ctx.blockEntries ? { blockEntries: ctx.blockEntries } : {}) });
  if (!result.ok) {
    const { reason, flagged, needsUser } = result.none;
    return answer(withoutValue(base, spec, reason, flagged, needsUser === true));
  }
  const { candidate } = result;
  const shaped = shapeFor(spec, candidate, ctx.vocab);
  if (shaped === null) return answer(withoutValue(base, spec, 'format-unsupported', true, false));
  // Never a tick on the LLM's word alone.
  if (shaped.shaped.shape === 'check') return answer(withoutValue(base, spec, 'llm-disabled-for-category', true, true));
  const confidence = round(Math.min(CLASSIFY_LLM, CLASSIFY_LLM * candidate.confidence));
  const action = actionFor(confidence, true);
  return answer({ ...base, confidence, intended: intendedOf(shaped.shaped), origin: candidate.origin, action,
    reason: action === 'leave-blank' ? 'low-confidence' : candidate.flag ?? 'llm-classified-needs-review' },
  action === 'leave-blank' ? null : shaped.shaped);
}

/** The resolver's full answer for one field (§8.1). `classification` is classifyField's, when the caller has it. */
export function resolveField(spec: FieldSpec, ctx: ResolveContext, classification = classifyField(spec, ctx.vocab)):
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
  if (classification.by === 'llm') return answerFromLlm(spec, ctx, classification.llm);
  const rules = classification.by === 'rules' ? classification.rules : null;
  if (rules?.needsUser !== undefined) {
    return answer({ key: spec.key, category: rules.asks, classifiedBy: rules.classifiedBy, rule: rules.rule,
      intended: null, origin: null, confidence: rules.confidence, policy: policyClassOf(rules.asks),
      action: 'needs-user', reason: needsUserReason(rules.needsUser, rules.asks), awaiting: null });
  }
  const category: FieldCategory = rules?.category ?? 'unknown';
  const policy = policyClassOf(category);
  // A screened question never takes a saved answer (T6-1): screened only when one would apply, which is rare.
  const found = findSavedAnswer(spec, ctx.savedAnswers, policy, ctx.company);
  const saved = found !== null && screenForClassify(spec, ctx.vocab) === null ? found : null;
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
    } else if (gate === 'ready') {
      result = valueOf(category, rules, spec, ctx);
    } else {
      // A self-identification question this browser may not read the answer for takes the decline default; one whose
      // answer could not be read (the fetch failed) stays blank and flagged.
      const declined = policy === 'eeo' && ctx.sensitiveState === 'not-shared'
        ? eeoDeclineDefault(category, spec, ctx.settings) : null;
      result = declined ?? gate;
    }
  }
  if (!result.ok) {
    const { reason, flagged, needsUser } = result.none;
    return answer(withoutValue(base, spec, reason, flagged, needsUser === true), null, needsSensitive);
  }
  const { candidate } = result;
  const shaped = shapeFor(spec, candidate, ctx.vocab);
  if (shaped === null) return answer(withoutValue(base, spec, 'format-unsupported', true, false));
  // A lone checkbox states one thing, so it is ticked from an answer only when its statement is affirmative and the
  // tick then says exactly that answer (the review, CORE-2). A saved answer is the person's own for this very
  // statement; consent reads its own wording (an opt-out is unrecognised consent).
  if (shaped.shaped.shape === 'check' && candidate.origin.provenance !== 'saved' && policy !== 'consent'
    && statementPolarity(statementText(spec, rules)) !== 'affirmative') {
    return answer(withoutValue(base, spec, 'statement-not-affirmative', true, true));
  }
  const confidence = round(classifyConfidence * candidate.confidence);
  const flag: ReasonCode | undefined = candidate.flag ?? (shaped.guessed ? 'filled-low-confidence' : undefined)
    ?? (rules?.reason === 'classification-conflict' ? 'classification-conflict' : undefined);
  const action = actionFor(confidence, flag !== undefined);
  // A note names how the value came (the decline default) without flagging it.
  const note = candidate.note !== undefined && NOTE_REASONS.has(candidate.note) ? candidate.note : undefined;
  return answer({ ...base, confidence, intended: intendedOf(shaped.shaped), origin: candidate.origin,
    action, reason: action === 'leave-blank' ? 'low-confidence' : flag ?? note ?? 'ok' }, action === 'leave-blank'
    ? null : shaped.shaped);
}

/** The resolver's verdict on one field (§8.1): what it asks for, what value to put there, where that value came from
 *  and how sure we are, before matching. */
export function resolve(spec: FieldSpec, ctx: ResolveContext): Resolution {
  return resolveField(spec, ctx).resolution;
}
