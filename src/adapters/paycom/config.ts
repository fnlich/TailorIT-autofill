/*
 * Paycom's configured adapter (jr7 FIX7PLAN §6.11, Paycom: PC7-01, PC7-04 to PC7-07; DFPC-7), read from the owner's
 * snapshot7 paycomonline1 captures (one application, end to end, on www.paycomonline.net), converted as
 * fixtures/paycom/jr7-paycomonline1-*.html: posting (capture 1), account (2: the "Getting You Started" contact dialog),
 * prescreen (3: "Let's Get Started!"), apply-1 (4: the one-page application under the "Start Application" dialog),
 * apply-2 and apply-3 (5, 6: filling, filled), signature (7: the Authorization's signature pad, its canvas a stand-in)
 * and confirmation (8: "Application Submitted!"). Every rule names its case. The page is a React portal (#ats-portal)
 * drawn with Paycom's uiLib on MUI; its dialogs are portalled to the body's end. Jobright 1.25.2 is read as a behaviour
 * reference only, its module or function named beside each rule taken from it.
 * - PC7-01, the root: #ats-portal holding the application's sections ([id$="-section"]) or a pre-screen question
 *   (div[id^="questions-"][id$="-field"]): none on the posting (no #ats-portal) nor on the confirmation (no section).
 * - PC7-05, the states, in order:
 *   - start-choice: the "Start Application" dialog (two loading buttons, no field): an entry choice whose entry is
 *     "Apply Manually", by its words (both buttons are data-testid="undefined-loadingbutton"); "Autofill with
 *     Resume/CV" (the site's parser) is never pressed (Jobright's PaycomOnline dismisses it as "apply-manually");
 *   - contact: the "Getting You Started" dialog (input[name=firstName] and [name=email]): filled like a step, its root
 *     the dialog; its "Continue To Application" makes the candidate's account (the confirmation offers "Set Up a
 *     Password for Your Account"), so it is the state's sign-in container's button, pressed by Sign-in Auto alone
 *     (never Next); "Sign In" and "Create Account" never. Its invisible hCaptcha (PC7-08) is the person's.
 *   The sign-in dialog and the résumé parser's dialog are in no capture: no state is written for them.
 * - Steps (PC7-04): the pre-screen's Next is the BottomButtonLayout's loading button reading "Next"; the application is
 *   one page whose Submit is the portal's loading button reading Submit, Submit Application or Sign and Submit (Jobright's
 *   m/ats-rules.js `paycomonline` buttonText), never "Save and Complete Later" (the same test id). Final when Submit
 *   shows and Next does not.
 * - Questions (PC7-04, §3.3's label contract): a question's title is drawn beside its field, not tied to it: the
 *   pre-screen's and the Questions section's "N . * question" in the column before the field's (its words alone: the
 *   number, the dot and the star are no part of it; the star is its required mark), and the yes/no groups' titles
 *   (Currently Enrolled, Graduated, Can Contact, Current Employer, the texts consent) the words before the group's field.
 * - Drawn radios: the native radio (opacity 0) stands for its label.uiLibRadioLabel (proxies), whose words are drawn
 *   in an aria-hidden <p> (ENGINE-7 E1 item 5 reads them over the input's aria-label "Yes 1 of 2."); chosen, the
 *   .uiLibRadio's ui-radio-checked. Drawn boxes: button.uiLibCheckboxButton[role=checkbox] stands for the hidden
 *   native box (display: none) inside its label.uiLibCheckbox; chosen, aria-checked="true".
 * - Text boxes and native selects: MUI's outlined box, its border drawn by an aria-hidden <fieldset> beside the control
 *   (controlBox; TOOLING-7's O-7 re-check: the live cascade still reads them camouflaged without it).
 * - Dates: a date drawn in three boxes (<id>-month, -day, -year) inside div[role=textbox][aria-label] is one date
 *   (dateFor); its boxes are its parts, never fields of their own.
 * - The country combo box (div.uiLibCountryList, its button) is a declared list whose open list no capture shows: its
 *   field is labelled and never filled (Decision 16's rule for such lists); the phone's box is labelled by its intphone
 *   label.
 * - Repeatables: Education and Employment, each entry its own block (the controls named <name>-field-<n>); Add
 *   Institution and Add Employer are never offered (no entry is added: Decision 16, Q7-11), nor Remove, Clear Contents
 *   or an opt-out box pressed by a rule of ours.
 * - PC7-06, success: #ats-portal's h1 "Application Submitted!" beside the portal's "Export Application" or "Set Up
 *   Password" button (this tenant's confirmation: Jobright's own companion paragraph is not there), read only after a
 *   Submit armed in the document; neither button is ever pressed.
 * - PC7-07 (gated Q7-10): the Authorization's required signature pad is the person's: Draw, Type and Clear are never
 *   pressed, and while its prompt shows (nothing drawn) it is a required block left (requiredBlocksLeft), so Submit
 *   Auto holds and the review shows it.
 * - Entry: the posting's shown Apply (button[data-testid=Apply-loadingbutton], reading "Apply", while no dialog shows:
 *   Jobright's createPaycomEntryAdapter); the contact dialog is drawn at the posting's own address (formAtPosting).
 * - Never pressed: Cancel, Save and Complete Later, Autofill with Resume/CV, Set Up Password, Export Application,
 *   Clear Contents, Clear, Remove, Show More, the side-nav, Careers, My Account, Sign In, Create Account, Draw, Type,
 *   the uploaded résumé's menu and the date pickers.
 */
