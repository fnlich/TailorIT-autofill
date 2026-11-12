/*
 * The service worker: the one place that holds the token, the profile and the vocabularies, plans each frame's writes
 * and talks to TailorIT. Every listener is registered synchronously before any await, so the event that woke the
 * worker is delivered. Content messages wait for the storage access level (storage.local closed to content scripts)
 * before they are handled, except panel/open, which must reach sidePanel.open before anything is awaited.
 *
 * The core comes in as one injected set (core.ts): this file passes the real functions, the tests pass fakes.
 */
import { persistableCanaries } from '../core/guard/canary';
import { policyHits } from '../core/guard/policy';
import { planFrame } from '../core/plan/frame';
import { attachResume, canonicalizeProfile } from '../core/profile/canonicalize';
import type { RunState } from '../core/types/run';
import { ok, refuse } from '../messaging/envelope';
import { type ContentMessage } from '../messaging/schemas';
import { ExternalMessageSchema } from '../messaging/page-schemas';
import { createWorkerPlatform } from '../platform/chrome';
import type { PortLike, WorkerPlatform } from '../platform/types';
import { log } from '../shared/log';
import { AGENT_ALARM, createAgent, type Agent } from './agent';
import { createQueueRunner, QUEUE_ALARM, type QueueRunner } from './queue-runner'; // v1.5 QX
import { createAuth, createTokenKeeper } from './auth';
import { toBase64Url } from './bytes';
import { createAiTasks } from './ai-tasks';
import { ASK_LIMIT, createAsk } from './ask';
import { checkLetter, createPanelLetters, LETTER_LIMIT } from './cover-letters';
import { createAnswerHandlers } from './row-actions';
import type { CoreFunctions } from './core';
import {
  agentFramesOf, cardFrameOf, chainOf, claimFrameOf, createFrameSweep, forgetFrames, forgetTab as forgetTabFrames,
  frameEntry, framesOfTab, frameTarget, navOf, registerFrame, setWall, wallFrameOf, type FrameChain, type FrameEntry,
} from './frames';
import { createChains } from './chain';
import { createJobCards, JOB_RELAY_LIMIT, LOOKUP_ON_LOAD_LIMIT, type JobCards } from './job-cards';
import { createLauncherStore, LAUNCHER_LIMIT } from './launcher';
import { createLearnedListStore, LEARNED_LISTS_LIMIT } from './learned-lists';
import { storedListsOf } from './stored-lists';
import { createKeyedQueue, createRateLimit } from './locks';
import { createAcceptBook, createMatchCache } from './match-cache';
import { createPanelHandlers, openSidePanel } from './panel';
import { createPlanner } from './planner';
import { createPolicyBook, POLICY_HIT_LIMIT } from './policy';
import { createProfileCache, type ProfileCache } from './profile-cache';
import { createProfileEditor, PROFILE_EDIT_LIMIT } from './profile-editor';
import { createSiteRequests, SITE_REQUEST_LIMIT } from './site-requests';
import {
  CONFIRMATION_PAGE_MS, createSubmissions, SUBMIT_ARM_PREFIX, SUBMIT_MESSAGE_LIMIT, type Submissions,
} from './submissions';
// v1.3 B
import { categoryOfSpec } from './submitted-forms';
import { createKnownForms, type KnownForms } from './known-forms';
import { createReports, PANEL_SHOWN_LIMIT, REPORT_PUT_LIMIT, type Reports } from './reports';
import { createTailoring, editorUrlOf, OPEN_DOCUMENT_LIMIT, TAILOR_LIMIT, type Tailoring } from './tailor'; // v1.4 F
import { createDocumentDialogs } from './document-dialog'; // v1.5 X
import { fillsFromProfileOnly, latestReport, saysNoAi } from '../shared/report';
import { SIGNUP_SECTION } from '../shared/sidebar';
import { createResumeChooser } from './resume-choice';
import { createResumeTransfer } from './resume-transfer';
import { createRouter, type ContentChannel } from './router';
import { beginRun, keyFitsFrame, RUN_BEGIN_LIMIT } from './run-begin';
import { createRunRegistry, type RunRegistry } from './runs';
import { createRunStateStore } from './runstate-store';
import { channelOf, isConnectPage, offAtsChannelOf, offAtsSenderOf, SIDEBAR_PORTS, sidebarChannel } from './senders';
import { createServerClient } from './server-client';
import { contentSettingsOf, createSettingsStore, mergeSettings, pushSettings } from './settings';
import { createSidebar, createSidebarVet, iconReachesPage, scopedPort, SIDEBAR_LOAD_LIMIT } from './sidebar';
import { createPagePatches, PAGE_PATCHES_LIMIT } from './page-patches';
import { createSignIn } from './sign-in';
import { createSignUps, ENTRY_PRESSED_LIMIT } from './sign-up';
import { createSignup, holdsSignInAuto } from './signup';
import { createSignupVault } from './signup-vault';
import { createSites, RECOGNISED_LIMIT } from './sites';
import { createTelemetry } from './telemetry';
import { systemTimers, type Timers } from './timers';
import { bundledVocab } from './vocab';
import { createCaptureWorkerPlatform } from '../platform/chrome';
import type { CaptureWorkerPlatform } from '../platform/types';
import { registerCaptureHotkeys } from './capture';

export interface WorkerState {
  /** Whether Chrome agreed to keep storage.local away from content scripts. 'refused' blocks filling, and the options
   *  page says so (auth/status). */
  storageAccess: 'pending' | 'restricted' | 'refused';
  /** Settles once the start-up work (the access level, then pruning expired RunStates) is done. */
  ready: Promise<void>;
}

/** What the worker is built from; each part defaults to the real one. */
export interface WorkerOptions {
  platform?: WorkerPlatform;
  core?: CoreFunctions;
  timers?: Timers;
  /** TailorIT's origin; the build's __TAILORIT_ORIGIN__ by default. */
  origin?: string;
  /** Development builds only: the snapshot hotkeys' commands and background tab (capture.ts). */
  capture?: CaptureWorkerPlatform;
  /** v3 Phase 3: whether a form's hello looks its job up as the page loads (true by default; the worker's tests of
   *  other messages turn it off, so they see only the messages those set off). */
  lookupOnLoad?: boolean;
}

/** The real core. */
const CORE: CoreFunctions = { planFrame, canonicalizeProfile, attachResume, persistableCanaries, policyHits, vocab: bundledVocab };

/** The e2e build only: how long the agent's new window rests on its empty page (agent.ts windowSettleMs). */
const AGENT_E2E_SETTLE_MS = 750;
/** v5 p1-shell: the toolbar icon's sidebar/open, asked again while a content script it injected starts (about 1.2 s). */
const ICON_OPEN_TRIES = 8;
const ICON_OPEN_GAP_MS = 150;

/** The audit of 2026-11-06 (m6): how long after a Submit pressed in a document an address no parser reads (its
 *  confirmation drawn in place) still counts as that document's application: the confirmation page's own window. Past
 *  it, such an address (the board the page moved on to) is no application's, so "Application submitted" goes. */
export const KEEP_KEY_AFTER_PRESS_MS = CONFIRMATION_PAGE_MS;

/** A sender's origin, as its address names it ('' where it names none: no grant is for it). */
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/** Content messages that skip the access-level wait. */
const UNGATED: ReadonlySet<string> = new Set(['ping', 'panel/open']);

/** v3 Phase 8: a port whose sender is checked asynchronously (a frame the worker injected, after a restart): what it
 *  receives meanwhile is held, and handed in order to the first listener that takes it. */
function heldPort(port: PortLike): PortLike {
  const held: unknown[] = [];
  let listeners: Array<(message: unknown) => void> | null = null;
  port.onMessage((message) => {
    if (listeners === null) held.push(message);
    else for (const cb of [...listeners]) cb(message);
  });
  return {
    name: port.name,
    ...(port.sender === undefined ? {} : { sender: port.sender }),
    post: (message) => port.post(message),
    onMessage(cb) {
      const first = listeners === null;
      listeners ??= [];
      listeners.push(cb);
      if (first) for (const message of held.splice(0)) cb(message);
      return () => void listeners?.splice(listeners.indexOf(cb), 1);
    },
    onDisconnect: (cb) => port.onDisconnect(cb),
    disconnect: () => port.disconnect(),
  };
}

