/*
 * Field labels (docs/design/runtime.md §5.5; docs/ARCHITECTURE.md "Scanner"). A label is read only from the spec's
 * sources, and only as text a person can see (visibleText), so a hidden or camouflaged label never names a field.
 *
 * Order. A visible source always wins over aria-label: label[for], aria-labelledby (hidden targets dropped), the
 * wrapping <label> (minus the controls inside it), the fieldset's legend, the adapter's label (written from a
 * snapshot), then the visible placeholder, and only then aria-label alone. The spec lists aria-label third; it is read
 * after the visible sources because it is never shown, and a page could otherwise name a field one thing on screen and
 * another to us (an aria-label "Email" on a field shown as "Referrer's email"). An aria-label still drives the rules,
 * marked not visible unless the same words stand whole, in order, beside the control (DOM-11: a one-letter "e" is
 * found in any sentence); it never reaches an LLM.
 * The one exception (DOM-10, the lead's decision): when the visible placeholder is the only visible source and the
 * control also has an aria-label, the aria-label is the label's text (labelSource 'aria-label'), because a placeholder
 * is so often an example ("e.g. Jane", "https://") rather than a name, and the visible placeholder is what makes the
 * field fillable (visible true). A placeholder our own write hid counts only while the page still shows the text seen
 * at that write (heldPlaceholder, DOM-7). A trailing required mark ('*', or Lever's heavy asterisk) or "(required)" is
 * cut and sets `required`; "(optional)" is cut.
 *
 * Groups (radios, checkbox groups) take their question from the container: its aria-labelledby, its legend, the
 * adapter's label, then its aria-label. Each member's own visible label is the option's label.
 *
 * The adapter's label is the visible text of the element its labelFor names, with the words its labelSuffix adds for a
 * control that shares that element with others (Ashby's month and year lists under one "Start Date"). One inside the
 * control's own wrapping label that reads otherwise comes before that label's whole text (Workable's question beside
 * its required star in one <label>). An adapter's upload control (uploadWidgets: Workable's "Choose file", a
 * label[for] its input's aria-labelledby also names) never labels its input. Help text is the visible aria-describedby
 * targets, else the elements the adapter's descriptionFor names.
 */
import type { LabelSource } from '../core/enums';
import type { Adapter } from '../adapters/types';
import { capCodePoints, foldLetters, removeInvisibles } from '../core/text/fold';
import { CONTROL_SELECTOR, kindOf } from './kinds';
import type { ScanCache } from './scan-cache';
import { MIN_ARIA_LABEL_CHARS, TEXT_CAP_DESCRIPTION, TEXT_CAP_LABEL } from './thresholds';
import { heldPlaceholder, visiblePlaceholder, visibleText, visibleTextWithout } from './visible-text';
import { isUserVisible } from './visibility';

/** What the scanner reads labels with. */
export interface LabelContext {
  cache: ScanCache;
  adapter: Adapter | null;
  /** Controls the extension wrote into while a visible placeholder showed, with that placeholder's text
   *  (ScanOptions.heldPlaceholders). */
  heldPlaceholders?: WeakMap<Element, string>;
}

/** A field's label as read. */
export interface ResolvedLabel {
  /** The cleaned label, at most 300 characters; '' when none. */
  text: string;
  source: LabelSource;
  /** Read from text a person can see. False for an aria-label whose words are not visible beside the control, and for
   *  'none'. */
  visible: boolean;
  /** A trailing required mark or "(required)" was cut. */
  required: boolean;
  /** The element the label was read from (a label, a labelledby target, a legend, the adapter's label); null for
   *  aria-label, placeholder and none. Highlights point at it. */
  element: Element | null;
}

const NONE: ResolvedLabel = { text: '', source: 'none', visible: false, required: false, element: null };

/** A trailing required mark: '*', Lever's heavy asterisk '\u{2731}' (its span.required, the only sign that Lever's
 *  Resume/CV is required), and the asterisk operator and full-width asterisk that other forms draw instead. */
const REQUIRED_MARK = /\s*[*\u{2731}\u{2217}\u{FF0A}]+$/u;

