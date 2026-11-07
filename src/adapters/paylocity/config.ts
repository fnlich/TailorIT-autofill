/*
 * Paylocity's configured adapter (DESIGN-NEW-ATS §1 "Paylocity", §5 builder B), every rule read from the owner's
 * snapshots of one React application with no <form> (fixtures/paylocity; the design's ids in brackets):
 * - sourcepass-step2-eeo [paylocity-2]: "Step 2 of 4", Equal Employment Opportunity, veteran and disability
 *   self-identification: four required react-widgets DropdownLists, none answered;
 * - sourcepass-step3-identity [paylocity-0]: "Step 3 of 4", Optional Identity Questions: Paylocity's input-selects
 *   (ethnicity with a chip, pronouns with a single value, sexual orientation typed), a legal-gender DropdownList and the
 *   "Display pronouns" box;
 * - sourcepass-step4-review [paylocity-1]: "Step 4 of 4", the review: read-only summaries with their Edit buttons, then
 *   the Work Authorization DropdownList, the acknowledgement box and Submit in the footer.
 * Step 1 (contact details and the résumé) is in no snapshot: its fields get the standard rules. What no snapshot shows
 * is left out: the posting, an error, the page after Submit, an input-select's open list (the widget relies on the list
 * its aria-owns names, unseen), a screener step.
 *
 * Read by the scanner's own rules, so no rule here: "(required)" ending a question (cut from its label, which makes it
 * required); the native checkboxes, by their label[for].
 */
import type { AtsConfig, ConfiguredHooks } from '../configured';
import { configuredHooks } from '../configured';
import type { WidgetDecl } from '../types';
import { parsePaylocityUrl } from './url';

/** The fixture cases the config was read from. */
export const PAYLOCITY_SNAPSHOTS = ['sourcepass-step2-eeo', 'sourcepass-step3-identity', 'sourcepass-step4-review'] as const;

/** Paylocity's input-select: a container that owns its list (aria-haspopup=listbox, aria-owns), with its text box and
 *  its chips or its single value inside (sourcepass-step3-identity). */
const INPUT_SELECT = 'div.pcty-input-select-full-container[aria-haspopup="listbox"]';

