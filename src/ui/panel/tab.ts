/*
 * Which tab the review panel shows. `?tabId=N` pins one tab: the report page, which also opens as a normal tab, and
 * the only form of the panel Playwright can drive. Without it, the panel follows the active tab of its own window.
 * tabs.onActivated fires for every window, so on each activation the panel reads its own window's active tab again
 * (the platform's activeTabId) rather than taking the activated one: a tab chosen in another window never takes over.
 */
import { useEffect, useState } from 'react';
import type { PagePlatform } from '../../platform/types';

/** The tab `?tabId=N` pins, or null when the address pins none (a missing, empty or malformed id pins none). */
export function pinnedTabOf(search: string): number | null {
  const raw = new URLSearchParams(search).get('tabId');
  if (raw === null || !/^\d{1,10}$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

/** The tab the panel shows: the pinned one, else its window's active tab (null while unknown or when there is none). */
export function useFollowedTab(platform: PagePlatform, pinned: number | null): number | null {
  const [followed, setFollowed] = useState<number | null>(null);
  useEffect(() => {
    if (pinned !== null) return undefined;
    let live = true;
    let latest = 0;
    const read = () => {
      latest += 1;
      const ask = latest;
      platform.activeTabId().then(
        (tabId) => {
          if (live && ask === latest) setFollowed(tabId);
        },
        () => {
          if (live && ask === latest) setFollowed(null);
        },
      );
    };
    read();
    const stop = platform.onActiveTabChanged(() => read());
    return () => {
      live = false;
      stop();
    };
  }, [platform, pinned]);
  return pinned ?? followed;
}
