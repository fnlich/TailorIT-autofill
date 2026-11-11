/*
 * jr6 ENGINE E3 (FIXPLAN §6.2 item 13; §3.1 item 5: U-05, WD-18): what a box of several answers holds, as its adapter
 * declares it (WidgetDecl.tags, WidgetTarget.tags): its values as the planner joined them, its chips as a person reads
 * them, and whether it holds a planned text. The tags filler (tags.ts) writes it; the scanner (dom/scan.ts), the
 * read-back (options.ts widgetCurrentValue, hold.ts widgetHolds, fillers/verify.ts) and the press's count of required
 * questions left (content/press.ts requiredLeftOf) read it here.
 * - The planned text is the planner's (core/resolver/values.ts manyValues): the person's values joined with
 *   MANY_SEPARATOR (RULES R0). tagValues splits it again: each value trimmed, an empty one dropped, and a value repeated
 *   (white space collapsed, in any case) kept once.
 * - A chip's words are what a person sees of it (visibleText, one line). A value shows as a chip when one chip's words
 *   are the value, white space collapsed and in any case. A hook that throws shows no chip.
 * - The field holds what its text box holds (tagsBoxValue), as a text field does: a box whose chips show the answers
 *   and whose box is empty reads empty, so the planner plans every value and the filler adds only what is missing; the
 *   press counts the box answered while it shows a chip (tagsShowChip).
 * Values stay in memory: nothing here logs or sends one.
 */
import type { WidgetTags } from '../../adapters/types';
import { MANY_SEPARATOR } from '../../core/resolver/values';
import type { CurrentValue } from '../../core/types/field';
import { TEXT_CAP_LABEL } from '../thresholds';
import type { WidgetTarget } from '../types';
import { currentValueOf } from '../values';
import { visibleText } from '../visible-text';

/** A value or a chip's words as compared: white space collapsed, any case. */
export const tagIdentity = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** The values of a planned text (see the header), in order. */
export function tagValues(text: string): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const part of text.split(MANY_SEPARATOR)) {
    const value = part.trim();
    const identity = tagIdentity(value);
    if (identity === '' || seen.has(identity)) continue;
    seen.add(identity);
    values.push(value);
  }
  return values;
}

/** The chips a box shows now (WidgetTags.chips), each a page element; none when its hook throws or answers otherwise. */
export function chipsOf(tags: WidgetTags): Element[] {
  try {
    const chips = tags.chips();
    return Array.isArray(chips) ? chips.filter((chip): chip is Element => typeof chip === 'object' && chip !== null
      && (chip as Node).nodeType === 1 && (chip as Node).isConnected) : [];
  } catch {
    return [];
  }
}

/** The words of each chip a box shows now, as a person reads them, compared as tagIdentity does. */
export function chipWords(tags: WidgetTags): string[] {
  return chipsOf(tags).map((chip) => tagIdentity(visibleText(chip, { singleLine: true, cap: TEXT_CAP_LABEL })))
    .filter((words) => words !== '');
}

/** Whether a value shows as one of `chips` (chipWords' reading). */
export function shownAsChip(chips: readonly string[], value: string): boolean {
  const identity = tagIdentity(value);
  return identity !== '' && chips.includes(identity);
}

/** The most chips a box takes (WidgetTags.cap): a whole number above 0, or none. */
export function tagsCap(tags: WidgetTags): number | null {
  const cap = tags.cap;
  return typeof cap === 'number' && Number.isInteger(cap) && cap > 0 ? cap : null;
}

/** Whether a box holds `cap` chips or more now: it takes no more. */
export function tagsFull(tags: WidgetTags): boolean {
  const cap = tagsCap(tags);
  return cap !== null && chipsOf(tags).length >= cap;
}

/** Whether a box holds a planned text: every one of its values shows as a chip (see the header). */
export function holdsTags(tags: WidgetTags, text: string): boolean {
  const values = tagValues(text);
  const chips = chipWords(tags);
  return values.length > 0 && values.every((value) => shownAsChip(chips, value));
}

/** Whether a box shows at least one chip now: its question has an answer (content/press.ts requiredLeftOf). */
export function tagsShowChip(tags: WidgetTags): boolean {
  return chipsOf(tags).length > 0;
}

/** What a box of several answers holds as a field: what its text box holds, as a text field reads it (see the header). */
export function tagsBoxValue(widget: Pick<WidgetTarget, 'input'>): CurrentValue {
  return widget.input === null ? { kind: 'empty' } : currentValueOf('text', widget.input, []);
}

/** The declaration of a box of several answers, when it is one the helpers can read: its chips' hook a function. */
export function declaredTags(tags: unknown): WidgetTags | undefined {
  if (typeof tags !== 'object' || tags === null) return undefined;
  return typeof (tags as Partial<WidgetTags>).chips === 'function' ? tags as WidgetTags : undefined;
}
