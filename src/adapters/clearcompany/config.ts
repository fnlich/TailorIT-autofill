/*
 * ClearCompany's configured adapter (DESIGN-NEW-ATS §1 "ClearCompany", §5 builder B), every rule read from the owner's
 * snapshots of three tenants' Backbone apply pages (fixtures/clearcompany; the design's ids in brackets):
 * - vafb-account [clearcompany-8]: the account step at /apply, form#personal-info-form, empty;
 * - vafb-uploads [clearcompany-3]: Page 1 of 3, the uploads (Résumé required, the LinkedIn widget, Cover Letter);
 * - vafb-uploads-menu-open [clearcompany-4]: the same page with the Résumé's Upload menu open;
 * - vafb-page2 [clearcompany-5]: Page 2 of 3, Contact Information and questions, partly answered;
 * - vafb-page3 [clearcompany-6]: Page 3 of 3, the last, with Submit: Additional Information (radios with hidden
 *   follow-ups), References, Voluntary Self-Identification and the Applicant Agreement (a clipped "I Agree" box);
 * - ferrilli-page2 [clearcompany-2]: Page 2 of 2, the last: Employment History in four repeated rows that reuse the
 *   first row's ids, Education in one, partly answered;
 * - atlas-uploads-saving [clearcompany-0]: Page 2 of 6, an uploads page while it saves ("Saving...", "Creating your
 *   account, this could take up to 60 seconds."), the Résumé's row shown;
 * - atlas-loading [clearcompany-1]: the apply page while it loads, no form yet.
 * What no snapshot shows is left out: a posting, an error after Continue or Submit, the page after Submit, the "I
 * Already Have An Account" flow, the Yes/No buttons' chosen state, the Dropbox and Google Drive pickers.
 *
 * Read by the scanner's own rules, so no rule here: a text, select, date or textarea control's label[for] and its
 * trailing star; the section each field sits under (the nearest preceding h3.control-label, dom/sections.ts); the
 * clipped checkboxes ("I Agree", "Present"), each stood for by its own wrapping label (dom/proxy.ts); a follow-up
 * question kept in a hidden div.child-field-holder until its option is chosen (read once it shows).
 */
import { headingSlug } from '../../core/text/keys';
import { sectionKindOf } from '../../core/resolver/labelRules';
import type { AtsConfig, ConfiguredHooks } from '../configured';
import { parseClearCompanyUrl } from './url';

/** The fixture cases the config was read from. */
export const CLEARCOMPANY_SNAPSHOTS = ['vafb-account', 'vafb-uploads', 'vafb-uploads-menu-open', 'vafb-page2', 'vafb-page3',
  'ferrilli-page2', 'atlas-uploads-saving', 'atlas-loading'] as const;

/** The numbered pages' one form (every one but the account step's). */
const FORM = 'form.section-form';
/** The pages' Continue and Submit: one button.submit-button, its data-localized-key and words telling them apart. */
const CONTINUE = `${FORM} button[type="submit"].submit-button[data-localized-key="forms.application.continue"]`;
const SUBMIT = `${FORM} button[type="submit"].submit-button[data-localized-key="forms.application.submit"]`;

