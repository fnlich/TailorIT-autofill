/*
 * When a step needs the person, not the extension (docs/design/runtime.md §5.11; docs/ARCHITECTURE.md "Pauses"). On
 * such a step nothing is filled, not even the email, and the run hands control back until a trusted Continue.
 * - Sign-in and accounts: a visible password field means a sign-in; two of them, or a "confirm password" label, an
 *   account creation. A visible one-time-code field (autocomplete="one-time-code", or a label naming a verification,
 *   security or one-time code) means an email code. The adapter's authState adds what a platform's snapshots show.
 * - CAPTCHA: recognised only from the vendors' documented markup. A visible challenge frame from reCAPTCHA
 *   (google.com or recaptcha.net under /recaptcha/), hCaptcha (hcaptcha.com), Cloudflare Turnstile
 *   (challenges.cloudflare.com) or Arkose Labs (arkoselabs.com), or a visible explicit-render container (.g-recaptcha,
 *   .h-captcha, .cf-turnstile, [data-sitekey]) over or inside the form. The invisible reCAPTCHA badge and a widget
 *   bound to a button (invisible mode) do not pause. Phase 5 confirms this markup against the vendors' documentation.
 *   A widget the person solved holds its response token in the field the vendor puts inside it (g-recaptcha-response,
 *   h-captcha-response, cf-turnstile-response): it does not pause, and neither does its frame (the Phase 5 review,
 *   X-S4). The token is only read for being there: it is never kept, sent or logged.
 * - Workday's entry choice is the adapter's to declare.
 * - The whole document is read, open shadow roots included (the scanner fills fields there: the Phase 5 review, X-S6);
 *   the extension's own UI never is.
 * - PauseOptions.handed: the CAPTCHA frames and containers the person was already handed on this step (their trusted
 *   Continue at its pause: captchaElements). Those do not pause again; a sign-in, an email code or another widget does.
 *   They still count in unsolvedCaptchas, which keeps auto-advance from pressing Next on the step until the widget is
 *   known solved (its token there; an Arkose widget, which holds none, never is).
 * Detection never touches the challenge: it only reads where it is.
 */
import type { Adapter } from '../adapters/types';
import { isAuthField } from './kinds';
import { labelOfControl } from './labels';
import { isInOwnUi } from './own-ui';
import { flatContains, type ScanCache, viewOf, newScanCache } from './scan-cache';
import { isUserVisible } from './visibility';

/** Why a step pauses. */
export const PAUSE_KINDS = ['sign-in', 'create-account', 'email-code', 'captcha', 'entry-choice'] as const;
export type PauseKind = (typeof PAUSE_KINDS)[number];

/** What showed it. */
export const PAUSE_EVIDENCE = ['adapter', 'password', 'confirm-password', 'one-time-code', 'code-label',
  'captcha-frame', 'captcha-container'] as const;
export type PauseEvidence = (typeof PAUSE_EVIDENCE)[number];

/** A pause, and what showed it (never what the page says). */
export interface PauseSignal {
  kind: PauseKind;
  evidence: PauseEvidence;
}

const CONFIRM_PASSWORD = /\b(?:confirm|re-?enter|repeat|retype|verify)\b.*\bpassword\b|\bpassword\b.*\b(?:again|confirmation)\b/i;
const CODE_LABEL = /\b(?:verification|security|confirmation|one[-\s]?time|authentication|access|login|sign[-\s]?in|e-?mail(?:ed)?|sms|text)\s+(?:code|pin|passcode)\b|\bpass\s?code\b|\botp\b/i;
const CAPTCHA_CONTAINERS = '.g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey]';
/** The fields the vendors put inside a widget for its response token (reCAPTCHA's, hCaptcha's, Turnstile's). */
const RESPONSE_FIELDS = 'textarea[name="g-recaptcha-response"], textarea[name="h-captcha-response"], '
  + 'input[name="cf-turnstile-response"]';

/** What else detectPause reads. */
export interface PauseOptions {
  /** The CAPTCHA frames and containers the person was handed on this step (captchaElements, at their Continue). */
  handed?: ReadonlySet<Element>;
}

/** The reason this frame's step needs the person, or null. `root` is the form root (null when the page has none). */
export function detectPause(doc: Document, root: Element | null, adapter: Adapter | null,
  cache: ScanCache = newScanCache(), options: PauseOptions = {}): PauseSignal | null {
  const declared = adapter?.authState?.(doc) ?? null;
  if (declared !== null) return { kind: declared, evidence: 'adapter' };
  const scopes = scopesOf(doc);
  const captcha = shownCaptchas(scopes, root, cache).find((shown) => !isHanded(shown.el, options.handed));
  if (captcha !== undefined) return { kind: 'captcha', evidence: captcha.evidence };
  const inputs = all<HTMLInputElement>(scopes, 'input').filter((input) => isUserVisible(input, cache));
  const passwords = inputs.filter((input) => input.type === 'password');
  if (passwords.length >= 2) return { kind: 'create-account', evidence: 'password' };
  if (passwords.length === 1) {
    const label = labelOfControl(passwords[0]!, { cache, adapter });
    return CONFIRM_PASSWORD.test(label.text) ? { kind: 'create-account', evidence: 'confirm-password' }
      : { kind: 'sign-in', evidence: 'password' };
  }
  if (inputs.some((input) => input.type !== 'password' && isAuthField(input))) {
    return { kind: 'email-code', evidence: 'one-time-code' };
  }
  const textLike = inputs.filter((input) => ['text', 'tel', 'number', 'search', ''].includes(input.type));
  if (textLike.some((input) => CODE_LABEL.test(labelOfControl(input, { cache, adapter }).text))) {
    return { kind: 'email-code', evidence: 'code-label' };
  }
  return null;
}

