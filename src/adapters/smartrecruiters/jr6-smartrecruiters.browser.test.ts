/*
 * jr6 (FIXPLAN §6.9, BUILD.md §4 C3): the SmartRecruiters adapter's jr6 hooks on the owner's pages, the auditor's
 * harness (SP\jr6\audit\smartrecruiters.md §3) turned into asserts. Pages: fixtures/smartrecruiters/xplor-posting,
 * bertelsmann-expired, xplor-one-click, xplor-screening (the snapshot build of 2026-11-06) and the jr6 cases
 * jr6-xplor-one-click-filled, jr6-wiser-one-click and jr6-wiser-screening (SR-8). Each finding's hooks are asserted on
 * them, and read again without the hook (its proof). The package's P2 (FIXPLAN §6.9 "P2 asserts", with ENGINE E1 to E3
 * and RULES R1 to R4 merged; SP\jr6\build\SMARTRECRUITERS.md) adds the fill outcomes at the end: the plan on each page
 * and each list's write through the pass, SmartRecruiters' components stood in for where a write needs the page to
 * answer. Profiles: the golden synthetic one, or variants of it built here; nothing here reads or prints a value of the
 * owner's.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import profileJson from '../../../fixtures/profiles/alex-rivera.profile.json';
import sensitiveJson from '../../../fixtures/profiles/alex-rivera.sensitive.json';
import bertelsmannHtml from '../../../fixtures/smartrecruiters/bertelsmann-expired.html?raw';
import wiserOneClickHtml from '../../../fixtures/smartrecruiters/jr6-wiser-one-click.html?raw';
import wiserScreeningHtml from '../../../fixtures/smartrecruiters/jr6-wiser-screening.html?raw';
import xplorFilledHtml from '../../../fixtures/smartrecruiters/jr6-xplor-one-click-filled.html?raw';
import xplorOneClickHtml from '../../../fixtures/smartrecruiters/xplor-one-click.html?raw';
import xplorPostingHtml from '../../../fixtures/smartrecruiters/xplor-posting.html?raw';
import xplorScreeningHtml from '../../../fixtures/smartrecruiters/xplor-screening.html?raw';
import type { AutofillProfile, AutofillSensitive } from '../../contract/tailorit';
import { createFakeWorker, fakePdf, GOLDEN_RESUME, goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import { lateAdapters, lateFormMs } from '../../content/late-form';
import { writeField, type PassEnv, type PlanAnswer, type WidgetWriteEnv } from '../../content/pass';
import { startContentRuntime, type ContentRuntime } from '../../content/runtime';
import { holdsNoAiAttestation } from '../../core/plan/attestation';
import { planFrame } from '../../core/plan/frame';
import { attachResume, canonicalizeProfile } from '../../core/profile/canonicalize';
import { classifyField } from '../../core/resolver/resolve';
import type { BaseKey } from '../../core/types/field';
import type { PlannedWrite } from '../../core/types/fill';
import type { Profile } from '../../core/types/profile';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { scan, toFieldSpec } from '../../dom/scan';
import { quietWait } from '../../dom/settle';
import type { WidgetReading } from '../../dom/types';
import { readWidget } from '../../dom/widgets/index';
import { platformOfUrl } from '../../shared/hosts';
import { genericAdapter } from '../generic';
import { adaptersFor } from '../index';
import { fillabilityOf, SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import type { Adapter, WidgetDecl } from '../types';
import { SMARTRECRUITERS_FORM_LATE_MS, SMARTRECRUITERS_SEARCH_EMPTY_MS, smartRecruitersAdapter } from './index';

const XPLOR = 'https://jobs.smartrecruiters.com/oneclick-ui/company/Xplor/publication/189a97ff-58b4-4671-bd81-6ed11d3bcfd1';
const WISER = 'https://jobs.smartrecruiters.com/oneclick-ui/company/WiserSolutions/publication/1477f9aa-cf19-47a8-93a4-7178574f6b11';
const XPLOR_POSTING = 'https://jobs.smartrecruiters.com/Xplor/744000159905715-senior-site-reliability-engineer';
/** A file name of the golden synthetic profile's kind; never the owner's. */
const RESUME_NAME = 'alex-rivera-resume.pdf';

/** The application pages: the blank first page, the two filled ones (jr6) and the blank screening step. */
const PAGES = {
  blank: { html: xplorOneClickHtml, address: `${XPLOR}?dcr_ci=Xplor` },
  xplorFilled: { html: xplorFilledHtml, address: `${XPLOR}?dcr_ci=Xplor` },
  wiser: { html: wiserOneClickHtml, address: `${WISER}?dcr_ci=WiserSolutions` },
  screening: { html: xplorScreeningHtml, address: `${XPLOR}/screening?dcr_ci=Xplor` },
} as const;

/** A page loaded at its own address (its base), its form root as the adapter detects it. */
async function load(page: keyof typeof PAGES) {
  const { html, address } = PAGES[page];
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const base = fixture.doc.createElement('base');
  base.href = address;
  fixture.doc.head.prepend(base);
  return { fixture, doc: fixture.doc, root: smartRecruitersAdapter.detect(fixture.doc)!.formRoot };
}

/** Every element under `scope` matching `selector`, open shadow roots included. */
function deepAll(scope: Document | Element | ShadowRoot, selector: string): Element[] {
  const found: Element[] = [];
  const visit = (at: Document | Element | ShadowRoot) => {
    for (const el of Array.from(at.querySelectorAll('*'))) {
      if (el.matches(selector)) found.push(el);
      if (el.shadowRoot !== null) visit(el.shadowRoot);
    }
  };
  visit(scope);
  return found;
}

/** The one element `selector` names, open shadow roots included. */
function deepOne<T extends Element = Element>(scope: Document | Element | ShadowRoot, selector: string): T {
  const found = deepAll(scope, selector);
  expect(found, selector).toHaveLength(1);
  return found[0] as T;
}

/** A drop zone's own file input (in its shadow root). */
const fileInputOf = (zone: Element): HTMLInputElement => zone.shadowRoot!.querySelector<HTMLInputElement>('input[type="file"]')!;

/** A file row as SmartRecruiters' drop zone draws one (jr6-wiser-one-click.html's li.c-spl-file-list-item), named
 *  `name`: a DOM variant made in the test. */
function addFileRow(zone: Element, name: string): void {
  const doc = zone.ownerDocument;
  const row = doc.createElement('li');
  row.className = 'c-spl-file-list-item';
  const label = doc.createElement('span');
  label.className = 'c-spl-file-list-item-name';
  label.textContent = name;
  row.append(label);
  let list = zone.shadowRoot!.querySelector('ul.c-spl-file-list');
  if (list === null) {
    list = doc.createElement('ul');
    list.className = 'c-spl-file-list';
    zone.shadowRoot!.append(list);
  }
  list.append(row);
}

beforeAll(() => {
  testVocab();
});

const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

/** The adapter without one of its members. */
const without = (member: keyof Adapter): Adapter => ({ ...smartRecruitersAdapter, [member]: undefined });

/** Waits until `ready` holds, at most `capMs`. */
async function until(view: Window & typeof globalThis, doc: Document, ready: () => boolean, capMs = 4_000): Promise<boolean> {
  const wait = quietWait<boolean>({ view, quietMs: 50, capMs, signal: undefined, aborted: false,
    atQuiet: () => (ready() ? true : null), atCap: () => ready() });
  wait.observe(doc.documentElement);
  return wait.done;
}

// ── C3 (APPLYPLAN, SP\jr6\audit\apply-c.md C3; BUILD.md §4): the one-click form drawn after the script starts ─────────

describe('C3: the one-click form is waited for when the page draws it late', () => {
  it('declares a 30 s wait, every SmartRecruiters address takes it, and only its own adapter may claim meanwhile', () => {
    expect(SMARTRECRUITERS_FORM_LATE_MS).toBe(30_000);
    expect(smartRecruitersAdapter.quirks).toEqual({ formLateMs: SMARTRECRUITERS_FORM_LATE_MS });
    for (const address of [`${XPLOR}?dcr_ci=Xplor`, `${XPLOR}/screening?dcr_ci=Xplor`, XPLOR_POSTING]) {
      const adapters = adaptersFor(new URL(address));
      expect(adapters.map((each) => each.id), address).toEqual(['smartrecruiters', 'generic']);
      expect(lateFormMs(adapters), address).toBe(30_000);
      // While the wait runs, the generic adapter (which takes any page with a visible control: the Easy Apply drop zone
      // is drawn first) never claims the page.
      expect(lateAdapters(adapters), address).toEqual([smartRecruitersAdapter]);
    }
    // Without the quirk nothing is waited for, and the generic adapter may claim at once.
    expect(lateFormMs([without('quirks'), genericAdapter])).toBe(0);
    expect(lateAdapters([without('quirks'), genericAdapter])).toHaveLength(2);
  });

  it("the content runtime finds Xplor's one-click form drawn after it started, and says hello with it", async () => {
    // xplor-one-click.html with its <oc-oneclick-form> taken out before the runtime starts and put back 600 ms later, as
    // SmartRecruiters' Angular app draws it once its data is fetched (the audit measured a form drawn 1 s late).
    const fixture = await loadFixture(document, xplorOneClickHtml, SNAPSHOT_VIEWPORT);
    const doc = fixture.doc;
    const form = doc.querySelector('oc-oneclick-form')!;
    const parent = form.parentElement!;
    const next = form.nextSibling;
    form.remove();
    const fake = createFakeWorker();
    const runtime = await startContentRuntime(fake.platform, doc, { href: () => `${XPLOR}?dcr_ci=Xplor`, isTop: true });
    runtimes.push(runtime);
    expect(runtime.page).toBeNull();
    expect(fake.of('frame/hello').map((hello) => hello.hasForm)).toEqual([false]);
    fixture.view.setTimeout(() => parent.insertBefore(form, next), 600);
    expect(await until(fixture.view, doc, () => runtime.page !== null, 8_000)).toBe(true);
    expect(runtime.page?.adapter).toBe(smartRecruitersAdapter);
    expect(runtime.page?.root).toBe(form);
    expect(await until(fixture.view, doc, () => fake.of('frame/hello').length === 2)).toBe(true);
    expect(fake.of('frame/hello').map((hello) => hello.hasForm)).toEqual([false, true]);
  });
});

