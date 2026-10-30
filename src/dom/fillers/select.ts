/*
 * The select fillers (docs/design/runtime.md §6). A single select gets the prototype selectedIndex setter with the
 * chosen option's own index (exact even when option values repeat), then input and change. A multiple select gets the
 * prototype `selected` setter on each planned option that is not selected yet, then one input and one change: an
 * option is never deselected. The planned option is the one at the planned place among the visible options, and its
 * clean label must still be the one planned; otherwise the options changed and nothing is written.
 */
import type { FieldTarget, FillOutcome } from '../types';
import { fireChange, fireInput, selectOption, setSelectedIndex } from './events';
import { done, mismatch, refused } from './outcome';
import { sameOptionLabel } from './verify';

/** Selects the planned option of a single select. */
export function fillSelect(target: FieldTarget, index: number, cleanLabel: string): FillOutcome {
  const select = target.control as HTMLSelectElement;
  const planned = target.field.options === 'lazy' ? undefined : target.field.options[index];
  const option = target.options[index];
  if (planned === undefined || option === undefined || !sameOptionLabel(planned.label, cleanLabel)) {
    return refused('options-changed');
  }
  if (option.disabled || !option.isConnected) return refused('options-changed');
  const before = select.selectedIndex;
  if (before === option.index) return done(false, 'already-correct');
  setSelectedIndex(select, option.index);
  fireInput(select, 'plain');
  fireChange(select);
  if (select.selectedIndex === option.index && option.selected) return done(true, 'ok');
  if (select.selectedIndex === before) return refused('needs-your-click');
  return mismatch('verify-mismatch');
}

/** Adds the planned options of a multiple select to its selection. */
export function fillMultiSelect(target: FieldTarget, indices: readonly number[]): FillOutcome {
  const select = target.control as HTMLSelectElement;
  const planned = indices.map((index) => target.options[index]);
  if (planned.some((option) => option === undefined || option.disabled || !option.isConnected)) {
    return refused('options-changed');
  }
  const options = planned as HTMLOptionElement[];
  const missing = options.filter((option) => !option.selected);
  if (missing.length === 0) return done(false, 'already-correct');
  const selectedBefore = Array.from(select.options).filter((option) => option.selected);
  for (const option of missing) selectOption(option);
  fireInput(select, 'plain');
  fireChange(select);
  if (selectedBefore.some((option) => !option.selected)) return mismatch('unexpected-selection');
  if (options.every((option) => option.selected)) return done(true, 'ok');
  if (missing.every((option) => !option.selected)) return refused('needs-your-click');
  return mismatch('verify-mismatch');
}
