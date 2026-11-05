/*
 * The accepted-match cache (Phase 6; docs/design/core.md §4.10; docs/ARCHITECTURE.md "Storage": accepted matches live
 * in storage.session, in memory, never on disk, until the browser restarts). The core reads it through MatchCacheStore
 * at every plan and says which entries went stale (PlanOutput.cacheDrops); this file keeps it and decides when a match
 * is accepted.
 * - The store: one record in storage.session (`matchcache`: a secret and the entries, least recently used first),
 *   loaded into memory once and written back on every change; at most MATCH_CACHE_MAX_ENTRIES (5,000), the least
 *   recently used going first. A use moves an entry to the end. An entry holds the chosen option's normalized label,
 *   never its index, and the core checks it against the current options on every use.
 * - Sealed (the Phase 7a review): the key's value part (its last part, intendedIdentity: "n:typescript", "ref:linkedin")
 *   and the entry's label are kept only as an HMAC-SHA-256 (32 hex) under 32 random bytes made for this browser
 *   session and kept beside them, so the record never holds a value or a chosen label readable; the platform, the
 *   question's normalized label (page text) and the option-set hash stay as they are. A lookup seals the plain key the
 *   same way, exactly, and the core compares each option's label sealed (MatchCacheStore.sealLabel). A record without
 *   a secret, or one that does not parse, is no cache at all, and a new secret is made.
 * - When a match is accepted (AcceptBook): a plan names each write's candidates (PlanOutput.cacheCandidates, never an
 *   unconfirmed LLM pick, an EEO, legal, consent or sensitive field: cacheEntryFor decides), kept in memory per
 *   application. Each report of that application's runs says whether the field still holds our value: a row that wrote
 *   and read back verified keeps its candidates, any other (the person changed it: changed-by-you; it went; it was
 *   refused) loses them. When the application's RunState reaches done (the platform's confirmation page, Phase 5),
 *   the candidates still standing are stored, acceptedBy 'run-complete'. Nothing else stores one: the extension has no
 *   action by which a person confirms a match, so 'user' entries are never written.
 * Sealed keys and labels only: no value, and nothing here is logged but counts.
 */
import { z } from 'zod';
import { MATCH_CACHE_MAX_ENTRIES } from '../core/confidence';
import { MATCHER_STAGES } from '../core/enums';
import type { MatchCacheEntry, MatchCacheStore } from '../core/matcher/cache';
import type { CacheCandidate } from '../core/plan/types';
import { bytesToHex, hmacSha256Hex } from '../core/text/sha256';
import type { StorageArea } from '../platform/types';
import type { FrameReport } from '../shared/report';
import { log } from '../shared/log';

/** Where the cache is kept in storage.session. */
export const MATCH_CACHE_KEY = 'matchcache';
/** The most applications whose candidates are kept in memory at once (the oldest go first), and the most candidates
 *  one application keeps. */
export const MAX_ACCEPT_APPLICATIONS = 20;
export const MAX_ACCEPT_CANDIDATES = 2000;

/** A sealed part: the first 32 hex of its HMAC. */
const SEALED_HEX = 32;
const SEALED = /^[0-9a-f]{32}$/;
/** The key's parts are joined by U+001F (core/matcher/cache.ts); its value part is the last. */
const UNIT_SEPARATOR = String.fromCharCode(0x1f);

const EntrySchema = z.strictObject({
  label: z.string().regex(SEALED),
  stage: z.enum(MATCHER_STAGES),
  confidence: z.number().min(0).max(1),
  acceptedBy: z.enum(['user', 'run-complete']),
  at: z.number().int().nonnegative(),
});
const StoredSchema = z.strictObject({
  /** The browser session's secret, 32 random bytes in hex. */
  secret: z.string().regex(/^[0-9a-f]{64}$/),
  entries: z.array(z.tuple([z.string().min(1).max(2000), EntrySchema])).max(MATCH_CACHE_MAX_ENTRIES),
});

/** The cache as the worker keeps it. */
export interface MatchCache extends MatchCacheStore {
  /** Settles once the stored entries are in memory (read once). */
  ready(): Promise<void>;
  /** Stores accepted entries (each the most recent), dropping the least recently used past the cap. */
  accept(entries: ReadonlyArray<{ key: string; entry: MatchCacheEntry }>): Promise<void>;
  /** Deletes stale entries. */
  drop(keys: readonly string[]): Promise<void>;
  /** How many entries it holds (for tests). */
  readonly size: number;
}

