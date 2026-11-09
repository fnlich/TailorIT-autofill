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
import { AI_TASK_CAP_MS, answerBatches, createAiTasks, createRunAi, type AiTaskIds } from './ai-tasks';
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

// ── The P2 review ─────────────────────────────────────────────────────────────────────────────────────────────────
const DRAFT_TASK_ID = '8c1d7e2f-4a3b-4c5d-9e6f-0a1b2c3d4e5f';
const TEXTAREA: AnswerItem = { key: `lever|main|about|none|0` as FieldKey, scope: 'standard', shape: 'text',
  kind: 'textarea', question: u('Tell us about a project you led.'), hint: u(''), section: u(''), optionSetHash: null,
  options: [], maxLength: null, format: null, classify: true, platform: 'lever' };
const DRAFT_LLM = { ...DEFAULT_SETTINGS.llm, answers: true, drafts: true };
const ONE_ROUND = { tiebreaks: [], classify: [], answers: [TEXTAREA] };
const AS_DRAFT = { tiebreaks: [], classify: [], drafts: [{ key: TEXTAREA.key, question: TEXTAREA.question, maxLength: null }] };
const freeText: AutofillAnswer = { key: TEXTAREA.key, optionSetHash: null, index: null, text: 'I led one.', basis: 'resume',
  reason: 'answered', classification: { category: 'free_text_question', reason: 'classified' } };
const DRAFT = { key: TEXTAREA.key, text: 'I led the move of our billing to a new platform.', reason: 'drafted' as const };

/** A stream per task the test drives: `send` lands an item, `finish` sends the task; the caller's abort ends it. */
function streamsByTask() {
  const open = new Map<string, { options: AiStreamOptions; close: (value: ServerResult<AutofillTaskView | null>) => void }>();
  const waiters = new Map<string, () => void>();
  return {
    open(id: string, options: AiStreamOptions): Promise<ServerResult<AutofillTaskView | null>> {
      return new Promise((close) => {
        open.set(id, { options, close });
        options.signal.addEventListener('abort', () => close({ ok: true, value: null }), { once: true });
        waiters.get(id)?.();
      });
    },
    opened: (id: string) => (open.has(id) ? Promise.resolve()
      : new Promise<void>((resolve) => void waiters.set(id, resolve))),
    send: (id: string, item: Parameters<AiStreamOptions['onEvent']>[0]) => open.get(id)!.options.onEvent(item),
    finish(id: string, kind: 'autofill_answer' | 'autofill_draft', result: unknown,
      status: 'succeeded' | 'failed' = 'succeeded') {
      open.get(id)!.close({ ok: true, value: taskView(kind, status, result, id) as AutofillTaskView });
    },
  };
}

/** An AI server whose answer task is TASK_ID and whose draft task is DRAFT_TASK_ID (or the draft's refusal). */
function twoTaskServer(streams: ReturnType<typeof streamsByTask>, draft: ServerResult<unknown> | 'task' = 'task') {
  const refused = { ok: false as const, failure: 'not-found' as const, status: 404 };
  const server: Pick<ServerClient, 'aiPick' | 'aiClassify' | 'aiDraft' | 'aiAnswer' | 'aiTask' | 'aiTaskStream'> = {
    aiPick: async () => refused,
    aiClassify: async () => refused,
    aiAnswer: async () => ({ ok: true, value: { done: false, taskId: TASK_ID } }),
    aiDraft: async () => (draft === 'task' ? { ok: true, value: { done: false, taskId: DRAFT_TASK_ID } } : draft) as never,
    aiTask: async () => refused,
    aiTaskStream: (id, options) => streams.open(id, options),
  };
  return server;
}

