/*
 * jr6 CHAINS (INTEGRATION.md section 3, CHAINS item 3; APPLYPLAN §6 E-ADP, E-Jobvite, E-Workday, E-UltiPro and §7;
 * BUILD.md section 4): the chains where line W's adapters (the forms) and line P's runtime (Autofill presses the site's
 * Apply, follows it and fills: F2, F3a) meet for the first time, on the provisional integration. Each runs the real
 * content runtime with the registry's own adapters (adaptersFor, as a page at that address gets them) on the owner's
 * converted captures, served at their own addresses (apply.testkit.ts), every click recorded and held: nothing
 * navigates, nothing is submitted. The site's own script is stood in for where a chain draws its next view in the same
 * document; a chain that crosses to a new document loads that capture next, with the same fake worker (the same tab),
 * and the worker's grant (background/index.ts: the next form's hello gets run/start, takeFill) is stood in by the test
 * delivering that run/start.
 * - ADP Workforce Now, one document (E-ADP; ADP.md "Integration"): the details' header Apply, then the Privacy Policy
 *   pane's Consent & Continue (never Decline & Close), then the guest view drawn in place at the same address: claimed,
 *   filled from the golden profile, its Continue (which mails a code) untouched on Sign-in Manual.
 * - Jobvite, across documents (E-Jobvite; JOBVITE.md "Integration"): the posting's Apply; the /apply gate's residence
 *   choice (RULES item 16, JV-9) and its "I Accept" (never "I Decline"); step 1 after it.
 * - Workday (E-Workday B5, B6; WORKDAY.md "Integration"; F2.md 9): verily's steps at /apply claimed by the runtime
 *   (formAtPosting) under the key its /login?redirect= page says hello with; and resolvetech's choice → an in-page route
 *   to /login?redirect= (the same application, B6) → the entry's sign-in step: the saved password typed on Manual,
 *   Sign In untouched.
 * - UltiPro (C3; ULTIPRO.md "Integration"): the application drawn late is claimed by UltiPro's own adapter and filled
 *   at the person's Autofill pressed before it showed.
 * Each chain's undo proof reverts the one rule it hinges on in the code (SP\jr6\build\CHAINS.md, section 3). Measured
 * with the golden synthetic profile (fixtures/profiles/alex-rivera.*); flags, labels, counts and markup names only.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import adpConsentHtml from '../../fixtures/adp/jr6-consent.html?raw';
import adpConsentRoutes from '../../fixtures/adp/jr6-consent.routes.json';
import adpGuestHtml from '../../fixtures/adp/jr6-guest-blank.html?raw';
import adpPostingRoutes from '../../fixtures/adp/jr6-posting.routes.json';
import ninjaConsentHtml from '../../fixtures/jobvite/ninjaone-consent.html?raw';
import ninjaGateHtml from '../../fixtures/jobvite/ninjaone-consent-empty.html?raw';
import ninjaGateRoutes from '../../fixtures/jobvite/ninjaone-consent-empty.routes.json';
import ninjaPostingHtml from '../../fixtures/jobvite/ninjaone-posting.html?raw';
import ninjaPostingRoutes from '../../fixtures/jobvite/ninjaone-posting.routes.json';
import ninjaStep1Html from '../../fixtures/jobvite/ninjaone-step1.html?raw';
import ninjaStep1Routes from '../../fixtures/jobvite/ninjaone-step1.routes.json';
import golden from '../../fixtures/profiles/alex-rivera.profile.json';
import ultiproHtml from '../../fixtures/ultipro/application.html?raw';
import ultiproRoutes from '../../fixtures/ultipro/application.routes.json';
import choiceHtml from '../../fixtures/workday/jr6-apply-resolvetech-choice.html?raw';
import resolvetechHtml from '../../fixtures/workday/jr6-apply-resolvetech-posting.html?raw';
import resolvetechRoutes from '../../fixtures/workday/jr6-apply-resolvetech-posting.routes.json';
import verilyStepsHtml from '../../fixtures/workday/s2-verily-my-information.html?raw';
import verilyStepsRoutes from '../../fixtures/workday/s2-verily-my-information.routes.json';
import verilyLoginHtml from '../../fixtures/workday/verily-sign-in-verify.html?raw';
import verilyLoginRoutes from '../../fixtures/workday/verily-sign-in-verify.routes.json';
import { adaptersFor, applicationOf } from '../adapters';
import type { Adapter } from '../adapters/types';
import { SNAPSHOT_VIEWPORT } from '../adapters/test/expectations.testkit';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { deadline, startDeadline } from '../dom/time';
import type { FrameReport } from '../shared/report';
import { addressOf, applyWorker, keyOf, openAt, pressedKeys, runtimeAt, servedAdapter, wallsOf } from './apply.testkit';
import { testVocab, type FakeWorker } from './content.testkit';
import type { ContentRuntime } from './runtime';

const runtimes: ContentRuntime[] = [];
beforeAll(() => {
  testVocab();
});
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

/** The registry's adapters for an address, each platform one reading the page as served at `address` (apply.testkit
 *  served), the generic one as it is. */
