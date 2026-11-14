/*
 * v1.5 QX (PLAN decisions 7 and 9; the owner's words of 2026-11-10: "Queue should include current status(progressbar
 * with x out of y), current left seconds as text, start(stop), resume(pause) buttons. and list of every job status"):
 * the panel's Queue tab, in the sidebar and in Chrome's side panel alike.
 * - A card: its heading with a "?" saying what Start does with the settings as they act now; the progress bar, "x of y"
 *   jobs no longer waiting; the line under it ("Next tab in 8.5s", live on animation frames; or why the timer waits,
 *   paused, done, stopped and why); the counts past Opening; Start or Stop, and Pause or Resume. Each control takes a
 *   click only once what it says has been shown CONTROL_SEEN_MS (seen.ts: a page cannot swap Start in under the
 *   pointer), and Pause or Resume only while the queue runs or is paused.
 * - Lines for what the person should know: Run auto-apply on (Start turns it off), turned off by Start, why the queue
 *   cannot start (not connected, an old connection, the notice to acknowledge), a result not yet told TailorIT.
 * - The list of every job: its title, company and status chip (with why it was skipped or failed); a row whose tab is
 *   open is a button that brings that tab to the front (queue/focus). A page at a time (QUEUE_LIST_PAGE), with Show
 *   More, so thousands of jobs never draw at once.
 * - Empty (nothing queued), disconnected and error states, each saying what to do.
 * It shows only what the worker answers: titles and companies as TailorIT named them, statuses and counts. No address.
 * v2.0 P9 (autofill API 8): a run stopped by TailorIT's daily auto-apply limit says so in TailorIT's own words.
 */
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import type { QueueListItem, QueueStatus } from '../../messaging/schemas';
import { QUEUE_LIST_PAGE } from '../../messaging/page-schemas';
import type { PagePlatform } from '../../platform/types';
import { COPY } from '../../shared/copy';
import { Icon } from '../brand/Icon';
import { API8_COPY } from '../options/copy-api8'; // v2.0 P9
import { AUTO_APPLY_URL } from '../page/agent';
import { HelpTip } from '../page/HelpTip';
import { request } from '../page/request';
import { useShownFor, type SeenClock } from './seen';

const WORDS = COPY.queue;

/** A status chip's tone. */
const TONES: Readonly<Record<QueueListItem['status'], string>> = {
  queued: 'neutral', opening: 'info', opened: 'info', filling: 'brand', ready: 'warning', submitted: 'success',
  skipped: 'neutral', failed: 'danger',
};

/** The ms left until `base.ms` from when it was read (`base.at` on the clock), repainted on each frame while above zero
 *  and only when the shown tenth changes. */
function useMsLeft(base: { ms: number; at: number } | null, clock: SeenClock): number | null {
  const [left, setLeft] = useState<{ base: { ms: number; at: number }; ms: number } | null>(null);
  const read = useEffectEvent(() => clock.now());
  useEffect(() => {
    if (base === null) return undefined;
    let cancel: (() => void) | null = null;
    const tick = () => {
      const ms = Math.max(0, base.ms - (read() - base.at));
      const tenth = Math.ceil(ms / 100);
      setLeft((previous) => (previous?.base === base && Math.ceil(previous.ms / 100) === tenth ? previous : { base, ms }));
      cancel = ms > 0 ? clock.frames(tick) : null;
    };
    tick();
    return () => cancel?.();
  }, [base, clock]);
  return base !== null && left?.base === base ? left.ms : base?.ms ?? null;
}

/** The queue's status, read at the start, at each change the worker announces, and after each control. */
function useQueueStatus(platform: PagePlatform, changes: number, clock: SeenClock) {
  const [state, setState] = useState<{ status: QueueStatus; at: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);
  const accept = useCallback((status: QueueStatus) => {
    latest.current += 1;
    setFailed(false);
    setState({ status, at: clock.now() });
  }, [clock]);
  const refresh = useCallback(() => {
    latest.current += 1;
    const ask = latest.current;
    void request(platform, { v: 1, type: 'queue/status' }).then((answer) => {
      if (ask !== latest.current) return;
      if (answer.ok) setState({ status: answer.data, at: clock.now() });
      setFailed(!answer.ok);
    });
  }, [platform, clock]);
  useEffect(() => {
    refresh();
  }, [refresh, changes]);
  return { state, failed, refresh, accept };
}

/** The jobs listed, a page at a time, read again at each change. */
function useQueueList(platform: PagePlatform, changes: number) {
  const [pages, setPages] = useState(1);
  const [list, setList] = useState<{ items: QueueListItem[]; total: number; more: boolean; source: 'run' | 'queue' } | null>(
    null);
  const [error, setError] = useState<'not-connected' | 'failed' | null>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let live = true;
    void (async () => {
      const items: QueueListItem[] = [];
      let last: { total: number; more: boolean; source: 'run' | 'queue' } | null = null;
      for (let page = 0; page < pages; page += 1) {
        const answer = await request(platform, { v: 1, type: 'queue/list', offset: page * QUEUE_LIST_PAGE });
        if (!live) return;
        if (!answer.ok) {
          setError(answer.error === 'not_connected' ? 'not-connected' : 'failed');
          return;
        }
        items.push(...answer.data.items);
        last = { total: answer.data.total, more: answer.data.more, source: answer.data.source };
        if (!answer.data.more) break;
      }
      if (last !== null) {
        setError(null);
        setList({ items, ...last });
      }
    })();
    return () => {
      live = false;
    };
  }, [platform, changes, pages, tries]);
  return { list, error, more: () => setPages((count) => count + 1), retry: () => setTries((count) => count + 1) };
}

