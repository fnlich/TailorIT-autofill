/*
 * jr6 JOBVITE (FIXPLAN §6.7, P1): the Jobvite adapter on the owner's snapshot6 captures of 2026-11-10 (jobvite1 = Vista
 * Higher Learning, jobvite2 = Sikich; fixtures/jobvite/jr6-*, converted with the jr6 converter), written from the jr6
 * auditor's print harness (SP\jr6\audit\jobvite.md §3) as asserts. P1 holds what the adapter reads and what its own
 * jr6 rules do:
 * - every jr6 page: its address, adapter, root, entry, step, finality, Next, Send Application, uploads, success sign,
 *   and the fields the scan reads (label, kind, required, section), hand-checked against each page;
 * - the fixtures hold no answer (JV-10, jobvite-new-4: no chosen mark, every choice group's rows alike, no AngularJS
 *   state class) and the synthetic texts the conversion gave them (jobvite-new-2);
 * - JV-18: the resume first and Jobvite's parse waited for (quirks.resumeParse, the resume row's spinner a busy sign);
 * - JV-23: a step signed by its ng-form alone, so Jobvite's "invalid fields only" view is the same step;
 * - JV-24: the page after Send Application read by its success sign;
 * - the label RULES' JV-9 rule reads on the consent gate's residence select (FIXPLAN §3.2), and the postings' Apply.
 * The outcomes that need ENGINE's E1 to E3 or RULES' rules (FIXPLAN §6.7 "P2 asserts") are P2's and are added here
 * then. Plans and runs use the golden synthetic profile; the fixtures hold none of the owner's values.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import sikichConfirmationHtml from '../../../fixtures/jobvite/jr6-sikich-confirmation.html?raw';
import sikichPostingHtml from '../../../fixtures/jobvite/jr6-sikich-posting.html?raw';
import sikichStep1InvalidHtml from '../../../fixtures/jobvite/jr6-sikich-step1-invalid.html?raw';
import sikichStep1ResumeHtml from '../../../fixtures/jobvite/jr6-sikich-step1-resume.html?raw';
import sikichStep1Html from '../../../fixtures/jobvite/jr6-sikich-step1.html?raw';
import sikichStep2Html from '../../../fixtures/jobvite/jr6-sikich-step2.html?raw';
import sikichStep3FilledHtml from '../../../fixtures/jobvite/jr6-sikich-step3-filled.html?raw';
import sikichStep3Html from '../../../fixtures/jobvite/jr6-sikich-step3.html?raw';
import vhlConfirmationHtml from '../../../fixtures/jobvite/jr6-vhl-confirmation.html?raw';
import vhlPostingHtml from '../../../fixtures/jobvite/jr6-vhl-posting.html?raw';
import vhlStep1FilledHtml from '../../../fixtures/jobvite/jr6-vhl-step1-filled.html?raw';
import vhlStep1Html from '../../../fixtures/jobvite/jr6-vhl-step1.html?raw';
import vhlStep2FilledHtml from '../../../fixtures/jobvite/jr6-vhl-step2-filled.html?raw';
import vhlStep2Html from '../../../fixtures/jobvite/jr6-vhl-step2.html?raw';
import vhlStep3FilledHtml from '../../../fixtures/jobvite/jr6-vhl-step3-filled.html?raw';
import ninjaConsentEmptyHtml from '../../../fixtures/jobvite/ninjaone-consent-empty.html?raw';
import ninjaPostingHtml from '../../../fixtures/jobvite/ninjaone-posting.html?raw';
import ninjaStep1ResumeHtml from '../../../fixtures/jobvite/ninjaone-step1-resume.html?raw';
import ninjaStep2Html from '../../../fixtures/jobvite/ninjaone-step2.html?raw';
import ninjaStep3Html from '../../../fixtures/jobvite/ninjaone-step3.html?raw';
import countyList from '../../../fixtures/synthetic/jobvite/jr6-county-list.txt?raw';
import postingDescription from '../../../fixtures/synthetic/jobvite/jr6-posting-description.txt?raw';
import qualificationOption from '../../../fixtures/synthetic/jobvite/jr6-qualification-option.txt?raw';
import { createFakeWorker, fakePdf, GOLDEN_RESUME, goldenProfile, testVocab } from '../../content/content.testkit';
import { pressEntry } from '../../content/press';
import { startContentRuntime, type ContentRuntime } from '../../content/runtime';
import { shownSignsOf, signsOf, successShown } from '../../content/submitted';
import { stepSignature as hashSignature } from '../../core/steps/signature';
import type { FillResult } from '../../core/types/fill';
import { loadFixture, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { awaitResumeParse } from '../../dom/resume-parse';
import { scan } from '../../dom/scan';
import { busySigns } from '../../dom/settle';
import { configProblems, configuredAdapter, configuredSuccessSigns, type AtsConfig } from '../configured';
import { adaptersFor } from '../index';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import type { Adapter } from '../types';
import { JOBVITE_JR6_SNAPSHOTS } from './config';
import { JOBVITE_CONFIG, jobviteAdapter } from './index';
import { parseJobviteUrl } from './url';

const runtimes: ContentRuntime[] = [];
beforeAll(() => {
  testVocab();
});
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

const load = (html: string): Promise<Fixture> => loadFixture(document, html, SNAPSHOT_VIEWPORT);
const words = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
/** The adapter a config builds with one of its rules changed. */
const without = (change: Partial<AtsConfig>): Adapter => configuredAdapter({ ...JOBVITE_CONFIG, ...change });
const lines = (text: string) => text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');

