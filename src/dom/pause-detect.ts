/*
 * When a step needs the person, not the extension (docs/design/runtime.md §5.11; docs/ARCHITECTURE.md "Pauses"). On
 * such a step nothing is filled, not even the email, and the run hands control back until a trusted Continue.
 * - Sign-in and accounts: a visible password field means a sign-in; two of them, or a "confirm password" label, an
 *   account creation. A visible one-time-code field (autocomplete="one-time-code", or a label naming a verification,
 *   security or one-time code) means an email code. The adapter's authState adds what a platform's snapshots show. A
 *   create-account section an adapter declares inside its application form (Adapter.accountSection, core-x item 2:
 *   iCIMS's "Create a login") is no account page: its boxes are left out of this reading (dom/account-section.ts).
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
 *   bound to a button (invisible mode) do not pause: a <button>, an <input>, a link, or (the snapshot build of
 *   2026-11-06, core pass Z1 item 20: ADP's guest Continue, an sdf-button) any element whose role is button carrying
 *   the binding class and holding no frame. The challenge such a button raises is a vendor frame (reCAPTCHA's bframe),
 *   which pauses once shown. Phase 5 confirms this markup against the vendors' documentation.
 *   A widget the person solved holds its response token in the field the vendor puts inside it (g-recaptcha-response,
 *   h-captcha-response, cf-turnstile-response): it does not pause, and neither does its frame (the Phase 5 review,
 *   X-S4). The token is only read for being there: it is never kept, sent or logged. A widget that holds no token
 *   (Arkose's, DataDome's, PerimeterX's, GeeTest's) is never known solved.
 *   The behaviour review of 2026-11-06 (M6, the owner's decision; docs/SPEC-AMENDMENTS.md §12): a checkbox widget not
 *   yet solved (reCAPTCHA v2's and hCaptcha's checkbox, as the snapshots show them: checkboxFrame) does not pause the
 *   fill; the run never touches it. Its challenge popup (reCAPTCHA's bframe, hCaptcha's challenge frame) is no
 *   checkbox: once shown, it pauses as every challenge does.
 *   v5 (PLAN decision 9, the owner's "implement like jobright extension", 2026-11-08): such a widget no longer holds a
 *   press either. Next, Submit, the agent's entry and Sign-in Auto press the site's own control beside it, and the site
 *   decides (pageChallenged and vendorFramesShown leave checkbox widgets out; unsolvedCaptchas still counts them). A
 *   site that refuses the press for it (its own "complete the CAPTCHA" error, an adapter's error or an alert that reads
 *   like one: isCaptchaError, captchaErrorsShown; or a Next or Submit it did not take while the widget is still unticked) is read by
 *   captchaRefusalShown: the run then rests at a CAPTCHA pause with the "solve the check" toast, and carries on by
 *   itself once the widget holds its token (content/orchestrator.ts). Such an error, once the widget is solved, is
 *   stale (withoutSolvedCaptchaErrors): no field's error and no refusal. Nothing here solves, ticks or bypasses a check.
 * - vendorFramesShown: every visible frame on a vendor's challenge host, solved or not (the invisible reCAPTCHA badge
 *   aside, and since v5 a checkbox widget's own frame): Sign-in Auto types nothing while one shows (round 2, E10).
 *   challengeLikeFramesShown (round 3, X9): every
 *   visible frame of another origin whose address, title, name or label reads like a challenge (CHALLENGE_WORDS: a
 *   vendor this module does not know, a site's own), the badge aside too (the behaviour review of 2026-11-06, B1), which
 *   Sign-in Auto also waits out; a fill does not pause for one.
 * - pageChallenged (the audit of 2026-11-06, S-7): a challenge not known solved anywhere on the page, or a frame that
 *   reads like one; every Next, Submit and entry press holds while one shows (orchestrator.ts, press.ts). Since v5 a
 *   checkbox widget is no such challenge (above).
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
 *   They still count in unsolvedCaptchas and (no checkbox widget) pageChallenged, which keeps auto-advance from pressing
 *   Next on the step until the widget is known solved (its token there; an Arkose widget, which holds none, never is).
 * Detection never touches the challenge: it only reads where it is.
 */
import type { Adapter } from '../adapters/types';
import { accountRowsIn } from './account-section';
import { isAuthField } from './kinds';
import { labelOfControl, referenced } from './labels';
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

