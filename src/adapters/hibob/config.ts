/*
 * HiBob's configured adapter (DESIGN-NEW-ATS §1 "HiBob", §3), every rule read from the owner's snapshot and named by
 * it: hibob-0 (fixture hibob/mplc-form; filled: a country chosen, a language added, skills as chips, a résumé in, the
 * Yes/No answered, the consent ticked). An Angular app, the posting's "Application" tab at /jobs/<uuid>/apply:
 * - root: careers-ui-job-ad-application-form, which holds the four section forms (Personal information, Professional
 *   profile, Questionnaire, the consent) and Apply, outside all of them; the standard reading took the first form only;
 * - the Country dropdown: b-single-select's div[role=button] (aria-haspopup, aria-expanded, labelled by its label),
 *   declared a combobox; its list is drawn in the CDK overlay container, empty in the snapshot: the person's;
 * - the Yes/No question: careers-ui-yes-no-question-control, titled by its div.label; its native radios (tabindex -1)
 *   sit under their drawn labels, the chosen one's wrapper and label showing class selected;
 * - the consent box: input.bchk-input (tabindex -1) under its label, its state in aria-checked;
 * - required: the host's required attribute (b-single-select[required]) and, where no control carries one, the title's
 *   class (div.label.required: the Yes/No question, the résumé); every b-input's own input says required itself;
 * - Submit: button#apply-to-job-btn "Apply", type=button, outside every form;
 * - never pressed: the header's Back, the Overview tab, the navbar's menu button, the résumé's Delete, each chip's
 *   remove, each language's item menu and Add, and the privacy link.
 * Left to the standard rules: the sections (each b-collapsible-section's title is a role=heading the standard reading
 * takes), the text boxes (label for) and Skills (a combobox input whose suggestions are in no
 * snapshot: the person's). Not in the snapshot: the résumé control before an upload (no file input is in it), the
 * Languages add editor and its Save (so no language is added by a run), the Country and Skills lists, the EEO section
 * (empty here), error markup, the Overview tab's address and the page after Apply.
 */
import type { AtsConfig } from '../configured/types';
import { parseHiBobUrl } from './url';

/** The fixture cases the rules were read from (fixtures/hibob/<case>.html). */
export const HIBOB_SNAPSHOTS = ['mplc-form'] as const;

export const HIBOB_CONFIG: AtsConfig = {
  platform: 'hibob',
  ...(__PROVENANCE__ && { snapshots: HIBOB_SNAPSHOTS }),
  parse: parseHiBobUrl,
  root: { css: 'careers-ui-job-ad-application-form', ...(__PROVENANCE__ && { from: 'hibob-0' }) },
  questions: [
    // <careers-ui-yes-no-question-control><div class="mrg-b-16 label required">Are you based in the United States?</div>
    // <b-radio-button><div role="radiogroup" id="bfe-<x>-14"><div class="flx min-w-0 selected"><input type="radio"
    // class="brd-input" tabindex="-1"><label class="brd-label selected" for="…">…Yes…
    { container: 'careers-ui-yes-no-question-control', title: 'div.label', ...(__PROVENANCE__ && { from: 'hibob-0' }) },
  ],
  required: [{ is: 'b-single-select[required]', ...(__PROVENANCE__ && { from: 'hibob-0' }) }, { is: 'div.label.required',
    ...(__PROVENANCE__ && { from: 'hibob-0' }) }],
  widgets: [{ match: 'b-single-select div[role="button"][aria-haspopup="true"]', root: true, kind: 'combobox',
    expanded: 'div[role="button"][aria-haspopup="true"]', ...(__PROVENANCE__ && { from: 'hibob-0' }) }],
  checked: [
    { input: 'input.brd-input[type="radio"]', holder: 'div:has(> input.brd-input)', chosen: '.selected',
      ...(__PROVENANCE__ && { from: 'hibob-0' }) },
    { input: 'input.bchk-input[type="checkbox"]', holder: 'input.bchk-input', chosen: '[aria-checked="true"]',
      ...(__PROVENANCE__ && { from: 'hibob-0' }) },
  ],
  submit: { css: 'button#apply-to-job-btn[data-testid="apply-to-job-btn"]',
    ...(__PROVENANCE__ && { from: 'hibob-0' }) },
  neverPress: [
    { css: 'b-back-button button', ...(__PROVENANCE__ && { from: 'hibob-0' }) },
    { css: 'a[role="tab"].overview', ...(__PROVENANCE__ && { from: 'hibob-0' }) },
    { css: 'b-round-button.menu-button button', ...(__PROVENANCE__ && { from: 'hibob-0' }) },
    { css: 'button#bf-delete-btn', ...(__PROVENANCE__ && { from: 'hibob-0' }) },
    { css: 'b-chip [role="button"].remove-button', ...(__PROVENANCE__ && { from: 'hibob-0' }) },
    { css: 'careers-ui-experience-display-item button[aria-label="Menu"], button[data-testid="addButton"]',
      ...(__PROVENANCE__ && { from: 'hibob-0' }) },
    { css: 'careers-ui-privacy-policy a', ...(__PROVENANCE__ && { from: 'hibob-0' }) },
  ],
};
