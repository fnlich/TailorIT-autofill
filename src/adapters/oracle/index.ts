/*
 * The Oracle Recruiting Cloud adapter (its Candidate Experience; docs/design/runtime.md §9; docs/ARCHITECTURE.md
 * "Adapters", "Oracle Recruiting Cloud"): the quirks of a tenant's public pages, its posting and its email gate. Every
 * hook was read from the public capture of 2026-11-04/05 (docs/FIXTURES.md, "The Workday, iCIMS, Taleo, SuccessFactors
 * and Oracle capture"; elhr on us2 and JPMC's region-less tenant: JPMC's posting and elhr's gate converted as
 * fixtures/oracle/*.html) and names the markup it relies on. There is no password anywhere: identity is the email gate, whose Next sends the candidate a code
 * (a PIN). The code's page and the application's sections after it are not public: they wait for the owner's
 * snapshots; no hook below is written for the sections, which are read with the standard semantics the generic adapter
 * gives. The site is a single-page application (Knockout and Oracle JET): the posting is drawn 5 to 6 s after the address
 * commits, and APPLY NOW changes the address in place to .../apply/email, whose gate is drawn about 3 s later
 * (quirks.formLateMs: the runtime's 30 s cap).
 * - Form root: the application flow's content, main#main > section.apply-flow__content (the main labelled by
 *   h1#apply-flow-main-heading, "Job application form"), which holds the gate and, by the flow, the steps after it in
 *   the same document. The posting has none.
 * - The posting (postingText): the first .job-details__description-content (the description; the second is "about").
 * - Entry (entryControl): the first visible "APPLY NOW", button.apply-now-button in .job-details__section-apply-button
 *   (a typeless button with no form), a route change in the same document after which the gate is drawn there: the
 *   runtime's late watch finds it. Never pressed by a run (entryNeverPressed).
 * - authState: the gate is an 'email-gate', read by its address first (url.ts isOracleEmailGate: .../job/<id>/apply/email;
 *   the page's own address, or a fixture's base address) and its email box (input[name=primary-email]) in the flow: a
 *   later step that holds the same box is no gate (the v3 Phase 6/7b review, S2). The code's page is 'email-code' by the
 *   one sign Jobright's reading gives and no snapshot shows yet: four or more one-character boxes (maxlength 1) in the
 *   flow.
 * - Sign-in Auto (signInForm, wall 'email-gate'; docs/SPEC-AMENDMENTS.md §12): the gate as authState reads it, whose
 *   form also holds what only the gate has: its CANCEL (data-qa=emailVerificationCancelButton) and its honeypot
 *   (input[name=honey-pot], aria-hidden, out of the tab order, drawn invisible, never typed into). That form has no
 *   method and no action, sent by Oracle's own script (scriptSubmits); its email input[name=primary-email][type=email],
 *   drawn in front of the flow's background image (colourUnknown: the colour test's one opt-out); its terms box
 *   input#legal-disclaimer-checkbox ("I agree with the terms and conditions", required, drawn at 0 by 0 behind its
 *   label) on a gate that shows one; its NEXT, the submit button whose title, aria-label or words read "Next" (never
 *   "the form's one submit button": the flow's pagination button is shared), which the page enables once the form is
 *   filled (enablesWhenFilled). The terms box is reached through its label, whose words must read clear: on the
 *   captured tenants they are drawn over that image too, so Sign-in Auto refuses those gates ('hidden') and the gate is
 *   the person's, failing closed. The code NEXT sends is the person's. Sign-in Auto acts only on a host the every-site
 *   sign-in covers (<tenant>.fa.<region>.oraclecloud.com, and since TailorIT's contract API 5 a region-less
 *   <tenant>.fa.oraclecloud.com: JPMC's).
 * - Never pressed (neverPress): APPLY NOW (the entry door's alone), the gate's CANCEL, the dialogs' buttons (the cookie
 *   preferences, the session's end, the agreement's Close), the map's controls, the Digital Assistant's chat button and
 *   the copyright links.
 * The snapshot build of 2026-11-06 (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06), from the owner's snapshots: Fortive's code page
 * ([ejta.fa.us6.oraclecloud.com], still at .../apply/email: fixtures/oracle/fortive-email-code.html) and a tenant's
 * application on Oracle's government cloud ([iaaxmg.fa.ocs.oraclegovcloud.com] .../apply/section/1: the one-page flow,
 * every section on one page and Submit at its foot: fixtures/oracle/hjf-apply-section.html):
 * - Form root: also the flow's own form on a section page, main#main > section.apply-flow__content-container >
 *   form.apply-flow__content.apply-flow__content-form.
 * - authState 'email-code': the code page ("Confirm Your Identity"), div.apply-flow-pin-code-required holding the six
 *   boxes input.pin-code-input__input (each aria-label "Enter verification code digit <n> of six.", no maxlength: the
 *   one-character reading Jobright's gave is not Oracle's and was dropped). The code is the person's alone.
 * - Labels (labelFor, requiredFor): an answer-pill group (Oracle's cx-select-pills: ul[role=radiogroup] of
 *   button[role=radio][aria-checked], its question in the row's label.input-row__label, whose for names no control),
 *   and the phone's number box (input.phone-row__input, its row's label "Phone Number"), each read from its own
 *   .input-row's label; the row's label.input-row__label--required marks it required.
 * - Uploads (uploadWidgets): a document's hidden input[type=file].file-form-element__input behind its visible "Upload
 *   Cover Letter" label[for], labelled by its drop zone's words ("Drop Cover Letter Here"). The resume's own, once
 *   attached, shows its file's name and "Remove Resume" instead (no input): what an upload in progress or a failed one
 *   shows is not in any snapshot.
 * - Submit (submitButton, isFinalStep): the one-page flow's only pagination button,
 *   button.apply-flow-pagination__submit-button ("Submit"), never pressed by a fill; a flow that shows it is on its
 *   final step.
 * - Errors: the timeline's invalid entry, .beautiful-timeline-item--invalid-block (an entry the page marks
 *   data-profile-item-invalid), besides the standard ones; and (the behaviour review of 2026-11-06, M4) the page's own
 *   error notification after a Submit it refused, li.notifications__item.cx-notifications__item--error ("You have 1
 *   issue that needs to be fixed before you can submit your application."), the same tenant's snapshot 12 s after its
 *   Submit (fixtures/oracle/hjf-after-submit.html: no aria-invalid there, and the timeline's mark gone). Read while a
 *   person can see it: as captured, the Submit's checklist dialog (oj-dialog.apply-flow-checklist-dialog, modal) is
 *   still open over the page, whose layer div.app it makes aria-hidden, so the notification reads once that dialog
 *   closes (display none and no aria-hidden on div.app, as hjf-apply-section.html shows them before the Submit).
 * - Never pressed: the code page's "Send New Code" (it emails a new code), the flow's "Import Profile Again", the
 *   attached resume's name (a download) and "Remove Resume", each combobox's "Remove value for the <field> field"
 *   (button.icon-clear), the email's "Edit email address", the header's "Back to Job Details", the timeline's "Add
 *   Experience" and "Add Education", the licences' "Add License" and the links' "Add Another Link".
 * What the scanner reads there, and why most of it is not fillable (the flow's form is a 75% translucent panel over the
 * tenant's cover image, so the trap rules cannot work out its colours), is oracle.browser.test.ts's KNOWN list.
 * jr6 (FIXPLAN §6.11, APPLYPLAN E-Oracle; the owner's snapshots of a us2 tenant's posting and gate,
 * fixtures/oracle/jr6-caesars-posting.html and jr6-caesars-email-gate.html; Jobright 1.25.2 as a behaviour reference,
 * each rule citing its function; jr6-oracle.browser.test.ts):
 * - Entry (C8): APPLY NOW only in its "apply now" state, by its modifier apply-now-button--apply-now or its words "Apply
 *   Now" in any case; the same button in another state is never the entry (it stays never pressed).
 * - Never pressed (O16): the gate's "Do you want to communicate by phone instead?".
 * - Labels (O5): the phone's country-code picker by its own sub-label, "Country code", read first (labelFirst).
 * - The phone's number box (O4): drawn by its bordered phone-row group (controlBox).
 * Nothing here reads, logs or sends a value.
 */
