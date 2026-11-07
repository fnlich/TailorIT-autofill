/*
 * The Ashby adapter (docs/design/runtime.md §9; docs/ARCHITECTURE.md "Adapters", "Ashby"): the quirks of
 * jobs.ashbyhq.com's application form, hosted (/<org>/<posting>/application) and in a company's embed (the same app in
 * an iframe, ?embed=js). Every hook was read from the live capture of 2026-11-01 (docs/FIXTURES.md, "The Ashby
 * capture"; its closed forms are fixtures/ashby/*-closed.html, its states the other fixtures/ashby/*.html) and names
 * the markup it relies on. The page is client-rendered React: the form is drawn 4.8 to 6.8 s after the page loads, in
 * one render with its handlers (quirks.formLateMs: the runtime's 30 s cap, while no other adapter may claim the page),
 * and every change is saved to Ashby's server about 0.5 s later (autosaves; docs/PRIVACY.md), a file the moment it
 * goes in.
 * - Form root: div#form[role=tabpanel] (the Application tab's panel; there is no <form>) once it holds
 *   .ashby-application-form-container and a field entry ([data-field-path]). It holds the "Autofill from resume"
 *   uploader (excluded: it rewrites the form on Ashby's server, so nothing in it is a field and its button is never
 *   pressed), the application's sections, the EEO survey (.ashby-survey-form-container) and Submit.
 * - Questions: each entry, [data-field-path], names its question in .ashby-application-form-question-title, a <label>
 *   whose for= reaches only text, email, tel, url, number, textarea and file inputs (their id is the path): the title
 *   labels every other control and every group (labelFor), an Education block's own controls by their own sub-labels
 *   ("School", "Start Date"), its month and year lists with "month" and "year" (labelSuffix), and the SMS consent's two
 *   radios by its consent text. Help text is .ashby-application-form-question-description (descriptionFor; a lone
 *   consent box's question title too, since its own label is its one option). Required is a hashed _required_ class on
 *   the title, drawn as ::after "*" (requiredFor), never an attribute on a group or a widget.
 * - Sections: each .ashby-application-form-section-container, the survey's too (the EEO section), by its
 *   h2.ashby-application-form-section-header-title, else the first line of its header's description ("U.S. EQUAL
 *   EMPLOYMENT OPPORTUNITY INFORMATION ..."), else as the section before it; the form root, so every question before
 *   the first header, by the Application tab's text. The left pane's h2 headings ("Location", "Compensation") are
 *   outside the root, and the uploader's h3 "Autofill from resume" names nothing. The Education block is the
 *   repeatable education section.
 * - Widgets (widgetFor; widgetRoots):
 *   - Yes/No (.ashby-application-form-input-yesno): two button.ashby-application-form-input-yesno-option[data-option]
 *     with aria-pressed, beside a display:none checkbox of its own: a toggle-button group (its members declared), that
 *     hidden checkbox its one declared part. click() on a button answers it; mouse or pointer events alone do nothing; clicking the pressed
 *     one again clears the answer, so a pressed member is never clicked;
 *   - a combobox (input.ashby-application-form-input-autocomplete[role=combobox] in div[class*=_inputContainer_],
 *     beside button[class*=_toggleButton_]): Location (_systemfield_location, or a field the page's React calls a
 *     Location: the bridge's react.field, never kept unanswered) and an Education block's School are remote searches,
 *     typed into (their results arrive about 0.8 s later; "No results" shows meanwhile, read as still loading until
 *     emptyAfterMs, 1.5 s); every
 *     other one is a ValueSelect of 9 options or more, opened by click() on its toggle (no network call; typing filters
 *     it). Its list is drawn in a floating-ui portal at the end of <body>, named by the input's aria-controls while it
 *     is open; an option is chosen by click() (mousedown alone chooses nothing). The answer is input.value, never the
 *     highlighted first result's aria-selected (highlightIsNoChoice); no box is declared; School's box holds the school's name alone, while its result also
 *     shows the country and the domain, so a School result is labelled by its name (optionLabel). Focusout and blur do not close a list: a declared Escape does, sent
 *     only while the input says aria-expanded="true". While a list is open floating-ui marks the rest of the page
 *     aria-hidden (data-aria-hidden, openai-location-results.html), which the scanner reads as hidden: a search closes
 *     its list before each later query's guard (hidesFormWhileOpen).
 * - Radio and checkbox groups: fieldset.ashby-application-form-input-{radio,checkbox}-group, no legend, each input
 *   24 by 24 px at opacity 0 inside a visible span, tied to its option's label[for]: the label proxy, a click() on the
 *   input, never .checked (which changes the box alone: Ashby's form and server never learn of it). The answer shows on
 *   the span (data-checked, checkedOf). A ValueSelect of 7 options or fewer is drawn as a radio group, a
 *   MultiValueSelect always as checkboxes (each named by its option's label), one of a single option as a lone box.
 * - Dates: input.ashby-application-form-input-date (react-datepicker, placeholder "Pick date...") reads MM/DD/YYYY
 *   (formatFor); ISO text is saved a day early, so it is never written. Focus or a click opens its calendar: the text
 *   filler does neither.
 * - Education (repeatables): its blocks .ashby-application-form-input-education-entry and its add button
 *   .ashby-application-form-input-education-add; a block's month and year lists are native selects (the value setter
 *   and change), the month first in the page, since choosing a month sets the year to this year.
 * - Uploads (uploadWidgets): each .ashby-application-form-input-file's input with its "Upload File" button, only inside a
 *   question's entry; any file input outside every entry (the autofill uploader's) is excluded. Whether Ashby's upload
 *   of a file put in worked is read from its file item and its toasts (uploadState).
 * - The posting (postingText): the Overview tab's description, drawn seconds after the page loads; the Application tab
 *   shows none (its left pane of facts is no posting).
 * - The SMS consent beside a phone: one click sends ApiSubmitCandidateTextingConsent at once, so it is consent the
 *   person gives, left unticked under the current settings (questionOf; Phase 3's Consents: All mode is the one that
 *   will tick it).
 * - Never pressed (neverPress, every Ashby button being typeless with no form owner, so assertNotSubmit's form rule never
 *   fires): the autofill uploader and everything in it, "Upload File", "Delete file", an Education block's Delete, the
 *   Overview and Application tabs and "Apply for this Job". Submit is identified (submitButton), so it is never clicked
 *   either; the form is one step, so a page showing it is the final step.
 * - After Submit the same address shows .ashby-application-form-success-container (ashbySubmitted, read by
 *   content/submitted.ts after a Submit was pressed).
 * The owner's captures of 2026-11-06 (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06) add:
 * - Sending (isBusy): while Ashby sends the application its Submit is disabled and classed _loading_, with a spinner
 *   before its words, <button class="... ashby-application-form-submit-button _loading_zyh3g_82" disabled=""><svg
 *   class="loadingSvg " ...>, and every input of the form is disabled (fixtures/ashby/rivian-submitting.html).
 * - An uploaded file shows as the live probe of 2026-11-02 had it (uploadState): the question's
 *   .ashby-application-form-input-file-item, its -item-name's <span>NAME</span> and its button title="Delete file"
 *   (rivian-submitting.html; the converter redacts NAME). Ashby's "Autofill from resume" then shows "Autofill completed!
 *   Please review the information we filled in for you below." in its pane (.ashby-application-form-autofill-input-form-
 *   alert): the pane is excluded as before, and what it filled is the page's prefill.
 * The SMS consent's radios save the consent the moment one is clicked. Nothing here reads, logs or sends a value.
 */