// ── SR-11 (FIXPLAN §6.9 item 5): a file the drop zone shows ───────────────────────────────────────────────────────────

describe('SR-11: the résumé a drop zone shows is held, by its row', () => {
  it.each(['xplorFilled', 'wiser'] as const)('%s: the Resume shows one file; the field holds it', async (page) => {
    const { doc, root } = await load(page);
    const zone = deepOne(doc, 'spl-dropzone[data-test="resume-upload"]');
    const input = fileInputOf(zone);
    const rows = Array.from(zone.shadowRoot!.querySelectorAll('li.c-spl-file-list-item'));
    expect(rows).toHaveLength(1);
    const shown = rows[0]!.querySelector('.c-spl-file-list-item-name')!.textContent!.trim();
    expect(smartRecruitersAdapter.uploadHeld!(input)).toBe(true);
    expect(smartRecruitersAdapter.uploadHeldNames!(input)).toEqual([shown]);
    // Its input itself holds none (a capture keeps no file): the page's row decides.
    expect(input.files?.length ?? 0).toBe(0);
    const result = scan(root, smartRecruitersAdapter, { platform: 'smartrecruiters' });
    const resume = result.fields.find((field) => field.label === 'Resume')!;
    expect(resume.current).toEqual({ kind: 'files', count: 1, held: true, names: [shown] });
    // Read without the hook: empty, so the planner would upload again over the page's file.
    const plain = scan(root, without('uploadHeld'), { platform: 'smartrecruiters' });
    expect(plain.fields.find((field) => field.label === 'Resume')!.current.kind).toBe('empty');
  });

  it('a blank page shows none; neither does the Easy Apply drop zone, whose list is hidden', async () => {
    const { doc, root } = await load('blank');
    const zone = deepOne(doc, 'spl-dropzone[data-test="resume-upload"]');
    expect(smartRecruitersAdapter.uploadHeld!(fileInputOf(zone))).toBe(false);
    expect(smartRecruitersAdapter.uploadHeldNames!(fileInputOf(zone))).toEqual([]);
    const result = scan(root, smartRecruitersAdapter, { platform: 'smartrecruiters' });
    expect(result.fields.find((field) => field.label === 'Resume')!.current.kind).toBe('empty');
    // The Easy Apply drop zone (hidefilelist: it draws no list), even with a row drawn: no file here (it is excluded from
    // the fields).
    const easy = deepOne(doc, 'spl-dropzone[data-test="apply-with-resume-container"]');
    expect(easy.hasAttribute('hidefilelist')).toBe(true);
    addFileRow(easy, RESUME_NAME);
    expect(smartRecruitersAdapter.uploadHeld!(fileInputOf(easy))).toBe(false);
    expect(smartRecruitersAdapter.uploadState!(fileInputOf(easy), RESUME_NAME)).toBeNull();
  });

  it("a file the run put in is uploaded once a row names it; pending until then; null for any other input", async () => {
    const { doc } = await load('blank');
    const zone = deepOne(doc, 'spl-dropzone[data-test="resume-upload"]');
    const input = fileInputOf(zone);
    expect(smartRecruitersAdapter.uploadState!(input, RESUME_NAME)).toBe('pending');
    addFileRow(zone, 'another-file.pdf');
    expect(smartRecruitersAdapter.uploadState!(input, RESUME_NAME)).toBe('pending');
    addFileRow(zone, ` ${RESUME_NAME} `);
    expect(smartRecruitersAdapter.uploadState!(input, RESUME_NAME)).toBe('confirmed');
    expect(smartRecruitersAdapter.uploadState!(input, '')).toBe('pending');
    expect(smartRecruitersAdapter.uploadHeldNames!(input)).toEqual(['another-file.pdf', RESUME_NAME]);
    // A box that is no drop zone's file input: no reading of the adapter's.
    const firstName = deepOne<HTMLInputElement>(doc, 'spl-input#first-name-input').shadowRoot!.querySelector('input')!;
    expect(smartRecruitersAdapter.uploadState!(firstName, RESUME_NAME)).toBeNull();
    expect(smartRecruitersAdapter.uploadHeld!(firstName)).toBe(false);
  });

  it("the screening step's Additional attachments holds none", async () => {
    const { doc } = await load('screening');
    const zone = deepOne(doc, 'spl-dropzone[data-spl-field]');
    expect(smartRecruitersAdapter.uploadHeld!(fileInputOf(zone))).toBe(false);
    expect(smartRecruitersAdapter.uploadState!(fileInputOf(zone), RESUME_NAME)).toBe('pending');
  });
});

// ── SR-1, SR-2, SR-6 (FIXPLAN §6.9 items 1 to 3): SmartRecruiters' lists, declared ────────────────────────────────────
// ENGINE E1 reads and drives these declarations. The tests below pin the declarations themselves (the menu found across
// shadow roots, the rows, the element a choice clicks, the published list, the shortest query) and the scan's reading of
// them (P1); their fill outcomes are the P2 section's, at the end.

/** An spl-autocomplete's own text box: the autocomplete > (shadow) spl-input > (shadow) input[role=combobox]. */
function autocompleteBox(doc: Document, selector: string): HTMLInputElement {
  return deepOne(doc, selector).shadowRoot!.querySelector('spl-input')!.shadowRoot!
    .querySelector<HTMLInputElement>('input[role="combobox"]')!;
}

/** A screening question's text box: spl-autocomplete#question_<id>'s. */
const questionBox = (doc: Document, id: string): HTMLInputElement => autocompleteBox(doc, `spl-autocomplete#question_${id}`);

/** The phone's country select and its own button. */
function phoneSelect(doc: Document): { select: Element; button: HTMLElement } {
  const select = deepOne(doc, 'spl-select.c-spl-phone-field-select');
  return { select, button: select.shadowRoot!.querySelector<HTMLElement>('button[role="combobox"]')! };
}

/** The declaration widgetFor gives `control`, which must be one. */
function declared(control: Element): WidgetDecl {
  const decl = smartRecruitersAdapter.widgetFor!(control);
  expect(decl).not.toBeNull();
  return decl!;
}

/** The list a declaration's results name now. */
const listOfDecl = (decl: WidgetDecl): Element | null =>
  (typeof decl.results!.list === 'function' ? decl.results!.list() : decl.results!.list);

/** The inner item SmartRecruiters' row draws: spl-select-option > (shadow) spl-dropdown-item > (shadow)
 *  div.c-spl-dropdown-item[role=option]. */
const innerItem = (row: Element): Element | null =>
  row.shadowRoot?.querySelector('spl-dropdown-item')?.shadowRoot?.querySelector('.c-spl-dropdown-item') ?? null;

/** A row as SmartRecruiters draws one in a menu (xplor-one-click.html's phone rows' shape), labelled `label`: a DOM
 *  variant made in the test, for a menu no capture shows open. */
function makeRow(doc: Document, value: string, label: string): Element {
  const row = doc.createElement('spl-select-option');
  row.setAttribute('value', value);
  row.textContent = label;
  const item = doc.createElement('spl-dropdown-item');
  item.append(doc.createElement('slot'));
  row.attachShadow({ mode: 'open' }).append(item);
  const inner = doc.createElement('div');
  inner.className = ' c-spl-dropdown-item ';
  inner.setAttribute('role', 'option');
  inner.append(doc.createElement('slot'));
  item.attachShadow({ mode: 'open' }).append(inner);
  return row;
}

/** The screening questions the page publishes, by id (sr-screening-questions-form's definition, read here on its own). */
function definition(doc: Document): Map<string, string[]> {
  const form = deepOne(doc, 'sr-screening-questions-form[definition]');
  const parsed = JSON.parse(form.getAttribute('definition')!) as { questions: Array<{ id: string;
    fields: Array<{ values: Array<{ label: string }> }> }> };
  return new Map(parsed.questions.map((question) => [question.id,
    question.fields.flatMap((field) => field.values.map((value) => value.label))]));
}

const QUESTIONS = {
  heard: 'a0151063-d62b-49e7-9c6f-d17e59b99090',
  rightToWork: '562715e2-4960-44f3-9e8d-2750ae765f9a',
  employee: '9320d6d5-0b22-4e3f-b913-e7076e5e8083',
  ethnicity: '5d965982-4693-4ca6-91ff-9dde3767755c',
  gender: 'd9203a60-8103-4251-8402-eb366923db58',
} as const;

