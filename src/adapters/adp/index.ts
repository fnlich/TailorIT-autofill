/*
 * The ADP Workforce Now adapter (DESIGN-NEW-ATS §1 "ADP Workforce Now", §5 builder A): a full adapter over the
 * configured layer's hooks (configuredHooks), read from the owner's seven snapshots of 2026-11-06 (adp-0 to adp-6, one
 * application to one posting), converted as fixtures/adp/*.html. Every rule names the snapshot it was read from:
 * adp-6 guest.html (the guest identity page), adp-0 code-dialog.html (the emailed-code dialog over it), adp-1
 * personal.html (step 1, Personal Information), adp-2 questions.html (step 3), adp-3 self-id.html (step 4, Voluntary
 * Self-ID) and adp-4 self-attest.html (step 6, Self-Attest & Submit; adp-5 is the same step in another load and
 * converts to the same file but for a list's position). Steps 2 (Resume) and 5 (Review your application), the posting
 * and the confirmation are in no snapshot: they get the standard rules, and no success sign is read.
 * - Page states (ADP_CONFIG.states), first the one a person can see:
 *   - the code dialog (sdf-focus-pane#login_view_show_opt_dialog with input#oneTimePassWord, adp-0): 'email-code', a
 *     pause: the code is mailed to the person and is theirs to type; nothing is filled or pressed, Verify and Resend
 *     Code never;
 *   - the guest identity page (div.guest-login-container, adp-6): First Name, Last Name, Email and Mobile Number,
 *     filled from the profile like a step; its Continue (sdf-button#recruitment_login_recaptcha, which mails the code)
 *     is never pressed by a run's Next or Submit: the step is final 'unknown'. It follows Sign-in mode (the snapshot
 *     build of 2026-11-06, core pass Z1 item 24): the guest container is the state's declared sign-in container, so
 *     Sign-in Auto presses Continue once the page is filled and rests, through its door and every guard; Manual leaves
 *     it to the person. Its g-recaptcha class is the invisible reCAPTCHA's binding, no drawn challenge (item 20);
 *   - otherwise the wizard, its root #jobApplicationSubmit (adp-1 to adp-5) holding the step body.
 * - Steps: one address for every step (adp-1 to adp-5), so the step is the header item marked aria-current="true" (its
 *   span.mdf-segmented-wizard-header-item-text) and the step body's marker. Next is button#ja_sv_cw_next_footer_btn,
 *   Submit button#submitApplication, shown only on the last step, where Next is not (adp-4); Previous, Finish later,
 *   the Exit icon and the header items (clickable from adp-3 on) are never pressed.
 * - Labels (labelFor): a question's label.qLabel in its div.qMainDiv for the drawn Yes/No groups whose for= names
 *   nothing (adp-2); the Self-ID groups' h4 heading that reads as the group's own label attribute (adp-3); the
 *   referral question's span#employeeRefferalIndicator (adp-2); the phone's label in the div.mdf-label before its
 *   role=group (adp-6, adp-1: both phones' own aria-label is "Phone Number"); the guest page's labels with no for=
 *   (adp-6); the preferred-name box's span beside it (adp-1); the e-signature's label.required (adp-4).
 * - Required (requiredFor): the label's class required-indicator (adp-6, Mobile Number has no aria-required) or
 *   required (adp-4); a star inside the label (span.mdf-required-indicator, adp-1, adp-2) is read from the label's text.
 * - Widgets: react-select (MDFSelectBox, adp-1 Country, adp-2 question_2 and the currency, adp-3 Gender, Ethnicity and
 *   Race), its box div.MDFSelectBox__control (its text box is drawn at opacity 0 once it shows an answer, adp-3), its
 *   answer div.MDFSelectBox__single-value, a multi-select by MDFSelectBox__value-container--is-multi (question_2), chosen
 *   through the page-world bridge ('react-select'): no snapshot shows a list open, so the fallback is standard ARIA.
 *   The drawn Yes/No groups (sdf-radio-group > div[role=radiogroup] > sdf-radio-button[role=radio], adp-2, adp-3) are
 *   standard ARIA radio groups. The referral question's options (wfn-radio-button, adp-2) hold their role=radio in a
 *   shadow root: those radios are its members (core pass Z2 of 2026-11-06: the scanner keeps a declared member across
 *   open shadow roots), so the choice is read back from their aria-checked.
 * - The e-signature (adp-4): its typed name is labelled with the words "electronic signature" after the page's
 *   "Please type your full name." (labelSuffix), from its own markup (span.self-review-signature, the box beside it
 *   "Yes, I agree to sign electronically."), so it is classified as the signature consent (resolver/labelRules.ts), a
 *   person's pre-approval or their own typing, never a profile name typed unasked; the box is consent the person ticks.
 * - Checkboxes (.vdl-checkbox > input, adp-1, adp-3, adp-4) are drawn hidden; each stands behind its label[for], an
 *   empty one (the preferred-name box) by the same label (proxies).
 * - Never pressed (neverPress): Verify, Resend Code, Sign In, the social sign-ins, Join Our Talent Community,
 *   Finish later, Exit, the header items, the cookie banner's buttons, "...More" and the help buttons.
 * jr6 (FIXPLAN §6.6, BUILD.md §4 E-ADP; the owner's captures of 2026-11-10, snapshot6 adp1 and adp2, converted as
 * fixtures/adp/jr6-*.html, ADP_JR6_SNAPSHOTS) adds what those captures show and the 2026-11-06 ones did not:
 * - The job details (jr6-posting): the posting's text (div.job-description-data, also on the signed-in landing,
 *   jr6-landing) and its entry, the header's Apply (button#recruitment_jobDescription_apply; the bottom bar's
 *   #recruitment_jobDescription_candidateApply where a page draws it), never by the word "Apply" (OneTrust's filter
 *   dialog has its own hidden "Apply", button#filter-apply-handler, never pressed). Back is never pressed.
 * - The "Privacy Policy" pane after Apply (jr6-consent, sdf-focus-pane#jdv_privacy_dailog): an 'entry-choice' state
 *   whose entry is the pane's primary custom button, "Consent & Continue" (APPLYPLAN OQ2, default yes); its secondary
 *   button, "Decline & Close", is never pressed. Both buttons carry id="undefined": they are named by slot, emphasis
 *   and words.
 * - "Get your verification code" over the guest page (jr6-guest-send-code, sdf-focus-pane#login_view_identifier_dialog):
 *   the person's 'email-code' pause (ADP-11's minimum, apply-path B7); its Send and its Close are never pressed.
 * - The guest view, the pane and the code are drawn in place at the details' one address (apply-path B4): quirks
 *   entryPresses 2 (Apply, then Consent & Continue), formLateMs 20 s and formInPlace.
 * - The Resume step (jr6-resume-*, ADP-1): the résumé and the attachments as uploads (Jobright's ADP operations
 *   getResumeUploadDom read for the controls and the done row); ADP takes the résumé's file input out of the page once
 *   it holds the file, so its upload is confirmed by the row that names the file (uploadState).
 * - ADP's own lists (ADP-2, ADP-3, ADP-15): wfn-dropdown-list (the State once Country is chosen, jr6-personal-us-*) and
 *   sdf-select-simple (the Questions step's source list and the salary currency, jr6-questions2-*), declared comboboxes
 *   whose trigger, list and chosen label sit in shadow roots, their filter box a part (Jobright's ADP operations read the
 *   same trigger and sdf-select-item options).
 * - Errors (adp-new-1): the address block's message, ADP's error labels and the State list's error mark; the
 *   aria-invalid ADP sets on some questions when the page loads is no error until a message shows.
 * - The page after Submit (ADP-6, jr6-confirmation, jr6-confirmation-2): Jobright's ats-submission-rules entry
 *   adp-workforcenow, read while the BrightJump promo's focus trap hides the page (SuccessRule.underModal).
 * - The start-date picker's layout (ADP-8) and the desired salary's pay basis group's label (ADP-16).
 * jr7 (FIX7PLAN §6.9; the owner's snapshot7 adp1 of 2026-11-11, one application from its posting to its confirmation,
 * converted as fixtures/adp/jr7-adp1-*.html, ADP_JR7_SNAPSHOTS) adds:
 * - ADP7-2 (adapter half): Address Line 1, read-only while ADP's address lookup starts, is decided again after the
 *   Country's write (dependsOn), as the State is.
 * - ADP7-10 (owner question Q7-14, default yes): the signed-in landing's "Complete Your Application" is an entry, one
 *   press, which resumes the person's own unfinished application.
 * - ADP7-13: a question's number and sum boxes are laid out as one number (formatFor).
 * ADP stays out of Run auto-apply (ADP7-1): every guest application needs a one-time code the person receives.
 * Nothing here reads, logs or sends a value.
 */