export interface QueueViewProps {
  platform: PagePlatform;
  /** Counts of the worker's changes that may move the queue (its own, the connection's, the settings'). */
  changes: number;
  clock: SeenClock;
  /** The tab panel's id and the tab that labels it (TabBar.tsx tabIds). */
  id: string;
  labelledBy: string;
}

export function QueueView({ platform, changes, clock, id, labelledBy }: QueueViewProps) {
  const { state, failed, refresh, accept } = useQueueStatus(platform, changes, clock);
  const { list, error, more, retry } = useQueueList(platform, changes);
  const [busy, setBusy] = useState(false);
  const status = state?.status ?? null;
  const nextMs = status !== null && status.phase === 'running' && status.hold === null ? status.nextInMs : null;
  const readAt = state?.at ?? null;
  // A new base only when an answer changes it (the countdown restarts from it).
  const countdown = useMemo(() => (nextMs === null || readAt === null ? null : { ms: nextMs, at: readAt }), [nextMs, readAt]);
  const msLeft = useMsLeft(countdown, clock);

  const control = (type: 'queue/start' | 'queue/stop' | 'queue/pause' | 'queue/resume') => {
    setBusy(true);
    void request(platform, { v: 1, type }).then((answer) => {
      setBusy(false);
      if (answer.ok) accept(answer.data);
      else refresh();
      retry();
    });
  };
  const focus = (item: QueueListItem) => {
    void request(platform, { v: 1, type: 'queue/focus', id: item.id });
  };

  if (status === null) {
    return (
      <section className="tia-queue" role="tabpanel" id={id} aria-labelledby={labelledBy} data-queue="loading">
        <p className={failed ? 'tia-strip' : 'tia-note'} data-tone={failed ? 'problem' : undefined} role="status">
          {failed ? WORDS.readFailed : COPY.settingsView.loading}
        </p>
      </section>
    );
  }

  const disconnected = status.blocked === 'not-connected' || error === 'not-connected';
  const running = status.phase === 'running';
  const active = running || status.phase === 'paused';
  const total = status.phase === 'idle' ? list?.source === 'queue' ? list.total : 0 : status.total;
  const opened = status.phase === 'idle' ? 0 : status.opened;
  const line = lineOf(status, msLeft, total);
  const counts = WORDS.counts(status.counts);

  return (
    <section className="tia-queue" role="tabpanel" id={id} aria-labelledby={labelledBy} data-queue={status.phase}>
      <div className="tia-queue__card">
        <div className="tia-queue__head">
          <h2 className="tia-queue__title">{WORDS.heading}</h2>
          <HelpTip text={WORDS.startHelp(status.autofillOnOpen, status.submit)} topic={WORDS.heading} />
        </div>
        <div className="tia-queue__progress">
          <div className="tia-progressbar" role="progressbar" aria-label={WORDS.progressLabel} aria-valuemin={0}
            aria-valuemax={Math.max(total, 1)} aria-valuenow={opened} aria-valuetext={WORDS.progress(opened, total)}>
            <span className="tia-progressbar__fill" style={{ width: `${total === 0 ? 0 : Math.round((opened / total) * 100)}%` }} />
          </div>
          <span className="tia-queue__count" data-queue-progress="">{WORDS.progress(opened, total)}</span>
        </div>
        {line !== null && (
          <p className="tia-queue__line" data-queue-line={status.hold ?? status.phase}
            data-queue-next={countdown === null ? undefined : ''} aria-live="off">{line}</p>
        )}
        {counts !== '' && <p className="tia-queue__counts" data-queue-counts="">{counts}</p>}
        {!disconnected && (
          <div className="tia-queue__controls">
            <QueueButton kind={active ? 'stop' : 'start'} clock={clock}
              disabled={busy || (!active && (status.blocked !== null || (status.phase === 'idle' && total === 0)))}
              onPress={() => control(active ? 'queue/stop' : 'queue/start')} />
            <QueueButton kind={status.phase === 'paused' ? 'resume' : 'pause'} clock={clock} disabled={busy || !active}
              onPress={() => control(status.phase === 'paused' ? 'queue/resume' : 'queue/pause')} />
          </div>
        )}
        {/* For a screen reader: the phase and the progress, which change seldom (never the seconds). */}
        <p className="tia-visually-hidden" role="status" data-queue-status="">
          {WORDS.live(status.phase, opened, total)}
        </p>
        {status.agentOn && !active && <p className="tia-queue__note" data-queue-note="agent-on">{WORDS.agentOn}</p>}
        {status.agentStopped && <p className="tia-queue__note" data-queue-note="agent-stopped">{WORDS.agentStopped}</p>}
        {status.blocked !== null && (
          <p className="tia-queue__note" data-tone="warning" data-queue-note="blocked">{WORDS.blocked[status.blocked]}</p>
        )}
        {status.pending && <p className="tia-queue__note" data-queue-note="pending">{WORDS.pending}</p>}
      </div>
      {disconnected ? null : error === 'failed' ? (
        <div className="tia-queue__empty" data-queue-empty="error">
          <p>{WORDS.readFailed}</p>
          <button type="button" className="tia-button" data-action="queue-retry" onClick={retry}>{WORDS.tryAgain}</button>
        </div>
      ) : list !== null && list.items.length === 0 ? (
        <div className="tia-queue__empty" data-queue-empty="">
          <p>{WORDS.empty}</p>
          <a href={AUTO_APPLY_URL} target="_blank" rel="noreferrer" data-tailorit-link="auto-apply">{WORDS.open}</a>
        </div>
      ) : list !== null && (
        <>
          <ul className="tia-queue__list" aria-label={WORDS.listLabel} data-queue-list={list.source}>
            {list.items.map((item) => <QueueRow key={item.id} item={item} onFocus={() => focus(item)} />)}
          </ul>
          {list.more && (
            <button type="button" className="tia-button tia-queue__more" data-action="queue-more" onClick={more}>
              {WORDS.more}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/** The line under the bar: the seconds left, why the timer waits, or where the run stands. */
function lineOf(status: QueueStatus, msLeft: number | null, total: number): string | null {
  switch (status.phase) {
    case 'idle':
      return status.blocked !== null ? null : WORDS.idle(total);
    case 'running':
      if (status.hold === 'cap') return WORDS.held.cap(status.openTabs, status.nextInMs ?? 0);
      if (status.hold === 'offline') return WORDS.held.offline;
      if (status.hold === 'server') return WORDS.held.server(msLeft ?? status.nextInMs ?? 0);
      if (msLeft !== null) return WORDS.next(msLeft);
      return WORDS.allOpened(status.openTabs);
    case 'paused':
      return WORDS.paused(status.nextInMs);
    case 'finished':
      return WORDS.finished;
    case 'stopped':
      // v2.0 P9 (API 8): TailorIT's daily auto-apply limit, in its own words.
      if (status.stoppedBy === 'daily-limit') {
        return status.limit?.message ?? API8_COPY.limitReached(status.limit?.resetsAt ?? null);
      }
      return status.stoppedBy === null ? WORDS.stopped.person : WORDS.stopped[status.stoppedBy];
  }
}

/** Start, Stop, Pause or Resume: a click counts only once what it says has been shown CONTROL_SEEN_MS. */
function QueueButton({ kind, clock, disabled, onPress }: { kind: 'start' | 'stop' | 'pause' | 'resume'; clock: SeenClock;
  disabled: boolean; onPress(): void }) {
  const seen = useShownFor(kind, clock);
  const icon = kind === 'start' || kind === 'resume' ? 'play' : kind;
  return (
    <button type="button" className={`tia-queue__control tia-queue__control--${kind}`} disabled={disabled || !seen}
      data-action={`queue-${kind}`} onClick={() => {
        // Decided at the click, on what this render shows: a control not yet shown long enough is never pressed.
        if (seen && !disabled) onPress();
      }}>
      <Icon name={icon} size={16} className="tia-icon" />
      {WORDS[kind]}
    </button>
  );
}

/** One job: its title, company and status chip; a button to its tab while one is open. */
function QueueRow({ item, onFocus }: { item: QueueListItem; onFocus(): void }) {
  const status = WORDS.statuses[item.status];
  const why = item.reason !== null && (item.status === 'skipped' || item.status === 'failed') ? WORDS.reasons[item.reason]
    // jr7 AUTO-7 (ICIMS7-04): why a job Ready for you rests with the person, in the extension's words.
    : item.note !== undefined ? WORDS.notes[item.note] : null;
  // jr7 AUTO-7 (AUTO7-01, D-4): the job's Submit is the person's on its site, whatever Submit is set to.
  const yours = item.submitYours === true ? WORDS.submitYours : null;
  const body = (
    <>
      <span className="tia-queue__job">
        <span className="tia-queue__jobtitle">{item.title}</span>
        {item.company !== '' && <span className="tia-queue__company">{item.company}</span>}
        {why !== null && <span className="tia-queue__why">{why}</span>}
        {yours !== null && <span className="tia-queue__why" data-queue-submit="yours">{yours}</span>}
      </span>
      <span className="tia-chip tia-queue__chip" data-tone={TONES[item.status]}>{status}</span>
    </>
  );
  return (
    <li className="tia-queue__row" data-queue-row={item.status}>
      {item.tab ? (
        <button type="button" className="tia-queue__item" data-action="queue-focus"
          aria-label={WORDS.row(item.title, item.company, [status, why, yours].filter((part) => part !== null).join(', '),
            true)}
          onClick={onFocus}>
          {body}
        </button>
      ) : <div className="tia-queue__item">{body}</div>}
    </li>
  );
}