const VHL = 'https://jobs.jobvite.com/vistahigherlearning-careers/job/oEHwAfwb';
const SIKICH = 'https://jobs.jobvite.com/sikichcareers/job/oEB1AfwA';

/** A field as the scan reads it: kind, required, the label's start (the page's words), section id. */
type Row = readonly [kind: string, required: boolean, label: string, section: string];

const PI = 'personal-information';
const EEO = 'equal-opportunity';
const VET = 'pre-employment-request-for-veteran-classificatio~be3250';
/** VHL's step 1 (jr6-vhl-step1, and the same with Jobright's fill, jr6-vhl-step1-filled). */
const VHL_STEP1: readonly Row[] = [
  ['text', true, 'First Name', PI], ['text', true, 'Last Name', PI], ['text', false, 'Preferred Name', PI],
  ['text', true, 'Email', PI], ['text', true, 'Phone', PI], ['text', true, 'Physical Address', PI],
  ['text', false, 'Address (apt/suite)', PI], ['text', true, 'City', PI], ['select', true, 'State', PI],
  ['text', true, 'Zip Code', PI], ['textarea', false, 'Mailing Address, if different from above', PI],
  ['text', false, 'Referral Name', PI], ['text', false, 'Desired Salary', PI],
  ['select', true, 'Highest Education Attained', PI],
  ['select', true, 'Have you worked for VHL in any capacity previously?', 'pre-employment-questions'],
  ['select', true, 'Have you been employed by any United States K-12 School District', 'pre-employment-questions'],
  ['select', true, 'Citizen/Employment Status', 'pre-employment-questions'],
  ['select', true, 'Do you now or will you at any time in the future require', 'pre-employment-questions'],
  ['file', true, 'Add Resume', 'add-resume'], ['file', false, 'Add Cover Letter', 'additional-files'],
];
/** The Voluntary Self Identification step: its EEO block and its veteran block, each closed by the signature pair. */
const eeoStep = (required: boolean): readonly Row[] => [
  ['radio', required, 'Gender', EEO], ['radio', required, 'Are you Hispanic or Latino', EEO],
  ['radio', required, 'If no, what race do you most closely associate with?', EEO],
  ['text', true, 'Your Name signature', EEO], ['date', true, "Today's Date signature", EEO],
  ['radio', required, 'Choose One', VET], ['text', true, 'Your Name signature', VET],
  ['date', true, "Today's Date signature", VET],
];
const MIN = 'minimum-required-skills-and-experience';
const VHL_STEP3: readonly Row[] = [
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n): Row => ['radio', true, `Question ${n}: Do you `, MIN]),
  ['checkbox-group', true, 'Please select the education, skills and/or experience', 'preferred-skills-and-experience'],
  ['radio', true, 'Question 9: Do you currently reside in a state', 'location-and-travel'],
  ['radio', true, 'Question 10: If within commutable distance to', 'location-and-travel'],
];
const SIKICH_STEP1: readonly Row[] = [
  ['text', true, 'First Name', PI], ['text', true, 'Preferred First Name', PI], ['text', true, 'Last Name', PI],
  ['text', true, 'Email Address', PI], ['text', true, 'Phone', PI], ['text', true, 'Address', PI],
  ['text', true, 'City', PI], ['select', true, 'State', PI], ['text', true, 'Zip Code/Postal Code', PI],
  ['select', true, 'County of Residence', PI], ['select', true, 'Country', PI], ['select', true, 'Sms Consent', PI],
  ['file', true, 'Add Resume', 'add-resume'], ['file', false, 'Add Cover Letter', 'additional-files'],
];
const SIKICH_STEP3: readonly Row[] = [
  ['radio', true, 'Are you over 18 years of age?', 'section'],
  ['radio', true, 'Are you authorized to work for any employer in the United States?', 'section'],
  ['radio', true, 'Will you now or in the future require sponsorship', 'section'],
  ['radio', true, 'Are you currently subject to a non-compete', 'section'],
  ['radio', true, 'If yes, do the terms of the agreement restrict you', 'section'],
  ['radio', true, 'Have you previously worked for Sikich?', 'section'],
  ['date', false, 'If yes, when did you leave?', 'section'],
];

