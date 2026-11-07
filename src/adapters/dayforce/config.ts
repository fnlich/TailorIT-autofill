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
 */
import { configuredHooks } from '../configured';
import type { AtsConfig } from '../configured/types';
import { matchesUrl, parseDayforceUrl } from './url';

/** The step body (dayforce-0 to -2): <div class="mt-5" test-id="application-step-candidateinfo|questionnaire|submit">. */
const STEP_BODY = '#jobPostingApplication [test-id^="application-step-"]';
/** The three upload sections (dayforce-2): <section test-id="resume-upload-section">, cover-letter-, additional-documents-. */
const UPLOAD_SECTIONS = ['resume', 'cover-letter', 'additional-documents'] as const;

/** The rules, each naming its snapshot (see the header). */
const RULES: AtsConfig = {
  platform: 'dayforce',
  snapshots: ['candidate-info', 'questionnaire', 'submit-challenge'],
  parse: parseDayforceUrl,
  matchesUrl,
  // dayforce-0 to -2: <div id="jobPostingApplication" class="ant-form ant-form-vertical css-59ygyz"><div class="mt-5"
  // test-id="application-step-...">.
  root: { css: 'div#jobPostingApplication', holds: '[test-id^="application-step-"]', from: 'dayforce-0, dayforce-1, dayforce-2' },
  questions: [
    // dayforce-0: <li test-id="question-item"><fieldset aria-labelledby=":r3m:"><div class="ant-col ..."><legend
    // id=":r3m:" ...><span class="ant-typography absolute -left-[9999] overflow-hidden h-0 ...">(the question)</span>
    // </legend><div class="ant-form-item ..."><div test-id="questionnaire-..." class="ant-row ant-form-item-row ..."><div
    // class="ant-col ant-form-item-label ..."><label for="jobPostingApplication_sections_0_questionnaire_questions_0_
    // selectedOption" class="" title=""><div class="sanitized-html w-full">(the question)</div></label></div> ... <div
    // class="ant-radio-group ..." id="..._selectedOption">.
    { container: 'li[test-id="question-item"] fieldset', title: '.ant-form-item-label > label', from: 'dayforce-0' },
  ],
  // dayforce-2: <label for="jobPostingApplication_personalInfo_firstName" class="ant-form-item-required" title="First
  // Name">First Name</label>.
  required: [{ is: 'label.ant-form-item-required', from: 'dayforce-2' }],
  widgets: [
    // dayforce-2: <div class="ant-select ant-select-in-form-item css-59ygyz ant-select-single ant-select-show-arrow"
    // test-id="personal-info-prefixid-dropdown"><div class="ant-select-selector"><span
    // class="ant-select-selection-search"><input type="search" id="jobPostingApplication_personalInfo_prefixId"
    // class="ant-select-selection-search-input" role="combobox" aria-expanded="false"
    // aria-controls="jobPostingApplication_personalInfo_prefixId_list" readonly="" value="" style="opacity: 0;"></span>
    // ...: a select-only list, its box drawn by .ant-select-selector.
    { match: 'div.ant-select input.ant-select-selection-search-input[role="combobox" i][readonly]', kind: 'combobox',
      opener: '.ant-select-selector', expanded: 'input', box: '.ant-select-selector', readOnlyBox: true, from: 'dayforce-2' },
    // dayforce-2: Country, State/Province and the dial codes (.ant-select-show-search): the same, typeable.
    { match: 'div.ant-select input.ant-select-selection-search-input[role="combobox" i]:not([readonly])', kind: 'combobox',
      opener: '.ant-select-selector', expanded: 'input', box: '.ant-select-selector', from: 'dayforce-2' },
  ],
  checked: [
    // dayforce-0: <label class="ant-radio-wrapper ant-radio-wrapper-in-form-item css-59ygyz"><span class="ant-radio
    // ant-wave-target"><input aria-required="false" name="sections,0,questionnaire,questions,0,selectedOption"
    // class="ant-radio-input" type="radio" value="41"><span class="ant-radio-inner"></span></span><span>Yes</span>
    // </label>; chosen, the label's ant-radio-wrapper-checked.
    { input: 'label.ant-radio-wrapper input.ant-radio-input', holder: 'label.ant-radio-wrapper',
      chosen: '.ant-radio-wrapper-checked', from: 'dayforce-0' },
    // dayforce-1: <label class="ant-checkbox-wrapper ..."><span class="ant-checkbox ..."><input
    // id="jobPostingApplication_userAcknowledged" class="ant-checkbox-input" type="checkbox"
    // test-id="user-acknowledged-checkbox"></span><span>I agree to the Candidate Acknowledgement</span></label>; ticked,
    // ant-checkbox-wrapper-checked.
    { input: 'label.ant-checkbox-wrapper input.ant-checkbox-input', holder: 'label.ant-checkbox-wrapper',
      chosen: '.ant-checkbox-wrapper-checked', from: 'dayforce-1' },
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
      name: 'span.ant-upload-list-item-name', from: 'dayforce-2' },
    // dayforce-2: <section test-id="cover-letter-upload-section"> ... <input id="jobPostingApplication_files_coverLetter"
    // type="file" ...><button ... test-id="cover-letter-upload-button" ...>Add Cover Letter</button>; and
    // additional-documents-upload-section's "Add Additional Documents". No file was put in either.
    { input: 'section[test-id="cover-letter-upload-section"] input[type="file" i]',
      control: 'button[test-id="cover-letter-upload-button"]', area: 'section[test-id="cover-letter-upload-section"]',
      from: 'dayforce-2' },
    { input: 'section[test-id="additional-documents-upload-section"] input[type="file" i]',
      control: 'button[test-id="additional-documents-upload-button"]',
      area: 'section[test-id="additional-documents-upload-section"]', from: 'dayforce-2' },
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
    from: 'dayforce-0, dayforce-1, dayforce-2',
  },
  // dayforce-1: <button test-id="application-submit" type="button" class="ant-btn ...">, in Next's place.
  submit: { css: 'button[test-id="application-submit"]', from: 'dayforce-1' },
  neverPress: [
    { css: 'button[test-id="application-cancel"]', from: 'dayforce-0, dayforce-1, dayforce-2' },
    // The résumé parser: <button tabindex="0" role="presentation" test-id="import-resume-section-button" ...>.
    { css: 'button[test-id="import-resume-section-button"]', from: 'dayforce-2' },
    // Personal Information's own <button ... test-id="personal-info-update-button" type="submit">Update</button> and
    // <button ... test-id="personal-info-cancel-button" type="reset">Cancel</button>.
    { css: 'button[test-id="personal-info-update-button"], button[test-id="personal-info-cancel-button"]', from: 'dayforce-2' },
    // A record's <button aria-label="Edit Employment History record" test-id="workHistory-edit-button" ...> and
    // "Delete ..." (education's educationHistory-*), and an upload's <button title="Remove file" ...>.
    { css: 'button[test-id$="History-edit-button"], button[test-id$="History-delete-button"]', from: 'dayforce-2' },
    { css: '.ant-upload-list-item-actions button[title="Remove file"]', from: 'dayforce-2' },
    // The header's <div test-id="header-sign-in"><a href="...#">Sign In</a></div>, the footer's <a
    // test-id="cookie-prefs-link">, and the steps bar's items (<div class="ant-steps-item-container" role="button">).
    { css: 'div[test-id="header-sign-in"] a, a[test-id="cookie-prefs-link"]', from: 'dayforce-2' },
    { css: '.ant-steps-item-container[role="button" i]', from: 'dayforce-0' },
  ],
  // dayforce-2: <div test-id="import-resume-section" ...> (Import Resume, its file input and its list).
  excluded: [{ css: 'div[test-id="import-resume-section"]', from: 'dayforce-2' }],
  // dayforce-0: <button test-id="application-next-step" type="button" class="ant-btn ... ant-btn-loading">.
  busy: [{ css: 'button[test-id="application-next-step"].ant-btn-loading', from: 'dayforce-0' }],
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

/** Dayforce's config: the rules, and the label hooks no rule can say. */
export const DAYFORCE_CONFIG: AtsConfig = { ...RULES, code: { labelFor, labelSuffix } };