describe('the P2 review: a key asked again in another batch (H1)', () => {
  /** B1 streams the textarea's answer, classified free_text_question; the frame then asks it as a draft (B2). */
  async function askedTwice(draft: ServerResult<unknown> | 'task' = 'task') {
    const streams = streamsByTask();
    const time = clockedTimers();
    const ready: string[][] = [];
    const run = createRunAi(createAiTasks({ server: twoTaskServer(streams, draft), timers: time.timers, now: time.now }),
      memoryIds(), vocab, (keys) => ready.push([...keys]));
    const context = { specs: [], canaries: [], draft: CONTEXT };
    run.ask(ONE_ROUND, [TEXTAREA.key], context, DRAFT_LLM, 1);
    await streams.opened(TASK_ID);
    streams.send(TASK_ID, { type: 'answer', answer: freeText });
    expect(run.state(TEXTAREA.key)).toBe('done');
    expect(run.answers.classifications.get(TEXTAREA.key)).toMatchObject({ category: 'free_text_question', why: 'ok' });
    run.settle([TEXTAREA.key]);
    run.ask(AS_DRAFT, [TEXTAREA.key], context, DRAFT_LLM, 1);
    expect(run.state(TEXTAREA.key)).toBe('waiting');
    return { streams, time, ready, run };
  }

  it('takes B2’s streamed draft, wakes the frame and ends; B1’s end does not end B2’s wait', async () => {
    const { streams, ready, run } = await askedTwice();
    streams.finish(TASK_ID, 'autofill_answer', { answers: [freeText] });
    await flush();
    expect(run.state(TEXTAREA.key)).toBe('waiting');
    await streams.opened(DRAFT_TASK_ID);
    streams.send(DRAFT_TASK_ID, { type: 'draft', draft: DRAFT });
    expect(run.state(TEXTAREA.key)).toBe('done');
    expect(run.answers.drafts!.get(TEXTAREA.key)).toMatchObject({ text: DRAFT.text, taskId: DRAFT_TASK_ID });
    expect(ready).toEqual([[TEXTAREA.key], [TEXTAREA.key]]);
    streams.finish(DRAFT_TASK_ID, 'autofill_draft', { drafts: [DRAFT] });
    await run.idle();
    expect(run.state(TEXTAREA.key)).toBe('done');
  });

  it.each([
    ['TailorIT’s AI unavailable', { ok: false, failure: 'server-error', status: 503, code: 'ai_unavailable' }, 'llm-unavailable'],
    ['the usage limit (429)', { ok: false, failure: 'rate-limited', status: 429, code: 'rate_limited' }, 'llm-unavailable'],
    ['an answer off the contract', { ok: false, failure: 'bad-answer', status: 200 }, 'llm-invalid-output'],
  ] as const)('records B2’s failure (%s) as the key’s verdict, and the run ends', async (_name, refusal, why) => {
    const { streams, ready, run } = await askedTwice(refusal as ServerResult<unknown>);
    streams.finish(TASK_ID, 'autofill_answer', { answers: [freeText] });
    await run.idle();
    expect(run.answers.drafts!.get(TEXTAREA.key)).toEqual({ key: TEXTAREA.key, text: null, why });
    expect(run.state(TEXTAREA.key)).toBe('done');
    // B1's stream woke the frame once; B2's end wakes it again for its failure (B1's own end names nothing).
    expect(ready).toEqual([[TEXTAREA.key], [TEXTAREA.key]]);
  });

  it('records B2’s failed task, and its cap, as the key’s verdict', async () => {
    const failed = await askedTwice();
    await failed.streams.opened(DRAFT_TASK_ID);
    failed.streams.finish(DRAFT_TASK_ID, 'autofill_draft', null, 'failed');
    failed.streams.finish(TASK_ID, 'autofill_answer', { answers: [freeText] });
    await failed.run.idle();
    expect(failed.run.answers.drafts!.get(TEXTAREA.key)).toEqual({ key: TEXTAREA.key, text: null, why: 'llm-unavailable' });
    const capped = await askedTwice();
    capped.streams.finish(TASK_ID, 'autofill_answer', { answers: [freeText] });
    await capped.streams.opened(DRAFT_TASK_ID);
    await capped.time.advance(AI_TASK_CAP_MS + 1000);
    await capped.run.idle();
    expect(capped.run.answers.drafts!.get(TEXTAREA.key)).toEqual({ key: TEXTAREA.key, text: null, why: 'llm-unavailable' });
    expect(capped.run.state(TEXTAREA.key)).toBe('done');
  });
});

