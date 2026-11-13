/*
 * jr8 (the owner, 2026-11-13: "Currently `Apply Now` button is not working to show the form"; snapshot12): the content
 * runtime on the synthetic Workable job site (fixtures/synthetic/workable-widgets, MountOptions.view 'jobs': the
 * posting at jobs.workable.com/view/<id>/<slug> whose "Apply now" opens the application in a dialog at the same
 * address, its form drawn a moment later), with the fake worker planning with the real planFrame and the golden
 * profile (apply.testkit's worker, which answers entry/pressed as the worker does):
 * - Autofill on the posting presses Apply now once (the entry: adapters/workable/index.ts jobsSiteApply), the dialog's
 *   form is claimed by the Workable adapter, and the run the worker's grant starts fills it; nothing else is pressed
 *   (the dialog's Cancel and Submit, Share job), nothing submitted;
 * - the sticky bar's Apply now is the entry where the posting's own is not shown;
 * - with the dialog already open (the person pressed Apply now), still loading its form, Autofill never presses Apply
 *   now again: the run starts once the form shows, and fills it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import pageHtml from '../../fixtures/synthetic/workable-widgets/index.html?raw';
import { mountWorkablePage, newLog, type WorkableLog } from '../../fixtures/synthetic/workable-widgets/app';
import { workableAdapter } from '../adapters/workable';
import { loadFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import type { FrameReport } from '../shared/report';
import { applyWorker, wallsOf } from './apply.testkit';
import { fakePdf, GOLDEN_RESUME, goldenProfile, testVocab, type FakeWorker } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

/** A job site posting's address (a made-up view id; jobs.workable.com/view/<id>/<slug>). */
const POSTING = 'https://jobs.workable.com/view/TailoritFixtureView000001/software-engineer-at-tailorit-fixture';
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

/** Waits until `ready` holds. */
async function until(ready: () => boolean, timeout = 10_000): Promise<void> {
  await vi.waitFor(() => expect(ready()).toBe(true), { timeout, interval: 50 });
}

/** The job site's posting drawn (its own module script left out: the test mounts the app), and the runtime on it. */
async function start(options: { formAfterMs?: number; jobsOpen?: boolean } = {}): Promise<{ fixture: Fixture;
  log: WorkableLog; worker: FakeWorker; runtime: ContentRuntime }> {
  const fixture = await loadFixture(document, pageHtml.replace(/<script[^>]*><\/script>/, ''),
    { width: 1280, height: 3600 });
  const log = newLog();
  mounted.push(mountWorkablePage(fixture.doc.getElementById('wk-app')!, { log, view: 'jobs', ...options }).unmount);
  await until(() => fixture.doc.querySelector('[data-ui="overview-apply-now"]') !== null);
  // The Cover letter box asks for the run's letter: none, so it settles at once.
  const worker = applyWorker(undefined, { resume: RESUME,
    letter: { state: { state: 'none', reason: 'cover-letter-none' } } });
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => POSTING, isTop: true,
    settle: { quietMs: 200 }, adapters: () => [workableAdapter] });
  runtimes.push(runtime);
  return { fixture, log, worker, runtime };
}

/** A row of the last report, by its label. */
const rowOf = (report: FrameReport | undefined, label: string) => report?.fields.find((row) => row.label === label);

describe("Workable's job site: Autofill presses Apply now and fills the dialog's form (jr8, snapshot12)", () => {
  it('presses Apply now once, claims the form the dialog draws, and fills it', async () => {
    const { fixture, log, worker, runtime } = await start();
    expect(runtime.page).toBeNull();
    // The page offers its own Apply: the panel's Autofill presses it.
    await until(() => wallsOf(worker).some((wall) => wall.entry));
    await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
    await until(() => log.applyNow === 1);
    expect(worker.of('entry/pressed')).toHaveLength(1);
    // The dialog's form, at the posting's own address, claimed by the Workable adapter; the worker told.
    await until(() => runtime.page?.adapter.id === 'workable');
    expect(fixture.doc.querySelector('dialog[open] form[data-ui="application-form"]')).not.toBeNull();
    await until(() => worker.of('frame/hello').some((hello) => hello.hasForm === true));
    // The worker's grant starts the run (run/start, as the worker sends it to the frame that pressed).
    expect(await runtime.fill()).toBe('review');
    const golden = goldenProfile();
    expect(rowOf(worker.reports.at(-1), 'First name')).toMatchObject({ status: 'verified', wrote: true });
    expect(rowOf(worker.reports.at(-1), 'Email')).toMatchObject({ status: 'verified', wrote: true });
    expect(log.values.firstname).toBe(golden.identity.firstName);
    // Apply now once, and nothing else pressed: the dialog's Cancel and Submit, Share job; nothing submitted.
    expect(log.applyNow).toBe(1);
    expect(log.pressed).toEqual([]);
    expect(log.submitted).toBe(0);
  }, 90_000);

  it("presses the sticky bar's Apply now where the posting's own is not shown", async () => {
    const { fixture, log } = await start();
    fixture.doc.querySelector<HTMLElement>('[data-ui="overview-apply-now"]')!.style.display = 'none';
    expect(workableAdapter.entryControl!(fixture.doc)).toBeNull();
    fixture.doc.querySelector<HTMLElement>('.wk-sticky')!.style.display = 'block';
    const sticky = fixture.doc.querySelector('[data-ui="sticky-apply-now"]');
    expect(workableAdapter.entryControl!(fixture.doc)).toBe(sticky);
    expect(log.applyNow).toBe(0);
  }, 30_000);

  it('never presses Apply now while the dialog is open: the run starts once its form shows, and fills it', async () => {
    // The person pressed Apply now: the dialog is open, its form drawn 3 s later.
    const { fixture, log, worker, runtime } = await start({ jobsOpen: true, formAfterMs: 3_000 });
    expect(fixture.doc.querySelector('dialog[open] [data-ui="application-form-title"]')).not.toBeNull();
    expect(workableAdapter.detect(fixture.doc)).toBeNull();
    // Apply now is still on the page and could take a click (the dialog is no modal): it is no entry while the dialog
    // shows, so the person's Autofill presses nothing.
    await worker.platform.deliver({ v: 1, type: 'run/start', dryRun: false });
    await until(() => workableAdapter.detect(fixture.doc) !== null);
    expect(log.applyNow).toBe(0);
    await until(() => worker.of('run/begin').length > 0, 20_000);
    expect(runtime.page?.adapter.id).toBe('workable');
    await until(() => rowOf(worker.reports.at(-1), 'First name')?.status === 'verified', 60_000);
    expect(log.applyNow).toBe(0);
    expect(worker.of('entry/pressed')).toEqual([]);
    expect(log.pressed).toEqual([]);
    expect(log.submitted).toBe(0);
  }, 120_000);
});
