/*
 * Workday's stored and learned lists (snapshot round 2, decision 1: the owner's "store it and select at a once, without
 * checking what elements is there"), on the owner's snapshot of the State list open (fixtures/workday/
 * s2-exelixis-state-open.html, snapshot1's exelixis "(1)": 61 rows drawn whole), with Workday's script stood in for as
 * workday-steps.browser.test.ts does (a click on a dropdown's button draws the snapshot's own list and names it, a click
 * on one of its options writes it on the button and closes it):
 * - the stored lists are the captures' own (adapters/workday/lists.ts);
 * - Country, and State while the country shown is the United States, are planned on the first pass from their stored
 *   lists, no list opened; any other dropdown is read when it opens, its list drawn whole read without a wait;
 * - the planned option is chosen with one opening of its list, found at its place by its label, clicked and read back;
 *   a list the page shows otherwise is read whole (options-changed), and that read is the field's from then on;
 * - a dropdown with no stored list tells the run its whole read (learned), and a list learned before is its stored list.
 */
import { afterEach, describe, expect, it } from 'vitest';
import stateOpenHtml from '../../../fixtures/workday/s2-exelixis-state-open.html?raw';
import { planFrame } from '../../core/plan/frame';
import { labelSlug } from '../../core/text/keys';
import type { BaseKey } from '../../core/types/field';
import { DEFAULT_SETTINGS } from '../../core/types/settings';
import { goldenProfile, NOW, testVocab } from '../../content/content.testkit';
import { loadFixture, removeFixtures, type Fixture } from '../../dom/fixture.testkit';
import { scan, toFieldSpec } from '../../dom/scan';
import type { ScannedField, WidgetReading } from '../../dom/types';
import { fillWidget, learnedListKey, readList, readWidget } from '../../dom/widgets';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { workdayAdapter } from './index';
import { asDropdownList, WORKDAY_COUNTRIES, WORKDAY_SELECT_ONE, WORKDAY_US, WORKDAY_US_STATES } from './lists';

/** The Country list open, once the converter can drop its active option (the wd builder's s2-exelixis-country-open):
 *  checked against the stored list when it is there. */
