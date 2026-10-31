/*
 * The read-back of a widget after the pass's settle (Phase 4; fillers/verify.ts's holds for a widget): what it shows
 * chosen now (options.ts's chosenLabels) must be the planned option, or every planned option, each still carrying its
 * planned clean label at its place among the field's options. What it shows is compared with the planned option as the
 * page shows it, injected text and all, so an option's injected look-alike chosen in its place never reads back as it
 * (the Phase 4 review, R2). A remote typeahead's options were its results, which no scan keeps: its chosen label is
 * read back alone, by its clean label.
 */
import type { WriteValue } from '../../core/types/intent';
import type { FieldTarget } from '../types';
import { isChosen } from './aria';
import { chosenLabels, labelIdentity, memberLabel, shownIdentity } from './options';

/** Whether a widget holds a planned value now. */
export function widgetHolds(target: FieldTarget, value: WriteValue): boolean {
  const widget = target.widget;
  if (widget === undefined) return false;
  const options = target.field.options === 'lazy' ? [] : target.field.options;
  const known = options.map((option) => option.label);
  const same = (a: string, b: string) => labelIdentity(a) === labelIdentity(b);
  const shownAs = (a: string, b: string) => shownIdentity(a) === shownIdentity(b);
  switch (value.kind) {
    case 'option': {
      if (widget.kind === 'radio') {
        const member = widget.members[value.index];
        return member !== undefined && isChosen(member) && same(memberLabel(member), value.cleanLabel);
      }
      if (widget.kind === 'typeahead-remote') {
        return chosenLabels(widget, [...known, value.cleanLabel]).some((label) => same(label, value.cleanLabel));
      }
      const option = options[value.index];
      if (option === undefined || !same(option.label, value.cleanLabel)) return false;
      return chosenLabels(widget, known).some((label) => shownAs(label, option.label));
    }
    case 'options': {
      if (widget.kind !== 'multiselect' || value.indices.length !== value.cleanLabels.length) return false;
      const chosen = chosenLabels(widget, known);
      return value.indices.every((index, at) => {
        const option = options[index];
        const wanted = value.cleanLabels[at]!;
        return option !== undefined && same(option.label, wanted) && chosen.some((label) => shownAs(label, option.label));
      });
    }
    default:
      return false;
  }
}
