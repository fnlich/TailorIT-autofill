/*
 * The SuccessFactors adapter (its classic career sites; docs/design/runtime.md §9; docs/ARCHITECTURE.md "Adapters",
 * "SuccessFactors"): the quirks of a career site's public pages, its posting, its sign-in, its account creation and its
 * password help. Every hook was read from the public capture of 2026-11-04/05 (docs/FIXTURES.md, "The Workday, iCIMS,
 * Taleo, SuccessFactors and Oracle capture"; Danfoss on career2.successfactors.eu, converted as
 * fixtures/successfactors/*.html, and Cipla on career10.successfactors.com, the same markup) and names the markup it
 * relies on. The application after the sign-in (career_ns=job_application), its terms dialog and its confirmation are
 * not public: they wait for the owner's snapshots, and the generic adapter reads them meanwhile where the address names
 * the job (url.ts). The pages are server-rendered, each in a document of its own.
 * - Form root: form#careerform (POST to the page's own origin) while it shows an account view: the sign-in (#username
 *   beside #password), the account's creation (#fbclc_userName, #fbclc_pwd) or the password help (input[name=cEmail]);
 *   no other form is claimed.
 * - The posting (postingText): .joqReqDescription.
 * - Entry (entryControl): the visible button#applyButton_top (or _bottom), whose script posts the page, pressed only
 *   where it submits no form itself (the entry door's own rule); never pressed by a run (entryNeverPressed).
 * - authState: the sign-in is 'sign-in', the account's creation 'create-account', the password help
 *   'forgot-password' (nothing typed there).
 * - Sign-in Auto (signInForm): the sign-in's "Email Address" (#username, autocomplete=username), its password (#password,
 *   current-password) and its Sign In (the typeless button of form#careerform whose own words read "Sign In", whose
 *   script validates and posts the form): the standard rule reads the same form, declared here for the page's own ids.
 *   The account's creation follows Sign-in Auto as Workday's does (a decision of the coordinator's under the owner's
 *   standing approval, docs/OWNER-QUESTIONS.md): its "Email Address" (#fbclc_userName) and "Retype Email Address"
 *   (#fbclc_emailConf, the confirmEmail slot), its password (#fbclc_pwd) and its confirmation (#fbclc_pwdConf) are
 *   typed; but the form also asks for a first and last name, a phone with its country code, a country and terms
 *   accepted in a dialog (#dataPrivacyId), none of which Sign-in Auto fills (the terms dialog stays the person's until
 *   there are snapshots), so its Create Account (button#fbclc_createAccountButton) is the person's to press
 *   (personPresses): the credential typed, the run pauses there for the rest.
 * - Never pressed (neverPress): Apply (the entry door's alone), the cookie banner's buttons, "Show" (the password's),
 *   the password help's Submit and Cancel, the terms dialog's opener, and the employees' sign-in links.
 * The snapshot build of 2026-11-06 (docs/ARCHITECTURE.md, the snapshot build of 2026-11-06): the owner's snapshot of DFIN's account creation
 * (career8.successfactors.com, fixtures/successfactors/donnelleyf-create-account.html) is the same form#careerform,
 * read by the same hooks: the email twice, the password twice, a first and last name, a country, two notification
 * boxes, a required reCAPTCHA ("Confirm you are not a robot:", which makes the page a CAPTCHA pause) and the terms'
 * a#dataPrivacyId ("Read and accept the data privacy statement.", whose dialog no snapshot shows open). The application
 * after the account (its snapshot "Apply for ... (4984)") is posted to /portalcareer?_s.crb=<token>, an address that
 * names no job, so no application is read there (url.ts) and the extension stays dormant on it.
 * v5 p2-detect (the owner, 2026-11-08: "Jobright is sample, and it works perfectly. you can use it"): the application
 * form, in no snapshot, as Jobright 1.25.2 reads it (its successfactors-submission-network module, read as its
 * behaviour): form#careerform holding input#career_ns whose value is job_application is the application ('application'
 * view: claimed, filled as the generic reading fills it, no auth); its Submit (submitButton) is the page's
 * span[role=button] whose id ends _submitBtn, else the form's submit control whose value is "apply" (Jobright's
 * SUCCESSFACTORS_FINAL_SUBMIT_SELECTOR), read only so the person's own click on it arms the "applied" watch (isFinalStep
 * stays 'unknown': nothing of ours presses it). Its page after submitting (SUCCESSFACTORS_SUCCESS): Jobright's
 * 'successfactors-application-sent', #jobAppPageTitle's #success_message saying the application was sent, beside the
 * page's "Jobs applied" button. The application's network sign is the page-world watcher's (page/submit-watch.ts).
 * Nothing here reads, logs or sends a value.
 */