/** The cache over storage.session; `randomBytes` makes the session's secret (the platform's, else the global's). */
export function createMatchCache(session: StorageArea,
  randomBytes: (count: number) => Uint8Array = (count) => crypto.getRandomValues(new Uint8Array(count))): MatchCache {
  /** By sealed key; each entry's label sealed. */
  const entries = new Map<string, MatchCacheEntry>();
  let secret: { hex: string; bytes: Uint8Array } | null = null;
  let loading: Promise<void> | null = null;

  const seal = (text: string) => (secret === null ? '' : hmacSha256Hex(secret.bytes, text).slice(0, SEALED_HEX));
  /** The key with its value part sealed. */
  function sealKey(key: string): string {
    const at = key.lastIndexOf(UNIT_SEPARATOR);
    return at < 0 ? seal(key) : key.slice(0, at + 1) + seal(key.slice(at + 1));
  }
  const useSecret = (hex: string) => {
    secret = { hex, bytes: Uint8Array.from(hex.match(/../g)!, (pair) => parseInt(pair, 16)) };
  };

  async function persist(): Promise<void> {
    await session.set({ [MATCH_CACHE_KEY]: { secret: secret!.hex, entries: [...entries] } });
  }

  function ready(): Promise<void> {
    loading ??= (async () => {
      const parsed = StoredSchema.safeParse(await session.get(MATCH_CACHE_KEY));
      if (parsed.success) {
        useSecret(parsed.data.secret);
        for (const [key, entry] of parsed.data.entries) entries.set(key, entry);
      }
    })().catch(() => undefined).finally(() => {
      if (secret === null) useSecret(bytesToHex(randomBytes(32)));
    });
    return loading;
  }

  return {
    ready,
    get(key) {
      if (secret === null) return undefined;
      const sealed = sealKey(key);
      const entry = entries.get(sealed);
      if (entry === undefined) return undefined;
      // A use makes it the most recent; the order is written with the next change.
      entries.delete(sealed);
      entries.set(sealed, entry);
      return entry;
    },
    sealLabel(label) {
      return seal(label);
    },
    async accept(accepted) {
      if (accepted.length === 0) return;
      await ready();
      for (const { key, entry } of accepted) {
        const sealed = sealKey(key);
        entries.delete(sealed);
        entries.set(sealed, EntrySchema.parse({ ...entry, label: seal(entry.label) }));
      }
      for (const key of entries.keys()) {
        if (entries.size <= MATCH_CACHE_MAX_ENTRIES) break;
        entries.delete(key);
      }
      await persist();
      log('cache.accepted', { entries: accepted.length, held: entries.size });
    },
    async drop(keys) {
      await ready();
      let dropped = 0;
      for (const key of keys) if (entries.delete(sealKey(key))) dropped += 1;
      if (dropped === 0) return;
      await persist();
      log('cache.dropped', { entries: dropped });
    },
    get size() {
      return entries.size;
    },
  };
}

/** One application's candidates: each field's, and whether its latest report row still holds our value. */
interface Pending {
  fields: Map<string, { candidates: CacheCandidate[]; standing: boolean }>;
}

/** What decides that a match is accepted (module header). */
export interface AcceptBook {
  /** A plan's candidates for this application's fields (they replace a field's earlier ones). */
  planned(applicationKey: string, candidates: readonly CacheCandidate[]): void;
  /** A report of one of this application's runs: which fields still hold our value. */
  reported(applicationKey: string, report: Pick<FrameReport, 'mode' | 'fields'>): void;
  /** The application's RunState reached done: the candidates still standing are stored, and the rest forgotten. */
  done(applicationKey: string, now: number): Promise<number>;
  /** Forgets an application (its RunState was cleared). */
  forget(applicationKey: string): void;
}

/** The book over a cache, in memory only. */
export function createAcceptBook(cache: Pick<MatchCache, 'accept'>): AcceptBook {
  const pending = new Map<string, Pending>();

  function of(applicationKey: string): Pending {
    let found = pending.get(applicationKey);
    if (found === undefined) {
      found = { fields: new Map() };
      pending.set(applicationKey, found);
      for (const key of pending.keys()) {
        if (pending.size <= MAX_ACCEPT_APPLICATIONS) break;
        pending.delete(key);
      }
    }
    return found;
  }

  return {
    planned(applicationKey, candidates) {
      if (candidates.length === 0) return;
      const book = of(applicationKey);
      const byField = new Map<string, CacheCandidate[]>();
      for (const candidate of candidates) {
        byField.set(candidate.fieldKey, [...(byField.get(candidate.fieldKey) ?? []), candidate]);
      }
      for (const [fieldKey, list] of byField) {
        if (!book.fields.has(fieldKey) && book.fields.size >= MAX_ACCEPT_CANDIDATES) continue;
        // Standing only once a report says the write read back as ours.
        book.fields.set(fieldKey, { candidates: list, standing: false });
      }
    },
    reported(applicationKey, report) {
      const book = pending.get(applicationKey);
      if (book === undefined || report.mode !== 'fill') return;
      for (const row of report.fields) {
        const field = book.fields.get(row.key);
        if (field === undefined) continue;
        field.standing = row.wrote && row.verification === 'verified' && row.provenance !== null
          && row.provenance !== 'llm-pick' && row.provenance !== 'llm-draft';
      }
    },
    async done(applicationKey, now) {
      const book = pending.get(applicationKey);
      pending.delete(applicationKey);
      if (book === undefined) return 0;
      const accepted = [...book.fields.values()].filter((field) => field.standing)
        .flatMap((field) => field.candidates.map((candidate) => ({ key: candidate.cacheKey,
          entry: { ...candidate.entry, acceptedBy: 'run-complete' as const, at: now } })));
      await cache.accept(accepted);
      return accepted.length;
    },
    forget(applicationKey) {
      pending.delete(applicationKey);
    },
  };
}
