/*
 * The Workable adapter (docs/design/runtime.md §9; docs/ARCHITECTURE.md "Adapters", "Workable"): the quirks of
 * apply.workable.com's application form (/<account>/j/<SHORTCODE>/apply/) and its posting's overview. Every hook was
 * read from the live capture of 2026-11-02 (docs/FIXTURES.md, "The Workable capture"; its closed forms are
 * fixtures/workable/*-closed.html, its states the other fixtures/workable/*.html) and names the markup it relies on. The
 * page is client-rendered React: the form is drawn 4.6 to 7.5 s after the page loads, in one render with its handlers
 * (quirks.formLateMs: the runtime's 30 s cap), and never rebuilt after it settles; the ids of its radios, checkboxes,
 * groups and uploads are drawn afresh on every render (the nodes are kept). Nothing is saved to Workable's server before
 * Submit (autosaves stays off), but every answer is kept in the browser's own storage for an hour and comes back on a
 * reload (docs/PRIVACY.md); the Address box is prefilled from the visitor's IP.
 * - Form root: form[data-ui=application-form] once it holds its fields ([data-ui=section-fields]). It holds the
 *   "Autofill application" box ([data-ui=autofill-button]'s "Import resume from", which parses a resume on Workable's
 *   side and rewrites the form: excluded, so nothing in it is a field, and never pressed), "* Required fields", each
 *   section[data-ui=section] and Submit.
 * - Questions: each field's title row is a span[id$=_label] (firstname_label, CA_<n>_label, QA_<n>_label, a group's
 *   <id>_label), drawn after a span holding a strong "*" when the question is required, or before " (Optional)". Text,
 *   email and textarea name it in aria-labelledby; a dropdown's text box too; a group's fieldset or role=group too; the
 *   number box and the date box sit in a <label> that wraps the star, the title and the box, with no aria-labelledby, so
 *   the title is the adapter's label (labelFor; the scanner prefers it inside the wrapping label, star left out). The
 *   phone's country button is labelled by the phone's title with "country code" (labelSuffix), so it reads as the
 *   phone's country. A file input names "<id>_label description_input_<id>": its question and its own "Choose file"
 *   button, a label[for] with role=button (the upload widget, which never labels its input: Resume and Photo stay apart).
 *   The consent box sits in two nested labels: its text is the one its role=checkbox names (labelFor). Required is the
 *   star (requiredFor; a dropdown's required attribute sits on its hidden value input), and always for the GDPR consent,
 *   which Workable refuses an application without though the page marks nothing (its form's API says required and only
 *   true allowed). Help text is the field's [id$=_helper] (the Address and the Phone).
 * - Sections: each section[data-ui=section] by its h2[id$=_section_name] ("Personal information", "Profile",
 *   "Details"); one with no heading (the GDPR consent's) as the section before it.
 * - Widgets (widgetFor; widgetRoots):
 *   - a dropdown (div[data-input-type=select] > label > input[role=combobox][readonly=true], the select's id
 *     input_<id>_input): select-only, its text box read-only by design (readOnlyBox), opened by click() on that box
 *     (mousedown, focus and Space open nothing), its list drawn in place in a non-modal dialog inside the field and
 *     named by aria-controls, an option chosen by click() (its label [data-role=option-label]); its first option is
 *     marked active before anything is chosen (highlightIsNoChoice). Focus moves to the list when it opens, and only an
 *     Escape there (keyTarget 'list') or a mouseup on the page closes it: focusout, blur and a second click do not;
 *   - the phone's country (intl-tel-input: .iti button.iti__selected-country with aria-expanded and aria-controls, a
 *     widget root): a select-only list of 244 countries ("Canada (+1)"), US, UK, Canada, Germany and Australia first,
 *     opened by click() on the button, an Escape on its list closing it, a click() on a country choosing it; it shows
 *     its answer as the button's title and dial code (shownAnswer).
 * - Radios, Yes/No and checkboxes: hidden inputs (opacity 0, aria-hidden) inside their labels: the label proxy and a
 *   click() on the input, never .checked (it changes the box alone) and never a Yes/No's option div (a click there does
 *   nothing). The answer shows at once as the role=radio or role=checkbox element's aria-checked, the input's own
 *   checked one render later (checkedOf).
 * - Dates (react-datepicker, MM/DD/YYYY, and MM/YYYY in Education and Experience): formatFor, the layout the placeholder
 *   spells in day, month and year tokens (an account's DD/MM/YYYY too: the Phase 7a review; their inputmode="tel" is a
 *   phone keypad, not a layout); a written value is taken only after a keydown, and the page then opens its calendar:
 *   one Escape before the write and one after (keyAroundWrite). Enter is never sent: the mask reads it as today.
 * - Numbers (a salary): a text box with no id and no aria-labelledby, its data-ui its name; Workable draws "85000" as
 *   "85,000" and drops what is no number: formatFor 'number', read back as a number.
 * - Uploads (uploadWidgets): each input[type=file][data-ui] (resume, avatar: Photo) with its "Choose file"
 *   label[role=button][for]. Which input takes the resume is the planner's, by the question each is labelled with.
 *   A file put in goes to Workable's S3 bucket at once (a POST, seen and aborted live on 2026-11-02, after which the
 *   page showed "Sorry, an unknown error occurred." in the form's place), so a pass writes it after every other field
 *   (quirks.filesLast) and waits for the page's word (uploadState): failed when the form is gone or an error by the
 *   upload names the file or its upload, confirmed when the drop zone shows the file's name with a control to remove it
 *   and no error or progress, pending otherwise. No successful upload has been seen live (nothing was uploaded): the
 *   confirmed sign is the synthetic page's (fixtures/synthetic/workable-widgets) until the owner's snapshots of an
 *   upload that worked and one that failed.
 * - Education and Experience (repeatables): each entry is an li of the section's list, its summary once saved, its
 *   editor ([data-ui=editor]) while open; "+ Add" (data-ui=add-section) opens one editor and is disabled while it is
 *   open, so the fill step adds one entry a round; the editor's "Update" (data-ui=save-section) is its save: until it
 *   is pressed the entry is not in the form (content/repeatables.ts saveBlocks presses it after the fill); Experience's
 *   "I currently work here" is its input[name=current]. A saved entry's summary names its school, or its title and
 *   company, and its period (prefill.readEntries), so the planner finds the profile entry it holds by its fingerprint.
 * - Never pressed (neverPress): the autofill box and "Import resume from", every section's Clear, "Choose file" and the
 *   drop zones, a saved entry's Edit and Delete, an editor's Cancel, the cookie banner's buttons and the footer's cookie
 *   settings, the Overview and Application tabs, the company logo, "View all jobs" and "Apply for this job". Submit is
 *   identified (submitButton), so it is never clicked either; the form is one step, so a page showing it is the final
 *   step.
 * - After Submit the page shows [data-ui=successful-submit] (Jobright 1.25.2's selector; not seen live, since nothing
 *   was submitted): workableSubmitted, read by content/submitted.ts after a Submit was pressed.
 * - The posting (postingText): the overview's description, requirements and benefits (section[data-ui=job-*]).
 * - Entry (entryControl): on the overview, "Apply for this job" (a[data-ui=apply-button][role=button]) or the
 *   APPLICATION tab, read by the address it opens; both are never pressed by a run (entryNeverPressed).
 * The owner's captures of 2026-11-06 (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06) add:
 * - An upload that worked (uploadState: fixtures/workable/raydar-attached.html): the drop zone shows the file's name cut
 *   in two spans, <div data-id="filename"><span>HEAD</span><span>TAIL</span></div>, beside <a data-action="view"
 *   href="<the file's signed storage address>" aria-label="view NAME"> and <button data-action="delete" aria-label="delete
 *   NAME"> (the converter redacts NAME and the address). The confirmed sign is now this page's, no longer only the
 *   synthetic page's guess.
 * - Workable's job-search site, jobs.workable.com/view/<id>/<slug> (fixtures/workable/jobs-salvo-apply.html): the
 *   posting's page, showing the same application form in a modal dialog at the same address (both captures show it
 *   open, the page's "Apply now", button[data-ui=overview-apply-now], behind it): <dialog role="dialog"
 *   aria-modal="true" ...><h2 data-ui="application-form-title">Apply
 *   for TITLE</h2> ... <div data-ui="application-form-actions"><button data-ui="application-form-cancel">Cancel</button>
 *   <button data-ui="application-form-submit">Submit application</button></div> ... <form data-ui="application-form">
 *   ... the same sections, fields, uploads and <button data-ui="apply-button" type="submit">Submit application</button>
 *   (its CSS module classes spelled styles__x--hash, not styles--hash: nothing here reads them). Every hook above
 *   reads it as it is; Submit is the form's own, and the dialog's own Cancel and Submit beside the title, the page's
 *   "Apply now" (overview-apply-now, sticky-apply-now), "Share job" and "Search for jobs" are never pressed. The
 *   posting (postingText) is its job breakdown: [data-ui=job-breakdown-description-parsed-html] and
 *   [data-ui=job-breakdown-requirements-parsed-html], side by side. No entryControl there: TailorIT's agent does not
 *   queue Workable, and no capture shows what "Apply now" does but the dialog already open.
 * Nothing here reads, logs or sends a value.
 */
