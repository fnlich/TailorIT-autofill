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
import { createAuth, createTokenKeeper } from './auth';
import { createAiTasks } from './ai-tasks';
import { ASK_LIMIT, createAsk } from './ask';
import { createPanelLetters, LETTER_LIMIT } from './cover-letters';
import { createAnswerHandlers } from './row-actions';
import type { CoreFunctions } from './core';
import { createFrameSweep, forgetFrames, forgetTab as forgetTabFrames, frameEntry, navOf, registerFrame } from './frames';
import { createJobCards, JOB_RELAY_LIMIT, type JobCards } from './job-cards';
import { createKeyedQueue, createRateLimit } from './locks';
import { createAcceptBook, createMatchCache } from './match-cache';
import { createPanelHandlers, openSidePanel } from './panel';
import { createPlanner } from './planner';
import { createPolicyBook, POLICY_HIT_LIMIT } from './policy';
import { createProfileCache, type ProfileCache } from './profile-cache';
import { createReports, PANEL_SHOWN_LIMIT, REPORT_PUT_LIMIT, type Reports } from './reports';
import { fillsFromProfileOnly, saysNoAi } from '../shared/report';
import { createResumeChooser } from './resume-choice';
import { createResumeTransfer } from './resume-transfer';
import { createRouter, type ContentChannel } from './router';
import { beginRun, keyFitsFrame, RUN_BEGIN_LIMIT } from './run-begin';
import { createRunRegistry, type RunRegistry } from './runs';
import { createRunStateStore } from './runstate-store';
import { channelOf, isConnectPage } from './senders';
import { createServerClient } from './server-client';
import { createSettingsStore, pushSettings } from './settings';
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
}

/** The real core. */
const CORE: CoreFunctions = { planFrame, canonicalizeProfile, attachResume, persistableCanaries, policyHits, vocab: bundledVocab };

/** Content messages that skip the access-level wait. */
const UNGATED: ReadonlySet<string> = new Set(['ping', 'panel/open']);