/** What a jr6 page shows the adapter (the harness's lines per page), hand-checked against each page. */
interface Page {
  name: (typeof JOBVITE_JR6_SNAPSHOTS)[number];
  html: string;
  address: string;
  page: 'posting' | 'application' | 'confirmation';
  /** The step's ng-form, or null where no application form shows. */
  step: string | null;
  final?: 'final' | 'not-final';
  /** Each upload's input and whether the page holds a file for it. */
  uploads?: ReadonlyArray<readonly [input: string, held: boolean]>;
  fields?: readonly Row[];
  /** The success sign's words, on the page after Send Application. */
  success?: string;
}

const NONE_HELD = [['file-input-0', false], ['file-input-1', false]] as const;
const RESUME_HELD = [['file-input-0', true], ['file-input-1', false]] as const;
const PAGES: Page[] = [
  { name: 'jr6-vhl-posting', html: vhlPostingHtml, address: VHL, page: 'posting', step: null },
  { name: 'jr6-vhl-step1', html: vhlStep1Html, address: `${VHL}/apply`, page: 'application', step: 'scopeData.step1',
    final: 'not-final', uploads: NONE_HELD, fields: VHL_STEP1 },
  { name: 'jr6-vhl-step1-filled', html: vhlStep1FilledHtml, address: `${VHL}/apply`, page: 'application',
    step: 'scopeData.step1', final: 'not-final', uploads: RESUME_HELD, fields: VHL_STEP1 },
  { name: 'jr6-vhl-step2', html: vhlStep2Html, address: `${VHL}/apply`, page: 'application', step: 'scopeData.step2',
    final: 'not-final', fields: eeoStep(false) },
  { name: 'jr6-vhl-step2-filled', html: vhlStep2FilledHtml, address: `${VHL}/apply`, page: 'application',
    step: 'scopeData.step2', final: 'not-final', fields: eeoStep(false) },
  { name: 'jr6-vhl-step3-filled', html: vhlStep3FilledHtml, address: `${VHL}/apply`, page: 'application',
    step: 'scopeData.step3', final: 'final', fields: VHL_STEP3 },
  { name: 'jr6-vhl-confirmation', html: vhlConfirmationHtml, address: `${VHL}/applyConfirmation`, page: 'confirmation',
    step: null, success: 'Application Sent!' },
  { name: 'jr6-sikich-posting', html: sikichPostingHtml, address: SIKICH, page: 'posting', step: null },
  { name: 'jr6-sikich-step1', html: sikichStep1Html, address: `${SIKICH}/apply`, page: 'application',
    step: 'scopeData.step1', final: 'not-final', uploads: NONE_HELD, fields: SIKICH_STEP1 },
  { name: 'jr6-sikich-step1-resume', html: sikichStep1ResumeHtml, address: `${SIKICH}/apply`, page: 'application',
    step: 'scopeData.step1', final: 'not-final', uploads: RESUME_HELD, fields: SIKICH_STEP1 },
  // Jobvite's "invalid fields only" view after a refused Next: only "Preferred First Name*" shows (JV-23). The resume's
  // row is hidden with its section, so the page shows no file held there (and the resume is no field of the view).
  { name: 'jr6-sikich-step1-invalid', html: sikichStep1InvalidHtml, address: `${SIKICH}/apply`, page: 'application',
    step: 'scopeData.step1', final: 'not-final', uploads: NONE_HELD,
    fields: [['text', true, 'Preferred First Name', PI]] },
  { name: 'jr6-sikich-step2', html: sikichStep2Html, address: `${SIKICH}/apply`, page: 'application',
    step: 'scopeData.step2', final: 'not-final', fields: eeoStep(true) },
  { name: 'jr6-sikich-step3', html: sikichStep3Html, address: `${SIKICH}/apply`, page: 'application',
    step: 'scopeData.step3', final: 'final', fields: SIKICH_STEP3 },
  { name: 'jr6-sikich-step3-filled', html: sikichStep3FilledHtml, address: `${SIKICH}/apply`, page: 'application',
    step: 'scopeData.step3', final: 'final', fields: SIKICH_STEP3 },
  { name: 'jr6-sikich-confirmation', html: sikichConfirmationHtml, address: `${SIKICH}/applyConfirmation`,
    page: 'confirmation', step: null, success: 'Well Done, Application Sent!' },
];

