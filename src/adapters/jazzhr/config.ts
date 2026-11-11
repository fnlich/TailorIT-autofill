/*
 * JazzHR's configured adapter (DESIGN-NEW-ATS §1 "JazzHR", §3), every rule read from the owner's snapshots and named by
 * them: jazzhr-0 and -1 (invaluable, one posting in two loads; fixture jazzhr/invaluable-form is jazzhr-1),
 * jazzhr-2 (nucleussecurity-form: citizenship and age selects, salary and a datepicker box), jazzhr-3
 * (panoptimization-form: a references box and a checkbox question) and jazzhr-4 (wellhive-submitting: two checkbox
 * questions and a state select, captured after Submit was pressed), all five in JazzHR's Bootstrap layout; and (jr6,
 * FIXPLAN §6.8) jr6-centroid-form, the owner's snapshot6\applytojob of 2026-11-10, in JazzHR's classic "resumator"
 * layout. One page, the posting and its form together:
 * - root: form#form_submit_new_resume, which holds every field and the reCAPTCHA (all six);
 * - the checkbox questions: a div.form-group whose title is a label.control-label naming no element (its for points
 *   nowhere) and whose boxes each have their own name ("Yes"/"No", "yes"/"no"): one question, through groupOf, with the
 *   title's star (jazzhr-3, -4). Every other Bootstrap question is tied to its control (for/id, the EEO selects inside
 *   their label, City, State/Province and Postal by placeholder), its star the label's trailing "*" (all five), which
 *   the standard reading already takes;
 * - jr6 JZ-1 and JZ-5: the classic layout ties no question to its control: each is a div.resumator-field-wrapper whose
 *   title is a sibling div.resumator-label ("First name*": its star the required mark, which the standard reading
 *   takes), as Jobright 1.25.2 reads both layouts (its JazzHR rules' extractRules: div.form-group, and
 *   div.resumator-field-wrapper outside a form-group, titled by div.resumator-label). The Location wrapper stays out (its
 *   four boxes keep their placeholders), and so do the Human Check's wrapper and the Bootstrap EEO wrappers inside a
 *   div.form-group (their empty div.resumator-label; their label[for] names them). The résumé's paste box, hidden behind
 *   "Paste resume" (#resumator-resume-paste-wrapper, both layouts), holds no question: excluded;
 * - Submit: #resumator-submit-resume inside the form, whatever its tag (jr6 JZ-2): a link "Submit Application" on the
 *   Bootstrap layout (jazzhr-0 to -3), an input[type=button] on the classic one (jr6-centroid-form), as Jobright 1.25.2's
 *   JazzHR submission rule names it (#resumator-submit-resume, #resumator-submit-resume-button); once pressed,
 *   div#resumator-submit reads "Submitting...please wait..." without it (jazzhr-4): the page's busy sign;
 * - jr6 JZ-4: the résumé's file input #resumator-resume-value, in its question #resumator-resume. The classic layout
 *   hides it (#resumator-resume-upload-wrapper.none) behind "Attach resume" (a#resumator-choose-upload, an <a href> to
 *   the posting itself): the link is the upload's control and its reveal, pressed once per document by ENGINE's reveal
 *   door alone (FIXPLAN §6.2 item 9), as Jobright 1.25.2 presses it and waits 300 ms before it puts the file in (its
 *   JazzHR operations' uploadResume); it stays never pressed for every other path. The Bootstrap layout shows the input;
 * - never pressed: the narrow layout's Apply (#resumator-mobile-apply-button), the share links, "View All Jobs", the
 *   resume's paste and attach switches and the "two stage" re-upload link, the cookie banner's buttons and "Powered by"
 *   (jazzhr-0 to -4);
 * - the posting's text: div#job-description (jazzhr-0 to -4).
 * Left to the standard rules, as no snapshot shows them: the résumé's state once a file is chosen (its input keeps its
 * own files), the datepicker's written layout (jazzhr-2's "Earliest start date?" stays free text) and the page after
 * submitting. The reCAPTCHA "Human Check" is always the person's (pause detection).
 * v5 p1-rules (PLAN decision 9, the owner's "implement like jobright extension", 2026-11-08): Submit is pressed beside
 * an unticked Human Check and JazzHR decides; its own "complete the reCAPTCHA" error, #recaptcha-required-error (as
 * Jobright 1.25.2's submission rules read JazzHR; not seen in a snapshot, none of which was refused), is an error of
 * the form, which the run reads as the check's (dom/pause-detect.ts isCaptchaError: a CAPTCHA pause, carried on once the
 * person ticked it), never a field's. jr6 JZ-10: JazzHR's field errors, a label marked .resumator_label_error (the same
 * submission rules' errors; no snapshot shows one), are read as their question's container (`code.errors` below).
 */
import { newScanCache } from '../../dom/scan-cache';
import { isUserVisible } from '../../dom/visibility';
import { configuredHooks } from '../configured';
import type { AtsConfig, ConfiguredHooks } from '../configured/types';
import { parseJazzhrUrl } from './url';

/** The fixture cases the rules were read from (fixtures/jazzhr/<case>.html), in snapshot order. */
export const JAZZHR_SNAPSHOTS = ['invaluable-form', 'nucleussecurity-form', 'panoptimization-form', 'wellhive-submitting',
  'jr6-centroid-form'] as const;

/** jr6 JZ-10: a question's container on either layout (Bootstrap's div.form-group, the classic
 *  div.resumator-field-wrapper; the nearest, so a Bootstrap EEO row's wrapper inside its form-group). */