describe('SR-1: the screening dropdowns, each a combobox whose whole list the page publishes', () => {
  it("declares each on its text box, with its own question's published options, in the page's order", async () => {
    const { doc } = await load('screening');
    const published = definition(doc);
    const counts: number[] = [];
    for (const id of Object.values(QUESTIONS)) {
      const box = questionBox(doc, id);
      const decl = declared(box);
      expect(decl).toMatchObject({ kind: 'combobox', opener: box, expanded: box,
        snapshot: 'fixtures/smartrecruiters/xplor-screening.html' });
      expect(decl.knownOptions).toEqual(published.get(id));
      // minquerylength="0": no shortest query; no row stands for anything but an answer.
      expect(decl.minQueryLength).toBeUndefined();
      expect(decl.results).toMatchObject({ option: 'spl-select-option' });
      expect(decl.results!.unchoosable).toBeUndefined();
      counts.push(decl.knownOptions!.length);
    }
    expect(counts).toEqual([14, 5, 2, 8, 4]);
    expect(declared(questionBox(doc, QUESTIONS.employee)).knownOptions).toEqual(['Yes', 'No']);
    expect(declared(questionBox(doc, QUESTIONS.gender)).knownOptions)
      .toEqual(['Female/Woman', 'Male/Man', 'Non-Binary/Gender-diverse', 'Prefer not to say']);
    expect(declared(questionBox(doc, QUESTIONS.heard)).knownOptions!.slice(0, 4))
      .toEqual(['Your careers page', 'I was referred by someone who works at Xplor', 'Indeed', 'LinkedIn']);
  });

  it("finds its menu across the shadow roots its box's aria-controls crosses, and clicks a row's inner item", async () => {
    const { doc } = await load('screening');
    const box = questionBox(doc, QUESTIONS.heard);
    const menu = deepOne(doc, `spl-autocomplete#question_${QUESTIONS.heard}`).shadowRoot!
      .querySelector(`[slot="menu"]#menu-question_${QUESTIONS.heard}`)!;
    expect(box.getAttribute('aria-controls')).toBe(`menu-question_${QUESTIONS.heard}`);
    // The box's own tree does not hold it: its menu is in the autocomplete's shadow root, one host up.
    expect((box.getRootNode() as ShadowRoot).getElementById(`menu-question_${QUESTIONS.heard}`)).toBeNull();
    const decl = declared(box);
    expect(listOfDecl(decl)).toBe(menu);
    expect(menu.getAttribute('role')).toBe('listbox');
    // Rows drawn into it (none in the capture: the menu is empty until opened) are its options; a choice clicks each
    // row's inner .c-spl-dropdown-item.
    const rows = ['Indeed', 'LinkedIn'].map((label, at) => makeRow(doc, `v${at}`, label));
    menu.append(...rows);
    expect(Array.from(menu.querySelectorAll(decl.results!.option))).toEqual(rows);
    for (const row of rows) {
      const target = decl.results!.pressTarget!(row);
      expect(target).toBe(innerItem(row));
      expect(target?.getAttribute('role')).toBe('option');
    }
    expect(decl.results!.pressTarget!(doc.createElement('spl-select-option'))).toBeNull();
    // A box whose aria-controls names nothing, or no listbox: no list.
    box.setAttribute('aria-controls', 'menu-none');
    expect(listOfDecl(decl)).toBeNull();
    box.setAttribute('aria-controls', `question_${QUESTIONS.heard}`);
    expect(listOfDecl(decl)).toBeNull();
  });

  it('declares nothing where the page publishes no list, or one that takes several answers', async () => {
    const { doc } = await load('screening');
    const form = deepOne(doc, 'sr-screening-questions-form[definition]');
    const original = form.getAttribute('definition')!;
    // A question that takes several answers (multipleChoice): not declared (no capture shows one).
    const parsed = JSON.parse(original) as { questions: Array<{ id: string; fields: Array<{ multipleChoice: boolean }> }> };
    parsed.questions.find((question) => question.id === QUESTIONS.gender)!.fields[0]!.multipleChoice = true;
    form.setAttribute('definition', JSON.stringify(parsed));
    expect(smartRecruitersAdapter.widgetFor!(questionBox(doc, QUESTIONS.gender))).toBeNull();
    expect(declared(questionBox(doc, QUESTIONS.employee)).knownOptions).toEqual(['Yes', 'No']);
    // A question the definition does not hold, a definition that is no JSON, none at all.
    form.setAttribute('definition', original);
    const box = questionBox(doc, QUESTIONS.employee);
    deepOne(doc, `spl-autocomplete#question_${QUESTIONS.employee}`).id = 'question_00000000-0000-4000-8000-000000000000';
    expect(smartRecruitersAdapter.widgetFor!(box)).toBeNull();
    form.setAttribute('definition', '{not json');
    expect(smartRecruitersAdapter.widgetFor!(questionBox(doc, QUESTIONS.heard))).toBeNull();
    form.removeAttribute('definition');
    expect(smartRecruitersAdapter.widgetFor!(questionBox(doc, QUESTIONS.heard))).toBeNull();
  });

  it('the scan reads the five as declared comboboxes the widget helpers act on; undeclared without widgetFor', async () => {
    const { root } = await load('screening');
    const result = scan(root, smartRecruitersAdapter, { platform: 'smartrecruiters' });
    const lists = result.fields.filter((field) => field.kind === 'combobox');
    expect(lists.map((field) => field.label)).toEqual(['How did you first hear about this opportunity?',
      'Which of the following statements best describes your right to work in the United States?',
      'Are you a current or former employee or contractor of Xplor Technologies, Clubessential Holdings, Ezypay, or any affiliated brand?',
      'What best describes your ethnicity or race?', 'What best describes your gender?']);
    for (const field of lists) {
      const widget = result.target(field.key)!.widget!;
      expect(widget.declared, field.label).toBe(true);
      expect(fillabilityOf(field, widget), field.label).toEqual({ fillable: true });
    }
    const plain = scan(root, without('widgetFor'), { platform: 'smartrecruiters' });
    const undeclared = plain.fields.filter((each) => each.kind === 'combobox');
    expect(undeclared).toHaveLength(5);
    for (const field of undeclared) {
      expect(plain.target(field.key)!.widget!.declared, field.label).toBe(false);
      expect(fillabilityOf(field, plain.target(field.key)!.widget), field.label)
        .toEqual({ fillable: false, reason: 'widget-phase-4' });
    }
  });
});

describe("SR-2: the City search (and the manual location mode's Country/Region)", () => {
  const CITY = 'spl-autocomplete[data-sr-id="location-autocomplete-search"]';

  it('declares the City a remote search: its menu, never shorter than its minquerylength, its manual row never chosen', async () => {
    const { doc } = await load('blank');
    const box = autocompleteBox(doc, CITY);
    const decl = declared(box);
    expect(deepOne(doc, CITY).getAttribute('minquerylength')).toBe('3');
    expect(decl).toMatchObject({ kind: 'typeahead-remote', opener: box, minQueryLength: 3,
      emptyAfterMs: SMARTRECRUITERS_SEARCH_EMPTY_MS, snapshot: 'fixtures/smartrecruiters/xplor-one-click.html' });
    // FIXPLAN §6.9 item 2: no expanded, no published list.
    expect(decl.expanded).toBeUndefined();
    expect(decl.knownOptions).toBeUndefined();
    expect(decl.results).toMatchObject({ option: 'spl-select-option',
      unchoosable: 'spl-select-option[value="goToManualLocationMode"]' });
    expect(listOfDecl(decl)).toBe(deepOne(doc, CITY).shadowRoot!.querySelector('[slot="menu"]#menu-spl-form-element_10'));
  });

  it("on Wiser's page, its results drawn open: two rows, the manual one unchoosable, each chosen on its inner item", async () => {
    const { doc } = await load('wiser');
    const decl = declared(autocompleteBox(doc, CITY));
    const menu = listOfDecl(decl)!;
    expect(menu.getAttribute('data-sr-id')).toBe('location-autocomplete-search-menu');
    const rows = Array.from(menu.querySelectorAll(decl.results!.option));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.matches(decl.results!.unchoosable!))).toEqual([false, true]);
    for (const row of rows) {
      const target = decl.results!.pressTarget!(row);
      expect(target).not.toBeNull();
      expect(target).toBe(innerItem(row));
      expect(target!.getAttribute('role')).toBe('option');
    }
  });

  it("declares the manual mode's Country/Region a combobox read by opening it; its plain City box is no widget", async () => {
    const { doc } = await load('xplorFilled');
    const host = deepOne(doc, 'spl-autocomplete[data-sr-id="location-autocomplete-country"]');
    expect(host.getAttribute('label')).toBe('Country/Region');
    const box = autocompleteBox(doc, 'spl-autocomplete[data-sr-id="location-autocomplete-country"]');
    const decl = declared(box);
    expect(decl).toMatchObject({ kind: 'combobox', opener: box, expanded: box,
      snapshot: 'fixtures/smartrecruiters/jr6-xplor-one-click-filled.html' });
    expect(decl.minQueryLength).toBeUndefined();
    expect(decl.knownOptions).toBeUndefined();
    expect(decl.results!.unchoosable).toBeUndefined();
    expect(listOfDecl(decl)).toBe(host.shadowRoot!.querySelector('[slot="menu"]#menu-spl-form-element_15'));
    const city = deepOne(doc, 'spl-input[data-sr-id="location-autocomplete-city"]').shadowRoot!.querySelector('input')!;
    expect(smartRecruitersAdapter.widgetFor!(city)).toBeNull();
    // Another spl-autocomplete no capture shows (an entry editor's search): not declared.
    host.setAttribute('data-sr-id', 'education-institution');
    expect(smartRecruitersAdapter.widgetFor!(box)).toBeNull();
  });

  it('the scan reads the City as a declared search the helpers act on; an undeclared combobox without widgetFor', async () => {
    for (const page of ['blank', 'wiser'] as const) {
      const { root } = await load(page);
      const result = scan(root, smartRecruitersAdapter, { platform: 'smartrecruiters' });
      const city = result.fields.find((field) => field.label === 'City')!;
      expect(city.kind, page).toBe('typeahead-remote');
      expect(city.required, page).toBe(true);
      expect(result.target(city.key)!.widget!.declared, page).toBe(true);
      expect(fillabilityOf(city, result.target(city.key)!.widget), page).toEqual({ fillable: true });
      const plain = scan(root, without('widgetFor'), { platform: 'smartrecruiters' });
      const undeclared = plain.fields.find((field) => field.label === 'City')!;
      expect([undeclared.kind, fillabilityOf(undeclared, plain.target(undeclared.key)!.widget)], page)
        .toEqual(['combobox', { fillable: false, reason: 'widget-phase-4' }]);
      removeFixtures(document);
    }
    const { root } = await load('xplorFilled');
    const result = scan(root, smartRecruitersAdapter, { platform: 'smartrecruiters' });
    const country = result.fields.find((field) => field.label === 'Country/Region')!;
    expect([country.kind, country.required, result.target(country.key)!.widget!.declared]).toEqual(['combobox', true, true]);
    expect(result.fields.find((field) => field.label === 'City')!.kind).toBe('text');
  });
});

