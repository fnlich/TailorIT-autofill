/*
 * The Workday adapter's application steps (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06; docs/ARCHITECTURE.md "Adapters", "Workday"): every
 * hook here was read from the owner's signed-in snapshots of 2026-11-06 (F:\Develop\TailorIT-autofill\snapshots\, 79
 * pages of 11 tenants on *.myworkdayjobs.com, through "Autofill with Resume" and "Apply Manually"), converted as
 * fixtures/workday/<tenant>-<step>.html (WORKDAY_STEP_SNAPSHOTS), and names the snapshot it relies on. The flow page
 * (main > [data-automation-id=applyFlowPage], index.ts detect) keeps one address for every step and draws each step in
 * place:
 * - Step identity (stepSignature): the progress bar, ol[data-automation-id=progressBar], one li per step
 *   (progressBarCompletedStep, progressBarActiveStep, progressBarInactiveStep), each with two labels, "current step 2 of
 *   7" (aria-live) and the step's name ("My Information"); the shown step's own page, a div whose data-automation-id
 *   names it (STEP_PAGES, REVIEW_PAGE), or the account view (signInContent) on step 1 of an Apply Manually flow. The
 *   heading is the active step's name, the progress its "current step N of M", the anchor the step page's id; the
 *   address is the same on every step, so it is no part.
 * - Final step (isFinalStep): the Review page (applyFlowReviewPage) on the bar's last step is 'final', its footer button
 *   reading "Submit" (submitButton); any other step page this adapter knows, on a step before the last, with its
 *   footer's button shown, is 'not-final' ("Save and Continue"; "Continue" on Autofill with Resume: nextButton); the
 *   account view, an unknown step page or a bar that disagrees is 'unknown', so nothing is pressed there.
 * - Next (nextButton): button[data-automation-id=pageFooterNextButton] on a 'not-final' step, except while a required
 *   date the step shows is still empty (requiredDateEmpty, Dates below): Back (pageFooterBackButton) is never pressed.
 * - Sections (sections): each div[role=group] whose aria-labelledby names a heading (h4 "Legal Name", "Address",
 *   "Phone", "Terms and Conditions"; h5 "Websites 1"), else the step's own name for the rest of its page.
 * - Labels and required (labelFor, requiredFor): label[for] names text boxes, text areas, a dropdown's button and a
 *   prompt's search box; a fieldset's legend names a radio group; a checkbox group (fieldset[data-automation-id$=
 *   "-CheckboxGroup"], no legend of its own, inside a fieldset whose legend holds the question) is named by the outer
 *   legend. A question is required where its label or legend draws Workday's star, <abbr aria-hidden="true">*</abbr>
 *   ("* Indicates a required field" above each step): aria-required is set on text boxes alone. On Self Identify, the
 *   form's title (h3 "Voluntary Self-Identification of Disability") is each question's help text (descriptionFor): its
 *   "Please check one of the boxes below:" names no topic, so the core's EEO and sensitive rules read the title.
 * - Widgets (widgetRoots, widgetFor):
 *   - the dropdown, a button[aria-haspopup=listbox] (a hidden <input type="text"> beside it mirrors its answer): a
 *     select-only 'combobox'. Closed it names no list; opened (by the button's own click, a <button type="button">) it
 *     says aria-expanded="true" and aria-controls its ul[role=listbox], drawn at the end of the body, whose
 *     li[role=option] (first "Select One", aria-disabled) each hold their words ("[resolvetech.wd1.myworkdayjobs.com]
 *     Devops Engineer (3)": the source list open). Its answer is the button's own words, and none while its value is
 *     empty (shownAnswer: every closed dropdown of the snapshots, value="" with "Select One" before an answer).
 *   - the prompt ("How Did You Hear About Us?", Country Phone Code, Field of Study, Skills, School, an attachment's
 *     Category): div[data-automation-id=multiSelectContainer] around an input[placeholder=Search], its answers pills
 *     ([data-automation-id=selectedItem] in ul[data-automation-id=selectedItemList]): a search ('typeahead-remote'), as
 *     Lever's location search is. No snapshot shows its list open, so no ARIA names a list: the helpers never type into
 *     it (widget-unsupported, the person's), and its pills are its answer (shownAnswer).
 *   Neither needs the page-world bridge: the snapshots show standard ARIA on the dropdown, and nothing of the prompt's
 *   list (an MHTML holds no React props).
 * - Dates: Workday's date input ([data-automation-id=dateInputWrapper], "From"/"To" in Work Experience, a year alone in
 *   Education, month/day/year on Application Questions and Self Identify) draws each part as an aria-hidden display over
 *   a 1 px, scale(0.01), z-index -1000 input[role=spinbutton]: the scanner reads that input as hidden, as a person
 *   cannot see it, so a date is never written. No snapshot shows how the part takes typed digits; until one does, a
 *   required date is the person's, and Next is theirs while one is empty (nextButton).
 * - Radios and checkboxes are native inputs with label[for] (previous worker, "I currently work here", the terms box,
 *   the SMS and WhatsApp opt-ins, the ethnicity and disability groups), filled by the standard fillers.
 * - Uploads (uploadWidgets, uploadState): a drop zone, [data-automation-id=file-upload-drop-zone], holds
 *   button[data-automation-id=select-files] ("Select files", which opens the file chooser: never pressed) and the
 *   input[type=file][data-automation-id=file-upload-input-ref]; after an upload its field shows
 *   [data-automation-id=file-upload-item] with the file's name ([data-automation-id=file-upload-item-name]) and
 *   [data-automation-id=file-upload-successful] ("Successfully Uploaded!"): confirmed. No snapshot shows a failed one.
 * - Repeatable sections (repeatables): My Experience's Work Experience and Education, each a div[role=group]
 *   aria-labelledby "<Kind>-section" (its h4) holding blocks div[role=group] aria-labelledby "<Kind>-<n>-panel" (an h5
 *   "Work Experience 1" with its Delete button) and its button[data-automation-id=add-button] ("Add" while it has no
 *   block, "Add Another" after); a Work Experience block's "I currently work here" is its input[name=currentlyWorkHere].
 *   Languages shows only its Add in the snapshots (no block's markup seen), Websites is no kind the core counts.
 * - The account view (index.ts) shows Workday's sign-in error as div[data-automation-id=errorMessage][role=alert]
 *   above the form ("[verily.wd1.myworkdayjobs.com] Sign In (1)": "Verify your account before you sign in or request a
 *   verification email."): errors names it, so Sign-in Auto reads a failed sign-in at once. The busy sign is
 *   [data-automation-id=wd-LoadingPanel] in a glass panel ([data-automation-id=glassPanel], data-automation-hidden=
 *   "true" while idle, the same snapshot): isBusy while a person can see it.
 * - Never pressed (neverPressedOnSteps): Back, the cookie notice's Accept and Decline (legalNotice), "Resend Account
 *   Verification" (informationalBlurbButton), an upload's Delete (delete-file) and "Select files", a pill's remove
 *   (DELETE_charm), a block's Delete, the date's calendar (dateIcon) and the phone's "Terms and Conditions" link.
 * No snapshot shows the page after Submit, nor Workday's validation errors after a Next: neither is read yet
 * (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06 "Still unknown"). Nothing here reads, logs or sends a value: the answers shownAnswer reads stay
 * in the page's memory for the read-back, as every widget's do.
 */
