/*
 * v1.3 B: a job's known questions and the person's earlier answers in the worker (known-forms.ts, run-begin.ts,
 * job-cards.ts, planner.ts, ai-tasks.ts prefetch): read ahead as the page loads when the lookup says formKnown, read at
 * run/begin by the job's id, handed to every plan; the questions a frame shows that TailorIT keeps none of asked once;
 * and the run-start AI batch: one answer task for the known questions the plan leaves open, whose answers a later
 * step's fields take with no AI request of their own. Undo proofs: each `it` names the rule whose removal fails it.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AutofillFormsKnownResponse } from '../contract/tailorit';
import type { AnswerItem } from '../core/plan/answers';
import type { PlanInput } from '../core/plan/types';
import { optionSetHash } from '../core/text/keys';
import { sha256Hex } from '../core/text/sha256';
import type { FieldKey, FieldSpec } from '../core/types/field';
import type { FillResult } from '../core/types/fill';
import type { UntrustedText } from '../core/types/text';
import type { CoreFunctions } from './core';
import {
  beginRun, contentSender, fieldSpec, goldens, LEVER_URL, startTestWorker, taskView, tokenRecord, type TestWorker,
} from './worker.testkit';
import { applicationOf } from '../adapters';

const KEY = applicationOf(new URL(LEVER_URL))!.applicationKey;
const KNOWN = 'POST /api/autofill/forms/known';
const ANSWER = 'POST /api/autofill/ai/answer';
const YES_NO = optionSetHash(['Yes', 'No']);
const at = (iso: string) => `${iso}T00:00:00.000Z`;

/** TailorIT's known form of the golden job: two steps' questions, and this person's answer to the first. */
const FORM: AutofillFormsKnownResponse = {
  jobId: goldens.lookup.job.id,
  questions: [
    { id: 71, questionKey: 'do you enjoy hiking', label: 'Do you enjoy hiking?', kind: 'radio', options: ['Yes', 'No'],
      optionSetHash: YES_NO, section: 'main', required: true, step: 0, position: 1, source: 'submission',
      firstSeenAt: at('2026-11-01'), lastSeenAt: at('2026-11-02') },
    { id: 72, questionKey: 'do you enjoy camping', label: 'Do you enjoy camping?', kind: 'radio', options: ['Yes', 'No'],
      optionSetHash: YES_NO, section: 'main', required: false, step: 1, position: 0, source: 'submission',
      firstSeenAt: at('2026-11-01'), lastSeenAt: at('2026-11-02') },
  ],
  answers: [{ match: 'sameJob', questionId: 71, questionKey: 'do you enjoy hiking', optionSetHash: YES_NO,
    questionLabel: 'Do you enjoy hiking?', fieldKind: 'radio', answer: { kind: 'options', labels: ['Yes'] },
    submittedAt: at('2026-11-02') }],
};

const bodies = (worker: TestWorker, route: string) => worker.tailorit.requests
  .filter((request) => `${request.method} ${request.path}` === route)
  .map((request) => JSON.parse(request.body ?? '{}') as Record<string, unknown>);

/** A radio question as a frame scans it. */
const radio = (index: number, label: string): FieldSpec => fieldSpec(index, { label, kind: 'radio',
  key: `lever|main|${label.toLowerCase().replace(/[^a-z]+/g, '-')}|${YES_NO}|0` as FieldKey,
  options: [{ index: 0, label: 'Yes', disabled: false, selected: false }, { index: 1, label: 'No', disabled: false,
    selected: false }], optionSetHash: YES_NO as FieldSpec['optionSetHash'] });

/** A planFrame that asks TailorIT's AI every question with no submitted answer (as the core's answers.ts would), and
 *  writes an answer once the run has one. */
function answeringCore(): Pick<CoreFunctions, 'planFrame'> {
  return {
    planFrame(input: PlanInput) {
      const keys = input.planKeys ?? input.specs.map((spec) => spec.key);
      const specs = input.specs.filter((spec) => keys.includes(spec.key));
      const covered = (spec: FieldSpec) => (input.submittedAnswers ?? []).some((answer) => answer.labelKey
        === spec.label.toLowerCase().replace(/[^a-z ]/g, ''));
      const asked: AnswerItem[] = [];
      const results: FillResult[] = [];
      const writes: ReturnType<CoreFunctions['planFrame']>['writes'] = [];
      for (const spec of specs) {
        const row = { key: spec.key, label: spec.label, kind: spec.kind, category: 'unknown' as const, section: 'main',
          required: false, status: 'flagged' as const, provenance: null, matcherStage: 'none' as const, confidence: 0,
          reason: 'unknown-field' as const, wrote: false, verification: 'not-applicable' as const, needsUserAction: false };
        const answer = input.ai?.answers?.get(spec.key);
        if (covered(spec)) results.push({ ...row, status: 'verified', provenance: 'submitted-before', reason: 'submitted-before' });
        else if (answer !== undefined && answer.kind === 'choice') {
          writes.push({ key: spec.key, value: { kind: 'option', index: answer.index, cleanLabel: 'Yes' },
            origin: { provenance: 'llm-pick', taskId: answer.taskId, pickedCandidate: 0, labelHash: answer.labelHash },
            match: { stage: 'llm', optionIndex: answer.index, rule: null, confidence: 0.75, flags: [], suggestions: [],
              reason: 'ok' } });
          results.push({ ...row, status: 'verified', provenance: 'llm-pick', reason: 'llm-answer-written' });
        } else {
          results.push(row);
          asked.push({ key: spec.key, scope: 'standard', shape: 'choice', kind: 'radio',
            question: spec.label as UntrustedText, hint: '' as UntrustedText, section: '' as UntrustedText,
            optionSetHash: YES_NO, maxLength: null, format: null,
            // The usable options, a placeholder left out (as the core's prepareOptions marks it).
            options: (spec.options as Array<{ index: number; label: string }>).filter((option) => option.label
              !== 'Select...').map((option) => ({ index: option.index,
              label: option.label as UntrustedText, labelHash: sha256Hex(option.label) })) });
        }
      }
      return { writes, results, awaiting: asked.map((item) => item.key), needsSensitive: false, persistableCanaries: [],
        ...(asked.length > 0 ? { ask: { tiebreaks: [], classify: [], answers: asked } } : {}) };
    },
  };
}

