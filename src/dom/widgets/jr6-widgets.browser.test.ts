/*
 * jr6 ENGINE E1 (FIXPLAN §6.2 items 1 and 3): the widget helpers on synthetic pages shaped as the jr6 audits
 * describe each platform's widget (SP\jr6\audit\oracle.md, icims.md, smartrecruiters.md, adp.md, ultipro.md), each
 * declared by a test adapter as its platform package will declare it (FIXPLAN §6.5, §6.6, §6.9 to §6.11), driven only
 * by calling the helpers:
 * - item 1 (oracle-new-1): a grid popup (role=grid > row > gridcell > label span), for a combobox and a multiselect:
 *   read whole by the declared rows, the planned row chosen by a click on its label part, read back;
 * - item 3 (SR-1, SR-2, SR-6 core): nested shadow roots with aria-controls across them and options slotted into the
 *   list (WidgetResults.options, pressTarget), the page's own list as the field's reading (WidgetDecl.knownOptions),
 *   rows that load into the host watched directly, and the page's shortest query (WidgetDecl.minQueryLength);
 * Every value is synthetic (no owner data); every event the helpers cause is untrusted and on the fillers' list.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { fillabilityOf } from '../../adapters/test/expectations.testkit';
import type { Adapter, WidgetDecl } from '../../adapters/types';
import type { Platform } from '../../core/enums';
import type { BaseKey } from '../../core/types/field';
import { ALLOWED_EVENTS, KEY_EVENTS } from '../fillers/events';
import { loadFixture, logEvents, removeFixtures, untrustedViolations, type EventLog, type Fixture } from '../fixture.testkit';
import { scan } from '../scan';
import type { FieldTarget, ScanResult, WidgetReading } from '../types';
import { fillWidget, isActionable, readWidget, searchTypeahead, widgetHolds } from './index';

interface Page {
  fixture: Fixture;
  doc: Document;
  root: Element;
  events: EventLog;
  readings: Map<BaseKey, WidgetReading>;
  adapter: Adapter | null;
  scanned(): ScanResult;
  /** The live target of the field with this label. */
  target(label: string): FieldTarget;
  ctx(): { adapter: Adapter | null; root: Element; readings: Map<BaseKey, WidgetReading> };
  win<T>(name: string): T;
}

/** Loads `html` and scans its form#f with the adapter `adapterOf` builds over the loaded document (null: none). */
async function open(html: string, platform: Platform, adapterOf: (doc: Document) => Adapter | null): Promise<Page> {
  const fixture = await loadFixture(document, html, { width: 1280, height: 900 });
  const doc = fixture.doc;
  const root = doc.getElementById('f')!;
  const readings = new Map<BaseKey, WidgetReading>();
  const adapter = adapterOf(doc);
  const events = logEvents(doc);
  const scanned = () => scan(root, adapter, { platform, widgetReadings: readings });
  return {
    fixture, doc, root, events, readings, adapter, scanned,
    target(label) {
      const result = scanned();
      const field = result.fields.find((candidate) => candidate.label === label);
      if (field === undefined) {
        throw new Error(`no field labelled ${label}: ${JSON.stringify(result.fields.map((each) => each.label))}`);
      }
      return result.target(field.key)!;
    },
    ctx: () => ({ adapter, root, readings }),
    win: <T>(name: string) => (fixture.view as unknown as Record<string, T>)[name]!,
  };
}

/** Untrusted events on the fillers' list only (and a declared key's keydown and keyup where `keys`); the browser's own
 *  scroll aside. */
function expectOurEventsOnly(log: EventLog, keys = false): void {
  expect(untrustedViolations(log.events)).toEqual([]);
  const allowed = new Set<string>([...ALLOWED_EVENTS, ...(keys ? KEY_EVENTS : [])]);
  expect(log.events.filter((event) => !event.trusted && !allowed.has(event.type))).toEqual([]);
}

/** The labels of a read. */
function labelsOf(result: Awaited<ReturnType<typeof readWidget>>): string[] | string {
  return result.status === 'read' && result.reading.kind === 'options'
    ? result.reading.options.map((option) => option.label) : JSON.stringify(result);
}

/** A field's options' labels, or 'lazy'. */
function optionLabels(target: FieldTarget): string[] | 'lazy' {
  const options = target.field.options;
  return options === 'lazy' ? 'lazy' : options.map((option) => option.label);
}

