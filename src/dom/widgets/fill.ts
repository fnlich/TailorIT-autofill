/*
 * Writing an ARIA widget (Phase 4; docs/design/runtime.md §6; docs/ARCHITECTURE.md "Filler"), with untrusted events
 * only (interact.ts), and a read-back of what the widget then shows:
 * - a combobox: its list opened (one activation), read whole again (the planned option must still be there, at its
 *   place, with its clean label: else options-changed and nothing is chosen), the option shown (a virtualized list
 *   scrolled back to it, by its place and its label as the page shows it, so an injected look-alike is never the one
 *   shown) and clicked through assertNotSubmit, the list closed, then its shown value read back. An llm-pick is checked
 *   once more on that fresh read, right before the click: the option must carry no injected text and its clean text
 *   must still hash as the LLM saw it (llmPickStillValid), else llm-pick-rejected and nothing is chosen. The scan's
 *   options for a closed list are the kept reading, which a page can relabel behind (the Phase 4 review, R1). s2
 *   lists: a combobox whose options are its stored list (WidgetTarget.knownOptions) is not read first: its list is
 *   opened once, the planned option found at its place by its label and clicked (chooseKnown), and a list that holds
 *   no such option there is read whole as before (options-changed); an llm-pick is still checked on a whole read;
 * - a multiselect: only the planned options not chosen yet are added, one click each (the list opened again whenever
 *   the page closed it), each found in that fresh read by its label as the page shows it, since a list that hides what
 *   is chosen moves the rest up (R5); an option already chosen is never clicked (it would be removed), nor is anything
 *   in a chip; a set that would pass the question's cap (maxSelections, its "choose up to N") is refused whole;
 *   afterwards every planned option must show chosen and every one chosen before must still be;
 * - a radio group or a Yes/No group of toggle buttons: a click on the planned member, unless it is chosen already,
 *   then its aria-checked or aria-pressed read back. A typeless button inside a form is a submit button, so
 *   assertNotSubmit refuses its click and the field is flagged needs-your-click. An llm-pick is checked on the
 *   members' labels as they read now.
 * React first (docs/SPEC-AMENDMENTS.md §12): a combobox or a multiselect its adapter declares for the page-world bridge
 * (WidgetDecl.bridge), and that standard ARIA lets the helpers act on (isActionable), has each planned option chosen
 * by its own React code before any event (chooseThroughBridge, and each option a multiselect is missing). The command
 * is sent only once the frame's own checks pass: the planned option still at its place with its clean label and
 * enabled; an llm-pick checked again (R1) on the reading the frame holds (the bridge opens no list, so it is the kept
 * reading, and the bridge then needs an exact match of react-select's getOptionLabel to that label); the text box
 * through assertNotSubmit and the option's label through optionWordsRefusal (its element may not be drawn, so the
 * element rules a click gets are not run on it). The label sent is the option's clean label as the frame read it from
 * the page, never a profile string. The bridge's word is never taken:
 * - the widget shows the option (read back, with one more bounded wait when it does not yet): written and verified;
 * - it shows something else than before: written, not verified (verify-mismatch), and no event follows; a multiselect
 *   that shows more than it held plus that option is unexpected-selection;
 * - nothing the frame can see changed: the events' path runs as before, from a fresh read of the list, and the run's
 *   bridge goes off. When the bridge had said it chose, that path never ends as "nothing written" (React may hold the
 *   choice): an option shown is written, anything else written but not verified. A multiselect's option the bridge
 *   said it chose, or said was chosen already, is never clicked (that would remove it): the write stops there,
 *   verify-mismatch.
 * A widget that ignores our events (nothing opens, nothing is chosen) is needs-your-click and is never tried another
 * way. Each whole read of a list is kept as the field's reading (WidgetReading), with any option it no longer shows but
 * the widget shows chosen kept in place (withChosenKept), so the next scan sees what it now shows and still knows its
 * chips. The person's Skip (v3 Phase 3: interact.ts's skipTidyContext) ends a wait: a list opened for the write is
 * closed on the tidy context and nothing is chosen; an option already clicked stands, read back as the widget shows
 * it, its list closed the same way: one the widget does not show yet is written, not verified (verify-mismatch: the
 * audit of 2026-11-06, m11). Nothing here logs or reports a value.
 */