import { newScanCache, type ScanCache } from '../../dom/scan-cache';
import { TEXT_CAP_LABEL } from '../../dom/thresholds';
import { visibleText } from '../../dom/visible-text';
import { isUserVisible } from '../../dom/visibility';
import type { Adapter, UploadState, WidgetDecl } from '../types';
import { storedListOf } from './lists';

/** The owner's snapshots the step hooks were written from, as converted (fixtures/workday/). */
export const WORKDAY_STEP_SNAPSHOTS = ['fixtures/workday/cisive-autofill-resume.html',
  'fixtures/workday/resolvetech-source-open.html',
  'fixtures/workday/resolvetech-my-experience.html', 'fixtures/workday/web-my-experience.html',
  'fixtures/workday/web-application-questions.html', 'fixtures/workday/aep-application-questions-2.html',
  'fixtures/workday/danafarber-voluntary-disclosures.html', 'fixtures/workday/danafarber-self-identify.html',
  'fixtures/workday/web-review.html', 'fixtures/workday/verily-sign-in-verify.html'] as const;

/**
 * The step pages before Review, by their data-automation-id, each from the snapshots of a whole flow (the progress
 * bar's names in brackets): applyFlowAutoFillPage ("Autofill with Resume", cisive's "Careers"), applyFlowMyInfoPage
 * ("My Information"), applyFlowMyExpPage ("My Experience"), applyFlowPrimaryQuestionsPage ("Application Questions",
 * or "Application Questions 1 of 2" on danafarber's), applyFlowSecondaryQuestionsPage (aep's "Application Questions 2
 * of 2"), applyFlowSupplementaryQuestionsPage (danafarber's "Application Questions 2 of 2"),
 * applyFlowVoluntaryDisclosuresPage ("Voluntary Disclosures") and applyFlowSelfIdentifyPage ("Self Identify").
 */
export const STEP_PAGES = ['applyFlowAutoFillPage', 'applyFlowMyInfoPage', 'applyFlowMyExpPage',
  'applyFlowPrimaryQuestionsPage', 'applyFlowSecondaryQuestionsPage', 'applyFlowSupplementaryQuestionsPage',
  'applyFlowVoluntaryDisclosuresPage', 'applyFlowSelfIdentifyPage'] as const;
/** The last step's page ("Review", every flow's last item of the bar; fixtures/workday/web-review.html). */
export const REVIEW_PAGE = 'applyFlowReviewPage';

