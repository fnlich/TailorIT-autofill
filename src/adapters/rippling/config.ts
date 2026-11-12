/*
 * Rippling Recruiting's configured adapter (DESIGN-NEW-ATS §1 "Rippling", §3), every rule read from the owner's
 * snapshots and named by them: rippling-0 and -1 (smartsuite, two loads, filled, a résumé in: fixture
 * rippling/smartsuite-uploaded is rippling-0), rippling-2 (qu-careers, empty, five custom questions: qu-careers-form),
 * rippling-3 (limble-solutions, filled) and rippling-4 (qu-careers' posting: qu-careers-posting). A Next.js app:
 * - root: main#main-content form, the page's only form (rippling-0 to -3); the posting page has none (rippling-4);
 * - the standard fields name themselves (aria-labelledby to span#field-<n>-label, aria-required); never their name,
 *   which changes on every load (rippling-0 against -1);
 * - the phone's country code (div[data-testid="phone_number-code"], a combobox whose only name is aria-label
 *   "Search") is titled by the phone field's own label, "Phone number", with "country code" after it (rippling-0, -2);
 * - each custom question (rippling-2) is titled by the p in its div.marginY--36 block, its control (a combobox
 *   aria-label "Select", or a bare text box) having no label of its own; aria-required marks them;
 * - the SMS consent is a radiogroup of div[role=radio] (aria-checked) over display:none native radios, which the
 *   standard reading leaves out (a radiogroup of native radios is the native scanner's, and those are hidden): declared
 *   a radio widget, its members the drawn radios, titled by the paragraph before its field ("Check Yes or No to
 *   indicate your agreement to receive text message updates ...", rippling-0 to -3);
 * - the uploads (Résumé, Cover letter): a display:none file input inside its drop zone, label[data-testid="resume"] or
 *   [data-testid="cover_letter"], titled by its field's label span, the résumé required by the star span after that
 *   label (rippling-0, -2); a file the page took shows as div[data-testid="chip"] in its field (rippling-0, -1, -3);
 * - Submit is "Apply", form button[type=submit][data-testid="Apply"]; Rippling marks it data-disabled and
 *   aria-disabled while the form is incomplete (rippling-2); jr7 RBP-7 (RBP7-02 = AUTO7-14's first half; snapshot7
 *   rippling1 and rippling2): Apply leads straight to the same path with step=confirmation (the progress bar at 50 % on
 *   the form, 100 % after), so the one-page form is final when Apply shows (the layer's default), as Submit mode says;
 * - never pressed: "Exit to job board", the AI opt-out "click here" (a link back to this form's own address), the
 *   legal links, the chip's "Preview file" and "remove" buttons, and on the posting its breadcrumb and share icons;
 * - the posting (rippling-4): its text div.ATS_htmlPreview, its "Apply now" the agent's entry.
 * - jr7 RBP-7 (RBP7-04 = AUTO7-14's second half; snapshot7 rippling1 and rippling2): the page after Apply, at the form's
 *   path with step=confirmation (url.ts: the confirmation, under the form's key), draws its action card, whose h5 says
 *   "You have successfully applied to <title>" (rippling2) or "... applied for <title>" (rippling1, en-GB): the drawn
 *   sign beside the address (Jobright 1.25.2's ats-submission-rules 'rippling-confirmation' reads "applied to" alone);
 * - jr7 RBP-7 (RBP7-05, RBP7-06; ./widgets.ts): the select controller's comboboxes (the phone's code, the custom and
 *   EEO questions) declared with their list as Jobright's lookup finds it, and the Location a remote search over places.
 * Left to the standard rules, as no snapshot shows them: every combobox's list open (its declared lookup is a live
 * check, Q7-1), the Location's suggestions, error markup, and the Turnstile container inside the form (div#turnstile-
 * container, empty in all five snapshot7 form captures: a challenge drawn there is a pause, RBP7-V1, a live check).
 * The résumé's help says it "will be parsed to fill in the application details"; it is the form's first field, so the
 * standard order writes it first, and what the parse may change afterwards is read back by the run's verification.
 * v5 p2-fill: since Phase 2 that help is the adapter's quirks.resumeParse (rippling-0, -2): the résumé is written first
 * and its parse waited for (dom/resume-parse.ts), so the rest of the form is written over the parse.
 */
import { configuredHooks } from '../configured';
import type { AtsConfig } from '../configured/types';
import { parseRipplingUrl } from './url';
import { ripplingWidgetFor } from './widgets';

/** The fixture cases the rules were read from (fixtures/rippling/<case>.html). */
export const RIPPLING_SNAPSHOTS = ['smartsuite-uploaded', 'qu-careers-form', 'qu-careers-posting'] as const;

/** One field's container, holding its label span and its control (rippling-0 to -3). */
const FIELD = 'div[data-testid="field"]';
/** The phone's country code (rippling-0 to -3). */
const PHONE_CODE = '[data-testid="phone_number-code"]';