import { llmPickStillValid } from '../../core/guard/provenance';
import type { BaseKey, Option } from '../../core/types/field';
import type { PlannedWrite } from '../../core/types/fill';
import type { ValueOrigin, WriteValue } from '../../core/types/intent';
import { parseSelectionHints, selectionLimits } from '../../core/multiselect/hints';
import { assertNotSubmit } from '../fillers/not-submit';
import { done, mismatch, refused } from '../fillers/outcome';
import { sameOptionLabel } from '../fillers/verify';
import { cleanOptionLabel, isUsableOption } from '../option-hash';
import { OPTIONS_CAP_MS, WIDGET_EMPTY_AFTER_MS } from '../thresholds';
import type { BridgeReason } from '../bridge-protocol';
import type { FieldTarget, FillOutcome, WidgetOptionRead, WidgetReading, WidgetTarget } from '../types';
import { isActionable, isChosen, isMultiselectable, isUnavailable } from './aria';
import {
  afterAction, afterBridge, awaitList, bridgeChoose, closeList, closingContext, openList, skipTidyContext,
  type WidgetContext,
} from './interact';
import { findKnown, learnable, learnedLabels, type LearnList } from './known';
import {
  chosenLabels, drawnView, memberLabel, readList, revealOption, shownIdentity, withChosenKept, type ListRead,
  type ReadOption,
} from './options';

/** What writing a widget needs besides the field and the value. */
export interface WidgetFillContext extends WidgetContext {
  /** The run's readings by base key: every whole read of a widget's list replaces its field's. */
  readings?: Map<BaseKey, WidgetReading>;
  /** s2 lists: told of each complete whole read of a learnable widget (known.ts learnable), its labels within the
   *  caps (learnedLabels): the run keeps them for its host. */
  learn?: LearnList;
}

/** s2 lists: tells the run of a learnable widget's complete whole read (WidgetFillContext.learn); nothing for any
 *  other widget or read. */
export function learnRead(ctx: Pick<WidgetFillContext, 'learn'>, target: FieldTarget, widget: WidgetTarget,
  options: readonly WidgetOptionRead[], complete: boolean): void {
  if (ctx.learn === undefined || !complete || !learnable(widget)) return;
  const labels = learnedLabels(options, isUsableOption);
  if (labels !== null) ctx.learn(target, labels);
}

/** Keeps a whole read of a widget's list as its field's reading: what the read found, whether it reached the list's
 *  end, and any option of the earlier reading the list no longer shows but the widget shows chosen (withChosenKept). */
