/*
 * The content script's runtime, once per document (docs/design/runtime.md §8.1, §8.10; docs/ARCHITECTURE.md "How it
 * works at run time" and "Isolation").
 * Start-up:
 * 1. The worker's messages are listened for first, then frame/hello {isTop, hasForm} goes out: the worker pings a
 *    tab's registered frames (frame/ping) when another frame says hello, and forgets one where nothing listens.
 * 2. The adapter is the registry's first whose detect() finds a form root (adaptersFor). No form root: no launcher and
 *    no run, unless an adapter of the address says its page draws the form late (quirks.formLateMs: Ashby's React
 *    draws it seconds after the page loads, and after its Application tab changes the address): the document is then
 *    watched for it until that wait is over (late-form.ts), only the adapters that say so may claim it meanwhile (the
 *    generic one only after it), and once found the launcher is mounted, the worker told (frame/hello) and a stored
 *    run resumed, as at start-up. A posting page with no form (applicationOf(...).page 'posting', as on Lever) is read
 *    for policy text and tells the worker the pattern ids (policy/hit); nothing else happens there. Where an adapter
 *    names the posting's own text (Adapter.postingText: Ashby's overview, drawn late too), that is read, once drawn.
 * 3. With a form root, the launcher is mounted on it (the in-page UI, ui/page-ui.ts), and runs start from its trusted
 *    clicks (counted only while a person can see it: S5) or from run/start (the side panel's Fill, to every frame with
 *    a form). One run at a time (orchestrator.ts). In a frame inside another page a run fills only while the launcher
 *    can be seen on that page (S1). A form root the page replaces (it drew its whole form again, Twitch's way) is found
 *    again by the adapter's hook (pageNow; a run tells of one it found, rootMoved), and the launcher moves to it. Fill
 *    anyway at a policy card that a later pass of a run showed ends that run and starts a fresh one, whose gate takes
 *    the decision (fillAgain, the Phase 3 review's L-S2).
 * 4. The multi-step machine (Phase 5): with a form root, this tab's RunState for the application is read (runstate/get)
 *    and resumeMode decides. 'auto' (the same tab, within RESUME_AUTO_MS, not at review): a run starts by itself on
 *    the step it was on (trigger 'resume', RESUMED by the load), its attempts counted, so the step after two attempts
 *    goes to review with step-retry-limit and writes nothing. 'continue' (paused, at review, or older): a run reports
 *    what the RunState shows and the launcher offers Continue. 'none': nothing. On the platform's confirmation page
 *    the RunState of the application is marked done (SUBMITTED), once the worker took it as the sign of a Submit this
 *    tab armed (v3 Phase 4, below).
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
 * focus it, at the person's request: Show on page draws nothing); field/describe (the visible labels of a row's suggested options, from a fresh
 * scan, never kept); draft/confirm (Phase 6: the run's waiting draft of that field is the person's now; `expired` when
 * none waits); answer/read (Phase 6: the field's answer as it holds it now, for Save my answer, straight to the worker
 * and never kept, with the company this frame's own address names; `expired` when the field is gone); report/update
 * (the tab's combined report, for the in-page panel); job/refresh and job/postingText (v2: the side panel's job card
 * and custom question, job-relay.ts). A single-page application's new address is counted (frame/hello's `nav`, said
 * again at each one while the frame shows a form), so the worker reads the job card again for the posting shown now.
 * The in-page card's own buttons decide locally, on trusted clicks.
 * The person's trusted input reaches the current run as it comes (TouchLog.subscribe), so a resting run marks what they
 * edited (Phase 6). The document keeps one value hasher and the AI drafts written in it that still wait for the
 * person, for every run it holds (the Phase 6 review, E4): a later run rows a field still holding one as an
 * unconfirmed draft. Another application at the same address forgets them.
 * The in-page panel (Phase 6, ui/panel.tsx): with settings.panel 'in-page' (frame/hello's answer, then each
 * settings/changed), the launcher's Open review opens it in this frame and tells the worker (panel/shown {open: true}),
 * which then sends this frame alone the tab's report (report/update) while it is open; its Close button, or the person
 * choosing the side panel, closes it (panel/shown {open: false}). A frame too small for it (an embedded one under
 * ui/page-ui.ts PANEL_MIN_VIEWPORT) opens the side panel instead, as the side panel placement does. Its Show on page
 * and closest options act on this frame's own fields, as field/focus and field/describe do; its Confirm draft confirms
 * the run's draft here, and its Save my answer asks the worker (answer/save), which reads the answer back with
 * answer/read and sends it to TailorIT (Phase 6, wave 2). Each says what came of it.
 * v3 Phase 3: run/skip (the side panel's Skip: the current run gives up its write of that field, if it is the one it
 * writes now; `expired` otherwise); the launcher's tab at the window's right edge in the top frame (ui/edge.ts), its
 * place and hiding from frame/hello's answer and launcher/prefs, the person's drag and hide sent as launcher/place and
 * launcher/hide, and panel/side (the browser's side panel shows this tab: the tab hides meanwhile). frame/hello also says
 * whether the form asks for a cover letter (a file or text box its label names one), so the side panel shows that row.
 * v3 Phase 4: run/press (the side panel's "Continue to the next page" or "Submit application", from the worker alone)
 * goes to the current run (FillRun.press, press.ts); the in-page panel's own buttons, on the person's trusted click
 * there, do the same. A Submit pressed (the person's trusted click on the adapter's own Submit, or a trusted submit of
 * its form; the panel's press; Submit mode Auto's) is armed: submit/armed tells the worker, and the document watches
 * for its platform's sign that it was sent (submitted.ts): Ashby's success message, Greenhouse's confirmation, drawn
 * in place, or the confirmation page an address change shows. That sign, and a confirmation page a new document opens
 * on, goes to the worker as submit/detected, which takes it only for an application this tab armed (never page text
 * alone); then the run is done (SUBMITTED), or the stored RunState is. A press of ours that nothing confirmed within
 * SUBMIT_CONFIRM_MS leaves the review's submit-unconfirmed notice.
 * v3 Phase 5: run/start {agent} (the auto-apply agent's run, in the window the worker opened for it) and agent/enter
 * (press a posting page's declared entry control: press.ts pressEntry) are taken from the worker's own script alone,
 * like run/press; a page, a frame or an extension page can send neither. The agent's one retry (run/start {agent,
 * retry}) lets Submit mode Auto press the step once more. Sign-in mode Auto: a run that rests at a sign-in pause signs in
 * through content/sign-in.ts (the top frame only), and the site taking it continues the run.
 * Only this extension's own messages from outside any tab (the worker) are taken.
 *
 * WXT's content-script context is never used (a page can reach it): no context timers, listeners, onInvalidated or
 * wxt:locationchange. The runtime owns its lifetime (one AbortController), reads address changes from location.href
 * (location.ts), and logs forged WXT events without letting them change anything (forged.ts), listening for them only
 * where the page-world bridge installs, decided once, as the bridge's is, from the address the document was loaded at
 * (the v3 Phase 6/7b review's round 3, X1, and round 4, Y1: elsewhere on an ATS domain no listener keyed to the
 * extension's id is on the page for a page to time, nor does a route of the page's own add one). It ends only on the
 * platform's word that the extension is gone (isValid(), or a send that fails as context-invalidated), or when the
 * document is going away (a trusted pagehide that does not keep the page in the back/forward cache). Then the run is
 * aborted, its planned writes dropped and the UI removed. A page the cache keeps only drops its run, and when the
 * browser brings it back (a trusted pageshow with persisted set) it says frame/hello again (W1).
 * An address that is no application (applicationOf null: a host off the list, or a Lever or Greenhouse address its
 * parser does not read, W2) gets no launcher and no run, as a page with no form root does; and (the v3 Phase 6/7b
 * review, S3) a document whose address never was one says no frame/hello at all: the worker never hears of it, until a
 * single-page application's route shows a posting's page there.
 */