const registry = (doc: Document, address: string | (() => string)) => (url: URL): Adapter[] =>
  adaptersFor(url, doc).map((adapter) => (adapter.id === 'generic' ? adapter : servedAdapter(adapter, address)));

/** Every press on `doc` as a person would name it: the control's aria-label, else its id or automation id (ADP's two
 *  consent buttons share id="undefined"), recorded beside apply.testkit's own record; a form's submission is held. */
function namedPresses(doc: Document): string[] {
  const named: string[] = [];
  doc.addEventListener('click', (event) => {
    const target = event.target as Element;
    const el = target.closest('button, sdf-button, a, [role="button"], input[type="submit" i]') ?? target;
    named.push(el.getAttribute('aria-label') ?? el.getAttribute('data-automation-id')
      ?? (el.id !== '' ? el.id : el.localName));
  }, true);
  doc.addEventListener('submit', (event) => event.preventDefault(), true);
  return named;
}

/** A hello that says the frame has a form now. */
const helloWithForm = (worker: FakeWorker, from = 0) => worker.messages.slice(from)
  .some((message) => message.type === 'frame/hello' && message.hasForm === true);

/** The refusals the frame told, in order. */
const refusals = (worker: FakeWorker) => wallsOf(worker).filter((wall) => wall.refused).map((wall) => wall.refusal);

/** The latest report of a run, at rest (report/put) or while it fills (report/live), or null. */
const lastReport = (worker: FakeWorker): FrameReport | null => [...worker.reports, ...worker.liveReports]
  .reduce<FrameReport | null>((latest, report) => (latest === null || report.updatedAt >= latest.updatedAt ? report
    : latest), null);

/** The report row of a label (its first), or undefined. */
const rowOf = (report: FrameReport | null, label: string) => report?.fields.find((row) => row.label === label);

/** ADP's modal focus trap undone where it stands (ADP's P1 test, jr6-adp.browser.test.ts): each element it hid gets
 *  its own aria-hidden back (data-old-aria-hidden, "null" for none), and the trap's markers go. */
function undoFocusTrap(doc: Document): void {
  for (const el of Array.from(doc.querySelectorAll('[data-old-aria-hidden]'))) {
    const old = el.getAttribute('data-old-aria-hidden');
    if (old === null || old === 'null') el.removeAttribute('aria-hidden');
    else el.setAttribute('aria-hidden', old);
    el.removeAttribute('data-old-aria-hidden');
  }
}

/** Sign-in mode Manual (the default) with a job-site password saved (jr6-password: typed on Manual, the press the
 *  person's); `host`, the page's own. Synthetic: the golden profile's email and a made-up password. */
const savedSignIn = (host: string) => applyWorker(DEFAULT_SETTINGS, { typeSignIn: true,
  script: { 'signin/credential': [{ ok: true, data: { host, email: golden.contact.email,
    password: 'Chains-Dummy-Signup-Pass-2026!', press: false } }] } });

