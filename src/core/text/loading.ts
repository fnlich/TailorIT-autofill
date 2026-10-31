/*
 * Loading rows: option texts that say a list is still loading ("Loading...", "Please wait", "Fetching cities..."). Such
 * a row is no answer, so it is not usable: it is neither matched (the matcher's prepareOptions marks it as a
 * placeholder, so a list showing nothing else waits for its options, never a no-match) nor part of a field's
 * option-set hash (the scanner's dom/option-hash.ts), and a list's key changes once, when its real options arrive.
 * To the DOM layer it is also a sign that the list is busy (dom/settle.ts, dom/await-options.ts). These three read
 * this one list. A row is one of two kinds:
 * - a whole phrase ("Please wait"), compared by its key in the answer context, as the placeholders are, so case,
 *   punctuation and an ellipsis make no difference. The words in its brackets count ("(Loading...)" is one,
 *   "Searching (Actively)" is an answer: the Phase 3 review, LC-12);
 * - a lead and more words ("Loading states...", "Loading... please wait"), only when an ellipsis ("..." or U+2026)
 *   follows the lead, which normalization drops, so it is read from the clean label itself (the Phase 3 review, LC-7).
 *   Without one it is a real answer: "Searching for a new role", "Loading dock supervisor" (the coordinator's ruling,
 *   2026-10-30).
 */
import { fold } from './fold';
import { keyWithBrackets, normalize } from './normalize';

/** Option texts that mean a list is still loading when they are the whole text ("Please wait..."). */
export const LOADING_OPTION_PHRASES = ['Loading', 'Fetching', 'Retrieving', 'Searching', 'Updating', 'Please wait',
  'One moment', 'One moment please', 'Just a moment'] as const;
/** Words that mean a list is still loading when an option's text starts with them and an ellipsis follows them
 *  ("Loading states...", "Fetching cities\u{2026}", "Loading... please wait"). */
export const LOADING_OPTION_LEADS = ['Loading', 'Fetching', 'Retrieving', 'Searching'] as const;

const LOADING_KEYS: ReadonlySet<string> = new Set(LOADING_OPTION_PHRASES.map((phrase) =>
  normalize(phrase, 'answer').key));
/** Each lead's key: a lead counts only as a whole first word ("Searchlight..." is no loading row). */
const LOADING_LEAD_KEYS: readonly string[] = LOADING_OPTION_LEADS.map((lead) => normalize(lead, 'answer').key);
/** An ellipsis: three dots or U+2026. */
const ELLIPSIS = /\.\.\.|\u{2026}/u;

/** True when an option's clean label (injected text already cut) is a loading row: a whole phrase, or a lead and more
 *  words with an ellipsis after the lead. */
export function isLoadingText(cleanLabel: string): boolean {
  return isLoadingRow(cleanLabel, normalize(cleanLabel, 'answer').key);
}

/** Whether `key` starts with a lead as a whole word, with more words after it (`more`) or alone. */
function startsWithLead(key: string, more: boolean): boolean {
  return LOADING_LEAD_KEYS.some((lead) => key.startsWith(`${lead} `) || (!more && key === lead));
}

/** Whether an ellipsis follows the label's lead word: the text before its first ellipsis starts with a lead. */
function ellipsisAfterLead(cleanLabel: string): boolean {
  const at = cleanLabel.search(ELLIPSIS);
  return at > 0 && startsWithLead(normalize(cleanLabel.slice(0, at), 'answer').key, false);
}

/** isLoadingText for a caller that has the label's key in the answer context already (`answerKey`): the phrases and
 *  leads are read from the key (from the key with its brackets' words kept, when the label has brackets), the
 *  ellipsis from the label. */
export function isLoadingRow(cleanLabel: string, answerKey: string): boolean {
  const folded = fold(cleanLabel);
  const key = folded.includes('(') || folded.includes('[') ? keyWithBrackets(cleanLabel, 'answer') : answerKey;
  if (LOADING_KEYS.has(key)) return true;
  return startsWithLead(key, true) && ellipsisAfterLead(cleanLabel);
}
