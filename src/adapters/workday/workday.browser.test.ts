/*
 * The Workday adapter on the public capture of 2026-11-04/05 (docs/FIXTURES.md, "The Workday, iCIMS, Taleo,
 * SuccessFactors and Oracle capture"): its hooks on each snapshot, held against the case's hand-written expectations
 * (the scan of its form root, and what each hook answers), the agent's entry from the posting through the choice drawn
 * in place, and Sign-in Auto's reading of Workday's real sign-in and create-account forms: the declared form passes
 * the refusal rules the standard rule's reading cannot reach (its button is an aria-hidden submit button under a visible
 * div[role=button]; its form has no method and no action), and is refused on http, on a host the every-site sign-in does
 * not cover, with a written GET, an action on another origin, a hidden field or a honeypot.
 */
import { afterEach, describe, expect, it } from 'vitest';
import choiceExpect from '../../../fixtures/workday/workday-apply-choice.expect.json';
import choiceHtml from '../../../fixtures/workday/workday-apply-choice.html?raw';
import createExpect from '../../../fixtures/workday/workday-create-account.expect.json';
import createHtml from '../../../fixtures/workday/workday-create-account.html?raw';
import forgotExpect from '../../../fixtures/workday/workday-forgot-password.expect.json';
import forgotHtml from '../../../fixtures/workday/workday-forgot-password.html?raw';
import landingExpect from '../../../fixtures/workday/workday-landing.expect.json';
import landingHtml from '../../../fixtures/workday/workday-landing.html?raw';
import postingExpect from '../../../fixtures/workday/workday-posting.expect.json';
import postingHtml from '../../../fixtures/workday/workday-posting.html?raw';
import salesforceExpect from '../../../fixtures/workday/salesforce-create-account.expect.json';
import salesforceHtml from '../../../fixtures/workday/salesforce-create-account.html?raw';
import signInExpect from '../../../fixtures/workday/workday-sign-in.expect.json';
import signInHtml from '../../../fixtures/workday/workday-sign-in.html?raw';
import snapExpect from '../../../fixtures/workday/snap-sign-in.expect.json';
import snapHtml from '../../../fixtures/workday/snap-sign-in.html?raw';
import { pressEntry } from '../../content/press';
import { loadFixture, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { signInFormOf, standardSignInForm, signInRefusal } from '../../dom/sign-in-form';
import { compareWithExpectation, readExpectation, scanCase, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { compareHooks, readHooks } from '../test/hooks.testkit';
import { WORKDAY_SNAPSHOTS, workdayAdapter } from './index';

const POSTING = 'https://workday.wd5.myworkdayjobs.com/en-US/Workday/job/USA-CA-Pleasanton/Senior-Product-Manager--Technical_JR-0110787';
const ACCOUNT = 'https://workday.wd5.myworkdayjobs.com/en-US/Workday/job/USA%2C-CA%2C-Pleasanton/Senior-Product-Manager--Technical_JR-0110787/apply/applyManually';
const SNAP = 'https://wd1.myworkdaysite.com/en-US/recruiting/snapchat/snap/job/Los-Angeles%2C-California/Ad-Product-Quality-Analyst-I_R0047453-1/apply/applyManually';
const SALESFORCE = 'https://salesforce.wd12.myworkdayjobs.com/en-US/External_Career_Site/job/California---San-Francisco/Senior-Executive-Assistant_JR337145/apply/applyManually';

const CASES = [
  { name: 'workday-posting', html: postingHtml, json: postingExpect, address: POSTING },
  { name: 'workday-apply-choice', html: choiceHtml, json: choiceExpect, address: POSTING },
  { name: 'workday-landing', html: landingHtml, json: landingExpect, address: ACCOUNT },
  { name: 'workday-sign-in', html: signInHtml, json: signInExpect, address: ACCOUNT },
  { name: 'workday-create-account', html: createHtml, json: createExpect, address: ACCOUNT },
  { name: 'workday-forgot-password', html: forgotHtml, json: forgotExpect, address: ACCOUNT },
  { name: 'salesforce-create-account', html: salesforceHtml, json: salesforceExpect, address: SALESFORCE },
  { name: 'snap-sign-in', html: snapHtml, json: snapExpect, address: SNAP },
] as const;

/** A page's own base address (a srcdoc page's is about:srcdoc), after it loaded: a form's action resolves against it. */
function setBase(doc: Document, address: string): void {
  const base = doc.createElement('base');
  base.href = address;
  doc.head.prepend(base);
}

async function load(html: string, address = ACCOUNT): Promise<Fixture> {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  setBase(fixture.doc, address);
  return fixture;
}

afterEach(() => removeFixtures(document));

describe('the Workday adapter: its hooks on the snapshots', () => {
  it('names each snapshot it was written from', () => {
    expect(CASES.map((each) => `fixtures/workday/${each.name}.html`).sort()).toEqual([...WORKDAY_SNAPSHOTS].sort());
  });

  it.each(CASES)('$name: every hook answers what the page shows', async ({ html, json }) => {
    const fixture = await load(html);
    expect(compareHooks(fixture.doc, workdayAdapter, readHooks(json))).toEqual([]);
  });

  it.each(CASES.filter((each) => readHooks(each.json).detect !== null))('$name: the scan of its root is the expectation',
    async ({ html, json, address }) => {
      const scanned = await scanCase(document, html, address);
      expect(scanned.adapter).toBe(workdayAdapter);
      expect(compareWithExpectation(scanned.doc, scanned.result, readExpectation(json))).toEqual([]);
    });

  it('waits up to 30 s for its pages, and allows the agent two presses in one document', () => {
    expect(workdayAdapter.quirks).toMatchObject({ formLateMs: 30_000, entryPresses: 2 });
    expect(workdayAdapter.entryNeverPressed).toBe(true);
  });

  it("is why Sign-in Auto needs a declared form: the standard rule reads none (the submit button is aria-hidden)", async () => {
    for (const html of [signInHtml, createHtml]) {
      const fixture = await load(html);
      expect(standardSignInForm(fixture.doc, html === signInHtml ? 'sign-in' : 'create-account')).toBeNull();
    }
  });
});

describe("the agent's entry: Apply, then Apply Manually in the choice Workday draws in place (v3 Phase 6)", () => {
  /** The posting, with the choice drawn in place by its Apply as Workday's React does (the choice's own markup, from
   *  workday-apply-choice.html), and every click on its links held: nothing navigates. */
  async function postingWithChoice() {
    const source = await loadFixture(document, choiceHtml, SNAPSHOT_VIEWPORT);
    const dialog = source.doc.querySelector('[role="dialog"][data-automation-id="wd-popup-frame"]')!;
    expect(dialog).not.toBeNull();
    const fixture = await load(postingHtml, POSTING);
    const pressed: string[] = [];
    fixture.doc.addEventListener('click', (event) => {
      const link = (event.target as Element).closest('a');
      if (link === null) return;
      event.preventDefault();
      pressed.push(link.getAttribute('data-automation-id') ?? link.localName);
      // Workday's script draws the choice in place on Apply: its own markup, taken from the capture of that moment.
      if (link.getAttribute('data-automation-id') === 'adventureButton') fixture.doc.body.append(fixture.doc.importNode(dialog, true));
    });
    return { fixture, pressed };
  }

  it('presses Apply, then the choice’s Apply Manually, in one agent/enter, and nothing else', async () => {
    const { fixture, pressed } = await postingWithChoice();
    const answer = await pressEntry(fixture.doc, [workdayAdapter], new AbortController().signal, 2_000, 2_000);
    expect(answer).toEqual({ outcome: 'pressed' });
    expect(pressed).toEqual(['adventureButton', 'applyManually']);
  });

  it('presses Apply Manually where the choice already shows, though the adapter names it an entry choice', async () => {
    const fixture = await load(choiceHtml, POSTING);
    const pressed: string[] = [];
    fixture.doc.addEventListener('click', (event) => {
      const link = (event.target as Element).closest('a');
      if (link === null) return;
      event.preventDefault();
      pressed.push(link.getAttribute('data-automation-id') ?? '');
    });
    expect(workdayAdapter.authState!(fixture.doc)).toBe('entry-choice');
    expect(await pressEntry(fixture.doc, [workdayAdapter], new AbortController().signal, 500, 500)).toEqual({ outcome: 'pressed' });
    expect(pressed).toEqual(['applyManually']);
  });

  it('presses one control only where the adapter allows one press a document', async () => {
    const { fixture, pressed } = await postingWithChoice();
    const once = { ...workdayAdapter, quirks: { ...workdayAdapter.quirks, entryPresses: 1 } };
    expect(await pressEntry(fixture.doc, [once], new AbortController().signal, 500, 500)).toEqual({ outcome: 'pressed' });
    expect(pressed).toEqual(['adventureButton']);
  });

  it('never offers the choice’s other ways, and blocks on the choice when it offers nothing there', async () => {
    const fixture = await load(choiceHtml, POSTING);
    const entry = workdayAdapter.entryControl!(fixture.doc);
    expect(entry?.getAttribute('data-automation-id')).toBe('applyManually');
    for (const id of ['autofillWithResume', 'useMyLastApplication', 'closeButton']) {
      expect(workdayAdapter.neverPress!(fixture.doc.documentElement)).toContain(fixture.doc.querySelector(`[data-automation-id="${id}"]`));
    }
    const offersNothing = { ...workdayAdapter, entryControl: () => null };
    expect(await pressEntry(fixture.doc, [offersNothing], new AbortController().signal, 300, 300))
      .toEqual({ outcome: 'blocked', block: 'other' });
  });
});

describe('Sign-in Auto on Workday’s own forms (v3 Phase 6): the refusal rules', () => {
  /** The page as Workday serves it: the converter wrote action and method on every form, Workday's has neither. */
  function asServed(doc: Document): HTMLFormElement {
    const form = doc.querySelector<HTMLFormElement>('form[data-automation-id="signInFormo"]')!;
    form.removeAttribute('action');
    form.removeAttribute('method');
    return form;
  }

  it('takes the declared sign-in and create-account forms: no method, no action, a div[role=button], unrequired terms', async () => {
    for (const [html, wall] of [[signInHtml, 'sign-in'], [createHtml, 'create-account'], [salesforceHtml, 'create-account']] as const) {
      const fixture = await load(html);
      asServed(fixture.doc);
      const form = signInFormOf(workdayAdapter, fixture.doc, wall)!;
      expect(form.declared).toBe(true);
      expect(form.scriptSubmits).toBe(true);
      expect(form.button.getAttribute('role')).toBe('button');
      expect(signInRefusal(form, new URL(ACCOUNT)), wall).toBeNull();
      // The same form undeclared (the standard rule's reading of it) has none of a declared form's exemptions.
      expect(signInRefusal({ ...form, declared: undefined }, new URL(ACCOUNT)), wall).toBe('method');
    }
    const snap = await load(snapHtml, SNAP);
    asServed(snap.doc);
    expect(signInRefusal(signInFormOf(workdayAdapter, snap.doc, 'sign-in')!, new URL(SNAP))).toBeNull();
  });

  it('holds a declared form to the adapter’s own form element (the v3 Phase 6/7b review, S8)', async () => {
    const fixture = await load(signInHtml);
    asServed(fixture.doc);
    const read = () => signInFormOf(workdayAdapter, fixture.doc, 'sign-in')!;
    expect(signInRefusal({ ...read(), form: undefined }, new URL(ACCOUNT))).toBe('shape');
    const other = fixture.doc.createElement('form');
    fixture.doc.body.append(other);
    expect(signInRefusal({ ...read(), form: other }, new URL(ACCOUNT))).toBe('shape');
    // Boxes with no form owner, and a role=button among them: no form to hold them, refused.
    const form = fixture.doc.querySelector<HTMLFormElement>('form[data-automation-id="signInFormo"]')!;
    const loose = fixture.doc.createElement('div');
    form.replaceWith(loose);
    loose.append(...Array.from(form.childNodes));
    const email = loose.querySelector<HTMLInputElement>('input[data-automation-id="email"]')!;
    const password = loose.querySelector<HTMLInputElement>('input[data-automation-id="password"]')!;
    const face = loose.querySelector<HTMLElement>('[data-automation-id="click_filter"]')!;
    expect(signInRefusal({ email, password, confirm: null, terms: [], button: face, declared: true, scriptSubmits: true },
      new URL(ACCOUNT))).toBe('shape');
  });

  it('refuses it on http, on a host the every-site sign-in does not cover, with a written GET or another origin', async () => {
    const fixture = await load(signInHtml);
    const form = asServed(fixture.doc);
    const read = () => signInFormOf(workdayAdapter, fixture.doc, 'sign-in')!;
    expect(signInRefusal(read(), new URL(ACCOUNT.replace('https:', 'http:')))).toBe('not-https');
    expect(signInRefusal(read(), new URL('https://careers.example.com/apply'))).toBe('method');
    // Only the adapter's declaration lets a form with no method through: the same form, undeclared, is refused.
    expect(signInRefusal({ ...read(), scriptSubmits: undefined }, new URL(ACCOUNT))).toBe('method');
    form.setAttribute('method', 'get');
    expect(signInRefusal(read(), new URL(ACCOUNT))).toBe('method');
    form.removeAttribute('method');
    form.setAttribute('action', '/en-US/Workday/login');
    expect(signInRefusal(read(), new URL(ACCOUNT))).toBe('method');
    form.setAttribute('action', 'https://collector.example/steal');
    expect(signInRefusal(read(), new URL(ACCOUNT))).toBe('cross-origin');
  });

  it('refuses a hidden box, a honeypot in its place, a button that is no control or sits outside the form', async () => {
    const fixture = await load(signInHtml);
    asServed(fixture.doc);
    const read = () => signInFormOf(workdayAdapter, fixture.doc, 'sign-in')!;
    const password = fixture.doc.querySelector<HTMLInputElement>('input[data-automation-id="password"]')!;
    password.style.display = 'none';
    expect(signInRefusal(read(), new URL(ACCOUNT))).toBe('hidden');
    password.style.display = '';
    // The beecatcher (1 by 0 px, outside the form) never stands in for a box.
    const bee = fixture.doc.querySelector<HTMLInputElement>('input[data-automation-id="beecatcher"]')!;
    expect(signInRefusal({ ...read(), email: bee }, new URL(ACCOUNT))).not.toBeNull();
    password.setAttribute('tabindex', '-1');
    expect(signInRefusal(read(), new URL(ACCOUNT))).toBe('honeypot');
    password.removeAttribute('tabindex');
    // A press control that is no button, or one outside the form.
    const outside = fixture.doc.querySelector<HTMLElement>('[data-automation-id="backToJobPosting"]')!;
    expect(signInRefusal({ ...read(), button: outside }, new URL(ACCOUNT))).toBe('shape');
    const plain = fixture.doc.createElement('div');
    plain.textContent = 'Sign In';
    plain.style.cssText = 'width:120px;height:30px';
    fixture.doc.querySelector('form[data-automation-id="signInFormo"]')!.append(plain);
    expect(signInRefusal({ ...read(), button: plain }, new URL(ACCOUNT))).toBe('shape');
    expect(signInRefusal(read(), new URL(ACCOUNT))).toBeNull();
  });

  it('refuses declared terms that are hidden, outside the form or under aria-hidden', async () => {
    const fixture = await load(createHtml);
    asServed(fixture.doc);
    const read = () => signInFormOf(workdayAdapter, fixture.doc, 'create-account')!;
    const box = fixture.doc.querySelector<HTMLInputElement>('input[data-automation-id="createAccountCheckbox"]')!;
    expect(signInRefusal(read(), new URL(ACCOUNT))).toBeNull();
    const label = fixture.doc.querySelector<HTMLElement>('label[for="input-4"]')!;
    label.style.display = 'none';
    expect(signInRefusal(read(), new URL(ACCOUNT))).toBe('hidden');
    label.style.display = '';
    // A label shown whose words cannot be read (drawn in no colour): the box behind it is no box a person reaches (S6).
    for (const el of [label, ...Array.from(label.querySelectorAll<HTMLElement>('*'))]) el.style.color = 'transparent';
    expect(signInRefusal(read(), new URL(ACCOUNT))).toBe('hidden');
    for (const el of [label, ...Array.from(label.querySelectorAll<HTMLElement>('*'))]) el.style.color = '';
    expect(signInRefusal(read(), new URL(ACCOUNT))).toBeNull();
    // A box under aria-hidden, though its label shows: a trap for a program, never ticked.
    box.setAttribute('aria-hidden', 'true');
    expect(signInRefusal(read(), new URL(ACCOUNT))).toBe('honeypot');
    box.removeAttribute('aria-hidden');
    const stray = fixture.doc.createElement('input');
    stray.type = 'checkbox';
    fixture.doc.body.append(stray);
    expect(signInRefusal({ ...read(), terms: [box, stray] }, new URL(ACCOUNT))).toBe('shape');
  });

  it('reads no form on the Forgot Password view, and no wall there: it is the person’s', async () => {
    const fixture = await load(forgotHtml);
    expect(workdayAdapter.authState!(fixture.doc)).toBe('forgot-password');
    for (const wall of ['sign-in', 'create-account', 'email-gate'] as const) {
      expect(workdayAdapter.signInForm!(fixture.doc, wall)).toBeNull();
      expect(workdayAdapter.signInPrelude!(fixture.doc, wall)).toBeNull();
    }
  });
});
