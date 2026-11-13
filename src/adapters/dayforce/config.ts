/*
 * Dayforce's configured adapter (DESIGN-NEW-ATS §1 "Dayforce", §5 builder A): the rules of a guest ("manual")
 * application on jobs.dayforcehcm.com, read from the owner's three snapshots of 2026-11-06, one session's three steps,
 * converted as fixtures/dayforce/*.html: dayforce-2 candidate-info.html (step 1, Candidate Info, after Import Resume),
 * dayforce-0 questionnaire.html (step 2, Next just pressed: its loading state) and dayforce-1 submit-challenge.html
 * (step 3, Submit just pressed, the reCAPTCHA image challenge open). The page is Next.js with Ant Design; nearly every
 * block carries a test-id. Every rule names its snapshot.
 * - Root: div#jobPostingApplication (an .ant-form), holding the shown step's [test-id^=application-step-]; the step's
 *   <form>s are per block, and the steps bar, Cancel, Previous, Next and Submit sit outside it.
 * - Steps: the step body's test-id (application-step-candidateinfo, -questionnaire, -submit) and the steps bar's item
 *   marked aria-current="step", the step's h1 and the questionnaire's "Questionnaire 1 of 1"; Next
 *   [test-id=application-next-step] (loading: .ant-btn-loading, the busy sign), Submit [test-id=application-submit]
 *   only on the last step, where Next is not; Previous never pressed.
 * - Labels: label[for] works for the personal information's boxes and selects and the text question. A radio
 *   question's title is the label.ant-form-item-label's label in its li[test-id=question-item]'s fieldset, whose for=
 *   names the radio group's div and whose legend is drawn off-screen (questions rule). The dial-code selects are
 *   labelled only "Country dialing code": each is its phone's ("Home Phone Number country code", code: labelFor and
 *   labelSuffix). The three uploads are titled by their section's h2 (Resume Upload, Cover Letter, Additional
 *   Documents): the résumé's label[for] names the Import Resume parser's input, which shares its id.
 * - Required: label.ant-form-item-required (Ant draws the star in CSS) besides aria-required.
 * - Widgets: Ant selects (input.ant-select-selection-search-input[role=combobox] in div.ant-select), their box
 *   .ant-select-selector (a select-only one's text box is readonly and drawn at opacity 0), opened from the selector,
 *   aria-expanded on the input; their list is portalled to the body's end and virtual, and no snapshot shows one open.
 *   Ant radios and the acknowledgement box are drawn over opacity-0 inputs: their wrapping label stands for them, and
 *   the wrapper's class shows them chosen (checked).
 * - Uploads: each section[test-id$=-upload-section]'s file input and its button; the résumé's list shows a file taken
 *   as .ant-upload-list-item-done. Import Resume (the résumé parser, div[test-id=import-resume-section]) is excluded and
 *   never pressed.
 * - Never pressed: Cancel, Import Resume, Personal Information's Update and Cancel, a record's Edit and Delete, Remove
 *   file, Sign In, Cookie Preferences and the steps bar's items.
 * - The invisible reCAPTCHA (div.grecaptcha-badge) raises an image challenge on Submit (dayforce-1): it is the person's
 *   (dom/pause-detect.ts reads its frame; the agent and Submit mode hold while it shows).
 * The posting page, the confirmation, the record editors (Add, Edit) and every error are in no snapshot.
 * jr7 DFPC-7 (SP\jr7\FIX7PLAN.md §6.11; the owner's snapshot7 dayforce1, one guest application's posting, its way-to-apply
 * choice and six captures of step 1, converted as fixtures/dayforce/jr7-dayforce1-*.html):
 * - DF7-01: the posting's Apply, button[test-id=apply-button], is its entry (posting.entry), pressed only by the entry
 *   door (Jobright 1.25.2 ~contents/sites/dayforce/entry-preflow createDayforceEntryAdapter, read as its behaviour);
 * - DF7-02: its …/apply page, [test-id=flow-selection-page], is an entry choice whose entry is "Apply without an Account"
 *   (state apply-choice); its Sign In and "Create one now." are never pressed; quirks.entryPresses 2, so one agent/enter
 *   presses Apply, then the choice it routes to in the same document (the same createDayforceEntryAdapter);
 * - AUTO7-13 (⊃ DF7-01, DF7-02): Next and Submit stay the snapshots' (button[test-id=application-next-step],
 *   button[test-id=application-submit], as Jobright's DAYFORCE_ADVANCE_BUTTON_SELECTOR and its dayforce submission rule
 *   name them);
 * - DF7-03: the page after submitting draws [test-id=application-successfullsubmission-message] or its
 *   -with-confirmation-number twin (success; Jobright's m/ats-rules.js `dayforce` rule, any words, route /apply/success,
 *   which ./url.ts reads as the confirmation already); no capture shows it (owner question Q7-1);
 * - DF7-05 (corrected by the verifier): Education History and Employment History are repeatable sections
 *   ([test-id=education-history], [test-id=work-history]), each form[test-id=educationhistory-record] or
 *   workhistory-record a block, filled in place: an open editor is an entry's block, a saved card (its
 *   [test-id*=-read-] words, no field) one the planner matches by its words (prefill.readEntries), never filled again;
 *   no record is added (Add is never offered: Decision 16, owner question Q7-11), and each editor's Update is declared
 *   its Save but is a form submit the click door refuses (DF7-V4: the block-form save door is ENGINE-7's, off until the
 *   live check), so an editor left open is the person's to finish. The Reference editor is no repeatable: its boxes are
 *   no profile's, and its Cancel is never pressed (Q7-11);
 * - DF7-V2: the résumé input is the site's import (the parser's and Resume Upload's inputs share an id; after it the
 *   editors become saved cards): quirks.resumeParse, the résumé written first and its parse waited for (Jobright's
 *   uploadResumeBeforeRegularFields);
 * - identityHosts: dfid.dayforcehcm.com, where its Sign In and Create account lead (Jobright's dayforceIdentity site,
 *   m/ats-rules.js L10).
 */
