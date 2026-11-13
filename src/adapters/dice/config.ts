/*
 * Dice's configured adapter (DESIGN-NEW-ATS §1 "Dice", §5 builder B), every rule read from the owner's snapshots of
 * Dice's own Easy Apply wizard (Next.js and React Aria), four postings A to D by their uuid (fixtures/dice; the design's
 * ids in brackets):
 * - a-step2 [dice-0]: posting A, Step 2 of 3 "Additional Information": the Work Authorization select and the city
 *   typeahead, both answered (their answers cleared by the converter);
 * - a-review [dice-1]: posting A, Step 3 of 3 "Review your application", its Submit;
 * - b-step1 [dice-2]: posting B, Step 1 of 3 "Resume & Cover Letter": a résumé card ("New file") and the cover letter's
 *   drop zone (the header still the signed-out one: drawn late, the later steps of the same load are signed in);
 * - d-step1-menu [dice-8]: posting D on another load, Step 1 of 2, the résumé from the profile ("Uploaded to profile on
 *   <date>") with its File options menu open, the rest of the page inert;
 * - d-review [dice-7]: posting D, Step 3 of 3, review.
 * What no snapshot shows is left out: the select's open list and the city's suggestions (each relies on the standard
 * ARIA reading), the cover letter once a file is in, any error, the page after Submit, a screener question, the sign-in.
 *
 * The wizard has no id and its review no form: its root is the meter's parent. The résumé on step 1 is a card with no
 * file input while one is in (b-step1, d-step1-menu): nothing to fill there, so the scan has no résumé field and the
 * card's File options (Replace, Delete) are never pressed. Dice's sign-in is outside the matched path
 * (/dashboard/login), and no page state declares one: a signed-out person is left to sign in themselves.
 */
import { isUserVisible } from '../../dom/visibility';
import type { AtsConfig, ConfiguredHooks } from '../configured';
import { configuredHooks } from '../configured';
import type { WidgetDecl } from '../types';
import { parseDiceUrl } from './url';

/** The fixture cases the config was read from. */
export const DICE_SNAPSHOTS = ['a-step2', 'a-review', 'b-step1', 'd-step1-menu', 'd-review'] as const;

/** The wizard: the parent of the progress meter, holding the job's header, the meter and the step (all). */
const WIZARD = 'div:has(> div[role="meter"][aria-label="Application progress"])';
const METER = `${WIZARD} > div[role="meter"][aria-label="Application progress"]`;
/** The Work Authorization select: React Aria's trigger button beside its aria-hidden mirror select, in one group (a-step2).
 *  The city's group holds a button[aria-haspopup=listbox] too ("Show suggestions"), but no mirror select. */
const SELECT_GROUP = 'div.group[data-rac]:has(> div[data-testid="hidden-select-container"])';
const SELECT_TRIGGER = ':scope > button[aria-haspopup="listbox"]';
/** A step-1 card (Resume, Cover letter): its title row's text (b-step1, d-step1-menu). */
const CARD = 'div.rounded-lg.border';
const CARD_TITLE = ':scope > div.mb-2 > span.inline.font-medium';

/** The rules, each naming its snapshot. */
const RULES: AtsConfig = {
  platform: 'dice',
  ...(__PROVENANCE__ && { snapshots: DICE_SNAPSHOTS }),
  parse: parseDiceUrl,
  root: { css: WIZARD, ...(__PROVENANCE__ && { from: 'a-step2, b-step1, d-review' }) },
  // The select's question is a span[slot=label] (its star the required mark); its trigger is labelled by its chosen
  // value and that span together, so the question is read from its group instead.
  questions: [{ container: SELECT_GROUP, title: 'span[slot="label"]', ...(__PROVENANCE__ && { from: 'a-step2' }) }],
  // The step's h2 ("Resume & Cover Letter", "Additional Information", "Review your application"): without it a field
  // falls under the nearest heading before it, the "Learn more" disclosure's h3 for the city (a-step2).
  sections: [{ container: WIZARD, heading: 'h2', ...(__PROVENANCE__ && { from: 'a-step2, b-step1, d-review' }) }],
  widgets: [
    { match: SELECT_GROUP, root: true, kind: 'combobox', opener: 'button[aria-haspopup="listbox"]',
      expanded: 'button[aria-haspopup="listbox"]', parts: 'select', ...(__PROVENANCE__ && { from: 'a-step2' }) },
    // The city: a text combobox whose suggestions come from a search as it is typed (aria-autocomplete="list", a
    // "Powered by Google" template; its live region read "0 options available." then "4 options available.").
    { match: 'input[role="combobox"][name="candidateLocation"]', kind: 'typeahead-remote',
      ...(__PROVENANCE__ && { from: 'a-step2' }) },
  ],
  uploads: [
    // The cover letter's sr-only input, after its card, whose dashed button is what a person presses.
    { input: `${WIZARD} > form > input[type="file"]`, area: 'form', control: `${CARD}:has(+ input[type="file"]) > button[type="button"]`,
      ...(__PROVENANCE__ && { from: 'b-step1, d-step1-menu' }) },
  ],
  steps: {
    anchors: [{ css: METER, attr: 'aria-valuenow' }, { css: METER, attr: 'aria-valuemax' }],
    heading: `${WIZARD} h2`,
    next: `${WIZARD} > form button[type="submit"]`,
    ...(__PROVENANCE__ && { from: 'a-step2, b-step1, d-review' }),
  },
  neverPress: [
    { css: 'button[aria-label^="Set application wizard to step "]',
      ...(__PROVENANCE__ && { from: 'a-review, d-review' }) },
    { css: 'button[aria-label="File options"]', ...(__PROVENANCE__ && { from: 'b-step1, d-step1-menu' }) },
    { css: '[role="menu"] [role="menuitem"][data-key="replace"], [role="menu"] [role="menuitem"][data-key="delete"]',
      ...(__PROVENANCE__ && { from: 'd-step1-menu' }) },
    { css: 'button[data-testid="disclosure-trigger"]', ...(__PROVENANCE__ && { from: 'a-step2' }) },
    { css: 'div[data-testid="job-data"] a', ...(__PROVENANCE__ && { from: 'a-step2' }) },
    { css: 'nav[aria-label="Account"] button, nav[aria-label="Account"] [role="menuitem"]',
      ...(__PROVENANCE__ && { from: 'a-step2' }) },
    { css: '[data-testid="apply-button"], [data-testid="job-detail-save-btn"]',
      ...(__PROVENANCE__ && { from: 'a-step2' }) },
  ],
};

