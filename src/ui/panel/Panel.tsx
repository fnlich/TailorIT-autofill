/*
 * The review panel: the browser's side panel, and the report page (the same page opened as a tab with ?tabId=N, which
 * pins that tab). It follows a tab (tab.ts), shows its reports live (reports.ts) and mounts the report components, laid
 * out like Jobright's sidebar in TailorIT's look. v4 ui (the owner, 2026-11-07) gives it views, one at a time:
 *
 * - The set-up view (Setup.tsx) while the extension is not connected, or connected with autofill information that is
 *   not complete (profile-check.ts: a first and last name, an email, a phone number, a city or a country): "Set up your
 *   TailorIT account" (only when not connected) and "Complete your profile details", each a GO or a tick, then Start
 *   applying. A panel that opens complete goes straight to the main view; one completed during the session shows both
 *   ticks and an enabled Start applying, which opens the main view. No gear here.
 * - The main view: the head (TailorIT's mark and name left, a gear right that opens the Settings view), then, only when
 *   something says more:
 *   - a problem that blocks everything (the worker did not answer, a version mismatch, storage the browser would not
 *     restrict, the live link lost or the extension gone), as a strip;
 *   - the disclosure shown again when it changed since the person connected, with I understand;
 *   - the auto-apply agent's status line, while Run auto-apply is on (src/ui/page/agent.tsx);
 *   - the launcher hidden by the person on this site or everywhere: "Show the TailorIT button again";
 *   - what the tab's page holds when no job card says more: a page Autofill does not work on (the sites it works on,
 *     its explanations in a "?", "Ask TailorIT to support this site"), a page of ours with no form, or the form found;
 *     or that there is no tab;
 *   - "Application submitted" once the platform confirmed it (PageState.submitted);
 *   - the job card (JobCard.tsx and job.ts: tile, company, industry, match pill, title, "2 days ago · Austin, TX", the
 *     Applied badge, "Not this job?"), read through the worker (panel/job) only while the tab shows a form or a posting
 *     of ours and the extension is connected; "+ Add this job in one click" (panel/addJob) where TailorIT does not have
 *     the job and can add it;
 *   - the main button, big and teal: "Autofill" (panel/fill {dryRun: false}); "Sign up & Autofill" (panel/fill
 *     {dryRun: false, signIn: true}) while the tab's application frame shows an account wall (PageState.wall); and,
 *     while a run waits to go on (paused: a hand-off or a sign-in), the same "Autofill" sends panel/continue. A run
 *     resting on a new page under Autofill after page turn: Manually reports 'review' with no row (v4, D7: no
 *     page-turned notice): its Autofill is a plain panel/fill, which the run takes as going on there. On a posting page
 *     (no form) it shows only while the application frame shows an entry choice (PageState.choice: Workday's "Start
 *     Your Application", whose Autofill presses the declared entry) or an account wall. Whenever what it says and
 *     sends changes, it takes no click until the new label has been shown CONTROL_SEEN_MS (seen.ts, the v4 review's
 *     L4: a page cannot flip it as the pointer comes). While a run works it spins, and the progress below has Cancel.
 *     No Dry run, Continue or Cancel buttons (the messages stay);
 *   - "Ask custom question" (Ask.tsx: panel/ask), an outline button that unfolds the box;
 *   - "Résumé: <label> · Preview · Change" (JobCard.tsx ResumeLine: panel/resumes, panel/setResume,
 *     panel/withoutResume, the `preview` port) until a run lists the résumé's own row;
 *   - what the last button did, until a newer report tells more;
 *   - the progress and the field lists (Report, without its notices: D10's page notifications say what is left for
 *     the person): "7/7 required fields filled | 100%", Required then Optional, each row a tick or an empty circle and
 *     its label, which shows the field on the page (panel/focus); Skip on the field being written after 2 s
 *     (panel/skip); Preview and Show on the résumé and cover-letter rows (the `preview` port, its kind); the dock's
 *     "Continue to the next page" or "Submit application" (panel/press); folded at first with the Minimized view.
 * - The Settings view (SettingsView.tsx) in place of everything under the head: ✕ and "Settings", the modes as radio
 *   cards with their "?", "Autofill information", the account, "All settings" and Save (settings/save {settings, base}).
 * - The profile editor (Profile.tsx: panel/profile, panel/saveProfile), from the set-up view's GO or the Settings view's
 *   "Autofill information"; its Back returns there, and a save checks the profile again.
 * When the worker says the connection or the settings changed (panel/changed, perhaps from another window), they are
 * read again, and the job card read with the old connection is dropped at once.
 *
 * It never shows or receives a field value: reports hold none. The job card draws only what TailorIT's lookup said, the
 * resume's title among it (which may be the person's name: it is shown on purpose, as the resume the fill attaches);
 * the custom question's answer is the person's own request; the profile check keeps which items are missing, never a
 * value (profile-check.ts); the previews' bytes stay in this page (preview.ts).
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Settings } from '../../core/types/settings';
import type { Answer } from '../../messaging/envelope';
import type {
  AddJobOutcome, AskLength, PageMessage, PageState, PanelLauncherAnswer, SiteRequestOutcome,
} from '../../messaging/schemas';
import type { PagePlatform } from '../../platform/types';
import { COPY } from '../../shared/copy';
import { leftOut, saysNoAi, type FrameReport } from '../../shared/report';
import { Brand } from '../brand/Logo';
import { Icon } from '../brand/Icon';
import { AgentStatusLine, useAgentStatus } from '../page/agent';
import { DisclosureChanged } from '../page/disclosure';
import { HelpTip } from '../page/HelpTip';
import { request } from '../page/request';
import { useAuthStatus, type AuthState } from '../page/use-auth';
import { isWorking, type ReportRow } from '../report/model';
import { Report, type PreviewKind } from '../report/Report';
import { AskQuestion } from './Ask';
import { useTabJob } from './job';
import { JobCard, ResumeLine, ResumePicker } from './JobCard';
import { useTabLetter } from './letter';
import { receivePreview } from './preview';
import { ProfileEditor } from './Profile';
import { ResumePreview } from './ResumePreview';
import { useTabReports, type LinkState } from './reports';
import { SettingsView } from './SettingsView';
import { SetupView } from './Setup';
import { useProfileCheck } from './profile-check';
import { BROWSER_SEEN_CLOCK, useShownFor, type SeenClock } from './seen';
import { useFollowedTab } from './tab';

export interface PanelProps {
  platform: PagePlatform;
  /** The tab ?tabId=N pins (pinnedTabOf); null follows the active tab of the panel's window. */
  pinnedTabId: number | null;
  /** The clock (ms), for the reconnect limit, the card's "2 days ago" and the pairing's wait. */
  now?: () => number;
  /** Puts text on the clipboard (the custom answer's Copy); the browser's by default. */
  copyText?: (text: string) => Promise<boolean>;
  /** The clock the main button's CONTROL_SEEN_MS is timed on (seen.ts); the browser's by default. */
  seenClock?: SeenClock;
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

