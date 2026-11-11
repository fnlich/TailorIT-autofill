/*
 * The page's own Next and Submit, pressed for the person (v3 Phase 4; docs/SPEC-AMENDMENTS.md §12 Decision 6). This is
 * the one module that presses the page's Submit: it alone may call not-submit.ts's clickAdapterSubmit (lint holds it
 * so: eslint.config.mjs, test/allow-submit.test.ts), and it does so for exactly two callers:
 * - the panel's "Continue to the next page" and "Submit application", on the person's trusted click in the side panel
 *   (an extension page no page can script: panel/press → run/press, from the worker alone) or in the in-page panel (its
 *   trusted, visible-click gate: content/ui/panel.tsx);
 * - Submit mode Auto, on a final step the step machine's autoSubmitVerdict passed (its press-submit effect).
 * A page's own message, event or DOM change can reach neither: run/press is taken only from this extension's worker
 * (runtime.ts's sender check), and the in-page panel takes only trusted clicks.
 *
 * What a press does, checked right before its one click with nothing awaited between: no pause shows (a sign-in, an
 * email code, a CAPTCHA, a bot check: 'blocked'), and no challenge not known solved anywhere on the page, nor a frame
 * that reads like one (the audit of 2026-11-06, S-7: pause-detect.ts pageChallenged, as Sign-in Auto reads it); the
 * adapter says the step is not the last (Next) or is (Submit); the adapter's own button is there, visible and enabled
 * ('not-offered' otherwise); for Submit, no required field is still left unanswered unless the person confirmed
 * ('required-empty', with how many: requiredLeftOf); then the one click: Next through clickIfAllowed with allowNext,
 * Submit through clickAdapterSubmit, so the never-press list, a label, a button holding it and every other submit
 * control stay refused ('refused'). A form whose own validation refuses the click (its `invalid` events, fired during the click) answers
 * 'not-accepted' with how many fields it marked. Nothing is retried another way. A press never reads or writes a
 * value.
 *
 * After a press, refusalAfter reads whether the page refused it (PRESS_REFUSAL_MS later): the adapter's visible
 * errors, the controls the form marked invalid, Ashby's failure message. The runtime ends a Submit's wait with it, and
 * the run answers a Next the page did not take.
 *
 * v5 (PLAN decision 9, the owner's "implement like jobright extension", 2026-11-08): a checkbox CAPTCHA not yet ticked
 * (reCAPTCHA v2's, hCaptcha's) holds no press here any more: Next, Submit and the agent's entry press the site's own
 * control beside it, as Jobright does, and the site decides (pause-detect.ts pageChallenged leaves it out). A site's
 * CAPTCHA-required error (JazzHR's, as Jobright reads it) counts in refusalNow like any error, so the runtime ends the
 * Submit's wait; the run then reads that refusal as the check's (orchestrator.ts refusedForCheck: a CAPTCHA pause, the
 * "solve the check" toast, carried on once solved). Once the person solved the check, that error is stale and no longer
 * counted (withoutSolvedCaptchaErrors). A challenge popup, a vendor that is no checkbox and a frame that reads like one
 * still block every press. Nothing here ever touches a check.
 *
 * v5 p2-fill (PLAN Phase 2, Jobright's "Open Application"): the same entry, every guard below held, is also the
 * person's: the panel's main button on a posting with no form whose adapter offers its own Apply reads "Open
 * Application", and its panel/fill reaches the posting's frame as run/start (from the worker alone), which presses it
 * (runtime.ts atWall) and fills the form it brings.
 * v3 Phase 5: pressEntry, the auto-apply agent's agent/enter (from the worker's own script alone: runtime.ts), presses
 * a posting page's declared entry control (Adapter.entryControl: Greenhouse's and Lever's Apply, Ashby's Application
 * tab) through not-submit.ts clickAdapterEntry, the third door this module alone may open: never while a form, a
 * CAPTCHA (anywhere on the page, or a frame that reads like one: S-7; since v5 no checkbox widget), a sign-in or a code
 * shows, never anything but
 * that one control. A page that draws it late is watched for it for ENTRY_WAIT_MS, or the adapter's own
 * quirks.entryWaitMs. v3 Phase 7b: a choice of how to apply blocks it only where
 * the adapter offers no control on it, and an adapter may allow a second press in the same document (Workday's Apply,
 * then its Apply Manually), made only while the adapter says its choice shows. A CAPTCHA shown and not solved comes
 * before every other page (dom/pause-detect.ts): the entry is 'blocked' by it, the choice included (the v3 Phase 6/7b
 * review, S1).
 */
