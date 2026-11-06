/*
 * Sign-in mode Auto in the content script (v3 Phase 5; docs/SPEC-AMENDMENTS.md §12 Decision 10; docs/PRIVACY.md
 * "Sign-in Auto"). A run in a tab's top frame that paused at a sign-in or create-account page (detectPause, the
 * adapter's authState), while the worker says Sign-in acts as Auto, signs in once:
 * 1. The form: the adapter's declared one (Adapter.signInForm), else the standard one (dom/sign-in-form.ts), and
 *    signInRefusal must pass: an https page, every box visible to a person, enabled and no honeypot, all in one form
 *    posting to the page's own origin. Anything else: 'unavailable', and nothing is asked or typed.
 * 2. The worker is asked (signin/credential {wall}): it reads the host from Chrome's sender address, answers only while
 *    Sign-in acts as Auto, and once per tab and wall. Its answer is the only place the password is ever held here: a
 *    local of this function, typed into the page's password box (and its confirmation) and dropped; it is never kept,
 *    logged, reported or sent anywhere.
 * 3. With nothing awaited between: the page's address checked again (the same origin as when asked, https), the
 *    sign-in's host held to the page's (its own host, or `*` on a host signInHostCovered covers), the form read and
 *    refused or not again (the same password box), then the email, the password and the confirmation written with the
 *    elements' own setters and the plain events a page listens for (dom/fillers/events.ts), each read back; the
 *    account's required terms ticked (clickIfAllowed: a box's click); and the form's own button pressed through
 *    not-submit.ts clickAdapterSignIn, which only this module may call (eslint.config.mjs). (A declared form whose page
 *    enables its button once filled is pressed after a bounded wait for it: below.)
 * 4. What came of it, watched for SIGN_IN_SETTLE_MS: the document leaving ('left': the next page's runs take over), the
 *    password box gone, or an email code or a CAPTCHA shown ('continue': the run scans again, and pauses for the
 *    person where it must: a challenge the press raised is theirs); an error shown with the password box still there,
 *    or nothing within the wait ('failed').
 *    A password the site did not take is never typed again (the worker answers a tab once per wall), so there is no
 *    retry loop. On every outcome but 'continue', the password and its confirmation are written empty again in the
 *    boxes they were typed into that are still in the page (the v3 Phase 6/7b review, S5, and its round 2, E3: 'left'
 *    included, which also means the run's own end, the person's Stop or a route away): no password is left behind in
 *    a form the sign-in no longer watches.
 * Email codes, CAPTCHA and every other check stay the person's: this module only reads where they are. A frame on a
 * challenge vendor's host shown anywhere, solved or not, refuses the sign-in too (round 2, E10), as does a frame of
 * another origin whose address, title, name or label reads like a challenge (round 3, X9), and the page is looked
 * at for a challenge once more after a prelude, before anything is asked (E4). A challenge
 * shown and not solved comes before every account page (dom/pause-detect.ts), so nothing is asked, typed or pressed
 * while one shows, and the page is looked at for one again right before the typing and right before the press.
 * v3 Phase 7b (the public capture of 2026-11-04/05; docs/SPEC-AMENDMENTS.md §12):
 * - A wall whose form the page shows only after a first choice (Workday's landing: Apple, Google, "Sign in with email"):
 *   before 1, the adapter's declared prelude control is pressed once through not-submit.ts clickAdapterSignInPrelude
 *   (this module alone may call it), and the form is waited for SIGN_IN_PRELUDE_MS; none drawn: 'unavailable'. Nothing
 *   is asked of the worker before the form shows and passes 1.
 * - An email gate (wall 'email-gate': Oracle Recruiting Cloud's email-first identity step): the worker answers the email
 *   alone, which is typed into the gate's email box; its required terms are ticked and its Next pressed; the code the
 *   site then sends is the person's (an email code pause). The gate's email box gone is 'continue'.
 * - From the typing to the end of the watch, guardSubmission cancels a native submission of the form that would put the
 *   password in an address or send it elsewhere: any one of a form the page's own script sends (SignInForm.scriptSubmits,
 *   signInRefusal's narrow exception), any other that would go as anything but a POST to the page's own origin; and a
 *   submission by the page's own form.submit() (no submit event) has the password taken out of its entry list
 *   (formdata: round 2 of the review, E5).
 * - Right before each write of the password, its box is read again: still in the page, still a password box, still in
 *   the form (the v3 Phase 6/7b review, S7); otherwise nothing more is typed ('failed').
 * - A declared form whose page enables its button only once filled (SignInForm.enablesWhenFilled) is pressed once the
 *   button is enabled, waited for SIGN_IN_ENABLE_MS at most after the typing ('failed' otherwise); the page's address,
 *   the form and the absence of a challenge are read again after that wait, right before the press.
 * - A declared form that asks for more than this module types (SignInForm.personPresses: SuccessFactors' account
 *   creation) gets its email, its email again, its password and its confirmation typed, and nothing pressed: 'continue',
 *   the run then pausing at the page, where the person answers the rest and presses its button.
 * - A password reset ('forgot-password') is never a wall here: it pauses for the person, and nothing is typed there.
 */