/** The person's TailorIT (the build's origin): where their autofill information and their tracker live. */
const TAILORIT_LINKS = {
  autofillInfo: `${__TAILORIT_ORIGIN__}/settings/autofill`,
  tracker: `${__TAILORIT_ORIGIN__}/tracker`,
} as const;

/** The run statuses at which a run waits for the person's word to go on (the machine's pauses: a hand-off, a sign-in,
 *  each answered by run/continue's CONTINUE). The main button then sends panel/continue. A run resting on a new step
 *  under Autofill after page turn: Manually is at 'review' (v4, D7: it raises no page-turned notice any more), and its
 *  plain panel/fill goes on there. */
const PAUSED: ReadonlySet<FrameReport['status']> = new Set<FrameReport['status']>(['handoff', 'auth-needed']);

/** What the main button says and sends: Autofill, Sign up & Autofill, or (labelled Autofill) go on with a paused run. */
type MainMeaning = 'fill' | 'sign-up' | 'continue';

/** The main button's message for what it means. */
function mainMessageOf(meaning: MainMeaning, tabId: number): RunMessage {
  if (meaning === 'sign-up') return { v: 1, type: 'panel/fill', tabId, dryRun: false, signIn: true };
  if (meaning === 'continue') return { v: 1, type: 'panel/continue', tabId };
  return { v: 1, type: 'panel/fill', tabId, dryRun: false };
}

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

/** Whether the tab's form asks for a cover letter: its frame said so at hello, or a report's row is one. */
function asksForLetter(page: PageState | null, reports: readonly FrameReport[]): boolean {
  return page?.letter === true || reports.some((report) => report.fields.some((row) =>
    row.category === 'file.coverLetter' || row.category === 'freeText.coverLetter'));
}

