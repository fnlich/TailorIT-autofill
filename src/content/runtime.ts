/*
 * The content script's runtime, once per document (docs/design/runtime.md §8.1, §8.10; docs/ARCHITECTURE.md "How it
 * works at run time" and "Isolation").
 * Start-up:
 * 1. The worker's messages are listened for first, then frame/hello {isTop, hasForm} goes out: the worker pings a
 *    tab's registered frames (frame/ping) when another frame says hello, and forgets one where nothing listens.
 * 2. The adapter is the registry's first whose detect() finds a form root (adaptersFor); where none does while what holds
 *    a form's controls is still fading in, the page is read again once those entrance animations end, at most
 *    ENTRANCE_CAP_MS later (core pass Z2 of 2026-11-06: Pinpoint's panel; dom/entrance.ts). No form root: no launcher and
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
 *    again by the adapter's hook (pageNow; a run tells of one it found, rootMoved), and the launcher moves to it.
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
 * The worker's messages are answered: frame/ping {pong}; run/start; run/continue (Continue after a pause); run/cancel
 * (stops a run, a run that waits for the next step, or a paused one); settings/changed (the person saved their
 * settings: the current run reads auto-advance from them, C-S2); run/policyDecision (v4: no run waits at a policy card
 * any more, so it is answered `expired`); field/focus (scroll the field or its proxy into view and
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
 * The in-page panel (Phase 6, ui/panel.ts; v5: its views, ui/card.tsx, come with the sidebar's bundle): with
 * settings.panel 'page' (v5: in a frame inside another page, the top frame's panel being the sidebar) (frame/hello's
 * answer, then each
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
 * SUBMIT_CONFIRM_MS leaves the review's submit-unconfirmed notice, and its sign is still watched for, quietly, until
 * SUBMIT_WATCH_MS after the press (the audit of 2026-11-06, m10): a later one still makes the application submitted.
 * The audit's S-9: a frame on a domain that also holds an employer's own pages, below a page of its own origin that is
 * no posting's (address.ts framedByEmployerPage), does nothing at all: no listener, no frame/hello, no UI.
 * v3 Phase 5: run/start {agent} (the auto-apply agent's run, in the window the worker opened for it) and agent/enter
 * (press a posting page's declared entry control: press.ts pressEntry) are taken from the worker's own script alone,
 * like run/press; a page, a frame or an extension page can send neither. The agent's one retry (run/start {agent,
 * retry}) lets Submit mode Auto press the step once more. Sign-in mode Auto: a run that rests at a sign-in pause signs in
 * through content/sign-in.ts (the top frame only, or the frame that claims a wrapper's application: below), and the site
 * taking it continues the run.
 * The snapshot build of 2026-11-06 (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06): a subframe directly below a same-origin top frame whose
 * adapter names it its application frame (an iCIMS portal's iframe#icims_content_iframe) claims the application
 * (chain-frame.ts claimsApplication; frame/hello `claimed`, the wrapper's `wraps`): it signs in and takes the agent's
 * entry as a top frame does (core-x item 3). A page whose address names no job but continues an application
 * (adapters/chain.ts) names its chain in its hello (a top frame's referrer by its hash, a subframe's token from its
 * claimed parent frame, chain-frame.ts), and takes the application key the worker's answer gives it (`chained`) while its
 * address stays such a page of the same family; a claimed frame whose pages frame chain pages hands its own child
 * frames the token the worker gave it (core-x items 7 and 14).
 * Only this extension's own messages from outside any tab (the worker) are taken.
 *
 * v4 run (the owner, 2026-11-07; docs/SPEC-AMENDMENTS.md §13):
 * - The page's account wall (a sign-in, an account's creation, an email gate) and a choice of how to apply its adapter
 *   answers, as the top frame or the frame that claims the application shows them now, go to the worker (frame/wall) at
 *   each change: the side panel's main button then reads "Sign up & Autofill". The page is looked at again on each DOM
 *   change, coalesced (WALL_LOOK_MS), never while a run works (its own pause says it), for the document's life.
 * - run/start at such a page with no form (Autofill, or Sign up & Autofill: run/start {signIn}): a choice of how to apply
 *   is answered with the adapter's declared entry (press.ts pressEntry: Workday's Apply Manually); a wall is signed in
 *   to (sign-in.ts) under Sign up & Autofill or Sign-in mode Auto, else its toast says to sign in here or use Sign up &
 *   Autofill; with no job-site sign-in saved in TailorIT, the toast says to add one (its Open: TailorIT's Settings ›
 *   Autofill); with a challenge on the page, to solve it (the v4 review, M5: any other sign-in it could not make says
 *   to sign in here). The page that follows fills as usual (the worker starts its run, background/sign-up.ts).
 * - The v4 review (behaviour H1): run/start that is no dry run, reaching a run that rests offering Continue (a page
 *   turned under Autofill after page turn: Manually, a pause), continues it (continueRun), as the launcher does.
 * - A run paused at what the page shows carries on by itself once it goes (orchestrator.ts watchPauseGone, through
 *   afterSignIn: continueRun), at most MAX_AUTO_CONTINUES times in a document.
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
 * v3 Phase 8: on a company's own page, where the worker injected the content script once the sentinel recognised the
 * page, the address is the `site` application of its origin and path and the site adapter alone may claim a form (by
 * the application-form score, and again for SITE_FORM_LATE_MS as the page draws); nothing is said to the worker until it
 * does. The page-world bridge and the forged-event listener never run there (bridgeInstallsAt reads no such address).
 *
 * v5 p1-shell (PLAN decisions 1 and 2, Jobright's sidebar and launcher; settings version 8): with "Where the panel
 * shows" On the page ('page', the default), the top frame's panel is the sidebar (ui/sidebar.ts): its views are the
 * side panel's, in a bundle the worker runs in this document on sidebar/load (shared/sidebar.ts), mounted into the
 * page UI's closed root. The top frame of a supported page (an address a platform's parser reads, never its page after
 * submitting; a company's own page once its form or job signal is found) shows the launcher's pill with or without a
 * form, and the pill's click opens the panel (the sidebar, or the browser's side panel with 'side') whatever the run's
 * state. Under "Default view: Expanded" the sidebar opens by itself once per document on such a page, unless the person
 * hid the launcher on this site or everywhere; the views' minimise folds it back to the pill. The worker's sidebar/open
 * (the toolbar icon) opens it on any page of ours. A frame inside another page keeps its corner launcher and in-page
 * card (the panel 'page' acts there as the in-page card did).
 *
 * v1.3 B (the owner, 2026-11-09; docs/SPEC-AMENDMENTS.md §16): the form's questions and the person's answers are read
 * as each step is left (the run's own Next: RunEnv.stepLeaving; the person's own click on the adapter's Next) and at
 * every armed Submit press, into the document's memory only (form-capture.ts), and handed to the worker with the arm
 * (submit/form, with the posting's names and visible text from the top frame), which sends them to TailorIT only once
 * the site confirmed that Submit.
 *
 * jr6 apply F2 (the owner, 2026-11-10: "extension should also click `apply` to find and run the form ... and `Autofill`
 * word will be kept"; the session's APPLYPLAN §5 F2): Autofill on a page with no form. Its own Apply is offered on any
 * address of a posting but its confirmation, by the address's own adapters (entryOffered). The panel's Autofill, the
 * queue's and the agent's agent/enter are one entry (enter), one at a time (frame/wall `entering`): the page read again
 * first (a form now is filled); the page's Apply waited for and pressed through the entry door (never a new tab, a
 * download or another origin: the door says why), with the step the site shows after it (the adapter's choice, or the
 * generic second step in a dialog our press opened: adapters/second-step.ts), told the worker at each press
 * (entry/pressed, with the destination's key on this origin); then this document watched for what the press brought
 * (afterPress): a form claimed in place by the address's own adapters, a posting's address included; a wall, the
 * sign-in step's; else why not, in one closed word (frame/wall `refusal`). Forms drawn hidden are heard by their
 * attributes (late-form.ts), at a posting's address where an adapter says so (quirks.formAtPosting), and for the
 * document's life where it draws them in place (quirks.formInPlace), the generic adapter never claiming there. A
 * posting's own text is read for policy text on an application's address too, while no form shows there.
 */
import { adaptersFor, applicationOf, type ApplicationRef } from '../adapters';
import { bridgeInstallsAt, framedByEmployerPage, readableAncestors } from '../adapters/address';
import { chainPageOf, hrefHash } from '../adapters/chain';
import { companyOfUrl, scopeOf } from '../adapters/company';
import type { Adapter } from '../adapters/types';
import type { Platform } from '../core/enums';
import { reduceRun, resumeMode, type RunEvent } from '../core/steps/machine';
import type { BaseKey, FieldKey } from '../core/types/field';
import type { FillResult } from '../core/types/fill';
import type { ValueMac } from '../core/types/loop';
import type { RunState } from '../core/types/run';
import { awaitEntrance } from '../dom/entrance';
import { embedsAts, jobSignalOf } from '../dom/page-signals';
// v5 p2-detect, the P2 review (security 1)
import { oracleShellShown } from '../dom/page-signals';
import { detectPause } from '../dom/pause-detect';
import { newScanCache } from '../dom/scan-cache';
import { scan, toFieldSpec } from '../dom/scan';
import { deadline, monotonicNow, startDeadline, type Cancel } from '../dom/time';
import { visibleText } from '../dom/visible-text';
import { isUserVisible } from '../dom/visibility';
import type { ScanResult } from '../dom/types';
import { ok, refuse } from '../messaging/envelope';
import {
  SIGN_IN_WALLS, WorkerToContentSchema, type EntryAnswer, type LauncherPrefs, type PressAnswer, type SignInWall,
  type StepTarget, type SubmitEvidence, type SubmitPresser, type WallWaits,
  // jr6 apply F2
  ENTRY_REFUSALS, type EntryRefusal,
} from '../messaging/schemas';
import { probeStorageLocalFromContent } from '../platform/chrome';
import type { ContentPlatform, Sender } from '../platform/types';
import { PAGE_COPY } from '../shared/copy';
import { isCompanySiteUrl } from '../shared/hosts';
import { log } from '../shared/log';
import { createChannel, Invalidated } from './channel';
import { watchWxtEvents } from './forged';
import { LATE_FORM_CAP_MS, lateAdapters, lateFormMs, watchForLateForm, watchForSiteForm } from './late-form';
import { watchLocation } from './location';
import { postingNamesOf, postingTextOf, relayJob } from './job-relay';
import {
  FillRun, RunFailure, type HeldAnswer, type RunEnd, type RunOptions, type RunPage, type RunRequest,
} from './orchestrator';
import { readPostingPage } from './policy';
import { newSuccessSign, shownSignsOf, SUBMIT_CONFIRM_MS, SUBMIT_WATCH_MS, type PressSnapshot,
  // v5 p2-detect
  watchNetworkSigns } from './submitted';
import { blockOf, entryWaitOf, pressEntry, pressEntryChoice, refusalAfter,
  // v5 p2-detect
  refusalNow,
  // jr6 apply F2
  ENTRY_MAX_PRESSES, pressSecondStep, type EntryResult } from './press';
import { loadPagePatches } from './page-patches';
import { dropKeptSignIns, signIn } from './sign-in';
import { claimsApplication, wrapperOf, wrapsApplication } from './chain-frame';
import { createReportLimiter } from './report';
// v1.3 B
import { captureStep, createFormCapture, stepNameOf } from './form-capture';
import type { CapturedPosting } from '../messaging/schemas';
import { MAX_POSTING_TEXT } from '../messaging/schemas';
import { visibleTextWithout } from '../dom/visible-text';
import { showField } from './targets';
import { TouchLog } from './touches';
import { showApplied } from './ui/applied';
import { documentDialogShown, showEditConfirm, showPreviewDialog } from './ui/document-dialog'; // v1.5 X
import { mountPageUi, type PageUi } from './ui/page-ui';
import { sidebarAppOf, SIGNUP_SECTION, type SidebarApp } from '../shared/sidebar';
import type { PanelPlace, PanelView } from '../core/types/settings';
import type { ToastSpec } from './ui/toasts';
import type { NotificationTime } from '../core/types/settings';
import { createValueHasher, type ValueHasher } from './values';

/** The worker's script, as the built extension names it (wxt: entrypoints/background.ts): run/press is taken only from
 *  a sender at that address. */
const WORKER_SCRIPT_PATH = '/background.js';
/** v3 Phase 5 review: how long the agent's run/start waits for a run the page's load resumed by itself to rest. */
export const AGENT_RESUMED_WAIT_MS = 30_000;
/** v4: how long after a DOM change the page is looked at again for its account wall (frame/wall). */
export const WALL_LOOK_MS = 300;
/** v4: how many times in a document a paused run carries on by itself once its pause went (orchestrator.ts
 *  watchPauseGone): a page that keeps showing and hiding a check never loops. */