import { newScanCache } from '../../dom/scan-cache';
import { isUserVisible } from '../../dom/visibility';
import { configuredHooks } from '../configured';
import type { AtsConfig, ConfiguredHooks } from '../configured/types';
import type { DatePartsDecl } from '../types';
import { parsePaycomUrl } from './url';

/** The cases the config was read from (fixtures/paycom/<case>.html). */
export const PAYCOM_SNAPSHOTS = ['jr7-paycomonline1-posting', 'jr7-paycomonline1-account', 'jr7-paycomonline1-prescreen',
  'jr7-paycomonline1-apply-1', 'jr7-paycomonline1-apply-2', 'jr7-paycomonline1-apply-3', 'jr7-paycomonline1-signature',
  'jr7-paycomonline1-confirmation'] as const;

/** The portal's root (prescreen, apply-1 to -3, signature, confirmation): <div id="ats-portal">. */
const PORTAL = '#ats-portal';
/** apply-1: <div class="uiLibModalBody …" role="dialog"> holding "Autofill with Resume/CV" and "Apply Manually", each
 *  <button data-testid="undefined-loadingbutton">, and no field. */
const START_DIALOG = '[role="dialog"]:has(button[data-testid="undefined-loadingbutton"]):not(:has(input, select, textarea))';
/** account: <div class="uiLibModalBody …" role="dialog"> with <input id="firstName" name="firstName"> … <input
 *  id="email" name="email">. */
const CONTACT_DIALOG = '[role="dialog"]:has(input[name="firstName"]):has(input[name="email"])';
/** account: <button data-testid="createAccountNextButton-loadingbutton">Continue To Application</button>; Jobright's
 *  getPaycomContactDialog names submitApplication-loadingbutton for other tenants. */
const CONTINUE = `${CONTACT_DIALOG} button[data-testid="createAccountNextButton-loadingbutton"], `
  + `${CONTACT_DIALOG} button[data-testid="submitApplication-loadingbutton"]`;
/** prescreen: <div data-testid="BottomButtonLayout"> … <button data-testid="undefined-loadingbutton">Next</button>. */
const NEXT = `${PORTAL} div[data-testid="BottomButtonLayout"] button[data-testid="undefined-loadingbutton"]`;
/** apply-1 to -3: the portal's loading buttons, "Save and Complete Later" and "Submit". */
const PORTAL_LOADING = `${PORTAL} button[data-testid="undefined-loadingbutton"]`;
/** Submit's words (Jobright 1.25.2 m/ats-rules.js `paycomonline` buttonText). */
const SUBMIT_WORDS = /^(?:Submit|Submit Application|Sign and Submit)$/;
/** The buttons never pressed by their words (they share test ids with buttons that are pressed). */
const NEVER_WORDS = /^(?:Cancel|Save and Complete Later|Autofill with Resume\/CV|Set Up Password|Export Application|Clear Contents|Clear|Remove|Show More|Careers|My Account|Sign In|Create Account|Draw|Type)$/;
/** signature: <div id="authorization-signature-image-field"> (Draw, Type, Clear, the canvas and its prompt). */
const SIGNATURE = '#authorization-signature-image-field';