import type { Adapter } from '../adapters/types';
import type { EntryAnswer, EntryBlock, StepTarget, PressAnswer } from '../messaging/schemas';
import type { FrameReport } from '../shared/report';
import { accountLeft } from '../dom/account-section';
import { clickIfAllowed } from '../dom/fillers';
import { clickAdapterEntry, clickAdapterSubmit } from '../dom/fillers/not-submit';
import { detectPause, pageChallenged, type PauseKind, withoutSolvedCaptchaErrors } from '../dom/pause-detect';
import { newScanCache } from '../dom/scan-cache';
import { tagsShowChip } from '../dom/widgets/tag-chips'; // jr6 ENGINE
import { deadline } from '../dom/time';
import type { ScanResult } from '../dom/types';
import { isUserVisible } from '../dom/visibility';
import { watchForLateForm } from './late-form';

/** How long after a press the page's refusal is read (its errors drawn, its failure message shown). */
export const PRESS_REFUSAL_MS = 2_000;

/** Ashby's message when an application could not be sent, in the form's place (Jobright 1.25.2 reads it; not seen
 *  live, since nothing was submitted). */
export const ASHBY_FAILURE = '.ashby-application-form-failure-container';

/** What a press reads of the page. */
export interface PressPage {
  doc: Document;
  adapter: Adapter;
  root: Element;
  /** A fresh scan of the step, for its required fields still empty. */
  scan(): ScanResult;
  /** The keys of the run's rows on required fields that are still left for the person (shared/report.ts
   *  leftForPerson): a field the run could not answer counts until the person answered it. */
  leftRequired?(): readonly string[];
  /** A CAPTCHA the person was handed on this step and solved since does not block (the run's own pause rule). */
  handed?: ReadonlySet<Element>;
}

