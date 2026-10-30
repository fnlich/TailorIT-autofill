/*
 * Saved answers (docs/design/core.md §8.1 step 4, §8.9; Requirement F: "saved answers win over rules next time"). An
 * answer the person saved after fixing a flagged field is found by its exact key: the field's normalized label, its
 * observed option-set hash, and its scope. Only the classes whose policy allows saved answers take one (§8.2): the
 * profile and unknown classes take global answers, free text only the answer saved for this company (same platform
 * and board), and EEO, legal, sensitive, consent, attention and file fields none at all, since those live only in the
 * profile and the settings. A saved value then beats the profile's or a rule's (resolve.ts). The list is empty until
 * Phase 6 fetches it; the lookup and its policy are fixed now.
 */
import type { FieldKind, Platform } from '../enums';
import { normalizeLabel } from '../text/normalize';
import type { FieldSpec } from '../types/field';
import type { PolicyClass } from '../types/intent';
import type { SavedAnswer } from '../types/saved';
import { CLASS_POLICIES } from './categories';

/** The company a form belongs to, for answers saved for one company only. */
export interface CompanyScope {
  platform: Platform;
  board: string;
}

/** The kinds that show options to choose one of, and those that take several. */
const ONE_OF: readonly FieldKind[] = ['select', 'radio', 'combobox'];
const SEVERAL: readonly FieldKind[] = ['checkbox-group', 'multiselect'];
const TYPED: readonly FieldKind[] = ['text', 'textarea'];

/** Whether a saved answer's shape can be given through a field of this kind. */
export function answerFitsKind(answer: SavedAnswer['answer'], kind: FieldKind): boolean {
  switch (answer.kind) {
    case 'options':
      return (ONE_OF.includes(kind) && answer.labels.length === 1) || (SEVERAL.includes(kind) && answer.labels.length > 0);
    case 'text':
      return TYPED.includes(kind) && answer.text.trim() !== '';
    case 'checked':
      return kind === 'checkbox';
  }
}

/** Whether an answer's scope applies, for a field of this class: global answers for the classes that take them, the
 *  company's own for free text. */
function scopeApplies(answer: SavedAnswer, policy: PolicyClass, company: CompanyScope | undefined): boolean {
  const allowed = CLASS_POLICIES[policy].savedAnswers;
  if (allowed === 'never') return false;
  if (allowed === 'global') return answer.scope.kind === 'global';
  return answer.scope.kind === 'company' && company !== undefined && answer.scope.platform === company.platform
    && answer.scope.board === company.board;
}

/**
 * The saved answer for a field (§8.1 step 4), or null: the exact key (normalized label and observed option-set hash;
 * a widget whose options were never read has no observed hash, so none), a scope the field's class allows, and a shape
 * the field's kind can take. Several are the most recently updated one.
 */
export function findSavedAnswer(spec: Pick<FieldSpec, 'label' | 'optionSetHash' | 'kind'>,
  answers: readonly SavedAnswer[], policy: PolicyClass, company?: CompanyScope): SavedAnswer | null {
  if (answers.length === 0 || spec.optionSetHash === 'lazy') return null;
  const labelKey = normalizeLabel(spec.label);
  if (labelKey === '') return null;
  let best: SavedAnswer | null = null;
  for (const answer of answers) {
    if (answer.labelKey !== labelKey || answer.optionSetHash !== spec.optionSetHash) continue;
    if (!scopeApplies(answer, policy, company) || !answerFitsKind(answer.answer, spec.kind)) continue;
    if (best === null || answer.updatedAt > best.updatedAt) best = answer;
  }
  return best;
}
