/*
 * The UltiPro (UKG Pro Recruiting) adapter (DESIGN-NEW-ATS §1 "UltiPro", §5 builder A): a full adapter over the
 * configured layer's hooks (configuredHooks), read from the owner's three snapshots of 2026-11-06, converted as
 * fixtures/ultipro/*.html: ultipro-2 register.html (the account step), ultipro-1 resume-review.html (the application's
 * résumé pre-fill review) and ultipro-0 application.html (the same page and load once the review was saved: the whole
 * one-page application). Every rule names the snapshot it was read from.
 * - Page states (ULTIPRO_CONFIG.states):
 *   - register (body.authcode-controller with form#registrationDetailsForm, ultipro-2): first name, last name and
 *     phone, filled from the profile like a step; its labels are the ukg-label elements each input's aria-labelledby
 *     names (light text, a shadow star). Create account (the ukg-button[form=registrationDetailsForm] outside the
 *     form, behind Cloudflare Turnstile) is never pressed by a run's Next or Submit: the step is final 'unknown'. It
 *     follows Sign-in mode (the snapshot build of 2026-11-06, core pass Z1 item 24: registerContainer): the form is the
 *     state's declared sign-in container, Create account its button, so Sign-in Auto presses it once the step is filled
 *     and rests, through its door and every guard (Sign-in Auto types nothing: the form holds no email or password);
 *     Manual leaves it to the person.
 *   - review (div[data-bind="if: isParsingResume()"] holding [data-automation=contact-information-section], ultipro-1):
 *     the parsed contact information, work experience, education and skills, filled like a step; its Next is
 *     "Save and continue" (the review's own button.btn-primary[data-automation=save-button]), its Cancel never pressed.
 *     While it shows, the application below is display: none and every contact id is there twice: the state's root is
 *     the review alone.
 *   - otherwise the application, its root #OpportunityApply (ultipro-0): one page, no steps, final when Submit shows.
 *     Submit is the ukg-button[data-automation=btn-submit] host, whose Knockout click binding (click: save) sits on the
 *     host, its native button in its shadow root; identified so the fill never presses it.
 * - Sections: each panel, div[role=region] with its h2 (Contact Information, Work Experience, Education, Skills,
 *   Behaviors, Motivations, Licenses and Certifications, Links, Documents, Questions).
 * - Required: label.control-label.required (the star is drawn by CSS): select#Country carries no required attribute
 *   (ultipro-0, -1).
 * - The start date (ultipro-0): its month, day and year boxes sit in ukg-date-input-text's open shadow root; jr6 U-07:
 *   the component is one date field (dateFor), its three boxes its parts (excluded as fields of their own), its
 *   question the light label[data-automation=start-date-label] "When can you start? (MM/DD/YYYY)" in the same form
 *   group, whose for= names nothing (labelFor on the component); its box the wrapper whose style draws one, ukg-item in
 *   this capture (controlBox; the jr6 review's REVC-5).
 * - Read-only account names (#FirstName, #FamilyName, #FormerName, #PreferredName in the application) are read-only to
 *   the scanner by their own attribute.
 * - Never pressed: Cancel (the application's, to the posting; the review's; a panel editor's), Sign Out, a panel's
 *   Remove, a document's delete link, the résumé parser (its upload and its choice of a saved résumé), the navigation's
 *   menus and Sign In, the accessibility banner's links and the EEOC definition link.
 * - jr6 (FIXPLAN §6.10, the audit SP\jr6\audit\ultipro.md), P1's adapter parts:
 *   - U-01: the review's Work Experience and Education are repeatable sections, each panel-list-item a block (so the
 *     planner finds each parsed entry by its fingerprint); their Add is never offered (Decision 16, owner question
 *     Q1), each block's own Delete is its removeButton, still never pressed by a run;
 *   - U-02: a period box whose own label is the part word alone ("Month", "Year (YYYY)") is labelled by its group too,
 *     the adapter's label read first ("From Month", "From Year (YYYY)");
 *   - U-04: School Name and Level of Education / Degree are twitter-typeahead searches, their results the sibling
 *     .tt-dropdown-menu's .tt-suggestion rows; School's typed text stands where no result matches (freeText); Degree
 *     takes the page's own degree list (knownOptions) where the page publishes it in a script;
 *   - U-05: the review's Skills box takes several skills, one at a time, each a chip once its row's Add is pressed;
 *   - U-06 (now part, Decision 16): the résumé parser's own upload and its list of saved résumés hold no question;
 *   - U-09: each "I decline to say" box beside an EEO list is labelled by that list's question first;
 *   - U-12: each uploaded document's row in Documents holds no question;
 *   - U-16: the phone boxes take the national number (formatFor);
 *   - apply-path C3: the application is drawn after its sign-in round trip: quirks.formLateMs 30 s.
 * Turnstile (the account step and the application, ultipro-0 to -2) is drawn in a closed shadow root: the extension
 * cannot read it (dom/pause-detect.ts's known limit), and Submit and Create account are the page's to enable.
 * jr7 ULTIPRO-7 (FIX7PLAN §6.8; the owner's snapshot7 ultipro1, recruiting2.ultipro.com, and ultipro2,
 * recruiting.ultipro.com, both through UKG's sign-in at signin-us.ultipro.com; fixtures/ultipro/jr7-ultipro{1,2}-*):
 * - UP7-01, UP7-V2: the page after submitting (url.ts confirmationAfter: same host, tenant and board as the armed form);
 *   its sign is div#ApplicationSubmitted shown, whatever words its HasAssessment() branch draws (success);
 * - UP7-02: UKG's sign-in hosts (identityHosts), where nothing of ours runs (owner question Q7-9: no password typed);
 * - UP7-03: an EEO list whose own "I decline to say" box is ticked holds no question while it is (excluded);
 * - UP7-04, UP7-V1: the account step's three boxes, drawn by their ukg-field's shadow container (controlBox), and its
 *   privacy box, an ARIA checkbox, the sign-in container's term; Create account enabled once filled;
 * - UP7-07 (owner question Q7-8): the documents dialog after Submit is the person's: a state with nothing filled or
 *   pressed, both its buttons never pressed;
 * - UP7-09: the posting's Apply now (posting.entry), the Apply menu and LinkedIn's widget never pressed;
 * - UP7-12: the data-use consent radios labelled by their question.
 * Nothing here reads, logs or sends a value.
 */
