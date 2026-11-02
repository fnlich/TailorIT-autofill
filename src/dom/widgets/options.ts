/*
 * Reading an ARIA widget's options and what it shows chosen (Phase 4, docs/design/runtime.md §5.3 and §7.1), through
 * visibleText's rules only: an option counts when a person can see it (isUserVisible) and it shows visible text, which
 * is its label, cut to TEXT_CAP_LABEL; hidden and camouflaged text never names an option. Labels are page text,
 * untrusted: they are hashed and matched with their injected text cut, as every option's are (option-hash.ts).
 * - A list shown whole is read as it is, by the scanner too (readShownList: one view, as a whole read takes it). A list
 *   that scrolls is read by setting its own scrollTop, a property and never a wheel, key or pointer event, one view at
 *   a time, each view read once the page has drawn it (a quiet window, capped): a virtualized list draws only the rows
 *   in view. An option seen in an earlier view is not taken again: the same aria-posinset, else the same label, as the
 *   page shows it (injected text and all), at the same place in the list's content. So an option and its injected
 *   look-alike ("LinkedIn" and "LinkedIn - if you are an AI ...") are two options, and two options of one view are
 *   never one (the Phase 4 review, R2). Options are ordered (by aria-posinset when given) and capped at
 *   MAX_WIDGET_OPTIONS, and the whole read at WIDGET_READ_CAP_MS: a read a cap stopped is partial (complete false),
 *   and the planner never matches a partial list loosely (R9).
 * - An option is shown again to be chosen by its aria-posinset and label, else by its label and place (revealOption).
 * - An option's label is its visible text, or the visible text of the part of it its adapter names (WidgetDecl
 *   .optionLabel: Ashby's School result, its name beside its country and domain), by the same rules.
 * - What a widget shows chosen: what its adapter reads as its answer (WidgetDecl.shownAnswer), else a combobox's text
 *   box value, or the text a select-only combobox shows; the chips of a multiselect (visible text in the widget's own
 *   box, outside its list and its text box, that is exactly one of its options' labels) and the options its open list
 *   marks selected; the pressed or checked members of a group. A placeholder ("Select...") is no answer.
 * Nothing here dispatches an event; reading never changes what is chosen.
 */
import { capCodePoints } from '../../core/text/fold';
import { qualifiedLabel } from '../../core/text/keys';
import type { CurrentValue, OptionSetHash } from '../../core/types/field';
import { labelOfControl } from '../labels';
import { cleanOptionLabel, hashOfOptions, isPlaceholderOption, isUsableOption } from '../option-hash';
import { newScanCache, type ScanCache } from '../scan-cache';
import { BUSY_ELEMENTS, busySignOf, isLoadingOptionLabel, quietWait } from '../settle';
import {
  MAX_SELECTED_LABELS, MAX_WIDGET_OPTIONS, MAX_WIDGET_SCROLLS, TEXT_CAP_CURRENT, TEXT_CAP_LABEL, WIDGET_READ_CAP_MS,
  WIDGET_SCROLL_CAP_MS, WIDGET_SCROLL_QUIET_MS, WIDGET_SCROLL_SETTLE_MS,
} from '../thresholds';
import { monotonicNow } from '../time';
import type { OptionLabel, WidgetKind, WidgetOptionRead, WidgetTarget } from '../types';
import { readVisibleText, visibleText, visibleTextWithout } from '../visible-text';
import { isUserVisible } from '../visibility';
import { isChosen, isUnavailable, listOf, optionElementsOf, widgetBox } from './aria';

/** One option a person can see in a widget's list now. Page content: untrusted. */
export interface ShownOption extends WidgetOptionRead {
  el: Element;
  selected: boolean;
  /** Its aria-posinset (1-based), when the list gives one: its place in a list drawn a part at a time. */
  position: number | null;
  /** Its top in the list's content, in CSS pixels (its top in view plus the list's scrollTop): the same in every view
   *  of a list that scrolls, so it tells one option from another of the same label. */
  offset: number;
}

/** An option of a whole read: where the list was scrolled to when it showed, so it can be shown again to be chosen. */
export interface ReadOption extends WidgetOptionRead {
  position: number | null;
  scrollTop: number;
  offset: number;
}

/** A widget's list read whole (or as far as the caps allow). */
export interface ListRead {
  options: ReadOption[];
  /** False when a cap stopped the read before the list's end. */
  complete: boolean;
}