afterEach(() => removeFixtures(document));

// ── Item 1 (oracle-new-1): Oracle's cx-select, a grid popup ─────────────────────────────────────────

/** Oracle's cx-select as SP\jr6\audit\oracle.md section 4 reads it: an input[role=combobox][aria-haspopup=grid] whose
 *  aria-controls names a role=grid popup of role=row > role=gridcell > span.cx-select__list-item--content, opened by
 *  its toggle button; a row's click chooses it (window.__clicks: the row and the element clicked). And a multiselect
 *  of the same grid (Languages), select-only, its rows marked aria-selected, its chips beside it, toggled shut by its
 *  own second click. */
const GRID = `<!doctype html><html><head><style>
  [hidden] { display: none !important; }
  .grid { border: 1px solid #888; margin: 0; padding: 2px; }
  [role=row] { display: block; padding: 2px 4px; }
  .chip { margin-right: 4px; }
</style></head><body><form id="f">
  <label id="country-label" for="country">Country</label>
  <div class="cx-select">
    <input id="country" type="text" role="combobox" aria-haspopup="grid" aria-autocomplete="list" aria-expanded="false"
      aria-controls="country-listbox" aria-labelledby="country-label" value="">
    <button id="country-toggle-button" type="button" aria-label="Country choices" aria-expanded="false"
      aria-controls="country-listbox">v</button>
  </div>
  <div id="country-listbox" role="grid" class="grid" hidden>
    <div role="row" id="row-ca"><div role="gridcell"><span class="cx-select__list-item--content">Canada</span></div></div>
    <div role="row" id="row-mx"><div role="gridcell"><span class="cx-select__list-item--content">Mexico</span></div></div>
    <div role="row" id="row-us"><div role="gridcell"><span class="cx-select__list-item--content">United States</span></div></div>
  </div>
  <p>Other questions</p>
  <span id="langs-label">Languages</span>
  <div class="langs-box"><span id="langs-chips"></span>
    <div id="langs" role="combobox" tabindex="0" aria-haspopup="grid" aria-expanded="false" aria-controls="langs-listbox"
      aria-labelledby="langs-label">Choose</div></div>
  <div id="langs-listbox" role="grid" class="grid" aria-multiselectable="true" hidden>
    <div role="row" id="lang-en" aria-selected="false"><div role="gridcell"><span class="cx-select__list-item--content">English</span></div></div>
    <div role="row" id="lang-fr" aria-selected="false"><div role="gridcell"><span class="cx-select__list-item--content">French</span></div></div>
    <div role="row" id="lang-es" aria-selected="false"><div role="gridcell"><span class="cx-select__list-item--content">Spanish</span></div></div>
  </div>
</form>
<script>
  window.__clicks = [];
  const box = document.getElementById('country');
  const toggle = document.getElementById('country-toggle-button');
  const grid = document.getElementById('country-listbox');
  const show = (open) => { grid.hidden = !open; for (const el of [box, toggle]) el.setAttribute('aria-expanded', String(open)); };
  toggle.addEventListener('click', () => show(grid.hidden));
  box.addEventListener('click', () => show(true));
  box.addEventListener('keydown', (event) => { if (event.key === 'Escape') show(false); });
  for (const row of grid.querySelectorAll('[role=row]')) {
    row.addEventListener('click', (event) => {
      window.__clicks.push([row.id, event.target.className || event.target.getAttribute('role')]);
      box.value = row.textContent.trim();
      show(false);
    });
  }
  const langs = document.getElementById('langs');
  const langGrid = document.getElementById('langs-listbox');
  const chips = document.getElementById('langs-chips');
  langs.addEventListener('click', () => {
    langGrid.hidden = !langGrid.hidden;
    langs.setAttribute('aria-expanded', String(!langGrid.hidden));
  });
  for (const row of langGrid.querySelectorAll('[role=row]')) {
    row.addEventListener('click', (event) => {
      window.__clicks.push([row.id, event.target.className || event.target.getAttribute('role')]);
      row.setAttribute('aria-selected', String(row.getAttribute('aria-selected') !== 'true'));
      chips.replaceChildren(...Array.from(langGrid.querySelectorAll('[role=row][aria-selected=true]'), (chosen) => {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = chosen.textContent.trim();
        return chip;
      }));
    });
  }
</script></body></html>`;

