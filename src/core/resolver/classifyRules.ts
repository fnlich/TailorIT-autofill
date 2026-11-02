/*
 * The deterministic part of classification (docs/design/core.md §8.1, steps 1 to 3): the autocomplete attribute, the
 * name and id attributes and the label rules each say what a field is, and combine() settles them. Agreement adds a
 * little confidence; a disagreement flags the field. The attention and tripwire checks run before this and pre-empt
 * it; saved answers and LLM classification come after it, in the resolver.
 *
 * The resolver review (2026-10-30) added what keeps a wrong value out when the sources mislead, since saved answers
 * come next (§8.1 step 4) and would otherwise fill what the rules leave open:
 * - a field about another person (a referee, an emergency contact) takes none of the applicant's own details;
 * - a generic autocomplete token (url, organization) gives way to the specific label it agrees with in kind;
 * - without a strong label rule, two sources that agree outvote one that does not, whatever its precedence;
 * - a closed-class reading that another source contradicts, and one read from the help text alone, go to the person;
 * - what no rule classifies is screened for sensitive topics before the textarea and checkbox fallbacks.
 * A classification with `needsUser` is the person's: it carries no `category`, only what it `asks` about, so nothing
 * downstream can look up a policy for it and fill it; the resolver gives it the action `needs-user`.
 */
import {
  CLASSIFY_AGREE_BONUS, CLASSIFY_AGREE_CAP, CLASSIFY_CONFLICT_FACTOR, LABEL_RULE_CONFIDENCE,
} from '../confidence';
import type { FieldKind } from '../enums';
import { prepareOptions } from '../matcher/prepare';
import type { FieldSpec } from '../types/field';
import type { ReasonCode } from '../types/fill';
import type { FieldCategory, PolicyClass } from '../types/intent';
import type { Classifier } from '../types/match';
import { normalize, normalizeLabel } from '../text/normalize';
import type { Vocab } from '../vocab/types';
import { autocompleteRule } from './autocomplete';
import { policyClassOf } from './categories';
import {
  affirmativeOption, attestsNoAiUse, consentChoiceHit, matchLabelRules, sectionKindOf, unlabelledTextarea,
  unrecognisedField, withDescriptionConsent, type LabelContext, type LabelRuleHit, type NeedsUserCause,
} from './labelRules';
import { nameIdRule, nameIdText } from './nameId';

/** The classifiers a rule can be. */
export type RuleClassifier = Extract<Classifier, 'autocomplete' | 'name-id' | 'label-rule'>;

/** Where a label rule found its match: the label alone, or the label and description together (§8.3). */
export type LabelMatchedOn = 'label' | 'description';

/** One source's verdict, as combine() reads it. */
export interface RuleVote {
  classifiedBy: RuleClassifier;
  category: FieldCategory;
  confidence: number;
  /** The rule's id: 'autocomplete.given-name', 'name-id.email', 'label.first-name'. */
  rule: string;
  /** A strong label rule: the one source that overrules a conflicting autocomplete token. */
  strongLabel: boolean;
  /** Label votes only. */
  matchedOn?: LabelMatchedOn;
  /** Label votes on a consent category only: see LabelRuleHit. */
  consentKinds?: FieldCategory[];
  /** Label votes only: see LabelRuleHit. */
  needsUser?: NeedsUserCause;
}

/** What every rule classification holds. */
interface RuleClassificationBase {
  /** The classification part of the final confidence (classification × value × match). */
  confidence: number;
  classifiedBy: RuleClassifier;
  rule: string;
  /** `classification-conflict` when a source disagreed with the winner, so the field is flagged. */
  reason: Extract<ReasonCode, 'ok' | 'classification-conflict'>;
  /** Set when a label rule decided. */
  matchedOn?: LabelMatchedOn;
  /** Set when a label rule decided a consent category: every consent kind the label matched, strictest first. */
  consentKinds?: FieldCategory[];
}

/** A field the rules classified: its category's policy says what may fill it. */
export interface CategorizedClassification extends RuleClassificationBase {
  category: FieldCategory;
  needsUser?: undefined;
  asks?: undefined;
}

