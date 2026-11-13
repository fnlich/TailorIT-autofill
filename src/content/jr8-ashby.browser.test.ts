/*
 * jr8 (the owner's report of 2026-11-13, snapshot10: Ashby's Honeydew form, "6/9 Required Fields Filled"), on the
 * synthetic Ashby page (fixtures/synthetic/ashby-widgets: MountOptions.answered, residence and residenceDraws) with the
 * fake worker planning each pass with the real planFrame. Every value is the golden profile's or built in code from it.
 * - Two Yes/No questions the page showed answered (a button aria-pressed="true", its hidden checkbox not checked, as the
 *   capture draws them) stayed empty circles: the profile held no answer, and a list with a choice of its own is the
 *   person's (answers.ts choiceOptions), so the run left them flagged, and only the person's next input read them again.
 *   Now the lists read them filled at rest (orchestrator.ts pressedIn), whoever chose them, and nothing is pressed; a
 *   Yes/No left unanswered stays missing until the person answers it. Never a trap's row, a hard stop or an attention
 *   check, nor a radio's or a select's default (FIX7PLAN O-3).
 * - "What is your primary state of residence?", a list of the states' two-letter codes: the rules read it as the state
 *   of residence (the AI's screen reads the codes as naming the TN visa), the profile's region picks "TX" from the codes
 *   and "Texas" from a list of names; a list that draws 50 codes at a time, none of them the state, is searched by the
 *   state's name, then by its code ("Texas" filters a list of codes to nothing).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { userEvent } from 'vitest/browser';
import pageHtml from '../../fixtures/synthetic/ashby-widgets/index.html?raw';
import { mountAshbyForm, newLog, PATHS, STATE_CODES, type AshbyLog, type MountOptions } from
  '../../fixtures/synthetic/ashby-widgets/app';
import { ashbyAdapter } from '../adapters/ashby';
import type { FillResult } from '../core/types/fill';
import type { Profile } from '../core/types/profile';
import { DEFAULT_SETTINGS, type Settings } from '../core/types/settings';
import { loadFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import { scan } from '../dom/scan';
import { progressOf, rowProgressOf, type FrameReport } from '../shared/report';
import { createFakeWorker, goldenProfile, sentinelsIn, testVocab, type FakeWorker } from './content.testkit';
import { pressedIn } from './orchestrator';
import { startContentRuntime, type ContentRuntime } from './runtime';

const APPLICATION = 'https://jobs.ashbyhq.com/tailorit-fixture/00000000-0000-4000-8000-00000000a5b2/application';
const AUTHORIZED = 'Are you legally authorized to work in the United States?';
const SPONSORSHIP = 'Will you now or in the future require sponsorship for employment visa status?';
const RESIDENCE = 'What is your primary state of residence?';

let logs: MockInstance;
beforeAll(() => {
  testVocab();
  logs = vi.spyOn(console, 'info');
});
afterAll(() => logs.mockRestore());

const runtimes: ContentRuntime[] = [];
const mounted: Array<() => void> = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  for (const unmount of mounted.splice(0)) unmount();
  removeFixtures(document);
});

interface Opened {
  fixture: Fixture;
  log: AshbyLog;
}

/** The page drawn at once, with the jr8 options. */
async function open(options: Pick<MountOptions, 'answered' | 'residence' | 'residenceDraws'> = {}): Promise<Opened> {
  const fixture = await loadFixture(document, pageHtml.replace(/<script[^>]*><\/script>/, ''), { width: 1280, height: 3600 });
  const log = newLog();
  const app = mountAshbyForm(fixture.doc.getElementById('ashby-panel')!, { log, searchMs: 200, ...options });
  mounted.push(app.unmount);
  await vi.waitFor(() => expect(ashbyAdapter.detect(fixture.doc)).not.toBeNull(), { timeout: 8_000, interval: 50 });
  return { fixture, log };
}

/** Each Yes/No's hidden checkbox as snapshot10 draws it beside a pressed button: not checked, no checked attribute. */
function uncheckHiddenBoxes(fixture: Fixture): void {
  for (const box of Array.from(fixture.doc.querySelectorAll<HTMLInputElement>('.ashby-application-form-input-yesno > input'))) {
    box.checked = false;
    box.removeAttribute('checked');
  }
}

async function run(opened: Opened, options: { profile?: Profile; settings?: Settings } = {}):
  Promise<{ worker: FakeWorker; runtime: ContentRuntime }> {
  const worker = createFakeWorker({ settings: options.settings ?? DEFAULT_SETTINGS,
    ...(options.profile === undefined ? {} : { profile: options.profile }) });
  const runtime = await startContentRuntime(worker.platform, opened.fixture.doc, { href: () => APPLICATION, isTop: true,
    settle: { quietMs: 200 } });
  runtimes.push(runtime);
  expect(await runtime.fill()).toBe('review');
  return { worker, runtime };
}

