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
 * v3 Phase 7b (the public capture of 2026-11-04/05: Workday's and Oracle's single-page sign-ins), held to the v3 Phase
 * 6/7b review (S5, S6, S8, C4), adds, for a form an adapter declares, and for it alone (SignInForm.declared, set by
 * signInFormOf; the standard rule acts as before):
 * - the adapter's own <form> element (SignInForm.form): every box and the button belong to it, and a form whose boxes
 *   have no form owner is refused ('shape');
 * - an email gate (wall 'email-gate'): an email box and no password; the standard rule reads none;
 * - on an account's creation, the email typed again (SignInForm.confirmEmail: SuccessFactors'), held as the email is;
 * - terms the adapter declares the account's own where the page marks none required (Workday's createAccountCheckbox):
 *   at most one box, a checkbox of the same form, enabled and under no aria-hidden, shown or not, labelled by a visible
 *   label whose own text reads clear against what is behind it (isCamouflaged 'clear'), words and not a mark alone;
 * - a button that is any element with role=button inside the form, the visible face a page draws over its own
 *   aria-hidden submit button (Workday's click_filter); a control that is no button at all, or one outside the form, is
 *   refused ('shape'). A disabled button is taken only where the adapter says the page enables it once the form is
 *   filled (SignInForm.enablesWhenFilled: Oracle's NEXT, iCIMS's Next behind its GDPR box), and the sign-in then waits a
 *   moment, bounded, for it after typing; otherwise a disabled button refuses the form ('disabled'), as before;
 * - a box the adapter names one by one as drawn in front of a background whose colours cannot be worked out
 *   (SignInForm.colourUnknown: Oracle's gate email, over its flow's image) is held to every honeypot rule but the colour
 *   test; never a password box, and every other box is held to them all;
 * - a form the page's own script sends (SignInForm.scriptSubmits): one with no method and no action written, which the
 *   browser would read as a GET to the page itself, passes the method rule on an https page of a host the every-site
 *   sign-in covers (contract signInHostCovered: the candidate hosts of Workday, iCIMS, Taleo, SuccessFactors and
 *   Oracle; since TailorIT's API 6, contract6, also UltiPro's and, by the page's path, its pathname, ADP's and
 *   ClearCompany's candidate pages alone, never their employee pages), and nowhere else. A written method other than
 *   POST, or a written action, is still refused.
 * The snapshot build of 2026-11-06 (core pass Z1, item 24) adds, for a declared form alone, a sign-in container
 * (SignInForm.container, Adapter.signInContainer, signInContainerOf) in place of the adapter's own <form>: ADP's guest
 * page (no <form>) and UltiPro's account step (its Create account outside its form). Every box inside the container, the
 * <form> its press would send (its boxes' owner, else the container itself when it is one) the container or inside it,
 * held to the method and origin rules above; the button the one the adapter names, in the container's document, inside
 * it or not, a native one belonging to no other form; no password, no confirmation and no password box inside it
 * (containerShape: a password goes only into an adapter's own <form>); and it may hold no box at all, its press alone.
 * While a sign-in presses and watches its button, guardSubmission (every form) cancels a native submission of the form
 * that would put the password in an address or send it elsewhere: any one of a form the page's own script sends, and
 * any one of another form that would go as anything but a POST to the page's own origin; and where such a submission
 * comes from the page's own form.submit() (no submit event), it takes the password out of its entry list (formdata).
 * A submission it allowed keeps its password in its own entry list, read by the submitter's formmethod and formaction
 * as the submit event had them (round 3, X6).
 */
import type { Adapter, SignInForm, SignInWall } from '../adapters/types';
import { signInHostCovered } from '../contract/tailorit/credentials';
import { isControlCamouflaged } from './camouflage';
import { autocompleteTokens } from './kinds';
import { newScanCache, type ScanCache } from './scan-cache';
import { readVisibleText } from './visible-text';
import { isUserVisible } from './visibility';

/** Why a sign-in form may not be filled. */
export const SIGN_IN_REFUSALS = ['not-https', 'hidden', 'honeypot', 'disabled', 'cross-origin', 'method', 'shape'] as const;
export type SignInRefusal = (typeof SIGN_IN_REFUSALS)[number];

/** The fewest letters a declared terms box's label must show a person (reachableTerms). */
const MIN_TERMS_LETTERS = 3;
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
  // An email gate is the adapter's to declare (v3 Phase 7b): a lone email box is no sign-in by the standard rule.
  if (wall === 'email-gate') return null;
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

/** The adapter's sign-in form (its hook), marked declared, else the standard one. A hook that throws declares none. */
export function signInFormOf(adapter: Adapter, doc: Document, wall: SignInWall, cache: ScanCache = newScanCache()):
  SignInForm | null {
  if (adapter.signInForm !== undefined) {
    try {
      const declared = adapter.signInForm(doc, wall);
      return declared === null ? null : { ...declared, declared: true };
    } catch {
      return null;
    }
  }
  return standardSignInForm(doc, wall, cache);
}

// ── snapshot build 2026-11-06 (core pass Z1, item 24) ──
/** The adapter's sign-in container on a page the run fills like a step (Adapter.signInContainer: ADP's guest page,
 *  UltiPro's account step), marked declared; null where it declares none, or names no container. A hook that throws
 *  declares none. */
export function signInContainerOf(adapter: Adapter, doc: Document): SignInForm | null {
  if (adapter.signInContainer === undefined) return null;
  try {
    const declared = adapter.signInContainer(doc);
    return declared === null || declared.container === undefined ? null : { ...declared, declared: true };
  } catch {
    return null;
  }
}

/** The <form> a declared container's press would send: the form its boxes belong to, else the container itself when it
 *  is a <form> (UltiPro's form#registrationDetailsForm, its Create account outside it), else none (ADP's guest page). */
function containerOwner(form: SignInForm): HTMLFormElement | null {
  const anchor = anchorOf(form);
  if (anchor !== null) return viaPrototype(anchor, 'HTMLInputElement', 'form') as HTMLFormElement | null;
  const container = form.container ?? null;
  return container !== null && container.localName === 'form' ? container as HTMLFormElement : null;
}
// ── end core pass Z1, item 24 ──

/** Whether a box looks like a trap for a program rather than a field for a person: out of the tab order, under
 *  aria-hidden, too small to type into, or drawn invisible against its background. A box a declared form names in
 *  colourUnknown (never a password box) is held to every rule but the last (module header). */
function honeypotLike(field: HTMLInputElement, cache: ScanCache, colourUnknown: boolean): boolean {
  if (field.getAttribute('tabindex') !== null && field.tabIndex < 0) return true;
  if (field.closest('[aria-hidden="true" i]') !== null) return true;
  const box = field.getBoundingClientRect();
  if (box.width < MIN_BOX_PX || box.height < MIN_BOX_PX) return true;
  return !colourUnknown && isControlCamouflaged(field, field.placeholder.trim() !== '' && field.value === '', cache);
}

/** A declared terms box a person can reach and read, shown or not: labelled by a visible label whose own text reads
 *  clear against what is behind it (the v3 Phase 6/7b review, S6; its round 3, X7: a box that shows, beside words drawn
 *  invisible, is no consent a person saw either). */
function reachableTerms(box: HTMLInputElement, cache: ScanCache): boolean {
  return Array.from(box.labels ?? []).some((label) => {
    if (!isUserVisible(label, cache)) return false;
    // All of the label's own text a person can read, none of it drawn invisible, and words, not a mark alone (a red
    // asterisk beside white-on-white terms: the v3 Phase 6/7b review's round 2, E6).
    const read = readVisibleText(label, { cache, singleLine: true });
    const letters = (String(read.text).match(/\p{L}/gu) ?? []).length;
    return read.dropped === 0 && letters >= MIN_TERMS_LETTERS;
  });
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

/** Whether `box` is still a password box of `owner` in its page (each read through its prototype's getter, which the
 *  page's own properties on the element cannot shadow): right before a password is written into it (v3 Phase 6/7b
 *  review, S7). */
export function passwordBoxIn(box: HTMLInputElement, owner: HTMLFormElement | null): boolean {
  return viaPrototype(box, 'Node', 'isConnected') === true && viaPrototype(box, 'HTMLInputElement', 'type') === 'password'
    && viaPrototype(box, 'HTMLInputElement', 'form') === owner;
}

/** The box a form's reading hangs on: its password box, or an email gate's email box. */
export function anchorOf(form: SignInForm): HTMLInputElement | null {
  return form.password ?? form.email;
}

/** The method a submission of `form` would use, as the browser reads it: the submitter's formmethod where it writes one,
 *  else the form's own. */
function submissionMethod(form: HTMLFormElement, submitter: Element | null): string {
  if (submitter !== null && ['button', 'input'].includes(submitter.localName)) {
    const written = attributeOf(submitter, 'formmethod');
    if (written !== null && written.trim() !== '') {
      const method = viaPrototype(submitter, controlCtor(submitter), 'formMethod');
      return typeof method === 'string' ? method.toLowerCase() : 'get';
    }
  }
  return methodOf(form);
}

/** Whether a submission of `form` (by `submitter`, or none) would go to the page's own origin: the submitter's
 *  formaction where it writes one, and the form's action, each as the browser resolves it. */
function submissionHome(form: HTMLFormElement, submitter: Element | null, page: URL): boolean {
  if (!sendsHome(form, 'HTMLFormElement', 'action', 'action', page)) return false;
  return submitter === null || !['button', 'input'].includes(submitter.localName)
    || sendsHome(submitter, controlCtor(submitter), 'formaction', 'formAction', page);
}

/**
 * v3 Phase 7b, held to the v3 Phase 6/7b review (S5) and its round 2 (E5): while a sign-in presses and watches its
 * button, the browser never sends the sign-in's form itself where the password would go into an address or elsewhere.
 * - A submit event whose target is, at that moment, the form that owns the box the reading hangs on (anchorOf), or the
 *   one it owned when the form was read, and that nothing before cancelled, is cancelled: every one of a form the
 *   page's own script sends (SignInForm.scriptSubmits), whatever its method; any other that would go as anything but a
 *   POST to the page's own origin (`page`), by the submitter's formmethod and formaction, else the form's.
 * - The page's own form.submit() fires no submit event, only formdata (as every submission does, and a FormData the
 *   page builds from the form): where the guard would cancel the form's submission (its own method and action read),
 *   the password and its confirmation are taken out of that entry list, so no address and no other origin ever gets
 *   them. A page that builds a FormData of a script-sent form to send it itself gets no password then: its sign-in
 *   fails, closed.
 * Both listen on the window in the capture phase, before any listener of the page can stop the event on its way; a
 * page whose own handlers skip an event already cancelled does not sign in, which fails closed too. Nothing else is
 * touched. Answers how to stop guarding.
 */
export function guardSubmission(form: SignInForm, page: URL, signal: AbortSignal): () => void {
  const anchor = anchorOf(form);
  // Core pass Z1, item 24: a declared container with no box guards the <form> its press would send (containerOwner).
  const container = anchor === null && form.declared === true ? containerOwner(form) : null;
  const view = (anchor ?? container)?.ownerDocument.defaultView ?? null;
  if ((anchor === null && container === null) || view === null) return () => undefined;
  const held = anchor === null ? container : viaPrototype(anchor, 'HTMLInputElement', 'form');
  /** The guarded form `target` is, at this moment, or null. */
  const guarded = (target: EventTarget | null): HTMLFormElement | null => {
    const owner = anchor === null ? container : viaPrototype(anchor, 'HTMLInputElement', 'form');
    return target !== null && (target === owner || target === held) ? target as HTMLFormElement : null;
  };
  const refused = (sent: HTMLFormElement, submitter: Element | null) => form.scriptSubmits === true
    || submissionMethod(sent, submitter) !== 'post' || !submissionHome(sent, submitter, page);
  // A submission onSubmit allowed (its submitter's formmethod and formaction counted), until its own form data is read
  // in the same run of the browser's submission: that event names no submitter, so it would be judged by the form's own
  // method alone (round 3, X6). The mark is spent there, or cleared at the next microtask.
  let allowed: HTMLFormElement | null = null;
  const onSubmit = (event: Event) => {
    if (event.defaultPrevented) return;
    const sent = guarded(event.target);
    if (sent === null) return;
    if (refused(sent, (event as SubmitEvent).submitter ?? null)) {
      event.preventDefault();
      return;
    }
    allowed = sent;
    queueMicrotask(() => {
      if (allowed === sent) allowed = null;
    });
  };
  const secretNames = [form.password, form.confirm].filter((box): box is HTMLInputElement => box !== null)
    .map((box) => viaPrototype(box, 'HTMLInputElement', 'name')).filter((name): name is string => typeof name === 'string'
      && name !== '');
  const onFormData = (event: Event) => {
    const sent = guarded(event.target);
    const data = (event as FormDataEvent).formData;
    if (sent === null || data === undefined) return;
    if (sent === allowed) {
      allowed = null;
      return;
    }
    if (!refused(sent, null)) return;
    for (const name of secretNames) data.delete(name);
  };
  view.addEventListener('submit', onSubmit, true);
  view.addEventListener('formdata', onFormData, true);
  const stop = () => {
    view.removeEventListener('submit', onSubmit, true);
    view.removeEventListener('formdata', onFormData, true);
    signal.removeEventListener('abort', stop);
  };
  signal.addEventListener('abort', stop, { once: true });
  return stop;
}

/** Why `form` may not be filled on the page at `address`, or null when it may (module header). */
export function signInRefusal(form: SignInForm, address: URL, cache: ScanCache = newScanCache()): SignInRefusal | null {
  // A page that breaks the reading (a control named "getAttribute" shadowing the form's own) is never filled.
  try {
    return refusalOf(form, address, cache);
  } catch {
    return 'shape';
  }
}

/** Whether the browser reads `owner` as a form its page's script sends, as the adapter declared it: no method and no
 *  action written (module header). */
function scriptSent(owner: HTMLFormElement): boolean {
  const written = (name: string) => {
    const value = attributeOf(owner, name);
    return value !== null && value.trim() !== '';
  };
  return !written('method') && !written('action');
}

/** Whether `button` is a control a person presses: a button, an input button, or an element with role=button. */
function pressControl(button: Element): boolean {
  if (button.localName === 'button') return true;
  if (button.localName === 'input') return ['submit', 'button', 'image'].includes((button as HTMLInputElement).type);
  return (button.getAttribute('role') ?? '').trim().toLowerCase() === 'button';
}

function refusalOf(form: SignInForm, address: URL, cache: ScanCache): SignInRefusal | null {
  if (address.protocol !== 'https:') return 'not-https';
  const anchor = anchorOf(form);
  const declared = form.declared === true;
  const confirmEmail = form.confirmEmail ?? null;
  // Core pass Z1, item 24: a declared container in place of the adapter's own <form> (containerShape).
  const container = form.container ?? null;
  if (container !== null) {
    const shape = containerShape(form, container, declared);
    if (shape !== null) return shape;
  }
  // An email gate has its email and no password (or confirmation); every other form its password box. The email typed
  // again only beside the email, on a declared form. A declared container may hold no box at all: its press alone.
  if ((anchor === null && container === null) || (form.password === null && form.confirm !== null)) return 'shape';
  if (confirmEmail !== null && (!declared || form.email === null)) return 'shape';
  if ((form.password !== null && form.password.type !== 'password')
    || (form.confirm !== null && form.confirm.type !== 'password')
    || (form.email !== null && form.email.type === 'password')
    || (confirmEmail !== null && confirmEmail.type === 'password')) return 'shape';
  const fields = [form.email, confirmEmail, form.password, form.confirm]
    .filter((field): field is HTMLInputElement => field !== null);
  // The colour test's opt-out: a declared form's own boxes, never a password box (module header).
  const unread = declared ? form.colourUnknown ?? [] : [];
  if (unread.some((box) => box.type === 'password' || !fields.includes(box))) return 'shape';
  for (const field of fields) {
    if (!field.isConnected || !isUserVisible(field, cache)) return 'hidden';
    if (field.disabled || field.readOnly) return 'disabled';
    if (honeypotLike(field, cache, unread.includes(field))) return 'honeypot';
  }
  // The document the form is read in: its anchor box's, or (a box-less container) the container's.
  const doc = (anchor ?? container)!.ownerDocument;
  const owner = anchor !== null ? anchor.form : containerOwner(form);
  if (fields.some((field) => field.form !== owner || field.ownerDocument !== doc)) {
    return 'shape';
  }
  if (container !== null) {
    // Core pass Z1, item 24: every box inside the container, and the <form> its press would send the container itself
    // or inside it, never one around it holding more of the page.
    if (fields.some((field) => !holds(container, field))) return 'shape';
    if (owner !== null && owner !== container && !holds(container, owner)) return 'shape';
  } else if (declared && (owner === null || form.form === undefined || owner !== form.form)) {
    // A declared form is the adapter's own <form>, and its boxes' owner (the v3 Phase 6/7b review, S8).
    return 'shape';
  }
  // The terms, each the form's own checkbox a person can see or reach by its label; a declared form's one at most.
  if (declared && form.terms.length > 1) return 'shape';
  for (const box of form.terms) {
    if (box.localName !== 'input' || box.type !== 'checkbox' || box.form !== owner
      || box.ownerDocument !== doc || (container !== null && !holds(container, box))) return 'shape';
    if (!box.isConnected) return 'hidden';
    if (declared ? !reachableTerms(box, cache) : !shownOrLabelled(box, cache)) return 'hidden';
    if (box.disabled) return 'disabled';
    if (box.closest('[aria-hidden="true" i]') !== null) return 'honeypot';
  }
  if (owner !== null && !sendsHome(owner, 'HTMLFormElement', 'action', 'action', address)) return 'cross-origin';
  if (owner !== null && methodOf(owner) !== 'post'
    && !(form.scriptSubmits === true && declared && scriptSent(owner)
      && signInHostCovered(address.hostname, address.pathname))) {
    return 'method';
  }
  const button = form.button;
  if (!button.isConnected || !isUserVisible(button, cache)) return 'hidden';
  // A disabled button refuses the form, unless the adapter says its page enables it once the form is filled (module
  // header): the sign-in door of dom/fillers/not-submit.ts presses it only once enabled.
  if (((button as HTMLButtonElement).disabled === true || button.getAttribute('aria-disabled') === 'true')
    && !(declared && form.enablesWhenFilled === true)) return 'disabled';
  if (!pressControl(button) || button.ownerDocument !== doc) return 'shape';
  const ctor = controlCtor(button);
  const native = ['button', 'input'].includes(button.localName);
  if (native) {
    if (!sendsHome(button, ctor, 'formaction', 'formAction', address)) return 'cross-origin';
    const override = attributeOf(button, 'formmethod');
    if (override !== null && override.trim() !== '') {
      const method = viaPrototype(button, ctor, 'formMethod');
      if (typeof method !== 'string' || method.toLowerCase() !== 'post') return 'method';
    }
  } else if (!declared) {
    return 'shape';
  }
  if (container !== null) {
    // Core pass Z1, item 24: a container's button, the one the adapter names, sits in its document, inside it or not
    // (UltiPro's Create account, outside its form); a native one never belongs to another form than the container's.
    const buttonForm = native ? viaPrototype(button, ctor, 'form') : null;
    return buttonForm === null || buttonForm === undefined || buttonForm === owner ? null : 'shape';
  }
  // A native control belongs to the form (its owner, or inside it); any other pressed element sits inside it.
  if (owner !== null && (native ? (button as HTMLButtonElement).form !== owner && !holds(owner, button)
    : !holds(owner, button))) return 'shape';
  return null;
}

// ── snapshot build 2026-11-06 (core pass Z1, item 24) ──
/**
 * Why a declared container may not stand for the adapter's own <form>, or null: only an adapter declares one, never
 * beside a <form>; it is connected; and it is no place for a password (the "password box" guard: no password or
 * confirmation slot, and no password box inside it; a password goes only into an adapter's own <form>, which
 * guardSubmission holds to a POST to the page's own origin). Every other rule of signInRefusal holds it as a form.
 */
function containerShape(form: SignInForm, container: Element, declared: boolean): SignInRefusal | null {
  if (!declared || form.form !== undefined) return 'shape';
  if (form.password !== null || form.confirm !== null || (form.confirmEmail ?? null) !== null) return 'shape';
  if (within<HTMLInputElement>(container, 'input').some((input) => viaPrototype(input, 'HTMLInputElement', 'type')
    === 'password')) return 'shape';
  return container.isConnected ? null : 'hidden';
}
// ── end core pass Z1, item 24 ──
