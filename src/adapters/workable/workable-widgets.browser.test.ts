/*
 * Workable's widgets, on fixtures/synthetic/workable-widgets (app.ts says what it reproduces from the capture of
 * 2026-11-02), through the Workable adapter's hooks and the fillers and widget helpers, driven only by calling them:
 * - a dropdown whose text box is readonly="true" by design (readOnlyBox): read and written, opened by click() on its
 *   box, its list read in place, closed by the declared Escape sent to the list itself (keyTarget 'list': focusout and
 *   blur do not close it), an option chosen by click() and read back from the box's value;
 * - the phone's country button: its list read, a country chosen, read back by the button's title and dial code;
 * - the date mask: one Escape keydown and keyup before the text write and one after (keyAroundWrite), the value taken,
 *   the calendar the page then opened closed, never an Enter; without the adapter's key the mask refuses the write;
 * - the number box: "85000" drawn "85,000", read back as a number;
 * - a Yes/No, a radio and a checkbox group answered by click() on their hidden inputs, read back at once by the
 *   role=radio or role=checkbox element's aria-checked (the input's own checked follows a render later);
 * - the GDPR consent: required, labelled by its own text once (not twice through its two labels), ticked;
 * - Resume and Photo told apart by their questions, never by "Choose file"; a file's upload read as the page shows it
 *   (uploadState, awaitUpload): pending while it goes, confirmed once the drop zone names the file with its Remove
 *   file button, failed when an alert names it, or once the page fell over (the form gone);
 * - the Education and Experience editors: each block its section (Education 1, Experience 1), MM/YYYY dates written
 *   with the keys around them, and the block's own Update pressed once the fill wrote into it and left no required field
 *   open (saveBlocks), the entry then kept by the page; a block with its required field open left for the person; the
 *   blocks numbered with the saved entries first, then the editor live Workable draws at the top of its list (jr8);
 * - the buttons never pressed, and Submit.
 * Every event is untrusted, and is the fillers' or a declared key: never a mousedown, a mouseup, a pointer event or a
 * focus of ours.
 */
import { afterEach, describe, expect, it } from 'vitest';
import pageExpect from '../../../fixtures/synthetic/workable-widgets/index.expect.json';
import pageHtml from '../../../fixtures/synthetic/workable-widgets/index.html?raw';
import { IDS, mountWorkablePage, newLog, type Uploader, type WorkableLog } from '../../../fixtures/synthetic/workable-widgets/app';
import { sectionKey } from '../../core/text/keys';
import type { BaseKey } from '../../core/types/field';
import type { FillResult } from '../../core/types/fill';
import { saveBlocks, sectionsOf } from '../../content/repeatables';
import { assertNotSubmit, fill } from '../../dom/fillers';
import { ALLOWED_EVENTS } from '../../dom/fillers/events';
import { awaitUpload } from '../../dom/fillers/upload';
import { loadFixture, logEvents, removeFixtures, untrustedViolations, type EventLog, type Fixture } from '../../dom/fixture.testkit';
import { scan } from '../../dom/scan';
import { quietWait } from '../../dom/settle';
import type { FieldTarget, ScanResult, WidgetReading } from '../../dom/types';
import { isUserVisible } from '../../dom/visibility';
import { expandedState, fillWidget, newReadiness, readWidget, widgetHolds } from '../../dom/widgets';
import { genericAdapter } from '../generic';
import { compareWithExpectation, readExpectation } from '../test/expectations.testkit';
import { workableAdapter, workableSubmitted } from './index';

interface Page {
  fixture: Fixture;
  readonly root: Element;
  log: WorkableLog;
  events: EventLog;
  readings: Map<BaseKey, WidgetReading>;
  scanned(): ScanResult;
  /** The live target of the field with this label. */
  target(label: string): FieldTarget;
  ctx(): { adapter: typeof workableAdapter; root: Element; readings: Map<BaseKey, WidgetReading>;
    readiness: ReturnType<typeof newReadiness> };
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
async function open(drawAfterMs = 0, adapter: typeof workableAdapter = workableAdapter, height = 3600,
  upload?: Uploader): Promise<Page> {
  const fixture = await loadFixture(document, pageHtml.replace(/<script[^>]*><\/script>/, ''), { width: 1280, height });
  const log = newLog();
  mounted.push(mountWorkablePage(fixture.doc.getElementById('wk-app')!, { log, drawAfterMs, ...(upload ? { upload } : {}) })
    .unmount);
  if (drawAfterMs === 0) await until(fixture, () => workableAdapter.detect(fixture.doc) !== null);
  const readings = new Map<BaseKey, WidgetReading>();
  const readiness = newReadiness();
  const events = logEvents(fixture.doc);
  const rootNow = () => workableAdapter.detect(fixture.doc)!.formRoot;
  const scanned = () => scan(rootNow(), adapter, { platform: 'workable', widgetReadings: readings });
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
    ctx: () => ({ adapter, root: rootNow(), readings, readiness }),
  };
}