/** An element by its data-automation-id, in `scope`. */
const byId = <T extends Element = HTMLElement>(scope: ParentNode, id: string) =>
  scope.querySelector<T>(`[data-automation-id="${id}"]`);
/** Every element by its data-automation-id, in `scope`. */
const allById = <T extends Element = HTMLElement>(scope: ParentNode, id: string) =>
  Array.from(scope.querySelectorAll<T>(`[data-automation-id="${id}"]`));

/** The first of `elements` a person can see. */
function shown<T extends Element>(elements: readonly T[], cache: ScanCache): T | null {
  return elements.find((el) => isUserVisible(el, cache)) ?? null;
}

/** The text of an element on one line, collapsed, from the page's own words (page text: hashed or shown, never
 *  logged). */
const wordsOf = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The flow page a person sees (index.ts detect's: main > [data-automation-id=applyFlowPage]). */
function flowOf(doc: Document, cache: ScanCache): Element | null {
  return shown(allById(doc, 'applyFlowPage').filter((el) => el.closest('main') !== null), cache);
}

/** The step page shown in the flow page: the one element whose data-automation-id is a step page's this adapter knows
 *  (STEP_PAGES, REVIEW_PAGE) or any other "applyFlow…Page" (unknown), a person can see. */
function stepPageOf(flow: Element, cache: ScanCache): { el: Element; id: string } | null {
  const pages = Array.from(flow.querySelectorAll('[data-automation-id^="applyFlow"][data-automation-id$="Page"]'))
    .filter((el) => el !== flow && isUserVisible(el, cache));
  if (pages.length !== 1) return null;
  return { el: pages[0]!, id: pages[0]!.getAttribute('data-automation-id') ?? '' };
}

/** The progress bar's reading: the active step's place (from 1) among the bar's steps, its two labels' words. */
interface Progress {
  current: number;
  total: number;
  /** "current step 2 of 7", the active step's aria-live label. */
  line: string;
  /** "My Information", the active step's name. */
  name: string;
}

/** The progress bar (module header): fixtures/workday/web-review.html's <ol data-automation-id="progressBar"><li
 *  data-automation-id="progressBarCompletedStep"> ... <label aria-live="polite">completed step 1 of 7</label>
 *  <label>Autofill with Resume</label></li> ... <li data-automation-id="progressBarActiveStep"> ... <label
 *  aria-live="polite">current step 7 of 7</label><label>Review</label></li></ol>. Null without one active step. */
function progressOf(flow: Element): Progress | null {
  const bar = byId(flow, 'progressBar');
  if (bar === null) return null;
  const steps = Array.from(bar.querySelectorAll(':scope > li[data-automation-id^="progressBar"][data-automation-id$="Step"]'));
  const active = steps.filter((step) => step.getAttribute('data-automation-id') === 'progressBarActiveStep');
  if (active.length !== 1) return null;
  const labels = Array.from(active[0]!.querySelectorAll(':scope > label'));
  const line = labels.find((label) => label.hasAttribute('aria-live')) ?? null;
  const name = labels.find((label) => !label.hasAttribute('aria-live')) ?? null;
  return { current: steps.indexOf(active[0]!) + 1, total: steps.length, line: wordsOf(line), name: wordsOf(name) };
}

/** The step a person sees: the flow page, its step page (or the account view), and the bar. */
function stepOf(doc: Document, cache: ScanCache = newScanCache()) {
  const flow = flowOf(doc, cache);
  if (flow === null) return null;
  const page = stepPageOf(flow, cache);
  const account = page === null ? shown(allById(flow, 'signInContent'), cache) : null;
  return { flow, page, account, progress: progressOf(flow) };
}

/** The step's identity (module header): the active step's name and "current step N of M", and the step page's id (the
 *  account view's on step 1 of Apply Manually). Page text and markup only, hashed by the core. */
export function stepSignature(doc: Document): ReturnType<NonNullable<Adapter['stepSignature']>> {
  const step = stepOf(doc);
  if (step === null) return { anchors: [] };
  const anchor = step.page?.id ?? (step.account !== null ? 'signInContent' : '');
  return {
    heading: step.progress?.name ?? '',
    progress: step.progress?.line ?? '',
    anchors: anchor === '' ? [] : [anchor],
  };
}

/** The footer's Next-or-Submit: fixtures/workday/web-review.html's <div data-automation-id="pageFooter"> ... <button
 *  data-automation-id="pageFooterNextButton" ...>Submit</button>; "Save and Continue" on the steps before it
 *  (resolvetech-source-open.html), "Continue" on Autofill with Resume (cisive-autofill-resume.html). */
function footerButtonOf(scope: ParentNode, cache: ScanCache): HTMLElement | null {
  return shown(Array.from(scope.querySelectorAll<HTMLElement>('button[data-automation-id="pageFooterNextButton"]')), cache);
}

/** Final on Review, the bar's last step; not final on a known step page before the last that shows its footer's
 *  button; unknown otherwise (module header). */
export function isFinalStep(doc: Document): 'final' | 'not-final' | 'unknown' {
  const cache = newScanCache();
  const step = stepOf(doc, cache);
  if (step === null || step.page === null || step.progress === null) return 'unknown';
  const { current, total } = step.progress;
  if (step.page.id === REVIEW_PAGE) return current === total ? 'final' : 'unknown';
  if (!(STEP_PAGES as readonly string[]).includes(step.page.id) || current >= total) return 'unknown';
  return footerButtonOf(step.flow, cache) !== null ? 'not-final' : 'unknown';
}

/** The placeholder each part of Workday's date input shows while empty (fixtures/workday/resolvetech-my-experience.html:
 *  <div ... data-automation-id="dateSectionMonth-display">MM</div> over <input role="spinbutton" aria-label="Month" ...
 *  aria-required="true" ... data-automation-id="dateSectionMonth-input" value="">; "YYYY", and Self Identify's "DD"). */
const DATE_PARTS = ['dateSectionMonth', 'dateSectionDay', 'dateSectionYear'] as const;

/** Whether a required date the step shows is still empty: a dateInputWrapper a person can see whose parts are required
 *  (aria-required="true" on each spin button) and all empty. Its parts are never written (module header). */
function requiredDateEmpty(page: Element, cache: ScanCache): boolean {
  return allById(page, 'dateInputWrapper').some((wrapper) => {
    const parts = DATE_PARTS.map((part) => byId<HTMLInputElement>(wrapper, `${part}-input`))
      .filter((input): input is HTMLInputElement => input !== null);
    return parts.length > 0 && isUserVisible(wrapper, cache)
      && parts.every((input) => (input.getAttribute('aria-required') ?? '').trim().toLowerCase() === 'true'
        && input.value.trim() === '');
  });
}

/** Next on a step before the last (module header), or null. */
export function nextButton(root: Element): HTMLElement | null {
  const doc = root.ownerDocument;
  if (isFinalStep(doc) !== 'not-final') return null;
  const cache = newScanCache();
  const step = stepOf(doc, cache);
  if (step === null || step.page === null || requiredDateEmpty(step.page.el, cache)) return null;
  return footerButtonOf(step.flow, cache);
}

/** Review's Submit (module header), identified so that only the gates press it; null on any other step. */
export function submitButton(root: Element): HTMLElement | null {
  const doc = root.ownerDocument;
  if (isFinalStep(doc) !== 'final') return null;
  const cache = newScanCache();
  const step = stepOf(doc, cache);
  return step === null ? null : footerButtonOf(step.flow, cache);
}

/** The step's sections (module header): its labelled groups, else its own name. */
export function sections(root: Element): Array<{ el: Element; label: string }> {
  const cache = newScanCache();
  const step = stepOf(root.ownerDocument, cache);
  if (step === null || step.page === null) return [];
  const found: Array<{ el: Element; label: string }> = [];
  if (step.progress !== null && step.progress.name !== '') found.push({ el: step.page.el, label: step.progress.name });
  // fixtures/workday/resolvetech-source-open.html: <div role="group" aria-labelledby="Legal-Name-section"><h4
  // id="Legal-Name-section">Legal Name</h4> ...; web-my-experience.html: <div role="group"
  // aria-labelledby="Websites-1-panel"><div><h5 id="Websites-1-panel">Websites 1</h5> ...
  for (const group of Array.from(step.page.el.querySelectorAll('[role="group" i][aria-labelledby]'))) {
    const id = (group.getAttribute('aria-labelledby') ?? '').trim();
    const heading = id === '' || /\s/.test(id) ? null : root.ownerDocument.getElementById(id);
    if (heading === null || !/^h[1-6]$/.test(heading.localName) || !group.contains(heading)) continue;
    const label = visibleText(heading, { singleLine: true, cap: TEXT_CAP_LABEL, cache });
    if (label !== '') found.push({ el: group, label });
  }
  return found;
}

/** A question's field container: <div data-automation-id="formField-<name>"> (every snapshot's questions). */
const fieldOf = (control: Element) => control.closest('[data-automation-id^="formField-"]');

/** The legend of the fieldset that holds a question in its field container, or null. */
function legendIn(field: Element | null, from: Element): Element | null {
  const fieldset = from.closest('fieldset');
  if (field === null || fieldset === null || !field.contains(fieldset)) return null;
  return Array.from(fieldset.children).find((child) => child.localName === 'legend') ?? null;
}

/**
 * The question that labels a control the page names by no attribute (module header):
 * - a checkbox group: fixtures/workday/danafarber-voluntary-disclosures.html's <div
 *   data-automation-id="formField-ethnicityMulti" ...><fieldset><legend><label id="label..."><span>If you identify ...
 *   </span></label></legend><span ...><fieldset data-automation-id="ethnicityMulti-CheckboxGroup" ...
 *   aria-required="true">, the inner fieldset holding the boxes, named by the outer one's legend;
 * - a dropdown of an Application Questions step: fixtures/workday/aep-application-questions-2.html's <div
 *   data-automation-id="formField-928b890c..." ...><fieldset><legend><div id="rich-label..."><div
 *   data-automation-id="richText"><p><span>Will you now or in the future require sponsorship ...<abbr
 *   title="required">*</abbr></span></p></div></div></legend> ... <button aria-haspopup="listbox" ... aria-label="
 *   Select One Required" ...>, no label[for]: its legend (the text box of the same step gets it by the scanner's rule).
 */
export function labelFor(control: Element): Element | null {
  if (control.matches('fieldset[data-automation-id$="-CheckboxGroup"]')) {
    const outer = control.parentElement?.closest('fieldset') ?? null;
    return outer === null ? null : legendIn(fieldOf(control), outer);
  }
  if (control.localName === 'button' && control.matches('button[aria-haspopup="listbox" i]')
    && (control as HTMLButtonElement).labels.length === 0) {
    return legendIn(fieldOf(control), control);
  }
  if (control.matches('input[type="file" i][data-automation-id="file-upload-input-ref"]')) return uploadLabelOf(control);
  return null;
}

/** Whether Workday's star is drawn: a person sees it, though its <abbr aria-hidden="true"> keeps it from assistive
 *  technology (which the scanner's visibility rule reads as hidden): the abbr shown by its own style and box, inside an
 *  element a person can see. */
function starDrawn(abbr: Element): boolean {
  if (wordsOf(abbr) !== '*' || abbr.parentElement === null || !isUserVisible(abbr.parentElement)) return false;
  const style = abbr.ownerDocument.defaultView?.getComputedStyle(abbr) ?? null;
  return style !== null && style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) > 0
    && Array.from(abbr.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0);
}