/** A label as compared: injected text cut, qualified and normalized, as the option-set hash compares labels. */
export function labelIdentity(label: string): string {
  return qualifiedLabel(cleanOptionLabel(label));
}

/** A label as the page shows it, qualified and normalized, injected text kept: an option and its injected look-alike
 *  differ by it. */
export function shownIdentity(label: string): string {
  return qualifiedLabel(label);
}

/** Two option places this close in a list's content are one place: a page can draw a row half a pixel off. */
const SAME_PLACE_PX = 2;

function positionOf(el: Element): number | null {
  const raw = (el.getAttribute('aria-posinset') ?? '').trim();
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return value >= 1 ? value : null;
}

/** The options of a list a person can see now, in document order, each labelled by its visible text (or its part's
 *  that `labelOf` names). */
export function shownOptions(listbox: Element, cache: ScanCache = newScanCache(), labelOf?: OptionLabel): ShownOption[] {
  if (!isUserVisible(listbox, cache)) return [];
  const shown: ShownOption[] = [];
  const top = listbox.getBoundingClientRect().top - listbox.scrollTop;
  for (const el of optionElementsOf(listbox)) {
    if (!isUserVisible(el, cache)) continue;
    const part = labelOf?.(el) ?? null;
    const named = part !== null && el.contains(part) ? part : el;
    const label = capCodePoints(visibleText(named, { singleLine: true, cap: TEXT_CAP_LABEL, cache }), TEXT_CAP_LABEL);
    if (label === '') continue;
    shown.push({ el, label, disabled: isUnavailable(el), selected: isChosen(el), position: positionOf(el),
      offset: Math.round(el.getBoundingClientRect().top - top) });
  }
  return shown;
}

/** Whether a shown option is one an earlier view of the read took: its aria-posinset, else its label as shown at its
 *  place in the list's content. */
function sameOption(known: Pick<ReadOption, 'label' | 'position' | 'offset'>,
  option: Pick<ShownOption, 'label' | 'position' | 'offset'>): boolean {
  if (known.position !== null && option.position !== null) {
    return known.position === option.position && shownIdentity(known.label) === shownIdentity(option.label);
  }
  return known.label === option.label && Math.abs(known.offset - option.offset) <= SAME_PLACE_PX;
}

/** Takes the options of the view shown now into `found`, those an earlier view took aside; false once the option cap
 *  stops it. */
function takeView(listbox: Element, found: ReadOption[], cache?: ScanCache, labelOf?: OptionLabel): boolean {
  const at = listbox.scrollTop;
  const earlier = found.length;
  for (const option of shownOptions(listbox, cache, labelOf)) {
    let seen = false;
    for (let index = 0; index < earlier && !seen; index += 1) seen = sameOption(found[index]!, option);
    if (seen) continue;
    if (found.length >= MAX_WIDGET_OPTIONS) return false;
    found.push({ label: option.label, disabled: option.disabled, position: option.position, scrollTop: at,
      offset: option.offset });
  }
  return true;
}

/** A read's options in their order: by aria-posinset when every one gives it, else as they were found. */
function ordered(found: ReadOption[]): ReadOption[] {
  if (found.length > 0 && found.every((option) => option.position !== null)) {
    return [...found].sort((a, b) => a.position! - b.position!);
  }
  return found;
}

/** A list shown whole read as it is now, exactly as readList takes its first view: what the scanner gives a widget
 *  whose list shows whole, so its options' places are the ones a fill reads again. */
export function readShownList(listbox: Element, cache: ScanCache = newScanCache(), labelOf?: OptionLabel): ListRead {
  const found: ReadOption[] = [];
  const complete = takeView(listbox, found, cache, labelOf);
  return { options: ordered(found), complete };
}

/** Whether a list scrolls: more of it than its box shows. */
export function scrolls(listbox: Element): boolean {
  return listbox.scrollHeight > listbox.clientHeight + 1;
}

/**
 * Waits for the page to draw a list after its scrollTop was set: a quiet window on the list once it has changed (a
 * virtualized list draws the rows now in view, in answer to the scroll event the browser fires on its next frame), or
 * WIDGET_SCROLL_SETTLE_MS when it does not change (a list drawn whole), at most WIDGET_SCROLL_CAP_MS.
 */
