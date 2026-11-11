/*
 * jr6 apply F2 item 6 (APPLYPLAN D7; AF-11): the generic second step of an entry (adapters/second-step.ts), and its door
 * (dom/fillers/not-submit.ts, through press.ts pressSecondStep): in a dialog shown after our press, the one control whose
 * own words are D7's ("Apply manually", "Apply without (an) account", "Apply as (a) guest", "Continue as (a) guest",
 * "Start (your) application", "Continue to application") is pressed; a never-word ("Autofill with Resume", "Use My
 * Last Application", another site's profile, a sign-in, an account's creation) is refused; two candidates are refused;
 * a dialog shown before our press is refused; a control an adapter never presses (Taleo's "Apply as Guest") is refused,
 * with no exemption; and nothing is pressed while a form shows. Synthetic pages; every click recorded and held.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { pressSecondStep } from '../content/press';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { genericAdapter } from './generic';
import { dialogsShown, NEVER_WORDS, ownNameOf, SECOND_STEP_WORDS, secondStepControl } from './second-step';
import { taleoAdapter } from './taleo';
import type { Adapter } from './types';

afterEach(() => removeFixtures(document));

/** The page's own adapter, standing for a platform with no declared choice: no form, nothing never pressed. */
const own: Adapter = { ...genericAdapter, id: 'lever', detect: () => null };
const ADDRESS = new URL('https://jobs.lever.co/acme/1b9f2d3e-1c4a-4e8b-9a7d-5f6e3c2b1a00');

/** A posting with `dialog` drawn closed; its clicks recorded and held. Opens it, as the page's own script would after
 *  our press, when asked. */
async function page(dialog: string, more = '') {
  const fixture = await loadFixture(document, `<!doctype html><html><body><main><h1>Platform Engineer</h1>
    <a id="apply" href="${ADDRESS.href}/apply">Apply for this job</a>${more}</main>${dialog}</body></html>`);
  const clicks: string[] = [];
  fixture.doc.addEventListener('click', (event) => {
    clicks.push((event.target as Element).id);
    event.preventDefault();
  }, true);
  const before = dialogsShown(fixture.doc);
  const open = () => {
    for (const el of Array.from(fixture.doc.querySelectorAll('dialog'))) el.setAttribute('open', '');
    for (const el of Array.from(fixture.doc.querySelectorAll<HTMLElement>('[data-shown-after]'))) el.style.display = 'block';
  };
  return { doc: fixture.doc, clicks, before, open };
}

const dialogWith = (controls: string) => `<dialog id="how" aria-labelledby="how-title"><h2 id="how-title">How would you
  like to apply?</h2>${controls}</dialog>`;

