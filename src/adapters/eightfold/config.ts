/*
 * Eightfold AI's configured adapter (jr7 FIX7PLAN §6.15, Eightfold items 1 to 11: EFA-2 to EFA-9, EFA-11, EFA-12,
 * EFA-V5, EFA-V6, and RULES-7's label contract for EFA-10; the audit SP\jr7\audit\jobdiva-eightfold.md §7 as its
 * verifier corrected it), every rule read from the owner's snapshot7 capture twillio, one company's PCSX career site (a
 * React app with hashed CSS-module classes; fixtures/eightfold):
 * - jr7-twillio-posting: the job list with a posting's details pane, its "Apply Now" link to /careers/apply?pid=<id>
 *   (the agent's entry; the agent may also open the form directly), "Add to cart", and the page's own "Upload resume"
 *   for its AI matching (a file input that is no application: the adapter claims no form there, EFA-12);
 * - jr7-twillio-apply: the application, one page: form:has(button[type=submit][data-test-id=submitApplicationButton])
 *   in three section cards (Resume, Contact Information, Position Specific Questions), each question a
 *   div[class*="field-"] titled by its label#<id>_label or legend#<id>_legend, required by its class required-*;
 *   "Cancel", "Clear form", "Submit application"; a left stepper that only scrolls;
 * - jr7-twillio-apply-2: the same, its "Data Privacy Agreement" dialog opening (I Agree / Cancel) as a résumé is taken;
 * - jr7-twillio-success: /careers/apply/success, the card "Thank you for your application, <first name>!" (the
 *   converter blanks the name), "Browse Jobs" and "Track your application".
 * Jobright 1.25.2 (a behaviour reference; its modules named beside each rule taken from it): ~contents/sites/eightfold
 * (class Eightfold), its entry-preflow eightfoldEntryAdapter and its ats-submission rule "eightfold".
 * Not built here: the Country code and Country comboboxes' lists (EFA-9, gated on the owner's capture of an open list,
 * Q7-1: the scanner reads them as lazy ARIA comboboxes, the person's until then); white-label domains (EFA-14).
 * Q7-12's default: "Save my answers for future applications" (ticked by the page) is left as the page chose: it is no
 * question of the application, so nothing reads or writes it (excluded).
 */
import { newScanCache } from '../../dom/scan-cache';
import { isUserVisible } from '../../dom/visibility';
import { configuredHooks } from '../configured';
import type { AtsConfig, ConfiguredHooks } from '../configured/types';
import { applicationLinkOf } from '../entry';
import { wordsOf } from '../success';
import { parseEightfoldUrl } from './url';

/** The fixture cases the config was read from (fixtures/eightfold/<case>.html, converted with jr7-tooling-done). */
export const EIGHTFOLD_SNAPSHOTS = ['jr7-twillio-posting', 'jr7-twillio-apply', 'jr7-twillio-apply-2',
  'jr7-twillio-success'] as const;

/** The application's Submit, as Jobright's ats-submission rule "eightfold" names it (jr7-twillio-apply). */
const SUBMIT = 'button[type="submit"][data-test-id="submitApplicationButton"]';
/** The application's form: the one holding that Submit (jr7-twillio-apply, -apply-2). */
const FORM = `form:has(${SUBMIT})`;
/** One question's holder (the class field-<hash>; 21 on the form, none elsewhere). */
const FIELD = '[class*="field-"]';
/** The Data Privacy Agreement's I Agree and Cancel (jr7-twillio-apply-2; Jobright's ~contents/sites/eightfold/rules
 *  getDataPrivacyAgreementButton names the first). */
const PRIVACY_AGREE = '#confirmUploadResume[data-test-id="confirm-upload-resume"]';
const PRIVACY_CANCEL = '#cancelUploadResume';
/** The data-test-id prefixes of the form's own question boxes (EFA-3: Contact_Information_phone, _city;
 *  Position_Specific_Questions_question_<n>). */
const QUESTION_BOX = /^(?:Contact_Information_|Position_Specific_Questions_)/;
/** An Apply link that stays in this tab and downloads nothing (EFA-5). */
const SAME_TAB_LINK = 'a[href]:not([download]):not([target]), a[href][target=""]:not([download]), '
  + 'a[href][target="_self" i]:not([download])';

