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
 * The only exception is the adapter's Next button, and only when the caller passes allowNext: the step machine does
 * so on a step the adapter declared not final, after the auto-advance checks. Even then the Submit button and the
 * submit words stay refused. A refused click leaves the field flagged needs-your-click; it is never retried another way.
 * A choice made through the page-world bridge (docs/SPEC-AMENDMENTS.md §12) clicks nothing, and the option it names
 * may not be drawn yet (a closed list): its text box goes through assertNotSubmit, and the option's label, as the
 * frame read it, through optionWordsRefusal, the word rule an option of an open list gets here ("confirm" chooses a
 * value; any other submit word refuses it). The element rules (Submit, Next, the never-pressed buttons, a label of a
 * refused control) are for elements, and a list's option is none of those (listOption: it holds no button, link or
 * input). A refused option is not sent: its click, on the events' path, goes through assertNotSubmit as before.
 */
import type { Adapter } from '../../adapters/types';

/** The words that make a control a submit control (the plan's list). */
export const SUBMIT_WORDS = /\b(?:submit|apply|send|finish|complete|confirm)\b/i;

/** Why a click was refused. */
export const CLICK_REFUSALS = ['adapter-submit', 'submit-word', 'submits-form', 'adapter-next', 'inside-submit',
  'label-of-refused', 'adapter-never-press'] as const;
export type ClickRefusal = (typeof CLICK_REFUSALS)[number];

/** Where the adapter's Submit and Next buttons are looked up, and whether the step machine allows Next. */
export interface NotSubmitContext {
  adapter: Adapter | null;
  /** The form root the adapter's buttons are looked up in. */
  root: Element | null;
  /** The step machine's Next exception. Never set by a filler. */
  allowNext?: boolean;
}

/** Whether `el` may receive an untrusted click. */
export function assertNotSubmit(el: Element, ctx: NotSubmitContext): { ok: true } | { ok: false; refusal: ClickRefusal } {
  const refusal = refusalOf(el, ctx, 0);
  return refusal === null ? { ok: true } : { ok: false, refusal };
}

/** Clicks `el` with an untrusted click() if assertNotSubmit allows it; returns whether it clicked. */
export function clickIfAllowed(el: HTMLElement, ctx: NotSubmitContext): boolean {
  if (!assertNotSubmit(el, ctx).ok) return false;
  el.click();
  return true;
}

function refusalOf(el: Element, ctx: NotSubmitContext, depth: number): ClickRefusal | null {
  const submitButton = ctx.root !== null ? ctx.adapter?.submitButton?.(ctx.root) ?? null : null;
  if (submitButton !== null && (submitButton.contains(el) || el.contains(submitButton))) return 'adapter-submit';
  if (SUBMIT_WORDS.test(shownText(el))) return 'submit-word';
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

/** The adapter's Next button on a step it declared not final, when the step machine allows it. */
function nextException(el: Element, ctx: NotSubmitContext): boolean {
  if (ctx.allowNext !== true || ctx.root === null || ctx.adapter === null) return false;
  const next = ctx.adapter.nextButton?.(ctx.root) ?? null;
  if (next === null || next !== el) return false;
  return ctx.adapter.isFinalStep?.(el.ownerDocument) === 'not-final';
}
