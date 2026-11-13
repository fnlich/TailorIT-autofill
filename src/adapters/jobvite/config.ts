/*
 * Jobvite's configured adapter (DESIGN-NEW-ATS §1 "Jobvite", §5 builder B), every rule read from the owner's snapshots
 * of one company's AngularJS career site (fixtures/jobvite; the design's ids in brackets):
 * - ninjaone-posting [jobvite-6]: the posting (body.jv-page-job), its two Apply links the agent's entry;
 * - ninjaone-consent-empty [jobvite-7]: the apply address showing the Data Consent gate, its residence select empty;
 * - ninjaone-consent [jobvite-0]: the same gate once a residence is chosen, the policy shown with "I Accept" and
 *   "I Decline";
 * - ninjaone-step1 [jobvite-1, -5]: step 1 of 3, the resume, Personal Information and Additional Files;
 * - ninjaone-step1-resume [jobvite-2]: step 1 with a resume in (its file list row);
 * - ninjaone-step2 [jobvite-3]: step 2, Voluntary Self Identification (the equal-opportunity and veteran blocks, each
 *   ending in a "Your Name" / "Today's Date" signature pair);
 * - ninjaone-step3 [jobvite-4]: step 3, the screening questions, Send Application shown and Next hidden.
 * jr6 (FIXPLAN §6.7; the owner's snapshot6 of 2026-11-10, two more companies' career sites, Vista Higher Learning and
 * Sikich, fixtures/jobvite/jr6-*: JOBVITE_JR6_SNAPSHOTS) adds what those captures show: the page after Send Application
 * (jr6-vhl-confirmation, jr6-sikich-confirmation: the success sign, JV-24), the resume row's spinner while Jobvite reads
 * the file it parses (JV-18), and Jobvite's "invalid fields only" view of a step after a refused Next
 * (jr6-sikich-step1-invalid: the step signed by its anchor alone, JV-23); a checkbox group (jr6-vhl-step3-filled), a
 * textarea (jr6-vhl-step1) and an EEO step whose fields are all required (jr6-sikich-step2) are read by the scanner's
 * own rules. Still unseen: a rendered field error's text, a currency question, the cover letter's row once a file is
 * in, and a Work History or References section (JV-25).
 * jr7 BOARDS-7 (FIX7PLAN §6.13; the owner's snapshot7 jobvite1, fixtures/jobvite/jr7-jobvite1-*): the two file inputs
 * read their own question first, whatever their attachment popover shows (J7V-JV-1, `code.labelFirst`).
 *
 * Read by the scanner's own rules, so no rule here: every text, select and date control's label[for] with its
 * trailing star (span.jv-required-label) and required attribute; each radio group's legend; the sub-section a field
 * sits under (the nearest preceding visible heading, dom/sections.ts), which tells the two signature pairs of step 2
 * apart ("Equal Opportunity" / "Pre-Employment request for Veteran Classification", h4s inside sibling
 * div.jv-prescreen-element-sectiontitle blocks, never around the fields): declaring the step's h3 a section would
 * override it and fold both pairs into one section.
 * Core pass Z2 of 2026-11-06 (CORE-BLOCKERS item 28, the coordinator's decision): each of those blocks closes with a
 * name and a date (ninjaone-step2: in the self-identification form's fields, ng-model="applyData.ofccpFormMap", the
 * div.jv-form-field-input.JVA_NAME "Your Name" and .JVA_DATE "Today's Date", each labelled by its own label[for]), the
 * form's signature: their label is read with the word "signature" after it, before the label[for] alone (labelFirst),
 * so the name is the signature consent (resolver/labelRules.ts label.consent-signature), never the profile's full name
 * typed unasked, and the date is today's (labelRules label.signature-date, policy.ts signatureDateValue; jr6 JV-1). No
 * word on the page says "signature": the pair's place at each form's end and its classes are all the markup shows.
 */
import type { AtsConfig, ConfiguredHooks } from '../configured';
import { configuredHooks } from '../configured';
import { parseJobviteUrl } from './url';

/** The fixture cases the config was read from (each with its hand-written expectation). */
export const JOBVITE_SNAPSHOTS = ['ninjaone-posting', 'ninjaone-consent-empty', 'ninjaone-consent', 'ninjaone-step1',
  'ninjaone-step1-resume', 'ninjaone-step2', 'ninjaone-step3'] as const;

/** jr6 (FIXPLAN §6.7): the owner's snapshot6 captures of 2026-11-10 the jr6 rules were read from, converted again with
 *  the jr6 converter (its tests, jr6-jobvite.browser.test.ts, hold what each page shows; no expectation file). */