import { adaptersFor, applicationOf, type ApplicationRef } from '../adapters';
import { bridgeInstallsAt } from '../adapters/address';
import { companyOfUrl, scopeOf } from '../adapters/company';
import type { Adapter } from '../adapters/types';
import type { Platform } from '../core/enums';
import { reduceRun, resumeMode, type RunEvent } from '../core/steps/machine';
import type { BaseKey, FieldKey } from '../core/types/field';
import type { FillResult } from '../core/types/fill';
import type { ValueMac } from '../core/types/loop';
import type { RunState } from '../core/types/run';
import { detectPause } from '../dom/pause-detect';
import { scan, toFieldSpec } from '../dom/scan';
import { deadline, monotonicNow, startDeadline, type Cancel } from '../dom/time';
import { visibleText } from '../dom/visible-text';
import type { ScanResult } from '../dom/types';
import { ok, refuse } from '../messaging/envelope';
import {
  WorkerToContentSchema, type EntryAnswer, type LauncherPrefs, type PolicyDecision, type PressAnswer, type StepTarget,
  type SubmitEvidence, type SubmitPresser,
} from '../messaging/schemas';
import { probeStorageLocalFromContent } from '../platform/chrome';
import type { ContentPlatform, Sender } from '../platform/types';
import { COPY } from '../shared/copy';
import { log } from '../shared/log';
import { createChannel, Invalidated } from './channel';
import { watchWxtEvents } from './forged';
import { LATE_FORM_CAP_MS, lateAdapters, lateFormMs, watchForLateForm } from './late-form';
import { watchLocation } from './location';
import { postingTextOf, relayJob } from './job-relay';
import {
  FillRun, RunFailure, type HeldAnswer, type RunEnd, type RunOptions, type RunPage, type RunRequest,
} from './orchestrator';
import { readPostingPage } from './policy';
import { newSuccessSign, signsOf, SUBMIT_CONFIRM_MS, type PressSnapshot } from './submitted';
import { blockOf, entryWaitOf, pressEntry, refusalAfter } from './press';
import { signIn } from './sign-in';
import { createReportLimiter } from './report';
import { showField } from './targets';
import { TouchLog } from './touches';
import { mountPageUi, type PageUi } from './ui/page-ui';
import { createValueHasher, type ValueHasher } from './values';

/** The worker's script, as the built extension names it (wxt: entrypoints/background.ts): run/press is taken only from
 *  a sender at that address. */
const WORKER_SCRIPT_PATH = '/background.js';
/** v3 Phase 5 review: how long the agent's run/start waits for a run the page's load resumed by itself to rest. */
export const AGENT_RESUMED_WAIT_MS = 30_000;

