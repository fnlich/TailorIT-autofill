/*
 * JazzHR's configured adapter on the owner's snapshots (fixtures/jazzhr, converted from jazzhr-1 to -4): the scan held
 * against each case's hand-written expectations, and each rule of ./config.ts held to what the page shows, every one
 * also read with the rule undone (the same page through the same config without it), which the test shows changes the
 * reading: the root (the generic adapter would take the page), the checkbox questions (two lone boxes "Yes" and "No",
 * the question lost), Submit (none, nothing final), the in-flight sign, the never-pressed controls and the posting text.
 * jr6 (FIXPLAN 6.8): the classic "resumator" layout (fixtures/jazzhr/jr6-centroid-form, the owner's 2026-11-10 capture,
 * and its hand-written twin fixtures/synthetic/jazzhr/classic.html with JazzHR's résumé toggle), each new rule likewise
 * read with it undone: the classic questions (JZ-1, JZ-5), the paste box excluded (JZ-5), Submit whatever its tag
 * (JZ-2), the résumé's upload rule and its reveal (JZ-4, the declaration: ENGINE's reveal door presses it, P2 measures
 * the upload), and the field errors on both layouts (JZ-10).
 */
import { afterEach, describe, expect, it } from 'vitest';
import centroidExpect from '../../../fixtures/jazzhr/jr6-centroid-form.expect.json';
import centroidHtml from '../../../fixtures/jazzhr/jr6-centroid-form.html?raw';
import invaluableExpect from '../../../fixtures/jazzhr/invaluable-form.expect.json';
import invaluableHtml from '../../../fixtures/jazzhr/invaluable-form.html?raw';
import nucleusExpect from '../../../fixtures/jazzhr/nucleussecurity-form.expect.json';
import nucleusHtml from '../../../fixtures/jazzhr/nucleussecurity-form.html?raw';
import panoptExpect from '../../../fixtures/jazzhr/panoptimization-form.expect.json';
import panoptHtml from '../../../fixtures/jazzhr/panoptimization-form.html?raw';
import wellhiveExpect from '../../../fixtures/jazzhr/wellhive-submitting.expect.json';
import wellhiveHtml from '../../../fixtures/jazzhr/wellhive-submitting.html?raw';
import classicExpect from '../../../fixtures/synthetic/jazzhr/classic.expect.json';
import classicHtml from '../../../fixtures/synthetic/jazzhr/classic.html?raw';
import syntheticExpect from '../../../fixtures/synthetic/jazzhr/index.expect.json';
import syntheticHtml from '../../../fixtures/synthetic/jazzhr/index.html?raw';
import trapHtml from '../../../fixtures/traps/01-white-on-white.html?raw';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { captchaRefusalShown, detectPause, isCaptchaError, pageChallenged, withoutSolvedCaptchaErrors }
  from '../../dom/pause-detect';
import { assertNotSubmit } from '../../dom/fillers/not-submit';
import { pressStep, refusalNow } from '../../content/press';
import { fill } from '../../dom/fillers';
import { verifyAfterSettle } from '../../dom/fillers/verify';
import { isUserVisible } from '../../dom/visibility';
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
  // jr6: the classic layout (the owner's 2026-11-10 capture) and its hand-written twin.
  { name: 'jr6-centroid-form', html: centroidHtml, expectation: readExpectation(centroidExpect) },
  { name: 'synthetic classic', html: classicHtml, expectation: readExpectation(classicExpect) },
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

/** The adapter with JazzHR's classic question rule undone (the Bootstrap checkbox rule kept). */
const classicRuleUndone = () => configuredAdapter({ ...JAZZHR_CONFIG, questions: JAZZHR_CONFIG.questions!.slice(0, 1) });

/** The fields whose own controls hold `el` or sit inside it, as the validation's fix pass maps a page's error to the
 *  field it is on (content/orchestrator.ts fixable). */
