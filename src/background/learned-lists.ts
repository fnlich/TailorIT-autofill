/*
 * Learned lists (snapshot round 2, decision 1: the owner's "store it and select at a once"; dom/widgets/known.ts):
 * the option lists a host's select-only dropdowns showed a run (Workday's Degree, Phone Device Type, Prefix, Suffix,
 * which no snapshot shows open), kept in storage.local under `lists:v2`, so the host's next run plans them on its first
 * pass and chooses each with one opening of its list, checked there (a list the page shows otherwise is read whole, as
 * before, and that read is learned in its place).
 * - What is kept: per list, its site's key, its label's key (the first 16 hex digits of the SHA-256 of the field's
 *   label slug, with the value of the field its list depends on where it has one: dom/widgets/known.ts
 *   learnedListKey, as the content script sends it), the hash of its options (core/text/keys.ts optionSetHash, so a
 *   site's same label with another list is another entry) and its option labels (page text, never a value: at most
 *   MAX_LEARNED_OPTIONS, each at most MAX_LEARNED_LABEL characters). No address, no question's words, no answer, no
 *   time: the record's order is the order lists were learned in.
 * - The site's key (the review of round 2, L1): an HMAC-SHA-256 (32 hex) of the frame's host as Chrome reports it (never
 *   a payload's) under 32 random bytes made for this install and kept beside the entries, so a guess at a host cannot
 *   be checked against the record; on myworkdaysite.com, which serves every tenant on one host, the host with the
 *   tenant its path names (/[locale/]recruiting/<tenant>/...), and nothing at all where the path names none. A record
 *   without a secret, or one that does not parse, is no record, and a new secret is made.
 * - At most MAX_LEARNED_LISTS lists, MAX_LEARNED_SITE_LISTS of one site, and MAX_LEARNED_BYTES of labels (their UTF-8
 *   bytes) in all, the earliest learned going first; a list learned again moves to the end. Writes go one at a time (a
 *   keyed queue).
 * - lists/known answers the sender's site's lists, the most recently learned of each label key, at most
 *   MAX_LEARNED_PER_HOST. lists/learn keeps one. A private (incognito) tab's are never kept (the audit of 2026-11-06,
 *   S-6: nothing of a private session is written to storage.local); its run is still offered the site's lists.
 * Nothing here is logged but counts.
 */
import { optionSetHash } from '../core/text/keys';
import { bytesToHex, hmacSha256Hex } from '../core/text/sha256';
import type { StorageArea } from '../platform/types';
import {
  LEARNED_KEY, MAX_LEARNED_LABEL, MAX_LEARNED_LISTS, MAX_LEARNED_OPTIONS, MAX_LEARNED_PER_HOST,
} from '../shared/learned-lists';
import { log } from '../shared/log';
import { createKeyedQueue } from './locks';

export const LEARNED_LISTS_KEY = 'lists:v2';
/** Round 2's first record (a plain host hash and a time per list): dropped at the first write. */
const OLD_LISTS_KEY = 'lists:v1';
/** lists/known and lists/learn, per tab: a run asks once per step's fill and learns a few lists, never a stream. */
export const LEARNED_LISTS_LIMIT = { count: 60, windowMs: 60_000 } as const;
/** The most lists one site keeps, and the most bytes (UTF-8) of labels the record keeps in all. */
export const MAX_LEARNED_SITE_LISTS = 60;
export const MAX_LEARNED_BYTES = 256 * 1024;

/** A site's key: the first 32 hex digits of its HMAC. */
const SITE_KEY = /^[0-9a-f]{32}$/;
/** myworkdaysite.com's shared hosts, and the tenant a path names on them (workday/url.ts reads the same). */
const SHARED_WORKDAY_HOST = /^wd\d{1,3}\.myworkdaysite\.com$/;
const TENANT_PATH = /^\/(?:[a-z]{2,3}(?:-[a-z0-9]{2,4})?\/)?recruiting\/([a-z0-9_-]+)(?:\/|$)/i;

/** One kept list. */
interface Entry {
  site: string;
  key: string;
  hash: string;
  labels: string[];
}

interface Stored {
  /** This install's secret, 32 random bytes in hex. */
  secret: string;
  entries: Entry[];
}

const isLabels = (raw: unknown): raw is string[] => Array.isArray(raw) && raw.length > 0
  && raw.length <= MAX_LEARNED_OPTIONS
  && raw.every((label) => typeof label === 'string' && label !== '' && label.length <= MAX_LEARNED_LABEL);

