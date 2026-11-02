/*
 * The sign-in and create-account forms Sign-in mode Auto fills (v3 Phase 5; docs/SPEC-AMENDMENTS.md §12 Decision 10),
 * read without writing anything. An adapter may declare its platform's own (Adapter.signInForm); otherwise the
 * standard rule reads one (standardSignInForm):
 * - sign-in: the visible password box marked autocomplete="current-password", else the page's only visible one;
 * - create-account: the visible boxes marked autocomplete="new-password", else the visible password boxes, one or two
 *   (the second the password typed again);
 * - all of them in one <form>; the email or user name, at most one visible box of that form marked
 *   autocomplete="username" or "email", else its one visible type="email" box (none: the page asks for the password
 *   alone);
 * - the form's one visible submit control (Sign in, Create account): two or none is no form;
 * - the form's required boxes still unticked (the account's terms).
 * signInRefusal then holds every field to the rules a password goes into a page under: an https page; each box
 * connected, visible to a person, enabled and editable, and not a honeypot (out of the tab order, under aria-hidden,
 * drawn invisible against its background, or too small to type into); every box in the same form, whose action, and
 * its button's formaction, resolved as the browser resolves them (against the document's base address, so a <base>
 * that points elsewhere counts), stay on the page's own origin, and whose method (or the button's formmethod) is POST
 * (never GET, which would put the password in an address, nor dialog); the button visible and enabled. The form's own
 * properties are read through their prototypes' getters (a form's named controls, an input named "action" say, shadow
 * the form's properties, never its prototype's). A field the rules refuse is never filled, and no other box is filled in
 * its place.
 */
import type { Adapter, SignInForm, SignInWall } from '../adapters/types';
import { isControlCamouflaged } from './camouflage';
import { autocompleteTokens } from './kinds';
import { newScanCache, type ScanCache } from './scan-cache';
import { isUserVisible } from './visibility';

/** Why a sign-in form may not be filled. */
export const SIGN_IN_REFUSALS = ['not-https', 'hidden', 'honeypot', 'disabled', 'cross-origin', 'method', 'shape'] as const;
export type SignInRefusal = (typeof SIGN_IN_REFUSALS)[number];

/** The smallest box a person types into (CSS pixels): a honeypot is often drawn smaller. */
const MIN_BOX_PX = 8;

/** The element's window's constructor `name` (HTMLFormElement, Element, ...), or undefined. */
function ctorOf(el: Element, name: string): { prototype: object } | undefined {
  const view = el.ownerDocument.defaultView as unknown as Record<string, { prototype: object } | undefined> | null;
  return view?.[name];
}

/** A property read through the getter of `ctor`'s prototype, which a form's named controls cannot shadow. */
function viaPrototype(el: Element, ctor: string, name: string): unknown {
  const proto = ctorOf(el, ctor)?.prototype;
  const getter = proto === undefined ? undefined : Object.getOwnPropertyDescriptor(proto, name)?.get;
  return getter === undefined ? undefined : getter.call(el);
}

/** An attribute, read through Element.prototype (a form's named controls can shadow its getAttribute). */
function attributeOf(el: Element, name: string): string | null {
  const get = (ctorOf(el, 'Element')?.prototype as { getAttribute?: (this: Element, n: string) => string | null } | undefined)
    ?.getAttribute;
  return get === undefined ? null : get.call(el, name);
}

/** The elements under `el` matching `selector`, through Element.prototype (never a shadowing control's). */
function within<T extends Element>(el: Element, selector: string): T[] {
  const query = (ctorOf(el, 'Element')?.prototype as { querySelectorAll?: (this: Element, s: string) => NodeListOf<T> }
    | undefined)?.querySelectorAll;
  return query === undefined ? [] : Array.from(query.call(el, selector));
}

/** Whether `outer` holds `inner`, through Node.prototype. */
function holds(outer: Element, inner: Element): boolean {
  const contains = (ctorOf(outer, 'Node')?.prototype as { contains?: (this: Node, other: Node) => boolean } | undefined)
    ?.contains;
  return contains !== undefined && contains.call(outer, inner);
}

/** A form's submit controls: a button whose type is submit (a typeless one included), input type=submit or image. */
function submitControls(form: HTMLFormElement): HTMLElement[] {
  const elements = viaPrototype(form, 'HTMLFormElement', 'elements') as HTMLFormControlsCollection | undefined;
  return Array.from(elements ?? []).filter((el): el is HTMLElement => (el.localName === 'button'
    && (el as HTMLButtonElement).type === 'submit')
    || (el.localName === 'input' && ['submit', 'image'].includes((el as HTMLInputElement).type)));
}

/** A box a person can see, or whose visible <label> stands for it (a styled checkbox drawn by its label). */
function shownOrLabelled(input: HTMLInputElement, cache: ScanCache): boolean {
  if (isUserVisible(input, cache)) return true;
  return Array.from(input.labels ?? []).some((label) => isUserVisible(label, cache));
}

/** The standard sign-in or create-account form of a document (module header), or null when it shows none, or more
 *  than one reading of one. */
