/*
 * When a step needs the person, not the extension (docs/design/runtime.md §5.11; docs/ARCHITECTURE.md "Pauses"). On
 * such a step nothing is filled, not even the email, and the run hands control back until a trusted Continue.
 * - Sign-in and accounts: a visible password field means a sign-in; two of them, or a "confirm password" label, an
 *   account creation. A visible one-time-code field (autocomplete="one-time-code", or a label naming a verification,
 *   security or one-time code) means an email code. The adapter's authState adds what a platform's snapshots show.
 * - CAPTCHA: recognised only from the vendors' documented markup. A visible challenge frame from reCAPTCHA
 *   (google.com or recaptcha.net under /recaptcha/), hCaptcha (hcaptcha.com), Cloudflare Turnstile
 *   (challenges.cloudflare.com), Arkose Labs (arkoselabs.com, and FunCaptcha's legacy funcaptcha.com), DataDome
 *   (captcha-delivery.com) or GeeTest (geetest.com), or a visible explicit-render container (.g-recaptcha, .h-captcha,
 *   .cf-turnstile, [data-sitekey], PerimeterX's #px-captcha, GeeTest's .geetest_holder, .geetest_panel,
 *   .geetest_captcha, .geetest_box) over or inside the form, in the document, its open shadow roots or a frame of its
 *   own origin inside it (the v3 Phase 6/7b review's round 2, E10), and (the audit of 2026-11-06, S-7) the parent of a
 *   vendor's empty response field (g-recaptcha-response, h-captcha-response, cf-turnstile-response) that no documented
 *   container holds: a widget rendered into the page's own element. A closed shadow root cannot be read, nor an Arkose
 *   custom domain recognised: a known limit. The invisible reCAPTCHA badge and a widget
 *   bound to a button (invisible mode) do not pause. Phase 5 confirms this markup against the vendors' documentation.
 *   A widget the person solved holds its response token in the field the vendor puts inside it (g-recaptcha-response,
 *   h-captcha-response, cf-turnstile-response): it does not pause, and neither does its frame (the Phase 5 review,
 *   X-S4). The token is only read for being there: it is never kept, sent or logged. A widget that holds no token
 *   (Arkose's, DataDome's, PerimeterX's, GeeTest's) is never known solved.
 * - vendorFramesShown: every visible frame on a vendor's challenge host, solved or not (the invisible reCAPTCHA badge
 *   aside): Sign-in Auto types nothing while one shows (round 2, E10). challengeLikeFramesShown (round 3, X9): every
 *   visible frame of another origin whose address, title, name or label reads like a challenge (CHALLENGE_WORDS: a
 *   vendor this module does not know, a site's own), which Sign-in Auto also waits out; a fill does not pause for one.
 * - pageChallenged (the audit of 2026-11-06, S-7): a challenge not known solved anywhere on the page, or a frame that
 *   reads like one; every Next, Submit and entry press holds while one shows (orchestrator.ts, press.ts).
 * - Workday's entry choice is the adapter's to declare, and so are (v3 Phase 7b) an email gate (an email-first identity
 *   step: Oracle's and iCIMS's, no password) and a password reset (Workday's Forgot Password, Taleo's and SuccessFactors'
 *   password help), whose email box is never filled.
 * - Order: a CAPTCHA shown and not solved (and not handed) comes first, then the adapter's word, then the rules above
 *   (the v3 Phase 6/7b review, S1): a challenge over a sign-in, an account's creation, an email gate or a choice of how
 *   to apply is the person's, so Sign-in Auto types nothing and the agent's entry presses nothing while it shows.
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
export const PAUSE_KINDS = ['sign-in', 'create-account', 'email-gate', 'email-code', 'captcha', 'entry-choice',
  'forgot-password'] as const;
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
const CAPTCHA_CONTAINERS = '.g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey], #px-captcha, .geetest_holder, '
  + '.geetest_panel, .geetest_captcha, .geetest_box';
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
  // A challenge shown and not solved comes first, before any account page the adapter names (the v3 Phase 6/7b
  // review, S1): nothing is typed or pressed while one shows.
  const scopes = scopesOf(doc);
  const captcha = shownCaptchas(scopes, root, cache).find((shown) => !isHanded(shown.el, options.handed));
  if (captcha !== undefined) return { kind: 'captcha', evidence: captcha.evidence };
  const declared = adapter?.authState?.(doc) ?? null;
  if (declared !== null) return { kind: declared, evidence: 'adapter' };
  // Account fields are the page's own: a frame of its origin is read for challenges alone.
  const inputs = all<HTMLInputElement>(scopes.filter((each) => each.frame === null), 'input').map(({ el }) => el)
    .filter((input) => isUserVisible(input, cache));
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

/** A place challenges are looked for: the document, an open shadow root in it, or the document of a frame of its own
 *  origin inside it, with the frame element of `doc` it is drawn in (null for `doc`'s own scopes). */
interface Scope {
  scope: Document | ShadowRoot;
  frame: Element | null;
}

