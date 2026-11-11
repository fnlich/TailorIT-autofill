/*
 * jr6 ORACLE (FIXPLAN §6.11, APPLYPLAN E-Oracle): the Oracle adapter's jr6 hooks on the owner's snapshots
 * (fixtures/oracle/*: the Caesars posting and email gate converted for jr6 beside the earlier pages) and on synthetic
 * variants built inside each test (a page's markup changed in place, values the golden profile's or made up). It began
 * as the auditor's harness (SP\jr6\audit\oracle.md §3), whose readings are asserted here: the platform and adapters each
 * page gets, the hooks' answers, the pauses and Sign-in Auto's form, and the plan of the gate with the golden synthetic
 * profile (fixtures/profiles/alex-rivera.*) and DEFAULT_SETTINGS. Outcomes that need ENGINE's E1 to E3 or RULES' jr6
 * rules (a list read and chosen, a dependent re-planned, a ZIP's category) are P2's (SP\jr6\build\ORACLE.md).
 * P2 (FIXPLAN §6.11 "P2 asserts", after merging jr6-engine E1-E3 and jr6-rules R1-R4): the shared outcomes on the
 * section pages, each on its fixture with the golden profile or a variant of it built in code: the phone's number box
 * drawn by its group (O4, E2); the cx-selects read, planned and chosen by their declared rows (O1, E1), the phone's
 * code by its dial code and country with the number national (O5); Address Line 1 and ZIP Code searched (O2, RULES 61);
 * the address block's parents first and its dependents decided again (O3, E3 item 14), in the content runtime too; no
 * futile search on a cx-select (O10, E1 item 12); the education editor's place, dates and grade as the entry's (O7,
 * oracle-new-2, RULES 7 and 78); the numbered links (O13, RULES 79). No capture shows an Oracle list open (owner
 * question 23): the lists are synthetic, drawn by this test's listeners as Jobright 1.25.2's operations.fillSelectField
 * reads Oracle's (cxDrive).
 * Nothing here prints or keeps a value.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import caesarsPostingHtml from '../../../fixtures/oracle/jr6-caesars-posting.html?raw';
import caesarsGateHtml from '../../../fixtures/oracle/jr6-caesars-email-gate.html?raw';
import elhrGateHtml from '../../../fixtures/oracle/elhr-email-gate.html?raw';
import fortiveCodeHtml from '../../../fixtures/oracle/fortive-email-code.html?raw';
import hjfSectionHtml from '../../../fixtures/oracle/hjf-apply-section.html?raw';
import hjfAfterSubmitHtml from '../../../fixtures/oracle/hjf-after-submit.html?raw';
import jpmcPostingHtml from '../../../fixtures/oracle/jpmc-posting.html?raw';
import { createFakeWorker, goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import { dependenciesOf, parentsFirst } from '../../content/pass';
import { pressEntry, stepButtonsOf } from '../../content/press';
import { startContentRuntime, type ContentRuntime } from '../../content/runtime';
import { planFrame } from '../../core/plan/frame';
import type { RepeatableRequest } from '../../core/steps/blocks';
import { stepSignature } from '../../core/steps/signature';
import type { BaseKey, FieldSpec } from '../../core/types/field';
import type { FillResult, PlannedWrite } from '../../core/types/fill';
import type { WriteValue } from '../../core/types/intent';
import type { Profile } from '../../core/types/profile';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { assertNotSubmit } from '../../dom/fillers';
import { ALLOWED_EVENTS, KEY_EVENTS } from '../../dom/fillers/events';
import { loadFixture, logEvents, removeFixtures, untrustedViolations, type EventLog } from '../../dom/fixture.testkit';
import { hashOfOptions } from '../../dom/option-hash';
import { detectPause } from '../../dom/pause-detect';
import { scan, toFieldSpec } from '../../dom/scan';
import { signInFormOf, signInRefusal } from '../../dom/sign-in-form';
import type { FieldTarget, ScanResult, WidgetReading } from '../../dom/types';
import { fillWidget, readWidget, searchTypeahead, widgetHolds, type TypeaheadHooks } from '../../dom/widgets';
import { isActionable, listOf, widgetListOf } from '../../dom/widgets/aria';
import { platformOfUrl } from '../../shared/hosts';
import { adaptersFor } from '../index';
import { fillabilityOf, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import type { Adapter, WidgetDecl } from '../types';
import { ORACLE_EMPTY_AFTER_MS, oracleAdapter } from './index';

const CAESARS = 'https://edmn.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/78569';
const ELHR_GATE = 'https://elhr.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/12946/apply/email';
const FORTIVE_CODE = 'https://ejta.fa.us6.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_2001/job/10672/apply/email';
const HJF = 'https://iaaxmg.fa.ocs.oraclegovcloud.com/hcmUI/CandidateExperience/en/sites/CX_2001/job/11551';
const JPMC = 'https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210734835';

/** A page's own base address (a srcdoc page's is about:srcdoc), after it loaded: its forms and links resolve there. */
function setBase(doc: Document, address: string): void {
  const base = doc.createElement('base');
  base.href = address;
  doc.head.prepend(base);
}

/** The page once its fade-ins have run, as a person sees it (oracle.browser.test.ts faded). */
function faded(doc: Document): void {
  for (const animation of doc.getAnimations()) {
    const end = animation.effect?.getComputedTiming().endTime;
    if (typeof end === 'number' && Number.isFinite(end)) animation.finish();
  }
}

/** hjf-after-submit's Submit checklist dialog closed, as the page draws it closed: the dialog, its modal layer and
 *  overlay gone, no aria-hidden on div.app, the body's modal classes dropped. */
function closeChecklist(doc: Document): void {
  for (const dialog of Array.from(doc.querySelectorAll<HTMLElement>('oj-dialog.apply-flow-checklist-dialog'))) {
    dialog.style.display = 'none';
    const layer = dialog.closest<HTMLElement>('.oj-dialog-layer');
    if (layer !== null) layer.style.display = 'none';
  }
  for (const overlay of Array.from(doc.querySelectorAll<HTMLElement>('.oj-component-overlay.oj-dialog-layer'))) {
    overlay.style.display = 'none';
  }
  doc.querySelector('div.app')?.removeAttribute('aria-hidden');
  doc.body.classList.remove('body--dialog-opened', 'oj-component-modal-open');
}

async function load(html: string, address: string, after?: (doc: Document) => void): Promise<Document> {
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  setBase(fixture.doc, address);
  faded(fixture.doc);
  after?.(fixture.doc);
  return fixture.doc;
}

/** The frame's plan with the golden synthetic profile (the harness's plan), its repeatable sections requested. jr6
 *  P2: the run's list readings by base key (`readings`, as the loop's waiting path keeps them) and a variant of the
 *  golden profile built in code (`profile`) may be given. */
function planned(doc: Document, options: { readings?: Map<BaseKey, WidgetReading>; profile?: Profile } = {}) {
  const root = oracleAdapter.detect(doc)!.formRoot;
  const result = scan(root, oracleAdapter, { platform: 'oracle',
    ...(options.readings === undefined ? {} : { widgetReadings: options.readings }) });
  const specs: FieldSpec[] = result.fields.map(toFieldSpec);
  const kinds = (oracleAdapter.repeatables?.(root) ?? []).map((section) => section.kind);
  const shown = (kind: string) => oracleAdapter.prefill?.readEntries?.(kind,
    oracleAdapter.repeatables!(root).find((section) => section.kind === kind)!.blocks()) ?? [];
  const repeatables: RepeatableRequest[] = kinds.map((kind) => ({ kind, entries: null, shown: shown(kind) }));
  const plan = planFrame({ specs, canaries: [], profile: options.profile ?? goldenProfile(), sensitiveState: 'loaded',
    savedAnswers: [], settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW,
    posting: { company: 'Acme', location: 'Austin, TX, USA' }, ...(repeatables.length > 0 ? { repeatables } : {}) });
  return { root, result, specs, plan };
}

afterEach(() => removeFixtures(document));

// ── The auditor's harness, as asserts ───────────────────────────────────────────────────────────────────────────────

/** Each page the auditor measured: its address, and how it reads (SP\jr6\audit\oracle.md §3, "Detection and steps"). */
const PAGES = [
  { name: 'jr6-caesars-posting', html: caesarsPostingHtml, address: CAESARS, root: null, auth: null, posting: true,
    entry: true, steps: null, pause: null, gate: false },
  { name: 'jr6-caesars-email-gate', html: caesarsGateHtml, address: `${CAESARS}/apply/email`,
    root: 'section.apply-flow__content', auth: 'email-gate', posting: false, entry: false,
    steps: { final: 'unknown', next: false, submit: false }, pause: 'email-gate', gate: true },
  { name: 'elhr-email-gate', html: elhrGateHtml, address: ELHR_GATE, root: 'section.apply-flow__content',
    auth: 'email-gate', posting: false, entry: false, steps: { final: 'unknown', next: false, submit: false },
    pause: 'email-gate', gate: true },
  // The same gate served on a government-cloud tenant's address: read and taken alike.
  { name: 'elhr-email-gate@govcloud', html: elhrGateHtml, address: `${HJF}/apply/email`,
    root: 'section.apply-flow__content', auth: 'email-gate', posting: false, entry: false,
    steps: { final: 'unknown', next: false, submit: false }, pause: 'email-gate', gate: true },
  { name: 'fortive-email-code', html: fortiveCodeHtml, address: FORTIVE_CODE, root: 'section.apply-flow__content',
    auth: 'email-code', posting: false, entry: false, steps: { final: 'unknown', next: false, submit: false },
    pause: 'email-code', gate: false },
  { name: 'hjf-apply-section', html: hjfSectionHtml, address: `${HJF}/apply/section/1`,
    root: 'form.apply-flow__content-form', auth: null, posting: false, entry: false,
    steps: { final: 'final', next: false, submit: true }, pause: null, gate: false },
  { name: 'hjf-after-submit (checklist closed)', html: hjfAfterSubmitHtml, address: `${HJF}/apply/section/1`,
    root: 'form.apply-flow__content-form', auth: null, posting: false, entry: false,
    steps: { final: 'final', next: false, submit: true }, pause: null, gate: false, closed: true },
] as const;

describe('jr6 Oracle: how each page reads (the auditor’s harness)', () => {
  it.each(PAGES)('$name', async (page) => {
    const doc = await load(page.html, page.address, 'closed' in page ? closeChecklist : undefined);
    const url = new URL(page.address);
    expect(platformOfUrl(url.href)).toBe('oracle');
    const adapters = adaptersFor(url, doc);
    expect(adapters.map((one) => one.id)).toEqual(['oracle', 'generic']);
    const root = oracleAdapter.detect(doc)?.formRoot ?? null;
    expect(root === null ? null : root.matches(page.root ?? ':not(*)')).toBe(page.root === null ? null : true);
    expect(adapters.find((one) => one.detect(doc) !== null)?.id ?? null).toBe(page.root === null ? null : 'oracle');
    expect(oracleAdapter.authState!(doc)).toBe(page.auth);
    expect(oracleAdapter.postingText!(doc) !== null).toBe(page.posting);
    expect(oracleAdapter.entryControl!(doc) !== null).toBe(page.entry);
    if (root === null) return;
    expect(stepButtonsOf({ doc, adapter: oracleAdapter, root })).toEqual(page.steps);
    expect(detectPause(doc, root, oracleAdapter)?.kind ?? null).toBe(page.pause);
    const form = signInFormOf(oracleAdapter, doc, 'email-gate');
    expect(form !== null).toBe(page.gate);
    if (form !== null) {
      expect(form.terms.length).toBe(1);
      expect(form.button.matches('button[type="submit"][title="Next"]')).toBe(true);
      expect(signInRefusal(form, url)).toBeNull();
    }
  });

  it('the section page and its after-Submit save read the page’s own errors (the invalid timeline tile, then the '
    + 'notice)', async () => {
    const section = await load(hjfSectionHtml, `${HJF}/apply/section/1`);
    expect(oracleAdapter.errors!(oracleAdapter.detect(section)!.formRoot).length).toBe(1);
    removeFixtures(document);
    const after = await load(hjfAfterSubmitHtml, `${HJF}/apply/section/1`, closeChecklist);
    expect(oracleAdapter.errors!(oracleAdapter.detect(after)!.formRoot).length).toBe(1);
  });

  it.each([
    { name: 'jr6-caesars-email-gate', html: caesarsGateHtml, address: `${CAESARS}/apply/email` },
    { name: 'elhr-email-gate', html: elhrGateHtml, address: ELHR_GATE },
  ])('$name: the plan writes the profile’s email and ticks the required terms box', async ({ html, address }) => {
    const doc = await load(html, address);
    const { result, plan } = planned(doc);
    expect(result.fields.map((field) => field.kind)).toEqual(['text', 'checkbox']);
    const [email, terms] = result.fields;
    const write = (key: string) => plan.writes.find((one) => one.key === key)?.value ?? null;
    expect(write(email!.key)).toEqual({ kind: 'text', text: goldenProfile().contact.email });
    expect(write(terms!.key)).toEqual({ kind: 'check' });
  });
});

