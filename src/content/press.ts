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
 * email code, a CAPTCHA, a bot check: 'blocked'), and for Submit no CAPTCHA not known solved either; the adapter says
 * the step is not the last (Next) or is (Submit); the adapter's own button is there, visible and enabled ('not-offered'
 * otherwise); for Submit, no required field is still left unanswered unless the person confirmed ('required-empty',
 * with how many: requiredLeftOf); then the one click: Next through clickIfAllowed with allowNext, Submit through
 * clickAdapterSubmit, so the never-press list, a label, a button holding it and every other submit control stay refused
 * ('refused'). A form whose own validation refuses the click (its `invalid` events, fired during the click) answers
 * 'not-accepted' with how many fields it marked. Nothing is retried another way. A press never reads or writes a
 * value.
 *
 * After a press, refusalAfter reads whether the page refused it (PRESS_REFUSAL_MS later): the adapter's visible
 * errors, the controls the form marked invalid, Ashby's failure message. The runtime ends a Submit's wait with it, and
 * the run answers a Next the page did not take.
 */
import type { Adapter } from '../adapters/types';
import type { StepTarget, PressAnswer } from '../messaging/schemas';
import type { FrameReport } from '../shared/report';
import { clickIfAllowed } from '../dom/fillers';
import { clickAdapterSubmit } from '../dom/fillers/not-submit';
import { detectPause, unsolvedCaptchas } from '../dom/pause-detect';
import { newScanCache } from '../dom/scan-cache';
import { deadline } from '../dom/time';
import type { ScanResult } from '../dom/types';
import { isUserVisible } from '../dom/visibility';

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
 * group is one question, counted once by its base key.
 */
export function requiredLeftOf(scanned: ScanResult, leftRequired: readonly string[] = []): number {
  const left = new Set<string>();
  for (const field of scanned.fields) {
    if (!field.required || field.disabled || !ANSWERABLE.has(field.visibility)) continue;
    if (field.visibility === 'visible' && !field.labelVisible) continue;
    if (emptyNow(field.current)) left.add(field.baseKey);
  }
  for (const key of leftRequired) {
    const field = scanned.fields.find((candidate) => candidate.key === key);
    if (field !== undefined && !emptyNow(field.current)) continue;
    left.add(field?.baseKey ?? key);
  }
  return left.size;
}

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
  if (target === 'submit' && unsolvedCaptchas(page.doc, page.root, cache) > 0) return { outcome: 'blocked' };
  const finality = finalityOf(page);
  if (finality !== (target === 'next' ? 'not-final' : 'final')) return { outcome: 'not-offered' };
  const button = buttonOf(page, target);
  if (!pressable(button, cache)) return { outcome: 'not-offered' };
  if (target === 'submit' && !options.confirmed) {
    const count = requiredLeftOf(page.scan(), page.leftRequired?.() ?? []);
    if (count > 0) return { outcome: 'required-empty', count };
  }
  const { acted, invalid } = invalidDuring(page, () => (target === 'next'
    ? clickIfAllowed(button, { adapter: page.adapter, root: page.root, allowNext: true })
    : clickAdapterSubmit(page.adapter, page.root) === button));
  if (!acted) return { outcome: 'refused' };
  return invalid > 0 ? { outcome: 'not-accepted', count: invalid } : { outcome: 'pressed' };
}

/** How many problems the page shows on the step now: the adapter's visible errors, `invalid` fields it marked, or
 *  Ashby's failure message (one). 0: none. */
export function refusalNow(page: Pick<PressPage, 'doc' | 'adapter' | 'root'>, invalid = 0): number {
  const cache = newScanCache();
  let errors = 0;
  try {
    errors = (page.adapter.errors?.(page.root) ?? []).filter((error) => error.el.isConnected
      && isUserVisible(error.el, cache)).length;
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