/** Untrusted events only, each the fillers' or a declared key: never a mouse or pointer event, never a focus of ours.
 *  The page's own focus of a dropdown's list is trusted, and allowed. */
function expectOurEventsOnly(log: EventLog): void {
  expect(untrustedViolations(log.events).filter((event) => !['focus', 'focusin', 'blur', 'focusout'].includes(event.type)))
    .toEqual([]);
  const allowed = new Set<string>([...ALLOWED_EVENTS, 'keydown', 'keyup']);
  expect(log.events.filter((event) => !event.trusted && !allowed.has(event.type))).toEqual([]);
  expect(log.events.filter((event) => !event.trusted && ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'focus',
    'focusin'].includes(event.type))).toEqual([]);
}

/** The untrusted keys sent, as "<type> <key target>". */
function keysSent(log: EventLog): string[] {
  return log.events.filter((event) => !event.trusted && (event.type === 'keydown' || event.type === 'keyup'))
    .map((event) => `${event.type} ${event.target}`);
}

/** The option of a field with this label, as a planned write names it. */
function optionOf(target: FieldTarget, label: string): { kind: 'option'; index: number; cleanLabel: string } {
  const options = target.field.options === 'lazy' ? [] : target.field.options;
  const index = options.findIndex((option) => option.label === label);
  if (index < 0) throw new Error(`no option ${label}: ${options.map((option) => option.label).join(' | ')}`);
  return { kind: 'option', index, cleanLabel: label };
}

const HEARD = 'How did you hear about us?';
const AUTHORIZED = 'Are you legally authorized to work in the United States?';
const DEGREE = 'What is the highest level of education you have completed?';
const SKILLS = 'Which of these skills have you used?';
const CONSENT = 'I have read, understand and accept the content of the Privacy Notice and consent to the processing of my data as part of this application.';