/** The grid's rows as Oracle's adapter declares them (FIXPLAN §6.11 item 1): opener and expanded its toggle button
 *  where it has one, keys Escape only, the list its aria-controls, a row by role=row chosen by a click on its label
 *  part (.cx-select__list-item--content, else its gridcell). */
function oracleAdapter(doc: Document): Adapter {
  const optionLabel = (row: Element) => row.querySelector('.cx-select__list-item--content')
    ?? row.querySelector('[role="gridcell"]');
  const listOf = (control: Element) => () => doc.getElementById(control.getAttribute('aria-controls') ?? '');
  return {
    widgetFor(control: Element): WidgetDecl | null {
      if (control.id === 'country') {
        const toggle = doc.getElementById('country-toggle-button')!;
        return { kind: 'combobox', opener: toggle, expanded: toggle, keys: ['Escape'], optionLabel,
          results: { list: listOf(control), option: '[role="row"]', choose: 'label' }, snapshot: 'synthetic grid' };
      }
      if (control.id === 'langs') {
        return { kind: 'multiselect', opener: control as HTMLElement, optionLabel,
          results: { list: listOf(control), option: '[role="row"]', choose: 'label' }, snapshot: 'synthetic grid' };
      }
      return null;
    },
  } as unknown as Adapter;
}

describe('item 1 (oracle-new-1): a declared list read and chosen by its declared rows', () => {
  it('reads a grid popup whole by its rows, chooses the planned row on its label part and reads it back', async () => {
    const page = await open(GRID, 'oracle', oracleAdapter);
    const field = page.target('Country');
    expect([field.field.kind, field.widget?.declared, isActionable(field.widget!)]).toEqual(['combobox', true, true]);
    expect(fillabilityOf(field.field, field.widget)).toEqual({ fillable: true });
    const read = await readWidget(page.target('Country'), page.ctx());
    // Three rows, each its label span's words: no gridcell or span is an option of its own.
    expect(labelsOf(read)).toEqual(['Canada', 'Mexico', 'United States']);
    expect(page.doc.getElementById('country-listbox')!.hidden).toBe(true);
    const value = { kind: 'option' as const, index: 2, cleanLabel: 'United States' };
    expect(await fillWidget(page.target('Country'), value, page.ctx()))
      .toEqual({ wrote: true, verification: 'verified', reason: 'ok', needsUserAction: false });
    // The click landed on the row's label part (choose 'label'), which the row's own listener took.
    expect(page.win<string[][]>('__clicks')).toEqual([['row-us', 'cx-select__list-item--content']]);
    expect((page.doc.getElementById('country') as HTMLInputElement).value).toBe('United States');
    expect(widgetHolds(page.target('Country'), value)).toBe(true);
    expectOurEventsOnly(page.events, true);
  });

  it('adds a multiselect\'s planned rows of a grid, each by its label part, and reads its chips back', async () => {
    const page = await open(GRID, 'oracle', oracleAdapter);
    expect(labelsOf(await readWidget(page.target('Languages'), page.ctx()))).toEqual(['English', 'French', 'Spanish']);
    const value = { kind: 'options' as const, indices: [0, 2], cleanLabels: ['English', 'Spanish'] };
    expect(await fillWidget(page.target('Languages'), value, page.ctx()))
      .toEqual({ wrote: true, verification: 'verified', reason: 'ok', needsUserAction: false });
    expect(page.win<string[][]>('__clicks')).toEqual([['lang-en', 'cx-select__list-item--content'],
      ['lang-es', 'cx-select__list-item--content']]);
    expect(page.target('Languages').field.current).toEqual({ kind: 'selected', labels: ['English', 'Spanish'] });
    expect(widgetHolds(page.target('Languages'), value)).toBe(true);
    // Its list, opened by our click, toggled shut by a second one.
    expect(page.doc.getElementById('langs-listbox')!.hidden).toBe(true);
    expectOurEventsOnly(page.events);
  });
});

// ── Item 3 (SR-1, SR-2, SR-6 core): SmartRecruiters' lists across shadow trees ────────────────────────────────────────

