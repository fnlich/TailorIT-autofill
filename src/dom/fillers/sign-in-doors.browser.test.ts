/*
 * Sign-in mode Auto's two doors of dom/fillers/not-submit.ts on their own (the v3 Phase 6/7b review, C2), on the
 * converted Workday captures (docs/FIXTURES.md): the one test file lint lets name them (eslint.config.mjs), beside
 * content/sign-in.ts, which calls them. The prelude door presses the adapter's declared control alone: never a control the
 * adapter names never to press anywhere on the page (Apple's and Google's sign-ins), never one that would submit a form,
 * never while the wall's form shows, never on http. The sign-in door never presses a button the adapter names never to
 * press (the Reset Password face Workday draws over its own button).
 */
import { afterEach, describe, expect, it } from 'vitest';
import forgotHtml from '../../../fixtures/workday/workday-forgot-password.html?raw';
import landingHtml from '../../../fixtures/workday/workday-landing.html?raw';
import signInHtml from '../../../fixtures/workday/workday-sign-in.html?raw';
import { workdayAdapter } from '../../adapters/workday';
import type { Adapter } from '../../adapters/types';
import { loadFixture, removeFixtures, type Fixture } from '../fixture.testkit';
import { signInFormOf } from '../sign-in-form';
import { clickAdapterSignIn, clickAdapterSignInPrelude } from './not-submit';

const ACCOUNT = 'https://workday.wd5.myworkdayjobs.com/en-US/Workday/job/x/Senior-Product-Manager--Technical_JR-0110787/apply/applyManually';
const PAGE = new URL(ACCOUNT);

afterEach(() => removeFixtures(document));

/** A capture with its base address, its account form as Workday serves it (no method, no action), and every click
 *  recorded by its control's automation id. */
async function served(html: string): Promise<{ fixture: Fixture; clicks: string[] }> {
  const fixture = await loadFixture(document, html, { width: 1280, height: 900 });
  const base = fixture.doc.createElement('base');
  base.href = ACCOUNT;
  fixture.doc.head.prepend(base);
  for (const form of Array.from(fixture.doc.querySelectorAll('form'))) {
    form.removeAttribute('action');
    form.removeAttribute('method');
  }
  const clicks: string[] = [];
  fixture.doc.addEventListener('click', (event) => {
    clicks.push((event.target as Element).closest('[data-automation-id]')?.getAttribute('data-automation-id') ?? '?');
    event.preventDefault();
  }, true);
  return { fixture, clicks };
}

/** Workday's adapter with its prelude answering `control` instead. */
const preludeOf = (control: (doc: Document) => HTMLElement | null): Adapter => ({ ...workdayAdapter,
  signInPrelude: (doc) => control(doc) });

describe('the sign-in prelude door', () => {
  it('presses the declared "Sign in with email" on the landing, once, over https', async () => {
    const { fixture, clicks } = await served(landingHtml);
    expect(signInFormOf(workdayAdapter, fixture.doc, 'sign-in')).toBeNull();
    const pressed = clickAdapterSignInPrelude(workdayAdapter, fixture.doc, 'sign-in', PAGE);
    expect(pressed?.getAttribute('data-automation-id')).toBe('SignInWithEmailButton');
    expect(clicks).toEqual(['SignInWithEmailButton']);
  });

  it('never presses Apple’s or Google’s sign-in, a control the adapter names never to press', async () => {
    const { fixture, clicks } = await served(landingHtml);
    for (const id of ['AppleSignInButton', 'GoogleSignInButton']) {
      const adapter = preludeOf((doc) => doc.querySelector<HTMLElement>(`[data-automation-id="${id}"]`));
      expect(clickAdapterSignInPrelude(adapter, fixture.doc, 'sign-in', PAGE), id).toBeNull();
    }
    expect(clicks).toEqual([]);
  });

  it('never presses a control that would submit a form', async () => {
    const { fixture, clicks } = await served(landingHtml);
    const form = fixture.doc.createElement('form');
    const submit = fixture.doc.createElement('button');
    submit.textContent = 'Continue';
    submit.style.cssText = 'display:block;width:160px;height:40px';
    form.append(submit);
    fixture.doc.body.prepend(form);
    expect(clickAdapterSignInPrelude(preludeOf(() => submit), fixture.doc, 'sign-in', PAGE)).toBeNull();
    expect(clicks).toEqual([]);
  });

  it('never presses while the wall’s form shows, nor on an http page', async () => {
    const signIn = await served(signInHtml);
    expect(signInFormOf(workdayAdapter, signIn.fixture.doc, 'sign-in')).not.toBeNull();
    const shown = signIn.fixture.doc.querySelector<HTMLElement>('[data-automation-id="click_filter"]')!;
    expect(clickAdapterSignInPrelude(preludeOf(() => shown), signIn.fixture.doc, 'sign-in', PAGE)).toBeNull();
    expect(signIn.clicks).toEqual([]);
    removeFixtures(document);
    const landing = await served(landingHtml);
    const http = new URL(ACCOUNT.replace('https:', 'http:'));
    expect(clickAdapterSignInPrelude(workdayAdapter, landing.fixture.doc, 'sign-in', http)).toBeNull();
    expect(landing.clicks).toEqual([]);
  });
});

