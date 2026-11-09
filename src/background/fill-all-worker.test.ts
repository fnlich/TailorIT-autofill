/*
 * The worker's half of the owner's amendments (docs/SPEC-AMENDMENTS.md), end to end in Node: an answer the core asks
 * for goes to TailorIT's answer route with the job context and comes back as its write; a profile-only request asks
 * the LLM nothing; Edit with AI's draft/rewrite plans its one field as a rewrite and sends what the box holds now;
 * every plan reads the lookup's company and location. The core is scripted here (answeringCore); the real planner's
 * half is src/core/plan/answers.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AnswerItem } from '../core/plan/answers';
import type { DraftItem } from '../core/plan/drafts';
import { vocab } from '../core/plan/plan.testkit';
import type { PlanOutput } from '../core/plan/types';
import type { FieldKey, FieldSpec } from '../core/types/field';
import type { UntrustedText } from '../core/types/text';
import type { CoreFunctions } from './core';
import { DEFAULT_SETTINGS } from '../core/types/settings';
import {
  ANSWER_TEXT, beginRun, contentSender, DRAFT_TEXT, fieldSpec, goldens, itemsOf, pageSender, questionsOf, skippedRow,
  startTestWorker, TASK_ID, taskView, tokenRecord, type TestWorker,
} from './worker.testkit';

const ANSWER = 'POST /api/autofill/ai/answer';
const DRAFT = 'POST /api/autofill/ai/draft';

/** An unknown question in a text box, and a free-text box that holds the person's text. */
const YEARS = fieldSpec(1, { label: 'How many years have you written Go?', key: 'lever|main|years|none|0' as FieldKey });
const WHY = fieldSpec(2, { kind: 'textarea', label: 'Why do you want to work here?', key: 'lever|main|why|none|0' as FieldKey,
  current: { kind: 'text', text: 'I like your product.' } });

/**
 * planFrame scripted for answers: a text field with no answer yet waits for one, and gets its llm-answer write once the
 * run has one; with PlanInput.rewrite, the one textarea waits for its draft (with what it holds now) and gets it.
 * Everything else is skipped.
 */
function answeringCore(): Pick<CoreFunctions, 'planFrame' | 'vocab'> {
  return {
    // The bundled vocabulary: the worker screens a rewrite's current text with it (draftBatches).
    vocab: () => vocab,
    planFrame(input) {
      const wanted = input.planKeys === undefined ? null : new Set<string>(input.planKeys);
      const specs = input.specs.filter((spec) => wanted === null || wanted.has(spec.key));
      const output: PlanOutput = { writes: [], results: [], awaiting: [], needsSensitive: false, persistableCanaries: [] };
      const answers: AnswerItem[] = [];
      const drafts: DraftItem[] = [];
      const match = { stage: 'not-applicable' as const, optionIndex: null, rule: null, confidence: 1, flags: [],
        suggestions: [], reason: 'ok' as const };
      for (const spec of specs) {
        const row = skippedRow(spec);
        if (input.rewrite === spec.key) {
          const verdict = input.ai?.drafts?.get(spec.key);
          if (verdict === undefined) {
            drafts.push({ key: spec.key, question: spec.label as UntrustedText, maxLength: null,
              current: (spec.current.kind === 'text' ? spec.current.text : '') as UntrustedText });
            output.awaiting.push(spec.key);
          } else if (verdict.text !== null) {
            output.writes.push({ key: spec.key, value: { kind: 'text', text: verdict.text },
              origin: { provenance: 'llm-draft', taskId: verdict.taskId, confirmedByUser: false }, match });
          }
          output.results.push(row);
          continue;
        }
        if (spec.kind !== 'text') {
          output.results.push(row);
          continue;
        }
        const verdict = input.ai?.answers?.get(spec.key);
        if (verdict === undefined) {
          answers.push({ key: spec.key, scope: 'standard', shape: 'text', kind: 'text',
            question: spec.label as UntrustedText, hint: '' as UntrustedText, section: '' as UntrustedText, optionSetHash: null, options: [], maxLength: null,
            format: null });
          output.awaiting.push(spec.key);
        } else if (verdict.kind === 'text') {
          output.writes.push({ key: spec.key, value: { kind: 'text', text: verdict.text },
            origin: { provenance: 'llm-answer', taskId: verdict.taskId, basis: verdict.basis }, match });
          output.results.push({ ...row, status: 'verified', provenance: 'llm-answer',
            reason: verdict.basis === 'guess' ? 'ai-guess' : 'llm-answer-written' });
          continue;
        }
        output.results.push(row);
      }
      if (answers.length > 0 || drafts.length > 0) {
        output.ask = { tiebreaks: [], classify: [], ...(answers.length > 0 ? { answers } : {}),
          ...(drafts.length > 0 ? { drafts } : {}) };
      }
      return output;
    },
  };
}

