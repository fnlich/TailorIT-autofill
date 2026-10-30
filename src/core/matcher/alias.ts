/*
 * Stage b, alias and canonical entity (docs/design/core.md §4.3). Which rules run is the domain's (domains.ts):
 * - tiered spellings: the option's key equals an unambiguous curated, vocabulary, generated or flagship spelling of
 *   the intended value (0.97 / 0.95 / 0.92 / 0.90). A trailing "cc" read as "community college" makes a spelling
 *   generated, wherever it is;
 * - entity id: the option resolves to the intended entity alone (0.95, never above the tier it resolved through, so
 *   a flagship stays flagged);
 * - CIP title and parent for fields of study, the degree rules (degree.ts), mentions, polarity and numeric ranges;
 * - a decline is matched to the form's decline options only, in any domain.
 * Higher confidence wins (rank.ts); different answers at the same best confidence are a tie for the LLM.
 */
import {
  ALIAS_CONFIDENCE, MATCH_CIP_PARENT, MATCH_CIP_TITLE, MATCH_ENTITY_ID, MATCH_EXACT_QUALIFIERS_IGNORED,
} from '../confidence';
import type { SurfaceTier, VocabDomain } from '../types/intent';
import type { MatchRule } from '../types/match';
import type { VocabTier } from '../vocab/types';
import { degreeHits } from './degree';
import { bracketCheck, INTENDED, keyUsable, namesAnotherEntity } from './exact';
import { mentionHits } from './mention';
import { polarityHits } from './polarity';
import { chooseable } from './prepare';
import { rangeHits } from './range';
import { rankHits, stageHit, type Ranked, type StageHit } from './rank';
import type { IntendedSurface, Scope } from './scope';
import type { PreparedOption, PreparedOptions } from './types';

/** The alias tiers, best first, and the rule each one is reported as. */
const TIER_RULES: ReadonlyArray<[Exclude<VocabTier, 'primary'>, MatchRule]> = [
  ['curated', 'curated-alias'], ['vocab', 'vocab-alias'], ['generated', 'generated-alias'], ['flagship', 'flagship'],
];
const TIER_ORDER: Readonly<Record<string, number>> = { curated: 0, vocab: 1, generated: 2, flagship: 3 };

/** The alias tier a spelling counts as: raw and primary spellings count only when a trailing "cc" made them
 *  generated. */
function aliasTier(surface: IntendedSurface): Exclude<VocabTier, 'primary'> | null {
  if (surface.norm.ambiguous.length > 0 || surface.norm.key === '') return null;
  if (surface.norm.generated) return 'generated';
  const tier: SurfaceTier = surface.tier;
  return tier === 'raw' || tier === 'primary' ? null : tier;
}

/** The confidence of an entity-id match through a hit of `tier`. */
function entityIdConfidence(tier: VocabTier): number {
  return tier === 'primary' ? MATCH_ENTITY_ID : Math.min(MATCH_ENTITY_ID, ALIAS_CONFIDENCE[tier]);
}

/** Options whose key equals an alias-tier spelling, brackets checked. */
function tieredHits(scope: Scope, options: PreparedOptions): StageHit[] {
  const byKey = new Map<string, { tier: Exclude<VocabTier, 'primary'>; surface: IntendedSurface }>();
  for (const surface of scope.surfaces) {
    const tier = aliasTier(surface);
    if (tier === null) continue;
    for (const key of new Set([surface.norm.key, surface.fullKey])) {
      const known = byKey.get(key);
      if (!known || TIER_ORDER[tier]! < TIER_ORDER[known.tier]!) byKey.set(key, { tier, surface });
    }
  }
  // Raw and primary spellings: an option whose own key is generated ("Austin CC") matches them as generated.
  const plain = new Set(scope.surfaces.filter((surface) => surface.tier === 'raw' || surface.tier === 'primary')
    .map((surface) => surface.norm.key));
  const hits: StageHit[] = [];
  for (const option of options.list) {
    if (!chooseable(option) || !keyUsable(option) || namesAnotherEntity(scope, option)) continue;
    const whole = byKey.get(option.fullKey);
    if (whole) {
      const rule = TIER_RULES.find(([tier]) => tier === whole.tier)![1];
      hits.push(stageHit(option, 'alias', rule, ALIAS_CONFIDENCE[whole.tier], INTENDED));
      continue;
    }
    const generated = option.norm.generated && plain.has(option.norm.key);
    const known = byKey.get(option.norm.key) ?? (generated ? { tier: 'generated' as const, surface: null } : undefined);
    if (!known) continue;
    const brackets = bracketCheck(scope, known.surface, option);
    if (!brackets.ok) continue;
    const rule = TIER_RULES.find(([tier]) => tier === known.tier)![1];
    const confidence = ALIAS_CONFIDENCE[known.tier];
    hits.push(brackets.otherIgnored
      ? stageHit(option, 'alias', rule, Math.min(confidence, MATCH_EXACT_QUALIFIERS_IGNORED), INTENDED,
        ['qualifier-ignored'])
      : stageHit(option, 'alias', rule, confidence, INTENDED));
  }
  return hits;
}

