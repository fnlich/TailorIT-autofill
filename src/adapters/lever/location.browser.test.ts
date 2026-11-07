/*
 * Lever's "Current location" search (v4, drop: the owner's words of 2026-11-07, "Current location on Jobs.lever: You
 * can write possible answer ... and choose the correct answer on dropdown"), through the Lever adapter's declared
 * results list (WidgetDecl.results), its declared key after each query (queryKey) and the widget helpers:
 * - on the read-only live capture of a public Lever application with "Austin" typed (fixtures/lever/location-open.html):
 *   the box is a search the helpers act on, its results are the declared list's rows, and the results shown inside its
 *   wrapping label never change its label;
 * - on the synthetic page that does what the capture's script did (fixtures/synthetic/lever-location, whose header
 *   says how): each query is typed (the setter and an input event) and followed by one declared Escape, which starts
 *   Lever's search; a candidate whose search finds nothing moves on to the next; the one result chosen gets one
 *   mousedown, never a click; the page fills its hidden selectedLocation input itself; a search that finds nothing
 *   leaves the box as it was; the field's time budget stops further queries;
 * - in the content runtime with the fake worker planning over the golden profile (Austin, TX): the location is
 *   searched, matched by the core's place rule and chosen, verified, with untrusted events only.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import openHtml from '../../../fixtures/lever/location-open.html?raw';
import pageExpect from '../../../fixtures/synthetic/lever-location/index.expect.json';
import pageHtml from '../../../fixtures/synthetic/lever-location/index.html?raw';
import type { BaseKey } from '../../core/types/field';
import type { FillResult } from '../../core/types/fill';
import { createFakeWorker, testVocab } from '../../content/content.testkit';
import { startContentRuntime, type ContentRuntime } from '../../content/runtime';
import { ALLOWED_EVENTS } from '../../dom/fillers/events';
import { loadFixture, logEvents, removeFixtures, untrustedViolations, type EventLog, type Fixture } from '../../dom/fixture.testkit';
import { scan } from '../../dom/scan';
import type { FieldTarget, ScanResult, WidgetReading } from '../../dom/types';
import { isActionable, readWidget, searchTypeahead, widgetHolds, widgetListOf, type TypeaheadHooks } from '../../dom/widgets';
import { shownOptions } from '../../dom/widgets/options';
import { compareWithExpectation, readExpectation } from '../test/expectations.testkit';
import { leverAdapter } from './index';

const LOCATION = 'Current location';
/** The golden profile's candidate answers for its place (core/matcher/candidates.ts). */
const QUERIES = ['Austin, TX', 'Austin, Texas', 'Austin, United States', 'Austin'];
/** The events our search may cause on Lever's location box and its results: the fillers', the declared key's and the
 *  declared mousedown that chooses a result. */
const OURS = new Set<string>([...ALLOWED_EVENTS, 'keydown', 'keyup', 'mousedown']);

interface Page {
  fixture: Fixture;
  root: Element;
  events: EventLog;
  readings: Map<BaseKey, WidgetReading>;
  scanned(): ScanResult;
  target(label: string): FieldTarget;
  ctx(): { adapter: typeof leverAdapter; root: Element; readings: Map<BaseKey, WidgetReading> };
  counter<T>(name: string): T;
  box(): HTMLInputElement;
}

/** The page with `variant` put on its <html> as data-variant, before it loads. */
function withVariant(html: string, variant: string | null): string {
  if (variant === null) return html;
  const page = new DOMParser().parseFromString(html, 'text/html');
  page.documentElement.setAttribute('data-variant', variant);
  return `<!doctype html>\n${page.documentElement.outerHTML}`;
}

async function open(html: string, variant: string | null = null): Promise<Page> {
  const fixture = await loadFixture(document, withVariant(html, variant), { width: 1280, height: 900 });
  const root = leverAdapter.detect(fixture.doc)!.formRoot;
  const readings = new Map<BaseKey, WidgetReading>();
  const events = logEvents(fixture.doc);
  const scanned = () => scan(root, leverAdapter, { platform: 'lever', widgetReadings: readings });
  return {
    fixture, root, events, readings, scanned,
    target(label) {
      const result = scanned();
      const field = result.fields.find((candidate) => candidate.label === label);
      if (field === undefined) throw new Error(`no field labelled ${label}: ${result.fields.map((each) => each.label).join(', ')}`);
      return result.target(field.key)!;
    },
    ctx: () => ({ adapter: leverAdapter, root, readings }),
    counter: <T>(name: string) => (fixture.view as unknown as Record<string, T>)[name]!,
    box: () => fixture.doc.getElementById('location-input') as HTMLInputElement,
  };
}

