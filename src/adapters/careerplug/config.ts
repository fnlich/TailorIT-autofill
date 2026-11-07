/*
 * CareerPlug's configured adapter (DESIGN-NEW-ATS §1 "CareerPlug", §3), every rule read from the owner's snapshots and
 * named by them: careerplug-0 (tenant A, no résumé yet, EEO block: fixture careerplug/cloudscouts-form) and careerplug-1
 * (tenant B, a résumé attached, no EEO block: eitacies-uploaded). A Rails/Formtastic page, the posting and its form
 * together:
 * - root: form#new_app (novalidate), which holds every field and Submit (both);
 * - the uploads (Resume/CV, Cover Letter): each file input's own label[for] reads "Upload File" (an icon and
 *   div.file-area__text): it is the upload's control, and the question is the for-less label.form-label of its
 *   div.form-group ("Resume/CV *", whose star marks the résumé required, the input itself saying nothing); the page took
 *   the file when its div.file-result-area shows (class in, the file's name in div.filename: careerplug-1), the upload
 *   area then collapsed around the input;
 * - the paste editors ("Type/Paste Text": div.file-area__paste-content, collapsed until opened) hold no question of
 *   their own: excluded;
 * - the EEO block: div.eeoc-area titled by its p.eeoc-title ("U.S. Equal Opportunity Employment Information ...",
 *   careerplug-0), a section;
 * - Submit: input[type=submit][name=commit] (an invisible reCAPTCHA is bound to it: its challenge is the person's);
 * - never pressed: the Indeed Apply widget above the form ("Apply with Indeed"), "Español", the share links, the logo's
 *   /account link, each file's "Remove file" and the paste switches;
 * - the posting's text: div.job-description-container on the same page.
 * Read by the standard rules: the Formtastic fields (label[for], the star span[title=required], required="required"),
 * the SMS radios (legend), the location boxes (their aria-label beside the same placeholder) and the EEO selects. Not in
 * any snapshot: error markup, the page after submitting, the posting's own page and custom questions.
 */
import type { AtsConfig } from '../configured/types';
import { parseCareerPlugUrl } from './url';

/** The fixture cases the rules were read from (fixtures/careerplug/<case>.html). */
export const CAREERPLUG_SNAPSHOTS = ['cloudscouts-form', 'eitacies-uploaded'] as const;

/** An upload question's container: the div.form-group around its fieldset (fieldset.resume-area, fieldset#cover_letter). */
const UPLOAD_QUESTION = 'div.form-group:has(> fieldset)';

export const CAREERPLUG_CONFIG: AtsConfig = {
  platform: 'careerplug',
  snapshots: CAREERPLUG_SNAPSHOTS,
  parse: parseCareerPlugUrl,
  root: { css: 'form#new_app', from: 'careerplug-0, careerplug-1' },
  sections: [{ container: 'div.eeoc-area', heading: 'p.eeoc-title', from: 'careerplug-0' }],
  questions: [
    // <div class="form-group"><label class="form-label control-label">Resume/CV *</label><fieldset class="resume-area">
    // <div class="file-area collapse in" data-name="Resume">…<label for="app_has_attachments_attributes_0_attachment">
    // <div class="file-area__text">Upload File</div></label>…<input type="file" id="app_has_attachments_attributes_0_…">
    { container: UPLOAD_QUESTION, title: 'label.form-label', from: 'careerplug-0, careerplug-1' },
  ],
  uploads: [{ input: 'input[type="file"][id^="app_has_attachments_attributes_"]',
    control: 'label[for^="app_has_attachments_attributes_"][for$="_attachment"]', area: UPLOAD_QUESTION,
    done: 'div.file-result-area.in', from: 'careerplug-0, careerplug-1' }],
  excluded: [{ css: 'div.file-area__paste-content', from: 'careerplug-0, careerplug-1' }],
  submit: { css: 'form#new_app input[type="submit"][name="commit"]', from: 'careerplug-0, careerplug-1' },
  neverPress: [
    { css: 'div.indeed-apply-widget, .ia-btn-div', from: 'careerplug-0, careerplug-1' },
    { css: 'a[href*="?loc=es"]', from: 'careerplug-0, careerplug-1' },
    { css: 'a[aria-label^="Share"]', from: 'careerplug-0, careerplug-1' },
    { css: 'a[href$="/account"]', from: 'careerplug-0, careerplug-1' },
    { css: 'a.remove[aria-label="Remove file"]', from: 'careerplug-0, careerplug-1' },
    { css: 'a.paste-link', from: 'careerplug-0, careerplug-1' },
  ],
  posting: { text: 'div.job-description-container', from: 'careerplug-0, careerplug-1' },
};
