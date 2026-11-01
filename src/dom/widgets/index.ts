/*
 * The ARIA widget helpers (Phase 4; docs/design/runtime.md §5.6, §6 and §7.1; docs/ARCHITECTURE.md "Filler"): the
 * fillers for what the scanner recognises from standard ARIA (aria.ts) or an adapter declares (widgetFor).
 * - fillWidget: one planned write into a combobox, a multiselect or a radio or toggle-button group (fill.ts);
 * - searchTypeahead: a remote typeahead's queries, one at a time (typeahead.ts);
 * - readWidget: the reactive loop's waiting path. A lazy widget the planner needs the options of is opened, read whole
 *   and closed, and what it showed is kept as its field's reading, so the next pass plans it with real options; one
 *   that shows nothing until something is typed is read as a remote search (a kind its adapter declared stands: a
 *   declared combobox is never made a search, and a declared search is read as one without being opened); one that
 *   ignores our activation is needs-your-click;
 * - widgetHolds: the read-back after the pass's settle (hold.ts).
 * A widget is acted on only when standard ARIA says where its list is (or it is a group whose members carry their own
 * state): a widget an adapter declares without that (Lever's location search) is widget-unsupported, never typed into.
 * The events are interact.ts's: click() through assertNotSubmit (or the adapter's one declared mousedown, mouseup or
 * focus), the text filler's input, change, focusout and blur, and a list's own scrollTop set as a property. Never keys,
 * pointer moves or hovers.
 */
import type { ValueOrigin, WriteValue } from '../../core/types/intent';
import { refused } from '../fillers/outcome';
import { isUsableOption } from '../option-hash';
import { OPTIONS_CAP_MS, WIDGET_EMPTY_AFTER_MS } from '../thresholds';
import type { FieldTarget, FillOutcome, WidgetReading, WidgetTarget } from '../types';
import { filtersAsTyped, isMultiselectable, referencesList, roleOf } from './aria';
import { addOptions, chooseOption, keepReading, pressMember, type WidgetFillContext } from './fill';
import { awaitList, closeList, openList } from './interact';
import { readList, type ListRead } from './options';

export { ariaWidgetKind, editableOf, isWidgetPart, listOf, membersOf, WIDGET_ROOT_SELECTOR } from './aria';
export { keepReading, remember, type WidgetFillContext } from './fill';
export { widgetHolds } from './hold';
export {
  afterAction, closeList, expandedState, newReadiness, openList, type WidgetContext, type WidgetReadiness,
} from './interact';
export { chosenLabels, hashOfRead, memberLabel, readList, readShownList, shownOptions, widgetCurrentValue } from './options';
export { searchTypeahead, type TypeaheadHooks, type TypeaheadResult } from './typeahead';

/** Whether standard ARIA tells where a widget's list is, or its members' state: the helpers act on nothing else. */
export function isActionable(widget: WidgetTarget): boolean {
  if (widget.kind === 'checkbox') return false;
  if (widget.kind === 'radio') return widget.members.length > 0;
  const roles = [roleOf(widget.element), widget.input === null ? '' : roleOf(widget.input)];
  return roles.includes('combobox') || roles.includes('listbox') || referencesList(widget.element, widget.input);
}

/** Writes one planned value into a widget (fill.ts); a query is searchTypeahead's. `origin` is the write's: an
 *  llm-pick is checked once more on what the widget shows right before its click (the Phase 4 review, R1). */
export async function fillWidget(target: FieldTarget, value: WriteValue, ctx: WidgetFillContext, origin?: ValueOrigin):
  Promise<FillOutcome> {
  const widget = target.widget;
  if (widget === undefined || !isActionable(widget)) return refused('widget-unsupported');
  if (target.field.disabled || target.field.readOnly) return refused('disabled-or-readonly');
  switch (widget.kind) {
    case 'radio':
      return value.kind === 'option' ? pressMember(target, value, ctx, origin) : refused('internal-error');
    case 'combobox':
      return value.kind === 'option' ? chooseOption(target, value, ctx, origin) : refused('internal-error');
    case 'multiselect':
      return value.kind === 'options' ? addOptions(target, value, ctx) : refused('internal-error');
    default:
      return refused('internal-error');
  }
}

/** How the waiting path's read of a lazy widget went. 'gone': the page replaced the widget while the run waited for it
 *  to be ready (a form rebuilt), so the next scan finds it again. */
export type WidgetReadResult =
  | { status: 'read'; reading: WidgetReading }
  | { status: 'unread'; reason: 'needs-your-click' | 'widget-unsupported' | 'options-never-loaded' }
  | { status: 'gone' }
  | { status: 'aborted' };

/** Opens a lazy widget, reads its list whole and closes it (see the header); the reading is kept in ctx.readings. */
export async function readWidget(target: FieldTarget, ctx: WidgetFillContext): Promise<WidgetReadResult> {
  const widget = target.widget;
  if (widget === undefined || widget.kind === 'radio' || !isActionable(widget)) {
    return { status: 'unread', reason: 'widget-unsupported' };
  }
  const keep = (reading: WidgetReading): WidgetReadResult => {
    ctx.readings?.set(target.field.baseKey, reading);
    return { status: 'read', reading };
  };
  const keepOptions = (read: ListRead, multiselectable: boolean): WidgetReadResult => ({ status: 'read',
    reading: keepReading(ctx.readings, target.field.baseKey, widget, read.options.map((option) => ({ label: option.label,
      disabled: option.disabled })), multiselectable, read.complete) });
  // A search its adapter declared has nothing to read before something is typed: it is one, unopened.
  if (widget.declared && widget.kind === 'typeahead-remote' && widget.input !== null) return keep({ kind: 'remote' });
  // A text box that filters what it suggests, and shows nothing before something is typed, is a remote search; a
  // combobox its adapter declared stays one (Greenhouse's Yes/No filters as typed too).
  const searches = widget.input !== null && (widget.kind === 'typeahead-remote'
    || (!widget.declared && filtersAsTyped(widget.element, widget.input)));
  const opened = await openList(widget, ctx);
  if (!opened.open) {
    if (opened.reason === 'aborted') return { status: 'aborted' };
    if (opened.reason === 'gone') return { status: 'gone' };
    if (opened.reason !== 'refused' && searches) return keep({ kind: 'remote' });
    return { status: 'unread', reason: opened.reason === 'no-list' ? 'widget-unsupported' : 'needs-your-click' };
  }
  const wait = await awaitList(widget, ctx, { prevHash: null, capMs: OPTIONS_CAP_MS, emptyAfterMs: WIDGET_EMPTY_AFTER_MS });
  if (wait.status === 'aborted') return { status: 'aborted' };
  const read = wait.status === 'ready' ? await readList(opened.listbox, { signal: ctx.signal }) : null;
  const multiselectable = isMultiselectable(opened.listbox);
  await closeList(widget, ctx, opened);
  if (ctx.signal?.aborted) return { status: 'aborted' };
  if (read !== null && read.options.some((option) => isUsableOption(option.label))) return keepOptions(read, multiselectable);
  if (searches) return keep({ kind: 'remote' });
  return { status: 'unread', reason: 'options-never-loaded' };
}