async function request(worker: TestWorker, runId: string, specs: FieldSpec[], extra: Record<string, unknown> = {}) {
  return (await worker.deliver({ v: 1, type: 'plan/request', runId, pass: 0, specs, planKeys: specs.map((spec) => spec.key),
    canaries: ['I am LLM'], notices: [], ...extra }, contentSender())) as { ok: boolean; data?: Record<string, unknown> };
}

async function poll(worker: TestWorker, runId: string, keys: string[]) {
  return (await worker.deliver({ v: 1, type: 'plan/poll', runId, keys }, contentSender())) as
    { ok: boolean; data?: { writes: Array<{ key: string; value: unknown; origin: unknown }>; awaiting: string[] } };
}

describe('AI answers in the worker', () => {
  it('tells the frame which streamed answer’s reply TailorIT then voided, for review (the P2 review, security 5)', async () => {
    const worker = await startTestWorker({ token: tokenRecord(), core: answeringCore() });
    const told = vi.spyOn(worker.platform.tabs, 'sendToFrame');
    const answer = { key: YEARS.key, optionSetHash: null, index: null, text: ANSWER_TEXT, basis: 'resume', reason: 'answered' };
    const task = taskView('autofill_answer', 'succeeded', { answers: [{ ...answer, streamedThenVoided: true }] });
    const events = [{ type: 'answer', answer }, { type: 'task', task }];
    worker.tailorit.reply(ANSWER, { status: 202, json: { taskId: TASK_ID } });
    worker.tailorit.reply(`GET /api/ai/tasks/${TASK_ID}/stream`, { bytes: new TextEncoder().encode(events
      .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')),
    headers: { 'Content-Type': 'text/event-stream' } });
    const runId = await beginRun(worker);
    await request(worker, runId, [YEARS]);
    const ready = () => told.mock.calls.map(([, message]) => message as { type?: string; reviews?: string[] })
      .filter((message) => message.type === 'plan/ready');
    await vi.waitFor(() => expect(ready().some((message) => message.reviews !== undefined)).toBe(true));
    expect(ready().filter((message) => message.reviews !== undefined)).toEqual([{ v: 1, type: 'plan/ready', runId,
      reviews: [YEARS.key] }]);
    // The answer stands as written: the poll brings its write.
    expect((await poll(worker, runId, [YEARS.key])).data?.writes).toEqual([expect.objectContaining({ key: YEARS.key,
      value: { kind: 'text', text: ANSWER_TEXT } })]);
  });

  it('asks TailorIT’s answer route with the job context and the canaries, and the poll brings the write', async () => {
    const worker = await startTestWorker({ token: tokenRecord(), core: answeringCore() });
    const runId = await beginRun(worker);
    const first = await request(worker, runId, [YEARS], { postingText: 'A posting. VISIBLE-MARKER-01' });
    expect(first).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(worker.tailorit.count(ANSWER)).toBe(1));
    const sent = worker.tailorit.requests.find((call) => `${call.method} ${call.path}` === ANSWER)!;
    expect(JSON.parse(sent.body!)).toMatchObject({ jobText: 'A posting. VISIBLE-MARKER-01',
      company: goldens.lookup.job.companyName, jobTitle: goldens.lookup.job.title, canaries: ['I am LLM'] });
    expect(itemsOf(sent)).toEqual([{ key: YEARS.key, shape: 'text', kind: 'text', question: YEARS.label, hint: '',
      section: '', optionSetHash: null, options: [], maxLength: null }]);
    await vi.waitFor(async () => expect((await poll(worker, runId, [YEARS.key])).data?.writes).toEqual([{ key: YEARS.key,
      value: { kind: 'text', text: ANSWER_TEXT }, origin: { provenance: 'llm-answer', taskId: expect.any(String),
        basis: 'guess' }, match: expect.anything() }]));
  });

  it('hands every plan the lookup’s company and location', async () => {
    const worker = await startTestWorker({ token: tokenRecord(), core: answeringCore() });
    const runId = await beginRun(worker);
    await request(worker, runId, [fieldSpec(5)]);
    expect(worker.core.calls.planFrame.at(-1)!.posting).toEqual({ company: goldens.lookup.job.companyName,
      location: goldens.lookup.job.location });
  });

  it('asks the LLM nothing for a request whose run fills from the profile only', async () => {
    const worker = await startTestWorker({ token: tokenRecord(), core: answeringCore() });
    const runId = await beginRun(worker);
    const answer = await request(worker, runId, [YEARS], { noAi: true });
    expect(worker.core.calls.planFrame.at(-1)!.noAi).toBe(true);
    // The scripted core asks anyway: the worker submits nothing, and the field is answered at once.
    expect(answer).toMatchObject({ ok: true, data: { awaiting: [] } });
    expect(worker.tailorit.requests.filter((call) => call.path.startsWith('/api/autofill/ai/'))).toEqual([]);
  });
});