import { newScanCache, type ScanCache } from '../../dom/scan-cache';
import { TEXT_CAP_LABEL } from '../../dom/thresholds';
import { visibleText } from '../../dom/visible-text';
import { isUserVisible } from '../../dom/visibility';
import { applicationLinkOf } from '../entry';
import { genericAdapter } from '../generic';
import type { ShownCategory } from '../../core/steps/blocks';
import type { Adapter, PrefillEntryView, UploadState, WidgetDecl } from '../types';
import { canonicalApplicationUrl, matchesUrl, parseWorkableUrl } from './url';

/** The closed forms of the capture (2026-11-02), which the hooks name. */
export const WORKABLE_SNAPSHOTS = ['fixtures/workable/labella-closed.html', 'fixtures/workable/cloudfactory-closed.html',
  'fixtures/workable/verneek-closed.html', 'fixtures/workable/blueground-closed.html',
  'fixtures/workable/blueground-at-closed.html', 'fixtures/workable/huggingface-closed.html',
  'fixtures/workable/cvector-closed.html'] as const;

/** How long the content runtime waits for the form: the live form was drawn 4.6 to 7.5 s after the page loaded on one
 *  fast headless connection (the capture's inventory logs), so the runtime's own cap (late-form.ts, 30 s). */
export const WORKABLE_FORM_LATE_MS = 30_000;

