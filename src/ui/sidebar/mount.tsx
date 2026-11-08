/*
 * v5 p1-shell (PLAN decision 1, Jobright's sidebar, read for behaviour only): the sidebar's views, as its bundle
 * (src/entrypoints/sidebar-app.ts) mounts them into the container the content script gives it (content/ui/sidebar.ts):
 * the side panel's own Panel (set-up, main, Settings, the profile editor, the review), pinned to the sidebar's tab, with
 * the header's minimise (`shell`), over the sidebar's transport (platform/sidebar.ts), and the page's own reload for the
 * Panel's "extension updated → Refresh Page" (`refreshPage`, P1-panel's; given by spread, so this builds before and after
 * that merge). The views' stylesheets (the report's, the pages' and the profile editor's, and the few lines that fit them
 * to the sidebar) are added to the content script's closed shadow root, which the container belongs to (adoptStyles
 * adds, never replaces: Edit with AI's own sheets there stay); Inter goes to the page's document (ui/brand/font.ts). The
 * container is as tall as the sidebar (nothing of ours sits above the Panel), so the main view fills it.
 */
import { createRoot } from 'react-dom/client';
import type { PagePlatform } from '../../platform/types';
import type { SidebarApp } from '../../shared/sidebar';
import { addInter } from '../brand/font';
import { PROFILE_CSS } from '../panel/profile-styles';
import { Panel } from '../panel/Panel';
import { PAGE_CSS } from '../page/styles';
import { adoptStyles, REPORT_CSS } from '../report/styles';

/** The views fitted to the sidebar: white, as wide as it is, as tall as it is (a definite height the main view fills;
 *  a longer view scrolls in the sidebar's body). */
export const SIDEBAR_VIEWS_CSS = `
.sidebar__app { height: 100%; --tia-panel-height: 100%; }
.sidebar__app .tia-page { min-height: 100%; background: var(--tia-bg); }
.sidebar__app .tia-panel { max-width: none; margin: 0; }
`;

/** The sidebar's views: `platformFor` builds the transport for the tab the worker named. (The bundle's entry adds the
 *  in-page card's views, content/ui/card.tsx, which this layer may not import.) */
export function createSidebarApp(platformFor: (tabId: number) => PagePlatform): Pick<SidebarApp, 'mount'> {
  return {
    mount({ container, tabId, minimise }) {
      const root = container.getRootNode();
      for (const css of [REPORT_CSS, PAGE_CSS, PROFILE_CSS, SIDEBAR_VIEWS_CSS]) adoptStyles(root, css);
      const doc = container.ownerDocument;
      addInter(doc);
      // The page's own reload: what "Refresh Page" means in the sidebar (P1-panel's prop).
      const page = { refreshPage: () => doc.location.reload() };
      const reactRoot = createRoot(container);
      // No StrictMode: the views open their ports once, as the page they live in keeps them.
      reactRoot.render(<Panel platform={platformFor(tabId)} pinnedTabId={tabId} shell={{ minimise }} {...page} />);
      return { unmount: () => reactRoot.unmount() };
    },
  };
}
