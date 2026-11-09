/*
 * v5 p2-stream (Jobright parity, Phase 2): the worker reads an AI task's stream (ai-tasks.ts): each answer or draft is
 * that key's verdict as it lands, the run hears it (onReady), and the stream's finished task ends the batch; polling
 * is the fallback (a stream that ends without its task, a TailorIT without the stream), and what streamed stands when
 * its task then fails. The server client's half (aiTaskStream, Prefer: respond-async) is in server-client.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { AUTOFILL_AI_POLL_MS, type AutofillAnswer, type AutofillTaskView } from '../contract/tailorit';
import type { AnswerItem } from '../core/plan/answers';
import { vocab } from '../core/plan/plan.testkit';
import { sha256Hex } from '../core/text/sha256';
import type { FieldKey } from '../core/types/field';
import type { UntrustedText } from '../core/types/text';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import { answerBatches, createAiTasks, createRunAi, type AiTaskIds } from './ai-tasks';
import type { AiStreamOptions, AiSubmitOptions, ServerClient, ServerResult } from './server-client';
import { manualTimers } from './timers';
import { taskView, TASK_ID } from './worker.testkit';

const u = (text: string) => text as UntrustedText;
const HASH = '0e7f3a9c5b1d2468';
const CONTEXT = { jobText: 'We build tools.', company: 'Northwind', jobTitle: 'Engineer', resumeId: null };

const choice = (at: number): AnswerItem => ({
  key: `lever|main|q${at}|${HASH}|0` as FieldKey, scope: 'standard', shape: 'choice', kind: 'radio',
  question: u(`Question ${at}?`), hint: u(''), section: u(''), optionSetHash: HASH,
  options: ['Yes', 'No'].map((label, index) => ({ index: index + 1, label: u(label), labelHash: sha256Hex(label) })),
  maxLength: null, format: null });
const ITEMS = [choice(1), choice(2), choice(3)];
const BATCH = answerBatches(ITEMS, CONTEXT, [], vocab).batches[0]!;
const answered = (item: AnswerItem): AutofillAnswer => ({ key: item.key, optionSetHash: HASH, index: 1, text: null,
  basis: 'resume', reason: 'answered' });
const RESULT = { answers: ITEMS.map(answered) };

type StreamScript = (options: AiStreamOptions) => Promise<ServerResult<AutofillTaskView | null>>;

/** An AI server with a stream: `stream` plays the task's stream; the rest as scripted. */
function streamingServer(script: { stream?: StreamScript; task?: Array<ServerResult<unknown>>; withStream?: boolean }) {
  const calls: string[] = [];
  const asked: Array<AiSubmitOptions | undefined> = [];
  const next = <T>(list: Array<ServerResult<unknown>> | undefined, name: string): Promise<ServerResult<T>> => {
    calls.push(name);
    const answer = list && list.length > 1 ? list.shift()! : list?.[0];
    return Promise.resolve((answer ?? { ok: false, failure: 'not-found', status: 404 }) as ServerResult<T>);
  };
  const server: Pick<ServerClient, 'aiPick' | 'aiClassify' | 'aiDraft' | 'aiAnswer' | 'aiTask'>
    & Partial<Pick<ServerClient, 'aiTaskStream'>> = {
    aiPick: () => next(undefined, 'pick'),
    aiClassify: () => next(undefined, 'classify'),
    aiDraft: () => next(undefined, 'draft'),
    aiAnswer: (_body, options) => {
      asked.push(options);
      return next([{ ok: true, value: { done: false, taskId: TASK_ID } }], 'answer');
    },
    aiTask: (id) => next(script.task, `task ${id}`),
    ...(script.withStream === false ? {} : { aiTaskStream: (id: string, options: AiStreamOptions) => {
      calls.push(`stream ${id}`);
      return script.stream?.(options) ?? Promise.resolve({ ok: true as const, value: null });
    } }),
  };
  return { server, calls, asked };
}

function memoryIds(): AiTaskIds & { held: Map<string, string> } {
  const held = new Map<string, string>();
  return { held, get: async (hash) => held.get(hash) ?? null, note: async (hash, id) => void held.set(hash, id),
    forget: async (hash) => void held.delete(hash) };
}

