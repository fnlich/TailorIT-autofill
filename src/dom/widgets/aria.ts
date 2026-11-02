/*
 * ARIA widgets, by standard ARIA only (docs/design/runtime.md §5.6; WAI-ARIA 1.2 and its Authoring Practices): what a
 * widget is and where its parts are. Nothing here dispatches an event or changes the page; it reads roles, states and
 * id references. No class name and no platform's markup is ever read: a platform's own widget comes from its adapter
 * (widgetFor), written from a snapshot.
 * - A combobox: any element with role="combobox" (an input, as ARIA 1.2 draws it, or an element wrapping one, as ARIA
 *   1.1 did). Its list is the element its aria-controls names, else its aria-owns, a role="listbox" there or inside
 *   it, else a listbox inside the combobox. A list with aria-multiselectable="true" makes it a multiselect (a chips
 *   multiselect included); one that is not in the page until it opens is told apart when it is first opened.
 * - A listbox of its own (role="listbox", aria-multiselectable="true", no combobox's list): a multiselect.
 * - A radio group: role="radiogroup" whose options are role="radio" elements (buttons or others), with aria-checked;
 *   a radiogroup of native radios is the native scanner's.
 * - A Yes/No group of toggle buttons: a fieldset or role="group" holding two or more buttons, every one of them
 *   showing its state with aria-pressed, and no native field control.
 * A widget is a field only when its element is one of these; a native control inside a widget's list or inside an
 * ARIA 1.1 combobox is part of that widget, never a field of its own.
 */
import { CONTROL_SELECTOR, isTextLike } from '../kinds';
import type { WidgetKind, WidgetTarget } from '../types';

/** The roles a widget's element can carry, and the containers a toggle-button group can be. */
export const WIDGET_ROOT_SELECTOR = '[role], fieldset';

/** The first token of an element's role attribute, lower case; '' for none. */
export function roleOf(el: Element): string {
  return (el.getAttribute('role') ?? '').trim().toLowerCase().split(/\s+/)[0] ?? '';
}

function isTrue(el: Element, attribute: string): boolean {
  return (el.getAttribute(attribute) ?? '').trim().toLowerCase() === 'true';
}

/** The elements an id-reference attribute names, in the element's own tree, in order. */
function idTargets(el: Element, attribute: 'aria-controls' | 'aria-owns'): Element[] {
  const ids = (el.getAttribute(attribute) ?? '').split(/\s+/).filter((id) => id !== '');
  const root = el.getRootNode() as Document | ShadowRoot;
  if (typeof root.getElementById !== 'function') return [];
  return ids.map((id) => root.getElementById(id)).filter((found): found is HTMLElement => found !== null);
}

/** Whether a combobox names its list by ARIA: aria-controls or aria-owns, on it or on its text box. */
export function referencesList(el: Element, input: Element | null): boolean {
  return [el, input].some((part) => part !== null && (part.hasAttribute('aria-controls') || part.hasAttribute('aria-owns')));
}

/** A combobox's list now: the listbox its aria-controls (else aria-owns) names, on it or on its text box, or one
 *  inside the element named; else a listbox inside the combobox itself. Null while the page shows none. */
export function listOf(el: Element, input: Element | null = editableOf(el)): Element | null {
  if (roleOf(el) === 'listbox') return el;
  for (const part of [el, input]) {
    if (part === null) continue;
    for (const attribute of ['aria-controls', 'aria-owns'] as const) {
      for (const target of idTargets(part, attribute)) {
        if (roleOf(target) === 'listbox') return target;
        const inner = target.querySelector('[role~="listbox" i]');
        if (inner !== null) return inner;
      }
    }
  }
  return el.querySelector('[role~="listbox" i]');
}

/** The text box of a combobox: the combobox itself when it is a text input or textarea, else the first one inside it
 *  (ARIA 1.1); null for a select-only combobox. */
export function editableOf(el: Element): HTMLInputElement | HTMLTextAreaElement | null {
  if (isTextLike(el)) return el;
  for (const inner of Array.from(el.querySelectorAll('input, textarea'))) {
    if (isTextLike(inner)) return inner;
  }
  return null;
}

/** Whether typing into a combobox filters what it suggests: its text box (or it) says aria-autocomplete list or
 *  both. Such a combobox whose list shows nothing until something is typed is a remote search. */
export function filtersAsTyped(el: Element, input: Element | null): boolean {
  return [input, el].some((part) => part !== null
    && ['list', 'both'].includes((part.getAttribute('aria-autocomplete') ?? '').trim().toLowerCase()));
}

/** The option elements of a listbox: its role="option" descendants that belong to it, not to a list inside it. */
export function optionElementsOf(listbox: Element): Element[] {
  return Array.from(listbox.querySelectorAll('[role~="option" i]'))
    .filter((option) => option.parentElement?.closest('[role~="listbox" i]') === listbox);
}

/** An option, radio or toggle button that is chosen now: aria-selected, aria-checked or aria-pressed "true". */
export function isChosen(el: Element): boolean {
  return isTrue(el, 'aria-selected') || isTrue(el, 'aria-checked') || isTrue(el, 'aria-pressed');
}

