/*
 * Never submit (docs/ARCHITECTURE.md "Filler"; docs/design/runtime.md §6). submit() and requestSubmit() are banned by
 * lint everywhere, and every untrusted click() the extension makes goes through assertNotSubmit, which refuses:
 * (jr6 SHELL-B, ICIMS-17: an iCIMS IForm leaf frame shows no step bar; its portal frame's step facts, which the worker
 * hands the leaf, ride in NotSubmitContext.facts, and every adapter hook below is asked with them: the step machine's
 * Next on the leaf is its own "Submit" while they say a later form or step follows, and its final Submit is the adapter's
 * Submit, through clickAdapterSubmit alone, where they say the last. No facts: every rule as before.)
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
 * submit words stay refused, but for one case (the snapshot build of 2026-11-06, core-x item 1: stepSubmitNext): the
 * adapter's own Next whose words say Submit on every step (iCIMS's), named by its per-step id, on a step whose bar
 * shows a later step. And (v3 Phase 4, docs/SPEC-AMENDMENTS.md §12 Decision 6) the adapter's Submit button
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
 * button (src/content/sign-in.ts). Neither opens assertNotSubmit or clickIfAllowed for anyone. v3 Phase 7b adds a
 * fourth of the same kind, clickAdapterSignInPrelude, Sign-in mode Auto's press of the one control that shows a wall's
 * form (Workday's "Sign in with email"), named by src/content/sign-in.ts alone; and Sign-in's door now refuses a button
 * the adapter names never to press anywhere on the page (Workday's Reset Password face, the social sign-ins).
 * jr6 apply F2 (APPLYPLAN §5 F2 items 4 and 6): the entry door also refuses a control whose press would open another
 * tab or window, download a file or (given the frame's address) leave the origin, answering why (entryWhereRefusal);
 * and a fifth door of the same kind, clickSecondStep, presses an entry's generic second step (adapters/second-step.ts:
 * "Apply manually" and its like, in a dialog shown after our press), named by src/content/press.ts alone.
 * A choice made through the page-world bridge (docs/SPEC-AMENDMENTS.md §12) clicks nothing, and the option it names
 * may not be drawn yet (a closed list): its text box goes through assertNotSubmit, and the option's label, as the
 * frame read it, through optionWordsRefusal, the word rule an option of an open list gets here ("confirm" chooses a
 * value; any other submit word refuses it). The element rules (Submit, Next, the never-pressed buttons, a label of a
 * refused control) are for elements, and a list's option is none of those (listOption: it holds no button, link or
 * input). A refused option is not sent: its click, on the events' path, goes through assertNotSubmit as before.
 */