function fieldsOfError(page: { root: Element }, el: Element) {
  const scanned = scan(page.root, jazzhrAdapter, { platform: 'jazzhr' });
  return scanned.fields.filter((field) => {
    const target = scanned.target(field.key);
    if (target === null) return false;
    const own = [target.control, ...target.members, ...(target.proxy === null ? [] : [target.proxy])];
    return own.some((each) => each === el || each.contains(el) || el.contains(each));
  }).map((field) => field.idAttr);
}

describe('jr6 (FIXPLAN 6.8): JazzHR’s classic layout, each rule and the page read without it', () => {
  it('JZ-1, JZ-5: reads each classic question by its div.resumator-label, its star the required mark; none without the rule',
    async () => {
      const page = await open(centroidHtml);
      const read = (adapter: typeof jazzhrAdapter) => scan(page.root, adapter, { platform: 'jazzhr' }).fields
        .filter((field) => field.kind === 'text').map((field) => [field.idAttr, field.label, field.required, field.labelSource]);
      expect(read(jazzhrAdapter)).toEqual([
        ['resumator-firstname-value', 'First name', true, 'adapter'],
        ['resumator-lastname-value', 'Last name', true, 'adapter'],
        ['resumator-email-value', 'Email address', true, 'adapter'],
        // The Location wrapper stays out of the rule: its four boxes keep their placeholders.
        ['resumator-address-value', 'Address', false, 'placeholder'],
        ['resumator-city-value', 'City', false, 'placeholder'],
        ['resumator-state-value', 'State', false, 'placeholder'],
        ['resumator-postal-value', 'Postal', false, 'placeholder'],
        ['resumator-phone-value', 'Phone number', true, 'adapter'],
      ]);
      // The golden profile writes the four identity boxes; without the rule they have no label and are left.
      const plan = (adapter: typeof jazzhrAdapter) => {
        const fields = scan(page.root, adapter, { platform: 'jazzhr' }).fields;
        const out = planFrame({ specs: fields.map(toFieldSpec), canaries: [], profile: goldenProfile(),
          sensitiveState: 'loaded', savedAnswers: [], settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false,
          now: NOW });
        return ['resumator-firstname-value', 'resumator-lastname-value', 'resumator-email-value', 'resumator-phone-value']
          .map((id) => {
            const key = fields.find((field) => field.idAttr === id)?.key;
            const write = out.writes.find((each) => each.key === key);
            return write === undefined ? out.results.find((each) => each.key === key)?.reason : write.value.kind;
          });
      };
      expect(plan(jazzhrAdapter)).toEqual(['text', 'text', 'text', 'text']);
      expect(plan(classicRuleUndone())).toEqual(['no-visible-label', 'no-visible-label', 'no-visible-label',
        'no-visible-label']);
      expect(read(classicRuleUndone()).filter(([, , required]) => required)).toEqual([]);
    });

  it('JZ-5: never reads “Paste resume”’s box as a question, even once shown; without the rule the classic one is “Resume”',
    async () => {
      for (const html of [centroidHtml, invaluableHtml]) {
        const page = await open(html);
        q(page.doc, '#resumator-resume-paste-wrapper').classList.remove('none');
        const box = (adapter: typeof jazzhrAdapter) => scan(page.root, adapter, { platform: 'jazzhr' }).fields
          .find((field) => field.idAttr === 'resumator-resumetext-value');
        expect(box(jazzhrAdapter)).toBeUndefined();
        expect(box(without('excluded'))).toBeDefined();
        if (html === centroidHtml) {
          expect([box(without('excluded'))?.label, box(without('excluded'))?.required]).toEqual(['Resume', true]);
        }
        removeFixtures(document);
      }
    });

  it('JZ-2: names the classic Submit, an input[type=button], final while it shows; none with the link-only selector',
    async () => {
      const page = await open(centroidHtml);
      const submit = q<HTMLInputElement>(page.doc, 'input#resumator-submit-resume');
      expect(submit.type).toBe('button');
      expect(jazzhrAdapter.submitButton?.(page.root)).toBe(submit);
      expect(jazzhrAdapter.isFinalStep?.(page.doc)).toBe('final');
      expect(jazzhrAdapter.isBusy?.(page.doc)).toBe(false);
      expect(jazzhrAdapter.neverPress?.(page.root)).not.toContain(submit);
      const linkOnly = configuredAdapter({ ...JAZZHR_CONFIG,
        submit: { css: 'form#form_submit_new_resume a#resumator-submit-resume', from: 'before jr6' } });
      expect(linkOnly.submitButton?.(page.root)).toBeNull();
      expect(linkOnly.isFinalStep?.(page.doc)).toBe('unknown');
      // The panel's Submit (and Submit mode Auto) presses it, with the person's word.
      let clicks = 0;
      submit.addEventListener('click', () => {
        clicks += 1;
      });
      const press = { doc: page.doc, adapter: jazzhrAdapter, root: page.root,
        scan: () => scan(page.root, jazzhrAdapter, { platform: 'jazzhr' }) };
      expect(pressStep(press, 'submit', { confirmed: true })).toEqual({ outcome: 'pressed' });
      expect(clicks).toBe(1);
      // Jobright 1.25.2's second id for it names the same Submit; none outside the form.
      submit.id = 'resumator-submit-resume-button';
      expect(jazzhrAdapter.submitButton?.(page.root)).toBe(submit);
      page.doc.body.append(submit);
      expect(jazzhrAdapter.submitButton?.(page.root)).toBeNull();
    });

  it('JZ-4: declares the hidden résumé input, “Attach resume” its control and its reveal, never pressed by another path',
    async () => {
      const page = await open(centroidHtml);
      const input = q<HTMLInputElement>(page.doc, '#resumator-resume-value');
      const attach = q(page.doc, 'a#resumator-choose-upload');
      expect(page.view.getComputedStyle(q(page.doc, '#resumator-resume-upload-wrapper')).display).toBe('none');
      expect(jazzhrAdapter.uploadWidgets?.(page.root)).toEqual([{ control: attach, input }]);
      const scanned = scan(page.root, jazzhrAdapter, { platform: 'jazzhr' });
      const resume = scanned.fields.find((field) => field.kind === 'file')!;
      expect([resume.label, resume.required, resume.visibility]).toEqual(['Resume', true, 'hidden-file-with-visible-control']);
      expect(scanned.target(resume.key)?.proxy).toBe(attach);
      // The rule's reveal (ENGINE's door reads it): the link shown inside the rule's area while the input is hidden.
      const rule = JAZZHR_CONFIG.uploads![0]!;
      expect([rule.input, rule.area, rule.reveal]).toEqual(['#resumator-resume-value', '#resumator-resume',
        '#resumator-choose-upload']);
      const area = input.closest(rule.area!)!;
      expect(area.querySelector(rule.reveal!)).toBe(attach);
      expect([isUserVisible(attach), isUserVisible(input)]).toEqual([true, false]);
      // Every other path refuses it: it stays among the never-pressed controls.
      expect(jazzhrAdapter.neverPress?.(page.root)).toContain(attach);
      expect(assertNotSubmit(attach, { adapter: jazzhrAdapter, root: page.root }))
        .toEqual({ ok: false, refusal: 'adapter-never-press' });
      // Without the rule: no Resume field, and no flagged row either.
      const undone = scan(page.root, without('uploads'), { platform: 'jazzhr' });
      expect(undone.fields.some((field) => field.kind === 'file')).toBe(false);
      expect(undone.unrecognisedUploads).toEqual([]);
      removeFixtures(document);
      // The Bootstrap layout shows its input: read by its label[for] as before; its reveal is not shown (nothing to
      // press there).
      const bootstrap = await open(invaluableHtml);
      const shownInput = q<HTMLInputElement>(bootstrap.doc, '#resumator-resume-value');
      const field = scan(bootstrap.root, jazzhrAdapter, { platform: 'jazzhr' }).fields.find((each) => each.kind === 'file')!;
      expect([field.label, field.labelSource, field.visibility]).toEqual(['Resume', 'for', 'visible']);
      expect([isUserVisible(shownInput), isUserVisible(q(bootstrap.doc, rule.reveal!))]).toEqual([true, false]);
    });

  it('JZ-4: on the synthetic classic page, JazzHR’s toggle shows the input on “Attach resume” and cancels the link',
    async () => {
      const page = await open(classicHtml);
      const attach = q<HTMLAnchorElement>(page.doc, 'a#resumator-choose-upload');
      const input = q<HTMLInputElement>(page.doc, '#resumator-resume-value');
      const fileField = () => scan(page.root, jazzhrAdapter, { platform: 'jazzhr' }).fields
        .find((field) => field.kind === 'file');
      expect([fileField()?.label, fileField()?.required, fileField()?.visibility])
        .toEqual(['Resume', true, 'hidden-file-with-visible-control']);
      const address = page.view.location.href;
      let prevented: boolean | null = null;
      page.view.addEventListener('click', (event) => {
        prevented = event.defaultPrevented;
      });
      // An untrusted click, as ENGINE's reveal door makes it (FIXPLAN 6.2 item 9); the page's own handler answers it.
      attach.click();
      expect(prevented).toBe(true);
      expect(page.view.location.href).toBe(address);
      expect((page.view as unknown as { __jazz: { toggled: string[]; pressed: string[] } }).__jazz)
        .toMatchObject({ toggled: ['resumator-choose-upload'], pressed: [] });
      expect([isUserVisible(input), isUserVisible(attach)]).toEqual([true, false]);
      expect([fileField()?.label, fileField()?.required, fileField()?.visibility]).toEqual(['Resume', true, 'visible']);
      // No other path presses it.
      expect(assertNotSubmit(attach, { adapter: jazzhrAdapter, root: page.root }))
        .toEqual({ ok: false, refusal: 'adapter-never-press' });
    });
});

