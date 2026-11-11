/*
 * jr6 ORACLE (FIXPLAN §6.11, APPLYPLAN E-Oracle): the Oracle adapter's jr6 hooks on the owner's snapshots
 * (fixtures/oracle/*: the Caesars posting and email gate converted for jr6 beside the earlier pages) and on synthetic
 * variants built inside each test (a page's markup changed in place, values the golden profile's or made up). It began
 * as the auditor's harness (SP\jr6\audit\oracle.md §3), whose readings are asserted here: the platform and adapters each
 * page gets, the hooks' answers, the pauses and Sign-in Auto's form, and the plan of the gate with the golden synthetic
 * profile (fixtures/profiles/alex-rivera.*) and DEFAULT_SETTINGS. Outcomes that need ENGINE's E1 to E3 or RULES' jr6
 * rules (a list read and chosen, a dependent re-planned, a ZIP's category) are P2's (SP\jr6\build\ORACLE.md).
 * Nothing here prints or keeps a value.
 */
import { afterEach, describe, expect, it } from 'vitest';
import caesarsPostingHtml from '../../../fixtures/oracle/jr6-caesars-posting.html?raw';
import caesarsGateHtml from '../../../fixtures/oracle/jr6-caesars-email-gate.html?raw';
import elhrGateHtml from '../../../fixtures/oracle/elhr-email-gate.html?raw';
import fortiveCodeHtml from '../../../fixtures/oracle/fortive-email-code.html?raw';
import hjfSectionHtml from '../../../fixtures/oracle/hjf-apply-section.html?raw';
import hjfAfterSubmitHtml from '../../../fixtures/oracle/hjf-after-submit.html?raw';
import jpmcPostingHtml from '../../../fixtures/oracle/jpmc-posting.html?raw';
import { goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import { pressEntry, stepButtonsOf } from '../../content/press';
import { planFrame } from '../../core/plan/frame';
import type { RepeatableRequest } from '../../core/steps/blocks';
import type { FieldSpec } from '../../core/types/field';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { assertNotSubmit } from '../../dom/fillers';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { detectPause } from '../../dom/pause-detect';
import { scan, toFieldSpec } from '../../dom/scan';
import { signInFormOf, signInRefusal } from '../../dom/sign-in-form';
import { listOf, widgetListOf } from '../../dom/widgets/aria';
import { platformOfUrl } from '../../shared/hosts';
import { adaptersFor } from '../index';
import { fillabilityOf, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import type { WidgetDecl } from '../types';
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

/** The frame's plan with the golden synthetic profile (the harness's plan), its repeatable sections requested. */
function planned(doc: Document) {
  const root = oracleAdapter.detect(doc)!.formRoot;
  const result = scan(root, oracleAdapter, { platform: 'oracle' });
  const specs: FieldSpec[] = result.fields.map(toFieldSpec);
  const kinds = (oracleAdapter.repeatables?.(root) ?? []).map((section) => section.kind);
  const shown = (kind: string) => oracleAdapter.prefill?.readEntries?.(kind,
    oracleAdapter.repeatables!(root).find((section) => section.kind === kind)!.blocks()) ?? [];
  const repeatables: RepeatableRequest[] = kinds.map((kind) => ({ kind, entries: null, shown: shown(kind) }));
  const plan = planFrame({ specs, canaries: [], profile: goldenProfile(), sensitiveState: 'loaded', savedAnswers: [],
    settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW,
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
      expect(decl.expanded, id).toBe(opener);
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