import { parseColor } from '../../dom/color';
import { newScanCache, styleOf } from '../../dom/scan-cache';
import { TEXT_CAP_LABEL } from '../../dom/thresholds';
import { visibleText } from '../../dom/visible-text';
import { isUserVisible } from '../../dom/visibility';
import { configuredHooks } from '../configured';
import type { AtsConfig } from '../configured/types';
import type { Adapter, DatePartsDecl, SignInForm, WidgetDecl } from '../types';
import { canonicalApplicationUrl, confirmationAfter, matchesUrl, parseUltiproAddress } from './url';

/** The fixtures the adapter was read from (fixtures/ultipro/<case>.html). */
export const ULTIPRO_SNAPSHOTS = ['fixtures/ultipro/register.html', 'fixtures/ultipro/resume-review.html',
  'fixtures/ultipro/application.html',
  // ── jr7 ULTIPRO-7 P2: the owner's snapshot7 ultipro1 and ultipro2 (the pages with an expectation file) ──
  'fixtures/ultipro/jr7-ultipro1-posting.html', 'fixtures/ultipro/jr7-ultipro2-posting.html',
  'fixtures/ultipro/jr7-ultipro1-register.html', 'fixtures/ultipro/jr7-ultipro2-register.html',
  'fixtures/ultipro/jr7-ultipro1-apply-1.html', 'fixtures/ultipro/jr7-ultipro2-apply-1.html',
  'fixtures/ultipro/jr7-ultipro1-apply-11.html', 'fixtures/ultipro/jr7-ultipro1-submitted.html',
  'fixtures/ultipro/jr7-ultipro2-submitted.html'] as const;

/** The résumé review's container (ultipro-1: <div data-bind="if: isParsingResume()"><div data-bind="with:
 *  contactInfoViewModel" data-automation="contact-information-section"> ...; empty in ultipro-0). */
const REVIEW = 'div[data-bind="if: isParsingResume()"]';

/** jr7 ULTIPRO-7 (UP7-07): UltiPro's documents dialog after Submit (jr7-ultipro1-apply-11). */
const DOCUMENTS_DIALOG_CSS = 'div#AttachmentsChangedModal[role="dialog" i]';

