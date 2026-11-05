/*
 * Conditional follow-ups (the Phase 7a review): a question whose label opens with "If you answered…", "If you
 * selected…", "If yes", "If no" or "If so" asks for something only when the question before it was answered that way
 * ("If yes, please mention your CloudFactory email"; 27 such questions in 14 of the capture's 120 Workable forms). The
 * planner never drafts or guesses an optional one: what it asks may not apply, and an answer there would say something
 * the person did not. A required one is drafted or guessed only once the answer above, as written now (what the page
 * shows, or what this plan writes into it), is the one it follows; until then it is left for the person
 * (conditional-question). The question before is the nearest earlier field of the same section that is no follow-up
 * itself. Labels are page text: nothing here reads a profile value.
 */
import { sectionKey } from '../text/keys';
import type { FieldSpec } from '../types/field';
import type { WriteValue } from '../types/intent';

/** What a follow-up waits for: the answer above being yes, no, an option's words, or something it does not say. */
export type Condition = { kind: 'yes' } | { kind: 'no' } | { kind: 'words'; words: string } | { kind: 'unknown' };

/** A label that opens as a follow-up does. */
const LEAD = /^\s*if\s+(?:you\s+(?:answered|selected|chose|picked|checked|said|replied|responded)|yes|no|so)\b/i;
/** "If yes", "If so", "If no". */
const BARE = /^\s*if\s+(yes|so|no)\b/i;
/** "If you answered (\"yes\"|no) ...". */
const SAID = /^\s*if\s+you\s+\w+\s+["“'‘]?\s*(yes|no)\b/i;
/** "If you answered \"I am represented by an external agency\" ...". */
const QUOTED = /^\s*if\s+you\s+\w+\s+["“'‘]([^"”'’]{1,120})["”'’]/i;
/** "If you selected Other, please specify". */
const UNQUOTED = /^\s*if\s+you\s+(?:answered|selected|chose|picked)\s+(.{1,60}?)\s*(?:[,.:;(]|\b(?:to|above|in|for|on|please)\b|$)/i;

/** The words of a label or an answer, compared: lower case, letters and digits, single spaces. */
function wordsOf(text: string): string {
  return text.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** What a question waits for, or null when it is no follow-up. */
export function conditionOf(label: string): Condition | null {
  if (!LEAD.test(label)) return null;
  const bare = BARE.exec(label)?.[1]?.toLowerCase();
  if (bare !== undefined) return bare === 'no' ? { kind: 'no' } : { kind: 'yes' };
  const said = SAID.exec(label)?.[1]?.toLowerCase();
  if (said !== undefined) return said === 'no' ? { kind: 'no' } : { kind: 'yes' };
  const words = wordsOf(QUOTED.exec(label)?.[1] ?? UNQUOTED.exec(label)?.[1] ?? '');
  return words === '' ? { kind: 'unknown' } : { kind: 'words', words };
}

/** The question a follow-up follows: the nearest earlier field of its section that is no follow-up itself. */
export function antecedentOf(spec: FieldSpec, specs: readonly FieldSpec[]): FieldSpec | null {
  const section = sectionKey(spec.section);
  let found: FieldSpec | null = null;
  for (const other of specs) {
    if (other.domOrder >= spec.domOrder || sectionKey(other.section) !== section) continue;
    if (conditionOf(other.label) !== null || other.kind === 'file') continue;
    if (found === null || other.domOrder > found.domOrder) found = other;
  }
  return found;
}

/** The answer a field holds, as words: what this plan writes into it, else what the page shows; null for none. */
export function answerWords(spec: FieldSpec, written: WriteValue | undefined): string[] | null {
  if (written !== undefined) {
    switch (written.kind) {
      case 'text':
        return [written.text];
      case 'option':
        return [written.cleanLabel];
      case 'options':
        return written.cleanLabels;
      case 'check':
        return ['yes'];
      default:
        return null;
    }
  }
  const current = spec.current;
  if (current.kind === 'text') return current.text.trim() === '' ? null : [current.text];
  if (current.kind === 'selected') return current.labels.length === 0 ? null : current.labels;
  if (current.kind === 'checked') return [current.checked ? 'yes' : 'no'];
  return null;
}

/** Whether an answer is the one a follow-up waits for. */
export function conditionHolds(condition: Condition, answer: readonly string[] | null): boolean {
  if (answer === null || answer.length === 0) return false;
  const said = answer.map(wordsOf).filter((words) => words !== '');
  switch (condition.kind) {
    case 'yes':
      return said.some((words) => /^(?:yes|y|true)\b/.test(words));
    case 'no':
      return said.some((words) => /^(?:no|n|false)\b/.test(words));
    case 'words':
      return said.some((words) => words === condition.words || words.includes(condition.words)
        || (words.length >= 3 && condition.words.includes(words)));
    default:
      return false;
  }
}
