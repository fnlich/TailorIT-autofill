/*
 * Stage a, exact (docs/design/core.md §4.2): the option's key, or its compact form for labels of at most three
 * tokens ("Linked In" = "LinkedIn"), equals the key of a raw or primary spelling of the intended value. Brackets must
 * not contradict it: a distinctive one must agree, a noise or redundant one is ignored, and any other lowers the
 * match to 0.95 (`qualifier-ignored`). A key that rests on an unresolved "st?", or on the generated reading of a
 * trailing "cc", is never exact. An option that the vocabulary resolves to a different entity is never the intended
 * one, whatever the person typed. The helpers here are shared with the alias stage.
 */
import { MATCH_EXACT, MATCH_EXACT_QUALIFIERS_IGNORED } from '../confidence';
import { bracketsAgree, type GuardSide } from './guardTokens';
import { chooseable } from './prepare';
import { classifyQualifiers, type QualifierClass } from './qualifierClass';
import { rankHits, stageHit, type Ranked, type StageHit } from './rank';
import type { IntendedSurface, Scope } from './scope';
import type { PreparedOption, PreparedOptions } from './types';

/** The identity of every match against the intended value's own spellings: they all name the same answer. */
export const INTENDED = 'intended';

const NO_BRACKETS: GuardSide = { tokens: new Set(), presence: new Set(), bracketPresence: new Set(), head: null };

/** The option resolves, through the vocabulary, only to entities other than the intended one (for a field: no code
 *  on the intended code's line of descent). */
export function namesAnotherEntity(scope: Scope, option: PreparedOption): boolean {
  const id = scope.entityId;
  if (id === null || option.entityIds.length === 0) return false;
  if (scope.domain === 'field') {
    const { fields } = scope.vocab;
    return !option.entityIds.some((other) => fields.isSameOrAncestor(other, id) || fields.isSameOrAncestor(id, other));
  }
  return !option.entityIds.includes(id);
}

/** What the brackets of an option, and of the spelling it matched on its main key, allow. */
export interface BracketCheck {
  /** False when a bracket contradicts the match. */
  ok: boolean;
  /** An `other` bracket was ignored: the match is worth at most MATCH_EXACT_QUALIFIERS_IGNORED. */
  otherIgnored: boolean;
}

/** The intended degree's type, when the value is a degree that has one. */
function intendedTypes(scope: Scope) {
  const { intended } = scope.input;
  return intended.kind === 'degree' && intended.type !== null ? [intended.type] : undefined;
}

/** Checks the brackets of a main-key match between `option` and `surface` (null for a vocabulary spelling without
 *  brackets). */
export function bracketCheck(scope: Scope, surface: IntendedSurface | null, option: PreparedOption): BracketCheck {
  const { domain, vocab, entityId } = scope;
  const kinds: QualifierClass[] = [];
  if (option.norm.qualifiers.length > 0) {
    for (const { kind } of classifyQualifiers({ domain, vocab, main: option.norm, entityId,
      mainTypes: option.degree?.types })) kinds.push(kind);
  }
  if (surface && surface.norm.qualifiers.length > 0) {
    for (const { kind } of classifyQualifiers({ domain, vocab, main: surface.norm, entityId,
      mainTypes: intendedTypes(scope) })) kinds.push(kind);
  }
  if (kinds.includes('distinctive')
    && !bracketsAgree(scope.guard(), surface ? scope.surfaceSide(surface) : NO_BRACKETS, scope.optionSide(option))) {
    return { ok: false, otherIgnored: false };
  }
  const types = intendedTypes(scope);
  if (types && kinds.includes('degree-types') && option.degree && option.degree.qualifierTypes.length > 0) {
    const wanted = vocab.degrees.classOf(types[0]!);
    if (!option.degree.qualifierTypes.some((type) => vocab.degrees.classOf(type) === wanted)) {
      return { ok: false, otherIgnored: false };
    }
  }
  return { ok: true, otherIgnored: kinds.includes('other') };
}

/** An option's key can carry an exact or alias match: not empty, no unresolved "st?". */
export function keyUsable(option: PreparedOption): boolean {
  return option.norm.key !== '' && option.norm.ambiguous.length === 0;
}

/** A spelling can carry an exact match. */
function exactSurface(surface: IntendedSurface): boolean {
  return (surface.tier === 'raw' || surface.tier === 'primary') && surface.norm.key !== ''
    && surface.norm.ambiguous.length === 0 && !surface.norm.generated;
}

function exactHit(scope: Scope, surface: IntendedSurface, option: PreparedOption): StageHit | null {
  const rule = surface.tier === 'raw' ? 'raw' : 'primary';
  if (option.fullKey === surface.fullKey) return stageHit(option, 'exact', rule, MATCH_EXACT, INTENDED);
  const main = option.norm.key === surface.norm.key;
  const compact = !main && option.norm.core.length <= 3 && surface.norm.core.length <= 3
    && option.norm.compact === surface.norm.compact;
  if (!main && !compact) return null;
  const brackets = bracketCheck(scope, surface, option);
  if (!brackets.ok) return null;
  if (brackets.otherIgnored) {
    return stageHit(option, 'exact', 'qualifier-ignored', MATCH_EXACT_QUALIFIERS_IGNORED, INTENDED,
      ['qualifier-ignored']);
  }
  return stageHit(option, 'exact', compact ? 'compact' : rule, MATCH_EXACT, INTENDED);
}

/** Every option's best exact match. */
export function exactHits(scope: Scope, options: PreparedOptions): StageHit[] {
  const surfaces = scope.surfaces.filter(exactSurface);
  const hits: StageHit[] = [];
  if (surfaces.length === 0) return hits;
  for (const option of options.list) {
    if (!chooseable(option) || !keyUsable(option) || option.norm.generated) continue;
    if (namesAnotherEntity(scope, option)) continue;
    let best: StageHit | null = null;
    for (const surface of surfaces) {
      const hit = exactHit(scope, surface, option);
      if (hit && (!best || hit.confidence > best.confidence)) best = hit;
    }
    if (best) hits.push(best);
  }
  return hits;
}

/** Stage a: the winner among the exact matches (the matches all name the intended value, so they never tie). */
export function exactStage(scope: Scope, options: PreparedOptions): Ranked {
  return rankHits(exactHits(scope, options));
}
