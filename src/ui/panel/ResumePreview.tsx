/*
 * The resume's PDF preview in the side panel (v3 Phase 3b; Jobright's resume preview): the bytes come over the preview
 * port (preview.ts), checked, and are shown from a blob: address of the side panel's own origin, in a frame of its own
 * page (Chrome's PDF viewer), with "Open it larger" for the same address in a tab. Never in the job page. The address
 * is revoked, and the bytes let go, when the preview closes or the panel follows another tab; a transfer still on its
 * way then ends (its port disconnected: the review). The loader is the container's stable one (one transfer per
 * preview opened, whatever the panel draws meanwhile); a tab opened with Open it larger keeps its own copy of the PDF
 * until that tab is closed (docs/PRIVACY.md).
 * v4 ui: the cover letter's preview too (`kind` 'coverLetter', under the report's cover-letter row), the same way.
 * v5 p1-shell (the review's S6 and F10): in the sidebar on the page (on-page.tsx) nothing is loaded: the preview says it
 * opens in Chrome's side panel and links there, so no file's bytes reach the page's process (and no page's CSP stands
 * between the person and the preview).
 */
import { useEffect, useState } from 'react';
import { COPY } from '../../shared/copy';
import type { PreviewKind } from '../report/Report';
import { InSidePanel, useOnPage } from './on-page';
import type { PreviewResult } from './preview';

/** The words of each kind's preview. */
const WORDS_OF: Record<PreviewKind, { loading: string; unavailable: string; title(label: string): string }> = {
  resume: COPY.job.preview,
  coverLetter: COPY.mainView.letterPreview,
};

type PreviewProps = { load(signal: AbortSignal): Promise<PreviewResult>; label: string; onClose(): void;
  kind?: PreviewKind };

export function ResumePreview(props: PreviewProps) {
  const onPage = useOnPage();
  if (onPage === null) return <InlinePreview {...props} />;
  return (
    <div className="tia-preview" data-resume-preview="elsewhere" data-preview-kind={props.kind ?? 'resume'}>
      <div className="tia-preview__bar">
        <button type="button" className="tia-button tia-button--quiet" onClick={props.onClose}>{COPY.job.preview.close}</button>
      </div>
      <InSidePanel text={COPY.onPage.preview} onPage={onPage} />
    </div>
  );
}

/** The preview itself, where the panel is an extension page. */
function InlinePreview({ load, label, onClose, kind = 'resume' }: PreviewProps) {
  const words = WORDS_OF[kind];
  const [view, setView] = useState<{ state: 'loading' } | { state: 'shown'; url: string }
    | { state: 'failed'; text: string }>({ state: 'loading' });

  useEffect(() => {
    let live = true;
    let url: string | null = null;
    const going = new AbortController();
    void load(going.signal).then((result) => {
      if (!live) return;
      if (!result.ok) {
        setView({ state: 'failed', text: result.reason === 'not-pdf' && kind === 'resume' ? COPY.job.preview.notPdf
          : words.unavailable });
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
  }, [load, kind, words]);

  return (
    <div className="tia-preview" data-resume-preview={view.state} data-preview-kind={kind}>
      <div className="tia-preview__bar">
        {view.state === 'shown' && (
          <a className="tia-button tia-button--quiet" href={view.url} target="_blank" rel="noreferrer"
            data-preview-open="">{COPY.job.preview.openTab}</a>
        )}
        <button type="button" className="tia-button tia-button--quiet" onClick={onClose}>{COPY.job.preview.close}</button>
      </div>
      {view.state === 'loading' && <p className="tia-help" role="status">{words.loading}</p>}
      {view.state === 'failed' && <p className="tia-help" role="status" data-preview-failed="">{view.text}</p>}
      {view.state === 'shown' && (
        <iframe className="tia-preview__frame" src={view.url} title={words.title(label)} data-preview-frame="" />
      )}
    </div>
  );
}
