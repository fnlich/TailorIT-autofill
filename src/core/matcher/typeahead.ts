/*
 * Remote typeahead queries (docs/design/core.md §4.11; the spec's Requirement A.5): a search that queries a server as
 * the person types (a school, a location) is tried with the value's candidate answers (candidates.ts, v4: at most
 * MAX_SEARCH_QUERIES), one at a time. A school's start as they always did: its canonical full name, the same without
 * a leading "The", its curated spellings ("UT Austin"), then its name without its campus ("University of Texas") and
 * its weighty words ("Texas Austin"); a place is tried as the profile writes it ("Austin, TX"), with its region's name
 * ("Austin, Texas"), its country's, and by its city alone ("Austin"). Each typed query is a guarded write with
 * provenance `profile` and transform `typeahead.query`; each result list goes through prepareOptions and matchOne, and
 * the first that reaches the fill band ends the search. The DOM layer owns the debounce, the cap and the time budget.
 * A long list searched for an option already planned on it is listSearch.ts's; one searched with no planned option
 * types these same candidates (plan/frame.ts planChoice).
 */
import type { IntendedValue } from '../types/intent';
import type { Vocab } from '../vocab/types';
import { searchCandidates } from './candidates';
import type { PlaceParts } from './place';

/** The queries to type, in order; `place` is the value's place, when it is one (Choice.place). */
export function typeaheadQueries(intended: IntendedValue, vocab: Vocab, place?: PlaceParts): string[] {
  return searchCandidates(intended, vocab, place);
}