/** The application form. */
const FORM = 'form[data-ui="application-form"]';
/** The parts of the form that hold its questions: each section's fields, and an Education or Experience editor. */
const FIELDS = '[data-ui="section-fields"], [data-ui="editor"]';
/** A question's title. */
const TITLE = 'span[id$="_label"]';
/** A date box (react-datepicker). */
const DATE_BOX = '.react-datepicker__input-container input';

/** Workable's application form in a document, or null while it shows none (before its first render, after Submit). */
function formOf(doc: Document): Element | null {
  // fixtures/workable/*-closed.html: <form class="styles--2I-rr" data-ui="application-form"> ... <section
  // data-ui="section" ...> ... <div class="styles--1jc0L" data-ui="section-fields"> ...
  const form = doc.querySelector(FORM);
  return form !== null && form.querySelector('[data-ui="section-fields"]') !== null ? form : null;
}

/** The visible text of an element on one line, capped as a label. */
function textOf(el: Element, cache: ScanCache): string {
  return visibleText(el, { singleLine: true, cap: TEXT_CAP_LABEL, cache });
}

/** Node.DOCUMENT_POSITION_FOLLOWING, without reaching for a page global. */
const FOLLOWING = 4;

/** Whether `a` stands before `b` in the document. */
const before = (a: Element, b: Element) => a !== b && !a.contains(b) && (a.compareDocumentPosition(b) & FOLLOWING) !== 0;

/** The title of the question a control (or a group's container) answers: the last title row before it in its nearest
 *  ancestor that holds one, inside the section's fields or an editor; null outside every question. */
function titleOf(control: Element): Element | null {
  // fixtures/workable/labella-closed.html: <div class="styles--3IYUq styles--3JEd1"><label class="styles--3aPac"><span
  // class="styles--1-9tY"><span class="styles--33eUF ..."><strong class="styles--2kqW6">*</strong></span><span><span
  // class="styles--QTMDv styles--2TdGW" id="CA_21784_label"><strong ...>Desired salary</strong></span></span></span>
  // <div data-role="illustrated-input" ...><div ...><input aria-required="true" ... data-ui="CA_21784" required=""
  // name="CA_21784" type="text" ...></div></div></label></div>
  const stop = control.closest(FIELDS);
  if (stop === null) return null;
  for (let at = control.parentElement; at !== null && at !== stop; at = at.parentElement) {
    const titles = Array.from(at.querySelectorAll(TITLE)).filter((title) => before(title, control));
    if (titles.length > 0) return titles[titles.length - 1]!;
  }
  return null;
}

/** The text a role=checkbox names for its box (the GDPR consent, "I currently work here"): its aria-labelledby. */
function boxText(input: Element): Element | null {
  // fixtures/workable/blueground-at-closed.html: <label class="styles--3aPac"><label class="styles--2dcpC ..."
  // data-ui="gdpr" data-checked="false"><div class="styles--3muiL styles--3rYh4" aria-labelledby="checkbox_label_<id>"
  // role="checkbox" aria-checked="false" tabindex="0" id="<id>"><input tabindex="-1" aria-hidden="true" ...
  // type="checkbox" name="gdpr" ...> ... </div><span ... id="checkbox_label_<id>">I have read, understand and accept the
  // content of the <a ...>Privacy Notice</a> and consent to the processing of my data as part of this application.
  const box = input.parentElement?.closest('[role="checkbox" i]') ?? null;
  const id = (box?.getAttribute('aria-labelledby') ?? '').trim();
  if (box === null || id === '' || /\s/.test(id)) return null;
  const named = input.ownerDocument.getElementById(id);
  return named !== null && box.closest('label')?.contains(named) === true ? named : null;
}

/** Whether a control is the phone's country button (intl-tel-input). */
const isCountryButton = (control: Element) => control.localName === 'button'
  && control.matches('.iti button.iti__selected-country');

/** Whether a control is a lone box that a role=checkbox names (the GDPR consent, "I currently work here"). */
const isNamedBox = (control: Element) => control.localName === 'input' && (control as HTMLInputElement).type === 'checkbox'
  && control.closest('[role="group" i]') === null && boxText(control) !== null;

/** The form's sections (see the header): each by its heading, one with none as the section before it; the Education
 *  and Experience blocks as their kinds. */
function sections(root: Element): Array<{ el: Element; label: string; kind?: 'education' | 'experience' }> {
  // fixtures/workable/*-closed.html: <section data-ui="section" ...><div class="styles--r7_HT"><h2
  // id="section-0_section_name">Personal information</h2><a ... data-ui="clear-section-0" ...> ...;
  // blueground-at-closed.html's last <section data-ui="section"> holds the GDPR consent alone, with no heading;
  // labella-closed.html: <div class="styles--1YIkW" data-ui="education"><div ...><p id="education_label">Education
  // &nbsp;<small>(Optional)</small></p><button data-ui="add-section" aria-label="Add Education" ...>+ Add</button> ...
  const cache = newScanCache();
  const found: Array<{ el: Element; label: string; kind?: 'education' | 'experience' }> = [];
  let last = '';
  for (const section of Array.from(root.querySelectorAll('section[data-ui="section"]'))) {
    const heading = Array.from(section.querySelectorAll('h2[id$="_section_name"]'))
      .find((h2) => h2.closest('section[data-ui="section"]') === section);
    last = (heading === undefined ? '' : textOf(heading, cache)) || last;
    if (last !== '') found.push({ el: section, label: last });
  }
  for (const kind of ['education', 'experience'] as const) {
    for (const block of Array.from(root.querySelectorAll(`[data-ui="${kind}"]`))) {
      const label = block.querySelector(`#${kind}_label`);
      const text = label === null ? '' : textOf(label, cache);
      if (text !== '') found.push({ el: block, label: text, kind });
    }
  }
  return found;
}

