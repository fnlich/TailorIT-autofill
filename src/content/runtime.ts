/*
 * The content script's runtime, once per document (docs/design/runtime.md §8.1, §8.10; docs/ARCHITECTURE.md "How it
 * works at run time" and "Isolation").
 * Start-up:
 * 1. The worker's messages are listened for first, then frame/hello {isTop, hasForm} goes out: the worker pings a
 *    tab's registered frames (frame/ping) when another frame says hello, and forgets one where nothing listens.
 * 2. The adapter is the registry's first whose detect() finds a form root (adaptersFor). No form root: no launcher and
 *    no run. A posting page with no form (applicationOf(...).page 'posting', as on Lever) is read for policy text and
 *    tells the worker the pattern ids (policy/hit); nothing else happens there.
 * 3. With a form root, the launcher is mounted on it (the in-page UI, ui/page-ui.ts), and runs start from its trusted
 *    clicks (counted only while a person can see it: S5) or from run/start (the side panel's Fill, to every frame with
 *    a form). One run at a time (orchestrator.ts). In a frame inside another page a run fills only while the launcher
 *    can be seen on that page (S1). Fill anyway at a policy card that a later pass of a run showed ends that run and
 *    starts a fresh one, whose gate takes the decision (fillAgain, the Phase 3 review's L-S2).
 * 4. The multi-step machine (Phase 5): with a form root, this tab's RunState for the application is read (runstate/get)
 *    and resumeMode decides. 'auto' (the same tab, within RESUME_AUTO_MS, not at review): a run starts by itself on
 *    the step it was on (trigger 'resume', RESUMED by the load), its attempts counted, so the step after two attempts
 *    goes to review with step-retry-limit and writes nothing. 'continue' (paused, at review, or older): a run reports
 *    what the RunState shows and the launcher offers Continue. 'none': nothing. On the platform's confirmation page
 *    the RunState of the application is marked done (SUBMITTED): the person submitted.
 * A run rests at review, at a pause or while it waits for the person's Next (orchestrator.ts); a run that rests and
 * watches the step is replaced by the next Fill. Fill always starts a fresh RunState; Continue starts the next run from
 * the last one's (CONTINUE after a pause, RESUMED by the person after an offer), with what it carries (RunCarry: the
 * value hasher and each step's loop books, so what the person typed meanwhile is never written over, and the CAPTCHA
 * they were handed: the Phase 5 review, C-S3 and X-S4). Cancel at a pause stops that run for good: USER_STOPPED, stored
 * and reported, and Continue has nothing left to resume (C-S6). The person's trusted input on the document is heard
 * for the document's whole life (touches.ts), so a run knows what they typed while it rested.
 * The worker's messages are answered: frame/ping {pong}; run/start; run/continue (Continue after a pause, never Fill
 * anyway: a policy card waits for the person's own decision); run/cancel (stops a run, a policy card's wait included,
 * a run that waits for the next step, or a paused one); settings/changed (the person saved their settings: the
 * current run reads auto-advance from them, C-S2); run/policyDecision (the side panel's policy card, addressed to this frame: Fill anyway or Cancel,
 * answered `expired` when no run here waits at the card); field/focus (scroll the field or its proxy into view and
 * outline it, at the person's request); field/describe (the visible labels of a row's suggested options, from a fresh
 * scan, never kept); draft/confirm (Phase 6: the run's waiting draft of that field is the person's now; `expired` when
 * none waits); answer/read (Phase 6: the field's answer as it holds it now, for Save my answer, straight to the worker
 * and never kept; `expired` when the field is gone); report/update (the tab's combined report, for the in-page panel).
 * The in-page card's own buttons decide locally, on trusted clicks.
 * The person's trusted input reaches the current run as it comes (TouchLog.subscribe), so a resting run marks what they
 * edited (Phase 6).
 * The in-page panel (Phase 6, ui/panel.tsx): with settings.panel 'in-page' (frame/hello's answer, then each
 * settings/changed), the launcher's Open review opens it in this frame and tells the worker (panel/shown {open: true}),
 * which then sends this frame alone the tab's report (report/update) while it is open; its Close button, or the person
 * choosing the side panel, closes it (panel/shown {open: false}). A frame too small for it (an embedded one under
 * ui/page-ui.ts PANEL_MIN_VIEWPORT) opens the side panel instead, as the side panel placement does. Its Show on page
 * and closest options act on this frame's own fields, as field/focus and field/describe do; its Confirm draft confirms
 * the run's draft here, and its Save my answer asks the worker (answer/save), which reads the answer back with
 * answer/read and sends it to TailorIT (Phase 6, wave 2). Each says what came of it.
 * Only this extension's own messages from outside any tab (the worker) are taken.
 *
 * WXT's content-script context is never used (a page can reach it): no context timers, listeners, onInvalidated or
 * wxt:locationchange. The runtime owns its lifetime (one AbortController), reads address changes from location.href
 * (location.ts), and logs forged WXT events without letting them change anything (forged.ts). It ends only on the
 * platform's word that the extension is gone (isValid(), or a send that fails as context-invalidated), or when the
 * document is going away (a trusted pagehide that does not keep the page in the back/forward cache). Then the run is
 * aborted, its planned writes dropped and the UI removed. A page the cache keeps only drops its run, and when the
 * browser brings it back (a trusted pageshow with persisted set) it says frame/hello again (W1).
 * An address that is no application (applicationOf null: a host off the list, or a Lever or Greenhouse address its
 * parser does not read, W2) gets no launcher and no run, as a page with no form root does.
 */