import type { FieldFormat } from '../../core/enums';
import { newScanCache } from '../../dom/scan-cache';
import { TEXT_CAP_LABEL } from '../../dom/thresholds';
import { visibleText } from '../../dom/visible-text';
import { isUserVisible } from '../../dom/visibility';
import { configuredHooks } from '../configured';
import type { AtsConfig, UploadRule } from '../configured/types';
import { genericAdapter } from '../generic';
import type { Adapter, UploadState, WidgetDecl } from '../types';
import { canonicalApplicationUrl, matchesUrl, parseAdpUrl } from './url';

/** The fixtures the adapter was read from (fixtures/adp/<case>.html), by snapshot. */
export const ADP_SNAPSHOTS = ['fixtures/adp/guest.html', 'fixtures/adp/code-dialog.html', 'fixtures/adp/personal.html',
  'fixtures/adp/questions.html', 'fixtures/adp/self-id.html', 'fixtures/adp/self-attest.html'] as const;

/** jr6: the owner's captures of 2026-11-10 (snapshot6 adp1 and adp2), as fixtures/adp/<case>.html, each a page the jr6
 *  rules were read from (the module header). */
export const ADP_JR6_SNAPSHOTS = ['jr6-posting', 'jr6-consent', 'jr6-guest-blank', 'jr6-guest-send-code',
  'jr6-code-dialog', 'jr6-landing', 'jr6-personal-blank', 'jr6-personal-us-errors', 'jr6-personal-us-state',
  'jr6-personal-filled', 'jr6-resume-choice', 'jr6-resume-blank', 'jr6-resume-uploaded', 'jr6-questions-filled',
  'jr6-questions2-blank', 'jr6-questions2-filled', 'jr6-self-id-blank', 'jr6-self-id-filled', 'jr6-review',
  'jr6-self-attest-blank', 'jr6-self-attest-signed', 'jr6-confirmation', 'jr6-confirmation-2']
  .map((name) => `fixtures/adp/${name}.html`);

/** jr7: the owner's captures of 2026-11-11 (snapshot7 adp1), as fixtures/adp/<case>.html, in the order they were taken
 *  (the module header). */
export const ADP_JR7_SNAPSHOTS = ['posting', 'posting-2', 'consent', 'guest', 'code-choice', 'code-choice-2', 'code',
  'personal-blank', 'personal-filled', 'resume', 'questions-filled', 'review', 'self-attest-blank', 'self-attest-ticked',
  'self-attest-signed', 'confirmation'].map((step) => `fixtures/adp/jr7-adp1-${step}.html`);

// ── jr6 ADP P1 (FIXPLAN §6.6, BUILD.md §4 E-ADP) ──
/** jr6-consent: the "Privacy Policy" pane after Apply. */
const PRIVACY_PANE = 'sdf-focus-pane#jdv_privacy_dailog';
/** jr6-guest-send-code: the "Get your verification code" pane over the guest page. */
const CODE_CHOICE_PANE = 'sdf-focus-pane#login_view_identifier_dialog';
/** ADP's own lists (ADP-2, ADP-3): the State's wfn-dropdown-list (an sdf-select-simple in its shadow root) and the
 *  Questions step's sdf-select-simple. */
const SELECT_HOSTS = 'wfn-dropdown-list, sdf-select-simple';
// ── end jr6 ADP P1 ──

/** A react-select's text box (adp-1, adp-2, adp-3). */
const SELECT_INPUT = 'input.MDFSelectBox__input[role="combobox" i]';
/** The referral question's options (adp-2). */
const REFERRAL_OPTIONS = '#refferalOptions';
/** The e-signature's text box (adp-4). */
const SIGNATURE = 'input#electronicSignature';

