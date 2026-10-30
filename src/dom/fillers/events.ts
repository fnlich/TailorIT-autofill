/*
 * How the fillers write (docs/design/runtime.md §6): through the element's own prototype setters, then the plain events
 * a page listens for, built with the element's own window's constructors. Every event is an untrusted DOM event: no
 * pointer moves, hovers, touches, typed keystrokes, Enter or Space, no focus and no scrolling. The prototype setter
 * matters in a page's main world, where React tracks a controlled input's value on the element itself; it is
 * correct in the content script's isolated world too.
 */

/** The events the extension may cause on page elements. */
export const ALLOWED_EVENTS = ['input', 'change', 'focusout', 'blur', 'click'] as const;

/** The window an element belongs to; filling needs one. */
export function windowOf(el: Element): Window & typeof globalThis {
  const view = el.ownerDocument.defaultView;
  if (view === null) throw new Error('the element has no window');
  return view as Window & typeof globalThis;
}

/** Sets a text-like control's value through its prototype's setter. */
export function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const view = windowOf(el);
  const proto = el.localName === 'textarea' ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter === undefined) throw new Error('no value setter');
  setter.call(el, value);
}

/** Sets a select's selectedIndex through the prototype's setter: exact even when option values repeat. */
export function setSelectedIndex(select: HTMLSelectElement, index: number): void {
  const setter = Object.getOwnPropertyDescriptor(windowOf(select).HTMLSelectElement.prototype, 'selectedIndex')?.set;
  if (setter === undefined) throw new Error('no selectedIndex setter');
  setter.call(select, index);
}

/** Selects one option of a multiple select through the prototype's setter. Only ever sets true: never deselects. */
export function selectOption(option: HTMLOptionElement): void {
  const setter = Object.getOwnPropertyDescriptor(windowOf(option).HTMLOptionElement.prototype, 'selected')?.set;
  if (setter === undefined) throw new Error('no selected setter');
  setter.call(option, true);
}

/** Puts one file into a file input through a DataTransfer. */
export function setFiles(input: HTMLInputElement, file: File): void {
  const view = windowOf(input);
  const transfer = new view.DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
}

/** The input event a replacement of the whole value produces. */
export function fireInput(el: Element, kind: 'text' | 'plain'): void {
  const view = windowOf(el);
  el.dispatchEvent(kind === 'text'
    ? new view.InputEvent('input', { bubbles: true, composed: true, inputType: 'insertReplacementText' })
    : new view.Event('input', { bubbles: true, composed: true }));
}

/** change, which bubbles. */
export function fireChange(el: Element): void {
  el.dispatchEvent(new (windowOf(el).Event)('change', { bubbles: true }));
}

/** focusout (bubbling) and blur, so validation that runs when a field is left runs. Nothing is focused. */
export function fireLeave(el: Element): void {
  const view = windowOf(el);
  el.dispatchEvent(new view.FocusEvent('focusout', { bubbles: true, composed: true }));
  el.dispatchEvent(new view.FocusEvent('blur', { bubbles: false, composed: true }));
}
