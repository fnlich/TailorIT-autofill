/*
 * The review panel: the browser's side panel, and the report page (the same page opened as a tab with ?tabId=N, which
 * pins that tab). It follows a tab (tab.ts), shows its reports live (reports.ts) and mounts the report components, in
 * TailorIT's look: a column on TailorIT's canvas, top to bottom:
 *
 * - The brand (TailorIT's mark and "TailorIT Autofill") and a gear to the extension's settings; the connection
 *   (auth/status: "Connected as …", or why filling cannot work, as a problem strip with a link to the settings).
 * - One strip saying where the tab stands: the run's status and step (the adapter's progress line where the report has
 *   one), toned by what it waits for; before any run, what the tab's page holds (v2: "Lever application form found",
 *   no form on this page, or none of ours); or that there is no tab to follow.
 * - The notices mirrored from the page (the tripwire's exact sentence, the policy card, the couldn't-read notice), above
 *   the main button, so a decision is seen before anything else. A run at policy-notice waits for its card: Fill
 *   anyway and Cancel send panel/policyDecision {tabId, frameId, decision} for the frame whose report is at
 *   policy-notice, which that frame treats exactly as its own card's buttons. The toolbar's Continue only resumes
 *   pauses: it never fills past a card.
 * - The job card (v2, JobCard.tsx and job.ts): what TailorIT knows of the job in the tab's form, read through the
 *   worker (panel/job) only while the tab shows a form of ours and the extension is connected; Add this job to TailorIT
 *   and Save to tracker (panel/addJob), and Change, which lists the account's resumes (panel/resumes) and keeps the
 *   choice for the tab (panel/setResume). In a dry run the resume "Would attach".
 * - Autofill (panel/fill {tabId, dryRun: false}), its label constant, with a spinner while its request is out or a run
 *   works; then Dry run, Continue and Cancel (panel/fill {dryRun: true}, panel/continue, panel/cancel), Continue marked
 *   while a run waits for the person and Cancel while one works; then what the last button did, until a newer report
 *   tells more.
 * - Ask a custom question (v2, Ask.tsx; panel/ask), answered from the tab's active resume.
 * - "Review": the report, its completion and then its rows. Per row: Show on page (panel/focus); opening a row asks for
 *   its suggested options (panel/describe), shown only while the row is open; Confirm draft on an AI draft that waits
 *   (panel/confirmDraft {tabId, frameId, fieldKey}); Save my answer on a flagged row the person fixed
 *   (panel/saveAnswer {tabId, frameId, fieldKey}); the panel says what came of each, and for an answer not saved, why
 *   (Phase 6, wave 2).
 * - Links to the person's TailorIT: their autofill information (Settings › Autofill) and their jobs.
 *
 * It never shows or receives a field value: reports hold none, and describe's option labels stay in the open row. The
 * job card draws only what TailorIT's lookup said, the resume's title among it (which may be the person's name: it is
 * shown on purpose, as the resume the fill attaches); the custom question's answer is the person's own request.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { Answer } from '../../messaging/envelope';
import type { AddJobOutcome, AskLength, PageMessage, PageState, SaveAnswerOutcome } from '../../messaging/schemas';
import type { PagePlatform } from '../../platform/types';
import { COPY } from '../../shared/copy';
import { Brand } from '../brand/Logo';
import { Icon } from '../brand/Icon';
import { request } from '../page/request';
import { useAuthStatus, type AuthState } from '../page/use-auth';
import { overallStatus, WORKING_STATUSES } from '../report/model';
import { Report, ReportNotices, RunStatusLine } from '../report/Report';
import { AskQuestion } from './Ask';
import { useTabJob } from './job';
import { JobCard } from './JobCard';
import { useTabReports, type LinkState } from './reports';
import { useFollowedTab } from './tab';

export interface PanelProps {
  platform: PagePlatform;
  /** The tab ?tabId=N pins (pinnedTabOf); null follows the active tab of the panel's window. */
  pinnedTabId: number | null;
  /** The clock (ms), for the reconnect limit and the card's "Posted 2 days ago". */
  now?: () => number;
  /** Puts text on the clipboard (the custom answer's Copy); the browser's by default. */
  copyText?: (text: string) => Promise<boolean>;
}