/** The rules the configured layer builds hooks from, each naming its snapshot. */
export const ADP_CONFIG: AtsConfig = {
  platform: 'adp',
  snapshots: ['guest', 'code-dialog', 'personal', 'questions', 'self-id', 'self-attest',
    ...[...ADP_JR6_SNAPSHOTS, ...ADP_JR7_SNAPSHOTS].map((path) => path.replace(/^fixtures\/adp\/|\.html$/g, ''))],
  parse: parseAdpUrl,
  matchesUrl,
  states: [
    // adp-0: <sdf-focus-pane id="login_view_show_opt_dialog" heading="Enter the Verification Code" ...> ... <div
    // class="componentBottomSpace button-align-center otpDialogContent"> ... <input id="oneTimePassWord"
    // aria-label="Enter the Verification Code" aria-required="true" ... type="text">: the dialog's content is the
    // state's root, so this adapter (not the generic one) holds the page, and its pause is the person's.
    { name: 'code', when: 'sdf-focus-pane#login_view_show_opt_dialog input#oneTimePassWord', auth: 'email-code',
      root: 'sdf-focus-pane#login_view_show_opt_dialog div.otpDialogContent', from: 'adp-0' },
    // jr6 ADP-11 (minimum) and apply-path B7, jr6-guest-send-code: <sdf-focus-pane id="login_view_identifier_dialog"
    // heading="Get your verification code" data-sdf-modal=""> ... <label class="otpInstructionText ...">Where would you
    // like to receive a verification code?</label> ... <wfn-radio-button id="phoneIdentifierId" value="CELL_PHONE">,
    // <wfn-radio-button id="emailIdentifierId" value="EMAIL"> ... <sdf-button id="recruitment_login_guestLogin" ...
    // aria-label="Send">: where the code goes and its Send are the person's (a code is sent), so the page is the
    // person's 'email-code' pause: nothing is filled or pressed. While it shows, the guest page behind it is hidden by
    // the pane's focus trap, so the guest state below never reads under it.
    { name: 'code-choice', when: CODE_CHOICE_PANE, auth: 'email-code', from: 'jr6-guest-send-code' },
    // jr6 apply-path B3 (APPLYPLAN OQ2, default yes; BUILD.md §4), jr6-consent: <sdf-focus-pane id="jdv_privacy_dailog"
    // heading="Privacy Policy" data-sdf-modal=""> ... <div slot="custom-buttons"><sdf-button id="undefined" ...
    // slot="custom-buttons" emphasis="primary" aria-label="Consent & Continue">, <sdf-button id="undefined" ...
    // emphasis="secondary" aria-label="Decline & Close">: drawn over the job details after Apply. Its entry, for the
    // agent's entry door alone (after Apply, quirks.entryPresses), is the pane's primary custom button, cross-checked by
    // its words, since both buttons share one id; "Decline & Close" is never pressed (neverPress).
    { name: 'consent', when: PRIVACY_PANE, auth: 'entry-choice',
      entry: `${PRIVACY_PANE} sdf-button[slot="custom-buttons"][emphasis="primary"][aria-label="Consent & Continue" i]`,
      from: 'jr6-consent' },
    // adp-6: <div class="guest-login-container"><div class="banner">Tell us about yourself.</div> ... <div
    // class="login-form-container" data-isguestapply="true" ...> (behind the dialog's aria-hidden in adp-0).
    { name: 'guest', when: 'div.guest-login-container', root: 'div.guest-login-container',
      // Core pass Z1, item 24: its Continue (adp-6: <sdf-button id="recruitment_login_recaptcha" class="g-recaptcha ..."
      // role="button" aria-label="Continue">, inside the container, no <form> on the page) mails the code: it follows
      // Sign-in mode (Auto presses it once the page is filled; Manual leaves it to the person). Sign-in Auto types
      // nothing there: the names, the email and the mobile number are the step's own fields, filled from the profile.
      signInContainer: { container: 'div.guest-login-container',
        button: 'div.guest-login-container sdf-button#recruitment_login_recaptcha[role="button" i]' },
      from: 'adp-6' },
  ],
  // adp-1 to adp-5: <div id="jobApplicationSubmit" class="job-application-submit"> ... <div
  // class="mdf-custom-wizard-steps"><div class="mdf-custom-wizard-step"> ... <div class="mdf-custom-wizard-footer">.
  root: { css: '#jobApplicationSubmit', holds: 'div.mdf-custom-wizard-step', from: 'adp-1, adp-2, adp-3, adp-4' },
  proxies: [
    // adp-1: <div class="vdl-checkbox" id="usePreferredName" ...><input id="checkbox_..." type="checkbox"
    // name="usePreferredName" ...><label for="checkbox_..." class=""></label></div>: an empty label drawn as the box.
    { input: 'div.vdl-checkbox > input[type="checkbox" i]', proxy: 'label', scope: 'div.vdl-checkbox', from: 'adp-1' },
  ],
  steps: {
    // adp-1: <div class="mdf-segmented-wizard-header-item mdf-segmented-wizard-header-visited-item ..."
    // aria-current="true" role="listitem" tabindex="0"> ... <span class="mdf-segmented-wizard-header-item-text">Personal
    // Information</span>; the others aria-current="false".
    heading: '#jobApplicationSubmit .mdf-segmented-wizard-header-item[aria-current="true"] .mdf-segmented-wizard-header-item-text',
    // Each step body's own container (adp-1 personal, adp-2 questions, adp-3 self-ID, adp-4 self-attest).
    anchors: [{ css: '#jobApplicationSubmit div.personal-step-main-container' },
      { css: '#jobApplicationSubmit div.questions-main-container' },
      { css: '#jobApplicationSubmit div.applicationvsid-main-container' },
      { css: '#jobApplicationSubmit div#selfReviewView' }],
    // adp-1: <button id="ja_sv_cw_next_footer_btn" type="button" class="... wizard-next-button ...">Next<i ...>.
    next: 'button#ja_sv_cw_next_footer_btn',
    // adp-2: <button id="ja_sv_cw_prev_footer_btn" type="button" ...>Previous</button>.
    back: 'button#ja_sv_cw_prev_footer_btn',
    from: 'adp-1, adp-2, adp-3, adp-4',
  },
  // adp-4, adp-5: <button id="submitApplication" type="button" class="... wizard-submit-button ...">Submit</button>.
  submit: { css: 'button#submitApplication', from: 'adp-4' },
  neverPress: [
    // adp-6, adp-0: the social sign-ins and Join Our Talent Community. Continue (it mails the code) is the guest state's
    // sign-in container's button (core pass Z1, item 24), pressed by Sign-in Auto's door alone.
    { css: 'sdf-button#recruitment_login_signInWithLinkedIn, sdf-button#recruitment_login_signInWithGoogle, '
      + 'sdf-button#recruitment_login_signInWithFaceBook', from: 'adp-6' },
    { css: 'sdf-button#recruitment_header_joinTalentCommunity', from: 'adp-6' },
    // The left nav's host, whose shadow root holds Sign In, Career Center and Current Openings (adp-6).
    { css: 'sfc-shell-left-nav-flat#recruitmentLeftNav', from: 'adp-6' },
    // adp-0: <button id="recruitment_login_verifyOTP" ...>Verify</button>, <button id="recruitment_login_resendOTP"
    // ...>Resend Code</button>.
    { css: 'button#recruitment_login_verifyOTP, button#recruitment_login_resendOTP', from: 'adp-0' },
    // adp-2: <button id="finishLaterApplication" ...>Finish later </button>; adp-1: <div class="job-application-exit-button"
    // id="ja_sv_exit_btn">; the header items (role=listitem), clickable from adp-3 on.
    { css: 'button#finishLaterApplication', from: 'adp-2' },
    { css: '#ja_sv_exit_btn', from: 'adp-1' },
    { css: '.mdf-segmented-wizard-header-item', from: 'adp-3' },
    // adp-6: the cookie banner's settings button and its preference centre's buttons.
    { css: 'sdf-button#ot-sdk-btn, button#accept-recommended-btn-handler, button.save-preference-btn-handler',
      from: 'adp-6' },
    // adp-4: "...More" (the acknowledgement); adp-3: "Why are we asking?", "What Is A Protected Veteran?", the help icons.
    { css: '#selfReviewView .more-label button', from: 'adp-4' },
    { css: 'sdf-button#vsidWhy, sdf-button#vsidWhyAreWe, sdf-button#vsidVet, sdf-icon-button[label="Help Information"], '
      + '.raceHelp-icon [role="button"]', from: 'adp-3' },
    // ── jr6 ADP P1 (BUILD.md §4 E-ADP neverPress) ──
    // jr6-guest-blank: OneTrust's vendor filter, <section id="ot-fltr-modal"> ... <button id="filter-apply-handler">Apply
    // </button> (hidden): its "Apply" is never the posting's entry, and never pressed.
    { css: 'button#filter-apply-handler, section#ot-fltr-modal', from: 'jr6-guest-blank' },
    // jr6-consent: the Privacy Policy pane's "Decline & Close" (see the consent state).
    { css: `${PRIVACY_PANE} sdf-button[slot="custom-buttons"][emphasis="secondary"]`, from: 'jr6-consent' },
    // jr6-guest-send-code: the code-choice pane's Send (see the code-choice state); its Close sits in the pane's shadow
    // root, out of a selector's reach, and is added by the adapter's neverPress below.
    { css: 'sdf-button#recruitment_login_guestLogin', from: 'jr6-guest-send-code' },
    // jr6-posting: <button id="recruitment_jobDescription_back" type="button" class="job-description-apply vdl-button
    // vdl-button--secondary">, Back beside the details' entry.
    { css: 'button#recruitment_jobDescription_back', from: 'jr6-posting' },
    // ── end jr6 ADP P1 ──
  ],
  // ── jr6 ADP-1 (high): the Resume step (jr6-resume-blank, jr6-resume-choice, jr6-resume-uploaded) ──
  // Jobright's ADP operations (getResumeUploadDom, getCoverLetterUploadDom) read the same controls: the résumé's
  // #resumeUploadContainer with its input[type=file][name=file] and its sdf-button "Upload resume" (id^="fileUpload-"),
  // done once a .fileDetails .fileName or its recruitment_afterResumeUpload_remove_ button shows.
  uploads: [
    // jr6-resume-blank: <div id="resumeUploadContainer" class="resume-upload-container"> ... <span
    // class="resume-required-indicator">Required</span> ... <sdf-button id="fileUpload-<uuid>" ... aria-label="Drag and
    // drop file or Upload resume. ...">Upload resume</sdf-button> ... <input type="file" name="file" style="display:
    // none;">; jr6-resume-uploaded: the input gone, <div class="fileDetails"><i class="fa fa-file-text ..."></i><span
    // class="fileName">NAME</span><button id="recruitment_afterResumeUpload_remove_0" ... aria-label="Remove,NAME,Resume">
    // (the converter redacts NAME).
    { input: '#resumeUploadContainer input[type="file" i][name="file"]',
      control: '#resumeUploadContainer sdf-button[id^="fileUpload-"]', area: '#resumeUploadContainer',
      done: '.fileDetails .fileName, button[id^="recruitment_afterResumeUpload_remove_"]', name: '.fileDetails .fileName',
      from: 'jr6-resume-blank, jr6-resume-uploaded' },
    // jr6-resume-blank: <div class="additional-documents-container mt-2"><h3>Attachments</h3> ... <sdf-button
    // id="fileUpload-<uuid>" ...>Upload attachments</sdf-button> ... <input type="file" name="file" style="display:
    // none;">; its done row (Jobright's getCoverLetterUploadDom) once a document is added.
    { input: '.additional-documents-container input[type="file" i][name="file"]',
      control: '.additional-documents-container sdf-button[id^="fileUpload-"]', area: '.additional-documents-container',
      done: '.additional-document-result .fileName, button[id^="recruitment_afterAdditionalDocumentsUpload_remove_"]',
      from: 'jr6-resume-blank' },
  ],
  // adp-2: <label class="vdl-validation-error error-color" role="alert"> after an aria-invalid box; adp-6: <wfn-text
  // id="firstNameErrLbl" role="alert" class="experience-vdl-error-label hydrated">; adp-2, adp-3: <div
  // id="sdf-radio-group-<n>-errorMessage">. Empty in every snapshot: an error counts only while a person sees it.
  // jr6 adp-new-1 (jr6-personal-us-errors, jr6-personal-us-state, after a refused Next): <h4 id="addressErrorMessage"
  // class="label-error" role="alert">Correct the information in highlighted fields.</h4>; the labels ADP rewrites,
  // <label class="mdf-label-error" for="PersonalAddress_city">City is required</label> (the State's <label
  // id="mdfstatelabel-<uuid>" class="mdf-label-error">); the State's <wfn-dropdown-list ... class="vdl-validation-error
  // ...">. The adapter's errors (below) give each its field's control id as the hint.
  errors: { css: 'label.vdl-validation-error, .experience-vdl-error-label[role="alert" i], '
    + '[id^="sdf-radio-group-"][id$="-errorMessage"], div.self-review-signature-required, '
    + 'h4#addressErrorMessage[role="alert" i], label.mdf-label-error, wfn-dropdown-list.vdl-validation-error',
  from: 'adp-2, jr6-personal-us-errors' },
  // adp-6: <div id="recPageLoadWaitingIndicator" ... style="display: none">, the page's busy overlay.
  busy: [{ css: '#recPageLoadWaitingIndicator', from: 'adp-6' }],
  // ── jr6 ADP-6 (medium): the page after Submit ──
  // Jobright's ats-submission-rules entry adp-workforcenow (its sign, its words and its "Thank You!" companion), seen
  // on jr6-confirmation and jr6-confirmation-2: <div id="vdlContainerFluid" class="vdl-container-fluid success-card">
  // ... <div class="success-message-container flex-text-center" role="alert"><i class="fa fa-3x fa-thumbs-o-up"></i>
  // <span class="message-header">Thank You!</span><p class="message">We have received your application.</p>. On both,
  // the BrightJump promo (<sdf-focus-pane id="brj_opt_in_slidein" heading="ADP BrightJump" data-sdf-modal="">) is open
  // and its focus trap has set aria-hidden (with data-old-aria-hidden) on the page around the sign: underModal.
  success: { css: '#vdlContainerFluid.success-card .success-message-container p.message',
    text: /^(?:Thank You! )?We have received your application\.?$/i,
    companion: { css: '.success-message-container span.message-header', text: /^Thank You!?$/i },
    underModal: 'sdf-focus-pane[data-sdf-modal]',
    from: 'jr6-confirmation, jr6-confirmation-2; Jobright ats-submission-rules adp-workforcenow' },
  // ── jr6 ADP-10 (adapter part) and E-ADP (BUILD.md §4; apply-path B2): the job details ──
  // jr6-posting: <div class="job-description-data"> (the description; Jobright's job-card rule ADP2 reads its
  // div.job-description-data-item) and, in the details' header, <button id="recruitment_jobDescription_apply"
  // type="button" class="job-description-apply-item vdl-button vdl-button--primary">Apply</button> (the bottom bar's
  // button#recruitment_jobDescription_candidateApply where a page draws it). Named by id, never by the word "Apply".
  // jr7 ADP7-10 (FIX7PLAN §6.9 item 3; owner question Q7-14, default yes; jr6 ADP open issue 1): the signed-in landing
  // a person reaches when they resume their own unfinished application to the same posting (jr6-landing, at
  // postLogin.html, the same cid and jobId as that application's 2026-11-06 captures; snapshot7's new application goes
  // straight from the code to Personal Information): <button id="recruitment_jobDescription_complete" type="button"
  // class="job-description-apply vdl-button vdl-button--primary"><span class="vdl-button__container">Complete Your
  // Application</span></button>, beside Back. One press, no consent pane after it, by id. Jobright has no code for it
  // (jr6 J-ADP-8).
  posting: { text: 'div.job-description-data',
    entry: 'button#recruitment_jobDescription_apply, button#recruitment_jobDescription_candidateApply, '
      + 'button#recruitment_jobDescription_complete',
    from: 'jr6-posting, jr6-landing' },
  // jr6 E-ADP (BUILD.md §4; apply-path B2, B3, B4): Apply draws the Privacy Policy pane in place, whose Consent &
  // Continue is the second entry press; the guest view is then drawn in place at the same address, up to 20 s later,
  // at any time the person presses them too (formInPlace).
  quirks: { entryPresses: 2, formLateMs: 20_000, formInPlace: true },
};