/**
 * A field only the person may answer, whatever its topic's policy would allow: no profile value, pre-approval, saved
 * answer or LLM. It has no `category`, so no policy can be looked up for it and nothing can fill it by mistake; the
 * resolver leaves it blank and flags it (action `needs-user`), and the panel shows what it `asks` about.
 */
export interface HandedOverClassification extends RuleClassificationBase {
  category?: undefined;
  /** What the field asks about, for the panel only: never a category to fill. */
  asks: FieldCategory;
  /** Why the field is the person's. */
  needsUser: NeedsUserCause;
}

/** What the rules say a field is: a category, or the person's (`needsUser`). */
export type RuleClassification = CategorizedClassification | HandedOverClassification;

/** The classification for `category`, handed to the person when `needsUser` is set. */
function classification(category: FieldCategory, base: RuleClassificationBase, needsUser?: NeedsUserCause):
  RuleClassification {
  return needsUser === undefined ? { category, ...base } : { asks: category, ...base, needsUser };
}

/** Confidences are rounded to this many decimals, so float noise never moves a value across a threshold. */
const DECIMALS = 6;
const round = (value: number) => Math.round(value * 10 ** DECIMALS) / 10 ** DECIMALS;

/** The classes only the profile's explicit values, settings or the person may answer: when another source contradicts
 *  a vote in one, no precedence may settle it (the review), so the field is the person's. */
const CLOSED_CLASSES: readonly PolicyClass[] = ['legal', 'eeo', 'consent', 'sensitive'];

/**
 * Which vote wins a disagreement: a strong label rule, then autocomplete, then name/id, then any other label rule.
 * §8.1 says a strong label rule wins over a conflicting autocomplete token and otherwise autocomplete wins; name/id
 * sits between them, as in the spec's order (autocomplete, name/id, label rules), and below a strong label rule, which
 * beats even autocomplete.
 */
function precedence(vote: RuleVote): number {
  if (vote.classifiedBy === 'label-rule') return vote.strongLabel ? 0 : 3;
  return vote.classifiedBy === 'autocomplete' ? 1 : 2;
}

const first = (votes: readonly RuleVote[]) => votes.reduce((best, vote) => (precedence(vote) < precedence(best)
  ? vote : best));

/**
 * Which vote decides, and whether the field is then the person's. A vote that hands the field to the person decides.
 * A closed-class vote (legal, EEO, consent, sensitive) that another vote contradicts decides, and the field is the
 * person's ('source-conflict'). Otherwise a strong label rule decides (§8.1); without one, the category most votes
 * agree on, so a label rule and a name together outvote one autocomplete token; a tie goes by precedence.
 */
function decide(present: readonly RuleVote[]): { winner: RuleVote; needsUser?: NeedsUserCause } {
  const handedOver = present.filter((vote) => vote.needsUser !== undefined);
  if (handedOver.length > 0) {
    const winner = first(handedOver);
    return { winner, needsUser: winner.needsUser! };
  }
  const closed = present.filter((vote) => CLOSED_CLASSES.includes(policyClassOf(vote.category)));
  if (closed.length > 0 && present.some((vote) => vote.category !== present[0]!.category)) {
    return { winner: first(closed), needsUser: 'source-conflict' };
  }
  const strong = present.filter((vote) => vote.strongLabel);
  if (strong.length > 0) return { winner: first(strong) };
  const votesFor = (category: FieldCategory) => present.filter((vote) => vote.category === category).length;
  const most = Math.max(...present.map((vote) => votesFor(vote.category)));
  return { winner: first(present.filter((vote) => votesFor(vote.category) === most)) };
}

/**
 * §8.1's combine(). With one vote, that vote. When votes agree, the higher confidence plus 0.02, capped at 0.99. When
 * any vote disagrees, the winner (see decide) keeps its category, its confidence, with the agreement bonus if another
 * vote agreed with it, is multiplied by 0.8, and the reason is `classification-conflict`. The winner also names the
 * classifier and the rule; when votes agree, that is the one of highest precedence.
 */
