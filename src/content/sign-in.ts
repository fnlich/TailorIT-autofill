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
 *    A password the site did not take is never pressed again by itself (the worker answers a tab one press per wall),
 *    so there is no retry loop. On every outcome but 'continue', the password and its confirmation are written empty
 *    again in the boxes they were typed into that are still in the page (the v3 Phase 6/7b review, S5, and its round 2,
 *    E3: 'left' included, which also means the run's own end, the person's Stop or a route away): no password is left
 *    behind in a form the sign-in no longer watches; but what is kept for the person's own press (below: 'typed', and a
 *    press refused), guarded and watched for as long as it is kept, is written empty when that keep ends.
 * Email codes, CAPTCHA and every other check stay the person's: this module only reads where they are. A frame on a
 * challenge vendor's host shown anywhere, solved or not, refuses the sign-in too (round 2, E10), as does a frame of
 * another origin whose address, title, name or label reads like a challenge (round 3, X9), and the page is looked
 * at for a challenge once more after a prelude, before anything is asked (E4). A challenge
 * shown and not solved comes before every account page (dom/pause-detect.ts), so nothing is asked, typed or pressed
 * while one shows, and the page is looked at for one again right before the typing and right before the press.
 * v5 (PLAN decision 9, the owner's "implement like jobright extension", 2026-11-08): a checkbox CAPTCHA (reCAPTCHA
 * v2's, hCaptcha's), ticked or not, is no such challenge: the sign-in is typed and its button pressed beside it, and the
 * site decides. A press the site then refuses (an error, or nothing within the wait) while the box is still unticked
 * is 'challenged': the boxes keep what was typed, the page's toast says to solve the check, and the next press is the
 * person's, as Jobright leaves Sign In to the person: they tick the box and press the site's button, and the run carries
 * on once the page moves on (signInRefusalWaits: the run's pause watch never signs in again on that document's wall,
 * since the worker answers a tab once per wall). The box is never touched: the person ticks it. v5 review (S8): what
 * was typed is kept SIGN_IN_KEPT_MS at most, then written empty again (the password boxes), and at once when the run
 * stops or ends or the document goes (the sign-in's signal); a box the person typed into since is theirs and left as it
 * is. v5 review (F8): only a checkbox widget over or inside the sign-in's own form counts, never one elsewhere on the
 * page.
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
 * - L5: a challenge the page shows comes before the prelude too: with one shown and not solved (since v5 never a
 *   checkbox CAPTCHA: PLAN decision 9), nothing is pressed, not even the prelude, and the sign-in answers 'challenged'.
 * - M5: what came of it says why the sign-in is the person's: 'none-saved' (the worker holds no job-site sign-in for
 *   the page: its `not_found`), 'challenged' (a challenge shows: nothing asked, typed or pressed while it does; since
 *   v5 also a press the site refused while a checkbox CAPTCHA was unticked, whose next press is the person's),
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
 * jr6 (the owner's words of 2026-11-10: "store the password ... like jobright.ai. if needed, you should fetch this, and
 * autofill it"; coordinator decisions 1 and 5): the credential is the one saved in this browser's Sign-up Information
 * (background/signup-vault.ts), and the worker's answer says whether it may be pressed (`press`: Sign-in acting as Auto,
 * or the tab's Sign up & Autofill grant). On Sign-in Manual with a password saved (SignInContext.typeOnly, the run's
 * ContentSettings.typeSignIn), a sign-in or create-account page gets the email, the password and its confirmation typed
 * and the account's required terms ticked, every guard above held, and its button is left to the person ('typed'): the
 * boxes keep what was typed for their press until the run stops or ends or the document goes (the jr6 review's R11: no
 * timer, as Jobright never empties them; a box the person typed into since is theirs), as Jobright's account flow fills
 * the form and tracks the person's own press of Create Account or Sign In (its ~contents/sites/myworkday/account-preflow:
 * steps "Email Address", "Password", "Verify New Password", "Agree Privacy Notice", then a "track_submit" step that
 * listens for the button's click and presses nothing). The button is pressed only when both the worker's answer and this
 * frame's own run say Auto.
 * The jr6 review:
 * - sec-1: guardSubmission stays on for as long as a typed password is kept in the page (the keep ends it), and over a
 *   form whose press is the person's (SignInForm.personPresses: an account section, SuccessFactors' account page) until
 *   the document goes (SignInContext.page): the person's own press of a form the page's script sends never goes as the
 *   browser's GET with the password in the address, and a same-origin POST (an application's own Submit) still goes.
 * - R1: an ask this frame never presses (typeOnly, a section) says so (`typing`), so the worker's once-per-tab press
 *   limit neither refuses nor counts it; a press the site refused ('failed') keeps what was typed for the person, as one
 *   refused for its check does (SIGN_IN_KEPT_MS, the v5 review's S8), rather than emptying a password the person may not
 *   know.
 * - sec-3: a run on Manual types only into a document shown to the person: a background tab (the sequential
 *   auto-apply's) waits until it is shown before it asks.
 * - sec-5: every box the password is typed into is marked (dom/secret-boxes.ts), so it stays an auth field whatever the
 *   page makes of it (a "Show password").
 * - sec-8: the keeps of a document end at once when no saved password may be typed any more (dropKeptSignIns: the
 *   password deleted).
 * - R2: a password longer than its box's own maxlength (Taleo's 60) is never typed: nothing is ('unavailable').
 * - A form whose press is the person's, typed once in a document, is not typed again there (signInHandedOver): the run
 *   rests at it for the person.
 * jr6 SHELL-A (FIXPLAN §6.12 items 1, 4 and 6; APPLYPLAN G, folded per BUILD D-d):
 * - The page's own password rules (Adapter.passwordRules, read on an account's creation alone, fail open): a saved
 *   password shorter than the page's minimum, missing a class it lists, or the same as the login is never typed, nor
 *   anything else ('unavailable'); the rule it breaks is said (signInDetailOf), in our own words on the toast. Only
 *   whether each rule holds is read; the log names the rule's kind, never the password or its length.
 * - The page's account errors (Adapter.accountErrorKind over its errors a person can see): one that says the account
 *   waits for its email to be verified, shown as the page is read, means nothing is asked or typed ('unavailable'); after
 *   a press the site refused ('failed'), the kind it shows (verify the email, reset the password, the email or the
 *   password wrong) is said too (signInDetailOf), each its own toast.
 * - An email gate: the gate's email alone (the worker's answer at a gate carries no password, and no password box is
 *   ever read there); its declared terms boxes ticked only where the page marks them required (a required consent is
 *   ticked in either Consents mode; any other is the run's plan's, per the Consents mode: orchestrator.ts fills the
 *   gate as a step before this step); its Next pressed only when the worker says Auto (or Sign up & Autofill) and this
 *   run is not on Manual, never where the gate asks more of the person (personPresses), whose typing is 'typed': the
 *   person checks the rest and presses Next. Codes and CAPTCHAs are never touched.
 */