/** The views under the head: the main view, the Settings view, or the profile editor (and where its Back goes). The
 *  set-up view is the gate's (`gate`), before the main view. */
type View = { name: 'main' } | { name: 'settings' } | { name: 'editor'; back: 'setup' | 'settings' };

export function Panel({ platform, pinnedTabId, now = Date.now, copyText = clipboardCopy,
  seenClock = BROWSER_SEEN_CLOCK }: PanelProps) {
  const root = useRef<HTMLElement>(null);
  const dashboardId = useId();
  const tabId = useFollowedTab(platform, pinnedTabId);
  const { reports, page, link, reconnect, changes, relinked } = useTabReports(platform, tabId, now,
    { side: pinnedTabId === null });
  const auth = useAuthStatus(platform, root);
  // v3 Phase 5: the auto-apply agent's status, read again at each change the worker announces.
  const agent = useAgentStatus(platform, root, { changes: changes.agent });
  const [busy, setBusy] = useState(false);
  /** What the last button did. A run button's line holds only until a report newer than its click arrives (`newest`:
   *  the newest report's time at the click), which says more (the Phase F1 review, 7); a row action's stays. */
  const [feedback, setFeedback] = useState<{ tabId: number | null; text: string; newest: number } | null>(null);
  const [adding, setAdding] = useState(false);
  /** What the last Add came to, for the page it was asked on (the audit's m7: `view`). */
  const [added, setAdded] = useState<{ view: string; outcome: AddJobOutcome } | null>(null);
  /** The settings as last read or saved (null until read): the AI switches, the modes and the view. */
  const [settings, setSettings] = useState<Settings | null>(null);
  /** Whether the first read of the settings has answered, either way: the review waits for it, so the Minimized view
   *  never shows the lists first (v3 Phase 3 review). */
  const [settingsRead, setSettingsRead] = useState(false);
  /** Where the person hid the launcher of the followed tab's site, read for that tab. */
  const [launcher, setLauncher] = useState<{ tabId: number; hidden: PanelLauncherAnswer['hidden'] } | null>(null);
  const [launcherShown, setLauncherShown] = useState<number | null>(null);
  /** v4 ui: the view under the head. */
  const [view, setView] = useState<View>({ name: 'main' });
  const { refresh } = auth;
  // The card's connection key: the token's expiry, and every change the worker announced (another window may have
  // connected or disconnected), so a card read with the old connection is dropped the moment the change is heard.
  const connection = auth.status === null ? undefined
    : auth.status.connection === 'connected' ? `${auth.status.expiresAt ?? 0}|${changes.connection}` : null;
  const job = useTabJob(platform, tabId, { page, connection, reports, relinked });
  /** The audit of 2026-11-06 (m7): what the panel shows for a page belongs to that tab's page under that connection, so
   *  an Add's outcome or a custom answer never shows under the next posting the tab moves to. */
  const viewKey = `${tabId ?? ''}|${page?.formKey ?? ''}|${connection ?? ''}`;
  const newestReport = Math.max(0, ...reports.map((report) => report.updatedAt));
  // The previews' loaders, one per tab and kind (the review): a preview opened is one transfer, whatever the panel draws.
  const loadResumePreview = useCallback((signal: AbortSignal) => (tabId === null ? Promise.resolve({ ok: false as const,
    reason: 'unavailable' as const }) : receivePreview(platform, tabId, signal)), [platform, tabId]);
  const loadLetterPreview = useCallback((signal: AbortSignal) => (tabId === null ? Promise.resolve({ ok: false as const,
    reason: 'unavailable' as const }) : receivePreview(platform, tabId, signal, 'coverLetter')), [platform, tabId]);
  const settingsUrl = platform.runtime.getURL('/options.html');
  /** AI-written answers (the drafts setting) are off: the custom question is too. */
  const aiOff = settings === null ? null : !settings.llm.drafts;

  // v4 ui: whether the autofill information is complete (profile-check.ts), read while connected.
  const accountEmail = auth.status?.connection === 'connected' ? auth.status.account?.email ?? null : null;
  const { check: profile, recheck } = useProfileCheck(platform, typeof connection === 'string' ? connection : null,
    accountEmail);
  /** Whether the set-up view is needed; null while that is not known yet. A profile that could not be read never
   *  locks the person out: the fill reads it itself. */
  const needsSetup = auth.status === null ? null : auth.status.connection !== 'connected' ? true
    : profile.state === 'read' ? profile.gaps.length > 0 : profile.state === 'unreadable' ? false : null;
  /** The gate before the main view: the set-up view, once needed, stays until Start applying (the owner: both ticks,
   *  then Start applying); a panel that opens complete shows the main view at once. */
  const [gate, setGate] = useState<'setup' | 'main' | null>(null);
  /** The set-up view's first step shows once the person was seen not connected, and stays, ticked, until Start
   *  applying (the owner: both ticks, then Start applying). */
  const [withAccount, setWithAccount] = useState(false);
  if (auth.status !== null && auth.status.connection !== 'connected' && !withAccount) setWithAccount(true);
  const nextGate = needsSetup === null ? gate : gate === null ? (needsSetup ? 'setup' : 'main')
    : needsSetup && gate === 'main' ? 'setup' : gate;
  if (nextGate !== gate) {
    // React's pattern for state that follows what is read: adjusted while rendering.
    setGate(nextGate);
    if (nextGate === 'setup' && view.name === 'settings') setView({ name: 'main' });
  }

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

  /** Add this job to TailorIT: what came of it, then the card read again. */
  const addJob = async (target: number) => {
    const shown = viewKey;
    setAdding(true);
    const answer = await request(platform, { v: 1, type: 'panel/addJob', tabId: target });
    setAdding(false);
    setAdded({ view: shown, outcome: answer.ok ? answer.data.outcome
      : answer.error === 'not_connected' ? 'not-connected' : 'unavailable' });
    job.reload();
  };

  /** The resume chosen with Change (null: TailorIT's own choice again): kept for the tab, then the card read again. */
  const chooseResume = (target: number, resumeId: string | null) => {
    setAdded(null);
    void request(platform, { v: 1, type: 'panel/setResume', tabId: target, resumeId }).then(() => job.reload());
  };

  /** The account's resumes, for Change (the résumé line's, and the résumé row's after a run). */
  const loadResumes = useCallback(async () => {
    if (tabId === null) return null;
    const answer = await request(platform, { v: 1, type: 'panel/resumes', tabId });
    return answer.ok ? answer.data.items : null;
  }, [platform, tabId]);

  const ask = (target: number, question: string, length: AskLength) =>
    request(platform, { v: 1, type: 'panel/ask', tabId: target, question, length });

  /** v3 Phase 3b: "Autofill for another job"'s choice, and "Apply without resume": kept for the tab, then the card is
   *  read again. A choice the worker could not keep (the page changed meanwhile, the search is gone) says so (the
   *  review, 19). */
  const chooseJob = (target: number, ref: string | null) => {
    setAdded(null);
    void request(platform, { v: 1, type: 'panel/chooseJob', tabId: target, ref }).then((answer) => {
      if (!answer.ok) setFeedback({ tabId: target, text: COPY.job.another.failed, newest: Number.POSITIVE_INFINITY });
      job.reload();
    });
  };
  const setWithout = (target: number, without: boolean) => {
    void request(platform, { v: 1, type: 'panel/withoutResume', tabId: target, without }).then((answer) => {
      if (!answer.ok) setFeedback({ tabId: target, text: COPY.job.withoutFailed, newest: Number.POSITIVE_INFINITY });
      job.reload();
    });
  };

  /** The review: Try again, when the tracker could not be told of a submitted application. */
  const retryApplied = (target: number) => {
    void request(platform, { v: 1, type: 'panel/retryApplied', tabId: target }).then((answer) => {
      if (!answer.ok) setFeedback({ tabId: target, text: COPY.panel.failed, newest: Number.POSITIVE_INFINITY });
    });
  };

  /** The review: I understand, on the disclosure that changed since the person connected. */
  const acknowledge = () => {
    void request(platform, { v: 1, type: 'auth/acknowledgeDisclosure' }).then(() => refresh());
  };

  /** Show the TailorIT button again: the site's and the everywhere flag cleared, the tab's frames told. */
  const showLauncher = (target: number) => {
    void request(platform, { v: 1, type: 'panel/showLauncher', tabId: target }).then((answer) => {
      if (!answer.ok) return;
      setLauncher({ tabId: target, hidden: 'none' });
      setLauncherShown(target);
    });
  };

  const working = reports.some(isWorking);
  const shownFeedback = feedback !== null && feedback.tabId === tabId && newestReport <= feedback.newest ? feedback : null;
  const card = job.view.state === 'shown' ? job.view.card : null;
  const answered = card !== null && card.state === 'answered' ? card : null;
  // The posting forbids AI, whichever mode the run filled in: the custom question says so.
  const policy = reports.some(saysNoAi);
  // The cover letter (Phase G), asked only where the form asks for one: whether there is one to preview.
  const letterAsked = asksForLetter(page, reports);
  const cardBase = tabId !== null && page !== null && page.support === 'form' && typeof connection === 'string'
    && letterAsked ? `${tabId}|${page.formKey ?? ''}|${connection}` : null;
  const letter = useTabLetter(platform, tabId, { base: cardBase, card, reports });
  const hidden = launcher !== null && launcher.tabId === tabId ? launcher.hidden : 'none';

  const head = (gear: boolean) => (
    <header className="tia-panel__head">
      <h1 className="tia-brand"><Brand markSize={28} large /></h1>
      {gear && (
        <button type="button" className="tia-iconbutton" aria-label={COPY.mainView.settings} title={COPY.mainView.settings}
          aria-pressed={view.name === 'settings'} data-panel-settings=""
          onClick={() => setView(view.name === 'settings' ? { name: 'main' } : { name: 'settings' })}>
          <Icon name="gear" size={18} />
        </button>
      )}
    </header>
  );
  const problems = (
    <>
      <ConnectionProblem auth={auth} settingsUrl={settingsUrl} />
      <LinkProblem link={link} onReconnect={reconnect} />
    </>
  );

  if (view.name === 'editor') {
    return (
      <main className="tia-page tia-panel" ref={root} data-tab-id={tabId ?? undefined} data-view="editor">
        {head(false)}
        {problems}
        <ProfileEditor platform={platform} tailoritUrl={TAILORIT_LINKS.autofillInfo} onSaved={recheck}
          onClose={() => setView(view.back === 'settings' ? { name: 'settings' } : { name: 'main' })} />
      </main>
    );
  }

  if (gate !== 'main' || auth.status === null) {
    return (
      <main className="tia-page tia-panel" ref={root} data-tab-id={tabId ?? undefined}
        data-view={gate === 'setup' && auth.status !== null ? 'setup' : 'loading'}>
        {head(false)}
        {problems}
        {gate === 'setup' && auth.status !== null && (
          <SetupView platform={platform} status={auth.status} refresh={refresh} profile={profile} now={now}
            withAccount={withAccount} settingsUrl={settingsUrl}
            onEditProfile={() => setView({ name: 'editor', back: 'setup' })}
            onStart={() => {
              setWithAccount(false);
              setGate('main');
            }} />
        )}
      </main>
    );
  }

  if (view.name === 'settings') {
    return (
      <main className="tia-page tia-panel tia-panel--settings" ref={root} data-tab-id={tabId ?? undefined} data-view="settings">
        {head(true)}
        {problems}
        <SettingsView platform={platform} settings={settings} status={auth.status} settingsUrl={settingsUrl}
          onClose={() => setView({ name: 'main' })} onSaved={setSettings}
          onAutofillInfo={() => setView({ name: 'editor', back: 'settings' })} />
      </main>
    );
  }

  const wall = page?.wall !== undefined;
  // The v4 review (M4): the tab's application frame shows an entry choice (Workday's "Start Your Application", whose
  // address reads as the posting's): Autofill answers it with the declared entry.
  const choice = page?.choice === true;
  // A recognised posting page with no form (v3 Phase 3b): its card shows, and Autofill waits for the application; the
  // platform's page after submitting (the review) shows the card POST /applied answered, without Autofill. A posting
  // that shows an entry choice or an account wall is not one: Autofill (or Sign up & Autofill) answers it there.
  const postingOnly = page?.support === 'no-form' && (page.confirmation === true
    || (page.posting === true && !choice && !wall));
  // The platform confirmed the tab's application (the review, Jobright's "Submitted!"): no Autofill, no Cancel or Skip.
  const submitted = page?.submitted !== undefined;
  const cardJob = answered?.job ?? null;
  // v4 ui: the main button's meaning: Sign up & Autofill at an account wall; Autofill at an entry choice (a fill that
  // presses the entry); else go on with a run that waits; else Autofill.
  const meaning: MainMeaning = wall ? 'sign-up' : choice ? 'fill' : reports.some((report) => PAUSED.has(report.status))
    ? 'continue' : 'fill';
  const offersFill = tabId !== null && page?.support !== 'none' && !postingOnly && !submitted;
  // The résumé line until a run lists the résumé's own row (which then has its Preview): one the lists show (D8).
  const resumeRow = reports.some((report) => report.fields.some((row) => row.category === 'file.resume'
    && !leftOut(row)));
  /** v4 ui: which file a résumé or cover-letter row previews: the PDF the fill attached or would attach. */
  const previewOf = (row: ReportRow): PreviewKind | null => {
    if (row.category === 'file.resume') {
      return answered !== null && answered.withoutResume !== true && answered.resume?.fileKind === 'pdf' ? 'resume' : null;
    }
    const attached = row.wrote && row.status !== 'blocked';
    return attached || letter.view.outcome === 'yours' || letter.view.outcome === 'written' ? 'coverLetter' : null;
  };

  return (
    <main className="tia-page tia-panel" ref={root} data-tab-id={tabId ?? undefined} data-view="main">
      {head(true)}
      {problems}
      {auth.status.connection === 'connected' && auth.status.disclosure === 'changed' && (
        <DisclosureChanged onUnderstand={acknowledge} />
      )}
      {(agent.status?.on === true || agent.status?.pending === true || agent.status?.paused != null)
        && <AgentStatusLine platform={platform} agent={agent} />}
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
        <Unsupported reload={page.reload !== true ? null : page.site === true ? 'site' : 'ats'}
          ask={() => request(platform, { v: 1, type: 'panel/siteRequest', tabId })} />
      ) : reports.length === 0 && job.view.state === 'hidden' ? (
        <PageStrip page={page} />
      ) : null}
      {tabId !== null && page?.submitted !== undefined && (
        <Submitted state={page.submitted} job={cardJob} onRetry={() => retryApplied(tabId)} />
      )}
      {tabId !== null && page?.support !== 'none' && (
        <JobCard view={job.view} adding={adding} outcome={added !== null && added.view === viewKey ? added.outcome : null}
          now={now()} working={working} onAdd={() => void addJob(tabId)}
          searchJobs={async (query) => {
            const answer = await request(platform, { v: 1, type: 'panel/jobSearch', tabId, query });
            return answer.ok ? answer.data : null;
          }}
          chooseJob={(ref) => chooseJob(tabId, ref)} />
      )}
      {tabId !== null && postingOnly && page?.confirmation !== true && (
        <p className="tia-strip" data-strip="no-form" data-tone="neutral">{COPY.strip.noForm}</p>
      )}
      {offersFill && tabId !== null && (
        <MainButton tabId={tabId} meaning={meaning} working={busy || working} clock={seenClock}
          onRun={(message) => void run(message)} />
      )}
      {tabId !== null && page?.support !== 'none' && (
        <AskQuestion key={viewKey} ask={(question, length) => ask(tabId, question, length)} copy={copyText}
          connected={connection !== undefined && connection !== null} aiOff={aiOff === true}
          noResume={answered !== null && answered.resume === null} policy={policy} />
      )}
      {tabId !== null && answered !== null && !submitted && !resumeRow && (
        <ResumeLine card={answered} loadResumes={loadResumes}
          chooseResume={(resumeId) => chooseResume(tabId, resumeId)}
          setWithout={(without) => setWithout(tabId, without)} loadPreview={loadResumePreview} />
      )}
      {shownFeedback !== null && <p className="tia-feedback" role="status">{shownFeedback.text}</p>}
      {tabId !== null && reports.length > 0 && settingsRead && (
        <section className="tia-dashboard" aria-labelledby={dashboardId}>
          <h2 className="tia-visually-hidden" id={dashboardId}>{COPY.panelTitle}</h2>
          <Report
            reports={reports}
            notices={false}
            busy={busy}
            minimized={settings?.view === 'minimized'}
            submitted={submitted}
            {...(submitted ? {} : {
              onCancel: () => void run({ v: 1, type: 'panel/cancel', tabId }),
              // Whether the run took it: one it did not ('expired') offers Skip again (the audit of 2026-11-06, m5).
              onSkip: (frameId: number, fieldKey: string) =>
                request(platform, { v: 1, type: 'panel/skip', tabId, frameId, fieldKey }).then((answer) => answer.ok),
            })}
            onShowField={(frameId, fieldKey) => {
              void request(platform, { v: 1, type: 'panel/focus', tabId, frameId, fieldKey }).then((answer) => {
                if (!answer.ok) setFeedback({ tabId, text: COPY.panel.focusFailed, newest: Number.POSITIVE_INFINITY });
              });
            }}
            onPress={async (frameId, target, confirmed) => {
              const answer = await request(platform, { v: 1, type: 'panel/press', tabId, frameId, target, confirmed });
              return answer.ok ? answer.data : null;
            }}
            previewOf={previewOf}
            // After a run the résumé's choice lives on its row (the owner): Change, as the résumé line's.
            rowTool={(each) => (each.category !== 'file.resume' || answered === null || submitted ? null : {
              label: COPY.job.change, action: 'change',
              render: (close) => (
                <ResumePicker card={answered} loadResumes={loadResumes} onClose={close}
                  chooseResume={(resumeId) => chooseResume(tabId, resumeId)}
                  setWithout={(without) => setWithout(tabId, without)} />
              ),
            })}
            renderPreview={(kind, label, close) => (
              <ResumePreview kind={kind} load={kind === 'resume' ? loadResumePreview : loadLetterPreview}
                label={kind === 'resume' ? answered?.resume?.label ?? label : label} onClose={close} />
            )}
          />
        </section>
      )}
    </main>
  );
}