/** The visible text of an element on one line. */
const textOf = (el: Element) => visibleText(el, { singleLine: true, cap: TEXT_CAP_LABEL, cache: newScanCache() });

/** Node.DOCUMENT_POSITION_FOLLOWING, without reaching for a page global. */
const FOLLOWING = 4;

/** The visible label in the div.mdf-label just before `el` (adp-6: <div class="mdf-label ..."><label
 *  class="personal-step-phoneHeader required-indicator">First Name</label></div><input id="guestFirstName" ...>; the
 *  phones' <div class="mdf-label ..."><label id="validated_label_mobile">Mobile Number<span
 *  class="mdf-required-indicator">*</span></label></div><div role="group" aria-labelledby="validated_label_mobile">,
 *  adp-1, whose id an empty span#validated_label_mobile before it also holds). */
function labelBefore(el: Element): Element | null {
  const before = el.previousElementSibling;
  return before !== null && before.matches('div.mdf-label') ? before.querySelector('label') : null;
}

/** A drawn Yes/No group's question (see the header). */
function groupTitle(group: Element): Element | null {
  // adp-2: <div class="qMainDiv"><div class="question-label-container"><label class="qLabel" for="question_0"><wfn-text
  // class="hydrated">Are you legally authorized to work in the USA?<span class="mdf-required-indicator ">*</span>
  // </wfn-text></label></div> ... <sdf-radio-group label="Are you legally authorized ..." ...> ... <div
  // class="direction-row" role="radiogroup" aria-labelledby="sdf-radio-group-1-label" ...>: the labelledby target is
  // the sr-only span, and no element has the id question_0.
  const question = group.closest('div.qMainDiv');
  if (question !== null) {
    // jr6 ADP-16 (jr6-questions2-blank): the desired salary's block, <div id="desiredEmplSalaryBlock"
    // class="additional-question qMainDiv"><div id="additionalInfoEmplCard"><div class="additional-info-card"><span
    // id="desiredSalaryLabel" class="question-label-container qLabel">What is your desired salary?</span></div><div
    // id="salaryOptions" ...><sdf-radio-group label="What is your desired salary?" ...>: no label.qLabel, the title is
    // the block's own span.qLabel (one that does not hold the group).
    const label = question.querySelector('.question-label-container > label.qLabel');
    if (label !== null) return label;
    return Array.from(question.querySelectorAll('span.qLabel')).find((span) => !span.contains(group)) ?? null;
  }
  // adp-3: <h4>Protected Veteran Status</h4> ... <sdf-radio-group label="Protected Veteran Status" ...>; <h4
  // id="vsidDis">Disability Status</h4> ... <sdf-radio-group label="Disability Status" ...>: the heading before the
  // group that reads as its label attribute.
  const host = group.closest('sdf-radio-group');
  const step = group.closest('div.mdf-custom-wizard-step');
  const wanted = (host?.getAttribute('label') ?? '').replace(/\s+/g, ' ').trim();
  if (host === null || step === null || wanted === '') return null;
  const headings = Array.from(step.querySelectorAll('h4'))
    .filter((heading) => (heading.compareDocumentPosition(host) & FOLLOWING) !== 0);
  const last = headings[headings.length - 1];
  return last !== undefined && textOf(last) === wanted ? last : null;
}