export const JOBVITE_JR6_SNAPSHOTS = ['jr6-vhl-posting', 'jr6-vhl-step1', 'jr6-vhl-step1-filled', 'jr6-vhl-step2',
  'jr6-vhl-step2-filled', 'jr6-vhl-step3-filled', 'jr6-vhl-confirmation', 'jr6-sikich-posting', 'jr6-sikich-step1',
  'jr6-sikich-step1-resume', 'jr6-sikich-step1-invalid', 'jr6-sikich-step2', 'jr6-sikich-step3',
  'jr6-sikich-step3-filled', 'jr6-sikich-confirmation'] as const;

/** The resume's file input and the cover letter's: each in one of two body-level popovers that share the id
 *  attachmentDropdown, outside the form (ninjaone-step1). */
const RESUME_INPUT = '#file-input-0';
const COVER_LETTER_INPUT = '#file-input-1';
/** The resume's section (#attachResume) and its heading, h3#jv-resume-header "Add Resume*", which the opener's
 *  aria-labelledby names (ninjaone-step1). */
const RESUME_HEADING = 'h3#jv-resume-header';
/** The cover letter's opener, inside div.jv-additional-files under h3 "Additional Files (optional)" (ninjaone-step1). */
const COVER_LETTER_OPENER = 'div.jv-additional-files button[attachment-label="Cover Letter"]';
const COVER_LETTER_HEADING = 'div.jv-additional-files > h3.jv-step-header';

