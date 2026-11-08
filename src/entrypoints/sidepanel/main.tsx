import '../../shared/zod-setup';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createPagePlatform } from '../../platform/chrome';
import { addInter } from '../../ui/brand/font';
import { adoptPageStyles } from '../../ui/page/styles';
import { Panel } from '../../ui/panel/Panel';
import { pinnedTabOf } from '../../ui/panel/tab';

// The review panel. Opened as a normal tab with ?tabId=N, it pins that tab (the report page, which is how tests drive it).
adoptPageStyles(document);
// v5 p1-shell (PLAN decision 3): Inter, from the bundle's own bytes, as the sidebar on the page draws.
addInter(document);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Panel platform={createPagePlatform()} pinnedTabId={pinnedTabOf(location.search)} />
  </StrictMode>,
);
