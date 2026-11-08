/*
 * Receivers parse answers too (messaging/envelope.ts), so every answer the worker gives must parse with the schema its
 * receiver will use: CONTENT_ANSWER_SCHEMAS for a frame, PAGE_ANSWER_SCHEMAS for an extension page,
 * EXTERNAL_ANSWER_SCHEMAS for TailorIT's page. Each message type is sent once, and its answer parsed.
 */
import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { answerSchema } from '../messaging/envelope';
import { CONTENT_ANSWER_SCHEMAS, ContentMessageSchema } from '../messaging/schemas';
import { EXTERNAL_ANSWER_SCHEMAS, PAGE_ANSWER_SCHEMAS, PageMessageSchema } from '../messaging/page-schemas';
import {
  askingCore,
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
    // A core that asks the LLM, so a field waits and plan/poll has something to answer.
    const worker = await startTestWorker({ token: tokenRecord(), core: askingCore() });
    /** Each message, built when it is sent (a message that names a run gets a run of its own). */
    const messages: Array<() => Promise<Record<string, unknown>>> = [
      async () => ({ type: 'ping' }),
      async () => ({ type: 'frame/hello', isTop: true, hasForm: true }),
      async () => ({ type: 'run/begin', applicationKey: LEVER_KEY, trigger: 'launcher', dryRun: true }),
      async () => ({ type: 'plan/request', runId: await beginRun(worker), pass: 0, specs: [fieldSpec(1)], planKeys: [fieldSpec(1).key], canaries: [],
        notices: [] }),
      async () => {
        const runId = await beginRun(worker);
        await worker.deliver({ v: 1, type: 'plan/request', runId, pass: 0, specs: [fieldSpec(1)], planKeys: [fieldSpec(1).key],
          canaries: [], notices: [] }, contentSender());
        return { type: 'plan/poll', runId, keys: [fieldSpec(1).key] };
      },
      async () => ({ type: 'runstate/put', runState: runState() }),
      async () => ({ type: 'runstate/get', applicationKey: LEVER_KEY }),
      async () => ({ type: 'runstate/clear', applicationKey: LEVER_KEY }),
      async () => {
        const runId = await beginRun(worker);
        return { type: 'report/put', runId, report: frameReport(runId) };
      },
      async () => ({ type: 'policy/hit', applicationKey: LEVER_KEY, patternId: null }),
      async () => ({ type: 'panel/open' }),
      // s2 lists: a host's learned list kept, then its lists answered.
      async () => ({ type: 'lists/learn', key: '0123456789abcdef', labels: ['Select One', 'Mr.', 'Ms.'] }),
      async () => ({ type: 'lists/known', stored: ['greenhouse.phone-countries', 'workday.countries'] }),
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
    // The frame's run waits at the policy card, so the card's decision has somewhere to go; its report holds a draft
    // that waits and a row the person fixed (Phase 6), for Confirm draft and Save my answer.
    const key = fieldSpec(1).key;
    const base = frameReport(runId, 0).fields[0]!;
    const draft = { ...base, key: 'lever|main|why|none|0', kind: 'textarea' as const, category: 'freeText.whyCompany' as const,
      status: 'flagged' as const, provenance: 'llm-draft' as const, reason: 'llm-draft-needs-confirmation' as const,
      needsUserAction: true };
    const fixed = { ...base, key: 'lever|main|office|none|0', label: 'Which office?', status: 'flagged' as const,
      reason: 'unknown-field' as const, needsUserAction: true, detail: { userEdited: true as const } };
    await worker.deliver({ v: 1, type: 'report/put', runId, report: frameReport(runId, 0, { status: 'policy-notice',
      fields: [base, draft, fixed] }) }, contentSender());
    worker.fakes.frameAnswers = ({ message }) => {
      const type = (message as { type: string }).type;
      if (type === 'field/describe') return { ok: true, data: { options: [{ index: 0, label: 'Yes' }] } };
      if (type === 'answer/read') return { ok: true, data: { optionSetHash: 'none', answer: { kind: 'text', text: 'Lisbon' } } };
      return { ok: true, data: {} };
    };
    const messages: Array<Record<string, unknown>> = [
      { type: 'ping' },
      { type: 'panel/fill', tabId: 7, dryRun: true },
      { type: 'panel/continue', tabId: 7 },
      { type: 'panel/cancel', tabId: 7 },
      { type: 'panel/policyDecision', tabId: 7, frameId: 0, decision: 'fill' },
      { type: 'panel/focus', tabId: 7, frameId: 0, fieldKey: key },
      { type: 'panel/describe', tabId: 7, frameId: 0, fieldKey: key },
      { type: 'panel/confirmDraft', tabId: 7, frameId: 0, fieldKey: draft.key },
      { type: 'panel/saveAnswer', tabId: 7, frameId: 0, fieldKey: fixed.key },
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