/** The question that labels a control or a group (see the header). */
function labelFor(control: Element): Element | null {
  if (isNamedBox(control)) return boxText(control);
  return titleOf(control);
}

/** "country code" for the phone's country button, which shares its title with the phone number. */
function labelSuffix(control: Element): string | null {
  return isCountryButton(control) ? 'country code' : null;
}

/** The field's help text ([id$=_helper]), where no aria-describedby names it. */
function descriptionFor(control: Element): Element[] {
  // fixtures/workable/blueground-closed.html: <div class="styles--2v-7u"><div class="styles--1VNPc"><span ...
  // id="phone_helper">The hiring team may use this number to contact you about this job.</span></div></div>, the
  // phone's field's last child.
  const title = titleOf(control);
  const stop = control.closest(FIELDS);
  if (title === null || stop === null) return [];
  let wrapper: Element = title;
  while (wrapper.parentElement !== null && wrapper.parentElement !== stop) wrapper = wrapper.parentElement;
  return Array.from(wrapper.querySelectorAll('[id$="_helper"]')).filter((helper) => !helper.contains(control));
}

/** Whether a title row shows the required star: an element a person sees before the title, or before the span that
 *  holds it, whose text is "*" (the title row's <span><strong>*</strong></span>). */
function starred(title: Element): boolean {
  const cache = newScanCache();
  for (const at of [title, title.parentElement]) {
    for (let sibling = at?.previousElementSibling ?? null; sibling !== null; sibling = sibling.previousElementSibling) {
      if ((sibling.textContent ?? '').trim() === '*' && isUserVisible(sibling, cache)) return true;
    }
  }
  return false;
}

/** Whether a control (or a group's container) is required where no attribute says it (see the header). */
function requiredFor(control: Element): boolean {
  // The GDPR consent (fixtures/workable/blueground-at-closed.html, its input name="gdpr" with no required): Workable's
  // form API says required: true, onlyTrueAllowed: true, and the application is refused without it.
  if (control.matches('input[type="checkbox" i][name="gdpr"]')) return true;
  const title = isNamedBox(control) ? null : titleOf(control);
  return title !== null && starred(title);
}

/** A date box's placeholder as a layout: day, month and year tokens and the separators between them. */
const DATE_LAYOUT = /^(?:YYYY|YY|MM|DD|[\s/.-])+$/;

/** The layout a date box's placeholder spells: each of day, month and year once at most, a year always; null for
 *  any other placeholder. */
function dateLayoutOf(placeholder: string): { format: 'date' | 'month-year'; pattern: string } | null {
  if (!DATE_LAYOUT.test(placeholder)) return null;
  const tokens = placeholder.match(/YYYY|YY|MM|DD/g) ?? [];
  const kinds = tokens.map((token) => token.slice(0, 1));
  if (new Set(kinds).size !== kinds.length || !kinds.includes('Y') || !kinds.includes('M')) return null;
  return { format: kinds.includes('D') ? 'date' : 'month-year', pattern: placeholder };
}

/** The layout of a date box or a number box (see the header); null for any other control. */
function formatFor(control: Element): { format: 'date' | 'month-year' | 'number'; pattern?: string } | null {
  if (control.localName !== 'input' || control.closest(FORM) === null) return null;
  // fixtures/workable/cloudfactory-closed.html: <div class="react-datepicker-wrapper"><div
  // class="react-datepicker__input-container"> ... <input type="text" aria-readonly="false" data-ui="CA_3905"
  // inputmode="tel" name="CA_3905" required="" placeholder="MM/DD/YYYY" ...>; the Education editor's
  // (labella-education-editor.html) <input type="text" ... inputmode="tel" name="start_date" placeholder="MM/YYYY" ...>.
  if (control.matches(DATE_BOX)) {
    // The layout its placeholder spells in day, month and year tokens (the Phase 7a review: an account that writes
    // DD/MM/YYYY, or YYYY-MM-DD, is read as it says); a year it must hold.
    return dateLayoutOf((control.getAttribute('placeholder') ?? '').trim().toUpperCase());
  }
  // fixtures/workable/labella-closed.html and verneek-closed.html: <input aria-required="true" ... data-ui="CA_21784"
  // required="" name="CA_21784" type="text" ...>: the number box, the one text box with no id, no inputmode and no
  // placeholder, its data-ui its name.
  const input = control as HTMLInputElement;
  const name = input.getAttribute('name') ?? '';
  if (input.type === 'text' && name !== '' && input.getAttribute('data-ui') === name && !input.hasAttribute('id')
    && !input.hasAttribute('inputmode') && !input.hasAttribute('placeholder') && !input.hasAttribute('role')) {
    return { format: 'number' };
  }
  return null;
}

