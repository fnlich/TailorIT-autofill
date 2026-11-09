/*
 * v1.3 B: the run-start AI batch in RunAi (ai-tasks.ts prefetch): its items asked at once under their own keys; a later
 * plan's item of the same question takes the answer while the batch is still in flight (its option's index the
 * field's own), is told when it lands, and is asked anew when the batch failed or its text cap is smaller. Undo proofs:
 * each `it` names the rule whose removal fails it.
 */
import { describe, expect, it } from 'vitest';
import type { AutofillAnswer } from '../contract/tailorit';
import type { AnswerItem } from '../core/plan/answers';
import { vocab } from '../core/plan/plan.testkit';
import { sha256Hex } from '../core/text/sha256';
import type { FieldKey } from '../core/types/field';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import type { UntrustedText } from '../core/types/text';
import { createAiTasks, createRunAi, type AiTaskIds } from './ai-tasks';
import type { ServerClient, ServerResult } from './server-client';
import { manualTimers } from './timers';
import { taskView } from './worker.testkit';

const u = (text: string) => text as UntrustedText;
const HASH = '0e7f3a9c5b1d2468';
const CONTEXT = { jobText: 'We build tools.', company: 'Northwind', jobTitle: 'Engineer', resumeId: null };
const LLM = { ...DEFAULT_SETTINGS.llm, answers: true };
const choice = (key: string, first = 0): AnswerItem => ({ key: key as FieldKey, scope: 'standard', shape: 'choice',
  kind: 'radio', question: u('Do you enjoy camping?'), hint: u(''), section: u(''), optionSetHash: HASH,
  options: ['Yes', 'No'].map((label, index) => ({ index: index + first, label: u(label), labelHash: sha256Hex(label) })),
  maxLength: null, format: null });
const text = (key: string, maxLength: number | null): AnswerItem => ({ ...choice(key), shape: 'text', kind: 'text',
  question: u('What is your favourite trail?'), optionSetHash: null, options: [], maxLength });

function memoryIds(): AiTaskIds {
  const held = new Map<string, string>();
  return { get: async (hash) => held.get(hash) ?? null, note: async (hash, id) => void held.set(hash, id),
    forget: async (hash) => void held.delete(hash) };
}

/** An answer server whose tasks finish when the test says, each with an answer for every item it was asked (the
 *  first option, or a text), or as a failure. */
function server() {
  const asked: Array<{ items: Array<{ key: string; options: Array<{ index: number }> }> }> = [];
  const pending: Array<(outcome: 'ok' | 'fail') => void> = [];
  const api: Pick<ServerClient, 'aiPick' | 'aiClassify' | 'aiDraft' | 'aiAnswer' | 'aiTask'> = {
    aiPick: async () => ({ ok: false, failure: 'not-found' }),
    aiClassify: async () => ({ ok: false, failure: 'not-found' }),
    aiDraft: async () => ({ ok: false, failure: 'not-found' }),
    aiAnswer: (body) => {
      const sent = body as unknown as (typeof asked)[number];
      asked.push(sent);
      return new Promise<ServerResult<never>>((resolve) => pending.push((outcome) => {
        if (outcome === 'fail') return resolve({ ok: false, failure: 'server-error', status: 500 });
        const answers: AutofillAnswer[] = sent.items.map((item) => ({ key: item.key, optionSetHash: item.options.length > 0
          ? HASH : null, index: item.options[0]?.index ?? null, text: item.options.length > 0 ? null : 'The ridge trail',
        basis: 'resume', reason: 'answered' }));
        resolve({ ok: true, value: { done: true, task: taskView('autofill_answer', 'succeeded', { answers }) } } as never);
      }));
    },
    aiTask: async () => ({ ok: false, failure: 'not-found' }),
  };
  return { api, asked, pending };
}

const settle = async () => {
  for (let at = 0; at < 40; at += 1) await Promise.resolve();
};

function runOf(api: ReturnType<typeof server>['api']) {
  const ready: string[][] = [];
  const run = createRunAi(createAiTasks({ server: api, timers: manualTimers(), now: () => 0 }), memoryIds(), vocab,
    (keys) => ready.push([...keys]));
  return { run, ready };
}

