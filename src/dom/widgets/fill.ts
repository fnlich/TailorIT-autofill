/*
 * Writing an ARIA widget (Phase 4; docs/design/runtime.md §6; docs/ARCHITECTURE.md "Filler"), with untrusted events
 * only (interact.ts), and a read-back of what the widget then shows:
 * - a combobox: its list opened (one activation), read whole again (the planned option must still be there, at its
 *   place, with its clean label: else options-changed and nothing is chosen), the option shown (a virtualized list
 *   scrolled back to it, by its place and its label as the page shows it, so an injected look-alike is never the one
 *   shown) and clicked through assertNotSubmit, the list closed, then its shown value read back. An llm-pick is checked
 *   once more on that fresh read, right before the click: the option must carry no injected text and its clean text
 *   must still hash as the LLM saw it (llmPickStillValid), else llm-pick-rejected and nothing is chosen. The scan's
 *   options for a closed list are the kept reading, which a page can relabel behind (the Phase 4 review, R1);
 * - a multiselect: only the planned options not chosen yet are added, one click each (the list opened again whenever
 *   the page closed it), each found in that fresh read by its label as the page shows it, since a list that hides what
 *   is chosen moves the rest up (R5); an option already chosen is never clicked (it would be removed), nor is anything
 *   in a chip; a set that would pass the question's cap (maxSelections, its "choose up to N") is refused whole;
 *   afterwards every planned option must show chosen and every one chosen before must still be;
 * - a radio group or a Yes/No group of toggle buttons: a click on the planned member, unless it is chosen already,
 *   then its aria-checked or aria-pressed read back. A typeless button inside a form is a submit button, so
 *   assertNotSubmit refuses its click and the field is flagged needs-your-click. An llm-pick is checked on the
 *   members' labels as they read now.
 * A widget that ignores our events (nothing opens, nothing is chosen) is needs-your-click and is never tried another
 * way. Each whole read of a list is kept as the field's reading (WidgetReading), with any option it no longer shows but
 * the widget shows chosen kept in place (withChosenKept), so the next scan sees what it now shows and still knows its
 * chips. Nothing here logs or reports a value.
 */
import { llmPickStillValid } from '../../core/guard/provenance';
import type { BaseKey, Option } from '../../core/types/field';
import type { PlannedWrite } from '../../core/types/fill';
import type { ValueOrigin, WriteValue } from '../../core/types/intent';
import { parseSelectionHints, selectionLimits } from '../../core/multiselect/hints';
import { assertNotSubmit } from '../fillers/not-submit';
import { done, mismatch, refused } from '../fillers/outcome';
import { sameOptionLabel } from '../fillers/verify';
import { OPTIONS_CAP_MS, WIDGET_EMPTY_AFTER_MS } from '../thresholds';
import type { FieldTarget, FillOutcome, WidgetOptionRead, WidgetReading, WidgetTarget } from '../types';
import { isChosen, isMultiselectable, isUnavailable } from './aria';
import { afterAction, awaitList, closeList, openList, type WidgetContext } from './interact';
import {
  chosenLabels, memberLabel, readList, revealOption, shownIdentity, withChosenKept, type ListRead, type ReadOption,
} from './options';

/** What writing a widget needs besides the field and the value. */
export interface WidgetFillContext extends WidgetContext {
  /** The run's readings by base key: every whole read of a widget's list replaces its field's. */
  readings?: Map<BaseKey, WidgetReading>;
}

/** Keeps a whole read of a widget's list as its field's reading: what the read found, whether it reached the list's
 *  end, and any option of the earlier reading the list no longer shows but the widget shows chosen (withChosenKept). */
export function remember(ctx: WidgetFillContext, baseKey: BaseKey, read: ListRead, listbox: Element,
  widget: WidgetTarget): void {
  if (read.options.length === 0) return;
  keepReading(ctx.readings, baseKey, widget, read.options.map((option) => ({ label: option.label,
    disabled: option.disabled })), isMultiselectable(listbox), read.complete);
}

/** Keeps a list's options as its field's reading; a multiselect's earlier chosen options (its chips) kept in place. A
 *  single answer's list keeps only what it shows: the value of a combobox that filters is no option of the list. */
export function keepReading(readings: Map<BaseKey, WidgetReading> | undefined, baseKey: BaseKey, widget: WidgetTarget,
  fresh: readonly WidgetOptionRead[], multiselectable: boolean, complete: boolean): WidgetReading {
  const earlier = readings?.get(baseKey);
  const several = multiselectable || widget.kind === 'multiselect';
  const before = several && earlier?.kind === 'options' ? earlier.options : null;
  const chosen = before === null ? [] : chosenLabels(widget, before.map((option) => option.label));
  const reading: WidgetReading = { kind: 'options', multiselectable, complete,
    options: withChosenKept(before, fresh, chosen) };
  readings?.set(baseKey, reading);
  return reading;
}

