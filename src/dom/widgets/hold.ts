/*
 * The read-back of a widget after the pass's settle (Phase 4; fillers/verify.ts's holds for a widget): what it shows
 * chosen now (options.ts's chosenLabels) must be the planned option, or every planned option, each still carrying its
 * planned clean label at its place among the field's options. What it shows is compared with the planned option as the
 * page shows it, injected text and all, so an option's injected look-alike chosen in its place never reads back as it
 * (the Phase 4 review, R2). A remote typeahead's options were its results, which no scan keeps: its chosen label is
 * read back alone, by its clean label. So is a long list's option chosen among one typed query's results (v4, drop:
 * dom/widgets' searchesList, content/pass.ts searchField), whose place among the list's own options no scan knows: by
 * what the widget shows read with no known options, so no adapter maps it onto an option of a read that lacks it.
 * jr6 ENGINE E1 (FIXPLAN §6.2 item 5): a search whose typed text stood as its answer (WidgetDecl.freeText: nothing
 * matched it) holds that text while its text box reads it, white space collapsed and in any case.
 * jr6 ENGINE E3 (FIXPLAN §6.2 item 13): a box of several answers (WidgetDecl.tags) holds a planned text while every one
 * of its values shows as one of its chips, in any case (tag-chips.ts).
 */
import type { WriteValue } from '../../core/types/intent';
import type { FieldTarget } from '../types';
import { isChosen, searchesList } from './aria';
import { chosenLabels, labelIdentity, memberLabel, shownIdentity } from './options';
import { holdsTags } from './tag-chips';

/** A box's text as compared: white space collapsed, any case (typeahead.ts reads its free text so). */
const tidy = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

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
      if (option === undefined || !same(option.label, value.cleanLabel)) {
        // v4 (drop): an option a search chose among its results, which the list's read may not hold at that place:
        // what the widget shows, read with no known options (an adapter's reading never maps it onto one of a read
        // that may lack the right one: Greenhouse's phone country by its dial code alone), is its clean label.
        return searchesList(target) && chosenLabels(widget, []).some((label) => same(label, value.cleanLabel));
      }
      return chosenLabels(widget, known).some((label) => shownAs(label, option.label));
    }
    case 'text':
      // jr6 ENGINE E3 (FIXPLAN §6.2 item 13): a box of several answers holds a planned text while every one of its values
      // shows as a chip (tag-chips.ts holdsTags).
      if (widget.tags !== undefined) return holdsTags(widget.tags, value.text);
      // jr6 ENGINE E1: a free-text search's typed answer (see the header), read from its text box alone.
      return widget.freeText === true && widget.input !== null && widget.input.isConnected
        && tidy(widget.input.value) === tidy(value.text) && tidy(value.text) !== '';
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
