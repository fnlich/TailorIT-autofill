/*
 * Field labels (docs/design/runtime.md §5.5; docs/ARCHITECTURE.md "Scanner"). A label is read only from the spec's
 * sources, and only as text a person can see (visibleText), so a hidden or camouflaged label never names a field.
 *
 * Order. A visible source always wins over aria-label: label[for], aria-labelledby (hidden targets dropped), the
 * wrapping <label> (minus the controls inside it), the fieldset's legend, the adapter's label (written from a
 * snapshot), the visible placeholder, and only then aria-label. The spec lists aria-label third; it is read last here
 * because it is never shown, and a page could otherwise name a field one thing on screen and another to us (an
 * aria-label "Email" on a field shown as "Referrer's email"). An aria-label still drives the rules, marked not
 * visible unless the same words are visible beside the control; it never reaches an LLM. A trailing required mark
 * ('*', or Lever's heavy asterisk) or "(required)" is cut and sets `required`; "(optional)" is cut.
 *
 * Groups (radios, checkbox groups) take their question from the container: its aria-labelledby, its legend, the
 * adapter's label, then its aria-label. Each member's own visible label is the option's label.
 */
import type { LabelSource } from '../core/enums';
import type { Adapter } from '../adapters/types';
import { capCodePoints } from '../core/text/fold';
import { CONTROL_SELECTOR, kindOf } from './kinds';
import type { ScanCache } from './scan-cache';
import { TEXT_CAP_DESCRIPTION, TEXT_CAP_LABEL } from './thresholds';
import { visiblePlaceholder, visibleText } from './visible-text';
import { isUserVisible } from './visibility';

/** What the scanner reads labels with. */
export interface LabelContext {
  cache: ScanCache;
  adapter: Adapter | null;
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

/** The joined visible text of a list of elements ('' when none of them shows any). */
function joinedText(elements: readonly Element[], ctx: LabelContext): { text: string; first: Element | null } {
  let first: Element | null = null;
  const parts: string[] = [];
  for (const el of elements) {
    const text = textOf(el, ctx);
    if (text === '') continue;
    first ??= el;
    parts.push(text);
  }
  return { text: parts.join(' '), first };
}

/** The elements an aria-labelledby or aria-describedby attribute names, in its own tree. */
export function referenced(el: Element, attribute: 'aria-labelledby' | 'aria-describedby'): Element[] {
  const ids = (el.getAttribute(attribute) ?? '').split(/\s+/).filter((id) => id !== '');
  const root = el.getRootNode() as Document | ShadowRoot;
  if (typeof root.getElementById !== 'function') return [];
  return ids.map((id) => root.getElementById(id)).filter((target): target is HTMLElement => target !== null);
}

/** The label of a single control (a text field, a select, a lone checkbox, a file input). */
export function labelOfControl(control: Element, ctx: LabelContext): ResolvedLabel {
  const { explicit, wrapping } = tiedLabels(control);
  const forLabel = joinedText(explicit, ctx);
  const byFor = fromText(forLabel.text, 'for', forLabel.first);
  if (byFor) return byFor;
  const labelledBy = joinedText(referenced(control, 'aria-labelledby'), ctx);
  const byLabelledBy = fromText(labelledBy.text, 'aria-labelledby', labelledBy.first);
  if (byLabelledBy) return byLabelledBy;
  const wrap = joinedText(wrapping, ctx);
  const byWrapping = fromText(wrap.text, 'wrapping-label', wrap.first);
  if (byWrapping) return byWrapping;
  const legend = soleFieldLegend(control, ctx);
  if (legend) return legend;
  const byAdapter = adapterLabel(control, ctx);
  if (byAdapter) return byAdapter;
  const placeholder = visiblePlaceholder(control, ctx.cache);
  const byPlaceholder = placeholder === null ? null : fromText(placeholder, 'placeholder', null);
  if (byPlaceholder) return byPlaceholder;
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
  const byAdapter = (container ? adapterLabel(container, ctx) : null) ?? (first ? adapterLabel(first, ctx) : null);
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
  const adapter = adapterLabel(input, ctx);
  return adapter ? { text: adapter.text, element: adapter.element } : { text: '', element: null };
}

/** Visible help text: the aria-describedby targets a person can see, joined. */
export function descriptionOf(el: Element, ctx: LabelContext): string {
  const text = joinedText(referenced(el, 'aria-describedby'), ctx).text;
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

function adapterLabel(el: Element, ctx: LabelContext): ResolvedLabel | null {
  const labelEl = ctx.adapter?.labelFor?.(el) ?? null;
  if (labelEl === null || !isUserVisible(labelEl, ctx.cache)) return null;
  return fromText(textOf(labelEl, ctx), 'adapter', labelEl);
}

/** An aria-label: it may drive the rules, and counts as visible only when its words are visible beside the control
 *  (in the control's field container). */
function ariaLabel(el: Element, ctx: LabelContext): ResolvedLabel | null {
  const raw = el.getAttribute('aria-label') ?? '';
  const label = fromText(raw, 'aria-label', null, false);
  if (label === null) return null;
  const container = fieldContainer(el);
  if (container !== null) {
    const nearby = textOf(container, ctx).toLowerCase();
    if (nearby.includes(label.text.toLowerCase())) label.visible = true;
  }
  return label;
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
