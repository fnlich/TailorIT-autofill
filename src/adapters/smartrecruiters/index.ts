/*
 * The SmartRecruiters adapter (the snapshot build of 2026-11-06; docs/ARCHITECTURE.md, the snapshot build of 2026-11-06): the quirks of a posting on
 * jobs.smartrecruiters.com and of its one-click application. Every hook was read from the owner's snapshots of
 * 2026-11-06 ([jobs.smartrecruiters.com]: Xplor's posting, its "Easy apply" page and its "Preliminary questions" page,
 * converted as fixtures/smartrecruiters/xplor-posting.html, xplor-one-click.html and xplor-screening.html; Bertelsmann's
 * expired posting as bertelsmann-expired.html; Wiser Solutions' pages show the same markup) and names the markup it
 * relies on. The application is an Angular page of SmartRecruiters' own web components (spl-*, oc-*, sr-*), nearly
 * all drawn in open shadow roots, which the scanner reads (and the converter keeps: docs/FIXTURES.md). Their styles are
 * not in the snapshots (Chrome does not save a shadow root's adopted style sheets), so what the page hides by style
 * (a closed dropdown's list, a drop zone's file input) shows in the fixtures; the hooks read no style.
 * - Form root: the one-click form, <oc-oneclick-form> (its first page: "Easy Apply", "Personal information",
 *   "Experience", "Education", "Your Profiles", "Resume", "Message to the Hiring Team", then Next), or the screening
 *   step's <oc-screening-questions> ("Preliminary questions": the questions, the consent, Back and Submit).
 * - The posting (postingText): main.jobad-main's div.job-sections (the company, the job, the qualifications, the
 *   additional information).
 * - Entry (entryControl): the visible "I'm interested", a.js-oneclick[data-sr-track=apply], whose address
 *   (src/adapters/smartrecruiters/url.ts) is the one-click application of the posting's own company; an expired
 *   posting shows "Sorry, this job has expired" on a disabled button instead, and has none. Never pressed by a run
 *   (entryNeverPressed). Its "I'm interested" with SmartR (a.js-smartr-oneclick, www.smartr.me) is never pressed.
 * - Kept out of the fields (excluded): the one-click page's "Easy Apply" block, <oc-easy-apply>: its drop zone sends a
 *   resume for SmartRecruiters to fill the form from, and its Apply with LinkedIn, Indeed and SEEK buttons.
 * - Labels (labelFor): the phone's number box, in spl-phone-field's shadow root under its own spl-input, is labelled by
 *   spl-phone-field's label[slot=label] ("Phone number", its required mark beside it); the resume's drop zone by its
 *   section's title (oc-resume-upload's spl-typography-title[data-test=section-title], "Resume" and its required mark
 *   [data-test=section-required-mark] "*", which makes it required as any trailing mark does); a screening question's
 *   drop zone by its question (sr-question-custom-form-field's span[slot=label-content], "Additional attachments").
 * - Uploads (uploadWidgets): each spl-dropzone's file input with the label[for] that opens it ("Choose a file or drop
 *   it here"), both in its shadow root.
 * - Widgets (widgetRoots, widgetFor): a screening Yes/No question, spl-radio-group, whose fieldset[role=radiogroup] (in
 *   its shadow root, labelled by its label[slot=label] through aria-labelledby, aria-required) holds no radio of its
 *   own: its options are the spl-radio elements slotted into it (role=radio, aria-checked, each labelled by its own
 *   text), the group's own children. The group is declared a 'radio' widget with them as its members. These sit in
 *   sr-screening-questions-form's shadow root, which the scanner crosses since the core pass of 2026-11-06 (dom/scan.ts
 *   adapterParts, holdsComposed); the question is the label its fieldset names (labelFor), required where the fieldset
 *   says so (requiredFor: its drawn mark is aria-hidden). The comboboxes
 *   (spl-autocomplete's input[role=combobox], spl-select's button[role=combobox]) show no list in any snapshot: they
 *   are not declared, and stay the person's.
 * - Steps (nextButton, submitButton, isFinalStep, stepSignature): the first page's Next (oc-button[data-test=
 *   footer-next], its spl-button's own button), the screening step's Submit (oc-button[data-test=footer-submit]); a page
 *   that shows Submit is final, one that shows Next is not. No snapshot shows the page after Submit.
 * - Errors: each oc-validation-summary's ul[data-test=validation-summary] once it holds words, besides the standard
 *   ones (no snapshot shows one filled).
 * - Never pressed: the posting's SmartR button, "Refer a friend", its share links and cookie settings; the one-click
 *   page's Apply with Indeed and SEEK (and the LinkedIn widget's frame), the Experience and Education "Add" buttons, the
 *   screening step's Back and every page's "Cookie Settings".
 * - jr6 C3 (APPLYPLAN, SP\jr6\audit\apply-c.md C3; BUILD.md §4): the one-click form is drawn by SmartRecruiters' Angular
 *   app from data it fetches, after the content script starts: quirks.formLateMs 30 s (Jobright's entry flow polls 15 s
 *   for the personal-information box).
 * Nothing here reads, logs or sends a value.
 */
