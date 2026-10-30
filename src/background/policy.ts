/*
 * What the worker knows of a posting's AI policy before a form frame reads its own visible text. Two sources: a
 * posting page with no form (the Lever posting page, for one) that this browser session showed, which reports a
 * value-free policy/hit {applicationKey, patternId} kept in storage.session until the browser restarts; and
 * TailorIT's stored copy of the posting from the lookup, typed StoredPostingText, which only the policy patterns read.
 * Pattern ids only, never the posting's text.
 */
import type { StoredPostingText } from '../core/types/text';
import type { StorageArea } from '../platform/types';
import { log } from '../shared/log';
import { POLICY_PREFIX, PolicyRecordSchema, type PolicyRecord } from '../shared/stored';
import type { CoreFunctions } from './core';
import { createKeyedQueue } from './locks';

/** A pattern id as the core names them; anything else a frame sends is not stored. */
const PATTERN_ID = /^[a-z0-9.-]{1,40}$/;

/** The posting pages' policy hits, per application. */
export interface PolicyBook {
  /** Records a posting page's reading: a pattern id it matched, or null when it read the page and found none. */
  record(applicationKey: string, patternId: string | null): Promise<boolean>;
  /** 'hit' when a posting page this session matched a pattern, 'clear' when one was read clean, else 'unseen'. */
  postingPage(applicationKey: string): Promise<'hit' | 'clear' | 'unseen'>;
}

/** The policy hits over storage.session (`policy:<applicationKey>`). */
export function createPolicyBook(session: StorageArea): PolicyBook {
  const queue = createKeyedQueue();
  const keyOf = (applicationKey: string) => `${POLICY_PREFIX}${applicationKey}`;

  async function read(applicationKey: string): Promise<PolicyRecord | null> {
    const parsed = PolicyRecordSchema.safeParse(await session.get(keyOf(applicationKey)));
    return parsed.success ? parsed.data : null;
  }

  return {
    record(applicationKey, patternId) {
      if (patternId !== null && !PATTERN_ID.test(patternId)) return Promise.resolve(false);
      return queue.run(applicationKey, async () => {
        const held = (await read(applicationKey)) ?? { hits: [], clear: false };
        const next: PolicyRecord = patternId === null
          ? { ...held, clear: true }
          : { ...held, hits: held.hits.includes(patternId) ? held.hits : [...held.hits, patternId].slice(0, 10) };
        await session.set({ [keyOf(applicationKey)]: next });
        log('policy.recorded', { hit: patternId !== null });
        return true;
      });
    },
    async postingPage(applicationKey) {
      const held = await read(applicationKey);
      if (held === null) return 'unseen';
      // A hit is never cleared by a later clean reading: the person is told.
      return held.hits.length > 0 ? 'hit' : held.clear ? 'clear' : 'unseen';
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
