/*
 * UltiPro's rules the behaviour review of 2026-11-06 found untested (FINDINGS.md minor 16: U1 to U4, U6 to U8, U13,
 * U15 to U17), pinned on the owner's snapshots (fixtures/ultipro: register [ultipro-2], resume-review [ultipro-1],
 * application [ultipro-0]):
 * - U1 to U3 (signInContainer, register): the account form and its Create account (the host tied to the form by
 *   form="registrationDetailsForm", its shadow root's native button) count only while a person sees both;
 * - U4, U17 (periodLabels, resume-review): a period box is labelled by its group only where it has no label of its own,
 *   in a div.form-group[role=group];
 * - U6 (errors, application): a field's error span is an error once a person sees it;
 * - U7, U8 (the review state, resume-review): its Next is the primary "Save and continue" in its actions, and the state
 *   holds only while the parsed résumé's contact section shows;
 * - U13 (startDateLabel, application): the start date's boxes take the start-date label alone;
 * - U15 (root, application): #OpportunityApply is the root only while it holds the Submit host;
 * - U16 (skillsTitle, resume-review): the typeahead takes the Skills panel's heading only inside that panel.
 */
import { afterEach, describe, expect, it } from 'vitest';
import applicationHtml from '../../../fixtures/ultipro/application.html?raw';
import registerHtml from '../../../fixtures/ultipro/register.html?raw';
import resumeReviewHtml from '../../../fixtures/ultipro/resume-review.html?raw';
import { loadFixture, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { ultiproAdapter } from './index';

afterEach(() => removeFixtures(document));

const open = (html: string): Promise<Fixture> => loadFixture(document, html, SNAPSHOT_VIEWPORT);
const q = <T extends Element = HTMLElement>(fixture: Fixture, selector: string) => fixture.doc.querySelector<T>(selector)!;
const REVIEW = 'div[data-bind="if: isParsingResume()"]';
const TO_MONTH = '[aria-label="Work Experience 1"] [data-automation="to-month-dropdown"]';

/** Every element under `scope` matching `selector`, open shadow roots included. */
function deepAll(scope: Document | Element | ShadowRoot, selector: string): Element[] {
  const found: Element[] = [];
  const visit = (at: Document | Element | ShadowRoot) => {
    for (const el of Array.from(at.querySelectorAll('*'))) {
      if (el.matches(selector)) found.push(el);
      if (el.shadowRoot !== null) visit(el.shadowRoot);
    }
  };
  visit(scope);
  return found;
}

describe('the account step (register)', () => {
  const parts = (fixture: Fixture) => {
    const form = q(fixture, 'form#registrationDetailsForm');
    const host = q(fixture, '[data-automation="registrationDetails-submit-button"]');
    const native = host.shadowRoot!.querySelector<HTMLElement>('button.ukg-button-native')!;
    return { form, host, native };
  };

  it('reads the container while the form and its Create account show', async () => {
    const fixture = await open(registerHtml);
    const { form, native } = parts(fixture);
    expect(ultiproAdapter.signInContainer?.(fixture.doc)).toMatchObject({ container: form, button: native });
  });

  it('U1: none while the Create account button is not shown', async () => {
    const fixture = await open(registerHtml);
    parts(fixture).native.style.display = 'none';
    expect(ultiproAdapter.signInContainer?.(fixture.doc)).toBeNull();
  });

  it('U2: none while the form is not shown, though its Create account (outside it) is', async () => {
    const fixture = await open(registerHtml);
    const { form, host } = parts(fixture);
    expect(form.contains(host)).toBe(false);
    form.style.display = 'none';
    expect(ultiproAdapter.signInContainer?.(fixture.doc)).toBeNull();
  });

  it('U3: none where the Create account host does not name the registration form', async () => {
    const fixture = await open(registerHtml);
    parts(fixture).host.removeAttribute('form');
    expect(ultiproAdapter.signInContainer?.(fixture.doc)).toBeNull();
  });
});

describe('labels (resume-review, application)', () => {
  it('U4: a period box with a label of its own is not labelled by its group', async () => {
    const fixture = await open(resumeReviewHtml);
    const box = q(fixture, TO_MONTH);
    expect(ultiproAdapter.labelFor!(box)?.textContent?.trim()).toBe('To');
    box.id = 'to-month-own';
    const own = fixture.doc.createElement('label');
    own.htmlFor = box.id;
    own.textContent = 'End month';
    box.before(own);
    expect(ultiproAdapter.labelFor!(box)).toBeNull();
  });

  it('U17: a period box outside a div.form-group[role=group] is not labelled by it', async () => {
    const fixture = await open(resumeReviewHtml);
    const box = q(fixture, TO_MONTH);
    box.closest('div.form-group[role="group"]')!.removeAttribute('role');
    expect(ultiproAdapter.labelFor!(box)).toBeNull();
  });

  it("U16: the typeahead takes the Skills panel's heading only inside the Skills panel", async () => {
    const fixture = await open(resumeReviewHtml);
    const typeahead = q(fixture, 'input[data-automation="item-typeahead"]');
    expect(ultiproAdapter.labelFor!(typeahead)?.textContent?.trim()).toBe('Skills');
    typeahead.closest('div[aria-label="Skills"]')!.setAttribute('aria-label', 'Behaviors');
    expect(ultiproAdapter.labelFor!(typeahead)).toBeNull();
  });

  it("U13: the start date's boxes take the start-date label alone (application)", async () => {
    const fixture = await open(applicationHtml);
    const month = deepAll(fixture.doc, '[data-automation="ukg-date-input-text-month"]')[0]!;
    const label = q(fixture, 'label[data-automation="start-date-label"]');
    expect(ultiproAdapter.labelFor!(month)).toBe(label);
    label.removeAttribute('data-automation');
    expect(ultiproAdapter.labelFor!(month)).toBeNull();
  });
});

describe('errors, root and the review state', () => {
  it("U6: a field's error span is an error once a person sees it (application)", async () => {
    const fixture = await open(applicationHtml);
    const root = ultiproAdapter.detect(fixture.doc)!.formRoot;
    const error = q(fixture, 'span#CountryError');
    expect((ultiproAdapter.errors?.(root) ?? []).map((each) => each.el)).not.toContain(error);
    error.textContent = 'Country is required.';
    error.style.display = 'block';
    expect((ultiproAdapter.errors?.(root) ?? []).map((each) => each.el)).toContain(error);
  });

  it('U15: #OpportunityApply is the root only while it holds the Submit host (application)', async () => {
    const fixture = await open(applicationHtml);
    expect(ultiproAdapter.detect(fixture.doc)?.formRoot).toBe(q(fixture, '#OpportunityApply'));
    for (const submit of Array.from(fixture.doc.querySelectorAll('ukg-button[data-automation="btn-submit"]'))) submit.remove();
    expect(ultiproAdapter.detect(fixture.doc)).toBeNull();
  });

  it('U7: the review\'s Next is the primary "Save and continue" in its actions, not another save button', async () => {
    const fixture = await open(resumeReviewHtml);
    const review = q(fixture, REVIEW);
    const other = fixture.doc.createElement('button');
    other.className = 'btn btn-link';
    other.setAttribute('data-automation', 'save-button');
    other.textContent = 'Save';
    review.prepend(other);
    expect(ultiproAdapter.nextButton?.(review)?.textContent).toBe('Save and continue');
  });

  it("U8: the review state holds only while the parsed résumé's contact section shows", async () => {
    const fixture = await open(resumeReviewHtml);
    const review = q(fixture, REVIEW);
    expect(ultiproAdapter.detect(fixture.doc)?.formRoot).toBe(review);
    q(fixture, `${REVIEW} [data-automation="contact-information-section"]`).removeAttribute('data-automation');
    expect(ultiproAdapter.stepSignature?.(fixture.doc)).not.toEqual({ anchors: ['state:review'] });
    expect(ultiproAdapter.detect(fixture.doc)?.formRoot).not.toBe(review);
  });
});