describe("SR-6: the phone's country, a combobox on its button", () => {
  it('declares it: its menu, its 245 rows slotted from the select, drawn whole, chosen on their inner item', async () => {
    const { doc } = await load('blank');
    const { select, button } = phoneSelect(doc);
    const decl = declared(button);
    expect(decl).toMatchObject({ kind: 'combobox', opener: button, expanded: button, drawnWhole: true,
      snapshot: 'fixtures/smartrecruiters/xplor-one-click.html' });
    const menu = listOfDecl(decl)!;
    expect(menu).toBe(select.shadowRoot!.querySelector('[slot="menu"]#spl-form-element_12-menu'));
    // The selector reaches none of them (they are the select's own children, slotted into the menu): the hook does.
    expect(menu.querySelectorAll(decl.results!.option)).toHaveLength(0);
    const rows = decl.results!.options!(menu);
    expect(rows).toHaveLength(245);
    expect(rows).toEqual(Array.from(select.querySelectorAll(':scope > spl-select-option')));
    const us = rows.find((row) => row.getAttribute('value') === 'US')!;
    expect(decl.results!.pressTarget!(us)).toBe(innerItem(us));
    expect(innerItem(us)!.getAttribute('role')).toBe('option');
    // Its search box (spl-dropdown-search's "Search by country/region or code") is no widget of its own.
    const search = deepOne(doc, 'spl-dropdown-search').shadowRoot!.querySelector('input[role="combobox"]')!;
    expect(smartRecruitersAdapter.widgetFor!(search)).toBeNull();
  });

  it("shows the row whose value is the select's own: its words, as the read list writes them", async () => {
    const { doc } = await load('blank');
    const { select, button } = phoneSelect(doc);
    const decl = declared(button);
    // The capture's value is cleared by the converter: nothing shown chosen.
    expect(select.getAttribute('value')).toBe('');
    expect(decl.shownAnswer!([])).toBeNull();
    select.setAttribute('value', 'US');
    expect(decl.shownAnswer!([])).toBe('United States +1');
    expect(decl.shownAnswer!(['Canada +1', 'United States +1'])).toBe('United States +1');
    expect(decl.shownAnswer!(['Canada  +1', 'United States+1'])).toBe('United States+1');
    select.setAttribute('value', 'CA');
    expect(decl.shownAnswer!([])).toBe('Canada +1');
    select.setAttribute('value', 'ZZ');
    expect(decl.shownAnswer!([])).toBeNull();
  });

  it.each(['blank', 'wiser'] as const)("%s: labelled by the phone's own label with \"country code\" after it", async (page) => {
    const { doc, root } = await load(page);
    const { button } = phoneSelect(doc);
    const phoneLabel = deepOne(doc, 'spl-phone-field').shadowRoot!.querySelector('label[slot="label"]');
    expect(smartRecruitersAdapter.labelFor!(button)).toBe(phoneLabel);
    expect(smartRecruitersAdapter.labelSuffix!(button)).toBe('country code');
    const number = deepOne(doc, 'spl-input.c-spl-phone-field-input').shadowRoot!.querySelector('input')!;
    expect(smartRecruitersAdapter.labelSuffix!(number)).toBeNull();
    const result = scan(root, smartRecruitersAdapter, { platform: 'smartrecruiters' });
    const field = result.fields.find((each) => result.target(each.key)?.control === button)!;
    expect([field.label, field.labelVisible, field.kind, field.required]).toEqual(['Phone number country code', true,
      'combobox', false]);
    expect(fillabilityOf(field, result.target(field.key)!.widget)).toEqual({ fillable: true });
    // Without labelFor: its aria-label alone, unseen; without labelSuffix: the phone's own words, as its number's.
    const unlabelled = scan(root, without('labelFor'), { platform: 'smartrecruiters' });
    const bare = unlabelled.fields.find((each) => unlabelled.target(each.key)?.control === button)!;
    expect(fillabilityOf(bare, unlabelled.target(bare.key)!.widget)).toEqual({ fillable: false, reason: 'no-visible-label' });
    const unsuffixed = scan(root, without('labelSuffix'), { platform: 'smartrecruiters' });
    expect(unsuffixed.fields.find((each) => unsuffixed.target(each.key)?.control === button)!.label).toBe('Phone number');
  });
});

// ── The auditor's harness (SP\jr6\audit\smartrecruiters.md §3), as asserts ────────────────────────────────────────────
// Its pass 1 on every page: our real adapter detection, the step hooks, the scan and the planner with the golden
// synthetic profile and DEFAULT_SETTINGS. The rows that waited on ENGINE E1 to E3 or on RULES' new rules (the
// screening's dropdowns and Yes/No questions, the phone's country, Country/Region, Facebook, "Additional attachments",
// the sponsorship question) are asserted in the P2 section below.

const ALL_PAGES = {
  posting: { html: xplorPostingHtml, address: XPLOR_POSTING },
  expired: { html: bertelsmannHtml,
    address: 'https://jobs.smartrecruiters.com/Bertelsmann-Jobs/744000159908317--senior-infrastructure-engineer-ai-ml' },
  ...PAGES,
  wiserScreening: { html: wiserScreeningHtml, address: `${WISER}/screening?dcr_ci=WiserSolutions` },
} as const;

/** A page of ALL_PAGES, loaded at its address. */
async function loadAny(page: keyof typeof ALL_PAGES) {
  const { html, address } = ALL_PAGES[page];
  const fixture = await loadFixture(document, html, SNAPSHOT_VIEWPORT);
  const base = fixture.doc.createElement('base');
  base.href = address;
  fixture.doc.head.prepend(base);
  return fixture.doc;
}

/** The planner's pass 1 on a page's scan, with the golden synthetic profile. */
function planOf(root: Element, company: string) {
  const specs = scan(root, smartRecruitersAdapter, { platform: 'smartrecruiters' }).fields.map(toFieldSpec);
  const out = planFrame({ specs, canaries: [], profile: goldenProfile(), sensitiveState: 'loaded', savedAnswers: [],
    settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW,
    posting: { company, location: 'Austin, TX, USA' } });
  const row = (label: string) => {
    const found = out.results.find((each) => each.label === label);
    expect(found, label).toBeDefined();
    const write = out.writes.find((each) => each.key === found!.key);
    return { status: found!.status, reason: found!.reason, category: found!.category, write: write?.value.kind ?? null };
  };
  return { out, row };
}

