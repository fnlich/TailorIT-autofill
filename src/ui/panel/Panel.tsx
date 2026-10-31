/*
 * The review panel: the browser's side panel, and the report page (the same page opened as a tab with ?tabId=N, which
 * pins that tab). It follows a tab (tab.ts), shows its reports live (reports.ts) and mounts the report components.
 *
 * - Top: the connection (auth/status), then Fill, Dry run, Continue and Cancel (panel/fill {tabId, dryRun},
 *   panel/continue, panel/cancel), the run's status and step (the adapter's progress line where the report has one),
 *   and what the last button did.
 * - The report: the notices mirrored from the page (the tripwire's exact sentence, the policy card, the couldn't-read
 *   notice), then the rows. A run at policy-notice waits for its card: Fill anyway and Cancel send
 *   panel/policyDecision {tabId, frameId, decision} for the frame whose report is at policy-notice, which that frame
 *   treats exactly as its own card's buttons. The toolbar's Continue only resumes pauses: it never fills past a card.
 * - Per row: Show on page (panel/focus); opening a row asks for its suggested options (panel/describe), shown only while
 *   the row is open; Confirm draft on an AI draft that waits (panel/confirmDraft {tabId, frameId, fieldKey}); Save my
 *   answer on a flagged row the person fixed (panel/saveAnswer {tabId, frameId, fieldKey}); the panel says what came of
 *   each, and for an answer not saved, why (Phase 6, wave 2).
 *
 * It never shows or receives a field value: reports hold none, and describe's option labels stay in the open row.
 */
import { useEffect, useRef, useState } from 'react';
import type { Answer } from '../../messaging/envelope';
import type { PageMessage, SaveAnswerOutcome } from '../../messaging/schemas';
import type { PagePlatform } from '../../platform/types';
import { COPY } from '../../shared/copy';
import { request } from '../page/request';
import { useAuthStatus, type AuthState } from '../page/use-auth';
import { Report, RunStatusLine } from '../report/Report';
import { useTabReports, type LinkState } from './reports';
import { useFollowedTab } from './tab';

export interface PanelProps {
  platform: PagePlatform;
  /** The tab ?tabId=N pins (pinnedTabOf); null follows the active tab of the panel's window. */
  pinnedTabId: number | null;
  /** The clock (ms), for the reconnect limit. */
  now?: () => number;
}

type RunMessage = Extract<PageMessage, { type: 'panel/fill' | 'panel/continue' | 'panel/cancel' }>;
type DecisionMessage = Extract<PageMessage, { type: 'panel/policyDecision' }>;
type RowMessage = Extract<PageMessage, { type: 'panel/confirmDraft' | 'panel/saveAnswer' }>;

/** What a refusal means to the person. */
function refusalOf(error: Exclude<Answer<unknown>, { ok: true }>['error']): string {
  if (error === 'not_connected') return COPY.panel.needsConnection;
  if (error === 'rate_limited') return COPY.panel.rateLimited;
  if (error === 'unavailable') return COPY.panel.noAnswer;
  return COPY.panel.failed;
}

/** What a button's answer means to the person. */
function feedbackOf(message: RunMessage, answer: Answer<{ frames: number }>): string {
  if (answer.ok) {
    const frames = answer.data.frames;
    if (message.type === 'panel/fill') return message.dryRun ? COPY.panel.dryRunStarted(frames) : COPY.panel.started(frames);
    return message.type === 'panel/continue' ? COPY.panel.continued(frames) : COPY.panel.cancelled(frames);
  }
  return refusalOf(answer.error);
}

/** What a policy card's answer means: that one form fills or stops, or it no longer waits for the decision. */
function decisionFeedbackOf(message: DecisionMessage, answer: Answer<unknown>): string {
  if (answer.ok) return message.decision === 'fill' ? COPY.panel.started(1) : COPY.panel.cancelled(1);
  return answer.error === 'expired' ? COPY.panel.continued(0) : refusalOf(answer.error);
}