import { signInHostCovered } from '../contract/tailorit/credentials';
import type { AccountErrorKind, Adapter, PagePasswordClass, PagePasswordRules, SignInForm } from '../adapters/types';
import { clickIfAllowed } from '../dom/fillers';
import { fireChange, fireInput, fireLeave, setValue } from '../dom/fillers/events';
import { accountFormOf } from '../dom/account-section';
import { clickAdapterSignIn, clickAdapterSignInPrelude } from '../dom/fillers/not-submit';
import {
  captchaErrorsShown, checkboxCaptchasUnsolved, detectPause, pageChallenged, vendorFramesShown,
} from '../dom/pause-detect';
import { newScanCache } from '../dom/scan-cache';
import { markSecretBox } from '../dom/secret-boxes';
import {
  anchorOf, guardSubmission, passwordBoxIn, SIGN_IN_REFUSALS, signInContainerOf, signInFormOf, signInRefusal,
} from '../dom/sign-in-form';
import { deadline, monotonicNow, startDeadline } from '../dom/time';
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
/** v5 review (S8): how long the sign-in typed into a form the site refused for its unticked check stays there for the
 *  person's own press (a reCAPTCHA token lasts about two minutes): then the password boxes are written empty again. The
 *  jr6 review (R1): one the site refused ('failed') too. A sign-in typed on Manual has no such limit (R11). */
