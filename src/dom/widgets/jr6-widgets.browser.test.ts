/*
 * jr6 ENGINE E1 (FIXPLAN §6.2 items 1 to 5 and 12): the widget helpers on synthetic pages shaped as the jr6 audits
 * describe each platform's widget (SP\jr6\audit\oracle.md, icims.md, smartrecruiters.md, adp.md, ultipro.md), each
 * declared by a test adapter as its platform package will declare it (FIXPLAN §6.5, §6.6, §6.9 to §6.11), driven only
 * by calling the helpers:
 * - item 1 (oracle-new-1): a grid popup (role=grid > row > gridcell > label span), for a combobox and a multiselect:
 *   read whole by the declared rows, the planned row chosen by a click on its label part, read back;
 * - item 2 (ICIMS-01 core, icims-new-1): an anchor and a search box in a container drawn beside it (WidgetDecl.input):
 *   the box is the widget's part, never a field nor a counted control; a search opens the anchor first and types only
 *   into the box once a person can see it; a select-only anchor toggles shut;
 * - item 3 (SR-1, SR-2, SR-6 core): nested shadow roots with aria-controls across them and options slotted into the
 *   list (WidgetResults.options, pressTarget), the page's own list as the field's reading (WidgetDecl.knownOptions),
 *   rows that load into the host watched directly, and the page's shortest query (WidgetDecl.minQueryLength);
 * - item 4 (ADP-2, ADP-3, ADP-15 core): a shadow trigger with no ARIA list, its list a portal at the end of the body,
 *   its filter box in its shadow tree a part;
 * - item 5 (U-04 core): a free-text search (WidgetDecl.freeText): its typed text stands when nothing matches;
 * - item 12 (icims-new-2, O10): a combobox no adapter declares whose popup is a grid, or that has no list ARIA can find
 *   and no text box, is refused before any click; an activation that opened something with no list a reader finds is
 *   put back.
 * jr6 ENGINE E2 (the ICIMS package's edit 2, ICIMS-01/-02): a declared busy sign drawn beside the declared list (iCIMS's
 * .dropdown-loading, the list's sibling in its container's div[aria-live]) holds the widget's wait; one elsewhere, or a
 * generic sign there, does not.
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
import { closeUnlisted, fillWidget, isActionable, openList, readWidget, searchTypeahead, widgetHolds } from './index';
import { widgetBusy } from './options';
import type { TypeaheadHooks } from './index';

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

// ── Item 1 (oracle-new-1) and item 12 (O10): Oracle's cx-select, a grid popup ─────────────────────────────────────────

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

// ── Item 2 (ICIMS-01 core, icims-new-1) and item 12 (icims-new-2): iCIMS's dropdown, a box beside its anchor ─────────

/** iCIMS's dropdown as SP\jr6\audit\icims.md reads it (fixtures/icims/nyu-profile.frame-1.html's markup, its texts
 *  synthetic): a hidden select, an a.dropdown-select[role=combobox] anchor naming no list, and beside it a container
 *  whose search box ("— Type to Search —") names the results list. Country lists its rows whole once open (a
 *  placeholder row dropdown-index="-1" first); School searches a list as typed (icimsdropdown-search="1"). A click on
 *  the anchor toggles its container; a result's click chooses it (window.__chosen) and shuts it. With data-variant
 *  "deaf" on <html>, School's anchor answers a click (it marks itself) but never shows its container. */