import { newScanCache, type ScanCache } from '../../dom/scan-cache';
import { isUserVisible } from '../../dom/visibility';
import { genericAdapter } from '../generic';
import type { Adapter, WidgetDecl } from '../types';
import { canonicalApplicationUrl, matchesUrl, parseSmartRecruitersUrl } from './url';

/** The snapshots the hooks were written from (fixtures/smartrecruiters/). */
export const SMARTRECRUITERS_SNAPSHOTS = ['fixtures/smartrecruiters/xplor-posting.html',
  'fixtures/smartrecruiters/bertelsmann-expired.html', 'fixtures/smartrecruiters/xplor-one-click.html',
  'fixtures/smartrecruiters/xplor-screening.html'] as const;

/** Every element under `scope` matching `selector`, in its open shadow roots too (each root's after its tree's own). */
function deepAll<T extends Element>(scope: Document | Element | ShadowRoot, selector: string): T[] {
  const found: T[] = [];
  const visit = (at: Document | Element | ShadowRoot) => {
    for (const el of Array.from(at.querySelectorAll('*'))) {
      if (el.matches(selector)) found.push(el as T);
      if (el.shadowRoot !== null) visit(el.shadowRoot);
    }
  };
  // An element's own shadow root first (a node type, not instanceof: a frame's elements are of another realm).
  if ((scope as Node).nodeType === 1 && (scope as Element).shadowRoot !== null) visit((scope as Element).shadowRoot!);
  visit(scope);
  return found;
}

/** The element whose shadow root holds `el`, or null in the document's own tree. */
function hostOf(el: Element): Element | null {
  const root = el.getRootNode() as Partial<ShadowRoot>;
  return root.host ?? null;
}

/** The first of `elements` a person can see. */
function shown<T extends Element>(elements: readonly T[], cache: ScanCache = newScanCache()): T | null {
  return elements.find((el) => isUserVisible(el, cache)) ?? null;
}

/** The form root (module header): xplor-one-click.html's <oc-oneclick-form>, xplor-screening.html's
 *  <oc-screening-questions>, both in the document's own tree. */
function detect(doc: Document): { formRoot: Element } | null {
  const root = shown(Array.from(doc.querySelectorAll('oc-oneclick-form, oc-screening-questions')));
  return root === null ? null : { formRoot: root };
}

/** The posting's own text: xplor-posting.html's <main class="jobad-main job" role="main"> ... <div class="job-sections">. */
function postingText(doc: Document): Element | null {
  return shown(Array.from(doc.querySelectorAll('main.jobad-main .job-sections')));
}

/** The document's own address: its location's, or (a fixture's srcdoc page) its base address; null when neither
 *  reads. */
function addressOf(doc: Document): URL | null {
  try {
    const href = doc.location.href;
    return new URL(/^https?:/i.test(href) ? href : doc.baseURI);
  } catch {
    return null;
  }
}