import { signInHostCovered } from '../contract/tailorit/credentials';
import type { Adapter, SignInForm } from '../adapters/types';
import { clickIfAllowed } from '../dom/fillers';
import { fireChange, fireInput, fireLeave, setValue } from '../dom/fillers/events';
import { clickAdapterSignIn, clickAdapterSignInPrelude } from '../dom/fillers/not-submit';
import { challengeLikeFramesShown, detectPause, unsolvedCaptchas, vendorFramesShown } from '../dom/pause-detect';
import { newScanCache } from '../dom/scan-cache';
import {
  anchorOf, guardSubmission, passwordBoxIn, SIGN_IN_REFUSALS, signInFormOf, signInRefusal,
} from '../dom/sign-in-form';
import { deadline, monotonicNow } from '../dom/time';
import { isUserVisible } from '../dom/visibility';
import type { SignInCredential, SignInWall } from '../messaging/schemas';
import { log } from '../shared/log';
import { Invalidated, type Channel } from './channel';
import { watchForLateForm } from './late-form';

/** How long after its press a sign-in's outcome is watched for. */
export const SIGN_IN_SETTLE_MS = 20_000;
/** v3 Phase 7b: how long after its prelude press a wall's form is waited for (Workday switches its views in about
 *  1.5 s). */
export const SIGN_IN_PRELUDE_MS = 10_000;
/** v3 Phase 7b: how long after the typing a declared form's button, which its page enables once the form is filled, is
 *  waited for (SignInForm.enablesWhenFilled). */
export const SIGN_IN_ENABLE_MS = 3_000;
/** How often the page is looked at meanwhile. */
const LOOK_MS = 250;
/** How often a button that is still disabled is looked at. */
const ENABLE_LOOK_MS = 100;

/** What came of a sign-in (module header). */
export type SignInOutcome = 'continue' | 'failed' | 'unavailable' | 'left';

/** What a sign-in needs. */
export interface SignInContext {
  doc: Document;
  adapter: Adapter;
  channel: Pick<Channel, 'request'>;
  /** The frame's address now (location.href; tests pass the one they stand for). */
  href(): string;
  isTop: boolean;
  /** Aborted when the document goes. */
  signal: AbortSignal;
  settleMs?: number;
  /** v3 Phase 7b: how long a prelude's form is waited for (SIGN_IN_PRELUDE_MS by default). */
  preludeMs?: number;
}

function urlOf(href: string): URL | null {
  try {
    return new URL(href);
  } catch {
    return null;
  }
}

/** The account page the document shows now: a sign-in, an account's creation or (v3 Phase 7b) an email gate, or
 *  null. */
export function wallOf(doc: Document, adapter: Adapter): SignInWall | null {
  const pause = detectPause(doc, null, adapter);
  const kind = pause?.kind ?? null;
  return kind === 'sign-in' || kind === 'create-account' || kind === 'email-gate' ? kind : null;
}

