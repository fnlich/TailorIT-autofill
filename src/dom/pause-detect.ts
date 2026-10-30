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
 * - Workday's entry choice is the adapter's to declare.
 * Detection never touches the challenge: it only reads where it is.
 */
import type { Adapter } from '../adapters/types';
import { isAuthField } from './kinds';
import { labelOfControl } from './labels';
import { type ScanCache, viewOf, newScanCache } from './scan-cache';
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

/** The reason this frame's step needs the person, or null. `root` is the form root (null when the page has none). */
export function detectPause(doc: Document, root: Element | null, adapter: Adapter | null,
  cache: ScanCache = newScanCache()): PauseSignal | null {
  const declared = adapter?.authState?.(doc) ?? null;
  if (declared !== null) return { kind: declared, evidence: 'adapter' };
  const captcha = captchaEvidence(doc, root, cache);
  if (captcha !== null) return { kind: 'captcha', evidence: captcha };
  const inputs = Array.from(doc.querySelectorAll('input')).filter((input) => isUserVisible(input, cache));
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

function captchaEvidence(doc: Document, root: Element | null, cache: ScanCache): PauseEvidence | null {
  const view = viewOf(doc);
  for (const frame of Array.from(doc.querySelectorAll('iframe'))) {
    if (frame.closest('.grecaptcha-badge') !== null || !isUserVisible(frame, cache)) continue;
    if (isChallengeFrame(frame.src, view) && overOrInside(frame, root)) return 'captcha-frame';
  }
  for (const container of Array.from(doc.querySelectorAll(CAPTCHA_CONTAINERS))) {
    const tag = container.localName;
    // Invisible mode binds the widget to a button, or says data-size="invisible": no challenge is shown.
    if (tag === 'button' || tag === 'input' || tag === 'a') continue;
    if ((container.getAttribute('data-size') ?? '').toLowerCase() === 'invisible') continue;
    if (container.closest('.grecaptcha-badge') !== null || !isUserVisible(container, cache)) continue;
    if (overOrInside(container, root)) return 'captcha-container';
  }
  return null;
}

/** A frame address on a vendor's challenge host. An invisible reCAPTCHA anchor says size=invisible. */
function isChallengeFrame(src: string, view: (Window & typeof globalThis) | null): boolean {
  if (src === '' || view === null) return false;
  let url: URL;
  try {
    url = new view.URL(src);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (['google.com', 'www.google.com', 'recaptcha.net', 'www.recaptcha.net'].includes(host)) {
    return url.pathname.startsWith('/recaptcha/') && url.searchParams.get('size') !== 'invisible';
  }
  return host === 'hcaptcha.com' || host.endsWith('.hcaptcha.com') || host === 'challenges.cloudflare.com'
    || host === 'arkoselabs.com' || host.endsWith('.arkoselabs.com');
}

/** Inside the form root, or drawn over it. Anywhere on the page when there is no form root. */
function overOrInside(el: Element, root: Element | null): boolean {
  if (root === null || root.contains(el)) return true;
  const a = el.getBoundingClientRect();
  const b = root.getBoundingClientRect();
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}