const ruled: ConfiguredHooks = configuredHooks(RULES);

/** The wizard's root on the page, as the rules find it. */
const wizardOf = (doc: Document): Element | null => ruled.detect(doc)?.formRoot ?? null;

/** The wizard's button whose own text is `word` ("Back", "Submit": a-step2, a-review), else null. */
function buttonNamed(root: Element, word: string): HTMLElement | null {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('button[type="button"]'))
    .find((button) => (button.textContent ?? '').replace(/\s+/g, ' ').trim() === word) ?? null;
}

/** Whether a person can see `el`. */
const shown = (el: Element | null): boolean => el !== null && isUserVisible(el);

/** The review's Submit: shown only where the step holds no form (a-review, d-review). */
function submitOf(root: Element): HTMLElement | null {
  return root.querySelector(':scope > form') === null ? buttonNamed(root, 'Submit') : null;
}

/** The select's answer as its trigger shows it, when it is one of the mirror select's own options (a-step2): the
 *  trigger names its value span first in its aria-labelledby. No snapshot shows the empty trigger, so anything else
 *  reads as no answer: '' (null would read the whole group's text, its question included). */
function selectAnswer(group: Element): (known: readonly string[]) => string | null {
  return () => {
    const trigger = group.querySelector(SELECT_TRIGGER);
    const valueId = (trigger?.getAttribute('aria-labelledby') ?? '').split(/\s+/)[0] ?? '';
    const value = valueId === '' ? null : group.ownerDocument.getElementById(valueId);
    const shown = (value?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const offered = Array.from(group.querySelectorAll('select option'))
      .map((option) => (option.textContent ?? '').replace(/\s+/g, ' ').trim()).filter((text) => text !== '');
    return offered.find((label) => label === shown) ?? '';
  };
}

/** The hooks no rule can say (DESIGN-NEW-ATS §1 "Dice"). */
const code: Partial<ConfiguredHooks> = {
  // The cover letter's input sits after its card, which shows its title (b-step1, d-step1-menu).
  labelFor(control) {
    if (control.matches('input[type="file"]')) {
      const card = control.previousElementSibling;
      return card !== null && card.matches(CARD) ? card.querySelector(CARD_TITLE) : null;
    }
    return ruled.labelFor?.(control) ?? null;
  },
  widgetFor(control): WidgetDecl | null {
    const decl = ruled.widgetFor?.(control) ?? null;
    return decl !== null && control.matches(SELECT_GROUP) ? { ...decl, shownAnswer: selectAnswer(control) } : decl;
  },
  // The review's Submit and every step's Back are type=button, told apart by their words alone (a-review, a-step2).
  submitButton: (root) => {
    const wizard = wizardOf(root.ownerDocument);
    return wizard === null ? null : submitOf(wizard);
  },
  neverPress(root) {
    const wizard = wizardOf(root.ownerDocument);
    const back = wizard === null ? null : buttonNamed(wizard, 'Back');
    return [...(ruled.neverPress?.(root) ?? []), ...(back === null ? [] : [back])];
  },
  // The step count varies (posting D: 2 steps on one load, 3 on another): the last is the one whose meter stands at
  // its maximum and that shows Submit with no form; a step whose form shows Next is not the last.
  isFinalStep(doc) {
    const wizard = wizardOf(doc);
    if (wizard === null) return 'unknown';
    const meter = wizard.querySelector(':scope > div[role="meter"]');
    const now = meter?.getAttribute('aria-valuenow');
    const max = meter?.getAttribute('aria-valuemax');
    const next = ruled.nextButton?.(wizard) ?? null;
    const submit = submitOf(wizard);
    if (shown(next) && !shown(submit)) return 'not-final';
    if (shown(submit) && !shown(next) && now !== null && now !== undefined && now === max) return 'final';
    return 'unknown';
  },
};

/** Dice's config: the rules, and the code they cannot say. */
export const DICE_CONFIG: AtsConfig = { ...RULES, code };
