/*
 * What a bracket means (docs/design/core.md §3.4). Normalization keeps brackets out of the key but keeps them as
 * qualifiers, because "(Austin)" and "(Dallas)" are what tell campuses apart. Here each one is classed against the
 * text it belongs to: noise ("(optional)") and redundant ones ("(UT Austin)" after the full name, "(B.S.)" after
 * "Bachelor of Science") are ignored; distinctive ones (a presence word of the guard) must agree; degree types feed
 * the degree rules; anything else counts half in fuzzy scoring and lowers an exact match to 0.95.
 */
import type { DegreeType } from '../enums';
import { parseDegree } from '../profile/degreeParse';
import type { Normalized, Qualifier } from '../text/normalize';
import { isNoiseQualifier } from '../text/qualifiers';
import { removeStopwords } from '../text/tokens';
import type { Vocab } from '../vocab/types';
import { bracketWords } from './guardTokens';
import { domainContext } from './prepare';
import type { MatchDomain } from './types';

/** §3.4's classes, in the order they are tested. */
export const QUALIFIER_CLASSES = ['noise', 'redundant', 'distinctive', 'degree-types', 'other'] as const;
export type QualifierClass = (typeof QUALIFIER_CLASSES)[number];

/** What a bracket is classed against. */
export interface QualifierContext {
  domain: MatchDomain;
  vocab: Vocab;
  /** The text the bracket belongs to. */
  main: Normalized;
  /** The entity that text names: a bracket naming the same entity is redundant. */
  entityId: string | null;
  /** The degree types the main text names (degree domain): a bracket repeating them is redundant. */
  mainTypes?: readonly DegreeType[];
}

/** The initials of a token list ("massachusetts institute technology" gives "mit"). */
function initials(tokens: readonly string[]): string {
  return tokens.map((token) => token[0] ?? '').join('');
}

/** Classes one bracket (§3.4). */
export function classifyQualifier(qualifier: Qualifier, ctx: QualifierContext): QualifierClass {
  if (isNoiseQualifier(qualifier)) return 'noise';
  const { domain, vocab, main } = ctx;
  const only = qualifier.tokens.length === 1 ? qualifier.tokens[0]! : null;
  if (only !== null && only.length >= 2 && (only === initials(main.core) || only === initials(main.tokens))) {
    return 'redundant';
  }
  if (ctx.entityId !== null && domain !== 'number' && domain !== 'generic') {
    const key = removeStopwords(qualifier.tokens, domainContext(domain)).join(' ');
    if (vocab.lookup(domain, key).some((hit) => hit.id === ctx.entityId && !hit.ambiguous)) return 'redundant';
  }
  const types = domain === 'degree' || domain === 'field' ? parseDegree(qualifier.text, vocab).types : [];
  if (types.length > 0) {
    // A field followed by its degree ("Computer Science (B.S.)") still names the field.
    if (domain === 'field') return 'redundant';
    const mainClasses = new Set((ctx.mainTypes ?? []).map((type) => vocab.degrees.classOf(type)));
    if (types.every((type) => mainClasses.has(vocab.degrees.classOf(type)))) return 'redundant';
  }
  if (bracketWords(qualifier, domain, vocab).some((word) => word.presence)) return 'distinctive';
  if (types.length > 0) return 'degree-types';
  return 'other';
}

/** Every bracket of a text, classed. */
export function classifyQualifiers(ctx: QualifierContext): Array<{ qualifier: Qualifier; kind: QualifierClass }> {
  return ctx.main.qualifiers.map((qualifier) => ({ qualifier, kind: classifyQualifier(qualifier, ctx) }));
}
