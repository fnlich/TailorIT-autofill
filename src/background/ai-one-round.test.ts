/*
 * v5 p2-stream (one round; the coordinator's follow-up): the worker's half. An answer item the core marks `classify`
 * goes with its category asked, on its platform; the answer's classification becomes the key's classification verdict
 * and its answer verdict is marked oneRound; a TailorIT that answers without one (before v5's one round) has its answer
 * dropped and the worker classifies first from then on.
 */
import { describe, expect, it } from 'vitest';
import { AUTOFILL_AI_POLL_MS, AutofillAnswerRequestSchema, type AutofillAnswer, type AutofillTaskView } from '../contract/tailorit';
import type { AnswerItem } from '../core/plan/answers';
import { vocab } from '../core/plan/plan.testkit';
import { sha256Hex } from '../core/text/sha256';
import type { FieldKey } from '../core/types/field';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import type { UntrustedText } from '../core/types/text';
import { answerBatches, createAiTasks, createRunAi, oneRoundClassifications, type AiTaskIds } from './ai-tasks';
import type { AiStreamOptions, ServerClient, ServerResult } from './server-client';
import { manualTimers } from './timers';
import { taskView, TASK_ID } from './worker.testkit';

const u = (text: string) => text as UntrustedText;
const HASH = '0e7f3a9c5b1d2468';
const CONTEXT = { jobText: 'We build tools.', company: 'Northwind', jobTitle: 'Engineer', resumeId: null };
const choice = (at: number, extra: Partial<AnswerItem> = {}): AnswerItem => ({
  key: `greenhouse|main|q${at}|${HASH}|0` as FieldKey, scope: 'standard', shape: 'choice', kind: 'radio',
  question: u(`Question ${at}?`), hint: u(''), section: u(''), optionSetHash: HASH,
  options: ['Yes', 'No'].map((label, index) => ({ index: index + 1, label: u(label), labelHash: sha256Hex(label) })),
  maxLength: null, format: null, ...extra });
const once = (at: number, platform: AnswerItem['platform'] = 'greenhouse') => choice(at, { classify: true, platform });
const answered = (item: AnswerItem, classification?: AutofillAnswer['classification']): AutofillAnswer => ({
  key: item.key, optionSetHash: HASH, index: 1, text: null, basis: 'resume', reason: 'answered',
  ...(classification === undefined ? {} : { classification }) });

function memoryIds(): AiTaskIds {
  const held = new Map<string, string>();
  return { get: async (hash) => held.get(hash) ?? null, note: async (hash, id) => void held.set(hash, id),
    forget: async (hash) => void held.delete(hash) };
}

/** An AI server whose answer task finishes at once with `result` (200). */
function server(result: { answers: AutofillAnswer[] }, stream?: (options: AiStreamOptions) => Promise<ServerResult<AutofillTaskView | null>>) {
  const asked: unknown[] = [];
  const api: Pick<ServerClient, 'aiPick' | 'aiClassify' | 'aiDraft' | 'aiAnswer' | 'aiTask'>
    & Partial<Pick<ServerClient, 'aiTaskStream'>> = {
    aiPick: async () => ({ ok: false, failure: 'not-found' }),
    aiClassify: async () => ({ ok: false, failure: 'not-found' }),
    aiDraft: async () => ({ ok: false, failure: 'not-found' }),
    aiAnswer: async (body) => {
      asked.push(body);
      return stream === undefined
        ? { ok: true, value: { done: true, task: taskView('autofill_answer', 'succeeded', result) as never } }
        : { ok: true, value: { done: false, taskId: TASK_ID } };
    },
    aiTask: async () => ({ ok: true, value: taskView('autofill_answer', 'succeeded', result) as never }),
    ...(stream === undefined ? {} : { aiTaskStream: (_id: string, options: AiStreamOptions) => stream(options) }),
  };
  return { api, asked };
}

const LLM = { ...DEFAULT_SETTINGS.llm, answers: true };

