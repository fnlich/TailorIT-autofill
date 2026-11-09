/*
 * v5 p2-stream (Jobright parity, Phase 2: each AI answer fills as it lands): the worker's plan/ready ends the loop's
 * wait for the AI at once, so an answer that came in is written then rather than at the next poll (AI_POLL_MS stays
 * the fallback); plan/ready is the worker's alone; and answers that come in one by one are each written, past the AI
 * pass cap (bookkeeping.ts noteArrivalPass).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import savedAnswers from '../../fixtures/synthetic/saved-answers.html?raw';
import sixty from '../../fixtures/synthetic/sixty-fields.html?raw';
import { MAX_AI_PASSES } from '../core/loop/bookkeeping';
import { CAUTIOUS_SETTINGS } from '../core/plan/settings.testkit';
import type { FieldKey } from '../core/types/field';
import { loadFixture, removeFixtures } from '../dom/fixture.testkit';
import { createFakeWorker, FAKE_ANSWER, testVocab } from './content.testkit';
import { startContentRuntime, type ContentRuntime } from './runtime';

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

/** Answers on, classification off: a question nothing else settles goes straight to the AI's answer. */
const ANSWERS_ON = { ...CAUTIOUS_SETTINGS, llm: { ...CAUTIOUS_SETTINGS.llm, classify: false, answers: true } };
const boardUrl = (name: string) => `https://jobs.lever.co/tailorit-fixture/${name}/apply`;

describe('answers that come in (v5 p2-stream)', () => {
  it('plan/ready ends the wait for the AI at once: the answer is written long before the next poll', async () => {
    const fixture = await loadFixture(document, savedAnswers);
    let holding = true;
    const worker = createFakeWorker({ settings: ANSWERS_ON, aiHold: () => holding });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => boardUrl('saved-answers'),
      isTop: true, settle: { quietMs: 50 }, ai: { pollMs: 6000 } });
    runtimes.push(runtime);
    const filled = runtime.fill();
    // The loop asked, polled once, and now waits for its 6 s tick.
    await vi.waitFor(() => expect(worker.of('plan/poll').length).toBeGreaterThanOrEqual(1), { timeout: 10_000 });
    const polls = worker.of('plan/poll').length;
    const office = fixture.doc.getElementById('office') as HTMLInputElement;
    expect(office.value).toBe('');
    holding = false;
    const runId = String(worker.of('plan/poll')[0]!.runId);
    const told = performance.now();
    expect(await worker.platform.deliver({ v: 1, type: 'plan/ready', runId })).toEqual({ ok: true, data: {} });
    await vi.waitFor(() => expect(office.value).toBe(FAKE_ANSWER), { timeout: 5000, interval: 20 });
    expect(performance.now() - told).toBeLessThan(2000);
    expect(worker.of('plan/poll').length).toBe(polls + 1);
    await filled;
  });

  it('takes plan/ready from the worker alone, and only for its own run', async () => {
    const fixture = await loadFixture(document, savedAnswers);
    const worker = createFakeWorker({ settings: ANSWERS_ON, aiHold: true });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => boardUrl('saved-answers'),
      isTop: true, settle: { quietMs: 50 }, ai: { pollMs: 200, capMs: 1500 } });
    runtimes.push(runtime);
    const filled = runtime.fill();
    await vi.waitFor(() => expect(worker.of('plan/poll').length).toBeGreaterThanOrEqual(1), { timeout: 10_000 });
    const runId = String(worker.of('plan/poll')[0]!.runId);
    // A page's content script, and the extension's own side panel page: never the worker.
    expect(await worker.platform.deliverFrom({ v: 1, type: 'plan/ready', runId },
      { id: 'memory-extension', tabId: 7, frameId: 0, url: boardUrl('saved-answers') }))
      .toEqual({ ok: false, error: 'bad_sender' });
    expect(await worker.platform.deliverFrom({ v: 1, type: 'plan/ready', runId },
      { id: 'memory-extension', url: 'chrome-extension://memory-extension/sidepanel.html' }))
      .toEqual({ ok: false, error: 'bad_sender' });
    expect(await worker.platform.deliver({ v: 1, type: 'plan/ready', runId: 'another-run' }))
      .toEqual({ ok: false, error: 'expired' });
    await filled;
  });

  it(`writes answers that come in one at a time, more than MAX_AI_PASSES (${MAX_AI_PASSES}) of them, each as it lands`, async () => {
    const fixture = await loadFixture(document, sixty);
    // One answer comes in at each poll, as TailorIT's stream brings them.
    const worker = createFakeWorker({ settings: ANSWERS_ON, aiGate: (keys: readonly FieldKey[]) => keys.slice(0, 1) });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => boardUrl('sixty-fields'),
      isTop: true, settle: { quietMs: 30 }, ai: { pollMs: 50 } });
    runtimes.push(runtime);
    await runtime.fill();
    const report = worker.reports.at(-1)!;
    const answered = report.fields.filter((row) => row.provenance === 'llm-answer');
    expect(answered.length).toBeGreaterThan(MAX_AI_PASSES);
    expect(answered.every((row) => row.wrote)).toBe(true);
    expect(report.fields.filter((row) => row.reason === 'max-passes-reached')).toEqual([]);
  }, 60_000);
});

