/*
 * v5 p1-shell (PLAN decision 8, Jobright's Workday strip, read for behaviour only): over the panel's head on a Workday
 * page, an amber strip saying to stay on the page while Autofill fills it (Workday drops what a person does on another
 * page of the application). Its × closes it for good: the worker keeps the note's name (panel/closeNote), and every
 * panel, on the page or in Chrome's side panel, reads it (panel/notes) before showing the strip.
 */
import { useEffect, useState } from 'react';
import { COPY } from '../../shared/copy';
import { Icon } from '../brand/Icon';
import { request, type PageTransport } from './request';

/** The strip, while `shown` (the panel's tab shows a Workday page) and the person has not closed it. */
export function WorkdayNote({ platform, shown }: { platform: PageTransport; shown: boolean }) {
  /** Whether the person closed it (null: not read yet; nothing shows until the worker says). */
  const [closed, setClosed] = useState<boolean | null>(null);
  useEffect(() => {
    if (!shown || closed !== null) return undefined;
    let live = true;
    void request(platform, { v: 1, type: 'panel/notes' }).then((answer) => {
      if (live) setClosed(answer.ok ? answer.data.closed.includes('workday') : false);
    });
    return () => {
      live = false;
    };
  }, [platform, shown, closed]);
  if (!shown || closed !== false) return null;
  return (
    <div className="tia-shellnote" role="status" data-panel-note="workday">
      <span className="tia-shellnote__text">{COPY.sidebar.workdayNote}</span>
      <button type="button" className="tia-shellnote__close" aria-label={COPY.sidebar.closeNote} title={COPY.sidebar.closeNote}
        data-action="close-note" onClick={() => {
          setClosed(true);
          void request(platform, { v: 1, type: 'panel/closeNote', note: 'workday' });
        }}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
