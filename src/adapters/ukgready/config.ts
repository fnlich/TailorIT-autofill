/*
 * UKG Ready's (Kronos Workforce Ready's) configured adapter (jr7 FIX7PLAN §6.14; the audit SP\jr7\audit\ukgready.md §6
 * with its verifier's corrections). Written from the owner's snapshot7 [secure7.saashr.com]: one application, posting
 * to confirmation, converted as fixtures/ukgready/jr7-saashr-*.html (21 cases, named below). Jobright has no UKG Ready
 * support at all (the audit §4: no host, target or filler), so every rule here is read from the captures alone.
 *
 * The page is one React app (div#_app) at one address per document; its parts change in place:
 * - The posting (jr7-saashr-posting), its choice "Apply for Job" (-choice: Use my resume / Type it in myself / Log in)
 *   and its "Type it in myself" start form (-start-filled: First, Last, Personal Email; Back, Continue) are drawn in
 *   place at the posting's address. The agent's entry presses Apply, then "Type it in myself" (entryPresses 2; UKGR-11);
 *   the start form is the first step (its own root, its Continue the Next), drawn at the posting's address
 *   (formAtPosting, as Workday's /apply), and its Continue opens the applicant session in a new document.
 * - The session (every other case) shows a step body (main .c-profile-view-layout-content: its heading
 *   .c-profile-tabs-header__heading, the progress .progress-bar-component .amount "n/9") and header actions (Back,
 *   Continue, "Sign & submit application", "Go to my portal"). Its dialogs are portaled under div#_popup_portal, outside
 *   the step: the editors (#react_popup: Personal Information, Address, a work, education or reference entry; footer
 *   Close and Save), the consent (#electronicSignaturePopup: "Consent/Acknowledgement", Full Name, Cancel and I Agree)
 *   and the alerts (#react_modal: "Upload Complete", "Almost There!"; #PROGRESS_POPUP_ID: "Saving"). Each alert's
 *   buttons are drawn twice, the second copy in .c-modal-button-group-measurement (UKGR-V4): the visible one is read.
 * - One root for the session (UKGR-V1): the app container, which holds the step body and the portaled dialogs, so a
 *   section's Add and its editor sit in one root; the header and its menus, the feedback button, the Security Question
 *   (never filled), the review's read-only summary, the SSN box (UKGR-14) and the reference editor (UKGR-13) are
 *   excluded. The confirmation (jr7-saashr-confirmation: "We got it!") has none.
 * - Steps (UKGR-8): Next is the header's Continue, by its data-tracking-id and its words (the session's and the start
 *   form's); "Almost There!"'s "Review & Submit Application" is the Next declared through stepSubmitNext (its words say
 *   submit; the later step is the progress while it reads n<m); a Contact editor's Save is its Next; Submit is the
 *   header's "Sign & submit application", then, while the consent shows, its "I Agree" (each by its data-tracking-id and
 *   its words). "I Agree" is never a Next. Back, Close, the consent's Cancel and every other control below are never
 *   pressed. The data-tracking-ids are one tenant's (the audit §2): with other ones a button is not found, so nothing is
 *   pressed.
 * - Work Experience and Education (UKGR-9, V1): repeatables whose blocks are the saved entries (.c-widget-fat-item:
 *   Company name over the job title; the school's name) and the open editor of that kind; Add "Add work" / "Add
 *   education"; the editor's Save. Contact's single editors are opened by the editor-opener door (ENGINE-7 E2): the
 *   Address while its summary says "Missing Information", Personal Information while its summary shows nothing but the
 *   email (no phone).
 * - Uploads (UKGR-10): the résumé's and the cover letter's hidden input behind "Choose"; the résumé's done sign is the
 *   uploaded file's row. "Upload Complete" is answered Cancel (D-9: never Populate, no site-parsed entries) by the
 *   upload-prompt door (ENGINE-7 E2); "Saving" is busy.
 * - Labels (UKGR-15, 16, 18; FIX7PLAN §3.3): a phone's "Code" select is "<phone label> country code", the "Primary"
 *   radios' group "Primary phone", the e-signature "Full Name to confirm" (its prompt its help text), an upload its
 *   section's title; the editors' fields sit in a section named by the step's heading, of the repeatable's kind.
 * Owner-gated, not built (Q7-1): the City and State comboboxes (UKGR-17: no capture shows an open list) are the
 * person's; a returning applicant's "Log in" (not captured) is the person's.
 * Nothing here reads, logs or sends a value: page markup, its own words and counts only.
 */
import { newScanCache, type ScanCache } from '../../dom/scan-cache';
import { TEXT_CAP_LABEL } from '../../dom/thresholds';
import { isUserVisible } from '../../dom/visibility';
import { configuredHooks } from '../configured';
import type { AtsConfig } from '../configured/types';
import type { Adapter, PrefillEntryView, UploadPrompt } from '../types';
import { parseUkgReadyUrl } from './url';

