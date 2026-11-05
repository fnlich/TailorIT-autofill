/*
 * Never submit (docs/ARCHITECTURE.md "Filler"; docs/design/runtime.md §6). submit() and requestSubmit() are banned by
 * lint everywhere, and every untrusted click() the extension makes goes through assertNotSubmit, which refuses:
 * - the adapter's Submit button, anything inside it, and anything that holds it;
 * - the adapter's Next button, anything inside it and anything that holds it, unless the step machine allows Next (an
 *   Add, an option or a box is never the step's Next: the Phase 5 review, X-S7);
 * - the buttons the adapter names never to press (neverPress: Greenhouse's "Autofill my application", "Locate me",
 *   Dropbox, Google Drive, "Enter manually", "Clear selections" and a chip's remove button), and anything inside them;
 * - any element whose text is a submit word (submit, apply, send, finish, complete, confirm), but a checkbox or a
 *   radio, which toggle and never submit, and "confirm" in an option of an open list, which chooses a value (a
 *   consent's one option "Acknowledge/Confirm"; "I confirm and submit" is still refused);
 * - any element whose activation would submit a form: a button with a form owner whose .type is "submit" (a typeless
 *   button included), input[type=submit] and input[type=image], anything inside such a button, and a <label> (or an
 *   element inside one) whose control is refused.
 * The only exceptions are the adapter's Next button, and only when the caller passes allowNext: the step machine does
 * so on a step the adapter declared not final, after the auto-advance checks; even then the Submit button and the
 * submit words stay refused. And (v3 Phase 4, docs/SPEC-AMENDMENTS.md §12 Decision 6) the adapter's Submit button
 * itself, through clickAdapterSubmit alone: no flag a caller can pass opens it. That function finds the adapter's own
 * Submit itself (a caller names no element) and passes this module's unexported SUBMIT_PRESS key to the check, so
 * nothing outside this file can make assertNotSubmit or clickIfAllowed let Submit through. One module alone may call
 * it (src/content/press.ts: the panel's "Submit application" on the person's trusted click, and Submit mode Auto): a
 * lint rule bans its name everywhere else (eslint.config.mjs), it is not exported from fillers/index.ts, and
 * test/allow-submit.test.ts holds both. It presses only on a step the adapter declares final, and never an element the
 * adapter names never to press: the exception is that one element, so anything inside it, anything holding it, another
 * submit control and every submit word elsewhere stay refused. A refused click leaves the field flagged
 * needs-your-click; it is never retried another way.
 * A declared key (Escape to a dropdown's list) is checked by assertKeyTarget: the same refusals, the submit words read
 * in the element's own words only, since a key chooses nothing and a list holds its options' words (the Phase 7a
 * review).
 * v3 Phase 5 opens two more doors, each in this file, each finding its one element itself, each named by one module
 * alone (eslint.config.mjs, test/allow-submit.test.ts): clickAdapterEntry, the auto-apply agent's press of a posting
 * page's declared Apply (src/content/press.ts), and clickAdapterSignIn, Sign-in mode Auto's press of a sign-in form's
 * button (src/content/sign-in.ts). Neither opens assertNotSubmit or clickIfAllowed for anyone.
 * A choice made through the page-world bridge (docs/SPEC-AMENDMENTS.md §12) clicks nothing, and the option it names
 * may not be drawn yet (a closed list): its text box goes through assertNotSubmit, and the option's label, as the
 * frame read it, through optionWordsRefusal, the word rule an option of an open list gets here ("confirm" chooses a
 * value; any other submit word refuses it). The element rules (Submit, Next, the never-pressed buttons, a label of a
 * refused control) are for elements, and a list's option is none of those (listOption: it holds no button, link or
 * input). A refused option is not sent: its click, on the events' path, goes through assertNotSubmit as before.
 */
import type { Adapter, SignInWall } from '../../adapters/types';
import { signInFormOf, signInRefusal } from '../sign-in-form';
import { isUserVisible } from '../visibility';

/** The words that make a control a submit control (the plan's list). */
export const SUBMIT_WORDS = /\b(?:submit|apply|send|finish|complete|confirm)\b/i;

/** Why a click was refused. */
export const CLICK_REFUSALS = ['adapter-submit', 'submit-word', 'submits-form', 'adapter-next', 'inside-submit',
  'label-of-refused', 'adapter-never-press'] as const;