const ICIMS = `<!doctype html><html><head><style>
  [hidden] { display: none !important; }
  .dropdown-select { display: inline-block; min-width: 200px; border: 1px solid #888; padding: 2px; }
  .dropdown-results { margin: 0; padding: 0; list-style: none; }
</style></head><body><form id="f">
  <div class="row">
    <label id="label_country" for="country">Country</label>
    <select id="country" class="dropdown-hide" style="display:none" icimsdropdown-enabled="1" icimsdropdown-ajax="1">
      <option value=""></option></select>
    <a id="country_icimsDropdown" class="dropdown-select" role="combobox" tabindex="0" aria-expanded="false"
      aria-labelledby="label_country"><span id="country_fakeSelected_icimsDropdown" class="dropdown-text"><span
      class="dropdown-placeholder">— Make a Selection —</span></span></a>
    <div id="country_icimsDropdown_ctnr" class="dropdown-container" aria-owns="country_dropdown-results" hidden>
      <input type="text" class="dropdown-search" autocomplete="off" placeholder="— Type to Search —" role="combobox"
        aria-autocomplete="list" aria-controls="country_dropdown-results">
      <ul id="country_dropdown-results" class="dropdown-results" role="listbox">
        <li class="dropdown-result result-selectable" role="option" dropdown-index="-1">— Make a Selection —</li>
        <li class="dropdown-result result-selectable" role="option" dropdown-index="0">Canada</li>
        <li class="dropdown-result result-selectable" role="option" dropdown-index="1">Mexico</li>
        <li class="dropdown-result result-selectable" role="option" dropdown-index="2">United States</li>
      </ul>
    </div>
  </div>
  <div class="row">
    <label id="label_school" for="school">School</label>
    <select id="school" class="dropdown-hide" style="display:none" icimsdropdown-enabled="1" icimsdropdown-ajax="1"
      icimsdropdown-search="1"><option value=""></option></select>
    <a id="school_icimsDropdown" class="dropdown-select" role="combobox" tabindex="0" aria-expanded="false"
      aria-labelledby="label_school"><span id="school_fakeSelected_icimsDropdown" class="dropdown-text"><span
      class="dropdown-placeholder">— Make a Selection —</span></span></a>
    <div id="school_icimsDropdown_ctnr" class="dropdown-container" aria-owns="school_dropdown-results" hidden>
      <input type="text" class="dropdown-search" autocomplete="off" placeholder="— Type to Search —" role="combobox"
        aria-autocomplete="list" aria-controls="school_dropdown-results">
      <ul id="school_dropdown-results" class="dropdown-results" role="listbox"></ul>
    </div>
  </div>
</form>
<script>
  window.__chosen = [];
  const SCHOOLS = ['Lakeside University', 'Lakeside Community College', 'Riverside College'];
  for (const id of ['country', 'school']) {
    const anchor = document.getElementById(id + '_icimsDropdown');
    const ctnr = document.getElementById(id + '_icimsDropdown_ctnr');
    const box = ctnr.querySelector('input.dropdown-search');
    const results = document.getElementById(id + '_dropdown-results');
    const shown = document.getElementById(id + '_fakeSelected_icimsDropdown');
    const open = (yes) => { ctnr.hidden = !yes; anchor.setAttribute('aria-expanded', String(yes)); };
    if (id === 'school' && document.documentElement.dataset.variant === 'deaf') {
      anchor.addEventListener('click', () => { anchor.dataset.clicked = String(Number(anchor.dataset.clicked ?? 0) + 1); });
    } else {
      anchor.addEventListener('click', () => open(ctnr.hidden));
    }
    results.addEventListener('click', (event) => {
      const row = event.target.closest('li.result-selectable');
      if (row === null || row.getAttribute('dropdown-index') === '-1') return;
      shown.replaceChildren(row.textContent);
      window.__chosen.push(row.textContent);
      open(false);
    });
    if (id === 'school') {
      box.addEventListener('input', () => {
        const query = box.value.toLowerCase();
        results.replaceChildren(...SCHOOLS.filter((name) => query !== '' && name.toLowerCase().includes(query))
          .map((name, at) => {
            const row = document.createElement('li');
            row.className = 'dropdown-result result-selectable';
            row.setAttribute('role', 'option');
            row.setAttribute('dropdown-index', String(at));
            row.textContent = name;
            return row;
          }));
      });
    }
  }
</script></body></html>`;

/** iCIMS's dropdowns as its adapter declares them (FIXPLAN §6.5 item 1): opener (and, but for School here, expanded)
 *  the anchor; `input` the search box of the container beside it; results the container's list, its placeholder row
 *  left out; the shown answer the anchor's fake-selected text (a .dropdown-placeholder: none); typeahead-remote for a
 *  search, else combobox; no activation. */
function icimsAdapter(doc: Document): Adapter {
  return {
    widgetFor(control: Element): WidgetDecl | null {
      if (!control.matches('a.dropdown-select[role="combobox"][id$="_icimsDropdown"]')) return null;
      const id = control.id.replace(/_icimsDropdown$/, '');
      const search = doc.getElementById(id)?.getAttribute('icimsdropdown-search') === '1';
      const box = doc.getElementById(`${id}_icimsDropdown_ctnr`)?.querySelector<HTMLInputElement>('input.dropdown-search');
      const shown = doc.getElementById(`${id}_fakeSelected_icimsDropdown`);
      return { kind: search ? 'typeahead-remote' : 'combobox', opener: control as HTMLElement,
        ...(search ? {} : { expanded: control }), ...(box ? { input: box } : {}),
        results: { list: () => doc.getElementById(`${id}_dropdown-results`),
          option: 'li.dropdown-result.result-selectable[role="option"]:not([dropdown-index="-1"])' },
        shownAnswer: () => (shown === null || shown.querySelector('.dropdown-placeholder') !== null ? null
          : shown.textContent?.trim() || null),
        emptyAfterMs: 600, snapshot: 'synthetic iCIMS dropdown' };
    },
  } as unknown as Adapter;
}

