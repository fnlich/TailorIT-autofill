/*
 * jr7 JDEF-7, P1 (FIX7PLAN §6.15, Eightfold): the Eightfold adapter on the owner's snapshot7 capture twillio (one
 * company's PCSX career site: fixtures/eightfold/jr7-twillio-*, converted with the jr7 converter), each rule held to
 * what the page shows and read again with the rule undone:
 * - the address (EFA-2): the form and the page after submitting it share one key, the posting its own job's;
 * - each capture's root, finality, Submit and success sign (EFA-7, EFA-8, EFA-12), the never-pressed controls (EFA-7);
 * - the entry (EFA-5): the posting's Apply Now, a same-tab link to this posting's form;
 * - the fields: the résumé required by its class (EFA-11), the phone's "Country code" by its own name (EFA-V5), the
 *   radio questions by their drawn selectors and their options' words (EFA-4), the "Acknowledge" boxes described by
 *   their legends (RULES-7's EFA-10 contract), "Save my answers" left as the page chose (Q7-12's default);
 * - the hooks other packages read: notCodeBox (EFA-3, ENGINE-7 E1) and uploadPrompt (EFA-6, ENGINE-7 E2).
 * The page is read at 1920 × 1080: the capture's footer was laid out by its script for a window that wide (the audit's
 * finding), so at 1280 its Submit sits beyond the frame. P2 (after ENGINE-7 E1/E2 and RULES-7 R2) asserts the shared
 * outcomes on jr7-twillio-apply: no code pause, the radios' options, the labels' categories. Nothing here prints a page.
 */