// The P2 review (security 1)
import { oracleCandidateExperienceShown } from '../../dom/page-signals';
import { newScanCache, type ScanCache } from '../../dom/scan-cache';
import { oracleOwnDomain } from '../../shared/hosts';
import { isUserVisible } from '../../dom/visibility';
import { genericAdapter } from '../generic';
import type { Adapter, SignInForm, SignInWall } from '../types';
import { canonicalApplicationUrl, isOracleEmailGate, matchesUrl } from './url';

/** The snapshots the hooks were written from (fixtures/oracle/). */
export const ORACLE_SNAPSHOTS = ['fixtures/oracle/jpmc-posting.html', 'fixtures/oracle/elhr-email-gate.html',
  // ── snapshot build 2026-11-06 (oracle-sf-sr) ──
  'fixtures/oracle/fortive-email-code.html', 'fixtures/oracle/hjf-apply-section.html',
  // ── behaviour review 2026-11-06 (M4): the same flow 12 s after its Submit ──
  'fixtures/oracle/hjf-after-submit.html',
  // ── jr6 ORACLE (FIXPLAN §6.11): the owner's snapshots of a us2 tenant's posting and its email gate ──
  'fixtures/oracle/jr6-caesars-posting.html', 'fixtures/oracle/jr6-caesars-email-gate.html'] as const;