describe("the auditor's harness, as asserts: every SmartRecruiters page", () => {
  it.each(Object.keys(ALL_PAGES) as Array<keyof typeof ALL_PAGES>)('%s: our adapter, its root and its steps', async (page) => {
    const doc = await loadAny(page);
    const url = new URL(ALL_PAGES[page].address);
    expect(platformOfUrl(url.href)).toBe('smartrecruiters');
    expect(adaptersFor(url).map((each) => each.id)).toEqual(['smartrecruiters', 'generic']);
    const root = smartRecruitersAdapter.detect(doc)?.formRoot ?? null;
    const wanted = { posting: null, expired: null, blank: 'oc-oneclick-form', xplorFilled: 'oc-oneclick-form',
      wiser: 'oc-oneclick-form', screening: 'oc-screening-questions', wiserScreening: 'oc-screening-questions' }[page];
    expect(root?.localName ?? null).toBe(wanted);
    if (root === null) {
      // The postings: their text, and "I'm interested" on the live one only.
      expect(smartRecruitersAdapter.postingText!(doc)).not.toBeNull();
      expect(smartRecruitersAdapter.entryControl!(doc)?.getAttribute('data-sr-track-position') ?? null)
        .toBe(page === 'posting' ? 'bottom' : null);
      return;
    }
    const first = root.localName === 'oc-oneclick-form';
    expect(smartRecruitersAdapter.isFinalStep!(doc)).toBe(first ? 'not-final' : 'final');
    expect(smartRecruitersAdapter.nextButton!(root) !== null).toBe(first);
    expect(smartRecruitersAdapter.submitButton!(root) !== null).toBe(!first);
    expect(smartRecruitersAdapter.stepSignature!(doc)).toEqual(first ? { urlPart: 'first', anchors: ['oc-oneclick-form'] }
      : { urlPart: 'screening', anchors: ['oc-screening-questions'] });
    // Excluded: the Easy Apply block on a first page; drop zones: the Easy Apply's and the Resume's, or the screening's.
    expect(smartRecruitersAdapter.excluded!(root)).toHaveLength(first ? 1 : 0);
    expect(smartRecruitersAdapter.uploadWidgets!(root)).toHaveLength(first ? 2 : page === 'screening' ? 1 : 0);
    expect(smartRecruitersAdapter.errors!(root)).toEqual([]);
    // Not built this round (SR-5, SR-16: no capture of an entry editor, no live evidence): none declared.
    expect([smartRecruitersAdapter.repeatables, smartRecruitersAdapter.sections, smartRecruitersAdapter.isBusy])
      .toEqual([undefined, undefined, undefined]);
  });

  it.each([['blank', 'Xplor'], ['xplorFilled', 'Xplor'], ['wiser', 'Wiser Solutions']] as const)(
    '%s: the first page plans its boxes from the golden profile, the City as a query, a résumé shown kept', async (page, company) => {
      const { root } = await load(page);
      const { row } = planOf(root, company);
      for (const label of ['First name', 'Last name', 'Email', 'Confirm your email', 'Phone number', 'LinkedIn']) {
        expect(row(label), `${page} ${label}`).toMatchObject({ status: 'verified', reason: 'ok', write: 'text' });
      }
      if (page === 'xplorFilled') {
        // The manual location mode: its City is a plain box.
        expect(row('City')).toMatchObject({ status: 'verified', reason: 'ok', category: 'address.city', write: 'text' });
      } else {
        // SR-2: the declared search is planned on pass 1, a query (it waited for options before).
        expect(row('City')).toMatchObject({ status: 'verified', reason: 'ok', category: 'address.city', write: 'query' });
      }
      // SR-11: a résumé the drop zone shows is kept under the default "Résumé already on the page: keep"; a blank page
      // gets the profile's.
      expect(row('Resume')).toMatchObject(page === 'blank' ? { status: 'verified', reason: 'ok', write: 'file' }
        : { status: 'flagged', reason: 'prefill-kept', write: null });
    });
});

// ── P2 (FIXPLAN §6.9 "P2 asserts"): the fill outcomes, with ENGINE E1 to E3 and RULES R1 to R4 merged ─────────────────
// Each page is the owner's capture as converted, planned with the golden synthetic profile (or a variant of it built
// here) and DEFAULT_SETTINGS, as the auditor's harness planned it (SP\jr6\audit\smartrecruiters.md §3). A capture keeps
// none of SmartRecruiters' scripts, so where a write needs the page to answer (a list opened, its rows drawn, a row
// chosen, a file listed), the test stands in for the component: DOM variants made here, after the P1 trial
// (SP\jr6\sr-p1\e1-trial-simulation.ts.txt). They follow the audit's reading of the components; the live checks of
// FIXPLAN §6.9 are still open (SP\jr6\build\SMARTRECRUITERS.md).

/** The screening step's questions (xplor-screening.html, in its own words). */
const SCREENING = {
  heard: 'How did you first hear about this opportunity?',
  salary: 'What is your expected annual base salary?',
  rightToWork: 'Which of the following statements best describes your right to work in the United States?',
  applied: 'Have you applied to or been referred to Xplor for another role in the past 12 months?',
  employee: 'Are you a current or former employee or contractor of Xplor Technologies, Clubessential Holdings, Ezypay, or '
    + 'any affiliated brand?',
  ethnicity: 'What best describes your ethnicity or race?',
  gender: 'What best describes your gender?',
  attachments: 'Additional attachments',
} as const;

/** The golden synthetic profile with a work status for its United States entry (the golden one gives none). */
function withWorkStatus(status: 'citizen' | 'permanent-resident'): Profile {
  const sensitive = sensitiveJson as unknown as AutofillSensitive;
  const entry = { ...sensitive.workAuthorization[0]!, status: { state: 'value', value: status } };
  return attachResume(canonicalizeProfile(profileJson as unknown as AutofillProfile,
    { ...sensitive, workAuthorization: [entry] } as unknown as AutofillSensitive, testVocab(), NOW).profile,
  GOLDEN_RESUME, 48_213);
}

/** A page's scan (with the run's widget readings, if any) and the planner's pass over it, as the worker plans it; `of`
 *  gives the field labelled `label` (with `prefix`, whose label starts so), its row and its write. */
function plannedOn(root: Element, company: string,
  options: { profile?: Profile; readings?: Map<BaseKey, WidgetReading>; adapter?: Adapter } = {}) {
  const result = scan(root, options.adapter ?? smartRecruitersAdapter, { platform: 'smartrecruiters',
    ...(options.readings === undefined ? {} : { widgetReadings: options.readings }) });
  const specs = result.fields.map(toFieldSpec);
  const out = planFrame({ specs, canaries: [], profile: options.profile ?? goldenProfile(), sensitiveState: 'loaded',
    savedAnswers: [], settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW,
    posting: { company, location: 'Austin, TX, USA' } });
  const of = (label: string, prefix = false) => {
    const field = result.fields.find((each) => (prefix ? each.label.startsWith(label) : each.label === label));
    expect(field, label).toBeDefined();
    return { field: field!, row: out.results.find((each) => each.key === field!.key)!,
      write: out.writes.find((each) => each.key === field!.key) ?? null };
  };
  /** The label of a planned key. */
  const labelOf = (key: string) => result.fields.find((field) => field.key === key)?.label ?? '';
  return { result, specs, out, of, labelOf };
}
type Planned = ReturnType<typeof plannedOn>;

/** A row and its write as the asserts read them: the category, the status and why, the value (an option's words, a
 *  text, a query's words, or the write's kind) and where it came from. */
function outcome({ row, write }: ReturnType<Planned['of']>) {
  const value = write === null ? null : write.value.kind === 'option' ? write.value.cleanLabel
    : write.value.kind === 'text' ? write.value.text : write.value.kind === 'query' ? write.value.queries : write.value.kind;
  const origin = write === null ? null : write.origin.provenance === 'rule' ? `rule ${write.origin.ruleId}`
    : write.origin.provenance === 'profile'
      ? `profile ${write.origin.path}${write.origin.transform === undefined ? '' : ` ${write.origin.transform}`}`
      : write.origin.provenance;
  return { category: row.category, status: row.status, reason: row.reason, value, origin };
}

/** The pass's environment for one write (content/pass.ts writeField), as a run gives it: nothing holds the page;
 *  `content` serves the résumé (the fake worker's port). */
function passEnv(root: Element, content?: PassEnv['content'], adapter: Adapter = smartRecruitersAdapter): PassEnv {
  return { adapter, root, platform: 'smartrecruiters', frameId: 0, dryRun: false, canaries: [],
    ...(content === undefined ? {} : { content }), signal: new AbortController().signal, valid: () => true,
    stopped: () => false, runId: () => 'run', heldBy: () => null } as unknown as PassEnv;
}

/** What the worker's match was asked: each result's words, and whether it could be chosen. */
type Asked = Array<Array<[string, boolean]>>;

/** A widget's write as a run makes it: the run's readings, and the worker's plan/request for a search's results (the
 *  planner with the golden profile, which matches them); `asked` records the results each match was given. */
function widgetsOf(readings: Map<BaseKey, WidgetReading>, company: string, asked: Asked = []): WidgetWriteEnv {
  return { readings, plan: async (specs, planKeys) => {
    for (const spec of specs) {
      asked.push(spec.options === 'lazy' ? [] : spec.options.map((option) => [option.label, option.disabled]));
    }
    return planFrame({ specs, planKeys, canaries: [], profile: goldenProfile(), sensitiveState: 'loaded', savedAnswers: [],
      settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW,
      posting: { company, location: 'Austin, TX, USA' } }) as unknown as PlanAnswer;
  } };
}

/** The planner's write of a field made through the pass (the DOM guard, the widget helpers, the read-back), or
 *  `write` in its place; `asked` records what a search's match was given. */
async function writeThrough(root: Element, planned: Planned, label: string, company: string,
  options: { readings?: Map<BaseKey, WidgetReading>; write?: PlannedWrite; asked?: Asked } = {}) {
  const { field, row, write: own } = planned.of(label);
  const write = options.write ?? own;
  expect(write, label).not.toBeNull();
  return writeField(passEnv(root), planned.result, field, write!, row, new WeakMap(),
    { widgets: widgetsOf(options.readings ?? new Map(), company, options.asked) });
}

