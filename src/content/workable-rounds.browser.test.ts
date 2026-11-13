/*
 * jr8 (the owner's live Workable run of 2026-11-13, snapshot9: "there is 4 work experience, but only first 2 is
 * filled"): the content runtime on the synthetic Workable page (fixtures/synthetic/workable-widgets, drawn as live
 * Workable draws its Education and Experience: each new editor at the top of its list, the saved entries newest-added
 * first), with the fake worker planning each pass with the real planFrame, for a profile of four jobs (the golden two and
 * two synthetic ones). Workable's Add is disabled while an editor is open, so the fill step adds, fills and saves one
 * entry a round (content/orchestrator.ts fillStep): all four are added, filled and kept, the current job's box ticked
 * and its end date left, and nothing is left for the person.
 * - With the Workable adapter as it is: a new editor is a block of its own (adapters/workable/index.ts repeatables:
 *   the saved entries first, then the open editor), so each round's editor takes a fresh index.
 * - With an adapter that keeps Workable's page order (the editor, drawn first, block 0 every round: the key of the
 *   entry saved in round 1), the engine's own guard carries it: the books of a block a round saved are dropped before
 *   the next round, so the new editor's empty fields are a new entry's, never our value reset (MAX_VALUE_FLIPS), and its
 *   live rows stand for its key, never the saved block's.
 * And an editor the run cannot fill (a job with no title, the editor's one required field) is left open for the person
 * with its own rows (its Title left, never the kept entry's verified row at that key), and what the run wrote in it is
 * read again at rest before a press, a change the page made reported (savedBlocks exempts only a field the page no
 * longer shows).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import pageHtml from '../../fixtures/synthetic/workable-widgets/index.html?raw';
import { mountWorkablePage, newLog, type WorkableLog } from '../../fixtures/synthetic/workable-widgets/app';
import type { Adapter } from '../adapters/types';
import { workableAdapter } from '../adapters/workable';
import type { Profile } from '../core/types/profile';
import { loadFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import { createFakeWorker, fakePdf, GOLDEN_RESUME, goldenProfile, testVocab, type FakeWorker } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

const APPLICATION = 'https://apply.workable.com/tailorit-fixture/j/0000000A02/apply/';
const RESUME = { bytes: fakePdf(48_213), name: GOLDEN_RESUME.fileName, mime: 'application/pdf' };

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

/** The golden profile with two more (synthetic) jobs after its two: four, newest first. */
function fourJobs(): Profile {
  const golden = goldenProfile();
  return { ...golden, experience: [...golden.experience,
    { company: 'Larkspur Analytics', title: 'Platform Engineer', startDate: { y: 2017, m: 3 }, endDate: { y: 2019, m: 6 },
      current: false, description: 'Kept the Larkspur reporting pipeline running.' },
    { company: 'Tidewater Works', title: 'Junior Developer', startDate: { y: 2015, m: 6 }, endDate: { y: 2017, m: 2 },
      current: false, description: 'Wrote the Tidewater intranet tools.' }] };
}

/** An adapter that keeps Workable's blocks in page order (the open editor, drawn first, as block 0): the adapter before
 *  jr8, so the engine's own guard alone must carry the rounds. */
const pageOrder: Adapter = {
  ...workableAdapter,
  repeatables: (root) => workableAdapter.repeatables!(root).map((section) => ({ ...section,
    blocks: () => Array.from(root.querySelectorAll(`[data-ui="${section.kind}"] > ul > li`)) })),
};

/** Waits until `ready` holds. */
async function until(ready: () => boolean, timeout = 8_000): Promise<void> {
  await vi.waitFor(() => expect(ready()).toBe(true), { timeout, interval: 50 });
}

/** The page with its form drawn (its own module script left out: the test mounts the app), and the runtime on it. */
async function start(adapter: Adapter, profile: Profile): Promise<{ fixture: Fixture; log: WorkableLog;
  worker: FakeWorker; runtime: ContentRuntime }> {
  const fixture = await loadFixture(document, pageHtml.replace(/<script[^>]*><\/script>/, ''),
    { width: 1280, height: 3600 });
  const log = newLog();
  mounted.push(mountWorkablePage(fixture.doc.getElementById('wk-app')!, { log }).unmount);
  await until(() => workableAdapter.detect(fixture.doc) !== null);
  // The Cover letter box asks for the run's letter: none, so it settles at once.
  const worker = createFakeWorker({ profile, resume: RESUME,
    letter: { state: { state: 'none', reason: 'cover-letter-none' } } });
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => APPLICATION, isTop: true,
    settle: { quietMs: 200 }, adapters: () => [adapter] });
  runtimes.push(runtime);
  return { fixture, log, worker, runtime };
}