describe('jr6 CHAINS: ADP Workforce Now in one document (E-ADP and F2; ADP.md "Integration")', () => {
  it('details → the header Apply → Consent & Continue (never Decline) → the guest view drawn in place → claimed and filled; Continue untouched on Manual',
    async () => {
      // jr6-posting and jr6-consent are one page at one address, before and after Apply (adp2).
      const ADDRESS = addressOf(adpConsentRoutes, 'fixtures/adp/jr6-consent.html');
      expect(addressOf(adpPostingRoutes, 'fixtures/adp/jr6-posting.html')).toBe(ADDRESS);
      expect(applicationOf(new URL(ADDRESS))?.page).toBe('application');
      // The guest view (adp1's capture), loaded beside the page to be drawn in place.
      const guest = await loadFixture(document, adpGuestHtml, SNAPSHOT_VIEWPORT);
      const { doc, clicks } = await openAt(adpConsentHtml, ADDRESS);
      const presses = namedPresses(doc);
      // The details as loaded, before Apply: the Privacy Policy pane taken out and its focus trap undone.
      const pane = doc.querySelector('sdf-focus-pane#jdv_privacy_dailog')!;
      const at = { parent: pane.parentNode!, next: pane.nextSibling };
      const trapped = Array.from(doc.querySelectorAll('[data-old-aria-hidden]'))
        .map((el) => [el, el.getAttribute('aria-hidden'), el.getAttribute('data-old-aria-hidden')] as const);
      pane.remove();
      undoFocusTrap(doc);
      // ADP's script stood in for: Apply draws the pane 300 ms later, its focus trap with it; Consent & Continue draws
      // the guest view in place 1 s later (ADP's app root, #recruitment_root, drawn again; the address unchanged).
      let guestDrawn = false;
      doc.addEventListener('click', (event) => {
        const target = event.target as Element;
        if (target.closest('#recruitment_jobDescription_apply') !== null) {
          startDeadline(300, () => {
            at.parent.insertBefore(pane, at.next);
            for (const [el, hidden, old] of trapped) {
              if (hidden !== null) el.setAttribute('aria-hidden', hidden);
              if (old !== null) el.setAttribute('data-old-aria-hidden', old);
            }
          });
        }
        if (target.closest('sdf-button[aria-label="Consent & Continue"]') !== null) {
          startDeadline(1_000, () => {
            undoFocusTrap(doc);
            for (const style of Array.from(guest.doc.querySelectorAll('head style'))) doc.head.append(doc.adoptNode(style));
            doc.getElementById('recruitment_root')!.replaceWith(doc.adoptNode(guest.doc.getElementById('recruitment_root')!));
            guestDrawn = true;
          });
        }
      }, true);
      const { worker, runtime } = await runtimeAt(doc, ADDRESS, registry(doc, ADDRESS));
      runtimes.push(runtime);
      expect(runtime.page).toBeNull();
      // The details offer their Apply on the application's address (E-ADP's posting.entry, F2's gate).
      await vi.waitFor(() => expect(wallsOf(worker).at(-1)?.entry).toBe(true), { timeout: 8_000 });
      // The person's Autofill (Sign-in Manual, the default).
      await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
      await vi.waitFor(() => expect(presses).toEqual(['recruitment_jobDescription_apply', 'Consent & Continue']),
        { timeout: 12_000 });
      // The guest view drawn in place is ADP's own form: claimed by ADP's adapter, the worker told.
      await vi.waitFor(() => expect(guestDrawn).toBe(true), { timeout: 5_000 });
      await vi.waitFor(() => expect(runtime.page?.adapter.id).toBe('adp'), { timeout: 10_000 });
      expect(runtime.page?.root.matches('div.guest-login-container')).toBe(true);
      await vi.waitFor(() => expect(helloWithForm(worker)).toBe(true), { timeout: 5_000 });
      // The worker's grant (armed by the entry's presses) starts the run on the form's hello: run/start, as takeFill.
      expect(worker.of('entry/pressed')).toHaveLength(2);
      expect(pressedKeys(worker)).toEqual([undefined, undefined]);
      await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
      // Filled from the golden profile.
      await vi.waitFor(() => {
        const report = lastReport(worker);
        for (const label of ['First Name', 'Last Name', 'Email']) {
          expect(rowOf(report, label), label).toMatchObject({ wrote: true, status: 'verified' });
        }
      }, { timeout: 30_000 });
      const value = (id: string) => (doc.getElementById(id) as HTMLInputElement).value;
      expect(value('guestFirstName')).toBe(golden.name.first);
      expect(value('guestLastName')).toBe(golden.name.last);
      expect(value('guestEmail')).toBe(golden.contact.email);
      await deadline(1_500);
      // Never Decline & Close; the guest's Continue (it mails a code) is the person's on Sign-in Manual.
      expect(presses).toEqual(['recruitment_jobDescription_apply', 'Consent & Continue']);
      expect(clicks).not.toContain('recruitment_login_recaptcha');
      expect(refusals(worker)).toEqual([]);
    }, 90_000);
});

