import '../../shared/zod-setup';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createPagePlatform } from '../../platform/chrome';
import { Options } from '../../ui/options/Options';
import { adoptPageStyles } from '../../ui/page/styles';

// The settings page: the connection to TailorIT and every setting, each saved through the worker.
adoptPageStyles(document);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Options platform={createPagePlatform()} />
  </StrictMode>,
);