/** Collapses white space and cuts trailing required and optional marks (and a trailing colon). */
export function cleanLabel(raw: string): { text: string; required: boolean } {
  let text = raw.replace(/\s+/g, ' ').trim();
  let required = false;
  for (let changed = true; changed;) {
    const before = text;
    text = text.replace(/[\s:]+$/, '');
    if (REQUIRED_MARK.test(text)) {
      text = text.replace(REQUIRED_MARK, '');
      required = true;
    }
    if (/\(\s*required\s*\)$/i.test(text)) {
      text = text.replace(/\s*\(\s*required\s*\)$/i, '');
      required = true;
    }
    text = text.replace(/\s*\(\s*optional\s*\)$/i, '');
    changed = text !== before;
  }
  return { text: capCodePoints(text, TEXT_CAP_LABEL), required };
}

function fromText(raw: string, source: LabelSource, element: Element | null, visible = true): ResolvedLabel | null {
  const { text, required } = cleanLabel(raw);
  return text === '' ? null : { text, source, visible, required, element };
}

/** The visible text of an element on one line ('' when it is hidden). */
function textOf(el: Element, ctx: LabelContext): string {
  return visibleText(el, { singleLine: true, cap: TEXT_CAP_DESCRIPTION, cache: ctx.cache });
}

/** The labels tied to a control: explicit ones (label[for]) and the wrapping one, as the browser associates them. */
export function tiedLabels(control: Element): { explicit: HTMLLabelElement[]; wrapping: HTMLLabelElement[] } {
  const labels = (control as HTMLInputElement).labels;
  const all = labels ? Array.from(labels) : [];
  return {
    explicit: all.filter((label) => label.hasAttribute('for')),
    wrapping: all.filter((label) => !label.hasAttribute('for')),
  };
}

/** The joined visible text of a list of elements ('' when none of them shows any), leaving out the text of
 *  `excluded` elements inside them. */
function joinedText(elements: readonly Element[], ctx: LabelContext, excluded: readonly Element[] = []):
  { text: string; first: Element | null } {
  let first: Element | null = null;
  const parts: string[] = [];
  for (const el of elements) {
    const inside = excluded.filter((other) => el.contains(other));
    const text = inside.length === 0 ? textOf(el, ctx)
      : visibleTextWithout(el, inside, { singleLine: true, cap: TEXT_CAP_DESCRIPTION, cache: ctx.cache });
    if (text === '') continue;
    first ??= el;
    parts.push(text);
  }
  return { text: parts.join(' '), first };
}

/**
 * The visible controls of the adapter's upload widgets that sit inside these wrapping labels. A wrapping label's text
 * leaves them out: Lever wraps its resume question in a <label> that also holds the widget's "ATTACH RESUME/CV" link
 * (fixtures/lever/*.html), and the question is the label's own "Resume/CV" and its required mark (the heavy asterisk,
 * the only sign Lever's resume is required). The widgets are asked of the labels' form, the root an adapter's hooks
 * read.
 */
function uploadControlsIn(labels: readonly Element[], ctx: LabelContext): Element[] {
  const first = labels[0];
  if (first === undefined || ctx.adapter?.uploadWidgets === undefined) return [];
  const scope = first.closest('form') ?? first.ownerDocument.body ?? first;
  const widgets = ctx.cache.memo('upload-widgets', scope, () => ctx.adapter?.uploadWidgets?.(scope) ?? []);
  return widgets.map((widget) => widget.control).filter((control) => labels.some((label) => label.contains(control)));
}

/** The elements an aria-labelledby or aria-describedby attribute names, in its own tree. */
export function referenced(el: Element, attribute: 'aria-labelledby' | 'aria-describedby'): Element[] {
  const ids = (el.getAttribute(attribute) ?? '').split(/\s+/).filter((id) => id !== '');
  const root = el.getRootNode() as Document | ShadowRoot;
  if (typeof root.getElementById !== 'function') return [];
  return ids.map((id) => root.getElementById(id)).filter((target): target is HTMLElement => target !== null);
}

/**
 * The visible controls of the adapter's upload widgets among these elements (Workable's "Choose file", a label[for]
 * with role=button that its file input also names in its aria-labelledby): such a control is the widget's button, never
 * its input's question, so neither a label[for] nor an aria-labelledby target that is one names the input.
 */
function uploadControlsAmong(elements: readonly Element[], ctx: LabelContext): Set<Element> {
  const first = elements[0];
  if (first === undefined || ctx.adapter?.uploadWidgets === undefined) return new Set();
  const scope = first.closest('form') ?? first.ownerDocument.body ?? first;
  const widgets = ctx.cache.memo('upload-widgets', scope, () => ctx.adapter?.uploadWidgets?.(scope) ?? []);
  const controls = new Set(widgets.map((widget) => widget.control));
  return new Set(elements.filter((el) => controls.has(el)));
}