async function drawn(listbox: Element, signal: AbortSignal | undefined): Promise<void> {
  const view = listbox.ownerDocument.defaultView as (Window & typeof globalThis) | null;
  if (view === null) return;
  const started = monotonicNow();
  let changed = false;
  const wait = quietWait<true>({ view, quietMs: WIDGET_SCROLL_QUIET_MS, capMs: WIDGET_SCROLL_CAP_MS, signal,
    aborted: true, atQuiet: () => (changed || monotonicNow() - started >= WIDGET_SCROLL_SETTLE_MS ? true : null),
    atCap: () => true, onPageRecords: () => {
      changed = true;
    } });
  wait.observe(listbox);
  await wait.done;
}

/** Sets a list's own scrollTop: a property, never a wheel, key or pointer event. */
export function scrollListTo(listbox: Element, top: number): void {
  listbox.scrollTop = Math.max(0, top);
}

/**
 * Reads every option of a list (see the header): the options shown now, then, for a list that scrolls, each view from
 * its top to its end, within `capMs` (WIDGET_READ_CAP_MS) in all: a hostile list could otherwise hold a read for a
 * minute and more. A list the page empties or removes while it is read ends the read where it is.
 */
export async function readList(listbox: Element,
  options: { signal?: AbortSignal; capMs?: number; labelOf?: OptionLabel } = {}): Promise<ListRead> {
  const started = monotonicNow();
  const capMs = options.capMs ?? WIDGET_READ_CAP_MS;
  const found: ReadOption[] = [];
  let complete = true;
  if (scrolls(listbox) && listbox.scrollTop > 0) {
    scrollListTo(listbox, 0);
    await drawn(listbox, options.signal);
  }
  complete = takeView(listbox, found, undefined, options.labelOf);
  for (let steps = 0; complete && scrolls(listbox) && listbox.isConnected; steps += 1) {
    if (options.signal?.aborted) break;
    const before = listbox.scrollTop;
    const end = listbox.scrollHeight - listbox.clientHeight;
    if (before >= end - 1) break;
    if (steps >= MAX_WIDGET_SCROLLS || monotonicNow() - started >= capMs) {
      complete = false;
      break;
    }
    // One view at a time, a row's height of overlap kept, so no option falls between two views.
    scrollListTo(listbox, Math.min(end, before + Math.max(1, listbox.clientHeight - 8)));
    await drawn(listbox, options.signal);
    if (listbox.scrollTop <= before) break;
    complete = takeView(listbox, found, undefined, options.labelOf);
  }
  return { options: ordered(found), complete };
}

/** The option-set hash of a widget's options: the scanner's own, over the same labels. */
export function hashOfRead(options: readonly WidgetOptionRead[]): OptionSetHash {
  return hashOfOptions(options.map((option) => option.label));
}

/**
 * Shows the option a read took and returns its element: its aria-posinset and label, else its label (as the page shows
 * it, injected text and all) at its place in the list's content, among the options shown now, else after scrolling the
 * list back to where the read saw it. Null when it is not there any more.
 */
export async function revealOption(listbox: Element, wanted: Pick<ReadOption, 'label' | 'position' | 'scrollTop' | 'offset'>,
  options: { signal?: AbortSignal; labelOf?: OptionLabel } = {}): Promise<ShownOption | null> {
  const find = () => shownOptions(listbox, undefined, options.labelOf).find((option) => sameOption(wanted, option)) ?? null;
  const now = find();
  if (now !== null || !scrolls(listbox)) return now;
  scrollListTo(listbox, wanted.scrollTop);
  await drawn(listbox, options.signal);
  return find();
}

/**
 * A fresh read of a list kept beside the field's earlier reading (the Phase 4 review, R5): an option the earlier
 * reading had that the list no longer shows, but that the widget shows chosen (a chip, from a list that hides what is
 * chosen), stays at its place, so its chip is still recognised and the places planned from the earlier reading still
 * hold. Every other option is the fresh read's.
 */
export function withChosenKept(earlier: readonly WidgetOptionRead[] | null, fresh: readonly WidgetOptionRead[],
  chosen: readonly string[]): WidgetOptionRead[] {
  if (earlier === null || earlier.length === 0) return [...fresh];
  const shown = new Set(chosen.map(shownIdentity));
  const inFresh = new Set(fresh.map((option) => shownIdentity(option.label)));
  const kept = new Set(earlier.filter((option) => !inFresh.has(shownIdentity(option.label))
    && shown.has(shownIdentity(option.label))));
  if (kept.size === 0) return [...fresh];
  const out: WidgetOptionRead[] = [];
  let at = 0;
  for (const option of earlier) {
    if (kept.has(option)) {
      out.push(option);
      continue;
    }
    const found = fresh.findIndex((candidate, index) => index >= at
      && shownIdentity(candidate.label) === shownIdentity(option.label));
    if (found < 0) continue;
    out.push(...fresh.slice(at, found + 1));
    at = found + 1;
  }
  out.push(...fresh.slice(at));
  return out;
}

