/*
 * The polarity rule (docs/design/core.md §4.3) for yes/no answers, legal ones included: an option whose first word is
 * yes or no ("Yes, I am authorized to work"), or, when a question offers exactly one positive and one negated option
 * ("I will require sponsorship" / "I will not require sponsorship"), the one that agrees with the value. Decline,
 * "Other" and exclusive options take no part. Several options starting with the same word are different answers
 * ("Yes, with sponsorship" / "Yes, without"), so they tie and nothing is chosen.
 */
import { MATCH_POLARITY_LEADING, MATCH_POLARITY_NEGATION } from '../confidence';
import type { Vocab } from '../vocab/types';
import { substantive } from './prepare';
import { stageHit, type StageHit } from './rank';
import type { PreparedOption, PreparedOptions } from './types';

const YES = new Set(['yes', 'y']);
const NO = new Set(['no', 'n']);

/** True or false when the option's first word is yes or no, else null. */
export function leadingPolarity(option: PreparedOption): boolean | null {
  const first = option.norm.tokens[0];
  if (first === undefined) return null;
  return YES.has(first) ? true : NO.has(first) ? false : null;
}

/** The option holds a negating word ("not", "don't", "never"). */
export function negated(option: PreparedOption, vocab: Vocab): boolean {
  return option.norm.tokens.some((token) => vocab.answers.polarity.negators.has(token));
}

/** The polarity rule's hits for `value`. */
export function polarityHits(value: boolean, options: PreparedOptions, vocab: Vocab): StageHit[] {
  const candidates = options.list.filter(substantive);
  const leading = candidates.filter((option) => leadingPolarity(option) === value);
  if (leading.length > 0) {
    return leading.map((option) =>
      stageHit(option, 'alias', 'polarity', MATCH_POLARITY_LEADING, `key:${option.fullKey}`));
  }
  if (candidates.length !== 2 || candidates.some((option) => leadingPolarity(option) !== null)) return [];
  const negatives = candidates.filter((option) => negated(option, vocab));
  if (negatives.length !== 1) return [];
  const chosen = value ? candidates.find((option) => !negated(option, vocab))! : negatives[0]!;
  return [stageHit(chosen, 'alias', 'polarity', MATCH_POLARITY_NEGATION, `bool:${value}`)];
}
