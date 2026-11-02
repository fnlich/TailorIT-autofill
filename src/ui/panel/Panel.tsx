/*
 * The review panel: the browser's side panel, and the report page (the same page opened as a tab with ?tabId=N, which
 * pins that tab). It follows a tab (tab.ts), shows its reports live (reports.ts) and mounts the report components, laid
 * out like Jobright's sidebar in TailorIT's look (v3 Phase 3): a column on TailorIT's canvas, top to bottom:
 *
 * - The brand (TailorIT's mark and "TailorIT Autofill") and a gear that opens the menu: the modes (src/ui/page/modes.tsx,
 *   the options page's Modes card: Next page, Autofill after page turn, Consent boxes, AI answers, the view), each
 *   saved at once with settings/save, and a link to all the settings.
 * - Only when something is wrong: the connection (auth/status: why filling cannot work, as a problem strip with a link
 *   to the settings) and the live link.
 * - The launcher hidden by the person on this site or everywhere (panel/launcher): "Show the TailorIT button again"
 *   (panel/showLauncher). The toolbar icon opens this panel, so it is where the button comes back.
 * - What the tab's page holds, when no job card says more: a page Autofill does not work on ("Autofill isn't supported
 *   on this page" and the sites it works on), a page of ours with no form, or the form found; or that there is no tab.
 * - The notices mirrored from the page (the tripwire's exact sentence, the policy card, the couldn't-read notice), above
 *   the main button, so a decision is seen before anything else. A run at policy-notice waits for its card: Fill
 *   anyway and Cancel send panel/policyDecision {tabId, frameId, decision} for the frame whose report is at
 *   policy-notice, which that frame treats exactly as its own card's buttons. Continue only resumes pauses: it never
 *   fills past a card.
 * - The job card (JobCard.tsx and job.ts): what TailorIT knows of the job in the tab's form, read through the worker
 *   (panel/job) only while the tab shows a form of ours and the extension is connected (the worker may already hold it:
 *   it looks a recognised job page up as the page loads); Add this job to TailorIT and Save to tracker (panel/addJob).
 *   Under it Autofill (panel/fill {tabId, dryRun: false}), its label constant, with a spinner while its request is out
 *   or a run works; then, while no run works, Dry run, Continue and Cancel (panel/fill {dryRun: true}, panel/continue,
 *   panel/cancel), Continue marked while a run waits for the person, both off until a run reports. Then what the fill
 *   uses, folded away while a run works: "Your autofill information", the resume with Change (panel/resumes,
 *   panel/setResume), and the cover letter (Phase G, letter.ts) only when the form asks for one (the frame's hello, or
 *   a report's row). Then what the last button did, until a newer report tells more.
 * - The progress and the field lists (Report): "Scanning the page…", "Autofilling… 78%" with Cancel (panel/cancel),
 *   "9 of 12 required fields filled · 75%"; Required then Optional, each row's label showing the field on the page
 *   (panel/focus), Skip on the field being written after 2 s (panel/skip {tabId, frameId, fieldKey}), Confirm draft
 *   (panel/confirmDraft), Save my answer (panel/saveAnswer), the closest options (panel/describe); folded at first
 *   with the Minimized view.
 * - Ask a custom question (v2, Ask.tsx; panel/ask), answered from the tab's active resume: off while AI-written answers
 *   (the drafts setting) are off, and under the posting's no-AI notice when any report of the tab says the posting
 *   forbids AI (saysNoAi) or the answer says so.
 * - At the foot: "Connected as …", and the link to the person's TailorIT jobs.
 * When the worker says the connection or the settings changed (panel/changed, perhaps from another window), they are
 * read again, and the job card read with the old connection is dropped at once.
 *
 * It never shows or receives a field value: reports hold none, and describe's option labels stay in the open row. The
 * job card draws only what TailorIT's lookup said, the resume's title among it (which may be the person's name: it is
 * shown on purpose, as the resume the fill attaches); the custom question's answer is the person's own request.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { Settings } from '../../core/types/settings';
import type { Answer } from '../../messaging/envelope';
import type {
  AddJobOutcome, AskLength, PageMessage, PageState, PanelLauncherAnswer, SaveAnswerOutcome,
} from '../../messaging/schemas';
import type { PagePlatform } from '../../platform/types';
import { COPY } from '../../shared/copy';
import { fillsFromProfileOnly, saysNoAi, type FrameReport } from '../../shared/report';
import { Brand } from '../brand/Logo';
import { Icon } from '../brand/Icon';
import { ModesFields } from '../page/modes';
import { request } from '../page/request';
import { useAuthStatus, type AuthState } from '../page/use-auth';
import { isWorking } from '../report/model';
import { Report, ReportNotices } from '../report/Report';
import { AskQuestion } from './Ask';
import { useTabJob } from './job';
import { JobCard, type LetterMode } from './JobCard';
import { useTabLetter } from './letter';
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

/** The run statuses at which a run waits for the person's Continue (or Cancel). */
const PAUSED: ReadonlySet<FrameReport['status']> = new Set<FrameReport['status']>(['handoff', 'auth-needed']);

