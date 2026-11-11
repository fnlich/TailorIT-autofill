/*
 * The iCIMS adapter (docs/design/runtime.md §9; docs/ARCHITECTURE.md "Adapters", "iCIMS"): the quirks of an iCIMS
 * portal, its posting, its email gate and (the owner's snapshots of 2026-11-06, docs/ARCHITECTURE.md, the snapshot build of 2026-11-06) the application's
 * steps after the gate. Every hook names the snapshot it was read from: the public capture of 2026-11-04/05
 * (docs/FIXTURES.md, "The Workday, iCIMS, Taleo, SuccessFactors and Oracle capture": East West Bank's and GDMS's posting
 * and gate) and the owner's signed-in snapshots of ten portals (careers-githubinc, uscareers-nyu, uscareers-rtiinc,
 * careers-aaalife, careers-ars, us-careers-aon, careers-americas, careers-edgewaterit, careers-cotiviti,
 * careers-principal), converted as fixtures/icims/*.html. Every page is server-rendered, each step a document of its
 * own whose Submit posts the step and loads the next (url.ts names each step's address).
 * - Frames: most portals draw every page in iframe#icims_content_iframe of the company's wrapper on the same host
 *   (?in_iframe=1), where the content script runs too (all_frames); the wrapper is never a root. Some serve the page as
 *   the top document itself (careers-aaalife's, careers-ars's). An IForm step's form is framed a level deeper, on
 *   <co>.icims.com/forms, which url.ts reads as no application (it names no posting); since core-x (adapters/chain.ts
 *   chainPageOf, role 'frame', family icims:<co>) that frame is keyed by the portal page around it, so a run reads its
 *   fields with the hooks below (the behaviour review of 2026-11-06, minor 8): its Name box where a person sees its
 *   name beside it, its Signature box (input[name=icims_f_signature], aria-label "Signature", whose binding words
 *   "checking the checkbox above is equivalent to a handwritten signature" sit outside its label), a consent the
 *   resolver leaves to the person (consent.signature, consent-requires-user), and its radios and date parts, which no
 *   visible words name (no-visible-label, the person's).
 * - The posting (postingText): .iCIMS_JobContent, its title, facts and sections (h2.iCIMS_InfoField_Job and
 *   .iCIMS_InfoMsg_Job) with its options' few words.
 * - Entry (entryControl): the visible a.iCIMS_ApplyOnlineButton ("Apply for this job online", two copies, one per
 *   layout), whose address is this posting's own with mode=apply. It moves the top page to the gate. It is never pressed
 *   by a run (entryNeverPressed).
 * - The gate (authState 'email-gate'): form#enterEmailForm, "Enter Your Information": an email box and Next, an
 *   invisible hCaptcha bound to Next, and on some portals a required GDPR box (#accept_gdpr), a GDPR consent list
 *   (select#gdpr_consent_type: careers-americas's one choice "Continue", us-careers-aon's two scopes of consent) or a
 *   phone (careers-ars's: a country code list, aria-required, and input#phoneNumber). Sign-in Auto's form (signInForm,
 *   a top frame only): the email, the GDPR box, and Next by its own id, input#enterEmailSubmitButton, which the page
 *   enables once the box is ticked (gdprAnswerSubmitButton); where the gate also asks for a consent's scope or a phone,
 *   both the person's, the email is typed and Next is the person's (personPresses).
 * - After the gate's Next (uscareers-nyu's login?step=email): "Please verify your email account with us by clicking on
 *   the link we have just sent to ..." (.iCIMS_LoginPage's .iCIMS_SystemMessage, no form): authState 'email-code', the
 *   person's; the email's link opens the Candidate Profile (candidate?from=login&eem=...&code=...).
 * - The steps' forms (detect), each with the step's own Submit (stepOf):
 *   - the Candidate Profile: form#profileForm with input#cp_form_submit_i "Submit Profile" (every profile seen also
 *     holds "Create a login": PersonProfileFields.Login, .Password and .Password_Confirm, declared the profile's account
 *     section (accountSection, core-x item 2): its two password boxes no longer pause the step, the rest of the profile
 *     fills, the login is never filled from the profile, Sign-in Auto may type the login and the password there and the
 *     press is the person's: signInForm 'create-account', personPresses);
 *   - the Candidate Questions (questions?global=1) and the Job Specific Questions (questions): form#questions with
 *     input#quesp_form_submit_i "Submit" (and "Finish Later", input#quesp_form_save_i, never pressed);
 *   - EEO ("EEO", "Voluntary Information"): form#profileForm with input#eeop_form_submit_i "Submit" (and "Finish
 *     Later", input#eeop_form_save_i);
 *   - an IForm's own form (its frame on <co>.icims.com/forms): form[name=icims_form].iCIMS_FormMainStyle with
 *     input[name=icims_submit] "Submit" and input[name=icims_save] "Save & Return Later", a copy of each above and below.
 * - The step bar (div.iCIMS_Steps, in the step's own page: every profile, questions, EEO and IForm page seen):
 *   li#Step_<step> per step, li.iCIMS_Steps_Current the shown one ("Step 4 of 5. Job Specific Questions(Current
 *   Step)"). isFinalStep: 'final' when the current step is the bar's last, 'not-final' when a later step shows,
 *   'unknown' with no bar (an IForm's own frame, which holds none: its bar is in the portal's page around it) or one it
 *   cannot read with certainty (core-x item 1: two bars, an item of no known step or one twice, a later step hidden).
 *   Then the step's Submit is the step's Next (nextButton) on a step that is not the last, and the application's Submit
 *   (submitButton) on the last: careers-aaalife's EEO (profile > questions > EEO), careers-ars's EEO (profile > EEO).
 *   Every step's button says "Submit", a submit word: the step machine presses it as Next only through not-submit.ts's
 *   declared exception (stepSubmitNext: its own id, a later step shown); the last step's only through the Submit gates.
 * - stepSignature: the step bar's current li (its id, Step_<step>), the page's step heading (div.iCIMS_PageStepText,
 *   else the h2 above the form), the address's word, and as anchors the step's Submit (its id, or an IForm's name) and
 *   an IForm's own fields' names (icims_f_...: its packet's pages differ by them, icims_f_Veteran, icims_f_Disability,
 *   icims_f_OfferText); never a block's numbered names, so a block added in place is the same step.
 * - Repeatable sections (repeatables): on the profile, a collection's blocks (div.iCIMS_CollectionContainer, each a
 *   fieldset legend "<name> (<n>)" whose rows carry data-collection), the last block's "Add More (<name>)"
 *   (a.iCIMS_Anchor[role=button]#<collection>Button_<n>). Education is iCIMS's own collection, CandProfileFields.Education;
 *   experience is the collection a portal names "Professional Experience" (uscareers-nyu's and uscareers-rtiinc's
 *   rcf3211). A block's "Delete <name> (<n>)" (a#<collection>Button2_<n>) is never pressed.
 * - Uploads (uploadWidgets): a file field's input inside its visible "My Computer" button (div.iCIMS_FileFieldButton,
 *   tabindex 0: the resume's .iCIMS_resumeUpload, an optional document's), when that button shows. Once a file is on
 *   file the page hides the buttons (.upload-buttons.iCIMS_NoDisplay, "Replace Resume" shown): that hidden part is
 *   excluded, so no file field is offered (another upload would make iCIMS read the resume afresh: "Parsing resume,
 *   please wait..." and a reload with &uploadResume=). The behaviour review of 2026-11-06 (M5), from the same profile
 *   pages' markup (nyu-profile.frame-1, no resume yet; githubinc-profile.frame-1, a resume read): the resume's row holds
 *   div#PortalProfileFields.Resume_Loading.iCIMS_loadingImageResume ("Parsing resume, please wait...", iCIMS_NoDisplay
 *   on both) and div#PortalProfileFields.Resume_FileNameLabel.iCIMS_CurrentFile, the file on record's name (hidden and
 *   empty on nyu-profile, shown with the name on githubinc-profile). While the loading block shows the page is busy
 *   (isBusy) and an upload is under way (uploadState 'pending'); the upload is done ('confirmed') once the row shows
 *   the written file's name as its current file. The row showing a current file is a resume held (uploadHeld), the
 *   input's own files aside; on both snapshots the page then hides the input with its buttons (excluded above), so no
 *   field offers it: "Replace Resume" (button.iCIMS_DeleteButton) is the only way to a new file, never pressed. What a
 *   failed upload shows is in no snapshot.
 * - Errors (errors): a step's message (careers-githubinc's Job Specific Questions after Submit: div[role=alert]
 *   .iCIMS_ErrorMessage "Error: Invalid Data Error. Please check all information before trying again." with
 *   li.iCIMS_pageError per question) and the field row it marks (.iCIMS_TableRow.iCIMS_HasError), the field there; never
 *   the session's "You will be logged out in 60 seconds" (#logoutErrorMessage), the cookies notice or the share notice.
 * - The page after submitting (url.ts: /job?mode=submit_apply): the posting again with div.iCIMS_Message
 *   .iCIMS_SuccessMessage, "Your application has been submitted successfully." (uscareers-nyu's): icimsSubmitted.
 * - Never pressed (neverPress): the posting's share buttons and widgets, "Email this job to a friend", "Log back in", the
 *   FAQ and "Powered by" links and Apply; the steps' "Finish Later" and "Save & Return Later"; "Keep me logged in"; the
 *   profile's social sign-ins (button.icims-social-login), its Google Drive, Dropbox and OneDrive buttons, "Replace
 *   Resume" and "Delete File" (button.iCIMS_DeleteButton) and a block's Delete; an IForm's "Show Less" (removes a block);
 *   the header's "Welcome page", "Dashboard" and "Logout".
 * jr6 (FIXPLAN §6.5; the owner's snapshot6 of 2026-11-10: careers-sentinel, careers-ars, uscareers-nyu, where Jobright
 * filled what was left to the person before), each hook below naming its finding and fixture:
 * - iCIMS's dropdowns are widgets (widgetFor, ICIMS-01): a remote search or a list read whole, the address lookup a
 *   list (ICIMS-08), the gate's Country Code drawn whole; each labelled by its row's label (labelFor, ICIMS-03, -18),
 *   required where its select says so (requiredFor), a dependent one under its parent (dependsOn, ICIMS-02; "Please
 *   specify" under its source, ICIMS-19);
 * - a date's parts are its label with their part (labelFor, labelSuffix, labelFirst, ICIMS-10), an IForm's date by the
 *   words drawn before it; an IForm's text box by its caption (ICIMS-16); a self-identification IForm's radios one group
 *   (groupOf) named by the form's title, each option by the words after it (optionTextFor, ICIMS-14): the IForms' radios
 *   and date parts above are no longer the person's for want of words;
 * - careers-sentinel's Basic Information (Step_basicProfileStep, ICIMS-05) holds the create-login as rows (accountRows,
 *   ICIMS-04), its résumé part no table row; the create-login's own password rules are read (passwordRules, ICIMS-07);
 * - a step followed by Assessments steps alone is final (ICIMS-05); an IForm's own frame is judged by its portal frame's
 *   facts (chainStepFacts and the facts parameter, ICIMS-17), its "Submit" then the step's Next or the final Submit;
 * - a résumé on record is the résumé's field, "Replace Resume" the control a person sees for it, never pressed
 *   (ICIMS-23); a parsed block's Delete is declared (removeButton, ICIMS-22), never pressed.
 * Nothing here reads, logs or sends a value.
 */