import { askBridge } from '../../dom/bridge';
import { newScanCache, type ScanCache } from '../../dom/scan-cache';
import { TEXT_CAP_LABEL } from '../../dom/thresholds';
import { visibleText } from '../../dom/visible-text';
import { isUserVisible } from '../../dom/visibility';
import { applicationLinkOf } from '../entry';
import { genericAdapter } from '../generic';
import type { Adapter, UploadState, WidgetDecl } from '../types';
import { canonicalApplicationUrl, matchesUrl, parseAshbyUrl } from './url';

/** The closed forms of the capture (2026-11-01), which the hooks name. */
export const ASHBY_SNAPSHOTS = ['fixtures/ashby/openai-closed.html', 'fixtures/ashby/plaid-closed.html',
  'fixtures/ashby/multiverse-closed.html', 'fixtures/ashby/notion-closed.html', 'fixtures/ashby/cohere-closed.html',
  'fixtures/ashby/incident-closed.html', 'fixtures/ashby/openai-gh-closed.html',
  'fixtures/ashby/ashby-embed-closed.frame-1.html'] as const;

/** How long the content runtime waits for the form: the live form was drawn 4.8 to 6.8 s after the page loaded on one
 *  fast headless connection (the capture's timing logs), so the runtime's own cap (late-form.ts, 30 s). */
