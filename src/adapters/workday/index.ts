/*
 * The Workday adapter (docs/design/runtime.md §9; docs/ARCHITECTURE.md "Adapters", "Workday"): the quirks of a Workday
 * tenant's public pages, its posting, its "Start Your Application" choice and its account views. Every hook was read
 * from the public capture of 2026-11-04/05 (docs/FIXTURES.md, "The Workday, iCIMS, Taleo, SuccessFactors and Oracle
 * capture"; three tenants: Workday's own on wd5, Salesforce's on wd12 and Snap's on myworkdaysite.com, converted as
 * fixtures/workday/*.html) and names the markup it relies on. The application's steps after the account (Autofill with
 * Resume, My Information, My Experience, Application Questions, Voluntary Disclosures, Self Identify, Review) are read
 * by ./application.ts, written from the owner's signed-in snapshots of 2026-11-06 (its header says what each hook reads).
 * The pages are client-rendered React: the posting's description is drawn 6 to 11 s after the address commits, the
 * account view 5 to 11 s after Apply Manually (quirks.formLateMs: the runtime's 30 s cap).
 * - Form root: main > [data-automation-id=applyFlowPage], the application's flow page, which holds the account view
 *   (step 1 of its progress bar, "Create Account/Sign In") and, by that bar, every step after it in the same document:
 *   the root stays as the steps change in place. The posting and its choice have none.
 * - The posting (postingText): [data-automation-id=jobPostingDescription] (the sidebar, the similar jobs and the video
 *   are no posting).
 * - Entry (entryControl, for the auto-apply agent): the posting's Apply, a[data-automation-id=adventureButton]
 *   (.../apply), opens the choice in the same document (div[role=dialog][data-automation-id=wd-popup-frame]
 *   [aria-label="Start Your Application"]), whose a[data-automation-id=applyManually] (.../apply/applyManually) loads
 *   the account view in a new one: two presses in one document (quirks.entryPresses; the second only while the choice
 *   shows), the first waited for 15 s (quirks.entryWaitMs: Apply is drawn 6 to 11 s after load), each link read by the
 *   address it opens. Both are never pressed by a run (entryNeverPressed); the choice's other ways, "Autofill with
 *   Resume" (Workday reads the resume on its own server) and "Use My Last Application", and its "Apply with LinkedIn"
 *   frame and Close are never pressed at all (the addresses they open are read as the posting's application all the
 *   same: url.ts, the person's own choice).
 * - authState: the choice showing is 'entry-choice' (a person's own choice; the agent's entry presses Apply Manually
 *   there: content/press.ts); in [data-automation-id=signInContent], the Forgot Password view (its resetPasswordButton)
 *   is 'forgot-password', the person's alone (nothing is typed into its email box: its button sends a reset email), the
 *   Create Account view (createAccountSubmitButton) 'create-account', and the Sign In view (signInSubmitButton) and the
 *   landing ("Sign in with email" beside Apple and Google) 'sign-in'.
 * - Sign-in Auto (signInForm, signInPrelude): every view's form is form[data-automation-id=signInFormo], with no method
 *   and no action, sent by Workday's own script (scriptSubmits); its email input[data-automation-id=email], its password
 *   input[data-automation-id=password] (and Create Account's input[data-automation-id=verifyPassword]), and its press
 *   control the visible div[data-automation-id=click_filter][role=button] Workday draws over its own aria-hidden submit
 *   button inside [data-automation-id=noCaptchaWrapper]. Create Account's terms box,
 *   input[data-automation-id=createAccountCheckbox] ("I agree to creating this account...", or Salesforce's Candidate
 *   Privacy Notice), is marked required nowhere but is the account's: it is declared its terms, drawn at opacity 0
 *   behind its visible label[for]. On the landing the form shows only after "Sign in with email"
 *   (button[data-automation-id=SignInWithEmailButton]), the one prelude declared; the tenant decides whether the account
 *   view opens on the landing (Workday, Snap) or on Create Account (Salesforce). The switch from Sign In to Create
 *   Account stays the person's: nothing tells whether the job-site sign-in has an account on this tenant. jr6
 *   (FIXPLAN §6.4): createAccountSwitch names that switch (createAccountLink, still never pressed: only SHELL's gated
 *   door may press it), passwordRules reads Create Account's "Password Requirements" list, and accountErrorKind tells
 *   the kind of the error above the form (verify the email, reset the password, wrong email or password).
 * - Never pressed (neverPress): the header's Sign In (utilityButtonSignIn), its menus and navigation, "View all jobs",
 *   the similar jobs, "Read more", the social links and the privacy link on the posting; the choice's Autofill with
 *   Resume, Use My Last Application, Apply with LinkedIn and Close; on the account views Apple's and Google's sign-ins,
 *   "Back to Job Posting", the Sign In, Create Account and Forgot Password switches, and the Reset Password button with
 *   the click_filter drawn over it. The beecatcher (input[data-automation-id=beecatcher][name=website], 1 by 0 px,
 *   "This input is for robots only") is a honeypot the scanner never sees, and Sign-in Auto never types into.
 * Nothing here reads, logs or sends a value.
 */