import { newScanCache, type ScanCache } from '../../dom/scan-cache';
import { isUserVisible } from '../../dom/visibility';
import { genericAdapter } from '../generic';
import type { SuccessRule } from '../success';
import type { Adapter, SignInForm, SignInWall } from '../types';
import { canonicalApplicationUrl, matchesUrl } from './url';

/** The snapshots the hooks were written from (fixtures/successfactors/). */
export const SUCCESSFACTORS_SNAPSHOTS = ['fixtures/successfactors/danfoss-posting.html',
  'fixtures/successfactors/danfoss-sign-in.html', 'fixtures/successfactors/danfoss-create-account.html',
  'fixtures/successfactors/danfoss-forgot-password.html',
  // ── snapshot build 2026-11-06 (oracle-sf-sr): DFIN's account creation, read by the same hooks ──
  'fixtures/successfactors/donnelleyf-create-account.html'] as const;

/** The first of `elements` a person can see. */
function shown<T extends Element>(elements: readonly T[], cache: ScanCache = newScanCache()): T | null {
  return elements.find((el) => isUserVisible(el, cache)) ?? null;
}

/** The account view form#careerform shows (fixtures/successfactors/danfoss-sign-in.html: <form id="careerform"
 *  name="careerform" action="/career?_s.crb=..." method="POST">), or null. */
function viewOf(doc: Document): { form: HTMLFormElement;
  view: 'sign-in' | 'create-account' | 'forgot' | 'application' } | null {
  const form = doc.querySelector<HTMLFormElement>('form#careerform');
  if (form === null || !isUserVisible(form)) return null;
  // danfoss-forgot-password.html: <input type="text" ... id="username" ... name="cEmail">.
  if (form.querySelector('input[name="cEmail"]') !== null) return { form, view: 'forgot' };
  // danfoss-create-account.html: <input class="form-control" id="fbclc_pwd" type="password" ...>.
  if (form.querySelector('input#fbclc_pwd[type="password"]') !== null) return { form, view: 'create-account' };
  // danfoss-sign-in.html: <input type="text" name="username" id="username" ... autocomplete="username"> and <input
  // type="password" name="password" id="password" ... autocomplete="current-password">.
  if (form.querySelector('input#username[name="username"]') !== null
    && form.querySelector('input#password[type="password"]') !== null) return { form, view: 'sign-in' };
  // v5 p2-detect: the application (module header): every input#career_ns of the form reads job_application.
  const kind = Array.from(form.querySelectorAll<HTMLInputElement>('input#career_ns'));
  if (kind.length > 0 && kind.every((box) => box.value === 'job_application')) return { form, view: 'application' };
  return null;
}

// ── v5 p2-detect ──
/** The application's Submit (module header): the page's span[role=button] whose id ends _submitBtn, not
 *  aria-disabled, else form#careerform's submit control whose value is "apply"; a person must see it. */
function submitButton(root: Element): HTMLElement | null {
  const doc = root.ownerDocument;
  if (viewOf(doc)?.view !== 'application') return null;
  const cache = newScanCache();
  return shown(Array.from(doc.querySelectorAll<HTMLElement>('span[role="button"][id$="_submitBtn"]:not([aria-disabled="true"])')),
    cache) ?? shown(Array.from(doc.querySelectorAll<HTMLElement>(
    'form#careerform button[type="submit"][value="apply"], form#careerform input[type="submit"][value="apply"]')), cache);
}

/** The page after submitting (module header): Jobright 1.25.2's rule 'successfactors-application-sent', read as its
 *  behaviour (fixtures/synthetic/success/successfactors.html). */
export const SUCCESSFACTORS_SUCCESS: readonly SuccessRule[] = [
  { css: '#jobAppPageTitle > #success_message', text: /^Your application has been sent\. Thank you!$/,
    companion: { css: 'button#fbja_jobsApplied', text: /\S/, scope: '#jobAppPageTitle' },
    from: "Jobright 1.25.2 ats-submission-rules 'successfactors-application-sent'" },
];
// ── end v5 p2-detect ──

function detect(doc: Document): { formRoot: Element } | null {
  const view = viewOf(doc);
  return view === null ? null : { formRoot: view.form };
}

/** The posting's own text: fixtures/successfactors/danfoss-posting.html's <div class="joqReqDescription" role="note">. */
function postingText(doc: Document): Element | null {
  return shown(Array.from(doc.querySelectorAll('.joqReqDescription')));
}

/** Apply: <button id="applyButton_top" onclick="checkDpcs2AndProceed(...)"> (and applyButton_bottom). */
function entryControl(doc: Document): HTMLElement | null {
  return shown(Array.from(doc.querySelectorAll<HTMLElement>('button#applyButton_top, button#applyButton_bottom')));
}