/** Every element a click landed on in the page (its composed path's first: inside the shadow roots), in order. */
function clicksIn(doc: Document): Element[] {
  const landed: Element[] = [];
  doc.addEventListener('click', (event) => landed.push(event.composedPath()[0] as Element), true);
  return landed;
}

/** The row (spl-select-option) whose inner item `inner` is: two shadow roots up. */
function rowOfInner(inner: Element): Element | null {
  const item = (inner.getRootNode() as Partial<ShadowRoot>).host;
  return (item?.getRootNode() as Partial<ShadowRoot> | undefined)?.host ?? null;
}

/** The manual location mode's row, in SmartRecruiters' own words (jr6-wiser-one-click.html's open City results). */
const MANUAL_ROW_WORDS = 'Cannot find your city? Click here to fill in manually';

/** What a stood-in component saw and did: the box's text at each input event, and the words of each row chosen. */
interface StoodIn {
  typed: string[];
  chosen: string[];
}

/**
 * SmartRecruiters' spl-autocomplete as the live page drives it (a DOM variant made in the test): a click on its text box
 * opens its list (the box's aria-expanded "true", its spl-dropdown's .c-spl-dropdown-menu aria-hidden "false", by which
 * E1 reads the menu as shown: P1's trial) with `rows('')` drawn into its menu; for a search (`search`), each input event
 * empties and shuts the menu and, once the query is `minQuery` characters long, draws its rows and the manual mode's row
 * `delayMs` later (rows drawn into the autocomplete's shadow root after the event: E1's watchList). Leaving the box
 * shuts the list. A click on a row's inner .c-spl-dropdown-item chooses it: the box shows its words, the list shuts,
 * emptied.
 */
function standInAutocomplete(host: Element, rows: (query: string) => readonly string[],
  search?: { minQuery: number; delayMs: number }): StoodIn {
  const doc = host.ownerDocument;
  const view = doc.defaultView!;
  const box = host.shadowRoot!.querySelector('spl-input')!.shadowRoot!.querySelector<HTMLInputElement>('input[role="combobox"]')!;
  const menu = host.shadowRoot!.querySelector('[slot="menu"]')!;
  const panel = host.shadowRoot!.querySelector('spl-dropdown')!.shadowRoot!.querySelector('.c-spl-dropdown-menu')!;
  const log: StoodIn = { typed: [], chosen: [] };
  const show = (open: boolean) => {
    box.setAttribute('aria-expanded', String(open));
    panel.setAttribute('aria-hidden', String(!open));
  };
  const rowOf = (value: string, label: string) => {
    const row = makeRow(doc, value, label);
    innerItem(row)!.addEventListener('click', () => {
      log.chosen.push(label);
      box.value = label;
      show(false);
      menu.replaceChildren();
    });
    return row;
  };
  const draw = (query: string) => {
    menu.replaceChildren(...rows(query).map((label, at) => rowOf(`row-${at}`, label)),
      ...(search === undefined ? [] : [rowOf('goToManualLocationMode', MANUAL_ROW_WORDS)]));
    show(true);
  };
  box.addEventListener('focusout', () => show(false));
  if (search === undefined) {
    box.addEventListener('click', () => draw(''));
    return log;
  }
  box.addEventListener('input', () => {
    const query = box.value;
    log.typed.push(query);
    menu.replaceChildren();
    show(false);
    if (query.length < search.minQuery) return;
    view.setTimeout(() => {
      if (box.value === query) draw(query);
    }, search.delayMs);
  });
  return log;
}

/** SmartRecruiters' phone country spl-select as the live page drives it (a DOM variant made in the test): its button
 *  opens and shuts its list (the button's aria-expanded, its spl-dropdown's menu aria-hidden); a click on a row's inner
 *  item sets the select's value to the row's and shuts it. Its 245 rows are the capture's own. `chosen` holds the
 *  values (country codes) chosen. */
function standInPhoneSelect(doc: Document): { select: Element; chosen: string[] } {
  const { select, button } = phoneSelect(doc);
  const panel = select.shadowRoot!.querySelector('spl-dropdown')!.shadowRoot!.querySelector('.c-spl-dropdown-menu')!;
  const chosen: string[] = [];
  const show = (open: boolean) => {
    button.setAttribute('aria-expanded', String(open));
    panel.setAttribute('aria-hidden', String(!open));
  };
  button.addEventListener('click', () => show(button.getAttribute('aria-expanded') !== 'true'));
  for (const row of Array.from(select.querySelectorAll(':scope > spl-select-option'))) {
    innerItem(row)!.addEventListener('click', () => {
      chosen.push(row.getAttribute('value') ?? '');
      select.setAttribute('value', row.getAttribute('value') ?? '');
      show(false);
    });
  }
  return { select, chosen };
}

/** Every click landed on `allowed` or on a row's inner item, and the inner items clicked were the rows `inner`, in
 *  order (by their words). */
function clickedOnly(landed: readonly Element[], allowed: readonly Element[], inner: readonly string[]): void {
  expect(landed.filter((el) => !allowed.includes(el) && !el.matches('.c-spl-dropdown-item'))).toEqual([]);
  expect(landed.filter((el) => el.matches('.c-spl-dropdown-item'))
    .map((el) => (rowOfInner(el)?.textContent ?? '').replace(/\s+/g, ' ').trim())).toEqual([...inner]);
}

describe('P2 SR-1 (ENGINE E1, RULES): the screening dropdowns, planned on pass 1 and chosen on their inner item', () => {
  it('xplor-screening: the five read their published lists at scan, all fillable; four planned from the golden profile',
    async () => {
      const { root } = await load('screening');
      const planned = plannedOn(root, 'Xplor');
      const lists = planned.result.fields.filter((field) => field.kind === 'combobox');
      expect(lists.map((field) => field.label)).toEqual([SCREENING.heard, SCREENING.rightToWork, SCREENING.employee,
        SCREENING.ethnicity, SCREENING.gender]);
      expect(lists.map((field) => (field.options === 'lazy' ? 'lazy' : field.options.length))).toEqual([14, 5, 2, 8, 4]);
      for (const field of lists) {
        const widget = planned.result.target(field.key)!.widget!;
        expect([widget.knownFrom, fillabilityOf(field, widget)], field.label).toEqual(['page', { fillable: true }]);
      }
      // The audit's pass 3 (SP\jr6\audit\smartrecruiters.md SR-1), now on pass 1: current or former employee "No",
      // ethnicity and gender "Prefer not to say" (the golden profile declines both); and RULES' SR-7, the source.
      expect(outcome(planned.of(SCREENING.employee))).toEqual({ category: 'screening.previouslyEmployed',
        status: 'verified', reason: 'ok', value: 'No', origin: 'rule screening.previously-employed' });
      expect(outcome(planned.of(SCREENING.ethnicity))).toEqual({ category: 'eeo.race', status: 'verified', reason: 'ok',
        value: 'Prefer not to say', origin: 'rule eeo.decline' });
      expect(outcome(planned.of(SCREENING.gender))).toEqual({ category: 'eeo.gender', status: 'verified', reason: 'ok',
        value: 'Prefer not to say', origin: 'rule eeo.decline' });
      expect(outcome(planned.of(SCREENING.heard))).toEqual({ category: 'referral.source', status: 'verified',
        reason: 'ok', value: 'LinkedIn', origin: 'profile referralSource' });
      // None of the five waits for its options (the right to work is SR-12's, below).
      expect(planned.out.results.filter((row) => row.reason === 'waiting-for-options')).toEqual([]);
    });

  it('read again without the published lists: the five wait for their options, none planned on pass 1', async () => {
    const { root } = await load('screening');
    const withoutLists: Adapter = { ...smartRecruitersAdapter, widgetFor: (control) => {
      const decl = smartRecruitersAdapter.widgetFor!(control);
      return decl === null ? null : { ...decl, knownOptions: undefined };
    } };
    const planned = plannedOn(root, 'Xplor', { adapter: withoutLists });
    const lists = planned.result.fields.filter((field) => field.kind === 'combobox');
    expect(lists.map((field) => field.options)).toEqual(['lazy', 'lazy', 'lazy', 'lazy', 'lazy']);
    expect(lists.map((field) => planned.of(field.label).row.reason)).toEqual(Array(5).fill('waiting-for-options'));
    expect(lists.map((field) => planned.of(field.label).write)).toEqual(Array(5).fill(null));
  });

  it("each planned choice is made through the pass, on its row's inner item, and read back", async () => {
    const { doc, root } = await load('screening');
    const landed = clicksIn(doc);
    const planned = plannedOn(root, 'Xplor');
    const published = definition(doc);
    for (const [label, id] of [[SCREENING.heard, QUESTIONS.heard], [SCREENING.employee, QUESTIONS.employee],
      [SCREENING.ethnicity, QUESTIONS.ethnicity], [SCREENING.gender, QUESTIONS.gender]] as const) {
      const stood = standInAutocomplete(deepOne(doc, `spl-autocomplete#question_${id}`), () => published.get(id)!);
      const wanted = outcome(planned.of(label)).value as string;
      landed.length = 0;
      const result = await writeThrough(root, planned, label, 'Xplor');
      expect(result.row, label).toMatchObject({ status: 'verified', wrote: true, verification: 'verified',
        needsUserAction: false });
      expect(stood.chosen, label).toEqual([wanted]);
      expect(questionBox(doc, id).value, label).toBe(wanted);
      // Its box opened the list; the one click of a row landed on the chosen row's inner item.
      clickedOnly(landed, [questionBox(doc, id)], [wanted]);
    }
  });
});

