/*
 * Remote typeahead queries (docs/design/core.md §4.11; the spec's Requirement A.5): a search that queries a server as
 * the person types (a school, a location) is tried with the value's candidate answers (candidates.ts; snapshot round 2:
 * one of each of three styles, MAX_STYLE_QUERIES, then perhaps the list's own "Other"), one at a time. A school's: its
 * full name without a leading "The", a curated short form ("UT Austin"), then its name without its campus ("University
 * of Texas"); a place is tried as the profile writes it ("Austin, TX"), with its region's name ("Austin, Texas"), then
 * by its city alone ("Austin"). Each typed query is a guarded write with
 * provenance `profile` and transform `typeahead.query`; each result list goes through prepareOptions and matchOne, and
 * the first that reaches the fill band ends the search. The DOM layer owns the debounce, the cap and the time budget.
 * A long list searched for an option already planned on it is listSearch.ts's; one searched with no planned option
 * types these same candidates (plan/frame.ts planChoice).
 */
import type { IntendedValue } from '../types/intent';
import type { Vocab } from '../vocab/types';
import { searchCandidates, type SearchExtras } from './candidates';
import type { PlaceParts } from './place';

/** The queries to type, in order; `place` is the value's place, when it is one (Choice.place); `extras` what else the
 *  search may type (a phone country's dial code, a referral source's kind: s2 core-wd). */
export function typeaheadQueries(intended: IntendedValue, vocab: Vocab, place?: PlaceParts, extras: SearchExtras = {}):
  string[] {
  return searchCandidates(intended, vocab, place, extras);
}