/** The labels a field's options carry (its reading's, as the scan gave them). */
function knownLabels(target: FieldTarget): string[] {
  return target.field.options === 'lazy' ? [] : target.field.options.map((option) => option.label);
}

/** Opens a widget's list and reads it whole, once its options are there. Null when it would not open, with why. */
async function openAndRead(target: FieldTarget, ctx: WidgetFillContext):
  Promise<{ listbox: Element; read: ListRead; activated: boolean } | { failed: FillOutcome }> {
  const widget = target.widget!;
  const opened = await openList(widget, ctx);
  if (!opened.open) {
    return { failed: refused(opened.reason === 'aborted' ? 'internal-error' : opened.reason === 'no-list'
      ? 'widget-unsupported' : 'needs-your-click') };
  }
  const wait = await awaitList(widget, ctx, { prevHash: null, capMs: OPTIONS_CAP_MS, emptyAfterMs: WIDGET_EMPTY_AFTER_MS });
  if (wait.status === 'aborted') return { failed: refused('internal-error') };
  const read = await readList(opened.listbox, { signal: ctx.signal });
  remember(ctx, target.field.baseKey, read, opened.listbox, widget);
  return { listbox: opened.listbox, read, activated: opened.activated };
}

/** Whether the widget shows this option chosen now, as the page shows it: never its injected look-alike. */
function showsOption(widget: WidgetTarget, known: readonly string[], label: string): boolean {
  return chosenLabels(widget, known).some((chosen) => shownIdentity(chosen) === shownIdentity(label));
}

/** A read's options as a field's, for the frame-side checks on what the list shows now. */
function asOptions(options: readonly WidgetOptionRead[]): Option[] {
  return options.map((option, index) => ({ index, label: option.label, disabled: option.disabled, selected: false }));
}

/** Whether a write's origin lets it choose this option of what the list shows now: an llm-pick only of an option that
 *  carries no injected text and whose clean text hashes as the LLM saw it. Any other origin always may. */
function originAllows(origin: ValueOrigin | undefined, value: Extract<WriteValue, { kind: 'option' }>,
  options: readonly WidgetOptionRead[]): boolean {
  if (origin === undefined || origin.provenance !== 'llm-pick') return true;
  return llmPickStillValid({ value, origin } as Pick<PlannedWrite, 'value' | 'origin'> as PlannedWrite,
    { options: asOptions(options) });
}

/** Chooses the planned option of a combobox (see the header). */
export async function chooseOption(target: FieldTarget, value: Extract<WriteValue, { kind: 'option' }>,
  ctx: WidgetFillContext, origin?: ValueOrigin): Promise<FillOutcome> {
  const widget = target.widget!;
  const known = knownLabels(target);
  const planned = target.field.options === 'lazy' ? undefined : target.field.options[value.index];
  if (planned === undefined || !sameOptionLabel(planned.label, value.cleanLabel)) return refused('options-changed');
  if (showsOption(widget, known, planned.label)) return done(false, 'already-correct');
  const before = chosenLabels(widget, known);
  const opened = await openAndRead(target, ctx);
  if ('failed' in opened) return opened.failed;
  const fresh = opened.read.options[value.index];
  if (fresh === undefined || fresh.disabled || !sameOptionLabel(fresh.label, value.cleanLabel)) {
    await closeList(widget, ctx, opened);
    return refused('options-changed');
  }
  // What the list shows now, not the kept reading, decides whether the LLM's pick may still be chosen.
  if (!originAllows(origin, value, opened.read.options)) {
    await closeList(widget, ctx, opened);
    return refused('llm-pick-rejected');
  }
  const option = await revealOption(opened.listbox, fresh, { signal: ctx.signal });
  if (option === null || option.disabled) {
    await closeList(widget, ctx, opened);
    return refused('options-changed');
  }
  if (!assertNotSubmit(option.el, ctx).ok) {
    await closeList(widget, ctx, opened);
    return refused('needs-your-click');
  }
  (option.el as HTMLElement).click();
  await afterAction(widget, ctx);
  await closeList(widget, ctx, opened);
  const after = chosenLabels(widget, [...known, fresh.label]);
  if (after.some((label) => shownIdentity(label) === shownIdentity(fresh.label))) return done(true, 'ok');
  if (after.length === before.length && after.every((label, at) => label === before[at])) return refused('needs-your-click');
  return mismatch('verify-mismatch');
}

