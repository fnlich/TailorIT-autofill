/*
 * v5 p2-fill: the wait for a page's own résumé parse (Adapter.quirks.resumeParse, PLAN Phase 2; core/plan/order.ts puts
 * the résumé first). After the résumé went into its input (and the page said its upload was done, where its adapter
 * reads that), the page reads the file and fills the application's fields from it: Rippling ("The résumé will be parsed
 * to fill in the application details": fixtures/rippling/qu-careers-form.html), iCIMS ("Parsing resume, please
 * wait...", then the page loaded again: fixtures/icims/nyu-profile.frame-1.html). The pass writes the rest only once
 * that is over, so its answers go over the parse and the parse never goes over them:
 * - the form's own values are what a parse changes, and a value set by a page's script changes no attribute a
 *   MutationObserver could hear, so the form's text boxes, rich-text boxes, lists, radios and boxes are read every
 *   PARSE_POLL_MS (in this frame's memory only, compared, never kept, sent or logged), with the page's busy signs
 *   (dom/settle.ts busySigns: aria-busy, a progress bar, the adapter's own: iCIMS's "Parsing resume");
 * - 'none': nothing changed and nothing showed busy within PARSE_START_MS (a page that parses nothing this time);
 * - 'parsed': the values changed or a busy sign showed, and then PARSE_QUIET_MS passed with no change and no busy sign;
 * - 'timed-out': still changing or busy at PARSE_CAP_MS (the pass goes on: its own settle and verification follow);
 * - 'aborted': the run ended (the document going away, as iCIMS's reload takes it, ends it too).
 * Bounded at every step; nothing here writes, clicks or focuses.
 */
import type { Adapter } from '../adapters/types';
import { CONTROL_SELECTOR, isEditingHost } from './kinds';
import { busySigns } from './settle';
import { deadline, monotonicNow } from './time';
import { textOfControl } from './values';

/** How often the form's values are read while a parse may be under way. */
export const PARSE_POLL_MS = 100;
/** How long a parse has to show (a value changed, a busy sign) before the page is taken to parse nothing. */
export const PARSE_START_MS = 3_000;
/** How long the form stays as it is, with no busy sign, before a parse is taken to be over. */
export const PARSE_QUIET_MS = 800;
/** The longest a parse is waited for. */
export const PARSE_CAP_MS = 20_000;

/** What a parse wait came to (see the header). */
export type ParseOutcome = 'none' | 'parsed' | 'timed-out' | 'aborted';

/** The wait's windows, for tests. */
export interface ParseTimings {
  pollMs?: number;
  startMs?: number;
  quietMs?: number;
  capMs?: number;
}

/** The form's values now, as one string (memory only): every native control's but a file input's, and every rich-text
 *  box's, open shadow roots included. */
function valuesOf(root: Element): string {
  const parts: string[] = [];
  const visit = (scope: Element | ShadowRoot): void => {
    for (const el of Array.from(scope.querySelectorAll(`${CONTROL_SELECTOR}, [contenteditable]`))) {
      if (el.localName === 'select') parts.push(String((el as HTMLSelectElement).selectedIndex));
      else if (el.localName === 'input' && ['radio', 'checkbox'].includes((el as HTMLInputElement).type)) {
        parts.push((el as HTMLInputElement).checked ? '1' : '0');
      } else if (el.localName === 'input' && (el as HTMLInputElement).type === 'file') {
        // The file inputs are the upload's, never the parse's (a widget that takes the file empties its input).
        continue;
      } else if (el.matches(CONTROL_SELECTOR) || isEditingHost(el)) parts.push(textOfControl(el));
    }
    for (const el of Array.from(scope.querySelectorAll('*'))) if (el.shadowRoot !== null) visit(el.shadowRoot);
  };
  visit(root);
  return parts.join('\u0000');
}

/** Waits for the page's parse of the résumé just put into its form (see the header). `root` is read at each look (the
 *  run finds its form root again: a page may draw the form anew from the parse). */
export async function awaitResumeParse(root: () => Element, adapter: Adapter | null, signal: AbortSignal,
  timings: ParseTimings = {}): Promise<{ outcome: ParseOutcome; ms: number; changed: boolean }> {
  const pollMs = timings.pollMs ?? PARSE_POLL_MS;
  const startMs = timings.startMs ?? PARSE_START_MS;
  const quietMs = timings.quietMs ?? PARSE_QUIET_MS;
  const capMs = timings.capMs ?? PARSE_CAP_MS;
  const started = monotonicNow();
  let last = valuesOf(root());
  let changed = false;
  let busySeen = false;
  let quietSince = started;
  for (;;) {
    if (signal.aborted) return { outcome: 'aborted', ms: monotonicNow() - started, changed };
    const now = monotonicNow();
    const form = root();
    const values = valuesOf(form);
    const busy = busySigns(form, adapter).length > 0;
    if (values !== last) {
      last = values;
      changed = true;
      quietSince = now;
    }
    if (busy) {
      busySeen = true;
      quietSince = now;
    }
    const ms = now - started;
    if (!changed && !busySeen && ms >= startMs) return { outcome: 'none', ms, changed };
    if ((changed || busySeen) && !busy && now - quietSince >= quietMs) return { outcome: 'parsed', ms, changed };
    if (ms >= capMs) return { outcome: 'timed-out', ms, changed };
    if ((await deadline(pollMs, signal)) === 'aborted') return { outcome: 'aborted', ms: monotonicNow() - started, changed };
  }
}
