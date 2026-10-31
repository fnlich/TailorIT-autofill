/*
 * The accepted-match cache (Phase 6, wave 2; match-cache.ts): kept in storage.session and memory, least recently used
 * out at 5,000, and written only for a match the field still held when the application reached done.
 */
import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { MATCH_CACHE_MAX_ENTRIES } from '../core/confidence';
import type { MatchCacheEntry } from '../core/matcher/cache';
import type { CacheCandidate } from '../core/plan/types';
import type { FieldKey } from '../core/types/field';
import { createWorkerPlatform } from '../platform/chrome';
import { createAcceptBook, createMatchCache, MATCH_CACHE_KEY } from './match-cache';
import { frameReport, skippedRow, fieldSpec } from './worker.testkit';

const entry = (label: string): MatchCacheEntry => ({ label, stage: 'exact', confidence: 1, acceptedBy: 'run-complete', at: 1 });
const candidate = (fieldKey: string, cacheKey: string): CacheCandidate => ({ fieldKey: fieldKey as FieldKey, cacheKey,
  entry: { label: 'linkedin', stage: 'exact', confidence: 1 } });

function session() {
  fakeBrowser.reset();
  return createWorkerPlatform().storage.session;
}

describe('the match cache', () => {
  it('stores entries in storage.session and reads them back after a restart, checked', async () => {
    const area = session();
    const cache = createMatchCache(area);
    await cache.accept([{ key: 'k1', entry: entry('linkedin') }]);
    expect(await area.get(MATCH_CACHE_KEY)).toEqual({ entries: [['k1', entry('linkedin')]] });
    const again = createMatchCache(area);
    await again.ready();
    expect(again.get('k1')).toEqual(entry('linkedin'));
    // Something stored that does not parse is no cache at all.
    await area.set({ [MATCH_CACHE_KEY]: { entries: [['k2', { ...entry('x'), index: 3 }]] } });
    const broken = createMatchCache(area);
    await broken.ready();
    expect(broken.size).toBe(0);
  });

  it('keeps at most 5,000, the least recently used going first, and a use counts as recent', async () => {
    const cache = createMatchCache(session());
    await cache.accept(Array.from({ length: MATCH_CACHE_MAX_ENTRIES }, (_, at) => ({ key: `k${at}`, entry: entry(`l${at}`) })));
    expect(cache.get('k0')).toBeDefined();
    await cache.accept([{ key: 'new', entry: entry('n') }]);
    expect(cache.size).toBe(MATCH_CACHE_MAX_ENTRIES);
    expect(cache.get('k0')).toBeDefined();
    expect(cache.get('k1')).toBeUndefined();
    expect(cache.get('new')).toBeDefined();
  });

  it('deletes stale entries', async () => {
    const cache = createMatchCache(session());
    await cache.accept([{ key: 'k1', entry: entry('a') }, { key: 'k2', entry: entry('b') }]);
    await cache.drop(['k1', 'unknown']);
    expect([cache.get('k1'), cache.get('k2')]).toEqual([undefined, entry('b')]);
  });
});

describe('the accept book', () => {
  const KEY = 'lever:0123456789abcdef';
  const verified = (key: string, extra: Record<string, unknown> = {}) => ({ ...skippedRow(fieldSpec(1, { key: key as FieldKey })),
    status: 'verified' as const, provenance: 'profile' as const, wrote: true, verification: 'verified' as const, ...extra });

  it('stores at done only the candidates whose field still held our value, as run-complete', async () => {
    const cache = createMatchCache(session());
    const book = createAcceptBook(cache);
    book.planned(KEY, [candidate('f1', 'c1'), candidate('f2', 'c2'), candidate('f3', 'c3')]);
    const report = frameReport('run-1', 0, { fields: [verified('f1'),
      verified('f2', { status: 'flagged', reason: 'changed-by-you', provenance: null, wrote: false, verification: 'not-applicable' })] });
    book.reported(KEY, report);
    expect(await book.done(KEY, 1234)).toBe(1);
    expect(cache.get('c1')).toEqual({ label: 'linkedin', stage: 'exact', confidence: 1, acceptedBy: 'run-complete', at: 1234 });
    // Changed by the person, and never reported as ours: not cached.
    expect([cache.get('c2'), cache.get('c3')]).toEqual([undefined, undefined]);
    // Done once: the book has forgotten the application.
    expect(await book.done(KEY, 1235)).toBe(0);
  });

  it('a later report undoes a standing field the person changed meanwhile, and a dry run says nothing', async () => {
    const cache = createMatchCache(session());
    const book = createAcceptBook(cache);
    book.planned(KEY, [candidate('f1', 'c1')]);
    book.reported(KEY, frameReport('run-1', 0, { fields: [verified('f1')] }));
    book.reported(KEY, frameReport('run-1', 0, { mode: 'dry-run', fields: [verified('f1', { wrote: false })] }));
    book.reported(KEY, frameReport('run-1', 0, { fields: [verified('f1', { status: 'flagged', reason: 'changed-by-you',
      provenance: null, wrote: false })] }));
    expect(await book.done(KEY, 1)).toBe(0);
    book.planned(KEY, [candidate('f1', 'c1')]);
    book.forget(KEY);
    expect(await book.done(KEY, 1)).toBe(0);
  });
});
