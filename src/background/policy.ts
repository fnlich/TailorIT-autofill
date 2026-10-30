/*
 * What the worker knows of a posting's AI policy before a form frame reads its own visible text. Two sources: a
 * posting page with no form (the Lever posting page, for one) that this browser session showed, which reports a
 * value-free policy/hit {applicationKey, patternId} kept in storage.session until the browser restarts; and
 * TailorIT's stored copy of the posting from the lookup, typed StoredPostingText, which only the policy patterns read.
 * Pattern ids only, never the posting's text.
 *
 * A page can push addresses (each its own application key), so the records are capped: at most MAX_POLICY_RECORDS
 * applications, the least recently recorded or read going first, their order kept beside them (`policy-order`, keys
 * only). index.ts also limits policy/hit per frame (POLICY_HIT_LIMIT).
 */
import { z } from 'zod';
import type { StoredPostingText } from '../core/types/text';
import type { StorageArea } from '../platform/types';
import { log } from '../shared/log';
import { ApplicationKeySchema, POLICY_PREFIX, PolicyRecordSchema, type PolicyRecord } from '../shared/stored';
import type { CoreFunctions } from './core';
import { createKeyedQueue } from './locks';

/** A pattern id as the core names them; anything else a frame sends is not stored. */
const PATTERN_ID = /^[a-z0-9.-]{1,40}$/;

/** At most this many applications' records are kept; the least recently recorded or read goes first. */
export const MAX_POLICY_RECORDS = 200;

/** policy/hit's limit per frame. A reading sends one message per pattern it matched (or one clean one), and a person
 *  moves between postings far more slowly; a page that pushes addresses is held to this. */
export const POLICY_HIT_LIMIT = { count: 10, windowMs: 10_000 } as const;

/** storage.session `policy-order`: the application keys that hold a record, the least recently used first. */
const ORDER_KEY = 'policy-order';
const OrderSchema = z.array(ApplicationKeySchema).max(MAX_POLICY_RECORDS);

/** The posting pages' policy hits, per application. */
export interface PolicyBook {
  /** Records a posting page's reading: a pattern id it matched, or null when it read the page and found none. */
  record(applicationKey: string, patternId: string | null): Promise<boolean>;
  /** 'hit' when a posting page this session matched a pattern, 'clear' when one was read clean, else 'unseen'. */
  postingPage(applicationKey: string): Promise<'hit' | 'clear' | 'unseen'>;
}

/** The policy hits over storage.session (`policy:<applicationKey>`, with their order in `policy-order`). */
export function createPolicyBook(session: StorageArea): PolicyBook {
  /** One queue for every record and the order: a use never races another one's eviction. */
  const queue = createKeyedQueue();
  const QUEUE = 'policy';
  const keyOf = (applicationKey: string) => `${POLICY_PREFIX}${applicationKey}`;

  async function read(applicationKey: string): Promise<PolicyRecord | null> {
    const parsed = PolicyRecordSchema.safeParse(await session.get(keyOf(applicationKey)));
    return parsed.success ? parsed.data : null;
  }

  /** The keys that hold a record, least recently used first. The stored order is checked against the records: a key
   *  without one is dropped, and a record it does not list (an unreadable order, an interrupted write) counts as the
   *  oldest. */
  async function order(): Promise<string[]> {
    const parsed = OrderSchema.safeParse(await session.get(ORDER_KEY));
    const held = Object.keys(await session.getMany(POLICY_PREFIX)).map((key) => key.slice(POLICY_PREFIX.length));
    const present = new Set(held);
    const listed = [...new Set(parsed.success ? parsed.data : [])].filter((key) => present.has(key));
    const known = new Set(listed);
    return [...held.filter((key) => !known.has(key)), ...listed];
  }

  /** Makes the application the most recently used, storing its record when one is given, and lets the least recently
   *  used beyond MAX_POLICY_RECORDS go. */
  async function use(applicationKey: string, record?: PolicyRecord): Promise<void> {
    const next = [...(await order()).filter((key) => key !== applicationKey), applicationKey];
    const gone = next.slice(0, Math.max(0, next.length - MAX_POLICY_RECORDS));
    await session.set({ ...(record ? { [keyOf(applicationKey)]: record } : {}), [ORDER_KEY]: next.slice(gone.length) });
    if (gone.length === 0) return;
    await session.remove(gone.map(keyOf));
    log('policy.evicted', { removed: gone.length });
  }

  return {
    record(applicationKey, patternId) {
      if (patternId !== null && !PATTERN_ID.test(patternId)) return Promise.resolve(false);
      if (!ApplicationKeySchema.safeParse(applicationKey).success) return Promise.resolve(false);
      return queue.run(QUEUE, async () => {
        const held = (await read(applicationKey)) ?? { hits: [], clear: false };
        const next: PolicyRecord = patternId === null
          ? { ...held, clear: true }
          : { ...held, hits: held.hits.includes(patternId) ? held.hits : [...held.hits, patternId].slice(0, 10) };
        await use(applicationKey, next);
        log('policy.recorded', { hit: patternId !== null });
        return true;
      });
    },
    postingPage(applicationKey) {
      return queue.run(QUEUE, async () => {
        const held = await read(applicationKey);
        if (held === null) return 'unseen';
        await use(applicationKey);
        // A hit is never cleared by a later clean reading: the person is told.
        return held.hits.length > 0 ? 'hit' : held.clear ? 'clear' : 'unseen';
      });
    },
  };
}

/** The policy patterns over TailorIT's stored copy: 'unavailable' when there is no copy (no job, no text, no lookup). */
export function storedCopyState(postingText: string | undefined | null, core: Pick<CoreFunctions, 'policyHits'>):
  'hit' | 'clear' | 'unavailable' {
  if (!postingText) return 'unavailable';
  try {
    return core.policyHits(postingText as StoredPostingText).length > 0 ? 'hit' : 'clear';
  } catch {
    return 'unavailable';
  }
}
