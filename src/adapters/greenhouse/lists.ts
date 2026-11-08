/*
 * Greenhouse's stored lists (snapshot round 2, decisions 1 and 2): which react-select holds which of them. The lists
 * themselves live in the worker (background/stored-lists.ts: the content script's 1 MiB budget) and reach every scan by
 * their id (WidgetDecl.storedList, ScanOptions.storedLists), so each is planned on the run's first pass and chosen at
 * once (React's own choice through the page-world bridge by its label, else one opening of its list: dom/widgets'
 * fill.ts chooseKnown), never read whole first.
 * - greenhouse.phone-countries: the phone's country (fieldset.phone-input's #country), 244 "<Name> +<dial>".
 * - The EEOC block's fixed questions (div.eeoc__container: #gender, #hispanic_ethnicity, #veteran_status), each open
 *   in snapshot3's Pie Insurance captures (fixtures/greenhouse/s2-pie-eeo-6, -7 and -8.html). Race and
 *   disability_status are in no snapshot's open list: they are read when they show, as before.
 */
import type { StoredListId } from '../../shared/learned-lists';

/** The phone's country list's id. */
export const PHONE_COUNTRY_LIST: StoredListId = 'greenhouse.phone-countries';

/** The EEOC block's stored lists' ids, by their select's id (see the header). */
export const EEOC_LISTS: Readonly<Record<string, StoredListId>> = {
  gender: 'greenhouse.eeoc-gender',
  hispanic_ethnicity: 'greenhouse.eeoc-hispanic',
  veteran_status: 'greenhouse.eeoc-veteran',
};
