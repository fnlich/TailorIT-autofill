/*
 * The Workday adapter (docs/design/runtime.md §9; docs/ARCHITECTURE.md "Adapters", "Workday"): the quirks of a Workday
 * tenant's public pages, its posting, its "Start Your Application" choice and its account views. Every hook was read
 * from the public capture of 2026-11-04/05 (docs/FIXTURES.md, "The Workday, iCIMS, Taleo, SuccessFactors and Oracle
 * capture"; three tenants: Workday's own on wd5, Salesforce's on wd12 and Snap's on myworkdaysite.com, converted as
 * fixtures/workday/*.html) and names the markup it relies on. The application's steps after the account (My
 * Information, My Experience, Application Questions, Voluntary Disclosures, Self Identify, Review) need a signed-in
 * session, so they wait for the owner's snapshots: no hook below is written for them, and they are read with the
 * standard semantics the generic adapter gives (the scanner's own rules, aria-invalid errors, the final step 'unknown',
 * so nothing is ever pressed there). The pages are client-rendered React: the posting's description is drawn 6 to 11 s
 * after the address commits, the account view 5 to 11 s after Apply Manually (quirks.formLateMs: the runtime's 30 s
 * cap).
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
 *   Account stays the person's: nothing tells whether the job-site sign-in has an account on this tenant.
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
import type { Adapter, SignInForm, SignInWall } from '../types';
import { canonicalApplicationUrl, matchesUrl, parseWorkdayUrl } from './url';

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

/** The automation ids of the controls never pressed (module header). */
const NEVER_PRESSED_IDS = ['utilityButtonSignIn', 'utilityMenuButton', 'utilityButtonBarLanguageMenu', 'hammyMenuIcon',
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
  return [...new Set(found)];
}

/** The Workday adapter. */
export const workdayAdapter: Adapter = {
  id: 'workday',
  matchesUrl,
  canonicalApplicationUrl,
  detect,
  postingText,
  authState,
  signInForm,
  signInPrelude,
  neverPress,
  errors: (root) => genericAdapter.errors?.(root) ?? [],
  isFinalStep: () => 'unknown',
  quirks: { formLateMs: WORKDAY_FORM_LATE_MS, entryPresses: 2, entryWaitMs: WORKDAY_ENTRY_WAIT_MS },
  entryControl,
  // Apply and Apply Manually are never pressed by a run (neverPress): the entry door presses that element alone.
  entryNeverPressed: true,
};
