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
 *    sign-in's host held to the page's (its own host, or `*` on a page signInHostCovered covers: since TailorIT's API
 *    6, on ADP's and ClearCompany's hosts by the page's path, its pathname, a candidate one alone), the form read and
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
 * The v4 review:
 * - L5: a challenge the page shows comes before the prelude too: with one shown and not solved (a checkbox CAPTCHA,
 *   which detectPause takes for no pause, beside Workday's landing), nothing is pressed, not even the prelude, and the
 *   sign-in answers 'challenged'.
 * - M5: what came of it says why the sign-in is the person's: 'none-saved' (the worker holds no job-site sign-in for
 *   the page: its `not_found`), 'challenged' (a challenge shows: nothing asked, typed or pressed while it does),
 *   'unavailable' (Sign-in Auto not allowed now, TailorIT not reached, a form refused, none read), 'failed' (the site
 *   refused it, or the tab was answered already). The page's toast follows it (orchestrator.ts toastsNow, runtime.ts
 *   showWallToast): the one to add a sign-in in TailorIT for 'none-saved' alone, the check to solve for 'challenged',
 *   the one to sign in on the page otherwise.
 * The snapshot build of 2026-11-06 (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06):
 * - core-x, item 3: a subframe whose adapter claims the tab's application (SignInContext.claimed: the same-host frame an
 *   iCIMS portal draws every step in, below its wrapper) signs in as a top frame does; the worker answers it only as
 *   the tab's claim frame (background/frames.ts claimFrameOf). Any other subframe never signs in.
 * - core-x, item 2: a create-account section inside an application form (SignInContext.section; Adapter.accountSection:
 *   iCIMS's "Create a login") is typed into as an account's creation whose press is the person's (its declared form must
 *   say personPresses): nothing is pressed, no prelude, and the run fills the rest of the form.
 * - core pass Z1, item 24: a declared sign-in container on a page the run filled like a step (SignInContext.container;
 *   Adapter.signInContainer: ADP's guest page, whose Continue mails a code; UltiPro's account step, whose Create account
 *   makes the account) is signed in to once the run rests there: the worker is asked as at an email gate (CONTAINER_WALL:
 *   the email alone, never a password, for a host whose sign-in the person saved or the every-site one covers), the
 *   saved email typed into the container's email box where it declares one, its terms ticked, and its button pressed
 *   through the sign-in door (not-submit.ts clickAdapterSignIn, from 'container'), every guard above held: a challenge
 *   first and right before the press, challenge frames, no password box (dom/sign-in-form.ts containerShape),
 *   guardSubmission over the <form> the press would send, https and the host.
 */