/** An element's words, white space folded. */
const wordsOf = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The buttons matching `css` in `doc` a person sees, enabled, whose words read `words`. */
function buttonsByWords(doc: Document, css: string, words: RegExp): HTMLElement[] {
  const cache = newScanCache();
  return Array.from(doc.querySelectorAll<HTMLElement>(css)).filter((button) => words.test(wordsOf(button))
    && !(button as HTMLButtonElement).disabled && isUserVisible(button, cache));
}

/** The rules, each naming its case (the header). */
const RULES: AtsConfig = {
  platform: 'paycom',
  ...(__PROVENANCE__ && { snapshots: PAYCOM_SNAPSHOTS }),
  parse: parsePaycomUrl,
  // No matchesUrl of its own: the configured layer's default, src/shared/hosts.ts's candidate paths (platformOfUrl), so
  // the host's employee pages (/v4/ee/, /v4/cl/) are never Paycom's (the HR host rule; url.ts's matchesUrl is the
  // host's alone).
  states: [
    // PC7-05, apply-1: the Start Application dialog; its entry is "Apply Manually" (code: entryControl, by its words);
    // both its buttons are the entry door's alone (never a run's).
    { name: 'start-choice', when: START_DIALOG, auth: 'entry-choice',
      entry: `${START_DIALOG} button[data-testid="undefined-loadingbutton"]`,
        ...(__PROVENANCE__ && { from: 'jr7-paycomonline1-apply-1' }) },
    // PC7-05 (the verifier's correction), account: the contact dialog, filled like a step; its Continue To Application
    // makes the account: Sign-in Auto's (signInContainer), never Next.
    { name: 'contact', when: CONTACT_DIALOG, root: CONTACT_DIALOG,
      signInContainer: { container: CONTACT_DIALOG, button: CONTINUE },
        ...(__PROVENANCE__ && { from: 'jr7-paycomonline1-account' }) },
  ],
  // PC7-01, prescreen and apply-1 to -3: <div id="ats-portal"> holding <div id="personal-information-section"> … or
  // <div id="questions-98573-field">; confirmation: the same root, no section, no question.
  root: { css: PORTAL, holds: '[id$="-section"], div[id^="questions-"][id$="-field"]',
    ...(__PROVENANCE__ && { from: 'jr7-paycomonline1-prescreen, jr7-paycomonline1-apply-2, jr7-paycomonline1-confirmation' }) },
  sections: [
    // apply-2: <div id="education-section"> … <h1><span …>Education</span></h1>; employment-section "Employment"; the
    // others named by their own h1 (Personal Information, Questions, Voluntary Information, Authorization).
    { container: '#education-section', heading: 'h1', kind: 'education',
      ...(__PROVENANCE__ && { from: 'jr7-paycomonline1-apply-2' }) },
    { container: '#employment-section', heading: 'h1', kind: 'experience',
      ...(__PROVENANCE__ && { from: 'jr7-paycomonline1-apply-2' }) },
    { container: '#personal-information-section, #questions-section, #voluntaryInformation-section, #authorization-section',
      heading: 'h1', ...(__PROVENANCE__ && { from: 'jr7-paycomonline1-apply-2' }) },
  ],
  required: [
    // prescreen, apply-2: the title's star, <span style="color: rgb(211, 47, 47);">*</span>; a text box's label
    // <label …>Legal First Name<span class="… css-1j28w4o"> *</span></label> (MUI's asterisk).
    { mark: 'span[style*="211, 47, 47"]', ...(__PROVENANCE__ && { from: 'jr7-paycomonline1-prescreen' }) },
    { mark: 'label > span.MuiFormLabel-asterisk, label > span[class*="css-1j28w4o"]',
      ...(__PROVENANCE__ && { from: 'jr7-paycomonline1-apply-2' }) },
  ],
  widgets: [
    // apply-2: <div class="uiLibCountryList …" aria-label="Country combo box"><label …>Country</label> … <button
    // data-testid="button" aria-label="Country combo box, … selected.">: a list no capture shows open.
    { match: 'div.uiLibCountryList', root: true, kind: 'combobox', opener: 'button',
      ...(__PROVENANCE__ && { from: 'jr7-paycomonline1-apply-2' }) },
  ],
  checked: [
    // prescreen: <div class="uiLibRadio ui-radio-lg"> (chosen: ui-radio-checked, T7-01's mark) around the radio.
    { input: 'input.uiLibRadioInput', holder: '.uiLibRadio', chosen: '.ui-radio-checked',
      ...(__PROVENANCE__ && { from: 'jr7-paycomonline1-prescreen' }) },
  ],
  proxies: [
    // prescreen: <label class="uiLibRadioLabel …" for="<radio id>"> around the radio (opacity 0) and its drawn words.
    { input: 'input.uiLibRadioInput', proxy: 'label.uiLibRadioLabel', scope: '.uiLibRadio',
      ...(__PROVENANCE__ && { from: 'jr7-paycomonline1-prescreen' }) },
    // apply-2: <label class="uiLibCheckbox …" for="i-do-not-have-a-middle-name"> … <button id="CheckboxOuterID-…"
    // class="uiLibCheckboxButton …" role="checkbox" aria-label="I do not have a middle name" aria-checked="false"> …
    // <input id="i-do-not-have-a-middle-name" class="uiLibCheckboxInput" type="checkbox" aria-hidden="true"
    // style="display: none;">.
    { input: 'input.uiLibCheckboxInput', proxy: 'button.uiLibCheckboxButton[role="checkbox"]', scope: 'label.uiLibCheckbox',
      ...(__PROVENANCE__ && { from: 'jr7-paycomonline1-apply-2' }) },
  ],
  uploads: [
    // apply-1: the résumé,
    // <div id="personal-information-resume-field" role="button" aria-label="Resume/CV"> … <div
    // class="uiLibFileUploadCloudDropzone"> … <div role="button" tabindex="0"> "Upload a File" … <input type="file"
    // accept=".pdf,.doc,.docx,.txt,.ppt,.pptx">.
    { input: '#personal-information-resume-field input[type="file" i]',
      control: '.uiLibFileUploadCloudDropzone [role="button"]', area: '#personal-information-resume-field',
      ...(__PROVENANCE__ && { from: 'jr7-paycomonline1-apply-1' }) },
  ],
  steps: {
    // apply-2: the first section's <h1><span …>Personal Information</span></h1>; prescreen: "Let's Get Started!".
    heading: `${PORTAL} h1`,
    next: NEXT,
    ...(__PROVENANCE__ && { from: 'jr7-paycomonline1-prescreen, jr7-paycomonline1-apply-2' }),
  },
  // apply-2: the portal's loading buttons; Submit by its words (code).
  submit: { css: PORTAL_LOADING, ...(__PROVENANCE__ && { from: 'jr7-paycomonline1-apply-2' }) },
  neverPress: [
    // prescreen: the BottomButtonLayout's <button data-testid="button">Cancel</button>.
    { css: `${PORTAL} div[data-testid="BottomButtonLayout"] button[data-testid="button"]`,
      ...(__PROVENANCE__ && { from: 'jr7-paycomonline1-prescreen' }) },
    // apply-2: the side-nav's <button data-testid="sideNavMainItemButton">, the header's My Account
    // (<button data-testid="iconbutton">My Account</button>) and Careers.
    { css: 'button[data-testid="sideNavMainItemButton"]',
      ...(__PROVENANCE__ && { from: 'jr7-paycomonline1-apply-2' }) },
    // posting, account: "Sign In" and "Create Account" in the header and the dialog (<div role="link"
    // data-testid="signInClickableTextClickableText">, createAccountClickableTextClickableText).
    { css: '[data-testid="signInClickableTextClickableText"], [data-testid="createAccountClickableTextClickableText"]',
      ...(__PROVENANCE__ && { from: 'jr7-paycomonline1-account' }) },
    // apply-2: the uploaded résumé's menu, <div data-testid="dropdown"> <button data-testid="iconbutton">, in the
    // Document Upload; every date's "… Date Picker" button.
    { css: '#personal-information-section [data-testid="dropdown"] button[data-testid="iconbutton"]',
      ...(__PROVENANCE__ && { from: 'jr7-paycomonline1-apply-2' }) },
    { css: 'button[aria-label$="Date Picker"]', ...(__PROVENANCE__ && { from: 'jr7-paycomonline1-apply-2' }) },
    // signature: the pad's Draw, Type and Clear (PC7-07: the person's until Q7-10).
    { css: `${SIGNATURE} button`, ...(__PROVENANCE__ && { from: 'jr7-paycomonline1-signature' }) },
    // apply-2: Show More, <button data-testid="authorization-legalese-text-region">.
    { css: 'button[data-testid="authorization-legalese-text-region"]',
      ...(__PROVENANCE__ && { from: 'jr7-paycomonline1-apply-2' }) },
  ],
  // PC7-06, confirmation: <h1><span …>Application Submitted!</span></h1> in the portal, beside "Set Up Password" and
  // "Export Application" (<button data-testid="button">); Jobright 1.25.2's m/ats-rules.js paycom-portal-application-
  // submitted names the h1 too, its companion paragraph absent on this tenant (measured 0).
  success: { css: `${PORTAL} h1`, text: /^Application Submitted!?$/,
    companion: { css: `${PORTAL} button`, text: /^(?:Export Application|Set Up Password)$/, scope: PORTAL },
    ...(__PROVENANCE__ && { from: 'jr7-paycomonline1-confirmation' }) },
  // posting: <button data-testid="Apply-loadingbutton">Apply</button> (two copies, one shown): Jobright's
  // createPaycomEntryAdapter presses the shown one reading "Apply" while no dialog shows.
  posting: { entry: 'button[data-testid="Apply-loadingbutton"]',
    ...(__PROVENANCE__ && { from: 'jr7-paycomonline1-posting' }) },
  // account: the contact dialog is drawn at the posting's own address.
  quirks: { formAtPosting: true },
};

