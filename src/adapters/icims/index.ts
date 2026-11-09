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
 * Nothing here reads, logs or sends a value.
 */
import { newScanCache, type ScanCache } from '../../dom/scan-cache';
import { visibleText } from '../../dom/visible-text';
import { isUserVisible } from '../../dom/visibility';
import { genericAdapter } from '../generic';
import type { Adapter, SignInForm, SignInWall } from '../types';
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
  'fixtures/icims/nyu-submitted.html'] as const;

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
/** Every step the owner's snapshots' bars name (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06: the ten portals' li#Step_<step>): the profile, the
 *  candidate questions, the person's forms, EEO, the job's questions and the portal's and the job's submittal forms. */
const STEP_IDS: ReadonlySet<string> = new Set(['Step_profileStep', 'Step_personQuestionsStep', 'Step_personFormsStep',
  'Step_eeoStep', 'Step_jobQuestionsStep', 'Step_perPortalSubmittalFormsStep', 'Step_perJobSubmittalFormsStep']);

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

/** The bar's item after the current one, when a person can see it (Adapter.stepSubmitNext.laterStep): the step the
 *  current step's Submit leads to. Null on the last step, with no bar, or with one certainBarOf does not read. */
function laterStep(doc: Document): Element | null {
  const bar = certainBarOf(doc);
  if (bar === null) return null;
  const later = bar.items[bar.items.indexOf(bar.current) + 1];
  return later !== undefined && isUserVisible(later) ? later : null;
}

/** 'final' on the bar's last step, 'not-final' while it shows a later step a person can see, 'unknown' with no bar, or
 *  one it cannot read with certainty (module header; core-x item 1: a bar a page could make lie, a second bar, an item
 *  of no known step, an item twice, a later step hidden, is no word on the step's finality). */
function isFinalStep(doc: Document): 'final' | 'not-final' | 'unknown' {
  if (stepOf(doc) === null) return 'unknown';
  const bar = certainBarOf(doc);
  if (bar === null) return 'unknown';
  if (bar.items.at(-1) === bar.current) return 'final';
  return laterStep(doc) !== null ? 'not-final' : 'unknown';
}

/** The step's Submit on a step that is not the last (module header): the step machine's Next. */
function nextButton(root: Element): HTMLElement | null {
  const step = stepOf(root.ownerDocument);
  return step !== null && step.form === root && isFinalStep(root.ownerDocument) === 'not-final' ? step.button : null;
}

/** The step's Submit on the last step (module header): the application's Submit, never clicked but by its door. */
function submitButton(root: Element): HTMLElement | null {
  const step = stepOf(root.ownerDocument);
  return step !== null && step.form === root && isFinalStep(root.ownerDocument) === 'final' ? step.button : null;
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
  }));
}

/** Each file field's input with its visible "My Computer" button: nyu-profile.frame-1.html's <div tabindex="0"
 *  class="iCIMS_FileFieldButton iCIMS_SecondaryButton iCIMS_resumeUpload"><label for="PortalProfileFields.Resume_File"
 *  ... aria-hidden="true" class="iCIMS_508_Label">My Computer (Opens new window)</label><input type="file"
 *  id="PortalProfileFields.Resume_File" ... tabindex="-1" aria-required="true" ...> ... <span aria-hidden="true"
 *  class="iCIMS_FileFieldText">My Computer</span></div>. A field showing its current file instead (githubinc-profile:
 *  the buttons in .upload-buttons.iCIMS_NoDisplay, "Replace Resume" shown) has none. */
/** A file field's upload buttons the page hides because it holds a file already (githubinc-profile.frame-1.html, a
 *  resume read: <div id="PortalProfileFields.Resume_UploadButtons" class="upload-buttons iCIMS_NoDisplay"> beside the
 *  current file's name and "Replace Resume"): its input is no field until the person replaces the file. And (core-x,
 *  item 2) the profile's "Create a login" part (accountSection): its login is never filled from the profile, it follows
 *  Sign-in mode. */
function excluded(root: Element): Element[] {
  const cache = newScanCache();
  const account = accountSection(root);
  return [...Array.from(root.querySelectorAll('.upload-buttons')).filter((buttons) => !isUserVisible(buttons, cache)),
    ...(account === null ? [] : [account])];
}

function uploadWidgets(root: Element): Array<{ control: Element; input: HTMLInputElement }> {
  const cache = newScanCache();
  return Array.from(root.querySelectorAll<HTMLInputElement>('div.iCIMS_FileFieldButton > input[type="file" i]'))
    .flatMap((input) => {
      const control = input.parentElement!;
      return isUserVisible(control, cache) ? [{ control, input }] : [];
    });
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

/** The resume input's row, or null for any other input (or one in no row). */
function resumeRowOf(input: Element): Element | null {
  return input.matches(RESUME_INPUT) ? input.closest('.iCIMS_TableRow') : null;
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
  // questions' and EEO's "Submit" (STEP_FORMS), each by its own id. An IForm's own form (input[name=icims_submit], no
  // id) is not named: its frame holds no bar.
  stepSubmitNext: { buttons: ['input#cp_form_submit_i', 'input#quesp_form_submit_i', 'input#eeop_form_submit_i'],
    laterStep },
  accountSection,
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
