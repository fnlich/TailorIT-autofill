/*
 * The resolver's verdict on a field (what it asks for, what to put there, how sure we are) and the matcher's choice of
 * option. Both are value-free apart from `intended`, `origin` and `freeText`, which stay in the worker's memory.
 */
import type { MatcherStage } from '../enums';
import type { FieldKey } from './field';
import type { ReasonCode } from './fill';
import type { FieldCategory, IntendedValue, PolicyClass, ValueOrigin } from './intent';

/** What decided the field's category. */
export const CLASSIFIERS = ['autocomplete', 'name-id', 'label-rule', 'saved', 'llm-classify', 'none'] as const;
export type Classifier = (typeof CLASSIFIERS)[number];

/** The resolver's action, from the confidence bands: fill at 0.85 or more, fill and flag from 0.6, else leave blank. */
export const ACTIONS = ['fill', 'fill-and-flag', 'leave-blank', 'needs-user', 'skip'] as const;
export type Action = (typeof ACTIONS)[number];

/** The resolver's verdict on one field. */
export interface Resolution {
  key: FieldKey;
  category: FieldCategory;
  classifiedBy: Classifier;
  /** The rule that decided ('label.first-name', 'eeo.decline'): the review panel shows it. */
  rule: string | null;
  intended: IntendedValue | null;
  /** Non-null exactly when `intended` is non-null. */
  origin: ValueOrigin | null;
  /** classification × value; the match multiplies in later. */
  confidence: number;
  policy: PolicyClass;
  action: Action;
  reason: ReasonCode;
  /** The field waits for an LLM answer that plan/poll will bring. */
  awaiting: 'classification' | 'pick' | 'draft' | null;
}

/** Which rule inside a stage chose the option. */
export const MATCH_RULES = ['raw', 'primary', 'qualifier-ignored', 'compact', 'curated-alias', 'vocab-alias',
  'generated-alias', 'flagship', 'entity-id', 'degree-type', 'degree-level', 'degree-level-fallback',
  'degree-qualifier-types', 'cip-title', 'cip-parent', 'mention', 'polarity', 'numeric-range', 'token-set',
  'llm-index', 'other-free-text', 'cache-hit', 'place'] as const;
export type MatchRule = (typeof MATCH_RULES)[number];

export const MATCH_FLAGS = ['injected-label', 'qualifier-ignored', 'ambiguous-abbreviation', 'level-fallback',
  'same-entity-duplicates', 'small-margin'] as const;
export type MatchFlag = (typeof MATCH_FLAGS)[number];

/** The matcher's choice for one field. */
export interface Match {
  stage: MatcherStage;
  /** Index into the field's visible options; null for none, text fields and sets. */
  optionIndex: number | null;
  rule: MatchRule | null;
  confidence: number;
  /** Fuzzy score and the gap to the next distinct entity (fuzzy only). */
  score?: number;
  margin?: number;
  /** Text for the "please specify" box after choosing Other. In memory only. */
  freeText?: string;
  flags: MatchFlag[];
  /** Up to three nearest options for the review panel when nothing was chosen; their labels are never stored. */
  suggestions: Array<{ index: number; score: number }>;
  reason: ReasonCode;
}
