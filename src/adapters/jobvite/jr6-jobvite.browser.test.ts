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
 * P2 (FIXPLAN §6.7 "P2 asserts", after merging ENGINE's E1 to E3 and RULES' R1 to R4) holds what the shared rules give
 * on these pages: each page scanned as the run scans it and planned by the real planFrame (JV-1 to JV-9, JV-11 to
 * JV-17, JV-19, JV-22, jobvite-new-1, jobvite-new-5, and RULES' label contracts and asserts for Jobvite, its handoff
 * edits 12 and 21), and the same-document confirmation recorded through content/submitted.ts newSuccessSign (JV-24,
 * ENGINE E2). Plans and runs use the golden synthetic profile, or variants of it built here, and the posting's company
 * as TailorIT's lookup names it; an answer a page shows is drawn by the test; the fixtures hold none of the owner's
 * values.
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
import ninjaStep1Html from '../../../fixtures/jobvite/ninjaone-step1.html?raw';
import ninjaStep2Html from '../../../fixtures/jobvite/ninjaone-step2.html?raw';
import ninjaStep3Html from '../../../fixtures/jobvite/ninjaone-step3.html?raw';
import countyList from '../../../fixtures/synthetic/jobvite/jr6-county-list.txt?raw';
import postingDescription from '../../../fixtures/synthetic/jobvite/jr6-posting-description.txt?raw';
import qualificationOption from '../../../fixtures/synthetic/jobvite/jr6-qualification-option.txt?raw';
import { createFakeWorker, fakePdf, GOLDEN_RESUME, goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import { pressEntry } from '../../content/press';
import { startContentRuntime, type ContentRuntime } from '../../content/runtime';
import { newSuccessSign, shownSignsOf, signsOf, successShown } from '../../content/submitted';
import { matchOne } from '../../core/matcher/cascade';
import { prepareOptions } from '../../core/matcher/prepare';
import { planFrame } from '../../core/plan/frame';
import { CAUTIOUS_SETTINGS } from '../../core/plan/settings.testkit';
import type { PlanInput, PlanOutput } from '../../core/plan/types';
import { classifyByRules } from '../../core/resolver/classifyRules';
import { countyChoice } from '../../core/resolver/values';
import { stepSignature as hashSignature } from '../../core/steps/signature';
import { normalizeLabel } from '../../core/text/normalize';
import { asUntrusted } from '../../core/text/untrusted';
import type { FieldSpec } from '../../core/types/field';
import type { FillResult, PlannedWrite } from '../../core/types/fill';
import type { Profile, WorkAuthorization } from '../../core/types/profile';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import type { VisibleText } from '../../core/types/text';
import { loadFixture, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { awaitResumeParse } from '../../dom/resume-parse';
import { scan, toFieldSpec } from '../../dom/scan';
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

// ── jr6 JOBVITE P2 (FIXPLAN §6.7 "P2 asserts"): what ENGINE's E1 to E3 and RULES' R1 to R4 give on the jr6 pages ──────

/** Today as the planner sets a date control (PlanInput.now as YYYY-MM-DD). */
const TODAY = `${NOW.y}-${String(NOW.m).padStart(2, '0')}-${String(NOW.d).padStart(2, '0')}`;
/** Each posting's company, as TailorIT's lookup names it (PlanInput.posting): what "worked here before?" asks about. */
const VHL_COMPANY = 'Vista Higher Learning';
const SIKICH_COMPANY = 'Sikich';
const NINJA_COMPANY = 'NinjaOne';
const golden = goldenProfile();
const yes = { kind: 'value', value: true } as const;
const no = { kind: 'value', value: false } as const;

/** What the plan made of a page: each field's row, its write, and what it asks TailorIT's AI about it. */
interface Plan {
  out: PlanOutput;
  /** The fields whose label starts with the page's words `label`, in the page's order. */
  all(label: string): FieldSpec[];
  /** The one field whose label starts with `label`. */
  one(label: string): FieldSpec;
  row(field: FieldSpec): FillResult;
  write(field: FieldSpec): PlannedWrite | undefined;
  /** 'classify', 'answers:<scope>', 'draft' or 'tiebreak', for each question the plan asks about the field. */
  asked(field: FieldSpec): string[];
}

/** The page scanned from its root as the run scans it (`change` drawn on it first: an answer the page shows, a value a
 *  field holds), then planned by planFrame with the golden profile, the default settings and the posting's company. */
async function planOf(html: string, company: string, extra: Partial<PlanInput> = {},
  change?: (doc: Document) => void): Promise<Plan> {
  const { doc } = await load(html);
  change?.(doc);
  const specs = scan(jobviteAdapter.detect(doc)!.formRoot, jobviteAdapter, { platform: 'jobvite' }).fields
    .map(toFieldSpec);
  removeFixtures(document);
  const out = planFrame({ specs, canaries: [], profile: golden, sensitiveState: 'loaded', savedAnswers: [],
    settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW, posting: { company }, ...extra });
  const all = (label: string) => specs.filter((spec) => spec.label.startsWith(label));
  return {
    out,
    all,
    one: (label) => {
      const found = all(label);
      expect(found, label).toHaveLength(1);
      return found[0]!;
    },
    row: (field) => out.results.find((row) => row.key === field.key)!,
    write: (field) => out.writes.find((write) => write.key === field.key),
    asked: (field) => [
      ...(out.ask?.classify ?? []).filter((item) => item.key === field.key).map(() => 'classify'),
      ...(out.ask?.answers ?? []).filter((item) => item.key === field.key).map((item) => `answers:${item.scope}`),
      ...(out.ask?.drafts ?? []).filter((item) => item.key === field.key).map(() => 'draft'),
      ...(out.ask?.tiebreaks ?? []).filter((item) => item.id.startsWith(field.key)).map(() => 'tiebreak'),
    ],
  };
}

/** The option a write chooses, the options it ticks, the text it types or the date it sets. */
function written(write: PlannedWrite | undefined): string | string[] | undefined {
  const value = write?.value;
  if (value === undefined) return undefined;
  if (value.kind === 'option') return value.cleanLabel;
  if (value.kind === 'options') return value.cleanLabels;
  if (value.kind === 'text') return value.text;
  if (value.kind === 'date') return value.iso;
  return value.kind;
}

/** A field's option labels (the page's words). */
const optionLabels = (field: FieldSpec) => (field.options === 'lazy' ? [] : field.options.map((option) => option.label));

/** The golden profile with these work-authorization entries, and these citizenships. */
const withAuth = (entries: WorkAuthorization[], citizenships?: string[]): Profile => ({ ...golden,
  workAuthorization: entries, screening: { ...golden.screening,
    ...(citizenships === undefined ? {} : { citizenships: { kind: 'value' as const, value: citizenships } }) } });
/** A work status the profile states. */
const statusOf = (value: 'citizen' | 'permanent-resident' | 'work-visa') => ({ kind: 'value' as const, value });
/** A country's entry: authorized, needing no sponsorship now or later, of this status. */
const settledIn = (country: string, status?: ReturnType<typeof statusOf>): WorkAuthorization => ({ country,
  authorized: yes, sponsorshipNow: no, sponsorshipFuture: no, ...(status === undefined ? {} : { status }) });
/** The golden profile living in another state (and city). */
const livingIn = (code: string, name: string, city?: string): Profile => ({ ...golden,
  address: { ...golden.address, region: { code, name }, ...(city === undefined ? {} : { city }) } } as Profile);
/** The golden profile with one more employer: a former one, or the current job. */
const workedAt = (company: string, current = false): Profile => ({ ...golden, experience: [...golden.experience,
  current ? { company, title: 'Engineer', current: true, startDate: { y: 2024, m: 1 } }
    : { company, title: 'Analyst', current: false, startDate: { y: 2017, m: 1 }, endDate: { y: 2018, m: 12 } }] });

describe('jr6 JOBVITE P2 JV-1, JV-2: the EEO step\'s two dates and its veteran group', () => {
  /** What Sikich's "Choose One" (jr6-sikich-step2) takes for this veteran answer. */
  const veteranOnSikich = async (veteran: Profile['eeo']['veteran']) => {
    const plan = await planOf(sikichStep2Html, SIKICH_COMPANY, { profile: { ...golden, eeo: { ...golden.eeo, veteran } } });
    return written(plan.write(plan.one('Choose One')));
  };
  const STEPS = [['jr6-vhl-step2', vhlStep2Html, VHL_COMPANY], ['jr6-vhl-step2-filled', vhlStep2FilledHtml, VHL_COMPANY],
    ['jr6-sikich-step2', sikichStep2Html, SIKICH_COMPANY], ['ninjaone-step2', ninjaStep2Html, NINJA_COMPANY]] as const;

  it.each(STEPS)('%s: both "Today\'s Date" are today on the signature\'s terms; "Choose One" takes the veteran answer',
    async (_name, html, company) => {
      const plan = await planOf(html, company);
      const dates = plan.all("Today's Date signature");
      expect(dates.map((date) => date.kind)).toEqual(['date', 'date']);
      for (const date of dates) {
        // RULES item 11 (JV-1): the date the adapter reads with the signature's suffix (FIXPLAN §3.2) is today's.
        expect(classifyByRules(date)).toMatchObject({ category: 'consent.signatureDate', rule: 'label.signature-date' });
        expect(plan.row(date)).toMatchObject({ category: 'consent.signatureDate', status: 'verified', reason: 'ok',
          needsUserAction: false });
        expect(plan.write(date)).toMatchObject({ value: { kind: 'date', iso: TODAY },
          origin: { provenance: 'rule', ruleId: 'consent.signature-date' } });
      }
      // The name beside each is the signature (core pass Z2), on the same pre-approval.
      for (const name of plan.all('Your Name signature')) {
        expect(plan.write(name)).toMatchObject({ value: { kind: 'text', text: 'Alex Rivera' },
          origin: { provenance: 'rule', ruleId: 'consent.signature-preapproved' } });
      }
      // RULES item 12 (JV-2): the group labelled only "Choose One" is the veteran question, by its statements.
      const veteran = plan.one('Choose One');
      expect(classifyByRules(veteran)).toMatchObject({ category: 'eeo.veteran', rule: 'options.veteran-statements' });
      expect(plan.row(veteran)).toMatchObject({ category: 'eeo.veteran', status: 'verified', reason: 'ok' });
      expect(plan.write(veteran)).toMatchObject({ value: { cleanLabel: 'I AM NOT A PROTECTED VETERAN' },
        origin: { provenance: 'profile', path: 'eeo.veteran' } });
      // The whole step is the profile's: nothing waits for the AI.
      expect(plan.out.awaiting).toEqual([]);
    });

  it('jr6-sikich-step2 (all required): the dates keep to the signature\'s terms and never cover a date the page holds; '
    + 'the veteran group takes each veteran answer', async () => {
    // Consents: Required only, nothing pre-approved: the required signature's dates on the required rule.
    const cautious = await planOf(sikichStep2Html, SIKICH_COMPANY, { settings: CAUTIOUS_SETTINGS });
    for (const date of cautious.all("Today's Date signature")) {
      expect(cautious.write(date)).toMatchObject({ value: { kind: 'date', iso: TODAY },
        origin: { provenance: 'rule', ruleId: 'consent.required' } });
    }
    // A date the first block's field holds (typed by the test) is kept; the second block's is still set.
    const held = await planOf(sikichStep2Html, SIKICH_COMPANY, {}, (doc) => {
      doc.querySelector<HTMLInputElement>('div.jv-form-field-input.JVA_DATE input')!.value = '2026-11-02';
    });
    const [first, second] = held.all("Today's Date signature");
    expect(held.row(first!)).toMatchObject({ category: 'consent.signatureDate', reason: 'prefill-kept' });
    expect(held.write(first!)).toBeUndefined();
    expect(written(held.write(second!))).toBe(TODAY);
    // A protected veteran identifies as one.
    expect(await veteranOnSikich({ kind: 'value', value: { veteran: true, protected: true } }))
      .toMatch(/^I IDENTIFY AS ONE OR MORE OF THE CLASSIFICATIONS OF PROTECTED VETERAN/);
  });

  // jr6 regression of RULES (reported in SP\jr6\build\JOBVITE.md, P2): the page's decline reads "DECLINE
  // SELF-IDENTIFICATION", a noun form vocab/curated/decline.json does not hold ("Decline to self-identify" and "Opt out
  // of self-identification" are there), so a person who declines gets decline-option-missing and the group is left.
  // JV-2's fix names that option for a decline. Remove `.fails` once the decline vocabulary reads it.
  it.fails('JV-2 (RULES regression): a person who declines the veteran question chooses "DECLINE SELF-IDENTIFICATION"',
    async () => {
      expect(await veteranOnSikich({ kind: 'decline' })).toBe('DECLINE SELF-IDENTIFICATION');
    });
});

describe('jr6 JOBVITE P2 JV-3: Sikich\'s "County of Residence" (jr6-sikich-step1, its synthetic list)', () => {
  /** The option a county chooses in `field` (resolver/values.ts countyChoice, matched as the plan matches a choice; the
   *  profile holds no county yet, owner question 13). */
  function countyOn(field: FieldSpec, county: string): string | null {
    const vocab = testVocab();
    const choice = countyChoice(county, vocab);
    const listed = field.options === 'lazy' ? [] : field.options;
    const outcome = matchOne({ key: field.key, platform: field.platform, labelKey: normalizeLabel(field.label),
      fieldLabel: asUntrusted(field.label as VisibleText, 500), optionSetHash: field.optionSetHash, policy: 'profile',
      intended: choice.intended, options: prepareOptions(listed, choice.domain, vocab) }, { vocab, llm: false });
    if (!outcome.done || outcome.match.optionIndex === null) return null;
    const index = outcome.match.optionIndex;
    return listed.find((option) => option.index === index)?.label ?? null;
  }

  it('is the county: nothing written or asked while the profile holds none; a county is matched by its name, never '
    + 'by the EEO-like "White"', async () => {
    const plan = await planOf(sikichStep1Html, SIKICH_COMPANY);
    const county = plan.one('County of Residence');
    expect(classifyByRules(county)).toMatchObject({ category: 'address.county', rule: 'label.county' });
    // RULES item 13: never a guess and never the AI; the list is required, so it waits for the person.
    expect(plan.row(county)).toMatchObject({ category: 'address.county', status: 'flagged', reason: 'no-profile-value',
      needsUserAction: true });
    expect(plan.write(county)).toBeUndefined();
    expect(plan.asked(county)).toEqual([]);
    // Its neighbour "Country" stays the country.
    expect(plan.write(plan.one('Country'))).toMatchObject({ value: { cleanLabel: 'United States' } });
    expect(optionLabels(county)).toEqual(expect.arrayContaining(['Travis', 'White']));
    for (const name of ['Travis', 'Travis County']) expect(countyOn(county, name), name).toBe('Travis');
  });
});

describe('jr6 JOBVITE P2 on VHL\'s step 1 (jr6-vhl-step1): JV-4, JV-11, JV-12, JV-19, JV-22', () => {
  it('JV-4: the K-12 School District question is no school: the AI classifies it with its options', async () => {
    const plan = await planOf(vhlStep1Html, VHL_COMPANY);
    const k12 = plan.one('Have you been employed by any United States K-12 School District');
    expect(classifyByRules(k12)).toBeNull();
    expect(plan.row(k12)).toMatchObject({ category: 'unknown', status: 'flagged', reason: 'unknown-field' });
    expect(plan.asked(k12)).toEqual(['classify']);
  });

  it('JV-11: "Citizen/Employment Status" is the status, read by the countries its options name', async () => {
    const plan = await planOf(vhlStep1Html, VHL_COMPANY);
    const status = plan.one('Citizen/Employment Status');
    // RULES edit 12 (label contract): the options keep their own words; the countries are read from them.
    expect(optionLabels(status)).toEqual(['Select an option...', 'U.S. Citizen/Permanent Resident',
      'Non-citizen allowed to work for any employer', 'Non-citizen allowed to work for current employer',
      'Non-citizen seeking work authorization', 'Canadian Citizen/Permanent Resident']);
    expect(classifyByRules(status)).toMatchObject({ category: 'workAuth.status', rule: 'label.citizenship' });
    // The golden profile states no status: the `all` scope's AI, never work-auth-country-unknown.
    expect(plan.row(status)).toMatchObject({ category: 'workAuth.status', status: 'flagged',
      reason: 'legal-not-in-profile' });
    expect(plan.asked(status)).toEqual(['answers:all']);
    const statusFor = async (profile: Profile) => {
      const variant = await planOf(vhlStep1Html, VHL_COMPANY, { profile });
      const field = variant.one('Citizen/Employment Status');
      return { write: variant.write(field), row: variant.row(field) };
    };
    // A citizen by the person's citizenships; a Canadian citizen by the Canadian entry.
    expect((await statusFor(withAuth(golden.workAuthorization, ['US']))).write).toMatchObject({
      value: { cleanLabel: 'U.S. Citizen/Permanent Resident' },
      origin: { provenance: 'profile', path: 'screening.citizenships', transform: 'legal.work-status' } });
    expect(written((await statusFor(withAuth([{ country: 'CA', authorized: yes, status: statusOf('citizen') }]))).write))
      .toBe('Canadian Citizen/Permanent Resident');
    // A visa holder's right from the authorization and sponsorship answers alone, flagged.
    expect(await statusFor(withAuth([settledIn('US', statusOf('work-visa'))]))).toMatchObject({
      write: { value: { cleanLabel: 'Non-citizen allowed to work for any employer' } },
      row: { reason: 'filled-low-confidence' } });
  });

  it('JV-12: "Have you worked for VHL in any capacity previously?" is No, VHL read as Vista Higher Learning\'s initials',
    async () => {
      const plan = await planOf(vhlStep1Html, VHL_COMPANY);
      const before = plan.one('Have you worked for VHL in any capacity previously?');
      expect(classifyByRules(before)).toMatchObject({ category: 'screening.previouslyEmployed',
        rule: 'label.previously-employed' });
      expect(plan.row(before)).toMatchObject({ status: 'verified', reason: 'ok' });
      expect(plan.write(before)).toMatchObject({ value: { cleanLabel: 'No' },
        origin: { provenance: 'rule', ruleId: 'screening.previously-employed' } });
      // Another posting company: "VHL" is then another company, whose No is only flagged (RULES item 40).
      const elsewhere = await planOf(vhlStep1Html, 'Acme');
      expect(elsewhere.row(elsewhere.one('Have you worked for VHL'))).toMatchObject({ status: 'flagged',
        reason: 'filled-low-confidence' });
      // A former VHL employee is never answered No: the page's Yes comes in five kinds of work ("Yes, Employee",
      // "Yes, Contractor", …) the profile does not tell apart, so the person chooses.
      const former = await planOf(vhlStep1Html, VHL_COMPANY, { profile: workedAt(VHL_COMPANY) });
      const asked = former.one('Have you worked for VHL');
      expect(optionLabels(asked).filter((label) => label.startsWith('Yes, '))).toHaveLength(5);
      expect(written(former.write(asked))).not.toBe('No');
      expect(former.row(asked).status).toBe('flagged');
    });

  it('JV-19, JV-22: the mailing address "if different" and the referrer\'s name are skipped, never drafted or asked',
    async () => {
      const plan = await planOf(vhlStep1Html, VHL_COMPANY);
      const mailing = plan.one('Mailing Address, if different from above');
      expect(mailing.kind).toBe('textarea');
      expect(classifyByRules(mailing)).toMatchObject({ category: 'address.mailing', rule: 'label.address-if-different' });
      expect(plan.row(mailing)).toMatchObject({ status: 'skipped', reason: 'no-profile-value', needsUserAction: false });
      expect(plan.asked(mailing)).toEqual([]);
      const referrer = plan.one('Referral Name');
      expect(classifyByRules(referrer)).toMatchObject({ category: 'referral.referrerName', rule: 'label.referrer' });
      expect(plan.row(referrer)).toMatchObject({ status: 'skipped', reason: 'no-profile-value', needsUserAction: false });
      expect(plan.asked(referrer)).toEqual([]);
      expect(plan.out.ask?.drafts ?? []).toEqual([]);
    });
});

describe('jr6 JOBVITE P2 on VHL\'s step 3 (jr6-vhl-step3-filled): JV-16\'s ten questions and JV-5\'s checklist', () => {
  const question = (plan: Plan, n: number) => plan.one(`Question ${n}: `);

  it('JV-16: answers questions 1, 2, 9 and 10 by rule, flagged where they rest on an inference, and asks the AI the '
    + 'rest in the standard scope', async () => {
    const plan = await planOf(vhlStep3FilledHtml, VHL_COMPANY);
    // RULES edit 12: the labels keep their "Question N:" prefix; the rules read past it (ruleText).
    expect(classifyByRules(question(plan, 1))).toMatchObject({ category: 'education.highSchool',
      rule: 'label.high-school' });
    expect(plan.write(question(plan, 1))).toMatchObject({ value: { cleanLabel: 'Yes' },
      origin: { provenance: 'rule', ruleId: 'education.high-school' } });
    expect(plan.row(question(plan, 1))).toMatchObject({ status: 'verified' });
    // 10+ years in engineering: the golden profile's seven years as an engineer fall short.
    expect(classifyByRules(question(plan, 2))).toMatchObject({ category: 'experience.yearsIn', rule: 'label.years-in' });
    expect(plan.write(question(plan, 2))).toMatchObject({ value: { cleanLabel: 'No' },
      origin: { provenance: 'rule', ruleId: 'experience.years-in' } });
    expect(plan.row(question(plan, 2))).toMatchObject({ status: 'flagged', reason: 'filled-low-confidence' });
    // 5+ years in a DevOps role: no title names it, and the years reach five: the AI's.
    expect(plan.row(question(plan, 3))).toMatchObject({ category: 'experience.yearsIn', reason: 'no-profile-value' });
    expect(plan.write(question(plan, 3))).toBeUndefined();
    expect(plan.asked(question(plan, 3))).toEqual(['answers:standard']);
    // Experience with AWS, Terraform, scripting, CI/CD and Linux: none named by the golden skills or entries.
    for (const n of [4, 5, 6, 7, 8]) {
      expect(classifyByRules(question(plan, n)), `Q${n}`).toMatchObject({ category: 'skills.experienceWith',
        rule: 'label.experience-with' });
      expect(plan.write(question(plan, n)), `Q${n}`).toBeUndefined();
      expect(plan.asked(question(plan, n)), `Q${n}`).toEqual(['answers:standard']);
    }
    // Austin, TX is in the Central zone (Texas lies in two zones: flagged).
    expect(classifyByRules(question(plan, 9))).toMatchObject({ category: 'location.inTimeZone',
      rule: 'label.in-time-zone' });
    expect(plan.write(question(plan, 9))).toMatchObject({ value: { cleanLabel: 'No' },
      origin: { provenance: 'rule', ruleId: 'location.time-zone', path: 'address.region' } });
    expect(plan.row(question(plan, 9))).toMatchObject({ status: 'flagged', reason: 'filled-low-confidence' });
    // RULES item 19 (JV-17): Boston, MA is not within reach of Austin, TX.
    expect(classifyByRules(question(plan, 10))).toMatchObject({ category: 'location.residesIn',
      rule: 'label.resides-in' });
    expect(plan.write(question(plan, 10))).toMatchObject({
      value: { cleanLabel: 'Currently reside outside commutable distance' },
      origin: { provenance: 'rule', ruleId: 'location.not-there' } });
    expect(plan.row(question(plan, 10))).toMatchObject({ status: 'flagged', reason: 'filled-low-confidence' });
  });

  it('JV-16 with variants: a New Yorker is in the Eastern zone, a Bostonian\'s commute is theirs, and Python answers the '
    + 'scripting question', async () => {
    const newYork = await planOf(vhlStep3FilledHtml, VHL_COMPANY, { profile: livingIn('NY', 'New York', 'New York') });
    expect(newYork.write(question(newYork, 9))).toMatchObject({ value: { cleanLabel: 'Yes' } });
    expect(newYork.row(question(newYork, 9))).toMatchObject({ status: 'verified' });
    const boston = await planOf(vhlStep3FilledHtml, VHL_COMPANY, { profile: livingIn('MA', 'Massachusetts', 'Boston') });
    expect(boston.write(question(boston, 10))).toBeUndefined();
    expect(boston.row(question(boston, 10))).toMatchObject({ category: 'location.residesIn', status: 'flagged' });
    const python = await planOf(vhlStep3FilledHtml, VHL_COMPANY, { profile: { ...golden,
      skills: [...golden.skills, 'Python'] } });
    expect(python.write(question(python, 6))).toMatchObject({ value: { cleanLabel: 'Yes' },
      origin: { provenance: 'rule', ruleId: 'skills.experience-with', path: 'skills' } });
  });

  // jr6 regression of RULES (reported in SP\jr6\build\JOBVITE.md, P2): VHL's own wording is "experience with using
  // <tool>", and labelRules.ts EXPERIENCE_WITH takes "using terraform" as the tool, so values.ts experienceWithValue
  // never finds it among the skills. Remove `.fails` once RULES reads past "using".
  it.fails('JV-16 (RULES regression): "Do you have experience with using Terraform?" is Yes for a profile whose skills '
    + 'name Terraform', async () => {
    const plan = await planOf(vhlStep3FilledHtml, VHL_COMPANY, { profile: { ...golden,
      skills: [...golden.skills, 'Terraform'] } });
    expect(plan.write(question(plan, 5))).toMatchObject({ value: { cleanLabel: 'Yes' },
      origin: { provenance: 'rule', ruleId: 'skills.experience-with', path: 'skills' } });
  });

  it('JV-5: the qualifications checklist ticks, flagged, only the options naming the person\'s degree or skill',
    async () => {
      const plan = await planOf(vhlStep3FilledHtml, VHL_COMPANY);
      const checklist = plan.one('Please select the education, skills and/or experience');
      expect(checklist.kind).toBe('checkbox-group');
      expect(classifyByRules(checklist)).toMatchObject({ category: 'skills.list', rule: 'label.skills' });
      // The bachelor's degree names the first (synthetic) option; PostgreSQL the third. Publishing, Chef and Packer, and
      // GitHub Actions name nothing the person holds.
      expect(plan.write(checklist)).toMatchObject({ value: { kind: 'options', cleanLabels: [lines(qualificationOption)[0],
        '3. Experience with relational databases (such as PostgreSQL and MySQL)'] },
      origin: { provenance: 'rule', ruleId: 'skills.qualifications', path: 'skills' } });
      expect(plan.row(checklist)).toMatchObject({ category: 'skills.list', status: 'flagged',
        reason: 'filled-low-confidence', needsUserAction: false });
      // A person with no degree and none of the skills: nothing ticked; the required list waits for them.
      const none = await planOf(vhlStep3FilledHtml, VHL_COMPANY, { profile: { ...golden, education: [],
        skills: ['Rust'] } });
      const left = none.one('Please select the education, skills and/or experience');
      expect(none.write(left)).toBeUndefined();
      expect(none.row(left)).toMatchObject({ status: 'flagged', needsUserAction: true });
    });
});

describe('jr6 JOBVITE P2 on Sikich\'s step 3 (jr6-sikich-step3, -filled): jobvite-new-1, JV-6, jobvite-new-5', () => {
  const NON_COMPETE = 'Are you currently subject to a non-compete';
  const RESTRICTS = 'If yes, do the terms of the agreement restrict you';
  const WORKED = 'Have you previously worked for Sikich?';
  const LEFT_WHEN = 'If yes, when did you leave?';
  /** The page showing `answer` ticked in the radio group whose question starts with `question` (a person's choice,
   *  drawn by the test: the captures hold none). */
  const shown = (question: string, answer: string) => (doc: Document) => {
    const group = Array.from(doc.querySelectorAll('fieldset.jv-input-group'))
      .find((set) => words(set.querySelector('legend')).startsWith(question))!;
    const row = Array.from(group.querySelectorAll('label.jv-input-group-row')).find((each) => words(each) === answer)!;
    row.querySelector<HTMLInputElement>('input[type="radio"]')!.checked = true;
  };
  const answeredNo = (): Profile => ({ ...golden, screening: { ...golden.screening, restrictiveAgreement: no } });

  it('jobvite-new-1: the non-compete question is a restrictive agreement, asked of the AI in the `all` scope only',
    async () => {
      const plan = await planOf(sikichStep3Html, SIKICH_COMPANY);
      const nonCompete = plan.one(NON_COMPETE);
      expect(classifyByRules(nonCompete)).toMatchObject({ category: 'screening.restrictiveAgreement',
        rule: 'label.restrictive-agreement' });
      expect(plan.row(nonCompete)).toMatchObject({ category: 'screening.restrictiveAgreement',
        reason: 'legal-not-in-profile' });
      expect(plan.asked(nonCompete)).toEqual(['answers:all']);
      // The AI answers mode "Profile only": not asked.
      const profileOnly = await planOf(sikichStep3Html, SIKICH_COMPANY, { settings: { ...DEFAULT_SETTINGS,
        modes: { ...DEFAULT_SETTINGS.modes, ai: 'profile' } } });
      expect(profileOnly.asked(profileOnly.one(NON_COMPETE))).toEqual([]);
      // The person's own answer comes first.
      const answered = await planOf(sikichStep3Html, SIKICH_COMPANY, { profile: answeredNo() });
      expect(answered.write(answered.one(NON_COMPETE))).toMatchObject({ value: { cleanLabel: 'No' },
        origin: { provenance: 'profile', path: 'screening.restrictiveAgreement' } });
    });

  it('JV-6: the follow-up takes its one "Not Applicable" once the answer above is No, written or shown, flagged',
    async () => {
      // The answer above unknown (the AI's): the follow-up waits.
      const plan = await planOf(sikichStep3Html, SIKICH_COMPANY);
      const restricts = plan.one(RESTRICTS);
      expect(optionLabels(restricts)).toEqual(['Yes', 'No', 'Not Applicable']);
      expect(plan.write(restricts)).toBeUndefined();
      expect(plan.row(restricts)).toMatchObject({ reason: 'conditional-question' });
      // The profile's No, written above.
      const byProfile = await planOf(sikichStep3Html, SIKICH_COMPANY, { profile: answeredNo() });
      expect(byProfile.write(byProfile.one(RESTRICTS))).toMatchObject({ value: { cleanLabel: 'Not Applicable' },
        origin: { provenance: 'rule', ruleId: 'conditional.not-applicable' } });
      expect(byProfile.row(byProfile.one(RESTRICTS))).toMatchObject({ status: 'flagged' });
      // The person's No, shown on the filled page; their Yes leaves the follow-up to them.
      const shownNo = await planOf(sikichStep3FilledHtml, SIKICH_COMPANY, {}, shown(NON_COMPETE, 'No'));
      expect(written(shownNo.write(shownNo.one(RESTRICTS)))).toBe('Not Applicable');
      const shownYes = await planOf(sikichStep3FilledHtml, SIKICH_COMPANY, {}, shown(NON_COMPETE, 'Yes'));
      expect(shownYes.write(shownYes.one(RESTRICTS))).toBeUndefined();
    });

  it('jobvite-new-5: "If yes, when did you leave?" is never classified while the answer above is No', async () => {
    const plan = await planOf(sikichStep3Html, SIKICH_COMPANY);
    expect(plan.write(plan.one(WORKED))).toMatchObject({ value: { cleanLabel: 'No' },
      origin: { provenance: 'rule', ruleId: 'screening.previously-employed' } });
    const left = plan.one(LEFT_WHEN);
    expect(left.required).toBe(false);
    expect(plan.row(left)).toMatchObject({ status: 'skipped', reason: 'conditional-question' });
    expect(plan.asked(left)).toEqual([]);
    // A former Sikich employee: Yes above, and the follow-up is classified as before.
    const former = await planOf(sikichStep3Html, SIKICH_COMPANY, { profile: workedAt(SIKICH_COMPANY) });
    expect(written(former.write(former.one(WORKED)))).toBe('Yes');
    expect(former.asked(former.one(LEFT_WHEN))).toEqual(['classify']);
  });
});

describe('jr6 JOBVITE P2 on NinjaOne\'s pages: JV-9, JV-14, JV-7, JV-8, JV-13, JV-15, JV-17', () => {
  it('JV-9 (ninjaone-consent-empty): the residence select takes the one real option, the Global English policy, flagged',
    async () => {
      const plan = await planOf(ninjaConsentEmptyHtml, NINJA_COMPANY);
      const residence = plan.one('Location of Residence and Language');
      expect(classifyByRules(residence)).toMatchObject({ category: 'location.policyResidence',
        rule: 'label.policy-residence' });
      expect(plan.write(residence)).toMatchObject({
        value: { cleanLabel: 'Global NinjaOne Candidate Privacy Policy - English' },
        origin: { provenance: 'rule', ruleId: 'location.policy-residence' } });
      expect(plan.row(residence)).toMatchObject({ status: 'flagged', reason: 'filled-low-confidence',
        needsUserAction: false });
    });

  it.each([['ninjaone-step1', ninjaStep1Html], ['ninjaone-step1-resume', ninjaStep1ResumeHtml]] as const)(
    'JV-14 and RULES edit 21 (%s): the text consent is Yes on the consent\'s terms; the chosen names are typed',
    async (_name, html) => {
      const plan = await planOf(html, NINJA_COMPANY);
      const text = plan.one('Can NinjaOne text you about your application?');
      expect(classifyByRules(text)).toMatchObject({ asks: 'consent.sms', rule: 'label.consent-sms' });
      expect(plan.row(text)).toMatchObject({ category: 'consent.sms', status: 'verified' });
      expect(plan.write(text)).toMatchObject({ value: { cleanLabel: 'Yes' },
        origin: { provenance: 'rule', ruleId: 'consent.preapproved' } });
      // Consents: Required only: the page requires it, so the required rule says Yes.
      const cautious = await planOf(html, NINJA_COMPANY, { settings: CAUTIOUS_SETTINGS });
      expect(cautious.write(cautious.one('Can NinjaOne text you'))).toMatchObject({ value: { cleanLabel: 'Yes' },
        origin: { provenance: 'rule', ruleId: 'consent.required' } });
      // RULES item 49: "Chosen First Name" is the preferred name (the golden profile has none: its first name), flagged
      // because the page's autocomplete="given-name" names the first name; "Chosen Last Name" is the last name.
      const first = plan.one('Chosen First Name');
      expect(plan.write(first)).toMatchObject({ value: { kind: 'text', text: 'Alex' } });
      expect(plan.row(first)).toMatchObject({ category: 'identity.preferredName', reason: 'classification-conflict',
        needsUserAction: false });
      const last = plan.one('Chosen Last Name');
      expect(plan.write(last)).toMatchObject({ value: { kind: 'text', text: 'Rivera' } });
      expect(plan.row(last)).toMatchObject({ category: 'identity.lastName', status: 'verified' });
    });

  it('JV-7 (ninjaone-step3): "What is your US Work Authorization type?" is the status: the AI\'s for the golden '
    + 'profile, the status\'s own option when the profile states it', async () => {
    const plan = await planOf(ninjaStep3Html, NINJA_COMPANY);
    const type = plan.one('What is your US Work Authorization type?');
    expect(classifyByRules(type)).toMatchObject({ category: 'workAuth.status', rule: 'label.work-auth-status' });
    expect(plan.row(type)).toMatchObject({ category: 'workAuth.status', status: 'flagged',
      reason: 'legal-not-in-profile' });
    expect(plan.asked(type)).toEqual(['answers:all']);
    const typeFor = async (profile: Profile) => {
      const variant = await planOf(ninjaStep3Html, NINJA_COMPANY, { profile });
      return variant.write(variant.one('What is your US Work Authorization type?'));
    };
    expect(await typeFor(withAuth([settledIn('US', statusOf('citizen'))]))).toMatchObject({
      value: { cleanLabel: 'US Citizen' },
      origin: { provenance: 'profile', path: 'workAuthorization[0].status', transform: 'legal.work-status' } });
    expect(written(await typeFor(withAuth([settledIn('US', statusOf('permanent-resident'))])))).toBe('Permanent Resident');
    expect(await typeFor(withAuth([settledIn('US')], ['US']))).toMatchObject({ value: { cleanLabel: 'US Citizen' },
      origin: { path: 'screening.citizenships' } });
  });

  it('JV-8 (ninjaone-step3): "In which state do you currently live?" is the state lived in: TX, else "none of these"',
    async () => {
      const plan = await planOf(ninjaStep3Html, NINJA_COMPANY);
      const state = plan.one('In which state do you currently live?');
      // RULES edit 12 (label contract): the list keeps its "none of these".
      expect(optionLabels(state).at(-1)).toBe('none of these');
      expect(classifyByRules(state)).toMatchObject({ category: 'address.region', rule: 'label.residence-state' });
      expect(plan.write(state)).toMatchObject({ value: { cleanLabel: 'TX' },
        origin: { provenance: 'profile', path: 'address.region' } });
      const alaska = await planOf(ninjaStep3Html, NINJA_COMPANY, { profile: livingIn('AK', 'Alaska') });
      expect(written(alaska.write(alaska.one('In which state do you currently live?')))).toBe('none of these');
    });

  it('JV-13 (ninjaone-step3): "Are you a current NinjaOne Employee" is No, Yes for a current employee there', async () => {
    const plan = await planOf(ninjaStep3Html, NINJA_COMPANY);
    const current = plan.one('Are you a current NinjaOne Employee');
    expect(classifyByRules(current)).toMatchObject({ category: 'screening.previouslyEmployed',
      rule: 'label.previously-employed' });
    expect(plan.write(current)).toMatchObject({ value: { cleanLabel: 'No' },
      origin: { provenance: 'rule', ruleId: 'screening.previously-employed' } });
    expect(plan.row(current)).toMatchObject({ status: 'verified' });
    const there = await planOf(ninjaStep3Html, NINJA_COMPANY, { profile: workedAt(NINJA_COMPANY, true) });
    expect(written(there.write(there.one('Are you a current NinjaOne Employee')))).toBe('Yes');
  });

  it('JV-15 (ninjaone-step3): the referral pair: No from the profile\'s referral source, and the N/A its follow-up asks '
    + 'for', async () => {
    const plan = await planOf(ninjaStep3Html, NINJA_COMPANY);
    const referred = plan.one('Were you referred to this role by a current NinjaOne employee?');
    expect(classifyByRules(referred)).toMatchObject({ category: 'referral.employeeReferred',
      rule: 'label.employee-referred' });
    expect(plan.write(referred)).toMatchObject({ value: { cleanLabel: 'No, I was not referred' },
      origin: { provenance: 'rule', ruleId: 'referral.not-employee' } });
    expect(plan.row(referred)).toMatchObject({ status: 'flagged', reason: 'filled-low-confidence' });
    const name = plan.one('If yes, please provide their name or enter N/A if you were not referred.');
    expect(classifyByRules(name)).toMatchObject({ category: 'referral.referrerName', rule: 'label.referrer' });
    expect(plan.write(name)).toMatchObject({ value: { kind: 'text', text: 'N/A' },
      origin: { provenance: 'rule', ruleId: 'placeholder.no-profile' } });
  });

  it('JV-17 (ninjaone-step3): the Illinois question is a residence question; a person living in Illinois gets nothing '
    + 'from the rule', async () => {
    const plan = await planOf(ninjaStep3Html, NINJA_COMPANY);
    const chicago = plan.one('If you live in Illinois, is your address in the City of Chicago?');
    expect(classifyByRules(chicago)).toMatchObject({ category: 'location.residesIn', rule: 'label.resides-in' });
    expect(plan.asked(chicago)).toEqual([]);
    const local = await planOf(ninjaStep3Html, NINJA_COMPANY, { profile: livingIn('IL', 'Illinois', 'Springfield') });
    const theirs = local.one('If you live in Illinois');
    expect(local.write(theirs)).toBeUndefined();
    expect(local.row(theirs)).toMatchObject({ category: 'location.residesIn', status: 'flagged' });
  });

  // jr6 regression of RULES (reported in SP\jr6\build\JOBVITE.md, P2): the page's own options are "N/A - I do not live
  // in Illinois.", "No - I am in Illinois and outside of Chicago, IL." and "Yes - My address is in Chicago, IL.";
  // policy.ts NOT_THERE_OPTION's `\boutside\b` also reads the second, so residesInValue finds two options and chooses
  // none (no-match). RULES' own test used "Yes" and "No" in their place. Remove `.fails` once RULES reads only the
  // option that says the person lives elsewhere.
  it.fails('JV-17 (RULES regression): NinjaOne\'s Illinois question takes "N/A - I do not live in Illinois." for the '
    + 'golden profile (Austin, TX)', async () => {
    const plan = await planOf(ninjaStep3Html, NINJA_COMPANY);
    const chicago = plan.one('If you live in Illinois, is your address in the City of Chicago?');
    expect(plan.write(chicago)).toMatchObject({ value: { cleanLabel: 'N/A - I do not live in Illinois.' },
      origin: { provenance: 'rule', ruleId: 'location.not-there' } });
    expect(plan.row(chicago)).toMatchObject({ status: 'flagged', reason: 'filled-low-confidence' });
  });
});

describe('jr6 JOBVITE P2 JV-24: Send Application\'s confirmation drawn in the same document (ENGINE E2 newSuccessSign)',
  () => {
    const LAST_STEPS = [['jr6-vhl-step3-filled to jr6-vhl-confirmation', vhlStep3FilledHtml, vhlConfirmationHtml,
      'Application Sent!'], ['jr6-sikich-step3 to jr6-sikich-confirmation', sikichStep3Html, sikichConfirmationHtml,
      'Well Done, Application Sent!']] as const;

    /** The last step, armed as a press of Send Application arms it (content/submitted.ts PressSnapshot). */
    async function armed(html: string) {
      const fixture = await load(html);
      const root = jobviteAdapter.detect(fixture.doc)!.formRoot;
      return { ...fixture, root, arm: { before: shownSignsOf(fixture.doc, 'jobvite'), root, adapter: jobviteAdapter } };
    }

    it.each(LAST_STEPS)('%s: the body stays, the form goes, and the sign is this Submit\'s',
      async (_name, stepHtml, confirmationHtml, header) => {
        const { doc, view, root, arm } = await armed(stepHtml);
        expect(root).toBe(doc.body);
        expect([...arm.before]).toEqual([]);
        expect(newSuccessSign(doc, 'jobvite', arm)).toBeNull();
        // The page turns as AngularJS turns it: the same body, given the confirmation capture's class and content.
        const confirmation = new view.DOMParser().parseFromString(confirmationHtml, 'text/html');
        doc.body.className = confirmation.body.className;
        doc.body.replaceChildren(...Array.from(confirmation.body.childNodes, (node) => doc.importNode(node, true)));
        expect(root.isConnected).toBe(true);
        expect(jobviteAdapter.detect(doc)).toBeNull();
        const sign = newSuccessSign(doc, 'jobvite', arm);
        expect(words(sign)).toBe(header);
        expect(sign).toBe(doc.querySelector('article.jv-page-body[role="main"] h2.jv-page-message-header'));
        // A sign already shown at the press is no new one.
        expect(newSuccessSign(doc, 'jobvite', { ...arm, before: new Set([sign!]) })).toBeNull();
      });

    it.each(LAST_STEPS)('%s: nothing is recorded while the apply form is still in the page, though the message shows '
      + '(the body still answers as the root)', async (_name, stepHtml, confirmationHtml, header) => {
      const { doc, view, root, arm } = await armed(stepHtml);
      const confirmation = new view.DOMParser().parseFromString(confirmationHtml, 'text/html');
      const message = confirmation.querySelector('article.jv-page-body[role="main"] .jv-page-message')!;
      doc.querySelector('article.jv-page-body[role="main"]')!.append(doc.importNode(message, true));
      expect(signsOf(doc, 'jobvite').map(words)).toEqual([header]);
      expect(successShown(doc, 'jobvite')).toBe(true);
      expect(jobviteAdapter.detect(doc)?.formRoot).toBe(root);
      expect(newSuccessSign(doc, 'jobvite', arm)).toBeNull();
    });
  });
