/*
 * The audit of 2026-11-06 (M2): a cover-letter text box (v3 Phase 3b) waits for the run's letter as a cover-letter
 * upload does (Phase G): the letter's own, longer wait, and when no letter comes within it the box says so
 * (cover-letter-timed-out), never that the AI could not be reached. The fake worker plans with the real planFrame
 * (content.testkit) and, given no letter, never settles the run's.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { createFakeWorker, testVocab } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

const PAGE = `<!doctype html><html><head><title>Northwind - Senior Backend Engineer</title></head><body><main>
  <h1>Senior Backend Engineer</h1>
  <form action="/__submitted" method="post">
    <label for="first">First name</label><input id="first" name="first">
    <label for="cover">Cover letter</label><textarea id="cover" name="cover" rows="8"></textarea>
    <button type="submit">Submit application</button>
  </form></main></body></html>`;

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

describe('a cover-letter text box waits for the run’s letter (M2)', () => {
  it('waits the letter’s own cap, past the AI’s, and says the letter did not come in time', async () => {
    const fixture = await loadFixture(document, PAGE);
    // No letter is ever settled: the box waits for it.
    const worker = createFakeWorker({ settings: DEFAULT_SETTINGS });
    const runtime = await startContentRuntime(worker.platform, fixture.doc,
      { href: () => 'https://jobs.lever.co/tailorit-fixture/letter-wait/apply', isTop: true, settle: { quietMs: 60 },
        ai: { pollMs: 20, capMs: 300, letterCapMs: 1_500 } });
    runtimes.push(runtime);
    const started = performance.now();
    expect(await runtime.fill()).toBe('review');
    const row = worker.reports.at(-1)!.fields.find((candidate) => candidate.label === 'Cover letter')!;
    expect(row).toMatchObject({ category: 'freeText.coverLetter', status: 'flagged', reason: 'cover-letter-timed-out',
      wrote: false });
    // It waited for the letter, not the AI's shorter cap.
    expect(performance.now() - started).toBeGreaterThanOrEqual(1_400);
    expect((fixture.doc.getElementById('cover') as HTMLTextAreaElement).value).toBe('');
  });
});