/** Jobvite's /apply gate (ninjaone-consent-empty) at `address`, its AngularJS stood in for: choosing a residence shows
 *  the policy's details, holding "I Accept" and "I Decline" (div[ng-if="showAcceptReject"]), as ninjaone-consent shows
 *  them, and hides the gate's Cancel. `pressed` counts the presses of "I Accept"; `onAccept` runs at each (its form
 *  posts). */
async function jobviteGate(address: string, onAccept: () => void = () => undefined) {
  const consent = new DOMParser().parseFromString(ninjaConsentHtml, 'text/html');
  const gate = await openAt(ninjaGateHtml, address);
  const presses = namedPresses(gate.doc);
  const select = gate.doc.querySelector<HTMLSelectElement>('select#jv-country-select')!;
  select.addEventListener('change', () => {
    if (select.value === '') return;
    const form = gate.doc.querySelector('form[name="consentForm"]')!;
    for (const back of Array.from(form.querySelectorAll('div[ng-show="showBackButton"]'))) back.classList.add('ng-hide');
    form.querySelector('div[ng-show="showConsentPolicyDetails"]')!.replaceWith(gate.doc.importNode(
      consent.querySelector('form[name="consentForm"] div[ng-show="showConsentPolicyDetails"]')!, true));
  });
  const accepted: number[] = [];
  gate.doc.addEventListener('click', (event) => {
    if ((event.target as Element).closest('form[name="consentForm"] button[type="submit"]') === null) return;
    accepted.push(performance.now());
    onAccept();
  }, true);
  return { ...gate, presses, select, accepted };
}