describe('the generic second step (jr6 apply F2 item 6)', () => {
  it('presses each of D7’s words, once, in a dialog shown after the press', async () => {
    const words = ['Apply manually', 'Apply Manually', 'Apply without account', 'Apply without an account',
      'Apply as guest', 'Apply as a Guest', 'Continue as guest', 'Continue as a guest', 'Start application',
      'Start your application', 'Continue to application', '  Apply   manually → '];
    for (const word of words) {
      const { doc, clicks, before, open } = await page(dialogWith(`<button id="step" type="button">${word}</button>
        <button id="close" type="button" aria-label="Close">×</button>`));
      expect(secondStepControl(doc, before), word).toBeNull();
      open();
      expect(secondStepControl(doc, before)?.id, word).toBe('step');
      expect(pressSecondStep(doc, [own], before, ADDRESS)?.id, word).toBe('step');
      expect(clicks, word).toEqual(['step']);
      removeFixtures(document);
    }
  });

  it('reads the control’s own name: aria-label, aria-labelledby, an input’s value, a link, role=button', async () => {
    for (const control of [`<span id="step" role="button" tabindex="0" aria-label="Apply manually">Go</span>`,
      `<button id="step" type="button" aria-labelledby="l"><span>→</span></button><span id="l">Continue as guest</span>`,
      `<input id="step" type="button" value="Apply without account">`,
      `<a id="step" href="#manual">Start your application</a>`]) {
      const { doc, clicks, before, open } = await page(dialogWith(control));
      open();
      expect(pressSecondStep(doc, [own], before, ADDRESS)?.id, control).toBe('step');
      expect(clicks, control).toEqual(['step']);
      removeFixtures(document);
    }
    expect(ownNameOf(new DOMParser().parseFromString('<button title="Apply manually"></button>', 'text/html')
      .querySelector('button')!)).toBe('Apply manually');
  });

  it('refuses every never-word, and any other word', async () => {
    for (const word of ['Autofill with Resume', 'Use My Last Application', 'Apply with LinkedIn', 'Apply with Indeed',
      'Sign in', 'Sign In to apply', 'Log in', 'Create account', 'Create an account', 'Register', 'Apply',
      'Apply now', 'Submit application', 'Continue', 'Apply manually with my LinkedIn profile',
      'Apply manually and create an account later because this name is too long to read']) {
      const { doc, clicks, before, open } = await page(dialogWith(`<button id="step" type="button">${word}</button>`));
      open();
      expect(secondStepControl(doc, before), word).toBeNull();
      expect(pressSecondStep(doc, [own], before, ADDRESS), word).toBeNull();
      expect(clicks, word).toEqual([]);
      removeFixtures(document);
    }
    expect(NEVER_WORDS.test('Autofill with Resume')).toBe(true);
    expect(SECOND_STEP_WORDS.test('Apply')).toBe(false);
  });

  it('refuses two candidates (they may lead to different places), counting only what a person can see and press',
    async () => {
      const two = await page(dialogWith(`<button id="a" type="button">Apply manually</button>
        <button id="b" type="button">Continue as guest</button>`));
      two.open();
      expect(pressSecondStep(two.doc, [own], two.before, ADDRESS)).toBeNull();
      expect(two.clicks).toEqual([]);
      removeFixtures(document);
      // A hidden or disabled second candidate is none: the one shown is pressed.
      const one = await page(dialogWith(`<button id="a" type="button">Apply manually</button>
        <button id="b" type="button" disabled>Continue as guest</button>
        <button id="c" type="button" style="display:none">Start application</button>
        <button id="d" type="button" aria-disabled="true">Apply as guest</button>`));
      one.open();
      expect(pressSecondStep(one.doc, [own], one.before, ADDRESS)?.id).toBe('a');
      expect(one.clicks).toEqual(['a']);
    });

  it('refuses a dialog shown before our press, and a control outside any dialog', async () => {
    const shown = await page('<div id="how" role="dialog"><button id="step" type="button">Apply manually</button></div>');
    // The dialog was there, shown, at the press: none of it is a second step.
    expect(shown.before.size).toBe(1);
    expect(pressSecondStep(shown.doc, [own], shown.before, ADDRESS)).toBeNull();
    // Undo: taken as shown after the press, it is.
    expect(secondStepControl(shown.doc, new Set())?.id).toBe('step');
    expect(shown.clicks).toEqual([]);
    removeFixtures(document);
    const loose = await page('', '<button id="step" type="button">Apply manually</button>');
    expect(pressSecondStep(loose.doc, [own], loose.before, ADDRESS)).toBeNull();
    expect(loose.clicks).toEqual([]);
  });

  it('reads [role=dialog] and [aria-modal] containers too, drawn after the press', async () => {
    const { doc, clicks, before, open } = await page(`<div id="how" role="dialog" aria-modal="true" data-shown-after
      style="display:none"><button id="step" type="button">Apply as a guest</button></div>`);
    expect(pressSecondStep(doc, [own], before, ADDRESS)).toBeNull();
    open();
    expect(pressSecondStep(doc, [own], before, ADDRESS)?.id).toBe('step');
    expect(clicks).toEqual(['step']);
  });

  it('refuses a control an adapter never presses, with no exemption (Taleo’s "Apply as Guest")', async () => {
    // Taleo's own id for its "Apply as Guest" (adapters/taleo/index.ts NEVER_PRESSED, fixtures/taleo/hdr-login.html).
    const guest = `<input id="dialogTemplate-dialogForm-login-guestapply" type="button" value="Apply as Guest">`;
    const { doc, clicks, before, open } = await page(dialogWith(guest));
    open();
    expect(secondStepControl(doc, before)?.id).toBe('dialogTemplate-dialogForm-login-guestapply');
    expect(pressSecondStep(doc, [taleoAdapter], before, ADDRESS)).toBeNull();
    // Even marked as its entry's exemption (entryNeverPressed), the second step's door holds it.
    expect(pressSecondStep(doc, [{ ...taleoAdapter, entryNeverPressed: true }], before, ADDRESS)).toBeNull();
    expect(clicks).toEqual([]);
  });

  it('presses nothing while a form shows, nothing that submits a form, nothing that leaves the tab', async () => {
    const formed = await page(dialogWith('<button id="step" type="button">Apply manually</button>'));
    formed.open();
    const withForm: Adapter = { ...own, detect: (doc) => ({ formRoot: doc.querySelector('main')! }) };
    expect(pressSecondStep(formed.doc, [withForm], formed.before, ADDRESS)).toBeNull();
    removeFixtures(document);
    const submits = await page(dialogWith('<form method="post" action="/x"><button id="step">Apply manually</button></form>'));
    submits.open();
    expect(pressSecondStep(submits.doc, [own], submits.before, ADDRESS)).toBeNull();
    removeFixtures(document);
    const blank = await page(dialogWith(`<a id="step" href="${ADDRESS.href}/apply" target="_blank">Apply manually</a>`));
    blank.open();
    expect(pressSecondStep(blank.doc, [own], blank.before, ADDRESS)).toBeNull();
    expect([formed.clicks, submits.clicks, blank.clicks]).toEqual([[], [], []]);
  });
});