import { newScanCache, type ScanCache } from '../../dom/scan-cache';
import { isUserVisible } from '../../dom/visibility';
import { genericAdapter } from '../generic';
import { successSignsOf, type SuccessRule } from '../success';
import type { AccountErrorKind, Adapter, PagePasswordClass, PagePasswordRules, SignInForm, SignInWall } from '../types';
import {
  accountErrors, dateFor, descriptionFor, fieldAlerts, isBusy, isFinalStep, labelFirst, labelFor, labelSuffix,
  neverPressedOnSteps, nextButton, repeatables, requiredFor, sections, stepSignature, submitButton, uploadHeld,
  uploadHeldNames, uploadState, uploadWidgets, widgetFor, widgetRoots,
} from './application';
import { canonicalApplicationUrl, matchesUrl, parseWorkdayUrl } from './url';

export { WORKDAY_STEP_SNAPSHOTS } from './application';

/** The snapshots the hooks were written from (fixtures/workday/). */
export const WORKDAY_SNAPSHOTS = ['fixtures/workday/workday-posting.html', 'fixtures/workday/workday-apply-choice.html',
  'fixtures/workday/workday-landing.html', 'fixtures/workday/workday-sign-in.html',
  'fixtures/workday/workday-create-account.html', 'fixtures/workday/workday-forgot-password.html',
  'fixtures/workday/salesforce-create-account.html', 'fixtures/workday/snap-sign-in.html'] as const;

/** The longest a Workday page takes to draw its posting or its account view (6 to 11 s live): the runtime's cap. */
export const WORKDAY_FORM_LATE_MS = 30_000;
/** How long the agent's entry waits for the posting's Apply (drawn 6 to 11 s after the address commits, live). */
export const WORKDAY_ENTRY_WAIT_MS = 15_000;

/** An element by its data-automation-id, in `scope`. */
const byId = <T extends Element = HTMLElement>(scope: ParentNode, id: string) =>
  scope.querySelector<T>(`[data-automation-id="${id}"]`);
/** Every element by its data-automation-id, in `scope`. */
const allById = (scope: ParentNode, id: string) => Array.from(scope.querySelectorAll(`[data-automation-id="${id}"]`));

/** The first of `elements` a person can see. */
function shown<T extends Element>(elements: readonly T[], cache: ScanCache = newScanCache()): T | null {
  return elements.find((el) => isUserVisible(el, cache)) ?? null;
}

/** The choice of how to apply, while it shows: fixtures/workday/workday-apply-choice.html's <div class="workday-popup
 *  wd-popup" data-automation-id="wd-popup-frame" ... role="dialog" aria-label="Start Your Application">. */
function choiceOf(doc: Document): Element | null {
  return shown(Array.from(doc.querySelectorAll('[role="dialog"][data-automation-id="wd-popup-frame"]'))
    .filter((dialog) => dialog.querySelector('[data-automation-id="applyManually"]') !== null));
}

/** The account view, while it shows: fixtures/workday/workday-*.html's <div data-automation-id="signInContent">
 *  inside the flow page. */
function accountOf(doc: Document): Element | null {
  return shown(allById(doc, 'signInContent'));
}

/** The flow page (fixtures/workday/workday-landing.html: <main ...><div data-automation-id="applyFlowPage">). */
function detect(doc: Document): { formRoot: Element } | null {
  const page = shown(allById(doc, 'applyFlowPage').filter((el) => el.closest('main') !== null));
  return page === null ? null : { formRoot: page };
}

/** The posting's own text: fixtures/workday/workday-posting.html's <div data-automation-id="jobPostingDescription">. */
function postingText(doc: Document): Element | null {
  return shown(allById(doc, 'jobPostingDescription'));
}

/** A link's address as the Workday parser reads it, against the document's base address, or null. */
function linkOf(link: Element, doc: Document) {
  try {
    return parseWorkdayUrl(new URL(link.getAttribute('href') ?? '', doc.baseURI));
  } catch {
    return null;
  }
}

/** The posting the document's own address shows, or null (a fixture's srcdoc page compares nothing). */
function hereOf(doc: Document) {
  try {
    return parseWorkdayUrl(new URL(doc.location.href));
  } catch {
    return null;
  }
}

/**
 * The agent's entry (module header): while the choice shows, its Apply Manually; otherwise the posting's Apply. Each a
 * link a person can see whose address opens this posting's application (Apply Manually) or its choice (Apply).
 */
