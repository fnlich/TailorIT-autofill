/*
 * The UltiPro (UKG Pro Recruiting) adapter (DESIGN-NEW-ATS §1 "UltiPro", §5 builder A): a full adapter over the
 * configured layer's hooks (configuredHooks), read from the owner's three snapshots of 2026-11-06, converted as
 * fixtures/ultipro/*.html: ultipro-2 register.html (the account step), ultipro-1 resume-review.html (the application's
 * résumé pre-fill review) and ultipro-0 application.html (the same page and load once the review was saved: the whole
 * one-page application). Every rule names the snapshot it was read from.
 * - Page states (ULTIPRO_CONFIG.states):
 *   - register (body.authcode-controller with form#registrationDetailsForm, ultipro-2): first name, last name and
 *     phone, filled from the profile like a step; its labels are the ukg-label elements each input's aria-labelledby
 *     names (light text, a shadow star). Create account (the ukg-button[form=registrationDetailsForm] outside the
 *     form, behind Cloudflare Turnstile) is never pressed by a run's Next or Submit: the step is final 'unknown'. It
 *     follows Sign-in mode (the snapshot build of 2026-11-06, core pass Z1 item 24: registerContainer): the form is the
 *     state's declared sign-in container, Create account its button, so Sign-in Auto presses it once the step is filled
 *     and rests, through its door and every guard (Sign-in Auto types nothing: the form holds no email or password);
 *     Manual leaves it to the person.
 *   - review (div[data-bind="if: isParsingResume()"] holding [data-automation=contact-information-section], ultipro-1):
 *     the parsed contact information, work experience, education and skills, filled like a step; its Next is
 *     "Save and continue" (the review's own button.btn-primary[data-automation=save-button]), its Cancel never pressed.
 *     While it shows, the application below is display: none and every contact id is there twice: the state's root is
 *     the review alone.
 *   - otherwise the application, its root #OpportunityApply (ultipro-0): one page, no steps, final when Submit shows.
 *     Submit is the ukg-button[data-automation=btn-submit] host, whose Knockout click binding (click: save) sits on the
 *     host, its native button in its shadow root; identified so the fill never presses it.
 * - Sections: each panel, div[role=region] with its h2 (Contact Information, Work Experience, Education, Skills,
 *   Behaviors, Motivations, Licenses and Certifications, Links, Documents, Questions).
 * - Required: label.control-label.required (the star is drawn by CSS): select#Country carries no required attribute
 *   (ultipro-0, -1).
 * - The start date (ultipro-0): its month, day and year boxes sit in ukg-date-input-text's open shadow root, labelled
 *   only "Month", " Day" and "Year" there; their question is the light label[data-automation=start-date-label] "When
 *   can you start? (MM/DD/YYYY)" in the same form group, whose for= names nothing (labelFor, with "month", "day" and
 *   "year" after it: labelSuffix).
 * - Read-only account names (#FirstName, #FamilyName, #FormerName, #PreferredName in the application) are read-only to
 *   the scanner by their own attribute.
 * - Never pressed: Cancel (the application's, to the posting; the review's; a panel editor's), Sign Out, a panel's
 *   Remove, a document's delete link, the résumé parser (its upload and its choice of a saved résumé), the navigation's
 *   menus and Sign In, the accessibility banner's links and the EEOC definition link.
 * Turnstile (the account step and the application, ultipro-0 to -2) is drawn in a closed shadow root: the extension
 * cannot read it (dom/pause-detect.ts's known limit), and Submit and Create account are the page's to enable.
 * Nothing here reads, logs or sends a value.
 */
import { newScanCache } from '../../dom/scan-cache';
import { TEXT_CAP_LABEL } from '../../dom/thresholds';
import { visibleText } from '../../dom/visible-text';
import { isUserVisible } from '../../dom/visibility';
import { configuredHooks } from '../configured';
import type { AtsConfig } from '../configured/types';
import type { Adapter, SignInForm } from '../types';
import { canonicalApplicationUrl, matchesUrl, parseUltiproUrl } from './url';

