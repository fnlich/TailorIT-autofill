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
import { ExternalMessageSchema } from '../messaging/schemas';
import { createWorkerPlatform } from '../platform/chrome';
import type { WorkerPlatform } from '../platform/types';
import { log } from '../shared/log';
import { AGENT_ALARM, createAgent, type Agent } from './agent';
import { createAuth, createTokenKeeper } from './auth';
import { toBase64Url } from './bytes';
import { createAiTasks } from './ai-tasks';
import { ASK_LIMIT, createAsk } from './ask';
import { createPanelLetters, LETTER_LIMIT } from './cover-letters';
import { createAnswerHandlers } from './row-actions';
import type { CoreFunctions } from './core';
import {
  cardFrameOf, createFrameSweep, forgetFrames, forgetTab as forgetTabFrames, frameEntry, framesOfTab, frameTarget, navOf,
  registerFrame,
} from './frames';
import { createJobCards, JOB_RELAY_LIMIT, LOOKUP_ON_LOAD_LIMIT, type JobCards } from './job-cards';
import { createLauncherStore, LAUNCHER_LIMIT } from './launcher';
import { createKeyedQueue, createRateLimit } from './locks';
import { createAcceptBook, createMatchCache } from './match-cache';
import { createPanelHandlers, openSidePanel } from './panel';
import { createPlanner } from './planner';
import { createPolicyBook, POLICY_HIT_LIMIT } from './policy';
import { createProfileCache, type ProfileCache } from './profile-cache';
import { createProfileEditor, PROFILE_EDIT_LIMIT } from './profile-editor';
import { createSiteRequests, SITE_REQUEST_LIMIT } from './site-requests';
import { createSubmissions, SUBMIT_MESSAGE_LIMIT, type Submissions } from './submissions';
import { createReports, PANEL_SHOWN_LIMIT, REPORT_PUT_LIMIT, type Reports } from './reports';
import { fillsFromProfileOnly, latestReport, saysNoAi } from '../shared/report';
import { createResumeChooser } from './resume-choice';
import { createResumeTransfer } from './resume-transfer';
import { createRouter, type ContentChannel } from './router';
import { beginRun, keyFitsFrame, RUN_BEGIN_LIMIT } from './run-begin';
import { createRunRegistry, type RunRegistry } from './runs';
import { createRunStateStore } from './runstate-store';
import { channelOf, isConnectPage } from './senders';
import { createServerClient } from './server-client';
import { contentSettingsOf, createSettingsStore, pushSettings } from './settings';
import { createSignIn } from './sign-in';
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