describe('one round: the worker (v5 p2-stream)', () => {
  it('asks the category on the batch’s platform, plain items apart; one of a platform TailorIT does not name, plainly', () => {
    const { batches, classified } = answerBatches([once(1), once(2), choice(3), once(4, 'site')], CONTEXT, [], vocab);
    expect(batches.map((batch) => [batch.body.platform, batch.body.items.map((item) => [item.key, item.classify])]))
      .toEqual([
        ['greenhouse', [[once(1).key, true], [once(2).key, true]]],
        [undefined, [[choice(3).key, undefined], [once(4).key, undefined]]],
      ]);
    for (const batch of batches) expect(AutofillAnswerRequestSchema.safeParse(batch.body).success).toBe(true);
    expect(classified).toEqual([{ key: once(4).key, category: null, why: 'unknown-field' }]);
  });

  it('reads each classification as a classify task’s, and a missing one as missing', () => {
    const items = [once(1), once(2), once(3), once(4), choice(5)];
    const verdicts = oneRoundClassifications(items, { answers: [
      answered(items[0]!, { category: 'relocation', reason: 'classified' }),
      answered(items[1]!, { category: null, reason: 'unknown' }),
      answered(items[2]!, { category: null, reason: 'sensitive' }),
      answered(items[3]!),
      answered(items[4]!),
    ] });
    expect([...verdicts]).toEqual([
      [items[0]!.key, { key: items[0]!.key, category: 'relocation', why: 'ok' }],
      [items[1]!.key, { key: items[1]!.key, category: null, why: 'unknown-field' }],
      [items[2]!.key, { key: items[2]!.key, category: null, why: 'llm-disabled-for-category' }],
      [items[3]!.key, 'missing'],
    ]);
  });

  it('records the classification and the answer, marked oneRound, from one task', async () => {
    const item = once(1);
    const { api } = server({ answers: [answered(item, { category: null, reason: 'unknown' })] });
    const time = manualTimers();
    const tasks = createAiTasks({ server: api, timers: time, now: () => 0 });
    const run = createRunAi(tasks, memoryIds(), vocab);
    run.ask({ tiebreaks: [], classify: [], answers: [item] }, [item.key], { specs: [], canaries: [], draft: CONTEXT },
      LLM, 1);
    await run.idle();
    expect(run.answers.classifications.get(item.key)).toEqual({ key: item.key, category: null, why: 'unknown-field' });
    expect(run.answers.answers!.get(item.key)).toMatchObject({ kind: 'choice', index: 1, oneRound: 'standard' });
    expect(tasks.oneRoundUsable?.()).toBe(true);
  });

  it('drops an answer that came without the category it was asked, and classifies first from then on', async () => {
    const item = once(1);
    const { api } = server({ answers: [answered(item)] });
    const time = manualTimers();
    const tasks = createAiTasks({ server: api, timers: time, now: () => 0 });
    const run = createRunAi(tasks, memoryIds(), vocab);
    run.ask({ tiebreaks: [], classify: [], answers: [item] }, [item.key], { specs: [], canaries: [], draft: CONTEXT },
      LLM, 1);
    await run.idle();
    expect(run.answers.answers!.get(item.key)).toBeUndefined();
    expect(run.answers.classifications.get(item.key)).toBeUndefined();
    expect(tasks.oneRoundUsable?.()).toBe(false);
  });

  it('takes a streamed answer’s classification with it, at once', async () => {
    const item = once(1);
    let send: ((answer: AutofillAnswer) => void) | null = null;
    let finish: (() => void) | null = null;
    const { api } = server({ answers: [answered(item, { category: 'relocation', reason: 'classified' })] },
      (options) => new Promise((resolve) => {
        send = (answer) => options.onEvent({ type: 'answer', answer });
        finish = () => resolve({ ok: true, value: null });
      }));
    const timers = manualTimers();
    const ready: string[][] = [];
    const run = createRunAi(createAiTasks({ server: api, timers, now: () => 0 }), memoryIds(), vocab,
      (keys) => ready.push([...keys]));
    run.ask({ tiebreaks: [], classify: [], answers: [item] }, [item.key], { specs: [], canaries: [], draft: CONTEXT },
      LLM, 1);
    for (let at = 0; at < 30 && send === null; at += 1) await Promise.resolve();
    send!(answered(item, { category: 'relocation', reason: 'classified' }));
    expect(run.state(item.key)).toBe('done');
    expect(run.answers.classifications.get(item.key)).toEqual({ key: item.key, category: 'relocation', why: 'ok' });
    expect(ready).toEqual([[item.key]]);
    finish!();
    for (let at = 0; at < 30; at += 1) await Promise.resolve();
    timers.advance(AUTOFILL_AI_POLL_MS);
    await run.idle();
  });
});
