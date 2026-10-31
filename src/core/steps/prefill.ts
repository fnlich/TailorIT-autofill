/*
 * Resume-parse prefill (Requirement C: "if the site pre-populated fields from the uploaded resume, reconcile instead of
 * overwriting blindly. Do not create duplicate entries. Prefer the profile for structured fields, and flag
 * conflicts"; docs/design/core.md §10.2; docs/design/runtime.md §8.7). reconcilePrefill decides, for one field, what
 * the profile's planned answer does to what the page already holds; it writes nothing, and its decision holds no
 * value. Entries are matched to prefilled blocks by repeatable.ts, so a block that holds an entry is filled, never
 * added again.
 *
 * | What the field holds                         | Decision                                          |
 * |----------------------------------------------|---------------------------------------------------|
 * | nothing                                      | fill                                              |
 * | the profile's answer already                 | keep, already-correct                             |
 * | something else, in a structured field        | overwrite, flagged prefill-conflict (profile wins) |
 * | something else, in prose (a textarea, a      | keep, flagged prefill-kept                        |
 * |   free-text question, a job's description)   |                                                   |
 * | an upload                                    | keep, flagged prefill-kept                        |
 * | a ticked box the profile would not tick      | keep, flagged unexpected-selection (never untick) |
 * | some of a set's answers                      | add the missing ones only (nothing chosen twice)  |
 * | a set's answer the profile does not give     | add the missing ones, flagged unexpected-selection |
 *
 * "The same" is judged as the field would show it: a phone by its digits, a date by its year, month and day, the rest
 * with case and runs of white space ignored.
 */
import type { FieldKind } from '../enums';
import { policyClassOf } from '../resolver/categories';
import type { CurrentValue } from '../types/field';
import type { ReasonCode } from '../types/fill';
import type { FieldCategory } from '../types/intent';

/** What the plan means to put in the field (in memory only, never stored). */
export type PrefillIntent =
  | { kind: 'text'; text: string }
  | { kind: 'date'; iso: string }
  | { kind: 'check'; checked: boolean }
  | { kind: 'choice'; label: string }
  | { kind: 'choices'; labels: readonly string[] }
  | { kind: 'file' };

/** 'fill': the field is empty; 'keep': leave what it holds; 'overwrite': the profile's answer replaces it; 'add': only
 *  the set's missing answers are chosen. */
export const PREFILL_ACTIONS = ['fill', 'keep', 'overwrite', 'add'] as const;
export type PrefillAction = (typeof PREFILL_ACTIONS)[number];

export interface PrefillDecision {
  action: PrefillAction;
  reason: ReasonCode;
  /** The person should look: a conflict, a kept prefill, a choice we would not have made. */
  flagged: boolean;
}

/** The field, as reconciliation reads it. */
export interface PrefillField {
  category: FieldCategory;
  kind: FieldKind;
}

const decide = (action: PrefillAction, reason: ReasonCode, flagged = false): PrefillDecision =>
  ({ action, reason, flagged });

/** Whether a field holds a structured answer, where the profile wins: anything but prose (a textarea, a free-text
 *  question, a job's description). */
export function isStructured(field: PrefillField): boolean {
  return field.kind !== 'textarea' && field.category !== 'experience.description'
    && policyClassOf(field.category) !== 'free-text';
}

/** What the field holds as text ('' for nothing): a box's text, or a list's chosen labels. */
function heldText(current: CurrentValue): string {
  if (current.kind === 'text') return current.text;
  if (current.kind === 'selected') return current.labels.join(' ');
  return '';
}

const tidy = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** A date's numbers, year first: "2020-01-15", "01/15/2020" and "2020-1-15" all give [2020, 1, 15]; "01/2020" gives
 *  [2020, 1]. Null when the text is not a date in one of those forms. */
function dateNumbers(text: string): number[] | null {
  const parts = text.trim().split(/[-/.\s]+/).filter((part) => part !== '');
  if (parts.length === 0 || parts.length > 3 || !parts.every((part) => /^\d{1,4}$/.test(part))) return null;
  const numbers = parts.map(Number);
  const yearAt = numbers.findIndex((number, at) => parts[at]!.length === 4 && number >= 1900);
  if (yearAt < 0) return null;
  const year = numbers[yearAt]!;
  const rest = numbers.filter((_, at) => at !== yearAt);
  // Month before day in a US-style date (01/15/2020); a year-first date is year, month, day.
  return [year, ...rest];
}

/** Two texts the field would show alike. */
function same(category: FieldCategory, intended: PrefillIntent, held: string): boolean {
  if (intended.kind === 'date') {
    const want = dateNumbers(intended.iso);
    const have = dateNumbers(held);
    return want !== null && have !== null && want.join('-') === have.join('-');
  }
  const text = intended.kind === 'text' ? intended.text : intended.kind === 'choice' ? intended.label : '';
  if (category === 'contact.phone') return text.replace(/\D/g, '') !== '' && text.replace(/\D/g, '') === held.replace(/\D/g, '');
  return tidy(text) === tidy(held);
}

/** The decision for one field (module header's table). */
export function reconcilePrefill(field: PrefillField, current: CurrentValue, intended: PrefillIntent): PrefillDecision {
  switch (intended.kind) {
    case 'file':
      return current.kind === 'files' && current.count > 0 ? decide('keep', 'prefill-kept', true) : decide('fill', 'ok');
    case 'check': {
      const ticked = current.kind === 'checked' && current.checked;
      if (intended.checked) return ticked ? decide('keep', 'already-correct') : decide('fill', 'ok');
      return ticked ? decide('keep', 'unexpected-selection', true) : decide('keep', 'already-correct');
    }
    case 'choices': {
      const held = current.kind === 'selected' ? new Set(current.labels.map(tidy)) : new Set<string>();
      const wanted = new Set(intended.labels.map(tidy));
      const missing = [...wanted].some((label) => !held.has(label));
      const foreign = [...held].some((label) => !wanted.has(label));
      if (held.size === 0) return decide('fill', 'ok');
      if (!foreign) return missing ? decide('add', 'ok') : decide('keep', 'already-correct');
      return decide(missing ? 'add' : 'keep', 'unexpected-selection', true);
    }
    case 'text':
    case 'date':
    case 'choice': {
      const held = heldText(current);
      if (held.trim() === '') return decide('fill', 'ok');
      if (same(field.category, intended, held)) return decide('keep', 'already-correct');
      // A choice is always structured; prose the site filled in is the site's (or the person's) to keep.
      return intended.kind === 'choice' || isStructured(field) ? decide('overwrite', 'prefill-conflict', true)
        : decide('keep', 'prefill-kept', true);
    }
  }
}