/** The adapter's finality of the step, 'unknown' when it cannot say or throws. */
function finalityOf(page: Pick<PressPage, 'doc' | 'adapter'>): 'final' | 'not-final' | 'unknown' {
  try {
    return page.adapter.isFinalStep?.(page.doc) ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** The adapter's Next or Submit button, or null when it names none (or throws). */
function buttonOf(page: Pick<PressPage, 'adapter' | 'root'>, target: StepTarget): HTMLElement | null {
  try {
    return (target === 'next' ? page.adapter.nextButton?.(page.root) : page.adapter.submitButton?.(page.root)) ?? null;
  } catch {
    return null;
  }
}

/** Whether a button can be pressed by a person now: visible, and not disabled. */
function pressable(button: HTMLElement | null, cache = newScanCache()): button is HTMLElement {
  return button !== null && button.isConnected && isUserVisible(button, cache)
    && (button as HTMLButtonElement).disabled !== true && button.getAttribute('aria-disabled') !== 'true';
}

/** What the step offers the panel's buttons now (FrameReport.buttons): its finality, and whether its Next and its
 *  Submit can be pressed. Flags only. */
export function stepButtonsOf(page: Pick<PressPage, 'doc' | 'adapter' | 'root'>): NonNullable<FrameReport['buttons']> {
  const cache = newScanCache();
  return { final: finalityOf(page), next: pressable(buttonOf(page, 'next'), cache),
    submit: pressable(buttonOf(page, 'submit'), cache) };
}

/** Whether a field's answer is empty as it reads now. */
function emptyNow(current: ScanResult['fields'][number]['current']): boolean {
  switch (current.kind) {
    case 'empty':
      return true;
    case 'text':
      return current.text.trim() === '';
    case 'checked':
      return !current.checked;
    case 'selected':
      return current.labels.length === 0;
    case 'files':
      return current.count === 0;
  }
}

/** The visibilities a person answers a field in: shown, or a hidden native control a visible one stands for (a file
 *  input behind its upload button or label, a radio or box behind its label: scan.ts's proxies). */
const ANSWERABLE: ReadonlySet<ScanResult['fields'][number]['visibility']> = new Set(['visible',
  'hidden-file-with-visible-control', 'hidden-native-with-visible-label']);

/**
 * The required questions still left unanswered on the step: what a Submit would leave empty. A field a person can
 * answer (ANSWERABLE, enabled, its label shown where the control itself shows) that reads empty, and each of the run's
 * required rows still left for the person (`leftRequired`, leftForPerson) unless its field reads answered now: a
 * resume the fill attached none to, an upload that failed, a widget the scan cannot read. A radio group or a box
 * group is one question, counted once by its base key. jr6 ENGINE E3 (FIXPLAN §6.2 item 13): a box of several answers
 * that shows a chip is answered, its text box empty or not.
 */
export function requiredLeftOf(scanned: ScanResult, leftRequired: readonly string[] = []): number {
  const left = new Set<string>();
  for (const field of scanned.fields) {
    if (!field.required || field.disabled || !ANSWERABLE.has(field.visibility)) continue;
    if (field.visibility === 'visible' && !field.labelVisible) continue;
    if (emptyNow(field.current) && !answeredByChips(scanned, field)) left.add(field.baseKey); // jr6 ENGINE
  }
  for (const key of leftRequired) {
    const field = scanned.fields.find((candidate) => candidate.key === key);
    if (field !== undefined && (!emptyNow(field.current) || answeredByChips(scanned, field))) continue; // jr6 ENGINE
    left.add(field?.baseKey ?? key);
  }
  return left.size;
}

// jr6 ENGINE E3 (FIXPLAN §6.2 item 13: U-05, WD-18): a box of several answers (WidgetDecl.tags: Workday's Skills,
// UltiPro's review Skills) reads as what its text box holds, empty once its values are chips: it is answered while it
// shows a chip (dom/widgets/tag-chips.ts tagsShowChip), whoever added it.
/** jr6 ENGINE: whether a field is a box of several answers that shows a chip now. */
function answeredByChips(scanned: ScanResult, field: ScanResult['fields'][number]): boolean {
  const tags = scanned.target(field.key)?.widget?.tags;
  return tags !== undefined && tagsShowChip(tags);
}
// jr6 ENGINE: end

/** The fields the form's own validation marked during `act` (its `invalid` events, which a refused submit fires
 *  synchronously in the click), inside the step's root. */
function invalidDuring(page: Pick<PressPage, 'doc' | 'root'>, act: () => boolean): { acted: boolean; invalid: number } {
  const marked = new Set<EventTarget>();
  const onInvalid = (event: Event) => {
    const target = event.target;
    if (target !== null && page.root.contains(target as Node)) marked.add(target);
  };
  page.doc.addEventListener('invalid', onInvalid, true);
  try {
    return { acted: act(), invalid: marked.size };
  } finally {
    page.doc.removeEventListener('invalid', onInvalid, true);
  }
}

/** Presses the step's own Next or Submit (module header); answers what came of it. */
export function pressStep(page: PressPage, target: StepTarget, options: { confirmed: boolean }): PressAnswer {
  const cache = newScanCache();
  if (detectPause(page.doc, page.root, page.adapter, cache, page.handed === undefined ? {} : { handed: page.handed })
    !== null) return { outcome: 'blocked' };
  // The audit of 2026-11-06 (S-7): a challenge not known solved anywhere on the page, or a frame that reads like one,
  // holds Next and Submit alike, as it holds Sign-in Auto (a CAPTCHA the person was handed included). v5 (PLAN decision
  // 9): a checkbox widget not yet ticked is none: the press is made and the site decides.
  if (pageChallenged(page.doc, cache)) return { outcome: 'blocked' };
  const finality = finalityOf(page);
  if (finality !== (target === 'next' ? 'not-final' : 'final')) return { outcome: 'not-offered' };
  const button = buttonOf(page, target);
  if (!pressable(button, cache)) return { outcome: 'not-offered' };
  if (target === 'submit' && !options.confirmed) {
    // core-x, item 2: an account section's required boxes still empty count as required fields left (no rows).
    const count = requiredLeftOf(page.scan(), page.leftRequired?.() ?? [])
      + accountLeft(page.adapter, page.doc, page.root);
    if (count > 0) return { outcome: 'required-empty', count };
  }
  const { acted, invalid } = invalidDuring(page, () => (target === 'next'
    ? clickIfAllowed(button, { adapter: page.adapter, root: page.root, allowNext: true })
    : clickAdapterSubmit(page.adapter, page.root) === button));
  if (!acted) return { outcome: 'refused' };
  return invalid > 0 ? { outcome: 'not-accepted', count: invalid } : { outcome: 'pressed' };
}

/** How many problems the page shows on the step now: the adapter's visible errors, `invalid` fields it marked, or
 *  Ashby's failure message (one). 0: none. v5 (PLAN decision 9): a site's CAPTCHA-required error counts while its
 *  check is not ticked, and no longer once the person solved it (withoutSolvedCaptchaErrors). */
export function refusalNow(page: Pick<PressPage, 'doc' | 'adapter' | 'root'>, invalid = 0): number {
  const cache = newScanCache();
  let errors = 0;
  try {
    errors = withoutSolvedCaptchaErrors(page.adapter.errors?.(page.root) ?? [], page.doc, cache)
      .filter((error) => error.el.isConnected && isUserVisible(error.el, cache)).length;
  } catch {
    errors = 0;
  }
  const failure = page.doc.querySelector(ASHBY_FAILURE);
  const failed = failure !== null && isUserVisible(failure, cache) ? 1 : 0;
  return Math.max(errors, invalid, failed);
}

/** Whether the page refused a press PRESS_REFUSAL_MS after it (module header): the count refusalNow reads then, with
 *  the fields the form marked invalid meanwhile; 0 when it shows none, or `signal` aborted first. */
export async function refusalAfter(page: Pick<PressPage, 'doc' | 'adapter' | 'root'>, signal: AbortSignal,
  ms = PRESS_REFUSAL_MS): Promise<number> {
  const marked = new Set<EventTarget>();
  const onInvalid = (event: Event) => {
    const target = event.target;
    if (target !== null && page.root.contains(target as Node)) marked.add(target);
  };
  page.doc.addEventListener('invalid', onInvalid, true);
  try {
    if ((await deadline(ms, signal)) === 'aborted') return 0;
  } finally {
    page.doc.removeEventListener('invalid', onInvalid, true);
  }
  return refusalNow(page, marked.size);
}

/** How long the agent's entry waits for its control to be drawn (Ashby draws its overview's tabs seconds after load),
 *  where its adapter says nothing else (quirks.entryWaitMs). */
export const ENTRY_WAIT_MS = 8_000;
/** The longest an adapter may ask the entry to wait (quirks.entryWaitMs): the agent's queue waits meanwhile. */
export const ENTRY_WAIT_CAP_MS = 20_000;
/** v3 Phase 7b: the most presses one agent/enter makes in one document (Workday's Apply, then its Apply Manually), each
 *  one the adapter allows (quirks.entryPresses). */
export const ENTRY_MAX_PRESSES = 2;
/** v3 Phase 7b: how long after a press that leaves the agent in the same document the next entry control is waited for
 *  (Workday's choice is drawn at once, in place). */
export const ENTRY_FOLLOW_MS = 5_000;

/** What blocked an entry, by the pause the page shows. */
export function blockOf(kind: PauseKind): EntryBlock {
  switch (kind) {
    case 'sign-in':
    case 'create-account':
    case 'email-gate':
    case 'forgot-password':
      return 'sign-in';
    case 'email-code':
      return 'email-code';
    case 'captcha':
      return 'captcha';
    default:
      return 'other';
  }
}

/** v4 (D7): a run at a choice of how to apply (authState 'entry-choice': Workday's "Start Your Application") presses the
 *  adapter's declared entry on it (its Apply Manually) through the entry door, every guard of it held (never while a
 *  form or a challenge shows, never a control the adapter never presses): 'pressed', else 'none' (the run then rests
 *  silently, and follows the person's own choice). Called by src/content/runtime.ts alone (RunEnv.enterChoice). */
export function pressEntryChoice(doc: Document, adapter: Adapter): 'pressed' | 'none' {
  if (pageChallenged(doc)) return 'none';
  let state: ReturnType<NonNullable<Adapter['authState']>> = null;
  try {
    state = adapter.authState?.(doc) ?? null;
  } catch {
    state = null;
  }
  if (state !== 'entry-choice') return 'none';
  return pressDoor(adapter, doc) === null ? 'none' : 'pressed';
}

/** The entry door (not-submit.ts clickAdapterEntry), opened from this one place: the agent's entry and v4's entry
 *  choice alike. */
function pressDoor(adapter: Adapter, doc: Document): HTMLElement | null {
  return clickAdapterEntry(adapter, doc);
}

/** How long the entry waits for a control the address's adapters draw late: the longest quirks.entryWaitMs of those
 *  that declare an entry control, ENTRY_WAIT_MS where none says (v3 Phase 6/7b review, C7), at most ENTRY_WAIT_CAP_MS. */
export function entryWaitOf(adapters: readonly Adapter[]): number {
  const asked = adapters.filter((adapter) => adapter.entryControl !== undefined)
    .map((adapter) => adapter.quirks?.entryWaitMs ?? ENTRY_WAIT_MS)
    .filter((ms) => Number.isFinite(ms) && ms > 0);
  return Math.min(ENTRY_WAIT_CAP_MS, Math.max(ENTRY_WAIT_MS, ...asked));
}

/** The presses an adapter allows in one document: its quirks.entryPresses, at least 1, at most ENTRY_MAX_PRESSES. */
function pressesOf(adapter: Adapter): number {
  const declared = adapter.quirks?.entryPresses ?? 1;
  return Math.max(1, Math.min(ENTRY_MAX_PRESSES, Number.isInteger(declared) ? declared : 1));
}

/**
 * The agent's press on a posting page's entry control (module header): 'pressed'; 'blocked' with what blocked it (a
 * sign-in or account page, an email code, a CAPTCHA, another choice); or 'not-offered' (no adapter of the address
 * declares one, a form shows, or none was drawn within `waitMs`). Nothing is pressed but that one control.
 * v3 Phase 7b: a choice of how to apply that the adapter declares (authState 'entry-choice': Workday's "Start Your
 * Application") blocks only when the adapter offers no entry control on it; one it offers (Apply Manually) is pressed
 * through the same door. And where the adapter allows more than one press in a document (quirks.entryPresses: Workday's
 * Apply draws its choice in place), a press made before the choice shows that leaves the page in this document is
 * followed by the control the adapter offers on its choice, and only while the adapter says the choice shows
 * (authState 'entry-choice'; a press made on the choice is the last), never one
 * already pressed, at most ENTRY_MAX_PRESSES in all (v3 Phase 6/7b review, C6). The answer is 'pressed' once the last
 * press is made, a form shows or the document goes; 'blocked' by what another page shows instead (a sign-in, which
 * Sign-in mode Auto may then take: runtime.ts; a CAPTCHA); and when none of that comes within `followMs` (the choice
 * never drawn, or drawn with no control the adapter offers), 'blocked' 'other': the person's. `onPress` hears of the
 * first press as it is made, before anything is waited for (round 3 of the v3 Phase 6/7b review, X8: a press that takes
 * the page away ends the document before its answer).
 */
export function pressEntry(doc: Document, adapters: readonly Adapter[], signal: AbortSignal, waitMs = ENTRY_WAIT_MS,
  followMs = ENTRY_FOLLOW_MS, onPress?: () => void): Promise<EntryAnswer> {
  const own = adapters.filter((adapter) => adapter.entryControl !== undefined);
  if (own.length === 0 || signal.aborted) return Promise.resolve({ outcome: 'not-offered' });
  const pressed = new Set<Element>();
  let allowed = 1;
  const formShown = (): boolean => own.some((adapter) => {
    try {
      return adapter.detect(doc)?.formRoot != null;
    } catch {
      return false;
    }
  });
  /** One press of an entry control none pressed before, through the door: the adapter that pressed, or null. */
  const pressOne = (): Adapter | null => {
    for (const adapter of own) {
      let offered: Element | null = null;
      try {
        offered = adapter.entryControl!(doc);
      } catch {
        offered = null;
      }
      if (offered === null || pressed.has(offered)) continue;
      const clicked = pressDoor(adapter, doc);
      if (clicked !== null) {
        pressed.add(clicked);
        return adapter;
      }
    }
    return null;
  };
  const attempt = (): EntryAnswer | null => {
    if (formShown()) return { outcome: 'not-offered' };
    // The audit of 2026-11-06 (S-7): a challenge anywhere on the page, or a frame that reads like one, first.
    if (pageChallenged(doc)) return { outcome: 'blocked', block: 'captcha' };
    const pause = detectPause(doc, null, own[0]!);
    if (pause !== null && pause.kind !== 'entry-choice') return { outcome: 'blocked', block: blockOf(pause.kind) };
    const by = pressOne();
    if (by !== null) {
      // A press on the choice itself is the entry's last: only one made before the choice shows is followed.
      allowed = pause?.kind === 'entry-choice' ? pressed.size : pressesOf(by);
      // Told at once, before the entry waits on what the press brings (round 3 of the v3 Phase 6/7b review, X8).
      onPress?.();
      return { outcome: 'pressed' };
    }
    return pause === null ? null : { outcome: 'blocked', block: blockOf(pause.kind) };
  };
  /** After a press: the control the adapter offers on its choice, while it allows one more (pressEntry's doc). */
  const follow = (): Promise<EntryAnswer> => {
    const done: EntryAnswer = { outcome: 'pressed' };
    if (pressed.size >= allowed || signal.aborted) return Promise.resolve(done);
    /** The answer once a form or another page shows or the document goes; 'pressed': the choice's control; 'wait':
     *  nothing yet. */
    const next = (): EntryAnswer | 'pressed' | 'wait' => {
      if (signal.aborted || formShown()) return done;
      if (pageChallenged(doc)) return { outcome: 'blocked', block: 'captcha' };
      const pause = detectPause(doc, null, own[0]!);
      if (pause === null) return 'wait';
      if (pause.kind !== 'entry-choice') return { outcome: 'blocked', block: blockOf(pause.kind) };
      return pressOne() !== null ? 'pressed' : 'wait';
    };
    const first = next();
    if (first === 'pressed') return follow();
    if (first !== 'wait') return Promise.resolve(first);
    return new Promise((resolve) => {
      watchForLateForm(doc, followMs, () => {
        const looked = next();
        if (looked === 'wait') return false;
        resolve(looked === 'pressed' ? follow() : looked);
        return true;
      }, signal, () => {
        const last = next();
        resolve(last === 'pressed' ? follow() : last === 'wait' ? { outcome: 'blocked', block: 'other' } : last);
      });
      signal.addEventListener('abort', () => resolve(done), { once: true });
    });
  };
  const now = attempt();
  if (now !== null) return now.outcome === 'pressed' ? follow() : Promise.resolve(now);
  return new Promise((resolve) => {
    watchForLateForm(doc, waitMs, () => {
      const outcome = attempt();
      if (outcome === null) return false;
      resolve(outcome.outcome === 'pressed' ? follow() : outcome);
      return true;
    }, signal, () => resolve({ outcome: 'not-offered' }));
    signal.addEventListener('abort', () => resolve({ outcome: 'not-offered' }), { once: true });
  });
}
