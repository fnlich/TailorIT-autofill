/*
 * iCIMS's own dropdowns and their native selects (the core pass of 2026-11-06, CORE-BLOCKERS item 4: "where the markup
 * shows a native <select> that the form submits, fill the native select"). Every iCIMS dropdown in the owner's
 * snapshots (a.dropdown-select[role=combobox] over select[icimsdropdown-enabled="1"].dropdown-hide, its list loaded from
 * the server: icimsdropdown-ajax="1") keeps one option in its native select at most: the answer it holds, never the
 * list a person chooses from. The raw snapshots say the same (61 such selects on 7 portals, each with one option), so
 * no native select of an iCIMS dropdown is there to fill; the selects iCIMS draws natively (icimsdropdown-enabled="0")
 * are fields filled as any select is.
 * jr6 ICIMS-01 (FIXPLAN §6.5 item 1; the owner's snapshot6 of 2026-11-10, where Jobright drove these dropdowns): the
 * adapter declares each dropdown a widget (src/adapters/icims widgetFor), so it is the widget helpers', no longer the
 * person's: its trigger opens it, its container's search box takes a query, its list's results are read and chosen, its
 * loading bar is its busy sign and its trigger's text its answer. A remote search where its select says
 * icimsdropdown-search="1", a list read whole otherwise; careers-ars's address lookup (ICIMS-08) always the latter; the
 * gate's Country Code a list drawn whole (ICIMS-18). The fixtures' lists are redacted, so the lists read here are
 * SYNTHETIC public words (countries) drawn into a fixture's list. A driven dropdown's outcome (a run opening, reading and
 * choosing, after ENGINE E1 to E3) is held by jr6-icims.browser.test.ts' P2 section.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { loadFixture, removeFixtures } from '../../dom/fixture.testkit';
import { newScanCache } from '../../dom/scan-cache';
import { scan } from '../../dom/scan';
import { shownOptions, widgetListOf } from '../../dom/widgets';
import { SNAPSHOT_VIEWPORT } from '../test/expectations.testkit';
import { icimsAdapter } from './index';

const PAGES = import.meta.glob('../../../fixtures/icims/*.html', { query: '?raw', import: 'default', eager: true }) as
  Record<string, string>;

const byFile = (file: string): string => Object.entries(PAGES).find(([path]) => path.endsWith(`/${file}.html`))?.[1] ?? '';

/** Each committed iCIMS page's selects, as its markup holds them. */
function selectsOf(html: string): HTMLSelectElement[] {
  return Array.from(new DOMParser().parseFromString(html, 'text/html').querySelectorAll('select'));
}

/** The words of each result a declared list's option selector names. (The widget helpers' own reading of an open
 *  profile dropdown, shownOptions, reads them too since ENGINE E2 (the ICIMS package's edit 1: a container drawn
 *  absolutely is not cut by its static overflow-hidden cell): asserted below and in jr6-icims.browser.test.ts.) */
function resultsOf(list: Element, option: string): string[] {
  return Array.from(list.querySelectorAll(option)).map((el) => (el.textContent ?? '').trim());
}

/** SYNTHETIC public words for a redacted list. */
const COUNTRIES = ['United States', 'Canada', 'Mexico', 'United Kingdom'];

afterEach(() => removeFixtures(document));

describe("iCIMS's dropdowns (the owner's snapshots of 2026-11-06 and 2026-11-10)", () => {
  it('keep no list in their native select: one option at most, the select hidden behind the dropdown', () => {
    const dropdowns = Object.entries(PAGES).flatMap(([path, html]) => selectsOf(html)
      .filter((select) => select.getAttribute('icimsdropdown-enabled') === '1').map((select) => ({ path, select })));
    expect(dropdowns.length).toBeGreaterThan(10);
    for (const { path, select } of dropdowns) {
      expect(select.options.length, `${path} ${select.id}`).toBeLessThanOrEqual(1);
      expect(select.classList.contains('dropdown-hide'), `${path} ${select.id}`).toBe(true);
      expect(select.getAttribute('icimsdropdown-ajax'), `${path} ${select.id}`).toBe('1');
    }
  });

  it('draw the rest as native selects that hold their list (filled as any select is)', () => {
    const natives = Object.entries(PAGES).flatMap(([path, html]) => selectsOf(html)
      .filter((select) => select.getAttribute('icimsdropdown-enabled') === '0').map((select) => ({ path, select })));
    expect(natives.length).toBeGreaterThan(10);
    for (const { path, select } of natives) {
      expect(select.classList.contains('dropdown-hide'), `${path} ${select.id}`).toBe(false);
      expect(select.options.length, `${path} ${select.id}`).toBeGreaterThan(1);
    }
  });
});

