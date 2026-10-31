/*
 * Writing an ARIA widget (Phase 4; docs/design/runtime.md §6; docs/ARCHITECTURE.md "Filler"), with untrusted events
 * only (interact.ts), and a read-back of what the widget then shows:
 * - a combobox: its list opened (one activation), read whole again (the planned option must still be there, at its
 *   place, with its clean label: else options-changed and nothing is chosen), the option shown (a virtualized list
 *   scrolled back to it) and clicked through assertNotSubmit, the list closed, then its shown value read back;
 * - a multiselect: only the planned options not chosen yet are added, one click each (the list opened again whenever
 *   the page closed it); an option already chosen is never clicked (it would be removed), nor is anything in a chip;
 *   a set that would pass the question's cap (maxSelections, its "choose up to N") is refused whole; afterwards every
 *   planned option must show chosen and every one chosen before must still be;
 * - a radio group or a Yes/No group of toggle buttons: a click on the planned member, unless it is chosen already,
 *   then its aria-checked or aria-pressed read back. A typeless button inside a form is a submit button, so
 *   assertNotSubmit refuses its click and the field is flagged needs-your-click.
 * A widget that ignores our events (nothing opens, nothing is chosen) is needs-your-click and is never tried another
 * way. Each whole read of a list is kept as the field's reading (WidgetReading), so the next scan sees what it now
 * shows. Nothing here logs or reports a value.
 */
import type { BaseKey } from '../../core/types/field';
import type { WriteValue } from '../../core/types/intent';
import { parseSelectionHints, selectionLimits } from '../../core/multiselect/hints';
import { assertNotSubmit } from '../fillers/not-submit';
import { done, mismatch, refused } from '../fillers/outcome';
import { sameOptionLabel } from '../fillers/verify';
import { OPTIONS_CAP_MS, WIDGET_EMPTY_AFTER_MS } from '../thresholds';
import type { FieldTarget, FillOutcome, WidgetReading, WidgetTarget } from '../types';
import { isChosen, isMultiselectable, isUnavailable } from './aria';
import { afterAction, awaitList, closeList, openList, type WidgetContext } from './interact';
import { chosenLabels, memberLabel, readList, revealOption, type ListRead } from './options';

/** What writing a widget needs besides the field and the value. */
export interface WidgetFillContext extends WidgetContext {
  /** The run's readings by base key: every whole read of a widget's list replaces its field's. */
  readings?: Map<BaseKey, WidgetReading>;
}

/** Keeps a whole read of a widget's list as its field's reading. */
export function remember(ctx: WidgetFillContext, baseKey: BaseKey, read: ListRead, listbox: Element): void {
  if (read.options.length === 0) return;
  ctx.readings?.set(baseKey, { kind: 'options', multiselectable: isMultiselectable(listbox),
    options: read.options.map((option) => ({ label: option.label, disabled: option.disabled })) });
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
  remember(ctx, target.field.baseKey, read, opened.listbox);
  return { listbox: opened.listbox, read, activated: opened.activated };
}

/** Whether the widget shows `label` chosen now. */
function showsChosen(widget: WidgetTarget, known: readonly string[], label: string): boolean {
  return chosenLabels(widget, known).some((chosen) => sameOptionLabel(chosen, label));
}

/** Chooses the planned option of a combobox (see the header). */
export async function chooseOption(target: FieldTarget, value: Extract<WriteValue, { kind: 'option' }>,
  ctx: WidgetFillContext): Promise<FillOutcome> {
  const widget = target.widget!;
  const known = knownLabels(target);
  const planned = target.field.options === 'lazy' ? undefined : target.field.options[value.index];
  if (planned === undefined || !sameOptionLabel(planned.label, value.cleanLabel)) return refused('options-changed');
  if (showsChosen(widget, known, value.cleanLabel)) return done(false, 'already-correct');
  const before = chosenLabels(widget, known);
  const opened = await openAndRead(target, ctx);
  if ('failed' in opened) return opened.failed;
  const fresh = opened.read.options[value.index];
  if (fresh === undefined || fresh.disabled || !sameOptionLabel(fresh.label, value.cleanLabel)) {
    await closeList(widget, ctx, opened);
    return refused('options-changed');
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
  const after = chosenLabels(widget, known);
  if (after.some((label) => sameOptionLabel(label, value.cleanLabel))) return done(true, 'ok');
  if (after.length === before.length && after.every((label, at) => label === before[at])) return refused('needs-your-click');
  return mismatch('verify-mismatch');
}

/** The most options the question allows: its constraints and its "choose up to N". */
function capOf(target: FieldTarget): number | undefined {
  const { field } = target;
  return selectionLimits(field.constraints, parseSelectionHints(field.label, field.description)).max;
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
  const isChosenBefore = (label: string) => before.some((chosen) => sameOptionLabel(chosen, label));
  const missing = value.indices.map((index, at) => ({ index, label: value.cleanLabels[at]! }))
    .filter((item) => !isChosenBefore(item.label));
  if (missing.length === 0) return done(false, 'already-correct');
  const cap = capOf(target);
  if (cap !== undefined && before.length + missing.length > cap) return refused('max-selections-reached');

  let added = 0;
  let activated = false;
  let stopped: FillOutcome | null = null;
  for (const item of missing) {
    // The page may have chosen it itself in answer to our last click: it is never clicked again (that removes it).
    if (showsChosen(widget, known, item.label)) continue;
    const opened = await openAndRead(target, ctx);
    if ('failed' in opened) {
      stopped = opened.failed;
      break;
    }
    activated ||= opened.activated;
    const fresh = opened.read.options[item.index];
    if (fresh === undefined || fresh.disabled || !sameOptionLabel(fresh.label, item.label)) {
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
    if (!showsChosen(widget, known, item.label)) {
      stopped = refused('needs-your-click');
      break;
    }
    added += 1;
  }
  await closeList(widget, ctx, { activated });
  const after = chosenLabels(widget, known);
  const isChosenNow = (label: string) => after.some((chosen) => sameOptionLabel(chosen, label));
  if (before.some((label) => !isChosenNow(label))) return mismatch('unexpected-selection');
  if (value.cleanLabels.every(isChosenNow)) return done(true, 'ok');
  if (added === 0 && stopped !== null) return stopped;
  return mismatch('verify-mismatch');
}

/** Presses the planned member of a radio group or a Yes/No group of toggle buttons (see the header). */
export async function pressMember(target: FieldTarget, value: Extract<WriteValue, { kind: 'option' }>,
  ctx: WidgetFillContext): Promise<FillOutcome> {
  const widget = target.widget!;
  const planned = target.field.options === 'lazy' ? undefined : target.field.options[value.index];
  const member = widget.members[value.index];
  if (planned === undefined || member === undefined || !sameOptionLabel(planned.label, value.cleanLabel)
    || !sameOptionLabel(memberLabel(member), value.cleanLabel)) return refused('options-changed');
  if (isUnavailable(member) || !member.isConnected) return refused('options-changed');
  if (isChosen(member)) return done(false, 'already-correct');
  if (!assertNotSubmit(member, ctx).ok) return refused('needs-your-click');
  member.click();
  await afterAction(widget, ctx);
  return isChosen(member) ? done(true, 'ok') : refused('needs-your-click');
}
