/*
 * JobDiva's configured adapter (jr7 FIX7PLAN §6.15, JobDiva items 1 to 12: JDEF-1, JDV-3, JDV-4, JDV-6 to JDV-11,
 * JDV-14, JDV-V2, JDV-V3; the audit SP\jr7\audit\jobdiva-eightfold.md §6 as its verifier corrected it), every rule read
 * from the owner's snapshot7 captures of two staffing agencies' candidate portals (fixtures/jobdiva; one address from
 * the posting to the confirmation, every step a Bootstrap dialog drawn in place):
 * - jr7-jobdiva{1,2}-posting: the job (its "Apply Now", the posting text); the choice, Quick Apply and cancel dialogs
 *   already in the page, hidden (jobdiva1);
 * - jr7-jobdiva{1,2}-choice: #applyOptionsModal "How would you like to apply?" (Sign Into My Account, Create an Account
 *   + Apply, Quick Apply (No Account), Cancel), the entry choice;
 * - jr7-jobdiva1-quick-apply (a section still loading: its spinner), -quick-apply-later, jr7-jobdiva2-quick-apply and
 *   -quick-apply-filled: #quickApplyModal's form (First Name, Last Name, Email, Phone, the SMS consent, Upload Your
 *   Resume; "Submit Application" disabled until the required ones and the résumé are in);
 * - jr7-jobdiva2-eeo and -veteran: the two "EEO Form" steps the dialog draws after Submit Application (Sex and Race,
 *   Next; Protected Veteran Status, Save), both disabled until answered;
 * - jr7-jobdiva2-confirmation: "Thank you!" and "Return to Open Jobs" in the same dialog.
 * The choice dialog stays open (class show) under Quick Apply to the end (jobdiva2's captures 3 to 7): Quick Apply's
 * dialog decides. Nothing here reads a value the person typed: page markup and the site's own words only. Jobright
 * 1.25.2 (a behaviour reference; its modules named beside each rule taken from it) presses Apply Now
 * (~contents/sites/jobdiva/operations findJobdivaDetailApplyButton) and leaves the choice to the person; ours also
 * presses Quick Apply (No Account) by the agent's entry door (JDV-7), never the account choices (JDV-15: not captured).
 * JDV-5 (the boxes' missing edge) was the archive's cascade (JDEF-V1): converted with the live style order, the three
 * text boxes draw their edge; the tel box's is its .jd-form-phone (controlBox).
 */
import { newScanCache, type ScanCache } from '../../dom/scan-cache';
import { isUserVisible } from '../../dom/visibility';
import { configuredHooks } from '../configured';
import type { AtsConfig, ConfiguredHooks } from '../configured/types';
import { wordsOf } from '../success';
import { parseJobDivaUrl } from './url';

/** The fixture cases the config was read from (fixtures/jobdiva/<case>.html, converted with jr7-tooling-done). */
export const JOBDIVA_SNAPSHOTS = ['jr7-jobdiva1-posting', 'jr7-jobdiva1-choice', 'jr7-jobdiva1-quick-apply',
  'jr7-jobdiva1-quick-apply-later', 'jr7-jobdiva2-posting', 'jr7-jobdiva2-choice', 'jr7-jobdiva2-quick-apply',
  'jr7-jobdiva2-quick-apply-filled', 'jr7-jobdiva2-eeo', 'jr7-jobdiva2-veteran', 'jr7-jobdiva2-confirmation'] as const;

/** The Quick Apply dialog while open: the form, its EEO steps and its confirmation (every Quick Apply capture). */
const QUICK_APPLY = '#quickApplyModal.show';
/** The choice of how to apply while open (jr7-jobdiva{1,2}-choice). */
const CHOICE = '#applyOptionsModal.show';
/** The Quick Apply form's step buttons (.job-app-btns under the dialog's body): Cancel or Back (button.jd-btn-outline),
 *  Submit Application (button.jd-btn-mobile), Next or Save (button.btn.jd-btn). */
const STEP_BUTTONS = `${QUICK_APPLY} .job-app-btns`;
/** The posting's Apply Now: <div class="row py-3"><div class="col-auto"><button class="btn jd-btn">, beside Job List's
 *  div.col-auto.jd-jobnav (jr7-jobdiva{1,2}-posting). */