describe('jr6 JOBVITE: every jr6 page, as the adapter reads it', () => {
  it('holds the 15 jr6 cases, every page the jr6 rules were written from, and the config names them', () => {
    expect(PAGES.map((page) => page.name)).toEqual([...JOBVITE_JR6_SNAPSHOTS]);
    for (const name of JOBVITE_JR6_SNAPSHOTS) expect(JOBVITE_CONFIG.snapshots).toContain(name);
    expect(configProblems(JOBVITE_CONFIG)).toEqual([]);
  });

  it.each(PAGES)('$name', async (page) => {
    const url = new URL(page.address);
    expect(adaptersFor(url)[0]).toBe(jobviteAdapter);
    expect(parseJobviteUrl(url)?.page).toBe(page.page);
    const { doc } = await load(page.html);
    expect(jobviteAdapter.authState!(doc)).toBeNull();
    // The posting's first Apply is its entry (pressed by the agent's entry door only); nothing else offers one.
    expect(jobviteAdapter.entryControl!(doc)).toBe(page.page === 'posting'
      ? doc.querySelector('a.jv-button.jv-button-apply') : null);
    // jr6 JV-24: the page after Send Application shows its sign; no other page does.
    expect(configuredSuccessSigns(doc, JOBVITE_CONFIG).map(words)).toEqual(page.success === undefined ? [] : [page.success]);
    const found = jobviteAdapter.detect(doc);
    if (page.step === null) {
      expect(found).toBeNull();
      expect(jobviteAdapter.stepSignature!(doc)).toEqual({ anchors: [] });
      return;
    }
    const root = found!.formRoot;
    expect(root).toBe(doc.body);
    // jr6 JV-23: the step's ng-form alone.
    expect(jobviteAdapter.stepSignature!(doc)).toEqual({ anchors: [page.step] });
    expect(jobviteAdapter.isFinalStep!(doc)).toBe(page.final);
    expect(jobviteAdapter.nextButton!(root)).toBe(page.final === 'final' ? null
      : doc.querySelector('div.jv-apply-form-actions > button[aria-label="Next"]'));
    expect(jobviteAdapter.submitButton!(root)).toBe(doc.querySelector('button[aria-label="Send Application"]'));
    expect(jobviteAdapter.isBusy!(doc)).toBe(false);
    expect(jobviteAdapter.errors!(root)).toEqual([]);
    expect(jobviteAdapter.uploadWidgets!(root).map((upload) => [upload.input.id, jobviteAdapter.uploadHeld!(upload.input)]))
      .toEqual(page.uploads ?? []);
    const fields = scan(root, jobviteAdapter, { platform: 'jobvite' }).fields;
    expect(fields.map((field) => [field.kind, field.required, field.label, field.section.id])).toEqual(
      (page.fields ?? []).map(([kind, required, label, section]) => [kind, required, expect.stringMatching(
        new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)), section]));
  });
});