export function combine(votes: ReadonlyArray<RuleVote | null>): RuleClassification | null {
  const present = votes.filter((vote): vote is RuleVote => vote !== null);
  if (present.length === 0) return null;
  const { winner, needsUser } = decide(present);
  const agreeing = present.filter((vote) => vote.category === winner.category);
  const conflict = agreeing.length < present.length;
  let confidence = Math.max(...agreeing.map((vote) => vote.confidence));
  if (agreeing.length > 1) confidence = Math.min(confidence + CLASSIFY_AGREE_BONUS, CLASSIFY_AGREE_CAP);
  if (conflict) confidence *= CLASSIFY_CONFLICT_FACTOR;
  const base: RuleClassificationBase = {
    confidence: round(confidence),
    classifiedBy: winner.classifiedBy,
    rule: winner.rule,
    reason: conflict ? 'classification-conflict' : 'ok',
  };
  if (winner.matchedOn !== undefined) base.matchedOn = winner.matchedOn;
  if (winner.consentKinds !== undefined) base.consentKinds = winner.consentKinds;
  return classification(winner.category, base, needsUser);
}

function labelVote(hit: LabelRuleHit, matchedOn: LabelMatchedOn): RuleVote {
  const vote: RuleVote = { classifiedBy: 'label-rule', category: hit.category, confidence: hit.confidence,
    rule: hit.rule, strongLabel: hit.strength === 'strong', matchedOn };
  if (hit.consentKinds !== undefined) vote.consentKinds = hit.consentKinds;
  if (hit.needsUser !== undefined) vote.needsUser = hit.needsUser;
  return vote;
}

/** A '#' closing a word of two letters or more: normalization keeps it (so "C#" and "C" stay apart), but a page writes
 *  "Phone#" for "Phone number", so the rules read the word without it. A one-letter word keeps it ("c#"). */
const CLOSING_HASH = /(?<=\b[a-z]{2,})#+(?=\s|$)/g;

/** The text the label rules read for a normalized label or description: CLOSING_HASH dropped. */
export function ruleText(key: string): string {
  return key.replace(CLOSING_HASH, '');
}

/** The classes a category read from the help text alone may never be filled in: the closed ones and attention. */
const CLOSED_FROM_DESCRIPTION: readonly PolicyClass[] = [...CLOSED_CLASSES, 'attention'];

/**
 * The label rules over the normalized label; when nothing matches it and the field has a description, over the
 * normalized label and description together (§8.3's "plus the description for long questions"). A consent label also
 * takes the consent kinds of its description, which only ever make it stricter. A legal, EEO, consent, sensitive or
 * attention category found only once the description is read is the person's: help text names topics the question
 * does not ask ("Do you need any accommodations?" over a paragraph about disability).
 */
function labelRuleVote(spec: FieldSpec, label: string, context: LabelContext): RuleVote | null {
  const section = sectionKindOf(spec.section.id);
  const description = ruleText(normalizeLabel(spec.description));
  const onLabel = matchLabelRules(label, section, spec.kind, context);
  if (onLabel !== null) return labelVote(withDescriptionConsent(onLabel, description, spec.kind), 'label');
  if (description === '') return null;
  const both = label === '' ? description : `${label} ${description}`;
  const onBoth = matchLabelRules(both, section, spec.kind, context);
  if (onBoth === null) return null;
  const closed = CLOSED_FROM_DESCRIPTION.includes(policyClassOf(onBoth.category));
  return labelVote(closed && onBoth.needsUser === undefined ? { ...onBoth, needsUser: 'description-only' } : onBoth,
    'description');
}

/**
 * The generic autocomplete tokens (§8.3 scores them 0.85 because sites use them for any link or organisation) and the
 * categories each stands for: a label or name naming one of them more precisely is no conflict, and decides.
 */
const GENERIC_TOKEN_CATEGORIES: Readonly<Record<string, readonly FieldCategory[]>> = {
  'autocomplete.url': ['links.linkedin', 'links.github', 'links.portfolio', 'links.website', 'links.twitter',
    'links.other'],
  'autocomplete.organization': ['experience.company', 'experience.currentCompany'],
  'autocomplete.organization-title': ['experience.title', 'experience.currentTitle'],
};

/** A field about someone other than the applicant, named in the label: a referee, an emergency contact, a manager. A
 *  job's own reference ("Job reference", "Reference number") is not a person. */