export function standardSignInForm(doc: Document, wall: SignInWall, cache: ScanCache = newScanCache()): SignInForm | null {
  const inputs = Array.from(doc.querySelectorAll('input')).filter((input) => isUserVisible(input, cache));
  const passwords = inputs.filter((input) => input.type === 'password');
  let password: HTMLInputElement | null = null;
  let confirm: HTMLInputElement | null = null;
  if (wall === 'sign-in') {
    const current = passwords.filter((input) => autocompleteTokens(input).includes('current-password'));
    password = current.length === 1 ? current[0]! : current.length === 0 && passwords.length === 1 ? passwords[0]! : null;
  } else {
    const fresh = passwords.filter((input) => autocompleteTokens(input).includes('new-password'));
    const pool = fresh.length > 0 ? fresh : passwords;
    if (pool.length < 1 || pool.length > 2) return null;
    password = pool[0]!;
    confirm = pool[1] ?? null;
  }
  if (password === null) return null;
  const form = password.form;
  if (form === null || (confirm !== null && confirm.form !== form)) return null;
  const inForm = inputs.filter((input) => input.form === form && input.type !== 'password');
  const named = inForm.filter((input) => autocompleteTokens(input).some((token) => token === 'username' || token === 'email'));
  const emails = named.length > 0 ? named : inForm.filter((input) => input.type === 'email');
  if (emails.length > 1) return null;
  const buttons = submitControls(form).filter((button) => isUserVisible(button, cache));
  if (buttons.length !== 1) return null;
  const terms = within<HTMLInputElement>(form, 'input[type="checkbox"]').filter((box) => !box.checked
    && !box.disabled && (box.required || box.getAttribute('aria-required') === 'true') && shownOrLabelled(box, cache));
  return { email: emails[0] ?? null, password, confirm, terms, button: buttons[0]! };
}

/** The adapter's sign-in form (its hook), else the standard one. A hook that throws declares none. */
export function signInFormOf(adapter: Adapter, doc: Document, wall: SignInWall, cache: ScanCache = newScanCache()):
  SignInForm | null {
  if (adapter.signInForm !== undefined) {
    try {
      return adapter.signInForm(doc, wall);
    } catch {
      return null;
    }
  }
  return standardSignInForm(doc, wall, cache);
}

/** Whether a box looks like a trap for a program rather than a field for a person. */
function honeypotLike(field: HTMLInputElement, cache: ScanCache): boolean {
  if (field.getAttribute('tabindex') !== null && field.tabIndex < 0) return true;
  if (field.closest('[aria-hidden="true" i]') !== null) return true;
  const box = field.getBoundingClientRect();
  if (box.width < MIN_BOX_PX || box.height < MIN_BOX_PX) return true;
  return isControlCamouflaged(field, field.placeholder.trim() !== '' && field.value === '', cache);
}

/** Whether the address a form, or its button, sends to stays on the page's own origin: none written (the document's
 *  own address) does; one written is read as the browser resolves it, against the document's base address (its
 *  prototype's `action` / `formAction` getter). */
function sendsHome(el: Element, ctor: string, attribute: 'action' | 'formaction', property: 'action' | 'formAction',
  page: URL): boolean {
  const written = attributeOf(el, attribute);
  if (written === null || written.trim() === '') return true;
  const resolved = viaPrototype(el, ctor, property);
  if (typeof resolved !== 'string') return false;
  try {
    return new URL(resolved).origin === page.origin;
  } catch {
    return false;
  }
}

/** The method a form sends with, as the browser reads it (its prototype's getter: 'get' when none is written). */
function methodOf(form: HTMLFormElement): string {
  const method = viaPrototype(form, 'HTMLFormElement', 'method');
  return typeof method === 'string' ? method.toLowerCase() : 'get';
}

/** The constructor whose prototype holds a submit control's formAction and formMethod. */
const controlCtor = (button: Element) => (button.localName === 'input' ? 'HTMLInputElement' : 'HTMLButtonElement');

/** Why `form` may not be filled on the page at `address`, or null when it may (module header). */
export function signInRefusal(form: SignInForm, address: URL, cache: ScanCache = newScanCache()): SignInRefusal | null {
  // A page that breaks the reading (a control named "getAttribute" shadowing the form's own) is never filled.
  try {
    return refusalOf(form, address, cache);
  } catch {
    return 'shape';
  }
}

function refusalOf(form: SignInForm, address: URL, cache: ScanCache): SignInRefusal | null {
  if (address.protocol !== 'https:') return 'not-https';
  if (form.password.type !== 'password' || (form.confirm !== null && form.confirm.type !== 'password')
    || (form.email !== null && form.email.type === 'password')) return 'shape';
  const fields = [form.email, form.password, form.confirm].filter((field): field is HTMLInputElement => field !== null);
  for (const field of fields) {
    if (!field.isConnected || !isUserVisible(field, cache)) return 'hidden';
    if (field.disabled || field.readOnly) return 'disabled';
    if (honeypotLike(field, cache)) return 'honeypot';
  }
  const owner = form.password.form;
  if (fields.some((field) => field.form !== owner) || fields.some((field) => field.ownerDocument !== form.password.ownerDocument)) {
    return 'shape';
  }
  if (owner !== null && !sendsHome(owner, 'HTMLFormElement', 'action', 'action', address)) return 'cross-origin';
  if (owner !== null && methodOf(owner) !== 'post') return 'method';
  const button = form.button;
  if (!button.isConnected || !isUserVisible(button, cache)) return 'hidden';
  if ((button as HTMLButtonElement).disabled === true || button.getAttribute('aria-disabled') === 'true') return 'disabled';
  const ctor = controlCtor(button);
  if (['button', 'input'].includes(button.localName)) {
    if (!sendsHome(button, ctor, 'formaction', 'formAction', address)) return 'cross-origin';
    const override = attributeOf(button, 'formmethod');
    if (override !== null && override.trim() !== '') {
      const method = viaPrototype(button, ctor, 'formMethod');
      if (typeof method !== 'string' || method.toLowerCase() !== 'post') return 'method';
    }
  }
  if (owner !== null && (button as HTMLButtonElement).form !== undefined && (button as HTMLButtonElement).form !== owner
    && !holds(owner, button)) return 'shape';
  return null;
}