/** The fixtures the config was read from (fixtures/ukgready/<case>.html). */
export const UKGREADY_CASES = ['jr7-saashr-posting', 'jr7-saashr-choice', 'jr7-saashr-start-filled', 'jr7-saashr-contact',
  'jr7-saashr-contact-address-filled', 'jr7-saashr-documents', 'jr7-saashr-documents-populate',
  'jr7-saashr-documents-after', 'jr7-saashr-work-history', 'jr7-saashr-work-entry-filled',
  'jr7-saashr-work-entry2-filled', 'jr7-saashr-education', 'jr7-saashr-education-entry-filled',
  'jr7-saashr-additional-info', 'jr7-saashr-references', 'jr7-saashr-reference-entry', 'jr7-saashr-questionnaire',
  'jr7-saashr-questionnaire-filled', 'jr7-saashr-review', 'jr7-saashr-review-sign', 'jr7-saashr-confirmation'] as const;

// ── The page's parts (module header) ──
/** Every session case: <div id="_app" class="app ...">, around the layout and div#_popup_portal. */
const APP = 'div#_app';
/** Every session case: <main id="_main"> ... <div class="c-profile-view-layout-content">, the step's body. */
const STEP_BODY = 'main#_main .c-profile-view-layout-content';
/** jr7-saashr-start-filled: <div class="c-login-layout-content"><div class="c-type-it-myself-container"><form
 *  class="react-form ...">, First, Last and Personal Email. */
const START_FORM = '.c-login-layout-content .c-type-it-myself-container form.react-form';
/** jr7-saashr-choice: <div class="c-full-apply-resume-view">, "Hello, let's start your application". */
const CHOICE = '.c-full-apply-resume-view';
/** jr7-saashr-contact (and every editor case): <div id="react_popup" class="single-popup-wrapper visible rendered"> ...
 *  <div class="c-popup m-width-..." role="dialog">. */
const EDITOR = '#react_popup.single-popup-wrapper.visible div.c-popup[role="dialog" i]';
/** jr7-saashr-review-sign: <div id="electronicSignaturePopup" class="single-popup-wrapper visible rendered"> ... <div
 *  class="c-popup m-width-small" role="dialog"> holding <input id="signature" name="fullEmployeeName">. */
const CONSENT = '#electronicSignaturePopup.single-popup-wrapper.visible div.c-popup[role="dialog" i]';
/** jr7-saashr-documents-populate, -questionnaire-filled: <div id="react_modal" class="single-popup-wrapper modal-view
 *  visible"> ... <div role="alertdialog" aria-modal="true" class="msg">, its .title "Upload Complete" or "Almost
 *  There!". */
const ALERT = '#react_modal.single-popup-wrapper.visible div.msg[role="alertdialog" i]';
/** jr7-saashr-documents-after: <div id="PROGRESS_POPUP_ID" class="single-popup-wrapper modal-view visible"> ... <div
 *  role="alertdialog" class="msg"> titled "Saving", an endless progress bar. */
const SAVING = '#PROGRESS_POPUP_ID.single-popup-wrapper.visible div.msg[role="alertdialog" i]';
/** Every session case and the start form: <div class="l-page-layout-header__actions"> <button class="c-button m-rounded
 *  m-primary" data-tracking-id="...">. */
const HEADER_ACTION = '.l-page-layout-header__actions button.c-button';
/** jr7-saashr-confirmation: <div class="c-success-screen"> in the step body. */
const SUCCESS_SCREEN = '.c-success-screen';
/** The editors' footer buttons (every editor case): <div class="c-popup__footer"> ... Close, Save. */
const FOOTER_BUTTON = '.c-popup__footer button.c-button';
/** A saved entry's summary (jr7-saashr-contact, -work-history, -education, -references): <div class="c-widget-fat-item">. */
const SAVED_ENTRY = '.c-widget-fat-item';
/** A step's or a document section's heading (every step case): <div class="... c-profile-tabs-header__heading">. */
const HEADING = '.c-profile-tabs-header__heading';
/** The progress (every session case): <div class="progress-bar-component m-small"> ... <span class="amount">3/9</span>. */
const PROGRESS = '.progress-bar-component .amount';

// ── The buttons' data-tracking-ids, the same on every step of the session (the audit §2's table) ──
/** The header's Continue: the session's (jr7-saashr-contact ... -questionnaire) and the start form's (-start-filled). */
const CONTINUE_IDS = ['4e4551c6-96b8-432e-ab2b-d76869a117f0', 'd7c52fbf-94be-4da2-81eb-3f75f5ec4e74'] as const;
/** The review's "Sign & submit application" (jr7-saashr-review). */
const SIGN_ID = '085b9254-5754-4d61-931e-227e97b6d20a';
/** The consent's "I Agree" (jr7-saashr-review-sign). */
const AGREE_ID = 'c2529c96-6f5d-46ab-be30-32f5099df168';

/** Which editor the open dialog is, by the step that shows it (UKGR-V1): Contact's single editors, a work or an
 *  education entry, a reference (excluded: UKGR-13), or another. */
type EditorKind = 'contact' | 'experience' | 'education' | 'references' | 'other';

/** The step body's widget that names each editor's kind (jr7-saashr-contact, -work-history, -education, -references). */
const EDITOR_KINDS: ReadonlyArray<readonly [string, EditorKind]> = [
  ['.c-contact-info-widget-container, .c-address-widget-container', 'contact'],
  ['.c-work-experience-widget-container', 'experience'],
  ['.c-education-widget-container', 'education'],
  ['.c-references-widget-container', 'references'],
];

/** The repeatable sections (UKGR-9): each its widget in the step body and its Add's words (jr7-saashr-work-history:
 *  <button ... data-tracking-id="ee8da2ea-..."><span class="c-icon-button__label">Add work</span></button>;
 *  -education: <button title="Add education" ...>Add education</button>). */