/** The fixtures the adapter was read from (fixtures/ultipro/<case>.html). */
export const ULTIPRO_SNAPSHOTS = ['fixtures/ultipro/register.html', 'fixtures/ultipro/resume-review.html',
  'fixtures/ultipro/application.html'] as const;

/** The résumé review's container (ultipro-1: <div data-bind="if: isParsingResume()"><div data-bind="with:
 *  contactInfoViewModel" data-automation="contact-information-section"> ...; empty in ultipro-0). */
const REVIEW = 'div[data-bind="if: isParsingResume()"]';

/** The rules the configured layer builds hooks from, each naming its snapshot. */
export const ULTIPRO_CONFIG: AtsConfig = {
  platform: 'ultipro',
  snapshots: ['register', 'resume-review', 'application'],
  parse: parseUltiproUrl,
  matchesUrl,
  states: [
    // ultipro-2: <body class="authcode-controller candidate-layout white-background"> ... <form method="post"
    // id="registrationDetailsForm" ...> with three <ukg-field>s.
    { name: 'register', when: 'body.authcode-controller form#registrationDetailsForm',
      root: 'body.authcode-controller form#registrationDetailsForm', from: 'ultipro-2' },
    // ultipro-1: the review, its Contact Information first.
    { name: 'review', when: `#OpportunityApply ${REVIEW} [data-automation="contact-information-section"]`,
      root: `#OpportunityApply ${REVIEW}`,
      // ultipro-1: <div class="actions"><button data-bind="click: save, ..." class="btn btn-primary"
      // data-automation="save-button">Save and continue</button><button ... type="button" class="btn btn-link"
      // data-automation="cancel-button">Cancel</button></div>.
      next: `#OpportunityApply ${REVIEW} .actions > button.btn-primary[data-automation="save-button"]`, from: 'ultipro-1' },
  ],
  // ultipro-0: <div id="OpportunityApply" ...> holding every panel and <ukg-button data-automation="btn-submit" ...>.
  root: { css: '#OpportunityApply', holds: 'ukg-button[data-automation="btn-submit"]', from: 'ultipro-0' },
  // ultipro-0, -1: <label for="FirstName" class="control-label required" ...>; <label for="Country" class="control-label
  // required" ...> over <select ... id="Country"> with no required attribute.
  required: [{ is: 'label.control-label.required', from: 'ultipro-0, ultipro-1' }],
  sections: [
    // ultipro-0: <div role="region" ... class="panel panel-transparent" aria-label="Contact Information"> ... <h2
    // class="collapsible-panel-title" data-automation="panel-title" ...>Contact Information</h2>; <div role="region"
    // id="AppDocuments" data-automation="application-documents" ...> ... <h2>Documents</h2>; <div role="region"
    // data-automation="questions-panel" ...> ... <h2 class="clickable-header">Questions</h2>.
    { container: '#OpportunityApply div[role="region" i]', heading: 'h2', from: 'ultipro-0, ultipro-1' },
  ],
  // ultipro-0: <ukg-button data-automation="btn-submit" data-bind="text: submitButtonText, click: save, ...">Submit
  // </ukg-button>, its shadow root's <button aria-label="Submit" class="ukg-button-native" ... type="button">.
  submit: { css: '#OpportunityApply ukg-button[data-automation="btn-submit"]', from: 'ultipro-0' },
  neverPress: [
    // ultipro-0: <a class="btn btn-link" data-automation="btn-cancel" href=".../OpportunityDetail?...">Cancel</a>;
    // ultipro-1: the review's Cancel; every panel editor's Cancel.
    { css: 'a[data-automation="btn-cancel"], button[data-automation="cancel-button"]', from: 'ultipro-0, ultipro-1' },
    // ultipro-0: <button type="button" class="btn-link p-0" data-automation="application-incorrect-name-text-signout-link">.
    { css: '[data-automation="application-incorrect-name-text-signout-link"]', from: 'ultipro-0' },
    // ultipro-0, -1: a skill's <button ... data-automation="remove-button" aria-label="Remove ...">, a review item's
    // "Delete Work Experience <N>"; a document's <a ... data-automation="delete-file-link" role="button" ...>.
    { css: 'button[data-automation="remove-button"], a[data-automation="delete-file-link"]', from: 'ultipro-0, ultipro-1' },
    // The résumé parser (ultipro-0, -1, hidden in both): <div id="ResumeParsingUploader"
    // data-automation="resumeparsinguploader-container"> holds its upload (<upload-button params="... uploadUrl:
    // '.../Documents/UploadResume?...'"><form ...><input type="file" ...><label role="button" ...
    // data-automation="upload-file-btn" ...>) and <select data-automation="existing-resume-selector">, and also the
    // review the parse leads to (ultipro-1), so its upload and its choice alone are never pressed, not the container.
    { css: '#ResumeParsingUploader upload-button, [data-automation="existing-resume-selector"]', from: 'ultipro-0, ultipro-1' },
    // The navigation (ultipro-0 to -2) and the accessibility banner.
    { css: '#OpportunitiesMenuButton, #CandidatePresenceMenuButton, #profile-button-menu, #language-picker-link, #SignInButton',
      from: 'ultipro-0, ultipro-2' },
    { css: '[data-automation="accessibility-banner-link"], [data-automation="accessibility-banner-dismiss"]', from: 'ultipro-0' },
    { css: '#EEOCModalLink', from: 'ultipro-0' },
    // ultipro-2's Create account is the register state's sign-in container's button (core pass Z1, item 24:
    // registerContainer), pressed by Sign-in Auto's door alone.
  ],
  // ultipro-0: <div data-automation="application-errors" aria-live="polite"><div class="validation-summary-errors"
  // role="alert" data-automation="error-messages" style="display: none;">; a field's <span class="help-block"
  // id="FirstNameError" data-automation="firstName-error" ...>, hidden while it holds none.
  errors: { css: 'div.validation-summary-errors[data-automation="error-messages"], span.help-block[id$="Error"]',
    from: 'ultipro-0' },
};

