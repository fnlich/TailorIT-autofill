import { describe, expect, it } from 'vitest';
import type { MatchCacheEntry, MatchCacheStore } from '../matcher/cache';
import { fieldOf, planOf, specOf } from './plan.testkit';

// The accepted-match cache's side of planFrame (Phase 6; docs/design/core.md §4.10): the writes' matches the worker may
// cache once accepted (cacheCandidates), and the stale entries a lookup found (cacheDrops). Neither ever reaches the
// frame; the worker decides when a candidate is accepted.

const SOURCE = specOf('How did you hear about us?', 'select', { optionLabels: ['Select...', 'LinkedIn', 'Indeed'] });
const GENDER = specOf('Gender', 'radio', { section: { id: 'eeo' }, optionLabels: ['Woman', 'Man', 'Decline to self-identify'] });

/** A cache over a plain map. */
function storeOf(entries: Record<string, MatchCacheEntry>): MatchCacheStore {
  return { get: (key) => entries[key] };
}

describe('planFrame and the accepted-match cache', () => {
  it('names the written choice’s cache key and its option’s normalized label as a candidate, never its index', () => {
    const out = planOf([SOURCE]);
    expect(fieldOf(out, SOURCE).write?.value).toMatchObject({ kind: 'option', index: 1 });
    expect(out.cacheCandidates).toEqual([{ fieldKey: SOURCE.key, cacheKey: expect.stringContaining(SOURCE.optionSetHash),
      entry: { label: 'linkedin', stage: expect.any(String), confidence: expect.any(Number) } }]);
    expect(JSON.stringify(out.cacheCandidates)).not.toContain('"index"');
  });

  it('gives no candidate for an EEO field, a dry run, or a field with nothing written', () => {
    const eeo = planOf([GENDER]);
    expect((eeo.cacheCandidates ?? []).filter((candidate) => candidate.fieldKey === GENDER.key)).toEqual([]);
    expect(planOf([SOURCE], { dryRun: true }).cacheCandidates).toBeUndefined();
    const chosen = specOf('How did you hear about us?', 'select', { optionLabels: ['Select...', '*LinkedIn', 'Indeed'] });
    expect(planOf([chosen]).cacheCandidates).toBeUndefined();
  });

  it('names an entry that no longer fits the options as a drop, and the cascade goes on', () => {
    const key = planOf([SOURCE]).cacheCandidates![0]!.cacheKey;
    const stale: MatchCacheEntry = { label: 'a friend', stage: 'exact', confidence: 1, acceptedBy: 'run-complete', at: 0 };
    const out = planOf([SOURCE], { cache: storeOf({ [key]: stale }) });
    expect(out.cacheDrops).toEqual([key]);
    expect(fieldOf(out, SOURCE).write?.value).toMatchObject({ kind: 'option', index: 1 });
  });

  it('reuses an entry that still fits: stage cache', () => {
    const key = planOf([SOURCE]).cacheCandidates![0]!.cacheKey;
    const kept: MatchCacheEntry = { label: 'linkedin', stage: 'exact', confidence: 1, acceptedBy: 'run-complete', at: 0 };
    const out = planOf([SOURCE], { cache: storeOf({ [key]: kept }) });
    expect(out.cacheDrops).toBeUndefined();
    expect(fieldOf(out, SOURCE).row.matcherStage).toBe('cache');
  });
});
