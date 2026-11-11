/*
 * Places (docs/design/core.md §4.11): the results of a location search (Greenhouse's "Location (City)", whose geocoder
 * lists "Austin, Texas, United States") against the person's place ("Austin, TX"), which no text stage can match: the
 * generic domain knows no region names. A result's label is read as its parts, split at commas. The first is the
 * city, compared by its key. Each later part is read whole as a region (the USPS and Canada Post codes and names of
 * regions.json) or a country (countries.json), a code of three letters or fewer only when it is written in capitals;
 * anything else (a county, "England", a postal code) is left unread, unless it is the person's own region as they
 * wrote it. A result is the person's place when:
 * - its city is theirs;
 * - no part it reads conflicts with their place (another region, another country, a region of another country); a
 *   part that reads as both a region and a country ("Georgia") conflicts only when both readings do;
 * - it names what their place says: their region when they have one, else their country.
 * Exactly one such result is chosen (stage alias, rule place, MATCH_PLACE, in the fill band: a search chooses it);
 * several leave the field blank, ambiguous-options, with them as suggestions, unless they all read the same. A result
 * whose city is theirs and that conflicts with nothing, but names less (no region where they have one), scores
 * MATCH_PLACE_PARTIAL, below the fill line: a list chooses it flagged, a search never does. Anything else is no match,
 * so "Austin, Minnesota, United States" is never "Austin, TX". Only chooseable options take part, by their clean
 * labels; one whose label had injected text cut is capped and flagged as every stage's is.
 */
import { MATCH_PLACE, MATCH_PLACE_PARTIAL, MAX_SUGGESTIONS } from '../confidence';
import type { Match } from '../types/match';
import { keyFor } from '../vocab/lookup';
import type { RegionEntity, Vocab } from '../vocab/types';
import { noMatch } from './cascade';
import { chooseable } from './prepare';
import { stageHit } from './rank';
import type { PreparedOption, PreparedOptions } from './types';

/** The person's place as the profile holds it (PlaceRef's parts): a city, and its region and country when known. */
export interface PlaceParts {
  city?: string;
  region?: { code?: string; name: string };
  /** ISO 3166-1 alpha-2. */
  country?: string;
}

/** jr6 RULES R3 (O2): an address line or a postal code, and the places a result that starts with it names after it
 *  (Choice.street). */
export interface StreetParts {
  text: string;
  /** The person's city, their state's code and name: a result names one of them after the text. */
  places: string[];
}

/** The person's place, read for comparing. */
interface Person {
  /** The city's key. */
  city: string;
  /** Their region in the region table, when it names exactly one. */
  region: RegionEntity | null;
  /** Their region's code and name as keys, for a region the table does not hold. */
  regionKeys: ReadonlySet<string>;
  /** Their country (alpha-2): the profile's, else their region's. */
  country: string | null;
}

/** What one later part of a result's label reads as. */
interface PartReading {
  key: string;
  regions: RegionEntity[];
  /** Alpha-2 codes. */
  countries: string[];
}

/** How a result compares with the person's place. */
type Verdict = 'full' | 'partial' | 'none';

const defined = (text: string | undefined): text is string => text !== undefined && text.trim() !== '';

/** The regions a key names in the region table. */
function regionsOf(vocab: Vocab, key: string): RegionEntity[] {
  if (key === '') return [];
  return vocab.lookup('region', key).flatMap((hit) => {
    const entity = vocab.entity(hit.id);
    return entity?.kind === 'region' ? [entity] : [];
  });
}

/** The countries a key names in the country table, as alpha-2 codes. */
function countriesOf(vocab: Vocab, key: string): string[] {
  if (key === '') return [];
  return vocab.lookup('country', key).flatMap((hit) => {
    const entity = vocab.entity(hit.id);
    return entity?.kind === 'country' ? [entity.alpha2] : [];
  });
}

/** The person's place for comparing; null without a city. */
function personOf(place: PlaceParts, vocab: Vocab): Person | null {
  const city = defined(place.city) ? keyFor(place.city, 'region') : '';
  if (city === '') return null;
  const regionKeys = new Set([place.region?.code, place.region?.name].filter(defined).map((text) => keyFor(text, 'region'))
    .filter((key) => key !== ''));
  const given = defined(place.country) ? place.country.trim().toUpperCase() : null;
  const regions = [...regionKeys].flatMap((key) => regionsOf(vocab, key))
    .filter((region) => given === null || region.country === given);
  const region = new Set(regions.map((entity) => entity.id)).size === 1 ? regions[0]! : null;
  return { city, region, regionKeys, country: given ?? region?.country ?? null };
}

/** A later part of a result's label as a region or a country; a short code counts only in capitals ("IN", not "in"). */
function readPart(text: string, vocab: Vocab): PartReading {
  const key = keyFor(text, 'region');
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length <= 3 && letters !== letters.toUpperCase()) return { key, regions: [], countries: [] };
  return { key, regions: regionsOf(vocab, key), countries: countriesOf(vocab, keyFor(text, 'country')) };
}

