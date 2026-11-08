/*
 * Learned lists (snapshot round 2, decision 1): the shapes the content script, the messages and the worker share. A
 * learnable dropdown's complete whole read (dom/widgets/known.ts) is told to the worker as its option labels (page
 * text, never a value) under its label's key; the worker keeps the last lists of each host (background/learned-
 * lists.ts) and offers them on the host's next run. Keys are the first 16 hex digits of a SHA-256: the label's slug
 * (the content script's) and the host (the worker's, from Chrome's sender address), so no question's words and no
 * address are stored.
 */
import { sha256Hex } from '../core/text/sha256';

/** The most options a learned list holds, and the longest label it keeps: a longer list or label is never learned. */
export const MAX_LEARNED_OPTIONS = 300;
export const MAX_LEARNED_LABEL = 160;
/** The most lists the worker keeps across every host (the least recently learned go first), and offers for one host. */
export const MAX_LEARNED_LISTS = 200;
export const MAX_LEARNED_PER_HOST = 60;

/** A learned list's key: 16 lower-case hex digits. */
export const LEARNED_KEY = /^[0-9a-f]{16}$/;

/** The key of a label slug or a host: the first 16 hex digits of its SHA-256. */
export function learnedKeyOf(text: string): string {
  return sha256Hex(text).slice(0, 16);
}