/** Writes one box as a person's typing would leave it (the value setter, then input, change and leaving the box), and
 *  reads it back. The text is never logged. */
function typeInto(input: HTMLInputElement, text: string): boolean {
  setValue(input, text);
  fireInput(input, 'text');
  fireChange(input);
  fireLeave(input);
  return input.value === text;
}

/** Whether the sign-in's own host is the page's: the same host, or the one for every site on a covered host. */
function hostFits(credential: Pick<SignInCredential, 'host'>, host: string): boolean {
  return credential.host === host || (credential.host === '*' && signInHostCovered(host));
}

/** Whether the page shows a challenge not known solved now, anywhere (module header): a vendor's, solved or not, or a
 *  frame of another origin that reads like one (round 3, X9). */
function challenged(ctx: SignInContext): boolean {
  return unsolvedCaptchas(ctx.doc, null) > 0 || vendorFramesShown(ctx.doc) > 0 || challengeLikeFramesShown(ctx.doc) > 0;
}

/** The page's address now, when it is still on the origin asked for, over https; else null. */
function samePage(ctx: SignInContext, asked: URL): URL | null {
  const now = urlOf(ctx.href());
  return now === null || now.origin !== asked.origin || now.protocol !== 'https:' ? null : now;
}

/**
 * Writes the credential into the form (module header, 3), with nothing awaited between the checks and the writes; the
 * boxes the password went into are added to `secret`. Answers 'typed', or why not.
 */
function fill(ctx: SignInContext, wall: SignInWall, asked: URL, held: SignInForm, credential: SignInCredential,
  secret: HTMLInputElement[]): 'typed' | 'unavailable' | 'failed' {
  const now = samePage(ctx, asked);
  if (now === null) {
    log('content.sign-in-refused', { moved: true });
    return 'unavailable';
  }
  if (!hostFits(credential, now.hostname.toLowerCase())) {
    log('content.sign-in-refused', { host: true });
    return 'unavailable';
  }
  if (challenged(ctx)) {
    log('content.sign-in-refused', { captcha: true });
    return 'unavailable';
  }
  const form = signInFormOf(ctx.adapter, ctx.doc, wall);
  const refusal = form === null ? 'shape' : signInRefusal(form, now);
  if (form === null || refusal !== null || anchorOf(form) !== anchorOf(held)) {
    log('content.sign-in-refused', { refusal: refusal === null ? -1 : SIGN_IN_REFUSALS.indexOf(refusal), again: true });
    return 'unavailable';
  }
  // A sign-in or an account needs the password; an email gate types the email alone (the worker sends it no password).
  const password = credential.password;
  if (wall !== 'email-gate' && (password === undefined || form.password === null)) {
    log('content.sign-in-refused', { password: false });
    return 'unavailable';
  }
  const owner = anchorOf(form)?.form ?? null;
  let typed = true;
  if (form.email !== null) typed = typeInto(form.email, credential.email) && typed;
  if (form.confirmEmail != null) typed = typeInto(form.confirmEmail, credential.email) && typed;
  if (wall !== 'email-gate' && form.password !== null && password !== undefined) {
    // Each password box read again right before its write: the email's events may have changed it (module header).
    for (const box of [form.password, form.confirm]) {
      if (box === null) continue;
      if (!passwordBoxIn(box, owner)) {
        log('content.sign-in-refused', { changed: true });
        return 'failed';
      }
      secret.push(box);
      typed = typeInto(box, password) && typed;
    }
  }
  if (!typed) {
    log('content.sign-in', { typed: false });
    return 'failed';
  }
  for (const box of form.terms) clickIfAllowed(box, { adapter: ctx.adapter, root: null });
  return 'typed';
}

/** Whether a button can be pressed now: connected, and not disabled. */
function enabledNow(button: HTMLElement): boolean {
  return button.isConnected && (button as HTMLButtonElement).disabled !== true
    && button.getAttribute('aria-disabled') !== 'true';
}

