/*
 * v5 p2-fill (PLAN decision 14; Jobright's main-world alert suppressor and file-picker interception, in our own design):
 * the worker's part of the page patches. On page/patches from a frame of ours that holds a form (its registry entry,
 * for the same document), as a run begins there (content/runtime.ts), the patches' bundle (PAGE_PATCHES_FILE, the
 * unlisted script src/entrypoints/page-patches.ts) runs in that one document, world MAIN (scripting.executeScript, its
 * document id): never at load, never in a frame where nothing is filled, never from the sentinel, at most
 * PAGE_PATCHES_LIMIT a minute per frame. No web-accessible resource: Chrome runs the extension's own file. What the
 * patches do (the page's dialogs held through one write, its own file picker armed for one press) is page/patches.ts's.
 */
import { ok, refuse, type Answer } from '../messaging/envelope';
import type { StorageArea, WorkerPlatform } from '../platform/types';
import { log } from '../shared/log';
import { frameEntry } from './frames';
import type { createRateLimit } from './locks';
import type { ContentChannel } from './router';

/** The patches' bundle, as WXT writes the unlisted script src/entrypoints/page-patches.ts. */
export const PAGE_PATCHES_FILE = 'page-patches.js';
/** page/patches per frame: one per document a run begins in, a few documents a minute, never a stream. */
export const PAGE_PATCHES_LIMIT = { count: 20, windowMs: 60_000 } as const;

export interface PagePatchesDeps {
  scripting: Pick<WorkerPlatform['scripting'], 'inject'>;
  session: StorageArea;
  /** PAGE_PATCHES_LIMIT, keyed `${tabId}/${frameId}`. */
  limit: ReturnType<typeof createRateLimit>;
}

export interface PagePatches {
  load(from: ContentChannel): Promise<Answer<Record<string, never>>>;
}

export function createPagePatches(deps: PagePatchesDeps): PagePatches {
  return {
    async load(from) {
      if (from.reach === 'sentinel' || from.documentId === undefined) return refuse('bad_sender');
      // A frame of ours that said hello from this very document with a form: where a run begins.
      const entry = await frameEntry(deps.session, from.tabId, from.frameId);
      if (entry === null || entry.documentId !== from.documentId || !entry.hasForm) {
        log('patches.refused', { form: false });
        return refuse('expired');
      }
      const retry = deps.limit.take(`${from.tabId}/${from.frameId}`);
      if (retry !== null) return { ok: false, error: 'rate_limited', retryAfterSeconds: retry };
      try {
        await deps.scripting.inject(from.tabId, { frameId: from.frameId, documentId: from.documentId }, PAGE_PATCHES_FILE,
          'MAIN');
      } catch {
        // Chrome refused (the document went, or no host permission reaches it): the writes go on without the patches.
        log('patches.refused', { failed: true });
        return refuse('unavailable');
      }
      log('patches.injected');
      return ok({});
    },
  };
}