describe('the run-start AI batch (v1.3 B)', () => {
  // Undo proof: drop the claim in ask() and the field's item is asked as a second task.
  it('lets a field take the prefetched answer while its batch flies: no second request, its own option, told when it lands', async () => {
    const fake = server();
    const { run, ready } = runOf(fake.api);
    expect(run.prefetch!([choice('known|72')], { specs: [], canaries: [], draft: CONTEXT }, LLM)).toBe(1);
    await settle();
    expect(fake.asked.map((body) => body.items.map((item) => item.key))).toEqual([['known|72']]);
    // The field shows the same question, its options one place on (a placeholder first).
    const field = choice('greenhouse|main|camping|h|0', 1);
    run.ask({ tiebreaks: [], classify: [], answers: [field] }, [field.key], { specs: [], canaries: [], draft: CONTEXT },
      LLM, 1);
    await settle();
    expect(fake.asked).toHaveLength(1);
    expect(run.state(field.key)).toBe('waiting');
    fake.pending[0]!('ok');
    await settle();
    expect(run.state(field.key)).toBe('done');
    expect(run.answers.answers!.get(field.key)).toMatchObject({ key: field.key, kind: 'choice', index: 1,
      labelHash: sha256Hex('Yes') });
    expect(ready.flat()).toContain(field.key);
    // Once in, another field of the same question takes it at once.
    const again = choice('greenhouse|main|camping|h|1', 5);
    run.ask({ tiebreaks: [], classify: [], answers: [again] }, [again.key], { specs: [], canaries: [], draft: CONTEXT },
      LLM, 1);
    expect(run.state(again.key)).toBe('done');
    expect(run.answers.answers!.get(again.key)).toMatchObject({ index: 5 });
    expect(fake.asked).toHaveLength(1);
  });

  // Undo proof: drop usablePrefetched and the field takes the failure.
  it('asks a field anew when the batch failed', async () => {
    const fake = server();
    const { run } = runOf(fake.api);
    run.prefetch!([choice('known|72')], { specs: [], canaries: [], draft: CONTEXT }, LLM);
    await settle();
    fake.pending[0]!('fail');
    await run.idle();
    const field = choice('greenhouse|main|camping|h|0', 1);
    run.ask({ tiebreaks: [], classify: [], answers: [field] }, [field.key], { specs: [], canaries: [], draft: CONTEXT },
      LLM, 1);
    await settle();
    expect(fake.asked.map((body) => body.items.map((item) => item.key))).toEqual([['known|72'], [field.key]]);
  });

  // Undo proof: drop capFits and the shorter box waits for an answer that may not fit it.
  it('asks a text box anew whose cap is smaller than the batch\'s, and lets one with room take it', async () => {
    const fake = server();
    const { run } = runOf(fake.api);
    run.prefetch!([text('known|80', null)], { specs: [], canaries: [], draft: CONTEXT }, LLM);
    await settle();
    const narrow = text('greenhouse|main|trail|none|0', 40);
    run.ask({ tiebreaks: [], classify: [], answers: [narrow] }, [narrow.key], { specs: [], canaries: [],
      draft: CONTEXT }, LLM, 1);
    await settle();
    expect(fake.asked).toHaveLength(2);
    fake.pending[0]!('ok');
    await settle();
    // Once in, a text that fits a box is taken by it, whatever the box's cap.
    const wide = text('greenhouse|main|trail|none|1', 40);
    run.ask({ tiebreaks: [], classify: [], answers: [wide] }, [wide.key], { specs: [], canaries: [], draft: CONTEXT },
      LLM, 1);
    expect(run.answers.answers!.get(wide.key)).toMatchObject({ kind: 'text', text: 'The ridge trail' });
    expect(fake.asked).toHaveLength(2);
  });

  it('asks nothing with AI-written answers off, or without the job context', () => {
    const fake = server();
    const { run } = runOf(fake.api);
    expect(run.prefetch!([choice('known|72')], { specs: [], canaries: [], draft: CONTEXT },
      { ...LLM, answers: false })).toBe(0);
    expect(run.prefetch!([choice('known|72')], { specs: [], canaries: [] }, LLM)).toBe(0);
    expect(fake.asked).toEqual([]);
  });
});