/** "I'm interested": xplor-posting.html's <a class="button button--primary button--huge js-oneclick job-button"
 *  data-sr-track="apply" data-sr-track-position="bottom" href="https://jobs.smartrecruiters.com/oneclick-ui/company/Xplor/
 *  publication/<uuid>?dcr_ci=Xplor"> (and its "aside" copy, id="st-apply"; its "header" copy is aria-hidden), whose
 *  address is the one-click application of the posting's own company. */
function entryControl(doc: Document): HTMLElement | null {
  const address = addressOf(doc);
  const here = address === null ? null : parseSmartRecruitersUrl(address);
  if (here === null || here.page !== 'posting') return null;
  const links = Array.from(doc.querySelectorAll<HTMLElement>('a.js-oneclick[data-sr-track="apply"][href]')).filter((link) => {
    if (link.closest('[aria-hidden="true"]') !== null) return false;
    try {
      const target = parseSmartRecruitersUrl(new URL(link.getAttribute('href') ?? '', doc.baseURI));
      return target !== null && target.page === 'application' && target.board === here.board;
    } catch {
      return false;
    }
  });
  return shown(links);
}

/** The one-click page's "Easy Apply" block (module header): <oc-easy-apply>, its resume drop zone
 *  (spl-dropzone[data-test=apply-with-resume-container]) and its external providers. */
function excluded(root: Element): Element[] {
  return Array.from(root.querySelectorAll('oc-easy-apply'));
}

/** The screening Yes/No questions (module header): xplor-screening.html's <spl-radio-group required id="..."> elements. */
function widgetRoots(root: Element): Element[] {
  return deepAll(root, 'spl-radio-group');
}

/** A screening Yes/No question (module header): xplor-screening.html's <spl-radio-group required id="..."> whose shadow
 *  root holds <fieldset role="radiogroup" class=" c-spl-radio-group ..." aria-labelledby="<id>-label"
 *  aria-required="true">, and whose own children are its options, slotted into that fieldset: <spl-radio tabindex="0"
 *  id="..." value="1" role="radio" aria-checked="false" aria-disabled="false"> ... Yes. */
function widgetFor(control: Element): WidgetDecl | null {
  if (control.localName !== 'spl-radio-group') return null;
  const members = Array.from(control.children).filter((child): child is HTMLElement =>
    child.localName === 'spl-radio' && child.getAttribute('role') === 'radio');
  return members.length >= 2 ? { kind: 'radio', opener: control as HTMLElement, members,
    snapshot: SMARTRECRUITERS_SNAPSHOTS[3] } : null;
}

// ── The core pass of 2026-11-06: the screening Yes/No question's label and required mark ──
/** A screening Yes/No question's own fieldset (xplor-screening.html: <spl-radio-group required id="spl-form-element_21">
 *  > (shadow) <spl-internal-form-field> ... <fieldset role="radiogroup" class=" c-spl-radio-group ..."
 *  aria-labelledby="spl-form-element_21-label" aria-required="true">), or null for any other element. */
function groupFieldsetOf(control: Element): Element | null {
  if (control.localName !== 'spl-radio-group') return null;
  return control.shadowRoot?.querySelector('fieldset[role="radiogroup"]') ?? null;
}

/** The label a screening Yes/No question's fieldset names by aria-labelledby, in the group's own shadow root
 *  (xplor-screening.html: <label slot="label" class=" c-spl-form-field-label c-spl-form-field-label--group "
 *  for="spl-form-element_21" id="spl-form-element_21-label"> ... <slot name="label-content"></slot><span
 *  class="c-spl-form-field-required-mark" aria-hidden="true">*</span> ..., its question the group's own <span
 *  slot="label-content">, slotted in), or null. */
function groupLabelOf(control: Element): Element | null {
  const fieldset = groupFieldsetOf(control);
  const id = (fieldset?.getAttribute('aria-labelledby') ?? '').trim();
  if (fieldset === null || id === '' || /\s/.test(id)) return null;
  const label = control.shadowRoot?.getElementById(id) ?? null;
  return label?.localName === 'label' ? label : null;
}

/** A screening Yes/No question is required where its fieldset says so (aria-required="true"): its drawn mark is
 *  aria-hidden, and the group itself carries only a bare required attribute, which no property reads on the custom
 *  element. */
