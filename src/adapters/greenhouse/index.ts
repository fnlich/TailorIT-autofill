/*
 * The Greenhouse adapter (docs/design/runtime.md §9; docs/ARCHITECTURE.md "Adapters"): the quirks of
 * job-boards.greenhouse.io's application form, on a job page (/<board>/jobs/<id>) and in the embed (/embed/job_app),
 * which show the same markup. Every hook was read from the owner's four snapshots, fixtures/greenhouse/gitlab-job.html,
 * discord-job.html, figma-legacy-host.html and gitlab-embed.html (captured 2026-10-29), and names the markup it relies
 * on. Legacy boards.greenhouse.io addresses redirect to job-boards (the figma capture), so this is the only form markup.
 * - Form root: form#application-form.application--form.
 * - Sections: the question blocks, named by the "Apply for this job" heading that stands above the form (outside it,
 *   where the scanner's own heading rule cannot see it); the EEOC block and a company's own demographic block, each by
 *   its heading.
 * - Upload groups (Resume/CV, Cover Letter): the file input and its label[for] ("Attach") are visually hidden. The
 *   visible Attach button beside them is the input's upload widget, and the group's div#upload-label-* its label.
 * - Widgets (widgetFor), from the capture of six live forms on 2026-11-01 (docs/FIXTURES.md, "The Greenhouse widget
 *   capture"; its closed forms are fixtures/greenhouse/twitch-job.html, discord-ml-job.html, gusto-job.html,
 *   twilio-job.html, affirm-job.html and asana-embed.html). Every "Select..." is react-select v5 inside a wrapper of
 *   Greenhouse's that holds whether its menu is open: the wrapper's onMouseUp toggles it, react-select's onBlur and a
 *   choice close it, and react-select's own opening on a mousedown, a focus or typing is ignored. So each
 *   input.select__input[role=combobox] inside a .select__container's .select-shell is declared with its input as the
 *   opener, one bubbling mouseup as its activation (a click() opens nothing, a second mouseup closes it), its
 *   aria-expanded as whether it is open, its .select__control as the box a person sees (react-select draws the input
 *   transparent while it shows an answer, and an empty one as wide as a space of the page's font: 3.97 px on the live
 *   BeyondTrust form, fixtures/greenhouse/beyondtrust-job.html, whose web font is Roboto), "Loading..."
 *   (.select__menu-notice--loading) and the loading dots (.select__loading-indicator) as its busy signs, and its
 *   .select__single-value as its answer (the phone country's by its flag: it shows "+1" for the option "Canada +1").
 *   Its input filters the list as typed (aria-autocomplete="list"; react-select's own filter, by substring), so a long
 *   list, the phone country's 244 countries or a country question's, has its planned option searched for by the
 *   option's words ("Canada"), then clicked (dom/widgets' searchesList), never scrolled to.
 *   Location (#candidate-location) and School (#school--N) are remote searches (Location's list shows only the
 *   results whose label holds the typed text: the BeyondTrust form); a container marked
 *   select__value-container--is-multi is a multiselect; every other one is a combobox (Yes/No, EEOC and demographic
 *   questions, months, Degree, Discipline, the phone country). react-select's required shim (an aria-hidden input with
 *   no id) and intl-tel-input's hidden country search are no fields: neither is declared, and neither is visible.
 * - Buttons never pressed (neverPress, all type="button", so assertNotSubmit alone would allow them): the header's
 *   "Autofill my application", "Locate me", each upload group's Dropbox, Google Drive and "Enter manually", a chosen
 *   select's "Clear selections" and a chip's remove button.
 * - Submit: the button in .application--submit, identified so it is never clicked. The form is a single step, so a
 *   page showing the form and its Submit is the final step.
 * - Errors: the standard aria-invalid="true", which every control in the snapshots carries (as "false"). No snapshot
 *   shows Greenhouse's error text, so none is read.
 * No proxyFor: the native checkboxes (discord-job.html's consent, the checkbox questions of twitch-job.html and
 * gusto-job.html) are drawn visible (appearance: none with a border) beside their label[for], and a click() on the box
 * ticks it as React sees it (setting .checked does not).
 */
import { dialCodeOf } from '../../core/matcher/dialCode';
import { newScanCache } from '../../dom/scan-cache';
import { TEXT_CAP_LABEL } from '../../dom/thresholds';
import { visibleText } from '../../dom/visible-text';
import { genericAdapter } from '../generic';
import type { Adapter, WidgetDecl } from '../types';
import { canonicalApplicationUrl, matchesUrl } from './url';

/** The snapshots the Greenhouse hooks were read from. */
export const GREENHOUSE_SNAPSHOTS = ['fixtures/greenhouse/gitlab-job.html', 'fixtures/greenhouse/discord-job.html',
  'fixtures/greenhouse/figma-legacy-host.html', 'fixtures/greenhouse/gitlab-embed.html'] as const;