/** The browser's clipboard: false when it would not take the text. */
async function clipboardCopy(text: string): Promise<boolean> {
  try {
    await globalThis.navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

type RunMessage = Extract<PageMessage, { type: 'panel/fill' | 'panel/continue' | 'panel/cancel' }>;
type DecisionMessage = Extract<PageMessage, { type: 'panel/policyDecision' }>;
type RowMessage = Extract<PageMessage, { type: 'panel/confirmDraft' | 'panel/saveAnswer' }>;

/** The person's TailorIT (the build's origin): where their autofill information and their jobs live. */
const TAILORIT_LINKS = {
  autofillInfo: `${__TAILORIT_ORIGIN__}/settings/autofill`,
  jobs: `${__TAILORIT_ORIGIN__}/jobs`,
} as const;

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

export function Panel({ platform, pinnedTabId, now = Date.now, copyText = clipboardCopy }: PanelProps) {
  const root = useRef<HTMLElement>(null);
  const dashboardId = useId();
  const tabId = useFollowedTab(platform, pinnedTabId);
  const { reports, page, link, reconnect } = useTabReports(platform, tabId, now);
  const auth = useAuthStatus(platform, root);
  const [busy, setBusy] = useState(false);
  /** What the last button did. A run button's line holds only until a report newer than its click arrives (`newest`:
   *  the newest report's time at the click), which says more (the Phase F1 review, 7); a row action's stays. */
  const [feedback, setFeedback] = useState<{ tabId: number | null; text: string; newest: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<{ tabId: number; outcome: AddJobOutcome } | null>(null);
  const { refresh } = auth;
  const connection = auth.status === null ? undefined
    : auth.status.connection === 'connected' ? String(auth.status.expiresAt ?? 0) : null;
  const job = useTabJob(platform, tabId, { page, connection, reports });
  const newestReport = Math.max(0, ...reports.map((report) => report.updatedAt));
  const settingsUrl = platform.runtime.getURL('/options.html');

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
    const newest = newestReport;
    setBusy(true);
    const answer = await request(platform, message);
    setBusy(false);
    setFeedback({ tabId: message.tabId, text: feedbackOf(message, answer), newest });
    if (!answer.ok && answer.error === 'not_connected') refresh();
  };

  /** A policy card's decision, for the one frame whose run waits at it. */
  const decide = async (message: DecisionMessage) => {
    const newest = newestReport;
    setBusy(true);
    const answer = await request(platform, message);
    setBusy(false);
    setFeedback({ tabId: message.tabId, text: decisionFeedbackOf(message, answer), newest });
  };

  /** Add this job to TailorIT, or Save to tracker: what came of it, then the card read again. */
  const addJob = async (target: number) => {
    setAdding(true);
    const answer = await request(platform, { v: 1, type: 'panel/addJob', tabId: target });
    setAdding(false);
    setAdded({ tabId: target, outcome: answer.ok ? answer.data.outcome
      : answer.error === 'not_connected' ? 'not-connected' : 'unavailable' });
    job.reload();
  };

  /** The resume chosen with Change (null: TailorIT's own choice again): kept for the tab, then the card read again. */
  const chooseResume = (target: number, resumeId: string | null) => {
    setAdded(null);
    void request(platform, { v: 1, type: 'panel/setResume', tabId: target, resumeId }).then(() => job.reload());
  };

  const ask = (target: number, question: string, length: AskLength) =>
    request(platform, { v: 1, type: 'panel/ask', tabId: target, question, length });

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
    setFeedback({ tabId: message.tabId, text, newest: Number.POSITIVE_INFINITY });
  };

  const disabled = tabId === null || busy;
  const status = overallStatus(reports);
  const working = status !== null && WORKING_STATUSES.has(status);
  const shownFeedback = feedback !== null && feedback.tabId === tabId && newestReport <= feedback.newest ? feedback : null;
  const dryRun = reports.length > 0 && reports.every((report) => report.mode === 'dry-run');
  const card = job.view.state === 'shown' ? job.view.card : null;
  const policy = reports.some((report) => report.status === 'policy-notice'
    || report.notices.some((notice) => notice.code === 'policy'));

  return (
    <main className="tia-page tia-panel" ref={root} data-tab-id={tabId ?? undefined}>
      <header className="tia-panel__head">
        <h1 className="tia-brand"><Brand markSize={28} large /></h1>
        <a className="tia-iconlink" href={settingsUrl} target="_blank" rel="noreferrer" aria-label={COPY.panel.settings}
          title={COPY.panel.settings} data-open-settings="">
          <Icon name="gear" size={18} />
        </a>
      </header>
      <ConnectionLine auth={auth} settingsUrl={settingsUrl} />
      <LinkProblem link={link} onReconnect={reconnect} />
      {tabId === null ? (
        <p className="tia-strip" data-strip="no-tab" data-tone="neutral">{COPY.panel.noTab}</p>
      ) : reports.length > 0 ? (
        <RunStatusLine reports={reports} />
      ) : (
        <PageStrip page={page} />
      )}
      {tabId !== null && (
        <ReportNotices reports={reports} busy={busy}
          onPolicyDecision={(frameId, decision) => void decide({ v: 1, type: 'panel/policyDecision', tabId, frameId, decision })} />
      )}
      {tabId !== null && (
        <JobCard view={job.view} platform={page?.platform ?? null} dryRun={dryRun} adding={adding}
          outcome={added !== null && added.tabId === tabId ? added.outcome : null} now={now()}
          onAdd={() => void addJob(tabId)}
          loadResumes={async () => {
            const answer = await request(platform, { v: 1, type: 'panel/resumes', tabId });
            return answer.ok ? answer.data.items : null;
          }}
          chooseResume={(resumeId) => chooseResume(tabId, resumeId)} />
      )}
      {tabId !== null && (
        <div className="tia-toolbar">
          <button type="button" className="tia-cta" disabled={disabled} data-working={busy || working ? 'true' : undefined}
            onClick={() => void run({ v: 1, type: 'panel/fill', tabId, dryRun: false })}>
            {(busy || working) && <Icon name="spinner" size={20} className="tia-icon tia-spin" />}
            {COPY.panel.fill}
          </button>
          <div className="tia-toolbar__more">
            <button type="button" className="tia-button" disabled={disabled}
              onClick={() => void run({ v: 1, type: 'panel/fill', tabId, dryRun: true })}>{COPY.panel.dryRun}</button>
            <button type="button" className="tia-button" disabled={disabled}
              data-emphasis={status === 'handoff' || status === 'auth-needed' ? '' : undefined}
              onClick={() => void run({ v: 1, type: 'panel/continue', tabId })}>{COPY.panel.continue}</button>
            <button type="button" className="tia-button" disabled={disabled} data-emphasis={working ? '' : undefined}
              onClick={() => void run({ v: 1, type: 'panel/cancel', tabId })}>{COPY.panel.cancel}</button>
          </div>
        </div>
      )}
      {shownFeedback !== null && <p className="tia-feedback" role="status">{shownFeedback.text}</p>}
      {tabId !== null && (
        <AskQuestion key={tabId} ask={(question, length) => ask(tabId, question, length)} copy={copyText}
          connected={connection !== undefined && connection !== null}
          noResume={card !== null && card.state === 'answered' && card.resume === null} policy={policy} />
      )}
      <section className="tia-dashboard" aria-labelledby={dashboardId}>
        <h2 className="tia-dashboard__title" id={dashboardId}>{COPY.panelTitle}</h2>
        {tabId !== null && (
          <Report
            reports={reports}
            notices={false}
            busy={busy}
            onShowField={(frameId, fieldKey) => {
              void request(platform, { v: 1, type: 'panel/focus', tabId, frameId, fieldKey }).then((answer) => {
                if (!answer.ok) setFeedback({ tabId, text: COPY.panel.focusFailed, newest: Number.POSITIVE_INFINITY });
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
      </section>
      <p className="tia-links">
        <a href={TAILORIT_LINKS.autofillInfo} target="_blank" rel="noreferrer" data-tailorit-link="autofill">
          {COPY.panel.autofillInfo}
        </a>
        <a href={TAILORIT_LINKS.jobs} target="_blank" rel="noreferrer" data-tailorit-link="jobs">{COPY.panel.openJobs}</a>
      </p>
    </main>
  );
}

/** Before any run (v2): what the tab's page holds, from the worker's frame registry; nothing until it is known. */
function PageStrip({ page }: { page: PageState | null }) {
  if (page === null) return null;
  if (page.support === 'form') {
    return (
      <p className="tia-strip" data-strip="form" data-tone="brand">
        {COPY.strip.form(page.platform === null ? null : COPY.platforms[page.platform])}
      </p>
    );
  }
  return (
    <p className="tia-strip" data-strip={page.support} data-tone="neutral">
      {page.support === 'no-form' ? COPY.strip.noForm : COPY.strip.none}
    </p>
  );
}

/** "Connected as …" with a dot, or why filling cannot work, as a problem strip with a link to the settings. */
function ConnectionLine({ auth, settingsUrl }: { auth: AuthState; settingsUrl: string }) {
  const { status } = auth;
  if (status === null) {
    return auth.failed ? (
      <p className="tia-connection tia-connection--problem tia-strip" data-tone="problem">{COPY.panel.noAnswer}</p>
    ) : null;
  }
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
      <p className="tia-connection tia-connection--problem tia-strip" data-tone="problem" data-connection={status.connection}>
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
  if (link === 'gone') return <p className="tia-problem tia-strip" data-tone="problem" role="alert">{COPY.panel.extensionGone}</p>;
  return (
    <p className="tia-problem tia-strip" data-tone="problem" role="alert">
      {COPY.panel.linkLost}{' '}
      <button type="button" className="tia-button" onClick={onReconnect}>{COPY.panel.reconnect}</button>
    </p>
  );
}