/** The rules the configured layer builds hooks from, each naming its snapshot. */
export const ULTIPRO_CONFIG: AtsConfig = {
  platform: 'ultipro',
  snapshots: ['register', 'resume-review', 'application',
    // jr7 ULTIPRO-7: snapshot7's (fixtures/ultipro/jr7-ultipro{1,2}-*).
    'jr7-ultipro1-posting', 'jr7-ultipro2-posting', 'jr7-ultipro1-register', 'jr7-ultipro2-register', 'jr7-ultipro1-apply-1',
    'jr7-ultipro2-apply-1', 'jr7-ultipro1-apply-11', 'jr7-ultipro1-submitted', 'jr7-ultipro2-submitted'],
  parse: parseUltiproAddress, // jr7 ULTIPRO-7 (UP7-01): with the page after submitting
  matchesUrl,
  states: [
    // ── jr7 ULTIPRO-7 (FIX7PLAN §6.8 item 5, UP7-07; owner question Q7-8, default: the person's) ──
    // snapshot7 ultipro1, after Submit with the session's documents changed (jr7-ultipro1-apply-11): <div
    // id="AttachmentsChangedModal" class="modal fade in" tabindex="-1" role="dialog" style="display: block;"> ... <p
    // data-automation="attachments-modal-text"> (would you like to save these changes to your profile?), Yes and No
    // (neverPress below). The application is not sent until it is answered. No root and no Next: while it shows,
    // nothing is filled and nothing pressed (final 'unknown'); the person answers it. Jobright has no rule for it (no
    // AttachmentsChanged reference in its bundles).
    { name: 'documents-dialog', when: DOCUMENTS_DIALOG_CSS, from: 'jr7-ultipro1-apply-11' },
    // ── end jr7 ULTIPRO-7 (UP7-07) ──
    // ultipro-2: <body class="authcode-controller candidate-layout white-background"> ... <form method="post"
    // id="registrationDetailsForm" ...> with three <ukg-field>s.
    { name: 'register', when: 'body.authcode-controller form#registrationDetailsForm',
      root: 'body.authcode-controller form#registrationDetailsForm', from: 'ultipro-2' },
    // ultipro-1: the review, its Contact Information first.
    { name: 'review', when: `#OpportunityApply ${REVIEW} [data-automation="contact-information-section"]`,
      root: `#OpportunityApply ${REVIEW}`,
      // ultipro-1: <div class="actions"><button data-bind="click: save, ..." class="btn btn-primary"
      // data-automation="save-button">Save and continue</button><button ... type="button" class="btn btn-link"
      // data-automation="cancel-button">Cancel</button></div>.
      next: `#OpportunityApply ${REVIEW} .actions > button.btn-primary[data-automation="save-button"]`, from: 'ultipro-1' },
  ],
  // ultipro-0: <div id="OpportunityApply" ...> holding every panel and <ukg-button data-automation="btn-submit" ...>.
  root: { css: '#OpportunityApply', holds: 'ukg-button[data-automation="btn-submit"]', from: 'ultipro-0' },
  // ultipro-0, -1: <label for="FirstName" class="control-label required" ...>; <label for="Country" class="control-label
  // required" ...> over <select ... id="Country"> with no required attribute.
  required: [{ is: 'label.control-label.required', from: 'ultipro-0, ultipro-1' }],
  sections: [
    // ultipro-0: <div role="region" ... class="panel panel-transparent" aria-label="Contact Information"> ... <h2
    // class="collapsible-panel-title" data-automation="panel-title" ...>Contact Information</h2>; <div role="region"
    // id="AppDocuments" data-automation="application-documents" ...> ... <h2>Documents</h2>; <div role="region"
    // data-automation="questions-panel" ...> ... <h2 class="clickable-header">Questions</h2>.
    { container: '#OpportunityApply div[role="region" i]', heading: 'h2', from: 'ultipro-0, ultipro-1' },
  ],
  // ultipro-0: <ukg-button data-automation="btn-submit" data-bind="text: submitButtonText, click: save, ...">Submit
  // </ukg-button>, its shadow root's <button aria-label="Submit" class="ukg-button-native" ... type="button">.
  submit: { css: '#OpportunityApply ukg-button[data-automation="btn-submit"]', from: 'ultipro-0' },
  neverPress: [
    // ultipro-0: <a class="btn btn-link" data-automation="btn-cancel" href=".../OpportunityDetail?...">Cancel</a>;
    // ultipro-1: the review's Cancel; every panel editor's Cancel.
    { css: 'a[data-automation="btn-cancel"], button[data-automation="cancel-button"]', from: 'ultipro-0, ultipro-1' },
    // ultipro-0: <button type="button" class="btn-link p-0" data-automation="application-incorrect-name-text-signout-link">.
    { css: '[data-automation="application-incorrect-name-text-signout-link"]', from: 'ultipro-0' },
    // ultipro-0, -1: a skill's <button ... data-automation="remove-button" aria-label="Remove ...">, a review item's
    // "Delete Work Experience <N>"; a document's <a ... data-automation="delete-file-link" role="button" ...>.
    { css: 'button[data-automation="remove-button"], a[data-automation="delete-file-link"]', from: 'ultipro-0, ultipro-1' },
    // The résumé parser (ultipro-0, -1, hidden in both): <div id="ResumeParsingUploader"
    // data-automation="resumeparsinguploader-container"> holds its upload (<upload-button params="... uploadUrl:
    // '.../Documents/UploadResume?...'"><form ...><input type="file" ...><label role="button" ...
    // data-automation="upload-file-btn" ...>) and <select data-automation="existing-resume-selector">, and also the
    // review the parse leads to (ultipro-1), so its upload and its choice alone are never pressed, not the container.
    { css: '#ResumeParsingUploader upload-button, [data-automation="existing-resume-selector"]', from: 'ultipro-0, ultipro-1' },
    // The navigation (ultipro-0 to -2) and the accessibility banner.
    { css: '#OpportunitiesMenuButton, #CandidatePresenceMenuButton, #profile-button-menu, #language-picker-link, #SignInButton',
      from: 'ultipro-0, ultipro-2' },
    { css: '[data-automation="accessibility-banner-link"], [data-automation="accessibility-banner-dismiss"]', from: 'ultipro-0' },
    { css: '#EEOCModalLink', from: 'ultipro-0' },
    // ultipro-2's Create account is the register state's sign-in container's button (core pass Z1, item 24:
    // registerContainer), pressed by Sign-in Auto's door alone.
    // ── jr7 ULTIPRO-7 ──
    // UP7-07 (owner question Q7-8): the documents dialog's Yes and No (jr7-ultipro1-apply-11: <button class="btn
    // btn-primary" data-automation="attachments-modal-yes" data-bind="... click: willUpdateCandidateDocuments">, <button
    // class="btn btn-default" data-automation="attachments-modal-no" ... willNotUpdateCandidateDocuments>): the person's.
    { css: 'button[data-automation="attachments-modal-yes"], button[data-automation="attachments-modal-no"]',
      from: 'jr7-ultipro1-apply-11' },
    // UP7-09: the posting's Apply menu (Jobright's createUltiproEntryAdapter leaves #apply-menu-button out of its entry)
    // and LinkedIn's apply widget (jr7-ultipro1-posting, -2-posting: <div class="linkedIn-container"
    // data-automation="awli-widget-container">).
    { css: '#apply-menu-button, [data-automation="awli-widget-container"]',
      from: 'jr7-ultipro1-posting, jr7-ultipro2-posting' },
    // ── end jr7 ULTIPRO-7 ──
  ],
  // ultipro-0: <div data-automation="application-errors" aria-live="polite"><div class="validation-summary-errors"
  // role="alert" data-automation="error-messages" style="display: none;">; a field's <span class="help-block"
  // id="FirstNameError" data-automation="firstName-error" ...>, hidden while it holds none.
  errors: { css: 'div.validation-summary-errors[data-automation="error-messages"], span.help-block[id$="Error"]',
    from: 'ultipro-0' },
  // ── jr6 ULTIPRO P1 (FIXPLAN §6.10) ──
  excluded: [
    // U-06, now part (Decision 16; owner question Q3 decides whether a run ever uses the parser): the résumé parser's
    // own parts in the application (ultipro-0, -1: <div id="ResumeParsingUploader" ...> holds <div data-bind="overlay:
    // ...">, <div data-bind="visible: !isParsingResume() && !hasSavedParsedResume()"> with its <input type="file"
    // data-automation="upload-file-input"> and <select data-automation="existing-resume-selector">, and <div
    // data-bind="if: isParsingResume()">, the review). Every child but the review: the review is the review state's
    // own root, never excluded (a root's ancestor is never one of its parts either).
    { css: '#ResumeParsingUploader > :not([data-bind="if: isParsingResume()"])', from: 'ultipro-0, ultipro-1' },
    // The parser's list of résumés already uploaded, wherever a page draws it (ultipro-0: <select
    // data-automation="existing-resume-selector"> under "Choose a file that you have already uploaded.").
    { css: 'select[data-automation="existing-resume-selector"]', from: 'ultipro-0' },
    // U-12: each uploaded document's row in Documents (ultipro-0: <div id="Documents" data-bind="with: { application:
    // ... }"> ... <div class="file row hidden-print" data-automation="file-row"> with its select-document-checkbox,
    // file-type select and file-description box, each labelled by the file's name): the person's own files, kept as
    // they are. The panel's "Upload a file" input stays a field.
    { css: '#Documents div[data-automation="file-row"]', from: 'ultipro-0' },
  ],
  // Apply-path C3 (SP\jr6\audit\apply-c.md; APPLYPLAN D5, BUILD §4 ULTIPRO): #OpportunityApply is drawn after UKG's
  // sign-in round trip (its account step's returnUrl), later than the content script starts: its root is looked for
  // again as the page changes, for up to 30 s (late-form.ts LATE_FORM_CAP_MS). Jobright waits up to 15 s for an
  // editable control under #OpportunityApply (UltiPro entry-preflow, createUltiproEntryAdapter).
  quirks: { formLateMs: 30_000 },
  // ── end jr6 ULTIPRO P1 ──
  // ── jr7 ULTIPRO-7 ──
  // UP7-09 (APPLYPLAN E-UltiPro C2, waiting since jr6 for this capture): the posting's Apply now, pressed by the
  // agent's entry door alone, never by a run (entryNeverPressed). jr7-ultipro1-posting, -2-posting: <div
  // class="apply-btns-container"><ukg-button class="apply-now-button ..." data-automation="apply-now-button" ...>; one
  // shown and enabled on each. The selector is Jobright 1.25.2's (its UltiPro entry-preflow, createUltiproEntryAdapter:
  // the visible, enabled apply-now-button host, never #apply-menu-button), a disabled host left out. Its press arms the
  // person's grant that carries across UKG's sign-in to the Register and the application (the verifier's measure).
  posting: { entry: '.apply-btns-container ukg-button[data-automation="apply-now-button"]:not(#apply-menu-button)'
    + ':not([disabled]):not([aria-disabled="true" i])', from: 'jr7-ultipro1-posting, jr7-ultipro2-posting' },
  // UP7-01, UP7-V2: the page after submitting (url.ts confirmationAfter reads its address; jr7-ultipro1-submitted,
  // -2-submitted): <div id="ApplicationSubmitted"><div class="row"><!-- ko ifnot: application.HasAssessment() --> its
  // h1[data-automation="header"] and subheader <!-- /ko --><!-- ko if: application.HasAssessment() --><!-- /ko -->.
  // The sign is the view itself shown, not its words: an application with an assessment draws the other branch, whose
  // words neither capture shows. Jobright never confirms an UltiPro application (its ats-rules: ultipro, success: []).
  success: { css: '#ApplicationSubmitted', from: 'jr7-ultipro1-submitted, jr7-ultipro2-submitted' },
  // ── end jr7 ULTIPRO-7 ──
};

