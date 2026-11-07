/*
 * BambooHR's Submit rule the behaviour review of 2026-11-06 found untested (FINDINGS.md minor 16, B3), pinned on the
 * owner's snapshot (fixtures/bamboohr/swyfft-form, bamboohr-0 to -2): the footer's Cancel is a type=submit button too,
 * so Submit is named by its form attribute (form="job-application-form"), and Cancel is never it, even where the real
 * Submit is not shown.
 */
import { afterEach, describe, expect, it } from 'vitest';
import formHtml from '../../../fixtures/bamboohr/swyfft-form.html?raw';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { bambooHrAdapter } from './index';

afterEach(() => removeFixtures(document));

describe('BambooHR Submit (swyfft-form)', () => {
  it('B3: Submit is the button tied to the form, never the footer\'s Cancel (also type=submit), even with Submit hidden',
    async () => {
      const fixture = await loadFixture(document, formHtml, SNAPSHOT_VIEWPORT);
      const root = bambooHrAdapter.detect(fixture.doc)!.formRoot;
      const submit = fixture.doc.querySelector<HTMLElement>('button[type="submit"][form="job-application-form"]')!;
      const cancel = fixture.doc.querySelector<HTMLElement>(
        '[data-fabric-component="ActionFooter"] button[data-fabric-component="TextButton"]')!;
      expect([cancel.getAttribute('type'), cancel.hasAttribute('form'), cancel.textContent?.trim()])
        .toEqual(['submit', false, 'Cancel']);
      expect(bambooHrAdapter.submitButton?.(root)).toBe(submit);
      // The real Submit drawn hidden (before the page shows it): still named, so the fill never presses it, and
      // Cancel, the shown type=submit, never stands in for it.
      submit.style.display = 'none';
      expect(bambooHrAdapter.submitButton?.(root)).toBe(submit);
      expect(bambooHrAdapter.submitButton?.(root)).not.toBe(cancel);
      expect(bambooHrAdapter.isFinalStep?.(fixture.doc)).toBe('unknown');
    });
});