export const SIGN_IN_KEPT_MS = 180_000;
/** How often a button that is still disabled is looked at. */
const ENABLE_LOOK_MS = 100;

/** Core pass Z1, item 24: the wall a sign-in container is asked for: an email gate's, so the worker answers the email
 *  alone and the password never leaves it (a container holds no password box: dom/sign-in-form.ts containerShape). */
export const CONTAINER_WALL: SignInWall = 'email-gate';

/** What came of a sign-in (module header): the v4 review (M5) tells 'none-saved' and 'challenged' apart from
 *  'unavailable'. */
export type SignInOutcome = 'continue' | 'failed' | 'unavailable' | 'none-saved' | 'challenged' | 'left'
  // jr6: typed on Sign-in Manual, the press left to the person (module header).
  | 'typed';

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
  /** v5 review (S8): how long a refused sign-in stays typed for the person (SIGN_IN_KEPT_MS by default). */
  keptMs?: number;
  /** jr6: Sign-in on Manual with a password saved: type, never press (module header). */
  typeOnly?: true;
  /** The jr6 review (sec-1): aborted when the document goes (the runtime's lifetime), which `signal` also ends with: a
   *  password typed into a form whose press is the person's stays guarded until then. Absent: `signal`. */
  page?: AbortSignal;
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

// ── v5 p1-rules: CAPTCHA like Jobright (PLAN decision 9) ──
/** The documents whose sign-in press the site refused for its unticked check (module header). */
const refusedFor = new WeakSet<Document>();

/** Whether this document's sign-in press was refused for the page's unticked check (module header): its next press is
 *  the person's, so the run's pause watch never tries the sign-in again on this document's wall (orchestrator.ts
 *  watchPauseGone); it carries on once the page moves on. */
export function signInRefusalWaits(doc: Document): boolean {
  return refusedFor.has(doc);
}

/** The jr6 review (sec-8): the keeps of each document still holding a typed password (keepForPerson's ends). */
const keeps = new WeakMap<Document, Set<() => void>>();

/** The jr6 review (sec-8): ends every keep of `doc` now, the password boxes written empty again (a box the person typed
 *  into since is theirs): no saved password may be typed any more (it was deleted), so none is left in the page. */
export function dropKeptSignIns(doc: Document): void {
  for (const finish of [...(keeps.get(doc) ?? [])]) finish();
}

/** v5 review (S8): keeps the password boxes typed into for the person's own press, then writes them empty again: after
 *  `keptMs` (`timed`; the jr6 review's R11: never for a sign-in typed on Manual), or at once when the sign-in's signal
 *  ends (the run stopped or ended, the document gone) or (sec-8) dropKeptSignIns. A box the person typed into since (a
 *  trusted input) is theirs: never written. Nothing is read or kept but the elements. `release` ends the guard over the
 *  form's submission (the jr6 review, sec-1: it lasts as long as the keep). */
function keepForPerson(ctx: SignInContext, secret: readonly HTMLInputElement[], timed: boolean, release: () => void): void {
  const boxes = secret.filter((box) => box.isConnected);
  const theirs = new Set<EventTarget>();
  const onInput = (event: Event) => {
    if (event.isTrusted && event.currentTarget !== null) theirs.add(event.currentTarget);
  };
  for (const box of boxes) box.addEventListener('input', onInput, true);
  let done = false;
  const held = keeps.get(ctx.doc) ?? new Set<() => void>();
  const finish = () => {
    if (done) return;
    done = true;
    held.delete(finish);
    ctx.signal.removeEventListener('abort', finish);
    for (const box of boxes) box.removeEventListener('input', onInput, true);
    clearSecret(boxes.filter((box) => !theirs.has(box)));
    release();
  };
  if (ctx.signal.aborted) {
    finish();
    return;
  }
  held.add(finish);
  keeps.set(ctx.doc, held);
  ctx.signal.addEventListener('abort', finish, { once: true });
  if (timed) startDeadline(ctx.keptMs ?? SIGN_IN_KEPT_MS, finish);
}
// ── end v5 p1-rules ──