/** The CAPTCHA frames and containers a step shows now, each frame's container with it: what the person is handed at a
 *  CAPTCHA pause (PauseOptions.handed). Elements only, never what they hold. */
export function captchaElements(doc: Document, root: Element | null, cache: ScanCache = newScanCache()): Element[] {
  const found = new Set<Element>();
  for (const shown of shownCaptchas(scopesOf(doc), root, cache)) {
    found.add(shown.el);
    const container = shown.el.closest(CAPTCHA_CONTAINERS);
    if (container !== null) found.add(container);
  }
  return [...found];
}

/** How many CAPTCHA frames and containers the step shows that are not known solved: a token-bearing widget whose
 *  response token is empty, and every Arkose frame, handed to the person or not. Auto-advance never presses Next on a
 *  step that shows one (the Phase 5 review, X-S4 tightened by the coordinator): the person presses it. */
export function unsolvedCaptchas(doc: Document, root: Element | null, cache: ScanCache = newScanCache()): number {
  return shownCaptchas(scopesOf(doc), root, cache).length;
}

/** The document and every open shadow root in it, nested ones included; the extension's own UI is never entered. */
function scopesOf(doc: Document): Array<Document | ShadowRoot> {
  const scopes: Array<Document | ShadowRoot> = [doc];
  for (let at = 0; at < scopes.length; at += 1) {
    for (const el of Array.from(scopes[at]!.querySelectorAll('*'))) {
      if (el.shadowRoot !== null && !isInOwnUi(el)) scopes.push(el.shadowRoot);
    }
  }
  return scopes;
}

/** Every element of the scopes matching `selector`, the extension's UI excluded. */
function all<T extends Element>(scopes: ReadonlyArray<Document | ShadowRoot>, selector: string): T[] {
  return scopes.flatMap((scope) => Array.from(scope.querySelectorAll<T>(selector))).filter((el) => !isInOwnUi(el));
}

/** The visible challenge frames, then the visible containers, over or inside the form, none of them solved. */
function shownCaptchas(scopes: ReadonlyArray<Document | ShadowRoot>, root: Element | null, cache: ScanCache):
  Array<{ el: Element; evidence: PauseEvidence }> {
  const shown: Array<{ el: Element; evidence: PauseEvidence }> = [];
  const view = scopes[0] === undefined ? null : viewOf(scopes[0]);
  for (const frame of all<HTMLIFrameElement>(scopes, 'iframe')) {
    if (frame.closest('.grecaptcha-badge') !== null || !isUserVisible(frame, cache)) continue;
    const vendor = challengeVendor(frame.src, view);
    if (vendor === null || !overOrInside(frame, root)) continue;
    // Only a vendor that puts a response token in its widget can be known solved; Arkose's never is.
    const container = frame.closest(CAPTCHA_CONTAINERS);
    if (vendor === 'token' && container !== null && solved(container)) continue;
    shown.push({ el: frame, evidence: 'captcha-frame' });
  }
  for (const container of all(scopes, CAPTCHA_CONTAINERS)) {
    const tag = container.localName;
    // Invisible mode binds the widget to a button, or says data-size="invisible": no challenge is shown.
    if (tag === 'button' || tag === 'input' || tag === 'a') continue;
    if ((container.getAttribute('data-size') ?? '').toLowerCase() === 'invisible') continue;
    if (container.closest('.grecaptcha-badge') !== null || !isUserVisible(container, cache)) continue;
    if (overOrInside(container, root) && !solved(container)) shown.push({ el: container, evidence: 'captcha-container' });
  }
  return shown;
}

/** A widget that holds its response token in the vendor's own field inside it: the person solved it. */
function solved(container: Element): boolean {
  return Array.from(container.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>(RESPONSE_FIELDS))
    .some((field) => field.value.trim() !== '');
}

/** One the person was handed: itself, or the container around it. */
function isHanded(el: Element, handed: ReadonlySet<Element> | undefined): boolean {
  if (handed === undefined || handed.size === 0) return false;
  if (handed.has(el)) return true;
  const container = el.closest(CAPTCHA_CONTAINERS);
  return container !== null && handed.has(container);
}

/** A frame address on a vendor's challenge host: 'token' for a vendor whose widget holds its response token
 *  (reCAPTCHA, hCaptcha, Turnstile), 'no-token' for one whose widget holds none (Arkose Labs), null for any other
 *  address. An invisible reCAPTCHA anchor says size=invisible. */
function challengeVendor(src: string, view: (Window & typeof globalThis) | null): 'token' | 'no-token' | null {
  if (src === '' || view === null) return null;
  let url: URL;
  try {
    url = new view.URL(src);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  if (['google.com', 'www.google.com', 'recaptcha.net', 'www.recaptcha.net'].includes(host)) {
    return url.pathname.startsWith('/recaptcha/') && url.searchParams.get('size') !== 'invisible' ? 'token' : null;
  }
  if (host === 'hcaptcha.com' || host.endsWith('.hcaptcha.com') || host === 'challenges.cloudflare.com') return 'token';
  return host === 'arkoselabs.com' || host.endsWith('.arkoselabs.com') ? 'no-token' : null;
}

/** Inside the form root (shadow roots crossed), or drawn over it. Anywhere on the page when there is no form root. */
function overOrInside(el: Element, root: Element | null): boolean {
  if (root === null || flatContains(root, el)) return true;
  const a = el.getBoundingClientRect();
  const b = root.getBoundingClientRect();
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}