export function Panel({ platform, pinnedTabId, now = Date.now }: PanelProps) {
  const root = useRef<HTMLElement>(null);
  const tabId = useFollowedTab(platform, pinnedTabId);
  const { reports, link, reconnect } = useTabReports(platform, tabId, now);
  const auth = useAuthStatus(platform, root);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ tabId: number | null; text: string } | null>(null);
  const { refresh } = auth;

  // Another tab: the connection may have changed meanwhile (connected in the settings, say). The first tab needs no
  // second read: useAuthStatus has just made one.
  const lastTab = useRef<number | null>(null);
  useEffect(() => {
    if (tabId === null) return;
    const previous = lastTab.current;
    lastTab.current = tabId;
    if (previous !== null && previous !== tabId) refresh();
  }, [tabId, refresh]);

  const run = async (message: RunMessage) => {
    setBusy(true);
    const answer = await request(platform, message);
    setBusy(false);
    setFeedback({ tabId: message.tabId, text: feedbackOf(message, answer) });
    if (!answer.ok && answer.error === 'not_connected') refresh();
  };

  /** A policy card's decision, for the one frame whose run waits at it. */
  const decide = async (message: DecisionMessage) => {
    setBusy(true);
    const answer = await request(platform, message);
    setBusy(false);
    setFeedback({ tabId: message.tabId, text: decisionFeedbackOf(message, answer) });
  };

  /** A row's Confirm draft or Save my answer, for that frame's field: what came of it, and for an answer not saved,
   *  why (Phase 6, wave 2). */
  const act = async (message: RowMessage) => {
    setBusy(true);
    const answer = await request(platform, message);
    setBusy(false);
    let text: string;
    if (message.type === 'panel/confirmDraft') text = answer.ok ? COPY.panel.draftConfirmed : COPY.panel.confirmFailed;
    else if (answer.ok) text = COPY.panel.saveOutcomes[(answer.data as { outcome: SaveAnswerOutcome }).outcome];
    else text = answer.error === 'not_connected' ? COPY.panel.needsConnection : COPY.panel.saveFailed;
    setFeedback({ tabId: message.tabId, text });
  };

  const disabled = tabId === null || busy;

  return (
    <main className="tia-page tia-panel" ref={root} data-tab-id={tabId ?? undefined}>
      <header className="tia-panel__head">
        <h1 className="tia-panel__title">{COPY.panelTitle}</h1>
        <ConnectionLine auth={auth} settingsUrl={platform.runtime.getURL('/options.html')} />
      </header>
      <LinkProblem link={link} onReconnect={reconnect} />
      {tabId === null ? (
        <p className="tia-feedback">{COPY.panel.noTab}</p>
      ) : (
        <div className="tia-toolbar">
          <button type="button" className="tia-button tia-button--primary" disabled={disabled}
            onClick={() => void run({ v: 1, type: 'panel/fill', tabId, dryRun: false })}>{COPY.panel.fill}</button>
          <button type="button" className="tia-button" disabled={disabled}
            onClick={() => void run({ v: 1, type: 'panel/fill', tabId, dryRun: true })}>{COPY.panel.dryRun}</button>
          <button type="button" className="tia-button" disabled={disabled}
            onClick={() => void run({ v: 1, type: 'panel/continue', tabId })}>{COPY.panel.continue}</button>
          <button type="button" className="tia-button" disabled={disabled}
            onClick={() => void run({ v: 1, type: 'panel/cancel', tabId })}>{COPY.panel.cancel}</button>
        </div>
      )}
      <RunStatusLine reports={reports} />
      {feedback !== null && feedback.tabId === tabId && <p className="tia-feedback" role="status">{feedback.text}</p>}
      {tabId !== null && (
        <Report
          reports={reports}
          busy={busy}
          onPolicyDecision={(frameId, decision) =>
            void decide({ v: 1, type: 'panel/policyDecision', tabId, frameId, decision })}
          onShowField={(frameId, fieldKey) => {
            void request(platform, { v: 1, type: 'panel/focus', tabId, frameId, fieldKey }).then((answer) => {
              if (!answer.ok) setFeedback({ tabId, text: COPY.panel.focusFailed });
            });
          }}
          describeField={async (frameId, fieldKey) => {
            const answer = await request(platform, { v: 1, type: 'panel/describe', tabId, frameId, fieldKey });
            return answer.ok ? answer.data.options : null;
          }}
          onConfirmDraft={(frameId, fieldKey) => void act({ v: 1, type: 'panel/confirmDraft', tabId, frameId, fieldKey })}
          onSaveAnswer={(frameId, fieldKey) => void act({ v: 1, type: 'panel/saveAnswer', tabId, frameId, fieldKey })}
        />
      )}
    </main>
  );
}

/** "Connected as …", or why filling cannot work, with a link to the settings. */
function ConnectionLine({ auth, settingsUrl }: { auth: AuthState; settingsUrl: string }) {
  const { status } = auth;
  if (status === null) return auth.failed ? <p className="tia-connection tia-connection--problem">{COPY.panel.noAnswer}</p> : null;
  const settings = <a href={settingsUrl} target="_blank" rel="noreferrer">{COPY.panel.openSettings}</a>;
  const problems: string[] = [];
  if (status.storageAccess === 'refused') problems.push(COPY.panel.storageRefused);
  if (status.versionMismatch) problems.push(COPY.panel.versionMismatch);
  if (status.connection !== 'connected') {
    problems.unshift(status.connection === 'expired' ? COPY.panel.expired
      : status.connection === 'revoked' ? COPY.panel.revoked : COPY.panel.notConnected);
  }
  if (problems.length > 0) {
    return (
      <p className="tia-connection tia-connection--problem" data-connection={status.connection}>
        {problems.join(' ')} {settings}
      </p>
    );
  }
  return (
    <p className="tia-connection" data-connection={status.connection}>
      {status.account ? COPY.panel.connectedAs(status.account.name) : COPY.panel.connected}
    </p>
  );
}

/** Shown only when the live link is down: after too many drops (with a Reconnect button), or for good. */
function LinkProblem({ link, onReconnect }: { link: LinkState; onReconnect: () => void }) {
  if (link === 'live') return null;
  if (link === 'gone') return <p className="tia-problem" role="alert">{COPY.panel.extensionGone}</p>;
  return (
    <p className="tia-problem" role="alert">
      {COPY.panel.linkLost}{' '}
      <button type="button" className="tia-button" onClick={onReconnect}>{COPY.panel.reconnect}</button>
    </p>
  );
}