/** The label of a single control (a text field, a select, a lone checkbox, a file input). */
export function labelOfControl(control: Element, ctx: LabelContext): ResolvedLabel {
  const { explicit, wrapping } = tiedLabels(control);
  const ownFor = uploadControlsAmong(explicit, ctx);
  const forLabel = joinedText(explicit.filter((label) => !ownFor.has(label)), ctx);
  const byFor = fromText(forLabel.text, 'for', forLabel.first);
  if (byFor) return byFor;
  const targets = referenced(control, 'aria-labelledby');
  const ownTargets = uploadControlsAmong(targets, ctx);
  const labelledBy = joinedText(targets.filter((target) => !ownTargets.has(target)), ctx);
  const byLabelledBy = fromText(labelledBy.text, 'aria-labelledby', labelledBy.first);
  if (byLabelledBy) return byLabelledBy;
  const wrap = joinedText(wrapping, ctx, uploadControlsIn(wrapping, ctx));
  const byWrapping = fromText(wrap.text, 'wrapping-label', wrap.first);
  // The adapter's label inside the control's own wrapping label, where the two read differently, is that label's
  // question without the label's other parts (Workable draws its required star before the question in the same
  // <label>, and its consent box sits in two nested labels, whose texts would join twice). Where they read alike the
  // wrapping label stands (Lever's resume question).
  const inner = byWrapping === null ? null : adapterLabelOf(control, ctx);
  if (inner !== null && inner.element !== null && inner.text !== byWrapping!.text
    && wrapping.some((label) => label.contains(inner.element!))) return inner;
  if (byWrapping) return byWrapping;
  const legend = soleFieldLegend(control, ctx);
  if (legend) return legend;
  const byAdapter = adapterLabelOf(control, ctx);
  if (byAdapter) return byAdapter;
  // A control we wrote into keeps the placeholder that showed then, while the page still shows the same text: our own
  // write hid it, and the field, with its key, is the same one. Any other filled control's placeholder is out of sight
  // and names nothing.
  const held = ctx.heldPlaceholders?.get(control);
  const placeholder = visiblePlaceholder(control, ctx.cache)
    ?? (held === undefined ? null : heldPlaceholder(control, held, ctx.cache));
  if (placeholder !== null) {
    // DOM-10: the aria-label names the field, the visible placeholder makes it fillable.
    const named = ariaLabel(control, ctx);
    if (named !== null) return { ...named, visible: true, required: named.required || cleanLabel(placeholder).required };
    const byPlaceholder = fromText(placeholder, 'placeholder', null);
    if (byPlaceholder) return byPlaceholder;
  }
  return ariaLabel(control, ctx) ?? NONE;
}

/** The question of a radio or checkbox group: from its container, then the adapter, then the container's aria-label. */
export function labelOfGroup(members: readonly HTMLInputElement[], container: Element | null, ctx: LabelContext):
  ResolvedLabel {
  if (container !== null) {
    const labelledBy = joinedText(referenced(container, 'aria-labelledby'), ctx);
    const byLabelledBy = fromText(labelledBy.text, 'aria-labelledby', labelledBy.first);
    if (byLabelledBy) return byLabelledBy;
    const legend = legendOf(container);
    if (legend) {
      const byLegend = fromText(textOf(legend, ctx), 'legend', legend);
      if (byLegend) return byLegend;
    }
  }
  const first = members[0];
  const byAdapter = (container ? adapterLabelOf(container, ctx) : null) ?? (first ? adapterLabelOf(first, ctx) : null);
  if (byAdapter) return byAdapter;
  return (container ? ariaLabel(container, ctx) : null) ?? NONE;
}

/** The visible label of one radio or checkbox as an option of its group: its label[for], else its wrapping label, else
 *  the adapter's. '' when it shows none. */
export function optionLabelOf(input: HTMLInputElement, ctx: LabelContext): { text: string; element: Element | null } {
  const { explicit, wrapping } = tiedLabels(input);
  for (const list of [explicit, wrapping]) {
    const joined = joinedText(list, ctx);
    const { text } = cleanLabel(joined.text);
    if (text !== '') return { text, element: joined.first };
  }
  const adapter = adapterLabelOf(input, ctx);
  return adapter ? { text: adapter.text, element: adapter.element } : { text: '', element: null };
}