// ── jr6 ULTIPRO P1: the start date as one date (FIXPLAN §6.10 item 6, U-07) ──
/** The date component (ultipro-0: <ukg-date-input-text role="group" aria-label="Date Input" class="... ukg-required
 *  ..."><template shadowrootmode="open"> ... <input aria-label="Month" aria-required="true"
 *  data-automation="ukg-date-input-text-month" maxlength="2" placeholder="mm" ...>, -day (maxlength 2, "dd"), -year
 *  (maxlength 4, "yyyy")): one date drawn in three boxes. */
const DATE_HOST = 'ukg-date-input-text[role="group" i]';
const DATE_PART_NAMES = ['month', 'day', 'year'] as const;

/** jr6 U-07: the component's boxes as a date drawn in parts (Adapter.dateFor), in the order its shadow root draws them,
 *  each typed digit by digit where its value setter's write is not taken (Jobright 1.25.2's UltiPro filler,
 *  doFillForm's date branch, types each part with composed key, input, change and blur events); null for any other
 *  element, or where the component draws none of its boxes. */
function datePartsOf(control: Element): DatePartsDecl | null {
  if (!control.matches(DATE_HOST) || control.shadowRoot === null) return null;
  const shadow = control.shadowRoot;
  const parts = DATE_PART_NAMES.flatMap((part) => {
    const input = shadow.querySelector<HTMLInputElement>(`input[data-automation="ukg-date-input-text-${part}"]`);
    return input === null ? [] : [{ part, input, display: null }];
  }).sort((a, b) => (a.input.compareDocumentPosition(b.input) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  return parts.length === 0 ? null : { parts, keys: 'digits', snapshot: 'ultipro-0' };
}

/** The boxes of every date component under `root` (jr6 U-07): parts of their date, never fields of their own. */
function datePartBoxes(root: Element): Element[] {
  return Array.from(root.querySelectorAll(DATE_HOST)).flatMap((host) => datePartsOf(host)?.parts.map((part) => part.input)
    ?? []);
}

/** The date component's datepicker container (ultipro-0: <ukg-input-container data-automation="ukg-datepicker-container"
 *  class="sc-ukg-input-container-h ...">, around the component and its "Choose Date" button). */
const DATE_CONTAINER = 'ukg-input-container[data-automation="ukg-datepicker-container"]';

/** jr6 U-07, the jr6 review's REVC-5: the element around the date component that draws its box (Adapter.controlBox), or
 *  null for any other control. The component draws no box of its own; one of its wrappers does, from its parent up to
 *  its datepicker container (ultipro-0: the container > div.ukg-input-container > ukg-item > div.item-native, which
 *  also holds the "Choose Date" button > div.item-inner > div.input-wrapper > ukg-input > div.input-inner-container >
 *  the component): the first of them, inside out, whose computed style draws an edge (drawsEdge). ultipro-0's own
 *  scoped style draws it on ukg-item (.item-input.sc-ukg-item-h:not(.ukg-hide-border): an inset 1px shadow, rgba(0, 0,
 *  0, 0.42), on a white surface); another UKG build or theme may draw it on another of these wrappers, so it is read
 *  there, not named. None draws an edge: the ukg-item (UKG's field surface, its background), else the container.
 *  ENGINE E2 (dom/camouflage.ts drawnByDeclaredBox) judges whether what this names shows against what is behind it. */
function dateBoxOf(control: Element): Element | null {
  if (!control.matches(DATE_HOST)) return null;
  const container = control.closest(DATE_CONTAINER);
  if (container === null) return null;
  const cache = newScanCache();
  for (let at = control.parentElement; at !== null; at = at.parentElement) {
    const style = styleOf(at, cache);
    if (style !== null && drawsEdge(style, control.ownerDocument)) return at;
    if (at === container) break;
  }
  const item = control.closest('ukg-item');
  return item !== null && container.contains(item) ? item : container;
}

/** Whether a computed style draws an edge around its element: a border side or an outline (a line style other than
 *  none or hidden, 1px wide or more, in a colour with some alpha), or a box shadow, inset or not, whose offset, blur and
 *  spread reach a pixel, in a colour with some alpha. Whether that edge shows against what is behind it is ENGINE's
 *  judgement (drawnByDeclaredBox), not this. */
function drawsEdge(style: CSSStyleDeclaration, doc: Document): boolean {
  const seen = (colour: string) => (parseColor(colour, doc)?.a ?? 0) > 0;
  const line = (lineStyle: string, width: string, colour: string) => lineStyle !== 'none' && lineStyle !== 'hidden'
    && parseFloat(width) >= 1 && seen(colour);
  if ((['top', 'right', 'bottom', 'left'] as const).some((side) => line(style.getPropertyValue(`border-${side}-style`),
    style.getPropertyValue(`border-${side}-width`), style.getPropertyValue(`border-${side}-color`)))) return true;
  if (line(style.outlineStyle, style.outlineWidth, style.outlineColor)) return true;
  if (style.boxShadow === '' || style.boxShadow === 'none') return false;
  // A computed shadow list: "<colour> <x> <y> <blur> <spread> [inset]", comma-separated outside the colour's brackets.
  return style.boxShadow.split(/,(?![^(]*\))/).some((shadow) => {
    const colour = /rgba?\([^)]*\)|transparent/i.exec(shadow)?.[0] ?? '';
    const [x = 0, y = 0, blur = 0, spread = 0] = shadow.replace(colour, '').replace(/\binset\b/i, '').trim().split(/\s+/)
      .map((part) => parseFloat(part)).map((length) => (Number.isFinite(length) ? length : 0));
    return seen(colour) && Math.max(Math.abs(x), Math.abs(y)) + Math.max(0, blur) + spread >= 1;
  });
}

/** The start date's question (see the header) for its date component, or null for any other control. */
function startDateLabel(control: Element): Element | null {
  if (!control.matches(DATE_HOST)) return null;
  // ultipro-0: <div class="form-group col-md-12"><label for="ApplicationAvailableStartDateInput"
  // data-automation="start-date-label" class="control-label required" ...>When can you start? (MM/DD/YYYY)</label>
  // <react-ko-es6-bridge ...><div data-automation="available-start-date-datepicker"><span id="AvailableStartDate"
  // class="sr-only">When can you start?</span><ukg-input-container aria-labelledby="AvailableStartDate" ...> ...
  // <ukg-input data-automation="ukg-datepicker-input" type="date" ...><ukg-date-input-text role="group" ...>.
  const group = control.closest(DATE_CONTAINER)?.closest('div.form-group');
  return group?.querySelector(':scope > label[data-automation="start-date-label"]') ?? null;
}
// ── end jr6 ULTIPRO P1 (U-07) ──

/** The words a period box's own label holds when it names the part alone (jr6 U-02: ultipro-1's "Month", "Year
 *  (YYYY)"). */
const PART_WORDS = /^(?:month|year(?:\s*\(yyyy\))?)$/i;

/** A month or year box in a "From" or "To" group with no label of its own, or (jr6 U-02) whose own label is the part
 *  word alone (ultipro-0, -1: the experience editor's From, whose label[for] says "Month" and "Year (YYYY)"; its To, the
 *  education editor's From and To, with none): its group's label and its own box's label, or null. */
function periodLabels(control: Element): { group: Element; part: Element } | null {
  // ultipro-1: <div class="form-group" role="group"><label class="control-label" ... id="NewWorkExperience_ToLabel0">To
  // </label><div class="form-inline"><div class="form-group"><label ...>Month</label><br><select class="form-control"
  // data-automation="to-month-dropdown" aria-label="To month"> ... <div class="form-group"><label ...>Year (YYYY)</label>
  // <br><input type="text" ... placeholder="YYYY" ... data-automation="to-year-textbox" aria-label="To year">. The From
  // group (jr6 U-02): <label class="control-label required" id="NewWorkExperience_FromLabel0">From</label> ... <label
  // for="NewWorkExperience_FromMonth0">Month</label><br><select id="NewWorkExperience_FromMonth0"
  // data-automation="from-month-dropdown" aria-label="From month">, and "Year (YYYY)" over from-year-textbox the same.
  if (!/^(?:from|to)-(?:month-dropdown|year-textbox)$/.test(control.getAttribute('data-automation') ?? '')) return null;
  const own = control.parentElement;
  const group = own?.parentElement?.parentElement ?? null;
  if (own === null || group === null || !own.matches('div.form-group') || !own.parentElement!.matches('div.form-inline')
    || !group.matches('div.form-group[role="group" i]')) return null;
  const groupLabel = group.querySelector(':scope > label.control-label');
  const part = own.querySelector(':scope > label');
  if (groupLabel === null || part === null) return null;
  // jr6 U-02: a box with a label of its own takes its group's only where that label is its part's, the part word alone.
  const labels = Array.from((control as HTMLInputElement).labels ?? []);
  if (labels.length > 0 && (labels.length > 1 || labels[0] !== part || !PART_WORDS.test(wordsOf(part)))) return null;
  return { group: groupLabel, part };
}

/** An element's visible words on one line (page text). */
function wordsOf(el: Element): string {
  return visibleText(el, { singleLine: true, cap: TEXT_CAP_LABEL, cache: newScanCache() }).trim();
}

// ── jr6 ULTIPRO P1: EEO decline boxes (FIXPLAN §6.10 item 7, U-09; label contract §3.2) ──
/** An "I decline to say" box beside an EEO list (ultipro-0: #CountryQuestions' <div class="form-group"><label
 *  data-automation="gender-question-label" class="control-label required" for="Gender">Gender</label><select
 *  id="Gender" ...><div class="checkbox"><label><input type="checkbox" data-automation="gender-decline-checkbox" ...>
 *  <span>I decline to say</span><span class="sr-only">Gender</span></label></div>; Ethnic Origin (#HispanicOrigin),
 *  Race (#EthnicOrigin) and "Are you a protected veteran?" (#USFederalContractor) the same): its list's question and
 *  its own words, or null. Labelled "<question> I decline to say" (RULES' label contract), read before its own label,
 *  so the box pairs with its list; Jobright reads such a list and its box as one question whose options add the box's
 *  words (UltiPro rules, extractRules; fillMultiSelectField ticks the box for a decline). */
function declineLabels(control: Element): { question: Element; own: Element } | null {
  if (!control.matches('#CountryQuestions input[type="checkbox" i][data-automation$="-decline-checkbox"]')) return null;
  const box = control.closest('div.checkbox');
  const group = box?.parentElement ?? null;
  if (box === null || group === null || !group.matches('div.form-group')) return null;
  const select = group.querySelector(':scope > select');
  if (select === null || select.id === '') return null;
  const question = group.querySelector(`:scope > label.control-label[for="${CSS.escape(select.id)}"]`);
  const own = control.closest('label')?.querySelector(':scope > span:not(.sr-only)') ?? null;
  return question === null || own === null ? null : { question, own };
}
// ── end jr6 ULTIPRO P1 (U-09) ──

/** The Skills panel's typeahead (ultipro-0, -1: <input role="combobox" type="text" required=""
 *  data-automation="item-typeahead" aria-label="Skills" ...>, labelled by nothing a person sees): its panel's h2. */
function skillsTitle(control: Element): Element | null {
  if (!control.matches('input[data-automation="item-typeahead"]')) return null;
  return skillsRegion(control)?.querySelector('h2') ?? null;
}

/** The Skills panel around a control (ultipro-0, -1: <div role="region" ... aria-label="Skills">), or null. */
function skillsRegion(control: Element): Element | null {
  return control.closest('div[role="region" i][aria-label="Skills"]');
}

// ── jr6 ULTIPRO P1: the review's widgets (FIXPLAN §6.10 items 3 and 4, U-04 and U-05) ──
/** How long a school or degree search that shows no suggestion is taken to have found none: Jobright 1.25.2 waits up
 *  to 1 s for a typeahead's candidates (UltiPro operations, fillUltiproTypeaheadField). */
export const ULTIPRO_TYPEAHEAD_EMPTY_MS = 1_000;

/** The education editor's School Name and Level of Education / Degree (ultipro-1: <span class="twitter-typeahead"><input
 *  type="text" id="NewEducation_SchoolId0" class="form-control tt-input" role="combobox" aria-autocomplete="list"
 *  aria-labelledby="lblNewEducation_SchoolId0" data-automation="school-textbox" placeholder="Choose..."
 *  data-bind="value: SchoolName, typeahead: {source: ...}"><pre ...></pre><span class="tt-dropdown-menu"
 *  role="listbox" style="... display: none ..."><div class="tt-dataset-1"></div></span></span>; the Degree box
 *  data-automation="degree-textbox" the same). The Skills box (data-automation="item-typeahead", its role combobox in
 *  the application layout) is no education box. */
const SCHOOL_BOX = 'input.tt-input[role="combobox" i][data-automation="school-textbox"]';
const DEGREE_BOX = 'input.tt-input[role="combobox" i][data-automation="degree-textbox"]';

/** The suggestions list typeahead.js draws beside its box, in its span.twitter-typeahead (above), or null. */
function suggestionsOf(control: Element): Element | null {
  const wrapper = control.parentElement;
  return wrapper !== null && wrapper.matches('span.twitter-typeahead')
    ? wrapper.querySelector(':scope > span.tt-dropdown-menu[role="listbox" i]') : null;
}

/** The longest inline script read for the page's degree list (characters). */
const SCRIPT_TEXT_CAP = 2_000_000;

/** The degree list the page publishes for its Degree box, where the box's typeahead source names it (its data-bind's
 *  `typeahead: {source: ...degreeOptions}`) and an inline script declares it as a JSON array of objects whose `Name`
 *  is each degree's label (`var degreeOptions = [...]`; the page's own words, in its order, each once). Jobright 1.25.2
 *  reads the same list for the same box (UltiPro rules, the Degree typeahead's static options). None where either is
 *  missing or the list is not JSON (the fixtures hold no script: the converter keeps none). */
export function pageDegreeOptions(control: Element): string[] {
  if (!/\bsource\s*:\s*[\w$.[\]]*\bdegreeOptions\b/.test(control.getAttribute('data-bind') ?? '')) return [];
  for (const script of Array.from(control.ownerDocument.scripts)) {
    const text = script.src === '' ? script.textContent ?? '' : '';
    if (text.length > SCRIPT_TEXT_CAP || !text.includes('degreeOptions')) continue;
    const list = /\b(?:var|let|const)\s+degreeOptions\s*=\s*(\[[\s\S]*?\])\s*;/.exec(text)?.[1];
    if (list === undefined) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(list);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    const names = parsed.map((each: unknown) => {
      const name = typeof each === 'object' && each !== null ? (each as { Name?: unknown }).Name : undefined;
      return typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
    }).filter((name) => name !== '');
    return [...new Set(names)];
  }
  return [];
}

/** jr6 U-04: School Name and Degree as searches whose results are the sibling list's .tt-suggestion rows, chosen by
 *  click() (typeahead.js chooses on a suggestion's click); School keeps its typed text where no result matches (the
 *  page binds the box's own text, value: SchoolName; Jobright types the school as plain text); Degree, where the page
 *  publishes its list, is a combobox whose options are that list, else a search too. Null for any other control, or
 *  where the box has no suggestions list beside it. */
function educationSearch(control: Element): WidgetDecl | null {
  const school = control.matches(SCHOOL_BOX);
  if (!school && !control.matches(DEGREE_BOX)) return null;
  const list = suggestionsOf(control);
  if (list === null) return null;
  const known = school ? [] : pageDegreeOptions(control);
  return {
    kind: known.length > 0 ? 'combobox' : 'typeahead-remote',
    opener: control as HTMLElement,
    results: { list, option: '.tt-suggestion' },
    emptyAfterMs: ULTIPRO_TYPEAHEAD_EMPTY_MS,
    ...(school ? { freeText: true as const } : {}),
    ...(known.length > 0 ? { knownOptions: known } : {}),
    snapshot: 'ultipro-1',
  };
}

/** jr6 U-05: the review's Skills box (ultipro-1: in the Skills panel, <div class="form-inline"><div class="form-group">
 *  <span class="twitter-typeahead"><input type="text" class="form-control focus-on-edit typeahead-control tt-input"
 *  maxlength="80" required="" data-automation="item-typeahead" aria-label="Skills" ...></span></div><button
 *  type="button" class="btn btn-default add-button" data-automation="item-add-button" disabled="">Add</button></div>,
 *  each skill held a chip: <div data-automation="selected-item" ...><span><div data-automation="skill" class="skill">
 *  <div class="form-group"><strong data-automation="skill-label">...</strong>) takes several skills one at a time:
 *  typed, then its row's Add pressed, the chips read again (Jobright 1.25.2's UltiPro fillSkills). Its kind is the
 *  typeahead it is drawn as; the tags filler (ENGINE E3) reads it as one text field. Null for any other control. The
 *  application layout's Skills (behind "Edit Skills") is declared alike, and waits with U-14 for its editor. */
function skillsBox(control: Element): WidgetDecl | null {
  if (!control.matches('input[data-automation="item-typeahead"]')) return null;
  const region = skillsRegion(control);
  if (region === null) return null;
  const row = control.closest('div.form-inline');
  return {
    kind: 'typeahead-remote',
    opener: control as HTMLElement,
    tags: {
      chips: () => {
        const cache = newScanCache();
        return Array.from(region.querySelectorAll('strong[data-automation="skill-label"]'))
          .filter((chip) => isUserVisible(chip, cache));
      },
      add: () => {
        const button = row?.querySelector<HTMLElement>('button[data-automation="item-add-button"]') ?? null;
        return button !== null && isUserVisible(button) ? button : null;
      },
    },
    snapshot: 'ultipro-1',
  };
}
// ── end jr6 ULTIPRO P1 (U-04, U-05) ──

// ── jr6 ULTIPRO P1: the review's entries (FIXPLAN §6.10 item 1, U-01) ──
/** The review's Work Experience and Education panels (ultipro-1: <div data-automation="work-experience-section"
 *  data-bind="with: workExperienceViewModel"><multi-edit-only-panel><collapsible-panel><div role="region" ...
 *  aria-label="Work Experience"> ... <button data-automation="primary-action-button" ... aria-label="Add Experience">
 *  ... <div data-automation="panel-list-item" role="form" class="row" aria-label="Work Experience 1"><button
 *  data-automation="remove-button" class="btn btn-default pull-right" aria-label="Delete Work Experience 1"> ... <div
 *  data-automation="work-experience-item"> its Job Title, Company / Organization, Location, From, To and Description;
 *  data-automation="education-section" the same, "Add Education", "Education 1"). */
const REVIEW_SECTIONS = [
  { kind: 'experience', css: `${REVIEW} div[data-automation="work-experience-section"]` },
  { kind: 'education', css: `${REVIEW} div[data-automation="education-section"]` },
] as const;
const REVIEW_BLOCK = 'div[data-automation="panel-list-item"][role="form" i]';

/** jr6 U-01: the review's two panels as repeatable sections, each block one parsed entry, so the planner finds the
 *  profile entry each holds by its fingerprint (core/steps/blocks.ts) and never writes job 1 into every block. Their
 *  Add is never offered (addButton null): adding, deleting or editing the parser's entries waits for owner question Q1
 *  (Decision 16). A block's own Delete is its removeButton, pressed by no run (ENGINE's gated door alone, after Q1).
 *  Jobright reconciles the parsed rows with the profile by "title, company" and deletes the others
 *  (removeUltiproSavedEntriesOutsideFillV2). None in the application layout (its entries are summaries: U-03). */
function reviewRepeatables(root: Element): ReturnType<NonNullable<Adapter['repeatables']>> {
  return REVIEW_SECTIONS.flatMap(({ kind, css }) => {
    const section = root.matches(css) ? root : root.querySelector(css);
    if (section === null) return [];
    return [{
      kind,
      blocks: () => Array.from(section.querySelectorAll(REVIEW_BLOCK)),
      addButton: () => null,
      removeButton: (block: Element) => {
        // ultipro-1: one per block, in its pull-right column (<div class="col-xs-6 col-sm-4 col-md-2 pull-right">).
        const buttons = Array.from(block.querySelectorAll<HTMLElement>('button[data-automation="remove-button"]'));
        return buttons.length === 1 && isUserVisible(buttons[0]!) ? buttons[0]! : null;
      },
    }];
  });
}
// ── end jr6 ULTIPRO P1 (U-01) ──

// ── jr6 ULTIPRO P1: the phone boxes (FIXPLAN §6.10 item 9, U-16, adapter part) ──
/** The phone boxes (ultipro-0, -1: <input type="tel" id="Phone" data-automation="primary-phone-number-textbox"
 *  maxlength="25" autocomplete="tel">, <input type="tel" id="SecondaryPhone" ...>; ultipro-2: the account step's
 *  <ukg-input ... name="phoneNumber" maxlength="15"><input type="tel" name="phoneNumber" maxlength="15" ...>). */
const PHONE_BOXES = 'input#Phone[type="tel" i], input#SecondaryPhone[type="tel" i], '
  + 'form#registrationDetailsForm input[name="phoneNumber"][type="tel" i]';
/** jr6 U-16: the national number's ten digits (core/resolver/format.ts phoneText lays a number's national digits into
 *  a pattern with as many slots; a number whose national part is not ten digits stays as the person wrote it). Jobright
 *  writes every UltiPro phone answer as the national number (UltiPro answer, formatAnswer: toNationalPhoneValue). */
export const ULTIPRO_PHONE_PATTERN = '##########';
// ── end jr6 ULTIPRO P1 (U-16) ──

const hooks = configuredHooks(ULTIPRO_CONFIG);

// ── snapshot build 2026-11-06 (core pass Z1, item 24) ──
/** The account step's form (ultipro-2: <form method="post" id="registrationDetailsForm" ...>, the register state's root). */
const REGISTER_FORM = 'body.authcode-controller form#registrationDetailsForm';
/** Its Create account, outside the form (ultipro-2: <ukg-button type="submit" form="registrationDetailsForm"
 *  data-automation="registrationDetails-submit-button" class="btn-create-account ..."><template shadowrootmode="open">
 *  <button aria-label="Create account" class="ukg-button-native" part="native" type="submit" role="button">): the native
 *  button its open shadow root draws, the face a person's click lands on, whose click reaches the host as theirs does. */
const CREATE_ACCOUNT = 'ukg-button[data-automation="registrationDetails-submit-button"][form="registrationDetailsForm"]';

/** The register state's sign-in container (Adapter.signInContainer): the account step's form, its Create account the
 *  button, no box of its own (Sign-in Auto types nothing there: the step's names and phone come from the profile). Null
 *  on any other page, or while the form or the button's face is not shown. */
function registerContainer(doc: Document): SignInForm | null {
  const cache = newScanCache();
  const container = doc.querySelector(REGISTER_FORM);
  if (container === null || !isUserVisible(container, cache)) return null;
  const host = doc.querySelector(CREATE_ACCOUNT);
  const button = host?.shadowRoot?.querySelector<HTMLElement>('button.ukg-button-native[type="submit"]') ?? null;
  if (button === null || !isUserVisible(button, cache)) return null;
  // jr7 ULTIPRO-7 (FIX7PLAN §6.8 item 4, UP7-04, after UP7-V1 as O-6 orders it; with ENGINE-7 E1 item 8): the privacy
  // box, the account's one term, ticked per the Consents mode as other account terms are (FIX7PLAN §5 D-9); and Create
  // account, disabled on both tenants' captures with the step empty, enabled by the page once the step is filled.
  const privacy = container.querySelector<HTMLElement>(PRIVACY_BOX);
  return { email: null, password: null, confirm: null, terms: privacy === null ? [] : [privacy], button, container,
    enablesWhenFilled: true };
}
// ── end core pass Z1, item 24 ──

// ── jr7 ULTIPRO-7 (FIX7PLAN §6.8) ──
/** UP7-04: the account step's privacy box (snapshot7 ultipro1's tenant, jr7-ultipro1-register: <div
 *  class="register-privacy-consent"><ukg-checkbox data-automation="registrationDetails-privacy-checkbox"
 *  aria-checked="false" class="reg-consent-checkbox ..." tabindex="0" role="checkbox"> with no native input, beside
 *  <span data-automation="quick-apply-terms-conditions"> (by checking this box, I have read and agree to the Privacy
 *  Policy); ultipro2's tenant draws none). An ARIA checkbox no plan writes: SignInForm.terms takes it inside the
 *  declared container (ENGINE-7 E1 item 8). */
const PRIVACY_BOX = 'ukg-checkbox[data-automation="registrationDetails-privacy-checkbox"][role="checkbox" i]';

/** UP7-V1: the account step's boxes (jr7-ultipro1-register, -2-register; the 2026-11-06 register.html): each native
 *  <input class="ukg-native-input" ...> sits in a scoped <ukg-input slot="input"> > div.input-inner-container, slotted
 *  into a <ukg-field data-automation="registrationDetails-<name>-field">, whose open shadow root draws the field:
 *  <div class="ukg-field-container"> with its slots. */
const REGISTER_INPUT = 'form#registrationDetailsForm input.ukg-native-input';

/** UP7-V1 (the verifier's measure): the element that draws an account-step box (Adapter.controlBox): its ukg-field's
 *  shadow .ukg-field-container, where UKG's field component draws the box (the captures keep none of its adopted
 *  styles, so in them it draws none and the box stays camouflaged: fail-closed); null for any other control.
 *  dom/camouflage.ts drawnByWrapper walks the light parents alone and never reaches it. */
function registerBoxOf(control: Element): Element | null {
  if (!control.matches(REGISTER_INPUT)) return null;
  return control.closest('ukg-field')?.shadowRoot?.querySelector('.ukg-field-container') ?? null;
}

/** UP7-03: the EEO lists (jr7-ultipro1-apply-1, -2-apply-1: #CountryQuestions' <div class="form-group"> holding <label
 *  class="control-label required" for="Gender">, <select id="Gender" ... required=""> and <div class="checkbox"><label>
 *  <input type="checkbox" data-automation="gender-decline-checkbox" ...>; Ethnic Origin, Race and the veteran list the
 *  same) whose own group's decline box is ticked now: read at each scan, so a list holds no question while its box is
 *  ticked, and Submit Auto's required count leaves it (the select keeps required="" and has no disable binding). The
 *  decline boxes stay fields (U-09). As Jobright answers a declined list: its box ticked and the list left empty (its
 *  UltiPro operations, fillMultiSelectField). */
function declinedLists(root: Element): Element[] {
  return Array.from(root.querySelectorAll<HTMLSelectElement>('#CountryQuestions div.form-group > select'))
    .filter((select) => select.parentElement?.querySelector<HTMLInputElement>(
      ':scope > div.checkbox input[type="checkbox" i][data-automation$="-decline-checkbox"]')?.checked === true);
}

/** UP7-12: the data-use consent's radios (jr7-ultipro2-apply-1: <div class="form-group col-xs-24"
 *  data-automation="copy-applicants-consent-question"><label id="CopyApplicantsConsentQuestion"
 *  data-automation="copy-applicants-consent-label" class="control-label"> with no for, then <div class="radio"><label>
 *  <input type="radio" name="copyApplicantsConsent" ...><span>Yes</span>, No the same): their question, or null. */
function consentQuestionOf(control: Element): Element | null {
  if (!control.matches('[data-automation="copy-applicants-consent-question"] input[type="radio" i]')) return null;
  return control.closest('[data-automation="copy-applicants-consent-question"]')
    ?.querySelector(':scope > label.control-label') ?? null;
}

/** UP7-02 (minimum; owner question Q7-9, default: the person signs in): UKG's candidate sign-in, where both tenants'
 *  Apply leads before the Register (signin-us.ultipro.com /u/login and /u/signup in snapshot7 ultipro1 and ultipro2),
 *  and another region's signin-<x>.ultipro.com. Nothing of ours runs there (shared/hosts.ts: an HR host, no static
 *  match); AUTO-7 reads these hosts (FIX7PLAN §6.4 item 6). */
export const ULTIPRO_IDENTITY_HOSTS: readonly RegExp[] = [/^signin(?:-[a-z0-9]+)?\.ultipro\.com$/];

/** UP7-07 (P2): whether the documents dialog after Submit shows (the documents-dialog state's own `when`:
 *  jr7-ultipro1-apply-11's div#AttachmentsChangedModal[role=dialog], display: block). */
function documentsDialogShown(doc: Document): boolean {
  const cache = newScanCache();
  return Array.from(doc.querySelectorAll(DOCUMENTS_DIALOG_CSS)).some((dialog) => isUserVisible(dialog, cache));
}
// ── end jr7 ULTIPRO-7 ──

/** The UltiPro adapter. */
export const ultiproAdapter: Adapter = {
  ...hooks,
  id: 'ultipro',
  matchesUrl,
  canonicalApplicationUrl,
  signInContainer: registerContainer,
  // The behaviour review of 2026-11-06 (minor 2): the account step, its form and Create account shown, leads on to the
  // application: not its last step (the configured layer reads its states' own containers the same way). Create account
  // is Sign-in mode's (signInContainer), never Next's: the state names no Next.
  isFinalStep: (doc) => (registerContainer(doc) !== null ? 'not-final' : hooks.isFinalStep?.(doc) ?? 'unknown'),
  labelFor: (control) => startDateLabel(control) ?? periodLabels(control)?.group ?? declineLabels(control)?.question
    ?? skillsTitle(control) ?? consentQuestionOf(control) ?? hooks.labelFor?.(control) ?? null,
  labelSuffix(control) {
    const part = periodLabels(control)?.part ?? declineLabels(control)?.own ?? null;
    if (part === null) return null;
    const words = wordsOf(part);
    return words === '' ? null : words;
  },
  // jr6 U-02, U-09: a period box's or a decline box's own label is only its part's words ("Month", "I decline to say"):
  // the adapter's label, its group's or its list's question with those words, is read first.
  labelFirst: (control) => periodLabels(control) !== null || declineLabels(control) !== null,
  // jr6 U-04, U-05.
  widgetFor: (control) => educationSearch(control) ?? skillsBox(control) ?? hooks.widgetFor?.(control) ?? null,
  // jr6 U-07.
  dateFor: (control) => datePartsOf(control) ?? hooks.dateFor?.(control) ?? null,
  // jr7 ULTIPRO-7: UP7-V1's account-step boxes; UP7-03's declined lists.
  controlBox: (control) => dateBoxOf(control) ?? registerBoxOf(control) ?? hooks.controlBox?.(control) ?? null,
  excluded: (root) => [...(hooks.excluded?.(root) ?? []), ...datePartBoxes(root), ...declinedLists(root)],
  // jr6 U-01.
  repeatables: (root) => [...(hooks.repeatables?.(root) ?? []), ...reviewRepeatables(root)],
  // jr6 U-16.
  formatFor: (control) => (control.matches(PHONE_BOXES) ? { format: 'tel', pattern: ULTIPRO_PHONE_PATTERN }
    : hooks.formatFor?.(control) ?? null),
  // ── jr7 ULTIPRO-7 (FIX7PLAN §3.1 hooks) ──
  // UP7-01: the page after submitting the armed application (url.ts).
  confirmationAfter,
  // UP7-02: UKG's sign-in hosts.
  identityHosts: ULTIPRO_IDENTITY_HOSTS,
  // UP7-07 (P2; E2's HandOverKind 'documents'; owner question Q7-8's default): the documents dialog after Submit is the
  // person's: the agent and the Queue tab leave it to them, and the arm waits for the confirmation it leads to.
  handOver: (doc) => (documentsDialogShown(doc) ? 'documents' : null),
  // ── end jr7 ULTIPRO-7 ──
};
