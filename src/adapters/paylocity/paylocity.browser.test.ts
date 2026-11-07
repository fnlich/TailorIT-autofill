/*
 * The Paylocity adapter (DESIGN-NEW-ATS §5, builder B) on the owner's snapshots of 2026-11-06 (fixtures/paylocity; the
 * design's ids paylocity-0 to -2): each case's hooks and scan held against its hand-written expectations, the steps
 * (Next and Submit sharing one id, Previous never), the react-widgets DropdownLists and Paylocity's input-selects, the
 * footer's questions outside the step page, the sections, and every rule shown to matter by the same page read with
 * that rule undone. Step 1 is in no snapshot.
 */
import { afterEach, describe, expect, it } from 'vitest';
import step2Expect from '../../../fixtures/paylocity/sourcepass-step2-eeo.expect.json';
import step2Html from '../../../fixtures/paylocity/sourcepass-step2-eeo.html?raw';
import step3Expect from '../../../fixtures/paylocity/sourcepass-step3-identity.expect.json';
import step3Html from '../../../fixtures/paylocity/sourcepass-step3-identity.html?raw';
import step4Expect from '../../../fixtures/paylocity/sourcepass-step4-review.expect.json';
import step4Html from '../../../fixtures/paylocity/sourcepass-step4-review.html?raw';
import { loadFixture, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { scan } from '../../dom/scan';
import type { ScannedField } from '../../dom/types';
import { configuredAdapter, type AtsConfig } from '../configured';
import { ATS_CONFIGS } from '../configured/registry';
import { adaptersFor } from '../index';
import { compareWithExpectation, fillabilityOf, readExpectation, scanCase, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { compareHooks, readHooks } from '../test/hooks.testkit';
import type { Adapter } from '../types';
import { PAYLOCITY_CONFIG, PAYLOCITY_FIXTURES, paylocityAdapter } from './index';

const APPLY = 'https://recruiting.paylocity.com/Recruiting/Jobs/Apply/4640311';

const CASES = [
  { name: 'sourcepass-step2-eeo', html: step2Html, json: step2Expect },
  { name: 'sourcepass-step3-identity', html: step3Html, json: step3Expect },
  { name: 'sourcepass-step4-review', html: step4Html, json: step4Expect },
] as const;

afterEach(() => removeFixtures(document));

const open = (html: string) => loadFixture(document, html, SNAPSHOT_VIEWPORT);
const q = <T extends Element = HTMLElement>(fixture: Fixture, selector: string) => fixture.doc.querySelector<T>(selector)!;
const without = (change: Partial<AtsConfig>): Adapter => configuredAdapter({ ...PAYLOCITY_CONFIG, ...change });
const scanned = (fixture: Fixture, adapter: Adapter = paylocityAdapter) =>
  scan(adapter.detect(fixture.doc)!.formRoot, adapter, { platform: 'paylocity' });
const fieldsOf = (fixture: Fixture, adapter: Adapter = paylocityAdapter): readonly ScannedField[] => scanned(fixture, adapter).fields;
const byId = (fields: readonly ScannedField[], id: string) => fields.find((field) => field.idAttr === id);

describe('the Paylocity adapter: its hooks and scans on the snapshots', () => {
  it("names each snapshot it was written from, and is the registry's adapter on /Recruiting/", () => {
    expect([...PAYLOCITY_FIXTURES].sort()).toEqual(CASES.map((each) => `fixtures/paylocity/${each.name}.html`).sort());
    expect(adaptersFor(new URL(APPLY))[0]).toBe(paylocityAdapter);
    expect(ATS_CONFIGS.paylocity).toBe(PAYLOCITY_CONFIG);
  });

  it.each(CASES)('$name: every hook answers what the page shows', async ({ html, json }) => {
    const fixture = await open(html);
    expect(compareHooks(fixture.doc, paylocityAdapter, readHooks(json))).toEqual([]);
  });

  it.each(CASES)('$name: the scan of its root is the expectation', async ({ html, json }) => {
    const read = await scanCase(document, html, APPLY);
    expect(read.adapter).toBe(paylocityAdapter);
    expect(compareWithExpectation(read.doc, read.result, readExpectation(json))).toEqual([]);
  });
});

describe('the steps (sourcepass-step2-eeo to -step4-review)', () => {
  it('reads each step by its progress and page, presses Next before the last, Submit only on it, never Previous', async () => {
    const expected = [
      { html: step2Html, page: 'pcty-wr-eeopage', progress: 'Step 2 of 4', heading: 'Equal Employment Opportunity',
        final: 'not-final' },
      { html: step3Html, page: 'pcty-wr-expanded-identity-page', progress: 'Step 3 of 4',
        heading: 'Optional Identity Questions', final: 'not-final' },
      { html: step4Html, page: 'pcty-wr-preview-jobapplication', progress: 'Step 4 of 4', heading: 'My Information',
        final: 'final' },
    ] as const;
    for (const { html, page, progress, heading, final } of expected) {
      const fixture = await open(html);
      const root = paylocityAdapter.detect(fixture.doc)!.formRoot;
      expect(root).toBe(q(fixture, '#app'));
      expect(paylocityAdapter.stepSignature?.(fixture.doc)).toEqual({ anchors: [page], heading, progress });
      expect(paylocityAdapter.isFinalStep?.(fixture.doc)).toBe(final);
      // Next and Submit are both button#btn-submit.
      const button = q(fixture, '#btn-submit');
      expect(paylocityAdapter.nextButton?.(root) ?? null).toBe(final === 'final' ? null : button);
      expect(paylocityAdapter.submitButton?.(root) ?? null).toBe(final === 'final' ? button : null);
      const previous = fixture.doc.querySelector('#btn-previous');
      if (previous !== null) expect(paylocityAdapter.neverPress!(root)).toContain(previous);
      removeFixtures(document);
    }
    // Undone (no Submit rule): the review's #btn-submit is neither, its finality unknown.
    const review = await open(step4Html);
    expect(without({ submit: undefined }).isFinalStep?.(review.doc)).toBe('unknown');
  });

  it("reads the last step's questions in the footer, outside the step page, under their own headings", async () => {
    const fixture = await open(step4Html);
    const fields = fieldsOf(fixture);
    expect(fields.map((field) => [field.label, field.section.id])).toEqual([
      ['Are you authorized to work lawfully in the United States?', 'work-authorization'],
      ['I have read and accept the above acknowledgement', 'acknowledgement']]);
    // Undone: with the step page as the root the footer's questions are lost; with no footer sections they fall under
    // the review's last heading.
    expect(fieldsOf(fixture, without({ root: { css: '#appDetailDiv', holds: 'p.progress-header', from: 'x' } }))).toEqual([]);
    const footerless = without({ sections: PAYLOCITY_CONFIG.sections!.slice(0, 2) });
    expect(fieldsOf(fixture, footerless).map((field) => field.section.id)).not.toContain('work-authorization');
    // The review's Edit buttons and the résumé parser are never pressed.
    const never = paylocityAdapter.neverPress!(fixture.doc.documentElement);
    for (const edit of Array.from(fixture.doc.querySelectorAll('[data-automation-id$="-section"] div.button.form-button'))) {
      expect(never).toContain(edit);
    }
    expect(never).toContain(q(fixture, 'button[data-automation-id="btn-forceResume"]'));
  });
});

describe('the widgets (sourcepass-step2-eeo, sourcepass-step3-identity)', () => {
  it('declares each react-widgets DropdownList, labelled by its sibling label, so the helpers act on it', async () => {
    const fixture = await open(step2Html);
    const result = scanned(fixture);
    const gender = byId(result.fields, 'acknowledgements.eeoGender')!;
    expect([gender.kind, gender.label, gender.required]).toEqual(['combobox', 'Gender', true]);
    expect(fillabilityOf(gender, result.target(gender.key)!.widget)).toEqual({ fillable: true });
    // Undone: with no widget rule it is a lazy combobox no adapter declares (the person's); with no question rule it
    // has no label.
    const undeclared = scanned(fixture, without({ widgets: PAYLOCITY_CONFIG.widgets!.slice(1), code: undefined }));
    const plain = byId(undeclared.fields, 'acknowledgements.eeoGender')!;
    expect(fillabilityOf(plain, undeclared.target(plain.key)!.widget)).toEqual({ fillable: false, reason: 'widget-phase-4' });
    expect(byId(fieldsOf(fixture, without({ questions: undefined })), 'acknowledgements.eeoGender')?.labelSource).toBe('none');
  });

  it('sections the EEO step by its forms\' h2s, not the explanations\' h3s', async () => {
    const fixture = await open(step2Html);
    const veteran = (adapter: Adapter) => byId(fieldsOf(fixture, adapter), 'acknowledgements.militaryService')?.section.id;
    expect(veteran(paylocityAdapter)).toBe('voluntary-self-identification-of-protected-veter~e28f0f');
    expect(veteran(without({ sections: PAYLOCITY_CONFIG.sections!.slice(2) })))
      .toBe('how-do-you-know-if-you-are-a-veteran-protected-b~f136fe');
  });

  it("reads an input-select by its question span, takes several answers where it shows chips, one otherwise", async () => {
    const fixture = await open(step3Html);
    const fields = fieldsOf(fixture);
    expect(byId(fields, 'ethnicityOptions-select-wrapper')).toMatchObject({ kind: 'multiselect',
      label: 'What is your ethnic/racial identity?', description: 'Select from the provided list or add your own' });
    expect(byId(fields, 'pronounOptions-select-wrapper')).toMatchObject({ kind: 'combobox', label: 'What are your pronouns?' });
    // The single value drawn beside the emptied text box is the answer.
    q(fixture, '#pronounOptions-select-wrapper div.input-select-input-single-value').textContent = 'They/Them';
    expect(byId(fieldsOf(fixture), 'pronounOptions-select-wrapper')?.current).toEqual({ kind: 'selected', labels: ['They/Them'] });
    // Undone: with no code the chips' widget is one answer, and the single value is not read (its text box is empty);
    // with no widget rule the text box is a text field labelled by the label[for] that wraps the widget, value and all.
    const bare = fieldsOf(fixture, without({ code: undefined }));
    expect([byId(bare, 'ethnicityOptions-select-wrapper')?.kind, byId(bare, 'pronounOptions-select-wrapper')?.current])
      .toEqual(['combobox', { kind: 'empty' }]);
    const noWidget = fieldsOf(fixture, without({ widgets: PAYLOCITY_CONFIG.widgets!.slice(0, 1), code: undefined }));
    expect(byId(noWidget, 'pronounOptions')).toMatchObject({ kind: 'text', labelSource: 'for',
      label: 'What are your pronouns?(optional) They/Them' });
  });
});