describe('an answer whose reply TailorIT then voided (the P2 review, security 5)', () => {
  const OFFICE = 'Which of our offices would you visit first?';

  it('flags the field written from it for review at rest, left as written; a field the profile filled stays', async () => {
    const fixture = await loadFixture(document, savedAnswers);
    const worker = createFakeWorker({ settings: ANSWERS_ON });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => boardUrl('saved-answers'),
      isTop: true, settle: { quietMs: 30 }, ai: { pollMs: 50 } });
    runtimes.push(runtime);
    expect(await runtime.fill()).toBe('review');
    const runId = String(worker.of('plan/poll')[0]!.runId);
    const before = worker.reports.at(-1)!.fields;
    const office = before.find((row) => row.label === OFFICE)!;
    const profiled = before.find((row) => row.provenance === 'profile' && row.wrote)!;
    expect(office).toMatchObject({ provenance: 'llm-answer', wrote: true, needsUserAction: false });
    expect(await worker.platform.deliver({ v: 1, type: 'plan/ready', runId, reviews: [office.key, profiled.key] }))
      .toEqual({ ok: true, data: {} });
    await vi.waitFor(() => expect(worker.reports.at(-1)!.fields.find((row) => row.label === OFFICE))
      .toMatchObject({ status: 'flagged', reason: 'ai-reply-voided', wrote: true, needsUserAction: true,
        provenance: 'llm-answer' }));
    const after = worker.reports.at(-1)!.fields;
    expect(after.find((row) => row.key === profiled.key)).toEqual(profiled);
    expect((fixture.doc.getElementById('office') as HTMLInputElement).value).toBe(FAKE_ANSWER);
    // A word for another run changes nothing; one without reviews at rest is expired, as before.
    expect(await worker.platform.deliver({ v: 1, type: 'plan/ready', runId: 'another-run', reviews: [office.key] }))
      .toEqual({ ok: false, error: 'expired' });
    expect(await worker.platform.deliver({ v: 1, type: 'plan/ready', runId })).toEqual({ ok: false, error: 'expired' });
  });

  it('flags it in the run’s rows when the word comes while the run fills', async () => {
    const fixture = await loadFixture(document, savedAnswers);
    let holding = true;
    const worker = createFakeWorker({ settings: ANSWERS_ON, aiHold: () => holding });
    const runtime = await startContentRuntime(worker.platform, fixture.doc, { href: () => boardUrl('saved-answers'),
      isTop: true, settle: { quietMs: 30 }, ai: { pollMs: 6000 } });
    runtimes.push(runtime);
    const filled = runtime.fill();
    await vi.waitFor(() => expect(worker.of('plan/poll').length).toBeGreaterThanOrEqual(1), { timeout: 10_000 });
    const poll = worker.of('plan/poll')[0]!;
    const runId = String(poll.runId);
    const keys = poll.keys as string[];
    holding = false;
    expect(await worker.platform.deliver({ v: 1, type: 'plan/ready', runId, reviews: keys })).toEqual({ ok: true, data: {} });
    expect(await filled).toBe('review');
    const office = worker.reports.at(-1)!.fields.find((row) => row.label === OFFICE)!;
    expect(office).toMatchObject({ status: 'flagged', reason: 'ai-reply-voided', wrote: true, needsUserAction: true });
  });
});
