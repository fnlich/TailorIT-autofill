/*
 * The Taleo adapter (Taleo Enterprise; docs/design/runtime.md §9; docs/ARCHITECTURE.md "Adapters", "Taleo"): the quirks
 * of a Taleo portal's public pages, its posting, its Privacy Agreement, its sign-in and its password help. Every hook was
 * read from the public capture of 2026-11-04/05 (docs/FIXTURES.md, "The Workday, iCIMS, Taleo, SuccessFactors and Oracle
 * capture"; three portals: HDR, MassCareers and Chicago Public Schools, converted as fixtures/taleo/*.html) and names
 * the markup it relies on. The registration ("New User", a JSF post-back) and the application's flow after the sign-in
 * are not public: they wait for the owner's snapshots, and the generic adapter reads the flow meanwhile where its address
 * names the job (url.ts). The pages are server-rendered (JSF), each in a document of its own.
 * - Form root: the account pages' form#dialogTemplate-dialogForm (posting to the page's own origin), while it holds the
 *   sign-in or the password help; no other form is claimed. The Privacy Agreement is no root: its "I Accept" is the
 *   agent's entry there (below).
 * - The posting (postingText): .editablesection, the requisition's description blocks.
 * - Entry (entryControl): the visible "Apply Online", input[type=button][id$="APPLY_ON_REQ.row1"] (its ids hold dots:
 *   requisitionDescriptionInterface.UP_APPLY_ON_REQ.row1 and ...BOTTOM_APPLY_ON_REQ.row1), a JSF post-back that moves
 *   the page; never pressed by a run (entryNeverPressed). TailorIT's agent will rather open the documented
 *   jobapply.ftl?job= address (the agent never queues Taleo yet). On the Privacy Agreement a portal shows before the
 *   sign-in, its "I Accept" (input[type=button][id$="StatementBeforeAuthentificationContent-ContinueButton"]): the
 *   agreement is a required consent to apply, so the agent's entry accepts it, whatever the Consents mode says (a
 *   decision of the coordinator's under the owner's standing approval, docs/OWNER-QUESTIONS.md); "I Decline" never.
 * - authState: the sign-in ("Candidate Account Login": a password box) is 'sign-in'; the Privacy Agreement shown before
 *   it (I Accept / I Decline) is 'entry-choice', whose control the agent's entry presses (content/press.ts); the password
 *   help (forgotPasswordAccessCode.jsf, and forgotUsername.jsf by the same form) is 'forgot-password', nothing typed
 *   there.
 * - Sign-in Auto (signInForm): the login's "User Name" box (#dialogTemplate-dialogForm-login-name1, autocomplete off:
 *   Taleo's user name, often the candidate's email; the saved sign-in's email is typed there), its password and its
 *   Login (input[type=button]#dialogTemplate-dialogForm-login-defaultCmd, whose script posts the form), in that form. The
 *   user-name box gets the saved sign-in's email; there is no separate user-name slot (a decision of the coordinator's,
 *   docs/OWNER-QUESTIONS.md): a user name that is not the email is the person's to type, and the sign-in then fails
 *   once and says so.
 * - Required (requiredFor): the account pages mark a box required by an icon before its label (img.iam-entity-label-
 *   mandatory) and words only a screen reader hears.
 * - Never pressed (neverPress): "New User" (the registration, the person's until the snapshots), "Apply as Guest" (an
 *   application with no account: an open owner question), "I Decline", the forgot links and the password help's OK and
 *   Cancel, the LinkedIn and Google sign-ins, the header's Sign In, Job Search, My Account, My Job Cart and My Job Page,
 *   and "Apply Online" and "I Accept" (the entry door's alone).
 * Nothing here reads, logs or sends a value.
 */
import { newScanCache, type ScanCache } from '../../dom/scan-cache';
import { isUserVisible } from '../../dom/visibility';
import { genericAdapter } from '../generic';
import type { Adapter, SignInForm, SignInWall } from '../types';
import { canonicalApplicationUrl, matchesUrl } from './url';

/** The snapshots the hooks were written from (fixtures/taleo/). */
export const TALEO_SNAPSHOTS = ['fixtures/taleo/hdr-posting.html', 'fixtures/taleo/hdr-login.html',
  'fixtures/taleo/cps-login.html',
  'fixtures/taleo/hdr-forgot-password.html', 'fixtures/taleo/massanf-privacy-agreement.html'] as const;

/** The first of `elements` a person can see. */
function shown<T extends Element>(elements: readonly T[], cache: ScanCache = newScanCache()): T | null {
  return elements.find((el) => isUserVisible(el, cache)) ?? null;
}

/** The account pages' form (fixtures/taleo/hdr-login.html: <form id="dialogTemplate-dialogForm" method="post"
 *  action="/careersection/iam/accessmanagement/login.jsf">), and what it shows. */