const OTHER_PERSON_LABEL = /\b(?:referr?ers?|referees?|reference\s+\d+|(?<!\b(?:job|requisition|posting|vacancy|role|position)\s)references?(?!\s+(?:number|no|num|code|id|letters?)\b)|emergency|next\s+of\s+kin|spouse|guardian|managers?|supervisors?|recruiters?|referral\s+(?:name|email|e\s?mail|phone|contact|first|last|full)|referring\s+(?:employee|person)|employee\s+referral)\b/;
/** The same in the name and id attributes, as nameIdText writes them ("referrer_email", "reference1_first_name"). */
const OTHER_PERSON_ID = /(?:^|[_ ])(?<!(?:job|requisition|posting|vacancy)_)(?:referr?er\w*|referee\w*|references?\d*|emergency\w*|spouse\w*|guardian\w*|manager\w*|supervisor\w*|recruiter\w*)(?![_ ](?:number|no|num|code|id)(?:[_ ]|$))(?=[_ \d]|$)/;
/** A section about other people ("references", "emergency-contact"). */
const OTHER_PERSON_SECTION = /\b(?:references?|referees?|referrers?|referrals?|emergency|kin)\b/;

/** Which source names another person: the label (or the section), else the name and id attributes; null for none. */
function otherPersonNamedBy(spec: FieldSpec, label: string): RuleClassifier | null {
  const section = spec.section.id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  if (OTHER_PERSON_LABEL.test(label) || OTHER_PERSON_SECTION.test(section)) return 'label-rule';
  return OTHER_PERSON_ID.test(nameIdText(spec.nameAttr, spec.idAttr)) ? 'name-id' : null;
}

/** Whether a field asks about someone other than the applicant (a referee, an emergency contact, a manager), by its
 *  label, its section or its name and id: an AI answer never fills one (plan/answers.ts, the Phase E review, M2). */
export function namesAnotherPerson(spec: FieldSpec): boolean {
  return otherPersonNamedBy(spec, ruleText(normalize(spec.label, 'label').key)) !== null;
}

/** Whether a field's own words state "I did not use AI" (labelRules attestsNoAiUse): its normalized label with its
 *  parentheticals, or its description (the Phase E review, M5). */
export function statesNoAiUse(spec: Pick<FieldSpec, 'label' | 'description'>): boolean {
  const normalized = normalize(spec.label, 'label');
  const label = [ruleText(normalized.key), ...normalized.qualifiers.map((qualifier) => qualifier.tokens.join(' '))]
    .join(' ').trim();
  const description = ruleText(normalizeLabel(spec.description));
  return [label, description].some((text) => text !== '' && attestsNoAiUse(text));
}

/** The applicant's own details: none of them belongs in a field about another person. Referral fields stay. */
const isOwnDetail = (vote: RuleVote) => policyClassOf(vote.category) === 'profile'
  && !vote.category.startsWith('referral.');

/** A telephone box that is not the applicant's own number: a fax, an extension, a country or area code alone. */
const NOT_OWN_PHONE = /\bfax\b|\bext(?:ension)?\b|\b(?:country|area|dial(?:ing)?)\s+code\b|\bpager\b/;

/**
 * What the screen catches in a field no rule classifies (the design's classify screen runs only at LLM classification,
 * after saved answers): self-identification, authorization, criminal history, age, pay, and consent wording. Such a
 * field is the person's, so no saved answer or LLM answers it.
 */
export const SENSITIVE_TOPIC = /\b(?:disabilit\w*|disabled|handicap\w*|veterans?|military|armed\s+forces|race|races|racial|ethnic\w*|hispanic|latin[oax]|gender|sex|sexual|transgender|cisgender|lgbt\w*|queer|pronouns?|citizen\w*|nationalit\w*|visas?|sponsor\w*|immigra\w*|work\s+permits?|authori[sz]\w*|eligib\w*|criminal|convict\w*|felon\w*|arrest\w*|offen[cs]es?|offenders?|age|birth\w*|salary|salaries|compensation|wages?|religio\w*|pregnan\w*|marital|medical\s+conditions?|consent\w*|agree\w*|share\s+(?:my|your)\s+(?:data|information))\b/;