/** The start date's segments (ultipro-0: <input aria-label="Month" aria-required="true"
 *  data-automation="ukg-date-input-text-month" ... placeholder="mm">, -day, -year), each a word after its label. */
const DATE_PARTS: ReadonlyMap<string, string> = new Map([['ukg-date-input-text-month', 'month'],
  ['ukg-date-input-text-day', 'day'], ['ukg-date-input-text-year', 'year']]);

/** A start-date segment's question (see the header), or null for any other control. */
function startDateLabel(control: Element): Element | null {
  if (!DATE_PARTS.has(control.getAttribute('data-automation') ?? '')) return null;
  // ultipro-0: <div class="form-group col-md-12"><label for="ApplicationAvailableStartDateInput"
  // data-automation="start-date-label" class="control-label required" ...>When can you start? (MM/DD/YYYY)</label>
  // <react-ko-es6-bridge ...><div data-automation="available-start-date-datepicker"><span id="AvailableStartDate"
  // class="sr-only">When can you start?</span><ukg-input-container aria-labelledby="AvailableStartDate" ...> ...
  // <ukg-date-input-text ...><template shadowrootmode="open"> ... the three inputs.
  const root = control.getRootNode();
  const host = 'host' in root ? (root as ShadowRoot).host : null;
  const group = host?.closest('ukg-input-container[data-automation="ukg-datepicker-container"]')?.closest('div.form-group');
  return group?.querySelector(':scope > label[data-automation="start-date-label"]') ?? null;
}

/** A month or year box with no label of its own in a "From" or "To" group (ultipro-0, -1: the experience editor's To,
 *  the education editor's From and To), its group's label and its own box's label, or null. */