export const ASHBY_FORM_LATE_MS = 30_000;

/** A search whose list shows "No results", no option and no change this long after a query found nothing: live, its
 *  results came 0.73 to 0.82 s after the typed text (the capture's logs), "No results" showing meanwhile. */
export const ASHBY_SEARCH_EMPTY_MS = 1_500;

/** A field entry: every question, its path stable (a UUID or _systemfield_*). */
const ENTRY = '[data-field-path]';
/** A question's title. */
const TITLE = '.ashby-application-form-question-title';
/** An Education block. */
const EDUCATION_BLOCK = '.ashby-application-form-input-education-entry';
/** The "Autofill from resume" uploader: its pane (classed -autofill-uploader on most forms, -autofill-pane on plaid's)
 *  and its input root, which every form classes alike. */
const AUTOFILL = '.ashby-application-form-autofill-uploader, .ashby-application-form-autofill-pane, '
  + '.ashby-application-form-autofill-input-root';
/** The SMS consent beside a phone question. */
const TEXTING_CONSENT = '.ashby-application-form-texting-consent-description';

/** Ashby's application form in a document, or null while it shows none (before its first render, or after Submit). */
function formOf(doc: Document): Element | null {
  // fixtures/ashby/*-closed.html: <nav role="tablist"> ... <div tabindex="0" role="tabpanel"
  // aria-labelledby="job-application-form" id="form"><div class="... ashby-application-form-autofill-uploader ...">
  // ... <div class="... ashby-application-form-container ..."><div class="... ashby-application-form-section-container">
  // <div class="... ashby-application-form-field-entry" data-field-path="_systemfield_name" ...>
  const form = doc.getElementById('form');
  if (form === null || form.localName !== 'div' || (form.getAttribute('role') ?? '').trim().toLowerCase() !== 'tabpanel') {
    return null;
  }
  if (form.querySelector('.ashby-application-form-container') === null || form.querySelector(ENTRY) === null) return null;
  return form;
}

/** Whether an element's class list holds one of Ashby's hashed classes of this name (`_required_f7cvd_91`). */
function hasHashedClass(el: Element, name: string): boolean {
  return Array.from(el.classList).some((token) => token.startsWith(`_${name}_`));
}

/** The visible text of an element on one line, capped as a label. */
function textOf(el: Element, cache: ScanCache): string {
  return visibleText(el, { singleLine: true, cap: TEXT_CAP_LABEL, cache });
}