/** Whether the question's label or legend draws Workday's star (module header): resolvetech-source-open.html's <label
 *  for="country--country"><span>Country<abbr aria-hidden="true">*</abbr></span></label>, a radio group's or a checkbox
 *  group's legend the same, and an Application Questions legend's <abbr title="required">*</abbr>. */
export function requiredFor(control: Element): boolean {
  const field = fieldOf(control);
  if (field === null) return false;
  const label = Array.from(field.querySelectorAll('legend, label'))
    .find((el) => el.closest('[data-automation-id^="formField-"]') === field) ?? null;
  return label !== null && Array.from(label.querySelectorAll('abbr')).some(starDrawn);
}

/** The Self Identify step's form title, the help text of each of its questions: fixtures/workday/danafarber-self-
 *  identify.html's <div data-automation-id="applyFlowSelfIdentifyPage"> ... <h3>Voluntary Self-Identification of
 *  Disability</h3> above Name, Employee ID, Date and "Please check one of the boxes below:", whose own words name no
 *  topic: the title says the boxes are the disability form (the core's EEO rule then reads it, and a sensitive answer
 *  found by help text alone is the person's). None on any other step. */
export function descriptionFor(control: Element): Element[] {
  // ── behaviour review 2026-11-06 (M2: the owner's setting "Résumé already on the page" acts on Workday's résumé) ──
  if (control.matches('input[type="file" i][data-automation-id="file-upload-input-ref"]')) return uploadGroupHeading(control);
  // ── end behaviour review (M2) ──
  const page = control.closest('[data-automation-id="applyFlowSelfIdentifyPage"]');
  if (page === null) return [];
  const title = Array.from(page.querySelectorAll('h3')).find((heading) => isUserVisible(heading)
    && (heading.compareDocumentPosition(control) & 4 /* Node.DOCUMENT_POSITION_FOLLOWING */) !== 0) ?? null;
  return title === null ? [] : [title];
}

