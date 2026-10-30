/*
 * Stage c, fuzzy matching (docs/design/core.md §4.4), only where the domain allows it. Tokens are weighted by how
 * rare they are among the domain's vocabulary spellings, and paired one to one: equal tokens first, then different
 * ones whose Jaro-Winkler similarity is at least 0.93, both at least five letters long and neither distinctive (so
 * "Melon" may pair with "Mellon", never "Dallas" with "Austin"). The score is F = 0.7·dice + 0.3·Jaro-Winkler over
 * the sorted tokens, taken over the intended value's best spelling. An option is accepted only when F reaches 0.88,
 * the distinctive-token guard passes, and it beats the best option for a different answer by 0.05; a smaller gap is a
 * tie for the LLM. Only options sharing a token of weight 0.3 or more with a spelling are scored, at most 200. The
 * same scores rank the panel's suggestions and the LLM's candidates on long lists.
 */
import {
  FUZZY_ACCEPT, FUZZY_DICE_WEIGHT, FUZZY_JW_WEIGHT, FUZZY_MARGIN, FUZZY_PAIR_JW_FROM, FUZZY_PAIR_MIN_LENGTH,
  FUZZY_PAIR_SCORE, FUZZY_TIER_HIGH, FUZZY_TIER_HIGH_FROM, FUZZY_TIER_LOW, FUZZY_TIER_MID, FUZZY_TIER_MID_FROM,
  INJECTED_LABEL_CAP, MAX_SUGGESTIONS, PREFILTER_MAX_CANDIDATES, PREFILTER_MIN_WEIGHT, QUALIFIER_OTHER_WEIGHT,
  SMALL_MARGIN_BELOW, SMALL_MARGIN_PENALTY,
} from '../confidence';
import type { DegreeType } from '../enums';
import { AMBIGUOUS_ST } from '../text/abbreviations';
import type { Normalized } from '../text/normalize';
import { jaroWinkler } from '../text/similarity';
import type { Match, MatchFlag } from '../types/match';
import type { Vocab } from '../vocab/types';
import { namesAnotherEntity } from './exact';
import { distinctiveWord, type GuardVerdict } from './guardTokens';
import { substantive } from './prepare';
import { classifyQualifiers } from './qualifierClass';
import type { IntendedSurface, Scope } from './scope';
import type { MatchDomain, PreparedOption, PreparedOptions } from './types';

/** A text's weighted tokens. */
type Bag = Array<{ token: string; weight: number }>;

/** One scored option. */
export interface Scored {
  option: PreparedOption;
  /** F against the intended value's best spelling. */
  score: number;
  /** The best spelling paired different tokens (by Jaro-Winkler or an unresolved "st?"). */
  fuzzyPairs: boolean;
  /** A pair rested on an unresolved "st?". */
  ambiguousSt: boolean;
  /** What the option names: options with one identity are one answer. */
  identity: string;
  /** The distinctive-token guard's verdict. */
  verdict: GuardVerdict;
}

/** The IDF weight of a token among the domain's spellings (§4.4): rare or unseen tokens weigh 1. */
export function tokenWeight(token: string, domain: MatchDomain, vocab: Vocab): number {
  if (domain === 'number' || domain === 'generic') return 1;
  const count = vocab.docCount(domain);
  const df = vocab.df(domain, token === AMBIGUOUS_ST ? 'state' : token);
  if (count === 0 || df === 0) return 1;
  return Math.log(1 + count / df) / Math.log(1 + count);
}

/** A text's tokens with their weights: the core, then the brackets that count (`other` ones at half weight; noise,
 *  redundant and degree-type ones dropped). */
function bag(norm: Normalized, scope: Scope, degreeTypes?: readonly DegreeType[]): Bag {
  const out: Bag = norm.core.map((token) => ({ token, weight: tokenWeight(token, scope.domain, scope.vocab) }));
  if (norm.qualifiers.length === 0) return out;
  for (const { qualifier, kind } of classifyQualifiers({ domain: scope.domain, vocab: scope.vocab, main: norm,
    entityId: scope.entityId, mainTypes: degreeTypes })) {
    if (kind !== 'distinctive' && kind !== 'other') continue;
    const factor = kind === 'other' ? QUALIFIER_OTHER_WEIGHT : 1;
    for (const token of qualifier.tokens) {
      out.push({ token, weight: factor * tokenWeight(token, scope.domain, scope.vocab) });
    }
  }
  return out;
}