/** Visible help text: the aria-describedby targets a person can see, joined; else the adapter's (descriptionFor). */
export function descriptionOf(el: Element, ctx: LabelContext): string {
  let text = joinedText(referenced(el, 'aria-describedby'), ctx).text;
  if (text === '' && ctx.adapter?.descriptionFor !== undefined) {
    let declared: Element[];
    try {
      declared = ctx.adapter.descriptionFor(el);
    } catch {
      declared = [];
    }
    text = joinedText(declared, ctx).text;
  }
  return capCodePoints(text.replace(/\s+/g, ' ').trim(), TEXT_CAP_DESCRIPTION);
}

/** The first legend child of a fieldset. */
export function legendOf(container: Element): Element | null {
  if (container.localName !== 'fieldset') return null;
  for (const child of Array.from(container.children)) {
    if (child.localName === 'legend') return child;
  }
  return null;
}

/** A fieldset's legend labels a single control only when that control is the fieldset's only field. */
function soleFieldLegend(control: Element, ctx: LabelContext): ResolvedLabel | null {
  const fieldset = control.closest('fieldset');
  if (fieldset === null) return null;
  const legend = legendOf(fieldset);
  if (legend === null) return null;
  const fields = Array.from(fieldset.querySelectorAll(CONTROL_SELECTOR)).filter((el) => kindOf(el).field);
  if (fields.length !== 1 || fields[0] !== control) return null;
  return fromText(textOf(legend, ctx), 'legend', legend);
}

/** The adapter's visible label for a control or a group's container (labelFor, with its labelSuffix), or null. */
export function adapterLabelOf(el: Element, ctx: LabelContext): ResolvedLabel | null {
  const labelEl = ctx.adapter?.labelFor?.(el) ?? null;
  if (labelEl === null || !isUserVisible(labelEl, ctx.cache)) return null;
  const cleaned = cleanLabel(textOf(labelEl, ctx));
  if (cleaned.text === '') return null;
  const suffix = (ctx.adapter?.labelSuffix?.(el) ?? '').replace(/\s+/g, ' ').trim();
  const text = suffix === '' ? cleaned.text : capCodePoints(`${cleaned.text} ${suffix}`, TEXT_CAP_LABEL);
  return { text, source: 'adapter', visible: true, required: cleaned.required, element: labelEl };
}

/** An aria-label: it may drive the rules, and counts as visible only when its words are visible beside the control
 *  (in the control's field container): all of them, whole and in order, and at least MIN_ARIA_LABEL_CHARS letters or
 *  digits in all (DOM-11). */
function ariaLabel(el: Element, ctx: LabelContext): ResolvedLabel | null {
  const raw = el.getAttribute('aria-label') ?? '';
  const label = fromText(raw, 'aria-label', null, false);
  if (label === null) return null;
  const container = fieldContainer(el);
  if (container !== null && containsWords(wordsOf(textOf(container, ctx)), wordsOf(label.text))) label.visible = true;
  return label;
}

/** A text's words, folded (invisibles deleted, diacritics and case folded) and split at anything but a letter or a
 *  digit. */
function wordsOf(text: string): string[] {
  return foldLetters(removeInvisibles(text)).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word !== '');
}

/** Whether `words` holds `wanted` as one run of whole words, and `wanted` has at least MIN_ARIA_LABEL_CHARS letters
 *  or digits. */
function containsWords(words: readonly string[], wanted: readonly string[]): boolean {
  if (wanted.join('').length < MIN_ARIA_LABEL_CHARS) return false;
  for (let at = 0; at + wanted.length <= words.length; at += 1) {
    if (wanted.every((word, i) => words[at + i] === word)) return true;
  }
  return false;
}

/** Whether `el` is a control the scanner could make a field of (or an auth field). Buttons are not. */
function isFieldControl(el: Element): boolean {
  const kind = kindOf(el);
  return kind.field || kind.auth;
}

/**
 * The field container of a control: the outermost ancestor that holds no other field control (buttons do not
 * count). Null when even the parent holds another control.
 */
export function fieldContainer(control: Element): Element | null {
  let container: Element | null = null;
  for (let at = control.parentElement; at !== null; at = at.parentElement) {
    if (at.localName === 'body' || at.localName === 'html' || at.localName === 'form') break;
    const others = Array.from(at.querySelectorAll(CONTROL_SELECTOR))
      .some((other) => other !== control && isFieldControl(other));
    if (others) break;
    container = at;
  }
  return container;
}