import { afterEach, describe, expect, it } from 'vitest';
import applyHtml from '../../../fixtures/eightfold/jr7-twillio-apply.html?raw';
import apply2Html from '../../../fixtures/eightfold/jr7-twillio-apply-2.html?raw';
import postingHtml from '../../../fixtures/eightfold/jr7-twillio-posting.html?raw';
import successHtml from '../../../fixtures/eightfold/jr7-twillio-success.html?raw';
import { loadFixture, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { scan } from '../../dom/scan';
import { configProblems, configuredAdapter, configuredSuccessSigns, type AtsConfig } from '../configured';
import { ATS_CONFIGS } from '../configured/registry';
import { genericAdapter } from '../generic';
import { adaptersFor, applicationOf } from '../index';
import { wordsOf } from '../success';
import type { Adapter } from '../types';
import { EIGHTFOLD_SNAPSHOTS } from './config';
import { EIGHTFOLD_CONFIG, EIGHTFOLD_FIXTURES, eightfoldAdapter } from './index';
import { parseEightfoldUrl } from './url';

afterEach(() => removeFixtures(document));

const CAPTURES = { 'jr7-twillio-posting': postingHtml, 'jr7-twillio-apply': applyHtml, 'jr7-twillio-apply-2': apply2Html,
  'jr7-twillio-success': successHtml } as const;
type Capture = keyof typeof CAPTURES;
/** The window the capture was laid out for (see the header). */
const WIDE = { width: 1920, height: 1080 } as const;

const open = (name: Capture): Promise<Fixture> => loadFixture(document, CAPTURES[name], WIDE);
/** The address a capture was saved at (its header's source). */
const sourceOf = (name: Capture) => (JSON.parse(/<!-- TailorIT fixture[^\n]*\n(\{.*\}) -->/.exec(CAPTURES[name])![1]!) as
  { source: string }).source;
/** The adapter a config builds with some of its rules changed and some of its code hooks left out (the rule-built
 *  hook, from the changed rules, then stands). */
const variant = (change: Partial<AtsConfig>, leftOut: readonly string[] = []): Adapter => {
  const code: Record<string, unknown> = { ...EIGHTFOLD_CONFIG.code };
  for (const name of leftOut) delete code[name];
  return configuredAdapter({ ...EIGHTFOLD_CONFIG, ...change, code: code as AtsConfig['code'] });
};
const said = (el: Element | null | undefined) => (el === null || el === undefined ? null : wordsOf(el));
const fieldsOf = (doc: Document, adapter: Adapter = eightfoldAdapter) => {
  const root = adapter.detect(doc)?.formRoot;
  return root === undefined ? [] : scan(root, adapter, { platform: 'eightfold' }).fields;
};
/** The document read as served at `href` (a fixture's frame has no address of its own: about:srcdoc). */
const servedAt = (doc: Document, href: string): Document => new Proxy(doc, { get(target, property) {
  if (property === 'location') return { href };
  if (property === 'baseURI') return href;
  const value = Reflect.get(target, property, target) as unknown;
  return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
} });

describe('Eightfold (jr7 JDEF-7 P1): the adapter and its registration', () => {
  it('is registered: its config sound, its success rule in ATS_CONFIGS, its fixtures the ones it was read from', () => {
    expect(configProblems(EIGHTFOLD_CONFIG)).toEqual([]);
    expect(ATS_CONFIGS.eightfold).toBe(EIGHTFOLD_CONFIG);
    expect(EIGHTFOLD_FIXTURES).toEqual(Object.keys(CAPTURES).map((name) => `fixtures/eightfold/${name}.html`));
    expect([...EIGHTFOLD_SNAPSHOTS].sort()).toEqual(Object.keys(CAPTURES).sort());
    // EFA-V6: the form is drawn by script after the page loads.
    expect(eightfoldAdapter.quirks).toEqual({ formLateMs: 30_000 });
  });

  it('EFA-2: the form and the page after submitting it are one key; the posting (another job) its own', () => {
    const ref = (name: Capture) => applicationOf(new URL(sourceOf(name)));
    expect([ref('jr7-twillio-apply')?.page, ref('jr7-twillio-success')?.page, ref('jr7-twillio-posting')?.page])
      .toEqual(['application', 'confirmation', 'posting']);
    expect(ref('jr7-twillio-apply-2')?.applicationKey).toBe(ref('jr7-twillio-apply')?.applicationKey);
    expect(ref('jr7-twillio-success')?.applicationKey).toBe(ref('jr7-twillio-apply')?.applicationKey);
    expect(ref('jr7-twillio-posting')?.applicationKey).not.toBe(ref('jr7-twillio-apply')?.applicationKey);
    expect(ref('jr7-twillio-apply')?.platform).toBe('eightfold');
    expect(adaptersFor(new URL(sourceOf('jr7-twillio-apply')))).toEqual([eightfoldAdapter, genericAdapter]);
  });

  it('EFA-7, EFA-8, EFA-12: reads each capture: root, finality, Submit and the success sign', async () => {
    const seen: Record<Capture, [boolean, string, string | null, number]> = {
      'jr7-twillio-posting': [false, 'unknown', null, 0],
      'jr7-twillio-apply': [true, 'final', 'Submit application', 0],
      'jr7-twillio-apply-2': [true, 'final', 'Submit application', 0],
      'jr7-twillio-success': [false, 'unknown', null, 1],
    };
    for (const name of Object.keys(CAPTURES) as Capture[]) {
      const { doc } = await open(name);
      const root = eightfoldAdapter.detect(doc)?.formRoot ?? null;
      expect([root !== null, eightfoldAdapter.isFinalStep!(doc),
        root === null ? null : said(eightfoldAdapter.submitButton!(root)),
        configuredSuccessSigns(doc, EIGHTFOLD_CONFIG).length], name).toEqual(seen[name]);
      removeFixtures(document);
    }
  }, 60_000);

  it('EFA-8: the success card reads by its words\' start, beside Browse Jobs; no card, no sign', async () => {
    const { doc } = await open('jr7-twillio-success');
    const [sign] = configuredSuccessSigns(doc, EIGHTFOLD_CONFIG);
    expect(sign?.querySelector('[data-test-id="success-page-svg"]')).not.toBeNull();
    expect(wordsOf(sign!).startsWith('Thank you for your application')).toBe(true);
    expect(configuredSuccessSigns(doc, { ...EIGHTFOLD_CONFIG, success: undefined })).toEqual([]);
    doc.querySelector('[data-test-id="browse-more-jobs-button"]')!.remove();
    expect(configuredSuccessSigns(doc, EIGHTFOLD_CONFIG)).toEqual([]);
  });

  it('EFA-7: never presses Cancel, Clear form, the stepper or the privacy dialog\'s Cancel; Submit is no never-press',
    async () => {
      const { doc } = await open('jr7-twillio-apply');
      const never = eightfoldAdapter.neverPress!(doc.documentElement);
      for (const css of ['[data-test-id="cancelApplicationButton"]', '[data-test-id="clear-form-button"]',
        '[data-test-id^="step-"]', '#cancelUploadResume']) {
        const found = Array.from(doc.querySelectorAll(css));
        expect(found.length, css).toBeGreaterThan(0);
        for (const el of found) expect(never.includes(el), css).toBe(true);
      }
      expect(never).not.toContain(doc.querySelector('[data-test-id="submitApplicationButton"]'));
      expect(never).not.toContain(doc.querySelector('#confirmUploadResume'));
      expect(variant({ neverPress: [] }).neverPress!(doc.documentElement)).toEqual([]);
    });

  it('EFA-5: the posting\'s entry is its Apply Now, a same-tab link to this posting\'s form; nothing on the form', async () => {
    const { doc } = await open('jr7-twillio-posting');
    const at = sourceOf('jr7-twillio-posting');
    const served = servedAt(doc, at);
    const entry = eightfoldAdapter.entryControl!(served);
    expect(said(entry)).toBe('Apply Now');
    const target = parseEightfoldUrl(new URL(entry!.getAttribute('href')!));
    expect(target?.page).toBe('application');
    expect(target?.applicationUrl).toBe(parseEightfoldUrl(new URL(at))?.applicationUrl);
    // A link that opens a new tab, or downloads, is no entry.
    entry!.setAttribute('target', '_blank');
    expect(eightfoldAdapter.entryControl!(served)).toBeNull();
    entry!.setAttribute('target', '_self');
    entry!.setAttribute('download', '');
    expect(eightfoldAdapter.entryControl!(served)).toBeNull();
    entry!.removeAttribute('download');
    expect(eightfoldAdapter.entryControl!(served)).toBe(entry);
    // Undone: no entry at all.
    expect(variant({}, ['entryControl']).entryControl?.(served) ?? null).toBeNull();
    removeFixtures(document);
    const form = await open('jr7-twillio-apply');
    expect(eightfoldAdapter.entryControl!(servedAt(form.doc, sourceOf('jr7-twillio-apply')))).toBeNull();
  });

  it('EFA-11, EFA-V5: the résumé is required by its title\'s class; the phone\'s country code keeps its own name',
    async () => {
      const { doc } = await open('jr7-twillio-apply');
      const rows = (adapter: Adapter) => fieldsOf(doc, adapter).filter((field) => field.kind !== 'radio')
        .map((field) => [field.kind, field.required, field.label]);
      // P2 (jr7-engine-e1 item 4, EFA-3): the Phone number beside its country code is a field now, no code box.
      expect(rows(eightfoldAdapter).slice(0, 7)).toEqual([['file', true, 'Upload your resume'], ['text', true, 'Email'],
        ['text', true, 'First name'], ['text', true, 'Last name'], ['combobox', true, 'Country code'],
        ['text', true, 'Phone'], ['combobox', true, 'Country']]);
      // EFA-11 undone: the résumé's input says nothing of its own, so it reads optional.
      expect(rows(variant({ required: [] }))[0]).toEqual(['file', false, 'Upload your resume']);
      // EFA-V5 undone: the group's legend renames the country code "Phone".
      expect(rows(variant({}, ['labelFor']))[4]).toEqual(['combobox', true, 'Phone']);
    });

  it('EFA-4: the radio questions are fields by their drawn selectors, each option\'s words its selector\'s', async () => {
    const { doc } = await open('jr7-twillio-apply');
    const radios = (adapter: Adapter) => fieldsOf(doc, adapter).filter((field) => field.kind === 'radio');
    expect(radios(eightfoldAdapter).map((field) => [field.label, field.required])).toEqual([
      ['Are you legally authorized to work in the United States?', true],
      ['Will you now or in the future require sponsorship for employment visa status (e.g., H-1B visa status)?', true],
      ['Please indicate whether you are either a citizen or resident of any of the following countries: Cuba, Iran, '
        + 'North Korea, Syria or Crimea Region of Ukraine.', true],
      ['Disability Status', true], ['Voluntary Self-Identification of Gender', true],
      ['Voluntary Self-Identification of Race/Ethnicity', true], ['Protected Veteran Status', true],
      ['Voluntary Self-Identification of Sexual Orientation', true]]);
    // Undone: no selector stands for the hidden radios (their own label is aria-hidden), so none is a field.
    expect(radios(variant({ proxies: [] }))).toEqual([]);
    // Each option's words, as its selector draws them (ENGINE-7 E1 item 5 reads them; P2 asserts the options).
    const group = (name: string) => Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
      .filter((input) => (input.getAttribute('aria-label') ?? '').endsWith(name));
    expect(group('Are you legally authorized to work in the United States?')
      .map((input) => eightfoldAdapter.optionTextFor!(input))).toEqual(['No', 'Yes']);
    expect(group('Disability Status').map((input) => eightfoldAdapter.optionTextFor!(input))).toEqual([
      'Yes, I have a disability, or have had one in the past',
      'No, I do not have a disability and have not had one in the past', "I don't wish to answer"]);
    const undone = variant({}, ['optionTextFor']);
    expect(group('Disability Status').map((input) => undone.optionTextFor?.(input) ?? null)).toEqual([null, null, null]);
  });

  it('EFA-10 (RULES-7\'s contract): each Acknowledge box is described by its group\'s legend, then its help', async () => {
    const { doc } = await open('jr7-twillio-apply');
    const boxes = Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="checkbox"][aria-label="Acknowledge"]'));
    expect(boxes).toHaveLength(2);
    const legends = boxes.map((box) => doc.getElementById(box.closest('[aria-labelledby$="_legend"]')!
      .getAttribute('aria-labelledby')!)!);
    const acknowledge = (adapter: Adapter) => fieldsOf(doc, adapter).filter((field) => field.label === 'Acknowledge');
    const described = acknowledge(eightfoldAdapter);
    expect(described.map((field) => [field.kind, field.required])).toEqual([['checkbox', true], ['checkbox', true]]);
    described.forEach((field, at) => {
      expect(field.description.startsWith(wordsOf(legends[at]!).slice(0, 60)), `box ${at}`).toBe(true);
    });
    expect(described[1]!.description).toMatch(/AI/);
    // Undone: the help text alone (the policies' links), nothing of the legend.
    acknowledge(variant({}, ['descriptionFor'])).forEach((field, at) => {
      expect(field.description.includes(wordsOf(legends[at]!).slice(0, 30)), `box ${at}`).toBe(false);
    });
    // A group of several boxes is labelled by its legend already; its boxes take no legend as description.
    const several = doc.querySelector<HTMLInputElement>('input[type="checkbox"][aria-label="LinkedIn"]')!;
    expect(eightfoldAdapter.descriptionFor!(several).some((el) => el.localName === 'legend')).toBe(false);
  });

  it('Q7-12: "Save my answers for future applications" is no question of the application, even drawn for everyone',
    async () => {
      const { doc } = await open('jr7-twillio-apply');
      const box = Array.from(doc.querySelectorAll('input[type="checkbox"][aria-labelledby]'))
        .find((input) => /^Save my answers/.test(wordsOf(doc.getElementById(input.getAttribute('aria-labelledby')!)!)))!;
      // The test draws its label as one a person and the scan both read (the capture's is aria-hidden).
      doc.querySelector(`label[for="${box.id}"]`)!.removeAttribute('aria-hidden');
      const saved = (adapter: Adapter) => fieldsOf(doc, adapter).filter((field) => /^Save my answers/.test(field.label));
      expect(saved(eightfoldAdapter)).toEqual([]);
      expect(saved(variant({}, ['excluded']))).toHaveLength(1);
    });

  it('EFA-3: the form\'s own one-time-code boxes are no code boxes; one anywhere else still is', async () => {
    const { doc } = await open('jr7-twillio-apply');
    const coded = Array.from(doc.querySelectorAll<HTMLInputElement>('input[autocomplete="one-time-code"]'));
    expect(coded.map((input) => input.getAttribute('data-test-id')?.replace(/\d+/g, 'N'))).toEqual([
      'Contact_Information_phone', 'Contact_Information_city', 'Position_Specific_Questions_question_N']);
    expect(coded.map((input) => eightfoldAdapter.notCodeBox!(input))).toEqual([true, true, true]);
    // A code box the test adds: outside the form, and inside it with no question's test id.
    const outside = doc.createElement('input');
    outside.setAttribute('autocomplete', 'one-time-code');
    outside.setAttribute('data-test-id', 'Contact_Information_phone');
    doc.body.append(outside);
    const inside = doc.createElement('input');
    inside.setAttribute('autocomplete', 'one-time-code');
    eightfoldAdapter.detect(doc)!.formRoot.append(inside);
    expect([eightfoldAdapter.notCodeBox!(outside), eightfoldAdapter.notCodeBox!(inside)]).toEqual([false, false]);
    expect(variant({}, ['notCodeBox']).notCodeBox).toBeUndefined();
  });

  it('EFA-6: the Data Privacy Agreement offers its I Agree as a consent, once the page shows it; never its Cancel',
    async () => {
      const before = await open('jr7-twillio-apply');
      expect(eightfoldAdapter.uploadPrompt!(before.doc)).toBeNull();
      removeFixtures(document);
      const { doc } = await open('jr7-twillio-apply-2');
      // The capture caught the dialog opening (its panel still at opacity 0, scaled to nothing): nothing to press yet.
      expect(eightfoldAdapter.uploadPrompt!(doc)).toBeNull();
      // The test draws it open, as it stands a moment later.
      const panel = doc.querySelector<HTMLElement>('[role="dialog"] > [class*="privacyAgreementDialog-"]')!;
      expect(panel.contains(doc.querySelector('#confirmUploadResume'))).toBe(true);
      panel.style.setProperty('animation', 'none', 'important');
      panel.style.setProperty('opacity', '1', 'important');
      panel.style.setProperty('transform', 'none', 'important');
      const prompt = eightfoldAdapter.uploadPrompt!(doc);
      expect(prompt?.kind).toBe('consent');
      expect(prompt?.press).toBe(doc.querySelector('#confirmUploadResume'));
      expect(said(prompt?.press)).toBe('I Agree');
      expect(variant({}, ['uploadPrompt']).uploadPrompt).toBeUndefined();
    });

  it('reads the posting\'s text on the posting', async () => {
    const { doc } = await open('jr7-twillio-posting');
    expect(wordsOf(eightfoldAdapter.postingText!(doc)!).length).toBeGreaterThan(200);
  });
});