// ── jr6 SHELL-A: the page's own password rules and account errors (module header) ──
/** jr6 SHELL-A (FIXPLAN §6.12 item 1; WD-02, ICIMS-07): a rule of the page's own the saved password breaks: the fewest
 *  characters the page takes (its own number), a character class it requires, or "not the same as the login". */
export type BrokenPasswordRule = { kind: 'length'; minLength: number } | { kind: PagePasswordClass } | { kind: 'login' };

/** The rules' kinds, in the order they are checked: the log names a broken one by its place here (a number). */
export const PASSWORD_RULE_KINDS = ['length', 'upper', 'lower', 'digit', 'special', 'alpha', 'login'] as const;
/** The account errors' kinds (AccountErrorKind): the log names one by its place here (a number). */
export const ACCOUNT_ERROR_KINDS = ['verify-email', 'reset-password', 'wrong-credentials'] as const satisfies
  readonly AccountErrorKind[];

/** jr6 SHELL-A: what a document's last sign-in says beyond its outcome, for its toast (module header): the page's own
 *  password rule the saved one breaks (nothing typed), or the kind of account error the page shows (nothing typed for
 *  'verify-email' shown on arrival; after a press, the site's refusal). The page's rules and kinds only, never a value. */
export interface SignInDetail {
  rule?: BrokenPasswordRule;
  account?: AccountErrorKind;
}

/** Each document's last sign-in's detail (signInDetailOf). */
const details = new WeakMap<Document, SignInDetail>();

/** jr6 SHELL-A: the detail of this document's last sign-in (SignInDetail), or null: read by the toasts (orchestrator.ts
 *  toastsNow, runtime.ts showWallToast). */
export function signInDetailOf(doc: Document): SignInDetail | null {
  return details.get(doc) ?? null;
}

/** What each character class asks of a password: an ASCII letter of its case, a digit, a letter of either case, or
 *  anything but an ASCII letter or digit (a special character, as the pages' lists word it). */
const CLASS_TESTS: Readonly<Record<PagePasswordClass, RegExp>> = {
  upper: /[A-Z]/, lower: /[a-z]/, digit: /[0-9]/, special: /[^A-Za-z0-9]/, alpha: /[A-Za-z]/,
};

/** jr6 SHELL-A (FIXPLAN §6.12 item 1; WD-02, ICIMS-07): the first of the page's own password rules (Adapter.passwordRules
 *  on `form`, a create-account form) the saved password breaks, or null. Fail open: no hook, a hook that throws or
 *  reads none, or a rule it gives in a shape this does not know, is no rule. Only whether each rule holds is read, never
 *  a character of the password; its length is compared with the page's number and goes nowhere. Jobright 1.25.2 reads
 *  the same minimum before it types on Workday (~contents/sites/myworkday/account-preflow ./password-requirements
 *  satisfiesWorkdayCreateAccountPasswordMinimum: a behaviour reference only). */
function brokenRule(adapter: Adapter, form: SignInForm, password: string, login: string): BrokenPasswordRule | null {
  let rules: PagePasswordRules | null = null;
  try {
    rules = adapter.passwordRules?.(form) ?? null;
  } catch {
    rules = null;
  }
  if (rules === null || typeof rules !== 'object') return null;
  const min = rules.minLength;
  if (typeof min === 'number' && Number.isSafeInteger(min) && min > 0 && password.length < min) {
    return { kind: 'length', minLength: min };
  }
  const requires: readonly unknown[] = Array.isArray(rules.requires) ? rules.requires : [];
  for (const each of requires) {
    if (typeof each !== 'string' || !Object.hasOwn(CLASS_TESTS, each)) continue;
    const kind = each as PagePasswordClass;
    if (!CLASS_TESTS[kind].test(password)) return { kind };
  }
  const same = login.trim().toLowerCase();
  if (rules.notLogin === true && same !== '' && password.toLowerCase() === same) return { kind: 'login' };
  return null;
}