/** The rule-built hooks the code below falls back to. */
const ruled = configuredHooks(RULES);

// ── Labels ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** A field's own container: the element whose id names the field (prescreen: <div id="questions-98573-field">, its
 *  radios name="questions-98573-field"; apply-2: <div id="education-currently-enrolled-field-2">), or the control. */
function fieldOf(control: Element): Element {
  const name = control.getAttribute('name');
  if (name !== null && name !== '') {
    const named = control.closest(`[id="${CSS.escape(name)}"]`);
    if (named !== null && named !== control) return named;
  }
  return control;
}

/** A control a person can reach: no aria-hidden or hidden input (MUI's autosize twins of a textarea are aria-hidden). */
const reachable = (el: Element) => el.closest('[aria-hidden="true"]') === null && !el.matches('input[type="hidden" i]');

/** A question's title column: the nearest preceding sibling with words (a star alone is none) of the field or of an
 *  ancestor that holds no other field's control, never past a section, the portal or a dialog (prescreen: the column
 *  of "1 . * Are you …" before the radios' column; apply-2: "Currently Enrolled" before its group; the texts consent's
 *  question before its group; a text question's column before the textarea's). */
function titleColumnOf(field: Element): Element | null {
  const own = new Set(field.matches('input, select, textarea') ? [field]
    : Array.from(field.querySelectorAll('input, select, textarea')));
  for (let at: Element | null = field, depth = 0; at !== null && depth < 12; at = at.parentElement, depth += 1) {
    if (at.matches('[id$="-section"], #ats-portal, [role="dialog"]')) return null;
    if (Array.from(at.querySelectorAll('input, select, textarea')).some((el) => !own.has(el) && reachable(el))) return null;
    for (let before = at.previousElementSibling; before !== null; before = before.previousElementSibling) {
      if (Array.from(before.querySelectorAll('input, select, textarea')).some(reachable)) return null;
      // A decoration no person reads is no title (apply-2's Ethnicity, a native select whose <label for=""> names no
      // id: MUI's notched outline, <fieldset aria-hidden="true"> repeating the label's words at opacity 0, stands
      // between the select and its <label class="uiLibNativeSelectLabel …"><span …>Ethnicity</span></label>).
      if (before.closest('[aria-hidden="true"]') !== null) continue;
      const words = wordsOf(before);
      // Words a person reads: a letter or a digit (MUI's notched outline's legend holds a zero-width space alone).
      if (/[\p{L}\p{N}]/u.test(words) && before.querySelector('button') === null) return before;
    }
  }
  return null;
}