function entryControl(doc: Document): HTMLElement | null {
  const here = hereOf(doc);
  const same = (link: Element, page: 'posting' | 'application') => {
    const target = linkOf(link, doc);
    return target !== null && target.page === page && (here === null || target.applicationUrl === here.applicationUrl);
  };
  const choice = choiceOf(doc);
  if (choice !== null) {
    // <a href=".../apply/applyManually" role="button" data-automation-id="applyManually">Apply Manually</a>
    const manual = shown(Array.from(choice.querySelectorAll<HTMLElement>(
      'a[data-automation-id="applyManually"][href]')));
    return manual !== null && same(manual, 'application') ? manual : null;
  }
  // <a href=".../job/<location>/<slug>_<reqId>/apply" role="button" ... data-automation-id="adventureButton">Apply</a>
  const apply = shown(Array.from(doc.querySelectorAll<HTMLElement>('a[data-automation-id="adventureButton"][href]'))
    .filter((link) => link.closest('[role="dialog"]') === null));
  return apply !== null && same(apply, 'posting') && /\/apply\/?$/.test(new URL(apply.getAttribute('href') ?? '',
    doc.baseURI).pathname) ? apply : null;
}

/** The account view's form: fixtures/workday/workday-sign-in.html's <form data-automation-id="signInFormo"> (no
 *  method, no action). */
function accountForm(doc: Document): HTMLFormElement | null {
  const account = accountOf(doc);
  return account === null ? null : account.querySelector<HTMLFormElement>('form[data-automation-id="signInFormo"]');
}

/** The visible face Workday draws over its own aria-hidden submit button `id`: fixtures/workday/workday-sign-in.html's
 *  <div data-automation-id="noCaptchaWrapper"> ... <div aria-label="Submit" role="button" tabindex="0"
 *  data-automation-id="click_filter"></div><button type="submit" data-automation-id="signInSubmitButton" ...
 *  tabindex="-2" aria-hidden="true">Sign In</button>, the two side by side. */
function faceOf(form: Element, id: string): HTMLElement | null {
  const hidden = byId(form, id);
  if (hidden === null || hidden.parentElement === null) return null;
  const face = Array.from(hidden.parentElement.children)
    .find((el) => el.getAttribute('data-automation-id') === 'click_filter' && el.getAttribute('role') === 'button');
  return (face as HTMLElement | undefined) ?? null;
}

function authState(doc: Document): ReturnType<NonNullable<Adapter['authState']>> {
  if (choiceOf(doc) !== null) return 'entry-choice';
  const account = accountOf(doc);
  if (account === null) return null;
  const form = accountForm(doc);
  if (form !== null) {
    // fixtures/workday/workday-forgot-password.html: <button type="submit" data-automation-id="resetPasswordButton"
    // ... aria-hidden="true">Reset Password</button>; workday-create-account.html: createAccountSubmitButton;
    // workday-sign-in.html: signInSubmitButton.
    if (byId(form, 'resetPasswordButton') !== null) return 'forgot-password';
    if (byId(form, 'createAccountSubmitButton') !== null) return 'create-account';
    if (byId(form, 'signInSubmitButton') !== null) return 'sign-in';
  }
  // The landing: fixtures/workday/workday-landing.html's <button data-automation-id="SignInWithEmailButton">Sign in
  // with email</button> beside AppleSignInButton and GoogleSignInButton.
  return shown(allById(account, 'SignInWithEmailButton')) !== null ? 'sign-in' : null;
}

/** Sign-in Auto's form for `wall` (module header), or null. */
function signInForm(doc: Document, wall: SignInWall): SignInForm | null {
  const form = accountForm(doc);
  if (form === null || wall === 'email-gate') return null;
  const email = form.querySelector<HTMLInputElement>('input[data-automation-id="email"]');
  const password = form.querySelector<HTMLInputElement>('input[data-automation-id="password"]');
  if (email === null || password === null || byId(form, 'resetPasswordButton') !== null) return null;
  if (wall === 'sign-in') {
    const button = faceOf(form, 'signInSubmitButton');
    return button === null ? null : { email, password, confirm: null, terms: [], button, form, scriptSubmits: true };
  }
  // fixtures/workday/workday-create-account.html: <input type="password" data-automation-id="verifyPassword" ...>,
  // <input type="checkbox" aria-checked="false" data-automation-id="createAccountCheckbox"> and its <label for>.
  const confirm = form.querySelector<HTMLInputElement>('input[data-automation-id="verifyPassword"]');
  const button = faceOf(form, 'createAccountSubmitButton');
  if (confirm === null || button === null) return null;
  const terms = Array.from(form.querySelectorAll<HTMLInputElement>(
    'input[type="checkbox"][data-automation-id="createAccountCheckbox"]')).filter((box) => !box.checked);
  return { email, password, confirm, terms, button, form, scriptSubmits: true };
}