// ── C8: the posting's entry ────────────────────────────────────────────────────────────────────────────────────────

/** The postings, with their Apply Now buttons: one on Caesars', two (top and bottom) on JPMC's. */
const POSTINGS = [
  { name: 'jr6-caesars-posting', html: caesarsPostingHtml, address: CAESARS, buttons: 1 },
  { name: 'jpmc-posting', html: jpmcPostingHtml, address: JPMC, buttons: 2 },
] as const;
const APPLY = '.job-details__section-apply-button button.apply-now-button';

/** Every Apply Now of the posting set to another state: its modifier swapped, its words changed (a synthetic variant;
 *  no snapshot shows another state). */
function restate(doc: Document, state: { modifier?: string; words?: string }): void {
  for (const button of Array.from(doc.querySelectorAll<HTMLElement>(APPLY))) {
    if (state.modifier !== undefined) button.classList.replace('apply-now-button--apply-now', state.modifier);
    if (state.words !== undefined) button.textContent = state.words;
  }
}

/** The entry door's press on the posting, every click held (nothing navigates). */
async function pressed(doc: Document): Promise<{ outcome: string; clicked: Element[] }> {
  const clicked: Element[] = [];
  doc.addEventListener('click', (event) => {
    clicked.push(event.target as Element);
    event.preventDefault();
  });
  const { outcome } = await pressEntry(doc, [oracleAdapter], new AbortController().signal, 300, 300);
  return { outcome, clicked };
}

describe('jr6 C8: the posting’s entry is APPLY NOW in its "apply now" state', () => {
  it.each(POSTINGS)('$name offers its Apply Now, by its modifier and its words, and the door presses it once',
    async ({ html, address, buttons }) => {
      const doc = await load(html, address);
      const all = Array.from(doc.querySelectorAll<HTMLElement>(APPLY));
      expect(all.length).toBe(buttons);
      for (const button of all) {
        expect(button.classList.contains('apply-now-button--apply-now')).toBe(true);
        expect(button.textContent!.replace(/\s+/g, ' ').trim()).toBe('Apply Now');
      }
      expect(oracleAdapter.entryControl!(doc)).toBe(all[0]);
      expect(await pressed(doc)).toEqual({ outcome: 'pressed', clicked: [all[0]] });
    });

  it.each(POSTINGS)('$name: the same button with another modifier and other words is not offered, nor pressed',
    async ({ html, address }) => {
      const doc = await load(html, address);
      restate(doc, { modifier: 'apply-now-button--applied', words: 'Applied' });
      expect(oracleAdapter.entryControl!(doc)).toBeNull();
      const { outcome, clicked } = await pressed(doc);
      expect(outcome).not.toBe('pressed');
      expect(clicked).toEqual([]);
      // It stays a never-pressed control.
      const never = oracleAdapter.neverPress!(doc.documentElement);
      for (const button of Array.from(doc.querySelectorAll(APPLY))) expect(never).toContain(button);
    });

  it.each(POSTINGS)('$name: either sign alone keeps it the entry: its words in any case, or its modifier',
    async ({ html, address }) => {
      const doc = await load(html, address);
      const first = doc.querySelector<HTMLElement>(APPLY)!;
      restate(doc, { modifier: 'apply-now-button--other', words: '  APPLY   now ' });
      expect(oracleAdapter.entryControl!(doc)).toBe(first);
      restate(doc, { modifier: 'apply-now-button--apply-now', words: 'Continue' });
      first.classList.replace('apply-now-button--other', 'apply-now-button--apply-now');
      expect(oracleAdapter.entryControl!(doc)).toBe(first);
      // Neither: none.
      first.classList.replace('apply-now-button--apply-now', 'apply-now-button--other');
      for (const button of Array.from(doc.querySelectorAll(APPLY))) {
        button.classList.remove('apply-now-button--apply-now');
      }
      expect(oracleAdapter.entryControl!(doc)).toBeNull();
    });
});

// ── O16: the gate's "communicate by phone instead" ────────────────────────────────────────────────────────────────

describe('jr6 O16: the gate’s "Do you want to communicate by phone instead?" is never pressed', () => {
  it('is one of the never-pressed controls, refused by the door, and never Sign-in Auto’s button', async () => {
    const doc = await load(caesarsGateHtml, `${CAESARS}/apply/email`);
    const phone = doc.querySelector<HTMLElement>('button.quick-apply-flow-verify-method__button')!;
    expect(phone.textContent!.replace(/\s+/g, ' ').trim()).toBe('Do you want to communicate by phone instead?');
    const root = oracleAdapter.detect(doc)!.formRoot;
    expect(oracleAdapter.neverPress!(root)).toContain(phone);
    expect(assertNotSubmit(phone, { adapter: oracleAdapter, root }).ok).toBe(false);
    const form = signInFormOf(oracleAdapter, doc, 'email-gate')!;
    expect(form.button).not.toBe(phone);
    expect(form.form!.contains(phone)).toBe(true);
  });
});

// ── O5: the phone's country code ──────────────────────────────────────────────────────────────────────────────────

describe('jr6 O5: the phone’s country-code picker reads "Country code", so the number is planned without its code', () => {
  const PICKER = 'input#country-codes-dropdownphoneNumber';

  it('hjf-apply-section: the picker is labelled by its own sub-label, read first; the number box keeps its row’s',
    async () => {
      const doc = await load(hjfSectionHtml, `${HJF}/apply/section/1`);
      const picker = doc.querySelector(PICKER)!;
      expect(oracleAdapter.labelFirst!(picker)).toBe(true);
      expect(oracleAdapter.labelFor!(picker)?.textContent?.trim()).toBe('Country code');
      const { result } = planned(doc);
      const field = (control: Element) => result.fields.find((one) => result.target(one.key)?.control === control);
      expect(field(picker)).toMatchObject({ label: 'Country code', labelSource: 'adapter', labelVisible: true });
      expect(field(doc.querySelector('input.phone-row__input')!)).toMatchObject({ label: 'Phone Number' });
      // Only the picker reads first.
      expect(oracleAdapter.labelFirst!(doc.querySelector('input.phone-row__input')!)).toBe(false);
      expect(oracleAdapter.labelFirst!(doc.querySelector('input#country-17')!)).toBe(false);
    });

  it('the plan reads the picker as the phone’s country and writes the number without its calling code; without the '
    + 'sub-label it reads as before', async () => {
    const doc = await load(hjfSectionHtml, `${HJF}/apply/section/1`);
    const number = doc.querySelector('input.phone-row__input')!;
    const read = () => {
      const { result, plan } = planned(doc);
      const key = (control: Element) => result.fields.find((one) => result.target(one.key)?.control === control)!.key;
      const write = plan.writes.find((one) => one.key === key(number))?.value;
      return { code: plan.results.find((row) => row.key === key(doc.querySelector(PICKER)!))?.category,
        number: write?.kind === 'text' ? write.text : null };
    };
    const now = read();
    expect(now.code).toBe('contact.phoneCountry');
    expect(now.number).not.toBeNull();
    expect(now.number).not.toMatch(/^\+/);
    // The sub-label emptied (as a page that draws none): the row's label stands, and the number keeps its code.
    doc.querySelector(`${PICKER}`)!.closest('.cx-select-container')!.querySelector('span.input-field__label')!
      .textContent = '';
    const before = read();
    expect(before.code).not.toBe('contact.phoneCountry');
    expect(before.number).toMatch(/^\+1\b/);
  });
});

// ── O4: the phone's number box is drawn by its group ──────────────────────────────────────────────────────────────