import { configuredHooks } from '../configured';
import type { AtsConfig, ConfiguredHooks } from '../configured/types';
import type { PrefillEntryView } from '../types'; // jr7 DFPC-7
import { matchesUrl, parseDayforceUrl } from './url';

/** The step body (dayforce-0 to -2): <div class="mt-5" test-id="application-step-candidateinfo|questionnaire|submit">. */
const STEP_BODY = '#jobPostingApplication [test-id^="application-step-"]';
/** The three upload sections (dayforce-2): <section test-id="resume-upload-section">, cover-letter-, additional-documents-. */
const UPLOAD_SECTIONS = ['resume', 'cover-letter', 'additional-documents'] as const;

// ── jr7 DFPC-7 (the header's jr7 list) ──
/** The snapshot7 cases the jr7 rules were read from (fixtures/dayforce/<case>.html). */
export const DAYFORCE_JR7_CASES = ['jr7-dayforce1-posting', 'jr7-dayforce1-choice', 'jr7-dayforce1-apply-1',
  'jr7-dayforce1-apply-2', 'jr7-dayforce1-apply-3', 'jr7-dayforce1-apply-4', 'jr7-dayforce1-apply-5',
  'jr7-dayforce1-apply-6'] as const;
/** DF7-05: the two repeatable sections and their blocks (jr7-dayforce1-apply-1 to -6): <div test-id="education-history">
 *  holding <form id="educationHistory-<n>" test-id="educationhistory-record"> (an open editor, or a saved card), and
 *  <div test-id="work-history"> holding <form id="workHistory-<n>" test-id="workhistory-record">; each editor's
 *  <button type="submit" test-id="educationHistory-update-button">Update</button> (workHistory-). */
const HISTORY = [
  { kind: 'education', section: '[test-id="education-history"]', block: 'form[test-id="educationhistory-record"]',
    save: 'button[test-id="educationHistory-update-button"]' },
  { kind: 'experience', section: '[test-id="work-history"]', block: 'form[test-id="workhistory-record"]',
    save: 'button[test-id="workHistory-update-button"]',
    // jr7-dayforce1-apply-1: <input id="jobPostingApplication_workHistory_0_isCurrent" type="checkbox"
    // test-id="work-history-currentjob-checkbox"> "Current Job".
    currentlyHere: 'input[test-id="work-history-currentjob-checkbox"]' },
] as const;
// ── end jr7 DFPC-7 ──

