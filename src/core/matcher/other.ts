/*
 * Stage e, "Other" plus free text (docs/design/core.md §4.7), only where the domain allows it and only when the form
 * offers exactly one usable "Other" option ("Other (please specify)", "My school is not listed"). The canonical
 * display goes into the box that option reveals: the step bookkeeping waits for that box and fills it with rule
 * other.free-text, else flags the field other-without-free-text. Always below the fill line, so always flagged.
 */
import { INJECTED_LABEL_CAP, MATCH_OTHER } from '../confidence';
import type { Match, MatchFlag } from '../types/match';
import { chooseable } from './prepare';
import type { PreparedOptions } from './types';

/** Stage e's match, or null when the form offers no single "Other" option or there is no text to type. */
export function otherMatch(options: PreparedOptions, freeText: string): Match | null {
  const text = freeText.trim();
  if (text === '') return null;
  const others = options.list.filter((option) => chooseable(option) && option.other);
  if (others.length !== 1) return null;
  const option = others[0]!;
  const flags: MatchFlag[] = option.injected ? ['injected-label'] : [];
  return {
    stage: 'other', optionIndex: option.index, rule: 'other-free-text',
    confidence: option.injected ? Math.min(MATCH_OTHER, INJECTED_LABEL_CAP) : MATCH_OTHER,
    freeText: text, flags, suggestions: [], reason: 'other-option-with-free-text',
  };
}