describe('jr6 (FIXPLAN 6.8) JZ-12, JZ-13: the classic layout’s posting text and its never-pressed controls', () => {
  it('JZ-12: reads the classic posting text from #resumator-job-description; none with the Bootstrap selector alone',
    async () => {
      const page = await open(centroidHtml);
      const description = q(page.doc, 'div#resumator-job-description');
      expect(jazzhrAdapter.postingText?.(page.doc)).toBe(description);
      // The converted page holds synthetic text there (fixtures/synthetic/jazzhr/centroid-posting-description.txt).
      expect(description.textContent).toContain('synthetic text standing in for the posting');
      const bootstrapOnly = configuredAdapter({ ...JAZZHR_CONFIG, posting: { text: '#job-description', from: 'before jr6' } });
      expect(bootstrapOnly.postingText?.(page.doc)).toBeNull();
      expect(jazzhrAdapter.entryControl?.(page.doc)).toBeNull();
    });

  it('JZ-13: never presses Cancel or anything of “Apply with Indeed”; both pressable without the rule, Submit still is',
    async () => {
      for (const [html, cancelShown] of [[centroidHtml, false], [classicHtml, true]] as const) {
        const page = await open(html);
        const cancel = q<HTMLInputElement>(page.doc, 'input#resumator-cancel-resume');
        const indeed = q(page.doc, '#resumator-apply-with-indeed-wrapper');
        // The widget Indeed's script draws inside its wrapper (the capture keeps the empty span): a link of its own.
        const widget = page.doc.createElement('a');
        widget.href = '#indeed-apply';
        widget.textContent = 'Apply with Indeed';
        indeed.querySelector('span.indeed-apply-widget')!.replaceChildren(widget);
        expect(isUserVisible(cancel)).toBe(cancelShown);
        const never = jazzhrAdapter.neverPress?.(page.root) ?? [];
        expect(never).toContain(cancel);
        expect(never).toContain(indeed);
        const ctx = { adapter: jazzhrAdapter, root: page.root };
        expect(assertNotSubmit(cancel, ctx)).toEqual({ ok: false, refusal: 'adapter-never-press' });
        expect(assertNotSubmit(widget, ctx)).toMatchObject({ ok: false });
        // Without the two entries Cancel is a plain button to the guard.
        const before = configuredAdapter({ ...JAZZHR_CONFIG, neverPress: JAZZHR_CONFIG.neverPress!
          .filter((rule) => !['#resumator-cancel-resume', '#resumator-apply-with-indeed-wrapper'].includes(rule.css)) });
        expect(before.neverPress?.(page.root)).not.toContain(cancel);
        expect(assertNotSubmit(cancel, { adapter: before, root: page.root })).toEqual({ ok: true });
        const submit = jazzhrAdapter.submitButton?.(page.root);
        expect(submit?.id).toBe('resumator-submit-resume');
        expect(never).not.toContain(submit);
        removeFixtures(document);
      }
    });
});