/** Escape around a date box's write (see the header). */
function keyAroundWrite(control: Element): 'Escape' | null {
  return control.localName === 'input' && control.matches(DATE_BOX) && control.closest(FORM) !== null ? 'Escape' : null;
}

/** Whether a radio or checkbox shows chosen: its role=radio or role=checkbox element's aria-checked, else its label's
 *  data-checked; null outside Workable's form. */
function checkedOf(input: HTMLInputElement): boolean | null {
  // labella-radio-chosen.html: <label ... data-checked="true"><div ... id="wrapper_<id>" role="radio"
  // aria-checked="true" ...><input ... type="radio" ...>; labella-yesno-chosen.html: <div data-ui="option" ...
  // role="radio" aria-checked="true" ...><label><input ... type="radio" value="false">; cloudfactory-checkbox-ticked.html:
  // <label ... data-checked="true"><div ... role="checkbox" aria-checked="true" ...><input ... type="checkbox" ...>.
  if ((input.type !== 'radio' && input.type !== 'checkbox') || input.closest(FORM) === null) return null;
  const role = input.parentElement?.closest('[role="radio" i], [role="checkbox" i]') ?? null;
  const checked = (role?.getAttribute('aria-checked') ?? '').trim().toLowerCase();
  if (checked === 'true' || checked === 'false') return checked === 'true';
  const label = input.closest('label[data-checked]');
  const data = (label?.getAttribute('data-checked') ?? '').trim().toLowerCase();
  return data === 'true' ? true : data === 'false' ? false : null;
}

/** The phone's country buttons: widget roots (a button is no role the scanner collects). */
function widgetRoots(root: Element): Element[] {
  // fixtures/workable/labella-closed.html: <div class="iti iti--input-container ..."><div class="iti__country-container">
  // <button type="button" class="iti__selected-country" aria-expanded="false" aria-label="Change country for phone
  // number, currently selected United States (+1)" aria-haspopup="dialog" aria-controls="iti-0__country-selector"
  // title="United States"> ... <div class="iti__selected-dial-code">+1</div></button><div id="iti-0__country-selector"
  // class="iti__country-selector iti__hide ..." role="dialog" aria-modal="true"><ul class="iti__country-list"
  // id="iti-0__country-listbox" role="listbox" aria-label="List of countries"><li id="iti-0__item-us" class="iti__country
  // iti__highlight" tabindex="-1" role="option" data-dial-code="1" data-iso2="us" aria-selected="true"> ...
  return Array.from(root.querySelectorAll('.iti button.iti__selected-country'));
}

/** A country's name as compared: accents, case and spaces folded. */
const countryName = (text: string) => text.normalize('NFKD').replace(/\p{M}+/gu, '').replace(/\s+/g, ' ').trim()
  .toLowerCase();

/** The country the phone's button shows (its title, "Canada", and its dial code, "+1") as the known option of that name
 *  ("Canada (+1)"), else as the option's own spelling; null when it shows none. */
function countryShown(button: Element): (known: readonly string[]) => string | null {
  return (known) => {
    const title = (button.getAttribute('title') ?? '').trim();
    if (title === '') return null;
    const dial = (button.querySelector('.iti__selected-dial-code')?.textContent ?? '').replace(/\s+/g, '');
    const named = known.find((label) => {
      const match = /^(.*?)\s*\((\+\d+)\)\s*$/.exec(label);
      return match !== null && countryName(match[1]!) === countryName(title) && (dial === '' || match[2] === dial);
    });
    return named ?? (dial === '' ? title : `${title} (${dial})`);
  };
}

/** The dropdowns and the phone's country button, declared as their widgets (see the header); null for any other
 *  control. */
function widgetFor(control: Element): WidgetDecl | null {
  if (isCountryButton(control)) {
    if (control.closest(FORM) === null || !control.hasAttribute('aria-controls')) return null;
    return { kind: 'combobox', opener: control as HTMLElement, expanded: control, keys: ['Escape'], keyTarget: 'list',
      shownAnswer: countryShown(control),
      ...(__PROVENANCE__ && { snapshot: 'fixtures/workable/labella-phone-countries-open.html' }) };
  }
  // fixtures/workable/labella-closed.html: <div data-ui="QA_11713820" class="styles--2N29s" data-open="false"
  // data-input-type="select"><label class="styles--2bW8g"><div data-role="illustrated-input" ...><div ...><input
  // id="input_QA_11713820_input" role="combobox" aria-haspopup="listbox" aria-expanded="false"
  // aria-owns="input_QA_11713820_listbox" aria-controls="input_QA_11713820_listbox" aria-autocomplete="none"
  // autocomplete="off" aria-labelledby="QA_11713820_label" placeholder="Select an option…" type="text" ... value=""
  // readonly="true"> ... </label><input name="QA_11713820" required="" ... tabindex="-1" aria-hidden="true" value="">
  // </div>; open (labella-dropdown-open.html): aria-expanded="true", and in the field <dialog ...
  // id="input_QA_11713820_dialog" role="presentation" open=""> ... <ul role="listbox" tabindex="-1"
  // id="input_QA_11713820_listbox" ...><li value="6133432" ... role="option" aria-selected="false"><div
  // role="presentation" data-active="true" ...> ... <span ... data-role="option-label">1-3</span> ...
  if (control.localName !== 'input' || !control.matches('input[role="combobox" i][id^="input_"][id$="_input"]')) return null;
  if (control.closest('[data-input-type="select"]') === null || control.closest(FORM) === null) return null;
  return { kind: 'combobox', opener: control as HTMLElement, expanded: control, keys: ['Escape'], keyTarget: 'list',
    readOnlyBox: true, listFollowsField: true, highlightIsNoChoice: true,
    optionLabel: (option) => option.querySelector('[data-role="option-label"]'),
    ...(__PROVENANCE__ && { snapshot: WORKABLE_SNAPSHOTS[0] }) };
}