const SAINT_OR_STATE = new Set(['saint', 'state']);

/** F between two bags, with what the pairing needed. */
export function fuzzyScore(a: Bag, b: Bag, domain: MatchDomain, vocab: Vocab):
  { score: number; fuzzyPairs: boolean; ambiguousSt: boolean } {
  const total = a.reduce((sum, item) => sum + item.weight, 0) + b.reduce((sum, item) => sum + item.weight, 0);
  const usedA = new Array<boolean>(a.length).fill(false);
  const usedB = new Array<boolean>(b.length).fill(false);
  let paired = 0;
  let fuzzyPairs = false;
  let ambiguousSt = false;
  const pair = (i: number, j: number, value: number) => {
    usedA[i] = true;
    usedB[j] = true;
    paired += value * (a[i]!.weight + b[j]!.weight);
  };
  a.forEach((item, i) => {
    const j = b.findIndex((other, at) => !usedB[at] && other.token === item.token);
    if (j >= 0) pair(i, j, 1);
  });
  a.forEach((item, i) => {
    if (usedA[i]) return;
    const j = b.findIndex((other, at) => !usedB[at] && ((item.token === AMBIGUOUS_ST && SAINT_OR_STATE.has(other.token))
      || (other.token === AMBIGUOUS_ST && SAINT_OR_STATE.has(item.token))));
    if (j < 0) return;
    pair(i, j, FUZZY_PAIR_SCORE);
    fuzzyPairs = true;
    ambiguousSt = true;
  });
  const near: Array<{ i: number; j: number; similarity: number }> = [];
  a.forEach((item, i) => {
    if (usedA[i] || item.token.length < FUZZY_PAIR_MIN_LENGTH || distinctiveWord(item.token, domain, vocab)) return;
    b.forEach((other, j) => {
      if (usedB[j] || other.token.length < FUZZY_PAIR_MIN_LENGTH || distinctiveWord(other.token, domain, vocab)) return;
      const similarity = jaroWinkler(item.token, other.token);
      if (similarity >= FUZZY_PAIR_JW_FROM) near.push({ i, j, similarity });
    });
  });
  near.sort((x, y) => y.similarity - x.similarity || x.i - y.i || x.j - y.j);
  for (const { i, j } of near) {
    if (usedA[i] || usedB[j]) continue;
    pair(i, j, FUZZY_PAIR_SCORE);
    fuzzyPairs = true;
  }
  const dice = total === 0 ? 0 : paired / total;
  const sorted = (items: Bag) => items.map((item) => item.token).sort().join(' ');
  const score = FUZZY_DICE_WEIGHT * dice + FUZZY_JW_WEIGHT * jaroWinkler(sorted(a), sorted(b));
  return { score, fuzzyPairs, ambiguousSt };
}

/** What an option names: the one entity it resolves to (for a field, the most specific code of one line of
 *  descent), else its key. */
export function optionIdentity(scope: Scope, option: PreparedOption): string {
  if (option.entityHits.length > 0 && !option.entityHits.some((hit) => hit.ambiguous)) {
    const one = scope.domain === 'field' ? scope.vocab.fields.mostSpecific(option.entityIds)
      : option.entityIds.length === 1 ? option.entityIds[0]! : null;
    if (one !== null) return one;
  }
  return `key:${option.fullKey}`;
}

/** The spellings fuzzy matching compares: unambiguous ones with a key, a flagship's bare name excepted (it maps a
 *  system name to a campus only at the alias stage). */
function fuzzySurfaces(scope: Scope): IntendedSurface[] {
  return scope.surfaces.filter((surface) => surface.norm.key !== '' && surface.tier !== 'flagship');
}

const SCORED = new WeakMap<Scope, Scored[]>();

