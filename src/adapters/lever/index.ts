/*
 * The Lever adapter (docs/design/runtime.md §9; docs/ARCHITECTURE.md "Adapters"): the quirks of Lever's one-page
 * application form, jobs.lever.co/<site>/<posting>/apply. Every hook was read from the owner's two snapshots,
 * fixtures/lever/spotify-ny.html and fixtures/lever/zoox-fostercity.html (both captured 2026-10-29), and names the
 * markup it relies on. Markup those snapshots do not show gets no hook: a posting page without its form is told from
 * its address (applicationOf(url).page === 'posting'), never from a selector.
 * - Form root: form#application-form holding Lever's .application-question items. A plain page on a Lever host (the
 *   trap fixtures) has neither, so detect() returns null and the registry's generic adapter takes it.
 * - Sections: the form's div.section.application-form parts, each named by its h4.
 * - Labels: a standard question wraps its control in a <label>, which the scanner reads itself. A custom question's
 *   control, and every group of boxes (Pronouns, the custom checkbox and radio questions), is named by the question's
 *   div.application-label, which no label element, legend or aria attribute ties to it.
 * - Upload: the resume input sits at opacity 0 inside the visible ATTACH RESUME/CV link, which is its upload widget.
 * - Widgets: "Current location" is Lever's own location search, a remote typeahead. It is declared as one, with no
 *   activation events, so that it is never typed into as plain text. v4 (drop): its results are no ARIA listbox, so its
 *   results list is declared from a read-only live capture of a public Lever application (2026-11-07, jobs.lever.co/
 *   thinkahead/.../apply; fixtures/lever/location-open.html, its markup with Austin typed in): <div class="... rounded
 *   dropdown-container" style="display: flex;"><div class="dropdown-results width-full cursor-pointer"><div
 *   class="break-word dropdown-location width-full py1 px2" id="location-0">Austin, TX, USA</div></div><div
 *   class="dropdown-no-results ...">No location found. ...</div><div class="dropdown-loading-results ...">...
 *   <span>Loading</span></div></div>. What the capture's own script (retrieveLocations.js) does, read for behaviour
 *   only: an input event shows the container; a keydown of any key but the arrows and Enter starts the search, 500 ms
 *   after the last one, with the loading row shown until its answer; a mousedown on a result chooses it (the text box
 *   takes its words, the hidden selectedLocation input its record, the container hides); a blur while the container
 *   shows empties the box. So each typed query is followed by one declared Escape (queryKey: a key that starts the
 *   search and does nothing else there), a result is chosen with one mousedown (results.choose), and the loading row
 *   is the widget's busy sign. The hidden selectedLocation input is never written: the page fills it from the chosen
 *   result. The question's own words name the box (labelFor), so the results shown inside its wrapping label never
 *   change its label.
 * - Submit: button#btn-submit, identified so it is never clicked. The form is a single step, so a page showing the
 *   form and its Submit is the final step.
 * - Errors: Lever's p.error-message when shown, plus the standard aria-invalid="true".
 * - Busy: Lever's "Analyzing resume..." indicator, shown while it reads an uploaded resume to prefill the form, and the
 *   location search's "Loading" row.
 * No proxyFor: both snapshots draw their checkboxes and radios as visible native controls (appearance: none with a
 * border), each inside its own label, so no hidden box needs an adapter's stand-in.
 */
import { tiedLabels } from '../../dom/labels';
import { newScanCache } from '../../dom/scan-cache';
import { visibleText } from '../../dom/visible-text';
import { isUserVisible } from '../../dom/visibility';
import { applicationLinkOf } from '../entry';
import { genericAdapter } from '../generic';
import type { Adapter, WidgetDecl } from '../types';
import { canonicalApplicationUrl, matchesUrl, parseLeverUrl } from './url';

/** The snapshots the Lever hooks were read from. */
export const LEVER_SNAPSHOTS = ['fixtures/lever/spotify-ny.html', 'fixtures/lever/zoox-fostercity.html'] as const;

/** v4 (drop): the location search's results list, open, from the read-only live capture of 2026-11-07. */
export const LEVER_LOCATION_CAPTURE = 'fixtures/lever/location-open.html';

