/*
 * Normalization before any comparison (docs/design/core.md §3), steps 0 to 14. Step 15, joining multi-word lexicon
 * phrases for the distinctive-token guard, is the matcher's. The vocabulary build imports this module, so the keys it
 * stores equal the keys computed at run time; NORMALIZER_VERSION is recorded in the vocabulary manifest, and the
 * vocabulary test fails when they differ, so any change here that alters a key must bump the version and rebuild.
 */
import { expandAbbreviations } from './abbreviations';
import { fold } from './fold';
import { extractQualifiers, type Qualifier } from './qualifiers';
import { PLACE_CODE_STOPWORDS, removeStopwords, tokenize } from './tokens';

export type { Qualifier } from './qualifiers';

/**
 * Bumped whenever a change here alters any key. 2: a word's closing "+" or "#" and a one-letter word's closing "-" are
 * kept ("C++", "A-"); the name particles of other languages are no longer institution and field stopwords ("De La
 * Salle"), and capitalised place codes are kept ("IN"); more apostrophe marks are deleted; and the 500-code-point cap
 * applies to the folded text. 3: an institution's trailing ", IN" (a USPS or Canada Post code after a comma or a
 * spaced dash) is read as a bracketed place, out of the key.
 */
export const NORMALIZER_VERSION = 3;

/** What a text is normalized as: each context has its own abbreviations and stopwords. */
export const NORM_CONTEXTS = ['institution', 'degree', 'field', 'country', 'region', 'answer', 'label',
  'address'] as const;
export type NormContext = (typeof NORM_CONTEXTS)[number];

/** The institution head nouns: their position tells "University of X" from "X University". */
export const INSTITUTION_HEAD_NOUNS = ['university', 'college', 'institute', 'school', 'academy', 'conservatory',
  'seminary'] as const;
const HEAD_NOUNS = new Set<string>(INSTITUTION_HEAD_NOUNS);

/** 'pre' for "University of X", 'post' for "X University", 'none' without a head noun or outside the institution
 *  context. */
export type HeadForm = 'pre' | 'post' | 'none';

/** A normalized text. Parentheticals are qualifiers, kept out of every field but `qualifiers`. */
export interface Normalized {
  /** Steps 0 to 12: the folded main text, punctuation as spaces, tokens joined by single spaces. */
  folded: string;
  /** After abbreviations (step 13). */
  tokens: string[];
  /** `tokens` without stopwords (step 14); equals `tokens` when removal would empty it. */
  core: string[];
  /** core.join(' '): the exact-stage key. */
  key: string;
  /** `key` without spaces: compared only for labels of at most 3 tokens ("Linked In" = "LinkedIn"). */
  compact: string;
  qualifiers: Qualifier[];
  /** The "st?" tokens of the main text that the st rule left unresolved. */
  ambiguous: string[];
  /** Where the institution head noun sits (section 4.5). */
  headForm: HeadForm;
  /** A rule fired that makes this spelling count as a `generated` surface (the trailing "cc", section 3.3). */
  generated: boolean;
}

/** The USPS codes (states, DC, territories, the armed forces) and the Canada Post province and territory codes. */
export const POSTAL_REGION_CODES = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL',
  'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC',
  'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'AS', 'GU', 'MP',
  'PR', 'VI', 'AA', 'AE', 'AP', 'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'] as const;

/** An institution's place written after its name: a postal region code in capitals after a comma or a spaced dash, at
 *  the end ("Indiana University Bloomington, IN", "University of Toronto - ON"). It is read as a bracketed one ("(IN)"),
 *  so the guard checks it against the school's facts and it stays out of the key. "..., in" is a word, not a code. */
const TRAILING_PLACE_CODE = new RegExp(String.raw`(?:,|\s[-\u2013\u2014])\s*(${POSTAL_REGION_CODES.join('|')})\s*$`);

/** Step 5: "Texas at Austin, University of" becomes "university of texas at austin". */
const INVERTED = /^(.+?),\s*(?:the\s+)?(university|college|institute|school)\s+of\b(.*)$/s;

