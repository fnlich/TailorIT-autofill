/*
 * Loading rows: option texts that say a list is still loading ("Loading...", "Please wait", "Fetching cities..."). Such
 * a row is no answer, so it is not usable: it is neither matched (the matcher's prepareOptions marks it as a
 * placeholder, so a list showing nothing else waits for its options, never a no-match) nor part of a field's
 * option-set hash (the scanner's dom/option-hash.ts), and a list's key changes once, when its real options arrive.
 * To the DOM layer it is also a sign that the list is busy (dom/settle.ts, dom/await-options.ts). These three read
 * this one list. A row is one of two kinds:
 * - a whole phrase ("Please wait"), compared by its key in the answer context, as the placeholders are, so case,
 *   punctuation and an ellipsis make no difference;
 * - a lead and more words ("Loading states..."), only when the label ends with an ellipsis ("..." or U+2026), which
 *   normalization drops, so it is read from the clean label itself. Without one it is a real answer: "Searching for
 *   a new role", "Loading dock supervisor" (the coordinator's ruling, 2026-10-30).
 */
import { normalize } from './normalize';

/** Option texts that mean a list is still loading when they are the whole text ("Please wait..."). */
export const LOADING_OPTION_PHRASES = ['Loading', 'Fetching', 'Retrieving', 'Searching', 'Updating', 'Please wait',
  'One moment', 'One moment please', 'Just a moment'] as const;
/** Words that mean a list is still loading when an option's text starts with them and ends with an ellipsis
 *  ("Loading states...", "Fetching cities\u{2026}"). */
export const LOADING_OPTION_LEADS = ['Loading', 'Fetching', 'Retrieving', 'Searching'] as const;

const LOADING_KEYS: ReadonlySet<string> = new Set(LOADING_OPTION_PHRASES.map((phrase) =>
  normalize(phrase, 'answer').key));
/** Each lead's key and a space: a lead counts only as a whole first word ("Searchlight..." is no loading row). */
const LOADING_LEAD_KEYS: readonly string[] = LOADING_OPTION_LEADS.map((lead) => `${normalize(lead, 'answer').key} `);
/** A label's closing ellipsis: three dots or U+2026, spaces after it allowed. */
const TRAILING_ELLIPSIS = /(?:\.\.\.|\u{2026})\s*$/u;

/** True when an option's clean label (injected text already cut) is a loading row: a whole phrase, or a lead and more
 *  words ending with an ellipsis. */
export function isLoadingText(cleanLabel: string): boolean {
  return isLoadingRow(cleanLabel, normalize(cleanLabel, 'answer').key);
}

/** isLoadingText for a caller that has the label's key in the answer context already (`answerKey`): the phrases are
 *  read from the key, a lead's closing ellipsis from the label. */
export function isLoadingRow(cleanLabel: string, answerKey: string): boolean {
  if (LOADING_KEYS.has(answerKey)) return true;
  return TRAILING_ELLIPSIS.test(cleanLabel) && LOADING_LEAD_KEYS.some((lead) => answerKey.startsWith(lead));
}