describe('item 2 (ICIMS-01 core, icims-new-1): a widget\'s own text box beside it (WidgetDecl.input)', () => {
  it('never makes the box a field, nor counts it, whether its container is shut or open', async () => {
    const page = await open(ICIMS, 'icims', icimsAdapter);
    const shut = page.scanned();
    expect(shut.fields.map((field) => [field.label, field.kind])).toEqual([['Country', 'combobox'],
      ['School', 'typeahead-remote']]);
    // The two hidden selects only: the hidden search boxes are the widgets' parts.
    expect(shut.counters.hiddenControlsIgnored).toBe(2);
    for (const id of ['country', 'school']) page.doc.getElementById(`${id}_icimsDropdown_ctnr`)!.hidden = false;
    const shown = page.scanned();
    expect(shown.fields.map((field) => field.label)).toEqual(['Country', 'School']);
    expect(shown.counters.hiddenControlsIgnored).toBe(2);
    // The field's facts are the anchor's: its label, never the box's placeholder.
    const country = page.target('Country');
    expect([country.field.labelSource, country.field.nameAttr, country.field.autocomplete]).toEqual(['aria-labelledby', '', []]);
    expect(country.widget!.input).toBe(page.doc.querySelector('#country_icimsDropdown_ctnr input'));
    // Without the declaration, the open boxes are fields of their own ("— Type to Search —"), the shut ones counted.
    const bare = await open(ICIMS, 'icims', () => null);
    expect(bare.scanned().counters.hiddenControlsIgnored).toBe(4);
    for (const id of ['country', 'school']) bare.doc.getElementById(`${id}_icimsDropdown_ctnr`)!.hidden = false;
    expect(bare.scanned().fields.filter((field) => field.label === '— Type to Search —')).toHaveLength(2);
  });

  it('reads a combobox\'s rows without its placeholder row, chooses one, and toggles its anchor shut', async () => {
    const page = await open(ICIMS, 'icims', icimsAdapter);
    expect(labelsOf(await readWidget(page.target('Country'), page.ctx()))).toEqual(['Canada', 'Mexico', 'United States']);
    // The list our click opened was toggled shut by a second click on the anchor: focusout and blur go to the box.
    expect(page.doc.getElementById('country_icimsDropdown_ctnr')!.hidden).toBe(true);
    expect(page.events.on('country_icimsDropdown').filter((event) => event.type === 'click')).toHaveLength(2);
    const value = { kind: 'option' as const, index: 1, cleanLabel: 'Mexico' };
    expect(await fillWidget(page.target('Country'), value, page.ctx()))
      .toEqual({ wrote: true, verification: 'verified', reason: 'ok', needsUserAction: false });
    expect(page.win<string[]>('__chosen')).toEqual(['Mexico']);
    expect(page.target('Country').field.current).toEqual({ kind: 'selected', labels: ['Mexico'] });
    expect(widgetHolds(page.target('Country'), value)).toBe(true);
    expectOurEventsOnly(page.events);
  });

  it('opens a search\'s anchor before typing into the box beside it, then chooses the result', async () => {
    const page = await open(ICIMS, 'icims', icimsAdapter);
    const box = page.doc.querySelector<HTMLInputElement>('#school_icimsDropdown_ctnr input')!;
    const hooks: TypeaheadHooks = {
      guard: async () => ({ ok: true, target: page.target('School') }),
      match: async (results) => {
        const index = results.findIndex((result) => result.label === 'Lakeside University');
        return index < 0 ? { choose: null, reason: 'no-match', blocked: false }
          : { choose: { index, cleanLabel: 'Lakeside University' } };
      },
    };
    const typedWhileShown: boolean[] = [];
    box.addEventListener('input', () => typedWhileShown.push(!page.doc.getElementById('school_icimsDropdown_ctnr')!.hidden));
    const result = await searchTypeahead(page.target('School'), ['Lakeside University'], page.ctx(), hooks);
    expect(result).toMatchObject({ chosen: { cleanLabel: 'Lakeside University' }, verified: true, reason: 'ok', typed: 1 });
    expect(typedWhileShown).toEqual([true]);
    expect(page.win<string[]>('__chosen')).toEqual(['Lakeside University']);
    expect(page.target('School').field.current).toEqual({ kind: 'selected', labels: ['Lakeside University'] });
    // The anchor's click opened the container, and only then was the box typed into.
    const ours = page.events.events.filter((event) => !event.trusted && ['click', 'input'].includes(event.type));
    expect(ours[0]).toMatchObject({ type: 'click', target: 'school_icimsDropdown' });
    expectOurEventsOnly(page.events);
  });

  it('never types into a box beside its widget that a person cannot see: needs-your-click, nothing typed', async () => {
    const page = await open(ICIMS.replace('<html>', '<html data-variant="deaf">'), 'icims', icimsAdapter);
    const box = page.doc.querySelector<HTMLInputElement>('#school_icimsDropdown_ctnr input')!;
    const result = await searchTypeahead(page.target('School'), ['Lakeside University'], page.ctx(), {
      guard: async () => ({ ok: true, target: page.target('School') }),
      match: async () => ({ choose: null, reason: 'no-match', blocked: false }),
    });
    expect(result).toMatchObject({ chosen: null, reason: 'needs-your-click', typed: 0 });
    expect(box.value).toBe('');
    // The anchor answered our one click, and its box stayed hidden: never typed into.
    expect(page.doc.getElementById('school_icimsDropdown')!.dataset.clicked).toBe('1');
    expect(page.events.events.filter((event) => event.type === 'input')).toEqual([]);
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

/** The same screening question declared on its host (a widget root) instead, its own text box two shadow roots down
 *  (WidgetDecl.input inside the element): as an adapter that takes spl-autocomplete itself for the widget would. */
function srHostAdapter(): Adapter {
  return {
    widgetRoots: (root: Element) => Array.from(root.querySelectorAll('x-autocomplete')),
    widgetFor(control: Element): WidgetDecl | null {
      if (control.localName !== 'x-autocomplete') return null;
      const box = control.shadowRoot!.getElementById('q1-input')!.shadowRoot!.getElementById('q1-box') as HTMLInputElement;
      return { kind: 'combobox', opener: box, expanded: box, input: box,
        knownOptions: ['LinkedIn', 'Indeed', 'Company website', 'Other'],
        results: { list: () => byIdAcross(box, box.getAttribute('aria-controls') ?? ''), option: 'x-option',
          pressTarget: innerItem }, snapshot: 'synthetic SR screening host' };
    },
  } as unknown as Adapter;
}

describe('item 3 (SR-1, SR-6 core): lists across shadow trees', () => {
  const QUESTION = 'How did you first hear about us?';

  it('makes a host declared as the widget one field, its own box two shadow roots down never one of its own', async () => {
    const page = await open(SHADOWS, 'smartrecruiters', () => srHostAdapter());
    const fields = page.scanned().fields.filter((field) => field.label === QUESTION);
    expect(fields).toHaveLength(1);
    const target = page.scanned().target(fields[0]!.key)!;
    // Labelled by its own box's label, the box being its own (inside it, across its shadow roots).
    expect([target.control.localName, target.field.labelSource, optionLabels(target)])
      .toEqual(['x-autocomplete', 'for', ['LinkedIn', 'Indeed', 'Company website', 'Other']]);
    expect(await fillWidget(target, { kind: 'option', index: 2, cleanLabel: 'Company website' }, page.ctx()))
      .toEqual({ wrote: true, verification: 'verified', reason: 'ok', needsUserAction: false });
    expect(page.win<string[]>('__chosen')).toEqual(['c']);
  });

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

// ── Item 4 (ADP-2, ADP-3, ADP-15 core): a shadow trigger, a body portal, a shadow filter box ─────────────────────────

/** ADP's sdf-select-simple as SP\jr6\audit\adp.md reads it (ADP-2, ADP-3; the texts synthetic): a host labelled by a
 *  label.qLabel[for] in its div.qMainDiv, its trigger a div[role=button] in its shadow root naming no list, its filter
 *  box (input#select-filter-input[role=combobox], "Enter text to filter your options") in its shadow root too, shown
 *  while it is open; its list drawn on a click as a portal at the end of the body (div.portal > [role=listbox] of
 *  x-select-item[role=option]), removed when a row is chosen or the trigger clicked again. With data-variant "role" on
 *  <html>, the host carries a role (the scanner meets it itself, no widget root needed). window.__chosen: each row. */
const PORTAL = `<!doctype html><html><head><style>
  [hidden] { display: none !important; }
  .portal { position: absolute; top: 300px; left: 20px; border: 1px solid #888; background: #fff; }
</style></head><body>
<form id="f">
  <div class="qMainDiv"><label class="qLabel" for="q7">How did you learn about this position?</label>
    <x-select-simple id="q7"><template shadowrootmode="open">
      <div class="trigger-button" role="button" tabindex="0" aria-expanded="false"><span id="selected-label">Select</span></div>
      <div class="input-frame" hidden><input id="select-filter-input" type="text" role="combobox"
        aria-label="Enter text to filter your options"></div>
    </template></x-select-simple></div>
</form>
<script>
  window.__chosen = [];
  const host = document.getElementById('q7');
  if (document.documentElement.dataset.variant === 'role') host.setAttribute('role', 'none');
  const sr = host.shadowRoot;
  const trigger = sr.querySelector('.trigger-button');
  const frame = sr.querySelector('.input-frame');
  let portal = null;
  const close = () => { portal?.remove(); portal = null; frame.hidden = true; trigger.setAttribute('aria-expanded', 'false'); };
  const open = () => {
    portal = document.createElement('div');
    portal.className = 'portal';
    const list = document.createElement('div');
    list.id = 'listbox';
    list.setAttribute('role', 'listbox');
    for (const label of ['Employee referral', 'Company website', 'LinkedIn', 'Other']) {
      const row = document.createElement('x-select-item');
      row.setAttribute('role', 'option');
      row.style.display = 'block';
      row.textContent = label;
      row.addEventListener('click', () => { window.__chosen.push(label); sr.getElementById('selected-label').textContent = label; close(); });
      list.append(row);
    }
    portal.append(list);
    document.body.append(portal);
    frame.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
  };
  trigger.addEventListener('click', () => (portal === null ? open() : close()));
</script></body></html>`;

/** ADP's lists as its adapter declares them (FIXPLAN §6.6 item 3): a widget root (unless `rooted` is false: then the
 *  host's own role brings it to the scanner); opener and expanded the shadow trigger; the list the newest shown
 *  listbox of a portal at the end of the body; the filter box its part; the shown answer the trigger's label; its label
 *  the qLabel naming it. */
function adpAdapter(doc: Document, rooted = true): Adapter {
  const shadowOf = (host: Element) => host.shadowRoot!;
  return {
    ...(rooted ? { widgetRoots: (root: Element) => Array.from(root.querySelectorAll('x-select-simple')) } : {}),
    widgetFor(control: Element): WidgetDecl | null {
      if (control.localName !== 'x-select-simple') return null;
      const trigger = shadowOf(control).querySelector<HTMLElement>('.trigger-button')!;
      return { kind: 'combobox', opener: trigger, expanded: trigger,
        parts: [shadowOf(control).getElementById('select-filter-input')!],
        results: { list: () => Array.from(doc.querySelectorAll('body > .portal [role="listbox"]'))
          .filter((list) => list.checkVisibility()).at(-1) ?? null, option: 'x-select-item[role="option"]' },
        shownAnswer: () => {
          const shown = shadowOf(control).getElementById('selected-label')?.textContent?.trim() ?? '';
          return shown === '' || shown === 'Select' ? null : shown;
        },
        snapshot: 'synthetic ADP select' };
    },
    labelFor: (control: Element) => (control.localName === 'x-select-simple'
      ? doc.querySelector(`label.qLabel[for="${control.id}"]`) : null),
  } as unknown as Adapter;
}

describe('item 4 (ADP-2, ADP-3, ADP-15 core): a shadow trigger with a body portal and a shadow filter box', () => {
  const QUESTION = 'How did you learn about this position?';

  it('acts on a declared combobox whose trigger names no list, reading its portal list and choosing from it', async () => {
    const page = await open(PORTAL, 'adp', (doc) => adpAdapter(doc));
    const target = page.target(QUESTION);
    expect([target.field.kind, target.widget?.declared, isActionable(target.widget!)]).toEqual(['combobox', true, true]);
    expect(fillabilityOf(target.field, target.widget)).toEqual({ fillable: true });
    expect(labelsOf(await readWidget(target, page.ctx())))
      .toEqual(['Employee referral', 'Company website', 'LinkedIn', 'Other']);
    // The portal our click drew is gone again: the trigger toggled it shut.
    expect(page.doc.querySelectorAll('.portal')).toHaveLength(0);
    const value = { kind: 'option' as const, index: 2, cleanLabel: 'LinkedIn' };
    expect(await fillWidget(page.target(QUESTION), value, page.ctx()))
      .toEqual({ wrote: true, verification: 'verified', reason: 'ok', needsUserAction: false });
    expect(page.win<string[]>('__chosen')).toEqual(['LinkedIn']);
    expect(page.target(QUESTION).field.current).toEqual({ kind: 'selected', labels: ['LinkedIn'] });
    expect(widgetHolds(page.target(QUESTION), value)).toBe(true);
    expectOurEventsOnly(page.events);
  });

  it('never makes its shadow filter box a field, whether the scanner meets the host as a root or by its role', async () => {
    for (const rooted of [true, false]) {
      const html = rooted ? PORTAL : PORTAL.replace('<html>', '<html data-variant="role">');
      const page = await open(html, 'adp', (doc) => adpAdapter(doc, rooted));
      // The filter box shown, as it is while the list is open.
      page.doc.getElementById('q7')!.shadowRoot!.querySelector<HTMLElement>('.input-frame')!.hidden = false;
      const fields = page.scanned().fields;
      expect(fields.map((field) => [field.label, field.kind]), `rooted: ${rooted}`).toEqual([[QUESTION, 'combobox']]);
      removeFixtures(document);
    }
  });
});

// ── Item 5 (U-04 core): a free-text search ────────────────────────────────────────────────────────────────────────

/** UltiPro's School Name as SP\jr6\audit\ultipro.md reads it (fixtures/ultipro/resume-review.html: an
 *  input[role=combobox].tt-input in a span.twitter-typeahead, its suggestions .tt-suggestion in the sibling
 *  .tt-menu[role=listbox]; the texts synthetic): each typed text lists the schools containing it, else "No matches";
 *  a suggestion's click takes its words; the menu hides when the box is left, which keeps its text. window.__changes:
 *  the box's change events. */
const FREE = `<!doctype html><html><head><style>[hidden] { display: none !important; }</style></head><body>
<form id="f">
  <label for="school">School Name</label>
  <span class="twitter-typeahead">
    <input id="school" class="tt-input" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false"
      aria-owns="school-menu" autocomplete="off">
    <div id="school-menu" class="tt-menu" role="listbox" hidden><div class="tt-dataset"></div></div>
  </span>
</form>
<script>
  window.__changes = 0;
  const SCHOOLS = ['Lakeside University', 'Riverside College', 'Hillcrest Institute'];
  const box = document.getElementById('school');
  const menu = document.getElementById('school-menu');
  const dataset = menu.querySelector('.tt-dataset');
  box.addEventListener('change', () => { window.__changes += 1; });
  box.addEventListener('input', () => {
    const query = box.value.trim().toLowerCase();
    const found = SCHOOLS.filter((name) => query !== '' && name.toLowerCase().includes(query));
    dataset.replaceChildren(...(found.length === 0 ? [Object.assign(document.createElement('div'),
      { className: 'tt-empty', textContent: 'No matches' })] : found.map((name) => {
      const row = document.createElement('div');
      row.className = 'tt-suggestion';
      row.textContent = name;
      row.addEventListener('click', () => { box.value = name; menu.hidden = true; });
      return row;
    })));
    menu.hidden = query === '';
    box.setAttribute('aria-expanded', String(!menu.hidden));
  });
  box.addEventListener('focusout', () => { menu.hidden = true; box.setAttribute('aria-expanded', 'false'); });
</script></body></html>`;

/** UltiPro's typeaheads as its adapter declares them (FIXPLAN §6.10 item 3): typeahead-remote, results the sibling menu
 *  and its .tt-suggestion rows, emptyAfterMs, and free text for School (unless `free` is false). */
function ultiproAdapter(doc: Document, free = true): Adapter {
  return {
    widgetFor: (control: Element) => (control.id === 'school' ? { kind: 'typeahead-remote', opener: control,
      results: { list: doc.getElementById('school-menu')!, option: '.tt-suggestion' }, emptyAfterMs: 400,
      ...(free ? { freeText: true } : {}), snapshot: 'synthetic UltiPro school' } : null),
  } as unknown as Adapter;
}

describe('item 5 (U-04 core): a search whose typed text stands where nothing matches (WidgetDecl.freeText)', () => {
  const SCHOOL = 'Northgate Community College';
  /** Hooks that choose a listed school whose words are the query's, as the worker's fill band does; `refuse` refuses
   *  every guard from that call on (1-based). */
  function hooks(page: Page, refuse = Infinity): TypeaheadHooks & { guards: string[] } {
    const guards: string[] = [];
    return {
      guards,
      guard: async (query) => {
        guards.push(query);
        return guards.length >= refuse ? { ok: false, reason: 'canary-in-value', blocked: true }
          : { ok: true, target: page.target('School Name') };
      },
      match: async (results) => {
        const index = results.findIndex((result) => result.label === 'Lakeside University');
        return index < 0 ? { choose: null, reason: 'no-match', blocked: false }
          : { choose: { index, cleanLabel: 'Lakeside University' } };
      },
    };
  }

  it('keeps the planner\'s first query in the box when no result matches, committed and read back', async () => {
    const page = await open(FREE, 'ultipro', (doc) => ultiproAdapter(doc));
    const used = hooks(page);
    const result = await searchTypeahead(page.target('School Name'), [SCHOOL, 'Northgate College'], page.ctx(), used);
    expect(result).toEqual({ chosen: null, verified: true, reason: 'ok', blocked: false, typed: 2, freeText: SCHOOL });
    const box = page.doc.getElementById('school') as HTMLInputElement;
    expect(box.value).toBe(SCHOOL);
    // The second query was in the box: the first is typed again, a guarded write as each query is.
    expect(used.guards).toEqual([SCHOOL, 'Northgate College', SCHOOL]);
    expect(page.win<number>('__changes')).toBe(1);
    expect(page.doc.getElementById('school-menu')!.hidden).toBe(true);
    expect(widgetHolds(page.target('School Name'), { kind: 'text', text: SCHOOL })).toBe(true);
    expect(widgetHolds(page.target('School Name'), { kind: 'text', text: 'Northgate College' })).toBe(false);
    expectOurEventsOnly(page.events);
  });

  it('chooses a result that matches as any search does, with no free text', async () => {
    const page = await open(FREE, 'ultipro', (doc) => ultiproAdapter(doc));
    const result = await searchTypeahead(page.target('School Name'), ['Lakeside'], page.ctx(), hooks(page));
    expect(result).toMatchObject({ chosen: { cleanLabel: 'Lakeside University' }, verified: true, reason: 'ok' });
    expect(result.freeText).toBeUndefined();
    expect((page.doc.getElementById('school') as HTMLInputElement).value).toBe('Lakeside University');
  });

  it('puts the box back where a guard refuses, where it is no free-text search, or where the caller says so', async () => {
    const refused = await open(FREE, 'ultipro', (doc) => ultiproAdapter(doc));
    // The free text's own guard refuses it: blocked, the box as it was.
    expect(await searchTypeahead(refused.target('School Name'), [SCHOOL, 'Northgate College'], refused.ctx(),
      hooks(refused, 3))).toMatchObject({ chosen: null, reason: 'canary-in-value', blocked: true });
    expect((refused.doc.getElementById('school') as HTMLInputElement).value).toBe('');
    removeFixtures(document);
    const plain = await open(FREE, 'ultipro', (doc) => ultiproAdapter(doc, false));
    expect(await searchTypeahead(plain.target('School Name'), [SCHOOL], plain.ctx(), hooks(plain)))
      .toMatchObject({ chosen: null, reason: 'no-match', blocked: false });
    expect((plain.doc.getElementById('school') as HTMLInputElement).value).toBe('');
    removeFixtures(document);
    const option = await open(FREE, 'ultipro', (doc) => ultiproAdapter(doc));
    const result = await searchTypeahead(option.target('School Name'), [SCHOOL], option.ctx(), hooks(option), undefined,
      { freeText: false });
    expect(result).toMatchObject({ chosen: null, reason: 'no-match' });
    expect(result.freeText).toBeUndefined();
    expect((option.doc.getElementById('school') as HTMLInputElement).value).toBe('');
  });
});

describe('item 12 (icims-new-2, O10): an undeclared combobox the helpers refuse before any click', () => {
  it('refuses an anchor no adapter declares, with no list ARIA can find and no text box: no click at all', async () => {
    const page = await open(ICIMS, 'icims', () => null);
    const anchor = page.target('Country');
    expect([anchor.field.kind, anchor.widget?.input, isActionable(anchor.widget!)]).toEqual(['combobox', null, false]);
    expect(fillabilityOf(anchor.field, anchor.widget)).toEqual({ fillable: false, reason: 'widget-phase-4' });
    expect(await readWidget(anchor, page.ctx())).toEqual({ status: 'unread', reason: 'widget-unsupported' });
    expect(await fillWidget(page.target('Country'), { kind: 'option', index: 0, cleanLabel: 'Canada' }, page.ctx()))
      .toMatchObject({ wrote: false, reason: 'widget-unsupported' });
    expect(page.events.events.filter((event) => !event.trusted)).toEqual([]);
    expect(page.doc.getElementById('country_icimsDropdown_ctnr')!.hidden).toBe(true);
  });

  it('refuses a grid popup no adapter declares: no click, no remote search, widget-phase-4', async () => {
    const page = await open(GRID, 'oracle', () => null);
    const target = page.target('Country');
    expect([target.field.kind, target.widget?.declared, isActionable(target.widget!)]).toEqual(['combobox', false, false]);
    expect(fillabilityOf(target.field, target.widget)).toEqual({ fillable: false, reason: 'widget-phase-4' });
    expect(await readWidget(target, page.ctx())).toEqual({ status: 'unread', reason: 'widget-unsupported' });
    expect(await fillWidget(page.target('Country'), { kind: 'option', index: 0, cleanLabel: 'Canada' }, page.ctx()))
      .toMatchObject({ wrote: false, reason: 'widget-unsupported' });
    // Never read as a remote search: the field stays a combobox, and nothing reached the page.
    expect(page.target('Country').field.kind).toBe('combobox');
    expect(page.readings.size).toBe(0);
    expect(page.events.events.filter((event) => !event.trusted)).toEqual([]);
  });

  /** Two comboboxes whose popup holds no list (a dialog): a text box that shows its dialog on a click and hides it on
   *  focusout, and a select-only one whose dialog its click toggles. */
  const POPUPS = `<!doctype html><html><head><style>[hidden] { display: none !important; }</style></head><body>
  <form id="f">
    <label for="when">Start date</label>
    <input id="when" type="text" role="combobox" aria-haspopup="dialog" aria-expanded="false" aria-controls="when-dialog">
    <div id="when-dialog" role="dialog" hidden><p>Pick a day</p></div>
    <span id="kind-label">Kind</span>
    <div id="kind" role="combobox" tabindex="0" aria-labelledby="kind-label" aria-expanded="false" aria-controls="kind-pop">Pick</div>
    <div id="kind-pop" role="dialog" hidden><p>No list here</p></div>
  </form>
  <script>
    const when = document.getElementById('when');
    const dialog = document.getElementById('when-dialog');
    when.addEventListener('click', () => { dialog.hidden = false; when.setAttribute('aria-expanded', 'true'); });
    when.addEventListener('focusout', () => { dialog.hidden = true; when.setAttribute('aria-expanded', 'false'); });
    const kind = document.getElementById('kind');
    const pop = document.getElementById('kind-pop');
    kind.addEventListener('click', () => { pop.hidden = !pop.hidden; kind.setAttribute('aria-expanded', String(!pop.hidden)); });
  </script></body></html>`;

  it('puts back what an activation opened with no list a reader finds: a second click, or the box left', async () => {
    const page = await open(POPUPS, 'lever', () => null);
    expect(await readWidget(page.target('Kind'), page.ctx())).toEqual({ status: 'unread', reason: 'widget-unsupported' });
    expect(page.doc.getElementById('kind-pop')!.hidden).toBe(true);
    expect(page.events.on('kind').filter((event) => !event.trusted).map((event) => event.type)).toEqual(['click', 'click']);
    expect(await readWidget(page.target('Start date'), page.ctx()))
      .toEqual({ status: 'unread', reason: 'widget-unsupported' });
    expect(page.doc.getElementById('when-dialog')!.hidden).toBe(true);
    expect(page.events.on('when').filter((event) => !event.trusted).map((event) => event.type))
      .toEqual(['click', 'focusout', 'blur']);
    // fillWidget's path puts it back the same way.
    page.readings.set(page.target('Kind').field.baseKey, { kind: 'options', multiselectable: false, complete: true,
      options: [{ label: 'Full time', disabled: false }] });
    expect(await fillWidget(page.target('Kind'), { kind: 'option', index: 0, cleanLabel: 'Full time' }, page.ctx()))
      .toMatchObject({ wrote: false, reason: 'widget-unsupported' });
    expect(page.doc.getElementById('kind-pop')!.hidden).toBe(true);
    expectOurEventsOnly(page.events);
  });

  it('is widget-phase-4 to the expectations\' testkit whatever its kind (a refused multiselect included)', async () => {
    const page = await open(`<!doctype html><body><form id="f">
      <label for="tags">Tags</label>
      <input id="tags" type="text" role="combobox" aria-haspopup="grid" aria-controls="tags-list">
      <ul id="tags-list" role="listbox" aria-multiselectable="true" hidden><li role="option">One</li></ul>
    </form></body>`, 'lever', () => null);
    const target = page.target('Tags');
    expect([target.field.kind, isActionable(target.widget!)]).toEqual(['multiselect', false]);
    expect(fillabilityOf(target.field, target.widget)).toEqual({ fillable: false, reason: 'widget-phase-4' });
    expect(await fillWidget(target, { kind: 'options', indices: [0], cleanLabels: ['One'] }, page.ctx()))
      .toMatchObject({ wrote: false, reason: 'widget-unsupported' });
  });

  it('sends nothing to put back a widget that says it is shut', async () => {
    const page = await open(POPUPS, 'lever', () => null);
    const opened = await openList(page.target('Kind').widget!, page.ctx());
    expect(opened).toMatchObject({ open: false, reason: 'no-list', activated: true });
    // The page shut it itself meanwhile, and says so: nothing more is clicked.
    page.doc.getElementById('kind')!.click();
    page.events.events.length = 0;
    await closeUnlisted(page.target('Kind').widget!, page.ctx());
    expect(page.events.events.filter((event) => !event.trusted)).toEqual([]);
  });
});

// ── jr6 ENGINE E2 (the ICIMS package's edit 2, ICIMS-01/-02): a declared busy sign beside the declared list ──────────

describe('jr6 E2 (ICIMS edit 2): a declared busy sign beside the declared list holds the wait', () => {
  /** iCIMS's dropdowns as above, with their loading bar declared (WidgetDecl.busy), as the ICIMS package does. */
  const loading = (doc: Document): Adapter => {
    const base = icimsAdapter(doc);
    return { widgetFor: (control: Element) => {
      const declared = base.widgetFor!(control);
      return declared === null ? null : { ...declared, busy: ['.dropdown-loading:not(.hide)'] };
    } } as unknown as Adapter;
  };

  /** Country's container opened, its list wrapped in iCIMS's div[aria-live] beside its loading bar (shown unless
   *  `hidden`); `place` moves the bar elsewhere. */
  async function country(change: (doc: Document) => void = () => undefined, declared = loading) {
    const page = await open(ICIMS, 'icims', declared);
    const doc = page.doc;
    const list = doc.getElementById('country_dropdown-results')!;
    const live = doc.createElement('div');
    live.setAttribute('aria-live', 'polite');
    const bar = doc.createElement('div');
    bar.id = 'bar';
    bar.className = 'dropdown-loading';
    bar.textContent = 'Loading';
    list.replaceWith(live);
    live.append(bar, list);
    doc.getElementById('country_icimsDropdown_ctnr')!.hidden = false;
    change(doc);
    const widget = page.target('Country').widget!;
    return widgetBusy(widget, list);
  }

  it('reads the loading bar beside the list as the widget’s, while it shows', async () => {
    expect(await country()).toBe(true);
    removeFixtures(document);
    expect(await country((doc) => {
      doc.getElementById('bar')!.classList.add('hide');
    })).toBe(false);
  });

  it('never reads a bar elsewhere in the form, a generic sign beside the list, or a sign of no declaration', async () => {
    // The same bar in the row, beside the anchor's hidden select: outside the list's container.
    expect(await country((doc) => {
      doc.getElementById('country')!.before(doc.getElementById('bar')!);
    })).toBe(false);
    removeFixtures(document);
    // A generic aria-busy beside the list, the declared bar gone: only the adapter's own selectors are read there.
    expect(await country((doc) => {
      const bar = doc.getElementById('bar')!;
      bar.className = '';
      bar.setAttribute('aria-busy', 'true');
    })).toBe(false);
    removeFixtures(document);
    // A widget that declares no busy sign.
    expect(await country(() => undefined, icimsAdapter)).toBe(false);
  });
});