/** The dropdowns (module header): buttons are no element the scanner collects, so each is a widget root. */
export function widgetRoots(root: Element): Element[] {
  // fixtures/workday/resolvetech-source-open.html: <div data-automation-id="formField-country" ...><label
  // for="country--country">...</label> ... <button aria-haspopup="listbox" type="button" value="..." aria-label="Country
  // ... Required" name="country" id="country--country">...</button><input type="text" value="...">
  return Array.from(root.querySelectorAll('button[aria-haspopup="listbox" i]')).filter((button) => fieldOf(button) !== null);
}

// A widget's shownAnswer answers '' for "it shows no answer": the scanner's read (widgets/options.ts chosenLabels)
// takes '' as none, while null would send it to the widget's own words ("Select One" on a dropdown, the search box's
// text on a prompt).

/** A dropdown's answer (module header): its own words while its value names an option, none while its value is empty
 *  ("Select One"). */
function dropdownAnswer(button: HTMLButtonElement): (known: readonly string[]) => string | null {
  return () => {
    if ((button.getAttribute('value') ?? '').trim() === '') return '';
    return visibleText(button, { singleLine: true, cap: TEXT_CAP_LABEL });
  };
}

/** A prompt's answer (module header): its first pill's words, none without a pill. */
function promptAnswer(container: Element): (known: readonly string[]) => string | null {
  return () => {
    // resolvetech-source-open.html: <ul role="listbox" ... data-automation-id="selectedItemList" aria-label="items
    // selected"><li role="presentation" data-automation-id="menuItem" ...><div ... role="option"
    // data-automation-id="selectedItem" ...><div data-automation-id="DELETE_charm" ...>...</div><p
    // data-automation-id="promptOption" ...>...</p></div></li></ul>
    const pill = allById(container, 'selectedItem').find((item) => isUserVisible(item)) ?? null;
    return pill === null ? '' : visibleText(byId(pill, 'promptOption') ?? pill, { singleLine: true, cap: TEXT_CAP_LABEL });
  };
}

