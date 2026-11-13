/*
 * jr7 JDEF-7, P2 (FIX7PLAN §6.15 "P2"; after jr7-engine-e2, jr7-rules-r2, jr7-auto-done and jr7-chain-done): the
 * shared outcomes on jr7-twillio-apply (and -apply-2), the page scanned as the run scans it and planned by the real
 * planFrame with the golden synthetic profile:
 * - EFA-3 (ENGINE-7 E1 item 4 reading notCodeBox): no code pause, and the three one-time-code boxes are the form's
 *   fields (Phone, City, LinkedIn Profile URL), planned; with the hook undone, the page pauses as an emailed code;
 * - EFA-4 (E1 item 5 reading the selectors' words): every radio question's options read, and planned;
 * - EFA-10 (RULES-7 R1/R2 on the labels and descriptions the adapter gives): Gender and Sexual Orientation by their
 *   self-identification wordings, the citizen-or-resident-of-listed-countries question handed to the person (Q7-3's
 *   default: never written), the first Acknowledge box a privacy acknowledgement and the second, by its legend, the AI
 *   attestation;
 * - EFA-6 (ENGINE-7 E2 item 4, the upload-prompt door): the Data Privacy Agreement's I Agree pressed once the dialog
 *   the capture caught opening shows, where the Consents mode ticks such a box; left where it does not; its Cancel
 *   never pressed. And (after jr7-auto-r2, which carries the person's Consents mode to the run's upload prompts) a
 *   real run on the form: its own résumé upload, the dialog the site draws for it, I Agree pressed once where the
 *   worker says the mode (All), left where it says none.
 * Country code and Country stay lazy comboboxes, the person's until an open list is captured (EFA-9, gated Q7-1).
 * Nothing here prints a page.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import applyHtml from '../../../fixtures/eightfold/jr7-twillio-apply.html?raw';
import apply2Html from '../../../fixtures/eightfold/jr7-twillio-apply-2.html?raw';
import { createFakeWorker, fakePdf, GOLDEN_RESUME, goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import { startContentRuntime, type ContentRuntime } from '../../content/runtime';
import { deadline } from '../../dom/time';
import { planFrame } from '../../core/plan/frame';
import type { PlanOutput } from '../../core/plan/types';
import { classifyByRules } from '../../core/resolver/classifyRules';
import type { FieldSpec } from '../../core/types/field';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { loadFixture, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { answerUploadPrompt } from '../../dom/fillers/upload-prompt';
import { detectPause } from '../../dom/pause-detect';
import { scan, toFieldSpec } from '../../dom/scan';
import { newScanCache } from '../../dom/scan-cache';
import { configuredAdapter, type AtsConfig } from '../configured';
import { wordsOf } from '../success';
import type { Adapter } from '../types';
import { EIGHTFOLD_CONFIG, eightfoldAdapter } from './index';

const runtimes: ContentRuntime[] = [];
beforeAll(() => {
  testVocab();
});
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

/** The window the capture was laid out for (its footer's geometry). */
const WIDE = { width: 1920, height: 1080 } as const;
const open = (html: string): Promise<Fixture> => loadFixture(document, html, WIDE);
/** The adapter with some of its code hooks left out. */
const without = (...leftOut: string[]): Adapter => {
  const code: Record<string, unknown> = { ...EIGHTFOLD_CONFIG.code };
  for (const name of leftOut) delete code[name];
  return configuredAdapter({ ...EIGHTFOLD_CONFIG, code: code as AtsConfig['code'] });
};

/** The form scanned and planned as a run plans it (the golden profile, the default settings, no AI). */
function planned(doc: Document, adapter: Adapter = eightfoldAdapter) {
  const root = adapter.detect(doc)!.formRoot;
  const result = scan(root, adapter, { platform: 'eightfold' });
  const specs = result.fields.map(toFieldSpec);
  const out: PlanOutput = planFrame({ specs, canaries: [], profile: goldenProfile(), sensitiveState: 'loaded',
    savedAnswers: [], settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW });
  const one = (label: string, at = 0): FieldSpec => specs.filter((spec) => spec.label.startsWith(label))[at]!;
  const row = (spec: FieldSpec) => out.results.find((each) => each.key === spec.key)!;
  /** The value the plan writes into a field, or undefined where it writes none. */
  const write = (spec: FieldSpec) => out.writes.find((each) => each.key === spec.key)?.value as
    (Record<string, unknown> | undefined);
  return { result, specs, out, one, row, write, pause: detectPause(doc, root, adapter, newScanCache()) };
}

