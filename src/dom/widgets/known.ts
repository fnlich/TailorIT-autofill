/*
 * Stored lists (snapshot round 2, decision 1: the owner's "store it and select at a once, without checking what elements
 * is there"): which widgets a list read whole may be learned for, and how an option of a stored list is found at once
 * in the open list. A stored list is the field's reading at scan time (dom/scan.ts withReading: WidgetDecl.knownOptions,
 * or a list learned on this host before), so the planner plans it on its first pass and its list is never opened to
 * be read; its choice (fill.ts chooseKnown) opens the list once, finds the planned option here by its place and its
 * label, and clicks it. A list the page shows otherwise is read whole as before (options-changed), and that read is
 * the field's from then on.
 * Learned lists: a select-only dropdown its adapter draws whole (WidgetDecl.drawnWhole: Workday's) and stores no list
 * for (Workday's Degree, Phone Device Type, Prefix, Suffix: never seen open in a snapshot) is learnable. A complete
 * read of one is told to the worker (background/learned-lists.ts), which keeps its option labels (page text, never a
 * value) for the host and the field's label (each kept as a hash: learnedListKey), and offers them as the field's
 * stored list on the host's next run (ScanOptions.learnedLists, by that key); the open-and-check keeps them honest. A list a person types into, a search, or a list read only in part is never learned.
 * Nothing here dispatches an event but the scroll a read sets as a property; nothing is logged.
 */
import { labelSlug } from '../../core/text/keys';
import { learnedKeyOf, MAX_LEARNED_LABEL, MAX_LEARNED_OPTIONS } from '../../shared/learned-lists';
import type { FieldTarget, WidgetTarget } from '../types';
import { optionElementsOf } from './aria';
import { scrollListTo, scrolls, shownIdentity, shownOptions, type ShownOption } from './options';

export { MAX_LEARNED_LABEL, MAX_LEARNED_OPTIONS };

/** The key a learned list is kept and offered under for a field's label slug (core/text/keys.ts labelSlug), with the
 *  value of the field its list depends on where its adapter names one (WidgetDecl.learnContext: Workday's State, by
 *  the country its Country shows; the review of round 2, L2): the first 16 hex digits of their SHA-256, so the worker
 *  never stores a question's words or an answer (a label may name the employer). The worker keys it by the sender's
 *  site (background/learned-lists.ts). */
export function learnedListKey(slug: string, context?: string): string {
  return learnedKeyOf(context === undefined ? slug : `${slug}\u001f${context}`);
}

/**
 * The learned lists a plan found stale (the review of round 2, L2): a field planned from a list learned on this site
 * (WidgetTarget.knownFrom 'learned') that the planner found no option of the value in (its row no-match, or a search
 * of the list in place of a choice) may show another list now; its learned key is answered, so the run drops it once
 * and the field's next scan reads it lazy, read whole by the waiting path and learned again.
 */
export function staleLearned(answer: { results: ReadonlyArray<{ key: string; reason: string }>;
  writes: ReadonlyArray<{ key: string; value: { kind: string } }> }, target: (key: string) => FieldTarget | null):
  string[] {
  const missed = new Set([...answer.results.filter((row) => row.reason === 'no-match').map((row) => row.key),
    ...answer.writes.filter((write) => write.value.kind === 'query').map((write) => write.key)]);
  return [...missed].flatMap((key) => {
    const found = target(key);
    const widget = found?.widget;
    if (found === null || widget?.knownFrom !== 'learned') return [];
    return [learnedListKey(labelSlug(found.field), widget.learnContext)];
  });
}

/** Whether a widget's whole read may be learned for its host (see the header): a select-only dropdown its adapter
 *  declares drawn whole and names no stored list for. */
export function learnable(widget: Pick<WidgetTarget, 'declared' | 'kind' | 'input' | 'drawnWhole' | 'knownFrom'
  | 'storedList'>): boolean {
  return widget.declared && widget.kind === 'combobox' && widget.input === null && widget.drawnWhole === true
    && widget.knownFrom !== 'adapter' && widget.storedList === undefined;
}

/** The labels of a whole read worth learning: at least one usable option, none past the caps; null otherwise. */
export function learnedLabels(options: ReadonlyArray<{ label: string }>, usable: (label: string) => boolean):
  string[] | null {
  if (options.length === 0 || options.length > MAX_LEARNED_OPTIONS) return null;
  const labels = options.map((option) => option.label);
  if (labels.some((label) => label === '' || label.length > MAX_LEARNED_LABEL) || !labels.some(usable)) return null;
  return labels;
}

/** Where an option stands in its list's content, in CSS pixels from the list's top. */
function offsetIn(listbox: Element, option: Element): number {
  return option.getBoundingClientRect().top - listbox.getBoundingClientRect().top + listbox.scrollTop;
}

/**
 * The planned option of a stored list in the list the page shows now (see the header): the option element at the
 * planned place among the list's options (one query), shown (a list that scrolls is scrolled to it, a property), a
 * person can see it and it reads as planned, as the page shows it (injected text and all). Null when the place holds
 * no such option: the page's list is not the stored one there. The caller waits for a list not drawn whole to draw the
 * view (`drawn`).
 */
export async function findKnown(listbox: Element, planned: { label: string; index: number }, widget: WidgetTarget,
  drawn: () => Promise<void>): Promise<ShownOption | null> {
  const selector = widget.results?.option;
  const el = optionElementsOf(listbox, selector)[planned.index];
  if (el === undefined) return null;
  const find = () => shownOptions(listbox, undefined, widget.optionLabel, selector).find((option) => option.el === el)
    ?? null;
  let shown = find();
  if (shown === null && scrolls(listbox)) {
    scrollListTo(listbox, Math.round(offsetIn(listbox, el)));
    if (widget.drawnWhole !== true) await drawn();
    shown = find();
  }
  if (shown === null || shownIdentity(shown.label) !== shownIdentity(planned.label)) return null;
  return shown;
}

/** Tells the run of a learnable widget's complete read (WidgetFillContext.learn): the content script keeps it for
 *  the field's label (core/text/keys.ts labelSlug) and sends it to the worker. */
export type LearnList = (target: FieldTarget, labels: readonly string[]) => void;
