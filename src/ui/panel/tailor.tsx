/*
 * v1.4 F (PLAN decisions 16-17, Jobright's "Generate Custom Resume" and "Generate Cover Letter" in our own words): the
 * job card's tailoring, as the panel draws it under the résumé line and the cover-letter line.
 *
 * - useTabTailor: the tab's tailoring (panel/tailor {tabId}, a read from the worker's memory), read again for each tab,
 *   page and connection, whenever the worker says a tailoring moved on (panel/changed 'tailor'); no timer of its own.
 *   `start` sends panel/tailor {tabId, start} and shows what it answered. When one is done, `onDone` reads the card
 *   again: the worker made the tailored resume the tab's choice, so the card names it.
 * - TailorRow: "Tailor Resume For This Job" or "Generate Cover Letter", a mint pill with a sparkle and its "?", which
 *   takes a click only once it has been shown CONTROL_SEEN_MS (seen.ts; on the page the sidebar's gate holds it too:
 *   `data-tailor-action`, content/ui/sidebar.ts); then, under the control that started it, TailorIT's step and its
 *   line with a spinner; done ("Tailored for this job: <title> · ATS score 54 → 91"); or why not, with "Make An
 *   Editable Copy In TailorIT" (TailorIT's Documents page) for an upload that has none. Both controls wait while one
 *   tailoring runs.
 * - LetterLine: "Cover letter: <yours | written by TailorIT | none yet> · Preview · Edit", where the form asks for one.
 *
 * States only: no id, no word of a document. The tailored resume's title is shown on purpose, as a resume's label is.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { LetterOutcome, PageMessage } from '../../messaging/schemas';
import type { TailorKind, TailorView } from '../../messaging/page-schemas';
import type { PagePlatform } from '../../platform/types';
import { COPY } from '../../shared/copy';
import { Icon } from '../brand/Icon';
import { HelpTip } from '../page/HelpTip';
import { request } from '../page/request';
import { useShownFor, type SeenClock } from './seen';

const WORDS = COPY.tailor;

/** TailorIT's Documents page, where an upload's editable copy is made. */
export const DOCUMENTS_URL = `${__TAILORIT_ORIGIN__}/documents`;

/** The tab's tailoring (module header). `base` is the card's read key (tab, page, connection; null: no card). */
export function useTabTailor(platform: PagePlatform, tabId: number | null, options: { base: string | null;
  changes: number; onDone(): void }): { view: TailorView | null; start(kind: TailorKind): void } {
  const { base, changes, onDone } = options;
  const [shown, setShown] = useState<{ base: string; view: TailorView } | null>(null);
  const key = tabId === null || base === null ? null : `${base}|${changes}`;

  const take = useCallback((at: string, view: TailorView) => setShown({ base: at, view }), []);
  // A tailoring seen running, then done: the card is read again (the worker made its resume the tab's choice).
  const last = useRef<string | null>(null);
  const now = shown !== null && shown.base === base ? shown.view.state : null;
  useEffect(() => {
    if (last.current === 'running' && now === 'done') onDone();
    last.current = now;
  }, [now, onDone]);

  useEffect(() => {
    if (key === null || tabId === null || base === null) return undefined;
    let live = true;
    void request(platform, { v: 1, type: 'panel/tailor', tabId }).then((answer) => {
      if (live && answer.ok) take(base, answer.data);
    });
    return () => {
      live = false;
    };
  }, [platform, tabId, base, key, take]);

  const start = useCallback((kind: TailorKind) => {
    if (tabId === null || base === null) return;
    setShown({ base, view: { state: 'running', kind, step: null, message: null } });
    const message: Extract<PageMessage, { type: 'panel/tailor' }> = { v: 1, type: 'panel/tailor', tabId, start: kind };
    void request(platform, message).then((answer) => {
      take(base, answer.ok ? answer.data : { state: 'failed', kind,
        reason: answer.error === 'not_connected' ? 'not-connected' : answer.error === 'rate_limited' ? 'rate-limited'
          : 'unavailable' });
    });
  }, [platform, tabId, base, take]);

  return { view: shown !== null && shown.base === base ? shown.view : null, start };
}

/** The line a running tailoring shows: TailorIT's own, else its step's. */
function runningLine(view: Extract<TailorView, { state: 'running' }>): string {
  if (view.message !== null && view.message.trim() !== '') return view.message;
  return view.step === null ? WORDS.working : WORDS.steps[view.step];
}