/** The dropdowns and the prompts as their widgets (module header); null for any other control. */
export function widgetFor(control: Element): WidgetDecl | null {
  if (control.localName === 'button' && control.matches('button[aria-haspopup="listbox" i]') && fieldOf(control) !== null) {
    const button = control as HTMLButtonElement;
    // The list open: fixtures/workday/resolvetech-source-open.html's <button aria-haspopup="listbox" type="button"
    // value="" aria-label="How Did You Hear About Us? Select One Required" name="source" id="source--source"
    // aria-expanded="true" aria-controls="nxgyi">Select One</button> and, at the end of the body, <div
    // data-popper-placement="bottom" ...><ul role="listbox" ... id="nxgyi"><li data-value="" role="option"
    // aria-disabled="true" aria-selected="true" id="select-one"><div>Select One</div></li><li data-value="..."
    // role="option" id="..."><div>Career Builder</div></li> ...
    // s2 lists (decision 1): every dropdown's list is drawn whole (all 250 country rows and all 61 state rows are in
    // the DOM: snapshot1's exelixis captures), and Country and State carry their stored lists (lists.ts storedListOf).
    const stored = storedListOf(button);
    return { kind: 'combobox', opener: button, expanded: button, shownAnswer: dropdownAnswer(button),
      drawnWhole: true, ...(stored === null ? {} : { knownOptions: stored }),
      snapshot: 'fixtures/workday/resolvetech-source-open.html' };
  }
  const container = control.localName === 'input' ? control.closest('[data-automation-id="multiSelectContainer"]') : null;
  if (container !== null && fieldOf(container) !== null) {
    // resolvetech-source-open.html: <div ... data-automation-id="multiSelectContainer" ... data-uxi-widget-type="multiselect">
    // <div data-automation-id="multiselectInputContainer" ...><div ...><input enterkeyhint="search" placeholder="Search"
    // ... aria-required="true" autocomplete="off" ... data-uxi-widget-type="selectinput" ... id="phoneNumber--countryPhoneCode"
    // value=""> ...
    // Once it holds a pill its search box is drawn at opacity 0 inside its visible input container (resolvetech-source-
    // open's phone code, web-my-experience's Category): that container is what a person sees as the widget.
    const box = byId(container, 'multiselectInputContainer') ?? container;
    return { kind: 'typeahead-remote', opener: control as HTMLElement, box, shownAnswer: promptAnswer(container),
      snapshot: 'fixtures/workday/resolvetech-source-open.html' };
  }
  return null;
}

/** Each drop zone's "Select files" and its file input (module header). */
export function uploadWidgets(root: Element): Array<{ control: Element; input: HTMLInputElement }> {
  // fixtures/workday/resolvetech-my-experience.html: <div data-automation-id="attachments-FileUpload"
  // aria-labelledby="label61"><div><div data-automation-id="file-upload-drop-zone" ...> ... <div>Drop files here</div>
  // <div><div>or</div><button type="button" data-automation-id="select-files" id="resumeAttachments--attachments"><span>
  // Select files</span></button></div></div><input data-automation-id="file-upload-input-ref" type="file"
  // multiple=""></div> ...: the input beside its drop zone.
  return allById(root, 'file-upload-drop-zone').flatMap((zone) => {
    const control = byId(zone, 'select-files');
    const input = Array.from(zone.parentElement?.children ?? [])
      .find((child) => child.matches('input[type="file" i][data-automation-id="file-upload-input-ref"]')) ?? null;
    return control === null || input === null ? [] : [{ control, input: input as HTMLInputElement }];
  });
}

/** The question a drop zone's file input answers: the label its upload names by aria-labelledby (resolvetech-my-
 *  experience.html: <div data-automation-id="formField-" ...><label id="label61">Upload a file (5MB max)</label> ... <div
 *  data-automation-id="attachments-FileUpload" aria-labelledby="label61">; web-my-experience.html's Additional
 *  Attachments the same as data-automation-id="attachments-file-upload"), the input itself named by nothing. */