// ── The v4 review (L5) ──
/** reCAPTCHA v2's checkbox, unsolved, built node by node (srcdoc first: its address is read, never loaded). */
function checkboxCaptcha(doc: Document): HTMLElement {
  const widget = doc.createElement('div');
  widget.className = 'g-recaptcha';
  widget.setAttribute('data-sitekey', 'x');
  const box = doc.createElement('div');
  box.style.cssText = 'width:304px;height:78px';
  const holder = doc.createElement('div');
  const frame = doc.createElement('iframe');
  frame.setAttribute('srcdoc', '');
  frame.title = 'reCAPTCHA';
  frame.width = '304';
  frame.height = '78';
  frame.src = 'https://www.google.com/recaptcha/api2/anchor?ar=1&k=x&size=normal';
  holder.append(frame);
  const response = doc.createElement('textarea');
  response.name = 'g-recaptcha-response';
  response.style.display = 'none';
  box.append(holder, response);
  widget.append(box);
  return widget;
}

describe('the sign-in prelude door and a challenge (the v4 review, L5)', () => {
  it('never presses while the page shows a challenge frame; since v5 a checkbox CAPTCHA not solved holds it no more',
    async () => {
      const { fixture, clicks } = await served(landingHtml);
      const view = fixture.doc.querySelector('[data-automation-id="signInContent"]')!;
      // A frame of another origin that reads like a challenge holds it.
      const shield = fixture.doc.createElement('iframe');
      shield.setAttribute('srcdoc', '');
      shield.title = 'Human verification';
      shield.src = 'https://shield.example/f';
      shield.style.cssText = 'width:304px;height:78px;border:0';
      view.append(shield);
      expect(clickAdapterSignInPrelude(workdayAdapter, fixture.doc, 'sign-in', PAGE)).toBeNull();
      expect(clicks).toEqual([]);
      // v5 p1-rules (PLAN decision 9, like Jobright): reCAPTCHA's checkbox, unticked, holds no press: the site decides.
      shield.remove();
      view.append(checkboxCaptcha(fixture.doc));
      expect(clickAdapterSignInPrelude(workdayAdapter, fixture.doc, 'sign-in', PAGE)?.getAttribute('data-automation-id'))
        .toBe('SignInWithEmailButton');
    });
});

describe('the sign-in door', () => {
  it('presses the declared Sign In face, and never the Reset Password face Workday draws over its own button', async () => {
    const { fixture, clicks } = await served(signInHtml);
    expect(clickAdapterSignIn(workdayAdapter, fixture.doc, 'sign-in', PAGE)?.getAttribute('data-automation-id'))
      .toBe('click_filter');
    expect(clicks).toEqual(['click_filter']);
    clicks.length = 0;
    // The Forgot Password view's own button and its face, in the same form: an adapter that offered that face as the
    // form's button is refused, the face being one of its never-pressed controls.
    const declared = workdayAdapter.signInForm!(fixture.doc, 'sign-in')!;
    const forgot = await loadFixture(document, forgotHtml, { width: 1280, height: 900 });
    const reset = forgot.doc.querySelector('[data-automation-id="resetPasswordButton"]')!.parentElement!;
    declared.form!.append(fixture.doc.importNode(reset, true));
    const face = Array.from(declared.form!.querySelectorAll<HTMLElement>('[data-automation-id="click_filter"]'))
      .find((el) => el.getAttribute('aria-label') === 'Reset Password')!;
    expect(face).toBeDefined();
    const offeringReset: Adapter = { ...workdayAdapter, signInForm: () => ({ ...declared, button: face }) };
    expect(clickAdapterSignIn(offeringReset, fixture.doc, 'sign-in', PAGE)).toBeNull();
    expect(clicks).toEqual([]);
  });
});