function clockedTimers() {
  const timers = manualTimers();
  const clock = { now: 0 };
  return { timers, now: () => clock.now, async advance(ms: number) {
    for (let left = ms; left > 0; left -= 100) {
      clock.now += 100;
      timers.advance(100);
      for (let flush = 0; flush < 10; flush += 1) await Promise.resolve();
    }
  } };
}

const flush = async () => {
  for (let at = 0; at < 30; at += 1) await Promise.resolve();
};

/** A stream the test drives: each `send` lands an answer; `finish` sends the task; `end` closes it without one. */
function drivenStream() {
  let options: AiStreamOptions | null = null;
  let close: ((value: ServerResult<AutofillTaskView | null>) => void) | null = null;
  let isOpen: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    isOpen = resolve;
  });
  const open: StreamScript = (given) => {
    options = given;
    isOpen();
    return new Promise((done) => {
      close = done;
    });
  };
  const driven = {
    open,
    opened,
    send(answer: AutofillAnswer) {
      options!.onEvent({ type: 'answer', answer });
    },
    finish(result: unknown = RESULT, status: 'succeeded' | 'failed' = 'succeeded') {
      close!({ ok: true, value: taskView('autofill_answer', status, result) as AutofillTaskView });
    },
    end() {
      close!({ ok: true, value: null });
    },
    get signal() {
      return options!.signal;
    },
  };
  return driven;
}

const SETTINGS_LLM = { ...DEFAULT_SETTINGS.llm, answers: true };
const ASK = { tiebreaks: [], classify: [], answers: ITEMS };

