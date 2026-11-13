/*
 * Breezy HR's configured adapter (DESIGN-NEW-ATS §1 "Breezy", §3), every rule read from the owner's snapshots and named
 * by them: breezy-0 (fixture breezy/concurrent-form; the Veteran question unanswered) and breezy-1 (the same page, every
 * question answered). An AngularJS page, /p/<id>-<slug>/apply:
 * - root: form[name="form"], selected by its name (its classes follow its validity, ng-invalid or ng-valid);
 * - sections: each div.section by its div.section-header's h2 or h3 ("Personal Details", "Cover Letter"), and the EEO
 *   block div.eeoc-form-container by its h2 ("We're an equal opportunity employer"); the standard reading took each
 *   question's h3 for a section;
 * - titles: no control has a label. A personal field's question is the h3 just before it (h3 > span.polygot, its star
 *   span.required "*" in the same h3), the cover letter's the div.section-header before it; Desired Salary is one h3
 *   over three controls in div.desired-salary, the currency select (ng-model candidate.salary.currency) and the period
 *   select (candidate.salary.period) told apart by those words after it; the SMS consent box's words are the span
 *   beside it (ng-bind getSmsConsentText()); an EEO question's is the h3 in its div.multiplechoice, and Veteran status's
 *   the h3 above the legal text that separates it from its radios;
 * - required: the EEO radios are required while unanswered (ng-required="!eeoc.<question>": breezy-0's unanswered
 *   Veteran radios carry required, breezy-1's answered ones do not) and each shows "A response is required" on a failed
 *   Submit: read from ng-required, so a group is required whether it is answered yet or not;
 * - the résumé: a display:none input#main-attachment (required) whose opener, a.button.resume, sits in another branch
 *   (the apply buttons above the form); the page took the file when the opener shows "Attached" and the file's link
 *   a.bzyLinkColor appears (both ng-if on candidate.resume.file_name). No visible words name the input in either
 *   snapshot (the opener's words before a file is attached are not shown), so it reads with no label: the person's;
 * - Submit: button[type=submit].bzyButtonColor "Submit Application", inside the form;
 * - never pressed: "Use My Indeed Resume", "Apply Using LinkedIn", the résumé's opener and file link, the breadcrumb
 *   and the brand links;
 * - errors: an error-container that shows (no ng-hide) and its error span (every one is in the markup, none shown);
 * - success: the confirmation drawn in place of the form, div.confirmation-container ("Application Submitted"), hidden
 *   (ng-hide) in both snapshots.
 * The honeypot hp_7f2b (div.apply-field-extra, aria-hidden, off-screen) is never a field. Not in any snapshot: the
 * posting's own page and its Apply, the empty résumé opener, custom questions, the address suggestions, a shown error
 * and the shown confirmation.
 */
import type { AtsConfig } from '../configured/types';
import { parseBreezyUrl } from './url';

/** The fixture cases the rules were read from (fixtures/breezy/<case>.html). */
export const BREEZY_SNAPSHOTS = ['concurrent-form'] as const;

