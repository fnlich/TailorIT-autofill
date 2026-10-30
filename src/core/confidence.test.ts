import { describe, expect, it } from 'vitest';
import * as C from './confidence';

describe('the confidence constants', () => {
  it.each<[string, unknown]>([
    // Action bands (§8.6).
    ['FILL_AT', 0.85],
    ['FLAG_AT', 0.6],
    // Classification (§8.6, §8.3, §8.1).
    ['CLASSIFY_AUTOCOMPLETE', 0.98],
    ['CLASSIFY_AUTOCOMPLETE_WEAK', 0.85],
    ['CLASSIFY_NAME_ID_EXACT', 0.95],
    ['CLASSIFY_NAME_ID_PARTIAL', 0.85],
    ['LABEL_RULE_CONFIDENCE', { strong: 0.97, normal: 0.92, weak: 0.75 }],
    ['CLASSIFY_SAVED_EXACT', 0.97],
    ['CLASSIFY_LLM', 0.7],
    ['CLASSIFY_AGREE_BONUS', 0.02],
    ['CLASSIFY_AGREE_CAP', 0.99],
    ['CLASSIFY_CONFLICT_FACTOR', 0.8],
    // Value (§8.6, §2.7, §8.5, §8.7).
    ['VALUE_EXPLICIT', 1],
    ['VALUE_TRANSFORM', 0.97],
    ['VALUE_NAME_SPLIT_MANY', 0.85],
    ['VALUE_DERIVED', 0.85],
    ['VALUE_FALLBACK_SOURCE', 0.9],
    ['VALUE_CONSENT_PREAPPROVED', 0.9],
    ['VALUE_TWO_OR_MORE_RACES', 0.8],
    ['POSTING_COUNTRY_FACTOR', 0.8],
    // Match (§4.1 to §4.7).
    ['MATCH_EXACT', 1],
    ['MATCH_EXACT_QUALIFIERS_IGNORED', 0.95],
    ['ALIAS_CONFIDENCE', { curated: 0.97, vocab: 0.95, generated: 0.92, flagship: 0.9 }],
    ['MATCH_ENTITY_ID', 0.95],
    ['MATCH_DEGREE', 0.97],
    ['MATCH_DEGREE_LEVEL_FALLBACK', 0.85],
    ['MATCH_DEGREE_DOCTORATE_FALLBACK', 0.75],
    ['MATCH_CIP_TITLE', 0.95],
    ['MATCH_CIP_PARENT', 0.88],
    ['MATCH_CROSSWALK', 0.85],
    ['MATCH_MENTION', 0.93],
    ['MATCH_POLARITY_LEADING', 0.93],
    ['MATCH_POLARITY_NEGATION', 0.85],
    ['MATCH_RANGE', 0.95],
    ['MATCH_CACHE_ACCEPTED', 0.97],
    ['MATCH_LLM_PICK', 0.75],
    ['MATCH_OTHER', 0.7],
    ['INJECTED_LABEL_CAP', 0.84],
    // Fuzzy (§4.4).
    ['FUZZY_ACCEPT', 0.88],
    ['FUZZY_MARGIN', 0.05],
    ['FUZZY_TIER_HIGH_FROM', 0.97],
    ['FUZZY_TIER_HIGH', 0.9],
    ['FUZZY_TIER_MID_FROM', 0.92],
    ['FUZZY_TIER_MID', 0.8],
    ['FUZZY_TIER_LOW', 0.7],
    ['SMALL_MARGIN_BELOW', 0.1],
    ['SMALL_MARGIN_PENALTY', 0.05],
    ['FUZZY_DICE_WEIGHT', 0.7],
    ['FUZZY_JW_WEIGHT', 0.3],
    ['FUZZY_PAIR_JW_FROM', 0.93],
    ['FUZZY_PAIR_MIN_LENGTH', 5],
    ['FUZZY_PAIR_SCORE', 0.9],
    ['QUALIFIER_OTHER_WEIGHT', 0.5],
    ['PREFILTER_MIN_WEIGHT', 0.3],
    ['PREFILTER_MAX_CANDIDATES', 200],
    ['JW_PREFIX_SCALE', 0.1],
    ['JW_PREFIX_MAX', 4],
    ['JW_BOOST_ABOVE', 0.7],
    // Degree granularity (§4.9).
    ['DEGREE_COMBINED_SHARE', 0.5],
    ['DEGREE_TYPES_SHARE', 0.6],
    ['DEGREE_LEVELS_SHARE', 0.6],
    ['DEGREE_MIXED_SHARE', 0.6],
    // LLM requests (§4.6, §8.4, ARCHITECTURE.md).
    ['TIEBREAK_MAX_ITEMS', 20],
    ['TIEBREAK_MIN_CANDIDATES', 1],
    ['TIEBREAK_MAX_CANDIDATES', 30],
    ['TIEBREAK_MAX_ALIASES', 10],
    ['CLASSIFY_MAX_ITEMS', 20],
    ['CLASSIFY_MAX_OPTIONS', 20],
    // Matcher limits (§4.8, §4.10, §4.11, §4.13).
    ['MAX_SUGGESTIONS', 3],
    ['MATCH_CACHE_MAX_ENTRIES', 5000],
    ['TYPEAHEAD_MAX_QUERIES', 4],
    ['TYPEAHEAD_MIN_QUERY_LENGTH', 3],
    ['TYPEAHEAD_TOKEN_MIN_WEIGHT', 0.3],
    ['MATCH_BUDGET_MS', 20],
    ['MATCH_BUDGET_OPTIONS', 5000],
  ])('%s is the design’s value', (name, expected) => {
    expect((C as Record<string, unknown>)[name]).toEqual(expected);
  });

  it('keeps every LLM step, an injected label and the "Other" option below the fill line, so they are flagged', () => {
    for (const value of [C.CLASSIFY_LLM, C.MATCH_LLM_PICK, C.INJECTED_LABEL_CAP, C.MATCH_OTHER, C.FUZZY_TIER_MID,
      C.FUZZY_TIER_LOW, C.MATCH_DEGREE_DOCTORATE_FALLBACK]) expect(value).toBeLessThan(C.FILL_AT);
    expect(C.FLAG_AT).toBeLessThan(C.FILL_AT);
  });

  it('keeps a crosswalk proficiency below the fill line whatever the classification', () => {
    expect(C.MATCH_CROSSWALK * C.CLASSIFY_AGREE_CAP).toBeLessThan(C.FILL_AT);
    expect(C.MATCH_CROSSWALK).toBeLessThan(C.ALIAS_CONFIDENCE.generated);
  });

  it('orders the tiers', () => {
    const { curated, vocab, generated, flagship } = C.ALIAS_CONFIDENCE;
    expect([curated, vocab, generated, flagship]).toEqual([curated, vocab, generated, flagship].sort((a, b) => b - a));
    expect(C.FUZZY_TIER_HIGH).toBeGreaterThan(C.FUZZY_TIER_MID);
    expect(C.FUZZY_TIER_MID).toBeGreaterThan(C.FUZZY_TIER_LOW);
    expect(C.MATCH_DEGREE).toBeGreaterThan(C.MATCH_DEGREE_LEVEL_FALLBACK);
    expect(C.MATCH_DEGREE_LEVEL_FALLBACK).toBeGreaterThan(C.MATCH_DEGREE_DOCTORATE_FALLBACK);
    expect(C.FUZZY_DICE_WEIGHT + C.FUZZY_JW_WEIGHT).toBeCloseTo(1, 10);
  });
});
