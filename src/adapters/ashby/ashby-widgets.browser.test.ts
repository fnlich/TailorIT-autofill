/*
 * Ashby's widgets, on fixtures/synthetic/ashby-widgets (app.ts says what it reproduces from the capture of
 * 2026-11-01), through the Ashby adapter's hooks and the fillers and widget helpers, driven only by calling them:
 * - a Yes/No answered with one click() on its button, read back by aria-pressed, its pressed button never clicked
 *   again (that clears the answer), its hidden checkbox no field;
 * - a radio group and a checkbox group ticked with click() on their opacity-0 inputs, read back by the span's
 *   data-checked (checkedOf), a chosen radio never clicked again, .checked never set (a box set so is read as Ashby
 *   draws it: not chosen);
 * - a ValueSelect opened by click() on its toggle, read in its floating-ui portal through aria-controls (the rest of
 *   the page aria-hidden meanwhile), closed with the declared Escape (focusout and blur do not close it), an option
 *   chosen with click() and read back from the input's value, never from the highlight's aria-selected;
 * - Location searched by typing, its first query listing nothing, its list closed before the next query's guard
 *   scans (the form is aria-hidden while it is open), then the place chosen; School's result read back by its name;
 * - the date written MM/DD/YYYY, its calendar never opened (no focus, no click);
 * - a search Ashby answers "No results" read as empty well before the query's cap (emptyAfterMs);
 * - a resume's upload read as Ashby shows it (uploadState, awaitUpload): confirmed once its file item names the file
 *   and the page is quiet, failed when its toast says so, pending while the page says nothing;
 * - the Education block's month then year, a month choosing the year too, and its add button;
 * - the buttons never pressed, and Submit.
 * Every event is untrusted, and is the fillers' or the declared Escape: never a mousedown, a pointer event, a focus or
 * any other key.
 */
import { afterEach, describe, expect, it } from 'vitest';
import pageExpect from '../../../fixtures/synthetic/ashby-widgets/index.expect.json';
import pageHtml from '../../../fixtures/synthetic/ashby-widgets/index.html?raw';
import { mountAshbyForm, newLog, PATHS, type AshbyLog, type AshbyServer } from '../../../fixtures/synthetic/ashby-widgets/app';
import type { BaseKey } from '../../core/types/field';
import { assertNotSubmit, clickIfAllowed, fill } from '../../dom/fillers';
import { awaitUpload } from '../../dom/fillers/upload';
import { ALLOWED_EVENTS } from '../../dom/fillers/events';
import { loadFixture, logEvents, removeFixtures, untrustedViolations, type EventLog, type Fixture } from '../../dom/fixture.testkit';
import { scan } from '../../dom/scan';
import { quietWait } from '../../dom/settle';
import type { FieldTarget, ScanResult, WidgetReading } from '../../dom/types';
import { isUserVisible } from '../../dom/visibility';
import {
  expandedState, fillWidget, newReadiness, readWidget, searchTypeahead, widgetHolds, type TypeaheadHooks,
} from '../../dom/widgets';
import { compareWithExpectation, readExpectation } from '../test/expectations.testkit';
import { ashbyAdapter } from './index';

interface Page {
  fixture: Fixture;
  readonly root: Element;
  log: AshbyLog;
  events: EventLog;
  readings: Map<BaseKey, WidgetReading>;
  scanned(): ScanResult;
  /** The live target of the field with this label. */
  target(label: string): FieldTarget;
  ctx(): { adapter: typeof ashbyAdapter; root: Element; readings: Map<BaseKey, WidgetReading>; readiness: ReturnType<typeof newReadiness> };
  entry(path: string): Element;
}

const mounted: Array<() => void> = [];

afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
  removeFixtures(document);
});

/** Waits until `ready` holds (the page drew or answered), at most `capMs`. */
async function until(fixture: Fixture, ready: () => boolean, capMs = 3_000): Promise<void> {
  const wait = quietWait<boolean>({ view: fixture.view, quietMs: 30, capMs, signal: undefined, aborted: false,
    atQuiet: () => (ready() ? true : null), atCap: () => ready() });
  wait.observe(fixture.doc.documentElement);
  expect(await wait.done).toBe(true);
}