/** The first line of a section header's description: its first block that shows text, else all of it. */
function firstLine(description: Element, cache: ScanCache): string {
  // openai-closed.html's survey: <div class="... ashby-application-form-section-header-description"><p><strong>U.S.
  // EQUAL EMPLOYMENT OPPORTUNITY INFORMATION</strong> &nbsp;&nbsp;(Completion is voluntary and will not subject you to
  // adverse treatment)</p><p></p><p>OpenAI provides equal employment opportunities ...</p> ...
  for (const block of Array.from(description.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li'))) {
    const text = textOf(block, cache);
    if (text !== '') return text;
  }
  return textOf(description, cache);
}

/** A section container's own heading: its h2 title, else the first line of its header's description; '' for none. */
function sectionHeading(section: Element, cache: ScanCache): string {
  // plaid-closed.html: <div class="... ashby-application-form-section-container"><div class="...
  // ashby-application-form-section-header"><h2 class="... ashby-application-form-section-header-title">General
  // Application</h2></div> ...
  const header = Array.from(section.children).find((child) => child.matches('.ashby-application-form-section-header'));
  if (header === undefined) return '';
  const title = header.querySelector('h2.ashby-application-form-section-header-title');
  const named = title === null ? '' : textOf(title, cache);
  if (named !== '') return named;
  const description = header.querySelector('.ashby-application-form-section-header-description');
  return description === null ? '' : firstLine(description, cache);
}

/** The form's sections (see the header): the whole form by the Application tab, then each section of the application
 *  and of the survey by its own heading, or, with none, by the heading of the section before it (as a person reads a
 *  section without a header of its own: plaid-closed.html's third, multiverse-closed.html's consent after its survey). */
function sections(root: Element): Array<{ el: Element; label: string }> {
  const cache = newScanCache();
  const found: Array<{ el: Element; label: string }> = [];
  // The Application tab beside the form: <a ... id="job-application-form" ... role="tab" href=".../application"><span
  // class="ashby-job-posting-right-pane-application-tab">Application</span></a>.
  const tab = root.ownerDocument.querySelector('a#job-application-form[role="tab" i]');
  const tabText = tab === null ? '' : textOf(tab, cache);
  if (tabText !== '') found.push({ el: root, label: tabText });
  let last = '';
  for (const section of Array.from(root.querySelectorAll('.ashby-application-form-section-container'))) {
    last = sectionHeading(section, cache) || last;
    if (last !== '') found.push({ el: section, label: last });
  }
  return found;
}

/** The title of the question a control (or a group's container) answers, or null outside every question. The SMS
 *  consent's radios answer its consent text; an Education block's controls their own sub-labels.
 *  The SMS consent's radios are no ordinary question: one click sends the consent to Ashby at once
 *  (ApiSubmitCandidateTextingConsent, the capture's logs), before any Submit. They are labelled by the consent's own
 *  words so the core reads them as the SMS consent it is. Under Consent boxes: All agreements (v3 Phase 3, the owner's
 *  default: every agreement is ticked, like Jobright) its Yes ("given") is chosen, deliberately, and Ashby has it at
 *  once (docs/PRIVACY.md); under Required only it is optional and not pre-approved, so it is left unticked
 *  (consent-optional-unticked) and nothing is sent. e2e 34 holds both. */
function questionOf(control: Element): Element | null {
  // plaid-closed.html: <input ... type="tel" ...><div class="... ashby-application-form-texting-consent-description">
  // <div class="_consentBody_q1pga_8"> ... <p>Check <strong>Yes</strong> or <strong>No</strong> to indicate your
  // agreement to receive text message updates ...</p> ... </div><div class="... _consentRadioGroup_q1pga_13"><label
  // ...><input ... type="radio" name="communicationConsent" value="given"> ...
  const consent = control.closest(TEXTING_CONSENT);
  if (consent !== null) {
    return Array.from(consent.children).find((child) => hasHashedClass(child, 'consentBody')) ?? null;
  }
  const entry = control.closest(ENTRY);
  if (entry === null) return null;
  // Inside an Education block only its own sub-labels: <div class="... ashby-application-form-input-education-entry">
  // ... <div class="_stack_ ..."><label class="... ashby-application-form-question-title"
  // for="_systemfield_education_history-school">School</label><div class="_inputContainer_d7ago_28"><input ...
  // placeholder="Search schools..." role="combobox" ...>
  const stop = control.closest(EDUCATION_BLOCK) ?? entry;
  for (let at: Element | null = control; at !== null; at = at === stop ? null : at.parentElement) {
    const title = Array.from(at.children).find((child) => child.matches(TITLE) && !child.contains(control));
    if (title !== undefined) return title;
  }
  return null;
}

/** The question title that labels a control or a group (see the header). */
function labelFor(control: Element): Element | null {
  return questionOf(control);
}

/** "month" or "year" for an Education block's month and year lists, which share their "Start Date" or "End Date". */
function labelSuffix(control: Element): string | null {
  // plaid-closed.html: <label ... for="_systemfield_education_history-startDate">Start Date</label><div ...
  // id="_systemfield_education_history-startDate"><div class="... ashby-application-form-input-dropdown"><select
  // class="... ashby-application-form-input-dropdown-select"><option value="1">January</option> ... </select></div><div
  // ...><select ...><option value="2027">2027</option> ...
  // Live (2026-11-01, the read-only check on plaid's form) each list also holds its placeholder, "Month..." or "Year...",
  // with an empty value, which the capture's serialization left out: it names no part.
  if (control.localName !== 'select' || control.closest(EDUCATION_BLOCK) === null) return null;
  const values = Array.from((control as HTMLSelectElement).options).map((option) => option.value)
    .filter((value) => value !== '');
  if (values.length > 0 && values.every((value) => /^(?:[1-9]|1[0-2])$/.test(value)) && values.length <= 12) return 'month';
  if (values.length > 0 && values.every((value) => /^\d{4}$/.test(value))) return 'year';
  return null;
}

/** The question's help text: its description, and for a box whose own label is its one option, its title too. */
function descriptionFor(control: Element): Element[] {
  if (control.closest(TEXTING_CONSENT) !== null) return [];
  const title = questionOf(control);
  if (title === null || title.parentElement === null) return [];
  // openai-closed.html: <label class="... ashby-application-form-question-title" ...>Will you now or in the future
  // require sponsorship ...?</label><div class="... ashby-application-form-question-description"><p>We may provide
  // immigration and sponsorship support ...</p></div>
  const description = Array.from(title.parentElement.children)
    .find((child) => child.matches('.ashby-application-form-question-description'));
  // openai-closed.html: a question of one box, its title "Applicant Arbitration Agreement Acknowledgement" and its box's
  // own label[for] "I acknowledge that I have opened, read, and understood ...": the box is a lone checkbox, named by
  // its own label, and its question is part of its help text.
  const group = control.closest('fieldset.ashby-application-form-input-checkbox-group');
  const lone = control.localName === 'input' && (control as HTMLInputElement).type === 'checkbox' && group !== null
    && group.querySelectorAll('input[type="checkbox" i]').length === 1;
  return [...(lone ? [title] : []), ...(description === undefined ? [] : [description])];
}

/** Whether the question's title carries Ashby's required mark (see the header). */
function requiredFor(control: Element): boolean {
  // openai-closed.html: <label class="_heading_f7cvd_52 _required_f7cvd_91 _label_1e3gg_42
  // ashby-application-form-question-title" for="_systemfield_name">Name</label>, drawn with ::after { content: "*" }.
  // Only a mark a person can see counts: a required consent is ticked by it (consent.required).
  const title = questionOf(control);
  return title !== null && title.matches(TITLE) && hasHashedClass(title, 'required') && isUserVisible(title);
}

/** MM/DD/YYYY for the date box (see the header). */
function formatFor(control: Element): { format: 'date'; pattern: string } | null {
  // openai-closed.html: <div class="react-datepicker-wrapper"><div class="react-datepicker__input-container"><input
  // type="text" placeholder="Pick date..." class="... ashby-application-form-input-date" required="" value="">
  return control.matches('input.ashby-application-form-input-date') ? { format: 'date', pattern: 'MM/DD/YYYY' } : null;
}

/** Whether an option of a radio or checkbox group shows chosen: its span's data-checked (see the header). */
function checkedOf(input: HTMLInputElement): boolean | null {
  // openai-radio-chosen.html: <div class="_option_1258i_34 true ashby-application-form-input-radio-group-option"><span
  // class="_container_132c8_28 _checked_132c8_44" data-checked="" data-disabled="false"><input ... type="radio" ...>;
  // openai-checkbox-ticked.html: the same span around an input type="checkbox".
  if (input.type !== 'radio' && input.type !== 'checkbox') return null;
  if (input.closest('fieldset.ashby-application-form-input-radio-group, fieldset.ashby-application-form-input-checkbox-group')
    === null) return null;
  const span = input.parentElement;
  return span !== null && span.localName === 'span' ? span.hasAttribute('data-checked') : null;
}

/** The Yes/No groups: each a widget root (see the header). */
function widgetRoots(root: Element): Element[] {
  // openai-closed.html: <div class="... ashby-application-form-input-yesno"><button class="_container_pjyt6_1
  // _option_1svni_32 ashby-application-form-input-yesno-option" aria-pressed="false" data-option="yes">Yes</button>
  // <button ... aria-pressed="false" data-option="no">No</button><input type="checkbox" class="_input_1svni_78"
  // tabindex="-1" name="<path>"></div>
  return Array.from(root.querySelectorAll('.ashby-application-form-input-yesno'));
}

/** What Ashby's own React calls a field, by the page-world bridge (react.field: no value, no label), kept per text box
 *  once it answered; null while nothing answered (the bridge not there yet, React not attached), asked again at the next
 *  scan. A claim of the page's world, which only decides between a search and a list. */
const fieldTypes = new WeakMap<Element, string>();
function reactFieldType(input: Element): string | null {
  const known = fieldTypes.get(input);
  if (known !== undefined) return known;
  const answer = askBridge(input, { op: 'react.field' });
  const type = answer?.ok === true ? answer.field?.type ?? null : null;
  if (type !== null) fieldTypes.set(input, type);
  return type;
}

/** Whether a combobox is a remote search (see the header). */
function isSearch(input: Element): boolean {
  if (input.closest(EDUCATION_BLOCK) !== null) return true;
  if (input.closest(ENTRY)?.getAttribute('data-field-path') === '_systemfield_location') return true;
  return reactFieldType(input) === 'Location';
}

/** A School result's name, its label (see the header): the result also shows its country and its domain, drawn beside
 *  it with no space between, while the box then holds the name alone. */
function schoolName(option: Element): Element | null {
  // plaid-school-results.html: <div role="option" ... class="... ashby-application-form-input-autocomplete-popup-result">
  // <div class="_stack_b7xpf_1 _vertical_b7xpf_4 ..."><div class="_stack_b7xpf_1 _horizontal_b7xpf_7 ..."><span
  // class="_canonicalSchoolResultName_1e3gg_205">Stanford University</span><span
  // class="_canonicalSchoolResultCountry_1e3gg_209">United States</span></div><span
  // class="_canonicalSchoolResultDomain_1e3gg_218">stanford.edu</span></div></div>
  return Array.from(option.querySelectorAll('span')).find((span) => hasHashedClass(span, 'canonicalSchoolResultName')) ?? null;
}

/** The Yes/No groups and the comboboxes, declared as their widgets (see the header); null for any other control. */
function widgetFor(control: Element): WidgetDecl | null {
  if (control.matches('.ashby-application-form-input-yesno')) {
    const members = Array.from(control.querySelectorAll<HTMLElement>('button.ashby-application-form-input-yesno-option[data-option]'));
    // Its own checkbox, as the capture shows it: a child input type="checkbox", display:none. One a person can see is
    // no part of it (the scan then reads it as any control).
    const parts = Array.from(control.children).filter((child) => child.matches('input[type="checkbox" i]')
      && !isUserVisible(child));
    return members.length >= 2 ? { kind: 'radio', opener: control as HTMLElement, members, parts,
      snapshot: ASHBY_SNAPSHOTS[0] } : null;
  }
  // openai-closed.html: <div class="_inputContainer_d7ago_28"><input class="_input_d7ago_28
  // ashby-application-form-input-autocomplete" placeholder="Start typing..." aria-autocomplete="list"
  // aria-expanded="false" aria-haspopup="listbox" role="combobox" value=""><button class="_container_pjyt6_1
  // _toggleButton_d7ago_32"><svg ...></button></div>; open (multiverse-select-open.html): the input says
  // aria-expanded="true" aria-controls=":r1:", and <div data-floating-ui-portal=""><div ... id=":r1:" role="listbox"
  // ...><div class="... ashby-application-form-input-autocomplete-popup"><div role="option" ... aria-selected="true"
  // class="... ashby-application-form-input-autocomplete-popup-result">...</div> ... sits at the end of <body>.
  if (control.localName !== 'input' || !control.matches('input.ashby-application-form-input-autocomplete[role="combobox" i]')) {
    return null;
  }
  const box = control.parentElement;
  const toggle = box === null || !hasHashedClass(box, 'inputContainer') ? null
    : Array.from(box.children).find((child) => child.localName === 'button' && hasHashedClass(child, 'toggleButton'));
  if (box === null || toggle === undefined || toggle === null) return null;
  const input = control as HTMLInputElement;
  const search = isSearch(input);
  const school = input.closest(EDUCATION_BLOCK) !== null;
  // No box is declared: the input itself is drawn 668 by 54 px (the capture's table), so it is judged as any control.
  return { kind: search ? 'typeahead-remote' : 'combobox', opener: toggle as HTMLElement, expanded: input,
    keys: ['Escape'], hidesFormWhileOpen: true, highlightIsNoChoice: true,
    ...(search ? { emptyAfterMs: ASHBY_SEARCH_EMPTY_MS } : {}),
    snapshot: school ? ASHBY_SNAPSHOTS[1] : search ? ASHBY_SNAPSHOTS[0] : ASHBY_SNAPSHOTS[2],
    ...(school ? { optionLabel: schoolName } : {}) };
}

/** The autofill uploader, and any file input outside every question (the uploader's sits outside every
 *  [data-field-path] entry, whatever its classes are called): nothing in them is a field (see the header). */
function excluded(root: Element): Element[] {
  const outsideEntries = Array.from(root.querySelectorAll('input[type="file" i]')).filter((input) => input.closest(ENTRY) === null);
  return [...new Set([...Array.from(root.querySelectorAll(AUTOFILL)), ...outsideEntries])];
}

/** Each upload question's file input and its "Upload File" button: only inside a question's entry, never the autofill
 *  uploader's. */
function uploadWidgets(root: Element): Array<{ control: Element; input: HTMLInputElement }> {
  // openai-closed.html: <div role="presentation" class="_container_10xk4_70 ashby-application-form-input-file"><input
  // accept="..." type="file" tabindex="-1" id="_systemfield_resume" required="" style="... clip: rect(0px, 0px, 0px,
  // 0px); ... width: 1px; ..."><div class="... ashby-application-form-input-file-dropzone"><button class="...
  // ashby-application-form-input-file-dropzone-upload">...<span><span>Upload File</span></span></button> ...
  return Array.from(root.querySelectorAll('.ashby-application-form-input-file')).flatMap((widget) => {
    if (widget.closest(AUTOFILL) !== null || widget.closest(ENTRY) === null) return [];
    const input = widget.querySelector<HTMLInputElement>('input[type="file" i]');
    const control = widget.querySelector('.ashby-application-form-input-file-dropzone-upload');
    return input === null || control === null ? [] : [{ control, input }];
  });
}

/**
 * Whether Ashby's own upload of a file the extension put into an upload question's input is done, failed or under way.
 * The read-only check of 2026-11-02 (plaid's live form, every upload request aborted) showed, within 30 ms of the file
 * going in: the question's file item with the file's name and its Delete file button (the success Jobright 1.25.2
 * reads), and Ashby's error toast "Error<name> failed to upload" (div[class*=_toasts_] > div[class*=_toast_]
 * [class*=_negative_]) beside it. So the item alone proves nothing: failed when a toast says the file failed to upload
 * (naming it); confirmed when the item names the file, its Delete file button is there, nothing in the question is
 * busy and no toast says an upload failed; pending otherwise (a failure toast that names no file is no confirmation).
 * The caller waits for the page to be quiet before it takes a confirmation (pass.ts). Null for any input outside an
 * upload question.
 */
function uploadState(input: HTMLInputElement, fileName: string): UploadState | null {
  const widget = input.closest('.ashby-application-form-input-file');
  if (widget === null || input.closest(ENTRY) === null || widget.closest(AUTOFILL) !== null) return null;
  const name = fileName.replace(/\s+/g, ' ').trim();
  const words = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  const failures = Array.from(input.ownerDocument.querySelectorAll('[class*="_toast_"]'))
    .filter((toast) => hasHashedClass(toast, 'toast') && /failed to upload/i.test(words(toast)));
  if (name !== '' && failures.some((toast) => words(toast).includes(name))) return 'failed';
  if (failures.length > 0) return 'pending';
  // The live probe: <div class="_file_10xk4_76 ashby-application-form-input-file-item"><p class="_name_10xk4_41
  // ashby-application-form-input-file-item-name"><svg .../><span>Dummy Resume.pdf</span></p><button title="Delete file"
  // class="... ashby-application-form-input-file-item-delete">...</button></div>
  const item = widget.querySelector('.ashby-application-form-input-file-item');
  const shown = item?.querySelector('.ashby-application-form-input-file-item-name') ?? null;
  const named = shown !== null && words(shown) === name;
  const deletable = item?.querySelector('button[title="Delete file" i]') != null;
  const busy = widget.querySelector('[aria-busy="true" i], [role="progressbar" i]') !== null;
  return named && deletable && !busy ? 'confirmed' : 'pending';
}

/** The posting's own text: the overview tab's description (the read-only probe of 2026-11-02 on openai's overview: <div
 *  tabindex="0" role="tabpanel" aria-labelledby="job-overview" id="overview" class="...
 *  ashby-job-posting-description-container"><div class="... ashby-job-posting-description"><p>...</p> ..., drawn 6.6 s
 *  after the page loaded). The Application tab shows none: its left pane (some 2,000 characters of facts: location,
 *  employment type, department, compensation) and its header are no posting. */
function postingText(doc: Document): Element | null {
  const panel = doc.getElementById('overview');
  const inPanel = panel !== null && (panel.getAttribute('role') ?? '').trim().toLowerCase() === 'tabpanel'
    ? panel.querySelector('.ashby-job-posting-description') : null;
  return inPanel ?? doc.querySelector('.ashby-job-posting-description');
}

/** The Education block, Ashby's repeatable education section (see the header). */
function repeatables(root: Element): ReturnType<NonNullable<Adapter['repeatables']>> {
  // plaid-closed.html: <div class="... ashby-application-form-field-entry" data-field-path="_systemfield_education_history"
  // ...><label ...>Education History</label><div><div class="_repeatableEducationEntry_1e3gg_176
  // ashby-application-form-input-education-entry"> ... </div><button class="... ashby-application-form-input-education-add">
  // + Add Education</button></div></div>
  const add = root.querySelector<HTMLElement>('button.ashby-application-form-input-education-add');
  const entry = add?.closest(ENTRY) ?? root.querySelector(EDUCATION_BLOCK)?.closest(ENTRY) ?? null;
  if (entry === null) return [];
  return [{
    kind: 'education',
    blocks: () => Array.from(entry.querySelectorAll(EDUCATION_BLOCK)),
    addButton: () => entry.querySelector<HTMLElement>('button.ashby-application-form-input-education-add'),
  }];
}

/** The never-pressed buttons and links (see the header). */
function neverPress(root: Element): Element[] {
  const doc = root.ownerDocument;
  const marked = Array.from(root.querySelectorAll([AUTOFILL, '.ashby-application-form-input-file-dropzone-upload',
    'button[title="Delete file" i]', '.ashby-application-form-input-education-entry-delete'].join(', ')));
  // The tabs and the overview's "Apply for this Job": <a ... id="job-overview" ... role="tab" ...>, <a ...
  // id="job-application-form" ... role="tab" ...>; overview: <a href=".../application" ...>Apply for this Job</a>.
  const tabs = Array.from(doc.querySelectorAll('a#job-overview, a#job-application-form'));
  const apply = Array.from(doc.querySelectorAll('a[href]')).filter((link) =>
    /^apply for this job$/i.test((link.textContent ?? '').replace(/\s+/g, ' ').trim()));
  return [...new Set([...marked, ...tabs, ...apply])];
}

/** The Submit button: identified so it is never clicked. */
function submitButton(root: Element): HTMLElement | null {
  // openai-closed.html: <button class="... ashby-application-form-submit-button ...">Submit Application</button>
  return root.querySelector<HTMLElement>('button.ashby-application-form-submit-button');
}

/** One step: the page is the final step when it shows the form and its Submit button. */
function isFinalStep(doc: Document): 'final' | 'unknown' {
  const root = formOf(doc);
  return root !== null && submitButton(root) !== null ? 'final' : 'unknown';
}

/** Ashby is sending the application: its Submit shows its spinner (see the header). */
function isBusy(doc: Document): boolean {
  const root = formOf(doc);
  const button = root === null ? null : submitButton(root);
  if (button === null) return false;
  // rivian-submitting.html: <button class="... ashby-application-form-submit-button _loading_zyh3g_82" disabled=""><svg
  // class="loadingSvg " viewBox="0 0 38 38" ...>...</svg><span>Submit Application</span> ...
  const cache = newScanCache();
  return Array.from(button.querySelectorAll('svg.loadingSvg')).some((spinner) => isUserVisible(spinner, cache));
}

/** Whether the page shows Ashby's message after Submit (.ashby-application-form-success-container, at the form's own
 *  address, as Jobright 1.25.2 reads it: not seen live, since nothing was submitted). v3 Phase 4's submission
 *  detection reads it (content/submitted.ts), only after a Submit was pressed. */
export function ashbySubmitted(doc: Document): boolean {
  return doc.querySelector('.ashby-application-form-success-container') !== null;
}

/** The Ashby adapter. */
export const ashbyAdapter: Adapter = {
  id: 'ashby',
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
  checkedOf,
  widgetRoots,
  excluded,
  autosaves: true,
  uploadState,
  postingText,
  uploadWidgets,
  widgetFor,
  repeatables,
  submitButton,
  neverPress,
  isFinalStep,
  isBusy,
  errors: (root) => genericAdapter.errors?.(root) ?? [],
  quirks: { formLateMs: ASHBY_FORM_LATE_MS },
  // v3 Phase 5, the agent's entry on the overview: fixtures/ashby/openai-closed.html's tabs, <a id="job-application-form"
  // role="tab" href=".../<posting>/application">, read by the address it opens (adapters/entry.ts).
  entryControl: (doc) => applicationLinkOf(doc, parseAshbyUrl, 'a[role="tab"][href]'),
  // That tab is never pressed by a run (neverPress): the entry door presses it, that element alone, for the agent.
  entryNeverPressed: true,
};