import { newScanCache, type ScanCache } from '../../dom/scan-cache';
import { TEXT_CAP_LABEL } from '../../dom/thresholds';
import { visibleText } from '../../dom/visible-text';
import { isUserVisible } from '../../dom/visibility';
import { genericAdapter } from '../generic';
import type { Adapter, ChainStepFacts, PagePasswordClass, PagePasswordRules, SignInForm, SignInWall, WidgetDecl }
  from '../types';
import { canonicalApplicationUrl, matchesUrl, parseIcimsUrl } from './url';

/** The snapshots the hooks were written from (fixtures/icims/). */
export const ICIMS_SNAPSHOTS = ['fixtures/icims/eastwestbank-posting.html',
  'fixtures/icims/eastwestbank-email-gate.html', 'fixtures/icims/gdms-email-gate.html',
  // The owner's snapshots of 2026-11-06 (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06).
  'fixtures/icims/ars-gate-phone.html', 'fixtures/icims/aon-gate-consent.html', 'fixtures/icims/nyu-email-verify.html',
  'fixtures/icims/githubinc-profile.html', 'fixtures/icims/nyu-profile.html',
  'fixtures/icims/githubinc-candidate-questions.html', 'fixtures/icims/githubinc-job-questions-error.html',
  'fixtures/icims/nyu-voluntary-information.html', 'fixtures/icims/aaalife-eeo-final.html',
  'fixtures/icims/edgewater-self-id-veteran.html', 'fixtures/icims/nyu-self-id-disability.html',
  'fixtures/icims/nyu-submitted.html',
  // jr6 (FIXPLAN §6.5): the owner's snapshot6 of 2026-11-10 (F:\Develop\Refer\snapshot6\icims1..3: careers-sentinel,
  // careers-ars, uscareers-nyu), converted as fixtures/icims/jr6-*.html: careers-sentinel's Basic Information (blank
  // and as Jobright filled it), profile (the same), Job Specific Questions and self-ID IForm; careers-ars's profile
  // (blank, after the address lookup's choice, filled) and EEO; uscareers-nyu's profile after the résumé's parse (and
  // filled) and two IForms (jr6-icims.browser.test.ts holds them).
  'fixtures/icims/jr6-sentinel-basic-info.html', 'fixtures/icims/jr6-sentinel-basic-info-filled.html',
  'fixtures/icims/jr6-sentinel-profile.html', 'fixtures/icims/jr6-sentinel-profile-filled.html',
  'fixtures/icims/jr6-sentinel-job-questions.html', 'fixtures/icims/jr6-sentinel-iform-selfid.html',
  'fixtures/icims/jr6-ars-profile.html', 'fixtures/icims/jr6-ars-profile-address.html',
  'fixtures/icims/jr6-ars-profile-filled.html', 'fixtures/icims/jr6-ars-eeo.html',
  'fixtures/icims/jr6-nyu-profile-parsed.html', 'fixtures/icims/jr6-nyu-profile-filled.html',
  'fixtures/icims/jr6-nyu-iform-signature.html', 'fixtures/icims/jr6-nyu-iform-offer.html'] as const;

