/*
 * Candidate answers to type into a search (v4, the owner's words of 2026-11-07: "Dropdown with editable text like Phone
 * Country Code or Education, Degree on greenhouse or Current location on Jobs.lever: You can write possible answer
 * (like United States, University of Texas) and choose the correct answer on dropdown. you can try multiple with
 * possible answer."). A search box that lists what holds the typed text (a remote typeahead: a school, a location; a
 * long list its own text box filters: a phone country, a country, a degree, a discipline) is given these texts, one at
 * a time, from TailorIT's own data only (core/vocab/data: countries, regions, degrees, institutions, CIP fields). Each
 * typed query's results are matched against every spelling of the value (exact, alias, the degree and place rules,
 * fuzzy: matchOne through the planner), never by "the first result that holds the text", and the first result that
 * reaches the fill band ends the search (dom/widgets/typeahead.ts).
 *
 * Snapshot round 2 (the owner, 2026-11-07: "you have to write the draft like `school or University` or `Field of
 * Study`, and select ... if there is no matched thing, write the other one. there is no matched after with 3 different
 * style value, last will be other or don't write"): every candidate is written in one of three styles (SEARCH_STYLES),
 * and a search types at most one of each (MAX_STYLE_QUERIES, 3), in the order below: the first candidate of each style,
 * and, where a style has none, the next unused candidate in that order in its place. After them the frame may type the
 * list's own "Other" (searchLimits.ts NO_MATCH_OTHER_QUERY; plan/frame.ts, under settings.modes.noMatch). The styles,
 * per kind (the person's own text takes the style of the spelling it is: "UT Austin" is a short form):
 * - a school: full, the person's text else the canonical name, a leading "The" dropped ("University of Texas at
 *   Austin": a search that lists what holds the typed words finds it with or without "The", and lists nothing for
 *   "The University of Texas at Austin" where the page's name has no "The"), then the same with its "The"; short, the
 *   curated acronyms ("MIT"), the other curated spellings ("UT Austin"), then the vocabulary's other spellings; reduced,
 *   the name without its campus ("University of Texas"; a " - X", "-<campus>" or ", X" suffix), the flagship's bare
 *   system name, then the first two words that weigh at least 0.3, as the name writes them ("Texas Austin"). No
 *   spelling the vocabulary marks ambiguous is typed (it could only find what the others find);
 * - a country (a phone country too, by its name): full, its name, then the person's text; short, each other spelling
 *   ("USA", "United States of America"), then its alpha-3 code; reduced, for a phone-country list whose options show a
 *   dial code ("Canada +1", Greenhouse's; "United States of America (+1)", Workday's), the person's dial code ("+1":
 *   SearchExtras.dialCode, which the resolver passes only then);
 * - a degree: full, the person's text, then its type's name ("Bachelor of Science"); short, the type's first code,
 *   dotted and not ("B.S.", "BS"); reduced, its level's name without and with "degree" ("Bachelor's");
 * - a field of study: full, the person's text, then the CIP title; short, its curated spellings and acronyms, then the
 *   vocabulary's; reduced, the parent code's title;
 * - a referral source ("How did you hear about us?"): full, the person's text, then the source's name ("LinkedIn");
 *   short, its other spellings ("LinkedIn Jobs"); reduced, the kind of source it is ("Job board": the profile's
 *   referralSource.category, else the vocabulary's first parent, SearchExtras.kind);
 * - any other entity (a region, a language, an answer): full, the person's text, the name, without "The"; short, the
 *   other spellings, acronyms first; reduced, the weighty words;
 * - a place (the current location, a job's: Choice.place): full, the profile's text ("Austin, TX"); short, its city with
 *   its region's code ("Austin, TX"), its region's name ("Austin, Texas"), its country's name ("Austin, United
 *   States"); reduced, the city alone ("Austin"): a geocoder spells a region out, and a list that shows only the results
 *   holding the typed text lists none for "Austin, TX" (Greenhouse's Location on the live BeyondTrust form,
 *   2026-11-01); the place matcher reads the results by their parts, so the city alone never chooses another state's
 *   Austin;
 * - any other text (an employer): full, as written, then without a leading "The".
 * Each query has at least three characters (a code, two: "BS", "+1"), at most 300, and none repeats another, ignoring
 * case and white space. Each typed query is a guarded write with provenance `profile` and transform `typeahead.query`
 * (content/pass.ts). Values stay in memory.
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
import { CODE_QUERY_MIN_LENGTH, MAX_STYLE_QUERIES } from './searchLimits';
import type { MatchDomain } from './types';

type EntityValue = Extract<IntendedValue, { kind: 'entity' }>;
type DegreeValue = Extract<IntendedValue, { kind: 'degree' }>;

/** What else a search may type besides the value's own spellings. */
export interface SearchExtras {
  /** The person's dial code ("+1"), for a phone-country list whose options show one (resolver/resolve.ts shapeFor). */
  dialCode?: string;
  /** s2 core-wd: a referral source's kind, as a referral-vocabulary id ('ref:job-board': Choice.fallback, from the
   *  profile's referralSource.category or the source's first parent), typed as the reduced style. */
  kind?: string;
  /** jr6 RULES R3 (O2: Oracle's ZIP Code search, which Jobright searches again by its first three characters when the
   *  code finds nothing, operations' postal-prefix search: cited): the value is the profile's postal code, so a US code
   *  is typed as its five digits, then its first three. */
  postalCode?: true;
}

