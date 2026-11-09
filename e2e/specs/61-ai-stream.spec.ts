/*
 * v5 p2-stream (Jobright parity, Phase 2: each AI answer fills as it lands), end to end against the mock on a long
 * form (fixtures/synthetic/sixty-fields.html: 24 fields the profile fills, 36 questions only TailorIT's AI answers).
 * The mock paces every AI task as a CLI writes (ai-paced: its first item after CLI_START_MS, then one every ITEM_MS):
 * with TailorIT's stream the extension writes each answer as it lands; with ai-stream-off (a TailorIT before the
 * stream) it polls as before. Both runs fill the same fields; the streamed one writes its first answer sooner (the
 * last lands with its task's end either way: the tasks run one after another). The times, from the run's first write to
 * each AI answer written, are printed (the before/after of the P2 report).
 */
import { expect, test } from '../fixtures.ts';
import { row } from '../helpers/extension.ts';
import { mock } from '../helpers/mock.ts';
import { fixtureAddress } from '../helpers/reactive.ts';
import { stopWorker } from '../helpers/stop-worker.ts';
import type { Page } from '@playwright/test';

const SIXTY = { file: 'fixtures/synthetic/sixty-fields.html', url: fixtureAddress('sixty-fields') } as const;
/** A CLI's start, and the time it takes to write one item (the mock's ai-paced); TIA_P2STREAM_PACE="<start>,<item>"
 *  measures another pace (the P2 report's slower one), never in the suite. */
const [CLI_START_MS, ITEM_MS] = (process.env.TIA_P2STREAM_PACE ?? '1000,200').split(',').map(Number) as [number, number];
/** The 36 questions only the AI answers. */
const QUESTIONS = [...Array.from({ length: 12 }, (_, at) => `years-${at}`), ...Array.from({ length: 12 }, (_, at) => `used-${at}`),
  ...Array.from({ length: 12 }, (_, at) => `q-${at}`)];

interface Timing {
  /** From the run's first write (the first name, from the profile: the click, the lookup and a cold start set aside)
   *  to the first AI answer written, to the last, and how many were written. */
  firstMs: number;
  lastMs: number;
  answered: number;
  /** From the run's first write to the run's report at rest (sampled every few hundred ms). */
  doneMs: number;
}

/** Watches the questions' values from now (in the page, every 10 ms): when each first holds one, and when the first
 *  name (the run's first write, from the profile) did. */
async function watchAnswers(page: Page): Promise<void> {
  await page.evaluate((ids) => {
    const seen: Record<string, number> = {};
    const answers = { start: Number.NaN, seen };
    (globalThis as unknown as { __answers: typeof answers }).__answers = answers;
    const tick = () => {
      const first = document.getElementById('first') as HTMLInputElement | null;
      if (Number.isNaN(answers.start) && first !== null && first.value !== '') answers.start = performance.now();
      for (const id of ids) {
        const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
        if (el !== null && el.value !== '' && seen[id] === undefined) seen[id] = performance.now() - answers.start;
      }
    };
    setInterval(tick, 10);
  }, QUESTIONS);
}

async function measured(page: Page): Promise<Omit<Timing, 'doneMs'> & { nowMs: number }> {
  return page.evaluate(() => {
    const { start, seen } = (globalThis as unknown as { __answers: { start: number; seen: Record<string, number> } }).__answers;
    const times = Object.values(seen);
    return { firstMs: Math.round(Math.min(...times)), lastMs: Math.round(Math.max(...times)), answered: times.length,
      nowMs: Math.round(performance.now() - start) };
  });
}

test.describe('AI answers as they land (v5 p2-stream)', () => {
  test.setTimeout(240_000);

  test('a 60-field form: streamed answers are written as they land, sooner than polled ones, the same fields filled', async ({ extContext, extensionId, connected: ext, routeLog, tailorit }) => {
    routeLog.serve({ [SIXTY.url]: SIXTY.file });
    const run = async (streamOff: boolean): Promise<Timing> => {
      await mock.reset();
      await tailorit.scenario('ai-answer');
      await tailorit.scenario('ai-paced', { delayMs: CLI_START_MS, value: ITEM_MS });
      if (streamOff) await tailorit.scenario('ai-stream-off');
      const page = await extContext.newPage();
      await page.goto(SIXTY.url);
      await watchAnswers(page);
      const tabId = await ext.fill(page);
      const report = await ext.settled(tabId, { timeout: 180_000 });
      const timing = await measured(page);
      expect(report.status).toBe('review');
      expect(row(report, 'Which of our offices would you visit first?')).toMatchObject({ provenance: 'llm-answer',
        wrote: true });
      await page.close();
      return { firstMs: timing.firstMs, lastMs: timing.lastMs, answered: timing.answered, doneMs: timing.nowMs };
    };
    // Streamed first: a worker that met a TailorIT without the stream polls for the rest of its life.
    const streamed = await run(false);
    const asked = await mock.requestsTo('POST /api/autofill/ai/answer');
    const streams = (await mock.requests()).filter((request) => /^\/api\/ai\/tasks\/[0-9a-f-]{36}\/stream$/.test(request.path));
    const polled = await run(true);
    // The worker that met it starts afresh, so the specs after this one read streams again.
    const page = await extContext.newPage();
    await page.goto(SIXTY.url);
    await stopWorker(extContext, page, extensionId);
    await page.close();
    console.log(`[p2-stream] 60-field form, ai-paced ${CLI_START_MS} ms + ${ITEM_MS} ms an item: `
      + `polled ${JSON.stringify(polled)}; streamed ${JSON.stringify(streamed)}`);
    // The same questions answered either way.
    expect(streamed.answered).toBe(polled.answered);
    expect(streamed.answered).toBeGreaterThan(QUESTIONS.length / 2);
    // The first answer lands as Claude writes it, not once its whole batch is done.
    expect(streamed.firstMs).toBeLessThan(polled.firstMs - ITEM_MS);
    // What went out on the streamed run: answers asked for the 202 at once, and read on the stream.
    expect(asked.length).toBeGreaterThan(0);
    for (const request of asked) expect(request.headers.prefer).toBe('respond-async');
    expect(streams.length).toBeGreaterThanOrEqual(asked.length);
  });
});