describe('jr6 JOBVITE: the fixtures hold no answer (JV-10, jobvite-new-2, jobvite-new-4)', () => {
  /** An element's shape without the attributes that name the option itself (the converter's own row reading). */
  const OWN = new Set(['id', 'for', 'name', 'value', 'aria-labelledby', 'aria-describedby', 'aria-controls',
    'aria-label', 'title']);
  const shape = (el: Element): string => `<${el.localName} ${Array.from(el.attributes)
    .filter((attribute) => !OWN.has(attribute.name)).map((attribute) => `${attribute.name}=${attribute.value
      .replace(/\d+/g, '#')}`).sort().join(' ')}>${Array.from(el.children, shape).join('')}</>`;
  const ANGULAR = /(?:^|\s)ng-(?:valid|invalid|pending|empty|not-empty|pristine|dirty|untouched|touched)(?:-[\w-]+)?(?=\s|$)/;

  it.each(PAGES.filter((page) => page.fields !== undefined))('$name: no chosen mark, rows alike', async (page) => {
    const { doc } = await load(page.html);
    const all = (css: string) => Array.from(doc.querySelectorAll(css));
    expect(all('.jv-input-group-row-active, .icon-radio-checked, .icon-checkbox-checked')).toEqual([]);
    expect(all('[role="radio"][aria-selected="true"], [role="checkbox"][aria-selected="true"], [role="radio"][aria-checked], '
      + '[role="checkbox"][aria-checked]')).toEqual([]);
    expect(all('input[checked], option[selected]')).toEqual([]);
    expect(all('input, select, textarea, [ng-model], [ng-form]')
      .filter((el) => el.localName !== 'form' && ANGULAR.test(el.getAttribute('class') ?? ''))).toEqual([]);
    for (const group of all('fieldset.jv-input-group')) {
      const rows = Array.from(group.querySelectorAll('label.jv-input-group-row'));
      expect(new Set(rows.map(shape)).size).toBeLessThanOrEqual(1);
    }
  });

  it('gives the County of Residence list its synthetic names on Sikich\'s three step-1 pages', async () => {
    for (const html of [sikichStep1Html, sikichStep1ResumeHtml, sikichStep1InvalidHtml]) {
      const { doc } = await load(html);
      const county = doc.querySelector<HTMLSelectElement>('select#jv-field-y5Vk2fw6')!;
      expect(words(doc.querySelector('label[for="jv-field-y5Vk2fw6"]'))).toMatch(/^County of Residence/);
      const options = Array.from(county.options);
      expect(options[0]!.value).toBe('');
      expect(options.slice(1).map((option) => option.text)).toEqual(lines(countyList));
      removeFixtures(document);
    }
  });

  it('gives VHL\'s first qualification and both postings\' descriptions their synthetic text', async () => {
    const step3 = await load(vhlStep3FilledHtml);
    const rows = step3.doc.querySelectorAll('div.jv-prescreen-element-checkboxes fieldset.jv-input-group > label.jv-input-group-row');
    expect(rows).toHaveLength(5);
    expect(words(rows[0])).toBe(lines(qualificationOption)[0]);
    expect(rows[0]!.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
    removeFixtures(document);
    for (const html of [vhlPostingHtml, sikichPostingHtml]) {
      const { doc } = await load(html);
      expect(words(jobviteAdapter.postingText!(doc))).toBe(lines(postingDescription).join(' '));
      removeFixtures(document);
    }
  });
});

describe('jr6 JOBVITE JV-18: the resume first, and Jobvite\'s parse waited for', () => {
  const SPINNER = '#attachResume ul.jv-file-list span.jv-spinner';

  it('declares the parse, and reads the resume row\'s spinner as busy while it shows', async () => {
    expect(jobviteAdapter.quirks?.resumeParse).toBe(true);
    for (const html of [vhlStep1FilledHtml, sikichStep1ResumeHtml, ninjaStep1ResumeHtml]) {
      const { doc } = await load(html);
      const spinner = doc.querySelector(SPINNER)!;
      expect(spinner.getAttribute('ng-show')).toBe('resumeLoading');
      expect(jobviteAdapter.isBusy!(doc)).toBe(false);
      spinner.classList.remove('ng-hide');
      expect(jobviteAdapter.isBusy!(doc)).toBe(true);
      expect(busySigns(doc.body, jobviteAdapter)).toContain('adapter');
      // Undone (the step's busy signs alone): the spinner says nothing.
      expect(without({ busy: JOBVITE_CONFIG.busy!.filter((rule) => rule.css !== SPINNER) }).isBusy!(doc)).toBe(false);
      removeFixtures(document);
    }
  });

  it('waits while the spinner shows, though no value changed (undone: the page is taken to parse nothing)', async () => {
    const timings = { pollMs: 20, startMs: 250, quietMs: 100, capMs: 5_000 };
    const play = async (adapter: Adapter) => {
      const { doc, view } = await load(vhlStep1FilledHtml);
      const spinner = doc.querySelector(SPINNER)!;
      spinner.classList.remove('ng-hide');
      view.setTimeout(() => spinner.classList.add('ng-hide'), 700);
      const result = await awaitResumeParse(() => doc.body, adapter, new AbortController().signal, timings);
      removeFixtures(document);
      return result;
    };
    const waited = await play(jobviteAdapter);
    expect(waited.outcome).toBe('parsed');
    expect(waited.ms).toBeGreaterThanOrEqual(700);
    const undone = await play(without({ busy: JOBVITE_CONFIG.busy!.filter((rule) => rule.css !== SPINNER) }));
    expect(undone.outcome).toBe('none');
    expect(undone.ms).toBeLessThan(700);
  });

  /**
   * Sikich's step 1 (jr6-sikich-step1), its page played by the test as the captures show Jobvite's: the resume put into
   * #file-input-0 draws its row (ul.jv-file-list > li > div.jv-file, the file's name in its
   * span[ng-click="editOrPreviewResume()"]) with the row's spinner shown (ng-show="resumeLoading"); PARSE_AFTER_MS later
   * the page's parse writes the first name and the spinner hides. Answers the order the page saw the resume, the parse
   * and the run's writes in.
   */
  const PARSE_AFTER_MS = 1_200;
  function playJobvite(doc: Document, view: Window & typeof globalThis): string[] {
    const seen: string[] = [];
    const firstName = doc.querySelector<HTMLInputElement>('#jv-field-yfOf0fw2')!;
    expect(words(doc.querySelector('label[for="jv-field-yfOf0fw2"]'))).toMatch(/^First Name/);
    const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value')!.set!;
    doc.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement;
      if (target === firstName && target.value !== 'Parsed') seen.push('first-name');
      else if (target !== firstName && target.type !== 'file') seen.push('write');
    }, true);
    doc.addEventListener('change', (event) => {
      const target = event.target as HTMLElement;
      if (target.localName === 'select') seen.push('write');
    }, true);
    const input = doc.querySelector<HTMLInputElement>('#file-input-0')!;
    input.addEventListener('change', () => {
      seen.push('resume');
      doc.querySelector('#attachResume > div[ng-show="!resumeName"]')!.classList.add('ng-hide');
      const row = doc.createElement('li');
      const file = doc.createElement('div');
      file.className = 'jv-file';
      const spinner = doc.createElement('span');
      spinner.className = 'jv-spinner';
      spinner.setAttribute('ng-show', 'resumeLoading');
      const name = doc.createElement('span');
      name.className = 'jv-text-link';
      name.setAttribute('ng-click', 'editOrPreviewResume()');
      name.textContent = input.files?.[0]?.name ?? '';
      file.append(spinner, name);
      row.append(file);
      doc.querySelector('#attachResume ul.jv-file-list')!.append(row);
      view.setTimeout(() => {
        setter.call(firstName, 'Parsed');
        firstName.dispatchEvent(new view.Event('input', { bubbles: true }));
        spinner.classList.add('ng-hide');
        seen.push('parsed');
      }, PARSE_AFTER_MS);
    });
    return seen;
  }

  async function run(doc: Document, adapters: Adapter[]) {
    const fake = createFakeWorker({ resume: { bytes: fakePdf(48_213), name: GOLDEN_RESUME.fileName, mime: 'application/pdf' },
      letter: { state: { state: 'none', reason: 'cover-letter-none' } } });
    const runtime = await startContentRuntime(fake.platform, doc, { href: () => `${SIKICH}/apply`, isTop: true,
      adapters: () => adapters, settle: { quietMs: 120 } });
    runtimes.push(runtime);
    await runtime.fill({});
    const report = fake.reports.at(-1) ?? fake.liveReports.at(-1);
    return (report?.fields ?? []) as FillResult[];
  }

  it('writes the resume first on Sikich\'s step 1, waits for its parse, and writes the profile over it', async () => {
    const fixture = await load(sikichStep1Html);
    const seen = playJobvite(fixture.doc, fixture.view);
    const rows = await run(fixture.doc, adaptersFor(new URL(`${SIKICH}/apply`)));
    expect(seen[0]).toBe('resume');
    expect(seen.slice(0, seen.indexOf('parsed'))).toEqual(['resume']);
    expect(seen.indexOf('parsed')).toBeLessThan(seen.indexOf('first-name'));
    expect(fixture.doc.querySelector<HTMLInputElement>('#jv-field-yfOf0fw2')!.value).toBe(goldenProfile().identity.firstName);
    expect(rows.find((row) => row.category === 'file.resume')).toMatchObject({ wrote: true });
  }, 60_000);

  it('without the quirk the profile\'s answers go in before the resume, under the parse (undo proof)', async () => {
    const fixture = await load(sikichStep1Html);
    const seen = playJobvite(fixture.doc, fixture.view);
    const adapters = adaptersFor(new URL(`${SIKICH}/apply`))
      .map((adapter) => ({ ...adapter, quirks: { ...adapter.quirks, resumeParse: undefined } }) as Adapter);
    await run(fixture.doc, adapters);
    expect(seen.indexOf('first-name')).toBeGreaterThanOrEqual(0);
    expect(seen.indexOf('first-name')).toBeLessThan(seen.indexOf('resume'));
  }, 60_000);
});

