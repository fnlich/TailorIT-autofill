/*
 * What kind of field a native control is (docs/design/runtime.md §5.6). Phase 2 covers native controls only; ARIA
 * widgets (role=combobox, listbox, radiogroup, checkbox, switch) come in Phase 4 with their adapters. A text input
 * that is itself a combobox (role="combobox", as Greenhouse's react-select inputs are) is reported as a 'combobox'
 * whose options are 'lazy', never as text: typing into it would not choose anything, so until Phase 4 its writes are
 * refused as widget-unsupported. Radios and checkboxes are grouped by the scanner, which decides between 'checkbox'
 * and 'checkbox-group'.
 *
 * A password field or a one-time-code field is never a field: it means the step is a sign-in, an account creation or
 * an email code, and nothing on such a step is filled, not even the email (pause-detect.ts).
 */
import type { FieldFormat } from '../core/enums';

/** The controls the scanner considers. */
export const CONTROL_SELECTOR = 'input, select, textarea';

/** The kinds a native control can be before grouping ('combobox': a text input with role="combobox"). */
export type NativeKind = 'text' | 'textarea' | 'select' | 'multiselect' | 'radio' | 'checkbox' | 'date' | 'file'
  | 'combobox';

/** What a control is: a field of some kind, an auth field, or not a field at all. */
export type ControlKind =
  | { field: true; kind: NativeKind; format?: FieldFormat }
  | { field: false; auth: boolean };

const TEXT_TYPES: Readonly<Record<string, FieldFormat | undefined>> = {
  text: undefined, search: undefined, email: 'email', tel: 'tel', url: 'url', number: 'number',
};
const DATE_TYPES: Readonly<Record<string, FieldFormat | undefined>> = {
  date: 'date', month: 'month-year', 'datetime-local': 'date', week: undefined, time: undefined,
};
const INPUTMODE_FORMATS: Readonly<Record<string, FieldFormat>> = {
  email: 'email', tel: 'tel', url: 'url', decimal: 'number',
};

/** The kind of a native control. */
export function kindOf(el: Element): ControlKind {
  if (isAuthField(el)) return { field: false, auth: true };
  const tag = el.localName;
  if (tag === 'textarea') return { field: true, kind: 'textarea' };
  if (tag === 'select') return { field: true, kind: (el as HTMLSelectElement).multiple ? 'multiselect' : 'select' };
  if (tag !== 'input') return { field: false, auth: false };
  const type = (el as HTMLInputElement).type;
  if (type in TEXT_TYPES && (el.getAttribute('role') ?? '').trim().toLowerCase() === 'combobox') {
    return { field: true, kind: 'combobox' };
  }
  if (type in TEXT_TYPES) {
    const format = TEXT_TYPES[type] ?? INPUTMODE_FORMATS[(el.getAttribute('inputmode') ?? '').trim().toLowerCase()];
    return format === undefined ? { field: true, kind: 'text' } : { field: true, kind: 'text', format };
  }
  if (type in DATE_TYPES) {
    const format = DATE_TYPES[type];
    return format === undefined ? { field: true, kind: 'date' } : { field: true, kind: 'date', format };
  }
  if (type === 'radio' || type === 'checkbox' || type === 'file') return { field: true, kind: type };
  // hidden, submit, button, reset, image, range, color: never a field.
  return { field: false, auth: false };
}

/** A password or one-time-code control: the step needs the person (a sign-in, an account, an email code). */
export function isAuthField(el: Element): boolean {
  if (el.localName !== 'input') return false;
  const input = el as HTMLInputElement;
  if (input.type === 'password') return true;
  return autocompleteTokens(el).includes('one-time-code');
}

/** The autocomplete attribute's tokens, lower case, with section-*, shipping and billing removed. */
export function autocompleteTokens(el: Element): string[] {
  return (el.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/)
    .filter((token) => token !== '' && !token.startsWith('section-') && token !== 'shipping' && token !== 'billing');
}

/** Text-like controls: the ones a text value is written into. */
export function isTextLike(el: Element): el is HTMLInputElement | HTMLTextAreaElement {
  if (el.localName === 'textarea') return true;
  return el.localName === 'input' && (el as HTMLInputElement).type in TEXT_TYPES;
}

/** Disabled (its own attribute or a disabled fieldset) or aria-disabled. */
export function isDisabled(el: Element): boolean {
  if (el.matches(':disabled')) return true;
  return (el.getAttribute('aria-disabled') ?? '').trim().toLowerCase() === 'true';
}

/** Read-only text or date, which the person cannot type into either. Browsers ignore readonly on checkboxes, radios
 *  and file inputs, so it does not count there. */
export function isReadOnly(el: Element): boolean {
  const honoured = el.localName === 'textarea'
    || (el.localName === 'input' && !['checkbox', 'radio', 'file'].includes((el as HTMLInputElement).type));
  if (honoured && (el as HTMLInputElement).readOnly) return true;
  return (el.getAttribute('aria-readonly') ?? '').trim().toLowerCase() === 'true';
}
