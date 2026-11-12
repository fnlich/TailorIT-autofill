/*
 * The polarity rule (docs/design/core.md §4.3) for yes/no answers, legal ones included: an option whose first word is
 * yes or no ("Yes, I am authorized to work"), or, when a question offers exactly one positive and one negated option
 * ("I will require sponsorship" / "I will not require sponsorship"), the one that agrees with the value. Decline,
 * "Other" and exclusive options take no part. Several options starting with the same word are different answers
 * ("Yes, with sponsorship" / "Yes, without"), so they tie and nothing is chosen.
 *
 * The negated option is the "no" answer only when it denies the other option's own statement. So the two options must
 * say the same thing once negating words and auxiliaries are set aside ("I will require sponsorship" / "I do not
 * require sponsorship"), and only words that deny a statement count as negating. "No", "none", "neither", "nor" and
 * "without" deny a thing inside one ("no restrictions", "without sponsorship", "None, I am a U.S. citizen"): on an
 * authorization question, reading "I am authorized to work without sponsorship" as the negated option gives the
 * opposite answer (a leading "No" is the first-word rule's).
 *
 * And the statement must be the question's, not its opposite: a pair about restrictions or limits ("I have work
 * authorization restrictions" / "I do not have ...") says yes to "Are you authorized to work?" by its negated option,
 * so it gets no hit, nor does a pair about the other legal topic ("I am authorized to work" on "Will you require
 * sponsorship?").
 */
import { MATCH_POLARITY_LEADING, MATCH_POLARITY_NEGATION } from '../confidence';
import type { Vocab } from '../vocab/types';
import { substantive } from './prepare';
import { stageHit, type StageHit } from './rank';
import type { PreparedOption, PreparedOptions } from './types';

const YES = new Set(['yes', 'y']);
const NO = new Set(['no', 'n']);
/** Negators of the vocabulary that deny a thing within a statement, not the statement. */
const THING_NEGATORS: ReadonlySet<string> = new Set(['no', 'none', 'neither', 'nor', 'without']);
/** Words that state the opposite of what a yes/no question usually asks ("restrictions" on an authorization
 *  question): which option is the yes then depends on the question, so the pair gets no hit. */
const INVERTING = /^(?:restrict\w*|limit\w*|barriers?|prohibit\w*|prevent\w*|ineligible|unable|bar(?:red)?)$/;
/** The legal topics a yes/no question asks about, so a pair about another one answers a different question. */
const TOPICS: ReadonlyArray<readonly [string, RegExp]> = [
  ['authorization', /^(?:authori[sz]\w*|eligib\w*|permitted|entitled)$/],
  ['sponsorship', /^(?:sponsor\w*|visas?)$/],
];

/** The legal topics a text's words name. */
function topicsOf(tokens: Iterable<string>): Set<string> {
  const topics = new Set<string>();
  for (const token of tokens) {
    for (const [topic, words] of TOPICS) if (words.test(token)) topics.add(topic);
  }
  return topics;
}

/** Whether the pair's statement is the question's own: no restriction or limit in it, and when the question names
 *  a legal topic and the pair names one, a topic in common. */
function answersQuestion(pair: readonly PreparedOption[], labelKey: string, vocab: Vocab): boolean {
  const said = new Set(pair.flatMap((option) => [...statement(option, vocab)]));
  if ([...said].some((token) => INVERTING.test(token))) return false;
  const asked = topicsOf(labelKey.split(' '));
  const stated = topicsOf(said);
  return asked.size === 0 || stated.size === 0 || [...stated].some((topic) => asked.has(topic));
}
/** jr7 RULES-7 (UP7-08): an option that plainly agrees, as its own whole answer ("I Confirm", "I agree", "Accept",
 *  "I acknowledge", "I certify", "Agreed"). */
const AGREES = /^(?:i\s+)?(?:(?:hereby|fully|do)\s+)?(?:confirm|confirmed|agree|agreed|acknowledge|acknowledged|accept|accepted|certify|attest|consent|understand|understood)$/;

/** Auxiliaries, set aside when two options are compared ("I will require" / "I do not require"). */
const AUXILIARIES: ReadonlySet<string> = new Set(['will', 'do', 'does', 'am', 'is', 'are', 'have', 'has', 'can']);

/** True or false when the option's first word is yes or no, else null. */
export function leadingPolarity(option: PreparedOption): boolean | null {
  const first = option.norm.tokens[0];
  if (first === undefined) return null;
  return YES.has(first) ? true : NO.has(first) ? false : null;
}

/** A word that denies the statement it is in ("not", "don't", "never"). */
function denies(token: string, vocab: Vocab): boolean {
  return vocab.answers.polarity.negators.has(token) && !THING_NEGATORS.has(token);
}

/** The option holds a word that denies its statement ("not", "don't", "never"). */
export function negated(option: PreparedOption, vocab: Vocab): boolean {
  return option.norm.tokens.some((token) => denies(token, vocab));
}

/** What an option says, without its denying words and auxiliaries. */
function statement(option: PreparedOption, vocab: Vocab): Set<string> {
  return new Set(option.norm.tokens.filter((token) => !denies(token, vocab) && !AUXILIARIES.has(token)));
}

/** Whether two options say the same thing, one perhaps denying it: their statements are equal, or one holds the
 *  other ("Authorized" / "Not authorized to work in the US"). */
export function sameStatement(a: PreparedOption, b: PreparedOption, vocab: Vocab): boolean {
  const [x, y] = [statement(a, vocab), statement(b, vocab)];
  if (x.size === 0 || y.size === 0) return false;
  const within = (inner: Set<string>, outer: Set<string>) => [...inner].every((token) => outer.has(token));
  return within(x, y) || within(y, x);
}

/** The polarity rule's hits for `value` on a question whose normalized label is `labelKey`. */
export function polarityHits(value: boolean, options: PreparedOptions, vocab: Vocab, labelKey = ''): StageHit[] {
  const candidates = options.list.filter(substantive);
  const leading = candidates.filter((option) => leadingPolarity(option) === value);
  if (leading.length > 0) {
    return leading.map((option) =>
      stageHit(option, 'alias', 'polarity', MATCH_POLARITY_LEADING, `key:${option.fullKey}`));
  }
  // jr7 RULES-7 (UP7-08, UltiPro's certification "I Confirm" / "No", snapshot7 ultipro1): of two options, one a leading
  // "No", the other that plainly agrees ("I Confirm", "I agree", "Acknowledge") and denies nothing is the yes.
  if (value && candidates.length === 2) {
    const no = candidates.find((option) => leadingPolarity(option) === false);
    const other = candidates.find((option) => option !== no);
    if (no !== undefined && other !== undefined && leadingPolarity(other) === null && !negated(other, vocab)
      && AGREES.test(other.norm.tokens.join(' '))) {
      return [stageHit(other, 'alias', 'polarity', MATCH_POLARITY_NEGATION, 'bool:true')];
    }
  }
  if (candidates.length !== 2 || candidates.some((option) => leadingPolarity(option) !== null)) return [];
  const negatives = candidates.filter((option) => negated(option, vocab));
  if (negatives.length !== 1 || !sameStatement(candidates[0]!, candidates[1]!, vocab)) return [];
  if (!answersQuestion(candidates, labelKey, vocab)) return [];
  const chosen = value ? candidates.find((option) => !negated(option, vocab))! : negatives[0]!;
  return [stageHit(chosen, 'alias', 'polarity', MATCH_POLARITY_NEGATION, `bool:${value}`)];
}