/** The document and every open shadow root in it, nested ones included, and (round 2, E10) the documents of the frames
 *  of its own origin inside it, theirs too; the extension's own UI is never entered. */
function scopesOf(doc: Document): Scope[] {
  const scopes: Scope[] = [{ scope: doc, frame: null }];
  for (let at = 0; at < scopes.length; at += 1) {
    const { scope, frame } = scopes[at]!;
    for (const el of Array.from(scope.querySelectorAll('*'))) {
      if (isInOwnUi(el)) continue;
      if (el.shadowRoot !== null) scopes.push({ scope: el.shadowRoot, frame });
      if (el.localName === 'iframe' || el.localName === 'frame') {
        let inner: Document | null = null;
        try {
          inner = (el as HTMLIFrameElement).contentDocument;
        } catch {
          inner = null;
        }
        if (inner !== null && inner.documentElement !== null) scopes.push({ scope: inner, frame: frame ?? el });
      }
    }
  }
  return scopes;
}

/** Every element of the scopes matching `selector`, with the frame it is drawn in; the extension's UI excluded. */
function all<T extends Element>(scopes: readonly Scope[], selector: string): Array<{ el: T; frame: Element | null }> {
  return scopes.flatMap(({ scope, frame }) => Array.from(scope.querySelectorAll<T>(selector))
    .filter((el) => !isInOwnUi(el)).map((el) => ({ el, frame })));
}

/** Whether a challenge element shows where the step is: visible in its own document, and (one in a frame of the page's
 *  origin) that frame visible, over or inside the form. */
function showsAt(el: Element, frame: Element | null, root: Element | null, cache: ScanCache): boolean {
  if (!isUserVisible(el, cache)) return false;
  if (frame === null) return overOrInside(el, root);
  return isUserVisible(frame, cache) && overOrInside(frame, root);
}

/** The visible challenge frames, then the visible containers, over or inside the form, none of them solved. */
function shownCaptchas(scopes: readonly Scope[], root: Element | null, cache: ScanCache):
  Array<{ el: Element; evidence: PauseEvidence }> {
  const shown: Array<{ el: Element; evidence: PauseEvidence }> = [];
  for (const { el: frame, frame: host } of all<HTMLIFrameElement>(scopes, 'iframe')) {
    if (frame.closest('.grecaptcha-badge') !== null) continue;
    const vendor = challengeVendor(frame.src, viewOf(frame.ownerDocument));
    if (vendor === null || !showsAt(frame, host, root, cache)) continue;
    // Only a vendor that puts a response token in its widget can be known solved; Arkose's never is.
    const container = frame.closest(CAPTCHA_CONTAINERS);
    if (vendor === 'token' && container !== null && solved(container)) continue;
    shown.push({ el: frame, evidence: 'captcha-frame' });
  }
  for (const { el: container, frame: host } of all(scopes, CAPTCHA_CONTAINERS)) {
    if (!drawnWidget(container)) continue;
    if (showsAt(container, host, root, cache) && !solved(container)) {
      shown.push({ el: container, evidence: 'captcha-container' });
    }
  }
  // The audit of 2026-11-06 (S-7): a widget drawn in a container none of the documented classes names (an explicit
  // render into the page's own element) is known by the vendor's own response field inside it: the field's parent is
  // the widget's container, a challenge while the field is empty. One inside a documented container is that
  // container's, read above.
  const parents = new Set<Element>();
  for (const { el: field, frame: host } of all<HTMLTextAreaElement | HTMLInputElement>(scopes, RESPONSE_FIELDS)) {
    const parent = field.parentElement;
    if (parent === null || parents.has(parent) || field.value.trim() !== '' || isInOwnUi(parent)) continue;
    if (parent.closest(CAPTCHA_CONTAINERS) !== null || !drawnWidget(parent)) continue;
    parents.add(parent);
    if (showsAt(parent, host, root, cache) && !solved(parent)) shown.push({ el: parent, evidence: 'captcha-container' });
  }
  return shown;
}

/** Whether a widget's container draws a challenge: not invisible mode (a widget bound to a button or a link, or one
 *  saying data-size="invisible"), and not the invisible reCAPTCHA's badge. */
function drawnWidget(container: Element): boolean {
  const tag = container.localName;
  if (tag === 'button' || tag === 'input' || tag === 'a') return false;
  if ((container.getAttribute('data-size') ?? '').toLowerCase() === 'invisible') return false;
  return container.closest('.grecaptcha-badge') === null;
}

/**
 * The audit of 2026-11-06 (S-7): whether the page shows, anywhere (no form root: over the form or not, in the
 * document, its open shadow roots and its frames of its own origin), a challenge not known solved (unsolvedCaptchas:
 * a vendor's widget whose response token is empty, or one whose vendor holds none) or a frame of another origin that
 * reads like one (challengeLikeFramesShown). Every Next, Submit and entry press holds while one shows, as Sign-in Auto
 * does. A vendor's widget the person solved (its token there) holds no press, unlike Sign-in Auto, which waits out
 * every vendor frame: a press types nothing.
 */