/** jr6 RULES R3 (O2): a US postal code, ZIP or ZIP+4 (its five digits captured). */
const US_POSTAL_CODE = /^(\d{5})(?:[\s-]?\d{4})?$/;

// s2 core-wd: the three styles.

/** The three ways a candidate answer is written (snapshot round 2): the full name, a short form or acronym, a reduced
 *  form (the wd study §3.2). A search types at most one of each. */
export const SEARCH_STYLES = ['full', 'short', 'reduced'] as const;
export type SearchStyle = (typeof SEARCH_STYLES)[number];

/** One candidate: its text, its style, and whether it is a code, which may be shorter than a word. */
interface Candidate {
  text: string;
  style: SearchStyle;
  code?: true;
}

// end s2 core-wd

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

const full = (text: string): Candidate => ({ text, style: 'full' });
const short = (text: string): Candidate => ({ text, style: 'short' });
const reduced = (text: string): Candidate => ({ text, style: 'reduced' });
const code = (text: string, style: SearchStyle): Candidate => ({ text, style, code: true });
const withoutThe = (text: string) => text.trim().replace(LEADING_THE, '');
const wordCount = (text: string) => text.trim().split(/\s+/).filter((part) => part !== '').length;
/** Two texts as the search compares them: white space collapsed, any case. */
const folded = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** The person's own text: the value's raw spelling. */
function ownText(surfaces: readonly Surface[]): string {
  return surfaces.find((surface) => surface.tier === 'raw')?.text ?? '';
}

/** The style of the person's own text: that of the spelling it is (a curated acronym the person typed is a short form,
 *  "UT Austin"), else the full name. */
function ownStyle(own: string, shortForms: readonly string[], reducedForms: readonly string[]): SearchStyle {
  const key = folded(own);
  if (shortForms.some((form) => folded(form) === key)) return 'short';
  if (reducedForms.some((form) => folded(form) === key)) return 'reduced';
  return 'full';
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
  const shorts = [...acronyms, ...curated, ...rest];
  const reduceds = [campusSplit(name, campus), campusSplit(own, campus), ...flagship,
    weightyWords(name, intended.domain, vocab)];
  const mine = ownStyle(own, shorts, reduceds);
  const ownCandidate = (text: string): Candidate => ({ text, style: mine });
  return [ownCandidate(withoutThe(own)), full(withoutThe(name)), ownCandidate(own), full(name),
    ...shorts.map(short), ...reduceds.map(reduced)];
}

/** A country's candidates (see the header). */
function countryCandidates(intended: EntityValue, vocab: Vocab, extras: SearchExtras): Candidate[] {
  const entity = intended.id === null ? undefined : vocab.entity(intended.id);
  const { acronyms, curated, flagship, rest } = aliasesOf(intended);
  const shorts = [...acronyms, ...curated, ...flagship, ...rest];
  const own = ownText(intended.surfaces);
  const dial = extras.dialCode !== undefined && DIAL_CODE.test(extras.dialCode.trim()) ? extras.dialCode.trim() : '';
  return [full(intended.display), { text: own, style: ownStyle(own, shorts, []) }, ...shorts.map(short),
    code(entity?.kind === 'country' ? entity.alpha3 : '', 'short'), code(dial, 'reduced')];
}

/** A field of study's candidates (see the header). */
function fieldCandidates(intended: EntityValue, vocab: Vocab): Candidate[] {
  const entity = intended.id === null ? undefined : vocab.entity(intended.id);
  const parent = entity?.kind === 'field' && entity.parent !== null ? vocab.entity(entity.parent)?.name ?? '' : '';
  const { acronyms, curated, flagship, rest } = aliasesOf(intended);
  const shorts = [...curated, ...acronyms, ...flagship, ...rest];
  const own = ownText(intended.surfaces);
  return [{ text: own, style: ownStyle(own, shorts, [parent]) }, full(intended.display), ...shorts.map(short),
    reduced(parent)];
}