import type { Adapter, ChainStepFacts, SignInWall, UploadPrompt } from '../../adapters/types'; // jr6 SHELL-B: ChainStepFacts
import { secondStepControl } from '../../adapters/second-step'; // jr6 apply F2
import { pageChallenged, vendorFramesShown } from '../pause-detect';
import { flatContains } from '../scan-cache';
import { signInContainerOf, signInFormOf, signInRefusal } from '../sign-in-form';
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
  /** jr6 SHELL-B (ICIMS-17; ENGINE.md edits 3, 4 and 16): the step facts of the portal frame around an IForm leaf (the
   *  worker's chain/leafFacts, content/chain-frame.ts chainFactsOf), which the adapter's isFinalStep, nextButton,
   *  submitButton and stepSubmitNext.laterStep are asked with; absent or null: none (every rule as before). */
  facts?: ChainStepFacts | null;
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
 * jr6 SHELL-B (ICIMS-17, ICIMS.md edit 4's other half): `facts`, an IForm leaf's portal step facts, with which the
 * adapter finds its Submit and judges the step final (the leaf's own "Submit" on the packet's last form of the last
 * step); without them, as before.
 */
export function clickAdapterSubmit(adapter: Adapter, root: Element, facts?: ChainStepFacts | null): HTMLElement | null {
  let submit: HTMLElement | null = null;
  try {
    submit = adapter.submitButton?.(root, facts) ?? null; // jr6 SHELL-B: facts
  } catch {
    return null;
  }
  if (submit === null) return null;
  const ctx: SubmitPressContext = { adapter, root, ...(facts === undefined ? {} : { facts }), [SUBMIT_PRESS]: true }; // jr6 SHELL-B
  if (refusalOf(submit, ctx, 0) !== null) return null;
  submit.click();
  return submit;
}

/** Whether `el` is the application form's own Submit, Next or a button the adapter names never to press, or holds or
 *  sits inside one, on the form the adapter finds in `doc` now (none shown: none of them). */
function nearApplicationButtons(el: Element, adapter: Adapter, doc: Document, composed = false): boolean {
  let root: Element | null = null;
  try {
    root = adapter.detect(doc)?.formRoot ?? null;
  } catch {
    return true;
  }
  if (root === null) return false;
  const near = (other: Element | null | undefined) => other != null && (other === el || holdsIn(other, el, composed)
    || holdsIn(el, other, composed));
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
 * click(). It finds the control itself (a caller names no element); never one that submits a form (but, the snapshot
 * build of 2026-11-06, core pass Z1 item 27, an entry-choice's declared consent form: consentEntryAllowed), never while the
 * adapter finds an application form on the page (its Submit, Next and never-pressed buttons stay refused), never one a
 * person cannot see or press, and never one of the adapter's never-pressed controls (neverPress, read over the whole
 * page), or one holding or inside one, unless the adapter marks its entry as that one (entryNeverPressed: Ashby's
 * Application tab), and then that element alone. Its words ("Apply") are submit words, which is why it has a door of its
 * own: that one element, and nothing near it. Answers the element clicked, or null. Only src/content/press.ts may call
 * it (eslint.config.mjs), for the agent's agent/enter and the person's Autofill on a page with no form.
 * jr6 apply F2 item 4 (APPLYPLAN D4; AP-7, C7): and never one whose press would leave this tab or this site
 * (entryWhereRefusal): a link that downloads, a link or a form's submitter that names another browsing context (a new
 * tab or window), or, given the frame's own `address`, a link to another origin. The door then answers why, so the
 * entry says it to the person instead of pressing it ('download', 'new-tab', 'elsewhere').
 */
export function clickAdapterEntry(adapter: Adapter, doc: Document, address?: URL):
  HTMLElement | EntryDoorRefusal | null { // jr6 apply F2
  let control: HTMLElement | null = null;
  try {
    control = adapter.entryControl?.(doc) ?? null;
  } catch {
    return null;
  }
  if (control === null || control.ownerDocument !== doc || !pressableNow(control)) return null;
  // Core pass Z1, item 27: a control that submits a form, only where that is the adapter's declared consent form holding
  // nothing but the consent choice and its declared selects (consentEntryAllowed).
  if (submitsForm(control) && !consentEntryAllowed(adapter, doc, control)) return null;
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
  // jr6 apply F2 item 4: an entry otherwise pressable, refused by where its press would go, says why.
  const where = entryWhereRefusal(control, address);
  if (where !== null) return where;
  control.click();
  return control;
}

// ── jr6 apply F2 item 4 (APPLYPLAN D4; AP-7, C7): where an entry's press would go ──
/** Why the entry door refuses a control by where its press would go: it downloads a file ('download'), opens another
 *  tab or window ('new-tab', until the owner's OQ3), or leads to another origin ('elsewhere', until OQ4). */
export const ENTRY_DOOR_REFUSALS = ['download', 'new-tab', 'elsewhere'] as const;
export type EntryDoorRefusal = (typeof ENTRY_DOOR_REFUSALS)[number];

/** The browsing-context names that keep a press in this tab: none, this frame, the top frame, the parent frame. */
const SAME_TAB_TARGETS: ReadonlySet<string> = new Set(['', '_self', '_top', '_parent']);

/** An attribute read through Element's own getter, which a form's named controls (an input named "getAttribute")
 *  cannot shadow. */
function ownAttribute(el: Element, name: string): string | null {
  const view = el.ownerDocument.defaultView as unknown as { Element?: { prototype: Element } } | null;
  const read = view?.Element?.prototype.getAttribute;
  return read === undefined ? null : read.call(el, name);
}

/** The browsing context a press of `control` would navigate, its ASCII letters lowercased ('' for this one): a link's
 *  own target, a submitter's formtarget or its form's target, else the document's base target (HTML's rule). jr6 apply
 *  F2 (the line P review, revA-5): never trimmed: HTML and Chrome compare the value as it is (ASCII case-insensitive),
 *  so " _self" or "_self " names another browsing context, a new window, and is no same-tab keyword. */
function navigationTargetOf(control: HTMLElement): string {
  const doc = control.ownerDocument;
  const base = doc.querySelector('base[target]')?.getAttribute('target') ?? '';
  let named: string | null = null;
  if (control.localName === 'a' || control.localName === 'area') {
    named = control.getAttribute('target');
  } else if (submitsForm(control)) {
    const ctor = control.localName === 'input' ? 'HTMLInputElement' : 'HTMLButtonElement';
    const form = protoGet(control, ctor, 'form') as HTMLFormElement | null | undefined;
    named = control.getAttribute('formtarget') ?? (form == null ? null : ownAttribute(form, 'target'));
  } else {
    return '';
  }
  // ASCII letters alone are folded (HTML's ASCII case-insensitive match): no other letter reads as a keyword's.
  return (named ?? base).replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
}

/**
 * Why an entry's press would go where Autofill never follows (ENTRY_DOOR_REFUSALS), or null (it stays in this tab):
 * - a link with `download` (Jobright's entry flows refuse it too, the audit apply-a.md AP-7);
 * - a link whose target, or a form's submitter whose formtarget or form's target, names a context that is not this
 *   tab's (anything but empty, _self, _top or _parent, case-insensitive and as written: " _self" is another context's
 *   name, as Chrome reads it, revA-5; the document's <base target> where the
 *   control names none): Chrome would open a new tab or window, which Autofill does not follow (APPLYPLAN D4, OQ3);
 * - given the frame's own `address`, a link whose http(s) address (resolved against the document's <base> where it has
 *   one, else against `address`) is on another origin (D4, OQ4: a grant never crosses an origin, so the press would
 *   leave the person on a site Autofill does not follow).
 * Pure: it reads the control and its document, never presses.
 */
export function entryWhereRefusal(control: HTMLElement, address?: URL): EntryDoorRefusal | null {
  const isLink = control.localName === 'a' || control.localName === 'area';
  if (isLink && control.hasAttribute('download')) return 'download';
  if (!SAME_TAB_TARGETS.has(navigationTargetOf(control))) return 'new-tab';
  if (!isLink || address === undefined) return null;
  const href = control.getAttribute('href');
  if (href === null) return null;
  let to: URL;
  try {
    const doc = control.ownerDocument;
    to = new URL(href, doc.querySelector('base[href]') !== null ? doc.baseURI : address.href);
  } catch {
    return null;
  }
  if (to.protocol !== 'http:' && to.protocol !== 'https:') return null;
  return to.origin === address.origin ? null : 'elsewhere';
}
// ── end jr6 apply F2 item 4 ──

// ── jr6 apply F2 item 6 (APPLYPLAN D7; AF-11): the generic second step's door ──
/**
 * After an entry press of ours, presses the generic second step once (adapters/second-step.ts secondStepControl: the
 * one control a dialog shown since the press, `before`, offers in D7's words, "Apply manually" and its like), with an
 * untrusted click(). It finds the control itself (a caller names no element); never one that submits a form, never one
 * a person cannot see or press, never while any of the address's `adapters` finds an application form on the page,
 * never one of their never-pressed controls (read over the whole page), or one holding or inside one, with no
 * exemption (entryNeverPressed never applies: Taleo's "Apply as Guest" stays never pressed), never one whose press
 * would go where the entry door refuses (entryWhereRefusal, `address` the frame's own). Answers the element clicked, or
 * null. Only src/content/press.ts may call it (eslint.config.mjs), for an entry's second step alone.
 */
export function clickSecondStep(adapters: readonly Adapter[], doc: Document, before: ReadonlySet<Element>,
  address?: URL): HTMLElement | null {
  const control = secondStepControl(doc, before);
  if (control === null || control.ownerDocument !== doc || !pressableNow(control) || submitsForm(control)) return null;
  if (entryWhereRefusal(control, address) !== null) return null;
  for (const adapter of adapters) {
    let formShown: Element | null = null;
    try {
      formShown = adapter.detect(doc)?.formRoot ?? null;
    } catch {
      return null;
    }
    if (formShown !== null || nearNeverPressed(control, adapter, doc, true)) return null;
  }
  control.click();
  return control;
}
// ── end jr6 apply F2 item 6 ──

// ── snapshot build 2026-11-06 (core pass Z1, item 27): an entry that submits a consent form ──
/** A property read through the getter of the element's window's `ctor` prototype, which a form's named controls (an
 *  input named "elements") cannot shadow. */
function protoGet(el: Element, ctor: string, name: string): unknown {
  const view = el.ownerDocument.defaultView as unknown as Record<string, { prototype: object } | undefined> | null;
  const proto = view?.[ctor]?.prototype;
  const getter = proto === undefined ? undefined : Object.getOwnPropertyDescriptor(proto, name)?.get;
  return getter === undefined ? undefined : getter.call(el);
}

/**
 * Whether the entry door may press `control`, which submits a form (the Taleo precedent; Jobvite's Data Consent,
 * fixtures/jobvite/ninjaone-consent.html: <form name="consentForm" method="post"> holding the residence select and
 * <button type="submit">I Accept</button>): only on a page whose adapter reads it as an entry-choice (authState), whose
 * declared consent form (Adapter.entryConsentForm) is the control's own form owner, and only while that form holds no
 * control but this one, the selects the adapter declares and fieldsets (each read through its prototype: HTMLFormElement's
 * elements, the form-associated controls a form= attribute names included). A form holding an application's field, a
 * hidden input, another button or an undeclared select is never submitted. A hook that throws refuses.
 */
function consentEntryAllowed(adapter: Adapter, doc: Document, control: HTMLElement): boolean {
  try {
    if (adapter.authState?.(doc) !== 'entry-choice') return false;
    const declared = adapter.entryConsentForm?.(doc) ?? null;
    if (declared === null || declared.form.ownerDocument !== doc || declared.form.localName !== 'form') return false;
    const ctor = control.localName === 'input' ? 'HTMLInputElement' : 'HTMLButtonElement';
    if (protoGet(control, ctor, 'form') !== declared.form) return false;
    const elements = protoGet(declared.form, 'HTMLFormElement', 'elements') as HTMLFormControlsCollection | undefined;
    if (elements === undefined) return false;
    return Array.from(elements).every((el) => el === control || el.localName === 'fieldset'
      || (el.localName === 'select' && declared.selects.includes(el)));
  } catch {
    return false;
  }
}
// ── end core pass Z1, item 27 ──

/**
 * v3 Phase 5, Sign-in mode Auto: presses the sign-in or create-account form's one button (Sign in, Create account), as
 * the adapter declares it or the standard rule reads it (dom/sign-in-form.ts signInFormOf), with an untrusted click().
 * It finds the button itself; never while signInRefusal refuses the form at `address` (a field hidden, a honeypot, http,
 * a form posting to another origin), never the application form's own Submit, Next or a never-pressed button, never one
 * a person cannot see or press. Answers the element clicked, or null. Only src/content/sign-in.ts may call it
 * (eslint.config.mjs), after it filled the form.
 */
export function clickAdapterSignIn(adapter: Adapter, doc: Document, wall: SignInWall, address: URL,
  from: 'wall' | 'container' = 'wall'): HTMLElement | null {
  // Core pass Z1, item 24: `container`, the adapter's declared sign-in container on a page the run fills like a step
  // (dom/sign-in-form.ts signInContainerOf: ADP's guest Continue, UltiPro's Create account), read and refused as a form.
  const form = from === 'container' ? signInContainerOf(adapter, doc) : signInFormOf(adapter, doc, wall);
  // A form whose press is the person's (SignInForm.personPresses) is never pressed here.
  if (form === null || form.personPresses === true || signInRefusal(form, address) !== null) return null;
  const button = form.button;
  // A container's button may sit outside it, but never in another document than the container's, and (read across
  // shadow roots: UltiPro's sits in its host's) never one the never-press list holds or the form's Submit or Next.
  if (from === 'container' && button.ownerDocument !== form.container?.ownerDocument) return null;
  const composed = from === 'container';
  if (button.ownerDocument !== doc || !pressableNow(button) || nearApplicationButtons(button, adapter, doc, composed)
    || nearNeverPressed(button, adapter, doc, composed)) return null;
  button.click();
  return button;
}

/** Whether `outer` holds `inner`: in its light DOM, or (`composed`) across shadow roots too. */
const holdsIn = (outer: Element, inner: Element, composed: boolean) => outer.contains(inner)
  || (composed && flatContains(outer, inner));

/** v3 Phase 7b: whether `el` is one of the controls the adapter names never to press anywhere on the page (neverPress,
 *  read over the whole document), or holds or sits inside one: a reset's button, a social sign-in, an Apply with
 *  LinkedIn. A hook that throws refuses. */
function nearNeverPressed(el: Element, adapter: Adapter, doc: Document, composed = false): boolean {
  let never: Element[] = [];
  try {
    never = adapter.neverPress?.(doc.documentElement) ?? [];
  } catch {
    return true;
  }
  return never.some((other) => other === el || holdsIn(other, el, composed) || holdsIn(el, other, composed));
}

/**
 * v3 Phase 7b, Sign-in mode Auto: on a wall whose form the page shows only after a first choice (Workday's landing:
 * Apple, Google or "Sign in with email"), presses the adapter's declared prelude control once (Adapter.signInPrelude),
 * with an untrusted click(). It finds the control itself; never on an http page, never while the page shows the wall's
 * form already (signInFormOf), never one that would submit a form (its words may say "Sign in": that is why it has a
 * door of its own), never the application form's Submit, Next or a never-pressed button, never one of the adapter's
 * never-pressed controls anywhere on the page (the social sign-ins), never one a person cannot see or press. Answers
 * the element clicked, or null. Only src/content/sign-in.ts may call it (eslint.config.mjs), before it reads the form.
 * The v4 review (L5): never while the page shows a challenge not known solved, a vendor's frame or a frame that reads
 * like one (sign-in.ts's own rule, read again here). v5 (PLAN decision 9, like Jobright): a checkbox CAPTCHA, ticked or
 * not, holds it no more than any other press: the site decides (pageChallenged and vendorFramesShown leave it out).
 */
export function clickAdapterSignInPrelude(adapter: Adapter, doc: Document, wall: SignInWall, address: URL):
  HTMLElement | null {
  if (address.protocol !== 'https:') return null;
  if (pageChallenged(doc) || vendorFramesShown(doc) > 0) return null;
  let control: HTMLElement | null = null;
  try {
    if (signInFormOf(adapter, doc, wall) !== null) return null;
    control = adapter.signInPrelude?.(doc, wall) ?? null;
  } catch {
    return null;
  }
  if (control === null || control.ownerDocument !== doc || !pressableNow(control) || submitsForm(control)
    || nearApplicationButtons(control, adapter, doc) || nearNeverPressed(control, adapter, doc)) return null;
  control.click();
  return control;
}

/** Whether the Submit exception would let `el` through (for the tests and the checks that read it; it clicks
 *  nothing): exactly the adapter's own Submit, on a final step, and nothing near it. jr6 SHELL-B: `facts`, as
 *  clickAdapterSubmit takes them. */
export function submitPressAllowed(el: Element, adapter: Adapter, root: Element, facts?: ChainStepFacts | null): boolean {
  const ctx: SubmitPressContext = { adapter, root, ...(facts === undefined ? {} : { facts }), [SUBMIT_PRESS]: true }; // jr6 SHELL-B
  return refusalOf(el, ctx, 0) === null;
}

function refusalOf(el: Element, ctx: NotSubmitContext, depth: number, ownWords = false): ClickRefusal | null {
  if (depth === 0 && submitException(el, ctx)) return null;
  // The security fix of 2026-11-06 (S9): the adapter's Submit, its Next and the never-pressed list are read across
  // shadow roots (flatContains), so a native button a Submit host draws in its shadow root (UltiPro's ukg-button) is
  // that Submit whatever its words say. jr6 SHELL-B: each asked with the leaf's step facts (ctx.facts).
  const submitButton = ctx.root !== null ? ctx.adapter?.submitButton?.(ctx.root, ctx.facts) ?? null : null;
  if (submitButton !== null && (flatContains(submitButton, el) || flatContains(el, submitButton))) return 'adapter-submit';
  if (SUBMIT_WORDS.test(ownWords && depth === 0 ? ownText(el) : shownText(el))
    && !(depth === 0 && !ownWords && stepSubmitNextException(el, ctx))) return 'submit-word';
  if (submitsForm(el) && !nextException(el, ctx)) return 'submits-form';
  // Next itself, on the step machine's word on a step declared not final, is the one click near it that may be made.
  const next = ctx.root !== null ? ctx.adapter?.nextButton?.(ctx.root, ctx.facts) ?? null : null;
  if (next !== null && (flatContains(next, el) || flatContains(el, next)) && !nextException(el, ctx)) return 'adapter-next';
  const never = ctx.root !== null ? ctx.adapter?.neverPress?.(ctx.root) ?? [] : [];
  if (never.some((button) => flatContains(button, el))) return 'adapter-never-press';
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
  const submit = ctx.adapter.submitButton?.(ctx.root, ctx.facts) ?? null; // jr6 SHELL-B: facts
  if (submit === null || submit !== el) return false;
  const next = ctx.adapter.nextButton?.(ctx.root, ctx.facts) ?? null; // jr6 SHELL-B: facts
  if (next !== null && (flatContains(next, el) || flatContains(el, next))) return false;
  const never = ctx.adapter.neverPress?.(ctx.root) ?? [];
  if (never.some((button) => flatContains(button, el) || flatContains(el, button))) return false;
  return ctx.adapter.isFinalStep?.(el.ownerDocument, ctx.facts) === 'final'; // jr6 SHELL-B: facts
}

/** The adapter's Next button on a step it declared not final, when the step machine allows it. */
function nextException(el: Element, ctx: NotSubmitContext): boolean {
  if (ctx.allowNext !== true || ctx.root === null || ctx.adapter === null) return false;
  const next = ctx.adapter.nextButton?.(ctx.root, ctx.facts) ?? null; // jr6 SHELL-B: facts
  if (next === null || next !== el) return false;
  return ctx.adapter.isFinalStep?.(el.ownerDocument, ctx.facts) === 'not-final'; // jr6 SHELL-B: facts
}

// ── snapshot build 2026-11-06 (core-x, item 1): a declared step button whose words say Submit ──
/**
 * The one case a submit word does not refuse (Adapter.stepSubmitNext; iCIMS's "Submit Profile" and "Submit", the
 * owner's snapshots of 2026-11-06): the step machine's Next press (allowNext) of exactly the adapter's own nextButton,
 * on a step isFinalStep reads 'not-final' (nextException), that button one of the adapter's per-step ids, and the
 * page's own step bar showing a later step a person can see (laterStep: connected, in the button's document, neither
 * the button nor inside or around it). The adapter's Submit, a button holding or inside either, the never-pressed list
 * and every other submit word stay refused; a hook that throws refuses. A bar that does not show a later step (none,
 * hidden, one the adapter cannot read with certainty) leaves the button a Submit, pressed only through the Submit gates.
 * jr6 SHELL-B (ICIMS-17, ICIMS.md edit 3): laterStep is asked with the leaf's step facts (ctx.facts); with them, the
 * sign may be the leaf's own form (leafFormSign).
 */
function stepSubmitNextException(el: Element, ctx: NotSubmitContext): boolean {
  const declared = ctx.adapter?.stepSubmitNext;
  if (declared === undefined || ctx.root === null) return false;
  try {
    if (!nextException(el, ctx) || !declared.buttons.some((selector) => el.matches(selector))) return false;
    const later = declared.laterStep(el.ownerDocument, ctx.facts); // jr6 SHELL-B: facts
    if (later === null || !later.isConnected || later.ownerDocument !== el.ownerDocument || later === el) return false;
    if (leafFormSign(el, later, ctx)) return true; // jr6 SHELL-B
    return !el.contains(later) && !later.contains(el) && isUserVisible(later);
  } catch {
    return false;
  }
}

// ── jr6 SHELL-B (INTEGRATION.md SHELL-B item 1; ICIMS-17, ICIMS.md edit 3): an IForm leaf's own form as the sign ──
/** With an IForm leaf's portal step facts given (ctx.facts: a chained leaf, whose frame shows no bar), the adapter's later
 *  step is the leaf's own form, standing for the portal's later form or step while the facts say one follows (iCIMS's
 *  laterStep, factsReading: Jobright's ~contents/sites/icims isContinueNavigationButton takes the leaf's icims_submit as
 *  Continue on the same counter rule). That form holds the button, so the rule above, a later step apart from it, would
 *  refuse it: taken instead only where it is exactly the button's own form owner (read through its prototype), the step's
 *  root (the form the step machine fills) and a person sees it. Without facts, never: the rule above alone. */
function leafFormSign(el: Element, later: Element, ctx: NotSubmitContext): boolean {
  if (ctx.facts == null || later.localName !== 'form' || later !== ctx.root) return false;
  const ctor = el.localName === 'input' ? 'HTMLInputElement' : el.localName === 'button' ? 'HTMLButtonElement' : null;
  return ctor !== null && protoGet(el, ctor, 'form') === later && isUserVisible(later);
}
// ── end jr6 SHELL-B ──

// ── jr6 ENGINE E2 (FIXPLAN §6.2 item 9, JZ-4): the upload's reveal door ── // jr6 ENGINE
/** The documents whose upload reveal the door pressed: never a second time in one document. */
const REVEALED = new WeakSet<Document>(); // jr6 ENGINE

/**
 * jr6 ENGINE: the upload filler's press of the link that shows a hidden file input (Adapter.uploadReveal, from a
 * configured UploadRule.reveal: JazzHR's classic layout keeps #resumator-resume-value in a display:none wrapper until
 * its "Attach resume" link, #resumator-choose-upload, is pressed: the jr6 JazzHR audit's JZ-4, snapshot6 applytojob),
 * with an untrusted click(), as Jobright's JazzHR uploadResume does (module cgRxd: it clicks that link while the
 * wrapper is hidden, then waits 300 ms and reads the input again). It finds the link itself from the input it is given
 * (a caller names no element to press) and presses it at most once per document, and only while: the input is a
 * connected, enabled file input inside the declared area that a person cannot see; the link shows inside that area and
 * can be pressed now; assertNotSubmit allows it, with the link itself left out of the adapter's never-pressed list
 * (the application's Submit and Next, a submit word, a control that submits a form, a button around it, another
 * never-pressed control around it, all refuse) and no other never-pressed control inside it. A link (<a href>) has the
 * default of its click cancelled by a listener on its window in the capture phase, the first to run for that click
 * (cancelLinkOnce), so the page never navigates (JazzHR's link points at the posting itself): neither a page handler
 * that stops the click's propagation without cancelling it, on the link or delegated on the document, nor a click the
 * page's handler makes meanwhile (its label's, its input's) can skip it; the page's own handlers still run, on a click
 * whose default is cancelled already (jr6 line W review, revD-03).
 * The link stays in neverPress for every other path. Answers the element clicked, or null. Only
 * src/dom/fillers/upload.ts may call it (test/allow-submit.test.ts); it is not exported from fillers/index.ts. A hook
 * that throws refuses.
 */
export function clickUploadReveal(adapter: Adapter, input: HTMLInputElement): HTMLElement | null { // jr6 ENGINE
  const doc = input.ownerDocument;
  if (REVEALED.has(doc) || !input.isConnected || input.localName !== 'input' || input.type !== 'file' || input.disabled
    || isUserVisible(input)) return null;
  let declared: { reveal: HTMLElement | null; area: Element | null } | null = null;
  let root: Element | null = null;
  let never: Element[] = [];
  try {
    declared = adapter.uploadReveal?.(input) ?? null;
    root = adapter.detect(doc)?.formRoot ?? null;
    never = adapter.neverPress?.(doc.documentElement) ?? [];
  } catch {
    return null;
  }
  if (declared === null || declared.reveal === null || declared.area === null) return null;
  const { reveal, area } = declared;
  if (reveal.ownerDocument !== doc || area.ownerDocument !== doc || reveal === area || !area.contains(reveal)
    || !area.contains(input) || reveal.contains(input) || !pressableNow(reveal)) return null;
  // Every other never-pressed control stays refused: around the link (assertNotSubmit), or inside it.
  if (never.some((other) => other !== reveal && reveal.contains(other))) return null;
  const others: Adapter = { ...adapter,
    neverPress: (scope) => (adapter.neverPress?.(scope) ?? []).filter((other) => other !== reveal) };
  let allowed: boolean;
  try {
    allowed = assertNotSubmit(reveal, { adapter: others, root }).ok;
  } catch {
    return null;
  }
  if (!allowed) return null;
  REVEALED.add(doc);
  const stop = cancelLinkOnce(reveal);
  try {
    reveal.click();
  } finally {
    stop();
  }
  return reveal;
}

// ── jr7 ENGINE-7 E2 item 4 (UKGR-10, EFA-6): the upload-prompt door ──
/** The words of a prompt's control the door never presses: a site's parse of the file into the form (UKG Ready's
 *  Populate: Decision 16, no site-parsed entries), and, on a consent, its refusal. */
const PROMPT_NEVER_WORDS = /\b(?:populate|import|autofill|parse)\b/i;
const CONSENT_REFUSAL_WORDS = /\b(?:cancel|decline|disagree|reject|no\b)/i;

/**
 * jr7 ENGINE-7: the press of the one control a dialog the site draws after the run's own file write asks for
 * (Adapter.uploadPrompt: UKG Ready's "Upload Complete", answered Cancel, kind 'dismiss'; Eightfold's Data Privacy
 * Agreement, answered I Agree, kind 'consent'), with an untrusted click(). Only while the control is connected, in the
 * document, shown, pressable now and assertNotSubmit allows it (the application's Submit and Next, a submit word, a
 * control that submits a form all refuse); never a control the adapter's neverPress names, nor one holding or inside
 * one (the coordinator's decision of 2026-11-12, UKGREADY-7 open 3: no exemption, unlike the reveal door: the hook
 * names a control no never-press rule covers, Eightfold's Cancel staying in neverPress beside its I Agree); never a
 * control whose words say a parse of the file
 * (Populate: PROMPT_NEVER_WORDS), never a refusal on a consent (Cancel: CONSENT_REFUSAL_WORDS). At most once per
 * control. Answers the element clicked, or null. Only src/dom/fillers/upload-prompt.ts may call it
 * (test/allow-submit.test.ts); it is not exported from fillers/index.ts. A hook that throws refuses.
 */
export function clickUploadPrompt(adapter: Adapter, doc: Document, prompt: UploadPrompt): HTMLElement | null {
  const control = prompt.press;
  if (PROMPTED.has(control) || control.ownerDocument !== doc || !control.isConnected || !pressableNow(control)) return null;
  const words = (control.textContent ?? '') + ' ' + (control.getAttribute('aria-label') ?? '');
  if (PROMPT_NEVER_WORDS.test(words) || (prompt.kind === 'consent' && CONSENT_REFUSAL_WORDS.test(words))) return null;
  let root: Element | null = null;
  let never: Element[] = [];
  try {
    root = adapter.detect(doc)?.formRoot ?? null;
    never = adapter.neverPress?.(doc.documentElement) ?? [];
  } catch {
    return null;
  }
  // The coordinator's decision of 2026-11-12 (UKGREADY-7 open 3): no never-pressed control, itself, around or inside it.
  if (never.some((other) => other === control || control.contains(other) || other.contains(control))) return null;
  let allowed: boolean;
  try {
    allowed = assertNotSubmit(control, { adapter, root }).ok;
  } catch {
    return null;
  }
  if (!allowed) return null;
  PROMPTED.add(control);
  const stop = cancelLinkOnce(control);
  try {
    control.click();
  } finally {
    stop();
  }
  return control;
}

/** The prompt controls the door pressed: never a second time. */
const PROMPTED = new WeakSet<Element>();
// ── end jr7 ENGINE-7 E2 item 4 ──

// ── jr7 ENGINE-7 E2 item 5 (UKGR-9): the editor-opener door ──
/** The words of a control the editor-opener door never presses: one that removes, gives up or sends. */
const EDITOR_NEVER_WORDS = /\b(?:delete|remove|cancel|discard|submit|apply)\b/i;

/**
 * jr7 ENGINE-7: the press of a control that opens a single-entry editor the run must fill (Adapter.editorOpener: UKG
 * Ready's Contact Edit while its summary says "Missing Information", snapshot7 secure7.saashr), with an untrusted
 * click(). At most once per control, and only while it is connected, in the document, shown, pressable now and
 * assertNotSubmit allows it (the application's Submit and Next, a submit word, a control that submits a form all
 * refuse); never a control the adapter's neverPress names, nor one holding or inside one (the coordinator's decision of
 * 2026-11-12, UKGREADY-7 open 3: no exemption, so an existing entry's Edit and Delete, in neverPress, are never pressed;
 * the hook names an "Add"-type opener no never-press rule covers); never one whose words say it removes, gives up or
 * sends (EDITOR_NEVER_WORDS). Answers the element
 * clicked, or null. Only src/dom/fillers/editor-opener.ts may call it (test/allow-submit.test.ts); it is not exported
 * from fillers/index.ts. A hook that throws refuses.
 */
export function clickEditorOpener(adapter: Adapter, doc: Document, control: HTMLElement): HTMLElement | null {
  if (OPENED.has(control) || control.ownerDocument !== doc || !control.isConnected || !pressableNow(control)) return null;
  if (EDITOR_NEVER_WORDS.test(`${control.textContent ?? ''} ${control.getAttribute('aria-label') ?? ''}`)) return null;
  let root: Element | null = null;
  let never: Element[] = [];
  try {
    root = adapter.detect(doc)?.formRoot ?? null;
    never = adapter.neverPress?.(doc.documentElement) ?? [];
  } catch {
    return null;
  }
  // The coordinator's decision of 2026-11-12 (UKGREADY-7 open 3): no never-pressed control, itself, around or inside it.
  if (never.some((other) => other === control || control.contains(other) || other.contains(control))) return null;
  let allowed: boolean;
  try {
    allowed = assertNotSubmit(control, { adapter, root }).ok;
  } catch {
    return null;
  }
  if (!allowed) return null;
  OPENED.add(control);
  const stop = cancelLinkOnce(control);
  try {
    control.click();
  } finally {
    stop();
  }
  return control;
}

/** The editor openers the door pressed: never a second time (a control lives in one document). */
const OPENED = new WeakSet<Element>();
// ── end jr7 ENGINE-7 E2 item 5 ──

// ── jr7 ENGINE-7 E2 item 6 (DF7-V4, gated on Q7-1's Dayforce live check: built off, block-save.ts) ──
/** The words of a block's control the block-save door never presses: one that removes, gives up or sends the
 *  application. */
const BLOCK_SAVE_NEVER_WORDS = /\b(?:delete|remove|cancel|discard|submit|apply)\b/i;

/**
 * jr7 ENGINE-7: the press of a repeatable block's declared Save that submits the block's own form (Dayforce's record
 * editors: each block a <form> whose Save is its submit button, snapshot7 dayforce), with an untrusted click(). The one
 * exception to "never a control that submits a form", and only where every rule holds: the button is connected, in the
 * document, inside the block, shown and pressable now, never pressed before, its words no removal, refusal or send
 * (BLOCK_SAVE_NEVER_WORDS), it names no other address or target of its own (formaction, formtarget); its form is the
 * declared block itself; that form holds no adapter Next or Submit and no never-pressed control (nor is the button
 * one), and every control the form owns (its elements, those a form attribute ties to it included) sits inside the
 * block. Answers the element clicked, or null. Only src/dom/fillers/block-save.ts may call it (test/allow-submit.test.ts);
 * it is not exported from fillers/index.ts. A hook that throws refuses.
 */
export function clickBlockSave(adapter: Adapter, root: Element, block: Element, button: HTMLElement): HTMLElement | null {
  if (SAVED.has(button) || !button.isConnected || button.ownerDocument !== block.ownerDocument || !block.contains(button)
    || !pressableNow(button)) return null;
  if (BLOCK_SAVE_NEVER_WORDS.test(`${button.textContent ?? ''} ${button.getAttribute('aria-label') ?? ''}`)) return null;
  if (button.hasAttribute('formaction') || button.hasAttribute('formtarget')) return null;
  const form = (button as HTMLButtonElement).form ?? null;
  if (form === null || form !== block) return null;
  let guarded: Element[];
  try {
    guarded = [adapter.nextButton?.(root) ?? null, adapter.submitButton?.(root) ?? null,
      ...(adapter.neverPress?.(root) ?? [])].filter((el): el is HTMLElement => el !== null);
  } catch {
    return null;
  }
  if (guarded.some((el) => el === button || form.contains(el) || el.contains(button))) return null;
  if (Array.from(form.elements).some((el) => !block.contains(el))) return null;
  SAVED.add(button);
  button.click();
  return button;
}

/** The block saves the door pressed: never a second time. */
const SAVED = new WeakSet<Element>();
// ── end jr7 ENGINE-7 E2 item 6 ──

/** jr6 ENGINE: for a link (or an element inside one), a click listener on its window for the door's one press, in the
 *  capture phase, so it runs before anything the page listens with: it cancels the default of a click on the link or
 *  inside it (clickUploadReveal). It is no one-shot: a click the page's own handler makes meanwhile (its label's, its
 *  input's) passes through it untouched and leaves it in place for the link's own (jr6 line W review, revD-03: a
 *  bubble-phase one-shot listener was skipped by a handler that stopped the click's propagation, and spent by such a
 *  nested click). Answers its removal, which the door runs once its click returned. Nothing for any other element. */
function cancelLinkOnce(reveal: HTMLElement): () => void { // jr6 ENGINE
  const view = reveal.ownerDocument.defaultView;
  if (view === null || reveal.closest('a[href]') === null) return () => undefined;
  const onClick = (event: Event) => {
    const target = event.target as Node | null;
    if (!event.defaultPrevented && target !== null && (target === reveal || reveal.contains(target))) {
      event.preventDefault();
    }
  };
  view.addEventListener('click', onClick, { capture: true }); // jr6 ENGINE (revD-03)
  return () => view.removeEventListener('click', onClick, { capture: true }); // jr6 ENGINE (revD-03)
}
// ── end jr6 ENGINE E2 item 9 ── // jr6 ENGINE
