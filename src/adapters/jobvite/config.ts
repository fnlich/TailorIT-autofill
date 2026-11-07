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
 * What no snapshot shows is left out: the page after Send Application (no success sign), a rendered field error, a
 * checkbox, textarea or currency question, the cover letter's row once a file is in.
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
 * typed unasked, and the date asks the same (the person's: no rule fills a signature's date). No word on the page says
 * "signature": the pair's place at each form's end and its classes are all the markup shows.
 */
import type { AtsConfig, ConfiguredHooks } from '../configured';
import { configuredHooks } from '../configured';
import { parseJobviteUrl } from './url';

/** The fixture cases the config was read from. */
export const JOBVITE_SNAPSHOTS = ['ninjaone-posting', 'ninjaone-consent-empty', 'ninjaone-consent', 'ninjaone-step1',
  'ninjaone-step1-resume', 'ninjaone-step2', 'ninjaone-step3'] as const;

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
  snapshots: JOBVITE_SNAPSHOTS,
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
      from: 'ninjaone-consent' },
    // The gate before a residence is chosen: its one select ("Location of Residence and Language:") is filled like a
    // step; nothing is pressed there (choosing it shows the policy, the state above).
    { name: 'residence', when: 'body.jv-page-consentform form[name="consentForm"]',
      root: 'body.jv-page-consentform form[name="consentForm"]', from: 'ninjaone-consent-empty' },
  ],
  // The page body, not the form: both file inputs sit in body-level popovers outside form[name="scopeData.applyForm"].
  root: { css: 'body.jv-page-apply', holds: 'form[name="scopeData.applyForm"]', from: 'ninjaone-step1, ninjaone-step3' },
  uploads: [
    // The opener while no resume is in; once one is, its wrapper is ng-hide and the file's row stands for the upload.
    { input: RESUME_INPUT, area: 'body.jv-page-apply',
      control: '#attachResume > div:not(.ng-hide) > button[attachment-label="Resume"], #attachResume ul.jv-file-list > li > div.jv-file',
      done: '#attachResume ul.jv-file-list > li > div.jv-file', pending: '#attachResume ul.jv-file-list span.jv-spinner',
      // The behaviour review of 2026-11-06 (M2), ninjaone-step1-resume: <div class="jv-file"><span class="jv-spinner
      // ng-hide" ...></span><span ... ng-click="editOrPreviewResume()" ...>(the file's name)</span><a ...>remove</a>.
      // The area stays the page: the input sits in a body-level popover; the signs are #attachResume's alone.
      name: 'span[ng-click="editOrPreviewResume()"]',
      from: 'ninjaone-step1, ninjaone-step1-resume' },
    // The cover letter's row once a file is in is not shown in any snapshot: no sign is declared.
    { input: COVER_LETTER_INPUT, area: 'body.jv-page-apply', control: COVER_LETTER_OPENER, from: 'ninjaone-step1' },
  ],
  steps: {
    // The one rendered step (ng-if="showStep(<n>)"), named by its ng-form; its first header.
    anchors: [{ css: 'form[name="scopeData.applyForm"] > div.jv-apply-step[ng-form]', attr: 'ng-form' }],
    heading: 'form[name="scopeData.applyForm"] > div.jv-apply-step h3.jv-step-header',
    next: 'div.jv-apply-form-actions > button[type="button"][aria-label="Next"]',
    from: 'ninjaone-step1, ninjaone-step2, ninjaone-step3',
  },
  // On every step, ng-hide but on the last (ninjaone-step3, where Next is ng-hide instead).
  submit: { css: 'div.jv-apply-form-actions > button[type="submit"][aria-label="Send Application"]', from: 'ninjaone-step3' },
  neverPress: [
    { css: 'form[name="consentForm"] a.jv-button', from: 'ninjaone-consent, ninjaone-consent-empty' },
    { css: 'div.jv-current-openings a', from: 'ninjaone-step1' },
    { css: 'div.jv-apply-error a', from: 'ninjaone-step1' },
    // Each popover's "Dropbox" and "Type or Paste ..." (its "File" is the input's own label[for]).
    { css: 'div.jv-add-attachment[role="dialog"] > div.jv-add-attachment-item > span[role="button"]', from: 'ninjaone-step1' },
    { css: 'div.jv-add-attachment[role="dialog"] a.jv-close', from: 'ninjaone-step1' },
    { css: 'ul.jv-file-list span.jv-text-link, ul.jv-file-list a.jv-text-action', from: 'ninjaone-step1-resume' },
    { css: 'a.jv-button-apply-later', from: 'ninjaone-posting' },
    { css: 'div.jv-job-detail-share a', from: 'ninjaone-posting' },
  ],
  // The paste boxes: the resume editor in the form and each popover's paste form (ng-hide while closed).
  excluded: [{ css: 'div.jv-add-attachment-paste', from: 'ninjaone-step1' }],
  // The templates every step holds, ng-hide until a Next or Send Application finds a required field empty.
  errors: { css: 'div.jv-apply-error p[role="alert"]', from: 'ninjaone-step1' },
  // "Sending Application" with its spinner (span[ng-show="submitting"], ng-hide until the application is sent).
  busy: [{ css: 'button[aria-label="Send Application"] > span[ng-show="submitting"]', from: 'ninjaone-step3' }],
  posting: { text: 'div.jv-job-detail-description', entry: 'a.jv-button.jv-button-apply', from: 'ninjaone-posting' },
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
  labelFirst: (control) => signatureLabel(control) !== null,
  // A popover's input belongs to its opener's section, not to the last heading before the popover at the end of the
  // body ("Additional Files (optional)" for both).
  sections: (root) => [...(ruled.sections?.(root) ?? []), ...popoverSections(root)],
};

/** Jobvite's config: the rules, and the code they cannot say. */
export const JOBVITE_CONFIG: AtsConfig = { ...RULES, code };
