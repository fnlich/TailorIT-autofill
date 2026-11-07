/*
 * Pinpoint's configured adapter (DESIGN-NEW-ATS §1 "Pinpoint", §3), every rule read from the owner's snapshots and named
 * by them: pinpoint-0 (the application form, empty: fixture pinpoint/prophetx-form), pinpoint-1 (the posting:
 * prophetx-posting) and pinpoint-2 (the page after submitting: prophetx-thanks). A Rails page with React islands:
 * - root: form#application-form (pinpoint-0), four numbered fieldsets (sections by their legends) on one page;
 * - required: the class external-form__label--required on a title (a label, a question's title span, the résumé's
 *   title div), with no star character and, on the Yes/No radios and the single select, no required attribute;
 * - the Yes/No questions: radios named alike under a label.external-form__label whose for names no element, each radio
 *   tied by aria-labelledby to a hidden div, and no fieldset of their own (the nearest is the whole Questions
 *   fieldset, whose legend the standard reading took): one group each, its react island's div.pad-v-3 (groupOf), titled
 *   by its title span;
 * - the single select: a react-select (react-select__control, an input role=combobox named by its aria-label) beside a
 *   native twin select.hide-at-sm-block for narrow screens: declared a combobox for the page-world bridge's
 *   react-select code, its box the react-select__control;
 * - the résumé: input.file-field__input, its label.file-field__label "Attach Résumé / CV" its control, its question the
 *   div.external-form__label above it ("Résumé / CV", required by its class);
 * - Submit: button[type=submit][name=button] "Submit Application" in fieldset#application-fieldset-submit;
 * - never pressed: "Apply with LinkedIn", "Save application for later", "Register Your Interest", the back link to
 *   the posting, the cookie banner's and preferences' buttons and the "Cookies" link;
 * - the posting (pinpoint-1): its text #external-jobs-show-description, its first "Apply Now" (div#external-jobs-show-
 *   apply-now) the agent's entry; the page after submitting (pinpoint-2) is read by its address
 *   (/applications/thanks), and its section#application-thanks ("Thanks." / "Your application was received
 *   successfully.") is the success sign.
 * Each panel fades in (section.js-animated.animate__fadeIn, animate.css's fadeIn over --animate-duration 1s, from
 * opacity 0): a person, and the scan, see the form once it shows. Read by the standard rules: the text boxes, the
 * phone box, the textareas and the consent box (label for, required). Not in any snapshot: the react-select's open
 * menu, the phone's country list open (intl-tel-input's li.country items carry no ARIA role, so the country stays as
 * shown, the person's to change), the résumé once uploaded, error markup, and what "Save application for later" does.
 */
import type { AtsConfig } from '../configured/types';
import { parsePinpointUrl } from './url';

/** The fixture cases the rules were read from (fixtures/pinpoint/<case>.html). */
export const PINPOINT_SNAPSHOTS = ['prophetx-form', 'prophetx-posting', 'prophetx-thanks'] as const;

export const PINPOINT_CONFIG: AtsConfig = {
  platform: 'pinpoint',
  snapshots: PINPOINT_SNAPSHOTS,
  parse: parsePinpointUrl,
  root: { css: 'form#application-form', from: 'pinpoint-0' },
  questions: [
    // <div id="Shared::Form::Questions::Boolean-react-component-<uuid>"><div class="pad-v-3"><label class=
    // "external-form__label" for="…_0_boolean_answer"><span class="external-form__label--title
    // external-form__label--required">Are you legally authorized to work in the U.S.?</span></label>…<input type="radio"
    // id="…_0_boolean_answer_true" aria-labelledby="answer-label-0-true">
    // Its radios are one group (groupOf), not the whole fieldset#application-fieldset-questions around every question.
    { container: 'div[id^="Shared::Form::Questions::"] > div.pad-v-3',
      title: 'label.external-form__label > span.external-form__label--title', group: true, from: 'pinpoint-0' },
    // <div class="col-md-1-1"><div class="external-form__label"><div class="external-form__label--required">Résumé / CV
    // </div><span>Accepted file formats are .pdf and .docx</span></div><div id="Shared::Form::Filefield-react-component-…">
    { container: 'div.col-md-1-1:has(> div.external-form__label)', title: 'div.external-form__label > div',
      help: 'div.external-form__label > span', from: 'pinpoint-0' },
  ],
  required: [{ is: '.external-form__label--required', from: 'pinpoint-0' }],
  widgets: [{ match: 'div.react-select input.react-select__input[role="combobox"]', kind: 'combobox',
    expanded: 'input.react-select__input', box: 'div.react-select__control', bridge: 'react-select', from: 'pinpoint-0' }],
  uploads: [{ input: 'input.file-field__input[type="file"]', control: 'label.file-field__label', from: 'pinpoint-0' }],
  submit: { css: 'form#application-form button[type="submit"][name="button"]', from: 'pinpoint-0' },
  neverPress: [
    { css: 'a.external-button--linkedin', from: 'pinpoint-0' },
    { css: 'button#application-save-later-link', from: 'pinpoint-0' },
    { css: 'a[href*="/register-your-interest/"]', from: 'pinpoint-1' },
    { css: 'a.external-panel__back-link', from: 'pinpoint-0' },
    { css: 'button.cm__btn, button.pm__btn, a[data-cc]', from: 'pinpoint-1, pinpoint-2' },
  ],
  success: { css: 'section#application-thanks', from: 'pinpoint-2' },
  posting: { text: '#external-jobs-show-description', entry: '#external-jobs-show-apply-now a.external-button',
    from: 'pinpoint-1' },
};