/** The landing's "Sign in with email", the one control that shows the Sign In form (module header). */
function signInPrelude(doc: Document, wall: SignInWall): HTMLElement | null {
  if (wall !== 'sign-in' || accountForm(doc) !== null) return null;
  const account = accountOf(doc);
  return account === null ? null : shown(Array.from(account.querySelectorAll<HTMLElement>(
    'button[data-automation-id="SignInWithEmailButton"]')));
}

// ── jr6 WORKDAY P1 (FIXPLAN §6.4 items 3, 4 and 6; the hooks of FIXPLAN §3.1 items 12 to 14, read by SHELL) ──
/** The words of one rule of Create Account's "Password Requirements" list, each to what it requires (our own patterns,
 *  read from every captured tenant's list: fixtures/workday/workday-create-account.html, salesforce-create-account.html,
 *  s2-verily-create-account.html and jr6-aep-create-account.html, the six rules in any order). */
const PASSWORD_CLASS_RULES: ReadonlyArray<readonly [PagePasswordClass, RegExp]> = [
  ['upper', /^an? upper ?case (?:character|letter)$/i],
  ['lower', /^an? lower ?case (?:character|letter)$/i],
  ['digit', /^an? (?:numeric character|number|digit)$/i],
  ['special', /^an? special character$/i],
  ['alpha', /^an? (?:alphabetic character|letter)$/i],
];
/** "A minimum of 8 characters" (Jobright 1.25.2 reads the same item before it types: account-preflow
 *  password-requirements getWorkdayCreateAccountPasswordMinimum, the largest such minimum of the list's shown items). */
const PASSWORD_MINIMUM = /^a minimum of (\d{1,3}) characters?$/i;

/**
 * jr6 WD-02 (FIXPLAN §6.4 item 3): Create Account's own password rules, as its list shows them beside the password:
 * fixtures/workday/workday-create-account.html's <div data-automation-id="signInContent"> ... <div
 * data-automation-id="passwordRulesList"><div data-automation-id="richText"><ul><li>An alphabetic character</li> ...
 * <li>A minimum of 8 characters</li></ul>, in the dialog or account view that holds the form's
 * button[data-automation-id=createAccountSubmitButton] (Jobright 1.25.2's container, cited above). Each item a person
 * can see is read whole ("A minimum of N characters", "An uppercase character", "A lowercase character", "A numeric
 * character", "A special character", "An alphabetic character"); an item it does not know is left out. Fail open: null
 * where there is no such list, it shows no rule read here, or the page is in another language (its lang). The page's
 * words only, never a value.
 */
function passwordRules(form: SignInForm): PagePasswordRules | null {
  const from = form.form ?? form.button;
  const holder = from.closest('[role="dialog"], [data-automation-id="signInContent"]');
  if (holder === null || holder.querySelector('button[data-automation-id="createAccountSubmitButton"]') === null) return null;
  const lang = (holder.closest('[lang]')?.getAttribute('lang') ?? '').trim();
  if (lang !== '' && !/^en(?:-|$)/i.test(lang)) return null;
  const cache = newScanCache();
  let minLength: number | null = null;
  const requires = new Set<PagePasswordClass>();
  for (const item of Array.from(holder.querySelectorAll('li, [role="listitem"]'))) {
    if (!isUserVisible(item, cache)) continue;
    const words = (item.textContent ?? '').replace(/\s+/g, ' ').trim().replace(/[.!]$/, '');
    const minimum = PASSWORD_MINIMUM.exec(words);
    if (minimum !== null) {
      const n = Number(minimum[1]);
      if (Number.isSafeInteger(n) && n > 0) minLength = Math.max(minLength ?? 0, n);
      continue;
    }
    const known = PASSWORD_CLASS_RULES.find(([, pattern]) => pattern.test(words));
    if (known !== undefined) requires.add(known[0]);
  }
  if (minLength === null && requires.size === 0) return null;
  const ordered = PASSWORD_CLASS_RULES.map(([each]) => each).filter((each) => requires.has(each));
  return { ...(minLength === null ? {} : { minLength }), ...(ordered.length === 0 ? {} : { requires: ordered }) };
}

/**
 * jr6 WD-03 (FIXPLAN §6.4 item 4): the Sign In view's "Create Account" link, while a person can see it:
 * fixtures/workday/workday-sign-in.html (snap-sign-in.html, jr6-brookfield-sign-in.html, verily-sign-in-verify.html)'s
 * <button data-automation-id="createAccountLink">Create Account</button> in the account view whose form shows the
 * signInSubmitButton (Jobright 1.25.2's remote rules name the same control, CREATE_ACCOUNT_LINK_CSS
 * button[data-automation-id="createAccountLink"], which its account flow presses on a new tenant). Null on the landing
 * (before "Sign in with email": no form), on Create Account and on Forgot Password. It stays in NEVER_PRESSED_IDS:
 * only SHELL's gated door may press it (owner question Q4).
 */
