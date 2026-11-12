/*
 * jr7 RBP-7 P1 (FIX7PLAN §6.12): Pinpoint on snapshot7's captures (fixtures/pinpoint/jr7-pinpointhq1-*), each panel's
 * entrance animation finished (Pinpoint's panels fade in over 1 s, as a person sees them a second after load):
 * - RBP7-20 (the adapter half): the EEO questions' react-selects that take no search draw react-select's DummyInput
 *   (input[role=combobox][aria-readonly=true][inputmode=none]); the widened widget rule declares each a combobox for the
 *   react-select bridge, its box the control, so each is a field (it was none). Whether it is fillable rests on ENGINE-7
 *   E1 item 6 (a declared react-select's DummyInput is not read-only by its aria-readonly): asserted in P2, once merged;
 * - what still holds on snapshot7 (no finding): the posting's entry, the form's root, final step and Submit, and the
 *   thanks page's sign (1 there, none before the press).
 * Golden synthetic profile only; no value of the owner's.
 */
import { afterEach, describe, expect, it } from 'vitest';
import pForm from '../../../fixtures/pinpoint/jr7-pinpointhq1-form.html?raw';
import pPosting from '../../../fixtures/pinpoint/jr7-pinpointhq1-posting.html?raw';
import pThanks from '../../../fixtures/pinpoint/jr7-pinpointhq1-thanks.html?raw';
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
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
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