export type ClickRefusal = (typeof CLICK_REFUSALS)[number];

/** The Submit exception's key: unexported, so only clickAdapterSubmit in this file can hold it. */
const SUBMIT_PRESS: unique symbol = Symbol('submit-press');

/** Where the adapter's Submit and Next buttons are looked up, and whether the step machine allows Next. */
export interface NotSubmitContext {
  adapter: Adapter | null;
  /** The form root the adapter's buttons are looked up in. */
  root: Element | null;
  /** The step machine's Next exception. Never set by a filler. */
  allowNext?: boolean;
}

/** The context clickAdapterSubmit checks with: SUBMIT_PRESS, which no caller outside this file can name. */
interface SubmitPressContext extends NotSubmitContext {
  [SUBMIT_PRESS]?: true;
}

/** Whether `el` may receive an untrusted click. */
export function assertNotSubmit(el: Element, ctx: NotSubmitContext): { ok: true } | { ok: false; refusal: ClickRefusal } {
  const refusal = refusalOf(el, ctx, 0);
  return refusal === null ? { ok: true } : { ok: false, refusal };
}

/** Whether a declared key (WidgetDecl.keys: Escape) may be sent to `el`, which is never clicked: assertNotSubmit's
 *  refusals, but with the submit words read in the element's own words alone (its aria-label and its own text nodes),
 *  never its options': a dropdown's list whose option says "I will submit my portfolio later" still takes its Escape
 *  (the Phase 7a review), while a list named "Submit" or one inside a submit button is still refused. */
export function assertKeyTarget(el: Element, ctx: NotSubmitContext):
  { ok: true } | { ok: false; refusal: ClickRefusal } {
  const refusal = refusalOf(el, ctx, 0, true);
  return refusal === null ? { ok: true } : { ok: false, refusal };
}

/** Clicks `el` with an untrusted click() if assertNotSubmit allows it; returns whether it clicked. */
export function clickIfAllowed(el: HTMLElement, ctx: NotSubmitContext): boolean {
  if (!assertNotSubmit(el, ctx).ok) return false;
  el.click();
  return true;
}

/**
 * v3 Phase 4: presses the adapter's own Submit button once, with an untrusted click(), when the Submit exception allows
 * it (module header): the step declared final, that one element, never a Next or a never-pressed button. Answers the
 * element clicked, or null when nothing was. Only src/content/press.ts may call it (eslint.config.mjs).
 */
export function clickAdapterSubmit(adapter: Adapter, root: Element): HTMLElement | null {
  let submit: HTMLElement | null = null;
  try {
    submit = adapter.submitButton?.(root) ?? null;
  } catch {
    return null;
  }
  if (submit === null) return null;
  const ctx: SubmitPressContext = { adapter, root, [SUBMIT_PRESS]: true };
  if (refusalOf(submit, ctx, 0) !== null) return null;
  submit.click();
  return submit;
}

/** Whether `el` is the application form's own Submit, Next or a button the adapter names never to press, or holds or
 *  sits inside one, on the form the adapter finds in `doc` now (none shown: none of them). */
function nearApplicationButtons(el: Element, adapter: Adapter, doc: Document): boolean {
  let root: Element | null = null;
  try {
    root = adapter.detect(doc)?.formRoot ?? null;
  } catch {
    return true;
  }
  if (root === null) return false;
  const near = (other: Element | null | undefined) => other != null && (other === el || other.contains(el) || el.contains(other));
  try {
    return near(adapter.submitButton?.(root)) || near(adapter.nextButton?.(root))
      || (adapter.neverPress?.(root) ?? []).some((button) => near(button));
  } catch {
    return true;
  }
}

/** Whether a control can be pressed by a person now: connected, visible, enabled. */
function pressableNow(el: HTMLElement): boolean {
  return el.isConnected && isUserVisible(el) && (el as HTMLButtonElement).disabled !== true
    && el.getAttribute('aria-disabled') !== 'true';
}

/**
 * v3 Phase 5, the auto-apply agent: on a posting page that shows no application form, presses the adapter's declared
 * entry control once (Adapter.entryControl: Greenhouse's and Lever's Apply, Ashby's Application tab), with an untrusted
 * click(). It finds the control itself (a caller names no element); never one that submits a form, never while the
 * adapter finds an application form on the page (its Submit, Next and never-pressed buttons stay refused), never one a
 * person cannot see or press, and never one of the adapter's never-pressed controls (neverPress, read over the whole
 * page), or one holding or inside one, unless the adapter marks its entry as that one (entryNeverPressed: Ashby's
 * Application tab), and then that element alone. Its words ("Apply") are submit words, which is why it has a door of its
 * own: that one element, and nothing near it. Answers the element clicked, or null. Only src/content/press.ts may call
 * it (eslint.config.mjs), for the agent's agent/enter alone.
 */