/** Lever's application form in a document, or null when the document shows none. */
function formOf(doc: Document): Element | null {
  // fixtures/lever/spotify-ny.html, zoox-fostercity.html: <form id="application-form" enctype="multipart/form-data">
  const form = doc.querySelector('form#application-form');
  // Both snapshots: every question is an li.application-question (a div.application-question in the EEO block and the
  // demographic survey).
  return form !== null && form.querySelector('.application-question') !== null ? form : null;
}

/** The form's parts and their headings. */
function sections(root: Element): Array<{ el: Element; label: string }> {
  const cache = newScanCache();
  const found: Array<{ el: Element; label: string }> = [];
  // fixtures/lever/*.html: <div class="section page-centered application-form"><h4>Submit your application</h4>, the
  // same for Links and the custom cards (<h4 data-qa="card-name">), and zoox-fostercity.html's EEO part
  // (div.section.eeo-section ... <hr><h4>). A part whose h4 is hidden (spotify-ny.html's country surveys, class
  // hidden) or that has none (the consent part, the Submit part) is left to the scanner's own rules.
  for (const section of Array.from(root.querySelectorAll('div.section.application-form'))) {
    const heading = section.querySelector(':scope > h4');
    const label = heading === null ? '' : visibleText(heading, { singleLine: true, cache });
    if (label !== '') found.push({ el: section, label });
  }
  return found;
}

/** Whether a box's own label (label[for] or its wrapping label) shows text: it is then an answer of its question. */
function ownLabelShows(box: Element): boolean {
  const cache = newScanCache();
  const { explicit, wrapping } = tiedLabels(box);
  return [...explicit, ...wrapping].some((label) => visibleText(label, { singleLine: true, cache }) !== '');
}

/**
 * The question's label for a control it does not wrap. The scanner asks the adapter for a group's question (with the
 * group's first box) and for an answer whose own label shows nothing; only the first gets the question's label, so an
 * answer is never named after its question.
 */
function labelFor(control: Element): Element | null {
  // fixtures/lever/*.html: <li class="application-question"> ... <div class="application-label">Pronouns</div>, and
  // zoox-fostercity.html's custom questions: <div class="application-label full-width textarea"><div class="text">
  // What is your preferred first name ...</div></div> beside div.application-field.
  const question = control.closest('.application-question');
  const label = question?.querySelector('.application-label') ?? null;
  if (question === null || label === null) return null;
  const type = control.localName === 'input' ? (control as HTMLInputElement).type : control.localName;
  // fixtures/lever/*.html: every box sits in its own <label><input type="checkbox"><span
  // class="application-answer-alternative">He/him</span></label> (radios the same, in spotify-ny.html's surveys).
  if (type === 'radio' || type === 'checkbox') return ownLabelShows(control) ? label : null;
  // fixtures/lever/*.html: li.application-question.resume, its div.application-label "Resume/CV ✱".
  if (type === 'file') return label;
  // v4 (drop): the location search's box, whose wrapping <label> also holds its results list and its "No location
  // found" notice (fixtures/lever/location-open.html): the question's own words name it, whatever the list shows.
  if (isLocationInput(control)) return label;
  // fixtures/lever/zoox-fostercity.html: <li class="application-question custom-question">. A standard question's
  // other controls (spotify-ny.html's hidden custom-pronouns box, shown only with its placeholder) are not its own.
  return question.classList.contains('custom-question') ? label : null;
}

/** Lever's location search box (fixtures/lever/*.html): <li class="application-question"
 *  data-qa="structured-contact-location-question"> ... <input class="location-input" data-qa="location-input"
 *  id="location-input" type="text" maxlength="100" name="location"> */
function isLocationInput(control: Element): boolean {
  return control.matches('input.location-input[data-qa="location-input"]')
    && control.closest('[data-qa="structured-contact-location-question"]') !== null;
}

/** The resume input and the visible link that stands for it. */
function uploadWidgets(root: Element): Array<{ control: Element; input: HTMLInputElement }> {
  // fixtures/lever/*.html: <a href="...#" class="postings-btn template-btn-utility visible-resume-upload"> ... <span
  // class="default-label">ATTACH RESUME/CV</span><input class="application-file-input invisible-resume-upload"
  // data-qa="input-resume" id="resume-upload-input" name="resume" tabindex="-1" type="file"></a>
  return Array.from(root.querySelectorAll('a.visible-resume-upload')).flatMap((control) => {
    const input = control.querySelector<HTMLInputElement>('input[type="file"].invisible-resume-upload');
    return input === null ? [] : [{ control, input }];
  });
}