describe('P2 SR-3, SR-7, SR-9, SR-12, smartrecruiters-new-2 (RULES): what each screening question is', () => {
  it('SR-3: "In your own words" is an instruction: the step keeps its AI, and the essay is drafted', async () => {
    const { root } = await load('screening');
    const planned = plannedOn(root, 'Xplor');
    expect(holdsNoAiAttestation(planned.specs)).toBe(false);
    expect(planned.out.aiAttestation).toBeUndefined();
    expect(planned.out.results.filter((row) => row.reason === 'ai-off-for-posting')).toEqual([]);
    const essay = planned.of('Think about the industry or part of the business this role serves.', true);
    expect(essay.field.label).toContain('In your own words');
    expect(essay.field.kind).toBe('textarea');
    // An ordinary free-text question (owner Q5 (a), which would leave it for the person, is not built): a draft asked.
    expect(outcome(essay)).toEqual({ category: 'freeText.other', status: 'flagged', reason: 'free-text-requires-user',
      value: null, origin: null });
    expect(planned.out.ask?.drafts?.map((item) => planned.labelOf(item.key))).toEqual([essay.field.label,
      planned.of('Is there anything else you’d like us to know about you', true).field.label]);
    // The salary and the right to work are the AI's answers (the `all` scope), as the step's other questions are again.
    expect(planned.out.ask?.answers?.map((item) => planned.labelOf(item.key))).toEqual([SCREENING.salary,
      SCREENING.rightToWork]);
  });

  it("SR-7: \"How did you first hear\" is the referral source; prior applications and conflicts are the AI's to classify",
    async () => {
      const { root } = await load('screening');
      const planned = plannedOn(root, 'Xplor');
      expect(planned.of(SCREENING.heard).row).toMatchObject({ category: 'referral.source', status: 'verified' });
      // RULES item 55's second half (a prior application, a conflict of interest) waits on owner question 14: the five
      // are classified by the AI, as before; "How did you first hear" no longer is.
      expect(planned.out.ask?.classify.map((item) => planned.labelOf(item.key).replace(/:.*$/s, ''))).toEqual([
        SCREENING.applied, 'Intellectual Property', 'Outside Employment', 'Board Memberships', 'Personal Relationships']);
    });

  it('SR-9, smartrecruiters-new-2: "Additional attachments" is no résumé: its list of file types dropped, nothing uploaded',
    async () => {
      const { root } = await load('screening');
      const planned = plannedOn(root, 'Xplor');
      const attachments = planned.of(SCREENING.attachments);
      expect(attachments.field.kind).toBe('file');
      // Its description is the drop zone's restriction text, a list of file types naming RESUME among them.
      expect(attachments.field.description).toMatch(/^Supported files: DOC, DOT, RMR, RSM, RESUME, /);
      const spec = planned.specs.find((each) => each.key === attachments.field.key)!;
      expect(classifyField(spec, testVocab())).toEqual({ by: 'none' });
      expect(classifyField({ ...spec, description: '' }, testVocab())).toEqual({ by: 'none' });
      expect(outcome(attachments)).toEqual({ category: 'unknown', status: 'skipped', reason: 'unknown-field', value: null,
        origin: null });
      expect(planned.out.awaiting).not.toContain(attachments.field.key);
      // No file is written on the step: the résumé goes once, on the first page.
      expect(planned.out.writes.filter((write) => write.value.kind === 'file')).toEqual([]);
      removeFixtures(document);
      // The first page's Resume, its own description "10MB size limit", is still the résumé.
      const first = plannedOn((await load('blank')).root, 'Xplor');
      expect(first.of('Resume').field.description).toBe('10MB size limit');
      expect(outcome(first.of('Resume'))).toEqual({ category: 'file.resume', status: 'verified', reason: 'ok',
        value: 'file', origin: 'profile resume' });
    });

  it('SR-12: the right-to-work statement is left with its reason for the golden profile, chosen from a status given',
    async () => {
      const { root } = await load('screening');
      // The golden profile is authorized with no sponsorship, but gives no status: citizen and permanent resident both
      // fit, so the statement is not the rules' (the `all` scope's AI answers it).
      const golden = plannedOn(root, 'Xplor');
      expect(outcome(golden.of(SCREENING.rightToWork))).toEqual({ category: 'workAuth.authorized', status: 'flagged',
        reason: 'legal-not-in-profile', value: null, origin: null });
      expect(golden.out.awaiting).toContain(golden.of(SCREENING.rightToWork).field.key);
      const citizen = plannedOn(root, 'Xplor', { profile: withWorkStatus('citizen') });
      expect(outcome(citizen.of(SCREENING.rightToWork))).toEqual({ category: 'workAuth.authorized', status: 'verified',
        reason: 'ok', value: 'I am a US citizen', origin: 'profile workAuthorization[0] legal.work-basis' });
      const resident = plannedOn(root, 'Xplor', { profile: withWorkStatus('permanent-resident') });
      expect(outcome(resident.of(SCREENING.rightToWork))).toMatchObject({ status: 'verified',
        value: 'I am a US lawful permanent resident (Green Card holder)' });
    });
});

/** The City search's host. */
const CITY_SEARCH = 'spl-autocomplete[data-sr-id="location-autocomplete-search"]';

/** The rows a stood-in City search draws for a query: those of `cities` that start with it (synthetic: no capture
 *  shows a result's words; the Wiser capture's one result is redacted). */
const startingWith = (cities: readonly string[]) => (query: string) =>
  cities.filter((city) => city.toLowerCase().startsWith(query.toLowerCase()));

/** The City search on a first page, stood in with `cities`, and the planner's query write made through the pass with
 *  a two-letter query before the planner's own (a variant of its write: the page's minquerylength is 3). */
async function searchCity(page: 'blank' | 'wiser', company: string, cities: readonly string[]) {
  const { doc, root } = await load(page);
  const landed = clicksIn(doc);
  const stood = standInAutocomplete(deepOne(doc, CITY_SEARCH), startingWith(cities), { minQuery: 3, delayMs: 250 });
  const planned = plannedOn(root, company);
  const city = planned.of('City');
  expect(outcome(city)).toEqual({ category: 'address.city', status: 'verified', reason: 'ok', value: ['Austin'],
    origin: 'profile address.city typeahead.query' });
  const asked: Asked = [];
  const write = { ...city.write!, value: { kind: 'query', queries: ['Au', 'Austin'] } } as PlannedWrite;
  const result = await writeThrough(root, planned, 'City', company, { write, asked });
  return { doc, landed, stood, asked, result, box: autocompleteBox(doc, CITY_SEARCH) };
}

describe('P2 SR-2 (ENGINE E1) and SR-13 (RULES): the first page', () => {
  it.each([['blank', 'Xplor'], ['wiser', 'Wiser Solutions']] as const)(
    "%s: the City search through the pass: never shorter than 3; rows drawn later in the autocomplete's shadow root are "
    + 'read, the manual row unchoosable; the matched result chosen on its inner item and verified', async (page, company) => {
      // Rows that read as the city alone, which the worker's match takes (see the known gap below for SmartRecruiters'
      // own wording).
      const { landed, stood, asked, result, box } = await searchCity(page, company, ['Austin', 'Austintown']);
      // The two-letter query is never typed (minquerylength="3"); "Austin" is, once.
      expect(stood.typed).toEqual(['Austin']);
      // The match was given the rows the search drew 250 ms after the query, in spl-autocomplete's shadow root, the
      // manual mode's row among them as one that cannot be chosen (results.unchoosable).
      expect(asked).toEqual([[['Austin', false], ['Austintown', false], [MANUAL_ROW_WORDS, true]]]);
      expect(result.row).toMatchObject({ category: 'address.city', status: 'verified', wrote: true,
        verification: 'verified' });
      expect(stood.chosen).toEqual(['Austin']);
      expect(box.value).toBe('Austin');
      clickedOnly(landed, [box], ['Austin']);
    });

  // Known gap, older than jr6 (reported to RULES in the P2 handoff): SmartRecruiters' City results name the city with
  // its region and country (the Wiser capture's one result, redacted, keeps an identifier spelling a city and its
  // state), but the planner reads "City" (address.city) as a text value, matched as text: only a result that is the
  // city's word alone matches. The place matcher (core/matcher/place.ts: "Austin, Texas, United States" for "Austin,
  // TX") serves location.current only.
  it.fails('blank (known gap): a result worded "City, State, Country" is the golden profile\'s city, chosen and verified',
    async () => {
      const { stood, result } = await searchCity('blank', 'Xplor', ['Austin, Texas, United States',
        'Austin, Minnesota, United States']);
      expect(stood.chosen).toEqual(['Austin, Texas, United States']);
      expect(result.row).toMatchObject({ status: 'verified', wrote: true, verification: 'verified' });
    });

  it("blank: today such results are read, then no match: the box put back, the field the person's, no row clicked",
    async () => {
      const { landed, stood, asked, result, box } = await searchCity('blank', 'Xplor', ['Austin, Texas, United States',
        'Austin, Minnesota, United States']);
      expect(asked).toEqual([[['Austin, Texas, United States', false], ['Austin, Minnesota, United States', false],
        [MANUAL_ROW_WORDS, true]]]);
      expect(result.row).toMatchObject({ category: 'address.city', status: 'flagged', reason: 'no-match', wrote: false });
      expect(stood.chosen).toEqual([]);
      expect(stood.typed).toEqual(['Austin', '']);
      expect(box.value).toBe('');
      clickedOnly(landed, [box], []);
    });

  it.each([['blank', 'Xplor'], ['wiser', 'Wiser Solutions']] as const)(
    '%s: SR-13: "Facebook" is skipped with no AI classification', async (page, company) => {
      const planned = plannedOn((await load(page)).root, company);
      const facebook = planned.of('Facebook');
      expect(outcome(facebook)).toEqual({ category: 'links.facebook', status: 'skipped', reason: 'no-profile-value',
        value: null, origin: null });
      expect(planned.out.awaiting).not.toContain(facebook.field.key);
      // No question of the first page is classified by the AI (the audit's pass 1 asked one: Facebook).
      expect(planned.out.ask?.classify ?? []).toEqual([]);
    });
});