export function clickAdapterEntry(adapter: Adapter, doc: Document): HTMLElement | null {
  let control: HTMLElement | null = null;
  try {
    control = adapter.entryControl?.(doc) ?? null;
  } catch {
    return null;
  }
  if (control === null || control.ownerDocument !== doc || !pressableNow(control) || submitsForm(control)) return null;
  let formShown: Element | null = null;
  try {
    formShown = adapter.detect(doc)?.formRoot ?? null;
  } catch {
    return null;
  }
  if (formShown !== null) return null;
  let never: Element[] = [];
  try {
    never = adapter.neverPress?.(doc.documentElement) ?? [];
  } catch {
    return null;
  }
  const exempt = (other: Element) => adapter.entryNeverPressed === true && other === control;
  if (never.some((other) => !exempt(other) && (other === control || other.contains(control) || control!.contains(other)))) {
    return null;
  }
  control.click();
  return control;
}

/**
 * v3 Phase 5, Sign-in mode Auto: presses the sign-in or create-account form's one button (Sign in, Create account), as
 * the adapter declares it or the standard rule reads it (dom/sign-in-form.ts signInFormOf), with an untrusted click().
 * It finds the button itself; never while signInRefusal refuses the form at `address` (a field hidden, a honeypot, http,
 * a form posting to another origin), never the application form's own Submit, Next or a never-pressed button, never one
 * a person cannot see or press. Answers the element clicked, or null. Only src/content/sign-in.ts may call it
 * (eslint.config.mjs), after it filled the form.
 */
export function clickAdapterSignIn(adapter: Adapter, doc: Document, wall: SignInWall, address: URL): HTMLElement | null {
  const form = signInFormOf(adapter, doc, wall);
  if (form === null || signInRefusal(form, address) !== null) return null;
  const button = form.button;
  if (button.ownerDocument !== doc || !pressableNow(button) || nearApplicationButtons(button, adapter, doc)) return null;
  button.click();
  return button;
}

/** Whether the Submit exception would let `el` through (for the tests and the checks that read it; it clicks
 *  nothing): exactly the adapter's own Submit, on a final step, and nothing near it. */
export function submitPressAllowed(el: Element, adapter: Adapter, root: Element): boolean {
  const ctx: SubmitPressContext = { adapter, root, [SUBMIT_PRESS]: true };
  return refusalOf(el, ctx, 0) === null;
}

function refusalOf(el: Element, ctx: NotSubmitContext, depth: number, ownWords = false): ClickRefusal | null {
  if (depth === 0 && submitException(el, ctx)) return null;
  const submitButton = ctx.root !== null ? ctx.adapter?.submitButton?.(ctx.root) ?? null : null;
  if (submitButton !== null && (submitButton.contains(el) || el.contains(submitButton))) return 'adapter-submit';
  if (SUBMIT_WORDS.test(ownWords && depth === 0 ? ownText(el) : shownText(el))) return 'submit-word';
  if (submitsForm(el) && !nextException(el, ctx)) return 'submits-form';
  // Next itself, on the step machine's word on a step declared not final, is the one click near it that may be made.
  const next = ctx.root !== null ? ctx.adapter?.nextButton?.(ctx.root) ?? null : null;
  if (next !== null && (next.contains(el) || el.contains(next)) && !nextException(el, ctx)) return 'adapter-next';
  const never = ctx.root !== null ? ctx.adapter?.neverPress?.(ctx.root) ?? [] : [];
  if (never.some((button) => button.contains(el))) return 'adapter-never-press';
  const button = el.parentElement?.closest('button') ?? null;
  if (button !== null && depth < 4 && refusalOf(button, ctx, depth + 1) !== null) return 'inside-submit';
  const label = el.closest('label');
  const control = label?.control ?? null;
  if (control !== null && control !== el && depth < 4 && refusalOf(control, ctx, depth + 1) !== null) {
    return 'label-of-refused';
  }
  return null;
}