export const MAX_AUTO_CONTINUES = 20;
/** jr6 apply F2 item 2 (APPLYPLAN D3; AF-4, B4, B9): how long after an entry press of ours this document is watched
 *  for what the press brings (a form drawn in place, a wall, a choice), at least; an adapter of the address whose
 *  formLateMs is longer is waited for that long (late-form.ts LATE_FORM_CAP_MS holds it). */
export const ENTRY_FORM_WAIT_MS = 20_000;
/** jr6 apply F2 (the line P review, revA-4): why an entry ended early, when a route to another application ended it
 *  (its AbortSignal's reason; run/cancel's is the platform's own). */
const ENTRY_MOVED = 'entry-moved';

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
  /** How long an armed Submit's sign is still watched for, quietly, after that wait (SUBMIT_WATCH_MS by default, from
   *  the press; tests pass less). */
  submitWatchMs?: number;
  /** The addresses of the frame's ancestors it may read (address.ts readableAncestors over its window by default;
   *  tests serve fixtures in frames of the test page, whose own address is no posting's). */
  ancestors?: () => readonly string[];
  // ── snapshot build 2026-11-06 (core-x) ──
  /** The wrapper this subframe is the application frame of, when it is one (core-x item 3, claimsApplication: its
   *  parent is the top frame, of its own origin, whose adapter names this frame its application frame): the wrapper's
   *  document and address. Read from the window by default; tests stand in for the top frame. */
  wrapper?: () => { doc: Document; href: string; frame: Element | null } | null;
  /** The browser's referrer for this document (document.referrer by default): a top chain page names its hash
   *  (core-x items 7 and 14). */
  referrer?: () => string;
  /** v5 p1-shell: where the sidebar's bundle leaves its entry (the isolated world's global by default; tests stand one
   *  in). */
  sidebarWorld?: object;
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
  /** What the browser bringing the document back from the back/forward cache does (its trusted pageshow with persisted
   *  set, which a test cannot make). */
  restored(): Promise<void>;
}

/** The first adapter whose detect() finds a form root, with that root. The behaviour review of 2026-11-06 (M3): an
 *  adapter of the address other than the generic one (adaptersFor: the platform's own, which matches the address) that
 *  finds no root but reads a page state (authState: ClearCompany's account step, fixtures/clearcompany/vafb-account;
 *  Jobvite's Data Consent, jobvite/ninjaone-consent) holds the page: its state's rules decide, and a state with no
 *  root of its own is no form, so none is (adapters/configured/types.ts PageState.root). The generic adapter never takes
 *  it: an account's boxes are never filled from the profile, and an entry choice stays the agent's entry door's. */
function pickAdapter(doc: Document, url: URL, adapters: (url: URL) => Adapter[]): { adapter: Adapter; root: Element } | null {
  for (const adapter of adapters(url)) {
    try {
      const found = adapter.detect(doc);
      if (found !== null) return { adapter, root: found.formRoot };
      if (adapter.id !== 'generic' && (adapter.authState?.(doc) ?? null) !== null) return null;
    } catch {
      // An adapter that fails on this page gives way to the next.
    }
  }
  return null;
}