import { adaptersFor, applicationOf, type ApplicationRef } from '../adapters';
import type { Adapter } from '../adapters/types';
import { reduceRun, resumeMode, type RunEvent } from '../core/steps/machine';
import type { FieldKey } from '../core/types/field';
import type { FillResult } from '../core/types/fill';
import type { RunState } from '../core/types/run';
import { scan } from '../dom/scan';
import type { ScanResult } from '../dom/types';
import { ok, refuse } from '../messaging/envelope';
import { WorkerToContentSchema, type PolicyDecision } from '../messaging/schemas';
import { probeStorageLocalFromContent } from '../platform/chrome';
import type { ContentPlatform, Sender } from '../platform/types';
import { COPY } from '../shared/copy';
import { log } from '../shared/log';
import { createChannel, Invalidated } from './channel';
import { watchWxtEvents } from './forged';
import { watchLocation } from './location';
import { FillRun, RunFailure, type RunEnd, type RunOptions, type RunPage, type RunRequest } from './orchestrator';
import { readPostingPage } from './policy';
import { createReportLimiter } from './report';
import { elementsOf } from './targets';
import { TouchLog } from './touches';
import { mountPageUi, type PageUi } from './ui/page-ui';

/** How the runtime is set up; every part defaults to the real one. */
export interface RuntimeOptions extends RunOptions {
  /** The frame's address (location.href). Tests serve fixtures from srcdoc frames, whose address is about:srcdoc. */
  href?: () => string;
  /** The adapters that may handle an address (the registry's adaptersFor). */
  adapters?: (url: URL) => Adapter[];
  /** Whether this frame is the top one (read from its window by default). */
  isTop?: boolean;
}

/** The running content script, as tests drive it. */
export interface ContentRuntime {
  readonly ui: PageUi | null;
  /** The current run, or the last one. */
  readonly run: FillRun | null;
  readonly page: RunPage | null;
  /** The frame id the worker gave in its answer to frame/hello (null until then). */
  readonly frameId: number | null;
  /** Starts a run as a trusted launcher click would (a test cannot make one); null when none may start now. */
  fill(request?: Partial<RunRequest>): Promise<RunEnd> | null;
  readonly stopped: boolean;
  stop(): void;
}

/** The first adapter whose detect() finds a form root, with that root. */
function pickAdapter(doc: Document, url: URL, adapters: (url: URL) => Adapter[]): { adapter: Adapter; root: Element } | null {
  for (const adapter of adapters(url)) {
    try {
      const found = adapter.detect(doc);
      if (found !== null) return { adapter, root: found.formRoot };
    } catch {
      // An adapter that fails on this page gives way to the next.
    }
  }
  return null;
}

/** Whether a pageshow is the browser bringing this document back from the back/forward cache: its own (trusted)
 *  event, with persisted set. A page's dispatched pageshow is untrusted and changes nothing. */