/** The page with its form drawn by the app (the page's own module script left out: the test mounts the app). */
async function open(drawAfterMs = 0, options: { uploadFails?: boolean; server?: AshbyServer } = {}): Promise<Page> {
  const fixture = await loadFixture(document, pageHtml.replace(/<script[^>]*><\/script>/, ''), { width: 1280, height: 3200 });
  const log = newLog();
  mounted.push(mountAshbyForm(fixture.doc.getElementById('ashby-panel')!, { log, drawAfterMs, searchMs: 200,
    ...options }).unmount);
  if (drawAfterMs === 0) await until(fixture, () => ashbyAdapter.detect(fixture.doc) !== null);
  const readings = new Map<BaseKey, WidgetReading>();
  const readiness = newReadiness();
  const events = logEvents(fixture.doc);
  const rootNow = () => ashbyAdapter.detect(fixture.doc)!.formRoot;
  const scanned = () => scan(rootNow(), ashbyAdapter, { platform: 'ashby', widgetReadings: readings });
  return {
    fixture, log, events, readings, scanned,
    get root() {
      return rootNow();
    },
    target(label) {
      const result = scanned();
      const field = result.fields.find((candidate) => candidate.label === label);
      if (field === undefined) throw new Error(`no field "${label}": ${result.fields.map((each) => each.label).join(' | ')}`);
      return result.target(field.key)!;
    },
    ctx: () => ({ adapter: ashbyAdapter, root: rootNow(), readings, readiness }),
    entry: (path) => fixture.doc.querySelector(`[data-field-path="${path}"]`)!,
  };
}

/** Untrusted events only, each the fillers' or the declared Escape on a combobox's input: never a mousedown, a pointer
 *  event, a focus or another key. */
function expectOurEventsOnly(log: EventLog): void {
  expect(untrustedViolations(log.events)).toEqual([]);
  const allowed = new Set<string>([...ALLOWED_EVENTS, 'keydown', 'keyup']);
  expect(log.events.filter((event) => !event.trusted && !allowed.has(event.type))).toEqual([]);
  expect(log.events.filter((event) => ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'focus', 'focusin']
    .includes(event.type))).toEqual([]);
}

/** The option of a field with this label, as a planned write names it. */
function optionOf(target: FieldTarget, label: string): { kind: 'option'; index: number; cleanLabel: string } {
  const options = target.field.options === 'lazy' ? [] : target.field.options;
  const index = options.findIndex((option) => option.label === label);
  if (index < 0) throw new Error(`no option ${label}: ${options.map((option) => option.label).join(' | ')}`);
  return { kind: 'option', index, cleanLabel: label };
}

const AUTHORIZED = 'Are you legally authorized to work in the United States?';
const LOCATION = 'Where are you currently located?';
const DEGREE = 'What is the highest level of education you have completed?';