/** jr6 apply F2: an address's own adapters, the generic one left out (it claims any page with a visible control). */
function ownAdapters(adapters: readonly Adapter[]): Adapter[] {
  return adapters.filter((adapter) => adapter.id !== 'generic');
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

/** A runtime that does nothing at all (S-9's silent frame): no listener, no hello, no UI, no run. */
function silentRuntime(): ContentRuntime {
  return { ui: null, run: null, page: null, frameId: null, fill: () => null, stopped: true, stop: () => undefined,
    restored: () => Promise.resolve() };
}

/** Starts the content runtime in `doc`. Resolves once the frame has said hello and its UI is mounted. */
export async function startContentRuntime(platform: ContentPlatform, doc: Document, options: RuntimeOptions = {}):
  Promise<ContentRuntime> {
  log('content.started');
  const view = doc.defaultView;
  const lifetime = new AbortController();
  const readHref = options.href ?? (() => doc.location.href);
  // The P2 review (security 1): the document too, whose own markup an employer's own domain's Oracle page needs.
  const adapters = options.adapters ?? ((url: URL) => adaptersFor(url, doc));
  const isTop = options.isTop ?? (view !== null && view.top === view);
  // The audit of 2026-11-06 (S-9): a frame on a domain that also holds an employer's own pages, below a page of its own
  // origin that is no posting's (an HR page framing a posting-looking address to learn whether the extension is
  // there), says nothing and installs nothing, as the page-world bridge does not install there: decided once, from the
  // address the document was loaded at and the ancestors it can read now.
  if (!isTop && framedByEmployerPage(options.href === undefined ? loadedHref(view) ?? readHref() : readHref(),
    options.ancestors?.() ?? readableAncestors(view))) {
    return silentRuntime();
  }
  let stopped = false;
  let ui: PageUi | null = null;
  let page: RunPage | null = null;
  let app: ApplicationRef | null = null;
  /** v1.3 B: the form's questions and answers, step by step, memory only (form-capture.ts). */
  const formCapture = createFormCapture();
  let current: FillRun | null = null;
  let frameId: number | null = null;
  /** The hasForm the worker was last told. */
  let told: boolean | null = null;
  /** How many times a single-page application changed this document's address (v2): frame/hello carries it, so the
   *  worker reads the side panel's job card again for the posting the frame shows now. A count, never the address. */
  let nav = 0;
  /** Where the person wants the panel (v5: the sidebar on the page, or the browser's side panel): frame/hello's
   *  settings, then each settings/changed. */
  let placement: PanelPlace = 'page';
  /** v5 p1-shell: whether the sidebar opens by itself (Expanded) or shows its launcher (Minimized). */
  let panelView: PanelView = 'expanded';
  /** v5 p1-shell: the sidebar opened by itself in this document once already: it never does again here. */
  let autoOpened = false;
  /** v5 p1-shell (the review's S1): a hidden tab's sidebar waits for the tab to be shown before it opens by itself. */
  let waitingToShow = false;
  /** v5 p1-shell: the tab the worker named at sidebar/load (null until the bundle ran here). */
  let sidebarTab: number | null = null;
  /** v5 p1-shell: a sidebar on its way (the bundle being loaded). */
  let sidebarOpening = false;
  /** Sign-in mode as it acts (v3 Phase 5): frame/hello's settings, then each settings/changed. */
  let signInMode: 'manual' | 'auto' = 'manual';
  /** jr6: a job-site password is saved and may be typed (ContentSettings.typeSignIn): frame/hello's, then each
   *  settings/changed. */
  let signInTypes = false;
  /** s2 profile (settings version 7): how long the page's toasts stay: frame/hello's settings, then each
   *  settings/changed; until closed until the worker says. */
  let notificationTime: NotificationTime = 'until-closed';
  /** The launcher's place and hiding for this site (v3 Phase 3): frame/hello's answer, then launcher/prefs. */
  let launcherPrefs: LauncherPrefs = { top: null, hidden: false };
  /** The browser's side panel shows this tab (panel/side): the launcher's tab hides meanwhile. */
  let sideOpen = false;
  let lastRows = new Map<FieldKey, FillResult>();
  // ── snapshot build 2026-11-06 (core-x, items 3, 7 and 14) ──
  /** This subframe claims the tab's application for its wrapper (chain-frame.ts claimsApplication), read with the page. */
  let claimed = false;
  /** The application key the worker's chain gave this document (background/chain.ts), and the family it holds for. */
  let chained: { applicationKey: string; family: string } | null = null;
  /** What this document's hello names of its chain: a top chain page's referrer hash, or that a subframe is a chain
   *  page (the security fix of 2026-11-06, S4: the worker keys it from its frame registry; no message to any page). */
  let chainHello: { from: string } | { frame: true } | null = null;

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
    formCapture.clear();
    // v1.5 X: a documents' dialog this script showed goes with it (its controls would reach no worker).
    if (isTop) documentDialogShown(doc)?.remove();
  }

  // ── v1.3 B: the form's questions and answers (form-capture.ts) ──
  /** The step the page shows now, read into the capture (it replaces what that step held). Never throws. */
  function captureNow(): void {
    const on = stopped ? null : pageNow();
    if (on === null || app === null || on.app.applicationKey !== app.applicationKey) return;
    try {
      const canaries = current?.canariesNow() ?? [];
      formCapture.note(app.applicationKey, stepNameOf(on.adapter, doc),
        (step) => captureStep(scanPage(on), step, canaries));
    } catch {
      log('content.capture-failed');
    }
  }

  /** The posting as the top frame's page shows it: the names its title gives, and its visible text outside the form;
   *  none in a frame inside another page, or when the title names no company and job. */
  function postingNow(on: RunPage): CapturedPosting | null {
    if (!isTop || doc.body === null) return null;
    const names = postingNamesOf(doc, on.app.platform);
    if (names === null) return null;
    let description = '';
    try {
      description = visibleTextWithout(doc.body, [on.root], { cap: MAX_POSTING_TEXT }).trim();
    } catch {
      description = '';
    }
    return description === '' ? null : { title: names.title.slice(0, 300), company: names.company.slice(0, 200),
      description: [...description].slice(0, MAX_POSTING_TEXT).join('') };
  }

  /** An armed Submit's form, handed to the worker at once (the page may leave as it sends): the step shown now, read
   *  first, then every step's. The worker keeps it for the arm alone. */
  function sendForm(applicationKey: string): void {
    if (app !== null && app.applicationKey === applicationKey) captureNow();
    const fields = formCapture.all(applicationKey);
    if (fields.length === 0) return;
    const on = pageNow();
    const posting = on === null ? null : postingNow(on);
    void channel.request({ v: 1, type: 'submit/form', applicationKey, fields,
      ...(posting === null ? {} : { posting }) }).catch(() => undefined);
  }
  // ── end v1.3 B ──

  /** v3 Phase 8: the worker injected this document's script (a company's own page: the static content script runs on
   *  the ATS hosts alone), read once from the address the document was loaded at. */
  const injectedHere = isCompanySiteUrl(options.href === undefined ? loadedHref(view) ?? readHref() : readHref());
  /** v5 p2-detect: whether this document asked the worker for the submit watcher (resolvePage). */
  let watchAsked = false;

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
        // The security fix of 2026-11-06 (S4): a chain subframe the worker could not key yet (its portal frame said
        // hello after it) says hello again when the worker's sweep asks, once another frame of the tab said hello.
        if (chainHello !== null && 'frame' in chainHello && chained === null && !stopped) void hello().catch(() => undefined);
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
        // v4: a page that shows an account wall or a choice of how to apply, with no form (atWall); else a run, which
        // Sign up & Autofill (msg.signIn) lets sign in at its wall as Sign-in mode Auto would.
        if (page === null) {
          void atWall(msg.signIn === true, msg.dryRun).catch(() => undefined);
          return ok({});
        }
        // The v4 review (behaviour H1): a fill (not a dry run) that reaches a run resting where the launcher offers
        // Continue (a page turned under "Autofill after page turn: Manually", a pause) continues that run, its RunState,
        // canaries, step attempts and what it carries kept, as the launcher's Continue does; never a fresh run.
        if (!msg.dryRun && continueRun('panel', msg.signIn === true, true)) return ok({});
        startRun({ trigger: 'panel', dryRun: msg.dryRun, ...(msg.signIn === true ? { signIn: true } : {}) });
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
        panelView = msg.settings.view;
        placementChanged(msg.settings.panel);
        signInMode = msg.settings.modes.signIn;
        signInTypes = msg.settings.typeSignIn === true;
        // The jr6 review (sec-8): no saved password may be typed any more (it was deleted): none typed for the person's
        // press stays in this document.
        if (!signInTypes) dropKeptSignIns(doc);
        notificationsChanged(msg.settings.modes.notifications);
        return ok({});
      case 'run/policyDecision':
        // v4 (D6): no run waits at a policy card any more.
        return refuse('expired');
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
        // A form of ours, or (v3 Phase 3b) a recognised posting page with no form, whose card the worker reads; jr6
        // apply F2 item 7 (apply-b-new-2): or a page with no form that told the worker it offers its own Apply (ADP's
        // job details at its guest page's address), whose card the worker loads (F3a); the line P review (P-1): and
        // keeps loading while that address shows the panes on the way (entrySaid), as the worker's card frame stays.
        return stopped ? refuse('expired') : relayJob(channel, msg.action, page !== null || app?.page === 'posting'
          || (page === null && (entrySaid || wallTold?.entry === true)));
      case 'run/skip':
        return current?.skipField(msg.fieldKey as FieldKey) === true ? ok({}) : refuse('expired');
      case 'plan/ready':
        // v5 p2-stream: the worker's alone: answers the run waits for came in, and its wait for the AI polls at once.
        if (!fromWorker(sender)) return refuse('bad_sender');
        return current?.aiReady(msg.runId, (msg.reviews ?? []) as FieldKey[]) === true ? ok({}) : refuse('expired');
      case 'launcher/prefs':
        launcherPrefs = msg.launcher;
        ui?.setLauncherPrefs(launcherPrefs, msg.shown === true);
        return ok({});
      case 'panel/side':
        sideOpen = msg.open;
        ui?.setSidePanel(sideOpen);
        return ok({});
      case 'applied/popup':
        // v5 p1-panel (PLAN decision 5): the worker's alone, once TailorIT recorded the tab's application: the top frame
        // shows "Application Submitted!" over the page while the tab is visible (ui/applied.ts).
        if (!fromWorker(sender)) return refuse('bad_sender');
        if (!isTop || stopped) return refuse('expired');
        showApplied(doc, { trackerUrl: `${__TAILORIT_ORIGIN__}/tracker` });
        return ok({});
      // ── v1.5 X (PLAN decisions 2 and 3): the documents' dialogs over the page (ui/document-dialog.ts) ──
      case 'preview/show': {
        // The worker's alone, to the top frame: the preview over the page, its document in a frame of the extension's
        // own preview page with the worker's grant. {shown: false} (a hidden tab, a modal refused): the worker opens
        // the full-window page instead.
        if (!fromWorker(sender)) return refuse('bad_sender');
        if (!isTop || stopped) return ok({ shown: false });
        const { tabId, grant, page: address } = msg;
        const shown = showPreviewDialog(doc, { kinds: msg.kinds, kind: msg.kind, names: msg.names,
          frameUrl: (kind) => `${address}?${new URLSearchParams({ tabId: String(tabId), kind, grant }).toString()}`,
          openTab: (kind) => {
            if (channel.valid()) channel.fire({ v: 1, type: 'preview/openTab', kind });
          } });
        log('content.document-dialog', { preview: true, shown: shown !== null });
        return ok({ shown: shown !== null });
      }
      case 'edit/confirm': {
        // The worker's alone, to the top frame: the confirm before Edit opens an uploaded resume's editable copy.
        if (!fromWorker(sender)) return refuse('bad_sender');
        if (!isTop || stopped) return ok({ shown: false });
        const { grant } = msg;
        const shown = showEditConfirm(doc, { onContinue: (skip) => {
          if (channel.valid()) channel.fire({ v: 1, type: 'edit/confirmed', grant, skip });
        } });
        log('content.document-dialog', { preview: false, shown: shown !== null });
        return ok({ shown: shown !== null });
      }
      // ── end v1.5 X ──
      case 'run/press':
        // The worker's alone (the review): an extension page's message never presses the page's Next or Submit; the
        // worker relays the side panel's only while the frame's report offers that button.
        if (!fromWorker(sender)) return refuse('bad_sender');
        return ok(await pressFor(msg.target, msg.confirmed));
      case 'sidebar/open': {
        // v5 p1-shell: the toolbar icon, from the worker alone: the sidebar opens on this page, if it is ours to draw.
        if (!fromWorker(sender)) return refuse('bad_sender');
        const opening = isTop && !stopped && placement === 'page';
        if (opening) void openSidebar('icon').catch(() => undefined);
        return ok({ opening });
      }
      case 'site/stop':
        // v3 Phase 8 (the review's P1/B8): the company career sites were turned off, or Chrome's permission taken back.
        // The worker's alone; a page the worker injected ends its run and removes its UI, a page on an ATS host carries
        // on as it was.
        if (!fromWorker(sender)) return refuse('bad_sender');
        if (injectedHere) {
          log('content.site-stopped');
          cancelRun();
          teardown('leaving');
        }
        return ok({});
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
  /** Says frame/hello; answers 'refused' when the worker refused this frame as a sender (it no longer knows it). */
  async function hello(): Promise<'refused' | null> {
    // The v3 Phase 6/7b review (S3): a document says hello only once its address shows a posting's page on its
    // platform's candidate host (applicationOf: a posting, its application or the page after submitting), the same
    // reading the page-world bridge installs by; one whose address never did stays silent (an employer's own pages on
    // an ATS domain, a board). One that said hello before says it again, so the worker hears its form go.
    if (app === null && told === null && chainHello === null) return null;
    // v3 Phase 8: on a company's own page (injected once the sentinel recognised it) nothing is said until the site
    // adapter claims an application form there, but by a top frame a job signal recognised (the review's B10): it says
    // a form-less hello, so the side panel shows its "No application form" strip. A page embedding an ATS says none:
    // the ATS's own frame does.
    if (app?.platform === 'site' && page === null && told === null && !siteJobPage()) return null;
    const hasForm = page !== null;
    const letter = hasForm && asksForLetter();
    const at = urlOf(readHref());
    const answer = await channel.request({ v: 1, type: 'frame/hello', isTop, hasForm, ...(nav === 0 ? {} : { nav }),
      ...(letter ? { letter: true as const } : {}),
      // core-x, items 3, 7 and 14 (chain-frame.ts, background/chain.ts).
      ...(isTop && page === null && wrapsApplication(doc, at, adapters) ? { wraps: true as const } : {}),
      ...(claimed ? { claimed: true as const } : {}),
      ...(chainHello !== null && chained === null ? { chain: chainHello } : {}) });
    if (!answer.ok) return answer.error === 'bad_sender' ? 'refused' : null;
    told = hasForm;
    frameId = answer.data.frameId;
    tookChain(answer.data.chained?.applicationKey);
    panelView = answer.data.settings.view;
    placementChanged(answer.data.settings.panel);
    signInMode = answer.data.settings.modes.signIn;
    signInTypes = answer.data.settings.typeSignIn === true;
    notificationsChanged(answer.data.settings.modes.notifications);
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
    // v5 p1-shell: a supported page shows the pill, and opens the sidebar by itself under Expanded.
    pageShownNow();
    autoOpen();
    return null;
  }

  /** core-x, items 7 and 14: the worker's answer to a hello. A chain page it keyed takes that application: the page is
   *  read again with it, and the worker told of its form. */
  function tookChain(applicationKey: string | undefined): void {
    const url = urlOf(readHref());
    const chainPage = url === null ? null : chainPageOf(url);
    if (applicationKey === undefined || chained !== null || chainPage === null || stopped) return;
    chained = { applicationKey, family: chainPage.family };
    log('content.chained');
    const before = page;
    resolvePage(readHref());
    if (page !== null && before === null) {
      mountUi();
      void hello().catch(() => undefined);
      void resumeStored().catch(() => undefined);
    }
  }

  /** Back from the back/forward cache (a trusted pageshow with persisted set): it says hello again (W1). A company's
   *  page the worker no longer knows (the career sites stopped while it was away, and site/stop reaches active
   *  documents alone) ends its run and removes its UI (round 2 of the Phase 8 review, M3). */
  async function restored(): Promise<void> {
    if (stopped) return;
    if ((await hello()) !== 'refused' || !injectedHere || stopped) return;
    log('content.site-stopped');
    cancelRun();
    teardown('leaving');
  }

  /** v3 Phase 8 (the review's B10): this top frame shows a company's job page by a job signal (its address a career
   *  site's, a career-site platform, a JobPosting), embedding no ATS. */
  function siteJobPage(): boolean {
    if (!isTop || embedsAts(doc)) return false;
    const url = urlOf(readHref());
    return url !== null && jobSignalOf(doc, url) !== null;
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
    /** The run was told that nothing came within SUBMIT_CONFIRM_MS (the audit's m10): the watch goes on quietly. */
    quiet: boolean;
    stopWatch(): void;
  }
  let armed: ArmedSubmit | null = null;
  /** The worker's answer to the latest submit/armed: a sign seen at once waits for it, so the worker holds the arm
   *  before it hears the sign. */
  let armedHeard: Promise<unknown> = Promise.resolve();

  /** An armed Submit's wait ends without a confirmation: the run no longer waits. `how`: the page refused it (its
   *  count), nothing came in SUBMIT_CONFIRM_MS, a newer press took its place, or SUBMIT_WATCH_MS passed. Nothing in
   *  SUBMIT_CONFIRM_MS tells the run so, but the watch goes on quietly until SUBMIT_WATCH_MS after the press (the
   *  audit's m10): a slow platform's sign still makes the application submitted, which the worker takes as long as the
   *  tab's arm holds (its SUBMIT_ARM_MS, the same ten minutes). */
  function endArm(record: ArmedSubmit, how: { refused: number } | 'unconfirmed' | 'replaced' | 'expired'): void {
    if (how === 'unconfirmed') {
      if (record.quiet) return;
      record.quiet = true;
      // The person's own click on the page is theirs to follow; a press of ours says it saw nothing.
      if (record.by !== 'page') current?.submitUnconfirmed();
      else current?.submitWatchEnded();
      return;
    }
    record.stopWatch();
    if (armed === record) armed = null;
    // A newer press took its place: that one's watch speaks for the run now. The quiet watch's end says nothing more.
    if (how === 'replaced' || how === 'expired') return;
    current?.submitRefused(how.refused);
  }

  /** A Submit of the application was pressed (module header): the worker is told, and the document watches for the
   *  platform's sign until SUBMIT_CONFIRM_MS (a press of ours that nothing confirms then leaves its notice), then
   *  quietly until SUBMIT_WATCH_MS (endArm), and for the page's refusal PRESS_REFUSAL_MS after the press (its errors,
   *  the fields its form marked, its failure message), which ends the wait at once. `runId`: the run that filled the
   *  form, when there is one. */
  function arm(by: SubmitPresser, runId?: string, before?: PressSnapshot): void {
    // What the page showed at the press: its click may have moved it since (a confirmation drawn in place, an address
    // the parser does not read), which is the sign this arm waits for.
    const at = before ?? (app === null || page === null ? null : { applicationKey: app.applicationKey,
      // The behaviour review of 2026-11-06 (M1): the signs shown at the press; one hidden then is new once shown.
      platform: app.platform, root: page.root, adapter: page.adapter, signs: shownSignsOf(doc, app.platform) });
    if (stopped || at === null || !channel.valid()) return;
    log('content.submit-armed', { page: by === 'page', panel: by === 'panel', auto: by === 'auto' });
    // The resume is named to the tracker only when the run's own upload row verified on this form.
    const resume = runId !== undefined && current !== null && current.begunAs === runId && current.resumeAttached();
    armedHeard = channel.request({ v: 1, type: 'submit/armed', applicationKey: at.applicationKey, by,
      ...(runId === undefined ? {} : { runId }), ...(resume ? { resume: true as const } : {}) }).catch(() => undefined);
    // v1.3 B: the form's questions and answers go with the arm (the worker sends them only once it is confirmed).
    sendForm(at.applicationKey);
    if (armed !== null) endArm(armed, 'replaced');
    const view = doc.defaultView;
    const watch = new AbortController();
    lifetime.signal.addEventListener('abort', () => watch.abort(), { once: true, signal: watch.signal });
    let cancelTimer: Cancel = () => undefined;
    let cancelWatch: Cancel = () => undefined;
    const observer = view === null ? null : new view.MutationObserver(() => check());
    const record: ArmedSubmit = { at: platform.now(), by, applicationKey: at.applicationKey, platform: at.platform,
      root: at.root, adapter: at.adapter, before: at.signs, quiet: false, stopWatch: () => {
        observer?.disconnect();
        cancelTimer();
        cancelWatch();
        watch.abort();
      } };
    armed = record;
    // ── v5 p2-detect: the network sign, once heard (netSeen), taken while the page shows no error. The P2 review
    // (security 1): on an employer's own domain (ownOracle: Oracle's Candidate Experience there, the page's own scripts
    // the employer's) the sign alone, which the page could dispatch itself, is never enough: the document must confirm it
    // too (oracleLeftForm: the app's shell still there, the Submit the press saw gone), read again at each change of the
    // page until the watch ends. On the platforms' own hosts the sign is read once, as it came. ──
    const ownOracle = injectedHere && at.platform === 'oracle';
    let netSeen = false;
    const netConfirmed = () => {
      if (!netSeen || armed !== record || stopped) return;
      if (refusalNow({ doc, adapter: at.adapter, root: at.root }) > 0) return;
      if (ownOracle && !oracleLeftForm(at.adapter, at.root)) return;
      record.stopWatch();
      armed = null;
      void detected('network', record);
    };
    // ── end v5 p2-detect ──
    const check = () => {
      if (armed !== record || stopped) return record.stopWatch();
      if (ownOracle) netConfirmed();
      if (armed !== record) return;
      if (newSuccessSign(doc, record.platform, record) === null) return;
      record.stopWatch();
      armed = null;
      void detected('success-message', record);
    };
    observer?.observe(doc.documentElement, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['class', 'style', 'hidden'] });
    const confirmMs = options.submitConfirmMs ?? SUBMIT_CONFIRM_MS;
    cancelTimer = startDeadline(confirmMs, () => {
      if (armed === record) endArm(record, 'unconfirmed');
    }, lifetime.signal);
    cancelWatch = startDeadline(Math.max(confirmMs, options.submitWatchMs ?? SUBMIT_WATCH_MS), () => {
      if (armed === record) endArm(record, 'expired');
    }, lifetime.signal);
    // The page's refusal, read PRESS_REFUSAL_MS after the press (the invalid events its form fires in the person's own
    // click are heard from now on).
    void refusalAfter({ doc, adapter: at.adapter, root: at.root }, watch.signal).then((count) => {
      if (armed === record && count > 0) endArm(record, { refused: count });
    });
    // ── v5 p2-detect: the platform's network sign (submitted.ts watchNetworkSigns: Workday's finalize, ClearCompany's
    // last answers and completed message, Oracle's CREATE then CONFIRM, SuccessFactors' applyJob taken), this Submit's
    // while it is armed and the page shows no error (netConfirmed above: and, on an employer's own domain, the
    // document's confirmation).
    watchNetworkSigns(doc, at.platform, watch.signal, () => {
      netSeen = true;
      netConfirmed();
    });
    // ── end v5 p2-detect ──
    check();
  }

  /** v5 p2-detect, the P2 review (security 1): the document's confirmation of a Submit on an employer's own domain's
   *  Oracle page: the app's shell is still there (dom/page-signals.ts oracleShellShown, all five Oracle fixtures' own
   *  markup) and the Submit the press saw (the adapter's submitButton, fixtures/oracle/hjf-apply-section.html's
   *  pagination button) is no longer one a person can see: the app has moved on from its form, as it does once the
   *  application is sent (a refused Submit keeps the form and shows its errors: hjf-after-submit.html). Oracle draws no
   *  message of its own after sending (Jobright reads Oracle's network alone: its oraclecloud-confirmed-application rule
   *  is network-only), so the form's leaving is the document's part. */
  function oracleLeftForm(adapter: Adapter, root: Element): boolean {
    return oracleShellShown(doc) && (adapter.submitButton?.(root) ?? null) === null;
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
    // v1.3 B: the person's own Next leaves the step: its questions and answers are read first.
    let next: HTMLElement | null = null;
    try {
      next = on.adapter.nextButton?.(on.root) ?? null;
    } catch {
      next = null;
    }
    if (next !== null && path.includes(next)) captureNow();
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

  /** The person's choice of panel: choosing the side panel closes this frame's in-page one, and (v5) the sidebar. */
  function placementChanged(next: PanelPlace): void {
    placement = next;
    if (next === 'side' && ui?.panel?.open === true) closePanel();
    if (next === 'side') closeSidebar();
  }

  // ── v5 p1-shell: the sidebar on the page (module header) ────────────────────────────────────────────────────────

  /** Whether the top frame shows a supported page: an address a platform's parser reads, never its page after
   *  submitting; a company's own page once its form or a job signal is found. */
  function supportedPage(): boolean {
    if (!isTop || stopped || app === null || app.page === 'confirmation') return false;
    return app.platform !== 'site' || page !== null || siteJobPage();
  }

  /** The pill shows on a supported page, with or without a form (the page UI made for it here when there is none). */
  function pageShownNow(): void {
    if (!isTop) return;
    const shown = supportedPage();
    if (shown && ui === null) makeUi(page?.root ?? null);
    ui?.setPageShown(shown);
  }

  /** Under "Default view: Expanded", the sidebar opens by itself once per document on a supported page, unless the
   *  person hid the launcher on this site or everywhere. The review's S1: never in a hidden tab; there it opens once the
   *  tab is shown (once), if it still may. */
  function autoOpen(): void {
    if (autoOpened || !isTop || placement !== 'page' || panelView !== 'expanded' || launcherPrefs.hidden
      || !supportedPage()) return;
    if (doc.visibilityState !== 'visible') {
      if (waitingToShow) return;
      waitingToShow = true;
      doc.addEventListener('visibilitychange', function shown() {
        if (doc.visibilityState !== 'visible') return;
        doc.removeEventListener('visibilitychange', shown);
        waitingToShow = false;
        autoOpen();
      }, { signal: lifetime.signal });
      return;
    }
    autoOpened = true;
    void openSidebar('auto').catch(() => undefined);
  }

  /** Opens the sidebar: its bundle asked of the worker the first time (sidebar/load), then mounted into the page UI's
   *  closed root. Answers whether it is open. */
  async function openSidebar(how: 'auto' | 'launcher' | 'icon'): Promise<boolean> {
    if (!isTop || stopped || placement !== 'page' || sidebarOpening || !channel.valid()) return false;
    if (ui === null) makeUi(page?.root ?? null);
    if (ui === null) return false;
    if (ui.sidebarOpen) return true;
    sidebarOpening = true;
    try {
      const views = await sidebarApp();
      if (views === null || sidebarTab === null || stopped || placement !== 'page' || ui === null) return false;
      // The review's S1: a sidebar that opened by itself asks for its job card as a page that loads does.
      const opened = ui.openSidebar(views, sidebarTab, how === 'auto');
      if (opened) log('sidebar.opened', { auto: how === 'auto', icon: how === 'icon' });
      return opened;
    } finally {
      sidebarOpening = false;
    }
  }

  /** The sidebar's bundle's entry in this document: asked of the worker the first time (sidebar/load, which also names
   *  the tab), null when it would not run it. */
  async function sidebarApp(): Promise<SidebarApp | null> {
    const world = options.sidebarWorld ?? globalThis;
    if (sidebarTab !== null && sidebarAppOf(world) !== null) return sidebarAppOf(world);
    const answer = await channel.request({ v: 1, type: 'sidebar/load' });
    if (!answer.ok) {
      log('sidebar.inject-refused', { content: true });
      return null;
    }
    sidebarTab = answer.data.tabId;
    return sidebarAppOf(world);
  }

  /** Folds the sidebar back to the pill (the views' minimise, or the side panel chosen). */
  function closeSidebar(): void {
    if (ui?.sidebarOpen !== true) return;
    ui.closeSidebar();
    log('sidebar.closed');
  }

  /** s2 profile: the toasts' time as the person set it now (ui/toasts.ts). */
  function notificationsChanged(next: NotificationTime): void {
    notificationTime = next;
    ui?.setNotificationTime(next);
  }

  /** Open review from the launcher's click: (v5) the sidebar in the top frame on the page; in a frame inside another
   *  page the in-page panel where the frame has room for it; else the side panel, which must be asked for inside the
   *  click (nothing awaited before it). */
  function openReview(): void {
    if (isTop && placement === 'page') {
      void openSidebar('launcher').catch(() => undefined);
      return;
    }
    // v5: the card's views come with the sidebar's bundle, run in this frame's document the first time.
    if (placement === 'page' && ui !== null && ui.panelFits()) {
      void openCard().catch(() => undefined);
      return;
    }
    if (placement === 'page') log('content.panel-collapsed');
    channel.fire({ v: 1, type: 'panel/open' });
  }

  /** v5 p1-shell: the in-page card of a frame inside another page, once its views are here (the sidebar's bundle). */
  async function openCard(): Promise<void> {
    if (ui === null || ui.panel?.open === true) return;
    if (sidebarAppOf(options.sidebarWorld ?? globalThis) === null && (await sidebarApp()) === null) return;
    if (ui?.openPanel() === true) channel.fire({ v: 1, type: 'panel/shown', open: true });
  }

  /** The in-page panel's Save my answer: the worker reads the answer back (answer/read) and sends it to TailorIT.
   *  Answers what came of it, in the panel's words. */
  async function saveFromPanel(key: FieldKey): Promise<string> {
    try {
      const answer = await channel.request({ v: 1, type: 'answer/save', fieldKey: key });
      return answer.ok ? PAGE_COPY.panel.saveOutcomes[answer.data.outcome] : PAGE_COPY.panel.saveFailed;
    } catch {
      return PAGE_COPY.panel.saveFailed;
    }
  }

  /** Closes the in-page panel, and tells the worker to stop sending it reports. */
  function closePanel(): void {
    if (ui?.panel?.open !== true) return;
    ui.closePanel();
    if (channel.valid()) channel.fire({ v: 1, type: 'panel/shown', open: false });
  }

  /** The frame's id, saying hello again first if the first one went unanswered. */
  async function ensureFrame(): Promise<{ frameId: number; isTop: boolean; claimed?: boolean }> {
    if (frameId === null) await hello();
    if (frameId === null) throw new RunFailure('unavailable');
    return { frameId, isTop, ...(claimed ? { claimed: true } : {}) };
  }

  /** How many runs began in this document (the behaviour review of 2026-11-06, minor 7: RunEnv.firstInDocument). */
  let runsBegun = 0;

  function startRun(request: RunRequest): FillRun | null {
    // The form root as the adapter finds it now: a run never starts on one the page replaced.
    const on = stopped ? null : pageNow();
    if (on === null || !channel.valid()) return null;
    if (current !== null && current.ended === null) return null;
    // A run that rests and watches the step (review, or the person's Next) gives way to the new one, and so does a
    // paused one (the audit's m13): its Sign-in Auto may still be typing or pressing, which must never go on beside a
    // new run of the frame (abort ends it, writing the password it typed empty again).
    if (current !== null && (current.watching || current.ended === 'paused')) current.abort();
    // v5 p2-fill (PLAN decision 14): the page patches in this document's page world, asked for once, as the first run
    // that writes begins (content/page-patches.ts); a write waits for that answer a moment at most.
    if (!request.dryRun) loadPagePatches(doc, () => channel.request({ v: 1, type: 'page/patches' }));
    const run = new FillRun({
      doc,
      content: platform,
      channel,
      limiter,
      ui: () => ui,
      frame: ensureFrame,
      firstInDocument: runsBegun === 0,
      // Without its launcher (the UI failed, or the page removed it for good) a frame cannot show it is seen: it fills
      // nothing inside another page.
      frameShown: (signal, fresh) => (ui === null ? Promise.resolve(false) : ui.launcherShown(signal, fresh)),
      page: on,
      now: () => platform.now(),
      options,
      onRows(rows) {
        lastRows = new Map(rows.map((row) => [row.key, row]));
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
      // v1.3 B: the run is about to press Next: the step's questions and answers are read first.
      stepLeaving: () => {
        if (current === run) captureNow();
      },
      beforePress: () => (app === null || page === null ? null : { applicationKey: app.applicationKey,
        platform: app.platform, root: page.root, adapter: page.adapter, signs: shownSignsOf(doc, app.platform) }),
      autoPressed,
      // v3 Phase 5, Sign-in mode Auto: once, on the page this run paused at, until the run stops or is cancelled; the
      // site taking it continues the run.
      // The jr6 review (sec-1): `page`, the document's own life, which guards a password left for the person's press.
      signIn: (signal, typeOnly) => signIn({ doc, adapter: on.adapter, channel, href: readHref, isTop, claimed,
        // jr6: Sign-in on Manual with a password saved: typed, the press the person's.
        ...(typeOnly === true ? { typeOnly: true as const } : {}),
        signal: AbortSignal.any([signal, lifetime.signal]), page: lifetime.signal }),
      // core-x, item 2: Sign-in Auto types into the form's account section, pressing nothing; jr6: on Manual too.
      signInSection: (signal, typeOnly) => signIn({ doc, adapter: on.adapter, channel, href: readHref, isTop, claimed,
        section: true, ...(typeOnly === true ? { typeOnly: true as const } : {}),
        signal: AbortSignal.any([signal, lifetime.signal]), page: lifetime.signal }),
      // Core pass Z1, item 24: Sign-in Auto presses the step's declared sign-in container once the run rests there.
      signInContainer: (signal) => signIn({ doc, adapter: on.adapter, channel, href: readHref, isTop, claimed,
        container: true, signal: AbortSignal.any([signal, lifetime.signal]), page: lifetime.signal }),
      afterSignIn: () => {
        if (current !== run) return;
        // v4: a pause that went carries the run on by itself, a bounded number of times in a document.
        if (autoContinues >= MAX_AUTO_CONTINUES) return;
        autoContinues += 1;
        continueRun(run.trigger);
      },
      // v4 (D7): at an entry choice, the adapter's declared entry ("Apply manually"), through the entry door.
      enterChoice: () => pressEntryChoice(doc, on.adapter),
      // v4 (D10): the no-sign-in toast's Open.
      openSignInSettings: () => openSignInSettings(),
    }, request);
    runsBegun += 1;
    current = run;
    lastRows = new Map();
    // v4: once the run first rests, the page's wall is looked at again (frame/wall).
    void run.start().then(() => lookForWall());
    return run;
  }

  /** v4: how many times a paused run of this document carried on by itself (MAX_AUTO_CONTINUES). */
  let autoContinues = 0;

  /** v4 (D10): the settings where the job-site sign-in is saved, inside the person's click on a toast's Open. jr6: the
   *  extension's own settings page at Sign-up Information (no page may open it itself: the worker does, as for the
   *  sidebar's link), TailorIT's Settings › Autofill before. */
  function openSignInSettings(): void {
    void channel.request({ v: 1, type: 'sidebar/options', section: SIGNUP_SECTION }).catch(() => undefined);
  }

  /** run/continue, or the launcher's Continue: a fresh run after a pause. It never answers the policy card: Continue
   *  goes to every frame that reported, and one waiting at the card must not fill as if Fill anyway was chosen. A dry
   *  run's Continue is a dry run too (the audit of 2026-11-06, M3): it never writes what the paused run only showed.
   *  The v4 review (behaviour H1): run/start (the side panel's Autofill, `fill`) continues a run that rests offering
   *  Continue too, but never a dry run's (a fill starts afresh there), with Sign up & Autofill as it asks now (`signUp`:
   *  a plain Autofill, which ends the tab's grant in the worker, continues without it). Answers whether a run was
   *  continued. */
  function continueRun(trigger: RunRequest['trigger'], signUp = false, fill = false): boolean {
    if (current === null || current.ended !== 'paused') return false;
    if (fill && current.request.dryRun) return false;
    const state = current.runState;
    const carry = current.carryOut(true);
    const { dryRun } = current.request;
    // v4: Sign up & Autofill holds for the run's Continue too; a fill says afresh whether it is one.
    const signIn = (fill ? signUp : current.request.signIn === true) ? { signIn: true } : {};
    return startRun(state === null ? { trigger, dryRun, carry, ...signIn }
      : { trigger, dryRun, from: { state, event: continueEventOf(state) }, carry, ...signIn }) !== null;
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
   *  before any form is signed in to with Sign-in mode Auto (sign-in.ts), else it blocks. jr6 apply F2 item 2 (AF-16):
   *  the person's entry and the agent's are one (enter); the agent's answer comes at its press, and the document is
   *  then watched for the form the press drew in place (B9). */
  async function enterForAgent(): Promise<EntryAnswer> {
    // core-x, item 3: the tab's top frame, or the frame that claims its wrapper's application.
    if (stopped || page !== null || (!isTop && !claimed)) return { outcome: 'not-offered' };
    return enter({ by: 'agent' });
  }

  /** run/cancel: stop a run that writes, or stop a paused one for good (C-S6). jr6 apply F2 item 2: and end an entry's
   *  waits (a press already made stays made; none is made after). */
  function cancelRun(): void {
    entryCancel?.abort();
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
      ...(current === null ? {} : { widgetReadings: current.widgetReadings, learnedLists: current.learnedLists,
        storedLists: current.storedLists }) });
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
  /** The application an address of this document reads as: its parser's; core-x, items 7 and 14: a chain page the
   *  worker keyed takes its application's key, while its address stays a chain page of the same family. jr6 apply F2
   *  (the line P review, revA-4): read alone too, for the application an entry under way belongs to. */
  function applicationAt(url: URL | null): ApplicationRef | null {
    const read = url === null ? null : applicationOf(url);
    const chainPage = url === null ? null : chainPageOf(url);
    if (chained !== null && chainPage !== null && chainPage.family === chained.family) {
      return { platform: chainPage.platform, page: 'application', applicationUrl: read?.applicationUrl ?? '',
        applicationKey: chained.applicationKey };
    }
    return read;
  }

  /** jr6 apply F2 item 2 (APPLYPLAN D5; AF-4, apply-c-new-1): `how.ownOnly`, only the address's own adapters may claim
   *  the page (never the generic one); `how.atPosting`, a posting's address too (after an entry press of ours, the form
   *  it drew in place is the posting's application), by those own adapters alone. */
  function resolvePage(href: string, how: { ownOnly?: boolean; atPosting?: boolean } = {}): void {
    const url = urlOf(href);
    app = applicationAt(url);
    // core-x, item 3: a subframe that draws its wrapper's application.
    claimed = !isTop && claimsApplication(app, options.wrapper !== undefined ? options.wrapper() : wrapperOf(view),
      adapters);
    // While the page's own adapter waits for a form it draws late, only the adapters that say so may claim the page.
    // jr6 apply F2 item 2: where asked, the address's own adapters alone; item 5 (D5; B4, C6): where an adapter of the
    // address draws its form in place (quirks.formInPlace), its own adapters alone for the document's life.
    const claim = (at: URL) => (how.ownOnly === true || inPlaceAt(at) ? ownAdapters(adapters(at))
      : lateClosed === href ? adapters(at) : lateAdapters(adapters(at)));
    // jr6 apply F2 item 2: a posting's address too, when asked, by its own adapters alone; item 5 (D5; B5): and by an
    // adapter that draws its application at its posting's address (quirks.formAtPosting: Workday's /apply), that one
    // alone, the address still read as the posting's for its key and its choice.
    const atPosting = app !== null && app.page === 'posting' && url !== null
      && (how.atPosting === true || formAtPostingAt(url));
    const postingClaim = (at: URL) => (how.atPosting === true ? ownAdapters(claim(at))
      : claim(at).filter((adapter) => adapter.quirks?.formAtPosting === true));
    const picked = url !== null && app !== null && (app.page === 'application' || atPosting)
      ? pickAdapter(doc, url, atPosting ? postingClaim : claim) : null;
    page = picked === null || app === null ? null : { app, adapter: picked.adapter, root: picked.root };
    // ── v5 p2-detect, the P2 review (security 1): on an employer's own domain the Oracle adapter claims a page only where
    // the document shows the app's own markup (adapters/index.ts adaptersFor) and its detect found the app's form; only
    // then, once per document, is the worker asked for the page-world submit watcher here (background/sites.ts watch). ──
    if (page !== null && page.adapter.id === 'oracle' && injectedHere && !watchAsked && !stopped) {
      watchAsked = true;
      void channel.request({ v: 1, type: 'site/watch' }).catch(() => undefined);
    }
  }

  /** jr6 apply F2 item 5 (D5; B5): an adapter of the address draws its application at its posting's address. */
  function formAtPostingAt(url: URL): boolean {
    return adapters(url).some((adapter) => adapter.quirks?.formAtPosting === true);
  }

  /** jr6 apply F2 item 5 (D5; B4, C6): an adapter of the address draws its application in place, at any time. */
  function inPlaceAt(url: URL): boolean {
    return adapters(url).some((adapter) => adapter.quirks?.formInPlace === true);
  }

  /** jr6 apply F2 item 5: an address whose page may still draw its application: an application's, or (formAtPosting)
   *  a posting's whose adapter draws it there. */
  function formMayShowAt(href: string): boolean {
    if (app === null) return false;
    if (app.page === 'application') return true;
    const url = urlOf(href);
    return app.page === 'posting' && url !== null && formAtPostingAt(url);
  }

  /** An application page whose adapters found no form root (core pass Z2 of 2026-11-06: the first scan's entrance
   *  wait). jr6 apply F2 item 5: or a posting's page whose adapter draws its application there (formAtPosting). */
  function noFormYet(): boolean {
    return page === null && formMayShowAt(readHref());
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
   *  (onAddress starts the next one). jr6 apply F2 item 5 (D5): a posting's page too whose adapter draws its
   *  application there (formAtPosting, B5); and where an adapter draws its application in place at any time
   *  (formInPlace, B4, C6), the document is watched for it for its life, cheaply, as a company's page is, its own
   *  adapters alone claiming it. */
  function watchLateForm(): void {
    lateWatch?.();
    lateWatch = null;
    const href = readHref();
    if (stopped || page !== null || app === null || !formMayShowAt(href)) return;
    // v3 Phase 8 (the review's B5): a company's own page is watched for its form for the document's life, cheaply.
    // jr6 apply F2 item 5: so is a page whose platform draws its application in place (formInPlace).
    const url = urlOf(href);
    if (app.platform === 'site' || (url !== null && inPlaceAt(url))) {
      lateWatch = watchForSiteForm(doc, () => {
        // jr6 apply F2: a form another watch claimed meanwhile (an entry's) ends this one.
        if (stopped || readHref() !== href || page !== null) return true;
        resolvePage(href);
        if (page === null) return false;
        formFound();
        return true;
      }, lifetime.signal);
      return;
    }
    const capMs = url === null ? 0 : lateFormMs(adapters(url));
    if (capMs === 0) return;
    lateWatch = watchForLateForm(doc, capMs, () => {
      // jr6 apply F2: a form another watch claimed meanwhile (an entry's) ends this one.
      if (stopped || readHref() !== href || page !== null) return true;
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
      // v5: a supported page with no form shows the pill too.
      pageShownNow();
      return;
    }
    makeUi(page.root);
    pageShownNow();
  }

  /** v4: the page UI with no form to anchor to (a wall's toasts: atWall), made once. */
  function wallUi(): PageUi | null {
    if (ui === null) makeUi(null);
    return ui;
  }

  /** Mounts the page UI, anchored to `root` (none: only the toasts show, the launcher's tab stays hidden). */
  function makeUi(root: Element | null): void {
    try {
      ui = mountPageUi(doc, {
        onLauncher(action) {
          if (!channel.valid()) return;
          // v5 p1-shell (PLAN decision 2): the top frame's pill opens the panel whatever the run's state.
          if (isTop) {
            openReview();
            return;
          }
          // Open review goes out at once, inside the click: the browser then still counts it as the person's gesture.
          if (action === 'open-review') openReview();
          else if (action === 'continue') continueRun('launcher');
          else startRun({ trigger: 'launcher', dryRun: false });
        },
        // Edit with AI (the owner's amendments): the current run rewrites that field, if it may now.
        onAiEdit(key, instruction) {
          if (!channel.valid() || current === null) return Promise.resolve(PAGE_COPY.aiEdit.outcomes.refused);
          return current.rewrite(key as FieldKey, instruction).then((outcome) => (outcome === 'rewritten' ? null
            : PAGE_COPY.aiEdit.outcomes[outcome]), () => PAGE_COPY.aiEdit.outcomes.failed);
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
        // v5 p1-shell: the sidebar's frame, in the top frame: its views' minimise, and their link to the settings page.
        ...(isTop ? { sidebar: {
          minimised: () => closeSidebar(),
          options: (section: string | undefined) => {
            if (channel.valid()) channel.fire({ v: 1, type: 'sidebar/options', ...(section === undefined ? {} : { section }) });
          },
          // The review's S6 and S7: Chrome's side panel, for what the sidebar leaves to it; asked inside the click.
          sidePanel: () => {
            if (channel.valid()) channel.fire({ v: 1, type: 'panel/open' });
          },
          ownId: platform.runtime.id,
        } } : {}),
        panel: {
          frameId: () => frameId,
          // v5 p1-shell: the card's views, once the sidebar's bundle ran in this document.
          card: () => sidebarAppOf(options.sidebarWorld ?? globalThis)?.card ?? null,
          showField: (key) => focusField(key as FieldKey),
          describeField: async (key) => describeField(key as FieldKey).options,
          // Phase 6, wave 2: this frame's draft, confirmed here; its answer, saved through the worker.
          confirmDraft: async (key) => ((await current?.confirmDraft(key as FieldKey)) === true
            ? PAGE_COPY.panel.draftConfirmed : PAGE_COPY.panel.confirmFailed),
          saveAnswer: async (key) => saveFromPanel(key as FieldKey),
          closed: () => closePanel(),
          // v3 Phase 4: the dock's Next and Submit, for this frame's own run.
          press: (target, confirmed) => pressFor(target, confirmed),
        },
      });
      ui.anchorTo(root);
      ui.setLauncher({ state: 'idle', action: 'fill' });
      ui.setLauncherPrefs(launcherPrefs);
      ui.setSidePanel(sideOpen);
      ui.setNotificationTime(notificationTime);
    } catch {
      // Without its UI the top frame still fills from the side panel's Fill; a frame inside another page cannot show
      // its launcher is seen there, so it fills nothing (FillRun's frame check, S1).
      ui = null;
    }
  }

  // ── v4: the page's account wall, and Sign up & Autofill at a wall with no form (module header) ──────────────────

  /** What this frame last told the worker of its wall (undefined: nothing yet); s2 profile (P1), what it waits for;
   *  v5 p2-fill, whether its page's own Apply is offered; jr6 apply F2, why its last entry was refused and whether one
   *  is under way. */
  let wallTold: { wall: SignInWall | null; choice: boolean; waits: WallWaits | null; entry: boolean;
    refused?: EntryRefusal | null; entering?: boolean } | undefined;
  /** v5 p2-fill review (L5), jr6 apply F2 item 2 (AF-12): why the person's last Autofill on a page with no form could
   *  not press the page's own Apply or follow it to a form (ENTRY_REFUSALS: none showed or came, what shows is the
   *  person's, a new tab, another site, nothing followed the press): the panel says it until the next press. */
  let refusal: EntryRefusal | null = null;
  /** jr6 apply F2 item 2 (apply-flow-new-4): the entry under way, one at a time (its answer, which the agent's
   *  agent/enter waits for); null: none. frame/wall says `entering` meanwhile. */
  let entering: Promise<EntryAnswer> | null = null;
  /** jr6 apply F2 item 2: ends the entry's waits (run/cancel). */
  let entryCancel: AbortController | null = null;
  /** jr6 apply F2 (the line P review, revA-4): the application key the entry under way started at (null: an address
   *  that read none): a route of the page's own to another one ends the entry (onAddress). */
  let entryKey: string | null = null;
  /** jr6 apply F2 (the line P review, P-1; apply-b-new-2): this document told `entry` at its current address
   *  (frame/wall). The worker keeps its top frame as the tab's card frame from then on (background/frames.ts entrySaid,
   *  cardFrameOf), through the panes and the guest view drawn in place at that address (ADP's Consent & Continue and
   *  code choice, which offer no entry while they show), so the card's job/refresh is relayed there; a route of the
   *  page's own ends it (onAddress), as a hello at another address ends the worker's. */
  let entrySaid = false;
  /** The toast a wall with no form shows (atWall), while its cause stands; null: none. */
  let wallToast: 'sign-in' | 'no-sign-in' | 'challenge' | null = null;
  /** s2 profile (P1): what that toast says the page waits for (WALL_WAITS), told the worker with the wall (tellWall) so
   *  the side panel can say it when the toasts are not shown until closed; null: nothing. */
  let wallWaits: WallWaits | null = null;
  /** A look at the page for its wall waits for its time (lookForWall). */
  let wallLooking = false;

  /** The account wall the page shows now (a sign-in, an account's creation, an email gate: the pause detection with
   *  the page's adapter, or the address's own where there is no form), and whether it shows a choice of how to apply
   *  its adapter answers with a declared entry. Only the tab's top frame, or the frame that claims its application. */
  function wallNow(): { wall: SignInWall | null; choice: boolean; challenge: boolean; entry: boolean } {
    const none = { wall: null, choice: false, challenge: false, entry: false };
    if (stopped || (!isTop && !claimed) || app === null) return none;
    const at = urlOf(readHref());
    const adapter = page?.adapter ?? (at === null ? null : adapters(at)[0] ?? null);
    let shown: ReturnType<typeof detectPause>;
    try {
      shown = detectPause(doc, page?.root ?? null, adapter, newScanCache());
    } catch {
      return none;
    }
    // v5 p2-fill: no wall: a page with no form may offer its own Apply (pressed by the panel's Autofill: atWall).
    if (shown === null) return { ...none, entry: entryOffered() };
    const wall = (SIGN_IN_WALLS as readonly string[]).includes(shown.kind) ? shown.kind as SignInWall : null;
    return { wall, choice: shown.kind === 'entry-choice' && adapter?.entryControl !== undefined,
      challenge: shown.kind === 'captcha' || shown.kind === 'email-code', entry: false };
  }

  // -- v5 p2-fill: Autofill on a posting page (PLAN Phase 2: the panel's main button presses the site's own Apply) --
  /** Whether this frame shows a page with no form whose address's own adapters offer their own Apply now
   *  (Adapter.entryControl, each written from its platform's fixtures: Greenhouse's and Lever's Apply, Ashby's
   *  Application tab, iCIMS's, Oracle's, SmartRecruiters', SuccessFactors', Taleo's, Workable's, Workday's and the
   *  configured platforms' declared entries), a control a person can see: the panel's main button (Autofill) then says
   *  it presses that Apply first, and its press is atWall's (enter).
   *  jr6 apply F2 item 1 (APPLYPLAN D6; B2, apply-flow-new-1, C6): any address of a posting the parser reads but its
   *  page after submitting, an application address included (ADP's job details at its guest page's address, Workable's
   *  job site before its dialog opens), and only an address's own adapter (never the generic one) offers it. The
   *  verifier's survey of every committed fixture at an application address with no form, no state and no generic
   *  control found none that offers one (jr6-broad-gate.browser.test.ts). */
  function entryOffered(): boolean {
    // jr6 apply F2 item 1: a posting's or an application's address, never its confirmation.
    if (page !== null || app === null || app.page === 'confirmation') return false;
    const at = urlOf(readHref());
    if (at === null) return false;
    const cache = newScanCache();
    return adapters(at).some((adapter) => {
      // jr6 apply F2 item 1: the address's own adapters alone.
      if (adapter.id === 'generic') return false;
      try {
        const control = adapter.entryControl?.(doc) ?? null;
        return control !== null && isUserVisible(control, cache);
      } catch {
        return false;
      }
    });
  }
  // -- end v5 p2-fill --

  /** Tells the worker the wall the page shows now (frame/wall), when it changed since it was last told; never while a
   *  run of this frame works (its own pause says it, and its writes change the page all along). */
  function tellWall(): void {
    if (stopped || told === null || frameId === null || !channel.valid()) return;
    if (current !== null && current.ended === null) return;
    const now = wallNow();
    // A wall with no form keeps its toast while its cause stands: a check its sign-in brought, or the wall itself.
    if (wallToast !== null && page === null) {
      const next = now.challenge ? 'challenge' : now.wall !== null && wallToast !== 'challenge' ? wallToast : null;
      if (next !== wallToast) {
        wallToast = next;
        wallWaits = next === 'challenge' ? 'challenge' : next === null ? null : wallWaits;
        if (next === 'challenge') wallUi()?.setToasts([{ kind: 'challenge', text: PAGE_COPY.toasts.challenge }]);
        else if (next === null) ui?.setToasts([]);
      }
    }
    sendWall(now);
  }

  /** frame/wall, when the wall, its choice or (s2 profile, P1) what the page waits for changed since the worker was
   *  last told. */
  function sendWall(now: { wall: SignInWall | null; choice: boolean; entry?: boolean }): void {
    if (stopped || told === null || frameId === null || !channel.valid()) return;
    const waits = page === null ? wallWaits : null;
    // v5 p2-fill: whether the page's own Apply is offered is told too; v5 p2-fill review (L5): and whether its last
    // press was refused, while no wall or choice shows (one that does says what is left); jr6 apply F2 item 2 (AF-12):
    // with why (a refusal only ever beside entryRefused: the contract's rule), and (apply-flow-new-4) whether an entry
    // is under way.
    const entry = now.entry === true;
    const refused = refusal !== null && now.wall === null && !now.choice ? refusal : null;
    const isEntering = entering !== null;
    if (wallTold !== undefined && wallTold.wall === now.wall && wallTold.choice === now.choice
      && wallTold.waits === waits && wallTold.entry === entry && (wallTold.refused ?? null) === refused
      && (wallTold.entering ?? false) === isEntering) return;
    // A first word of "no wall" is the registry's own default: nothing to say.
    if (wallTold === undefined && now.wall === null && !now.choice && waits === null && !entry && refused === null
      && !isEntering) {
      wallTold = { wall: now.wall, choice: now.choice, waits, entry, refused, entering: isEntering };
      return;
    }
    wallTold = { wall: now.wall, choice: now.choice, waits, entry, refused, entering: isEntering };
    // The line P review (P-1): the worker keeps this frame as the tab's card frame from now on (entrySaid).
    if (entry) entrySaid = true;
    log('content.wall', { shown: now.wall !== null, choice: now.choice, waits: waits !== null, entry,
      refused: refused !== null, entering: isEntering });
    void channel.request({ v: 1, type: 'frame/wall', wall: now.wall, ...(now.choice ? { choice: true as const } : {}),
      ...(waits === null ? {} : { waits }), ...(entry ? { entry: true as const } : {}),
      ...(refused === null ? {} : { entryRefused: true as const, refusal: refused }),
      ...(isEntering ? { entering: true as const } : {}) }).catch(() => undefined);
  }

  /** A look at the page for its wall, WALL_LOOK_MS from now: the changes of a moment are read once. */
  function lookForWall(): void {
    if (wallLooking || stopped) return;
    wallLooking = true;
    void deadline(WALL_LOOK_MS, lifetime.signal).then(() => {
      wallLooking = false;
      tellWall();
    });
  }

  /** The page's wall, watched for the document's life: a look at each DOM change, coalesced (lookForWall). */
  function watchWall(): void {
    if (view === null || stopped || (!isTop && !claimed)) return;
    const observer = new view.MutationObserver(() => lookForWall());
    observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'type'] });
    lifetime.signal.addEventListener('abort', () => observer.disconnect(), { once: true });
    lookForWall();
  }

  /** A toast of the wall's (no run holds it): what is left for the person there (D10), until its cause goes
   *  (tellWall). The v4 review (M5): the one to add a job-site sign-in in TailorIT for 'none-saved' alone (the worker
   *  holds none for the page); the sign-in to make on the page for any other sign-in the run could not make. */
  function showWallToast(said: 'sign-in' | 'failed' | 'none-saved' | 'challenge' | 'typed'): void {
    const words = PAGE_COPY.toasts;
    const toast: ToastSpec = said === 'challenge' ? { kind: 'challenge', text: words.challenge }
      : said === 'none-saved'
        ? { kind: 'no-sign-in', text: words.noSignIn, action: { label: words.open, run: () => openSignInSettings() } }
        : { kind: 'sign-in', text: said === 'failed' ? words.signInFailed : said === 'typed' ? words.signInTyped
          : words.signIn };
    wallToast = toast.kind === 'challenge' ? 'challenge' : toast.kind === 'no-sign-in' ? 'no-sign-in' : 'sign-in';
    // The jr6 review (R11): typed on Manual, the side panel says so too ('sign-in-typed').
    wallWaits = said === 'failed' ? 'sign-in-failed' : said === 'none-saved' ? 'no-sign-in'
      : said === 'typed' ? 'sign-in-typed' : said;
    wallUi()?.setToasts([toast]);
    // s2 profile (P1): the worker hears what the page waits for, for the side panel (the wall as last read; the toast
    // itself is tellWall's to take away, at the page's next change).
    sendWall(wallTold ?? { wall: null, choice: false });
  }

  /**
   * v4: run/start at a page with no form (module header). Only the tab's top frame, or the frame that claims its
   * application. A choice of how to apply is answered with the adapter's declared entry (its Apply Manually: press.ts
   * pressEntry, the agent's door, every guard held); a wall is signed in to under Sign up & Autofill (`signUp`) or
   * Sign-in mode Auto (sign-in.ts: the worker answers the credential for this tab alone), else its toast says to sign in
   * here or use Sign up & Autofill. With no job-site sign-in to use, the toast says to add one. A page that shows a form
   * after it fills as usual: this document's (formAfterWall), or the next one's (the worker starts its run).
   * jr6 apply F2 item 2 (APPLYPLAN D2, D3; AF-2, AF-3, AF-12, apply-c-new-1, apply-flow-new-4): one at a time (a
   * run/start while an entry presses or waits makes no second press); the page read again first (lookAgain: a form
   * drawn since the last look, by the person's own Apply or in place, is filled now, the run started here, a dry run's
   * too); then, a page that shows no wall: its own Apply, or its choice of how to apply, through enter, whatever the
   * frame told before (Autofill is always offered: the frame waits for a late Apply, presses it, or says why not); a
   * wall: the sign-in step (wallStep); a check or a code: refused 'blocked' (the person's). Never a press in a dry run.
   */
  async function atWall(signUp: boolean, dryRun: boolean): Promise<void> {
    const at = urlOf(readHref());
    if (stopped || at === null || (!isTop && !claimed)) return;
    if (entering !== null) return;
    if (lookAgain()) {
      startRun({ trigger: 'panel', dryRun, ...(signUp ? { signIn: true } : {}) });
      return;
    }
    if (page !== null || dryRun) return;
    const own = adapters(at);
    if (own.length === 0) return;
    const shown = detectPause(doc, null, own[0]!);
    if (shown === null || shown.kind === 'entry-choice') {
      await enter({ by: 'person', signUp });
      return;
    }
    if ((SIGN_IN_WALLS as readonly string[]).includes(shown.kind)) {
      await wallStep(shown.kind as SignInWall, signUp);
      return;
    }
    // A check or a code before any press: the person's (AF-12).
    refusal = 'blocked';
    log('content.entry', { refusal: ENTRY_REFUSALS.indexOf('blocked'), presses: 0 });
    sendWall(wallNow());
  }

  /** v4, the wall branch of atWall: a sign-in, an account's creation or an email gate with no form, at the person's
   *  Autofill (or Sign up & Autofill: `signUp`). jr6: on Manual, a saved password is typed into a sign-in or an
   *  account's creation, the press the person's. jr6 apply F2 item 2 (AF-3, AF-16): the same step for a wall an entry
   *  press of ours drew in this document, never a refusal. The line P review (revA-2, P-B2): that entry's step ends
   *  with the entry (`signal`, its own: run/cancel, the document's end), as a run's sign-in ends with the run: nothing
   *  is typed or pressed after the person's Cancel, and what it typed is written empty again (sign-in.ts 'left'); a
   *  password kept for the person's press stays guarded until the document goes (`page`). */
  async function wallStep(kind: SignInWall, signUp: boolean, signal: AbortSignal = lifetime.signal): Promise<void> {
    const at = urlOf(readHref());
    const own = at === null ? [] : adapters(at);
    if (stopped || signal.aborted || own.length === 0) return;
    // jr6: on Manual, a saved password is typed into a sign-in or an account's creation, the press the person's.
    const typeOnly = !signUp && signInMode !== 'auto';
    if (typeOnly && (!signInTypes || (kind !== 'sign-in' && kind !== 'create-account'))) {
      showWallToast('sign-in');
      return;
    }
    const outcome = await signIn({ doc, adapter: own[0]!, channel, href: readHref, isTop, claimed,
      ...(typeOnly ? { typeOnly: true as const } : {}), signal, page: lifetime.signal });
    // The line P review (revA-2): a step its entry's end stopped took nothing, and says nothing more.
    const cancelled = signal.aborted && !stopped;
    log('content.sign-up', { taken: !cancelled && (outcome === 'continue' || outcome === 'left'),
      ...(cancelled ? { cancelled: true } : {}) });
    if (stopped || cancelled || outcome === 'left') return;
    if (outcome === 'continue') {
      // A check the press brought (an email code, a CAPTCHA) is the person's: its toast, until it goes.
      if (wallNow().challenge) showWallToast('challenge');
      else {
        wallToast = null;
        wallWaits = null;
        ui?.setToasts([]);
        sendWall(wallTold ?? { wall: null, choice: false });
      }
      formAfterWall();
      return;
    }
    // The v4 review (M5): none saved, a challenge, the site refusing it, or anything else (not allowed now, no form
    // read): each its own toast. jr6: typed on Manual, the site's button the person's.
    showWallToast(outcome === 'none-saved' ? 'none-saved' : outcome === 'challenged' ? 'challenge'
      : outcome === 'failed' ? 'failed' : outcome === 'typed' ? 'typed' : 'sign-in');
  }

  // ── jr6 apply F2 item 2: one entry for the person, the queue and the agent (APPLYPLAN §5 F2 item 2) ──
  /** Who asked for an entry: the person's Autofill or the queue's (run/start, `signUp`: Sign up & Autofill), or the
   *  auto-apply agent (agent/enter). */
  type EntrySource = { by: 'person'; signUp: boolean } | { by: 'agent' };

  /** What an entry did, for its log line (flags and counts only), and (item 6) the dialogs shown before its first
   *  press. */
  interface EntryFacts {
    before: ReadonlySet<Element> | null;
    /** The last press was made on a choice of how to apply (its Apply Manually). */
    onChoice: boolean;
    presses: number;
    followed: boolean;
    waited: boolean;
    found: boolean;
    wall: boolean;
    choice: boolean;
  }

  /** apply-c-new-1, B4: the page read again at an entry: a form drawn since the last look (a dialog the person opened, a
   *  form the page drew in place, the person's own Apply) is claimed now, the launcher mounted and the worker told. The
   *  address's own adapter first; the generic one only where no adapter of the address says its form is drawn late, at
   *  its posting's address or in place (APPLYPLAN D5). Answers whether a form shows now. */
  function lookAgain(): boolean {
    if (stopped) return false;
    if (page !== null) return true;
    const href = readHref();
    const url = urlOf(href);
    const waits = url !== null && adapters(url).some((adapter) => (adapter.quirks?.formLateMs ?? 0) > 0
      || adapter.quirks?.formAtPosting === true || adapter.quirks?.formInPlace === true);
    resolvePage(href, { ownOnly: waits });
    if (page === null) return false;
    formFound();
    return true;
  }

  /** C4, apply-flow-new-2: the application a pressed link leads to, when it is an <a href> on this frame's origin whose
   *  address an adapter reads as another application or posting than this page's (SmartRecruiters' one-click page):
   *  its key, a hash (adapters/application-key.ts), never the address; none otherwise. */
  function nextKeyOf(pressed: HTMLElement): string | undefined {
    const here = urlOf(readHref());
    const href = pressed.localName === 'a' ? pressed.getAttribute('href') : null;
    if (href === null || here === null || app === null) return undefined;
    let to: URL;
    try {
      to = new URL(href, doc.querySelector('base[href]') !== null ? doc.baseURI : here.href);
    } catch {
      return undefined;
    }
    if (to.origin !== here.origin) return undefined;
    const there = applicationOf(to);
    if (there === null || (there.page !== 'application' && there.page !== 'posting')) return undefined;
    return there.applicationKey === app.applicationKey ? undefined : there.applicationKey;
  }

  /** How long an entry with no Apply declared waits for a form an adapter of the address draws late (its formLateMs;
   *  ENTRY_FORM_WAIT_MS where it draws one at its posting's address or in place), 0 for none. */
  function lateEntryMs(all: readonly Adapter[]): number {
    const late = lateFormMs(all);
    if (late > 0) return late;
    return all.some((adapter) => adapter.quirks?.formAtPosting === true || adapter.quirks?.formInPlace === true)
      ? ENTRY_FORM_WAIT_MS : 0;
  }

  /** A form the address's own adapters claim within `ms` (claimed as it shows), or false when none came or the entry
   *  ended first (`gone`: run/cancel, the document's end, or the line P review's revA-4, a route to another
   *  application, whose form is never this entry's). The line P review (P-2): one the page's own late-form watch
   *  claimed meanwhile (watchLateForm) is taken as it is, never claimed and told twice; and only a form of the
   *  address's own adapters (D5): what the generic adapter claims once the page's own late wait is over is no
   *  application this entry fills by itself. */
  function formWithin(ms: number, signal: AbortSignal, gone: () => boolean): Promise<boolean> {
    if (gone()) return Promise.resolve(false);
    if (lookAgain()) return Promise.resolve(true);
    const ours = (): boolean => page !== null && page.adapter.id !== 'generic';
    return new Promise((resolve) => {
      watchForLateForm(doc, ms, () => {
        if (stopped || gone()) return true;
        if (page === null) {
          resolvePage(readHref(), { ownOnly: true });
          if (page === null) return false;
          formFound();
        }
        if (!ours()) return false;
        resolve(true);
        return true;
      }, signal, () => resolve(ours() && !gone()));
      signal.addEventListener('abort', () => resolve(false), { once: true });
    });
  }

  /**
   * The entry (APPLYPLAN §5 F2 item 2), shared by the person's Autofill and the queue's (atWall) and the agent's
   * agent/enter (enterForAgent; AF-16), one at a time (apply-flow-new-4: a second ask while one presses or waits makes
   * no second press, and waits for this one's answer; frame/wall says `entering` meanwhile). In order:
   * - the page read again (lookAgain): a form now is filled, the person's run started here (the agent's starts from the
   *   form's hello);
   * - no Apply declared by any adapter of the address: a form an adapter says it draws late is waited for that long,
   *   and filled once it shows; else 'none';
   * - else the page's own Apply (press.ts pressEntry: waited for entryWaitOf, then pressed through the entry door, with
   *   the step the adapter shows after it), told the worker as each press is made (the person's entry/pressed, with
   *   the destination's key: nextKeyOf; the agent's agent/entered, once), then what the press brought watched for
   *   (afterPress); a wall shown instead (before or after the press) is the sign-in step's (wallStep), never a refusal;
   *   a door that refused the control by where it goes, nothing pressed: 'new-tab', 'elsewhere' or (a download) 'none';
   *   a check or a code: 'blocked'; none offered within the wait on an application's page whose form is drawn late
   *   (the line P review, P-2): the rest of that late window waited for, as with no Apply declared, then 'none'.
   * run/cancel ends its waits (cancelRun: a press already made stays made, none is made after). The line P review
   * (revA-4): so does a route of the page's own to another application (the person opened another job in this
   * document, or a page of none): the entry belongs to the one it started at, and nothing is pressed, claimed, signed in
   * to or refused after that (onAddress hears the route; each look and press of the entry asks too: `gone`). The
   * person's refusal is told the worker (frame/wall entryRefused and refusal) until the next press; the agent hears its
   * answer (EntryAnswer: a door's refusal is 'blocked' 'other', so agent.ts reads it as before). Logged: content.entry
   * (flags, counts, the refusal's place in ENTRY_REFUSALS), content.entry-step for a step pressed on the way.
   */
  function enter(source: EntrySource): Promise<EntryAnswer> {
    if (entering !== null) return entering;
    const at = urlOf(readHref());
    if (stopped || at === null || (!isTop && !claimed)) return Promise.resolve({ outcome: 'not-offered' });
    // The line P review (P-3; D6): never on the platform's page after submitting, as entryOffered never offers one
    // there: that application was sent, and an Apply its page shows ("Apply to more jobs") is no step of it.
    if (applicationAt(at)?.page === 'confirmation') return Promise.resolve({ outcome: 'not-offered' });
    const cancel = new AbortController();
    const signal = AbortSignal.any([cancel.signal, lifetime.signal]);
    // The line P review (revA-4): the application this entry belongs to; an address that reads another ends it.
    const key = applicationAt(at)?.applicationKey ?? null;
    const gone = (): boolean => {
      if (!signal.aborted && (applicationAt(urlOf(readHref()))?.applicationKey ?? null) !== key) {
        cancel.abort(ENTRY_MOVED);
      }
      return signal.aborted;
    };
    let answer: (said: EntryAnswer) => void = () => undefined;
    const answered = new Promise<EntryAnswer>((resolve) => {
      answer = resolve;
    });
    entering = answered;
    entryCancel = cancel;
    entryKey = key;
    // A refusal is told until the next press: this one.
    refusal = null;
    sendWall(wallNow());
    void runEntry(source, at, signal, answer, gone).catch(() => undefined).finally(() => {
      answer({ outcome: 'not-offered' });
      if (entering === answered) entering = null;
      if (entryCancel === cancel) entryCancel = null;
      if (!stopped) sendWall(wallNow());
    });
    return answered;
  }

  /** The person's run, started at their entry once a form shows (Sign up & Autofill's sign-in with it). */
  function startPersonRun(source: EntrySource): void {
    if (source.by === 'person') startRun({ trigger: 'panel', dryRun: false, ...(source.signUp ? { signIn: true } : {}) });
  }

  /** enter's steps (its doc): answers the agent at its press's outcome, and ends once what the press brought is known.
   *  `gone`: whether the entry ended meanwhile (run/cancel, the document's end, a route to another application). */
  async function runEntry(source: EntrySource, at: URL, signal: AbortSignal, answer: (said: EntryAnswer) => void,
    gone: () => boolean): Promise<void> {
    const person = source.by === 'person';
    /** The line P review (P-2): when the entry began, for the late window it waits out (lateEntryMs). */
    const started = monotonicNow();
    const facts: EntryFacts = { before: null, onChoice: false, presses: 0, followed: true, waited: false, found: false,
      wall: false, choice: false };
    const end = (refused: EntryRefusal | null): void => {
      const cancelled = signal.aborted && !stopped;
      // The line P review (revA-4): an entry a route to another application ended says so (a flag).
      const moved = cancelled && signal.reason === ENTRY_MOVED;
      log('content.entry', { agent: !person, presses: facts.presses, followed: facts.followed, waited: facts.waited,
        found: facts.found, wall: facts.wall, choice: facts.choice, cancelled, ...(moved ? { moved: true } : {}),
        ...(refused === null || cancelled ? {} : { refusal: ENTRY_REFUSALS.indexOf(refused) }) });
      // The person's refusal is told (enter's end tells the worker); a cancelled entry says nothing.
      if (person && refused !== null && !cancelled && !stopped) refusal = refused;
    };
    if (lookAgain()) {
      facts.found = true;
      startPersonRun(source);
      answer({ outcome: 'not-offered' });
      end(null);
      return;
    }
    const all = adapters(at);
    if (!all.some((adapter) => adapter.entryControl !== undefined)) {
      // No Apply declared: a form an adapter says it draws late is waited for (the person's), else none.
      const late = source.by === 'person' ? lateEntryMs(all) : 0;
      facts.waited = late > 0;
      if (late > 0 && await formWithin(late, signal, gone)) {
        facts.found = true;
        startPersonRun(source);
        end(null);
        return;
      }
      answer({ outcome: 'not-offered' });
      end('none');
      return;
    }
    // The line P review (revA-4): a press only while the page the entry started at shows (its application's address).
    const result: EntryResult = await pressEntry(doc, all, signal, entryWaitOf(all), undefined,
      (pressed, before, onChoice) => {
        facts.before ??= before;
        facts.onChoice = onChoice;
        entryPressed(source, facts, pressed, false);
      }, { address: at, here: () => !gone() });
    if (stopped) return;
    if (result.outcome === 'pressed') {
      facts.followed = result.followed !== false;
      answer({ outcome: 'pressed' });
      end(await afterPress(source, signal, facts, gone));
      return;
    }
    // The line P review (revA-4, and run/cancel): an entry that ended meanwhile starts nothing, signs in nowhere and
    // says nothing more (no press was made).
    if (gone()) {
      answer({ outcome: 'not-offered' });
      end(null);
      return;
    }
    if (result.outcome === 'not-offered') {
      if (result.refusal !== undefined) {
        // A door's refusal by where the control goes: nothing pressed; the agent's is the person's ('other').
        answer({ outcome: 'blocked', block: 'other' });
        end(result.refusal === 'download' ? 'none' : result.refusal);
        return;
      }
      // The entry stands down where a form shows: it is filled now.
      if (lookAgain()) {
        facts.found = true;
        startPersonRun(source);
        answer({ outcome: 'not-offered' });
        end(null);
        return;
      }
      // The line P review (P-2): an application's page whose adapters declare an Apply for their postings alone (none
      // offered here: Workable's /apply/, Ashby's, Oracle's and Workday's application pages) and draw its form late
      // (formLateMs): the rest of that late window, counted from the entry's start, is waited for as with no Apply
      // declared, and the person's run starts once the form shows; 'none' only after it (A0: no Apply and no form came
      // within the wait).
      const rest = person && noFormYet() ? lateEntryMs(all) - (monotonicNow() - started) : 0;
      if (rest > 0) {
        facts.waited = true;
        if (await formWithin(rest, signal, gone)) {
          facts.found = true;
          startPersonRun(source);
          answer({ outcome: 'not-offered' });
          end(null);
          return;
        }
      }
      answer({ outcome: 'not-offered' });
      end(signal.aborted ? null : 'none');
      return;
    }
    if (result.block === 'sign-in') {
      facts.wall = true;
      if (source.by === 'person') {
        answer({ outcome: 'blocked', block: 'sign-in' });
        const shown = detectPause(doc, null, all[0]!);
        if (shown !== null && (SIGN_IN_WALLS as readonly string[]).includes(shown.kind)) {
          // The line P review (revA-2, P-B2): the step ends with this entry (run/cancel).
          await wallStep(shown.kind as SignInWall, source.signUp, signal);
          end(null);
          return;
        }
        end('blocked');
        return;
      }
      answer(await agentSignIn(all, signal));
      end(null);
      return;
    }
    answer({ outcome: 'blocked', ...(result.block === undefined ? {} : { block: result.block }) });
    end('blocked');
  }

  /** Each press of an entry, told as it is made with nothing awaited (a press that takes the page away ends this
   *  document first): the person's entry/pressed, with the destination's key (nextKeyOf); the agent's agent/entered
   *  (v3 Phase 5; round 3 of the v3 Phase 6/7b review, X8), at its first press alone. A press after the first is a
   *  step on the way (content.entry-step: the adapter's choice, or `generic`, the second step). */
  function entryPressed(source: EntrySource, facts: EntryFacts, pressed: HTMLElement, generic: boolean): void {
    facts.presses += 1;
    if (facts.presses > 1) log('content.entry-step', { choice: !generic, generic });
    if (source.by === 'person') {
      const nextKey = nextKeyOf(pressed);
      void channel.request({ v: 1, type: 'entry/pressed', ...(nextKey === undefined ? {} : { nextKey }) })
        .catch(() => undefined);
    } else if (facts.presses === 1) {
      void channel.request({ v: 1, type: 'agent/entered' }).catch(() => undefined);
    }
  }

  /** v3 Phase 5: the agent's entry blocked by a sign-in page: Sign-in mode Auto signs in there (sign-in.ts), and the
   *  entry answers what came of it; Manual, or none to use: blocked by the sign-in. The line P review (revA-2): it ends
   *  with its entry (`signal`: run/cancel, the document's end), nothing pressed after it. */
  async function agentSignIn(own: readonly Adapter[], signal: AbortSignal): Promise<EntryAnswer> {
    if (signInMode !== 'auto' || own.length === 0 || signal.aborted) return { outcome: 'blocked', block: 'sign-in' };
    const outcome = await signIn({ doc, adapter: own[0]!, channel, href: readHref, isTop, claimed,
      signal, page: lifetime.signal });
    // 'left': the page went on (the next document's run takes over); the line P review (revA-2): or the entry ended
    // first, which signed in nowhere.
    if (outcome === 'left') return signal.aborted && !stopped ? { outcome: 'blocked', block: 'sign-in' }
      : { outcome: 'pressed' };
    if (outcome === 'continue') {
      // What the page shows after the sign-in: a challenge its press raised, an email code, another account page is
      // the person's, and the entry says so (the v3 Phase 6/7b review's round 2, E7); nothing: it went on.
      const after = detectPause(doc, null, own[0]!);
      return after === null ? { outcome: 'pressed' } : { outcome: 'blocked', block: blockOf(after.kind) };
    }
    // The v4 review (M5): a challenge that held the sign-in back is the agent's CAPTCHA block.
    return { outcome: 'blocked', block: outcome === 'failed' ? 'sign-in-failed' : outcome === 'challenged' ? 'captcha'
      : 'sign-in' };
  }

  /**
   * After an entry press of ours (AF-3, AF-4, B4, B9): what it brought in this document, watched on its DOM changes
   * (late-form.ts watchForLateForm: a look 100 ms after a burst) for ENTRY_FORM_WAIT_MS, or the address's longer
   * formLateMs: a form, claimed by the address's own adapters alone, a posting's address included (formFound: the
   * worker's grant starts its run); a wall, the sign-in step's (the person's: wallStep; the line P review, P-B4: the
   * agent's, agentSignIn, as at a wall its entry met before its press); a choice of how to apply (told
   * the worker; the next press answers it); a check or a code, the person's ('blocked'). A new document ends it with
   * this one, quietly; the line P review (revA-4): so does a route to another application (`gone`), before anything is
   * claimed, pressed or signed in to there. Nothing within the wait: 'nothing-followed'. Answers the person's refusal,
   * or null (the agent's entry refuses nothing here: its own wait says it).
   */
  async function afterPress(source: EntrySource, signal: AbortSignal, facts: EntryFacts, gone: () => boolean):
    Promise<EntryRefusal | null> {
    const person = source.by === 'person';
    type Seen = { form: true } | { pause: NonNullable<ReturnType<typeof detectPause>> } | null;
    const seen = (): Seen => {
      if (stopped || gone()) return null;
      if (page !== null) return { form: true };
      resolvePage(readHref(), { ownOnly: true, atPosting: true });
      if (page !== null) {
        formFound();
        return { form: true };
      }
      const url = urlOf(readHref());
      const first = url === null ? null : adapters(url)[0] ?? null;
      let pause: ReturnType<typeof detectPause> = null;
      try {
        pause = detectPause(doc, null, first, newScanCache());
      } catch {
        pause = null;
      }
      // The choice our last press was made on, still shown while the page takes it (Workday's Apply Manually): what it
      // brings is waited for.
      if (pause !== null && !(pause.kind === 'entry-choice' && facts.onChoice)) return { pause };
      // Item 6 (D7, AF-11): no choice of the adapter's shows, but a dialog the press opened offers the generic second
      // step: pressed (press.ts pressSecondStep, its own door), the entry's last press; then watched on.
      if (pause === null && url !== null && facts.before !== null && facts.presses < ENTRY_MAX_PRESSES) {
        const step = pressSecondStep(doc, ownAdapters(adapters(url)), facts.before, url);
        if (step !== null) {
          facts.onChoice = false;
          entryPressed(source, facts, step, true);
        }
      }
      return null;
    };
    let outcome = seen();
    if (outcome === null && !signal.aborted && !stopped) {
      const url = urlOf(readHref());
      const capMs = Math.max(ENTRY_FORM_WAIT_MS, url === null ? 0 : lateFormMs(adapters(url)));
      outcome = await new Promise<Seen>((resolve) => {
        watchForLateForm(doc, capMs, () => {
          const got = seen();
          if (got === null && !signal.aborted && !stopped) return false;
          resolve(got);
          return true;
        }, signal, () => resolve(seen()));
        signal.addEventListener('abort', () => resolve(null), { once: true });
      });
    }
    if (stopped || signal.aborted) return null;
    if (outcome === null) return person ? 'nothing-followed' : null;
    if ('form' in outcome) {
      facts.found = true;
      return null;
    }
    const kind = outcome.pause.kind;
    if ((SIGN_IN_WALLS as readonly string[]).includes(kind)) {
      facts.wall = true;
      // The line P review (revA-2, P-B2): the step ends with this entry (run/cancel): nothing pressed after it.
      if (source.by === 'person') await wallStep(kind as SignInWall, source.signUp, signal);
      else {
        // The line P review (P-B4; AF-16): a sign-in or an account's creation the agent's own press drew in this
        // document is the agent's as one its entry met before its press is (agentSignIn): Sign-in Auto signs in there;
        // Manual leaves it. The agent heard its answer at its press; agent.ts's wait reads what follows.
        const url = urlOf(readHref());
        const said = await agentSignIn(url === null ? [] : adapters(url), signal);
        log('content.agent-entry', { wall: true, pressed: said.outcome === 'pressed' });
      }
      return null;
    }
    if (kind === 'entry-choice') {
      facts.choice = true;
      return null;
    }
    return person ? 'blocked' : null;
  }
  // ── end jr6 apply F2 item 2 ──

  /** After a wall or a choice was passed in this document: the form it shows now, else one drawn late. */
  function formAfterWall(): void {
    if (stopped || page !== null) return;
    resolvePage(readHref());
    if (page !== null) formFound();
    else watchLateForm();
  }

  /** A posting page's text, read for policy text (policy/hit, under its application's key). jr6 apply F2 item 7
   *  (apply-b-new-2; FIXPLAN ADP-10): also on an application's address while no form shows there, where an adapter of
   *  the address names the posting's own text (Adapter.postingText: ADP's job details at its guest page's address), that
   *  text alone, once shown. */
  async function readPosting(): Promise<void> {
    if (app === null) return;
    const href = readHref();
    const url = urlOf(href);
    const named = url === null ? undefined : adapters(url).find((adapter) => adapter.postingText !== undefined);
    // jr6 apply F2 item 7: an application's address, with no form, whose adapter names the posting's text.
    const atApplication = app.page === 'application' && page === null && named !== undefined;
    if (app.page !== 'posting' && !atApplication) return;
    const key = app.applicationKey;
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
      // jr6 apply F2 item 7: on an application's address, only while no form shows there.
      if (atApplication && page !== null) return true;
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
    // jr6 apply F2 (the line P review, revA-4): an entry under way belongs to the application it started at: a route to
    // another one (the person opened another job in this document, or a page of none) ends it quietly, as run/cancel
    // does: nothing pressed after it, nothing refused (enter).
    if (entryCancel !== null && (app?.applicationKey ?? null) !== entryKey) entryCancel.abort(ENTRY_MOVED);
    // The line P review (P-1): what this document told at its last address is not this one's.
    entrySaid = false;
    if ((app?.applicationKey ?? null) !== before) {
      current?.abort();
      current = null;
      lastRows = new Map();
      drafts.clear();
      answers.clear();
      ui?.setToasts([]);
      ui?.setLauncher({ state: 'idle', action: 'fill' });
    }
    if (page === null) ui?.anchorTo(null);
    else mountUi();
    // v5 p1-shell: the pill follows what the address shows; a supported page reached by a route of the page's own opens
    // the sidebar by itself as one loaded would, once per document.
    pageShownNow();
    autoOpen();
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
      restored,
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
      ui?.setToasts([]);
      ui?.setLauncher({ state: 'idle', action: 'fill' });
    }
  }, { signal: lifetime.signal });
  // Back from the back/forward cache: the worker forgot this document's frame while it was away (its sweep drops a
  // frame that does not answer), so it says hello again, and the side panel's messages reach this document (W1).
  view?.addEventListener('pageshow', (event) => {
    if (stopped || !restoredFromCache(event)) return;
    void restored().catch(() => undefined);
  }, { signal: lifetime.signal });

  resolvePage(readHref());
  // Core pass Z2 of 2026-11-06 (item 33): an application page whose first scan finds no form while what holds a form's
  // controls is still fading in (Pinpoint's panel, animate.css fadeIn over 1 s) is read again once those entrance
  // animations end, at most ENTRANCE_CAP_MS later (dom/entrance.ts). A page whose form shows at once is not delayed.
  if (noFormYet() && await awaitEntrance(doc, { signal: lifetime.signal }) && !stopped) resolvePage(readHref());
  // core-x, items 7 and 14: a chain page names its chain in its hello: a top frame's the browser's referrer by its hash;
  // a subframe's says only that it is one (the security fix of 2026-11-06, S4: the worker reads its frame registry,
  // and nothing is posted to the page or a parent window).
  const startUrl = urlOf(readHref());
  const startChain = startUrl === null ? null : chainPageOf(startUrl);
  if (startChain?.role === 'top' && isTop) {
    const from = hrefHash(options.referrer?.() ?? doc.referrer);
    if (from !== null) chainHello = { from };
  } else if (startChain?.role === 'frame' && !isTop) {
    chainHello = { frame: true };
  }
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
      // v4: the page's account wall, told to the worker as it changes (module header).
      watchWall();
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