describe('jr6 CHAINS: Jobvite across documents (E-Jobvite, RULES item 16 and F2; JOBVITE.md "Integration")', () => {
  it('posting → its Apply → the /apply gate: the residence chosen, "I Accept" pressed (never "I Decline") → step 1 filled',
    async () => {
      const POSTING = addressOf(ninjaPostingRoutes, 'fixtures/jobvite/ninjaone-posting.html');
      const APPLY = addressOf(ninjaGateRoutes, 'fixtures/jobvite/ninjaone-consent-empty.html');
      expect(addressOf(ninjaStep1Routes, 'fixtures/jobvite/ninjaone-step1.html')).toBe(APPLY);
      // One application: the posting's Apply leads to its own /apply (no other key to name).
      expect(keyOf(APPLY)).toBe(keyOf(POSTING));
      // One tab: the same fake worker hears every document of the chain.
      const worker = applyWorker();

      // 1. The posting: Autofill presses its first Apply, never "Apply Later".
      const posting = await openAt(ninjaPostingHtml, POSTING);
      const postingPresses = namedPresses(posting.doc);
      const first = await runtimeAt(posting.doc, POSTING, registry(posting.doc, POSTING), { worker });
      runtimes.push(first.runtime);
      await vi.waitFor(() => expect(wallsOf(worker).at(-1)?.entry).toBe(true), { timeout: 8_000 });
      await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
      await vi.waitFor(() => expect(posting.clicks).toHaveLength(1), { timeout: 8_000 });
      await deadline(500);
      expect(posting.clicks).toEqual(['a.jv-button.jv-button-primary.jv-button-apply']);
      expect(postingPresses).toHaveLength(1);
      expect(worker.of('entry/pressed')).toHaveLength(1);
      expect(pressedKeys(worker)).toEqual([undefined]);
      // The link leads to the gate: this document leaves.
      first.runtime.stop();
      runtimes.splice(0);
      removeFixtures(document);

      // 2. The /apply gate: a form (its residence select), started by the grant; the residence chosen from the profile;
      // "I Accept" pressed by the run's entry choice. Its form posts: the document leaves at the press.
      const gateFrom = worker.messages.length;
      let leave: () => void = () => undefined;
      const gate = await jobviteGate(APPLY, () => leave());
      const second = await runtimeAt(gate.doc, APPLY, registry(gate.doc, APPLY), { worker });
      runtimes.push(second.runtime);
      leave = () => second.runtime.stop();
      await vi.waitFor(() => expect(helloWithForm(worker, gateFrom)).toBe(true), { timeout: 8_000 });
      expect(second.runtime.page?.adapter.id).toBe('jobvite');
      // The grant's run/start on the gate's form (takeFill).
      await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
      await vi.waitFor(() => expect(gate.accepted.length).toBeGreaterThan(0), { timeout: 30_000 });
      // The residence: the select's one real option, the Global English policy (RULES item 16, JV-9).
      expect(gate.select.selectedIndex).toBe(1);
      await deadline(500);
      expect(gate.accepted).toHaveLength(1);
      expect(gate.presses).toHaveLength(1);
      expect(gate.presses.filter((name) => /decline|cancel/i.test(name))).toEqual([]);
      runtimes.splice(0);
      removeFixtures(document);

      // 3. Step 1, the next document of the same application in the same tab: the run stored at the gate's choice
      // carries on there by itself (resumeStored; the pause gone), and fills it.
      const stepFrom = worker.messages.length;
      const step1 = await openAt(ninjaStep1Html, APPLY);
      const third = await runtimeAt(step1.doc, APPLY, registry(step1.doc, APPLY), { worker });
      runtimes.push(third.runtime);
      await vi.waitFor(() => expect(helloWithForm(worker, stepFrom)).toBe(true), { timeout: 8_000 });
      expect(third.runtime.page?.adapter.id).toBe('jobvite');
      await vi.waitFor(() => expect(lastReport(worker)?.fields.find((row) => row.label === 'Email'))
        .toMatchObject({ wrote: true }), { timeout: 40_000 });
      expect(step1.clicks.filter((name) => /send|submit/i.test(name))).toEqual([]);
      expect(refusals(worker)).toEqual([]);
    }, 150_000);

  // A regression this chain found (CHAINS.md section 4): the run's entry choice presses again as soon as it carries on,
  // so while the gate's form posts (the page still shown) "I Accept" is pressed about every 20-50 ms, 21 times in all
  // (runtime.ts MAX_AUTO_CONTINUES = 20). The rule asserted: one press per gate document. Flip to it() once fixed.
  it.fails('the gate’s "I Accept" is pressed once while its form posts (the page still shown): never again in that document',
    async () => {
      const APPLY = addressOf(ninjaGateRoutes, 'fixtures/jobvite/ninjaone-consent-empty.html');
      const gate = await jobviteGate(APPLY);
      const { worker, runtime } = await runtimeAt(gate.doc, APPLY, registry(gate.doc, APPLY));
      runtimes.push(runtime);
      await vi.waitFor(() => expect(helloWithForm(worker)).toBe(true), { timeout: 8_000 });
      await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
      await vi.waitFor(() => expect(gate.accepted.length).toBeGreaterThan(0), { timeout: 30_000 });
      // A form's POST and the next page take a moment: 2 s here.
      await deadline(2_000);
      expect(gate.accepted).toHaveLength(1);
    }, 60_000);
});

