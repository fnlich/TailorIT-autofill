/*
 * jr8 integration (INT-8): the four jr8 branches meet in the fill step and its Next (content/orchestrator.ts). These
 * cross-checks run the content runtime with the fake worker planning each pass with the real planFrame, on the
 * synthetic pages, with the golden profile or variants built in code from it.
 * - Workable's rounds (one entry added, filled and saved a round) under Workday's Next rule (Next mode Auto, the one
 *   predicate content/required-left.ts): a profile of four jobs has all four kept and nothing pressed, neither early
 *   (between rounds) nor after; Workable's form is one step, its last, so the panel's dock offers Submit application
 *   and never "Continue to the next page" (its report's buttons: the last step, no count left), and a
 *   Continue asked of it presses nothing.
 * - Ashby's Yes/No the page shows answered (jr8 Ashby: orchestrator.ts pressedIn) counts as filled for Next mode Auto
 *   through the shared check (countedAsShown at FILLED, requiredUnfilledOf at the validation and before the click): on
 *   Ashby's form read as a step before the last (a stand-in adapter that gives it a Next), the run presses Next once
 *   both Yes/No show an answer the profile does not hold, and holds it while they show none.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import ashbyHtml from '../../fixtures/synthetic/ashby-widgets/index.html?raw';
import { mountAshbyForm, newLog as newAshbyLog, PATHS, type MountOptions } from
  '../../fixtures/synthetic/ashby-widgets/app';
import workableHtml from '../../fixtures/synthetic/workable-widgets/index.html?raw';
import { mountWorkablePage, newLog as newWorkableLog } from '../../fixtures/synthetic/workable-widgets/app';
import { ashbyAdapter } from '../adapters/ashby';
import type { Adapter } from '../adapters/types';
import { workableAdapter } from '../adapters/workable';
import type { FillResult } from '../core/types/fill';
import type { Profile } from '../core/types/profile';
import { DEFAULT_SETTINGS, type Settings } from '../core/types/settings';
import { loadFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import { scan } from '../dom/scan';
import { deadline } from '../dom/time';
import { rowProgressOf } from '../shared/report';
import { createFakeWorker, fakePdf, GOLDEN_RESUME, goldenProfile, testVocab } from './content.testkit';
import { requiredUnfilledOf } from './required-left';
import { startContentRuntime, type ContentRuntime } from './runtime';

const WORKABLE = 'https://apply.workable.com/tailorit-fixture/j/0000000A02/apply/';
const ASHBY = 'https://jobs.ashbyhq.com/tailorit-fixture/00000000-0000-4000-8000-00000000a5b2/application';
const RESUME = { bytes: fakePdf(48_213), name: GOLDEN_RESUME.fileName, mime: 'application/pdf' };
const AUTHORIZED = 'Are you legally authorized to work in the United States?';
const SPONSORSHIP = 'Will you now or in the future require sponsorship for employment visa status?';

/** Next mode Auto; Submit stays Manual (the default). */
const AUTO_NEXT: Settings = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, next: 'auto' } };
/** Next mode Auto, and no AI answers: what the profile cannot answer stays the person's (or the page's). */
const AUTO_NEXT_NO_AI: Settings = { ...AUTO_NEXT, llm: { ...AUTO_NEXT.llm, answers: false } };

let logs: MockInstance;
beforeAll(() => {
  testVocab();
  logs = vi.spyOn(console, 'info');
});
afterAll(() => logs.mockRestore());
const logged = (event: string) => logs.mock.calls.filter((call) => String(call[0]).includes(event)).length;

const runtimes: ContentRuntime[] = [];
const mounted: Array<() => void> = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  for (const unmount of mounted.splice(0)) unmount();
  removeFixtures(document);
  logs.mockClear();
});

async function until(ready: () => boolean, timeout = 8_000): Promise<void> {
  await vi.waitFor(() => expect(ready()).toBe(true), { timeout, interval: 50 });
}