describe("Workable's widgets, as the adapter declares them", () => {
  it('is no form until React draws it, then meets its hand-written expectations', async () => {
    const page = await open(400);
    expect(workableAdapter.detect(page.fixture.doc)).toBeNull();
    await until(page.fixture, () => workableAdapter.detect(page.fixture.doc) !== null);
    const result = page.scanned();
    expect(compareWithExpectation(page.fixture.doc, result, readExpectation(pageExpect))).toEqual([]);
    expect(result.unrecognisedUploads).toEqual([]);
    // The date's layout is the adapter's (its inputmode="tel" is a keypad), the number box a number.
    expect(page.target('Earliest Start Date').field.constraints).toMatchObject({ format: 'date', pattern: 'MM/DD/YYYY' });
    expect(page.target('Desired salary').field.constraints).toMatchObject({ format: 'number' });
    // The dropdowns are not read-only (readOnlyBox), their hidden value inputs no field; the autofill box holds none.
    expect(page.target(HEARD).field).toMatchObject({ kind: 'combobox', readOnly: false, options: 'lazy' });
    expect(page.target(HEARD).widget).toMatchObject({ declared: true, keyTarget: 'list', readOnlyBox: true, keys: ['Escape'] });
    expect(page.events.events.filter((event) => !event.trusted)).toEqual([]);
  });

  it('reads and chooses a dropdown: click() on its box, its list read in place, Escape to the list, read back', async () => {
    const page = await open();
    const target = page.target(HEARD);
    expect(expandedState(target.widget!)).toBe(false);
    const read = await readWidget(target, page.ctx());
    expect(read.status === 'read' && read.reading.kind === 'options' ? read.reading.options.map((option) => option.label)
      : []).toEqual(['LinkedIn', 'Indeed', 'A friend', 'Other']);
    // Closed by the Escape sent to the list (the page's focus moved there), after focusout and blur did nothing.
    expect(page.fixture.doc.getElementById(`input_${IDS.heard}_listbox`)).toBeNull();
    expect(keysSent(page.events)).toEqual([`keydown input_${IDS.heard}_listbox`, `keyup input_${IDS.heard}_listbox`]);
    expect(page.log.opened[IDS.heard]).toBe(1);
    const planned = page.target(HEARD);
    expect(await fillWidget(planned, optionOf(planned, 'LinkedIn'), page.ctx())).toEqual({ wrote: true,
      verification: 'verified', reason: 'ok', needsUserAction: false });
    expect(page.fixture.doc.querySelector<HTMLInputElement>(`#input_${IDS.heard}_input`)!.value).toBe('LinkedIn');
    expect(page.log.values[IDS.heard]).toBe('6133432');
    expect(widgetHolds(page.target(HEARD), optionOf(page.target(HEARD), 'LinkedIn'))).toBe(true);
    expect(page.target(HEARD).field.current).toEqual({ kind: 'selected', labels: ['LinkedIn'] });
    // A choice closes the list itself: no second Escape.
    expect(keysSent(page.events)).toHaveLength(2);
    expectOurEventsOnly(page.events);
  });

  it('keeps every other read-only control read-only: a dropdown marked aria-readonly, and a native readonly box', async () => {
    const page = await open();
    const doc = page.fixture.doc;
    // readOnlyBox sets aside the dropdown's own readonly attribute only, never an aria-readonly="true" the page sets.
    doc.getElementById(`input_${IDS.heard}_input`)!.setAttribute('aria-readonly', 'true');
    expect(page.target(HEARD).field).toMatchObject({ kind: 'combobox', readOnly: true });
    // A plain text box made readonly on Workable is read-only as anywhere else.
    doc.getElementById('headline')!.setAttribute('readonly', '');
    expect(page.target('Headline').field.readOnly).toBe(true);
    // The other dropdown is untouched.
    expect(page.target('How many years of software engineering experience do you have?').field.readOnly).toBe(false);
  });

  it('reads and chooses a dropdown below the fold, its list drawn fixed beyond the viewport (listFollowsField)', async () => {
    const page = await open(0, workableAdapter, 700);
    const target = page.target(HEARD);
    expect(target.widget).toMatchObject({ listFollowsField: true });
    const box = page.fixture.doc.querySelector(`#input_${IDS.heard}_input`)!.getBoundingClientRect();
    expect(box.top).toBeGreaterThan(700);
    // Without the declaration the list, fixed beyond the viewport, is no list a person sees: nothing is read, and the
    // Escape that closes it goes nowhere (as the live check of 2026-11-02 first found).
    const plain = { ...workableAdapter, widgetFor: (control: Element) => {
      const decl = workableAdapter.widgetFor!(control);
      return decl === null ? null : { ...decl, listFollowsField: undefined };
    } };
    const unmarked = scan(page.root, plain, { platform: 'workable' }).fields.find((field) => field.label === HEARD)!;
    const unread = await readWidget(scan(page.root, plain, { platform: 'workable' }).target(unmarked.key)!,
      { ...page.ctx(), adapter: plain });
    expect(unread.status).toBe('unread');
    expect(page.fixture.doc.querySelector(`#input_${IDS.heard}_input`)!.getAttribute('aria-expanded')).toBe('true');
    // The adapter's own declaration closes it again, with the Escape to the list.
    await readWidget(page.target(HEARD), page.ctx());
    expect(page.fixture.doc.getElementById(`input_${IDS.heard}_listbox`)).toBeNull();
    page.log.opened[IDS.heard] = 0;
    const read = await readWidget(target, page.ctx());
    expect(read.status === 'read' && read.reading.kind === 'options' ? read.reading.options.length : 0).toBe(4);
    expect(page.fixture.doc.getElementById(`input_${IDS.heard}_listbox`)).toBeNull();
    const planned = page.target(HEARD);
    expect(await fillWidget(planned, optionOf(planned, 'LinkedIn'), page.ctx())).toMatchObject({ wrote: true,
      verification: 'verified' });
    expect(page.log.values[IDS.heard]).toBe('6133432');
    expectOurEventsOnly(page.events);
    // A fixed box no declared widget names stays judged as fixed: off the viewport, hidden.
    const stray = page.fixture.doc.createElement('div');
    stray.textContent = 'Off the viewport';
    stray.style.cssText = 'position: fixed; top: 1600px; left: 10px; width: 200px; height: 40px;';
    page.fixture.doc.body.append(stray);
    expect(isUserVisible(stray)).toBe(false);
  });

  it('chooses the phone country from its list, read back by the button title and dial code', async () => {
    const page = await open();
    const country = page.target('Phone country code');
    expect(country.widget).toMatchObject({ kind: 'combobox', declared: true, keyTarget: 'list' });
    expect(country.field.current).toEqual({ kind: 'selected', labels: ['United States (+1)'] });
    const read = await readWidget(country, page.ctx());
    expect(read.status === 'read' && read.reading.kind === 'options' ? read.reading.options.map((option) => option.label)
      .slice(0, 3) : []).toEqual(['United States (+1)', 'United Kingdom (+44)', 'Canada (+1)']);
    expect(page.fixture.doc.getElementById('iti-0__country-selector')!.classList.contains('iti__hide')).toBe(true);
    expect(keysSent(page.events)).toEqual(['keydown iti-0__country-listbox', 'keyup iti-0__country-listbox']);
    const planned = page.target('Phone country code');
    expect(await fillWidget(planned, optionOf(planned, 'Canada (+1)'), page.ctx())).toMatchObject({ wrote: true,
      verification: 'verified' });
    expect(page.fixture.doc.querySelector('.iti__selected-country')!.getAttribute('title')).toBe('Canada');
    expect(page.target('Phone country code').field.current).toEqual({ kind: 'selected', labels: ['Canada (+1)'] });
    // The number then, written nationally and drawn by the page.
    const phone = page.target('Phone');
    expect(fill(phone, { kind: 'text', text: '512 555 0147' }, { adapter: workableAdapter, root: page.root }))
      .toMatchObject({ wrote: true, verification: 'verified' });
    expect(page.fixture.doc.querySelector<HTMLInputElement>('#input_phone')!.value).toBe('512-555-0147');
    expectOurEventsOnly(page.events);
  });

  it('writes the date with one Escape before and one after: the mask takes it, the calendar it opened closes', async () => {
    const page = await open();
    const date = page.target('Earliest Start Date');
    expect(fill(date, { kind: 'text', text: '12/01/2026' }, { adapter: workableAdapter, root: page.root })).toMatchObject({
      wrote: true, verification: 'verified' });
    await until(page.fixture, () => page.log.values[IDS.start] === '12/01/2026');
    expect(page.log).toMatchObject({ enters: 0, refusedWrites: 0, calendars: 0, typedCalendars: 1, calendarOpen: false });
    expect(page.fixture.doc.querySelector('.react-datepicker-popper')).toBeNull();
    expect(keysSent(page.events)).toEqual([`keydown ${IDS.start}`, `keyup ${IDS.start}`, `keydown ${IDS.start}`,
      `keyup ${IDS.start}`]);
    expect(page.events.events.filter((event) => event.type === 'keydown').every((event) => event.target === IDS.start))
      .toBe(true);
    expectOurEventsOnly(page.events);
  });

  it('a date mask refuses the write without the adapter key, as the generic adapter would write it', async () => {
    const page = await open(0, genericAdapter as typeof workableAdapter);
    const result = page.scanned();
    // The generic reading: its wrapping label, and a phone's keypad (inputmode="tel") for its format.
    const date = result.fields.find((field) => field.label === 'Earliest Start Date')!;
    expect(date.constraints).toMatchObject({ format: 'tel', pattern: 'MM/DD/YYYY' });
    const target = result.target(date.key)!;
    expect(fill(target, { kind: 'text', text: '12/01/2026' }, { adapter: genericAdapter, root: page.root })).toMatchObject({
      wrote: false });
    expect(page.log).toMatchObject({ refusedWrites: 1, typedCalendars: 0 });
    expect(page.log.values[IDS.start]).toBeUndefined();
    expect(keysSent(page.events)).toEqual([]);
  });

  it('writes the number box: "85000" drawn "85,000", read back as a number', async () => {
    const page = await open();
    const salary = page.target('Desired salary');
    expect(fill(salary, { kind: 'text', text: '85000' }, { adapter: workableAdapter, root: page.root })).toMatchObject({
      wrote: true, verification: 'verified' });
    expect(page.fixture.doc.querySelector<HTMLInputElement>(`input[name="${IDS.salary}"]`)!.value).toBe('85,000');
    expect(page.log.values[IDS.salary]).toBe(85000);
    expect(keysSent(page.events)).toEqual([]);
  });

  it('answers a Yes/No, a radio and a checkbox group with click() on their inputs, read back at once by aria-checked', async () => {
    const page = await open();
    const authorized = page.target(AUTHORIZED);
    expect(authorized.field).toMatchObject({ kind: 'radio', proxy: 'label', options: [{ label: 'YES' }, { label: 'NO' }] });
    expect(fill(authorized, optionOf(authorized, 'YES'), { adapter: workableAdapter, root: page.root })).toMatchObject({
      wrote: true, verification: 'verified' });
    // The input's own checked follows a render later: aria-checked said it at once.
    const yes = page.fixture.doc.querySelector<HTMLInputElement>(`input[name="${IDS.authorized}"][value="true"]`)!;
    expect(yes.closest('[role="radio"]')!.getAttribute('aria-checked')).toBe('true');
    await until(page.fixture, () => yes.checked);
    expect(page.log.values[IDS.authorized]).toBe(true);
    const again = page.target(AUTHORIZED);
    expect(fill(again, optionOf(again, 'YES'), { adapter: workableAdapter, root: page.root })).toMatchObject({
      wrote: false, reason: 'already-correct' });
    const degree = page.target(DEGREE);
    expect(fill(degree, optionOf(degree, "Bachelor's degree"), { adapter: workableAdapter, root: page.root })).toMatchObject({
      wrote: true, verification: 'verified' });
    expect(page.log.values[IDS.degree]).toBe("Bachelor's degree");
    const skills = page.target(SKILLS);
    expect(fill(skills, { kind: 'options', indices: [0, 2], cleanLabels: ['TypeScript', 'PostgreSQL'] },
      { adapter: workableAdapter, root: page.root })).toMatchObject({ wrote: true, verification: 'verified' });
    expect(page.log.values[IDS.skills]).toEqual(['TypeScript', 'PostgreSQL']);
    // A box set by .checked alone is put back by the page, and read as the page draws it: not chosen.
    const cobol = page.fixture.doc.querySelector(`[data-ui="${IDS.skills}"]`)!
      .querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[3]!;
    cobol.checked = true;
    expect(page.target(SKILLS).field.current).toEqual({ kind: 'selected', labels: ['TypeScript', 'PostgreSQL'] });
    // Every click went to an input, never to a Yes/No's option div.
    const clicks = page.events.events.filter((event) => event.type === 'click' && !event.trusted).map((event) => event.target);
    expect(clicks.every((target) => target !== 'div')).toBe(true);
    expectOurEventsOnly(page.events);
  });

  it('labels the GDPR consent by its own text once, requires it, and ticks it', async () => {
    const page = await open();
    const consent = page.target(CONSENT);
    expect(consent.field).toMatchObject({ kind: 'checkbox', required: true, labelSource: 'adapter' });
    expect(fill(consent, { kind: 'check' }, { adapter: workableAdapter, root: page.root })).toMatchObject({
      wrote: true, verification: 'verified' });
    expect(page.log.values.gdpr).toBe(true);
    // The generic adapter read it from both its labels, optional.
    const generic = scan(page.root, genericAdapter, { platform: 'workable' }).fields.find((field) => field.kind === 'checkbox');
    expect(generic).toMatchObject({ required: false, label: `${CONSENT} ${CONSENT}` });
  });

  it('tells Resume and Photo apart by their questions, never by "Choose file", and pairs each with its button', async () => {
    const page = await open();
    const result = page.scanned();
    const files = result.fields.filter((field) => field.kind === 'file');
    expect(files.map((field) => [field.label, field.labelSource])).toEqual([['Photo', 'aria-labelledby'],
      ['Resume', 'aria-labelledby']]);
    expect(workableAdapter.uploadWidgets!(page.root).map(({ control, input }) => [control.textContent,
      input.getAttribute('data-ui')])).toEqual([['Choose file', 'avatar'], ['Choose file', 'resume']]);
    // The generic adapter names both "Choose file".
    const generic = scan(page.root, genericAdapter, { platform: 'workable' }).fields.filter((field) => field.kind === 'file');
    expect(generic.map((field) => field.label)).toEqual(['Choose file', 'Choose file']);
  });

  it("reads a file's upload as the page shows it: pending while it goes, then confirmed, or failed (the page falls over)",
    async () => {
      const put = (page: Page): HTMLInputElement => {
        const input = page.fixture.doc.querySelector<HTMLInputElement>('input[data-ui="resume"]')!;
        const holder = new DataTransfer();
        holder.items.add(new File(['%PDF-1.7'], 'Resume.pdf', { type: 'application/pdf' }));
        input.files = holder.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return input;
      };
      const fast = { quietMs: 300, capMs: 3_000 };
      let answer: (ok: boolean) => void = () => undefined;
      const done = await open(0, workableAdapter, 3600, () => new Promise((resolve) => {
        answer = resolve;
      }));
      const input = put(done);
      await until(done.fixture, () => done.fixture.doc.querySelector('[role="progressbar"]') !== null);
      expect(workableAdapter.uploadState!(input, 'Resume.pdf')).toBe('pending');
      answer(true);
      expect(await awaitUpload(workableAdapter, input, 'Resume.pdf', undefined, fast)).toBe('confirmed');
      expect(done.log.uploads).toEqual([{ field: 'resume', name: 'Resume.pdf', ok: true }]);
      // Another file's name is not this one's; an input that is no upload reads none; Remove file is never pressed.
      expect(workableAdapter.uploadState!(input, 'Other.pdf')).toBe('pending');
      expect(workableAdapter.uploadState!(done.fixture.doc.getElementById('firstname') as HTMLInputElement, 'Resume.pdf'))
        .toBeNull();
      const remove = done.fixture.doc.querySelector('button[aria-label="Remove file"]')!;
      expect(assertNotSubmit(remove, { adapter: workableAdapter, root: done.root }).ok).toBe(false);
      for (const unmount of mounted.splice(0)) unmount();
      removeFixtures(document);

      // The bucket refuses it: the alert names the file (failed at once), then the page falls over (still failed).
      const failed = await open(0, workableAdapter, 3600, () => Promise.resolve(false));
      const failing = put(failed);
      expect(await awaitUpload(workableAdapter, failing, 'Resume.pdf', undefined, fast)).toBe('failed');
      expect(failed.fixture.doc.querySelector('[role="alert"]')?.textContent).toContain('Resume.pdf failed to upload');
      await until(failed.fixture, () => failed.log.crashed);
      expect(workableAdapter.detect(failed.fixture.doc)).toBeNull();
      expect(workableAdapter.uploadState!(failing, 'Resume.pdf')).toBe('failed');
    });

  it('never presses Submit, the autofill box, Clear, "Choose file", the cookie banner or the tabs', async () => {
    const page = await open();
    const doc = page.fixture.doc;
    const never = workableAdapter.neverPress!(page.root);
    const ctx = { adapter: workableAdapter, root: page.root };
    for (const selector of ['[data-ui="autofill-button"] button', '[data-ui="clear-section-0"]', 'label[role="button"][for]',
      '[data-ui="cookie-consent-accept"]', 'a[data-ui="role-overview-tab"]', 'a[data-ui="application-form-tab"]']) {
      const el = doc.querySelector(selector)!;
      expect(never.some((each) => each === el || each.contains(el)), selector).toBe(true);
      expect(assertNotSubmit(el, ctx).ok, selector).toBe(false);
    }
    const submit = workableAdapter.submitButton!(page.root)!;
    expect(submit.textContent).toBe('Submit application');
    expect(assertNotSubmit(submit, ctx).ok).toBe(false);
    // The allowed controls: a dropdown's box, the phone's country button, a radio, "+ Add".
    for (const selector of [`#input_${IDS.heard}_input`, '.iti__selected-country', `input[name="${IDS.authorized}"]`]) {
      expect(assertNotSubmit(doc.querySelector(selector)!, ctx).ok, selector).toBe(true);
    }
    expect(workableSubmitted(doc)).toBe(false);
    expect(page.log.pressed).toEqual([]);
  });

  it("keeps an editor's entry once its Update is pressed after the fill, and leaves one with a required field open", async () => {
    const page = await open();
    const states = (pageExpect as unknown as { states: Array<{ fields: unknown[] }> }).states;
    for (const kind of ['education', 'experience']) {
      page.fixture.doc.querySelector<HTMLElement>(`[data-ui="${kind}"] [data-ui="add-section"]`)!.click();
    }
    await until(page.fixture, () => page.fixture.doc.querySelectorAll('[data-ui="editor"]').length === 2);
    const opened = readExpectation({ ...pageExpect, fields: [...pageExpect.fields, ...states[0]!.fields] });
    expect(compareWithExpectation(page.fixture.doc, page.scanned(), opened)).toEqual([]);
    // Each editor is its section's block, and Add waits while it is open.
    const sections = sectionsOf(workableAdapter, page.root);
    expect(sections.map((section) => [section.kind, section.blocks().length, section.addButton()?.hasAttribute('disabled')]))
      .toEqual([['education', 1, true], ['experience', 1, true]]);
    expect(page.target('School').field.section).toEqual({ id: 'education', block: 0 });
    const ctx = { adapter: workableAdapter, root: page.root };
    expect(fill(page.target('School'), { kind: 'text', text: 'The University of Texas at Austin' }, ctx)).toMatchObject({
      wrote: true, verification: 'verified' });
    const start = page.scanned().fields.find((field) => field.label === 'Start date' && field.section.id === 'education')!;
    expect(start.constraints).toMatchObject({ format: 'month-year', pattern: 'MM/YYYY' });
    expect(fill(page.scanned().target(start.key)!, { kind: 'text', text: '08/2015' }, ctx)).toMatchObject({
      wrote: true, verification: 'verified' });
    expect(page.log.refusedWrites).toBe(0);
    const row = (section: string, required: boolean, wrote: boolean): FillResult => ({ key: 'k' as FillResult['key'],
      label: '', kind: 'text', category: 'unknown', section, required, status: wrote ? 'verified' : 'flagged',
      provenance: wrote ? 'profile' : null, matcherStage: 'not-applicable', confidence: 1, reason: wrote ? 'ok' : 'no-profile-value',
      wrote, verification: wrote ? 'verified' : 'not-applicable', needsUserAction: !wrote });
    const rows = [row(sectionKey({ id: 'education', block: 0 }), true, true),
      row(sectionKey({ id: 'experience', block: 0 }), true, false)];
    const env = { adapter: workableAdapter, root: page.root, signal: new AbortController().signal,
      settle: { quietMs: 50, capMs: 2_000 }, ours: () => true, touched: () => false };
    // A block the run did not open and did not find empty, or one the person touched, is never saved by the run.
    expect(await saveBlocks({ ...env, ours: () => false }, sections, rows)).toEqual({ saved: [], left: 2 });
    expect(await saveBlocks({ ...env, touched: () => true }, sections, rows)).toEqual({ saved: [], left: 2 });
    expect(page.log.entries.education).toBeUndefined();
    const saves = await saveBlocks(env, sections, rows);
    expect(saves).toEqual({ saved: ['education[0]'], left: 1 });
    expect(page.log.entries.education).toEqual([{ school: 'The University of Texas at Austin', start_date: '08/2015' }]);
    expect(page.log.entries.experience).toBeUndefined();
    // The saved entry is a block of its own (its summary), the experience's editor still open; Add is back.
    expect(sections[0]!.blocks()).toHaveLength(1);
    expect(sections[0]!.save!(sections[0]!.blocks()[0]!)).toBeNull();
    expect(sections[0]!.addButton()?.hasAttribute('disabled')).toBe(false);
    expect(page.fixture.doc.querySelector('[data-ui="experience"] [data-ui="editor"]')).not.toBeNull();
    // Its summary is read for the plan, as the live summary shows it: the school, matched by fingerprint.
    expect(workableAdapter.prefill!.readEntries!('education', sections[0]!.blocks())).toEqual([{ block: 0,
      values: [{ category: 'education.school', text: 'The University of Texas at Austin' }] }]);
    expect(page.log.pressed).toEqual([]);
    expectOurEventsOnly(page.events);
  });

  it('reads a saved entry restored from the draft as the live summary shows it, and an open editor as none', async () => {
    const fixture = await loadFixture(document, pageHtml.replace(/<script[^>]*><\/script>/, ''), { width: 1280,
      height: 3600 });
    const log = newLog();
    mounted.push(mountWorkablePage(fixture.doc.getElementById('wk-app')!, { log, restored: { experience: [
      { title: 'Software Engineer', company: 'Marrowgate Systems', start_date: '07/2019', end_date: '05/2021' }] } })
      .unmount);
    await until(fixture, () => workableAdapter.detect(fixture.doc) !== null);
    const root = workableAdapter.detect(fixture.doc)!.formRoot;
    const experience = sectionsOf(workableAdapter, root).find((section) => section.kind === 'experience')!;
    expect(fixture.doc.querySelector('[data-ui="experience"] dd[data-ui="period"]')?.textContent).toBe('July 2019 - May 2021');
    expect(workableAdapter.prefill!.readEntries!('experience', experience.blocks())).toEqual([{ block: 0, values: [
      { category: 'experience.title', text: 'Software Engineer' }, { category: 'experience.company', text: 'Marrowgate Systems' },
      { category: 'experience.startDate', text: 'July 2019' }] }]);
    experience.addButton()!.click();
    await until(fixture, () => experience.blocks().length === 2);
    // The editor is no summary. jr8: the page draws it at the top of the list, as live Workable does (snapshot9), and
    // the adapter numbers the saved entries first, so the restored entry stays block 0 and the editor is block 1.
    const items = Array.from(fixture.doc.querySelectorAll('[data-ui="experience"] > ul > li'));
    expect(items[0]!.querySelector('[data-ui="editor"]')).not.toBeNull();
    expect(experience.blocks()).toEqual([items[1], items[0]]);
    expect(workableAdapter.prefill!.readEntries!('experience', experience.blocks()).map((entry) => entry.block)).toEqual([0]);
  });

  it('reads the summaries the live capture saved (wk-education-saved, wk-experience-saved)', async () => {
    const fixture = await loadFixture(document, `<!doctype html><body><form data-ui="application-form">
      <div data-ui="section-fields"><div data-ui="education"><div><p id="education_label">Education</p>
      <button data-ui="add-section" aria-label="Add Education" type="button">+ Add</button></div><ul><li><div
      data-ui="group"><dl><dt>School</dt><dd data-ui="school"><span>Test University</span></dd></dl><dl
      data-ui="date-range"><dt>Period </dt><dd data-ui="period"><span>September 2018</span></dd></dl><div><div><a
      data-ui="edit-section" title="Edit" role="button" tabindex="0"></a><a data-ui="remove-section" title="Delete"
      role="button" tabindex="0"></a></div></div></div></li></ul></div><div data-ui="experience"><div><p
      id="experience_label">Experience</p><button data-ui="add-section" aria-label="Add Experience" type="button">+
      Add</button></div><ul><li><div data-ui="group"><dl><dt>Title</dt><dd data-ui="title"><span>Test Title</span></dd>
      </dl><dl><dt>Company</dt><dd data-ui="company"><span>Test Company</span></dd></dl><dl data-ui="date-range"><dt>Period
      </dt><dd data-ui="period"><span>September 2018</span></dd></dl></div></li></ul></div></div></form></body>`);
    const root = fixture.doc.querySelector('form')!;
    const [education, experience] = sectionsOf(workableAdapter, root);
    expect(workableAdapter.prefill!.readEntries!('education', education!.blocks())).toEqual([{ block: 0,
      values: [{ category: 'education.school', text: 'Test University' }] }]);
    expect(workableAdapter.prefill!.readEntries!('experience', experience!.blocks())).toEqual([{ block: 0, values: [
      { category: 'experience.title', text: 'Test Title' }, { category: 'experience.company', text: 'Test Company' },
      { category: 'experience.startDate', text: 'September 2018' }] }]);
    // A summary has no Save: never pressed, never filled.
    expect(education!.save!(education!.blocks()[0]!)).toBeNull();
  });

  it('numbers the saved entries first, then the editor live Workable draws at the top (jr8, snapshot9)', async () => {
    // The owner's capture of 2026-11-13 (snapshot9), its shape only: Experience's list holds the open editor first
    // (Add disabled), then the two entries kept, newest-added first. Values here are synthetic.
    const saved = (title: string, company: string, period: string) => `<li><div data-ui="group"><dl><dt>Title</dt><dd
      data-ui="title"><span>${title}</span></dd></dl><dl><dt>Company</dt><dd data-ui="company"><span>${company}</span></dd>
      </dl><dl data-ui="date-range"><dt>Period </dt><dd data-ui="period"><span>${period}</span></dd></dl><div><a
      data-ui="edit-section" title="Edit" role="button" tabindex="0">Edit</a><a data-ui="remove-section" title="Delete"
      role="button" tabindex="0">Delete</a></div></div></li>`;
    const box = (id: string, title: string, extra = '') => `<div><label><span><span><span id="${id}_label"><strong>${title}
      </strong></span></span></span><div data-role="illustrated-input"><div><input id="${id}" name="${id}"
      aria-labelledby="${id}_label" type="text" dir="auto" value="" ${extra}></div></div></label></div>`;
    const fixture = await loadFixture(document, `<!doctype html><body><form data-ui="application-form"><section
      data-ui="section"><h2 id="section-1_section_name">Profile</h2><div data-ui="section-fields"><div
      data-ui="experience"><div><p id="experience_label">Experience</p><button data-ui="add-section" aria-label="Add
      Experience" type="button" disabled="" aria-disabled="true">+ Add</button></div><ul><li><div data-ui="editor">
      ${box('title', 'Title', 'required=""')}${box('company', 'Company')}<div><label><span><span><span
      id="start_date_label"><strong>Start date</strong></span></span></span><div class="react-datepicker-wrapper"><div
      class="react-datepicker__input-container"><div data-role="illustrated-input"><input type="text" inputmode="tel"
      name="start_date" placeholder="MM/YYYY" dir="auto" value=""></div></div></div></label></div><label
      data-checked="false"><div role="checkbox" aria-labelledby="checkbox_label_current" aria-checked="false"
      tabindex="0" id="current"><input tabindex="-1" aria-hidden="true" type="checkbox" name="current"></div><span
      id="checkbox_label_current">I currently work here</span></label><div><button data-ui="save-section"
      type="button">Update</button><button data-ui="cancel-section" type="button">Cancel</button></div></div></li>
      ${saved('Platform Engineer', 'Larkspur Analytics', 'March 2017 - June 2019')}
      ${saved('Senior Software Engineer', 'Quillfeather Labs', 'June 2021 - Present')}</ul></div></div></section>
      </form></body>`, { width: 1280, height: 1600 });
    const root = fixture.doc.querySelector('form')!;
    const [li0, li1, li2] = Array.from(fixture.doc.querySelectorAll('[data-ui="experience"] > ul > li'));
    const experience = sectionsOf(workableAdapter, root).find((section) => section.kind === 'experience')!;
    // The saved entries first, in page order, then the editor: a new editor never takes a saved entry's index.
    expect(experience.blocks()).toEqual([li1, li2, li0]);
    expect(workableAdapter.prefill!.readEntries!('experience', experience.blocks()).map((entry) => [entry.block,
      entry.values.find((value) => value.category === 'experience.company')?.text])).toEqual([[0, 'Larkspur Analytics'],
      [1, 'Quillfeather Labs']]);
    expect(experience.save!(experience.blocks()[2]!)).toBe(li0!.querySelector('[data-ui="save-section"]'));
    expect(experience.save!(experience.blocks()[0]!)).toBeNull();
    expect(experience.currentlyHere!(experience.blocks()[2]!)).toBe(li0!.querySelector('input[name="current"]'));
    // The scan names the editor's fields block 2, the number of saved entries.
    const scanned = scan(root, workableAdapter, { platform: 'workable' });
    const editorFields = scanned.fields.filter((field) => li0!.contains(scanned.target(field.key)!.control));
    expect(editorFields.map((field) => field.label)).toEqual(['Title', 'Company', 'Start date', 'I currently work here']);
    expect(editorFields.every((field) => field.section.id === 'experience' && field.section.block === 2)).toBe(true);
  });
});
