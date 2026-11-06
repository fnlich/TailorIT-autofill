/*
 * The iCIMS adapter (docs/design/runtime.md §9; docs/ARCHITECTURE.md "Adapters", "iCIMS"): the quirks of an iCIMS
 * portal's public pages, its posting and its email gate. Every hook was read from the public capture of 2026-11-04/05
 * (docs/FIXTURES.md, "The Workday, iCIMS, Taleo, SuccessFactors and Oracle capture"; three portals: East West Bank,
 * EMCOR and GDMS, East West Bank's and GDMS's converted as fixtures/icims/*.html: EMCOR's gate holds shadow roots the
 * converter cannot keep) and names the markup it relies on. What follows the gate (the
 * candidate's profile, its "Create a login", its questions) is not public: those pages wait for the owner's snapshots,
 * and until a snapshot names their address's word they are read as no application at all (url.ts reads only the
 * posting, /job, and the gate, /login: the v3 Phase 6/7b review, C11), so nothing is filled there yet. The pages are
 * server-rendered, each in a document of its own.
 * - Frames: the top page is the company's wrapper (no form root, never one); the posting and the gate are drawn in its
 *   iframe#icims_content_iframe on the same host (?in_iframe=1), where the content script runs too (all_frames).
 * - The posting (postingText): .iCIMS_JobContent, its title, facts and sections (h2.iCIMS_InfoField_Job and
 *   .iCIMS_InfoMsg_Job) with its options' few words.
 * - Entry (entryControl): the visible a.iCIMS_ApplyOnlineButton ("Apply for this job online", two copies, one per
 *   layout), whose address is this posting's own with mode=apply. It moves the top page to the gate. The agent's entry
 *   runs in a tab's top frame alone, and this one is in the posting's frame: it is declared for when the frame's own
 *   address is open in the tab; it is never pressed by a run (entryNeverPressed).
 * - authState: the gate (form#enterEmailForm, "Enter Your Information": an email box and Next, an invisible hCaptcha
 *   bound to Next, and on some portals a required GDPR box, #accept_gdpr) is an 'email-gate': the person's, or Sign-in
 *   Auto's where it may act (signInForm: the email, the GDPR box when the page requires it, and Next by its own id,
 *   input#enterEmailSubmitButton, which GDMS's page enables once the box is ticked; a top frame only, so never inside
 *   the wrapper's frame). A challenge shown and not solved comes before the gate (dom/pause-detect.ts): one Next raises
 *   is the person's, Sign-in Auto's watch handing it over ('continue', the run then pausing at it).
 * - Never pressed (neverPress): the share buttons and widgets, "Email this job to a friend", "Log back in" (it sends to
 *   iCIMS's own sign-in, login.icims.com, which names no job), the FAQ and "Powered by" links, and Apply itself (the
 *   entry door's alone).
 * Nothing here reads, logs or sends a value.
 */
import { newScanCache, type ScanCache } from '../../dom/scan-cache';
import { isUserVisible } from '../../dom/visibility';
import { genericAdapter } from '../generic';
import type { Adapter, SignInForm, SignInWall } from '../types';
import { canonicalApplicationUrl, matchesUrl, parseIcimsUrl } from './url';

/** The snapshots the hooks were written from (fixtures/icims/). */
export const ICIMS_SNAPSHOTS = ['fixtures/icims/eastwestbank-posting.html',
  'fixtures/icims/eastwestbank-email-gate.html', 'fixtures/icims/gdms-email-gate.html'] as const;

/** The first of `elements` a person can see. */
function shown<T extends Element>(elements: readonly T[], cache: ScanCache = newScanCache()): T | null {
  return elements.find((el) => isUserVisible(el, cache)) ?? null;
}

/** The email gate, while it shows: fixtures/icims/eastwestbank-email-gate.frame-1.html's <form id="enterEmailForm"
 *  class="iCIMS_SignIn" method="post" action=".../login?step=email&in_iframe=1&hashed=..."> holding <input id="email"
 *  name="css_loginName" type="email" autocomplete="email"> and <input id="enterEmailSubmitButton" type="submit"
 *  value="Next">. */
function gateOf(doc: Document): HTMLFormElement | null {
  return shown(Array.from(doc.querySelectorAll<HTMLFormElement>('form#enterEmailForm')));
}

/** The gate is the form root of its page; every other form waits for the snapshots (the generic adapter's). */
function detect(doc: Document): { formRoot: Element } | null {
  const gate = gateOf(doc);
  return gate === null ? null : { formRoot: gate };
}

/** The posting's own text: fixtures/icims/eastwestbank-posting.frame-1.html's <div class="iCIMS_JobContent">, holding
 *  its title, its facts and its sections (each <h2 class="iCIMS_InfoMsg iCIMS_InfoField_Job"> and <div
 *  class="iCIMS_InfoMsg iCIMS_InfoMsg_Job">), with its options' few words (Apply, Share, Email this job). */
