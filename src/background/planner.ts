/*
 * plan/request and plan/poll: the worker runs the core's planFrame over one pass of a frame's fields with the
 * canonical profile it holds, and answers that frame's planned writes and value-free rows. The request carries the
 * frame's whole scan as context and the keys this pass plans (planKeys, each a spec's key: the schema checks it); the
 * worker plans and answers those only (the Phase 3 review, LC-2). So a frame receives values for its own fields only,
 * never the profile. When the plan needs the sensitive part and it is not in memory, the worker fetches it once per
 * run and plans again; a 403 makes it 'not-shared' and any other failure 'unavailable', and the core leaves those
 * fields blank and flagged. A pass that plans a file field first attaches the run's resume (resume-choice.ts), the one
 * the resume port then sends. A dry run's answer never carries a write. Every answer is checked against
 * PlanAnswerSchema (its caps included) before it leaves.
 *
 * The LLM steps (Phase 4; docs/design/runtime.md §4.5): a plan's awaiting keys go, with their questions, to the run's
 * RunAi (ai-tasks.ts), which submits them as TailorIT tasks, one in flight per run; the answer lists those keys as
 * awaiting, each with the row that stands until the LLM answers. plan/poll answers the keys whose answers are in: they
 * are planned again over the scan and canaries they were asked with, and the run's answers, so a pick arrives as an
 * llm-pick write (which the frame checks again before it writes) and a classification as the field's category; keys
 * still waited for stay awaiting. A poll answers at once: the frame waits between polls, and each poll keeps the worker
 * awake. A key the run does not know (a worker that restarted lost its memory) is left out of the answer, and a poll
 * that names no key the run knows answers expired: the frame plans those fields again with plan/request, and the batch
 * is read again by its task id (RunState.aiTasks) or reattached by TailorIT's dedupe key. An item never sent, and an
 * answer already in, are planned again within the same message.
 */
import type { z } from 'zod';
import type { PlanAsk, PlanOutput, PlanSensitiveState } from '../core/plan/types';
import type { FieldKey, FieldSpec } from '../core/types/field';
import type { FillResult, PlannedWrite } from '../core/types/fill';
import { ok, refuse, type Answer } from '../messaging/envelope';
import { PlanAnswerSchema, type ContentMessage } from '../messaging/schemas';
import { log } from '../shared/log';
import type { RunRecord } from '../shared/stored';
import { createRunAi, type AiTasks, type AskContext, type RunAi } from './ai-tasks';
import { ymdOf, type CoreFunctions } from './core';
import type { ProfileCache } from './profile-cache';
import type { ResumeChooser } from './resume-choice';
import type { FrameRef, RunRegistry } from './runs';
import type { RunStateStore } from './runstate-store';
import type { SettingsStore } from './settings';

type PlanAnswer = z.infer<typeof PlanAnswerSchema>;
type PlanRequest = Extract<ContentMessage, { type: 'plan/request' }>;
type PlanPoll = Extract<ContentMessage, { type: 'plan/poll' }>;

/** How many times one message plans keys again whose answers are already in (an item never sent, or a classification
 *  whose tiebreak's answer is in too). What is left waits for the next poll. */
const MAX_REPLANS = 2;

/** What the planner needs. */
export interface PlannerDeps {
  runs: RunRegistry;
  profiles: ProfileCache;
  settings: SettingsStore;
  core: Pick<CoreFunctions, 'planFrame' | 'vocab' | 'attachResume'>;
  /** The resume a run attaches; the resume port sends the same one. */
  chooseResume: ResumeChooser;
  /** The AI task client (ai-tasks.ts), shared by every run. */
  ai: AiTasks;
  /** Each run's AI task ids: RunState.aiTasks (runstate-store.ts). */
  aiTaskIds: Pick<RunStateStore, 'aiTasks'>;
  now(): number;
}

const profileRefusal = (failure: 'not-connected' | 'unavailable' | 'internal') =>
  refuse(failure === 'not-connected' ? 'not_connected' : failure === 'internal' ? 'internal' : 'unavailable');

