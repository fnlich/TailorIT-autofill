import '../../shared/zod-setup';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createPagePlatform } from '../../platform/chrome';
import { addInter } from '../../ui/brand/font';
import { adoptPageStyles } from '../../ui/page/styles';
import { adoptStyles } from '../../ui/report/styles';
import { PREVIEW_CSS, PreviewPage } from '../../ui/preview/PreviewPage';

// v1.4 F (PLAN decision 17): the full-window preview of what a fill of a tab attaches (preview.html?tabId=N&kind=…),
// an extension page the worker opens in a tab of its own: never the job page, and no web-accessible resource.
adoptPageStyles(document);
adoptStyles(document, PREVIEW_CSS);
addInter(document);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PreviewPage platform={createPagePlatform()} search={location.search} />
  </StrictMode>,
);