export function startWorker(options: WorkerOptions = {}): WorkerState {
  const platform = options.platform ?? createWorkerPlatform();
  const core = options.core ?? CORE;
  const timers = options.timers ?? systemTimers;
  const origin = options.origin ?? __TAILORIT_ORIGIN__;
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
  const keeper = createTokenKeeper(platform, () => {
    profiles?.drop();
    runRegistry?.dropTokenData();
    jobCards?.dropTokenData();
    letterRows?.dropTokenData();
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
    check: (tabId) => checkTab(tabId) });
  panelReports = reports;
  // The side panel's job card and custom question (v2): read through the tab's form frame, kept in memory only.
  const jobs = createJobCards({ session, tabs: platform.tabs, server, connected: () => auth.connected(),
    generation: () => keeper.generation, now, limit: relayLimit });
  jobCards = jobs;
  // One chooser for the planner and the resume port: it follows the token and the tab's resume choice (v2: a Change
  // mid-run applies to every file not uploaded yet).
  const chooseResume = createResumeChooser({ runs, server, profiles: profileCache, generation: () => keeper.generation,
    chosen: (tabId) => jobs.chosen(tabId) });
  // The LLM steps' tasks on TailorIT (Phase 4), shared by every run; each run keeps its own questions (ai-tasks.ts).
  const aiTasks = createAiTasks({ server, timers, now });
  // The accepted-match cache (Phase 6): storage.session, in memory; a match goes in once the field was unchanged at the
  // run's done (match-cache.ts).
  const matchCache = createMatchCache(session);
  const accepts = createAcceptBook(matchCache);
  // Cover letters (Phase G): a run asks TailorIT for its letter once (cover-letters.ts), and the resume port sends it.
  const letters = { server, timers, now };
  const planner = createPlanner({ runs, profiles: profileCache, settings, core, chooseResume, ai: aiTasks,
    aiTaskIds: runStates, cache: matchCache, accepts, letters, now });
  const resume = createResumeTransfer({ runs, server, profiles: profileCache, timers, sha256: (bytes) => platform.sha256(bytes),
    choose: chooseResume });
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
    profileOnlyHeld: async (tabId) => (await reports.ofTab(tabId)).some(fillsFromProfileOnly) });
  letterRows = panelLetters;
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
    await Promise.all([reports.forgetDocument(tabId, frameId, documentId), runs.forgetDocument(tabId, frameId, documentId)]);
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

  // ── Listeners, registered synchronously ─────────────────────────────────────────────────────────────────────────
  platform.runtime.onMessage(
    createRouter({
      ownId,
      ownPagesPrefix,
      contentGate: { ready: () => accessReady, except: UNGATED },
      content: {
        ping: async () => ok({ pong: true as const }),
        'frame/hello': async (message, from) => {
          const { previous, entry } = await lockTab(from.tabId, async () => ({
            previous: await frameEntry(session, from.tabId, from.frameId),
            entry: await registerFrame(session, { ...from, isTop: message.isTop, hasForm: message.hasForm, nav: message.nav },
              now()),
          }));
          const newDocument = previous === null || previous.documentId !== entry.documentId;
          // The document it left goes; anything this document began before its hello stays.
          if (previous !== null && newDocument) await forgetDocument(from.tabId, from.frameId, previous.documentId);
          // A single-page application moved the frame to another address in the same document (v2): its job card is
          // another posting's now, so it goes and is read again; the document's run and report stay (the content
          // script ends a run whose application changed).
          if (previous !== null && !newDocument && navOf(previous) !== navOf(entry)) {
            jobs.forgetDocument(from.tabId, from.frameId, entry.documentId);
          }
          // A document the registry has not seen may mean others went (a top frame's new page takes its subframes).
          // The sweep asks them in the background, so the hello is answered at once.
          if (newDocument) void sweepTab(from.tabId, from.frameId).catch(() => undefined);
          // The side panel's strip and card follow what the tab holds now (v2).
          void reports.pageChanged(from.tabId).catch(() => undefined);
          log('frame.registered', { frameId: entry.frameId, top: entry.isTop });
          return ok({ frameId: from.frameId, connected: await auth.connected(), settings: await settings.content() });
        },
        'run/begin': (message, from) => beginRun(beginDeps, message, from),
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
        'report/put': async (message, from) => {
          const answer = await reports.put(message, from);
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
        ...(__E2E__
          ? {
              'e2e/probe': async (message: { storageLocal: 'refused' | 'allowed' }) => {
                const events = ((await session.get('e2e:events')) as unknown[] | undefined) ?? [];
                await session.set({ 'e2e:events': [...events, { type: 'storage-local-probe', result: message.storageLocal }] });
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
        'settings/get': async () => ok({ settings: await settings.get() }),
        'settings/save': async (message) => {
          const saved = await settings.save(message.settings);
          // Every frame with a form hears of it, so a run in progress reads auto-advance afresh (Phase 5 review, C-S2).
          await pushSettings({ session, tabs: platform.tabs }, saved);
          // And every side panel (v2): the custom question follows the AI drafts switch.
          reports.tellPanels('settings');
          return ok({ settings: saved });
        },
        'auth/status': async () => ok(await auth.status()),
        'auth/startPairing': () => auth.startPairing(),
        'auth/redeemCode': (message) => auth.redeemCode(message.code),
        'auth/disconnect': () => auth.disconnect(),
        'runs/clear': async () => ok({ cleared: await runStates.clearAll() }),
        'telemetry/get': async () => ok({ counts: await telemetry.read() }),
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
    log('port.refused');
    port.disconnect();
  });

  platform.runtime.onInstalled(() => {
    void restrict();
    void platform.sidePanel.openOnActionClick(true).catch(() => undefined);
  });

  platform.tabs.onRemoved((tabId) => {
    beginLimit.forget(`${tabId}/`);
    reportLimit.forget(`${tabId}/`);
    policyLimit.forget(`${tabId}/`);
    shownLimit.forget(`${tabId}/`);
    askLimit.forget(`${tabId}/`);
    letterLimit.forget(`${tabId}/`);
    jobs.forgetTab(tabId);
    panelLetters.forgetTab(tabId);
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
  log('worker.started');
  return state;
}
