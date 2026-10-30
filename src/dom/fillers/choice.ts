/*
 * The radio and checkbox fillers (docs/design/runtime.md §6): an untrusted click() on each planned control that is
 * not checked yet, through assertNotSubmit; the click itself produces click, input and change. A hidden native
 * control that qualified by the proxy rule is clicked itself, never its label. Nothing is ever unticked: an already
 * checked box is left alone, and a box the page unticked in response is reported, not ticked back by other means.
 */
import type { FieldTarget, FillOutcome } from '../types';
import { assertNotSubmit, type NotSubmitContext } from './not-submit';
import { done, mismatch, refused } from './outcome';
import { sameOptionLabel } from './verify';

/** Checks the planned radio of a group. */
export function fillRadio(target: FieldTarget, index: number, cleanLabel: string, ctx: NotSubmitContext): FillOutcome {
  const planned = target.field.options === 'lazy' ? undefined : target.field.options[index];
  const radio = target.members[index];
  if (planned === undefined || radio === undefined || !sameOptionLabel(planned.label, cleanLabel)) {
    return refused('options-changed');
  }
  if (radio.disabled || !radio.isConnected) return refused('options-changed');
  if (radio.checked) return done(false, 'already-correct');
  if (!assertNotSubmit(radio, ctx).ok) return refused('needs-your-click');
  radio.click();
  return radio.checked ? done(true, 'ok') : refused('needs-your-click');
}

/** Ticks a lone checkbox. */
export function fillCheckbox(target: FieldTarget, ctx: NotSubmitContext): FillOutcome {
  const box = target.control as HTMLInputElement;
  if (box.checked) return done(false, 'already-correct');
  if (!assertNotSubmit(box, ctx).ok) return refused('needs-your-click');
  box.click();
  return box.checked ? done(true, 'ok') : refused('needs-your-click');
}

/** Ticks the planned boxes of a checkbox group that are not ticked yet. */
export function fillCheckboxGroup(target: FieldTarget, indices: readonly number[], ctx: NotSubmitContext): FillOutcome {
  const planned = indices.map((index) => target.members[index]);
  if (planned.some((box) => box === undefined || box.disabled || !box.isConnected)) return refused('options-changed');
  const boxes = planned as HTMLInputElement[];
  const missing = boxes.filter((box) => !box.checked);
  if (missing.length === 0) return done(false, 'already-correct');
  if (missing.some((box) => !assertNotSubmit(box, ctx).ok)) return refused('needs-your-click');
  const checkedBefore = target.members.filter((box) => box.checked);
  for (const box of missing) box.click();
  if (checkedBefore.some((box) => !box.checked)) return mismatch('unexpected-selection');
  if (boxes.every((box) => box.checked)) return done(true, 'ok');
  if (missing.every((box) => !box.checked)) return refused('needs-your-click');
  return mismatch('verify-mismatch');
}
