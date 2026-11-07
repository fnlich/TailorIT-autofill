/*
 * Candidate answers to type into a search (v4, the owner's words of 2026-11-07: "Dropdown with editable text like Phone
 * Country Code or Education, Degree on greenhouse or Current location on Jobs.lever: You can write possible answer
 * (like United States, University of Texas) and choose the correct answer on dropdown. you can try multiple with
 * possible answer."). A search box that lists what holds the typed text (a remote typeahead: a school, a location; a
 * long list its own text box filters: a phone country, a country, a degree, a discipline) is given these texts, one at
 * a time, from TailorIT's own data only (core/vocab/data: countries, regions, degrees, institutions, CIP fields). Each
 * typed query's results are matched against every spelling of the value (exact, alias, the degree and place rules,
 * fuzzy: matchOne through the planner), never by "the first result that holds the text", and the first result that
 * reaches the fill band ends the search (dom/widgets/typeahead.ts). The order, per kind:
 * - a school: the person's own text; the canonical name; the same without a leading "The"; the curated acronyms
 *   ("MIT"), then the other curated spellings ("UT Austin"); the name without its campus ("University of Texas at
 *   Austin": "University of Texas"; a " - X", "-<campus>" or ", X" suffix) and the flagship's bare system name; the
 *   vocabulary's other spellings; the first two words that weigh at least 0.3, as the name writes them ("Texas
 *   Austin"). No spelling the vocabulary marks ambiguous is typed (it could only find what the others find);
 * - a country (a phone country too, by its name): its name; the person's text; each other spelling ("USA", "United
 *   States of America"); its alpha-3 code; and, for a phone-country list whose options show a dial code ("Canada
 *   +1", Greenhouse's), the person's dial code ("+1": SearchExtras.dialCode, which the resolver passes only then);
 * - a degree: the person's text; its type's name ("Bachelor of Science"); the type's first code, dotted and not
 *   ("B.S.", "BS"); its level's name without and with "degree" ("Bachelor's", "Bachelor's degree");
 * - a field of study: the person's text; the CIP title; its other spellings; the parent code's title;
 * - any other entity (a region, a language, an answer): the person's text, the name, the name without "The", the
 *   other spellings, acronyms first, then the weighty words;
 * - a place (the current location: Choice.place): the profile's text ("Austin, TX"), then its city with its region's
 *   code ("Austin, TX"), its region's name ("Austin, Texas"), its country's name ("Austin, United States"), and alone
 *   ("Austin"): a geocoder spells a region out, and a list that shows only the results holding the typed text lists
 *   none for "Austin, TX" (Greenhouse's Location on the live BeyondTrust form, 2026-11-01); the place matcher reads the
 *   results by their parts, so the city alone never chooses another state's Austin;
 * - any other text: as written, then without a leading "The".
 * Each query has at least three characters (a code, two: "BS", "+1"), at most 300, and none repeats another, ignoring
 * case and white space; at most MAX_SEARCH_QUERIES (6) are given. Each typed query is a guarded write with provenance
 * `profile` and transform `typeahead.query` (content/pass.ts). Values stay in memory.
 */
import { TYPEAHEAD_MIN_QUERY_LENGTH, TYPEAHEAD_TOKEN_MIN_WEIGHT } from '../confidence';
import { normalize } from '../text/normalize';
import { NAME_PARTICLES, STOPWORDS } from '../text/tokens';
import type { IntendedValue, Surface } from '../types/intent';
import { isAcronym } from '../vocab/lookup';
import type { Vocab } from '../vocab/types';
import { tokenWeight } from './fuzzy';
import type { PlaceParts } from './place';
import { domainContext } from './prepare';
import { CODE_QUERY_MIN_LENGTH, MAX_SEARCH_QUERIES } from './searchLimits';
import type { MatchDomain } from './types';

type EntityValue = Extract<IntendedValue, { kind: 'entity' }>;
type DegreeValue = Extract<IntendedValue, { kind: 'degree' }>;

/** What else a search may type besides the value's own spellings. */
export interface SearchExtras {
  /** The person's dial code ("+1"), for a phone-country list whose options show one (resolver/resolve.ts shapeFor). */
  dialCode?: string;
}

/** One candidate: its text, and whether it is a code, which may be shorter than a word. */
interface Candidate {
  text: string;
  code?: true;
}

/** The longest query: the message schema's cap on a query's text. */
const MAX_QUERY_LENGTH = 300;
const LEADING_THE = /^the\s+/i;
/** Where a name splits into words, keeping each word's own spelling. */
const WORD_BREAK = /[\s,;:/()[\]–—-]+/;
/** The articles and particles of other languages: kept in a name's key (they tell "De La Salle" from "La Salle"), but
 *  no word to search by ("Universidad de" finds every Spanish university). */
