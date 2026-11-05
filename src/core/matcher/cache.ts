/*
 * The accepted-match cache (docs/design/core.md §4.10 as corrected by docs/ARCHITECTURE.md): a pure key function
 * and entry, and the check against the current options. The worker owns the storage (storage.session: in memory,
 * never on disk, least recently used out first at 5,000 entries) behind MatchCacheStore; the core only reads it and
 * says what to write or delete. An entry holds the chosen option's normalized clean label, never its index, and is
 * checked again on every use: a hit needs exactly one usable option with that label, otherwise the entry is stale.
 * The store keeps the key's value part and the label sealed (an HMAC under a secret of the browser session's, the Phase
 * 7a review): the core hands it plain keys, and compares an entry's label with each option's through sealLabel, so
 * neither a value nor a label the person chose is ever kept readable.
 * Unconfirmed LLM picks are never cached, and neither are EEO, legal, consent or sensitive fields: only the policy
 * classes profile, free-text and unknown are.
 *
 * The key names the value by everything its match depends on (the spec keys the cache by the intended value): a
 * degree with its field of study, since a combined list matches both ("M.S. in Statistics" is not "M.S. in Computer
 * Science"), and a text by its brackets too ("London (UK)" is not "London (Ontario)"). Two values that would choose
 * different options never share an entry.
 */
import { INJECTED_LABEL_CAP, MATCH_CACHE_ACCEPTED } from '../confidence';
import type { MatcherStage, Platform } from '../enums';
import { keyWithBrackets } from '../text/normalize';
import type { OptionSetHash } from '../types/field';
import type { IntendedValue } from '../types/intent';
import type { Match, MatchFlag } from '../types/match';
import type { FieldOfStudy } from '../types/profile';
import { keyFor } from '../vocab/lookup';
import { openClass } from './domains';
import { chooseable, domainContext } from './prepare';
import type { MatchDomain, MatchInput, PreparedOptions } from './types';

/** The cache key's version prefix: a change to the key's parts or the entry's label bumps it. 'm2' added a degree's
 *  field of study and the brackets of a text. */
export const CACHE_KEY_VERSION = 'm2';
/** The key's parts are joined by U+001F, which no label or hash holds. */
const UNIT_SEPARATOR = String.fromCharCode(0x1f);
/** An observed option-set hash: 16 hex. 'lazy' and 'none' are never cached. */
const OBSERVED_HASH = /^[0-9a-f]{16}$/;
/** A text's key with its bracketed words kept, as PreparedOption.fullKey keeps them. */
function fullKeyOf(text: string, domain: MatchDomain): string {
  return keyWithBrackets(text, domainContext(domain));
}

/** What a degree's field of study adds to its identity: its CIP code, else its normalized name; '' without one. */
function fieldIdentity(field: FieldOfStudy | undefined): string {
  if (field === undefined) return '';
  if (field.cip !== undefined) return `|cip:${field.cip}`;
  const key = keyFor(field.name, 'field');
  return key === '' ? '' : `|n:${key}`;
}

/** One accepted match. */
export interface MatchCacheEntry {
  /** The chosen option's normalized clean label (PreparedOption.fullKey in the value's domain); in an entry the store
   *  gives back, that label sealed (MatchCacheStore.sealLabel). */
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
  /** The entry kept for a plain key (the store seals the key's value part itself), its label sealed. */
  get(key: string): MatchCacheEntry | undefined;
  /** A normalized label as the store keeps an entry's: what an option's fullKey is compared with. */
  sealLabel(label: string): string;
}

/**
 * What the value is, for the cache key: a vocabulary id ('ipeds:228778', 'cip:11.0701', 'iso:US', 'usps:TX'), a
 * degree ('deg:type:BS', 'deg:level:bachelor', with '|cip:11.0701' or '|n:' and the field's key when the entry has a
 * field of study), 'bool:true', 'decline', a number, or 'n:' and the normalized display, brackets kept, when the
 * vocabulary does not know it. Null for a kind never cached.
 */
export function intendedIdentity(intended: IntendedValue, domain: MatchDomain, degreeField?: FieldOfStudy):
  string | null {
  switch (intended.kind) {
    case 'entity':
      return intended.id ?? `n:${fullKeyOf(intended.display, domain)}`;
    case 'degree': {
      const degree = intended.type !== null ? `deg:type:${intended.type}` : `deg:level:${intended.level}`;
      return degree + fieldIdentity(degreeField);
    }
    case 'boolean':
      return `bool:${intended.value}`;
    case 'decline':
      return 'decline';
    case 'text':
      return `n:${fullKeyOf(intended.text, domain)}`;
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
  /** For a degree: the entry's field of study (MatchInput.degreeField). */
  degreeField?: FieldOfStudy;
}

/** [CACHE_KEY_VERSION, platform, labelKey, observedOptionSetHash, intendedIdentity] joined by U+001F, or null when the
 *  hash is not an observed one or the value is never cached. */
export function cacheKey(parts: CacheKeyParts): string | null {
  if (!OBSERVED_HASH.test(parts.optionSetHash)) return null;
  const identity = intendedIdentity(parts.intended, parts.domain, parts.degreeField);
  if (identity === null) return null;
  return [CACHE_KEY_VERSION, parts.platform, parts.labelKey, parts.optionSetHash, identity].join(UNIT_SEPARATOR);
}

/** The key of a match input. */
export function cacheKeyOf(input: MatchInput): string | null {
  return cacheKey({ platform: input.platform, labelKey: input.labelKey, optionSetHash: input.optionSetHash,
    intended: input.intended, domain: input.options.domain,
    ...(input.degreeField ? { degreeField: input.degreeField } : {}) });
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

/** Checks a stored entry against the current options (§4.1): exactly one usable option with the stored label (each
 *  option's label sealed as the store seals it). */
export function cacheLookup(store: MatchCacheStore, key: string, options: PreparedOptions): CacheLookup {
  const entry = store.get(key);
  if (!entry) return null;
  const same = options.list.filter((option) => chooseable(option) && store.sealLabel(option.fullKey) === entry.label);
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