/** Presses the form's own button through the sign-in door (module header, 3): at once, or, on a declared form whose page
 *  enables it once filled, once it is enabled (SIGN_IN_ENABLE_MS at most), with the page read again first. */
async function press(ctx: SignInContext, wall: SignInWall, asked: URL, held: SignInForm):
  Promise<'pressed' | 'unavailable' | 'failed' | 'left'> {
  const current = () => {
    try {
      return signInFormOf(ctx.adapter, ctx.doc, wall);
    } catch {
      return null;
    }
  };
  if (held.declared === true && held.enablesWhenFilled === true) {
    const until = monotonicNow() + SIGN_IN_ENABLE_MS;
    for (;;) {
      const form = current();
      if (form !== null && anchorOf(form) === anchorOf(held) && enabledNow(form.button)) break;
      if (monotonicNow() >= until) {
        log('content.sign-in', { enabled: false });
        return 'failed';
      }
      if ((await deadline(ENABLE_LOOK_MS, ctx.signal)) === 'aborted') return 'left';
    }
  }
  const now = samePage(ctx, asked);
  const form = current();
  if (now === null || form === null || anchorOf(form) !== anchorOf(held) || challenged(ctx)) {
    log('content.sign-in-refused', { pressed: false });
    return 'unavailable';
  }
  return clickAdapterSignIn(ctx.adapter, ctx.doc, wall, now) === null ? 'unavailable' : 'pressed';
}

/** Writes the password boxes empty again (module header, 4), where they are still in the page. Nothing is read. */
function clearSecret(secret: readonly HTMLInputElement[]): void {
  for (const box of secret) {
    if (!box.isConnected) continue;
    setValue(box, '');
    fireInput(box, 'text');
    fireChange(box);
  }
}

/** Whether the sign-in form shows an error now: the adapter's errors, a box the page marked invalid, or an alert in
 *  the form, each one a person can see. */
function errorShown(ctx: SignInContext, form: SignInForm): boolean {
  const cache = newScanCache();
  const owner = anchorOf(form)?.form ?? null;
  const scope: ParentNode = owner ?? ctx.doc;
  const marked = [form.email, form.password, form.confirm].some((field) => field !== null
    && field.getAttribute('aria-invalid') === 'true');
  if (marked) return true;
  let errors: Element[] = [];
  try {
    errors = owner === null ? [] : (ctx.adapter.errors?.(owner) ?? []).map((error) => error.el);
  } catch {
    errors = [];
  }
  const alerts = Array.from(scope.querySelectorAll('[role="alert" i], [aria-live="assertive" i]'))
    .filter((el) => (el.textContent ?? '').trim() !== '');
  return [...errors, ...alerts].some((el) => el.isConnected && isUserVisible(el, cache));
}

/** What came of the press (module header, 4). */
async function outcomeAfter(ctx: SignInContext, form: SignInForm): Promise<SignInOutcome> {
  const until = monotonicNow() + (ctx.settleMs ?? SIGN_IN_SETTLE_MS);
  const anchor = anchorOf(form);
  for (;;) {
    if ((await deadline(LOOK_MS, ctx.signal)) === 'aborted') return 'left';
    // A challenge the press raised is the person's: the run scans again and pauses at it.
    if (challenged(ctx)) return 'continue';
    if (anchor === null || !anchor.isConnected || !isUserVisible(anchor)) return 'continue';
    const pause = detectPause(ctx.doc, null, ctx.adapter);
    if (pause?.kind === 'email-code' || pause?.kind === 'captcha') return 'continue';
    if (errorShown(ctx, form)) return 'failed';
    if (monotonicNow() >= until) return 'failed';
  }
}

/** v3 Phase 7b: the wall's form, after the adapter's prelude where the page shows none yet (module header): the
 *  prelude pressed once, then the form waited for. Null when there is none to read. */