/** The rules, each naming its snapshot. */
const RULES: AtsConfig = {
  platform: 'paylocity',
  snapshots: PAYLOCITY_SNAPSHOTS,
  parse: parsePaylocityUrl,
  // No <form>: #app holds the step (#appDetailDiv) and the footer (#appFooterDiv), where the last step's questions, its
  // acknowledgement and every step's buttons sit.
  root: { css: '#app', holds: 'p.progress-header',
    from: 'sourcepass-step2-eeo, sourcepass-step3-identity, sourcepass-step4-review' },
  questions: [
    // A DropdownList's question is a sibling <label> with no for, in the same div.form-group.
    { container: 'div.form-group', title: ':scope > label', from: 'sourcepass-step2-eeo, sourcepass-step4-review' },
    // An input-select's question: inside its wrapper, the label's own span (that label[for] wraps the whole widget, its
    // chosen value too), else the sibling <label> before the wrapper; its help, "Select from the provided list or add
    // your own".
    { container: 'div[type="dropdown-wrapper"][data-automation-id$="-wrapper"]',
      title: 'span[data-automation-id$="-label-span"]', titleBefore: 'label', help: 'span[data-automation-id$="-footnote"]',
      from: 'sourcepass-step3-identity' },
  ],
  widgets: [
    // react-widgets' DropdownList: a role=combobox div that owns its listbox (aria-owns), rendered once it is opened and
    // then kept hidden in the widget (sourcepass-step3-identity, -step4-review; absent before, sourcepass-step2-eeo); it
    // shows its answer in div.rw-input ("--" for none). Declared, so the widget helpers open it and choose from it.
    { match: 'div.rw-dropdownlist[role="combobox"]', kind: 'combobox', expanded: 'div.rw-dropdownlist[role="combobox"]',
      from: 'sourcepass-step2-eeo, sourcepass-step3-identity, sourcepass-step4-review' },
    // Paylocity's input-select; its own text box is the widget's part, never a field of its own.
    { match: INPUT_SELECT, root: true, kind: 'combobox', parts: 'input', from: 'sourcepass-step3-identity' },
  ],
  sections: [
    // Each step page's h2 ("Equal Employment Opportunity", "Optional Identity Questions", "My Information"), and on
    // the EEO step each of its three blocks' h2 (the veteran and the disability forms): without them a question falls
    // under the nearest h3 before it, one of the forms' explanations ("How Do You Know if You Are a Veteran Protected by
    // VEVRAA?", "Sensitive Data Message").
    { container: '#appDetailDiv [id^="pcty-wr-"]', heading: 'h2', from: 'sourcepass-step2-eeo, sourcepass-step3-identity' },
    { container: '#pcty-wr-eeopage > div > span', heading: 'h2', from: 'sourcepass-step2-eeo' },
    // The last step's footer sections, div.section-heading, which no heading rule reads ("Work Authorization",
    // "Acknowledgement").
    { container: '#appFooterDiv span:has(div.section-heading)', heading: 'div.section-heading', from: 'sourcepass-step4-review' },
  ],
  steps: {
    progress: 'p.progress-header span.type-bold',
    // The step page's container under #appDetailDiv (#pcty-wr-eeopage, #pcty-wr-expanded-identity-page,
    // #pcty-wr-preview-jobapplication), and its first h2.
    anchors: [{ css: '#appDetailDiv [id^="pcty-wr-"]', attr: 'id' }],
    heading: '#appDetailDiv [id^="pcty-wr-"] h2',
    // Next and Submit share the id btn-submit: their data-automation-id tells them apart.
    next: '#appFooterDiv button[data-automation-id="btnNext"]',
    back: '#appFooterDiv button#btn-previous',
    from: 'sourcepass-step2-eeo, sourcepass-step3-identity, sourcepass-step4-review',
  },
  submit: { css: '#appFooterDiv button[data-automation-id="btnSubmit"]', from: 'sourcepass-step4-review' },
  neverPress: [
    // The résumé parser ("Apply with resume", in a hidden modal outside #app).
    { css: 'button[data-automation-id="btn-forceResume"]', from: 'sourcepass-step2-eeo' },
    // The review's Edit buttons and its "Edit Application".
    { css: '[data-automation-id="information-section"] div.button.form-button, '
      + '[data-automation-id="eeo-section"] div.button.form-button', from: 'sourcepass-step4-review' },
    { css: '#appFooterDiv a:has(> i.icon-edit)', from: 'sourcepass-step4-review' },
    { css: 'button.react-share__ShareButton', from: 'sourcepass-step2-eeo' },
    { css: '#onetrust-accept-btn-handler, #onetrust-pc-btn-handler, .onetrust-close-btn-handler', from: 'sourcepass-step2-eeo' },
  ],
};

const ruled: ConfiguredHooks = configuredHooks(RULES);

/** The hooks no rule can say (DESIGN-NEW-ATS §1 "Paylocity"). */
const code: Partial<ConfiguredHooks> = {
  // An input-select showing chips takes several answers (ethnicity's tag items, each with its Dismiss button); one
  // showing a single value or nothing reads as one, its answer the single value drawn beside its emptied text box
  // (pronouns' div.input-select-input-single-value), '' while it shows none (sourcepass-step3-identity). An empty one's
  // kind is not shown.
  widgetFor(control): WidgetDecl | null {
    const decl = ruled.widgetFor?.(control) ?? null;
    if (decl === null || !control.matches(INPUT_SELECT)) return decl;
    if (control.querySelector('[data-automation-id*="-tag-item-"]') !== null) return { ...decl, kind: 'multiselect' };
    return { ...decl, shownAnswer: () => (control.querySelector('div.input-select-input-single-value')?.textContent ?? '')
      .replace(/\s+/g, ' ').trim() };
  },
};

/** Paylocity's config: the rules, and the code they cannot say. */
export const PAYLOCITY_CONFIG: AtsConfig = { ...RULES, code };
