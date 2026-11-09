/*
 * How the fillers write (docs/design/runtime.md §6): through the element's own prototype setters, then the plain events
 * a page listens for, built with the element's own window's constructors. Every event is an untrusted DOM event: no
 * pointer moves, hovers, touches or typed keystrokes, no focus and no scrolling. A key is sent only to a widget whose
 * adapter declares it (WidgetDecl.keys, docs/SPEC-AMENDMENTS.md §12), or to a text box its adapter declares one for
 * around the write (Adapter.keyAroundWrite: Workable's date masks): one of WIDGET_KEYS, as a keydown and a keyup,
 * never Space and never a key no adapter declares. s2 wd (snapshot round 2): Enter only as a search's declared query
 * key (WidgetDecl.queryKey: Workday's prompts), and the digits only into a date's parts whose adapter declares them
 * (Adapter.dateFor: Workday's date input, date-parts.ts), each to that one control. The prototype setter matters in a
 * page's main world, where React tracks a controlled input's value on the element itself; it is correct in the content
 * script's isolated world too.
 * v5 p2-fill: a rich-text box (dom/kinds.ts isEditingHost), which no value setter reaches, is written with the browser's
 * own editing instead (text.ts fillEditable): it takes the focus (no scroll) and its content the selection, each insert
 * is offered first as an untrusted, cancelable beforeinput (EDITING_EVENTS), and document.execCommand makes it where
 * no editor took it, with the browser's own (trusted) input event; then the box loses the focus. That box alone.
 */

/** The events the extension may cause on page elements. */
export const ALLOWED_EVENTS = ['input', 'change', 'focusout', 'blur', 'click'] as const;

// ── v5 p2-fill: rich-text boxes ──
/** The untrusted event a rich-text box (dom/kinds.ts isEditingHost) gets before each insert of its write, on that box
 *  alone (text.ts fillEditable): a cancelable beforeinput naming the insert, which an editor keeping its own model
 *  takes (and cancels); otherwise the browser's own editing follows, with its own events. */
export const EDITING_EVENTS = ['beforeinput'] as const;
// ── end v5 p2-fill ──

/** The keys a widget may declare (WidgetDecl.keys) and a text box around its write (Adapter.keyAroundWrite), each sent
 *  as KEY_EVENTS, untrusted, to that widget or box alone. */
export const WIDGET_KEYS = ['Escape', 'ArrowDown'] as const;
export type WidgetKey = (typeof WIDGET_KEYS)[number];

// ── s2 wd: Enter and the digits (snapshot round 2) ──
/** A search's query key (WidgetDecl.queryKey): a widget key, or Enter, which the owner allowed and a snapshot now needs
 *  (Workday's prompts: <input enterkeyhint="search" placeholder="Search">, fixtures/workday/s2-verily-field-of-study-
 *  open.html). Enter is sent after a typed query only, to the search's own text box. */
export const QUERY_KEYS = [...WIDGET_KEYS, 'Enter'] as const;
export type QueryKey = (typeof QUERY_KEYS)[number];
/** The digits a date drawn in parts takes typed, one key per digit, into the part they write (Adapter.dateFor's
 *  `keys: 'digits'`: Workday's spin buttons, fixtures/workday/s2-exelixis-my-experience.html), when its value setter's
 *  write is not taken. Never to any other control. */
export const DIGIT_KEYS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
export type DigitKey = (typeof DIGIT_KEYS)[number];
// ── end s2 wd ──

/** Every key the extension may send, each only where its declaration allows it (see the header). */
export const DECLARED_KEYS = [...QUERY_KEYS, ...DIGIT_KEYS] as const;
export type DeclaredKey = (typeof DECLARED_KEYS)[number];

/** The events a declared key is sent as, on the widget that declares it only (on top of ALLOWED_EVENTS). */
export const KEY_EVENTS = ['keydown', 'keyup'] as const;

/** The `code` of each declared key, as a keyboard's own event carries it. */
const KEY_CODES: Record<DeclaredKey, string> = { Escape: 'Escape', ArrowDown: 'ArrowDown', Enter: 'Enter',
  ...Object.fromEntries(DIGIT_KEYS.map((digit) => [digit, `Digit${digit}`])) as Record<DigitKey, string> };

/** s2 wd: the legacy keyCode (and which) Enter and the digits carry as a keyboard's own events do, for a page handler
 *  that reads it rather than `key`; the widget keys' events stay as they were. */
const LEGACY_CODES: Partial<Record<DeclaredKey, number>> = { Enter: 13,
  ...Object.fromEntries(DIGIT_KEYS.map((digit) => [digit, 48 + Number(digit)])) };

/** One declared key on an element: an untrusted keydown and keyup (KEY_EVENTS), bubbling, built with the element's own
 *  window. The caller has checked that its adapter declares the key there. */
export function fireKey(el: Element, key: DeclaredKey): void {
  const view = windowOf(el);
  const legacy = LEGACY_CODES[key];
  const init = { key, code: KEY_CODES[key], bubbles: true, cancelable: true, composed: true,
    ...(legacy === undefined ? {} : { keyCode: legacy, which: legacy }) };
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