/** SmartRecruiters' widgets as SP\jr6\audit\smartrecruiters.md reads them (fixtures/smartrecruiters/xplor-screening.html
 *  and xplor-one-click.html's shapes, the texts synthetic), each built in shadow trees:
 * - a screening question (x-autocomplete): its text box in x-input's shadow root names by aria-controls a menu in
 *   x-autocomplete's shadow root (Node.getElementById cannot reach across); each row (x-option) chooses only on a click
 *   of its inner .item, two shadow roots down, never on its own; the box shows the chosen row's words;
 * - the phone's country (x-select, inside x-phone's shadow root): its rows are the host's own children, slotted into its
 *   menu; with data-variant "slow" on <html> they are drawn there one at a time once it opens, 60 ms apart.
 * window.__chosen: each row chosen, by its value. */
const SHADOWS = `<!doctype html><html><head><style>[hidden] { display: none !important; }</style></head><body>
<form id="f">
  <x-autocomplete id="q1"><template shadowrootmode="open">
    <x-input id="q1-input"><template shadowrootmode="open">
      <label for="q1-box">How did you first hear about us?</label>
      <input id="q1-box" type="text" role="combobox" aria-autocomplete="list" aria-haspopup="listbox"
        aria-expanded="false" aria-controls="menu-q1" autocomplete="off">
    </template></x-input>
    <div class="menu-wrap" hidden><div id="menu-q1" role="listbox"></div></div>
  </template></x-autocomplete>
  <x-phone id="phone"><template shadowrootmode="open">
    <x-select id="cc"><template shadowrootmode="open">
      <span id="cc-label">Country code</span>
      <button id="cc-button" type="button" role="combobox" aria-labelledby="cc-label" aria-expanded="false"
        aria-controls="cc-menu"><span id="cc-shown">United States</span></button>
      <div class="menu-wrap" hidden><div id="cc-menu" role="listbox"><slot></slot></div></div>
    </template></x-select>
  </template></x-phone>
</form>
<script>
  window.__chosen = [];
  const slow = document.documentElement.dataset.variant === 'slow';
  // A row as SmartRecruiters draws a spl-select-option: its words its own text, shown through two shadow roots, and the
  // element a click chooses on (.item, role=option) inside the inner one.
  function makeRow(value, label, choose) {
    const row = document.createElement('x-option');
    row.setAttribute('value', value);
    row.textContent = label;
    const item = document.createElement('x-item');
    item.append(document.createElement('slot'));
    row.attachShadow({ mode: 'open' }).append(item);
    const inner = document.createElement('div');
    inner.className = 'item';
    inner.setAttribute('role', 'option');
    inner.append(document.createElement('slot'));
    item.attachShadow({ mode: 'open' }).append(inner);
    inner.addEventListener('click', () => { window.__chosen.push(value); choose(label); });
    return row;
  }
  const ac = document.getElementById('q1').shadowRoot;
  const box = ac.getElementById('q1-input').shadowRoot.getElementById('q1-box');
  const menu = ac.getElementById('menu-q1');
  const openMenu = (yes) => { ac.querySelector('.menu-wrap').hidden = !yes; box.setAttribute('aria-expanded', String(yes)); };
  box.addEventListener('click', () => openMenu(true));
  box.addEventListener('focusout', () => openMenu(false));
  const pick = (label) => { box.value = label; openMenu(false); };
  [['a', 'LinkedIn'], ['b', 'Indeed'], ['c', 'Company website'], ['d', 'Other']]
    .forEach(([value, label]) => menu.append(makeRow(value, label, pick)));
  const select = document.getElementById('phone').shadowRoot.getElementById('cc');
  const sr = select.shadowRoot;
  const button = sr.getElementById('cc-button');
  const openSelect = (yes) => { sr.querySelector('.menu-wrap').hidden = !yes; button.setAttribute('aria-expanded', String(yes)); };
  const choose = (label) => { sr.getElementById('cc-shown').textContent = label; openSelect(false); };
  const COUNTRIES = [['CA', 'Canada'], ['MX', 'Mexico'], ['US', 'United States'], ['FR', 'France'], ['DE', 'Germany'],
    ['ES', 'Spain'], ['IT', 'Italy'], ['PT', 'Portugal'], ['IE', 'Ireland'], ['NL', 'Netherlands'], ['BE', 'Belgium'],
    ['AT', 'Austria']];
  let drawn = false;
  button.addEventListener('click', () => {
    openSelect(sr.querySelector('.menu-wrap').hidden);
    if (!slow || drawn) return;
    drawn = true;
    COUNTRIES.forEach(([value, label], at) => setTimeout(() => select.append(makeRow(value, label, choose)), 60 * (at + 1)));
  });
  if (!slow) COUNTRIES.slice(0, 3).forEach(([value, label]) => select.append(makeRow(value, label, choose)));
</script></body></html>`;

