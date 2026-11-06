/*
 * The Oracle Recruiting Cloud adapter (its Candidate Experience; docs/design/runtime.md §9; docs/ARCHITECTURE.md
 * "Adapters", "Oracle Recruiting Cloud"): the quirks of a tenant's public pages, its posting and its email gate. Every
 * hook was read from the public capture of 2026-11-04/05 (docs/FIXTURES.md, "The Workday, iCIMS, Taleo, SuccessFactors
 * and Oracle capture"; elhr on us2 and JPMC's region-less tenant: JPMC's posting and elhr's gate converted as
 * fixtures/oracle/*.html) and names the markup it relies on. There is no password anywhere: identity is the email gate, whose Next sends the candidate a code
 * (a PIN). The code's page and the application's sections after it are not public: they wait for the owner's
 * snapshots; no hook below is written for the sections, which are read with the standard semantics the generic adapter
 * gives. The site is a single-page application (Knockout and Oracle JET): the posting is drawn 5 to 6 s after the address
 * commits, and APPLY NOW changes the address in place to .../apply/email, whose gate is drawn about 3 s later
 * (quirks.formLateMs: the runtime's 30 s cap).
 * - Form root: the application flow's content, main#main > section.apply-flow__content (the main labelled by
 *   h1#apply-flow-main-heading, "Job application form"), which holds the gate and, by the flow, the steps after it in
 *   the same document. The posting has none.
 * - The posting (postingText): the first .job-details__description-content (the description; the second is "about").
 * - Entry (entryControl): the first visible "APPLY NOW", button.apply-now-button in .job-details__section-apply-button
 *   (a typeless button with no form), a route change in the same document after which the gate is drawn there: the
 *   runtime's late watch finds it. Never pressed by a run (entryNeverPressed).
 * - authState: the gate is an 'email-gate', read by its address first (url.ts isOracleEmailGate: .../job/<id>/apply/email;
 *   the page's own address, or a fixture's base address) and its email box (input[name=primary-email]) in the flow: a
 *   later step that holds the same box is no gate (the v3 Phase 6/7b review, S2). The code's page is 'email-code' by the
 *   one sign Jobright's reading gives and no snapshot shows yet: four or more one-character boxes (maxlength 1) in the
 *   flow.
 * - Sign-in Auto (signInForm, wall 'email-gate'; docs/SPEC-AMENDMENTS.md §12): the gate as authState reads it, whose
 *   form also holds what only the gate has: its CANCEL (data-qa=emailVerificationCancelButton) and its honeypot
 *   (input[name=honey-pot], aria-hidden, out of the tab order, drawn invisible, never typed into). That form has no
 *   method and no action, sent by Oracle's own script (scriptSubmits); its email input[name=primary-email][type=email],
 *   drawn in front of the flow's background image (colourUnknown: the colour test's one opt-out); its terms box
 *   input#legal-disclaimer-checkbox ("I agree with the terms and conditions", required, drawn at 0 by 0 behind its
 *   label) on a gate that shows one; its NEXT, the submit button whose title, aria-label or words read "Next" (never
 *   "the form's one submit button": the flow's pagination button is shared), which the page enables once the form is
 *   filled (enablesWhenFilled). The terms box is reached through its label, whose words must read clear: on the
 *   captured tenants they are drawn over that image too, so Sign-in Auto refuses those gates ('hidden') and the gate is
 *   the person's, failing closed. The code NEXT sends is the person's. Sign-in Auto acts only on a host the every-site
 *   sign-in covers (<tenant>.fa.<region>.oraclecloud.com): JPMC's region-less host is not, until TailorIT's contract
 *   widens its pattern (contract API 5).
 * - Never pressed (neverPress): APPLY NOW (the entry door's alone), the gate's CANCEL, the dialogs' buttons (the cookie
 *   preferences, the session's end, the agreement's Close), the map's controls, the Digital Assistant's chat button and
 *   the copyright links.
 * Nothing here reads, logs or sends a value.
 */
import { newScanCache, type ScanCache } from '../../dom/scan-cache';
import { isUserVisible } from '../../dom/visibility';
import { genericAdapter } from '../generic';
import type { Adapter, SignInForm, SignInWall } from '../types';
import { canonicalApplicationUrl, isOracleEmailGate, matchesUrl } from './url';

/** The snapshots the hooks were written from (fixtures/oracle/). */
export const ORACLE_SNAPSHOTS = ['fixtures/oracle/jpmc-posting.html', 'fixtures/oracle/elhr-email-gate.html'] as const;

/** The longest an Oracle page takes to draw its posting or its gate: the runtime's cap. */
export const ORACLE_FORM_LATE_MS = 30_000;
/** How long the agent's entry waits for APPLY NOW (the posting is drawn 5 to 6 s after the address commits). */
export const ORACLE_ENTRY_WAIT_MS = 15_000;
/** The fewest one-character boxes that make a code's page (Jobright's sign: no snapshot shows it yet). */
const CODE_BOXES = 4;

/** The first of `elements` a person can see. */
function shown<T extends Element>(elements: readonly T[], cache: ScanCache = newScanCache()): T | null {
  return elements.find((el) => isUserVisible(el, cache)) ?? null;
}

/** The flow's content: fixtures/oracle/elhr-email-gate.html's <main id="main" aria-labelledby="apply-flow-main-heading"
 *  ...><section class="apply-flow__content" ...>. */
