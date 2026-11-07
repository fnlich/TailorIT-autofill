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
 * Nothing here reads, logs or sends a value.
 */
import { newScanCache } from '../../dom/scan-cache';
import { TEXT_CAP_LABEL } from '../../dom/thresholds';
import { visibleText } from '../../dom/visible-text';
import { configuredHooks } from '../configured';
import type { AtsConfig } from '../configured/types';
import type { Adapter, WidgetDecl } from '../types';
import { canonicalApplicationUrl, matchesUrl, parseAdpUrl } from './url';

/** The fixtures the adapter was read from (fixtures/adp/<case>.html), by snapshot. */
export const ADP_SNAPSHOTS = ['fixtures/adp/guest.html', 'fixtures/adp/code-dialog.html', 'fixtures/adp/personal.html',
  'fixtures/adp/questions.html', 'fixtures/adp/self-id.html', 'fixtures/adp/self-attest.html'] as const;

/** A react-select's text box (adp-1, adp-2, adp-3). */
const SELECT_INPUT = 'input.MDFSelectBox__input[role="combobox" i]';
/** The referral question's options (adp-2). */
const REFERRAL_OPTIONS = '#refferalOptions';
/** The e-signature's text box (adp-4). */
const SIGNATURE = 'input#electronicSignature';

/** The rules the configured layer builds hooks from, each naming its snapshot. */
export const ADP_CONFIG: AtsConfig = {
  platform: 'adp',
  snapshots: ['guest', 'code-dialog', 'personal', 'questions', 'self-id', 'self-attest'],
  parse: parseAdpUrl,
  matchesUrl,
  states: [
    // adp-0: <sdf-focus-pane id="login_view_show_opt_dialog" heading="Enter the Verification Code" ...> ... <div
    // class="componentBottomSpace button-align-center otpDialogContent"> ... <input id="oneTimePassWord"
    // aria-label="Enter the Verification Code" aria-required="true" ... type="text">: the dialog's content is the
    // state's root, so this adapter (not the generic one) holds the page, and its pause is the person's.
    { name: 'code', when: 'sdf-focus-pane#login_view_show_opt_dialog input#oneTimePassWord', auth: 'email-code',
      root: 'sdf-focus-pane#login_view_show_opt_dialog div.otpDialogContent', from: 'adp-0' },
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
  ],
  // adp-2: <label class="vdl-validation-error error-color" role="alert"> after an aria-invalid box; adp-6: <wfn-text
  // id="firstNameErrLbl" role="alert" class="experience-vdl-error-label hydrated">; adp-2, adp-3: <div
  // id="sdf-radio-group-<n>-errorMessage">. Empty in every snapshot: an error counts only while a person sees it.
  errors: { css: 'label.vdl-validation-error, .experience-vdl-error-label[role="alert" i], '
    + '[id^="sdf-radio-group-"][id$="-errorMessage"], div.self-review-signature-required', from: 'adp-2' },
  // adp-6: <div id="recPageLoadWaitingIndicator" ... style="display: none">, the page's busy overlay.
  busy: [{ css: '#recPageLoadWaitingIndicator', from: 'adp-6' }],
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
  if (question !== null) return question.querySelector('.question-label-container > label.qLabel');
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
  return null;
}

/** The words after the e-signature's label (see the header). */
function labelSuffix(control: Element): string | null {
  // adp-4: <span class="self-review-signature"><div class="self-review-signature-checkbox vdl-checkbox"
  // id="self_att_agree_chk"> ... <label for="...">Yes, I agree to sign electronically.</label></div><div
  // class="self-review-signature-label"><label class="required">Please type your full name.</label><input
  // id="electronicSignature" ...>.
  return control.matches(SIGNATURE) && control.closest('span.self-review-signature') !== null
    ? 'electronic signature' : null;
}

/** Whether a control's label says required by its class alone (see the header). */
function requiredFor(control: Element): boolean {
  // adp-6: <label class="personal-step-phoneHeader required-indicator" ...>Mobile Number</label> (its input has no
  // aria-required); adp-4: <label class="required">Please type your full name.</label>.
  return labelFor(control)?.matches('label.required-indicator, label.required') === true;
}

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
  widgetRoots: (root) => Array.from(root.querySelectorAll(REFERRAL_OPTIONS)),
};