/** The rules, each naming its snapshot. */
const RULES: AtsConfig = {
  platform: 'jobvite',
  ...(__PROVENANCE__ && { snapshots: [...JOBVITE_SNAPSHOTS, ...JOBVITE_JR6_SNAPSHOTS] }),
  parse: parseJobviteUrl,
  states: [
    // The gate once a residence is chosen: the policy and its "I Accept" (a submit button that posts the gate) show.
    // The agent's entry door presses it in either Consents mode; no run does, and "I Decline" never (neverPress).
    { name: 'consent', when: 'form[name="consentForm"] div[ng-if="showAcceptReject"] button[type="submit"]',
      auth: 'entry-choice', entry: 'form[name="consentForm"] div[ng-if="showAcceptReject"] button[type="submit"]',
      // Core pass Z1, item 27: "I Accept" submits the consent form, which holds nothing but it and the residence select
      // (ninjaone-consent: <form name="consentForm" method="post"> with <select id="jv-country-select"
      // ng-model="consentPolicyId"> and <button type="submit">; "Cancel" and "I Decline" are links).
      entrySubmits: { form: 'form[name="consentForm"]', selects: 'select#jv-country-select' },
      ...(__PROVENANCE__ && { from: 'ninjaone-consent' }) },
    // The gate before a residence is chosen: its one select ("Location of Residence and Language:") is filled like a
    // step; nothing is pressed there (choosing it shows the policy, the state above).
    { name: 'residence', when: 'body.jv-page-consentform form[name="consentForm"]',
      root: 'body.jv-page-consentform form[name="consentForm"]',
        ...(__PROVENANCE__ && { from: 'ninjaone-consent-empty' }) },
  ],
  // The page body, not the form: both file inputs sit in body-level popovers outside form[name="scopeData.applyForm"].
  root: { css: 'body.jv-page-apply', holds: 'form[name="scopeData.applyForm"]',
    ...(__PROVENANCE__ && { from: 'ninjaone-step1, ninjaone-step3' }) },
  uploads: [
    // The opener while no resume is in; once one is, its wrapper is ng-hide and the file's row stands for the upload.
    { input: RESUME_INPUT, area: 'body.jv-page-apply',
      control: '#attachResume > div:not(.ng-hide) > button[attachment-label="Resume"], #attachResume ul.jv-file-list > li > div.jv-file',
      done: '#attachResume ul.jv-file-list > li > div.jv-file', pending: '#attachResume ul.jv-file-list span.jv-spinner',
      // The behaviour review of 2026-11-06 (M2), ninjaone-step1-resume: <div class="jv-file"><span class="jv-spinner
      // ng-hide" ...></span><span ... ng-click="editOrPreviewResume()" ...>(the file's name)</span><a ...>remove</a>.
      // The area stays the page: the input sits in a body-level popover; the signs are #attachResume's alone.
      name: 'span[ng-click="editOrPreviewResume()"]',
      ...(__PROVENANCE__ && { from: 'ninjaone-step1, ninjaone-step1-resume' }) },
    // The cover letter's row once a file is in is not shown in any snapshot: no sign is declared.
    { input: COVER_LETTER_INPUT, area: 'body.jv-page-apply', control: COVER_LETTER_OPENER,
      ...(__PROVENANCE__ && { from: 'ninjaone-step1' }) },
  ],
  steps: {
    // The one rendered step (ng-if="showStep(<n>)"), named by its ng-form alone. jr6 JV-23: no heading. After a
    // refused Next Jobvite hides every valid section of the step (showInvalidField; jr6-sikich-step1-invalid shows
    // only "Preferred First Name*"), so the step's first shown header moved from "Add Resume*" to "Personal
    // Information" and the same step read as a new one; its ng-form (scopeData.step1..3) names it whatever shows.
    anchors: [{ css: 'form[name="scopeData.applyForm"] > div.jv-apply-step[ng-form]', attr: 'ng-form' }],
    next: 'div.jv-apply-form-actions > button[type="button"][aria-label="Next"]',
    ...(__PROVENANCE__ && { from: 'ninjaone-step1, ninjaone-step2, ninjaone-step3, jr6-sikich-step1, jr6-sikich-step1-invalid' }),
  },
  // On every step, ng-hide but on the last (ninjaone-step3, where Next is ng-hide instead).
  submit: { css: 'div.jv-apply-form-actions > button[type="submit"][aria-label="Send Application"]',
    ...(__PROVENANCE__ && { from: 'ninjaone-step3' }) },
  neverPress: [
    { css: 'form[name="consentForm"] a.jv-button',
      ...(__PROVENANCE__ && { from: 'ninjaone-consent, ninjaone-consent-empty' }) },
    { css: 'div.jv-current-openings a', ...(__PROVENANCE__ && { from: 'ninjaone-step1' }) },
    { css: 'div.jv-apply-error a', ...(__PROVENANCE__ && { from: 'ninjaone-step1' }) },
    // Each popover's "Dropbox" and "Type or Paste ..." (its "File" is the input's own label[for]).
    { css: 'div.jv-add-attachment[role="dialog"] > div.jv-add-attachment-item > span[role="button"]',
      ...(__PROVENANCE__ && { from: 'ninjaone-step1' }) },
    { css: 'div.jv-add-attachment[role="dialog"] a.jv-close', ...(__PROVENANCE__ && { from: 'ninjaone-step1' }) },
    { css: 'ul.jv-file-list span.jv-text-link, ul.jv-file-list a.jv-text-action',
      ...(__PROVENANCE__ && { from: 'ninjaone-step1-resume' }) },
    { css: 'a.jv-button-apply-later', ...(__PROVENANCE__ && { from: 'ninjaone-posting' }) },
    { css: 'div.jv-job-detail-share a', ...(__PROVENANCE__ && { from: 'ninjaone-posting' }) },
  ],
  // The paste boxes: the resume editor in the form and each popover's paste form (ng-hide while closed).
  excluded: [{ css: 'div.jv-add-attachment-paste', ...(__PROVENANCE__ && { from: 'ninjaone-step1' }) }],
  // The templates every step holds, ng-hide until a Next or Send Application finds a required field empty.
  errors: { css: 'div.jv-apply-error p[role="alert"]', ...(__PROVENANCE__ && { from: 'ninjaone-step1' }) },
  // "Sending Application" with its spinner (span[ng-show="submitting"], ng-hide until the application is sent).
  busy: [{ css: 'button[aria-label="Send Application"] > span[ng-show="submitting"]',
    ...(__PROVENANCE__ && { from: 'ninjaone-step3' }) },
    // jr6 JV-18: the resume row's spinner (<span class="jv-spinner ng-hide" ng-show="resumeLoading"> in its
    // div.jv-file), shown while Jobvite takes the file and reads it into the name, email and phone (those stay
    // ng-pristine in the captures: the page's parse, not a person's typing), so the parse wait (dom/resume-parse.ts)
    // and the step's settle hold until it hides.
    { css: '#attachResume ul.jv-file-list span.jv-spinner',
      ...(__PROVENANCE__ && { from: 'ninjaone-step1-resume, jr6-vhl-step1-filled, jr6-sikich-step1-resume' }) }],
  // jr6 JV-24: the page after Send Application (/applyConfirmation, which the address already reads as the
  // confirmation): its message's header beside the success icon. The selector and the words are Jobright 1.25.2's
  // facts for Jobvite (its ats-submission-rules, the jobvite rule: the header under .jv-page-message:has(
  // i.jv-icon-success) in article.jv-page-body[role=main], reading "Application Sent!"); the words are read at their
  // end, as Sikich's header reads "Well Done, Application Sent!" (jr6-sikich-confirmation) where VHL's reads
  // "Application Sent!" (jr6-vhl-confirmation).
  success: { css: 'article.jv-page-body[role="main"] .jv-page-message:has(i.jv-icon-success) > h2.jv-page-message-header',
    text: /Application Sent!$/, ...(__PROVENANCE__ && { from: 'jr6-vhl-confirmation, jr6-sikich-confirmation' }) },
  posting: { text: 'div.jv-job-detail-description', entry: 'a.jv-button.jv-button-apply',
    ...(__PROVENANCE__ && { from: 'ninjaone-posting, jr6-vhl-posting, jr6-sikich-posting' }) },
  // jr6 JV-18 (FIXPLAN §6.7 item 4): Jobvite reads the resume put into #file-input-0 and fills the name, email and
  // phone from it (jr6-vhl-step1-filled, ninjaone-step1-resume: those hold a value, ng-pristine, once the file row
  // shows), so a pass writes the resume before every other field and waits for the parse (the resume row's spinner
  // above) before it writes the rest over it. Jobright uploads it after the fields with no wait (its jobvite filler's
  // executeSiteSpecificSteps); this order is the safer one.
  quirks: { resumeParse: true },
};