/** The rules, each naming its snapshot (see the header). */
const RULES: AtsConfig = {
  platform: 'dayforce',
  ...(__PROVENANCE__ && { snapshots: ['candidate-info', 'questionnaire', 'submit-challenge', ...DAYFORCE_JR7_CASES] }),
  parse: parseDayforceUrl,
  matchesUrl,
  // ── jr7 DFPC-7 DF7-02 ──
  states: [
    // jr7-dayforce1-choice (…/jobs/<id>/apply?…&flowSelection): <div test-id="flow-selection-page"> … <button
    // test-id="apply-without-account" …>Apply without an Account</button> … <button
    // test-id="logged-out-content-signin-button">Sign In</button> … <a test-id="logged-out-content-register">Create one
    // now.</a>: the way to apply, its entry the guest application (createDayforceEntryAdapter presses the same one).
    { name: 'apply-choice', when: '[test-id="flow-selection-page"]', auth: 'entry-choice',
      entry: 'button[test-id="apply-without-account"]', ...(__PROVENANCE__ && { from: 'jr7-dayforce1-choice' }) },
  ],
  // ── end jr7 DFPC-7 DF7-02 ──
  // dayforce-0 to -2: <div id="jobPostingApplication" class="ant-form ant-form-vertical css-59ygyz"><div class="mt-5"
  // test-id="application-step-...">.
  root: { css: 'div#jobPostingApplication', holds: '[test-id^="application-step-"]',
    ...(__PROVENANCE__ && { from: 'dayforce-0, dayforce-1, dayforce-2' }) },
  questions: [
    // dayforce-0: <li test-id="question-item"><fieldset aria-labelledby=":r3m:"><div class="ant-col ..."><legend
    // id=":r3m:" ...><span class="ant-typography absolute -left-[9999] overflow-hidden h-0 ...">(the question)</span>
    // </legend><div class="ant-form-item ..."><div test-id="questionnaire-..." class="ant-row ant-form-item-row ..."><div
    // class="ant-col ant-form-item-label ..."><label for="jobPostingApplication_sections_0_questionnaire_questions_0_
    // selectedOption" class="" title=""><div class="sanitized-html w-full">(the question)</div></label></div> ... <div
    // class="ant-radio-group ..." id="..._selectedOption">.
    { container: 'li[test-id="question-item"] fieldset', title: '.ant-form-item-label > label',
      ...(__PROVENANCE__ && { from: 'dayforce-0' }) },
  ],
  // dayforce-2: <label for="jobPostingApplication_personalInfo_firstName" class="ant-form-item-required" title="First
  // Name">First Name</label>.
  required: [{ is: 'label.ant-form-item-required', ...(__PROVENANCE__ && { from: 'dayforce-2' }) }],
  widgets: [
    // dayforce-2: <div class="ant-select ant-select-in-form-item css-59ygyz ant-select-single ant-select-show-arrow"
    // test-id="personal-info-prefixid-dropdown"><div class="ant-select-selector"><span
    // class="ant-select-selection-search"><input type="search" id="jobPostingApplication_personalInfo_prefixId"
    // class="ant-select-selection-search-input" role="combobox" aria-expanded="false"
    // aria-controls="jobPostingApplication_personalInfo_prefixId_list" readonly="" value="" style="opacity: 0;"></span>
    // ...: a select-only list, its box drawn by .ant-select-selector.
    { match: 'div.ant-select input.ant-select-selection-search-input[role="combobox" i][readonly]', kind: 'combobox',
      opener: '.ant-select-selector', expanded: 'input', box: '.ant-select-selector', readOnlyBox: true,
        ...(__PROVENANCE__ && { from: 'dayforce-2' }) },
    // dayforce-2: Country, State/Province and the dial codes (.ant-select-show-search): the same, typeable.
    { match: 'div.ant-select input.ant-select-selection-search-input[role="combobox" i]:not([readonly])', kind: 'combobox',
      opener: '.ant-select-selector', expanded: 'input', box: '.ant-select-selector',
        ...(__PROVENANCE__ && { from: 'dayforce-2' }) },
  ],
  checked: [
    // dayforce-0: <label class="ant-radio-wrapper ant-radio-wrapper-in-form-item css-59ygyz"><span class="ant-radio
    // ant-wave-target"><input aria-required="false" name="sections,0,questionnaire,questions,0,selectedOption"
    // class="ant-radio-input" type="radio" value="41"><span class="ant-radio-inner"></span></span><span>Yes</span>
    // </label>; chosen, the label's ant-radio-wrapper-checked.
    { input: 'label.ant-radio-wrapper input.ant-radio-input', holder: 'label.ant-radio-wrapper',
      chosen: '.ant-radio-wrapper-checked', ...(__PROVENANCE__ && { from: 'dayforce-0' }) },
    // dayforce-1: <label class="ant-checkbox-wrapper ..."><span class="ant-checkbox ..."><input
    // id="jobPostingApplication_userAcknowledged" class="ant-checkbox-input" type="checkbox"
    // test-id="user-acknowledged-checkbox"></span><span>I agree to the Candidate Acknowledgement</span></label>; ticked,
    // ant-checkbox-wrapper-checked.
    { input: 'label.ant-checkbox-wrapper input.ant-checkbox-input', holder: 'label.ant-checkbox-wrapper',
      chosen: '.ant-checkbox-wrapper-checked', ...(__PROVENANCE__ && { from: 'dayforce-1' }) },
  ],
  uploads: [
    // dayforce-2: <section test-id="resume-upload-section"> ... <input id="jobPostingApplication_files_resume"
    // type="file" accept="doc,docx,pdf,rtf" style="display: none;"><button ... test-id="resume-upload-button"
    // type="button" ...>Import Resume</button> ... <div class="ant-upload-list ant-upload-list-text"><div
    // class="ant-upload-list-item-container"><div class="w-44" test-id="upload-file-item-test"><div
    // class="ant-upload-list-item ant-upload-list-item-done"> ...: the id is the parser's too (the first in the page).
    { input: 'section[test-id="resume-upload-section"] input[type="file" i]', control: 'button[test-id="resume-upload-button"]',
      area: 'section[test-id="resume-upload-section"]', done: '.ant-upload-list-item-done',
      // The behaviour review of 2026-11-06 (M2), dayforce-2: <span class="ant-upload-list-item-name" title="(the file's
      // name)">(the file's name)</span> in the done item.
      name: 'span.ant-upload-list-item-name', ...(__PROVENANCE__ && { from: 'dayforce-2' }) },
    // dayforce-2: <section test-id="cover-letter-upload-section"> ... <input id="jobPostingApplication_files_coverLetter"
    // type="file" ...><button ... test-id="cover-letter-upload-button" ...>Add Cover Letter</button>; and
    // additional-documents-upload-section's "Add Additional Documents". No file was put in either.
    { input: 'section[test-id="cover-letter-upload-section"] input[type="file" i]',
      control: 'button[test-id="cover-letter-upload-button"]', area: 'section[test-id="cover-letter-upload-section"]',
      ...(__PROVENANCE__ && { from: 'dayforce-2' }) },
    { input: 'section[test-id="additional-documents-upload-section"] input[type="file" i]',
      control: 'button[test-id="additional-documents-upload-button"]',
      area: 'section[test-id="additional-documents-upload-section"]', ...(__PROVENANCE__ && { from: 'dayforce-2' }) },
  ],
  steps: {
    // dayforce-2: <h1 ... test-id="application-step-title">Candidate Info</h1>; dayforce-0: <span ...
    // test-id="questionnaire-progress">Questionnaire 1 of 1</span>; every step: <div aria-current="step"
    // test-id="application-progress-step-Questionnaire" class="ant-steps-item ant-steps-item-process ...">.
    heading: 'h1[test-id="application-step-title"]',
    progress: 'span[test-id="questionnaire-progress"]',
    anchors: [{ css: STEP_BODY, attr: 'test-id' },
      { css: '[test-id^="application-progress-step-"][aria-current="step"]', attr: 'test-id' }],
    // dayforce-2, -0: <button test-id="application-next-step" type="button" class="ant-btn ...">.
    next: 'button[test-id="application-next-step"]',
    // dayforce-0, -1: <button test-id="application-previous-step" type="button" ...>.
    back: 'button[test-id="application-previous-step"]',
    ...(__PROVENANCE__ && { from: 'dayforce-0, dayforce-1, dayforce-2' }),
  },
  // dayforce-1: <button test-id="application-submit" type="button" class="ant-btn ...">, in Next's place.
  submit: { css: 'button[test-id="application-submit"]', ...(__PROVENANCE__ && { from: 'dayforce-1' }) },
  neverPress: [
    { css: 'button[test-id="application-cancel"]',
      ...(__PROVENANCE__ && { from: 'dayforce-0, dayforce-1, dayforce-2' }) },
    // The résumé parser: <button tabindex="0" role="presentation" test-id="import-resume-section-button" ...>.
    { css: 'button[test-id="import-resume-section-button"]', ...(__PROVENANCE__ && { from: 'dayforce-2' }) },
    // Personal Information's own <button ... test-id="personal-info-update-button" type="submit">Update</button> and
    // <button ... test-id="personal-info-cancel-button" type="reset">Cancel</button>.
    { css: 'button[test-id="personal-info-update-button"], button[test-id="personal-info-cancel-button"]',
      ...(__PROVENANCE__ && { from: 'dayforce-2' }) },
    // A record's <button aria-label="Edit Employment History record" test-id="workHistory-edit-button" ...> and
    // "Delete ..." (education's educationHistory-*), and an upload's <button title="Remove file" ...>.
    { css: 'button[test-id$="History-edit-button"], button[test-id$="History-delete-button"]',
      ...(__PROVENANCE__ && { from: 'dayforce-2' }) },
    { css: '.ant-upload-list-item-actions button[title="Remove file"]', ...(__PROVENANCE__ && { from: 'dayforce-2' }) },
    // The header's <div test-id="header-sign-in"><a href="...#">Sign In</a></div>, the footer's <a
    // test-id="cookie-prefs-link">, and the steps bar's items (<div class="ant-steps-item-container" role="button">).
    { css: 'div[test-id="header-sign-in"] a, a[test-id="cookie-prefs-link"]',
      ...(__PROVENANCE__ && { from: 'dayforce-2' }) },
    { css: '.ant-steps-item-container[role="button" i]', ...(__PROVENANCE__ && { from: 'dayforce-0' }) },
    // ── jr7 DFPC-7 ──
    // DF7-02, jr7-dayforce1-choice: the choice's Sign In and "Create one now." (an account at dfid.dayforcehcm.com).
    { css: 'button[test-id="logged-out-content-signin-button"], a[test-id="logged-out-content-register"]',
      ...(__PROVENANCE__ && { from: 'jr7-dayforce1-choice' }) },
    // DF7-05, jr7-dayforce1-apply-1 to -6: a record's Add (<button test-id="add-educationhistory-record">,
    // add-workhistory-record, add-reference-record), an editor's Cancel (<button test-id="educationHistory-cancel-button"
    // type="reset">, workHistory-, reference-), the Reference editor's Update, and the read view's <button
    // test-id="personal-info-edit-button">: no record is added, edited or dropped by a run (Decision 16, Q7-11).
    { css: 'button[test-id="add-educationhistory-record"], button[test-id="add-workhistory-record"], '
      + 'button[test-id="add-reference-record"]', ...(__PROVENANCE__ && { from: 'jr7-dayforce1-apply-1' }) },
    { css: 'button[test-id="educationHistory-cancel-button"], button[test-id="workHistory-cancel-button"], '
      + 'button[test-id="reference-cancel-button"], button[test-id="reference-update-button"]',
        ...(__PROVENANCE__ && { from: 'jr7-dayforce1-apply-1' }) },
    { css: 'button[test-id="personal-info-edit-button"]', ...(__PROVENANCE__ && { from: 'jr7-dayforce1-apply-3' }) },
    // ── end jr7 DFPC-7 ──
  ],
  // dayforce-2: <div test-id="import-resume-section" ...> (Import Resume, its file input and its list).
  excluded: [{ css: 'div[test-id="import-resume-section"]', ...(__PROVENANCE__ && { from: 'dayforce-2' }) }],
  // dayforce-0: <button test-id="application-next-step" type="button" class="ant-btn ... ant-btn-loading">.
  busy: [{ css: 'button[test-id="application-next-step"].ant-btn-loading',
    ...(__PROVENANCE__ && { from: 'dayforce-0' }) }],
  // ── jr7 DFPC-7 ──
  // DF7-01, jr7-dayforce1-posting (…/jobs/<id>): <button … test-id="apply-button" aria-label="Apply for …">Apply</button>,
  // the one entry (createDayforceEntryAdapter: the one shown, enabled apply-button); the posting's own text <div
  // test-id="job-detail-body">.
  posting: { entry: 'button[test-id="apply-button"]', text: '[test-id="job-detail-body"]',
    ...(__PROVENANCE__ && { from: 'jr7-dayforce1-posting' }) },
  // DF7-03: Jobright 1.25.2's m/ats-rules.js `dayforce` rule (dayforce-application-submitted, read as its behaviour):
  // either message, with any words, drawn after Submit (its route, …/apply/success, ./url.ts reads as the
  // confirmation). No capture shows it (owner question Q7-1): dayforce-jr7.browser.test.ts holds it on a page of our own.
  success: { css: '[test-id="application-successfullsubmission-message"], '
    + '[test-id="application-successfullsubmission-message-with-confirmation-number"]', text: /\S/,
  ...(__PROVENANCE__ && { from: 'Jobright 1.25.2 m/ats-rules.js dayforce-application-submitted' }) },
  // DF7-02: Apply, then the choice it routes to in the same document (createDayforceEntryAdapter); DF7-V2: the résumé
  // first, its import waited for (Jobright's uploadResumeBeforeRegularFields), jr7-dayforce1-apply-1 → -apply-2.
  quirks: { entryPresses: 2, resumeParse: true },
  // ── end jr7 DFPC-7 ──
};