import { signInHostCovered } from '../contract/tailorit/credentials';
import type { Adapter, SignInForm } from '../adapters/types';
import { clickIfAllowed } from '../dom/fillers';
import { fireChange, fireInput, fireLeave, setValue } from '../dom/fillers/events';
import { accountFormOf } from '../dom/account-section';
import { clickAdapterSignIn, clickAdapterSignInPrelude } from '../dom/fillers/not-submit';
import { challengeLikeFramesShown, detectPause, unsolvedCaptchas, vendorFramesShown } from '../dom/pause-detect';
import { newScanCache } from '../dom/scan-cache';
import {
  anchorOf, guardSubmission, passwordBoxIn, SIGN_IN_REFUSALS, signInContainerOf, signInFormOf, signInRefusal,
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

/** Core pass Z1, item 24: the wall a sign-in container is asked for: an email gate's, so the worker answers the email
 *  alone and the password never leaves it (a container holds no password box: dom/sign-in-form.ts containerShape). */
export const CONTAINER_WALL: SignInWall = 'email-gate';

/** What came of a sign-in (module header): the v4 review (M5) tells 'none-saved' and 'challenged' apart from
 *  'unavailable'. */
export type SignInOutcome = 'continue' | 'failed' | 'unavailable' | 'none-saved' | 'challenged' | 'left';

/** What a sign-in needs. */
export interface SignInContext {
  doc: Document;
  adapter: Adapter;
  channel: Pick<Channel, 'request'>;
  /** The frame's address now (location.href; tests pass the one they stand for). */
  href(): string;
  isTop: boolean;
  /** The snapshot build of 2026-11-06 (core-x, item 3): a subframe whose adapter claims the tab's application (the
   *  same-host frame an iCIMS portal draws every step in, below its own wrapper: runtime.ts claimsApplication). It may
   *  sign in as a top frame does; any other subframe may not. */
  claimed?: boolean;
  /** core-x, item 2: sign in to the form's account section (Adapter.accountSection: iCIMS's "Create a login") rather
   *  than to an account page the run paused at: its declared create-account form, whose button is the person's. */
  section?: true;
  /** Core pass Z1, item 24: sign in through the page's declared sign-in container (Adapter.signInContainer) on a page the
   *  run filled like a step, rather than at an account page it paused at. */
  container?: true;
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

/** Whether the sign-in's own host is the page's: the same host, or the one for every site on a covered page (TailorIT's
 *  API 6, contract6: on ADP's and ClearCompany's hosts, at a candidate path alone; `path` is the page's pathname, no
 *  query and no fragment). */
function hostFits(credential: Pick<SignInCredential, 'host'>, host: string, path: string): boolean {
  return credential.host === host || (credential.host === '*' && signInHostCovered(host, path));
}

/** Whether the page shows a challenge not known solved now, anywhere (module header): a vendor's, solved or not, or a
 *  frame of another origin that reads like one (round 3, X9). The run reads it too (the v4 review, M5: a sign-in that
 *  answered 'challenged' is tried again once it no longer shows one). */
export function signInChallenged(doc: Document): boolean {
  return unsolvedCaptchas(doc, null) > 0 || vendorFramesShown(doc) > 0 || challengeLikeFramesShown(doc) > 0;
}

const challenged = (ctx: SignInContext): boolean => signInChallenged(ctx.doc);

/** The page's address now, when it is still on the origin asked for, over https; else null. */
function samePage(ctx: SignInContext, asked: URL): URL | null {
  const now = urlOf(ctx.href());
  return now === null || now.origin !== asked.origin || now.protocol !== 'https:' ? null : now;
}

/** The form the sign-in reads now: the declared container (core pass Z1, item 24), else the wall's form. */
function formNow(ctx: SignInContext, wall: SignInWall): SignInForm | null {
  return ctx.container === true ? signInContainerOf(ctx.adapter, ctx.doc) : signInFormOf(ctx.adapter, ctx.doc, wall);
}

/** Whether `form` is the one the sign-in read first: the same box it hangs on, and (a container) the same container. */
function sameForm(form: SignInForm, held: SignInForm): boolean {
  return anchorOf(form) === anchorOf(held) && (form.container ?? null) === (held.container ?? null);
}

/**
 * Writes the credential into the form (module header, 3), with nothing awaited between the checks and the writes; the
 * boxes the password went into are added to `secret`. Answers 'typed', or why not.
 */
function fill(ctx: SignInContext, wall: SignInWall, asked: URL, held: SignInForm, credential: SignInCredential,
  secret: HTMLInputElement[]): 'typed' | 'unavailable' | 'challenged' | 'failed' {
  const now = samePage(ctx, asked);
  if (now === null) {
    log('content.sign-in-refused', { moved: true });
    return 'unavailable';
  }
  if (!hostFits(credential, now.hostname.toLowerCase(), now.pathname)) {
    log('content.sign-in-refused', { host: true });
    return 'unavailable';
  }
  if (challenged(ctx)) {
    log('content.sign-in-refused', { captcha: true });
    return 'challenged';
  }
  const form = formNow(ctx, wall);
  const refusal = form === null ? 'shape' : refusalOf(ctx, form, now);
  if (form === null || refusal !== null || !sameForm(form, held)) {
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

/** signInRefusal, but (core-x, item 2) in an account section, whose button is never pressed here (its declared form's
 *  press is the person's), the button's own state is no reason to refuse the boxes: the page may disable "Submit
 *  Profile" while it reads a resume (githubinc-profile.frame-1.html's input#cp_form_submit_i disabled="disabled"). Every
 *  other rule holds as it is. */
function refusalOf(ctx: SignInContext, form: SignInForm, address: URL): ReturnType<typeof signInRefusal> {
  return signInRefusal(ctx.section === true && form.personPresses === true ? { ...form, enablesWhenFilled: true } : form,
    address);
}

/** Whether a button can be pressed now: connected, and not disabled. */
function enabledNow(button: HTMLElement): boolean {
  return button.isConnected && (button as HTMLButtonElement).disabled !== true
    && button.getAttribute('aria-disabled') !== 'true';
}

/** Presses the form's own button through the sign-in door (module header, 3): at once, or, on a declared form whose page
 *  enables it once filled, once it is enabled (SIGN_IN_ENABLE_MS at most), with the page read again first. */
async function press(ctx: SignInContext, wall: SignInWall, asked: URL, held: SignInForm):
  Promise<'pressed' | 'unavailable' | 'challenged' | 'failed' | 'left'> {
  const current = () => {
    try {
      return formNow(ctx, wall);
    } catch {
      return null;
    }
  };
  if (held.declared === true && held.enablesWhenFilled === true) {
    const until = monotonicNow() + SIGN_IN_ENABLE_MS;
    for (;;) {
      const form = current();
      if (form !== null && sameForm(form, held) && enabledNow(form.button)) break;
      if (monotonicNow() >= until) {
        log('content.sign-in', { enabled: false });
        return 'failed';
      }
      if ((await deadline(ENABLE_LOOK_MS, ctx.signal)) === 'aborted') return 'left';
    }
  }
  const now = samePage(ctx, asked);
  const form = current();
  if (now === null || form === null || !sameForm(form, held)) {
    log('content.sign-in-refused', { pressed: false });
    return 'unavailable';
  }
  if (challenged(ctx)) {
    log('content.sign-in-refused', { pressed: false, captcha: true });
    return 'challenged';
  }
  return clickAdapterSignIn(ctx.adapter, ctx.doc, wall, now, ctx.container === true ? 'container' : 'wall') === null
    ? 'unavailable' : 'pressed';
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
  // Core pass Z1, item 24: a box-less container's press is watched by the container itself.
  const anchor = anchorOf(form) ?? form.container ?? null;
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
  if ((!ctx.isTop && ctx.claimed !== true) || ctx.signal.aborted) return 'unavailable';
  const asked = urlOf(ctx.href());
  let wall: SignInWall | null = null;
  let form: SignInForm | null = null;
  // The v4 review (L5): a challenge shown and not solved comes first, before any press, the prelude's too.
  if (challenged(ctx)) {
    log('content.sign-in-refused', { captcha: true, first: true });
    return 'challenged';
  }
  try {
    // core-x, item 2: an account section is typed into, never pressed: its declared form's button is the person's.
    wall = ctx.section === true ? (accountFormOf(ctx.adapter, ctx.doc, null)?.personPresses === true
      ? 'create-account' : null)
      // Core pass Z1, item 24: a declared container is asked for as an email gate (CONTAINER_WALL); no prelude.
      : ctx.container === true ? (signInContainerOf(ctx.adapter, ctx.doc) === null ? null : CONTAINER_WALL)
        : wallOf(ctx.doc, ctx.adapter);
    form = wall === null || asked === null ? null : ctx.section === true || ctx.container === true ? formNow(ctx, wall)
      : await formAfterPrelude(ctx, wall, asked);
    if (ctx.section === true && form !== null && (form.personPresses !== true || form.declared !== true)) form = null;
  } catch {
    // A page that breaks the reading of its form (a control named as one of the form's own methods): never filled.
    log('content.sign-in-refused', { read: false });
    return 'unavailable';
  }
  if (ctx.signal.aborted) return 'left';
  if (wall === null || asked === null) return 'unavailable';
  const refusal = form === null ? null : refusalOf(ctx, form, asked);
  if (form === null || refusal !== null) {
    log('content.sign-in-refused', { form: form !== null, refusal: refusal === null ? -1 : SIGN_IN_REFUSALS.indexOf(refusal) });
    return 'unavailable';
  }
  // A prelude may have drawn a challenge with the form: nothing is asked while one shows (round 2, E4).
  if (challenged(ctx)) {
    log('content.sign-in-refused', { captcha: true });
    return 'challenged';
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
    log('content.sign-in', { asked: false, again: answer.error === 'expired', none: answer.error === 'not_found' });
    // The v4 review (M5): no sign-in saved for the page is told apart from one not allowed or not reached.
    return answer.error === 'expired' ? 'failed' : answer.error === 'not_found' ? 'none-saved' : 'unavailable';
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