/** The rules, each naming its snapshot. */
const RULES: AtsConfig = {
  platform: 'eightfold',
  ...(__PROVENANCE__ && { snapshots: EIGHTFOLD_SNAPSHOTS }),
  parse: parseEightfoldUrl,
  root: { css: FORM, ...(__PROVENANCE__ && { from: 'jr7-twillio-apply, jr7-twillio-apply-2' }) },
  questions: [
    // <div class="… field-3Ez-x"><label id="Contact_Information_email_label" class="label-385LH required-3upJY"
    // for="Contact_Information_email">…; a group's title is its legend#<id>_legend (Phone, a checkbox group) or a
    // label[for] naming the radiogroup's div (whose aria-labelledby names a _legend the page never draws).
    { container: FIELD, title: 'label[id$="_label"], legend[id$="_legend"]', help: '[class*="help-"]',
      ...(__PROVENANCE__ && { from: 'jr7-twillio-apply' }) },
  ],
  // EFA-11: the title's class required-<hash> is the only mark the résumé carries (no aria-required on its input).
  required: [{ is: '[class*="required-"]', ...(__PROVENANCE__ && { from: 'jr7-twillio-apply' }) }],
  // EFA-4: the radios are drawn at opacity 0, their own label[for] aria-hidden="true": the selector wrapper stands
  // for each (<div class="radio-module_selector__… " data-test-id="…-No"><input type="radio" aria-label="No, <the
  // question>"><label for aria-hidden="true">…<span class="radio-module_selector-label__…">No</span>).
  proxies: [{ input: '[role="radiogroup"] input[type="radio"]', proxy: '[class*="radio-module_selector__"]',
    ...(__PROVENANCE__ && { from: 'jr7-twillio-apply' }) }],
  // The résumé's drop zone: its file input display:none inside span.upload-resume-dropzone, its "Select file" button.
  // No capture shows the zone after an upload (Jobright waits for a "Replace" button there: ~contents/sites/eightfold/
  // operations waitForUploadComplete), so no done sign is declared: the input's own files decide.
  uploads: [{ input: '.upload-resume-dropzone input[type="file"]', control: 'button[aria-label^="Select file"]',
    area: FIELD, ...(__PROVENANCE__ && { from: 'jr7-twillio-apply' }) }],
  // EFA-7: one page, final while Submit shows (no steps: the stepper only scrolls).
  submit: { css: SUBMIT, ...(__PROVENANCE__ && { from: 'jr7-twillio-apply' }) },
  neverPress: [
    // EFA-7: Cancel, Clear form, the stepper's steps.
    { css: '[data-test-id="cancelApplicationButton"], [data-test-id="clear-form-button"], [data-test-id^="step-"]',
      ...(__PROVENANCE__ && { from: 'jr7-twillio-apply' }) },
    // EFA-6: the Data Privacy Agreement's Cancel (its I Agree is the upload-prompt door's alone: uploadPrompt).
    { css: PRIVACY_CANCEL, ...(__PROVENANCE__ && { from: 'jr7-twillio-apply-2' }) },
    // The posting's Add to cart; the success page's Browse Jobs and Track your application.
    { css: '[data-test-id^="add-to-cart-"]', ...(__PROVENANCE__ && { from: 'jr7-twillio-posting' }) },
    { css: '[data-test-id="browse-more-jobs-button"], [class*="ctaButtonContainer-"] button',
      ...(__PROVENANCE__ && { from: 'jr7-twillio-success' }) },
  ],
  // EFA-8: Jobright's rule "eightfold" (its ats-submission rule: the empty card holding the success picture, its
  // words "Thank you for your application" read as a prefix only, so the first name after them is never read into
  // anything; its companion Browse Jobs), on the page the parse reads as the confirmation.
  success: { css: '[class*="emptyCardContainer-"] [class*="emptyCard-"]:has([data-test-id="success-page-svg"])',
    text: /^Thank you for your application(?:,|!|\.|\s|$)/,
    companion: { css: '[data-test-id="browse-more-jobs-button"]', text: /^Browse\b/i },
    ...(__PROVENANCE__ && { from: 'jr7-twillio-success; Jobright 1.25.2 ats-submission rule eightfold' }) },
  posting: { text: '#job-description-container', ...(__PROVENANCE__ && { from: 'jr7-twillio-posting' }) },
  // EFA-V6: PCSX draws the form by script after the page loads (a direct open, or the in-app route from Apply Now).
  quirks: { formLateMs: 30_000 },
};

const ruled: ConfiguredHooks = configuredHooks(RULES);

/** Whether a control names itself (a non-empty aria-label of its own: the phone's "Country code" combobox, EFA-V5). */
const ownAriaLabel = (control: Element) => (control.getAttribute('aria-label') ?? '').trim() !== '';