export function remember(ctx: WidgetFillContext, baseKey: BaseKey, read: ListRead, listbox: Element,
  widget: WidgetTarget, target?: FieldTarget): void {
  if (read.options.length === 0) return;
  const reading = keepReading(ctx.readings, baseKey, widget, read.options.map((option) => ({ label: option.label,
    disabled: option.disabled })), isMultiselectable(listbox), read.complete);
  if (target !== undefined && reading.kind === 'options') learnRead(ctx, target, widget, reading.options, read.complete);
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
  // A Skip that ended a wait here closes what our activation opened (see the header).
  const skipped = async (activated: boolean): Promise<{ failed: FillOutcome }> => {
    const tidy = skipTidyContext(ctx);
    if (tidy !== null) await closeList(widget, tidy, { activated });
    return { failed: refused('internal-error') };
  };
  const opened = await openList(widget, ctx);
  if (!opened.open) {
    if (opened.reason === 'aborted') return skipped(true);
    return { failed: refused(opened.reason === 'no-list' ? 'widget-unsupported' : opened.reason === 'gone'
      ? 'element-not-found' : 'needs-your-click') };
  }
  const wait = await awaitList(widget, ctx, { prevHash: null, capMs: OPTIONS_CAP_MS, emptyAfterMs: WIDGET_EMPTY_AFTER_MS });
  if (wait.status === 'aborted') return skipped(opened.activated);
  const read = await readList(opened.listbox, { signal: ctx.signal, labelOf: widget.optionLabel,
    drawnWhole: widget.drawnWhole === true });
  if (ctx.signal?.aborted) return skipped(opened.activated);
  remember(ctx, target.field.baseKey, read, opened.listbox, widget, target);
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

/** Whether a reading of what a widget shows chosen holds nothing beyond `allowed`, as the page shows each. */
function within(chosen: readonly string[], allowed: readonly string[]): boolean {
  const identities = new Set(allowed.map(shownIdentity));
  return chosen.every((label) => identities.has(shownIdentity(label)));
}

/** Whether two readings of what a widget shows chosen are the same, as the page shows each. */
function sameChosen(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && within(a, b) && within(b, a);
}

/** What one attempt through the page-world bridge left (see the header): 'done', the write's outcome (written and
 *  verified, or written and not verified); 'fallback', nothing the frame can see was chosen, so the events' path
 *  decides, `sent` when the bridge said it chose (or that the option was chosen already) all the same, and `before`
 *  what the widget showed chosen before the command. */
export type BridgeAttempt =
  | { kind: 'done'; outcome: FillOutcome }
  | { kind: 'fallback'; sent: boolean; before: readonly string[]; reason?: BridgeReason | 'not-allowed' };

/** Chooses the planned option of a combobox its adapter declares for the page-world bridge through it (see the
 *  header): one command, after the frame's own checks, and what the widget then shows decides. */
export async function chooseThroughBridge(target: FieldTarget, value: Extract<WriteValue, { kind: 'option' }>,
  ctx: WidgetFillContext, origin?: ValueOrigin): Promise<BridgeAttempt> {
  const widget = target.widget;
  const known = knownLabels(target);
  const before = widget === undefined ? [] : chosenLabels(widget, known);
  const fallback: BridgeAttempt = { kind: 'fallback', sent: false, before };
  if (widget === undefined || widget.kind !== 'combobox' || widget.bridge !== 'react-select' || !isActionable(widget)) {
    return fallback;
  }
  if (target.field.disabled || target.field.readOnly || target.field.options === 'lazy') return fallback;
  const planned = target.field.options[value.index];
  if (planned === undefined || planned.disabled || !sameOptionLabel(planned.label, value.cleanLabel)) return fallback;
  // R1 on the reading the frame holds: the bridge opens no list.
  if (!originAllows(origin, value, target.field.options)) return fallback;
  if (showsOption(widget, known, planned.label)) return fallback;
  const choice = await bridgeChoose(widget, { label: cleanOptionLabel(planned.label), shown: planned.label }, false,
    ctx);
  // s2 lists: why the bridge did nothing, so a command refused before the page's React attached may be sent again.
  if (choice.status === 'refused') return { ...fallback, reason: choice.reason };
  if (choice.status !== 'sent' && choice.status !== 'chosen') return fallback;
  if (await afterBridge(widget, ctx, () => showsOption(widget, known, planned.label))) {
    return { kind: 'done', outcome: done(true, 'ok') };
  }
  // Something else shows chosen now: written, not verified, and no event follows it.
  if (!sameChosen(chosenLabels(widget, known), before)) return { kind: 'done', outcome: mismatch('verify-mismatch') };
  return { kind: 'fallback', sent: true, before };
}

/** The events' path's outcome after the bridge said it chose and nothing read back: never "nothing written", since
 *  React may hold the choice. An option shown is written; anything else is written but not verified. */
function afterSent(outcome: FillOutcome): FillOutcome {
  if (outcome.wrote) return outcome;
  return outcome.verification === 'verified' ? done(true, 'ok') : mismatch('verify-mismatch');
}

/** Chooses the planned option of a combobox (see the header): through the bridge first, unless this write has had its
 *  command already (ctx.bridgeTried), then by its events. */
export async function chooseOption(target: FieldTarget, value: Extract<WriteValue, { kind: 'option' }>,
  ctx: WidgetFillContext, origin?: ValueOrigin): Promise<FillOutcome> {
  const widget = target.widget!;
  const known = knownLabels(target);
  const planned = target.field.options === 'lazy' ? undefined : target.field.options[value.index];
  if (planned === undefined || !sameOptionLabel(planned.label, value.cleanLabel)) return refused('options-changed');
  const tried = ctx.bridgeTried;
  if (showsOption(widget, known, planned.label)) {
    return tried?.sent === true ? done(true, 'ok') : done(false, 'already-correct');
  }
  let sent = tried?.sent === true;
  let before = tried?.before ?? chosenLabels(widget, known);
  if (tried === undefined) {
    const attempt = await chooseThroughBridge(target, value, ctx, origin);
    if (attempt.kind === 'done') return attempt.outcome;
    sent = attempt.sent;
    before = attempt.before;
  }
  const outcome = await chooseByEvents(target, value, ctx, origin, known, before);
  return sent ? afterSent(outcome) : outcome;
}

/** The events' path of chooseOption (see the header), from a fresh read of the list; `before` is what the widget
 *  showed chosen before the write began. */
async function chooseByEvents(target: FieldTarget, value: Extract<WriteValue, { kind: 'option' }>,
  ctx: WidgetFillContext, origin: ValueOrigin | undefined, known: readonly string[], before: readonly string[]):
  Promise<FillOutcome> {
  const widget = target.widget!;
  // s2 lists: a stored list's option is chosen at once (chooseKnown); an llm-pick is checked on a whole read, as ever.
  if (widget.knownOptions !== undefined && origin?.provenance !== 'llm-pick') {
    return chooseKnown(target, value, ctx, known, before);
  }
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
  const option = await revealOption(opened.listbox, fresh, { signal: ctx.signal, labelOf: widget.optionLabel,
    drawnWhole: widget.drawnWhole === true });
  if (ctx.signal?.aborted) {
    await closeList(widget, closingContext(ctx), opened);
    return refused('internal-error');
  }
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
  // Clicked: the choice stands even when the person's Skip ended the wait, its list closed on the tidy context.
  await closeList(widget, closingContext(ctx), opened);
  const after = chosenLabels(widget, [...known, fresh.label]);
  if (after.some((label) => shownIdentity(label) === shownIdentity(fresh.label))) return done(true, 'ok');
  if (after.length === before.length && after.every((label, at) => label === before[at])) return clickedUnshown(ctx);
  return mismatch('verify-mismatch');
}

/**
 * s2 lists (decision 1, the owner's "select at once"): the planned option of a stored list (WidgetTarget.knownOptions,
 * the field's options while the run has no reading of it) chosen with one opening of its list: the option at its
 * planned place found by its label as the page shows it (known.ts findKnown: one query, and the list scrolled to it
 * when it scrolls), clicked through assertNotSubmit, the list closed, and the widget read back as chooseByEvents reads
 * it. A list that holds no such option there is not the stored one: it is read whole as before (a list drawn whole
 * without a wait), that read kept as the field's reading (and learned, where it may be), and nothing is chosen
 * (options-changed): the next pass plans the field from what the page showed.
 */
async function chooseKnown(target: FieldTarget, value: Extract<WriteValue, { kind: 'option' }>, ctx: WidgetFillContext,
  known: readonly string[], before: readonly string[]): Promise<FillOutcome> {
  const widget = target.widget!;
  const planned = target.field.options === 'lazy' ? undefined : target.field.options[value.index];
  if (planned === undefined) return refused('options-changed');
  const skipped = async (activated: boolean): Promise<FillOutcome> => {
    const tidy = skipTidyContext(ctx);
    if (tidy !== null) await closeList(widget, tidy, { activated });
    return refused('internal-error');
  };
  const opened = await openList(widget, ctx);
  if (!opened.open) {
    if (opened.reason === 'aborted') return skipped(true);
    return refused(opened.reason === 'no-list' ? 'widget-unsupported' : opened.reason === 'gone' ? 'element-not-found'
      : 'needs-your-click');
  }
  const wait = await awaitList(widget, ctx, { prevHash: null, capMs: OPTIONS_CAP_MS, emptyAfterMs: WIDGET_EMPTY_AFTER_MS });
  if (wait.status === 'aborted') return skipped(opened.activated);
  const option = await findKnown(opened.listbox, { label: planned.label, index: value.index }, widget,
    () => drawnView(opened.listbox, ctx.signal));
  if (ctx.signal?.aborted) return skipped(opened.activated);
  if (option === null || option.disabled || !sameOptionLabel(option.label, value.cleanLabel)) {
    const read = await readList(opened.listbox, { signal: ctx.signal, labelOf: widget.optionLabel,
      option: widget.results?.option, drawnWhole: widget.drawnWhole === true });
    if (ctx.signal?.aborted) return skipped(opened.activated);
    remember(ctx, target.field.baseKey, read, opened.listbox, widget, target);
    await closeList(widget, ctx, opened);
    return refused('options-changed');
  }
  if (!assertNotSubmit(option.el, ctx).ok) {
    await closeList(widget, ctx, opened);
    return refused('needs-your-click');
  }
  (option.el as HTMLElement).click();
  await afterAction(widget, ctx);
  // Clicked: the choice stands even when the person's Skip ended the wait, its list closed on the tidy context.
  await closeList(widget, closingContext(ctx), opened);
  const after = chosenLabels(widget, [...known, planned.label]);
  if (after.some((label) => shownIdentity(label) === shownIdentity(planned.label))) return done(true, 'ok');
  if (after.length === before.length && after.every((label, at) => label === before[at])) return clickedUnshown(ctx);
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
    // React first (see the header): the bridge adds it as react-select's own choice does. Its word decides whether the
    // events below may run for it: never after it said it chose, or that the option was chosen already.
    if (widget.bridge === 'react-select' && !options[item.index]!.disabled) {
      const held = chosenLabels(widget, known);
      const choice = await bridgeChoose(widget, { label: cleanOptionLabel(item.label), shown: item.label }, true, ctx);
      if (choice.status === 'chosen') {
        stopped = mismatch('verify-mismatch');
        break;
      }
      if (choice.status === 'sent') {
        const shown = await afterBridge(widget, ctx, () => showsOption(widget, known, item.label));
        if (!within(chosenLabels(widget, known), [...held, item.label])) {
          stopped = mismatch('unexpected-selection');
          break;
        }
        if (!shown) {
          stopped = mismatch('verify-mismatch');
          break;
        }
        added += 1;
        continue;
      }
    }
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
    const option = await revealOption(opened.listbox, fresh, { signal: ctx.signal, labelOf: widget.optionLabel,
      drawnWhole: widget.drawnWhole === true });
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
      stopped = clickedUnshown(ctx);
      break;
    }
    added += 1;
    // The person's Skip: what was added stands, and no more is.
    if (ctx.signal?.aborted) break;
  }
  await closeList(widget, closingContext(ctx), { activated });
  const after = chosenLabels(widget, known);
  const isChosenNow = (label: string) => after.some((chosen) => shownIdentity(chosen) === shownIdentity(label));
  if (before.some((label) => !isChosenNow(label))) return mismatch('unexpected-selection');
  // Nothing beyond what it held and what was planned: the bridge, or the page, chose no more than asked.
  if (stopped?.reason === 'unexpected-selection' || !within(after, [...before, ...wanted.map((item) => item.label)])) {
    return mismatch('unexpected-selection');
  }
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
  return isChosen(member) ? done(true, 'ok') : clickedUnshown(ctx);
}

/** An option or a member clicked that the widget does not show chosen yet: one that ignores our events is
 *  needs-your-click; but when the person's Skip ended the wait for it (the audit of 2026-11-06, m11), the page may yet
 *  take the click, so it is written and not verified (verify-mismatch), read back after the settle, never the person's
 *  skipped field the page holds our value in. */
function clickedUnshown(ctx: WidgetFillContext): FillOutcome {
  return ctx.signal?.aborted === true ? mismatch('verify-mismatch') : refused('needs-your-click');
}