/** The rules, each naming its snapshot. */
const RULES: AtsConfig = {
  platform: 'clearcompany',
  ...(__PROVENANCE__ && { snapshots: CLEARCOMPANY_SNAPSHOTS }),
  parse: parseClearCompanyUrl,
  states: [
    // The account step: Continue creates the account ("Creating your account, this could take up to 60 seconds.",
    // atlas-uploads-saving), so the page is an account's creation, Sign-in mode's (DESIGN-NEW-ATS §8.4, Phase 0's
    // decision). It asks for more than Sign-in Auto types (names, a phone, two Yes/No questions, one required): its form
    // declares the email and the email again, the rest and Continue the person's (personPresses). It holds no password
    // box, so Sign-in Auto (content/sign-in.ts: a create-account form only beside one) types nothing there either.
    // The behaviour review of 2026-11-06 (builder B1's pickAdapter: an own adapter's state is never the generic's): its
    // root is the account's own form (vafb-account: <form id="personal-info-form" class="form-horizontal" role="form">,
    // holding the names, both emails, the mobile number, the two Yes/No groups and Continue), so the run finds the page
    // and pauses there as an account's creation; nothing is filled from the profile on a paused step.
    { name: 'account', when: 'form#personal-info-form', auth: 'create-account', root: 'form#personal-info-form',
      ...(__PROVENANCE__ && { from: 'vafb-account' }),
      signIn: { form: 'form#personal-info-form', email: 'input[type="email"].email',
        confirmEmail: 'input[type="email"].email-confirm',
        button: 'button[type="submit"].submit-button[data-localized-key="forms.application.continue"]',
        personPresses: true } },
  ],
  root: { css: FORM, ...(__PROVENANCE__ && { from: 'vafb-uploads, vafb-page2, vafb-page3, ferrilli-page2' }) },
  // A question's title is the div.form-field's own .field-title: a label[for] (text, select, date), a span (radio and
  // checkbox groups, which have no fieldset or legend) or a div (uploads). In a repeated row it is that row's own:
  // every row reuses the first row's ids, so a later row's label[for] names the first row's control. The title's star
  // (span.required-indicator) ends its text, which the scanner reads as required: the only required sign of an upload
  // (its input has no required) and of a checkbox question (its box has none).
  questions: [
    // The behaviour review of 2026-11-06: the account step's questions (vafb-account), its root since then: <div
    // class="form-group"><label class="col-sm-3 control-label ...">Email</label><div class="col-sm-9 form-field"><input
    // type="email" class="form-control email" ...>, and each Yes/No group's <div class="form-group radio-group ...">
    // <label class="l10n radio-label ...">(its question)</label>: labels that name no control. First, as their inputs sit
    // in a div.form-field too.
    { container: 'form#personal-info-form div.form-group', title: ':scope > label',
      ...(__PROVENANCE__ && { from: 'vafb-account' }) },
    { container: 'div.form-field', title: ':scope > .field-title', help: ':scope div.file-description',
      ...(__PROVENANCE__ && { from: 'vafb-uploads, vafb-page3, ferrilli-page2' }) },
  ],
  // A checkbox question's box ("I Agree"): the site clips every checkbox to 1 px and draws it as the background image
  // of the span after it (html:not(.ie8) .checkbox label input[type=checkbox] + span), whose text's colour therefore
  // cannot be read against the image: its wrapping label, which a person sees and clicks, stands for it.
  proxies: [{ input: 'div.qa-checkbox-field div.checkbox > label > input[type="checkbox"]', proxy: 'div.checkbox > label',
    ...(__PROVENANCE__ && { from: 'vafb-page3' }) }],
  uploads: [
    // The input sits in the closed "Upload" menu (li.fileinput-button, opacity 0); its row once the page has the file.
    { input: 'div.form-field.qa-resume-upload input[type="file"][name="files[]"]', area: 'div.form-field.qa-resume-upload',
      control: 'button.dropdown-toggle.file-upload', done: 'tbody.file-list > tr.file-row',
      // The behaviour review of 2026-11-06 (M2), atlas-uploads-saving: <tr class="file-row" ...><td class="col-sm-8
      // file-name">(the file's name)</td><td class="col-sm-2 file-created-date">...</td>...<a ... js-remove-button
      // ...>Remove</a>, under the column "File name".
      name: 'td.file-name',
        ...(__PROVENANCE__ && { from: 'vafb-uploads, vafb-uploads-menu-open, atlas-uploads-saving' }) },
  ],
  steps: {
    // The pages have no names and one address: the active breadcrumb (page-<n>) and the breadcrumb's pages.
    anchors: [{ css: 'ol.form-progress-holder > li.active', attr: 'class' }],
    progress: 'ol.form-progress-holder',
    heading: `${FORM} div.fieldItem > h3.control-label`,
    next: CONTINUE,
    back: `${FORM} button.back-button[data-localized-key="forms.application.back"]`,
    ...(__PROVENANCE__ && { from: 'vafb-uploads, vafb-page2, vafb-page3, ferrilli-page2' }),
  },
  submit: { css: SUBMIT, ...(__PROVENANCE__ && { from: 'vafb-page3, ferrilli-page2' }) },
  neverPress: [
    { css: 'button.cancel-button[data-localized-key="forms.application.finish-later"]',
      ...(__PROVENANCE__ && { from: 'vafb-uploads' }) },
    { css: 'button.have-account-button', ...(__PROVENANCE__ && { from: 'vafb-account' }) },
    { css: 'li.js-dropbox a, li.js-google-drive a', ...(__PROVENANCE__ && { from: 'vafb-uploads' }) },
    { css: 'div.custom-handler-linkedin-v2', ...(__PROVENANCE__ && { from: 'vafb-uploads' }) },
    { css: 'a.authenticate-button', ...(__PROVENANCE__ && { from: 'vafb-account, vafb-uploads' }) },
    { css: 'li.breadcrumbs-page-link', ...(__PROVENANCE__ && { from: 'vafb-page2' }) },
    { css: 'a.remove-row-button', ...(__PROVENANCE__ && { from: 'ferrilli-page2' }) },
    { css: 'tr.file-row a.remove-button', ...(__PROVENANCE__ && { from: 'atlas-uploads-saving' }) },
  ],
  busy: [
    // Loading (atlas-loading) and saving (atlas-uploads-saving): the page's spinner, its "Saving..." and its notice.
    { css: 'div.form-view.loading-small.spinner, div.form-view-readonly.loading-small.spinner',
      ...(__PROVENANCE__ && { from: 'atlas-loading, atlas-uploads-saving' }) },
    { css: `${FORM} div.loading`, ...(__PROVENANCE__ && { from: 'atlas-uploads-saving' }) },
    { css: 'button.submit-button span.glyphicon-refresh-animate',
      ...(__PROVENANCE__ && { from: 'atlas-uploads-saving' }) },
  ],
  // The behaviour review of 2026-11-06 (minor 4): the page's own notice says its save takes "up to 60 seconds"
  // (atlas-uploads-saving: "Creating your account, this could take up to 60 seconds."): the settle waits as long as
  // any page may (dom/thresholds.ts SETTLE_CAP_MAX_MS, 30 s) before the pass rests with the page-busy notice.
  quirks: { settleCapMs: 30_000 },
};