/** jr6 SHELL-A (FIXPLAN §6.12 item 4; WD-05): the kind of the account error the page shows about `form` now (the
 *  adapter's errors on the form's own <form>, each a person can see, read by Adapter.accountErrorKind), the first that
 *  names one; null otherwise (no hook, none shown, a hook that throws). Nothing of the error's words is kept or logged. */
function accountErrorShown(ctx: SignInContext, form: SignInForm): AccountErrorKind | null {
  const kindOf = ctx.adapter.accountErrorKind;
  const owner = anchorOf(form)?.form ?? form.form ?? null;
  if (kindOf === undefined || owner === null) return null;
  const cache = newScanCache();
  let errors: Element[];
  try {
    errors = (ctx.adapter.errors?.(owner) ?? []).map((error) => error.el);
  } catch {
    return null;
  }
  for (const el of errors) {
    if (!el.isConnected || !isUserVisible(el, cache)) continue;
    let kind: AccountErrorKind | null = null;
    try {
      kind = kindOf.call(ctx.adapter, el);
    } catch {
      kind = null;
    }
    if (kind !== null) return kind;
  }
  return null;
}

/** jr6 SHELL-A (D-d): whether a box the page marks required (its required attribute, or aria-required): a required
 *  consent is ticked in either Consents mode (core/resolver/policy.ts consentValue's consent.required). */
function markedRequired(box: HTMLInputElement): boolean {
  return box.required || (box.getAttribute('aria-required') ?? '').trim().toLowerCase() === 'true';
}
// ── end jr6 SHELL-A ──

/** The walls of each document whose account form, whose press is the person's (SignInForm.personPresses: SuccessFactors'
 *  account page), was typed: the run rests at that wall for the person and never types it again (module header). */
const handedOver = new WeakMap<Document, Set<SignInWall>>();

/** Whether this document's `wall` showed an account form whose press is the person's, typed already (module header): the
 *  run's pause never signs in again there (orchestrator.ts paused); another wall of the document is its own. */
export function signInHandedOver(doc: Document, wall: SignInWall | null): boolean {
  return wall !== null && (handedOver.get(doc)?.has(wall) ?? false);
}

/** The jr6 review (sec-3): whether the document is shown to the person now, or once it is (a background tab); false
 *  when `signal` ends first. */
function shownToPerson(doc: Document, signal: AbortSignal): Promise<boolean> {
  if (doc.visibilityState === 'visible') return Promise.resolve(true);
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const end = (shown: boolean) => {
      doc.removeEventListener('visibilitychange', look);
      signal.removeEventListener('abort', gone);
      resolve(shown);
    };
    const look = () => {
      if (doc.visibilityState === 'visible') end(true);
    };
    const gone = () => end(false);
    doc.addEventListener('visibilitychange', look);
    signal.addEventListener('abort', gone, { once: true });
  });
}

/** Whether the page shows a challenge not known solved now, anywhere (module header): a vendor's, solved or not, or a
 *  frame of another origin that reads like one (round 3, X9). The run reads it too (the v4 review, M5: a sign-in that
 *  answered 'challenged' is tried again once it no longer shows one). v5 (PLAN decision 9, like Jobright): a checkbox
 *  widget, ticked or not, is no such challenge (pageChallenged, vendorFramesShown): the sign-in is typed and pressed
 *  beside it, and the site decides; a refusal for it is 'challenged', the next press the person's (outcomeAfter). */