function requiredFor(control: Element): boolean {
  return (groupFieldsetOf(control)?.getAttribute('aria-required') ?? '').trim().toLowerCase() === 'true';
}
// ── end of the core pass's block ──

/** The label of a control the page labels from outside its own shadow root (module header), or null. */
function labelFor(control: Element): Element | null {
  // The core pass of 2026-11-06: a screening Yes/No question, labelled inside its own shadow root.
  if (control.localName === 'spl-radio-group') return groupLabelOf(control);
  const host = hostOf(control);
  if (host === null) return null;
  // xplor-one-click.html: <spl-phone-field ... id="spl-form-element_5"> > (shadow) <label slot="label" ...
  // for="spl-form-element_5" id="spl-form-element_5-label">Phone number<span class="c-spl-form-field-required-mark"
  // aria-hidden="true">*</span></label> ... <spl-input class="c-spl-phone-field-input" ...> > (shadow) <input ...
  // id="spl-form-element_5" type="tel" aria-label="Phone number" aria-required="true">.
  if (host.localName === 'spl-input' && host.classList.contains('c-spl-phone-field-input')) {
    const field = hostOf(host);
    return field?.localName === 'spl-phone-field' ? field.shadowRoot?.querySelector('label[slot="label"]') ?? null : null;
  }
  if (host.localName !== 'spl-dropzone' || !control.matches('input[type="file"]')) return null;
  // xplor-one-click.html: <oc-resume-upload><div data-test="resume-upload-container" ...><spl-typography-title
  // data-test="section-title" ...>Resume<span data-test="section-required-mark" class="spl-text-red-60">*</span>
  // </spl-typography-title> ... <spl-dropzone data-test="resume-upload">.
  const resume = host.closest('oc-resume-upload');
  if (resume !== null) return resume.querySelector('spl-typography-title[data-test="section-title"]');
  // xplor-screening.html: <sr-question-custom-form-field> ... <span slot="label-content">Additional attachments</span>
  // <div slot="content"><spl-dropzone data-spl-field multiple>.
  return host.closest('sr-question-custom-form-field')?.querySelector(':scope > [slot="label-content"]') ?? null;
}

/** Each drop zone's file input with its label (module header): <spl-dropzone ...> > (shadow) <label
 *  for="spl-dropzone-file-input-1">Choose a file or drop it here</label><input type="file" id="spl-dropzone-file-input-1"
 *  accept="..." aria-describedby="spl-dropzone-restriction-label-1">. */
function uploadWidgets(root: Element): Array<{ control: Element; input: HTMLInputElement }> {
  return deepAll(root, 'spl-dropzone').flatMap((zone) => {
    const shadow = zone.shadowRoot;
    const input = shadow?.querySelector<HTMLInputElement>('input[type="file"]') ?? null;
    if (shadow === null || input === null || input.id === '') return [];
    const control = Array.from(shadow.querySelectorAll<HTMLLabelElement>('label[for]')).find((label) => label.htmlFor === input.id);
    return control === undefined ? [] : [{ control, input }];
  });
}

/** An oc-button's own button: <oc-button type="primary" data-test="footer-next"><spl-button ...> > (shadow) <button
 *  class=" c-spl-button-wrapper c-spl-button c-spl-button--primary " type="button" ...>. */
function buttonOf(doc: Document, test: string): HTMLElement | null {
  const buttons = Array.from(doc.querySelectorAll(`oc-button[data-test="${test}"] spl-button`))
    .flatMap((host) => Array.from(host.shadowRoot?.querySelectorAll<HTMLElement>('button') ?? []));
  return shown(buttons);
}

/** The first page's Next (xplor-one-click.html: oc-nav-first-page's oc-button[data-test=footer-next]). */
function nextButton(root: Element): HTMLElement | null {
  return buttonOf(root.ownerDocument, 'footer-next');
}

/** The screening step's Submit (xplor-screening.html: oc-nav-screening-questions' oc-button[data-test=footer-submit]). */
function submitButton(root: Element): HTMLElement | null {
  return buttonOf(root.ownerDocument, 'footer-submit');
}