/** Hooks over the page itself: each query's field found again on a fresh scan, and the result with this label chosen,
 *  as the worker's fill band would (the core's place rule: content runtime test below). */
function hooks(page: Page, wanted: string): TypeaheadHooks & { seen: string[][]; guarded: string[] } {
  const seen: string[][] = [];
  const guarded: string[] = [];
  return {
    seen, guarded,
    guard: async (query) => {
      guarded.push(query);
      return { ok: true, target: page.target(LOCATION) };
    },
    match: async (results) => {
      seen.push(results.map((result) => result.label));
      const index = results.findIndex((result) => result.label === wanted);
      return index < 0 ? { choose: null, reason: 'no-match', blocked: false } : { choose: { index, cleanLabel: wanted } };
    },
  };
}

/** Untrusted events only, each ours (OURS); never a click on a result, and nothing on the hidden selectedLocation. */
function expectOurEventsOnly(log: EventLog): void {
  expect(untrustedViolations(log.events)).toEqual([]);
  expect(log.events.filter((event) => !event.trusted && !OURS.has(event.type))).toEqual([]);
  expect(log.events.filter((event) => event.type === 'click' && event.target.startsWith('location-'))).toEqual([]);
  expect(log.on('selected-location')).toEqual([]);
  expect(log.events.filter((event) => event.type === 'submit')).toEqual([]);
}

afterEach(() => removeFixtures(document));

describe("Lever's location search on the live capture with its results open", () => {
  it('is a search the helpers act on, through the results list the adapter declares', async () => {
    const page = await open(openHtml);
    const target = page.target(LOCATION);
    expect(target.field).toMatchObject({ kind: 'typeahead-remote', label: LOCATION });
    const widget = target.widget!;
    expect(widget).toMatchObject({ declared: true, queryKey: 'Escape', results: { option: '.dropdown-location',
      choose: 'mousedown' } });
    expect(isActionable(widget)).toBe(true);
    const list = widgetListOf(widget)!;
    expect(list.classList.contains('dropdown-results')).toBe(true);
    expect(shownOptions(list, undefined, undefined, widget.results!.option).map((option) => option.label))
      .toEqual(['Austin, TX, USA', 'Austin, MN, USA', 'Austin, IN, USA', 'Austin, AR, USA']);
    // Without the declared list, the same box is no search the helpers may act on (Workday's prompts stay so).
    expect(isActionable({ ...widget, results: undefined })).toBe(false);
    expect(page.events.events.filter((event) => !event.trusted)).toEqual([]);
  });

  it('sends no key to a page that does not answer the typed text (a static snapshot): needs-your-click, the box as it was', async () => {
    const page = await open(openHtml);
    const result = await searchTypeahead(page.target(LOCATION), QUERIES, page.ctx(), hooks(page, 'Austin, TX, USA'));
    expect(result).toMatchObject({ chosen: null, reason: 'needs-your-click', typed: 1 });
    expect(page.box().value).toBe('');
    const ours = page.events.on('location-input').filter((event) => !event.trusted).map((event) => event.type);
    // The query's input event, then the box given back what it held and the (static, still shown) list left: the
    // fillers' events only.
    expect(ours.slice(0, 5)).toEqual(['input', 'input', 'change', 'focusout', 'blur']);
    expect(ours.every((type) => (ALLOWED_EVENTS as readonly string[]).includes(type))).toBe(true);
    expect(page.events.events.filter((event) => event.type === 'keydown' || event.type === 'mousedown')).toEqual([]);
  });

  it('keeps its label while its wrapping label shows the results', async () => {
    const page = await open(openHtml);
    const field = page.scanned().fields.find((each) => each.idAttr === 'location-input')!;
    expect(field.label).toBe(LOCATION);
    // The wrapping <label> itself reads the results too: the question's own words name the box (the adapter's labelFor).
    const wrapping = page.box().closest('label')!;
    expect(wrapping.textContent).toContain('Austin, MN, USA');
    expect(leverAdapter.labelFor!(page.box())?.textContent?.trim()).toBe(LOCATION);
  });
});