async function worker(core?: Pick<CoreFunctions, 'planFrame'>): Promise<TestWorker> {
  const started = await startTestWorker({ token: tokenRecord(), ...(core === undefined ? {} : { core }) });
  started.fakes.frameAnswers = async () => ({ ok: true, data: {} });
  started.tailorit.reply(KNOWN, { json: FORM });
  return started;
}

const plan = (test: TestWorker, runId: string, specs: FieldSpec[], extra: Record<string, unknown> = {}) =>
  test.deliver({ v: 1, type: 'plan/request', runId, pass: 0, specs, planKeys: specs.map((spec) => spec.key),
    canaries: [], notices: [], postingText: 'We build tools.', ...extra }, contentSender()) as Promise<{
    ok: boolean; data?: { writes: unknown[]; awaiting: string[] } }>;

describe('a job\'s known form in the worker (v1.3 B)', () => {
  it('is read at run/begin by the job\'s id, and every plan hands the earlier answers to the core', async () => {
    const test = await worker();
    const runId = await beginRun(test, { applicationKey: KEY });
    expect(bodies(test, KNOWN)).toEqual([{ jobId: goldens.lookup.job.id }]);
    await plan(test, runId, [radio(1, 'Do you enjoy hiking?')]);
    const input = test.core.calls.planFrame.at(-1)!;
    expect(input.submittedAnswers).toEqual([expect.objectContaining({ labelKey: 'do you enjoy hiking',
      optionSetHash: YES_NO, sameJob: true, answer: { kind: 'options', labels: ['Yes'] }, questionId: 71 })]);
  });

  // Undo proof: drop submittedOf's `fields` read and the other question's earlier answer never comes.
  it('asks once for the questions a frame shows that TailorIT keeps none of, and adds their answers', async () => {
    const test = await worker();
    const runId = await beginRun(test, { applicationKey: KEY });
    test.tailorit.reply(KNOWN, { json: { ...FORM, questions: [], answers: [{ match: 'otherJob', questionId: null,
      questionKey: 'portfolio', optionSetHash: '', questionLabel: 'Portfolio', fieldKind: 'text',
      answer: { kind: 'text', text: 'https://alex.example' }, submittedAt: at('2026-10-01') }] } });
    const portfolio = fieldSpec(1, { label: 'Portfolio' });
    const hiking = radio(2, 'Do you enjoy hiking?');
    await plan(test, runId, [portfolio, hiking]);
    await plan(test, runId, [portfolio, hiking]);
    const reads = bodies(test, KNOWN);
    // The first read (the job's), then one for the field TailorIT keeps no question of; never twice.
    expect(reads).toEqual([{ jobId: goldens.lookup.job.id }, { jobId: goldens.lookup.job.id,
      fields: [{ questionKey: 'portfolio', optionSetHash: '' }] }]);
    expect(test.core.calls.planFrame.at(-1)!.submittedAnswers).toContainEqual(expect.objectContaining({
      labelKey: 'portfolio', sameJob: false }));
  });

  // Undo proof: drop readOpen's written/honeypot screen and the email and the hidden box are named to TailorIT.
  it('never names before the Submit a question the profile fills, nor a hidden or disabled one', async () => {
    const email = fieldSpec(1, { label: 'Email' });
    const hidden = fieldSpec(2, { label: 'Fax', visibility: 'hidden-file-with-visible-control' });
    const disabled = fieldSpec(3, { label: 'Nickname', disabled: true });
    const open = fieldSpec(4, { label: 'Portfolio' });
    // A lone box, and a question whose key holds one of the person's own profile values: never named.
    const box = fieldSpec(5, { label: 'Relocation', kind: 'checkbox' });
    const ownValue = fieldSpec(6, { label: 'How long have you known Elena?' });
    const writing: Pick<CoreFunctions, 'planFrame'> = {
      planFrame: (input) => ({ writes: input.specs.filter((spec) => spec.key === email.key).map((spec) => ({ key: spec.key,
        value: { kind: 'text' as const, text: 'alex@example.com' }, origin: { provenance: 'profile' as const,
          path: 'contact.email' as never }, match: { stage: 'not-applicable' as const, optionIndex: null, rule: null,
          confidence: 1, flags: [], suggestions: [], reason: 'ok' as const } })),
      results: input.specs.map((spec) => ({ key: spec.key, label: spec.label, kind: spec.kind, category: 'unknown' as const,
        section: 'main', required: false, status: spec.key === email.key ? 'verified' as const : 'skipped' as const,
        provenance: spec.key === email.key ? 'profile' as const : null, matcherStage: 'none' as const, confidence: 0,
        reason: 'ok' as const, wrote: false, verification: 'not-checked' as const, needsUserAction: false })),
      awaiting: [], needsSensitive: false, persistableCanaries: [] }),
    };
    const test = await worker(writing);
    const runId = await beginRun(test, { applicationKey: KEY });
    await plan(test, runId, [email, hidden, disabled, open, box, ownValue]);
    expect(bodies(test, KNOWN)).toEqual([{ jobId: goldens.lookup.job.id }, { jobId: goldens.lookup.job.id,
      fields: [{ questionKey: 'portfolio', optionSetHash: '' }] }]);
  });

  it('is read ahead as the page loads when the lookup says TailorIT keeps the job\'s questions', async () => {
    const test = await startTestWorker({ token: tokenRecord(), lookupOnLoad: true });
    test.tailorit.reply('POST /api/autofill/lookup', { json: { ...goldens.lookup, formKnown: true } });
    test.tailorit.reply(KNOWN, { json: FORM });
    test.fakes.frameAnswers = async (sent) => {
      const message = sent.message as { type?: string };
      if (message.type === 'frame/ping') return { ok: true, data: { pong: true } };
      if (message.type !== 'job/refresh') return { ok: true, data: {} };
      return (await test.deliver({ v: 1, type: 'job/lookup' }, contentSender())) as { ok: boolean };
    };
    await test.deliver({ v: 1, type: 'frame/hello', isTop: true, hasForm: true }, contentSender());
    await vi.waitFor(() => expect(bodies(test, KNOWN)).toEqual([{ jobId: goldens.lookup.job.id }]));
    // run/begin then takes the read held (no second read).
    await beginRun(test, { applicationKey: KEY });
    expect(bodies(test, KNOWN)).toHaveLength(1);
  });

  // Undo proof: drop prestart (or RunAi.prefetch's claim) and the camping question is asked a second time.
  it('asks the run-start batch once for the known questions left open, and a later step takes its answer with no AI request', async () => {
    const test = await worker(answeringCore());
    test.tailorit.reply(ANSWER, ({ body }) => {
      const asked = JSON.parse(body ?? '{}') as { items: Array<{ key: string; optionSetHash: string;
        options: Array<{ index: number }> }> };
      return { json: taskView('autofill_answer', 'succeeded', { answers: asked.items.map((item) => ({
        key: item.key, optionSetHash: item.optionSetHash, index: item.options[0]!.index, text: null, basis: 'guess',
        reason: 'answered' })) }) };
    });
    const runId = await beginRun(test, { applicationKey: KEY });
    // Step 1 shows the hiking question, which the earlier answer covers: the batch asks the camping one (step 2).
    const first = await plan(test, runId, [radio(1, 'Do you enjoy hiking?')]);
    expect(first.data?.awaiting).toEqual([]);
    await vi.waitFor(() => expect(bodies(test, ANSWER)).toHaveLength(1));
    const batch = bodies(test, ANSWER)[0] as { items: Array<{ key: string; question: string }> };
    expect(batch.items.map((item) => [item.key, item.question])).toEqual([['known|72', 'Do you enjoy camping?']]);
    // Step 2: its camping field takes that answer at once, with no AI request of its own.
    const camping = { ...radio(5, 'Do you enjoy camping?'), options: [{ index: 0, label: 'Select...', disabled: false,
      selected: false }, { index: 1, label: 'Yes', disabled: false, selected: false }, { index: 2, label: 'No',
      disabled: false, selected: false }] } as FieldSpec;
    const second = await plan(test, runId, [camping]);
    expect(second.data?.writes).toEqual([expect.objectContaining({ key: camping.key,
      value: { kind: 'option', index: 1, cleanLabel: 'Yes' } })]);
    expect(bodies(test, ANSWER)).toHaveLength(1);
  });

  it('asks no run-start batch in a dry run, a profile-only run, or with AI-written answers off', async () => {
    for (const extra of [{ dryRun: true }, {}] as const) {
      const test = await worker(answeringCore());
      const runId = await beginRun(test, { applicationKey: KEY, ...extra });
      await plan(test, runId, [radio(1, 'Do you enjoy hiking?')], 'dryRun' in extra ? {} : { noAi: true });
      expect(bodies(test, ANSWER)).toEqual([]);
    }
  });
});