/** The "Autofill application" box: the form's own part that holds [data-ui=autofill-button]. */
function autofillBoxes(root: Element): Element[] {
  // fixtures/workable/*-closed.html: <form ... data-ui="application-form"><div class="styles--1euHv"><div ...><div ...>
  // <div class="styles--VzPaX"><div><svg>...</svg><strong>Autofill application</strong></div><p>Save time by importing
  // your resume in one of the following formats: ...</p></div><div class="styles--11blb" data-ui="autofill-button"> ...
  // <button aria-haspopup="true" aria-expanded="false" aria-controls="<id>_dropdown" ... type="button"> ... Import resume
  // from ...
  return Array.from(root.querySelectorAll('[data-ui="autofill-button"]')).map((button) => {
    let part: Element = button;
    while (part.parentElement !== null && part.parentElement !== root) part = part.parentElement;
    return part.parentElement === root ? part : button;
  });
}

/** Nothing in the autofill box is a field (see the header). */
function excluded(root: Element): Element[] {
  return autofillBoxes(root);
}

/** Each file input and its "Choose file" button. */
function uploadWidgets(root: Element): Array<{ control: Element; input: HTMLInputElement }> {
  // fixtures/workable/labella-closed.html: <label tabindex="0" role="button" for="input_files_input_<id>"
  // id="description_input_<id>" ...>Choose file</label> <span ...>or drag and drop here</span></div><input
  // data-ui="resume" tabindex="-1" id="input_files_input_<id>" type="file" aria-labelledby="<id>_label
  // description_input_<id>" accept=".pdf,..." ... required="">; blueground-closed.html's Photo the same with
  // data-ui="avatar".
  const buttons = Array.from(root.querySelectorAll<HTMLLabelElement>('label[role="button" i][for]'));
  return Array.from(root.querySelectorAll<HTMLInputElement>('input[type="file" i][data-ui]')).flatMap((input) => {
    if (input.id === '') return [];
    const control = buttons.find((button) => button.htmlFor === input.id);
    return control === undefined ? [] : [{ control, input }];
  });
}