function authState(doc: Document): ReturnType<NonNullable<Adapter['authState']>> {
  const view = viewOf(doc);
  // v5 p2-detect: the application is filled like a step, no account view.
  return view === null || view.view === 'application' ? null : view.view === 'forgot' ? 'forgot-password' : view.view;
}

/** A button's own words, white space collapsed, in lower case. */
const wordsOf = (button: Element) => (button.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Sign-in Auto's form (module header): on the sign-in, danfoss-sign-in.html's <button onclick="return
 *  validateFields();">Sign In</button>, the typeless button of the form whose words read "Sign In"; on the account's
 *  creation, danfoss-create-account.html's boxes and its <button id="fbclc_createAccountButton"
 *  name="fbclc_createAccountButton">, pressed by the person (personPresses). */
function signInForm(doc: Document, wall: SignInWall): SignInForm | null {
  const view = viewOf(doc);
  if (view === null) return null;
  const form = view.form;
  if (view.view === 'sign-in' && wall === 'sign-in') {
    const email = form.querySelector<HTMLInputElement>('input#username[name="username"]');
    const password = form.querySelector<HTMLInputElement>('input#password[type="password"]');
    const buttons = Array.from(form.querySelectorAll<HTMLButtonElement>('button')).filter((button) => button.type === 'submit'
      && button.form === form && isUserVisible(button) && wordsOf(button) === 'sign in');
    if (email === null || password === null || buttons.length !== 1) return null;
    return { email, password, confirm: null, terms: [], button: buttons[0]!, form };
  }
  if (view.view !== 'create-account' || wall !== 'create-account') return null;
  const email = form.querySelector<HTMLInputElement>('input#fbclc_userName');
  const confirmEmail = form.querySelector<HTMLInputElement>('input#fbclc_emailConf');
  const password = form.querySelector<HTMLInputElement>('input#fbclc_pwd[type="password"]');
  const confirm = form.querySelector<HTMLInputElement>('input#fbclc_pwdConf[type="password"]');
  const button = form.querySelector<HTMLElement>('button#fbclc_createAccountButton');
  if (email === null || confirmEmail === null || password === null || confirm === null || button === null) return null;
  return { email, confirmEmail, password, confirm, terms: [], button, form, personPresses: true };
}

/** The controls never pressed (module header): danfoss-posting.html's #cookie-accept, #cookie-reject and
 *  #cookie-bannershow; the sign-in's <input type="button" ... id="show_button" value="Show"> (and the confirmation's
 *  #show_conf_button); the password help's buttons; the creation's a#dataPrivacyId; links to performancemanager<n>. */
const NEVER_PRESSED = ['button#applyButton_top', 'button#applyButton_bottom', '#cookie-accept', '#cookie-reject',
  '#cookie-bannershow', '#show_button', '#show_conf_button', 'a#dataPrivacyId', 'a[href*="performancemanager"]'];

function neverPress(root: Element): Element[] {
  const doc = root.ownerDocument;
  const found = Array.from(doc.querySelectorAll(NEVER_PRESSED.join(', ')));
  // The password help's Submit and Cancel (danfoss-forgot-password.html: <button type="submit"> and <button
  // type="button">, in the form that holds input[name=cEmail]).
  const view = viewOf(doc);
  if (view?.view === 'forgot') found.push(...Array.from(view.form.querySelectorAll('button')));
  return [...new Set(found)];
}

/** The sign-in's errors (danfoss-sign-in.html: #uiErrorContainer_2 role=alert, #signIn_EmailError and
 *  #signIn_PasswordError, aria-live assertive), once shown, and the controls the page marks invalid. */
function errors(root: Element): Array<{ el: Element; fieldKeyHint?: string }> {
  const cache = newScanCache();
  const signs = Array.from(root.ownerDocument.querySelectorAll(
    '#uiErrorContainer_2, #signIn_EmailError, #signIn_PasswordError'))
    .filter((el) => isUserVisible(el, cache) && (el.textContent ?? '').trim() !== '').map((el) => ({ el }));
  return [...(genericAdapter.errors?.(root) ?? []), ...signs];
}

/** The SuccessFactors adapter. */
export const successFactorsAdapter: Adapter = {
  id: 'successfactors',
  matchesUrl,
  canonicalApplicationUrl,
  detect,
  postingText,
  authState,
  signInForm,
  neverPress,
  errors,
  isFinalStep: () => 'unknown',
  // v5 p2-detect: read so the person's own click arms the "applied" watch (module header).
  submitButton,
  entryControl,
  // Apply is never pressed by a run (neverPress): the entry door presses that element alone.
  entryNeverPressed: true,
};
