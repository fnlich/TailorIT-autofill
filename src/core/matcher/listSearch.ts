/*
 * A long list searched for an option already planned on it (docs/ARCHITECTURE.md "Greenhouse's react-selects"): a
 * combobox its adapter declared whose own text box filters its list as typed, with many options (Greenhouse's phone
 * country, 244 countries), has the option the planner chose on the list's whole read found by typing the option's own
 * words, as a remote typeahead's queries are typed (the DOM layer's searchForOption): "Canada" for "Canada +1". Of what
 * the list then shows, the one result that is that option, as the page shows it, is chosen; nothing is matched again.
 */
import { TYPEAHEAD_MIN_QUERY_LENGTH } from '../confidence';
import { cutInjected } from '../guard/injected';
import { qualifiedLabel } from '../text/keys';
import { withoutDialCode } from './dialCode';

/**
 * The text typed to find a planned option (see the header): the option's words as the page shows them, its injected
 * text cut, without the dial code a phone country picker shows beside a country's name ("Canada +1": "Canada"; "+44
 * United Kingdom": "United Kingdom"), white space collapsed. '' when that leaves fewer than three characters: the list
 * is then chosen from whole.
 */
export function optionQuery(label: string): string {
  const text = withoutDialCode(cutInjected(label).clean).replace(/\s+/g, ' ').trim();
  return text.length < TYPEAHEAD_MIN_QUERY_LENGTH ? '' : text;
}

/**
 * The one result of the search that is the planned option: the result whose label reads as the planned option's label
 * as the page shows it, injected text and all (so an option's injected look-alike is never it: the Phase 4 review,
 * R2), and that can be chosen. Null when none does, when it is disabled, or when several do (the search cannot tell
 * which of them was planned).
 */
export function searchedOption(results: readonly { label: string; disabled: boolean }[], planned: string):
  number | null {
  const wanted = qualifiedLabel(planned);
  const same = results.flatMap((result, index) => (qualifiedLabel(result.label) === wanted ? [index] : []));
  if (same.length !== 1 || results[same[0]!]!.disabled) return null;
  return same[0]!;
}