/** The first of `elements` a person can see. */
function shown<T extends Element>(elements: readonly T[], cache: ScanCache = newScanCache()): T | null {
  return elements.find((el) => isUserVisible(el, cache)) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------------
// The gate and what follows its Next
// ---------------------------------------------------------------------------------------------------------------------

/** The email gate, while it shows: fixtures/icims/eastwestbank-email-gate.frame-1.html's <form id="enterEmailForm"
 *  class="iCIMS_SignIn" method="post" action=".../login?step=email&in_iframe=1&hashed=..."> holding <input id="email"
 *  name="css_loginName" type="email" autocomplete="email"> and <input id="enterEmailSubmitButton" type="submit"
 *  value="Next">. */
function gateOf(doc: Document): HTMLFormElement | null {
  return shown(Array.from(doc.querySelectorAll<HTMLFormElement>('form#enterEmailForm')));
}

/** What the gate asks besides the email and the GDPR box, a person's choice each: a consent's scope
 *  (fixtures/icims/aon-gate-consent.frame-1.html's <select id="gdpr_consent_type" name="gdpr_consent_type"
 *  aria-required="true">, careers-americas's too) and a phone (fixtures/icims/ars-gate-phone.html's <a id="dropdown"
 *  class="dropdown-select" aria-label="Country Code ..." aria-required="true" role="combobox"> and <input type="text"
 *  autocomplete="tel-national" id="phoneNumber" name="css_phoneNumber">), each while a person can see it. */
function gateAsksMore(gate: HTMLFormElement): boolean {
  const cache = newScanCache();
  return shown(Array.from(gate.querySelectorAll('select#gdpr_consent_type, input#phoneNumber[name="css_phoneNumber"]')),
    cache) !== null;
}

/** "Please verify your email account with us by clicking on the link we have just sent to ...", shown after the gate's
 *  Next: fixtures/icims/nyu-email-verify.frame-1.html's <div class="iCIMS_MainWrapper iCIMS_LoginPage "> ... <div
 *  tabindex="-1" class="iCIMS_Message iCIMS_SystemMessage iCIMS_GenericMessage"> Please verify your email account ...
 *  </div>, with no form. */
function verifyEmailShown(doc: Document): boolean {
  const cache = newScanCache();
  return Array.from(doc.querySelectorAll('.iCIMS_LoginPage .iCIMS_SystemMessage')).some((message) =>
    isUserVisible(message, cache) && /\bverify your email\b/i.test(message.textContent ?? ''));
}

// ---------------------------------------------------------------------------------------------------------------------
// The steps
// ---------------------------------------------------------------------------------------------------------------------

/** Each step's form and its own Submit (module header), as the snapshots draw them: fixtures/icims/githubinc-profile
 *  .frame-1.html's <form ... id="profileForm" name="profileForm"> ... <input type="submit" id="cp_form_submit_i"
 *  name="profileButton" class="iCIMS_PrimaryButton ..." value="Submit Profile">; githubinc-candidate-questions's <form
 *  ... id="questions" name="questions"> ... <input type="submit" id="quesp_form_submit_i" ... value="Submit">;
 *  nyu-voluntary-information's <form ... id="profileForm"> ... <input type="submit" id="eeop_form_submit_i"
 *  name="profileButton" ... value="Submit">; edgewater-self-id-veteran.frame-2.html's <form class="iCIMS_FormMainStyle"
 *  method="post" name="icims_form"> ... <input type="submit" name="icims_submit" value="Submit"> (twice). */
const STEP_FORMS: ReadonlyArray<{ form: string; button: string }> = [
  { form: 'form#profileForm', button: 'input[type="submit" i]#cp_form_submit_i' },
  { form: 'form#questions', button: 'input[type="submit" i]#quesp_form_submit_i' },
  { form: 'form#profileForm', button: 'input[type="submit" i]#eeop_form_submit_i' },
  { form: 'form[name="icims_form"].iCIMS_FormMainStyle', button: 'input[type="submit" i][name="icims_submit"]' },
];

/** The step's form a person sees now, with its own Submit (the first copy a person sees), or null. */
function stepOf(doc: Document): { form: HTMLFormElement; button: HTMLElement } | null {
  const cache = newScanCache();
  for (const { form: formSelector, button: buttonSelector } of STEP_FORMS) {
    for (const form of Array.from(doc.querySelectorAll<HTMLFormElement>(formSelector))) {
      if (!isUserVisible(form, cache)) continue;
      const button = shown(Array.from(form.querySelectorAll<HTMLElement>(buttonSelector)), cache);
      if (button !== null) return { form, button };
    }
  }
  return null;
}

// ── snapshot build 2026-11-06 (core-x, item 3): the wrapper's application frame ──
/** The company's wrapper's frame that draws every page of the application (Adapter.applicationFrame): the wrapper of
 *  every owner's snapshot of a framed portal (careers-githubinc, uscareers-nyu, uscareers-rtiinc, us-careers-aon,
 *  careers-americas, careers-edgewaterit, careers-cotiviti, careers-principal) holds <iframe id="icims_content_iframe">
 *  (fixtures/icims/<case>.html, the frame-1 its page), on the wrapper's own host. Only on a page with no step form of
 *  its own and no gate (a wrapper is never a root); null elsewhere, or where the page holds more than one. */
function applicationFrame(doc: Document): HTMLIFrameElement | null {
  if (detect(doc) !== null) return null;
  const frames = Array.from(doc.querySelectorAll<HTMLIFrameElement>('iframe#icims_content_iframe'));
  return frames.length === 1 ? frames[0]! : null;
}

/** The form root: the gate, else the shown step's form. */
function detect(doc: Document): { formRoot: Element } | null {
  const gate = gateOf(doc);
  if (gate !== null) return { formRoot: gate };
  const step = stepOf(doc);
  return step === null ? null : { formRoot: step.form };
}

/** The step bar: fixtures/icims/githubinc-job-questions-error.frame-1.html's <div class="iCIMS_Steps"> <ul> <li
 *  class=" iCIMS_Steps_NotCurrent iCIMS_Steps_Completed" id="Step_profileStep" ...> ... <li class=" iCIMS_Steps_Current"
 *  id="Step_jobQuestionsStep" title="Job Specific Questions&nbsp;(Current Step)" ...> <span class="iCIMS_Steps_Content
 *  sr-only" ...> Step &nbsp; 4 &nbsp; of &nbsp; 5. ...</span> </li> <li class=" iCIMS_Steps_NotCurrent"
 *  id="Step_perPortalSubmittalFormsStep" ...> </ul> </div>. Its items and the current one, or null without one. */
function stepBarOf(doc: Document): { items: Element[]; current: Element } | null {
  for (const bar of Array.from(doc.querySelectorAll('.iCIMS_Steps'))) {
    const items = Array.from(bar.querySelectorAll('li[id^="Step_"]'));
    const current = items.filter((item) => item.classList.contains('iCIMS_Steps_Current'));
    if (items.length > 0 && current.length === 1) return { items, current: current[0]! };
  }
  return null;
}

// ── snapshot build 2026-11-06 (core-x, item 1): the bar read with certainty, and its later step ──
/** jr6 ICIMS-05: the Assessments step (Jobright's ~contents/sites/icims ./final-submission step table and
 *  getIcimsWizardNavigationState): an assessment is the person's, taken after the application, so a step whose later
 *  steps are all Assessments is the application's last (its Submit goes through the Submit gates), one followed by an
 *  Assessments step and then another step is not, and on the Assessments step itself nothing is known. */
const ASSESSMENTS_STEP = 'Step_assessmentsStep';

/** Every step the owner's snapshots' bars name (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06: the ten portals' li#Step_<step>): the profile, the
 *  candidate questions, the person's forms, EEO, the job's questions and the portal's and the job's submittal forms. */
const STEP_IDS: ReadonlySet<string> = new Set(['Step_profileStep', 'Step_personQuestionsStep', 'Step_personFormsStep',
  'Step_eeoStep', 'Step_jobQuestionsStep', 'Step_perPortalSubmittalFormsStep', 'Step_perJobSubmittalFormsStep',
  // jr6 ICIMS-05: careers-sentinel's first step, "Basic Information" (snapshot6 icims1: fixtures/icims/jr6-sentinel-
  // basic-info.frame-1.html's <li class="iCIMS_Steps_First iCIMS_Steps_Current" id="Step_basicProfileStep" ...>, and
  // every later sentinel step's bar), and the Assessments step, a fact of Jobright's step table (~contents/sites/icims
  // ./final-submission, its step-id table; no snapshot shows one yet).
  'Step_basicProfileStep', ASSESSMENTS_STEP]);

/** An item's own count, as every snapshot's bar says it in its sr-only text (githubinc-job-questions-error.frame-1:
 *  <span class="iCIMS_Steps_Content sr-only"> Step &nbsp; 4 &nbsp; of &nbsp; 5. Job Specific Questions(Current Step)
 *  </span>): its place and the bar's length, or null. */
function countOf(item: Element): { at: number; of: number } | null {
  const text = (item.querySelector('.iCIMS_Steps_Content')?.textContent ?? '').replace(/\u00a0/g, ' ');
  const read = /\bStep\s+(\d{1,2})\s+of\s+(\d{1,2})\b/.exec(text);
  return read === null ? null : { at: Number(read[1]), of: Number(read[2]) };
}

/** The step bar as every snapshot draws it, read only where it cannot be misread: the document's one bar holding step
 *  items (a second one, a decoy or a copy, makes it unreadable), its items each one of STEP_IDS and none twice, each
 *  saying its own place in a bar of its own length ("Step 2 of 5": an item added or taken away leaves the others' count
 *  wrong), exactly one current. Null otherwise. */
function certainBarOf(doc: Document): { items: Element[]; current: Element } | null {
  const bars = Array.from(doc.querySelectorAll('.iCIMS_Steps'))
    .filter((bar) => bar.querySelector('li[id^="Step_"]') !== null);
  if (bars.length !== 1) return null;
  const items = Array.from(bars[0]!.querySelectorAll('li[id^="Step_"]'));
  const ids = items.map((item) => item.id);
  if (ids.some((id) => !STEP_IDS.has(id)) || new Set(ids).size !== ids.length) return null;
  if (!items.every((item, index) => {
    const count = countOf(item);
    return count !== null && count.at === index + 1 && count.of === items.length;
  })) return null;
  const current = items.filter((item) => item.classList.contains('iCIMS_Steps_Current'));
  return current.length === 1 ? { items, current: current[0]! } : null;
}

/** The bar's reading of its current step (jr6 ICIMS-05): 'final' where every later item is an Assessments step (or
 *  none follows), 'unknown' on the Assessments step itself, else the item after the current one. */
function barReading(bar: { items: Element[]; current: Element }): 'final' | 'unknown' | { later: Element } {
  if (bar.current.id === ASSESSMENTS_STEP) return 'unknown';
  const after = bar.items.slice(bar.items.indexOf(bar.current) + 1);
  return after.every((item) => item.id === ASSESSMENTS_STEP) ? 'final' : { later: after[0]! };
}

/** The bar's item after the current one, when a person can see it (Adapter.stepSubmitNext.laterStep): the step the
 *  current step's Submit leads to. Null on the last step (jr6 ICIMS-05: one followed by Assessments steps alone), with
 *  no bar, or with one certainBarOf does not read. jr6 ICIMS-17: on an IForm's own frame, which holds no bar, the
 *  portal's facts decide (factsReading): while they say a later form or step follows, the IForm's own form stands for
 *  it, a sign that is never a later step a person sees beside the button (dom/fillers/not-submit.ts refuses an element
 *  around the button), so nothing is pressed there until the caller that passes the facts reads them (SHELL). */
function laterStep(doc: Document, facts?: ChainStepFacts | null): Element | null {
  const bar = certainBarOf(doc);
  if (bar === null) {
    const step = leafStepOf(doc);
    return step !== null && !hasStepBar(doc) && factsReading(facts) === 'not-final' ? step.form : null;
  }
  const reading = barReading(bar);
  if (typeof reading === 'string') return null;
  return isUserVisible(reading.later) ? reading.later : null;
}

/** 'final' on the bar's last step, 'not-final' while it shows a later step a person can see, 'unknown' with no bar, or
 *  one it cannot read with certainty (module header; core-x item 1: a bar a page could make lie, a second bar, an item
 *  of no known step, an item twice, a later step hidden, is no word on the step's finality). jr6 ICIMS-05: a step
 *  followed by Assessments steps alone is final, the Assessments step itself unknown. jr6 ICIMS-17: an IForm's own form
 *  (no bar in its frame) is judged by its portal's facts (factsReading); without them, unknown. */
function isFinalStep(doc: Document, facts?: ChainStepFacts | null): 'final' | 'not-final' | 'unknown' {
  if (stepOf(doc) === null) return 'unknown';
  const bar = certainBarOf(doc);
  if (bar === null) return leafStepOf(doc) !== null && !hasStepBar(doc) ? factsReading(facts) : 'unknown';
  const reading = barReading(bar);
  if (reading === 'final' || reading === 'unknown') return reading;
  return laterStep(doc) !== null ? 'not-final' : 'unknown';
}

/** The step's Submit on a step that is not the last (module header): the step machine's Next. jr6 ICIMS-17: an IForm's
 *  own "Submit" (input[name=icims_submit]) while its portal's facts say a later form or step follows. */
function nextButton(root: Element, facts?: ChainStepFacts | null): HTMLElement | null {
  const step = stepOf(root.ownerDocument);
  return step !== null && step.form === root && isFinalStep(root.ownerDocument, facts) === 'not-final'
    ? step.button : null;
}

// ── jr6 ICIMS-17: an IForm's steps, judged by its portal frame's bar ──
/** Whether the document draws a step bar at all (one certainBarOf may still refuse). */
function hasStepBar(doc: Document): boolean {
  return doc.querySelector('.iCIMS_Steps li[id^="Step_"]') !== null;
}

/** An IForm's own form with its Submit, on its leaf frame (<co>.icims.com/forms: fixtures/icims/jr6-nyu-iform-offer
 *  .frame-2.html's <form class="iCIMS_FormMainStyle" method="post" name="icims_form"> ... <input type="submit"
 *  name="icims_submit" value="Submit">), or null on any other page. */
function leafStepOf(doc: Document): { form: HTMLFormElement; button: HTMLElement } | null {
  const step = stepOf(doc);
  return step !== null && step.form.matches(IFORM) ? step : null;
}

/** An IForm's own form (module header). */
const IFORM = 'form[name="icims_form"].iCIMS_FormMainStyle';

/** The portal's facts read for its IForm leaf (FIXPLAN §6.5 item 9, the counter rule; Jobright's
 *  ~contents/sites/icims ./final-submission getIcimsWizardNavigationState and isFinalNavigationStep: the bar's last step
 *  is final unless the packet counter "( n/m )" shows a later page): no facts, or more than one counter (the leaf's
 *  form cannot be told), unknown; a counter that is no place in its packet, unknown; a form before the packet's last
 *  (n < m), not final (its Submit shows the next form); the packet's last form, or no packet, final on the bar's last
 *  step and not final before it (its Submit leads to the next step). */
function factsReading(facts: ChainStepFacts | null | undefined): 'final' | 'not-final' | 'unknown' {
  if (facts === null || facts === undefined || facts.counters > 1) return 'unknown';
  const { packet } = facts;
  if (packet !== null) {
    if (!Number.isInteger(packet.n) || !Number.isInteger(packet.m) || packet.n < 1 || packet.n > packet.m) {
      return 'unknown';
    }
    if (packet.n < packet.m) return 'not-final';
  }
  return facts.lastStep ? 'final' : 'not-final';
}

/** A packet counter as the portal's step heading draws it: fixtures/icims/jr6-nyu-iform-signature.frame-1.html's <div
 *  class="iCIMS_PageStepText">Portal Specific Forms (<span class="iCIMS_Badge">4/4</span>)</div>. */
const PACKET_COUNTER = /\(\s*(\d{1,3})\s*\/\s*(\d{1,3})\s*\)/g;

/** What the portal frame's bar says, for the IForm leaf it frames (Adapter.chainStepFacts): on a page with no step form
 *  of its own that frames an IForm (.iCIMS_mainFormFrame's iframe#icims_formFrame: jr6-nyu-iform-signature.frame-1,
 *  jr6-nyu-iform-offer.frame-1, jr6-sentinel-iform-selfid.frame-1) and draws a bar certainBarOf reads, its current
 *  step's id, whether it is the last (Assessments steps after it aside: ICIMS-05), and the packet counters its shown
 *  step headings hold; null on any other page, on the Assessments step, or where a later step is hidden. Page
 *  structure only, never a value. */
function chainStepFacts(doc: Document): ChainStepFacts | null {
  if (stepOf(doc) !== null || doc.querySelector('.iCIMS_mainFormFrame iframe#icims_formFrame') === null) return null;
  const bar = certainBarOf(doc);
  if (bar === null) return null;
  const reading = barReading(bar);
  if (reading === 'unknown') return null;
  if (reading !== 'final' && !isUserVisible(reading.later)) return null;
  const cache = newScanCache();
  const counters = Array.from(doc.querySelectorAll('.iCIMS_PageStepText')).filter((el) => isUserVisible(el, cache))
    .flatMap((el) => [...visibleText(el, { singleLine: true, cache }).matchAll(PACKET_COUNTER)]);
  const first = counters[0];
  return { stepId: bar.current.id, lastStep: reading === 'final', counters: counters.length,
    packet: counters.length === 1 && first !== undefined ? { n: Number(first[1]), m: Number(first[2]) } : null };
}

/** The step's Submit on the last step (module header): the application's Submit, never clicked but by its door. jr6
 *  ICIMS-17: an IForm's own "Submit" where its portal's facts say the last form of the last step; the contract's
 *  submitButton takes no facts yet (ENGINE: the ICIMS handoff), so until a caller passes them this answers as before. */
function submitButton(root: Element, facts?: ChainStepFacts | null): HTMLElement | null {
  const step = stepOf(root.ownerDocument);
  return step !== null && step.form === root && isFinalStep(root.ownerDocument, facts) === 'final' ? step.button : null;
}

/**
 * The step's word in its address (stepSignature's urlPart): the path's last part, and for the questions' two steps,
 * which share it, ?global=1 names the Candidate Questions. The behaviour review of 2026-11-06 (minor 10) read every
 * questions page of the owner's snapshots: global=1 is no query variant of one step but the Candidate Questions' own
 * mark, kept after its Submit (its form#questions posts to questions?back=...&global=1&csrf=...&hashed=...: careers-
 * aaalife's, careers-githubinc's, us-careers-aon's, uscareers-rtiinc's), while the Job Specific Questions' posts to
 * questions?back=...&global=&csrf=... (careers-githubinc's error page, careers-edgewaterit's, us-careers-aon's): each
 * step's page after an error reads its own word again.
 */
export function stepWordOf(url: URL): string {
  const word = url.pathname.split('/').filter((part) => part !== '').at(-1) ?? '';
  return word === 'questions' && url.searchParams.get('global') === '1' ? 'questions-global' : word;
}

/** The step's parts (module header). Page text and names only, never a value. */
function stepSignature(doc: Document): { heading?: string; progress?: string; urlPart?: string; anchors: string[] } {
  const step = stepOf(doc);
  if (step === null) return { anchors: [] };
  const cache = newScanCache();
  const bar = stepBarOf(doc);
  // githubinc-job-questions-error.frame-1.html: <div class="iCIMS_PageStepText">Job Specific Questions</div> <hr> <div
  // class="iCIMS_CenteredPageContent"> <h2>Job Specific Questions</h2>.
  const heading = shown(Array.from(doc.querySelectorAll('.iCIMS_PageStepText')), cache)
    ?? shown(Array.from(doc.querySelectorAll('h2:not(.iCIMS_SubHeader):not(.iCIMS_InfoField_Job)')), cache);
  let urlPart = '';
  try {
    urlPart = stepWordOf(new URL(doc.location.href));
  } catch {
    // A page with no address of its own (a fixture's srcdoc): the other parts tell the step.
  }
  // An IForm's own fields, by the names its form gives once (icims_f_Veteran, icims_f_Disability, icims_f_OfferText):
  // its packet's pages share every other part. A block's numbered names (icims_<n>_..., the profile's
  // -<n>_PersonProfileFields...) are left out, so a block added in place is the same step.
  const names = Array.from(step.form.elements).map((control) => control.getAttribute('name') ?? '')
    .filter((name) => /^icims_f_/.test(name));
  return {
    heading: heading === null ? '' : visibleText(heading, { singleLine: true, cache }),
    progress: bar?.current.id ?? '',
    urlPart,
    anchors: [step.button.id || step.button.getAttribute('name') || '', ...names],
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The profile's parts
// ---------------------------------------------------------------------------------------------------------------------

/** A profile's repeatable collection (module header): its rows' data-collection, the kind, and how a person sees its
 *  name. fixtures/icims/nyu-profile.frame-1.html: <div tabindex="-1" class="iCIMS_CollectionContainer
 *  CandProfileFields.Education-1-Container"><fieldset class="iCIMS_CollectionGroup iCIMS_OddRow"><legend><span ...
 *  id="CandProfileFields.Education_-1_label">Education (1)</span></legend> ... <div data-collection="CandProfileFields
 *  .Education" data-index="1" class="... iCIMS_TableRow iCIMS_FieldRow_Inline"> ... </fieldset><div
 *  class="iCIMS_CollectionButtonsRow"> ... <a role="button" class="iCIMS_Anchor" id="CandProfileFields
 *  .EducationButton_-1">Add More (Education)</a> ...; and the same for rcf3211, "Professional Experience (1)",
 *  a#rcf3211Button_-1 "Add More (Professional Experience)". */
function collectionsOf(root: Element): Array<{ name: string; kind: 'education' | 'experience' }> {
  const found = new Map<string, 'education' | 'experience'>();
  for (const container of Array.from(root.querySelectorAll('.iCIMS_CollectionContainer'))) {
    const name = container.querySelector('[data-collection]')?.getAttribute('data-collection') ?? '';
    if (name === '' || found.has(name)) continue;
    const legend = (container.querySelector('fieldset.iCIMS_CollectionGroup > legend')?.textContent ?? '').trim();
    if (name === 'CandProfileFields.Education') found.set(name, 'education');
    else if (/^Professional Experience \(\d+\)/i.test(legend)) found.set(name, 'experience');
  }
  return [...found].map(([name, kind]) => ({ name, kind }));
}

/** The blocks of one collection, in page order. */
function blocksOf(root: Element, name: string): Element[] {
  return Array.from(root.querySelectorAll('.iCIMS_CollectionContainer'))
    .filter((container) => container.querySelector(`[data-collection="${CSS.escape(name)}"]`) !== null);
}

/** The collection's "Add More (<name>)" a person sees (its last block's): a.iCIMS_Anchor[role=button] whose id is
 *  <collection>Button_<n> (never the block's Delete, <collection>Button2_<n>). */
function addMoreOf(root: Element, name: string): HTMLElement | null {
  const prefix = `${name}Button_`;
  return shown(Array.from(root.querySelectorAll<HTMLElement>('a.iCIMS_Anchor[role="button" i][id]'))
    .filter((anchor) => anchor.id.startsWith(prefix)));
}

function repeatables(root: Element): ReturnType<NonNullable<Adapter['repeatables']>> {
  if (!root.matches('form#profileForm')) return [];
  return collectionsOf(root).map(({ name, kind }) => ({
    kind,
    blocks: () => blocksOf(root, name),
    addButton: () => addMoreOf(root, name),
    removeButton: (block: Element) => removeOf(block, name),
  }));
}

/** jr6 ICIMS-22: a block's own Delete (repeatables' removeButton), never pressed by a run (neverPress lists it; only
 *  ENGINE's gated door may, after owner question Q1): fixtures/icims/jr6-nyu-profile-parsed.frame-1.html, the profile
 *  after iCIMS's résumé parse, its 2nd to 4th "Professional Experience" blocks' <legend>...</legend><div
 *  class="pull-right rcf3211-330157-RemoveButton iCIMS_NoDisplay"><a class="iCIMS_Anchor" role="button"
 *  aria-label="Delete Professional Experience (2)" id="rcf3211Button2_-330157"><span class="glyphicons
 *  glyphicons-remove"></span></a></div> (uscareers-rtiinc's the same). The block's own anchor, its id the collection's
 *  "Button2_" and the block's number, shown or not (the page draws it NoDisplay until it offers it: the door checks a
 *  person can see it); null in a block that holds none (the first block). */
function removeOf(block: Element, name: string): HTMLElement | null {
  const prefix = `${name}Button2_`;
  return Array.from(block.querySelectorAll<HTMLElement>('a.iCIMS_Anchor[role="button" i][id]'))
    .find((anchor) => anchor.id.startsWith(prefix)) ?? null;
}

/** Each file field's input with its visible "My Computer" button: nyu-profile.frame-1.html's <div tabindex="0"
 *  class="iCIMS_FileFieldButton iCIMS_SecondaryButton iCIMS_resumeUpload"><label for="PortalProfileFields.Resume_File"
 *  ... aria-hidden="true" class="iCIMS_508_Label">My Computer (Opens new window)</label><input type="file"
 *  id="PortalProfileFields.Resume_File" ... tabindex="-1" aria-required="true" ...> ... <span aria-hidden="true"
 *  class="iCIMS_FileFieldText">My Computer</span></div>. A field showing its current file instead (githubinc-profile:
 *  the buttons in .upload-buttons.iCIMS_NoDisplay, "Replace Resume" shown) has none. */
/** A file field's upload buttons the page hides because it holds a file already (githubinc-profile.frame-1.html, a
 *  resume read: <div id="PortalProfileFields.Resume_UploadButtons" class="upload-buttons iCIMS_NoDisplay"> beside the
 *  current file's name and "Replace Resume"): its input is no field until the person replaces the file, but (jr6
 *  ICIMS-23) the résumé's own, which stays the held résumé's field (heldResumeOf). And (core-x, item 2) the profile's
 *  "Create a login" part (accountSection; jr6 ICIMS-04: or its rows, accountRows): its login is never filled from the
 *  profile, it follows Sign-in mode. */
function excluded(root: Element): Element[] {
  const cache = newScanCache();
  const account = accountSection(root);
  const held = heldResumeOf(root, cache);
  return [...Array.from(root.querySelectorAll('.upload-buttons'))
    .filter((buttons) => !isUserVisible(buttons, cache) && !(held !== null && buttons.contains(held.input))),
  ...(account === null ? accountRows(root) ?? [] : [account])];
}

function uploadWidgets(root: Element): Array<{ control: Element; input: HTMLInputElement }> {
  const cache = newScanCache();
  const held = heldResumeOf(root, cache);
  return [...Array.from(root.querySelectorAll<HTMLInputElement>('div.iCIMS_FileFieldButton > input[type="file" i]'))
    .flatMap((input) => {
      const control = input.parentElement!;
      return isUserVisible(control, cache) ? [{ control, input }] : [];
    }), ...(held === null ? [] : [{ control: held.replace, input: held.input }])];
}

// ── jr6 ICIMS-23: a résumé on record is the résumé's field ──
/** The résumé field while its row shows a file on record (uploadHeld) and "Replace Resume" (githubinc-profile.frame-1,
 *  and snapshot6's jr6-sentinel-profile.frame-1 and jr6-nyu-profile-parsed.frame-1: <div
 *  id="PortalProfileFields.Resume_DeleteButtonSpan" class="iCIMS_FileUploadDeleteButtonContainer "><button
 *  id="PortalProfileFields.Resume_Button" type="button" class="small iCIMS_Button iCIMS_DeleteButton
 *  iCIMS_SecondaryButton">Replace Resume</button></div>, beside the hidden upload buttons that hold the input): the
 *  input, hidden, with that button as the control a person sees for it (uploadWidgets), so the scan reads one résumé
 *  field holding a file. The button stays never pressed (neverPress), and the input is never written while the page
 *  holds a file: the core flags the field under "Upload mine again" (RULES). Jobright presses that button, then uploads
 *  (~contents/sites/icims uploadResume: #PortalProfileFields.Resume_Button when a file is on record). Null while the
 *  row shows no file or no button. */
function heldResumeOf(root: Element, cache: ScanCache): { input: HTMLInputElement; replace: HTMLElement } | null {
  const input = root.querySelector<HTMLInputElement>(RESUME_INPUT);
  const row = input === null ? null : resumeRowOf(input);
  if (input === null || row === null || currentFileOf(row, cache) === null) return null;
  const replace = row.querySelector<HTMLElement>('button[id="PortalProfileFields.Resume_Button"].iCIMS_DeleteButton');
  return replace !== null && isUserVisible(replace, cache) ? { input, replace } : null;
}

// ── behaviour review 2026-11-06 (M5): the resume's parse and the file on record (module header) ──
/** The resume's input (nyu-profile.frame-1.html: <input type="file" id="PortalProfileFields.Resume_File"
 *  name="PortalProfileFields.Resume_File" ...>), the only file input of the owner's snapshots. */
const RESUME_INPUT = 'input[type="file" i][id="PortalProfileFields.Resume_File"]';
/** In the resume's row (<div class="iCIMS_EvenRow iCIMS_TableRow iCIMS_FieldRow_PortalProfileFields.Resume ">), its
 *  parse under way: <div id="PortalProfileFields.Resume_Loading" class="iCIMS_NoDisplay iCIMS_loadingImageResume"><div
 *  class="iCIMS_loadingImageResumeText">Parsing resume, please wait...</div></div>. */
const RESUME_LOADING = '[id="PortalProfileFields.Resume_Loading"].iCIMS_loadingImageResume';
/** In the same row, the file on record: <div id="PortalProfileFields.Resume_FileNameLabel" class="iCIMS_CurrentFile">
 *  <span>(the file's name)</span><span class="iCIMS_NoDisplay iCIMS_CurrentFileIcon" ...></span></div>
 *  (githubinc-profile.frame-1.html; iCIMS_NoDisplay and an empty span on nyu-profile.frame-1.html). */
const RESUME_CURRENT = '[id="PortalProfileFields.Resume_FileNameLabel"].iCIMS_CurrentFile';

/** The resume input's row, or null for any other input (or one in no row). jr6 ICIMS-04: on careers-sentinel's Basic
 *  Information (fixtures/icims/jr6-sentinel-basic-info.frame-1.html) the résumé's part is no table row but <div
 *  class="iCIMS_ResumeSection" role="group" aria-labelledby="label_PortalProfileFields.Resume_File">, holding the same
 *  loading block, file on record and buttons, so its parse is waited for there as on a profile. */
function resumeRowOf(input: Element): Element | null {
  return input.matches(RESUME_INPUT) ? input.closest('.iCIMS_TableRow, .iCIMS_ResumeSection') : null;
}

/** The name of the file on record the row shows a person, or null while it shows none. */
function currentFileOf(row: Element, cache: ScanCache): string | null {
  const current = shown(Array.from(row.querySelectorAll(RESUME_CURRENT)), cache);
  const name = (current?.querySelector(':scope > span')?.textContent ?? '').replace(/\s+/g, ' ').trim();
  return current === null || name === '' ? null : name;
}

/** The page reads a resume (module header): its "Parsing resume, please wait..." shows. */
function isBusy(doc: Document): boolean {
  return shown(Array.from(doc.querySelectorAll(RESUME_LOADING))) !== null;
}

/** The resume's upload as its row shows it (module header): 'pending' while the parse shows or the row names another
 *  file (or none), 'confirmed' once it names `fileName` as the file on record; null for any other input. */
function uploadState(input: HTMLInputElement, fileName: string): 'pending' | 'confirmed' | null {
  if (!input.matches(RESUME_INPUT)) return null;
  const row = resumeRowOf(input);
  if (row === null) return 'pending';
  const cache = newScanCache();
  if (shown(Array.from(row.querySelectorAll(RESUME_LOADING)), cache) !== null) return 'pending';
  const name = fileName.replace(/\s+/g, ' ').trim();
  return name !== '' && currentFileOf(row, cache) === name ? 'confirmed' : 'pending';
}

/** The resume's row shows a file on record (module header), whatever its name. */
function uploadHeld(input: HTMLInputElement): boolean {
  const row = resumeRowOf(input);
  return row !== null && currentFileOf(row, newScanCache()) !== null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Account pages
// ---------------------------------------------------------------------------------------------------------------------

function authState(doc: Document): ReturnType<NonNullable<Adapter['authState']>> {
  if (gateOf(doc) !== null) return 'email-gate';
  return verifyEmailShown(doc) ? 'email-code' : null;
}

/** The profile's "Create a login" (module header): githubinc-profile.frame-1.html's <h2 class="iCIMS_SubHeader
 *  iCIMS_SubHeader_Candidate">Create a login to access your application</h2> ... <input type="text"
 *  id="PersonProfileFields.Login" name="PersonProfileFields.Login" ... aria-required="true"> ("Email/Login"; "Login" on
 *  uscareers-nyu's), <input type="password" id="PersonProfileFields.Password" ...> and <input type="password"
 *  id="PersonProfileFields.Password_Confirm" ...> ("Password (Re-enter)"), in form#profileForm, sent with the profile by
 *  input#cp_form_submit_i, "Submit Profile". */
function createLoginOf(doc: Document): SignInForm | null {
  const step = stepOf(doc);
  if (step === null || !step.button.matches('#cp_form_submit_i')) return null;
  const { form, button } = step;
  const login = form.querySelector<HTMLInputElement>('input#PersonProfileFields\\.Login');
  const password = form.querySelector<HTMLInputElement>('input[type="password" i]#PersonProfileFields\\.Password');
  const confirm = form.querySelector<HTMLInputElement>('input[type="password" i]#PersonProfileFields\\.Password_Confirm');
  if (login === null || password === null || confirm === null) return null;
  // The profile asks for far more than an account (name, phone, address, resume): the press is the person's.
  return { email: login, password, confirm, terms: [], button, form, personPresses: true };
}

// ── snapshot build 2026-11-06 (core-x, item 2): "Create a login", a section of the profile ──
/** The profile's "Create a login" part (Adapter.accountSection): githubinc-profile.frame-1.html's <div role="group">
 *  <h2 class="iCIMS_SubHeader iCIMS_SubHeader_Candidate">Create a login to access your application</h2> <div
 *  class="iCIMS_ProfileFormTable iCIMS_Table"> holding the Email/Login, Password and Password (Re-enter) rows </div>
 *  </div> (nyu-profile.frame-1.html's the same, "Create a login"): the group around the declared create-account form's
 *  three boxes, inside the profile's form, holding no other control a person fills. Null where the step shows none, or
 *  where that group holds anything else (then the page pauses as an account's creation, as before). */
function accountSection(root: Element): Element | null {
  const form = createLoginOf(root.ownerDocument);
  if (form === null || form.form !== root || form.email === null) return null;
  const group = form.email.closest('[role="group"]');
  if (group === null || group === root || !root.contains(group)) return null;
  const boxes: Element[] = [form.email, form.password!, form.confirm!];
  if (!boxes.every((box) => group.contains(box))) return null;
  const others = Array.from(group.querySelectorAll('input:not([type="hidden" i]), select, textarea'))
    .filter((control) => !boxes.includes(control));
  return others.length === 0 ? group : null;
}

// ── jr6 ICIMS-04: the account part as rows (Adapter.accountRows) ──
/** Basic Information's pane (jr6-sentinel-basic-info.frame-1.html's div.iCIMS_BasicProfilePane[role=group]), labelled
 *  by its own h2#iCIMS_BasicProfilePane_Title "Create your profile". */
const BASIC_PROFILE_PANE = '.iCIMS_BasicProfilePane[role="group" i]';

/** The create-login's rows where no single element holds them alone (Adapter.accountRows): careers-sentinel's "Basic
 *  Information" (snapshot6 icims1: fixtures/icims/jr6-sentinel-basic-info.frame-1.html's <div
 *  class="iCIMS_BasicProfilePane" role="group" aria-labelledby="iCIMS_BasicProfilePane_Title"> <h2
 *  id="iCIMS_BasicProfilePane_Title"> Create your profile </h2> ..., whose table holds First Name, Middle Name, Last
 *  Name and Email beside the rows <div class="... iCIMS_TableRow ... iCIMS_FieldRow_PersonProfileFields.Login">,
 *  "...Password" and "...Password" (Re-enter)). Each box's own .iCIMS_TableRow, three rows, each holding its box alone,
 *  inside that pane (BASIC_PROFILE_PANE) in the step's form; null elsewhere: where accountSection's single group stands
 *  (githubinc's and uscareers-nyu's "Create a login"), where that group holds anything else (jr6 P2: the page then
 *  pauses as an account's creation, as before; icims-core.browser.test.ts holds it), or where the step shows no
 *  create-login. Jobright reads the same pane (~contents/sites/icims ./create-login findIcimsCreateLoginFields: the
 *  smallest container holding both password boxes, or h2#iCIMS_BasicProfilePane_Title's pane) and fills the other rows
 *  as ordinary fields. */
function accountRows(root: Element): readonly Element[] | null {
  if (accountSection(root) !== null) return null;
  const form = createLoginOf(root.ownerDocument);
  if (form === null || form.form !== root || form.email === null) return null;
  const boxes: Element[] = [form.email, form.password!, form.confirm!];
  const pane = form.email.closest(BASIC_PROFILE_PANE);
  if (pane === null || !root.contains(pane) || !boxes.every((box) => pane.contains(box))) return null;
  const rows = boxes.map((box) => box.closest('.iCIMS_TableRow'));
  if (rows.some((row) => row === null || !pane.contains(row)) || new Set(rows).size !== boxes.length) return null;
  const alone = rows.every((row, at) => Array.from(row!.querySelectorAll('input:not([type="hidden" i]), select, textarea'))
    .every((control) => control === boxes[at]));
  return alone ? rows as Element[] : null;
}

// ── jr6 ICIMS-07: the create-login's own password rules (Adapter.passwordRules) ──
/** The rules iCIMS lists under its password box, by each item's id (every jr6 profile and githubinc-profile.frame-1:
 *  <div id="PersonProfileFields.Password.MsgContainer" class="iCIMS_PasswordMsgContainer NoDisplay"> <div
 *  id="PersonProfileFields.Password.PasswordLoginSame">Your password cannot be the same as your login </div> <div
 *  id="PersonProfileFields.Password.passwordReqTitle" ...>Your password must have at least: </div> <ul
 *  class="iCIMS_PasswordRequirementsList"> <li id="PersonProfileFields.Password.Length">8 characters</li> <li
 *  id="...Alphabet">1 alphabetic</li> <li id="...LowerCase">1 lowercase</li> <li id="...UpperCase">1 uppercase</li>
 *  <li id="...Number">1 numeric</li> <li id="...Special">1 special character(s)</li> </ul></div>; 10 characters on
 *  uscareers-nyu's). Each class with the words that must name it: an item whose words differ is left out. */
const PASSWORD_CLASSES: ReadonlyArray<{ id: string; words: RegExp; requires: PagePasswordClass }> = [
  { id: 'Alphabet', words: /^\s*[1-9]\d?\s+alphabetic\b/i, requires: 'alpha' },
  { id: 'LowerCase', words: /^\s*[1-9]\d?\s+lower\s*case\b/i, requires: 'lower' },
  { id: 'UpperCase', words: /^\s*[1-9]\d?\s+upper\s*case\b/i, requires: 'upper' },
  { id: 'Number', words: /^\s*[1-9]\d?\s+numeric\b/i, requires: 'digit' },
  { id: 'Special', words: /^\s*[1-9]\d?\s+special\s+character/i, requires: 'special' },
];

/** The create-login's own password rules (Adapter.passwordRules; jr6 ICIMS-07), read from the list iCIMS keeps beside
 *  its password box (PASSWORD_CLASSES' snapshots), shown or not (the page shows it once the box has focus): the fewest
 *  characters ("8 characters"), each class it lists, and "cannot be the same as your login". Read fail open: a rule
 *  whose words this does not read is left out, and a form that is not iCIMS's create-login, or a list with no rule it
 *  reads, has none (null). The page's words only, never a value. Jobright reads no iCIMS list (its create-login types
 *  the stored password as it is); the owner's rule (16 characters, upper, lower, digit, special) passes every list the
 *  snapshots show. */
function passwordRules(form: SignInForm): PagePasswordRules | null {
  const password = form.password;
  if (password === null || !password.matches('input[type="password" i]#PersonProfileFields\\.Password')) return null;
  const doc = password.ownerDocument;
  const list = doc.getElementById('PersonProfileFields.Password.MsgContainer');
  if (list === null) return null;
  const words = (id: string) => (doc.getElementById(`PersonProfileFields.Password.${id}`)?.textContent ?? '')
    .replace(/\s+/g, ' ').trim();
  const length = /^([1-9]\d?)\s+characters?$/i.exec(words('Length'));
  const requires = PASSWORD_CLASSES.filter((each) => list.contains(doc.getElementById(`PersonProfileFields.Password.${each.id}`))
    && each.words.test(words(each.id))).map((each) => each.requires);
  const notLogin = list.contains(doc.getElementById('PersonProfileFields.Password.PasswordLoginSame'))
    && /\bcannot be the same as your login\b/i.test(words('PasswordLoginSame'));
  const rules: PagePasswordRules = { ...(length === null ? {} : { minLength: Number(length[1]) }),
    ...(requires.length === 0 ? {} : { requires }), ...(notLogin ? { notLogin: true as const } : {}) };
  return Object.keys(rules).length === 0 ? null : rules;
}

/** Sign-in Auto's form (module header): the gate's, or the profile's "Create a login". */
function signInForm(doc: Document, wall: SignInWall): SignInForm | null {
  if (wall === 'create-account') return createLoginOf(doc);
  const gate = gateOf(doc);
  if (gate === null || wall !== 'email-gate') return null;
  const email = gate.querySelector<HTMLInputElement>('input#email[name="css_loginName"]');
  const button = gate.querySelector<HTMLElement>('input#enterEmailSubmitButton[type="submit"]');
  if (email === null || button === null) return null;
  // fixtures/icims/gdms-email-gate's <input type="checkbox" id="accept_gdpr" aria-required="true">.
  const terms = Array.from(gate.querySelectorAll<HTMLInputElement>('input[type="checkbox"]#accept_gdpr'))
    .filter((box) => !box.checked);
  // GDMS's Next (class gdprAnswerSubmitButton, disabled) is enabled by the page once its GDPR box is ticked.
  const enables = button.classList.contains('gdprAnswerSubmitButton');
  return { email, password: null, confirm: null, terms, button, form: gate,
    ...(enables ? { enablesWhenFilled: true as const } : {}),
    ...(gateAsksMore(gate) ? { personPresses: true as const } : {}) };
}

// ---------------------------------------------------------------------------------------------------------------------
// jr6: iCIMS's dropdowns (their widget, label and parent), the date parts, and an IForm's words
// ---------------------------------------------------------------------------------------------------------------------

/** An iCIMS dropdown's trigger (jr6 ICIMS-01): every profile's Country, State/Province, Time Zone, consents, Suffix,
 *  School, Degree, Major and the blocks' Country and State, as snapshot6 draws them (fixtures/icims/jr6-ars-profile.html):
 *  <select id="-1_PersonProfileFields.AddressCountry" ... class="... dropdown-hide" icimsdropdown-enabled="1"
 *  icimsdropdown-ajax="1" icimsdropdown-search="1" ... data-ddd-child-link="PersonProfileFields.AddressState" ...><option
 *  ...></option></select><a id="-1_PersonProfileFields.AddressCountry_icimsDropdown" class="dropdown-select"
 *  aria-expanded="false" tabindex="0" aria-labelledby="label_-1_PersonProfileFields.AddressCountry" aria-required="true"
 *  role="combobox" ... aria-label="Country"><span id="-1_PersonProfileFields.AddressCountry_fakeSelected_icimsDropdown"
 *  class="dropdown-text"><span class="dropdown-placeholder">(the prompt)</span></span>...</a><div
 *  id="-1_PersonProfileFields.AddressCountry_icimsDropdown_ctnr" class="dropdown-container dropdown-invisible"
 *  aria-owns="..._dropdown-results" ...><input type="text" class="dropdown-search" ... placeholder="— Type to Search —"
 *  role="combobox" aria-autocomplete="list" aria-controls="..._dropdown-results"><div aria-live="polite"><ul
 *  id="-1_PersonProfileFields.AddressCountry_dropdown-results" class="dropdown-results" role="listbox"><li
 *  id="result-selectable_..._-1" class="dropdown-result result-selectable" role="option" dropdown-index="-1" ...>(the
 *  prompt)</li><li ... dropdown-index="0" ...>...</li>...</ul><div class="dropdown-loading hide" ...></div>...</div></div>.
 *  The select keeps one option at most (dropdowns.browser.test.ts): the list is the server's, drawn in the container. */
const DROPDOWN_ANCHOR = 'a.dropdown-select[role="combobox" i][id$="_icimsDropdown"]';
/** A result a person chooses (the prompt, dropdown-index -1, is none; the address lookup's "Enter manually" is -2). */
const DROPDOWN_RESULT = 'li.dropdown-result.result-selectable[role="option" i]:not([dropdown-index="-1"])';
/** The dropdown's loading bar while the server answers a query: <div class="dropdown-loading" style="width: 99%;"> in
 *  jr6-ars-profile-address.html, "dropdown-loading hide" once it answered. */
const DROPDOWN_LOADING = '.dropdown-loading:not(.hide)';
/** A query whose list shows no result this long after it is taken to have found nothing: Jobright polls about 15 times
 *  100 ms for an iCIMS dropdown's results (~contents/sites/icims ./client-search-widget, after openIcimsSearchDropdown). */
const DROPDOWN_EMPTY_MS = 1_500;

/** An iCIMS dropdown: its trigger, its hidden select and the select's id; null for any other control. */
function dropdownOf(control: Element): { anchor: HTMLElement; select: HTMLSelectElement; id: string } | null {
  if (!control.matches(DROPDOWN_ANCHOR)) return null;
  const id = control.id.slice(0, -'_icimsDropdown'.length);
  const select = control.ownerDocument.getElementById(id);
  if (select === null || select.localName !== 'select' || select.getAttribute('icimsdropdown-enabled') !== '1'
    || select.parentElement !== control.parentElement) return null;
  return { anchor: control as HTMLElement, select: select as HTMLSelectElement, id };
}

/** The answer a dropdown shows (WidgetDecl.shownAnswer): its shown text's words, '' while it shows its prompt (a
 *  .dropdown-placeholder), null without that element. */
function shownChoiceOf(shown: Element | null): string | null {
  if (shown === null) return null;
  if (shown.querySelector('.dropdown-placeholder') !== null) return '';
  return visibleText(shown, { singleLine: true, cap: TEXT_CAP_LABEL });
}

/** ICIMS-08: careers-ars's address lookup (jr6-ars-profile.html: <select id="-1_PersonProfileFields.AddressStreet1" ...
 *  class="... iCIMS_Forms_TypeToSearchTextFieldDropDown ... dropdown-hide" icimsdropdown-enabled="1" ...
 *  icimsdropdown-search="1" ... geolocation="">, its trigger "Address"): read as a list chosen from whole (its results,
 *  once opened, hold "Enter manually", dropdown-index -2: jr6-ars-profile-address.html's
 *  li#result-selectable_-1_PersonProfileFields.AddressStreet1_-2), never as a search typed into; the input that replaces
 *  it once chosen keeps its id and name (jr6-ars-profile-filled.html). Jobright handles it apart from other dropdowns
 *  (~contents/sites/icims ./operations, its AddressStreet1 branch: "enter manually", then the text box). */
function isAddressLookup(select: Element): boolean {
  return /(?:^|_)PersonProfileFields\.AddressStreet1$/.test(select.id);
}

/** The gate's phone Country Code (ars-gate-phone.html): <div class="country-code iCIMS_InfoData"> ... <a id="dropdown"
 *  class="dropdown-select" aria-expanded="false" tabindex="0" aria-label="Country Code — Make a Selection —"
 *  aria-required="true" role="combobox" aria-controls="dropdownOptions"><span id="dropdown-select-span"
 *  class="dropdown-text"><span class="dropdown-placeholder">...</span></span>...</a><div class="dropdown-container
 *  hidden" id="dropdownOptions"><div aria-live="polite"><input type="text" class="dropdown-search" id="countryCode"
 *  name="countryCodeSearch" ...><ul class="dropdown-results" name="countryCodeSelect" id="dropdownResults"
 *  role="listbox"><li class="dropdown-result result-selectable" role="option" dropdown-result="-1" ...>(the
 *  prompt)</li><li ... value="US" ... dropdown-result="US" aria-label="(+1) United States" ...>(+1) United States</li>
 *  ... (every country drawn at once)</ul></div></div>, under <label for="countryCode">Phone Country Code</label>. Its
 *  trigger and its container inside the gate; null for any other control. */
function gateCodeOf(control: Element): { anchor: HTMLElement; container: Element } | null {
  if (!control.matches('a#dropdown.dropdown-select[role="combobox" i][aria-controls]')) return null;
  const gate = control.closest('form#enterEmailForm');
  const container = control.ownerDocument.getElementById(control.getAttribute('aria-controls') ?? '');
  return gate !== null && container !== null && container.matches('.dropdown-container') && gate.contains(container)
    ? { anchor: control as HTMLElement, container } : null;
}

/** iCIMS's dropdowns as widgets (Adapter.widgetFor; jr6 ICIMS-01, -08, -18; FIXPLAN §6.5 item 1): the trigger opens the
 *  list with its own click (no activation: ENGINE E1), its aria-expanded says whether it is open, the container's search
 *  box takes a query (WidgetDecl.input), the results are the list's options but the prompt, the loading bar is its busy
 *  sign, and the trigger's shown text its answer. A remote search where the select says icimsdropdown-search="1"
 *  (the server pages the list: never drawn whole), else a list read whole once opened; the address lookup always the
 *  latter (isAddressLookup). The gate's Country Code is a list drawn whole. Jobright drives them the same way
 *  (~contents/sites/icims ./operations fillSearchSelectField and ./client-search-widget openIcimsSearchDropdown: open,
 *  type, wait for the results while the loading bar shows, click the matching result, read the shown text back). */
function widgetFor(control: Element): WidgetDecl | null {
  const dropdown = dropdownOf(control);
  if (dropdown !== null) {
    const { anchor, select, id } = dropdown;
    const doc = anchor.ownerDocument;
    const input = doc.getElementById(`${id}_icimsDropdown_ctnr`)?.querySelector<HTMLInputElement>('input.dropdown-search')
      ?? null;
    const search = select.getAttribute('icimsdropdown-search') === '1' && !isAddressLookup(select);
    return { kind: search ? 'typeahead-remote' : 'combobox', opener: anchor, expanded: anchor,
      ...(input === null ? {} : { input }),
      results: { list: () => doc.getElementById(`${id}_dropdown-results`), option: DROPDOWN_RESULT },
      busy: [DROPDOWN_LOADING], emptyAfterMs: DROPDOWN_EMPTY_MS,
      shownAnswer: () => shownChoiceOf(doc.getElementById(`${id}_fakeSelected_icimsDropdown`)),
      snapshot: 'fixtures/icims/jr6-ars-profile.html' };
  }
  const code = gateCodeOf(control);
  if (code === null) return null;
  const { anchor, container } = code;
  const input = container.querySelector<HTMLInputElement>('input.dropdown-search');
  const list = container.querySelector('ul.dropdown-results[role="listbox" i]');
  return { kind: 'combobox', opener: anchor, expanded: anchor, ...(input === null ? {} : { input }),
    ...(list === null ? {} : { results: { list,
      option: 'li.dropdown-result.result-selectable[role="option" i]:not([dropdown-result="-1"])' } }),
    drawnWhole: true, shownAnswer: () => shownChoiceOf(anchor.querySelector('#dropdown-select-span')),
    snapshot: 'fixtures/icims/ars-gate-phone.html' };
}

// ── ICIMS-10: the date parts ──
/** A date's three parts (nyu-profile.frame-1.html's employment block: <div class="iCIMS_Forms_Global
 *  iCIMS_Forms_DateOnlyField ..."> ... <div class="iCIMS_DateField-Month iCIMS_TableCell"><label
 *  id="label_-1_PersonProfileFields.rcf3214_Month" class="iCIMS_508_Label" for="...">Month</label><select
 *  id="-1_PersonProfileFields.rcf3214_Month" ... aria-labelledby="label_-1_PersonProfileFields.rcf3214
 *  label_-1_PersonProfileFields.rcf3214_Month" ...>, then iCIMS_DateField-Day's select ..._Date and
 *  iCIMS_DateField-Year's <input type="text" size="6" maxlength="4" id="..._Year" ...>, under the row's <label
 *  id="label_-1_PersonProfileFields.rcf3214">Start Date (if you do not know the day, enter 1)</label>; an IForm's date
 *  the same, icims_f_Date_Month, _Date and _Year, under words its form draws before it). */
const DATE_PARTS: ReadonlyArray<{ part: 'month' | 'day' | 'year'; control: string; cell: string; suffix: string }> = [
  { part: 'month', control: 'select', cell: 'iCIMS_DateField-Month', suffix: '_Month' },
  { part: 'day', control: 'select', cell: 'iCIMS_DateField-Day', suffix: '_Date' },
  { part: 'year', control: 'input', cell: 'iCIMS_DateField-Year', suffix: '_Year' },
];

/** A date part: which, its date's base id, and the element around the date's parts; null for any other control. */
function datePartOf(control: Element): { part: 'month' | 'day' | 'year'; base: string; date: Element } | null {
  for (const { part, control: tag, cell, suffix } of DATE_PARTS) {
    if (control.localName !== tag || !control.id.endsWith(suffix) || control.id.length === suffix.length) continue;
    if (control.parentElement?.classList.contains(cell) !== true) continue;
    const date = control.closest('.iCIMS_Forms_DateOnlyField');
    return date === null ? null : { part, base: control.id.slice(0, -suffix.length), date };
  }
  return null;
}

// ── ICIMS-14, -16 and the IForms' dates: the words an IForm draws ──
/** Whether an element holds a control of the form (a box, a list, a button). */
function holdsControl(el: Element): boolean {
  return el.matches('input, select, textarea, button') || el.querySelector('input, select, textarea, button') !== null;
}

/** Text with words in it (an &nbsp; alone has none). */
const hasWords = (text: string | null): boolean => (text ?? '').replace(/\s+/g, '') !== '';

/**
 * The words an IForm draws before a control as its caption (ICIMS-16 and the IForms' dates; Jobright reads an IForm's
 * labels from the text before a control, ~contents/sites/icims ./rules): walking out from the control, the nearest
 * element before it that holds words and no control (jr6-nyu-iform-offer.frame-2.html's <p>Please copy and paste your
 * cover letter below:</p> before the textarea's own <p>; jr6-sentinel-iform-selfid.frame-2.html's <span ...>Today's
 * Date</span><br> before the date's <span>), or the element whose own words stand before it (nyu-self-id-disability
 * .frame-2.html's <td ...>Date<br><span ...><div ... iCIMS_Forms_DateOnlyField ...>, a cell holding no other control);
 * in a table cell with nothing before it, the cell above it in the row before (edgewater-self-id-veteran.frame-2.html:
 * the row of "Your Name" and "Today's Date" over the row of their controls). Null at another control first, or with no
 * words before the control in its cell. `own`: the controls the caption names (a date's parts).
 */
function captionBefore(start: Element, form: Element, own: readonly Element[]): Element | null {
  const others = (el: Element) => Array.from(el.querySelectorAll('input, select, textarea, button'))
    .some((control) => !own.includes(control) && (control.getAttribute('type') ?? '').toLowerCase() !== 'hidden');
  for (let at: Element = start; at !== form && at.parentElement !== null; at = at.parentElement) {
    if (at.localName === 'td' || at.localName === 'th') {
      const row = at.parentElement;
      const above = row?.previousElementSibling;
      const index = row === null ? -1 : Array.from(row.children).indexOf(at);
      const cell = above?.localName === 'tr' ? above.children[index] ?? null : null;
      return cell !== null && !holdsControl(cell) && hasWords(cell.textContent) ? cell : null;
    }
    for (let node = at.previousSibling; node !== null; node = node.previousSibling) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (!hasWords(node.textContent)) continue;
        const parent = at.parentElement!;
        return parent !== form && !others(parent) ? parent : null;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const el = node as Element;
      if (el.localName === 'br') continue;
      if (holdsControl(el)) return null;
      if (hasWords(el.textContent)) return el;
    }
  }
  return null;
}

/** A self-identification IForm's title (ICIMS-14): the first element of the form, its buttons' part aside, holding
 *  "self-identification" in a short run of words and no control (jr6-sentinel-iform-selfid.frame-2.html and
 *  edgewater-self-id-veteran.frame-2.html: <p align="center"><span ...><strong>VOLUNTARY SELF-IDENTIFICATION OF VETERAN
 *  STATUS</strong></span></p>; nyu-self-id-disability.frame-2.html: <td ...>Voluntary Self-Identification of
 *  Disability</td>), or null where the form names none. */
function selfIdTitleOf(form: Element): Element | null {
  return Array.from(form.querySelectorAll('p, td, th, span, strong, b, div, center, h1, h2, h3'))
    .find((el) => el.closest('#staticSection') === null && !holdsControl(el)
      && /\bself[\s-]*identification\b/i.test(el.textContent ?? '')
      && (el.textContent ?? '').replace(/\s+/g, ' ').trim().length <= 100) ?? null;
}

/** An IForm radio's group (Adapter.groupOf; ICIMS-14): the element around every radio of its name in its IForm
 *  (jr6-sentinel-iform-selfid.frame-2.html's <span ...> around the three icims_f_Veteran radios, each in its <span
 *  class="... iCIMS_Forms_RadioGroup iCIMS_Forms_QVeteran ..."> followed by its words; nyu-self-id-disability.frame-2's
 *  <td> around the three icims_f_Disability radios), holding no other control; null for any other control. */
function groupOf(control: Element): Element | null {
  if (control.localName !== 'input' || (control as HTMLInputElement).type !== 'radio') return null;
  const form = control.closest(IFORM);
  const name = control.getAttribute('name') ?? '';
  if (form === null || name === '') return null;
  const radios = Array.from(form.querySelectorAll('input[type="radio" i]'))
    .filter((radio) => radio.getAttribute('name') === name);
  let at = control.parentElement;
  while (at !== null && at !== form && !radios.every((radio) => at!.contains(radio))) at = at.parentElement;
  if (at === null || at === form) return null;
  const others = Array.from(at.querySelectorAll('input, select, textarea')).some((other) => !radios.includes(other));
  return others ? null : at;
}

/** An IForm radio's words (Adapter.optionTextFor; ICIMS-14), no label element holding them: the text the page draws
 *  after its wrapper, up to the next line break or control (jr6-sentinel-iform-selfid.frame-2.html: <span class="...
 *  iCIMS_Forms_RadioGroup ..."><input type="radio" id="icims_f_Veteran_ProtectedVeteran" name="icims_f_Veteran" ...>
 *  </span> I IDENTIFY AS ONE OR MORE OF THE CLASSIFICATIONS OF PROTECTED VETERAN LISTED ABOVE<br>). Jobright reads the
 *  same words (~contents/sites/icims ./rules readChoiceText: the text after the input). Null for any other control. */
function optionTextFor(input: HTMLInputElement): string | null {
  if (input.type !== 'radio' || input.closest(IFORM) === null) return null;
  const wrapper = input.parentElement?.matches('.iCIMS_Forms_RadioGroup') === true ? input.parentElement : input;
  let words = '';
  for (let node = wrapper.nextSibling; node !== null; node = node.nextSibling) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (el.localName === 'br' || holdsControl(el)) break;
    }
    words += ` ${node.textContent ?? ''}`;
  }
  const text = words.replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
}

/** The element whose words label a control (Adapter.labelFor), where its own markup names none a person sees:
 *  - an iCIMS dropdown (ICIMS-03): its row's <label id="label_<select id>" for="<select id>"> (jr6-nyu-profile-parsed
 *    .frame-1.html's School, Degree and Major, whose trigger has an aria-label alone), else its row's label;
 *  - the gate's Country Code (ICIMS-03, -18): the label of the search box its container holds (ars-gate-phone.html's
 *    <label for="countryCode">Phone Country Code</label>);
 *  - a date part (ICIMS-10): its date's label (label_<base id>), else the words an IForm draws before the date;
 *  - an IForm's text box (ICIMS-16): the words drawn before it;
 *  - an IForm radio group's element (groupOf; ICIMS-14): its self-identification form's title.
 *  Null for any other control. */
function labelFor(control: Element): Element | null {
  const doc = control.ownerDocument;
  const dropdown = dropdownOf(control);
  if (dropdown !== null) {
    return doc.getElementById(`label_${dropdown.id}`)
      ?? control.closest('.iCIMS_TableRow')?.querySelector('.iCIMS_InfoField label') ?? null;
  }
  const code = gateCodeOf(control);
  if (code !== null) {
    return Array.from(doc.querySelectorAll('label[for]')).find((label) => {
      const named = doc.getElementById(label.getAttribute('for') ?? '');
      return named !== null && code.container.contains(named);
    }) ?? null;
  }
  const form = control.closest(IFORM);
  const part = datePartOf(control);
  if (part !== null) {
    const parts = Array.from(part.date.querySelectorAll('select, input'));
    return doc.getElementById(`label_${part.base}`) ?? (form === null ? null : captionBefore(part.date, form, parts));
  }
  if (form === null) return null;
  if (control.localName === 'textarea') return captionBefore(control, form, [control]);
  const radio = control.querySelector('input[type="radio" i]');
  return radio !== null && groupOf(radio) === control ? selfIdTitleOf(form) : null;
}

/** A date part's word after its date's label (Adapter.labelSuffix; ICIMS-10): month, day or year. */
function labelSuffix(control: Element): string | null {
  return datePartOf(control)?.part ?? null;
}

/** A date part's label is its date's, read before the part's own (Adapter.labelFirst; ICIMS-10): its own label[for]
 *  ("Month", "Day", "Year", a screen reader's alone) and its aria-labelledby name the date without the part. */
function labelFirst(control: Element): boolean {
  return datePartOf(control) !== null;
}

/** A dropdown is required where its select says so (Adapter.requiredFor; ICIMS-03): <select ... i_required="true"> or
 *  aria-required="true", which its trigger need not repeat. */
function requiredFor(control: Element): boolean {
  const select = dropdownOf(control)?.select;
  return select !== undefined && (select.getAttribute('i_required') === 'true'
    || select.getAttribute('aria-required') === 'true');
}

// ── ICIMS-02, -19: the control whose write resets another ──
/** The control a person sees for a select: an iCIMS dropdown's trigger, else the select itself. */
function controlOfSelect(select: Element): Element {
  const anchor = select.ownerDocument.getElementById(`${select.id}_icimsDropdown`);
  return anchor !== null && dropdownOf(anchor)?.select === select ? anchor : select;
}

/** The select behind a control: a dropdown's hidden select, or the control itself where it is a select. */
function selectBehind(control: Element): Element | null {
  return dropdownOf(control)?.select ?? (control.localName === 'select' ? control : null);
}

/**
 * The control whose write resets this one (Adapter.dependsOn):
 * - ICIMS-02: a dependent dropdown, by its select's data-ddd-parent-link, in its own block (the same id prefix:
 *   jr6-ars-profile.html's <select id="-1_PersonProfileFields.AddressState" ... data-ddd-parent-link=
 *   "PersonProfileFields.AddressCountry"> under -1_PersonProfileFields.AddressCountry, whose data-ddd-child-link names it
 *   back; each employment block's -<n>_PersonProfileFields.rcf3217 under its rcf3218, each school's EducationState under
 *   its EducationCountry: jr6-nyu-profile-parsed.frame-1.html). A country change reloads the State's list (the owner's
 *   saves: Country chosen, State reset); Jobright writes Country first and waits for the State list to settle
 *   (~contents/sites/icims ./operations fillCountry, ./utils waitForIcimsStateProvinceOptionsRefresh).
 * - ICIMS-19: "Please specify" (select#rcf3049, list="lists.sources" with selectsourcemsg="Please select a source",
 *   disabled until a source is chosen: jr6-ars-profile.html; enabled with its list: jr6-ars-profile-filled.html), under
 *   the source list in the row before it, "How did you hear about us?" (select#rcf3048), in every snapshot that shows it.
 * Each answer is the control a person sees for the parent (a dropdown's trigger, or a select); null for any other.
 */
function dependsOn(control: Element): Element | null {
  const select = selectBehind(control);
  if (select === null) return null;
  const doc = select.ownerDocument;
  const link = select.getAttribute('data-ddd-parent-link');
  if (link !== null && link !== '') {
    const prefix = /^-?\d+_/.exec(select.id)?.[0] ?? '';
    const parent = doc.getElementById(`${prefix}${link}`) ?? (prefix === '' ? null : doc.getElementById(link));
    const back = parent?.getAttribute('data-ddd-child-link') ?? '';
    const named = back !== '' && (select.id === back || select.id.endsWith(`.${back}`) || select.id.endsWith(`_${back}`));
    return parent !== null && parent.localName === 'select' && named ? controlOfSelect(parent) : null;
  }
  if (select.matches('select[list="lists.sources"][selectsourcemsg]')) {
    const row = select.closest('.iCIMS_TableRow');
    const before = row?.previousElementSibling;
    const source = before?.matches('.iCIMS_TableRow') === true ? before.querySelector('select') : null;
    return source !== null && source !== undefined ? controlOfSelect(source) : null;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// The posting, its entry, and what is never pressed
// ---------------------------------------------------------------------------------------------------------------------

/** The posting's own text: fixtures/icims/eastwestbank-posting.frame-1.html's <div class="iCIMS_JobContent">, holding
 *  its title, its facts and its sections (each <h2 class="iCIMS_InfoMsg iCIMS_InfoField_Job"> and <div
 *  class="iCIMS_InfoMsg iCIMS_InfoMsg_Job">), with its options' few words (Apply, Share, Email this job). */
function postingText(doc: Document): Element | null {
  return shown(Array.from(doc.querySelectorAll('.iCIMS_JobContent'))
    .filter((content) => content.querySelector('.iCIMS_InfoMsg_Job') !== null));
}

/** The posting the document's own address shows, or null (a fixture's srcdoc page compares nothing). */
function hereOf(doc: Document) {
  try {
    return parseIcimsUrl(new URL(doc.location.href));
  } catch {
    return null;
  }
}

/** Apply: <a href=".../jobs/13634/credit-reviewer-ii/job?mode=apply&apply=yes&in_iframe=1&hashed=..." class="iCIMS_Anchor
 *  iCIMS_Action_Button iCIMS_ApplyOnlineButton iCIMS_PrimaryButton" title="Apply for this job online">. */
function entryControl(doc: Document): HTMLElement | null {
  const here = hereOf(doc);
  const links = Array.from(doc.querySelectorAll<HTMLElement>('a.iCIMS_ApplyOnlineButton[href]')).filter((link) => {
    try {
      const target = new URL(link.getAttribute('href') ?? '', doc.baseURI);
      const read = parseIcimsUrl(target);
      return read !== null && read.page === 'posting' && target.searchParams.get('mode') === 'apply'
        && (here === null || read.applicationUrl === here.applicationUrl);
    } catch {
      return false;
    }
  });
  return shown(links);
}

/** The controls never pressed (module header), each from its snapshot. */
const NEVER_PRESSED = [
  // The posting's .iCIMS_JobOptions (eastwestbank-posting.frame-1): the share button, "Email this job to a friend", the
  // share widgets; "Log back in!" (a[href*="loginOnly=1"]); the footer's a.iCIMS_Faq_Link and "Powered by"; Apply.
  'a.iCIMS_ApplyOnlineButton', 'a.iCIMS_JobShareButton', 'a[href*="/referral"]', '.icimsSD_widget',
  'a[href*="loginOnly=1"]', 'a.iCIMS_Faq_Link', 'a[href*="icims.com/platform_help"]',
  // The steps' "Finish Later" (githubinc-candidate-questions: <input type="submit" id="quesp_form_save_i" name="save"
  // class="iCIMS_SecondaryButton" value="Finish Later">; nyu-voluntary-information's #eeop_form_save_i) and an IForm's
  // "Save & Return Later" (edgewater-self-id-veteran.frame-2: <input type="submit" name="icims_save">).
  'input[type="submit" i][name="save"]', 'input[type="submit" i][name="icims_save"]',
  // "Keep me logged in" (<input type="button" id="keepMeAliveButton" class="iCIMS_Button iCIMS_PrimaryButton">).
  'input#keepMeAliveButton',
  // The profile's social sign-ins (githubinc-profile.frame-1: <button type="button" id="icims-social-button-apple"
  // class="icims-social-login icims-social-apple iCIMS_Action_Button">Log in with Apple</button>, Indeed, LinkedIn,
  // Microsoft; Facebook and Google on uscareers-nyu's), its cloud uploads (<button type="button"
  // class="iCIMS_FileFieldButton iCIMS_SecondaryButton iCIMS_googleDriveButton">, iCIMS_dropboxButton,
  // iCIMS_oneDriveButton), "Replace Resume" and "Delete File" (<button ... class="small iCIMS_Button iCIMS_DeleteButton
  // iCIMS_SecondaryButton">) and a block's Delete (uscareers-rtiinc's <a class="iCIMS_Anchor" role="button"
  // aria-label="Delete Professional Experience (4)" id="rcf3211Button2_-2365311">).
  'button.icims-social-login', 'button.iCIMS_googleDriveButton', 'button.iCIMS_dropboxButton',
  'button.iCIMS_oneDriveButton', 'button.iCIMS_DeleteButton', 'a.iCIMS_Anchor[id*="Button2_"]',
  // An IForm's "Show Less (...)" (uscareers-nyu's US_Employment_Application: <input type="submit"
  // id="icims_gsd_Education_GL" name="icims_gsd_Education_GL" class="group-loop-remove" value="Show Less (Education)">).
  'input.group-loop-remove',
  // The header (nyu-submitted.frame-1): "Welcome page" (a.iCIMS_Anchor_Nav), "Dashboard | Logout"
  // (.iCIMS_userMenuLink a).
  'a.iCIMS_Anchor_Nav', '.iCIMS_userMenuLink a',
];

function neverPress(root: Element): Element[] {
  return Array.from(root.ownerDocument.querySelectorAll(NEVER_PRESSED.join(', ')));
}

/** The notices that look like errors and are none: the session's "You will be logged out in 60 seconds due to
 *  inactivity." (#logoutErrorMessage), the cookies notice (#iCIMS_NoCookiesMessage) and the share notice
 *  (#jobSocialOptionsErrMsg), all in nyu-submitted.frame-1. */
const NOT_ERRORS = '#logoutErrorMessage, #iCIMS_NoCookiesMessage, #jobSocialOptionsErrMsg';

/** The page's errors (module header): the gate's (<div id="iCIMS_ErrorMessage_login" class="iCIMS_ErrorMessage
 *  NoDisplay">, once shown), a step's message, each field row the page marks (githubinc-job-questions-error.frame-1:
 *  <div class="iCIMS_TableRow iCIMS_HasError"> ... <select id="Q6596" ...>), and the controls marked invalid. */
function errors(root: Element): Array<{ el: Element; fieldKeyHint?: string }> {
  const cache = newScanCache();
  const doc = root.ownerDocument;
  const messages = Array.from(doc.querySelectorAll('.iCIMS_ErrorMessage'))
    .filter((el) => el.closest(NOT_ERRORS) === null && el.closest('.iCIMS_ErrorRow.sr-only') === null
      && isUserVisible(el, cache) && (el.textContent ?? '').trim() !== '')
    .map((el) => ({ el }));
  const rows = Array.from(root.querySelectorAll('.iCIMS_TableRow.iCIMS_HasError')).flatMap((row) => {
    const control = row.querySelector('input:not([type="hidden" i]), select, textarea');
    return control !== null && isUserVisible(row, cache) ? [{ el: control }] : [];
  });
  return [...(genericAdapter.errors?.(root) ?? []), ...messages, ...rows];
}

/** The page after submitting shows its success message (module header): nyu-submitted.frame-1.html's <div
 *  tabindex="-1" class="iCIMS_Message iCIMS_SuccessMessage iCIMS_GenericMessage"> Your application has been submitted
 *  successfully. ...</div>. For the platforms' success signs (content/submitted.ts), after a Submit was pressed. */
export function icimsSubmitted(doc: Document): boolean {
  const cache = newScanCache();
  return Array.from(doc.querySelectorAll('.iCIMS_Message.iCIMS_SuccessMessage'))
    .some((message) => isUserVisible(message, cache));
}

/** The iCIMS adapter. */
export const icimsAdapter: Adapter = {
  id: 'icims',
  matchesUrl,
  canonicalApplicationUrl,
  detect,
  postingText,
  authState,
  signInForm,
  neverPress,
  errors,
  stepSignature,
  nextButton,
  submitButton,
  isFinalStep,
  // ── snapshot build 2026-11-06 (core-x, items 1 and 2) ──
  // Every step's own Submit is the step's Next while the bar shows a later step: the profile's "Submit Profile", the
  // questions' and EEO's "Submit" (STEP_FORMS), each by its own id. jr6 ICIMS-17: an IForm's own "Submit" (no id: its
  // name inside the IForm's own form), whose frame holds no bar, while its portal's facts say a later form or step
  // follows (laterStep, factsReading).
  stepSubmitNext: { buttons: ['input#cp_form_submit_i', 'input#quesp_form_submit_i', 'input#eeop_form_submit_i',
    `${IFORM} input[type="submit" i][name="icims_submit"]`], laterStep },
  chainStepFacts,
  accountSection,
  // ── jr6 (FIXPLAN §6.5) ──
  accountRows,
  passwordRules,
  widgetFor,
  labelFor,
  labelSuffix,
  labelFirst,
  requiredFor,
  groupOf,
  optionTextFor,
  dependsOn,
  applicationFrame,
  repeatables,
  uploadWidgets,
  // ── behaviour review 2026-11-06 (M5) ──
  isBusy,
  uploadState,
  uploadHeld,
  excluded,
  entryControl,
  // Apply is never pressed by a run (neverPress): the entry door presses that element alone.
  entryNeverPressed: true,
  // v5 p2-fill: the profile's résumé is read into the profile (nyu-profile.frame-1.html: "Provide your resume below to
  // auto-fill your profile"; githubinc-profile.frame-1.html: "Provide your resume below to pre-fill your profile.
  // Existing data in the form will be replaced", and "Parsing resume, please wait..."): the résumé is written first and
  // its parse waited for (isBusy shows it), so the run's answers go over the parse, never under it.
  quirks: { resumeParse: true },
};