/** The question each control the page does not tie to its label answers (see the header), or null. */
function labelFor(control: Element): Element | null {
  if (control.matches('div[role="radiogroup" i]') && control.parentElement?.closest('sdf-radio-group') !== null) {
    return groupTitle(control);
  }
  // adp-2: <div id="employeeRefferalBlock" ...><div class="additional-info-card"><span id="employeeRefferalIndicator"
  // class="question-label-container qLabel ">Did any of our employees inform you about this position?</span></div><div
  // id="refferalOptions" ...><wfn-radio-button ... id="yes" value="Yes">...Yes</wfn-radio-button> ...
  if (control.matches(REFERRAL_OPTIONS)) return control.ownerDocument.getElementById('employeeRefferalIndicator');
  // adp-6, adp-1: <input type="tel" ... data-testid="phone-input" placeholder="Phone Number" ... class="PhoneInputInput">
  // inside <div role="group" ...>, the label in the div.mdf-label before the group.
  if (control.matches('input.PhoneInputInput')) {
    const group = control.closest('div[role="group" i]');
    return group === null ? null : labelBefore(group);
  }
  // adp-1: <div class="flex flex-row"><div class="mdf-validated-field "><div><div class="vdl-checkbox"
  // id="usePreferredName" ...><input ... name="usePreferredName" ...><label for="checkbox_..."></label></div></div>
  // ...</div><span>I have a preferred or chosen name</span></div>.
  if (control.matches('input[type="checkbox" i][name="usePreferredName"]')) {
    return control.closest('div.flex.flex-row')?.querySelector(':scope > span') ?? null;
  }
  // adp-4: <div class="self-review-signature-label"><label class="required">Please type your full name.</label><input
  // id="electronicSignature" aria-label="Please type your full name." aria-required="true" ...>.
  if (control.matches(SIGNATURE)) {
    const label = control.previousElementSibling;
    return label !== null && label.matches('label.required') ? label : null;
  }
  // adp-6: the guest page's labels, none with a for=.
  if (control.closest('div.login-form-container') !== null) return labelBefore(control);
  // jr6 ADP-3 (jr6-questions2-blank): <div class="qMainDiv"><div class="question-label-container"><label class="qLabel"
  // for="question_7"><wfn-text ...>How did you learn about this position?<span class="mdf-required-indicator">*</span>
  // </wfn-text></label></div> ... <sdf-select-simple id="question_7" ...>: a custom element no label[for] reaches.
  if (control.matches('sdf-select-simple[id]')) {
    const question = control.closest('div.qMainDiv');
    return question === null ? null
      : Array.from(question.querySelectorAll('label.qLabel')).find((label) => label.getAttribute('for') === control.id) ?? null;
  }
  // jr6 ADP-1: a file input of the Resume step, titled by its block's h3 (uploadTitle).
  if (control.matches('input[type="file" i]')) return uploadTitle(control);
  return null;
}

