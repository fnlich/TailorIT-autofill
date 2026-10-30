/*
 * The radio and checkbox fillers (docs/design/runtime.md §6): an untrusted click() on each planned control that is
 * not checked yet, through assertNotSubmit; the click itself produces click, input and change. A hidden native
 * control that qualified by the proxy rule is clicked itself, never its label. Nothing is ever unticked: an already
 * checked box is left alone, each box is read again right before its click (the page may have ticked it in answer to
 * the last one), and a box the page unticked in response is reported, not ticked back by other means.
 *
 * A planned option is the one at the planned place that still reads as planned. A checkbox group's boxes are read
 * again right before any is clicked, with the scanner's own label reader: if any planned box now shows another clean
 * label (the page re-ordered or re-labelled the list while the plan was out), the whole write is refused as
 * options-changed and nothing is ticked. After the clicks the labels are read once more, so a list that changed under
 * our clicks never reads back as verified.
 */
import type { WriteValue } from '../../core/types/intent';
import { optionLabelOf } from '../labels';
import { newScanCache } from '../scan-cache';
import type { FieldTarget, FillOutcome } from '../types';
import { assertNotSubmit, type NotSubmitContext } from './not-submit';
import { done, mismatch, refused } from './outcome';
import { sameOptionLabel } from './verify';

/** An options write, as the multi-option fillers take it. */
export type OptionsValue = Extract<WriteValue, { kind: 'options' }>;

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

/** Whether each box shows, now, the clean label planned for it (read as the scanner reads a member's label). */
function boxesShow(boxes: readonly HTMLInputElement[], cleanLabels: readonly string[], ctx: NotSubmitContext): boolean {
  const labels = { cache: newScanCache(), adapter: ctx.adapter };
  return boxes.length === cleanLabels.length
    && boxes.every((box, at) => sameOptionLabel(optionLabelOf(box, labels).text, cleanLabels[at]!));
}

/** Ticks the planned boxes of a checkbox group that are not ticked yet. */
export function fillCheckboxGroup(target: FieldTarget, value: OptionsValue, ctx: NotSubmitContext): FillOutcome {
  const planned = value.indices.map((index) => target.members[index]);
  if (planned.some((box) => box === undefined || box.disabled || !box.isConnected)) return refused('options-changed');
  const boxes = planned as HTMLInputElement[];
  if (!boxesShow(boxes, value.cleanLabels, ctx)) return refused('options-changed');
  const missing = boxes.filter((box) => !box.checked);
  if (missing.length === 0) return done(false, 'already-correct');
  if (missing.some((box) => !assertNotSubmit(box, ctx).ok)) return refused('needs-your-click');
  const checkedBefore = target.members.filter((box) => box.checked);
  for (const box of missing) {
    // Read again right before the click: the page may have ticked this box itself in answer to our last one, and a
    // click now would untick it (DOM-9).
    if (!box.checked) box.click();
  }
  if (checkedBefore.some((box) => !box.checked)) return mismatch('unexpected-selection');
  if (boxes.every((box) => box.checked)) {
    return boxesShow(boxes, value.cleanLabels, ctx) ? done(true, 'ok') : mismatch('verify-mismatch');
  }
  if (missing.every((box) => !box.checked)) return refused('needs-your-click');
  return mismatch('verify-mismatch');
}