/** Where an upload's error would show, words that say it went wrong, and a control that removes a file. */
const UPLOAD_ERRORS = '[role="alert" i], [id$="_error"], [data-ui$="error"]';
const UPLOAD_FAILED = /\b(?:fail(?:ed|ure)?|error|could ?n[o']t|unable|try again)\b/i;
const REMOVES = /\b(?:remove|delete|clear)\b/i;

/** What the page shows of the upload of `fileName` into one of its file inputs (see the header); null for any other
 *  input. */
function uploadState(input: HTMLInputElement, fileName: string): UploadState | null {
  if (!input.matches('input[type="file" i][data-ui]')) return null;
  // The live check of 2026-11-02: the aborted upload left the page's error screen where the form was.
  const form = formOf(input.ownerDocument);
  if (!input.isConnected || form === null) return 'failed';
  // fixtures/workable/labella-closed.html: the input sits in its <div data-role="dropzone"> (beside "Choose file"),
  // under the field's title row (<span id="<id>_label">); an error would be the field's.
  const zone = input.closest('[data-role="dropzone"]');
  if (zone === null) return 'pending';
  let field: Element | null = zone.parentElement;
  while (field !== null && field !== form && field.querySelector('span[id$="_label"]') === null) field = field.parentElement;
  const words = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  const name = fileName.replace(/\s+/g, ' ').trim();
  const errors = field === null || field === form ? []
    : Array.from(field.querySelectorAll(UPLOAD_ERRORS)).map(words).filter((text) => text !== '');
  const namesIt = (text: string) => (name !== '' && text.includes(name)) || (/upload|file/i.test(text)
    && UPLOAD_FAILED.test(text));
  if (errors.some(namesIt)) return 'failed';
  if (errors.length > 0) return 'pending';
  // The owner's capture of 2026-11-06 (raydar-attached.html), an upload that worked: <div data-id="filename"><span>HEAD
  // </span><span>TAIL</span></div>, the name cut in two (see the header): the name is the two spans' text together.
  const split = Array.from(zone.querySelectorAll('[data-id="filename"]')).some((el) => (el.textContent ?? '').trim() === name);
  const named = name !== '' && (split || Array.from(zone.querySelectorAll('*')).some((el) => el.children.length === 0
    && words(el) === name));
  const removable = Array.from(zone.querySelectorAll('button, [role="button" i]')).some((el) =>
    REMOVES.test(`${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''} ${words(el)}`));
  const busy = zone.querySelector('[aria-busy="true" i], [role="progressbar" i]') !== null;
  return named && removable && !busy ? 'confirmed' : 'pending';
}

/** The posting's own text on the overview: its description, requirements and benefits, the part of the page that holds
 *  all three (else the description alone). */
function postingText(doc: Document): Element | null {
  // fixtures/workable/huggingface-overview.html: <section aria-labelledby="job-description-title" ...
  // data-ui="job-description"><h2 id="job-description-title">Description</h2> ... </section><section ...
  // data-ui="job-requirements"> ... </section><section ... data-ui="job-benefits"> ... </section>, side by side.
  const description = doc.querySelector('[data-ui="job-description"]');
  if (description === null) return jobsSitePosting(doc);
  const parent = description.parentElement;
  return parent !== null && parent.querySelector('[data-ui="job-requirements"], [data-ui="job-benefits"]') !== null
    && parent.querySelector(FORM) === null ? parent : description;
}

/** The posting's own text on jobs.workable.com (see the header): the part of the page that holds its description and
 *  its requirements and no form, else the description alone; null where it shows neither. */
function jobsSitePosting(doc: Document): Element | null {
  // jobs-salvo-apply.html: <div class="jobBreakdown__job-breakdown--31MGR"><section><h3>Description</h3><div
  // class="parsedHtml__content--OWD2W" data-ui="job-breakdown-description-parsed-html"> ... </div></section><section>
  // <h3>Requirements</h3><div ... data-ui="job-breakdown-requirements-parsed-html"> ... </div></section></div>
  const description = doc.querySelector('[data-ui="job-breakdown-description-parsed-html"]');
  if (description === null) return null;
  for (let at = description.parentElement; at !== null && at !== doc.body; at = at.parentElement) {
    if (at.querySelector(FORM) !== null) break;
    if (at.querySelector('[data-ui="job-breakdown-requirements-parsed-html"]') !== null) return at;
  }
  return description;
}

/** The never-pressed buttons and links (see the header). */
function neverPress(root: Element): Element[] {
  const doc = root.ownerDocument;
  // fixtures/workable/*-closed.html: <a tabindex="0" role="button" data-ui="clear-section-0" aria-label="Clear Personal
  // information" ...>; the uploads' <label ... role="button" for="input_files_input_<id>" ...>Choose file</label> and
  // <div class="..." data-role="dropzone">; labella-education-editor.html: <button ... data-ui="cancel-section"
  // type="button">Cancel</button>; a saved entry (the capture's wk-education-saved): <a data-ui="edit-section" ...
  // role="button"> and <a data-ui="remove-section" title="Delete" ... role="button">.
  const inForm = Array.from(root.querySelectorAll(['[data-ui^="clear-section"]', 'label[role="button" i][for]',
    '[data-role="dropzone"]', '[data-ui="cancel-section"]', '[data-ui="edit-section"]', '[data-ui="remove-section"]']
    .join(', ')));
  // The page around the form: <div data-ui="cookie-consent" role="dialog" ...> with its buttons
  // (cookie-consent-settings, -accept, -decline), the footer's <button data-ui="update-cookie-preferences">, the tabs
  // (<a data-ui="role-overview-tab"> and <a data-ui="application-form-tab">), <a data-ui="company-logo">, <a
  // data-ui="view-jobs-url"> and the overview's <a role="button" data-ui="apply-button" href=".../apply/">Apply for this
  // job</a> (the same data-ui as Submit's, so a link here).
  const around = Array.from(doc.querySelectorAll(['[data-ui^="cookie-consent"] button', 'button[data-ui^="cookie-consent"]',
    '[data-ui="update-cookie-preferences"]', 'a[data-ui="role-overview-tab"]', 'a[data-ui="application-form-tab"]',
    'a[data-ui="company-logo"]', 'a[data-ui="view-jobs-url"]', 'a[data-ui="apply-button"]',
    // jobs.workable.com (jobs-salvo-apply.html, see the header): the dialog's own Cancel and Submit beside its title,
    // and the posting page's buttons behind it.
    '[data-ui="application-form-cancel"]', '[data-ui="application-form-submit"]', '[data-ui="overview-apply-now"]',
    '[data-ui="sticky-apply-now"]', '[data-ui="share-now"]', '[data-ui="search-for-jobs-button"]'].join(', ')));
  return [...new Set([...autofillBoxes(root), ...inForm, ...around])];
}

/** The Submit button: identified so it is never clicked. */
function submitButton(root: Element): HTMLElement | null {
  // fixtures/workable/*-closed.html: <button class="..." data-ui="apply-button" type="submit" disabled=""
  // aria-disabled="true">Submit application</button>, the form's last child (disabled until the first edit).
  return root.querySelector<HTMLElement>('button[data-ui="apply-button"][type="submit" i]');
}

/** One step: the page is the final step when it shows the form and its Submit button. */
function isFinalStep(doc: Document): 'final' | 'unknown' {
  const root = formOf(doc);
  return root !== null && submitButton(root) !== null ? 'final' : 'unknown';
}

/** The Education and Experience blocks (see the header): each entry's li, saved (its summary) or in its editor. */
function repeatables(root: Element): ReturnType<NonNullable<Adapter['repeatables']>> {
  // fixtures/workable/labella-closed.html: <div class="styles--1YIkW" data-ui="education"><div ...><p
  // id="education_label">Education ...</p><button data-ui="add-section" aria-label="Add Education" ... type="button">+
  // Add</button></div></div> (no list yet); labella-education-editor.html: the same button disabled="" while <ul><li
  // ...><div data-ui="editor"> ... <input ... id="school" name="school" ...> ... <button data-ui="save-section" ...
  // type="button">Update</button><button ... data-ui="cancel-section" type="button">Cancel</button></div></li></ul> is
  // open; a saved entry (the capture's wk-education-saved): <ul><li ...><div data-ui="group"><dl><dt>School</dt><dd ...
  // data-ui="school"> ... </dd></dl> ... <a data-ui="edit-section" ...><a data-ui="remove-section" ...></li></ul>; the
  // Experience editor's (wk-experience-editor) "I currently work here": <input ... type="checkbox" name="current" ...>.
  return (['education', 'experience'] as const).flatMap((kind) => {
    const section = root.querySelector(`[data-ui="${kind}"]`);
    if (section === null) return [];
    const add = () => Array.from(section.querySelectorAll<HTMLElement>('button[data-ui="add-section"]'))
      .find((button) => button.closest(`[data-ui="${kind}"]`) === section && button.closest('[data-ui="editor"]') === null)
      ?? null;
    return [{
      kind,
      blocks: () => Array.from(section.querySelectorAll(':scope > ul > li')),
      addButton: add,
      currentlyHere: (block: Element) =>
        block.querySelector<HTMLInputElement>('[data-ui="editor"] input[type="checkbox" i][name="current"]'),
      save: (block: Element) => block.querySelector<HTMLElement>('[data-ui="editor"] button[data-ui="save-section"]'),
    }];
  });
}

/** The words each saved entry's summary names, by the category the planner fingerprints it by. */
const SUMMARY_WORDS: Readonly<Record<string, ReadonlyArray<readonly [string, ShownCategory]>>> = {
  education: [['school', 'education.school']],
  experience: [['title', 'experience.title'], ['company', 'experience.company']],
};

/** The blocks that show a saved entry's summary, with its words (Adapter.prefill.readEntries: the planner finds the
 *  entry each holds by its fingerprint, never by its place). */
function readEntries(kind: string, blocks: Element[]): PrefillEntryView[] {
  // The capture's wk-education-saved and wk-experience-saved: <li ...><div data-ui="group"><dl><dt>School</dt><dd ...
  // data-ui="school"><span>Test University</span></dd></dl><dl data-ui="date-range"><dt>Period </dt><dd ...
  // data-ui="period"><span>September 2018</span></dd></dl> ...; Experience's names data-ui="title" and "company".
  const named = SUMMARY_WORDS[kind];
  if (named === undefined) return [];
  const words = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, TEXT_CAP_LABEL);
  return blocks.flatMap((block, index) => {
    const group = block.querySelector('[data-ui="group"]');
    if (group === null || block.querySelector('[data-ui="editor"]') !== null) return [];
    const values: Array<{ category: ShownCategory; text: string }> = [];
    for (const [ui, category] of named) {
      const text = words(group.querySelector(`dd[data-ui="${ui}"]`));
      if (text !== '') values.push({ category, text });
    }
    // "September 2018 - Present": the start is what comes before the dash.
    const start = words(group.querySelector('dd[data-ui="period"]')).split(/\s[-–—]\s/)[0]?.trim() ?? '';
    if (kind === 'experience' && start !== '') values.push({ category: 'experience.startDate', text: start });
    return values.length === 0 ? [] : [{ block: index, values }];
  });
}

/** Whether the page shows Workable's panel after Submit ([data-ui=successful-submit], as Jobright 1.25.2 reads it in
 *  #app: not seen live, since nothing was submitted). v3 Phase 4's submission detection reads it
 *  (content/submitted.ts), only after a Submit was pressed. */
export function workableSubmitted(doc: Document): boolean {
  return doc.querySelector('[data-ui="successful-submit"]') !== null;
}

/** The Workable adapter. */
export const workableAdapter: Adapter = {
  id: 'workable',
  matchesUrl,
  canonicalApplicationUrl,
  detect(doc) {
    const formRoot = formOf(doc);
    return formRoot === null ? null : { formRoot };
  },
  sections,
  labelFor,
  labelSuffix,
  descriptionFor,
  requiredFor,
  formatFor,
  keyAroundWrite,
  checkedOf,
  widgetRoots,
  excluded,
  postingText,
  uploadWidgets,
  uploadState,
  widgetFor,
  repeatables,
  prefill: { readEntries },
  submitButton,
  neverPress,
  isFinalStep,
  errors: (root) => genericAdapter.errors?.(root) ?? [],
  quirks: { formLateMs: WORKABLE_FORM_LATE_MS, filesLast: true },
  // v3 Phase 5, the agent's entry on the overview: fixtures/workable/huggingface-overview.html's <a tabindex="0"
  // role="button" ... data-ui="apply-button" href=".../apply/">Apply for this job</a>, and the tab <a
  // data-ui="application-form-tab" href=".../apply/">, read by the address each opens (adapters/entry.ts). TailorIT's
  // agent does not queue Workable yet (its address reading comes with the contract's next version).
  entryControl: (doc) => applicationLinkOf(doc, parseWorkableUrl,
    'a[data-ui="apply-button"][href], a[data-ui="application-form-tab"][href]'),
  // Those links are never pressed by a run (neverPress): the entry door presses that element alone, for the agent.
  entryNeverPressed: true,
};