/** The rule-built hooks the code below falls back to. */
const ruled = configuredHooks(RULES);

/** A dial-code select's phone box: the input.ant-input after it in their .ant-space-compact (dayforce-2). */
function phoneOf(control: Element): HTMLInputElement | null {
  // dayforce-2: <div class="ant-space-compact ..."><div class="ant-select ..." test-id="personal-info-home-phone-dropdown"
  // aria-label="Country dialing code"> ... <input type="search" ... role="combobox" ... aria-label="Country dialing
  // code" ... id="rc_select_4"> ... </div><input test-id="personal-info-home-phone-text-input"
  // id="jobPostingApplication_personalInfo_homePhone" class="ant-input ..." type="text" value=""></div>.
  if (!control.matches('div.ant-space-compact > div.ant-select input[role="combobox" i]')) return null;
  return control.closest('div.ant-space-compact')?.querySelector<HTMLInputElement>(':scope > input.ant-input') ?? null;
}

/** An upload's section heading (dayforce-2: <h2 ... test-id="resume-upload-title">Resume Upload</h2>, cover-letter-,
 *  additional-documents-). */
function uploadTitle(control: Element): Element | null {
  for (const name of UPLOAD_SECTIONS) {
    const section = control.closest(`section[test-id="${name}-upload-section"]`);
    if (section !== null && control.matches('input[type="file" i]')) return section.querySelector(`h2[test-id="${name}-upload-title"]`);
  }
  return null;
}