/** A plan, or the refusal the frame gets instead. */
type Planned = { output: PlanOutput } | { refusal: Answer<never> };

/** A plan's parts as the answer carries them, gathered over the plans of one message. */
interface Gathered {
  writes: PlannedWrite[];
  results: FillResult[];
  awaiting: FieldKey[];
}

/** The plan/request and plan/poll handlers. */
export function createPlanner(deps: PlannerDeps) {
  /** The run's LLM questions and answers, made at its first need. */
  function aiOf(run: RunRecord): RunAi {
    const memo = deps.runs.memo(run.runId);
    memo.ai ??= createRunAi(deps.ai, deps.aiTaskIds.aiTasks(run.applicationKey, run.tabId));
    return memo.ai;
  }

  /**
   * One plan of `planKeys` over a scan and its canaries: the sensitive part fetched once per run when the plan needs
   * it (then planned again), and the run's resume attached when it plans a file field.
   */
  async function planOnce(run: RunRecord, url: string, context: AskContext, planKeys: readonly FieldKey[]):
    Promise<Planned> {
    let loaded = await deps.profiles.get();
    if (!loaded.ok) return { refusal: profileRefusal(loaded.failure) };
    const planned = new Set<string>(planKeys);
    const resume = context.specs.some((spec) => spec.kind === 'file' && planned.has(spec.key))
      ? await deps.chooseResume(run.runId, url) : null;
    const ai = aiOf(run);
    const settings = await deps.settings.get();
    const plan = (state: PlanSensitiveState, profile: typeof loaded & { ok: true }) => deps.core.planFrame({
      specs: context.specs,
      planKeys,
      canaries: context.canaries,
      profile: deps.core.attachResume(profile.value.profile, resume),
      sensitiveState: state,
      savedAnswers: [],
      settings,
      vocab: deps.core.vocab(),
      dryRun: run.dryRun,
      now: ymdOf(deps.now()),
      ai: ai.answers,
    });
    try {
      const memory = loaded.value.sensitiveState;
      let state: PlanSensitiveState = memory !== 'not-loaded' ? memory
        : run.sensitive === 'not-shared' || run.sensitive === 'unavailable' ? run.sensitive : 'not-loaded';
      let output = plan(state, loaded);
      if (output.needsSensitive && state === 'not-loaded') {
        const fetched = await deps.profiles.loadSensitive();
        await deps.runs.setSensitive(run.runId, fetched);
        if (fetched === 'loaded') {
          loaded = await deps.profiles.get();
          if (!loaded.ok) return { refusal: profileRefusal(loaded.failure) };
          state = loaded.value.sensitiveState === 'not-loaded' ? 'unavailable' : loaded.value.sensitiveState;
        } else {
          state = fetched;
        }
        output = plan(state, loaded);
      }
      if (output.needsSensitive) throw new Error('the plan still needs the sensitive part');
      return { output };
    } catch {
      log('plan.failed', { fields: planKeys.length });
      return { refusal: refuse('internal') };
    }
  }

  /**
   * A plan's awaiting keys handed to the run's questions, and those whose answers are in at once (an item never sent)
   * planned again, at most MAX_REPLANS times: the keys planned again take their new rows and writes.
   */
  async function withAnswers(run: RunRecord, url: string, context: AskContext, output: PlanOutput):
    Promise<{ gathered: Gathered } | { refusal: Answer<never> }> {
    const ai = aiOf(run);
    const { llm } = await deps.settings.get();
    const rows = new Map(output.results.map((row) => [row.key, row] as const));
    const writes = new Map(output.writes.map((write) => [write.key, write] as const));
    let awaiting = [...output.awaiting];
    let asking: readonly FieldKey[] = output.awaiting;
    let ask: PlanAsk | undefined = output.ask;
    for (let round = 0; ; round += 1) {
      if (asking.length > 0 && ask !== undefined) ai.ask(ask, asking, context, llm);
      const ready = awaiting.filter((key) => ai.state(key) === 'done');
      if (ready.length === 0 || round === MAX_REPLANS) break;
      ai.settle(ready);
      const again = await planOnce(run, url, context, ready);
      if ('refusal' in again) return again;
      for (const key of ready) writes.delete(key);
      for (const row of again.output.results) rows.set(row.key, row);
      for (const write of again.output.writes) writes.set(write.key, write);
      const done = new Set<string>(ready);
      awaiting = [...awaiting.filter((key) => !done.has(key)), ...again.output.awaiting];
      asking = again.output.awaiting;
      ask = again.output.ask;
    }
    // Writes in DOM order, as planFrame gives them.
    const order = new Map(context.specs.map((spec) => [spec.key, spec.domOrder] as const));
    return { gathered: {
      writes: [...writes.values()].sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0)),
      results: [...rows.values()],
      awaiting,
    } };
  }

  /** The answer, checked against PlanAnswerSchema before it leaves. */
  function answerOf(run: RunRecord, gathered: Gathered, persistableCanaries: string[], fields: number):
    Answer<PlanAnswer> {
    const answer = PlanAnswerSchema.safeParse({
      // A dry run plans rows only: nothing that could be written ever reaches the frame.
      writes: run.dryRun ? [] : gathered.writes,
      results: gathered.results,
      awaiting: gathered.awaiting,
      persistableCanaries,
    });
    if (!answer.success) {
      log('plan.failed', { fields, shape: true });
      return refuse('internal');
    }
    log('plan.answered', { fields, writes: answer.data.writes.length, dryRun: run.dryRun,
      awaiting: answer.data.awaiting.length });
    return ok(answer.data);
  }

  return {
    async request(message: PlanRequest, from: FrameRef & { url: string }): Promise<Answer<PlanAnswer>> {
      const run = await deps.runs.find(message.runId, from);
      if (run === null) return refuse('expired');
      // The schema's strings are the core's branded keys (messaging/schemas.check.ts proves the shapes equal).
      const context: AskContext = { specs: message.specs as unknown as FieldSpec[], canaries: message.canaries };
      const planKeys = message.planKeys as unknown as FieldKey[];
      const planned = await planOnce(run, from.url, context, planKeys);
      if ('refusal' in planned) return planned.refusal;
      const answered = await withAnswers(run, from.url, context, planned.output);
      if ('refusal' in answered) return answered.refusal;
      return answerOf(run, answered.gathered, planned.output.persistableCanaries, planKeys.length);
    },

    /**
     * The waiting keys whose answers are in, planned again with what they were asked from; those still waited for stay
     * awaiting; those the run does not know are left out. `expired` when it knows none of them, or not the run.
     */
    async poll(message: PlanPoll, from: FrameRef & { url: string }): Promise<Answer<PlanAnswer>> {
      const run = await deps.runs.find(message.runId, from);
      if (run === null) return refuse('expired');
      const ai = deps.runs.memo(run.runId).ai;
      const keys = message.keys as unknown as FieldKey[];
      const known = ai === undefined ? [] : keys.filter((key) => ai.state(key) !== 'unknown');
      if (ai === undefined || known.length === 0) return refuse('expired');
      const gathered: Gathered = { writes: [], results: [], awaiting: known.filter((key) => ai.state(key) === 'waiting') };
      // One plan per context the ready keys were asked from.
      const byContext = new Map<AskContext, FieldKey[]>();
      for (const key of known) {
        const context = ai.contextOf(key);
        if (ai.state(key) !== 'done' || context === undefined) continue;
        byContext.set(context, [...(byContext.get(context) ?? []), key]);
      }
      for (const [context, ready] of byContext) {
        ai.settle(ready);
        const planned = await planOnce(run, from.url, context, ready);
        if ('refusal' in planned) return planned.refusal;
        const answered = await withAnswers(run, from.url, context, planned.output);
        if ('refusal' in answered) return answered.refusal;
        gathered.writes.push(...answered.gathered.writes);
        gathered.results.push(...answered.gathered.results);
        gathered.awaiting.push(...answered.gathered.awaiting);
      }
      return answerOf(run, gathered, [], keys.length);
    },
  };
}

/** The planner, as index.ts wires it. */
export type Planner = ReturnType<typeof createPlanner>;