function createAccountSwitch(doc: Document): HTMLElement | null {
  const form = accountForm(doc);
  const account = accountOf(doc);
  if (form === null || account === null || byId(form, 'signInSubmitButton') === null) return null;
  return shown(Array.from(account.querySelectorAll<HTMLElement>('button[data-automation-id="createAccountLink"]')));
}

/** jr6 WD-05: the kinds of an account error by its words, first match wins, in this order (our own patterns; the facts
 *  from Jobright 1.25.2's remote rules ACCOUNT_SUBMIT_ERROR_PATTERNS, account_verification_required ("verify your
 *  account", "verification email", "account verification"), password_reset_required ("reset your password", "forgot
 *  password", "administrator request") and invalid_credentials_or_locked ("wrong email address or password", "account
 *  might be locked"), tried in that order by its account-preflow detectWorkdayAccountSubmitError). */
const ACCOUNT_ERROR_KINDS: ReadonlyArray<readonly [AccountErrorKind, RegExp]> = [
  ['verify-email', /\bverify your (?:account|email(?: address)?)\b|\bverification e-?mail\b|\baccount verification\b/i],
  ['reset-password', /\breset your password\b|\bforgot(?:ten)? (?:your )?password\b|\badministrator (?:has )?request(?:ed)?\b/i],
  ['wrong-credentials', /\bwrong (?:email(?: address)?|password)\b|\b(?:email(?: address)?|user ?name) (?:and|or) password (?:is |are |was |were )?(?:incorrect|invalid|wrong)\b|\baccount (?:might|may) be locked\b|\baccount (?:is|has been) locked\b/i],
];

/**
 * jr6 WD-05 (FIXPLAN §6.4 item 6): the kind of the account error `el` shows, `el` one of the errors this adapter reads
 * on its account view (application.ts accountErrors: fixtures/workday/verily-sign-in-verify.html's <div
 * data-automation-id="errorMessage" role="alert">Verify your account before you sign in or request a verification
 * email.</div> above the Sign In form, 'verify-email'); null for any other element or words that name no kind.
 */
function accountErrorKind(el: Element): AccountErrorKind | null {
  const alert = el.closest('[data-automation-id="errorMessage"]');
  // ── jr7 WORKDAY-7 (WD7-06) ──
  if (alert === null) return accountNoticeKind(el);
  // ── end jr7 WORKDAY-7 ──
  if (alert.closest('[data-automation-id="signInContent"]') === null) return null;
  const words = (alert.textContent ?? '').replace(/\s+/g, ' ').trim();
  return ACCOUNT_ERROR_KINDS.find(([, pattern]) => pattern.test(words))?.[0] ?? null;
}
// ── end jr6 WORKDAY P1 ──

// ── jr7 WORKDAY-7 (FIX7PLAN §6.6 item 2, WD7-06; the Workday verifier's corrected fix) ──
/**
 * jr7 WD7-06: the kind of the account notice `el` shows, `el` inside the account view's notice: the Sign In view Workday
 * draws after Create Account, fixtures/workday/jr7-workday{1,2,3}-login-verify-sent.html's <div
 * data-automation-id="signInContent"> ... <p role="alert" data-automation-id="alertMessage">An email has been sent to
 * you. Please verify your account.</p> (snapshot7 workday1, workday2 and workday3, every tenant after Create Account),
 * beside its form, not inside it. A notice is no error: never one of this adapter's errors (index.ts errors,
 * application.ts accountErrors), so it never counts as a page error (content/press.ts refusalNow) nor as the agent's
 * errors on load; it is read only for the one kind that says the account waits for its email to be verified
 * ('verify-email', by ACCOUNT_ERROR_KINDS' own words), while a person can see it. Any other notice (a reset email sent)
 * names no kind: it refuses nothing. Jobright 1.25.2 reads the same alert only in its forgot-password flow
 * (FORGOT_PASSWORD_ALERT_CSS); the reading here is ours.
 */
function accountNoticeKind(el: Element): AccountErrorKind | null {
  const notice = el.closest('[data-automation-id="alertMessage"][role="alert" i]');
  if (notice === null || notice.closest('[data-automation-id="signInContent"]') === null || !isUserVisible(notice)) {
    return null;
  }
  const words = (notice.textContent ?? '').replace(/\s+/g, ' ').trim();
  const verify = ACCOUNT_ERROR_KINDS.find(([kind]) => kind === 'verify-email')![1];
  return verify.test(words) ? 'verify-email' : null;
}
// ── end jr7 WORKDAY-7 (WD7-06) ──

