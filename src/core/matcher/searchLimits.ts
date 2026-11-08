/*
 * The limits of a typed search (v4, the owner's words of 2026-11-07: "you can try multiple with possible answer"),
 * shared by the core's candidate answers (candidates.ts), the message schema's query write and the DOM layer's search
 * (dom/widgets/typeahead.ts, dom/thresholds.ts). A module of its own, with no imports, so the schema and the content
 * script take these numbers without the matcher.
 * Snapshot round 2 (the owner, 2026-11-07: "there is no matched after with 3 different style value, last will be other
 * or don't write (user can set on setting it)"): a search types at most three differently written answers, one of each
 * style (MAX_STYLE_QUERIES), then, under settings.modes.noMatch 'other', one query for the list's own "Other"
 * (NO_MATCH_OTHER_QUERY): four at most.
 */

// s2 core-wd: three styles, then Other.

/** A search types at most this many candidate answers, one per style (candidates.ts: the full name, a short form, a
 *  reduced form). */
export const MAX_STYLE_QUERIES = 3;

/** What a search types, at most: the three styles, and the list's own "Other" (content/pass.ts searchField; the DOM
 *  layer also stops at its time budget, SEARCH_FIELD_BUDGET_MS). */
export const MAX_SEARCH_QUERIES = MAX_STYLE_QUERIES + 1;

/** The query typed for the list's own "Other" once the styles found nothing (settings.modes.noMatch 'other'): the
 *  extension's own word, never the page's or the profile's. Its results are read by the strict "Other" matcher alone
 *  (other.ts noMatchOtherIndex). */
export const NO_MATCH_OTHER_QUERY = 'Other';

// end s2 core-wd

/** A list with at least this many options (or one read only in part) is searched by typing rather than chosen from
 *  whole: Greenhouse's phone country lists 244 countries, its country questions about 200, its Yes/No, EEO and month
 *  lists a dozen at most (dom/widgets' searchesList; the planner's long-list search, plan/frame.ts planChoice). */
export const SEARCH_LIST_MIN_OPTIONS = 50;

/** A code typed as a query may be this short: a degree's "BS", a dial code's "+1". Every other query has at least
 *  TYPEAHEAD_MIN_QUERY_LENGTH (3) characters. */
export const CODE_QUERY_MIN_LENGTH = 2;
