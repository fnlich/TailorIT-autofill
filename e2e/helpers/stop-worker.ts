/*
 * Stops the extension's service worker on demand, the way Chrome does after 30 s idle, so specs can prove a run
 * survives a restart. Under Playwright an ordinary test never idles long enough for Chrome to do it.
 *
 * Chosen in Phase 0 (probed): DevTools' Target.closeTarget on the worker's target stops it, which DevTools' own
 * ServiceWorker domain then reports as runningStatus 'stopped'. Playwright keeps listing the old Worker object and fires
 * its 'close' only at teardown, so after a stop, read the extension's storage from one of its pages (readSession), not
 * from the old Worker handle.
 */
import type { BrowserContext, CDPSession, Page } from '@playwright/test';

interface Version {
  versionId: string;
  scriptURL: string;
  runningStatus: 'stopped' | 'starting' | 'running' | 'stopping';
}

/** Resolves when the extension's worker reaches `status`, as DevTools' ServiceWorker domain reports it. */
function statusReached(cdp: CDPSession, extensionId: string, status: Version['runningStatus']): Promise<void> {
  return new Promise((resolve) => {
    cdp.on('ServiceWorker.workerVersionUpdated', (event: { versions: Version[] }) => {
      if (event.versions.some((v) => v.scriptURL.startsWith(`chrome-extension://${extensionId}/`) && v.runningStatus === status)) resolve();
    });
  });
}

/** Stops the worker and waits until DevTools reports it stopped. `page` is any open page, used for the session. */
export async function stopWorker(context: BrowserContext, page: Page, extensionId: string): Promise<void> {
  const cdp = await context.newCDPSession(page);
  try {
    const stopped = statusReached(cdp, extensionId, 'stopped');
    await cdp.send('ServiceWorker.enable');
    const { targetInfos } = (await cdp.send('Target.getTargets')) as { targetInfos: Array<{ targetId: string; type: string; url: string }> };
    const target = targetInfos.find((info) => info.type === 'service_worker' && info.url.startsWith(`chrome-extension://${extensionId}/`));
    if (!target) throw new Error('the extension has no running service worker to stop');
    await cdp.send('Target.closeTarget', { targetId: target.targetId });
    await stopped;
  } finally {
    await cdp.detach();
  }
}

/** storage.session as one of the extension's own pages sees it (extension pages are trusted contexts). */
export async function readSession(extensionPage: Page): Promise<Record<string, unknown>> {
  return extensionPage.evaluate(() =>
    (globalThis as unknown as { chrome: { storage: { session: { get(keys: null): Promise<Record<string, unknown>> } } } }).chrome.storage.session.get(null),
  );
}