/** The automation ids of the controls never pressed (module header). */
const NEVER_PRESSED_IDS =['utilityButtonSignIn', 'utilityMenuButton', 'utilityButtonBarLanguageMenu', 'hammyMenuIcon',
  'toggle-all-jobs', 'similarJobsCard', 'readMore', 'socialIcon', 'privacyLink', 'logoLink', 'adventureButton',
  'autofillWithResume', 'applyManually', 'useMyLastApplication', 'applyWithLinkedIn', 'closeButton',
  'AppleSignInButton', 'GoogleSignInButton', 'backToJobPosting', 'createAccountLink', 'signInLink', 'forgotPasswordLink',
  'resetPasswordButton'];

function neverPress(root: Element): Element[] {
  const doc = root.ownerDocument;
  const found = NEVER_PRESSED_IDS.flatMap((id) => allById(doc, id));
  // The header's navigation: <a data-automation-id="navigationItem-Search for Jobs" ...>.
  found.push(...Array.from(doc.querySelectorAll('[data-automation-id^="navigationItem-"]')));
  // The Reset Password button's visible face (forgot-password.html: click_filter aria-label="Reset Password").
  for (const reset of allById(doc, 'resetPasswordButton')) {
    for (const sibling of Array.from(reset.parentElement?.children ?? [])) {
      if (sibling.getAttribute('data-automation-id') === 'click_filter') found.push(sibling);
    }
  }
  // The application steps' (./application.ts): Back, the cookie notice, the verification's resend, uploads' and
  // pills' and blocks' Delete, "Select files", the calendar and the phone's terms link.
  found.push(...neverPressedOnSteps(doc));
  return [...new Set(found)];
}

/** The Workday adapter. */
// ── v5 p2-detect ──
/** Workday's page after submitting, in no snapshot (the owner, 2026-11-08: "Jobright is sample, and it works perfectly.
 *  you can use it"): Jobright 1.25.2's rules 'myworkday-task-submitted-title', 'myworkday-task-application-submitted'
 *  and 'myworkday-submitted' (its ats-submission-rules), read as their behaviour and written here: the candidate home's
 *  task dialog (with its Return to home) titled Application Submitted, or saying so in its own words; or the sign-in
 *  content's "Congratulations" heading above the words that the application was submitted
 *  (fixtures/synthetic/success/workday.html). The finalize answered is its network sign (page/submit-watch.ts). */
export const WORKDAY_SUCCESS: readonly SuccessRule[] = [
  { css: '[data-automation-id="candidateHomeTaskModal"][role="dialog"]:has(button[data-automation-id="returnToHome"]) h2',
    text: /^Application Submitted$/,
      ...(__PROVENANCE__ && { from: "Jobright 1.25.2 ats-submission-rules 'myworkday-task-submitted-title'" }) },
  { css: '[data-automation-id="candidateHomeTaskModal"][role="dialog"]',
    text: /^(?:Application Submitted|Congratulations!?)\s*Your application has (?:been submitted successfully|successfully been submitted)\./,
    ...(__PROVENANCE__ && { from: "Jobright 1.25.2 ats-submission-rules 'myworkday-task-application-submitted'" }) },
  { css: '[data-automation-id="signInContent"] h1 + div', text: /^Your application has successfully been submitted\.$/,
    companion: { css: 'h1', text: /^Congratulations!?$/ },
      ...(__PROVENANCE__ && { from: "Jobright 1.25.2 ats-submission-rules 'myworkday-submitted'" }) },
];
// ── end v5 p2-detect ──

// ── jr7 WORKDAY-7 (FIX7PLAN §6.6 item 1, WD7-05; the Workday audit and its verifier) ──
/*
 * The page after submitting, captured for the first time (snapshot7; fixtures/workday/jr7-workday{1,2,3}-review.html,
 * then -confirmation.html): Workday routes the application's own document, with no new load, to
 * - the site's job search with the new application's id, /[<locale>/]<site>?Job_Application_ID=<id> (aristocrat.wd3 and
 *   unitytech.wd1, guest applications; unity's address keeps its ?source=), over which it draws a "Congratulations!"
 *   dialog offering Create Account (div[data-automation-id=popUpDialog][role=dialog] > div[data-automation-id=
 *   signInContent] > h1): unity's own words then read WORKDAY_SUCCESS's third rule, aristocrat's ("We've Received Your
 *   Application! ...") read none;
 * - or the candidate home's completed task, /[<locale>/]<site>/jobTasks/completed/application (republic.wd5, signed in),
 *   with its "Application Submitted" task dialog (WORKDAY_SUCCESS's first rule).
 * The application's base is its address before /job/<location>/<slug>_<reqId>[/apply[/<way>]] (url.ts reads the rest):
 * /[<locale>/]<site>, or /[<locale>/]recruiting/<tenant>/<site> on myworkdaysite.com; two bases are one site when they
 * name it alike once the locale is set aside and the case folded (url.ts: the site loads in any case and with any
 * locale, and the application key folds both). So the hook reads alike the two addresses AUTO-7 arms with: the
 * content runtime's, the form's own address at the press (/en-US/<Site>/job/<loc>/<slug>/apply/applyManually), and the
 * worker's, the arm's canonical posting address (TailorIT's parseAtsUrl canonical[0],
 * https://<host>/<Site>/job/<loc>/<slug>: no locale, no /apply), or the canonical application URL (url.ts, lower
 * case). Facts cited from Jobright 1.25.2:
 * its isAtsSubmissionConfirmationUrl('myworkday', from, to) reads `to` as the page after the application armed at `from`
 * when `to`'s path is that base with exactly one Job_Application_ID, non-empty, with no white space around it, `from`
 * holding none, or the base's /jobTasks/completed/application (where it also asks its own jr_id, which is not ours); and its
 * ~hooks/useShowSubmitted (module lxTxV) calls a Workday page submitted when an h1 says "Congratulations". The code is
 * ours. No id of the page after submitting is ever read into a key, an address or a log (FIX7PLAN §5 D-10): only
 * whether there is one. Here and never in url.ts (FIX7PLAN §0.11: the page-world bridge bundles url.ts).
 */