/** jr6 ADP-1: the h3 that titles an upload of the Resume step (jr6-resume-blank): the Attachments' own, <div
 *  class="upload-resume-container"><div class="additional-documents-container mt-2"><h3>Attachments</h3>...; the
 *  résumé's sits in the block before its #resumeUploadContainer, <div class="upload-resume-wrapper"><div
 *  class="upload-resume-container"><h3>Resume</h3><div class="upload-resume-type-question">..., the nearest such title
 *  before it in the step's div.upload-resume-view. */
function uploadTitle(input: Element): Element | null {
  const container = input.closest('div.upload-resume-container');
  const view = input.closest('div.upload-resume-view');
  if (container === null || view === null) return null;
  const own = container.querySelector('h3');
  if (own !== null) return own;
  const before = Array.from(view.querySelectorAll('div.upload-resume-container > h3'))
    .filter((title) => (title.compareDocumentPosition(container) & FOLLOWING) !== 0);
  return before[before.length - 1] ?? null;
}

/** The words after a label the adapter gives (see the header). */
function labelSuffix(control: Element): string | null {
  // adp-4: <span class="self-review-signature"><div class="self-review-signature-checkbox vdl-checkbox"
  // id="self_att_agree_chk"> ... <label for="...">Yes, I agree to sign electronically.</label></div><div
  // class="self-review-signature-label"><label class="required">Please type your full name.</label><input
  // id="electronicSignature" ...>.
  if (control.matches(SIGNATURE) && control.closest('span.self-review-signature') !== null) return 'electronic signature';
  // jr6 ADP-16 (FIXPLAN §3.2's label contract with RULES; jr6-questions2-blank): the desired salary's Annually | Hourly
  // group, <div id="salaryOptions" class="itemPadLeft prop_group additional-salary"><sdf-radio-group ...><div
  // class="direction-row" role="radiogroup" ...>, read as the block's title plus "pay basis".
  if (control.matches('div[role="radiogroup" i]') && control.closest('#desiredEmplSalaryBlock #salaryOptions') !== null) {
    return 'pay basis';
  }
  return null;
}

/** Whether a control's label, or the page's own mark, says required where no attribute does (see the header). */
function requiredFor(control: Element): boolean {
  // jr6 ADP-2 (jr6-personal-us-errors): <wfn-dropdown-list ... id="PersonalAddress_state" ... required="true">; jr6
  // ADP-7's currency, <sdf-select-simple id="add_info_select_box" ... required="true">: the host says it.
  if (control.matches(SELECT_HOSTS) && (control.getAttribute('required') ?? '').trim().toLowerCase() === 'true') return true;
  // jr6 ADP-1 (jr6-resume-blank): <div id="resumeUploadContainer" ...> ... <span class="resume-required-indicator">Required
  // </span>: the résumé's upload is required while the container shows the mark.
  if (control.matches('input[type="file" i]')) {
    const area = control.closest('#resumeUploadContainer');
    const cache = newScanCache();
    return area !== null && Array.from(area.querySelectorAll('span.resume-required-indicator'))
      .some((mark) => isUserVisible(mark, cache));
  }
  // adp-6: <label class="personal-step-phoneHeader required-indicator" ...>Mobile Number</label> (its input has no
  // aria-required); adp-4: <label class="required">Please type your full name.</label>.
  return labelFor(control)?.matches('label.required-indicator, label.required') === true;
}

// ── jr6 ADP-2, ADP-3, ADP-15: ADP's own lists ──
/** The sdf-select-simple behind a list's host (a wfn-dropdown-list draws one in its shadow root). */
function simpleOf(host: Element): Element | null {
  return host.matches('sdf-select-simple') ? host : host.shadowRoot?.querySelector('sdf-select-simple') ?? null;
}

/** The open list of an sdf-select-simple (jr6-personal-us-errors, jr6-questions2-blank: <sdf-floating-pane ...> ...
 *  <div class="list floating-pane-content"><div id="listbox" role="listbox" ...><sdf-select-item role="option"
 *  aria-label="AL - Alabama" value="AL" ...>, inside its shadow root) while a person can see it; else, for a list the
 *  page portals out of the field (the State's wfn-dropdown-list says portal-enabled="true"), the newest listbox a person
 *  can see in a body-level sdf-floating-pane-portal (Jobright's ADP operations look for the newest visible listbox the
 *  same way); null while none shows. */
function openListOf(simple: Element): Element | null {
  const cache = newScanCache();
  const own = simple.shadowRoot?.querySelector('div#listbox[role="listbox" i]') ?? null;
  if (own !== null && isUserVisible(own, cache)) return own;
  const body = simple.ownerDocument.body;
  if (body === null) return null;
  const portals = Array.from(body.children).filter((child) => child.localName === 'sdf-floating-pane-portal');
  const lists = portals.flatMap((portal) => [...Array.from(portal.querySelectorAll('[role="listbox" i]')),
    ...Array.from(portal.shadowRoot?.querySelectorAll('[role="listbox" i]') ?? [])]);
  return lists.reverse().find((list) => isUserVisible(list, cache)) ?? null;
}

/** The Country a person sees chosen on the Personal Information step (its react-select's single value), the State
 *  list's context; null where none shows. */
function shownCountry(doc: Document): string | null {
  const box = doc.getElementById('PersonalAddress_country')?.closest('.MDFSelectBox__control') ?? null;
  const shown = box?.querySelector('.MDFSelectBox__single-value') ?? null;
  const text = shown === null ? '' : textOf(shown);
  return text === '' ? null : text;
}

/** An ADP list declared as a combobox (see the header), or null where its shadow parts are not there. */
function selectDecl(host: Element): WidgetDecl | null {
  const simple = simpleOf(host);
  const shadow = simple?.shadowRoot ?? null;
  // jr6-questions2-blank: <div class="combo"><div class="trigger-button" role="button" aria-labelledby="label
  // selected-label select-placeholder" aria-expanded="false"><span id="select-placeholder" ...>Choose an option</span>
  // ...; the filter box <input id="select-filter-input" class="filter" role="combobox" type="text" aria-label="Enter
  // text to filter your options" ...> in the list's pane (ADP-15: the widget's part, never a field).
  const trigger = shadow?.querySelector<HTMLElement>('div.trigger-button[role="button" i]') ?? null;
  if (simple === null || shadow === null || trigger === null) return null;
  const filter = shadow.querySelector('input#select-filter-input');
  const context = host.id === 'PersonalAddress_state' ? shownCountry(host.ownerDocument) : null;
  return { kind: 'combobox', opener: trigger, expanded: trigger,
    results: { list: () => openListOf(simple), option: 'sdf-select-item[role="option" i]' },
    // The chosen option's words in the trigger, <span id="selected-label" part="selected-label">, where one is chosen.
    shownAnswer: () => {
      const label = shadow.querySelector('#selected-label');
      const text = label === null ? '' : textOf(label);
      return text === '' ? null : text;
    },
    drawnWhole: true,
    ...(context === null ? {} : { learnContext: context }),
    ...(filter === null ? {} : { parts: [filter] }),
    snapshot: host.matches('wfn-dropdown-list') ? 'fixtures/adp/jr6-personal-us-errors.html'
      : 'fixtures/adp/jr6-questions2-blank.html' };
}