export function restoredFromCache(event: Pick<PageTransitionEvent, 'isTrusted' | 'persisted'>): boolean {
  return event.isTrusted && event.persisted;
}

/** What resumes a run the person continues: CONTINUE from a pause, RESUMED by the person from an offer. */
function continueEventOf(state: RunState): RunEvent {
  return state.status === 'auth-needed' || state.status === 'handoff' ? { type: 'CONTINUE' }
    : { type: 'RESUMED', by: 'person', sameTab: true };
}

/** The address as a URL, or null. */
function urlOf(href: string): URL | null {
  try {
    return new URL(href);
  } catch {
    return null;
  }
}

/** Starts the content runtime in `doc`. Resolves once the frame has said hello and its UI is mounted. */
export async function startContentRuntime(platform: ContentPlatform, doc: Document, options: RuntimeOptions = {}):
  Promise<ContentRuntime> {
  log('content.started');
  const view = doc.defaultView;
  const lifetime = new AbortController();
  const readHref = options.href ?? (() => doc.location.href);
  const adapters = options.adapters ?? adaptersFor;
  const isTop = options.isTop ?? (view !== null && view.top === view);
  let stopped = false;
  let ui: PageUi | null = null;
  let page: RunPage | null = null;
  let app: ApplicationRef | null = null;
  let current: FillRun | null = null;
  let frameId: number | null = null;
  /** The hasForm the worker was last told. */
  let told: boolean | null = null;
  /** Where the person wants the review: frame/hello's settings, then each settings/changed. */
  let placement: 'side' | 'in-page' = 'side';
  let lastRows = new Map<FieldKey, FillResult>();

  const channel = createChannel(platform, () => teardown('invalidated'));
  const limiter = createReportLimiter();
  /** The person's trusted input on this document, for its whole life (touches.ts); the current run hears it as it
   *  comes, so a resting run marks what the person edited (Phase 6). */
  const touches = new TouchLog(doc, lifetime.signal);
  touches.subscribe((type, path) => current?.personInput(type, path));

  function teardown(reason: 'invalidated' | 'leaving'): void {
    if (stopped) return;
    stopped = true;
    if (reason === 'invalidated') log('content.context-invalidated');
    current?.abort();
    lifetime.abort();
    ui?.destroy();
    ui = null;
  }

  // ── The worker's messages: listened for before frame/hello goes out ─────────────────────────────────────────────
  platform.runtime.onMessage(async (message: unknown, sender: Sender) => {
    if (sender.id === undefined || sender.id !== platform.runtime.id || sender.tabId !== undefined) {
      return refuse('bad_sender');
    }
    const parsed = WorkerToContentSchema.safeParse(message);
    if (!parsed.success) return refuse('bad_message');
    const msg = parsed.data;
    switch (msg.type) {
      case 'frame/ping':
        return ok({ pong: true as const });
      case 'run/start':
        startRun({ trigger: 'panel', dryRun: msg.dryRun });
        return ok({});
      case 'run/continue':
        continueRun('panel');
        return ok({});
      case 'run/cancel':
        cancelRun();
        return ok({});
      case 'settings/changed':
        current?.settingsChanged(msg.settings);
        placementChanged(msg.settings.panel);
        return ok({});
      case 'run/policyDecision':
        return decidePolicy(msg.decision) ? ok({}) : refuse('expired');
      case 'field/focus':
        focusField(msg.fieldKey as FieldKey);
        return ok({});
      case 'field/describe':
        return ok(describeField(msg.fieldKey as FieldKey));
      case 'draft/confirm':
        return current?.confirmDraft(msg.fieldKey as FieldKey) === true ? ok({}) : refuse('expired');
      case 'answer/read': {
        const read = stopped || page === null ? null : current?.readAnswer(msg.fieldKey as FieldKey) ?? null;
        return read === null ? refuse('expired') : ok(read);
      }
      case 'report/update':
        // The worker sends it only to the frame whose panel/shown said open; a closed panel keeps nothing.
        if (ui?.panel?.open === true) ui.updatePanel(msg.reports);
        return ok({});
    }
  });

  // ── Runs ────────────────────────────────────────────────────────────────────────────────────────────────────────
  async function hello(): Promise<void> {
    const hasForm = page !== null;
    const answer = await channel.request({ v: 1, type: 'frame/hello', isTop, hasForm });
    if (!answer.ok) return;
    told = hasForm;
    frameId = answer.data.frameId;
    placementChanged(answer.data.settings.panel);
  }

  // ── The in-page panel (Phase 6) ─────────────────────────────────────────────────────────────────────────────────

  /** The person's choice of panel: choosing the side panel closes this frame's in-page one. */
  function placementChanged(next: 'side' | 'in-page'): void {
    placement = next;
    if (next === 'side' && ui?.panel?.open === true) closePanel();
  }

  /** Open review from the launcher's click: the in-page panel where the person chose it and the frame has room for it,
   *  else the side panel, which must be asked for inside the click (nothing awaited before it). */
  function openReview(): void {
    if (placement === 'in-page' && ui !== null && ui.openPanel()) {
      channel.fire({ v: 1, type: 'panel/shown', open: true });
      return;
    }
    if (placement === 'in-page') log('content.panel-collapsed');
    channel.fire({ v: 1, type: 'panel/open' });
  }

  /** The in-page panel's Save my answer: the worker reads the answer back (answer/read) and sends it to TailorIT.
   *  Answers what came of it, in the panel's words. */
  async function saveFromPanel(key: FieldKey): Promise<string> {
    try {
      const answer = await channel.request({ v: 1, type: 'answer/save', fieldKey: key });
      return answer.ok ? COPY.panel.saveOutcomes[answer.data.outcome] : COPY.panel.saveFailed;
    } catch {
      return COPY.panel.saveFailed;
    }
  }

  /** Closes the in-page panel, and tells the worker to stop sending it reports. */
  function closePanel(): void {
    if (ui?.panel?.open !== true) return;
    ui.closePanel();
    if (channel.valid()) channel.fire({ v: 1, type: 'panel/shown', open: false });
  }

  /** The frame's id, saying hello again first if the first one went unanswered. */
  async function ensureFrame(): Promise<{ frameId: number; isTop: boolean }> {
    if (frameId === null) await hello();
    if (frameId === null) throw new RunFailure('unavailable');
    return { frameId, isTop };
  }

  function startRun(request: RunRequest): FillRun | null {
    if (stopped || page === null || !channel.valid()) return null;
    if (current !== null && current.ended === null) return null;
    // A run that rests and watches the step (review, or the person's Next) gives way to the new one.
    if (current?.watching === true) current.abort();
    const run = new FillRun({
      doc,
      content: platform,
      channel,
      limiter,
      ui: () => ui,
      frame: ensureFrame,
      // Without its launcher (the UI failed, or the page removed it for good) a frame cannot show it is seen: it fills
      // nothing inside another page.
      frameShown: (signal, fresh) => (ui === null ? Promise.resolve(false) : ui.launcherShown(signal, fresh)),
      page,
      now: () => platform.now(),
      options,
      onRows(rows) {
        lastRows = new Map(rows.map((row) => [row.key, row]));
      },
      // Fill anyway at a policy card a later pass showed: a fresh run, on this run's own ended state (L-S2).
      fillAgain(next) {
        if (current === run) startRun(next);
      },
      touches,
    }, request);
    current = run;
    lastRows = new Map();
    void run.start();
    return run;
  }

  /** run/continue, or the launcher's Continue: a fresh run after a pause. It never answers the policy card: Continue
   *  goes to every frame that reported, and one waiting at the card must not fill as if Fill anyway was chosen. */
  function continueRun(trigger: RunRequest['trigger']): void {
    if (current === null || current.ended !== 'paused') return;
    const state = current.runState;
    const carry = current.carryOut(true);
    startRun(state === null ? { trigger, dryRun: false, carry }
      : { trigger, dryRun: false, from: { state, event: continueEventOf(state) }, carry });
  }

  /** run/policyDecision: the side panel's policy card, for this frame. Answers whether a run here waited at the card. */
  function decidePolicy(decision: PolicyDecision): boolean {
    if (current === null || !current.atPolicyCard) return false;
    return decision === 'fill' ? current.accept() : current.decline();
  }

  /** run/cancel: Cancel at the policy card, stop a run that writes, or stop a paused one for good (C-S6). */
  function cancelRun(): void {
    if (current === null) return;
    if (current.ended === null || current.watching) {
      current.stop();
      return;
    }
    if (current.ended === 'paused') {
      const run = current;
      current = null;
      void run.cancelPause();
    }
  }

  /** A fresh scan of the page, with what the last run read of its widgets (their keys carry the read options' hash). */
  function scanPage(on: RunPage): ScanResult {
    return scan(on.root, on.adapter, { platform: on.app.platform, frameId: frameId ?? 0,
      ...(current === null ? {} : { widgetReadings: current.widgetReadings }) });
  }

  /** field/focus: the field, or its proxy, scrolled into view and outlined (the person asked). */
  function focusField(key: FieldKey): void {
    if (stopped || page === null) return;
    const target = scanPage(page).target(key);
    if (target === null) return;
    const elements = elementsOf(target);
    elements[0]?.scrollIntoView({ block: 'center', inline: 'nearest' });
    ui?.showFocus(elements);
  }

  /** field/describe: the visible labels of the row's suggested options, read from a fresh scan. Never kept. */
  function describeField(key: FieldKey): { options: Array<{ index: number; label: string }> } {
    const indices = (lastRows.get(key)?.detail?.suggestions ?? []).map((suggestion) => suggestion.index).slice(0, 3);
    if (stopped || page === null || indices.length === 0) return { options: [] };
    const field = scanPage(page).fields.find((candidate) => candidate.key === key);
    if (field === undefined || field.options === 'lazy') return { options: [] };
    const options = field.options;
    return { options: indices.flatMap((index) => {
      const option = options.find((candidate) => candidate.index === index);
      return option === undefined ? [] : [{ index, label: option.label }];
    }) };
  }

  // ── RunState after a reload (Phase 5) ───────────────────────────────────────────────────────────────────────────

  /** This tab's RunState for the application, or null (none, expired, another tab's, or the worker refused). */
  async function storedRunState(applicationKey: string): Promise<RunState | null> {
    const answer = await channel.request({ v: 1, type: 'runstate/get', applicationKey });
    // The schema's strings are the core's branded keys (messaging/schemas.check.ts proves the shapes equal).
    return answer.ok ? answer.data.runState as unknown as RunState | null : null;
  }

  /** At start-up: a run resumes by itself, or reports and offers Continue, as resumeMode says (module header, 4). */
  async function resumeStored(): Promise<void> {
    if (page === null || app === null) return;
    const state = await storedRunState(app.applicationKey);
    if (state === null || stopped || current !== null) return;
    const mode = resumeMode(state, { now: platform.now(), sameTab: true });
    log('content.run-resumed', { auto: mode === 'auto', offered: mode === 'continue' });
    if (mode === 'none') return;
    startRun({ trigger: 'resume', dryRun: false, from: { state, event: { type: 'RESUMED', by: 'load', sameTab: true } } });
  }

  /** The platform's page after submitting: the application's RunState is done (the person submitted). */
  async function markSubmitted(): Promise<void> {
    if (app?.page !== 'confirmation') return;
    const state = await storedRunState(app.applicationKey);
    if (state === null) return;
    const next = reduceRun(state, { type: 'SUBMITTED' }, { autoAdvance: false, now: platform.now() });
    if (next.state === state) return;
    await channel.request({ v: 1, type: 'runstate/put', runState: next.state });
  }

  // ── The page: which application, adapter and form root ──────────────────────────────────────────────────────────
  function resolvePage(href: string): void {
    const url = urlOf(href);
    app = url === null ? null : applicationOf(url);
    const picked = url !== null && app !== null && app.page === 'application' ? pickAdapter(doc, url, adapters) : null;
    page = picked === null || app === null ? null : { app, adapter: picked.adapter, root: picked.root };
  }

  function mountUi(): void {
    if (ui !== null || page === null) {
      ui?.anchorTo(page?.root ?? null);
      return;
    }
    try {
      ui = mountPageUi(doc, {
        onLauncher(action) {
          if (!channel.valid()) return;
          // Open review goes out at once, inside the click: the browser then still counts it as the person's gesture.
          if (action === 'open-review') openReview();
          else if (action === 'continue') continueRun('launcher');
          else startRun({ trigger: 'launcher', dryRun: false });
        },
        onPolicyChoice(choice) {
          if (choice === 'accepted') current?.accept();
          else current?.decline();
        },
        panel: {
          frameId: () => frameId,
          showField: (key) => focusField(key as FieldKey),
          describeField: async (key) => describeField(key as FieldKey).options,
          // Phase 6, wave 2: this frame's draft, confirmed here; its answer, saved through the worker.
          confirmDraft: async (key) => (current?.confirmDraft(key as FieldKey) === true ? COPY.panel.draftConfirmed
            : COPY.panel.confirmFailed),
          saveAnswer: async (key) => saveFromPanel(key as FieldKey),
          closed: () => closePanel(),
        },
      });
      ui.anchorTo(page.root);
      ui.setLauncher({ state: 'idle', action: 'fill' });
    } catch {
      // Without its UI the top frame still fills from the side panel's Fill; a frame inside another page cannot show
      // its launcher is seen there, so it fills nothing (FillRun's frame check, S1).
      ui = null;
    }
  }

  async function readPosting(): Promise<void> {
    if (app?.page !== 'posting') return;
    try {
      await readPostingPage(channel, doc, app.applicationKey);
    } catch (failure) {
      if (!(failure instanceof Invalidated)) throw failure;
    }
  }

  /** A new address (a single-page application's route): the same application keeps its run; another one ends it. */
  function onAddress(href: string): void {
    if (stopped) return;
    const before = app?.applicationKey ?? null;
    resolvePage(href);
    if ((app?.applicationKey ?? null) !== before) {
      current?.abort();
      current = null;
      lastRows = new Map();
      ui?.setHighlights([]);
      ui?.setNotices([]);
      ui?.hidePolicyCard();
      ui?.setLauncher({ state: 'idle', action: 'fill' });
    }
    if (page === null) ui?.anchorTo(null);
    else mountUi();
    if (told !== (page !== null)) void hello().catch(() => undefined);
    void readPosting().catch(() => undefined);
  }

  function handle(): ContentRuntime {
    return {
      get ui() {
        return ui;
      },
      get run() {
        return current;
      },
      get page() {
        return page;
      },
      get frameId() {
        return frameId;
      },
      fill: (request = {}) => startRun({ trigger: request.trigger ?? 'launcher', dryRun: request.dryRun ?? false })
        ?.start() ?? null,
      get stopped() {
        return stopped;
      },
      stop: () => teardown('leaving'),
    };
  }

  // ── Start-up ────────────────────────────────────────────────────────────────────────────────────────────────────
  watchWxtEvents(doc, platform.runtime.id, (kind) => {
    // The real started event of a newer instance comes only once the extension was reloaded, when the platform says
    // it is gone (channel.valid() then tears down). Anything else is a page's forgery: logged, changing nothing.
    if (kind === 'started' && !channel.valid()) return;
    log('content.forged-wxt-event', kind === 'started' ? { started: true } : { locationChange: true });
  }, lifetime.signal);
  view?.addEventListener('pagehide', (event) => {
    if (!event.isTrusted) return;
    if (!event.persisted) {
      teardown('leaving');
      return;
    }
    // The page may come back from the back/forward cache: the run is dropped, the launcher offers Fill again.
    if (current !== null && (current.ended === null || current.watching)) {
      current.abort();
      ui?.hidePolicyCard();
      ui?.setLauncher({ state: 'idle', action: 'fill' });
    }
  }, { signal: lifetime.signal });
  // Back from the back/forward cache: the worker forgot this document's frame while it was away (its sweep drops a
  // frame that does not answer), so it says hello again, and the side panel's messages reach this document (W1).
  view?.addEventListener('pageshow', (event) => {
    if (stopped || !restoredFromCache(event)) return;
    void hello().catch(() => undefined);
  }, { signal: lifetime.signal });

  resolvePage(readHref());
  try {
    await hello();
    if (__E2E__) {
      const storageLocal = await probeStorageLocalFromContent();
      await platform.runtime.send({ v: 1, type: 'e2e/probe', storageLocal }).catch(() => undefined);
    }
    if (!stopped) {
      mountUi();
      await readPosting();
      if (view !== null) watchLocation(view, readHref, onAddress, lifetime.signal);
      await resumeStored();
      await markSubmitted();
    }
  } catch (failure) {
    if (!(failure instanceof Invalidated)) throw failure;
  }
  return handle();
}