/** The closed forms of the widget capture (2026-11-01), which the widget hooks name. */
export const GREENHOUSE_WIDGET_SNAPSHOTS = ['fixtures/greenhouse/twitch-job.html', 'fixtures/greenhouse/discord-ml-job.html',
  'fixtures/greenhouse/gusto-job.html', 'fixtures/greenhouse/twilio-job.html', 'fixtures/greenhouse/affirm-job.html',
  'fixtures/greenhouse/asana-embed.html'] as const;

/** The one activation event Greenhouse's react-selects answer, which its widgets declare: a bubbling mouseup. */
export const GREENHOUSE_ACTIVATION = ['mouseup'] as const;

/** Greenhouse's application form in a document, or null when the document shows none. */
function formOf(doc: Document): Element | null {
  // fixtures/greenhouse/*.html: <form method="post" id="application-form" class="application--form">
  return doc.querySelector('form#application-form.application--form');
}

/** The form's parts and their headings. */
function sections(root: Element): Array<{ el: Element; label: string; kind?: 'education' }> {
  const cache = newScanCache();
  const found: Array<{ el: Element; label: string; kind?: 'education' }> = [];
  const named = (el: Element, heading: Element | null | undefined, kind?: 'education') => {
    const label = heading ? visibleText(heading, { singleLine: true, cache }) : '';
    if (label !== '') found.push({ el, label, ...(kind ? { kind } : {}) });
  };
  // fixtures/greenhouse/*.html: <div class="application--container"><div class="application--header"> ... <div
  // class="application--header--title"><h2 class="section-header font-primary">Apply for this job</h2> ... </div><form
  // id="application-form"> ... <div class="application--questions"> (two blocks: the standard questions with the
  // uploads, then the board's own questions).
  const title = root.closest('.application--container')?.querySelector('.application--header--title .section-header');
  for (const block of Array.from(root.querySelectorAll('div.application--questions'))) named(block, title);
  // twitch-job.html (and the widget capture's other forms with an education block): <div class="education--container">
  // <div class="education--form"><hr><div class="education--header"><p class="body body--medium">Education</p></div>
  // ... School, Degree, Discipline and the dates.
  for (const block of Array.from(root.querySelectorAll('div.education--container'))) {
    named(block, block.querySelector('.education--header'), 'education');
  }
  // fixtures/greenhouse/*.html: <div class="eeoc__container body"> ... <h2 class="section-header font-primary">
  // Voluntary Self-Identification</h2>; discord-job.html: <div id="demographic-section" class="demographic--container">
  // <h3 class="section-header font-primary">Voluntary Self Identification</h3>. A company's own text in the block may
  // hold a nearer heading above the questions (twilio-job.html: <h3 class="section-header ...">Updated - Twilio is proud
  // to be an Equal Employment Opportunity employer</h3>, then in the text <h3>...Voluntary Self-Identification of Race
  // &amp; Ethnicity and Protected Veterans Status...</h3>): the block is named by the last heading before its first
  // question.
  for (const block of Array.from(root.querySelectorAll('div.eeoc__container, div.demographic--container'))) {
    named(block, nearestHeading(block, cache) ?? block.querySelector('.section-header'));
  }
  return found;
}

/** The last heading in a block that shows text and stands before the block's first control. */
function nearestHeading(block: Element, cache: ReturnType<typeof newScanCache>): Element | null {
  const first = block.querySelector('input, select, textarea');
  const before = Array.from(block.querySelectorAll('h1, h2, h3, h4, h5, h6, .section-header')).filter((heading) =>
    first === null || (heading.compareDocumentPosition(first) & FOLLOWING) !== 0);
  return before.reverse().find((heading) => visibleText(heading, { singleLine: true, cache }) !== '') ?? null;
}

/** Node.DOCUMENT_POSITION_FOLLOWING, without reaching for a page global. */
const FOLLOWING = 4;

/** An upload group's visible label for its file input. */
function labelFor(control: Element): Element | null {
  if (control.localName !== 'input' || (control as HTMLInputElement).type !== 'file') return null;
  // fixtures/greenhouse/*.html: <div class="file-upload" role="group" aria-labelledby="upload-label-resume"
  // aria-required="true"><div id="upload-label-resume" class="label upload-label">Resume/CV<span
  // class="required">*</span></div> ... <input id="resume" class="visually-hidden" type="file"> ... </div>
  const group = control.closest('div.file-upload[role="group"]');
  const id = (group?.getAttribute('aria-labelledby') ?? '').trim();
  if (group === null || id === '' || /\s/.test(id)) return null;
  const label = control.ownerDocument.getElementById(id);
  return label !== null && group.contains(label) ? label : null;
}