/** "Tailor Resume For This Job" or "Generate Cover Letter", and what came of it (module header). */
export function TailorRow({ kind, tabId, view, clock, onStart }: { kind: TailorKind; tabId: number;
  view: TailorView | null; clock: SeenClock; onStart(kind: TailorKind): void }) {
  const running = view?.state === 'running';
  const mine = view !== null && view.state !== 'idle' && view.kind === kind ? view : null;
  const seen = useShownFor(`${tabId}|${kind}|${running ? 'running' : 'ready'}`, clock);
  return (
    <div className="tia-tailor" data-tailor={kind} data-tailor-state={mine?.state ?? 'idle'}>
      <span className="tia-tailor__row">
        <button type="button" className="tia-addpill tia-tailor__go" data-tailor-action={kind}
          disabled={running || !seen} onClick={() => {
            // Decided at the click, on what this render shows (seen.ts).
            if (seen && !running) onStart(kind);
          }}>
          {mine?.state === 'running' ? <Icon name="spinner" size={16} className="tia-icon tia-spin" />
            : <Icon name="sparkle" size={16} className="tia-icon" />}
          {WORDS.start[kind]}
        </button>
        <HelpTip text={WORDS.help[kind]} topic={WORDS.start[kind]} />
      </span>
      {mine?.state === 'running' && <p className="tia-tailor__note" role="status" data-tailor-step={mine.step ?? ''}>
        {runningLine(mine)}</p>}
      {mine?.state === 'done' && (
        <p className="tia-tailor__note" role="status" data-tailor-done="">
          <Icon name="tick" size={14} className="tia-icon" />
          {[WORDS.done(mine.title), mine.score === null ? null : WORDS.score(mine.scoreBefore, mine.score),
            mine.letter ? WORDS.letterWritten : null].filter((part) => part !== null).join(' · ')}
        </p>
      )}
      {mine?.state === 'failed' && (
        <p className="tia-tailor__note" role="status" data-tailor-failed={mine.reason}>
          {/* v2.0 fix wave (REQ-1): TailorIT's own words for its AI's refusal, as they are. */}
          {mine.message ?? WORDS.failures[mine.reason]}
          {mine.reason === 'needs-copy' && (
            <>{' '}<a href={DOCUMENTS_URL} target="_blank" rel="noreferrer" data-tailor-copy="">{WORDS.makeCopy}</a></>
          )}
        </p>
      )}
    </div>
  );
}

/** "Preview" and "Edit" of a document a fill attaches (both open in a tab of their own: panel/openDocument). */
export function DocumentLinks({ kind, preview, onOpen }: { kind: TailorKind; preview: boolean;
  onOpen(kind: TailorKind, how: 'preview' | 'edit'): void }) {
  return (
    <>
      {preview && (
        <button type="button" className="tia-linkbutton" data-job-action={kind === 'resume' ? 'preview' : 'letter-preview'}
          aria-label={WORDS.previewLabel(WORDS.kinds[kind])} onClick={() => onOpen(kind, 'preview')}>
          {COPY.job.preview.open}
        </button>
      )}
      <button type="button" className="tia-linkbutton" data-job-action={kind === 'resume' ? 'edit' : 'letter-edit'}
        aria-label={WORDS.editLabel(WORDS.kinds[kind])} onClick={() => onOpen(kind, 'edit')}>{WORDS.edit}</button>
    </>
  );
}

/** "Cover letter: <state> · Preview · Edit" (module header): the person's letter for this job as TailorIT said it, or
 *  the one this tab's tailoring wrote. */
export function LetterLine({ outcome, checking, tailored, onOpen, children }: { outcome: LetterOutcome | null;
  checking: boolean; tailored: boolean; onOpen(kind: TailorKind, how: 'preview' | 'edit'): void;
  children?: ReactNode }) {
  const has = tailored || outcome === 'yours' || outcome === 'written';
  const state = tailored ? WORDS.letter.tailored : outcome === 'yours' ? WORDS.letter.yours
    : outcome === 'written' ? WORDS.letter.written : checking ? WORDS.letter.checking : WORDS.letter.none;
  return (
    <div className="tia-resumeline" data-job-letter="" data-letter-state={has ? 'ready' : 'none'}>
      <p className="tia-resumeline__line">
        <Icon name="doc" size={16} className="tia-icon tia-resumeline__icon" />
        <span className="tia-resumeline__text">
          {WORDS.letter.label}{' '}<strong className="tia-resumeline__label" data-letter-label="">{state}</strong>
        </span>
        {has && <DocumentLinks kind="coverLetter" preview onOpen={onOpen} />}
      </p>
      {children}
    </div>
  );
}
