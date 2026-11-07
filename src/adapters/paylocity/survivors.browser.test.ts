/*
 * Paylocity's root rule the behaviour review of 2026-11-06 found untested (FINDINGS.md minor 16, P1), pinned on the
 * owner's snapshot (fixtures/paylocity/sourcepass-step3-identity): #app is the application's root only while it holds
 * the step's progress header (p.progress-header); the same #app without one is no application.
 */
import { afterEach, describe, expect, it } from 'vitest';
import identityHtml from '../../../fixtures/paylocity/sourcepass-step3-identity.html?raw';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { paylocityAdapter } from './index';

afterEach(() => removeFixtures(document));

describe('Paylocity root (sourcepass-step3-identity)', () => {
  it('P1: #app is the root only while it holds the progress header', async () => {
    const fixture = await loadFixture(document, identityHtml, SNAPSHOT_VIEWPORT);
    const app = fixture.doc.querySelector('#app')!;
    expect(paylocityAdapter.detect(fixture.doc)?.formRoot).toBe(app);
    for (const header of Array.from(fixture.doc.querySelectorAll('p.progress-header'))) header.remove();
    expect(paylocityAdapter.detect(fixture.doc)).toBeNull();
  });
});
