/*
 * Learned lists (snapshot round 2, decision 1): the shapes the content script, the messages and the worker share. A
 * learnable dropdown's complete whole read (dom/widgets/known.ts) is told to the worker as its option labels (page
 * text, never a value) under its label's key; the worker keeps the last lists of each site (background/learned-
 * lists.ts) and offers them on the site's next run. The label's key is the first 16 hex digits of a SHA-256 of its
 * slug (with the value of the field its list depends on, where it has one), the content script's; the site's an HMAC
 * of its host under the install's own secret, the worker's, from Chrome's sender address: no question's words and no
 * address are stored. The adapters' stored lists (STORED_LIST_IDS) are served the same way, by id, from the worker.
 */
import { sha256Hex } from '../core/text/sha256';

/** The most options a learned list holds, and the longest label it keeps: a longer list or label is never learned. */
export const MAX_LEARNED_OPTIONS = 300;
export const MAX_LEARNED_LABEL = 160;
/** The most lists the worker keeps in all (the earliest learned go first), and keeps and offers for one site (a host,
 *  or a myworkdaysite.com tenant: background/learned-lists.ts siteOf); the name keeps "host" from version 1. */
export const MAX_LEARNED_LISTS = 200;
export const MAX_LEARNED_PER_HOST = 60;

/** A learned list's key: 16 lower-case hex digits. */
export const LEARNED_KEY = /^[0-9a-f]{16}$/;

/** The key of a label slug or a host: the first 16 hex digits of its SHA-256. */
export function learnedKeyOf(text: string): string {
  return sha256Hex(text).slice(0, 16);
}

// ── Stored lists (the content-script budget): the lists an adapter stores from the snapshots live in the worker
// (background/stored-lists.ts) and are served by lists/known; an adapter declares only a list's id (WidgetDecl
// .storedList), never its labels, so the content script carries none of them. ──

/** Every stored list, by a stable id: its platform and the list. */
export const STORED_LIST_IDS = ['workday.countries', 'workday.us-states', 'greenhouse.phone-countries',
  'greenhouse.eeoc-gender', 'greenhouse.eeoc-hispanic', 'greenhouse.eeoc-veteran'] as const;
export type StoredListId = (typeof STORED_LIST_IDS)[number];

/** The lists asked with a list a scan names: Workday's State holds its stored states only once its Country shows the
 *  United States, which the run's own first pass may choose, so the states come with the countries. */
const COMPANIONS: Readonly<Partial<Record<StoredListId, readonly StoredListId[]>>> = {
  'workday.countries': ['workday.us-states'],
};

/** The stored lists to ask for the ids a scan names: each once, with its companions. */
export function storedListsWanted(named: readonly StoredListId[]): StoredListId[] {
  return [...new Set(named.flatMap((id) => [id, ...(COMPANIONS[id] ?? [])]))];
}