function periodLabels(control: Element): { group: Element; part: Element } | null {
  // ultipro-1: <div class="form-group" role="group"><label class="control-label" ... id="NewWorkExperience_ToLabel0">To
  // </label><div class="form-inline"><div class="form-group"><label ...>Month</label><br><select class="form-control"
  // data-automation="to-month-dropdown" aria-label="To month"> ... <div class="form-group"><label ...>Year (YYYY)</label>
  // <br><input type="text" ... placeholder="YYYY" ... data-automation="to-year-textbox" aria-label="To year">.
  if (!/^(?:from|to)-(?:month-dropdown|year-textbox)$/.test(control.getAttribute('data-automation') ?? '')) return null;
  if (((control as HTMLInputElement).labels?.length ?? 0) > 0) return null;
  const own = control.parentElement;
  const group = own?.parentElement?.parentElement ?? null;
  if (own === null || group === null || !own.matches('div.form-group') || !own.parentElement!.matches('div.form-inline')
    || !group.matches('div.form-group[role="group" i]')) return null;
  const groupLabel = group.querySelector(':scope > label.control-label');
  const part = own.querySelector(':scope > label');
  return groupLabel === null || part === null ? null : { group: groupLabel, part };
}

/** The Skills panel's typeahead (ultipro-0, -1: <input role="combobox" type="text" required=""
 *  data-automation="item-typeahead" aria-label="Skills" ...>, labelled by nothing a person sees): its panel's h2. */
function skillsTitle(control: Element): Element | null {
  if (!control.matches('input[data-automation="item-typeahead"]')) return null;
  return control.closest('div[role="region" i][aria-label="Skills"]')?.querySelector('h2') ?? null;
}

const hooks = configuredHooks(ULTIPRO_CONFIG);

// ── snapshot build 2026-11-06 (core pass Z1, item 24) ──
/** The account step's form (ultipro-2: <form method="post" id="registrationDetailsForm" ...>, the register state's root). */
const REGISTER_FORM = 'body.authcode-controller form#registrationDetailsForm';
/** Its Create account, outside the form (ultipro-2: <ukg-button type="submit" form="registrationDetailsForm"
 *  data-automation="registrationDetails-submit-button" class="btn-create-account ..."><template shadowrootmode="open">
 *  <button aria-label="Create account" class="ukg-button-native" part="native" type="submit" role="button">): the native
 *  button its open shadow root draws, the face a person's click lands on, whose click reaches the host as theirs does. */
const CREATE_ACCOUNT = 'ukg-button[data-automation="registrationDetails-submit-button"][form="registrationDetailsForm"]';

/** The register state's sign-in container (Adapter.signInContainer): the account step's form, its Create account the
 *  button, no box of its own (Sign-in Auto types nothing there: the step's names and phone come from the profile). Null
 *  on any other page, or while the form or the button's face is not shown. */
function registerContainer(doc: Document): SignInForm | null {
  const cache = newScanCache();
  const container = doc.querySelector(REGISTER_FORM);
  if (container === null || !isUserVisible(container, cache)) return null;
  const host = doc.querySelector(CREATE_ACCOUNT);
  const button = host?.shadowRoot?.querySelector<HTMLElement>('button.ukg-button-native[type="submit"]') ?? null;
  if (button === null || !isUserVisible(button, cache)) return null;
  return { email: null, password: null, confirm: null, terms: [], button, container };
}
// ── end core pass Z1, item 24 ──

/** The UltiPro adapter. */
export const ultiproAdapter: Adapter = {
  ...hooks,
  id: 'ultipro',
  matchesUrl,
  canonicalApplicationUrl,
  signInContainer: registerContainer,
  // The behaviour review of 2026-11-06 (minor 2): the account step, its form and Create account shown, leads on to the
  // application: not its last step (the configured layer reads its states' own containers the same way). Create account
  // is Sign-in mode's (signInContainer), never Next's: the state names no Next.
  isFinalStep: (doc) => (registerContainer(doc) !== null ? 'not-final' : hooks.isFinalStep?.(doc) ?? 'unknown'),
  labelFor: (control) => startDateLabel(control) ?? periodLabels(control)?.group ?? skillsTitle(control)
    ?? hooks.labelFor?.(control) ?? null,
  labelSuffix(control) {
    if (startDateLabel(control) !== null) return DATE_PARTS.get(control.getAttribute('data-automation') ?? '') ?? null;
    const period = periodLabels(control);
    if (period === null) return null;
    const words = visibleText(period.part, { singleLine: true, cap: TEXT_CAP_LABEL, cache: newScanCache() });
    return words === '' ? null : words;
  },
};
