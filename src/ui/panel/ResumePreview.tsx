/*
 * The resume's PDF preview in the side panel (v3 Phase 3b; Jobright's resume preview): the bytes come over the preview
 * port (preview.ts), checked, and are shown from a blob: address of the side panel's own origin, in a frame of its own
 * page (Chrome's PDF viewer), with "Open it larger" for the same address in a tab. Never in the job page. The address
 * is revoked, and the bytes let go, when the preview closes or the panel follows another tab; a transfer still on its
 * way then ends (its port disconnected: the review). The loader is the container's stable one (one transfer per
 * preview opened, whatever the panel draws meanwhile); a tab opened with Open it larger keeps its own copy of the PDF
 * until that tab is closed (docs/PRIVACY.md).
 */
import { useEffect, useState } from 'react';
import { COPY } from '../../shared/copy';
import type { PreviewResult } from './preview';

const WORDS = COPY.job.preview;

export function ResumePreview({ load, label, onClose }: { load(signal: AbortSignal): Promise<PreviewResult>;
  label: string; onClose(): void }) {
  const [view, setView] = useState<{ state: 'loading' } | { state: 'shown'; url: string }
    | { state: 'failed'; text: string }>({ state: 'loading' });

  useEffect(() => {
    let live = true;
    let url: string | null = null;
    const going = new AbortController();
    void load(going.signal).then((result) => {
      if (!live) return;
      if (!result.ok) {
        setView({ state: 'failed', text: result.reason === 'not-pdf' ? WORDS.notPdf : WORDS.unavailable });
        return;
      }
      url = URL.createObjectURL(result.blob);
      setView({ state: 'shown', url });
    });
    return () => {
      live = false;
      going.abort();
      if (url !== null) URL.revokeObjectURL(url);
    };
  }, [load]);

  return (
    <div className="tia-preview" data-resume-preview={view.state}>
      <div className="tia-preview__bar">
        {view.state === 'shown' && (
          <a className="tia-button tia-button--quiet" href={view.url} target="_blank" rel="noreferrer"
            data-preview-open="">{WORDS.openTab}</a>
        )}
        <button type="button" className="tia-button tia-button--quiet" onClick={onClose}>{WORDS.close}</button>
      </div>
      {view.state === 'loading' && <p className="tia-help" role="status">{WORDS.loading}</p>}
      {view.state === 'failed' && <p className="tia-help" role="status" data-preview-failed="">{view.text}</p>}
      {view.state === 'shown' && (
        <iframe className="tia-preview__frame" src={view.url} title={WORDS.title(label)} data-preview-frame="" />
      )}
    </div>
  );
}