describe('jr6 O4: the phone’s number box is drawn by its bordered phone-row group (controlBox)', () => {
  /** Whether `box` shows a border or a background of its own. */
  function draws(box: Element): boolean {
    const style = getComputedStyle(box);
    const border = ['Top', 'Right', 'Bottom', 'Left'].some((side) =>
      parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0
      && style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none');
    return border || !/^(?:transparent|rgba\(0, 0, 0, 0\))$/.test(style.backgroundColor);
  }

  it.each([
    { name: 'hjf-apply-section', html: hjfSectionHtml, closed: false },
    { name: 'hjf-after-submit (checklist closed)', html: hjfAfterSubmitHtml, closed: true },
  ])('$name: the box answers the group, which a person sees around it and which draws it', async ({ html, closed }) => {
    const doc = await load(html, `${HJF}/apply/section/1`, closed ? closeChecklist : undefined);
    const number = doc.querySelector<HTMLElement>('input.phone-row__input')!;
    const group = oracleAdapter.controlBox!(number)!;
    expect(group.matches('.input-row-composite__inputs.phone-row[role="group"]')).toBe(true);
    expect(group.contains(number)).toBe(true);
    expect(group.contains(doc.querySelector('input#country-codes-dropdownphoneNumber'))).toBe(true);
    expect(draws(group)).toBe(true);
    expect(draws(number)).toBe(false);
    const outer = group.getBoundingClientRect();
    const inner = number.getBoundingClientRect();
    expect(inner.width).toBeGreaterThan(0);
    expect(outer.left <= inner.left && outer.top <= inner.top && outer.right >= inner.right
      && outer.bottom >= inner.bottom).toBe(true);
    // No other control is given a box.
    for (const other of ['input#country-codes-dropdownphoneNumber', 'input#lastName-18', 'input#country-17']) {
      const control = doc.querySelector(other);
      if (control !== null) expect(oracleAdapter.controlBox!(control), other).toBeNull();
    }
  });
});

// ── O1, O2: the cx-select comboboxes ──────────────────────────────────────────────────────────────────────────────

/** Every cx-select of the section page, by its id, and how it is declared: a search (O2) or a list, opened by its
 *  toggle or (Address Line 1, which has none) by the box itself. */
const SECTION_SELECTS = [
  { id: 'country-codes-dropdownphoneNumber', kind: 'combobox', toggle: true },
  { id: 'country-17', kind: 'combobox', toggle: true },
  { id: 'addressLine1-39', kind: 'typeahead-remote', toggle: false },
  { id: 'postalCode-42', kind: 'typeahead-remote', toggle: true },
  { id: 'city-43', kind: 'combobox', toggle: true },
  { id: 'region2-44', kind: 'combobox', toggle: true },
  { id: 'region1-45', kind: 'combobox', toggle: true },
] as const;
/** The education editor's cx-selects on the after-Submit save: Degree, School, the dates' parts, the school's Country. */
const EDITOR_SELECTS = ['contentItemId-46', 'educationalEstablishment-48', 'month-startDate-49', 'year-startDate-49',
  'month-endDate-50', 'year-endDate-50', 'countryCode-51'] as const;

/** A grid popup shaped as Jobright 1.25.2's selectors read Oracle's (operations.fillSelectField: the element the
 *  input's aria-controls names, its rows div[role=row] > div[role=gridcell] > span.cx-select__list-item--content):
 *  synthetic, its words made up; `empty` draws Oracle's lone "No results" row instead. */
function gridFor(doc: Document, input: HTMLInputElement, words: readonly string[], empty = false): HTMLElement {
  const grid = doc.createElement('div');
  grid.id = input.getAttribute('aria-controls')!;
  grid.setAttribute('role', 'grid');
  for (const label of empty ? ['No results'] : words) {
    const row = doc.createElement('div');
    row.setAttribute('role', 'row');
    const cell = doc.createElement('div');
    cell.setAttribute('role', 'gridcell');
    const span = doc.createElement('span');
    span.className = 'cx-select__list-item--content';
    span.textContent = label;
    cell.append(span);
    row.append(cell);
    grid.append(row);
  }
  doc.body.append(grid);
  input.setAttribute('aria-expanded', 'true');
  return grid;
}

const listNow = (decl: WidgetDecl) => (typeof decl.results!.list === 'function' ? decl.results!.list()
  : decl.results!.list);

describe('jr6 O1, O2: every cx-select is declared, its results the rows of its grid', () => {
  it('hjf-apply-section: each cx-select’s declaration (kind, opener, Escape only, its grid, label clicks)', async () => {
    const doc = await load(hjfSectionHtml, `${HJF}/apply/section/1`);
    expect(Array.from(doc.querySelectorAll('input.cx-select-input[role="combobox"]')).map((el) => el.id))
      .toEqual(SECTION_SELECTS.map((each) => each.id));
    for (const { id, kind, toggle } of SECTION_SELECTS) {
      const input = doc.getElementById(id)!;
      const decl = oracleAdapter.widgetFor!(input)!;
      const opener = toggle ? doc.getElementById(`${id}-toggle-button`)! : input;
      expect(decl, id).toMatchObject({ kind, keys: ['Escape'], busy: ['[aria-busy="true"]'],
        emptyAfterMs: ORACLE_EMPTY_AFTER_MS, snapshot: 'fixtures/oracle/hjf-apply-section.html' });
      expect(decl.opener, id).toBe(opener);
      // jr6 ORACLE P2: Address Line 1, a search with no toggle, names nothing that says it is open: its query is typed
      // at once (Oracle Maps draws suggestions for the words typed), never after a click on its box.
      expect(decl.expanded, id).toBe(toggle ? opener : undefined);
      expect(decl.results, id).toMatchObject({ option: '[role="row"]', choose: 'label' });
      // Closed, its grid is not in the page.
      expect(listNow(decl), id).toBeNull();
    }
  });

  it('hjf-after-submit: the education editor’s cx-selects are lists (combobox), from that save', async () => {
    const doc = await load(hjfAfterSubmitHtml, `${HJF}/apply/section/1`, closeChecklist);
    for (const id of EDITOR_SELECTS) {
      const decl = oracleAdapter.widgetFor!(doc.getElementById(id)!)!;
      expect(decl, id).toMatchObject({ kind: 'combobox', snapshot: 'fixtures/oracle/hjf-after-submit.html' });
      expect(decl.opener, id).toBe(doc.getElementById(`${id}-toggle-button`));
    }
  });

  it('declares nothing else: text boxes, the number box, answer pills, uploads, the toggles themselves', async () => {
    const doc = await load(hjfSectionHtml, `${HJF}/apply/section/1`);
    for (const selector of ['input#lastName-18', 'input.phone-row__input', 'ul.cx-select-pills-container',
      'input#attachment-upload-3', 'input#siteLink-1-38', 'button#country-17-toggle-button', 'textarea']) {
      expect(oracleAdapter.widgetFor!(doc.querySelector(selector)!), selector).toBeNull();
    }
  });

  it('a synthetic grid popup: its rows are the results, read by their label part; ARIA alone reads no list',
    async () => {
      const doc = await load(hjfSectionHtml, `${HJF}/apply/section/1`);
      const input = doc.querySelector<HTMLInputElement>('input#country-17')!;
      const grid = gridFor(doc, input, ['Canada', 'United States']);
      // The auditor's measure: standard ARIA finds no list in a grid.
      expect(listOf(input, input)).toBeNull();
      const decl = oracleAdapter.widgetFor!(input)!;
      expect(listNow(decl)).toBe(grid);
      const rows = decl.results!.options!(grid);
      expect(rows).toEqual(Array.from(grid.querySelectorAll('[role="row"]')));
      expect(rows.map((row) => decl.optionLabel!(row)?.textContent)).toEqual(['Canada', 'United States']);
      // A row with no label span is read by its gridcell.
      const bare = rows[0]!.querySelector('span')!;
      bare.replaceWith(...Array.from(bare.childNodes));
      expect(decl.optionLabel!(rows[0]!)).toBe(rows[0]!.querySelector('[role="gridcell"]'));
      // The scan carries the declaration to the widget helpers: their list is the grid.
      const { result } = planned(doc);
      const target = result.fields.map((field) => result.target(field.key)).find((one) => one?.control === input)!;
      expect(target.widget).toMatchObject({ declared: true, kind: 'combobox' });
      expect(widgetListOf(target.widget!)).toBe(grid);
    });

  it('a synthetic grid popup with Oracle’s "No results" row: no result', async () => {
    const doc = await load(hjfSectionHtml, `${HJF}/apply/section/1`);
    const input = doc.querySelector<HTMLInputElement>('input#postalCode-42')!;
    const grid = gridFor(doc, input, [], true);
    const decl = oracleAdapter.widgetFor!(input)!;
    expect(decl.results!.options!(grid)).toEqual([]);
    for (const words of ['No results found.', 'no results were found']) {
      grid.querySelector('span')!.textContent = words;
      expect(decl.results!.options!(grid), words).toEqual([]);
    }
  });

  it('the scan reads each declared cx-select as a widget the helpers act on (no longer widget-phase-4)', async () => {
    const doc = await load(hjfSectionHtml, `${HJF}/apply/section/1`);
    const { result } = planned(doc);
    for (const { id, kind } of SECTION_SELECTS) {
      const field = result.fields.find((one) => result.target(one.key)?.control.id === id)!;
      expect(field.kind, id).toBe(kind);
      expect(fillabilityOf(field, result.target(field.key)?.widget), id).toEqual({ fillable: true });
    }
  });

  it('the address’s dependent lists learn under the Country the block shows; searches and other lists do not',
    async () => {
      const doc = await load(hjfSectionHtml, `${HJF}/apply/section/1`);
      const decl = (id: string) => oracleAdapter.widgetFor!(doc.getElementById(id)!)!;
      for (const id of ['city-43', 'region2-44', 'region1-45']) expect(decl(id).learnContext, id).toBeUndefined();
      doc.querySelector<HTMLInputElement>('input#country-17')!.value = 'Canada';
      for (const id of ['city-43', 'region2-44', 'region1-45']) expect(decl(id).learnContext, id).toBe('Canada');
      for (const id of ['country-17', 'addressLine1-39', 'postalCode-42', 'country-codes-dropdownphoneNumber']) {
        expect(decl(id).learnContext, id).toBeUndefined();
      }
    });

  it('O2: Address Line 1 is a search the planner types the profile’s street into', async () => {
    const doc = await load(hjfSectionHtml, `${HJF}/apply/section/1`);
    const { result, plan } = planned(doc);
    const field = result.fields.find((one) => result.target(one.key)?.control.id === 'addressLine1-39')!;
    expect(plan.results.find((row) => row.key === field.key)).toMatchObject({ category: 'address.line1' });
    expect(plan.writes.find((one) => one.key === field.key)?.value)
      .toEqual({ kind: 'query', queries: [goldenProfile().address!.line1] });
  });
});

// ── O3: the address block's order ─────────────────────────────────────────────────────────────────────────────────

describe('jr6 O3: the address block’s parents (dependsOn)', () => {
  const parentOf = (doc: Document, id: string) => oracleAdapter.dependsOn!(doc.getElementById(id)!);

  it('hjf-apply-section: Address Line 1 waits on the Country; ZIP Code, City, State and County on Address Line 1',
    async () => {
      const doc = await load(hjfSectionHtml, `${HJF}/apply/section/1`);
      const country = doc.getElementById('country-17');
      const street = doc.getElementById('addressLine1-39');
      expect(parentOf(doc, 'country-17')).toBeNull();
      expect(parentOf(doc, 'addressLine1-39')).toBe(country);
      for (const id of ['postalCode-42', 'city-43', 'region2-44', 'region1-45']) expect(parentOf(doc, id), id).toBe(street);
      // Nothing else of the page has a parent: the phone's code, the text boxes, the pills.
      for (const selector of ['input#country-codes-dropdownphoneNumber', 'input#addressLine2-40', 'input#lastName-18',
        'ul.cx-select-pills-container']) {
        expect(oracleAdapter.dependsOn!(doc.querySelector(selector)!), selector).toBeNull();
      }
    });

  it('a block with no street search shown: ZIP Code, City, State and County wait on the Country; none without it',
    async () => {
      const doc = await load(hjfSectionHtml, `${HJF}/apply/section/1`);
      doc.getElementById('addressLine1-39')!.closest<HTMLElement>('.input-row')!.style.display = 'none';
      const country = doc.getElementById('country-17');
      for (const id of ['postalCode-42', 'city-43', 'region2-44', 'region1-45']) {
        expect(parentOf(doc, id), id).toBe(country);
      }
      country!.closest<HTMLElement>('.input-row')!.style.display = 'none';
      for (const id of ['postalCode-42', 'city-43', 'region2-44', 'region1-45']) expect(parentOf(doc, id), id).toBeNull();
    });

  it('hjf-after-submit: the education editor’s Country, Degree and dates have no parent (no address block)',
    async () => {
      const doc = await load(hjfAfterSubmitHtml, `${HJF}/apply/section/1`, closeChecklist);
      for (const id of EDITOR_SELECTS) expect(parentOf(doc, id), id).toBeNull();
    });
});

// ── oracle-new-2, O7: the timeline's open editor ──────────────────────────────────────────────────────────────────

describe('jr6 oracle-new-2, O7: the timeline’s open editor is a repeatable block of its kind', () => {
  const EDITOR = 'timeline-form-inline timeline-form-builder.timeline-form-dialog__content';
  const after = () => load(hjfAfterSubmitHtml, `${HJF}/apply/section/1`, closeChecklist);
  const SCHOOL = 'input[name="educationalEstablishment"]';

  it('hjf-after-submit: the open education editor is the one education block; no Add, no Save declared', async () => {
    const doc = await after();
    const root = oracleAdapter.detect(doc)!.formRoot;
    const sections = oracleAdapter.repeatables!(root);
    expect(sections.map((section) => section.kind)).toEqual(['education']);
    const [education] = sections;
    expect(education!.blocks()).toEqual([doc.querySelector(EDITOR)]);
    expect(education!.addButton()).toBeNull();
    expect(education!.save).toBeUndefined();
    // Its Add buttons and its own Save stay never pressed.
    const never = oracleAdapter.neverPress!(root);
    for (const id of ['timeline-add-education-button', 'timeline-add-experience-button']) {
      expect(never).toContain(doc.getElementById(id));
    }
    expect(never).toContain(doc.querySelector('timeline-form-inline button.save-btn'));
  });

  it('no editor shown, no section: hjf-apply-section’s tiles, and the editor hidden', async () => {
    const section = await load(hjfSectionHtml, `${HJF}/apply/section/1`);
    expect(section.querySelectorAll('.beautiful-timeline-item__title').length).toBeGreaterThan(0);
    expect(oracleAdapter.repeatables!(oracleAdapter.detect(section)!.formRoot)).toEqual([]);
    removeFixtures(document);
    const doc = await after();
    doc.querySelector<HTMLElement>('timeline-form-inline')!.style.display = 'none';
    expect(oracleAdapter.repeatables!(oracleAdapter.detect(doc)!.formRoot)).toEqual([]);
  });

  it('its kind is told by its fields: Employer Name and Job Title make an experience’s; other rows none', async () => {
    const doc = await after();
    const root = oracleAdapter.detect(doc)!.formRoot;
    const relabel = (id: string, words: string, name: string) => {
      doc.querySelector(`label[for="${id}"] .input-row__linebreak`)!.textContent = words;
      doc.getElementById(id)!.setAttribute('name', name);
    };
    // A synthetic experience editor, its rows relabelled in place.
    relabel('contentItemId-46', 'Job Title', 'jobTitle');
    relabel('educationalEstablishment-48', 'Employer Name', 'employerName');
    expect(oracleAdapter.repeatables!(root).map((section) => section.kind)).toEqual(['experience']);
    const company = doc.getElementById('educationalEstablishment-48') as HTMLInputElement;
    const title = doc.getElementById('contentItemId-46') as HTMLInputElement;
    company.value = 'Northwind Labs';
    title.value = 'Platform Engineer';
    const blocks = oracleAdapter.repeatables!(root)[0]!.blocks();
    expect(oracleAdapter.prefill!.readEntries!('experience', blocks)).toEqual([{ block: 0, values: [
      { category: 'experience.company', text: 'Northwind Labs' }, { category: 'experience.title', text: 'Platform Engineer' }] }]);
    expect(oracleAdapter.prefill!.readEntries!('education', blocks)).toEqual([]);
    relabel('contentItemId-46', 'Notes', 'notes');
    expect(oracleAdapter.repeatables!(root)).toEqual([]);
  });

  it('its fields are the entry’s: section education, block 0; its dates read as the education’s, never the person’s '
    + 'start date (the auditor’s O7 reading)', async () => {
    const doc = await after();
    const { result, plan } = planned(doc);
    const editor = doc.querySelector(EDITOR)!;
    const inEditor = result.fields.filter((field) => editor.contains(result.target(field.key)!.control));
    expect(inEditor.map((field) => field.label)).toEqual(['Degree', 'Major', 'School', 'Start Date Month',
      'Start Date Year', 'End Date Month', 'End Date Year', 'Country', 'City', 'Average Grade']);
    for (const field of inEditor) expect(field.section, field.label).toEqual({ id: 'education', block: 0 });
    const category = (label: string) => plan.results.find((row) => row.key === inEditor
      .find((field) => field.label === label)!.key)?.category;
    expect(['Start Date Month', 'Start Date Year'].map(category)).toEqual(['education.startDate', 'education.startDate']);
    expect(['End Date Month', 'End Date Year'].map(category)).toEqual(['education.endDate', 'education.endDate']);
    expect(['Degree', 'Major', 'School'].map(category)).toEqual(['education.degree', 'education.field',
      'education.school']);
  });

  it('the entry it holds is read by its School: matched to the profile’s by fingerprint, else kept as it is',
    async () => {
      const doc = await after();
      const root = oracleAdapter.detect(doc)!.formRoot;
      const blocks = () => oracleAdapter.repeatables!(root)[0]!.blocks();
      const school = doc.querySelector<HTMLInputElement>(SCHOOL)!;
      // Nothing shown in its School: no entry read; the planner gives the block the profile's entry by its place.
      expect(oracleAdapter.prefill!.readEntries!('education', blocks())).toEqual([]);
      expect(planned(doc).plan.repeatables).toEqual([{ kind: 'education', profile: 1, entries: [0], current: [false] }]);
      // The profile's own school (an entry Oracle imported from it): matched by fingerprint.
      school.value = goldenProfile().education[0]!.institution.canonicalName;
      expect(oracleAdapter.prefill!.readEntries!('education', blocks())).toEqual([{ block: 0,
        values: [{ category: 'education.school', text: school.value }] }]);
      expect(planned(doc).plan.repeatables).toEqual([{ kind: 'education', profile: 1, entries: [0], current: [false] }]);
      // Another school (made up): no profile entry, so nothing of the entry is written over.
      school.value = 'Northfield Technical Institute';
      const { result, plan } = planned(doc);
      expect(plan.repeatables).toEqual([{ kind: 'education', profile: 1, entries: [null], current: [false] }]);
      const editor = doc.querySelector(EDITOR)!;
      // jr6 P2 (RULES item 7): the editor's City and Country are the entry's place, so an entry no profile entry
      // matches has them left too: never the person's home city or country.
      const inEditor = result.fields.filter((field) => editor.contains(result.target(field.key)!.control));
      const written = plan.writes.map((write) => result.fields.find((field) => field.key === write.key)!)
        .filter((field) => inEditor.includes(field));
      expect(written.map((field) => field.label)).toEqual([]);
      const rowOf = (label: string) => plan.results.find((row) => row.key === inEditor
        .find((field) => field.label === label)!.key);
      expect(rowOf('City')).toMatchObject({ category: 'education.city', wrote: false });
      expect(rowOf('Country')).toMatchObject({ category: 'education.country', wrote: false });
    });
});

// ── O8: a flow of several sections ────────────────────────────────────────────────────────────────────────────────

/** hjf-apply-section made a middle section of a flow of several (synthetic: no snapshot shows one, owner question 23):
 *  its Submit becomes a Next drawn as the gate draws its own (title, aria-label and words "Next"; the Submit's modifier
 *  gone), and, given `current`, the flow's navigation train (its a.apply-flow-navigation-train__block-link items) marks
 *  that item aria-current="step", as Jobright 1.25.2's getOracleCloudStepState reads a flow's progress. */
function asMiddleSection(doc: Document, current?: number): HTMLElement {
  const next = doc.querySelector<HTMLElement>('button.apply-flow-pagination__submit-button')!;
  next.classList.remove('apply-flow-pagination__submit-button');
  next.setAttribute('title', 'Next');
  next.setAttribute('aria-label', 'Next');
  next.textContent = 'Next';
  if (current !== undefined) mark(doc, current);
  return next;
}

/** The navigation train's item `at` marked as the current step (and no other); its words. */
function mark(doc: Document, at: number): string {
  const items = Array.from(doc.querySelectorAll('a.apply-flow-navigation-train__block-link'));
  for (const item of items) item.removeAttribute('aria-current');
  items[at]!.setAttribute('aria-current', 'step');
  return items[at]!.textContent!.replace(/\s+/g, ' ').trim();
}

const signatureOf = (doc: Document) => stepSignature(oracleAdapter.stepSignature!(doc));

describe('jr6 O8: a section’s Next, its finality and its step signature (a synthetic section page)', () => {
  it.each([1, 2])('section %i of several: its Next is the step’s, the step is not the last', async (n) => {
    const doc = await load(hjfSectionHtml, `${HJF}/apply/section/${n}`);
    const next = asMiddleSection(doc);
    const root = oracleAdapter.detect(doc)!.formRoot;
    expect(oracleAdapter.nextButton!(root)).toBe(next);
    expect(oracleAdapter.submitButton!(root)).toBeNull();
    expect(oracleAdapter.isFinalStep!(doc)).toBe('not-final');
    expect(stepButtonsOf({ doc, adapter: oracleAdapter, root })).toEqual({ final: 'not-final', next: true, submit: false });
    expect(assertNotSubmit(next, { adapter: oracleAdapter, root, allowNext: true }).ok).toBe(true);
  });

  it('not-final only at a section’s address, and only while no Submit shows', async () => {
    const doc = await load(hjfSectionHtml, `${HJF}/apply`);
    asMiddleSection(doc);
    expect(oracleAdapter.isFinalStep!(doc)).toBe('unknown');
    removeFixtures(document);
    const both = await load(hjfSectionHtml, `${HJF}/apply/section/2`);
    const submit = both.querySelector<HTMLElement>('button.apply-flow-pagination__submit-button')!;
    const copy = submit.cloneNode(true) as HTMLElement;
    submit.after(copy);
    asMiddleSection(both);
    expect(oracleAdapter.nextButton!(both.documentElement)).toBe(submit);
    expect(oracleAdapter.submitButton!(both.documentElement)).toBe(copy);
    expect(oracleAdapter.isFinalStep!(both)).toBe('final');
  });

  it('reads no Next where the pagination’s buttons say otherwise, show several, or hide it', async () => {
    const doc = await load(hjfSectionHtml, `${HJF}/apply/section/2`);
    const next = asMiddleSection(doc);
    const root = oracleAdapter.detect(doc)!.formRoot;
    // A Submit's modifier is never a Next, whatever it reads.
    next.classList.add('apply-flow-pagination__submit-button');
    expect(oracleAdapter.nextButton!(root)).toBeNull();
    next.classList.remove('apply-flow-pagination__submit-button');
    // Other words.
    for (const words of ['Back', 'Previous', 'Submit']) {
      for (const name of ['title', 'aria-label']) next.setAttribute(name, words);
      next.textContent = words;
      expect(oracleAdapter.nextButton!(root), words).toBeNull();
      expect(oracleAdapter.isFinalStep!(doc), words).toBe('unknown');
    }
    // Two Nexts: none.
    for (const name of ['title', 'aria-label']) next.setAttribute(name, 'Next');
    next.textContent = 'Next';
    next.after(next.cloneNode(true));
    expect(oracleAdapter.nextButton!(root)).toBeNull();
    next.nextElementSibling!.remove();
    // Hidden: none.
    next.style.display = 'none';
    expect(oracleAdapter.nextButton!(root)).toBeNull();
    next.style.display = '';
    expect(oracleAdapter.nextButton!(root)).toBe(next);
  });

  it('never on the gate or the code page, whose Next is Sign-in Auto’s', async () => {
    const gate = await load(caesarsGateHtml, `${CAESARS}/apply/email`);
    const root = oracleAdapter.detect(gate)!.formRoot;
    const footer = gate.querySelector('footer.apply-flow-pagination__buttons')!;
    expect(oracleAdapter.nextButton!(root)).toBeNull();
    // Even inside a pagination block such as a section's, the gate's Next is not the step's.
    const wrapper = gate.createElement('div');
    wrapper.className = 'apply-flow-pagination';
    footer.before(wrapper);
    wrapper.append(footer);
    expect(gate.querySelector('.apply-flow-pagination button[title="Next"]')).not.toBeNull();
    expect(oracleAdapter.nextButton!(root)).toBeNull();
    expect(oracleAdapter.isFinalStep!(gate)).toBe('unknown');
    removeFixtures(document);
    const code = await load(fortiveCodeHtml, FORTIVE_CODE);
    expect(oracleAdapter.nextButton!(oracleAdapter.detect(code)!.formRoot)).toBeNull();
  });

  it('the step signature: the section’s number, the progress step marked current, the first block title, the blocks',
    async () => {
      const doc = await load(hjfSectionHtml, `${HJF}/apply/section/2`);
      asMiddleSection(doc);
      const words = mark(doc, 1);
      expect(words).toBe('Contact Information');
      const parts = oracleAdapter.stepSignature!(doc);
      expect(parts).toMatchObject({ urlPart: 'section/2', progress: words, heading: 'Import your profile' });
      expect(parts.anchors).toEqual(expect.arrayContaining(['apply-flow-block--profile-import',
        'apply-flow-block--personal-information-basic', 'apply-flow-block--disqualification-questions',
        'apply-flow-block--work-and-education-timeline']));
      expect(parts.anchors.every((anchor) => anchor.startsWith('apply-flow-block--'))).toBe(true);
      const second = signatureOf(doc);
      // Another progress step, another step; the same parts, the same step.
      mark(doc, 2);
      expect(signatureOf(doc)).not.toBe(second);
      mark(doc, 1);
      expect(signatureOf(doc)).toBe(second);
      removeFixtures(document);
      // Another section's address: another step.
      const first = await load(hjfSectionHtml, `${HJF}/apply/section/1`);
      asMiddleSection(first, 1);
      expect(oracleAdapter.stepSignature!(first).urlPart).toBe('section/1');
      expect(signatureOf(first)).not.toBe(second);
    });

  it('the gate and the code page, which share their address, are two steps; the posting none', async () => {
    const gate = await load(caesarsGateHtml, `${CAESARS}/apply/email`);
    expect(oracleAdapter.stepSignature!(gate)).toMatchObject({ urlPart: 'email', anchors: ['email-gate'] });
    const gateSignature = signatureOf(gate);
    removeFixtures(document);
    const code = await load(fortiveCodeHtml, FORTIVE_CODE);
    expect(oracleAdapter.stepSignature!(code)).toMatchObject({ urlPart: 'email', anchors: ['email-code'] });
    expect(signatureOf(code)).not.toBe(gateSignature);
    removeFixtures(document);
    const posting = await load(caesarsPostingHtml, CAESARS);
    expect(oracleAdapter.stepSignature!(posting)).toEqual({ anchors: [] });
  });
});

// ── O12: an upload as Oracle's slot shows it ──────────────────────────────────────────────────────────────────────

describe('jr6 O12: an upload’s state, read from Oracle’s slot (synthetic states of hjf-apply-section’s cover letter)', () => {
  const NAME = 'Alex Rivera Cover Letter.pdf';

  /** The cover letter's slot drawn filled with `name` as the resume's slot is captured (its filled .attachment-upload-
   *  button copied in place of the waiting one, the input with it gone), the name made up. */
  function filled(doc: Document, name: string): void {
    const resume = doc.querySelector('resume-upload-button .attachment-upload-button--filled')!;
    const copy = resume.cloneNode(true) as Element;
    copy.querySelector('button.attachment-upload-button__download')!.textContent = name;
    doc.querySelector('cover-letter-upload-button .attachment-upload-button')!.replaceWith(copy);
    // Its fade-in run, as a person sees it once drawn.
    faded(doc);
  }

  it('pending while the slot waits; confirmed once it shows the file by name, found again by its errors’ list once '
    + 'the input is gone', async () => {
    const doc = await load(hjfSectionHtml, `${HJF}/apply/section/1`);
    const input = doc.querySelector<HTMLInputElement>('input#attachment-upload-3')!;
    expect(input.getAttribute('aria-describedby')).toBe('file-upload-errors-1');
    expect(oracleAdapter.uploadState!(input, NAME)).toBe('pending');
    filled(doc, NAME);
    expect(input.isConnected).toBe(false);
    expect(oracleAdapter.uploadState!(input, NAME)).toBe('confirmed');
    // Another file's name shown: not this upload's.
    expect(oracleAdapter.uploadState!(input, 'Other File.docx')).toBe('pending');
  });

  it('failed once its errors’ list shows words', async () => {
    const doc = await load(hjfSectionHtml, `${HJF}/apply/section/1`);
    const input = doc.querySelector<HTMLInputElement>('input#attachment-upload-3')!;
    const errors = doc.getElementById('file-upload-errors-1')!;
    expect(oracleAdapter.uploadState!(input, NAME)).toBe('pending');
    const message = doc.createElement('div');
    message.textContent = 'The file could not be uploaded.';
    errors.append(message);
    expect(oracleAdapter.uploadState!(input, NAME)).toBe('failed');
    // Hidden, it says nothing.
    errors.style.display = 'none';
    expect(oracleAdapter.uploadState!(input, NAME)).toBe('pending');
  });

  it('reads no other input: a text box, an upload with no slot of Oracle’s', async () => {
    const doc = await load(hjfSectionHtml, `${HJF}/apply/section/1`);
    expect(oracleAdapter.uploadState!(doc.querySelector<HTMLInputElement>('input#lastName-18')!, NAME)).toBeNull();
    const loose = doc.createElement('input');
    loose.type = 'file';
    loose.className = 'file-form-element__input';
    expect(oracleAdapter.uploadState!(loose, NAME)).toBeNull();
  });
});

// ══ P2 (FIXPLAN §6.11 "P2 asserts"): after jr6-engine E1-E3 and jr6-rules R1-R4 ══════════════════════════════════

const SECTION = `${HJF}/apply/section/1`;

/** The flow drawn on plain white (its cover image taken away), as oracle.browser.test.ts draws it. */
function plain(doc: Document): void {
  for (const el of Array.from(doc.querySelectorAll<HTMLElement>('.apply-flow'))) el.style.backgroundImage = 'none';
}

/** What a simulated cx-select lists: its rows, and, for a search, the rows it suggests for the words typed. */
interface CxList {
  rows: readonly string[];
  search?: (typed: string) => readonly string[];
}

/** One choice the page heard: the field's id, the row's words, and the class of the element the click landed on. */
interface CxChoice {
  id: string;
  words: string;
  on: string;
}

/**
 * jr6 P2: the page's cx-selects made to answer as Oracle's would by Jobright 1.25.2's reading of them
 * (operations.fillSelectField: the toggle #<id>-toggle-button, the grid the input's aria-controls names, its rows
 * div[role=row] > div[role=gridcell] > span.cx-select__list-item--content, Oracle's lone "No results" row when none
 * matches), since no capture shows one open (owner question 23). The rows' words are made up; this test's listeners on
 * the fixture's own elements do what Oracle's script would:
 * - a toggle's click opens its list, or shuts it: the grid drawn under its box at the end of the body, the box and the
 *   toggle aria-expanded "true"; a list with no rows shows the "No results" row;
 * - a search (`search`) draws, for the words typed into its box, the rows it suggests (a toggle opens it with every
 *   row); a click on its box alone draws nothing (Oracle Maps' hint: "Enter your street name and other address
 *   details to see suggestions");
 * - a row's click puts its words in the box and shuts the list, as Escape on the box and its focusout shut it;
 * - each choice is told to `onChoose`.
 */
function cxDrive(doc: Document, lists: Readonly<Record<string, CxList>>,
  onChoose: (choice: CxChoice) => void = () => undefined): void {
  const view = doc.defaultView!;
  for (const [id, list] of Object.entries(lists)) {
    const input = doc.getElementById(id) as HTMLInputElement;
    const toggle = doc.getElementById(`${id}-toggle-button`);
    const listId = input.getAttribute('aria-controls')!;
    const say = (open: boolean) => {
      for (const el of [input, toggle]) el?.setAttribute('aria-expanded', String(open));
    };
    const shut = () => {
      doc.getElementById(listId)?.remove();
      say(false);
    };
    const show = (rows: readonly string[]) => {
      doc.getElementById(listId)?.remove();
      const grid = doc.createElement('div');
      grid.id = listId;
      grid.setAttribute('role', 'grid');
      const box = input.getBoundingClientRect();
      grid.style.cssText = `position:absolute;z-index:2147483000;left:${box.left + view.scrollX}px;`
        + `top:${box.bottom + view.scrollY}px;width:${Math.max(box.width, 240)}px;background:#fff;color:#000;`
        + 'border:1px solid #767676;font:14px/20px sans-serif;';
      for (const words of rows.length === 0 ? ['No results'] : rows) {
        const row = doc.createElement('div');
        row.setAttribute('role', 'row');
        row.style.cssText = 'display:block;padding:4px 8px;';
        const cell = doc.createElement('div');
        cell.setAttribute('role', 'gridcell');
        const span = doc.createElement('span');
        span.className = 'cx-select__list-item--content';
        span.textContent = words;
        cell.append(span);
        row.append(cell);
        grid.append(row);
      }
      grid.addEventListener('click', (event) => {
        const target = event.target as Element;
        const row = target.closest('[role="row"]');
        const words = (row?.textContent ?? '').trim();
        if (row === null || words === 'No results') return;
        input.value = words;
        shut();
        onChoose({ id, words, on: target.className });
      });
      doc.body.append(grid);
      say(true);
    };
    toggle?.addEventListener('click', () => (doc.getElementById(listId) === null ? show(list.rows) : shut()));
    const suggest = list.search;
    if (suggest !== undefined) {
      input.addEventListener('input', () => (input.value.trim() === '' ? shut() : show(suggest(input.value.trim()))));
    }
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') shut();
    });
    input.addEventListener('focusout', shut);
  }
}