function uploadLabelOf(input: Element): Element | null {
  const upload = input.closest('[data-automation-id="attachments-FileUpload"][aria-labelledby], '
    + '[data-automation-id="attachments-file-upload"][aria-labelledby]');
  const id = (upload?.getAttribute('aria-labelledby') ?? '').trim();
  if (upload === null || id === '' || /\s/.test(id)) return null;
  const label = input.ownerDocument.getElementById(id);
  return label !== null && fieldOf(label) === fieldOf(upload) ? label : null;
}

/**
 * The behaviour review of 2026-11-06 (M2): a drop zone's question, as its group's heading names it, the help text of its
 * file input, whose own label is the drop zone's instruction ("Upload a file (5MB max)", which names no document): the
 * core's résumé rule then reads it, as the Self Identify title is read. fixtures/workday/web-my-experience.html (and
 * resolvetech-my-experience.html): <div role="group" aria-labelledby="Resume/CV-section"><h4 id="Resume/CV-section">
 * Resume/CV</h4> ... <div data-automation-id="formField-" ...><label id="label148"><span>Upload a file (5MB max)<abbr
 * ...>*</abbr></span></label> ... <div data-automation-id="attachments-FileUpload" aria-labelledby="label148"> ... <input
 * type="file" data-automation-id="file-upload-input-ref" ...>; and the same group "Additional Attachments" around the
 * attachments-file-upload variant. The heading of the nearest labelled group holding the field and one drop zone only,
 * shown; none for any other input.
 */
function uploadGroupHeading(input: Element): Element[] {
  const field = fieldOf(input);
  const group = field?.parentElement?.closest('[role="group" i][aria-labelledby]') ?? null;
  const id = (group?.getAttribute('aria-labelledby') ?? '').trim();
  if (group === null || id === '' || /\s/.test(id)) return [];
  const heading = input.ownerDocument.getElementById(id);
  if (heading === null || !/^h[1-6]$/.test(heading.localName) || !group.contains(heading) || !isUserVisible(heading)
    || allById(group, 'file-upload-drop-zone').length !== 1) return [];
  return [heading];
}

/** What the page shows of the upload of `fileName` into a drop zone's input (module header); null for any other
 *  input. */
export function uploadState(input: HTMLInputElement, fileName: string): UploadState | null {
  if (!input.matches('input[type="file" i][data-automation-id="file-upload-input-ref"]')) return null;
  // fixtures/workday/web-my-experience.html: the field's <div data-automation-id="file-upload-item"> ... <div
  // data-automation-id="file-upload-item-name">...</div><div>82.46 KB</div><div
  // data-automation-id="file-upload-successful">...Successfully Uploaded!</div> ... <button type="button"
  // data-automation-id="delete-file" ... title="Delete">, in the same formField as the drop zone.
  const field = fieldOf(input);
  if (field === null) return 'pending';
  const name = fileName.replace(/\s+/g, ' ').trim();
  const item = allById(field, 'file-upload-item').find((each) => name !== '' && wordsOf(byId(each, 'file-upload-item-name')) === name);
  if (item === undefined) return 'pending';
  return byId(item, 'file-upload-successful') !== null ? 'confirmed' : 'pending';
}

/**
 * The core pass of 2026-11-06 (Adapter.uploadHeld): whether a drop zone's field shows a file the page took, whatever
 * its name: a "Successfully Uploaded!" a person can see beside the file's name, in the same formField as the input.
 * fixtures/workday/web-my-experience.html (after Workday read the resume at "Autofill with Resume") shows it both ways:
 * Resume/CV's <div data-automation-id="file-upload-item"> ... <div><div data-automation-id="file-upload-item-name">
 * ...</div><div>82.46 KB</div><div data-automation-id="file-upload-successful">...Successfully Uploaded!</div>, and
 * Additional Attachments' (data-automation-id="attachments-file-upload") the same three beside its live region with no
 * file-upload-item around them; fixtures/workday/resolvetech-my-experience.html shows Resume/CV's.
 */
export function uploadHeld(input: HTMLInputElement): boolean {
  return heldNameElements(input).length > 0;
}

/** The integration of 2026-11-06 (Adapter.uploadHeldNames): the names of uploadHeld's files, each its
 *  file-upload-item-name beside the "Successfully Uploaded!" a person can see (the same fixtures), in page order. The
 *  drop zone takes several files, so the person's résumé uploaded again goes in beside the page's (the planner's
 *  duplicate guard reads these names). */
export function uploadHeldNames(input: HTMLInputElement): string[] {
  return heldNameElements(input).map(wordsOf).filter((name) => name !== '');
}

