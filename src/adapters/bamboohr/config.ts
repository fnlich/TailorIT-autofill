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
 *   only once opened, tied to the toggle by data-menu-id = data-helium-id, not by aria-controls: the widget helpers act
 *   on standard ARIA lists alone, so the person chooses (widget-phase-4) until the core can follow that tie;
 * - Submit sits outside the form, tied to it by form="job-application-form" (all three); Cancel beside it is a
 *   type=submit too, never pressed;
 * - never pressed: Cancel, "View Job Description", the share buttons, "Dismiss slidedown", "remove file" (the résumé),
 *   each dropdown's "Clear Selection", the date's picker button, and the "Job Openings" and privacy links.
 * Read by the standard rules: the text boxes (label for), the date box (placeholder mm/dd/yyyy), the two radio groups
 * (legend, aria-required on the fieldset) and the honeypot nickname_hpcsaf, hidden in an aria-hidden box and never a
 * field. Not in any snapshot: the résumé control before an upload (no file input is in any of the three: the file was
 * already in), the open menus, the date picker's dialog, error markup and the page after submitting. The reCAPTCHA box
 * is the person's.
 */
import type { AtsConfig } from '../configured/types';
import { parseBambooHrUrl } from './url';

/** The fixture cases the rules were read from (fixtures/bamboohr/<case>.html). */
export const BAMBOOHR_SNAPSHOTS = ['swyfft-form'] as const;

/** A Fabric dropdown's wrapper (bamboohr-0 to -2). */
const SELECT_FIELD = '[data-fabric-component="SelectField InputWrapper"]';

export const BAMBOOHR_CONFIG: AtsConfig = {
  platform: 'bamboohr',
  snapshots: BAMBOOHR_SNAPSHOTS,
  parse: parseBambooHrUrl,
  root: { css: 'form#job-application-form', from: 'bamboohr-0 to -2' },
  questions: [
    // <div data-fabric-component="SelectField InputWrapper"><div class="…SelectField-label-labelWrapper"><label class="…
    // Mui-required …" for="fab-select<n>">State<span aria-hidden="true" class="MuiFormLabel-asterisk"> *</span></label>
    // …<div class="fab-Select" data-fabric-component="Select">…<button class="fab-SelectToggle" data-menu-id="fab-menu66">
    { container: SELECT_FIELD, title: 'label', from: 'bamboohr-0 to -2' },
  ],
  required: [{ is: 'label.Mui-required', from: 'bamboohr-0 to -2' }],
  widgets: [{ match: `${SELECT_FIELD} div.fab-Select`, root: true, kind: 'combobox', opener: 'button.fab-SelectToggle',
    expanded: 'button.fab-SelectToggle', parts: 'select.chzn-ignore', from: 'bamboohr-0 to -2' }],
  submit: { css: 'button[type="submit"][form="job-application-form"]', from: 'bamboohr-0 to -2' },
  // v5 p2-detect: the page after submitting, in no snapshot: Jobright 1.25.2's rule 'bamboohr-confirmation' (its
  // ats-submission-rules), read as its behaviour: a paragraph saying the application was submitted beside a "Thank You"
  // heading in the same block, drawn where the form was (fixtures/synthetic/success/bamboohr.html).
  success: { css: 'p', text: /^Your application was submitted successfully[.!]?$/,
    companion: { css: 'h3', text: /^Thank You$/ }, from: "Jobright 1.25.2 ats-submission-rules 'bamboohr-confirmation'" },
  neverPress: [
    { css: '[data-fabric-component="ActionFooter"] button[data-fabric-component="TextButton"]', from: 'bamboohr-0 to -2' },
    { css: 'button[data-bi-id="careers-site-view-description-button"]', from: 'bamboohr-0 to -2' },
    { css: 'button[aria-label^="Share "]', from: 'bamboohr-0 to -2' },
    { css: 'button[aria-label="Dismiss slidedown"]', from: 'bamboohr-0 to -2' },
    { css: 'button[aria-label="remove file"]', from: 'bamboohr-0 to -2' },
    { css: 'button[aria-label="Clear Selection"]', from: 'bamboohr-0 to -2' },
    { css: '[data-fabric-component="DatePicker"] button[aria-haspopup="dialog"]', from: 'bamboohr-0 to -2' },
    { css: 'a[data-fabric-component="TextButton"]', from: 'bamboohr-0 to -2' },
  ],
};