/** Synthetic lists (made-up rows, the golden profile's answers among them). */
const COUNTRIES = ['Canada', 'Mexico', 'United States'];
const STATES = ['California', 'Texas', 'Washington'];
const CITIES = ['Austin', 'Dallas', 'Houston'];
const COUNTIES = ['Bexar', 'Travis', 'Williamson'];
/** The phone's codes as "<country> (+<dial code>)": two share +1, so the code is chosen by its country too (O5). */
const CODES = ['Canada (+1)', 'Mexico (+52)', 'United Kingdom (+44)', 'United States (+1)'];
const DEGREES = ["Associate's Degree", "Bachelor's Degree", "Master's Degree", 'Doctorate'];

/** Oracle Maps' suggestions for the golden profile's street (synthetic): the street with its USPS abbreviation in
 *  another city of the state, in the profile's city, in another state, and another number in the profile's city. */
function streetSuggestions(): { austin: string; all: string[] } {
  const address = goldenProfile().address!;
  const [, number, name] = /^(\d+)\s+(\S+)/.exec(address.line1!)!;
  const austin = `${number} ${name} Ln, Austin, TX ${address.postalCode!}`;
  return { austin, all: [`${number} ${name} Ln, Dallas, TX 75201`, austin, `${number} ${name} Ln, Portland, OR 97201`,
    `${Number(number) + 54} ${name} Ln, Austin, TX ${address.postalCode!}`] };
}

