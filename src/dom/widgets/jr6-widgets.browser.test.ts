/*
 * jr6 ENGINE E1 (FIXPLAN §6.2 item 1): the widget helpers on synthetic pages shaped as the jr6 audits
 * describe each platform's widget (SP\jr6\audit\oracle.md, icims.md, smartrecruiters.md, adp.md, ultipro.md), each
 * declared by a test adapter as its platform package will declare it (FIXPLAN §6.5, §6.6, §6.9 to §6.11), driven only
 * by calling the helpers:
 * - item 1 (oracle-new-1): a grid popup (role=grid > row > gridcell > label span), for a combobox and a multiselect:
 *   read whole by the declared rows, the planned row chosen by a click on its label part, read back;
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
import { fillWidget, isActionable, readWidget, widgetHolds } from './index';

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