/** The main button (v4 ui): big and teal, "Autofill" or "Sign up & Autofill" (its "?" beside it), spinning while a run
 *  works. The v4 review (L4): it takes no click until what it means (what it sends, to which tab) has been shown
 *  CONTROL_SEEN_MS (seen.ts), disabled meanwhile; a click then sends the message of the meaning it shows. */
function MainButton({ tabId, meaning, working, clock, onRun }: { tabId: number; meaning: MainMeaning; working: boolean;
  clock: SeenClock; onRun(message: RunMessage): void }) {
  const seen = useShownFor(`${tabId}|${meaning}`, clock);
  const label = meaning === 'sign-up' ? COPY.mainView.signUpFill : COPY.panel.fill;
  return (
    <div className="tia-toolbar">
      <button type="button" className="tia-cta" disabled={working || !seen} data-working={working ? 'true' : undefined}
        data-main-action={meaning} onClick={() => {
          // Decided at the click, on what this render shows: a meaning not yet shown long enough is never acted on.
          if (seen && !working) onRun(mainMessageOf(meaning, tabId));
        }}>
        {working && <Icon name="spinner" size={20} className="tia-icon tia-spin" />}
        {label}
      </button>
      {meaning === 'sign-up' && (
        <HelpTip text={COPY.mainView.signUpHelp} topic={COPY.mainView.signUpFill} className="tia-toolbar__tip" />
      )}
    </div>
  );
}

