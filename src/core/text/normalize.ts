/*
 * Normalization before any comparison (docs/design/core.md §3), steps 0 to 14. Step 15, joining multi-word lexicon
 * phrases for the distinctive-token guard, is the matcher's. The vocabulary build imports this module, so the keys it
 * stores equal the keys computed at run time; NORMALIZER_VERSION is recorded in the vocabulary manifest, and the
 * vocabulary test fails when they differ, so any change here that alters a key must bump the version and rebuild.
 */
import { expandAbbreviations } from './abbreviations';
import { fold } from './fold';
import { extractQualifiers, type Qualifier } from './qualifiers';
import { removeStopwords, tokenize } from './tokens';

export type { Qualifier } from './qualifiers';

/** Bumped whenever a change here alters any key. */
export const NORMALIZER_VERSION = 1;

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

/** Step 5: "Texas at Austin, University of" becomes "university of texas at austin". */
const INVERTED = /^(.+?),\s*(?:the\s+)?(university|college|institute|school)\s+of\b(.*)$/s;

/** Normalizes `text` for one context (steps 0 to 14). */
export function normalize(text: string, context: NormContext): Normalized {
  let folded = fold(text);
  if (context === 'institution' && folded.includes(',')) folded = folded.replace(INVERTED, '$2 of $1$3');
  const { main, qualifiers: brackets } = extractQualifiers(folded);
  const raw = tokenize(main);
  const { tokens, ambiguous, generated } = expandAbbreviations(raw, context);
  const core = removeStopwords(tokens, context);
  const key = core.join(' ');
  const qualifiers: Qualifier[] = [];
  for (const bracket of brackets) {
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
    headForm: context === 'institution' ? headFormOf(tokens) : 'none',
    generated,
  };
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

function headFormOf(tokens: readonly string[]): HeadForm {
  const at = tokens.findIndex((token) => HEAD_NOUNS.has(token));
  if (at < 0) return 'none';
  return tokens[at + 1] === 'of' ? 'pre' : 'post';
}
