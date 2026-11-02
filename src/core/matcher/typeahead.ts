/*
 * Remote typeahead query variants (docs/design/core.md §4.11; the spec's Requirement A.5). A school search that
 * queries a server as the person types is tried with at most four queries, in this order: the canonical full name,
 * the same without a leading "The", the best unambiguous alias (a curated acronym first, else the shortest alias of at
 * least two words), and the first two words that weigh at least 0.3, as the name writes them ("Texas Austin"). A place
 * (the current location: Choice.place) is tried as the profile writes it ("Austin, TX"), then with its region's name
 * ("Austin, Texas"), then by its city alone ("Austin"): a geocoder spells a region out ("Austin, Texas, United
 * States"), and a search that lists only the results whose label holds the typed text (Greenhouse's Location (City) on
 * the live BeyondTrust form, 2026-11-01) lists none for "Austin, TX"; the place matcher reads the results by their
 * parts, so the city alone never chooses another state's Austin. Each query has at least three characters and none
 * repeats another, ignoring case. Each typed query is a guarded write with provenance `profile` and transform
 * `typeahead.query`; each result list goes through prepareOptions and matchOne, and the first that reaches the fill
 * band ends the search. The DOM layer owns the debounce and the cap.
 */
import { TYPEAHEAD_MAX_QUERIES, TYPEAHEAD_MIN_QUERY_LENGTH, TYPEAHEAD_TOKEN_MIN_WEIGHT } from '../confidence';
import { normalize } from '../text/normalize';
import { NAME_PARTICLES, STOPWORDS } from '../text/tokens';
import type { IntendedValue } from '../types/intent';
import { isAcronym } from '../vocab/lookup';
import type { Vocab } from '../vocab/types';
import { tokenWeight } from './fuzzy';
import type { PlaceParts } from './place';
import { domainContext } from './prepare';
import type { MatchDomain } from './types';

const LEADING_THE = /^the\s+/i;
/** Where a name splits into words, keeping each word's own spelling. */
const WORD_BREAK = /[\s,;:/()[\]–—-]+/;
/** The articles and particles of other languages: kept in a name's key (they tell "De La Salle" from "La Salle"), but
 *  no word to search by ("Universidad de" finds every Spanish university). */
const PARTICLES: ReadonlySet<string> = new Set(NAME_PARTICLES);

/** The first two words of `name` that weigh at least 0.3 in the domain, as written, stopwords and particles left
 *  out. */
function weightyWords(name: string, domain: MatchDomain, vocab: Vocab): string {
  const context = domainContext(domain);
  const stopwords = STOPWORDS[context];
  const words: string[] = [];
  for (const word of name.split(WORD_BREAK)) {
    if (words.length === 2) break;
    const tokens = normalize(word, context).tokens.filter((token) => !stopwords.has(token) && !PARTICLES.has(token));
    if (tokens.length === 0) continue;
    if (tokens.every((token) => tokenWeight(token, domain, vocab) >= TYPEAHEAD_TOKEN_MIN_WEIGHT)) words.push(word);
  }
  return words.length === 2 ? words.join(' ') : '';
}

/** The best unambiguous alias: a curated acronym, else the shortest alias of at least two words. */
function bestAlias(intended: Extract<IntendedValue, { kind: 'entity' }>): string {
  const aliases = intended.surfaces.filter((surface) => !surface.ambiguous && surface.tier !== 'raw'
    && surface.tier !== 'primary' && surface.text !== intended.display);
  const acronym = aliases.find((surface) => surface.tier === 'curated' && isAcronym(surface.text));
  if (acronym) return acronym.text;
  const context = domainContext(intended.domain);
  const long = aliases.filter((surface) => normalize(surface.text, context).tokens.length >= 2)
    .sort((a, b) => a.text.length - b.text.length);
  return long[0]?.text ?? '';
}

/** A place's own queries, after its text: its city with its region's name, then its city alone (see the header). */
function placeQueries(place: PlaceParts | undefined): string[] {
  const city = place?.city?.trim() ?? '';
  if (city === '') return [];
  const region = place?.region?.name.trim() ?? '';
  return [region === '' ? '' : `${city}, ${region}`, city];
}

/** The queries to type, in order, at most four; `place` is the value's place, when it is one (Choice.place). */
export function typeaheadQueries(intended: IntendedValue, vocab: Vocab, place?: PlaceParts): string[] {
  let candidates: string[];
  switch (intended.kind) {
    case 'entity': {
      const name = intended.display.trim();
      const words = weightyWords(name, intended.domain, vocab);
      candidates = [name, name.replace(LEADING_THE, ''), bestAlias(intended), words];
      break;
    }
    case 'text':
      candidates = [intended.text.trim(), intended.text.trim().replace(LEADING_THE, ''), ...placeQueries(place)];
      break;
    case 'degree':
      candidates = [intended.display.trim()];
      break;
    default:
      candidates = [];
  }
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const query of candidates) {
    const text = query.replace(/\s+/g, ' ').trim();
    const folded = text.toLowerCase();
    if (text.length < TYPEAHEAD_MIN_QUERY_LENGTH || seen.has(folded)) continue;
    seen.add(folded);
    queries.push(text);
    if (queries.length === TYPEAHEAD_MAX_QUERIES) break;
  }
  return queries;
}
