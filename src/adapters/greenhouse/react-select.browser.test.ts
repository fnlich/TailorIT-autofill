/*
 * Greenhouse's react-selects, on the real react-select v5 inside Greenhouse's wrapper (fixtures/synthetic/
 * greenhouse-widgets, whose app.ts says what it reproduces from the capture of 2026-11-01), through the Greenhouse
 * adapter's widget hooks and the widget helpers, driven only by calling them: open with one bubbling mouseup, choose
 * with click(), close with focusout and blur; a multi-select reopened for each pick; Degree's list waited through its
 * "Loading..."; School opened before its search; Location's geocoder, whose list shows only the results holding the
 * typed text; the phone country read back by its flag, and its 244 countries searched for by a country's name (the
 * country the phone number picked by itself kept only when it is the profile's); a checkbox question ticked with
 * click(); the page that attaches late or rebuilds its form; and the buttons never pressed. Every select's text box is drawn under 4 px wide, as the
 * live BeyondTrust form draws it, so each is a field by its control. Every event they cause is untrusted, and is the
 * fillers' or the declared mouseup: never a mousedown, a key, a focus or a pointer event.
 */
import { afterEach, describe, expect, it } from 'vitest';
import pageExpect from '../../../fixtures/synthetic/greenhouse-widgets/index.expect.json';
import pageHtml from '../../../fixtures/synthetic/greenhouse-widgets/index.html?raw';
import {
  mountGreenhouseForm, mountHeaderButton, newLog, type GreenhouseLog, type MountOptions,
} from '../../../fixtures/synthetic/greenhouse-widgets/app';
import { optionQuery } from '../../core/matcher/listSearch';
import type { BaseKey } from '../../core/types/field';
import { assertNotSubmit, fill } from '../../dom/fillers';
import { ALLOWED_EVENTS } from '../../dom/fillers/events';
import { loadFixture, logEvents, removeFixtures, untrustedViolations, type EventLog, type Fixture } from '../../dom/fixture.testkit';
import { scan } from '../../dom/scan';
import type { FieldTarget, ScanResult, WidgetReading } from '../../dom/types';
import { visibilityOf } from '../../dom/visibility';
import {
  expandedState, fillWidget, newReadiness, openList, readWidget, searchesList, searchForOption, searchTypeahead,
  widgetHolds, type TypeaheadHooks, type WidgetReadiness,
} from '../../dom/widgets';
import { closeList } from '../../dom/widgets/interact';
import { compareWithExpectation, readExpectation } from '../test/expectations.testkit';
import { GREENHOUSE_ACTIVATION, greenhouseAdapter } from './index';

const AUTHORIZED = 'question_9001';
const SKILLS = 'question_9004[]';
const RESIDENCE = 'question_9005';

interface Page {
  fixture: Fixture;
  /** The form root as the adapter finds it now: the page that draws its whole form again has a new one. */
  readonly root: Element;
  log: GreenhouseLog;
  events: EventLog;
  readings: Map<BaseKey, WidgetReading>;
  readiness: WidgetReadiness;
  scanned(): ScanResult;
  /** The live target of the field whose control has this id. */
  target(id: string): FieldTarget;
  ctx(): { adapter: typeof greenhouseAdapter; root: Element; readings: Map<BaseKey, WidgetReading>; readiness: WidgetReadiness };
  input(id: string): HTMLInputElement;
}