/** The outermost ADP lists in a root (a wfn-dropdown-list's own sdf-select-simple sits in its shadow root). */
function selectHosts(root: Element): Element[] {
  return Array.from(root.querySelectorAll(SELECT_HOSTS))
    .filter((host) => host.parentElement === null || host.parentElement.closest(SELECT_HOSTS) === null);
}
// ── end jr6 ADP-2, ADP-3, ADP-15 ──

// ── jr6 ADP-8, ADP-2 (dependsOn), ADP-1 (uploadState), adp-new-1 (errors), E-ADP (neverPress) ──
/** jr6 ADP-8 (jr6-questions2-blank): "If an offer is presented, how soon can you start?", <div
 *  class="vdl-date-time-picker ..."><input id="question_8" class="vdl-date-time-picker__input ..." type="text"
 *  aria-required="true" placeholder="MM/DM/YYYY">: ADP's date picker reads MM/DD/YYYY (its placeholder misspells it).
 *  jr7 ADP7-13 (FIX7PLAN §6.9 item 4; the ADP verifier's missed finding): a question's own box ADP marks as a number or a
 *  sum, each a plain type="text" in its div.qMainDiv, laid out as one number (the AI's answer asked as one, and only one
 *  number of its text written: plan/answers.ts answerText), a profile value typed as before:
 *  - jr7-adp1-questions-filled, "How many years of related experience do you have?": <input id="question_0"
 *    aria-required="true" class="question__number  vdl-textbox" type="text">;
 *  - jr7-adp1-questions-filled, "What is the minimum hourly rate you would consider for this position?": <input
 *    id="question_1" aria-required="true" class="currency  vdl-textbox" type="text"> beside its div.currencySelectDiv;
 *    questions (the 2026-11-06 employer), question_8: the same currency box.
 *  Jobright's ADP rules send NUMBER by the label's words alone (salary, compensation, pay; ./rules L()), never by these
 *  classes. */
function formatFor(control: Element): { format: FieldFormat; pattern?: string } | null {
  if (control.matches('input.vdl-date-time-picker__input')) return { format: 'date', pattern: 'MM/DD/YYYY' };
  // ── jr7 ADP7-13 ──
  if (control.matches('div.qMainDiv input.question__number')) return { format: 'number' };
  if (control.matches('div.qMainDiv input.currency.vdl-textbox')) return { format: 'currency' };
  // ── end jr7 ADP7-13 ──
  return null;
}

/** The controls a write of the Country resets (dependsOn), by id:
 *  - jr6 ADP-2 (FIXPLAN §3.1 item 10; jr6-personal-blank, jr6-personal-us-state): the State, a text box until Country is
 *    chosen (<input id="PersonalAddress_state" ...>) and then ADP's own list under the same id (<wfn-dropdown-list
 *    id="PersonalAddress_state" ...>);
 *  - jr7 ADP7-2 (adapter half; FIX7PLAN §6.9 item 1, the ADP verifier's corrected fix part 2): Address Line 1, ADP's
 *    per-country Places lookup, read-only while that lookup starts (jr7-adp1-personal-blank, as loaded: <input
 *    id="PersonalAddress_address_line1" aria-required="true" class="vdl-textbox" placeholder="Initializing..."
 *    readonly="" type="text">) and writable with its suggestions once a country is chosen (jr7-adp1-personal-filled:
 *    class "vdl-textbox pac-target-input", placeholder "Enter a location"): decided again after the Country's write
 *    (bookkeeping's 'parent-written'), so a box skipped read-only before it is written once it opens. Jobright fills the
 *    Country first and reads its rules again after the country commits (~contents/sites/adp-workforcenow doFillForm,
 *    prefillCountry). No page-level busy sign is declared for the box: the verifier measured that one cuts the loop
 *    when the lookup never starts. ENGINE-7 E2 item 1 holds a required, empty, read-only box as waiting (its half).
 *  Each is reset by the Country's write (<input class="MDFSelectBox__input" id="PersonalAddress_country" ...>). */
const RESET_BY_COUNTRY: ReadonlySet<string> = new Set(['PersonalAddress_state', 'PersonalAddress_address_line1']);

function dependsOn(control: Element): Element | null {
  return RESET_BY_COUNTRY.has(control.id) ? control.ownerDocument.getElementById('PersonalAddress_country') : null;
}

/** The upload rule each file input was found under, kept for the input ADP takes out of the page (uploadState). */
const uploadRuleOf = new WeakMap<Element, UploadRule>();

/** The rule an input matches, noted for later. */
function noteUpload(input: Element): UploadRule | null {
  const rule = (ADP_CONFIG.uploads ?? []).find((each) => input.isConnected && input.matches(each.input))
    ?? uploadRuleOf.get(input) ?? null;
  if (rule !== null) uploadRuleOf.set(input, rule);
  return rule;
}

/** jr6 ADP-1: ADP takes the résumé's file input out of the page once it holds the file (jr6-resume-uploaded: no input
 *  left in #resumeUploadContainer, the file's row in its place). For such an input the rule's area is found again in
 *  its document: the upload is confirmed while a row there names the file, pending while the area shows none (the row
 *  may still be drawn), failed where the area itself is gone. A connected input is read by the configured rule. */
function uploadState(input: HTMLInputElement, fileName: string): UploadState | null {
  const rule = noteUpload(input);
  if (input.isConnected || rule === null) return hooks.uploadState?.(input, fileName) ?? null;
  if (rule.area === undefined || rule.done === undefined) return null;
  const cache = newScanCache();
  const areas = Array.from(input.ownerDocument.querySelectorAll(rule.area)).filter((area) => isUserVisible(area, cache));
  if (areas.length === 0) return 'failed';
  const wanted = fileName.replace(/\s+/g, ' ').trim();
  const nameCss = rule.name ?? rule.done;
  const named = areas.some((area) => Array.from(area.querySelectorAll(nameCss))
    .some((row) => isUserVisible(row, cache) && wanted !== '' && (row.textContent ?? '').replace(/\s+/g, ' ').trim() === wanted));
  return named ? 'confirmed' : 'pending';
}

/** The configured uploads, each input's rule noted (uploadState). */
function uploadWidgets(root: Element): Array<{ control: Element; input: HTMLInputElement }> {
  const found = hooks.uploadWidgets?.(root) ?? [];
  for (const { input } of found) noteUpload(input);
  return found;
}

/** adp-new-1: the aria-invalid ADP sets on some questions as the page loads (questions, jr6-questions-filled,
 *  jr6-questions2-blank: <textarea id="question_9" class="qTextArea vdl-textarea" aria-required="true"
 *  aria-invalid="true"> beside an empty <label class="vdl-validation-error error-color" role="alert"></label>), which
 *  is no error while the question's validation message is empty and its label is not ADP's error label. */