/** The longest an Oracle page takes to draw its posting or its gate: the runtime's cap. */
export const ORACLE_FORM_LATE_MS = 30_000;
/** How long the agent's entry waits for APPLY NOW (the posting is drawn 5 to 6 s after the address commits). */
export const ORACLE_ENTRY_WAIT_MS = 15_000;

/** The first of `elements` a person can see. */
function shown<T extends Element>(elements: readonly T[], cache: ScanCache = newScanCache()): T | null {
  return elements.find((el) => isUserVisible(el, cache)) ?? null;
}

/** The flow's content: fixtures/oracle/elhr-email-gate.html's <main id="main" aria-labelledby="apply-flow-main-heading"
 *  ...><section class="apply-flow__content" ...>; on a section page (fixtures/oracle/hjf-apply-section.html) the flow's
 *  own <form class="apply-flow__content apply-flow__content-form" novalidate>. */
function flowOf(doc: Document): Element | null {
  return shown(Array.from(doc.querySelectorAll(
    'main[aria-labelledby="apply-flow-main-heading"] section.apply-flow__content, '
    + 'main[aria-labelledby="apply-flow-main-heading"] form.apply-flow__content-form')));
}

function detect(doc: Document): { formRoot: Element } | null {
  const flow = flowOf(doc);
  return flow === null ? null : { formRoot: flow };
}

/** The document's own address: its location's, or (a fixture's srcdoc page) its base address; null when neither
 *  reads. */
function addressOf(doc: Document): URL | null {
  try {
    const href = doc.location.href;
    return new URL(/^https?:/i.test(href) ? href : doc.baseURI);
  } catch {
    return null;
  }
}

/** The gate's email box, on the gate's address alone (module header): <input ... id="primary-email-0"
 *  name="primary-email" type="email" autocomplete="email" aria-required="true">, a person can see it. */
function gateEmail(doc: Document): HTMLInputElement | null {
  const address = addressOf(doc);
  const flow = address === null || !isOracleEmailGate(address) ? null : flowOf(doc);
  return flow === null ? null
    : shown(Array.from(flow.querySelectorAll<HTMLInputElement>('input[name="primary-email"][type="email"]')));
}

/** The words a button goes by: its title, its aria-label and its text, each trimmed, in lower case. */
const namesOf = (button: Element) => [button.getAttribute('title'), button.getAttribute('aria-label'),
  button.textContent].map((name) => (name ?? '').replace(/\s+/g, ' ').trim().toLowerCase());

/** The posting's own text: fixtures/oracle/jpmc-posting.html's first <div class="job-details__description-content">. */
function postingText(doc: Document): Element | null {
  return shown(Array.from(doc.querySelectorAll('.job-details__description-content')));
}

/** The P2 review (security 1): whether the document is at an employer's own domain's Candidate Experience address
 *  (shared/hosts.ts oracleOwnDomain) without the app's own markup (dom/page-signals.ts oracleCandidateExperienceShown):
 *  a page anyone may host there. Nothing of it is ever pressed: no Submit, no final step, no APPLY NOW. (adaptersFor
 *  gives such a page the site adapter; this holds it again for a run that picked Oracle's.) */
function unprovenOwnDomain(doc: Document): boolean {
  const address = addressOf(doc);
  return address !== null && oracleOwnDomain(address.hostname.toLowerCase(), address.pathname)
    && !oracleCandidateExperienceShown(doc);
}

