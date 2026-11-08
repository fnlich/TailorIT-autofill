/*
 * Learned lists (snapshot round 2, decision 1: the owner's "store it and select at a once"; dom/widgets/known.ts):
 * the option lists a host's select-only dropdowns showed a run (Workday's Degree, Phone Device Type, Prefix, Suffix,
 * which no snapshot shows open), kept in storage.local under `lists:v1`, so the host's next run plans them on its first
 * pass and chooses each with one opening of its list, checked there (a list the page shows otherwise is read whole, as
 * before, and that read is learned in its place).
 * - What is kept: per list, its key (the host's: the first 16 hex digits of the SHA-256 of the frame's host as Chrome
 *   reports it, never a payload's; the label's: the same of its slug, as the content script sends it), the hash of its
 *   options (core/text/keys.ts optionSetHash, so a host's same label with another list is another entry), its option
 *   labels (page text, never a value: at most MAX_LEARNED_OPTIONS, each at most MAX_LEARNED_LABEL characters) and when
 *   it was learned. No address, no question's words, no answer.
 * - At most MAX_LEARNED_LISTS lists across every host, the least recently learned going first; a list learned again
 *   moves to the end. Writes go one at a time (a keyed queue).
 * - lists/known answers the sender's host's lists, the most recently learned of each label key, at most
 *   MAX_LEARNED_PER_HOST. lists/learn keeps one. A private (incognito) tab's are never kept (the audit of 2026-11-06,
 *   S-6: nothing of a private session is written to storage.local); its run is still offered the host's lists.
 * Nothing here is logged but counts.
 */
import { optionSetHash } from '../core/text/keys';
import type { StorageArea } from '../platform/types';
import {
  LEARNED_KEY, learnedKeyOf, MAX_LEARNED_LABEL, MAX_LEARNED_LISTS, MAX_LEARNED_OPTIONS, MAX_LEARNED_PER_HOST,
} from '../shared/learned-lists';
import { log } from '../shared/log';
import { createKeyedQueue } from './locks';

export const LEARNED_LISTS_KEY = 'lists:v1';
/** lists/known and lists/learn, per tab: a run asks once per step's fill and learns a few lists, never a stream. */
export const LEARNED_LISTS_LIMIT = { count: 60, windowMs: 60_000 } as const;

/** One kept list. */
interface Entry {
  host: string;
  key: string;
  hash: string;
  labels: string[];
  at: number;
}

const isLabels = (raw: unknown): raw is string[] => Array.isArray(raw) && raw.length > 0
  && raw.length <= MAX_LEARNED_OPTIONS
  && raw.every((label) => typeof label === 'string' && label !== '' && label.length <= MAX_LEARNED_LABEL);

/** What was stored, checked: an entry that does not read is dropped. */
function entriesOf(raw: unknown): Entry[] {
  const list = raw !== null && typeof raw === 'object' ? (raw as { entries?: unknown }).entries : undefined;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item): Entry[] => {
    if (item === null || typeof item !== 'object') return [];
    const { host, key, hash, labels, at } = item as Record<string, unknown>;
    if (typeof host !== 'string' || !LEARNED_KEY.test(host) || typeof key !== 'string' || !LEARNED_KEY.test(key)
      || typeof hash !== 'string' || hash.length > 80 || !isLabels(labels) || typeof at !== 'number') return [];
    return [{ host, key, hash, labels: [...labels], at }];
  }).slice(-MAX_LEARNED_LISTS);
}

/** The host key of an address, or null for an address with no host. */
export function hostKeyOf(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  return host === '' ? null : learnedKeyOf(host);
}

/** The learned lists, over storage.local. */
export interface LearnedListStore {
  /** The address's host's lists: the most recently learned of each label key, newest first. */
  known(url: string): Promise<Array<{ key: string; labels: string[] }>>;
  /** Keeps a list for the address's host under its label key (see the header). */
  learn(url: string, key: string, labels: readonly string[]): Promise<void>;
}

export function createLearnedListStore(local: StorageArea, now: () => number): LearnedListStore {
  const queue = createKeyedQueue();
  const serial = <T>(task: () => Promise<T>) => queue.run(LEARNED_LISTS_KEY, task);
  const read = async () => entriesOf(await local.get(LEARNED_LISTS_KEY));
  return {
    async known(url) {
      const host = hostKeyOf(url);
      if (host === null) return [];
      const seen = new Set<string>();
      const out: Array<{ key: string; labels: string[] }> = [];
      for (const entry of (await read()).reverse()) {
        if (entry.host !== host || seen.has(entry.key)) continue;
        seen.add(entry.key);
        out.push({ key: entry.key, labels: entry.labels });
        if (out.length === MAX_LEARNED_PER_HOST) break;
      }
      return out;
    },
    learn: (url, key, labels) => serial(async () => {
      const host = hostKeyOf(url);
      if (host === null || !LEARNED_KEY.test(key) || !isLabels(labels)) return;
      const hash = optionSetHash(labels);
      const entries = (await read()).filter((entry) => !(entry.host === host && entry.key === key && entry.hash === hash));
      entries.push({ host, key, hash, labels: [...labels], at: now() });
      await local.set({ [LEARNED_LISTS_KEY]: { entries: entries.slice(-MAX_LEARNED_LISTS) } });
      log('lists.learned', { options: labels.length, kept: Math.min(entries.length, MAX_LEARNED_LISTS) });
    }),
  };
}
