/*
 * BambooHR's configured adapter (DESIGN-NEW-ATS §1 "BambooHR", §3), every rule read from the owner's snapshots and named
 * by them: bamboohr-0 and -1 (one page load, filled) and bamboohr-2 (a second load, fixture bamboohr/swyfft-form). One
 * page, /careers/<id>:
 * - root: form#job-application-form (novalidate), which holds every field but not Submit;
 * - required: the label's class Mui-required beside its aria-hidden star span (16 labels): the inputs carry no required
 *   attribute, and the hidden star is no label text, so the standard reading found none of them required;
 * - the five Fabric dropdowns (State, Country, Highest Education Obtained, Gender, Ethnicity): a div.fab-Select inside
 *   a "SelectField InputWrapper", opened by its button.fab-SelectToggle (aria-haspopup, aria-expanded), with a hidden
 *   native select.chzn-ignore holding the one chosen value: declared as a combobox widget titled by the wrapper's label,
 *   its native select the widget's own part. Its list is a role=menu of role=menuitem options drawn at the body's end
 *   only once opened, tied to the toggle by data-menu-id, not by aria-controls (only while open); jr7 RBP-7 (RBP7-14;
 *   ./widgets.ts, snapshot7 bamboohr1 with State's menu open): the declaration names that menu as its list, so the
 *   widget helpers read and choose from it;
 * - Submit sits outside the form, tied to it by form="job-application-form" (all three); Cancel beside it is a
 *   type=submit too, never pressed;
 * - never pressed: Cancel, "View Job Description", the share buttons, "Dismiss slidedown", "remove file" (the résumé),
 *   each dropdown's "Clear Selection", the date's picker button, and the "Job Openings" and privacy links.
 * Read by the standard rules: the text boxes (label for), the date box (placeholder mm/dd/yyyy), the two radio groups
 * (legend, aria-required on the fieldset) and the honeypot nickname_hpcsaf, hidden in an aria-hidden box and never a
 * field. Not in any snapshot: the date picker's dialog and error markup. The reCAPTCHA box is the person's (a
 * checkbox reCAPTCHA v2 on every snapshot7 form: BambooHR is the Queue tab's, never Run auto-apply's, FIX7PLAN D-5).
 * jr7 RBP-7 (FIX7PLAN §6.12; snapshot7 bamboohr1 and bamboohr2, fixtures/bamboohr/jr7-bamboohr{1,2}-*: each application at
 * one address, its posting view, its form and its page after submitting drawn in place):
 * - RBP7-11: the posting view's text (div.BambooRichText) and its "Apply for This Job"
 *   (button[data-bi-id="careers-site-apply-button"], one on each posting view), the agent's entry alone (Jobright 1.25.2's
 *   BambooHR preFillForm presses the same button, by its words); the configured layer offers it only while no form shows;
 * - RBP7-12: quirks.formInPlace: the form is drawn in place at the posting's address, so only this adapter claims the
 *   page (never the generic one, which took the share box "Link to This Job" for a form) and the document is watched for
 *   the form for its life;
 * - RBP7-13: the résumé before an upload: "Resume*" (a p) above div[data-fabric-component="FileUpload"], its hidden
 *   input[type=file][required] beside its "Choose File*" toggle button; once the page holds a file, its
 *   [data-fabric-component="FileUploadList"] (bamboohr2's filled capture) whose "remove file" is never pressed;
 * - RBP7-10 (= AUTO7-07): the page after submitting draws an h2 "Thank You" (Fabric's Headline) beside its paragraph, not
 *   the h3 Jobright's rule names: the companion is either.
 */
import { configuredHooks } from '../configured';
import type { AtsConfig } from '../configured/types';
import { parseBambooHrUrl } from './url';
import { withFabricMenu } from './widgets';

/** The fixture cases the rules were read from (fixtures/bamboohr/<case>.html). */
export const BAMBOOHR_SNAPSHOTS = ['swyfft-form'] as const;

/** A Fabric dropdown's wrapper (bamboohr-0 to -2). */
const SELECT_FIELD = '[data-fabric-component="SelectField InputWrapper"]';
/** jr7 RBP-7 (RBP7-13): the résumé's upload (snapshot7 bamboohr1, bamboohr2). */
const FILE_UPLOAD = 'div[data-fabric-component="FileUpload"]';

