import '../../shared/zod-setup';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { COPY } from '../../shared/copy';

/** The review panel. Opened as a normal tab with ?tabId=N, it pins that tab (which is how tests drive it). */
function Panel() {
  const pinned = new URLSearchParams(location.search).get('tabId');
  return (
    <main>
      <h1>{COPY.panelTitle}</h1>
      <p data-pinned-tab={pinned ?? ''}>{COPY.panelEmpty}</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Panel />
  </StrictMode>,
);