/** Each upload group's file input and the visible Attach button beside it. */
function uploadWidgets(root: Element): Array<{ control: Element; input: HTMLInputElement }> {
  // fixtures/greenhouse/*.html: <div class="secondary-button"><div><button class="btn btn--pill" type="button">Attach
  // </button><label class="visually-hidden" for="resume">Attach</label><input id="resume" class="visually-hidden"
  // type="file" accept=".pdf,.doc,.docx,.txt,.rtf"></div></div> (discord-job.html's button is btn--rounded, so the
  // button is found beside the input, not by its class).
  return Array.from(root.querySelectorAll<HTMLInputElement>('div.file-upload input[type="file"]')).flatMap((input) => {
    const control = Array.from(input.parentElement?.children ?? [])
      .find((el) => el.localName === 'button' && (el as HTMLButtonElement).type === 'button');
    return control === undefined ? [] : [{ control, input }];
  });
}

/** The react-select searches: Location and each School (the capture's ids). */
const SEARCH_ID = /^(?:candidate-location|school--\d+)$/;

/** react-select's busy signs while an async list loads (the capture's school-loading state). */
const BUSY_SIGNS = ['.select__menu-notice--loading', '.select__loading-indicator'] as const;

/**
 * A react-select's input, declared as its widget (see the header), or null for any other control.
 * The capture (twitch-job.html, every form): <div class="select"><div class="select__container"><label
 * id="{id}-label" for="{id}" class="label select__label">...</label><div class="select-shell ..."><span ...
 * class="...-a11yText"></span>...<div><div class="select__control ..."><div class="select__value-container ...">
 * <div class="select__placeholder ...">Select...</div><div class="select__input-container ..." data-value=""><input
 * class="select__input" id="{id}" type="text" aria-autocomplete="list" aria-expanded="false" aria-haspopup="true"
 * aria-labelledby="{id}-label" role="combobox" ...></div></div><div class="select__indicators ..."><button
 * type="button" class="icon-button icon-button--sm" aria-label="Toggle flyout" tabindex="-1">...</button></div></div>
 * </div><input required="" tabindex="-1" aria-hidden="true" class="...-requiredInput" value=""></div></div></div>.
 * Open (twitch.yesno-open): the input says aria-expanded="true" and aria-controls="react-select-{id}-listbox", and
 * <div class="select__menu ..."><div class="select__menu-list ..." role="listbox" aria-multiselectable="false"
 * id="react-select-{id}-listbox"><div class="select__option ..." role="option" aria-selected="false"
 * aria-disabled="false" id="react-select-{id}-option-0">Yes</div>... is drawn inside the .select-shell. A multi-select
 * (twitch.multi-open-after-two-chips): <div class="select__value-container select__value-container--is-multi ...">.
 */
function widgetFor(control: Element): WidgetDecl | null {
  if (control.localName !== 'input' || !control.matches('input.select__input[role="combobox" i]')) return null;
  const shell = control.closest('.select-shell');
  const box = control.closest('.select__control');
  if (shell === null || box === null || !shell.contains(box) || shell.parentElement?.matches('.select__container') !== true) {
    return null;
  }
  const kind = SEARCH_ID.test(control.id) ? 'typeahead-remote'
    : control.closest('.select__value-container--is-multi') !== null ? 'multiselect' : 'combobox';
  return { kind, opener: control as HTMLElement, activation: [...GREENHOUSE_ACTIVATION], expanded: control, box,
    busy: BUSY_SIGNS, shownAnswer: answerOf(box, control), snapshot: GREENHOUSE_WIDGET_SNAPSHOTS[0] };
}

/** What a react-select shows chosen, beside its emptied input (twitch.yesno-chosen: <div class="select__value-container
 *  select__value-container--has-value ..."><div class="select__single-value ...">No</div>), or null when it shows
 *  none. The phone country's is read by its flag (phoneCountry). */
function answerOf(box: Element, control: Element): (known: readonly string[]) => string | null {
  const phone = control.id === 'country' && control.closest('fieldset.phone-input') !== null;
  return (known) => {
    const shown = box.querySelector('.select__single-value');
    if (shown === null) return null;
    const text = visibleText(shown, { singleLine: true, cap: TEXT_CAP_LABEL });
    if (phone) return phoneCountry(shown, text, known);
    return text === '' ? null : text;
  };
}