/** v3 Phase 4: the platform confirmed the application: the job it was for, where the tracker stands (Try again when
 *  it could not be told), and Open Job Tracker (the review: Jobright's "Application submitted · added to your Job
 *  Tracker as Applied"). */
function Submitted({ state, job, onRetry }: { state: NonNullable<PageState['submitted']>;
  job: { title: string; company: string } | null; onRetry(): void }) {
  return (
    <section className="tia-submitted" data-submitted={state} aria-label={COPY.panel.submitted.title}>
      <p className="tia-submitted__title">
        <Icon name="check-circle" size={20} className="tia-icon tia-submitted__icon" />
        {COPY.panel.submitted.title}
      </p>
      {job !== null && (job.title !== '' || job.company !== '') && (
        <p className="tia-submitted__job" data-submitted-job="">{COPY.panel.submitted.job(job.title, job.company)}</p>
      )}
      <p className="tia-submitted__state" role="status">{COPY.panel.submitted.states[state]}</p>
      <div className="tia-submitted__actions">
        {state === 'not-recorded' && (
          <button type="button" className="tia-button" data-action="retry-applied" onClick={onRetry}>
            {COPY.panel.submitted.tryAgain}
          </button>
        )}
        <a className="tia-button" href={TAILORIT_LINKS.tracker} target="_blank" rel="noreferrer" data-tailorit-link="tracker">
          {COPY.panel.submitted.openTracker}
        </a>
      </div>
    </section>
  );
}