async function formAfterPrelude(ctx: SignInContext, wall: SignInWall, asked: URL): Promise<SignInForm | null> {
  const read = () => signInFormOf(ctx.adapter, ctx.doc, wall);
  const now = read();
  if (now !== null || ctx.adapter.signInPrelude === undefined) return now;
  if (clickAdapterSignInPrelude(ctx.adapter, ctx.doc, wall, asked) === null) return null;
  log('content.sign-in-prelude');
  const shown = (): SignInForm | null => {
    try {
      return read();
    } catch {
      return null;
    }
  };
  return new Promise((resolve) => {
    const first = shown();
    if (first !== null) {
      resolve(first);
      return;
    }
    watchForLateForm(ctx.doc, ctx.preludeMs ?? SIGN_IN_PRELUDE_MS, () => {
      const found = shown();
      if (found === null) return false;
      resolve(found);
      return true;
    }, ctx.signal, () => resolve(null));
    ctx.signal.addEventListener('abort', () => resolve(null), { once: true });
  });
}

/** Signs in once on the page the run paused at (module header). */
export async function signIn(ctx: SignInContext): Promise<SignInOutcome> {
  if (!ctx.isTop || ctx.signal.aborted) return 'unavailable';
  const asked = urlOf(ctx.href());
  let wall: SignInWall | null = null;
  let form: SignInForm | null = null;
  try {
    wall = wallOf(ctx.doc, ctx.adapter);
    form = wall === null || asked === null ? null : await formAfterPrelude(ctx, wall, asked);
  } catch {
    // A page that breaks the reading of its form (a control named as one of the form's own methods): never filled.
    log('content.sign-in-refused', { read: false });
    return 'unavailable';
  }
  if (ctx.signal.aborted) return 'left';
  if (wall === null || asked === null) return 'unavailable';
  const refusal = form === null ? null : signInRefusal(form, asked);
  if (form === null || refusal !== null) {
    log('content.sign-in-refused', { form: form !== null, refusal: refusal === null ? -1 : SIGN_IN_REFUSALS.indexOf(refusal) });
    return 'unavailable';
  }
  // A prelude may have drawn a challenge with the form: nothing is asked while one shows (round 2, E4).
  if (challenged(ctx)) {
    log('content.sign-in-refused', { captcha: true });
    return 'unavailable';
  }
  let answer: Awaited<ReturnType<Channel['request']>>;
  try {
    answer = await ctx.channel.request({ v: 1, type: 'signin/credential', wall });
  } catch (failure) {
    if (failure instanceof Invalidated) return 'left';
    throw failure;
  }
  if (ctx.signal.aborted) return 'left';
  if (!answer.ok) {
    log('content.sign-in', { asked: false, again: answer.error === 'expired' });
    return answer.error === 'expired' ? 'failed' : 'unavailable';
  }
  // From the typing to the end of the watch the browser never sends the form itself where the rules refuse (module
  // header).
  const watching = new AbortController();
  const stopGuard = guardSubmission(form, asked, AbortSignal.any([watching.signal, ctx.signal]));
  const secret: HTMLInputElement[] = [];
  let outcome: SignInOutcome = 'failed';
  try {
    // The answer is held in this frame only for the writes below (module header, 2).
    const typed = fill(ctx, wall, asked, form, answer.data as SignInCredential, secret);
    // A form whose press is the person's (SignInForm.personPresses): typed, and handed over (module header).
    if (typed === 'typed' && form.personPresses === true) {
      log('content.sign-in', { pressed: false, person: true });
      outcome = 'continue';
      return outcome;
    }
    const pressed = typed === 'typed' ? await press(ctx, wall, asked, form) : typed;
    log('content.sign-in', { pressed: pressed === 'pressed' });
    outcome = pressed === 'pressed' ? await outcomeAfter(ctx, form) : pressed;
    return outcome;
  } finally {
    // 'left' covers the run's own end too (the person's Stop, a route away), not only the document's: the boxes still
    // in the page are written empty again then as well (round 2, E3).
    if (outcome !== 'continue') clearSecret(secret);
    stopGuard();
    watching.abort();
  }
}