/** The postal codes the ZIP Code's list holds (synthetic, the golden profile's among them). */
function postalCodes(): string[] {
  const zip = goldenProfile().address!.postalCode!;
  return [zip, `${zip.slice(0, 3)}02`, `${zip.slice(0, 3)}03`, '73301'];
}

/** The address search's suggestions: Oracle Maps answers words that start with a house number. */
const suggestStreet = (typed: string) => (/^\d+\s/.test(typed) ? streetSuggestions().all : []);
/** The ZIP Code's search: the codes that start with the words typed. */
const suggestPostal = (typed: string) => postalCodes().filter((code) => code.startsWith(typed));

/** A scan of the page's form, with the run's list readings and an adapter (Oracle's by default). */
function scanWith(doc: Document, readings?: Map<BaseKey, WidgetReading>, adapter: Adapter = oracleAdapter): ScanResult {
  return scan(adapter.detect(doc)!.formRoot, adapter, { platform: 'oracle',
    ...(readings === undefined ? {} : { widgetReadings: readings }) });
}

/** The live target of the field whose control has this id. */
function targetOf(result: ScanResult, id: string): FieldTarget {
  const field = result.fields.find((one) => result.target(one.key)?.control.id === id);
  if (field === undefined) throw new Error(`no field of control #${id}`);
  return result.target(field.key)!;
}

/** The labels a read found, or the read itself. */
const labelsRead = (read: Awaited<ReturnType<typeof readWidget>>) => (read.status === 'read'
  && read.reading.kind === 'options' ? read.reading.options.map((option) => option.label) : read);

/** Untrusted events only, each the fillers' or a declared key's; never a submit. */
function expectOurEventsOnly(log: EventLog): void {
  expect(untrustedViolations(log.events)).toEqual([]);
  const ours = new Set<string>([...ALLOWED_EVENTS, ...KEY_EVENTS]);
  expect(log.events.filter((event) => !event.trusted && !ours.has(event.type))).toEqual([]);
  expect(log.events.filter((event) => event.type === 'submit')).toEqual([]);
}

