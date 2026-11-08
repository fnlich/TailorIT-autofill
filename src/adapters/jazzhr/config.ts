/*
 * JazzHR's configured adapter (DESIGN-NEW-ATS §1 "JazzHR", §3), every rule read from the owner's snapshots and named by
 * them: jazzhr-0 and -1 (invaluable, one posting in two loads; fixture jazzhr/invaluable-form is jazzhr-1),
 * jazzhr-2 (nucleussecurity-form: citizenship and age selects, salary and a datepicker box), jazzhr-3
 * (panoptimization-form: a references box and a checkbox question) and jazzhr-4 (wellhive-submitting: two checkbox
 * questions and a state select, captured after Submit was pressed). One page, the posting and its form together:
 * - root: form#form_submit_new_resume, which holds every field and the reCAPTCHA (all five);
 * - the checkbox questions: a div.form-group whose title is a label.control-label naming no element (its for points
 *   nowhere) and whose boxes each have their own name ("Yes"/"No", "yes"/"no"): one question, through groupOf, with the
 *   title's star (jazzhr-3, -4). Every other question is tied to its control (for/id, the EEO selects inside their
 *   label, City, State/Province and Postal by placeholder), its star the label's trailing "*" (all five), which the
 *   standard reading already takes;
 * - Submit is a link, a#resumator-submit-resume "Submit Application", inside the form (jazzhr-0 to -3); once pressed,
 *   div#resumator-submit reads "Submitting...please wait..." without it (jazzhr-4): the page's busy sign;
 * - never pressed: the narrow layout's Apply (#resumator-mobile-apply-button), the share links, "View All Jobs", the
 *   resume's paste and attach switches and the "two stage" re-upload link, the cookie banner's buttons and "Powered by"
 *   (all five);
 * - the posting's text: div#job-description (all five).
 * Left to the standard rules, as no snapshot shows them: the résumé's state once a file is chosen (its input is visible
 * and keeps its own files), the datepicker's written layout (jazzhr-2's "Earliest start date?" stays free text), any
 * error markup and the page after submitting. The reCAPTCHA "Human Check" is always the person's (pause detection).
 * v5 p1-rules (PLAN decision 9, the owner's "implement like jobright extension", 2026-11-08): Submit is pressed beside
 * an unticked Human Check and JazzHR decides; its own "complete the reCAPTCHA" error, #recaptcha-required-error (as
 * Jobright 1.25.2's submission rules read JazzHR; not seen in a snapshot, none of which was refused), is an error of
 * the form, which the run reads as the check's (dom/pause-detect.ts isCaptchaError: a CAPTCHA pause, carried on once the
 * person ticked it), never a field's.
 */
import type { AtsConfig } from '../configured/types';
import { parseJazzhrUrl } from './url';

/** The fixture cases the rules were read from (fixtures/jazzhr/<case>.html), in snapshot order. */
export const JAZZHR_SNAPSHOTS = ['invaluable-form', 'nucleussecurity-form', 'panoptimization-form', 'wellhive-submitting'] as const;

export const JAZZHR_CONFIG: AtsConfig = {
  platform: 'jazzhr',
  snapshots: JAZZHR_SNAPSHOTS,
  parse: parseJazzhrUrl,
  root: { css: 'form#form_submit_new_resume', from: 'jazzhr-0 to -4' },
  questions: [
    // <div class="form-group"><label id="resumator-questionnaire-q<q>-label" for="resumator-questionnaire-q<q>"
    // class="control-label">…<i class="asterisk">*</i></label><label class="checkbox" for="resumator-checkbox-<q>-1">
    // <input type="checkbox" name="resumator-checkbox-<q>-1" class="resumator-questionnaire-checkbox">Yes</label>…
    { container: 'div.form-group:has(input.resumator-questionnaire-checkbox)', title: 'label.control-label', group: true,
      from: 'jazzhr-3, jazzhr-4' },
  ],
  submit: { css: 'form#form_submit_new_resume a#resumator-submit-resume', from: 'jazzhr-0 to -3' },
  // v5 p1-rules (PLAN decision 9): JazzHR's CAPTCHA-required error, from Jobright 1.25.2's reading (module header).
  errors: { css: '#recaptcha-required-error', from: 'Jobright 1.25.2 submission rules (not seen live)' },
  busy: [{ css: 'div#resumator-submit:not(:has(#resumator-submit-resume))', from: 'jazzhr-4' }],
  neverPress: [
    { css: '#resumator-mobile-apply-button', from: 'jazzhr-0 to -4' },
    { css: 'a[data-test="job-board-responsive-share"]', from: 'jazzhr-0 to -4' },
    { css: '#resumator-back-button', from: 'jazzhr-0 to -4' },
    { css: '#resumator-resume-switch-paste, #resumator-resume-switch-upload', from: 'jazzhr-0 to -4' },
    { css: '#resumator-choose-upload, #resumator-choose-paste, #resumator-two-stage-change-resume', from: 'jazzhr-0 to -4' },
    { css: '#tracking-consent-banner button', from: 'jazzhr-0 to -4' },
    { css: '#resumator-logo', from: 'jazzhr-0 to -4' },
  ],
  posting: { text: '#job-description', from: 'jazzhr-0 to -4' },
};
