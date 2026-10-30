/*
 * Stage a, exact (docs/design/core.md §4.2): the option's key, or its compact form for labels of at most three
 * tokens ("Linked In" = "LinkedIn"), equals the key of a raw or primary spelling of the intended value. Brackets must
 * not contradict it: a distinctive one must agree, a noise or redundant one is ignored, and any other lowers the
 * match to 0.95 (`qualifier-ignored`). A key that rests on an unresolved "st?", or on the generated reading of a
 * trailing "cc", is never exact. An option that the vocabulary resolves to a different entity is never the intended
 * one, whatever the person typed. The helpers here are shared with the alias stage.
 *
 * Brackets are what tell some options apart, so three rules keep them from being ignored where that would guess:
 * - options of one main key with different brackets ("Chinese (Mandarin)", "Chinese (Cantonese)") are variants, none
 *   of whose brackets is redundant, and a hit carries its variant so ranking can tell variants from duplicates;
 * - in an EEO domain no bracket but noise or a redundant one is ever ignored: the value comes from explicit answers
 *   only (§8.7), so "Woman (cisgender)" is not "Female";
 * - on a race question, a bracket that answers the Hispanic or Latino question ("White (Not Hispanic or Latino)")
 *   is an assertion, which holds only when the person's explicit answer agrees.
 */
import { MATCH_EXACT, MATCH_EXACT_QUALIFIERS_IGNORED } from '../confidence';
import type { Qualifier } from '../text/qualifiers';
import { removeStopwords } from '../text/tokens';
import type { Vocab } from '../vocab/types';
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
 *  on the intended code's line of descent; for a referral source: neither it nor a kind of source it is one of, so
 *  "Job board" is Indeed's answer, less precisely). */
export function namesAnotherEntity(scope: Scope, option: PreparedOption): boolean {
  const id = scope.entityId;
  if (id === null || option.entityIds.length === 0) return false;
  if (scope.domain === 'field') {
    const { fields } = scope.vocab;
    return !option.entityIds.some((other) => fields.isSameOrAncestor(other, id) || fields.isSameOrAncestor(id, other));
  }
  if (scope.domain === 'referral') {
    const own = scope.vocab.entity(id);
    const parents = own?.kind === 'referral' ? own.parents : [];
    return !option.entityIds.some((other) => other === id || parents.includes(other));
  }
  return !option.entityIds.includes(id);
}

/**
 * The option names only entities the vocabulary knows outright, none of them the intended one ("Glassdoor" for
 * LinkedIn, "Accounting" for Finance): a different answer, which no stage, the LLM included, may choose. A short form
 * that more schools answer to than the vocabulary lists ("OSU") is no such answer; for a field, a code on the intended
 * code's line of descent is the same answer (the CIP parent rule).
 */
export function namesKnownOther(scope: Scope, option: PreparedOption): boolean {
  return option.entityHits.length > 0 && option.entityHits.every((hit) => !hit.shortForm)
    && namesAnotherEntity(scope, option);
}

/** What the brackets of an option, and of the spelling it matched on its main key, allow. */
export interface BracketCheck {
  /** False when a bracket contradicts the match. */
  ok: boolean;
  /** An `other` bracket was ignored: the match is worth at most MATCH_EXACT_QUALIFIERS_IGNORED. */
  otherIgnored: boolean;
  /** The option's brackets that set it apart from a plainer spelling of the same answer ("remote" for "United States
   *  (Remote)"), joined; '' when there are none. A distinctive bracket the entity explains ("(Cambridge, MA)") sets
   *  nothing apart. */
  variant: string;
}

/** The yes or no a bracket gives to the Hispanic or Latino question ("(Not Hispanic or Latino)" gives false), or null
 *  when it gives none. */
export function hispanicAssertion(qualifier: Qualifier, vocab: Vocab): boolean | null {
  const key = removeStopwords(qualifier.tokens, 'answer').join(' ');
  const ids = new Set(vocab.lookup('eeo.hispanicLatino', key).filter((hit) => !hit.ambiguous).map((hit) => hit.id));
  if (ids.size !== 1) return null;
  const [id] = [...ids];
  return id === 'eeo.hispanicLatino:yes' ? true : id === 'eeo.hispanicLatino:no' ? false : null;
}

/** Whether a race option's brackets need a Hispanic or Latino answer the person did not give: some bracket asserts
 *  one, and the input carries none. */
export function needsHispanicAnswer(scope: Scope, option: PreparedOption): boolean {
  return scope.domain === 'eeo.race' && scope.input.hispanicLatino === undefined
    && option.norm.qualifiers.some((qualifier) => hispanicAssertion(qualifier, scope.vocab) !== null);
}

/** The intended degree's type, when the value is a degree that has one. */
function intendedTypes(scope: Scope) {
  const { intended } = scope.input;
  return intended.kind === 'degree' && intended.type !== null ? [intended.type] : undefined;
}

/** An option's brackets, classed (§3.4). One that would be redundant is `other` when sibling options share the main
 *  key with other brackets: it is then what tells the option from them. */