describe('jr6 CHAINS: Workday (E-Workday B5, B6 and F2; WORKDAY.md "Integration", F2.md 9)', () => {
  it('verily: its /login?redirect= page says hello and tells the sign-in wall; its steps at /apply are claimed (formAtPosting) under the same key, and filled',
    async () => {
      const LOGIN = addressOf(verilyLoginRoutes, 'fixtures/workday/verily-sign-in-verify.html');
      const STEPS = addressOf(verilyStepsRoutes, 'fixtures/workday/s2-verily-my-information.html');
      expect(applicationOf(new URL(LOGIN))?.page).toBe('application');
      expect(applicationOf(new URL(STEPS))?.page).toBe('posting');
      expect(keyOf(LOGIN)).toBe(keyOf(STEPS));
      const worker = applyWorker();
      // The sign-in page at /login?redirect= (B6): read as the application, its wall told.
      const login = await openAt(verilyLoginHtml, LOGIN);
      const first = await runtimeAt(login.doc, LOGIN, registry(login.doc, LOGIN), { worker });
      runtimes.push(first.runtime);
      await vi.waitFor(() => expect(worker.of('frame/hello').length).toBeGreaterThan(0), { timeout: 8_000 });
      await vi.waitFor(() => expect(wallsOf(worker).at(-1)?.wall).toBe('sign-in'), { timeout: 8_000 });
      expect(login.clicks).toEqual([]);
      // The site takes the person's sign-in and opens the application's steps at /apply (a new document).
      first.runtime.stop();
      runtimes.splice(0);
      removeFixtures(document);
      const from = worker.messages.length;
      const steps = await openAt(verilyStepsHtml, STEPS);
      const second = await runtimeAt(steps.doc, STEPS, registry(steps.doc, STEPS), { worker });
      runtimes.push(second.runtime);
      // Claimed at an address read as the posting (formAtPosting, B5); the worker files both documents under one key
      // (its frames' addresses read as above), so the grant given at the wall takes this form (takeFill's key rule).
      await vi.waitFor(() => expect(helloWithForm(worker, from)).toBe(true), { timeout: 8_000 });
      expect(second.runtime.page?.adapter.id).toBe('workday');
      // The grant's run/start (takeFill, the same key): My Information filled from the golden profile.
      await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
      await vi.waitFor(() => expect(lastReport(worker)?.fields.filter((row) => row.wrote).length ?? 0).toBeGreaterThan(0),
        { timeout: 40_000 });
      expect(steps.clicks.filter((name) => /submit|signIn|createAccount/i.test(name))).toEqual([]);
    }, 90_000);

  it('resolvetech: Apply → the choice’s Apply Manually → an in-page route to /login?redirect= (the same application) → the sign-in step types the saved password on Manual, Sign In untouched',
    async () => {
      const RESOLVETECH = addressOf(resolvetechRoutes, 'fixtures/workday/jr6-apply-resolvetech-posting.html');
      const url = new URL(RESOLVETECH);
      // The tenant's sign-in page for this job's application (B6: same host, same site, a same-origin path).
      const LOGIN = `${url.origin}/RTS/login?redirect=${encodeURIComponent(`${url.pathname}/apply/applyManually`)}`;
      expect(applicationOf(new URL(LOGIN))?.page).toBe('application');
      expect(keyOf(LOGIN)).toBe(keyOf(RESOLVETECH));
      let here = RESOLVETECH;
      const { fixture, doc, clicks } = await openAt(resolvetechHtml, RESOLVETECH);
      const dialog = new DOMParser().parseFromString(choiceHtml, 'text/html')
        .querySelector('[role="dialog"][data-automation-id="wd-popup-frame"]')!;
      const login = new DOMParser().parseFromString(verilyLoginHtml, 'text/html');
      // A fresh sign-in page shows no error of an earlier try.
      for (const error of Array.from(login.querySelectorAll('[data-automation-id="errorMessage"]'))) error.remove();
      // Workday's script stood in for: Apply draws the choice; Apply Manually routes in the page to the tenant's
      // sign-in, which it draws there with its styles (the one app's).
      doc.addEventListener('click', (event) => {
        const pressed = (event.target as Element).closest('[data-automation-id]')?.getAttribute('data-automation-id');
        if (pressed === 'adventureButton') startDeadline(300, () => doc.body.append(doc.importNode(dialog, true)));
        if (pressed === 'applyManually') {
          startDeadline(300, () => {
            here = LOGIN;
            for (const style of Array.from(login.querySelectorAll('head style'))) doc.head.append(doc.importNode(style, true));
            doc.body.replaceWith(doc.importNode(login.body, true));
            fixture.view.dispatchEvent(new PopStateEvent('popstate'));
          });
        }
      }, true);
      const worker = savedSignIn(url.hostname);
      const { runtime } = await runtimeAt(doc, RESOLVETECH, registry(doc, () => here), { worker,
        more: { href: () => here } });
      runtimes.push(runtime);
      await vi.waitFor(() => expect(wallsOf(worker).at(-1)?.entry).toBe(true), { timeout: 10_000 });
      await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
      await vi.waitFor(() => expect(clicks).toEqual(['adventureButton', 'applyManually']), { timeout: 15_000 });
      // The route kept the entry (the same application), and its sign-in step typed the saved sign-in.
      await vi.waitFor(() => expect(worker.of('signin/credential')).toHaveLength(1), { timeout: 15_000 });
      const box = (id: string) => doc.querySelector<HTMLInputElement>(`input[data-automation-id="${id}"]`)!;
      await vi.waitFor(() => expect(box('password').value).not.toBe(''), { timeout: 10_000 });
      expect(box('email').value).toBe(golden.contact.email);
      await vi.waitFor(() => expect(worker.of('frame/wall').some((message) => message.waits === 'sign-in-typed'))
        .toBe(true), { timeout: 5_000 });
      await deadline(1_000);
      // Sign In (and Create Account, and the social sign-ins) the person's.
      expect(clicks).toEqual(['adventureButton', 'applyManually']);
      expect(refusals(worker)).toEqual([]);
    }, 60_000);
});

