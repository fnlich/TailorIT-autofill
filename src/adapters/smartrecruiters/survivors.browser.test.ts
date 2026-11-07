/*
 * SmartRecruiters' required rule the behaviour review of 2026-11-06 found untested (FINDINGS.md minor 16, S05), pinned
 * on the owner's snapshot (fixtures/smartrecruiters/xplor-screening): a screening Yes/No group is required only where
 * its fieldset (in the group's own shadow root) says aria-required="true", never because it is a group.
 */
import { afterEach, describe, expect, it } from 'vitest';
import xplorScreeningHtml from '../../../fixtures/smartrecruiters/xplor-screening.html?raw';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { smartRecruitersAdapter } from './index';

afterEach(() => removeFixtures(document));

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

describe('SmartRecruiters requiredFor (xplor-screening)', () => {
  it("S05: a Yes/No group is required by its fieldset's aria-required alone", async () => {
    const fixture = await loadFixture(document, xplorScreeningHtml, SNAPSHOT_VIEWPORT);
    const group = deepAll(fixture.doc, 'spl-radio-group#spl-form-element_21')[0]!;
    const fieldset = group.shadowRoot!.querySelector('fieldset[role="radiogroup"]')!;
    expect(fieldset.getAttribute('aria-required')).toBe('true');
    expect(smartRecruitersAdapter.requiredFor!(group)).toBe(true);
    // The same group with its fieldset no longer saying so: optional.
    fieldset.setAttribute('aria-required', 'false');
    expect(smartRecruitersAdapter.requiredFor!(group)).toBe(false);
    fieldset.removeAttribute('aria-required');
    expect(smartRecruitersAdapter.requiredFor!(group)).toBe(false);
  });
});
