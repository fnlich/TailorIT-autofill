/*
 * The limits of a typed search (v4, the owner's words of 2026-11-07: "you can try multiple with possible answer"),
 * shared by the core's candidate answers (candidates.ts), the message schema's query write and the DOM layer's search
 * (dom/widgets/typeahead.ts, dom/thresholds.ts). A module of its own, with no imports, so the schema and the content
 * script take these numbers without the matcher.
 */

/** A search types at most this many candidate answers, one at a time (the DOM layer also stops at its time budget,
 *  SEARCH_FIELD_BUDGET_MS). */
export const MAX_SEARCH_QUERIES = 6;

/** A list with at least this many options (or one read only in part) is searched by typing rather than chosen from
 *  whole: Greenhouse's phone country lists 244 countries, its country questions about 200, its Yes/No, EEO and month
 *  lists a dozen at most (dom/widgets' searchesList; the planner's long-list search, plan/frame.ts planChoice). */
export const SEARCH_LIST_MIN_OPTIONS = 50;

/** A code typed as a query may be this short: a degree's "BS", a dial code's "+1". Every other query has at least
 *  TYPEAHEAD_MIN_QUERY_LENGTH (3) characters. */
export const CODE_QUERY_MIN_LENGTH = 2;
