/*
 * v5 p1-shell (PLAN decision 1, Jobright's sidebar, read for behaviour only): the sidebar's views, as its bundle
 * (src/entrypoints/sidebar-app.ts) mounts them into the container the content script gives it (content/ui/sidebar.ts):
 * the side panel's own Panel (set-up, main, Settings, the profile editor, the review), pinned to the sidebar's tab, with
 * the header's minimise (`shell`), over the sidebar's transport (platform/sidebar.ts; the review's S1: a sidebar that
 * opened by itself asks for its job card as a page that loads), and the page's own reload for the Panel's "extension
 * updated → Refresh Page" (`refreshPage`, P1-panel's). The views know they are on the page (OnPageContext, the
 * review's S6 and S7: what they leave to Chrome's side panel and the settings page). The views' stylesheets (the
 * report's, the pages' and the profile editor's, and the few lines that fit them to the sidebar) are added to the
 * content script's closed shadow root, which the container belongs to (adoptStyles adds, never replaces: Edit with AI's
 * own sheets there stay); Inter goes to the page's document while it is open (ui/brand/font.ts; S10). The container is
 * as tall as the sidebar (nothing of ours sits above the Panel), so the main view fills it.
 */
import { createRoot } from 'react-dom/client';
import type { PagePlatform } from '../../platform/types';
import type { SidebarApp } from '../../shared/sidebar';
import { addInter, removeInter } from '../brand/font';
import { PROFILE_CSS } from '../panel/profile-styles';
import { OnPageContext } from '../panel/on-page';
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
export function createSidebarApp(platformFor: (tabId: number, byItself: boolean) => PagePlatform):
  Pick<SidebarApp, 'mount'> {
  return {
    mount({ container, tabId, minimise, byItself }) {
      const root = container.getRootNode();
      for (const css of [REPORT_CSS, PAGE_CSS, PROFILE_CSS, SIDEBAR_VIEWS_CSS]) adoptStyles(root, css);
      const doc = container.ownerDocument;
      addInter(doc);
      const reactRoot = createRoot(container);
      // No StrictMode: the views open their ports once, as the page they live in keeps them. "Refresh Page" reloads the
      // page the sidebar is on.
      const platform = platformFor(tabId, byItself === true);
      const onPage = { sidePanelUrl: platform.runtime.getURL('/sidepanel.html'),
        settingsUrl: platform.runtime.getURL('/options.html#modes') };
      reactRoot.render(
        <OnPageContext.Provider value={onPage}>
          <Panel platform={platform} pinnedTabId={tabId} shell={{ minimise }} refreshPage={() => doc.location.reload()} />
        </OnPageContext.Provider>,
      );
      // The review's S10: the face goes with the sidebar, as everything it added to the page does.
      return { unmount: () => {
        reactRoot.unmount();
        removeInter(doc);
      } };
    },
  };
}