const QUESTION = 'div.form-group, div.resumator-field-wrapper';
/** jr6 JZ-10: the mark JazzHR's validation puts on a refused question's label (Jobright 1.25.2's JazzHR submission
 *  rule, its errors: `.resumator_label_error`; not seen live). */
const LABEL_ERROR = '.resumator_label_error';

const RULES: AtsConfig = {
  platform: 'jazzhr',
  snapshots: JAZZHR_SNAPSHOTS,
  parse: parseJazzhrUrl,
  root: { css: 'form#form_submit_new_resume', from: 'jazzhr-0 to -4, jr6-centroid-form' },
  questions: [
    // <div class="form-group"><label id="resumator-questionnaire-q<q>-label" for="resumator-questionnaire-q<q>"
    // class="control-label">…<i class="asterisk">*</i></label><label class="checkbox" for="resumator-checkbox-<q>-1">
    // <input type="checkbox" name="resumator-checkbox-<q>-1" class="resumator-questionnaire-checkbox">Yes</label>…
    { container: 'div.form-group:has(input.resumator-questionnaire-checkbox)', title: 'label.control-label', group: true,
      from: 'jazzhr-3, jazzhr-4' },
    // jr6 JZ-1, JZ-5: <div class="resumator-field-wrapper resumator-resume-text" id="resumator-firstname"><div
    // class="resumator-label resumator-resume-text" id="resumator-firstname-label">First name*</div><div
    // id="resumator-firstname-field" class="resumator-input"><input type="text" id="resumator-firstname-value" …>.
    { container: 'div.resumator-field-wrapper:not(.form-group *):not(#resumator-address):not(#resumator-recaptcha)',
      title: 'div.resumator-label', from: 'jr6-centroid-form' },
  ],
  // jr6 JZ-4 (see the header): the reveal is FIXPLAN §3.1 item 19, read by ENGINE's reveal door (E2).
  uploads: [{ input: '#resumator-resume-value', control: '#resumator-choose-upload', area: '#resumator-resume',
    reveal: '#resumator-choose-upload', from: 'jr6-centroid-form; Jobright 1.25.2 JazzHR operations uploadResume' }],
  submit: { css: 'form#form_submit_new_resume :is(#resumator-submit-resume, #resumator-submit-resume-button)',
    from: 'jazzhr-0 to -3, jr6-centroid-form; Jobright 1.25.2 JazzHR submission rule' },
  // v5 p2-detect: the page after submitting, in no snapshot (jazzhr/url.ts reads its address, /apply/confirm/<code>):
  // Jobright 1.25.2's rule 'jazzhr-application-received' (its ats-submission-rules), read as its behaviour: a centred
  // heading or the page's title saying the application was received (fixtures/synthetic/success/jazzhr.html).
  success: { css: 'h1.text-center, h2.page-title', text: /^Your application has been received\.$/,
    from: "Jobright 1.25.2 ats-submission-rules 'jazzhr-application-received'" },
  // v5 p1-rules (PLAN decision 9): JazzHR's CAPTCHA-required error, from Jobright 1.25.2's reading (module header).
  errors: { css: '#recaptcha-required-error', from: 'Jobright 1.25.2 submission rules (not seen live)' },
  busy: [{ css: 'div#resumator-submit:not(:has(#resumator-submit-resume))', from: 'jazzhr-4' }],
  neverPress: [
    { css: '#resumator-mobile-apply-button', from: 'jazzhr-0 to -4' },
    { css: 'a[data-test="job-board-responsive-share"]', from: 'jazzhr-0 to -4' },
    { css: '#resumator-back-button', from: 'jazzhr-0 to -4' },
    { css: '#resumator-resume-switch-paste, #resumator-resume-switch-upload', from: 'jazzhr-0 to -4' },
    // jr6 JZ-4: "Attach resume" is also the upload's reveal, pressed by the reveal door alone (uploads above).
    { css: '#resumator-choose-upload, #resumator-choose-paste, #resumator-two-stage-change-resume', from: 'jazzhr-0 to -4' },
    { css: '#tracking-consent-banner button', from: 'jazzhr-0 to -4' },
    { css: '#resumator-logo', from: 'jazzhr-0 to -4' },
  ],
  // jr6 JZ-5: "Paste resume"'s box, hidden until chosen (both layouts), is no question of the form.
  excluded: [{ css: '#resumator-resume-paste-wrapper', from: 'jazzhr-0 to -4, jr6-centroid-form' }],
  posting: { text: '#job-description', from: 'jazzhr-0 to -4' },
};

/** The hooks the rules build, for the code below to extend. */
const ruled = configuredHooks(RULES);

/** The hooks no rule can say. */
const code: Partial<ConfiguredHooks> = {
  /** jr6 JZ-10: the rules' errors (the generic aria-invalid ones and #recaptcha-required-error), and each label JazzHR
   *  marks .resumator_label_error, read as its question's container (QUESTION): it holds the question's control, which
   *  the validation's fix pass maps the error to (content/orchestrator.ts fixable), on either layout. A mark outside
   *  any question stands for itself. Only marks a person can see. */
  errors(root) {
    const own = ruled.errors?.(root) ?? [];
    const seen = new Set(own.map((error) => error.el));
    const cache = newScanCache();
    const marked: Array<{ el: Element }> = [];
    for (const mark of Array.from(root.querySelectorAll(LABEL_ERROR))) {
      if (!isUserVisible(mark, cache)) continue;
      const el = mark.closest(QUESTION) ?? mark;
      if (seen.has(el)) continue;
      seen.add(el);
      marked.push({ el });
    }
    return [...own, ...marked];
  },
};

/** JazzHR's config: the rules, and the code they cannot say. */
export const JAZZHR_CONFIG: AtsConfig = { ...RULES, code };