/** The phone's label for its dial code, an upload's section heading, else the rules' question title. */
function labelFor(control: Element): Element | null {
  const phone = phoneOf(control);
  if (phone !== null) return phone.labels?.[0] ?? null;
  return uploadTitle(control) ?? ruled.labelFor?.(control) ?? null;
}

/** "country code" after a dial code's phone label. */
function labelSuffix(control: Element): string | null {
  return phoneOf(control) === null ? null : 'country code';
}

// ── jr7 DFPC-7 DF7-05 (the header's jr7 list) ──
/** A block that holds no control a person types into: a saved card (jr7-dayforce1-apply-2: <form id="workHistory-0"
 *  test-id="workhistory-record"> holding only its [test-id*="-read-"] words and its Edit and Delete). */
const isCard = (block: Element) => block.querySelector('input, textarea, select') === null;

/** The two sections as repeatables, filled in place (the header): each record form a block, in page order; no Add
 *  (null: Decision 16, Q7-11); the editor's Update its Save (a form submit the click door refuses, DF7-V4: the
 *  person's while ENGINE-7's block-form save door stays off). A section the page does not show declares nothing. */
function repeatables(root: Element): ReturnType<NonNullable<ConfiguredHooks['repeatables']>> {
  return HISTORY.flatMap((rule) => {
    const section = root.querySelector(rule.section);
    if (section === null) return [];
    return [{
      kind: rule.kind,
      blocks: () => Array.from(section.querySelectorAll(rule.block)),
      addButton: () => null,
      save: (block: Element) => block.querySelector<HTMLElement>(rule.save),
      ...('currentlyHere' in rule
        ? { currentlyHere: (block: Element) => block.querySelector<HTMLInputElement>(rule.currentlyHere) } : {}),
    }];
  });
}