export function pageChallenged(doc: Document, cache: ScanCache = newScanCache()): boolean {
  return unsolvedCaptchas(doc, null, cache) > 0 || challengeLikeFramesShown(doc, cache) > 0;
}

/** How many visible frames on a vendor's challenge host the page shows, solved or not, in the document, its open shadow
 *  roots and the frames of its own origin (the invisible reCAPTCHA badge aside): Sign-in Auto types nothing while one
 *  shows (module header). */
export function vendorFramesShown(doc: Document, cache: ScanCache = newScanCache()): number {
  return all<HTMLIFrameElement>(scopesOf(doc), 'iframe').filter(({ el, frame }) => el.closest('.grecaptcha-badge') === null
    && challengeHost(el.src, viewOf(el.ownerDocument)) && showsAt(el, frame, null, cache)).length;
}

/** Words a challenge frame's address, title, name or label carries (round 3, X9); "bot" as a word of its own. */
const CHALLENGE_WORDS = /captcha|challenge|verify|human|arkose|turnstile|\bbots?\b/i;

/** How many visible frames of another origin than their document's the page shows whose address, title, name or
 *  aria-label reads like a challenge (CHALLENGE_WORDS), in the document, its open shadow roots and the frames of its own
 *  origin (module header): Sign-in Auto types nothing while one shows. Its address is read, never loaded. */
export function challengeLikeFramesShown(doc: Document, cache: ScanCache = newScanCache()): number {
  return all<HTMLIFrameElement>(scopesOf(doc), 'iframe').filter(({ el, frame }) => crossOrigin(el)
    && [el.src, el.title, el.name, el.getAttribute('aria-label') ?? ''].some((text) => CHALLENGE_WORDS.test(text))
    && showsAt(el, frame, null, cache)).length;
}

/** Whether a frame shows a document of another origin than its own document's: its address, read against that
 *  document's, has another origin, or its document cannot be reached. */
function crossOrigin(frame: HTMLIFrameElement): boolean {
  const view = viewOf(frame.ownerDocument);
  if (view !== null && frame.src !== '') {
    try {
      const url = new view.URL(frame.src, frame.ownerDocument.baseURI);
      if (/^https?:$/.test(url.protocol) && url.origin !== view.location.origin) return true;
    } catch {
      // An address that does not parse: judged by its document below.
    }
  }
  try {
    return frame.contentDocument === null;
  } catch {
    return true;
  }
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

/** The vendors' challenge hosts whose widgets hold no response token (module header): Arkose Labs, FunCaptcha's legacy
 *  host, DataDome, GeeTest. */
const NO_TOKEN_HOSTS = ['arkoselabs.com', 'funcaptcha.com', 'captcha-delivery.com', 'geetest.com'];

/** A frame address parsed, https only, or null. */
function frameUrl(src: string, view: (Window & typeof globalThis) | null): URL | null {
  if (src === '' || view === null) return null;
  try {
    const url = new view.URL(src);
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Whether `host` is `domain` or one of its subdomains. */
const onDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** Whether a frame address is on a vendor's challenge host, whatever it shows (vendorFramesShown). */
function challengeHost(src: string, view: (Window & typeof globalThis) | null): boolean {
  const url = frameUrl(src, view);
  if (url === null) return false;
  const host = url.hostname.toLowerCase();
  if (['google.com', 'www.google.com', 'recaptcha.net', 'www.recaptcha.net'].includes(host)) {
    return url.pathname.startsWith('/recaptcha/');
  }
  return onDomain(host, 'hcaptcha.com') || host === 'challenges.cloudflare.com'
    || NO_TOKEN_HOSTS.some((domain) => onDomain(host, domain));
}

/** A frame address on a vendor's challenge host: 'token' for a vendor whose widget holds its response token
 *  (reCAPTCHA, hCaptcha, Turnstile), 'no-token' for one whose widget holds none (NO_TOKEN_HOSTS), null for any other
 *  address. An invisible reCAPTCHA anchor says size=invisible. */
function challengeVendor(src: string, view: (Window & typeof globalThis) | null): 'token' | 'no-token' | null {
  const url = frameUrl(src, view);
  if (url === null) return null;
  const host = url.hostname.toLowerCase();
  if (['google.com', 'www.google.com', 'recaptcha.net', 'www.recaptcha.net'].includes(host)) {
    return url.pathname.startsWith('/recaptcha/') && url.searchParams.get('size') !== 'invisible' ? 'token' : null;
  }
  if (onDomain(host, 'hcaptcha.com') || host === 'challenges.cloudflare.com') return 'token';
  return NO_TOKEN_HOSTS.some((domain) => onDomain(host, domain)) ? 'no-token' : null;
}

/** Inside the form root (shadow roots crossed), or drawn over it. Anywhere on the page when there is no form root. */
function overOrInside(el: Element, root: Element | null): boolean {
  if (root === null || flatContains(root, el)) return true;
  const a = el.getBoundingClientRect();
  const b = root.getBoundingClientRect();
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}