describe("Ashby's widgets, as the adapter declares them", () => {
  it('is no form until React draws it, then meets its hand-written expectations', async () => {
    const page = await open(400);
    expect(ashbyAdapter.detect(page.fixture.doc)).toBeNull();
    await until(page.fixture, () => ashbyAdapter.detect(page.fixture.doc) !== null);
    const result = page.scanned();
    expect(compareWithExpectation(page.fixture.doc, result, readExpectation(pageExpect))).toEqual([]);
    // Each Yes/No's own hidden checkbox (two) and the autofill uploader's file input: no field, but counted.
    expect(result.counters.hiddenControlsIgnored).toBe(3);
    expect(result.unrecognisedUploads).toEqual([]);
    expect(result.fields.some((field) => /start typing|pick date|type here/i.test(field.label))).toBe(false);
    expect(page.target('When can you start a new role?').field.constraints).toMatchObject({ format: 'date',
      pattern: 'MM/DD/YYYY' });
    expect(page.events.events.filter((event) => !event.trusted)).toEqual([]);
  });

  it('answers a Yes/No with one click() on its button, read back by aria-pressed, and never clicks a pressed one', async () => {
    const page = await open();
    const target = page.target(AUTHORIZED);
    expect(target.widget).toMatchObject({ kind: 'radio', declared: true });
    expect(target.field.options).toMatchObject([{ label: 'Yes' }, { label: 'No' }]);
    expect(await fillWidget(target, optionOf(target, 'Yes'), page.ctx())).toEqual({ wrote: true,
      verification: 'verified', reason: 'ok', needsUserAction: false });
    await until(page.fixture, () => page.log.values[PATHS.authorized] === true);
    const yes = page.entry(PATHS.authorized).querySelector('button[data-option="yes"]')!;
    expect(yes.getAttribute('aria-pressed')).toBe('true');
    expect(page.target(AUTHORIZED).field.current).toEqual({ kind: 'selected', labels: ['Yes'] });
    // Pressed already: no second click, which would clear the answer.
    const clicks = () => page.events.events.filter((event) => event.type === 'click').length;
    const before = clicks();
    const again = page.target(AUTHORIZED);
    expect(await fillWidget(again, optionOf(again, 'Yes'), page.ctx())).toMatchObject({ wrote: false, reason: 'already-correct' });
    expect(clicks()).toBe(before);
    expect(page.log.values[PATHS.authorized]).toBe(true);
    expectOurEventsOnly(page.events);
  });

  it('ticks a radio and a checkbox group with click() on their inputs, reads the span, and never re-clicks a chosen radio', async () => {
    const page = await open();
    const heard = page.target('How did you hear about us?');
    expect(heard.field).toMatchObject({ kind: 'radio', visibility: 'hidden-native-with-visible-label', proxy: 'label' });
    expect(fill(heard, optionOf(heard, 'LinkedIn'), { adapter: ashbyAdapter, root: page.root })).toMatchObject({
      wrote: true, verification: 'verified' });
    await until(page.fixture, () => page.log.values[PATHS.heard] === 'LinkedIn');
    const again = page.target('How did you hear about us?');
    expect(again.field.current).toEqual({ kind: 'selected', labels: ['LinkedIn'] });
    expect(fill(again, optionOf(again, 'LinkedIn'), { adapter: ashbyAdapter, root: page.root })).toMatchObject({
      wrote: false, reason: 'already-correct' });
    expect(page.log.values[PATHS.heard]).toBe('LinkedIn');
    const skills = page.target('Which of these skills have you used?');
    expect(fill(skills, { kind: 'options', indices: [0, 2], cleanLabels: ['TypeScript', 'PostgreSQL'] },
      { adapter: ashbyAdapter, root: page.root })).toMatchObject({ wrote: true, verification: 'verified' });
    await until(page.fixture, () => JSON.stringify(page.log.values[PATHS.skills]) === '["TypeScript","PostgreSQL"]');
    // A box set by .checked alone is not chosen as Ashby draws it, and its read-back says so.
    const ruby = page.entry(PATHS.skills).querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]!;
    ruby.checked = true;
    expect(page.target('Which of these skills have you used?').field.current).toEqual({ kind: 'selected',
      labels: ['TypeScript', 'PostgreSQL'] });
    const clicks = page.events.events.filter((event) => event.type === 'click').map((event) => event.target);
    expect(clicks.every((id) => id.includes('-labeled-'))).toBe(true);
    expectOurEventsOnly(page.events);
  });

  it('opens a ValueSelect with its toggle, reads its portal list (the page aria-hidden meanwhile), closes it with Escape', async () => {
    const page = await open();
    const target = page.target(DEGREE);
    expect(target.widget).toMatchObject({ kind: 'combobox', declared: true, keys: ['Escape'], hidesFormWhileOpen: true });
    expect(expandedState(target.widget!)).toBe(false);
    const read = await readWidget(target, page.ctx());
    expect(read).toMatchObject({ status: 'read', reading: { kind: 'options' } });
    expect(read.status === 'read' && read.reading.kind === 'options' ? read.reading.options.map((option) => option.label)
      : []).toHaveLength(10);
    expect(page.fixture.doc.querySelector('[data-floating-ui-portal]')).toBeNull();
    expect(page.fixture.doc.querySelector('[data-aria-hidden]')).toBeNull();
    const input = page.entry(PATHS.degree).querySelector('input')!;
    expect(page.events.on('').length).toBe(0);
    const typesOn = (type: string) => page.events.events.filter((event) => event.type === type).length;
    expect(typesOn('keydown')).toBe(1);
    expect(typesOn('click')).toBe(1);
    // Choose: the toggle again, the option clicked, the list closed by the page; read back from the input.
    const planned = page.target(DEGREE);
    expect(planned.field.options).not.toBe('lazy');
    expect(await fillWidget(planned, optionOf(planned, "Bachelor's Degree"), page.ctx())).toEqual({ wrote: true,
      verification: 'verified', reason: 'ok', needsUserAction: false });
    expect(input.value).toBe("Bachelor's Degree");
    expect(page.log.values[PATHS.degree]).toBe("Bachelor's Degree");
    expect(widgetHolds(page.target(DEGREE), optionOf(page.target(DEGREE), "Bachelor's Degree"))).toBe(true);
    // The highlighted first option said aria-selected="true" before anything was chosen: never read as the answer.
    expect(page.target(DEGREE).field.current).toEqual({ kind: 'selected', labels: ["Bachelor's Degree"] });
    expect(page.fixture.doc.querySelector('[data-aria-hidden]')).toBeNull();
    expectOurEventsOnly(page.events);
  });

  it('searches Location, closes its list before each later query, and chooses the place; School reads back by its name', async () => {
    const page = await open();
    const location = page.target(LOCATION);
    expect(location.widget).toMatchObject({ kind: 'typeahead-remote', declared: true });
    const seen: string[][] = [];
    const guardLabels: string[] = [];
    const hooks: TypeaheadHooks = {
      guard: async () => {
        // The guard's fresh scan sees the form as a person does: no list open over it, so the field keeps its title.
        expect(page.fixture.doc.querySelector('[data-aria-hidden]')).toBeNull();
        const target = page.target(LOCATION);
        guardLabels.push(target.field.label);
        return { ok: true, target };
      },
      match: async (results) => {
        seen.push(results.map((result) => result.label));
        const index = results.findIndex((result) => result.label === 'Austin, Texas, United States');
        return index < 0 ? { choose: null, reason: 'no-match', blocked: false }
          : { choose: { index, cleanLabel: 'Austin, Texas, United States' } };
      },
    };
    const result = await searchTypeahead(location, ['Austin, TX', 'Austin, Texas'], page.ctx(), hooks);
    expect(result).toMatchObject({ verified: true, reason: 'ok', typed: 2 });
    expect(guardLabels).toEqual([LOCATION, LOCATION]);
    expect(page.log.places).toEqual(['Austin, TX', 'Austin, Texas']);
    expect(seen.at(-1)).toContain('Austin, Texas, United States');
    expect(page.entry('_systemfield_location').querySelector('input')!.value).toBe('Austin, Texas, United States');
    expect(page.log.values._systemfield_location).toBe('Austin, Texas, United States');
    // School: its results show the name, the country and the domain; its box then holds the name alone.
    const school = page.target('School');
    const schoolHooks: TypeaheadHooks = {
      guard: async () => ({ ok: true, target: page.target('School') }),
      match: async (results) => {
        // Each result labelled by its name alone (optionLabel), as the box will hold it.
        expect(results.map((each) => each.label)).toEqual(['The University of Texas at Austin']);
        return { choose: { index: 0, cleanLabel: 'The University of Texas at Austin' } };
      },
    };
    const chosen = await searchTypeahead(school, ['The University of Texas at Austin'], page.ctx(), schoolHooks);
    expect(chosen).toMatchObject({ verified: true, reason: 'ok' });
    const box = page.entry('_systemfield_education_history').querySelector<HTMLInputElement>('input[role="combobox"]')!;
    expect(box.value).toBe('The University of Texas at Austin');
    expectOurEventsOnly(page.events);
    // The only keys: Escape, to the comboboxes' own inputs, while each said it was open.
    expect(page.events.events.filter((event) => event.type === 'keydown').every((event) => event.target === 'input')).toBe(true);
  });

  it('writes the date MM/DD/YYYY without opening its calendar', async () => {
    const page = await open();
    const target = page.target('When can you start a new role?');
    expect(fill(target, { kind: 'text', text: '12/01/2026' }, { adapter: ashbyAdapter, root: page.root }))
      .toMatchObject({ wrote: true, verification: 'verified' });
    await until(page.fixture, () => page.log.values[PATHS.start] === '2026-12-01');
    expect(page.log.calendars).toBe(0);
    expectOurEventsOnly(page.events);
  });

  it("adds an Education block with its add button, and writes a block's month before its year", async () => {
    const page = await open();
    const [education] = ashbyAdapter.repeatables!(page.root);
    expect(education!.kind).toBe('education');
    expect(education!.blocks()).toHaveLength(1);
    expect(clickIfAllowed(education!.addButton()!, { adapter: ashbyAdapter, root: page.root })).toBe(true);
    await until(page.fixture, () => education!.blocks().length === 2);
    expect(page.scanned().fields.filter((field) => field.label === 'School').map((field) => field.section))
      .toEqual([{ id: 'education', block: 0 }, { id: 'education', block: 1 }]);
    const month = page.target('Start Date month');
    expect(fill(month, optionOf(month, 'August'), { adapter: ashbyAdapter, root: page.root })).toMatchObject({ wrote: true });
    // A month chose this year too.
    await until(page.fixture, () => (page.target('Start Date year').control as HTMLSelectElement).value
      === String(new Date().getFullYear()));
    const year = page.target('Start Date year');
    expect(fill(year, optionOf(year, '2015'), { adapter: ashbyAdapter, root: page.root })).toMatchObject({ wrote: true,
      verification: 'verified' });
    await until(page.fixture, () => JSON.stringify(page.log.values['_systemfield_education_history[0].startDate'])
      === '{"m":"8","y":"2015"}');
    expectOurEventsOnly(page.events);
  });

  it('never presses Submit, the uploads, Delete, the autofill uploader or the tabs; presses what it fills', async () => {
    const page = await open();
    const ctx = { adapter: ashbyAdapter, root: page.root };
    const doc = page.fixture.doc;
    expect(assertNotSubmit(ashbyAdapter.submitButton!(page.root)!, ctx)).toEqual({ ok: false, refusal: 'adapter-submit' });
    expect(ashbyAdapter.isFinalStep!(doc)).toBe('final');
    for (const selector of ['.ashby-application-form-autofill-input-root button', '.ashby-application-form-autofill-input-root input',
      '.ashby-application-form-input-file-dropzone-upload', '.ashby-application-form-input-education-entry-delete',
      'a#job-overview', 'a#job-application-form']) {
      expect(assertNotSubmit(doc.querySelector(selector)!, ctx), selector).toEqual({ ok: false, refusal: 'adapter-never-press' });
    }
    for (const selector of ['button.ashby-application-form-input-yesno-option', 'button[class*="_toggleButton_"]',
      'button.ashby-application-form-input-education-add', 'input[type="radio"]', 'input[type="checkbox"]']) {
      expect(assertNotSubmit(doc.querySelector(selector)!, ctx), selector).toEqual({ ok: true });
    }
    expect(ashbyAdapter.uploadWidgets!(page.root).map((widget) => [widget.input.id, widget.control.textContent]))
      .toEqual([['_systemfield_resume', 'Upload File']]);
    expect(page.log.pressed).toEqual([]);
    // The uploader's own input is no field and no flagged row (it is counted with the controls left out).
    const result = page.scanned();
    expect(result.fields.some((field) => field.kind === 'file' && field.idAttr === '')).toBe(false);
    expect(isUserVisible(doc.querySelector('.ashby-application-form-autofill-input-root button')!)).toBe(true);
  });

  it("reads a search Ashby answers 'No results' as empty well before the query's cap", async () => {
    const page = await open();
    const hooks: TypeaheadHooks = {
      guard: async () => ({ ok: true, target: page.target(LOCATION) }),
      match: async () => ({ choose: null, reason: 'no-match', blocked: false }),
    };
    const started = performance.now();
    const result = await searchTypeahead(page.target(LOCATION), ['Austin, TX'], page.ctx(), hooks);
    const took = performance.now() - started;
    expect(result).toMatchObject({ chosen: null, typed: 1 });
    // (The box then gets back what it held, which Ashby searches too.)
    expect(page.log.places[0]).toBe('Austin, TX');
    // The declared 1.5 s of "No results", not the query's 3 s cap.
    expect(took).toBeLessThan(2_600);
    expect(took).toBeGreaterThan(1_400);
  });

  it("reads a resume's upload as Ashby shows it: confirmed, failed by its toast, or pending", async () => {
    const put = (page: Page) => {
      const input = page.fixture.doc.getElementById('_systemfield_resume') as HTMLInputElement;
      const file = new File(['%PDF-1.7'], 'Resume.pdf', { type: 'application/pdf' });
      const holder = new DataTransfer();
      holder.items.add(file);
      input.files = holder.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return input;
    };
    // The page's server answers 200 ms after the file goes in (its file item shows at once): the quiet window is longer.
    const fast = { quietMs: 600, capMs: 3_000 };

    const done = await open();
    const input = put(done);
    // The file item shows at once, before the upload has answered: not yet confirmed.
    await until(done.fixture, () => done.fixture.doc.querySelector('.ashby-application-form-input-file-item') !== null);
    expect(await awaitUpload(ashbyAdapter, input, 'Resume.pdf', undefined, fast)).toBe('confirmed');
    expect(done.log.uploads).toEqual([{ name: 'Resume.pdf', ok: true }]);
    // Another file's name is not this one's confirmation; an input outside an upload question reads no upload.
    expect(ashbyAdapter.uploadState!(input, 'Other.pdf')).toBe('pending');
    const name = done.fixture.doc.getElementById('_systemfield_name') as HTMLInputElement;
    expect(ashbyAdapter.uploadState!(name, 'Resume.pdf')).toBeNull();
    for (const unmount of mounted.splice(0)) unmount();
    removeFixtures(document);

    const failed = await open(0, { uploadFails: true });
    const failing = put(failed);
    expect(await awaitUpload(ashbyAdapter, failing, 'Resume.pdf', undefined, fast)).toBe('failed');
    expect(failed.fixture.doc.querySelector('[class*="_toast_"]')?.textContent).toBe('ErrorResume.pdf failed to upload');
    // Its file item names the file all the same.
    expect(failed.fixture.doc.querySelector('.ashby-application-form-input-file-item-name')?.textContent).toBe('Resume.pdf');
    for (const unmount of mounted.splice(0)) unmount();
    removeFixtures(document);

    // A page that shows nothing of the file (no file item, no toast): the wait ends at its cap, pending.
    const waiting = await open();
    const held = waiting.fixture.doc.getElementById('_systemfield_resume') as HTMLInputElement;
    const started = performance.now();
    expect(await awaitUpload(ashbyAdapter, held, 'Resume.pdf', undefined, { quietMs: 200, capMs: 800 })).toBe('pending');
    expect(performance.now() - started).toBeGreaterThan(700);
  });

  it('reads two one-box questions whose boxes share a label as two questions, never one group', async () => {
    const page = await open();
    // A second one-box question beside the data consent, its one box also "I agree" (Ashby names each box by its
    // label, and there is no <form>).
    const entry = page.entry(PATHS.consent);
    const copy = entry.cloneNode(true) as Element;
    copy.setAttribute('data-field-path', 'second_consent');
    const title = copy.querySelector('label.ashby-application-form-question-title')!;
    title.setAttribute('for', 'second_consent');
    title.textContent = 'Marketing consent';
    const box = copy.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    box.id = 'second-consent-box';
    copy.querySelector('label[for]:not(.ashby-application-form-question-title)')!.setAttribute('for', box.id);
    const first = entry.querySelector<HTMLInputElement>('input[type="checkbox"]')!.id;
    entry.after(copy);
    // Each a lone box named by its own label (its title its description), as one alone is.
    const fields = page.scanned().fields;
    expect(fields.filter((field) => field.options !== 'lazy' && field.options.some((option) => option.label === 'I agree')))
      .toEqual([]);
    const boxes = fields.filter((field) => field.label === 'I agree');
    expect(boxes.map((field) => [field.idAttr, field.kind])).toEqual([[first, 'checkbox'], [box.id, 'checkbox']]);
  });
});
