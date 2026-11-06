/*
 * The job card's cover-letter row, as data (Phase G): what TailorIT says of the person's letter for the tab's job
 * (panel/letter {write: false}: nothing is written), and Write it now (panel/letter {write: true}). States only: the
 * worker never sends a letter's id or a word of it.
 *
 * It asks once per read key: the tab, the form's document, the connection, the job the card names (the audit's m8: a
 * job chosen with "Autofill for another job" has its own letter) and the resume the card attaches (a Change asks
 * again), and only while the card has answered. A row of the tab's report that attached a letter says more than
 * an earlier answer (the fill's own: the person's letter, or one TailorIT's AI wrote and they never edited). Write it
 * now's outcome is kept for its key, so the row says Ready or Couldn't write it until the key moves.
 */
import { useCallback, useEffect, useState } from 'react';
import type { JobCard, LetterOutcome } from '../../messaging/schemas';
import type { PagePlatform } from '../../platform/types';
import type { FrameReport } from '../../shared/report';
import { request } from '../page/request';

/** What the row shows. */
export interface LetterView {
  /** What TailorIT said of the person's letter for this job (or a fill attached); null before it answered, or when it
   *  could not say. */
  outcome: LetterOutcome | null;
  /** The first ask is on its way. */
  checking: boolean;
  /** Write it now is on its way. */
  writing: boolean;
  /** What the last Write it now gave for this key; null when none was pressed. */
  wrote: LetterOutcome | null;
}

/** What the tab's reports say a fill attached: the person's letter, or one TailorIT's AI wrote; null for neither. */
export function attachedLetter(reports: readonly FrameReport[]): LetterOutcome | null {
  const rows = reports.flatMap((report) => report.fields)
    .filter((row) => row.category === 'file.coverLetter' && row.wrote && row.status === 'verified');
  if (rows.some((row) => row.reason === 'cover-letter-written')) return 'written';
  return rows.some((row) => row.reason === 'cover-letter-attached') ? 'yours' : null;
}

/**
 * The row of `tabId`'s card. `base` is the card's read key (tab, document, connection; null while there is no card to
 * read), `card` the card shown.
 */
export function useTabLetter(platform: PagePlatform, tabId: number | null, options: {
  base: string | null;
  card: JobCard | null;
  reports: readonly FrameReport[];
}): { view: LetterView; write(): void } {
  const { base, card } = options;
  const answered = card !== null && card.state === 'answered' ? card : null;
  const key = tabId === null || base === null || answered === null ? null
    : JSON.stringify([base, answered.job?.title ?? null, answered.job?.company ?? null, answered.chosen === true,
      answered.resume?.label ?? '', answered.resume?.reason ?? '']);
  const [answer, setAnswer] = useState<{ key: string; outcome: LetterOutcome | null } | null>(null);
  const [written, setWritten] = useState<{ key: string; busy: boolean; outcome: LetterOutcome | null } | null>(null);

  useEffect(() => {
    if (key === null || tabId === null) return undefined;
    let live = true;
    void request(platform, { v: 1, type: 'panel/letter', tabId, write: false }).then((reply) => {
      if (live) setAnswer({ key, outcome: reply.ok ? reply.data.outcome : null });
    });
    return () => {
      live = false;
    };
  }, [platform, tabId, key]);

  const write = useCallback(() => {
    if (key === null || tabId === null) return;
    setWritten({ key, busy: true, outcome: null });
    void request(platform, { v: 1, type: 'panel/letter', tabId, write: true }).then((reply) => {
      const outcome: LetterOutcome = reply.ok ? reply.data.outcome
        : reply.error === 'not_connected' ? 'not-connected' : reply.error === 'rate_limited' ? 'rate-limited' : 'unavailable';
      setWritten((now) => (now?.key === key ? { key, busy: false, outcome } : now));
    });
  }, [platform, tabId, key]);

  const mine = written !== null && written.key === key ? written : null;
  const asked = answer !== null && answer.key === key ? answer : null;
  const fromWrite = mine !== null && (mine.outcome === 'written' || mine.outcome === 'yours') ? mine.outcome : null;
  const outcome = attachedLetter(options.reports) ?? fromWrite ?? asked?.outcome ?? null;
  return {
    view: { outcome, checking: key !== null && asked === null, writing: mine?.busy === true,
      wrote: mine === null || mine.busy ? null : mine.outcome },
    write,
  };
}