/** A saved card's words at `testId`, white space folded; '' where it shows none. */
function cardText(block: Element, testId: string): string {
  return (block.querySelector(`[test-id="${testId}"]`)?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** The first part of a card line Dayforce joins with ", " (jr7-dayforce1-apply-2, measured as shapes on the capture:
 *  education-history-read-schoolName-city-state and work-history-read-company-detail-description each three parts,
 *  the school's or the employer's name first). */
const firstPart = (text: string) => text.split(', ')[0]!.trim();

/** DF7-05, the verifier's correction 2: the saved cards' words by the category the planner fingerprints an entry by
 *  (core/steps/blocks.ts SHOWN_CATEGORIES), so a card the site's import made is matched to its profile entry, never
 *  filled again into a new block: an education's school (<span test-id="education-history-read-schoolName-city-state">,
 *  its first part: the card's h3 educationHistory-read-name is its degree), an experience's employer (<span
 *  test-id="work-history-read-company-detail-description">, its first part) and title (<h3
 *  test-id="workHistory-read-position-title">). An open editor (it holds fields) is read by its fields instead. Read
 *  into the plan request in memory only, as a field's current value is. */
function readEntries(kind: string, blocks: Element[]): PrefillEntryView[] {
  return blocks.flatMap((block, index): PrefillEntryView[] => {
    if (!isCard(block)) return [];
    const values: PrefillEntryView['values'][number][] = [];
    if (kind === 'education' && block.matches(HISTORY[0].block)) {
      const school = firstPart(cardText(block, 'education-history-read-schoolName-city-state'));
      if (school !== '') values.push({ category: 'education.school', text: school });
    } else if (kind === 'experience' && block.matches(HISTORY[1].block)) {
      const company = firstPart(cardText(block, 'work-history-read-company-detail-description'));
      const title = cardText(block, 'workHistory-read-position-title');
      if (company !== '') values.push({ category: 'experience.company', text: company });
      if (title !== '') values.push({ category: 'experience.title', text: title });
    }
    return values.length === 0 ? [] : [{ block: index, values }];
  });
}

/** identityHosts: Dayforce's candidate identity host, where the choice's Sign In and "Create one now." lead (Jobright
 *  1.25.2's dayforceIdentity site, m/ats-rules.js L10: dfid.dayforcehcm.com/globalidentity/account/(register|login)). */
const IDENTITY_HOSTS: readonly RegExp[] = [/^dfid\.dayforcehcm\.com$/];
// ── end jr7 DFPC-7 DF7-05 ──

/** Dayforce's config: the rules, and the label hooks no rule can say; jr7 DFPC-7: the repeatables, the saved cards'
 *  words and the identity host. */
export const DAYFORCE_CONFIG: AtsConfig = { ...RULES, code: { labelFor, labelSuffix,
  repeatables, prefill: { readEntries }, identityHosts: IDENTITY_HOSTS } }; // jr7 DFPC-7: the last line