/** The golden profile's phone number without its calling code (fixtures/profiles/alex-rivera.*). */
function nationalDigits(): string {
  const phone = goldenProfile().contact.phone!;
  const code = phone.countryCallingCode ?? '';
  return phone.digits.length > 10 && phone.digits.startsWith(code) ? phone.digits.slice(code.length) : phone.digits;
}

// ── P2 O4 (ENGINE E2): the phone's number box ─────────────────────────────────────────────────────────────────────

describe('jr6 P2 O4: the phone’s number box reads fillable, drawn by its group (ENGINE E2 reads controlBox)', () => {
  it.each([
    { name: 'hjf-apply-section as captured', html: hjfSectionHtml, closed: false, white: false },
    { name: 'hjf-apply-section on plain white', html: hjfSectionHtml, closed: false, white: true },
    { name: 'hjf-after-submit (checklist closed) as captured', html: hjfAfterSubmitHtml, closed: true, white: false },
    { name: 'hjf-after-submit (checklist closed) on plain white', html: hjfAfterSubmitHtml, closed: true, white: true },
  ])('$name: fillable and not camouflaged; the same scan without the hook reads it camouflaged', async ({ html, closed,
    white }) => {
    const doc = await load(html, SECTION, (page) => {
      if (closed) closeChecklist(page);
      if (white) plain(page);
    });
    const number = doc.querySelector('input.phone-row__input')!;
    const read = (adapter: Adapter) => {
      const result = scanWith(doc, undefined, adapter);
      const field = result.fields.find((one) => result.target(one.key)?.control === number)!;
      return { label: field.label, camouflaged: field.camouflaged,
        fillability: fillabilityOf(field, result.target(field.key)?.widget) };
    };
    expect(read(oracleAdapter)).toEqual({ label: 'Phone Number', camouflaged: false, fillability: { fillable: true } });
    const { controlBox: _drawn, ...withoutBox } = oracleAdapter;
    expect(read(withoutBox)).toEqual({ label: 'Phone Number', camouflaged: true,
      fillability: { fillable: false, reason: 'camouflaged' } });
  });
});

// ── P2 O1, O5 (ENGINE E1): the cx-selects read, planned and chosen ────────────────────────────────────────────────

describe('jr6 P2 O1, O5: the cx-selects read whole, planned and chosen by their declared rows (synthetic lists)', () => {
  it('hjf-apply-section: the Country’s grid is read by its rows’ label parts and shut again; the planned row is chosen '
    + 'by a click on its label span and read back', async () => {
    const doc = await load(hjfSectionHtml, SECTION);
    const chosen: CxChoice[] = [];
    cxDrive(doc, { 'country-17': { rows: COUNTRIES } }, (choice) => chosen.push(choice));
    const events = logEvents(doc);
    const readings = new Map<BaseKey, WidgetReading>();
    const ctx = { adapter: oracleAdapter, root: oracleAdapter.detect(doc)!.formRoot, readings };
    expect(labelsRead(await readWidget(targetOf(scanWith(doc, readings), 'country-17'), ctx))).toEqual(COUNTRIES);
    // Shut again (the box's focusout): no grid, the toggle says closed. The toggle was clicked once; nothing typed.
    expect(doc.getElementById('country-17-listbox')).toBeNull();
    expect(doc.getElementById('country-17-toggle-button')!.getAttribute('aria-expanded')).toBe('false');
    expect(events.on('country-17-toggle-button').filter((event) => event.type === 'click').length).toBe(1);
    expect(events.on('country-17').filter((event) => event.type === 'input')).toEqual([]);
    // The scan now gives the field the rows read.
    const target = targetOf(scanWith(doc, readings), 'country-17');
    expect(target.field.options === 'lazy' ? 'lazy' : target.field.options.map((option) => option.label))
      .toEqual(COUNTRIES);
    const value: WriteValue = { kind: 'option', index: 2, cleanLabel: 'United States' };
    expect(await fillWidget(target, value, ctx))
      .toEqual({ wrote: true, verification: 'verified', reason: 'ok', needsUserAction: false });
    // The click landed on the row's label span (choose 'label'), which the row's own listener took.
    expect(chosen).toEqual([{ id: 'country-17', words: 'United States', on: 'cx-select__list-item--content' }]);
    expect((doc.getElementById('country-17') as HTMLInputElement).value).toBe('United States');
    expect(doc.getElementById('country-17-listbox')).toBeNull();
    expect(widgetHolds(targetOf(scanWith(doc, readings), 'country-17'), value)).toBe(true);
    expectOurEventsOnly(events);
  });

  it('hjf-apply-section: a list that shows only Oracle’s "No results" row gives no option, and is never made a search',
    async () => {
      const doc = await load(hjfSectionHtml, SECTION);
      cxDrive(doc, { 'region1-45': { rows: [] } });
      const events = logEvents(doc);
      const readings = new Map<BaseKey, WidgetReading>();
      const ctx = { adapter: oracleAdapter, root: oracleAdapter.detect(doc)!.formRoot, readings };
      expect(await readWidget(targetOf(scanWith(doc, readings), 'region1-45'), ctx))
        .toEqual({ status: 'unread', reason: 'options-never-loaded' });
      expect(readings.size).toBe(0);
      expect(doc.getElementById('region1-45-listbox')).toBeNull();
      expect(events.on('region1-45').filter((event) => event.type === 'input')).toEqual([]);
      expectOurEventsOnly(events);
    });

  it('hjf-apply-section: Country, State and the phone’s code are planned from their lists and chosen: the code by '
    + 'its dial code and its country (O5), the number planned national beside it', async () => {
    const doc = await load(hjfSectionHtml, SECTION);
    const chosen: CxChoice[] = [];
    cxDrive(doc, { 'country-17': { rows: COUNTRIES }, 'region2-44': { rows: STATES },
      'country-codes-dropdownphoneNumber': { rows: CODES } }, (choice) => chosen.push(choice));
    const events = logEvents(doc);
    const readings = new Map<BaseKey, WidgetReading>();
    const ctx = { adapter: oracleAdapter, root: oracleAdapter.detect(doc)!.formRoot, readings };
    const ids = ['country-codes-dropdownphoneNumber', 'country-17', 'region2-44'];
    for (const id of ids) expect((await readWidget(targetOf(scanWith(doc, readings), id), ctx)).status, id).toBe('read');
    const { result, plan } = planned(doc, { readings });
    const keyOf = (id: string) => targetOf(result, id).field.key;
    const writeOf = (id: string) => plan.writes.find((write) => write.key === keyOf(id));
    const rowOf = (id: string) => plan.results.find((row) => row.key === keyOf(id));
    expect(rowOf('country-codes-dropdownphoneNumber')).toMatchObject({ category: 'contact.phoneCountry' });
    expect(writeOf('country-codes-dropdownphoneNumber')?.value)
      .toEqual({ kind: 'option', index: 3, cleanLabel: 'United States (+1)' });
    expect(rowOf('country-17')).toMatchObject({ category: 'address.country' });
    expect(writeOf('country-17')?.value).toEqual({ kind: 'option', index: 2, cleanLabel: 'United States' });
    expect(rowOf('region2-44')).toMatchObject({ category: 'address.region' });
    expect(writeOf('region2-44')?.value).toEqual({ kind: 'option', index: 1, cleanLabel: 'Texas' });
    const number = result.fields.find((field) => result.target(field.key)?.control.matches('input.phone-row__input'))!;
    const typed = plan.writes.find((write) => write.key === number.key)?.value;
    expect(typed?.kind).toBe('text');
    const text = typed?.kind === 'text' ? typed.text : '';
    expect(text).not.toMatch(/^\s*\+/);
    expect(text.replace(/\D/g, '')).toBe(nationalDigits());
    for (const id of ids) {
      expect(await fillWidget(targetOf(scanWith(doc, readings), id), writeOf(id)!.value, ctx), id)
        .toEqual({ wrote: true, verification: 'verified', reason: 'ok', needsUserAction: false });
    }
    expect(chosen.map((choice) => [choice.id, choice.words, choice.on])).toEqual([
      ['country-codes-dropdownphoneNumber', 'United States (+1)', 'cx-select__list-item--content'],
      ['country-17', 'United States', 'cx-select__list-item--content'],
      ['region2-44', 'Texas', 'cx-select__list-item--content']]);
    expectOurEventsOnly(events);
  });

  it('hjf-after-submit: the education editor’s Degree is planned from its list and chosen', async () => {
    const doc = await load(hjfAfterSubmitHtml, SECTION, closeChecklist);
    const chosen: CxChoice[] = [];
    cxDrive(doc, { 'contentItemId-46': { rows: DEGREES } }, (choice) => chosen.push(choice));
    const readings = new Map<BaseKey, WidgetReading>();
    const ctx = { adapter: oracleAdapter, root: oracleAdapter.detect(doc)!.formRoot, readings };
    expect(labelsRead(await readWidget(targetOf(scanWith(doc, readings), 'contentItemId-46'), ctx))).toEqual(DEGREES);
    const { result, plan } = planned(doc, { readings });
    const key = targetOf(result, 'contentItemId-46').field.key;
    expect(plan.results.find((row) => row.key === key)).toMatchObject({ category: 'education.degree' });
    const write = plan.writes.find((one) => one.key === key)!;
    expect(write.value).toEqual({ kind: 'option', index: 1, cleanLabel: "Bachelor's Degree" });
    expect(await fillWidget(targetOf(scanWith(doc, readings), 'contentItemId-46'), write.value, ctx))
      .toEqual({ wrote: true, verification: 'verified', reason: 'ok', needsUserAction: false });
    expect(chosen).toEqual([{ id: 'contentItemId-46', words: "Bachelor's Degree", on: 'cx-select__list-item--content' }]);
  });
});

// ── P2 O10 (ENGINE E1 item 12): no futile search ──────────────────────────────────────────────────────────────────

describe('jr6 P2 O10: no futile search on a cx-select (declared now; an undeclared grid is refused)', () => {
  const LISTS = ['country-codes-dropdownphoneNumber', 'country-17', 'city-43', 'region2-44', 'region1-45'];
  const SEARCHES = ['addressLine1-39', 'postalCode-42'];

  it('hjf-apply-section: each declared list is opened by its toggle and read, never typed into; the two searches are '
    + 'not opened to be read', async () => {
    const doc = await load(hjfSectionHtml, SECTION);
    cxDrive(doc, { 'country-codes-dropdownphoneNumber': { rows: CODES }, 'country-17': { rows: COUNTRIES },
      'city-43': { rows: CITIES }, 'region2-44': { rows: STATES }, 'region1-45': { rows: COUNTIES },
      'addressLine1-39': { rows: [], search: suggestStreet },
      'postalCode-42': { rows: postalCodes(), search: suggestPostal } });
    const events = logEvents(doc);
    const readings = new Map<BaseKey, WidgetReading>();
    const ctx = { adapter: oracleAdapter, root: oracleAdapter.detect(doc)!.formRoot, readings };
    for (const id of LISTS) {
      const target = targetOf(scanWith(doc, readings), id);
      expect(target.widget, id).toMatchObject({ declared: true, kind: 'combobox' });
      expect((await readWidget(target, ctx)).status, id).toBe('read');
      expect(events.on(`${id}-toggle-button`).filter((event) => event.type === 'click').length, id).toBe(1);
    }
    for (const id of SEARCHES) {
      const target = targetOf(scanWith(doc, readings), id);
      expect(target.widget, id).toMatchObject({ declared: true, kind: 'typeahead-remote' });
      expect(await readWidget(target, ctx), id).toEqual({ status: 'read', reading: { kind: 'remote' } });
      expect(events.on(id), id).toEqual([]);
      expect(events.on(`${id}-toggle-button`), id).toEqual([]);
    }
    // Nothing was typed into any cx-select's box.
    for (const id of [...LISTS, ...SEARCHES]) {
      expect(events.on(id).filter((event) => event.type === 'input'), id).toEqual([]);
    }
    expectOurEventsOnly(events);
  });

  it.each([
    { name: 'hjf-apply-section', html: hjfSectionHtml, closed: false, ids: ['country-codes-dropdownphoneNumber',
      'country-17', 'addressLine1-39', 'postalCode-42', 'city-43', 'region2-44', 'region1-45'] },
    { name: 'hjf-after-submit (checklist closed)', html: hjfAfterSubmitHtml, closed: true, ids: [...EDITOR_SELECTS] },
  ])('$name: undeclared (the adapter without widgetFor), every cx-select is refused before any click: no event, never '
    + 'read as a search', async ({ html, closed, ids }) => {
    const doc = await load(html, SECTION, closed ? closeChecklist : undefined);
    const events = logEvents(doc);
    const { widgetFor: _declared, ...undeclared } = oracleAdapter;
    const readings = new Map<BaseKey, WidgetReading>();
    const ctx = { adapter: undeclared, root: undeclared.detect(doc)!.formRoot, readings };
    for (const id of ids) {
      const target = targetOf(scanWith(doc, readings, undeclared), id);
      expect(target.widget?.declared, id).toBe(false);
      expect(isActionable(target.widget!), id).toBe(false);
      expect(fillabilityOf(target.field, target.widget), id).toEqual({ fillable: false, reason: 'widget-phase-4' });
      expect(await readWidget(target, ctx), id).toEqual({ status: 'unread', reason: 'widget-unsupported' });
    }
    expect(readings.size).toBe(0);
    expect(events.events).toEqual([]);
  });
});