/** jr6 C8 (APPLYPLAN E-Oracle): the state the posting's button is in when it opens the application. Both postings
 *  (jpmc-posting.html and jr6-caesars-posting.html) draw it <button data-bind="click: click, enable: isEnable, class:
 *  buttonStatusC" class="button apply-now-button theme-color-1 apply-now-button--apply-now">Apply Now</button>: its
 *  binding swaps that modifier for the button's other states, which no snapshot shows. */
const APPLY_NOW_STATE = 'apply-now-button--apply-now';

/** Whether the button is in its "apply now" state: its modifier, or its own words "Apply Now" in any case (Jobright
 *  1.25.2's proceedOracleJobDetailToApply takes only a button whose words are exactly "APPLY NOW" or "Apply Now"). Another
 *  state of the same button ("already applied", a closed posting) is never the entry. */
function appliesNow(button: HTMLElement): boolean {
  return button.classList.contains(APPLY_NOW_STATE)
    || (button.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase() === 'apply now';
}

/** APPLY NOW: <div class="job-details__section-apply-button"><button class="... apply-now-button ...">, in its "apply
 *  now" state (appliesNow). */
function entryControl(doc: Document): HTMLElement | null {
  if (unprovenOwnDomain(doc)) return null;
  return shown(Array.from(doc.querySelectorAll<HTMLElement>(
    '.job-details__section-apply-button button.apply-now-button')).filter(appliesNow));
}

function authState(doc: Document): ReturnType<NonNullable<Adapter['authState']>> {
  const flow = flowOf(doc);
  if (flow === null) return null;
  if (gateEmail(doc) !== null) return 'email-gate';
  // fixtures/oracle/fortive-email-code.html: <div class="apply-flow-pin-code-required ..."> ... <input class="input-row__control
  // pin-code-input__input" type="text" inputmode="numeric" ... id="pin-code-1" aria-required="true">, six of them.
  const cache = newScanCache();
  const boxes = Array.from(flow.querySelectorAll<HTMLInputElement>('.apply-flow-pin-code-required input.pin-code-input__input'))
    .filter((input) => isUserVisible(input, cache));
  return boxes.length > 0 ? 'email-code' : null;
}

/** The controls whose label is their row's own label, which names no control by its for: an answer-pill group (<ul
 *  role="radiogroup" ... class="cx-select-pills-container">) and the phone's number box (<input type="tel"
 *  class="input-row__control phone-row__input" ...>), in hjf-apply-section.html. */
const ROW_LABELLED = 'ul.cx-select-pills-container[role="radiogroup"], input.phone-row__input';

/** A document's upload input: hjf-apply-section.html's <input type="file" class="file-form-element__input upload-button"
 *  multiple="" id="attachment-upload-3" name="attachment-upload" ...>, drawn hidden behind its <label
 *  class="file-form-element__label attachment-upload-button__label ..." for="attachment-upload-3">Upload Cover
 *  Letter</label>, in a drop zone <div class="attachment-upload-button ..."> that names the document: <span
 *  class="attachment-upload-button__drag-and-drop-label ...">Drop Cover Letter Here</span>. */
const UPLOAD_INPUT = 'input[type="file"].file-form-element__input';

/** Each upload input with its visible "Upload <document>" label (UPLOAD_INPUT). */
function uploadWidgets(root: Element): Array<{ control: Element; input: HTMLInputElement }> {
  const labels = Array.from(root.querySelectorAll<HTMLLabelElement>('label.file-form-element__label[for]'));
  return Array.from(root.querySelectorAll<HTMLInputElement>(UPLOAD_INPUT)).flatMap((input) => {
    const control = input.id === '' ? undefined : labels.find((label) => label.htmlFor === input.id);
    return control === undefined ? [] : [{ control, input }];
  });
}

/** jr6 O5: the phone's country-code picker, hjf-apply-section.html's <input name="phoneNumber"
 *  id="country-codes-dropdownphoneNumber" type="text" role="combobox" aria-haspopup="grid" ... class="cx-select-input">,
 *  whose row's label[for] names it "Phone Number" (the number box's question) while its own <div
 *  class="cx-select-container"> draws its words beside it: <span id="inputFieldLabel-country-codes-dropdownphoneNumber"
 *  class="input-field__label">Country code</span>. Jobright 1.25.2's rules.getRules names it the phone's country code by
 *  that id or that sub-label. */
const PHONE_CODE = 'input.cx-select-input[id^="country-codes-dropdown"]';

/** A row-labelled control's question (module header): its row's (<div class="input-row ...">) <form-element-label><label
 *  class="input-row__label ...">; an upload input's, its drop zone's words (UPLOAD_INPUT); jr6 O5: the phone's
 *  country-code picker's, its own sub-label (PHONE_CODE). */
function labelFor(control: Element): Element | null {
  if (control.matches(UPLOAD_INPUT)) {
    return control.closest('.attachment-upload-button')?.querySelector('.attachment-upload-button__drag-and-drop-label')
      ?? null;
  }
  if (control.matches(PHONE_CODE)) {
    return control.closest('.cx-select-container')?.querySelector('span.input-field__label') ?? null;
  }
  if (!control.matches(ROW_LABELLED)) return null;
  return control.closest('.input-row')?.querySelector(':scope > form-element-label > label.input-row__label') ?? null;
}

/** jr6 O5: the country-code picker's own sub-label is read before the row's label[for] (labelFor), so it reads
 *  "Country code", the phone's country code, and the planner writes the number beside it without its calling code. */
function labelFirst(control: Element): boolean {
  return control.matches(PHONE_CODE);
}

/** jr6 O4: the phone's number box, hjf-apply-section.html's <input type="tel" class="input-row__control
 *  phone-row__input" ...>, draws no border or background of its own: its <div class="input-row-composite__inputs
 *  phone-row" role="group"> draws the bordered box around it and the country-code picker (ENGINE E2's camouflage
 *  check reads this box as the control's own). Null for every other control. */
function controlBox(control: Element): Element | null {
  return control.matches('input.phone-row__input')
    ? control.closest('.input-row-composite__inputs.phone-row[role="group"]') : null;
}

/** Whether the page marks a row-labelled control required: its row's label has input-row__label--required (drawn with
 *  its star, <span class="input-row__label--required-star" aria-hidden="true">). */
function requiredFor(control: Element): boolean {
  return labelFor(control)?.classList.contains('input-row__label--required') ?? false;
}

/** Submit: the one-page flow's <div class="apply-flow-pagination"> ... <button type="button" class="button
 *  apply-flow-pagination__button apply-flow-pagination__submit-button ...">Submit</button> (hjf-apply-section.html). */
function submitButton(root: Element): HTMLElement | null {
  if (unprovenOwnDomain(root.ownerDocument)) return null;
  return shown(Array.from(root.ownerDocument.querySelectorAll<HTMLElement>(
    '.apply-flow-pagination button.apply-flow-pagination__submit-button')));
}

/** A flow that shows its Submit is on its final step; the gate, the code page and the posting say nothing. */
function isFinalStep(doc: Document): 'final' | 'not-final' | 'unknown' {
  return flowOf(doc) !== null && submitButton(doc.documentElement) !== null ? 'final' : 'unknown';
}

/** The page's error notification after a Submit it refused (module header, M4): hjf-after-submit.html's <notifications>
 *  <div role="alert" ... class="notifications font-family-primary notifications--active"> <ul class="notification__list">
 *  <li class="notifications__item text-color-primary focused-with-keyboard cx-notifications__item--error
 *  cx-notifications__item--dismiss"> ... <div class="notifications__item-message">You have 1 issue that needs to be fixed
 *  before you can submit your application.</div>, outside the flow's form. */
const NOTIFIED_ERROR = 'li.notifications__item.cx-notifications__item--error';

/** The page's own errors, besides the standard ones: hjf-apply-section.html's timeline entry the page marks invalid,
 *  <div class="beautiful-timeline-item--invalid-block icon-alert-error">, and its error notification after a refused
 *  Submit (NOTIFIED_ERROR), each while a person can see it. */
function errors(root: Element): Array<{ el: Element; fieldKeyHint?: string }> {
  const cache = newScanCache();
  const marks = Array.from(root.ownerDocument.querySelectorAll('.beautiful-timeline-item--invalid-block'))
    .filter((el) => isUserVisible(el, cache)).map((el) => ({ el }));
  // ── behaviour review 2026-11-06 (M4) ──
  const notified = Array.from(root.ownerDocument.querySelectorAll(NOTIFIED_ERROR))
    .filter((el) => isUserVisible(el, cache)).map((el) => ({ el }));
  return [...(genericAdapter.errors?.(root) ?? []), ...marks, ...notified];
}

/** Sign-in Auto's form at the gate (module header): fixtures/oracle/elhr-email-gate.html's <form novalidate=""> (no
 *  method, no action) holding its email, its <button type="button" ... data-qa="emailVerificationCancelButton"
 *  title="Cancel">, its <input ... name="honey-pot" ... aria-hidden="true" tabindex="-1">, its terms box <input
 *  type="checkbox" class="input-row__hidden-control" id="legal-disclaimer-checkbox" ... required=""> and its <button
 *  type="submit" ... title="Next" aria-label="Next">. */
function signInForm(doc: Document, wall: SignInWall): SignInForm | null {
  if (wall !== 'email-gate') return null;
  const email = gateEmail(doc);
  const form = email?.form ?? null;
  if (email === null || form === null || form.querySelector('[data-qa="emailVerificationCancelButton"]') === null
    || form.querySelector('input[name="honey-pot"]') === null) return null;
  const buttons = Array.from(form.querySelectorAll<HTMLButtonElement>('button[type="submit"]'))
    .filter((button) => button.form === form && isUserVisible(button) && namesOf(button).includes('next'));
  if (buttons.length !== 1) return null;
  const terms = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]#legal-disclaimer-checkbox'))
    .filter((box) => !box.checked);
  return { email, password: null, confirm: null, terms, button: buttons[0]!, form, colourUnknown: [email],
    enablesWhenFilled: true, scriptSubmits: true };
}

