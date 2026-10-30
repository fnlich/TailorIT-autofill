/*
 * Receivers parse answers too (messaging/envelope.ts), so every answer the worker gives must parse with the schema its
 * receiver will use: CONTENT_ANSWER_SCHEMAS for a frame, PAGE_ANSWER_SCHEMAS for an extension page,
 * EXTERNAL_ANSWER_SCHEMAS for TailorIT's page. Each message type is sent once, and its answer parsed.
 */
import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { answerSchema } from '../messaging/envelope';
import {
  CONTENT_ANSWER_SCHEMAS,
  ContentMessageSchema,
  EXTERNAL_ANSWER_SCHEMAS,
  PAGE_ANSWER_SCHEMAS,
  PageMessageSchema,
} from '../messaging/schemas';
import {
  beginRun,
  connectPageSender,
  contentSender,
  fieldSpec,
  frameReport,
  LEVER_KEY,
  ORIGIN,
  pageSender,
  runState,
  startTestWorker,
  tokenRecord,
} from './worker.testkit';

const typesOf = (schema: { options: ReadonlyArray<{ shape: { type: { value: string } } }> }) =>
  schema.options.map((option) => option.shape.type.value);

describe('every answer parses with the schema its receiver uses', () => {
  it('names an answer schema for every message type', () => {
    expect(typesOf(ContentMessageSchema as never).filter((type) => type !== 'e2e/probe').sort())
      .toEqual(Object.keys(CONTENT_ANSWER_SCHEMAS).sort());
    expect(typesOf(PageMessageSchema as never).sort()).toEqual(Object.keys(PAGE_ANSWER_SCHEMAS).sort());
  });

  it('for content messages', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    /** Each message, built when it is sent (a message that names a run gets a run of its own). */
    const messages: Array<() => Promise<Record<string, unknown>>> = [
      async () => ({ type: 'ping' }),
      async () => ({ type: 'frame/hello', isTop: true, hasForm: true }),
      async () => ({ type: 'run/begin', applicationKey: LEVER_KEY, trigger: 'launcher', dryRun: true }),
      async () => ({ type: 'plan/request', runId: await beginRun(worker), pass: 0, specs: [fieldSpec(1)], canaries: [], notices: [] }),
      async () => ({ type: 'plan/poll', runId: await beginRun(worker), keys: [] }),
      async () => ({ type: 'runstate/put', runState: runState() }),
      async () => ({ type: 'runstate/get', applicationKey: LEVER_KEY }),
      async () => ({ type: 'runstate/clear', applicationKey: LEVER_KEY }),
      async () => {
        const runId = await beginRun(worker);
        return { type: 'report/put', runId, report: frameReport(runId) };
      },
      async () => ({ type: 'policy/hit', applicationKey: LEVER_KEY, patternId: null }),
      async () => ({ type: 'panel/open' }),
    ];
    for (const build of messages) {
      const message = await build();
      const type = message.type as keyof typeof CONTENT_ANSWER_SCHEMAS;
      const answer = await worker.deliver({ v: 1, ...message }, contentSender());
      expect(answer, type).toMatchObject({ ok: true });
      expect(answerSchema(CONTENT_ANSWER_SCHEMAS[type]).safeParse(answer).success, type).toBe(true);
    }
  });

  it('for extension pages', async () => {
    const worker = await startTestWorker({ token: tokenRecord() });
    await worker.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender());
    const runId = await beginRun(worker);
    // The frame's run waits at the policy card, so the card's decision has somewhere to go.
    await worker.deliver({ v: 1, type: 'report/put', runId, report: frameReport(runId, 0, { status: 'policy-notice' }) },
      contentSender());
    worker.fakes.frameAnswers = ({ message }) => ((message as { type: string }).type === 'field/describe'
      ? { ok: true, data: { options: [{ index: 0, label: 'Yes' }] } }
      : { ok: true, data: {} });
    const key = fieldSpec(1).key;
    const messages: Array<Record<string, unknown>> = [
      { type: 'ping' },
      { type: 'panel/fill', tabId: 7, dryRun: true },
      { type: 'panel/continue', tabId: 7 },
      { type: 'panel/cancel', tabId: 7 },
      { type: 'panel/policyDecision', tabId: 7, frameId: 0, decision: 'fill' },
      { type: 'panel/focus', tabId: 7, frameId: 0, fieldKey: key },
      { type: 'panel/describe', tabId: 7, frameId: 0, fieldKey: key },
      { type: 'panel/reports', tabId: 7 },
      { type: 'settings/get' },
      { type: 'settings/save', settings: DEFAULT_SETTINGS },
      { type: 'auth/status' },
      { type: 'auth/startPairing' },
      { type: 'auth/redeemCode', code: 'K7QM-2XRD-9VHT-PA3C' },
      { type: 'runs/clear' },
      { type: 'auth/disconnect' },
    ];
    for (const message of messages) {
      const type = message.type as keyof typeof PAGE_ANSWER_SCHEMAS;
      const answer = await worker.deliver({ v: 1, ...message }, pageSender());
      expect(answer, type).toMatchObject({ ok: true });
      expect(answerSchema(PAGE_ANSWER_SCHEMAS[type]).safeParse(answer).success, type).toBe(true);
    }
  });

  it('for TailorIT\'s connect page', async () => {
    const worker = await startTestWorker();
    await worker.deliver({ v: 1, type: 'auth/startPairing' }, pageSender('options.html'));
    const [opened] = (await fakeBrowser.tabs.query({})).filter((tab) => tab.url?.startsWith(ORIGIN));
    const state = new URL(opened!.url!).searchParams.get('state');
    const answer = await worker.deliverExternal({ v: 1, type: 'pair/complete', state, code: 'K7QM-2XRD-9VHT-PA3C' }, connectPageSender());
    expect(answer).toMatchObject({ ok: true });
    expect(answerSchema(EXTERNAL_ANSWER_SCHEMAS['pair/complete']).safeParse(answer).success).toBe(true);
  });
});