function loadMark(el: Element): boolean {
  const question = el.closest('div.qMainDiv, div.mdf-validated-field') ?? el.parentElement;
  const messages = question === null ? [] : Array.from(question.querySelectorAll('.vdl-validation-error'));
  if (messages.some((message) => (message.textContent ?? '').trim() !== '')) return false;
  const doc = el.ownerDocument;
  const labels = el.id === '' ? [] : Array.from(doc.querySelectorAll('label')).filter((label) => label.htmlFor === el.id);
  return !labels.some((label) => label.matches('.mdf-label-error'));
}

/** The field an ADP error stands for, by its control's id (FIXPLAN §6.6 adp-new-1, "with a field hint"): an error
 *  label's for=, a State list's own id, or the list its id labels (<label id="mdfstatelabel-<uuid>"
 *  class="mdf-label-error">, which wfn-dropdown-list's aria-labelledby names); none for a message. */
function errorHint(el: Element): string | null {
  if (el.matches('label.mdf-label-error')) {
    const target = el.getAttribute('for');
    if (target !== null && target !== '') return target;
    if (el.id !== '') {
      const host = Array.from(el.ownerDocument.querySelectorAll('wfn-dropdown-list[aria-labelledby]'))
        .find((list) => (list.getAttribute('aria-labelledby') ?? '').split(/\s+/).includes(el.id));
      if (host !== undefined && host.id !== '') return host.id;
    }
    return null;
  }
  return el.matches('wfn-dropdown-list.vdl-validation-error') && el.id !== '' ? el.id : null;
}

/** The page's errors (see the header and ADP_CONFIG.errors): the generic ones but ADP's on-load marks, and ADP's own
 *  a person can see, each with its field's hint where it has one. */
function errors(root: Element): Array<{ el: Element; fieldKeyHint?: string }> {
  const generic = (genericAdapter.errors?.(root) ?? []).filter((error) => !loadMark(error.el));
  const cache = newScanCache();
  const own = Array.from(root.querySelectorAll(ADP_CONFIG.errors!.css))
    .filter((el) => isUserVisible(el, cache) && !generic.some((error) => error.el === el));
  return [...generic, ...own.map((el) => {
    const hint = errorHint(el);
    return hint === null ? { el } : { el, fieldKeyHint: hint };
  })];
}

/** The configured never-pressed controls, and the code-choice pane's Close, which sits in the pane's shadow root
 *  (jr6-guest-send-code: <sdf-focus-pane id="login_view_identifier_dialog" ...><template shadowrootmode="open"> ...
 *  <div class="close-container"><sdf-close-button id="close-button" ...> with its own <button aria-label="Close dialog">
 *  in its shadow root). */
function neverPress(root: Element): Element[] {
  const closes = Array.from(root.ownerDocument.querySelectorAll(CODE_CHOICE_PANE)).flatMap((pane) => {
    const close = pane.shadowRoot?.querySelector('sdf-close-button') ?? null;
    return close === null ? [] : [close, ...Array.from(close.shadowRoot?.querySelectorAll('button') ?? [])];
  });
  return [...(hooks.neverPress?.(root) ?? []), ...closes];
}
// ── end jr6 ADP P1 hooks ──

/** The react-selects and the referral's options, declared as their widgets (see the header); null for any other
 *  control. */
function widgetFor(control: Element): WidgetDecl | null {
  if (control.matches(SELECT_INPUT)) {
    // adp-1: <div class="css-b62m3t-container"> ... <div class="MDFSelectBox__control css-13cymwt-control"><div
    // class="MDFSelectBox__value-container css-hlgwow"><div class="MDFSelectBox__placeholder ...">...</div><div
    // class="MDFSelectBox__input-container ..." data-value=""><input class="MDFSelectBox__input" id="PersonalAddress_country"
    // tabindex="0" type="text" aria-expanded="false" role="combobox" ...>; adp-3, chosen: <div
    // class="MDFSelectBox__value-container MDFSelectBox__value-container--has-value ..."><div
    // class="MDFSelectBox__single-value ...">(the answer)</div> ... <input ... id="vsidGender" ... aria-label="Gender"
    // role="combobox" ... style="... opacity: 0; ...">; adp-2: question_2's
    // MDFSelectBox__value-container--is-multi.
    const box = control.closest('.MDFSelectBox__control');
    if (box === null) return null;
    const kind = control.closest('.MDFSelectBox__value-container--is-multi') !== null ? 'multiselect' : 'combobox';
    return { kind, opener: control as HTMLElement, expanded: control, box, bridge: 'react-select',
      shownAnswer: () => {
        const shown = box.querySelector('.MDFSelectBox__single-value');
        const text = shown === null ? '' : textOf(shown);
        return text === '' ? null : text;
      }, snapshot: 'fixtures/adp/self-id.html' };
  }
  if (control.matches(REFERRAL_OPTIONS)) {
    // adp-2: <wfn-radio-button class="addition-Info-radio-type addition-Info-rd-referral-yes hydrated" id="yes"
    // radio-group-value="" value="Yes"><template shadowrootmode="open"><sdf-radio-button tabindex="0" role="radio"
    // aria-checked="false" ...>...</sdf-radio-button></template>Yes</wfn-radio-button>, and its "No". Core pass Z2 of
    // 2026-11-06: the members are the real radios in the hosts' shadow roots (the scanner keeps members across open
    // shadow roots), whose aria-checked shows the choice, so a press is read back; a host whose shadow radio is not there
    // leaves the hosts as the members (their choice unshown: the person's click).
    const hosts = Array.from(control.querySelectorAll<HTMLElement>(':scope > wfn-radio-button[value]'));
    const radios = hosts.map((host) => Array.from(host.shadowRoot?.children ?? [])
      .find((child): child is HTMLElement => child.matches('sdf-radio-button[role="radio" i]')) ?? null);
    const members = radios.every((radio): radio is HTMLElement => radio !== null) ? radios : hosts;
    return members.length < 2 ? null
      : { kind: 'radio', opener: control as HTMLElement, members, snapshot: 'fixtures/adp/questions.html' };
  }
  // jr6 ADP-2, ADP-3, ADP-15: ADP's own lists (selectDecl).
  if (control.matches(SELECT_HOSTS)) return selectDecl(control);
  return null;
}

const hooks = configuredHooks(ADP_CONFIG);

/** The ADP Workforce Now adapter. */
export const adpAdapter: Adapter = {
  ...hooks,
  id: 'adp',
  matchesUrl,
  canonicalApplicationUrl,
  labelFor,
  labelSuffix,
  requiredFor,
  widgetFor,
  // The referral's options (adp-2); jr6 ADP-2, ADP-3: the outermost ADP lists.
  widgetRoots: (root) => [...Array.from(root.querySelectorAll(REFERRAL_OPTIONS)), ...selectHosts(root)],
  // ── jr6 ADP P1 ──
  formatFor,
  dependsOn,
  uploadState,
  uploadWidgets,
  errors,
  neverPress,
  // ── end jr6 ADP P1 ──
};