/** What was stored, checked: an entry that does not read is dropped; a record with no secret is none. */
function storedOf(raw: unknown): Stored | null {
  if (raw === null || typeof raw !== 'object') return null;
  const { secret, entries } = raw as { secret?: unknown; entries?: unknown };
  if (typeof secret !== 'string' || !/^[0-9a-f]{64}$/.test(secret) || !Array.isArray(entries)) return null;
  const kept = entries.flatMap((item): Entry[] => {
    if (item === null || typeof item !== 'object') return [];
    const { site, key, hash, labels } = item as Record<string, unknown>;
    if (typeof site !== 'string' || !SITE_KEY.test(site) || typeof key !== 'string' || !LEARNED_KEY.test(key)
      || typeof hash !== 'string' || hash.length > 80 || !isLabels(labels)) return [];
    return [{ site, key, hash, labels: [...labels] }];
  });
  return { secret, entries: kept };
}

/** The site an address's lists are kept for (see the header): its host, or on myworkdaysite.com its host and the
 *  tenant its path names; null for an address with no host, or a shared host whose path names no tenant. */
export function siteOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host === '') return null;
  if (!SHARED_WORKDAY_HOST.test(host)) return host;
  const tenant = TENANT_PATH.exec(parsed.pathname)?.[1];
  return tenant === undefined ? null : `${host}/${tenant.toLowerCase()}`;
}

/** The UTF-8 bytes of a list's labels, as the record keeps them. */
const bytesOf = (labels: readonly string[]) => new TextEncoder().encode(JSON.stringify(labels)).length;

/** The entries within the caps (see the header): the earliest learned go first. */
function capped(entries: readonly Entry[]): Entry[] {
  const out: Entry[] = [];
  const perSite = new Map<string, number>();
  let bytes = 0;
  // From the latest back, so the earliest are the ones left out.
  for (const entry of [...entries].reverse()) {
    const site = perSite.get(entry.site) ?? 0;
    const size = bytesOf(entry.labels);
    if (out.length >= MAX_LEARNED_LISTS || site >= MAX_LEARNED_SITE_LISTS || bytes + size > MAX_LEARNED_BYTES) continue;
    perSite.set(entry.site, site + 1);
    bytes += size;
    out.push(entry);
  }
  return out.reverse();
}

/** The learned lists, over storage.local. */
export interface LearnedListStore {
  /** The address's site's lists: the most recently learned of each label key, newest first. */
  known(url: string): Promise<Array<{ key: string; labels: string[] }>>;
  /** Keeps a list for the address's site under its label key (see the header). */
  learn(url: string, key: string, labels: readonly string[]): Promise<void>;
}

/** The store; `randomBytes` makes the install's secret (the platform's, else the global's). */
export function createLearnedListStore(local: StorageArea,
  randomBytes: (count: number) => Uint8Array = (count) => crypto.getRandomValues(new Uint8Array(count))):
  LearnedListStore {
  const queue = createKeyedQueue();
  const serial = <T>(task: () => Promise<T>) => queue.run(LEARNED_LISTS_KEY, task);
  const read = async () => storedOf(await local.get(LEARNED_LISTS_KEY));
  const keyOf = (stored: Pick<Stored, 'secret'>, url: string): string | null => {
    const site = siteOf(url);
    if (site === null) return null;
    const secret = Uint8Array.from(stored.secret.match(/../g)!, (pair) => parseInt(pair, 16));
    return hmacSha256Hex(secret, site).slice(0, 32);
  };
  return {
    async known(url) {
      const stored = await read();
      const site = stored === null ? null : keyOf(stored, url);
      if (stored === null || site === null) return [];
      const seen = new Set<string>();
      const out: Array<{ key: string; labels: string[] }> = [];
      for (const entry of [...stored.entries].reverse()) {
        if (entry.site !== site || seen.has(entry.key)) continue;
        seen.add(entry.key);
        out.push({ key: entry.key, labels: entry.labels });
        if (out.length === MAX_LEARNED_PER_HOST) break;
      }
      return out;
    },
    learn: (url, key, labels) => serial(async () => {
      if (!LEARNED_KEY.test(key) || !isLabels(labels) || siteOf(url) === null) return;
      const stored = await read() ?? { secret: bytesToHex(randomBytes(32)), entries: [] };
      const site = keyOf(stored, url)!;
      const hash = optionSetHash(labels);
      const entries = capped([...stored.entries.filter((entry) => !(entry.site === site && entry.key === key
        && entry.hash === hash)), { site, key, hash, labels: [...labels] }]);
      await local.set({ [LEARNED_LISTS_KEY]: { secret: stored.secret, entries } });
      await local.remove([OLD_LISTS_KEY]);
      log('lists.learned', { options: labels.length, kept: entries.length });
    }),
  };
}