export const BREEZY_CONFIG: AtsConfig = {
  platform: 'breezy',
  ...(__PROVENANCE__ && { snapshots: BREEZY_SNAPSHOTS }),
  parse: parseBreezyUrl,
  root: { css: 'form[name="form"]', ...(__PROVENANCE__ && { from: 'breezy-0, breezy-1' }) },
  sections: [
    { container: 'div.section', heading: 'div.section-header > h2, div.section-header > h3',
      ...(__PROVENANCE__ && { from: 'breezy-0' }) },
    { container: 'div.eeoc-form-container', heading: 'div.section-header > h2',
      ...(__PROVENANCE__ && { from: 'breezy-0' }) },
  ],
  questions: [
    // <div class="desired-salary"><h3><span class="polygot">Desired Salary</span></h3><span ng-if="currencies.length > 1">
    // <select name="salaryCurrency" ng-model="candidate.salary.currency"></span><input name="cSalary"><select name=""
    // ng-model="candidate.salary.period">
    { container: 'div.desired-salary', title: 'h3', ...(__PROVENANCE__ && { from: 'breezy-0' }) },
    // <li class="option consent-form"><input type="checkbox" name="smsConsent"><span ng-bind="getSmsConsentText()">…
    { container: 'li.consent-form', title: 'span[ng-bind="getSmsConsentText()"]',
      ...(__PROVENANCE__ && { from: 'breezy-0' }) },
    // <li class="question"><div class="multiplechoice"><h3 class="polygot">Gender</h3><ul class="options">…
    { container: 'div.multiplechoice', title: 'h3', ...(__PROVENANCE__ && { from: 'breezy-0' }) },
    // <h3 class="polygot">Veteran status</h3><p>…</p><ul class="unordered">…</ul><p>…</p><p>…</p><p>Please check one of
    // the boxes below:</p><ul><li><input type="radio" name="eeoc.veteran_status">…
    { container: 'div.section.questions > ul:has(> li > input[type="radio"])', titleBefore: 'h3',
      ...(__PROVENANCE__ && { from: 'breezy-0' }) },
    // <h3><span class="polygot">Full Name</span><span class="required" title="Required">*</span></h3><input name="cName">;
    // <div class="section-header"><h3><span class="polygot">Cover Letter</span></h3></div><textarea name="cCoverLetter">
    { container: 'div.section > input:not([type="checkbox"]):not([type="radio"]), div.section > textarea',
      titleBefore: 'h3, div.section-header', ...(__PROVENANCE__ && { from: 'breezy-0' }) },
  ],
  required: [{ is: 'input[type="radio"][ng-required^="!eeoc."]',
    ...(__PROVENANCE__ && { from: 'breezy-0, breezy-1' }) }],
  // The behaviour review of 2026-11-06 (M2): the résumé's own area, the input's div.file-input-container (div.section-header
  // > div.file-input-container > a.bzyLinkColor[ng-if="candidate.resume.file_name"] + input#main-attachment), whose
  // file link shows the file's name (its words: the paperclip icon, a space, the name); the opener, in another branch of
  // the form, is found from the area's ancestors.
  uploads: [{ input: 'input#main-attachment[name="cResume"]', control: 'ul.apply-buttons a.button.resume',
    area: 'div.file-input-container:has(> input#main-attachment)',
    done: 'a.bzyLinkColor[ng-if="candidate.resume.file_name"]', name: 'a.bzyLinkColor[ng-if="candidate.resume.file_name"]',
    ...(__PROVENANCE__ && { from: 'breezy-0, breezy-1' }) }],
  submit: { css: 'form[name="form"] button[type="submit"].bzyButtonColor',
    ...(__PROVENANCE__ && { from: 'breezy-0' }) },
  neverPress: [
    { css: 'a.button.indeed', ...(__PROVENANCE__ && { from: 'breezy-0' }) },
    { css: 'a.button.linkedin', ...(__PROVENANCE__ && { from: 'breezy-0' }) },
    { css: 'ul.apply-buttons a.button.resume, a.bzyLinkColor[ng-if="candidate.resume.file_name"]',
      ...(__PROVENANCE__ && { from: 'breezy-0' }) },
    { css: 'ul.breadcrumbs a', ...(__PROVENANCE__ && { from: 'breezy-0' }) },
    { css: 'a.brand', ...(__PROVENANCE__ && { from: 'breezy-0' }) },
  ],
  errors: { css: 'div.error-container:not(.ng-hide) span.error:not(.ng-hide)',
    ...(__PROVENANCE__ && { from: 'breezy-0' }) },
  success: { css: 'div.confirmation-container .application-confirmed', ...(__PROVENANCE__ && { from: 'breezy-0' }) },
  code: {
    // breezy-0: Desired Salary's two selects, by the ng-model words of each (candidate.salary.currency, .period).
    labelSuffix(control) {
      if (control.closest('div.desired-salary') === null || control.localName !== 'select') return null;
      return control.getAttribute('name') === 'salaryCurrency' ? 'currency' : 'period';
    },
  },
};
