/*
 * Workday's stored lists (snapshot round 2, decision 1: the owner's "store it and select at a once"): which dropdown
 * holds which of them. The lists themselves live in the worker (background/stored-lists.ts: the content script's 1 MiB
 * budget) and reach every scan by their id (WidgetDecl.storedList, ScanOptions.storedLists), so Country and State are
 * planned on the run's first pass and chosen with one opening of their list (dom/widgets' fill.ts chooseKnown).
 * - workday.countries: My Information's Country (div[data-automation-id=formField-country] > button[name=country],
 *   fixtures/workday/s2-exelixis-state-open.html's <button aria-haspopup="listbox" type="button" value="..."
 *   name="country" id="country--country">), its 250 rows ("Select One" and 249 countries, snapshot1's exelixis).
 * - workday.us-states: its State (formField-countryRegion > button[name=countryRegion], id="address--countryRegion"),
 *   only while the one Country dropdown of the same step shows WORKDAY_US chosen (the list a State shows depends on the
 *   country: no other country's was captured, so any other is read when it opens).
 */
import type { StoredListId } from '../../shared/learned-lists';
import { TEXT_CAP_LABEL } from '../../dom/thresholds';
import { visibleText } from '../../dom/visible-text';

/** The row Workday draws first in every dropdown's list, aria-disabled: no answer. */
export const WORKDAY_SELECT_ONE = 'Select One';

/** The country a State list holds the stored states for, as the Country dropdown shows it chosen. */
export const WORKDAY_US = 'United States of America';

/** The words a dropdown's button shows while its value names an option ('' while it is empty: "Select One"). */
function chosenWords(button: Element): string {
  if ((button.getAttribute('value') ?? '').trim() === '') return '';
  return visibleText(button, { singleLine: true, cap: TEXT_CAP_LABEL });
}

/** Whether a dropdown is My Information's State (formField-countryRegion > button[name=countryRegion]). */
function isState(button: HTMLButtonElement): boolean {
  const field = button.closest('[data-automation-id^="formField-"]');
  return field?.getAttribute('data-automation-id') === 'formField-countryRegion' && button.name === 'countryRegion';
}

/** The words the one Country dropdown of a State's step shows chosen ('' for none), or null when the step shows no
 *  single Country. */
function countryWordsFor(button: HTMLButtonElement): string | null {
  const scope = button.closest('[data-automation-id^="applyFlow"][data-automation-id$="Page"]') ?? button.ownerDocument;
  const countries = Array.from(scope.querySelectorAll(
    '[data-automation-id="formField-country"] button[aria-haspopup="listbox" i][name="country"]'));
  return countries.length === 1 ? chosenWords(countries[0]!) : null;
}

/** The id of a dropdown's stored list (application.ts widgetFor; see the header), or null. */
export function storedListOf(button: HTMLButtonElement): StoredListId | null {
  const field = button.closest('[data-automation-id^="formField-"]');
  if (field?.getAttribute('data-automation-id') === 'formField-country' && button.name === 'country') {
    return 'workday.countries';
  }
  return isState(button) && countryWordsFor(button) === WORKDAY_US ? 'workday.us-states' : null;
}

/** The review of round 2, L2: the value a State's list depends on (WidgetDecl.learnContext): the country its step's
 *  Country shows ('' for none), so a list learned for one country's State is never offered for another's; null for any
 *  other dropdown, or a State whose step shows no single Country. */
export function learnContextOf(button: HTMLButtonElement): string | null {
  return isState(button) ? countryWordsFor(button) : null;
}