/** Options the vocabulary resolves to the intended entity alone, when no spelling matched them. */
function entityIdHits(scope: Scope, options: PreparedOptions, matched: ReadonlySet<PreparedOption>): StageHit[] {
  const id = scope.entityId;
  if (id === null) return [];
  const hits: StageHit[] = [];
  for (const option of options.list) {
    if (matched.has(option) || !chooseable(option) || !keyUsable(option)) continue;
    if (option.entityIds.length !== 1 || option.entityIds[0] !== id) continue;
    const hit = option.entityHits.find((candidate) => candidate.id === id)!;
    if (hit.ambiguous) continue;
    hits.push(stageHit(option, 'alias', 'entity-id', entityIdConfidence(hit.tier), INTENDED));
  }
  return hits;
}

/** Options naming the intended CIP code, or a 2- or 4-digit code above it. */
function cipHits(scope: Scope, options: PreparedOptions): StageHit[] {
  const id = scope.entityId;
  if (id === null) return [];
  const { fields } = scope.vocab;
  const ancestors = new Set(fields.ancestorsOf(id));
  const hits: StageHit[] = [];
  for (const option of options.list) {
    if (!chooseable(option) || !keyUsable(option) || option.entityIds.length === 0) continue;
    if (option.entityHits.some((hit) => hit.ambiguous)) continue;
    if (fields.mostSpecific(option.entityIds) === id) {
      hits.push(stageHit(option, 'alias', 'cip-title', MATCH_CIP_TITLE, INTENDED));
      continue;
    }
    // Every code the label names counts: "Computer and Information Sciences" is its general program and its family.
    const parent = option.entityIds.find((other) => ancestors.has(other));
    if (parent !== undefined) hits.push(stageHit(option, 'alias', 'cip-parent', MATCH_CIP_PARENT, parent));
  }
  return hits;
}

/** The form's decline options, one answer however many there are. */
function declineHits(options: PreparedOptions): StageHit[] {
  return options.list.filter((option) => chooseable(option) && option.decline)
    .map((option) => stageHit(option, 'alias', 'curated-alias', ALIAS_CONFIDENCE.curated, 'decline'));
}

/** The yes/no value an EEO answer stands for ("Yes" on a Hispanic or Latino question), when it is one. */
function eeoPolarity(scope: Scope): boolean | null {
  const id = scope.entityId;
  if (id === null || !scope.domain.startsWith('eeo.')) return null;
  const answer = id.slice(id.indexOf(':') + 1);
  return answer === 'yes' ? true : answer === 'no' ? false : null;
}

/** Every alias-stage hit the domain's rules give. */
export function aliasHits(scope: Scope, options: PreparedOptions): StageHit[] {
  const { intended } = scope.input;
  if (intended.kind === 'decline') return declineHits(options);
  const rules = scope.plan.alias;
  const hits: StageHit[] = [];
  if (rules.includes('tiered')) hits.push(...tieredHits(scope, options));
  if (rules.includes('cip')) hits.push(...cipHits(scope, options));
  if (rules.includes('entity-id')) hits.push(...entityIdHits(scope, options, new Set(hits.map((hit) => hit.option))));
  if (rules.includes('mention') && scope.entityId !== null && scope.domain !== 'number') {
    hits.push(...mentionHits(scope.entityId, options, scope.domain as VocabDomain, scope.vocab));
  }
  if (rules.includes('polarity')) {
    const value = intended.kind === 'boolean' ? intended.value : eeoPolarity(scope);
    if (value !== null) hits.push(...polarityHits(value, options, scope.vocab));
  }
  if (rules.includes('range') && intended.kind === 'number') hits.push(...rangeHits(intended, options));
  if (rules.includes('degree') && intended.kind === 'degree') {
    const intent = { level: intended.level, type: intended.type };
    hits.push(...degreeHits(intent, options, scope.vocab, scope.input.degreeField));
  }
  return hits;
}

/** Stage b: the winner among the alias hits, or a tie between different answers. */
export function aliasStage(scope: Scope, options: PreparedOptions): Ranked {
  return rankHits(aliasHits(scope, options));
}