/** A posting's or its application's own address after its base (url.ts PATH): /job/<location>/<slug>_<reqId>, then
 *  /apply[/<way>] where given. */
const APPLY_TAIL = /\/job\/[^/]+\/[^/]+(?:\/apply(?:\/[^/]+)?)?$/;
/** The candidate home's completed application task, after the base. */
const COMPLETED_TASK = '/jobTasks/completed/application';
/** A base by its shape alone: a locale (as url.ts reads one) where given, myworkdaysite.com's /recruiting/<tenant>
 *  where given, then the site. */
const BASE_SHAPE = /^(?:\/[a-zA-Z]{2,3}(?:-[a-zA-Z\d]{2,4})?)?(?:\/recruiting\/[\w-]+)?\/[\w-]+$/;
/** The new application's id, as the page after submitting names it in its address. */
const APPLICATION_ID = 'Job_Application_ID';

/** An address's path with one trailing '/' set aside. */
const pathOf = (url: URL) => url.pathname.replace(/\/$/, '');
/** A base's site as one site is named whatever its address's locale and case (above): a first segment shaped as a
 *  locale (url.ts) set aside where more follows, the rest in lower case. */
const siteOf = (base: string) => base.replace(/^\/[a-zA-Z]{2,3}(?:-[a-zA-Z\d]{2,4})?(?=\/)/, '').toLowerCase();

/** The base of the application armed at `armed` (above): its path before the posting's own part, where the address
 *  reads as a posting or its application (url.ts: the form at …/apply/<way>, verily's steps at …/apply, or the
 *  posting the worker's arm keeps), else null (a sign-in page, Candidate Home, a search). */
function applicationBase(armed: URL): string | null {
  if (parseWorkdayUrl(armed) === null) return null;
  const path = pathOf(armed);
  const tail = APPLY_TAIL.exec(path);
  return tail === null ? null : path.slice(0, tail.index);
}

/** Whether `here` names one new application, as the page after submitting does: one Job_Application_ID, not empty,
 *  with no white space around it. Whether, never which. */
function namesNewApplication(here: URL): boolean {
  const ids = here.searchParams.getAll(APPLICATION_ID);
  return ids.length === 1 && ids[0]!.trim() !== '' && ids[0] === ids[0]!.trim();
}

/**
 * jr7 WD7-05 (Adapter.confirmationAfter): whether `here` is the page after submitting the application whose Submit was
 * armed at `armed` (above): both Workday candidate addresses of one origin (https, no port, no credentials), `armed` the
 * posting's or its application's own address (the form's at the press, the posting's canonical one the worker keeps,
 * or the canonical application URL) naming no Job_Application_ID, and `here` a base of the same site (siteOf) with one
 * new Job_Application_ID, or that base's /jobTasks/completed/application. Any other address, another site, tenant or
 * host, a second or an empty id, an `armed` sign-in page, Candidate Home's /userHome or a search: no. Pure.
 */
function confirmationAfter(armed: URL, here: URL): boolean {
  if (!matchesUrl(armed) || !matchesUrl(here) || armed.origin !== here.origin || armed.searchParams.has(APPLICATION_ID)) {
    return false;
  }
  const base = applicationBase(armed);
  if (base === null) return false;
  const path = pathOf(here);
  const task = path.endsWith(COMPLETED_TASK);
  const shown = task ? path.slice(0, -COMPLETED_TASK.length) : path;
  return siteOf(shown) === siteOf(base) && (task || namesNewApplication(here));
}

/** Whether `here` is shaped as a Workday page after submitting (above), whatever application it follows: a base with
 *  one new Job_Application_ID, or a base's completed task. */