/** The question's words in a title "N . * question" (prescreen: <p data-testid="typography">1 .<span style="color:
 *  rgb(211, 47, 47);">*</span><span style="vertical-align: text-top;">Are you …</span></p>): the last span that is
 *  not the star; the title itself where it has no such span. */
function questionWordsIn(title: Element): Element {
  const p = title.matches('p') ? title : title.querySelector('p[data-testid="typography"]') ?? title;
  const spans = Array.from(p.children).filter((child) => child.localName === 'span' && wordsOf(child) !== '*');
  return spans.at(-1) ?? p;
}

/** The phone's visible label (apply-2: <div role="textbox" aria-label="Primary Phone Number"><div class="uiLibIntPhone
 *  …"><div class="uiLibCountryListContainer …"><span …>Primary Phone Number</span>). */
function phoneLabelOf(control: Element): Element | null {
  return control.closest('.uiLibIntPhone')?.querySelector(':scope > .uiLibCountryListContainer > span') ?? null;
}

/** Labels no tie gives (the header): the country combo box's <label>, the phone's, a date's drawn label, and a
 *  question's or a yes/no group's title beside its field. */
function labelFor(control: Element): Element | null {
  // A drawn radio is an option: its words are its own label's (ENGINE-7 E1 item 5), never its question's.
  if (control.matches('input.uiLibRadioInput')) return null;
  if (control.matches('div.uiLibCountryList')) return control.querySelector('label');
  // A date's drawn label beside its facade (apply-2: <div class="uiLibDateInputLabel …">Start Date</div>), else its
  // question's title (the Questions section's "What is your earliest availability to start?").
  const dated = control.matches('div.uiLibDateInputFacade')
    ? control.parentElement?.querySelector(':scope > .uiLibDateInputLabel') ?? null : null;
  if (dated !== null && wordsOf(dated) !== '') return dated;
  const phone = phoneLabelOf(control);
  if (phone !== null) return phone;
  const field = fieldOf(control);
  const title = titleColumnOf(field);
  if (title !== null) return questionWordsIn(title);
  return ruled.labelFor?.(control) ?? null;
}

