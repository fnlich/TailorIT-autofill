/*
 * v2.0 fix wave (REQ-1): TailorIT's words for its AI's two blocked states (ai-notice.ts), and the notice an autofill run
 * raises once when TailorIT's AI refuses its steps: kept per tab for that run, carried with the tab's reports to the
 * panels (panel/update, panel/reports), never twice for the same run, gone with another run's report, the tab or the
 * token. The run itself fills on without AI.
 */
import { describe, expect, it, vi } from 'vitest';
import type { FieldSpec } from '../core/types/field';
import { AI_REFUSAL_MESSAGE_MAX, aiRefusalOf, createAiNotices, type AiRefusal } from './ai-notice';
import { createRunLetter } from './cover-letters';
import type { ServerResult } from './server-client';
import { manualTimers } from './timers';
import {
  askingCore, beginRun, contentSender, fieldSpec, frameReport, pageSender, startTestWorker, tokenRecord, type TestWorker,
} from './worker.testkit';

const USAGE = 'You’ve used your AI usage. Get extra credit or use your own AI via MCP.';
const UNAVAILABLE = 'TailorIT’s AI isn’t available right now. Please try again later.';
const PICK = 'POST /api/autofill/ai/pick';

describe('aiRefusalOf: TailorIT’s words for its AI’s two refusals alone', () => {
  it('keeps the words of ai_unavailable and ai_usage_exhausted, trimmed and cut; none for any other code', () => {
    expect(aiRefusalOf({ code: 'ai_usage_exhausted', message: ` ${USAGE} ` })).toEqual({ code: 'ai_usage_exhausted',
      message: USAGE });
    expect(aiRefusalOf({ code: 'ai_unavailable', message: UNAVAILABLE })).toEqual({ code: 'ai_unavailable',
      message: UNAVAILABLE });
    expect(aiRefusalOf({ code: 'ai_unavailable', message: 'word '.repeat(200) })?.message.length)
      .toBeLessThanOrEqual(AI_REFUSAL_MESSAGE_MAX);
    for (const code of ['ai_busy', 'ai_failed', 'rate_limited', 'internal', 'not_found', undefined]) {
      expect(aiRefusalOf({ code, message: 'Anything.' }), String(code)).toBeNull();
    }
    expect(aiRefusalOf({ code: 'ai_unavailable', message: '   ' })).toBeNull();
    expect(aiRefusalOf({ code: 'ai_unavailable' })).toBeNull();
    expect(aiRefusalOf(null)).toBeNull();
  });
});

describe('createAiNotices: once per run, for the run shown', () => {
  it('tells once per run, replaces it for another run, shows it while its run is shown, and forgets it', () => {
    const told: number[] = [];
    const notices = createAiNotices({ changed: (tabId) => void told.push(tabId) });
    notices.note(7, 'run-a', { code: 'ai_usage_exhausted', message: USAGE });
    notices.note(7, 'run-a', { code: 'ai_unavailable', message: UNAVAILABLE });
    expect(told).toEqual([7]);
    expect(notices.of(7, ['run-a'])).toBe(USAGE);
    // Another run's report only: not this one's notice.
    expect(notices.of(7, ['run-b'])).toBeNull();
    expect(notices.of(8, ['run-a'])).toBeNull();
    notices.note(7, 'run-b', { code: 'ai_unavailable', message: UNAVAILABLE });
    expect(told).toEqual([7, 7]);
    expect(notices.of(7, ['run-b'])).toBe(UNAVAILABLE);
    notices.forgetTab(7);
    expect(notices.of(7, ['run-b'])).toBeNull();
    notices.note(9, 'run-c', { code: 'ai_unavailable', message: UNAVAILABLE });
    notices.dropTokenData();
    expect(notices.of(9, ['run-c'])).toBeNull();
  });
});

/** A select the asking core sends to the tiebreak (a pick task). */
function selectSpec(index: number): FieldSpec {
  return fieldSpec(index, { kind: 'select', label: `How did you hear about us? ${index}`,
    key: `lever|main|source-${index}|9d4c2b7e1f0a3c5${index}|0` as FieldSpec['key'],
    optionSetHash: `9d4c2b7e1f0a3c5${index}` as FieldSpec['optionSetHash'],
    options: ['LinkedIn job post', 'Indeed'].map((label, at) => ({ index: at, label, disabled: false, selected: false })) });
}

async function plan(worker: TestWorker, runId: string, spec: FieldSpec): Promise<{ ok: boolean; data?: { awaiting: string[] } }> {
  return (await worker.deliver({ v: 1, type: 'plan/request', runId, pass: 0, specs: [spec], planKeys: [spec.key],
    canaries: [], notices: [] }, contentSender())) as { ok: boolean; data?: { awaiting: string[] } };
}

type Update = { type: string; aiNotice?: string };
const updates = (received: unknown[]) => (received as Update[]).filter((message) => message.type === 'panel/update');