/** The rules alone: every hook the configured layer builds from them, for `code` below to extend (as JazzHR's). */
const RULES: AtsConfig = {
  platform: 'rippling',
  snapshots: RIPPLING_SNAPSHOTS,
  parse: parseRipplingUrl,
  root: { css: 'main#main-content form', from: 'rippling-0 to -3' },
  questions: [
    // The phone field holds the code's own nested field (no label) and the number; its span#field-35-label is the
    // question for both: <div data-testid="field"><div><span id="field-35-label">Phone number</span><span>*</span>
    // </div><div>…<div data-testid="field">…<div data-testid="phone_number-code">…<input role="combobox" aria-label=
    // "Search">…<input aria-labelledby="field-35-label" data-testid="input-phone_number">
    { container: `${FIELD}:has(> div > span[id$="-label"]):has(${PHONE_CODE})`, title: 'span[id$="-label"]',
      from: 'rippling-0, rippling-2' },
    // <div class="marginY--36"><div class="paddingX--16"><div class="marginBottom--4"><p>What are your Salary
    // Expectations for the role?<div class="css-18yxg8r"></div></p>…<div data-testid="field">…<input aria-required="true">
    { container: 'div.marginY--36', title: 'div.marginBottom--4 > p', from: 'rippling-2' },
    // <div class="paddingX--16"><p>Check <strong>Yes</strong> or <strong>No</strong> to indicate …</p>
    // <div data-testid="field">…<div role="radiogroup" data-testid="sms_opt_in">
    { container: `${FIELD}:has([data-testid="sms_opt_in"])`, titleBefore: 'p', from: 'rippling-0 to -3' },
    // <div data-testid="field"><div><span id="field-8-label">Résumé</span><span>*</span></div><div>…
    // <label data-testid="resume" aria-labelledby="file-input-10 field-8-label"><input type="File" data-testid=
    // "input-resume"><button data-testid="test_button">Drop or select (.doc / .docx / .pdf)</button></label>
    { container: `${FIELD}:has(input[type="file" i])`, title: 'span[id$="-label"]', from: 'rippling-0, rippling-2' },
  ],
  // The star a person sees after a field's label span (rippling-0, -2: <span class="css-1av554z eun831x2">*</span>),
  // the only mark on the résumé, whose input says nothing.
  required: [{ mark: 'span[id$="-label"] + span', from: 'rippling-0, rippling-2' }],
  widgets: [{ match: 'div[role="radiogroup"][data-testid="sms_opt_in"]', root: true, kind: 'radio',
    members: 'div[role="radio"]', parts: 'input[type="radio"]', from: 'rippling-0 to -3' }],
  uploads: [{ input: 'input[type="file" i][data-testid="input-resume"], input[type="file" i][data-testid="input-cover_letter"]',
    control: 'label[data-testid="resume"], label[data-testid="cover_letter"]', area: FIELD,
    done: '[data-testid="chip"]',
    // The behaviour review of 2026-11-06 (M2), rippling-2 (smartsuite-uploaded): the chip's <div id="chip-<n>-content"
    // ...><div ...>(the file's name)</div></div>, the same words as its "Preview file : <name>" button's aria-label.
    name: 'div[id^="chip-"][id$="-content"]', from: 'rippling-0, rippling-2' }],
  submit: { css: 'form button[type="submit"][data-testid="Apply"]', from: 'rippling-0 to -3' },
  neverPress: [
    { css: 'button[data-testid="Exit to job board"]', from: 'rippling-0 to -3' },
    { css: 'main#main-content form a[href*="/apply?"]', from: 'rippling-2, rippling-3' },
    { css: 'a[href^="https://app.rippling.com/legal/"]', from: 'rippling-0 to -3' },
    { css: '[data-testid="chip"] [role="button"]', from: 'rippling-0' },
    { css: 'a[role="link"][data-testid^="/"]', from: 'rippling-4' },
    { css: 'span[role="button"][aria-label^="Share on"]', from: 'rippling-4' },
  ],
  posting: { text: 'div.ATS_htmlPreview', entry: 'button[data-testid="Apply now"]', from: 'rippling-4' },
  // jr7 RBP-7 (RBP7-04; snapshot7 rippling1, rippling2: fixtures/rippling/jr7-rippling{1,2}-confirmation): <main
  // id="main-content">…<div data-testid="action-card">…<h5>You have successfully applied for <title></h5> ("to" on
  // rippling2). Read only after an armed Apply (content/submitted.ts); the address is the first sign (url.ts).
  success: { css: 'main#main-content [data-testid="action-card"] h5', text: /^You have successfully applied (?:to|for)\s+\S/,
    from: 'jr7-rippling1-confirmation, jr7-rippling2-confirmation' },
  // v5 p2-fill: rippling-0 and -2 (smartsuite-uploaded, qu-careers-form): the résumé's help, "The résumé will be parsed
  // to fill in the application details".
  quirks: { resumeParse: true },
  code: {
    // rippling-0, -2: the country code shares the phone field's label with the number, so it reads "Phone number
    // country code", as Workable's does.
    labelSuffix: (control) => (control.closest(PHONE_CODE) !== null ? 'country code' : null),
    // jr7 RBP-7 (RBP7-02): no isFinalStep of its own any more. The behaviour review of 2026-11-06 (minor 5) read the
    // step as never final while no snapshot showed what followed Apply; snapshot7 shows the confirmation step after it
    // (module header), so the layer's one-page rule stands: final while Apply shows.
  },
};

/** The rule-built widget hook (the SMS radios), which `code` would otherwise replace (configured/index.ts spreads
 *  `code` last). */
const ruleWidgetFor = configuredHooks(RULES).widgetFor!;

export const RIPPLING_CONFIG: AtsConfig = {
  ...RULES,
  code: {
    ...RULES.code,
    // jr7 RBP-7 (RBP7-05, RBP7-06; ./widgets.ts): the rules' widgets first (the SMS radios), then the select
    // controller's comboboxes and the Location, whose lists no rule can declare.
    widgetFor: (control) => ruleWidgetFor(control) ?? ripplingWidgetFor(control),
  },
};