describe('jr6 (FIXPLAN 6.8) JZ-10: JazzHR’s field errors, on both layouts', () => {
  it.each([['the classic layout', centroidHtml], ['the Bootstrap layout', invaluableHtml],
    ['the synthetic classic page', classicHtml]] as const)(
    '%s: a label marked .resumator_label_error is its question’s error, mapped to its field', async (_name, html) => {
      const page = await open(html);
      const press = { doc: page.doc, adapter: jazzhrAdapter, root: page.root };
      expect(jazzhrAdapter.errors!(page.root)).toEqual([]);
      expect(refusalNow(press)).toBe(0);
      const label = q(page.doc, '#resumator-firstname-label');
      label.classList.add('resumator_label_error');
      const question = label.closest('div.form-group, div.resumator-field-wrapper')!;
      expect(question.contains(q(page.doc, '#resumator-firstname-value'))).toBe(true);
      expect(jazzhrAdapter.errors!(page.root)).toEqual([{ el: question }]);
      // The press's refusal counts it, and the fix pass maps it to the field it is on.
      expect(refusalNow(press)).toBe(1);
      expect(fieldsOfError(page, question)).toEqual(['resumator-firstname-value']);
      expect(isCaptchaError(question)).toBe(false);
      // Undone (the rules' errors alone): the mark is not read.
      expect(without('code').errors!(page.root)).toEqual([]);
      // A mark a person cannot see is no error.
      label.style.display = 'none';
      expect(jazzhrAdapter.errors!(page.root)).toEqual([]);
    });

  it('the classic Human Check marked is the check’s error (its wrapper), beside #recaptcha-required-error, once each',
    async () => {
      const page = await open(centroidHtml);
      q(page.doc, '#resumator-recaptcha-label').classList.add('resumator_label_error');
      const wrapper = q(page.doc, '#resumator-recaptcha');
      expect(jazzhrAdapter.errors!(page.root)).toEqual([{ el: wrapper }]);
      expect(isCaptchaError(wrapper)).toBe(true);
      const error = page.doc.createElement('div');
      error.id = 'recaptcha-required-error';
      error.className = 'dv_error';
      error.textContent = 'Please complete the reCAPTCHA.';
      q(page.doc, '#resumator-recaptcha-field').append(error);
      expect(jazzhrAdapter.errors!(page.root)).toEqual([{ el: error }, { el: wrapper }]);
      // Two marks on one question are one error.
      q(page.doc, '#resumator-recaptcha-field').classList.add('resumator_label_error');
      expect(jazzhrAdapter.errors!(page.root)).toHaveLength(2);
    });
});