// ── A list's state, as awaitOptions reads a native list's ───────────────────────────────────────────────────────────

/** Why a widget's list is not ready (awaitOptions' reasons, for a listbox). */
export type ListState =
  | { ready: true; optionSetHash: OptionSetHash }
  | { ready: false; waiting: 'gone' | 'hidden' | 'busy' | 'loading' | 'placeholders' | 'unchanged' };

/** A visible aria-busy or indeterminate progress bar at or inside any of `scopes`. */
export function busyIn(scopes: readonly (Element | null)[], cache: ScanCache = newScanCache()): boolean {
  return scopes.some((scope) => scope !== null && [scope, ...Array.from(scope.querySelectorAll(BUSY_ELEMENTS))]
    .some((el) => busySignOf(el) !== null && isUserVisible(el, cache)));
}

/** Where a widget's own busy signs show: its list and its own box (widgetBox). */
export function busyScopes(widget: WidgetTarget, listbox: Element | null): Element[] {
  const box = widgetBox(widget.element, widget.input, listbox);
  return listbox === null ? [box] : [listbox, box];
}

/** Whether a widget shows a busy sign of its own now: a visible aria-busy or indeterminate progress bar in its list or
 *  its own box, or one of the busy signs its adapter declared (WidgetDecl.busy: react-select's "Loading..." notice and
 *  its loading dots) drawn there. */
export function widgetBusy(widget: WidgetTarget, listbox: Element | null, cache: ScanCache = newScanCache()): boolean {
  const scopes = busyScopes(widget, listbox);
  return busyIn(scopes, cache) || declaredBusy(scopes, widget.busy ?? []);
}

/** One of the adapter's busy signs, drawn in any of `scopes`. A sign only makes a wait longer, never a write, so it
 *  counts once it has a box and is not hidden by display or visibility: react-select's loading dots are aria-hidden. */
function declaredBusy(scopes: readonly Element[], selectors: readonly string[]): boolean {
  if (selectors.length === 0) return false;
  const selector = selectors.join(', ');
  return scopes.some((scope) => [scope, ...Array.from(scope.querySelectorAll(selector))]
    .some((el) => el.matches(selector) && hasBox(el)));
}

/** An element with a box, not hidden by display or visibility. */
function hasBox(el: Element): boolean {
  if (typeof el.checkVisibility === 'function') return el.checkVisibility({ visibilityProperty: true });
  return el.getClientRects().length > 0;
}

/** A widget's list right now (OPTIONS_WAITING's order, as optionsState reads a select): ready with the hash of its
 *  options, or what it still waits for. */
export function listState(widget: WidgetTarget, prevHash: OptionSetHash | null, cache: ScanCache = newScanCache()):
  ListState {
  const listbox = listOf(widget.element, widget.input);
  if (listbox === null || !listbox.isConnected) return { ready: false, waiting: 'gone' };
  if (!isUserVisible(listbox, cache)) return { ready: false, waiting: 'hidden' };
  if (widgetBusy(widget, listbox, cache)) return { ready: false, waiting: 'busy' };
  const labels = shownOptions(listbox, cache, widget.optionLabel).map((option) => option.label);
  if (labels.some(isLoadingOptionLabel)) return { ready: false, waiting: 'loading' };
  if (!labels.some(isUsableOption)) return { ready: false, waiting: 'placeholders' };
  const hash = hashOfOptions(labels);
  if (prevHash !== null && hash === prevHash) return { ready: false, waiting: 'unchanged' };
  return { ready: true, optionSetHash: hash };
}

// ── What a widget shows chosen ──────────────────────────────────────────────────────────────────────────────────────

/** A label that names an answer: not empty, not a placeholder. */
function isAnswer(label: string): boolean {
  const clean = cleanOptionLabel(label).trim();
  return clean !== '' && !isPlaceholderOption(clean);
}

/** The text a combobox shows as its value: its text box's value, or the visible text of a select-only combobox (its
 *  open list left out). '' for none: a combobox that draws its value beside an emptied text box (as react-select does)
 *  shows it in its box, where chipsOf finds it. */