/** The element a choice of a row presses (WidgetResults.pressTarget): its .item two shadow roots down. */
const innerItem = (row: Element): HTMLElement | null =>
  row.shadowRoot?.querySelector('x-item')?.shadowRoot?.querySelector<HTMLElement>('.item') ?? null;

/** An id named from `el`, looked for in its own tree, then in each tree its hosts sit in (SR-1's aria-controls). */
function byIdAcross(el: Element, id: string): Element | null {
  for (let tree: Node | null = el.getRootNode(); tree !== null;) {
    const found = (tree as Document | ShadowRoot).getElementById?.(id) ?? null;
    if (found !== null) return found;
    tree = tree.nodeType === 11 ? (tree as ShadowRoot).host.getRootNode() : null;
  }
  return null;
}

/** SmartRecruiters' widgets as its adapter declares them (FIXPLAN §6.9 items 1 and 3): the screening question a
 *  combobox whose list the page publishes (knownOptions), its box's aria-controls resolved across shadow roots, its rows
 *  chosen on their inner item; the phone's country a combobox whose rows are its menu's slot's assigned elements. */
function srAdapter(options: { known?: boolean; order?: string[] } = {}): Adapter {
  return {
    widgetFor(control: Element): WidgetDecl | null {
      if (control.id === 'q1-box') {
        return { kind: 'combobox', opener: control as HTMLElement, expanded: control,
          ...(options.known === false ? {} : {
            knownOptions: options.order ?? ['LinkedIn', 'Indeed', 'Company website', 'Other'] }),
          results: { list: () => byIdAcross(control, control.getAttribute('aria-controls') ?? ''), option: 'x-option',
            pressTarget: innerItem }, snapshot: 'synthetic SR screening' };
      }
      if (control.id === 'cc-button') {
        return { kind: 'combobox', opener: control as HTMLElement, expanded: control, drawnWhole: true,
          results: { list: () => byIdAcross(control, 'cc-menu'), option: 'x-option',
            options: (list) => list.querySelector('slot')?.assignedElements({ flatten: true }) ?? [],
            pressTarget: innerItem }, snapshot: 'synthetic SR phone country' };
      }
      return null;
    },
  } as unknown as Adapter;
}