/**
 * What the deterministic rules say `spec` is: the autocomplete, name/id and label votes combined (§8.1), each checked
 * against the field's kind (CATEGORY_KINDS), so a mismatch is no vote. A field about another person keeps none of the
 * applicant's own details (`screening.other` when nothing else is left). What nothing classifies is, in order: the
 * person's when it names a sensitive topic; free text when it is a textarea (`freeText.other`, weak, as §8.3 has it
 * for an unlabelled one), outside an experience or education section; unrecognised consent when it is a lone checkbox.
 * Otherwise null: the resolver then tries saved answers and LLM classification. A rule that decides `unknown` ("Resume"
 * on a text field) is a classification, not a miss, so it is returned as such.
 */
export function classifyByRules(spec: FieldSpec): RuleClassification | null {
  const normalized = normalize(spec.label, 'label');
  const label = ruleText(normalized.key);
  const context: LabelContext = { qualifiers: normalized.qualifiers.map((q) => q.tokens.join(' ')).join(' '),
    rawLabel: spec.label };
  if (spec.section.block !== undefined) context.block = spec.section.block;
  const autocomplete = autocompleteRule(spec.autocomplete, spec.kind);
  const nameId = nameIdRule(spec.nameAttr, spec.idAttr, spec.kind);
  let votes = [
    autocomplete && { classifiedBy: 'autocomplete' as const, ...autocomplete, strongLabel: false },
    nameId && { classifiedBy: 'name-id' as const, category: nameId.category, confidence: nameId.confidence,
      rule: nameId.rule, strongLabel: false },
    labelRuleVote(spec, label, context),
  ].filter((vote): vote is RuleVote => vote !== null);
  const generic = votes.find((vote) => GENERIC_TOKEN_CATEGORIES[vote.rule] !== undefined);
  if (generic !== undefined && votes.some((vote) => vote.category !== generic.category
    && GENERIC_TOKEN_CATEGORIES[generic.rule]!.includes(vote.category))) {
    votes = votes.filter((vote) => vote !== generic);
  }
  const otherPerson = otherPersonNamedBy(spec, label);
  if (otherPerson !== null && votes.some(isOwnDetail)) {
    votes = votes.filter((vote) => !isOwnDetail(vote));
    if (votes.length === 0) {
      const base: RuleClassificationBase = { confidence: LABEL_RULE_CONFIDENCE.normal, classifiedBy: otherPerson,
        rule: 'label.another-person', reason: 'ok' };
      if (otherPerson === 'label-rule') base.matchedOn = 'label';
      return classification('screening.other', base);
    }
  }
  const combined = combine(votes);
  if (combined !== null) return combined;
  const sensitive = SENSITIVE_TOPIC.test(`${label} ${normalizeLabel(spec.description)}`);
  // A telephone box (input type=tel) whose label no rule reads ("Best Contact Number", multiverse 2026-11-01) is a
  // phone, weakly (filled and flagged for a look): never another person's, a fax or an extension.
  if (!sensitive && spec.kind === 'text' && spec.constraints.format === 'tel' && otherPerson === null
    && !NOT_OWN_PHONE.test(label)) {
    return classification('contact.phone', { confidence: LABEL_RULE_CONFIDENCE.weak, classifiedBy: 'label-rule',
      rule: 'format.tel', reason: 'ok', matchedOn: 'label' });
  }
  if (sensitive) {
    return classification('unknown', { confidence: LABEL_RULE_CONFIDENCE.weak, classifiedBy: 'label-rule',
      rule: 'label.sensitive-topic', reason: 'ok', matchedOn: 'label' }, 'sensitive-topic');
  }
  // A textarea in an employment or school block is more often that entry's own text ("Role description") than a
  // question, so it is left to LLM classification there.
  const inBlock = spec.kind === 'textarea' && sectionKindOf(spec.section.id) !== 'other';
  const fallback = unlabelledTextarea(label, spec.kind) ?? (inBlock ? null : unrecognisedField(spec.kind));
  return fallback === null ? null : combine([labelVote(fallback, 'label')]);
}

// ---------------------------------------------------------------------------------------------------------------
// A consent asked as a choice

/** The kinds a consent may be asked as a choice on: a list, a combobox, a radio group (a lone box is consent's own). */
const CONSENT_CHOICE_KINDS: readonly FieldKind[] = ['select', 'combobox', 'radio'];