function optionBrackets(scope: Scope, option: PreparedOption): Array<{ qualifier: Qualifier; kind: QualifierClass }> {
  if (option.norm.qualifiers.length === 0) return [];
  const { domain, vocab, entityId } = scope;
  return classifyQualifiers({ domain, vocab, main: option.norm, entityId, mainTypes: option.degree?.types })
    .map(({ qualifier, kind }) => ({ qualifier,
      kind: kind === 'redundant' && option.bracketSiblings ? 'other' : kind }));
}

/** The bracket classes that set an option apart from a plainer spelling of the same answer. */
const VARIANT_CLASSES: ReadonlySet<QualifierClass> = new Set<QualifierClass>(['other', 'degree-types']);

/** An option's variant: its `other` and degree-type brackets, joined ('' for none). Noise and redundant brackets say
 *  nothing, and a distinctive one either fits the entity (and sets nothing apart) or rules the option out. */
export function bracketVariant(scope: Scope, option: PreparedOption): string {
  return optionBrackets(scope, option).filter(({ kind }) => VARIANT_CLASSES.has(kind))
    .map(({ qualifier }) => qualifier.tokens.join(' ')).join('|');
}

const REFUSED: BracketCheck = { ok: false, otherIgnored: false, variant: '' };

/** Checks the brackets of a main-key match between `option` and `surface` (null for a vocabulary spelling without
 *  brackets). */
export function bracketCheck(scope: Scope, surface: IntendedSurface | null, option: PreparedOption): BracketCheck {
  const { domain, vocab, entityId } = scope;
  const eeo = domain.startsWith('eeo.');
  const kinds: QualifierClass[] = [];
  const variant: string[] = [];
  for (const { qualifier, kind } of optionBrackets(scope, option)) {
    if (kind === 'noise' || kind === 'redundant') continue;
    if (eeo) {
      // An assertion the person's explicit answer agrees with is part of the answer, not a bracket to ignore.
      const asserted = domain === 'eeo.race' ? hispanicAssertion(qualifier, vocab) : null;
      if (asserted !== null && asserted === scope.input.hispanicLatino) continue;
      return REFUSED;
    }
    kinds.push(kind);
    if (VARIANT_CLASSES.has(kind)) variant.push(qualifier.tokens.join(' '));
  }
  if (surface && surface.norm.qualifiers.length > 0) {
    for (const { kind } of classifyQualifiers({ domain, vocab, main: surface.norm, entityId,
      mainTypes: intendedTypes(scope) })) {
      if (eeo && kind !== 'noise' && kind !== 'redundant') return REFUSED;
      kinds.push(kind);
    }
  }
  if (kinds.includes('distinctive')
    && !bracketsAgree(scope.guard(), surface ? scope.surfaceSide(surface) : NO_BRACKETS, scope.optionSide(option))) {
    return REFUSED;
  }
  const types = intendedTypes(scope);
  if (types && kinds.includes('degree-types') && option.degree && option.degree.qualifierTypes.length > 0) {
    const wanted = vocab.degrees.classOf(types[0]!);
    if (!option.degree.qualifierTypes.some((type) => vocab.degrees.classOf(type) === wanted)) return REFUSED;
  }
  return { ok: true, otherIgnored: kinds.includes('other'), variant: variant.join('|') };
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
  const hit = brackets.otherIgnored
    ? stageHit(option, 'exact', 'qualifier-ignored', MATCH_EXACT_QUALIFIERS_IGNORED, INTENDED, ['qualifier-ignored'])
    : stageHit(option, 'exact', compact ? 'compact' : rule, MATCH_EXACT, INTENDED);
  return { ...hit, variant: brackets.variant };
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

/**
 * The options that share a main key with the intended value's exact spellings and carry brackets, but did not match:
 * their bracket was refused, or it names another entity ("Chinese (Cantonese)" beside "Chinese (Mandarin)").
 */
function refusedSiblings(scope: Scope, options: PreparedOptions, hits: readonly StageHit[]): PreparedOption[] {
  const keys = new Set(scope.surfaces.filter(exactSurface).map((surface) => surface.norm.key));
  return options.list.filter((option) => chooseable(option) && keyUsable(option) && option.norm.qualifiers.length > 0
    && keys.has(option.norm.key) && !hits.some((hit) => hit.option === option));
}

/**
 * Stage a: the winner among the exact matches (the matches all name the intended value, so they never tie). A winner
 * that only matched with a bracket set aside ("Chinese (Mandarin)" for "Chinese") still competes with the siblings
 * whose bracket was refused ("Chinese (Cantonese)"): the profile cannot say which variant the person means, so they
 * tie as variants and nothing is chosen. A plain spelling ("Chinese") still wins.
 */
export function exactStage(scope: Scope, options: PreparedOptions): Ranked {
  const hits = exactHits(scope, options);
  const ranked = rankHits(hits);
  if (!ranked || !('winner' in ranked) || (ranked.winner.variant ?? '') === '') return ranked;
  const siblings = refusedSiblings(scope, options, hits);
  if (siblings.length === 0) return ranked;
  const tie = [ranked.winner, ...siblings.map((option) => stageHit(option, 'exact', 'qualifier-ignored', 0, INTENDED))];
  return { tie: tie.sort((a, b) => a.option.index - b.option.index), variants: true };
}
