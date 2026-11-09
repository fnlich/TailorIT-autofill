import '../../shared/zod-setup';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createPagePlatform } from '../../platform/chrome';
import { addInter } from '../../ui/brand/font';
import { adoptPageStyles } from '../../ui/page/styles';
import { adoptStyles } from '../../ui/report/styles';
import { EmbeddedPreview, PREVIEW_CSS, PreviewPage } from '../../ui/preview/PreviewPage';

// v1.4 F (PLAN decision 17): the full-window preview of what a fill of a tab attaches (preview.html?tabId=N&kind=…),
// an extension page the worker opens in a tab of its own. v1.5 X (PLAN decision 2): the extension's one web-accessible
// resource, embedded in the dialog over the tab's page: framed, it shows the one document its address names, with the
// dialog's grant (EmbeddedPreview), and no control a page that frames it could press.
const embedded = window.top !== window;
adoptPageStyles(document);
adoptStyles(document, PREVIEW_CSS);
addInter(document);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {embedded ? <EmbeddedPreview platform={createPagePlatform()} search={location.search} />
      : <PreviewPage platform={createPagePlatform()} search={location.search} />}
  </StrictMode>,
);