const lastReport = (worker: FakeWorker): FrameReport => worker.reports.at(-1)!;
function rowOf(worker: FakeWorker, label: string): FillResult {
  const row = lastReport(worker).fields.find((candidate) => candidate.label === label);
  if (row === undefined) throw new Error(`no row "${label}"`);
  return row as FillResult;
}

/** The golden profile without a work-authorization entry: the Yes/No questions have no answer in it. */
function withoutWorkAuthorization(): Profile {
  return { ...goldenProfile(), workAuthorization: [] };
}

/** The AI asked nothing: the fields the profile cannot answer stay the person's. */
const NO_AI_ANSWERS: Settings = { ...DEFAULT_SETTINGS, llm: { ...DEFAULT_SETTINGS.llm, answers: false } };

/** The person's own click at an element. */
async function personClicks(fixture: Fixture, el: Element): Promise<void> {
  el.scrollIntoView({ block: 'center' });
  const box = el.getBoundingClientRect();
  await userEvent.click(fixture.frame, { position: { x: box.left + box.width / 2, y: box.top + box.height / 2 } });
}

describe('jr8: a Yes/No the page shows answered', () => {
  it('reads filled in the lists at rest, whoever chose it, and is never pressed', async () => {
    const opened = await open({ answered: { authorized: true, sponsorship: false } });
    uncheckHiddenBoxes(opened.fixture);
    const { worker } = await run(opened, { profile: withoutWorkAuthorization() });
    for (const label of [AUTHORIZED, SPONSORSHIP]) {
      const row = rowOf(worker, label);
      // The run wrote nothing: the answer is the page's (or the person's), the profile has none.
      expect(row).toMatchObject({ kind: 'radio', required: true, status: 'flagged', wrote: false, provenance: null,
        detail: { filledByYou: true } });
      expect(rowProgressOf(row)).toBe('filled');
    }
    // Both count among the required fields filled: the one left is the resume, which this run has none of.
    const missing = lastReport(worker).fields.filter((row) => row.required && rowProgressOf(row) === 'missing');
    expect(missing.map((row) => row.label)).toEqual(['Resume']);
    const progress = progressOf([lastReport(worker)]);
    expect(progress.filled).toBe(progress.of - 1);
    // Nothing pressed: the answers stand as the page drew them, never saved again.
    expect(opened.log.saves.filter((save) => save.path === PATHS.authorized || save.path === PATHS.sponsorship)).toEqual([]);
    const pressed = (path: string) => Array.from(opened.fixture.doc.querySelectorAll(`[data-field-path="${path}"] button`))
      .map((button) => button.getAttribute('aria-pressed'));
    expect([pressed(PATHS.authorized), pressed(PATHS.sponsorship)]).toEqual([['true', 'false'], ['false', 'true']]);
    expect(sentinelsIn(JSON.stringify(worker.reports))).toEqual([]);
  });

  it('stays missing while it shows no answer, and reads filled once the person answers it after the run', async () => {
    const opened = await open();
    const { worker } = await run(opened, { profile: withoutWorkAuthorization(), settings: NO_AI_ANSWERS });
    expect(rowOf(worker, AUTHORIZED)).toMatchObject({ status: 'flagged', wrote: false });
    expect(rowOf(worker, AUTHORIZED).detail?.filledByYou).toBeUndefined();
    expect(rowProgressOf(rowOf(worker, AUTHORIZED))).toBe('missing');
    await personClicks(opened.fixture,
      opened.fixture.doc.querySelector(`[data-field-path="${PATHS.authorized}"] button[data-option="yes"]`)!);
    await vi.waitFor(() => expect(rowProgressOf(rowOf(worker, AUTHORIZED))).toBe('filled'), { timeout: 4_000 });
    expect(opened.log.values[PATHS.authorized]).toBe(true);
    expect(rowProgressOf(rowOf(worker, SPONSORSHIP))).toBe('missing');
  });
});