describe('the worker reads a task’s stream (v5 p2-stream)', () => {
  it('asks with respond-async, makes each streamed answer its key’s verdict at once, tells the run, and ends with the task', async () => {
    const stream = drivenStream();
    const { server, calls, asked } = streamingServer({ stream: (options) => stream.open(options) });
    const time = clockedTimers();
    const ready: string[][] = [];
    const run = createRunAi(createAiTasks({ server, timers: time.timers, now: time.now }), memoryIds(), vocab,
      (keys) => ready.push([...keys]));
    run.ask(ASK, ITEMS.map((item) => item.key), { specs: [], canaries: [], draft: CONTEXT }, SETTINGS_LLM, 1);
    await stream.opened;
    expect(asked).toEqual([{ async: true }]);
    expect(ITEMS.map((item) => run.state(item.key))).toEqual(['waiting', 'waiting', 'waiting']);
    stream.send(answered(ITEMS[0]!));
    // The first answer is in before its task ends; the others still wait.
    expect(ITEMS.map((item) => run.state(item.key))).toEqual(['done', 'waiting', 'waiting']);
    expect(run.answers.answers!.get(ITEMS[0]!.key)).toMatchObject({ kind: 'choice', index: 1, basis: 'resume', taskId: TASK_ID });
    expect(ready).toEqual([[ITEMS[0]!.key]]);
    // An answer sent twice, or for a key the batch never asked, is not taken again.
    stream.send(answered(ITEMS[0]!));
    stream.send({ ...answered(ITEMS[0]!), key: 'lever|main|other|none|0' });
    expect(ready).toEqual([[ITEMS[0]!.key]]);
    stream.send(answered(ITEMS[1]!));
    stream.finish();
    await run.idle();
    expect(ITEMS.map((item) => run.state(item.key))).toEqual(['done', 'done', 'done']);
    // The batch's end tells the run of the key that did not stream.
    expect(ready).toEqual([[ITEMS[0]!.key], [ITEMS[1]!.key], [ITEMS[2]!.key]]);
    expect(calls).toEqual(['answer', `stream ${TASK_ID}`]);
  });

  it('polls the same task when its stream ends without it, within the same cap', async () => {
    const stream = drivenStream();
    const { server, calls } = streamingServer({ stream: (options) => stream.open(options),
      task: [{ ok: true, value: taskView('autofill_answer', 'succeeded', RESULT) }] });
    const time = clockedTimers();
    const run = createRunAi(createAiTasks({ server, timers: time.timers, now: time.now }), memoryIds(), vocab);
    run.ask(ASK, ITEMS.map((item) => item.key), { specs: [], canaries: [], draft: CONTEXT }, SETTINGS_LLM, 1);
    await stream.opened;
    stream.send(answered(ITEMS[0]!));
    stream.end();
    await flush();
    await time.advance(AUTOFILL_AI_POLL_MS + 100);
    await run.idle();
    expect(calls).toEqual(['answer', `stream ${TASK_ID}`, `task ${TASK_ID}`]);
    expect(ITEMS.map((item) => run.state(item.key))).toEqual(['done', 'done', 'done']);
  });

  it('keeps an answer that streamed when its task then fails; the rest are llm-unavailable', async () => {
    const stream = drivenStream();
    const { server } = streamingServer({ stream: (options) => stream.open(options) });
    const time = clockedTimers();
    const run = createRunAi(createAiTasks({ server, timers: time.timers, now: time.now }), memoryIds(), vocab);
    run.ask(ASK, ITEMS.map((item) => item.key), { specs: [], canaries: [], draft: CONTEXT }, SETTINGS_LLM, 1);
    await stream.opened;
    stream.send(answered(ITEMS[0]!));
    stream.finish(null, 'failed');
    await run.idle();
    expect(run.answers.answers!.get(ITEMS[0]!.key)).toMatchObject({ kind: 'choice', index: 1 });
    expect(run.answers.answers!.get(ITEMS[1]!.key)).toEqual({ key: ITEMS[1]!.key, kind: 'none', why: 'llm-unavailable' });
  });

  it('stops polling the stream for the worker’s life once TailorIT has none (its 404 while the task answers)', async () => {
    const { server, calls, asked } = streamingServer({
      stream: () => Promise.resolve({ ok: false, failure: 'not-found', status: 404 }),
      task: [{ ok: true, value: taskView('autofill_answer', 'succeeded', RESULT) }] });
    const time = clockedTimers();
    const tasks = createAiTasks({ server, timers: time.timers, now: time.now });
    const first = tasks.run(BATCH, memoryIds(), () => true);
    await flush();
    await time.advance(AUTOFILL_AI_POLL_MS + 100);
    expect(await first).toMatchObject({ ok: true, taskId: TASK_ID });
    const second = tasks.run(BATCH, memoryIds(), () => true);
    await flush();
    await time.advance(AUTOFILL_AI_POLL_MS + 100);
    await second;
    expect(calls).toEqual(['answer', `stream ${TASK_ID}`, `task ${TASK_ID}`, 'answer', `task ${TASK_ID}`]);
    // The second batch is asked as before the stream: TailorIT waits for it.
    expect(asked).toEqual([{ async: true }, undefined]);
  });

  it('ends the stream when the run goes', async () => {
    const stream = drivenStream();
    const { server } = streamingServer({ stream: (options) => stream.open(options) });
    const time = clockedTimers();
    const run = createRunAi(createAiTasks({ server, timers: time.timers, now: time.now }), memoryIds(), vocab);
    run.ask(ASK, ITEMS.map((item) => item.key), { specs: [], canaries: [], draft: CONTEXT }, SETTINGS_LLM, 1);
    await stream.opened;
    expect(stream.signal.aborted).toBe(false);
    run.stop();
    expect(stream.signal.aborted).toBe(true);
    stream.end();
    await run.idle();
  });

  it('without a stream (an older server client) asks and polls as before', async () => {
    const { server, calls, asked } = streamingServer({ withStream: false,
      task: [{ ok: true, value: taskView('autofill_answer', 'succeeded', RESULT) }] });
    const time = clockedTimers();
    const done = createAiTasks({ server, timers: time.timers, now: time.now }).run(BATCH, memoryIds(), () => true);
    await flush();
    await time.advance(AUTOFILL_AI_POLL_MS + 100);
    expect(await done).toMatchObject({ ok: true });
    expect(calls).toEqual(['answer', `task ${TASK_ID}`]);
    expect(asked).toEqual([undefined]);
  });
});