/** A place-code stopword written in capitals as a word of its own ("IN"). */
const PLACE_CODE_IN_CAPITALS = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${PLACE_CODE_STOPWORDS
  .map((word) => word.toUpperCase()).join('|')})(?![\p{L}\p{N}])`, 'gu');
const LOWER_CASE_LETTER = /\p{Ll}/u;
const NO_PLACE_CODES: ReadonlySet<string> = new Set();

/** Step 14's exception: the place-code stopwords that `text` writes in capitals among lower-case letters, which the
 *  institution and field contexts keep ("Purdue University Fort Wayne, IN"). A text all in capitals keeps none. */
function placeCodesInCapitals(text: string, context: NormContext): ReadonlySet<string> {
  if (context !== 'institution' && context !== 'field') return NO_PLACE_CODES;
  const found = text.match(PLACE_CODE_IN_CAPITALS);
  if (found === null || !LOWER_CASE_LETTER.test(text)) return NO_PLACE_CODES;
  return new Set(found.map((word) => word.toLowerCase()));
}

/** Normalizes `text` for one context (steps 0 to 14). */
export function normalize(text: string, context: NormContext): Normalized {
  const place = context === 'institution' ? TRAILING_PLACE_CODE.exec(text) : null;
  const body = place ? text.slice(0, place.index) : text;
  let folded = fold(body);
  if (context === 'institution' && folded.includes(',')) folded = folded.replace(INVERTED, '$2 of $1$3');
  const { main, qualifiers: brackets } = extractQualifiers(folded);
  const raw = tokenize(main);
  const { tokens, ambiguous, generated } = expandAbbreviations(raw, context);
  const core = removeStopwords(tokens, context, placeCodesInCapitals(body, context));
  const key = core.join(' ');
  const qualifiers: Qualifier[] = [];
  for (const bracket of place ? [...brackets, place[1]!.toLowerCase()] : brackets) {
    const expanded = expandAbbreviations(tokenize(bracket), context).tokens;
    if (expanded.length > 0) qualifiers.push({ text: bracket, tokens: expanded });
  }
  return {
    folded: raw.join(' '),
    tokens,
    core,
    key,
    compact: key.replace(/ /g, ''),
    qualifiers,
    ambiguous,
    headForm: context === 'institution' ? headFormOf(tokens, core) : 'none',
    generated,
  };
}

/** Brackets become spaces in keyWithBrackets, so their words stay in the key. */
const BRACKETS = /[()[\]]/g;

/**
 * The key of `text` with its brackets' words kept as main text, and an institution's trailing place code too
 * ("Indiana University Bloomington, IN" gives "indiana university bloomington in"): two spellings whose brackets or
 * codes differ never share it (the matcher's PreparedOption.fullKey and its cache's labels).
 */
export function keyWithBrackets(text: string, context: NormContext): string {
  const place = context === 'institution' ? TRAILING_PLACE_CODE.exec(text) : null;
  const body = place ? text.slice(0, place.index) : text;
  const key = normalize(body.replace(BRACKETS, ' '), context).key;
  return place ? [key, place[1]!.toLowerCase()].filter((part) => part !== '').join(' ') : key;
}

/**
 * A field label normalized in the 'label' context: folded, abbreviations of the 'all' row only, no stopwords, and its
 * parentheticals left out ("First name (required)" gives "first name"). The resolver's label rules run over it, and
 * it is the label key of saved answers and the match cache. Field keys build their label slug from it plus the
 * label's non-noise qualifiers (keys.ts).
 */
export function normalizeLabel(label: string): string {
  return normalize(label, 'label').key;
}

/** 'pre' when the first head noun is followed by "of" or "at" ("University at Buffalo") or opens the core ("University
 *  College London"); 'post' otherwise ("Washington University in St. Louis"). */
function headFormOf(tokens: readonly string[], core: readonly string[]): HeadForm {
  const at = tokens.findIndex((token) => HEAD_NOUNS.has(token));
  if (at < 0) return 'none';
  const next = tokens[at + 1];
  return next === 'of' || next === 'at' || core[0] === tokens[at] ? 'pre' : 'post';
}