function dialogOf(doc: Document): { form: HTMLFormElement; view: 'login' | 'forgot' | 'privacy' } | null {
  const form = doc.querySelector<HTMLFormElement>('form#dialogTemplate-dialogForm');
  if (form === null || !isUserVisible(form)) return null;
  // <input id="dialogTemplate-dialogForm-login-password" type="password" ...>
  if (form.querySelector('#dialogTemplate-dialogForm-login-password') !== null) return { form, view: 'login' };
  // massanf-privacy-agreement.html: <input id="dialogTemplate-dialogForm-StatementBeforeAuthentificationContent-
  // ContinueButton" type="button" value="I Accept">, in a form whose action is .../statementBeforeAuthentification.jsf.
  if (form.querySelector('[id$="StatementBeforeAuthentificationContent-ContinueButton"]') !== null) {
    return { form, view: 'privacy' };
  }
  // hdr-forgot-password.html (forgotPasswordAccessCode.jsf): <input id="dialogTemplate-dialogForm-username"> and <input
  // id="dialogTemplate-dialogForm-email">, with no password box; forgotUsername.jsf asks for the email the same way.
  if (form.querySelector('input#dialogTemplate-dialogForm-email, input#dialogTemplate-dialogForm-username') !== null) {
    return { form, view: 'forgot' };
  }
  return null;
}

function detect(doc: Document): { formRoot: Element } | null {
  const dialog = dialogOf(doc);
  return dialog === null || dialog.view === 'privacy' ? null : { formRoot: dialog.form };
}

/** The posting's own text: fixtures/taleo/hdr-posting.html's <div class="editablesection">. */
function postingText(doc: Document): Element | null {
  return shown(Array.from(doc.querySelectorAll('.editablesection')));
}

/** "Apply Online": <input type="button" id="requisitionDescriptionInterface.UP_APPLY_ON_REQ.row1" value="Apply Online">
 *  (and its BOTTOM_ twin), the first a person can see; on the Privacy Agreement, its <input type="button"
 *  id="dialogTemplate-dialogForm-StatementBeforeAuthentificationContent-ContinueButton" value="I Accept"> (module
 *  header). */
function entryControl(doc: Document): HTMLElement | null {
  const dialog = dialogOf(doc);
  if (dialog?.view === 'privacy') {
    return shown(Array.from(dialog.form.querySelectorAll<HTMLElement>(
      'input[type="button"][id$="StatementBeforeAuthentificationContent-ContinueButton"]')));
  }
  return shown(Array.from(doc.querySelectorAll<HTMLElement>('input[type="button"][id$="APPLY_ON_REQ.row1"]')));
}

function authState(doc: Document): ReturnType<NonNullable<Adapter['authState']>> {
  const dialog = dialogOf(doc);
  if (dialog === null) return null;
  return dialog.view === 'login' ? 'sign-in' : dialog.view === 'privacy' ? 'entry-choice' : 'forgot-password';
}

/** Sign-in Auto's form on the login (module header). */
function signInForm(doc: Document, wall: SignInWall): SignInForm | null {
  const dialog = dialogOf(doc);
  if (dialog === null || dialog.view !== 'login' || wall !== 'sign-in') return null;
  const email = dialog.form.querySelector<HTMLInputElement>('input#dialogTemplate-dialogForm-login-name1');
  const password = dialog.form.querySelector<HTMLInputElement>('input#dialogTemplate-dialogForm-login-password');
  const button = dialog.form.querySelector<HTMLElement>(
    'input[type="button"]#dialogTemplate-dialogForm-login-defaultCmd');
  if (email === null || password === null || button === null) return null;
  return { email, password, confirm: null, terms: [], button, form: dialog.form };
}

/** The controls never pressed (module header), by their ids as hdr-login.html, cps-login.html,
 *  massanf-privacy-agreement.html, hdr-forgot-password.html and hdr-posting.html write them. */
const NEVER_PRESSED = ['#dialogTemplate-dialogForm-login-register', '#dialogTemplate-dialogForm-login-guestapply',
  '#dialogTemplate-dialogForm-login-forgotUsernameLinkBottom', '#dialogTemplate-dialogForm-login-forgotPasswordLinkBottom',
  '#dialogTemplate-dialogForm-login-linkedinbutton', '[id$="StatementBeforeAuthentificationContent-ContinueButton"]',
  '[id$="StatementBeforeAuthentificationContent-CancelButton"]', '#dialogTemplate-dialogForm-defaultCmd',
  '#dialogTemplate-dialogForm-cancel', '[id^="dialogTemplate-dialogForm-flowHeader-"]', '[id^="topNavInterface."]',
  'a[title="Use your Google account information to login"]', 'input[type="button"][id$="APPLY_ON_REQ.row1"]'];

function neverPress(root: Element): Element[] {
  return Array.from(root.ownerDocument.querySelectorAll(NEVER_PRESSED.join(', ')));
}

/** A box Taleo marks required by the red icon before its label's text (hdr-login.html: <label for="..."><img
 *  class="iam-entity-label-mandatory" alt="">User Name<span class="hidden-audible">. Required</span></label>). */
function requiredFor(control: Element): boolean {
  // A labelable control's own labels (an element with none answers undefined).
  const labels = Array.from((control as HTMLInputElement).labels ?? []);
  return labels.some((label) => label.querySelector('img.iam-entity-label-mandatory') !== null);
}

/** The Taleo adapter. */
export const taleoAdapter: Adapter = {
  id: 'taleo',
  matchesUrl,
  canonicalApplicationUrl,
  detect,
  postingText,
  authState,
  signInForm,
  requiredFor,
  neverPress,
  errors: (root) => genericAdapter.errors?.(root) ?? [],
  isFinalStep: () => 'unknown',
  entryControl,
  // Apply Online and I Accept are never pressed by a run (neverPress): the entry door presses that element alone.
  entryNeverPressed: true,
};
