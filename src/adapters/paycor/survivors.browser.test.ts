/*
 * Paycor's root rule the behaviour review of 2026-11-06 found untested (FINDINGS.md minor 16, PC6), pinned on the
 * owner's snapshot (fixtures/paycor/regard-form, paycor-0): div.gnewtonSubmitResume is the application's root only
 * while it holds the application's form#gnewtonForm, not the résumé upload's form alone.
 */
import { afterEach, describe, expect, it } from 'vitest';
import formHtml from '../../../fixtures/paycor/regard-form.html?raw';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { paycorAdapter } from './index';

afterEach(() => removeFixtures(document));

describe('Paycor root (regard-form)', () => {
  it('PC6: div.gnewtonSubmitResume is the root only while it holds form#gnewtonForm', async () => {
    const fixture = await loadFixture(document, formHtml, SNAPSHOT_VIEWPORT);
    const holder = fixture.doc.querySelector('div.gnewtonSubmitResume')!;
    expect(paycorAdapter.detect(fixture.doc)?.formRoot).toBe(holder);
    fixture.doc.querySelector('form#gnewtonForm')!.remove();
    expect(holder.querySelector('form#uploadResume')).not.toBeNull();
    expect(paycorAdapter.detect(fixture.doc)).toBeNull();
  });
});