/** A radio of a question's radiogroup (EFA-4). */
const groupRadio = (control: Element) => control.localName === 'input' && (control as HTMLInputElement).type === 'radio'
  && control.closest('[role="radiogroup"]') !== null;

/** EFA-10 (RULES-7's label contract): the legend of a lone checkbox's group, its question ("By clicking the
 *  "Acknowledge" button, you acknowledge that …", "By checking this box, I confirm I have read …": jr7-twillio-apply,
 *  <div class="checkbox-module_checkbox-group__…" aria-labelledby="…___legend"> holding one "Acknowledge" box), or
 *  none; a group of several boxes is labelled by its legend already. */
function loneBoxLegend(control: Element): Element[] {
  if (control.localName !== 'input' || (control as HTMLInputElement).type !== 'checkbox') return [];
  const group = control.closest('[aria-labelledby$="_legend"]');
  if (group === null || group === control || group.querySelectorAll('input[type="checkbox"]').length !== 1) return [];
  const doc = control.ownerDocument;
  return (group.getAttribute('aria-labelledby') ?? '').split(/\s+/).flatMap((id) => {
    const legend = id === '' ? null : doc.getElementById(id);
    return legend === null ? [] : [legend];
  });
}

/** The hooks no rule can say. */
const code: Partial<ConfiguredHooks> = {
  // EFA-V5: a control's own aria-label stands (the phone's "Country code" combobox, never the group's "Phone"); a
  // radio's words are its own (optionTextFor), its question naming its radiogroup alone.
  labelFor: (control) => (ownAriaLabel(control) || groupRadio(control) ? null : ruled.labelFor?.(control) ?? null),
  // EFA-10 (RULES-7's label contract): an "Acknowledge" box is described by its group's legend, then its help text,
  // so the AI-policy box reads as the AI attestation it is, never a bare consent.
  descriptionFor: (control) => [...loneBoxLegend(control), ...(ruled.descriptionFor?.(control) ?? [])],
  // EFA-4: the option's words, the wrapper's span.radio-module_selector-label__… (ENGINE-7 E1 item 5 takes them
  // though their label is aria-hidden, the input's own aria-label starting with them).
  optionTextFor(input) {
    if (!groupRadio(input)) return null;
    const label = input.closest('[class*="radio-module_selector__"]')?.querySelector('[class*="selector-label"]') ?? null;
    const text = label === null ? '' : wordsOf(label);
    return text === '' ? null : text;
  },
  // EFA-3 (the verifier's correction: declared, never a label heuristic): the form's own question boxes say
  // autocomplete="one-time-code" (Phone, City, a Position Specific question) to keep the browser's autofill off; they
  // are no code boxes. A one-time-code box anywhere else (another form, a box with no such test id) still is one.
  notCodeBox: (input) => input.closest(FORM) !== null && QUESTION_BOX.test(input.getAttribute('data-test-id') ?? ''),
  // EFA-6: the Data Privacy Agreement the page draws once it takes the résumé: its I Agree, a privacy acknowledgement
  // the upload needs (decided under the Consents mode by the door; FIX7PLAN §5 D-9), as Jobright presses it after its
  // upload (~contents/sites/eightfold handleDataPrivacyAgreement). Never its Cancel.
  uploadPrompt(doc) {
    const cache = newScanCache();
    const press = Array.from(doc.querySelectorAll<HTMLElement>(PRIVACY_AGREE)).find((el) => isUserVisible(el, cache));
    return press === undefined ? null : { press, kind: 'consent' };
  },
  // EFA-5: on the posting, the Apply Now link a person sees, to this posting's form (the same host and pid), staying
  // in this tab and downloading nothing (Jobright's eightfoldEntryAdapter: a shown same-origin, same-tab, non-download
  // link to /careers/apply with the page's pid); never a job card's, Add to cart or the AI matching's Upload resume.
  entryControl: (doc) => applicationLinkOf(doc, parseEightfoldUrl, SAME_TAB_LINK),
  // Q7-12 (default: left as the page chose): the "Save my answers for future applications" box, outside every
  // question's holder, is no question of the application (jr7-twillio-apply: <div class="checkbox-module_selector__…">
  // <input id=<random> type="checkbox" aria-labelledby="<id>-label">, after the section cards).
  excluded: (root) => Array.from(root.querySelectorAll('[class*="checkbox-module_selector__"]'))
    .filter((wrapper) => wrapper.closest(FIELD) === null),
};

/** Eightfold's config: the rules, and the code they cannot say. */
export const EIGHTFOLD_CONFIG: AtsConfig = { ...RULES, code };