describe('jr6 JOBVITE JV-23: one step, one signature, whatever Jobvite hides', () => {
  it('signs Sikich\'s step 1 and its "invalid fields only" view alike, and the three steps apart', async () => {
    const signed = async (html: string, adapter: Adapter = jobviteAdapter) => {
      const { doc } = await load(html);
      const parts = adapter.stepSignature!(doc);
      removeFixtures(document);
      return hashSignature(parts);
    };
    const step1 = await signed(sikichStep1Html);
    expect(await signed(sikichStep1InvalidHtml)).toBe(step1);
    expect(await signed(sikichStep1ResumeHtml)).toBe(step1);
    const steps = [step1, await signed(sikichStep2Html), await signed(sikichStep3Html)];
    expect(new Set(steps).size).toBe(3);
    // Undone (the step's first shown header read too, as before): the invalid view reads as another step.
    const headed = without({ steps: { ...JOBVITE_CONFIG.steps!,
      heading: 'form[name="scopeData.applyForm"] > div.jv-apply-step h3.jv-step-header' } });
    expect(await signed(sikichStep1InvalidHtml, headed)).not.toBe(await signed(sikichStep1Html, headed));
  });
});

describe('jr6 JOBVITE JV-24: the page after Send Application', () => {
  it('reads both confirmations\' header by its success icon and words, and nothing on the steps', async () => {
    for (const [html, header] of [[vhlConfirmationHtml, 'Application Sent!'],
      [sikichConfirmationHtml, 'Well Done, Application Sent!']] as const) {
      const { doc } = await load(html);
      const sign = doc.querySelector('article.jv-page-body[role="main"] h2.jv-page-message-header')!;
      expect(words(sign)).toBe(header);
      // Through content/submitted.ts, as the runtime reads a configured platform's sign.
      expect(signsOf(doc, 'jobvite')).toEqual([sign]);
      expect(successShown(doc, 'jobvite')).toBe(true);
      expect([...shownSignsOf(doc, 'jobvite')]).toEqual([sign]);
      // Undone (no success rule, as before): no sign.
      expect(configuredSuccessSigns(doc, { ...JOBVITE_CONFIG, success: undefined })).toEqual([]);
      // Other words, or no success icon beside it: no sign.
      const text = sign.firstChild!;
      text.nodeValue = 'Application Saved';
      expect(signsOf(doc, 'jobvite')).toEqual([]);
      text.nodeValue = header;
      const icon = doc.querySelector('.jv-page-message > i.jv-icon-success')!;
      icon.classList.remove('jv-icon-success');
      expect(signsOf(doc, 'jobvite')).toEqual([]);
      icon.classList.add('jv-icon-success');
      expect(signsOf(doc, 'jobvite')).toEqual([sign]);
      // Hidden: no sign a person can see.
      (sign.closest('.jv-page-message') as HTMLElement).style.display = 'none';
      expect(successShown(doc, 'jobvite')).toBe(false);
      removeFixtures(document);
    }
    for (const html of [ninjaStep2Html, ninjaStep3Html, ninjaPostingHtml, ninjaConsentEmptyHtml]) {
      const { doc } = await load(html);
      expect(signsOf(doc, 'jobvite')).toEqual([]);
      removeFixtures(document);
    }
  });
});

