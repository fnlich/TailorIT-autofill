import '../../shared/zod-setup';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createPagePlatform } from '../../platform/chrome';
import { Options } from '../../ui/options/Options';
import { addInter } from '../../ui/brand/font';
import { adoptPageStyles } from '../../ui/page/styles';

// The settings page: the connection to TailorIT and every setting, each saved through the worker.
adoptPageStyles(document);
// v5 p1-shell (PLAN decision 3): Inter, from the bundle's own bytes, as the sidebar on the page draws.
addInter(document);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Options platform={createPagePlatform()} />
  </StrictMode>,
);