describe('item 3 (SR-1, SR-6 core): lists across shadow trees', () => {
  const QUESTION = 'How did you first hear about us?';

  it('plans a list the page publishes at once, and chooses its option by label on the inner item', async () => {
    const page = await open(SHADOWS, 'smartrecruiters', () => srAdapter());
    const target = page.target(QUESTION);
    // The page's own list is the field's reading at scan time: never 'lazy', planned on the first pass.
    expect([target.field.kind, optionLabels(target), target.widget?.knownFrom])
      .toEqual(['combobox', ['LinkedIn', 'Indeed', 'Company website', 'Other'], 'page']);
    expect(fillabilityOf(target.field, target.widget)).toEqual({ fillable: true });
    const value = { kind: 'option' as const, index: 1, cleanLabel: 'Indeed' };
    expect(await fillWidget(target, value, page.ctx()))
      .toEqual({ wrote: true, verification: 'verified', reason: 'ok', needsUserAction: false });
    expect(page.win<string[]>('__chosen')).toEqual(['b']);
    expect(widgetHolds(page.target(QUESTION), value)).toBe(true);
    expectOurEventsOnly(page.events);
  });

  it('finds a published option by its label where the page draws its list in another order', async () => {
    const page = await open(SHADOWS, 'smartrecruiters', () => srAdapter({ order: ['Other', 'LinkedIn', 'Indeed',
      'Company website'] }));
    expect(optionLabels(page.target(QUESTION))).toEqual(['Other', 'LinkedIn', 'Indeed', 'Company website']);
    // Planned at its place in the published list (index 2); drawn second in the page's own.
    expect(await fillWidget(page.target(QUESTION), { kind: 'option', index: 2, cleanLabel: 'Indeed' }, page.ctx()))
      .toEqual({ wrote: true, verification: 'verified', reason: 'ok', needsUserAction: false });
    expect(page.win<string[]>('__chosen')).toEqual(['b']);
  });

  it('reads the same list by opening it where the page publishes none, across its shadow roots', async () => {
    const page = await open(SHADOWS, 'smartrecruiters', () => srAdapter({ known: false }));
    expect(optionLabels(page.target(QUESTION))).toBe('lazy');
    expect(labelsOf(await readWidget(page.target(QUESTION), page.ctx())))
      .toEqual(['LinkedIn', 'Indeed', 'Company website', 'Other']);
    expect(await fillWidget(page.target(QUESTION), { kind: 'option', index: 3, cleanLabel: 'Other' }, page.ctx()))
      .toMatchObject({ wrote: true, verification: 'verified' });
    expect(page.win<string[]>('__chosen')).toEqual(['d']);
  });

  it('reads rows slotted into a list from their host, and chooses one on its inner item', async () => {
    const page = await open(SHADOWS, 'smartrecruiters', () => srAdapter());
    expect(labelsOf(await readWidget(page.target('Country code'), page.ctx())))
      .toEqual(['Canada', 'Mexico', 'United States']);
    expect(await fillWidget(page.target('Country code'), { kind: 'option', index: 1, cleanLabel: 'Mexico' }, page.ctx()))
      .toEqual({ wrote: true, verification: 'verified', reason: 'ok', needsUserAction: false });
    expect(page.win<string[]>('__chosen')).toEqual(['MX']);
    expect(page.target('Country code').field.current).toEqual({ kind: 'selected', labels: ['Mexico'] });
    expectOurEventsOnly(page.events);
  });

  it('watches rows drawn into a host inside a shadow tree as they come, so the list is read whole', async () => {
    const page = await open(SHADOWS.replace('<html>', '<html data-variant="slow">'), 'smartrecruiters',
      () => srAdapter());
    const read = await readWidget(page.target('Country code'), page.ctx());
    expect(labelsOf(read)).toHaveLength(12);
  });
});

/** A city search whose page asks for three characters at least (SmartRecruiters' minquerylength): window.__typed, each
 *  query typed. */
const CITY = `<!doctype html><html><head><style>[hidden] { display: none !important; }</style></head><body>
<form id="f">
  <label for="city">City</label>
  <input id="city" type="text" role="combobox" aria-autocomplete="list" aria-controls="city-list" aria-expanded="false">
  <ul id="city-list" role="listbox" hidden></ul>
</form>
<script>
  window.__typed = [];
  const city = document.getElementById('city');
  const list = document.getElementById('city-list');
  city.addEventListener('input', () => {
    window.__typed.push(city.value);
    const found = ['Austin', 'Boston', 'Denver'].filter((name) => name.toLowerCase().startsWith(city.value.toLowerCase()));
    list.replaceChildren(...found.map((name) => {
      const row = document.createElement('li');
      row.setAttribute('role', 'option');
      row.textContent = name;
      row.addEventListener('click', () => { city.value = name; list.hidden = true; });
      return row;
    }));
    list.hidden = found.length === 0;
  });
</script></body></html>`;

describe('item 3 (SR-2 core): the page\'s shortest query', () => {
  it('never types a query shorter than the widget declares; the next one is typed', async () => {
    const page = await open(CITY, 'smartrecruiters', (doc) => ({
      widgetFor: (control: Element) => (control.id === 'city' ? { kind: 'typeahead-remote', opener: control,
        results: { list: doc.getElementById('city-list')!, option: '[role="option"]' }, minQueryLength: 3,
        emptyAfterMs: 400, snapshot: 'synthetic SR city' } : null),
    }) as unknown as Adapter);
    const result = await searchTypeahead(page.target('City'), ['Au', 'Austin'], page.ctx(), {
      guard: async () => ({ ok: true, target: page.target('City') }),
      match: async (results) => {
        const index = results.findIndex((entry) => entry.label === 'Austin');
        return index < 0 ? { choose: null, reason: 'no-match', blocked: false } : { choose: { index, cleanLabel: 'Austin' } };
      },
    });
    expect(result).toMatchObject({ chosen: { cleanLabel: 'Austin' }, verified: true, typed: 1 });
    expect(page.win<string[]>('__typed')).toEqual(['Austin']);
  });
});
