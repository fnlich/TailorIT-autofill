/*
 * Stage e, "Other" plus free text (docs/design/core.md §4.7), only where the domain allows it and only when the form
 * offers exactly one usable "Other" option ("Other (please specify)", "My school is not listed"). The canonical
 * display goes into the box that option reveals: the step bookkeeping waits for that box and fills it with rule
 * other.free-text, else flags the field other-without-free-text. Always below the fill line, so always flagged.
 *
 * Snapshot round 2 (the owner, 2026-11-07: "there is no matched after with 3 different style value, last will be other
 * or don't write (user can set on setting it)"): after a search's three styles found nothing, the frame types "Other"
 * (searchLimits.ts NO_MATCH_OTHER_QUERY) and the list's own "Other" among what it lists is chosen (noMatchOtherMatch),
 * by a stricter reading than stage e's: the whole label, folded, is one of NO_MATCH_OTHER_LABELS. "None of the above",
 * "Others", "Something else" or an "Other" with anything else in its label is never it, nor is a label that had
 * injected text, a disabled one, or one of two such options.
 */
import { INJECTED_LABEL_CAP, MATCH_NO_MATCH_OTHER, MATCH_OTHER } from '../confidence';
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

// s2 core-wd: the list's own "Other", once three styles found nothing.

/** The labels a list's own "Other" has, folded (foldOtherLabel): "Other", "Other School", "Other - Not Listed", "Not
 *  Listed", "Other (please specify)". Nothing else: never "None of the above", nor Workday's empty-list row "No Items."
 *  What the owner's snapshots show (F:\Develop\Refer\snapshot4, verily, 2026-11-07, read for labels only): the one
 *  "Other" seen is "Other", the last option of the Degree list ("…Tech Lead (1).mht": Select One, Basic Education, …,
 *  Doctoral Degree, Other); the School search's results ("(2).mht", 13 of 17 rows) and the Field of Study list ("(3).mht",
 *  25 of 321 rows drawn) hold no "Other" or "Not listed" row; the School prompt opened with nothing typed lists one row,
 *  "No Items." (role=option, data-automation-id=menuItem, aria-setsize=1, no radio and no chevron: the ".mht" without a
 *  number). The other four labels are the coordinator's list (the design's decision 5), seen in no Workday snapshot. */
export const NO_MATCH_OTHER_LABELS: ReadonlySet<string> = new Set(['other', 'other school', 'other not listed',
  'not listed', 'other please specify']);

/** A label as NO_MATCH_OTHER_LABELS holds it: lower case, every run of characters that are neither letters nor digits
 *  one space, trimmed ("Other (please specify)": "other please specify"). */
export function foldOtherLabel(label: string): string {
  return label.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Whether a label is a list's own "Other" (NO_MATCH_OTHER_LABELS), as a whole. */
export function isNoMatchOther(label: string): boolean {
  return NO_MATCH_OTHER_LABELS.has(foldOtherLabel(label));
}

/** The list's own "Other" among a search's results (see the header) as a match carrying `freeText` for the box it may
 *  reveal (stage e's rule and reason, at MATCH_NO_MATCH_OTHER), or null: no such option, several, a disabled one, or
 *  one whose label had injected text. */
export function noMatchOtherMatch(options: PreparedOptions, freeText: string): Match | null {
  const others = options.list.filter((option) => chooseable(option) && isNoMatchOther(option.label));
  if (others.length !== 1 || others[0]!.injected) return null;
  const text = freeText.trim();
  return {
    stage: 'other', optionIndex: others[0]!.index, rule: 'other-free-text', confidence: MATCH_NO_MATCH_OTHER,
    ...(text === '' ? {} : { freeText: text }), flags: [], suggestions: [],
    reason: text === '' ? 'other-without-free-text' : 'other-option-with-free-text',
  };
}

// end s2 core-wd
