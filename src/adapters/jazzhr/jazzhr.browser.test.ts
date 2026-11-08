/*
 * JazzHR's configured adapter on the owner's snapshots (fixtures/jazzhr, converted from jazzhr-1 to -4): the scan held
 * against each case's hand-written expectations, and each rule of ./config.ts held to what the page shows, every one
 * also read with the rule undone (the same page through the same config without it), which the test shows changes the
 * reading: the root (the generic adapter would take the page), the checkbox questions (two lone boxes "Yes" and "No",
 * the question lost), Submit (none, nothing final), the in-flight sign, the never-pressed controls and the posting text.
 */
import { afterEach, describe, expect, it } from 'vitest';
import invaluableExpect from '../../../fixtures/jazzhr/invaluable-form.expect.json';
import invaluableHtml from '../../../fixtures/jazzhr/invaluable-form.html?raw';
import nucleusExpect from '../../../fixtures/jazzhr/nucleussecurity-form.expect.json';
import nucleusHtml from '../../../fixtures/jazzhr/nucleussecurity-form.html?raw';
import panoptExpect from '../../../fixtures/jazzhr/panoptimization-form.expect.json';
import panoptHtml from '../../../fixtures/jazzhr/panoptimization-form.html?raw';
import wellhiveExpect from '../../../fixtures/jazzhr/wellhive-submitting.expect.json';
import wellhiveHtml from '../../../fixtures/jazzhr/wellhive-submitting.html?raw';
import syntheticExpect from '../../../fixtures/synthetic/jazzhr/index.expect.json';
import syntheticHtml from '../../../fixtures/synthetic/jazzhr/index.html?raw';
import trapHtml from '../../../fixtures/traps/01-white-on-white.html?raw';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { captchaRefusalShown, detectPause, pageChallenged, withoutSolvedCaptchaErrors } from '../../dom/pause-detect';
import { pressStep, refusalNow } from '../../content/press';
import { fill } from '../../dom/fillers';
import { verifyAfterSettle } from '../../dom/fillers/verify';
import { scan, toFieldSpec } from '../../dom/scan';
import { goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import { planFrame } from '../../core/plan/frame';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { configuredAdapter } from '../configured';
import type { AtsConfig } from '../configured/types';
import { compareWithExpectation, readExpectation, scanCase, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { JAZZHR_CONFIG, jazzhrAdapter } from './index';

const CASES = [
  { name: 'invaluable-form', html: invaluableHtml, expectation: readExpectation(invaluableExpect) },
  { name: 'nucleussecurity-form', html: nucleusHtml, expectation: readExpectation(nucleusExpect) },
  { name: 'panoptimization-form', html: panoptHtml, expectation: readExpectation(panoptExpect) },
  { name: 'wellhive-submitting', html: wellhiveHtml, expectation: readExpectation(wellhiveExpect) },
  // The e2e spec's page (fixtures/synthetic/jazzhr), written in the snapshots' shapes: read as they are.
  { name: 'synthetic', html: syntheticHtml, expectation: readExpectation(syntheticExpect) },
] as const;

/** The same config with one of its rules undone. */
function without(key: Exclude<keyof AtsConfig, 'platform' | 'snapshots' | 'parse' | 'root'>) {
  const { [key]: _undone, ...rest } = JAZZHR_CONFIG;
  return configuredAdapter(rest);
}

async function open(html: string) {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const root = jazzhrAdapter.detect(fixture.doc)!.formRoot;
  return { ...fixture, root };
}

const q = <T extends Element = HTMLElement>(doc: Document, css: string) => doc.querySelector<T>(css)!;

afterEach(() => removeFixtures(document));

describe('the JazzHR adapter: the snapshots against their expectations', () => {
  it.each(CASES)('$name: the scan matches the hand-written expectations', async ({ html, expectation }) => {
    const scanned = await scanCase(document, html, expectation.source);
    expect(scanned.adapter.id).toBe('jazzhr');
    expect(compareWithExpectation(scanned.doc, scanned.result, expectation)).toEqual([]);
  });
});

describe('the JazzHR adapter: each rule, and the page read without it', () => {
  it('takes form#form_submit_new_resume as the root, and finds none on another page or without the rule', async () => {
    for (const { html } of CASES.slice(0, 4)) {
      const page = await open(html);
      expect(page.root.matches('form#form_submit_new_resume')).toBe(true);
      expect(configuredAdapter({ ...JAZZHR_CONFIG, root: { css: 'form#elsewhere', from: 'none' } }).detect(page.doc))
        .toBeNull();
      removeFixtures(document);
    }
    const trap = await loadFixture(document, trapHtml, SNAPSHOT_VIEWPORT);
    expect(jazzhrAdapter.detect(trap.doc)).toBeNull();
  });

  it('makes each checkbox question one group titled by its label, and two lone boxes without the rule', async () => {
    const page = await open(wellhiveHtml);
    const container = q(page.doc, '#resumator-checkbox-3076695-1').closest('div.form-group');
    expect(jazzhrAdapter.groupOf?.(q(page.doc, '#resumator-checkbox-3076695-2'))).toBe(container);
    const grouped = scan(page.root, jazzhrAdapter, { platform: 'jazzhr' }).fields
      .filter((field) => field.nameAttr.startsWith('resumator-checkbox-'));
    expect(grouped.map((field) => [field.kind, field.label, field.required, Array.isArray(field.options)
      ? field.options.map((option) => option.label) : field.options])).toEqual([
      ['checkbox-group', 'Are you a US Citizen or Permanent Resident? (Note - EAD does not qualify for this position)', true,
        ['Yes', 'No']],
      ['checkbox-group', 'Are you able to work remotely from a state within the United States?', true, ['Yes', 'No']]]);
    const loose = scan(page.root, without('questions'), { platform: 'jazzhr' }).fields
      .filter((field) => field.nameAttr.startsWith('resumator-checkbox-'));
    expect(loose.map((field) => [field.kind, field.label, field.required])).toEqual([['checkbox', 'Yes', false],
      ['checkbox', 'No', false], ['checkbox', 'Yes', false], ['checkbox', 'No', false]]);
  });

  it('answers a Yes/No checkbox question as a Yes/No radio: its one box ticked, both read back (core pass Z2)', async () => {
    // Core pass Z2 of 2026-11-06 (CORE-BLOCKERS item 29): the pair is planned as the radio it asks (the core's
    // yesNoPair.ts), written as a set of its one box, and read back with the other box unticked.
    const page = await open(wellhiveHtml);
    const scanned = scan(page.root, jazzhrAdapter, { platform: 'jazzhr' });
    const field = scanned.fields.find((each) => each.label.startsWith('Are you able to work remotely'))!;
    const target = scanned.target(field.key)!;
    // Its question read as an authorization question, so the golden profile answers it (a Yes).
    const spec = toFieldSpec({ ...field, label: 'Are you legally authorized to work in the United States?' });
    const plan = planFrame({ specs: [spec], canaries: [], profile: goldenProfile(), sensitiveState: 'loaded',
      savedAnswers: [], settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW });
    const write = plan.writes.find((each) => each.key === field.key);
    expect(write?.value).toEqual({ kind: 'options', indices: [0], cleanLabels: ['Yes'] });
    const [yes, no] = target.members;
    expect(fill(target, write!.value, { adapter: jazzhrAdapter, root: page.root }))
      .toMatchObject({ wrote: true, verification: 'verified', reason: 'ok' });
    expect([yes!.checked, no!.checked]).toEqual([true, false]);
    expect(verifyAfterSettle(scanned.rescan(), field.key, write!.value)).toEqual({ verification: 'verified', reason: 'ok' });
    // The other box ticked too (by the page or the person) is not the answer: the read-back holds both boxes.
    no!.checked = true;
    expect(verifyAfterSettle(scanned.rescan(), field.key, write!.value))
      .toEqual({ verification: 'mismatch', reason: 'verify-mismatch' });
  });

  it('names the Submit link, final while it shows; none without the rule', async () => {
    const page = await open(invaluableHtml);
    const submit = q(page.doc, 'a#resumator-submit-resume');
    expect(jazzhrAdapter.submitButton?.(page.root)).toBe(submit);
    expect(jazzhrAdapter.isFinalStep?.(page.doc)).toBe('final');
    expect(jazzhrAdapter.neverPress?.(page.root)).not.toContain(submit);
    expect(without('submit').submitButton?.(page.root)).toBeNull();
    expect(without('submit').isFinalStep?.(page.doc)).toBe('unknown');
    // One page: no step machine, no Next.
    expect(jazzhrAdapter.nextButton).toBeUndefined();
  });

  it('reads "Submitting...please wait..." as the page busy, with no Submit left; not busy before', async () => {
    const before = await open(invaluableHtml);
    expect(jazzhrAdapter.isBusy?.(before.doc)).toBe(false);
    removeFixtures(document);
    const after = await open(wellhiveHtml);
    expect(after.doc.querySelector('#resumator-submit')?.textContent).toContain('Submitting...please wait...');
    expect(jazzhrAdapter.isBusy?.(after.doc)).toBe(true);
    expect(jazzhrAdapter.submitButton?.(after.root)).toBeNull();
    expect(jazzhrAdapter.isFinalStep?.(after.doc)).toBe('unknown');
    expect(without('busy').isBusy?.(after.doc)).toBe(false);
  });

  it('never presses the narrow Apply, the share links, View All Jobs, the resume switches, the cookie banner or the logo',
    async () => {
      const page = await open(invaluableHtml);
      const never = jazzhrAdapter.neverPress?.(page.root) ?? [];
      for (const css of ['#resumator-mobile-apply-button', '#resumator-mobile-share-button', '#resumator-back-button',
        '#resumator-resume-switch-paste', '#resumator-resume-switch-upload', '#resumator-choose-upload',
        '#resumator-choose-paste', '#resumator-two-stage-change-resume', '#tracking-consent-banner button.allow',
        '#tracking-consent-banner button.reject', '#resumator-logo']) {
        expect(never, css).toContain(q(page.doc, css));
      }
      expect(page.doc.querySelectorAll('a[data-test="job-board-responsive-share"]').length).toBe(2);
      expect(without('neverPress').neverPress?.(page.root)).toEqual([]);
    });

  it('reads the posting text from #job-description, none without the rule', async () => {
    const page = await open(nucleusHtml);
    expect(jazzhrAdapter.postingText?.(page.doc)).toBe(q(page.doc, '#job-description'));
    expect(without('posting').postingText?.(page.doc)).toBeNull();
    // The form is on the posting: no entry to press.
    expect(jazzhrAdapter.entryControl?.(page.doc)).toBeNull();
  });

  // The behaviour review of 2026-11-06 (M6, the owner's decision): a checkbox widget never holds the fill. v5 p1-rules
  // (PLAN decision 9, like Jobright): nor the Submit: it is pressed beside the unticked "Human Check" and JazzHR decides;
  // JazzHR's own error for it (#recaptcha-required-error, as Jobright reads it) is the check's refusal, stale once solved.
  it.each([['panoptimization-form', panoptHtml], ['invaluable-form', invaluableHtml], ['nucleussecurity-form', nucleusHtml],
  ])('%s: fills beside the reCAPTCHA "Human Check", whose solving is the '
    + 'person’s, and presses the Submit beside it: JazzHR decides', async (_name, html) => {
    const page = await open(html);
    expect(detectPause(page.doc, page.root, jazzhrAdapter)).toBeNull();
    expect(pageChallenged(page.doc)).toBe(false);
    // The person-confirmed Submit is pressed; the widget's response field is no field of the step.
    const submit = jazzhrAdapter.submitButton!(page.root)!;
    let clicks = 0;
    submit.addEventListener('click', (event) => {
      clicks += 1;
      event.preventDefault();
    });
    const press = { doc: page.doc, adapter: jazzhrAdapter, root: page.root,
      scan: () => scan(page.root, jazzhrAdapter, { platform: 'jazzhr' }) };
    expect(pressStep(press, 'submit', { confirmed: true })).toEqual({ outcome: 'pressed' });
    expect(clicks).toBe(1);
    expect(scan(page.root, jazzhrAdapter, { platform: 'jazzhr' }).fields
      .some((field) => field.label.includes('recaptcha') || field.nameAttr === 'g-recaptcha-response')).toBe(false);
    // JazzHR refuses it with its own error beside the widget (Jobright 1.25.2's reading; not in a snapshot): an error of
    // the form, read as the check's refusal.
    const error = page.doc.createElement('div');
    error.id = 'recaptcha-required-error';
    error.className = 'dv_error';
    error.textContent = 'Please complete the reCAPTCHA.';
    q(page.doc, '#resumator-recaptcha-field').append(error);
    expect(refusalNow(press)).toBe(1);
    expect(captchaRefusalShown(page.doc, page.root, jazzhrAdapter, { afterPress: false })).toBe(true);
    // Once the person solved it (its token in the vendor's field), that error is stale: no refusal, no field's error.
    q<HTMLTextAreaElement>(page.doc, 'textarea[name="g-recaptcha-response"]').value = '03AFcWeA-token';
    expect(captchaRefusalShown(page.doc, page.root, jazzhrAdapter, { afterPress: true })).toBe(false);
    expect(refusalNow(press)).toBe(0);
    expect(withoutSolvedCaptchaErrors(jazzhrAdapter.errors!(page.root), page.doc)).toEqual([]);
    expect(pressStep(press, 'submit', { confirmed: true })).toEqual({ outcome: 'pressed' });
    expect(clicks).toBe(2);
  });

  it('wellhive-submitting: the page while it sends, its widget still shown, holds no fill and (v5) no press', async () => {
    const page = await open(wellhiveHtml);
    expect(detectPause(page.doc, page.root, jazzhrAdapter)).toBeNull();
    expect(pageChallenged(page.doc)).toBe(false);
  });

  it('keeps the start date as free text: no layout is in the snapshot', async () => {
    const page = await open(nucleusHtml);
    const field = scan(page.root, jazzhrAdapter, { platform: 'jazzhr' }).fields.find((each) => each.label === 'Earliest start date?');
    expect([field?.kind, field?.constraints.format]).toEqual(['text', undefined]);
  });
});