/** A profile month as the editor's MM/YYYY box takes it. */
const monthOf = (at: { y: number; m?: number } | undefined) => (at === undefined ? undefined
  : `${String(at.m ?? 1).padStart(2, '0')}/${at.y}`);

describe("Workable's Experience, one entry a round, with the editor drawn at the top of its list (jr8)", () => {
  for (const [name, adapter] of [['the Workable adapter (saved entries first, then the editor)', workableAdapter],
    ["an adapter in Workable's page order (the engine's guard alone)", pageOrder]] as const) {
    it(`adds, fills and keeps all four jobs: ${name}`, async () => {
      const profile = fourJobs();
      const { fixture, log, worker, runtime } = await start(adapter, profile);
      expect(await runtime.fill()).toBe('review');
      // One Add for the school, four for the jobs, each kept with its Update in the round that added it.
      expect(log.adds).toBe(5);
      expect(log.entries.experience).toHaveLength(4);
      expect(log.entries.experience).toEqual(profile.experience.map((job) => expect.objectContaining({
        title: job.title, company: job.company, start_date: monthOf(job.startDate),
        ...(job.current ? { current: true } : { end_date: monthOf(job.endDate) }) })));
      // The current job: its box ticked, its end date never written.
      expect(log.entries.experience![0]).not.toHaveProperty('end_date');
      expect(log.entries.experience!.slice(1).every((entry) => entry.current !== true)).toBe(true);
      // As live: no editor left open, the saved entries newest-added first.
      expect(fixture.doc.querySelector('[data-ui="experience"] [data-ui="editor"]')).toBeNull();
      expect(Array.from(fixture.doc.querySelectorAll('[data-ui="experience"] dd[data-ui="company"]'))
        .map((dd) => dd.textContent)).toEqual(profile.experience.map((job) => job.company).reverse());
      const report = worker.reports.at(-1)!;
      expect(report.notices.map((notice) => notice.code)).not.toContain('needs-click');
      expect(report.repeatables).toEqual(expect.arrayContaining([{ kind: 'experience', added: 4, of: 4 }]));
      // No field of a new entry was taken for our value reset by the page.
      expect(report.fields.filter((row) => row.reason === 'value-oscillated')).toEqual([]);
      expect(log.pressed).toEqual([]);
      expect(log.submitted).toBe(0);
    }, 120_000);

    it(`leaves an editor it cannot fill open for the person, with its own rows: ${name}`, async () => {
      // The second job has no title (the editor's one required field): its editor is left open, never kept.
      const golden = goldenProfile();
      const profile: Profile = { ...golden, experience: [golden.experience[0]!, { ...golden.experience[1]!, title: '' }] };
      const { fixture, log, worker, runtime } = await start(adapter, profile);
      expect(await runtime.fill()).toBe('review');
      expect(log.entries.experience).toEqual([expect.objectContaining({ company: golden.experience[0]!.company })]);
      const editor = fixture.doc.querySelector('[data-ui="experience"] [data-ui="editor"]');
      expect(editor).not.toBeNull();
      expect((editor!.querySelector('input[name="title"]') as HTMLInputElement).value).toBe('');
      // The open editor's block: the saved entry's in page order (block 0), a fresh one with the saved entries first.
      const open = adapter === pageOrder ? 'experience[0]' : 'experience[1]';
      const report = worker.reports.at(-1)!;
      // Its rows are its own, as the page shows it: the Title left for the person, never the kept entry's verified row
      // that stood at that key (jr8: the latest scan shows the field, so the live row stands).
      const titles = report.fields.filter((row) => row.label === 'Title' && row.section === open);
      expect(titles).toHaveLength(1);
      expect(titles[0]).toMatchObject({ wrote: false, needsUserAction: true });
      expect(titles[0]!.status).not.toBe('verified');
      const company = () => report.fields.find((row) => row.label === 'Company' && row.section === open);
      expect(company()).toMatchObject({ wrote: true, verification: 'verified' });
      // The page changes the open editor's Company at rest: what the run wrote is read again before a press (E9), at a
      // saved entry's key too (jr8: savedBlocks exempts only a field the page no longer shows), and the change is
      // reported. The press finds no Next on Workable's one step.
      const input = editor!.querySelector<HTMLInputElement>('input[name="company"]')!;
      Object.getOwnPropertyDescriptor(fixture.view.HTMLInputElement.prototype, 'value')!.set!.call(input, 'Elsewhere');
      input.dispatchEvent(new fixture.view.Event('input', { bubbles: true }));
      await until(() => input.value === 'Elsewhere');
      await runtime.run!.press('next', false);
      await until(() => worker.reports.at(-1)!.fields.find((row) => row.label === 'Company' && row.section === open)
        ?.verification === 'mismatch');
      expect(log.pressed).toEqual([]);
      expect(log.submitted).toBe(0);
    }, 120_000);
  }
});