describe('Eightfold (jr7 JDEF-7 P2): the shared outcomes on the application', () => {
  it('EFA-3: no code pause; Phone, City and the LinkedIn question are fields, planned', async () => {
    const { doc } = await open(applyHtml);
    const page = planned(doc);
    expect(page.pause).toBeNull();
    expect(page.result.authFields).toBe(0);
    expect(['Phone', 'City', 'LinkedIn Profile URL'].map((label) => [page.one(label).kind, page.write(page.one(label))
      ?.['kind']])).toEqual([['text', 'text'], ['text', 'text'], ['text', 'text']]);
    // The phone's number alone, its country code being a control of its own (EFA-V5).
    expect(page.write(page.one('Phone'))?.['text']).toBe('512 555 0147');
    expect(page.write(page.one('City'))?.['text']).toBe('Austin');
    // Undone: the three boxes are code boxes, so the page pauses for an emailed code and none is a field.
    const undone = planned(doc, without('notCodeBox'));
    expect(undone.pause?.kind).toBe('email-code');
    expect(undone.result.authFields).toBe(3);
    expect(undone.specs.some((spec) => spec.label === 'City')).toBe(false);
  });

  it('EFA-4: every radio question\'s options read, and planned from the profile', async () => {
    const { doc } = await open(applyHtml);
    const page = planned(doc);
    const options = (spec: FieldSpec) => (Array.isArray(spec.options) ? spec.options.map((option) => option.label) : []);
    const radios = page.specs.filter((spec) => spec.kind === 'radio');
    expect(radios.map((spec) => options(spec).length)).toEqual([2, 2, 2, 3, 5, 8, 4, 4]);
    expect(options(page.one('Are you legally authorized'))).toEqual(['No', 'Yes']);
    const chosen = (label: string) => page.write(page.one(label))?.['cleanLabel'];
    expect(chosen('Are you legally authorized')).toBe('Yes');
    expect(chosen('Will you now or in the future require sponsorship')).toBe('No');
    expect(chosen('Protected Veteran Status')).toBe('I am not a protected veteran');
    for (const label of ['Disability Status', 'Voluntary Self-Identification of Gender',
      'Voluntary Self-Identification of Race/Ethnicity', 'Voluntary Self-Identification of Sexual Orientation']) {
      expect(chosen(label), label).toBe("I don't wish to answer");
    }
    // Undone: no words of the options' own (their labels are aria-hidden), so every option reads empty.
    const undone = planned(doc, without('optionTextFor'));
    expect(undone.specs.filter((spec) => spec.kind === 'radio').every((spec) => options(spec).every((label) => label === '')))
      .toBe(true);
  });

  it('EFA-10: the self-identification wordings, the listed-countries hand-over and the two Acknowledge boxes', async () => {
    const { doc } = await open(applyHtml);
    const page = planned(doc);
    expect(page.row(page.one('Voluntary Self-Identification of Gender')).category).toBe('eeo.gender');
    expect(page.row(page.one('Voluntary Self-Identification of Sexual Orientation')).category)
      .toBe('eeo.sexualOrientation');
    // Q7-3 (the owner's default): the citizen-or-resident-of-listed-countries question is the person's, never written.
    const listed = page.one('Please indicate whether you are either a citizen or resident');
    expect(classifyByRules(listed)).toMatchObject({ asks: 'workAuth.status', rule: 'label.nationality',
      needsUser: 'nationality' });
    expect(page.write(listed)).toBeUndefined();
    expect(page.row(listed)).toMatchObject({ wrote: false, needsUserAction: true });
    // The Acknowledge boxes, by their legends (the adapter's descriptionFor): privacy, then the AI attestation.
    const [privacy, attestation] = [page.one('Acknowledge', 0), page.one('Acknowledge', 1)];
    expect(classifyByRules(privacy)?.consentKinds).toContain('consent.privacy');
    expect(page.row(attestation).category).toBe('consent.aiAttestation');
    // Undone: the bare "Acknowledge" says nothing of AI, so a required box would read as a plain consent.
    const undone = planned(doc, without('descriptionFor'));
    expect(undone.row(undone.one('Acknowledge', 1)).category).not.toBe('consent.aiAttestation');
  });

  it('EFA-9 (gated Q7-1): Country code and Country are lazy lists left for the person, the rest planned', async () => {
    const { doc } = await open(applyHtml);
    const page = planned(doc);
    const named = (label: string) => page.specs.find((spec) => spec.label === label)!;
    expect(['Country code', 'Country'].map((label) => [page.row(named(label)).category,
      page.row(named(label)).reason, page.write(named(label))])).toEqual([
      ['contact.phoneCountry', 'waiting-for-options', undefined], ['address.country', 'waiting-for-options', undefined]]);
  });

  it('EFA-6: I Agree pressed once the dialog shows, where the Consents mode ticks it; else left; Cancel never', async () => {
    for (const consents of [true, false]) {
      const { doc, view } = await open(apply2Html);
      const pressed: string[] = [];
      doc.addEventListener('click', (event) => {
        pressed.push(wordsOf(event.target as Element));
        event.preventDefault();
      }, true);
      // The capture caught the dialog opening (opacity 0, scaled to nothing); it shows a moment later, as live.
      view.setTimeout(() => {
        const panel = doc.querySelector<HTMLElement>('[role="dialog"] > [class*="privacyAgreementDialog-"]')!;
        panel.style.setProperty('animation', 'none', 'important');
        panel.style.setProperty('opacity', '1', 'important');
        panel.style.setProperty('transform', 'none', 'important');
      }, 300);
      const outcome = await answerUploadPrompt(eightfoldAdapter, doc, { consents, capMs: 2_000 });
      expect(outcome, String(consents)).toBe(consents ? 'pressed' : 'left');
      expect(pressed, String(consents)).toEqual(consents ? ['I Agree'] : []);
      removeFixtures(document);
    }
  });

  it('EFA-6 in a run (jr7-auto-r2): its own résumé upload\'s I Agree pressed once under Consents All; no mode, left',
    async () => {
      /** The address the form was captured at (its header's source). */
      const source = (JSON.parse(/<!-- TailorIT fixture[^\n]*\n(\{.*\}) -->/.exec(applyHtml)![1]!) as
        { source: string }).source;
      for (const consentModes of [true, false]) {
        const { doc, view } = await open(applyHtml);
        const pressed: string[] = [];
        const backdrop = doc.querySelector<HTMLElement>('[role="dialog"]:has(> [class*="privacyAgreementDialog-"])')!;
        const panel = backdrop.querySelector<HTMLElement>(':scope > [class*="privacyAgreementDialog-"]')!;
        doc.addEventListener('click', (event) => {
          const words = wordsOf(event.target as Element);
          pressed.push(words);
          event.preventDefault();
          // As the site does: the agreement closes on either of its buttons.
          if (words === 'I Agree' || words === 'Cancel') backdrop.style.setProperty('visibility', 'hidden', 'important');
        }, true);
        // The site's own script, stood in: once the résumé's input takes a file, it draws its Data Privacy Agreement
        // (jr7-twillio-apply-2), shown a moment later.
        doc.querySelector('.upload-resume-dropzone input[type="file"]')!.addEventListener('change', () => {
          view.setTimeout(() => {
            for (const [el, opacity] of [[backdrop, '1'], [panel, '1']] as const) {
              el.style.setProperty('visibility', 'visible', 'important');
              el.style.setProperty('opacity', opacity, 'important');
              el.style.setProperty('transform', 'none', 'important');
              el.style.setProperty('animation', 'none', 'important');
            }
          }, 150);
        });
        const worker = createFakeWorker({ settings: DEFAULT_SETTINGS,
          ...(consentModes ? { consentModes: true as const } : {}),
          resume: { bytes: fakePdf(48_213), name: GOLDEN_RESUME.fileName, mime: 'application/pdf' } });
        const runtime = await startContentRuntime(worker.platform, doc, { href: () => source, isTop: true,
          adapters: () => [eightfoldAdapter], settle: { quietMs: 40 } });
        runtimes.push(runtime);
        void runtime.fill();
        if (consentModes) {
          await vi.waitFor(() => expect(pressed).toContain('I Agree'), { timeout: 20_000, interval: 100 });
          await deadline(500);
          expect(pressed.filter((words) => words === 'I Agree')).toHaveLength(1);
        } else {
          await vi.waitFor(() => expect(getComputedStyle(panel).opacity).toBe('1'), { timeout: 20_000, interval: 100 });
          await deadline(5_000);
          expect(pressed, 'no mode').not.toContain('I Agree');
        }
        expect(pressed, String(consentModes)).not.toContain('Cancel');
        for (const each of runtimes.splice(0)) each.stop();
        removeFixtures(document);
      }
    }, 90_000);
});
