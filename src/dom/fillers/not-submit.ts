/*
 * Never submit (docs/ARCHITECTURE.md "Filler"; docs/design/runtime.md §6). submit() and requestSubmit() are banned by
 * lint everywhere, and every untrusted click() the extension makes goes through assertNotSubmit, which refuses:
 * - the adapter's Submit button, and anything inside it;
 * - any element whose text is a submit word (submit, apply, send, finish, complete, confirm);
 * - any element whose activation would submit a form: a button with a form owner whose .type is "submit" (a typeless
 *   button included), input[type=submit] and input[type=image], anything inside such a button, and a <label> (or an
 *   element inside one) whose control is refused.
 * The only exception is the adapter's Next button, and only when the caller passes allowNext: the step machine does
 * so on a step the adapter declared not final, after the auto-advance checks. Even then the Submit button and the
 * submit words stay refused. A refused click leaves the field flagged needs-your-click; it is never retried another way.
 */
import type { Adapter } from '../../adapters/types';

/** The words that make a control a submit control (the plan's list). */
export const SUBMIT_WORDS = /\b(?:submit|apply|send|finish|complete|confirm)\b/i;

/** Why a click was refused. */
export const CLICK_REFUSALS = ['adapter-submit', 'submit-word', 'submits-form', 'inside-submit',
  'label-of-refused'] as const;
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
  if (submitButton !== null && (submitButton === el || submitButton.contains(el))) return 'adapter-submit';
  if (SUBMIT_WORDS.test(shownText(el))) return 'submit-word';
  if (submitsForm(el) && !nextException(el, ctx)) return 'submits-form';
  const button = el.parentElement?.closest('button') ?? null;
  if (button !== null && depth < 4 && refusalOf(button, ctx, depth + 1) !== null) return 'inside-submit';
  const label = el.closest('label');
  const control = label?.control ?? null;
  if (control !== null && control !== el && depth < 4 && refusalOf(control, ctx, depth + 1) !== null) {
    return 'label-of-refused';
  }
  return null;
}

/** The words a control shows or announces: its text, its aria-label and, for button inputs, its value or alt. A
 *  checkbox or radio toggles a state and never submits, so its words (a consent box's "I confirm ...") do not
 *  count. */
function shownText(el: Element): string {
  if (el.localName === 'input' && ['checkbox', 'radio'].includes((el as HTMLInputElement).type)) return '';
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
