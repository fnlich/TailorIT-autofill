/*
 * The platforms' signs that an application was sent (v3 Phase 4; docs/ARCHITECTURE.md "v3 Phase 4"), read in the
 * isolated world only. A sign counts only after a Submit was pressed in this tab (the runtime arms it: the person's
 * trusted click on the adapter's own Submit, or the panel's or Submit mode Auto's press), and the worker takes it only
 * for an application this tab armed: page text alone never says an application was sent.
 * - Lever: the page after submitting, /<site>/<posting>/thanks (adapters/lever/url.ts reads it as the confirmation
 *   page), a new document.
 * - Greenhouse: /<board>/jobs/<id>/confirmation (adapters/greenhouse/url.ts), whose page shows
 *   main > div.confirmation > div.confirmation__content with "Thank you for applying to <company>!" (a read-only GET of
 *   a live posting's confirmation address, 2026-11-02: nothing was submitted); the same block drawn in the form's own
 *   document counts too.
 * - Ashby: .ashby-application-form-success-container in the form's place, the same address (the Ashby capture,
 *   adapters/ashby ashbySubmitted).
 * - Workable: [data-ui=successful-submit] drawn in the page, the same address (Jobright 1.25.2's selector, not seen live:
 *   adapters/workable workableSubmitted).
 * Workday and the generic adapter read none yet.
 *
 * A sign drawn in the form's own document (the v3 Phase 4 review, M1 and M6) counts only when it is new: not one of the
 * signs the page showed when the Submit was pressed (signsOf, read at the press), shown where the form was (the form
 * root, as the press found it, is gone or hidden), and never inside the posting's own text (Adapter.postingText), which
 * a posting's author writes.
 */
import { ashbySubmitted } from '../adapters/ashby';
import type { Adapter } from '../adapters/types';
import { workableSubmitted } from '../adapters/workable';
import type { Platform } from '../core/enums';
import { newScanCache } from '../dom/scan-cache';
import { isUserVisible } from '../dom/visibility';

/** How long after the panel's or Submit mode Auto's press the platform's confirmation is waited for in the form's own
 *  document, before the review says to check the page (submit-unconfirmed). A page that navigates is the next
 *  document's to confirm. */
export const SUBMIT_CONFIRM_MS = 45_000;

/** What a press of ours reads just before its click (the review, M1 and M6): the application and platform the page
 *  shows, its form root and adapter, and the success signs already there. The click may move the page (a confirmation
 *  drawn in place, an address the parser does not read) before the press is armed. */
export interface PressSnapshot {
  applicationKey: string;
  platform: Platform;
  root: Element;
  adapter: Adapter;
  signs: ReadonlySet<Element>;
}

/** The platform's success blocks in the document (shown or not). */
export function signsOf(doc: Document, platform: Platform): Element[] {
  if (platform === 'ashby') {
    return ashbySubmitted(doc) ? [...doc.querySelectorAll('.ashby-application-form-success-container')] : [];
  }
  // The live confirmation page: <main class="main ..."><div class="confirmation">...<div class="confirmation__content">
  if (platform === 'greenhouse') return [...doc.querySelectorAll('.confirmation .confirmation__content')];
  if (platform === 'workable') {
    return workableSubmitted(doc) ? [...doc.querySelectorAll('[data-ui="successful-submit"]')] : [];
  }
  return [];
}

/** Whether the document shows the platform's success message (shown, anywhere). */
export function successShown(doc: Document, platform: Platform): boolean {
  const cache = newScanCache();
  return signsOf(doc, platform).some((sign) => isUserVisible(sign, cache));
}

/** A success sign that is this Submit's (module header): shown now, not among `before` (the signs at the press), the
 *  form root gone or hidden, and outside the posting's own text. Null when there is none. */
export function newSuccessSign(doc: Document, platform: Platform, armedWith: { before: ReadonlySet<Element>;
  root: Element; adapter: Adapter }): Element | null {
  const cache = newScanCache();
  const rootGone = !armedWith.root.isConnected || !isUserVisible(armedWith.root, cache);
  if (!rootGone) return null;
  let posting: Element | null = null;
  try {
    posting = armedWith.adapter.postingText?.(doc) ?? null;
  } catch {
    posting = null;
  }
  return signsOf(doc, platform).find((sign) => !armedWith.before.has(sign) && isUserVisible(sign, cache)
    && (posting === null || !posting.contains(sign))) ?? null;
}