/** A drawn radio's words (prescreen: <label class="uiLibRadioLabel …" for="<radio id>"> … <p data-testid="typography"
 *  aria-hidden="true" …>Yes</p>, the radio's aria-label "Yes 1 of 2."): its own label's drawn <p>; null for any other
 *  control. ENGINE-7 E1 item 5 (labels.ts hiddenOwnLabelSays) decides whether a person sees them. */
function optionTextFor(input: HTMLInputElement): string | null {
  if (!input.matches('input.uiLibRadioInput') || input.id === '') return null;
  const label = input.ownerDocument.querySelector(`label.uiLibRadioLabel[for="${CSS.escape(input.id)}"]`);
  const drawn = label?.querySelector('p[data-testid="typography"]') ?? null;
  return drawn === null || wordsOf(drawn) === '' ? null : wordsOf(drawn);
}

/** A star a person sees (signature, apply-2: <span style="color: rgb(211, 47, 47);">*</span>) inside `place`. */
const starIn = (place: Element | null | undefined) => place !== null && place !== undefined
  && Array.from(place.querySelectorAll('span[style*="211, 47, 47"]')).some((star) => wordsOf(star) === '*'
    && isUserVisible(star));

/** Required: the rules' marks; a box's star drawn just after its label (apply-2: the Authorization's acknowledgement,
 *  <label class="uiLibCheckbox …" for="authorization-acknowledge-disclosure-field"> … </label><span style="margin-left:
 *  -16px;"><span style="color: rgb(211, 47, 47);">*</span></span>); or the star in a question's title column. */
function requiredFor(control: Element): boolean {
  if (ruled.requiredFor?.(control) === true) return true;
  if (control.matches('input.uiLibCheckboxInput') && starIn(control.closest('label.uiLibCheckbox')?.nextElementSibling)) {
    return true;
  }
  return starIn(titleColumnOf(fieldOf(control)));
}

// ── Boxes and dates ──────────────────────────────────────────────────────────────────────────────────────────────

/** A text box's or a native select's drawn box (the header): MUI's outlined border, the aria-hidden <fieldset> beside
 *  the control in its input root (apply-2: <div class="jssPortal92 …"><fieldset aria-hidden="true" class="…"> …
 *  </fieldset><input …></div>; <div class="uiLibNativeSelectBase …"><fieldset aria-hidden="true" …> <div
 *  class="uiLibNativeSelectContainer …"><select …>); null for any other control. */
function controlBox(control: Element): Element | null {
  if (!control.matches('input[type="text" i], input:not([type]), textarea, select.uiLibNativeSelect')) return null;
  for (let at = control.parentElement, depth = 0; at !== null && depth < 3; at = at.parentElement, depth += 1) {
    const outline = at.querySelector(':scope > fieldset[aria-hidden="true"]');
    if (outline !== null) return outline;
  }
  return null;
}