const APPLY_NOW = '.row.py-3 > .col-auto > button.btn.jd-btn';
/** The words of the controls pressed by their words (the choice's three buttons share their classes, and Submit
 *  shares its class with the cancel dialog's "Yes, cancel application": JDV-7, JDV-14). */
const APPLY_NOW_WORDS = /^Apply Now$/i;
const QUICK_APPLY_WORDS = /^Quick Apply \(No Account\)$/i;
const SUBMIT_WORDS = /^Submit Application$/i;
/** The national number's layout for the tel box beside the dropdown's "+1" (JDV-11, for now: ten digits). */
export const JOBDIVA_PHONE_PATTERN = '##########';

/** The rules, each naming its snapshot. */
const RULES: AtsConfig = {
  platform: 'jobdiva',
  snapshots: JOBDIVA_SNAPSHOTS,
  parse: parseJobDivaUrl,
  states: [
    // JDV-7: the choice of how to apply, while Quick Apply's dialog is not open; its entry (Quick Apply (No Account),
    // by its words) is the code's entryControl, pressed by the agent's entry door alone.
    { name: 'entry-choice', when: `body:not(:has(${QUICK_APPLY})) ${CHOICE}`, auth: 'entry-choice',
      from: 'jr7-jobdiva1-choice, jr7-jobdiva2-choice' },
  ],
  // JDV-3: the dialog's body while it holds the form or an EEO step (div.job-app-main); none on the posting, the
  // choice and the confirmation, whose body holds the "Thank you!" row instead.
  root: { css: `${QUICK_APPLY} .modal-body-main`, holds: '.job-app-main',
    from: 'jr7-jobdiva1-quick-apply, jr7-jobdiva2-quick-apply, jr7-jobdiva2-eeo, jr7-jobdiva2-veteran' },
  questions: [
    // JDV-4: <div class="jd-form-layout"><label class="jd-label">First Name<span class="jd-text-red ml-1">*</span>
    // </label><input class="form-control jd-form" type="text" required> (no for, no id); the Phone's and the résumé's
    // the same (Jobright's ~contents/sites/jobdiva/rules extractRules reads the layout's label so).
    { container: '.jd-form-layout', title: ':scope > label.jd-label', from: 'jr7-jobdiva2-quick-apply' },
    // JDV-9: <div class="radio-buttons-div"><div class="eeo-label">Sex<span class="eeo-label-mandatory">*</span>
    // </div><div class="radio-button"><input type="radio" name="gender"><span class="radio-buttons-label">Female
    // </span></div>…: the title names the group alone (code labelFor), the option's words are its span.
    { container: '.radio-buttons-div', title: ':scope > .eeo-label', group: true,
      from: 'jr7-jobdiva2-eeo, jr7-jobdiva2-veteran' },
  ],
  // No required rule: each title's own star (span.jd-text-red, span.eeo-label-mandatory: "*") ends the title's words,
  // which the label reading takes as the required mark (dom/labels.ts cleanLabel), the résumé's and the EEO groups'
  // included.
  // JDV-6: the résumé's drop zone, its file input (accept="") laid over it at opacity 1e-05; once the page holds a file
  // its card follows the zone, its name the card's first span (jr7-jobdiva2-quick-apply-filled; the converter blanks
  // the name). Jobright uploads to the first file input and waits for an uploaded sign (~contents/sites/jobdiva/
  // operations uploadResume).
  uploads: [{ input: '.jd-dropzone input[type="file"]', control: '.jd-dropzone', area: '.jd-form-layout',
    done: '.jd-dropzone-filecard', name: '.jd-dropzone-filecard > span:first-child',
    from: 'jr7-jobdiva2-quick-apply, jr7-jobdiva2-quick-apply-filled' }],
  steps: {
    // JDV-8 with JDV-V2: both EEO steps' heading reads "EEO Form" and no progress shows, so the radios' own name
    // (gender on the first, veteran on the second) tells them apart; Jobright keys its JobDiva page by the dialog's
    // title and its fields' names (~core/pagenation jobdiva).
    heading: `${QUICK_APPLY} .job-app-title-1`,
    anchors: [{ css: `${QUICK_APPLY} .radio-buttons-div input[type="radio"]`, attr: 'name' }],
    // Next and Save (button.btn.jd-btn); never Back or Cancel (button.jd-btn-outline, open or not).
    next: `${STEP_BUTTONS} button.btn.jd-btn`,
    back: '#quickApplyModal .job-app-btns button.jd-btn-outline',
    from: 'jr7-jobdiva2-quick-apply, jr7-jobdiva2-eeo, jr7-jobdiva2-veteran',
  },
  // JDV-7: Submit Application (button.jd-btn-mobile, as Jobright's ats-submission rule "jobdiva" names it), read with
  // its words by the code below. The EEO steps follow it in place (JDV-8).
  submit: { css: `${STEP_BUTTONS} button.jd-btn-mobile`, from: 'jr7-jobdiva2-quick-apply, jr7-jobdiva2-quick-apply-filled' },
  neverPress: [
    // JDV-14: the cancel dialog ("Yes, cancel application" is a button.jd-btn-mobile, as Submit is; "No, keep going").
    { css: '#confirmCancelModal button', from: 'jr7-jobdiva1-posting' },
    // The choice's buttons: its account choices and Cancel. Its Quick Apply (No Account) is the entry door's alone
    // (entryNeverPressed: that one element).
    { css: '#applyOptionsModal button', from: 'jr7-jobdiva1-choice, jr7-jobdiva2-choice' },
    // Apply Now, the entry door's alone; the header's Search Jobs, Sign In and Register With Us; Job List.
    { css: APPLY_NOW, from: 'jr7-jobdiva1-posting, jr7-jobdiva2-posting' },
    { css: 'a.jd-nav-label, .jd-jobnav a, .jd-jobnav button', from: 'jr7-jobdiva2-posting' },
    // The confirmation's Return to Open Jobs, the success sign's companion.
    { css: '#quickApplyModal .modal-body-main .container-fluid > .row button', from: 'jr7-jobdiva2-confirmation' },
    // The résumé card's second span (its remove).
    { css: '.jd-dropzone-filecard > span:not(:first-child)', from: 'jr7-jobdiva2-quick-apply-filled' },
    // The hidden "Security check" dialog's own controls (JDV-13: a challenge; never pressed for the person).
    { css: '[role="dialog"][aria-label="Security check"] button', from: 'jr7-jobdiva1-posting' },
  ],
  // JDV-V3: a section of the form still loading draws a spinner in the dialog (jr7-jobdiva1-quick-apply: <div
  // class="spinner-border spinner-border-sm" role="status"><span class="sr-only">Loading...</span>; gone 3.5 minutes
  // later, jr7-jobdiva1-quick-apply-later).
  busy: [{ css: `${QUICK_APPLY} .spinner-border[role="status"]`, from: 'jr7-jobdiva1-quick-apply' }],
  // JDV-10 (the verifier's correction): the confirmation's cell, its words the agency's own ("Thank you!" here;
  // Jobright's rule "jobdiva" reads "You've applied! Good luck!", which this agency's misses), beside its Return to
  // Open Jobs, in the open Quick Apply dialog; read only after the run's own Submit (content/submitted.ts).
  success: { css: `${QUICK_APPLY} .modal-body-main .container-fluid > .row > .col-12.text-center.font-weight-bold`,
    text: /\S/, companion: { css: 'button.jd-btn-outline', text: /^Return to Open Jobs$/i },
    from: 'jr7-jobdiva2-confirmation; Jobright 1.25.2 ats-submission rule jobdiva (its selector)' },
  // The posting's text: the column after its description's title (jr7-jobdiva{1,2}-posting: one match each).
  posting: { text: '.col-12:has(> .jd-desc-title) + .col-12.notranslate', from: 'jr7-jobdiva1-posting, jr7-jobdiva2-posting' },
  // JDV-7: Apply Now draws the choice in place, whose Quick Apply draws the form in place (two presses, one address);
  // the dialog's form may come late (a section loading: JDV-V3).
  quirks: { entryPresses: 2, formInPlace: true, formLateMs: 20_000 },
};