describe('an autofill run that TailorIT’s AI refuses (REQ-1)', () => {
  // Undo proof: drop createRunAi's onRefused call (ai-tasks.ts), or reports.ts's aiNotice, and no update carries it.
  it('raises one notice with TailorIT’s words, carried with the tab’s reports, and fills on without AI', async () => {
    const worker = await startTestWorker({ token: tokenRecord(), core: askingCore() });
    worker.tailorit.reply(PICK, { status: 429, headers: { 'retry-after': '36000' },
      json: { error: { code: 'ai_usage_exhausted', message: USAGE, retryAfterSeconds: 36000 } } });
    const runId = await beginRun(worker);
    await worker.deliver({ v: 1, type: 'report/put', runId, report: frameReport(runId) }, contentSender());
    const panel = worker.connect('panel', pageSender());
    panel.post({ v: 1, type: 'panel/watch', tabId: 7 });
    await vi.waitFor(() => expect(updates(panel.received)).toHaveLength(1));
    expect(updates(panel.received)[0]).not.toHaveProperty('aiNotice');

    // The first refused batch: the notice, pushed with the tab's reports.
    expect((await plan(worker, runId, selectSpec(1))).data?.awaiting).toHaveLength(1);
    await vi.waitFor(() => expect(worker.tailorit.count(PICK)).toBe(1));
    await vi.waitFor(() => expect(updates(panel.received).at(-1)?.aiNotice).toBe(USAGE));
    const pushed = updates(panel.received).length;
    // The field is planned again without an answer: the run goes on without AI.
    const again = (await worker.deliver({ v: 1, type: 'plan/poll', runId, keys: [selectSpec(1).key] }, contentSender())) as
      { ok: boolean; data?: { awaiting: string[] } };
    expect(again).toMatchObject({ ok: true, data: { awaiting: [] } });

    // A second refused batch of the same run: no second notice.
    await plan(worker, runId, selectSpec(2));
    await vi.waitFor(() => expect(worker.tailorit.count(PICK)).toBe(2));
    for (let step = 0; step < 20; step += 1) await new Promise((resolve) => setImmediate(resolve));
    expect(updates(panel.received)).toHaveLength(pushed);

    // A read of the tab answers it too; and a report of the run pushed later still carries it.
    const read = (await worker.deliver({ v: 1, type: 'panel/reports', tabId: 7 }, pageSender())) as
      { ok: boolean; data?: { aiNotice?: string } };
    expect(read.data?.aiNotice).toBe(USAGE);
    await worker.deliver({ v: 1, type: 'report/put', runId, report: frameReport(runId, 0, { updatedAt: 2 }) },
      contentSender());
    await vi.waitFor(() => expect(updates(panel.received)).toHaveLength(pushed + 1));
    expect(updates(panel.received).at(-1)?.aiNotice).toBe(USAGE);

    // The tab's next run (its own report): no notice until it meets a refusal of its own.
    const next = await beginRun(worker);
    await worker.deliver({ v: 1, type: 'report/put', runId: next, report: frameReport(next, 0, { updatedAt: 3 }) },
      contentSender());
    await vi.waitFor(() => expect(updates(panel.received)).toHaveLength(pushed + 2));
    expect(updates(panel.received).at(-1)).not.toHaveProperty('aiNotice');
  });

  it('raises it for a 503 ai_unavailable too, and never for another code’s words', async () => {
    const worker = await startTestWorker({ token: tokenRecord(), core: askingCore() });
    worker.tailorit.reply(PICK, { status: 503, json: { error: { code: 'ai_unavailable', message: UNAVAILABLE } } });
    const runId = await beginRun(worker);
    await worker.deliver({ v: 1, type: 'report/put', runId, report: frameReport(runId) }, contentSender());
    await plan(worker, runId, selectSpec(1));
    await vi.waitFor(async () => expect(((await worker.deliver({ v: 1, type: 'panel/reports', tabId: 7 }, pageSender())) as
      { data?: { aiNotice?: string } }).data?.aiNotice).toBe(UNAVAILABLE));
    // Another code's words never make a notice.
    const busy = await startTestWorker({ token: tokenRecord(), core: askingCore() });
    busy.tailorit.reply(PICK, { status: 400, json: { error: { code: 'validation_failed', message: 'Bad words.' } } });
    const busyRun = await beginRun(busy);
    await busy.deliver({ v: 1, type: 'report/put', runId: busyRun, report: frameReport(busyRun) }, contentSender());
    await plan(busy, busyRun, selectSpec(1));
    await vi.waitFor(() => expect(busy.tailorit.count(PICK)).toBe(1));
    for (let step = 0; step < 20; step += 1) await new Promise((resolve) => setImmediate(resolve));
    expect(((await busy.deliver({ v: 1, type: 'panel/reports', tabId: 7 }, pageSender())) as
      { data?: Record<string, unknown> }).data).not.toHaveProperty('aiNotice');
  });

  // Undo proof: drop createRunLetter's onRefused call, or post's kept refusal (cover-letters.ts), and nothing is heard.
  it('hears the run’s cover letter TailorIT’s AI would not write, with its words, once; the letter is none', async () => {
    for (const [code, message] of [['ai_usage_exhausted', USAGE], ['ai_unavailable', UNAVAILABLE],
      ['ai_busy_other', 'Other words.']] as const) {
      const heard: AiRefusal[] = [];
      const refusal: ServerResult<never> = { ok: false, failure: 'server-error', status: 503, code, message };
      const server = {
        // The check finds none of the person's (404); the ask that may write is refused.
        coverLetter: async (body: { generate: boolean }) => (body.generate ? refusal
          : { ok: false as const, failure: 'not-found' as const, status: 404 }),
        coverLetterState: async () => refusal,
      };
      const run = createRunLetter({ server, timers: manualTimers(), now: () => 0 }, undefined,
        (words) => void heard.push(words));
      run.ask({ jobId: 4821, company: 'Northwind', jobTitle: 'Senior Backend Engineer', jobText: 'Posting.',
        resumeId: 'resume-1', generate: true, canaries: [] });
      await run.idle();
      expect(run.input(), code).toEqual({ state: 'none', reason: 'cover-letter-unavailable' });
      expect(heard, code).toEqual(code === 'ai_busy_other' ? [] : [{ code, message }]);
    }
  });
});
