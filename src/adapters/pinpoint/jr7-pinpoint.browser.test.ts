/*
 * jr7 RBP-7 P1 (FIX7PLAN §6.12): Pinpoint on snapshot7's captures (fixtures/pinpoint/jr7-pinpointhq1-*), each panel's
 * entrance animation finished (Pinpoint's panels fade in over 1 s, as a person sees them a second after load):
 * - RBP7-20 (the adapter half): the EEO questions' react-selects that take no search draw react-select's DummyInput
 *   (input[role=combobox][aria-readonly=true][inputmode=none]); the widened widget rule declares each a combobox for the
 *   react-select bridge, its box the control, so each is a field (it was none). P2: fillable, with ENGINE-7 E1 item 6 (a
 *   declared react-select's DummyInput is not read-only by its aria-readonly) merged;
 * - P2: RBP7-19 (RULES-7: the required "How did you hear about this job?" textarea takes the profile's source) and
 *   RBP7-21 (ENGINE-7 E1 item 7: a control two labels of the same words name reads them once);
 * - what still holds on snapshot7 (no finding): the posting's entry, the form's root, final step and Submit, and the
 *   thanks page's sign (1 there, none before the press).
 * Golden synthetic profile only; no value of the owner's.
 */
import { afterEach, describe, expect, it } from 'vitest';
import pForm from '../../../fixtures/pinpoint/jr7-pinpointhq1-form.html?raw';
import pPosting from '../../../fixtures/pinpoint/jr7-pinpointhq1-posting.html?raw';
import pThanks from '../../../fixtures/pinpoint/jr7-pinpointhq1-thanks.html?raw';
import pFormExpect from '../../../fixtures/pinpoint/jr7-pinpointhq1-form.expect.json';
import { sourceOf } from '../../content/apply.testkit';
import { goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import { stepButtonsOf } from '../../content/press';
import { newSuccessSign, signsOf } from '../../content/submitted';
import { planFrame } from '../../core/plan/frame';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { scan, toFieldSpec } from '../../dom/scan';
import { configuredAdapter } from '../configured';
import { applicationOf } from '../index';
import { compareWithExpectation, fillabilityOf, readExpectation, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { PINPOINT_CONFIG, pinpointAdapter } from './index';

/** The three EEO selects' DummyInputs (fieldset#diversity-and-inclusion-form). */
const EEO = ['application_form_equality_monitoring_gender', 'application_form_equality_monitoring_ethnicity_race',
  'application_form_equality_monitoring_voluntary_self_identification_of_disability'];
/** The widget rule as it was before RBP7-20: the searchable react-select's input alone. */
const BEFORE = configuredAdapter({ ...PINPOINT_CONFIG, widgets: [{ ...PINPOINT_CONFIG.widgets![0]!,
  match: 'div.react-select input.react-select__input[role="combobox"]', expanded: 'input.react-select__input' }] });

afterEach(() => removeFixtures(document));

async function open(html: string) {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  for (const animation of fixture.doc.getAnimations()) {
    try {
      animation.finish();
    } catch {
      // An endless one runs on.
    }
  }
  return { ...fixture, root: pinpointAdapter.detect(fixture.doc)?.formRoot ?? null };
}

describe('jr7 RBP-7 RBP7-20 (the adapter half): the EEO react-selects that take no search', () => {
  it('declares each DummyInput a combobox for the react-select bridge, its box the control', async () => {
    const page = await open(pForm);
    for (const id of EEO) {
      const input = page.doc.getElementById(id)!;
      expect([input.getAttribute('aria-readonly'), input.getAttribute('inputmode'),
        input.classList.contains('react-select__input')], id).toEqual(['true', 'none', false]);
      expect(pinpointAdapter.widgetFor?.(input), id).toMatchObject({ kind: 'combobox', opener: input, expanded: input,
        box: input.closest('div.react-select__control'), bridge: 'react-select' });
      expect(BEFORE.widgetFor?.(input), id).toBeNull();
    }
    // The searchable react-selects (the job preferences) are declared as before.
    const searchable = page.doc.querySelector('div.react-select input.react-select__input[role="combobox"]')!;
    expect(pinpointAdapter.widgetFor?.(searchable)).toMatchObject({ kind: 'combobox', expanded: searchable,
      bridge: 'react-select' });
  });

  it('makes each a field of its EEO question, which it was not', async () => {
    const page = await open(pForm);
    const fieldsOf = (adapter: typeof pinpointAdapter) => {
      const result = scan(page.root!, adapter, { platform: 'pinpoint' });
      return { result, eeo: EEO.map((id) => result.fields.find((field) => field.idAttr === id)) };
    };
    const now = fieldsOf(pinpointAdapter);
    expect(now.eeo.map((field) => field?.kind)).toEqual(['combobox', 'combobox', 'combobox']);
    expect(now.eeo.map((field) => field?.visibility)).toEqual(['visible', 'visible', 'visible']);
    const out = planFrame({ specs: now.result.fields.map(toFieldSpec), canaries: [], profile: goldenProfile(),
      sensitiveState: 'loaded', savedAnswers: [], settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW });
    for (const field of now.eeo) {
      expect(out.results.find((row) => row.key === field!.key)?.category, field!.label).toMatch(/^eeo\./);
    }
    expect(fieldsOf(BEFORE).eeo).toEqual([undefined, undefined, undefined]);
  });
});

describe('jr7 RBP-7: Pinpoint on snapshot7, what still holds', () => {
  it('the posting offers its Apply Now; the form is final with Submit; the thanks page is the confirmation under one key',
    async () => {
      const keys = [pPosting, pForm, pThanks].map((html) => applicationOf(new URL(sourceOf(html)!)));
      expect(keys.map((each) => each?.page)).toEqual(['posting', 'application', 'confirmation']);
      expect(new Set(keys.map((each) => each!.applicationKey)).size).toBe(1);
      const posting = await open(pPosting);
      expect(pinpointAdapter.entryControl?.(posting.doc)?.matches('#external-jobs-show-apply-now a.external-button'))
        .toBe(true);
      removeFixtures(document);
      const form = await open(pForm);
      expect(form.root?.matches('form#application-form')).toBe(true);
      expect(stepButtonsOf({ doc: form.doc, adapter: pinpointAdapter, root: form.root! }))
        .toMatchObject({ final: 'final', next: false, submit: true });
      expect(signsOf(form.doc, 'pinpoint')).toEqual([]);
    });

  it('the thanks page draws one sign, new after the press; none on the posting', async () => {
    const thanks = await open(pThanks);
    const signs = signsOf(thanks.doc, 'pinpoint');
    expect(signs.map((sign) => sign.id)).toEqual(['application-thanks']);
    const gone = thanks.doc.createElement('form');
    expect(newSuccessSign(thanks.doc, 'pinpoint', { before: new Set(), root: gone, adapter: pinpointAdapter }))
      .toBe(signs[0]);
    removeFixtures(document);
    const posting = await open(pPosting);
    expect(signsOf(posting.doc, 'pinpoint')).toEqual([]);
  });
});

// ── jr7 RBP-7 P2 (FIX7PLAN §6.12): the shared outcomes on the form, with jr7-engine-e2 and jr7-rules-r2 merged ──

describe('jr7 RBP-7 P2: pinpointhq1\'s form against its hand-written expectations', () => {
  it('the scan, its panels shown, matches fixtures/pinpoint/jr7-pinpointhq1-form.expect.json', async () => {
    const page = await open(pForm);
    const result = scan(page.root!, pinpointAdapter, { platform: 'pinpoint' });
    expect(compareWithExpectation(page.doc, result, readExpectation(pFormExpect))).toEqual([]);
  });
});

describe('jr7 RBP-7 P2: pinpointhq1\'s form', () => {
  async function planned() {
    const page = await open(pForm);
    const result = scan(page.root!, pinpointAdapter, { platform: 'pinpoint' });
    const out = planFrame({ specs: result.fields.map(toFieldSpec), canaries: [], profile: goldenProfile(),
      sensitiveState: 'loaded', savedAnswers: [], settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW });
    return { page, result, out };
  }

  it('RBP7-20 (ENGINE-7 E1 item 6): the EEO DummyInputs are fillable, each planned as its EEO question', async () => {
    const { result, out } = await planned();
    for (const id of EEO) {
      const field = result.fields.find((each) => each.idAttr === id)!;
      expect([field.readOnly, field.disabled], id).toEqual([false, false]);
      expect(fillabilityOf(field, result.target(field.key)?.widget), id).toEqual({ fillable: true });
      expect(out.results.find((row) => row.key === field.key)?.category, id).toMatch(/^eeo\./);
    }
  });

  it('RBP7-19 (RULES-7): the required "How did you hear about this job?" textarea takes the profile\'s source', async () => {
    const { result, out } = await planned();
    const field = result.fields.find((each) => each.label === 'How did you hear about this job?')!;
    expect([field.kind, field.required]).toEqual(['textarea', true]);
    expect(out.results.find((row) => row.key === field.key))
      .toMatchObject({ category: 'referral.source', status: 'verified' });
    expect(out.writes.find((each) => each.key === field.key)?.value).toEqual({ kind: 'text', text: 'LinkedIn' });
  });

  it('RBP7-21 (ENGINE-7 E1 item 7): the job preferences read "Locations" and "Job Title" once, never twice', async () => {
    const { page, result } = await planned();
    const ids = ['application_form[application][job_preferences_attributes]_location',
      'application_form[application][job_preferences_attributes]_job'];
    // The block is drawn twice with the same ids, each id named by two label[for] of the same words.
    for (const id of ids) expect(page.doc.querySelectorAll(`label[for="${id}"]`), id).toHaveLength(2);
    const labels = result.fields.filter((field) => ids.includes(field.idAttr ?? '')).map((field) => field.label);
    expect(labels.sort()).toEqual(['Job Title', 'Job Title', 'Locations', 'Locations']);
    expect(result.fields.filter((field) => /^(.+) \1$/.test(field.label))).toEqual([]);
  });
});
