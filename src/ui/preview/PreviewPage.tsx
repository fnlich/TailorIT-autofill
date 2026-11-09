/*
 * v1.4 F (PLAN decision 17, the owner: "If user click preview, the resume will be shown as whole page dialog"): the
 * full-window preview of what a fill of a tab attaches, an extension page of its own (preview.html, opened in a tab by
 * the worker on panel/openDocument {how: 'preview'}), never inside the job site's page, so the site's scripts never see
 * the resume. It needs no web-accessible resource: the worker opens it as it opens the settings page.
 *
 * - preview.html?tabId=N&kind=resume|coverLetter: the tab whose fill it shows, and the document shown first.
 * - Two tabs, Résumé and Cover Letter: each is fetched when it is shown, over the side panel's own `preview` port
 *   (panel/preview.ts receivePreview: the worker's checked PDF, a header and acknowledged chunks, its SHA-256 checked
 *   here), and shown from a blob: address of this page's own origin, in a frame filling the window (Chrome's PDF
 *   viewer). The address is revoked, and the bytes let go, when another tab is shown or the page closes.
 * - "Edit In TailorIT": TailorIT's editor for the shown document, in a new tab (panel/openDocument {how: 'edit'}: the
 *   worker alone knows its id). Close closes this page.
 *
 * Nothing is stored or logged: the bytes live in this page while it shows them.
 */
import { useEffect, useId, useState } from 'react';
import { TAILOR_KINDS, type TailorKind } from '../../messaging/page-schemas';
import type { PagePlatform } from '../../platform/types';
import { COPY } from '../../shared/copy';
import { LogoMark, Wordmark } from '../brand/Logo';
import { request } from '../page/request';
import { receivePreview, type PreviewResult } from '../panel/preview';
import { pinnedTabOf } from '../panel/tab';

const WORDS = COPY.previewPage;

/** The words of each document's frame. */
const FRAME_WORDS: Record<TailorKind, { loading: string; unavailable: string; title(label: string): string }> = {
  resume: COPY.job.preview,
  coverLetter: COPY.mainView.letterPreview,
};

/** The page's address: the tab it shows (null: none named), and the document shown first. */
export function previewTargetOf(search: string): { tabId: number | null; kind: TailorKind } {
  const kind = new URLSearchParams(search).get('kind');
  return { tabId: pinnedTabOf(search), kind: kind === 'coverLetter' ? 'coverLetter' : 'resume' };
}

/** The page's own layout over the pages' stylesheet: the head, then the frame filling the rest of the window. */
export const PREVIEW_CSS = `
html, body, #root { height: 100%; margin: 0; }
.tia-previewpage { display: flex; flex-direction: column; box-sizing: border-box; height: 100%; max-width: none;
  margin: 0; padding: 12px 16px 16px; gap: 10px; }
.tia-previewpage__head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
.tia-previewpage__title { display: inline-flex; align-items: center; gap: 8px; margin: 0; font: 800 18px/1.2 var(--tia-font); }
.tia-previewpage__tabs { display: inline-flex; gap: 4px; padding: 3px; border-radius: 999px; background: var(--tia-subtle); }
.tia-previewpage__tab { min-height: 32px; padding: 0 16px; border: 0; border-radius: 999px; background: transparent;
  color: var(--tia-fg); font: 700 13px/1 var(--tia-font); cursor: pointer; }
.tia-previewpage__tab[aria-selected="true"] { background: var(--tia-bg); box-shadow: 0 1px 3px rgb(0 0 0 / 0.12); }
.tia-previewpage__tab:focus-visible { outline: 2px solid var(--tia-focus); outline-offset: 2px; }
.tia-previewpage__tools { display: inline-flex; gap: 8px; margin-left: auto; }
.tia-previewpage__body { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; }
.tia-previewpage .tia-preview { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; }
.tia-previewpage .tia-preview__frame { flex: 1 1 auto; height: auto; min-height: 320px; }
`;

/** The full-window preview (module header). `close` closes the page (the window's own by default). */
export function PreviewPage({ platform, search, close = () => globalThis.close() }: { platform: PagePlatform;
  search: string; close?: () => void }) {
  const target = previewTargetOf(search);
  const [kind, setKind] = useState<TailorKind>(target.kind);
  const [note, setNote] = useState<string | null>(null);
  const panelId = useId();
  const tabIdOf = useId();
  const { tabId } = target;
  const edit = () => {
    if (tabId === null) return;
    setNote(null);
    void request(platform, { v: 1, type: 'panel/openDocument', tabId, kind, how: 'edit' }).then((answer) => {
      if (!answer.ok || !answer.data.opened) setNote(COPY.tailor.nothingToOpen);
    });
  };
  return (
    <main className="tia-page tia-previewpage" data-preview-page="" data-preview-shown={kind}>
      <header className="tia-previewpage__head">
        <h1 className="tia-previewpage__title tia-brand__name"><LogoMark size={28} /><Wordmark /></h1>
        <div className="tia-previewpage__tabs" role="tablist" aria-label={WORDS.title}>
          {TAILOR_KINDS.map((each) => (
            <button key={each} type="button" role="tab" className="tia-previewpage__tab" id={`${tabIdOf}-${each}`}
              aria-selected={each === kind} aria-controls={panelId} data-preview-tab={each}
              onClick={() => setKind(each)}>{WORDS.tabs[each]}</button>
          ))}
        </div>
        <span className="tia-previewpage__tools">
          {tabId !== null && (
            <button type="button" className="tia-button" data-preview-edit="" onClick={edit}>{WORDS.edit}</button>
          )}
          <button type="button" className="tia-button tia-button--quiet" data-preview-close="" onClick={close}>
            {WORDS.close}
          </button>
        </span>
      </header>
      {note !== null && <p className="tia-help" role="status" data-preview-note="">{note}</p>}
      <div className="tia-previewpage__body" role="tabpanel" id={panelId} aria-labelledby={`${tabIdOf}-${kind}`}>
        {tabId === null ? <p className="tia-help" role="status" data-preview-failed="">{WORDS.noTab}</p>
          : <DocumentFrame key={kind} kind={kind} load={(signal) => receivePreview(platform, tabId, signal, kind)} />}
      </div>
    </main>
  );
}

/** One document's PDF, from its own transfer (module header): loading, then the frame, or why there is none. */
export function DocumentFrame({ load, kind }: { load(signal: AbortSignal): Promise<PreviewResult>; kind: TailorKind }) {
  const words = FRAME_WORDS[kind];
  const [view, setView] = useState<{ state: 'loading' } | { state: 'shown'; url: string }
    | { state: 'failed'; text: string }>({ state: 'loading' });
  // Read once as the frame is drawn (its key is the document); a new document draws a new frame.
  const [loader] = useState(() => load);

  useEffect(() => {
    let live = true;
    let url: string | null = null;
    const going = new AbortController();
    void loader(going.signal).then((result) => {
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
  }, [loader, kind, words]);

  return (
    <div className="tia-preview" data-resume-preview={view.state} data-preview-kind={kind}>
      {view.state === 'loading' && <p className="tia-help" role="status">{words.loading}</p>}
      {view.state === 'failed' && <p className="tia-help" role="status" data-preview-failed="">{view.text}</p>}
      {view.state === 'shown' && (
        <iframe className="tia-preview__frame" src={view.url} title={words.title(WORDS.tabs[kind])} data-preview-frame="" />
      )}
    </div>
  );
}