/** The behaviour review of 2026-11-06 (M6): whether `el` is a vendor's response field (RESPONSE_FIELDS). The scan never
 *  takes one for a field of the step, shown or not (dom/scan.ts): the run never writes into a widget. */
export function isCaptchaResponseField(el: Element): boolean {
  return el.matches(RESPONSE_FIELDS);
}

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
  // The behaviour review of 2026-11-06 (M6): a checkbox widget not yet solved, with no challenge popup shown, is no
  // pause: the step fills. Since v5 (PLAN decision 9) it holds no press either: the site decides (captchaRefusalShown).
  const captcha = shownCaptchas(scopes, root, cache)
    .find((shown) => !shown.checkbox && !isHanded(shown.el, options.handed));
  if (captcha !== undefined) return { kind: 'captcha', evidence: captcha.evidence };
  const declared = adapter?.authState?.(doc) ?? null;
  if (declared !== null) return { kind: declared, evidence: 'adapter' };
  // Account fields are the page's own: a frame of its origin is read for challenges alone. The snapshot build of
  // 2026-11-06 (core-x, item 2): an account section the adapter declares inside the application form (iCIMS's "Create
  // a login") is a section of the form, never an account page: its boxes are not read here (dom/account-section.ts).
  // jr6 ENGINE E2 (FIXPLAN §6.2 item 6, ICIMS-04): or its rows (careers-sentinel's Login, Password and Re-enter beside
  // the profile's name and email): a box inside one of them is not read either.
  const account = accountRowsIn(adapter, doc, root);
  const inputs = all<HTMLInputElement>(scopes.filter((each) => each.frame === null), 'input').map(({ el }) => el)
    .filter((input) => !account.some((row) => row.contains(input)) && isUserVisible(input, cache));
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
 *  response token is empty, and every Arkose frame, handed to the person or not, checkbox widgets included. Since v5
 *  (PLAN decision 9) a press holds only for those that are no checkbox widget (pageChallenged). */
export function unsolvedCaptchas(doc: Document, root: Element | null, cache: ScanCache = newScanCache()): number {
  return shownCaptchas(scopesOf(doc), root, cache).length;
}

// ── v5 p1-rules: CAPTCHA like Jobright (PLAN decision 9) ──
/** How many checkbox widgets (reCAPTCHA v2's, hCaptcha's: checkboxFrame, checkboxWidget) the page shows that are not
 *  known solved: over or inside `root` (the step's form, a sign-in's form), anywhere when it is null. They pause nothing
 *  and hold no press: the site decides (module header). v5 review (F8): a refusal reads those of the pressed step's
 *  container alone, never a footer newsletter's. */
export function checkboxCaptchasUnsolved(doc: Document, root: Element | null = null, cache: ScanCache = newScanCache()):
  number {
  return shownCaptchas(scopesOf(doc), root, cache).filter((shown) => shown.checkbox).length;
}

/** v5 review (F3): how many checkbox widgets the page shows, anywhere, that hold their response token: checks the person
 *  solved. A page with no checkbox widget (an invisible or a score-based reCAPTCHA) has none. */
export function checkboxCaptchasSolved(doc: Document, cache: ScanCache = newScanCache()): number {
  const scopes = scopesOf(doc);
  const solvedShown = (el: Element, frame: Element | null) => drawnWidget(el) && solved(el)
    && showsAt(el, frame, null, cache) && checkboxWidget(el, cache);
  const containers = all(scopes, CAPTCHA_CONTAINERS).filter(({ el, frame }) => solvedShown(el, frame));
  const parents = all<HTMLTextAreaElement | HTMLInputElement>(scopes, RESPONSE_FIELDS).flatMap(({ el: field, frame }) => {
    const parent = field.parentElement;
    return parent === null || parent.closest(CAPTCHA_CONTAINERS) !== null || !solvedShown(parent, frame) ? [] : [parent];
  });
  return new Set([...containers.map(({ el }) => el), ...parents]).size;
}

/** The words a site's own "complete the CAPTCHA" error says, in its id, class or name, or in its text (JazzHR's
 *  #recaptcha-required-error, as Jobright 1.25.2's submission rules read it; "Please verify you are not a robot"). */
