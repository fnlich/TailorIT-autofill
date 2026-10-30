/*
 * The deterministic part of classification (docs/design/core.md §8.1, steps 1 to 3): the autocomplete attribute, the
 * name and id attributes and the label rules each say what a field is, and combine() settles them. Agreement adds a
 * little confidence; a disagreement flags the field. The attention and tripwire checks run before this and pre-empt
 * it; saved answers and LLM classification come after it, in the resolver.
 */
import {
  CLASSIFY_AGREE_BONUS, CLASSIFY_AGREE_CAP, CLASSIFY_CONFLICT_FACTOR,
} from '../confidence';
import type { FieldSpec } from '../types/field';
import type { ReasonCode } from '../types/fill';
import type { FieldCategory } from '../types/intent';
import type { Classifier } from '../types/match';
import { normalizeLabel } from '../text/normalize';
import { autocompleteRule } from './autocomplete';
import { matchLabelRules, sectionKindOf, unlabelledTextarea, type LabelRuleHit } from './labelRules';
import { nameIdRule } from './nameId';

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
}

/** What the rules say a field is. */
export interface RuleClassification {
  category: FieldCategory;
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

/** Confidences are rounded to this many decimals, so float noise never moves a value across a threshold. */
const DECIMALS = 6;
const round = (value: number) => Math.round(value * 10 ** DECIMALS) / 10 ** DECIMALS;

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

/**
 * §8.1's combine(). With one vote, that vote. When votes agree, the higher confidence plus 0.02, capped at 0.99. When
 * any vote disagrees, the winner (see precedence) keeps its category, its confidence, with the agreement bonus if
 * another vote agreed with it, is multiplied by 0.8, and the reason is `classification-conflict`. The winner also names
 * the classifier and the rule; when votes agree, that is the one of highest precedence.
 */
export function combine(votes: ReadonlyArray<RuleVote | null>): RuleClassification | null {
  const present = votes.filter((vote): vote is RuleVote => vote !== null);
  if (present.length === 0) return null;
  const winner = present.reduce((best, vote) => (precedence(vote) < precedence(best) ? vote : best));
  const agreeing = present.filter((vote) => vote.category === winner.category);
  const conflict = agreeing.length < present.length;
  let confidence = Math.max(...agreeing.map((vote) => vote.confidence));
  if (agreeing.length > 1) confidence = Math.min(confidence + CLASSIFY_AGREE_BONUS, CLASSIFY_AGREE_CAP);
  if (conflict) confidence *= CLASSIFY_CONFLICT_FACTOR;
  const result: RuleClassification = {
    category: winner.category,
    confidence: round(confidence),
    classifiedBy: winner.classifiedBy,
    rule: winner.rule,
    reason: conflict ? 'classification-conflict' : 'ok',
  };
  if (winner.matchedOn !== undefined) result.matchedOn = winner.matchedOn;
  if (winner.consentKinds !== undefined) result.consentKinds = winner.consentKinds;
  return result;
}

function labelVote(hit: LabelRuleHit, matchedOn: LabelMatchedOn): RuleVote {
  const vote: RuleVote = { classifiedBy: 'label-rule', category: hit.category, confidence: hit.confidence,
    rule: hit.rule, strongLabel: hit.strength === 'strong', matchedOn };
  if (hit.consentKinds !== undefined) vote.consentKinds = hit.consentKinds;
  return vote;
}

/**
 * The label rules over the normalized label; when nothing matches it and the field has a description, over the
 * normalized label and description together (§8.3's "plus the description for long questions").
 */
function labelRuleVote(spec: FieldSpec, label: string): RuleVote | null {
  const section = sectionKindOf(spec.section.id);
  const onLabel = matchLabelRules(label, section, spec.kind);
  if (onLabel !== null) return labelVote(onLabel, 'label');
  const description = normalizeLabel(spec.description);
  if (description === '') return null;
  const both = label === '' ? description : `${label} ${description}`;
  const onBoth = matchLabelRules(both, section, spec.kind);
  return onBoth === null ? null : labelVote(onBoth, 'description');
}

/**
 * What the deterministic rules say `spec` is: the autocomplete, name/id and label votes combined (§8.1), each checked
 * against the field's kind (CATEGORY_KINDS), so a mismatch is no vote. A textarea with no label that none of them
 * classifies is `freeText.other` (weak). Null when nothing matched: the resolver then tries saved answers and LLM
 * classification. A rule that decides `unknown` ("Resume" on a text field, "Current salary") is a classification, not
 * a miss, so it is returned as such.
 */
export function classifyByRules(spec: FieldSpec): RuleClassification | null {
  const label = normalizeLabel(spec.label);
  const autocomplete = autocompleteRule(spec.autocomplete, spec.kind);
  const nameId = nameIdRule(spec.nameAttr, spec.idAttr, spec.kind);
  const combined = combine([
    autocomplete && { classifiedBy: 'autocomplete', ...autocomplete, strongLabel: false },
    nameId && { classifiedBy: 'name-id', category: nameId.category, confidence: nameId.confidence, rule: nameId.rule,
      strongLabel: false },
    labelRuleVote(spec, label),
  ]);
  if (combined !== null) return combined;
  const unlabelled = unlabelledTextarea(label, spec.kind);
  return unlabelled === null ? null : combine([labelVote(unlabelled, 'label')]);
}