/** The controls never pressed (module header): the gate's <button type="button" ...
 *  data-qa="emailVerificationCancelButton" title="Cancel">, the dialogs' <button class="app-dialog__close ...">, their
 *  footers' buttons, the map's controls (maplibregl-ctrl-*), the chat (.oda-chat-button) and the copyright links. */
const NEVER_PRESSED = ['.job-details__section-apply-button button.apply-now-button',
  '[data-qa="emailVerificationCancelButton"]', 'button.app-dialog__close', '.app-dialog__footer-button',
  '[class*="maplibregl-ctrl"]', 'button.maplibregl-popup-close-button', '.oda-chat-button', 'a.oracle-copyright',
  'a.oracle-copyright__terms', 'a.oracle-copyright__legal',
  // ── snapshot build 2026-11-06 (oracle-sf-sr; module header) ──
  // fortive-email-code.html: <button class="pin-code-form__action-button text-color-primary" type="button">Send New Code.
  'button.pin-code-form__action-button',
  // hjf-apply-section.html: "Import Profile Again", the attached resume's name and "Remove Resume", each combobox's
  // "Remove value for the <field> field", "Edit email address", "Back to Job Details", the timeline's, the licences'
  // and the links' Add buttons.
  'button.apply-flow-profile-import-again-button', 'button.attachment-upload-button__download',
  'button.attachment-upload-button__bottom-button', 'button.icon-clear', 'button.communication-channel__value-edit',
  'button.app-header__close', '#timeline-add-experience-button', '#timeline-add-education-button',
  'button.apply-flow-profile-item-tile__new-tile', 'button.candidate-links__add-link',
  // ── jr6 O16 ── jr6-caesars-email-gate.html: <button type="button" class="quick-apply-flow-verify-method__button" ...>Do
  // you want to communicate by phone instead?</button>, inside the gate's form: it switches the gate to a code sent by
  // text message (Jobright 1.25.2's gate handler never presses it either).
  'button.quick-apply-flow-verify-method__button'];

function neverPress(root: Element): Element[] {
  return Array.from(root.ownerDocument.querySelectorAll(NEVER_PRESSED.join(', ')));
}

/** The Oracle Recruiting Cloud adapter. */
export const oracleAdapter: Adapter = {
  id: 'oracle',
  matchesUrl,
  canonicalApplicationUrl,
  detect,
  postingText,
  authState,
  signInForm,
  neverPress,
  // ── snapshot build 2026-11-06 (oracle-sf-sr; module header) ──
  labelFor,
  requiredFor,
  uploadWidgets,
  submitButton,
  errors,
  isFinalStep,
  quirks: { formLateMs: ORACLE_FORM_LATE_MS, entryWaitMs: ORACLE_ENTRY_WAIT_MS },
  entryControl,
  // APPLY NOW is never pressed by a run (neverPress): the entry door presses that element alone.
  entryNeverPressed: true,
  // ── jr6 ORACLE (FIXPLAN §6.11; module header) ──
  labelFirst,
  controlBox,
};
