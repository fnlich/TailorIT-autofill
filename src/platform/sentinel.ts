/*
 * The sentinel's browser (v3 Phase 8): one message to the worker, the worker's stop, whether the extension still runs,
 * and whether the tab is a private one. Its own file, so the sentinel's bundle holds none of platform/chrome.ts (the
 * adapters' address readers, the worker's and the pages' platforms).
 */
import { browser } from 'wxt/browser';
import type { SentinelPlatform } from '../sentinel';

/** The worker's stop (background/sites.ts, as the career sites are turned off): the content runtime of a page the
 *  worker injected takes the same message. */
const isStop = (message: unknown) => typeof message === 'object' && message !== null
  && (message as { v?: unknown }).v === 1 && (message as { type?: unknown }).type === 'site/stop';

export function createSentinelPlatform(): SentinelPlatform {
  const { runtime } = browser;
  return {
    send: (message) => runtime.sendMessage(message),
    alive: () => typeof runtime?.id === 'string',
    incognito: browser.extension?.inIncognitoContext === true,
    onStop(stop) {
      // The worker's alone: our own id, and no tab (a content script's message carries its tab).
      const listener = (message: unknown, sender: { id?: string; tab?: unknown }) => {
        if (sender.id === runtime.id && sender.tab === undefined && isStop(message)) stop();
      };
      runtime.onMessage.addListener(listener);
      // Gone with the extension, the listener is gone too.
      return () => runtime.onMessage.removeListener(listener);
    },
  };
}