/** The page, its form drawn by the app (the page's own module script left out: the test mounts the app itself). */
async function open(options: MountOptions = {}): Promise<Page> {
  const fixture = await loadFixture(document, pageHtml.replace(/<script[^>]*><\/script>/, ''), { width: 1280, height: 2600 });
  const log = newLog();
  mountHeaderButton(fixture.doc.getElementById('autofill-host')!, log);
  mounted.push(mountGreenhouseForm(fixture.doc.getElementById('gh-root')!, { styles: fixture.doc.head, log, ...options })
    .unmount);
  const rootNow = () => greenhouseAdapter.detect(fixture.doc)!.formRoot;
  const readings = new Map<BaseKey, WidgetReading>();
  const readiness = newReadiness();
  const events = logEvents(fixture.doc);
  const scanned = () => scan(rootNow(), greenhouseAdapter, { platform: 'greenhouse', widgetReadings: readings });
  return {
    fixture, log, events, readings, readiness, scanned,
    get root() {
      return rootNow();
    },
    target(id) {
      const result = scanned();
      const field = result.fields.find((candidate) => candidate.idAttr === id);
      if (field === undefined) throw new Error(`no field #${id}`);
      return result.target(field.key)!;
    },
    ctx: () => ({ adapter: greenhouseAdapter, root: rootNow(), readings, readiness }),
    input: (id) => fixture.doc.getElementById(id) as HTMLInputElement,
  };
}

/** Untrusted events only, each the fillers' or the declared mouseup; the browser's own scroll of a list we set
 *  scrollTop on aside, and a checkbox's own input and change after our click (untrustedViolations' rules). */
function expectOurEventsOnly(log: EventLog): void {
  expect(untrustedViolations(log.events)).toEqual([]);
  const allowed = new Set<string>([...ALLOWED_EVENTS, ...GREENHOUSE_ACTIVATION]);
  expect(log.events.filter((event) => !event.trusted && !allowed.has(event.type))).toEqual([]);
  expect(log.events.filter((event) => ['mousedown', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'focus', 'focusin']
    .includes(event.type))).toEqual([]);
}

/** The untrusted mouseups on a control. */
const mouseupsOn = (log: EventLog, id: string) => log.on(id).filter((event) => event.type === 'mouseup' && !event.trusted).length;

/** The option of a field's options with this label. */
function optionOf(target: FieldTarget, label: string): { kind: 'option'; index: number; cleanLabel: string } {
  const options = target.field.options === 'lazy' ? [] : target.field.options;
  const index = options.findIndex((option) => option.label === label);
  if (index < 0) throw new Error(`no option ${label}`);
  return { kind: 'option', index, cleanLabel: label };
}

/** A typeahead's hooks: the field found again on a fresh scan, and the result with this label chosen. */
function hooks(page: Page, id: string, wanted: string): TypeaheadHooks & { seen: string[][] } {
  const seen: string[][] = [];
  return {
    seen,
    guard: async () => ({ ok: true, target: page.target(id) }),
    match: async (results) => {
      seen.push(results.map((result) => result.label));
      const index = results.findIndex((result) => result.label === wanted);
      return index < 0 ? { choose: null, reason: 'no-match', blocked: false } : { choose: { index, cleanLabel: wanted } };
    },
  };
}

/** The forms mounted by this file's tests, unmounted after each (a late page's timer is cleared). */
const mounted: Array<() => void> = [];

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
  removeFixtures(document);
});

