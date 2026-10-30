/*
 * The accepted-match cache (docs/design/core.md §4.10 as corrected by docs/ARCHITECTURE.md): a pure key function
 * and entry, and the check against the current options. The worker owns the storage (storage.session: in memory,
 * never on disk, least recently used out first at 5,000 entries) behind MatchCacheStore; the core only reads it and
 * says what to write or delete. An entry holds the chosen option's normalized clean label, never its index, and is
 * checked again on every use: a hit needs exactly one usable option with that label, otherwise the entry is stale.
 * Unconfirmed LLM picks are never cached, and neither are EEO, legal, consent or sensitive fields: only the policy
 * classes profile, free-text and unknown are.
 */
import { INJECTED_LABEL_CAP, MATCH_CACHE_ACCEPTED } from '../confidence';
import type { MatcherStage, Platform } from '../enums';
import { normalize } from '../text/normalize';
import type { OptionSetHash } from '../types/field';
import type { IntendedValue } from '../types/intent';
import type { Match, MatchFlag } from '../types/match';
import { openClass } from './domains';
import { chooseable, domainContext } from './prepare';
import type { MatchDomain, MatchInput, PreparedOptions } from './types';

/** The cache key's version prefix: a change to the key's parts or the entry's label bumps it. */
export const CACHE_KEY_VERSION = 'm1';
/** The key's parts are joined by U+001F, which no label or hash holds. */
const UNIT_SEPARATOR = String.fromCharCode(0x1f);
/** An observed option-set hash: 16 hex. 'lazy' and 'none' are never cached. */
const OBSERVED_HASH = /^[0-9a-f]{16}$/;

/** One accepted match. */
export interface MatchCacheEntry {
  /** The chosen option's normalized clean label (PreparedOption.fullKey in the value's domain). */
  label: string;
  stage: MatcherStage;
  confidence: number;
  /** The person confirmed it, or the field was unchanged when the run reached done. */
  acceptedBy: 'user' | 'run-complete';
  /** When it was accepted (epoch ms, injected). */
  at: number;
}

/** The worker's cache, read by the core. */
export interface MatchCacheStore {
  get(key: string): MatchCacheEntry | undefined;
}

/**
 * What the value is, for the cache key: a vocabulary id ('ipeds:228778', 'cip:11.0701', 'iso:US', 'usps:TX'), a
 * degree ('deg:type:BS', 'deg:level:bachelor'), 'bool:true', 'decline', a number, or 'n:' and the normalized display
 * when the vocabulary does not know it. Null for a kind never cached.
 */
export function intendedIdentity(intended: IntendedValue, domain: MatchDomain): string | null {
  switch (intended.kind) {
    case 'entity':
      return intended.id ?? `n:${normalize(intended.display, domainContext(domain)).key}`;
    case 'degree':
      return intended.type !== null ? `deg:type:${intended.type}` : `deg:level:${intended.level}`;
    case 'boolean':
      return `bool:${intended.value}`;
    case 'decline':
      return 'decline';
    case 'text':
      return `n:${normalize(intended.text, domainContext(domain)).key}`;
    case 'number':
      return `num:${intended.unit}:${intended.value}${intended.currency ? `:${intended.currency}` : ''}`;
    default:
      return null;
  }
}

/** The parts of a cache key. */
export interface CacheKeyParts {
  platform: Platform;
  /** normalizeLabel(field label). */
  labelKey: string;
  /** The observed option-set hash. */
  optionSetHash: OptionSetHash;
  intended: IntendedValue;
  domain: MatchDomain;
}

/** ['m1', platform, labelKey, observedOptionSetHash, intendedIdentity] joined by U+001F, or null when the hash is not
 *  an observed one or the value is never cached. */
export function cacheKey(parts: CacheKeyParts): string | null {
  if (!OBSERVED_HASH.test(parts.optionSetHash)) return null;
  const identity = intendedIdentity(parts.intended, parts.domain);
  if (identity === null) return null;
  return [CACHE_KEY_VERSION, parts.platform, parts.labelKey, parts.optionSetHash, identity].join(UNIT_SEPARATOR);
}

/** The key of a match input. */
export function cacheKeyOf(input: MatchInput): string | null {
  return cacheKey({ platform: input.platform, labelKey: input.labelKey, optionSetHash: input.optionSetHash,
    intended: input.intended, domain: input.options.domain });
}

/**
 * What to store when a match is accepted, or null when it may not be cached: a field outside the profile,
 * free-text and unknown classes, no chosen option, an "Other" choice (its free text is not in the entry), or an LLM
 * pick the person has not confirmed.
 */
export function cacheEntryFor(input: MatchInput, match: Match, acceptedBy: MatchCacheEntry['acceptedBy'], now: number):
  { key: string; entry: MatchCacheEntry } | null {
  if (!openClass(input.policy) || match.optionIndex === null) return null;
  if (match.stage === 'none' || match.stage === 'other' || match.stage === 'not-applicable') return null;
  if (match.stage === 'llm' && acceptedBy !== 'user') return null;
  const key = cacheKeyOf(input);
  const option = input.options.list.find((candidate) => candidate.index === match.optionIndex);
  if (key === null || !option || !chooseable(option)) return null;
  const entry = { label: option.fullKey, stage: match.stage, confidence: match.confidence, acceptedBy, at: now };
  return { key, entry };
}

/** The cache's answer for the current options: a hit, a stale entry to delete, or nothing stored. */
export type CacheLookup = { hit: Match } | { stale: true } | null;

/** Checks a stored entry against the current options (§4.1): exactly one usable option with the stored label. */
export function cacheLookup(store: MatchCacheStore, key: string, options: PreparedOptions): CacheLookup {
  const entry = store.get(key);
  if (!entry) return null;
  const same = options.list.filter((option) => chooseable(option) && option.fullKey === entry.label);
  if (same.length !== 1) return { stale: true };
  const option = same[0]!;
  const base = entry.acceptedBy === 'user' ? MATCH_CACHE_ACCEPTED : entry.confidence;
  const flags: MatchFlag[] = option.injected ? ['injected-label'] : [];
  return {
    hit: {
      stage: 'cache', optionIndex: option.index, rule: 'cache-hit',
      confidence: option.injected ? Math.min(base, INJECTED_LABEL_CAP) : base,
      flags, suggestions: [], reason: option.injected ? 'option-label-had-injected-text' : 'ok',
    },
  };
}
