/*
 * Submit mode Auto reads its facts again after its last wait (docs/SPEC-AMENDMENTS.md §12 Decision 6, the review of
 * 2026-11-02): between the step's validation and its press, a value the run wrote that the page changed since, or an
 * error the page drew, leaves the Submit to the person (submit-held-check), and nothing is pressed. The audit of
 * 2026-11-06 found no test held the re-check (a surviving mutation at orchestrator.ts's re-check after its last wait).
 * The page changes right as the run stores its verdict (its runstate/put at review), before the press.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { greenhouseAdapter } from '../adapters/greenhouse';
import type { RunState } from '../core/types/run';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { loadFixture, removeFixtures, type Fixture } from '../dom/fixture.testkit';
import { deadline } from '../dom/time';
import { createFakeWorker, testVocab } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

const GREENHOUSE = 'https://job-boards.greenhouse.io/tailoritfixture/jobs/4701';
const AUTO = { ...DEFAULT_SETTINGS, modes: { ...DEFAULT_SETTINGS.modes, submit: 'auto' as const } };
const PAGE = `<!doctype html><html><head><title>Job Application for Engineer at Northwind</title></head><body>
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

/** A Submit mode Auto run on the page, whose page `change`s right as the run stores its verdict at review. */
async function run(at: number, change: (fixture: Fixture) => void) {
  const holder: { fixture?: Fixture; changed: boolean } = { changed: false };
  const worker = createFakeWorker({ settings: AUTO, onMessage(message) {
    const state = (message as { runState?: RunState }).runState;
    if (message.type !== 'runstate/put' || state?.status !== 'review' || holder.changed || holder.fixture === undefined) {
      return;
    }
    holder.changed = true;
    change(holder.fixture);
  } });
  const fixture = await loadFixture(document, PAGE, { width: 1100, height: 1200 });
  holder.fixture = fixture;
  const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => `${GREENHOUSE}${at}`,
    isTop: true, adapters: () => [greenhouseAdapter], settle: { quietMs: 40 } });
  runtimes.push(runtime);
  expect(await runtime.fill()).toBe('review');
  await deadline(200);
  return { fixture, worker, changed: holder.changed };
}

const submitted = (fixture: Fixture) => (fixture.view as unknown as { submitted: number }).submitted;
const codes = (worker: ReturnType<typeof createFakeWorker>) => worker.reports.at(-1)!.notices.map((notice) => notice.code);

describe('Submit mode Auto’s re-check after its last wait', () => {
  it('presses a clean step whose page changed nothing', async () => {
    const { fixture, worker, changed } = await run(1, () => undefined);
    expect(changed).toBe(true);
    await vi.waitFor(() => expect(submitted(fixture)).toBe(1));
    expect(worker.of('submit/armed')).toHaveLength(1);
  });

  it('holds when a value the run wrote was changed by the page before the press', async () => {
    const { fixture, worker, changed } = await run(2, (page) => {
      (page.doc.getElementById('first_name') as HTMLInputElement).value = 'Somebody Else';
    });
    expect(changed).toBe(true);
    await vi.waitFor(() => expect(codes(worker)).toContain('submit-held-check'));
    expect(submitted(fixture)).toBe(0);
    expect(worker.of('submit/armed')).toEqual([]);
  });

  it('holds when the page drew an error before the press', async () => {
    const { fixture, worker, changed } = await run(3, (page) => {
      page.doc.getElementById('last_name')!.setAttribute('aria-invalid', 'true');
    });
    expect(changed).toBe(true);
    await vi.waitFor(() => expect(codes(worker)).toContain('submit-held-check'));
    expect(submitted(fixture)).toBe(0);
    expect(worker.of('submit/armed')).toEqual([]);
  });
});
