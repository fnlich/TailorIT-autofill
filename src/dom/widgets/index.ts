/*
 * The ARIA widget helpers (Phase 4; docs/design/runtime.md §5.6, §6 and §7.1; docs/ARCHITECTURE.md "Filler"): the
 * fillers for what the scanner recognises from standard ARIA (aria.ts) or an adapter declares (widgetFor).
 * - fillWidget: one planned write into a combobox, a multiselect or a radio or toggle-button group (fill.ts);
 * - searchTypeahead: a remote typeahead's queries, one at a time (typeahead.ts);
 * - searchesList and searchForOption: a long list its own text box filters as typed (a combobox its adapter declared:
 *   Greenhouse's phone country, 244 countries) has its planned option searched for, as a remote typeahead is, by the
 *   option's own words ("Canada" for "Canada +1"), and the one result that is that option clicked; a short list is
 *   chosen from whole (fillWidget);
 * - readWidget: the reactive loop's waiting path. A lazy widget the planner needs the options of is opened, read whole
 *   and closed, and what it showed is kept as its field's reading, so the next pass plans it with real options; one
 *   that shows nothing until something is typed is read as a remote search (a kind its adapter declared stands: a
 *   declared combobox is never made a search, and a declared search is read as one without being opened); one that
 *   ignores our activation is needs-your-click;
 * - widgetHolds: the read-back after the pass's settle (hold.ts);
 * - chooseThroughBridge: React first (docs/SPEC-AMENDMENTS.md §12): a combobox its adapter declares for the page-world
 *   bridge has its planned option chosen by its own React code, then read back (fill.ts); fillWidget tries it first,
 *   and content/pass.ts before a long list's search, once per write (WidgetContext.bridgeTried).
 * A widget is acted on only when standard ARIA says where its list is (or it is a group whose members carry their own
 * state), or its adapter declares where a search's results are from a capture (v4: WidgetDecl.results, Lever's
 * location search; s2 wd: Workday's prompts, their list found anew by the adapter's hook): a widget an adapter declares
 * without either is widget-unsupported, never typed into. jr6 ENGINE E1 (FIXPLAN §6.2 item 1): a combobox or
 * multiselect its adapter declares with a results list is read by its declared rows.
 * The events are interact.ts's: click() through assertNotSubmit (or the adapter's one declared mousedown, mouseup or
 * focus), the text filler's input, change, focusout and blur, a key the adapter declares for the widget, and a list's
 * own scrollTop set as a property; before any of them, for a widget declared for it, one command to the page-world
 * bridge (dom/bridge.ts). Never an undeclared key, a pointer move or a hover.
 */
import type { ValueOrigin, WriteValue } from '../../core/types/intent';
import { refused } from '../fillers/outcome';
import { isUsableOption } from '../option-hash';
import { OPTIONS_CAP_MS, WIDGET_EMPTY_AFTER_MS } from '../thresholds';
import type { FieldTarget, FillOutcome, WidgetReading } from '../types';
import { filtersAsTyped, isActionable, isMultiselectable } from './aria';
import { addOptions, chooseOption, keepReading, learnRead, pressMember, type WidgetFillContext } from './fill';
import { awaitList, closeList, openList } from './interact';
import { readList, type ListRead } from './options';

export {
  ariaWidgetKind, editableOf, isActionable, isWidgetPart, listOf, membersOf, pressTargetOf, searchesList, widgetListOf,
  WIDGET_ROOT_SELECTOR,
} from './aria';
export { chooseThroughBridge, keepReading, remember, type BridgeAttempt, type WidgetFillContext } from './fill';
export {
  learnable, learnedListKey, MAX_LEARNED_LABEL, MAX_LEARNED_OPTIONS, staleLearned, type LearnList,
} from './known';
export { widgetHolds } from './hold';
export {
  afterAction, afterBridge, awaitPageReady, bridgeChoose, chooseResult, closeList, expandedState, newBridgeRun,
  newReadiness, openList, pressDeclaredKey, type BridgeChoice, type BridgeRun, type WidgetContext, type WidgetReadiness,
} from './interact';
export { chosenLabels, hashOfRead, memberLabel, readList, readShownList, shownOptions, widgetCurrentValue } from './options';
export { searchForOption, searchTypeahead, type TypeaheadHooks, type TypeaheadResult } from './typeahead';

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
  const keepOptions = (read: ListRead, multiselectable: boolean): WidgetReadResult => {
    const reading = keepReading(ctx.readings, target.field.baseKey, widget, read.options.map((option) => ({
      label: option.label, disabled: option.disabled })), multiselectable, read.complete);
    // s2 lists: a learnable dropdown's complete read is kept for its host too.
    if (reading.kind === 'options') learnRead(ctx, target, widget, reading.options, read.complete);
    return { status: 'read', reading };
  };
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
  // jr6 ENGINE E1 (FIXPLAN §6.2 item 1, oracle-new-1): a declared list is read by its declared rows, its unchoosable ones
  // read as rows that cannot be chosen.
  const results = widget.results;
  const read = wait.status === 'ready' ? await readList(opened.listbox, { signal: ctx.signal, labelOf: widget.optionLabel,
    drawnWhole: widget.drawnWhole === true, ...(results === undefined ? {} : { option: results }),
    ...(results?.unchoosable === undefined ? {} : { unchoosable: results.unchoosable }) }) : null;
  const multiselectable = isMultiselectable(opened.listbox);
  await closeList(widget, ctx, opened);
  if (ctx.signal?.aborted) return { status: 'aborted' };
  if (read !== null && read.options.some((option) => isUsableOption(option.label))) return keepOptions(read, multiselectable);
  if (searches) return keep({ kind: 'remote' });
  return { status: 'unread', reason: 'options-never-loaded' };
}