export function signInChallenged(doc: Document): boolean {
  return pageChallenged(doc) || vendorFramesShown(doc) > 0;
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
  // The jr6 review (R2): a password longer than a box takes (its own maxlength: Taleo's 60) is never typed, nor anything
  // else: a person could not type it there either. Only whether it fits is read, never its length.
  if (wall !== 'email-gate' && password !== undefined && [form.password, form.confirm].some((box) => box !== null
    && box.maxLength > 0 && password.length > box.maxLength)) {
    log('content.sign-in-refused', { fits: false });
    return 'unavailable';
  }
  // jr6 SHELL-A (FIXPLAN §6.12 item 1; WD-02, ICIMS-07): on an account's creation, a saved password the page's own rules
  // refuse is never typed, nor anything else; the rule is said on the toast (module header). Read fail open.
  if (wall === 'create-account' && password !== undefined) {
    const rule = brokenRule(ctx.adapter, form, password, credential.email);
    if (rule !== null) {
      details.set(ctx.doc, { rule });
      log('content.sign-in-refused', { rules: PASSWORD_RULE_KINDS.indexOf(rule.kind) });
      return 'unavailable';
    }
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
      // The jr6 review (sec-5): an auth field for good, whatever type the page gives it later (dom/secret-boxes.ts).
      markSecretBox(box);
      typed = typeInto(box, password) && typed;
    }
  }
  if (!typed) {
    log('content.sign-in', { typed: false });
    return 'failed';
  }
  // jr6 SHELL-A (D-d): at an email gate, only the terms the page marks required (ticked in either Consents mode); any
  // other is the run's plan's, which decided it per the Consents mode as it filled the gate (module header).
  for (const box of form.terms) {
    if (wall === 'email-gate' && !markedRequired(box)) continue;
    clickIfAllowed(box, { adapter: ctx.adapter, root: null });
  }
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
    // v5 (PLAN decision 9): refused while a checkbox CAPTCHA is still unticked (an error in the form, the site's own
    // CAPTCHA error anywhere on the page, or nothing within the wait): the check's (module header); v5 review (F8): a
    // checkbox over or inside the sign-in's own form, never one elsewhere on the page.
    if (errorShown(ctx, form) || captchaErrorsShown(ctx.doc, null, ctx.adapter).length > 0 || monotonicNow() >= until) {
      const own = anchorOf(form)?.form ?? form.container ?? null;
      return checkboxCaptchasUnsolved(ctx.doc, own) > 0 ? 'challenged' : 'failed';
    }
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
  // jr6 SHELL-A: each sign-in says its own detail (signInDetailOf), never an earlier one's.
  details.delete(ctx.doc);
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
  // jr6 SHELL-A (FIXPLAN §6.12 item 4; WD-05): the page says on arrival that the account waits for its email to be
  // verified: nothing is asked or typed, and the toast says to verify it first (module header).
  if (accountErrorShown(ctx, form) === 'verify-email') {
    details.set(ctx.doc, { account: 'verify-email' });
    log('content.sign-in-refused', { verify: true });
    return 'unavailable';
  }
  // The jr6 review (sec-3): a run on Manual types only into a document shown to the person (a background tab waits).
  if (ctx.typeOnly === true && !(await shownToPerson(ctx.doc, ctx.signal))) return 'left';
  // The jr6 review (R1): an ask this frame never presses says so: the worker's press limit neither refuses nor counts it.
  const typing = ctx.typeOnly === true || ctx.section === true;
  let answer: Awaited<ReturnType<Channel['request']>>;
  try {
    answer = await ctx.channel.request({ v: 1, type: 'signin/credential', wall,
      ...(typing ? { typing: true as const } : {}) });
  } catch (failure) {
    if (failure instanceof Invalidated) return 'left';
    throw failure;
  }
  if (ctx.signal.aborted) return 'left';
  if (!answer.ok) {
    log('content.sign-in', { asked: false, again: answer.error === 'expired', none: answer.error === 'not_found' });
    // The v4 review (M5): no sign-in saved for the page is told apart from one not allowed or not reached. ('expired':
    // a worker from before the jr6 review, which refused a second press.)
    return answer.error === 'expired' ? 'failed' : answer.error === 'not_found' ? 'none-saved' : 'unavailable';
  }
  // From the typing to the end of the watch, and (the jr6 review, sec-1) for as long as a typed password stays in the
  // page for the person, the browser never sends the form itself where the rules refuse (module header).
  const watching = new AbortController();
  const stopGuard = guardSubmission(form, asked, AbortSignal.any([watching.signal, ctx.page ?? ctx.signal]));
  const release = () => {
    stopGuard();
    watching.abort();
  };
  const secret: HTMLInputElement[] = [];
  let outcome: SignInOutcome = 'failed';
  /** What ends the guard, when not this function: the keep (`keep`), or the document's end (`page`). */
  let handedTo: 'keep' | 'page' | null = null;
  try {
    // The answer is held in this frame only for the writes below (module header, 2).
    const credential = answer.data as SignInCredential;
    const typed = fill(ctx, wall, asked, form, credential, secret);
    // A form whose press is the person's (SignInForm.personPresses): typed, and handed over (module header).
    if (typed === 'typed' && form.personPresses === true) {
      log('content.sign-in', { pressed: false, person: true });
      // jr6 SHELL-A (D-d): an email gate that asks more of the person (a phone, a consent's scope) was filled as a step
      // before this one: what is left is theirs to check, and its Next is theirs ('typed'); an account page whose
      // press is the person's is filled further by the run ('continue').
      outcome = wall === 'email-gate' ? 'typed' : 'continue';
      // At its wall the run rests for the person from now on (an account section is part of the form's own fill).
      if (ctx.section !== true) handedOver.set(ctx.doc, new Set([...(handedOver.get(ctx.doc) ?? []), wall]));
      // The jr6 review (sec-1): what was typed stays for the person's press, guarded until the document goes.
      if (secret.length > 0 && !(ctx.page ?? ctx.signal).aborted) handedTo = 'page';
      return outcome;
    }
    // jr6: pressed only when the worker says Auto and this run does too; otherwise typed for the person's press, kept
    // for it until the run stops or ends or the document goes (module header; the jr6 review, R11).
    if (typed === 'typed' && (credential.press !== true || ctx.typeOnly === true)) {
      log('content.sign-in', { pressed: false, typed: true });
      outcome = 'typed';
      handedTo = 'keep';
      keepForPerson(ctx, secret, false, release);
      return outcome;
    }
    const pressed = typed === 'typed' ? await press(ctx, wall, asked, form) : typed;
    log('content.sign-in', { pressed: pressed === 'pressed' });
    outcome = pressed === 'pressed' ? await outcomeAfter(ctx, form) : pressed;
    // jr6 SHELL-A (FIXPLAN §6.12 item 4; WD-05): a press the site refused says why where the page names a kind.
    if (pressed === 'pressed' && outcome === 'failed') {
      const kind = accountErrorShown(ctx, form);
      if (kind !== null) {
        details.set(ctx.doc, { account: kind });
        log('content.sign-in', { account: ACCOUNT_ERROR_KINDS.indexOf(kind) });
      }
    }
    // v5 (PLAN decision 9): refused for the page's unticked check: the next press is the person's (module header).
    if (pressed === 'pressed' && outcome === 'challenged' && !ctx.signal.aborted) {
      refusedFor.add(ctx.doc);
      log('content.captcha-refused', { signIn: true });
    }
    // v5 (PLAN decision 9) and the jr6 review (R1): refused for the page's check, or by the site, or its button never
    // enabled: the boxes keep what was typed for the person's own press, SIGN_IN_KEPT_MS at most (module header).
    if (typed === 'typed' && (outcome === 'challenged' || outcome === 'failed') && !ctx.signal.aborted) {
      handedTo = 'keep';
      keepForPerson(ctx, secret, true, release);
    }
    return outcome;
  } finally {
    // 'left' covers the run's own end too (the person's Stop, a route away), not only the document's: the boxes still
    // in the page are written empty again then as well (round 2, E3). jr6: a keep empties them itself, later.
    if (handedTo === null) {
      if (outcome !== 'continue') clearSecret(secret);
      release();
    }
  }
}