describe('jr8: pressedIn, what it reads filled', () => {
  /** A form of one Ashby Yes/No pressed, a native radio group with a default, a select with a default, and a Yes/No
   *  hidden from people (a honeypot). */
  const PAGE = `<!doctype html><html><body><div id="form" role="tabpanel"><div class="ashby-application-form-container">
    <div class="ashby-application-form-field-entry" data-field-path="p1">
      <label class="_heading_f7cvd_52 _required_f7cvd_91 ashby-application-form-question-title" for="p1">Do you agree?</label>
      <div class="ashby-application-form-input-yesno">
        <button class="ashby-application-form-input-yesno-option" aria-pressed="true" data-option="yes">Yes</button>
        <button class="ashby-application-form-input-yesno-option" aria-pressed="false" data-option="no">No</button>
        <input type="checkbox" style="display:none" tabindex="-1" name="p1"></div></div>
    <div class="ashby-application-form-field-entry" data-field-path="p2"><fieldset>
      <legend>Pick a shift</legend>
      <label><input type="radio" name="shift" value="day" checked> Day</label>
      <label><input type="radio" name="shift" value="night"> Night</label></fieldset></div>
    <div class="ashby-application-form-field-entry" data-field-path="p3">
      <label class="ashby-application-form-question-title" for="frame">Pay period</label>
      <select id="frame"><option selected>Hr.</option><option>Yr.</option></select></div>
  </div></div></body></html>`;

  it('flips an open row of a pressed Yes/No only: never a radio, a select, a trap, a hard stop or an attention check', async () => {
    const fixture = await loadFixture(document, PAGE);
    const scanned = scan(fixture.doc.getElementById('form')!, ashbyAdapter, { platform: 'ashby' });
    const rows: FillResult[] = scanned.fields.map((field) => ({ key: field.key, label: field.label, kind: field.kind,
      category: 'unknown', section: 'main', required: true, status: 'flagged', provenance: null,
      matcherStage: 'not-applicable', confidence: 0, reason: 'no-profile-value', wrote: false,
      verification: 'not-applicable', needsUserAction: false }));
    expect(rows.map((row) => [row.label, row.kind])).toEqual([['Do you agree?', 'radio'], ['Pick a shift', 'radio'],
      ['Pay period', 'select']]);
    const yesno = rows[0]!;
    expect(pressedIn(scanned, yesno)).toEqual({ ...yesno, detail: { filledByYou: true } });
    // A native radio's checked default and a select's shown default are the page's (FIX7PLAN O-3).
    expect(pressedIn(scanned, rows[1]!)).toEqual(rows[1]);
    expect(pressedIn(scanned, rows[2]!)).toEqual(rows[2]);
    // A trap's row (blocked: left out), a hard stop, an attention check, and a row the run wrote, as they are.
    for (const row of [{ ...yesno, status: 'blocked' as const, reason: 'honeypot' as const },
      { ...yesno, reason: 'bot-check' as const }, { ...yesno, reason: 'attention-check' as const },
      { ...yesno, status: 'verified' as const, wrote: true, reason: 'ok' as const }]) {
      expect(pressedIn(scanned, row)).toEqual(row);
    }
    // Once it shows no answer, nothing to read.
    fixture.doc.querySelector('button[data-option="yes"]')!.setAttribute('aria-pressed', 'false');
    expect(pressedIn(scan(fixture.doc.getElementById('form')!, ashbyAdapter, { platform: 'ashby' }), yesno)).toEqual(yesno);
  });
});

describe('jr8: the state of residence on a list of two-letter codes', () => {
  it('is the state of residence, and the profile\'s region picks its code from the whole list', async () => {
    const opened = await open({ residence: STATE_CODES });
    const { worker } = await run(opened);
    expect(rowOf(worker, RESIDENCE)).toMatchObject({ category: 'address.region', provenance: 'profile', wrote: true,
      verification: 'verified', status: 'verified' });
    expect(opened.log.values[PATHS.residence]).toBe('TX');
    // Chosen from the list read whole: nothing typed into its search.
    expect(opened.log.typed[PATHS.residence]).toBeUndefined();
  });

  it('searches a list that draws 50 codes at a time, none the state, by its name and then its code', async () => {
    const codes = [...STATE_CODES, 'AA', 'AE', 'AP', 'AS', 'FM', 'GU', 'MH', 'MP', 'PR', 'PW', 'VI'].sort();
    expect(codes.indexOf('TX')).toBeGreaterThanOrEqual(50);
    const opened = await open({ residence: codes, residenceDraws: 50 });
    const { worker } = await run(opened);
    expect(rowOf(worker, RESIDENCE)).toMatchObject({ category: 'address.region', wrote: true, verification: 'verified' });
    expect(opened.log.typed[PATHS.residence]).toEqual(['Texas', 'TX']);
    expect(opened.log.values[PATHS.residence]).toBe('TX');
  });

  it('keeps choosing the state by its name from a list of names', async () => {
    const names = ['Alabama', 'Alaska', 'Arizona', 'California', 'New York', 'Ohio', 'Tennessee', 'Texas', 'Utah',
      'Washington'];
    const opened = await open({ residence: names });
    const { worker } = await run(opened);
    expect(rowOf(worker, RESIDENCE)).toMatchObject({ category: 'address.region', wrote: true, verification: 'verified' });
    expect(opened.log.values[PATHS.residence]).toBe('Texas');
  });
});