/** The rules alone: every hook the configured layer builds from them, for `code` below to extend (as JazzHR's). */
const RULES: AtsConfig = {
  platform: 'bamboohr',
  ...(__PROVENANCE__ && { snapshots: BAMBOOHR_SNAPSHOTS }),
  parse: parseBambooHrUrl,
  root: { css: 'form#job-application-form', ...(__PROVENANCE__ && { from: 'bamboohr-0 to -2' }) },
  questions: [
    // <div data-fabric-component="SelectField InputWrapper"><div class="…SelectField-label-labelWrapper"><label class="…
    // Mui-required …" for="fab-select<n>">State<span aria-hidden="true" class="MuiFormLabel-asterisk"> *</span></label>
    // …<div class="fab-Select" data-fabric-component="Select">…<button class="fab-SelectToggle" data-menu-id="fab-menu66">
    { container: SELECT_FIELD, title: 'label', ...(__PROVENANCE__ && { from: 'bamboohr-0 to -2' }) },
    // jr7 RBP-7 (RBP7-13): <div data-fabric-component="Flex"><p data-fabric-component="BodyText">Resume*</p><div
    // data-fabric-component="FileUpload">…<button type="button">…<span>Choose File*</span></button>…<p
    // data-fabric-component="BodyText">No file selected</p>…<input type="file" aria-label="file-input" required="">
    { container: `div[data-fabric-component="Flex"]:has(> ${FILE_UPLOAD})`, title: 'p[data-fabric-component="BodyText"]',
      ...(__PROVENANCE__ && { from: 'jr7-bamboohr1-form-blank, jr7-bamboohr2-form-blank' }) },
  ],
  required: [{ is: 'label.Mui-required', ...(__PROVENANCE__ && { from: 'bamboohr-0 to -2' }) }],
  widgets: [{ match: `${SELECT_FIELD} div.fab-Select`, root: true, kind: 'combobox', opener: 'button.fab-SelectToggle',
    expanded: 'button.fab-SelectToggle', parts: 'select.chzn-ignore',
      ...(__PROVENANCE__ && { from: 'bamboohr-0 to -2' }) }],
  // jr7 RBP-7 (RBP7-13): the résumé's hidden input, its "Choose File*" toggle (never pressed by a run), and the page's
  // list of the file it holds (<div data-fabric-component="FileUploadList">, bamboohr2's filled capture).
  uploads: [{ input: `${FILE_UPLOAD} input[type="file"]`, control: 'div[data-fabric-component="FileUploadToggle"] button',
    area: FILE_UPLOAD, done: '[data-fabric-component="FileUploadList"]',
    ...(__PROVENANCE__ && { from: 'jr7-bamboohr1-form-blank, jr7-bamboohr2-form-blank, jr7-bamboohr2-form-filled' }) }],
  submit: { css: 'button[type="submit"][form="job-application-form"]',
    ...(__PROVENANCE__ && { from: 'bamboohr-0 to -2' }) },
  // v5 p2-detect: Jobright 1.25.2's rule 'bamboohr-confirmation' (its ats-submission-rules), read as its behaviour: a
  // paragraph saying the application was submitted beside a "Thank You" heading in the same block, drawn where the form
  // was (fixtures/synthetic/success/bamboohr.html). jr7 RBP-7 (RBP7-10 = AUTO7-07): snapshot7 bamboohr1 and bamboohr2
  // draw <div data-fabric-component="Flex"><h2 data-fabric-component="Headline">Thank You</h2><p
  // data-fabric-component="BodyText">Your application was submitted successfully</p></div>: an h2, which Jobright's
  // rule (an h3) misses too, so the companion is either heading.
  success: { css: 'p', text: /^Your application was submitted successfully[.!]?$/,
    companion: { css: 'h2, h3', text: /^Thank You$/ },
    ...(__PROVENANCE__ && { from: "Jobright 1.25.2 ats-submission-rules 'bamboohr-confirmation'; jr7-bamboohr1-confirmation, jr7-bamboohr2-confirmation" }) },
  neverPress: [
    { css: '[data-fabric-component="ActionFooter"] button[data-fabric-component="TextButton"]',
      ...(__PROVENANCE__ && { from: 'bamboohr-0 to -2' }) },
    { css: 'button[data-bi-id="careers-site-view-description-button"]',
      ...(__PROVENANCE__ && { from: 'bamboohr-0 to -2' }) },
    { css: 'button[aria-label^="Share "]', ...(__PROVENANCE__ && { from: 'bamboohr-0 to -2' }) },
    { css: 'button[aria-label="Dismiss slidedown"]', ...(__PROVENANCE__ && { from: 'bamboohr-0 to -2' }) },
    { css: 'button[aria-label="remove file"]', ...(__PROVENANCE__ && { from: 'bamboohr-0 to -2' }) },
    { css: 'button[aria-label="Clear Selection"]', ...(__PROVENANCE__ && { from: 'bamboohr-0 to -2' }) },
    { css: '[data-fabric-component="DatePicker"] button[aria-haspopup="dialog"]',
      ...(__PROVENANCE__ && { from: 'bamboohr-0 to -2' }) },
    { css: 'a[data-fabric-component="TextButton"]', ...(__PROVENANCE__ && { from: 'bamboohr-0 to -2' }) },
  ],
  // jr7 RBP-7 (RBP7-11): <div class="BambooRichText">…</div> and <button type="button"
  // data-bi-id="careers-site-apply-button" data-fabric-component="Button"><span>Apply for This Job</span></button>.
  posting: { text: 'div.BambooRichText', entry: 'button[data-bi-id="careers-site-apply-button"]',
    ...(__PROVENANCE__ && { from: 'jr7-bamboohr1-posting, jr7-bamboohr2-posting' }) },
  // jr7 RBP-7 (RBP7-12): the form drawn in place at the posting's address (module header).
  quirks: { formInPlace: true },
};

/** The rule-built widget hook (the Fabric dropdowns), which `code` would otherwise replace (configured/index.ts spreads
 *  `code` last). */
const ruleWidgetFor = configuredHooks(RULES).widgetFor!;

export const BAMBOOHR_CONFIG: AtsConfig = {
  ...RULES,
  code: {
    // jr7 RBP-7 (RBP7-14; ./widgets.ts): each Fabric dropdown's declaration with its menu as its list.
    widgetFor: (control) => withFabricMenu(ruleWidgetFor(control)),
  },
};
