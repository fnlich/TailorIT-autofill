/*
 * The matcher cascade (docs/design/core.md §4): one intended value onto one field's visible options. The stages run
 * in order and stop at the first success, which records its stage and rule:
 *   cache, a exact, b alias, c fuzzy, d LLM tiebreak, e "Other" plus free text, f blank with suggestions.
 * The domain table and the field's policy class decide which stages may run (domains.ts). A tie at the alias or fuzzy
 * stage goes to stage d; the LLM itself is not called here: matchOne hands back the question and what completes it
 * (completeTiebreak, tiebreak.ts), so the cascade stays pure and the worker batches one task per pass. A hard
 * conflict found by the distinctive-token guard can be overruled by no stage: such an option is never a candidate,
 * and a cached choice of one is stale. A tie between bracketed variants of the intended answer ("English (US)",
 * "English (UK)") goes to no later stage: nothing in the profile can decide it, so the field is left blank with the
 * variants as suggestions.
 */
import { MAX_SUGGESTIONS } from '../confidence';
import type { ReasonCode } from '../types/fill';
import type { IntendedValue } from '../types/intent';
import type { Match } from '../types/match';
import { aliasStage } from './alias';
import { cacheKeyOf, cacheLookup } from './cache';
import { stagePlan } from './domains';
import { exactStage, needsHispanicAnswer } from './exact';
import { fuzzyStage, scoreOptions, suggestionsOf } from './fuzzy';
import { otherMatch } from './other';
import { chooseable, substantive } from './prepare';
import type { Ranked, StageHit } from './rank';
import { buildScope, type Scope } from './scope';
import { buildTiebreak, hardConflict, tiebreakCandidates } from './tiebreak';
import type { MatchContext, MatchDomain, MatchInput, MatchOutcome, PreparedOption, PreparedOptions } from './types';

/** A blank match (stage f): nothing is written, and the panel may show the suggestions. */
export function noMatch(reason: ReasonCode, suggestions: Match['suggestions'] = []): Match {
  return { stage: 'none', optionIndex: null, rule: null, confidence: 0, flags: [], suggestions, reason };
}

/** A stage's winning hit as a match. */
function matchOf(hit: StageHit): Match {
  return {
    stage: hit.stage, optionIndex: hit.option.index, rule: hit.rule, confidence: hit.confidence, flags: hit.flags,
    suggestions: [], reason: hit.option.injected ? 'option-label-had-injected-text' : 'ok',
  };
}

/** Whether a value can be matched over options prepared for `domain`. */
function fits(intended: IntendedValue, domain: MatchDomain): boolean {
  switch (intended.kind) {
    case 'entity':
    case 'decline':
      return intended.domain === domain;
    case 'degree':
      return domain === 'degree';
    case 'boolean':
      return domain === 'polarity';
    case 'number':
      return domain === 'number';
    default:
      return true;
  }
}

/** A race option the value would match on its main text but for a Hispanic or Latino bracket that the person gave
 *  no answer for ("White (Not Hispanic or Latino)" with that answer absent or declined). */
function waitsForHispanicAnswer(scope: Scope, options: PreparedOptions): boolean {
  const keys = new Set(scope.surfaces.map((surface) => surface.norm.key));
  return options.list.some((option) => chooseable(option) && keys.has(option.norm.key)
    && needsHispanicAnswer(scope, option));
}

/** Why nothing was chosen, when no stage tied: the form has no decline option, its options need an EEO answer the
 *  profile lacks, the guard ruled out the near options, or nothing came close. */
function noMatchReason(scope: Scope, options: PreparedOptions): ReasonCode {
  if (scope.input.intended.kind === 'decline') return 'decline-option-missing';
  if (options.list.some((option) => option.injected && option.unusable)
    && !options.list.some((option) => substantive(option))) return 'injected-option-only';
  if (waitsForHispanicAnswer(scope, options)) return 'eeo-not-in-profile';
  return scoreOptions(scope, options).some((item) => !item.verdict.pass) ? 'distinctive-token-mismatch' : 'no-match';
}