/** A section's heading: the first h3.control-label in its own section-container, outside the containers inside it
 *  (ferrilli-page2: "EMPLOYMENT HISTORY", "EDUCATION"). */
function headingOf(container: Element): string {
  const heading = Array.from(container.querySelectorAll('div.fieldItem > h3.control-label'))
    .find((el) => el.closest('div.section-container') === container);
  return (heading?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** The hooks no rule can say (DESIGN-NEW-ATS §1 "ClearCompany"). */
const code: Partial<ConfiguredHooks> = {
  // Each repeated section (ferrilli-page2): a nested div.section-container of div.section-repeatable rows, its "Add
  // Additional Row" in the visible div.repeat-row beside that container, an end date's "Present" box in a row (an
  // input.present-date-option with no name or id, clipped and drawn as the "I Agree" box is); its kind read from
  // the heading of the section around it, as the core reads a section's words (EMPLOYMENT HISTORY, EDUCATION), and
  // none where those name neither.
  repeatables(root) {
    return Array.from(root.querySelectorAll('div.section-container'))
      .filter((container) => container.querySelector(':scope > div.section-repeatable') !== null)
      .flatMap((container) => {
        const outer = container.parentElement?.closest('div.section-container') ?? null;
        const kind = outer === null ? 'other' : sectionKindOf(headingSlug(headingOf(outer)));
        if (kind === 'other') return [];
        const blocks = () => Array.from(container.querySelectorAll(':scope > div.section-repeatable'));
        return [{
          kind,
          blocks,
          addButton: () => container.parentElement?.querySelector<HTMLElement>(':scope > div.repeat-row a.add-row-button')
            ?? null,
          currentlyHere: (block: Element) => block.querySelector<HTMLInputElement>('input.present-date-option'),
        }];
      });
  },
};

/** ClearCompany's config: the rules, and the code they cannot say. */
export const CLEARCOMPANY_CONFIG: AtsConfig = { ...RULES, code };
