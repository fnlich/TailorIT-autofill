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
 * - The configured platforms (DESIGN-NEW-ATS Phase 0): the `success` element their config names (adapters/configured
 *   ATS_CONFIGS), drawn in the form's place, under the same rules as every sign drawn in the form's own document; a
 *   confirmation page their address reading names is a new document's to confirm, as Lever's is.
 * - iCIMS (the owner's snapshots of 2026-11-06, docs/ARCHITECTURE.md, the snapshot build of 2026-11-06; core-x, item 5): the page after the last step's
 *   Submit, /jobs/<id>/<slug>/job?mode=submit_apply (adapters/icims/url.ts reads it as the confirmation page), shows
 *   div.iCIMS_Message.iCIMS_SuccessMessage "Your application has been submitted successfully." (uscareers-nyu's,
 *   adapters/icims icimsSubmitted); the same block drawn in the form's own document counts too.
 * The generic adapter reads none (v5 p2-detect: Workday's and SuccessFactors' drawn signs are below, beside their network
 * signs).
 * v5 p2-detect (PLAN decision 14; the engine audit's J11 and gap 3): the platforms whose page after submitting no
 * snapshot shows are told sent by other signs, each from Jobright's observed behaviour (never its code):
 * - a confirmation address (each platform's url.ts reads it as the application's page after submitting, under its
 *   key, so it counts as Lever's /thanks does): Rippling's ?step=confirmation, CareerPlug's /jobs/<id>/apps/<n>,
 *   Paylocity's /recruiting/jobs/success/<id>, SmartRecruiters' .../publication/<uuid>/success, Paycor's
 *   ShowConfirmation.action, Jobvite's .../applyConfirmation and Dayforce's .../apply/success;
 * - the answer to the platform's own request that sends the application, which the page-world submit watcher sees
 *   (page/submit-watch.ts; dom/submit-net-protocol.ts): Workday's finalize answered naming the application (its answer's
 *   id, no errors), ClearCompany's last answers and completed message (status alone), Oracle's CREATE then CONFIRM for
 *   the page's posting (the request's action, the answers' submissionId and flags) and SuccessFactors' applyJob callback
 *   saying it took this posting's new application, each a yes or no the watcher reads and drops. watchNetworkSigns
 *   reads them in this document while a Submit is armed, in the platform's order, and the runtime takes them only while
 *   the page shows no error (content/press.ts refusalNow): `submit/detected` with evidence 'network', which the worker
 *   takes only from the frame and document that armed it. The P2 review (security 1): on an employer's own domain
 *   (Oracle's Candidate Experience there) the signs alone never count: the document must show the app moved on from its
 *   form as well (content/runtime.ts oracleLeftForm);
 * - drawn signs from Jobright's rules (adapters/success.ts): Workday's and SuccessFactors' (signsOf below), BambooHR's
 *   and JazzHR's (their configs).
 *
 * A sign drawn in the form's own document (the v3 Phase 4 review, M1 and M6) counts only when it is new: not one of the
 * signs the page showed when the Submit was pressed (shownSignsOf, read at the press: the behaviour review of
 * 2026-11-06, M1, a sign hidden then is not among them), shown where the form was (the form
 * root, as the press found it, is gone or hidden), and never inside the posting's own text (Adapter.postingText), which
 * a posting's author writes.
 */
import { ashbySubmitted } from '../adapters/ashby';
import { configuredSuccessSigns } from '../adapters/configured';
import { ATS_CONFIGS } from '../adapters/configured/registry';
import { icimsSubmitted } from '../adapters/icims';
import type { Adapter } from '../adapters/types';
import { workableSubmitted } from '../adapters/workable';
import type { Platform } from '../core/enums';
import { newScanCache } from '../dom/scan-cache';
// ── v5 p2-detect ──
import { isNetPlatform, NET_SEQUENCES, parseNetSign, SUBMIT_NET_EVENT } from '../dom/submit-net-protocol';
import { successSignsOf } from '../adapters/success';
import { SUCCESSFACTORS_SUCCESS } from '../adapters/successfactors';
import { WORKDAY_SUCCESS } from '../adapters/workday';
// ── end v5 p2-detect ──
import { isUserVisible } from '../dom/visibility';

/** How long after the panel's or Submit mode Auto's press the platform's confirmation is waited for in the form's own
 *  document, before the review says to check the page (submit-unconfirmed). A page that navigates is the next
 *  document's to confirm. */
export const SUBMIT_CONFIRM_MS = 45_000;

/** How long after a press its platform's sign is still watched for in the form's own document, quietly, once
 *  SUBMIT_CONFIRM_MS has passed (the audit of 2026-11-06, m10): a sign a slow platform draws later still records the
 *  application. The worker's SUBMIT_ARM_MS (background/submissions.ts), for which it keeps the tab's arm: the same ten
 *  minutes (src/content/submit-watch.test.ts holds them equal). */
export const SUBMIT_WATCH_MS = 10 * 60_000;

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
  // ── snapshot build 2026-11-06 (core-x, item 5): iCIMS's success message (fixtures/icims/nyu-submitted.frame-1.html) ──
  if (platform === 'icims') {
    return icimsSubmitted(doc) ? [...doc.querySelectorAll('.iCIMS_Message.iCIMS_SuccessMessage')] : [];
  }
  // ── v5 p2-detect: Workday's and SuccessFactors' pages after submitting (adapters/success.ts rules, Jobright's) ──
  if (platform === 'workday') return successSignsOf(doc, WORKDAY_SUCCESS);
  if (platform === 'successfactors') return successSignsOf(doc, SUCCESSFACTORS_SUCCESS);
  // DESIGN-NEW-ATS Phase 0: a configured platform's own sign (AtsConfig.success).
  return configuredSuccessSigns(doc, ATS_CONFIGS[platform]);
}

/** The behaviour review of 2026-11-06 (M1): the platform's success signs a person can see now, what a press is armed
 *  with (PressSnapshot.signs). A sign the page holds hidden from the start (Breezy's confirmation, ng-hide in the form
 *  page: fixtures/breezy/concurrent-form) is not among them, so once the page shows it after the Submit it is new. */
export function shownSignsOf(doc: Document, platform: Platform): Set<Element> {
  const cache = newScanCache();
  return new Set(signsOf(doc, platform).filter((sign) => isUserVisible(sign, cache)));
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

// ── v5 p2-detect: the platform's network signs (module header; dom/submit-net-protocol.ts) ──────────────────────────
/** Listens in this document, until `signal` aborts, for the page-world watcher's signs of the platform's application
 *  being sent, and calls `onSent` once each time they have all come in the platform's order (NET_SEQUENCES); a sign out
 *  of its turn, or any other event of that name, changes nothing. A platform with no network sign adds no listener at
 *  all (nothing keyed to the extension sits on a page that has no use for it). */
export function watchNetworkSigns(doc: Document, platform: Platform, signal: AbortSignal, onSent: () => void): void {
  if (!isNetPlatform(platform) || signal.aborted) return;
  const order = NET_SEQUENCES[platform];
  let next = 0;
  doc.addEventListener(SUBMIT_NET_EVENT, (event) => {
    const sign = parseNetSign((event as CustomEvent<unknown>).detail);
    if (sign === null || sign !== order[next]) return;
    next += 1;
    if (next < order.length) return;
    next = 0;
    onSent();
  }, { signal });
}
// ── end v5 p2-detect ──