describe("Lever's location search, searched with candidate answers", () => {
  it('meets its hand-written expectations: the location a fillable search', async () => {
    const page = await open(pageHtml);
    expect(compareWithExpectation(page.fixture.doc, page.scanned(), readExpectation(pageExpect))).toEqual([]);
  });

  it('types a query, sends the declared Escape that starts the search, and chooses the result with one mousedown', async () => {
    const page = await open(pageHtml);
    expect(await readWidget(page.target(LOCATION), page.ctx())).toEqual({ status: 'read', reading: { kind: 'remote' } });
    const used = hooks(page, 'Austin, TX, USA');
    const result = await searchTypeahead(page.target(LOCATION), QUERIES, page.ctx(), used);
    expect(result).toMatchObject({ verified: true, reason: 'ok', typed: 1, chosen: { cleanLabel: 'Austin, TX, USA' } });
    expect(page.counter<Array<{ query: string }>>('__locationQueries').map((entry) => entry.query)).toEqual(['Austin, TX']);
    expect(page.counter<string[]>('__chosen')).toEqual(['Austin, TX, USA']);
    expect(page.box().value).toBe('Austin, TX, USA');
    // The page filled its own hidden record of the choice; we never wrote it.
    const hidden = page.fixture.doc.getElementById('selected-location') as HTMLInputElement;
    expect(JSON.parse(hidden.value)).toMatchObject({ name: 'Austin, TX, USA' });
    expect(page.events.on('location-input').filter((event) => !event.trusted).map((event) => event.type))
      .toEqual(['input', 'keydown', 'keyup']);
    expect(page.events.on('location-0').filter((event) => !event.trusted).map((event) => event.type))
      .toEqual(['mousedown']);
    const after = page.target(LOCATION);
    expect(after.field.current).toEqual({ kind: 'selected', labels: ['Austin, TX, USA'] });
    expect(widgetHolds(after, { kind: 'option', index: 0, cleanLabel: 'Austin, TX, USA' })).toBe(true);
    expectOurEventsOnly(page.events);
  });

  it('moves to the next candidate when one finds nothing, and chooses the right Austin, never the first listed', async () => {
    const page = await open(pageHtml, 'names');
    const used = hooks(page, 'Austin, TX, USA');
    const result = await searchTypeahead(page.target(LOCATION), QUERIES, page.ctx(), used);
    expect(result).toMatchObject({ verified: true, typed: 2, chosen: { cleanLabel: 'Austin, TX, USA' } });
    expect(page.counter<Array<{ query: string }>>('__locationQueries').map((entry) => entry.query))
      .toEqual(['Austin, TX', 'Austin, Texas']);
    // Each query was guarded on a fresh scan that found the field by its label, though "No location found" showed
    // inside its wrapping label between the two.
    expect(used.guarded).toEqual(['Austin, TX', 'Austin, Texas']);
    expect(used.seen).toEqual([['Austin, TX, USA']]);
    expect(page.box().value).toBe('Austin, TX, USA');

    // "Austin" lists Minnesota's first: the match chooses Texas's, the second row.
    const again = await open(pageHtml);
    const second = await searchTypeahead(again.target(LOCATION), ['Austin'], again.ctx(), hooks(again, 'Austin, TX, USA'));
    expect(second).toMatchObject({ verified: true, chosen: { index: 1, cleanLabel: 'Austin, TX, USA' } });
    expect(again.events.on('location-1').filter((event) => !event.trusted).map((event) => event.type))
      .toEqual(['mousedown']);
    expect(again.counter<string[]>('__chosen')).toEqual(['Austin, TX, USA']);
    expectOurEventsOnly(page.events);
    expectOurEventsOnly(again.events);
  });

  it('leaves the box as it was when no candidate finds a result to choose, its list closed', async () => {
    const page = await open(pageHtml, 'none');
    const result = await searchTypeahead(page.target(LOCATION), QUERIES, page.ctx(), hooks(page, 'Austin, TX, USA'));
    expect(result).toMatchObject({ chosen: null, verified: false, reason: 'no-match', blocked: false, typed: 4 });
    expect(page.counter<Array<{ query: string }>>('__locationQueries').map((entry) => entry.query)).toEqual(QUERIES);
    expect(page.box().value).toBe('');
    expect(page.counter<string[]>('__chosen')).toEqual([]);
    expect(widgetListOf(page.target(LOCATION).widget!)?.children.length ?? 0).toBe(0);
    expectOurEventsOnly(page.events);
  });

  /** The page holding a place already, as its own mousedown on a result leaves it (the box its words, the hidden
   *  selectedLocation input its record, the list closed): another place than the profile's. */
  function holding(page: Page, place: string): HTMLInputElement {
    const hidden = page.fixture.doc.getElementById('selected-location') as HTMLInputElement;
    page.box().value = place;
    hidden.value = JSON.stringify({ name: place, id: 'place-4' });
    return hidden;
  }

  /** The place the page held is still its own: the box's words, its record, nothing chosen, and no blur of ours on the
   *  box (Lever empties the box, and its record, on a blur while its list shows; its list closes on nothing else but a
   *  chosen result, so it stays open: the v4 review's finding 11). */
  function expectHeld(page: Page, hidden: HTMLInputElement, place: string): void {
    expect(page.box().value).toBe(place);
    expect(JSON.parse(hidden.value)).toMatchObject({ name: place });
    expect(page.counter<string[]>('__chosen')).toEqual([]);
    expect(page.events.on('location-input').filter((event) => !event.trusted && ['focusout', 'blur'].includes(event.type)))
      .toEqual([]);
    expect((page.fixture.doc.querySelector('.dropdown-container') as HTMLElement).style.display).toBe('flex');
    expectOurEventsOnly(page.events);
  }

  it('gives back the place the box held when no candidate finds one: its words and the page record kept', async () => {
    const page = await open(pageHtml, 'none');
    const hidden = holding(page, 'Dallas, TX, USA');
    const result = await searchTypeahead(page.target(LOCATION), QUERIES, page.ctx(), hooks(page, 'Austin, TX, USA'));
    expect(result).toMatchObject({ chosen: null, verified: false, reason: 'no-match', blocked: false, typed: 4 });
    expect(page.counter<Array<{ query: string }>>('__locationQueries').map((entry) => entry.query)).toEqual(QUERIES);
    expectHeld(page, hidden, 'Dallas, TX, USA');
  });

  it('gives back the place the box held when the results it found are none to choose, its list showing them', async () => {
    const page = await open(pageHtml);
    const hidden = holding(page, 'Dallas, TX, USA');
    const result = await searchTypeahead(page.target(LOCATION), ['Austin'], page.ctx(), hooks(page, 'Austin, NV, USA'));
    expect(result).toMatchObject({ chosen: null, verified: false, reason: 'no-match', blocked: false, typed: 1 });
    expect(page.counter<Array<{ query: string }>>('__locationQueries').map((entry) => entry.query)).toEqual(['Austin']);
    expectHeld(page, hidden, 'Dallas, TX, USA');
  });

  it('types no further query once the field has used its time budget', async () => {
    const page = await open(pageHtml, 'none');
    const result = await searchTypeahead(page.target(LOCATION), QUERIES, page.ctx(), hooks(page, 'Austin, TX, USA'), 0);
    expect(result).toMatchObject({ chosen: null, reason: 'no-match', typed: 1 });
    expect(page.counter<Array<{ query: string }>>('__locationQueries').map((entry) => entry.query)).toEqual(['Austin, TX']);
    expect(page.box().value).toBe('');
  });
});