const ruled: ConfiguredHooks = configuredHooks(RULES);

/** The first element matching `css` in `scope` that a person can see and whose words read `words`, or null. */
function shownByWords(scope: ParentNode, css: string, words: RegExp, cache: ScanCache): HTMLElement | null {
  return Array.from(scope.querySelectorAll<HTMLElement>(css))
    .find((el) => isUserVisible(el, cache) && words.test(wordsOf(el))) ?? null;
}

/** Whether a person can see an element matching `css` in `doc`. */
function anyShown(doc: Document, css: string, cache: ScanCache): boolean {
  return Array.from(doc.querySelectorAll(css)).some((el) => isUserVisible(el, cache));
}

/** The Submit the open dialog shows with its words, or null (JDV-7, JDV-14). */
function submitOf(doc: Document, cache: ScanCache): HTMLElement | null {
  return shownByWords(doc, `${STEP_BUTTONS} button.jd-btn-mobile`, SUBMIT_WORDS, cache);
}

/** A radio of an EEO question (JDV-9): its question's title names its group, never the option. */
const eeoRadio = (control: Element) => control.localName === 'input' && (control as HTMLInputElement).type === 'radio'
  && control.closest('.radio-buttons-div') !== null;

/** The hooks no rule can say. */
const code: Partial<ConfiguredHooks> = {
  // JDV-7 (the verifier's correction: configured entries are CSS alone, and the choice's buttons differ by their words
  // only): Apply Now while no dialog is open; Quick Apply (No Account) while the choice is open and Quick Apply's
  // dialog is not; never Sign Into My Account or Create an Account + Apply (JDV-15).
  entryControl(doc) {
    const cache = newScanCache();
    if (anyShown(doc, QUICK_APPLY, cache)) return null;
    const choice = Array.from(doc.querySelectorAll(CHOICE)).find((el) => isUserVisible(el, cache));
    if (choice !== undefined) return shownByWords(choice, 'button.btn.jd-btn', QUICK_APPLY_WORDS, cache);
    if (anyShown(doc, '.modal.show', cache)) return null;
    return shownByWords(doc, APPLY_NOW, APPLY_NOW_WORDS, cache);
  },
  // JDV-7: Submit is Submit Application by its class and its words, never the cancel dialog's button of the same class.
  submitButton: (root) => submitOf(root.ownerDocument, newScanCache()),
  // The rules' reading, with Submit by its words: a dialog whose button.jd-btn-mobile reads otherwise is no final step.
  isFinalStep(doc) {
    const ruledFinal = ruled.isFinalStep?.(doc) ?? 'unknown';
    return ruledFinal === 'final' && submitOf(doc, newScanCache()) === null ? 'unknown' : ruledFinal;
  },
  // JDV-9: the EEO title for its group's container alone; each radio's words are its own (optionTextFor).
  labelFor: (control) => (eeoRadio(control) ? null : ruled.labelFor?.(control) ?? null),
  // JDV-9: <input type="radio" name="gender" …><span class="radio-buttons-label">Female</span> (Jobright reads the
  // input's next element sibling: ~contents/sites/jobdiva/rules extractRules).
  optionTextFor(input) {
    const next = input.nextElementSibling;
    if (!eeoRadio(input) || next === null || !next.matches('span.radio-buttons-label')) return null;
    const text = wordsOf(next);
    return text === '' ? null : text;
  },
  // JDV-11 (for now): the tel box beside the country dropdown's "+1" takes the national number; its drawn edge is its
  // div.jd-form.jd-form-phone (.jd-form-phone input { border: 0 } in either style order: JDEF-V1).
  formatFor: (control) => (control.matches('.jd-form-phone input[type="tel"]')
    ? { format: 'tel', pattern: JOBDIVA_PHONE_PATTERN } : null),
  controlBox: (control) => (control.matches('.jd-form-phone input[type="tel"]') ? control.closest('.jd-form-phone') : null),
  // The entry controls are never pressed by a run (neverPress); the entry door presses its own one alone.
  entryNeverPressed: true,
};

/** JobDiva's config: the rules, and the code they cannot say. */
export const JOBDIVA_CONFIG: AtsConfig = { ...RULES, code };