/** A date drawn in three boxes (apply-2: <div id="education-start-date-field-2" role="textbox" aria-label="Start Date">
 *  <div class="uiLibDateInput …"><div class="uiLibDateInputLabel …">Start Date</div><div class="uiLibDateInputFacade
 *  …"> … <input id="education-start-date-field-2-month" placeholder="MM"> <input id="…-day" placeholder="DD"> <input
 *  id="…-year" placeholder="YYYY">): one date, its element the facade (the bordered box a person sees around the three
 *  boxes), its parts in the order drawn; null for any other element. */
function dateFor(control: Element): DatePartsDecl | null {
  if (!control.matches('div.uiLibDateInputFacade')) return null;
  const host = control.closest('div[role="textbox"][id]');
  if (host === null) return null;
  const parts = (['month', 'day', 'year'] as const).flatMap((part) => {
    const input = control.querySelector<HTMLInputElement>(`input[id="${CSS.escape(`${host.id}-${part}`)}"]`);
    return input === null ? [] : [{ part, input, display: null }];
  });
  return parts.length === 0 ? null : { parts, ...(__PROVENANCE__ && { snapshot: 'jr7-paycomonline1-apply-2' }) };
}

/** The elements the scanner takes as candidates besides its ARIA roles: the rules' (the country combo box) and each
 *  date's facade, so the scan asks dateFor of it (a plain <div> is no candidate of its own). */
function widgetRoots(root: Element): Element[] {
  return [...(ruled.widgetRoots?.(root) ?? []), ...Array.from(root.querySelectorAll('div.uiLibDateInputFacade'))];
}

/** Every date's part boxes under `root`: parts of their date, never fields of their own. */
function datePartBoxes(root: Element): Element[] {
  return Array.from(root.querySelectorAll('div.uiLibDateInputFacade')).flatMap((facade) => dateFor(facade)?.parts
    .map((part) => part.input) ?? []);
}

// ── Steps, entry, never-press ────────────────────────────────────────────────────────────────────────────────────

/** Submit, by its words (the header). */
function submitButton(root: Element): HTMLElement | null {
  return buttonsByWords(root.ownerDocument, PORTAL_LOADING, SUBMIT_WORDS)[0] ?? null;
}

/** The pre-screen's Next, by its words. */
function nextOf(doc: Document): HTMLElement | null {
  return buttonsByWords(doc, NEXT, /^Next$/)[0] ?? null;
}

/** The page state shown, by name (the rule-built step signature names it `state:<name>`), or null for the application. */
function stateShown(doc: Document): string | null {
  const anchor = ruled.stepSignature?.(doc).anchors[0] ?? '';
  return anchor.startsWith('state:') ? anchor.slice('state:'.length) : null;
}

/** Whether the shown step is the last: a state's own answer while one shows (the contact dialog: not-final while its
 *  Continue shows; the start choice: unknown); else final when Submit shows and Next does not, not-final the other way
 *  round, unknown otherwise (no root: unknown). */
function isFinalStep(doc: Document): 'final' | 'not-final' | 'unknown' {
  if (stateShown(doc) !== null) return ruled.isFinalStep?.(doc) ?? 'unknown';
  const found = ruled.detect(doc);
  if (found === null) return 'unknown';
  const submit = submitButton(found.formRoot) !== null;
  const next = nextOf(doc) !== null;
  if (submit && !next) return 'final';
  if (next && !submit) return 'not-final';
  return 'unknown';
}

/** Next: none while a state shows (the contact dialog's button is Sign-in mode's), else the pre-screen's by its words. */
function nextButton(root: Element): HTMLElement | null {
  const doc = root.ownerDocument;
  return stateShown(doc) !== null ? null : nextOf(doc);
}

/** The entry: on the Start Application dialog its "Apply Manually" (by its words); on the posting, the shown Apply
 *  reading "Apply" while no dialog shows (Jobright's createPaycomEntryAdapter). */
function entryControl(doc: Document): HTMLElement | null {
  if (ruled.authState?.(doc) === 'entry-choice') {
    return buttonsByWords(doc, `${START_DIALOG} button[data-testid="undefined-loadingbutton"]`, /^Apply Manually$/)[0]
      ?? null;
  }
  const entry = ruled.entryControl?.(doc) ?? null;
  if (entry === null || !/^Apply$/.test(wordsOf(entry))) return null;
  const cache = newScanCache();
  return Array.from(doc.querySelectorAll('[role="dialog"]')).some((dialog) => isUserVisible(dialog, cache)) ? null : entry;
}