function postingText(doc: Document): Element | null {
  return shown(Array.from(doc.querySelectorAll('.iCIMS_JobContent'))
    .filter((content) => content.querySelector('.iCIMS_InfoMsg_Job') !== null));
}

/** The posting the document's own address shows, or null (a fixture's srcdoc page compares nothing). */
function hereOf(doc: Document) {
  try {
    return parseIcimsUrl(new URL(doc.location.href));
  } catch {
    return null;
  }
}

/** Apply: <a href=".../jobs/13634/credit-reviewer-ii/job?mode=apply&apply=yes&in_iframe=1&hashed=..." class="iCIMS_Anchor
 *  iCIMS_Action_Button iCIMS_ApplyOnlineButton iCIMS_PrimaryButton" title="Apply for this job online">. */
function entryControl(doc: Document): HTMLElement | null {
  const here = hereOf(doc);
  const links = Array.from(doc.querySelectorAll<HTMLElement>('a.iCIMS_ApplyOnlineButton[href]')).filter((link) => {
    try {
      const target = new URL(link.getAttribute('href') ?? '', doc.baseURI);
      const read = parseIcimsUrl(target);
      return read !== null && read.page === 'posting' && target.searchParams.get('mode') === 'apply'
        && (here === null || read.applicationUrl === here.applicationUrl);
    } catch {
      return false;
    }
  });
  return shown(links);
}

function authState(doc: Document): ReturnType<NonNullable<Adapter['authState']>> {
  return gateOf(doc) === null ? null : 'email-gate';
}

/** Sign-in Auto's form at the gate (module header): its email, its required GDPR box (fixtures/icims/gdms-email-gate's
 *  <input type="checkbox" id="accept_gdpr" aria-required="true">), its Next. */
function signInForm(doc: Document, wall: SignInWall): SignInForm | null {
  const gate = gateOf(doc);
  if (gate === null || wall !== 'email-gate') return null;
  const email = gate.querySelector<HTMLInputElement>('input#email[name="css_loginName"]');
  const button = gate.querySelector<HTMLElement>('input#enterEmailSubmitButton[type="submit"]');
  if (email === null || button === null) return null;
  const terms = Array.from(gate.querySelectorAll<HTMLInputElement>('input[type="checkbox"]#accept_gdpr'))
    .filter((box) => !box.checked);
  // GDMS's Next (class gdprAnswerSubmitButton, disabled) is enabled by the page once its GDPR box is ticked.
  const enables = button.classList.contains('gdprAnswerSubmitButton');
  return { email, password: null, confirm: null, terms, button, form: gate,
    ...(enables ? { enablesWhenFilled: true as const } : {}) };
}

function neverPress(root: Element): Element[] {
  const doc = root.ownerDocument;
  // The posting's .iCIMS_JobOptions: the share button (a.iCIMS_JobShareButton), "Email this job to a friend"
  // (a[href*="/referral"]), the share widgets (.icimsSD_widget); "Log back in!" (a[href*="loginOnly=1"]); the footer's
  // a.iCIMS_Faq_Link and the "Powered by" link; and Apply (a.iCIMS_ApplyOnlineButton).
  const selectors = ['a.iCIMS_ApplyOnlineButton', 'a.iCIMS_JobShareButton', 'a[href*="/referral"]', '.icimsSD_widget',
    'a[href*="loginOnly=1"]', 'a.iCIMS_Faq_Link', 'a[href*="icims.com/platform_help"]'];
  return Array.from(doc.querySelectorAll(selectors.join(', ')));
}

/** The gate's error (<div id="iCIMS_ErrorMessage_login" class="iCIMS_ErrorMessage NoDisplay">), once shown, and the
 *  controls the page marks invalid. */
function errors(root: Element): Array<{ el: Element; fieldKeyHint?: string }> {
  const cache = newScanCache();
  const shownErrors = Array.from(root.ownerDocument.querySelectorAll('.iCIMS_ErrorMessage'))
    .filter((el) => isUserVisible(el, cache) && (el.textContent ?? '').trim() !== '').map((el) => ({ el }));
  return [...(genericAdapter.errors?.(root) ?? []), ...shownErrors];
}

/** The iCIMS adapter. */
export const icimsAdapter: Adapter = {
  id: 'icims',
  matchesUrl,
  canonicalApplicationUrl,
  detect,
  postingText,
  authState,
  signInForm,
  neverPress,
  errors,
  isFinalStep: () => 'unknown',
  entryControl,
  // Apply is never pressed by a run (neverPress): the entry door presses that element alone.
  entryNeverPressed: true,
};