/** The file-upload-item-name beside each shown "Successfully Uploaded!" in a drop zone input's formField (uploadHeld). */
function heldNameElements(input: HTMLInputElement): Element[] {
  if (!input.matches('input[type="file" i][data-automation-id="file-upload-input-ref"]')) return [];
  const field = fieldOf(input);
  if (field === null) return [];
  const cache = newScanCache();
  return allById(field, 'file-upload-successful').flatMap((done) => {
    const name = Array.from(done.parentElement?.children ?? [])
      .find((each) => each.getAttribute('data-automation-id') === 'file-upload-item-name');
    return name !== undefined && isUserVisible(done, cache) ? [name] : [];
  });
}

/** The repeatable kinds the snapshots show blocks of, by their section's heading id prefix (module header). */
const REPEATABLE_SECTIONS = [['experience', 'Work-Experience'], ['education', 'Education']] as const;

/** My Experience's Work Experience and Education (module header). */
export function repeatables(root: Element): ReturnType<NonNullable<Adapter['repeatables']>> {
  const doc = root.ownerDocument;
  // My Experience alone: Review repeats the same groups as its summary (web-review.html), with nothing to add or fill.
  const step = stepOf(doc);
  if (step === null || step.page === null || step.page.id !== 'applyFlowMyExpPage' || !root.contains(step.page.el)) {
    return [];
  }
  const page = step.page.el;
  // fixtures/workday/resolvetech-my-experience.html: <div role="group" aria-labelledby="Work-Experience-section"><h4
  // id="Work-Experience-section">Work Experience</h4><div role="group" aria-labelledby="Work-Experience-1-panel"><div
  // ...><h5 id="Work-Experience-1-panel">Work Experience 1</h5><button ...>Delete</button></div> ... <input
  // id="workExperience-62--currentlyWorkHere" type="checkbox" ... name="currentlyWorkHere" ...> ... </div><button
  // data-automation-id="add-button" ...>Add Another</button></div>; <div role="group" aria-labelledby="Education-section">
  // <h4 id="Education-section">Education</h4><div role="group" aria-labelledby="Education-1-panel"> ...
  return REPEATABLE_SECTIONS.flatMap(([kind, prefix]) => {
    const section = Array.from(page.querySelectorAll(`[role="group" i][aria-labelledby="${prefix}-section"]`))
      .find((group) => doc.getElementById(`${prefix}-section`)?.closest('[role="group" i]') === group) ?? null;
    if (section === null) return [];
    const blocks = () => Array.from(section.querySelectorAll(`[role="group" i][aria-labelledby^="${prefix}-"]`))
      .filter((group) => /^\S+-\d+-panel$/.test(group.getAttribute('aria-labelledby') ?? '')
        && group.parentElement?.closest('[role="group" i]') === section);
    const addButton = () => Array.from(section.querySelectorAll<HTMLElement>('button[data-automation-id="add-button"]'))
      .find((button) => button.closest('[role="group" i]') === section) ?? null;
    return [{
      kind,
      blocks,
      addButton,
      ...(kind === 'experience' ? { currentlyHere: (block: Element) =>
        block.querySelector<HTMLInputElement>('input[type="checkbox" i][name="currentlyWorkHere"]') } : {}),
    }];
  });
}

/** The sign-in's error above its form (module header), for the account view that holds `root` or that `root` holds. */
export function accountErrors(root: Element): Element[] {
  const account = root.closest('[data-automation-id="signInContent"]') ?? byId(root, 'signInContent');
  if (account === null) return [];
  const cache = newScanCache();
  return allById(account, 'errorMessage').filter((error) => error.matches('[role="alert" i]') && wordsOf(error) !== ''
    && isUserVisible(error, cache));
}

/** Workday's loading panel, while a person can see it (module header). */
export function isBusy(doc: Document): boolean {
  const cache = newScanCache();
  return allById(doc, 'wd-LoadingPanel').some((panel) => isUserVisible(panel, cache));
}

/** The automation ids of the steps' controls never pressed (module header). */
const NEVER_PRESSED_ON_STEPS = ['pageFooterBackButton', 'legalNoticeAcceptButton', 'legalNoticeDeclineButton',
  'informationalBlurbButton', 'delete-file', 'select-files', 'DELETE_charm', 'dateIcon',
  'phone-terms-and-condition-link'];

/** The steps' never-pressed controls (module header): by their automation ids, and each block's Delete, the button
 *  beside its h5 (resolvetech-my-experience.html: <div ...><h5 id="Work-Experience-1-panel">Work Experience 1</h5>
 *  <button ...><span ...><svg .../></span>Delete</button></div>). */
export function neverPressedOnSteps(doc: Document): Element[] {
  const found: Element[] = NEVER_PRESSED_ON_STEPS.flatMap((id) => allById(doc, id));
  for (const heading of Array.from(doc.querySelectorAll('h5[id$="-panel"]'))) {
    for (const sibling of Array.from(heading.parentElement?.children ?? [])) {
      if (sibling !== heading && sibling.localName === 'button') found.push(sibling);
    }
  }
  return found;
}