/** The panel's suggestions: the tied options first, then the nearest others. */
function suggestionsFor(scope: Scope, options: PreparedOptions, tied: readonly PreparedOption[] | undefined):
  Match['suggestions'] {
  const nearest = suggestionsOf(scoreOptions(scope, options));
  if (!tied) return nearest;
  const scores = new Map(nearest.map((item) => [item.index, item.score]));
  const first = tied.map((option) => ({ index: option.index, score: scores.get(option.index) ?? 0 }));
  const rest = nearest.filter((item) => !tied.some((option) => option.index === item.index));
  return [...first, ...rest].slice(0, MAX_SUGGESTIONS);
}

/** The options a stage's tie leaves for stage d. */
function tiedOptions(ranked: Ranked): PreparedOption[] | undefined {
  return ranked && 'tie' in ranked ? ranked.tie.map((hit) => hit.option) : undefined;
}

/** A stage's tie between variants of the intended answer as a blank match, the variants first among the
 *  suggestions; null for any other result. */
function variantsTie(scope: Scope, options: PreparedOptions, ranked: Ranked): Match | null {
  if (!ranked || !('tie' in ranked) || !ranked.variants) return null;
  return noMatch('ambiguous-options', suggestionsFor(scope, options, tiedOptions(ranked)));
}

/** Matches one value against one field's options (§4.0). */
export function matchOne(input: MatchInput, ctx: MatchContext): MatchOutcome {
  const { options } = input;
  if (options.list.length === 0 || options.list.every((option) => option.placeholder)) {
    return { done: false, waiting: 'options' };
  }
  if (!fits(input.intended, options.domain)) return { done: true, match: noMatch('internal-error') };
  const plan = stagePlan(options.domain, input.policy, ctx.llm);
  const scope = buildScope(input, ctx.vocab, plan);
  if (!scope) return { done: true, match: noMatch('format-unsupported') };

  let cacheDrop: string | undefined;
  const finish = (match: Match): MatchOutcome => (cacheDrop === undefined ? { done: true, match }
    : { done: true, match, cacheDrop });

  // The pre-stage: an accepted match, checked again against the current options and the current value. A cached
  // option the guard or the degree rules now rule out (the entry's field changed, say) is stale.
  if (plan.cache && ctx.cache) {
    const key = cacheKeyOf(input);
    const found = key === null ? null : cacheLookup(ctx.cache, key, options);
    const cached = found && 'hit' in found
      ? options.list.find((option) => option.index === found.hit.optionIndex) : undefined;
    if (found && 'hit' in found && cached && !hardConflict(scope, cached)) return { done: true, match: found.hit };
    if (found) cacheDrop = key!;
  }
  if (!options.list.some(chooseable)) return finish(noMatch(noMatchReason(scope, options)));

  let tied: PreparedOption[] | undefined;
  if (plan.exact) {
    const exact = exactStage(scope, options);
    if (exact && 'winner' in exact) return finish(matchOf(exact.winner));
    const variants = variantsTie(scope, options, exact);
    if (variants) return finish(variants);
    tied = tiedOptions(exact);
  }
  if (!tied) {
    const alias = aliasStage(scope, options);
    if (alias && 'winner' in alias) return finish(matchOf(alias.winner));
    const variants = variantsTie(scope, options, alias);
    if (variants) return finish(variants);
    tied = tiedOptions(alias);
  }
  if (!tied && plan.fuzzy) {
    const fuzzy = fuzzyStage(scope, options);
    if (fuzzy && 'winner' in fuzzy) return finish(fuzzy.winner);
    if (fuzzy) tied = fuzzy.tie.map((item) => item.option);
  }

  const reason: ReasonCode = tied ? 'ambiguous-options' : noMatchReason(scope, options);
  const fallback = (plan.other ? otherMatch(options, scope.display) : null)
    ?? noMatch(reason, suggestionsFor(scope, options, tied));
  if (plan.llm) {
    const built = buildTiebreak(scope, tiebreakCandidates(scope, options, tied), fallback);
    if (built) {
      return cacheDrop === undefined ? { done: false, tiebreak: built.item, partial: built.partial }
        : { done: false, tiebreak: built.item, partial: built.partial, cacheDrop };
    }
  }
  return finish(fallback);
}