const CAPTCHA_ERROR_WORDS = /captcha|\bnot an? (?:ro)?bot\b|\b(?:are|be) (?:an? )?human\b|\bhuman (?:check|verification)\b/i;
/** The most of an error's own text read for those words. */
const CAPTCHA_ERROR_TEXT = 300;

/** Whether an error the page shows (an adapter's `errors`) is a site's CAPTCHA-required error: its id, class or name,
 *  or the first characters of its text, read like one (CAPTCHA_ERROR_WORDS). Read for that alone: never kept or sent. */
export function isCaptchaError(el: Element): boolean {
  const names = [el.id, el.getAttribute('class') ?? '', el.getAttribute('name') ?? ''];
  if (names.some((name) => CAPTCHA_ERROR_WORDS.test(name))) return true;
  return CAPTCHA_ERROR_WORDS.test((el.textContent ?? '').slice(0, CAPTCHA_ERROR_TEXT));
}

/**
 * The errors still standing among `errors` (an adapter's, as `errors` gives them): a site's CAPTCHA-required error
 * (isCaptchaError) is left out only once the page shows its checkbox solved: at least one checkbox widget holding its
 * token and none still unticked. It is then the error the site drew before, which it clears only at the next press.
 * v5 review (F3): on a page that shows no checkbox widget (an invisible or a score-based reCAPTCHA) it stands, as every
 * other error does. Validation (orchestrator.ts errorsNow) and a press's refusal (press.ts refusalNow) read these.
 */
export function withoutSolvedCaptchaErrors<T extends { el: Element }>(errors: readonly T[], doc: Document,
  cache: ScanCache = newScanCache()): T[] {
  if (!errors.some((error) => isCaptchaError(error.el)) || checkboxCaptchasUnsolved(doc, null, cache) > 0
    || checkboxCaptchasSolved(doc, cache) === 0) return [...errors];
  return errors.filter((error) => !isCaptchaError(error.el));
}

/** The site's CAPTCHA-required errors a person can see now: the adapter's errors, and the alerts (role=alert,
 *  aria-live=assertive), on `root` (the document's body when there is none) that read like one. */
export function captchaErrorsShown(doc: Document, root: Element | null, adapter: Adapter | null,
  cache: ScanCache = newScanCache()): Element[] {
  const scope = root ?? doc.body;
  if (scope === null) return [];
  let errors: Element[] = [];
  try {
    errors = (adapter?.errors?.(scope) ?? []).map((error) => error.el);
  } catch {
    errors = [];
  }
  errors.push(...Array.from(scope.querySelectorAll('[role="alert" i], [aria-live="assertive" i]')));
  return [...new Set(errors)].filter((el) => el.isConnected && !isInOwnUi(el) && isCaptchaError(el)
    && isUserVisible(el, cache));
}

/**
 * v5 (PLAN decision 9): whether the page refused a press for its check, the way the run reads it: a checkbox widget
 * still unticked shows over or inside `root` (the pressed step's form; anywhere when null: v5 review, F8), and either the
 * site shows its CAPTCHA-required error (captchaErrorsShown) or `afterPress` (a Next that left the step as it was, a
 * Submit the page refused or never confirmed). Once the widget holds its token, it reads false: the run carries on. A
 * check this module cannot see ticked (none shown, an invisible one the site's score refused) reads false too: the
 * site's error is then a plain error the person reads.
 */
export function captchaRefusalShown(doc: Document, root: Element | null, adapter: Adapter | null,
  options: { afterPress: boolean }, cache: ScanCache = newScanCache()): boolean {
  if (checkboxCaptchasUnsolved(doc, root, cache) === 0) return false;
  return options.afterPress || captchaErrorsShown(doc, root, adapter, cache).length > 0;
}
// ── end v5 p1-rules ──

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

/** A challenge shown: its element, what showed it, and (M6) whether it is a checkbox widget (checkboxFrame,
 *  checkboxWidget). */
interface ShownCaptcha {
  el: Element;
  evidence: PauseEvidence;
  checkbox: boolean;
}

