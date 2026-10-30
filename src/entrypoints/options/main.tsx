import '../../shared/zod-setup';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { COPY } from '../../shared/copy';

function Options() {
  return (
    <main>
      <h1>{COPY.optionsTitle}</h1>
      <p>{COPY.optionsSoon}</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Options />
  </StrictMode>,
);