function flowOf(doc: Document): Element | null {
  return shown(Array.from(doc.querySelectorAll(
    'main[aria-labelledby="apply-flow-main-heading"] section.apply-flow__content')));
}

function detect(doc: Document): { formRoot: Element } | null {
  const flow = flowOf(doc);
  return flow === null ? null : { formRoot: flow };
}

/** The document's own address: its location's, or (a fixture's srcdoc page) its base address; null when neither
 *  reads. */
function addressOf(doc: Document): URL | null {
  try {
    const href = doc.location.href;
    return new URL(/^https?:/i.test(href) ? href : doc.baseURI);
  } catch {
    return null;
  }
}

/** The gate's email box, on the gate's address alone (module header): <input ... id="primary-email-0"
 *  name="primary-email" type="email" autocomplete="email" aria-required="true">, a person can see it. */
function gateEmail(doc: Document): HTMLInputElement | null {
  const address = addressOf(doc);
  const flow = address === null || !isOracleEmailGate(address) ? null : flowOf(doc);
  return flow === null ? null
    : shown(Array.from(flow.querySelectorAll<HTMLInputElement>('input[name="primary-email"][type="email"]')));
}

/** The words a button goes by: its title, its aria-label and its text, each trimmed, in lower case. */
const namesOf = (button: Element) => [button.getAttribute('title'), button.getAttribute('aria-label'),
  button.textContent].map((name) => (name ?? '').replace(/\s+/g, ' ').trim().toLowerCase());

/** The posting's own text: fixtures/oracle/jpmc-posting.html's first <div class="job-details__description-content">. */
function postingText(doc: Document): Element | null {
  return shown(Array.from(doc.querySelectorAll('.job-details__description-content')));
}

/** APPLY NOW: <div class="job-details__section-apply-button"><button class="... apply-now-button ...">. */
function entryControl(doc: Document): HTMLElement | null {
  return shown(Array.from(doc.querySelectorAll<HTMLElement>(
    '.job-details__section-apply-button button.apply-now-button')));
}

function authState(doc: Document): ReturnType<NonNullable<Adapter['authState']>> {
  const flow = flowOf(doc);
  if (flow === null) return null;
  if (gateEmail(doc) !== null) return 'email-gate';
  const cache = newScanCache();
  const boxes = Array.from(flow.querySelectorAll<HTMLInputElement>('input')).filter((input) => input.maxLength === 1
    && ['text', 'tel', 'number', ''].includes(input.type) && isUserVisible(input, cache));
  return boxes.length >= CODE_BOXES ? 'email-code' : null;
}

/** Sign-in Auto's form at the gate (module header): fixtures/oracle/elhr-email-gate.html's <form novalidate=""> (no
 *  method, no action) holding its email, its <button type="button" ... data-qa="emailVerificationCancelButton"
 *  title="Cancel">, its <input ... name="honey-pot" ... aria-hidden="true" tabindex="-1">, its terms box <input
 *  type="checkbox" class="input-row__hidden-control" id="legal-disclaimer-checkbox" ... required=""> and its <button
 *  type="submit" ... title="Next" aria-label="Next">. */
function signInForm(doc: Document, wall: SignInWall): SignInForm | null {
  if (wall !== 'email-gate') return null;
  const email = gateEmail(doc);
  const form = email?.form ?? null;
  if (email === null || form === null || form.querySelector('[data-qa="emailVerificationCancelButton"]') === null
    || form.querySelector('input[name="honey-pot"]') === null) return null;
  const buttons = Array.from(form.querySelectorAll<HTMLButtonElement>('button[type="submit"]'))
    .filter((button) => button.form === form && isUserVisible(button) && namesOf(button).includes('next'));
  if (buttons.length !== 1) return null;
  const terms = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]#legal-disclaimer-checkbox'))
    .filter((box) => !box.checked);
  return { email, password: null, confirm: null, terms, button: buttons[0]!, form, colourUnknown: [email],
    enablesWhenFilled: true, scriptSubmits: true };
}

/** The controls never pressed (module header): the gate's <button type="button" ...
 *  data-qa="emailVerificationCancelButton" title="Cancel">, the dialogs' <button class="app-dialog__close ...">, their
 *  footers' buttons, the map's controls (maplibregl-ctrl-*), the chat (.oda-chat-button) and the copyright links. */
const NEVER_PRESSED = ['.job-details__section-apply-button button.apply-now-button',
  '[data-qa="emailVerificationCancelButton"]', 'button.app-dialog__close', '.app-dialog__footer-button',
  '[class*="maplibregl-ctrl"]', 'button.maplibregl-popup-close-button', '.oda-chat-button', 'a.oracle-copyright',
  'a.oracle-copyright__terms', 'a.oracle-copyright__legal'];

function neverPress(root: Element): Element[] {
  return Array.from(root.ownerDocument.querySelectorAll(NEVER_PRESSED.join(', ')));
}

/** The Oracle Recruiting Cloud adapter. */
export const oracleAdapter: Adapter = {
  id: 'oracle',
  matchesUrl,
  canonicalApplicationUrl,
  detect,
  postingText,
  authState,
  signInForm,
  neverPress,
  errors: (root) => genericAdapter.errors?.(root) ?? [],
  isFinalStep: () => 'unknown',
  quirks: { formLateMs: ORACLE_FORM_LATE_MS, entryWaitMs: ORACLE_ENTRY_WAIT_MS },
  entryControl,
  // APPLY NOW is never pressed by a run (neverPress): the entry door presses that element alone.
  entryNeverPressed: true,
};