const PARTICLES: ReadonlySet<string> = new Set(NAME_PARTICLES);
/** A dial code as the profile gives it, with its plus. */
const DIAL_CODE = /^\+\d{1,4}$/;

const word = (text: string): Candidate => ({ text });
const code = (text: string): Candidate => ({ text, code: true });
const withoutThe = (text: string) => text.trim().replace(LEADING_THE, '');
const wordCount = (text: string) => text.trim().split(/\s+/).filter((part) => part !== '').length;

/** The person's own text: the value's raw spelling. */
function ownText(surfaces: readonly Surface[]): string {
  return surfaces.find((surface) => surface.tier === 'raw')?.text ?? '';
}

/** The first two words of `name` that weigh at least 0.3 in the domain, as written, stopwords and particles left
 *  out; '' when fewer than two do. */
export function weightyWords(name: string, domain: MatchDomain, vocab: Vocab): string {
  const context = domainContext(domain);
  const stopwords = STOPWORDS[context];
  const words: string[] = [];
  for (const part of name.split(WORD_BREAK)) {
    if (words.length === 2) break;
    const tokens = normalize(part, context).tokens.filter((token) => !stopwords.has(token) && !PARTICLES.has(token));
    if (tokens.length === 0) continue;
    if (tokens.every((token) => tokenWeight(token, domain, vocab) >= TYPEAHEAD_TOKEN_MIN_WEIGHT)) words.push(part);
  }
  return words.length === 2 ? words.join(' ') : '';
}

/** An entity's other spellings, none ambiguous, none the person's text or the display name, in four groups: curated
 *  acronyms ("MIT"), the other curated spellings ("UT Austin"), the flagship's bare system name ("University of
 *  Texas"), and the vocabulary's own (IPEDS, ROR, CLDR, generated). */
function aliasesOf(intended: EntityValue | DegreeValue): { acronyms: string[]; curated: string[]; flagship: string[];
  rest: string[] } {
  const groups = { acronyms: [] as string[], curated: [] as string[], flagship: [] as string[], rest: [] as string[] };
  for (const surface of intended.surfaces) {
    if (surface.ambiguous || surface.tier === 'raw' || surface.text === intended.display) continue;
    if (surface.tier === 'curated') (isAcronym(surface.text) ? groups.acronyms : groups.curated).push(surface.text);
    else if (surface.tier === 'flagship') groups.flagship.push(surface.text);
    else groups.rest.push(surface.text);
  }
  return groups;
}

/** A school's name without its campus: before " at " ("University of Texas at Austin": "University of Texas"), before
 *  a spaced dash, before the campus the vocabulary names after a hyphen ("University of California-Berkeley"), or
 *  before the last comma ("University of California, Berkeley"); '' when nothing of two words or more is left. */
export function campusSplit(name: string, campus?: string): string {
  const text = withoutThe(name);
  const cuts: string[] = [];
  const at = /^(.+?)\s+at\s+\S/i.exec(text);
  if (at) cuts.push(at[1]!);
  const dash = /^(.+?)\s+[-–—]\s+\S/.exec(text);
  if (dash) cuts.push(dash[1]!);
  const place = campus?.trim() ?? '';
  if (place !== '') {
    const lower = text.toLowerCase();
    const suffix = place.toLowerCase();
    if (lower.endsWith(suffix) && lower.length > suffix.length) {
      const before = text.slice(0, text.length - place.length);
      if (/[-–—,]\s*$/.test(before)) cuts.push(before.replace(/[\s,–—-]+$/, ''));
    }
  }
  const comma = text.lastIndexOf(',');
  if (comma > 0) cuts.push(text.slice(0, comma));
  return cuts.map((cut) => cut.trim()).find((cut) => wordCount(cut) >= 2 && cut.toLowerCase() !== text.toLowerCase())
    ?? '';
}

/** A school's candidates (see the header). */
function institutionCandidates(intended: EntityValue, vocab: Vocab): Candidate[] {
  const own = ownText(intended.surfaces);
  const name = intended.display.trim();
  const entity = intended.id === null ? undefined : vocab.entity(intended.id);
  const campus = entity?.kind === 'institution' ? entity.facts.campus : undefined;
  const { acronyms, curated, flagship, rest } = aliasesOf(intended);
  return [own, name, withoutThe(name), withoutThe(own), ...acronyms, ...curated, campusSplit(name, campus),
    campusSplit(own, campus), ...flagship, ...rest, weightyWords(name, intended.domain, vocab)].map(word);
}