// ── P2 O2 (RULES item 61): Address Line 1 and ZIP Code searched ───────────────────────────────────────────────────

/** A search's results as the worker matches them (content/pass.ts resultsSpec): the field's spec with the results as
 *  its options, marked a search's, nothing chosen yet. */
function resultsSpec(target: FieldTarget, labels: readonly string[]): FieldSpec {
  const options = labels.map((label, index) => ({ index, label, disabled: false, selected: false }));
  const { optionsPartial: _partial, ...spec } = toFieldSpec(target.field);
  return { ...spec, options, optionSetHash: hashOfOptions(options.map((option) => option.label)),
    current: { kind: 'empty' }, searchResults: true };
}

/** The worker's match of one search's results: the planner over that one spec, with the golden profile. */
function matchByPlanner(labels: readonly string[], target: FieldTarget): { write: PlannedWrite | undefined;
  row: FillResult | undefined } {
  const spec = resultsSpec(target, labels);
  const plan = planFrame({ specs: [spec], planKeys: [spec.key], canaries: [], profile: goldenProfile(),
    sensitiveState: 'loaded', savedAnswers: [], settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW,
    posting: { company: 'Acme', location: 'Austin, TX, USA' } });
  return { write: plan.writes.find((one) => one.key === spec.key), row: plan.results.find((one) => one.key === spec.key) };
}

/** A search's hooks over the page itself: each query's field found again on a fresh scan, and each results list
 *  matched by the planner as the worker matches it (matchByPlanner); the lists seen. */
function plannerHooks(doc: Document, id: string, readings: Map<BaseKey, WidgetReading>): TypeaheadHooks & {
  seen: string[][] } {
  const seen: string[][] = [];
  return {
    seen,
    guard: async () => ({ ok: true, target: targetOf(scanWith(doc, readings), id) }),
    match: async (results, now) => {
      seen.push(results.map((one) => one.label));
      const { write: pick, row } = matchByPlanner(results.map((one) => one.label), now);
      return pick?.value.kind === 'option' ? { choose: { index: pick.value.index, cleanLabel: pick.value.cleanLabel } }
        : { choose: null, reason: row?.reason ?? 'no-match', blocked: false };
    },
  };
}

describe('jr6 P2 O2: Address Line 1 and ZIP Code are searched (RULES item 61; synthetic suggestions)', () => {
  it('hjf-apply-section: ZIP Code is the postal code, searched by the profile’s five digits, then their first three',
    async () => {
      const doc = await load(hjfSectionHtml, SECTION);
      const { result, plan } = planned(doc);
      const key = targetOf(result, 'postalCode-42').field.key;
      expect(plan.results.find((row) => row.key === key)).toMatchObject({ category: 'address.postalCode' });
      const zip = goldenProfile().address!.postalCode!;
      expect(plan.writes.find((write) => write.key === key)?.value)
        .toEqual({ kind: 'query', queries: [zip, zip.slice(0, 3)] });
    });

  it('the planner chooses the suggestion that starts with the street and names the city and state; none where no '
    + 'suggestion starts with it in the profile’s city or state', async () => {
    const doc = await load(hjfSectionHtml, SECTION);
    const target = targetOf(scanWith(doc), 'addressLine1-39');
    const { austin, all } = streetSuggestions();
    const chosen = matchByPlanner(all, target);
    expect(chosen.write?.value).toEqual({ kind: 'option', index: all.indexOf(austin), cleanLabel: austin });
    expect(chosen.row).toMatchObject({ category: 'address.line1' });
    // Another number in the profile's city, and the street in another state: neither is the street.
    expect(matchByPlanner([all[3]!, all[2]!], target).write).toBeUndefined();
  });

  it('hjf-apply-section: the search types the street at once, the worker’s match chooses its Austin suggestion by its '
    + 'label span, and the box reads it back', async () => {
    const doc = await load(hjfSectionHtml, SECTION);
    const chosen: CxChoice[] = [];
    cxDrive(doc, { 'addressLine1-39': { rows: [], search: suggestStreet } }, (choice) => chosen.push(choice));
    const events = logEvents(doc);
    const readings = new Map<BaseKey, WidgetReading>();
    const ctx = { adapter: oracleAdapter, root: oracleAdapter.detect(doc)!.formRoot, readings };
    const { result, plan } = planned(doc);
    const write = plan.writes.find((one) => one.key === targetOf(result, 'addressLine1-39').field.key)!;
    expect(write.value).toEqual({ kind: 'query', queries: [goldenProfile().address!.line1] });
    const hooks = plannerHooks(doc, 'addressLine1-39', readings);
    const queries = write.value.kind === 'query' ? write.value.queries : [];
    const outcome = await searchTypeahead(targetOf(scanWith(doc, readings), 'addressLine1-39'), queries, ctx, hooks);
    const { austin, all } = streetSuggestions();
    expect(outcome).toMatchObject({ chosen: { index: all.indexOf(austin), cleanLabel: austin }, verified: true,
      reason: 'ok', typed: 1 });
    expect(hooks.seen).toEqual([all]);
    expect(chosen).toEqual([{ id: 'addressLine1-39', words: austin, on: 'cx-select__list-item--content' }]);
    expect((doc.getElementById('addressLine1-39') as HTMLInputElement).value).toBe(austin);
    // Typed at once: its box was never clicked (it has no toggle), and its suggestions are shut.
    expect(events.on('addressLine1-39').filter((event) => event.type === 'click')).toEqual([]);
    expect(doc.getElementById('addressLine1-39-listbox')).toBeNull();
    expectOurEventsOnly(events);
  });

  it('hjf-apply-section: ZIP Code’s search opens its list by its toggle, types the five digits and chooses the code',
    async () => {
      const doc = await load(hjfSectionHtml, SECTION);
      const chosen: CxChoice[] = [];
      cxDrive(doc, { 'postalCode-42': { rows: postalCodes(), search: suggestPostal } }, (choice) => chosen.push(choice));
      const events = logEvents(doc);
      const readings = new Map<BaseKey, WidgetReading>();
      const ctx = { adapter: oracleAdapter, root: oracleAdapter.detect(doc)!.formRoot, readings };
      const zip = goldenProfile().address!.postalCode!;
      const hooks = plannerHooks(doc, 'postalCode-42', readings);
      const outcome = await searchTypeahead(targetOf(scanWith(doc, readings), 'postalCode-42'), [zip, zip.slice(0, 3)],
        ctx, hooks);
      expect(outcome).toMatchObject({ chosen: { cleanLabel: zip }, verified: true, reason: 'ok', typed: 1 });
      expect(hooks.seen).toEqual([[zip]]);
      expect(chosen).toEqual([{ id: 'postalCode-42', words: zip, on: 'cx-select__list-item--content' }]);
      expect(events.on('postalCode-42-toggle-button').filter((event) => event.type === 'click').length).toBe(1);
      expectOurEventsOnly(events);
    });
});

// ── P2 O3 (ENGINE E3 item 14): the address block's order ─────────────────────────────────────────────────────────

describe('jr6 P2 O3: the address block’s parents first, its dependents decided again (ENGINE E3 item 14)', () => {
  it('hjf-apply-section: the scan’s parents are the block’s order, and a pass’s queue puts each parent first', async () => {
    const doc = await load(hjfSectionHtml, SECTION);
    const result = scanWith(doc);
    const labelOf = (base: BaseKey) => result.fields.find((field) => field.baseKey === base)!.label;
    const parents = [...dependenciesOf(result, oracleAdapter)].map(([child, parent]) => [labelOf(child), labelOf(parent)]);
    expect(parents).toEqual([['Address Line 1', 'Country'], ['ZIP Code', 'Address Line 1'], ['City', 'Address Line 1'],
      ['State', 'Address Line 1'], ['County', 'Address Line 1']]);
    // A queue holding the block from its last row up: each parent is written first, its dependents right after it.
    const order = ['County', 'State', 'City', 'ZIP Code', 'Address Line 1', 'Country'];
    const keyOf = (label: string) => result.fields.find((field) => field.label === label)!.key;
    const queue = order.map((label) => ({ label, write: { key: keyOf(label) } as unknown as PlannedWrite }));
    expect(parentsFirst(queue, result, oracleAdapter).map((entry) => entry.label))
      .toEqual(['Country', 'Address Line 1', 'County', 'State', 'City', 'ZIP Code']);
    // Without the adapter's parents the queue stands as it came.
    const { dependsOn: _parents, ...unordered } = oracleAdapter;
    expect(parentsFirst(queue, result, unordered).map((entry) => entry.label)).toEqual(order);
  });

  it('hjf-after-submit (checklist closed): the education editor’s rows wait on nothing; the address block’s parents '
    + 'stand', async () => {
    const doc = await load(hjfAfterSubmitHtml, SECTION, closeChecklist);
    const result = scanWith(doc);
    const fieldOf = (base: BaseKey) => result.fields.find((field) => field.baseKey === base)!;
    const children = [...dependenciesOf(result, oracleAdapter).keys()].map(fieldOf);
    expect(children.map((field) => field.label)).toEqual(['Address Line 1', 'ZIP Code', 'City', 'State', 'County']);
    expect(children.every((field) => field.section.id !== 'education')).toBe(true);
  });

  it('hjf-apply-section: County is the county (address.county), left for the person: required, no profile holds one',
    async () => {
      const doc = await load(hjfSectionHtml, SECTION);
      cxDrive(doc, { 'region1-45': { rows: COUNTIES } });
      const readings = new Map<BaseKey, WidgetReading>();
      const ctx = { adapter: oracleAdapter, root: oracleAdapter.detect(doc)!.formRoot, readings };
      for (const read of [false, true]) {
        if (read) expect((await readWidget(targetOf(scanWith(doc, readings), 'region1-45'), ctx)).status).toBe('read');
        const { result, plan } = planned(doc, { readings });
        const key = targetOf(result, 'region1-45').field.key;
        expect(plan.results.find((row) => row.key === key), `list read: ${String(read)}`).toMatchObject({
          category: 'address.county', status: 'flagged', reason: 'no-profile-value', needsUserAction: true });
        expect(plan.writes.find((write) => write.key === key)).toBeUndefined();
      }
    });
});

// ── P2 O7, oracle-new-2 (RULES items 7, 78): the education editor's fields are the entry's ───────────────────────

