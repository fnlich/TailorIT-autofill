/*
 * The content script's runtime. It never uses WXT's content-script context (a page can reach that object: it can stop
 * it with a forged DOM event), so it owns its own lifetime: a run ends for invalidation only when the extension's id is
 * gone or a send reports it. Phase 0 only announces the frame.
 */
import { probeStorageLocalFromContent } from '../platform/chrome';
import type { ContentPlatform } from '../platform/types';
import { log } from '../shared/log';

export async function startContentRuntime(platform: ContentPlatform, doc: Document): Promise<void> {
  log('content.started');
  const view = doc.defaultView;
  const isTop = view !== null && view.top === view;
  try {
    await platform.runtime.send({ v: 1, type: 'frame/hello', isTop, hasForm: doc.querySelector('form') !== null });
  } catch (failure) {
    if (failure === 'context-invalidated') log('content.context-invalidated');
    return;
  }
  if (__E2E__) {
    const storageLocal = await probeStorageLocalFromContent();
    await platform.runtime.send({ v: 1, type: 'e2e/probe', storageLocal }).catch(() => undefined);
  }
}