describe("Greenhouse's react-selects, as the adapter declares them", () => {
  it('scans each select as its declared kind, its options lazy; the required shim and the hidden country search are no fields', async () => {
    const page = await open();
    const fields = page.scanned().fields;
    const kindOf = (id: string) => fields.find((field) => field.idAttr === id);
    expect(['country', 'candidate-location', 'school--0', 'degree--0', AUTHORIZED, SKILLS, RESIDENCE, 'gender']
      .map((id) => [id, kindOf(id)?.kind, kindOf(id)?.options])).toEqual([
      ['country', 'combobox', 'lazy'], ['candidate-location', 'typeahead-remote', 'lazy'],
      ['school--0', 'typeahead-remote', 'lazy'], ['degree--0', 'combobox', 'lazy'], [AUTHORIZED, 'combobox', 'lazy'],
      [SKILLS, 'multiselect', 'lazy'], [RESIDENCE, 'combobox', 'lazy'], ['gender', 'combobox', 'lazy']]);
    expect(kindOf('question_9003[]')).toMatchObject({ kind: 'checkbox-group', required: true,
      label: 'How did you hear about this opportunity? (select all that apply)' });
    expect(fields.some((field) => field.idAttr === 'iti-0__search-input' || field.label === 'Search')).toBe(false);
    expect(fields.filter((field) => field.label === '').map((field) => field.key)).toEqual([]);
    // Every text box is drawn as narrow as the live BeyondTrust form draws it (index.html), under the 4 px a box needs
    // on its own, and nothing else hides it: each select is a field by the control a person sees around it.
    const inputs = Array.from(page.root.querySelectorAll<HTMLInputElement>('input.select__input'));
    expect(inputs.length).toBeGreaterThan(10);
    for (const input of inputs) {
      expect(input.getBoundingClientRect().width, input.id).toBeLessThan(4);
      expect(visibilityOf(input), input.id).toMatchObject({ visible: false, rule: 'box-size' });
      expect(fields.some((field) => field.idAttr === input.id), input.id).toBe(true);
    }
    const target = page.target(AUTHORIZED);
    // DOM nodes are compared by identity (toBe): a deep comparison of a frame's nodes walks its whole document.
    expect(target.widget).toMatchObject({ declared: true, activation: ['mouseup'] });
    expect(target.widget!.expanded).toBe(page.input(AUTHORIZED));
    expect(target.widget!.box).toBe(page.input(AUTHORIZED).closest('.select__control'));
    expect(page.events.events.filter((event) => !event.trusted)).toEqual([]);
  });

  it('meets its hand-written expectations, the race question once Hispanic/Latino is No', async () => {
    const page = await open();
    const expectation = readExpectation(pageExpect);
    expect(compareWithExpectation(page.fixture.doc, page.scanned(), expectation)).toEqual([]);
    await readWidget(page.target('hispanic_ethnicity'), page.ctx());
    const hispanic = page.target('hispanic_ethnicity');
    await fillWidget(hispanic, optionOf(hispanic, 'No'), page.ctx());
    const race = (pageExpect as unknown as { states: Array<{ fields: unknown[] }> }).states[0]!.fields;
    // Read, Hispanic/Latino's options are its three, no longer 'lazy'.
    expect(compareWithExpectation(page.fixture.doc, page.scanned(), readExpectation({ ...expectation,
      fields: [...expectation.fields, ...race] }))).toEqual([{ control: '#hispanic_ethnicity', property: 'options',
      expected: 'lazy', actual: '3' }]);
  });

  it('opens a Yes/No with one bubbling mouseup, reads it, closes it with focusout and blur, then chooses with click()', async () => {
    const page = await open();
    expect(await readWidget(page.target(AUTHORIZED), page.ctx())).toMatchObject({ status: 'read',
      reading: { kind: 'options', options: [{ label: 'Yes' }, { label: 'No' }] } });
    expect(page.input(AUTHORIZED).getAttribute('aria-expanded')).toBe('false');
    expect(page.events.on(AUTHORIZED).filter((event) => !event.trusted).map((event) => event.type))
      .toEqual(['mouseup', 'focusout', 'blur']);
    expect(page.log.mouseups[AUTHORIZED]).toBe(1);
    const target = page.target(AUTHORIZED);
    expect(await fillWidget(target, optionOf(target, 'Yes'), page.ctx())).toEqual({ wrote: true,
      verification: 'verified', reason: 'ok', needsUserAction: false });
    // React's state: Greenhouse's "1" for Yes; the menu shut by the choice; the answer shown beside an emptied input
    // that react-select draws transparent, while the field stays one (its control is the box a person sees).
    expect(page.log.values[AUTHORIZED]).toBe('1');
    expect(page.input(AUTHORIZED).getAttribute('aria-expanded')).toBe('false');
    expect(page.input(AUTHORIZED).value).toBe('');
    expect(page.fixture.view.getComputedStyle(page.input(AUTHORIZED)).opacity).toBe('0');
    const after = page.target(AUTHORIZED);
    expect(after.field.current).toEqual({ kind: 'selected', labels: ['Yes'] });
    expect(widgetHolds(after, optionOf(after, 'Yes'))).toBe(true);
    expect(mouseupsOn(page.events, AUTHORIZED)).toBe(2);
    expect(page.log.pressed).toEqual([]);
    expectOurEventsOnly(page.events);
  });

  it('never sends a second mouseup to a list that says it is open (it would close it)', async () => {
    const page = await open();
    const widget = page.target(AUTHORIZED).widget!;
    const opened = await openList(widget, page.ctx());
    expect(opened).toMatchObject({ open: true, activated: true });
    expect(expandedState(widget)).toBe(true);
    expect(await openList(page.target(AUTHORIZED).widget!, page.ctx())).toMatchObject({ open: true, activated: false });
    expect(mouseupsOn(page.events, AUTHORIZED)).toBe(1);
    expect(await closeList(page.target(AUTHORIZED).widget!, page.ctx(), { activated: true })).toBe(true);
    expect(page.log.mouseups[AUTHORIZED]).toBe(1);
    expectOurEventsOnly(page.events);
  });

  it('adds each option of a multi-select with a mouseup of its own, since the menu closes after every pick', async () => {
    const page = await open();
    await readWidget(page.target(SKILLS), page.ctx());
    const target = page.target(SKILLS);
    const labels = ['TypeScript', 'PostgreSQL', 'Kubernetes'];
    const indices = labels.map((label) => optionOf(target, label).index);
    expect(await fillWidget(target, { kind: 'options', indices, cleanLabels: labels }, page.ctx())).toMatchObject({
      wrote: true, verification: 'verified', reason: 'ok' });
    expect(page.log.values[SKILLS]).toEqual(['900400', '900402', '900403']);
    // One mouseup to read it, then one per pick: a chosen option leaves the list, and the chips stay untouched.
    expect(mouseupsOn(page.events, SKILLS)).toBe(4);
    expect(page.log.mouseups[SKILLS]).toBe(4);
    const after = page.target(SKILLS);
    expect(after.field.current).toEqual({ kind: 'selected', labels });
    expect(widgetHolds(after, { kind: 'options', indices, cleanLabels: labels })).toBe(true);
    expect(page.log.pressed).toEqual([]);
    expectOurEventsOnly(page.events);
  });

  it("waits through Degree's \"Loading...\" past the empty-list wait, and would give up without the adapter's busy signs", async () => {
    const page = await open({ degreeMs: 1600 });
    expect(await readWidget(page.target('degree--0'), page.ctx())).toMatchObject({ status: 'read',
      reading: { kind: 'options', complete: true } });
    expect(page.readings.get(page.target('degree--0').field.baseKey)).toMatchObject({ options: expect.arrayContaining([
      { label: "Bachelor's Degree", disabled: false }]) });
    removeFixtures(document);
    const blind = await open({ degreeMs: 1600 });
    const target = blind.target('degree--0');
    const unsigned = { ...target, widget: { ...target.widget!, busy: [] } };
    expect(await readWidget(unsigned, blind.ctx())).toEqual({ status: 'unread', reason: 'options-never-loaded' });
  });

  it("opens School before typing, so its first page loads, then searches it and chooses the profile's school", async () => {
    const page = await open();
    page.readings.set(page.target('school--0').field.baseKey, { kind: 'remote' });
    const used = hooks(page, 'school--0', 'University of Texas at Austin');
    const result = await searchTypeahead(page.target('school--0'),
      ['The University of Texas at Austin', 'University of Texas at Austin'], page.ctx(), used);
    expect(result).toMatchObject({ verified: true, reason: 'ok', typed: 2,
      chosen: { cleanLabel: 'University of Texas at Austin' } });
    expect(page.log.schoolRequests).toEqual([{ term: '', page: 1 }, { term: 'The University of Texas at Austin', page: 1 },
      { term: 'University of Texas at Austin', page: 1 }]);
    // The first page was never sent as a query's results: only what each query answered.
    expect(used.seen).toEqual([['University of Texas at Austin']]);
    expect(mouseupsOn(page.events, 'school--0')).toBe(1);
    expect(page.log.values['school--0']).toBeTypeOf('string');
    expect(page.target('school--0').field.current).toEqual({ kind: 'selected', labels: ['University of Texas at Austin'] });
    expectOurEventsOnly(page.events);
  });

  it("searches Location's geocoder once its list is open, and chooses the place its list shows for the region's name", async () => {
    const page = await open();
    // The planner's queries for "Austin, TX" (core typeaheadQueries). The list shows only the results whose label holds
    // the typed text, as on the live BeyondTrust form: the geocoder's Austin in Texas reads "Austin, Texas, United
    // States", so "Austin, TX" lists nothing and "Austin, Texas" lists it.
    const used = hooks(page, 'candidate-location', 'Austin, Texas, United States');
    const result = await searchTypeahead(page.target('candidate-location'), ['Austin, TX', 'Austin, Texas', 'Austin'],
      page.ctx(), used);
    expect(result).toMatchObject({ verified: true, typed: 2, chosen: { cleanLabel: 'Austin, Texas, United States' } });
    expect(page.log.locationRequests).toEqual(['Austin, TX', 'Austin, Texas']);
    expect(used.seen).toEqual([['Austin, Texas, United States']]);
    expect(page.log.values['candidate-location']).toBe('Austin, Texas, United States');
    expect(mouseupsOn(page.events, 'candidate-location')).toBe(1);
    const after = page.target('candidate-location');
    expect(widgetHolds(after, { kind: 'option', index: 0, cleanLabel: 'Austin, Texas, United States' })).toBe(true);
    expect(page.log.pressed).toEqual([]);
    expectOurEventsOnly(page.events);
  });

  it('reads the phone country back by its flag: "+1" with the Canadian flag is "Canada +1"', async () => {
    const page = await open();
    await readWidget(page.target('country'), page.ctx());
    const target = page.target('country');
    expect(await fillWidget(target, optionOf(target, 'Canada +1'), page.ctx())).toMatchObject({ wrote: true,
      verification: 'verified' });
    expect(page.log.values.country).toBe('ca');
    const shown = page.root.querySelector('#country')!.closest('.select__control')!.querySelector('.select__single-value')!;
    expect(shown.textContent).toBe('+1');
    expect(shown.querySelector('.iti__flag.iti__ca')).not.toBeNull();
    const after = page.target('country');
    expect(after.field.current).toEqual({ kind: 'selected', labels: ['Canada +1'] });
    expect(widgetHolds(after, optionOf(after, 'Canada +1'))).toBe(true);
    // The United States share "+1": the flag tells them apart, never the dial code.
    expect(widgetHolds(after, optionOf(after, 'United States +1'))).toBe(false);
    expectOurEventsOnly(page.events);
  });

  it('ticks a checkbox question with click(), as React sees it', async () => {
    const page = await open();
    const result = page.scanned();
    const group = result.fields.find((field) => field.kind === 'checkbox-group')!;
    const index = group.options === 'lazy' ? -1 : group.options.findIndex((option) => option.label === 'LinkedIn');
    expect(fill(result.target(group.key)!, { kind: 'options', indices: [index], cleanLabels: ['LinkedIn'] },
      { adapter: greenhouseAdapter, root: page.root })).toMatchObject({ wrote: true, verification: 'verified' });
    expect(page.log.values['question_9003[]']).toEqual(['900300']);
    expect(page.events.on('question_9003[]_900300').filter((event) => ['click', 'input', 'change'].includes(event.type))
      .map((event) => [event.type, event.trusted])).toEqual([['click', false], ['input', true], ['change', true]]);
    expectOurEventsOnly(page.events);
  });

  it('waits once for a page whose React has not attached, then opens it; the run waits no more after that', async () => {
    const page = await open({ start: 'late', attachMs: 1500 });
    expect(page.log.attachedAt).toBeNull();
    expect(await readWidget(page.target(AUTHORIZED), page.ctx())).toMatchObject({ status: 'read',
      reading: { options: [{ label: 'Yes' }, { label: 'No' }] } });
    // The first mouseup reached no listener; after the wait, the second opened it.
    expect(mouseupsOn(page.events, AUTHORIZED)).toBe(2);
    expect(page.log.mouseups[AUTHORIZED]).toBe(1);
    expect(page.readiness).toEqual({ answered: true, waited: true });
    expect(await readWidget(page.target('gender'), page.ctx())).toMatchObject({ status: 'read' });
    expect(mouseupsOn(page.events, 'gender')).toBe(1);
    expectOurEventsOnly(page.events);
  });

  it('tolerates a form React draws again whole, its form root included: the widget it waited on is gone, and the new form is read', async () => {
    const page = await open({ start: 'rebuild', attachMs: 800 });
    const form = page.root;
    const before = page.target(AUTHORIZED);
    const started = performance.now();
    expect(await readWidget(before, page.ctx())).toEqual({ status: 'gone' });
    // The wait ends once the old form root has left the page, well before its cap.
    expect(performance.now() - started).toBeLessThan(3_000);
    expect(before.control.isConnected).toBe(false);
    expect(form.isConnected).toBe(false);
    expect(page.root).not.toBe(form);
    expect(page.root.matches('form#application-form.application--form')).toBe(true);
    expect(page.log.draws).toBe(1);
    expect(await readWidget(page.target(AUTHORIZED), page.ctx())).toMatchObject({ status: 'read' });
    expect(page.log.mouseups[AUTHORIZED]).toBe(1);
    expectOurEventsOnly(page.events);
  });

  it('a select that never answers is needs-your-click after the one wait, and a later one is not waited for', async () => {
    const page = await open({ start: 'late', attachMs: 60_000 });
    const readiness = page.readiness;
    expect(await readWidget(page.target(AUTHORIZED), page.ctx())).toEqual({ status: 'unread', reason: 'needs-your-click' });
    expect(readiness).toEqual({ answered: false, waited: true });
    const started = performance.now();
    expect(await readWidget(page.target('gender'), page.ctx())).toEqual({ status: 'unread', reason: 'needs-your-click' });
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(mouseupsOn(page.events, AUTHORIZED)).toBe(2);
    expect(mouseupsOn(page.events, 'gender')).toBe(1);
    expectOurEventsOnly(page.events);
  });
});

