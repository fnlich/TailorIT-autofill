/*
 * Choosing among an exact or alias stage's hits (docs/design/core.md §4.3). Higher confidence wins, then the more
 * specific rule, then the lower option index. Options naming one answer (an "identity": the intended entity, one
 * degree class, one CIP code) are duplicates: the best is kept and flagged `same-entity-duplicates`. Different
 * answers at the same best confidence are a tie, which goes to the LLM tiebreak where the domain allows it. An option
 * whose label had injected text cut never scores above INJECTED_LABEL_CAP, so it is always flagged.
 *
 * Duplicates must be one answer under several spellings ("MIT", "Massachusetts Institute of Technology"). Options of
 * one identity at the best confidence whose brackets differ ("English (US)", "English (UK)") are not: the brackets
 * are all that tells them apart, and nothing in the profile says which the person means. They are variants, a tie
 * no stage may break (not the LLM either), so the field is left blank with them as suggestions. A plain spelling at
 * that confidence still wins over its bracketed variants.
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
  /** The option's brackets that set it apart from a plainer spelling of the same answer, when the stage read them
   *  ('' or absent for none): two hits of one identity with different variants are not duplicates. */
  variant?: string;
}

/** The stage's result: one winner, a tie between answers (or between variants of one answer, which nothing may
 *  break), or nothing. */
export type Ranked = { winner: StageHit } | { tie: StageHit[]; variants?: true } | null;

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

/** A hit flagged as one of several options naming its answer. */
function withDuplicates(hit: StageHit): StageHit {
  return hit.flags.includes('same-entity-duplicates') ? hit
    : { ...hit, flags: [...hit.flags, 'same-entity-duplicates'] };
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
  const groups = new Map<string, StageHit[]>();
  for (const hit of perOption.values()) {
    const group = groups.get(hit.identity);
    if (group) group.push(hit);
    else groups.set(hit.identity, [hit]);
  }
  for (const group of groups.values()) group.sort(better);
  const leaders = [...groups.values()].sort((a, b) => better(a[0]!, b[0]!));
  const top = leaders[0]![0]!;
  const level = (hit: StageHit) => hit.confidence === top.confidence && hit.rank === top.rank;
  const tied = leaders.filter((group) => level(group[0]!));
  if (tied.length > 1) return { tie: tied.map((group) => group[0]!).sort((a, b) => a.option.index - b.option.index) };
  const group = leaders[0]!;
  const best = group.filter(level);
  if (new Set(best.map((hit) => hit.variant ?? '')).size > 1) {
    const plain = best.find((hit) => (hit.variant ?? '') === '');
    if (!plain) return { tie: [...best].sort((a, b) => a.option.index - b.option.index), variants: true };
    return { winner: withDuplicates(plain) };
  }
  return { winner: group.length > 1 ? withDuplicates(top) : top };
}