const ruled: ConfiguredHooks = configuredHooks(RULES);

/** Each body-level popover with the heading of the section its opener sits in (ninjaone-step1). */
function popoverSections(root: Element): Array<{ el: Element; label: string }> {
  const doc = root.ownerDocument;
  return [[RESUME_INPUT, RESUME_HEADING], [COVER_LETTER_INPUT, COVER_LETTER_HEADING]].flatMap(([input, heading]) => {
    const popover = doc.querySelector(input!)?.closest('div.jv-add-attachment[role="dialog"]') ?? null;
    const label = (doc.querySelector(heading!)?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return popover === null || label === '' || !root.contains(popover) ? [] : [{ el: popover, label }];
  });
}

/** A name or date field of the self-identification form's closing pair (see the header), or null. */
function signaturePart(control: Element): Element | null {
  return control.closest('[ng-model="applyData.ofccpFormMap"] div.jv-form-field-input.JVA_NAME, '
    + '[ng-model="applyData.ofccpFormMap"] div.jv-form-field-input.JVA_DATE');
}

/** The pair's own label (ninjaone-step2: <label for="jv-field-f7" class="jv-form-field-label ..."> Your Name<span
 *  class="jv-required-label">*</span></label>, inside the field's div.jv-form-field-input.JVA_NAME), or null. */
function signatureLabel(control: Element): Element | null {
  const part = signaturePart(control);
  if (part === null || control.id === '') return null;
  return Array.from(part.querySelectorAll<HTMLLabelElement>('label.jv-form-field-label[for]'))
    .find((label) => label.htmlFor === control.id) ?? null;
}

/** The hooks no rule can say (DESIGN-NEW-ATS §1 "Jobvite": the inputs sit outside the form, far from their questions). */
const code: Partial<ConfiguredHooks> = {
  // The resume's input is labelled by its section's heading "Add Resume*" (its star the question's required mark),
  // the cover letter's by its opener "Add Cover Letter": the inputs' own label[for] ("File") is inside the closed
  // popover (ninjaone-step1).
  labelFor(control) {
    if (control.matches(RESUME_INPUT)) return control.ownerDocument.querySelector(RESUME_HEADING);
    if (control.matches(COVER_LETTER_INPUT)) return control.ownerDocument.querySelector(COVER_LETTER_OPENER);
    return signatureLabel(control) ?? ruled.labelFor?.(control) ?? null;
  },
  // The self-identification form's closing name and date (see the header): read as its signature, before their own
  // label[for] alone.
  labelSuffix: (control) => (signatureLabel(control) !== null ? 'signature' : ruled.labelSuffix?.(control) ?? null),
  // jr7 BOARDS-7 (J7V-JV-1; SP\jr7\audit\boards-verify.md): the two file inputs are labelled by their own question
  // (above) whatever their popover shows: while the person has the résumé's popover open (jr7-jobvite1-step1-b:
  // div#attachmentDropdown[role=dialog], aria-hidden="false", beside "Add Resume"), its own label[for] "File" shows, and
  // read first it made the required résumé an optional "File" of no category, never uploaded. The heading's star keeps
  // it required; the cover letter reads "Add Cover Letter" alike.
  labelFirst: (control) => control.matches(RESUME_INPUT) || control.matches(COVER_LETTER_INPUT)
    || signatureLabel(control) !== null,
  // A popover's input belongs to its opener's section, not to the last heading before the popover at the end of the
  // body ("Additional Files (optional)" for both).
  sections: (root) => [...(ruled.sections?.(root) ?? []), ...popoverSections(root)],
};

/** Jobvite's config: the rules, and the code they cannot say. */
export const JOBVITE_CONFIG: AtsConfig = { ...RULES, code };
