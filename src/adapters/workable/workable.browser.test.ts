/*
 * The Workable adapter on the live capture of 2026-11-02 (docs/FIXTURES.md, "The Workable capture"): its hooks on the
 * snapshots, the scan held against each case's hand-written expectations, and what the generic adapter made of the same
 * page before (the capture's report, §9: every dropdown read-only, the date boxes a phone's keypad, Resume and Photo
 * both "Choose file", the GDPR consent optional).
 */
import { afterEach, describe, expect, it } from 'vitest';
import blueAtExpect from '../../../fixtures/workable/blueground-at-closed.expect.json';
import blueAtHtml from '../../../fixtures/workable/blueground-at-closed.html?raw';
import gdprHtml from '../../../fixtures/workable/blueground-at-gdpr-ticked.html?raw';
import bluegroundExpect from '../../../fixtures/workable/blueground-closed.expect.json';
import bluegroundHtml from '../../../fixtures/workable/blueground-closed.html?raw';
import tickedHtml from '../../../fixtures/workable/cloudfactory-checkbox-ticked.html?raw';
import cloudfactoryExpect from '../../../fixtures/workable/cloudfactory-closed.expect.json';
import cloudfactoryHtml from '../../../fixtures/workable/cloudfactory-closed.html?raw';
import datepickerHtml from '../../../fixtures/workable/cloudfactory-datepicker-open.html?raw';
import cvectorExpect from '../../../fixtures/workable/cvector-closed.expect.json';
import cvectorHtml from '../../../fixtures/workable/cvector-closed.html?raw';
import hfExpect from '../../../fixtures/workable/huggingface-closed.expect.json';
import hfHtml from '../../../fixtures/workable/huggingface-closed.html?raw';
import overviewHtml from '../../../fixtures/workable/huggingface-overview.html?raw';
import labellaExpect from '../../../fixtures/workable/labella-closed.expect.json';
import labellaHtml from '../../../fixtures/workable/labella-closed.html?raw';
import dropdownOpenHtml from '../../../fixtures/workable/labella-dropdown-open.html?raw';
import editorExpect from '../../../fixtures/workable/labella-education-editor.expect.json';
import editorHtml from '../../../fixtures/workable/labella-education-editor.html?raw';
import countriesHtml from '../../../fixtures/workable/labella-phone-countries-open.html?raw';
import radioHtml from '../../../fixtures/workable/labella-radio-chosen.html?raw';
import yesnoHtml from '../../../fixtures/workable/labella-yesno-chosen.html?raw';
import verneekExpect from '../../../fixtures/workable/verneek-closed.expect.json';
import verneekHtml from '../../../fixtures/workable/verneek-closed.html?raw';
import ashbyHtml from '../../../fixtures/ashby/openai-closed.html?raw';
import trapHtml from '../../../fixtures/traps/01-white-on-white.html?raw';
import { assertNotSubmit } from '../../dom/fillers';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { scan } from '../../dom/scan';
import { listOf } from '../../dom/widgets';
import { chosenLabels, readList, readShownList } from '../../dom/widgets/options';
import { genericAdapter } from '../generic';
import { compareWithExpectation, readExpectation, scanCase, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { WORKABLE_SNAPSHOTS, workableAdapter, workableSubmitted } from './index';
import { parseWorkableUrl } from './url';

const LABELLA = 'https://apply.workable.com/labella-associates/j/7716B84ADC/apply/';
const CLOUDFACTORY = 'https://apply.workable.com/cloudfactory/j/B87C206E75/apply/';
const BLUEGROUND = 'https://apply.workable.com/blueground/j/BA193E747D/apply/';
const BLUEGROUND_AT = 'https://apply.workable.com/blueground/j/6C6B4B42F5/apply/';
const HF = 'https://apply.workable.com/huggingface/j/F88446C814/apply/';

const CASES = [
  { name: 'labella-closed', html: labellaHtml, expectation: readExpectation(labellaExpect) },
  { name: 'cloudfactory-closed', html: cloudfactoryHtml, expectation: readExpectation(cloudfactoryExpect) },
  { name: 'verneek-closed', html: verneekHtml, expectation: readExpectation(verneekExpect) },
  { name: 'blueground-closed', html: bluegroundHtml, expectation: readExpectation(bluegroundExpect) },
  { name: 'blueground-at-closed', html: blueAtHtml, expectation: readExpectation(blueAtExpect) },
  { name: 'huggingface-closed', html: hfHtml, expectation: readExpectation(hfExpect) },
  { name: 'cvector-closed', html: cvectorHtml, expectation: readExpectation(cvectorExpect) },
  // The capture's states, each the same form as its closed one: an Education entry's editor open.
  { name: 'labella-education-editor', html: editorHtml, expectation: readExpectation(editorExpect) },
] as const;

async function loadWorkable(html: string) {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const root = workableAdapter.detect(fixture.doc)!.formRoot;
  return { ...fixture, root };
}

/** A scan's field whose label matches. */
function fieldOf(root: Element, label: RegExp) {
  const result = scan(root, workableAdapter, { platform: 'workable' });
  const field = result.fields.find((candidate) => label.test(candidate.label));
  if (field === undefined) throw new Error(`no field ${String(label)}`);
  return { field, target: result.target(field.key)! };
}

describe('the Workable adapter: its hooks on the snapshots', () => {
  afterEach(() => removeFixtures(document));

  it('takes form[data-ui=application-form] holding its fields as the root, and finds none on other pages', async () => {
    for (const { html } of CASES) {
      const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
      expect(workableAdapter.detect(fixture.doc)?.formRoot.matches('form[data-ui="application-form"]')).toBe(true);
      removeFixtures(document);
    }
    for (const html of [overviewHtml, ashbyHtml, trapHtml]) {
      const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
      expect(workableAdapter.detect(fixture.doc)).toBeNull();
      removeFixtures(document);
    }
    // The form before React draws its fields is none; after Submit, Workable's panel is the sign.
    const page = await loadWorkable(labellaHtml);
    expect(workableSubmitted(page.doc)).toBe(false);
    expect(workableAdapter.isFinalStep!(page.doc)).toBe('final');
    page.root.querySelectorAll('[data-ui="section-fields"]').forEach((fields) => fields.remove());
    expect(workableAdapter.detect(page.doc)).toBeNull();
    const done = page.doc.createElement('div');
    done.setAttribute('data-ui', 'successful-submit');
    page.root.replaceWith(done);
    expect(workableSubmitted(page.doc)).toBe(true);
    expect(workableAdapter.isFinalStep!(page.doc)).toBe('unknown');
  });

  it.each(CASES)('$name: the scan matches the hand-written expectations', async ({ name, html, expectation }) => {
    const address = { 'labella-closed': LABELLA, 'labella-education-editor': LABELLA, 'cloudfactory-closed': CLOUDFACTORY,
      'verneek-closed': 'https://apply.workable.com/verneek/j/ED81AD77CE/apply/', 'blueground-closed': BLUEGROUND,
      'blueground-at-closed': BLUEGROUND_AT, 'huggingface-closed': HF,
      'cvector-closed': 'https://apply.workable.com/cvector/j/657DA97574/apply/' }[name];
    const scanned = await scanCase(document, html, address);
    expect(scanned.adapter.id).toBe('workable');
    expect(compareWithExpectation(scanned.doc, scanned.result, expectation)).toEqual([]);
  });

  it('declares every dropdown read-only by design, its list drawn in place and labelled by its option labels', async () => {
    const page = await loadWorkable(dropdownOpenHtml);
    const input = page.doc.querySelector<HTMLInputElement>('#input_QA_11713820_input')!;
    expect(input.readOnly).toBe(true);
    const decl = workableAdapter.widgetFor!(input)!;
    expect(decl).toMatchObject({ kind: 'combobox', opener: input, expanded: input, keys: ['Escape'], keyTarget: 'list',
      readOnlyBox: true, highlightIsNoChoice: true });
    expect(decl.snapshot).toBe(WORKABLE_SNAPSHOTS[0]);
    const list = listOf(input, input)!;
    expect(list.matches('ul[role="listbox"]')).toBe(true);
    expect(list.closest('[data-input-type="select"]')).not.toBeNull();
    expect(readShownList(list, undefined, decl.optionLabel ?? undefined).options.map((option) => option.label))
      .toEqual(['1-3', '4-6', '7-9', '10+']);
    // The scan reads the list shown whole, and the field stays writable.
    const { field, target } = fieldOf(page.root, /how many years of work-related experience/i);
    expect(field).toMatchObject({ kind: 'combobox', readOnly: false, required: true, labelSource: 'aria-labelledby' });
    expect(field.options === 'lazy' ? [] : field.options.map((option) => option.label)).toEqual(['1-3', '4-6', '7-9', '10+']);
    expect(chosenLabels(target.widget!, ['1-3', '4-6', '7-9', '10+'])).toEqual([]);
    // Without the adapter, the same box is read-only, so never written.
    const generic = scan(page.root, genericAdapter, { platform: 'workable' }).fields
      .find((each) => /how many years of work-related experience/i.test(each.label));
    expect(generic).toMatchObject({ kind: 'combobox', readOnly: true });
  });

  it("reads the phone country list's 244 countries and the country the button shows", async () => {
    const page = await loadWorkable(countriesHtml);
    const button = page.doc.querySelector('.iti button.iti__selected-country')!;
    expect(workableAdapter.widgetRoots!(page.root)).toEqual([button]);
    const decl = workableAdapter.widgetFor!(button)!;
    expect(decl).toMatchObject({ kind: 'combobox', opener: button, expanded: button, keyTarget: 'list' });
    // The list scrolls: the view shows a few, a read scrolls it through.
    expect(readShownList(listOf(button, null)!).options.length).toBeLessThan(244);
    const read = await readList(listOf(button, null)!);
    expect(read.complete).toBe(true);
    const options = read.options.map((option) => option.label);
    expect(options).toHaveLength(244);
    expect(options.slice(0, 5)).toEqual(['United States (+1)', 'United Kingdom (+44)', 'Canada (+1)', 'Germany (+49)',
      'Australia (+61)']);
    expect(decl.shownAnswer!(options)).toBe('United States (+1)');
    expect(decl.shownAnswer!([])).toBe('United States (+1)');
    expect(workableAdapter.labelSuffix!(button)).toBe('country code');
    expect(assertNotSubmit(button, { adapter: workableAdapter, root: page.root }).ok).toBe(true);
  });

  it('reads the answers the states show by aria-checked, which the converter kept (checkedOf)', async () => {
    const shown = (doc: Document, name: string) => Array.from(doc.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`))
      .filter((input) => input.closest('[role="radio"], [role="checkbox"]')?.getAttribute('aria-checked') === 'true');
    for (const [html, name, pattern] of [[radioHtml, 'CA_21782', /legally eligible/], [yesnoHtml, 'QA_11713819', /bachelor's degree/i]] as const) {
      const page = await loadWorkable(html);
      const chosen = shown(page.doc, name);
      expect(chosen).toHaveLength(1);
      expect(workableAdapter.checkedOf!(chosen[0]!)).toBe(true);
      expect(chosen[0]!.checked).toBe(false);
      const { field } = fieldOf(page.root, pattern);
      expect(field.current.kind).toBe('selected');
      // The generic adapter reads the inputs' own state: nothing chosen.
      const generic = scan(page.root, genericAdapter, { platform: 'workable' }).fields.find((each) => each.key === field.key);
      expect(generic?.current).toEqual({ kind: 'empty' });
      removeFixtures(document);
    }
    const ticked = await loadWorkable(tickedHtml);
    expect(fieldOf(ticked.root, /linguistic subfields/).field.current).toEqual({ kind: 'selected', labels: ['Semantics'] });
    removeFixtures(document);
    const gdpr = await loadWorkable(gdprHtml);
    const consent = fieldOf(gdpr.root, /privacy notice/i).field;
    expect(consent).toMatchObject({ kind: 'checkbox', required: true, current: { kind: 'checked', checked: true } });
  });

  it('reads the date box beside its open calendar, and the calendar is no field', async () => {
    const scanned = await scanCase(document, datepickerHtml, CLOUDFACTORY);
    expect(scanned.doc.querySelector('.react-datepicker-popper')).not.toBeNull();
    expect(compareWithExpectation(scanned.doc, scanned.result, readExpectation(cloudfactoryExpect))).toEqual([]);
    const date = scanned.doc.querySelector('input[name="CA_3905"]')!;
    expect(workableAdapter.formatFor!(date)).toEqual({ format: 'date', pattern: 'MM/DD/YYYY' });
    expect(workableAdapter.keyAroundWrite!(date)).toBe('Escape');
    expect(workableAdapter.keyAroundWrite!(scanned.doc.querySelector('#firstname')!)).toBeNull();
  });

  it('labels Resume and Photo by their questions, and pairs each with its "Choose file"', async () => {
    const page = await loadWorkable(bluegroundHtml);
    const widgets = workableAdapter.uploadWidgets!(page.root);
    expect(widgets.map(({ control, input }) => [control.textContent, input.getAttribute('data-ui')]))
      .toEqual([['Choose file', 'avatar'], ['Choose file', 'resume']]);
    const result = scan(page.root, workableAdapter, { platform: 'workable' });
    expect(result.fields.filter((field) => field.kind === 'file').map((field) => [field.label, field.required, field.proxy]))
      .toEqual([['Photo', false, 'label'], ['Resume', true, 'label']]);
    const generic = scan(page.root, genericAdapter, { platform: 'workable' }).fields.filter((field) => field.kind === 'file');
    expect(generic.map((field) => field.label)).toEqual(['Choose file', 'Choose file']);
  });

  it('leaves the autofill box out, never presses what sits beside the fields, and identifies Submit', async () => {
    const page = await loadWorkable(labellaHtml);
    const box = workableAdapter.excluded!(page.root);
    expect(box).toHaveLength(1);
    expect(box[0]!.parentElement).toBe(page.root);
    expect(box[0]!.querySelector('[data-ui="autofill-button"] button')).not.toBeNull();
    const never = workableAdapter.neverPress!(page.root);
    const ctx = { adapter: workableAdapter, root: page.root };
    for (const selector of ['[data-ui="autofill-button"] button', '[data-ui="clear-section-0"]', 'label[role="button"][for]',
      '[data-role="dropzone"]', 'button[data-ui="cookie-consent-accept"]', 'a[data-ui="role-overview-tab"]',
      'a[data-ui="application-form-tab"]', 'a[data-ui="view-jobs-url"]']) {
      const el = page.doc.querySelector(selector);
      expect(el, selector).not.toBeNull();
      expect(never.some((each) => each === el || each.contains(el!)), selector).toBe(true);
      expect(assertNotSubmit(el!, ctx).ok, selector).toBe(false);
    }
    const submit = workableAdapter.submitButton!(page.root)!;
    expect(submit.matches('button[data-ui="apply-button"][type="submit"]')).toBe(true);
    expect(assertNotSubmit(submit, ctx).ok).toBe(false);
    // "+ Add" and the phone's country button may be pressed.
    for (const selector of ['[data-ui="education"] [data-ui="add-section"]', '.iti button.iti__selected-country']) {
      expect(assertNotSubmit(page.doc.querySelector(selector)!, ctx).ok, selector).toBe(true);
    }
  });

  it("reads the overview's posting text, and its entry links open this posting's form", async () => {
    const fixture = await loadFixture(document, overviewHtml, SNAPSHOT_VIEWPORT);
    expect(workableAdapter.detect(fixture.doc)).toBeNull();
    const posting = workableAdapter.postingText!(fixture.doc)!;
    for (const part of ['job-description', 'job-requirements', 'job-benefits']) {
      expect(posting.querySelector(`[data-ui="${part}"]`), part).not.toBeNull();
    }
    const links = Array.from(fixture.doc.querySelectorAll<HTMLAnchorElement>('a[data-ui="apply-button"][href], '
      + 'a[data-ui="application-form-tab"][href]'));
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(parseWorkableUrl(new URL(link.getAttribute('href')!, HF))).toMatchObject({ page: 'application',
        applicationUrl: HF });
    }
    expect(workableAdapter.entryNeverPressed).toBe(true);
    const never = workableAdapter.neverPress!(fixture.doc.body);
    expect(links.every((link) => never.includes(link))).toBe(true);
  });

  it("reads a date box's layout from its placeholder's day, month and year tokens (the Phase 7a review)", async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><form data-ui="application-form">
      <div data-ui="section-fields">${['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD', 'DD.MM.YYYY', 'MM/YYYY', 'mm-yyyy',
        'MM/DD', 'DD/DD/YYYY', 'Start date', ''].map((placeholder, at) => `<div class="react-datepicker-wrapper"><div
        class="react-datepicker__input-container"><input type="text" id="d${at}" inputmode="tel"
        placeholder="${placeholder}"></div></div>`).join('')}</div></form></body>`);
    const layouts = Array.from(fixture.doc.querySelectorAll('input')).map((input) => workableAdapter.formatFor!(input));
    expect(layouts).toEqual([{ format: 'date', pattern: 'MM/DD/YYYY' }, { format: 'date', pattern: 'DD/MM/YYYY' },
      { format: 'date', pattern: 'YYYY-MM-DD' }, { format: 'date', pattern: 'DD.MM.YYYY' },
      { format: 'month-year', pattern: 'MM/YYYY' }, { format: 'month-year', pattern: 'MM-YYYY' }, null, null, null, null]);
  });
});