describe('the phone country, searched for by its name', () => {
  /** The phone country's options read whole (the run's waiting path), and its target now. */
  async function readCountry(page: Page): Promise<FieldTarget> {
    expect(await readWidget(page.target('country'), page.ctx())).toMatchObject({ status: 'read',
      reading: { kind: 'options', complete: true } });
    return page.target('country');
  }

  /** The phone country's option with this label searched for by its words, through a guard that finds it again. */
  async function search(page: Page, label: string) {
    const target = page.target('country');
    const option = optionOf(target, label);
    const queries: string[] = [];
    const result = await searchForOption(target, { label, cleanLabel: option.cleanLabel }, optionQuery(label),
      page.ctx(), async (query) => {
        queries.push(query);
        return { ok: true, target: page.target('country') };
      });
    return { result, queries, option };
  }

  /** The flag the phone country shows. */
  const flagOf = (page: Page) => page.root.querySelector('#country')!.closest('.select__control')!
    .querySelector('.select__single-value .iti__flag')?.className ?? null;

  it("lists the live form's 244 countries, and is searched for, as a country question is, while a short list is not", async () => {
    const page = await open();
    const target = await readCountry(page);
    expect(target.field.options === 'lazy' ? 0 : target.field.options.length).toBe(244);
    expect(target.field.options === 'lazy' ? null : target.field.options[0]!.label).toBe('United States +1');
    expect(searchesList(target)).toBe(true);
    await readWidget(page.target(RESIDENCE), page.ctx());
    expect(searchesList(page.target(RESIDENCE))).toBe(true);
    await readWidget(page.target(AUTHORIZED), page.ctx());
    expect(searchesList(page.target(AUTHORIZED))).toBe(false);
  });

  it('types each country’s name, clicks the one result that is it, and reads it back by its flag', async () => {
    const page = await open();
    await readCountry(page);
    const before = mouseupsOn(page.events, 'country');
    for (const [label, code, query] of [['United States +1', 'us', 'United States'], ['Canada +1', 'ca', 'Canada'],
      ['United Kingdom +44', 'gb', 'United Kingdom']] as const) {
      const { result, queries, option } = await search(page, label);
      expect(result, label).toMatchObject({ verified: true, reason: 'ok', typed: 1, blocked: false,
        chosen: { index: 0, cleanLabel: label } });
      expect(queries, label).toEqual([query]);
      expect(page.log.values.country, label).toBe(code);
      expect(flagOf(page), label).toBe(`iti__flag iti__${code}`);
      const after = page.target('country');
      expect(after.field.current, label).toEqual({ kind: 'selected', labels: [label] });
      expect(widgetHolds(after, option), label).toBe(true);
      expect(page.input('country').value, label).toBe('');
      expect(page.input('country').getAttribute('aria-expanded'), label).toBe('false');
    }
    // What React's filter saw typed: each name once, never a key; one mouseup opened the list for each search.
    expect(page.log.typed.country).toEqual(['United States', 'Canada', 'United Kingdom']);
    expect(mouseupsOn(page.events, 'country') - before).toBe(3);
    expect(page.log.pressed).toEqual([]);
    expectOurEventsOnly(page.events);
  });

  it('finds nothing to choose when no result is the planned option, and gives the text box back what it held', async () => {
    const page = await open();
    const target = await readCountry(page);
    const option = optionOf(target, 'Canada +1');
    const result = await searchForOption(target, { label: 'Canada +1', cleanLabel: option.cleanLabel }, 'Mexico',
      page.ctx(), async () => ({ ok: true, target: page.target('country') }));
    expect(result).toMatchObject({ chosen: null, verified: false, reason: 'no-match', typed: 1 });
    expect(page.log.values.country).toBeUndefined();
    expect(page.input('country').value).toBe('');
    expect(page.input('country').getAttribute('aria-expanded')).toBe('false');
    expectOurEventsOnly(page.events);
  });

  it("keeps the country the phone number picked only when it is the profile's: the United Kingdom for \"+44 ...\", never the United States for a Canadian's \"+1 512 ...\"", async () => {
    const page = await open({ phonePicks: true });
    await readCountry(page);
    const phone = () => {
      const result = page.scanned();
      return result.target(result.fields.find((field) => field.idAttr === 'phone')!.key)!;
    };
    // A Briton's number: intl-tel-input picks the United Kingdom, which is the profile's, so nothing is typed.
    expect(fill(phone(), { kind: 'text', text: '+44 20 7946 0958' }, { adapter: greenhouseAdapter, root: page.root }))
      .toMatchObject({ wrote: true, verification: 'verified' });
    expect(page.log.values.country).toBe('gb');
    const british = page.target('country');
    expect(british.field.current).toEqual({ kind: 'selected', labels: ['United Kingdom +44'] });
    expect(widgetHolds(british, optionOf(british, 'United Kingdom +44'))).toBe(true);
    for (const other of ['Jersey +44', 'Guernsey +44', 'Isle of Man +44']) {
      expect(widgetHolds(british, optionOf(british, other)), other).toBe(false);
    }
    expect(page.log.typed.country).toBeUndefined();
    // A Canadian's number with a Texas area code: intl-tel-input picks the United States, which shows "+1" as Canada
    // does; read by its flag it is no Canada, so Canada is typed and chosen.
    fill(phone(), { kind: 'text', text: '+1 512 555 0188' }, { adapter: greenhouseAdapter, root: page.root });
    expect(page.log.values.country).toBe('us');
    const picked = page.target('country');
    expect(picked.field.current).toEqual({ kind: 'selected', labels: ['United States +1'] });
    expect(widgetHolds(picked, optionOf(picked, 'Canada +1'))).toBe(false);
    const { result } = await search(page, 'Canada +1');
    expect(result).toMatchObject({ verified: true, reason: 'ok', chosen: { cleanLabel: 'Canada +1' } });
    expect(page.log.values.country).toBe('ca');
    expect(flagOf(page)).toBe('iti__flag iti__ca');
    expect(page.log.typed.country).toEqual(['Canada']);
    // The page then draws the number nationally, its "+1" shown by the country alone (as on the live form).
    expect(page.input('phone').value).toBe('(512) 555-0188');
    expect(page.log.pressed).toEqual([]);
    expectOurEventsOnly(page.events);
  });

  it('reads a flag the list spells otherwise as the one option of its dial code', async () => {
    // The capture's list says "Turkey +90"; the browser names the flag's region "Türkiye".
    expect(new Intl.DisplayNames(['en'], { type: 'region' }).of('TR')).not.toBe('Turkey');
    const page = await open();
    const target = await readCountry(page);
    expect(await fillWidget(target, optionOf(target, 'Turkey +90'), page.ctx())).toMatchObject({ wrote: true,
      verification: 'verified' });
    expect(page.log.values.country).toBe('tr');
    expect(flagOf(page)).toBe('iti__flag iti__tr');
    const after = page.target('country');
    expect(after.field.current).toEqual({ kind: 'selected', labels: ['Turkey +90'] });
    expect(widgetHolds(after, optionOf(after, 'Turkey +90'))).toBe(true);
    expectOurEventsOnly(page.events);
  });
});