describe('jr6 CHAINS: UltiPro’s application drawn late (C3 and F2; ULTIPRO.md "Integration")', () => {
  it('the person’s Autofill before the form shows: #OpportunityApply drawn 10 s later is claimed by UltiPro’s adapter and filled',
    async () => {
      const ADDRESS = addressOf(ultiproRoutes, 'fixtures/ultipro/application.html');
      expect(applicationOf(new URL(ADDRESS))?.page).toBe('application');
      const { doc } = await openAt(ultiproHtml, ADDRESS);
      const form = doc.querySelector('#OpportunityApply')!;
      const parent = form.parentNode!;
      const next = form.nextSibling;
      form.remove();
      const { worker, runtime } = await runtimeAt(doc, ADDRESS, registry(doc, ADDRESS));
      runtimes.push(runtime);
      await deadline(500);
      expect(runtime.page).toBeNull();
      await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
      // Past the Apply wait (8 s: UltiPro offers no Apply on its application's page), the entry still waits.
      await deadline(9_500);
      expect(refusals(worker)).toEqual([]);
      expect(worker.of('run/begin')).toEqual([]);
      expect(runtime.page).toBeNull();
      parent.insertBefore(form, next);
      await vi.waitFor(() => expect(worker.of('run/begin').length).toBeGreaterThan(0), { timeout: 5_000 });
      expect(runtime.page?.adapter.id).toBe('ultipro');
      await vi.waitFor(() => expect(lastReport(worker)?.fields.filter((row) => row.wrote).length ?? 0).toBeGreaterThan(0),
        { timeout: 40_000 });
      expect(refusals(worker)).toEqual([]);
    }, 90_000);
});
