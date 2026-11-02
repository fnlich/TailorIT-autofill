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
 *    not-submit.ts clickAdapterSignIn, which only this module may call (eslint.config.mjs).
 * 4. What came of it, watched for SIGN_IN_SETTLE_MS: the document leaving ('left': the next page's runs take over), the
 *    password box gone, or an email code or a CAPTCHA shown ('continue': the run scans again, and pauses for the
 *    person where it must); an error shown with the password box still there, or nothing within the wait ('failed').
 *    A password the site did not take is never typed again (the worker answers a tab once per wall), so there is no
 *    retry loop.
 * Email codes, CAPTCHA and every other check stay the person's: this module only reads where they are.
 */
import { signInHostCovered } from '../contract/tailorit/credentials';
import type { Adapter, SignInForm } from '../adapters/types';
import { clickIfAllowed } from '../dom/fillers';
import { fireChange, fireInput, fireLeave, setValue } from '../dom/fillers/events';
import { clickAdapterSignIn } from '../dom/fillers/not-submit';
import { detectPause } from '../dom/pause-detect';
import { newScanCache } from '../dom/scan-cache';
import { SIGN_IN_REFUSALS, signInFormOf, signInRefusal } from '../dom/sign-in-form';
import { deadline, monotonicNow } from '../dom/time';
import { isUserVisible } from '../dom/visibility';
import type { SignInCredential, SignInWall } from '../messaging/schemas';
import { log } from '../shared/log';
import { Invalidated, type Channel } from './channel';

/** How long after its press a sign-in's outcome is watched for. */
export const SIGN_IN_SETTLE_MS = 20_000;
/** How often the page is looked at meanwhile. */
const LOOK_MS = 250;

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
}

function urlOf(href: string): URL | null {
  try {
    return new URL(href);
  } catch {
    return null;
  }
}

/** The account page the document shows now: a sign-in or an account's creation, or null. */
export function wallOf(doc: Document, adapter: Adapter): SignInWall | null {
  const pause = detectPause(doc, null, adapter);
  return pause?.kind === 'sign-in' || pause?.kind === 'create-account' ? pause.kind : null;
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

/** Writes the credential into `form` and presses its button, all at once (module header, 3). Answers whether the
 *  button was pressed: 'pressed', or why not. */
function fillAndPress(ctx: SignInContext, wall: SignInWall, asked: URL, held: SignInForm, credential: SignInCredential):
  'pressed' | 'unavailable' | 'failed' {
  const now = urlOf(ctx.href());
  if (now === null || now.origin !== asked.origin || now.protocol !== 'https:') {
    log('content.sign-in-refused', { moved: true });
    return 'unavailable';
  }
  if (!hostFits(credential, now.hostname.toLowerCase())) {
    log('content.sign-in-refused', { host: true });
    return 'unavailable';
  }
  const form = signInFormOf(ctx.adapter, ctx.doc, wall);
  const refusal = form === null ? 'shape' : signInRefusal(form, now);
  if (form === null || refusal !== null || form.password !== held.password) {
    log('content.sign-in-refused', { refusal: refusal === null ? -1 : SIGN_IN_REFUSALS.indexOf(refusal), again: true });
    return 'unavailable';
  }
  let typed = true;
  if (form.email !== null) typed = typeInto(form.email, credential.email) && typed;
  typed = typeInto(form.password, credential.password) && typed;
  if (form.confirm !== null) typed = typeInto(form.confirm, credential.password) && typed;
  if (!typed) {
    log('content.sign-in', { typed: false });
    return 'failed';
  }
  for (const box of form.terms) clickIfAllowed(box, { adapter: ctx.adapter, root: null });
  return clickAdapterSignIn(ctx.adapter, ctx.doc, wall, now) === null ? 'unavailable' : 'pressed';
}

/** Whether the sign-in form shows an error now: the adapter's errors, a box the page marked invalid, or an alert in
 *  the form, each one a person can see. */
function errorShown(ctx: SignInContext, form: SignInForm): boolean {
  const cache = newScanCache();
  const owner = form.password.form;
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
  for (;;) {
    if ((await deadline(LOOK_MS, ctx.signal)) === 'aborted') return 'left';
    const password = form.password;
    if (!password.isConnected || !isUserVisible(password)) return 'continue';
    const pause = detectPause(ctx.doc, null, ctx.adapter);
    if (pause?.kind === 'email-code' || pause?.kind === 'captcha') return 'continue';
    if (errorShown(ctx, form)) return 'failed';
    if (monotonicNow() >= until) return 'failed';
  }
}

/** Signs in once on the page the run paused at (module header). */
export async function signIn(ctx: SignInContext): Promise<SignInOutcome> {
  if (!ctx.isTop || ctx.signal.aborted) return 'unavailable';
  const asked = urlOf(ctx.href());
  let wall: SignInWall | null = null;
  let form: SignInForm | null = null;
  try {
    wall = wallOf(ctx.doc, ctx.adapter);
    form = wall === null ? null : signInFormOf(ctx.adapter, ctx.doc, wall);
  } catch {
    // A page that breaks the reading of its form (a control named as one of the form's own methods): never filled.
    log('content.sign-in-refused', { read: false });
    return 'unavailable';
  }
  if (wall === null || asked === null) return 'unavailable';
  const refusal = form === null ? null : signInRefusal(form, asked);
  if (form === null || refusal !== null) {
    log('content.sign-in-refused', { form: form !== null, refusal: refusal === null ? -1 : SIGN_IN_REFUSALS.indexOf(refusal) });
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
  // The answer is held in this frame only for the writes below (module header, 2).
  const pressed = fillAndPress(ctx, wall, asked, form, answer.data as SignInCredential);
  log('content.sign-in', { pressed: pressed === 'pressed' });
  if (pressed !== 'pressed') return pressed;
  return outcomeAfter(ctx, form);
}