/** An option or member that cannot be chosen: aria-disabled="true", or a disabled button. */
export function isUnavailable(el: Element): boolean {
  if (isTrue(el, 'aria-disabled')) return true;
  return el.localName === 'button' && (el as HTMLButtonElement).disabled;
}

/** Whether a listbox takes several options. */
export function isMultiselectable(listbox: Element | null): boolean {
  return listbox !== null && isTrue(listbox, 'aria-multiselectable');
}

/** The members of a radio group or a toggle-button group, in document order. */
export function membersOf(group: Element): HTMLElement[] {
  if (roleOf(group) === 'radiogroup') {
    return Array.from(group.querySelectorAll<HTMLElement>('[role~="radio" i]'))
      .filter((member) => member.localName !== 'input');
  }
  return Array.from(group.querySelectorAll<HTMLElement>('button, [role~="button" i]'));
}

/** Whether an element holds a native control the scanner makes a field of. */
function holdsNativeField(el: Element): boolean {
  return Array.from(el.querySelectorAll(CONTROL_SELECTOR)).some((control) =>
    control.localName !== 'input' || !['hidden', 'submit', 'button', 'reset', 'image'].includes((control as HTMLInputElement).type));
}

/**
 * The kind of ARIA widget `el` is (see the header), or null when it is none. A combobox inside another, a listbox that
 * is a combobox's list (`lists`: every combobox's list in the scan), a radiogroup of native radios and a group whose
 * buttons do not all show aria-pressed are none.
 */
export function ariaWidgetKind(el: Element, lists: ReadonlySet<Element> = new Set()): WidgetKind | null {
  const role = roleOf(el);
  if (el.localName === 'select' || el.localName === 'textarea' || el.localName === 'option') return null;
  if (role === 'combobox') {
    if (el.localName === 'input' && !isTextLike(el)) return null;
    if (el.parentElement?.closest('[role~="combobox" i]') != null) return null;
    return isMultiselectable(listOf(el)) ? 'multiselect' : 'combobox';
  }
  if (role === 'listbox') {
    if (lists.has(el) || el.closest('[role~="combobox" i]') !== null) return null;
    return isMultiselectable(el) ? 'multiselect' : null;
  }
  if (role === 'radiogroup') {
    if (el.querySelector('input[type="radio" i]') !== null) return null;
    return membersOf(el).length >= 2 ? 'radio' : null;
  }
  if (role === 'group' || (el.localName === 'fieldset' && (role === '' || role === 'group'))) {
    if (holdsNativeField(el)) return null;
    const buttons = membersOf(el);
    if (buttons.length < 2 || !buttons.every((button) => button.hasAttribute('aria-pressed'))) return null;
    // A group inside another group of the same buttons is that group's part.
    const outer = el.parentElement?.closest('fieldset, [role~="group" i], [role~="radiogroup" i]') ?? null;
    if (outer !== null && membersOf(outer).length === buttons.length) return null;
    return 'radio';
  }
  return null;
}

/**
 * A widget's own box: the outermost ancestor of its element (inside the form) that holds no other field, native or
 * ARIA, besides its own text box and list. Its chips and busy signs are looked for there; the element itself when even
 * its parent holds another field.
 */
export function widgetBox(el: Element, input: Element | null, list: Element | null): Element {
  let box = el;
  for (let at = el.parentElement; at !== null; at = at.parentElement) {
    if (at.localName === 'body' || at.localName === 'html' || at.localName === 'form') break;
    const others = Array.from(at.querySelectorAll(`${CONTROL_SELECTOR}, [role~="combobox" i], [role~="listbox" i], `
      + '[role~="radiogroup" i]')).some((other) => other !== el && other !== input && other !== list
      && !el.contains(other) && !(list?.contains(other) ?? false) && isFieldLike(other));
    if (others) break;
    box = at;
  }
  return box;
}

/** A native control that can be a field (not a hidden, button or submit input), or an ARIA widget's element. */
function isFieldLike(el: Element): boolean {
  if (el.localName === 'input') return !['hidden', 'submit', 'button', 'reset', 'image'].includes((el as HTMLInputElement).type);
  return true;
}

/** Whether a native control is part of a widget: inside a list or an option, or the text box of an ARIA 1.1
 *  combobox (one inside an element with role="combobox"). */
export function isWidgetPart(control: Element): boolean {
  if (control.closest('[role~="listbox" i], [role~="option" i]') !== null) return true;
  return control.parentElement?.closest('[role~="combobox" i]') != null;
}

/** Whether standard ARIA tells where a widget's list is, or its members' state: the helpers act on nothing else. */
export function isActionable(widget: WidgetTarget): boolean {
  if (widget.kind === 'checkbox') return false;
  if (widget.kind === 'radio') return widget.members.length > 0;
  const roles = [roleOf(widget.element), widget.input === null ? '' : roleOf(widget.input)];
  return roles.includes('combobox') || roles.includes('listbox') || referencesList(widget.element, widget.input);
}