/** v3 Phase 3b: "Ask TailorIT to support this site": the tab's host alone goes to TailorIT; what came of it. v4 ui: what
 *  goes is said in the "?" beside the button. */
function AskForSite({ ask }: { ask(): Promise<Answer<{ outcome: SiteRequestOutcome }>> }) {
  const [state, setState] = useState<{ sending: boolean; outcome: SiteRequestOutcome | null; failed: boolean }>(
    { sending: false, outcome: null, failed: false });
  const words = COPY.panel.siteRequest;
  const send = async () => {
    setState({ sending: true, outcome: null, failed: false });
    const answer = await ask();
    setState({ sending: false, outcome: answer.ok ? answer.data.outcome : null, failed: !answer.ok });
  };
  return (
    <div className="tia-unsupported__ask" data-site-request={state.outcome ?? undefined}>
      {state.outcome !== 'sent' && (
        <span className="tia-unsupported__askrow">
          <button type="button" className="tia-button tia-button--primary" disabled={state.sending}
            data-action="site-request" onClick={() => void send()}>
            {state.sending ? words.asking : words.ask}
          </button>
          <HelpTip text={words.help} topic={words.ask} />
        </span>
      )}
      {state.outcome !== null && <p className="tia-feedback" role="status">{words.outcomes[state.outcome]}</p>}
      {state.failed && <p className="tia-feedback" role="status">{COPY.panel.failed}</p>}
    </div>
  );
}