describe('jr6 ICIMS-01: each dropdown declared a widget (widgetFor)', () => {
  const PROFILES = ['jr6-ars-profile', 'jr6-ars-profile-address', 'jr6-ars-profile-filled', 'jr6-sentinel-profile.frame-1',
    'jr6-sentinel-profile-filled.frame-1', 'jr6-nyu-profile-parsed.frame-1', 'jr6-nyu-profile-filled.frame-1',
    'nyu-profile.frame-1', 'githubinc-profile.frame-1'];

  it.each(PROFILES)('%s: every trigger, by its select’s words, its container and its list', async (name) => {
    const fixture = await loadFixture(document, byFile(name), SNAPSHOT_VIEWPORT);
    const doc = fixture.doc;
    const anchors = Array.from(doc.querySelectorAll<HTMLElement>('a.dropdown-select[id$="_icimsDropdown"]'));
    expect(anchors.length).toBeGreaterThan(1);
    for (const anchor of anchors) {
      const id = anchor.id.slice(0, -'_icimsDropdown'.length);
      const select = doc.getElementById(id)!;
      const decl = icimsAdapter.widgetFor!(anchor)!;
      const lookup = id.endsWith('PersonProfileFields.AddressStreet1');
      expect(decl.kind, id).toBe(select.getAttribute('icimsdropdown-search') === '1' && !lookup ? 'typeahead-remote' : 'combobox');
      expect([decl.opener, decl.expanded, decl.activation], id).toEqual([anchor, anchor, undefined]);
      expect(decl.input, id).toBe(doc.getElementById(`${id}_icimsDropdown_ctnr`)!.querySelector('input.dropdown-search'));
      const list = decl.results!.list as () => Element | null;
      expect(list(), id).toBe(doc.getElementById(`${id}_dropdown-results`));
      expect(decl.busy, id).toEqual(['.dropdown-loading:not(.hide)']);
      expect(decl.drawnWhole, id).toBeUndefined();
      const prompt = doc.getElementById(`${id}_fakeSelected_icimsDropdown`)!.querySelector('.dropdown-placeholder') !== null;
      const shown = decl.shownAnswer!([]);
      expect(prompt ? shown === '' : shown !== '', id).toBe(true);
    }
    // The select behind it, or any other control: none.
    for (const other of [doc.querySelector('select.dropdown-hide')!, doc.querySelector('input#cp_form_submit_i')!]) {
      expect(icimsAdapter.widgetFor!(other)).toBeNull();
    }
    // Its select gone (other markup): no widget.
    const anchor = anchors[0]!;
    doc.getElementById(anchor.id.slice(0, -'_icimsDropdown'.length))!.remove();
    expect(icimsAdapter.widgetFor!(anchor)).toBeNull();
  });

  /** Draws `labels` as the dropdown's results, after its prompt (dropdown-index -1), and opens its container, as the page
   *  does once a person opens it. `index`: the results' own dropdown-index, else their place. */
  function drawList(doc: Document, id: string, labels: readonly string[], index?: number): HTMLElement {
    const list = doc.getElementById(`${id}_dropdown-results`)!;
    const item = (text: string, at: number) => {
      const li = doc.createElement('li');
      li.id = `result-selectable_${id}_${at}`;
      li.className = 'dropdown-result result-selectable';
      li.setAttribute('role', 'option');
      li.setAttribute('dropdown-index', String(at));
      li.textContent = text;
      return li;
    };
    list.replaceChildren(item('Make a Selection', -1), ...labels.map((text, at) => item(text, index ?? at)));
    doc.getElementById(`${id}_icimsDropdown_ctnr`)!.classList.remove('dropdown-invisible');
    return list;
  }

  it('reads a list once opened, the prompt aside, and the answer its trigger shows', async () => {
    const fixture = await loadFixture(document, byFile('jr6-ars-profile'), SNAPSHOT_VIEWPORT);
    const doc = fixture.doc;
    const id = '-1_PersonProfileFields.AddressCountry';
    const anchor = doc.getElementById(`${id}_icimsDropdown`)!;
    const list = drawList(doc, id, COUNTRIES);
    const scanned = scan(icimsAdapter.detect(doc)!.formRoot, icimsAdapter, { platform: 'icims' });
    const field = scanned.fields.find((each) => scanned.target(each.key)?.control === anchor)!;
    const widget = scanned.target(field.key)!.widget!;
    expect([field.kind, field.label, field.required, widget.declared]).toEqual(['typeahead-remote', 'Country', true, true]);
    expect(widgetListOf(widget)).toBe(list);
    expect(resultsOf(list, widget.results!.option)).toEqual(COUNTRIES);
    // jr6 P2 (ENGINE E2, the ICIMS package's edit 1): the widget helpers read the open list as a person sees it.
    expect(shownOptions(list, newScanCache(), undefined, widget.results!.option).map((option) => option.label))
      .toEqual(COUNTRIES);
    // The page shows the chosen country in the trigger once a result is clicked.
    doc.getElementById(`${id}_fakeSelected_icimsDropdown`)!.replaceChildren('Canada');
    expect(widget.shownAnswer!(COUNTRIES)).toBe('Canada');
  });

  it('reads careers-ars’s address lookup whole: its "Enter manually" result (ICIMS-08)', async () => {
    const fixture = await loadFixture(document, byFile('jr6-ars-profile'), SNAPSHOT_VIEWPORT);
    const doc = fixture.doc;
    const id = '-1_PersonProfileFields.AddressStreet1';
    const anchor = doc.getElementById(`${id}_icimsDropdown`)!;
    expect(icimsAdapter.widgetFor!(anchor)!.kind).toBe('combobox');
    const list = drawList(doc, id, ['Enter manually'], -2);
    const scanned = scan(icimsAdapter.detect(doc)!.formRoot, icimsAdapter, { platform: 'icims' });
    const field = scanned.fields.find((each) => scanned.target(each.key)?.control === anchor)!;
    expect([field.kind, field.label]).toEqual(['combobox', 'Address']);
    const widget = scanned.target(field.key)!.widget!;
    expect(widgetListOf(widget)).toBe(list);
    expect(resultsOf(list, widget.results!.option)).toEqual(['Enter manually']);
  });

  it('declares the gate’s Country Code, its list drawn whole, the prompt aside (ICIMS-18)', async () => {
    const fixture = await loadFixture(document, byFile('ars-gate-phone'), SNAPSHOT_VIEWPORT);
    const doc = fixture.doc;
    const anchor = doc.querySelector<HTMLElement>('a#dropdown')!;
    const decl = icimsAdapter.widgetFor!(anchor)!;
    const container = doc.getElementById('dropdownOptions')!;
    expect([decl.kind, decl.opener, decl.expanded, decl.drawnWhole]).toEqual(['combobox', anchor, anchor, true]);
    expect(decl.input).toBe(doc.getElementById('countryCode'));
    expect(decl.results!.list).toBe(doc.getElementById('dropdownResults'));
    expect(decl.shownAnswer!([])).toBe('');
    container.classList.remove('hidden');
    // Its list is the public dial codes, drawn whole in the capture; the widget helpers read the part in view.
    const list = container.querySelector('ul')!;
    expect(resultsOf(list, decl.results!.option).length).toBeGreaterThan(200);
    const shown = shownOptions(list, newScanCache(), undefined, decl.results!.option);
    expect(shown.length).toBeGreaterThan(10);
    expect(shown[0]!.label).toBe('(+1) United States');
    expect(shown.some((option) => /make a selection/i.test(option.label))).toBe(false);
  });
});