describe('the P2 review: a stream refused past its cap (security 6a)', () => {
  it('polls the task when TailorIT answers its stream 429, and streams the next batch again', async () => {
    const { server, calls, asked } = streamingServer({
      stream: () => Promise.resolve({ ok: false, failure: 'rate-limited', status: 429, code: 'rate_limited' }),
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
    // A 429 is no TailorIT without the stream: the second batch asks with respond-async and reads its stream again.
    expect(calls).toEqual(['answer', `stream ${TASK_ID}`, `task ${TASK_ID}`, 'answer', `stream ${TASK_ID}`,
      `task ${TASK_ID}`]);
    expect(asked).toEqual([{ async: true }, { async: true }]);
  });
});

describe('the P2 review: what streamed, its reply then voided (security 5)', () => {
  const voided = (item: AnswerItem): AutofillAnswer => ({ ...answered(item), streamedThenVoided: true });

  it('keeps the streamed answer and names its key for review once; one it never took is not trusted', async () => {
    const stream = drivenStream();
    const { server } = streamingServer({ stream: (options) => stream.open(options) });
    const time = clockedTimers();
    const ready: string[][] = [];
    const run = createRunAi(createAiTasks({ server, timers: time.timers, now: time.now }), memoryIds(), vocab,
      (keys) => ready.push([...keys]));
    run.ask(ASK, ITEMS.map((item) => item.key), { specs: [], canaries: [], draft: CONTEXT }, SETTINGS_LLM, 1);
    await stream.opened;
    stream.send(answered(ITEMS[0]!));
    expect(run.takeReviews()).toEqual([]);
    // TailorIT voided the reply after it streamed the first answer and (on a stream this run lost) the second.
    stream.finish({ answers: [voided(ITEMS[0]!), voided(ITEMS[1]!), answered(ITEMS[2]!)] });
    await run.idle();
    expect(run.answers.answers!.get(ITEMS[0]!.key)).toMatchObject({ kind: 'choice', index: 1 });
    expect(run.answers.answers!.get(ITEMS[1]!.key)).toEqual({ key: ITEMS[1]!.key, kind: 'none', why: 'llm-invalid-output' });
    expect(run.answers.answers!.get(ITEMS[2]!.key)).toMatchObject({ kind: 'choice', index: 1 });
    expect(run.takeReviews()).toEqual([ITEMS[0]!.key]);
    expect(run.takeReviews()).toEqual([]);
    expect(ready).toEqual([[ITEMS[0]!.key], [ITEMS[1]!.key, ITEMS[2]!.key]]);
  });

  it('tells the frame at the batch’s end even when every key streamed, so the review reaches it', async () => {
    const stream = drivenStream();
    const { server } = streamingServer({ stream: (options) => stream.open(options) });
    const time = clockedTimers();
    const ready: string[][] = [];
    const run = createRunAi(createAiTasks({ server, timers: time.timers, now: time.now }), memoryIds(), vocab,
      (keys) => ready.push([...keys]));
    run.ask(ASK, ITEMS.map((item) => item.key), { specs: [], canaries: [], draft: CONTEXT }, SETTINGS_LLM, 1);
    await stream.opened;
    for (const item of ITEMS) stream.send(answered(item));
    stream.finish({ answers: ITEMS.map(voided) });
    await run.idle();
    expect(ready).toHaveLength(4);
    expect(run.takeReviews()).toEqual(ITEMS.map((item) => item.key));
  });
});