export function startWorker(options: WorkerOptions = {}): WorkerState {
  const platform = options.platform ?? createWorkerPlatform();
  const core = options.core ?? CORE;
  const timers = options.timers ?? systemTimers;
  const origin = options.origin ?? __TAILORIT_ORIGIN__;
  const lookupOnLoad = options.lookupOnLoad !== false;
  const { local, session } = platform.storage;
  const now = () => platform.now();
  const state: WorkerState = { storageAccess: 'pending', ready: Promise.resolve() };

  // ── The parts (no awaits here: listeners come next, synchronously) ──────────────────────────────────────────────
  // What was read with a token goes with it: a new or dropped token empties the profile cache, every run's lookup and
  // resume, and the side panel's job cards and resume choices (v2).
  let profiles: ProfileCache | null = null;
  let runRegistry: RunRegistry | null = null;
  let jobCards: JobCards | null = null;
  let panelReports: Reports | null = null;
  let letterRows: ReturnType<typeof createPanelLetters> | null = null;
  let tailorings: Tailoring | null = null; // v1.4 F
  let submissions: Submissions | null = null;
  let agentRef: Agent | null = null;
  let queueRef: QueueRunner | null = null; // v1.5 QX
  // v1.3 B
  let knownFormsRef: KnownForms | null = null;
  const keeper = createTokenKeeper(platform, () => {
    profiles?.drop();
    void runRegistry?.dropTokenData().catch(() => undefined);
    jobCards?.dropTokenData();
    letterRows?.dropTokenData();
    tailorings?.dropTokenData(); // v1.4 F
    submissions?.dropTokenData();
    knownFormsRef?.dropTokenData();
    // v3 Phase 5: the agent's job closes; its result waits for a connection to tell it.
    void agentRef?.tokenChanged().catch(() => undefined);
    // v1.5 QX: the sequential auto-apply stops; its results wait for a connection to tell them.
    void queueRef?.tokenChanged().catch(() => undefined);
    // Every side panel reads the connection again and drops the card it holds, whichever window the change came from.
    panelReports?.tellPanels('connection');
  });
  const server = createServerClient({
    origin,
    platform,
    token: () => keeper.token(),
    onUnauthorized: (token) => keeper.forgetIfCurrent(token, 'revoked'),
    onVersion: (matches) => keeper.noteVersion(matches),
  });
  const profileCache = createProfileCache({ server, timers, core, now });
  profiles = profileCache;
  /** jr6: the job-site sign-up information, kept in this browser alone, the password encrypted (signup-vault.ts). */
  const signupVault = createSignupVault({ local, keys: platform.signupKey, subtle: globalThis.crypto.subtle,
    randomBytes: (count) => platform.randomBytes(count), now });
  const auth = createAuth({ platform, origin, server, keeper, storageAccess: () => state.storageAccess,
    signUp: () => signupVault.has() });
  const settings = createSettingsStore(local);
  const runs = createRunRegistry(platform, session);
  runRegistry = runs;
  const runStates = createRunStateStore({ local, session, now, profile: () => profileCache.get(), core });
  const policy = createPolicyBook(session);
  // Keyed `${tabId}/` (run/begin) and `${tabId}/${frameId}` (report/put, policy/hit), so a closed tab's counts go with
  // one prefix.
  const beginLimit = createRateLimit(RUN_BEGIN_LIMIT.count, RUN_BEGIN_LIMIT.windowMs, now);
  const reportLimit = createRateLimit(REPORT_PUT_LIMIT.count, REPORT_PUT_LIMIT.windowMs, now);
  const policyLimit = createRateLimit(POLICY_HIT_LIMIT.count, POLICY_HIT_LIMIT.windowMs, now);
  const shownLimit = createRateLimit(PANEL_SHOWN_LIMIT.count, PANEL_SHOWN_LIMIT.windowMs, now);
  // The job card's relay (v2), keyed `${tabId}/${frameId}`, and the custom question, keyed `${tabId}/`.
  const relayLimit = createRateLimit(JOB_RELAY_LIMIT.count, JOB_RELAY_LIMIT.windowMs, now);
  const askLimit = createRateLimit(ASK_LIMIT.count, ASK_LIMIT.windowMs, now);
  // The job card's cover-letter row (Phase G), keyed `${tabId}/`.
  const letterLimit = createRateLimit(LETTER_LIMIT.count, LETTER_LIMIT.windowMs, now);
  // The anonymous counters (Phase 6): storage.local, only while the person opted in; nothing is ever sent.
  const telemetry = createTelemetry({ local, session, settings });
  // A panel that reads or starts to follow a tab checks its frames first (checkTab, below).
  const reports = createReports({ session, tabs: platform.tabs, runs, settings, limit: reportLimit, shownLimit, telemetry,
    check: (tabId) => checkTab(tabId), sideShown: (tabId, open) => void tellTopFrame(tabId, { v: 1, type: 'panel/side', open }),
    submitted: async (tabId) => submissions?.stateOf(tabId),
    // v3 Phase 8 (the review's B10): the career sites act, so a company page no frame of ours is on waits for a reload.
    sitesActive: () => sites.active(),
    // jr6 apply F3a: the tab's entry grant, armed and waiting, or ended on another origin (sign-up.ts).
    entryOf: (tabId) => ({ waiting: signUps.waiting(tabId), elsewhere: signUps.elsewhere(tabId) }) });
  // The launcher's place and hiding per site (v3 Phase 3): storage.local, a hash of the host only.
  const launchers = createLauncherStore(local);
  const launcherLimit = createRateLimit(LAUNCHER_LIMIT.count, LAUNCHER_LIMIT.windowMs, now);
  // s2 lists: the option lists a host's dropdowns showed a run (learned-lists.ts): storage.local, hashed keys only.
  const learnedLists = createLearnedListStore(local);
  const listsLimit = createRateLimit(LEARNED_LISTS_LIMIT.count, LEARNED_LISTS_LIMIT.windowMs, now);
  /** "Hide until next visit" for a tab's page (v3 Phase 3 review), in storage.session: the top frame's document it was
   *  chosen in, so the side panel can offer it back; a later page of the tab never reads as hidden. */
  const visitKey = (tabId: number) => `launcher-visit:${tabId}`;
  panelReports = reports;
  // The side panel's job card and custom question (v2): read through the tab's form frame, kept in memory only.
  // v1.3 B: the jobs' known questions and the person's earlier answers (known-forms.ts), memory only.
  const knownForms = createKnownForms({ server, now, generation: () => keeper.generation });
  knownFormsRef = knownForms;
  const jobs = createJobCards({ session, tabs: platform.tabs, server, connected: () => auth.connected(),
    onLoadLimit: createRateLimit(LOOKUP_ON_LOAD_LIMIT.count, LOOKUP_ON_LOAD_LIMIT.windowMs, now),
    generation: () => keeper.generation, now, limit: relayLimit, prefetchForm: (jobId) => knownForms.prefetch(jobId) });
  jobCards = jobs;
  // One chooser for the planner and the resume port: it follows the token and the tab's resume choice (v2: a Change
  // mid-run applies to every file not uploaded yet).
  const chooseResume = createResumeChooser({ runs, server, profiles: profileCache, generation: () => keeper.generation,
    chosen: (tabId) => jobs.chosen(tabId), chosenJob: (tabId, applicationKey) => jobs.chosenJob(tabId, applicationKey) });
  // The LLM steps' tasks on TailorIT (Phase 4), shared by every run; each run keeps its own questions (ai-tasks.ts).
  const aiTasks = createAiTasks({ server, timers, now });
  // The accepted-match cache (Phase 6): storage.session, in memory, sealed under the session's secret; a match goes in
  // once the field was unchanged at the run's done (match-cache.ts).
  const matchCache = createMatchCache(session, (count) => platform.randomBytes(count));
  const accepts = createAcceptBook(matchCache);
  // Cover letters (Phase G): a run asks TailorIT for its letter once (cover-letters.ts), and the resume port sends it.
  const letters = { server, timers, now };
  const planner = createPlanner({ runs, profiles: profileCache, settings, core, chooseResume, ai: aiTasks,
    aiTaskIds: runStates, cache: matchCache, accepts, letters, now, knownForms, timers,
    withoutResume: (tabId, applicationKey) => jobs.without(tabId, applicationKey),
    // v5 p2-stream: a run's frame is told when its AI answers come in (plan/ready).
    tabs: platform.tabs });
  const resume = createResumeTransfer({ runs, server, profiles: profileCache, timers, sha256: (bytes) => platform.sha256(bytes),
    choose: chooseResume, letters });
  /** v4: the tabs' Sign up & Autofill grants, and the forms to start after a wall (sign-up.ts). The v4 review (M1): one
   *  that held Sign-in Auto and ends by time is told to the tab's frames (pushTab), which stop reading it. */
  const signUps = createSignUps({ now, timers, ended: (tabId) => void pushTab(tabId).catch(() => undefined),
    // jr6 apply F3a: the tab's page state follows its entry grant (waiting, elsewhere).
    changed: (tabId) => void reports.pageChanged(tabId).catch(() => undefined) });
  /** jr6 apply F3a: entry/pressed's limit, per tab (APPLYPLAN F3a item 3). */
  const entryLimit = createRateLimit(ENTRY_PRESSED_LIMIT.count, ENTRY_PRESSED_LIMIT.windowMs, now);
  const panel = createPanelHandlers({ platform, reports, connected: () => auth.connected(), check: (tabId) => checkTab(tabId),
    // v4: Sign up & Autofill grants the tab Sign-in Auto for one run, for its application frame's site (the v4 review,
    // M1); its frames hear the settings as they act then.
    signUp: async (tabId, grant, place) => {
      const before = signUps.live(tabId);
      signUps.grant(tabId, grant, place);
      if (before || signUps.live(tabId)) await pushTab(tabId);
    },
    // jr6 apply F3a: a plain Autofill during the hand-off keeps the armed grant (apply-c-new-1); Cancel ends it.
    keepEntry: (tabId, frame) => signUps.keep(tabId, frame),
    endEntry: async (tabId) => {
      if (signUps.endEntry(tabId)) await pushTab(tabId);
    } });
  // Save my answer and Confirm draft (Phase 6, wave 2): the answer goes from the frame straight to TailorIT.
  const answers = createAnswerHandlers({ platform, reports, runs, server, settings, vocab: () => core.vocab(),
    connected: () => auth.connected() });
  const ask = createAsk({ jobs, server, profiles: profileCache, tabs: platform.tabs, timers, now,
    connected: () => auth.connected(), generation: () => keeper.generation, settings, limit: askLimit,
    policyHeld: async (tabId) => (await reports.ofTab(tabId)).some(saysNoAi) });
  const panelLetters = createPanelLetters({ ...letters, jobs, profiles: profileCache, tabs: platform.tabs, settings,
    connected: () => auth.connected(), generation: () => keeper.generation, limit: letterLimit,
    policyHeld: async (tabId) => (await reports.ofTab(tabId)).some(saysNoAi),
    profileOnlyHeld: async (tabId) => (await reports.ofTab(tabId)).some(fillsFromProfileOnly),
    dryRunHeld: async (tabId) => latestReport(await reports.ofTab(tabId))?.mode === 'dry-run' });
  letterRows = panelLetters;
  // v1.4 F (PLAN decisions 16-17): the job card's tailoring, and Preview and Edit of what the tab attaches.
  const tailoring = createTailoring({ server, jobs, tabs: platform.tabs, settings, timers,
    connected: () => auth.connected(), generation: () => keeper.generation,
    cardFrame: async (tabId) => cardFrameOf(await framesOfTab(session, tabId)),
    limit: createRateLimit(TAILOR_LIMIT.count, TAILOR_LIMIT.windowMs, now),
    changed: () => reports.tellPanels('tailor'),
    policyHeld: async (tabId) => (await reports.ofTab(tabId)).some(saysNoAi),
    profileOnlyHeld: async (tabId) => (await reports.ofTab(tabId)).some(fillsFromProfileOnly) });
  tailorings = tailoring;
  const openLimit = createRateLimit(OPEN_DOCUMENT_LIMIT.count, OPEN_DOCUMENT_LIMIT.windowMs, now);
  // v1.5 X (PLAN decisions 2 and 3): the documents' dialogs over the tab's page, and their grants.
  const dialogs = createDocumentDialogs({ tabs: platform.tabs, timers, now,
    randomBytes: (count) => platform.randomBytes(count),
    // The web-accessible preview page's address of this session (its dynamic one: what a page may load).
    previewPage: () => platform.runtime.getURL('/preview.html') });
  /** v1.5 X: the full-window preview page of a tab, at the extension's own address (never the dynamic one). */
  const openPreviewTab = (tabId: number, kind: 'resume' | 'coverLetter') =>
    platform.tabs.create(`${platform.runtime.getURL('/')}preview.html?tabId=${tabId}&kind=${kind}`);
  /** v1.5 X: the dialog's title names the resume's file (the person's own: the list's `fileName`), never an id. */
  const documentNames = async (tabId: number, kinds: readonly ('resume' | 'coverLetter')[]) => {
    const resume = kinds.includes('resume') ? await attachedResumeOf(tabId) : null;
    return resume === null || resume.fileName.trim() === '' ? {} : { resume: resume.fileName.slice(0, 255) };
  };
  /** panel/openDocument: Preview (v1.5 X) shows the tab's documents in the dialog over its page (the top frame's, with
   *  a grant), else opens the full-window preview page (an extension page: a page with no frame of ours, a restricted
   *  page, a refusal); Edit opens TailorIT's editor for what the tab attaches (the tailored document, else the
   *  attached resume or the person's letter), its id read here alone: v1.5 X, an uploaded resume's editable copy
   *  (`/resumes/<id>/edit`, TailorIT's route that makes or reuses it) after the confirm, over the page (`confirm:
   *  'page'`) or the panel's own (`confirm: 'panel'`, then `confirmed`), unless the person said "Don't show this again". */
  async function openDocument({ tabId, kind, how, kinds, confirmed, skipConfirm }: { tabId: number;
    kind: 'resume' | 'coverLetter'; how: 'preview' | 'edit'; kinds?: ('resume' | 'coverLetter')[] | undefined;
    confirmed?: true | undefined; skipConfirm?: boolean | undefined }) {
    const retry = openLimit.take(`${tabId}/`);
    if (retry !== null) return { ok: false as const, error: 'rate_limited' as const, retryAfterSeconds: retry };
    if (how === 'preview') {
      const tabs = kinds ?? [kind];
      if (await dialogs.preview(tabId, kind, tabs, await documentNames(tabId, tabs))) {
        log('tailor.opened', { preview: true, letter: kind === 'coverLetter', page: true });
        return ok({ opened: true, onPage: true as const });
      }
      await openPreviewTab(tabId, kind);
      log('tailor.opened', { preview: true, letter: kind === 'coverLetter' });
      return ok({ opened: true });
    }
    if (!(await auth.connected())) return refuse('not_connected');
    let url: string | null = null;
    if (kind === 'coverLetter') {
      const id = (await tailoring.documentOf(tabId, 'coverLetter')) ?? (await previewLetterOf(tabId, () => true));
      url = id === null ? null : editorUrlOf(origin, 'coverLetter', id);
    } else {
      const attached = await attachedResumeOf(tabId);
      url = attached === null ? null : editorUrlOf(origin, 'resume', attached.id, attached.kind === 'built');
      // v1.5 X: an upload's editable copy, after the confirm (the person's "Don't show this again" kept first).
      if (attached !== null && attached.kind !== 'built' && url !== null) {
        if (confirmed === true && skipConfirm === true) await skipUploadConfirm();
        if (confirmed !== true && !(await settings.get()).ui.skipUploadEditConfirm) {
          if (await dialogs.confirmEdit(tabId, attached.id)) return ok({ opened: false, confirm: 'page' as const });
          return ok({ opened: false, confirm: 'panel' as const });
        }
        log('document.edit', { confirmed: confirmed === true });
      }
    }
    if (url === null) return ok({ opened: false });
    await platform.tabs.create(url);
    log('tailor.opened', { preview: false, letter: kind === 'coverLetter' });
    return ok({ opened: true });
  }
  /** v1.5 X: "Don't show this again": settings version 10's ui.skipUploadEditConfirm, on the settings as stored now. */
  async function skipUploadConfirm() {
    const current = await settings.get();
    if (!current.ui.skipUploadEditConfirm) await settings.save({ ...current, ui: { skipUploadEditConfirm: true } });
  }
  // v3 Phase 3b: the side panel's "Your autofill information" and "Ask TailorIT to support this site".
  const profileEditor = createProfileEditor({ server, profiles: profileCache, connected: () => auth.connected(),
    scopes: async () => (await keeper.current())?.scopes ?? [],
    // v5 p1-panel (S6): the account's address, for the profile check worked out here.
    accountEmail: async () => (await auth.status()).account?.email ?? null,
    limit: createRateLimit(PROFILE_EDIT_LIMIT.count, PROFILE_EDIT_LIMIT.windowMs, now) });
  const siteRequests = createSiteRequests({ server, tabs: platform.tabs, connected: () => auth.connected(),
    limit: createRateLimit(SITE_REQUEST_LIMIT.count, SITE_REQUEST_LIMIT.windowMs, now) });
  // v3 Phase 4: a Submit pressed, its confirmation, and the tracker told.
  const submitted = createSubmissions({ server, session, runs, jobs, generation: () => keeper.generation, now,
    limit: createRateLimit(SUBMIT_MESSAGE_LIMIT.count, SUBMIT_MESSAGE_LIMIT.windowMs, now),
    recordOwn: async () => (await settings.get()).modes.recordOwn === 'on',
    frameKey: async (tabId, frameId) => (await frameEntry(session, tabId, frameId))?.applicationKey ?? null,
    disclosed: () => auth.disclosed(),
    changed: (tabId) => void reports.pageChanged(tabId).catch(() => undefined),
    // v3 Phase 5: the agent's own tab's sign finishes its job (its result records Applied). v1.5 QX: else a queued tab's
    // sign for its job's own application finishes that job, the same way.
    agentSubmitted: async (tabId, applicationKey) => {
      const byAgent = await agent.submitted(tabId, applicationKey);
      return byAgent !== 'not-ours' ? byAgent : queueRunner.submitted(tabId, applicationKey);
    },
    // v5 p1-panel (PLAN decision 5): the page's "Application Submitted!" window, in the tab's top frame.
    applied: (tabId) => void tellTopFrame(tabId, { v: 1, type: 'applied/popup' }),
    // v1.3 B: a submitted form's answers kept unless the person turned it off; its questions classified as the
    // resolver does; where each answer came from, by the frame's report.
    keepAnswers: async () => (await settings.get()).modes.keepAnswers === 'on',
    categoryOf: (spec) => categoryOfSpec(spec, core.vocab()),
    rowsOf: async (tabId, frameId) => (await reports.ofTab(tabId)).find((report) => report.frameId === frameId)?.fields
      ?? [],
    // jr7 AUTO-7 A1 (ICIMS7-02): a chained subframe's arm, and the tab's claim frame where its confirmation shows.
    frameOf: (tabId, frameId) => frameEntry(session, tabId, frameId),
    claimFrame: async (tabId) => claimFrameOf(await framesOfTab(session, tabId)) });
  submissions = submitted;
  /** The resume a fill of the tab would attach, for the side panel's preview (v3 Phase 3b): the person's choice, else
   *  the card's; read from the account's list, for its file kind and name. None while the tab applies without one. */
  async function previewResumeOf(tabId: number) {
    const item = await attachedResumeOf(tabId);
    return item === null ? null : { id: item.id, fileKind: item.fileKind, fileName: item.fileName };
  }
  /** The account's list item of the resume a fill of the tab would attach (v1.4 F: its kind too, for Edit). */
  async function attachedResumeOf(tabId: number) {
    const frame = cardFrameOf(await framesOfTab(session, tabId));
    if (jobs.without(tabId, frame?.applicationKey ?? null)) return null;
    const id = jobs.chosen(tabId, frame?.applicationKey ?? null) ?? (await jobs.tabJob(tabId)).resume?.id ?? null;
    if (id === null) return null;
    const list = await server.resumes();
    return (list.ok ? list.value.items.find((entry) => entry.id === id) : undefined) ?? null;
  }
  /** v4 ui: the cover letter a fill of the tab attached or would attach, for the side panel's preview: the ready letter
   *  of the tab's newest run that holds one (not a dry run's: it reads none), else the person's own letter for the
   *  tab's job, checked for with generate false (nothing is written). Its id stays in this worker. */
  async function previewLetterOf(tabId: number, active: () => boolean): Promise<string | null> {
    // v1.4 F: the letter the tab's tailoring wrote for the application it shows comes first.
    const tailored = await tailorings?.documentOf(tabId, 'coverLetter') ?? null;
    if (tailored !== null) return tailored;
    const held = [...(await reports.ofTab(tabId))].filter((report) => report.mode === 'fill')
      .sort((a, b) => b.updatedAt - a.updatedAt);
    for (const report of held) {
      if ((await runs.documentOf(report.runId)) === undefined) continue;
      const ready = runs.memo(report.runId).letter?.readyId() ?? null;
      if (ready !== null) return ready;
    }
    if (!active()) return null;
    const tab = await jobs.tabJob(tabId);
    if (tab.frame === null || !active()) return null;
    let resumeId = tab.resume?.id ?? null;
    if (resumeId === null) {
      const profile = await profileCache.get();
      resumeId = profile.ok ? profile.value.resumeId : null;
    }
    return checkLetter(letters, { jobId: tab.jobId, company: tab.company, jobTitle: tab.jobTitle, resumeId }, active);
  }
  /** Whether Sign-in mode may act (v3 Phase 5): jr6, a job-site password is saved in this browser (signup-vault.ts;
   *  the connection's credentials:read before jr6), and the person acknowledged the disclosure as it reads now. */
  const signInAllowed = async () => (await signupVault.has()) && (await auth.disclosed());
  /** What holds a mode at Manual now: Submit until the disclosure was acknowledged (the v3 Phase 4 review); Sign-in
   *  unless it is allowed (v3 Phase 5); jr6: where it is allowed, a saved password is typed on Manual too. */
  const holds = async () => {
    const allowed = await signInAllowed();
    return { holdSubmit: !(await auth.disclosed()), holdSignIn: !allowed, typeSignIn: allowed };
  };
  /** The content settings as they act now for a frame of `tabId` on `origin` showing `applicationKey` in document
   *  `documentId`: in the auto-apply agent's window, for its task's application and while it may run, the agent's (v3
   *  Phase 5: Next and Submit on Auto; Submit on Manual in a document but the one the job's Submit was pressed in, once
   *  it was); v4: Sign-in Auto under the tab's Sign up & Autofill grant, for a frame of the grant's origin alone (the v4
   *  review, M1). */
  const contentSettingsFor = async (tabId: number, applicationKey: string | null | undefined,
    documentId: string | null | undefined, origin: string) => {
    const task = await agent.task(tabId, applicationKey, documentId);
    return contentSettingsOf(await settings.get(), { ...(await holds()), agent: task !== null,
      agentSubmitHeld: task?.submitHeld === true, signUp: signUps.live(tabId, origin) });
  };
  /** v4: the settings as they act now, told to one tab's frames with a form, a wall or (the v4 review) a choice of how
   *  to apply (a Sign up & Autofill grant made or ended there). A frame that cannot be reached reads them at its next
   *  run/begin. */
  const pushTab = async (tabId: number) => {
    const frames = (await framesOfTab(session, tabId))
      .filter((frame) => frame.hasForm || frame.wall !== undefined || frame.choice === true);
    await Promise.all(frames.map(async (frame) => {
      try {
        await platform.tabs.sendToFrame(tabId, { v: 1, type: 'settings/changed',
          settings: await contentSettingsFor(tabId, frame.applicationKey, frame.documentId, frame.origin) },
          frameTarget(frame));
      } catch {
        log('frame.unreachable');
      }
    }));
  };
  /** v3 Phase 5: the auto-apply agent. Its alarm's listener is registered below, with the others. */
  const agent = createAgent({ server, local, session, windows: platform.windows, alarms: platform.alarms, timers, now,
    scopes: async () => (await keeper.current())?.scopes ?? null,
    disclosed: () => auth.disclosed(),
    reports: (tabId) => reports.ofTab(tabId),
    topFrame: (tabId) => topFrameOf(tabId),
    // core-x, item 3: the frames the agent acts in for the tab's application (frames.ts agentFramesOf).
    agentFrames: async (tabId) => agentFramesOf(await framesOfTab(session, tabId)),
    ...(platform.tabs.atsPageOf === undefined ? {} : { atsPageOf: (tabId: number) => platform.tabs.atsPageOf!(tabId) }),
    // The audit of 2026-11-06 (M5): no job is taken while the browser says it is offline.
    online: () => (globalThis as { navigator?: { onLine?: boolean } }).navigator?.onLine !== false,
    send: (tabId, message, target) => platform.tabs.sendToFrame(tabId, message, target),
    nonce: () => toBase64Url(platform.randomBytes(16)),
    // The tab it lets go of: every frame of ours there stops its run and hears the person's own settings.
    release: async (tabId) => {
      const frames = await framesOfTab(session, tabId);
      await Promise.all(frames.map(async (frame) => {
        try {
          await platform.tabs.sendToFrame(tabId, { v: 1, type: 'run/cancel' }, frameTarget(frame));
          await platform.tabs.sendToFrame(tabId, { v: 1, type: 'settings/changed',
            settings: await contentSettingsFor(tabId, frame.applicationKey, frame.documentId, frame.origin) },
            frameTarget(frame));
        } catch {
          log('frame.unreachable');
        }
      }));
    },
    assign: (tabId, applicationKey, task) => jobs.assign(tabId, applicationKey, task.jobId, task.resumeId),
    changed: () => reports.tellPanels('agent'),
    // The e2e build: its test browser routes the agent's new window before the job's address opens in it.
    windowSettleMs: __E2E__ ? AGENT_E2E_SETTLE_MS : 0 });
  agentRef = agent;
  // v1.5 QX: the sequential auto-apply (queue-runner.ts). Its alarm's listener is registered below, with the others.
  const queueRunner = createQueueRunner({ server, session, tabs: platform.queueTabs, alarms: platform.alarms, timers,
    now, settings: () => settings.get(),
    scopes: async () => (await keeper.current())?.scopes ?? null,
    disclosed: () => auth.disclosed(),
    online: () => (globalThis as { navigator?: { onLine?: boolean } }).navigator?.onLine !== false,
    // The background agent never runs beside it: Start turns Run auto-apply off (its running job left for the person).
    agentOn: async () => (await agent.status()).on,
    stopAgent: async () => void (await agent.set(false, false)),
    reports: (tabId) => reports.ofTab(tabId),
    ...(platform.tabs.atsPageOf === undefined ? {} : { atsPageOf: (tabId: number) => platform.tabs.atsPageOf!(tabId) }),
    send: (tabId, message, target) => platform.tabs.sendToFrame(tabId, message, target),
    // The panel's Autofill, as the person's click sends it (its entry pressed, then the next form started).
    fill: async (tabId) => void (await panel.fill({ v: 1, type: 'panel/fill', tabId, dryRun: false })),
    assign: (tabId, applicationKey, task) => jobs.assign(tabId, applicationKey, task.jobId, task.resumeId),
    changed: () => reports.tellPanels('queue'),
    // The e2e build: its test browser routes the queued tab before the job's address opens in it.
    tabSettleMs: __E2E__ ? AGENT_E2E_SETTLE_MS : 0 });
  queueRef = queueRunner;
  /** The e2e build only: a test event in storage.session (e2e:events), never an address; one write at a time, so two
   *  frames' events at once both land. */
  const e2eWrites = createKeyedQueue();
  const noteE2e = (event: Record<string, unknown>) => (!__E2E__ ? Promise.resolve() : e2eWrites.run('e2e:events', async () => {
    const events = ((await session.get('e2e:events')) as unknown[] | undefined) ?? [];
    await session.set({ 'e2e:events': [...events, event] });
  }));
  /** v3 Phase 8: the company career sites: the sentinel's registration and the injection. */
  const sites = createSites({ local, session, scripting: platform.scripting, permissions: platform.permissions,
    limit: createRateLimit(RECOGNISED_LIMIT.count, RECOGNISED_LIMIT.windowMs, now), now, tailorit: origin,
    // The Phase 8 review (P1/B8): every tab's top frame told site/stop, by its id alone.
    stopPages: async () => {
      const ids = (await platform.tabs.ids?.()) ?? [];
      await Promise.all(ids.map((tabId) => platform.tabs.sendToFrame(tabId, { v: 1, type: 'site/stop' }, { frameId: 0 })
        .catch(() => undefined)));
    },
    ...(__E2E__ ? { note: (event) => noteE2e(event) } : {}) });
  /** v5 p1-shell: the sidebar on the page (sidebar.ts): its bundle, its ports, the toolbar icon and the header's notes. */
  const onPage = async () => (await settings.get()).panel === 'page';
  const sidebar = createSidebar({ scripting: platform.scripting, local, onPage,
    limit: createRateLimit(SIDEBAR_LOAD_LIMIT.count, SIDEBAR_LOAD_LIMIT.windowMs, now) });
  /** v5 p2-fill (PLAN decision 14): the page patches, run in a frame's page world as a run begins there. */
  const pagePatches = createPagePatches({ scripting: platform.scripting, session,
    limit: createRateLimit(PAGE_PATCHES_LIMIT.count, PAGE_PATCHES_LIMIT.windowMs, now) });
  /** v5 p1-shell: Chrome opens the side panel on the toolbar icon's click only while the panel's place is the side
   *  panel; on the page, the click comes to the action's listener below. */
  const placeIcon = async () => {
    await platform.sidePanel.openOnActionClick(!(await onPage())).catch(() => undefined);
  };
  /** jr6: Settings › Sign-up Information's messages, and Sign-in mode's guard (signup.ts). */
  const signup = createSignup({ vault: signupVault, settings, server, local,
    scopes: async () => (await keeper.current())?.scopes ?? [],
    // The box's first email while none is saved (coordinator decision 3): the TailorIT profile's, read for it when the
    // worker holds none (the jr6 review, R9: one GET /profile as the person opens the card, the cache's after); else the
    // account's as read already, which TailorIT answers an empty profile email as (the page adds the account's own).
    suggestedEmail: async () => {
      if (!(await auth.connected())) return null;
      const profile = await profileCache.get().catch(() => null);
      const own = profile?.ok === true ? profile.value.profile.contact.email : '';
      return own !== '' ? own : auth.knownAccountEmail();
    },
    changed: async ({ settings: modes }) => {
      // Every frame hears whether a password may be typed (ContentSettings.typeSignIn), and Sign-in as it acts.
      await pushNow();
      reports.tellPanels('signup');
      if (modes) reports.tellPanels('settings');
    } });
  /** v3 Phase 5: Sign-in mode Auto's credential, for a paused run's top frame. jr6: from this browser's Sign-up
   *  Information (signup-vault.ts), never TailorIT's. */
  const signIn = createSignIn({ vault: signupVault, session, now,
    // v4: Auto, or the tab's Sign up & Autofill grant (sign-up.ts), every other rule held; the v4 review (M1): the
    // grant's for a frame of the origin it was given for alone. jr6: Manual types a saved password, pressing nothing;
    // the jr6 review (sec-3): never in the auto-apply agent's tab, where nobody is there to press it (its settings say
    // so too: contentSettingsOf), and its Auto ('agent') is never typed for a person after a press (sign-in.ts).
    signInAct: async (tabId, origin) => {
      if (!(await auth.disclosed())) return null;
      const unattended = await agent.ownsTab(tabId);
      if ((await settings.get()).modes.signIn === 'auto' || signUps.live(tabId, origin)) return unattended ? 'agent' : 'auto';
      return unattended ? null : 'type';
    },
    // core-x, item 3: a subframe that claims the tab's application signs in as a top frame does (frames.ts).
    claimFrame: async (tabId) => claimFrameOf(await framesOfTab(session, tabId)),
    // jr6: no password to use (none saved, or one that can no longer be read, which was removed): Sign-in Auto, which
    // needs one, goes back to Manual (the jr6 review, sec-9: `none` too), and the card says so (R12).
    missing: async (why) => {
      const reverted = await signup.passwordMissing(why);
      if (why === 'gone' || reverted) {
        await pushNow();
        reports.tellPanels('signup');
      }
      if (reverted) reports.tellPanels('settings');
    },
    // jr6 SHELL-A (BUILD D-d): an email gate's email where none is saved in Sign-up Information: the TailorIT profile's
    // contact email, as the run's plan reads it (the profile cache's), never a password. jr6 ifix SEC-3 (the jr6
    // integration review; the coordinator: keep the fetch): read as any Autofill reads the profile, from the worker's
    // memory, else fetched from TailorIT (GET /profile and its saved answers) when it holds none, as after five idle
    // minutes (profile-cache.ts PROFILE_IDLE_MS); not connected, nothing is fetched (signup-worker.test.ts pins it).
    profileEmail: async () => {
      const profile = await profileCache.get().catch(() => null);
      const own = profile?.ok === true ? profile.value.profile.contact.email : '';
      return own === '' ? null : own;
    } });
  /** core-x, items 7 and 14: the tabs' chains (chain.ts). */
  const chains = createChains({ session, now, tabs: platform.tabs, timers }); // jr6 SHELL-B: the step facts' handing
  /** Every frame with a form hears the settings as they act now for it (settings/changed): the agent's tab's documents
   *  the agent's, each as contentSettingsFor builds them for its application and document (the audit's m1: Submit stays
   *  on Manual in every document but the one the job's Submit was pressed in). */
  const pushNow = async () => pushSettings({ session, tabs: platform.tabs },
    (frame) => contentSettingsFor(frame.tabId, frame.applicationKey, frame.documentId, frame.origin));
  const beginDeps = {
    jobs,
    knownForms,
    generation: () => keeper.generation,
    storageAccess: () => state.storageAccess,
    connected: () => auth.connected(),
    limit: beginLimit,
    profiles: profileCache,
    server,
    runs,
    runStates,
    policy,
    settings,
    core,
  };
  const ownId = platform.runtime.id;
  const ownPagesPrefix = platform.runtime.getURL('/');
  /** Settles once Chrome answered the access-level call (set below, before anything can be delivered). */
  let accessReady: Promise<void> = Promise.resolve();
  /** What a content message waits for: the access level, and (the audit's M1) the side panel's choices read back from
   *  storage.session, so a run begun after Chrome stopped the idle worker attaches what the person chose. */
  const contentReady = () => Promise.all([accessReady, jobs.ready]).then(() => undefined);

  /** A frame's document that is gone (the frame loaded another, or the check found it gone): what that document
   *  reported and began goes. Only that document's: a page the frame shows again from the back/forward cache, which
   *  says no hello, keeps its run and report. */
  async function forgetDocument(tabId: number, frameId: number, documentId: string | null): Promise<void> {
    jobs.forgetDocument(tabId, frameId, documentId);
    await Promise.all([reports.forgetDocument(tabId, frameId, documentId), runs.forgetDocument(tabId, frameId, documentId),
      submitted.forgetDocument(tabId, frameId, documentId)]);
  }

  /** One lock per tab for the frame registry: a frame registering and a sweep forgetting one never interleave. */
  const frameLocks = createKeyedQueue();
  const lockTab = <T>(tabId: number, task: () => Promise<T>) => frameLocks.run(`${tabId}`, task);
  const sweepTab = createFrameSweep({
    session,
    tabs: platform.tabs,
    timers,
    lock: lockTab,
    async forget(tabId, frameId, documentId) {
      await forgetFrames(session, tabId, [frameId]);
      await forgetDocument(tabId, frameId, documentId);
      // The page state may have changed with it (v2: the side panel's strip and card).
      await reports.pageChanged(tabId);
    },
  });

  /**
   * The check a panel's read or watch sets off: all of the tab's frames, because a page that holds none of ours says
   * no hello (a company page that embedded a form, left for a page without one). It runs in the background, one at a
   * time per tab; a report it removes reaches the panel port as a change.
   */
  const checking = new Set<number>();
  function checkTab(tabId: number): void {
    if (checking.has(tabId)) return;
    checking.add(tabId);
    void sweepTab(tabId).catch(() => undefined).finally(() => checking.delete(tabId));
  }

  /** Whether a Submit of `applicationKey` was pressed in the tab's document `documentId` within KEEP_KEY_AFTER_PRESS_MS
   *  (its arm, submissions.ts: kept in storage.session, so a worker restart keeps it). */
  async function pressedLately(tabId: number, applicationKey: string, documentId: string | null): Promise<boolean> {
    const arm = (await session.get(`${SUBMIT_ARM_PREFIX}${tabId}|${applicationKey}`)) as
      { at?: unknown; documentId?: unknown } | undefined;
    return typeof arm?.at === 'number' && now() - arm.at <= KEEP_KEY_AFTER_PRESS_MS
      && (arm.documentId ?? null) === documentId;
  }

  /** Whether a frame may speak for this application (its key's platform is the frame host's). */
  const fits = (applicationKey: string, from: ContentChannel) => keyFitsFrame(applicationKey, from.url);

  // ── snapshot build 2026-11-06 (core-x, items 3, 6, 7 and 14) ──
  /** The chain a hello's page takes (background/chain.ts): the same document's chain, kept; a top chain page's by its
   *  referrer's hash, a subframe's by its company's one claimed portal frame in the tab (the security fix of
   *  2026-11-06, S4: the registry alone, no token); none for a private tab or any other page. */
  async function chainOfHello(message: Extract<ContentMessage, { type: 'frame/hello' }>, from: ContentChannel,
    held: FrameEntry | null): Promise<FrameChain | undefined> {
    if (held !== null && held.documentId === (from.documentId ?? null)) {
      const kept = chainOf(held);
      if (kept !== undefined) return kept;
    }
    if (message.chain === undefined || from.incognito === true) return undefined;
    const frame = { url: from.url, documentId: from.documentId ?? null, frameId: from.frameId };
    const inherited = 'from' in message.chain
      ? (from.frameId === 0 ? await chains.inheritTop(from.tabId, frame, message.chain.from) : null)
      : await chains.inheritFrame(from.tabId, frame, () => framesOfTab(session, from.tabId));
    return inherited ?? undefined;
  }

  /** The frame as TailorIT is asked about it (core-x, items 6 and 7): a frame whose document took its application from
   *  the tab's chain is named by that application's canonical address, never its own (a session token, the person's
   *  iCIMS id); any other by its own, which server-client.ts names by tailoritAddressOf. */
  function tailoritFrom<T extends { url: string }>(from: T, entry: Pick<FrameEntry, 'chained' | 'chainUrl'> | null): T {
    return entry?.chained === true && entry.chainUrl !== undefined ? { ...from, url: entry.chainUrl } : from;
  }

  /** tailoritFrom, with the frame's entry read from the registry (the same document's only). */
  async function tailoritFromNow<T extends ContentChannel>(from: T): Promise<T> {
    const entry = await frameEntry(session, from.tabId, from.frameId);
    return tailoritFrom(from, entry !== null && entry.documentId === (from.documentId ?? null) ? entry : null);
  }

  /** The tab's top frame, when it is one of ours: the one that draws the launcher at the page's edge (v3 Phase 3). */
  /** The tab's top frame of ours: frame 0, whatever a frame's hello said of itself. */
  async function topFrameOf(tabId: number) {
    return (await framesOfTab(session, tabId)).find((frame) => frame.frameId === 0) ?? null;
  }

  /** Sends one message to the tab's top frame of ours, if there is one; a frame that cannot be reached is skipped. */
  async function tellTopFrame(tabId: number, message: unknown): Promise<void> {
    const top = await topFrameOf(tabId);
    if (top === null) return;
    try {
      await platform.tabs.sendToFrame(tabId, message, frameTarget(top));
    } catch {
      log('frame.unreachable');
    }
  }

  /**
   * jr6 apply F3a: what a frame/wall of a tab's application frame (wallFrameOf, in its registered document) does to the
   * tab's grant (sign-up.ts), and to its card:
   * - its refusal, newly said, ends an entry grant that reached its document (item 2);
   * - a wall or a choice with no form, after a press of the grant, in a document the grant has not reached: one
   *   run/start there (takeStep, AF-3), with Sign up & Autofill's signIn where the grant holds it (item 3);
   * - the line P review (P-B1): a word without `entering`, after a press, from a document the grant reached: the frame's
   *   entry is over there (a wall or a choice its press drew in place, which it took or left to the person), so the
   *   tab no longer says it waits for that press (settled; a press whose document went still waits, ENTRY_WAITING_MS);
   * - a top frame with no form whose document first says its adapter offers the site's own Apply (ADP's job details,
   *   apply-b-new-2) is the tab's card frame (frames.ts cardFrameOf): the job chosen follows its application, and its
   *   card is looked up once, as on load (lookupOnLoad, the connection, the disclosure).
   */
  async function entryWords(message: Extract<ContentMessage, { type: 'frame/wall' }>, from: ContentChannel,
    before: FrameEntry | null, entry: FrameEntry): Promise<void> {
    const frames = await framesOfTab(session, from.tabId);
    const application = wallFrameOf(frames);
    if (application !== null && application.frameId === entry.frameId && application.documentId === entry.documentId) {
      if (entry.entryRefused === true && before?.entryRefused !== true && signUps.refused(from.tabId, entry)) {
        void pushTab(from.tabId).catch(() => undefined);
      }
      if (message.wall !== null || message.choice === true) {
        const step = signUps.takeStep(from.tabId, entry, message.wall !== null ? 'wall' : 'choice');
        if (step !== null) {
          void Promise.resolve().then(() => platform.tabs.sendToFrame(from.tabId, { v: 1, type: 'run/start',
            dryRun: false, ...(step.signIn ? { signIn: true as const } : {}) }, frameTarget(entry)))
            .catch(() => log('frame.unreachable'));
        }
      }
      // The line P review (P-B1): the frame says no longer that it is entering (its entry ended in this document).
      if (message.entering !== true) signUps.settled(from.tabId, entry);
    }
    if (entry.frameId === 0 && entry.entrySaid === true && before?.entrySaid !== true && entry.posting !== true
      && entry.confirmation !== true && cardFrameOf(frames)?.frameId === entry.frameId) {
      jobs.applicationShown(from.tabId, entry.applicationKey ?? null);
      if (lookupOnLoad && (await auth.connected()) && (await auth.disclosed())) {
        void jobs.loadCard(from.tabId, tailoritFrom(from, entry)).catch(() => undefined);
      }
    }
  }

  /** The launcher's prefs changed for the tab's top frame's site: every frame of the tab hears them. `shown`: the
   *  person asked for it back, which undoes "Hide until next visit" too. */
  async function tellLauncherPrefs(tabId: number, shown = false): Promise<void> {
    const frames = await framesOfTab(session, tabId);
    await Promise.all(frames.map(async (frame) => {
      try {
        await platform.tabs.sendToFrame(tabId, { v: 1, type: 'launcher/prefs', launcher: await launchers.prefsFor(frame.origin),
          ...(shown ? { shown: true as const } : {}) }, frameTarget(frame));
      } catch {
        log('frame.unreachable');
      }
    }));
  }

  // ── Listeners, registered synchronously ─────────────────────────────────────────────────────────────────────────
  platform.runtime.onMessage(
    createRouter({
      ownId,
      ownPagesPrefix,
      contentGate: { ready: () => contentReady(), except: UNGATED },
      // v3 Phase 8: the frames off the ATS hosts the worker injected, and the sentinel's page/recognised.
      injected: sites.injected,
      // The Phase 8 review (B6): a company page's "open review" after a restart opens the side panel inside its click.
      openSidePanel: (tabId) => void openSidePanel(platform, tabId),
      // v5 p1-shell: the sidebar's page messages, from the tab's top frame, while the panel shows on the page.
      // v5 p1-shell (the review's S1 and S7): what the sidebar may not ask, and its lookups once it opened by itself.
      sidebar: { open: onPage, vet: createSidebarVet({ settings: () => settings.get(), disclosed: () => auth.disclosed(),
        lookupOnLoad }) },
      content: {
        ping: async () => ok({ pong: true as const }),
        'frame/hello': async (message, from) => {
          // The audit's S-6: a private (incognito) tab's runs are kept for it alone, in storage.session, before any of
          // its runs can begin.
          if (from.incognito === true) await runStates.markPrivate(from.tabId);
          const { previous, entry } = await lockTab(from.tabId, async () => {
            const held = await frameEntry(session, from.tabId, from.frameId);
            // The same document at an address no parser reads keeps the application it last showed only shortly after
            // a Submit pressed in it (its confirmation drawn in place: still that application's); otherwise (a board
            // the page moved on to) it is no application's (the audit's m6).
            const keep = held !== null && held.documentId === (from.documentId ?? null) && held.applicationKey !== undefined
              && (await pressedLately(from.tabId, held.applicationKey, held.documentId)) ? held.applicationKey : undefined;
            // core-x, items 7 and 14 (background/chain.ts): a page whose address names no job takes the application of
            // the claimed page it was reached from, by the tab's chain; the same document's later hellos keep it.
            const chain = await chainOfHello(message, from, held);
            // v4: the same document keeps the wall its frame/wall last said.
            const same = held !== null && held.documentId === (from.documentId ?? null);
            return { previous: held, entry: await registerFrame(session, { ...from, isTop: message.isTop,
              hasForm: message.hasForm, nav: message.nav, ...(message.letter === true ? { letter: true } : {}),
              ...(keep === undefined ? {} : { keepKey: keep }),
              ...(message.wraps === true ? { wraps: true } : {}), ...(message.claimed === true ? { claimed: true } : {}),
              ...(chain === undefined ? {} : { chain }),
              ...(same && held.wall !== undefined ? { wall: held.wall } : {}),
              ...(same && held.choice === true ? { choice: true } : {}),
              ...(same && held.waits !== undefined ? { waits: held.waits } : {}),
              // v5 p2-fill: and its posting's own Apply; jr6 apply F3a: its press under way (until its form shows),
              // and (at the same address) the entry it said, for its card.
              ...(same && held.entry === true ? { entry: true } : {}),
              ...(same && held.entering === true && !message.hasForm ? { entering: true } : {}),
              ...(same && held.entrySaid === true && navOf(held) === (message.nav ?? 0) ? { entrySaid: true } : {}) },
            now()) };
          });
          // core-x, items 7 and 14: a top document with an application is the tab's chain from now on; a portal frame
          // whose pages frame chain pages keeps its application's canonical address for them (the security fix of
          // 2026-11-06, S4: no token, nothing handed to a page).
          if (from.frameId === 0 && entry.applicationKey !== undefined && from.incognito !== true) {
            await chains.noteTop(from.tabId, { url: from.url, documentId: entry.documentId,
              applicationKey: entry.applicationKey, ...(entry.chainUrl === undefined ? {} : { applicationUrl: entry.chainUrl }) });
          }
          if (entry.applicationKey !== undefined && entry.chained !== true && from.incognito !== true) {
            await chains.notePortal(from.tabId, { frameId: entry.frameId, documentId: entry.documentId,
              applicationKey: entry.applicationKey, url: from.url });
          }
          // jr6 SHELL-B (ICIMS-17): a leaf frame's document the chain keyed now hears its portal's step facts (chain.ts).
          if (entry.chained === true && (previous?.chained !== true || previous.documentId !== entry.documentId)) {
            void chains.leafChained(from.tabId, entry, () => framesOfTab(session, from.tabId)); // jr6 SHELL-B
          }
          const newDocument = previous === null || previous.documentId !== entry.documentId;
          // The document it left goes; anything this document began before its hello stays.
          if (previous !== null && newDocument) await forgetDocument(from.tabId, from.frameId, previous.documentId);
          // A single-page application moved the frame to another address in the same document (v2): its job card is
          // another posting's now, so it goes and is read again; the document's run and report stay (the content
          // script ends a run whose application changed).
          if (previous !== null && !newDocument && navOf(previous) !== navOf(entry)) {
            // The same application at another address (its confirmation drawn in place, Ashby's tabs) keeps its card,
            // when Chrome's address for the frame follows its moves (the tab's own); a subframe's may be its first.
            if (previous.applicationKey !== entry.applicationKey || from.addressFrom !== 'tab') {
              jobs.forgetDocument(from.tabId, from.frameId, entry.documentId);
            }
            // What the document saw submitted goes too, unless the address is the same application's (its confirmation
            // page, drawn in place: the review, 20).
            await submitted.moved(from.tabId, from.frameId, entry.documentId,
              from.addressFrom === 'tab' ? entry.applicationKey ?? null : null);
          }
          // The job chosen and "Apply without resume" follow the application the tab's card frame shows (the review,
          // M2): another application lets them go; its posting page, application page or confirmation keep them.
          if (entry.hasForm || entry.posting === true || entry.confirmation === true) {
            const card = cardFrameOf(await framesOfTab(session, from.tabId));
            if (card !== null && card.frameId === entry.frameId) jobs.applicationShown(from.tabId, entry.applicationKey ?? null);
          }
          // A document the registry has not seen may mean others went (a top frame's new page takes its subframes).
          // The sweep asks them in the background, so the hello is answered at once.
          if (newDocument) void sweepTab(from.tabId, from.frameId).catch(() => undefined);
          // The side panel's strip and card follow what the tab holds now (v2).
          void reports.pageChanged(from.tabId).catch(() => undefined);
          log('frame.registered', { frameId: entry.frameId, top: entry.isTop });
          // v3 Phase 5: the agent's window: a form's document gets the agent's run, a posting's its entry.
          void agent.hello(from.tabId, entry).catch(() => undefined);
          // v1.5 QX: a queued tab's page is open; its first form fills with Automatically (the top frame, or the frame
          // that claims its application, as the Sign up & Autofill start reads them).
          void (async () => {
            if (!(await queueRunner.ownsTab(from.tabId))) return;
            await queueRunner.hello(from.tabId, entry, entry.frameId === 0
              || claimFrameOf(await framesOfTab(session, from.tabId))?.frameId === entry.frameId);
          })().catch(() => undefined);
          // The v4 review (M1): the tab's top frame shows a document on another origin than the one a grant was given
          // for: the grant ends, and the tab's frames hear their settings again.
          if (from.frameId === 0 && newDocument && signUps.moved(from.tabId, entry.origin)) {
            void pushTab(from.tabId).catch(() => undefined);
          }
          // v4: the first form after a wall or a choice that Autofill (or Sign up & Autofill) met with no form starts its
          // run (sign-up.ts), once its hello is answered: in the top frame, or the claim frame or one of its chain
          // frames, of the grant's origin and application alone (the v4 review, M1).
          if (entry.hasForm && (newDocument || previous?.hasForm !== true)
            && (entry.frameId === 0 || agentFramesOf(await framesOfTab(session, from.tabId))
              .some((frame) => frame.frameId === entry.frameId))) {
            const take = signUps.takeFill(from.tabId, entry);
            if (take !== null) {
              void Promise.resolve().then(() => platform.tabs.sendToFrame(from.tabId, { v: 1, type: 'run/start',
                dryRun: false, ...(take.signIn ? { signIn: true as const } : {}) }, frameTarget(entry)))
                .catch(() => log('frame.unreachable'));
            }
          }
          const connected = await auth.connected();
          // v3 Phase 3: a recognised job page (an application form of ours) is looked up as it loads, so the side
          // panel's card and match show at once; the card's own path, with its merge, rate limit and token checks.
          // v3 Phase 3b: and so is a recognised posting page with no form (frames.ts postingAddress, the worker's own
          // reading of the frame's address).
          // The review: not until the person acknowledged the disclosure as it reads now.
          if (lookupOnLoad && (entry.hasForm || entry.posting === true) && connected && (await auth.disclosed())) {
            void jobs.loadCard(from.tabId, tailoritFrom(from, entry)).catch(() => undefined);
          }
          // A top frame that loads beside an open side panel keeps its launcher hidden (v3 Phase 3 review): the panel's
          // panel/side came to the document before, and none comes now.
          return ok({ frameId: from.frameId, connected,
            settings: await contentSettingsFor(from.tabId, entry.applicationKey, from.documentId, entry.origin),
            launcher: await launchers.prefsFor(from.url),
            ...(from.frameId === 0 && reports.sideShows(from.tabId) ? { side: true as const } : {}),
            ...(entry.chained === true && entry.applicationKey !== undefined
              ? { chained: { applicationKey: entry.applicationKey } } : {}) });
        },
        'run/begin': async (message, from) => {
          // v3 Phase 5: the agent's run only in the agent's own window, for its task's application, while it may run;
          // and every run there with the agent's settings, and the task's job and resume.
          const task = await agent.task(from.tabId, message.applicationKey);
          if (message.trigger === 'agent' && task === null) {
            log('agent.refused', { tab: false });
            return refuse('bad_message');
          }
          if (task !== null) jobs.assign(from.tabId, message.applicationKey, task.jobId, task.resumeId);
          return beginRun({ ...beginDeps, settings: { ...settings,
            content: () => contentSettingsFor(from.tabId, message.applicationKey, from.documentId, originOf(from.url)) } },
            message,
            // core-x, items 6 and 7: a chain page is looked up by its application's canonical address.
            await tailoritFromNow(from));
        },
        'plan/request': (message, from) => planner.request(message, from),
        'plan/poll': (message, from) => planner.poll(message, from),
        // Edit with AI (the owner's amendments): one field's rewrite, then plan/poll.
        'draft/rewrite': (message, from) => planner.rewrite(message, from),
        'runstate/get': async (message, from) => {
          if (!fits(message.applicationKey, from)) return refuse('bad_message');
          return ok({ runState: await runStates.get(message.applicationKey, from.tabId) });
        },
        'runstate/put': async (message, from) => {
          // The schema's strings are the core's branded keys (messaging/schemas.check.ts proves the shapes equal).
          const runState = message.runState as unknown as RunState;
          if (!fits(runState.applicationKey, from) || !runState.applicationKey.startsWith(`${runState.platform}:`)) {
            log('runstate.refused');
            return refuse('bad_message');
          }
          const stored = await runStates.put(runState, from.tabId, { incognito: from.incognito === true });
          // The application reached done (its confirmation page): the matches its fields still held are accepted; a
          // private tab's never are (the audit's S-6: nothing of it outlives the private session).
          if (stored.ok && runState.status === 'done') {
            if (from.incognito === true) accepts.forget(runState.applicationKey);
            else await accepts.done(runState.applicationKey, now()).catch(() => 0);
          }
          return stored;
        },
        'runstate/clear': async (message, from) => {
          if (!fits(message.applicationKey, from)) return refuse('bad_message');
          await runStates.clear(message.applicationKey, from.tabId);
          accepts.forget(message.applicationKey);
          return ok({});
        },
        // v3 Phase 3: a run's progress while it fills, for the panels only (no counters, no match cache).
        'report/live': async (message, from) => {
          const answer = await reports.put(message, from);
          if (answer.ok) void agent.reported(from.tabId).catch(() => undefined);
          if (answer.ok) void queueRunner.reported(from.tabId).catch(() => undefined); // v1.5 QX
          return answer;
        },
        'report/put': async (message, from) => {
          const answer = await reports.put(message, from);
          if (answer.ok) void agent.reported(from.tabId).catch(() => undefined);
          if (answer.ok) void queueRunner.reported(from.tabId).catch(() => undefined); // v1.5 QX
          // v4: a Sign up & Autofill grant lasts one run: it ends once the tab's run rests at review, done or stopped.
          if (answer.ok && message.report.mode === 'fill' && ['review', 'done', 'stopped'].includes(message.report.status)
            && signUps.end(from.tabId)) void pushTab(from.tabId).catch(() => undefined);
          // Which of the application's written fields still hold our value, for the accepted-match cache.
          const run = answer.ok && from.incognito !== true ? await runs.find(message.runId, from) : null;
          if (run !== null) accepts.reported(run.applicationKey, message.report);
          return answer;
        },
        'policy/hit': async (message, from) => {
          // Counted before anything else, so a page that pushes addresses is held whatever it sends.
          const retry = policyLimit.take(`${from.tabId}/${from.frameId}`);
          if (retry !== null) return { ok: false, error: 'rate_limited', retryAfterSeconds: retry };
          if (!fits(message.applicationKey, from)) return refuse('bad_message');
          return (await policy.record(message.applicationKey, message.patternId)) ? ok({}) : refuse('bad_message');
        },
        // No await before sidePanel.open: the launcher's click must still count as the person's gesture.
        'panel/open': (_message, from) => openSidePanel(platform, from.tabId),
        // The in-page panel opened or closed in this frame (Phase 6): report/update goes to it alone while it is open.
        'panel/shown': (message, from) => reports.panelShown(from, message.open),
        // The in-page panel's Save my answer (Phase 6, wave 2), for the sending frame's own field.
        'answer/save': (message, from) => answers.saveOwn(message.fieldKey, from),
        // The job card's relay (v2): the frame a job/refresh asked, with its own address as Chrome reports it.
        // core-x, items 6 and 7: a chain page is looked up, and added, by its application's canonical address.
        'job/lookup': async (_message, from) => jobs.relay('lookup', await tailoritFromNow(from)),
        'job/add': async (_message, from) => jobs.relay('add', await tailoritFromNow(from)),
        // The launcher (v3 Phase 3): its place and hiding for the sending frame's site, from the person's trusted drag
        // and click.
        // Only the top frame draws the tab (an embedded form's launcher has neither), and a person's drags and hides
        // come at a person's pace (LAUNCHER_LIMIT, per tab).
        'launcher/place': async (message, from) => {
          if (from.frameId !== 0) return refuse('bad_sender');
          const retry = launcherLimit.take(`${from.tabId}/`);
          if (retry !== null) return { ok: false, error: 'rate_limited', retryAfterSeconds: retry };
          // The audit's S-6: a private tab's drag is its page's alone (the tab keeps it while the page shows); nothing
          // of a private session is written to storage.local.
          if (from.incognito === true) {
            log('launcher.private');
            return ok({});
          }
          await launchers.place(from.url, message.top);
          return ok({});
        },
        // v3 Phase 4: a Submit pressed in the frame, and the platform's confirmation after it (submissions.ts).
        'submit/armed': async (message, from) => {
          // jr7 AUTO-7 A1 (AUTOV-01): with the frame's own address, before tailoritFrom swaps in its chain's.
          const answer = await submitted.armed(message, await tailoritFromNow(from), { url: from.url });
          // v3 Phase 5: the agent's job's one Submit (agent.ts pressed).
          if (answer.ok) await agent.pressed(from.tabId, message.applicationKey, from.documentId).catch(() => undefined);
          return answer;
        },
        'submit/detected': async (message, from) => submitted.detected(message, await tailoritFromNow(from),
          { url: from.url }), // jr7 AUTO-7 A1 (AUTOV-01)
        // v1.3 B: the armed Submit's form, held for it in memory only (submissions.ts).
        'submit/form': async (message, from) => submitted.form(message, await tailoritFromNow(from)),
        // v3 Phase 5: Sign-in mode Auto's credential, to the asking top frame alone (sign-in.ts).
        'signin/credential': (message, from) => signIn.credential(message, from),
        // Round 3 of the v3 Phase 6/7b review (X8): the agent's entry pressed in the top frame, told before the entry
        // waits on what the press brings (agent.ts entered).
        // v3 Phase 8: the sentinel's one message (sites.ts).
        'page/recognised': (message, from) => sites.recognised(message, from),
        // v5 p2-detect, the P2 review (security 1): the submit watcher, on an employer's own Oracle page whose app showed.
        'site/watch': (_message, from) => sites.watch(from),
        // s2 lists: the sending frame's host's learned lists, and one learned (learned-lists.ts), by Chrome's address;
        // with them the stored lists its adapter names (stored-lists.ts: the content script carries none of them).
        'lists/known': async (message, from) => {
          const retry = listsLimit.take(`${from.tabId}/`);
          if (retry !== null) return { ok: false, error: 'rate_limited', retryAfterSeconds: retry };
          const stored = message.stored === undefined || message.stored.length === 0 ? {}
            : { stored: storedListsOf(message.stored) };
          return ok({ lists: await learnedLists.known(from.url), ...stored });
        },
        'lists/learn': async (message, from) => {
          const retry = listsLimit.take(`${from.tabId}/`);
          if (retry !== null) return { ok: false, error: 'rate_limited', retryAfterSeconds: retry };
          // The audit's S-6: nothing of a private session is written to storage.local.
          if (from.incognito === true) {
            log('lists.private');
            return ok({});
          }
          await learnedLists.learn(from.url, message.key, message.labels);
          return ok({});
        },
        // v5 p1-shell: the sidebar's bundle, for the tab's top frame (sidebar.ts), and its link to the settings page.
        'sidebar/load': (_message, from) => sidebar.load(from),
        // v5 p2-fill: the page patches in the asking frame's page world (page-patches.ts).
        'page/patches': (_message, from) => pagePatches.load(from),
        'sidebar/options': async (message, from) => {
          // jr6: the no-sign-in toast's Open in the frame that claims the tab's application (an iCIMS portal's) too, for
          // Sign-up Information alone.
          const claim = from.frameId !== 0 && message.section === SIGNUP_SECTION
            ? claimFrameOf(await framesOfTab(session, from.tabId)) : null;
          const claimed = claim !== null && claim.frameId === from.frameId
            && claim.documentId === (from.documentId ?? null) && from.reach !== 'sentinel';
          if (!sidebarChannel(from) && !claimed) return refuse('bad_sender');
          const retry = launcherLimit.take(`${from.tabId}/`);
          if (retry !== null) return { ok: false, error: 'rate_limited', retryAfterSeconds: retry };
          await platform.tabs.create(platform.runtime.getURL(`/options.html${message.section === undefined ? ''
            : `#${message.section}`}`));
          return ok({});
        },
        // ── v1.5 X (PLAN decisions 2 and 3): the documents' dialogs over the page, the tab's top frame alone ──
        // The preview dialog's "Open In A New Tab": the full-window page of the sender's own tab, while a preview grant of
        // that tab names the document (its dialog was shown), under panel/openDocument's limit.
        'preview/openTab': async (message, from) => {
          if (!sidebarChannel(from) || !dialogs.previewing(from.tabId, message.kind)) {
            log('document.refused', { tab: true });
            return refuse('bad_sender');
          }
          const retry = openLimit.take(`${from.tabId}/`);
          if (retry !== null) return { ok: false, error: 'rate_limited', retryAfterSeconds: retry };
          await openPreviewTab(from.tabId, message.kind);
          log('tailor.opened', { preview: true, letter: message.kind === 'coverLetter', fromPage: true });
          return ok({});
        },
        // The upload edit confirm's Continue: its grant names the resume (once); the person's "Don't show this again"
        // is kept, then TailorIT's /resumes/<id>/edit opens. Its id never reached the page.
        'edit/confirmed': async (message, from) => {
          if (!sidebarChannel(from)) return refuse('bad_sender');
          const resumeId = dialogs.takeEdit(from.tabId, message.grant);
          if (resumeId === null) return refuse('expired');
          if (!(await auth.connected())) return refuse('not_connected');
          const url = editorUrlOf(origin, 'resume', resumeId, false);
          if (url === null) return refuse('expired');
          if (message.skip) await skipUploadConfirm();
          await platform.tabs.create(url);
          log('document.edit', { confirmed: true, page: true, skip: message.skip });
          return ok({});
        },
        // ── end v1.5 X ──
        // v4: the account wall a tab's top or claim frame shows now (content/runtime.ts tellWall), for PageState.wall.
        'frame/wall': async (message, from) => {
          const { before, entry } = await lockTab(from.tabId, async () => {
            const held = await frameEntry(session, from.tabId, from.frameId);
            return { before: held, entry: await setWall(session, from.tabId, from.frameId, from.documentId ?? null,
              { wall: message.wall, choice: message.choice === true,
                ...(message.waits === undefined ? {} : { waits: message.waits }),
                // v5 p2-fill: a posting's own Apply, which the panel's Autofill presses; v5 p2-fill review (L5): its
                // press refused.
                ...(message.entry === true ? { entry: true } : {}),
                ...(message.entryRefused === true ? { entryRefused: true } : {}),
                // jr6 apply F3a (item 4): its press under way, and why it was refused.
                ...(message.entering === true ? { entering: true } : {}),
                ...(message.refusal === undefined ? {} : { refusal: message.refusal }) }) };
          });
          if (entry === null) return refuse('expired');
          log('frame.wall', { shown: message.wall !== null, choice: message.choice === true });
          void reports.pageChanged(from.tabId).catch(() => undefined);
          // v1.5 QX: a queued tab whose application frame (its top frame or claim frame, wallFrameOf) shows the
          // posting's own Apply, an entry choice or an account wall, and no form: with Automatically, its Autofill.
          if (message.wall !== null || message.choice === true || message.entry === true) {
            void (async () => {
              if (!(await queueRunner.ownsTab(from.tabId))) return;
              const frames = await framesOfTab(session, from.tabId);
              if (frames.some((frame) => frame.hasForm) || wallFrameOf(frames)?.frameId !== from.frameId) return;
              await queueRunner.wall(from.tabId, { applicationKey: entry.applicationKey, wall: message.wall !== null });
            })().catch(() => undefined);
          }
          // jr6 apply F3a: what the tab's grant and card make of it (entryWords). `entering` and `refusal` never start
          // the queue's Autofill above (AF-5 corrected: once per job, from a wall, a choice or an entry alone).
          await entryWords(message, from, before, entry);
          return ok({});
        },
        // jr6 apply F3a (item 3): the tab's application frame pressed the site's own Apply for the panel's Autofill
        // (content/press.ts, at the press): its pending entry grant is armed (sign-up.ts pressed). Counted first, 6 a
        // minute per tab; only from the tab's application frame (its claim frame, else its top frame: wallFrameOf), in
        // the document registered for it, on that frame's origin; sign-up.ts takes it only from a document the grant
        // sent run/start to, on the grant's origin. Logged as flags.
        'entry/pressed': async (message, from) => {
          const retry = entryLimit.take(`${from.tabId}/`);
          if (retry !== null) {
            log('grant.armed', { armed: false, limited: true });
            return { ok: false, error: 'rate_limited', retryAfterSeconds: retry };
          }
          const application = wallFrameOf(await framesOfTab(session, from.tabId));
          if (application === null || application.frameId !== from.frameId || from.documentId === undefined
            || application.documentId !== from.documentId || application.origin !== originOf(from.url)) {
            log('grant.armed', { armed: false, frame: false });
            return refuse('bad_sender');
          }
          const armed = signUps.pressed(from.tabId, application, message.nextKey);
          log('grant.armed', { armed, nextKey: message.nextKey !== undefined });
          return armed ? ok({}) : refuse('expired');
        },
        'agent/entered': async (_message, from) => {
          // core-x, item 3: the tab's top frame, or the frame that claims its application (agent.ts checks it is the
          // agent's own).
          if (from.frameId !== 0 && claimFrameOf(await framesOfTab(session, from.tabId))?.frameId !== from.frameId) {
            return refuse('bad_sender');
          }
          await agent.entered(from.tabId, from.documentId).catch(() => undefined);
          return ok({});
        },
        'launcher/hide': async (message, from) => {
          if (from.frameId !== 0) return refuse('bad_sender');
          const retry = launcherLimit.take(`${from.tabId}/`);
          if (retry !== null) return { ok: false, error: 'rate_limited', retryAfterSeconds: retry };
          // The audit's S-6: in a private tab every hiding is the page's alone ("until next visit", in storage.session
          // and gone with the tab): nothing of a private session is written to storage.local.
          if (message.scope === 'next-visit' || from.incognito === true) {
            await session.set({ [visitKey(from.tabId)]: from.documentId ?? '' });
            if (from.incognito === true) log('launcher.private');
            else log('launcher.hidden', { everywhere: false, visit: true });
            return ok({});
          }
          await launchers.hide(from.url, message.scope);
          return ok({});
        },
        // jr6 SHELL-B (ICIMS-17): the tab's claim frame says its step bar's facts for the IForm leaf it frames: kept for
        // its document and handed to the leaf frames chained from it (chain.ts factsSaid); any other frame: expired.
        'chain/facts': async (message, from) => (from.incognito !== true && await chains.factsSaid(from.tabId, // jr6 SHELL-B
          { frameId: from.frameId, documentId: from.documentId ?? null }, message.facts, // jr6 SHELL-B
          () => framesOfTab(session, from.tabId)) ? ok({}) : refuse('expired')), // jr6 SHELL-B
        ...(__E2E__
          ? {
              'e2e/probe': async (message: { storageLocal?: 'refused' | 'allowed'; settled?: true }, from: ContentChannel) => {
                await noteE2e(message.settled === true ? { type: 'content-settled', tabId: from.tabId, frameId: from.frameId }
                  : { type: 'storage-local-probe', result: message.storageLocal });
                return ok({});
              },
            }
          : {}),
      },
      page: {
        ping: async () => ok({ pong: true as const }),
        'panel/fill': (message) => panel.fill(message),
        'panel/continue': (message) => panel.continue(message),
        'panel/cancel': (message) => panel.cancel(message),
        'panel/policyDecision': (message) => panel.policyDecision(message),
        'panel/focus': (message) => panel.focus(message),
        'panel/describe': (message) => panel.describe(message),
        'panel/reports': (message) => panel.reports(message),
        // The job card, Add/Save to tracker, the resume picker and the custom question (v2).
        'panel/job': (message) => jobs.card(message),
        'panel/addJob': (message) => jobs.add(message),
        'panel/resumes': (message) => jobs.resumes(message),
        'panel/setResume': (message) => jobs.setResume(message),
        'panel/ask': (message) => ask(message),
        // The job card's cover letter (Phase G): whether there is one, or Write it now.
        'panel/letter': (message) => panelLetters.letter(message),
        'panel/confirmDraft': (message) => answers.confirmDraft(message),
        'panel/saveAnswer': (message) => answers.saveAnswer(message),
        // v3 Phase 3: Skip on the field a frame's run writes now; the launcher hidden, and shown again.
        'panel/skip': (message) => panel.skip(message),
        'panel/launcher': async (message) => {
          const top = await topFrameOf(message.tabId);
          const stored = await launchers.hiddenFor(top?.origin ?? null);
          if (stored !== 'none') return ok({ hidden: stored });
          // Hidden until next visit, on the page the tab shows now.
          const visit = await session.get(visitKey(message.tabId));
          const onThisPage = top !== null && typeof visit === 'string' && visit === (top.documentId ?? '');
          return ok({ hidden: onThisPage ? 'visit' : 'none' });
        },
        'panel/showLauncher': async (message) => {
          const top = await topFrameOf(message.tabId);
          await launchers.show(top?.origin ?? null);
          await session.remove([visitKey(message.tabId)]);
          await tellLauncherPrefs(message.tabId, true);
          return ok({});
        },
        // v3 Phase 3b: "Autofill for another job", "Ask TailorIT to support this site", "Your autofill information",
        // "Apply without resume"; v3 Phase 4: the panel's Next and Submit.
        'panel/jobSearch': (message) => jobs.search(message),
        'panel/chooseJob': (message) => jobs.chooseJob(message),
        'panel/siteRequest': (message) => siteRequests(message),
        'panel/profile': (message) => profileEditor.read(message),
        'panel/profileCheck': () => profileEditor.check(), // v5 p1-panel
        'panel/saveProfile': (message) => profileEditor.save(message),
        'panel/withoutResume': (message) => jobs.setWithout(message),
        'panel/press': (message) => panel.press(message),
        // The review: Try again, when the tracker could not be told of a submitted application.
        'panel/retryApplied': (message) => submitted.retry(message.tabId, async (tabId, frameId) => {
          // After a worker restart the frame's address is not known (it is never stored): the card then reads afresh.
          const frame = await frameEntry(session, tabId, frameId);
          return frame === null ? null : { tabId, frameId, documentId: frame.documentId ?? undefined, url: '' };
        }),
        'settings/get': async () => ok({ settings: await settings.get() }),
        'settings/save': async (message) => {
          // jr6 (signup.ts, Sign-in mode's guard): Sign-in on Auto needs a job-site password saved in this browser.
          const wanted = message.base === undefined ? message.settings
            : mergeSettings(await settings.get(), message.base, message.settings);
          if (holdsSignInAuto(wanted) && !(await signupVault.has())) {
            log('signup.refused', { auto: true });
            return refuse('unavailable');
          }
          // The audit's M4: what the page changed from the settings it read, applied to the stored ones.
          let saved = await settings.save(message.settings, message.base);
          // The jr6 review (sec-9): a delete that landed between the check above and the save leaves Auto with no
          // password: set back to Manual at once, and answered as stored then.
          if (holdsSignInAuto(saved) && (await signup.keepModeHonest('save'))) {
            saved = await settings.get();
            reports.tellPanels('signup');
          }
          // Every frame with a form hears of it, so a run in progress reads auto-advance afresh (Phase 5 review, C-S2).
          await pushNow();
          // And every side panel (v2): the custom question follows the AI drafts switch.
          reports.tellPanels('settings');
          // v5 p1-shell: the toolbar icon follows where the panel shows.
          await placeIcon();
          return ok({ settings: saved });
        },
        'auth/status': async () => ok(await auth.status()),
        // jr6: Settings › Sign-up Information (signup.ts): the extension's own pages alone, never the sidebar's.
        'signup/status': () => signup.status(),
        'signup/save': (message) => signup.save(message),
        'signup/delete': () => signup.remove(),
        'signup/import': () => signup.importFromTailorIT(),
        'auth/startPairing': () => auth.startPairing(),
        'auth/redeemCode': (message) => auth.redeemCode(message.code),
        'auth/disconnect': () => auth.disconnect(),
        'auth/acknowledgeDisclosure': async () => {
          const answer = await auth.acknowledgeDisclosure();
          // A run in progress reads Submit and Sign-in modes as they act now.
          await pushNow();
          reports.tellPanels('connection');
          reports.tellPanels('agent');
          return answer;
        },
        'runs/clear': async () => ok({ cleared: await runStates.clearAll() }),
        'telemetry/get': async () => ok({ counts: await telemetry.read() }),
        // v3 Phase 5: the auto-apply agent's switch, status and Stop (the options page and the side panel).
        'agent/status': async () => ok(await agent.status()),
        // v1.5 QX: Run auto-apply turned on stops the sequential auto-apply first (the two never run together).
        'agent/set': async (message) => {
          if (message.on && (await queueRunner.active())) await queueRunner.stop('agent');
          return agent.set(message.on, message.confirmed === true);
        },
        'agent/stop': () => agent.stop(),
        // v1.5 QX: the Queue tab (the sidebar's and Chrome's side panel's).
        'queue/status': async () => ok(await queueRunner.status()),
        'queue/list': (message) => queueRunner.list(message.offset),
        'queue/start': () => queueRunner.start(),
        'queue/stop': () => queueRunner.stop('person'),
        'queue/pause': () => queueRunner.pause(),
        'queue/resume': () => queueRunner.resume(),
        'queue/focus': (message) => queueRunner.focus(message.id),
        // v3 Phase 8: Options › "Where Autofill works".
        'sites/get': async () => ok(await sites.state()),
        'sites/set': async (message) => ok(await sites.set(message.on)),
        'telemetry/clear': async () => {
          await telemetry.clear();
          return ok({ counts: [] });
        },
        // v5 p1-shell: the header's notes (Workday's "stay on this page" strip).
        'panel/notes': () => sidebar.notes(),
        'panel/closeNote': (message) => sidebar.closeNote(message.note),
        // v1.4 F: the job card's tailoring, Preview and Edit, and the templates (Options, Settings, the profile editor).
        'panel/tailor': (message) => tailoring.tailor(message),
        'panel/openDocument': (message) => openDocument(message),
        'panel/documents': (message) => profileEditor.documents(message),
      },
    }),
  );

  // TailorIT's connect page, for pairing only: its exact origin, that page, and the pending state.
  platform.runtime.onMessageExternal(async (message, sender) => {
    if (!isConnectPage(sender, origin)) {
      log('router.bad-sender');
      return refuse('bad_sender');
    }
    const parsed = ExternalMessageSchema.safeParse(message);
    if (!parsed.success) {
      log('router.bad-message');
      return refuse('bad_message');
    }
    try {
      return await auth.completePairing(parsed.data);
    } catch {
      log('router.handler-failed');
      return refuse('internal');
    }
  });

  platform.runtime.onConnect((port) => {
    const channel = port.sender ? channelOf(port.sender, ownId, ownPagesPrefix) : null;
    if (port.name === 'resume' && channel?.kind === 'content') {
      // Listening starts at once (a message posted before the access level settles is not lost); the request is
      // served once it has.
      resume.accept(port, channel, () => contentReady());
      return;
    }
    // v3 Phase 8: a company's own page the worker injected. Its messages
    // are held while the injection is read from storage (a worker that restarted since).
    const off = port.name === 'resume' && channel === null && port.sender ? offAtsSenderOf(port.sender, ownId, ownPagesPrefix) : null;
    if (off !== null) {
      const held = heldPort(port);
      const known = sites.injected.now(off.tabId, off.frameId, off.documentId);
      void (known !== undefined ? Promise.resolve(known) : sites.injected.read(off.tabId, off.frameId, off.documentId))
        .then((kind) => {
          const site = offAtsChannelOf(off, kind, null);
          if (site?.reach === 'site') resume.accept(held, site, () => contentReady());
          else {
            log('port.refused');
            port.disconnect();
          }
        }, () => port.disconnect());
      return;
    }
    if (port.name === 'panel' && channel?.kind === 'page') {
      reports.watch(port);
      return;
    }
    // v5 p1-shell: the sidebar's port (`panel`; the review's S6: never `preview`), from the tab's top frame (an ATS
    // host's, or a page the worker injected), held to its tab, while the panel shows on the page; what it posts before
    // that is known is held.
    const sidebarFrom = SIDEBAR_PORTS.has(port.name) && port.sender !== undefined ? (channel?.kind === 'content' ? channel
      : channel === null ? offAtsSenderOf(port.sender, ownId, ownPagesPrefix) : null) : null;
    if (sidebarFrom !== null && sidebarChannel(sidebarFrom)) {
      const held = heldPort(port);
      const injectedFrame = channel === null;
      void (async () => {
        const reached = !injectedFrame || (sites.injected.now(sidebarFrom.tabId, 0, sidebarFrom.documentId)
          ?? await sites.injected.read(sidebarFrom.tabId, 0, sidebarFrom.documentId)) !== null;
        if (!reached || !(await onPage())) {
          log('sidebar.refused', { port: true });
          port.disconnect();
          return;
        }
        reports.watch(scopedPort(held, sidebarFrom.tabId));
      })().catch(() => port.disconnect());
      return;
    }
    // v3 Phase 3b: the side panel's resume preview, an extension page's port only.
    if (port.name === 'preview' && channel?.kind === 'page') {
      resume.acceptPreview(port, previewResumeOf, () => contentReady(), previewLetterOf);
      return;
    }
    // v1.5 X (PLAN decision 2): the preview page embedded in the page's dialog (a framed extension page): its own tab's
    // documents alone, and only those a live grant of that tab names (document-dialog.ts).
    if (port.name === 'preview' && channel?.kind === 'framed') {
      const framed = channel;
      resume.acceptPreview(port, previewResumeOf, () => contentReady(), previewLetterOf,
        (request) => request.tabId === framed.tabId && dialogs.admits(framed.tabId, request.grant, request.kind));
      return;
    }
    log('port.refused');
    port.disconnect();
  });

  platform.runtime.onInstalled(() => {
    void restrict();
    // v5 p1-shell: Chrome opens the side panel on the icon's click only while the panel's place is the side panel.
    void placeIcon();
    // v3 Phase 8: the sentinel's registrations, as the person's choice and Chrome's permissions stand.
    void sites.reconcile().catch(() => undefined);
  });

  // v3 Phase 8: the person granted or took back a host permission (in Options, or in Chrome's own settings).
  platform.permissions.onChanged(() => {
    void sites.reconcile().catch(() => undefined);
  });

  // v5 p1-shell (PLAN decision 2): the toolbar icon, while the panel shows on the page (Chrome opens the side panel by
  // itself otherwise). A page a frame of ours may draw on hears sidebar/open, and its launcher comes back where the
  // person hid it; a company's own https page whose top frame runs no script of ours yet gets the content script first
  // (sites.ts injectTop), and hears it once the script listens; any other page (a browser page, LinkedIn, an HR system,
  // an http page off the ATS hosts) gets the side panel, asked for inside the click, before anything is awaited.
  const askSidebarOpen = async (tabId: number): Promise<boolean> => {
    try {
      const answer = await platform.tabs.sendToFrame(tabId, { v: 1, type: 'sidebar/open', reveal: true }, { frameId: 0 });
      // The content script's answer alone (the sentinel, alone in a frame, answers nothing).
      return (answer as { ok?: unknown } | undefined)?.ok === true;
    } catch {
      return false;
    }
  };
  platform.action.onClicked((tab) => {
    if (!iconReachesPage(tab.url)) {
      log('action.clicked', { page: false });
      void openSidePanel(platform, tab.id);
      return;
    }
    log('action.clicked', { page: true });
    void (async () => {
      const top = await topFrameOf(tab.id);
      const site = top?.origin ?? tab.url ?? null;
      if (site !== null) await launchers.show(site);
      await session.remove([visitKey(tab.id)]);
      await tellLauncherPrefs(tab.id, true);
      if (await askSidebarOpen(tab.id)) return;
      if (await sites.injectTop(tab.id, tab.url, tab.incognito === true)) {
        // The injected script listens once its start-up has run: asked again a few times meanwhile.
        for (let attempt = 0; attempt < ICON_OPEN_TRIES; attempt += 1) {
          if (await askSidebarOpen(tab.id)) return;
          await new Promise<void>((resolve) => timers.after(ICON_OPEN_GAP_MS, resolve));
        }
      }
      // No frame of ours draws this page (it loaded before the extension, or the site is not reached): the side panel,
      // where Chrome still takes it after the click.
      log('action.clicked', { page: true, unreached: true });
      await openSidePanel(platform, tab.id);
    })().catch(() => undefined);
  });


  // v3 Phase 5: the agent's alarm wakes the worker while Run auto-apply is on.
  platform.alarms.onAlarm((name) => {
    if (name === AGENT_ALARM) void agent.tick().catch(() => undefined);
    // v1.5 QX: the sequential auto-apply's, while it runs, a tab waits for its page or a result waits to be told.
    if (name === QUEUE_ALARM) void queueRunner.tick().catch(() => undefined);
  });

  // Round 2 of the v3 Phase 6/7b review (K3): the agent's tab at a page that says no hello is answered at its load
  // (round 3, X8: the agent's tab alone, its address read only then).
  platform.tabs.onLoaded?.((tabId, shown) => {
    void agent.loaded(tabId, shown).catch(() => undefined);
  });

  platform.tabs.onRemoved((tabId) => {
    void agent.tabRemoved(tabId).catch(() => undefined);
    void queueRunner.tabRemoved(tabId).catch(() => undefined); // v1.5 QX
    signUps.end(tabId);
    dialogs.dropTab(tabId); // v1.5 X
    void signIn.forgetTab(tabId).catch(() => undefined);
    void chains.forgetTab(tabId).catch(() => undefined);
    beginLimit.forget(`${tabId}/`);
    launcherLimit.forget(`${tabId}/`);
    void session.remove([visitKey(tabId)]).catch(() => undefined);
    reportLimit.forget(`${tabId}/`);
    policyLimit.forget(`${tabId}/`);
    shownLimit.forget(`${tabId}/`);
    entryLimit.forget(`${tabId}/`); // jr6 apply F3a
    askLimit.forget(`${tabId}/`);
    letterLimit.forget(`${tabId}/`);
    jobs.forgetTab(tabId);
    sites.forgetTab(tabId);
    panelLetters.forgetTab(tabId);
    tailoring.forgetTab(tabId); // v1.4 F
    openLimit.forget(`${tabId}/`);
    submitted.forgetTab(tabId);
    void Promise.all([
      forgetTabFrames(session, tabId),
      reports.forgetTab(tabId),
      runs.forgetTab(tabId),
      runStates.forgetTab(tabId),
    ]).catch(() => undefined);
  });

  // Development builds only: the snapshot hotkeys (capture.ts). The test is a compile-time constant, so a production
  // bundle drops this branch, and capture.ts with it; scripts/check-build.mjs fails a build that still holds them.
  if (import.meta.env.MODE === 'development') registerCaptureHotkeys(options.capture ?? createCaptureWorkerPlatform(), timers);

  // ── Start-up ────────────────────────────────────────────────────────────────────────────────────────────────────
  async function restrict(): Promise<void> {
    try {
      await local.restrictToTrustedContexts();
      state.storageAccess = 'restricted';
    } catch {
      state.storageAccess = 'refused';
      log('worker.access-level-refused');
    }
  }
  accessReady = restrict();
  state.ready = accessReady.then(() => runStates.prune().catch(() => undefined))
    // jr6: Sign-in Auto needs a password saved in this browser; settings that held it before (when the password was
    // TailorIT's), or with one that went, go back to Manual, which the card then says (the jr6 review, R12).
    .then(() => signup.keepModeHonest('startup').then((reverted) => {
      if (reverted) {
        reports.tellPanels('settings');
        reports.tellPanels('signup');
      }
    }).catch(() => undefined));
  // v3 Phase 5: the agent picks up where it was (its job, a result still to tell, the queue).
  void state.ready.then(() => agent.start()).catch(() => undefined);
  // v1.5 QX: the sequential auto-apply picks up where it was (its timer, its tabs, a result still to tell).
  void state.ready.then(() => queueRunner.boot()).catch(() => undefined);
  // v3 Phase 8: the injected frames back in memory, and the sentinel's registrations reconciled.
  void sites.start().catch(() => undefined);
  // v5 p1-shell: the toolbar icon as the settings say (an update keeps them, and onInstalled may not come).
  void placeIcon();
  log('worker.started');
  return state;
}