function afterSubmitAddress(here: URL): boolean {
  if (!matchesUrl(here)) return false;
  const path = pathOf(here);
  if (path.endsWith(COMPLETED_TASK)) return BASE_SHAPE.test(path.slice(0, -COMPLETED_TASK.length));
  return BASE_SHAPE.test(path) && namesNewApplication(here);
}

/** The fourth drawn rule (WD7-05): the "Congratulations!" heading of the dialog drawn over the site's job search after
 *  submitting, in the tenant's own words below it (aristocrat's, which no WORKDAY_SUCCESS rule reads). Taken only at an
 *  address after submitting (workdaySignsAt), and like every drawn sign only after an armed Submit, new since the press,
 *  with the form gone (content/submitted.ts newSuccessSign). */
export const WORKDAY_CONGRATULATIONS: SuccessRule = {
  css: '[data-automation-id="popUpDialog"][role="dialog"] [data-automation-id="signInContent"] h1',
  text: /^Congratulations!?$/,
  ...(__PROVENANCE__ && { from: 'Jobright 1.25.2 ~hooks/useShowSubmitted (module lxTxV): an h1 saying Congratulations; '
    + 'snapshot7 workday1 and workday3 (fixtures/workday/jr7-workday{1,3}-confirmation.html)' }),
};

/** The drawn signs of the page after submitting that `doc` shows at `here` (its own address): the fourth rule's, at an
 *  address after submitting only; [] at any other address (none: a page whose address does not read). */
export function workdaySignsAt(doc: Document, here: URL | null): Element[] {
  return here !== null && afterSubmitAddress(here) ? successSignsOf(doc, [WORKDAY_CONGRATULATIONS]) : [];
}

/** A document's own address, or null (a fixture's about:srcdoc page reads none here). */
function addressOf(doc: Document): URL | null {
  try {
    const here = new URL(doc.location.href);
    return here.protocol === 'https:' ? here : null;
  } catch {
    return null;
  }
}

/** jr7 WD7-05 (Adapter.successSigns): the fourth rule's sign where the document's own address is a page after
 *  submitting (workdaySignsAt). A Workday page after submitting shows one application, the one its document armed, so
 *  the armed key is not compared: it is never read into anything either. */
function successSigns(doc: Document, _armedKey: string): Element[] {
  return workdaySignsAt(doc, addressOf(doc));
}
// ── end jr7 WORKDAY-7 (WD7-05) ──

export const workdayAdapter: Adapter = {
  id: 'workday',
  matchesUrl,
  canonicalApplicationUrl,
  detect,
  postingText,
  authState,
  signInForm,
  signInPrelude,
  // jr6 WD-02, WD-03, WD-05 (FIXPLAN §6.4): read by SHELL; the Create Account link is never pressed here.
  passwordRules,
  createAccountSwitch,
  accountErrorKind,
  // jr7 WD7-05 (FIX7PLAN §6.6 item 1): the page after submitting, by its address and by its drawn heading, read by
  // AUTO-7 (content/runtime.ts onAddress, background/submissions.ts confirmedArm, content/submitted.ts signsOf).
  confirmationAfter,
  successSigns,
  neverPress,
  // The generic aria-invalid errors, and on the account view the sign-in's error above its form (./application.ts).
  errors: (root) => [...(genericAdapter.errors?.(root) ?? []), ...accountErrors(root).map((el) => ({ el })),
    // The fix of 2026-11-08 (snapshot5): a field's alert under it ("Error: Invalid Date: ...").
    ...fieldAlerts(root).map((el) => ({ el }))],
  // The application's steps (./application.ts).
  stepSignature,
  isFinalStep,
  nextButton,
  submitButton,
  sections,
  labelFor,
  // jr6 workday-new-1: Self Identify's "Date signed" and "Language of this form" (./application.ts).
  labelSuffix,
  labelFirst,
  requiredFor,
  descriptionFor,
  widgetRoots,
  widgetFor,
  // s2 wd: the date input as one date field, written part by part (./application.ts, Dates).
  dateFor,
  uploadWidgets,
  uploadState,
  // The core pass of 2026-11-06: a field showing a file Workday took is answered, never uploaded again.
  uploadHeld,
  // The integration of 2026-11-06: the names beside those files, so the person's résumé never goes in twice.
  uploadHeldNames,
  repeatables,
  isBusy,
  // jr6 B5 (APPLYPLAN D5, BUILD.md §4 E-Workday): verily draws its application's steps at …/apply, which url.ts reads
  // as the posting (fixtures/workday/s2-verily-my-information.html's address): formAtPosting lets this adapter claim
  // the page there (APPLYPLAN F2 builds the runtime's side).
  quirks: { formLateMs: WORKDAY_FORM_LATE_MS, entryPresses: 2, entryWaitMs: WORKDAY_ENTRY_WAIT_MS, formAtPosting: true },
  entryControl,
  // Apply and Apply Manually are never pressed by a run (neverPress): the entry door presses that element alone.
  entryNeverPressed: true,
};