describe('jr6 P2 O7, oracle-new-2: the education editor’s place, dates and grade are the entry’s (RULES items 7, 78)',
  () => {
    /** The golden profile with its one school moved to another city and country (a variant built in code; the golden
     *  profile itself unchanged). */
    function schoolAbroad(): Profile {
      const profile = structuredClone(goldenProfile());
      const entry = profile.education[0]!;
      entry.institution = { ...entry.institution, canonicalName: 'Lakeshore Polytechnic', aliases: [], ids: {},
        city: 'Toronto', region: 'ON', country: 'CA', source: 'user', userText: 'Lakeshore Polytechnic' };
      return profile;
    }

    it('hjf-after-submit: the editor’s City and Country are the school’s, the home block’s the person’s; Average Grade '
      + 'is the GPA', async () => {
      const doc = await load(hjfAfterSubmitHtml, SECTION, closeChecklist);
      cxDrive(doc, { 'countryCode-51': { rows: COUNTRIES }, 'country-17': { rows: COUNTRIES },
        'city-43': { rows: CITIES } });
      const readings = new Map<BaseKey, WidgetReading>();
      const ctx = { adapter: oracleAdapter, root: oracleAdapter.detect(doc)!.formRoot, readings };
      for (const id of ['countryCode-51', 'country-17', 'city-43']) {
        expect((await readWidget(targetOf(scanWith(doc, readings), id), ctx)).status, id).toBe('read');
      }
      const { result, plan } = planned(doc, { readings, profile: schoolAbroad() });
      const of = (id: string) => {
        const key = targetOf(result, id).field.key;
        return { category: plan.results.find((row) => row.key === key)?.category,
          value: plan.writes.find((write) => write.key === key)?.value };
      };
      expect(of('countryCode-51')).toEqual({ category: 'education.country',
        value: { kind: 'option', index: 0, cleanLabel: 'Canada' } });
      expect(of('city-52')).toEqual({ category: 'education.city', value: { kind: 'text', text: 'Toronto' } });
      expect(of('country-17')).toEqual({ category: 'address.country',
        value: { kind: 'option', index: 2, cleanLabel: 'United States' } });
      expect(of('city-43')).toEqual({ category: 'address.city',
        value: { kind: 'option', index: 0, cleanLabel: 'Austin' } });
      const gpa = goldenProfile().education[0]!.gpa!;
      expect(of('averageGrade-53')).toEqual({ category: 'education.gpa',
        value: { kind: 'text', text: String(gpa.value) } });
    });

    it('hjf-after-submit: the editor’s dates are the entry’s, chosen from their lists, never the person’s start date',
      async () => {
        const doc = await load(hjfAfterSubmitHtml, SECTION, closeChecklist);
        const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
          'November', 'December'];
        const entry = goldenProfile().education[0]!;
        const years = (at: number) => [String(at - 1), String(at), String(at + 1)];
        cxDrive(doc, { 'month-startDate-49': { rows: MONTHS }, 'year-startDate-49': { rows: years(entry.startDate!.y) },
          'month-endDate-50': { rows: MONTHS }, 'year-endDate-50': { rows: years(entry.endDate!.y) } });
        const readings = new Map<BaseKey, WidgetReading>();
        const ctx = { adapter: oracleAdapter, root: oracleAdapter.detect(doc)!.formRoot, readings };
        const ids = ['month-startDate-49', 'year-startDate-49', 'month-endDate-50', 'year-endDate-50'];
        for (const id of ids) {
          expect((await readWidget(targetOf(scanWith(doc, readings), id), ctx)).status, id).toBe('read');
        }
        const { result, plan } = planned(doc, { readings });
        const of = (id: string) => {
          const key = targetOf(result, id).field.key;
          const value = plan.writes.find((write) => write.key === key)?.value;
          return [plan.results.find((row) => row.key === key)?.category,
            value?.kind === 'option' ? value.cleanLabel : null];
        };
        expect(ids.map(of)).toEqual([
          ['education.startDate', MONTHS[entry.startDate!.m! - 1]], ['education.startDate', String(entry.startDate!.y)],
          ['education.endDate', MONTHS[entry.endDate!.m! - 1]], ['education.endDate', String(entry.endDate!.y)]]);
      });
  });

// ── P2 O13 (RULES item 79): the numbered links ───────────────────────────────────────────────────────────────────

describe('jr6 P2 O13: "Link N" takes the profile’s links in order (RULES item 79)', () => {
  it('hjf-apply-section: Link 1 is the LinkedIn profile; a second row (a variant) the GitHub one', async () => {
    const doc = await load(hjfSectionHtml, SECTION);
    const links = goldenProfile().links;
    const linkOf = (run: ReturnType<typeof planned>, id: string) => {
      const key = targetOf(run.result, id).field.key;
      return { category: run.plan.results.find((row) => row.key === key)?.category,
        value: run.plan.writes.find((write) => write.key === key)?.value };
    };
    expect(linkOf(planned(doc), 'siteLink-1-38'))
      .toEqual({ category: 'links.numbered', value: { kind: 'text', text: links.linkedin } });
    // A page showing two link rows: the second made in place from the first, as "Add Another Link" draws one.
    const box = doc.getElementById('siteLink-1-38') as HTMLInputElement;
    const row = box.closest('.input-row')!;
    const copy = row.cloneNode(true) as Element;
    const second = copy.querySelector<HTMLInputElement>('input#siteLink-1-38')!;
    second.id = 'siteLink-2-99';
    second.name = 'siteLink-2';
    copy.querySelector('label[for="siteLink-1-38"]')?.setAttribute('for', 'siteLink-2-99');
    for (const text of Array.from(copy.querySelectorAll('label, span'))) {
      if (text.childElementCount === 0 && /Link 1/.test(text.textContent ?? '')) text.textContent = 'Link 2';
    }
    row.after(copy);
    const two = planned(doc);
    expect(targetOf(two.result, 'siteLink-2-99').field.label).toBe('Link 2');
    expect(linkOf(two, 'siteLink-1-38')).toEqual({ category: 'links.numbered', value: { kind: 'text', text: links.linkedin } });
    expect(linkOf(two, 'siteLink-2-99')).toEqual({ category: 'links.numbered', value: { kind: 'text', text: links.github } });
  });
});

// ── P2 O1, O2, O3, O5 in the content runtime ───────────────────────────────────────────────────────────────────

describe('jr6 P2 O1, O2, O3, O5 in the content runtime: the contact and address blocks filled (synthetic lists)', () => {
  beforeAll(() => testVocab());
  const runtimes: ContentRuntime[] = [];
  afterEach(() => {
    for (const runtime of runtimes.splice(0)) runtime.stop();
  });

  /** hjf-apply-section with its contact and address blocks only: its other blocks (the questions, the timeline, the
   *  uploads, whose cover letter would wait for a letter, the agreements, the signature) taken out in the test. */
  function contactAndAddress(doc: Document): void {
    for (const block of Array.from(doc.querySelectorAll('.apply-flow-block'))) {
      if (!/\bapply-flow-block--personal-information-(?:basic|address)/.test(block.className)) block.remove();
    }
  }

  /** The address block's boxes a new Country empties (the block drawn again for it). */
  const BLOCK = ['addressLine1-39', 'postalCode-42', 'city-43', 'region2-44', 'region1-45'];

  it('chooses every list, types the street again after the Country emptied it and the ZIP after the street, decides '
    + 'the dependents again after each parent’s write, and ends with the number national beside its code',
  async () => {
    const doc = await load(hjfSectionHtml, SECTION, contactAndAddress);
    const timeline: Array<{ kind: 'choose'; id: string } | { kind: 'plan'; labels: string[] }> = [];
    cxDrive(doc, { 'country-codes-dropdownphoneNumber': { rows: CODES }, 'country-17': { rows: COUNTRIES },
      'addressLine1-39': { rows: [], search: suggestStreet },
      'postalCode-42': { rows: postalCodes(), search: suggestPostal },
      'city-43': { rows: CITIES }, 'region2-44': { rows: STATES }, 'region1-45': { rows: COUNTIES } }, (choice) => {
      timeline.push({ kind: 'choose', id: choice.id });
      // A new Country draws the block again (Jobright 1.25.2's prefillCountryBeforeRules waits for its dependents): its
      // other boxes are emptied, ours included (synthetic: no capture shows it).
      if (choice.id === 'country-17') for (const id of BLOCK) (doc.getElementById(id) as HTMLInputElement).value = '';
    });
    const events = logEvents(doc);
    const worker = createFakeWorker({ settings: DEFAULT_SETTINGS, onMessage: (message) => {
      if (message.type !== 'plan/request') return;
      const { specs, planKeys } = message as unknown as { specs: FieldSpec[]; planKeys?: string[] };
      // A pass's plan sends the whole scan as its context; a search's match, its one field's results.
      if (specs.length < 2) return;
      timeline.push({ kind: 'plan', labels: specs.filter((spec) => planKeys === undefined
        || planKeys.includes(spec.key)).map((spec) => spec.label) });
    } });
    const runtime = await startContentRuntime(worker.platform, doc, { href: () => SECTION, isTop: true,
      adapters: () => [oracleAdapter], settle: { quietMs: 40 } });
    runtimes.push(runtime);
    await runtime.fill();
    await vi.waitFor(() => expect(runtime.run?.ended).toBeDefined(), { timeout: 80_000 });

    // Every list chosen, the street and the ZIP searched, County left: what the page shows at the end.
    const value = (id: string) => (doc.getElementById(id) as HTMLInputElement).value;
    expect(value('country-codes-dropdownphoneNumber')).toBe('United States (+1)');
    expect(value('country-17')).toBe('United States');
    expect(value('addressLine1-39')).toBe(streetSuggestions().austin);
    expect(value('postalCode-42')).toBe(goldenProfile().address!.postalCode);
    expect(value('city-43')).toBe('Austin');
    expect(value('region2-44')).toBe('Texas');
    expect(value('region1-45')).toBe('');
    const number = doc.querySelector<HTMLInputElement>('input.phone-row__input')!.value;
    expect(number).not.toMatch(/^\s*\+/);
    expect(number.replace(/\D/g, '')).toBe(nationalDigits());
    // The run's rows.
    const rows = new Map(worker.reports.at(-1)!.fields.map((row) => [row.label, row] as const));
    for (const label of ['Country code', 'Phone Number', 'Country', 'Address Line 1', 'ZIP Code', 'City', 'State']) {
      expect(rows.get(label), label).toMatchObject({ status: 'verified' });
    }
    expect(rows.get('County')).toMatchObject({ category: 'address.county', status: 'flagged',
      reason: 'no-profile-value' });

    // The order: the Country chosen once; the street typed again after it (the new Country emptied it) and the ZIP
    // after the street's last choice.
    const at = (id: string) => timeline.flatMap((entry, index) => (entry.kind === 'choose' && entry.id === id ? [index]
      : []));
    const [country, street, zip] = [at('country-17'), at('addressLine1-39'), at('postalCode-42')];
    expect(country.length).toBe(1);
    expect(street.at(-1)!).toBeGreaterThan(country[0]!);
    expect(zip.at(-1)!).toBeGreaterThan(street.at(-1)!);
    // Decided again after a parent's write (bookkeeping's 'parent-written'): Address Line 1 after the Country's; City
    // and State, whose answers the street's write left in place, after the street's last.
    const plannedAfter = (index: number) => timeline.slice(index + 1)
      .flatMap((entry) => (entry.kind === 'plan' ? entry.labels : []));
    expect(plannedAfter(country[0]!)).toContain('Address Line 1');
    expect(plannedAfter(street.at(-1)!)).toEqual(expect.arrayContaining(['City', 'State']));
    // City and State were chosen once each: decided again, they were not chosen again.
    expect(at('city-43').length).toBe(1);
    expect(at('region2-44').length).toBe(1);
    expectOurEventsOnly(events);
  }, 120_000);
});