/** Whether a frame's run waits for the person's Continue: paused (a hand-off, a sign-in), or resting on a new step
 *  under Autofill after page turn: Manually (the page-turned notice, v3 Phase 3). Continue is offered only then. */
const awaitsContinue = (report: FrameReport) => PAUSED.has(report.status)
  || report.notices.some((notice) => notice.code === 'page-turned');

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

/** Whether the tab's form asks for a cover letter: its frame said so at hello, or a report's row is one. */
function asksForLetter(page: PageState | null, reports: readonly FrameReport[]): boolean {
  return page?.letter === true || reports.some((report) => report.fields.some((row) =>
    row.category === 'file.coverLetter' || row.category === 'freeText.coverLetter'));
}

export function Panel({ platform, pinnedTabId, now = Date.now, copyText = clipboardCopy }: PanelProps) {
  const root = useRef<HTMLElement>(null);
  const dashboardId = useId();
  const menuId = useId();
  const tabId = useFollowedTab(platform, pinnedTabId);
  const { reports, page, link, reconnect, changes } = useTabReports(platform, tabId, now, { side: pinnedTabId === null });
  const auth = useAuthStatus(platform, root);
  const [busy, setBusy] = useState(false);
  /** What the last button did. A run button's line holds only until a report newer than its click arrives (`newest`:
   *  the newest report's time at the click), which says more (the Phase F1 review, 7); a row action's stays. */
  const [feedback, setFeedback] = useState<{ tabId: number | null; text: string; newest: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<{ tabId: number; outcome: AddJobOutcome } | null>(null);
  /** The settings as last read or saved (null until read): the AI switches, the modes and the view. */
  const [settings, setSettings] = useState<Settings | null>(null);
  /** Whether the first read of the settings has answered, either way: the review waits for it, so the Minimized view
   *  never shows the lists first (v3 Phase 3 review). */
  const [settingsRead, setSettingsRead] = useState(false);
  const [savingModes, setSavingModes] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** Where the person hid the launcher of the followed tab's site, read for that tab. */
  const [launcher, setLauncher] = useState<{ tabId: number; hidden: PanelLauncherAnswer['hidden'] } | null>(null);
  const [launcherShown, setLauncherShown] = useState<number | null>(null);
  const { refresh } = auth;
  // The card's connection key: the token's expiry, and every change the worker announced (another window may have
  // connected or disconnected), so a card read with the old connection is dropped the moment the change is heard.
  const connection = auth.status === null ? undefined
    : auth.status.connection === 'connected' ? `${auth.status.expiresAt ?? 0}|${changes.connection}` : null;
  const job = useTabJob(platform, tabId, { page, connection, reports });
  const newestReport = Math.max(0, ...reports.map((report) => report.updatedAt));
  const settingsUrl = platform.runtime.getURL('/options.html');
  /** AI-written answers (the drafts setting) are off: the custom question is too. */
  const aiOff = settings === null ? null : !settings.llm.drafts;
  /** Whether a posting that forbids AI is filled from the profile only (Phase G: the cover letter's row says so). */
  const whenForbidden = settings?.llm.whenForbidden ?? 'profile-only';

  // The connection changed (a token stored or dropped, in this window or another): read it again.
  useEffect(() => {
    if (changes.connection > 0) refresh();
  }, [changes.connection, refresh]);

  // The settings, at the start and whenever the worker says they changed.
  useEffect(() => {
    let live = true;
    void request(platform, { v: 1, type: 'settings/get' }).then((answer) => {
      if (!live) return;
      if (answer.ok) setSettings(answer.data.settings);
      setSettingsRead(true);
    });
    return () => {
      live = false;
    };
  }, [platform, changes.settings]);

  // Whether the launcher is hidden on the followed tab's site: read for each tab and each page it shows.
  const pageKey = page === null ? null : `${page.support}|${page.formKey ?? ''}`;
  useEffect(() => {
    if (tabId === null || pageKey === null) return undefined;
    let live = true;
    void request(platform, { v: 1, type: 'panel/launcher', tabId }).then((answer) => {
      if (live && answer.ok) setLauncher({ tabId, hidden: answer.data.hidden });
    });
    return () => {
      live = false;
    };
  }, [platform, tabId, pageKey]);

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

  /** A mode or the view chosen in the gear's menu: saved at once, then shown as the worker stored it. */
  const saveModes = (next: Settings) => {
    setSavingModes(true);
    setSettings(next);
    void request(platform, { v: 1, type: 'settings/save', settings: next }).then((answer) => {
      setSavingModes(false);
      if (answer.ok) setSettings(answer.data.settings);
      else void request(platform, { v: 1, type: 'settings/get' }).then((read) => {
        if (read.ok) setSettings(read.data.settings);
      });
    });
  };

  /** Show the TailorIT button again: the site's and the everywhere flag cleared, the tab's frames told. */
  const showLauncher = (target: number) => {
    void request(platform, { v: 1, type: 'panel/showLauncher', tabId: target }).then((answer) => {
      if (!answer.ok) return;
      setLauncher({ tabId: target, hidden: 'none' });
      setLauncherShown(target);
    });
  };

  const disabled = tabId === null || busy;
  const working = reports.some(isWorking);
  const paused = reports.some(awaitsContinue);
  const shownFeedback = feedback !== null && feedback.tabId === tabId && newestReport <= feedback.newest ? feedback : null;
  const dryRun = reports.length > 0 && reports.every((report) => report.mode === 'dry-run');
  const card = job.view.state === 'shown' ? job.view.card : null;
  // The posting forbids AI, whichever mode the run filled in: the policy card, the notice past it, profile only, the
  // form's "I did not use AI" attestation, or TailorIT's saved copy.
  const policy = reports.some(saysNoAi);
  // Continue and Cancel act on a run: before any report there is none.
  const noRun = reports.length === 0;
  // The card's cover letter (Phase G), read with the card's own key, and whether TailorIT's AI may write it here.
  const cardBase = tabId !== null && page !== null && page.support === 'form' && typeof connection === 'string'
    ? `${tabId}|${page.formKey ?? ''}|${connection}` : null;
  const letter = useTabLetter(platform, tabId, { base: cardBase, card, reports });
  // Profile only: a posting that forbids AI under the default setting, or a run of the tab that went profile-only ("Ask
  // me" leaves Write it now to the person; "Use AI anyway" writes).
  const letterMode: LetterMode = aiOff === true ? 'ai-off'
    : (policy && whenForbidden === 'profile-only') || reports.some(fillsFromProfileOnly) ? 'profile-only' : 'ai';
  const hidden = launcher !== null && launcher.tabId === tabId ? launcher.hidden : 'none';

  // While a run fills, the progress (the review's, with its Cancel) stands where Autofill was, as Jobright's does
  // (v3 Phase 3 review).
  const toolbar = tabId !== null && !working && (
    <div className="tia-toolbar">
      <button type="button" className="tia-cta" disabled={disabled} data-working={busy ? 'true' : undefined}
        onClick={() => void run({ v: 1, type: 'panel/fill', tabId, dryRun: false })}>
        {busy && <Icon name="spinner" size={20} className="tia-icon tia-spin" />}
        {COPY.panel.fill}
      </button>
      <div className="tia-toolbar__more">
        <button type="button" className="tia-button tia-button--quiet" disabled={disabled}
          onClick={() => void run({ v: 1, type: 'panel/fill', tabId, dryRun: true })}>{COPY.panel.dryRun}</button>
        <button type="button" className="tia-button tia-button--quiet" disabled={disabled || !paused}
          data-emphasis={paused ? '' : undefined}
          onClick={() => void run({ v: 1, type: 'panel/continue', tabId })}>{COPY.panel.continue}</button>
        <button type="button" className="tia-button tia-button--quiet" disabled={disabled || noRun}
          onClick={() => void run({ v: 1, type: 'panel/cancel', tabId })}>{COPY.panel.cancel}</button>
      </div>
    </div>
  );

  return (
    <main className="tia-page tia-panel" ref={root} data-tab-id={tabId ?? undefined}>
      <header className="tia-panel__head">
        <h1 className="tia-brand"><Brand markSize={28} large /></h1>
        <button type="button" className="tia-iconbutton" aria-label={COPY.panel.menu} title={COPY.panel.menu}
          aria-expanded={menuOpen} aria-controls={menuId} data-panel-menu="" onClick={() => setMenuOpen((open) => !open)}>
          <Icon name="gear" size={18} />
        </button>
      </header>
      {menuOpen && (
        <section className="tia-menu" id={menuId} aria-label={COPY.panel.menu} data-menu="">
          <h2 className="tia-menu__title">{COPY.panel.modes}</h2>
          {settings === null ? <p className="tia-help">{COPY.options.loading}</p> : (
            <ModesFields settings={settings} disabled={savingModes} onChange={saveModes} idPrefix="panel" />
          )}
          <a className="tia-menu__all" href={`${settingsUrl}#settings-modes`} target="_blank" rel="noreferrer"
            data-open-settings="">
            {COPY.panel.allSettings}
            <Icon name="chevron-right" size={16} />
          </a>
        </section>
      )}
      <ConnectionProblem auth={auth} settingsUrl={settingsUrl} />
      <LinkProblem link={link} onReconnect={reconnect} />
      {tabId !== null && hidden !== 'none' && (
        <div className="tia-strip tia-launcher-hidden" data-tone="neutral" data-launcher-hidden={hidden}>
          <span>{COPY.panel.launcherHidden[hidden]}</span>{' '}
          <button type="button" className="tia-button" data-action="show-launcher" onClick={() => showLauncher(tabId)}>
            {COPY.panel.showLauncher}
          </button>
        </div>
      )}
      {launcherShown !== null && launcherShown === tabId && hidden === 'none' && (
        <p className="tia-feedback" role="status">
          {pinnedTabId === null ? COPY.panel.launcherShownAfterPanel : COPY.panel.launcherShown}
        </p>
      )}
      {tabId === null ? (
        <p className="tia-strip" data-strip="no-tab" data-tone="neutral">{COPY.panel.noTab}</p>
      ) : page?.support === 'none' && reports.length === 0 ? (
        <Unsupported reload={page.reload === true} />
      ) : reports.length === 0 && job.view.state === 'hidden' ? (
        <PageStrip page={page} />
      ) : null}
      {tabId !== null && (
        <ReportNotices reports={reports} busy={busy}
          onPolicyDecision={(frameId, decision) => void decide({ v: 1, type: 'panel/policyDecision', tabId, frameId, decision })} />
      )}
      {tabId !== null && page?.support !== 'none' && (job.view.state === 'hidden' ? toolbar : (
        <JobCard view={job.view} platform={page?.platform ?? null} dryRun={dryRun} adding={adding}
          outcome={added !== null && added.tabId === tabId ? added.outcome : null} now={now()}
          onAdd={() => void addJob(tabId)}
          loadResumes={async () => {
            const answer = await request(platform, { v: 1, type: 'panel/resumes', tabId });
            return answer.ok ? answer.data.items : null;
          }}
          chooseResume={(resumeId) => chooseResume(tabId, resumeId)}
          letter={letter.view} letterMode={letterMode} onWriteLetter={letter.write}
          letterAsked={asksForLetter(page, reports)} working={working} autofillInfoUrl={TAILORIT_LINKS.autofillInfo}>
          {toolbar}
        </JobCard>
      ))}
      {shownFeedback !== null && <p className="tia-feedback" role="status">{shownFeedback.text}</p>}
      {tabId !== null && reports.length > 0 && settingsRead && (
        <section className="tia-dashboard" aria-labelledby={dashboardId}>
          <h2 className="tia-visually-hidden" id={dashboardId}>{COPY.panelTitle}</h2>
          <Report
            reports={reports}
            notices={false}
            busy={busy}
            minimized={settings?.view === 'minimized'}
            onCancel={() => void run({ v: 1, type: 'panel/cancel', tabId })}
            onSkip={(frameId, fieldKey) => {
              void request(platform, { v: 1, type: 'panel/skip', tabId, frameId, fieldKey });
            }}
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
        </section>
      )}
      {tabId !== null && page?.support !== 'none' && (
        <AskQuestion key={tabId} ask={(question, length) => ask(tabId, question, length)} copy={copyText}
          connected={connection !== undefined && connection !== null} aiOff={aiOff === true}
          noResume={card !== null && card.state === 'answered' && card.resume === null} policy={policy} />
      )}
      <footer className="tia-panel__foot">
        <ConnectedLine auth={auth} />
        <p className="tia-links">
          {job.view.state === 'hidden' && (
            <a href={TAILORIT_LINKS.autofillInfo} target="_blank" rel="noreferrer" data-tailorit-link="autofill">
              {COPY.panel.autofillInfo}
            </a>
          )}
          <a href={TAILORIT_LINKS.jobs} target="_blank" rel="noreferrer" data-tailorit-link="jobs">{COPY.panel.openJobs}</a>
        </p>
      </footer>
    </main>
  );
}

/** A page Autofill does not work on (v3 Phase 3): the sites it works on. */
function Unsupported({ reload }: { reload: boolean }) {
  const headingId = useId();
  const words = COPY.panel.unsupported;
  // A page on a supported site the extension did not see load: a reload is all it takes (v3 Phase 3 review).
  if (reload) {
    return (
      <section className="tia-unsupported" data-unsupported="reload" aria-labelledby={headingId}>
        <div className="tia-unsupported__head">
          <Icon name="info" size={20} className="tia-icon tia-unsupported__icon" />
          <h2 className="tia-unsupported__title" id={headingId}>{words.reloadHeading}</h2>
        </div>
        <p className="tia-unsupported__intro">{words.reloadIntro}</p>
      </section>
    );
  }
  return (
    <section className="tia-unsupported" data-unsupported="" aria-labelledby={headingId}>
      <div className="tia-unsupported__head">
        <Icon name="info" size={20} className="tia-icon tia-unsupported__icon" />
        <h2 className="tia-unsupported__title" id={headingId}>{words.heading}</h2>
      </div>
      <p className="tia-unsupported__intro">{words.intro}</p>
      <ul className="tia-unsupported__sites">
        {words.sites.map((site) => (
          <li key={site.name} className="tia-unsupported__site">
            <span className="tia-unsupported__name">{site.name}</span>
            <span className="tia-unsupported__hosts">{site.hosts}</span>
          </li>
        ))}
      </ul>
      <p className="tia-help">{words.embedded}</p>
    </section>
  );
}

/** Before any run, when no job card says more: what the tab's page holds, from the worker's frame registry; nothing
 *  until it is known. */
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

/** Why filling cannot work, as a problem strip with a link to the settings; nothing while all is well. */
function ConnectionProblem({ auth, settingsUrl }: { auth: AuthState; settingsUrl: string }) {
  const { status } = auth;
  if (status === null) {
    return auth.failed ? (
      <p className="tia-connection tia-connection--problem tia-strip" data-tone="problem">{COPY.panel.noAnswer}</p>
    ) : null;
  }
  const problems: string[] = [];
  if (status.storageAccess === 'refused') problems.push(COPY.panel.storageRefused);
  if (status.versionMismatch) problems.push(COPY.panel.versionMismatch);
  if (status.connection !== 'connected') {
    problems.unshift(status.connection === 'expired' ? COPY.panel.expired
      : status.connection === 'revoked' ? COPY.panel.revoked : COPY.panel.notConnected);
  }
  if (problems.length === 0) return null;
  return (
    <p className="tia-connection tia-connection--problem tia-strip" data-tone="problem" data-connection={status.connection}>
      {problems.join(' ')} <a href={settingsUrl} target="_blank" rel="noreferrer">{COPY.panel.openSettings}</a>
    </p>
  );
}

/** "Connected as …" with a dot, at the panel's foot, while all is well. */
function ConnectedLine({ auth }: { auth: AuthState }) {
  const { status } = auth;
  if (status === null || status.connection !== 'connected' || status.storageAccess === 'refused' || status.versionMismatch) {
    return null;
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
