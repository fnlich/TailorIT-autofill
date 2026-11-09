/*
 * v5 p2-stream (Jobright parity, Phase 2): the worker reads an AI task's stream, and when the run's answers come in
 * it tells the run's own frame and document at once (plan/ready, the run's id alone), which then polls; with a
 * TailorIT that has no stream, it polls as before and says nothing.
 */
import { describe, expect, it, vi } from 'vitest';
import type { FieldSpec } from '../core/types/field';
import {
  askingCore, beginRun, contentSender, fieldSpec, itemsOf, startTestWorker, taskView, TASK_ID, tokenRecord,
  type TestWorker,
} from './worker.testkit';

const PICK = 'POST /api/autofill/ai/pick';
const STREAM = `GET /api/ai/tasks/${TASK_ID}/stream`;

function sourceSpec(): FieldSpec {
  return fieldSpec(1, { kind: 'select', label: 'How did you hear about us?',
    key: 'lever|main|source-1|9d4c2b7e1f0a3c58|0' as FieldSpec['key'],
    optionSetHash: '9d4c2b7e1f0a3c58' as FieldSpec['optionSetHash'],
    options: ['LinkedIn job post', 'Indeed'].map((label, at) => ({ index: at, label, disabled: false, selected: false })) });
}

type Answer = { ok: boolean; data?: { writes: unknown[]; awaiting: string[] } };

const request = async (worker: TestWorker, runId: string, specs: FieldSpec[]) => (await worker.deliver({ v: 1,
  type: 'plan/request', runId, pass: 0, specs, planKeys: specs.map((spec) => spec.key), canaries: [], notices: [] },
contentSender())) as Answer;

/** The pick's finished task for what the worker asked: option 0 for every item. */
function finishedPick(worker: TestWorker): Record<string, unknown> {
  const asked = itemsOf(worker.tailorit.requests.filter((sent) => sent.path === '/api/autofill/ai/pick').at(-1)!);
  return taskView('autofill_pick', 'succeeded', { picks: asked.map((item) => ({ key: item.key,
    optionSetHash: item.optionSetHash, index: 0, reason: 'matched' })) });
}

describe('plan/ready (v5 p2-stream)', () => {
  it('reads the task’s stream and tells the run’s own frame its answers came in, without a poll of TailorIT', async () => {
    const worker = await startTestWorker({ token: tokenRecord(), core: askingCore() });
    const told = vi.spyOn(worker.platform.tabs, 'sendToFrame');
    worker.tailorit.reply(PICK, { status: 202, json: { taskId: TASK_ID } });
    worker.tailorit.reply(STREAM, () => {
      const event = { type: 'task', task: finishedPick(worker) };
      return { bytes: new TextEncoder().encode(`: ping\n\nevent: task\ndata: ${JSON.stringify(event)}\n\n`),
        headers: { 'Content-Type': 'text/event-stream' } };
    });
    const runId = await beginRun(worker);
    const spec = sourceSpec();
    expect(await request(worker, runId, [spec])).toMatchObject({ ok: true, data: { awaiting: [spec.key] } });
    await vi.waitFor(() => expect(told.mock.calls.some(([, message]) =>
      (message as { type?: string }).type === 'plan/ready')).toBe(true));
    const [tabId, message, target] = told.mock.calls.find(([, sent]) => (sent as { type?: string }).type === 'plan/ready')!;
    expect([tabId, message, target]).toEqual([7, { v: 1, type: 'plan/ready', runId }, { frameId: 0, documentId: 'doc-1' }]);
    // Asked for the 202 at once, read on the stream: never polled.
    const pick = worker.tailorit.requests.find((sent) => sent.path === '/api/autofill/ai/pick')!;
    expect(pick.headers.prefer).toBe('respond-async');
    expect(worker.tailorit.requests.filter((sent) => sent.path === `/api/ai/tasks/${TASK_ID}`)).toEqual([]);
    // The frame's poll now finds the pick in.
    const polled = (await worker.deliver({ v: 1, type: 'plan/poll', runId, keys: [spec.key] }, contentSender())) as Answer;
    expect(polled).toMatchObject({ ok: true, data: { awaiting: [] } });
    expect(polled.data!.writes).toHaveLength(1);
  });
});
