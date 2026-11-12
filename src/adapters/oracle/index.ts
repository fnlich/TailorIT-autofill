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
 * - Widgets (O1, O2): every cx-select (input.cx-select-input[role=combobox]) a combobox opened by its toggle, its
 *   results the rows of the grid its aria-controls names, chosen by their label part; Address Line 1 (Oracle Maps'
 *   search) and ZIP Code are searches (typeahead-remote), Address Line 1 typed into at once (it has no toggle, and its
 *   suggestions come from the words typed); the address's dependent lists learn under the Country shown.
 * - The address's order (O3, dependsOn): Address Line 1 after the Country; ZIP Code, City, State and County after
 *   Address Line 1 (after the Country where the block has no street search).
 * - The timeline (oracle-new-2, O7): its open inline editor is a repeatable block of the kind its fields tell (School and
 *   Degree, or Employer Name and Job Title), only while it shows; no Add is declared (question 1), and the entry it
 *   holds is read by its School, or its Employer Name and Job Title (prefill.readEntries), so the planner matches it by
 *   fingerprint and keeps one no profile entry matches.
 * - Steps (O8; no snapshot of a flow of several sections yet, owner question 23): a section's Next is the pagination's
 *   button reading "Next" (never its Submit, never on the gate or the code page); a section page (.../apply/section/<n>)
 *   showing it and no Submit is not the last; each page's step signature is its section number, the progress step
 *   marked aria-current, its first block title and its blocks' kinds.
 * - Uploads (O12, uploadState): a document's slot says whether the file Oracle took is done (its filled part naming
 *   the file) or failed (its errors' list), found by the input or, once Oracle took the input away, by that list.
 * Nothing here logs or sends a value. The jr6 hooks read three things a box shows, in the frame: the Country an address
 * block shows (hashed into a learned list's key only), the School, Employer Name and Job Title an open timeline editor
 * shows (prefill.readEntries: to the worker's plan only, as a field's current value goes), and whether an upload slot
 * shows the file's name (compared, never kept).
 * jr7 ORACLE-7 (FIX7PLAN §6.10; the owner's snapshot7 oraclecloud1, one application on a tenant of Oracle's ocs cloud
 * from its posting to the page after submitting: fixtures/oracle/jr7-oraclecloud1-*; Jobright 1.25.2 as a behaviour
 * reference, each rule citing its function):
 * - The code at Submit (jr7-O1): this tenant's gate leads straight to the form, and its email is verified after the
 *   Submit: Oracle's checklist, then a dialog drawn beside the hidden form ("You're almost done": six code boxes, Verify,
 *   Send New Code). authState reads that dialog 'email-code' (from the flow's main, not flowOf), the step signature
 *   changes when it shows (its section and the account state), and its Verify is never pressed. The code is the
 *   person's.
 * - Success (jr7-O2): the site's my-profile is the page after submitting (confirmationAfter, url.ts
 *   oracleConfirmationAfter), and its "My Applications" tile naming the armed application, active and with its status
 *   shown, is the drawn sign (successSigns); never a draft's or a resolved one's, never another application's.
 * - The tile layout (jr7-O4): the Education and Experience blocks' inline editor is a repeatable block of its kind
 *   (as the timeline's is), its entry read by its boxes' names; its invalid rows are errors; the tiles' Edit and Delete
 *   are never pressed. The Skills block's editor is no repeatable (its rows are the person's: owner question Q7-11).
 * - A required block with nothing to fill (jr7-O7): the Skills block, required, with no tile, no open editor and no
 *   control, is left for the person (requiredBlocksLeft), so Submit Auto holds until a skill is added.
 * The jr7 hooks read the page's markup and its own address only: a my-profile tile's link is read into the armed
 * application's key to be compared, never kept; its words are not read.
 */
// The P2 review (security 1)
import { oracleCandidateExperienceShown, oracleShellShown } from '../../dom/page-signals';
import { newScanCache, type ScanCache } from '../../dom/scan-cache';
import { oracleOwnDomain, platformOfUrl } from '../../shared/hosts';
import { visibleText } from '../../dom/visible-text';
import { isUserVisible } from '../../dom/visibility';
import { applicationKey } from '../application-key';
import { genericAdapter } from '../generic';
import type { Adapter, PrefillEntryView, SignInForm, SignInWall, UploadState, WidgetDecl } from '../types';
import { canonicalApplicationUrl, isOracleEmailGate, matchesUrl, oracleApplySection, oracleConfirmationAfter,
  oracleMyProfileSite, parseOracleUrl } from './url';

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
/** jr6 O1: how long a cx-select's list may show no result, no busy sign and no change after a query before the query is
 *  taken to have found nothing (Jobright 1.25.2's operations.fillSelectField polls Oracle's rows up to 14 times, 150 to
 *  300 ms apart, ignoring a "No results" row: 2.1 to 4.2 s). */
export const ORACLE_EMPTY_AFTER_MS = 3_000;

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

// ── jr7 ORACLE-7 (FIX7PLAN §6.10 item 1, jr7-O1): the code Oracle asks for at Submit ──
/** jr7-O1: the dialog Oracle draws after the application's Submit when it verifies the email then (snapshot7
 *  oraclecloud1, fixtures/oracle/jr7-oraclecloud1-submit-code.html): beside the flow's form, which it hides (display
 *  none, aria-hidden: so flowOf reads none), main#main > section.apply-flow__content-container > div.apply-flow__content
 *  > ... > <div class="apply-flow-summary-pin-code-required apply-flow__auto-width"> ("You're almost done") holding
 *  <form class="pin-code-verification">: its six <input class="input-row__control pin-code-input__input ..."
 *  inputmode="numeric" ... aria-label="Enter verification code digit <n> of six."> (no maxlength), its <button
 *  type="submit" class="apply-flow-dialog__button apply-flow-dialog__button--primary">Verify</button> and its
 *  "Send New Code". Jobright 1.25.2's isOraclePinPage needs a "Confirm Your Identity" heading and one-character boxes,
 *  so it would not read this one either; it leaves the page to the person and keeps its arm (5 minutes), as ours
 *  does. */
const SUBMIT_CODE = '.apply-flow-summary-pin-code-required';

/** jr7-O1: whether the flow's main shows the code dialog after Submit (SUBMIT_CODE), by a code box a person can see. */
function submitCodeShown(doc: Document, cache: ScanCache = newScanCache()): boolean {
  return Array.from(doc.querySelectorAll(
    `main[aria-labelledby="apply-flow-main-heading"] ${SUBMIT_CODE} input.pin-code-input__input`))
    .some((box) => isUserVisible(box, cache));
}
// ── end jr7 ORACLE-7 ──

function authState(doc: Document): ReturnType<NonNullable<Adapter['authState']>> {
  const flow = flowOf(doc);
  const cache = newScanCache();
  if (flow !== null) {
    if (gateEmail(doc) !== null) return 'email-gate';
    // fixtures/oracle/fortive-email-code.html: <div class="apply-flow-pin-code-required ..."> ... <input
    // class="input-row__control pin-code-input__input" type="text" inputmode="numeric" ... id="pin-code-1"
    // aria-required="true">, six of them.
    const boxes = Array.from(flow.querySelectorAll<HTMLInputElement>('.apply-flow-pin-code-required input.pin-code-input__input'))
      .filter((input) => isUserVisible(input, cache));
    if (boxes.length > 0) return 'email-code';
  }
  // jr7-O1: the code at Submit, drawn beside the hidden form.
  return submitCodeShown(doc, cache) ? 'email-code' : null;
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

/** jr6 O12: a document's upload slot, hjf-apply-section.html's <cover-letter-upload-button><div> <div
 *  class="attachment-upload-button attachment-upload-button--waiting"> ... the input ... </div> <div
 *  id="file-upload-errors-1"> (its errors' list) </div></div>, whose input names that list by its aria-describedby
 *  ("file-upload-errors-1"). Oracle sends the file to its server once it is put in, and draws the slot again: its
 *  waiting part, input and all, goes, and the filled part shows the file's name (the resume's slot as captured: <div
 *  class="attachment-upload-button attachment-upload-button--filled"> ... <div class="attachment-upload-button__filled">
 *  <button type="button" class="attachment-upload-button__download">(the name)</button><button ...
 *  class="attachment-upload-button__bottom-button">), while the errors' list stays. So the slot is found by the input
 *  where it is still in the page, else by that list; null where neither is. */
function uploadSlotOf(input: HTMLInputElement): { slot: Element; errors: Element | null } | null {
  if (!input.matches(UPLOAD_INPUT)) return null;
  const listed = (input.getAttribute('aria-describedby') ?? '').split(/\s+/).find((id) => /^file-upload-errors-\d+$/.test(id));
  const errors = listed === undefined ? null : input.ownerDocument.getElementById(listed);
  const slot = (input.isConnected ? input.closest('.attachment-upload-button')?.parentElement : null)
    ?? errors?.parentElement ?? null;
  return slot === null ? null : { slot, errors };
}

/** jr6 O12: what Oracle's slot shows of the upload of `fileName` into `input` (Jobright 1.25.2's operations.uploadResume
 *  waits up to 10 s for .attachment-upload-button__filled): failed once its errors' list shows words; confirmed once its
 *  filled part shows, naming the file; pending otherwise; null for an input that is no Oracle upload (the input's own
 *  files decide). What an upload in progress or a refused file draws is in no snapshot (owner question 23). */
function uploadState(input: HTMLInputElement, fileName: string): UploadState | null {
  const found = uploadSlotOf(input);
  if (found === null) return null;
  const cache = newScanCache();
  const { slot, errors } = found;
  if (errors !== null && wordsOf(errors) !== '' && isUserVisible(errors, cache)) return 'failed';
  const name = fileName.replace(/\s+/g, ' ').trim().toLowerCase();
  const filled = Array.from(slot.querySelectorAll('.attachment-upload-button__filled'))
    .filter((part) => isUserVisible(part, cache));
  const named = filled.some((part) => Array.from(part.querySelectorAll('button.attachment-upload-button__download'))
    .some((button) => name !== '' && wordsOf(button).includes(name)));
  return named ? 'confirmed' : 'pending';
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

// ── jr6 O1, O2: Oracle's cx-select comboboxes ─────────────────────────────────────────────────────────────────────

/** jr6 O1: a cx-select, hjf-apply-section.html's <input autocomplete="none" name="country" id="country-17" type="text"
 *  role="combobox" aria-autocomplete="list" aria-haspopup="grid" aria-controls="country-17-listbox" aria-expanded="false"
 *  ... class="cx-select-input"> beside its <button type="button" id="country-17-toggle-button" tabindex="-1"
 *  aria-label="Open the drop-down list for Country." aria-expanded="false" aria-controls="country-17-listbox"
 *  class="icon-dropdown-arrow">: the phone's country code, the address's Country, Address Line 1, ZIP Code, City, State
 *  and County, and (hjf-after-submit.html) the education editor's Degree, School, the dates' Month and Year parts and
 *  Country. Its list is drawn only while open, at the end of the page under the id its aria-controls names, and no
 *  snapshot shows one open: what it holds is Jobright 1.25.2's reading (operations.fillSelectField and rules.getRules:
 *  rows div[role=row] of div[role=gridcell] holding span.cx-select__list-item--content, a "No results" row when
 *  nothing matches), to be confirmed on a capture of an open list (owner question Q23). */
const CX_SELECT = 'input.cx-select-input[role="combobox"]';

/** Oracle's own words for an empty list's one row (Jobright 1.25.2's operations reads "no results" and "no results
 *  found" so): never a result. */
const NO_RESULTS = /^no results(?: were)?(?: found)?[.!]*$/;

/** The words of an element, white space collapsed, in lower case. */
const wordsOf = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** jr6 O1: a cx-select's results: the rows of its list, Oracle's "No results" row left out. */
function cxRows(list: Element): readonly Element[] {
  return Array.from(list.querySelectorAll('[role="row"]')).filter((row) => !NO_RESULTS.test(wordsOf(row)));
}

/** jr6 O1: the part of a row that is its label: its span.cx-select__list-item--content, else its gridcell (Jobright
 *  1.25.2's operations reads the one, then the other). */
function cxRowLabel(row: Element): Element | null {
  return row.querySelector('.cx-select__list-item--content') ?? row.querySelector('[role="gridcell"]');
}

/** jr6 O1 (O3's block): the address block a geo-hierarchy cx-select sits in, hjf-apply-section.html's <fieldset
 *  class="address-form__group"> (legend "Address") whose rows <div class="input-row ... geo-hierarchy-form-element">
 *  hold Country, Address Line 1, ZIP Code, City, State and County; null for any other control. */
function addressBlockOf(control: Element): Element | null {
  const row = control.closest('.input-row.geo-hierarchy-form-element');
  return row === null ? null : row.closest('fieldset.address-form__group, .apply-flow-block');
}

/** The address block's visible cx-select of that name (country, addressLine1), or null. */
function addressPart(block: Element, name: string): HTMLInputElement | null {
  return shown(Array.from(block.querySelectorAll<HTMLInputElement>(
    `.input-row.geo-hierarchy-form-element ${CX_SELECT}[name="${name}"]`)));
}

/** jr6 O2: the searches among the cx-selects, typed into rather than chosen from whole: Oracle Maps' street search,
 *  hjf-apply-section.html's Address Line 1 <input ... name="addressLine1" ... aria-describedby="oracle-maps-search-hint
 *  ..." class="cx-select-input cx-select-input--auto-suggest"> (no toggle: Jobright 1.25.2's rules.getRules skips it as
 *  a remote search by that class), and the address's ZIP Code, <input ... name="postalCode" ...>, whose list is every
 *  postal code of the country (Jobright's operations types it, then its first three characters). */
function isSearch(control: HTMLInputElement): boolean {
  return control.classList.contains('cx-select-input--auto-suggest')
    || (control.name === 'postalCode' && addressBlockOf(control) !== null);
}

/** jr6 O1: the Country an address block shows now, for its dependent lists (City, State and County; ZIP Code is a
 *  search, whose results are never learned): page text, hashed into a learned list's key (dom/widgets/known.ts
 *  learnedListKey), so another country's lists are never offered for them; null where it shows none. */
function countryShown(control: Element): string | null {
  const block = addressBlockOf(control);
  const country = block === null ? null : addressPart(block, 'country');
  if (country === null || country === control) return null;
  const text = country.value.replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
}

/** jr6 O1, O2: the declaration of a cx-select (CX_SELECT): opened by its toggle where it has one, else by the box
 *  itself, whose aria-expanded says whether it is open; closed by Escape only; its results the rows of the list its
 *  aria-controls names (cxRows), chosen by a click on the row's label part (cxRowLabel); busy while the list says
 *  aria-busy; a query that shows no result for ORACLE_EMPTY_AFTER_MS found nothing. Address Line 1 and ZIP Code are
 *  searches (isSearch). Null for any other control.
 *  jr6 ORACLE P2: a search with no toggle (Address Line 1) names no element that says it is open (no `expanded`), so a
 *  search types its query at once instead of clicking its box first: Oracle Maps draws suggestions for the words typed
 *  (its hint, hjf-apply-section.html's <p id="oracle-maps-search-hint">Enter your street name and other address details
 *  to see suggestions</p>; the box captured aria-expanded="false"), and Jobright 1.25.2's operations.fillSelectField
 *  types Address Line 1 before it waits for a list. A box that says "false" would be clicked first, and a click alone
 *  draws no list there, which reads as needs-your-click (dom/widgets/typeahead.ts searchTypeahead). */
function widgetFor(control: Element): WidgetDecl | null {
  // By name, never instanceof: a frame's elements belong to its own window's classes.
  if (control.localName !== 'input' || !control.matches(CX_SELECT)) return null;
  const input = control as HTMLInputElement;
  const doc = input.ownerDocument;
  const toggle = input.id === '' ? null : doc.getElementById(`${input.id}-toggle-button`);
  const opener: HTMLElement = toggle !== null && toggle.localName === 'button' ? toggle : input;
  const listId = input.getAttribute('aria-controls') ?? opener.getAttribute('aria-controls');
  const context = isSearch(input) ? null : countryShown(input);
  return {
    kind: isSearch(input) ? 'typeahead-remote' : 'combobox',
    opener,
    ...(opener === input && isSearch(input) ? {} : { expanded: opener }),
    keys: ['Escape'],
    results: { list: () => (listId === null || listId === '' ? null : doc.getElementById(listId)), option: '[role="row"]',
      options: cxRows, choose: 'label' },
    optionLabel: cxRowLabel,
    busy: ['[aria-busy="true"]'],
    emptyAfterMs: ORACLE_EMPTY_AFTER_MS,
    ...(context === null ? {} : { learnContext: context }),
    snapshot: input.closest('timeline-form-inline') === null ? 'fixtures/oracle/hjf-apply-section.html'
      : 'fixtures/oracle/hjf-after-submit.html',
  };
}

/** jr6 O3: the address block's order, hjf-apply-section.html's geo-hierarchy rows (addressBlockOf): the Country redraws
 *  the block, Oracle Maps' Address Line 1 fills ZIP Code, City, State and County from the street it is given. So
 *  Address Line 1 waits on the Country, and ZIP Code, City, State and County on Address Line 1, or on the Country
 *  where the block shows no street search (Jobright 1.25.2's prefillCountryBeforeRules writes the Country first and
 *  waits for its dependents; its resolveOracleAddressDependentRules waits after the street's pick and fills only what
 *  Oracle left empty). Null for the Country and for any control outside an address block. */
function dependsOn(control: Element): Element | null {
  if (control.localName !== 'input' || !control.matches(CX_SELECT)) return null;
  const block = addressBlockOf(control);
  const name = (control as HTMLInputElement).name;
  if (block === null || name === 'country') return null;
  const country = addressPart(block, 'country');
  if (name === 'addressLine1') return country;
  return addressPart(block, 'addressLine1') ?? country;
}

// ── jr6 oracle-new-2, O7: the Work and Education timeline's open editor ────────────────────────────────────────────

/** jr6 oracle-new-2: the timeline's inline editor, hjf-after-submit.html's <timeline-form-inline><div
 *  class="standard-apply-flow-timeline-form"><div class="timeline-form-content"><timeline-form-builder
 *  class="timeline-form-dialog__content"> holding one entry's rows (Degree, Major, School, Start Date and End Date as
 *  Month and Year parts, Country, City, Average Grade), its footer's Cancel and Save beside it (button.cancel-btn,
 *  button.save-btn): drawn in place of the timeline's tiles while an entry is opened (the invalid one, after Oracle
 *  refused the Submit) or added. The tiles themselves hold no field (hjf-apply-section.html). */
const TIMELINE_EDITOR = 'timeline-form-inline timeline-form-builder.timeline-form-dialog__content';

// ── jr7 ORACLE-7 (FIX7PLAN §6.10 item 3, jr7-O4): the tile layout's inline editor ──
/** jr7-O4: the inline editor of Oracle's newer tile layout (snapshot7 oraclecloud1: the Education editor of
 *  fixtures/oracle/jr7-oraclecloud1-section-filled.html, the Experience editor of -section-editor-a.html): in a <div
 *  class="apply-flow-block apply-flow-block--tile-profile-items">, its list's <div class="standard-apply-flow-profile-item">
 *  holds the entries' tiles (<article class="apply-flow-profile-item-tile ...">, one marked
 *  apply-flow-profile-item-tile--active while it is opened), the block's Add (button.apply-flow-profile-item-tile__new-tile)
 *  and, while an entry is opened or added, <div class="profile-item-content"><div class="profile-item-content--form">
 *  <form-builder> holding the entry's rows, beside its footer's Cancel and Save (div.profile-item-footer:
 *  button.cancel-btn, button.save-btn[data-qa=profileItemInlineSaveButton], both .app-dialog__footer-button, so never
 *  pressed). The Skills block (apply-flow-block--skill, -section-editor-b.html) draws the same editor for one skill: it
 *  is no repeatable kind (core/types/run.ts REPEATABLE_KINDS), so it is not read here, and its rows are the person's
 *  (owner question Q7-11). Jobright 1.25.2's newer-layout helpers find the editor by .profile-item-content >
 *  .profile-item-content--form in .standard-apply-flow-profile-item, and its footer's save-btn and cancel-btn (helper-app
 *  L121145-121191), read as its behaviour. */
const TILE_EDITOR = '.apply-flow-block--tile-profile-items .standard-apply-flow-profile-item > .profile-item-content'
  + ' > .profile-item-content--form';
/** jr7-O4: every profile item's open inline editor, the Skills block's included (its invalid rows are errors too). */
const ITEM_EDITOR = '.standard-apply-flow-profile-item > .profile-item-content > .profile-item-content--form';
/** The editors a repeatable block is read from: the timeline's (jr6) and the tile layout's (jr7-O4). */
const EDITORS = `${TIMELINE_EDITOR}, ${TILE_EDITOR}`;
// ── end jr7 ORACLE-7 ──

/** The words of an editor's row labels (label.input-row__label in form-element-label), in lower case. */
function rowLabelsOf(editor: Element): Set<string> {
  return new Set(Array.from(editor.querySelectorAll('form-element-label > label.input-row__label')).map(wordsOf));
}

/** The control of the editor's row whose label reads one of `words` (lower case), or null. */
function rowControl(editor: Element, words: readonly string[]): HTMLInputElement | null {
  const label = Array.from(editor.querySelectorAll<HTMLLabelElement>('form-element-label > label.input-row__label'))
    .find((each) => words.includes(wordsOf(each)));
  const row = label?.closest('.input-row') ?? null;
  return row?.querySelector<HTMLInputElement>('input.cx-select-input, input.input-row__control') ?? null;
}

/** An editor's entry kind, told apart by its fields as Jobright 1.25.2's rules.addAndGetEduRules and addAndGetWorkRules
 *  read them: School and Degree (hjf-after-submit.html, whose boxes are named educationalEstablishment and
 *  contentItemId) make an education's; Employer Name and Job Title an experience's (no snapshot shows that editor);
 *  anything else none.
 *  jr7-O4 (the tile layout, as its verifier corrected the fix): its education editor (jr7-oraclecloud1-section-filled)
 *  names only its Major and its <input name="educationalEstablishment"> ("Education Institution"), its Degree a pill
 *  group with no box: so an Education Institution box or row, beside a Degree row, makes an education's (Jobright
 *  1.25.2's rules read educationalEstablishment by its name); its experience editor (-section-editor-a) names its boxes
 *  employerName and jobTitle, which make an experience's as the labels do. */
function editorKind(editor: Element): 'education' | 'experience' | null {
  const labels = rowLabelsOf(editor);
  const named = (name: string) => editor.querySelector(`input.cx-select-input[name="${name}"]`) !== null;
  const boxNamed = (name: string) => editor.querySelector(`input[name="${name}"], textarea[name="${name}"]`) !== null;
  if ((labels.has('school') && labels.has('degree')) || (named('educationalEstablishment') && named('contentItemId'))) {
    return 'education';
  }
  // ── jr7 ORACLE-7 (jr7-O4) ──
  if ((named('educationalEstablishment') || labels.has('education institution')) && labels.has('degree')) return 'education';
  // ── end jr7 ORACLE-7 ──
  if ((labels.has('employer name') || labels.has('employer')) && (labels.has('job title') || labels.has('title'))) {
    return 'experience';
  }
  return boxNamed('employerName') && boxNamed('jobTitle') ? 'experience' : null; // jr7 ORACLE-7 (jr7-O4)
}

/** jr6 oracle-new-2, O7: the editors of `kind` a person sees in the root, in page order (jr7-O4: the tile layout's
 *  too). */
function openEditors(root: Element, kind: 'education' | 'experience'): Element[] {
  const cache = newScanCache();
  return Array.from(root.querySelectorAll(EDITORS))
    .filter((editor) => isUserVisible(editor, cache) && editorKind(editor) === kind);
}

/** jr6 oracle-new-2, O7: the timeline's open editor as a repeatable block of its kind (so its Start Date, End Date,
 *  City and Country are the entry's, never the person's own, and the planner gives it an entry by fingerprint), only
 *  while one shows: a section with no editor open declares nothing, so no entry is ever counted missing beside the
 *  tiles. Its Add buttons (#timeline-add-education-button, #timeline-add-experience-button) stay never pressed until
 *  the owner answers question 1 (addButton null), and so does its Save (a door of its own, O6: deferred). */
function repeatables(root: Element): ReturnType<NonNullable<Adapter['repeatables']>> {
  return (['education', 'experience'] as const).flatMap((kind) => (openEditors(root, kind).length === 0 ? []
    : [{ kind, blocks: () => openEditors(root, kind), addButton: () => null }]));
}

/** The words a box shows, white space collapsed (a cx-select shows its chosen option's label in its box). */
const shownIn = (box: HTMLInputElement | null) => (box?.value ?? '').replace(/\s+/g, ' ').trim();

/** jr6 oracle-new-2, O7: the entry an open editor holds, by the words the planner fingerprints it by (core/steps/blocks.ts
 *  SHOWN_CATEGORIES): an education's School; an experience's Employer Name and Job Title. So an entry Oracle imported
 *  is matched to the profile's entry by its words, never by its place, and one no profile entry matches is kept as
 *  it is. Degree is no category the plan request carries (the planner reads it from the editor's own field). */
function readEntries(kind: string, blocks: Element[]): PrefillEntryView[] {
  return blocks.flatMap((block, index): PrefillEntryView[] => {
    if (editorKind(block) !== kind) return [];
    const values: PrefillEntryView['values'][number][] = [];
    if (kind === 'education') {
      // jr7-O4: the tile layout's "Education Institution" is the same box, named educationalEstablishment.
      const school = shownIn(block.querySelector<HTMLInputElement>('input.cx-select-input[name="educationalEstablishment"]')
        ?? rowControl(block, ['school', 'education institution']));
      if (school !== '') values.push({ category: 'education.school', text: school });
    } else if (kind === 'experience') {
      // jr7-O4: the tile layout's boxes by their names first (employerName, jobTitle), else by their rows' labels.
      const company = shownIn(block.querySelector<HTMLInputElement>('input[name="employerName"]')
        ?? rowControl(block, ['employer name', 'employer']));
      const title = shownIn(block.querySelector<HTMLInputElement>('input[name="jobTitle"]')
        ?? rowControl(block, ['job title', 'title']));
      if (company !== '') values.push({ category: 'experience.company', text: company });
      if (title !== '') values.push({ category: 'experience.title', text: title });
    }
    return values.length === 0 ? [] : [{ block: index, values }];
  });
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

/** jr6 O8: a section's Next in a flow of several sections (.../apply/section/<n>), which no snapshot shows: the
 *  pagination's own button, as the one-page flow draws its Submit (<div class="apply-flow-pagination"> <div
 *  class="apply-flow-pagination__buttons"> <button type="button" class="button apply-flow-pagination__button ...">)
 *  and the gate draws its Next (jr6-caesars-email-gate.html and elhr-email-gate.html: <button type="submit" class="button
 *  apply-flow-pagination__button theme-color-1 focused-tooltip" title="Next" aria-label="Next">Next</button>), whose
 *  title, aria-label or words read "Next" (Jobright 1.25.2's NextPageButton presses the pagination button that reads
 *  so); never the Submit (apply-flow-pagination__submit-button). Null on the gate and the code page (theirs is Sign-in
 *  Auto's, under every Sign-in rule), on an unproven employer domain, and where none or several show. */
function nextButton(root: Element): HTMLElement | null {
  const doc = root.ownerDocument;
  if (unprovenOwnDomain(doc) || authState(doc) !== null) return null;
  const cache = newScanCache();
  const next = Array.from(doc.querySelectorAll<HTMLElement>('.apply-flow-pagination button.apply-flow-pagination__button'))
    .filter((button) => !button.classList.contains('apply-flow-pagination__submit-button')
      && namesOf(button).includes('next') && isUserVisible(button, cache));
  return next.length === 1 ? next[0]! : null;
}

/** A flow that shows its Submit is on its final step; the gate, the code page and the posting say nothing. jr6 O8: a
 *  section of a flow of several (.../apply/section/<n>) that shows its Next and no Submit is not the last. */
function isFinalStep(doc: Document): 'final' | 'not-final' | 'unknown' {
  if (flowOf(doc) === null) return 'unknown';
  if (submitButton(doc.documentElement) !== null) return 'final';
  const address = addressOf(doc);
  return address !== null && oracleApplySection(address) !== null && nextButton(doc.documentElement) !== null
    ? 'not-final' : 'unknown';
}

/** jr6 O8: the step a page of the flow shows (Jobright 1.25.2's getOracleCloudStepState reads the section's number from
 *  the address and its title from the progress step marked aria-current): its address's section/<n> (or the gate's
 *  email); its progress, the words of the step the flow marks aria-current="step" or "page"; its heading, the first
 *  block title a person sees (hjf-apply-section.html's <h2 class="apply-flow-block__title">Import your profile</h2>);
 *  its anchors, the kinds of the blocks it shows (apply-flow-block--<kind>: personal-information-basic,
 *  disqualification-questions, ...) and the account page it is (the gate and the code page share their address). Page
 *  text and markup only, never a value. */
function stepSignature(doc: Document): { heading?: string; progress?: string; urlPart?: string; anchors: string[] } {
  const flow = flowOf(doc);
  const address = addressOf(doc);
  const section = address === null ? null : oracleApplySection(address);
  const urlPart = section !== null ? `section/${section}` : address !== null && isOracleEmailGate(address) ? 'email' : '';
  // jr7 ORACLE-7 (jr7-O1): with the form hidden and an account state shown (the code dialog beside the hidden form,
  // after the Submit's checklist), the step is its address's section and that state, so the code's dialog changes the
  // signature and the resting run looks again (its pause, email-code). A page that shows neither the flow nor a state
  // (the checklist, the posting, my-profile) reads as before.
  if (flow === null) {
    const state = authState(doc);
    return state === null ? { anchors: [] } : { urlPart, anchors: [state] };
  }
  const cache = newScanCache();
  // The words a person reads, else (a part the colour rules cannot read over the cover image, as the navigation train's
  // items are on hjf-apply-section.html) the shown element's own words: a step's identity, hashed, never a label.
  const read = (el: Element | null) => (el === null ? ''
    : visibleText(el, { singleLine: true, cache }) || (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200));
  const progress = shown(Array.from(doc.querySelectorAll('.apply-flow [aria-current="step"], .apply-flow [aria-current="page"]')),
    cache);
  const heading = shown(Array.from(flow.querySelectorAll('.apply-flow-block__title')), cache);
  const kinds = Array.from(flow.querySelectorAll('.apply-flow-block')).filter((block) => isUserVisible(block, cache))
    .flatMap((block) => Array.from(block.classList).filter((name) => name.startsWith('apply-flow-block--')));
  const state = authState(doc);
  return { heading: read(heading), progress: read(progress), urlPart,
    anchors: [...new Set(kinds)].concat(state === null ? [] : [state]) };
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
  return [...(genericAdapter.errors?.(root) ?? []), ...marks, ...notified, ...editorRowErrors(root, cache)];
}

// ── jr7 ORACLE-7 (FIX7PLAN §6.10 item 3, jr7-O4) ──
/** jr7-O4: an open profile item editor's rows the page marks invalid, each by its message: the tile layout's <div
 *  class="input-row ... input-row--invalid"> holding <p class="input-row__validation" ...> (the Education editor's Degree
 *  pills of jr7-oraclecloud1-section-filled.html, "The Degree field is required.", with no aria-invalid anywhere; the
 *  Skill box of -section-editor-b.html, whose input says aria-invalid="true" and is the standard rule's already, so it
 *  is not counted twice), each while a person can see its message. */
function editorRowErrors(root: Element, cache: ScanCache): Array<{ el: Element }> {
  return Array.from(root.querySelectorAll(`${ITEM_EDITOR} .input-row.input-row--invalid`)).flatMap((row) => {
    if (row.querySelector('[aria-invalid="true" i]') !== null) return [];
    const message = Array.from(row.querySelectorAll('.input-row__validation'))
      .find((el) => wordsOf(el) !== '' && isUserVisible(el, cache));
    return message === undefined || !isUserVisible(row, cache) ? [] : [{ el: message }];
  });
}
// ── end jr7 ORACLE-7 ──

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
  'button.quick-apply-flow-verify-method__button',
  // ── jr7 ORACLE-7 (jr7-O1) ── jr7-oraclecloud1-submit-code.html: the code dialog's <button type="submit"
  // class="apply-flow-dialog__button apply-flow-dialog__button--primary">Verify</button> in its form.pin-code-verification
  // (the code is the person's; its "Send New Code" is pressed by no one either, above).
  `${SUBMIT_CODE} button[type="submit"]`,
  // ── jr7 ORACLE-7 (jr7-O4) ── the tile layout's <button class="apply-flow-profile-item-tile__edit-item-icon" title="Edit">
  // and <button class="apply-flow-profile-item-tile__delete-icon" title="Delete"> on each entry's tile (Delete removes
  // the person's entry; Jobright 1.25.2's operations.cleanEduAndExp presses it, owner question 1 keeps it the person's).
  'button.apply-flow-profile-item-tile__edit-item-icon', 'button.apply-flow-profile-item-tile__delete-icon'];

// ── jr7 ORACLE-7 (FIX7PLAN §6.10 item 2, jr7-O2): the page after submitting ──
/** jr7-O2: the "My Applications" tiles' titles at my-profile (snapshot7 oraclecloud1, the page after its Submit and the
 *  emailed code: fixtures/oracle/jr7-oraclecloud1-confirmation.html): <cs-applications><div class="cs-applications">
 *  <div class="cs-applications__container cs-applications__container-active"> ... <li class="cs-application-tile"> ... <a
 *  class="cs-job-info__title cs-button--link" ... href="https://<host>/hcmUI/CandidateExperience/en/sites/<SITE>/job/<id>">
 *  (the job's title) ... <span title="..." class="cs-job-status__value ...">(its status)</span>, beside the
 *  -drafts and -resolved containers (empty there). */
const ACTIVE_TILE_TITLE = '.cs-applications__container-active li.cs-application-tile a.cs-job-info__title[href]';

/** jr7-O2: the application key a tile's title link names (as adapters/index.ts applicationOf keys it: the platform's
 *  parser, the canonical application URL hashed), on the page's own origin and site (`site`); null for any other
 *  link. */
function tileApplicationKey(link: Element, page: URL, site: string): string | null {
  let url: URL;
  try {
    url = new URL(link.getAttribute('href') ?? '', page);
  } catch {
    return null;
  }
  const parsed = url.origin === page.origin && platformOfUrl(url.href) === 'oracle' ? parseOracleUrl(url) : null;
  return parsed === null || parsed.board !== site ? null : applicationKey('oracle', parsed.applicationUrl);
}

/** jr7-O2 (FIX7PLAN §3.1 successSigns, as its verifier corrected the fix): the drawn sign that the application armed
 *  under `armedKey` was sent: at the site's my-profile alone (url.ts oracleMyProfileSite), the active container's tile
 *  whose title link names that very application (tileApplicationKey) and whose status a person can see. Never a tile
 *  under the -drafts or -resolved containers, never another application's tile (a person's other applications are
 *  listed there too), nothing on an employer's own domain whose page shows none of the app's shell
 *  (dom/page-signals.ts oracleShellShown). Jobright 1.25.2 reads no drawn sign there (its attribution of Oracle's network
 *  answers takes <site>/my-profile as the application's page: isOraclecloudSubmissionConfirmationUrl); the tile is
 *  this capture's. The words of the tile are never read, only that they show. */
function successSigns(doc: Document, armedKey: string): Element[] {
  const address = addressOf(doc);
  const site = address === null ? null : oracleMyProfileSite(address);
  if (address === null || site === null) return [];
  if (oracleOwnDomain(address.hostname.toLowerCase(), address.pathname) && !oracleShellShown(doc)) return [];
  const cache = newScanCache();
  return Array.from(doc.querySelectorAll(ACTIVE_TILE_TITLE)).flatMap((link) => {
    const tile = link.closest('li.cs-application-tile');
    if (tile === null || tile.closest('.cs-applications__container-drafts, .cs-applications__container-resolved') !== null
      || !isUserVisible(link, cache) || tileApplicationKey(link, address, site) !== armedKey) return [];
    const status = Array.from(tile.querySelectorAll('.cs-job-status__value'))
      .some((el) => wordsOf(el) !== '' && isUserVisible(el, cache));
    return status ? [tile] : [];
  });
}
// ── end jr7 ORACLE-7 ──

// ── jr7 ORACLE-7 (FIX7PLAN §6.10 item 4, jr7-O7): a required block with nothing to fill ──
/** jr7-O7: what makes a block's list hold something already, or something a run can fill: an entry's tile, an open
 *  editor (the tile layout's or the timeline's), or any control (an upload's hidden input included). */
const BLOCK_ENTRY = 'article.apply-flow-profile-item-tile';
const BLOCK_CONTROL = 'input:not([type="hidden" i]), select, textarea, [contenteditable]:not([contenteditable="false" i]), '
  + '[role="combobox"], [role="textbox"], [role="radio"], [role="radiogroup"], [role="checkbox"], [role="listbox"], '
  + '[role="switch"], [role="spinbutton"], [role="slider"]';

/** jr7-O7 (FIX7PLAN §3.1 requiredBlocksLeft; the Oracle verifier's missed finding): the form's required blocks that
 *  hold nothing yet and nothing to fill: each <div class="apply-flow-block ..."> a person sees whose own title is marked
 *  required (its header's <h3 class="apply-flow-block__title apply-flow-block__title--required"> shown) and whose <div
 *  class="apply-flow-block__form-list"> shows no entry's tile and no open editor, and holds no control. On
 *  jr7-oraclecloud1-section-blank.html that is the Skills block (apply-flow-block--skill: "Skills" with its star, its
 *  list region "Skills Required" holding only "Add More Skills", never pressed), which Oracle refuses a Submit without:
 *  so Submit Auto holds and the review shows the block (ENGINE-7 E1, orchestrator.ts requiredBlocksNow, reading the
 *  block's title). Adding skills waits for owner question Q7-11 (Jobright 1.25.2's operations.fillSkills adds the
 *  profile's). The block element itself, never its list region. */
function requiredBlocksLeft(root: Element): Element[] {
  const cache = newScanCache();
  return Array.from(root.querySelectorAll('.apply-flow-block')).filter((block) => {
    if (!isUserVisible(block, cache)) return false;
    const required = Array.from(block.querySelectorAll(
      ':scope > .apply-flow-block__header .apply-flow-block__title.apply-flow-block__title--required'))
      .some((title) => isUserVisible(title, cache));
    const list = block.querySelector(':scope > .apply-flow-block__form-list');
    if (!required || list === null) return false;
    const shows = (css: string) => Array.from(list.querySelectorAll(css)).some((el) => isUserVisible(el, cache));
    return !shows(BLOCK_ENTRY) && !shows(`${ITEM_EDITOR}, ${TIMELINE_EDITOR}`)
      && list.querySelector(BLOCK_CONTROL) === null;
  });
}
// ── end jr7 ORACLE-7 ──

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
  widgetFor,
  dependsOn,
  repeatables,
  prefill: { readEntries },
  nextButton,
  stepSignature,
  uploadState,
  // ── jr7 ORACLE-7 (FIX7PLAN §6.10; module header) ──
  confirmationAfter: oracleConfirmationAfter,
  successSigns,
  requiredBlocksLeft,
};
