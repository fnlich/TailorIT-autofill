import '../shared/zod-setup';
/*
 * v5 p1-shell (PLAN decision 1; shared/sidebar.ts): the sidebar's bundle, an unlisted script (never in the manifest)
 * that the worker runs in a tab's top frame, that document alone, when its content script asks (sidebar/load), in the
 * extension's isolated world beside it. It draws nothing by itself: it leaves its entry under SIDEBAR_APP_KEY, which
 * the content script mounts into its closed shadow root: the sidebar's views (the top frame), and the in-page card's
 * (a frame inside another page, content/ui/card.tsx). A second run in the same document keeps the first entry.
 */
import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';
import { CARD_RENDERER } from '../content/ui/card';
import { createSidebarPlatform } from '../platform/sidebar';
import { SIDEBAR_APP_KEY, type SidebarApp } from '../shared/sidebar';
import { createSidebarApp } from '../ui/sidebar/mount';

export default defineUnlistedScript(() => {
  const world = globalThis as unknown as Record<symbol, unknown>;
  if (world[SIDEBAR_APP_KEY] !== undefined) return;
  const app: SidebarApp = { ...createSidebarApp(createSidebarPlatform), card: CARD_RENDERER };
  world[SIDEBAR_APP_KEY] = app;
});