function isFinalStep(doc: Document): 'final' | 'not-final' | 'unknown' {
  if (submitButton(doc.documentElement) !== null) return 'final';
  return nextButton(doc.documentElement) !== null ? 'not-final' : 'unknown';
}

/** The step a page shows: its root's own element (oc-oneclick-form or oc-screening-questions) and its address's last
 *  word (the screening step's "screening"). */
function stepSignature(doc: Document): { heading?: string; urlPart?: string; anchors: string[] } {
  const root = detect(doc)?.formRoot ?? null;
  const address = addressOf(doc);
  const last = address?.pathname.replace(/\/$/, '').split('/').pop() ?? '';
  return { urlPart: last === 'screening' ? 'screening' : 'first', anchors: root === null ? [] : [root.localName] };
}

/** The page's own errors, besides the standard ones: each <oc-validation-summary><ul data-test="validation-summary"
 *  aria-live="assertive" ...> once it holds words a person can see (empty in every snapshot). */
function errors(root: Element): Array<{ el: Element; fieldKeyHint?: string }> {
  const cache = newScanCache();
  const summaries = deepAll(root, 'ul[data-test="validation-summary"]')
    .filter((el) => (el.textContent ?? '').trim() !== '' && isUserVisible(el, cache)).map((el) => ({ el }));
  return [...(genericAdapter.errors?.(root) ?? []), ...summaries];
}

/** The controls never pressed (module header). */
const NEVER_PRESSED = [
  // xplor-posting.html: "I'm interested" (the entry door's alone), with SmartR, "Refer a friend", the share links,
  // the video, cookie settings and the WeChat dialog's buttons.
  'a.js-oneclick', 'a.js-smartr-oneclick', 'a#st-refer', 'a.social-link', 'a.js-video-play', '.ot-sdk-show-settings',
  'button.modal-close', '#wechat-copy-clipboard',
  // xplor-one-click.html: Apply With Indeed and SEEK, the LinkedIn widget's frame.
  'button.external-apply-button', 'oc-apply-with-linked-in iframe',
];
/** The oc-buttons never pressed: the Experience and Education "Add" (xplor-one-click.html) and the screening step's
 *  Back (xplor-screening.html); each pressed through its spl-button's own button. */
const NEVER_PRESSED_BUTTONS = ['add-experience', 'add-education', 'footer-back'];

function neverPress(root: Element): Element[] {
  const doc = root.ownerDocument;
  const found = deepAll(doc, NEVER_PRESSED.join(', '));
  for (const test of NEVER_PRESSED_BUTTONS) {
    for (const host of Array.from(doc.querySelectorAll(`oc-button[data-test="${test}"] spl-button`))) {
      found.push(host, ...Array.from(host.shadowRoot?.querySelectorAll('button') ?? []));
    }
  }
  return [...new Set(found)];
}

/** jr6 C3 (module header; BUILD.md §4 sets 30 s, the audit measured 15 s enough with the form drawn 1 s late): how long
 *  after the page loads, or after an address change, the content runtime still looks for the one-click form. */
export const SMARTRECRUITERS_FORM_LATE_MS = 30_000;

/** The SmartRecruiters adapter. */
export const smartRecruitersAdapter: Adapter = {
  id: 'smartrecruiters',
  matchesUrl,
  canonicalApplicationUrl,
  detect,
  postingText,
  entryControl,
  // "I'm interested" is never pressed by a run (neverPress): the entry door presses that element alone.
  entryNeverPressed: true,
  excluded,
  widgetRoots,
  widgetFor,
  labelFor,
  // The core pass of 2026-11-06: a screening Yes/No question's fieldset says it is required.
  requiredFor,
  uploadWidgets,
  nextButton,
  submitButton,
  isFinalStep,
  stepSignature,
  errors,
  neverPress,
  // jr6 C3 (module header): the one-click form is drawn late by the page's own app.
  quirks: { formLateMs: SMARTRECRUITERS_FORM_LATE_MS },
};