describe('the buttons Greenhouse shows that are never pressed', () => {
  it('refuses Autofill my application, Locate me, Dropbox, Google Drive, Enter manually, Clear selections and a chip remove', async () => {
    const page = await open();
    // A chosen single select shows "Clear selections"; a multi-select's chips each have a remove button.
    await readWidget(page.target(AUTHORIZED), page.ctx());
    const yesNo = page.target(AUTHORIZED);
    await fillWidget(yesNo, optionOf(yesNo, 'No'), page.ctx());
    await readWidget(page.target(SKILLS), page.ctx());
    const skills = page.target(SKILLS);
    await fillWidget(skills, { kind: 'options', indices: [optionOf(skills, 'Go').index], cleanLabels: ['Go'] }, page.ctx());
    const never = greenhouseAdapter.neverPress!(page.root);
    const words = never.map((el) => el.getAttribute('aria-label') ?? el.textContent!.trim());
    expect([...words].sort()).toEqual(['Autofill my application', 'Clear selections', 'Clear selections', 'Dropbox',
      'Enter manually', 'Google Drive', 'Locate me', 'Remove Go']);
    const ctx = { adapter: greenhouseAdapter, root: page.root };
    for (const el of never) {
      expect(assertNotSubmit(el, ctx), words[never.indexOf(el)]).toEqual({ ok: false, refusal: 'adapter-never-press' });
      for (const inner of Array.from(el.querySelectorAll('*'))) expect(assertNotSubmit(inner, ctx).ok).toBe(false);
    }
    // The label of "Enter manually" names no control, and the Attach button, the inputs and the options are pressable.
    expect(assertNotSubmit(page.input(AUTHORIZED), ctx)).toEqual({ ok: true });
    expect(assertNotSubmit(page.root.querySelector('.file-upload button')!, ctx)).toEqual({ ok: true });
    expect(page.log.pressed).toEqual([]);
    expectOurEventsOnly(page.events);
  });
});