export function shownValueOf(widget: WidgetTarget, cache: ScanCache = newScanCache()): string {
  if (widget.input !== null) return capCodePoints(widget.input.value.replace(/\s+/g, ' ').trim(), TEXT_CAP_CURRENT);
  const listbox = listOf(widget.element, null);
  const inside = listbox !== null && widget.element.contains(listbox) ? [listbox] : [];
  const text = inside.length === 0
    ? visibleText(widget.element, { singleLine: true, cap: TEXT_CAP_LABEL, cache })
    : visibleTextWithout(widget.element, inside, { singleLine: true, cap: TEXT_CAP_LABEL, cache });
  return text;
}

/** The chips of a multiselect, or the value an editable combobox draws beside its text box: visible text in its own
 *  box, outside its list, its text box and its label, that is one of `known` labels exactly. */
function chipsOf(widget: WidgetTarget, known: (text: string) => string | undefined, cache: ScanCache): string[] {
  const listbox = listOf(widget.element, widget.input);
  const box = widgetBox(widget.element, widget.input, listbox);
  const label = labelOfControl(widget.input ?? widget.element, { cache, adapter: null }).element;
  const outside = [listbox, label].filter((el): el is Element => el !== null);
  const found: string[] = [];
  for (const segment of readVisibleText(box, { cache }).segments) {
    if (outside.some((el) => el.contains(segment.parent))) continue;
    const named = known(segment.text);
    if (named !== undefined && !found.includes(named)) found.push(named);
  }
  return found;
}

/**
 * The labels a widget shows chosen now (see the header), each written as `known` writes it when it is one of them
 * (the options of its field). A combobox's shown value counts even when it is no known option (the page's own
 * answer, or what a person typed); a chip only when it is one.
 */
export function chosenLabels(widget: WidgetTarget, known: readonly string[], cache: ScanCache = newScanCache()):
  string[] {
  // A label is the option it shows as (injected text and all) before it is the option its clean part names: when an
  // option and its injected look-alike share a clean part, the one shown is the one chosen (the Phase 4 review, R2).
  const byShown = new Map(known.map((label) => [shownIdentity(label), label] as const));
  const byIdentity = new Map<string, string>();
  for (const label of known) if (!byIdentity.has(labelIdentity(label))) byIdentity.set(labelIdentity(label), label);
  const knownAs = (label: string) => byShown.get(shownIdentity(label)) ?? byIdentity.get(labelIdentity(label));
  const named = (label: string) => knownAs(label) ?? label;
  let labels: string[];
  switch (widget.kind) {
    case 'radio':
      labels = widget.members.filter(isChosen).map((member) => named(memberLabel(member, cache)));
      break;
    case 'multiselect': {
      const listbox = listOf(widget.element, widget.input);
      const selected = listbox === null ? [] : shownOptions(listbox, cache, widget.optionLabel).filter((option) => option.selected)
        .map((option) => named(option.label));
      labels = [...new Set([...chipsOf(widget, knownAs, cache), ...selected])];
      break;
    }
    default: {
      // The answer an adapter reads where the widget draws it (WidgetDecl.shownAnswer: beside an emptied text box, or as
      // a flag), else the widget's own text.
      const shown = widget.shownAnswer?.(known) ?? shownValueOf(widget, cache);
      labels = shown !== '' ? [named(shown)] : widget.input === null ? [] : chipsOf(widget, knownAs, cache).slice(0, 1);
    }
  }
  return labels.filter(isAnswer).slice(0, MAX_SELECTED_LABELS);
}

/** What a widget field holds, as the scanner and the read-back after a write both read it: the labels it shows chosen,
 *  or empty. Memory only. */
export function widgetCurrentValue(widget: WidgetTarget, known: readonly string[], cache: ScanCache = newScanCache()):
  CurrentValue {
  const labels = chosenLabels(widget, known, cache);
  return labels.length === 0 ? { kind: 'empty' } : { kind: 'selected', labels };
}

/** The visible label of a group's member (a radio or a toggle button), as the scanner reads it. */
export function memberLabel(member: Element, cache: ScanCache = newScanCache()): string {
  return visibleText(member, { singleLine: true, cap: TEXT_CAP_LABEL, cache });
}

/** Whether a widget kind reads its options from a list (all but a group). */
export function hasList(kind: WidgetKind): boolean {
  return kind !== 'radio';
}