/** How the runtime is set up; every part defaults to the real one. */
export interface RuntimeOptions extends RunOptions {
  /** The frame's address (location.href). Tests serve fixtures from srcdoc frames, whose address is about:srcdoc. */
  href?: () => string;
  /** The adapters that may handle an address (the registry's adaptersFor). */
  adapters?: (url: URL) => Adapter[];
  /** Whether this frame is the top one (read from its window by default). */
  isTop?: boolean;
  /** How long a Submit's confirmation is waited for in this document (SUBMIT_CONFIRM_MS by default; tests pass less). */
  submitConfirmMs?: number;
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

/** The address the document in `view` was loaded at, before any script of the page could move it (its navigation
 *  entry; round 4 of the v3 Phase 6/7b review, Y1), or null where the browser gives none. */
export function loadedHref(view: Window | null): string | null {
  try {
    const entry = view?.performance.getEntriesByType('navigation')[0];
    return entry !== undefined && entry.name !== '' ? entry.name : null;
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
  /** How many times a single-page application changed this document's address (v2): frame/hello carries it, so the
   *  worker reads the side panel's job card again for the posting the frame shows now. A count, never the address. */
  let nav = 0;
  /** Where the person wants the review: frame/hello's settings, then each settings/changed. */
  let placement: 'side' | 'in-page' = 'side';
  /** Sign-in mode as it acts (v3 Phase 5): frame/hello's settings, then each settings/changed. */
  let signInMode: 'manual' | 'auto' = 'manual';
  /** The launcher's place and hiding for this site (v3 Phase 3): frame/hello's answer, then launcher/prefs. */
  let launcherPrefs: LauncherPrefs = { top: null, hidden: false };
  /** The browser's side panel shows this tab (panel/side): the launcher's tab hides meanwhile. */
  let sideOpen = false;
  let lastRows = new Map<FieldKey, FillResult>();

  const channel = createChannel(platform, () => teardown('invalidated'));
  const limiter = createReportLimiter();
  /** The person's trusted input on this document, for its whole life (touches.ts); the current run hears it as it
   *  comes, so a resting run marks what the person edited (Phase 6). */
  const touches = new TouchLog(doc, lifetime.signal);
  touches.subscribe((type, path, heard) => current?.personInput(type, path, heard));
  /** The document's one value hasher, and the AI drafts written here that still wait for the person (E4): every run of
   *  the document hashes under the same key, so a later run knows a field that still holds a draft. Memory only. */
  let documentHasher: Promise<ValueHasher> | null = null;
  const drafts = new Map<BaseKey, ValueMac>();
  /** The AI's answers written here (the owner's amendments), as the drafts are kept. Memory only. */
  const answers = new Map<BaseKey, HeldAnswer>();

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
        if (msg.agent === true) {
          // v3 Phase 5: the auto-apply agent's run, from the worker's own script alone.
          if (!fromWorker(sender)) {
            log('content.agent-refused', { start: true });
            return refuse('bad_sender');
          }
          return (await startAgentRun(msg.retry === true)) ? ok({}) : refuse('expired');
        }
        startRun({ trigger: 'panel', dryRun: msg.dryRun });
        return ok({});
      case 'agent/enter': {
        // v3 Phase 5: the agent's press on a posting page's entry control, from the worker's own script alone.
        if (!fromWorker(sender)) {
          log('content.agent-refused', { enter: true });
          return refuse('bad_sender');
        }
        const entered = await enterForAgent();
        log('content.agent-entry', { pressed: entered.outcome === 'pressed' });
        return ok(entered);
      }
      case 'run/continue':
        continueRun('panel');
        return ok({});
      case 'run/cancel':
        cancelRun();
        return ok({});
      case 'settings/changed':
        current?.settingsChanged(msg.settings);
        placementChanged(msg.settings.panel);
        signInMode = msg.settings.modes.signIn;
        return ok({});
      case 'run/policyDecision':
        return decidePolicy(msg.decision) ? ok({}) : refuse('expired');
      case 'field/focus':
        focusField(msg.fieldKey as FieldKey);
        return ok({});
      case 'field/describe':
        return ok(describeField(msg.fieldKey as FieldKey));
      case 'draft/confirm':
        return (await current?.confirmDraft(msg.fieldKey as FieldKey)) === true ? ok({}) : refuse('expired');
      case 'answer/read': {
        const read = stopped || page === null ? null : current?.readAnswer(msg.fieldKey as FieldKey) ?? null;
        if (read === null) return refuse('expired');
        if ('refused' in read) return ok(read);
        // The company this frame's own address names, for a free-text answer (E5): the worker may have been stopped
        // since its last plan read it.
        const company = companyOfUrl(readHref());
        return ok({ ...read, company: company === null ? null : scopeOf(company) });
      }
      case 'report/update':
        // The worker sends it only to the frame whose panel/shown said open; a closed panel keeps nothing.
        if (ui?.panel?.open === true) ui.updatePanel(msg.reports);
        return ok({});
      // The side panel's job card (v2, job-relay.ts): relayed with nothing in either answer, and the custom question's
      // job text.
      case 'job/refresh':
        // A form of ours, or (v3 Phase 3b) a recognised posting page with no form, whose card the worker reads.
        return stopped ? refuse('expired') : relayJob(channel, msg.action, page !== null || app?.page === 'posting');
      case 'run/skip':
        return current?.skipField(msg.fieldKey as FieldKey) === true ? ok({}) : refuse('expired');
      case 'launcher/prefs':
        launcherPrefs = msg.launcher;
        ui?.setLauncherPrefs(launcherPrefs, msg.shown === true);
        return ok({});
      case 'panel/side':
        sideOpen = msg.open;
        ui?.setSidePanel(sideOpen);
        return ok({});
      case 'run/press':
        // The worker's alone (the review): an extension page's message never presses the page's Next or Submit; the
        // worker relays the side panel's only while the frame's report offers that button.
        if (!fromWorker(sender)) return refuse('bad_sender');
        return ok(await pressFor(msg.target, msg.confirmed));
      case 'job/postingText': {
        // The form's fields too (the Phase G review, MINOR 5): an "I did not use AI" statement on it keeps the side
        // panel's Write it now from writing before a run has said so.
        if (stopped) return ok({ text: '', canaries: [], policy: false });
        const now = pageNow();
        return ok(await postingTextOf(doc, now?.root ?? null, isTop, lifetime.signal, now?.app.platform ?? null,
          now === null ? [] : scanPage(now).fields.map(toFieldSpec)));
      }
    }
  });

  // ── Runs ────────────────────────────────────────────────────────────────────────────────────────────────────────
  async function hello(): Promise<void> {
    // The v3 Phase 6/7b review (S3): a document says hello only once its address shows a posting's page on its
    // platform's candidate host (applicationOf: a posting, its application or the page after submitting), the same
    // reading the page-world bridge installs by; one whose address never did stays silent (an employer's own pages on
    // an ATS domain, a board). One that said hello before says it again, so the worker hears its form go.
    if (app === null && told === null) return;
    const hasForm = page !== null;
    const letter = hasForm && asksForLetter();
    const answer = await channel.request({ v: 1, type: 'frame/hello', isTop, hasForm, ...(nav === 0 ? {} : { nav }),
      ...(letter ? { letter: true as const } : {}) });
    if (!answer.ok) return;
    told = hasForm;
    frameId = answer.data.frameId;
    placementChanged(answer.data.settings.panel);
    signInMode = answer.data.settings.modes.signIn;
    if (answer.data.launcher !== undefined) {
      launcherPrefs = answer.data.launcher;
      ui?.setLauncherPrefs(launcherPrefs);
    }
    // A side panel that shows the tab as this document loads (v3 Phase 3 review): its panel/side came to the page
    // before this one, so the hello says it.
    if (isTop && answer.data.side === true && !sideOpen) {
      sideOpen = true;
      ui?.setSidePanel(true);
    }
  }

  /** Whether the form asks for a cover letter (v3 Phase 3): a file or text box its label names one. A flag only. */
  function asksForLetter(): boolean {
    const now = page;
    if (now === null) return false;
    try {
      // A field a person can see and read as asking for one (v3 Phase 3 review): its label shown, never a control the
      // page draws unseen.
      return scanPage(now).fields.some((field) => (field.kind === 'file' || field.kind === 'textarea')
        && field.labelVisible && !field.camouflaged && /\bcover[\s_-]*letter\b/i.test(field.label));
    } catch {
      return false;
    }
  }

  // ── Next and Submit, and the platform's confirmation (v3 Phase 4) ───────────────────────────────────────────────

  /** The panel's Next or Submit (run/press, or the in-page panel's trusted click), for the current run. */
  async function pressFor(target: StepTarget, confirmed: boolean): Promise<PressAnswer> {
    if (stopped || current === null || pageNow() === null) return { outcome: 'gone' };
    return current.press(target, confirmed);
  }

  /** Whether a message to this frame came from the extension's worker itself (its script's address), not from one of
   *  the extension's pages. */
  function fromWorker(sender: Sender): boolean {
    if (sender.url === undefined) return false;
    try {
      const at = new URL(sender.url);
      return at.hostname === platform.runtime.id && at.pathname === WORKER_SCRIPT_PATH;
    } catch {
      return false;
    }
  }

  /** The steps Submit mode Auto pressed in this document (RunEnv.autoPressed): once each, whichever run. */
  const autoPressed = new Set<string>();

  /** A Submit armed in this document (the review, M1 and M6): when, by whom, the application and platform it was
   *  pressed for (read at the press, so a confirmation shown at an address the parser does not read still counts), the
   *  form root and adapter it was pressed on, the platform's success signs the page already showed then (never taken as
   *  this Submit's), and how to end its watch. */
  interface ArmedSubmit {
    at: number;
    by: SubmitPresser;
    applicationKey: string;
    platform: Platform;
    root: Element;
    adapter: Adapter;
    before: ReadonlySet<Element>;
    stopWatch(): void;
  }
  let armed: ArmedSubmit | null = null;
  /** The worker's answer to the latest submit/armed: a sign seen at once waits for it, so the worker holds the arm
   *  before it hears the sign. */
  let armedHeard: Promise<unknown> = Promise.resolve();

  /** An armed Submit's watch ends without a confirmation: the run no longer waits. `how`: the page refused it (its
   *  count), nothing came in SUBMIT_CONFIRM_MS, or a newer press took its place. */
  function endArm(record: ArmedSubmit, how: { refused: number } | 'unconfirmed' | 'replaced'): void {
    record.stopWatch();
    if (armed === record) armed = null;
    // A newer press took its place: that one's watch speaks for the run now.
    if (how === 'replaced') return;
    if (typeof how === 'object') current?.submitRefused(how.refused);
    // The person's own click on the page is theirs to follow; a press of ours says it saw nothing.
    else if (record.by !== 'page') current?.submitUnconfirmed();
    else current?.submitWatchEnded();
  }

  /** A Submit of the application was pressed (module header): the worker is told, and the document watches for the
   *  platform's sign until SUBMIT_CONFIRM_MS (a press of ours that nothing confirms then leaves its notice), and for
   *  the page's refusal PRESS_REFUSAL_MS after the press (its errors, the fields its form marked, its failure message),
   *  which ends the wait at once. `runId`: the run that filled the form, when there is one. */
  function arm(by: SubmitPresser, runId?: string, before?: PressSnapshot): void {
    // What the page showed at the press: its click may have moved it since (a confirmation drawn in place, an address
    // the parser does not read), which is the sign this arm waits for.
    const at = before ?? (app === null || page === null ? null : { applicationKey: app.applicationKey,
      platform: app.platform, root: page.root, adapter: page.adapter, signs: new Set(signsOf(doc, app.platform)) });
    if (stopped || at === null || !channel.valid()) return;
    log('content.submit-armed', { page: by === 'page', panel: by === 'panel', auto: by === 'auto' });
    // The resume is named to the tracker only when the run's own upload row verified on this form.
    const resume = runId !== undefined && current !== null && current.begunAs === runId && current.resumeAttached();
    armedHeard = channel.request({ v: 1, type: 'submit/armed', applicationKey: at.applicationKey, by,
      ...(runId === undefined ? {} : { runId }), ...(resume ? { resume: true as const } : {}) }).catch(() => undefined);
    if (armed !== null) endArm(armed, 'replaced');
    const view = doc.defaultView;
    const watch = new AbortController();
    lifetime.signal.addEventListener('abort', () => watch.abort(), { once: true, signal: watch.signal });
    let cancelTimer: Cancel = () => undefined;
    const observer = view === null ? null : new view.MutationObserver(() => check());
    const record: ArmedSubmit = { at: platform.now(), by, applicationKey: at.applicationKey, platform: at.platform,
      root: at.root, adapter: at.adapter, before: at.signs, stopWatch: () => {
        observer?.disconnect();
        cancelTimer();
        watch.abort();
      } };
    armed = record;
    const check = () => {
      if (armed !== record || stopped) return record.stopWatch();
      if (newSuccessSign(doc, record.platform, record) === null) return;
      record.stopWatch();
      armed = null;
      void detected('success-message', record);
    };
    observer?.observe(doc.documentElement, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['class', 'style', 'hidden'] });
    cancelTimer = startDeadline(options.submitConfirmMs ?? SUBMIT_CONFIRM_MS, () => {
      if (armed === record) endArm(record, 'unconfirmed');
    }, lifetime.signal);
    // The page's refusal, read PRESS_REFUSAL_MS after the press (the invalid events its form fires in the person's own
    // click are heard from now on).
    void refusalAfter({ doc, adapter: at.adapter, root: at.root }, watch.signal).then((count) => {
      if (armed === record && count > 0) endArm(record, { refused: count });
    });
    check();
  }

  /** The platform's sign was seen (module header): the worker takes it only for an application this tab armed; then the
   *  run is done, or the stored RunState is. `record`: the Submit armed in this document that it follows (its
   *  application, read at the press); none on a new document (the confirmation page), whose own address names it. */
  async function detected(evidence: SubmitEvidence, record?: ArmedSubmit): Promise<void> {
    const applicationKey = record?.applicationKey ?? app?.applicationKey ?? null;
    if (stopped || applicationKey === null) return;
    log('content.submit-detected', { page: evidence === 'confirmation-page' });
    await armedHeard;
    if (stopped) return;
    const answer = await channel.request({ v: 1, type: 'submit/detected', applicationKey, evidence });
    if (!answer.ok || stopped) return;
    if (armed !== null) {
      armed.stopWatch();
      armed = null;
    }
    if (current !== null && current.runState !== null && current.runState.applicationKey === applicationKey) {
      await current.submittedSeen();
      return;
    }
    await markSubmitted(applicationKey);
  }

  /** Whether the address is the platform's page after submitting (Lever's /thanks, Greenhouse's /confirmation). */
  function onConfirmationPage(): boolean {
    return app?.page === 'confirmation';
  }

  /** When the person last pressed Enter in a control of the form (monotonic ms): the browser's submit that follows an
   *  Enter is theirs. The submit event itself is trusted whoever's click caused it, a page's own untrusted click() and
   *  the extension's press included, so it counts only after the person's own Enter. */
  let enterAt = Number.NEGATIVE_INFINITY;
  /** How soon after the person's Enter a form's submit is taken as theirs. */
  const ENTER_SUBMIT_MS = 1_000;

  /** The person's trusted click on the adapter's own Submit, or their Enter in a box of the form that submits it. */
  function personSubmitted(event: Event): void {
    if (!event.isTrusted || stopped) return;
    const on = page;
    if (on === null) return;
    const path = event.composedPath();
    if (event.type === 'keydown') {
      if ((event as KeyboardEvent).key === 'Enter' && path.includes(on.root)) enterAt = monotonicNow();
      return;
    }
    if (event.type === 'submit') {
      if (path.includes(on.root) && monotonicNow() - enterAt <= ENTER_SUBMIT_MS) arm('page', ownRun(on.app));
      return;
    }
    if ((event as MouseEvent).button !== 0) return;
    let submit: HTMLElement | null = null;
    try {
      submit = on.adapter.submitButton?.(on.root) ?? null;
    } catch {
      submit = null;
    }
    if (submit !== null && path.includes(submit)) arm('page', ownRun(on.app));
  }

  /** The run that filled this application's form, when one did (its id): the person's own Submit carries it, so the
   *  tracker hears the job and resume that run knew (the review). */
  function ownRun(of: ApplicationRef): string | undefined {
    const run = current;
    if (run === null || run.begunAs === null || run.runState === null) return undefined;
    return run.runState.applicationKey === of.applicationKey ? run.begunAs : undefined;
  }
  for (const type of ['click', 'submit', 'keydown'] as const) {
    doc.addEventListener(type, personSubmitted, { capture: true, signal: lifetime.signal });
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
    // The form root as the adapter finds it now: a run never starts on one the page replaced.
    const on = stopped ? null : pageNow();
    if (on === null || !channel.valid()) return null;
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
      page: on,
      now: () => platform.now(),
      options,
      onRows(rows) {
        lastRows = new Map(rows.map((row) => [row.key, row]));
      },
      // Fill anyway at a policy card a later pass showed: a fresh run, on this run's own ended state (L-S2).
      fillAgain(next) {
        if (current === run) startRun(next);
      },
      // The run found the form root again as a new element (the page drew its whole form again): the launcher follows.
      rootMoved(root) {
        if (current === run) moveRoot(root);
      },
      touches,
      hasher: () => (documentHasher ??= createValueHasher()),
      drafts,
      answers,
      // v3 Phase 4: a Submit this run pressed is armed here, so its platform's sign is watched for.
      submitPressed: (by, runId, before) => arm(by, runId, before ?? undefined),
      beforePress: () => (app === null || page === null ? null : { applicationKey: app.applicationKey,
        platform: app.platform, root: page.root, adapter: page.adapter, signs: new Set(signsOf(doc, app.platform)) }),
      autoPressed,
      // v3 Phase 5, Sign-in mode Auto: once, on the page this run paused at, until the run stops or is cancelled; the
      // site taking it continues the run.
      signIn: (signal) => signIn({ doc, adapter: on.adapter, channel, href: readHref, isTop,
        signal: AbortSignal.any([signal, lifetime.signal]) }),
      afterSignIn: () => {
        if (current === run) continueRun(run.trigger);
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
    if (current === null || current.ended !== 'paused') return;
    const state = current.runState;
    const carry = current.carryOut(true);
    startRun(state === null ? { trigger, dryRun: false, carry }
      : { trigger, dryRun: false, from: { state, event: continueEventOf(state) }, carry });
  }

  /** v3 Phase 5: the auto-apply agent's run (run/start {agent}): from the tab's stored RunState when it holds one for
   *  this application (Continue's way), so its steps' attempts, the runaway-wizard count and what it carries go on
   *  across documents; a fresh run otherwise. `retry`: the agent's one retry after the page refused its Submit, which
   *  lets Submit mode Auto press the step once more. Answers whether a run started (not while one works). A run the
   *  page's load resumed by itself (resumeStored), still on its way, is waited for (AGENT_RESUMED_WAIT_MS at most): the
   *  agent's goes on from where it rests. */
  async function startAgentRun(retry: boolean): Promise<boolean> {
    const on = stopped ? null : pageNow();
    if (on === null || app === null || !channel.valid()) return false;
    if (current !== null && current.ended === null && current.trigger === 'resume') {
      const resumed = current;
      await Promise.race([resumed.start(), deadline(AGENT_RESUMED_WAIT_MS, lifetime.signal)]);
      if (current !== resumed) return false;
    }
    if (current !== null && current.ended === null) return false;
    const key = app.applicationKey;
    const ours = current !== null && current.runState?.applicationKey === key ? current : null;
    const held = ours?.runState ?? await storedRunState(key);
    if (stopped || (current !== null && current.ended === null) || app?.applicationKey !== key) return false;
    if (held !== null && held.status === 'done') return false;
    if (retry) {
      for (const pressed of [...autoPressed]) if (pressed.startsWith(`${key}|`)) autoPressed.delete(pressed);
    }
    const carry = ours !== null && ours === current ? ours.carryOut(true) : undefined;
    const from = held !== null && held.status !== 'stopped' ? { state: held, event: continueEventOf(held) } : undefined;
    return startRun({ trigger: 'agent', dryRun: false, ...(from === undefined ? {} : { from }),
      ...(carry === undefined ? {} : { carry }) }) !== null;
  }

  /** v3 Phase 5: agent/enter, in the top frame with no form: the adapter's declared entry control (press.ts
   *  pressEntry), waited for as long as the address's adapters ask (press.ts entryWaitOf: 8 s, and v3 Phase 7b's
   *  Workday and Oracle, whose postings show their Apply 6 to 11 s after load, quirks.entryWaitMs); a sign-in page
   *  before any form is signed in to with Sign-in mode Auto (sign-in.ts), else it blocks. */
  async function enterForAgent(): Promise<EntryAnswer> {
    const at = urlOf(readHref());
    if (stopped || page !== null || at === null || !isTop) return { outcome: 'not-offered' };
    const own = adapters(at);
    // The press is told the worker as it is made, with nothing awaited (round 3 of the v3 Phase 6/7b review, X8): one
    // that takes the page away ends this document before the entry's answer.
    const entered = await pressEntry(doc, own, lifetime.signal, entryWaitOf(own), undefined,
      () => void channel.request({ v: 1, type: 'agent/entered' }).catch(() => undefined));
    if (entered.outcome !== 'blocked' || entered.block !== 'sign-in' || signInMode !== 'auto' || own.length === 0) {
      return entered;
    }
    const outcome = await signIn({ doc, adapter: own[0]!, channel, href: readHref, isTop, signal: lifetime.signal });
    if (outcome === 'left') return { outcome: 'pressed' };
    if (outcome === 'continue') {
      // What the page shows after the sign-in: a challenge its press raised, an email code, another account page is
      // the person's, and the entry says so (the v3 Phase 6/7b review's round 2, E7); nothing: it went on.
      const after = detectPause(doc, null, own[0]!);
      return after === null ? { outcome: 'pressed' } : { outcome: 'blocked', block: blockOf(after.kind) };
    }
    return { outcome: 'blocked', block: outcome === 'failed' ? 'sign-in-failed' : 'sign-in' };
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

  /** The page with its form root as the adapter finds it now: a root the page replaced (it drew its whole form again,
   *  as Twitch's Greenhouse form is drawn again once its first render fails) is found again by the adapter's hook, and
   *  the UI anchored to the new one, so the launcher stays on the form the person sees and a scan reads it. */
  function pageNow(): RunPage | null {
    if (page === null || page.root.isConnected) return page;
    let found: Element | null;
    try {
      found = page.adapter.detect(doc)?.formRoot ?? null;
    } catch {
      found = null;
    }
    if (found !== null && found.isConnected) moveRoot(found);
    return page;
  }

  /** The page's form root is `root` from now on: the UI anchors to it. */
  function moveRoot(root: Element): void {
    if (page === null || page.root === root) return;
    page = { ...page, root };
    ui?.anchorTo(root);
  }

  /** A fresh scan of the page, with what the last run read of its widgets (their keys carry the read options' hash). */
  function scanPage(on: RunPage): ScanResult {
    return scan(on.root, on.adapter, { platform: on.app.platform, frameId: frameId ?? 0,
      ...(current === null ? {} : { widgetReadings: current.widgetReadings }) });
  }

  /** field/focus (Show on page): the field, or its proxy, scrolled into view and focused (the person asked); nothing
   *  is drawn over it. */
  function focusField(key: FieldKey): void {
    const now = stopped ? null : pageNow();
    if (now === null) return;
    const target = scanPage(now).target(key);
    if (target !== null) showField(target);
  }

  /** field/describe: the visible labels of the row's suggested options, read from a fresh scan. Never kept. */
  function describeField(key: FieldKey): { options: Array<{ index: number; label: string }> } {
    const indices = (lastRows.get(key)?.detail?.suggestions ?? []).map((suggestion) => suggestion.index).slice(0, 3);
    const now = stopped || indices.length === 0 ? null : pageNow();
    if (now === null) return { options: [] };
    const field = scanPage(now).fields.find((candidate) => candidate.key === key);
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

  /** The application's stored RunState is done (v3 Phase 4: once the worker took the platform's sign after a Submit
   *  this tab armed). */
  async function markSubmitted(applicationKey: string): Promise<void> {
    const state = await storedRunState(applicationKey);
    if (state === null) return;
    const next = reduceRun(state, { type: 'SUBMITTED' }, { autoAdvance: false, now: platform.now() });
    if (next.state === state) return;
    await channel.request({ v: 1, type: 'runstate/put', runState: next.state });
  }

  // ── The page: which application, adapter and form root ──────────────────────────────────────────────────────────
  function resolvePage(href: string): void {
    const url = urlOf(href);
    app = url === null ? null : applicationOf(url);
    // While the page's own adapter waits for a form it draws late, only the adapters that say so may claim the page.
    const claim = (at: URL) => (lateClosed === href ? adapters(at) : lateAdapters(adapters(at)));
    const picked = url !== null && app !== null && app.page === 'application' ? pickAdapter(doc, url, claim) : null;
    page = picked === null || app === null ? null : { app, adapter: picked.adapter, root: picked.root };
  }

  /** The watch for a form root, or a posting's text, drawn late (module header, 2), while one runs. */
  let lateWatch: Cancel | null = null;
  /** The address whose wait for a late form is over: every adapter may claim its page from then on. */
  let lateClosed: string | null = null;
  /** The watch for a posting's own text drawn late (readPosting), while one runs. */
  let postingWatch: Cancel | null = null;

  /** The form was found: the launcher, the worker told, a stored run resumed (as at start-up). */
  function formFound(): void {
    mountUi();
    void hello().catch(() => undefined);
    void resumeStored().catch(() => undefined);
  }

  /** Watches for the form root of an application page that shows none yet, when an adapter of its address says its
   *  page draws it late; at the end of that wait every adapter may claim the page. A new address ends the watch
   *  (onAddress starts the next one). */
  function watchLateForm(): void {
    lateWatch?.();
    lateWatch = null;
    if (stopped || page !== null || app?.page !== 'application') return;
    const href = readHref();
    const url = urlOf(href);
    const capMs = url === null ? 0 : lateFormMs(adapters(url));
    if (capMs === 0) return;
    lateWatch = watchForLateForm(doc, capMs, () => {
      if (stopped || readHref() !== href) return true;
      resolvePage(href);
      if (page === null) return false;
      formFound();
      return true;
    }, lifetime.signal, () => {
      // The wait is over: any adapter may claim the page now (the generic one a page with another form).
      if (stopped || readHref() !== href || page !== null) return;
      lateClosed = href;
      resolvePage(href);
      if (page !== null) formFound();
    });
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
        // Edit with AI (the owner's amendments): the current run rewrites that field, if it may now.
        onAiEdit(key, instruction) {
          if (!channel.valid() || current === null) return Promise.resolve(COPY.aiEdit.outcomes.refused);
          return current.rewrite(key as FieldKey, instruction).then((outcome) => (outcome === 'rewritten' ? null
            : COPY.aiEdit.outcomes[outcome]), () => COPY.aiEdit.outcomes.failed);
        },
        onPolicyChoice(choice) {
          if (choice === 'accepted') current?.accept();
          else current?.decline();
        },
        // The form root the launcher stands on left the page (it drew its whole form again): it is found again.
        rootGone: () => void pageNow(),
        // v3 Phase 3: the top frame's launcher sits at the window's right edge; where the person drops it, and where
        // they hide it, the worker keeps for the site.
        ...(isTop ? { edge: {
          placed: (top: number) => {
            if (channel.valid()) channel.fire({ v: 1, type: 'launcher/place', top });
          },
          hidden: (scope: 'next-visit' | 'site' | 'everywhere') => {
            if (channel.valid()) channel.fire({ v: 1, type: 'launcher/hide', scope });
          },
        } } : {}),
        panel: {
          frameId: () => frameId,
          showField: (key) => focusField(key as FieldKey),
          describeField: async (key) => describeField(key as FieldKey).options,
          // Phase 6, wave 2: this frame's draft, confirmed here; its answer, saved through the worker.
          confirmDraft: async (key) => ((await current?.confirmDraft(key as FieldKey)) === true
            ? COPY.panel.draftConfirmed : COPY.panel.confirmFailed),
          saveAnswer: async (key) => saveFromPanel(key as FieldKey),
          closed: () => closePanel(),
          // v3 Phase 4: the dock's Next and Submit, for this frame's own run.
          press: (target, confirmed) => pressFor(target, confirmed),
        },
      });
      ui.anchorTo(page.root);
      ui.setLauncher({ state: 'idle', action: 'fill' });
      ui.setLauncherPrefs(launcherPrefs);
      ui.setSidePanel(sideOpen);
    } catch {
      // Without its UI the top frame still fills from the side panel's Fill; a frame inside another page cannot show
      // its launcher is seen there, so it fills nothing (FillRun's frame check, S1).
      ui = null;
    }
  }

  async function readPosting(): Promise<void> {
    if (app?.page !== 'posting') return;
    const key = app.applicationKey;
    const href = readHref();
    const url = urlOf(href);
    const named = url === null ? undefined : adapters(url).find((adapter) => adapter.postingText !== undefined);
    const read = async (scope?: Element) => {
      try {
        await readPostingPage(channel, doc, key, scope);
      } catch (failure) {
        if (!(failure instanceof Invalidated)) throw failure;
      }
    };
    if (named === undefined) {
      await read();
      return;
    }
    // The posting's own text, once the page draws it (Ashby's overview, seconds after the page loads).
    const shown = (): Element | null => {
      let scope: Element | null;
      try {
        scope = named.postingText!(doc);
      } catch {
        scope = null;
      }
      return scope !== null && visibleText(scope).trim() !== '' ? scope : null;
    };
    const now = shown();
    if (now !== null) {
      await read(now);
      return;
    }
    postingWatch?.();
    postingWatch = watchForLateForm(doc, lateFormMs([named]) || LATE_FORM_CAP_MS, () => {
      if (stopped || readHref() !== href) return true;
      const scope = shown();
      if (scope === null) return false;
      void read(scope).catch(() => undefined);
      return true;
    }, lifetime.signal);
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
      drafts.clear();
      answers.clear();
      ui?.setNotices([]);
      ui?.hidePolicyCard();
      ui?.setLauncher({ state: 'idle', action: 'fill' });
    }
    if (page === null) ui?.anchorTo(null);
    else mountUi();
    // Each new address is counted; the worker hears of it while the frame shows a form (the job card is that form's
    // posting), and whenever the form came or went.
    nav += 1;
    if (told !== (page !== null) || page !== null) void hello().catch(() => undefined);
    void readPosting().catch(() => undefined);
    watchLateForm();
    // v3 Phase 4: the platform's page after submitting, shown by an address change in this document.
    if (app?.page === 'confirmation') void detected('confirmation-page').catch(() => undefined);
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
  // The forged WXT events (forged.ts) are listened for, for the document's life, only where the page-world bridge
  // installs: decided once, from the address the document was loaded at (loadedHref), never again at a route of the
  // page's own, which a page could use to add the listener and time it (round 4 of the v3 Phase 6/7b review, Y1).
  if (bridgeInstallsAt(options.href === undefined ? loadedHref(view) ?? readHref() : readHref())) {
    watchWxtEvents(doc, platform.runtime.id, (kind) => {
      // The real started event of a newer instance comes only once the extension was reloaded, when the platform says
      // it is gone (channel.valid() then tears down). Anything else is a page's forgery: logged, changing nothing.
      if (kind === 'started' && !channel.valid()) return;
      log('content.forged-wxt-event', kind === 'started' ? { started: true } : { locationChange: true });
    }, lifetime.signal);
  }
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
      watchLateForm();
      await resumeStored();
      // The platform's page after submitting (v3 Phase 4): the worker takes it only after a Submit this tab armed.
      if (onConfirmationPage()) await detected('confirmation-page');
      // e2e only: the document's start-up is over, its confirmation page's sign told and answered.
      if (__E2E__) await platform.runtime.send({ v: 1, type: 'e2e/probe', settled: true }).catch(() => undefined);
    }
  } catch (failure) {
    if (!(failure instanceof Invalidated)) throw failure;
  }
  return handle();
}