/** Lever's location search (module header): a remote typeahead whose results list is declared (v4, drop). */
function widgetFor(control: Element): WidgetDecl | null {
  // fixtures/lever/*.html: <li class="application-question" data-qa="structured-contact-location-question"> ...
  // <input class="location-input" data-qa="location-input" id="location-input" type="text" maxlength="100"
  // name="location"><div class="... dropdown-container"><div class="dropdown-results ..."></div> ...
  if (!isLocationInput(control)) return null;
  const question = control.closest('[data-qa="structured-contact-location-question"]')!;
  // fixtures/lever/location-open.html: <div class="dropdown-results width-full cursor-pointer"><div class="break-word
  // dropdown-location width-full py1 px2" id="location-0">...</div></div>, and its loading row <div
  // class="dropdown-loading-results ...">.
  const list = question.querySelector('.dropdown-results');
  return { kind: 'typeahead-remote', opener: control as HTMLElement, snapshot: LEVER_LOCATION_CAPTURE,
    ...(list === null ? {} : { results: { list, option: '.dropdown-location', choose: 'mousedown' as const },
      queryKey: 'Escape' as const, busy: ['.dropdown-loading-results'] }) };
}

/** The Submit button: identified so it is never clicked. */
function submitButton(root: Element): HTMLElement | null {
  // fixtures/lever/*.html: <button id="btn-submit" type="button" class="postings-btn template-btn-submit hex-color"
  // data-qa="btn-submit">Submit application</button>
  return root.querySelector<HTMLElement>('button#btn-submit, button[data-qa="btn-submit"]');
}

/** One step: the page is the final step when it shows the form and its Submit button. */
function isFinalStep(doc: Document): 'final' | 'unknown' {
  const root = formOf(doc);
  return root !== null && submitButton(root) !== null ? 'final' : 'unknown';
}

/** Lever's error messages a person can see, then the controls marked invalid. */
function errors(root: Element): Array<{ el: Element }> {
  const cache = newScanCache();
  // fixtures/lever/*.html: <span class="resume-upload-oversize"><p class="error-message">File exceeds the maximum
  // upload size of <b>100MB</b>. ...</p></span> (display: none until Lever shows it).
  const shown = Array.from(root.querySelectorAll('.error-message')).filter((el) => isUserVisible(el, cache));
  const invalid = (genericAdapter.errors?.(root) ?? []).map((error) => error.el);
  return [...new Set([...shown, ...invalid])].map((el) => ({ el }));
}

/** Lever is reading an uploaded resume, or its location search is loading. */
function isBusy(doc: Document): boolean {
  const root = formOf(doc);
  if (root === null) return false;
  const cache = newScanCache();
  // fixtures/lever/*.html: <span class="resume-upload-working"><div class="loading-indicator"></div><div
  // class="resume-upload-label">Analyzing resume...</div></span>, and the location search's <div
  // class="dropdown-loading-results ..."> ... <span>Loading</span></div>; both display: none until Lever shows them.
  return Array.from(root.querySelectorAll('.resume-upload-working, .dropdown-loading-results'))
    .some((el) => isUserVisible(el, cache));
}

/** The Lever adapter. */
export const leverAdapter: Adapter = {
  id: 'lever',
  matchesUrl,
  canonicalApplicationUrl,
  detect(doc) {
    const formRoot = formOf(doc);
    return formRoot === null ? null : { formRoot };
  },
  sections,
  labelFor,
  uploadWidgets,
  widgetFor,
  submitButton,
  isFinalStep,
  errors,
  isBusy,
  // v3 Phase 5, the agent's entry: no snapshot shows Lever's posting page, so its Apply is the link a person sees whose
  // address the Lever parser reads as this posting's /apply (adapters/entry.ts), never a class name.
  entryControl: (doc) => applicationLinkOf(doc, parseLeverUrl),
};