describe('jr6 JOBVITE: the consent gate\'s residence select and the postings\' Apply', () => {
  it('gives the residence select the page\'s label, "Location of Residence and Language" (FIXPLAN §3.2, RULES\' JV-9)',
    async () => {
      const { doc } = await load(ninjaConsentEmptyHtml);
      const root = jobviteAdapter.detect(doc)!.formRoot;
      expect(jobviteAdapter.stepSignature!(doc)).toEqual({ anchors: ['state:residence'] });
      const fields = scan(root, jobviteAdapter, { platform: 'jobvite' }).fields;
      expect(fields.map((field) => ({ label: field.label, labelSource: field.labelSource, kind: field.kind,
        required: field.required, id: field.idAttr }))).toEqual([{ label: 'Location of Residence and Language',
        labelSource: 'for', kind: 'select', required: true, id: 'jv-country-select' }]);
      // Its one real option (beside the placeholder) names the global policy in English: what RULES' rule chooses
      // where no option names the profile's country (P2 asserts the choice).
      const options = fields[0]!.options === 'lazy' ? [] : fields[0]!.options.map((option) => option.label);
      expect(options).toHaveLength(2);
      expect(options.filter((label) => /global/i.test(label) && /english/i.test(label))).toHaveLength(1);
    });

  it.each([['jr6-vhl-posting', vhlPostingHtml], ['jr6-sikich-posting', sikichPostingHtml]] as const)(
    '%s: the agent\'s entry presses the posting\'s first Apply alone, never "Apply Later"', async (_name, html) => {
      const { doc } = await load(html);
      const pressed: Element[] = [];
      doc.addEventListener('click', (event) => {
        pressed.push(event.target as Element);
        event.preventDefault();
      }, true);
      const applies = doc.querySelectorAll('a.jv-button-apply');
      expect(applies.length).toBeGreaterThanOrEqual(2);
      const never = jobviteAdapter.neverPress!(doc.documentElement);
      expect(never).toContain(doc.querySelector('a.jv-button-apply-later'));
      expect(await pressEntry(doc, [jobviteAdapter], new AbortController().signal, 300, 300)).toEqual({ outcome: 'pressed' });
      expect(pressed).toEqual([applies[0]]);
    });
});