/** A page Autofill does not work on (v3 Phase 3): the sites it works on, and (v3 Phase 3b) asking TailorIT to support
 *  this one. v4 ui: the explanations are the "?" beside the heading. */
function Unsupported({ reload, ask }: { reload: 'ats' | 'site' | null;
  ask(): Promise<Answer<{ outcome: SiteRequestOutcome }>> }) {
  const headingId = useId();
  const words = COPY.panel.unsupported;
  // A page on a supported site the extension did not see load: a reload is all it takes (v3 Phase 3 review). A
  // company's own page while the career sites act (v3 Phase 8 review, B10): a reload lets the sentinel read it.
  if (reload !== null) {
    const heading = reload === 'site' ? words.reloadSiteHeading : words.reloadHeading;
    return (
      <section className="tia-unsupported" data-unsupported={reload === 'site' ? 'reload-site' : 'reload'}
        aria-labelledby={headingId}>
        <div className="tia-unsupported__head">
          <Icon name="info" size={20} className="tia-icon tia-unsupported__icon" />
          <h2 className="tia-unsupported__title" id={headingId}>{heading}</h2>
          <HelpTip text={reload === 'site' ? words.reloadSiteIntro : words.reloadIntro} topic={heading} />
        </div>
      </section>
    );
  }
  return (
    <section className="tia-unsupported" data-unsupported="" aria-labelledby={headingId}>
      <div className="tia-unsupported__head">
        <Icon name="info" size={20} className="tia-icon tia-unsupported__icon" />
        <h2 className="tia-unsupported__title" id={headingId}>{words.heading}</h2>
        <HelpTip text={COPY.mainView.unsupportedHelp} topic={words.heading} />
      </div>
      <p className="tia-unsupported__intro">{words.intro}</p>
      <ul className="tia-unsupported__sites">
        {words.sites.map((site) => (
          <li key={site.name} className="tia-unsupported__site">
            <span className="tia-unsupported__name">{site.name}</span>
            <span className="tia-unsupported__hosts">{site.hosts}</span>
            {site.note === null ? null : <span className="tia-unsupported__note">{site.note}</span>}
          </li>
        ))}
      </ul>
      <AskForSite ask={ask} />
    </section>
  );
}

/** Before any run, when no job card says more: what the tab's page holds, from the worker's frame registry; nothing
 *  until it is known, and no "No application form" where the page shows an entry choice or an account wall, which the
 *  main button answers (the v4 review, M4). */
function PageStrip({ page }: { page: PageState | null }) {
  if (page === null) return null;
  if (page.support === 'no-form' && (page.choice === true || page.wall !== undefined)) return null;
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

/** What blocks everything, as a problem strip with a link to the settings: the worker did not answer, a version
 *  mismatch, storage the browser would not restrict. Not connected, expired and revoked are the set-up view's first
 *  step (v4 ui). Nothing while all is well. */
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
  if (problems.length === 0) return null;
  return (
    <p className="tia-connection tia-connection--problem tia-strip" data-tone="problem" data-connection={status.connection}>
      {problems.join(' ')} <a href={settingsUrl} target="_blank" rel="noreferrer">{COPY.panel.openSettings}</a>
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