/** The consent words SENSITIVE_TOPIC's fallback reads: a label that names no sensitive topic but these is consent. */
const CONSENT_WORDS = /\b(?:consent\w*|agree\w*|share\s+(?:my|your)\s+(?:data|information))\b/g;

/**
 * The one option a consent asked as a choice offers (the owner's decision of 2026-11-01): on a list, a combobox or a
 * radio group read whole, the only option that can be chosen (a placeholder aside), when it plainly agrees
 * (labelRules affirmativeOption: "Acknowledge/Confirm", "I agree", "Yes"), as its clean label; 'pending' while the
 * options are not read (a combobox shows them only when opened); null for any other field: several options a person
 * can choose (a Yes and a No, a list of answers: no consent but a question), one that does not agree, one disabled, one
 * read only in part, or any option with injected text cut.
 */
export function consentChoiceOption(spec: Pick<FieldSpec, 'kind' | 'options' | 'optionsPartial'>, vocab: Vocab):
  string | 'pending' | null {
  if (!CONSENT_CHOICE_KINDS.includes(spec.kind)) return null;
  if (spec.options === 'lazy') return 'pending';
  if (spec.optionsPartial === true) return null;
  const list = prepareOptions(spec.options, 'generic', vocab).list;
  if (list.some((option) => option.injected)) return null;
  const usable = list.filter((option) => !option.unusable);
  const only = usable.length === 1 ? usable[0]! : null;
  if (only === null || only.disabled || !affirmativeOption(normalizeLabel(only.clean))) return null;
  return only.clean;
}

/** Whether the rules leave a field to a consent read as a choice: they classify nothing, they hand a consent to the
 *  person only because its kind holds no box (kind-mismatch), or they hand it over for a sensitive topic that is only
 *  its consent wording ("Consent to processing"). A field the rules read as anything else keeps that reading. */
function opensToConsentChoice(spec: FieldSpec, rules: RuleClassification | null, label: string): boolean {
  if (rules === null) return true;
  const asks = rules.category ?? rules.asks;
  if (policyClassOf(asks) === 'consent') return rules.needsUser === 'kind-mismatch';
  return rules.needsUser === 'sensitive-topic' && rules.rule === 'label.sensitive-topic'
    && !SENSITIVE_TOPIC.test(`${label} ${normalizeLabel(spec.description)}`.replace(CONSENT_WORDS, ' '));
}

/**
 * A consent asked as a choice (the owner's decision of 2026-11-01, docs/SPEC-AMENDMENTS.md §11; the live BeyondTrust
 * form's "Please review and acknowledge BeyondTrust's" with its one option "Acknowledge/Confirm"): a list, a combobox
 * or a radio group the rules leave open (opensToConsentChoice) whose one option plainly agrees (consentChoiceOption),
 * and whose label, with that option's words, is consent wording (labelRules consentChoiceHit): its consent kinds,
 * strictest first, so the consent policy decides it as it decides a box (policy.ts consentValue: a required one is
 * chosen, an optional one only when pre-approved, an AI attestation only in a run that used no AI). A combobox whose
 * options are not read yet is read so by its label alone, and waits for them (consentValue). Null for anything else:
 * the field is read as before. A tripwire, an attention check, a honeypot and a hidden field are refused before this
 * (resolve.ts classifyField, planFrame).
 */
export function consentChoice(spec: FieldSpec, rules: RuleClassification | null, vocab: Vocab): RuleClassification | null {
  if (!CONSENT_CHOICE_KINDS.includes(spec.kind)) return null;
  const normalized = normalize(spec.label, 'label');
  const label = [ruleText(normalized.key), ...normalized.qualifiers.map((qualifier) => qualifier.tokens.join(' '))]
    .join(' ').trim();
  if (label === '' || !opensToConsentChoice(spec, rules, label)) return null;
  const option = consentChoiceOption(spec, vocab);
  if (option === null) return null;
  const asked = option === 'pending' ? label : `${label} ${normalizeLabel(option)}`;
  const hit = consentChoiceHit(asked, ruleText(normalizeLabel(spec.description)));
  if (hit === null) return null;
  return { category: hit.category, confidence: hit.confidence, classifiedBy: 'label-rule', rule: hit.rule,
    reason: 'ok', matchedOn: 'label', consentKinds: hit.consentKinds! };
}