/** An option of an open list (role="option" inside a role="listbox"), no button, link or input itself and holding
 *  none: choosing it picks a value (the live BeyondTrust form's one option "Acknowledge/Confirm"). */
function listOption(el: Element): boolean {
  return el.getAttribute('role') === 'option' && el.parentElement?.closest('[role="listbox"]') !== null
    && !['button', 'input', 'a'].includes(el.localName)
    && el.querySelector('button, input, a[href], [role="button"], [role="link"]') === null;
}

/** The one submit word that is also how a consent agrees ("Acknowledge/Confirm", "I confirm"). */
const CONSENT_SUBMIT_WORD = /\bconfirm\w*/gi;

/** A list option's words with "confirm" left out: it chooses a value there. */
const optionWords = (text: string) => text.replace(CONSENT_SUBMIT_WORD, ' ');

/** Why an option of a list, by its label alone, may not be chosen: 'submit-word' when its words, "confirm" left out,
 *  hold a submit word ("I confirm and submit"), as an open list's option's click is refused (see the header); null
 *  otherwise ("Acknowledge/Confirm"). Pure: the bridge's choices, whose option may not be drawn, are checked so. */
export function optionWordsRefusal(label: string): Extract<ClickRefusal, 'submit-word'> | null {
  return SUBMIT_WORDS.test(optionWords(label)) ? 'submit-word' : null;
}

/** The words a control shows or announces: its text, its aria-label and, for button inputs, its value or alt. A
 *  checkbox or radio toggles a state and never submits, so its words (a consent box's "I confirm ...") do not count; a
 *  list's option (listOption) chooses a value, so "confirm" does not count in it, but any other submit word does ("I
 *  confirm and submit"). */
/** An element's own words: its aria-label and its own text nodes, none of its descendants' (assertKeyTarget). */
function ownText(el: Element): string {
  const own = Array.from(el.childNodes).filter((node) => node.nodeType === 3).map((node) => node.textContent ?? '');
  return [el.getAttribute('aria-label') ?? '', ...own].join(' ');
}

function shownText(el: Element): string {
  if (el.localName === 'input' && ['checkbox', 'radio'].includes((el as HTMLInputElement).type)) return '';
  if (listOption(el)) return optionWords([el.getAttribute('aria-label') ?? '', el.textContent ?? ''].join(' '));
  const parts = [el.getAttribute('aria-label') ?? ''];
  if (el.localName === 'input') {
    const input = el as HTMLInputElement;
    if (['submit', 'button', 'reset'].includes(input.type)) parts.push(input.value);
    if (input.type === 'image') parts.push(input.alt);
  } else {
    parts.push(el.textContent ?? '');
  }
  return parts.join(' ');
}

/** Would activating `el` submit a form? */
function submitsForm(el: Element): boolean {
  if (el.localName === 'button') {
    const button = el as HTMLButtonElement;
    return button.type === 'submit' && button.form !== null;
  }
  if (el.localName === 'input') {
    const type = (el as HTMLInputElement).type;
    return type === 'submit' || type === 'image';
  }
  return false;
}

/** The adapter's Submit button itself on a step it declared final, for clickAdapterSubmit alone (v3 Phase 4): never
 *  one the adapter names never to press, never a Next button, and never anything but that one element. */
function submitException(el: Element, ctx: SubmitPressContext): boolean {
  if (ctx[SUBMIT_PRESS] !== true || ctx.root === null || ctx.adapter === null) return false;
  const submit = ctx.adapter.submitButton?.(ctx.root) ?? null;
  if (submit === null || submit !== el) return false;
  const next = ctx.adapter.nextButton?.(ctx.root) ?? null;
  if (next !== null && (next.contains(el) || el.contains(next))) return false;
  const never = ctx.adapter.neverPress?.(ctx.root) ?? [];
  if (never.some((button) => button.contains(el) || el.contains(button))) return false;
  return ctx.adapter.isFinalStep?.(el.ownerDocument) === 'final';
}

/** The adapter's Next button on a step it declared not final, when the step machine allows it. */
function nextException(el: Element, ctx: NotSubmitContext): boolean {
  if (ctx.allowNext !== true || ctx.root === null || ctx.adapter === null) return false;
  const next = ctx.adapter.nextButton?.(ctx.root) ?? null;
  if (next === null || next !== el) return false;
  return ctx.adapter.isFinalStep?.(el.ownerDocument) === 'not-final';
}
