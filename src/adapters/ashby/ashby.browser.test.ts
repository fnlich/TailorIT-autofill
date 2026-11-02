/*
 * The Ashby adapter on the live capture of 2026-11-01 (docs/FIXTURES.md, "The Ashby capture"): its hooks on the
 * snapshots, the scan held against each case's hand-written expectations, and what the generic adapter made of the same
 * page before (the predicted failures of the capture's report, §8: every Yes/No missed, the radio groups unlabelled,
 * the checkbox groups split into lone boxes, Location labelled "Start typing...", the date with no layout).
 */
import { afterEach, describe, expect, it } from 'vitest';
import cohereExpect from '../../../fixtures/ashby/cohere-closed.expect.json';
import cohereHtml from '../../../fixtures/ashby/cohere-closed.html?raw';
import embedExpect from '../../../fixtures/ashby/ashby-embed-closed.frame-1.expect.json';
import embedHtml from '../../../fixtures/ashby/ashby-embed-closed.frame-1.html?raw';
import incidentExpect from '../../../fixtures/ashby/incident-closed.expect.json';
import incidentHtml from '../../../fixtures/ashby/incident-closed.html?raw';
import multiverseExpect from '../../../fixtures/ashby/multiverse-closed.expect.json';
import multiverseHtml from '../../../fixtures/ashby/multiverse-closed.html?raw';
import selectOpenHtml from '../../../fixtures/ashby/multiverse-select-open.html?raw';
import notionExpect from '../../../fixtures/ashby/notion-closed.expect.json';
import notionHtml from '../../../fixtures/ashby/notion-closed.html?raw';
import tickedExpect from '../../../fixtures/ashby/openai-checkbox-ticked.expect.json';
import tickedHtml from '../../../fixtures/ashby/openai-checkbox-ticked.html?raw';
import openaiExpect from '../../../fixtures/ashby/openai-closed.expect.json';
import openaiHtml from '../../../fixtures/ashby/openai-closed.html?raw';
import datepickerExpect from '../../../fixtures/ashby/openai-datepicker-open.expect.json';
import datepickerHtml from '../../../fixtures/ashby/openai-datepicker-open.html?raw';
import openaiGhExpect from '../../../fixtures/ashby/openai-gh-closed.expect.json';
import openaiGhHtml from '../../../fixtures/ashby/openai-gh-closed.html?raw';
import locationResultsHtml from '../../../fixtures/ashby/openai-location-results.html?raw';
import radioExpect from '../../../fixtures/ashby/openai-radio-chosen.expect.json';
import radioHtml from '../../../fixtures/ashby/openai-radio-chosen.html?raw';
import yesnoExpect from '../../../fixtures/ashby/openai-yesno-chosen.expect.json';
import yesnoHtml from '../../../fixtures/ashby/openai-yesno-chosen.html?raw';
import plaidExpect from '../../../fixtures/ashby/plaid-closed.expect.json';
import plaidHtml from '../../../fixtures/ashby/plaid-closed.html?raw';
import schoolResultsHtml from '../../../fixtures/ashby/plaid-school-results.html?raw';
import greenhouseHtml from '../../../fixtures/greenhouse/gitlab-job.html?raw';
import trapHtml from '../../../fixtures/traps/01-white-on-white.html?raw';
import { readBack } from '../../content/values';
import { BRIDGE_COMMAND, BRIDGE_RESULT, encodeAnswer, parseCommand } from '../../dom/bridge-protocol';
import { assertNotSubmit } from '../../dom/fillers';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { scan } from '../../dom/scan';
import type { WidgetTarget } from '../../dom/types';
import { listOf } from '../../dom/widgets';
import { chosenLabels, readShownList } from '../../dom/widgets/options';
import { genericAdapter } from '../generic';
import { compareWithExpectation, readExpectation, scanCase, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { ASHBY_SNAPSHOTS, ashbyAdapter, ashbySubmitted } from './index';

const OPENAI = 'https://jobs.ashbyhq.com/openai/d4780eac-03ad-4dae-861f-99af22b4287e/application';
const SPONSORSHIP = '8077b143-e659-471e-9476-cc47d0924c0b';
const DOMAIN = 'aae92870-22c5-48df-a0d2-3c5a62eb16a6';
const OFFICES = '29be88ae-a9c1-484f-a543-228c4a2eb22f';
const START = 'af2cc708-0f95-489b-941a-f2ed3861fa45';

const CASES = [
  { name: 'openai-closed', html: openaiHtml, expectation: readExpectation(openaiExpect) },
  { name: 'plaid-closed', html: plaidHtml, expectation: readExpectation(plaidExpect) },
  { name: 'multiverse-closed', html: multiverseHtml, expectation: readExpectation(multiverseExpect) },
  { name: 'notion-closed', html: notionHtml, expectation: readExpectation(notionExpect) },
  { name: 'cohere-closed', html: cohereHtml, expectation: readExpectation(cohereExpect) },
  { name: 'incident-closed', html: incidentHtml, expectation: readExpectation(incidentExpect) },
  { name: 'openai-gh-closed', html: openaiGhHtml, expectation: readExpectation(openaiGhExpect) },
  { name: 'ashby-embed-closed.frame-1', html: embedHtml, expectation: readExpectation(embedExpect) },
  // The capture's states, each the same form as its closed one.
  { name: 'openai-yesno-chosen', html: yesnoHtml, expectation: readExpectation(yesnoExpect) },
  { name: 'openai-radio-chosen', html: radioHtml, expectation: readExpectation(radioExpect) },
  { name: 'openai-checkbox-ticked', html: tickedHtml, expectation: readExpectation(tickedExpect) },
  { name: 'openai-datepicker-open', html: datepickerHtml, expectation: readExpectation(datepickerExpect) },
] as const;

/** The controls a scan of an Ashby form leaves out but counts (hiddenControlsIgnored): each Yes/No's own hidden
 *  checkbox, and the autofill uploader's file input (outside every question). */
function ignoredIn(root: Element): number {
  const yesno = root.querySelectorAll('.ashby-application-form-input-yesno > input[type="checkbox"]').length;
  const uploader = Array.from(root.querySelectorAll('input[type="file"]'))
    .filter((input) => input.closest('[data-field-path]') === null).length;
  return yesno + uploader;
}

async function loadAshby(html: string) {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const root = ashbyAdapter.detect(fixture.doc)!.formRoot;
  return { ...fixture, root };
}

/** A scan's field whose label matches. */
function fieldOf(root: Element, label: RegExp) {
  const field = scan(root, ashbyAdapter, { platform: 'ashby' }).fields.find((candidate) => label.test(candidate.label));
  if (field === undefined) throw new Error(`no field ${String(label)}`);
  return field;
}

describe('the Ashby adapter: its hooks on the snapshots', () => {
  afterEach(() => removeFixtures(document));

  it('takes div#form[role=tabpanel] holding the form as the root, and finds none on other pages', async () => {
    for (const { html } of CASES) {
      const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
      expect(ashbyAdapter.detect(fixture.doc)?.formRoot.matches('div#form[role="tabpanel"]')).toBe(true);
      removeFixtures(document);
    }
    for (const html of [greenhouseHtml, trapHtml]) {
      const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
      expect(ashbyAdapter.detect(fixture.doc)).toBeNull();
      removeFixtures(document);
    }
    // The panel before React draws the form, and after Submit (the success message in its place), is no form.
    const page = await loadAshby(openaiHtml);
    expect(ashbySubmitted(page.doc)).toBe(false);
    page.root.querySelectorAll('[data-field-path]').forEach((entry) => entry.remove());
    expect(ashbyAdapter.detect(page.doc)).toBeNull();
    const done = page.doc.createElement('div');
    done.className = 'ashby-application-form-success-container';
    page.root.replaceChildren(done);
    expect(ashbySubmitted(page.doc)).toBe(true);
    expect(ashbyAdapter.isFinalStep!(page.doc)).toBe('unknown');
  });

  it('names the sections by their headers, the form before them by the Application tab, never the left pane', async () => {
    const plaid = await loadAshby(plaidHtml);
    expect(ashbyAdapter.sections!(plaid.root).map((section) => section.label)).toEqual(['Application',
      'General Application', 'AI & Interest in Working at Plaid', 'AI & Interest in Working at Plaid']);
    removeFixtures(document);
    const openai = await loadAshby(openaiHtml);
    expect(ashbyAdapter.sections!(openai.root).map((section) => section.label)).toEqual(['Application',
      'U.S. EQUAL EMPLOYMENT OPPORTUNITY INFORMATION (Completion is voluntary and will not subject you to adverse treatment)',
      'SELF-IDENTIFICATION OF VETERAN STATUS (Completion is voluntary and will not subject you to adverse treatment)']);
    expect(openai.doc.querySelector('.ashby-job-posting-left-pane h2')).not.toBeNull();
  });

  it('labels every control and group by its question, and reads its help text and required mark', async () => {
    const { doc, root } = await loadAshby(openaiHtml);
    const entry = (path: string) => doc.querySelector(`[data-field-path="${path}"]`)!;
    const title = (path: string) => entry(path).querySelector('.ashby-application-form-question-title');
    const yesno = entry(SPONSORSHIP).querySelector('.ashby-application-form-input-yesno')!;
    expect(ashbyAdapter.labelFor!(yesno)).toBe(title(SPONSORSHIP));
    expect(ashbyAdapter.labelFor!(entry(DOMAIN).querySelector('fieldset')!)).toBe(title(DOMAIN));
    expect(ashbyAdapter.labelFor!(entry('_systemfield_location').querySelector('input')!)).toBe(title('_systemfield_location'));
    expect(ashbyAdapter.descriptionFor!(yesno).map((el) => el.textContent)).toEqual(['We may provide immigration and '
      + 'sponsorship support to new employees based on their unique circumstances.']);
    expect(ashbyAdapter.requiredFor!(yesno)).toBe(true);
    expect(ashbyAdapter.requiredFor!(entry('_systemfield_eeoc_gender').querySelector('fieldset')!)).toBe(false);
    expect(ashbyAdapter.formatFor!(entry(START).querySelector('input')!)).toEqual({ format: 'date', pattern: 'MM/DD/YYYY' });
    // Outside every question (the uploader), and an ordinary text box, it names nothing of its own.
    expect(ashbyAdapter.labelFor!(root.querySelector('.ashby-application-form-autofill-input-root input')!)).toBeNull();
    expect(ashbyAdapter.formatFor!(doc.getElementById('_systemfield_name')!)).toBeNull();
    removeFixtures(document);
    // An Education block's controls by their own sub-labels, its month and year lists with their suffixes; the SMS
    // consent's radios by its consent text, never required.
    const plaid = await loadAshby(plaidHtml);
    const block = plaid.root.querySelector('.ashby-application-form-input-education-entry')!;
    expect(Array.from(block.querySelectorAll('select')).map((select) => [ashbyAdapter.labelFor!(select)?.textContent,
      ashbyAdapter.labelSuffix!(select)])).toEqual([['Start Date', 'month'], ['Start Date', 'year'], ['End Date', 'month'],
      ['End Date', 'year']]);
    expect(ashbyAdapter.labelFor!(block.querySelector('input[role="combobox"]')!)?.textContent).toBe('School');
    const consent = plaid.root.querySelector<HTMLInputElement>('input[name="communicationConsent"]')!;
    expect(ashbyAdapter.labelFor!(consent)?.textContent).toMatch(/^Check Yes or No to indicate your agreement/);
    expect(ashbyAdapter.requiredFor!(consent)).toBe(false);
  });

  it('declares the Yes/No groups and the comboboxes as their widgets, and nothing else', async () => {
    const { root } = await loadAshby(plaidHtml);
    const yesno = ashbyAdapter.widgetRoots!(root);
    expect(yesno).toHaveLength(3);
    for (const group of yesno) {
      expect(ashbyAdapter.widgetFor!(group)).toMatchObject({ kind: 'radio', snapshot: ASHBY_SNAPSHOTS[0] });
      expect(ashbyAdapter.widgetFor!(group)!.members!.map((button) => button.textContent)).toEqual(['Yes', 'No']);
      // Its own display:none checkbox is its part, and nothing else is.
      expect(ashbyAdapter.widgetFor!(group)!.parts).toEqual([group.querySelector(':scope > input[type="checkbox"]')]);
    }
    const kinds = Array.from(root.querySelectorAll('input[role="combobox"]')).map((input) => {
      const declared = ashbyAdapter.widgetFor!(input)!;
      expect(declared.expanded).toBe(input);
      expect(declared.opener.matches('button[class*="_toggleButton_"]')).toBe(true);
      // No box: the input is judged as any control (a declared box only unlocks the honeypot exception).
      expect(declared.box).toBeUndefined();
      expect(declared).toMatchObject({ keys: ['Escape'], hidesFormWhileOpen: true, highlightIsNoChoice: true });
      return [input.getAttribute('placeholder'), declared.kind];
    });
    expect(kinds).toEqual([['Start typing...', 'typeahead-remote'], ['Search schools...', 'typeahead-remote']]);
    const others = Array.from(root.querySelectorAll('input, select, textarea, button'))
      .filter((el) => !el.matches('input[role="combobox"]'));
    expect(others.filter((el) => ashbyAdapter.widgetFor!(el) !== null)).toEqual([]);
    removeFixtures(document);
    // A ValueSelect drawn as a combobox (multiverse, 17 options) is a combobox: a page without the bridge reads no
    // field type, so its entry decides.
    const multiverse = await loadAshby(multiverseHtml);
    expect(ashbyAdapter.widgetFor!(multiverse.root.querySelector('input[role="combobox"]')!)).toMatchObject({ kind: 'combobox' });
  });

  it("reads the chosen Yes/No, radio and checkbox from what the page draws, the input's own checked aside", async () => {
    const yesno = await loadAshby(yesnoHtml);
    expect(fieldOf(yesno.root, /^Will you now or in the future require sponsorship/).current)
      .toEqual({ kind: 'selected', labels: ['No'] });
    removeFixtures(document);
    const radio = await loadAshby(radioHtml);
    // openai-radio-chosen.html: the span says data-checked; the input itself is not checked in the snapshot.
    const chosen = radio.doc.querySelector<HTMLInputElement>(`[data-field-path="${DOMAIN}"] input[id$="-labeled-radio-1"]`)!;
    expect(chosen.checked).toBe(false);
    expect(ashbyAdapter.checkedOf!(chosen)).toBe(true);
    expect(fieldOf(radio.root, /^What technical domain/).current).toEqual({ kind: 'selected', labels: ['Full Stack'] });
    // A radio set by .checked alone is not chosen as Ashby draws it.
    const other = radio.doc.querySelector<HTMLInputElement>(`[data-field-path="${DOMAIN}"] input[id$="-labeled-radio-3"]`)!;
    other.checked = true;
    expect(ashbyAdapter.checkedOf!(other)).toBe(false);
    expect(fieldOf(radio.root, /^What technical domain/).current).toEqual({ kind: 'selected', labels: ['Full Stack'] });
    removeFixtures(document);
    const ticked = await loadAshby(tickedHtml);
    expect(fieldOf(ticked.root, /^Based on this job's details/).current).toEqual({ kind: 'selected', labels: ['San Francisco'] });
    expect(ashbyAdapter.checkedOf!(ticked.doc.querySelector<HTMLInputElement>(`[data-field-path="${OFFICES}"] input`)!)).toBe(true);
    // Any other box reads its own checked.
    expect(ashbyAdapter.checkedOf!(ticked.doc.getElementById('_systemfield_name') as HTMLInputElement)).toBeNull();
  });

  it("reads an open list in its portal through the input's aria-controls, the rest of the page aria-hidden", async () => {
    // multiverse-select-open.html: the ValueSelect's 17 options, opened by its toggle; the form behind it aria-hidden.
    const open = await loadFixture(document, selectOpenHtml, SNAPSHOT_VIEWPORT);
    const input = open.doc.querySelector<HTMLInputElement>('input[role="combobox"][aria-expanded="true"]')!;
    const list = listOf(input, input)!;
    expect(list.closest('[data-floating-ui-portal]')).not.toBeNull();
    expect(readShownList(list).options).toHaveLength(17);
    expect(open.doc.querySelectorAll('[data-aria-hidden="true"][aria-hidden="true"]').length).toBeGreaterThan(0);
    removeFixtures(document);
    // plaid-school-results.html: each result shows its name, its country and its domain side by side; it is labelled
    // by its name alone (optionLabel), which the box holds once it is chosen.
    const school = await loadFixture(document, schoolResultsHtml, SNAPSHOT_VIEWPORT);
    const box = school.doc.querySelector<HTMLInputElement>('input[placeholder="Search schools..."]')!;
    const results = listOf(box, box)!;
    expect(readShownList(results).options[0]?.label.replace(/\s+/g, '')).toBe('StanfordUniversityUnitedStatesstanford.edu');
    const named = readShownList(results, undefined, ashbyAdapter.widgetFor!(box)!.optionLabel).options.map((option) => option.label);
    expect(named.slice(0, 3)).toEqual(['Stanford University', 'Politeknik Keuangan Negara STAN', 'Career Education Corporation']);
    removeFixtures(document);
    // openai-location-results.html: the places the capture's query listed, the first highlighted (aria-selected="true")
    // before anything is chosen. Nothing is chosen: the highlight is no answer, and the box (its typed text redacted)
    // shows none.
    const location = await loadFixture(document, locationResultsHtml, SNAPSHOT_VIEWPORT);
    const place = location.doc.querySelector<HTMLInputElement>('[data-field-path="_systemfield_location"] input')!;
    const places = listOf(place, place)!;
    const read = readShownList(places);
    expect(read.options.length).toBeGreaterThan(1);
    expect(places.querySelector('[role="option"]')!.getAttribute('aria-selected')).toBe('true');
    const declared = ashbyAdapter.widgetFor!(place)!;
    const widget: WidgetTarget = { kind: 'typeahead-remote', element: place, input: place, opener: declared.opener,
      members: [], activation: [], declared: true, expanded: place, box: declared.box ?? null };
    expect(chosenLabels(widget, read.options.map((option) => option.label))).toEqual([]);
  });

  it('names the buttons never pressed, identifies Submit, and pairs each upload with its button', async () => {
    const { doc, root } = await loadAshby(plaidHtml);
    const never = ashbyAdapter.neverPress!(root);
    const ctx = { adapter: ashbyAdapter, root };
    for (const selector of ['.ashby-application-form-autofill-input-root button', '.ashby-application-form-autofill-input-root input',
      '.ashby-application-form-input-file-dropzone-upload', '.ashby-application-form-input-education-entry-delete',
      'a#job-overview', 'a#job-application-form']) {
      const el = doc.querySelector(selector)!;
      expect(never.some((button) => button.contains(el)), selector).toBe(true);
      expect(assertNotSubmit(el, ctx), selector).toEqual({ ok: false, refusal: 'adapter-never-press' });
    }
    for (const selector of ['button.ashby-application-form-input-yesno-option', 'button[class*="_toggleButton_"]',
      'button.ashby-application-form-input-education-add', 'input[name="communicationConsent"]']) {
      expect(assertNotSubmit(doc.querySelector(selector)!, ctx), selector).toEqual({ ok: true });
    }
    const submit = ashbyAdapter.submitButton!(root)!;
    expect(submit.textContent).toBe('Submit Application');
    expect(assertNotSubmit(submit, ctx)).toEqual({ ok: false, refusal: 'adapter-submit' });
    expect(ashbyAdapter.isFinalStep!(doc)).toBe('final');
    expect(ashbyAdapter.uploadWidgets!(root).map((widget) => [widget.input.id, widget.control.textContent]))
      .toEqual([['_systemfield_resume', 'Upload File']]);
    expect(ashbyAdapter.excluded!(root).length).toBeGreaterThan(0);
  });

  it('declares the Education block as the repeatable education section, its add button its Add', async () => {
    const { root } = await loadAshby(plaidHtml);
    const [education, ...rest] = ashbyAdapter.repeatables!(root);
    expect(rest).toEqual([]);
    expect(education!.kind).toBe('education');
    expect(education!.blocks()).toHaveLength(1);
    expect(education!.addButton()?.textContent).toBe('+ Add Education');
    removeFixtures(document);
    const openai = await loadAshby(openaiHtml);
    expect(ashbyAdapter.repeatables!(openai.root)).toEqual([]);
  });

  it('reads its addresses with url.ts: the overview, the form and the embed share one application', () => {
    expect(ashbyAdapter.matchesUrl(new URL(OPENAI))).toBe(true);
    expect(ashbyAdapter.canonicalApplicationUrl(new URL(`${OPENAI}?embed=js`))).toBe(OPENAI);
    expect(ashbyAdapter.canonicalApplicationUrl(new URL(OPENAI.replace('/application', '')))).toBeNull();
    expect(ashbyAdapter.quirks?.formLateMs).toBeGreaterThan(6_800);
  });
});

describe('the Ashby adapter: the Phase 2 review', () => {
  afterEach(() => removeFixtures(document));

  it('asks the bridge again for a field type it did not answer, and keeps one it did', async () => {
    const { root, view } = await loadAshby(multiverseHtml);
    const input = root.querySelector('input[role="combobox"]')!;
    // No bridge in the page: no field type, so its entry decides (a ValueSelect).
    expect(ashbyAdapter.widgetFor!(input)).toMatchObject({ kind: 'combobox' });
    // The bridge answers later (a page whose React was not ready): a Location now, a remote search.
    let asked = 0;
    input.addEventListener(BRIDGE_COMMAND, (event) => {
      const command = parseCommand((event as CustomEvent<unknown>).detail);
      if (command === null) return;
      asked += 1;
      event.preventDefault();
      input.dispatchEvent(new view.CustomEvent(BRIDGE_RESULT, { detail: encodeAnswer({ v: 1, id: command.id, ok: true,
        reason: 'ok', field: { type: 'Location', path: '2481891d-0000-4000-8000-000000000000' } }) }));
    });
    expect(ashbyAdapter.widgetFor!(input)).toMatchObject({ kind: 'typeahead-remote' });
    expect(ashbyAdapter.widgetFor!(input)).toMatchObject({ kind: 'typeahead-remote' });
    expect(asked).toBe(1);
  });

  it('names only snapshots the repository holds, each the one its hook was read from', async () => {
    const held = Object.keys(import.meta.glob('../../../fixtures/ashby/*.html')).map((path) => path.replace(/^(?:\.\.\/)+/, ''));
    for (const snapshot of ASHBY_SNAPSHOTS) expect(held, snapshot).toContain(snapshot);
    const { root } = await loadAshby(plaidHtml);
    const [location, school] = Array.from(root.querySelectorAll('input[role="combobox"]'));
    expect(ashbyAdapter.widgetFor!(location!)?.snapshot).toBe('fixtures/ashby/openai-closed.html');
    expect(ashbyAdapter.widgetFor!(school!)?.snapshot).toBe('fixtures/ashby/plaid-closed.html');
    removeFixtures(document);
    const multiverse = await loadAshby(multiverseHtml);
    expect(ashbyAdapter.widgetFor!(multiverse.root.querySelector('input[role="combobox"]')!)?.snapshot)
      .toBe('fixtures/ashby/multiverse-closed.html');
  });

  it('takes a file input only inside a question entry, whatever its classes say', async () => {
    const { root, doc } = await loadAshby(plaidHtml);
    const resume = root.querySelector('[data-field-path="_systemfield_resume"] .ashby-application-form-input-file')!;
    // A copy of the resume's upload, outside every entry (as the autofill uploader is).
    const stray = resume.cloneNode(true) as Element;
    stray.querySelector('input[type="file"]')!.id = 'stray-upload';
    root.querySelector('.ashby-application-form-container')!.append(stray);
    expect(ashbyAdapter.uploadWidgets!(root).map((widget) => widget.input.id)).toEqual(['_systemfield_resume']);
    expect(ashbyAdapter.excluded!(root)).toContain(doc.getElementById('stray-upload'));
    const result = scan(root, ashbyAdapter, { platform: 'ashby' });
    expect(result.fields.some((field) => field.idAttr === 'stray-upload')).toBe(false);
    expect(result.unrecognisedUploads).toEqual([]);
    expect(ashbyAdapter.uploadState!(doc.getElementById('stray-upload') as HTMLInputElement, 'Resume.pdf')).toBeNull();
  });

  it('reads a question as required only by a mark a person can see', async () => {
    const { root } = await loadAshby(openaiHtml);
    const name = root.querySelector('#_systemfield_name')!;
    expect(ashbyAdapter.requiredFor!(name)).toBe(true);
    (root.querySelector('label[for="_systemfield_name"]') as HTMLElement).style.display = 'none';
    expect(ashbyAdapter.requiredFor!(name)).toBe(false);
  });

  it("reads a written radio back as Ashby draws it, the input's own checked aside", async () => {
    const { root, doc } = await loadAshby(radioHtml);
    const result = scan(root, ashbyAdapter, { platform: 'ashby' });
    const field = result.fields.find((candidate) => /^What technical domain/.test(candidate.label))!;
    const target = result.target(field.key)!;
    // openai-radio-chosen.html: the span says data-checked; no input is checked in the snapshot.
    expect(target.members.some((member) => member.checked)).toBe(false);
    expect(readBack(target)).toEqual({ kind: 'selected', labels: ['Full Stack'] });
    expect(doc.querySelector(`[data-field-path="${DOMAIN}"]`)).not.toBeNull();
  });
});

describe('the generic adapter on an Ashby form (before the Ashby adapter)', () => {
  afterEach(() => removeFixtures(document));

  it('misses every Yes/No, labels no radio group, splits the checkbox groups and labels Location "Start typing..."', async () => {
    const { doc } = await loadFixture(document, openaiHtml, SNAPSHOT_VIEWPORT);
    const root = genericAdapter.detect(doc)!.formRoot;
    expect(root).toBe(doc.body);
    const result = scan(root, genericAdapter, { platform: 'ashby' });
    const fields = result.fields;
    // No Yes/No is a field; their hidden checkboxes are counted as honeypots.
    expect(fields.some((field) => field.options !== 'lazy' && field.options.map((option) => option.label).join() === 'Yes,No'))
      .toBe(false);
    expect(result.counters.hiddenControlsIgnored).toBeGreaterThanOrEqual(4);
    // The radio groups have no visible label; the offices are five lone boxes (and the two consents two more);
    // Location and the date are named by their placeholders; the uploader's input is a flagged row.
    expect(fields.filter((field) => field.kind === 'radio').every((field) => field.labelSource === 'none')).toBe(true);
    expect(fields.filter((field) => field.kind === 'checkbox')).toHaveLength(7);
    expect(fields.filter((field) => field.kind === 'checkbox-group')).toHaveLength(0);
    expect(fields.find((field) => field.label === 'Start typing...')).toBeDefined();
    expect(fields.find((field) => field.label === 'Pick date...')?.constraints.format).toBeUndefined();
    expect(result.unrecognisedUploads).toHaveLength(1);
  });
});

describe('the Ashby adapter against its snapshots', () => {
  afterEach(() => removeFixtures(document));

  it.each(CASES)('$name: the scan meets the hand-written expectations', async ({ html, expectation }) => {
    const scanned = await scanCase(document, html, expectation.source);
    expect(scanned.adapter).toBe(ashbyAdapter);
    expect(scanned.result.unrecognisedUploads).toEqual([]);
    // Each Yes/No's hidden checkbox and the autofill uploader's input: no field, still counted.
    const ignored = ignoredIn(ashbyAdapter.detect(scanned.doc)!.formRoot);
    expect(ignored).toBeGreaterThan(0);
    expect(scanned.result.counters.hiddenControlsIgnored).toBe(ignored);
    expect(scanned.result.fields.some((field) => /start typing|pick date/i.test(field.label))).toBe(false);
    expect(compareWithExpectation(scanned.doc, scanned.result, expectation)).toEqual([]);
  });
});
