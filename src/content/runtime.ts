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
 *    clicks or from run/start (the side panel's Fill, to every frame with a form). One run at a time (orchestrator.ts).
 * The worker's messages are answered: frame/ping {pong}; run/start; run/continue (Continue after a pause, never Fill
 * anyway: a policy card waits for the person's own decision); run/cancel (stops a run, a policy card's wait included,
 * or leaves a pause); run/policyDecision (the side panel's policy card, addressed to this frame: Fill anyway or Cancel,
 * answered `expired` when no run here waits at the card); field/focus (scroll the field or its proxy into view and
 * outline it, at the person's request); field/describe (the visible labels of a row's suggested options, from a fresh
 * scan, never kept); draft/confirm and answer/read not_implemented until Phase 6; report/update ignored until the
 * in-page panel exists. The in-page card's own buttons decide locally, on trusted clicks.
 * Only this extension's own messages from outside any tab (the worker) are taken.
 *
 * WXT's content-script context is never used (a page can reach it): no context timers, listeners, onInvalidated or
 * wxt:locationchange. The runtime owns its lifetime (one AbortController), reads address changes from location.href
 * (location.ts), and logs forged WXT events without letting them change anything (forged.ts). It ends only on the
 * platform's word that the extension is gone (isValid(), or a send that fails as context-invalidated), or when the
 * document is going away (a trusted pagehide that does not keep the page in the back/forward cache). Then the run is
 * aborted, its planned writes dropped and the UI removed.
 */
import { adaptersFor, applicationOf, type ApplicationRef } from '../adapters';
import type { Adapter } from '../adapters/types';
import type { FieldKey } from '../core/types/field';
import type { FillResult } from '../core/types/fill';
import { scan } from '../dom/scan';
import { ok, refuse } from '../messaging/envelope';
import { WorkerToContentSchema, type PolicyDecision } from '../messaging/schemas';
import { probeStorageLocalFromContent } from '../platform/chrome';
import type { ContentPlatform, Sender } from '../platform/types';
import { log } from '../shared/log';
import { createChannel, Invalidated } from './channel';
import { watchWxtEvents } from './forged';
import { watchLocation } from './location';
import { FillRun, RunFailure, type RunEnd, type RunOptions, type RunPage, type RunRequest } from './orchestrator';
import { readPostingPage } from './policy';
import { createReportLimiter } from './report';
import { elementsOf } from './targets';
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
  let lastRows = new Map<FieldKey, FillResult>();

  const channel = createChannel(platform, () => teardown('invalidated'));
  const limiter = createReportLimiter();

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
      case 'run/policyDecision':
        return decidePolicy(msg.decision) ? ok({}) : refuse('expired');
      case 'field/focus':
        focusField(msg.fieldKey as FieldKey);
        return ok({});
      case 'field/describe':
        return ok(describeField(msg.fieldKey as FieldKey));
      case 'draft/confirm':
      case 'answer/read':
        return refuse('not_implemented');
      case 'report/update':
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
    const run = new FillRun({
      doc,
      content: platform,
      channel,
      limiter,
      ui: () => ui,
      frame: ensureFrame,
      page,
      now: () => platform.now(),
      options,
      onRows(rows) {
        lastRows = new Map(rows.map((row) => [row.key, row]));
      },
    }, request);
    current = run;
    lastRows = new Map();
    void run.start();
    return run;
  }

  /** run/continue, or the launcher's Continue: a fresh run after a pause. It never answers the policy card: Continue
   *  goes to every frame that reported, and one waiting at the card must not fill as if Fill anyway was chosen. */
  function continueRun(trigger: RunRequest['trigger']): void {
    if (current === null) return;
    if (current.ended === 'paused') startRun({ trigger, dryRun: false });
  }

  /** run/policyDecision: the side panel's policy card, for this frame. Answers whether a run here waited at the card. */
  function decidePolicy(decision: PolicyDecision): boolean {
    if (current === null || !current.atPolicyCard) return false;
    return decision === 'fill' ? current.accept() : current.decline();
  }

  /** run/cancel: Cancel at the policy card, stop a run that writes, or leave a pause. */
  function cancelRun(): void {
    if (current === null) return;
    if (current.ended === null) {
      current.stop();
      return;
    }
    if (current.ended === 'paused') ui?.setLauncher({ state: 'idle', action: 'fill' });
  }

  /** field/focus: the field, or its proxy, scrolled into view and outlined (the person asked). */
  function focusField(key: FieldKey): void {
    if (stopped || page === null) return;
    const target = scan(page.root, page.adapter, { platform: page.app.platform, frameId: frameId ?? 0 }).target(key);
    if (target === null) return;
    const elements = elementsOf(target);
    elements[0]?.scrollIntoView({ block: 'center', inline: 'nearest' });
    ui?.showFocus(elements);
  }

  /** field/describe: the visible labels of the row's suggested options, read from a fresh scan. Never kept. */
  function describeField(key: FieldKey): { options: Array<{ index: number; label: string }> } {
    const indices = (lastRows.get(key)?.detail?.suggestions ?? []).map((suggestion) => suggestion.index).slice(0, 3);
    if (stopped || page === null || indices.length === 0) return { options: [] };
    const field = scan(page.root, page.adapter, { platform: page.app.platform, frameId: frameId ?? 0 }).fields
      .find((candidate) => candidate.key === key);
    if (field === undefined || field.options === 'lazy') return { options: [] };
    const options = field.options;
    return { options: indices.flatMap((index) => {
      const option = options.find((candidate) => candidate.index === index);
      return option === undefined ? [] : [{ index, label: option.label }];
    }) };
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
          if (action === 'open-review') channel.fire({ v: 1, type: 'panel/open' });
          else if (action === 'continue') continueRun('launcher');
          else startRun({ trigger: 'launcher', dryRun: false });
        },
        onPolicyChoice(choice) {
          if (choice === 'accepted') current?.accept();
          else current?.decline();
        },
      });
      ui.anchorTo(page.root);
      ui.setLauncher({ state: 'idle', action: 'fill' });
    } catch {
      // Without its UI the frame still fills from the side panel's Fill.
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
    if (current !== null && current.ended === null) {
      current.abort();
      ui?.hidePolicyCard();
      ui?.setLauncher({ state: 'idle', action: 'fill' });
    }
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
    }
  } catch (failure) {
    if (!(failure instanceof Invalidated)) throw failure;
  }
  return handle();
}