/** The visible challenge frames, then the visible containers, over or inside the form, none of them solved. */
function shownCaptchas(scopes: readonly Scope[], root: Element | null, cache: ScanCache): ShownCaptcha[] {
  const shown: ShownCaptcha[] = [];
  for (const { el: frame, frame: host } of all<HTMLIFrameElement>(scopes, 'iframe')) {
    if (frame.closest('.grecaptcha-badge') !== null) continue;
    const vendor = challengeVendor(frame.src, viewOf(frame.ownerDocument));
    if (vendor === null || !showsAt(frame, host, root, cache)) continue;
    // Only a vendor that puts a response token in its widget can be known solved; Arkose's never is. The behaviour
    // review of 2026-11-06 (M6): a widget rendered into the page's own element is known by its response field (below),
    // so its frame is known solved with it (fixtures/bamboohr/swyfft-form, successfactors/donnelleyf-create-account).
    const container = frame.closest(CAPTCHA_CONTAINERS) ?? responseParentOf(frame);
    if (vendor === 'token' && container !== null && solved(container)) continue;
    shown.push({ el: frame, evidence: 'captcha-frame', checkbox: checkboxFrame(frame) });
  }
  for (const { el: container, frame: host } of all(scopes, CAPTCHA_CONTAINERS)) {
    if (!drawnWidget(container)) continue;
    if (showsAt(container, host, root, cache) && !solved(container)) {
      shown.push({ el: container, evidence: 'captcha-container', checkbox: checkboxWidget(container, cache) });
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
    if (showsAt(parent, host, root, cache) && !solved(parent)) {
      shown.push({ el: parent, evidence: 'captcha-container', checkbox: checkboxWidget(parent, cache) });
    }
  }
  return shown;
}

/** The behaviour review of 2026-11-06 (M6): the nearest element around `frame` that holds a vendor's response field as
 *  a child of its own (the S-7 rule's container of a widget rendered into the page's own element), or null. */
function responseParentOf(frame: Element): Element | null {
  for (let at = frame.parentElement; at !== null; at = at.parentElement) {
    if (Array.from(at.children).some((child) => child.matches(RESPONSE_FIELDS))) return at;
  }
  return null;
}

/** Whether a widget's container draws a challenge: not invisible mode (a widget bound to a button or a link, or one
 *  saying data-size="invisible"), and not the invisible reCAPTCHA's badge. */
function drawnWidget(container: Element): boolean {
  const tag = container.localName;
  if (tag === 'button' || tag === 'input' || tag === 'a') return false;
  if (boundButton(container)) return false;
  if ((container.getAttribute('data-size') ?? '').toLowerCase() === 'invisible') return false;
  return container.closest('.grecaptcha-badge') === null;
}

// ── snapshot build 2026-11-06 (core pass Z1, item 20) ──
/** reCAPTCHA's and hCaptcha's invisible binding: the class put on the button the widget runs from. */
const BINDING_CLASSES = ['g-recaptcha', 'h-captcha'];

/**
 * Whether `el` is a button that carries a vendor's invisible binding (BINDING_CLASSES) rather than a widget it draws:
 * an element whose own role is button and that holds no frame (a drawn widget renders its challenge's frame into its
 * container). ADP's guest Continue (fixtures/adp/guest.html, adp-6: <sdf-button id="recruitment_login_recaptcha"
 * class="g-recaptcha ..." role="button" aria-label="Continue">) is one, as a <button class="g-recaptcha"> is. The
 * challenge such a binding raises is a frame on the vendor's host (reCAPTCHA's bframe), read as every challenge frame
 * is (shownCaptchas): once shown it pauses, and a checkbox widget drawn anywhere on the page pauses as before.
 */
function boundButton(el: Element): boolean {
  const role = (el.getAttribute('role') ?? '').trim().toLowerCase().split(/\s+/)[0];
  return role === 'button' && BINDING_CLASSES.some((name) => el.classList.contains(name))
    && !holdsFrame(el) && ownName(el) && buttonSized(el);
}
// ── end core pass Z1, item 20 ──

// ── The security fix of 2026-11-06 (S7): a bound button is named and button-sized ──
/**
 * The tallest box a button bound to a widget may have: under the shortest drawn widget the vendors bind (reCAPTCHA's
 * and hCaptcha's checkbox, 78 px; their compact one, 144 px). ADP's guest Continue (adp-6) is a one-line button.
 */
const BOUND_BUTTON_MAX_HEIGHT_PX = 64;

/** Whether `el` holds a frame in its light DOM or its open shadow roots (a drawn widget renders its frame into its
 *  container). A closed shadow root cannot be read: such a host is held to ownName and buttonSized instead. */
function holdsFrame(el: Element): boolean {
  const scopes: Array<Element | ShadowRoot> = [el];
  for (let at = 0; at < scopes.length; at += 1) {
    const scope = scopes[at]!;
    if (scope.querySelector('iframe, frame') !== null) return true;
    if (scope instanceof Element && scope.shadowRoot !== null) scopes.push(scope.shadowRoot);
    for (const inner of Array.from(scope.querySelectorAll('*'))) if (inner.shadowRoot !== null) scopes.push(inner.shadowRoot);
  }
  return false;
}

/** Whether `el` has an accessible name of its own: its aria-label, the words its aria-labelledby names, or its own text
 *  (ADP's Continue: aria-label="Continue"). A widget drawn in a closed shadow root says none of these. */
function ownName(el: Element): boolean {
  if ((el.getAttribute('aria-label') ?? '').trim() !== '') return true;
  if (referenced(el, 'aria-labelledby').some((target) => (target.textContent ?? '').trim() !== '')) return true;
  return (el.textContent ?? '').trim() !== '';
}

/** Whether `el`'s box is a button's, not a drawn widget's: drawn, and no taller than BOUND_BUTTON_MAX_HEIGHT_PX. */
function buttonSized(el: Element): boolean {
  const box = el.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && box.height <= BOUND_BUTTON_MAX_HEIGHT_PX;
}
// ── end of the security fix's block (S7) ──

/**
 * The audit of 2026-11-06 (S-7): whether the page shows, anywhere (no form root: over the form or not, in the
 * document, its open shadow roots and its frames of its own origin), a challenge not known solved (unsolvedCaptchas:
 * a vendor's widget whose response token is empty, or one whose vendor holds none) or a frame of another origin that
 * reads like one (challengeLikeFramesShown). Every Next, Submit and entry press holds while one shows, as Sign-in Auto
 * does. A vendor's widget the person solved (its token there) holds no press, unlike Sign-in Auto, which waits out
 * every vendor frame: a press types nothing. v5 (PLAN decision 9): a checkbox widget not yet solved holds none either
 * (module header): the site decides, and a refusal is read after the press (captchaRefusalShown).
 */
export function pageChallenged(doc: Document, cache: ScanCache = newScanCache()): boolean {
  return shownCaptchas(scopesOf(doc), null, cache).some((shown) => !shown.checkbox)
    || challengeLikeFramesShown(doc, cache) > 0;
}

/** How many visible frames on a vendor's challenge host the page shows, solved or not, in the document, its open shadow
 *  roots and the frames of its own origin (the invisible reCAPTCHA badge aside, and since v5 a checkbox widget's own
 *  frame: checkboxFrame): Sign-in Auto types nothing while one shows (module header). */
export function vendorFramesShown(doc: Document, cache: ScanCache = newScanCache()): number {
  return all<HTMLIFrameElement>(scopesOf(doc), 'iframe').filter(({ el, frame }) => el.closest('.grecaptcha-badge') === null
    && challengeHost(el.src, viewOf(el.ownerDocument)) && !checkboxFrame(el) && showsAt(el, frame, null, cache)).length;
}

/** Words a challenge frame's address, title, name or label carries (round 3, X9); "bot" as a word of its own. */
const CHALLENGE_WORDS = /captcha|challenge|verify|human|arkose|turnstile|\bbots?\b/i;

/** How many visible frames of another origin than their document's the page shows whose address, title, name or
 *  aria-label reads like a challenge (CHALLENGE_WORDS), in the document, its open shadow roots and the frames of its own
 *  origin (module header): Sign-in Auto types nothing while one shows. Its address is read, never loaded. A frame on a
 *  vendor's challenge host is the vendor rules' (vendorFramesShown, unsolvedCaptchas), never counted here. */
export function challengeLikeFramesShown(doc: Document, cache: ScanCache = newScanCache()): number {
  // The behaviour review of 2026-11-06:
  // - B1: the invisible reCAPTCHA's badge (.grecaptcha-badge, whose anchor frame says title="reCAPTCHA" and
  //   size=invisible: every Greenhouse fixture, Dayforce's, CareerPlug's) draws no challenge, as vendorFramesShown and
  //   shownCaptchas already read it. The challenge it raises is its bframe, outside the badge, which shownCaptchas
  //   counts once shown (fixtures/dayforce/submit-challenge.html).
  // - M6: a frame on a vendor's challenge host is read by the vendor's rules, which know a solved widget (its token
  //   there): reCAPTCHA's checkbox anchor says title="reCAPTCHA" whether solved or not, so read here it held every
  //   press after the person solved it. Sign-in Auto still counts every such frame (vendorFramesShown).
  return all<HTMLIFrameElement>(scopesOf(doc), 'iframe').filter(({ el, frame }) => el.closest('.grecaptcha-badge') === null
    && !challengeHost(el.src, viewOf(el.ownerDocument)) && crossOrigin(el)
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

// ── The behaviour review of 2026-11-06 (M6): a checkbox widget holds every press, never the fill ──
/**
 * Whether a frame is a checkbox widget's own frame, as the owner's snapshots show it (the owner's decision of
 * 2026-11-06; docs/SPEC-AMENDMENTS.md §12):
 * - reCAPTCHA v2's checkbox: its anchor frame, `https://www.google.com/recaptcha/api2/anchor?...&size=normal`
 *   (fixtures/jazzhr/*-form, bamboohr/swyfft-form, successfactors/donnelleyf-create-account: title="reCAPTCHA",
 *   304 x 78). Its challenge popup is another frame, `/recaptcha/api2/bframe` ("recaptcha challenge expires in two
 *   minutes"), no checkbox, which pauses once shown (fixtures/dayforce/submit-challenge).
 * - hCaptcha's checkbox: `https://newassets.hcaptcha.com/captcha/v1/<build>/static/hcaptcha.html#frame=checkbox`
 *   (fixtures/icims/*, drawn hidden there in invisible mode). Its challenge popup is `#frame=challenge` ("hCaptcha
 *   challenge"), which pauses once shown.
 * Any other address (an enterprise anchor, a compact or sizeless anchor, hCaptcha's enclave, Turnstile, Arkose, ...)
 * is not known to be a checkbox: it pauses as before.
 */
function checkboxFrame(frame: HTMLIFrameElement): boolean {
  const url = frameUrl(frame.src, viewOf(frame.ownerDocument));
  if (url === null) return false;
  const host = url.hostname.toLowerCase();
  if (['google.com', 'www.google.com', 'recaptcha.net', 'www.recaptcha.net'].includes(host)) {
    return url.pathname === '/recaptcha/api2/anchor' && url.searchParams.get('size') === 'normal';
  }
  if (onDomain(host, 'hcaptcha.com')) {
    return /\/static\/hcaptcha\.html$/.test(url.pathname)
      && new URLSearchParams(url.hash.replace(/^#/, '')).get('frame') === 'checkbox';
  }
  return false;
}

/** The frames `el` holds, in its light DOM and its open shadow roots. */
function framesIn(el: Element): HTMLIFrameElement[] {
  const found: HTMLIFrameElement[] = [];
  const scopes: Array<Element | ShadowRoot> = [el];
  for (let at = 0; at < scopes.length; at += 1) {
    const scope = scopes[at]!;
    found.push(...Array.from(scope.querySelectorAll<HTMLIFrameElement>('iframe')));
    if (scope instanceof Element && scope.shadowRoot !== null) scopes.push(scope.shadowRoot);
    for (const inner of Array.from(scope.querySelectorAll('*'))) if (inner.shadowRoot !== null) scopes.push(inner.shadowRoot);
  }
  return found;
}

/** Whether a widget's container draws a checkbox widget: it shows a frame, and every frame it shows is a checkbox's
 *  (checkboxFrame). reCAPTCHA's own hidden helper frame beside its anchor (`<iframe style="display: none;">`, no
 *  address: fixtures/jazzhr/invaluable-form, bamboohr/swyfft-form) draws nothing. A container that shows none (not
 *  drawn yet, or drawn where it cannot be read) is not known to be one, and pauses as before. */
function checkboxWidget(container: Element, cache: ScanCache): boolean {
  const frames = framesIn(container).filter((frame) => isUserVisible(frame, cache));
  return frames.length > 0 && frames.every((frame) => checkboxFrame(frame));
}
// ── end of the behaviour review's block (M6) ──

/** Inside the form root (shadow roots crossed), or drawn over it. Anywhere on the page when there is no form root. */
function overOrInside(el: Element, root: Element | null): boolean {
  if (root === null || flatContains(root, el)) return true;
  const a = el.getBoundingClientRect();
  const b = root.getBoundingClientRect();
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}
