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

/**
 * The extension worker's running status now, as DevTools reports it: 'stopped' when it has no running version. A
 * page holding a `panel` port (the side panel, the report page) reconnects the moment the worker stops, which starts it
 * again; a spec that needs the stop to hold checks this first. `page` is any open page, used for the session.
 */
export async function workerStatus(context: BrowserContext, page: Page, extensionId: string): Promise<Version['runningStatus']> {
  const cdp = await context.newCDPSession(page);
  const seen: { status: Version['runningStatus'] } = { status: 'stopped' };
  try {
    const reported = new Promise<void>((resolve) => {
      cdp.on('ServiceWorker.workerVersionUpdated', (event: { versions: Version[] }) => {
        const ours = event.versions.filter((v) => v.scriptURL.startsWith(`chrome-extension://${extensionId}/`));
        if (ours.length === 0) return;
        seen.status = ours.find((v) => v.runningStatus !== 'stopped')?.runningStatus ?? 'stopped';
        resolve();
      });
    });
    await cdp.send('ServiceWorker.enable');
    // Enabling the domain reports every version at once; a registration with none reported is stopped.
    await Promise.race([reported, new Promise((resolve) => setTimeout(resolve, 1000))]);
    return seen.status;
  } finally {
    await cdp.detach();
  }
}

/** How long a closed side panel view may take to be gone. */
const VIEW_CLOSE_MS = 5000;

/**
 * Closes the browser's own side panel views of the extension (sidepanel.html with no ?tabId=), which Playwright does
 * not list as pages. Each holds a `panel` port that starts a stopped worker again at once. Target.closeTarget answers
 * before the page is gone, and a view still alive when the worker stops reconnects and wakes it, so this waits until
 * DevTools no longer lists the closed views. Answers how many it closed.
 */
export async function closeSidePanelViews(context: BrowserContext, page: Page, extensionId: string): Promise<number> {
  const cdp = await context.newCDPSession(page);
  const targets = async () =>
    ((await cdp.send('Target.getTargets')) as { targetInfos: Array<{ targetId: string; url: string }> }).targetInfos;
  try {
    const views = (await targets()).filter((info) => info.url.startsWith(`chrome-extension://${extensionId}/sidepanel.html`)
      && !info.url.includes('tabId='));
    for (const view of views) await cdp.send('Target.closeTarget', { targetId: view.targetId });
    const closed = new Set(views.map((view) => view.targetId));
    const deadline = Date.now() + VIEW_CLOSE_MS;
    while ((await targets()).some((info) => closed.has(info.targetId))) {
      if (Date.now() > deadline) throw new Error('a side panel view was still open after it was closed');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return views.length;
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