describe('Edit with AI in the worker (draft/rewrite)', () => {
  it('plans the one field as a rewrite, sends what it holds now, and the poll brings the draft', async () => {
    const worker = await startTestWorker({ token: tokenRecord(), core: answeringCore() });
    const runId = await beginRun(worker);
    const asked = await worker.deliver({ v: 1, type: 'draft/rewrite', runId, fieldKey: WHY.key, specs: [YEARS, WHY],
      canaries: ['I am LLM'] }, contentSender()) as { ok: boolean; data?: { awaiting: string[] } };
    expect(asked).toMatchObject({ ok: true, data: { awaiting: [WHY.key] } });
    const input = worker.core.calls.planFrame.at(-1)!;
    expect([input.rewrite, input.planKeys]).toEqual([WHY.key, [WHY.key]]);
    await vi.waitFor(() => expect(worker.tailorit.count(DRAFT)).toBe(1));
    const sent = worker.tailorit.requests.find((call) => `${call.method} ${call.path}` === DRAFT)!;
    expect(questionsOf(sent)).toEqual([{ key: WHY.key, question: WHY.label, maxLength: null,
      currentAnswer: 'I like your product.' }]);
    await vi.waitFor(async () => expect((await poll(worker, runId, [WHY.key])).data?.writes).toMatchObject([{ key: WHY.key,
      value: { kind: 'text', text: DRAFT_TEXT }, origin: { provenance: 'llm-draft' } }]));
  });

  it('refuses a rewrite naming no field of its scan, and one in a dry run', async () => {
    const worker = await startTestWorker({ token: tokenRecord(), core: answeringCore() });
    const runId = await beginRun(worker);
    expect(await worker.deliver({ v: 1, type: 'draft/rewrite', runId, fieldKey: 'lever|main|gone|none|0', specs: [WHY],
      canaries: [] }, contentSender())).toEqual({ ok: false, error: 'bad_message' });
    const dry = await beginRun(worker, { dryRun: true });
    expect(await worker.deliver({ v: 1, type: 'draft/rewrite', runId: dry, fieldKey: WHY.key, specs: [WHY],
      canaries: [] }, contentSender())).toEqual({ ok: false, error: 'bad_message' });
    expect(worker.tailorit.count(DRAFT)).toBe(0);
  });

  it('refuses a rewrite while AI-written answers are off (MINOR 8)', async () => {
    const worker = await startTestWorker({ token: tokenRecord(), core: answeringCore() });
    await worker.deliver({ v: 1, type: 'settings/save', settings: { ...DEFAULT_SETTINGS,
      llm: { ...DEFAULT_SETTINGS.llm, drafts: false } } }, pageSender('options.html'));
    const runId = await beginRun(worker);
    expect(await worker.deliver({ v: 1, type: 'draft/rewrite', runId, fieldKey: WHY.key, specs: [WHY],
      canaries: [] }, contentSender())).toEqual({ ok: false, error: 'bad_message' });
    expect(worker.tailorit.count(DRAFT)).toBe(0);
  });
});

describe('a run that turns profile-only (security MINOR 4)', () => {
  it('asks nothing more once a request says noAi: the keys asked before are planned again with noAi, and no rewrite', async () => {
    const worker = await startTestWorker({ token: tokenRecord(), core: answeringCore() });
    const runId = await beginRun(worker);
    await request(worker, runId, [YEARS]);
    await vi.waitFor(() => expect(worker.tailorit.count(ANSWER)).toBe(1));
    // A later pass found the posting forbids AI: its request says so.
    const later = fieldSpec(5);
    await request(worker, runId, [later], { noAi: true });
    // The answer asked before is planned again from the profile only.
    await vi.waitFor(async () => {
      await poll(worker, runId, [YEARS.key]);
      const last = worker.core.calls.planFrame.at(-1)!;
      expect([last.planKeys, last.noAi]).toEqual([[YEARS.key], true]);
    });
    // A request that no longer says noAi is planned profile-only all the same, and asks nothing.
    const after = fieldSpec(6, { label: 'Which office would you visit first?', key: 'lever|main|office|none|0' as FieldKey });
    expect(await request(worker, runId, [after])).toMatchObject({ ok: true, data: { awaiting: [] } });
    expect(worker.core.calls.planFrame.at(-1)!.noAi).toBe(true);
    expect(worker.tailorit.count(ANSWER)).toBe(1);
    expect(await worker.deliver({ v: 1, type: 'draft/rewrite', runId, fieldKey: WHY.key, specs: [WHY],
      canaries: [] }, contentSender())).toEqual({ ok: false, error: 'bad_message' });
    expect(worker.tailorit.count(DRAFT)).toBe(0);
  });
});