/** The most options the question allows: its constraints and its "choose up to N". */
function capOf(target: FieldTarget): number | undefined {
  const { field } = target;
  return selectionLimits(field.constraints, parseSelectionHints(field.label, field.description)).max;
}

/** The option of a fresh read that is the planned one: its label as the page shows it, at its planned place when two
 *  carry it. */
function findPlanned(read: ListRead, label: string, index: number): ReadOption | undefined {
  const same = read.options.filter((option) => shownIdentity(option.label) === shownIdentity(label));
  return same.find((option) => read.options.indexOf(option) === index) ?? same[0];
}

/** Adds the planned options of a multiselect that are not chosen yet (see the header). */
export async function addOptions(target: FieldTarget, value: Extract<WriteValue, { kind: 'options' }>,
  ctx: WidgetFillContext): Promise<FillOutcome> {
  const widget = target.widget!;
  const known = knownLabels(target);
  const options = target.field.options === 'lazy' ? [] : target.field.options;
  if (value.indices.length !== value.cleanLabels.length) return refused('internal-error');
  if (value.indices.some((index, at) => options[index] === undefined
    || !sameOptionLabel(options[index]!.label, value.cleanLabels[at]!))) return refused('options-changed');
  const before = chosenLabels(widget, known);
  const isChosenBefore = (label: string) => before.some((chosen) => shownIdentity(chosen) === shownIdentity(label));
  const wanted = value.indices.map((index, at) => ({ index, clean: value.cleanLabels[at]!, label: options[index]!.label }));
  const missing = wanted.filter((item) => !isChosenBefore(item.label));
  if (missing.length === 0) return done(false, 'already-correct');
  const cap = capOf(target);
  if (cap !== undefined && before.length + missing.length > cap) return refused('max-selections-reached');

  let added = 0;
  let activated = false;
  let stopped: FillOutcome | null = null;
  for (const item of missing) {
    // The page may have chosen it itself in answer to our last click: it is never clicked again (that removes it).
    if (showsOption(widget, known, item.label)) continue;
    const opened = await openAndRead(target, ctx);
    if ('failed' in opened) {
      stopped = opened.failed;
      break;
    }
    activated ||= opened.activated;
    // Found by its label as shown: a list that hides what is chosen has moved the rest up since the plan.
    const fresh = findPlanned(opened.read, item.label, item.index);
    if (fresh === undefined || fresh.disabled || !sameOptionLabel(fresh.label, item.clean)) {
      stopped = refused('options-changed');
      break;
    }
    const option = await revealOption(opened.listbox, fresh, { signal: ctx.signal });
    if (option === null || option.disabled) {
      stopped = refused('options-changed');
      break;
    }
    // Chosen already (its list says so): clicking it would remove it.
    if (option.selected) continue;
    if (!assertNotSubmit(option.el, ctx).ok) {
      stopped = refused('needs-your-click');
      break;
    }
    (option.el as HTMLElement).click();
    await afterAction(widget, ctx);
    if (!showsOption(widget, known, item.label)) {
      stopped = refused('needs-your-click');
      break;
    }
    added += 1;
  }
  await closeList(widget, ctx, { activated });
  const after = chosenLabels(widget, known);
  const isChosenNow = (label: string) => after.some((chosen) => shownIdentity(chosen) === shownIdentity(label));
  if (before.some((label) => !isChosenNow(label))) return mismatch('unexpected-selection');
  if (wanted.every((item) => isChosenNow(item.label))) return done(true, 'ok');
  if (added === 0 && stopped !== null) return stopped;
  return mismatch('verify-mismatch');
}

/** Presses the planned member of a radio group or a Yes/No group of toggle buttons (see the header). */
export async function pressMember(target: FieldTarget, value: Extract<WriteValue, { kind: 'option' }>,
  ctx: WidgetFillContext, origin?: ValueOrigin): Promise<FillOutcome> {
  const widget = target.widget!;
  const planned = target.field.options === 'lazy' ? undefined : target.field.options[value.index];
  const member = widget.members[value.index];
  if (planned === undefined || member === undefined || !sameOptionLabel(planned.label, value.cleanLabel)
    || !sameOptionLabel(memberLabel(member), value.cleanLabel)) return refused('options-changed');
  if (isUnavailable(member) || !member.isConnected) return refused('options-changed');
  if (!originAllows(origin, value, widget.members.map((each) => ({ label: memberLabel(each),
    disabled: isUnavailable(each) })))) return refused('llm-pick-rejected');
  if (isChosen(member)) return done(false, 'already-correct');
  if (!assertNotSubmit(member, ctx).ok) return refused('needs-your-click');
  member.click();
  await afterAction(widget, ctx);
  return isChosen(member) ? done(true, 'ok') : refused('needs-your-click');
}