/** How one result's label compares with the person's place (see the header). */
function verdictOf(label: string, person: Person, vocab: Vocab): Verdict {
  const [city = '', ...rest] = label.split(',').map((part) => part.trim());
  if (keyFor(city, 'region') !== person.city) return 'none';
  let regionNamed = false;
  let countryNamed = false;
  for (const part of rest) {
    if (part === '') continue;
    const read = readPart(part, vocab);
    if (read.regions.length === 0 && read.countries.length === 0) {
      // A region the table does not hold, written as the person wrote theirs.
      if (person.region === null && person.regionKeys.has(read.key)) regionNamed = true;
      continue;
    }
    const regionConflicts = (region: RegionEntity) => (person.region !== null && region.id !== person.region.id)
      || (person.country !== null && region.country !== person.country);
    const countryConflicts = (country: string) => person.country !== null && country !== person.country;
    if (read.regions.every(regionConflicts) && read.countries.every(countryConflicts)) return 'none';
    if (person.region !== null && read.regions.some((region) => region.id === person.region!.id)) regionNamed = true;
    if (person.country !== null && (read.countries.includes(person.country)
      || read.regions.some((region) => region.country === person.country))) countryNamed = true;
  }
  const hasRegion = person.region !== null || person.regionKeys.size > 0;
  const named = hasRegion ? regionNamed : person.country !== null && countryNamed;
  return named ? 'full' : 'partial';
}

/** A match of one result, by its verdict's confidence. */
function hitOf(option: PreparedOption, confidence: number, duplicates: boolean): Match {
  const hit = stageHit(option, 'alias', 'place', confidence, option.fullKey,
    duplicates ? ['same-entity-duplicates'] : []);
  return { stage: hit.stage, optionIndex: option.index, rule: hit.rule, confidence: hit.confidence, flags: hit.flags,
    suggestions: [], reason: option.injected ? 'option-label-had-injected-text' : 'ok' };
}

/** The person's place among a list of places (see the header). */
export function matchPlace(place: PlaceParts, options: PreparedOptions, vocab: Vocab): Match {
  const person = personOf(place, vocab);
  if (person === null) return noMatch('no-match');
  const full: PreparedOption[] = [];
  const partial: PreparedOption[] = [];
  for (const option of options.list) {
    if (!chooseable(option)) continue;
    const verdict = verdictOf(option.clean, person, vocab);
    if (verdict === 'full') full.push(option);
    else if (verdict === 'partial') partial.push(option);
  }
  const found = full.length > 0 ? full : partial;
  const confidence = full.length > 0 ? MATCH_PLACE : MATCH_PLACE_PARTIAL;
  if (found.length === 0) return noMatch('no-match');
  // The same place listed twice reads the same: the first is chosen, flagged as the cascade flags duplicates.
  const same = found.every((option) => option.fullKey === found[0]!.fullKey);
  if (found.length > 1 && !same) {
    return noMatch('ambiguous-options', found.slice(0, MAX_SUGGESTIONS).map((option) => ({ index: option.index,
      score: confidence })));
  }
  return hitOf(found[0]!, confidence, found.length > 1);
}

// ── jr6 RULES R3 (O2) ───────────────────────────────────────────────────────────────────────────────────────────────

/** The usual street-type and direction words and their abbreviations (USPS publication 28, public facts): each is read
 *  as its abbreviation, so "4417 Quillfeather Lane" starts "4417 QUILLFEATHER LN, AUSTIN, TX 78701". */
const STREET_WORDS: Readonly<Record<string, string>> = {
  street: 'st', avenue: 'ave', av: 'ave', lane: 'ln', road: 'rd', drive: 'dr', boulevard: 'blvd', court: 'ct',
  place: 'pl', circle: 'cir', parkway: 'pkwy', highway: 'hwy', terrace: 'ter', trail: 'trl', square: 'sq',
  way: 'way', suite: 'ste', apartment: 'apt', north: 'n', south: 's', east: 'e', west: 'w', northeast: 'ne',
  northwest: 'nw', southeast: 'se', southwest: 'sw', mount: 'mt', fort: 'ft', saint: 'st',
};

/** A text's words for a street comparison: lower case, letters and digits, each street word as its abbreviation. */
function streetWords(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word !== '')
    .map((word) => STREET_WORDS[word] ?? word);
}

/** Whether `words` holds `part`'s words in a row. */
function holds(words: readonly string[], part: readonly string[]): boolean {
  return part.length > 0 && words.some((_, at) => part.every((word, offset) => words[at + offset] === word));
}

/**
 * jr6 RULES R3 (O2: Oracle's Address Line 1 search, whose eLocation results name the whole address, and its ZIP Code
 * search; Jobright matches the street's number and name, answer.findOracleSelectOptionIndex: cited): the one result
 * that starts with the address line (or the postal code), its street words read alike, and names one of the person's
 * places after it (the city, the state's code or name), at MATCH_PLACE (stage alias, rule place); among several, those
 * that name the most of them ("Austin" and "TX" over "Austin" alone). Several that read differently are
 * ambiguous-options; none is no-match. Only chooseable options take part, by their clean labels.
 */
export function matchStreet(street: StreetParts, options: PreparedOptions): Match {
  const own = streetWords(street.text);
  if (own.length === 0) return noMatch('no-match');
  const places = street.places.map(streetWords).filter((words) => words.length > 0);
  const named = options.list.flatMap((option) => {
    if (!chooseable(option)) return [];
    const words = streetWords(option.clean);
    if (!own.every((word, at) => words[at] === word)) return [];
    const count = places.filter((place) => holds(words.slice(own.length), place)).length;
    return count > 0 ? [{ option, count }] : [];
  });
  const most = Math.max(0, ...named.map((item) => item.count));
  const found = named.filter((item) => item.count === most).map((item) => item.option);
  if (found.length === 0) return noMatch('no-match');
  const same = found.every((option) => option.fullKey === found[0]!.fullKey);
  if (found.length > 1 && !same) {
    return noMatch('ambiguous-options', found.slice(0, MAX_SUGGESTIONS).map((option) => ({ index: option.index,
      score: MATCH_PLACE })));
  }
  return hitOf(found[0]!, MATCH_PLACE, found.length > 1);
}