/** Never pressed: the rules' and the buttons named by their words (the header). */
function neverPress(root: Element): Element[] {
  const doc = root.ownerDocument;
  const byWords = Array.from(doc.querySelectorAll<HTMLElement>('button, [role="link"], [role="button"]'))
    .filter((el) => NEVER_WORDS.test(wordsOf(el)));
  return [...new Set([...(ruled.neverPress?.(root) ?? []), ...byWords])];
}

/** The parts no question holds: the rules' and every date's part boxes (each its date's). */
function excluded(root: Element): Element[] {
  return [...(ruled.excluded?.(root) ?? []), ...datePartBoxes(root)];
}

// ── Repeatables ──────────────────────────────────────────────────────────────────────────────────────────────────

/** A control's entry number (apply-2: …-field-2, …-checkbox-2), or null. */
const entryOf = (el: Element) => /-(?:field|checkbox)-(\d+)(?:-(?:month|day|year))?$/.exec(el.id || el.getAttribute('name')
  || '')?.[1] ?? null;

/** The blocks of a section: for each entry number its controls name, the highest element holding that entry's controls
 *  and no other entry's (apply-2: one per institution, one per employer), in page order. */
function blocksOf(section: Element): Element[] {
  const numbered = Array.from(section.querySelectorAll('input, select, textarea')).filter((el) => entryOf(el) !== null);
  const entries = [...new Set(numbered.map((el) => entryOf(el)!))];
  const holds = (el: Element) => new Set(Array.from(el.querySelectorAll('input, select, textarea'))
    .map((each) => entryOf(each)).filter((entry): entry is string => entry !== null));
  return entries.flatMap((entry) => {
    let block: Element | null = numbered.find((el) => entryOf(el) === entry) ?? null;
    while (block !== null && block.parentElement !== null && block.parentElement !== section) {
      const up = holds(block.parentElement);
      if (up.size !== 1) break;
      block = block.parentElement;
    }
    return block === null ? [] : [block];
  });
}

/** Education and Employment as repeatables (the header): no Add (Decision 16, Q7-11), no Save (the page keeps each
 *  entry as typed: its Submit sends them). A section the page does not show declares nothing. */
function repeatables(root: Element): ReturnType<NonNullable<ConfiguredHooks['repeatables']>> {
  return ([['education', '#education-section'], ['experience', '#employment-section']] as const).flatMap(([kind, css]) => {
    const section = root.querySelector(css);
    return section === null ? [] : [{ kind, blocks: () => blocksOf(section), addButton: () => null }];
  });
}

// ── PC7-07: the signature (gated Q7-10) ──────────────────────────────────────────────────────────────────────────

/** The Authorization's required signature, while it shows its prompt ("Draw with your finger or mouse": nothing drawn
 *  yet): a required block left, the person's (signature: <div id="authorization-signature-image-field"> … <canvas>
 *  … <h1 …>Draw with your finger or mouse</h1>). Its block is the signature's question (<h4>Signature<span …>*</span>
 *  </h4> and the pad). Nothing is drawn or typed there (Q7-10). */
function requiredBlocksLeft(root: Element): Element[] {
  const cache = newScanCache();
  return Array.from(root.ownerDocument.querySelectorAll(SIGNATURE)).flatMap((pad) => {
    const prompt = Array.from(pad.querySelectorAll('h1')).some((h1) => /^Draw with your finger or mouse$/.test(wordsOf(h1))
      && isUserVisible(h1, cache));
    if (!isUserVisible(pad, cache) || !prompt) return [];
    let block: Element | null = pad;
    for (let at = pad.parentElement; at !== null && !at.matches('[id$="-section"]'); at = at.parentElement) {
      if (Array.from(at.querySelectorAll('h4')).some((h4) => /^Signature\b/.test(wordsOf(h4)))) {
        block = at;
        break;
      }
    }
    return block === null ? [] : [block];
  });
}

/** Paycom's config: the rules, and the hooks no rule can say. */
export const PAYCOM_CONFIG: AtsConfig = { ...RULES, code: { labelFor, optionTextFor, requiredFor, controlBox, dateFor,
  widgetRoots, excluded, submitButton, nextButton, isFinalStep, entryControl, neverPress, repeatables,
  requiredBlocksLeft } };