/** Every option worth scoring, scored, best first: the prefilter's candidates, at most 200. */
export function scoreOptions(scope: Scope, options: PreparedOptions): Scored[] {
  const known = SCORED.get(scope);
  if (known) return known;
  const intendedTypes = scope.input.intended.kind === 'degree' && scope.input.intended.type !== null
    ? [scope.input.intended.type] : undefined;
  const bags = fuzzySurfaces(scope).map((surface) => bag(surface.norm, scope, intendedTypes));
  const shared = new Map<number, number>();
  const seen = new Set<string>();
  for (const surfaceBag of bags) {
    for (const { token, weight } of surfaceBag) {
      if (weight < PREFILTER_MIN_WEIGHT || seen.has(token)) continue;
      seen.add(token);
      for (const position of options.byToken.get(token) ?? []) {
        shared.set(position, (shared.get(position) ?? 0) + weight);
      }
    }
  }
  const positions = [...shared.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0])
    .map(([position]) => position).filter((position) => substantive(options.list[position]!))
    .slice(0, PREFILTER_MAX_CANDIDATES);
  const scored = positions.map((position): Scored => {
    const option = options.list[position]!;
    const optionBag = bag(option.norm, scope, option.degree?.types);
    let best = { score: 0, fuzzyPairs: false, ambiguousSt: false };
    for (const surfaceBag of bags) {
      const result = fuzzyScore(surfaceBag, optionBag, scope.domain, scope.vocab);
      if (result.score > best.score) best = result;
    }
    return { option, ...best, identity: optionIdentity(scope, option), verdict: scope.verdict(option) };
  });
  scored.sort((x, y) => y.score - x.score || x.option.index - y.option.index);
  SCORED.set(scope, scored);
  return scored;
}

/** The fuzzy stage's answer: a winner, a tie (the options within the margin, one per answer), or nothing. */
export type FuzzyResult = { winner: Match } | { tie: Scored[] } | null;

/** The best score per identity, best first. */
function bestPerIdentity(scored: readonly Scored[]): Scored[] {
  const seen = new Set<string>();
  const out: Scored[] = [];
  for (const item of scored) {
    if (seen.has(item.identity)) continue;
    seen.add(item.identity);
    out.push(item);
  }
  return out;
}

/**
 * Stage c over the scored options (§4.4). An option the vocabulary resolves to another entity never wins, however
 * close its spelling, but it still counts against the margin.
 */
export function fuzzyStage(scope: Scope, options: PreparedOptions): FuzzyResult {
  const passing = scoreOptions(scope, options).filter((item) => item.verdict.pass);
  const leaders = bestPerIdentity(passing);
  const best = leaders.find((item) => !namesAnotherEntity(scope, item.option));
  if (!best || best.score < FUZZY_ACCEPT) return null;
  const margin = best.score - (leaders.find((item) => item.identity !== best.identity)?.score ?? 0);
  if (margin < FUZZY_MARGIN) return { tie: leaders.filter((item) => item.score >= best.score - FUZZY_MARGIN) };
  let confidence = best.score >= FUZZY_TIER_HIGH_FROM && !best.fuzzyPairs ? FUZZY_TIER_HIGH
    : best.score >= FUZZY_TIER_MID_FROM ? FUZZY_TIER_MID : FUZZY_TIER_LOW;
  const flags: MatchFlag[] = [];
  if (margin < SMALL_MARGIN_BELOW) {
    confidence -= SMALL_MARGIN_PENALTY;
    flags.push('small-margin');
  }
  if (best.ambiguousSt) flags.push('ambiguous-abbreviation');
  if (best.option.injected) {
    confidence = Math.min(confidence, INJECTED_LABEL_CAP);
    flags.push('injected-label');
  }
  if (passing.filter((item) => item.identity === best.identity && item.score >= FUZZY_ACCEPT).length > 1) {
    flags.push('same-entity-duplicates');
  }
  return {
    winner: {
      stage: 'fuzzy', optionIndex: best.option.index, rule: 'token-set', confidence: round(confidence),
      score: round(best.score), margin: round(margin), flags, suggestions: [],
      reason: best.option.injected ? 'option-label-had-injected-text' : 'ok',
    },
  };
}

/** Rounds to four decimals, so scores are stable across platforms in reports and tests. */
export function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Up to three nearest options for the review panel, never one the guard rules out for good. */
export function suggestionsOf(scored: readonly Scored[]): Array<{ index: number; score: number }> {
  return scored.filter((item) => item.score > 0 && !(item.verdict.pass === false && item.verdict.hard))
    .slice(0, MAX_SUGGESTIONS).map((item) => ({ index: item.option.index, score: round(item.score) }));
}
