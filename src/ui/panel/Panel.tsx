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
 *     page-turned notice): its Autofill is a plain panel/fill, which the run takes as going on there. jr6 apply F1
 *     (the owner, 2026-11-10: Autofill presses the site's Apply, "and `Autofill` word will be kept"): on every page of
 *     ours with no form (a posting, a job's details, an entry choice: PageState.choice, Workday's "Start Your
 *     Application"), but the platform's page after submitting, it reads Autofill and sends a plain panel/fill: the
 *     frame presses the site's own Apply (told, PageState.entry, or drawn late) and fills what it opens; meanwhile
 *     (PageState.entering) it spins with Cancel beside it; when it cannot, one line says why (PageState.refusal; 'none'
 *     after this panel's own click is the "no form" modal). The F1 fixer (the line P review): no line under the button
 *     meanwhile, as no report comes while the frame presses or waits, and one no-form strip until a refusal says why,
 *     a posting's promising the site's Apply and any other page's not (C1, C2); a status a screen reader hears,
 *     mounted before it has words (the press, then the refusal), and Cancel taking the focus the button had (C4); the
 *     refusal said on a page Autofill does not work on too, where the press took the tab (C5). Whenever what it says
 *     and sends changes, it takes no click until the new label has been shown CONTROL_SEEN_MS (seen.ts, the v4
 *     review's L4: a page cannot flip it as the pointer comes). While a run works it spins, and the progress below has
 *     Cancel. No Dry run, Continue or Cancel buttons (the messages stay);
 *   - "Ask custom question" (Ask.tsx: panel/ask), an outline button that unfolds the box;
 *   - "Résumé: <label> · Preview · Edit · Change" (JobCard.tsx ResumeLine: panel/resumes, panel/setResume,
 *     panel/withoutResume; v1.4 F: Preview and Edit are panel/openDocument) until a run lists the résumé's own row,
 *     with "Tailor Resume For This Job" under it; and where the form asks for a cover letter, "Cover letter: <state>
 *     · Preview · Edit" with "Generate Cover Letter" (tailor.tsx: panel/tailor, read again on panel/changed 'tailor')
 *     until a run lists the letter's own row;
 *   - what the last button did, until a newer report tells more;
 *   - the progress and the field lists (Report, without its notices: D10's page notifications say what is left for
 *     the person): "7/7 required fields filled | 100%", Required then Optional, each row a tick or an empty circle and
 *     its label, which shows the field on the page (panel/focus); Skip on the field being written after 2 s
 *     (panel/skip); Preview (v1.4 F: the full-window preview page) and Show on the résumé and cover-letter rows; the dock's
 *     "Continue to the next page" or "Submit application" (panel/press); folded at first with the Minimized view.
 * - The Settings view (SettingsView.tsx) in place of everything under the head: ✕ and "Settings", the modes as radio
 *   cards with their "?", "Autofill information", the account, "All settings" and Save (settings/save {settings, base}).
 * - The profile editor (Profile.tsx: panel/profile, panel/saveProfile), from the set-up view's GO or the Settings view's
 *   "Autofill information"; its Back returns there, and a save checks the profile again.
 * When the worker says the connection or the settings changed (panel/changed, perhaps from another window), they are
 * read again, and the job card read with the old connection is dropped at once.
 *
 * v5 p1-shell (PLAN decisions 1 and 8): the same Panel is the sidebar on the page (src/ui/sidebar/mount.tsx), pinned to
 * its tab and talking over the tab's content channel; its head then also has the minimise (`shell`), which folds the
 * sidebar back to the launcher. Over every view's head, on a Workday page, the "stay on this page" note
 * (page/workday-note.tsx) until the person closes it. "Default view" no longer folds the review (settings version 8:
 * it says whether the sidebar opens by itself).
 *
 * v5 p1-panel (PLAN decisions 4 and 6; the views work in the side panel and in the on-page sidebar alike, at 384 px):
 * - The main view fills its host's height (v5-styles.ts): the head, then the stage, whose content scrolls by itself,
 *   with the progress sheet over its bottom (Sheet.tsx: the report's header and lists; up while a run works and after,
 *   folded to a strip by its header at rest), then the step dock under it. The Minimized view no longer folds the lists
 *   (since v5 the view setting says whether the sidebar opens by itself).
 * - What stopped a fill is a modal over the view (Modals.tsx): no application form, the page's form not reachable now,
 *   a failure, or the extension updated (Refresh Page, where the host passes `refreshPage`: the sidebar), with Try
 *   Again or Refresh Page; and before a fill, the autofill information's check: no work experience or no education
 *   holds the fill in a modal (Edit Autofill Information, Autofill Anyway).
 *
 * v1.5 QX (PLAN decision 9): under the main view's head, the tab bar (TabBar.tsx): Autofill (everything above, as it
 * was) and Queue (QueueView.tsx: the sequential auto-apply's progress, seconds left, Start or Stop, Pause or Resume, and
 * every queued job's status). The Settings view and the profile editor show no tab bar.
 *
 * It never shows or receives a field value: reports hold none. The job card draws only what TailorIT's lookup said, the
 * resume's title among it (which may be the person's name: it is shown on purpose, as the resume the fill attaches);
 * the custom question's answer is the person's own request; the profile check keeps which items are missing, never a
 * value (profile-check.ts); the previews open in the full-window preview page (v1.4 F), whose bytes stay there.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Settings } from '../../core/types/settings';
import type { Answer } from '../../messaging/envelope';
import type {
  AddJobOutcome, AskLength, PageMessage, PageState, PanelLauncherAnswer, SiteRequestOutcome, WallWaits,
} from '../../messaging/schemas';
import type { PagePlatform } from '../../platform/types';
import { COPY } from '../../shared/copy';
import { leftOut, saysNoAi, type FrameReport } from '../../shared/report';
import { Brand } from '../brand/Logo';
import { Icon } from '../brand/Icon';
import { AgentStatusLine, useAgentStatus } from '../page/agent';
import { DisclosureChanged } from '../page/disclosure';
import { WorkdayNote } from '../page/workday-note';
import { HelpTip } from '../page/HelpTip';
import { request } from '../page/request';
import { useAuthStatus, type AuthState } from '../page/use-auth';
import { accountStepOf, isWorking, type ReportRow } from '../report/model';
import { Report, type PreviewKind } from '../report/Report';
import { StepDock } from '../report/StepDock';
import { AskQuestion } from './Ask';
import { useTabJob } from './job';
import { JobCard, ResumeLine, ResumePicker } from './JobCard';
import { useTabLetter } from './letter';
import { PanelModal, type PanelModalState, type StopReason } from './Modals';
import { ProfileEditor } from './Profile';
import { LetterLine, TailorRow, useTabTailor } from './tailor';
import { useTabReports, type LinkState } from './reports';
import { SettingsView } from './SettingsView';
import { ProgressSheet, useSheetTop } from './Sheet';
import { SetupView } from './Setup';
import { QueueView } from './QueueView'; // v1.5 QX
import { TabBar, tabIds, type PanelTab } from './TabBar'; // v1.5 QX
import { useProfileCheck } from './profile-check';
import { BROWSER_SEEN_CLOCK, useShownFor, type SeenClock } from './seen';
import { useFollowedTab } from './tab';
import { adoptPanelV5Styles } from './v5-styles';

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
  /** v5 p1-panel: reloads the page the panel is drawn on, for the "extension updated" modal's Refresh Page: the on-page
   *  sidebar's host passes it; the side panel has none (its own strip says to open it again). */
  refreshPage?: () => void;
  /** v5 p1-shell: the sidebar on the page's own controls (none in Chrome's side panel and the report page). */
  shell?: PanelShell;
}

/** v5 p1-shell: what the sidebar adds to the panel's head. */
export interface PanelShell {
  /** The minimise: the sidebar folds back to the launcher at the page's edge. */
  minimise(): void;
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

/** s2 profile (the review fix P1): what a page with no run waits for (PageState.waits), in its wall's toast's own
 *  words, said here when the page's toasts are not shown until closed. */
const PAGE_WAITS: Readonly<Record<WallWaits, string>> = {
  challenge: COPY.toasts.challenge,
  'sign-in': COPY.toasts.signIn,
  'sign-in-failed': COPY.toasts.signInFailed,
  'no-sign-in': COPY.toasts.noSignIn,
  'sign-in-typed': COPY.toasts.signInTyped,
};

/** jr6 apply F1 (APPLYPLAN F1 item 4): how long after this panel's own Autofill an entry refused 'none' (no Apply and no
 *  form came) is its answer, said in the "no form" modal rather than the strip alone. */
const ENTRY_MODAL_MS = 30_000;

/** What the main button says and sends: Autofill, Sign up & Autofill, or (labelled Autofill) go on with a paused run;
 *  v5 p2-fill: 'open', on a posting whose site offers its own Apply (a panel/fill: its frame presses it). jr6 apply F1
 *  (the owner, 2026-11-10: "`Autofill` word will be kept"): 'open' reads Autofill too, and shares 'fill''s seen key. */
type MainMeaning = 'fill' | 'sign-up' | 'continue' | 'open';

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

/** v5 p1-panel (PLAN decision 6): what stopped a fill or a Continue, said in a modal (Modals.tsx), or null when the
 *  answer says nothing the modal would (it started, the person is not connected or asked too often: the line under the
 *  button says those, as before). A Cancel never opens one. `formShown`: the tab's page shows a form of ours, so a fill
 *  no frame took is a form not reachable now, not a page without one; `gone`: the extension's runtime is gone (updated
 *  or removed), which only a host that can reload its page says in a modal. */
function stopOf(message: RunMessage, answer: Answer<{ frames: number }>, formShown: boolean, gone: boolean):
  StopReason | null {
  if (message.type === 'panel/cancel') return null;
  if (answer.ok) {
    if (answer.data.frames > 0 || message.type !== 'panel/fill') return null;
    return formShown ? 'unavailable' : 'no-form';
  }
  if (answer.error === 'not_connected' || answer.error === 'rate_limited') return null;
  return gone ? 'updated' : 'failed';
}
// end v5 p1-panel

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
type View = { name: 'main' } | { name: 'settings' } | { name: 'editor'; back: 'setup' | 'settings' | 'main' };

export function Panel({ platform, pinnedTabId, now = Date.now, copyText = clipboardCopy,
  seenClock = BROWSER_SEEN_CLOCK, shell, refreshPage }: PanelProps) {
  const root = useRef<HTMLElement>(null);
  const dashboardId = useId();
  // v5 p1-panel: the main view's stage, its scrolling content and the anchor under the job card the sheet rises to.
  const stage = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  /** v5 p1-panel: the modal shown over the main view, for the tab it was raised on, with the fill it holds back (the
   *  history check's) or the message its Try Again sends again. */
  const [modal, setModal] = useState<{ tabId: number; state: PanelModalState; message: RunMessage | null } | null>(null);
  /** v5 p1-panel: the person closed the "extension updated" modal (it is not raised again in this panel's life). */
  const [goneSeen, setGoneSeen] = useState(false);
  /** jr6 apply F1: this panel's last Autofill (a panel/fill) and when it was sent (`now`); `armed` once the tab's page
   *  shows no entry refused 'none' after it (see `refusal` below). */
  const [asked, setAsked] = useState<{ message: RunMessage; at: number; armed: boolean } | null>(null);
  const sheetTop = useSheetTop(stage, anchor, scroller, true);
  /** The main view's element: the hooks' root, and where the v5 stylesheet is adopted (its document or shadow root). */
  const mainRef = useCallback((node: HTMLElement | null) => {
    root.current = node;
    if (node !== null) adoptPanelV5Styles(node);
  }, []);
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
  /** v1.5 QX: the main view's tab (Autofill or Queue), and the ids its tabs and panels take. */
  const [tab, setTab] = useState<PanelTab>('autofill');
  const tabsId = useId();
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
  // v1.4 F: the tab's tailoring, read for its page under this connection, and again as the worker says it moved on.
  const tailorBase = tabId !== null && page !== null && typeof connection === 'string'
    ? `${tabId}|${page.formKey ?? ''}|${connection}` : null;
  const tailor = useTabTailor(platform, tabId, { base: tailorBase, changes: changes.tailor, onDone: job.reload });
  const settingsUrl = platform.runtime.getURL('/options.html');
  /** AI-written answers (the drafts setting) are off: the custom question is too. */
  const aiOff = settings === null ? null : !settings.llm.drafts;

  // v4 ui: whether the autofill information is complete (profile-check.ts), read while connected.
  const { check: profile, recheck } = useProfileCheck(platform, typeof connection === 'string' ? connection : null);
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
  // jr6 apply F1 (APPLYPLAN F1 item 4, AF-12): why the tab's last entry was refused (an older frame's names no reason:
  // 'none'). 'none' that answers this panel's own Autofill (`asked`, within ENTRY_MODAL_MS, once the page showed no
  // 'none' since the click: an old refusal is not its answer) opens the "no form" modal, with Try Again; else, and every
  // other reason, it is the strip's one line. The F1 fixer (the line P review, C5): on any page without a form, one
  // Autofill does not work on included, where the worker says the press took the tab ('elsewhere', reports.ts).
  const refusal = page?.entryRefused === true && page.support !== 'form' ? page.refusal ?? 'none' : null;
  if (asked !== null && asked.message.tabId === tabId) {
    // Adjusted while rendering, as the gate above.
    if (refusal !== 'none') {
      if (!asked.armed) setAsked({ ...asked, armed: true });
    } else if (asked.armed) {
      setAsked(null);
      if (now() - asked.at <= ENTRY_MODAL_MS) {
        setModal({ tabId: asked.message.tabId, state: { kind: 'error', reason: 'no-form' }, message: asked.message });
      }
    }
  }

  // The connection changed (a token stored or dropped, in this window or another), or (jr6) the job-site password was
  // saved or deleted: read it again.
  useEffect(() => {
    if (changes.connection > 0 || changes.signup > 0) refresh();
  }, [changes.connection, changes.signup, refresh]);

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
    if (message.type === 'panel/fill') setAsked({ message, at: now(), armed: refusal !== 'none' }); // jr6 apply F1
    // The F1 fixer (the line P review, C1): Autofill or its Cancel on a page with no form says nothing under the button
    // once the worker took it. The frame looks again, presses the site's Apply or waits for what it brings, and no
    // report comes meanwhile, so a run line would stand beside the strip and every refusal: the button's spinner and
    // Cancel, then the run's progress or the refusal's line say what happens.
    const quiet = page?.support === 'no-form' && message.type !== 'panel/continue';
    setBusy(true);
    const answer = await request(platform, message);
    setBusy(false);
    // v5 p1-panel (PLAN decision 6): what stopped it is a modal (Modals.tsx), with Try Again; an update says Refresh
    // Page only where the host can reload its page.
    const stop = stopOf(message, answer, page?.support === 'form',
      refreshPage !== undefined && !answer.ok && !platform.runtime.isValid());
    if (stop !== null || (quiet && answer.ok)) {
      setFeedback(null);
      if (stop !== null) setModal({ tabId: message.tabId, state: { kind: 'error', reason: stop }, message });
      return;
    }
    setFeedback({ tabId: message.tabId, text: feedbackOf(message, answer), newest });
    if (!answer.ok && answer.error === 'not_connected') refresh();
  };

  /** The F1 fixer (the line P review, C4): the main button had the focus at its last click. The button is held while
   *  the frame presses or waits (a held button keeps no focus: it goes to the page's body), so the Cancel shown
   *  meanwhile takes it, unless the person put it somewhere since. */
  const focusCancel = useRef(false);
  const takeFocus = useCallback((node: HTMLButtonElement | null) => {
    if (node === null || !focusCancel.current) return;
    focusCancel.current = false;
    if (node.ownerDocument.activeElement === node.ownerDocument.body) node.focus();
  }, []);

  /** v5 p1-panel: the main button's click. A fill (not a Continue) first checks the autofill information for work
   *  experience and education (Jobright's resume check): either missing opens the history modal, which holds the fill
   *  until the person chooses Autofill Anyway or edits the information. The F1 fixer (C4): `focused`, whether the
   *  button had the focus. */
  const start = (message: RunMessage, focused: boolean) => {
    focusCancel.current = focused;
    const missing = message.type === 'panel/fill' && profile.state === 'read' ? profile.history : [];
    if (missing.length > 0) {
      setModal({ tabId: message.tabId, state: { kind: 'history', missing }, message });
      return;
    }
    void run(message);
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

  /** v1.4 F (PLAN decision 17): Preview (the full-window preview page) or Edit (TailorIT's editor) of what the tab
   *  attaches, each opened by the worker in a tab of its own; nothing there yet is said under the buttons. */
  // v1.5 X (PLAN decisions 2 and 3): Preview shows the dialog over the tab's page (its tabs the documents this panel
  // previews, `kinds`), else the full-window page; Edit of an uploaded resume confirms first, over the page, or here
  // (`confirm: 'panel'`: the page could not), Continue sending it again with the person's word.
  const openDocument = (target: number, kind: PreviewKind, how: 'preview' | 'edit',
    extra: { kinds?: PreviewKind[]; confirmed?: true; skipConfirm?: boolean } = {}) => {
    void request(platform, { v: 1, type: 'panel/openDocument', tabId: target, kind, how, ...extra }).then((answer) => {
      if (answer.ok && answer.data.opened) return;
      if (answer.ok && answer.data.confirm === 'page') return;
      if (answer.ok && answer.data.confirm === 'panel') {
        setModal({ tabId: target, state: { kind: 'edit-upload' }, message: null });
        return;
      }
      setFeedback({ tabId: target, text: answer.ok ? COPY.tailor.nothingToOpen : refusalOf(answer.error),
        newest: Number.POSITIVE_INFINITY });
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
    <>
      {/* v5 p1-shell: Workday's "stay on this page" note, over the head. */}
      <WorkdayNote platform={platform} shown={page?.platform === 'workday'} />
      <header className="tia-panel__head">
        <h1 className="tia-brand"><Brand markSize={28} large /></h1>
        <span className="tia-panel__tools">
          {gear && (
            <button type="button" className="tia-iconbutton" aria-label={COPY.mainView.settings} title={COPY.mainView.settings}
              aria-pressed={view.name === 'settings'} data-panel-settings=""
              onClick={() => setView(view.name === 'settings' ? { name: 'main' } : { name: 'settings' })}>
              <Icon name="gear" size={18} />
            </button>
          )}
          {shell !== undefined && (
            <button type="button" className="tia-iconbutton" aria-label={COPY.sidebar.minimise} title={COPY.sidebar.minimise}
              data-panel-minimise="" onClick={() => shell.minimise()}>
              <Icon name="minimise" size={18} />
            </button>
          )}
        </span>
      </header>
    </>
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
          onClose={() => setView({ name: 'main' })} onSaved={(saved) => {
            setSettings(saved);
            // v5 p1-shell (the review's F1): the sidebar that chose Chrome's side panel folds away at once.
            if (shell !== undefined && saved.panel === 'side') shell.minimise();
          }}
          onAutofillInfo={() => setView({ name: 'editor', back: 'settings' })} />
      </main>
    );
  }

  const wall = page?.wall !== undefined;
  // The v4 review (M4): the tab's application frame shows an entry choice (Workday's "Start Your Application", whose
  // address reads as the posting's): Autofill answers it with the declared entry.
  const choice = page?.choice === true;
  // v5 p2-fill (PLAN Phase 2): a posting with no form whose site offers its own Apply (PageState.entry): the main button
  // (jr6 apply F1: labelled Autofill) means 'open', and its panel/fill presses that Apply, then fills what it opens.
  const entry = page?.support === 'no-form' && page.entry === true && page.confirmation !== true && !choice && !wall;
  // jr6 apply F1 (APPLYPLAN D2, AF-2): Autofill is offered on every page of ours with no form but the platform's page
  // after submitting (the review: its card POST /applied answered, without Autofill), and the page the platform
  // confirmed (`submitted`). On a posting with no told Apply it is a plain fill: the frame looks again, waits for a late
  // Apply, presses it, or says why not (PageState.refusal). The strip says what Autofill does there.
  const afterSubmit = page?.support === 'no-form' && page.confirmation === true;
  // The F1 fixer (the line P review, C1): drawn once (PageStrip draws no posting's), and only until a refusal's line
  // says why instead.
  const postingStrip = page?.support === 'no-form' && page.posting === true && !afterSubmit && !choice && !wall
    && !entry && refusal === null;
  // jr6 apply F1 (APPLYPLAN F1 item 3): the frame presses the site's Apply or waits for what it brings: the button
  // spins, disabled, its word unchanged, and Cancel shows.
  const entering = page?.entering === true;
  // The platform confirmed the tab's application (the review, Jobright's "Submitted!"): no Autofill, no Cancel or Skip.
  const submitted = page?.submitted !== undefined;
  const cardJob = answered?.job ?? null;
  // v4 ui: the main button's meaning: Sign up & Autofill at an account wall; Autofill at an entry choice (a fill that
  // presses the entry); else go on with a run that waits; else Autofill.
  const meaning: MainMeaning = wall ? 'sign-up' : choice ? 'fill' : reports.some((report) => PAUSED.has(report.status))
    ? 'continue' : entry ? 'open' : 'fill';
  const offersFill = tabId !== null && page?.support !== 'none' && !afterSubmit && !submitted;
  // s2 profile (the review fix P1): the page's toasts may be gone (timed) or never drawn ('off') while the page still
  // waits, so the panel says what for: a paused run's line (the report's saysWaits), and a page with no run's wall.
  const toastsMayGo = settings !== null && settings.modes.notifications !== 'until-closed';
  const pageWaits = toastsMayGo && page?.waits !== undefined ? page.waits : null;
  // The résumé line until a run lists the résumé's own row (which then has its Preview): one the lists show (D8).
  const resumeRow = reports.some((report) => report.fields.some((row) => row.category === 'file.resume'
    && !leftOut(row)));
  // v1.4 F: likewise the cover-letter line, until a run lists the letter's own row.
  const letterRow = reports.some((report) => report.fields.some((row) => (row.category === 'file.coverLetter'
    || row.category === 'freeText.coverLetter') && !leftOut(row)));
  /** v4 ui: which file a résumé or cover-letter row previews: the PDF the fill attached or would attach. */
  const previewOf = (row: ReportRow): PreviewKind | null => {
    if (row.category === 'file.resume') {
      return answered !== null && answered.withoutResume !== true && answered.resume?.fileKind === 'pdf' ? 'resume' : null;
    }
    const attached = row.wrote && row.status !== 'blocked';
    return attached || letter.view.outcome === 'yours' || letter.view.outcome === 'written' ? 'coverLetter' : null;
  };
  // v1.5 X (PLAN decision 2): the documents this panel previews for the tab, for the dialog's tabs (`kind` among them).
  const previewKinds = (kind: PreviewKind): PreviewKind[] => {
    const resume = answered !== null && answered.withoutResume !== true && answered.resume?.fileKind === 'pdf';
    const letterRows = reports.some((report) => report.fields.some((row) => (row.category === 'file.coverLetter'
      || row.category === 'freeText.coverLetter') && previewOf(row) === 'coverLetter'));
    const letterShown = letterRows || letter.view.outcome === 'yours' || letter.view.outcome === 'written'
      || (tailor.view?.state === 'done' && tailor.view.letter);
    return (['resume', 'coverLetter'] as const).filter((each) => each === kind
      || (each === 'resume' ? resume : letterShown));
  };
  // v1.5 X: Preview with the dialog's tabs; Edit as it was (its confirm comes from the worker).
  const openOf = (target: number) => (kind: PreviewKind, how: 'preview' | 'edit') =>
    openDocument(target, kind, how, how === 'preview' ? { kinds: previewKinds(kind) } : {});

  // v5 p1-panel (PLAN decision 4): the progress sheet over the stage's bottom, up while a run works (or signs in for
  // it), and the step dock under the stage; (decision 6) the modal over the view, for the tab it was raised on.
  const sheetShown = tabId !== null && reports.length > 0 && settingsRead;
  const sheetWorking = working || accountStepOf(reports)?.progress === 'working';
  const shownModal: PanelModalState | null = modal !== null && modal.tabId === tabId ? modal.state
    : link === 'gone' && refreshPage !== undefined && !goneSeen ? { kind: 'error', reason: 'updated' } : null;
  const closeModal = () => {
    if (modal === null && shownModal !== null) setGoneSeen(true);
    setModal(null);
  };
  // jr6 apply F1: why the site's Apply was not pressed or followed, in words (not under the "no form" modal, which says
  // it after this panel's own click); the F1 fixer (C4): while the frame presses or waits with no run working.
  const said = tabId === null || refusal === null || (refusal === 'none' && shownModal !== null) ? null
    // jr7 INT-7 (ICIMS-7's item, D-6): a Jibe job page's Apply leads to its iCIMS application; the line names iCIMS.
    : refusal === 'elsewhere' && page?.platform === 'jibe' ? COPY.mainView.elsewhereIcims
    : COPY.mainView.entryRefused[refusal];
  const pressing = offersFill && tabId !== null && entering && !working;
  // v5 p2-fill review (L5), jr6 apply F1 (AF-12): that one line (under the main button; above the sites Autofill works
  // on where the press took the tab to a page it does not work on, the F1 fixer's C5).
  const refusalLine = said !== null && (
    <p className="tia-strip" data-strip="entry-refused" data-reason={refusal ?? undefined} data-tone="warning">
      {said}
    </p>
  );

  // v1.5 QX: the Queue tab in place of everything under the tab bar.
  if (tab === 'queue') {
    return (
      <main className="tia-page tia-panel" ref={mainRef} data-tab-id={tabId ?? undefined} data-view="main"
        data-panel-tab="queue">
        {head(true)}
        <TabBar tab={tab} onChange={setTab} idPrefix={tabsId} />
        <div className="tia-stage">
          <div className="tia-stage__scroll">
            {problems}
            <QueueView platform={platform} changes={changes.queue + changes.connection + changes.settings + changes.agent}
              clock={seenClock} id={tabIds(tabsId, 'queue').panel} labelledBy={tabIds(tabsId, 'queue').tab} />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="tia-page tia-panel" ref={mainRef} data-tab-id={tabId ?? undefined} data-view="main"
      data-panel-tab="autofill">
      {head(true)}
      <TabBar tab={tab} onChange={setTab} idPrefix={tabsId} />
      <div className="tia-stage" ref={stage} data-sheet={sheetShown ? '' : undefined} role="tabpanel"
        id={tabIds(tabsId, 'autofill').panel} aria-labelledby={tabIds(tabsId, 'autofill').tab}>
        <div className="tia-stage__scroll" ref={scroller}>
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
          {page?.support === 'none' && refusalLine}
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
          {/* v5 p1-panel: where the sheet's top goes while it is up (Sheet.tsx): just under the job card. */}
          <div className="tia-sheet-anchor" ref={anchor} aria-hidden="true" />
          {tabId !== null && postingStrip && (
            <p className="tia-strip" data-strip="no-form" data-tone="neutral">{COPY.strip.posting}</p>
          )}
          {tabId !== null && pageWaits !== null && (
            <p className="tia-strip" data-strip="page-waits" data-page-waits={pageWaits} data-tone="warning" role="status">
              {PAGE_WAITS[pageWaits]}
            </p>
          )}
          {offersFill && tabId !== null && (
            <MainButton tabId={tabId} meaning={meaning} working={busy || working || entering} clock={seenClock}
              onRun={start} saved={auth.status.signUp !== 'not-set'} />
          )}
          {/* jr6 apply F1: Cancel while the frame presses or waits and no run's progress offers one (the F1 fixer's
              C4: with the focus the main button had). */}
          {pressing && (
            <button type="button" className="tia-linkbutton" data-action="cancel" ref={takeFocus}
              onClick={() => void run({ v: 1, type: 'panel/cancel', tabId })}>{COPY.panel.cancel}</button>
          )}
          {/* The F1 fixer (the line P review, C4): a status a screen reader hears, mounted before it has anything to
              say (a line drawn already filled may go unheard): the press, then why it stopped. */}
          {tabId !== null && (
            <p className="tia-visually-hidden" role="status" data-entry-status="">
              {/* jr6 SHELL-A (APPLY-MERGE round 2 §8 item 10): beside a wall, the frame does the sign-in step. */}
              {pressing ? (wall ? COPY.mainView.signingIn : COPY.mainView.entering) : said}
            </p>
          )}
          {page?.support !== 'none' && refusalLine}
          {tabId !== null && page?.support !== 'none' && (
            <AskQuestion key={viewKey} ask={(question, length) => ask(tabId, question, length)} copy={copyText}
              connected={connection !== undefined && connection !== null} aiOff={aiOff === true}
              noResume={answered !== null && answered.resume === null} policy={policy} />
          )}
          {tabId !== null && answered !== null && !submitted && !resumeRow && (
            <ResumeLine card={answered} loadResumes={loadResumes}
              chooseResume={(resumeId) => chooseResume(tabId, resumeId)}
              setWithout={(without) => setWithout(tabId, without)}
              openDocument={openOf(tabId)}>
              <TailorRow kind="resume" tabId={tabId} view={tailor.view} clock={seenClock} onStart={tailor.start} />
            </ResumeLine>
          )}
          {/* v1.4 F: the cover letter, where the form asks for one, until a run lists its own row. */}
          {tabId !== null && answered !== null && !submitted && letterAsked && !letterRow && (
            <LetterLine outcome={letter.view.outcome} checking={letter.view.checking}
              tailored={tailor.view?.state === 'done' && tailor.view.letter}
              onOpen={openOf(tabId)}>
              <TailorRow kind="coverLetter" tabId={tabId} view={tailor.view} clock={seenClock} onStart={tailor.start} />
            </LetterLine>
          )}
          {shownFeedback !== null && <p className="tia-feedback" role="status">{shownFeedback.text}</p>}
        </div>
        {sheetShown && tabId !== null && (
          <ProgressSheet working={sheetWorking} top={sheetTop} labelledBy={dashboardId}>
            {(control) => (
              <Report
                reports={reports}
                notices={false}
                busy={busy}
                sheet={control}
                wall={page?.wall ?? null}
                // s2 profile (P1): with the page's notifications not shown until closed, a paused run's line says what
                // it waits for.
                saysWaits={toastsMayGo}
                submitted={submitted}
                // The Phase 1 review (F4): while the run waits for the person's Continue the main button (which sends
                // it) lies under the sheet: the sheet's header offers Continue too, held as the main button is.
                {...(offersFill && meaning === 'continue' && !busy && !sheetWorking ? {
                  onContinue: () => void run({ v: 1, type: 'panel/continue', tabId }), clock: seenClock } : {})}
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
                // v1.4 F (PLAN decision 17): the full-window preview page, never under the row; v1.5 X: the dialog
                // over the tab's page, else that page.
                openPreview={(kind) => openOf(tabId)(kind, 'preview')}
                // v1.5 X (PLAN decision 3): the résumé row's Edit, in Show's place, for an attached resume.
                {...(answered !== null && answered.withoutResume !== true && answered.resume !== null && !submitted
                  ? { openEdit: (kind: PreviewKind) => openOf(tabId)(kind, 'edit') } : {})}
              />
            )}
          </ProgressSheet>
        )}
      </div>
      {/* v5 p1-panel: the dock's "Continue To The Next Page" and "Submit Application" stay under the sheet (Jobright's). */}
      {sheetShown && tabId !== null && (
        <StepDock reports={reports} submitted={submitted} clock={seenClock} onPress={async (frameId, target, confirmed) => {
          const answer = await request(platform, { v: 1, type: 'panel/press', tabId, frameId, target, confirmed });
          return answer.ok ? answer.data : null;
        }} />
      )}
      {shownModal !== null && (
        <PanelModal modal={shownModal} clock={seenClock} onClose={closeModal}
          {...(refreshPage === undefined ? {} : { onRefresh: refreshPage })}
          onRetry={() => {
            const again = modal?.message ?? null;
            setModal(null);
            if (again !== null) void run(again);
          }}
          onEdit={() => {
            setModal(null);
            setView({ name: 'editor', back: 'main' });
          }}
          onAnyway={() => {
            const held = modal?.message ?? null;
            setModal(null);
            if (held !== null) void run(held);
          }}
          // v1.5 X: the upload edit confirm's Continue, where the page could not show it.
          onContinueEdit={(skip) => {
            const target = modal?.tabId ?? null;
            setModal(null);
            if (target !== null) openDocument(target, 'resume', 'edit', { confirmed: true, skipConfirm: skip });
          }} />
      )}
    </main>
  );
}

/** The main button (v4 ui): big and teal, "Autofill" or "Sign up & Autofill" (its "?" beside it), spinning while a run
 *  works. The v4 review (L4): it takes no click until what it means (what it sends, to which tab) has been shown
 *  CONTROL_SEEN_MS (seen.ts), disabled meanwhile; a click then sends the message of the meaning it shows. The jr6 review
 *  (R5): with no job-site password saved (`saved` false), Sign up & Autofill's "?" says to save one first. jr6 apply F1:
 *  on a page whose site offers its own Apply ('open') it reads Autofill, its "?" saying that Autofill presses that
 *  Apply first; while the frame presses or waits (PageState.entering) it spins, disabled, its word unchanged. The F1
 *  fixer (the line P review, C4): busy (aria-busy) while it spins, and its click says whether it had the focus. */
function MainButton({ tabId, meaning, working, clock, onRun, saved }: { tabId: number; meaning: MainMeaning;
  working: boolean; clock: SeenClock; onRun(message: RunMessage, focused: boolean): void; saved: boolean }) {
  // jr6 apply F1 (APPLYPLAN D1): 'open' and 'fill' read the same word and send the same panel/fill, so they share one
  // seen key: an Apply the page draws late, flipping 'fill' to 'open', never drops a click the person aimed at Autofill.
  const seen = useShownFor(`${tabId}|${meaning === 'open' ? 'fill' : meaning}`, clock);
  // jr6 apply F1: one word, Autofill, for every meaning but Sign Up & Autofill at an account wall (OQ1: kept).
  const label = meaning === 'sign-up' ? COPY.mainView.signUpFill : COPY.panel.fill;
  return (
    <div className="tia-toolbar">
      <button type="button" className="tia-cta" disabled={working || !seen} data-working={working ? 'true' : undefined}
        aria-busy={working ? 'true' : undefined} data-main-action={meaning} onClick={(event) => {
          // Decided at the click, on what this render shows: a meaning not yet shown long enough is never acted on.
          if (seen && !working) onRun(mainMessageOf(meaning, tabId), event.currentTarget.matches(':focus'));
        }}>
        {working && <Icon name="spinner" size={20} className="tia-icon tia-spin" />}
        {label}
      </button>
      {meaning === 'sign-up' && (
        <HelpTip text={saved ? COPY.mainView.signUpHelp : COPY.mainView.signUpNeedsPassword}
          topic={COPY.mainView.signUpFill} className="tia-toolbar__tip" />
      )}
      {meaning === 'open' && (
        <HelpTip text={COPY.mainView.entryHelp} topic={COPY.panel.fill} className="tia-toolbar__tip" />
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
 *  main button answers (the v4 review, M4). jr6 apply F1: nor on the platform's page after submitting, which offers no
 *  Autofill. The F1 fixer (the line P review, C1 and C2): a page with no form that is no posting says to open a job's
 *  application (STRIP.noForm: it promises no Apply, as a list of jobs shows several); a posting's strip, which says
 *  Autofill presses the site's Apply first, the main view draws once, under its card; and none once an entry was
 *  refused, whose line says why. */
function PageStrip({ page }: { page: PageState | null }) {
  if (page === null) return null;
  // v5 p2-fill: nor where the site offers its own Apply (the main button's "?" says what Autofill does there).
  if (page.support === 'no-form' && (page.choice === true || page.wall !== undefined || page.entry === true
    || page.confirmation === true || page.posting === true || page.entryRefused === true)) return null;
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