/** A country's candidates (see the header). */
function countryCandidates(intended: EntityValue, vocab: Vocab, extras: SearchExtras): Candidate[] {
  const entity = intended.id === null ? undefined : vocab.entity(intended.id);
  const { acronyms, curated, flagship, rest } = aliasesOf(intended);
  const dial = extras.dialCode !== undefined && DIAL_CODE.test(extras.dialCode.trim()) ? extras.dialCode.trim() : '';
  return [word(intended.display), word(ownText(intended.surfaces)), ...[...acronyms, ...curated, ...flagship, ...rest]
    .map(word), code(entity?.kind === 'country' ? entity.alpha3 : ''), code(dial)];
}

/** A field of study's candidates (see the header). */
function fieldCandidates(intended: EntityValue, vocab: Vocab): Candidate[] {
  const entity = intended.id === null ? undefined : vocab.entity(intended.id);
  const parent = entity?.kind === 'field' && entity.parent !== null ? vocab.entity(entity.parent)?.name ?? '' : '';
  const { acronyms, curated, flagship, rest } = aliasesOf(intended);
  return [ownText(intended.surfaces), intended.display, ...curated, ...acronyms, ...flagship, ...rest, parent].map(word);
}

/** Any other entity's candidates (see the header). */
function entityCandidates(intended: EntityValue, vocab: Vocab): Candidate[] {
  const name = intended.display.trim();
  const { acronyms, curated, flagship, rest } = aliasesOf(intended);
  return [ownText(intended.surfaces), name, withoutThe(name), ...acronyms, ...curated, ...flagship, ...rest,
    weightyWords(name, intended.domain, vocab)].map(word);
}

/** A degree's candidates (see the header). */
function degreeCandidates(intended: DegreeValue, vocab: Vocab): Candidate[] {
  const type = intended.type === null ? undefined : vocab.degrees.type(intended.type);
  const level = vocab.degrees.level(intended.level);
  const dotted = type?.codes[0] ?? '';
  const levelName = level.name.trim();
  return [word(ownText(intended.surfaces)), word(type?.name ?? ''), code(dotted), code(dotted.replace(/\./g, '')),
    word(levelName.replace(/\s+degree$/i, '')), word(levelName)];
}

/** A place's own queries, after its text (see the header): its city with its region's code, its region's name, its
 *  country's name, then its city alone. */
function placeCandidates(place: PlaceParts | undefined, vocab: Vocab): Candidate[] {
  const city = place?.city?.trim() ?? '';
  if (city === '') return [];
  const regionCode = place?.region?.code?.trim() ?? '';
  const regionName = place?.region?.name.trim() ?? '';
  const country = place?.country === undefined ? '' : vocab.countries.byAlpha2(place.country)?.name ?? '';
  const joined = (part: string) => (part === '' ? '' : `${city}, ${part}`);
  return [joined(regionCode), joined(regionName), joined(country), city].map(word);
}

/** The candidates in order, white space collapsed, each long enough and short enough, none repeated (ignoring case),
 *  at most MAX_SEARCH_QUERIES. */
function finish(candidates: readonly Candidate[]): string[] {
  const seen = new Set<string>();
  const queries: string[] = [];
  for (const candidate of candidates) {
    const text = candidate.text.replace(/\s+/g, ' ').trim();
    const shortest = candidate.code === true ? CODE_QUERY_MIN_LENGTH : TYPEAHEAD_MIN_QUERY_LENGTH;
    const folded = text.toLowerCase();
    if (text.length < shortest || text.length > MAX_QUERY_LENGTH || seen.has(folded)) continue;
    seen.add(folded);
    queries.push(text);
    if (queries.length === MAX_SEARCH_QUERIES) break;
  }
  return queries;
}

/** The texts to type into a search for `intended`, in order (see the header); `place` is the value's place, when it is
 *  one (Choice.place). Empty for a value no search holds (a yes or no, a date, a set). */
export function searchCandidates(intended: IntendedValue, vocab: Vocab, place?: PlaceParts, extras: SearchExtras = {}):
  string[] {
  switch (intended.kind) {
    case 'entity':
      switch (intended.domain) {
        case 'institution':
          return finish(institutionCandidates(intended, vocab));
        case 'country':
          return finish(countryCandidates(intended, vocab, extras));
        case 'field':
          return finish(fieldCandidates(intended, vocab));
        default:
          return finish(entityCandidates(intended, vocab));
      }
    case 'degree':
      return finish(degreeCandidates(intended, vocab));
    case 'text': {
      const text = intended.text.trim();
      return finish([word(text), word(withoutThe(text)), ...placeCandidates(place, vocab)]);
    }
    default:
      return [];
  }
}