/** A referral source's kind (SearchExtras.kind, a referral-vocabulary id), by its name ("Job board"); '' when none. */
function kindName(kind: string | undefined, vocab: Vocab): string {
  if (kind === undefined) return '';
  const entity = vocab.entity(kind);
  return entity?.kind === 'referral' ? entity.name : '';
}

/** Any other entity's candidates (see the header): a referral source's kind is its reduced form. */
function entityCandidates(intended: EntityValue, vocab: Vocab, extras: SearchExtras): Candidate[] {
  const name = intended.display.trim();
  const { acronyms, curated, flagship, rest } = aliasesOf(intended);
  const shorts = [...acronyms, ...curated, ...flagship, ...rest];
  const kind = intended.domain === 'referral' ? kindName(extras.kind, vocab) : '';
  const reduceds = [kind, weightyWords(name, intended.domain, vocab)];
  const own = ownText(intended.surfaces);
  return [{ text: own, style: ownStyle(own, shorts, reduceds) }, full(name), full(withoutThe(name)),
    ...shorts.map(short), ...reduceds.map(reduced)];
}

/** A degree's candidates (see the header). */
function degreeCandidates(intended: DegreeValue, vocab: Vocab): Candidate[] {
  const type = intended.type === null ? undefined : vocab.degrees.type(intended.type);
  const level = vocab.degrees.level(intended.level);
  const dotted = type?.codes[0] ?? '';
  const levelName = level.name.trim();
  const codes = [dotted, dotted.replace(/\./g, '')];
  const levels = [levelName.replace(/\s+degree$/i, ''), levelName];
  const own = ownText(intended.surfaces);
  const mine: Candidate = { text: own, style: ownStyle(own, codes, levels),
    ...(codes.includes(own.trim()) ? { code: true as const } : {}) };
  return [mine, full(type?.name ?? ''), ...codes.map((text) => code(text, 'short')), ...levels.map(reduced)];
}

/** A place's own queries, after its text (see the header): its city with its region's code, its region's name, its
 *  country's name (short forms), then its city alone (the reduced form). */
function placeCandidates(place: PlaceParts | undefined, vocab: Vocab): Candidate[] {
  const city = place?.city?.trim() ?? '';
  if (city === '') return [];
  const regionCode = place?.region?.code?.trim() ?? '';
  const regionName = place?.region?.name.trim() ?? '';
  const country = place?.country === undefined ? '' : vocab.countries.byAlpha2(place.country)?.name ?? '';
  const joined = (part: string) => (part === '' ? '' : `${city}, ${part}`);
  return [short(joined(regionCode)), short(joined(regionName)), short(joined(country)), reduced(city)];
}

// s2 core-wd: one candidate of each style.

/** The candidates in order, white space collapsed, each long enough and short enough, none repeated (ignoring case);
 *  then at most MAX_STYLE_QUERIES of them, in their order: the first of each style, and where a style has none, the
 *  next unused candidate in its place (see the header). */
function finish(candidates: readonly Candidate[]): string[] {
  const seen = new Set<string>();
  const usable: Candidate[] = [];
  for (const candidate of candidates) {
    const text = candidate.text.replace(/\s+/g, ' ').trim();
    const shortest = candidate.code === true ? CODE_QUERY_MIN_LENGTH : TYPEAHEAD_MIN_QUERY_LENGTH;
    const key = text.toLowerCase();
    if (text.length < shortest || text.length > MAX_QUERY_LENGTH || seen.has(key)) continue;
    seen.add(key);
    usable.push({ ...candidate, text });
  }
  const picked = new Set<number>();
  for (const style of SEARCH_STYLES) {
    const at = usable.findIndex((candidate) => candidate.style === style);
    if (at >= 0) picked.add(at);
  }
  for (let at = 0; at < usable.length && picked.size < MAX_STYLE_QUERIES; at += 1) picked.add(at);
  return [...picked].sort((a, b) => a - b).map((at) => usable[at]!.text);
}

// end s2 core-wd

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
          return finish(entityCandidates(intended, vocab, extras));
      }
    case 'degree':
      return finish(degreeCandidates(intended, vocab));
    case 'text': {
      const text = intended.text.trim();
      // jr6 RULES R3 (O2): a US postal code's five digits, then its first three.
      const zip = extras.postalCode === true ? US_POSTAL_CODE.exec(text) : null;
      if (zip !== null) return finish([full(zip[1]!), code(zip[1]!.slice(0, 3), 'reduced')]);
      return finish([full(text), full(withoutThe(text)), ...placeCandidates(place, vocab)]);
    }
    default:
      return [];
  }
}
