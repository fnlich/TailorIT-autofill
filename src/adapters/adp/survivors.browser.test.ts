/*
 * ADP's rules the behaviour review of 2026-11-06 found untested (FINDINGS.md minor 16: A3, A5, A8 to A10, A17, A22),
 * pinned on the owner's snapshots (fixtures/adp; the converter wrote every chosen value as a placeholder):
 * - A3 (self-id, adp-3): a react-select shows its chosen value in its single-value box, which shownAnswer reads; an
 *   unchosen one (personal, adp-1: Country) shows none;
 * - A5 (self-attest, adp-4): the e-signature is required by its label's class (label.required) alone;
 * - A8, A9 (self-attest; questions, adp-2): the signature's "required" notice and a field's validation label are the
 *   page's errors once a person sees them;
 * - A10 (guest, adp-6): the page's busy overlay (#recPageLoadWaitingIndicator) is busy while it shows;
 * - A17 (personal): the preferred-name box is stood for by its own drawn label;
 * - A22 (personal): #jobApplicationSubmit is the root only while it holds a wizard step.
 */
import { afterEach, describe, expect, it } from 'vitest';
import guestHtml from '../../../fixtures/adp/guest.html?raw';
import personalHtml from '../../../fixtures/adp/personal.html?raw';
import questionsHtml from '../../../fixtures/adp/questions.html?raw';
import selfAttestHtml from '../../../fixtures/adp/self-attest.html?raw';
import selfIdHtml from '../../../fixtures/adp/self-id.html?raw';
import { loadFixture, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { adpAdapter } from './index';

afterEach(() => removeFixtures(document));

const open = (html: string): Promise<Fixture> => loadFixture(document, html, SNAPSHOT_VIEWPORT);
const q = <T extends Element = HTMLElement>(fixture: Fixture, selector: string) => fixture.doc.querySelector<T>(selector)!;
const errorsOf = (fixture: Fixture) => (adpAdapter.errors?.(adpAdapter.detect(fixture.doc)!.formRoot) ?? [])
  .map((error) => error.el);

describe('ADP: the rules the review found untested', () => {
  it("A3: a react-select's chosen value is its shown answer; an unchosen one shows none (self-id, personal)", async () => {
    const chosen = await open(selfIdHtml);
    const gender = adpAdapter.widgetFor!(q(chosen, 'input#vsidGender'))!;
    const shown = gender.shownAnswer?.([]) ?? null;
    expect(typeof shown).toBe('string');
    expect(shown!.length).toBeGreaterThan(0);
    removeFixtures(document);
    const empty = await open(personalHtml);
    expect(adpAdapter.widgetFor!(q(empty, 'input#PersonalAddress_country'))!.shownAnswer?.([]) ?? null).toBeNull();
  });

  it("A5: the e-signature is required by its label's class alone (self-attest)", async () => {
    const fixture = await open(selfAttestHtml);
    const signature = q(fixture, 'input#electronicSignature');
    expect(signature.previousElementSibling?.matches('label.required')).toBe(true);
    expect(adpAdapter.requiredFor!(signature)).toBe(true);
  });

  it('A8, A9: the signature\'s required notice is an error once a person sees it (self-attest)', async () => {
    const fixture = await open(selfAttestHtml);
    const notice = q(fixture, 'div.self-review-signature-required');
    expect(errorsOf(fixture)).not.toContain(notice);
    notice.textContent = 'Signature is required.';
    expect(errorsOf(fixture)).toContain(notice);
  });

  it('A9: a field\'s validation label is an error once a person sees it (questions)', async () => {
    const fixture = await open(questionsHtml);
    const label = q(fixture, 'label.vdl-validation-error[role="alert"]');
    expect(errorsOf(fixture)).not.toContain(label);
    label.textContent = 'This field is required.';
    expect(errorsOf(fixture)).toContain(label);
  });

  it("A10: the page's busy overlay is busy while it shows (guest)", async () => {
    const fixture = await open(guestHtml);
    expect(adpAdapter.isBusy?.(fixture.doc)).toBe(false);
    q(fixture, '#recPageLoadWaitingIndicator').style.display = 'flex';
    expect(adpAdapter.isBusy?.(fixture.doc)).toBe(true);
  });

  it('A17: the preferred-name box is stood for by its own drawn label (personal)', async () => {
    const fixture = await open(personalHtml);
    const box = q<HTMLInputElement>(fixture, 'div.vdl-checkbox > input[name="usePreferredName"]');
    expect(adpAdapter.proxyFor?.(box)).toBe(q(fixture, 'div.vdl-checkbox#usePreferredName > label'));
  });

  it('A22: #jobApplicationSubmit is the root only while it holds a wizard step (personal)', async () => {
    const fixture = await open(personalHtml);
    const holder = q(fixture, '#jobApplicationSubmit');
    expect(adpAdapter.detect(fixture.doc)?.formRoot).toBe(holder);
    for (const step of Array.from(fixture.doc.querySelectorAll('div.mdf-custom-wizard-step'))) {
      step.classList.remove('mdf-custom-wizard-step');
    }
    expect(adpAdapter.detect(fixture.doc)).toBeNull();
  });
});