describe("Lever's location search in the content runtime", () => {
  let logs: MockInstance;
  beforeAll(() => {
    testVocab();
    logs = vi.spyOn(console, 'info');
  });
  afterAll(() => logs.mockRestore());
  const runtimes: ContentRuntime[] = [];
  afterEach(() => {
    for (const runtime of runtimes.splice(0)) runtime.stop();
  });

  it("searches the golden profile's place and chooses Austin, TX, USA by the core's place rule, verified", async () => {
    const fixture = await loadFixture(document, pageHtml, { width: 1280, height: 900 });
    const events = logEvents(fixture.doc);
    const worker = createFakeWorker();
    const runtime = await startContentRuntime(worker.platform, fixture.doc, {
      href: () => 'https://jobs.lever.co/tailorit-fixture/lever-location/apply', isTop: true, settle: { quietMs: 200 } });
    runtimes.push(runtime);
    await runtime.fill({});
    const report = worker.reports.at(-1)!;
    const row = report.fields.find((each) => each.label === LOCATION) as FillResult | undefined;
    expect(row).toMatchObject({ kind: 'typeahead-remote', category: 'location.current', status: 'verified', wrote: true,
      provenance: 'profile' });
    expect((fixture.doc.getElementById('location-input') as HTMLInputElement).value).toBe('Austin, TX, USA');
    expect((fixture.view as unknown as { __chosen: string[] }).__chosen).toEqual(['Austin, TX, USA']);
    expect((fixture.view as unknown as { __locationQueries: Array<{ query: string }> }).__locationQueries
      .map((entry) => entry.query)).toEqual(['Austin, TX']);
    expectOurEventsOnly(events);
  });
});
