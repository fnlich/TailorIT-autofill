/*
 * jr6 apply F2 item 6 (APPLYPLAN D7; AF-11): the generic second step of an entry. After an entry press of ours, some
 * sites ask how to apply in a dialog before the form (Jobright 1.25.2 presses Dayforce's "Apply without account", HA
 * L56733-56750 in its Dayforce entry, and handles Paycom's and YC's dialogs, HA L58168ff and L58738ff; Workday's
 * declared choice is its adapter's own). Where the address's adapter declares no choice for what showed, this rule
 * finds one control to press, and only a very narrow one:
 * - in a dialog (dialog[open], [role="dialog"], [aria-modal="true"]) a person can see that was not shown when we
 *   pressed (`before`: dialogsShown at the press);
 * - a control a person can see and press (a button, a link, role button or link, an input of type button), whose own
 *   accessible name (aria-label, aria-labelledby, its visible text, its value, its title; collapsed, signs at its ends
 *   left out, at most SECOND_STEP_MAX_NAME characters) is one of D7's words: "Apply manually", "Apply without (an)
 *   account", "Apply as (a) guest", "Continue as (a) guest", "Start (your) application", "Continue to application";
 * - and none of NEVER_WORDS ("Autofill with Resume", "Use My Last Application", another site's profile, a sign-in, an
 *   account's creation);
 * - exactly one such control in all: two candidates are refused (they may lead to different places).
 * Pure DOM: it reads the document and presses nothing. Only the second-step door of dom/fillers/not-submit.ts presses
 * what it answers (no form shown, never a form's submit, never a control any adapter of the address never presses, the
 * entryNeverPressed exemption never applying), from content/press.ts alone. Nothing here reads, logs or sends a value.
 */
import { newScanCache, type ScanCache } from '../dom/scan-cache';
import { visibleText } from '../dom/visible-text';
import { isUserVisible } from '../dom/visibility';

/** The dialogs a second step may sit in. */
export const SECOND_STEP_DIALOGS = 'dialog[open], [role="dialog"], [aria-modal="true"]';
/** The controls a second step may be. */
const CONTROLS = 'button, a[href], [role="button"], [role="link"], input[type="button" i]';
/** The longest own name a second step's control may have. */
export const SECOND_STEP_MAX_NAME = 48;

/** D7's words, whole (case and the signs at the ends aside). */
export const SECOND_STEP_WORDS = /^(?:apply manually|apply without (?:an )?account|apply as (?:a )?guest|continue as (?:a )?guest|start (?:your )?application|continue to application)$/i;
/** Words that make a control never a second step, wherever they stand in its name. */
export const NEVER_WORDS = /\b(?:autofill|r[eé]sum[eé]|cv|last application|linkedin|indeed|seek|xing|google|facebook|apple|glassdoor|ziprecruiter|monster|sign[\s-]?in|log[\s-]?in|sign[\s-]?up|register|create (?:an )?account)\b/i;

/** The dialogs a person can see in `doc` now: taken at an entry press, so a second step is only ever one shown after
 *  it. */
export function dialogsShown(doc: Document, cache: ScanCache = newScanCache()): Set<Element> {
  return new Set(Array.from(doc.querySelectorAll(SECOND_STEP_DIALOGS)).filter((dialog) => isUserVisible(dialog, cache)));
}

/** A control's own accessible name: its aria-label, else the text of the elements aria-labelledby names, else its
 *  visible text (an input's value), else its title; whitespace collapsed, the signs at its ends left out (an arrow, a
 *  chevron). */
export function ownNameOf(control: Element, cache: ScanCache = newScanCache()): string {
  const doc = control.ownerDocument;
  const named = (control.getAttribute('aria-label') ?? '').trim();
  let name = named;
  if (name === '') {
    const ids = (control.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter((id) => id !== '');
    name = ids.map((id) => doc.getElementById(id)).filter((el): el is HTMLElement => el !== null)
      .map((el) => visibleText(el, { singleLine: true, cache })).join(' ');
  }
  if (name.trim() === '') {
    name = control.localName === 'input' ? (control as HTMLInputElement).value
      : visibleText(control, { singleLine: true, cache });
  }
  if (name.trim() === '') name = control.getAttribute('title') ?? '';
  return name.replace(/\s+/g, ' ').trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/** Whether a person can press `control` now: shown, not disabled, not aria-disabled, not inert. */
function pressable(control: HTMLElement, cache: ScanCache): boolean {
  return control.isConnected && isUserVisible(control, cache) && (control as HTMLButtonElement).disabled !== true
    && control.getAttribute('aria-disabled') !== 'true' && control.closest('[inert]') === null;
}

/** The generic second step (module header): the one control a dialog shown after our press offers in D7's words, or
 *  null (none, two or more, or none in a dialog shown since `before`). */
export function secondStepControl(doc: Document, before: ReadonlySet<Element>): HTMLElement | null {
  const cache = newScanCache();
  const candidates = new Set<HTMLElement>();
  for (const control of Array.from(doc.querySelectorAll<HTMLElement>(CONTROLS))) {
    const dialog = control.closest(SECOND_STEP_DIALOGS);
    if (dialog === null || before.has(dialog) || !isUserVisible(dialog, cache) || !pressable(control, cache)) continue;
    const name = ownNameOf(control, cache);
    if (name.length === 0 || name.length > SECOND_STEP_MAX_NAME) continue;
    if (!SECOND_STEP_WORDS.test(name) || NEVER_WORDS.test(name)) continue;
    candidates.add(control);
    if (candidates.size > 1) return null;
  }
  return candidates.size === 1 ? [...candidates][0]! : null;
}