const REPEATABLE_SECTIONS = [
  { kind: 'experience', section: '.c-work-experience-widget-container', add: /^add work$/i },
  { kind: 'education', section: '.c-education-widget-container', add: /^add education$/i },
] as const;

/** Every element matching `css` in `scope`, or none where the selector does not parse. */
function all<T extends Element = HTMLElement>(scope: ParentNode, css: string): T[] {
  try {
    return Array.from(scope.querySelectorAll<T>(css));
  } catch {
    return [];
  }
}

/** The elements matching `css` in `scope` that a person can see. */
function shownAll<T extends Element = HTMLElement>(scope: ParentNode, css: string, cache: ScanCache): T[] {
  return all<T>(scope, css).filter((el) => isUserVisible(el, cache));
}

/** The first element matching `css` in `scope` that a person can see, or null. */
function firstShown<T extends Element = HTMLElement>(scope: ParentNode, css: string, cache: ScanCache): T | null {
  return all<T>(scope, css).find((el) => isUserVisible(el, cache)) ?? null;
}

/** An element's words on one line (page text, the site's own button and title words). */
function words(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** The shown step body, or null (the posting, the choice, the start form). */
const stepBodyOf = (doc: Document, cache: ScanCache) => firstShown<Element>(doc, STEP_BODY, cache);

/** The open editor dialog, or null. */
const editorOf = (doc: Document, cache: ScanCache) => firstShown<Element>(doc, EDITOR, cache);

/** The open consent dialog that asks for the e-signature, or null. */
function consentOf(doc: Document, cache: ScanCache): Element | null {
  return shownAll<Element>(doc, CONSENT, cache).find((dialog) => dialog.querySelector('input#signature') !== null) ?? null;
}

/** The open alert and its title's words, or null. */
function alertOf(doc: Document, cache: ScanCache): { el: Element; title: string } | null {
  const el = firstShown<Element>(doc, ALERT, cache);
  return el === null ? null : { el, title: words(el.querySelector('.modal-head .title')) };
}

/** The alert's own buttons a person can see: never the measuring copy (UKGR-V4). */
function alertButtons(alert: Element, cache: ScanCache): HTMLElement[] {
  return shownAll(alert, 'button', cache).filter((button) => button.closest('.c-modal-button-group-measurement') === null);
}

/** "Almost There!" (jr7-saashr-questionnaire-filled) and "Upload Complete" (jr7-saashr-documents-populate). */
const ALMOST_THERE = /^almost there!?$/i;
const UPLOAD_COMPLETE = /^upload complete$/i;

/** "Almost There!"'s "Review & Submit Application": <button ... data-tracking-id="<uuid>_modal_ok_button">. */
function okButton(alert: Element, cache: ScanCache): HTMLElement | null {
  return alertButtons(alert, cache).find((button) => /_modal_ok_button$/.test(button.dataset.trackingId ?? '')) ?? null;
}

/** The kind of the open editor (see EditorKind), or null while none is open. */
function editorKindOf(doc: Document, cache: ScanCache): EditorKind | null {
  if (editorOf(doc, cache) === null) return null;
  const body = stepBodyOf(doc, cache);
  if (body === null) return 'other';
  return EDITOR_KINDS.find(([css]) => all(body, css).length > 0)?.[1] ?? 'other';
}

/** The header action a person can see with one of `ids` and these words (UKGR-8: by its id and its words). */
function headerAction(doc: Document, ids: readonly string[], text: RegExp, cache: ScanCache): HTMLElement | null {
  return shownAll(doc, HEADER_ACTION, cache).find((button) => ids.includes(button.dataset.trackingId ?? '')
    && text.test(words(button))) ?? null;
}

const continueOf = (doc: Document, cache: ScanCache) => headerAction(doc, CONTINUE_IDS, /^continue$/i, cache);
const signOf = (doc: Document, cache: ScanCache) => headerAction(doc, [SIGN_ID], /^sign & submit application$/i, cache);

/** An editor's Save (every editor case: <button class="c-button m-rounded m-primary" data-tracking-id="4cf21393-...">
 *  <span class="c-button__label">Save</span>). */
function saveOf(editor: Element, cache: ScanCache): HTMLElement | null {
  return shownAll(editor, FOOTER_BUTTON, cache).find((button) => /^save$/i.test(words(button))) ?? null;
}

/** The consent's "I Agree" (jr7-saashr-review-sign: <button class="c-button m-rounded m-primary"
 *  data-tracking-id="c2529c96-..."><span class="c-button__label">I Agree</span></button>). */
function agreeOf(consent: Element, cache: ScanCache): HTMLElement | null {
  return shownAll(consent, FOOTER_BUTTON, cache).find((button) => button.dataset.trackingId === AGREE_ID
    && /^i agree$/i.test(words(button))) ?? null;
}

/** The form root (module header): the start form while it shows; else, in the session, the app container while a step
 *  body or a dialog shows, but not on the confirmation; none on the posting and the choice. */
function rootOf(doc: Document, cache: ScanCache = newScanCache()): Element | null {
  if (firstShown(doc, CHOICE, cache) !== null) return null;
  const start = firstShown<Element>(doc, START_FORM, cache);
  if (start !== null) return start;
  const app = firstShown<Element>(doc, APP, cache);
  if (app === null) return null;
  const body = stepBodyOf(doc, cache);
  const dialog = editorOf(doc, cache) ?? consentOf(doc, cache);
  if (dialog === null && (body === null || body.querySelector(SUCCESS_SCREEN) !== null)) return null;
  return app;
}

/** Whether the shown step is the last (UKGR-8): the consent and the review's Submit are; Continue, "Almost There!" and
 *  an open editor are not; anything else (another alert while it shows, the confirmation) cannot say. */
function isFinalStep(doc: Document): 'final' | 'not-final' | 'unknown' {
  const cache = newScanCache();
  if (consentOf(doc, cache) !== null) return 'final';
  const alert = alertOf(doc, cache);
  if (alert !== null) return ALMOST_THERE.test(alert.title) && okButton(alert.el, cache) !== null ? 'not-final' : 'unknown';
  if (editorOf(doc, cache) !== null) return 'not-final';
  if (signOf(doc, cache) !== null) return 'final';
  if (continueOf(doc, cache) !== null) return 'not-final';
  return 'unknown';
}

/** Next (UKGR-8, V1): "Almost There!"'s OK; a Contact editor's Save (an entry editor's is the repeatable's, pressed
 *  after its fill: content/repeatables.ts saveBlocks); else the header's Continue. None while the consent shows. */
function nextButton(root: Element): HTMLElement | null {
  const doc = root.ownerDocument;
  const cache = newScanCache();
  if (consentOf(doc, cache) !== null) return null;
  const alert = alertOf(doc, cache);
  if (alert !== null) return ALMOST_THERE.test(alert.title) ? okButton(alert.el, cache) : null;
  const editor = editorOf(doc, cache);
  if (editor !== null) return editorKindOf(doc, cache) === 'contact' ? saveOf(editor, cache) : null;
  return continueOf(doc, cache);
}

/** Submit (UKGR-8): the consent's "I Agree" while it shows, else the review's "Sign & submit application" (its first
 *  match where none shows, so the fill never presses it). */
function submitButton(root: Element): HTMLElement | null {
  const doc = root.ownerDocument;
  const cache = newScanCache();
  const consent = consentOf(doc, cache);
  if (consent !== null) return agreeOf(consent, cache);
  return signOf(doc, cache) ?? doc.querySelector<HTMLElement>(`button[data-tracking-id="${SIGN_ID}"]`);
}

/** The step's identity (page markup, never a value): its heading and progress, which part shows, which dialog, and the
 *  saved entries and "Missing Information" marks it shows, so every editor round is a step of its own (UKGR-V1). */
function stepSignature(doc: Document): { heading?: string; progress?: string; anchors: string[] } {
  const cache = newScanCache();
  const body = stepBodyOf(doc, cache);
  const start = firstShown(doc, START_FORM, cache) !== null;
  const alert = alertOf(doc, cache);
  const dialog = consentOf(doc, cache) !== null ? 'consent'
    : alert !== null ? `alert:${ALMOST_THERE.test(alert.title) ? 'almost' : UPLOAD_COMPLETE.test(alert.title) ? 'upload' : 'other'}`
      : firstShown(doc, SAVING, cache) !== null ? 'saving'
        : editorOf(doc, cache) === null ? 'none' : `editor:${editorKindOf(doc, cache)}`;
  const progress = shownAll<Element>(doc, PROGRESS, cache).map(words).find((text) => /^\d+\s*\/\s*\d+$/.test(text)) ?? '';
  const missing = body === null ? 0
    : shownAll<Element>(body, '.c-fat-item__tag .c-tag', cache).filter((tag) => /^missing information$/i.test(words(tag))).length;
  return {
    heading: body === null ? '' : words(firstShown<Element>(body, HEADING, cache)).slice(0, TEXT_CAP_LABEL),
    progress,
    anchors: [start ? 'view:start' : body !== null ? 'view:step' : 'view:none', `dialog:${dialog}`,
      `entries:${body === null ? 0 : all(body, SAVED_ENTRY).length}`, `missing:${missing}`],
  };
}

/** "Almost There!"'s OK is a Next though its words say submit (UKGR-8): the step machine takes it while the progress, a
 *  person can see, reads n of m with n < m. */
const stepSubmitNext: NonNullable<Adapter['stepSubmitNext']> = {
  // jr7-saashr-questionnaire-filled: <button ... data-tracking-id="833d1484-..._modal_ok_button"><span
  // class="c-button__label">Review &amp; Submit Application</span></button>, in the alert and in its measuring copy.
  buttons: [`${ALERT} button[data-tracking-id$="_modal_ok_button"]`],
  laterStep(doc) {
    const cache = newScanCache();
    return shownAll<Element>(doc, PROGRESS, cache).find((amount) => {
      const read = /^(\d+)\s*\/\s*(\d+)$/.exec(words(amount));
      return read !== null && Number(read[1]) < Number(read[2]);
    }) ?? null;
  },
};

/** Work Experience's and Education's entries (UKGR-9, V1): the saved summaries in the section and the open editor of
 *  that kind, Add, the editor's Save, and the work entry's "Present". */
function repeatables(root: Element): ReturnType<NonNullable<Adapter['repeatables']>> {
  const doc = root.ownerDocument;
  const body = stepBodyOf(doc, newScanCache());
  if (body === null || !root.contains(body)) return [];
  return REPEATABLE_SECTIONS.flatMap(({ kind, section, add }) => {
    const widget = body.querySelector(section);
    if (widget === null) return [];
    const blocks = () => {
      const cache = newScanCache();
      const editor = editorOf(doc, cache);
      const open = editor !== null && root.contains(editor) && editorKindOf(doc, cache) === kind ? [editor] : [];
      return [...all<Element>(widget, SAVED_ENTRY), ...open];
    };
    return [{
      kind,
      blocks,
      addButton: () => shownAll(widget, 'button', newScanCache())
        .find((button) => add.test(words(button)) && button.closest(SAVED_ENTRY) === null) ?? null,
      save: (block: Element) => (block.matches('div.c-popup[role="dialog" i]') ? saveOf(block, newScanCache()) : null),
      // jr7-saashr-work-entry-filled: <input class="c-base-checkbox__input" aria-label="Present" type="checkbox"
      // name="Present">.
      ...(kind === 'experience'
        ? { currentlyHere: (block: Element) => block.querySelector<HTMLInputElement>('input[type="checkbox" i][name="Present"]') }
        : {}),
    }];
  });
}

/** A saved entry's words (Adapter.prefill.readEntries), so the planner finds the profile entry it holds by its
 *  fingerprint: a work entry's title is its Company name and its first metadata item its job title; an education
 *  entry's title is its school (measured on the original captures, booleans only: the summaries against the open
 *  editors' fields). */
function readEntries(kind: string, blocks: Element[]): PrefillEntryView[] {
  const cap = (text: string) => text.slice(0, TEXT_CAP_LABEL);
  return blocks.flatMap((block, index) => {
    if (!block.matches(SAVED_ENTRY)) return [];
    const title = cap(words(block.querySelector('.c-fat-item__title')));
    const first = cap(words(block.querySelector('.c-metadata__text')));
    const values: PrefillEntryView['values'][number][] = [];
    if (kind === 'experience') {
      if (title !== '') values.push({ category: 'experience.company', text: title });
      if (first !== '') values.push({ category: 'experience.title', text: first });
    } else if (kind === 'education' && title !== '') {
      values.push({ category: 'education.school', text: title });
    }
    return values.length === 0 ? [] : [{ block: index, values }];
  });
}

/** Contact's single editors to open (UKGR-9; ENGINE-7 E2's door presses each at most once per document): the Address
 *  while it says "Missing Information", Personal Information while its summary shows nothing but the email. None while a
 *  dialog is open. */
function editorOpener(root: Element): HTMLElement[] {
  const doc = root.ownerDocument;
  const cache = newScanCache();
  if (editorOf(doc, cache) !== null || consentOf(doc, cache) !== null || alertOf(doc, cache) !== null) return [];
  const body = stepBodyOf(doc, cache);
  if (body === null || !root.contains(body)) return [];
  const editOf = (entry: Element | null) => (entry === null ? null
    : firstShown(entry, '.c-fat-item__actions button[aria-label="Edit" i]', cache));
  // jr7-saashr-contact: <div class="c-address-widget-container"><div class="c-widget-fat-item"> ... <h3
  // class="c-fat-item__title">Add Address</h3><div class="c-fat-item__tag"><div class="... c-tag">Missing
  // Information</div></div> ... <button aria-label="Edit" ...>.
  const address = body.querySelector(`.c-address-widget-container ${SAVED_ENTRY}`);
  const missing = address !== null && shownAll<Element>(address, '.c-fat-item__tag .c-tag', cache)
    .some((tag) => /^missing information$/i.test(words(tag)));
  // jr7-saashr-contact: <div class="c-contact-info-widget-container"><div class="c-widget-fat-item"> ... <ul
  // class="c-metadata"><li class="c-metadata__item"><i class="c-icon icon-email" ...></i><span ...>(the email)</span>
  // </li></ul>: no phone item.
  const contact = body.querySelector(`.c-contact-info-widget-container ${SAVED_ENTRY}`);
  const emailOnly = contact !== null && all(contact, '.c-metadata__item')
    .every((item) => item.querySelector('i.icon-email') !== null);
  return [missing ? editOf(address) : null, emailOnly ? editOf(contact) : null]
    .filter((button): button is HTMLElement => button !== null);
}

/** "Upload Complete" after the run's own upload (UKGR-10, D-9): its Cancel, which keeps the file without UKG's parse;
 *  never Populate. Null while it does not show. */
function uploadPrompt(doc: Document): UploadPrompt | null {
  const cache = newScanCache();
  const alert = alertOf(doc, cache);
  if (alert === null || !UPLOAD_COMPLETE.test(alert.title)) return null;
  // jr7-saashr-documents-populate: <div class="buttons"><button type="button" class="c-button m-rounded"
  // title=""><span class="c-button__label">Cancel</span></button><button ... m-primary ...>Populate</button></div>.
  const cancel = alertButtons(alert.el, cache).find((button) => /^cancel$/i.test(words(button)));
  return cancel === undefined ? null : { press: cancel, kind: 'dismiss' };
}

/** The rules, each naming its snapshot (fixture case) in `from`. */
const RULES: AtsConfig = {
  platform: 'ukgready',
  snapshots: UKGREADY_CASES,
  parse: parseUkgReadyUrl,
  // Every session case and the start form (see APP, START_FORM, STEP_BODY); detect is the code's (rootOf), this rule
  // tells the posting's entry where no form shows yet.
  root: { css: APP, holds: `${START_FORM}, ${STEP_BODY}`, from: 'jr7-saashr-start-filled, jr7-saashr-contact' },
  states: [
    // jr7-saashr-choice: <div class="c-full-apply-resume-view"> ... <button class="c-button m-rounded" ...
    // aria-label="Type it in myself" data-tracking-id="8740c691-...">Type it in myself</button>; never "Use my resume"
    // or "Log in" (UKGR-11, UKGR-21).
    { name: 'entry-choice', when: CHOICE, auth: 'entry-choice',
      entry: `${CHOICE} button[aria-label="Type it in myself" i]`, from: 'jr7-saashr-choice' },
  ],
  questions: [
    // jr7-saashr-questionnaire: <li class="c-questionnaire-wrapper__question-list-item ..." id="<qid>"><h3
    // class="title ques-required">1. ...</h3> ... a checkbox group's boxes named only by that title.
    { container: 'li.c-questionnaire-wrapper__question-list-item', title: 'h3.title', group: true,
      from: 'jr7-saashr-questionnaire' },
  ],
  required: [
    // jr7-saashr-contact: <span ... class="c-form-control m-full-width--ht0CvY m-rounded m-required--9nk+qc">.
    { is: '.c-form-control[class*="m-required"]', from: 'jr7-saashr-contact, jr7-saashr-contact-address-filled' },
    // jr7-saashr-questionnaire: <h3 class="title ques-required">.
    { is: 'h3.title.ques-required', from: 'jr7-saashr-questionnaire' },
  ],
  uploads: [
    // jr7-saashr-documents: <div class="c-resume-widget-container"><div class="c-document-upload-widget-container"> ...
    // <button class="file-info ..." type="button" aria-label="Upload File"><span class="action-btn
    // upload-icon">Choose</span> ...</button></div><input id="_file_input_0" tabindex="-1" class="upload-file-input"
    // type="file">; -documents-after: <div class="uploaded-file-container ..."> ... <div class="uploaded-file"> ... <span
    // class="document-info__link-wrapper"><a class="c-link"><span class="c-link__label">(the file's name)</span>.
    { input: '.c-resume-widget-container input.upload-file-input[type="file" i]',
      control: 'button.file-info[aria-label="Upload File" i]',
      area: '.c-resume-widget-container .c-document-upload-widget-container',
      done: '.uploaded-file-container .uploaded-file', name: '.document-info__link-wrapper .c-link__label',
      from: 'jr7-saashr-documents, jr7-saashr-documents-after' },
    // jr7-saashr-documents: the same under <div class="c-cover-letter-widget-container">, no file put in.
    { input: '.c-cover-letter-widget-container input.upload-file-input[type="file" i]',
      control: 'button.file-info[aria-label="Upload File" i]',
      area: '.c-cover-letter-widget-container .c-document-upload-widget-container',
      done: '.uploaded-file-container .uploaded-file', name: '.document-info__link-wrapper .c-link__label',
      from: 'jr7-saashr-documents' },
  ],
  // jr7-saashr-review: <button class="c-button m-rounded m-primary" data-tracking-id="085b9254-...">Sign &amp; submit
  // application</button> (the code's submitButton reads it by its words too).
  submit: { css: `button[data-tracking-id="${SIGN_ID}"]`, from: 'jr7-saashr-review' },
  neverPress: [
    // Back: the header's (d8ee3e8b-...), the start form's (a77bbd41-...) and the header's back arrow (aria-label="back").
    { css: 'button[data-tracking-id="d8ee3e8b-e20f-4d27-9c84-1838d25aefcc"], button[data-tracking-id="a77bbd41-59b9-4ef9-a18e-aa8679893573"], button[aria-label="back" i]',
      from: 'jr7-saashr-start-filled, jr7-saashr-contact' },
    // Close: an editor's footer Close (35daaf9e-...) and its corner (data-tracking-id="undefined_close" aria-label="Close").
    { css: 'button[data-tracking-id="35daaf9e-031e-4949-901d-2292ef8730b2"], button[data-tracking-id="undefined_close"], .c-popup button[aria-label="Close" i]',
      from: 'jr7-saashr-contact, jr7-saashr-review-sign' },
    // The consent's Cancel (e3619e49-...).
    { css: 'button[data-tracking-id="e3619e49-50a4-4c4c-9fd4-de376b9ba44a"]', from: 'jr7-saashr-review-sign' },
    // A saved entry's Edit and delete icons (Contact's Edit is the editor-opener door's alone).
    { css: '.c-fat-item__actions button', from: 'jr7-saashr-contact, jr7-saashr-work-history' },
    // "Show more" (.c-show-more__control), "Show All Jobs" beside Apply, "Use my resume" (9c20bce9-...), "Log in"
    // (be2276ce-...), "Go to my portal" (3a15e7c6-...).
    { css: '.c-show-more__control button', from: 'jr7-saashr-documents' },
    { css: '.c-career-search-details-view__title-buttons-view button.c-button:not([title="Apply"])', from: 'jr7-saashr-posting' },
    { css: 'button[data-tracking-id="9c20bce9-e91b-49e0-942e-dfc43dab98bd"], button[data-tracking-id="be2276ce-9f04-4e17-83c0-19674bb80367"]',
      from: 'jr7-saashr-choice' },
    { css: 'button[data-tracking-id="3a15e7c6-49cf-4f6d-8fe5-41e5d47ccb9e"]', from: 'jr7-saashr-confirmation' },
    // The review's accordion buttons (dc78edbe-... and the expanders) and its pager.
    { css: '.c-profile-summary-container button', from: 'jr7-saashr-review' },
    // The header, its menus and the feedback button.
    { css: 'header#_header button, #mini-header-portal button, #_feedback-button_portal button', from: 'jr7-saashr-contact' },
    // "Type or paste it myself" (804a0d7d-...) and "Add Another Document".
    { css: 'button.c-document-upload-widget-container__toggle, button[title="Add Another Document"]',
      from: 'jr7-saashr-documents' },
    // Every alert's measuring copy of its buttons (UKGR-V4).
    { css: '.c-modal-button-group-measurement button', from: 'jr7-saashr-documents-populate, jr7-saashr-questionnaire-filled' },
  ],
  excluded: [
    // The header with its global search and menus, the sticky mini header, the feedback button (every session case).
    { css: 'header#_header, #mini-header-portal, #_feedback-button_portal', from: 'jr7-saashr-contact' },
    // jr7-saashr-contact: <div class="c-security-question-widget-container"> "Security Question (Optional)": never filled.
    { css: '.c-security-question-widget-container', from: 'jr7-saashr-contact' },
    // jr7-saashr-contact: the box labelled only by its placeholder 999-99-9999 (UKGR-14): <input ... placeholder=
    // "999-99-9999" name="SSN">, never written.
    { css: '.c-form-control:has(input[name="SSN" i])', from: 'jr7-saashr-contact' },
    // jr7-saashr-reference-entry: the reference editor (UKGR-13): references are not in the profile.
    { css: '#react_popup div.c-popup:has(input[name="refCompany" i])', from: 'jr7-saashr-reference-entry' },
    // jr7-saashr-review: <div class="c-profile-summary-container"> the review's read-only copy of the answers.
    { css: '.c-profile-summary-container', from: 'jr7-saashr-review' },
  ],
  // jr7-saashr-documents-after: "Saving".
  busy: [{ css: SAVING, from: 'jr7-saashr-documents-after' }],
  // jr7-saashr-confirmation: <div class="c-success-screen"> ... <div class="c-success-screen__title">We got it!</div><div
  // class="c-success-screen__content">Thanks for taking the time to apply</div> (UKGR-12).
  success: { css: `${SUCCESS_SCREEN} .c-success-screen__title`, text: /^we got it!?$/i,
    companion: { css: '.c-success-screen__content', text: /^thanks for taking the time to apply\.?$/i, scope: SUCCESS_SCREEN },
    from: 'jr7-saashr-confirmation' },
  posting: {
    // jr7-saashr-posting: <div class="c-career-search-details-view__details"> (Description, Requirements, Summary).
    text: '.c-career-search-details-view__details',
    // jr7-saashr-posting: <div class="c-career-search-details-view__title-buttons-view"> ... <button class="c-button
    // m-rounded m-primary" title="Apply" type="button">Apply</button> (UKGR-11).
    entry: '.c-career-search-details-view__title-buttons-view button.c-button[title="Apply"]',
    from: 'jr7-saashr-posting',
  },
  // The steps and dialogs change in place at one address; the start form is drawn at the posting's (module header).
  quirks: { formLateMs: 30_000, formInPlace: true, formAtPosting: true, entryPresses: 2 },
};

/** The rule-built hooks the code below falls back to. */
const ruled = configuredHooks(RULES);

/** jr7-saashr-contact: a phone's "Code" select (<li class="c-phone-section-warapper__code-field"> <select name="code">)
 *  and its phone's label (<li class="c-phone-section-warapper__phone-field"> <label for=...>Home Phone</label>). */
function phoneLabelOf(control: Element): Element | null {
  if (control.localName !== 'select') return null;
  const code = control.closest('li.c-phone-section-warapper__code-field');
  return code?.parentElement?.querySelector('li.c-phone-section-warapper__phone-field label') ?? null;
}

/** jr7-saashr-contact: the element around the three phones' grids, the "Primary" radios' group (<li
 *  class="c-phone-section-warapper__primary-field"><label class="c-base-checkbox m-radio"> ... <input
 *  aria-label="Primary" type="radio" name="primary"> ... <span class="c-base-checkbox__label">Primary</span>). */
function primaryGroupOf(control: Element): Element | null {
  if (!control.matches('li.c-phone-section-warapper__primary-field input[type="radio" i]')) return null;
  return control.closest('ul.c-phone-section-warapper__grid')?.parentElement ?? null;
}

/** Whether `el` is the "Primary" radios' group (primaryGroupOf). */
function isPrimaryGroup(el: Element): boolean {
  return all(el, ':scope > ul.c-phone-section-warapper__grid li.c-phone-section-warapper__primary-field input[type="radio" i]')
    .length > 0;
}

/** jr7-saashr-review-sign: <input id="signature" name="fullEmployeeName"> in the consent dialog. */
const isSignature = (control: Element) => control.matches('input#signature') && control.closest(CONSENT) !== null;

/** The labels no rule can say (module header): a phone's code, the "Primary" group, the e-signature, an upload's
 *  section title; else the question rules'. */
function labelFor(control: Element): Element | null {
  const phone = phoneLabelOf(control);
  if (phone !== null) return phone;
  if (isPrimaryGroup(control)) return control.querySelector('li.c-phone-section-warapper__primary-field .c-base-checkbox__label');
  if (isSignature(control)) return (control as HTMLInputElement).labels?.[0] ?? null;
  // jr7-saashr-documents: <div class="c-document-upload-widget-container"> ... <div
  // class="c-document-widget-section-title">Resume Upload</div> (Cover Letter &amp; Upload Documents).
  if (control.matches('input.upload-file-input[type="file" i]')) {
    return control.closest('.c-document-upload-widget-container')?.querySelector('.c-document-widget-section-title') ?? null;
  }
  return ruled.labelFor?.(control) ?? null;
}

/** "country code" after a phone code's phone label, "phone" after the Primary group's word, "to confirm" after the
 *  e-signature's "Full Name" (FIX7PLAN §3.3). */
function labelSuffix(control: Element): string | null {
  if (phoneLabelOf(control) !== null) return 'country code';
  if (isPrimaryGroup(control)) return 'phone';
  return isSignature(control) ? 'to confirm' : null;
}

/** Bookkeeping for the labels read before the control's own label[for] ("Code", "Full Name"). */
const labelFirst = (control: Element) => phoneLabelOf(control) !== null || isSignature(control);

/** The e-signature's prompt (jr7-saashr-review-sign: <span class="label fld-below">Please type your full name to
 *  confirm: <span class="u-medium-font">(the name the start form took)</span></span>), else the question rules'. */
function descriptionFor(control: Element): Element[] {
  if (isSignature(control)) return all<Element>(control.closest('form') ?? control, 'span.label.fld-below');
  return ruled.descriptionFor?.(control) ?? [];
}

/** The "Primary" group's element, else the question rules' (a questionnaire's checkbox group). */
function groupOf(control: Element): Element | null {
  return primaryGroupOf(control) ?? ruled.groupOf?.(control) ?? null;
}

/** Every control draws its box on its field span (the audit §2: <span class="c-form-control__field..."
 *  data-test="form-control-field">), never on itself (item 14; ENGINE-7 reads the box's edge, UKGR-5). */
function controlBox(control: Element): Element | null {
  return control.closest('.c-form-control')?.querySelector('[data-test="form-control-field"]') ?? null;
}

/** MM/DD/YYYY for UKG's date pickers (jr7-saashr-documents: <span data-test="availableStartDate--DatePickerUnifiedComp
 *  --form-control" ...> ... <input placeholder="mm/dd/yyyy" aria-controls="_calendar_0">; -work-entry-filled: "Job
 *  From", whose box shows no placeholder, and "Job To"). */
function formatFor(control: Element): { format: 'date'; pattern: string } | null {
  return control.localName === 'input' && control.closest('[data-test$="--DatePickerUnifiedComp--form-control"]') !== null
    ? { format: 'date', pattern: 'MM/DD/YYYY' } : null;
}

/** The fields' sections: the step body and the open editor, each named by the step's heading, the editor of a work or
 *  education entry of that repeatable's kind (UKGR-15), the reference editor "Professional References" (UKGR-13,
 *  besides its exclusion), and the consent by its title. */
function sections(root: Element): ReturnType<NonNullable<Adapter['sections']>> {
  const doc = root.ownerDocument;
  const cache = newScanCache();
  const body = stepBodyOf(doc, cache);
  if (body === null || !root.contains(body)) return [];
  const heading = words(firstShown<Element>(body, HEADING, cache)).slice(0, TEXT_CAP_LABEL);
  const out: ReturnType<NonNullable<Adapter['sections']>> = heading === '' ? [] : [{ el: body, label: heading }];
  const editor = editorOf(doc, cache);
  const kind = editorKindOf(doc, cache);
  if (editor !== null && root.contains(editor) && heading !== '') {
    out.push({ el: editor, label: heading, ...(kind === 'experience' || kind === 'education' ? { kind } : {}) });
  }
  const consent = consentOf(doc, cache);
  const title = consent === null ? '' : words(consent.querySelector('.c-popup__title'));
  if (consent !== null && root.contains(consent) && title !== '') out.push({ el: consent, label: title });
  return out;
}

/** Never pressed (UKGR-V4, item 15): the rules' list and, in "Upload Complete", every button but its Cancel
 *  (Populate: D-9). */
function neverPress(root: Element): Element[] {
  const doc = root.ownerDocument;
  const populate = all(doc, `${ALERT} button`).filter((button) => /^populate$/i.test(words(button)));
  return [...new Set([...(ruled.neverPress?.(root) ?? []), ...populate])];
}

/** UKG Ready's config: the rules, and the hooks no rule can say. */
export const UKGREADY_CONFIG: AtsConfig = {
  ...RULES,
  code: {
    detect(doc) {
      const formRoot = rootOf(doc);
      return formRoot === null ? null : { formRoot };
    },
    isFinalStep,
    nextButton,
    submitButton,
    stepSignature,
    stepSubmitNext,
    repeatables,
    prefill: { readEntries },
    editorOpener,
    uploadPrompt,
    labelFor,
    labelSuffix,
    labelFirst,
    descriptionFor,
    groupOf,
    controlBox,
    formatFor,
    sections,
    neverPress,
  },
};
