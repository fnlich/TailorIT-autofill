/*
 * The side panel's job card, as data (v2): panel/job for the followed tab, read whenever what it depends on changes,
 * and only then. No timer, no focus or visibility read: the panel never wakes a stopped worker on its own.
 *
 * The read key is the tab, the form frame's document (the page state's formKey), the connection (its expiry: every new
 * token has a new one), the tab's runs (so the card the fill's own lookup left is shown once a fill starts) and a count
 * the panel bumps after Add, Save or Change. An answer counts only while its key is still current. A change of tab,
 * document or connection shows the loading card at once, so a card is never shown under another page or another
 * connection (the v2 review, M2); a change of runs or a bump keeps the card on show until the new answer lands. A null
 * card hides it; a refusal shows "unavailable", so a loading card always ends.
 *
 * TailorIT is asked only when the tab shows a form of ours and the extension is connected; the worker answers from its
 * memory when it holds the card, and through the form frame otherwise.
 */
import { useCallback, useEffect, useState } from 'react';
import type { JobCard, PageState } from '../../messaging/schemas';
import type { PagePlatform } from '../../platform/types';
import type { FrameReport } from '../../shared/report';
import { request } from '../page/request';

/** What the card shows: nothing, a card that asks to connect, a loading card, or the worker's card. */
export type JobView =
  | { state: 'hidden' }
  | { state: 'disconnected' }
  | { state: 'loading' }
  | { state: 'shown'; card: JobCard };

/** The tab's runs, as the read key holds them. */
export function runsKeyOf(reports: readonly FrameReport[]): string {
  return reports.map((report) => `${report.frameId}:${report.runId}`).sort().join(',');
}

/**
 * The card of `tabId`'s form. `connection` is undefined while the connection is unknown, null when not connected, and
 * otherwise a string that changes with the token (its expiry).
 */
export function useTabJob(platform: PagePlatform, tabId: number | null, options: {
  page: PageState | null;
  connection: string | null | undefined;
  reports: readonly FrameReport[];
}): { view: JobView; reload(): void } {
  const [bump, setBump] = useState(0);
  const [answer, setAnswer] = useState<{ base: string; key: string; view: JobView } | null>(null);
  const { page, connection } = options;
  const form = tabId !== null && page !== null && page.support === 'form';
  const runs = runsKeyOf(options.reports);
  const base = form && typeof connection === 'string' ? `${tabId}|${page.formKey ?? ''}|${connection}` : null;
  const key = base === null ? null : `${base}|${runs}|${bump}`;

  useEffect(() => {
    if (key === null || base === null || tabId === null) return undefined;
    let live = true;
    void request(platform, { v: 1, type: 'panel/job', tabId }).then((reply) => {
      if (!live) return;
      let view: JobView;
      if (!reply.ok) view = { state: 'shown', card: { state: 'unavailable' } };
      else if (reply.data.tabId !== tabId) return;
      else view = reply.data.card === null ? { state: 'hidden' } : { state: 'shown', card: reply.data.card };
      setAnswer({ base, key, view });
    });
    return () => {
      live = false;
    };
  }, [platform, tabId, base, key]);

  const reload = useCallback(() => setBump((count) => count + 1), []);
  if (!form) return { view: { state: 'hidden' }, reload };
  if (connection === undefined) return { view: { state: 'hidden' }, reload };
  if (connection === null) return { view: { state: 'disconnected' }, reload };
  // The answer for this very key; else, while the same tab, page and connection read again, the card already shown.
  if (answer !== null && answer.key === key) return { view: answer.view, reload };
  if (answer !== null && answer.base === base && answer.view.state === 'shown') return { view: answer.view, reload };
  return { view: { state: 'loading' }, reload };
}
