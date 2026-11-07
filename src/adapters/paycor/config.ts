/*
 * Paycor Recruiting's configured adapter (DESIGN-NEW-ATS §1 "Paycor", §3), every rule read from the owner's snapshot and
 * named by it: paycor-0 (fixture paycor/regard-form; a résumé already in). One page, SubmitResume.action, built by
 * Paycor's form builder ("gnewton"):
 * - root: div.gnewtonSubmitResume, the one element holding both forms of the application: form#uploadResume (the
 *   résumé alone, "Apply with a Resume") and form#gnewtonForm (every other field and Submit); a root taken from
 *   either form alone loses the other's fields (the standard reading took form#gnewtonForm and lost the résumé);
 * - titles: the fields are label[for] with their question repeated in title (the standard reading); the comments box
 *   has no label, its question the section's dt ("Comments"); the privacy box's question is its for-less label
 *   ("Acceptance") in div.gnewtonQuestionLabelClass, the statement above it (div.gnewtonFieldClass) its help; the résumé's
 *   is its form's dt, "Apply with a Resume";
 * - required: span.gnewtonStar (an image whose alt is "*") before a title, the only mark on the résumé, whose input has
 *   class gnewtonRequired but no required attribute; every other required control says required="required";
 * - the résumé: an off-screen input#uploadResumeInput opened by label#resumeDropLocalFile "Choose a File" in the drop
 *   box #resumeDrop; the page uploads it at once, showing #resumeDropping ("Uploading...") and then #resumeDropped (the
 *   file's bar, shown in the snapshot), or #fileUploadErrorMessage for a file too large;
 * - Submit: button[ns-qa="submitBtn"] in form#gnewtonForm; its #submitSpinner, and #resumeDropping, are the page busy;
 * - never pressed: "Clear All Fields", Google Drive, Dropbox, the résumé's "remove", "Go back to the job list", the
 *   duplicate-application popover's buttons and the logo link.
 * The honeypot fax_number (div.nt-aux-contact, aria-hidden) is never a field. Not in the snapshot: field errors after
 * Submit, the page after submitting, the posting's description page, the form builder's other sections (attachments,
 * questions, text-message opt-in, EEO, GDPR: empty slots here), and whether the duplicate popover shows before Submit.
 * The State select's options are two-letter codes as their words, with no blank option.
 */
import type { AtsConfig } from '../configured/types';
import { parsePaycorUrl } from './url';

/** The fixture cases the rules were read from (fixtures/paycor/<case>.html). */
export const PAYCOR_SNAPSHOTS = ['regard-form'] as const;

export const PAYCOR_CONFIG: AtsConfig = {
  platform: 'paycor',
  snapshots: PAYCOR_SNAPSHOTS,
  parse: parsePaycorUrl,
  root: { css: 'div.gnewtonSubmitResume', holds: 'form#gnewtonForm', from: 'paycor-0' },
  questions: [
    // <form id="uploadResume" class="gnewtonSectionClass"><input id="uploadResumeInput" type="file" style="position:
    // absolute;left:-1000000em;"><dl><dt class="gnewtonSectionTitleClass"><span class="gnewtonStar …"><img alt="*">
    // </span>Apply with a Resume</dt>…
    { container: 'form#uploadResume', title: 'dt.gnewtonSectionTitleClass', from: 'paycor-0' },
    // <dl><dt class="gnewtonSectionTitleClass">Comments</dt><dd><div class="gnewtonQuestionInputClass"><textarea
    // id="originalComments">; <dd><div class="gnewtonFieldClass">By checking this box, …</div><div
    // class="gnewtonQuestionLabelClass"><span class="gnewtonStar">…</span><label>Acceptance</label></div><div
    // class="gnewtonQuestionInputClass"><div><input type="checkbox" name="ccpaDisclaimerAgree"> I have read and agree …
    { container: 'dd:has(> div.gnewtonQuestionInputClass)', title: 'div.gnewtonQuestionLabelClass > label',
      titleBefore: 'dt.gnewtonSectionTitleClass', help: 'div.gnewtonFieldClass', from: 'paycor-0' },
  ],
  required: [{ mark: 'span.gnewtonStar', from: 'paycor-0' }],
  uploads: [{ input: 'input#uploadResumeInput[type="file"]', control: 'label#resumeDropLocalFile',
    area: 'div#gnewtonCareerBody', done: '#resumeDropped', pending: '#resumeDropping', failed: '#fileUploadErrorMessage',
    // The behaviour review of 2026-11-06 (M2), paycor-0: <div id="resumeDropped"><div class="bar"><span
    // class="filename">(the file's name)</span><a class="closeBtn" ...>remove</a>. The area stays div#gnewtonCareerBody:
    // the failure message, div#fileUploadErrorMessage, is its child beside the upload's own form#uploadResume.
    name: 'span.filename', from: 'paycor-0' }],
  submit: { css: 'button[ns-qa="submitBtn"]', from: 'paycor-0' },
  busy: [{ css: '#submitSpinner', from: 'paycor-0' }, { css: '#resumeDropping', from: 'paycor-0' }],
  neverPress: [
    { css: 'div.button.newtonStoreReset', from: 'paycor-0' },
    { css: '#google_drive_button, #dropbox_button', from: 'paycor-0' },
    { css: '#resumeDropped a.closeBtn', from: 'paycor-0' },
    { css: '#gnewtonBackToHome a', from: 'paycor-0' },
    { css: '.ns-popover-go-to-job, .ns-popover-cancel-button', from: 'paycor-0' },
    { css: '#gnewtonLogo a', from: 'paycor-0' },
  ],
};
