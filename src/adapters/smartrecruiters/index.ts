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
 *   says so (requiredFor: its drawn mark is aria-hidden).
 * - jr6 (FIXPLAN §6.9; SP\jr6\audit\smartrecruiters.md SR-1, SR-2, SR-6): SmartRecruiters' lists, declared on their own
 *   text box or button (widgetFor). Standard ARIA cannot read them: a box's aria-controls names a menu in an outer
 *   shadow tree, and each option's role=option sits two shadow roots down (spl-select-option > spl-dropdown-item >
 *   div.c-spl-dropdown-item), so each declares its menu (results.list, the aria-controls target looked up through the
 *   shadow roots), its rows (spl-select-option) and the element a choice clicks (pressTarget: the row's inner
 *   .c-spl-dropdown-item, as Jobright's fillSelectField and fillPhoneCountryCodeField click it):
 *   - a screening question's spl-autocomplete (id question_<question id>, xplor-screening.html): a combobox whose whole
 *     list the page publishes in sr-screening-questions-form's definition (knownOptions: that question's
 *     fields[].values[].label), opened on its text box (expanded); one asking for several answers is not declared;
 *   - the City search's spl-autocomplete (data-sr-id=location-autocomplete-search, xplor-one-click.html; its results
 *     drawn open in jr6-wiser-one-click.html): a remote search, never typed shorter than its minquerylength, its
 *     row that switches to the manual location mode (value goToManualLocationMode) never chosen;
 *   - the manual location mode's Country/Region spl-autocomplete (data-sr-id=location-autocomplete-country,
 *     jr6-xplor-one-click-filled.html): a combobox read by opening it;
 *   - the phone's country, spl-phone-field's spl-select (xplor-one-click.html): a combobox on its shadow button, its 245
 *     rows the spl-select-option children slotted into its menu (results.options), drawn whole, labelled by the phone's
 *     own label with "country code" after it (labelFor, labelSuffix: its "Country code" is an aria-label and a hover
 *     tooltip only), showing the row whose value is the select's own value (shownAnswer: the flag alone shows it).
 *   Any other spl-autocomplete or spl-select stays undeclared (no capture shows one).
 * - jr6 SR-11: a drop zone that shows a file (spl-dropzone's shadow ul.c-spl-file-list > li.c-spl-file-list-item) holds
 *   it (uploadHeld), named by its .c-spl-file-list-item-name (uploadHeldNames), and a file the run put in is uploaded
 *   once a row names it (uploadState); the Easy Apply drop zone (hidefilelist) shows no list and holds nothing here.
 * - jr6 C3 (APPLYPLAN, SP\jr6\audit\apply-c.md C3; BUILD.md §4): the one-click form is drawn by SmartRecruiters' Angular
 *   app from data it fetches, after the content script starts: quirks.formLateMs 30 s (Jobright's entry flow polls 15 s
 *   for the personal-information box).
 * - Steps (nextButton, submitButton, isFinalStep, stepSignature): the first page's Next (oc-button[data-test=
 *   footer-next], its spl-button's own button), the screening step's Submit (oc-button[data-test=footer-submit]); a page
 *   that shows Submit is final, one that shows Next is not. The page after Submit: jr7 J7-SR-4 (below).
 * - Errors: each oc-validation-summary's ul[data-test=validation-summary] once it holds words, besides the standard
 *   ones (no snapshot shows one filled).
 * - Never pressed: the posting's SmartR button, "Refer a friend", its share links and cookie settings; the one-click
 *   page's Apply with Indeed and SEEK (and the LinkedIn widget's frame), the Experience and Education "Add" buttons, the
 *   screening step's Back and every page's "Cookie Settings".
 * jr7 BOARDS-7 (FIX7PLAN §6.13; SP\jr7\audit\boards.md and boards-verify.md; the owner's snapshot7 smartrecruiter1,
 * converted as the jr7 cases of SMARTRECRUITERS_JR7_SNAPSHOTS):
 * - J7-SR-1: the entry compares the posting's company and the link's in lower case: the posting's address may spell the
 *   company otherwise than its links do (jr7-smartrecruiter1-posting: /<company in lower case>/<id>, its "I'm interested"
 *   naming /oneclick-ui/company/<Company>/...). No key changes (url.ts keeps the company as written).
 * - J7-SR-3: a screening list's id names its question's UUID and, for a question of several fields, the field
 *   (question_<question id>_gender, question_<question id>_ethnicity) or a repeated row's field
 *   (question_<question id>-0-level): its list is that field's own (publishedOptions).
 * - J7-SR-4: the page after Submit draws "Application submitted!" (successSigns), read for an armed Submit of
 *   SmartRecruiters (AUTO-7's content/submitted.ts signsOf).
 * Nothing here logs or sends a value. A page's own value is read only in the frame and only to compare it: the phone
 * select's chosen country code (shownAnswer) and the names a drop zone shows (uploadHeldNames, uploadState).
 */
import { newScanCache, type ScanCache } from '../../dom/scan-cache';
import { isUserVisible } from '../../dom/visibility';
import { genericAdapter } from '../generic';
import { successSignsOf, type SuccessRule } from '../success';
import type { Adapter, UploadState, WidgetDecl } from '../types';
import { canonicalApplicationUrl, matchesUrl, parseSmartRecruitersUrl } from './url';

/** The snapshots the hooks were written from (fixtures/smartrecruiters/). */
export const SMARTRECRUITERS_SNAPSHOTS = ['fixtures/smartrecruiters/xplor-posting.html',
  'fixtures/smartrecruiters/bertelsmann-expired.html', 'fixtures/smartrecruiters/xplor-one-click.html',
  'fixtures/smartrecruiters/xplor-screening.html'] as const;

/** jr6 (FIXPLAN §6.9, SR-8): the owner's filled pages of 2026-11-06 converted with the jr6 converter (Xplor's first
 *  page after SmartRecruiters' own résumé parse, in its manual location mode; Wiser Solutions' first page, its City
 *  results drawn open; Wiser Solutions' screening step, answered). */
export const SMARTRECRUITERS_JR6_SNAPSHOTS = ['fixtures/smartrecruiters/jr6-xplor-one-click-filled.html',
  'fixtures/smartrecruiters/jr6-wiser-one-click.html', 'fixtures/smartrecruiters/jr6-wiser-screening.html'] as const;

/** jr7 BOARDS-7 (FIX7PLAN §6.13, §11): the owner's snapshot7 application (smartrecruiter1) converted with the jr7
 *  converter: the posting at its lower-case address, the first page filled (manual location mode), the screening step
 *  answered (converted since TOOLING-7's r2: a chosen list row's marks), and the page after Submit. */
export const SMARTRECRUITERS_JR7_SNAPSHOTS = ['fixtures/smartrecruiters/jr7-smartrecruiter1-posting.html',
  'fixtures/smartrecruiters/jr7-smartrecruiter1-oneclick-filled.html',
  'fixtures/smartrecruiters/jr7-smartrecruiter1-screening-filled.html',
  'fixtures/smartrecruiters/jr7-smartrecruiter1-success.html'] as const;

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

/** jr7 BOARDS-7 (J7-SR-1): a company as compared between a posting and its one-click link, in lower case (the
 *  posting's address and its links may spell it apart: jr7-smartrecruiter1-posting; adapters/chain.ts chainFamilyOf
 *  folds it the same way). Null stays null. */
const companyOf = (board: string | null): string | null => board?.toLowerCase() ?? null;

/** "I'm interested": xplor-posting.html's <a class="button button--primary button--huge js-oneclick job-button"
 *  data-sr-track="apply" data-sr-track-position="bottom" href="https://jobs.smartrecruiters.com/oneclick-ui/company/Xplor/
 *  publication/<uuid>?dcr_ci=Xplor"> (and its "aside" copy, id="st-apply"; its "header" copy is aria-hidden), whose
 *  address is the one-click application of the posting's own company, the company compared in lower case (J7-SR-1:
 *  jr7-smartrecruiter1-posting's address writes it in lower case, its links as the company spells it). Jobright's
 *  entry (smartRecruitersEntryAdapter) compares the two exactly, so it misses that posting. */
function entryControl(doc: Document): HTMLElement | null {
  const address = addressOf(doc);
  const here = address === null ? null : parseSmartRecruitersUrl(address);
  if (here === null || here.page !== 'posting') return null;
  const links = Array.from(doc.querySelectorAll<HTMLElement>('a.js-oneclick[data-sr-track="apply"][href]')).filter((link) => {
    if (link.closest('[aria-hidden="true"]') !== null) return false;
    try {
      const target = parseSmartRecruitersUrl(new URL(link.getAttribute('href') ?? '', doc.baseURI));
      return target !== null && target.page === 'application' && companyOf(target.board) === companyOf(here.board);
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
  // jr6 (module header): a list declared on its own text box or button.
  if (control.getAttribute('role') === 'combobox') return listFor(control);
  if (control.localName !== 'spl-radio-group') return null;
  const members = Array.from(control.children).filter((child): child is HTMLElement =>
    child.localName === 'spl-radio' && child.getAttribute('role') === 'radio');
  return members.length >= 2 ? { kind: 'radio', opener: control as HTMLElement, members,
    snapshot: SMARTRECRUITERS_SNAPSHOTS[3] } : null;
}

// ── jr6 (FIXPLAN §6.9 items 1 to 3; SR-1, SR-2, SR-6): SmartRecruiters' lists ──

/** Text with its runs of white space made one space, trimmed. */
const words = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();

/** The element `id` names, looked up in `from`'s own tree, then in the tree of each host above it: an aria-controls
 *  that names a menu in an outer shadow tree (Node.getElementById reaches neither across a shadow root). Jobright
 *  resolves the City box's aria-controls the same way, walking up the shadow roots (its location operation). */
function byIdAcross(from: Element, id: string): Element | null {
  if (id === '' || /\s/.test(id)) return null;
  for (let tree: Node = from.getRootNode(); ;) {
    const found = (tree as Document | ShadowRoot).getElementById?.(id) ?? null;
    if (found !== null) return found;
    if (tree.nodeType !== 11) return null;
    tree = (tree as ShadowRoot).host.getRootNode();
  }
}

/** The menu a list's box or button names by aria-controls (module header): xplor-screening.html's <input ... role=
 *  "combobox" aria-controls="menu-question_<id>"> in spl-input's shadow root, naming <div slot="menu" id="menu-question_
 *  <id>" role="listbox"> in spl-autocomplete's; xplor-one-click.html's <button ... role="combobox" aria-controls=
 *  "spl-form-element_12-menu"> and its <div slot="menu" id="spl-form-element_12-menu" role="listbox"><slot></slot>.
 *  Null where it names no listbox. */
function menuOf(control: Element): Element | null {
  const menu = byIdAcross(control, (control.getAttribute('aria-controls') ?? '').trim());
  return menu !== null && menu.getAttribute('role') === 'listbox' ? menu : null;
}

/** The element a choice of a row clicks (module header): the row's <spl-select-option> > (shadow) <spl-dropdown-item>
 *  > (shadow) <div class=" c-spl-dropdown-item " role="option" ...> (xplor-one-click.html's 245 phone rows; Jobright
 *  clicks the same inner item in fillSelectField and fillPhoneCountryCodeField). Null where the row draws none. */
function innerItemOf(row: Element): HTMLElement | null {
  return row.shadowRoot?.querySelector('spl-dropdown-item')?.shadowRoot
    ?.querySelector<HTMLElement>('.c-spl-dropdown-item') ?? null;
}

/** A list's rows, each a <spl-select-option>; never the City's row that switches to the manual location mode. */
const ROW = 'spl-select-option';
/** The City search's row that switches to the manual location mode (jr6-wiser-one-click.html's open results:
 *  <spl-select-option value="goToManualLocationMode" ...>); Jobright never clicks it either. */
const MANUAL_MODE_ROW = 'spl-select-option[value="goToManualLocationMode"]';
/** How long the City search's list may show no row, no change, after a query, before the query is taken to have
 *  found nothing: its "No matches found" (nomatcheslabel) shows at once; Jobright waits 3 s at most for rows. No
 *  capture times SmartRecruiters' location answer: the live check of FIXPLAN §6.9 is still to be made. */
export const SMARTRECRUITERS_SEARCH_EMPTY_MS = 1_500;

/** The element whose shadow root holds `el` or, out of a shadow root, its parent element: one step up the composed
 *  tree. */
function composedParent(el: Element): Element | null {
  return el.parentElement ?? hostOf(el);
}

/** The nearest element matching `selector` at or above `el` in the composed tree, or null. */
function composedClosest(el: Element, selector: string): Element | null {
  for (let at: Element | null = el; at !== null; at = composedParent(at)) if (at.matches(selector)) return at;
  return null;
}

/** A question of sr-screening-questions-form's definition, as far as its options go: each field's own id (jr7
 *  J7-SR-3: "gender" and "ethnicity" of one question, "lang" and "level" of another). */
interface DefinedQuestion {
  id?: unknown;
  fields?: ReadonlyArray<{ id?: unknown; multipleChoice?: unknown; values?: ReadonlyArray<{ label?: unknown }> }>;
}
/** Each form's definition read once, by the attribute's text. */
const definitions = new WeakMap<Element, { text: string; questions: ReadonlyMap<string, DefinedQuestion> }>();

/** The questions a sr-screening-questions-form publishes in its definition attribute (xplor-screening.html: <sr-
 *  screening-questions-form data-test="screening-questions-form" definition="{&quot;id&quot;:...,&quot;questions
 *  &quot;:[{&quot;id&quot;:&quot;<question id>&quot;,...,&quot;fields&quot;:[{...,&quot;multipleChoice&quot;:false,
 *  ...,&quot;values&quot;:[{...,&quot;label&quot;:&quot;Your careers page&quot;,...}, ...]}]}, ...]}">), by id; empty
 *  when it holds none or no JSON. */
function definedQuestions(form: Element): ReadonlyMap<string, DefinedQuestion> {
  const text = form.getAttribute('definition') ?? '';
  const cached = definitions.get(form);
  if (cached !== undefined && cached.text === text) return cached.questions;
  const questions = new Map<string, DefinedQuestion>();
  try {
    const parsed = JSON.parse(text) as { questions?: unknown };
    for (const question of Array.isArray(parsed.questions) ? parsed.questions as DefinedQuestion[] : []) {
      if (typeof question?.id === 'string' && question.id !== '') questions.set(question.id, question);
    }
  } catch {
    // No definition the page wrote as JSON: no published list.
  }
  definitions.set(form, { text, questions });
  return questions;
}

/** jr7 BOARDS-7 (J7-SR-3; boards-verify.md's narrowed fix): a screening list's id. Its question's id is a UUID
 *  (xplor-screening.html's id="question_<question id>"), after it, for one field of a question of several, "_<field>"
 *  (jr7-smartrecruiter1's screening step: question_<question id>_gender, question_<question id>_ethnicity) or, for a
 *  field of a repeated row, "-<row>-<field>" (question_<question id>-0-level, a language's level). Anchored to the UUID,
 *  so its own hyphens never split it. Groups: 1 the question, 2 the field ("_" form), 3 the row, 4 the field (row form). */
const QUESTION_LIST_ID =
  /^question_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:_([A-Za-z]\w*)|-(\d+)-([A-Za-z]\w*))?$/i;

/** A screening question's whole list as its page publishes it (module header), every option's label in the page's
 *  order: the question its spl-autocomplete's id names (QUESTION_LIST_ID), read from the definition of the
 *  sr-screening-questions-form above it; where the id names one of its fields (jr7 J7-SR-3), that field's alone
 *  (fields[].id). 'several' for a field that takes several answers; null where the page publishes no list for it. */
function publishedOptions(autocomplete: Element): readonly string[] | 'several' | null {
  const id = QUESTION_LIST_ID.exec(autocomplete.id);
  const form = composedClosest(autocomplete, 'sr-screening-questions-form[definition]');
  if (id === null || form === null) return null;
  const named = id[2] ?? id[4];
  const all = definedQuestions(form).get(id[1]!)?.fields ?? [];
  const fields = named === undefined ? all : all.filter((field) => field.id === named);
  if (fields.some((field) => field.multipleChoice === true)) return 'several';
  const labels = fields.flatMap((field) => field.values ?? [])
    .map((value) => (typeof value?.label === 'string' ? words(value.label) : '')).filter((label) => label !== '');
  return labels.length > 0 ? labels : null;
}

/** A host's minquerylength attribute ("3" on the City search), when it asks for one character or more. */
function minQueryOf(host: Element): number | undefined {
  const value = Number.parseInt(host.getAttribute('minquerylength') ?? '', 10);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/** The results every SmartRecruiters list declares (module header): its menu, its rows, the inner item a choice
 *  clicks; the City's manual-mode row never chosen. */
function resultsOf(control: Element, search: boolean): NonNullable<WidgetDecl['results']> {
  return { list: () => menuOf(control), option: ROW, pressTarget: innerItemOf,
    ...(search ? { unchoosable: MANUAL_MODE_ROW } : {}) };
}

/** An spl-autocomplete's declaration, from its own text box (module header): xplor-screening.html's <spl-autocomplete
 *  data-spl-field required id="question_<id>" ... minquerylength="0" nomatcheslabel="No matches"> > (shadow) ...
 *  <spl-input ... ariacontrols="menu-question_<id>"> > (shadow) ... <input ... role="combobox" aria-controls=
 *  "menu-question_<id>" aria-autocomplete="list" aria-expanded="false">; xplor-one-click.html's City, <spl-autocomplete
 *  minquerylength="3" data-test="location-autocomplete" data-sr-id="location-autocomplete-search" ... label="City"
 *  nomatcheslabel="No matches found">; jr6-xplor-one-click-filled.html's <spl-autocomplete ... formcontrolname="country"
 *  data-test="manual-location-country" data-sr-id="location-autocomplete-country" ... minquerylength="0"
 *  label="Country/Region">. */
function autocompleteFor(box: HTMLElement, autocomplete: Element): WidgetDecl | null {
  const min = minQueryOf(autocomplete);
  const base = { opener: box, ...(min !== undefined ? { minQueryLength: min } : {}) };
  const place = autocomplete.getAttribute('data-sr-id');
  if (place === 'location-autocomplete-search') {
    // SR-2: the City search, its rows found by the typed query (FIXPLAN §6.9 item 2: no expanded).
    return { kind: 'typeahead-remote', ...base, results: resultsOf(box, true),
      emptyAfterMs: SMARTRECRUITERS_SEARCH_EMPTY_MS, snapshot: SMARTRECRUITERS_SNAPSHOTS[2] };
  }
  if (place === 'location-autocomplete-country') {
    // SR-2 with SR-10: the manual location mode's Country/Region, read by opening it.
    return { kind: 'combobox', ...base, expanded: box, results: resultsOf(box, false),
      snapshot: SMARTRECRUITERS_JR6_SNAPSHOTS[0] };
  }
  const published = publishedOptions(autocomplete);
  if (published === null || published === 'several') return null;
  // SR-1: a screening question, its whole list published by the page.
  return { kind: 'combobox', ...base, expanded: box, knownOptions: published, results: resultsOf(box, false),
    snapshot: SMARTRECRUITERS_SNAPSHOTS[3] };
}

/** The phone's country select's own value, its country's ISO code ("US"): the element's property, else its reflected
 *  attribute; '' while it holds none. */
function selectValueOf(select: Element): string {
  const own = (select as { value?: unknown }).value;
  return words(typeof own === 'string' && own !== '' ? own : select.getAttribute('value'));
}

/** The rows of the phone's country select (module header): its own <spl-select-option> children, slotted into its
 *  menu's default <slot>. */
function slottedRows(menu: Element): readonly Element[] {
  const slot = menu.querySelector('slot:not([name])') as HTMLSlotElement | null;
  return (slot?.assignedElements({ flatten: true }) ?? []).filter((el) => el.localName === ROW);
}

/** The phone's country select's declaration, from its own button (module header): xplor-one-click.html's <spl-select
 *  class="c-spl-phone-field-select" maxheight="300" ... id="spl-form-element_12" value="" splarialabel="Country code">
 *  (inside spl-phone-field's shadow root) > (shadow) ... <spl-dropdown class=" c-spl-select "> <button class=
 *  "c-spl-select-field" slot="trigger" role="combobox" aria-haspopup="listbox" aria-label="Country code" ...
 *  aria-expanded="false" aria-controls="spl-form-element_12-menu"> ... <div slot="menu" id="spl-form-element_12-menu"
 *  role="listbox" ...><slot></slot></div>, its rows its own 245 children <spl-select-option class="c-spl-phone-field-
 *  select-option" value="US" label="United States"> ... <span class="c-spl-phone-field-select-option-container-
 *  country">United States</span> <span ...-container-code>+1</span>. The row shown chosen is the one whose value is the
 *  select's (Jobright polls the select's value against the option's after its click). */
function phoneCountryFor(button: HTMLElement, select: Element): WidgetDecl {
  return { kind: 'combobox', opener: button, expanded: button, drawnWhole: true,
    results: { list: () => menuOf(button), option: ROW, options: slottedRows, pressTarget: innerItemOf },
    shownAnswer: (known) => {
      const value = selectValueOf(select);
      const row = value === '' ? undefined : Array.from(select.children)
        .find((child) => child.localName === ROW && child.getAttribute('value') === value);
      const shown = words(row?.textContent);
      if (shown === '') return null;
      const flat = shown.replace(/\s/g, '');
      return known.find((label) => label.replace(/\s/g, '') === flat) ?? shown;
    },
    snapshot: SMARTRECRUITERS_SNAPSHOTS[2] };
}

/** The phone's country select a button opens (module header), or null for any other button. */
function phoneSelectOf(control: Element): Element | null {
  const select = hostOf(control);
  return control.localName === 'button' && select?.localName === 'spl-select'
    && select.classList.contains('c-spl-phone-field-select') && hostOf(select)?.localName === 'spl-phone-field'
    ? select : null;
}

/** A SmartRecruiters list's declaration (module header), from its text box or button; null for any other control. */
function listFor(control: Element): WidgetDecl | null {
  const select = phoneSelectOf(control);
  if (select !== null) return phoneCountryFor(control as HTMLElement, select);
  // An spl-autocomplete's text box: in spl-input's shadow root, that spl-input in the autocomplete's.
  if (control.localName !== 'input') return null;
  const input = hostOf(control);
  const autocomplete = input?.localName === 'spl-input' ? hostOf(input) : null;
  return autocomplete?.localName === 'spl-autocomplete' ? autocompleteFor(control as HTMLElement, autocomplete) : null;
}
// ── end jr6 lists ──

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
  // jr6 SR-6: the phone's country select's button, in spl-select's shadow root inside spl-phone-field's, labelled by the
  // phone's own label (labelSuffix adds "country code"): its aria-label "Country code" shows only as a hover tooltip.
  const phoneSelect = phoneSelectOf(control);
  if (phoneSelect !== null) return hostOf(phoneSelect)?.shadowRoot?.querySelector('label[slot="label"]') ?? null;
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

/** jr6 SR-6: the words after the phone's label for its country select ("Phone number country code"), which the label
 *  rules read as the phone's country code; null for any other control. */
function labelSuffix(control: Element): string | null {
  return phoneSelectOf(control) !== null ? 'country code' : null;
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

// ── jr6 SR-11 (FIXPLAN §6.9 item 5): a file a drop zone shows ──
/** The drop zone a file input sits in, where it shows its file list (module header): the input's host, an spl-dropzone
 *  without hidefilelist (the Easy Apply drop zone hides its list); null for any other input. */
function listingZoneOf(input: HTMLInputElement): Element | null {
  const zone = hostOf(input);
  return input.type === 'file' && zone?.localName === 'spl-dropzone' && !zone.hasAttribute('hidefilelist') ? zone : null;
}

/** The names a drop zone's file list shows (jr6-wiser-one-click.html and jr6-xplor-one-click-filled.html: <spl-dropzone
 *  data-test="resume-upload" ...> > (shadow) <ul class="c-spl-file-list"><li class="c-spl-file-list-item"> ... <span
 *  class="c-spl-file-list-item-name">NAME</span> ... a "Delete file NAME" button), each as a person reads it; none on
 *  a blank page (xplor-one-click.html: an empty ul.c-spl-file-list). */
function shownFileNames(zone: Element): string[] {
  return Array.from(zone.shadowRoot?.querySelectorAll('ul.c-spl-file-list > li.c-spl-file-list-item') ?? [])
    .map((row) => words(row.querySelector('.c-spl-file-list-item-name')?.textContent));
}

/** The drop zone shows a file in its list (module header), whatever its name: the field holds a file. */
function uploadHeld(input: HTMLInputElement): boolean {
  const zone = listingZoneOf(input);
  return zone !== null && shownFileNames(zone).length > 0;
}

/** The names of the files the drop zone shows (module header), the ones it shows with a name. */
function uploadHeldNames(input: HTMLInputElement): string[] {
  const zone = listingZoneOf(input);
  return zone === null ? [] : shownFileNames(zone).filter((name) => name !== '');
}

/** A file the run put into a drop zone's input (module header): uploaded ('confirmed') once a row of its list names it;
 *  'pending' until then; null for an input of no listing drop zone (its own files decide). */
function uploadState(input: HTMLInputElement, fileName: string): UploadState | null {
  const zone = listingZoneOf(input);
  if (zone === null) return null;
  const wanted = words(fileName);
  return wanted !== '' && shownFileNames(zone).includes(wanted) ? 'confirmed' : 'pending';
}
// ── end jr6 SR-11 ──

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

// ── jr7 BOARDS-7 (J7-SR-4; FIX7PLAN §5 D-1 item 2, raised to high by boards-verify.md) ──
/** The page after Submit (jr7-smartrecruiter1-success.html, …/publication/<uuid>/success): <oc-success-page> › <div
 *  data-test="success-page"> › <h2 data-test="success-page-confirmation">Application submitted!</h2>, in the document's
 *  own tree (no shadow root). The selector is Jobright's fact (its ats-submission-rules, the rule
 *  'smartrecruiters-application-success', read as its behaviour, never its code), shown and with words, whatever
 *  they say. */
export const SMARTRECRUITERS_SUCCESS: SuccessRule = {
  css: 'oc-success-page [data-test="success-page"] h2[data-test="success-page-confirmation"]',
  from: "jr7-smartrecruiter1-success; Jobright 1.25.2 ats-submission-rules 'smartrecruiters-application-success'",
};

/** The drawn sign of the application armed under `armedKey` (Adapter.successSigns), read only after an armed Submit
 *  (AUTO-7: content/submitted.ts signsOf, newSuccessSign). The page shows one application's confirmation and names no
 *  posting, so it is read for an arm of SmartRecruiters' alone: the chained run's arm carries the posting's key
 *  (FIX7PLAN §5 D-1), and its watch, in the same document the app routes to /success, reports under that key. */
function successSigns(doc: Document, armedKey: string): Element[] {
  return armedKey.startsWith('smartrecruiters:') ? successSignsOf(doc, [SMARTRECRUITERS_SUCCESS]) : [];
}
// ── end jr7 BOARDS-7 ──

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
  // jr6 SR-6: "country code" after the phone's label, for its country select.
  labelSuffix,
  // The core pass of 2026-11-06: a screening Yes/No question's fieldset says it is required.
  requiredFor,
  uploadWidgets,
  // jr6 SR-11: the file a drop zone shows.
  uploadHeld,
  uploadHeldNames,
  uploadState,
  nextButton,
  submitButton,
  isFinalStep,
  stepSignature,
  errors,
  neverPress,
  // jr7 BOARDS-7 (J7-SR-4): "Application submitted!" after an armed Submit.
  successSigns,
  // jr6 C3 (module header): the one-click form is drawn late by the page's own app.
  quirks: { formLateMs: SMARTRECRUITERS_FORM_LATE_MS },
};
