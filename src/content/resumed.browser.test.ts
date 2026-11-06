/*
 * The audit of 2026-11-06 (m3): a run found after a reload that offers Continue rests, and its report says so. Under
 * Autofill after page turn: Manually, a run stored while it filled is never reported as one at work ("Autofilling…"),
 * and a run stored at review offers no Next or Submit in the panel's dock, which its press would refuse: it offers
 * Continue. Through the real content runtime and the fake worker planning with the real core.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import html from '../../fixtures/synthetic/wizard-4-step/index.html?raw';
import { applicationOf } from '../adapters';
import { greenhouseAdapter } from '../adapters/greenhouse';
import { e2eAdaptersFor, WIZARD_URL } from '../adapters/test';
import type { Adapter } from '../adapters/types';
import { CAUTIOUS_SETTINGS } from '../core/plan/settings.testkit';
import { createRunState } from '../core/steps/machine';
import type { RunState } from '../core/types/run';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import type { FrameReport } from '../shared/report';
import { createFakeWorker, testVocab } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

const WIZARD: Adapter = e2eAdaptersFor(new URL(WIZARD_URL))[0]!;
const GREENHOUSE = 'https://job-boards.greenhouse.io/tailoritfixture/jobs/4601';
const GREENHOUSE_PAGE = `<!doctype html><html><head><title>Job Application for Engineer at Northwind</title></head><body>
  <main class="main"><h1>Engineer</h1>
  <form id="application-form" class="application--form">
    <div class="field-wrapper"><label for="first_name">First Name<span>*</span></label>
      <input id="first_name" name="first_name" type="text" aria-required="true"></div>
    <div class="field-wrapper"><label for="last_name">Last Name<span>*</span></label>
      <input id="last_name" name="last_name" type="text" aria-required="true"></div>
    <div class="application--submit"><button id="submit" class="btn btn--pill" type="submit">Submit application</button></div>
  </form></main>
  <script>window.submitted = 0; document.getElementById('application-form').addEventListener('submit', (event) => {
    event.preventDefault(); window.submitted += 1; });</script></body></html>`;

let logs: MockInstance;
beforeAll(() => {
  testVocab();
  logs = vi.spyOn(console, 'info');
});
afterAll(() => logs.mockRestore());

const runtimes: ContentRuntime[] = [];
afterEach(() => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  removeFixtures(document);
});

const lastReport = (worker: ReturnType<typeof createFakeWorker>): FrameReport => worker.reports.at(-1)!;

describe('a run found after a reload that offers Continue (m3)', () => {
  it('is reported resting, never at work, when it was stored mid-fill under Autofill after page turn: Manually',
    async () => {
      const worker = createFakeWorker({ settings: { ...CAUTIOUS_SETTINGS,
        modes: { ...CAUTIOUS_SETTINGS.modes, afterPageTurn: 'manual' as const } } });
      const applicationKey = applicationOf(new URL(WIZARD_URL))!.applicationKey;
      const now = Date.now();
      const midFill: RunState = { ...createRunState({ applicationKey,
        platform: applicationKey.split(':')[0] as RunState['platform'], now }),
      status: 'fill-step', stepSignature: 'aaaaaaaaaaaaaaaa', stepAttempts: { aaaaaaaaaaaaaaaa: 1 } };
      await worker.platform.runtime.send({ v: 1, type: 'runstate/put', runState: midFill });
      const fixture = await loadFixture(document, html, { width: 900, height: 1400 });
      const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => WIZARD_URL, isTop: true,
        adapters: () => [WIZARD], settle: { quietMs: 60 } });
      runtimes.push(runtime);
      await vi.waitFor(() => expect(runtime.run?.ended).toBe('paused'), { timeout: 10_000 });
      await vi.waitFor(() => expect(worker.reports.length).toBeGreaterThan(0));
      // Resting at review, offering Continue: never one of the statuses the panels read as at work.
      expect(lastReport(worker).status).toBe('review');
      expect(lastReport(worker).buttons).toBeUndefined();
      expect(runtime.ui!.launcher.view).toMatchObject({ action: 'continue' });
      // Nothing was filled by itself.
      expect((fixture.doc.getElementById('name') as HTMLInputElement).value).toBe('');
    });

  it('offers no Submit in the dock when it was stored at review: the panel’s press would refuse it', async () => {
    const worker = createFakeWorker({ settings: DEFAULT_SETTINGS });
    const options = { href: () => GREENHOUSE, isTop: true, adapters: () => [greenhouseAdapter], settle: { quietMs: 40 } };
    const first = await loadFixture(document, GREENHOUSE_PAGE, { width: 1100, height: 1200 });
    const before = await startContentRuntime(worker.platform, first.doc, options);
    runtimes.push(before);
    expect(await before.fill()).toBe('review');
    expect(lastReport(worker).buttons).toMatchObject({ submit: true });
    before.stop();
    removeFixtures(document);
    // The reload: the run stored at review offers Continue, and the dock offers nothing it would refuse.
    const again = await loadFixture(document, GREENHOUSE_PAGE, { width: 1100, height: 1200 });
    const after = await startContentRuntime(worker.platform, again.doc, options);
    runtimes.push(after);
    await vi.waitFor(() => expect(after.run?.ended).toBe('paused'), { timeout: 10_000 });
    await vi.waitFor(() => expect(lastReport(worker).buttons).toBeUndefined());
    expect(lastReport(worker).status).toBe('review');
    expect(await worker.platform.deliver({ v: 1, type: 'run/press', target: 'submit', confirmed: true }))
      .toEqual({ ok: true, data: { outcome: 'not-offered' } });
    expect((again.view as unknown as { submitted: number }).submitted).toBe(0);
  });
});
