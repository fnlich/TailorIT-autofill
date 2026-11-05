/*
 * The accepted-match cache (Phase 6, wave 2; match-cache.ts): kept in storage.session and memory, least recently used
 * out at 5,000, written only for a match the field still held when the application reached done, and (the Phase 7a
 * review) its keys' values and its labels sealed under the browser session's secret.
 */
import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { MATCH_CACHE_MAX_ENTRIES } from '../core/confidence';
import type { MatchCacheEntry } from '../core/matcher/cache';
import type { CacheCandidate } from '../core/plan/types';
import type { FieldKey } from '../core/types/field';
import { createWorkerPlatform } from '../platform/chrome';
import { createAcceptBook, createMatchCache, MATCH_CACHE_KEY } from './match-cache';

const SEP = String.fromCharCode(0x1f);
/** A key as the core makes it: version, platform, question, option-set hash, value. */
const keyOf = (value: string, question = 'which of these skills have you used') =>
  ['m2', 'workable', question, 'c723b2da7db5f646', value].join(SEP);
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
    const sealed = { ...entry('linkedin'), label: cache.sealLabel('linkedin') };
    expect(await area.get(MATCH_CACHE_KEY)).toEqual({ secret: expect.stringMatching(/^[0-9a-f]{64}$/),
      entries: [[expect.stringMatching(/^[0-9a-f]{32}$/), sealed]] });
    const again = createMatchCache(area);
    await again.ready();
    expect(again.get('k1')).toEqual(sealed);
    expect(again.sealLabel('linkedin')).toBe(sealed.label);
    // Something stored that does not parse is no cache at all.
    const stored = (await area.get(MATCH_CACHE_KEY)) as { secret: string; entries: unknown[] };
    await area.set({ [MATCH_CACHE_KEY]: { ...stored, entries: [['k2', { ...sealed, index: 3 }]] } });
    const broken = createMatchCache(area);
    await broken.ready();
    expect(broken.size).toBe(0);
  });

  it("keeps no value and no chosen label readable: the key's value part and the label are sealed", async () => {
    const area = session();
    const cache = createMatchCache(area);
    const key = keyOf('n:typescript');
    await cache.accept([{ key, entry: entry('typescript') }, { key: keyOf('ref:linkedin', 'how did you hear about us'),
      entry: entry('linkedin') }]);
    const record = JSON.stringify(await area.get(MATCH_CACHE_KEY));
    expect(record.toLowerCase()).not.toContain('typescript');
    expect(record.toLowerCase()).not.toContain('linkedin');
    // The page's own parts stay as they are.
    expect(record).toContain('which of these skills have you used');
    expect(record).toContain('c723b2da7db5f646');
    // A lookup by the plain key finds it; the core compares an option's label sealed the same way.
    expect(cache.get(key)?.label).toBe(cache.sealLabel('typescript'));
    expect(cache.sealLabel('typescript')).not.toBe(cache.sealLabel('kubernetes'));
    expect(cache.get(keyOf('n:kubernetes'))).toBeUndefined();
  });

  it("makes a new secret for a new browser session: the last one's entries are no cache, and two sessions seal apart",
    async () => {
      const first = createMatchCache(session());
      await first.accept([{ key: keyOf('n:typescript'), entry: entry('typescript') }]);
      const firstLabel = first.sealLabel('typescript');
      // The browser restarted: storage.session is empty again.
      const second = createMatchCache(session());
      await second.ready();
      expect(second.size).toBe(0);
      expect(second.sealLabel('typescript')).not.toBe(firstLabel);
      // A record written without a secret (the cache before sealing) is no cache either.
      const area = session();
      await area.set({ [MATCH_CACHE_KEY]: { entries: [['k1', entry('linkedin')]] } });
      const old = createMatchCache(area);
      await old.ready();
      expect([old.size, old.get('k1')]).toEqual([0, undefined]);
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
    expect([cache.get('k1'), cache.get('k2')]).toEqual([undefined, { ...entry('b'), label: cache.sealLabel('b') }]);
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
    expect(cache.get('c1')).toEqual({ label: cache.sealLabel('linkedin'), stage: 'exact', confidence: 1,
      acceptedBy: 'run-complete', at: 1234 });
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