/** Content messages that skip the access-level wait. */
const UNGATED: ReadonlySet<string> = new Set(['ping', 'panel/open']);

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
  let submissions: Submissions | null = null;
  let agentRef: Agent | null = null;
  const keeper = createTokenKeeper(platform, () => {
    profiles?.drop();
    runRegistry?.dropTokenData();
    jobCards?.dropTokenData();
    letterRows?.dropTokenData();
    submissions?.dropTokenData();
    // v3 Phase 5: the agent's job closes; its result waits for a connection to tell it.
    void agentRef?.tokenChanged().catch(() => undefined);
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
  const auth = createAuth({ platform, origin, server, keeper, storageAccess: () => state.storageAccess });
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
    submitted: async (tabId) => submissions?.stateOf(tabId) });
  // The launcher's place and hiding per site (v3 Phase 3): storage.local, a hash of the host only.
  const launchers = createLauncherStore(local);
  const launcherLimit = createRateLimit(LAUNCHER_LIMIT.count, LAUNCHER_LIMIT.windowMs, now);
  /** "Hide until next visit" for a tab's page (v3 Phase 3 review), in storage.session: the top frame's document it was
   *  chosen in, so the side panel can offer it back; a later page of the tab never reads as hidden. */
  const visitKey = (tabId: number) => `launcher-visit:${tabId}`;
  panelReports = reports;
  // The side panel's job card and custom question (v2): read through the tab's form frame, kept in memory only.
  const jobs = createJobCards({ session, tabs: platform.tabs, server, connected: () => auth.connected(),
    onLoadLimit: createRateLimit(LOOKUP_ON_LOAD_LIMIT.count, LOOKUP_ON_LOAD_LIMIT.windowMs, now),
    generation: () => keeper.generation, now, limit: relayLimit });
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
    aiTaskIds: runStates, cache: matchCache, accepts, letters, now,
    withoutResume: (tabId, applicationKey) => jobs.without(tabId, applicationKey) });
  const resume = createResumeTransfer({ runs, server, profiles: profileCache, timers, sha256: (bytes) => platform.sha256(bytes),
    choose: chooseResume, letters });
  const panel = createPanelHandlers({ platform, reports, connected: () => auth.connected(), check: (tabId) => checkTab(tabId) });
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
  // v3 Phase 3b: the side panel's "Your autofill information" and "Ask TailorIT to support this site".
  const profileEditor = createProfileEditor({ server, profiles: profileCache, connected: () => auth.connected(),
    scopes: async () => (await keeper.current())?.scopes ?? [],
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
    // v3 Phase 5: the agent's own tab's sign finishes its job (its result records Applied).
    agentSubmitted: (tabId, applicationKey) => agent.submitted(tabId, applicationKey) });
  submissions = submitted;
  /** The resume a fill of the tab would attach, for the side panel's preview (v3 Phase 3b): the person's choice, else
   *  the card's; read from the account's list, for its file kind and name. None while the tab applies without one. */
  async function previewResumeOf(tabId: number) {
    const frame = cardFrameOf(await framesOfTab(session, tabId));
    if (jobs.without(tabId, frame?.applicationKey ?? null)) return null;
    const id = jobs.chosen(tabId) ?? (await jobs.tabJob(tabId)).resume?.id ?? null;
    if (id === null) return null;
    const list = await server.resumes();
    const item = list.ok ? list.value.items.find((entry) => entry.id === id) : undefined;
    return item === undefined ? null : { id: item.id, fileKind: item.fileKind, fileName: item.fileName };
  }
  /** Whether Sign-in mode may act as Auto (v3 Phase 5): the connection holds credentials:read and the person
   *  acknowledged the disclosure as it reads now. */
  const signInAllowed = async () => ((await keeper.current())?.scopes ?? []).includes('credentials:read')
    && (await auth.disclosed());
  /** What holds a mode at Manual now: Submit until the disclosure was acknowledged (the v3 Phase 4 review); Sign-in
   *  unless it is allowed (v3 Phase 5). */
  const holds = async () => ({ holdSubmit: !(await auth.disclosed()), holdSignIn: !(await signInAllowed()) });
  /** The content settings as they act now for a frame of `tabId` showing `applicationKey` in document `documentId`: in
   *  the auto-apply agent's window, for its task's application and while it may run, the agent's (v3 Phase 5: Next and
   *  Submit on Auto; Submit on Manual in a document but the one the job's Submit was pressed in, once it was). */
  const contentSettingsFor = async (tabId: number, applicationKey: string | null | undefined,
    documentId: string | null | undefined) => {
    const task = await agent.task(tabId, applicationKey, documentId);
    return contentSettingsOf(await settings.get(), { ...(await holds()), agent: task !== null,
      agentSubmitHeld: task?.submitHeld === true });
  };
  /** v3 Phase 5: the auto-apply agent. Its alarm's listener is registered below, with the others. */
  const agent = createAgent({ server, local, session, windows: platform.windows, alarms: platform.alarms, timers, now,
    scopes: async () => (await keeper.current())?.scopes ?? null,
    disclosed: () => auth.disclosed(),
    reports: (tabId) => reports.ofTab(tabId),
    topFrame: (tabId) => topFrameOf(tabId),
    send: (tabId, message, target) => platform.tabs.sendToFrame(tabId, message, target),
    nonce: () => toBase64Url(platform.randomBytes(16)),
    // The tab it lets go of: every frame of ours there stops its run and hears the person's own settings.
    release: async (tabId) => {
      const frames = await framesOfTab(session, tabId);
      await Promise.all(frames.map(async (frame) => {
        try {
          await platform.tabs.sendToFrame(tabId, { v: 1, type: 'run/cancel' }, frameTarget(frame));
          await platform.tabs.sendToFrame(tabId, { v: 1, type: 'settings/changed',
            settings: await contentSettingsFor(tabId, frame.applicationKey, frame.documentId) }, frameTarget(frame));
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
  /** v3 Phase 5: Sign-in mode Auto's credential, for a paused run's top frame. */
  const signIn = createSignIn({ server, session, now,
    signInAuto: async () => (await settings.get()).modes.signIn === 'auto' && (await signInAllowed()) });
  /** Every frame with a form hears the settings as they act now (settings/changed), the agent's tab the agent's. */
  const pushNow = async (saved?: Awaited<ReturnType<typeof settings.get>>) => pushSettings({ session, tabs: platform.tabs },
    saved ?? await settings.get(), { ...(await holds()), agentTab: await agent.tab() });
  const beginDeps = {
    jobs,
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

  /** Whether a frame may speak for this application (its key's platform is the frame host's). */
  const fits = (applicationKey: string, from: ContentChannel) => keyFitsFrame(applicationKey, from.url);

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
      contentGate: { ready: () => accessReady, except: UNGATED },
      content: {
        ping: async () => ok({ pong: true as const }),
        'frame/hello': async (message, from) => {
          const { previous, entry } = await lockTab(from.tabId, async () => {
            const held = await frameEntry(session, from.tabId, from.frameId);
            // The same document at an address no parser reads keeps the application it last showed (a Submit that
            // moved the page there is still that application's).
            const keep = held !== null && held.documentId === (from.documentId ?? null) ? held.applicationKey : undefined;
            return { previous: held, entry: await registerFrame(session, { ...from, isTop: message.isTop,
              hasForm: message.hasForm, nav: message.nav, ...(message.letter === true ? { letter: true } : {}),
              ...(keep === undefined ? {} : { keepKey: keep }) }, now()) };
          });
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
          const connected = await auth.connected();
          // v3 Phase 3: a recognised job page (an application form of ours) is looked up as it loads, so the side
          // panel's card and match show at once; the card's own path, with its merge, rate limit and token checks.
          // v3 Phase 3b: and so is a recognised posting page with no form (frames.ts postingAddress, the worker's own
          // reading of the frame's address).
          // The review: not until the person acknowledged the disclosure as it reads now.
          if (lookupOnLoad && (entry.hasForm || entry.posting === true) && connected && (await auth.disclosed())) {
            void jobs.loadCard(from.tabId, from).catch(() => undefined);
          }
          // A top frame that loads beside an open side panel keeps its launcher hidden (v3 Phase 3 review): the panel's
          // panel/side came to the document before, and none comes now.
          return ok({ frameId: from.frameId, connected,
            settings: await contentSettingsFor(from.tabId, entry.applicationKey, from.documentId),
            launcher: await launchers.prefsFor(from.url),
            ...(from.frameId === 0 && reports.sideShows(from.tabId) ? { side: true as const } : {}) });
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
            content: () => contentSettingsFor(from.tabId, message.applicationKey, from.documentId) } }, message, from);
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
          const stored = await runStates.put(runState, from.tabId);
          // The application reached done (its confirmation page): the matches its fields still held are accepted.
          if (stored.ok && runState.status === 'done') await accepts.done(runState.applicationKey, now()).catch(() => 0);
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
          return answer;
        },
        'report/put': async (message, from) => {
          const answer = await reports.put(message, from);
          if (answer.ok) void agent.reported(from.tabId).catch(() => undefined);
          // Which of the application's written fields still hold our value, for the accepted-match cache.
          const run = answer.ok ? await runs.find(message.runId, from) : null;
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
        'job/lookup': (_message, from) => jobs.relay('lookup', from),
        'job/add': (_message, from) => jobs.relay('add', from),
        // The launcher (v3 Phase 3): its place and hiding for the sending frame's site, from the person's trusted drag
        // and click.
        // Only the top frame draws the tab (an embedded form's launcher has neither), and a person's drags and hides
        // come at a person's pace (LAUNCHER_LIMIT, per tab).
        'launcher/place': async (message, from) => {
          if (from.frameId !== 0) return refuse('bad_sender');
          const retry = launcherLimit.take(`${from.tabId}/`);
          if (retry !== null) return { ok: false, error: 'rate_limited', retryAfterSeconds: retry };
          await launchers.place(from.url, message.top);
          return ok({});
        },
        // v3 Phase 4: a Submit pressed in the frame, and the platform's confirmation after it (submissions.ts).
        'submit/armed': async (message, from) => {
          const answer = await submitted.armed(message, from);
          // v3 Phase 5: the agent's job's one Submit (agent.ts pressed).
          if (answer.ok) await agent.pressed(from.tabId, message.applicationKey, from.documentId).catch(() => undefined);
          return answer;
        },
        'submit/detected': (message, from) => submitted.detected(message, from),
        // v3 Phase 5: Sign-in mode Auto's credential, to the asking top frame alone (sign-in.ts).
        'signin/credential': (message, from) => signIn.credential(message, from),
        'launcher/hide': async (message, from) => {
          if (from.frameId !== 0) return refuse('bad_sender');
          const retry = launcherLimit.take(`${from.tabId}/`);
          if (retry !== null) return { ok: false, error: 'rate_limited', retryAfterSeconds: retry };
          if (message.scope === 'next-visit') {
            await session.set({ [visitKey(from.tabId)]: from.documentId ?? '' });
            log('launcher.hidden', { everywhere: false, visit: true });
            return ok({});
          }
          await launchers.hide(from.url, message.scope);
          return ok({});
        },
        ...(__E2E__
          ? {
              'e2e/probe': async (message: { storageLocal?: 'refused' | 'allowed'; settled?: true }, from: ContentChannel) => {
                const events = ((await session.get('e2e:events')) as unknown[] | undefined) ?? [];
                const event = message.settled === true ? { type: 'content-settled', tabId: from.tabId, frameId: from.frameId }
                  : { type: 'storage-local-probe', result: message.storageLocal };
                await session.set({ 'e2e:events': [...events, event] });
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
          const saved = await settings.save(message.settings);
          // Every frame with a form hears of it, so a run in progress reads auto-advance afresh (Phase 5 review, C-S2).
          await pushNow(saved);
          // And every side panel (v2): the custom question follows the AI drafts switch.
          reports.tellPanels('settings');
          return ok({ settings: saved });
        },
        'auth/status': async () => ok(await auth.status()),
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
        'agent/set': (message) => agent.set(message.on, message.confirmed === true),
        'agent/stop': () => agent.stop(),
        'telemetry/clear': async () => {
          await telemetry.clear();
          return ok({ counts: [] });
        },
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
      resume.accept(port, channel, () => accessReady);
      return;
    }
    if (port.name === 'panel' && channel?.kind === 'page') {
      reports.watch(port);
      return;
    }
    // v3 Phase 3b: the side panel's resume preview, an extension page's port only.
    if (port.name === 'preview' && channel?.kind === 'page') {
      resume.acceptPreview(port, previewResumeOf, () => accessReady);
      return;
    }
    log('port.refused');
    port.disconnect();
  });

  platform.runtime.onInstalled(() => {
    void restrict();
    void platform.sidePanel.openOnActionClick(true).catch(() => undefined);
  });

  // v3 Phase 5: the agent's alarm wakes the worker while Run auto-apply is on.
  platform.alarms.onAlarm((name) => {
    if (name === AGENT_ALARM) void agent.tick().catch(() => undefined);
  });

  platform.tabs.onRemoved((tabId) => {
    void agent.tabRemoved(tabId).catch(() => undefined);
    void signIn.forgetTab(tabId).catch(() => undefined);
    beginLimit.forget(`${tabId}/`);
    launcherLimit.forget(`${tabId}/`);
    void session.remove([visitKey(tabId)]).catch(() => undefined);
    reportLimit.forget(`${tabId}/`);
    policyLimit.forget(`${tabId}/`);
    shownLimit.forget(`${tabId}/`);
    askLimit.forget(`${tabId}/`);
    letterLimit.forget(`${tabId}/`);
    jobs.forgetTab(tabId);
    panelLetters.forgetTab(tabId);
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
  state.ready = accessReady.then(() => runStates.prune().catch(() => undefined));
  // v3 Phase 5: the agent picks up where it was (its job, a result still to tell, the queue).
  void state.ready.then(() => agent.start()).catch(() => undefined);
  log('worker.started');
  return state;
}
