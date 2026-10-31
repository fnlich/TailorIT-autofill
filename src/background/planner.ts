/*
 * plan/request and plan/poll: the worker runs the core's planFrame over one pass of a frame's fields with the
 * canonical profile it holds, and answers that frame's planned writes and value-free rows. The request carries the
 * frame's whole scan as context and the keys this pass plans (planKeys, each a spec's key: the schema checks it); the
 * worker plans and answers those only (the Phase 3 review, LC-2). So a frame receives values for its own fields only,
 * never the profile. When the plan needs the sensitive part and it is not in memory, the worker fetches it once per
 * run and plans again; a 403 makes it 'not-shared' and any other failure 'unavailable', and the core leaves those
 * fields blank and flagged. A pass that plans a file field first attaches the run's resume (resume-choice.ts), the one
 * the resume port then sends. A dry run's answer never carries a write. Every answer is
 * checked against PlanAnswerSchema (its caps included) before it leaves.
 */
import type { z } from 'zod';
import type { PlanOutput, PlanSensitiveState } from '../core/plan/types';
import type { FieldKey, FieldSpec } from '../core/types/field';
import { ok, refuse, type Answer } from '../messaging/envelope';
import { PlanAnswerSchema, type ContentMessage } from '../messaging/schemas';
import { log } from '../shared/log';
import type { RunRecord } from '../shared/stored';
import { ymdOf, type CoreFunctions } from './core';
import type { LoadedProfile, ProfileCache } from './profile-cache';
import type { ResumeChoice, ResumeChooser } from './resume-choice';
import type { FrameRef, RunRegistry } from './runs';
import type { SettingsStore } from './settings';

type PlanAnswer = z.infer<typeof PlanAnswerSchema>;
type PlanRequest = Extract<ContentMessage, { type: 'plan/request' }>;
type PlanPoll = Extract<ContentMessage, { type: 'plan/poll' }>;

/** What the planner needs. */
export interface PlannerDeps {
  runs: RunRegistry;
  profiles: ProfileCache;
  settings: SettingsStore;
  core: Pick<CoreFunctions, 'planFrame' | 'vocab' | 'attachResume'>;
  /** The resume a run attaches; the resume port sends the same one. */
  chooseResume: ResumeChooser;
  now(): number;
}

/** The sensitive state a plan runs with: what memory holds, unless this run already tried and failed to fetch it. */
function sensitiveStateOf(loaded: LoadedProfile, run: RunRecord): PlanSensitiveState {
  if (loaded.sensitiveState !== 'not-loaded') return loaded.sensitiveState;
  if (run.sensitive === 'not-shared' || run.sensitive === 'unavailable') return run.sensitive;
  return 'not-loaded';
}

const profileRefusal = (failure: 'not-connected' | 'unavailable' | 'internal') =>
  refuse(failure === 'not-connected' ? 'not_connected' : failure === 'internal' ? 'internal' : 'unavailable');

/** The plan/request and plan/poll handlers. */
export function createPlanner(deps: PlannerDeps) {
  async function plan(run: RunRecord, message: PlanRequest, loaded: LoadedProfile, sensitiveState: PlanSensitiveState,
    resume: ResumeChoice | null): Promise<PlanOutput> {
    return deps.core.planFrame({
      // The schema's strings are the core's branded keys (messaging/schemas.check.ts proves the shapes equal).
      specs: message.specs as unknown as FieldSpec[],
      planKeys: message.planKeys as unknown as FieldKey[],
      canaries: message.canaries,
      profile: deps.core.attachResume(loaded.profile, resume),
      sensitiveState,
      savedAnswers: [],
      settings: await deps.settings.get(),
      vocab: deps.core.vocab(),
      dryRun: run.dryRun,
      now: ymdOf(deps.now()),
    });
  }

  return {
    async request(message: PlanRequest, from: FrameRef & { url: string }): Promise<Answer<PlanAnswer>> {
      const run = await deps.runs.find(message.runId, from);
      if (run === null) return refuse('expired');
      let loaded = await deps.profiles.get();
      if (!loaded.ok) return profileRefusal(loaded.failure);
      // Only a pass that plans a file field needs the resume; without one the profile carries none.
      const planned = new Set(message.planKeys);
      const resume = message.specs.some((spec) => spec.kind === 'file' && planned.has(spec.key))
        ? await deps.chooseResume(run.runId, from.url) : null;

      let output: PlanOutput;
      try {
        let state = sensitiveStateOf(loaded.value, run);
        output = await plan(run, message, loaded.value, state, resume);
        if (output.needsSensitive && state === 'not-loaded') {
          const fetched = await deps.profiles.loadSensitive();
          await deps.runs.setSensitive(run.runId, fetched);
          if (fetched === 'loaded') {
            loaded = await deps.profiles.get();
            if (!loaded.ok) return profileRefusal(loaded.failure);
            state = loaded.value.sensitiveState === 'not-loaded' ? 'unavailable' : loaded.value.sensitiveState;
          } else {
            state = fetched;
          }
          output = await plan(run, message, loaded.value, state, resume);
        }
        if (output.needsSensitive) throw new Error('the plan still needs the sensitive part');
      } catch {
        log('plan.failed', { fields: message.planKeys.length });
        return refuse('internal');
      }

      const answer = PlanAnswerSchema.safeParse({
        // A dry run plans rows only: nothing that could be written ever reaches the frame.
        writes: run.dryRun ? [] : output.writes,
        results: output.results,
        awaiting: output.awaiting,
        persistableCanaries: output.persistableCanaries,
      });
      if (!answer.success) {
        log('plan.failed', { fields: message.planKeys.length, shape: true });
        return refuse('internal');
      }
      log('plan.answered', { fields: message.planKeys.length, writes: answer.data.writes.length, dryRun: run.dryRun });
      return ok(answer.data);
    },

    /** Nothing waits for the LLM before Phase 4, so a known run's poll has no writes and nothing awaiting. */
    async poll(message: PlanPoll, from: FrameRef): Promise<Answer<PlanAnswer>> {
      const run = await deps.runs.find(message.runId, from);
      if (run === null) return refuse('expired');
      return ok({ writes: [], results: [], awaiting: [], persistableCanaries: [] });
    },
  };
}

/** The planner, as index.ts wires it. */
export type Planner = ReturnType<typeof createPlanner>;