describe('jr8 integration: Workable’s rounds under Workday’s Next rule', () => {
  /** The golden profile with two more (synthetic) jobs after its two: four, newest first. */
  function fourJobs(): Profile {
    const golden = goldenProfile();
    return { ...golden, experience: [...golden.experience,
      { company: 'Larkspur Analytics', title: 'Platform Engineer', startDate: { y: 2017, m: 3 },
        endDate: { y: 2019, m: 6 }, current: false, description: 'Kept the Larkspur reporting pipeline running.' },
      { company: 'Tidewater Works', title: 'Junior Developer', startDate: { y: 2015, m: 6 }, endDate: { y: 2017, m: 2 },
        current: false, description: 'Wrote the Tidewater intranet tools.' }] };
  }

  it('keeps all four jobs with Next on Auto, presses nothing, and its one step offers Submit, never Continue',
    async () => {
      const fixture = await loadFixture(document, workableHtml.replace(/<script[^>]*><\/script>/, ''),
        { width: 1280, height: 3600 });
      const log = newWorkableLog();
      mounted.push(mountWorkablePage(fixture.doc.getElementById('wk-app')!, { log }).unmount);
      await until(() => workableAdapter.detect(fixture.doc) !== null);
      const profile = fourJobs();
      const worker = createFakeWorker({ profile, resume: RESUME, settings: AUTO_NEXT,
        letter: { state: { state: 'none', reason: 'cover-letter-none' } } });
      const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => WORKABLE, isTop: true,
        settle: { quietMs: 200 }, adapters: () => [workableAdapter] });
      runtimes.push(runtime);
      expect(await runtime.fill()).toBe('review');
      // Every round's Save kept its entry: one Add for the school, four for the jobs.
      expect(log.adds).toBe(5);
      expect(log.entries.experience).toHaveLength(4);
      expect(fixture.doc.querySelector('[data-ui="experience"] [data-ui="editor"]')).toBeNull();
      // Nothing pressed but the rounds' own Adds and Saves: no Next (the form has none), no Submit, at no point.
      expect(log.pressed).toEqual([]);
      expect(log.submitted).toBe(0);
      expect(logged('content.next-withheld')).toBe(0);
      // At rest, the step is the last, with no count of fields left: the dock offers Submit application from this,
      // never Continue (ui/report/dock.browser.test.tsx, "is no Continue on the last step").
      await vi.waitFor(() => expect(worker.reports.at(-1)?.buttons).toBeDefined(), { timeout: 8_000 });
      expect(worker.reports.at(-1)!.buttons).toEqual({ final: 'final', next: false, submit: true });
      // A Continue asked of the last step presses nothing.
      const answer = await runtime.run!.press('next', false);
      expect(answer.outcome).not.toBe('pressed');
      expect(log.pressed).toEqual([]);
      expect(log.submitted).toBe(0);
    }, 120_000);
});

describe('jr8 integration: Ashby’s Yes/No the page shows answered, through the one required-field check', () => {
  /** Ashby's form read as a step before the last: a Next of the test's own beside its fields (Submit still the
   *  adapter's, never pressed). */
  function steppedAshby(): Adapter {
    return { ...ashbyAdapter, isFinalStep: () => 'not-final',
      nextButton: (root) => root.ownerDocument.getElementById('int-next') };
  }

  async function run(answered: MountOptions['answered']) {
    const fixture: Fixture = await loadFixture(document, ashbyHtml.replace(/<script[^>]*><\/script>/, ''),
      { width: 1280, height: 3600 });
    const log = newAshbyLog();
    const app = mountAshbyForm(fixture.doc.getElementById('ashby-panel')!, { log, searchMs: 200,
      ...(answered === undefined ? {} : { answered }) });
    mounted.push(app.unmount);
    await until(() => ashbyAdapter.detect(fixture.doc) !== null);
    // Each Yes/No's hidden checkbox as snapshot10 draws it beside a pressed button: not checked.
    for (const box of Array.from(fixture.doc.querySelectorAll<HTMLInputElement>('.ashby-application-form-input-yesno > input'))) {
      box.checked = false;
      box.removeAttribute('checked');
    }
    const next = fixture.doc.createElement('button');
    next.type = 'button';
    next.id = 'int-next';
    next.textContent = 'Next';
    const nexts: boolean[] = [];
    next.addEventListener('click', (event) => nexts.push(event.isTrusted));
    fixture.doc.getElementById('form')!.append(next);
    // No work-authorization entry (the Yes/No questions have no answer in it); a start date, so that question is the
    // profile's and the two Yes/No are the step's only questions it cannot answer.
    const golden = goldenProfile();
    const profile: Profile = { ...golden, workAuthorization: [],
      preferences: { ...golden.preferences, startDate: { kind: 'notice', weeks: 2 } } };
    const worker = createFakeWorker({ profile, resume: RESUME, settings: AUTO_NEXT_NO_AI });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => ASHBY, isTop: true,
      settle: { quietMs: 200 }, adapters: () => [steppedAshby()] });
    runtimes.push(runtime);
    await runtime.fill();
    await vi.waitFor(() => expect(runtime.run?.ended).toBeDefined(), { timeout: 60_000 });
    const rows = worker.reports.at(-1)!.fields;
    const left = () => requiredUnfilledOf(scan(ashbyAdapter.detect(fixture.doc)!.formRoot, ashbyAdapter,
      { platform: 'ashby' }), rows.map((row) => row as FillResult), () => false);
    return { fixture, log, worker, runtime, nexts, rows, left };
  }

  it('presses Next on Auto once both show an answer the profile does not hold, the run having written neither',
    async () => {
      const page = await run({ authorized: true, sponsorship: false });
      await until(() => page.nexts.length > 0, 30_000);
      expect(page.nexts).toEqual([false]);
      for (const label of [AUTHORIZED, SPONSORSHIP]) {
        const row = page.rows.find((each) => each.label === label)!;
        expect(row).toMatchObject({ required: true, wrote: false, provenance: null });
        expect(rowProgressOf(row)).toBe('filled');
      }
      expect(page.left()).toBe(0);
      expect(page.log.saves.filter((save) => save.path === PATHS.authorized || save.path === PATHS.sponsorship)).toEqual([]);
    }, 90_000);

  it('holds Next while they show no answer, and the shared check counts both', async () => {
    const page = await run(undefined);
    await deadline(1_000);
    expect(page.nexts).toEqual([]);
    expect(page.runtime.run?.ended).toBe('waiting');
    for (const label of [AUTHORIZED, SPONSORSHIP]) {
      expect(rowProgressOf(page.rows.find((each) => each.label === label)!)).toBe('missing');
    }
    expect(page.left()).toBe(2);
  }, 90_000);
});
