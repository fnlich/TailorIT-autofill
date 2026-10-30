/*
 * Choosing among an exact or alias stage's hits (docs/design/core.md §4.3). Higher confidence wins, then the more
 * specific rule, then the lower option index. Options naming one answer (an "identity": the intended entity, one
 * degree class, one CIP code) are duplicates: the best is kept and flagged `same-entity-duplicates`. Different
 * answers at the same best confidence are a tie, which goes to the LLM tiebreak where the domain allows it. An option
 * whose label had injected text cut never scores above INJECTED_LABEL_CAP, so it is always flagged.
 */
import { INJECTED_LABEL_CAP } from '../confidence';
import type { MatchFlag, MatchRule } from '../types/match';
import type { PreparedOption } from './types';

/** One way an option matched. */
export interface StageHit {
  option: PreparedOption;
  stage: 'exact' | 'alias';
  rule: MatchRule;
  confidence: number;
  /** Compared after confidence: higher is more specific (an exact degree type before a class-mate). */
  rank: number;
  /** What the option names; equal identities are duplicates, different ones can tie. */
  identity: string;
  flags: MatchFlag[];
}

/** The stage's result: one winner, a tie between answers, or nothing. */
export type Ranked = { winner: StageHit } | { tie: StageHit[] } | null;

/** A hit for `option`, its confidence capped and flagged when the label had injected text cut (§7.8). */
export function stageHit(option: PreparedOption, stage: StageHit['stage'], rule: MatchRule, confidence: number,
  identity: string, flags: readonly MatchFlag[] = [], rank = 0): StageHit {
  const capped = option.injected ? Math.min(confidence, INJECTED_LABEL_CAP) : confidence;
  const all = option.injected && !flags.includes('injected-label') ? [...flags, 'injected-label' as const] : [...flags];
  return { option, stage, rule, confidence: capped, rank, identity, flags: all };
}

/** Best first: confidence, then rank, then option index. */
function better(a: StageHit, b: StageHit): number {
  return b.confidence - a.confidence || b.rank - a.rank || a.option.index - b.option.index;
}

/** The winner of a stage's hits, a tie, or null when there are none. An option matched by several rules counts once,
 *  by its best hit. */
export function rankHits(hits: readonly StageHit[]): Ranked {
  if (hits.length === 0) return null;
  const perOption = new Map<number, StageHit>();
  for (const hit of hits) {
    const known = perOption.get(hit.option.index);
    if (!known || better(hit, known) < 0) perOption.set(hit.option.index, hit);
  }
  const groups = new Map<string, { best: StageHit; options: Set<number> }>();
  for (const hit of perOption.values()) {
    const group = groups.get(hit.identity);
    if (!group) {
      groups.set(hit.identity, { best: hit, options: new Set([hit.option.index]) });
      continue;
    }
    group.options.add(hit.option.index);
    if (better(hit, group.best) < 0) group.best = hit;
  }
  const leaders = [...groups.values()].sort((a, b) => better(a.best, b.best));
  const top = leaders[0]!.best;
  const tied = leaders.filter(({ best }) => best.confidence === top.confidence && best.rank === top.rank);
  if (tied.length > 1) return { tie: tied.map(({ best }) => best).sort((a, b) => a.option.index - b.option.index) };
  const duplicates = leaders[0]!.options.size > 1;
  return { winner: duplicates && !top.flags.includes('same-entity-duplicates')
    ? { ...top, flags: [...top.flags, 'same-entity-duplicates'] } : top };
}