describe("P2 SR-6 (ENGINE E1): the phone's country, on xplor-one-click", () => {
  it("its 245 rows read through results.options; the select's value shown; the planner's choice made on its row's inner "
    + 'item', async () => {
    const { doc, root } = await load('blank');
    const landed = clicksIn(doc);
    const { select, chosen } = standInPhoneSelect(doc);
    const { button } = phoneSelect(doc);
    const label = 'Phone number country code';
    // The select showing the United States (SmartRecruiters' default: the audit's SR-6): its row's words, as its read
    // list writes them (the capture's value is cleared by the converter).
    select.setAttribute('value', 'US');
    const first = plannedOn(root, 'Xplor');
    expect(first.of(label).field.current).toEqual({ kind: 'selected', labels: ['United States +1'] });
    expect(outcome(first.of(label))).toEqual({ category: 'contact.phoneCountry', status: 'flagged',
      reason: 'waiting-for-options', value: null, origin: null });
    // The run reads its list (the waiting path's readWidget): the 245 rows its menu's slot holds, nothing chosen.
    const readings = new Map<BaseKey, WidgetReading>();
    const read = await readWidget(first.result.target(first.of(label).field.key)!,
      { adapter: smartRecruitersAdapter, root, readings });
    expect(read.status).toBe('read');
    const reading = (read as { reading: WidgetReading }).reading;
    expect(reading.kind === 'options' ? [reading.options.length, reading.options[0]?.label] : reading.kind)
      .toEqual([245, 'Afghanistan +93']);
    expect(chosen).toEqual([]);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    // The golden phone is the United States', which the select shows already: nothing to write (already-correct).
    const shown = plannedOn(root, 'Xplor', { readings });
    expect(shown.of(label).field.options === 'lazy' ? 'lazy' : shown.of(label).field.options.length).toBe(245);
    expect(outcome(shown.of(label))).toEqual({ category: 'contact.phoneCountry', status: 'skipped',
      reason: 'already-correct', value: null, origin: null });
    // A variant: the select showing Canada. The planner replaces it with the profile's, flagged as a value the page
    // held; the choice is made on the United States row's inner item and read back by the select's value.
    select.setAttribute('value', 'CA');
    const planned = plannedOn(root, 'Xplor', { readings });
    expect(planned.of(label).field.current).toEqual({ kind: 'selected', labels: ['Canada +1'] });
    expect(outcome(planned.of(label))).toMatchObject({ category: 'contact.phoneCountry', status: 'flagged',
      reason: 'prefill-conflict', value: 'United States +1' });
    landed.length = 0;
    const result = await writeThrough(root, planned, label, 'Xplor', { readings });
    expect(result.row).toMatchObject({ status: 'flagged', reason: 'prefill-conflict', wrote: true,
      verification: 'verified' });
    expect(chosen).toEqual(['US']);
    expect(select.getAttribute('value')).toBe('US');
    clickedOnly(landed, [button], ['United States +1']);
  });
});

/** Countries a stood-in Country/Region list draws when opened (synthetic: no capture shows it open). */
const COUNTRIES = ['Canada', 'Mexico', 'United Kingdom', 'United States'];

describe('P2 SR-10 (RULES, ENGINE E1): "Country/Region" in the manual location mode', () => {
  it('jr6-xplor-one-click-filled: read as the country, its list read by opening it, the golden country chosen', async () => {
    const { doc, root } = await load('xplorFilled');
    const landed = clicksIn(doc);
    const selector = 'spl-autocomplete[data-sr-id="location-autocomplete-country"]';
    const stood = standInAutocomplete(deepOne(doc, selector), () => COUNTRIES);
    const label = 'Country/Region';
    const first = plannedOn(root, 'Xplor');
    expect(outcome(first.of(label))).toEqual({ category: 'address.country', status: 'flagged',
      reason: 'waiting-for-options', value: null, origin: null });
    const readings = new Map<BaseKey, WidgetReading>();
    const read = await readWidget(first.result.target(first.of(label).field.key)!,
      { adapter: smartRecruitersAdapter, root, readings });
    expect(read).toMatchObject({ status: 'read', reading: { kind: 'options' } });
    const planned = plannedOn(root, 'Xplor', { readings });
    expect(outcome(planned.of(label))).toMatchObject({ category: 'address.country', status: 'verified', reason: 'ok',
      value: 'United States' });
    landed.length = 0;
    const result = await writeThrough(root, planned, label, 'Xplor', { readings });
    expect(result.row).toMatchObject({ status: 'verified', wrote: true, verification: 'verified' });
    expect(stood.chosen).toEqual(['United States']);
    clickedOnly(landed, [autocompleteBox(doc, selector)], ['United States']);
  });
});

describe('P2 SR-4 (RULES): the sponsorship question naming two countries, on jr6-wiser-screening', () => {
  it("is answered from the profile's own country, flagged as a posting-country answer, and pressed through the pass",
    async () => {
      const doc = await loadAny('wiserScreening');
      const root = smartRecruitersAdapter.detect(doc)!.formRoot;
      const planned = plannedOn(root, 'Wiser Solutions');
      const sponsorship = planned.of('Do you, now or in the future, require sponsorship', true);
      expect(sponsorship.field.label)
        .toContain('in the US (if you are located in the US) or Canada (if you are located in Canada)');
      expect(outcome(sponsorship)).toEqual({ category: 'workAuth.sponsorship', status: 'flagged',
        reason: 'filled-low-confidence', value: 'No', origin: 'profile workAuthorization[0] legal.located-country' });
      expect(sponsorship.row.needsUserAction).toBe(false);
      expect(planned.out.awaiting).toEqual([]);
      // The Yes/No group's options are its own spl-radio children: a press marks one checked (stood in).
      const members = planned.result.target(sponsorship.field.key)!.widget!.members;
      for (const member of members) {
        member.addEventListener('click', () => {
          for (const other of members) other.setAttribute('aria-checked', String(other === member));
        });
      }
      const result = await writeThrough(root, planned, sponsorship.field.label, 'Wiser Solutions');
      expect(result.row).toMatchObject({ status: 'flagged', reason: 'filled-low-confidence', wrote: true,
        verification: 'verified' });
      expect(members.map((member) => member.getAttribute('aria-checked'))).toEqual(['false', 'true']);
    });
});

describe('P2 SR-11: a résumé the run puts in is uploaded once the drop zone lists it', () => {
  it('xplor-one-click: the Resume written through the pass, confirmed by the row that names it (awaitUpload)', async () => {
    const { fixture, doc, root } = await load('blank');
    const zone = deepOne(doc, 'spl-dropzone[data-test="resume-upload"]');
    const input = fileInputOf(zone);
    // The drop zone as the live page drives it (stood in): a file put in is listed by name 300 ms later.
    input.addEventListener('change', () => {
      const name = input.files?.[0]?.name ?? '';
      fixture.view.setTimeout(() => addFileRow(zone, name), 300);
    });
    const worker = createFakeWorker({ resume: { bytes: fakePdf(1200), name: GOLDEN_RESUME.fileName,
      mime: 'application/pdf' } });
    const planned = plannedOn(root, 'Xplor');
    const resume = planned.of('Resume');
    const result = await writeField(passEnv(root, worker.platform), planned.result, resume.field, resume.write!,
      resume.row, new WeakMap());
    result.written?.resume?.release();
    expect(result.row).toMatchObject({ category: 'file.resume', status: 'verified', wrote: true,
      verification: 'verified' });
    expect(result.written?.upload).toBe('confirmed');
    expect(smartRecruitersAdapter.uploadHeldNames!(input)).toEqual([GOLDEN_RESUME.fileName]);
    // The page's word is read by the adapter alone: without uploadState nothing is waited for.
    removeFixtures(document);
    const again = await load('blank');
    const plain = without('uploadState');
    const second = plannedOn(again.root, 'Xplor', { adapter: plain });
    const unwatched = await writeField(passEnv(again.root, worker.platform, plain), second.result,
      second.of('Resume').field, second.of('Resume').write!, second.of('Resume').row, new WeakMap());
    unwatched.written?.resume?.release();
    expect(unwatched.written?.upload).toBeNull();
  });
});
