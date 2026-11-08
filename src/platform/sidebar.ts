/*
 * v5 p1-shell (PLAN decision 1): the sidebar's transport. The sidebar draws the side panel's views (src/ui/panel) in the
 * tab's top frame, inside the content script's closed shadow root, and they ask the worker what they ask from Chrome's
 * side panel, through the same PagePlatform: here over that frame's content channel (runtime.sendMessage and
 * runtime.connect from the extension's isolated world), which the worker takes for the sidebar's own messages alone
 * (background/senders.ts SIDEBAR_PAGE_MESSAGES, sidebarMayAsk) while the panel shows on the page.
 * - The tab is fixed: the one the worker named in sidebar/load's answer. activeTabId answers it; the sidebar never
 *   follows another tab, and hears no tab change (its document is the tab's page: a new page is a new sidebar).
 * - A page has no Chrome tabs or permissions API: no tab event reaches it (the `panel` port carries every change), and
 *   no host permission is asked for from the page.
 * - Links to the extension's own pages cannot open from a page (they are not web-accessible); the sidebar sends
 *   sidebar/options instead (content/ui/sidebar.ts), so getURL is only what its links name.
 */
import { browser } from 'wxt/browser';
import { asOpened } from '../shared/sidebar';
import type { PagePlatform, PortLike, SendFailure } from './types';

function sendFailure(error: unknown): SendFailure {
  const message = error instanceof Error ? error.message : String(error);
  return /context invalidated/i.test(message) ? 'context-invalidated' : 'no-receiver';
}

type RawPort = ReturnType<typeof browser.runtime.connect>;

function wrapPort(port: RawPort): PortLike {
  return {
    name: port.name,
    post: (message) => port.postMessage(message),
    onMessage(cb) {
      const listener = (message: unknown) => cb(message);
      port.onMessage.addListener(listener);
      return () => port.onMessage.removeListener(listener);
    },
    onDisconnect(cb) {
      const listener = () => cb();
      port.onDisconnect.addListener(listener);
      return () => port.onDisconnect.removeListener(listener);
    },
    disconnect: () => port.disconnect(),
  };
}

/** The sidebar's platform for the tab `tabId` (sidebar/load's answer); `byItself`: the sidebar opened by itself. */
export function createSidebarPlatform(tabId: number, byItself = false): PagePlatform {
  const none = () => () => undefined;
  return {
    runtime: {
      get id() {
        return browser.runtime?.id;
      },
      async send(message) {
        try {
          return await browser.runtime.sendMessage(asOpened(message, byItself));
        } catch (error) {
          throw sendFailure(error);
        }
      },
      connect: (name) => wrapPort(browser.runtime.connect({ name })),
      getURL: (path) => browser.runtime.getURL(path as never),
      isValid: () => browser.runtime?.id != null,
    },
    activeTabId: async () => tabId,
    onActiveTabChanged: none,
    onTabLoaded: none,
    requestHosts: async () => false,
    removeHosts: async () => false,
  };
}