const COUNTRY_OPEN = import.meta.glob('../../../fixtures/workday/s2-exelixis-country-open.html',
  { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

afterEach(() => removeFixtures(document));

const STATE = 'button#address--countryRegion';
const COUNTRY = 'button#country--country';
const PREFIX = 'button#name--legalName--title';

interface Page {
  fixture: Fixture;
  doc: Document;
  root: Element;
  /** What the stand-in saw: 'open <id>', 'close <id>', 'option <label>'. */
  events: string[];
  /** The State list's popup the stand-in draws for any dropdown it opens. */
  popup: HTMLElement;
  list: HTMLElement;
}

/** Sets what a dropdown's button shows chosen: its words and a value (none: "Select One", value ""). */
function show(button: HTMLButtonElement, words: string | null): void {
  button.textContent = words ?? WORKDAY_SELECT_ONE;
  button.setAttribute('value', words === null ? '' : 'stand-in-id');
}

/**
 * The snapshot with its State list closed and Workday's script stood in for: a click on a dropdown's button draws the
 * snapshot's own popup (its options relabelled by `labelsFor` for that button, when given) at the end of the body and
 * names it (aria-expanded, aria-controls); a click on one of its options writes it on the button and closes it; a
 * second click on the button closes it. The Country button shows `country` (null: nothing chosen).
 */
async function standIn(country: string | null, labelsFor: Record<string, readonly string[]> = {}): Promise<Page> {
  const fixture = await loadFixture(document, stateOpenHtml, SNAPSHOT_VIEWPORT);
  const doc = fixture.doc;
  const root = workdayAdapter.detect(doc)!.formRoot;
  const list = doc.querySelector<HTMLElement>('ul[role="listbox"]#xfw6t')!;
  const popup = list.closest<HTMLElement>('[data-popper-placement]')!;
  const stateRows = Array.from(list.children).map((row) => row.cloneNode(true) as HTMLElement);
  for (const button of Array.from(doc.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="listbox"]'))) {
    button.removeAttribute('aria-expanded');
    button.removeAttribute('aria-controls');
    show(button, null);
  }
  show(doc.querySelector<HTMLButtonElement>(COUNTRY)!, country);
  popup.remove();
  const events: string[] = [];
  let openFor: HTMLButtonElement | null = null;
  const close = () => {
    popup.remove();
    openFor?.removeAttribute('aria-expanded');
    openFor?.removeAttribute('aria-controls');
    if (openFor !== null) events.push(`close ${openFor.id}`);
    openFor = null;
  };
  doc.addEventListener('click', (event) => {
    const target = event.target as Element;
    const option = target.closest('[role="option"]');
    if (option !== null && list.contains(option) && openFor !== null) {
      const words = option.textContent?.trim() ?? '';
      events.push(`option ${words}`);
      show(openFor, words === WORKDAY_SELECT_ONE ? null : words);
      close();
      return;
    }
    const button = target.closest<HTMLButtonElement>('button[aria-haspopup="listbox"]');
    if (button === null) return;
    if (openFor === button) {
      close();
      return;
    }
    close();
    const labels = labelsFor[button.id];
    list.replaceChildren(...(labels === undefined ? stateRows.map((row) => row.cloneNode(true))
      : [WORKDAY_SELECT_ONE, ...labels].map((label, at) => {
        const row = stateRows[Math.min(at, stateRows.length - 1)]!.cloneNode(true) as HTMLElement;
        row.id = `stand-in-${at}`;
        row.querySelector('div')!.textContent = label;
        if (at > 0) row.removeAttribute('aria-disabled');
        return row;
      })));
    list.scrollTop = 0;
    doc.body.append(popup);
    button.setAttribute('aria-expanded', 'true');
    button.setAttribute('aria-controls', 'xfw6t');
    openFor = button;
    events.push(`open ${button.id}`);
  });
  return { fixture, doc, root, events, popup, list };
}

function fieldOf(page: Page, selector: string, options: Parameters<typeof scan>[2] = { platform: 'workday' }):
  { field: ScannedField; result: ReturnType<typeof scan> } {
  const control = page.doc.querySelector(selector)!;
  const result = scan(page.root, workdayAdapter, options);
  const field = result.fields.find((each) => result.target(each.key)?.widget?.element === control)!;
  return { field, result };
}

const labelsOf = (field: ScannedField) => (field.options === 'lazy' ? 'lazy' : field.options.map((option) => option.label));

describe("Workday's stored lists are the snapshots' own", () => {
  it('the State list: "Select One" and the 60 entries s2-exelixis-state-open shows open, as a whole read takes them', async () => {
    const fixture = await loadFixture(document, stateOpenHtml, SNAPSHOT_VIEWPORT);
    const list = fixture.doc.querySelector('ul[role="listbox"]#xfw6t')!;
    const read = await readList(list, { drawnWhole: true });
    expect(read.complete).toBe(true);
    expect(read.options.map((option) => option.label)).toEqual(asDropdownList(WORKDAY_US_STATES));
    expect(read.options[0]).toMatchObject({ label: WORKDAY_SELECT_ONE, disabled: true });
    expect(WORKDAY_US_STATES).toHaveLength(60);
    expect(WORKDAY_COUNTRIES).toHaveLength(249);
    expect(new Set(WORKDAY_COUNTRIES).size).toBe(249);
    expect(WORKDAY_COUNTRIES).toContain(WORKDAY_US);
  });

  it.skipIf(Object.keys(COUNTRY_OPEN).length === 0)('the Country list: the 249 countries s2-exelixis-country-open shows open',
    async () => {
      const fixture = await loadFixture(document, Object.values(COUNTRY_OPEN)[0]!, SNAPSHOT_VIEWPORT);
      const lists = Array.from(fixture.doc.querySelectorAll('ul[role="listbox"]'))
        .filter((list) => list.querySelector('li[role="option"]') !== null);
      expect(lists).toHaveLength(1);
      const read = await readList(lists[0]!, { drawnWhole: true });
      expect(read.options.map((option) => option.label)).toEqual(asDropdownList(WORKDAY_COUNTRIES));
    });

  it('reads a list drawn whole without a wait between its views: the 61 states at once (1.6 s view by view before)', async () => {
    const fixture = await loadFixture(document, stateOpenHtml, SNAPSHOT_VIEWPORT);
    const list = fixture.doc.querySelector('ul[role="listbox"]#xfw6t')!;
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight * 4);
    const started = performance.now();
    const read = await readList(list, { drawnWhole: true });
    const whole = performance.now() - started;
    expect(read.options).toHaveLength(61);
    expect(whole).toBeLessThan(400);
    // The same list read view by view, each view waited for: the read the declaration spares.
    list.scrollTop = 0;
    const before = performance.now();
    expect((await readList(list)).options).toHaveLength(61);
    expect(performance.now() - before).toBeGreaterThan(whole + 500);
  });
});

describe("Workday's Country and State planned from their stored lists on the first pass", () => {
  it('declares every dropdown drawn whole, Country with its countries, State with the states only for the United States', async () => {
    const us = await standIn(WORKDAY_US);
    const declared = (page: Page, selector: string) => workdayAdapter.widgetFor!(page.doc.querySelector(selector)!)!;
    expect(declared(us, COUNTRY)).toMatchObject({ kind: 'combobox', drawnWhole: true,
      knownOptions: asDropdownList(WORKDAY_COUNTRIES) });
    expect(declared(us, STATE)).toMatchObject({ drawnWhole: true, knownOptions: asDropdownList(WORKDAY_US_STATES) });
    expect(declared(us, PREFIX)).toMatchObject({ drawnWhole: true });
    expect(declared(us, PREFIX).knownOptions).toBeUndefined();
    removeFixtures(document);
    for (const country of [null, 'Canada']) {
      const other = await standIn(country);
      expect(declared(other, STATE).knownOptions, String(country)).toBeUndefined();
      removeFixtures(document);
    }
  });

  it('plans Country and State on the first pass, no list opened, and reads State when the country is another', async () => {
    const page = await standIn(null);
    const { result } = fieldOf(page, COUNTRY);
    const country = result.fields.find((each) => result.target(each.key)?.widget?.element === page.doc.querySelector(COUNTRY))!;
    expect(labelsOf(country)).toEqual(asDropdownList(WORKDAY_COUNTRIES));
    expect(country.optionsPartial).toBeUndefined();
    expect(result.target(country.key)!.widget).toMatchObject({ knownFrom: 'adapter', drawnWhole: true });
    const state = result.fields.find((each) => result.target(each.key)?.widget?.element === page.doc.querySelector(STATE))!;
    expect(state.options).toBe('lazy');
    const plan = planFrame({ specs: result.fields.map(toFieldSpec), canaries: [], profile: goldenProfile(),
      sensitiveState: 'loaded', savedAnswers: [], settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW });
    expect(plan.writes.find((write) => write.key === country.key)).toMatchObject({ value: { kind: 'option',
      index: asDropdownList(WORKDAY_COUNTRIES).indexOf(WORKDAY_US), cleanLabel: WORKDAY_US } });
    expect(plan.results.find((row) => row.key === state.key)).toMatchObject({ reason: 'waiting-for-options' });
    removeFixtures(document);

    const us = await standIn(WORKDAY_US);
    const { field: stateUs, result: scanned } = fieldOf(us, STATE);
    expect(labelsOf(stateUs)).toEqual(asDropdownList(WORKDAY_US_STATES));
    const planned = planFrame({ specs: scanned.fields.map(toFieldSpec), canaries: [], profile: goldenProfile(),
      sensitiveState: 'loaded', savedAnswers: [], settings: DEFAULT_SETTINGS, vocab: testVocab(), dryRun: false, now: NOW });
    expect(planned.writes.find((write) => write.key === stateUs.key)).toMatchObject({ value: { kind: 'option',
      index: asDropdownList(WORKDAY_US_STATES).indexOf('Texas'), cleanLabel: 'Texas' } });
    // Nothing was opened to plan them.
    expect(us.events).toEqual([]);
  });
});

describe('a stored list chosen at once, its list checked as it opens', () => {
  it('opens the State list once, clicks Texas at its place, closes, and reads it back from the button', async () => {
    const page = await standIn(WORKDAY_US);
    const { field, result } = fieldOf(page, STATE);
    const index = asDropdownList(WORKDAY_US_STATES).indexOf('Texas');
    const readings = new Map<BaseKey, WidgetReading>();
    const started = performance.now();
    const outcome = await fillWidget(result.target(field.key)!, { kind: 'option', index, cleanLabel: 'Texas' },
      { adapter: workdayAdapter, root: page.root, readings });
    expect(outcome).toMatchObject({ wrote: true, verification: 'verified' });
    expect(page.events).toEqual(['open address--countryRegion', 'option Texas', 'close address--countryRegion']);
    expect(performance.now() - started).toBeLessThan(1_500);
    // No read of the list was kept: the stored list stays the field's.
    expect(readings.size).toBe(0);
    const after = fieldOf(page, STATE);
    expect(after.field.current).toEqual({ kind: 'selected', labels: ['Texas'] });
    expect(after.result.target(after.field.key)!.widget?.knownFrom).toBe('adapter');
  });

  it('a list that is not the stored one at the planned place: read whole, kept as the reading, nothing chosen', async () => {
    // The tenant's State list lacks one state before Texas: Texas is not at its stored place.
    const fewer = WORKDAY_US_STATES.filter((state) => state !== 'Tennessee');
    const page = await standIn(WORKDAY_US, { 'address--countryRegion': fewer });
    const { field, result } = fieldOf(page, STATE);
    const index = asDropdownList(WORKDAY_US_STATES).indexOf('Texas');
    const readings = new Map<BaseKey, WidgetReading>();
    const outcome = await fillWidget(result.target(field.key)!, { kind: 'option', index, cleanLabel: 'Texas' },
      { adapter: workdayAdapter, root: page.root, readings });
    expect(outcome).toMatchObject({ wrote: false, reason: 'options-changed' });
    expect(page.events).toEqual(['open address--countryRegion', 'close address--countryRegion']);
    expect(readings.get(field.baseKey)).toMatchObject({ kind: 'options', complete: true });
    const again = fieldOf(page, STATE, { platform: 'workday', widgetReadings: readings });
    expect(labelsOf(again.field)).toEqual(asDropdownList(fewer));
    expect(again.result.target(again.field.key)!.widget?.knownOptions).toBeUndefined();
    // Planned from what the page showed, Texas is found where it is now.
    const now = asDropdownList(fewer).indexOf('Texas');
    expect(await fillWidget(again.result.target(again.field.key)!, { kind: 'option', index: now, cleanLabel: 'Texas' },
      { adapter: workdayAdapter, root: page.root, readings })).toMatchObject({ wrote: true, verification: 'verified' });
    expect(page.events.slice(2)).toEqual(['open address--countryRegion', 'option Texas', 'close address--countryRegion']);
  });
});

describe('a list learned for its host', () => {
  const PREFIXES = ['Dr.', 'Mr.', 'Mrs.', 'Ms.', 'Mx.'];

  it('tells the run of a dropdown with no stored list read whole; never of a stored one', async () => {
    const page = await standIn(WORKDAY_US, { 'name--legalName--title': PREFIXES });
    const { field, result } = fieldOf(page, PREFIX);
    expect(field.options).toBe('lazy');
    const learned: Array<{ slug: string; labels: readonly string[] }> = [];
    const learn = (target: { field: ScannedField }, labels: readonly string[]) => learned.push({
      slug: labelSlug(target.field), labels });
    const read = await readWidget(result.target(field.key)!, { adapter: workdayAdapter, root: page.root,
      readings: new Map(), learn });
    expect(read.status).toBe('read');
    expect(learned).toEqual([{ slug: labelSlug(field), labels: [WORKDAY_SELECT_ONE, ...PREFIXES] }]);
    // A stored list's dropdown (Country) read whole is never learned.
    const country = fieldOf(page, COUNTRY);
    await readWidget(country.result.target(country.field.key)!, { adapter: workdayAdapter, root: page.root,
      readings: new Map(), learn });
    expect(learned).toHaveLength(1);
  });

  it('gives a dropdown the list learned for its label as its options, checked as it opens', async () => {
    const page = await standIn(WORKDAY_US, { 'name--legalName--title': PREFIXES });
    const lazy = fieldOf(page, PREFIX).field;
    const learnedLists = new Map([[learnedListKey(labelSlug(lazy)), [WORKDAY_SELECT_ONE, ...PREFIXES]]]);
    const { field, result } = fieldOf(page, PREFIX, { platform: 'workday', learnedLists });
    expect(labelsOf(field)).toEqual([WORKDAY_SELECT_ONE, ...PREFIXES]);
    expect(result.target(field.key)!.widget?.knownFrom).toBe('learned');
    // The learned list never stands for a dropdown with a stored list of its own.
    const country = fieldOf(page, COUNTRY, { platform: 'workday',
      learnedLists: new Map([[learnedListKey(labelSlug(fieldOf(page, COUNTRY).field)), ['Select One', 'Narnia']]]) });
    expect(labelsOf(country.field)).toEqual(asDropdownList(WORKDAY_COUNTRIES));
    const outcome = await fillWidget(result.target(field.key)!, { kind: 'option', index: 4, cleanLabel: 'Ms.' },
      { adapter: workdayAdapter, root: page.root, readings: new Map() });
    expect(outcome).toMatchObject({ wrote: true, verification: 'verified' });
    expect(page.events).toEqual(['open name--legalName--title', 'option Ms.', 'close name--legalName--title']);
  });
});
