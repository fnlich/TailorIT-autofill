/*
 * How the fillers write (docs/design/runtime.md §6): through the element's own prototype setters, then the plain events
 * a page listens for, built with the element's own window's constructors. Every event is an untrusted DOM event: no
 * pointer moves, hovers, touches or typed keystrokes, no focus and no scrolling. A key is sent only to a widget whose
 * adapter declares it (WidgetDecl.keys, docs/SPEC-AMENDMENTS.md §12), or to a text box its adapter declares one for
 * around the write (Adapter.keyAroundWrite: Workable's date masks): one of DECLARED_KEYS, as a keydown and a keyup,
 * never Space, never Enter and never a key no adapter declares. The prototype setter matters in a page's main world,
 * where React tracks a controlled input's value on the element itself; it is correct in the content script's isolated
 * world too.
 */

/** The events the extension may cause on page elements. */
export const ALLOWED_EVENTS = ['input', 'change', 'focusout', 'blur', 'click'] as const;

/** The keys a widget may declare (WidgetDecl.keys), each sent as KEY_EVENTS, untrusted, to that widget alone. Enter,
 *  which the owner allowed too, joins them only once a snapshot shows a widget that needs it. */
export const DECLARED_KEYS = ['Escape', 'ArrowDown'] as const;
export type DeclaredKey = (typeof DECLARED_KEYS)[number];

/** The events a declared key is sent as, on the widget that declares it only (on top of ALLOWED_EVENTS). */
export const KEY_EVENTS = ['keydown', 'keyup'] as const;

/** The `code` of each declared key, as a keyboard's own event carries it. */
const KEY_CODES: Record<DeclaredKey, string> = { Escape: 'Escape', ArrowDown: 'ArrowDown' };

/** One declared key on an element: an untrusted keydown and keyup (KEY_EVENTS), bubbling, built with the element's own
 *  window. The caller has checked that its adapter declares the key there. */
export function fireKey(el: Element, key: DeclaredKey): void {
  const view = windowOf(el);
  const init = { key, code: KEY_CODES[key], bubbles: true, cancelable: true, composed: true };
  el.dispatchEvent(new view.KeyboardEvent('keydown', init));
  el.dispatchEvent(new view.KeyboardEvent('keyup', init));
}

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