/** A country's name as compared: accents, case, curly apostrophes and "&" folded. */
const countryName = (text: string) => text.normalize('NFKD').replace(/\p{M}+/gu, '').replace(/[\u2018\u2019]/g, "'")
  .replace(/&/g, ' and ').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The phone country a react-select shows: twitch.phone-country-chosen shows <div class="select__single-value ..."><div
 * class="iti__flag iti__ca"></div><span>+1</span></div> for the option "Canada +1" (each option carries the same flag:
 * <div class="iti__flag iti__us"></div>United States +1). The flag's region is named in English (Intl.DisplayNames)
 * with the dial code shown, and that is the known option of the same name and code. A name the options spell otherwise
 * (the capture's "Turkey +90", which the browser names "Türkiye") is the one known option that shows that dial code,
 * when no other does; else it reads back as a label no option has, never as another option. So a country the phone
 * number picked by itself (intl-tel-input reads "+1 512 ..." as the United States') reads back as that country, by
 * its flag, never as another country of its dial code: "+1" alone names none of the 25 that share it.
 */
function phoneCountry(shown: Element, dial: string, known: readonly string[]): string | null {
  if (dial === '') return null;
  const flag = shown.querySelector('.iti__flag');
  const region = Array.from(flag?.classList ?? []).map((name) => /^iti__([a-z]{2})$/.exec(name)?.[1])
    .find((code): code is string => code !== undefined);
  if (region === undefined) return dial;
  let name: string | undefined;
  try {
    name = new Intl.DisplayNames(['en'], { type: 'region' }).of(region.toUpperCase());
  } catch {
    name = undefined;
  }
  if (name === undefined || name.toUpperCase() === region.toUpperCase()) return dial;
  const wanted = `${name} ${dial}`;
  const named = known.find((label) => countryName(label) === countryName(wanted));
  if (named !== undefined) return named;
  const code = dialCodeOf(dial);
  const sharing = code === null ? [] : [...new Set(known.filter((label) => dialCodeOf(label) === code))];
  return sharing.length === 1 ? sharing[0]! : wanted;
}

/** The never-pressed buttons' own words, for those the capture marks no other way (Google Drive). */
const NEVER_PRESS_WORDS = /^(?:dropbox|google drive|enter manually|locate me)$/i;

/** The buttons never pressed (see the header), found in the form's container (the header's Autofill button sits above
 *  the form). */
function neverPress(root: Element): Element[] {
  const scope = root.closest('.application--container') ?? root;
  // The capture (every form): <div class="application--header--autofill-with-greenhouse"><div class="autofill_button
  // ..."><button type="button" class="btn btn--rounded" ...>...Autofill my application</button>; beside Location,
  // <button type="button" class="btn--tertiary">Locate me</button>; in each upload group, <button type="button"
  // class="btn btn--rounded" data-testid="resume-dropbox">Dropbox</button>, <button ...>Google Drive</button> and
  // <button ... data-testid="resume-text">Enter manually</button>; twitch.yesno-chosen: <button type="button"
  // class="icon-button icon-button--sm" aria-label="Clear selections" data-testid="clear-selection">;
  // twitch.multi-open-after-two-chips: <div role="button" class="select__multi-value__remove ..." aria-label="Remove
  // Canada"><button type="button" ... aria-label="Remove selection">.
  const marked = Array.from(scope.querySelectorAll(['.application--header--autofill-with-greenhouse button',
    '.autofill_button button', '.field-wrapper > button.btn--tertiary', '.file-upload button[data-testid$="-dropbox"]',
    '.file-upload button[data-testid$="-text"]', 'button[data-testid="clear-selection"]',
    '.select__indicators button[aria-label="Clear selections" i]', '.select__multi-value__remove'].join(', ')));
  const named = Array.from(scope.querySelectorAll('.file-upload button, .field-wrapper > button'))
    .filter((button) => NEVER_PRESS_WORDS.test((button.textContent ?? '').replace(/\s+/g, ' ').trim()));
  return [...new Set([...marked, ...named])].sort((a, b) => ((a.compareDocumentPosition(b) & FOLLOWING) !== 0 ? -1 : 1));
}

/** The Submit button: identified so it is never clicked. */
function submitButton(root: Element): HTMLElement | null {
  // fixtures/greenhouse/*.html: <div class="application--submit"><button class="btn btn--pill" type="submit">Submit
  // application</button></div> (btn--rounded in discord-job.html)
  return root.querySelector<HTMLElement>('.application--submit button[type="submit"]');
}

/** One step: the page is the final step when it shows the form and its Submit button. */
function isFinalStep(doc: Document): 'final' | 'unknown' {
  const root = formOf(doc);
  return root !== null && submitButton(root) !== null ? 'final' : 'unknown';
}

/** The Greenhouse adapter. */
export const greenhouseAdapter: Adapter = {
  id: 'greenhouse',
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
  neverPress,
  isFinalStep,
  // fixtures/greenhouse/*.html: every input carries aria-invalid="false" and aria-describedby="<id>-error ...".
  errors: (root) => genericAdapter.errors?.(root) ?? [],
};
